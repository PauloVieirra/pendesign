# Token Sync — Sub-feature A: Read-only extraction from project source

**Status:** Draft (awaiting user review)
**Date:** 2026-05-29
**Owner:** Paulo
**Scope:** Single PR — sub-feature A of the Token Sync roadmap (A→B→C→D→E)

## Summary

Make the Design System Variables modal reflect the colors, fonts, and sizes actually present in the project's generated source code. Each time the AI writes a file in a project workspace, a daemon-side extractor walks the project's source files (CSS, HTML, JSX/TSX), identifies design literals — including Tailwind utility class references resolved through a bundled static map — and registers them as variables in the project's attached Design System. **Read-only**: the source code is not modified in this sub-feature (rewrite to `var(--*)` references is sub-feature B).

## Motivation

- Today the DS modal shows a fixed seed (Container Size / Grid / Typography defaults). It tells the user nothing about what's actually in the project.
- The Edit mode property panel already accepts `var(--token)` bindings and surfaces a `VariablePicker` from `ColorPickerPopover`. But without DS values that match the code, the picker has nothing relevant to offer.
- This sub-feature closes the smallest possible gap: DS becomes observational of the code. Users see colors and fonts from the live project. Editing those values does NOT yet propagate back (sub-feature B). But the picker becomes useful immediately.

## Non-goals

- **Source rewrite** (literals → `var(--*)`): sub-feature B.
- **JSX/TSX `style={{...}}` AST-aware extraction**: sub-feature C. A still extracts `className=` via regex, but `style={{ color: '#fff' }}` JSX expressions are NOT parsed here (regex on JS literals is too brittle).
- **Tailwind config-aware extraction** (project-specific theme overrides via `tailwind.config.js`): sub-feature D. A uses Tailwind's default theme map only.
- **Semantic naming** (HSL clustering, "primary"/"secondary" aliases): sub-feature E.
- **UI badge** for extracted variables in the modal: deferred (current modal works unchanged).
- **Auto-prune** of variables whose literal no longer appears in source: deferred (don't surprise the user by deleting state they may have renamed).
- **CSS-in-JS** (styled-components, emotion, vanilla-extract): out of roadmap. Requires runtime resolution.
- **CDN-loaded stylesheets** (`<link href="https://cdn.jsdelivr.net/.../bootstrap.css">`): out of scope. The extractor only reads files inside the project workspace. Bootstrap works only if `bootstrap.css` is checked into the project.

## Architecture

Extraction is daemon-side only. The web modal already reads `/api/design-systems/:dsId/variables` — no UI changes for A.

```
artifact-create.ts: createProjectArtifactFile()
  └─→ on success: scheduleTokenSync(projectId)
       └─→ debounced 500ms, per-project lock
            └─→ syncProjectNow(projectId)
                 ├─ resolve project → designSystemId → ds directory
                 ├─ list source files (*.css, *.html, *.htm, *.jsx, *.tsx, *.js, *.ts)
                 ├─ extract literals via:
                 │   ├─ extract-css.ts        (.css files)
                 │   ├─ extract-html.ts       (.html, .htm — inline style="" AND class="" via Tailwind)
                 │   └─ extract-jsx.ts        (.jsx, .tsx, .js, .ts — className="" via Tailwind)
                 ├─ tailwind-map.ts           (shared utility-class → token-value lookup)
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

1. Regex over `style="([^"]*)"` and `style='([^']*)'` attributes. Treat each captured string as a CSS declaration block (without braces). Reuse the same per-declaration logic as `extract-css.ts`. Factor the shared logic into a helper `extractFromDeclarations(declarations: string, sourcePath: string): ExtractedTokens` and call it from both extractors.
2. Regex over `class="([^"]*)"` and `class='([^']*)'` attributes. Tokenize the captured class list by whitespace. For each token, call `tailwindClassToTokens(token)` (from `tailwind-map.ts`). Accumulate the result into the same ExtractedTokens record.

Bootstrap utility classes (`btn`, `btn-primary`, etc.) are NOT looked up here — they reference CSS in `bootstrap.css`, which the CSS extractor picks up if `bootstrap.css` is in the workspace. Tailwind classes ARE looked up because they often have no corresponding CSS file in the workspace.

### `apps/daemon/src/token-sync/extract-jsx.ts`

`extractFromJsx(jsxText: string, sourcePath: string): ExtractedTokens`

Implementation:

1. Regex over `className="([^"]*)"` and `className='([^']*)'` and `className={\`([^\`]*)\`}` (template literal with no interpolation). Treat the captured string as a space-separated class list.
2. For each class token, call `tailwindClassToTokens(token)` and accumulate.
3. **Do NOT** parse `style={{...}}` JSX expressions in A — regex-based parsing of JS object literals is fragile (escaped quotes, nested objects, ternaries). Sub-feature C adds AST-based extraction.
4. **Do NOT** resolve `className={cn(...)}` / `className={clsx(...)}` / conditional class helpers — A only sees plain string literals. Common utility helpers (`cn`, `clsx`, `classNames`) are documented limitations.

### `apps/daemon/src/token-sync/tailwind-map.ts`

`tailwindClassMap`: a `Record<string, TailwindEntry>` covering Tailwind v3/v4 default theme utility classes. `TailwindEntry` is:

```typescript
interface TailwindEntry {
  color?: string;        // canonical hex, e.g. '#3b82f6'
  size?: number;         // px, for text-* utilities
  spacing?: number;      // px, for p-*, m-*, gap-*
  fontFamily?: string;   // for font-*
}
```

Coverage (Tailwind default theme):

- **Colors** — every `<utility>-<color>-<shade>` combination, where:
  - utilities: `bg`, `text`, `border`, `ring`, `divide`, `placeholder`, `outline`, `from`, `to`, `via`, `fill`, `stroke`, `decoration`, `caret`, `accent`
  - colors: `slate`, `gray`, `zinc`, `neutral`, `stone`, `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose` (22 hues)
  - shades: `50`, `100`, `200`, `300`, `400`, `500`, `600`, `700`, `800`, `900`, `950` (11 shades)
  - plus literals: `white`, `black`, `transparent` (skipped), `current` (skipped)
  - Total color entries: ~22 hues × 11 shades × 15 utility prefixes = ~3,600 entries. Generated once via a build helper from Tailwind's default theme, then committed as a static TS object.

- **Sizes** — `text-xs` (12), `text-sm` (14), `text-base` (16), `text-lg` (18), `text-xl` (20), `text-2xl` (24), `text-3xl` (30), `text-4xl` (36), `text-5xl` (48), `text-6xl` (60), `text-7xl` (72), `text-8xl` (96), `text-9xl` (128).

- **Spacing** — `p`, `m`, `px`, `py`, `pt`, `pr`, `pb`, `pl`, `mx`, `my`, `mt`, `mr`, `mb`, `ml`, `gap`, `gap-x`, `gap-y`, `space-x`, `space-y` with Tailwind scale `0` (0), `0.5` (2), `1` (4), `1.5` (6), `2` (8), `2.5` (10), `3` (12), `3.5` (14), `4` (16), `5` (20), `6` (24), `7` (28), `8` (32), `9` (36), `10` (40), `11` (44), `12` (48), `14` (56), `16` (64), `20` (80), `24` (96), `28` (112), `32` (128), `36` (144), `40` (160), `44` (176), `48` (192), `52` (208), `56` (224), `60` (240), `64` (256), `72` (288), `80` (320), `96` (384). ~600 entries.

- **Font families** — `font-sans`, `font-mono`, `font-serif`. The default values are stacks (`ui-sans-serif, system-ui, ...`) — we record the first family in the stack.

Total map size: ~4,200 entries. Encoded as a flat TypeScript object literal. Final file ~250 lines (most entries are one-line records).

The map is generated once via a one-time `scripts/build-tailwind-map.ts` script that reads `tailwindcss/defaultTheme` from the Tailwind npm package. The generated file is committed as `apps/daemon/src/token-sync/tailwind-map.generated.ts` to avoid adding `tailwindcss` as a daemon runtime dependency.

Helper:

```typescript
export function tailwindClassToTokens(
  cls: string,
  sourcePath: string,
): Partial<ExtractedTokens>;
```

- Strips Tailwind variants (`md:`, `hover:`, `dark:`, etc.) — the variants are sliced off at the colon; the base class is looked up.
- Strips arbitrary-value syntax (`bg-[#0066ff]`) for v1 — these are rare and the literal value is recoverable; sub-feature C/D handles them precisely.
- Returns the matched bucket entry or `{}` if the class is not in the map.

### Bootstrap

Bootstrap utility classes reference CSS that Bootstrap provides — when the project has Bootstrap CSS in the workspace (typical for non-CDN setups), the existing `extract-css.ts` already extracts the underlying values from selectors like `.btn-primary { background-color: #0d6efd }`. No Bootstrap-specific lookup table is needed.

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

`listProjectSourceFiles(projectId: string): Promise<Array<{ path: string; kind: 'css' | 'html' | 'jsx' }>>` — returns absolute paths with their parser kind.

Implementation:
1. Resolve project directory: typically `<dataDir>/projects/<projectId>/` (see existing `apps/daemon/src/projects.ts` for the canonical resolver). Use the same.
2. Walk the directory recursively. Include extensions:
   - `.css` → kind `'css'`
   - `.html`, `.htm` → kind `'html'`
   - `.jsx`, `.tsx`, `.js`, `.ts` → kind `'jsx'` (this extractor only looks for `className=` Tailwind-style references in v1, regardless of whether the file is React or plain JS; we don't try to detect framework)
3. Skip `node_modules/`, hidden directories (`.*`), build outputs (`dist/`, `build/`, `.next/`, `out/`), binary files.
4. Cap at 200 files per sync to bound work. If exceeded, log and proceed with the first 200.

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
- `apps/daemon/src/token-sync/extract-jsx.ts`
- `apps/daemon/src/token-sync/tailwind-map.generated.ts` — static map of Tailwind default-theme utility classes → token values
- `apps/daemon/src/token-sync/tailwind-lookup.ts` — `tailwindClassToTokens` helper (strips variants, looks up map)
- `apps/daemon/src/token-sync/merge.ts`
- `apps/daemon/src/token-sync/listing.ts` — `listProjectSourceFiles`
- `apps/daemon/scripts/build-tailwind-map.ts` — one-time generator that reads `tailwindcss/defaultTheme` and writes `tailwind-map.generated.ts`. Not run on every build; checked into the repo as committed output.
- `apps/daemon/tests/token-sync/extract-css.test.ts`
- `apps/daemon/tests/token-sync/extract-html.test.ts`
- `apps/daemon/tests/token-sync/extract-jsx.test.ts`
- `apps/daemon/tests/token-sync/tailwind-lookup.test.ts`
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
- `extract-html.test.ts` — HTML fixture with `class="btn bg-blue-500 text-white p-4"` → asserts the Tailwind classes are looked up; assert `bg-*` becomes a color in `colors[]`, `text-white` becomes a color, `p-4` becomes a spacing entry of 16. `btn` is ignored (no entry in the map; Bootstrap classes pass through harmlessly).
- `extract-jsx.test.ts` — JSX fixture with `className="bg-blue-500 text-xl"`, `className='text-red-700'`, `className={\`bg-${dynamic}\`}` (template literal with interpolation — skipped), `className={cn('p-4', flag && 'p-8')}` (utility helper — skipped) → asserts only the static literal classes are extracted.
- `tailwind-lookup.test.ts` — `tailwindClassToTokens('bg-blue-500')` returns `{ color: '#3b82f6' }`. Strips variants (`md:bg-blue-500` works). `hover:bg-blue-500` works. `bg-[#fff]` (arbitrary value) returns `{}` (deferred).
- `merge.test.ts` — start with seed DS, merge extracted tokens, assert new variables appended to Cores/Typography/Spacing. Re-merge same extraction → idempotent (no duplicates).
- `merge.test.ts` — when user has renamed a variable (id same, name changed) and value matches, merge leaves the name alone.

### Integration
- `sync.test.ts` — set up a project workspace under temp dir, write a CSS file with `color: #0066ff;`, call `syncProjectNow(projectId)`, assert the DS's variables.json now has a `color-0066ff` variable.
- `sync.test.ts` — write a `.tsx` file with `className="bg-blue-500 p-4"`, call `syncProjectNow`, assert DS gains a `color-3b82f6` and a `space-16`.
- `sync.test.ts` — write a `.html` file with `class="btn bg-emerald-600"` + a `style.css` with `.btn { background: #fff }`. Assert both `#10b981` (from Tailwind lookup) and `#ffffff` (from CSS) appear.
- `sync.test.ts` — call `scheduleTokenSync` twice in quick succession, wait 600ms, assert only one sync ran (verifies debounce).

## Rollout

- Single PR.
- No feature flag. Token sync runs by default for every project that has a DS attached.
- Risk: extraction parsing bug could write garbage variable names to DS files. Mitigation: extensive unit tests on the extractors with fixtures covering edge cases. The merge is append-only and preserves existing user data, so worst case is some extra junk variables — easy to delete from the modal.

## Open questions

- **CLI `od ds resync`** — include in v1 or defer? Decision: **defer**. Power users can edit and save any DS variable via the modal to force `afterDesignSystemSave` to fire (which already regenerates tokens.css). A manual resync endpoint comes with B/C/D when the rewrite is involved.
- **Auto-prune** — when a user removes a literal from source, should the extracted variable disappear? Decision: **no, defer**. Sub-feature B (rewrite) will replace the literal with a `var()` reference, so the variable is still "referenced". For A, we err on the side of preserving state.
