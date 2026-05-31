import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type {
  ImportLocalProjectFile,
  ImportLocalProjectResponse,
} from '@open-design/contracts';
import { useT } from '../i18n';
import { importLocalProject } from '../state/projects';
import { Icon } from './Icon';

interface Props {
  onImported: (response: ImportLocalProjectResponse) => void | Promise<void>;
}

// Build/dependency directories never uploaded — mirrors the daemon's
// LOCAL_IMPORT_SKIP_DIRS so we don't read a giant node_modules into memory.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.turbo',
  '.cache', '.output', 'out', 'coverage', '__pycache__', '.venv',
  'vendor', 'target', '.od', '.tmp',
]);

type PickedFile = { relPath: string; file: File };

function hasSkippedSegment(relPath: string): boolean {
  return relPath
    .split('/')
    .filter(Boolean)
    .some((seg) => SKIP_DIRS.has(seg.toLowerCase()));
}

// Strip a common top-level directory so the project root is the folder's
// contents (e.g. dropping "my-app" makes index.html the entry, not
// my-app/index.html). Only strips when every path shares the same first
// segment, which holds for a single dragged/picked folder.
function stripCommonRoot(paths: PickedFile[]): PickedFile[] {
  if (paths.length === 0) return paths;
  const first = paths[0]!.relPath.split('/')[0];
  if (!first) return paths;
  const allShare = paths.every((p) => p.relPath.split('/')[0] === first && p.relPath.includes('/'));
  if (!allShare) return paths;
  return paths.map((p) => ({ ...p, relPath: p.relPath.split('/').slice(1).join('/') }));
}

async function readFileSystemEntry(
  entry: FileSystemEntry,
  out: PickedFile[],
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) =>
      fileEntry.file(resolve, reject),
    );
    const rel = entry.fullPath.replace(/^\/+/, '');
    if (!hasSkippedSegment(rel)) out.push({ relPath: rel, file });
    return;
  }
  if (entry.isDirectory) {
    const name = entry.name.toLowerCase();
    if (SKIP_DIRS.has(name)) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns batches; loop until it yields an empty array.
    const entries: FileSystemEntry[] = [];
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

async function readDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const items = Array.from(dt.items).filter((i) => i.kind === 'file');
  const entries = items
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => Boolean(e));
  if (entries.length > 0) {
    for (const entry of entries) await readFileSystemEntry(entry, out);
    return stripCommonRoot(out);
  }
  // Fallback: no entries (rare) — use the flat file list.
  for (const file of Array.from(dt.files)) {
    out.push({ relPath: file.name, file });
  }
  return out;
}

function readInputFiles(list: FileList): PickedFile[] {
  const out: PickedFile[] = [];
  for (const file of Array.from(list)) {
    const rel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    if (!hasSkippedSegment(rel)) out.push({ relPath: rel, file });
  }
  return stripCommonRoot(out);
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

async function toImportFiles(picked: PickedFile[]): Promise<ImportLocalProjectFile[]> {
  const files: ImportLocalProjectFile[] = [];
  for (const { relPath, file } of picked) {
    const buffer = await file.arrayBuffer();
    files.push({ path: relPath, contentBase64: arrayBufferToBase64(buffer) });
  }
  return files;
}

function folderNameFrom(picked: PickedFile[]): string {
  // Best-effort label from a webkitRelativePath top segment, if any.
  for (const p of picked) {
    const wr = (p.file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (wr && wr.includes('/')) return wr.split('/')[0]!;
  }
  return '';
}

export function ImportLocalProjectButton({ onImported }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setDragging(false);
    setError(null);
  }, [busy]);

  const runImport = useCallback(
    async (picked: PickedFile[], suggestedName: string) => {
      if (busy) return;
      if (picked.length === 0) {
        setError(t('importLocal.errorEmpty'));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const files = await toImportFiles(picked);
        const name = suggestedName.trim();
        const response = await importLocalProject({
          files,
          ...(name ? { name } : {}),
        });
        await onImported(response);
        setOpen(false);
        setDragging(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('importLocal.errorGeneric'));
      } finally {
        setBusy(false);
      }
    },
    [busy, onImported, t],
  );

  const onDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      if (busy) return;
      const picked = await readDataTransfer(event.dataTransfer);
      await runImport(picked, folderNameFrom(picked));
    },
    [busy, runImport],
  );

  return (
    <>
      <button
        type="button"
        className="designs-select-toggle"
        onClick={() => setOpen(true)}
        data-testid="import-local-project"
      >
        <Icon name="import" size={13} />
        <span>{t('importLocal.button')}</span>
      </button>
      {open ? (
        <div className="modal-backdrop" onClick={close}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('importLocal.title')}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{t('importLocal.title')}</h2>
            <p className="modal-confirm-message">{t('importLocal.subtitle')}</p>
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
                {busy ? t('importLocal.importing') : t('importLocal.dropHint')}
              </span>
              {!busy ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => inputRef.current?.click()}
                >
                  {t('importLocal.pick')}
                </button>
              ) : null}
              <input
                ref={inputRef}
                type="file"
                hidden
                // @ts-expect-error — non-standard but widely supported folder picker attrs.
                webkitdirectory=""
                directory=""
                multiple
                onChange={(e) => {
                  const list = e.target.files;
                  if (!list) return;
                  const picked = readInputFiles(list);
                  void runImport(picked, folderNameFrom(picked));
                  e.target.value = '';
                }}
              />
            </div>
            {error ? <p className="import-local-error">{error}</p> : null}
            <div className="row">
              <button type="button" onClick={close} disabled={busy}>
                {t('importLocal.cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
