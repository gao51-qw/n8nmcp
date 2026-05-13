
CREATE OR REPLACE FUNCTION public.tg_support_tickets_user_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     OR NEW.category IS DISTINCT FROM OLD.category THEN
    RAISE EXCEPTION 'Only admins can change ticket status, priority, category, assignment, or ownership';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_support_tickets_user_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS support_tickets_user_update_guard ON public.support_tickets;
CREATE TRIGGER support_tickets_user_update_guard
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.tg_support_tickets_user_update_guard();
