import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { runImages } from '../src/images-cli.js';

function captureStdout(fn: () => Promise<number>): Promise<{ exitCode: number; out: string; err: string }> {
  let out = '', err = '';
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => { out += args.join(' ') + '\n'; };
  console.error = (...args: unknown[]) => { err += args.join(' ') + '\n'; };
  return fn().then((exitCode) => ({ exitCode, out, err })).finally(() => {
    console.log = origLog;
    console.error = origErr;
  });
}

function withFetch(stub: (url: string) => Promise<Response>, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof globalThis.fetch;
  return fn().finally(() => { globalThis.fetch = original; });
}

test('od images (no args) prints help and exits 1', async () => {
  const r = await captureStdout(() => runImages([]));
  assert.equal(r.exitCode, 1);
  assert.ok(r.out.includes('Usage: od images') || r.err.includes('Usage: od images'));
});

test('od images search "cats" emits JSON when --json flag set', async () => {
  process.env.PIXABAY_API_KEY = 'test-key';
  await withFetch(async () => new Response(JSON.stringify({
    hits: [{ id: 1, largeImageURL: 'https://cdn.pixabay.com/x.jpg', imageWidth: 100, imageHeight: 100, tags: '', user: 'u', pageURL: 'p', previewURL: 'pv' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    const r = await captureStdout(() => runImages(['search', 'cats', '--count', '1', '--json']));
    assert.equal(r.exitCode, 0);
    const parsed = JSON.parse(r.out.trim());
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed[0].id, 1);
  });
  delete process.env.PIXABAY_API_KEY;
});

test('od images search exits 2 when PIXABAY_API_KEY missing', async () => {
  delete process.env.PIXABAY_API_KEY;
  const r = await captureStdout(() => runImages(['search', 'cats']));
  assert.equal(r.exitCode, 2);
  assert.ok(r.err.includes('PIXABAY_API_KEY'));
});

test('od images download requires URL and dest args', async () => {
  const r = await captureStdout(() => runImages(['download']));
  assert.equal(r.exitCode, 1);
});
