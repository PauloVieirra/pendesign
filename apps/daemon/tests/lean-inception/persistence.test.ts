import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  migrateLeanInception,
  upsertInceptionForProject,
  insertDocument,
  findDocumentByHash,
  findDocumentByFilename,
  listDocuments,
  deleteDocument,
  deleteInception,
  insertExtraction,
  finalizeExtraction,
  insertCardsAtomic,
  listCardsByInception,
  listCardsByDocument,
  readInceptionState,
} from '../../src/lean-inception/persistence.js';

describe('migrateLeanInception', () => {
  it('creates all 4 tables', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lean_inception%'`
    ).all() as Array<{ name: string }>;

    const names = tables.map(t => t.name).sort();
    expect(names).toEqual([
      'lean_inception_cards',
      'lean_inception_documents',
      'lean_inception_extractions',
      'lean_inceptions',
    ]);
  });

  it('is idempotent (can run twice)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    expect(() => migrateLeanInception(db)).not.toThrow();
  });

  it('creates expected indexes', () => {
    const db = new Database(':memory:');
    migrateLeanInception(db);
    const indexes = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_li%'`
    ).all() as Array<{ name: string }>;
    const names = indexes.map(i => i.name).sort();
    expect(names).toContain('idx_lid_inception');
    expect(names).toContain('idx_lid_hash');
    expect(names).toContain('idx_lic_doc');
    expect(names).toContain('idx_lic_inception_col');
  });
});

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateLeanInception(db);
  return db;
}

describe('upsertInceptionForProject', () => {
  it('creates row when project has no inception', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    expect(inception.id).toMatch(/^li_/);
    expect(inception.project_id).toBe('prj_1');
  });

  it('returns existing row on second call', () => {
    const db = freshDb();
    const a = upsertInceptionForProject(db, 'prj_1');
    const b = upsertInceptionForProject(db, 'prj_1');
    expect(b.id).toBe(a.id);
  });
});

describe('document CRUD', () => {
  it('inserts and finds by hash', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const doc = insertDocument(db, {
      inception_id: inception.id,
      filename: 'a.md',
      mime_type: 'text/markdown',
      byte_size: 12,
      content_hash: 'h1',
      storage_path: 'projects/prj_1/lean-inception/docs/d1.md',
    });
    expect(doc.id).toMatch(/^doc_/);
    expect(doc.extraction_status).toBe('pending');

    const found = findDocumentByHash(db, inception.id, 'h1');
    expect(found?.id).toBe(doc.id);
  });

  it('findDocumentByFilename returns the doc when filename matches', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    insertDocument(db, {
      inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown',
      byte_size: 12, content_hash: 'h1', storage_path: 'x',
    });
    expect(findDocumentByFilename(db, inception.id, 'a.md')?.filename).toBe('a.md');
    expect(findDocumentByFilename(db, inception.id, 'b.md')).toBeNull();
  });

  it('listDocuments returns all docs for inception ordered by ingested_at', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    insertDocument(db, { inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown', byte_size: 1, content_hash: 'h1', storage_path: 'x' });
    insertDocument(db, { inception_id: inception.id, filename: 'b.md', mime_type: 'text/markdown', byte_size: 1, content_hash: 'h2', storage_path: 'y' });
    const docs = listDocuments(db, inception.id);
    expect(docs.map(d => d.filename)).toEqual(['a.md', 'b.md']);
  });

  it('deleteDocument removes the doc and (via cascade) its cards', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const doc = insertDocument(db, {
      inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown',
      byte_size: 1, content_hash: 'h1', storage_path: 'x',
    });
    expect(deleteDocument(db, doc.id)).toBe(true);
    expect(listDocuments(db, inception.id)).toHaveLength(0);
  });

  it('deleteInception cascades to docs', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    insertDocument(db, { inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown', byte_size: 1, content_hash: 'h1', storage_path: 'x' });
    expect(deleteInception(db, inception.id)).toBe(true);
    expect(db.prepare('SELECT count(*) AS c FROM lean_inception_documents').get()).toEqual({ c: 0 });
  });
});

describe('extraction + cards + state', () => {
  it('inserts an extraction with running status, then finalizes it', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const doc = insertDocument(db, {
      inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown',
      byte_size: 1, content_hash: 'h1', storage_path: 'x',
    });
    const ext = insertExtraction(db, {
      inception_id: inception.id,
      document_id: doc.id,
      runtime: 'claude',
      model: 'claude-opus-4-7',
      prompt_version: 1,
    });
    expect(ext.status).toBe('running');

    finalizeExtraction(db, ext.id, {
      status: 'succeeded',
      cards_persisted: 3,
      cards_dropped: 1,
      warnings_count: 1,
      duration_ms: 1234,
      prompt_tokens: 100,
      output_tokens: 50,
    });

    const reread = db.prepare('SELECT * FROM lean_inception_extractions WHERE id = ?').get(ext.id) as any;
    expect(reread.status).toBe('succeeded');
    expect(reread.cards_persisted).toBe(3);
  });

  it('insertCardsAtomic persists all cards in a single transaction', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const doc = insertDocument(db, { inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown', byte_size: 1, content_hash: 'h1', storage_path: 'x' });
    const ext = insertExtraction(db, { inception_id: inception.id, document_id: doc.id, runtime: 'claude', model: null, prompt_version: 1 });

    insertCardsAtomic(db, [
      { inception_id: inception.id, document_id: doc.id, column_key: 'vision', title: 'Vision A', content: 'desc', confidence: 'high', source_anchor: 'a', source_line: 1, extraction_id: ext.id },
      { inception_id: inception.id, document_id: doc.id, column_key: 'personas', title: 'Persona A', content: 'desc', confidence: 'medium', source_anchor: 'b', source_line: 2, extraction_id: ext.id },
    ]);

    expect(listCardsByDocument(db, doc.id)).toHaveLength(2);
    expect(listCardsByInception(db, inception.id)).toHaveLength(2);
  });

  it('readInceptionState returns documents + columns with derived statuses', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const doc = insertDocument(db, { inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown', byte_size: 1, content_hash: 'h1', storage_path: 'x' });
    const ext = insertExtraction(db, { inception_id: inception.id, document_id: doc.id, runtime: 'claude', model: null, prompt_version: 1 });
    insertCardsAtomic(db, [
      { inception_id: inception.id, document_id: doc.id, column_key: 'personas', title: 'P1', content: 'c', confidence: 'high', source_anchor: 'a1', source_line: 1, extraction_id: ext.id },
      { inception_id: inception.id, document_id: doc.id, column_key: 'personas', title: 'P2', content: 'c', confidence: 'high', source_anchor: 'a2', source_line: 2, extraction_id: ext.id },
      { inception_id: inception.id, document_id: doc.id, column_key: 'personas', title: 'P3', content: 'c', confidence: 'high', source_anchor: 'a3', source_line: 3, extraction_id: ext.id },
    ]);

    const state = readInceptionState(db, inception.id);
    expect(state.documents).toHaveLength(1);
    expect(state.documents[0]!.card_count).toBe(3);
    expect(state.columns.personas!.status).toBe('complete');
    expect(state.columns.personas!.cards).toHaveLength(3);
    expect(state.columns.vision!.status).toBe('not_identified');
    expect(state.columns.vision!.cards).toHaveLength(0);
  });
});
