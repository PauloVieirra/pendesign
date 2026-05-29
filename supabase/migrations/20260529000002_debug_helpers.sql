-- Temporary debug RPCs to introspect RLS context. Drop after verification.
CREATE OR REPLACE FUNCTION public.debug_uid()
RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT auth.uid()::text $$;
GRANT EXECUTE ON FUNCTION public.debug_uid() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.debug_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
GRANT EXECUTE ON FUNCTION public.debug_role() TO authenticated, anon;
