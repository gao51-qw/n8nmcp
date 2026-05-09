-- Restrict execution of internal helpers; cron runs as postgres which still has access.
REVOKE EXECUTE ON FUNCTION public.publish_due_announcements() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_validate_announcement_status() FROM PUBLIC, anon, authenticated;