# Legacy audit-log migrations (superseded)

These files were found in a root-level `migrations/` directory, outside
`supabase/migrations/`. They are an early draft of the workflow audit log and
must not be applied:

- `004_create_workflow_audit_log.sql` uses an `n8n_instance_id NOT NULL`
  column; the application reads and writes `instance_id`.
- `005_harden_recent_workflow_audits_view.sql` defines a
  `recent_workflow_audits` view that no application code references.
- `run-audit-migration.js` applies the two files above with a service-role key.

The authoritative schema is
`supabase/migrations/20260613090000_workflow_audit_log.sql` and later
migrations. Moved here on 2026-11-04; delete once confirmed unused in
production.
