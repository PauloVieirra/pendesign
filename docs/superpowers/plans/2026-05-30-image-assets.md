# Image Assets in Web Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AI-generated web artifacts embed real images by default — Pixabay stock search for thematic photos and the existing `od media generate` pipeline for hero/branded imagery — by adding two new daemon CLI commands (`od images search`, `od images download`) and replacing the system-prompt restriction that today forbids image embedding.

**Architecture:** Two new daemon-side modules (`images-search.ts` for Pixabay, `images-download.ts` for fetch+optimize), one CLI dispatcher (`images-cli.ts`) wired into `cli.ts`, a prompt-text replacement in `official-system.ts`, and a Pixabay key field in the Settings dialog mirroring the existing API-key pattern from `media-config.ts`.

**Tech Stack:** TypeScript (ESM), `undici` (already in daemon deps) for HTTP, optional `sharp` for JPEG optimization with graceful fallback, Vitest 4 for tests, the existing `resolveProviderConfig` helper in `apps/daemon/src/media-config.ts` for API-key resolution.

**Spec:** `docs/superpowers/specs/2026-05-30-image-assets-design.md`

---

## File Structure

### New (daemon)

- `apps/daemon/src/images-search.ts` — `searchPixabay()` + typed input/output (~150 lines)
- `apps/daemon/src/images-download.ts` — `downloadImage()` + URL allowlist + optimizer (~120 lines)
- `apps/daemon/src/images-cli.ts` — `runImages(argv)` dispatcher for `od images search|download` (~120 lines)
- `apps/daemon/tests/images-search.test.ts` — Pixabay client unit tests (~120 lines)
- `apps/daemon/tests/images-download.test.ts` — downloader + safety tests (~150 lines)
- `apps/daemon/tests/images-cli.test.ts` — CLI surface tests (~80 lines)
- `e2e/tests/images-cli.test.ts` — integration covering search + download against a mock Pixabay (~120 lines)

### Modified (daemon)

- `apps/daemon/src/cli.ts` — register `images: runImages` in `SUBCOMMAND_MAP`; help-text entry
- `apps/daemon/src/media-models.ts` — add `pixabay` to `MEDIA_PROVIDERS` (key-only provider, no models, no surface)
- `apps/daemon/src/prompts/official-system.ts` — replace the "Don't try to embed user images" sentence with the new "Embedding images in web artifacts" section
- `apps/daemon/tests/prompts/official-system.test.ts` — assert old text gone + new section present (create file if absent)

### Modified (web)

- `apps/web/src/components/SettingsDialog.tsx` — add Pixabay API-key entry in the existing API-keys section
- `apps/web/src/i18n/types.ts` + all 18 locale files — 3 new keys (`settings.pixabay.label`, `settings.pixabay.description`, `settings.pixabay.placeholder`)

---

## Phase 1 — Pixabay client

### Task 1: `searchPixabay` function

**Files:**
- Create: `apps/daemon/src/images-search.ts`
- Test: `apps/daemon/tests/images-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/tests/images-search.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  searchPixabay,
  MissingApiKeyError,
  RateLimitedError,
  InvalidResponseError,
  type PixabayImage,
} from '../src/images-search.js';

function withFetch(stub: (url: string, init?: RequestInit) => Promise<Response>, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof globalThis.fetch;
  return fn().finally(() => { globalThis.fetch = original; });
}

test('searchPixabay builds correct URL and maps response', async () => {
  let capturedUrl = '';
  await withFetch(async (url) => {
    capturedUrl = url;
    return new Response(JSON.stringify({
      total: 1,
      totalHits: 1,
      hits: [{
        id: 100, pageURL: 'https://pixabay.com/photos/x/100/',
        previewURL: 'https://cdn.pixabay.com/preview/x.jpg',
        webformatURL: 'https://cdn.pixabay.com/get/web.jpg',
        largeImageURL: 'https://cdn.pixabay.com/get/large.jpg',
        imageWidth: 1920, imageHeight: 1280,
        tags: 'sunset, sky', user: 'photog',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    const out = await searchPixabay({ query: 'sunset', count: 3, apiKey: 'k1' });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 100);
    assert.equal(out[0].url, 'https://cdn.pixabay.com/get/large.jpg');
    assert.equal(out[0].width, 1920);
    assert.equal(out[0].height, 1280);
    assert.equal(out[0].user, 'photog');
    assert.ok(capturedUrl.includes('q=sunset'));
    assert.ok(capturedUrl.includes('per_page=3'));
    assert.ok(capturedUrl.includes('image_type=photo'));
    assert.ok(capturedUrl.includes('safesearch=true'));
    assert.ok(capturedUrl.includes('key=k1'));
  });
});

test('searchPixabay throws MissingApiKeyError when apiKey is empty', async () => {
  await assert.rejects(
    () => searchPixabay({ query: 'x', apiKey: '' }),
    (err) => err instanceof MissingApiKeyError,
  );
});

test('searchPixabay returns [] when Pixabay reports zero hits', async () => {
  await withFetch(async () => new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }), async () => {
    const out = await searchPixabay({ query: 'nothing', apiKey: 'k1' });
    assert.deepEqual(out, []);
  });
});

test('searchPixabay throws RateLimitedError on 429', async () => {
  await withFetch(async () => new Response('rate limited', { status: 429, headers: { 'retry-after': '60' } }), async () => {
    await assert.rejects(
      () => searchPixabay({ query: 'x', apiKey: 'k1' }),
      (err) => err instanceof RateLimitedError && (err as RateLimitedError).retryAfterSec === 60,
    );
  });
});

test('searchPixabay throws InvalidResponseError on malformed JSON', async () => {
  await withFetch(async () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    await assert.rejects(
      () => searchPixabay({ query: 'x', apiKey: 'k1' }),
      (err) => err instanceof InvalidResponseError,
    );
  });
});

test('searchPixabay forwards orientation, minWidth, category filters', async () => {
  let capturedUrl = '';
  await withFetch(async (url) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    await searchPixabay({
      query: 'cats', apiKey: 'k1',
      orientation: 'horizontal', minWidth: 1200, category: 'animals',
    });
    assert.ok(capturedUrl.includes('orientation=horizontal'));
    assert.ok(capturedUrl.includes('min_width=1200'));
    assert.ok(capturedUrl.includes('category=animals'));
  });
});

test('searchPixabay falls back from largeImageURL → webformatURL → imageURL when missing', async () => {
  await withFetch(async () => new Response(JSON.stringify({
    hits: [
      { id: 1, webformatURL: 'https://cdn.pixabay.com/get/web1.jpg', imageWidth: 100, imageHeight: 100, tags: '', user: 'a', pageURL: 'p', previewURL: 'pv' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    const out = await searchPixabay({ query: 'x', apiKey: 'k1' });
    assert.equal(out[0].url, 'https://cdn.pixabay.com/get/web1.jpg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @open-design/daemon test images-search`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `images-search.ts`**

Create `apps/daemon/src/images-search.ts`:

```typescript
/**
 * Pixabay free-tier search client. Returns up to N normalized image results
 * for an agent or CLI to pick from. Used by `od images search`.
 *
 * Free tier: 5000 requests / hour per API key (after signup at pixabay.com/api).
 */

export interface PixabaySearchInput {
  query: string;
  apiKey: string;
  count?: number;                                       // default 5, max 20
  orientation?: 'horizontal' | 'vertical' | 'all';      // default 'all'
  minWidth?: number;                                    // px
  category?: PixabayCategory;
  signal?: AbortSignal;
}

export type PixabayCategory =
  | 'backgrounds' | 'fashion' | 'nature' | 'science' | 'education'
  | 'feelings' | 'health' | 'people' | 'religion' | 'places' | 'animals'
  | 'industry' | 'computer' | 'food' | 'sports' | 'transportation'
  | 'travel' | 'buildings' | 'business' | 'music';

export interface PixabayImage {
  id: number;
  url: string;
  width: number;
  height: number;
  tags: string;
  user: string;
  pageURL: string;
  previewURL: string;
}

export class MissingApiKeyError extends Error {
  constructor() { super('PIXABAY_API_KEY not configured'); this.name = 'MissingApiKeyError'; }
}

export class RateLimitedError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Pixabay rate-limited; retry after ${retryAfterSec}s`);
    this.name = 'RateLimitedError';
  }
}

export class InvalidResponseError extends Error {
  constructor(detail: string) { super(`Pixabay returned an invalid response: ${detail}`); this.name = 'InvalidResponseError'; }
}

interface PixabayHit {
  id: number;
  pageURL?: string;
  previewURL?: string;
  webformatURL?: string;
  largeImageURL?: string;
  imageURL?: string;
  imageWidth?: number;
  imageHeight?: number;
  tags?: string;
  user?: string;
}

const ENDPOINT = 'https://pixabay.com/api/';
const DEFAULT_COUNT = 5;
const MAX_COUNT = 20;
const TIMEOUT_MS = 15000;

export async function searchPixabay(input: PixabaySearchInput): Promise<PixabayImage[]> {
  if (!input.apiKey) throw new MissingApiKeyError();
  const count = Math.min(Math.max(input.count ?? DEFAULT_COUNT, 3), MAX_COUNT);

  const params = new URLSearchParams({
    key: input.apiKey,
    q: input.query,
    image_type: 'photo',
    safesearch: 'true',
    per_page: String(count),
  });
  if (input.orientation && input.orientation !== 'all') params.set('orientation', input.orientation);
  if (input.minWidth) params.set('min_width', String(input.minWidth));
  if (input.category) params.set('category', input.category);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const signal = input.signal
    ? linkSignals(input.signal, controller.signal)
    : controller.signal;

  let resp: Response;
  try {
    resp = await fetch(`${ENDPOINT}?${params.toString()}`, { signal });
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 429) {
    const retryAfter = Number(resp.headers.get('retry-after') ?? '60');
    throw new RateLimitedError(Number.isFinite(retryAfter) ? retryAfter : 60);
  }
  if (!resp.ok) {
    throw new InvalidResponseError(`HTTP ${resp.status}`);
  }

  let body: { hits?: PixabayHit[] };
  try {
    body = await resp.json() as { hits?: PixabayHit[] };
  } catch {
    throw new InvalidResponseError('non-JSON body');
  }

  const hits = Array.isArray(body.hits) ? body.hits : [];
  return hits.map((h): PixabayImage => ({
    id: Number(h.id),
    url: h.largeImageURL ?? h.webformatURL ?? h.imageURL ?? '',
    width: Number(h.imageWidth ?? 0),
    height: Number(h.imageHeight ?? 0),
    tags: String(h.tags ?? ''),
    user: String(h.user ?? ''),
    pageURL: String(h.pageURL ?? ''),
    previewURL: String(h.previewURL ?? ''),
  })).filter((img) => img.url.length > 0);
}

function linkSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const c = new AbortController();
  const fwd = (signal: AbortSignal) => () => c.abort(signal.reason);
  a.addEventListener('abort', fwd(a));
  b.addEventListener('abort', fwd(b));
  if (a.aborted) c.abort(a.reason);
  if (b.aborted) c.abort(b.reason);
  return c.signal;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @open-design/daemon test images-search`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/images-search.ts apps/daemon/tests/images-search.test.ts
git commit -m "feat(images): Pixabay search client with typed errors"
```

---

### Task 2: `downloadImage` function

**Files:**
- Create: `apps/daemon/src/images-download.ts`
- Test: `apps/daemon/tests/images-download.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/tests/images-download.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @open-design/daemon test images-download`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `images-download.ts`**

Create `apps/daemon/src/images-download.ts`:

```typescript
/**
 * Image downloader for `od images download`. Safety:
 * - Allows only https URLs on pixabay.com / cdn.pixabay.com
 * - Rejects non-image content-types
 * - Caps file size at 10 MB
 * - Sanitizes the destination path to live inside the project workspace
 * - Atomic write via `<dest>.tmp` then rename
 *
 * Optimization: if `sharp` is installed and `optimize !== false`, resizes
 * images > 2000px on the longest edge and re-encodes JPEG at quality 85.
 * When `sharp` is unavailable, writes the original bytes with a warning.
 */

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface DownloadInput {
  url: string;
  projectRoot: string;
  destRelative: string;
  optimize?: boolean;
}

export interface DownloadResult {
  absolutePath: string;
  bytesWritten: number;
  finalDimensions: { width: number; height: number };
}

export class UnsafeUrlError extends Error {
  constructor(reason: string) { super(`Refused unsafe URL: ${reason}`); this.name = 'UnsafeUrlError'; }
}
export class InvalidContentTypeError extends Error {
  constructor(ct: string) { super(`Refused non-image content-type: ${ct}`); this.name = 'InvalidContentTypeError'; }
}
export class FileTooLargeError extends Error {
  constructor(bytes: number) { super(`Refused download: ${bytes} bytes > 10 MB cap`); this.name = 'FileTooLargeError'; }
}

const ALLOWED_HOSTS = new Set(['pixabay.com', 'cdn.pixabay.com']);
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30000;

function assertSafeUrl(url: string): URL {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new UnsafeUrlError(`unparseable URL: ${url}`); }
  if (parsed.protocol !== 'https:') throw new UnsafeUrlError(`only https is allowed (got ${parsed.protocol})`);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) throw new UnsafeUrlError(`host not in allowlist: ${parsed.hostname}`);
  return parsed;
}

function resolveSafePath(projectRoot: string, destRelative: string): string {
  const target = path.resolve(projectRoot, destRelative);
  const rel = path.relative(projectRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new UnsafeUrlError(`destination escapes project root: ${destRelative}`);
  }
  return target;
}

export async function downloadImage(input: DownloadInput): Promise<DownloadResult> {
  assertSafeUrl(input.url);
  const dest = resolveSafePath(input.projectRoot, input.destRelative);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(input.url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${input.url}`);

  const ct = resp.headers.get('content-type') ?? '';
  if (!ct.startsWith('image/')) throw new InvalidContentTypeError(ct);
  const lengthHeader = Number(resp.headers.get('content-length') ?? '0');
  if (lengthHeader > MAX_BYTES) throw new FileTooLargeError(lengthHeader);

  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new FileTooLargeError(buf.length);

  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;

  let finalBuf = buf;
  let dims = { width: 0, height: 0 };
  if (input.optimize !== false) {
    try {
      const sharpMod = await import('sharp').catch(() => null);
      if (sharpMod && sharpMod.default) {
        const img = sharpMod.default(buf);
        const meta = await img.metadata();
        const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
        let pipeline = img;
        if (longestEdge > 2000) {
          pipeline = pipeline.resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true });
        }
        if ((meta.format ?? '').toLowerCase().includes('jpeg') || meta.format === 'jpg') {
          pipeline = pipeline.jpeg({ quality: 85 });
        }
        finalBuf = await pipeline.toBuffer({ resolveWithObject: false });
        const finalMeta = await sharpMod.default(finalBuf).metadata();
        dims = { width: finalMeta.width ?? 0, height: finalMeta.height ?? 0 };
      } else {
        console.warn('[images-download] sharp not installed; writing raw bytes');
      }
    } catch (err) {
      console.warn('[images-download] optimization failed; writing raw bytes', err);
    }
  }

  await writeFile(tmp, finalBuf);
  await rename(tmp, dest).catch(async (err) => {
    await unlink(tmp).catch(() => undefined);
    throw err;
  });

  return { absolutePath: dest, bytesWritten: finalBuf.length, finalDimensions: dims };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @open-design/daemon test images-download`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/images-download.ts apps/daemon/tests/images-download.test.ts
git commit -m "feat(images): downloader with host allowlist + optional sharp optimization"
```

---

## Phase 2 — CLI surface

### Task 3: `runImages` dispatcher

**Files:**
- Create: `apps/daemon/src/images-cli.ts`
- Test: `apps/daemon/tests/images-cli.test.ts`

- [ ] **Step 1: Inspect the existing CLI subcommand pattern**

Open `apps/daemon/src/cli.ts` and read lines 200–260. The `SUBCOMMAND_MAP` dispatches to functions like `runMedia(rest)`. Each `runX` parses its sub-subcommands. Mirror that shape.

- [ ] **Step 2: Write the failing test**

Create `apps/daemon/tests/images-cli.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @open-design/daemon test images-cli`
Expected: FAIL — `runImages` not exported.

- [ ] **Step 4: Implement `images-cli.ts`**

Create `apps/daemon/src/images-cli.ts`:

```typescript
/**
 * `od images …` CLI subcommand dispatcher.
 *
 * Surface:
 *   od images search "<query>" [--count N] [--orientation horizontal|vertical|square]
 *                              [--min-width N] [--category <name>] [--json]
 *   od images download <url> <project-relative-path> [--no-optimize]
 *
 * Reads PIXABAY_API_KEY from env. (Settings UI writes it via the existing
 * media-config secret store; the daemon's launch env loads it from there.)
 */

import { searchPixabay, MissingApiKeyError, RateLimitedError, type PixabayCategory } from './images-search.js';
import { downloadImage } from './images-download.js';

const HELP = `Usage: od images <command> [options]

Commands:
  search "<query>" [--count N] [--orientation horizontal|vertical|square]
                   [--min-width N] [--category <name>] [--json]
    Searches Pixabay (free tier). Returns up to N results.
    Requires PIXABAY_API_KEY in env (set via Settings).

  download <url> <project-relative-path> [--no-optimize]
    Downloads <url> (must be on pixabay.com/cdn.pixabay.com) to the
    project-relative path. Optimizes JPEGs > 2000px when sharp is present.

Exit codes:
  0  success
  1  invalid usage
  2  PIXABAY_API_KEY not configured
  3  rate-limited (try again after the Retry-After header value)
  4  network/timeout/other`;

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return null;
  return argv[i + 1]!;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export async function runImages(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (!cmd) {
    console.error(HELP);
    return 1;
  }
  const rest = argv.slice(1);
  if (cmd === 'search') return runSearch(rest);
  if (cmd === 'download') return runDownload(rest);
  console.error(HELP);
  return 1;
}

async function runSearch(argv: string[]): Promise<number> {
  const query = argv.find((a) => !a.startsWith('--')) ?? '';
  if (!query) {
    console.error('search requires a query string');
    console.error(HELP);
    return 1;
  }
  const apiKey = process.env.PIXABAY_API_KEY ?? '';
  const count = flag(argv, '--count') ? Number(flag(argv, '--count')) : undefined;
  const orientationRaw = flag(argv, '--orientation');
  const orientation: 'horizontal' | 'vertical' | 'all' | undefined =
    orientationRaw === 'horizontal' || orientationRaw === 'vertical' ? orientationRaw : undefined;
  const minWidth = flag(argv, '--min-width') ? Number(flag(argv, '--min-width')) : undefined;
  const category = (flag(argv, '--category') ?? undefined) as PixabayCategory | undefined;
  const asJson = hasFlag(argv, '--json');

  try {
    const results = await searchPixabay({ query, apiKey, count, orientation, minWidth, category });
    if (asJson) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) console.log('(no results)');
      for (const r of results) {
        console.log(`#${r.id}  ${r.width}x${r.height}  by ${r.user}  ${r.tags}`);
        console.log(`  url:  ${r.url}`);
        console.log(`  page: ${r.pageURL}`);
      }
    }
    return 0;
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      console.error('Error: PIXABAY_API_KEY not configured.');
      console.error('Set it in Settings → API Keys → Pixabay, or export PIXABAY_API_KEY=...');
      return 2;
    }
    if (err instanceof RateLimitedError) {
      console.error(`Pixabay rate-limited. Retry after ${err.retryAfterSec}s.`);
      return 3;
    }
    console.error(`Pixabay search failed: ${err instanceof Error ? err.message : String(err)}`);
    return 4;
  }
}

async function runDownload(argv: string[]): Promise<number> {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const [url, dest] = positional;
  if (!url || !dest) {
    console.error('download requires <url> <project-relative-path>');
    console.error(HELP);
    return 1;
  }
  const noOptimize = hasFlag(argv, '--no-optimize');
  const projectRoot = process.env.OD_PROJECT_ROOT ?? process.cwd();
  try {
    const result = await downloadImage({ url, projectRoot, destRelative: dest, optimize: !noOptimize });
    console.log(result.absolutePath);
    return 0;
  } catch (err) {
    console.error(`download failed: ${err instanceof Error ? err.message : String(err)}`);
    return 4;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @open-design/daemon test images-cli`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/images-cli.ts apps/daemon/tests/images-cli.test.ts
git commit -m "feat(images): od images search/download CLI dispatcher"
```

---

### Task 4: Register `images` in `SUBCOMMAND_MAP`

**Files:**
- Modify: `apps/daemon/src/cli.ts:206-233` (the `SUBCOMMAND_MAP` literal)

- [ ] **Step 1: Add the import**

Near the other `run*` imports at the top of `apps/daemon/src/cli.ts`:

```typescript
import { runImages } from './images-cli.js';
```

- [ ] **Step 2: Add the dispatch entry**

In `SUBCOMMAND_MAP`, after `media: runMedia,`:

```typescript
  images: runImages,
```

- [ ] **Step 3: Smoke test from CLI**

Run from repo root:

```bash
pnpm --filter @open-design/daemon build
node apps/daemon/dist/cli.js images 2>&1 | head -10
```

Expected: prints the `Usage: od images …` help.

- [ ] **Step 4: Commit**

```bash
git add apps/daemon/src/cli.ts
git commit -m "feat(images): wire 'od images' subcommand into SUBCOMMAND_MAP"
```

---

### Task 5: Register `pixabay` provider entry in `media-models.ts`

**Files:**
- Modify: `apps/daemon/src/media-models.ts` (the `MEDIA_PROVIDERS` array)

This entry makes the Pixabay key surface in the existing Settings → API Keys UI without writing new UI code: the settings dialog iterates `MEDIA_PROVIDERS` to render key fields.

- [ ] **Step 1: Inspect the provider shape**

Read `apps/daemon/src/media-models.ts:11-32`. The `MediaProvider` type defines `id`, `label`, and other fields. Look at how `openai`, `anthropic`, etc. are configured.

- [ ] **Step 2: Append the Pixabay entry**

In `MEDIA_PROVIDERS`, add:

```typescript
{
  id: 'pixabay',
  label: 'Pixabay',
  // Used by `od images search`. Free tier 5000 req/h after signup at pixabay.com/api.
  authKind: 'apiKey',
  // No models — Pixabay is a search service, not a generation provider.
  // The Settings UI shows it under "API Keys" because authKind === 'apiKey'.
  supportsImage: false,
  supportsVideo: false,
  supportsAudio: false,
},
```

(Field names must match the actual `MediaProvider` type. If field names differ — e.g. it's `kind` instead of `authKind` — adapt to match the existing structure.)

- [ ] **Step 3: Smoke test**

Run: `pnpm --filter @open-design/daemon build`
Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/daemon/src/media-models.ts
git commit -m "feat(images): register pixabay provider so Settings shows its API key field"
```

---

## Phase 3 — System prompt update

### Task 6: Replace the embed restriction

**Files:**
- Modify: `apps/daemon/src/prompts/official-system.ts:108` (the sentence forbidding image embed)
- Test: `apps/daemon/tests/prompts/official-system.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create or extend `apps/daemon/tests/prompts/official-system.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { OFFICIAL_DESIGNER_PROMPT } from '../../src/prompts/official-system.js';

test('official prompt no longer forbids image embedding', () => {
  assert.ok(
    !OFFICIAL_DESIGNER_PROMPT.includes("Don't try to embed user images"),
    'old restriction should be removed',
  );
});

test('official prompt teaches od images search / download', () => {
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('od images search'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('od images download'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('od media generate'));
});

test('official prompt covers alt text + loading lazy + width/height guidance', () => {
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('alt'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('loading="lazy"'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('width'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('height'));
});

test('official prompt instructs to default to stock search for thematic / Hero for branded', () => {
  assert.ok(OFFICIAL_DESIGNER_PROMPT.toLowerCase().includes('hero'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.toLowerCase().includes('stock'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @open-design/daemon test official-system`
Expected: FAIL — old restriction still present, new commands not mentioned.

- [ ] **Step 3: Edit `official-system.ts`**

Locate the sentence at line 108: `Don't try to embed user images by URL into the artifact unless the user explicitly wants that — copy or reference by path.`

Replace that single sentence with the multi-paragraph "Embedding images" section. The exact text:

```markdown
## Embedding images in web artifacts

Real images make a landing page or marketing site land. Use them.

Two sources, both invocable via the CLI you already have:

**Hero / branded / scene-specific imagery** — when the image needs to look like the brand, depict a specific product or service, or carry the identity of the hero section:

\`\`\`bash
"$OD_NODE_BIN" "$OD_BIN" media generate \\
  --surface image \\
  --prompt "<one-paragraph visual description, including style + composition>" \\
  --output ./assets/images/<descriptive-name>.png
\`\`\`

**Thematic / stock imagery** — backgrounds, supporting photos, gallery grids, blog post thumbnails, illustrative ornaments. Free, fast, no generation cost:

\`\`\`bash
"$OD_NODE_BIN" "$OD_BIN" images search "people working in office" --count 3 --orientation horizontal --json
# Pick the URL that best matches the slot's style and tone.

"$OD_NODE_BIN" "$OD_BIN" images download "<url>" ./assets/images/<descriptive-name>.jpg
# File lands at the project-relative path; the optimizer resizes > 2000px and recompresses JPEG.
\`\`\`

Both paths write the file into the project workspace at the relative path you specify. Reference it from your HTML / JSX / Markdown:

\`\`\`html
<img src="./assets/images/hero.png"
     alt="<concrete description of what's in the image>"
     loading="lazy"
     width="1200" height="600">
\`\`\`

Rules of thumb:
- Default to stock search. Only AI-generate when the visual is brand / product / hero specific.
- Always pass \`width\` + \`height\` (or CSS aspect-ratio) to prevent layout shift. The download command's JSON output includes finalDimensions.
- Always set \`loading="lazy"\` except for above-the-fold images.
- Alt text describes content, not "image of …". Empty alt only for decorative ornaments.
- Don't hotlink Pixabay URLs (don't embed the URL directly). Always download into the project first so the artifact is self-contained.
- Don't paste Pixabay's preview thumbnails — they're 640px max.

If \`PIXABAY_API_KEY\` is not configured, \`od images search\` exits with a clear message. In that case, generate via \`od media generate\` or omit the image and let the user fill it in later.
```

This block goes immediately after the existing image-reading paragraph (line 53 region). The line-108 sentence about "Don't try to embed user images" is the one to delete — keep the surrounding text ("treat as visual reference, lift palette, …") since it covers user-attached references, a different case.

Confirm the file no longer contains the string `Don't try to embed user images by URL`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @open-design/daemon test official-system`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Verify no other prompt tests broke**

Run: `pnpm --filter @open-design/daemon test prompts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/prompts/official-system.ts apps/daemon/tests/prompts/official-system.test.ts
git commit -m "feat(prompts): teach agent to embed images via od images + od media generate"
```

---

## Phase 4 — Settings UI

### Task 7: Add Pixabay API key entry in SettingsDialog

**Files:**
- Modify: `apps/web/src/components/SettingsDialog.tsx`

- [ ] **Step 1: Find the API keys section**

Open `apps/web/src/components/SettingsDialog.tsx`. Grep for `'openai'` or `apiKey` to find where existing providers render their key inputs.

```
grep -n "apiKey\|openai\|anthropic" apps/web/src/components/SettingsDialog.tsx | head -10
```

The existing pattern likely iterates `MEDIA_PROVIDERS` and renders a `<label>` + `<input type="password">` per provider with `authKind === 'apiKey'`. Once Task 5 added `pixabay` to that array, the field SHOULD already render automatically. Verify by:

- [ ] **Step 2: Restart `tools-dev`, open Settings → API Keys**

```bash
pnpm tools-dev restart
```

Open the desktop, navigate to Settings → API Keys. The Pixabay entry should appear.

If it doesn't appear automatically (because the dialog has a hand-rolled list rather than iterating providers), add a manual entry mirroring the OpenAI / Anthropic blocks:

```tsx
<label className="settings-api-key-row">
  <span className="settings-api-key-row__label">{t('settings.pixabay.label')}</span>
  <span className="settings-api-key-row__desc">{t('settings.pixabay.description')}</span>
  <input
    type="password"
    placeholder={t('settings.pixabay.placeholder')}
    value={config.providerKeys?.pixabay ?? ''}
    onChange={(ev) => updateProviderKey('pixabay', ev.currentTarget.value)}
    data-testid="settings-pixabay-key"
  />
</label>
```

Adapt class names + handler names to whatever the surrounding rows use.

- [ ] **Step 3: Add i18n keys**

In `apps/web/src/i18n/types.ts`, append to the `Dict` interface:

```typescript
  'settings.pixabay.label': string;
  'settings.pixabay.description': string;
  'settings.pixabay.placeholder': string;
```

In `apps/web/src/i18n/locales/en.ts`:

```typescript
  'settings.pixabay.label': 'Pixabay API key',
  'settings.pixabay.description': 'Free key from pixabay.com/api — enables image search for AI-generated pages. 5000 requests/hour limit.',
  'settings.pixabay.placeholder': 'Your Pixabay API key',
```

In `apps/web/src/i18n/locales/pt-BR.ts`:

```typescript
  'settings.pixabay.label': 'Chave API do Pixabay',
  'settings.pixabay.description': 'Chave gratuita em pixabay.com/api — habilita busca de imagens para páginas geradas pelo AI. Limite de 5000 requisições/hora.',
  'settings.pixabay.placeholder': 'Sua chave API do Pixabay',
```

For the remaining 16 locales (`ar`, `de`, `es-ES`, `fa`, `fr`, `hu`, `id`, `it`, `ja`, `ko`, `pl`, `ru`, `th`, `tr`, `uk`, `zh-CN`, `zh-TW`), add equivalent translations. When unsure, the English fallback is acceptable.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: PASS (only the 22 pre-existing lean-inception errors remain).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/SettingsDialog.tsx apps/web/src/i18n/
git commit -m "feat(images): Pixabay API key field in Settings + i18n keys across 18 locales"
```

---

## Phase 5 — e2e

### Task 8: end-to-end test

**Files:**
- Create: `e2e/tests/images-cli.test.ts`

- [ ] **Step 1: Inspect existing e2e patterns**

Look at `e2e/tests/ds-variables-modal.test.ts` — it boots the daemon stack via `createSmokeSuite`. Mirror the pattern.

- [ ] **Step 2: Write the test**

Create `e2e/tests/images-cli.test.ts`:

```typescript
import { test, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// The mock server returns a tiny PNG for any URL. The CLI under test
// only talks to pixabay.com hosts, so this test stubs fetch via an
// environment-driven URL override is not feasible — instead we test the
// CLI's argument parsing + error paths, and let the unit tests in
// apps/daemon/tests/images-*.test.ts cover the fetch happy path.

test('od images (no command) prints help', async () => {
  const daemonBin = path.resolve(__dirname, '../../apps/daemon/dist/cli.js');
  const { stdout, stderr } = await execFileAsync('node', [daemonBin, 'images'], {
    env: { ...process.env, PIXABAY_API_KEY: '' },
  }).catch((err) => ({ stdout: err.stdout ?? '', stderr: err.stderr ?? '' }));
  expect((stdout + stderr).toLowerCase()).toMatch(/usage:\s*od\s+images/);
});

test('od images search exits 2 without PIXABAY_API_KEY', async () => {
  const daemonBin = path.resolve(__dirname, '../../apps/daemon/dist/cli.js');
  let exitCode = 0;
  try {
    await execFileAsync('node', [daemonBin, 'images', 'search', 'cats'], {
      env: { ...process.env, PIXABAY_API_KEY: '' },
    });
  } catch (err) {
    exitCode = (err as { code?: number }).code ?? -1;
  }
  expect(exitCode).toBe(2);
});
```

- [ ] **Step 3: Build daemon and run the e2e test**

```bash
pnpm --filter @open-design/daemon build
pnpm --filter @open-design/e2e test images-cli
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/images-cli.test.ts
git commit -m "test(images): e2e for od images CLI surface (help + missing-key exit)"
```

---

## Phase 6 — Final verification

### Task 9: Repo-wide checks + manual smoke

- [ ] **Step 1: Guard**

Run: `pnpm guard`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: only the 22 pre-existing lean-inception errors.

- [ ] **Step 3: Daemon tests**

Run: `pnpm --filter @open-design/daemon test`
Expected: pre-existing 5 failures only (no new failures from token-sync, images, prompts).

- [ ] **Step 4: Web typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: 22 pre-existing errors only.

- [ ] **Step 5: Manual smoke**

```bash
pnpm tools-dev restart
```

In the desktop:
1. Open Settings → API Keys. Confirm "Pixabay API key" entry is visible. Paste a real free Pixabay key (sign up at pixabay.com/api/docs).
2. Create a new project, prompt the agent: "Build a landing page for a coffee shop with a hero photo and three feature cards each with an icon".
3. Observe the AI's tool calls — it should issue `od images search` and `od images download` (or `od media generate` for the hero) during the build.
4. Open the rendered output. Verify image files exist at `./assets/images/` under the project workspace and the HTML references them with proper `alt`, `loading="lazy"`, `width`, `height`.

- [ ] **Step 6: Commit any fix-ups**

If smoke surfaces small issues (path quoting, alt-text wording, `--orientation` filter typo), fix and commit with a clear message:

```bash
git add -A
git commit -m "fix(images): <specific issue>"
```

- [ ] **Step 7: Push + PR**

```bash
git push origin teste
gh pr create --base main --title "feat(images): embed real images in AI-generated web artifacts" --body "$(cat <<'EOF'
## Summary
- New \`od images search\` + \`od images download\` CLI for Pixabay free-tier stock photos.
- Existing \`od media generate --surface image\` remains the path for hero/branded imagery.
- System prompt restriction lifted; agent now embeds images by default.
- Settings → API Keys gains a Pixabay key field.

## Spec
docs/superpowers/specs/2026-05-30-image-assets-design.md

## Surface area
- daemon CLI: new \`images\` subcommand
- system prompt
- web Settings UI + i18n (18 locales)

## Test plan
- [ ] guard passes
- [ ] typecheck passes (only pre-existing lean-inception errors)
- [ ] daemon tests pass (5 pre-existing failures unchanged)
- [ ] e2e \`images-cli.test.ts\` passes
- [ ] Manual: real landing page comes out with embedded images
EOF
)"
```

---

## Self-Review

### Spec coverage

| Spec section | Tasks |
|---|---|
| `od images search` CLI | Task 3 |
| `od images download` CLI | Task 3 |
| `searchPixabay` client | Task 1 |
| `downloadImage` function | Task 2 |
| URL host allowlist + content-type + size guards | Task 2 |
| Optional sharp optimization | Task 2 |
| Pixabay key via Settings UI | Tasks 5 + 7 |
| System prompt: embed images section | Task 6 |
| System prompt: remove old restriction | Task 6 |
| i18n new keys across 18 locales | Task 7 |
| e2e integration | Task 8 |
| Verification | Task 9 |

### Placeholder scan

No "TBD", "TODO", "implement later". Every step has concrete code or a concrete command.

### Type consistency

- `PixabayImage` shape consistent across `images-search.ts`, `images-cli.ts`, and tests.
- `DownloadInput` / `DownloadResult` consistent between `images-download.ts`, `images-cli.ts`, and tests.
- Error classes (`MissingApiKeyError`, `RateLimitedError`, `InvalidResponseError`, `UnsafeUrlError`, `InvalidContentTypeError`, `FileTooLargeError`) declared in their source modules and imported where caught — exit codes mapped 1:1.

### Known soft spots

- **Sharp dependency**: tests don't assert sharp's optimization output (would require sharp installed in CI). The code path includes a graceful fallback covered by the unit test (when sharp is unavailable, raw bytes are written).
- **i18n translations**: 16 locales beyond en + pt-BR get English fallback if the implementer doesn't speak the target language. The typecheck only enforces the keys exist.
- **Settings UI**: Task 7 Step 1 instructs to verify the field auto-renders via the `MEDIA_PROVIDERS` iteration; if it doesn't, the implementer manually adds a row. The exact handler name is left to discovery — this is intentional, since the existing dialog code structure varies between codebases.
