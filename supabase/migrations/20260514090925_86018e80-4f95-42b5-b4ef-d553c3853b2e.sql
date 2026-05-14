CREATE TABLE public.manual_revenue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  currency text NOT NULL DEFAULT 'USD',
  source text NOT NULL DEFAULT 'other',
  description text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_manual_revenue_occurred_at ON public.manual_revenue_entries (occurred_at DESC);

ALTER TABLE public.manual_revenue_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY mre_admin_all ON public.manual_revenue_entries
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER mre_set_updated_at
  BEFORE UPDATE ON public.manual_revenue_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();