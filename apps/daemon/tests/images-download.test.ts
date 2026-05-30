import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
  downloadImage,
  UnsafeUrlError,
  InvalidContentTypeError,
  FileTooLargeError,
} from '../src/images-download.js';

function withFetch(stub: (url: string) => Promise<Response>, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof globalThis.fetch;
  return fn().finally(() => { globalThis.fetch = original; });
}

const onePx = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZwoUYIAAAAASUVORK5CYII=',
  'base64',
); // 1x1 transparent PNG

test('downloadImage writes file to project workspace from allowed Pixabay host', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'od-img-dl-'));
  await withFetch(async () => new Response(onePx, {
    status: 200, headers: { 'content-type': 'image/png', 'content-length': String(onePx.length) },
  }), async () => {
    const result = await downloadImage({
      url: 'https://cdn.pixabay.com/photo/some.png',
      projectRoot,
      destRelative: './assets/images/hero.png',
      optimize: false,
    });
    assert.equal(result.bytesWritten, onePx.length);
    assert.ok(result.absolutePath.endsWith('hero.png'));
    const written = await readFile(result.absolutePath);
    assert.equal(written.length, onePx.length);
  });
});

test('downloadImage rejects URLs outside the Pixabay host allowlist', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'od-img-dl-'));
  await assert.rejects(
    () => downloadImage({
      url: 'https://evil.example.com/x.png',
      projectRoot,
      destRelative: './x.png',
    }),
    (err) => err instanceof UnsafeUrlError,
  );
});

test('downloadImage rejects http:// URLs (https required)', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'od-img-dl-'));
  await assert.rejects(
    () => downloadImage({
      url: 'http://pixabay.com/x.png',
      projectRoot,
      destRelative: './x.png',
    }),
    (err) => err instanceof UnsafeUrlError,
  );
});

test('downloadImage rejects non-image content-type', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'od-img-dl-'));
  await withFetch(async () => new Response('hello', {
    status: 200, headers: { 'content-type': 'text/html' },
  }), async () => {
    await assert.rejects(
      () => downloadImage({
        url: 'https://cdn.pixabay.com/photo/x.html',
        projectRoot,
        destRelative: './x.png',
      }),
      (err) => err instanceof InvalidContentTypeError,
    );
  });
});

test('downloadImage rejects files larger than 10 MB', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'od-img-dl-'));
  await withFetch(async () => new Response('x', {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': String(11 * 1024 * 1024) },
  }), async () => {
    await assert.rejects(
      () => downloadImage({
        url: 'https://cdn.pixabay.com/photo/big.png',
        projectRoot,
        destRelative: './big.png',
      }),
      (err) => err instanceof FileTooLargeError,
    );
  });
});

test('downloadImage refuses path traversal in destRelative', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'od-img-dl-'));
  await assert.rejects(
    () => downloadImage({
      url: 'https://cdn.pixabay.com/photo/x.png',
      projectRoot,
      destRelative: '../../../../tmp/escape.png',
    }),
    (err) => err instanceof UnsafeUrlError || err instanceof Error,
  );
});
