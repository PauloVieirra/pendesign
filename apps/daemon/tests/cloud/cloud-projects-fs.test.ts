import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  isSafeEntryPath,
  unzipToDirectory,
  UnsafeZipPathError,
  zipProjectDirectory,
  ZipTooLargeError,
} from '../../src/cloud/cloud-projects-fs.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'od-cloud-fs-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body, 'utf8');
  }
}

describe('zipProjectDirectory', () => {
  it('round-trips a simple file tree', async () => {
    const src = path.join(tmp, 'src');
    const files = {
      'index.html': '<html><body>hi</body></html>',
      'css/style.css': 'body { color: red; }',
      'nested/deep/file.txt': 'deep content',
    };
    await writeTree(src, files);
    const result = await zipProjectDirectory(src);
    expect(result.fileCount).toBe(3);

    const dest = path.join(tmp, 'dest');
    const unzip = await unzipToDirectory(result.bytes, dest);
    expect(unzip.filesWritten).toBe(3);
    for (const [rel, expected] of Object.entries(files)) {
      const actual = await readFile(path.join(dest, rel), 'utf8');
      expect(actual).toBe(expected);
    }
  });

  it('skips ignored entries (.DS_Store, node_modules)', async () => {
    const src = path.join(tmp, 'src');
    await writeTree(src, {
      'keep.txt': 'keep',
      '.DS_Store': 'noise',
      'node_modules/lib/index.js': 'noise',
    });
    const result = await zipProjectDirectory(src);
    expect(result.fileCount).toBe(1);
  });

  it('throws ZipTooLargeError when content exceeds the cap', async () => {
    const src = path.join(tmp, 'src');
    await mkdir(src, { recursive: true });
    // Write a file just over the cap.
    const huge = Buffer.alloc(1_000_001, 'x');
    await writeFile(path.join(src, 'huge.bin'), huge);
    await expect(zipProjectDirectory(src, { maxBytes: 1_000_000 })).rejects.toBeInstanceOf(
      ZipTooLargeError,
    );
  });
});

describe('unzipToDirectory', () => {
  it('rejects absolute paths (zip slip protection)', async () => {
    const zip = new JSZip();
    zip.file('/etc/passwd', 'evil');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const dest = path.join(tmp, 'dest');
    await expect(unzipToDirectory(bytes, dest)).rejects.toBeInstanceOf(UnsafeZipPathError);
  });

});

describe('isSafeEntryPath (unit-level guards)', () => {
  it('accepts plain relative paths', () => {
    expect(isSafeEntryPath('index.html')).toBe(true);
    expect(isSafeEntryPath('css/style.css')).toBe(true);
    expect(isSafeEntryPath('a/b/c/d.txt')).toBe(true);
  });
  it('rejects ..  segments', () => {
    expect(isSafeEntryPath('../escape.txt')).toBe(false);
    expect(isSafeEntryPath('a/../escape.txt')).toBe(false);
  });
  it('rejects empty / absolute / backslash paths', () => {
    expect(isSafeEntryPath('')).toBe(false);
    expect(isSafeEntryPath('/etc/passwd')).toBe(false);
    expect(isSafeEntryPath('sub\\..\\escape.txt')).toBe(false);
  });

  it('wipeExisting clears the destination first', async () => {
    const dest = path.join(tmp, 'dest');
    await writeTree(dest, { 'old.txt': 'stale' });

    const zip = new JSZip();
    zip.file('new.txt', 'fresh');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await unzipToDirectory(bytes, dest, { wipeExisting: true });

    const newFile = await readFile(path.join(dest, 'new.txt'), 'utf8');
    expect(newFile).toBe('fresh');
    // old.txt should be gone
    await expect(readFile(path.join(dest, 'old.txt'), 'utf8')).rejects.toThrow();
  });
});
