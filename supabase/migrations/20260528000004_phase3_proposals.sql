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
-- Helper: detect stale proposals on insert.
-- ============================================================================

-- When inserting a proposal, the daemon should pass current base_version.
-- If the value diverges from the project's current_version, the proposal is
-- still inserted (with status='pending') but a trigger can mark it stale
-- right away — saving a round-trip. For simplicity, the Edge Function /
-- daemon will check before INSERT instead.
