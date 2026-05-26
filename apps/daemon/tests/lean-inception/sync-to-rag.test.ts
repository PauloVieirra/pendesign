import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  migrateLeanInception,
  upsertInceptionForProject,
  insertDocument,
  insertExtraction,
  insertCardsAtomic,
} from '../../src/lean-inception/persistence.js';
import { registerLeanInceptionRoutes } from '../../src/lean-inception-routes.js';
import { buildInceptionMarkdown } from '../../src/lean-inception/sync-to-rag.js';
import type { LeanInceptionRuntimeInvoker } from '../../src/lean-inception/runtime-invoke.js';

function setupDb(): { db: Database.Database; inceptionId: string } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // project_docs table (from db.ts openDatabase migration) — replicated for
  // in-memory test isolation without needing to boot the full daemon.
  db.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY);`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_docs (
      id             TEXT PRIMARY KEY,
      project_id     TEXT NOT NULL,
      doc_id         TEXT NOT NULL,
      doc_name       TEXT NOT NULL,
      chunk_idx      INTEGER NOT NULL,
      content        TEXT NOT NULL,
      embedding_json TEXT,
      embedding_model TEXT,
      created_at     INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_docs_project
      ON project_docs(project_id, doc_id, chunk_idx);
  `);
  migrateLeanInception(db);
  db.prepare('INSERT INTO projects (id) VALUES (?)').run('prj_1');
  const inception = upsertInceptionForProject(db, 'prj_1');
  const doc = insertDocument(db, {
    inception_id: inception.id,
    filename: 'a.md',
    mime_type: 'text/markdown',
    byte_size: 10,
    content_hash: 'h',
    storage_path: 'x',
  });
  const ext = insertExtraction(db, {
    inception_id: inception.id,
    document_id: doc.id,
    runtime: 'claude',
    model: null,
    prompt_version: 1,
  });
  insertCardsAtomic(db, [
    {
      inception_id: inception.id,
      document_id: doc.id,
      column_key: 'vision',
      title: 'Vision A',
      content: 'macro purpose',
      confidence: 'high',
      source_anchor: 'src',
      source_line: 1,
      extraction_id: ext.id,
    },
    {
      inception_id: inception.id,
      document_id: doc.id,
      column_key: 'personas',
      title: 'Owner-operator',
      content: 'small bookshop owner',
      confidence: 'high',
      source_anchor: 'src',
      source_line: 2,
      extraction_id: ext.id,
    },
  ]);
  return { db, inceptionId: inception.id };
}

const stubInvoker: LeanInceptionRuntimeInvoker = async () => ({
  rawStdout: '{"cards":[]}',
  durationMs: 0,
  model: null,
  promptTokens: null,
  outputTokens: null,
});

async function startServer(
  db: Database.Database,
): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  registerLeanInceptionRoutes(app, {
    db,
    storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-rag-')),
    runtimeInvoker: stubInvoker,
    defaultRuntime: 'claude',
  });
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const srv = app.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => srv.close() });
    });
  });
}

describe('POST /api/projects/:id/lean-inception/sync-to-rag', () => {
  it('writes chunks to project_docs and returns a result summary', async () => {
    const { db } = setupDb();
    const server = await startServer(db);
    try {
      const r = await fetch(
        `${server.url}/api/projects/prj_1/lean-inception/sync-to-rag`,
        { method: 'POST' },
      );
      expect(r.status).toBe(200);
      const body = (await r.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.result.chunkCount).toBeGreaterThan(0);
      expect(body.result.charsIngested).toBeGreaterThan(0);
      const chunks = db
        .prepare(
          'SELECT count(*) AS c FROM project_docs WHERE project_id = ?',
        )
        .get('prj_1') as { c: number };
      expect(chunks.c).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  it('is idempotent — re-running replaces previous chunks for the synthetic doc name', async () => {
    const { db } = setupDb();
    const server = await startServer(db);
    try {
      await fetch(
        `${server.url}/api/projects/prj_1/lean-inception/sync-to-rag`,
        { method: 'POST' },
      );
      await fetch(
        `${server.url}/api/projects/prj_1/lean-inception/sync-to-rag`,
        { method: 'POST' },
      );

      const summaryChunks = db
        .prepare(
          "SELECT count(*) AS c FROM project_docs WHERE project_id = ? AND doc_name = '__lean-inception-summary__.md'",
        )
        .get('prj_1') as { c: number };

      const docIds = db
        .prepare(
          "SELECT DISTINCT doc_id FROM project_docs WHERE project_id = ? AND doc_name = '__lean-inception-summary__.md'",
        )
        .all('prj_1') as Array<{ doc_id: string }>;

      // After two runs, only ONE doc_id worth of chunks should exist (the latest).
      expect(docIds).toHaveLength(1);
      expect(summaryChunks.c).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });
});

describe('buildInceptionMarkdown', () => {
  it('skips empty columns and includes documents section', () => {
    const md = buildInceptionMarkdown({
      inception_id: 'li_1',
      project_id: 'prj_1',
      documents: [
        {
          id: 'd1',
          inception_id: 'li_1',
          filename: 'a.md',
          mime_type: 'text/markdown',
          byte_size: 1,
          content_hash: 'h',
          ingested_at: 't',
          last_extracted_at: 't',
          extraction_status: 'extracted',
          extraction_error: null,
          card_count: 2,
        },
      ],
      columns: {
        vision: {
          status: 'partial',
          cards: [
            {
              id: 'c1',
              inception_id: 'li_1',
              document_id: 'd1',
              column_key: 'vision',
              title: 'Vision X',
              content: 'desc',
              confidence: 'high',
              source_anchor: 's',
              source_line: 1,
              extraction_id: 'e1',
              created_at: 't',
            },
          ],
        },
        problem:              { status: 'not_identified', cards: [] },
        objective:            { status: 'not_identified', cards: [] },
        csd_matrix:           { status: 'not_identified', cards: [] },
        market_research:      { status: 'not_identified', cards: [] },
        market_opportunities: { status: 'not_identified', cards: [] },
        personas:             { status: 'not_identified', cards: [] },
        user_journey:         { status: 'not_identified', cards: [] },
        features:             { status: 'not_identified', cards: [] },
        business_rules:       { status: 'not_identified', cards: [] },
        ideation:             { status: 'not_identified', cards: [] },
        acceptance_criteria:  { status: 'not_identified', cards: [] },
      } as any,
    });
    expect(md).toContain('# Lean Inception');
    expect(md).toContain('## Visão');
    expect(md).toContain('Vision X');
    expect(md).not.toContain('## Problema'); // empty column skipped
    expect(md).toContain('## Documentos fonte');
    expect(md).toContain('a.md');
  });
});
