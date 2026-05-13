CREATE TABLE IF NOT EXISTS public.site_settings (
  id boolean PRIMARY KEY DEFAULT true,
  ga4_measurement_id text,
  gsc_verification text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT site_settings_singleton CHECK (id = true)
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- Public read (values are shipped to every browser anyway)
CREATE POLICY "site_settings_public_read"
  ON public.site_settings FOR SELECT
  USING (true);

-- Admin-only write
CREATE POLICY "site_settings_admin_insert"
  ON public.site_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "site_settings_admin_update"
  ON public.site_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER site_settings_set_updated_at
  BEFORE UPDATE ON public.site_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed the singleton row
INSERT INTO public.site_settings (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;