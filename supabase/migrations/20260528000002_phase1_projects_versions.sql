-- ============================================================================
-- Phase 1 — Project publish + download.
--
-- Owner publishes a local project: a row in `projects` + the first row in
-- `project_versions` + the v1.zip in Storage. Subsequent publishes (without
-- proposals) bump current_version.
--
-- Phase 1 RLS only knows about owner. Phase 2 introduces project_members and
-- broadens read access to all members.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  current_version INT  NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT projects_name_length CHECK (char_length(name) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS projects_owner_idx ON public.projects (owner_id);

DROP TRIGGER IF EXISTS projects_touch_updated_at ON public.projects;
CREATE TRIGGER projects_touch_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Phase 1: only the owner reads/writes their own projects. Phase 2 replaces
-- the SELECT policy with one that also lets project_members read.
DROP POLICY IF EXISTS "projects_select_owner" ON public.projects;
CREATE POLICY "projects_select_owner" ON public.projects
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "projects_insert_self" ON public.projects;
CREATE POLICY "projects_insert_self" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "projects_update_owner" ON public.projects;
CREATE POLICY "projects_update_owner" ON public.projects
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "projects_delete_owner" ON public.projects;
CREATE POLICY "projects_delete_owner" ON public.projects
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- ============================================================================
-- project_versions: canonical timeline (one row per accepted version).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.project_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version_num   INT  NOT NULL,
  storage_path  TEXT NOT NULL,
  message       TEXT,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  author_id     UUID NOT NULL REFERENCES public.profiles(id),
  proposed_by   UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, version_num),
  CONSTRAINT project_versions_version_positive CHECK (version_num >= 1),
  CONSTRAINT project_versions_size_nonneg     CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS project_versions_project_idx
  ON public.project_versions (project_id, version_num DESC);

ALTER TABLE public.project_versions ENABLE ROW LEVEL SECURITY;

-- Phase 1: only owner reads versions of their own projects.
DROP POLICY IF EXISTS "project_versions_select_owner" ON public.project_versions;
CREATE POLICY "project_versions_select_owner" ON public.project_versions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_versions.project_id AND p.owner_id = auth.uid()
    )
  );

-- Versions are inserted by the daemon during publish; the daemon is acting
-- as the owner (since only the owner can insert into projects in Phase 1).
DROP POLICY IF EXISTS "project_versions_insert_owner" ON public.project_versions;
CREATE POLICY "project_versions_insert_owner" ON public.project_versions
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_versions.project_id AND p.owner_id = auth.uid()
    )
    AND author_id = auth.uid()
  );

-- Versions are immutable after creation (no UPDATE/DELETE). Cascaded on
-- project delete via FK.

-- ============================================================================
-- Storage bucket: projects/{project_id}/v{n}.zip
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('projects', 'projects', FALSE, 104857600)  -- 100 MiB cap (MVP)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

-- Storage RLS: a user can READ object `projects/{project_id}/...` iff they
-- can SELECT the matching projects row (Phase 1 = owner; Phase 2 = members).
DROP POLICY IF EXISTS "projects_storage_read" ON storage.objects;
CREATE POLICY "projects_storage_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  );

-- WRITE: only owner can upload to their project's prefix.
DROP POLICY IF EXISTS "projects_storage_write" ON storage.objects;
CREATE POLICY "projects_storage_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  );

-- No UPDATE / DELETE on storage objects from clients in Phase 1. Objects are
-- write-once; project deletion cascades via DB (manual cleanup via service-role
-- if storage rows linger; tracked as Phase 5 housekeeping).
