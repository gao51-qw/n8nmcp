REVOKE EXECUTE ON FUNCTION public.get_today_mcp_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_today_prompt_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_mcp_usage(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_prompt_usage(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_due_announcements() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_today_mcp_usage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_today_prompt_usage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_mcp_usage(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_prompt_usage(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_due_announcements() TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'announcement_audit_logs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.announcement_audit_logs';
  END IF;
END $$;
