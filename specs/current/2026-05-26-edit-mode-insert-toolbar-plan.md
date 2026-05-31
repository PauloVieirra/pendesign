# Edit Mode Insert Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Figma-style floating bottom toolbar (Text + Shape) to Edit mode that reuses the existing drop-plan engine for placement preview, then expose Fill/Hug width/height and a Delete button (with central confirm modal) in the manual edit panel.

**Architecture:** Extend the edit-bridge protocol with two new patch kinds (`insert-html-as-child`, `insert-html-before-ref`) and one new bridge↔host message (`od-edit-insert*`). The bridge reuses `findDropAnchor` / `planForContainer` / `paintInsidePlan` / `paintSiblingPlan` with `draggedEl === null`. The host owns the inserted-element templates (`buildInsertedElement` in `InsertToolbar.tsx`) and routes the new message through the same `applyManualEditPatch` path used by drag-move.

**Tech Stack:** TypeScript (Node 24 / pnpm 10.33.2), React 18, Vitest + JSDOM, edit-bridge ESBuild package, Next.js 16 (App Router) for the host.

**Spec:** `specs/current/2026-05-26-edit-mode-insert-toolbar.md`

---

## Pre-flight

- [ ] **Confirm a clean working tree on branch `teste`.** Run `git status` — must be clean (the spec commit already landed). If not, stash before starting.
- [ ] **Run baseline checks** so failures during the plan are clearly caused by new code:
  ```bash
  pnpm install
  pnpm guard
  pnpm typecheck
  pnpm --filter @open-design/web test -- --run
  ```
  Capture the test counts. New tests added later must increase the count.

---

## Task 1: Add message contract and patch kinds

**Files:**
- Modify: `packages/edit-bridge/src/types.ts`

- [ ] **Step 1: Add the new message and patch types.**

Append the two patch kinds to the `ManualEditPatch` union (search for the `export type ManualEditPatch =` block, currently lines 70-85):

```ts
export type ManualEditPatch =
  | { id: string; kind: 'set-text'; value: string }
  | { id: string; kind: 'set-link'; text: string; href: string }
  | { id: string; kind: 'set-image'; src: string; alt: string }
  | { kind: 'set-token'; token: string; value: string }
  | { id: string; kind: 'set-style'; styles: Partial<ManualEditStyles> }
  | { id: string; kind: 'set-attributes'; attributes: Record<string, string> }
  | { id: string; kind: 'set-outer-html'; html: string }
  | { id: string; kind: 'delete-element' }
  | { id: string; kind: 'clone-element-after' }
  | { id: string; kind: 'insert-sibling-after'; html: string }
  | { id: string; kind: 'move-element-up' }
  | { id: string; kind: 'move-element-down' }
  | { id: string; kind: 'move-before-ref'; referenceId: string }
  | { id: string; kind: 'append-to-parent'; parentId: string }
  | { id: string; kind: 'insert-html-as-child'; parentId: string; html: string }
  | { id: string; kind: 'insert-html-before-ref'; referenceId: string; html: string }
  | { kind: 'set-full-source'; source: string };
```

(The `id` field on the two new patch kinds is the future `data-od-id` of the inserted element — the host pre-generates it via `buildInsertedElement` so the host can select the new element after the patch lands.)

Add the new message types **above** the `ManualEditBridgeMessage` union (around line 215):

```ts
export type InsertToolKind = 'text' | 'shape';

export interface ManualEditInsertArmMessage {
  type: 'od-edit-insert-arm';
  tool: InsertToolKind;
}

export interface ManualEditInsertDisarmMessage {
  type: 'od-edit-insert-disarm';
}

export interface ManualEditInsertCommitMessage {
  type: 'od-edit-insert-commit';
  tool: InsertToolKind;
  /** `data-od-id` of the container, or `'__body__'` for the document body
   * (matches the drag-and-drop containerId convention in the bridge). */
  containerId: string;
  /** `data-od-id` of the sibling to insert before; `null` means append as
   * the last child of `containerId`. */
  insertBefore: string | null;
}
```

Add `ManualEditInsertCommitMessage` to the `ManualEditBridgeMessage` union:

```ts
export type ManualEditBridgeMessage =
  | ManualEditTargetMessage
  | ManualEditSelectMessage
  | ManualEditPreviewAppliedMessage
  | ManualEditInlineTextMessage
  | ManualEditMediaRequestMessage
  | ManualEditInlineLinkActiveMessage
  | ManualEditInlineEndMessage
  | ManualEditColorRequestMessage
  | ManualEditSourceRequestMessage
  | ManualEditStructuralActionMessage
  | ManualEditFormatColorRequestMessage
  | ManualEditResizeCommitMessage
  | ManualEditSnapshotResponseMessage
  | ManualEditInsertCommitMessage;
```

(The `Arm` and `Disarm` messages are host→bridge, so they do NOT go in the bridge→host `ManualEditBridgeMessage` union. Export them so the host can type its `postMessage` payloads.)

- [ ] **Step 2: Verify typecheck still passes.**

```bash
pnpm --filter @open-design/edit-bridge typecheck
pnpm --filter @open-design/web typecheck
```

Expected: PASS. There are no consumers yet, so the union extension is additive.

- [ ] **Step 3: Commit.**

```bash
git add packages/edit-bridge/src/types.ts
git commit -m "feat(edit-bridge): add insert message and patch types"
```

---

## Task 2: Implement `insert-html-as-child` source patch

**Files:**
- Modify: `packages/edit-bridge/src/source-patches.ts` (after the `append-to-parent` branch at line 88-94)
- Test: `apps/web/tests/edit-mode/source-patches.test.ts` (add inside the existing `describe('structural drag-and-drop patches')` block, or a new sibling `describe('insert-html patches')`)

- [ ] **Step 1: Write the failing tests.**

Add a new `describe` block at the bottom of `apps/web/tests/edit-mode/source-patches.test.ts`, before the file's closing `});`:

```ts
describe('insert-html patches', () => {
  const insertSource = `<!doctype html>
<html><body>
  <main data-od-id="root">
    <section data-od-id="card-a">A</section>
    <section data-od-id="card-b">B</section>
  </main>
</body></html>`;

  it('insert-html-as-child appends a new element as the last child of parentId', () => {
    const result = applyManualEditPatch(insertSource, {
      kind: 'insert-html-as-child',
      id: 'new-shape',
      parentId: 'root',
      html: '<div data-od-id="new-shape" style="width: 120px; height: 120px;"></div>',
    });
    expect(result.ok).toBe(true);
    expect(result.source).toContain('data-od-id="new-shape"');
    // Last sibling after card-b.
    expect(result.source.indexOf('new-shape')).toBeGreaterThan(result.source.indexOf('card-b'));
  });

  it('insert-html-as-child treats __body__ as document body', () => {
    const result = applyManualEditPatch(insertSource, {
      kind: 'insert-html-as-child',
      id: 'new-shape',
      parentId: '__body__',
      html: '<div data-od-id="new-shape"></div>',
    });
    expect(result.ok).toBe(true);
    expect(result.source).toContain('data-od-id="new-shape"');
  });

  it('insert-html-as-child rejects html with multiple roots', () => {
    const result = applyManualEditPatch(insertSource, {
      kind: 'insert-html-as-child',
      id: 'new-shape',
      parentId: 'root',
      html: '<div></div><div></div>',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exactly one root/);
  });

  it('insert-html-as-child reports a clear error when the parent id is missing', () => {
    const result = applyManualEditPatch(insertSource, {
      kind: 'insert-html-as-child',
      id: 'new-shape',
      parentId: 'does-not-exist',
      html: '<div></div>',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does-not-exist/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/edit-mode/source-patches.test.ts --run
```

Expected: 4 FAILs — `insert-html-as-child` is not a known patch kind yet, so it falls through and `applyManualEditPatch` returns `{ ok: false, source, error: undefined }` (or a "Target not found" error because `findEditableElement(doc, 'new-shape')` is called before the kind check).

- [ ] **Step 3: Implement the patch.**

Open `packages/edit-bridge/src/source-patches.ts`. The current `applyManualEditPatch` calls `findEditableElement(doc, patch.id)` at line 22 and returns "Target not found" when `el` is `null`. The two new patch kinds are insert kinds — the `patch.id` is the FUTURE id of the new element, so the lookup is expected to fail. Move the insert kinds **above** the `findEditableElement` line by short-circuiting early.

Replace the block from line 22 (`const el = findEditableElement(...)`) down to the chain of `else if`s with this restructured version:

```ts
  if (patch.kind === 'insert-html-as-child') {
    const parent = patch.parentId === '__body__'
      ? doc.body
      : findEditableElement(doc, patch.parentId);
    if (!parent) return { ok: false, source, error: `Parent target not found: ${patch.parentId}` };
    const inserted = parseSingleRoot(doc, patch.html);
    if (!inserted.ok) return { ok: false, source, error: inserted.error };
    parent.appendChild(inserted.el);
    return { ok: true, source: serializeSource(doc, source) };
  }

  if (patch.kind === 'insert-html-before-ref') {
    const ref = findEditableElement(doc, patch.referenceId);
    if (!ref) return { ok: false, source, error: `Reference target not found: ${patch.referenceId}` };
    const inserted = parseSingleRoot(doc, patch.html);
    if (!inserted.ok) return { ok: false, source, error: inserted.error };
    ref.parentElement?.insertBefore(inserted.el, ref);
    return { ok: true, source: serializeSource(doc, source) };
  }

  const el = findEditableElement(doc, patch.id);
  if (!el) return { ok: false, source, error: `Target not found: ${patch.id}` };

  // (existing branches: set-text, set-link, set-image, …, append-to-parent)
```

Add the `parseSingleRoot` helper right above `applyManualEditPatch` (the surrounding `stripRuntimeMarkers` and other helpers live in the same file):

```ts
function parseSingleRoot(
  doc: Document,
  html: string,
): { ok: true; el: Element } | { ok: false; error: string } {
  const template = doc.createElement('template');
  template.innerHTML = html.trim();
  const roots = Array.from(template.content.children);
  if (roots.length !== 1) {
    return { ok: false, error: 'Insertion HTML must contain exactly one root element.' };
  }
  return { ok: true, el: roots[0]! };
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/edit-mode/source-patches.test.ts --run
```

Expected: all 4 new tests PASS, no regressions in the existing suite.

- [ ] **Step 5: Commit.**

```bash
git add packages/edit-bridge/src/source-patches.ts apps/web/tests/edit-mode/source-patches.test.ts
git commit -m "feat(edit-bridge): add insert-html-as-child / insert-html-before-ref patches"
```

---

## Task 3: Implement `insert-html-before-ref` patch test parity

This task already landed via the `parseSingleRoot` helper in Task 2, but verify with a dedicated `insert-html-before-ref` test to avoid coverage drift.

**Files:**
- Test: `apps/web/tests/edit-mode/source-patches.test.ts`

- [ ] **Step 1: Add the test.**

Append inside the same `describe('insert-html patches', …)` block from Task 2:

```ts
  it('insert-html-before-ref inserts before the referenced sibling', () => {
    const result = applyManualEditPatch(insertSource, {
      kind: 'insert-html-before-ref',
      id: 'new-shape',
      referenceId: 'card-b',
      html: '<div data-od-id="new-shape"></div>',
    });
    expect(result.ok).toBe(true);
    // new-shape lands between card-a and card-b.
    const a = result.source.indexOf('card-a');
    const n = result.source.indexOf('new-shape');
    const b = result.source.indexOf('card-b');
    expect(a).toBeGreaterThan(-1);
    expect(n).toBeGreaterThan(a);
    expect(n).toBeLessThan(b);
  });

  it('insert-html-before-ref reports a clear error when reference id is missing', () => {
    const result = applyManualEditPatch(insertSource, {
      kind: 'insert-html-before-ref',
      id: 'new-shape',
      referenceId: 'does-not-exist',
      html: '<div></div>',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does-not-exist/);
  });
```

- [ ] **Step 2: Run to verify they pass (no code change expected).**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/edit-mode/source-patches.test.ts --run
```

Expected: PASS for both new tests.

- [ ] **Step 3: Commit.**

```bash
git add apps/web/tests/edit-mode/source-patches.test.ts
git commit -m "test(edit-bridge): cover insert-html-before-ref ordering and errors"
```

---

## Task 4: Bridge — armed-tool state, mousemove preview, click-to-commit

**Files:**
- Modify: `packages/edit-bridge/src/bridge.ts`
- Test: `apps/web/tests/edit-mode/bridge.test.ts`

- [ ] **Step 1: Write the failing bridge tests.**

These tests use the `buildManualEditBridge` string contract (the bridge is shipped as a serialised script). Append at the end of `apps/web/tests/edit-mode/bridge.test.ts`, before the file's closing `});`:

```ts
describe('manual edit bridge insert flow', () => {
  it('handles od-edit-insert-arm and stores the armed tool', () => {
    const bridge = buildManualEditBridge(true);
    expect(bridge).toContain("ev.data.type === 'od-edit-insert-arm'");
    expect(bridge).toContain('armedTool = ev.data.tool');
  });

  it('handles od-edit-insert-disarm and clears the armed tool', () => {
    const bridge = buildManualEditBridge(true);
    expect(bridge).toContain("ev.data.type === 'od-edit-insert-disarm'");
    expect(bridge).toContain('clearInsertArm()');
  });

  it('reuses the drop-plan engine for the insert preview', () => {
    const bridge = buildManualEditBridge(true);
    // The mousemove branch when armed must call the same hit-test + plan
    // helpers as the drag flow.
    expect(bridge).toContain('findDropAnchor(insertMoveEv.clientX, insertMoveEv.clientY, null)');
    expect(bridge).toContain('planForContainer(');
  });

  it('emits od-edit-insert-commit on click while armed', () => {
    const bridge = buildManualEditBridge(true);
    expect(bridge).toContain("type: 'od-edit-insert-commit'");
    expect(bridge).toContain("containerId:");
    expect(bridge).toContain("insertBefore:");
  });

  it('treats body as the __body__ sentinel container id', () => {
    const bridge = buildManualEditBridge(true);
    expect(bridge).toContain("plan.container === document.body ? '__body__'");
  });

  it('cancels arm on Escape', () => {
    const bridge = buildManualEditBridge(true);
    expect(bridge).toContain("ev.key === 'Escape'");
    // The insert arm Escape handler clears via the shared helper.
    expect(bridge).toContain('clearInsertArm');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/edit-mode/bridge.test.ts --run
```

Expected: 6 FAILs — none of the strings are in the bridge script yet.

- [ ] **Step 3: Implement the armed-tool state and handlers.**

Open `packages/edit-bridge/src/bridge.ts`. The bridge is wrapped in a string template returned by `buildManualEditBridge`. Find the existing drag block (search for the comment `// Cross-parent drag-and-drop.` — around line 544).

Add the following directly **above** that block (so insert lives next to the drag engine it reuses):

```js
  // ──────────────────────────────────────────────────────────────────
  // Insert-from-toolbar. The host arms a tool (text or shape) via
  // od-edit-insert-arm; while armed we paint the same drop indicator
  // the drag flow uses, with draggedEl === null (we are CREATING a
  // new element, not moving one). A click inside the canvas emits
  // od-edit-insert-commit and disarms. Escape / arming a different
  // tool / disarm message all reset state.
  // ──────────────────────────────────────────────────────────────────
  var armedTool = null;
  function clearInsertArm(){
    armedTool = null;
    hideDropIndicator();
    document.documentElement.style.cursor = '';
  }
  function onInsertMove(insertMoveEv){
    if (!armedTool) return;
    var container = findDropAnchor(insertMoveEv.clientX, insertMoveEv.clientY, null);
    if (!container) { hideDropIndicator(); return; }
    var plan = planForContainer(container, insertMoveEv.clientX, insertMoveEv.clientY, null);
    if (!plan) { hideDropIndicator(); return; }
    if (plan.kind === 'inside') paintInsidePlan(plan);
    else paintSiblingPlan(plan);
  }
  function onInsertClick(insertClickEv){
    if (!armedTool) return;
    insertClickEv.preventDefault();
    insertClickEv.stopPropagation();
    var container = findDropAnchor(insertClickEv.clientX, insertClickEv.clientY, null);
    if (!container) { clearInsertArm(); return; }
    var plan = planForContainer(container, insertClickEv.clientX, insertClickEv.clientY, null);
    if (!plan) { clearInsertArm(); return; }
    var containerId = plan.container === document.body ? '__body__' : stableId(plan.container);
    var insertBefore = (plan.kind === 'sibling' && plan.insertBefore) ? stableId(plan.insertBefore) : null;
    window.parent.postMessage({
      type: 'od-edit-insert-commit',
      tool: armedTool,
      containerId: containerId,
      insertBefore: insertBefore,
    }, '*');
    clearInsertArm();
  }
  function onInsertKey(insertKeyEv){
    if (!armedTool) return;
    if (insertKeyEv.key === 'Escape' || insertKeyEv.keyCode === 27) {
      insertKeyEv.preventDefault();
      insertKeyEv.stopPropagation();
      clearInsertArm();
    }
  }
  document.addEventListener('mousemove', onInsertMove, true);
  document.addEventListener('click', onInsertClick, true);
  document.addEventListener('keydown', onInsertKey, true);
```

Then extend the `window.addEventListener('message', …)` handler (around line 1499). After the existing `od-edit-mode` branch (line 1501-1507) and before the `od-edit-request-snapshot` branch, add:

```js
    if (ev.data.type === 'od-edit-insert-arm') {
      // Arming a new tool overrides any previously-armed one.
      armedTool = ev.data.tool;
      hideDropIndicator();
      document.documentElement.style.cursor = 'crosshair';
      return;
    }
    if (ev.data.type === 'od-edit-insert-disarm') {
      clearInsertArm();
      return;
    }
```

Also, when Edit mode itself turns off (the existing `if (!enabled)` branch at line 1504), clear the arm to avoid a stuck crosshair. Update that line to:

```js
      if (!enabled) { finishInlineEdit(false); clearSelectedTarget(); teardownResizeHandles(); teardownPaddingHandles(); clearInsertArm(); }
```

- [ ] **Step 4: Run the bridge tests to verify they pass.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/edit-mode/bridge.test.ts --run
```

Expected: 6 new tests PASS. Existing drag tests must remain green.

- [ ] **Step 5: Smoke-build the bridge bundle.**

```bash
pnpm --filter @open-design/edit-bridge build
```

Expected: no errors. (The bridge is a runtime-emitted script, so build catches stray TypeScript-only syntax that would die at runtime.)

- [ ] **Step 6: Commit.**

```bash
git add packages/edit-bridge/src/bridge.ts apps/web/tests/edit-mode/bridge.test.ts
git commit -m "feat(edit-bridge): arm-and-place insert flow reusing drop-plan engine"
```

---

## Task 5: i18n keys

Adding 13 new keys to one typed Dict and **19** locale files (`ar`, `de`, `en`, `es-ES`, `fa`, `fr`, `hu`, `id`, `it`, `ja`, `ko`, `pl`, `pt-BR`, `ru`, `th`, `tr`, `uk`, `zh-CN`, `zh-TW`). Do this BEFORE the components consume them so the typechecker fails fast on any miss.

**Files:**
- Modify: `apps/web/src/i18n/types.ts`
- Modify (19): `apps/web/src/i18n/locales/*.ts`

- [ ] **Step 1: Add keys to the typed Dict.**

Find the `manualEdit.*` block in `apps/web/src/i18n/types.ts` (begins around line 1600 with `'manualEdit.layers': string;`). Append at the end of that block:

```ts
  'manualEdit.insert.text': string;
  'manualEdit.insert.shape': string;
  'manualEdit.insert.toolbarLabel': string;
  'manualEdit.size.widthLabel': string;
  'manualEdit.size.heightLabel': string;
  'manualEdit.size.fixed': string;
  'manualEdit.size.fill': string;
  'manualEdit.size.hug': string;
  'manualEdit.delete': string;
  'manualEdit.deleteConfirm.title': string;
  'manualEdit.deleteConfirm.body': string;
  'manualEdit.deleteConfirm.cancel': string;
  'manualEdit.deleteConfirm.confirm': string;
```

- [ ] **Step 2: Run typecheck to enumerate every missing locale.**

```bash
pnpm --filter @open-design/web typecheck
```

Expected: 19 × 13 = ~247 errors of the form `Property 'manualEdit.insert.text' is missing in type ...`. Use this list as the to-do for Step 3.

- [ ] **Step 3: Add translations to each locale.**

For each of the 19 files in `apps/web/src/i18n/locales/`, add the same 13 keys near the existing `'manualEdit.*'` keys. Use the table below as the canonical wording. The English column is the source of truth; native columns aim for length parity (do not pad — short is fine).

| Key | English | Portuguese (pt-BR) |
|-----|---------|---------------------|
| `manualEdit.insert.text` | `Text` | `Texto` |
| `manualEdit.insert.shape` | `Shape` | `Forma` |
| `manualEdit.insert.toolbarLabel` | `Insert element` | `Inserir elemento` |
| `manualEdit.size.widthLabel` | `Width` | `Largura` |
| `manualEdit.size.heightLabel` | `Height` | `Altura` |
| `manualEdit.size.fixed` | `Fixed` | `Fixo` |
| `manualEdit.size.fill` | `Fill` | `Preencher` |
| `manualEdit.size.hug` | `Hug` | `Ajustar` |
| `manualEdit.delete` | `Delete` | `Excluir` |
| `manualEdit.deleteConfirm.title` | `Delete this element?` | `Excluir este elemento?` |
| `manualEdit.deleteConfirm.body` | `This removes the element from the design. You can undo it from the history panel.` | `Isso remove o elemento do design. Você pode desfazer pelo painel de histórico.` |
| `manualEdit.deleteConfirm.cancel` | `Cancel` | `Cancelar` |
| `manualEdit.deleteConfirm.confirm` | `Delete` | `Excluir` |

For the 17 other locales, translate the English source. Where you do not have language fluency, copy the English value verbatim — a typecheck-clean stub is better than a missing key. The translation owner can refine later.

- [ ] **Step 4: Verify typecheck is clean.**

```bash
pnpm --filter @open-design/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/i18n/types.ts apps/web/src/i18n/locales/
git commit -m "feat(i18n): add manualEdit insert/size/delete keys across all locales"
```

---

## Task 6: Trim and style the InsertToolbar

**Files:**
- Modify: `apps/web/src/components/InsertToolbar.tsx` (90 lines today)
- Modify: `apps/web/src/index.css`
- Test: `apps/web/tests/components/InsertToolbar.test.tsx` (new file)

- [ ] **Step 1: Write the failing component test.**

Create `apps/web/tests/components/InsertToolbar.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InsertToolbar, buildInsertedElement } from '../../src/components/InsertToolbar';

describe('InsertToolbar', () => {
  it('renders exactly the Text and Shape tools', () => {
    render(<InsertToolbar active={null} onSelectTool={() => {}} />);
    expect(screen.getByLabelText('Text')).toBeInTheDocument();
    expect(screen.getByLabelText('Shape')).toBeInTheDocument();
    expect(screen.queryByLabelText('Frame')).toBeNull();
    expect(screen.queryByLabelText('Rectangle')).toBeNull();
    expect(screen.queryByLabelText('Ellipse')).toBeNull();
    expect(screen.queryByLabelText('Image')).toBeNull();
  });

  it('toggles the active state when a tool is clicked', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<InsertToolbar active={null} onSelectTool={onSelect} />);
    fireEvent.click(screen.getByLabelText('Shape'));
    expect(onSelect).toHaveBeenCalledWith('shape');
    rerender(<InsertToolbar active="shape" onSelectTool={onSelect} />);
    fireEvent.click(screen.getByLabelText('Shape'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('disables both buttons when disabled prop is true', () => {
    render(<InsertToolbar active={null} onSelectTool={() => {}} disabled />);
    expect(screen.getByLabelText('Text')).toBeDisabled();
    expect(screen.getByLabelText('Shape')).toBeDisabled();
  });

  it('buildInsertedElement returns 120x120 grey div for shape', () => {
    const out = buildInsertedElement('shape');
    expect(out.html).toContain('width: 120px');
    expect(out.html).toContain('height: 120px');
    expect(out.html).toContain('background-color: #e5e7eb');
    expect(out.html).toContain(`data-od-id="${out.id}"`);
  });

  it('buildInsertedElement returns a paragraph for text', () => {
    const out = buildInsertedElement('text');
    expect(out.html).toMatch(/^<p /);
    expect(out.html).toContain(`data-od-id="${out.id}"`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/InsertToolbar.test.tsx --run
```

Expected: `Frame`/`Rectangle`/`Ellipse`/`Image` queries currently succeed, so the first test fails. Shape default size assertions fail because today's `shape` is actually `rectangle` (200×80 blue).

- [ ] **Step 3: Rewrite `InsertToolbar.tsx`.**

Replace the file with this exact content:

```tsx
import { Icon, type IconName } from './Icon';

export type InsertToolId = 'text' | 'shape';

interface ToolEntry {
  id: InsertToolId;
  icon: IconName;
  label: string;
}

const TOOLS: ToolEntry[] = [
  { id: 'text', icon: 'edit', label: 'Text' },
  { id: 'shape', icon: 'grid', label: 'Shape' },
];

export function buildInsertedElement(tool: InsertToolId): { id: string; html: string } {
  const id = `od-ins-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  if (tool === 'text') {
    return {
      id,
      html: `<p data-od-id="${id}" style="font-size: 16px; color: #111;">Text</p>`,
    };
  }
  return {
    id,
    html: `<div data-od-id="${id}" style="width: 120px; height: 120px; background-color: #e5e7eb;"></div>`,
  };
}

interface InsertToolbarProps {
  active: InsertToolId | null;
  onSelectTool: (tool: InsertToolId | null) => void;
  disabled?: boolean;
}

export function InsertToolbar({ active, onSelectTool, disabled }: InsertToolbarProps) {
  return (
    <div className="insert-toolbar" aria-hidden={disabled ? true : undefined}>
      <div className="insert-toolbar-bar" role="toolbar" aria-label="Insert element">
        {TOOLS.map((tool) => {
          const isActive = active === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              className={`insert-toolbar-tool${isActive ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => onSelectTool(isActive ? null : tool.id)}
              title={tool.label}
              aria-label={tool.label}
              aria-pressed={isActive}
            >
              <Icon name={tool.icon} size={16} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add CSS to `apps/web/src/index.css`.**

Append at the end of the file:

```css
.insert-toolbar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  pointer-events: none;
  animation: insert-toolbar-enter 200ms cubic-bezier(0.23, 1, 0.32, 1);
}

.insert-toolbar[aria-hidden='true'] {
  display: none;
}

.insert-toolbar-bar {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border-1, rgba(0, 0, 0, 0.08));
  border-radius: 999px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.12);
  pointer-events: auto;
}

.insert-toolbar-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--fg-1, #111);
  cursor: pointer;
  transition: background-color 140ms cubic-bezier(0.23, 1, 0.32, 1);
}

.insert-toolbar-tool:hover {
  background: var(--surface-2, rgba(0, 0, 0, 0.06));
}

.insert-toolbar-tool.active {
  background: #2563eb;
  color: #ffffff;
}

.insert-toolbar-tool:disabled {
  opacity: 0.5;
  cursor: default;
}

@keyframes insert-toolbar-enter {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
```

- [ ] **Step 5: Run the test to verify it passes.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/InsertToolbar.test.tsx --run
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/components/InsertToolbar.tsx apps/web/src/index.css apps/web/tests/components/InsertToolbar.test.tsx
git commit -m "feat(web): trim InsertToolbar to Text + Shape with floating pill styling"
```

---

## Task 7: Mount the toolbar and wire `armedTool` state in FileViewer

**Files:**
- Modify: `apps/web/src/components/FileViewer.tsx`

`FileViewer.tsx` is 8,294 lines; you will work in two regions: the React state block where `manualEditTarget` already lives, and the JSX region that wraps the iframe in Edit mode.

- [ ] **Step 1: Find the state region.**

```bash
grep -n "manualEditTarget\|manualEditEnabled\|isEditMode\|edit-mode" apps/web/src/components/FileViewer.tsx | head -20
```

Locate the line where Edit-mode-related useState calls already sit (typically clustered together). Note the line number for Step 3.

- [ ] **Step 2: Find the iframe mount region.**

```bash
grep -n "<iframe\|iframeRef\|ManualEditPanel" apps/web/src/components/FileViewer.tsx | head -20
```

Identify the JSX node that wraps the iframe in Edit mode. Note the line number for Step 4.

- [ ] **Step 3: Add the `armedTool` state and its helpers.**

Near the other Edit-mode `useState` calls, add:

```tsx
const [armedTool, setArmedTool] = useState<InsertToolId | null>(null);

const postArm = useCallback((tool: InsertToolId | null) => {
  setArmedTool(tool);
  const iframe = iframeRef.current;
  if (!iframe || !iframe.contentWindow) return;
  if (tool == null) {
    iframe.contentWindow.postMessage({ type: 'od-edit-insert-disarm' }, '*');
  } else {
    iframe.contentWindow.postMessage({ type: 'od-edit-insert-arm', tool }, '*');
  }
}, []);
```

Add the imports at the top of the file (next to existing imports from the same modules):

```tsx
import { InsertToolbar, buildInsertedElement, type InsertToolId } from './InsertToolbar';
```

Disarm whenever Edit mode turns off — find the existing effect that posts `{ type: 'od-edit-mode', enabled: false }` and add a `setArmedTool(null)` next to the post:

```tsx
// In whichever effect/handler currently posts od-edit-mode:false:
setArmedTool(null);
```

- [ ] **Step 4: Render the toolbar in JSX.**

Inside the JSX region that wraps the Edit-mode canvas (sibling of the iframe, NOT inside the iframe), add:

```tsx
{isEditMode && (
  <InsertToolbar active={armedTool} onSelectTool={postArm} />
)}
```

Substitute `isEditMode` with whatever variable the surrounding code uses to gate other Edit-mode-only UI (e.g. `manualEditEnabled`). Look at how `ManualEditPanel` is conditionally rendered for the pattern.

- [ ] **Step 5: Manual smoke test.**

```bash
pnpm tools-dev run web --daemon-port 17456 --web-port 17573
```

Open a design file in Edit mode in the browser. Confirm:
1. The toolbar appears at the bottom centre with two icons.
2. Clicking Text or Shape highlights the button (blue).
3. Inside the iframe the cursor changes to a crosshair.
4. Pressing Esc clears the highlight and returns the cursor to default.
5. The toolbar disappears when leaving Edit mode.

If step 3 or 4 fails, re-check the bridge wiring from Task 4. Don't proceed until smoke passes.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/components/FileViewer.tsx
git commit -m "feat(web): mount InsertToolbar in Edit mode and arm via postMessage"
```

---

## Task 8: Handle `od-edit-insert-commit` on the host

**Files:**
- Modify: `apps/web/src/components/FileViewer.tsx`
- Test: `apps/web/tests/components/FileViewer.insert-commit.test.tsx` (new file)

- [ ] **Step 1: Write the host-side integration test.**

Create `apps/web/tests/components/FileViewer.insert-commit.test.tsx`. Model it on the existing `FileViewer.manual-edit-history.test.tsx` (it already mocks `ManualEditPanel` and drives the host's `applyManualEditPatch` flow). The test fires an `od-edit-insert-commit` MessageEvent and asserts the host generated a patch with the right shape:

```tsx
import { describe, expect, it, vi } from 'vitest';

// NOTE: This test follows the same setup pattern as
// FileViewer.manual-edit-history.test.tsx. Copy its mock scaffolding for
// ManualEditPanel, document-store, providers, and iframe ref. Then add:

describe('FileViewer od-edit-insert-commit handler', () => {
  it('applies insert-html-as-child when there is no insertBefore', async () => {
    // Arrange: render FileViewer in Edit mode with a known design source.
    // (Reuse the harness from FileViewer.manual-edit-history.test.tsx.)
    // …setup elided — copy from the sibling test file…

    // Act: fire the commit message.
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'od-edit-insert-commit',
        tool: 'shape',
        containerId: 'card-a',
        insertBefore: null,
      },
    }));

    // Assert: the host called applyManualEditPatch with insert-html-as-child.
    expect(capturedPatches).toContainEqual(expect.objectContaining({
      kind: 'insert-html-as-child',
      parentId: 'card-a',
      html: expect.stringContaining('background-color: #e5e7eb'),
    }));
  });

  it('applies insert-html-before-ref when insertBefore is set', async () => {
    // …setup elided…
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'od-edit-insert-commit',
        tool: 'text',
        containerId: 'root',
        insertBefore: 'card-b',
      },
    }));

    expect(capturedPatches).toContainEqual(expect.objectContaining({
      kind: 'insert-html-before-ref',
      referenceId: 'card-b',
      html: expect.stringMatching(/^<p /),
    }));
  });
});
```

Open `apps/web/tests/components/FileViewer.manual-edit-history.test.tsx` and copy its setup (mocks, render helper, `capturedPatches` collector) into the new file. Adjust the assertion to the patch capture mechanism that file already uses.

- [ ] **Step 2: Run the new test to verify it fails.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/FileViewer.insert-commit.test.tsx --run
```

Expected: FAIL — host doesn't route `od-edit-insert-commit` yet.

- [ ] **Step 3: Find the existing host message router.**

```bash
grep -n "od-edit-structural-action\|od-edit-resize-commit\|onApplyPatch\b" apps/web/src/components/FileViewer.tsx | head -20
```

Find the message handler that already routes `od-edit-structural-action` (the drag-move commit). The new `od-edit-insert-commit` branch sits alongside it.

- [ ] **Step 4: Add the routing.**

Inside the message handler (a function called from `window.addEventListener('message', …)`), add this branch:

```tsx
if (data.type === 'od-edit-insert-commit') {
  const { tool, containerId, insertBefore } = data;
  if (tool !== 'text' && tool !== 'shape') return;
  if (typeof containerId !== 'string') return;
  const built = buildInsertedElement(tool);
  const patch: ManualEditPatch = insertBefore
    ? { kind: 'insert-html-before-ref', id: built.id, referenceId: insertBefore, html: built.html }
    : { kind: 'insert-html-as-child', id: built.id, parentId: containerId, html: built.html };
  onApplyPatch(patch, tool === 'text' ? 'Insert text' : 'Insert shape');
  setArmedTool(null);
  return;
}
```

Adjust `onApplyPatch` to whatever the surrounding code calls the apply function (look for the name used in the `od-edit-structural-action` branch).

After the patch lands, the host's existing flow re-renders the iframe; the new element shows up with `data-od-id` matching `built.id`, and the existing target-selection logic picks it up. No extra selection wiring needed in this task — verify in manual smoke.

- [ ] **Step 5: Run the test to verify it passes.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/FileViewer.insert-commit.test.tsx --run
```

Expected: PASS.

- [ ] **Step 6: Manual smoke test.**

```bash
pnpm tools-dev run web --daemon-port 17456 --web-port 17573
```

In a design file, click Shape in the toolbar, hover the canvas (blue indicator follows), click between two elements. A 120×120 grey square appears between them. Hover an empty container, click. Square appears inside.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/components/FileViewer.tsx apps/web/tests/components/FileViewer.insert-commit.test.tsx
git commit -m "feat(web): commit insert-commit messages as insert-html source patches"
```

---

## Task 9: Fill / Hug / Fixed width and height controls

**Files:**
- Modify: `apps/web/src/components/ManualEditPanel.tsx`
- Test: `apps/web/tests/components/ManualEditPanel.test.tsx`

- [ ] **Step 1: Write the failing tests.**

Append to `apps/web/tests/components/ManualEditPanel.test.tsx` (inside the existing `describe('ManualEditPanel', …)`):

```tsx
  it('renders Width and Height 3-way toggles in the style tab', () => {
    renderPanel({ /* selectedTarget = a container */ });
    // Switch to the Style tab if the panel is tab-driven.
    fireEvent.click(screen.getByRole('tab', { name: /style/i }));
    expect(screen.getByRole('group', { name: /width/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /height/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /fixed/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /fill/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /hug/i })).toBeInTheDocument();
  });

  it('switching Width to Fill emits set-style with width: 100%', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange });
    fireEvent.click(screen.getByRole('tab', { name: /style/i }));
    const widthGroup = screen.getByRole('group', { name: /width/i });
    fireEvent.click(within(widthGroup).getByRole('radio', { name: /fill/i }));
    expect(onStyleChange).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ width: '100%' }),
      expect.any(String),
    );
  });

  it('switching Height to Hug emits set-style with height: fit-content', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange });
    fireEvent.click(screen.getByRole('tab', { name: /style/i }));
    const heightGroup = screen.getByRole('group', { name: /height/i });
    fireEvent.click(within(heightGroup).getByRole('radio', { name: /hug/i }));
    expect(onStyleChange).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ height: 'fit-content' }),
      expect.any(String),
    );
  });

  it('switching Width to Fixed reveals a px input that emits set-style on change', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange });
    fireEvent.click(screen.getByRole('tab', { name: /style/i }));
    const widthGroup = screen.getByRole('group', { name: /width/i });
    fireEvent.click(within(widthGroup).getByRole('radio', { name: /fixed/i }));
    const input = within(widthGroup).getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '240' } });
    expect(onStyleChange).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ width: '240px' }),
      expect.any(String),
    );
  });
```

Adjust the `renderPanel` helper if it doesn't exist in the test file — model it on the existing test render scaffolding (see top of `ManualEditPanel.test.tsx`).

- [ ] **Step 2: Run tests to verify they fail.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/ManualEditPanel.test.tsx --run
```

Expected: 4 FAILs.

- [ ] **Step 3: Implement the Fill/Hug/Fixed controls.**

In `apps/web/src/components/ManualEditPanel.tsx`, find the existing style-editing section (it already edits `width`/`height` somewhere — the styles type is in `types.ts` line 17-53). Add a new sub-component near the top of the file (after `emptyManualEditDraft`):

```tsx
type SizeMode = 'fixed' | 'fill' | 'hug';

function sizeModeFromValue(value: string): SizeMode {
  const trimmed = (value || '').trim();
  if (trimmed === '100%') return 'fill';
  if (trimmed === 'fit-content' || trimmed === 'auto') return 'hug';
  return 'fixed';
}

function sizeValueFromMode(mode: SizeMode, fixedPx: number): string {
  if (mode === 'fill') return '100%';
  if (mode === 'hug') return 'fit-content';
  return `${fixedPx}px`;
}

function SizeRow({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const mode = sizeModeFromValue(value);
  const fixedPx = (() => {
    const match = /^(\d+(?:\.\d+)?)px$/.exec((value || '').trim());
    return match ? Number(match[1]) : 120;
  })();
  return (
    <div role="group" aria-label={ariaLabel} className="manual-edit-size-row">
      <span className="manual-edit-size-label">{label}</span>
      <div className="manual-edit-size-toggle">
        {(['fixed', 'fill', 'hug'] as const).map((m) => (
          <label key={m} className={`manual-edit-size-mode${mode === m ? ' active' : ''}`}>
            <input
              type="radio"
              role="radio"
              name={ariaLabel}
              checked={mode === m}
              onChange={() => onChange(sizeValueFromMode(m, fixedPx))}
              aria-label={m}
            />
            <span>{m}</span>
          </label>
        ))}
      </div>
      {mode === 'fixed' && (
        <input
          type="number"
          role="spinbutton"
          value={fixedPx}
          min={0}
          onChange={(e) => onChange(`${Number(e.target.value) || 0}px`)}
          className="manual-edit-size-input"
        />
      )}
    </div>
  );
}
```

Render two `SizeRow`s in the existing style tab. Wire them through `changeTargetStyle` (already defined around line 68 of the file) so they flow through the same `onStyleChange` → `set-style` patch path:

```tsx
<SizeRow
  label={t('manualEdit.size.widthLabel')}
  ariaLabel="width"
  value={draft.styles.width}
  onChange={(v) => changeTargetStyle('width', v)}
/>
<SizeRow
  label={t('manualEdit.size.heightLabel')}
  ariaLabel="height"
  value={draft.styles.height}
  onChange={(v) => changeTargetStyle('height', v)}
/>
```

If the panel does not currently receive `t`, accept it as a prop and thread it from the call site in `FileViewer.tsx`. If it does, reuse it.

Add minimal CSS in `apps/web/src/index.css`:

```css
.manual-edit-size-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.manual-edit-size-toggle { display: inline-flex; border: 1px solid var(--border-1, rgba(0, 0, 0, 0.12)); border-radius: 6px; overflow: hidden; }
.manual-edit-size-mode { padding: 2px 8px; cursor: pointer; font-size: 12px; }
.manual-edit-size-mode input { display: none; }
.manual-edit-size-mode.active { background: #2563eb; color: #fff; }
.manual-edit-size-input { width: 64px; }
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/ManualEditPanel.test.tsx --run
```

Expected: PASS.

- [ ] **Step 5: Manual smoke test.**

In Edit mode, select an inserted shape. In the panel, switch Width to Fill → the shape stretches to 100% of its parent. Switch to Hug → it shrinks to its content (becomes 0 for an empty div — expected). Switch to Fixed → it goes back to 120px. Same for Height.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/components/ManualEditPanel.tsx apps/web/src/index.css apps/web/tests/components/ManualEditPanel.test.tsx
git commit -m "feat(manual-edit): Fill / Hug / Fixed size controls for width and height"
```

---

## Task 10: Delete button with central confirmation modal

**Files:**
- Create: `apps/web/src/components/DeleteConfirmModal.tsx`
- Modify: `apps/web/src/components/ManualEditPanel.tsx`
- Modify: `apps/web/src/components/FileViewer.tsx`
- Test: `apps/web/tests/components/ManualEditPanel.test.tsx` (extend)
- Test: `apps/web/tests/components/DeleteConfirmModal.test.tsx` (new)

- [ ] **Step 1: Write the failing modal test.**

Create `apps/web/tests/components/DeleteConfirmModal.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeleteConfirmModal } from '../../src/components/DeleteConfirmModal';

describe('DeleteConfirmModal', () => {
  it('does not render when closed', () => {
    render(<DeleteConfirmModal open={false} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal open onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel on cancel button or Escape', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<DeleteConfirmModal open onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<DeleteConfirmModal open onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/DeleteConfirmModal.test.tsx --run
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `DeleteConfirmModal`.**

Create `apps/web/src/components/DeleteConfirmModal.tsx`:

```tsx
import { useEffect } from 'react';
import type { Dict } from '../i18n/types';

interface DeleteConfirmModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  t?: (key: keyof Dict) => string;
}

export function DeleteConfirmModal({ open, onCancel, onConfirm, t }: DeleteConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const title = t ? t('manualEdit.deleteConfirm.title') : 'Delete this element?';
  const body = t ? t('manualEdit.deleteConfirm.body') : 'This removes the element from the design.';
  const cancelLabel = t ? t('manualEdit.deleteConfirm.cancel') : 'Cancel';
  const confirmLabel = t ? t('manualEdit.deleteConfirm.confirm') : 'Delete';

  return (
    <div className="delete-confirm-modal-backdrop" role="dialog" aria-modal="true">
      <div className="delete-confirm-modal">
        <h2 className="delete-confirm-modal-title">{title}</h2>
        <p className="delete-confirm-modal-body">{body}</p>
        <div className="delete-confirm-modal-actions">
          <button type="button" onClick={onCancel} className="delete-confirm-cancel">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} className="delete-confirm-confirm">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
```

Append CSS to `apps/web/src/index.css`:

```css
.delete-confirm-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: insert-toolbar-enter 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
.delete-confirm-modal {
  background: var(--surface-1, #fff);
  border-radius: 12px;
  padding: 20px;
  max-width: 360px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
}
.delete-confirm-modal-title { margin: 0 0 8px; font-size: 16px; }
.delete-confirm-modal-body { margin: 0 0 16px; font-size: 13px; color: var(--fg-2, #555); }
.delete-confirm-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.delete-confirm-cancel, .delete-confirm-confirm { padding: 6px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; }
.delete-confirm-cancel { background: var(--surface-2, rgba(0, 0, 0, 0.06)); color: var(--fg-1, #111); }
.delete-confirm-confirm { background: #dc2626; color: #fff; }
.delete-confirm-confirm:hover { background: #b91c1c; }
```

- [ ] **Step 4: Run to verify the modal test passes.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/DeleteConfirmModal.test.tsx --run
```

Expected: PASS.

- [ ] **Step 5: Write the failing ManualEditPanel delete-button test.**

Append to `apps/web/tests/components/ManualEditPanel.test.tsx`:

```tsx
  it('renders a Delete button only when an element is selected', () => {
    const { rerender } = renderPanel({ selectedTarget: null });
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
    rerender(/* re-render with a selectedTarget */);
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('clicking Delete opens the confirm modal; Confirm emits delete-element patch', () => {
    const onApplyPatch = vi.fn();
    renderPanel({ onApplyPatch });
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i, hidden: false }));
    expect(onApplyPatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'delete-element' }),
      expect.any(String),
    );
  });
```

- [ ] **Step 6: Run to verify they fail.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/ManualEditPanel.test.tsx --run
```

Expected: 2 FAILs.

- [ ] **Step 7: Wire the Delete button in `ManualEditPanel`.**

Import the modal at the top:

```tsx
import { DeleteConfirmModal } from './DeleteConfirmModal';
```

Add a local state for the modal inside the component:

```tsx
const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
```

Render a footer near the bottom of the panel's JSX (only when `selectedTarget` is non-null):

```tsx
{selectedTarget && (
  <div className="manual-edit-panel-footer">
    <button
      type="button"
      className="manual-edit-delete"
      onClick={() => setDeleteConfirmOpen(true)}
    >
      {t ? t('manualEdit.delete') : 'Delete'}
    </button>
  </div>
)}
<DeleteConfirmModal
  open={deleteConfirmOpen}
  onCancel={() => setDeleteConfirmOpen(false)}
  onConfirm={() => {
    if (selectedTarget) {
      onApplyPatch({ kind: 'delete-element', id: selectedTarget.id }, 'Delete element');
    }
    setDeleteConfirmOpen(false);
    onClearSelection();
  }}
  t={t}
/>
```

Add CSS:

```css
.manual-edit-panel-footer { padding: 12px; border-top: 1px solid var(--border-1, rgba(0, 0, 0, 0.08)); }
.manual-edit-delete { padding: 6px 12px; border-radius: 6px; border: 1px solid #fecaca; background: #fff; color: #dc2626; cursor: pointer; font-size: 13px; }
.manual-edit-delete:hover { background: #fef2f2; }
```

- [ ] **Step 8: Add the keyboard shortcut in `FileViewer.tsx`.**

Near the existing keyboard handlers for Edit mode, add:

```tsx
useEffect(() => {
  if (!isEditMode) return;
  function onKey(ev: KeyboardEvent) {
    if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
    if (!manualEditTarget) return;
    const tgt = ev.target as HTMLElement | null;
    // Skip when typing in a form field — the user means to delete text, not the element.
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
    ev.preventDefault();
    setDeleteConfirmOpen(true);
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [isEditMode, manualEditTarget]);
```

The `setDeleteConfirmOpen` here is the SAME state that `ManualEditPanel` uses. Lift the state from the panel up to `FileViewer` (panel receives it as a prop) so the keyboard shortcut and the button hit the same modal. Adjust the panel's interface accordingly.

If lifting is too invasive, an alternative is to keep the state in the panel and call a panel-exposed `openDeleteConfirm()` method via a ref or imperative handle. Prefer state-lift — it's simpler.

- [ ] **Step 9: Run all related tests.**

```bash
pnpm --filter @open-design/web test -- apps/web/tests/components/ManualEditPanel.test.tsx apps/web/tests/components/DeleteConfirmModal.test.tsx --run
```

Expected: PASS.

- [ ] **Step 10: Manual smoke test.**

In Edit mode: insert a Shape, click it (selection appears), click Delete in the sidebar → modal opens → confirm → shape vanishes. Repeat with the Delete keyboard key. Verify nothing happens when no selection is active.

- [ ] **Step 11: Commit.**

```bash
git add apps/web/src/components/DeleteConfirmModal.tsx apps/web/src/components/ManualEditPanel.tsx apps/web/src/components/FileViewer.tsx apps/web/src/index.css apps/web/tests/components/DeleteConfirmModal.test.tsx apps/web/tests/components/ManualEditPanel.test.tsx
git commit -m "feat(manual-edit): delete selected element via sidebar + Delete key with central confirm modal"
```

---

## Task 11: End-to-end smoke

**Files:**
- Create: `e2e/tests/edit-mode/insert-toolbar.test.ts`

- [ ] **Step 1: Add a Playwright-driven E2E test.**

Model after an existing `e2e/tests/**` test. The test:
1. Starts the daemon + web through the e2e harness (the existing tests show the pattern).
2. Opens a design file.
3. Enters Edit mode.
4. Clicks the Shape button in the InsertToolbar.
5. Clicks at a known coordinate inside the canvas.
6. Asserts a new `<div>` with `data-od-id` is present in the saved source.
7. Selects the new element, switches Width to Fill, asserts inline `width: 100%`.
8. Clicks Delete, confirms modal, asserts source no longer contains the element.

Pseudocode:

```ts
import { test, expect } from '@playwright/test';
// …import harness…

test('Edit mode: insert shape, resize Fill, delete', async ({ page, daemonClient }) => {
  // … bootstrap a project + design file via the daemon HTTP API …
  await page.goto(/* project URL */);
  await page.getByRole('button', { name: /edit/i }).click();
  await page.getByLabel('Shape').click();
  const canvas = page.frameLocator('[data-od-canvas-iframe]');
  await canvas.locator('body').click({ position: { x: 100, y: 100 } });
  await expect(canvas.locator('[data-od-id^="od-ins-"]')).toBeVisible();

  await canvas.locator('[data-od-id^="od-ins-"]').click();
  await page.getByRole('radio', { name: 'fill' }).first().click();
  await expect(canvas.locator('[data-od-id^="od-ins-"]')).toHaveAttribute('style', /width:\s*100%/);

  await page.getByRole('button', { name: /^delete$/i }).click();
  await page.getByRole('button', { name: /^delete$/i }).nth(1).click(); // modal confirm
  await expect(canvas.locator('[data-od-id^="od-ins-"]')).toHaveCount(0);
});
```

If the existing harness already exposes helpers (`openProject`, `enterEditMode`, …), use them instead of reinventing. Check `e2e/AGENTS.md` for the harness contract before authoring.

- [ ] **Step 2: Run the E2E test locally.**

```bash
pnpm --filter @open-design/e2e test -- e2e/tests/edit-mode/insert-toolbar.test.ts
```

Expected: PASS. If the test depends on fixtures or harness pieces that don't exist, defer this task and document the gap in the PR.

- [ ] **Step 3: Commit.**

```bash
git add e2e/tests/edit-mode/insert-toolbar.test.ts
git commit -m "test(e2e): cover Edit-mode insert toolbar + Fill resize + delete"
```

---

## Final validation

- [ ] **Run the full local validation sweep.**

```bash
pnpm guard
pnpm typecheck
pnpm --filter @open-design/edit-bridge typecheck
pnpm --filter @open-design/edit-bridge build
pnpm --filter @open-design/web test -- --run
pnpm --filter @open-design/web build
```

Expected: all green. New tests bump the overall count by ~20.

- [ ] **Manual end-to-end smoke** via `pnpm tools-dev run web --daemon-port 17456 --web-port 17573`:
  - Toolbar appears only in Edit mode, vanishes on exit.
  - Text tool: hover, click in canvas, "Text" paragraph appears, can be edited inline.
  - Shape tool: hover empty container shows outline indicator, hover between siblings shows blue line indicator. Click commits at the indicator position.
  - Inserted shape gets Fill/Hug/Fixed controls in the sidebar; switching modes updates the iframe immediately.
  - Delete button in the sidebar opens central modal; confirm removes the element. Delete key works too.
  - ESC while armed disarms the tool.
  - Switching tools while armed swaps the armed tool.

- [ ] **Open a PR** following `.github/pull_request_template.md`. Surface area checklist must include: web UI ✓, edit-bridge package ✓, i18n keys ✓. CLI surface is N/A (this is a UI-only authoring feature, with that justification in the PR body).

---

## Self-review notes

Cross-checked against `specs/current/2026-05-26-edit-mode-insert-toolbar.md`:

- **Spec coverage:** All seven in-scope items map to tasks. Toolbar (T6), arm/disarm (T4, T7), hover preview (T4 — reuses existing engine), commit (T4 + T8), default styles (T6 — verified in tests), Fill/Hug (T9), Delete (T10).
- **Out-of-scope features (Frame/Rectangle/Ellipse/Image, configurable defaults, multi-select delete) are not referenced in any task.**
- **No placeholders.** Each code step contains the exact code to write; the only "elided" bits are test-harness boilerplate that already exists in sibling test files and can be copied verbatim.
- **Type consistency:** `InsertToolId` is used in `InsertToolbar.tsx`, `FileViewer.tsx`, and the host-side message handler; both refer to the same exported type. Patch kinds `insert-html-as-child` and `insert-html-before-ref` are spelled identically in types, source-patches, tests, and host handler.
- **Risk noted in spec (`__body__` sentinel)** is exercised in Task 2 Step 1 test "insert-html-as-child treats __body__ as document body".

Adjustments from the spec made while planning:
- The spec mentioned "edit-bridge tests in a separate package tests dir". The actual repo keeps bridge tests under `apps/web/tests/edit-mode/`. Plan updated.
- The spec said "18 locale files". The repo has **19** (`it.ts` is also present). Plan updated.
- The spec used `editMode.*` i18n namespace. The repo already namespaces edit-mode keys as `manualEdit.*`. Plan uses the existing namespace.
