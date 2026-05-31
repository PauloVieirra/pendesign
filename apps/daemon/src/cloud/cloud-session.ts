// SQLite-backed singleton session row.
//
// Only one cloud account at a time. The row's id is hard-coded to 1 (CHECK
// constraint) so accidental multi-insert is impossible. Callers are expected
// to pass a better-sqlite3 Database (the daemon's `db` ServerContext field).

import type { Database } from 'better-sqlite3';

export interface CloudSessionRow {
  userId: string;
  email: string;
  name: string;
  accessToken: string;
  refreshToken: string;
  /** unix ms when the access token expires */
  expiresAt: number;
}

interface CloudSessionRowSqlite {
  user_id: string;
  email: string;
  name: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  updated_at: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS cloud_session (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    user_id       TEXT NOT NULL,
    email         TEXT NOT NULL,
    name          TEXT NOT NULL,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
`;

let schemaReady = new WeakSet<Database>();

export function ensureCloudSessionSchema(db: Database): void {
  if (schemaReady.has(db)) return;
  db.exec(SCHEMA);
  schemaReady.add(db);
}

export function getCloudSession(db: Database): CloudSessionRow | null {
  ensureCloudSessionSchema(db);
  const row = db
    .prepare(
      'SELECT user_id, email, name, access_token, refresh_token, expires_at FROM cloud_session WHERE id = 1',
    )
    .get() as Omit<CloudSessionRowSqlite, 'updated_at'> | undefined;
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
  };
}

export function saveCloudSession(db: Database, session: CloudSessionRow): void {
  ensureCloudSessionSchema(db);
  if (!session.userId || !session.email || !session.accessToken || !session.refreshToken) {
    throw new Error('saveCloudSession: incomplete session row');
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO cloud_session
       (id, user_id, email, name, access_token, refresh_token, expires_at, updated_at)
     VALUES
       (1, @user_id, @email, @name, @access_token, @refresh_token, @expires_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       user_id       = excluded.user_id,
       email         = excluded.email,
       name          = excluded.name,
       access_token  = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at    = excluded.expires_at,
       updated_at    = excluded.updated_at`,
  ).run({
    user_id: session.userId,
    email: session.email,
    name: session.name,
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_at: session.expiresAt,
    updated_at: now,
  });
}

export function clearCloudSession(db: Database): void {
  ensureCloudSessionSchema(db);
  db.prepare('DELETE FROM cloud_session WHERE id = 1').run();
}

// Test helper: reset the per-db "schema applied" memoization.
export function _resetSchemaCacheForTests(): void {
  schemaReady = new WeakSet<Database>();
}
