# Token Sync — Sub-feature A: AI-prompt enforcement + read-only DS extraction

**Status:** Draft (awaiting user review)
**Date:** 2026-05-29
**Owner:** Paulo
**Scope:** Single PR — sub-feature A of the Token Sync roadmap (A→B→C→E; D dropped, see Roadmap section)

## Summary

Make the Design System the canonical source of truth for project styling — from two angles:

1. **Prompt enforcement (push)**: Strengthen the AI agent's system prompt so it generates **pure CSS only** (no Tailwind, no Bootstrap, no utility-class frameworks), using a fixed, DS-aligned scale system for spacing, sizes, radii, and colors. The AI is told to declare every value in `:root { ... }` and reference via `var(--*)` everywhere else.
2. **Read-only extraction (pull)**: A daemon-side extractor walks the project's CSS and HTML files after each AI write, identifies design literals that slipped through (or pre-existed), and registers them as variables in the attached Design System.

**Read-only:** the source is not modified in this sub-feature (rewrite is sub-feature B).

The combination guarantees that **what's in the code is what's in the DS, and vice versa** — without parsing utility classes, without static lookup maps, without AST work. The AI produces token-friendly CSS by construction; the extractor catches the rest.

## Motivation

- The previous spec draft proposed parsing Tailwind/Bootstrap utility classes back into tokens via static lookup maps. That direction inverted the problem: it tried to translate framework dialects into DS tokens after the fact, with edge cases, customizations, and CSS-in-JS unhandled.
- Inverting the architecture: **constrain the generator instead of decoding the output**. The agent's prompt is the only place we control the entire output shape. By forbidding utility frameworks at generation time and enumerating DS-aligned scales, the output becomes trivially extractable from pure CSS.
- This also unifies UX: the Edit-mode property panel already binds to `var(--*)` references. If the AI always emits `var(--*)`, the picker always has tokens to offer. No translation gap.

## Non-goals

- **Source rewrite** (literals → `var(--*)`): sub-feature B. Even with the prompt constraint, the AI may occasionally emit a raw hex; B's rewriter normalizes those.
- **JSX/TSX `style={{...}}` extraction**: sub-feature C — only relevant if/when projects start using inline JSX styles. With pure-CSS prompting, this should be rare.
- **Tailwind / Bootstrap class extraction**: **dropped from roadmap**. The prompt forbids these frameworks, so parsing their classes is unnecessary. If a user manually pastes Tailwind into a project, the values won't make it to the DS — documented as a power-user constraint.
- **Semantic naming** (HSL clustering, "primary"/"secondary" aliases): sub-feature E.
- **UI badge** for extracted variables in the modal: deferred (current modal works unchanged).
- **Auto-prune** of variables whose literal no longer appears in source: deferred.
- **CSS-in-JS** (styled-components, emotion): out of roadmap. The prompt forbids it.
- **CDN-loaded stylesheets**: out of scope. Project must have its CSS materialized in the workspace.

## Architecture

```
┌─ AI generation pipeline (prompts/system.ts) ──────────────────┐
│ composeSystemPrompt() ──→ system prompt sent to AI            │
│   ├─ existing: Active design system + tokens.css contract     │
│   └─ NEW: CSS Architecture Charter                            │  ← change 1
│        ├─ "Pure CSS only. No Tailwind. No Bootstrap."         │
│        ├─ Spacing scale: 4, 8, 12, 16, 20, 24, 32, ...        │
│        ├─ Font-size scale: 12, 14, 16, 18, 20, 24, ...        │
│        ├─ Radius scale: 4, 6, 8, 12, 16, 24, 9999             │
│        ├─ Color organization: :root { --color-* }             │
│        └─ Breakpoints: 412 / 834 / 1440 (matches DS seed)     │
└──────────────────────┬────────────────────────────────────────┘
                       ↓ AI emits CSS/HTML
┌─ artifact-create.ts ─────────────────────────────────────────┐
│ createProjectArtifactFile()                                  │
│ └─→ on success: scheduleTokenSync(projectId)                 │
└──────────────────────┬───────────────────────────────────────┘
                       ↓
┌─ token-sync (new module) ────────────────────────────────────┐  ← change 2
│ scheduleTokenSync (debounced 500ms, per-project lock)        │
│   └─→ syncProjectNow(projectId)                              │
│        ├─ resolve project → designSystemId → ds dir          │
│        ├─ list source files (*.css, *.html, *.htm)           │
│        ├─ extract literals via extract-css.ts / extract-html │
│        ├─ dedupe by canonical value                          │
│        ├─ load existing DS variables file                    │
│        ├─ merge: preserve user-renamed vars, append new      │
│        └─ saveVariables → triggers afterDesignSystemSave     │
└──────────────────────────────────────────────────────────────┘
                       ↓
┌─ /api/design-systems/:id/tokens.css ─────────────────────────┐
│ Auto-regenerated; project's <link> picks it up live          │
└──────────────────────────────────────────────────────────────┘
```

## Change 1: CSS Architecture Charter in the system prompt

A new section appended to `composeSystemPrompt()` in `apps/daemon/src/prompts/system.ts`, after the "Active design system tokens" block (around line 391). The new section is a **hard constraint** on CSS output, regardless of whether an active DS exists.

The literal text to add (verbatim — this is the prompt the AI will read):

```markdown
## CSS architecture — pure CSS, DS-friendly scales

Generate **pure CSS only**. **Do not** use Tailwind, Bootstrap, Tachyons,
or any other utility-class CSS framework. Do not import their stylesheets,
do not use their utility class names (`bg-blue-500`, `text-xl`, `p-4`,
`btn-primary`, `text-center`, `flex`, etc.).

The DS Variables panel of this app extracts tokens from your generated CSS.
Utility classes cannot be extracted. **Every styling decision must be
expressed as a CSS property with a value, in a `<style>` block or external
`.css` file.** If you need a layout idiom that a framework provides, write
the equivalent CSS by hand.

### Token-aligned scales

Use these scales for new values. Snap to the nearest value when in doubt.

- **Spacing** (`margin`, `padding`, `gap`, `inset`, etc., in px):
  4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 224, 256
- **Font-size** (px): 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96
- **Line-height** (unitless): 1, 1.25, 1.5, 1.75, 2
- **Border-radius** (px): 4, 6, 8, 12, 16, 24, 9999 (full pill)
- **Border-width** (px): 1, 2, 4, 8

### Color organization

- Declare every color in `:root { --color-<name>: <value>; }` and reference
  it everywhere via `var(--color-<name>)`. Do not write raw hex / rgb /
  hsl values outside the `:root` block.
- Naming guidelines:
  - Brand colors: `--color-primary`, `--color-primary-hover`,
    `--color-primary-active`, `--color-on-primary` (foreground over primary)
  - Neutrals: `--color-gray-50` through `--color-gray-900` (Tailwind-style)
  - Semantic: `--color-success`, `--color-warning`, `--color-danger`,
    `--color-info`, plus `--color-on-<name>` for foreground variants
  - Surfaces: `--color-background`, `--color-surface`,
    `--color-surface-elevated`, `--color-border`
- Use `oklch(...)` if you can; otherwise `#rrggbb`. Avoid `rgb()`/`hsl()`
  unless they're the natural expression (e.g., alpha overlays).

### Font family

Define in `:root { --font-sans: <stack>; --font-mono: <stack>; --font-display: <stack>; }`
and reference via `var(--font-sans)`. Do not declare `font-family` stacks
outside `:root`.

### Responsive breakpoints

Mirror the DS Container Size collection:

```css
@media (min-width: 412px) { /* mobile */ }
@media (min-width: 834px) { /* tablet */ }
@media (min-width: 1440px) { /* desktop */ }
```

### Combined examples

✅ Allowed:

```css
:root {
  --color-primary: #3b82f6;
  --color-on-primary: #ffffff;
  --color-gray-100: #f3f4f6;
  --font-sans: 'Inter', system-ui, sans-serif;
}
.button {
  background: var(--color-primary);
  color: var(--color-on-primary);
  padding: 12px 24px;
  font-family: var(--font-sans);
  font-size: 16px;
  border-radius: 8px;
}
```

❌ Forbidden:

```html
<button class="bg-blue-500 text-white px-6 py-3 rounded-lg font-semibold">
  Click me
</button>
```

❌ Forbidden:

```html
<link rel="stylesheet"
  href="https://cdn.jsdelivr.net/.../tailwind.min.css">
```
```

The exact wording belongs in a new exported constant `CSS_ARCHITECTURE_CHARTER` (string) inside `apps/daemon/src/prompts/system.ts`, appended to the prompt unconditionally — applies to every artifact generation, not only when a DS is attached.

The existing "Active design system tokens" section (line 391) takes precedence when present — its `tokens.css` block is the authoritative source. The charter complements it by enforcing the *form* of the generated CSS.

### Tail integration with active DS

When an active DS exists, its `tokens.css` already lists the project's :root variables (existing behavior). The charter then says: "use these scale ranges as starting points if no token exists in the active DS for that property". This avoids contradicting the active DS while also seeding good defaults for new projects.

## Change 2: token-sync module (read-only extraction)

Daemon-side only. The web modal already reads `/api/design-systems/:dsId/variables` — no UI changes for A.

### Hook placement

`apps/daemon/src/artifact-create.ts` already exports `createProjectArtifactFile(options)`. Add `void scheduleTokenSync(options.projectId)` after the `writeProjectFile` call resolves. Fire-and-forget — token sync is background work and must never block AI generation.

### Public surface

`apps/daemon/src/token-sync/index.ts`:

```typescript
export function scheduleTokenSync(projectId: string): void;
export async function syncProjectNow(projectId: string): Promise<void>;
```

`scheduleTokenSync` debounces 500ms per project; multiple file writes coalesce. Implementation: per-process `Map<projectId, NodeJS.Timeout>`. Reset on each call. When the timer fires, the callback acquires the per-DS lock and runs `syncProjectNow`. Errors are logged and swallowed.

`syncProjectNow` is exported for tests and CLI use. Runs the full sync once, deterministically.

### Module structure

- `apps/daemon/src/token-sync/index.ts` — orchestrator (debounce + lock + hook)
- `apps/daemon/src/token-sync/types.ts` — shared `ExtractedTokens` type
- `apps/daemon/src/token-sync/extract-css.ts` — `extractFromCss(text, sourcePath): ExtractedTokens`
- `apps/daemon/src/token-sync/extract-html.ts` — `extractFromHtml(text, sourcePath): ExtractedTokens`
- `apps/daemon/src/token-sync/extract-declarations.ts` — shared per-declaration logic
- `apps/daemon/src/token-sync/merge.ts` — `mergeExtractedIntoDs(file, tokens): VariablesFile`
- `apps/daemon/src/token-sync/listing.ts` — `listProjectSourceFiles(projectId): Promise<Array<{path, kind}>>`

### Data shape

```typescript
export interface ExtractedToken<V> {
  value: V;
  usageCount: number;
  sourceFiles: string[];
}

export interface ExtractedTokens {
  colors: ExtractedToken<string>[];   // canonical '#rrggbb' or '#rrggbbaa'
  fonts: ExtractedToken<string>[];    // canonical family name (first in stack)
  sizes: ExtractedToken<number>[];    // px integer
  spacing: ExtractedToken<number>[];  // px integer
}
```

### extract-css.ts

Hand-rolled scanner. No postcss dependency.

1. Strip `/* ... */` comments.
2. For each declaration block `{ ... }`, split by `;`. For each `prop: value`:
   - Skip if value contains `var(`, equals `inherit`/`initial`/`unset`/`currentColor`/`transparent`/`none`/`auto`/`0`/`0px`/`0%`.
   - Bucket by property:
     - Colors: `color`, `background-color`, `background`, `border-color` (+ side variants), `outline-color`, `caret-color`, `fill`, `stroke`, `text-decoration-color`
     - Font-family: extract first family token, strip quotes
     - Sizes: `font-size`, `line-height` (px or rem; rem × 16)
     - Spacing: `margin`, `padding`, `gap`, `row-gap`, `column-gap`, `top`, `right`, `bottom`, `left`, `inset`, `width`, `height`, `min/max-width/height` (px only)
3. Color extractor supports `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, named (50 most common), `hsl()`, `hsla()`. Canonical form: lowercase `#rrggbb` (alpha stripped if ff). Other color functions (`oklch`, `color-mix`) skipped.
4. Background shorthand: extract first color-like token only.

### extract-html.ts

1. Regex `style="(...)"` and `style='(...)'` and `STYLE=` (case-insensitive). Treat captured string as declaration block; reuse `extractFromDeclarations` helper.
2. **No** `class="..."` lookup. Utility-class frameworks (Tailwind, Bootstrap, Tachyons) are forbidden by the prompt; the extractor does not attempt to translate class names back to values.

### merge.ts

`mergeExtractedIntoDs(file: VariablesFile, tokens: ExtractedTokens): VariablesFile`

| Bucket | Target collection | Target group |
|---|---|---|
| colors | Cores | Extracted |
| fonts | Typography | Font Family |
| sizes | Typography | Detected sizes |
| spacing | Spacing | Detected spacing |

For each token:
1. Canonical name:
   - Color: `color-<hex-without-#>`
   - Font: `font-<family-slug>` (lowercase, spaces→`-`, alphanum-dash only)
   - Size: `size-<px>`
   - Spacing: `space-<px>`
2. Search for matching value across the **entire DS** (any collection, any group, any mode). If found, no-op — preserves user organization and renames.
3. Otherwise: ensure target collection+group exist (create with single Default mode if missing), append new variable with the canonical name and the value applied to every mode in the target collection.

Append-only. Never deletes or renames existing variables.

### Project source file discovery

`listProjectSourceFiles(projectId): Promise<Array<{ path: string; kind: 'css' | 'html' }>>`

1. Resolve project directory using existing `apps/daemon/src/projects.ts` resolver.
2. Walk recursively. Include `.css` (kind `'css'`), `.html`/`.htm` (kind `'html'`).
3. Skip `node_modules/`, hidden dirs (`.*`), build outputs (`dist/`, `build/`, `.next/`, `out/`), binary files.
4. Cap at 200 files per sync.

### Per-project lock

Sync runs under `withDsLock(dsKey(designSystemId), fn)` — already exists.

## Edge cases

- **No DS attached** — `project.designSystemId` is null. `syncProjectNow` returns immediately.
- **AI emits a raw hex despite the charter** — extractor catches it. The variable is added with the canonical value-slug name. Sub-feature B then rewrites the literal to a `var()` reference.
- **AI emits Tailwind despite the prompt** — utility classes (`class="bg-blue-500"`) are ignored by the extractor. The value never lands in DS. This is an intentional consequence: the prompt is the contract, the extractor enforces a "pure CSS only" world.
- **Existing user-edited variable** — preserved by name. Merge matches by value across the DS.
- **Token with alpha** — recorded as a distinct color (`#0066ff80` ≠ `#0066ff`). Sub-feature E may unify.
- **Background shorthand with multiple colors** — extract all color-like tokens.
- **Concurrent AI writes during sync** — next `scheduleTokenSync` debounces while in flight; once the lock releases, the next runs.
- **Tokens.css regeneration** — existing `afterDesignSystemSave` hook handles it.

## API surface

No new HTTP endpoints. Sync is internal to the daemon.

## Files

### New (daemon)
- `apps/daemon/src/token-sync/index.ts`
- `apps/daemon/src/token-sync/types.ts`
- `apps/daemon/src/token-sync/extract-css.ts`
- `apps/daemon/src/token-sync/extract-html.ts`
- `apps/daemon/src/token-sync/extract-declarations.ts`
- `apps/daemon/src/token-sync/merge.ts`
- `apps/daemon/src/token-sync/listing.ts`
- `apps/daemon/tests/token-sync/extract-css.test.ts`
- `apps/daemon/tests/token-sync/extract-html.test.ts`
- `apps/daemon/tests/token-sync/merge.test.ts`
- `apps/daemon/tests/token-sync/sync.test.ts`

### Modified (daemon)
- `apps/daemon/src/prompts/system.ts` — adds `CSS_ARCHITECTURE_CHARTER` constant and appends it in `composeSystemPrompt`
- `apps/daemon/src/artifact-create.ts` — calls `scheduleTokenSync` after writes

### Web
- No changes.

### Tests
- `apps/daemon/tests/prompts/system.test.ts` — verify `composeSystemPrompt` includes the charter text and references the spacing/font-size scales.

## Testing

### Unit
- `extract-css.test.ts` — fixtures: hex/rgb/named colors; font-family; font-size px and rem; padding/margin scale values. Invalid CSS (missing `;`, broken brace, mid-comment) → partial extraction, no crash. Skips: `var()`, `inherit`, `0`, `transparent`.
- `extract-html.test.ts` — fixtures: `style=""`, `style=''`, `STYLE=""` (uppercase); no style; multiple elements with different inline styles.
- `merge.test.ts` — seed DS + extracted tokens → new vars appended. Re-merge → idempotent. User-renamed variable preserved.
- `prompts/system.test.ts` — `composeSystemPrompt(input)` contains the literal phrases: "pure CSS only", "Do not use Tailwind", "Spacing", "12, 14, 16, 18, 20, 24", "@media (min-width: 412px)".

### Integration
- `sync.test.ts` — write a CSS file to project workspace with `color: #0066ff; padding: 16px`; call `syncProjectNow`; assert variables.json has `color-0066ff` in Cores/Extracted and `space-16` in Spacing/Detected spacing.
- `sync.test.ts` — write an HTML file with `<div style="color: #ff0000">`; assert `color-ff0000` appears.
- `sync.test.ts` — call `scheduleTokenSync` twice rapidly; assert one sync runs total.

## Rollout

Single PR.

No feature flag. The CSS charter applies to all generations going forward; old projects already on disk are not affected until the next AI write. The extractor runs only when a project has a DS attached.

Risk:
- **Prompt change semantics**: the AI may push back on the constraint or under-comply. Mitigation: the charter is repeated in two places (charter section + the existing "do not invent tokens outside this palette" line), and the system prompt is sent on every turn.
- **Extractor parsing bug**: could write garbage variable names. Mitigation: extensive unit tests; merge is append-only and preserves existing data.

## Roadmap impact

After A:

- **B** (source rewrite) — unchanged. Still needed: AI may emit raw hex; B rewrites it to `var()`.
- **C** (JSX `style={{...}}` AST extraction) — lower priority. With pure-CSS prompting, JSX inline styles should be rare. Keep on roadmap but not next.
- **D** (Tailwind config-aware extraction) — **dropped**. The prompt forbids Tailwind; no need to translate it.
- **E** (semantic naming) — unchanged. Still needed to turn `color-3b82f6` into `primary`, etc.

## Open questions

None blocking. The charter wording can be refined after seeing real AI output.
