import { describe, expect, it } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
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
import type { LeanInceptionRuntimeInvoker } from '../../src/lean-inception/runtime-invoke.js';

function startServer(deps: Parameters<typeof registerLeanInceptionRoutes>[1]) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerLeanInceptionRoutes(app, deps);
  return new Promise<{ url: string; close: () => void }>(resolve => {
    const srv = app.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => srv.close() });
    });
  });
}

function setupDbWithCard(): { db: Database.Database; inceptionId: string; cardId: string } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateLeanInception(db);
  const inception = upsertInceptionForProject(db, 'prj_1');
  const doc = insertDocument(db, {
    inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown',
    byte_size: 10, content_hash: 'h', storage_path: 'x',
  });
  const ext = insertExtraction(db, {
    inception_id: inception.id, document_id: doc.id, runtime: 'claude', model: null, prompt_version: 1,
  });
  insertCardsAtomic(db, [
    {
      inception_id: inception.id, document_id: doc.id, column_key: 'vision',
      title: 'My vision title', content: 'desc', confidence: 'high',
      source_anchor: 'a', source_line: 1, extraction_id: ext.id,
    },
  ]);
  const cardRow = db.prepare('SELECT id FROM lean_inception_cards LIMIT 1').get() as { id: string };
  return { db, inceptionId: inception.id, cardId: cardRow.id };
}

const stubInvoker: LeanInceptionRuntimeInvoker = async () => ({
  rawStdout: '{"cards":[]}', durationMs: 0, model: null, promptTokens: null, outputTokens: null,
});

describe('DELETE /api/projects/:id/lean-inception/cards/:cardId', () => {
  it('removes the card and returns updated state', async () => {
    const { db, cardId } = setupDbWithCard();
    const server = await startServer({
      db,
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-card-')),
      runtimeInvoker: stubInvoker,
      defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_1/lean-inception/cards/${cardId}`, { method: 'DELETE' });
      expect(r.status).toBe(200);
      const body = await r.json() as any;
      expect(body.state.columns.vision.cards).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it('returns 404 with CARD_NOT_FOUND when card does not exist', async () => {
    const { db } = setupDbWithCard();
    const server = await startServer({
      db,
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-card-')),
      runtimeInvoker: stubInvoker,
      defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_1/lean-inception/cards/card_missing`, { method: 'DELETE' });
      expect(r.status).toBe(404);
      const body = await r.json() as any;
      expect(body.error.code).toBe('CARD_NOT_FOUND');
    } finally {
      server.close();
    }
  });

  it('refuses to delete a card from a different inception (cross-tenant guard)', async () => {
    const { db, cardId } = setupDbWithCard();
    // Create a second project/inception
    upsertInceptionForProject(db, 'prj_other');
    const server = await startServer({
      db,
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-card-')),
      runtimeInvoker: stubInvoker,
      defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_other/lean-inception/cards/${cardId}`, { method: 'DELETE' });
      expect(r.status).toBe(404);
      const body = await r.json() as any;
      expect(body.error.code).toBe('CARD_NOT_FOUND');
    } finally {
      server.close();
    }
  });
});
