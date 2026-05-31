// Compute the diff between a working tree and the baseline zip.
//
// Returns the set of files that were added, modified, or deleted, plus a
// payload zip containing only the added + modified file contents and a
// manifest describing the actions.
//
// Used by submit (Phase 3) on the editor's side.

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const IGNORED_FILENAMES: ReadonlySet<string> = new Set([
  '.DS_Store',
  'Thumbs.db',
  '.od-baseline.zip',
]);

const IGNORED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'out',
  '.od-scratch',
]);

export interface FileChange {
  path: string;
  action: 'added' | 'modified' | 'deleted';
}

export interface ProposalManifest {
  base_version: number;
  files_changed: FileChange[];
}

export interface ProposalDiffResult {
  payloadZip: Uint8Array;
  manifest: ProposalManifest;
  fileCount: number;
  totalSize: number;
}

interface WorkingFile { relPath: string; absPath: string; size: number; sha256: string }
interface BaselineFile { sha256: string; size: number }

/**
 * Build the proposal payload by diffing `workingDir` against `baselineZipBytes`.
 * Throws if there are zero changes (caller should warn the user instead of
 * submitting an empty proposal).
 */
export async function buildProposalPayload(
  workingDir: string,
  baselineZipBytes: Uint8Array,
  baseVersion: number,
): Promise<ProposalDiffResult> {
  const working = await walkWorkingTree(workingDir);
  const baseline = await loadBaselineIndex(baselineZipBytes);

  const workingByPath = new Map(working.map((f) => [f.relPath, f]));
  const baselinePaths = new Set(baseline.keys());
  const workingPaths = new Set(workingByPath.keys());

  const changes: FileChange[] = [];

  for (const [relPath, w] of workingByPath) {
    const b = baseline.get(relPath);
    if (!b) {
      changes.push({ path: relPath, action: 'added' });
      continue;
    }
    if (b.sha256 !== w.sha256) {
      changes.push({ path: relPath, action: 'modified' });
    }
  }
  for (const relPath of baselinePaths) {
    if (!workingPaths.has(relPath)) {
      changes.push({ path: relPath, action: 'deleted' });
    }
  }

  if (changes.length === 0) {
    throw new Error('no_changes_to_propose');
  }

  // Sort deterministically so two clients producing the same diff get the
  // same payload (helpful for storage hashing in the future).
  changes.sort((a, b) => a.path.localeCompare(b.path));

  const out = new JSZip();
  let totalSize = 0;
  for (const change of changes) {
    if (change.action === 'deleted') continue;
    const w = workingByPath.get(change.path);
    if (!w) continue;
    const content = await readFile(w.absPath);
    out.file(change.path, content);
    totalSize += content.byteLength;
  }
  const manifest: ProposalManifest = { base_version: baseVersion, files_changed: changes };
  out.file('manifest.json', JSON.stringify(manifest, null, 2));

  const bytes = await out.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { payloadZip: bytes, manifest, fileCount: changes.length, totalSize };
}

async function walkWorkingTree(root: string): Promise<WorkingFile[]> {
  const out: WorkingFile[] = [];
  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_FILENAMES.has(entry.name)) continue;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const st = await stat(abs);
      const content = await readFile(abs);
      const sha256 = createHash('sha256').update(content).digest('hex');
      out.push({ relPath: rel, absPath: abs, size: st.size, sha256 });
    }
  }
  await walk(root, '');
  return out;
}

async function loadBaselineIndex(zipBytes: Uint8Array): Promise<Map<string, BaselineFile>> {
  const zip = await JSZip.loadAsync(zipBytes);
  const index = new Map<string, BaselineFile>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const content = await entry.async('uint8array');
    const sha256 = createHash('sha256').update(content).digest('hex');
    index.set(name, { sha256, size: content.byteLength });
  }
  return index;
}
