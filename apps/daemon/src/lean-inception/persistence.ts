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
