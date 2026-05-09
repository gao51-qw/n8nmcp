REVOKE EXECUTE ON FUNCTION public.get_today_prompt_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_today_prompt_usage(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.increment_prompt_usage(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_prompt_usage(uuid, integer) TO service_role;