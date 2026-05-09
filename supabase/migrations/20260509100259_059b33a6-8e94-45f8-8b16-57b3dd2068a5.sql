REVOKE EXECUTE ON FUNCTION public.increment_mcp_usage(uuid, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_today_mcp_usage(uuid) FROM anon, authenticated;