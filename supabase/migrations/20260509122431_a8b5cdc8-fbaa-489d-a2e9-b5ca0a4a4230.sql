-- 1. Status + scheduled_for columns
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

-- Status validation via trigger (avoid CHECK so future values are easy to add)
CREATE OR REPLACE FUNCTION public.tg_validate_announcement_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('draft', 'scheduled', 'published') THEN
    RAISE EXCEPTION 'Invalid announcement status: %', NEW.status;
  END IF;
  IF NEW.status = 'scheduled' AND NEW.scheduled_for IS NULL THEN
    RAISE EXCEPTION 'scheduled_for is required when status = scheduled';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_announcement_status ON public.announcements;
CREATE TRIGGER validate_announcement_status
BEFORE INSERT OR UPDATE ON public.announcements
FOR EACH ROW EXECUTE FUNCTION public.tg_validate_announcement_status();

-- 2. Restrict public read to published rows; admins still see all via the
--    existing anno_admin_write ALL policy.
DROP POLICY IF EXISTS anno_read_all ON public.announcements;
CREATE POLICY anno_read_published
  ON public.announcements
  FOR SELECT
  TO authenticated
  USING (status = 'published');

-- 3. Auto-publish job: flip scheduled rows whose time has come.
CREATE OR REPLACE FUNCTION public.publish_due_announcements()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  WITH updated AS (
    UPDATE public.announcements
       SET status = 'published',
           published_at = COALESCE(scheduled_for, now())
     WHERE status = 'scheduled'
       AND scheduled_for IS NOT NULL
       AND scheduled_for <= now()
     RETURNING 1
  )
  SELECT count(*) INTO n FROM updated;
  RETURN n;
END $$;

-- 4. Schedule the job every minute (idempotent: unschedule first if exists)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-due-announcements') THEN
    PERFORM cron.unschedule('publish-due-announcements');
  END IF;
  PERFORM cron.schedule(
    'publish-due-announcements',
    '* * * * *',
    $cron$ SELECT public.publish_due_announcements(); $cron$
  );
END $$;