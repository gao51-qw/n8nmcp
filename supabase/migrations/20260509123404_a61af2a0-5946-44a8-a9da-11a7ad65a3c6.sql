CREATE TABLE public.announcement_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid,
  actor_id uuid,
  action text NOT NULL,
  summary text,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_anno_audit_announcement ON public.announcement_audit_logs(announcement_id, created_at DESC);
CREATE INDEX idx_anno_audit_created_at ON public.announcement_audit_logs(created_at DESC);

ALTER TABLE public.announcement_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anno_audit_admin_select"
  ON public.announcement_audit_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "anno_audit_admin_insert"
  ON public.announcement_audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND actor_id = auth.uid()
  );