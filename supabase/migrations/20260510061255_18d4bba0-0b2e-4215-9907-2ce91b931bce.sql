ALTER TABLE public.mcp_call_logs
  ADD COLUMN IF NOT EXISTS upstream boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS category text;