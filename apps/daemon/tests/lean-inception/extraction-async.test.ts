import { describe, expect, it, vi } from 'vitest';
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

describe('POST /api/projects/:id/lean-inception/documents — async', () => {
  it('returns immediately with extracting status and finishes in background', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);

    const resolveInvokeHolder: { fn: ((value: unknown) => void) | null } = { fn: null };
    const invokerPromise = new Promise((res) => { resolveInvokeHolder.fn = res; });
    const invoker: LeanInceptionRuntimeInvoker = async () => {
      await invokerPromise;
      return {
        rawStdout: JSON.stringify({ cards: [{ column_key: 'vision', title: 'Build best', content: 'desc', confidence: 'high', source_anchor: 'Hello world.', source_line: 1 }] }),
        durationMs: 100, model: null, promptTokens: null, outputTokens: null,
      };
    };

    const ragIngest = vi.fn().mockResolvedValue(undefined);

    const server = await startServer({
      db,
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-async-')),
      runtimeInvoker: invoker,
      defaultRuntime: 'claude',
      ragIngest,
    });

    try {
      const r = await fetch(`${server.url}/api/projects/prj_a/lean-inception/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documents: [{ filename: 'a.md', mime_type: 'text/markdown', content_base64: Buffer.from('Hello world.').toString('base64') }],
        }),
      });
      expect(r.status).toBe(202);
      const body = await r.json() as any;
      expect(body.state.documents).toHaveLength(1);
      expect(body.state.documents[0].extraction_status).toBe('extracting');

      // RAG ingest must have been triggered (sync at ingest time)
      expect(ragIngest).toHaveBeenCalledTimes(1);
      const firstRagCall = ragIngest.mock.calls[0];
      expect(firstRagCall).toBeDefined();
      const firstRagArg = firstRagCall![0];
      expect(firstRagArg!.projectId).toBe('prj_a');
      expect(firstRagArg!.name).toBe('a.md');

      // Unblock the runtime
      resolveInvokeHolder.fn?.(undefined);
      // Wait a tick for setImmediate to fire
      await new Promise((res) => setTimeout(res, 50));
      // Poll the state endpoint until extraction completes
      let finalState = null;
      for (let i = 0; i < 20; i++) {
        const sr = await fetch(`${server.url}/api/projects/prj_a/lean-inception`);
        const sb = await sr.json() as any;
        if (sb.state.documents[0].extraction_status === 'extracted') {
          finalState = sb;
          break;
        }
        await new Promise((res) => setTimeout(res, 50));
      }
      expect(finalState).not.toBeNull();
      expect(finalState!.state.columns.vision.cards).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('continues RAG ingest even if runtime extraction fails', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);

    const invoker: LeanInceptionRuntimeInvoker = async () => {
      throw new Error('extraction crashed');
    };
    const ragIngest = vi.fn().mockResolvedValue(undefined);

    const server = await startServer({
      db,
      storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-async-')),
      runtimeInvoker: invoker, defaultRuntime: 'claude', ragIngest,
    });

    try {
      const r = await fetch(`${server.url}/api/projects/prj_b/lean-inception/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documents: [{ filename: 'a.md', mime_type: 'text/markdown', content_base64: Buffer.from('text').toString('base64') }],
        }),
      });
      expect(r.status).toBe(202);
      expect(ragIngest).toHaveBeenCalledTimes(1);

      // Background extraction will fail; doc moves to 'failed'
      let failed = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((res) => setTimeout(res, 50));
        const sr = await fetch(`${server.url}/api/projects/prj_b/lean-inception`);
        const sb = await sr.json() as any;
        if (sb.state.documents[0]?.extraction_status === 'failed') {
          failed = true;
          break;
        }
      }
      expect(failed).toBe(true);
    } finally {
      server.close();
    }
  });
});
