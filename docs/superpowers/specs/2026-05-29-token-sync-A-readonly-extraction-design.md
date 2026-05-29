# Token Sync — Sub-feature A: Read-only extraction from project source

**Status:** Draft (awaiting user review)
**Date:** 2026-05-29
**Owner:** Paulo
**Scope:** Single PR — sub-feature A of the Token Sync roadmap (A→B→C→D→E)

## Summary

Make the Design System Variables modal reflect the colors, fonts, and sizes actually present in the project's generated source code. Each time the AI writes a file in a project workspace, a daemon-side extractor walks the project's CSS and HTML files, identifies design literals (colors, font-families, font-sizes, spacing), and registers them as variables in the project's attached Design System. **Read-only**: the source code is not modified in this sub-feature (rewrite to `var(--*)` references is sub-feature B).

## Motivation

- Today the DS modal shows a fixed seed (Container Size / Grid / Typography defaults). It tells the user nothing about what's actually in the project.
- The Edit mode property panel already accepts `var(--token)` bindings and surfaces a `VariablePicker` from `ColorPickerPopover`. But without DS values that match the code, the picker has nothing relevant to offer.
- This sub-feature closes the smallest possible gap: DS becomes observational of the code. Users see colors and fonts from the live project. Editing those values does NOT yet propagate back (sub-feature B). But the picker becomes useful immediately.

## Non-goals

- **Source rewrite** (literals → `var(--*)`): sub-feature B.
- **JSX/TSX `style={{...}}` extraction**: sub-feature C.
- **Tailwind `className="..."` lookup**: sub-feature D.
- **Semantic naming** (HSL clustering, "primary"/"secondary" aliases): sub-feature E.
- **UI badge** for extracted variables in the modal: deferred (current modal works unchanged).
- **Auto-prune** of variables whose literal no longer appears in source: deferred (don't surprise the user by deleting state they may have renamed).

## Architecture

Extraction is daemon-side only. The web modal already reads `/api/design-systems/:dsId/variables` — no UI changes for A.

```
artifact-create.ts: createProjectArtifactFile()
  └─→ on success: scheduleTokenSync(projectId)
       └─→ debounced 500ms, per-project lock
            └─→ syncProjectNow(projectId)
                 ├─ resolve project → designSystemId → ds directory
                 ├─ list source files in project workspace (*.css, *.html, *.htm)
                 ├─ extract literals via extract-css.ts and extract-html.ts
                 ├─ dedupe by canonical value
                 ├─ load existing DS variables file
                 ├─ merge: preserve existing variable ids/names, append new
                 └─ save variables.json (regenerates tokens.css through the existing afterDesignSystemSave hook)
```

## Hook placement

`apps/daemon/src/artifact-create.ts` already exports `createProjectArtifactFile(options)`. Add `void scheduleTokenSync(options.projectId)` after the `writeProjectFile` call resolves. Fire-and-forget — token sync is background work and must never block AI generation.

## Token sync module

### `apps/daemon/src/token-sync/index.ts`

Public surface:

```typescript
export function scheduleTokenSync(projectId: string): void;
export async function syncProjectNow(projectId: string): Promise<void>;
```

`scheduleTokenSync` debounces 500ms per project; multiple file writes in rapid succession coalesce to one extraction. Implementation: per-process `Map<projectId, NodeJS.Timeout>`. Reset on each call. When the timer fires, the callback acquires a per-project async mutex (via the existing `withDsLock` keyed on the DS id) and runs `syncProjectNow`. Errors are logged and swallowed so a parse failure on one file doesn't crash the daemon.

`syncProjectNow` is exported for tests and CLI use. It runs the full sync once, deterministically.

### `apps/daemon/src/token-sync/types.ts`

```typescript
export interface ExtractedToken<V> {
  value: V;
  usageCount: number;
  sourceFiles: string[];
}

export interface ExtractedTokens {
  colors: ExtractedToken<string>[];   // canonical hex like '#0066ff' (lowercase, no alpha for v1)
  fonts: ExtractedToken<string>[];    // canonical family name like 'Inter' (first family in stack)
  sizes: ExtractedToken<number>[];    // px integer
  spacing: ExtractedToken<number>[];  // px integer
}
```

### `apps/daemon/src/token-sync/extract-css.ts`

`extractFromCss(cssText: string, sourcePath: string): ExtractedTokens`

Implementation: hand-rolled scanner (no postcss dependency).

1. Strip CSS comments (`/* ... */`).
2. For each declaration block `{ ... }`, split by `;`, then for each `prop: value` pair:
   - Trim and normalize.
   - Skip if value contains `var(`, equals `inherit`, `initial`, `unset`, `currentColor`, `transparent`, `none`, `auto`, `0`, `0px`, or `0%`.
   - Bucket by property:
     - **Color properties**: `color`, `background-color`, `background`, `border-color`, `border-top-color`, `border-right-color`, `border-bottom-color`, `border-left-color`, `outline-color`, `caret-color`, `fill`, `stroke`, `text-decoration-color` → extract color literal (see below).
     - **Font-family**: `font-family` → extract first family token (the part before first `,`), stripped of quotes.
     - **Sizes**: `font-size`, `line-height` → if `Npx`, extract `N`. If `Nrem`, extract `N*16`. Else skip.
     - **Spacing**: `margin`, `padding`, `gap`, `row-gap`, `column-gap`, `top`, `right`, `bottom`, `left`, `inset`, `width`, `height`, `min-width`, `min-height`, `max-width`, `max-height` → for each `Npx` token in the value, extract `N`.

3. Color literal extraction supports:
   - Hex `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. Canonical form: lowercase `#rrggbb`, alpha stripped if `ff`, kept as `#rrggbbaa` otherwise. (For v1, alpha values are kept verbatim — sub-feature E may treat alpha variants as the same token.)
   - `rgb(r, g, b)` and `rgba(r, g, b, a)`: convert to canonical hex.
   - Named CSS colors (`red`, `blue`, etc.): convert to canonical hex via a small built-in lookup table (50 most common).
   - `hsl(...)`, `hsla(...)`: convert to canonical hex.
   - Anything else (color functions like `color-mix`, `oklch`, etc.): skip.

4. Background shorthand: only extract the color portion; the rest (image/position/repeat) is ignored. Use a simple "first token that looks like a color" rule.

5. Result accumulates `ExtractedToken` records keyed by canonical value, incrementing `usageCount` for each hit and pushing `sourcePath` into `sourceFiles` (deduplicated).

### `apps/daemon/src/token-sync/extract-html.ts`

`extractFromHtml(htmlText: string, sourcePath: string): ExtractedTokens`

Implementation:

1. Regex over `style="([^"]*)"` and `style='([^']*)'` attributes.
2. Treat each captured string as a CSS declaration block (without braces). Reuse the same per-declaration logic as `extract-css.ts`. Factor the shared logic into a helper `extractFromDeclarations(declarations: string, sourcePath: string): ExtractedTokens` and call it from both extractors.

### `apps/daemon/src/token-sync/merge.ts`

`mergeExtractedIntoDs(file: VariablesFile, tokens: ExtractedTokens): VariablesFile`

For each extracted bucket, determine the target collection. Collection names match the existing seed:

| Bucket | Collection | Group |
|---|---|---|
| colors | Cores | Extracted |
| fonts | Typography | Font Family |
| sizes | Typography | Detected sizes |
| spacing | Spacing | Detected spacing |

For each missing collection/group, create it (single Default mode for Cores/Spacing; Desktop/Tablet/Mobile already on Typography from the seed).

For each token in the bucket:
1. Compute the canonical variable name:
   - Color: `color-<hex-without-#>` (e.g., `color-0066ff`).
   - Font: `font-<family-slug>` (slug: lowercase, spaces → `-`, drop non-alphanum-dash).
   - Size: `size-<px>` (e.g., `size-16`).
   - Spacing: `space-<px>`.
2. Search the target group's variables for a match by value (across all modes). If found, **do nothing** — the variable already exists. This preserves any user-renamed variables.
3. Otherwise, search the same value across the entire DS (in case the user moved it to a different collection). If found, do nothing — respect user organization.
4. Otherwise, append a new variable to the target group with:
   - id: `newVariableId()`
   - name: the canonical name from step 1
   - type: `color` for colors; `string` for fonts; `number` for sizes/spacing
   - valuesByMode: same value across every mode in the target collection

The merge is **append-only**. Variables no longer referenced are not removed (deferred to a future "prune" sub-feature).

### Project source file discovery

`listProjectSourceFiles(projectId: string): Promise<string[]>` — returns absolute paths.

Implementation:
1. Resolve project directory: typically `<dataDir>/projects/<projectId>/` (see existing `apps/daemon/src/projects.ts` for the canonical resolver). Use the same.
2. Walk the directory recursively. Include files with extensions `.css`, `.html`, `.htm`. Skip `node_modules/`, hidden directories (`.*`), and binary files.
3. Cap at 200 files per sync to bound work. If exceeded, log and proceed with the first 200.

### Per-project lock

The sync runs under the DS-level lock (`withDsLock(dsKey, fn)`) that already exists in `design-system-variables.ts`. This serializes sync with manual variable edits.

## Edge cases

- **No DS attached** — `project.designSystemId` is null. `syncProjectNow` returns immediately.
- **DS locked/missing** — `resolveDsDir` returns null. Log and return.
- **Empty source directory** — extraction completes with zero tokens. No-op.
- **Single file > 1 MB** — parsed normally. The regex/scanner is linear.
- **Malformed CSS** — best-effort. Errors swallowed; what's parseable is extracted, the rest skipped.
- **User has already renamed a variable** — preserved. Merge matches by value across all variables, not by name.
- **Token value with alpha (e.g., `#0066ff80`)** — recorded as a distinct variable from its opaque variant. Sub-feature E can unify.
- **Background shorthand with multiple colors** (e.g., `background: linear-gradient(red, blue)`) — extract both. Each occurrence increments usage.
- **Concurrent AI writes during sync** — the next `scheduleTokenSync` debounces while in flight; once the current sync releases the lock, the next runs.
- **Tokens.css regeneration** — the existing `afterDesignSystemSave` hook handles it; nothing new needed.

## API surface

No new HTTP endpoints. The sync is internal to the daemon. Optional CLI helper:

```bash
od ds resync <projectId>     # forces sync now (calls syncProjectNow)
```

Defer if it complicates the PR; can be a follow-up.

## Files

### New (daemon)
- `apps/daemon/src/token-sync/index.ts`
- `apps/daemon/src/token-sync/types.ts`
- `apps/daemon/src/token-sync/extract-css.ts`
- `apps/daemon/src/token-sync/extract-html.ts`
- `apps/daemon/src/token-sync/merge.ts`
- `apps/daemon/src/token-sync/listing.ts` — `listProjectSourceFiles`
- `apps/daemon/tests/token-sync/extract-css.test.ts`
- `apps/daemon/tests/token-sync/extract-html.test.ts`
- `apps/daemon/tests/token-sync/merge.test.ts`
- `apps/daemon/tests/token-sync/sync.test.ts` — integration: write a project file, wait, assert variables.json updated

### Modified (daemon)
- `apps/daemon/src/artifact-create.ts` — schedule sync after each write

### Web
- No changes. The DS modal already renders variables.json as-is.

## Testing

### Unit
- `extract-css.test.ts` — CSS fixture with colors (hex, rgb, named), font-families, font-sizes (px, rem), padding/margin → assert ExtractedTokens shape. Counts and source-file tracking verified.
- `extract-css.test.ts` — invalid CSS: missing `;`, broken brace, comment in middle → no crash, partial extraction.
- `extract-css.test.ts` — skips: `var()`, `inherit`, `0`, `0px`, `transparent`.
- `extract-html.test.ts` — HTML fixtures with `style="..."` and `style='...'` and `STYLE="..."` (uppercase) and no style at all. Counts.
- `merge.test.ts` — start with seed DS, merge extracted tokens, assert new variables appended to Cores/Typography/Spacing. Re-merge same extraction → idempotent (no duplicates).
- `merge.test.ts` — when user has renamed a variable (id same, name changed) and value matches, merge leaves the name alone.

### Integration
- `sync.test.ts` — set up a project workspace under temp dir, write a CSS file with `color: #0066ff;`, call `syncProjectNow(projectId)`, assert the DS's variables.json now has a `color-0066ff` variable.
- `sync.test.ts` — call `scheduleTokenSync` twice in quick succession, wait 600ms, assert only one sync ran (verifies debounce).

## Rollout

- Single PR.
- No feature flag. Token sync runs by default for every project that has a DS attached.
- Risk: extraction parsing bug could write garbage variable names to DS files. Mitigation: extensive unit tests on the extractors with fixtures covering edge cases. The merge is append-only and preserves existing user data, so worst case is some extra junk variables — easy to delete from the modal.

## Open questions

- **CLI `od ds resync`** — include in v1 or defer? Decision: **defer**. Power users can edit and save any DS variable via the modal to force `afterDesignSystemSave` to fire (which already regenerates tokens.css). A manual resync endpoint comes with B/C/D when the rewrite is involved.
- **Auto-prune** — when a user removes a literal from source, should the extracted variable disappear? Decision: **no, defer**. Sub-feature B (rewrite) will replace the literal with a `var()` reference, so the variable is still "referenced". For A, we err on the side of preserving state.
