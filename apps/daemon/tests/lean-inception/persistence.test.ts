import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrateLeanInception } from '../../src/lean-inception/persistence.js';

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
