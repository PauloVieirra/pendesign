// SQLite-backed local tracker for cloud-enabled projects.
//
// Each row mirrors a backend `projects` row that this user is a member of.
// `base_version` records what local snapshot we last extracted; `local_dirty`
// is reserved for Phase 3 (proposal submission) and stays 0 in Phase 1.

import type { Database } from 'better-sqlite3';

export interface CloudProjectRow {
  projectId: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  baseVersion: number | null;
  pendingProposalId: string | null;
  localDirty: boolean;
  lastSyncAt: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS cloud_projects (
    project_id          TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    role                TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
    base_version        INTEGER,
    pending_proposal_id TEXT,
    local_dirty         INTEGER NOT NULL DEFAULT 0,
    last_sync_at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cloud_projects_role_idx ON cloud_projects (role);
`;

let schemaReady = new WeakSet<Database>();

export function ensureCloudProjectsSchema(db: Database): void {
  if (schemaReady.has(db)) return;
  db.exec(SCHEMA);
  schemaReady.add(db);
}

interface SqliteRow {
  project_id: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  base_version: number | null;
  pending_proposal_id: string | null;
  local_dirty: number;
  last_sync_at: number;
}

function rowFromSqlite(r: SqliteRow): CloudProjectRow {
  return {
    projectId: r.project_id,
    name: r.name,
    role: r.role,
    baseVersion: r.base_version,
    pendingProposalId: r.pending_proposal_id,
    localDirty: r.local_dirty !== 0,
    lastSyncAt: r.last_sync_at,
  };
}

export function listCloudProjects(db: Database): CloudProjectRow[] {
  ensureCloudProjectsSchema(db);
  const rows = db
    .prepare(
      'SELECT project_id, name, role, base_version, pending_proposal_id, local_dirty, last_sync_at FROM cloud_projects ORDER BY last_sync_at DESC',
    )
    .all() as SqliteRow[];
  return rows.map(rowFromSqlite);
}

export function getCloudProject(db: Database, projectId: string): CloudProjectRow | null {
  ensureCloudProjectsSchema(db);
  const row = db
    .prepare(
      'SELECT project_id, name, role, base_version, pending_proposal_id, local_dirty, last_sync_at FROM cloud_projects WHERE project_id = ?',
    )
    .get(projectId) as SqliteRow | undefined;
  return row ? rowFromSqlite(row) : null;
}

export function upsertCloudProject(db: Database, row: CloudProjectRow): void {
  ensureCloudProjectsSchema(db);
  if (!row.projectId || !row.name || !row.role) {
    throw new Error('upsertCloudProject: incomplete row');
  }
  db.prepare(
    `INSERT INTO cloud_projects
       (project_id, name, role, base_version, pending_proposal_id, local_dirty, last_sync_at)
     VALUES
       (@project_id, @name, @role, @base_version, @pending_proposal_id, @local_dirty, @last_sync_at)
     ON CONFLICT(project_id) DO UPDATE SET
       name                = excluded.name,
       role                = excluded.role,
       base_version        = excluded.base_version,
       pending_proposal_id = excluded.pending_proposal_id,
       local_dirty         = excluded.local_dirty,
       last_sync_at        = excluded.last_sync_at`,
  ).run({
    project_id: row.projectId,
    name: row.name,
    role: row.role,
    base_version: row.baseVersion,
    pending_proposal_id: row.pendingProposalId,
    local_dirty: row.localDirty ? 1 : 0,
    last_sync_at: row.lastSyncAt,
  });
}

export function removeCloudProject(db: Database, projectId: string): void {
  ensureCloudProjectsSchema(db);
  db.prepare('DELETE FROM cloud_projects WHERE project_id = ?').run(projectId);
}

export function _resetSchemaCacheForTests(): void {
  schemaReady = new WeakSet<Database>();
}
