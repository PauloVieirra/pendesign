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
      // Dynamic import with a runtime string prevents TS2307 when @types/sharp
      // is not installed (sharp is an optional peer, not a hard dep).
      const sharpId = 'sharp';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sharpMod: any = await import(sharpId).catch(() => null);
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
