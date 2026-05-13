
-- 1. admin_audit_logs
CREATE TABLE public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  target_user_id UUID,
  action TEXT NOT NULL,
  summary TEXT,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_audit_target ON public.admin_audit_logs(target_user_id, created_at DESC);
CREATE INDEX idx_admin_audit_actor ON public.admin_audit_logs(actor_id, created_at DESC);
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_audit_select ON public.admin_audit_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY admin_audit_insert ON public.admin_audit_logs FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND actor_id = auth.uid());

-- 2. admin_user_notes
CREATE TABLE public.admin_user_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_user_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_notes_all ON public.admin_user_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_admin_user_notes_updated_at
  BEFORE UPDATE ON public.admin_user_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. avatars storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "avatars public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
CREATE POLICY "avatars owner insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "avatars owner update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "avatars owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 4. SECURITY DEFINER admin functions
CREATE OR REPLACE FUNCTION public.admin_set_user_tier(_target_user_id UUID, _tier TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _tier NOT IN ('free','pro','enterprise') THEN
    RAISE EXCEPTION 'invalid tier';
  END IF;
  UPDATE public.subscriptions SET tier = _tier, updated_at = now() WHERE user_id = _target_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.subscriptions(user_id, tier, status) VALUES (_target_user_id, _tier, 'active');
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_tier(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_grant_role(_target_user_id UUID, _role app_role)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (_target_user_id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_grant_role(UUID, app_role) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(_target_user_id UUID, _role app_role)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _target_user_id AND role = _role;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_role(UUID, app_role) FROM PUBLIC, anon, authenticated;
