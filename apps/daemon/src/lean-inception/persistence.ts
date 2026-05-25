import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { deriveColumnStatus } from './derive-column-status.js';
import {
  LEAN_INCEPTION_COLUMN_KEYS,
  type LeanInceptionColumnKey,
} from './column-keys.js';
import type {
  LeanInceptionCard,
  LeanInceptionDocument,
  LeanInceptionState,
} from '@open-design/contracts';

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

// ---------------------------------------------------------------------------
// Extraction CRUD
// ---------------------------------------------------------------------------

export interface ExtractionRow {
  id: string;
  inception_id: string;
  document_id: string;
  runtime: string;
  model: string | null;
  prompt_version: number;
  prompt_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  warnings_count: number;
  cards_persisted: number;
  cards_dropped: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'succeeded' | 'failed';
  error_message: string | null;
}

function newExtractionId() { return `ext_${randomUUID().replace(/-/g, '')}`; }

export interface InsertExtractionInput {
  inception_id: string;
  document_id: string;
  runtime: string;
  model: string | null;
  prompt_version: number;
}

export function insertExtraction(db: SqliteDb, input: InsertExtractionInput): ExtractionRow {
  const row: ExtractionRow = {
    id: newExtractionId(),
    inception_id: input.inception_id,
    document_id: input.document_id,
    runtime: input.runtime,
    model: input.model,
    prompt_version: input.prompt_version,
    prompt_tokens: null,
    output_tokens: null,
    duration_ms: null,
    warnings_count: 0,
    cards_persisted: 0,
    cards_dropped: 0,
    started_at: nowIso(),
    finished_at: null,
    status: 'running',
    error_message: null,
  };
  db.prepare(
    `INSERT INTO lean_inception_extractions
     (id, inception_id, document_id, runtime, model, prompt_version,
      prompt_tokens, output_tokens, duration_ms, warnings_count,
      cards_persisted, cards_dropped, started_at, finished_at, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id, row.inception_id, row.document_id, row.runtime, row.model, row.prompt_version,
    row.prompt_tokens, row.output_tokens, row.duration_ms, row.warnings_count,
    row.cards_persisted, row.cards_dropped, row.started_at, row.finished_at, row.status, row.error_message,
  );
  return row;
}

export interface FinalizeExtractionInput {
  status: 'succeeded' | 'failed';
  cards_persisted?: number;
  cards_dropped?: number;
  warnings_count?: number;
  duration_ms?: number;
  prompt_tokens?: number | null;
  output_tokens?: number | null;
  error_message?: string | null;
}

export function finalizeExtraction(db: SqliteDb, extractionId: string, input: FinalizeExtractionInput): void {
  db.prepare(
    `UPDATE lean_inception_extractions
     SET status = ?, cards_persisted = COALESCE(?, cards_persisted),
         cards_dropped = COALESCE(?, cards_dropped),
         warnings_count = COALESCE(?, warnings_count),
         duration_ms = COALESCE(?, duration_ms),
         prompt_tokens = COALESCE(?, prompt_tokens),
         output_tokens = COALESCE(?, output_tokens),
         error_message = COALESCE(?, error_message),
         finished_at = ?
     WHERE id = ?`
  ).run(
    input.status,
    input.cards_persisted ?? null,
    input.cards_dropped ?? null,
    input.warnings_count ?? null,
    input.duration_ms ?? null,
    input.prompt_tokens ?? null,
    input.output_tokens ?? null,
    input.error_message ?? null,
    nowIso(),
    extractionId,
  );
}

// ---------------------------------------------------------------------------
// Card CRUD
// ---------------------------------------------------------------------------

export interface CardRow {
  id: string;
  inception_id: string;
  document_id: string;
  column_key: LeanInceptionColumnKey;
  title: string;
  content: string;
  confidence: 'low' | 'medium' | 'high';
  source_anchor: string;
  source_line: number | null;
  extraction_id: string;
  created_at: string;
}

function newCardId() { return `card_${randomUUID().replace(/-/g, '')}`; }

export interface InsertCardInput {
  inception_id: string;
  document_id: string;
  column_key: LeanInceptionColumnKey;
  title: string;
  content: string;
  confidence: 'low' | 'medium' | 'high';
  source_anchor: string;
  source_line: number | null;
  extraction_id: string;
}

export function insertCardsAtomic(db: SqliteDb, cards: readonly InsertCardInput[]): void {
  const stmt = db.prepare(
    `INSERT INTO lean_inception_cards
     (id, inception_id, document_id, column_key, title, content, confidence,
      source_anchor, source_line, extraction_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((rows: readonly InsertCardInput[]) => {
    const ts = nowIso();
    for (const c of rows) {
      stmt.run(
        newCardId(), c.inception_id, c.document_id, c.column_key, c.title, c.content,
        c.confidence, c.source_anchor, c.source_line, c.extraction_id, ts,
      );
    }
  });
  tx(cards);
}

export function listCardsByDocument(db: SqliteDb, documentId: string): CardRow[] {
  return db.prepare(
    'SELECT * FROM lean_inception_cards WHERE document_id = ? ORDER BY created_at ASC'
  ).all(documentId) as CardRow[];
}

export function listCardsByInception(db: SqliteDb, inceptionId: string): CardRow[] {
  return db.prepare(
    'SELECT * FROM lean_inception_cards WHERE inception_id = ? ORDER BY created_at ASC'
  ).all(inceptionId) as CardRow[];
}

// ---------------------------------------------------------------------------
// State reader
// ---------------------------------------------------------------------------

function cardRowToDto(row: CardRow): LeanInceptionCard {
  return {
    id: row.id,
    inception_id: row.inception_id,
    document_id: row.document_id,
    column_key: row.column_key,
    title: row.title,
    content: row.content,
    confidence: row.confidence,
    source_anchor: row.source_anchor,
    source_line: row.source_line,
    extraction_id: row.extraction_id,
    created_at: row.created_at,
  };
}

function docRowToDto(row: DocumentRow, cardCount: number): LeanInceptionDocument {
  return {
    id: row.id,
    inception_id: row.inception_id,
    filename: row.filename,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    content_hash: row.content_hash,
    ingested_at: row.ingested_at,
    last_extracted_at: row.last_extracted_at,
    extraction_status: row.extraction_status,
    extraction_error: row.extraction_error,
    card_count: cardCount,
  };
}

export function readInceptionState(db: SqliteDb, inceptionId: string): LeanInceptionState {
  const inception = db.prepare(
    'SELECT * FROM lean_inceptions WHERE id = ?'
  ).get(inceptionId) as InceptionRow | undefined;
  if (!inception) {
    throw new Error(`inception not found: ${inceptionId}`);
  }

  const docs = listDocuments(db, inceptionId);
  const cardCounts = db.prepare(
    'SELECT document_id, COUNT(*) AS c FROM lean_inception_cards WHERE inception_id = ? GROUP BY document_id'
  ).all(inceptionId) as Array<{ document_id: string; c: number }>;
  const countByDoc = new Map(cardCounts.map(r => [r.document_id, r.c]));

  const cards = listCardsByInception(db, inceptionId);
  const cardsByColumn = new Map<LeanInceptionColumnKey, CardRow[]>();
  for (const key of LEAN_INCEPTION_COLUMN_KEYS) cardsByColumn.set(key, []);
  for (const c of cards) cardsByColumn.get(c.column_key)?.push(c);

  const columns = {} as LeanInceptionState['columns'];
  for (const key of LEAN_INCEPTION_COLUMN_KEYS) {
    const colCards = cardsByColumn.get(key) ?? [];
    columns[key] = {
      status: deriveColumnStatus(colCards),
      cards: colCards.map(cardRowToDto),
    };
  }

  return {
    inception_id: inception.id,
    project_id: inception.project_id,
    documents: docs.map(d => docRowToDto(d, countByDoc.get(d.id) ?? 0)),
    columns,
  };
}
