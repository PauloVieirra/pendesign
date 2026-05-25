import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  migrateLeanInception,
  upsertInceptionForProject,
  readInceptionState,
  listCardsByDocument,
} from '../../src/lean-inception/persistence.js';
import { extractDocumentForInception } from '../../src/lean-inception/extraction-service.js';
import type { LeanInceptionRuntimeInvoker } from '../../src/lean-inception/runtime-invoke.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateLeanInception(db);
  return db;
}

function tmpStorageRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'li-test-'));
}

const fakeInvoker = (jsonResponse: object): LeanInceptionRuntimeInvoker =>
  async () => ({
    rawStdout: JSON.stringify(jsonResponse),
    durationMs: 100,
    model: 'claude-opus-4-7',
    promptTokens: 500,
    outputTokens: 200,
  });

describe('extractDocumentForInception', () => {
  it('happy path: persists cards with valid anchors, drops invalid ones', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const docContent = '# Project Vision\n\nWe build the best product for analysts.\n\n## Personas\n\n- Senior Analyst Alice';

    const invoker = fakeInvoker({
      cards: [
        {
          column_key: 'vision',
          title: 'Build best product',
          content: 'Macro vision',
          confidence: 'high',
          source_anchor: 'We build the best product for analysts.',
          source_line: 3,
        },
        {
          column_key: 'personas',
          title: 'Senior Analyst Alice',
          content: 'Primary persona',
          confidence: 'medium',
          source_anchor: 'Senior Analyst Alice',
          source_line: 7,
        },
        {
          column_key: 'features',
          title: 'Awesome feature',
          content: 'desc',
          confidence: 'high',
          source_anchor: 'Some feature we do not actually mention.',
          source_line: 99,
        },
      ],
    });

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude',
      invoke: invoker,
      document: {
        filename: 'vision.md',
        mimeType: 'text/markdown',
        content: Buffer.from(docContent),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const cards = listCardsByDocument(db, result.documentId);
    expect(cards).toHaveLength(2);
    expect(cards.map(c => c.column_key).sort()).toEqual(['personas', 'vision']);

    const extRow = db.prepare('SELECT * FROM lean_inception_extractions WHERE document_id = ?').get(result.documentId) as any;
    expect(extRow.status).toBe('succeeded');
    expect(extRow.cards_persisted).toBe(2);
    expect(extRow.cards_dropped).toBe(1);
    expect(extRow.warnings_count).toBe(1);
  });

  it('returns existing document id idempotently when re-ingesting same content', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const docContent = 'L1 content';
    const invoker = fakeInvoker({ cards: [] });

    const a = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'a.md', mimeType: 'text/markdown', content: Buffer.from(docContent) },
    });
    const b = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'a.md', mimeType: 'text/markdown', content: Buffer.from(docContent) },
    });

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.documentId).toBe(b.documentId);

    const docs = db.prepare('SELECT count(*) AS c FROM lean_inception_documents').get() as { c: number };
    expect(docs.c).toBe(1);
  });

  it('rejects documents larger than 500KB', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const big = Buffer.alloc(500 * 1024 + 1, 'x');

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: fakeInvoker({ cards: [] }),
      document: { filename: 'big.md', mimeType: 'text/markdown', content: big },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DOCUMENT_TOO_LARGE');
  });

  it('rejects empty documents', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: fakeInvoker({ cards: [] }),
      document: { filename: 'e.md', mimeType: 'text/markdown', content: Buffer.from('   \n  ') },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY_DOCUMENT');
  });

  it('marks extraction failed when LLM returns invalid JSON', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const invoker: LeanInceptionRuntimeInvoker = async () => ({
      rawStdout: 'I cannot do that.',
      durationMs: 50, model: null, promptTokens: null, outputTokens: null,
    });

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'a.md', mimeType: 'text/markdown', content: Buffer.from('hello') },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_JSON_OUTPUT');
  });

  it('replaces existing doc with same filename but different content', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const invoker = fakeInvoker({ cards: [] });

    const a = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'doc.md', mimeType: 'text/markdown', content: Buffer.from('v1') },
    });
    const b = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'doc.md', mimeType: 'text/markdown', content: Buffer.from('v2') },
    });

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.documentId).not.toBe(b.documentId);

    const docs = db.prepare('SELECT count(*) AS c FROM lean_inception_documents').get() as { c: number };
    expect(docs.c).toBe(1);
  });
});
