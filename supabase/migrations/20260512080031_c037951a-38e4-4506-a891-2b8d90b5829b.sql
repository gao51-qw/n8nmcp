
-- 1) Announcements: default to draft so scheduled rows aren't immediately readable.
ALTER TABLE public.announcements ALTER COLUMN status SET DEFAULT 'draft';

-- 2) Lock down SECURITY DEFINER functions: revoke broad EXECUTE.
REVOKE EXECUTE ON FUNCTION public.get_today_prompt_usage(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_today_mcp_usage(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_mcp_usage(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_prompt_usage(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_due_announcements()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_validate_announcement_status() FROM PUBLIC, anon, authenticated;

-- has_role is invoked by RLS policies running as the authenticated user, so it
-- must remain callable. Keep grant explicit.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
