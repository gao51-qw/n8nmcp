
-- Drop broad SELECT policy; public bucket serves files via /object/public/<path> without RLS
DROP POLICY IF EXISTS "avatars public read" ON storage.objects;

-- Re-revoke (idempotent) in case grants snuck back on CREATE OR REPLACE
REVOKE ALL ON FUNCTION public.admin_set_user_tier(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_grant_role(UUID, app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_revoke_role(UUID, app_role) FROM PUBLIC, anon, authenticated;
