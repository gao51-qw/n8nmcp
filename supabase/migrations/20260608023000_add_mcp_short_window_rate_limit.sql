-- Atomic short-window rate limiting for the public MCP gateway.
-- This replaces per-isolate memory as the production source of truth while
-- keeping the app-side memory bucket available as a local fallback.

CREATE TABLE IF NOT EXISTS public.mcp_rate_limit_windows (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bucket_start)
);

ALTER TABLE public.mcp_rate_limit_windows ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_mcp_rate_limit_windows_bucket
  ON public.mcp_rate_limit_windows (bucket_start);

CREATE OR REPLACE FUNCTION public.check_mcp_short_window(
  _user_id uuid,
  _window_seconds integer DEFAULT 10,
  _max_requests integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bucket_start timestamptz;
  _allowed boolean;
BEGIN
  IF _window_seconds <= 0 OR _max_requests <= 0 THEN
    RAISE EXCEPTION 'window_seconds and max_requests must be positive';
  END IF;

  _bucket_start :=
    to_timestamp(floor(extract(epoch from now()) / _window_seconds) * _window_seconds);

  DELETE FROM public.mcp_rate_limit_windows
   WHERE bucket_start < now() - interval '10 minutes';

  WITH upserted AS (
    INSERT INTO public.mcp_rate_limit_windows (user_id, bucket_start, request_count)
    VALUES (_user_id, _bucket_start, 1)
    ON CONFLICT (user_id, bucket_start)
    DO UPDATE
       SET request_count = public.mcp_rate_limit_windows.request_count + 1,
           updated_at = now()
     WHERE public.mcp_rate_limit_windows.request_count < _max_requests
    RETURNING request_count
  )
  SELECT EXISTS (SELECT 1 FROM upserted) INTO _allowed;

  RETURN COALESCE(_allowed, false);
END;
$$;

REVOKE ALL ON TABLE public.mcp_rate_limit_windows FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_mcp_short_window(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_mcp_short_window(uuid, integer, integer)
  TO service_role;
