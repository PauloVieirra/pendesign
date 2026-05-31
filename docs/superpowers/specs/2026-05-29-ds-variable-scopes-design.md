# DS Variable Scopes + Color Picker — Design

**Status:** Approved (compact)
**Date:** 2026-05-29
**Owner:** Paulo
**Scope:** Single PR

## Summary

Tag every DS variable with a `scope` identifying the CSS property it represents (color / font-size / padding / etc.). The Edit-mode VariablePicker filters to the scope of the currently-edited property so users no longer see Container Size or Grid Columns when picking a value for `font-size` or `padding`. Adds a colored swatch + click-to-open-picker affordance in the Cores table.

## Motivation

Current state:
- The extractor places all spacing literals into one `Spacing/Detected spacing` group, regardless of whether they came from `padding`, `margin`, or `gap`.
- The VariablePicker (used in Edit-mode property panel) shows every variable across all collections — picking a value for `font-size` lists `Container Size / Resolução` (a width) alongside `Typography / Size / H1`.
- The Cores table renders the hex code as plain text; users see `#049fd9` but no visual cue of what color it is.

Outcomes:
- Pickers show only relevant tokens. Less noise, faster decisions.
- Colors render with a small swatch before the hex; clicking the swatch opens the existing `ColorPickerPopover` (same control already used in Edit mode's color row).
- Extracted variables carry enough metadata for future features (alias suggestions, scope-aware seeds, lint warnings).

## Schema bump v2 → v3

```typescript
export type VariableScope =
  | 'color'
  | 'font-size'
  | 'font-family'
  | 'font-weight'
  | 'line-height'
  | 'padding'
  | 'margin'
  | 'gap'
  | 'border-radius'
  | 'border-width'
  | 'width'
  | 'height'
  | 'opacity'
  | null;             // unscoped — appears in every picker

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  valuesByMode: Record<string, string | number | boolean>;
  scope?: VariableScope;   // ← new
}

export interface VariablesFile {
  version: 3;             // bumped from 2
  collections: VariableCollection[];
}
```

### Migration (daemon-side, on load)

`migrateV2ToV3(file)`:
- For each variable, if `scope` is missing, set `scope: null` (unscoped — backward compatible behavior in the picker, which treats null as "any property").
- Set `file.version = 3`.

`migrateV1ToV2` and `migrateV2ToV3` chain inside `readVariables`; v1 files migrate to v3 on first load via two steps.

## Property → scope mapping

| CSS property | scope | Collection placement |
|---|---|---|
| `color`, `background[-color]`, `border[-side]-color`, `outline-color`, `caret-color`, `fill`, `stroke`, `text-decoration-color` | `color` | Cores / Extracted |
| `font-family` | `font-family` | Typography / Font Family |
| `font-size` | `font-size` | Typography / Detected sizes |
| `font-weight` | `font-weight` | Typography / Weight |
| `line-height` (px or rem) | `line-height` | Typography / Detected sizes |
| `padding`, `padding-*` | `padding` | Spacing / Detected spacing |
| `margin`, `margin-*` | `margin` | Spacing / Detected spacing |
| `gap`, `row-gap`, `column-gap` | `gap` | Spacing / Detected spacing |
| `border-radius`, `border-*-radius` | `border-radius` | **Border Radius / Detected** (new collection) |
| `border-width`, `border-*-width` | `border-width` | **Border Width / Detected** (new collection) |
| `width`, `min-width`, `max-width` | `width` | (skipped — overlaps with Container Size; future) |
| `height`, `min-height`, `max-height` | `height` | (skipped — future) |
| `opacity` | `opacity` | (skipped — future) |

The `width/height/opacity` row are listed for the type union completeness but not yet extracted in this PR (no useful seed defaults; can wait for a clear use case).

Variables created manually via the modal's `+ Create variable` button get `scope = null` (user can pick later in a future enhancement).

## Color swatch + picker in Cores table

In `VariableRow.tsx`, when `variable.type === 'color'`:
- Replace the plain `<input>` cell with a flex row: `[swatch button] [hex input]`.
- Swatch is a `<button class="ds-cell__swatch" style={{ background: <currentValue> }}>` — 16×16 with a 1px border using the OS color-picker contrast pattern (white outer ring on dark backgrounds).
- Clicking the swatch opens `ColorPickerPopover` (from `apps/web/src/components/ColorPickerPopover.tsx`). The popover is the same one used in Edit mode's `ColorRow`. On commit, the new color is sent through `onChangeValueForMode(modeId, newHex)`.
- The hex input still works for direct typing.

## VariablePicker filtering

`VariablePicker` props:

```typescript
interface VariablePickerProps {
  variables: VariablesFile | null;
  requiredScope?: VariableScope;   // ← new
  onPick: (variableId: string) => void;
  onClose: () => void;
}
```

Filtering rules:
1. If `requiredScope` is `undefined` (no scope provided), show all variables (current behavior — backward compatible).
2. If `requiredScope === <some scope>`, show only variables where `v.scope === requiredScope`.
3. **Unscoped variables (scope === null) ALSO appear** when `requiredScope` is set, so users can pick any manually-created variable. (Reasoning: if a user creates `--my-special` without a scope, they probably want to use it anywhere.)

A search input at the top of the picker remains. Filtering by scope happens before search.

## ManualEditPanel wiring

The Edit-mode panel has multiple property contexts that surface `VariablePicker`:

- `ColorRow` (background, color, border-color, etc.) → `requiredScope='color'`
- `FontSizeInput` → `requiredScope='font-size'`
- `FontFamilyInput` → `requiredScope='font-family'`
- `FontWeightInput` → `requiredScope='font-weight'`
- `LineHeightInput` → `requiredScope='line-height'`
- `PaddingInput` → `requiredScope='padding'`
- `MarginInput` → `requiredScope='margin'`
- `GapInput` → `requiredScope='gap'`
- `BorderRadiusInput` → `requiredScope='border-radius'`
- `BorderWidthInput` → `requiredScope='border-width'`

Each `<VariablePicker>` invocation passes the relevant scope. The exact prop name in `ManualEditPanel.tsx` may differ — adapt to the existing handler names.

## Seed adjustments

The current seed creates Container Size / Grid / Typography with specific values. We need to set `scope` on each seeded variable:

- Container Size / Resolução / Resolução → scope `width` (intended unit is px container width)
- Grid / Layout / Columns → scope `null` (it's a count, not a typical CSS-mapped property — leave unscoped)
- Grid / Layout / Margin → scope `margin`
- Grid / Layout / Gutter → scope `gap`
- Typography / Font Family / Font Family → scope `font-family`
- Typography / Size / Display 1..H6 → scope `font-size`
- Typography / Weight / Regular/Medium/Bold → scope `font-weight`

This is a one-line addition to each seed entry in `apps/daemon/src/design-system-seed.ts`.

## Non-goals

- Multiple scopes per variable (Figma supports lists; we use single).
- Width/height/opacity extraction (placeholder in the union; future).
- Scope picker UI in the modal (user can't set/edit scope of manually-created vars in this PR).
- Inferring scope for legacy variables (they stay `scope: null` and act as fallback in every picker).
- VariablePicker UI redesign (still the same list, just filtered).

## Files

### New (daemon)
- `apps/daemon/tests/token-sync/scope-extraction.test.ts` — verifies each property maps to the right scope

### Modified (daemon)
- `apps/daemon/src/design-system-variables.ts` — `VariableScope` type; `Variable.scope?`; `VariablesFile.version: 3`; `migrateV2ToV3`; chain in `readVariables`; helpers' types updated
- `apps/daemon/src/token-sync/types.ts` — extracted token includes `scope`
- `apps/daemon/src/token-sync/extract-declarations.ts` — emit scope per token
- `apps/daemon/src/token-sync/merge.ts` — set scope on merged vars; create Border Radius / Border Width collections when needed
- `apps/daemon/src/design-system-seed.ts` — seed vars get scope set
- `apps/daemon/tests/design-system-variables.test.ts`, `design-system-seed.test.ts`, `token-sync/*.test.ts` — update fixtures + assert scope

### Modified (web)
- `apps/web/src/providers/design-system-variables.ts` — mirror schema changes
- `apps/web/src/components/design-system-manager/VariableRow.tsx` — color swatch + picker integration for `type === 'color'`
- `apps/web/src/components/design-system-manager/VariablePicker.tsx` — `requiredScope` prop + filter
- `apps/web/src/components/ManualEditPanel.tsx` — pass `requiredScope` at each `<VariablePicker>` site (or wherever the picker is invoked)
- `apps/web/src/index.css` — `.ds-cell__swatch` styles

## Testing

### Unit (daemon)
- `migrateV2ToV3` adds `scope: null` to all variables
- `migrateV1ToV2` then `migrateV2ToV3` chain works on v1 fixture
- `extractFromDeclarations` emits each token with the correct scope
- `mergeExtractedIntoDs` sets scope on appended variables; uses new collections for border-radius and border-width
- Seed defaults have scopes set per the mapping table

### Unit (web)
- VariablePicker filters by `requiredScope`; null-scope variables show in any scope context
- VariableRow renders swatch for type=color; click opens popover (test via state assertion)

### Manual
- Open Cores → see swatches with hex codes
- Click swatch → ColorPickerPopover opens with current color
- In Edit mode, click variable icon on a padding input → only padding-scoped + unscoped vars appear (no Typography sizes)
- Same on font-size, font-family, color rows
- New project → seed defaults have correct scopes; extracted vars from CSS get correct scopes

## Rollout

Single PR. Schema migration runs on every load (idempotent for v3 files).
