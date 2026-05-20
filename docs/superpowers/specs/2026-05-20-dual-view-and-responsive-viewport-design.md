# Dual View Mode + Responsive Viewport — Design Spec

**Date:** 2026-05-20
**Status:** Approved (brainstorming) — awaiting plan
**Scope:** `apps/web` only; no daemon, contracts, or sidecar changes.

## Goal

Add two features to the `FileViewer` in `apps/web`:

1. A third display mode, **Dual**, that shows the file's source code and its rendered design side-by-side with a draggable vertical divider.
2. A fourth viewport preset, **Responsive**, that lets the user free-resize the design preview, with a breakpoint ruler fixed above it. The ruler exposes a selector to switch between Tailwind and Bootstrap breakpoint configurations.

Along the way, rename the existing `desktop` preset to `web` end-to-end.

## Non-goals

- No changes outside `apps/web/src` except the i18n locales it depends on.
- No new daemon endpoints, contract types, or sidecar surface.
- No refactor of the existing toolbar (Tweaks, Inspect, Edit, Comment, etc.) or render-mode decision logic in `file-viewer-render-mode.ts` beyond what's required to host the new modes.
- No theme/token changes.

## User-visible behavior

### Mode dropdown (replaces current Source/Preview toggle)

In the FileViewer header, the existing two-state toggle becomes a single dropdown with three options:

- **Source** — current source-only behavior, unchanged.
- **Preview** — current preview-only behavior, unchanged.
- **Dual** — new split layout described below.

Selecting an item closes the dropdown and applies the mode immediately. The dropdown lives in the same header slot the toggle uses today.

### Dual layout

When `viewMode === 'dual'`:

- A vertical split pane fills the file content area.
- **Left pane:** the same `CodeEditor` component used in Source mode (same edit affordances, same save status indicator).
- **Right pane:** the same render stack used in Preview mode (iframe + existing toolbar, viewport selector, breakpoint ruler when applicable, tweaks/inspect/edit bridges if the file qualifies).
- **Divider:** a 6px-wide vertical grip with `cursor: col-resize` on hover. Drag is free, no snap. Each pane has `minWidth: 240px`. **Double-click resets the split to 50/50.** During drag, the iframe receives `pointer-events: none` and the document gets a global `cursor: col-resize`.
- **Default split ratio:** 0.5 (50/50), every time the user enters Dual. Ratio is not persisted across sessions.

### Debounce-driven re-render in Dual

The `CodeEditor` already auto-commits on a 400ms idle debounce (see `apps/web/src/components/CodeEditor.tsx`). Dual reuses that contract — no new keyboard hook, no snapshot gating.

- When the user types in the left pane, the editor parses the draft on idle. If parsing succeeds, `onCommit(draft)` fires; the host updates the source; the iframe in the right pane re-renders through the same reactive path used by Preview today.
- On parse error, the editor shows the existing `status: 'error'` badge; the iframe keeps showing the last successfully committed source.
- While the user is mid-typing, the editor shows `status: 'pending'` and the iframe stays on the last committed snapshot.
- Source and Preview modes are unchanged — Dual just makes the existing behavior visible side-by-side.

### Responsive viewport preset (4th)

A new preset is added to `PREVIEW_VIEWPORT_PRESETS`:

| id           | width | height | label key                          |
|--------------|-------|--------|------------------------------------|
| `web`        | null  | null   | `fileViewer.viewportWeb`           |
| `tablet`     | 820   | 1180   | `fileViewer.viewportTablet`        |
| `mobile`     | 390   | 844    | `fileViewer.viewportMobile`        |
| `responsive` | null  | null   | `fileViewer.viewportResponsive`    |

(`web` is the renamed `desktop`; see Renaming section.)

When `previewViewport === 'responsive'`:

- The iframe wrapper renders at 100% of its container by default (`responsiveSize === null`).
- A `BreakpointRuler` component is fixed above the iframe.
- A resize handle is visible at the iframe wrapper's bottom-right corner (cursor `nwse-resize`). Dragging it sets `responsiveSize: { width, height }`.
- Bounds: `min 320×400`; `max` = parent container size. Past the max, the handle stops at the edge.
- **Shift+drag** snaps to the active breakpoint preset's marker widths.
- **Double-click the handle** resets `responsiveSize` to `null` (fills container again).

### Breakpoint ruler

Renders only when `previewViewport === 'responsive'`. 28px tall, sits above the iframe wrapper.

- **Markers:** one vertical tick per breakpoint at the matching x-pixel column relative to the iframe, with the breakpoint id (e.g., `sm`, `md`, `lg`, `xl`, `2xl`) as a small label.
- **Active marker:** the marker whose range the current iframe width falls into is highlighted in the accent color; others are neutral.
- **Width badge:** monospace `WIDTH × HEIGHT px` shown at the ruler's right edge, updating live.
- **Below-smallest indicator:** when the iframe width is below the smallest breakpoint of the active preset, the badge prefixes with `< <smallest-id>`; no marker is active.
- **Markers clipped out** (width beyond the visible range) are hidden completely (`display: none`).
- **Preset selector** at the ruler's left edge: a small two-item dropdown `[Tailwind / Bootstrap]`. Switching recalculates the marker positions instantly.

#### Breakpoint preset definitions

```ts
const BREAKPOINT_PRESETS = {
  tailwind: [
    { id: 'sm',  px: 640 },
    { id: 'md',  px: 768 },
    { id: 'lg',  px: 1024 },
    { id: 'xl',  px: 1280 },
    { id: '2xl', px: 1536 },
  ],
  bootstrap: [
    { id: 'sm',  px: 576 },
    { id: 'md',  px: 768 },
    { id: 'lg',  px: 992 },
    { id: 'xl',  px: 1200 },
    { id: 'xxl', px: 1400 },
  ],
} as const;
```

Bootstrap's `xs` (0px) is omitted: a marker at 0 has no useful UI presence.

### Renaming: `desktop` → `web`

End-to-end rename. Affects:

- `PreviewViewportId` union in `FileViewer.tsx`: `'desktop'` becomes `'web'`.
- `PREVIEW_VIEWPORT_PRESETS` entry id.
- CSS class names: `preview-viewport-desktop` → `preview-viewport-web` (and any related selectors in `apps/web/src/index.css` or component CSS).
- i18n keys: `fileViewer.viewportDesktop` → `fileViewer.viewportWeb`, `fileViewer.viewportDesktopTitle` → `fileViewer.viewportWebTitle`. Removed from `Dict` in `types.ts` and from all 19 locale files; replaced by the new `Web` keys.
- Persisted state: any localStorage value with `previewViewport: 'desktop'` is read once at hydration and mapped to `'web'`. No migration runner; the rewrite happens silently on the first read in the new build.

## State

New state on the `FileViewer` host component:

```ts
viewMode: 'source' | 'preview' | 'dual';          // replaces the existing `mode`
splitRatio: number;                                // 0..1, default 0.5
breakpointPreset: 'tailwind' | 'bootstrap';        // default 'tailwind'
responsiveSize: { width: number; height: number } | null;  // null = fill container
```

The existing `PreviewViewportId` union gains `'responsive'`.

### Persistence

Only `viewMode` is persisted, using the same localStorage key the `FileViewer` already writes to today (new field on the same JSON object).

- `splitRatio`, `previewViewport`, `breakpointPreset`, and `responsiveSize` are all session-local; each new session starts at defaults.
- **localStorage key:** none exists for `FileViewer` today (verified at spec time). The implementation creates a new key `od.fileViewer.viewMode` storing a small JSON object `{ viewMode: 'source' | 'preview' | 'dual' }`. Future persisted FileViewer fields can be added to the same object.
- **Migration of legacy state:** if the persisted object has `mode: 'source' | 'preview'`, copy it to `viewMode`. If it has `previewViewport: 'desktop'`, map to `'web'` on read. No separate migration step or feature flag.
- **No `viewMode` persisted:** default `'preview'` (matches current default behavior of the existing `mode`).

## Components

### `apps/web/src/components/SplitPane.tsx` (new)

Generic two-child split pane.

**Props:**

```ts
type SplitPaneProps = {
  children: [ReactNode, ReactNode];
  defaultRatio?: number;              // default 0.5
  minSize?: number;                   // px, default 240
  onRatioChange?: (ratio: number) => void;
};
```

**Behavior:**

- Mouse-driven drag on the divider; touch is out of scope for this iteration.
- Maintains internal ratio state; emits `onRatioChange` after each commit (mouseup) and after double-click reset.
- Clamps ratio so both children stay ≥ `minSize`.
- Sets `document.body.style.cursor = 'col-resize'` during drag; restores on `mouseup` / `mouseleave`.
- Iframe overlay (`pointer-events: none` on the right pane only) is applied via a CSS class while the drag is in progress.

### `apps/web/src/components/BreakpointRuler.tsx` (new)

Rendered by the FileViewer above the iframe when in `responsive` preset.

**Props:**

```ts
type BreakpointRulerProps = {
  width: number;                              // current iframe width in px
  height: number;                             // current iframe height in px
  preset: 'tailwind' | 'bootstrap';
  onPresetChange: (preset: 'tailwind' | 'bootstrap') => void;
};
```

**Behavior:**

- Computes active marker by finding the largest breakpoint `px ≤ width`.
- Markers whose `px > width + smallBuffer` are positioned but invisible (off-screen of the iframe column).
- Preset selector is a two-item native-like dropdown (use the existing app's `Select` primitive if one exists; otherwise a minimal custom one consistent with the header's existing controls).

### `apps/web/src/components/FileViewer.tsx` (modified)

- Replace the Source/Preview toggle render with a dropdown of three modes.
- Add `viewMode`, `splitRatio`, `breakpointPreset`, `responsiveSize` state (plus migration on the existing `mode` and `previewViewport` reads).
- When `viewMode === 'dual'`: render `<SplitPane>` wrapping `<CodeEditor>` and the existing preview subtree.
- When `previewViewport === 'responsive'`: render `<BreakpointRuler>` above the iframe wrapper; replace the fixed `--preview-viewport-width` CSS var with a `100%`/`responsiveSize`-driven sizing path; render the bottom-right resize handle.
- Compute `dualAvailable = containerWidth >= 720`; disable the Dual dropdown item with a tooltip when false; if the active `viewMode === 'dual'` and `!dualAvailable`, render Preview at runtime (without rewriting persisted `viewMode`).
- Compute `dualSupportsThisFile` (file type is renderable as preview); same fallback rule: tooltip on disabled item, runtime fallback to Source if persisted mode is Dual.

### i18n

`apps/web/src/i18n/types.ts` + all 19 locale files under `apps/web/src/i18n/locales/`:

**Added keys:**

- `fileViewer.modeDual`
- `fileViewer.modeDualTitle`
- `fileViewer.modeDualUnavailableSmallWindow` (tooltip)
- `fileViewer.modeDualUnavailableFileType` (tooltip)
- `fileViewer.viewportResponsive`
- `fileViewer.viewportResponsiveTitle`
- `fileViewer.viewportWeb`
- `fileViewer.viewportWebTitle`
- `fileViewer.breakpointPresetTailwind`
- `fileViewer.breakpointPresetBootstrap`
- `fileViewer.breakpointPresetLabel` (selector label / aria)
- `fileViewer.codeEditor.statusSaved`
- `fileViewer.codeEditor.statusPending`
- `fileViewer.codeEditor.statusError`

**Removed keys:**

- `fileViewer.viewportDesktop`
- `fileViewer.viewportDesktopTitle`

The three `codeEditor.*` keys are a pre-existing bug — they are referenced by `CodeEditor.tsx:124-127` but never declared, which is why production `next build` fails the typecheck. This spec includes the fix because the new work touches the editor surface anyway.

## Edge cases (canonical resolutions)

| Case                                                       | Resolution                                                                                                        |
|------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| File type not renderable (JSON, MD, sketch.json, …)        | Dual item shown but disabled with tooltip. If persisted mode is Dual, runtime fallback to Source (no rewrite).    |
| Editor has unsaved changes when switching mode             | No prompt. CodeEditor state and pending status are preserved; preview shows last saved content as today.          |
| Container width < 720px                                    | Dual item disabled with tooltip. If persisted mode is Dual, runtime fallback to Preview (no rewrite).             |
| Preview in URL-load mode (`?forceInline=0` etc.)           | Dual works; ruler still renders. Bridges (tweaks/inspect/edit) remain unavailable as they are today.              |
| Iframe narrower than smallest breakpoint                   | Badge prefixes with `< <smallest-id>`; no active marker.                                                          |
| Resize drag past container bounds                          | Handle stops at the bound. Width/height clamped.                                                                  |
| Resize drag below `min 320×400`                            | Clamp at min; drag continues to register but values don't go lower.                                               |
| Editor `status: 'pending'` (debouncing) while in Dual      | Iframe shows the last committed snapshot; updates as soon as debounce fires successfully.                         |

## Testing

Per `AGENTS.md`: tests live in `apps/web/tests/`, Vitest + JSDOM. UI automation lives in `e2e/ui/`.

### Unit / component (Vitest)

- `apps/web/tests/components/SplitPane.test.tsx` — default ratio, drag math, min-size clamp, double-click reset, body cursor management, `onRatioChange` events.
- `apps/web/tests/components/BreakpointRuler.test.tsx` — active marker by width, preset switch recalculates, below-smallest indicator, off-range markers hidden.
- `apps/web/tests/components/FileViewer.dual.test.tsx` — mode dropdown renders three items; Dual + HTML renders `SplitPane`; Dual + JSON falls back to Source; window-too-small disables Dual; editor `onCommit` propagates to the iframe source (debounce-driven re-render in Dual works via the same path used by Preview today).
- `apps/web/tests/components/FileViewer.viewport.test.tsx` — `responsive` preset renders the ruler; free resize updates `responsiveSize`; Shift+drag snaps to active breakpoint; double-click on handle resets to `null`; legacy persisted `previewViewport: 'desktop'` is read as `'web'`.

### Typecheck

`pnpm --filter @open-design/web typecheck` is part of acceptance. The new keys in `types.ts` make missing locale entries a hard error; this is the i18n coverage gate.

### E2E (Playwright, optional but recommended)

- `e2e/ui/dual-view.spec.ts` — boot app, create an HTML file via API, select Dual, edit, Cmd+S, observe iframe reload.
- `e2e/ui/responsive-ruler.spec.ts` — select Responsive viewport, drag handle, verify active marker, switch Tailwind ↔ Bootstrap, verify marker positions recompute.

Both can be deferred if the unit suite covers behavior; final call belongs to the implementation plan.

### Human verification (gate before merge)

Per `AGENTS.md` bug-follow-up workflow ("for UI changes, green specs alone aren't acceptance"):

1. Run `pnpm tools-dev`.
2. Create an HTML file through the agent flow.
3. Walk through: Source → Preview → Dual; drag divider; double-click reset.
4. In Dual, edit HTML in the left pane; observe the right pane updating ~400ms after you stop typing (debounce-driven, same as existing Preview behavior). Type something that breaks parse (e.g., unclosed `<div`); editor shows error badge, preview keeps last valid render.
5. Switch viewport: Web → Tablet → Mobile → Responsive.
6. In Responsive, drag the corner handle freely; Shift+drag for snap; double-click to fill.
7. Toggle the ruler's selector between Tailwind and Bootstrap; confirm marker recomputation.
8. Reload the app; confirm the persisted mode (and only the mode) is restored.

## Out of scope (explicit)

- Touch-device drag for the split pane and the resize handle. Open Design's primary target is desktop; touch support can land separately if a need arises.
- Configurable breakpoint presets beyond the two built-ins. The selector is two-option only.
- Persisting `splitRatio` / `previewViewport` / `breakpointPreset` / `responsiveSize`. Each session starts clean.
- Visual redesign of the existing toolbar, tweaks UI, or inspect panel.
- Migration of the `desktop → web` rename via a versioned migrator. The runtime read-time mapping is sufficient.
- Editor virtualization improvements for very large files. Out of scope; reuse whatever the existing `CodeEditor` provides.

## Open items for the implementation plan

These are intentional plan-time decisions, not spec-level ambiguity:

- Whether to introduce a small shared `Dropdown` primitive (if the codebase doesn't already have one in this header) or inline the new mode dropdown.
- Whether the Shift+snap during resize commits at snap points only, or follows the cursor with a "magnet" effect within ±12px of a marker.
- Whether the resize handle is the only resize affordance, or whether the right/bottom edges also accept drag with single-axis cursors. The spec assumes corner-only; reconsider if usability calls for it during implementation.
