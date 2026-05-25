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
