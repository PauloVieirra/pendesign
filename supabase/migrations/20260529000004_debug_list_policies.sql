CREATE OR REPLACE FUNCTION public.debug_policies_for(p_table TEXT)
RETURNS TABLE (policyname TEXT, permissive TEXT, roles TEXT[], cmd TEXT, qual TEXT, with_check TEXT)
LANGUAGE sql STABLE
AS $$
  SELECT
    policyname::text,
    permissive::text,
    roles::text[],
    cmd::text,
    pg_get_expr(polqual, polrelid)::text AS qual,
    pg_get_expr(polwithcheck, polrelid)::text AS with_check
  FROM pg_policies pgp
  JOIN pg_policy pol ON pol.polname = pgp.policyname
  WHERE schemaname = 'public' AND tablename = p_table
$$;
GRANT EXECUTE ON FUNCTION public.debug_policies_for(TEXT) TO authenticated, anon;
