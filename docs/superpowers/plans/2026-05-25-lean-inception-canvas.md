# Lean Inception Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fixed "Lean Inception" tab in every project's FileWorkspace with a kanban canvas (7 columns + zoom/pan), drawer for card detail, drag-and-drop upload, and toolbar with documents/remove/reset — fully consuming `LeanInceptionState` from `@open-design/contracts`.

**Architecture:** Hook-based data layer (`useLeanInception(projectId)`) drives a tree of presentational components in `apps/web/src/components/lean-inception/`. Integration is a single `if (activeTab === LEAN_INCEPTION_TAB)` branch in `FileWorkspace.tsx`, following the same pinned-tab pattern as `DESIGN_FILES_TAB`/`DESIGN_SYSTEM_TAB`. No new route, no global state. Source-of-truth for design: `docs/superpowers/specs/2026-05-25-lean-inception-canvas-design.md`.

**Tech Stack:** React 18, TypeScript strict, Tailwind CSS v4, Vitest + @testing-library/react, lucide-react icons, `react-zoom-pan-pinch` (new dep) for zoom/pan, `@open-design/contracts` (workspace).

---

## File Structure (locked decisions)

### New files

| Path | Responsibility |
|---|---|
| `apps/web/src/components/lean-inception/constants.ts` | `LEAN_INCEPTION_TAB`, status/confidence color maps, file ext whitelist |
| `apps/web/src/components/lean-inception/useLeanInception.ts` | Hook: `state`, `isLoading`, `isMutating`, `error`, `refresh`, `extract`, `removeDocument`, `reset` |
| `apps/web/src/components/lean-inception/LeanInceptionCanvas.tsx` | Orchestrator: hook + local UI state + composition |
| `apps/web/src/components/lean-inception/LeanInceptionToolbar.tsx` | Add / Documents popover / Refresh / Reset / Zoom controls |
| `apps/web/src/components/lean-inception/LeanInceptionBoard.tsx` | Zoom/pan wrapper + drag-drop area + columns grid |
| `apps/web/src/components/lean-inception/LeanInceptionColumn.tsx` | Column header + cards stack |
| `apps/web/src/components/lean-inception/LeanInceptionCard.tsx` | Compact card with confidence dot |
| `apps/web/src/components/lean-inception/LeanInceptionDetailDrawer.tsx` | Right-side drawer with source_anchor + line + filename |
| `apps/web/src/components/lean-inception/LeanInceptionDocumentsList.tsx` | Popover content with doc list + remove buttons |
| `apps/web/src/components/lean-inception/LeanInceptionDropOverlay.tsx` | Overlay during drag-drop |
| `apps/web/src/components/lean-inception/LeanInceptionEmptyState.tsx` | CTA when 0 documents |
| `apps/web/src/components/lean-inception/lean-inception.css` | `.li-board-grid`, `.li-card`, `.li-no-pan`, drawer slide, drop overlay |
| `apps/web/tests/lean-inception/useLeanInception.test.tsx` | Hook tests with mocked fetch |
| `apps/web/tests/lean-inception/LeanInceptionColumn.test.tsx` | Column render + click |
| `apps/web/tests/lean-inception/LeanInceptionCard.test.tsx` | Card render + click + confidence dot |
| `apps/web/tests/lean-inception/LeanInceptionDetailDrawer.test.tsx` | Drawer open/close + content |
| `apps/web/tests/lean-inception/LeanInceptionToolbar.test.tsx` | Toolbar interactions |
| `apps/web/tests/lean-inception/LeanInceptionEmptyState.test.tsx` | Empty state CTA |
| `apps/web/tests/lean-inception/LeanInceptionDropOverlay.test.tsx` | Drop overlay visibility |

### Modified files

| Path | Change |
|---|---|
| `apps/web/package.json` | Add `react-zoom-pan-pinch` to dependencies |
| `apps/web/src/i18n/types.ts` | Add 39 new keys to the `Dict` type |
| `apps/web/src/i18n/locales/en.ts` | Add EN translations |
| `apps/web/src/i18n/locales/{18 others}.ts` | Add EN strings as fallback (mark `TODO: translate`) |
| `apps/web/src/components/FileWorkspace.tsx` | Add `LEAN_INCEPTION_TAB` button (leftmost, fixed) + branch in render to mount `<LeanInceptionCanvas projectId={projectId} />` |
| `apps/web/src/index.css` | `@import "./components/lean-inception/lean-inception.css"` |

---

## Conventions Used Throughout

- **Commit format:** Conventional Commits with `(web)` scope. No `Co-authored-by` trailers.
- **Test runner:** Vitest. Run from `apps/web`: `pnpm --filter @open-design/web test <pattern>`.
- **TypeScript:** Strict. Component props always typed. No `any`.
- **TDD discipline:** Failing test → RED → implementation → GREEN → commit.

---

## Task 1: Install `react-zoom-pan-pinch`

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add dependency**

```bash
cd /Users/elite1/dev/pendesign/apps/web
pnpm add react-zoom-pan-pinch@3.7.0
```

(Use the latest stable version compatible with React 18.)

- [ ] **Step 2: Verify install**

```bash
cd /Users/elite1/dev/pendesign/apps/web && cat package.json | grep react-zoom-pan-pinch
```

Expected: line showing the dep installed.

- [ ] **Step 3: Run typecheck to confirm nothing broke**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web typecheck
```

Expected: no new errors. Pre-existing errors in `src/templates/vite-react/**` on this branch are out of scope.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add react-zoom-pan-pinch dependency"
```

---

## Task 2: Constants module

**Files:**
- Create: `apps/web/src/components/lean-inception/constants.ts`

- [ ] **Step 1: Create the file**

```ts
// apps/web/src/components/lean-inception/constants.ts
import type {
  LeanInceptionColumnStatus,
  LeanInceptionConfidence,
  LeanInceptionColumnKey,
} from '@open-design/contracts';

export const LEAN_INCEPTION_TAB = '__lean_inception__';

export const SUPPORTED_EXTENSIONS = new Set<string>(['.md', '.txt']);

export const STATUS_COLOR_CLASS: Record<LeanInceptionColumnStatus, string> = {
  complete:        'text-green-500',
  partial:         'text-amber-500',
  insufficient:    'text-orange-500',
  not_identified:  'text-neutral-400',
};

export const CONFIDENCE_DOT_CLASS: Record<LeanInceptionConfidence, string> = {
  high:   'bg-green-500',
  medium: 'bg-amber-500',
  low:    'bg-neutral-400',
};

export const COLUMN_ORDER: readonly LeanInceptionColumnKey[] = [
  'vision',
  'objective',
  'problem',
  'personas',
  'features',
  'business_rules',
  'acceptance_criteria',
];

export const MAX_FILE_BYTES = 500 * 1024;
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web typecheck 2>&1 | grep -E "lean-inception" | head -10
```

Expected: no errors in `lean-inception/`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/lean-inception/constants.ts
git commit -m "feat(web): add lean-inception canvas constants"
```

---

## Task 3: Hook `useLeanInception` (data layer)

**Files:**
- Create: `apps/web/src/components/lean-inception/useLeanInception.ts`
- Test:   `apps/web/tests/lean-inception/useLeanInception.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/tests/lean-inception/useLeanInception.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLeanInception } from '../../src/components/lean-inception/useLeanInception';

const emptyState = (projectId: string) => ({
  inception_id: 'li_1',
  project_id: projectId,
  documents: [],
  columns: {
    vision:              { status: 'not_identified', cards: [] },
    objective:           { status: 'not_identified', cards: [] },
    problem:             { status: 'not_identified', cards: [] },
    personas:            { status: 'not_identified', cards: [] },
    features:            { status: 'not_identified', cards: [] },
    business_rules:      { status: 'not_identified', cards: [] },
    acceptance_criteria: { status: 'not_identified', cards: [] },
  },
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLeanInception', () => {
  it('loads state on mount', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ state: emptyState('prj_1') }),
    });
    const { result } = renderHook(() => useLeanInception('prj_1'));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.state?.project_id).toBe('prj_1');
    expect(result.current.error).toBeNull();
  });

  it('sets error when initial fetch fails', async () => {
    (fetch as any).mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useLeanInception('prj_1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toMatch(/network down/);
  });

  it('extract posts base64 documents and updates state', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          state: { ...emptyState('prj_1'), documents: [{ id: 'doc_1', filename: 'a.md', mime_type: 'text/markdown', byte_size: 5, content_hash: 'h', ingested_at: 't', last_extracted_at: 't', extraction_status: 'extracted', extraction_error: null, card_count: 0 }] },
          extractions: [],
        }),
      });
    const { result } = renderHook(() => useLeanInception('prj_1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const file = new File(['hello'], 'a.md', { type: 'text/markdown' });
    await act(async () => { await result.current.extract([file]); });

    expect(result.current.state?.documents).toHaveLength(1);
    const lastCall = (fetch as any).mock.calls.at(-1);
    expect(lastCall[0]).toContain('/api/projects/prj_1/lean-inception/documents');
    expect(lastCall[1].method).toBe('POST');
    const body = JSON.parse(lastCall[1].body);
    expect(body.documents[0].mime_type).toBe('text/markdown');
    expect(body.documents[0].content_base64).toBe(Buffer.from('hello').toString('base64'));
  });

  it('extract rejects unsupported formats locally without fetching', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) });
    const { result } = renderHook(() => useLeanInception('prj_1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    await act(async () => { await result.current.extract([file]); });

    expect((fetch as any).mock.calls).toHaveLength(1); // only the initial GET
    expect(result.current.error).toMatch(/Only .md and .txt/);
  });

  it('removeDocument issues DELETE and updates state', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) });
    const { result } = renderHook(() => useLeanInception('prj_1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.removeDocument('doc_1'); });
    const lastCall = (fetch as any).mock.calls.at(-1);
    expect(lastCall[0]).toContain('/api/projects/prj_1/lean-inception/documents/doc_1');
    expect(lastCall[1].method).toBe('DELETE');
  });

  it('reset issues DELETE on inception then refresh', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) }) // mount
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })                  // reset
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState('prj_1') }) }); // refresh
    const { result } = renderHook(() => useLeanInception('prj_1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.reset(); });
    expect((fetch as any).mock.calls).toHaveLength(3);
    expect((fetch as any).mock.calls[1][1].method).toBe('DELETE');
    expect((fetch as any).mock.calls[2][1]?.method ?? 'GET').toBe('GET');
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test useLeanInception
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/web/src/components/lean-inception/useLeanInception.ts
import { useCallback, useEffect, useState } from 'react';
import type {
  LeanInceptionState,
  LeanInceptionError,
  ExtractDocumentsResponse,
  ExtractDocumentInput,
} from '@open-design/contracts';
import { SUPPORTED_EXTENSIONS } from './constants.js';

export interface UseLeanInception {
  state: LeanInceptionState | null;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  extract: (files: File[]) => Promise<void>;
  removeDocument: (documentId: string) => Promise<void>;
  reset: () => Promise<void>;
}

const baseFor = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/lean-inception`;

async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fileExtension(file: File): string {
  const idx = file.name.lastIndexOf('.');
  return idx >= 0 ? file.name.slice(idx).toLowerCase() : '';
}

function fileMime(file: File): 'text/markdown' | 'text/plain' | null {
  const ext = fileExtension(file);
  if (ext === '.md') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
  return null;
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

export function useLeanInception(projectId: string): UseLeanInception {
  const [state, setState] = useState<LeanInceptionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async (): Promise<void> => {
    setError(null);
    const res = await fetch(baseFor(projectId), { method: 'GET' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: LeanInceptionError } | null;
      throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { state: LeanInceptionState };
    setState(data.state);
  }, [projectId]);

  const refresh = useCallback(async (): Promise<void> => {
    setIsMutating(true);
    try { await fetchState(); }
    catch (e) { setError(errorToString(e)); }
    finally { setIsMutating(false); }
  }, [fetchState]);

  const extract = useCallback(async (files: File[]): Promise<void> => {
    setError(null);
    const docs: ExtractDocumentInput[] = [];
    for (const file of files) {
      const mime = fileMime(file);
      if (!mime || !SUPPORTED_EXTENSIONS.has(fileExtension(file))) {
        setError('Only .md and .txt are supported.');
        return;
      }
      const content_base64 = await readFileAsBase64(file);
      docs.push({ filename: file.name, mime_type: mime, content_base64 });
    }
    setIsMutating(true);
    try {
      const res = await fetch(`${baseFor(projectId)}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documents: docs }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: LeanInceptionError } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ExtractDocumentsResponse;
      setState(data.state);
    } catch (e) {
      setError(errorToString(e));
    } finally {
      setIsMutating(false);
    }
  }, [projectId]);

  const removeDocument = useCallback(async (documentId: string): Promise<void> => {
    setError(null);
    setIsMutating(true);
    try {
      const res = await fetch(`${baseFor(projectId)}/documents/${encodeURIComponent(documentId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: LeanInceptionError } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { state: LeanInceptionState };
      setState(data.state);
    } catch (e) {
      setError(errorToString(e));
    } finally {
      setIsMutating(false);
    }
  }, [projectId]);

  const reset = useCallback(async (): Promise<void> => {
    setError(null);
    setIsMutating(true);
    try {
      const res = await fetch(baseFor(projectId), { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: LeanInceptionError } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      await fetchState();
    } catch (e) {
      setError(errorToString(e));
    } finally {
      setIsMutating(false);
    }
  }, [projectId, fetchState]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchState()
      .catch((e) => { if (!cancelled) setError(errorToString(e)); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [fetchState]);

  return { state, isLoading, isMutating, error, refresh, extract, removeDocument, reset };
}
```

- [ ] **Step 4: Verify GREEN**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test useLeanInception
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lean-inception/useLeanInception.ts apps/web/tests/lean-inception/useLeanInception.test.tsx
git commit -m "feat(web): add useLeanInception data hook"
```

---

## Task 4: i18n keys (types + 19 locales)

**Files:**
- Modify: `apps/web/src/i18n/types.ts`
- Modify: `apps/web/src/i18n/locales/en.ts`
- Modify: `apps/web/src/i18n/locales/{18 others}.ts`

- [ ] **Step 1: Add keys to types.ts**

Find the `Dict` interface (or type alias) in `apps/web/src/i18n/types.ts`. Add these keys to it (use `grep -n "Dict" apps/web/src/i18n/types.ts` if structure isn't obvious):

```ts
'lean_inception.tab.title':                       string;
'lean_inception.column.vision':                   string;
'lean_inception.column.objective':                string;
'lean_inception.column.problem':                  string;
'lean_inception.column.personas':                 string;
'lean_inception.column.features':                 string;
'lean_inception.column.business_rules':           string;
'lean_inception.column.acceptance_criteria':      string;
'lean_inception.status.complete':                 string;
'lean_inception.status.partial':                  string;
'lean_inception.status.insufficient':             string;
'lean_inception.status.not_identified':           string;
'lean_inception.toolbar.add_document':            string;
'lean_inception.toolbar.documents':               string;
'lean_inception.toolbar.refresh':                 string;
'lean_inception.toolbar.reset':                   string;
'lean_inception.toolbar.zoom_in':                 string;
'lean_inception.toolbar.zoom_out':                string;
'lean_inception.toolbar.zoom_fit':                string;
'lean_inception.empty.title':                     string;
'lean_inception.empty.description':               string;
'lean_inception.drop.title':                      string;
'lean_inception.detail.source':                   string;
'lean_inception.detail.line':                     string;
'lean_inception.confirm.reset.title':             string;
'lean_inception.confirm.reset.description':       string;
'lean_inception.confirm.reset.confirm':           string;
'lean_inception.confirm.reset.cancel':            string;
'lean_inception.error.unsupported_format':        string;
'lean_inception.error.document_too_large':        string;
'lean_inception.error.daemon_unreachable':        string;
'lean_inception.error.extraction_failed':         string;
'lean_inception.error.document_not_found':        string;
'lean_inception.error.generic':                   string;
```

(34 keys total — adjust the exact insertion to match the file's syntax style.)

- [ ] **Step 2: Add EN translations to `en.ts`**

```ts
'lean_inception.tab.title':                       'Lean Inception',
'lean_inception.column.vision':                   'Vision',
'lean_inception.column.objective':                'Objective',
'lean_inception.column.problem':                  'Problem',
'lean_inception.column.personas':                 'Personas',
'lean_inception.column.features':                 'Features',
'lean_inception.column.business_rules':           'Business rules',
'lean_inception.column.acceptance_criteria':      'Acceptance criteria',
'lean_inception.status.complete':                 'Complete',
'lean_inception.status.partial':                  'Partial',
'lean_inception.status.insufficient':             'Insufficient',
'lean_inception.status.not_identified':           'Not identified',
'lean_inception.toolbar.add_document':            'Add document',
'lean_inception.toolbar.documents':               'Documents',
'lean_inception.toolbar.refresh':                 'Refresh',
'lean_inception.toolbar.reset':                   'Reset',
'lean_inception.toolbar.zoom_in':                 'Zoom in',
'lean_inception.toolbar.zoom_out':                'Zoom out',
'lean_inception.toolbar.zoom_fit':                'Fit',
'lean_inception.empty.title':                     'No documents yet',
'lean_inception.empty.description':               'Drag and drop .md or .txt files, or click Add document.',
'lean_inception.drop.title':                      'Drop .md or .txt files to extract',
'lean_inception.detail.source':                   'Source',
'lean_inception.detail.line':                     'Line {line}',
'lean_inception.confirm.reset.title':             'Reset Lean Inception?',
'lean_inception.confirm.reset.description':       'This deletes all documents and cards. Cannot be undone.',
'lean_inception.confirm.reset.confirm':           'Reset',
'lean_inception.confirm.reset.cancel':            'Cancel',
'lean_inception.error.unsupported_format':        'Only .md and .txt are supported.',
'lean_inception.error.document_too_large':        'Document exceeds the size limit.',
'lean_inception.error.daemon_unreachable':        'Daemon is unreachable. Is it running?',
'lean_inception.error.extraction_failed':         'Extraction failed: {message}',
'lean_inception.error.document_not_found':        'Document not found.',
'lean_inception.error.generic':                   'An error occurred: {message}',
```

- [ ] **Step 3: Add fallback EN strings to the other 18 locales**

For each of: `id.ts`, `de.ts`, `zh-CN.ts`, `zh-TW.ts`, `pt-BR.ts`, `es-ES.ts`, `ru.ts`, `fa.ts`, `ar.ts`, `ja.ts`, `ko.ts`, `pl.ts`, `hu.ts`, `fr.ts`, `uk.ts`, `tr.ts`, `th.ts`, `it.ts` — append the same EN block from Step 2, prefixed with a comment line:

```ts
// TODO: translate (currently fallback to EN)
```

Translations can be improved later; goal here is to satisfy typecheck.

- [ ] **Step 4: Verify typecheck**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web typecheck 2>&1 | grep -E "lean_inception|i18n" | head -20
```

Expected: no errors. If a locale is missing a key, typecheck will complain — add the missing key and retry.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/types.ts apps/web/src/i18n/locales/
git commit -m "feat(web): add lean-inception i18n keys (EN + fallbacks)"
```

---

## Task 5: Card component

**Files:**
- Create: `apps/web/src/components/lean-inception/LeanInceptionCard.tsx`
- Test:   `apps/web/tests/lean-inception/LeanInceptionCard.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/tests/lean-inception/LeanInceptionCard.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeanInceptionCard } from '../../src/components/lean-inception/LeanInceptionCard';

const baseCard = {
  id: 'card_1',
  inception_id: 'li_1',
  document_id: 'doc_1',
  column_key: 'vision' as const,
  title: 'Build the best product',
  content: 'desc',
  confidence: 'high' as const,
  source_anchor: 'we build the best product',
  source_line: 12,
  extraction_id: 'ext_1',
  created_at: '2026-05-25',
};

describe('LeanInceptionCard', () => {
  it('renders title and confidence dot for high', () => {
    render(<LeanInceptionCard card={baseCard} onClick={() => {}} />);
    expect(screen.getByText('Build the best product')).toBeInTheDocument();
    expect(screen.getByTestId('confidence-dot')).toHaveClass('bg-green-500');
  });

  it('uses amber dot for medium confidence', () => {
    render(<LeanInceptionCard card={{ ...baseCard, confidence: 'medium' }} onClick={() => {}} />);
    expect(screen.getByTestId('confidence-dot')).toHaveClass('bg-amber-500');
  });

  it('uses neutral dot for low confidence', () => {
    render(<LeanInceptionCard card={{ ...baseCard, confidence: 'low' }} onClick={() => {}} />);
    expect(screen.getByTestId('confidence-dot')).toHaveClass('bg-neutral-400');
  });

  it('shows source line when present', () => {
    render(<LeanInceptionCard card={baseCard} onClick={() => {}} />);
    expect(screen.getByText(/L12|line 12/i)).toBeInTheDocument();
  });

  it('omits source line indicator when null', () => {
    render(<LeanInceptionCard card={{ ...baseCard, source_line: null }} onClick={() => {}} />);
    expect(screen.queryByText(/L12|line 12/i)).toBeNull();
  });

  it('calls onClick when activated', async () => {
    const onClick = vi.fn();
    render(<LeanInceptionCard card={baseCard} onClick={onClick} filename="discovery.md" />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith(baseCard);
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionCard
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/lean-inception/LeanInceptionCard.tsx
import type { LeanInceptionCard as Card } from '@open-design/contracts';
import { CONFIDENCE_DOT_CLASS } from './constants.js';

interface Props {
  card: Card;
  filename?: string;
  onClick: (card: Card) => void;
}

export function LeanInceptionCard({ card, filename, onClick }: Props) {
  return (
    <button
      type="button"
      className="li-card li-no-pan w-full text-left p-3 rounded-md bg-white shadow-sm hover:shadow-md border border-neutral-200 flex flex-col gap-1"
      onClick={() => onClick(card)}
      data-testid={`card-${card.id}`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          data-testid="confidence-dot"
          className={`mt-1.5 inline-block w-2 h-2 rounded-full flex-shrink-0 ${CONFIDENCE_DOT_CLASS[card.confidence]}`}
        />
        <span className="text-sm font-medium text-neutral-900 line-clamp-2">
          {card.title}
        </span>
      </div>
      <div className="text-xs text-neutral-500 truncate">
        {filename}
        {card.source_line != null && (
          <span className="ml-1 text-neutral-400">· L{card.source_line}</span>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Verify GREEN**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionCard
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lean-inception/LeanInceptionCard.tsx apps/web/tests/lean-inception/LeanInceptionCard.test.tsx
git commit -m "feat(web): add LeanInceptionCard component"
```

---

## Task 6: Column component

**Files:**
- Create: `apps/web/src/components/lean-inception/LeanInceptionColumn.tsx`
- Test:   `apps/web/tests/lean-inception/LeanInceptionColumn.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/tests/lean-inception/LeanInceptionColumn.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LeanInceptionColumn } from '../../src/components/lean-inception/LeanInceptionColumn';

const cardOf = (i: number) => ({
  id: `card_${i}`,
  inception_id: 'li_1',
  document_id: 'doc_1',
  column_key: 'personas' as const,
  title: `Persona ${i}`,
  content: 'c',
  confidence: 'high' as const,
  source_anchor: 'a',
  source_line: i,
  extraction_id: 'ext_1',
  created_at: 't',
});

const docMap = new Map([['doc_1', 'discovery.md']]);

describe('LeanInceptionColumn', () => {
  it('renders header with translated label and count', () => {
    render(
      <LeanInceptionColumn
        columnKey="personas"
        status="complete"
        cards={[cardOf(1), cardOf(2), cardOf(3)]}
        documentNames={docMap}
        onCardClick={() => {}}
      />,
    );
    expect(screen.getByText(/Personas/i)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows empty placeholder when no cards', () => {
    render(
      <LeanInceptionColumn
        columnKey="vision"
        status="not_identified"
        cards={[]}
        documentNames={docMap}
        onCardClick={() => {}}
      />,
    );
    expect(screen.getByTestId('column-empty')).toBeInTheDocument();
  });

  it('calls onCardClick when a card is clicked', async () => {
    const onCardClick = vi.fn();
    const u = (await import('@testing-library/user-event')).default;
    render(
      <LeanInceptionColumn
        columnKey="personas"
        status="partial"
        cards={[cardOf(1)]}
        documentNames={docMap}
        onCardClick={onCardClick}
      />,
    );
    await u.click(screen.getByTestId('card-card_1'));
    expect(onCardClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionColumn
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/lean-inception/LeanInceptionColumn.tsx
import type {
  LeanInceptionCard,
  LeanInceptionColumnKey,
  LeanInceptionColumnStatus,
} from '@open-design/contracts';
import { useT } from '../../i18n';
import { STATUS_COLOR_CLASS } from './constants.js';
import { LeanInceptionCard as CardView } from './LeanInceptionCard.js';

interface Props {
  columnKey: LeanInceptionColumnKey;
  status: LeanInceptionColumnStatus;
  cards: LeanInceptionCard[];
  documentNames: Map<string, string>;
  onCardClick: (card: LeanInceptionCard) => void;
}

export function LeanInceptionColumn({ columnKey, status, cards, documentNames, onCardClick }: Props) {
  const t = useT();
  return (
    <div className="li-column w-[280px] flex-shrink-0 flex flex-col bg-neutral-50 rounded-lg p-3 gap-3">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">
          {t(`lean_inception.column.${columnKey}` as const)}
        </h3>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${STATUS_COLOR_CLASS[status]}`}>
            {t(`lean_inception.status.${status}` as const)}
          </span>
          <span className="text-xs text-neutral-500 tabular-nums">{cards.length}</span>
        </div>
      </header>
      <div className="flex flex-col gap-2 min-h-[120px]">
        {cards.length === 0 ? (
          <div data-testid="column-empty" className="text-xs text-neutral-400 italic px-1">
            —
          </div>
        ) : (
          cards.map((card) => (
            <CardView
              key={card.id}
              card={card}
              filename={documentNames.get(card.document_id)}
              onClick={onCardClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
```

> **Note about `useT()`:** The web app uses a `useT()` hook from `'../../i18n'` (verify by grep `useT` in any existing component for the exact import). If the actual hook name differs (e.g. `useTranslation`), adapt the import accordingly.

- [ ] **Step 4: Verify GREEN**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionColumn
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lean-inception/LeanInceptionColumn.tsx apps/web/tests/lean-inception/LeanInceptionColumn.test.tsx
git commit -m "feat(web): add LeanInceptionColumn component"
```

---

## Task 7: Detail drawer component

**Files:**
- Create: `apps/web/src/components/lean-inception/LeanInceptionDetailDrawer.tsx`
- Test:   `apps/web/tests/lean-inception/LeanInceptionDetailDrawer.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/tests/lean-inception/LeanInceptionDetailDrawer.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeanInceptionDetailDrawer } from '../../src/components/lean-inception/LeanInceptionDetailDrawer';

const card = {
  id: 'card_1',
  inception_id: 'li_1',
  document_id: 'doc_1',
  column_key: 'features' as const,
  title: 'Sync stock counts',
  content: 'Push stock to Shopify and Mercado Livre.',
  confidence: 'high' as const,
  source_anchor: 'Push catalogue changes to Shopify and Mercado Livre simultaneously.',
  source_line: 17,
  extraction_id: 'ext_1',
  created_at: 't',
};

describe('LeanInceptionDetailDrawer', () => {
  it('renders nothing when card is null', () => {
    const { container } = render(
      <LeanInceptionDetailDrawer card={null} filename={null} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title, content, source_anchor, line, filename', () => {
    render(
      <LeanInceptionDetailDrawer card={card} filename="discovery.md" onClose={() => {}} />,
    );
    expect(screen.getByText('Sync stock counts')).toBeInTheDocument();
    expect(screen.getByText('Push stock to Shopify and Mercado Livre.')).toBeInTheDocument();
    expect(screen.getByText(card.source_anchor)).toBeInTheDocument();
    expect(screen.getByText(/Line 17/)).toBeInTheDocument();
    expect(screen.getByText('discovery.md')).toBeInTheDocument();
  });

  it('calls onClose on X button click', async () => {
    const onClose = vi.fn();
    render(<LeanInceptionDetailDrawer card={card} filename="x.md" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on ESC key', async () => {
    const onClose = vi.fn();
    render(<LeanInceptionDetailDrawer card={card} filename="x.md" onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionDetailDrawer
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/lean-inception/LeanInceptionDetailDrawer.tsx
import { useEffect } from 'react';
import type { LeanInceptionCard } from '@open-design/contracts';
import { useT } from '../../i18n';
import { CONFIDENCE_DOT_CLASS } from './constants.js';

interface Props {
  card: LeanInceptionCard | null;
  filename: string | null;
  onClose: () => void;
}

export function LeanInceptionDetailDrawer({ card, filename, onClose }: Props) {
  const t = useT();

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, onClose]);

  if (!card) return null;

  return (
    <>
      <div
        className="li-drawer-scrim fixed inset-0 bg-black/10 z-40"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="li-drawer fixed top-0 right-0 h-full w-[400px] bg-white z-50 shadow-xl flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between p-4 border-b border-neutral-200">
          <div className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-1.5 inline-block w-2 h-2 rounded-full ${CONFIDENCE_DOT_CLASS[card.confidence]}`}
            />
            <h2 className="text-base font-semibold text-neutral-900">{card.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-500 hover:text-neutral-900"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4 space-y-4 text-sm text-neutral-700">
          <p>{card.content}</p>
          <section>
            <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
              {t('lean_inception.detail.source')}
            </h3>
            <blockquote className="border-l-2 border-neutral-300 pl-3 italic text-neutral-700">
              {card.source_anchor}
            </blockquote>
            <div className="mt-2 text-xs text-neutral-500">
              {filename && <span>{filename}</span>}
              {card.source_line != null && (
                <span className="ml-2">{t('lean_inception.detail.line').replace('{line}', String(card.source_line))}</span>
              )}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 4: Verify GREEN**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionDetailDrawer
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lean-inception/LeanInceptionDetailDrawer.tsx apps/web/tests/lean-inception/LeanInceptionDetailDrawer.test.tsx
git commit -m "feat(web): add LeanInceptionDetailDrawer component"
```

---

## Task 8: Empty state component

**Files:**
- Create: `apps/web/src/components/lean-inception/LeanInceptionEmptyState.tsx`
- Test:   `apps/web/tests/lean-inception/LeanInceptionEmptyState.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/tests/lean-inception/LeanInceptionEmptyState.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeanInceptionEmptyState } from '../../src/components/lean-inception/LeanInceptionEmptyState';

describe('LeanInceptionEmptyState', () => {
  it('renders title, description, and CTA', () => {
    render(<LeanInceptionEmptyState onAdd={() => {}} />);
    expect(screen.getByText('No documents yet')).toBeInTheDocument();
    expect(screen.getByText(/Drag and drop/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add document/i })).toBeInTheDocument();
  });

  it('calls onAdd when CTA clicked', async () => {
    const onAdd = vi.fn();
    render(<LeanInceptionEmptyState onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: /Add document/i }));
    expect(onAdd).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionEmptyState
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/lean-inception/LeanInceptionEmptyState.tsx
import { useT } from '../../i18n';

interface Props {
  onAdd: () => void;
}

export function LeanInceptionEmptyState({ onAdd }: Props) {
  const t = useT();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 pointer-events-none">
      <div className="bg-white/90 rounded-xl shadow-sm px-8 py-6 max-w-md pointer-events-auto">
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">
          {t('lean_inception.empty.title')}
        </h2>
        <p className="text-sm text-neutral-600 mb-4">
          {t('lean_inception.empty.description')}
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="px-4 py-2 rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
        >
          {t('lean_inception.toolbar.add_document')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify GREEN**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionEmptyState
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lean-inception/LeanInceptionEmptyState.tsx apps/web/tests/lean-inception/LeanInceptionEmptyState.test.tsx
git commit -m "feat(web): add LeanInceptionEmptyState component"
```

---

## Task 9: Drop overlay component

**Files:**
- Create: `apps/web/src/components/lean-inception/LeanInceptionDropOverlay.tsx`
- Test:   `apps/web/tests/lean-inception/LeanInceptionDropOverlay.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/tests/lean-inception/LeanInceptionDropOverlay.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LeanInceptionDropOverlay } from '../../src/components/lean-inception/LeanInceptionDropOverlay';

describe('LeanInceptionDropOverlay', () => {
  it('renders message when active', () => {
    render(<LeanInceptionDropOverlay active={true} />);
    expect(screen.getByText(/Drop .md or .txt/i)).toBeInTheDocument();
  });

  it('returns null when inactive', () => {
    const { container } = render(<LeanInceptionDropOverlay active={false} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionDropOverlay
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/lean-inception/LeanInceptionDropOverlay.tsx
import { useT } from '../../i18n';

interface Props {
  active: boolean;
}

export function LeanInceptionDropOverlay({ active }: Props) {
  const t = useT();
  if (!active) return null;
  return (
    <div className="li-drop-overlay absolute inset-0 z-30 flex items-center justify-center bg-blue-50/80 border-4 border-dashed border-blue-400 rounded-xl pointer-events-none">
      <p className="text-blue-900 text-lg font-medium">{t('lean_inception.drop.title')}</p>
    </div>
  );
}
```

- [ ] **Step 4: Verify GREEN**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionDropOverlay
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lean-inception/LeanInceptionDropOverlay.tsx apps/web/tests/lean-inception/LeanInceptionDropOverlay.test.tsx
git commit -m "feat(web): add LeanInceptionDropOverlay component"
```

---

## Task 10: Documents list (popover content)

**Files:**
- Create: `apps/web/src/components/lean-inception/LeanInceptionDocumentsList.tsx`

No dedicated test for this small component — covered by toolbar test in Task 11.

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/lean-inception/LeanInceptionDocumentsList.tsx
import type { LeanInceptionDocument } from '@open-design/contracts';

interface Props {
  documents: LeanInceptionDocument[];
  onRemove: (documentId: string) => void;
  disabled: boolean;
}

const STATUS_ICON: Record<LeanInceptionDocument['extraction_status'], string> = {
  pending:    '⏳',
  extracting: '⏳',
  extracted:  '✓',
  failed:     '⚠',
};

export function LeanInceptionDocumentsList({ documents, onRemove, disabled }: Props) {
  if (documents.length === 0) {
    return (
      <div className="p-3 text-sm text-neutral-500 italic">No documents</div>
    );
  }
  return (
    <ul className="li-documents-list py-1">
      {documents.map((doc) => (
        <li
          key={doc.id}
          className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-neutral-50"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span aria-hidden className="text-neutral-500">{STATUS_ICON[doc.extraction_status]}</span>
            <span className="text-sm text-neutral-800 truncate">{doc.filename}</span>
            <span className="text-xs text-neutral-500 tabular-nums">{doc.card_count}</span>
          </div>
          <button
            type="button"
            onClick={() => onRemove(doc.id)}
            disabled={disabled}
            aria-label={`Remove ${doc.filename}`}
            className="text-neutral-400 hover:text-red-500 disabled:opacity-40"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web typecheck 2>&1 | grep -E "DocumentsList" | head -5
```

Expected: empty (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/lean-inception/LeanInceptionDocumentsList.tsx
git commit -m "feat(web): add LeanInceptionDocumentsList component"
```

---

## Task 11: Toolbar

**Files:**
- Create: `apps/web/src/components/lean-inception/LeanInceptionToolbar.tsx`
- Test:   `apps/web/tests/lean-inception/LeanInceptionToolbar.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/tests/lean-inception/LeanInceptionToolbar.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeanInceptionToolbar } from '../../src/components/lean-inception/LeanInceptionToolbar';

const doc = (id: string, status: 'extracted' | 'failed' | 'extracting' | 'pending' = 'extracted') => ({
  id, inception_id: 'li_1', filename: `${id}.md`, mime_type: 'text/markdown',
  byte_size: 1, content_hash: 'h', ingested_at: 't', last_extracted_at: 't',
  extraction_status: status, extraction_error: null, card_count: 0,
});

describe('LeanInceptionToolbar', () => {
  it('disables action buttons when isMutating', () => {
    render(
      <LeanInceptionToolbar
        documents={[doc('a')]}
        isMutating={true}
        onAdd={() => {}} onRefresh={() => {}} onReset={() => {}}
        onRemoveDoc={() => {}}
        onZoomIn={() => {}} onZoomOut={() => {}} onZoomFit={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Add document/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Reset/i })).toBeDisabled();
  });

  it('opens documents popover on click', async () => {
    render(
      <LeanInceptionToolbar
        documents={[doc('a'), doc('b')]}
        isMutating={false}
        onAdd={() => {}} onRefresh={() => {}} onReset={() => {}}
        onRemoveDoc={() => {}}
        onZoomIn={() => {}} onZoomOut={() => {}} onZoomFit={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Documents/i }));
    expect(screen.getByText('a.md')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
  });

  it('fires onAdd when Add clicked', async () => {
    const onAdd = vi.fn();
    render(
      <LeanInceptionToolbar
        documents={[]} isMutating={false}
        onAdd={onAdd} onRefresh={() => {}} onReset={() => {}}
        onRemoveDoc={() => {}}
        onZoomIn={() => {}} onZoomOut={() => {}} onZoomFit={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Add document/i }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('fires onRemoveDoc with id when X clicked in popover', async () => {
    const onRemoveDoc = vi.fn();
    render(
      <LeanInceptionToolbar
        documents={[doc('xyz')]}
        isMutating={false}
        onAdd={() => {}} onRefresh={() => {}} onReset={() => {}}
        onRemoveDoc={onRemoveDoc}
        onZoomIn={() => {}} onZoomOut={() => {}} onZoomFit={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Documents/i }));
    await userEvent.click(screen.getByRole('button', { name: /Remove xyz\.md/i }));
    expect(onRemoveDoc).toHaveBeenCalledWith('xyz');
  });

  it('fires zoom callbacks', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomFit = vi.fn();
    render(
      <LeanInceptionToolbar
        documents={[]} isMutating={false}
        onAdd={() => {}} onRefresh={() => {}} onReset={() => {}}
        onRemoveDoc={() => {}}
        onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomFit={onZoomFit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Zoom in/i }));
    await userEvent.click(screen.getByRole('button', { name: /Zoom out/i }));
    await userEvent.click(screen.getByRole('button', { name: /Fit/i }));
    expect(onZoomIn).toHaveBeenCalled();
    expect(onZoomOut).toHaveBeenCalled();
    expect(onZoomFit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionToolbar
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/lean-inception/LeanInceptionToolbar.tsx
import { useState } from 'react';
import type { LeanInceptionDocument } from '@open-design/contracts';
import { useT } from '../../i18n';
import { LeanInceptionDocumentsList } from './LeanInceptionDocumentsList.js';

interface Props {
  documents: LeanInceptionDocument[];
  isMutating: boolean;
  onAdd: () => void;
  onRefresh: () => void;
  onReset: () => void;
  onRemoveDoc: (documentId: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
}

export function LeanInceptionToolbar(props: Props) {
  const t = useT();
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <div className="li-toolbar flex items-center gap-2 p-2 border-b border-neutral-200 bg-white">
      <button
        type="button"
        onClick={props.onAdd}
        disabled={props.isMutating}
        className="px-3 py-1.5 rounded-md bg-neutral-900 text-white text-sm font-medium disabled:opacity-50"
      >
        + {t('lean_inception.toolbar.add_document')}
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setPopoverOpen((v) => !v)}
          className="px-3 py-1.5 rounded-md text-sm border border-neutral-200 flex items-center gap-1"
        >
          📄 {t('lean_inception.toolbar.documents')} ({props.documents.length}) ▾
        </button>
        {popoverOpen && (
          <div className="li-popover absolute top-full left-0 mt-1 z-20 bg-white border border-neutral-200 rounded-md shadow-md w-72 max-h-64 overflow-auto">
            <LeanInceptionDocumentsList
              documents={props.documents}
              onRemove={props.onRemoveDoc}
              disabled={props.isMutating}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={props.onRefresh}
        disabled={props.isMutating}
        className="px-3 py-1.5 rounded-md text-sm border border-neutral-200 disabled:opacity-50"
        aria-label={t('lean_inception.toolbar.refresh')}
      >
        ↻ {t('lean_inception.toolbar.refresh')}
      </button>

      <button
        type="button"
        onClick={props.onReset}
        disabled={props.isMutating}
        className="px-3 py-1.5 rounded-md text-sm border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        ⚠ {t('lean_inception.toolbar.reset')}
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={props.onZoomOut}
          className="px-2 py-1.5 rounded-md text-sm border border-neutral-200"
          aria-label={t('lean_inception.toolbar.zoom_out')}
        >
          🔍-
        </button>
        <button
          type="button"
          onClick={props.onZoomIn}
          className="px-2 py-1.5 rounded-md text-sm border border-neutral-200"
          aria-label={t('lean_inception.toolbar.zoom_in')}
        >
          🔍+
        </button>
        <button
          type="button"
          onClick={props.onZoomFit}
          className="px-2 py-1.5 rounded-md text-sm border border-neutral-200"
          aria-label={t('lean_inception.toolbar.zoom_fit')}
        >
          ⤢ {t('lean_inception.toolbar.zoom_fit')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify GREEN**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionToolbar
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lean-inception/LeanInceptionToolbar.tsx apps/web/tests/lean-inception/LeanInceptionToolbar.test.tsx
git commit -m "feat(web): add LeanInceptionToolbar component"
```

---

## Task 12: Board (zoom/pan + drop wrapper)

**Files:**
- Create: `apps/web/src/components/lean-inception/LeanInceptionBoard.tsx`

No unit test for this composite — covered by Canvas integration smoke test in Task 13 and manual validation in Task 16.

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/lean-inception/LeanInceptionBoard.tsx
import { forwardRef, useImperativeHandle, useRef, useState, type DragEvent } from 'react';
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch';
import type {
  LeanInceptionState,
  LeanInceptionCard as Card,
} from '@open-design/contracts';
import { COLUMN_ORDER } from './constants.js';
import { LeanInceptionColumn } from './LeanInceptionColumn.js';
import { LeanInceptionDropOverlay } from './LeanInceptionDropOverlay.js';

export interface BoardHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

interface Props {
  state: LeanInceptionState;
  onDropFiles: (files: File[]) => void;
  onCardClick: (card: Card) => void;
}

export const LeanInceptionBoard = forwardRef<BoardHandle, Props>(function LeanInceptionBoard(
  { state, onDropFiles, onCardClick },
  ref,
) {
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const [dropActive, setDropActive] = useState(false);

  useImperativeHandle(ref, () => ({
    zoomIn: () => transformRef.current?.zoomIn(),
    zoomOut: () => transformRef.current?.zoomOut(),
    fit: () => transformRef.current?.resetTransform(),
  }), []);

  const documentNames = new Map(state.documents.map((d) => [d.id, d.filename]));

  const onDragEnter = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setDropActive(true);
    }
  };
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  };
  const onDragLeave = (e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropActive(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onDropFiles(files);
  };

  return (
    <div
      className="li-board relative flex-1 overflow-hidden bg-neutral-100"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <LeanInceptionDropOverlay active={dropActive} />
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.3}
        maxScale={1.5}
        panning={{ excluded: ['li-no-pan'] }}
        wheel={{ step: 0.1 }}
        doubleClick={{ disabled: true }}
      >
        <TransformComponent wrapperClass="w-full h-full" contentClass="li-board-grid flex flex-row gap-4 p-4 items-start">
          {COLUMN_ORDER.map((key) => {
            const snap = state.columns[key];
            if (!snap) return null;
            return (
              <LeanInceptionColumn
                key={key}
                columnKey={key}
                status={snap.status}
                cards={snap.cards}
                documentNames={documentNames}
                onCardClick={onCardClick}
              />
            );
          })}
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
});
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web typecheck 2>&1 | grep -E "lean-inception/LeanInceptionBoard" | head -5
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/lean-inception/LeanInceptionBoard.tsx
git commit -m "feat(web): add LeanInceptionBoard with zoom/pan and drop"
```

---

## Task 13: Canvas orchestrator

**Files:**
- Create: `apps/web/src/components/lean-inception/LeanInceptionCanvas.tsx`
- Test:   `apps/web/tests/lean-inception/LeanInceptionCanvas.test.tsx`

- [ ] **Step 1: Write failing test (smoke integration)**

```tsx
// apps/web/tests/lean-inception/LeanInceptionCanvas.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeanInceptionCanvas } from '../../src/components/lean-inception/LeanInceptionCanvas';

const emptyState = () => ({
  inception_id: 'li_1',
  project_id: 'prj_1',
  documents: [],
  columns: {
    vision:              { status: 'not_identified', cards: [] },
    objective:           { status: 'not_identified', cards: [] },
    problem:             { status: 'not_identified', cards: [] },
    personas:            { status: 'not_identified', cards: [] },
    features:            { status: 'not_identified', cards: [] },
    business_rules:      { status: 'not_identified', cards: [] },
    acceptance_criteria: { status: 'not_identified', cards: [] },
  },
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ state: emptyState() }),
  }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('LeanInceptionCanvas', () => {
  it('shows empty state when no documents after load', async () => {
    render(<LeanInceptionCanvas projectId="prj_1" />);
    await waitFor(() => expect(screen.getByText('No documents yet')).toBeInTheDocument());
  });

  it('renders all 7 column headers', async () => {
    render(<LeanInceptionCanvas projectId="prj_1" />);
    await waitFor(() => expect(screen.getAllByText(/Vision|Objective|Problem|Personas|Features|Business rules|Acceptance criteria/).length).toBeGreaterThanOrEqual(7));
  });

  it('shows loading state initially', () => {
    render(<LeanInceptionCanvas projectId="prj_1" />);
    expect(screen.getByTestId('canvas-loading')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionCanvas
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/lean-inception/LeanInceptionCanvas.tsx
import { useRef, useState, type ChangeEvent } from 'react';
import type { LeanInceptionCard } from '@open-design/contracts';
import { useT } from '../../i18n';
import { useLeanInception } from './useLeanInception.js';
import { LeanInceptionToolbar } from './LeanInceptionToolbar.js';
import { LeanInceptionBoard, type BoardHandle } from './LeanInceptionBoard.js';
import { LeanInceptionDetailDrawer } from './LeanInceptionDetailDrawer.js';
import { LeanInceptionEmptyState } from './LeanInceptionEmptyState.js';

interface Props {
  projectId: string;
}

export function LeanInceptionCanvas({ projectId }: Props) {
  const t = useT();
  const { state, isLoading, isMutating, error, refresh, extract, removeDocument, reset } =
    useLeanInception(projectId);

  const [detailCard, setDetailCard] = useState<LeanInceptionCard | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<BoardHandle>(null);

  const onAdd = () => fileInputRef.current?.click();
  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void extract(Array.from(e.target.files));
      e.target.value = '';
    }
  };
  const onConfirmReset = async () => {
    setConfirmingReset(false);
    await reset();
  };

  if (isLoading) {
    return <div data-testid="canvas-loading" className="flex items-center justify-center h-full text-neutral-500">Loading…</div>;
  }

  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-red-600">{error ?? 'Failed to load Lean Inception.'}</p>
        <button type="button" onClick={() => void refresh()} className="px-3 py-1.5 rounded-md bg-neutral-900 text-white text-sm">Retry</button>
      </div>
    );
  }

  const filename = detailCard
    ? state.documents.find((d) => d.id === detailCard.document_id)?.filename ?? null
    : null;

  return (
    <div className="li-canvas flex flex-col h-full bg-white">
      <LeanInceptionToolbar
        documents={state.documents}
        isMutating={isMutating}
        onAdd={onAdd}
        onRefresh={() => void refresh()}
        onReset={() => setConfirmingReset(true)}
        onRemoveDoc={(id) => void removeDocument(id)}
        onZoomIn={() => boardRef.current?.zoomIn()}
        onZoomOut={() => boardRef.current?.zoomOut()}
        onZoomFit={() => boardRef.current?.fit()}
      />

      <div className="relative flex-1 overflow-hidden">
        <LeanInceptionBoard
          ref={boardRef}
          state={state}
          onDropFiles={(files) => void extract(files)}
          onCardClick={setDetailCard}
        />
        {state.documents.length === 0 && <LeanInceptionEmptyState onAdd={onAdd} />}
      </div>

      <LeanInceptionDetailDrawer card={detailCard} filename={filename} onClose={() => setDetailCard(null)} />

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt"
        multiple
        className="hidden"
        onChange={onFileInputChange}
      />

      {confirmingReset && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm">
            <h3 className="text-lg font-semibold mb-2">{t('lean_inception.confirm.reset.title')}</h3>
            <p className="text-sm text-neutral-600 mb-4">{t('lean_inception.confirm.reset.description')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmingReset(false)} className="px-3 py-1.5 rounded-md border border-neutral-200 text-sm">
                {t('lean_inception.confirm.reset.cancel')}
              </button>
              <button type="button" onClick={() => void onConfirmReset()} className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm">
                {t('lean_inception.confirm.reset.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div className="absolute bottom-4 right-4 max-w-sm bg-red-50 border border-red-200 text-red-800 rounded-md px-3 py-2 text-sm shadow">
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify GREEN**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test LeanInceptionCanvas
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/lean-inception/LeanInceptionCanvas.tsx apps/web/tests/lean-inception/LeanInceptionCanvas.test.tsx
git commit -m "feat(web): add LeanInceptionCanvas orchestrator"
```

---

## Task 14: Lean-inception stylesheet

**Files:**
- Create: `apps/web/src/components/lean-inception/lean-inception.css`
- Modify: `apps/web/src/index.css`

- [ ] **Step 1: Create the stylesheet**

```css
/* apps/web/src/components/lean-inception/lean-inception.css */

.li-board {
  /* container relies on flex layout from parent */
}

.li-board-grid {
  width: max-content;
  min-width: 100%;
}

.li-card {
  cursor: pointer;
  transition: box-shadow 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
.li-card:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.08); }

/* React-zoom-pan-pinch wraps content; we need its inner div to fill */
.li-board .react-transform-wrapper,
.li-board .react-transform-component {
  width: 100% !important;
  height: 100% !important;
}

/* Drawer animation */
.li-drawer {
  animation: li-drawer-enter 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes li-drawer-enter {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

/* Drop overlay */
.li-drop-overlay {
  animation: li-overlay-enter 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes li-overlay-enter {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* Popover */
.li-popover {
  animation: li-popover-enter 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes li-popover-enter {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: Import in main stylesheet**

Read `apps/web/src/index.css`. Find the import section (or top of file) and add:

```css
@import "./components/lean-inception/lean-inception.css";
```

Place after other component imports. If there are no other imports, add at the top.

- [ ] **Step 3: Verify build (or typecheck)**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web typecheck
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/lean-inception/lean-inception.css apps/web/src/index.css
git commit -m "feat(web): add lean-inception styles"
```

---

## Task 15: Integrate into FileWorkspace

**Files:**
- Modify: `apps/web/src/components/FileWorkspace.tsx`

- [ ] **Step 1: Add the constant import**

Open `apps/web/src/components/FileWorkspace.tsx`. Near the existing `const DESIGN_FILES_TAB = '__design_files__';` (line ~118), import the new constant from the canvas module:

```ts
import { LEAN_INCEPTION_TAB } from './lean-inception/constants.js';
import { LeanInceptionCanvas } from './lean-inception/LeanInceptionCanvas.js';
```

- [ ] **Step 2: Add the fixed tab button**

Locate the `<div className="ws-tabs-bar" ...>` section (around line 760). The first child block is the conditional `{designSystemProject ? (<button ... DESIGN_SYSTEM_TAB ...>)}`. Insert a new unconditional button BEFORE that block:

```tsx
<button
  type="button"
  className={`ws-tab lean-inception-tab ${activeTab === LEAN_INCEPTION_TAB ? 'active' : ''}`}
  role="tab"
  aria-selected={activeTab === LEAN_INCEPTION_TAB}
  tabIndex={0}
  data-testid="lean-inception-tab"
  onClick={() => setActiveTab(LEAN_INCEPTION_TAB)}
  title="Lean Inception"
>
  <span className="tab-icon" aria-hidden>
    <Icon name="layout-grid" size={13} />
  </span>
  <span className="ws-tab-label">{t('lean_inception.tab.title')}</span>
</button>
```

(If `useT` is named differently, follow the existing pattern in this file.)

- [ ] **Step 3: Skip lean-inception tab in close/active/persistence logic**

Throughout the file there are checks like:

```ts
if (activeTab === DESIGN_FILES_TAB || activeTab === DESIGN_SYSTEM_TAB) return;
```

Extend them to include LEAN_INCEPTION_TAB. Use search-and-replace carefully:

- Search for `activeTab === DESIGN_FILES_TAB || activeTab === DESIGN_SYSTEM_TAB`
- Replace with `activeTab === DESIGN_FILES_TAB || activeTab === DESIGN_SYSTEM_TAB || activeTab === LEAN_INCEPTION_TAB`

Similarly check fallback assignments `setActiveTab(nextActive ?? DESIGN_FILES_TAB)` — those don't need to change (lean-inception is not a default).

- [ ] **Step 4: Render the canvas when the tab is active**

Find the render area at the bottom (look for `activeTab === DESIGN_SYSTEM_TAB && designSystemProject ? (...) : activeTab === DESIGN_FILES_TAB ? (...)`). Add a new branch BEFORE the design-system one:

```tsx
{activeTab === LEAN_INCEPTION_TAB ? (
  <LeanInceptionCanvas projectId={projectId} />
) : activeTab === DESIGN_SYSTEM_TAB && designSystemProject ? (
  /* existing */
) : activeTab === DESIGN_FILES_TAB ? (
  /* existing */
) : (
  /* file viewer existing */
)}
```

The `projectId` variable is in scope at this render site — verify by looking at how `DESIGN_FILES_TAB` branch uses props or context, and pass the right value. If there's no `projectId` direct, look upstream for `project.id` or similar.

- [ ] **Step 5: Verify build**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web typecheck 2>&1 | grep -E "FileWorkspace" | head -10
```

Expected: no new errors. Pre-existing errors in `src/templates/vite-react/**` are out of scope.

- [ ] **Step 6: Run unit tests to confirm nothing broke**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test
```

Expected: all previously-passing tests still pass, plus new lean-inception tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/FileWorkspace.tsx
git commit -m "feat(web): wire lean-inception tab into FileWorkspace"
```

---

## Task 16: Final validation

- [ ] **Step 1: Full repo guard + typecheck**

```bash
cd /Users/elite1/dev/pendesign && pnpm guard
cd /Users/elite1/dev/pendesign && pnpm typecheck
```

Expected: pass for our scope. Pre-existing errors in `src/templates/vite-react/**` and `tests/design-system-variables.test.ts` are NOT this PR's.

- [ ] **Step 2: Full web test suite**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web test
```

Expected: all lean-inception tests pass; pre-existing tests remain passing.

- [ ] **Step 3: Smoke test in dev daemon**

```bash
pnpm tools-dev start daemon --namespace lean-canvas-test
pnpm tools-dev start web --namespace lean-canvas-test
# wait until both are running, then open the daemon-reported URL in the browser
# Manual checks:
#   1. Open or create a project, look for the "Lean Inception" tab (leftmost).
#   2. Click it — see 7 columns with status "Not identified".
#   3. Drag a small .md file into the board — see drop overlay appear, then cards appear after extraction completes.
#   4. Click a card — drawer opens with source_anchor.
#   5. Toolbar Documents (N) — popover lists doc, click X removes it.
#   6. Reset button — confirms, clears everything.
pnpm tools-dev stop --namespace lean-canvas-test
```

If any step fails, fix the underlying issue and re-validate from Step 1.

- [ ] **Step 4: Final commit (if minor adjustments needed)**

```bash
git status
# If any uncommitted fixes:
git add <files>
git commit -m "chore(web): final lean-inception adjustments"
```

---

## Self-Review Checklist

Verified before handing off to executor:

- [ ] Every spec section is covered: hook (Task 3), constants (Task 2), card (Task 5), column (Task 6), drawer (Task 7), empty state (Task 8), drop overlay (Task 9), docs list (Task 10), toolbar (Task 11), board with zoom/pan + drop (Task 12), canvas orchestrator (Task 13), styles (Task 14), tab integration (Task 15), i18n in all 19 locales (Task 4), dep install (Task 1), final validation (Task 16).
- [ ] All function/type names are consistent across tasks: `useLeanInception`, `LeanInceptionCard`, `LeanInceptionColumn`, `LeanInceptionToolbar`, `LeanInceptionBoard`, `LeanInceptionCanvas`, `LeanInceptionDetailDrawer`, `LeanInceptionEmptyState`, `LeanInceptionDropOverlay`, `LeanInceptionDocumentsList`, `LEAN_INCEPTION_TAB`, `COLUMN_ORDER`, `STATUS_COLOR_CLASS`, `CONFIDENCE_DOT_CLASS`, `BoardHandle`.
- [ ] No placeholders (TBD, "similar to Task N", etc.).
- [ ] Tests sibling to src per AGENTS.md rule (`apps/web/tests/lean-inception/`).
- [ ] Each step has runnable code or exact command.
- [ ] Conventional commits with `(web)` scope; no `Co-authored-by`.
- [ ] Task 15's hand-off to FileWorkspace explicitly calls out adapting `useT`/projectId access to whatever the existing file uses — the implementer should inspect FileWorkspace.tsx briefly before editing.
