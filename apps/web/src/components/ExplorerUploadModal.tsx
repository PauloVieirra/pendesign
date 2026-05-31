import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { writeProjectBase64File } from '../providers/registry';
import { Icon } from './Icon';

// A single file staged for import, addressed by its project-relative path.
// For a plain file the path is just its name; for a folder the path keeps
// the directory structure (e.g. `assets/logo.svg`) so it lands nested.
export interface PickedFile {
  relPath: string;
  file: File;
}

// Build/dependency directories we never copy into the project — mirrors the
// daemon's LOCAL_IMPORT_SKIP_DIRS so dropping a repo doesn't drag a giant
// node_modules into memory.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.turbo',
  '.cache', '.output', 'out', 'coverage', '__pycache__', '.venv',
  'vendor', 'target', '.od', '.tmp',
]);

// Hard ceilings so a stray folder drop can't lock the tab up.
const MAX_FILES = 5000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MiB

function hasSkippedSegment(relPath: string): boolean {
  return relPath
    .split('/')
    .filter(Boolean)
    .some((seg) => SKIP_DIRS.has(seg.toLowerCase()));
}

function normalizeRel(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

async function readFileSystemEntry(entry: FileSystemEntry, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
    const rel = normalizeRel(entry.fullPath);
    if (rel && !hasSkippedSegment(rel)) out.push({ relPath: rel, file });
    return;
  }
  if (entry.isDirectory) {
    if (SKIP_DIRS.has(entry.name.toLowerCase())) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries: FileSystemEntry[] = [];
    // readEntries yields in batches; loop until it returns an empty array.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      entries.push(...batch);
    }
    for (const child of entries) await readFileSystemEntry(child, out);
  }
}

// Read a DataTransfer (drag-drop or clipboard paste). Uses the entries API
// when available so dropped *folders* keep their structure; falls back to the
// flat file list when entries aren't exposed (typical for clipboard files).
export async function readDataTransferFiles(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const items = Array.from(dt.items || []).filter((i) => i.kind === 'file');
  const entries = items
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => Boolean(e));
  if (entries.length > 0) {
    for (const entry of entries) await readFileSystemEntry(entry, out);
    return out;
  }
  for (const file of Array.from(dt.files || [])) {
    const rel = normalizeRel(
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    );
    if (rel && !hasSkippedSegment(rel)) out.push({ relPath: rel, file });
  }
  return out;
}

// Read an <input type="file"> selection. Folder pickers expose
// webkitRelativePath; plain pickers fall back to the bare name.
export function readInputFiles(list: FileList): PickedFile[] {
  const out: PickedFile[] = [];
  for (const file of Array.from(list)) {
    const rel = normalizeRel(
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    );
    if (rel && !hasSkippedSegment(rel)) out.push({ relPath: rel, file });
  }
  return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface ImportResult {
  ok: number;
  failed: { relPath: string; error: string }[];
}

// Write each picked file into the project, preserving relative paths so
// folders land nested. Uses the JSON base64 endpoint (POST /files) because
// the multipart /upload endpoint flattens names and would lose structure.
export async function importFilesIntoProject(
  projectId: string,
  picked: PickedFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const failed: ImportResult['failed'] = [];
  let ok = 0;
  let done = 0;
  for (const { relPath, file } of picked) {
    try {
      const base64 = arrayBufferToBase64(await file.arrayBuffer());
      const result = await writeProjectBase64File(projectId, relPath, base64);
      if (result) ok += 1;
      else failed.push({ relPath, error: 'write failed' });
    } catch (err) {
      failed.push({ relPath, error: err instanceof Error ? err.message : String(err) });
    }
    done += 1;
    onProgress?.(done, picked.length);
  }
  return { ok, failed };
}

interface Props {
  projectId: string;
  onClose: () => void;
  // Called after a successful (or partial) import so the host can refresh.
  onImported: () => void;
}

export function ExplorerUploadModal({ projectId, onClose, onImported }: Props) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const close = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  // Merge new picks into the staged set, deduped by relative path (latest
  // wins) and bounded by the file/byte ceilings.
  const addPicked = useCallback((incoming: PickedFile[]) => {
    if (incoming.length === 0) return;
    setError(null);
    setPicked((prev) => {
      const byPath = new Map(prev.map((p) => [p.relPath, p]));
      for (const p of incoming) byPath.set(p.relPath, p);
      const merged = Array.from(byPath.values());
      if (merged.length > MAX_FILES) {
        setError(`Too many files (max ${MAX_FILES}).`);
        return merged.slice(0, MAX_FILES);
      }
      const total = merged.reduce((sum, p) => sum + p.file.size, 0);
      if (total > MAX_TOTAL_BYTES) {
        setError('Selection exceeds the 100 MB limit.');
      }
      return merged;
    });
  }, []);

  const onDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      if (busy) return;
      addPicked(await readDataTransferFiles(event.dataTransfer));
    },
    [busy, addPicked],
  );

  const runImport = useCallback(async () => {
    if (busy || picked.length === 0) return;
    const total = picked.reduce((sum, p) => sum + p.file.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      setError('Selection exceeds the 100 MB limit.');
      return;
    }
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: picked.length });
    const result = await importFilesIntoProject(projectId, picked, (done, t) =>
      setProgress({ done, total: t }),
    );
    setBusy(false);
    setProgress(null);
    onImported();
    if (result.failed.length > 0) {
      setError(`Imported ${result.ok}, failed ${result.failed.length}: ${result.failed[0]?.relPath ?? ''}`);
    } else {
      onClose();
    }
  }, [busy, picked, projectId, onImported, onClose]);

  const previewPaths = picked.slice(0, 200);

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal explorer-upload"
        role="dialog"
        aria-modal="true"
        aria-label="Import files into project"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Import files</h2>
        <p className="modal-confirm-message">
          Drop files or folders here, choose them below, or paste copied files into the explorer.
        </p>
        <div
          className={`import-local-dropzone${dragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Icon name={busy ? 'spinner' : 'upload'} size={28} />
          <span className="import-local-dropzone__hint">
            {busy && progress
              ? `Importing ${progress.done}/${progress.total}…`
              : 'Drag & drop files or folders'}
          </span>
          {!busy ? (
            <div className="explorer-upload__pick-row">
              <button type="button" className="primary" onClick={() => fileInputRef.current?.click()}>
                Select files
              </button>
              <button type="button" onClick={() => folderInputRef.current?.click()}>
                Select folder
              </button>
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            onChange={(e) => {
              if (e.target.files) addPicked(readInputFiles(e.target.files));
              e.target.value = '';
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            hidden
            // @ts-expect-error — non-standard but widely supported folder picker attrs.
            webkitdirectory=""
            directory=""
            multiple
            onChange={(e) => {
              if (e.target.files) addPicked(readInputFiles(e.target.files));
              e.target.value = '';
            }}
          />
        </div>
        {picked.length > 0 ? (
          <div className="explorer-upload__staged">
            <div className="explorer-upload__staged-head">
              <span>{picked.length} file{picked.length === 1 ? '' : 's'} ready</span>
              {!busy ? (
                <button type="button" className="explorer-upload__clear" onClick={() => setPicked([])}>
                  Clear
                </button>
              ) : null}
            </div>
            <ul className="explorer-upload__list">
              {previewPaths.map((p) => (
                <li key={p.relPath} title={p.relPath}>{p.relPath}</li>
              ))}
              {picked.length > previewPaths.length ? (
                <li className="explorer-upload__more">+{picked.length - previewPaths.length} more…</li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {error ? <p className="import-local-error">{error}</p> : null}
        <div className="row">
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => void runImport()} disabled={busy || picked.length === 0}>
            {busy ? 'Importing…' : `Import${picked.length ? ` ${picked.length}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
