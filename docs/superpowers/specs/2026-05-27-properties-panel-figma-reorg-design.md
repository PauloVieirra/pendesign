# Properties panel reorg (Figma-style) — design

Status: Approved (brainstorm phase).
Owner: paulo.junior@seatecnologia.com.br.
Date: 2026-05-27.

## Problem

The right-hand properties panel in the design editor's **Edit** mode (rendered by `apps/web/src/components/ManualEditPanel.tsx` → `StyleInspector`) feels cluttered and hides information users need:

1. **Width / Height numeric values are not always visible.** The current `SizeRow` shows three radio buttons (Fixed / Fill / Hug) and only reveals a numeric input when **Fixed** mode is selected. In Fill (`100%`) and Hug (`fit-content`) the actual value the user can rely on is gone from the row.
2. **Numeric inputs do not support 4 decimal places cleanly.** `FixedPxInput` uses `<input type="number">` with no `step`, which means browser steppers round to integers and decimal values can render inconsistently. Other numeric rows (`UnitRow`, `QuadCell`) inherit similar limitations.
3. **Section organization does not match designer expectations.** Sections are labeled in UPPERCASE with weak visual hierarchy (`TYPOGRAPHY`, `SIZE`, `LAYOUT`, `BOX`). The `BOX` section mixes Fill (background), Opacity, Padding, Margin, Border, and Radius into one wall, which is unlike Figma's clear Fill / Stroke / Appearance / Layout separation that users are familiar with.

## Goals

1. Reorganize the panel so its structure mirrors Figma's right rail (adapted to HTML/CSS realities).
2. Make the W/H numeric value visible at all times — including when Fill or Hug mode is active.
3. Support up to 4 decimal places in numeric inputs without truncation or browser-side rounding.
4. Strengthen visual section separation (sentence-case headers, dividers, room for per-section action buttons).
5. Preserve existing behavioral guarantees: design-system variable tokens are non-destructive, content fields (text/href/src/alt) still live-preview on keystroke, page-level inspector still works, undo/redo still flows through the same `onStyleChange` / `onApplyPatch` handlers.

## Non-goals

- No `Position` section with X / Y inputs (HTML flow doesn't have absolute positioning by default; not adding it).
- No reskin of the canvas, layers panel, or insert toolbar — only the right-hand inspector.
- No new style properties (only reorganization + UX of existing ones).
- No changes to the patch protocol in `@open-design/edit-bridge` or to host wiring in `FileViewer`.

## New section order

```
┌─ Layout ─────────────────────────────────────────────────┐
│  Size                                                    │
│    W  [611      ][mode-icon]   H  [709      ][mode-icon] │
│  Flex                                                    │
│    Gap [8] px   Direction [Row ▾]                        │
│    Justify [Start ▾]   Align [Stretch ▾]                 │
│  Spacing                                                 │
│    Padding [T R B L]                                     │
│    Margin  [T R B L]                                     │
├─ Typography ─────────────────────────────────────────────┤
│  Font [Inter ▾]                                          │
│  Size [16] px      Weight [400 ▾]                        │
│  Color [■ 000000]  Align [Left ▾]                        │
│  Line [1.4]        Tracking [0]                          │
├─ Appearance ─────────────────────────────────────────────┤
│  Opacity [1.0]                                           │
├─ Fill ───────────────────────────────────────────────────┤
│  [■] FFFFFF                                              │
├─ Stroke ─────────────────────────────────────────────────┤
│  [■] 000000        Style [Solid ▾]                       │
│  Width [T R B L]                                         │
│  Radius [4] px                                           │
└──────────────────────────────────────────────────────────┘
```

Notes:
- `Layout` collects everything related to the box's outer shape and inner spacing. Sub-labels `Size`, `Flex`, `Spacing` are rendered as small uppercase mini-headers within the section.
- `Spacing` (Padding + Margin) opens by default, can be collapsed.
- `Appearance` is intentionally minimal for now (just Opacity) to leave room for future additions (blend mode, shadows) without restructuring again.

## W/H row redesign (the key UX fix)

### Current
```
Width    ( Fixed | Fill | Hug )   [120]
                                  ↑ only visible in Fixed
```

### New
```
W  [611       ] [icon]   H  [709       ] [icon]
   └ value     └ mode toggle (cycles Fixed → Fill → Hug)
```

Behavior:
- Input field is always present and shows the **effective value**:
  - Fixed → editable number (e.g., `611`).
  - Fill → read-only `100%`.
  - Hug → read-only `auto`.
- Icon button to the right cycles modes: Fixed → Fill → Hug → Fixed. Tooltip shows the next state on hover (e.g., "Switch to Fill"). The icon itself reflects the **current** mode (cube for Fixed, arrows-out for Fill, fit-content glyph for Hug).
- **Unset state** (`width === ''`): mode toggle shows the Fixed icon (since clicking it should begin in Fixed), input is empty with placeholder `"auto"`. First keystroke commits a Fixed value; first toggle click writes `100%` (Fill) or `fit-content` (Hug). This preserves the current behavior where unset means "no inline width".
- `var(--token)` value still renders the existing token chip + clear button (no data loss). Same `manual-edit-size-token` / `manual-edit-size-clear` classes.
- ARIA: container keeps `role="group" aria-label="width"`. Mode button gets `aria-label="Width mode: Fixed"` and `data-mode="fixed"`. The numeric input gets `aria-label="Width in pixels"` when Fixed, `aria-label="Width fill"` / `"Width hug"` when not (and `aria-readonly="true"`).
- The W and H rows are paired side-by-side using the existing `cc-pair` grid (two columns).

## Decimal-precision fix

Apply uniformly to `FixedPxInput`, `UnitRow`, and `QuadCell` numeric inputs:

1. Replace `<input type="number">` with `<input type="text" inputMode="decimal">`.
   - `type="number"` forces browser steppers and rounding; `text + inputMode` preserves the user's typed precision while still surfacing the mobile decimal keypad.
2. Local draft + commit-on-blur stays as it is (already correct).
3. Accept regex: `/^-?\d*(\.\d{0,4})?$/` for the **typing draft** (allows partial entries like `12.`, `-`, and `''`). On blur, validate against `/^-?\d+(\.\d{0,4})?$/`; if more than 4 decimals slipped in (e.g., pasted), truncate to 4 via `Number(draft).toFixed(4)` and strip trailing zeros only if the original draft had none.
4. Stepper buttons reuse `formatSteppedNumber`, which already preserves the current decimal width.
5. On commit, normalize `120.5000` → `"120.5000px"` (preserve trailing zeros if the user typed them — they may carry intent like grid alignment).
6. `normalizePxValue` (`apps/web/src/components/ManualEditPanel.tsx:630`) already matches `^-?\d+(\.\d+)?(px)?$/`, which accepts arbitrary precision. No change needed there.

## Visual style changes

Applied to `apps/web/src/index.css` lines around 20678–20910:

| Token | Before | After |
| --- | --- | --- |
| Panel width | `280px` | `300px` (more room for W/H side-by-side + always-visible value) |
| `.cc-section-head` | `font-size: 10px; UPPERCASE; letter-spacing: 0.08em; color: muted` | `font-size: 12px; Sentence case; font-weight: 600; color: var(--text)` |
| Section divider | none (gap only) | `border-top: 1px solid var(--border); padding-top: 10px;` between sections |
| Mini-headers (`Size`, `Flex`, `Spacing` inside Layout) | n/a | new class `.cc-section-sub` — `font-size: 10px; UPPERCASE; color: muted; padding-top: 4px;` (same look the old `.cc-section-head` had) |
| Section action slot | n/a | new flex container in `.cc-section-head` to host trailing icons (e.g., constraints toggle, collapse chevron) |
| Row height | `26px` | `26px` (unchanged) |
| W/H mode icon | n/a | 18×18 button in `.cc-value`, reusing `.cc-step` look |

The .cc-section visual is wrapped: the header + body now sit inside a top border so sections feel like Figma's stacked cards.

## Component changes summary

`apps/web/src/components/ManualEditPanel.tsx`:
- Rewrite `SizeRow` to render `[input] + [mode icon button]` instead of three radios.
- New helper `<SizeModeIcon mode="fixed" | "fill" | "hug" />` (inline SVG, three glyphs).
- Replace `FixedPxInput`'s `<input type="number">` with a text input + decimal regex.
- Extend `UnitRow` and `QuadCell` to use the same text+decimal pattern.
- Reorganize `StyleInspector` JSX to emit, in order: `Layout` (with sub-sections `Size`, `Flex`, `Spacing`), `Typography`, `Appearance`, `Fill`, `Stroke`.
- Add `<SubSection title="Size">`, `<SubSection title="Flex">`, `<SubSection title="Spacing">` lightweight wrappers (just a label + body).
- Move existing Padding / Margin `QuadRow`s into `Spacing`.
- Move existing Opacity row into `Appearance`.
- Split Border into `Stroke` section (color + style + Width quad + Radius).
- Split background into `Fill` section.

`apps/web/src/index.css`:
- Update `.manual-edit-workspace` grid template to `minmax(420px, 1fr) 300px`.
- Update `.cc-section-head` typography per table above; add top border + padding.
- Add `.cc-section-sub` for mini-headers.
- Add `.cc-size-pair` grid for the side-by-side W / H layout (the existing `.cc-pair` is fine; alias for clarity).
- Add `.cc-size-mode-btn` for the W/H mode icon button.

## Behavior preserved (the guarantees)

- `normalizeManualEditStyles` keeps accepting `100%`, `fit-content`, `auto`, `var(--token)`, hex, rgba, px literals — no change to the normalizer contract.
- `onStyleChange(id, styles, label)` is still emitted on blur, not on every keystroke (confirmed by the existing test "Fixed mode emits once on blur, not on every keystroke").
- Var-token data-loss prevention: when `width` / `height` carry `var(--...)`, the row renders the token chip + clear button. Mode buttons and numeric input are hidden, identical to today.
- Page inspector and Content inspector are unchanged.
- Delete button + confirm modal at the panel footer are unchanged.

## Test impact

`apps/web/tests/components/ManualEditPanel.test.tsx` — these specs need to be updated to match the new SizeRow shape:

- `'renders Width and Height 3-way toggles in the SIZE section'`: replace radio-button assertions with mode-button assertions (`button[aria-label="Width mode: …"]`, `data-mode="fixed|fill|hug"`).
- `'switching Width to Fill emits onStyleChange with width: 100%'`: click the mode button until Fill, expect the same emit.
- `'switching Height to Hug emits onStyleChange with height: fit-content'`: same shape.
- `'Fixed mode reveals a px input that emits onStyleChange on blur'`: input is now always present; assert `type="text"` instead of `type="number"`, plus the blur emit.
- `'renders a clear-token chip when width is a var() token (no data loss)'`: unchanged — token chip path is preserved.
- `'does not check any radio when width is unset (empty string)'`: rewrite to assert that the mode button shows the Fixed icon and the numeric input renders empty.
- `'Fixed mode emits once on blur, not on every keystroke'`: unchanged behavior; selector switches to `input[type="text"]`.

Add new specs:
- `'W/H numeric input is visible when mode is Fill (read-only)'`
- `'W/H numeric input is visible when mode is Hug (read-only)'`
- `'Fixed input accepts up to 4 decimal places without truncation'`
- `'Stepping a value with 2 decimals preserves the decimal width'`
- `'Stroke section renders border color, style, width quad, and radius'`
- `'Layout section renders Size → Flex → Spacing sub-sections in order'`

E2E (`e2e/ui/app-manual-edit.test.ts`, `app-edit-insert-toolbar.test.ts`): the existing specs select by visible labels (`Width`, `Height`, `Background`, `Padding`) — they should remain stable. If any spec asserts the section title `SIZE` or `BOX`, swap to `Layout` / `Fill` / `Stroke`.

## Edge cases & risks

- **Browser quirks with decimal inputs**: `<input type="text" inputMode="decimal">` shows the period decimal separator regardless of locale. We do not attempt locale-aware decimals here (consistent with the rest of OD's editor surfaces).
- **Negative values**: width/height accept no negatives. The regex `/^-?\d+(\.\d{0,4})?$/` accepts `-` for consistency with the existing UnitRow behavior (e.g., negative margins), but the normalizer clamps non-applicable negatives in `normalizePxValue`. Width/Height-specific rejection stays out of scope here.
- **Migration of token values for mode**: when a user clicks Fixed while `width: var(--container-max)` is set, today the row shows the chip and offers Clear. We keep that. The mode-toggle button is hidden while a token is bound.
- **Custom values already in source** (e.g., `width: 50vh`): `sizeModeFromValue` treats anything that is not `''`, `'100%'`, or `'fit-content' | 'auto'` as Fixed. The new design preserves this: the row shows the literal `50vh` in the input field with the Fixed icon. The user can edit it freely; commits go through the normalizer.

## Out of scope (deferred follow-ups)

- Constraint icon next to W/H (Figma's aspect-ratio lock) — not in this pass.
- Per-corner radius (TL/TR/BR/BL) — out of scope; current single-value radius stays.
- Stroke position dropdown (Inside / Outside / Center) — HTML borders don't support Outside without box-shadow hacks. Skip.
- Effects (drop-shadow, blur). Add later if requested.
- Locale-aware decimal separator.

## File touch list (estimate)

- `apps/web/src/components/ManualEditPanel.tsx` — main rewrite (StyleInspector + SizeRow + FixedPxInput + UnitRow + QuadCell).
- `apps/web/src/index.css` — section visuals + W/H mode button + panel width.
- `apps/web/tests/components/ManualEditPanel.test.tsx` — update existing specs; add new ones.
- Possibly `apps/web/src/i18n/locales/*.ts` — if section headers become localized (currently hard-coded `SIZE`, `BOX`, etc. are hard-coded strings; check whether new labels go through i18n).

## Open questions for implementation

1. Should section headers become i18n keys now? The current `Section title="TYPOGRAPHY"` is hard-coded English. Adding 5+ keys × 18 locales is non-trivial — decision is to defer i18n unless it's already required by another part of the panel.
2. Should the new mode icons be SVGs inline or part of a shared icon set? Inline SVG (~3 small icons) keeps the change self-contained; no new icon dependency.
