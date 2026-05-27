# Edit Mode Insert Toolbar — Design

## Purpose

Add a Figma-style floating toolbar at the bottom of the canvas while Edit
mode is active. Initial tools are **Text** and **Shape** (a generic `<div>`).
Clicking a tool arms it; hovering the canvas highlights where the element
will land using the existing drop-plan engine; clicking the canvas commits
the insertion. Inserted elements then participate in the normal Manual
Edit flow (color/size editing, fill/hug resize, deletion).

This builds on prior intent: `apps/web/src/components/InsertToolbar.tsx`
exists as orphan scaffolding and is wired up here.

## Scope

### In scope

1. Floating bottom toolbar in Edit mode with two tools: **Text** and **Shape**.
2. Arm/disarm flow: click tool → cursor becomes insertion crosshair → ESC
   or re-click disarms.
3. Hover preview: reuses the existing `findDropAnchor` / `planForContainer`
   / `dropIndicator` engine in `packages/edit-bridge/src/bridge.ts` (lines
   544-731) so the placement indicator matches the move-element UX exactly.
4. Click-to-commit: host receives `od:insert-commit`, generates element
   HTML via `buildInsertedElement(tool)`, applies a source patch through
   the same path the drag-move flow uses.
5. Default inserted element styles:
   - **Text:** `<p data-od-id="…" style="font-size: 16px; color: #111;">Text</p>`
   - **Shape:** `<div data-od-id="…" style="width: 120px; height: 120px; background-color: #e5e7eb;"></div>`
6. Fill/Hug controls in `ManualEditPanel` for width and height of a
   selected element, mapped to source CSS as:
   - Fixed: numeric `px`
   - Fill: `100%`
   - Hug: `fit-content`
7. Delete control in `ManualEditPanel` footer with a central confirmation
   modal. `Delete` / `Backspace` while an element is selected in the canvas
   triggers the same confirm flow.
8. i18n keys added to `apps/web/src/i18n/types.ts` and all 18 locale files.

### Out of scope

- Frame, Rectangle (separate from generic Shape), Ellipse, and Image
  tools. They remain in `buildInsertedElement` for later, but the toolbar
  UI exposes only Text + Shape.
- Configurable default size / color for inserted shapes from a settings
  surface. Defaults live in code for now.
- Multi-select delete (single selection only).
- Drag-to-reorder of inserted elements beyond what the existing bridge
  already supports.

## UX

### Toolbar

- Position: `position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);`
  relative to the canvas viewport (mounted as a sibling of the canvas
  iframe in the Edit-mode wrapper, not as a child of the iframe).
- Visual: pill-shaped row, two icon buttons, neutral background with a
  prominent box-shadow ("destacando do fundo" per the request).
- Animation: enter ~200ms ease-out, exit ~140ms, per repo convention
  (`cubic-bezier(0.23, 1, 0.32, 1)`).
- Armed tool button: shows a pressed/active state.
- Hidden unless `isEditMode === true`.

### Placement preview

- While armed, the bridge listens for `mousemove` inside the canvas and
  calls the existing `findDropAnchor(x, y, null)` /
  `planForContainer(c, x, y, null)` pair. `draggedEl` is `null` because
  we are creating a new element, not moving one.
- The existing `dropIndicator` overlay is reused unchanged: a line in
  the gap between two siblings for sibling-insert, an outline around the
  target container for drop-inside.
- Cursor in the canvas iframe switches to `crosshair` while armed.

### Commit

- Click inside the canvas → bridge emits
  `od:insert-commit { tool, plan: { containerSelector, insertBefore } }`.
- Host calls `buildInsertedElement(tool)` to get `{ id, html }` and
  applies a patch that inserts the new HTML at the planned location, via
  the existing source-patch path. The host re-renders; the visual move
  matches the drag-move UX.
- After a successful commit the toolbar disarms automatically (one
  insertion per arm). Pressing the tool again starts a new arm.
- ESC or clicking the same tool also disarms without inserting.

### Selection, edit, delete

- Inserted elements carry a unique `data-od-id` so the manual-edit
  selection layer picks them up immediately.
- `ManualEditPanel` gains:
  - **Size section:** two rows (W and H), each with a 3-way toggle
    `Fixed | Fill | Hug`. Switching to Fixed reveals a px input.
  - **Footer:** "Delete" button (subtle red) when an element is selected.
- Delete flow:
  - Click "Delete" or press `Delete`/`Backspace` with a selection.
  - Central modal: "Delete this element?" with Cancel and Delete actions,
    reusing the modal pattern in `NewProjectModal` / `UseEverywhereModal`.
  - Confirm → source patch removes the node by `data-od-id`. The selection
    clears.

## Architecture

### Components

```
apps/web/src/components/
  InsertToolbar.tsx          (existing, ~90 lines, wire up + trim tools)
  FileViewer.tsx             (mount toolbar in Edit-mode region, own armedTool state)
  ManualEditPanel.tsx        (add Fill/Hug controls + Delete button + confirm modal)

packages/edit-bridge/src/
  bridge.ts                  (handlers: od:insert-arm, od:insert-disarm; emit od:insert-commit)
  source-patches.ts          (insertion patch by container+insertBefore; deletion patch by data-od-id)
  types.ts                   (new message types)
```

### Message contracts

Added to the edit-bridge protocol (`packages/edit-bridge/src/types.ts`):

```ts
// Host → bridge
{ type: 'od:insert-arm', tool: 'text' | 'shape' }
{ type: 'od:insert-disarm' }

// Bridge → host
{ type: 'od:insert-commit',
  tool: 'text' | 'shape',
  plan: {
    containerSelector: string,
    insertBefore: string | null   // selector of the sibling to insert before, or null = append
  }
}
```

The plan shape mirrors what the existing drag flow computes internally;
we surface it on the wire so the host can apply the same source-patch
without needing to re-derive the container.

### Data flow

```
User clicks "Shape" button
  → host sets armedTool = 'shape'
  → host posts { type: 'od:insert-arm', tool: 'shape' } into iframe

Bridge enters insert-armed mode
  → cursor = crosshair
  → on mousemove: dropIndicator updates via findDropAnchor + planForContainer
  → on click: emit od:insert-commit with plan, exit insert-armed mode

Host receives od:insert-commit
  → buildInsertedElement('shape') → { id, html }
  → apply source patch (insertion at container/insertBefore)
  → host clears armedTool

Host re-renders the artifact → iframe reload → new element appears with data-od-id
  → manual-edit selection bridge picks it up; ManualEditPanel shows controls
```

### Re-use, not duplication

The drop-plan engine is reused as-is. The only bridge-side change is the
new `armedTool` state and two new mousemove/click branches gated on it.
`findDropAnchor` and `planForContainer` already accept a `draggedEl`
parameter and skip the "exclude dragged element" logic cleanly when it
is `null` — verified by reading their bodies.

The source-patch deletion path already needs to exist for the move flow
(moving an element = remove-then-insert). If it is not currently
exposed as a standalone helper, this work extracts it.

### Sizing semantics (Fill / Hug)

| Mode  | CSS applied                  |
|-------|------------------------------|
| Fixed | `width: <n>px` / `height: <n>px` |
| Fill  | `width: 100%` / `height: 100%`   |
| Hug   | `width: fit-content` / `height: fit-content` |

The patch writes/removes the matching inline-style declaration. No
flexbox-aware "Fill" (`flex: 1`) in this phase — `100%` covers the
common case and avoids inferring the parent's display mode. If a
future user case needs flex-fill, this is the obvious extension point.

## Edge cases

- **Insertion into a text-only node** (`<p>`, `<h2>`): the existing
  `draggableChildrenOf` allow-list already filters these out. New
  elements cannot land inside them — the indicator falls back to the
  nearest containing element.
- **Empty container drop:** `findDropAnchor` already supports this
  (drop-inside with center indicator). Insertion → append child.
- **Click without a valid plan** (cursor outside any source-mappable
  region): no commit. The arm persists until ESC or a valid click.
- **Re-armed mid-flight:** clicking a different tool while armed
  switches the armed tool; clicking the same tool disarms.
- **Delete while no selection:** Delete/Backspace are no-ops outside of
  a selected manual-edit target. Standard browser behavior in form
  fields is preserved (target check on `event.target`).
- **Element with children deleted:** patch removes the subtree. No
  prompt about "this has N children" — the central modal is enough.

## Testing

- `apps/web/tests/edit-mode/bridge.test.ts`: extend with `od:insert-arm`
  / `od:insert-disarm` / `od:insert-commit` scenarios. Cover sibling-
  insert and drop-inside.
- `apps/web/tests/edit-mode/source-patches.test.ts`: insertion patch
  inserts at the planned location; deletion patch removes by
  `data-od-id`; Fill/Hug/Fixed mode toggles produce the expected style
  declarations.
- `apps/web/tests/components/ManualEditPanel.test.tsx`: Fill/Hug toggles
  render; Delete button shows confirm modal; confirm runs the patch.
- New `apps/web/tests/components/InsertToolbar.test.tsx`: tool buttons
  render Text/Shape only, arm/disarm toggling, ESC handler.
- E2E in `e2e/`: arm Shape → click in canvas → element appears at the
  expected place → resize via Fill/Hug → delete via confirm modal.

## Validation

- `pnpm guard`
- `pnpm typecheck`
- `pnpm --filter @open-design/web test`
- `pnpm --filter @open-design/edit-bridge test` (if a test target exists
  in that package; otherwise the bridge is covered through the web
  tests)
- `pnpm tools-dev run web --daemon-port 17456 --web-port 17573` for
  manual smoke against a real design file in Edit mode.

## i18n keys

To add to `apps/web/src/i18n/types.ts` Dict and all 18 locale files:

- `editMode.insertText`
- `editMode.insertShape`
- `editMode.insertToolbarLabel`
- `editMode.size.fixed`
- `editMode.size.fill`
- `editMode.size.hug`
- `editMode.size.widthLabel`
- `editMode.size.heightLabel`
- `editMode.delete`
- `editMode.deleteConfirmTitle`
- `editMode.deleteConfirmBody`
- `editMode.deleteConfirmCancel`
- `editMode.deleteConfirmConfirm`

## Open questions resolved

- Toolbar initial tools: **Text + Shape only**.
- Default shape: **120×120px, `#e5e7eb`**.
- Delete confirmation: **central modal**.
- Placement preview UX: **reuse drop-plan engine** from
  `edit-bridge/bridge.ts:544-731`.

## Risks

- The drag-and-drop engine carries assumptions about the `draggedEl`
  argument that may surface only on insert. Mitigation: read the
  relevant 200 lines of `bridge.ts` before touching it; add targeted
  unit tests for `findDropAnchor(x, y, null)` and
  `planForContainer(c, x, y, null)` before wiring them into the new
  insert flow.
- Source-patch insertion at an arbitrary `insertBefore` selector may
  not exist as a primitive today. Mitigation: extract from the
  drag-move flow during this work and unit-test it independently.
- i18n: adding keys to 18 files is mechanical but easy to miss one,
  which becomes a typecheck error. Mitigation: do this first so
  failures surface early.
