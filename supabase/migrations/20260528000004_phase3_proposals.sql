-- ============================================================================
-- Phase 3 — Change proposals (PR-style review workflow).
--
-- Editor submits a proposal: a payload.zip in Storage + a row in
-- change_proposals. Owner reviews, approves (Edge Function applies payload
-- onto base_version snapshot, creates new version) or rejects.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.change_proposals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  submitter_id      UUID NOT NULL REFERENCES public.profiles(id),
  base_version      INT  NOT NULL,
  storage_path      TEXT NOT NULL,
  message           TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'stale')),
  reviewed_by       UUID REFERENCES public.profiles(id),
  reviewer_message  TEXT,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT change_proposals_review_consistency CHECK (
    (status IN ('pending', 'stale') AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS change_proposals_project_idx
  ON public.change_proposals (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS change_proposals_pending_idx
  ON public.change_proposals (project_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS change_proposals_submitter_idx
  ON public.change_proposals (submitter_id, created_at DESC);

ALTER TABLE public.change_proposals ENABLE ROW LEVEL SECURITY;

-- Members of the project can read proposals on that project.
DROP POLICY IF EXISTS "change_proposals_select_member" ON public.change_proposals;
CREATE POLICY "change_proposals_select_member" ON public.change_proposals
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = change_proposals.project_id AND m.user_id = auth.uid()
    )
  );

-- Editors (and owners) can INSERT proposals against their project.
DROP POLICY IF EXISTS "change_proposals_insert_editor" ON public.change_proposals;
CREATE POLICY "change_proposals_insert_editor" ON public.change_proposals
  FOR INSERT TO authenticated WITH CHECK (
    submitter_id = auth.uid()
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = change_proposals.project_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'editor')
    )
  );

-- UPDATE/DELETE happens via Edge Function (approve-proposal) using service-role.
-- No UPDATE/DELETE policies for authenticated users.

-- ============================================================================
-- Storage bucket: proposals/{proposal_id}/payload.zip
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('proposals', 'proposals', FALSE, 104857600)  -- 100 MiB cap
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

-- READ: project members.
DROP POLICY IF EXISTS "proposals_storage_read" ON storage.objects;
CREATE POLICY "proposals_storage_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'proposals'
    AND EXISTS (
      SELECT 1 FROM public.change_proposals cp
      JOIN public.project_members m ON m.project_id = cp.project_id
      WHERE cp.id::text = (storage.foldername(name))[1]
        AND m.user_id = auth.uid()
    )
  );

-- WRITE: editors (and owners) upload payloads to proposals/{their-proposal-id}/.
-- The proposal row must already exist with the submitter matching the user.
DROP POLICY IF EXISTS "proposals_storage_write" ON storage.objects;
CREATE POLICY "proposals_storage_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'proposals'
    AND EXISTS (
      SELECT 1 FROM public.change_proposals cp
      WHERE cp.id::text = (storage.foldername(name))[1]
        AND cp.submitter_id = auth.uid()
        AND cp.status = 'pending'
    )
  );

-- ============================================================================
-- RPC: approve_proposal_commit — atomic DB side of approve.
--
-- The Edge Function downloads + merges + uploads the new zip first, then calls
-- this function to commit the DB changes (insert new version, advance
-- current_version, mark proposal approved, mark other pendings stale). All in
-- one transaction.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_proposal_commit(
  p_proposal_id      UUID,
  p_reviewer_message TEXT,
  p_storage_path     TEXT,
  p_size_bytes       BIGINT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  proposal_row public.change_proposals%ROWTYPE;
  current_ver  INT;
  new_ver      INT;
  caller_id    UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO proposal_row
    FROM public.change_proposals
   WHERE id = p_proposal_id
   FOR UPDATE;

  IF proposal_row.id IS NULL THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;
  IF proposal_row.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal_not_pending (status=%)', proposal_row.status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = proposal_row.project_id AND p.owner_id = caller_id
  ) THEN
    RAISE EXCEPTION 'forbidden_not_owner';
  END IF;

  SELECT current_version INTO current_ver
    FROM public.projects
   WHERE id = proposal_row.project_id
   FOR UPDATE;

  IF proposal_row.base_version <> current_ver THEN
    UPDATE public.change_proposals
       SET status = 'stale',
           reviewed_at = NOW(),
           reviewed_by = caller_id,
           reviewer_message = COALESCE(p_reviewer_message, 'Base version stale')
     WHERE id = p_proposal_id;
    RAISE EXCEPTION 'stale_base_version (proposal=%, current=%)',
      proposal_row.base_version, current_ver;
  END IF;

  new_ver := current_ver + 1;

  INSERT INTO public.project_versions
    (project_id, version_num, storage_path, message, size_bytes, author_id, proposed_by)
  VALUES
    (proposal_row.project_id,
     new_ver,
     p_storage_path,
     COALESCE(p_reviewer_message, proposal_row.message),
     COALESCE(p_size_bytes, 0),
     caller_id,
     proposal_row.submitter_id);

  UPDATE public.projects
     SET current_version = new_ver
   WHERE id = proposal_row.project_id;

  UPDATE public.change_proposals
     SET status = 'approved',
         reviewed_at = NOW(),
         reviewed_by = caller_id,
         reviewer_message = p_reviewer_message
   WHERE id = p_proposal_id;

  -- Any other pending proposals on this project are now behind the new
  -- current_version → mark them stale so submitters know to rebase.
  UPDATE public.change_proposals
     SET status = 'stale'
   WHERE project_id = proposal_row.project_id
     AND status = 'pending'
     AND id <> p_proposal_id;

  RETURN new_ver;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_proposal_commit(UUID, TEXT, TEXT, BIGINT) TO authenticated;

-- ============================================================================
-- RPC: reject_proposal — simple UPDATE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reject_proposal(
  p_proposal_id      UUID,
  p_reviewer_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  proposal_row public.change_proposals%ROWTYPE;
  caller_id    UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO proposal_row FROM public.change_proposals WHERE id = p_proposal_id;
  IF proposal_row.id IS NULL THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
  IF proposal_row.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal_not_pending (status=%)', proposal_row.status;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = proposal_row.project_id AND p.owner_id = caller_id
  ) THEN
    RAISE EXCEPTION 'forbidden_not_owner';
  END IF;

  UPDATE public.change_proposals
     SET status = 'rejected',
         reviewed_at = NOW(),
         reviewed_by = caller_id,
         reviewer_message = p_reviewer_message
   WHERE id = p_proposal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_proposal(UUID, TEXT) TO authenticated;

-- ============================================================================
-- RPC: submit_proposal_prepare — pre-flight validation before upload.
--
-- The daemon calls this BEFORE uploading the payload zip. It checks the
-- editor's base_version matches current_version. If it doesn't, the daemon
-- can warn the user without wasting an upload.
--
-- This returns the proposal id that the daemon will use as the storage path
-- prefix. The actual INSERT happens after upload via the normal RLS-checked
-- INSERT policy (so the daemon can use anon key + JWT, no service role).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_proposal_prepare(p_project_id UUID, p_base_version INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id   UUID := auth.uid();
  current_ver INT;
  role_check  TEXT;
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT m.role INTO role_check
    FROM public.project_members m
   WHERE m.project_id = p_project_id AND m.user_id = caller_id;

  IF role_check IS NULL THEN RAISE EXCEPTION 'forbidden_not_member'; END IF;
  IF role_check NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'forbidden_viewer_cannot_propose';
  END IF;

  SELECT current_version INTO current_ver FROM public.projects WHERE id = p_project_id;
  IF current_ver IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  IF p_base_version <> current_ver THEN
    RETURN jsonb_build_object(
      'stale', TRUE,
      'current_version', current_ver,
      'your_base_version', p_base_version
    );
  END IF;

  RETURN jsonb_build_object(
    'stale', FALSE,
    'current_version', current_ver
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_proposal_prepare(UUID, INT) TO authenticated;
