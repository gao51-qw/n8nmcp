ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_audit_logs;
ALTER TABLE public.announcement_audit_logs REPLICA IDENTITY FULL;