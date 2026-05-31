-- ============================================================================
-- Fix: RLS infinite recursion between `projects` and `project_members`.
--
-- The Phase 2 migration broadened SELECT on projects to "you're a member"
-- via EXISTS on project_members, while project_members.SELECT also checks
-- the project via projects. Postgres detects this cycle as "infinite
-- recursion in policy" (SQLSTATE 42P17) and rejects all queries.
--
-- Fix: wrap the membership lookup in a SECURITY DEFINER function so it
-- bypasses RLS and breaks the cycle. Replace the cyclic EXISTS expressions
-- with calls to that function.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = p_project_id AND user_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_project_member(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND owner_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_project_owner(UUID, UUID) TO authenticated;

-- ============================================================================
-- Rewrite the policies that participated in the cycle.
-- ============================================================================

DROP POLICY IF EXISTS "projects_select_member" ON public.projects;
CREATE POLICY "projects_select_member" ON public.projects
  FOR SELECT TO authenticated
  USING (public.is_project_member(projects.id, auth.uid()));

DROP POLICY IF EXISTS "project_versions_select_member" ON public.project_versions;
CREATE POLICY "project_versions_select_member" ON public.project_versions
  FOR SELECT TO authenticated
  USING (public.is_project_member(project_versions.project_id, auth.uid()));

DROP POLICY IF EXISTS "project_versions_insert_owner" ON public.project_versions;
CREATE POLICY "project_versions_insert_owner" ON public.project_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_project_owner(project_versions.project_id, auth.uid())
    AND author_id = auth.uid()
  );

DROP POLICY IF EXISTS "project_members_select" ON public.project_members;
CREATE POLICY "project_members_select" ON public.project_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_project_owner(project_members.project_id, auth.uid())
  );

DROP POLICY IF EXISTS "project_members_delete" ON public.project_members;
CREATE POLICY "project_members_delete" ON public.project_members
  FOR DELETE TO authenticated
  USING (
    role <> 'owner'
    AND public.is_project_owner(project_members.project_id, auth.uid())
  );

DROP POLICY IF EXISTS "invitations_select_owner_or_invitee" ON public.project_invitations;
CREATE POLICY "invitations_select_owner_or_invitee" ON public.project_invitations
  FOR SELECT TO authenticated
  USING (
    public.is_project_owner(project_invitations.project_id, auth.uid())
    OR email = public.auth_email()
  );

DROP POLICY IF EXISTS "invitations_insert_owner" ON public.project_invitations;
CREATE POLICY "invitations_insert_owner" ON public.project_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_project_owner(project_invitations.project_id, auth.uid())
  );

DROP POLICY IF EXISTS "invitations_delete_owner" ON public.project_invitations;
CREATE POLICY "invitations_delete_owner" ON public.project_invitations
  FOR DELETE TO authenticated
  USING (public.is_project_owner(project_invitations.project_id, auth.uid()));

DROP POLICY IF EXISTS "change_proposals_select_member" ON public.change_proposals;
CREATE POLICY "change_proposals_select_member" ON public.change_proposals
  FOR SELECT TO authenticated
  USING (public.is_project_member(change_proposals.project_id, auth.uid()));

DROP POLICY IF EXISTS "change_proposals_insert_editor" ON public.change_proposals;
CREATE POLICY "change_proposals_insert_editor" ON public.change_proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    submitter_id = auth.uid()
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = change_proposals.project_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'editor')
    )
  );

DROP POLICY IF EXISTS "comments_select_member" ON public.proposal_comments;
CREATE POLICY "comments_select_member" ON public.proposal_comments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.change_proposals cp
      WHERE cp.id = proposal_comments.proposal_id
        AND public.is_project_member(cp.project_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "comments_insert_member" ON public.proposal_comments;
CREATE POLICY "comments_insert_member" ON public.proposal_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.change_proposals cp
      WHERE cp.id = proposal_comments.proposal_id
        AND public.is_project_member(cp.project_id, auth.uid())
    )
  );

-- ============================================================================
-- Storage policies — same recursion pattern. Replace EXISTS with the helper.
-- ============================================================================

DROP POLICY IF EXISTS "projects_storage_read" ON storage.objects;
CREATE POLICY "projects_storage_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'projects'
    AND public.is_project_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

DROP POLICY IF EXISTS "projects_storage_write" ON storage.objects;
CREATE POLICY "projects_storage_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'projects'
    AND public.is_project_owner(((storage.foldername(name))[1])::uuid, auth.uid())
  );

DROP POLICY IF EXISTS "proposals_storage_read" ON storage.objects;
CREATE POLICY "proposals_storage_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'proposals'
    AND EXISTS (
      SELECT 1 FROM public.change_proposals cp
      WHERE cp.id = ((storage.foldername(name))[1])::uuid
        AND public.is_project_member(cp.project_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "proposals_storage_write" ON storage.objects;
CREATE POLICY "proposals_storage_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'proposals'
    AND EXISTS (
      SELECT 1 FROM public.change_proposals cp
      WHERE cp.id = ((storage.foldername(name))[1])::uuid
        AND cp.submitter_id = auth.uid()
        AND cp.status = 'pending'
    )
  );
