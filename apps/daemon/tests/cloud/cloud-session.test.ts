import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetSchemaCacheForTests,
  clearCloudSession,
  ensureCloudSessionSchema,
  getCloudSession,
  saveCloudSession,
  type CloudSessionRow,
} from '../../src/cloud/cloud-session.js';

const SAMPLE: CloudSessionRow = {
  userId: 'user-1',
  email: 'alice@example.com',
  name: 'Alice',
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
  expiresAt: Date.now() + 3600 * 1000,
};

describe('cloud-session', () => {
  let db: Database.Database;

  beforeEach(() => {
    _resetSchemaCacheForTests();
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('ensureCloudSessionSchema is idempotent', () => {
    expect(() => {
      ensureCloudSessionSchema(db);
      ensureCloudSessionSchema(db);
    }).not.toThrow();
  });

  it('getCloudSession returns null when empty', () => {
    expect(getCloudSession(db)).toBeNull();
  });

  it('saveCloudSession inserts a row that getCloudSession can read', () => {
    saveCloudSession(db, SAMPLE);
    const got = getCloudSession(db);
    expect(got).toEqual(SAMPLE);
  });

  it('saveCloudSession upserts (only one row exists)', () => {
    saveCloudSession(db, SAMPLE);
    const updated: CloudSessionRow = {
      ...SAMPLE,
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      name: 'Alice Updated',
    };
    saveCloudSession(db, updated);
    const got = getCloudSession(db);
    expect(got).toEqual(updated);
    const count = db.prepare('SELECT COUNT(*) as n FROM cloud_session').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('clearCloudSession removes the row', () => {
    saveCloudSession(db, SAMPLE);
    expect(getCloudSession(db)).not.toBeNull();
    clearCloudSession(db);
    expect(getCloudSession(db)).toBeNull();
  });

  it('saveCloudSession rejects incomplete session', () => {
    expect(() =>
      saveCloudSession(db, { ...SAMPLE, userId: '' }),
    ).toThrow(/incomplete/i);
  });

  it('CHECK constraint prevents direct multi-row insert', () => {
    ensureCloudSessionSchema(db);
    expect(() => {
      db.prepare(
        `INSERT INTO cloud_session (id, user_id, email, name, access_token, refresh_token, expires_at, updated_at)
         VALUES (2, 'a', 'a@x', 'a', 'a', 'a', 0, 0)`,
      ).run();
    }).toThrow();
  });
});
