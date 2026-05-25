import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

type SqliteDb = Database.Database;

export function migrateLeanInception(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lean_inceptions (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lean_inception_documents (
      id                  TEXT PRIMARY KEY,
      inception_id        TEXT NOT NULL REFERENCES lean_inceptions(id) ON DELETE CASCADE,
      filename            TEXT NOT NULL,
      mime_type           TEXT NOT NULL,
      byte_size           INTEGER NOT NULL,
      content_hash        TEXT NOT NULL,
      storage_path        TEXT NOT NULL,
      ingested_at         TEXT NOT NULL,
      last_extracted_at   TEXT,
      extraction_status   TEXT NOT NULL,
      extraction_error    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_lid_inception ON lean_inception_documents(inception_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lid_hash ON lean_inception_documents(inception_id, content_hash);

    CREATE TABLE IF NOT EXISTS lean_inception_cards (
      id              TEXT PRIMARY KEY,
      inception_id    TEXT NOT NULL REFERENCES lean_inceptions(id) ON DELETE CASCADE,
      document_id     TEXT NOT NULL REFERENCES lean_inception_documents(id) ON DELETE CASCADE,
      column_key      TEXT NOT NULL,
      title           TEXT NOT NULL,
      content         TEXT NOT NULL,
      confidence      TEXT NOT NULL,
      source_anchor   TEXT NOT NULL,
      source_line     INTEGER,
      extraction_id   TEXT NOT NULL,
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lic_doc ON lean_inception_cards(document_id);
    CREATE INDEX IF NOT EXISTS idx_lic_inception_col ON lean_inception_cards(inception_id, column_key);

    CREATE TABLE IF NOT EXISTS lean_inception_extractions (
      id                TEXT PRIMARY KEY,
      inception_id      TEXT NOT NULL REFERENCES lean_inceptions(id) ON DELETE CASCADE,
      document_id       TEXT NOT NULL REFERENCES lean_inception_documents(id) ON DELETE CASCADE,
      runtime           TEXT NOT NULL,
      model             TEXT,
      prompt_version    INTEGER NOT NULL,
      prompt_tokens     INTEGER,
      output_tokens     INTEGER,
      duration_ms       INTEGER,
      warnings_count    INTEGER NOT NULL DEFAULT 0,
      cards_persisted   INTEGER NOT NULL DEFAULT 0,
      cards_dropped     INTEGER NOT NULL DEFAULT 0,
      started_at        TEXT NOT NULL,
      finished_at       TEXT,
      status            TEXT NOT NULL,
      error_message     TEXT
    );
  `);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface InceptionRow {
  id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  inception_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  content_hash: string;
  storage_path: string;
  ingested_at: string;
  last_extracted_at: string | null;
  extraction_status: 'pending' | 'extracting' | 'extracted' | 'failed';
  extraction_error: string | null;
}

export interface InsertDocumentInput {
  inception_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  content_hash: string;
  storage_path: string;
}

function nowIso() { return new Date().toISOString(); }
function newInceptionId() { return `li_${randomUUID().replace(/-/g, '')}`; }
function newDocumentId() { return `doc_${randomUUID().replace(/-/g, '')}`; }

// ---------------------------------------------------------------------------
// Inception CRUD
// ---------------------------------------------------------------------------

export function upsertInceptionForProject(db: SqliteDb, projectId: string): InceptionRow {
  const existing = db.prepare(
    'SELECT * FROM lean_inceptions WHERE project_id = ?'
  ).get(projectId) as InceptionRow | undefined;
  if (existing) return existing;

  const row: InceptionRow = {
    id: newInceptionId(),
    project_id: projectId,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO lean_inceptions (id, project_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(row.id, row.project_id, row.created_at, row.updated_at);
  return row;
}

export function deleteInception(db: SqliteDb, inceptionId: string): boolean {
  const info = db.prepare('DELETE FROM lean_inceptions WHERE id = ?').run(inceptionId);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Document CRUD
// ---------------------------------------------------------------------------

export function insertDocument(db: SqliteDb, input: InsertDocumentInput): DocumentRow {
  const row: DocumentRow = {
    id: newDocumentId(),
    inception_id: input.inception_id,
    filename: input.filename,
    mime_type: input.mime_type,
    byte_size: input.byte_size,
    content_hash: input.content_hash,
    storage_path: input.storage_path,
    ingested_at: nowIso(),
    last_extracted_at: null,
    extraction_status: 'pending',
    extraction_error: null,
  };
  db.prepare(
    `INSERT INTO lean_inception_documents
     (id, inception_id, filename, mime_type, byte_size, content_hash, storage_path,
      ingested_at, last_extracted_at, extraction_status, extraction_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id, row.inception_id, row.filename, row.mime_type, row.byte_size,
    row.content_hash, row.storage_path, row.ingested_at, row.last_extracted_at,
    row.extraction_status, row.extraction_error,
  );
  return row;
}

export function findDocumentByHash(db: SqliteDb, inceptionId: string, contentHash: string): DocumentRow | null {
  const row = db.prepare(
    'SELECT * FROM lean_inception_documents WHERE inception_id = ? AND content_hash = ?'
  ).get(inceptionId, contentHash) as DocumentRow | undefined;
  return row ?? null;
}

export function findDocumentByFilename(db: SqliteDb, inceptionId: string, filename: string): DocumentRow | null {
  const row = db.prepare(
    'SELECT * FROM lean_inception_documents WHERE inception_id = ? AND filename = ? ORDER BY ingested_at DESC LIMIT 1'
  ).get(inceptionId, filename) as DocumentRow | undefined;
  return row ?? null;
}

export function listDocuments(db: SqliteDb, inceptionId: string): DocumentRow[] {
  return db.prepare(
    'SELECT * FROM lean_inception_documents WHERE inception_id = ? ORDER BY ingested_at ASC'
  ).all(inceptionId) as DocumentRow[];
}

export function deleteDocument(db: SqliteDb, documentId: string): boolean {
  const info = db.prepare('DELETE FROM lean_inception_documents WHERE id = ?').run(documentId);
  return info.changes > 0;
}

export function updateDocumentExtractionStatus(
  db: SqliteDb,
  documentId: string,
  status: DocumentRow['extraction_status'],
  errorMessage: string | null = null,
): void {
  db.prepare(
    `UPDATE lean_inception_documents
     SET extraction_status = ?, extraction_error = ?, last_extracted_at = ?
     WHERE id = ?`
  ).run(status, errorMessage, nowIso(), documentId);
}
