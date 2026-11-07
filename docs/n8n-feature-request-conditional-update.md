# Draft feature request: conditional workflow update in the n8n Public API

> Draft for the maintainer to review and submit to n8n (GitHub issue or community
> feature request). Not submitted yet.

## Summary

Add optimistic concurrency control to `PUT /api/v1/workflows/{id}`. Let callers send the
`versionId` they last read, as an `If-Match` header or an `expectedVersionId` body field. n8n
then rejects the update with `409 Conflict` (or `412 Precondition Failed` for `If-Match`) when the
stored workflow has a different `versionId`.

## Problem

API clients such as automation agents, CI pipelines and MCP servers update workflows with a
read-modify-write cycle:

1. `GET /api/v1/workflows/{id}`
2. modify `nodes` / `connections` / `settings` locally
3. `PUT /api/v1/workflows/{id}` with the full editable body

The PUT is unconditional. `versionId` and `updatedAt` are read-only, the body schema has
`additionalProperties: false`, and no `If-Match` or `ETag` handling exists. If a user saves the same
workflow in the editor between steps 1 and 3, step 3 overwrites that save with no error. After
the fact, the API caller cannot even see what was lost: the PUT resets `versionId` and `updatedAt`.
The Public API has no endpoint that lists workflow history versions.
`GET /api/v1/workflows/{id}/{versionId}` needs a version id that the caller never saw.

Clients can only narrow the window by re-reading right before the PUT, and detect some races
afterwards by re-reading after the PUT and comparing `versionId`. Both cost extra requests, and
neither closes the race.

The editor already prevents this for its own saves through its internal checksum check. The
instance-level MCP `update_workflow` tool also has no expected-version argument.

## Proposal

Either form would solve it; supporting both would be ideal.

1. **`If-Match` header** on `PUT /api/v1/workflows/{id}`
   (and optionally on `activate`, `deactivate`, `archive` and `DELETE`):
   - `GET /api/v1/workflows/{id}` returns `ETag: "<versionId>"`.
   - `PUT` with `If-Match: "<versionId>"` succeeds only if the stored `versionId` matches.
     Otherwise it returns `412 Precondition Failed`, with the current `versionId` in the body or
     the `ETag` header.
2. **`expectedVersionId` body field** (or query parameter) on the same endpoint. On a mismatch it
   returns `409 Conflict` with `{ "code": "workflow_version_conflict", "currentVersionId": "..." }`.

The comparison and the write must be atomic, for example `UPDATE ... WHERE id = ? AND versionId = ?`
with an affected-row check, so that two concurrent conditional PUTs cannot both succeed.

The same optional argument on the instance-level MCP `update_workflow` tool would give MCP clients
the same guarantee.

## Backwards compatibility

The feature is opt-in. Requests without `If-Match` or `expectedVersionId` behave exactly as today.

## Optional, related

- A Public API endpoint that lists workflow history versions with `versionId` and `createdAt`, for
  example `GET /api/v1/workflows/{id}/versions`. Clients could then prove after the fact whether
  another version was saved between their read and their write.
- Return `versionId` and `updatedAt` consistently in every workflow mutation response,
  including activate and deactivate.

## Why it matters

AI agents and automation now edit production workflows through the Public API while people edit
the same workflows in the editor. Silent lost updates are hard to notice and hard to audit. A
conditional update is the standard HTTP mechanism for this (RFC 9110 §13.1.1), and n8n already
keeps the `versionId` it would need.
