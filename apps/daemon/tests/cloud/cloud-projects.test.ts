import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetSchemaCacheForTests,
  ensureCloudProjectsSchema,
  getCloudProject,
  listCloudProjects,
  removeCloudProject,
  upsertCloudProject,
  type CloudProjectRow,
} from '../../src/cloud/cloud-projects.js';

const ROW: CloudProjectRow = {
  projectId: 'proj-1',
  name: 'My Project',
  role: 'owner',
  baseVersion: 1,
  pendingProposalId: null,
  localDirty: false,
  lastSyncAt: 1_700_000_000_000,
};

describe('cloud-projects (local SQLite)', () => {
  let db: Database.Database;

  beforeEach(() => {
    _resetSchemaCacheForTests();
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('ensureCloudProjectsSchema is idempotent', () => {
    expect(() => {
      ensureCloudProjectsSchema(db);
      ensureCloudProjectsSchema(db);
    }).not.toThrow();
  });

  it('empty database returns empty list', () => {
    expect(listCloudProjects(db)).toEqual([]);
  });

  it('upsert + get round-trip', () => {
    upsertCloudProject(db, ROW);
    const got = getCloudProject(db, ROW.projectId);
    expect(got).toEqual(ROW);
  });

  it('upsert updates an existing row', () => {
    upsertCloudProject(db, ROW);
    upsertCloudProject(db, { ...ROW, baseVersion: 2, role: 'editor' });
    const got = getCloudProject(db, ROW.projectId);
    expect(got?.baseVersion).toBe(2);
    expect(got?.role).toBe('editor');
  });

  it('listCloudProjects returns sorted by last_sync_at desc', () => {
    upsertCloudProject(db, { ...ROW, projectId: 'p1', lastSyncAt: 1000 });
    upsertCloudProject(db, { ...ROW, projectId: 'p2', lastSyncAt: 3000 });
    upsertCloudProject(db, { ...ROW, projectId: 'p3', lastSyncAt: 2000 });
    const ids = listCloudProjects(db).map((p) => p.projectId);
    expect(ids).toEqual(['p2', 'p3', 'p1']);
  });

  it('remove deletes the row', () => {
    upsertCloudProject(db, ROW);
    removeCloudProject(db, ROW.projectId);
    expect(getCloudProject(db, ROW.projectId)).toBeNull();
  });

  it('rejects incomplete rows', () => {
    expect(() => upsertCloudProject(db, { ...ROW, projectId: '' })).toThrow(/incomplete/i);
  });

  it('local_dirty round-trips as boolean', () => {
    upsertCloudProject(db, { ...ROW, localDirty: true });
    expect(getCloudProject(db, ROW.projectId)?.localDirty).toBe(true);
    upsertCloudProject(db, { ...ROW, localDirty: false });
    expect(getCloudProject(db, ROW.projectId)?.localDirty).toBe(false);
  });

  it('role CHECK constraint rejects unknown values', () => {
    ensureCloudProjectsSchema(db);
    expect(() => {
      db.prepare(
        `INSERT INTO cloud_projects (project_id, name, role, last_sync_at)
         VALUES ('x', 'x', 'admin', 0)`,
      ).run();
    }).toThrow();
  });
});
