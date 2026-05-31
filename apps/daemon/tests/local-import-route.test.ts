import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// `POST /api/import/local` copies an uploaded local folder INTO the daemon and
// creates a fully native project: files land under `.od/projects/<id>/` (no
// `baseDir`), the same default seeded design system is attached, and the entry
// file is auto-detected — mirroring what a natively-created project receives.
describe('POST /api/import/local', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function b64(text: string): string {
    return Buffer.from(text, 'utf8').toString('base64');
  }

  async function importLocal(body: unknown) {
    return fetch(`${baseUrl}/api/import/local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('creates a native project, copies files, seeds a design system', async () => {
    const resp = await importLocal({
      name: 'My Local App',
      files: [
        { path: 'index.html', contentBase64: b64('<!doctype html><title>hi</title>') },
        { path: 'src/App.tsx', contentBase64: b64('export const App = () => null;') },
        // Must be filtered out — build/dependency directory.
        { path: 'node_modules/foo/index.js', contentBase64: b64('module.exports = 1;') },
      ],
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      project: {
        id: string;
        designSystemId: string | null;
        metadata?: { baseDir?: string; importedFrom?: string };
      };
      conversationId: string;
      entryFile: string | null;
      fileCount: number;
    };

    // Native project: no baseDir, importedFrom marks the origin.
    expect(body.project.metadata?.baseDir).toBeUndefined();
    expect(body.project.metadata?.importedFrom).toBe('local');
    expect(body.conversationId).toBeTruthy();

    // Default seeded design system attached, just like a native project.
    expect(body.project.designSystemId).toMatch(/^user:/);

    // Entry file detected; ignored directory not counted.
    expect(body.entryFile).toBe('index.html');
    expect(body.fileCount).toBe(2);

    // The copied file is readable through the project file API.
    const raw = await fetch(
      `${baseUrl}/api/projects/${body.project.id}/raw/index.html`,
    );
    expect(raw.status).toBe(200);
    expect(await raw.text()).toContain('<title>hi</title>');

    // The filtered file was not written.
    const ignored = await fetch(
      `${baseUrl}/api/projects/${body.project.id}/raw/node_modules/foo/index.js`,
    );
    expect(ignored.status).not.toBe(200);
  });

  it('rejects an empty file list', async () => {
    const resp = await importLocal({ name: 'empty', files: [] });
    expect(resp.status).toBe(400);
  });

  it('rejects a missing files array', async () => {
    const resp = await importLocal({ name: 'nofiles' });
    expect(resp.status).toBe(400);
  });
});
