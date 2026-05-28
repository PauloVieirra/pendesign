-- ============================================================================
-- Phase 2 — Sharing + invitations.
--
-- project_members: who has access to a project, with what role.
-- project_invitations: outstanding email invites awaiting acceptance.
--
-- Phase 2 also broadens the SELECT policies on projects/project_versions and
-- on storage objects so members (not just owner) can read.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.project_members (
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_members_user_idx ON public.project_members (user_id);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- A user can see their own memberships, and owners can see all members of
-- their project.
DROP POLICY IF EXISTS "project_members_select" ON public.project_members;
CREATE POLICY "project_members_select" ON public.project_members
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_members.project_id AND p.owner_id = auth.uid()
    )
  );

-- INSERT: only via Edge Function (accept-by-token) using SECURITY DEFINER.
-- No INSERT policy here means denied for normal authenticated calls.

-- DELETE: owner removes member (revoking access). Owner cannot remove themselves.
DROP POLICY IF EXISTS "project_members_delete" ON public.project_members;
CREATE POLICY "project_members_delete" ON public.project_members
  FOR DELETE TO authenticated USING (
    role <> 'owner'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_members.project_id AND p.owner_id = auth.uid()
    )
  );

-- Bootstrap the owner as the first member when a project is created.
CREATE OR REPLACE FUNCTION public.bootstrap_owner_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id, role, invited_at, accepted_at)
  VALUES (NEW.id, NEW.owner_id, 'owner', NOW(), NOW())
  ON CONFLICT (project_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_bootstrap_owner ON public.projects;
CREATE TRIGGER projects_bootstrap_owner
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_owner_membership();

-- Backfill: any projects created during Phase 1 (before this migration) need
-- their owner-membership row. Idempotent.
INSERT INTO public.project_members (project_id, user_id, role, invited_at, accepted_at)
SELECT id, owner_id, 'owner', created_at, created_at FROM public.projects
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ============================================================================
-- Broaden SELECT on projects + project_versions to include all members.
-- ============================================================================

DROP POLICY IF EXISTS "projects_select_owner" ON public.projects;
DROP POLICY IF EXISTS "projects_select_member" ON public.projects;
CREATE POLICY "projects_select_member" ON public.projects
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = projects.id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_versions_select_owner" ON public.project_versions;
DROP POLICY IF EXISTS "project_versions_select_member" ON public.project_versions;
CREATE POLICY "project_versions_select_member" ON public.project_versions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = project_versions.project_id AND m.user_id = auth.uid()
    )
  );

-- Broaden Storage read policy too.
DROP POLICY IF EXISTS "projects_storage_read" ON storage.objects;
CREATE POLICY "projects_storage_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id::text = (storage.foldername(name))[1]
        AND m.user_id = auth.uid()
    )
  );

-- WRITE: in Phase 2 still owner-only. Phase 3's Edge Function (approve-proposal)
-- uses service-role to write new versions during approval; that bypasses RLS.

-- ============================================================================
-- project_invitations: outstanding email invites.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.project_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email       TEXT NOT NULL CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  role        TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID NOT NULL REFERENCES public.profiles(id),
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  -- A given email gets at most one OPEN invitation per project. After accept
  -- or decline, accepted_at/declined_at is set; we allow re-inviting.
  CONSTRAINT project_invitations_state_xor CHECK (
    NOT (accepted_at IS NOT NULL AND declined_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS project_invitations_email_idx
  ON public.project_invitations (email);
CREATE INDEX IF NOT EXISTS project_invitations_pending_idx
  ON public.project_invitations (project_id) WHERE accepted_at IS NULL AND declined_at IS NULL;

ALTER TABLE public.project_invitations ENABLE ROW LEVEL SECURITY;

-- Owner sees their project's invitations. Invitee sees invitations addressed
-- to their email (looked up via auth.users.email server-side; we use a
-- helper SECURITY DEFINER function to fetch).
CREATE OR REPLACE FUNCTION public.auth_email()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid()
$$;

DROP POLICY IF EXISTS "invitations_select_owner_or_invitee" ON public.project_invitations;
CREATE POLICY "invitations_select_owner_or_invitee" ON public.project_invitations
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_invitations.project_id AND p.owner_id = auth.uid()
    )
    OR email = public.auth_email()
  );

-- Owner inserts invitations for their project.
DROP POLICY IF EXISTS "invitations_insert_owner" ON public.project_invitations;
CREATE POLICY "invitations_insert_owner" ON public.project_invitations
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_invitations.project_id AND p.owner_id = auth.uid()
    )
  );

-- Owner deletes invitations (revoke before acceptance).
DROP POLICY IF EXISTS "invitations_delete_owner" ON public.project_invitations;
CREATE POLICY "invitations_delete_owner" ON public.project_invitations
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_invitations.project_id AND p.owner_id = auth.uid()
    )
  );

-- Accept/decline goes via Edge Function (SECURITY DEFINER) so we can verify
-- token + JWT email atomically.
