-- Atomic per-day usage upsert; SECURITY DEFINER so callers (auth or anon) can't bypass RLS on usage_daily.
CREATE OR REPLACE FUNCTION public.increment_mcp_usage(_user_id uuid, _n integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_daily(user_id, day, mcp_calls)
  VALUES (_user_id, CURRENT_DATE, GREATEST(_n, 0))
  ON CONFLICT (user_id, day)
  DO UPDATE SET mcp_calls = usage_daily.mcp_calls + GREATEST(_n, 0);
END $$;

REVOKE ALL ON FUNCTION public.increment_mcp_usage(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_mcp_usage(uuid, integer) TO service_role;

-- Daily counter read for rate limiting (server-side, bypasses RLS via SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.get_today_mcp_usage(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(mcp_calls, 0) FROM public.usage_daily WHERE user_id = _user_id AND day = CURRENT_DATE;
$$;

REVOKE ALL ON FUNCTION public.get_today_mcp_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_today_mcp_usage(uuid) TO service_role;

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_user_created
  ON public.mcp_call_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_api_keys_user_revoked
  ON public.platform_api_keys (user_id, revoked_at);
