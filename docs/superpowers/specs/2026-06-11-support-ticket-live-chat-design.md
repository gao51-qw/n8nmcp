# Support Ticket and Live Chat Design

## Objective

Extend the existing Supabase support-ticket system with authenticated live chat,
agent presence, automatic assignment, business-hours SLA tracking, email
notifications, n8n notifications, and Sentry/MCP correlation.

The design targets an initial team of three support agents and approximately ten
new conversations per day while remaining within the Supabase Free plan.

## Confirmed Product Decisions

- Only authenticated users can use live chat.
- The support entry is a smart floating window.
- Opening a conversation immediately creates a persistent ticket.
- Online agents receive conversations through automatic least-loaded round-robin assignment.
- Agent availability is determined by browser heartbeat.
- If no agent is online, the same window switches to offline message mode.
- SLA time uses `Asia/Shanghai`, Monday-Friday, 09:00-18:00.
- Chinese public holidays pause SLA time; official make-up workdays count as working days.
- First-response SLA targets:
  - Urgent: 30 working minutes.
  - High: 2 working hours.
  - Normal: 8 working hours.
  - Low: 16 working hours.
- Resend sends transactional support email.
- n8n receives operational notification webhooks.
- Text messages and ticket records are retained permanently.
- Attachments are retained for 180 days.
- Attachments are limited to 10 MB each and five files per ticket.

## Existing Foundation

The project already contains:

- `support_tickets` and `support_ticket_replies`.
- Ticket status, priority, category, assignment, attachments, and timestamps.
- Supabase RLS policies for ticket owners and administrators.
- A private `ticket-attachments` Storage bucket.
- User ticket functions and an authenticated ticket page.
- Administrator ticket functions and a ticket-management page.
- A structured JSON server logger.

The implementation should extend these components rather than introduce a
second ticket model or external customer-support database.

## Architecture

Supabase remains the system of record. Ticket messages are persisted before
clients are notified. Supabase Realtime delivers change notifications but is
not the durable message transport.

```text
Authenticated user
    |
    v
Smart support window
    |
    +--> create live_chat ticket
    +--> assign least-loaded online agent
    +--> persist replies in Postgres
    +--> subscribe only to this ticket's replies
    |
    +--> no online agent: continue as offline ticket

Agent workbench
    |
    +--> heartbeat / presence
    +--> assigned queue and SLA queue
    +--> replies, transfer, tags, internal notes

Outbox worker
    |
    +--> Resend transactional email
    +--> n8n notification webhook
```

The existing user ticket page remains the long-term history and asynchronous
reply surface. The floating chat window is a focused real-time view over the
same tickets and replies.

## Data Model

### Extend `support_tickets`

Add:

- `source`: enum containing `ticket_form` and `live_chat`.
- `first_response_due_at`: absolute SLA deadline.
- `first_responded_at`: first qualifying human-agent response.
- `resolved_due_at`: optional future resolution deadline.
- `sla_breached_at`: first recorded breach time.
- `sentry_event_id`: nullable Sentry event correlation identifier.
- `mcp_request_id`: nullable MCP/application request identifier.
- `assignment_cursor`: assignment ordering metadata if needed by the database function.

Keep the existing `assigned_to` field.

### `support_agent_presence`

Stores one row per support agent:

- `agent_id`
- `last_heartbeat_at`
- `status`
- `active_ticket_count`
- `last_assigned_at`

An agent is online when the most recent heartbeat is no older than 90 seconds.
The workbench sends a heartbeat every 30 seconds while visible and authenticated.

### `support_ticket_tags`

Use normalized tag records rather than a free-form JSON array:

- `ticket_id`
- `tag`
- `created_by`
- `created_at`

Tags are administrator-readable and administrator-writable.

### `support_ticket_internal_notes`

Stores notes that must never be visible to ticket owners:

- `id`
- `ticket_id`
- `author_id`
- `body`
- `created_at`
- `updated_at`

Only administrators may select, insert, update, or delete these rows.

### `support_ticket_events`

Append-only operational audit history:

- `id`
- `ticket_id`
- `actor_id`
- `event_type`
- `payload`
- `created_at`

Events include creation, assignment, transfer, priority change, status change,
first response, SLA warning, SLA breach, attachment expiry, and notification
delivery outcome.

### `support_calendar_days`

Stores Chinese calendar exceptions:

- `day`
- `kind`: `holiday` or `makeup_workday`
- `name`

Normal weekdays do not require rows. The table overrides the normal
Monday-Friday rule.

### `support_notification_outbox`

Provides reliable asynchronous notifications:

- `id`
- `ticket_id`
- `channel`: `resend` or `n8n`
- `event_type`
- `payload`
- `idempotency_key`
- `status`
- `attempt_count`
- `next_attempt_at`
- `last_error`
- `created_at`
- `processed_at`

The idempotency key must be unique. Chat and ticket writes must not depend on
Resend or n8n availability.

## Assignment

Ticket assignment runs inside one database transaction:

1. Select agents with heartbeat age at most 90 seconds.
2. Calculate each agent's active assigned tickets.
3. Select the agent with the smallest active count.
4. Break ties using the oldest `last_assigned_at`.
5. Lock the selected presence row.
6. Assign the ticket and update `last_assigned_at`.

Agents may manually transfer a ticket. If no agent is online, the ticket remains
unassigned and is assigned when an agent next becomes available.

## Realtime Behavior

- The support window creates a Realtime subscription only while open.
- A user subscribes only to replies for a ticket they own.
- An agent workbench keeps one project connection and subscribes to its queue,
  pending queue changes, and the currently opened ticket.
- Messages are inserted into Postgres and then rendered from persisted data.
- Reconnect performs a normal query for messages newer than the last known
  timestamp before resuming live updates.
- Typing indicators are optional and excluded from the first release.

This approach minimizes Free-plan message and connection usage. At ten daily
conversations, the published limits of 200 peak connections and two million
monthly Realtime messages provide ample initial capacity.

## SLA Calculation

SLA deadlines are computed when priority or creation time changes. There is no
per-ticket polling timer.

The calculation:

1. Convert the starting time to `Asia/Shanghai`.
2. Move times outside business hours to the next working period.
3. Count only 09:00-18:00 working minutes.
4. Skip weekends unless listed as a make-up workday.
5. Skip dates listed as holidays.

The first non-system administrator reply sets `first_responded_at`. Automated
messages, emails, webhook events, and internal notes do not satisfy the SLA.

The UI derives the countdown from `first_response_due_at`. A lightweight
scheduled worker periodically finds due or nearly due tickets and writes
idempotent warning/breach events to the outbox.

## User Experience

### Smart Floating Window

- Available only to authenticated users.
- Shows online/offline state before the first message.
- Creates a `live_chat` ticket when the user starts the conversation.
- Displays ticket number, assigned agent, messages, delivery state, and attachments.
- Online mode promises a live response without guaranteeing immediate pickup.
- Offline mode explains the business-hours response expectation.
- Closing the window does not close the ticket.
- Reopening restores the active conversation.

The window may accept or automatically receive `sentryEventId` and
`mcpRequestId` from an error page or MCP result.

### User Ticket Page

Retain the existing page and add:

- Search and filtering.
- Live updates while ticket detail is open.
- Source and assigned-agent display.
- SLA expectation.
- Correlation identifiers when appropriate.

### Agent Workbench

Add queue views for:

- Unassigned.
- My conversations.
- Waiting for user.
- SLA due soon.
- SLA breached.
- Resolved and closed.

The detail workspace includes:

- Conversation and attachments.
- User context.
- Sentry event ID and MCP request ID.
- Status, priority, assignee, tags, and transfer controls.
- Internal notes.
- First-response countdown and event timeline.

## Notifications

### Resend

Send:

- Ticket creation confirmation.
- Offline message confirmation.
- Agent reply notification when the user is not actively viewing the chat.
- Status-change notification.

Do not email on every message while both participants are active.

### n8n

Send signed webhook events for:

- New unassigned ticket.
- Urgent ticket.
- SLA due soon.
- SLA breached.

Webhook payloads contain identifiers and operational metadata, not message
bodies, credentials, or attachments. n8n may fan out to Slack, email, or other
team channels.

## Logging and Sentry

Continue using the existing JSON logger and standardize these fields:

- `requestId`
- `userId`
- `ticketId`
- `agentId`
- `mcpTool`
- `sentryEventId`

Sentry captures application errors and performance traces. Tickets store only
the event identifier, not stack traces or raw Sentry payloads.

Never log API keys, authorization headers, cookies, email bodies, attachment
contents, full chat messages, or raw MCP arguments that may contain secrets.

Operational audit events belong in `support_ticket_events`; runtime failures
belong in structured logs and Sentry.

## Security

- Preserve ticket-owner RLS and administrator access.
- Add explicit administrator-only policies for presence management, assignment,
  tags, internal notes, and ticket events.
- Realtime access follows the same ticket ownership policies.
- Use private Storage objects and short-lived signed URLs.
- Enforce attachment type, count, and 10 MB size limits on both client and server.
- Never expose the Supabase service-role key to clients.
- Sign n8n webhook requests and validate destination configuration server-side.
- Resend and n8n processing must use idempotency keys.
- Assignment uses row locks to prevent duplicate concurrent assignment.

## Retention

- Ticket metadata and text replies: permanent.
- Attachments: 180 days.
- Maximum five attachments per ticket.
- Maximum 10 MB per attachment.
- Expiry removes the Storage object but retains an audit event containing safe
  file metadata.

At the expected volume, database storage should remain small. Attachment use is
the primary Free-plan risk and should be displayed in an administrator usage
summary.

## Testing

### Unit and Database Tests

- Business-hours deadline calculation.
- Weekends, holidays, and make-up workdays.
- Every priority target.
- First human response qualification.
- Three-agent least-loaded round-robin assignment.
- Concurrent assignment locking.
- Presence expiry after 90 seconds.
- Outbox idempotency and retry scheduling.
- Attachment validation and expiry.

### Authorization Tests

- Users can read only their tickets and replies.
- Users cannot view internal notes, assignment state for other users, or agent presence.
- Agents cannot accidentally expose internal notes through shared reply queries.
- Signed attachment URLs cannot be obtained for unrelated tickets.

### Integration and End-to-End Tests

- Online authenticated conversation.
- Offline conversation automatically continuing as a ticket.
- Reconnect and missed-message recovery.
- Agent transfer and queue updates.
- SLA warning and breach notifications.
- Resend failure and retry.
- n8n failure and retry.
- Sentry and MCP identifiers flowing from error context into the ticket.

## Rollout

1. Add schema and RLS changes.
2. Implement SLA and assignment database functions with tests.
3. Add outbox processing and integrations.
4. Extend existing ticket service functions.
5. Upgrade the administrator workbench.
6. Add the authenticated floating chat window.
7. Enable Realtime subscriptions and presence.
8. Add Sentry correlation and structured-log fields.
9. Run RLS, concurrency, and end-to-end verification.
10. Monitor Free-plan usage and attachment growth.

## Free-Plan Guardrails

- Open user Realtime connections only while the chat window is open.
- Use one Realtime connection per agent workbench.
- Subscribe to narrow ticket or queue filters.
- Do not implement typing broadcasts in the first release.
- Warn at 150 simultaneous Realtime connections.
- Warn at 1.5 million monthly Realtime messages.
- Track database and Storage size.
- Preserve a polling fallback for ticket history if Realtime is temporarily unavailable.
