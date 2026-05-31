-- Fix: INSERT ... RETURNING fails RLS because the SELECT-after-INSERT
-- runs is_project_member(new_id, auth.uid()) before the bootstrap_owner
-- trigger has finished committing the project_members row (or before MVCC
-- can see it from a STABLE function call). Owners had no way to read back
-- the row they just inserted.
--
-- Fix: add `owner_id = auth.uid()` as a fast-path in every SELECT policy
-- that joins through project_members. The owner check is cheap, doesn't
-- need a function call, and always passes for the just-inserted row.
-- Non-owners still get filtered through is_project_member as before.

DROP POLICY IF EXISTS "projects_select_member" ON public.projects;
CREATE POLICY "projects_select_member" ON public.projects
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_project_member(projects.id, auth.uid())
  );

DROP POLICY IF EXISTS "project_versions_select_member" ON public.project_versions;
CREATE POLICY "project_versions_select_member" ON public.project_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_versions.project_id AND p.owner_id = auth.uid()
    )
    OR public.is_project_member(project_versions.project_id, auth.uid())
  );

DROP POLICY IF EXISTS "change_proposals_select_member" ON public.change_proposals;
CREATE POLICY "change_proposals_select_member" ON public.change_proposals
  FOR SELECT TO authenticated
  USING (
    submitter_id = auth.uid()
    OR public.is_project_member(change_proposals.project_id, auth.uid())
  );

-- Drop debug helpers — no longer needed.
DROP FUNCTION IF EXISTS public.debug_uid();
DROP FUNCTION IF EXISTS public.debug_role();
DROP FUNCTION IF EXISTS public.debug_current_role();
DROP FUNCTION IF EXISTS public.debug_jwt_role();
DROP FUNCTION IF EXISTS public.debug_policies_for(TEXT);
