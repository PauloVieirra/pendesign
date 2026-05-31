# Phase 1 — Project publish + download (detailed spec)

Status: Approved (autonomous execution). Parent: `2026-05-28-multi-user-supabase-design.md`.
Owner: paulo.junior@seatecnologia.com.br
Date: 2026-05-28
Depends on: Phase 0 (auth).

## Goal

The signed-in owner can publish a local project to the cloud and download it again — including from a different machine signed in with the same account. Each publish becomes a new canonical version. Phase 1 has only the owner; sharing arrives in Phase 2.

## File structure

```
apps/daemon/src/cloud/
├── (existing Phase 0 files)
├── cloud-projects.ts        — local SQLite cloud_projects table (CRUD + migration)
├── cloud-projects-fs.ts     — zip / unzip a project directory tree
├── cloud-projects-routes.ts — /api/cloud/projects/* routes
└── cloud-supabase.ts        — small helper that returns an authenticated Supabase client given current session

apps/daemon/tests/cloud/
├── cloud-projects.test.ts
├── cloud-projects-fs.test.ts
└── cloud-projects-routes.test.ts
```

## HTTP surface

```
GET    /api/cloud/projects                              → [{id, name, role, current_version, updated_at, base_version, local_dirty}]
POST   /api/cloud/projects/publish     { local_project_id, name?, message? } → 200 { project }
GET    /api/cloud/projects/:id                          → { project, current_version, my_role }
GET    /api/cloud/projects/:id/versions                 → [{version_num, message, size_bytes, author, proposed_by?, created_at}]
POST   /api/cloud/projects/:id/open                     → 200 { local_path, base_version }
DELETE /api/cloud/projects/:id                          → 204 (owner only)
POST   /api/cloud/projects/:id/refresh                  → 200 { current_version, base_version, downloaded: boolean }
```

`publish`: takes a local project id (an existing entry in the daemon's project store), zips `.od/projects/<id>/`, uploads to `projects/<cloud_project_id>/v1.zip`, inserts `projects` + `project_versions` rows. Returns the new cloud project metadata.

`open`: downloads `current_version`'s zip, unzips to `.od/cloud-projects/<id>/`, marks `base_version` in local SQLite. Idempotent — re-opens just re-extract.

`refresh`: pulls latest version metadata; if `current_version` > `base_version`, downloads and extracts (replacing local copy). Future enhancement could warn on local dirty state.

## Local data — `cloud_projects` SQLite table

```sql
CREATE TABLE IF NOT EXISTS cloud_projects (
  project_id           TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  base_version         INTEGER,           -- null until first open/publish
  pending_proposal_id  TEXT,
  local_dirty          INTEGER NOT NULL DEFAULT 0,
  last_sync_at         INTEGER NOT NULL
);
```

`local_dirty` is a forward-looking field for Phase 3 (proposal submission). Phase 1 leaves it at 0; daemon will compute on demand in Phase 3.

## Storage path conventions

Local copy of a cloud project lives in `.od/cloud-projects/<cloud_project_id>/`. Distinct from `.od/projects/<id>/` (local-only projects) so accidental publish-overwrite is impossible.

Daemon's `RUNTIME_DATA_DIR` resolves to `.od` (or `OD_DATA_DIR` override). Cloud projects dir = `<RUNTIME_DATA_DIR>/cloud-projects`.

## Zip/unzip behavior

- Zip uses `jszip` (already common in JS ecosystem; we'll add it to daemon dependencies).
- File entries are stored relative to the project root.
- Skip OS junk (`.DS_Store`, `Thumbs.db`) and the daemon's own scratch (`.od-scratch/`, `node_modules/` if present in a project dir).
- Max upload size: 100 MiB enforced both by daemon (pre-flight check) and Supabase Storage bucket policy. If size exceeds, return 413 with a clear error.
- Compression: deflate level 6 (balance speed vs size).

Unzip: validates every entry path stays within the target directory (defense against zip-slip), strips top-level wrapper folder if zip was built with one.

## Component responsibilities

### cloud-projects.ts
Local SQLite CRUD. API mirrors cloud-session.ts:
```typescript
export interface CloudProjectRow {
  projectId: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  baseVersion: number | null;
  pendingProposalId: string | null;
  localDirty: boolean;
  lastSyncAt: number;
}

export function ensureCloudProjectsSchema(db): void;
export function listCloudProjects(db): CloudProjectRow[];
export function getCloudProject(db, projectId): CloudProjectRow | null;
export function upsertCloudProject(db, row: CloudProjectRow): void;
export function removeCloudProject(db, projectId): void;
```

### cloud-projects-fs.ts
Pure functions for zip/unzip:
```typescript
export async function zipProjectDirectory(srcDir: string, opts?: {ignore?: string[]}): Promise<Uint8Array>;
export async function unzipToDirectory(zip: Uint8Array, destDir: string): Promise<{filesWritten: number; totalSize: number}>;
```

Tests use a temp dir + a few sample files to verify round-trip integrity.

### cloud-supabase.ts
Helper that returns a Supabase client bound to the daemon's current session. Re-uses `CloudClient.ensureFreshAccessToken` to keep the token fresh.

### cloud-projects-routes.ts
The handlers. Each route:
1. Same-origin check.
2. Cloud config check (`cloud_not_configured`).
3. Session check (`not_signed_in`).
4. Optional `local_project_id` validation (for publish).
5. Call Supabase via service-role-free flow (anon key + JWT). Server-side RLS enforces ownership.
6. Update local `cloud_projects` table on success.

## CLI surface

```
od cloud projects list [--json]
od cloud publish <local-project-id> [--name <n>] [--message <m>] [--json]
od cloud open <cloud-project-id> [--json]
od cloud delete <cloud-project-id> [--json]
od cloud refresh <cloud-project-id> [--json]
od cloud versions <cloud-project-id> [--json]
```

## UI surface (minimal)

A `CloudProjectsList` component that renders the list of cloud projects (calls `GET /api/cloud/projects`), with action buttons:
- "Open" → triggers `POST /api/cloud/projects/:id/open`
- "Publish current" → on a local project, calls `POST /api/cloud/projects/publish`

Full polish (loading states, sync indicators, conflict resolution UI) belongs to follow-up commits.

## Tests

### Unit
- `cloud-projects.test.ts`: SQLite CRUD round-trip, schema idempotency.
- `cloud-projects-fs.test.ts`: zip + unzip round-trip preserves files; rejects zip-slip; skips ignored entries.
- `cloud-projects-routes.test.ts`: each route's happy + error path with stubbed Supabase client.

### Integration (manual)
- Apply schema. Sign in (Phase 0).
- `od cloud publish my-project` → succeeds; `od cloud projects list` shows it.
- Delete local copy. `od cloud open <id>` re-downloads.

## Acceptance criteria

1. Daemon tests pass (Phase 0 + new Phase 1 specs).
2. With cloud unset: routes 503 cleanly.
3. With cloud configured: `od cloud publish ./somepath` uploads + creates DB rows; downloadable from another fresh local data dir.
4. UI list renders projects when signed in.

## Out of scope (deferred)

- Conflict on republish (owner publishes again while editor has a pending proposal) — Phase 3 handles via stale proposals; Phase 1 just allows the owner to push freely.
- Project rename — easy follow-up via PATCH `/projects/:id`.
- Hide project from list without delete — Phase 5.
- Auto-pull on file changes — purely manual `refresh`.
