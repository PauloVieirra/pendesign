CREATE OR REPLACE FUNCTION public.debug_current_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
GRANT EXECUTE ON FUNCTION public.debug_current_role() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.debug_jwt_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'role'
$$;
GRANT EXECUTE ON FUNCTION public.debug_jwt_role() TO authenticated, anon;
