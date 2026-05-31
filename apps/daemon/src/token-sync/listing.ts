import { readdir } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', 'out',
]);

const MAX_FILES = 200;

export interface SourceFile {
  path: string;
  kind: 'css' | 'html';
}

function kindFor(filename: string): 'css' | 'html' | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return null;
}

export async function listProjectSourceFiles(rootDir: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= MAX_FILES) return;
      const name = ent.name;
      if (name.startsWith('.')) continue; // hidden files and dirs (.git, .next handled here too)
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        await walk(path.join(dir, name));
      } else if (ent.isFile()) {
        const k = kindFor(name);
        if (k) out.push({ path: path.join(dir, name), kind: k });
      }
    }
  }
  await walk(rootDir);
  return out;
}
