-- Harden recent_workflow_audits so callers cannot bypass workflow_audit_log RLS.
DROP VIEW IF EXISTS recent_workflow_audits;

CREATE VIEW recent_workflow_audits
WITH (security_invoker = true) AS
SELECT
  id,
  user_id,
  workflow_id,
  operation,
  tool_name,
  ai_reasoning,
  is_rolled_back,
  created_at,
  snapshot_after->>'name' as workflow_name,
  jsonb_array_length(COALESCE(changes, '[]'::jsonb)) as num_changes
FROM workflow_audit_log
WHERE created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;

REVOKE ALL ON recent_workflow_audits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON recent_workflow_audits TO authenticated;

COMMENT ON VIEW recent_workflow_audits IS 'Recent workflow audit summary. Uses security_invoker so workflow_audit_log RLS is enforced for callers.';
