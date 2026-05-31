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

const fakeInvoker = (jsonResponse: object): LeanInceptionRuntimeInvoker =>
  async () => ({
    rawStdout: JSON.stringify(jsonResponse),
    durationMs: 50,
    model: 'claude-opus-4-7',
    promptTokens: 100,
    outputTokens: 50,
  });

describe('POST /api/projects/:id/lean-inception/documents', () => {
  it('returns 202 immediately and background-extracts cards', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);

    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-'));
    const invoker = fakeInvoker({
      cards: [{
        column_key: 'vision',
        title: 'Big vision',
        content: 'desc',
        confidence: 'high',
        source_anchor: 'We build the best product.',
        source_line: 1,
      }],
    });

    const server = await startServer({
      db, storageRoot,
      runtimeInvoker: invoker,
      defaultRuntime: 'claude',
    });

    try {
      const docText = 'We build the best product.';
      const r = await fetch(`${server.url}/api/projects/prj_1/lean-inception/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documents: [{
            filename: 'a.md',
            mime_type: 'text/markdown',
            content_base64: Buffer.from(docText).toString('base64'),
          }],
        }),
      });
      expect(r.status).toBe(202);
      const body = await r.json() as any;
      // Immediate response shows the doc with extracting status.
      expect(body.state.documents).toHaveLength(1);
      expect(body.state.documents[0].extraction_status).toBe('extracting');

      // Poll until the background extraction finishes.
      let finalState = null;
      for (let i = 0; i < 20; i++) {
        await new Promise((res) => setTimeout(res, 50));
        const sr = await fetch(`${server.url}/api/projects/prj_1/lean-inception`);
        const sb = await sr.json() as any;
        if (sb.state.documents[0]?.extraction_status === 'extracted') {
          finalState = sb;
          break;
        }
      }
      expect(finalState).not.toBeNull();
      expect(finalState!.state.columns.vision.cards).toHaveLength(1);
      expect(finalState!.state.columns.vision.status).toBe('insufficient');
    } finally {
      server.close();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('returns 400 with code SCHEMA_VALIDATION_FAILED for non-md/txt', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    const server = await startServer({
      db, storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-')),
      runtimeInvoker: fakeInvoker({ cards: [] }), defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_1/lean-inception/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documents: [{ filename: 'a.pdf', mime_type: 'application/pdf', content_base64: 'aGVsbG8=' }],
        }),
      });
      expect(r.status).toBe(400);
      const body = await r.json() as any;
      expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    } finally {
      server.close();
    }
  });
});

describe('GET /api/projects/:id/lean-inception', () => {
  it('returns empty state when inception does not exist yet (auto-create)', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    const server = await startServer({
      db, storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-')),
      runtimeInvoker: fakeInvoker({ cards: [] }), defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_new/lean-inception`);
      expect(r.status).toBe(200);
      const body = await r.json() as any;
      expect(body.state.documents).toEqual([]);
      expect(body.state.columns.vision.status).toBe('not_identified');
    } finally {
      server.close();
    }
  });
});

describe('DELETE /api/projects/:id/lean-inception/documents/:docId', () => {
  it('removes the document and its cards', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    const server = await startServer({
      db, storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-')),
      runtimeInvoker: fakeInvoker({
        cards: [{
          column_key: 'vision', title: 'V card', content: 'c', confidence: 'high',
          source_anchor: 'hi', source_line: 1,
        }],
      }),
      defaultRuntime: 'claude',
    });

    try {
      const postRes = await fetch(`${server.url}/api/projects/prj_1/lean-inception/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documents: [{ filename: 'a.md', mime_type: 'text/markdown', content_base64: Buffer.from('hi').toString('base64') }],
        }),
      });
      const postBody = await postRes.json() as any;
      const docId = postBody.state.documents[0].id;

      const delRes = await fetch(`${server.url}/api/projects/prj_1/lean-inception/documents/${docId}`, { method: 'DELETE' });
      expect(delRes.status).toBe(200);
      const after = await delRes.json() as any;
      expect(after.state.documents).toHaveLength(0);
      expect(after.state.columns.vision.cards).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it('returns 404 when doc does not exist', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    upsertInceptionForProject(db, 'prj_1');
    const server = await startServer({
      db, storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-')),
      runtimeInvoker: fakeInvoker({ cards: [] }), defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_1/lean-inception/documents/doc_missing`, { method: 'DELETE' });
      expect(r.status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('DELETE /api/projects/:id/lean-inception (reset)', () => {
  it('removes the entire inception', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    upsertInceptionForProject(db, 'prj_1');
    const server = await startServer({
      db, storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-')),
      runtimeInvoker: fakeInvoker({ cards: [] }), defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_1/lean-inception`, { method: 'DELETE' });
      expect(r.status).toBe(200);
      const rows = db.prepare('SELECT count(*) AS c FROM lean_inceptions').get() as { c: number };
      expect(rows.c).toBe(0);
    } finally {
      server.close();
    }
  });
});
