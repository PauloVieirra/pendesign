# Token Sync A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project's Design System reflect the actual CSS in its source files — by constraining the AI generator to pure-CSS-with-DS-aligned-scales (system prompt charter) AND by extracting design literals from `.css` / `.html` files into DS variables on every AI write (daemon background job).

**Architecture:** Two independent slices in one PR. (1) Prompt charter: a new constant string appended to `composeSystemPrompt` in `apps/daemon/src/prompts/system.ts` that forbids utility-class frameworks and enumerates spacing/font-size/radius scales. (2) Token-sync module: new `apps/daemon/src/token-sync/` directory with a hand-rolled CSS scanner, an HTML inline-style extractor, a merger that appends to the existing v2 VariablesFile shape, and a debounced orchestrator wired into `createProjectArtifactFile`. No web changes; the modal already renders variables.json as-is.

**Tech Stack:** TypeScript (ESM, `.js` extensions in imports), Vitest 4, `tsx` runtime for the daemon. No new daemon dependencies.

**Spec:** `docs/superpowers/specs/2026-05-29-token-sync-A-readonly-extraction-design.md`

---

## File Structure

### New (daemon)

- `apps/daemon/src/prompts/css-architecture-charter.ts` — exports the `CSS_ARCHITECTURE_CHARTER` constant (one responsibility: the charter text)
- `apps/daemon/src/token-sync/types.ts` — `ExtractedToken<V>`, `ExtractedTokens` shared types
- `apps/daemon/src/token-sync/extract-declarations.ts` — shared per-`prop: value` parser used by both extractors
- `apps/daemon/src/token-sync/extract-css.ts` — `extractFromCss(text, sourcePath): ExtractedTokens`
- `apps/daemon/src/token-sync/extract-html.ts` — `extractFromHtml(text, sourcePath): ExtractedTokens`
- `apps/daemon/src/token-sync/merge.ts` — `mergeExtractedIntoDs(file, tokens): VariablesFile`
- `apps/daemon/src/token-sync/listing.ts` — `listProjectSourceFiles(projectDir): Promise<Array<{ path; kind }>>`
- `apps/daemon/src/token-sync/index.ts` — `scheduleTokenSync(projectId)`, `syncProjectNow(projectId)`
- `apps/daemon/tests/token-sync/extract-declarations.test.ts`
- `apps/daemon/tests/token-sync/extract-css.test.ts`
- `apps/daemon/tests/token-sync/extract-html.test.ts`
- `apps/daemon/tests/token-sync/merge.test.ts`
- `apps/daemon/tests/token-sync/listing.test.ts`
- `apps/daemon/tests/token-sync/sync.test.ts`
- `apps/daemon/tests/prompts/css-architecture-charter.test.ts`

### Modified (daemon)

- `apps/daemon/src/prompts/system.ts` — import the charter and append it inside `composeSystemPrompt`
- `apps/daemon/src/artifact-create.ts` — fire-and-forget `void scheduleTokenSync(options.projectId)` after `writeProjectFile`

### Web

No changes.

---

## Phase 1 — CSS Architecture Charter (prompt change)

### Task 1: `CSS_ARCHITECTURE_CHARTER` constant

**Files:**
- Create: `apps/daemon/src/prompts/css-architecture-charter.ts`
- Test: `apps/daemon/tests/prompts/css-architecture-charter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/tests/prompts/css-architecture-charter.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { CSS_ARCHITECTURE_CHARTER } from '../../src/prompts/css-architecture-charter.js';

test('charter forbids utility-class frameworks by name', () => {
  for (const name of ['Tailwind', 'Bootstrap', 'Tachyons']) {
    assert.ok(
      CSS_ARCHITECTURE_CHARTER.includes(name),
      `charter must mention ${name} by name`,
    );
  }
  assert.ok(CSS_ARCHITECTURE_CHARTER.includes('pure CSS only'));
  assert.ok(CSS_ARCHITECTURE_CHARTER.includes('Do not'));
});

test('charter enumerates spacing scale', () => {
  for (const v of ['4', '8', '12', '16', '20', '24', '32', '40', '48', '64', '80', '96', '128']) {
    assert.ok(
      CSS_ARCHITECTURE_CHARTER.includes(v),
      `spacing scale must include ${v}`,
    );
  }
});

test('charter enumerates font-size scale', () => {
  for (const v of ['12', '14', '16', '18', '20', '24', '30', '36', '48', '60', '72', '96']) {
    assert.ok(
      CSS_ARCHITECTURE_CHARTER.includes(v),
      `font-size scale must include ${v}`,
    );
  }
});

test('charter mentions :root color organization', () => {
  assert.ok(CSS_ARCHITECTURE_CHARTER.includes(':root'));
  assert.ok(CSS_ARCHITECTURE_CHARTER.includes('--color-'));
  assert.ok(CSS_ARCHITECTURE_CHARTER.includes('var(--'));
});

test('charter declares the three responsive breakpoints', () => {
  assert.ok(CSS_ARCHITECTURE_CHARTER.includes('412'));
  assert.ok(CSS_ARCHITECTURE_CHARTER.includes('834'));
  assert.ok(CSS_ARCHITECTURE_CHARTER.includes('1440'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @open-design/daemon test css-architecture-charter`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the constant**

Create `apps/daemon/src/prompts/css-architecture-charter.ts`:

```typescript
/**
 * CSS Architecture Charter — appended to every system prompt.
 *
 * Constrains the AI agent to pure CSS with DS-aligned scales so that the
 * token-sync extractor can parse the generated CSS into a Design System
 * without needing utility-class lookup tables.
 *
 * See: docs/superpowers/specs/2026-05-29-token-sync-A-readonly-extraction-design.md
 */
export const CSS_ARCHITECTURE_CHARTER = `## CSS architecture — pure CSS, DS-friendly scales

Generate **pure CSS only**. **Do not** use Tailwind, Bootstrap, Tachyons,
or any other utility-class CSS framework. Do not import their stylesheets,
do not use their utility class names (\`bg-blue-500\`, \`text-xl\`, \`p-4\`,
\`btn-primary\`, \`text-center\`, \`flex\`, etc.).

The DS Variables panel of this app extracts tokens from your generated CSS.
Utility classes cannot be extracted. **Every styling decision must be
expressed as a CSS property with a value, in a \`<style>\` block or external
\`.css\` file.** If you need a layout idiom that a framework provides, write
the equivalent CSS by hand.

### Token-aligned scales

Use these scales for new values. Snap to the nearest value when in doubt.

- **Spacing** (\`margin\`, \`padding\`, \`gap\`, \`inset\`, etc., in px):
  4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 224, 256
- **Font-size** (px): 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96
- **Line-height** (unitless): 1, 1.25, 1.5, 1.75, 2
- **Border-radius** (px): 4, 6, 8, 12, 16, 24, 9999 (full pill)
- **Border-width** (px): 1, 2, 4, 8

### Color organization

- Declare every color in \`:root { --color-<name>: <value>; }\` and reference
  it everywhere via \`var(--color-<name>)\`. Do not write raw hex / rgb /
  hsl values outside the \`:root\` block.
- Naming guidelines:
  - Brand colors: \`--color-primary\`, \`--color-primary-hover\`,
    \`--color-primary-active\`, \`--color-on-primary\` (foreground over primary)
  - Neutrals: \`--color-gray-50\` through \`--color-gray-900\` (Tailwind-style)
  - Semantic: \`--color-success\`, \`--color-warning\`, \`--color-danger\`,
    \`--color-info\`, plus \`--color-on-<name>\` for foreground variants
  - Surfaces: \`--color-background\`, \`--color-surface\`,
    \`--color-surface-elevated\`, \`--color-border\`
- Use \`oklch(...)\` if you can; otherwise \`#rrggbb\`. Avoid \`rgb()\`/\`hsl()\`
  unless they're the natural expression (e.g., alpha overlays).

### Font family

Define in \`:root { --font-sans: <stack>; --font-mono: <stack>; --font-display: <stack>; }\`
and reference via \`var(--font-sans)\`. Do not declare \`font-family\` stacks
outside \`:root\`.

### Responsive breakpoints

Mirror the DS Container Size collection:

\`\`\`css
@media (min-width: 412px) { /* mobile */ }
@media (min-width: 834px) { /* tablet */ }
@media (min-width: 1440px) { /* desktop */ }
\`\`\`

### Combined examples

✅ Allowed:

\`\`\`css
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
\`\`\`

❌ Forbidden:

\`\`\`html
<button class="bg-blue-500 text-white px-6 py-3 rounded-lg font-semibold">
  Click me
</button>
\`\`\`

❌ Forbidden:

\`\`\`html
<link rel="stylesheet"
  href="https://cdn.jsdelivr.net/.../tailwind.min.css">
\`\`\`
`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @open-design/daemon test css-architecture-charter`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/prompts/css-architecture-charter.ts apps/daemon/tests/prompts/css-architecture-charter.test.ts
git commit -m "feat(prompts): add CSS Architecture Charter — pure CSS + DS-aligned scales"
```

---

### Task 2: Wire charter into `composeSystemPrompt`

**Files:**
- Modify: `apps/daemon/src/prompts/system.ts:291` (function `composeSystemPrompt`)

- [ ] **Step 1: Write the failing test**

Create or extend `apps/daemon/tests/prompts/css-architecture-charter.test.ts`:

```typescript
import { composeSystemPrompt } from '../../src/prompts/system.js';

test('composeSystemPrompt includes the CSS Architecture Charter unconditionally', () => {
  // Minimal input — no design system, no memory, no skills.
  const prompt = composeSystemPrompt({});
  assert.ok(
    prompt.includes('pure CSS only'),
    'charter should be present even when no design system is attached',
  );
  assert.ok(prompt.includes('Tailwind'));
});

test('composeSystemPrompt still includes charter when a design system is attached', () => {
  const prompt = composeSystemPrompt({
    designSystemTitle: 'Vision Test',
    activeDesignSystemBody: '# DS prose',
    designSystemTokensCss: ':root { --color-primary: #abc; }',
  });
  assert.ok(prompt.includes('pure CSS only'));
  assert.ok(prompt.includes('--color-primary'));
});
```

Note: `composeSystemPrompt` takes a `ComposeInput` object (see line 174 of `system.ts`). Inspect that interface to provide a valid empty-ish input — fields are likely optional or have sensible defaults. Read `apps/daemon/src/prompts/system.ts:174-289` to see the full shape.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @open-design/daemon test css-architecture-charter`
Expected: FAIL — `composeSystemPrompt(...)` does not contain "pure CSS only".

- [ ] **Step 3: Edit `composeSystemPrompt` to append the charter**

Open `apps/daemon/src/prompts/system.ts`. Add the import at the top:

```typescript
import { CSS_ARCHITECTURE_CHARTER } from './css-architecture-charter.js';
```

Locate the `composeSystemPrompt` function (around line 291). It assembles the prompt by `push`ing strings into an array (look for `sections.push(...)` or similar accumulator pattern). Find the spot AFTER the "Active design system tokens" block (which is around line 391, the one with the `\`\`\`css ${designSystemTokensCss}\`\`\`` template). Append a new push call right after it (or at the very end of the accumulator before the final `.join('\n\n')`):

```typescript
sections.push(`\n\n${CSS_ARCHITECTURE_CHARTER}`);
```

If the accumulator variable is not literally `sections`, use whatever name the existing code uses. The key is: the charter goes AFTER any DS-specific content, and BEFORE the return statement.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @open-design/daemon test css-architecture-charter`
Expected: PASS (7 tests total now).

- [ ] **Step 5: Verify no regressions in adjacent prompt tests**

Run: `pnpm --filter @open-design/daemon test prompts`
Expected: PASS for all prompt tests. If any existing test breaks because it asserts the exact length / hash of the system prompt, update it to allow the new charter section.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/prompts/system.ts apps/daemon/tests/prompts/css-architecture-charter.test.ts
git commit -m "feat(prompts): append CSS Architecture Charter to every system prompt"
```

---

## Phase 2 — Token-sync extractors and merge

### Task 3: Shared types and per-declaration parser

**Files:**
- Create: `apps/daemon/src/token-sync/types.ts`
- Create: `apps/daemon/src/token-sync/extract-declarations.ts`
- Test: `apps/daemon/tests/token-sync/extract-declarations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/tests/token-sync/extract-declarations.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { extractFromDeclarations } from '../../src/token-sync/extract-declarations.js';

function empty() { return { colors: [], fonts: [], sizes: [], spacing: [] }; }

test('extracts a hex color from a color property', () => {
  const out = empty();
  extractFromDeclarations('color: #0066ff', '/p/style.css', out);
  assert.equal(out.colors.length, 1);
  assert.equal(out.colors[0].value, '#0066ff');
  assert.equal(out.colors[0].usageCount, 1);
  assert.deepEqual(out.colors[0].sourceFiles, ['/p/style.css']);
});

test('rgb()/rgba() canonicalize to #rrggbb hex', () => {
  const out = empty();
  extractFromDeclarations('background: rgb(0, 102, 255)', '/p/a.css', out);
  extractFromDeclarations('background: rgba(0, 102, 255, 1)', '/p/b.css', out);
  assert.equal(out.colors.length, 1);
  assert.equal(out.colors[0].value, '#0066ff');
  assert.equal(out.colors[0].usageCount, 2);
});

test('named color "red" canonicalizes to #ff0000', () => {
  const out = empty();
  extractFromDeclarations('color: red', '/p/a.css', out);
  assert.equal(out.colors[0].value, '#ff0000');
});

test('font-family extracts first family, stripped of quotes', () => {
  const out = empty();
  extractFromDeclarations(`font-family: "Inter", system-ui, sans-serif`, '/p/a.css', out);
  assert.equal(out.fonts.length, 1);
  assert.equal(out.fonts[0].value, 'Inter');
});

test('font-size in px and rem (rem * 16)', () => {
  const out = empty();
  extractFromDeclarations('font-size: 16px', '/p/a.css', out);
  extractFromDeclarations('font-size: 1rem', '/p/b.css', out);
  assert.equal(out.sizes.length, 1);
  assert.equal(out.sizes[0].value, 16);
  assert.equal(out.sizes[0].usageCount, 2);
});

test('spacing properties yield each px token', () => {
  const out = empty();
  extractFromDeclarations('padding: 12px 24px 16px', '/p/a.css', out);
  const values = out.spacing.map(s => s.value).sort();
  assert.deepEqual(values, [12, 16, 24]);
});

test('skips var(), inherit, 0, transparent, none, auto, currentColor', () => {
  const out = empty();
  for (const decl of [
    'color: var(--x)',
    'color: inherit',
    'padding: 0',
    'padding: 0px',
    'background: transparent',
    'border: none',
    'width: auto',
    'color: currentColor',
  ]) {
    extractFromDeclarations(decl, '/p/a.css', out);
  }
  assert.equal(out.colors.length, 0);
  assert.equal(out.spacing.length, 0);
});

test('deduplicates the same color value across multiple calls but tracks source files', () => {
  const out = empty();
  extractFromDeclarations('color: #fff', '/p/a.css', out);
  extractFromDeclarations('color: #ffffff', '/p/b.css', out);
  extractFromDeclarations('color: #FFFFFF', '/p/c.css', out);
  assert.equal(out.colors.length, 1);
  assert.equal(out.colors[0].value, '#ffffff');
  assert.equal(out.colors[0].usageCount, 3);
  assert.deepEqual(out.colors[0].sourceFiles.sort(), ['/p/a.css', '/p/b.css', '/p/c.css']);
});

test('background shorthand extracts only color-like tokens', () => {
  const out = empty();
  extractFromDeclarations('background: #ff0000 url(image.png) no-repeat', '/p/a.css', out);
  assert.equal(out.colors.length, 1);
  assert.equal(out.colors[0].value, '#ff0000');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @open-design/daemon test token-sync/extract-declarations`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `types.ts`**

Create `apps/daemon/src/token-sync/types.ts`:

```typescript
export interface ExtractedToken<V> {
  value: V;
  usageCount: number;
  sourceFiles: string[];
}

export interface ExtractedTokens {
  colors: ExtractedToken<string>[];
  fonts: ExtractedToken<string>[];
  sizes: ExtractedToken<number>[];
  spacing: ExtractedToken<number>[];
}

export function emptyExtractedTokens(): ExtractedTokens {
  return { colors: [], fonts: [], sizes: [], spacing: [] };
}
```

- [ ] **Step 4: Implement `extract-declarations.ts`**

Create `apps/daemon/src/token-sync/extract-declarations.ts`:

```typescript
import type { ExtractedToken, ExtractedTokens } from './types.js';

const COLOR_PROPS = new Set([
  'color', 'background', 'background-color',
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color',
  'outline-color', 'caret-color', 'fill', 'stroke',
  'text-decoration-color',
]);

const FONT_PROPS = new Set(['font-family']);

const SIZE_PROPS = new Set(['font-size', 'line-height']);

const SPACING_PROPS = new Set([
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'gap', 'row-gap', 'column-gap',
  'top', 'right', 'bottom', 'left', 'inset',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
]);

const SKIP_VALUES = new Set([
  'inherit', 'initial', 'unset', 'currentcolor', 'transparent',
  'none', 'auto', '0', '0px', '0%',
]);

const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
  olive: '#808000', lime: '#00ff00', aqua: '#00ffff', teal: '#008080',
  navy: '#000080', fuchsia: '#ff00ff', purple: '#800080', orange: '#ffa500',
  pink: '#ffc0cb', brown: '#a52a2a', tan: '#d2b48c', salmon: '#fa8072',
  gold: '#ffd700', indigo: '#4b0082', violet: '#ee82ee', khaki: '#f0e68c',
  beige: '#f5f5dc', ivory: '#fffff0', snow: '#fffafa', tomato: '#ff6347',
  coral: '#ff7f50', orchid: '#da70d6', plum: '#dda0dd', wheat: '#f5deb3',
  azure: '#f0ffff', linen: '#faf0e6', crimson: '#dc143c',
  // 50 most common; extend as needed
};

function canonicalizeHex(hex: string): string | null {
  const h = hex.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) {
    return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  if (/^#[0-9a-f]{4}$/.test(h)) {
    const a = h[4];
    if (a === 'f') {
      return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    }
    return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] + a + a;
  }
  if (/^#[0-9a-f]{6}$/.test(h)) return h;
  if (/^#[0-9a-f]{8}$/.test(h)) {
    if (h.slice(7) === 'ff') return h.slice(0, 7);
    return h;
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number, a?: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const hex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  const base = '#' + hex(r) + hex(g) + hex(b);
  if (a == null || a >= 1) return base;
  return base + hex(a * 255);
}

function hslToHex(h: number, s: number, l: number, a?: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const cf = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbToHex(cf(0) * 255, cf(8) * 255, cf(4) * 255, a);
}

function extractColorFromValueToken(token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  if (t.startsWith('#')) return canonicalizeHex(t);
  if (t.toLowerCase() in NAMED_COLORS) return NAMED_COLORS[t.toLowerCase()];
  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(t);
  if (rgbMatch) {
    return rgbToHex(+rgbMatch[1], +rgbMatch[2], +rgbMatch[3], rgbMatch[4] != null ? +rgbMatch[4] : undefined);
  }
  const hslMatch = /^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(t);
  if (hslMatch) {
    return hslToHex(+hslMatch[1], +hslMatch[2], +hslMatch[3], hslMatch[4] != null ? +hslMatch[4] : undefined);
  }
  return null;
}

function extractPxNumber(token: string): number | null {
  const px = /^(-?\d+(?:\.\d+)?)px$/i.exec(token.trim());
  if (px) {
    const n = parseFloat(px[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const rem = /^(-?\d+(?:\.\d+)?)rem$/i.exec(token.trim());
  if (rem) {
    const n = parseFloat(rem[1]) * 16;
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

function ensureToken<V>(bucket: ExtractedToken<V>[], value: V, sourcePath: string): void {
  const existing = bucket.find((t) => t.value === value);
  if (existing) {
    existing.usageCount += 1;
    if (!existing.sourceFiles.includes(sourcePath)) existing.sourceFiles.push(sourcePath);
    return;
  }
  bucket.push({ value, usageCount: 1, sourceFiles: [sourcePath] });
}

/**
 * Parse a CSS-declaration-block contents (without the surrounding braces)
 * and accumulate extracted tokens into `out`.
 */
export function extractFromDeclarations(
  declarations: string,
  sourcePath: string,
  out: ExtractedTokens,
): void {
  for (const raw of declarations.split(';')) {
    const decl = raw.trim();
    if (!decl) continue;
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!value) continue;
    if (value.includes('var(')) continue;
    const lower = value.toLowerCase();
    if (SKIP_VALUES.has(lower)) continue;

    if (COLOR_PROPS.has(prop)) {
      // Split on whitespace and try each token as a color.
      for (const token of value.split(/\s+/)) {
        const hex = extractColorFromValueToken(token);
        if (hex) {
          ensureToken(out.colors, hex, sourcePath);
          break; // only first color-like token in shorthand
        }
      }
    } else if (FONT_PROPS.has(prop)) {
      const first = value.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
      if (first && first.toLowerCase() !== 'inherit') {
        ensureToken(out.fonts, first, sourcePath);
      }
    } else if (SIZE_PROPS.has(prop)) {
      const n = extractPxNumber(value);
      if (n != null) ensureToken(out.sizes, n, sourcePath);
    } else if (SPACING_PROPS.has(prop)) {
      for (const token of value.split(/\s+/)) {
        const n = extractPxNumber(token);
        if (n != null) ensureToken(out.spacing, n, sourcePath);
      }
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @open-design/daemon test token-sync/extract-declarations`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/token-sync/types.ts apps/daemon/src/token-sync/extract-declarations.ts apps/daemon/tests/token-sync/extract-declarations.test.ts
git commit -m "feat(token-sync): per-declaration parser with color/font/size/spacing buckets"
```

---

### Task 4: CSS file extractor

**Files:**
- Create: `apps/daemon/src/token-sync/extract-css.ts`
- Test: `apps/daemon/tests/token-sync/extract-css.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/tests/token-sync/extract-css.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { extractFromCss } from '../../src/token-sync/extract-css.js';

test('extracts tokens from a simple CSS file', () => {
  const css = `
    :root {
      --color-primary: #0066ff;
    }
    .button {
      color: #ffffff;
      background: #0066ff;
      padding: 12px 24px;
      font-size: 16px;
      font-family: 'Inter', sans-serif;
    }
  `;
  const out = extractFromCss(css, '/p/style.css');
  // Note: --color-primary is a declaration inside :root — we DO extract the #0066ff value.
  // .button color #ffffff, .button background #0066ff (already seen), so colors.length === 2.
  assert.equal(out.colors.length, 2);
  const blues = out.colors.find((c) => c.value === '#0066ff')!;
  assert.equal(blues.usageCount, 2);
  assert.equal(out.fonts.length, 1);
  assert.equal(out.fonts[0].value, 'Inter');
  assert.equal(out.sizes.length, 1);
  assert.equal(out.sizes[0].value, 16);
  assert.deepEqual(out.spacing.map((s) => s.value).sort(), [12, 24]);
});

test('strips /* ... */ comments before parsing', () => {
  const css = `
    .a {
      /* color: #ff0000; */
      color: #00ff00;
    }
  `;
  const out = extractFromCss(css, '/p/a.css');
  assert.equal(out.colors.length, 1);
  assert.equal(out.colors[0].value, '#00ff00');
});

test('handles malformed CSS without crashing', () => {
  const css = `
    .a { color: #fff
    .b { background: #000; }
  `;
  // Missing semicolon and brace — best-effort parser shouldn't throw.
  const out = extractFromCss(css, '/p/a.css');
  // Don't assert exact counts; just that no exception is thrown.
  assert.ok(Array.isArray(out.colors));
});

test('skips var() and transparent', () => {
  const css = `
    .a {
      color: var(--color-primary);
      background: transparent;
      border: 1px solid #ddd;
    }
  `;
  const out = extractFromCss(css, '/p/a.css');
  // 'border' is not in COLOR_PROPS, so #ddd is not picked up unless we add
  // 'border' to extraction (we did not — only border-*-color is in the set).
  assert.equal(out.colors.length, 0);
});

test('ignores @media wrapping (still parses inner rules)', () => {
  const css = `
    @media (min-width: 412px) {
      .a { color: #ff0000; }
    }
  `;
  const out = extractFromCss(css, '/p/a.css');
  // Inner rule body is still a declaration block; the @media line is just text.
  assert.equal(out.colors.length, 1);
  assert.equal(out.colors[0].value, '#ff0000');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @open-design/daemon test token-sync/extract-css`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `extract-css.ts`**

Create `apps/daemon/src/token-sync/extract-css.ts`:

```typescript
import { extractFromDeclarations } from './extract-declarations.js';
import { emptyExtractedTokens, type ExtractedTokens } from './types.js';

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Find every `{ ... }` block at any depth and call extractFromDeclarations
 * on its body. This is a lightweight tokenizer: we scan character-by-character,
 * track brace depth, and emit each innermost block's content. @media or @supports
 * blocks themselves produce no declarations at their level — we recurse into them
 * by yielding their nested blocks.
 */
function* iterateDeclarationBlocks(css: string): Generator<string> {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const block = css.slice(start, i);
        // If the block contains nested `{`, it's an at-rule wrapper; recurse.
        if (block.includes('{')) {
          yield* iterateDeclarationBlocks(block);
        } else {
          yield block;
        }
        start = -1;
      }
      if (depth < 0) depth = 0; // forgiving on malformed input
    }
  }
}

export function extractFromCss(cssText: string, sourcePath: string): ExtractedTokens {
  const stripped = stripComments(cssText);
  const out = emptyExtractedTokens();
  try {
    for (const block of iterateDeclarationBlocks(stripped)) {
      extractFromDeclarations(block, sourcePath, out);
    }
  } catch {
    // Best-effort: malformed CSS shouldn't crash the daemon.
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @open-design/daemon test token-sync/extract-css`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/token-sync/extract-css.ts apps/daemon/tests/token-sync/extract-css.test.ts
git commit -m "feat(token-sync): CSS extractor — hand-rolled brace scanner + per-declaration"
```

---

### Task 5: HTML inline-style extractor

**Files:**
- Create: `apps/daemon/src/token-sync/extract-html.ts`
- Test: `apps/daemon/tests/token-sync/extract-html.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/tests/token-sync/extract-html.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { extractFromHtml } from '../../src/token-sync/extract-html.js';

test('extracts from style="..." attribute', () => {
  const html = `<div style="color: #ff0000; padding: 16px">Hi</div>`;
  const out = extractFromHtml(html, '/p/index.html');
  assert.equal(out.colors[0].value, '#ff0000');
  assert.equal(out.spacing[0].value, 16);
});

test('extracts from style=\'...\' (single quotes)', () => {
  const html = `<div style='color: #00ff00'>Hi</div>`;
  const out = extractFromHtml(html, '/p/index.html');
  assert.equal(out.colors[0].value, '#00ff00');
});

test('extracts from STYLE="..." (uppercase, case-insensitive)', () => {
  const html = `<div STYLE="color: #0000ff">Hi</div>`;
  const out = extractFromHtml(html, '/p/index.html');
  assert.equal(out.colors[0].value, '#0000ff');
});

test('handles multiple elements with different styles', () => {
  const html = `
    <h1 style="font-size: 32px; color: #111">Title</h1>
    <p style="font-size: 16px; color: #444">Body</p>
  `;
  const out = extractFromHtml(html, '/p/index.html');
  assert.deepEqual(out.sizes.map((s) => s.value).sort((a, b) => a - b), [16, 32]);
  assert.deepEqual(out.colors.map((c) => c.value).sort(), ['#111111', '#444444']);
});

test('does NOT extract from class="..." (utility frameworks forbidden by prompt)', () => {
  const html = `<div class="bg-blue-500 text-xl">Hi</div>`;
  const out = extractFromHtml(html, '/p/index.html');
  assert.equal(out.colors.length, 0);
  assert.equal(out.sizes.length, 0);
});

test('returns empty extraction on HTML with no inline styles', () => {
  const html = `<div>Hi</div>`;
  const out = extractFromHtml(html, '/p/index.html');
  assert.equal(out.colors.length, 0);
  assert.equal(out.fonts.length, 0);
  assert.equal(out.sizes.length, 0);
  assert.equal(out.spacing.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @open-design/daemon test token-sync/extract-html`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `extract-html.ts`**

Create `apps/daemon/src/token-sync/extract-html.ts`:

```typescript
import { extractFromDeclarations } from './extract-declarations.js';
import { emptyExtractedTokens, type ExtractedTokens } from './types.js';

const STYLE_ATTR_RE = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

export function extractFromHtml(htmlText: string, sourcePath: string): ExtractedTokens {
  const out = emptyExtractedTokens();
  let match: RegExpExecArray | null;
  while ((match = STYLE_ATTR_RE.exec(htmlText)) !== null) {
    const declarations = match[1] ?? match[2] ?? '';
    if (declarations) extractFromDeclarations(declarations, sourcePath, out);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @open-design/daemon test token-sync/extract-html`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/token-sync/extract-html.ts apps/daemon/tests/token-sync/extract-html.test.ts
git commit -m "feat(token-sync): HTML inline-style extractor"
```

---

### Task 6: Merge into VariablesFile

**Files:**
- Create: `apps/daemon/src/token-sync/merge.ts`
- Test: `apps/daemon/tests/token-sync/merge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/tests/token-sync/merge.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mergeExtractedIntoDs } from '../../src/token-sync/merge.js';
import type { ExtractedTokens } from '../../src/token-sync/types.js';
import { buildSeededVariablesFile } from '../../src/design-system-seed.js';

function tokensWith(overrides: Partial<ExtractedTokens>): ExtractedTokens {
  return {
    colors: overrides.colors ?? [],
    fonts: overrides.fonts ?? [],
    sizes: overrides.sizes ?? [],
    spacing: overrides.spacing ?? [],
  };
}

test('merges a new color into Cores/Extracted group', () => {
  const file = buildSeededVariablesFile();
  const next = mergeExtractedIntoDs(file, tokensWith({
    colors: [{ value: '#0066ff', usageCount: 1, sourceFiles: ['/p/a.css'] }],
  }));
  const cores = next.collections.find((c) => c.name === 'Cores')!;
  const extracted = cores.groups.find((g) => g.name === 'Extracted')!;
  const v = extracted.variables.find((x) => x.name === 'color-0066ff');
  assert.ok(v, 'color-0066ff must exist in Cores/Extracted');
  for (const mode of cores.modes) {
    assert.equal(v!.valuesByMode[mode.id], '#0066ff');
  }
});

test('does not duplicate an existing color (by value, anywhere in the DS)', () => {
  let file = buildSeededVariablesFile();
  file = mergeExtractedIntoDs(file, tokensWith({
    colors: [{ value: '#abcdef', usageCount: 1, sourceFiles: ['/p/a.css'] }],
  }));
  const before = JSON.stringify(file);
  file = mergeExtractedIntoDs(file, tokensWith({
    colors: [{ value: '#abcdef', usageCount: 1, sourceFiles: ['/p/b.css'] }],
  }));
  assert.equal(JSON.stringify(file), before, 'second merge of same value must be a no-op');
});

test('preserves user-renamed variables (matches by value, not by name)', () => {
  let file = buildSeededVariablesFile();
  file = mergeExtractedIntoDs(file, tokensWith({
    colors: [{ value: '#abcdef', usageCount: 1, sourceFiles: ['/p/a.css'] }],
  }));
  // Simulate user rename
  const cores = file.collections.find((c) => c.name === 'Cores')!;
  const extracted = cores.groups.find((g) => g.name === 'Extracted')!;
  const v = extracted.variables[0];
  v.name = 'brand-accent';

  // Re-extract: the literal still appears in code.
  file = mergeExtractedIntoDs(file, tokensWith({
    colors: [{ value: '#abcdef', usageCount: 1, sourceFiles: ['/p/a.css'] }],
  }));
  const reread = file.collections.find((c) => c.name === 'Cores')!
    .groups.find((g) => g.name === 'Extracted')!.variables[0];
  assert.equal(reread.name, 'brand-accent', 'user rename must be preserved');
});

test('fonts land in Typography/Font Family and skip duplicates with seed', () => {
  const file = buildSeededVariablesFile();
  // Seed has "Font Family: Inter" in Typography/Font Family.
  const next = mergeExtractedIntoDs(file, tokensWith({
    fonts: [{ value: 'Inter', usageCount: 1, sourceFiles: ['/p/a.css'] }],
  }));
  const typo = next.collections.find((c) => c.name === 'Typography')!;
  const ff = typo.groups.find((g) => g.name === 'Font Family')!;
  // Existing seed has Inter; merge should not add a duplicate.
  const interVars = ff.variables.filter((v) =>
    Object.values(v.valuesByMode).some((val) => val === 'Inter')
  );
  assert.equal(interVars.length, 1);
});

test('sizes land in Typography/Detected sizes (new group)', () => {
  const file = buildSeededVariablesFile();
  const next = mergeExtractedIntoDs(file, tokensWith({
    sizes: [{ value: 14, usageCount: 1, sourceFiles: ['/p/a.css'] }],
  }));
  const typo = next.collections.find((c) => c.name === 'Typography')!;
  const detected = typo.groups.find((g) => g.name === 'Detected sizes');
  assert.ok(detected, 'Detected sizes group must be created');
  assert.equal(detected!.variables[0].name, 'size-14');
});

test('spacing lands in Spacing/Detected spacing', () => {
  const file = buildSeededVariablesFile();
  const next = mergeExtractedIntoDs(file, tokensWith({
    spacing: [{ value: 12, usageCount: 1, sourceFiles: ['/p/a.css'] }],
  }));
  const spacing = next.collections.find((c) => c.name === 'Spacing')!;
  const detected = spacing.groups.find((g) => g.name === 'Detected spacing');
  assert.ok(detected);
  assert.equal(detected!.variables[0].name, 'space-12');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @open-design/daemon test token-sync/merge`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `merge.ts`**

Create `apps/daemon/src/token-sync/merge.ts`:

```typescript
import {
  newCollectionId,
  newGroupId,
  newModeId,
  newVariableId,
  type Mode,
  type VariableCollection,
  type VariableGroup,
  type VariablesFile,
} from '../design-system-variables.js';
import type { ExtractedTokens } from './types.js';

function slugFont(family: string): string {
  return family.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function colorVarName(hex: string): string {
  return 'color-' + hex.replace(/^#/, '');
}

function findCollection(file: VariablesFile, name: string): VariableCollection | undefined {
  return file.collections.find((c) => c.name === name);
}

function ensureCollection(file: VariablesFile, name: string, modeNames: string[]): VariableCollection {
  let c = findCollection(file, name);
  if (c) return c;
  const modes: Mode[] = modeNames.map((n) => ({ id: newModeId(), name: n }));
  c = { id: newCollectionId(), name, modes, groups: [] };
  file.collections.push(c);
  return c;
}

function ensureGroup(collection: VariableCollection, groupName: string): VariableGroup {
  let g = collection.groups.find((x) => x.name === groupName);
  if (g) return g;
  g = { id: newGroupId(), name: groupName, variables: [] };
  collection.groups.push(g);
  return g;
}

function valueExistsAnywhere(file: VariablesFile, value: string | number | boolean): boolean {
  for (const c of file.collections) {
    for (const g of c.groups) {
      for (const v of g.variables) {
        if (Object.values(v.valuesByMode).some((mv) => mv === value)) return true;
      }
    }
  }
  return false;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function mergeExtractedIntoDs(file: VariablesFile, tokens: ExtractedTokens): VariablesFile {
  const next = clone(file);

  // Colors → Cores/Extracted
  if (tokens.colors.length > 0) {
    const c = ensureCollection(next, 'Cores', ['Default']);
    const g = ensureGroup(c, 'Extracted');
    for (const t of tokens.colors) {
      if (valueExistsAnywhere(next, t.value)) continue;
      const valuesByMode: Record<string, string> = {};
      for (const m of c.modes) valuesByMode[m.id] = t.value;
      g.variables.push({
        id: newVariableId(),
        name: colorVarName(t.value),
        type: 'color',
        valuesByMode,
      });
    }
  }

  // Fonts → Typography/Font Family
  if (tokens.fonts.length > 0) {
    const c = ensureCollection(next, 'Typography', ['Desktop', 'Tablet', 'Mobile']);
    const g = ensureGroup(c, 'Font Family');
    for (const t of tokens.fonts) {
      if (valueExistsAnywhere(next, t.value)) continue;
      const valuesByMode: Record<string, string> = {};
      for (const m of c.modes) valuesByMode[m.id] = t.value;
      g.variables.push({
        id: newVariableId(),
        name: 'font-' + slugFont(t.value),
        type: 'string',
        valuesByMode,
      });
    }
  }

  // Sizes → Typography/Detected sizes
  if (tokens.sizes.length > 0) {
    const c = ensureCollection(next, 'Typography', ['Desktop', 'Tablet', 'Mobile']);
    const g = ensureGroup(c, 'Detected sizes');
    for (const t of tokens.sizes) {
      if (valueExistsAnywhere(next, t.value)) continue;
      const valuesByMode: Record<string, number> = {};
      for (const m of c.modes) valuesByMode[m.id] = t.value;
      g.variables.push({
        id: newVariableId(),
        name: 'size-' + t.value,
        type: 'number',
        valuesByMode,
      });
    }
  }

  // Spacing → Spacing/Detected spacing
  if (tokens.spacing.length > 0) {
    const c = ensureCollection(next, 'Spacing', ['Default']);
    const g = ensureGroup(c, 'Detected spacing');
    for (const t of tokens.spacing) {
      if (valueExistsAnywhere(next, t.value)) continue;
      const valuesByMode: Record<string, number> = {};
      for (const m of c.modes) valuesByMode[m.id] = t.value;
      g.variables.push({
        id: newVariableId(),
        name: 'space-' + t.value,
        type: 'number',
        valuesByMode,
      });
    }
  }

  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @open-design/daemon test token-sync/merge`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/token-sync/merge.ts apps/daemon/tests/token-sync/merge.test.ts
git commit -m "feat(token-sync): merge extracted tokens into v2 VariablesFile, append-only"
```

---

## Phase 3 — File listing, orchestrator, and integration

### Task 7: Project source file listing

**Files:**
- Create: `apps/daemon/src/token-sync/listing.ts`
- Test: `apps/daemon/tests/token-sync/listing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/daemon/tests/token-sync/listing.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { listProjectSourceFiles } from '../../src/token-sync/listing.js';

async function makeTree(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'od-listing-'));
  await writeFile(path.join(root, 'a.css'), '.x { color: red; }', 'utf8');
  await writeFile(path.join(root, 'b.html'), '<div></div>', 'utf8');
  await writeFile(path.join(root, 'c.htm'), '<div></div>', 'utf8');
  await writeFile(path.join(root, 'README.md'), '# x', 'utf8');
  await mkdir(path.join(root, 'sub'), { recursive: true });
  await writeFile(path.join(root, 'sub', 'd.css'), '.y { color: blue; }', 'utf8');
  await mkdir(path.join(root, 'node_modules', 'foo'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', 'foo', 'e.css'), '.z {}', 'utf8');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'bundled.css'), '.w {}', 'utf8');
  await mkdir(path.join(root, '.git'), { recursive: true });
  await writeFile(path.join(root, '.git', 'config'), 'x', 'utf8');
  return root;
}

test('lists .css, .html, .htm files recursively', async () => {
  const root = await makeTree();
  const files = await listProjectSourceFiles(root);
  const rels = files.map((f) => path.relative(root, f.path)).sort();
  assert.deepEqual(rels, ['a.css', 'b.html', 'c.htm', 'sub/d.css']);
});

test('skips node_modules, dist, build, .next, out, hidden directories', async () => {
  const root = await makeTree();
  const files = await listProjectSourceFiles(root);
  for (const f of files) {
    assert.ok(!f.path.includes('node_modules'), `must skip node_modules: ${f.path}`);
    assert.ok(!f.path.includes('/dist/'), `must skip dist/: ${f.path}`);
    assert.ok(!f.path.includes('/.git/'), `must skip .git/: ${f.path}`);
  }
});

test('tags each file with its parser kind', async () => {
  const root = await makeTree();
  const files = await listProjectSourceFiles(root);
  for (const f of files) {
    if (f.path.endsWith('.css')) assert.equal(f.kind, 'css');
    else assert.equal(f.kind, 'html');
  }
});

test('caps at 200 files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-listing-cap-'));
  for (let i = 0; i < 250; i++) {
    await writeFile(path.join(root, `f${i}.css`), '.x{}', 'utf8');
  }
  const files = await listProjectSourceFiles(root);
  assert.equal(files.length, 200);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @open-design/daemon test token-sync/listing`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `listing.ts`**

Create `apps/daemon/src/token-sync/listing.ts`:

```typescript
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', 'out',
]);

const MAX_FILES = 200;

export interface SourceFile {
  path: string;
  kind: 'css' | 'html';
}

function kindFor(filename: string): 'css' | 'html' | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return null;
}

export async function listProjectSourceFiles(rootDir: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= MAX_FILES) return;
      const name = ent.name;
      if (name.startsWith('.')) continue; // hidden files and dirs (.git, .next handled here too)
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        await walk(path.join(dir, name));
      } else if (ent.isFile()) {
        const k = kindFor(name);
        if (k) out.push({ path: path.join(dir, name), kind: k });
      }
    }
  }
  await walk(rootDir);
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @open-design/daemon test token-sync/listing`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/token-sync/listing.ts apps/daemon/tests/token-sync/listing.test.ts
git commit -m "feat(token-sync): list project source files (.css/.html/.htm)"
```

---

### Task 8: Orchestrator (`scheduleTokenSync` + `syncProjectNow`)

**Files:**
- Create: `apps/daemon/src/token-sync/index.ts`
- Test: `apps/daemon/tests/token-sync/sync.test.ts`

- [ ] **Step 1: Explore the project-loading helpers**

Before writing the orchestrator you need to know how to: (a) load a project by id and read its `designSystemId`, (b) resolve the project's workspace directory, (c) resolve the DS directory, (d) load and save its VariablesFile under the DS lock.

Run: `grep -n "export function\|export async function\|resolveProjectDir\|projectDir\b" apps/daemon/src/projects.ts | head -20`
And: `grep -n "resolveDsDir\|loadOrMigrate" apps/daemon/src/static-resource-routes.ts | head -10`

The orchestrator should reuse those helpers. If `resolveDsDir` is not exported from `static-resource-routes.ts`, extract it into a small helper in `apps/daemon/src/design-systems.ts` (look for an existing `resolveDesignSystemDir` first; if present, use it). If neither path exists, hold and report `BLOCKED` — needing a clean helper boundary.

- [ ] **Step 2: Write the integration test**

Create `apps/daemon/tests/token-sync/sync.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { syncProjectNow, scheduleTokenSync } from '../../src/token-sync/index.js';
import { buildSeededVariablesFile } from '../../src/design-system-seed.js';
import { VARIABLES_FILE_NAME } from '../../src/design-system-variables.js';

// The integration test sets up a minimal project + DS layout and exercises
// the sync end-to-end. The orchestrator MUST accept a configuration shape
// that lets us point at temp directories (real production resolvers go
// through server-context). See Step 3 for that contract.

test('syncProjectNow extracts CSS values into the attached DS', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-sync-int-'));
  const projectDir = path.join(root, 'projects', 'p1');
  const dsDir = path.join(root, 'design-systems', 'd1');
  await mkdir(projectDir, { recursive: true });
  await mkdir(dsDir, { recursive: true });

  // Seed DS file on disk
  const seed = buildSeededVariablesFile();
  await writeFile(path.join(dsDir, VARIABLES_FILE_NAME), JSON.stringify(seed), 'utf8');

  // Write a project CSS file with a literal not in the seed
  await writeFile(path.join(projectDir, 'style.css'), `
    .a { color: #0066ff; padding: 16px; }
  `, 'utf8');

  await syncProjectNow('p1', {
    resolveProjectDir: () => projectDir,
    resolveDsDir: () => dsDir,
    getDesignSystemId: () => 'd1',
  });

  const out = JSON.parse(await readFile(path.join(dsDir, VARIABLES_FILE_NAME), 'utf8'));
  const cores = out.collections.find((c: any) => c.name === 'Cores')!;
  const extracted = cores.groups.find((g: any) => g.name === 'Extracted')!;
  const v = extracted.variables.find((x: any) => x.name === 'color-0066ff');
  assert.ok(v, 'extracted color must appear in Cores/Extracted');
});

test('syncProjectNow is a no-op when project has no DS attached', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-sync-noop-'));
  const projectDir = path.join(root, 'projects', 'p1');
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, 'style.css'), '.a { color: red }', 'utf8');

  // Should resolve and exit cleanly without throwing.
  await syncProjectNow('p1', {
    resolveProjectDir: () => projectDir,
    resolveDsDir: () => null,
    getDesignSystemId: () => null,
  });
});

test('scheduleTokenSync debounces multiple rapid calls', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-sync-debounce-'));
  const projectDir = path.join(root, 'projects', 'p1');
  const dsDir = path.join(root, 'design-systems', 'd1');
  await mkdir(projectDir, { recursive: true });
  await mkdir(dsDir, { recursive: true });
  await writeFile(path.join(dsDir, VARIABLES_FILE_NAME), JSON.stringify(buildSeededVariablesFile()), 'utf8');
  await writeFile(path.join(projectDir, 'style.css'), '.a { color: #abcdef }', 'utf8');

  let syncs = 0;
  const config = {
    resolveProjectDir: () => projectDir,
    resolveDsDir: () => dsDir,
    getDesignSystemId: () => 'd1',
    onSyncRun: () => { syncs++; },
  };

  scheduleTokenSync('p1', config);
  scheduleTokenSync('p1', config);
  scheduleTokenSync('p1', config);

  await new Promise((r) => setTimeout(r, 800));
  assert.equal(syncs, 1, 'debounce must coalesce rapid calls to one sync');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @open-design/daemon test token-sync/sync`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `index.ts`**

Create `apps/daemon/src/token-sync/index.ts`:

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  readVariables,
  saveVariables,
  VARIABLES_FILE_NAME,
  withDsLock,
  type VariablesFile,
} from '../design-system-variables.js';
import { extractFromCss } from './extract-css.js';
import { extractFromHtml } from './extract-html.js';
import { listProjectSourceFiles } from './listing.js';
import { mergeExtractedIntoDs } from './merge.js';
import { emptyExtractedTokens, type ExtractedTokens } from './types.js';

export interface TokenSyncConfig {
  /** Returns the project's working directory (absolute). */
  resolveProjectDir: (projectId: string) => string | Promise<string>;
  /** Returns the DS directory (absolute) or null if no DS attached. */
  resolveDsDir: (designSystemId: string) => string | Promise<string | null>;
  /** Returns the DS id for the project or null if none attached. */
  getDesignSystemId: (projectId: string) => string | null | Promise<string | null>;
  /** Optional: invoked after each completed sync. Used by tests. */
  onSyncRun?: (projectId: string) => void;
}

let defaultConfig: TokenSyncConfig | null = null;

/**
 * Production wiring registers a TokenSyncConfig at daemon startup. Until then,
 * each call must pass `config` explicitly.
 */
export function setDefaultTokenSyncConfig(cfg: TokenSyncConfig): void {
  defaultConfig = cfg;
}

const timers: Map<string, NodeJS.Timeout> = new Map();
const running: Set<string> = new Set();
const DEBOUNCE_MS = 500;

export function scheduleTokenSync(projectId: string, cfgOverride?: TokenSyncConfig): void {
  const cfg = cfgOverride ?? defaultConfig;
  if (!cfg) return;
  const existing = timers.get(projectId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    timers.delete(projectId);
    if (running.has(projectId)) {
      // Re-schedule so the next sync sees the latest state.
      scheduleTokenSync(projectId, cfg);
      return;
    }
    running.add(projectId);
    syncProjectNow(projectId, cfg)
      .catch(() => { /* swallow */ })
      .finally(() => { running.delete(projectId); });
  }, DEBOUNCE_MS);
  timers.set(projectId, timer);
}

export async function syncProjectNow(projectId: string, cfgOverride?: TokenSyncConfig): Promise<void> {
  const cfg = cfgOverride ?? defaultConfig;
  if (!cfg) return;
  const dsId = await cfg.getDesignSystemId(projectId);
  if (!dsId) return;
  const dsDir = await cfg.resolveDsDir(dsId);
  if (!dsDir) return;
  const projectDir = await cfg.resolveProjectDir(projectId);
  if (!projectDir) return;

  const files = await listProjectSourceFiles(projectDir);
  const accum: ExtractedTokens = emptyExtractedTokens();
  for (const f of files) {
    let text: string;
    try {
      text = await readFile(f.path, 'utf8');
    } catch {
      continue;
    }
    const extracted = f.kind === 'css'
      ? extractFromCss(text, f.path)
      : extractFromHtml(text, f.path);
    mergeAccumulator(accum, extracted);
  }

  await withDsLock(dsId, async () => {
    const current = await readVariables(dsDir);
    if (!current) return; // no DS variables file — bail
    const next = mergeExtractedIntoDs(current, accum);
    await saveVariables(dsDir, next);
  });
  cfg.onSyncRun?.(projectId);
}

function mergeAccumulator(target: ExtractedTokens, incoming: ExtractedTokens): void {
  function merge<V>(targetArr: { value: V; usageCount: number; sourceFiles: string[] }[],
                    incomingArr: typeof targetArr): void {
    for (const t of incomingArr) {
      const existing = targetArr.find((x) => x.value === t.value);
      if (existing) {
        existing.usageCount += t.usageCount;
        for (const sf of t.sourceFiles) {
          if (!existing.sourceFiles.includes(sf)) existing.sourceFiles.push(sf);
        }
      } else {
        targetArr.push({ ...t, sourceFiles: [...t.sourceFiles] });
      }
    }
  }
  merge(target.colors, incoming.colors);
  merge(target.fonts, incoming.fonts);
  merge(target.sizes, incoming.sizes);
  merge(target.spacing, incoming.spacing);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @open-design/daemon test token-sync/sync`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/token-sync/index.ts apps/daemon/tests/token-sync/sync.test.ts
git commit -m "feat(token-sync): orchestrator with debounce + per-project config injection"
```

---

### Task 9: Hook `scheduleTokenSync` into `artifact-create.ts`

**Files:**
- Modify: `apps/daemon/src/artifact-create.ts`

- [ ] **Step 1: Inspect the existing hook point**

Open `apps/daemon/src/artifact-create.ts`. Find the `createProjectArtifactFile` function (around line 69). It calls `options.writeProjectFile(...)` and `await`s the result.

Locate the line where `writeProjectFile` completes successfully and the function returns. The schedule call must happen there, after success.

- [ ] **Step 2: Add the import**

At the top of `apps/daemon/src/artifact-create.ts`, after the existing imports:

```typescript
import { scheduleTokenSync } from './token-sync/index.js';
```

- [ ] **Step 3: Schedule the sync after a successful write**

Inside `createProjectArtifactFile`, immediately after `await options.writeProjectFile(...)` resolves and before the function returns:

```typescript
const result = await options.writeProjectFile(
  /* ... existing args ... */
);
// Background extraction: pure-CSS values become DS variables.
// Fire-and-forget; errors are swallowed inside scheduleTokenSync.
scheduleTokenSync(options.projectId);
return result;
```

If the existing code uses `return await options.writeProjectFile(...)` directly without an intermediate variable, refactor to assign to a variable first so you can call `scheduleTokenSync` between resolve and return.

- [ ] **Step 4: Register the production `TokenSyncConfig` at daemon startup**

The orchestrator's `scheduleTokenSync` is a no-op without `setDefaultTokenSyncConfig`. Find the wiring point:

Run: `grep -n "registerStaticResourceRoutes\b\|resolveDsDir\b" apps/daemon/src/static-resource-routes.ts | head -20`

The `resolveDsDir` helper used throughout `static-resource-routes.ts` returns `{ dir, key } | null`. Either lift it to a module export so the orchestrator can call it, or inline an equivalent in the wiring step. Same for project metadata — `static-resource-routes.ts` already loads it. Two acceptable shapes:

**Option A (preferred): Wire inside `registerStaticResourceRoutes`** (it already has the closures over `resolveDsDir` and the projects context). Right before the function returns, add:

```typescript
import { setDefaultTokenSyncConfig } from './token-sync/index.js';

setDefaultTokenSyncConfig({
  resolveProjectDir: async (projectId) => {
    const meta = await ctx.projects.readProjectMeta(projectId); // adjust to actual helper name
    return ctx.projects.resolveProjectDir(projectId, meta);
  },
  resolveDsDir: async (designSystemId) => {
    const resolved = await resolveDsDir(designSystemId);
    return resolved?.dir ?? null;
  },
  getDesignSystemId: async (projectId) => {
    const meta = await ctx.projects.readProjectMeta(projectId);
    return meta?.designSystemId ?? null;
  },
});
```

If `ctx.projects.readProjectMeta` doesn't exist under that name, search for the helper:

```
grep -n "designSystemId\|export.*function\b" apps/daemon/src/projects.ts | head -30
```

The function that reads project metadata from disk is likely called `readProjectManifest`, `loadProjectMetadata`, or similar. Use whichever returns the project's `{ designSystemId, baseDir, ... }` shape.

**Option B (fallback): Wire in `apps/daemon/src/server.ts`** where the express app is created. Same shape; the resolvers come from the imported helpers rather than `ctx`.

If after ~10 minutes of inspection you cannot identify a clean way to get the project metadata + DS dir, report `BLOCKED` with what you've found. Don't guess — the wrong resolver shape will surface as a silent no-op (sync runs but extracts nothing).

- [ ] **Step 5: Smoke build**

Run: `pnpm --filter @open-design/daemon build`
Expected: 0 new errors. Pre-existing `design-system-figma.ts` errors may still appear from prior phases — ignore them.

- [ ] **Step 6: Run all token-sync tests**

Run: `pnpm --filter @open-design/daemon test token-sync`
Expected: PASS — all tests across `extract-declarations`, `extract-css`, `extract-html`, `merge`, `listing`, and `sync`.

- [ ] **Step 7: Commit**

```bash
git add apps/daemon/src/artifact-create.ts apps/daemon/src/server.ts apps/daemon/src/server-context.ts
git commit -m "feat(token-sync): hook scheduleTokenSync into createProjectArtifactFile"
```

(Adjust the `git add` list to match the files you actually touched in Step 4.)

---

## Phase 4 — Final verification

### Task 10: Repo-wide checks

- [ ] **Step 1: Daemon tests**

Run: `pnpm --filter @open-design/daemon test`
Expected: all token-sync tests PASS; pre-existing failures (`project-design-system-routes`, `skills`, `chat-attachments`, `FileWorkspace.design-system`) remain unchanged — do not attempt to fix them in this PR.

- [ ] **Step 2: Daemon build (typecheck)**

Run: `pnpm --filter @open-design/daemon build`
Expected: 0 errors in token-sync files and prompt files. Remaining errors only in `design-system-figma.ts` (pre-existing, out of scope).

- [ ] **Step 3: Repo guard**

Run: `pnpm guard`
Expected: PASS.

- [ ] **Step 4: Repo typecheck**

Run: `pnpm typecheck`
Expected: only the 22 pre-existing lean-inception errors. No new errors from this PR.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Bring up the stack: `pnpm tools-dev restart`.

Open the desktop, create a new project, prompt the AI to generate a simple HTML page with some styled buttons (you'll see the AI now produces pure CSS with the scales). Open the DS modal. New variables in `Cores/Extracted` and `Spacing/Detected spacing` should appear within ~1 second of the AI's last file write.

If the modal still shows only seed defaults: check the daemon log (`pnpm tools-dev logs daemon --json`) for token-sync errors, and verify `setDefaultTokenSyncConfig` was called at startup.

- [ ] **Step 6: PR**

When you (the human) decide to ship, prepare the PR body using `.github/pull_request_template.md`. Why/What-users-see/Surface-area must reference the spec + the prompt change + the daemon background work. Attach a screenshot of the modal before (only seed) and after (seed + extracted).

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| `CSS_ARCHITECTURE_CHARTER` constant with all scales and examples | Task 1 |
| Charter appended to `composeSystemPrompt` | Task 2 |
| `ExtractedToken` / `ExtractedTokens` types | Task 3 (inside `types.ts`) |
| Shared per-declaration parser w/ skip set & color/font/size/spacing buckets | Task 3 |
| CSS extractor (comment strip + brace scanner) | Task 4 |
| HTML inline-style extractor | Task 5 |
| Merge into v2 VariablesFile, append-only, dedup by value across DS | Task 6 |
| File listing w/ skip dirs + 200 cap | Task 7 |
| Orchestrator w/ debounce + production-config injection | Task 8 |
| Hook in `artifact-create.ts` | Task 9 |
| Production wiring registers default config | Task 9, Step 4 |
| Integration test end-to-end | Task 8 (`sync.test.ts`) |
| `prompts/system.test.ts` ensuring charter present | Task 2 |
| No web changes | (none) |

### Placeholder check

No "TBD" / "TODO" / "implement later" in task steps. Each step includes the actual code or command.

### Type consistency

`ExtractedToken<V>`, `ExtractedTokens`, `SourceFile`, `TokenSyncConfig`, and the existing `VariablesFile`/`Mode` types used identically across tasks. `scheduleTokenSync(projectId, cfgOverride?)` and `syncProjectNow(projectId, cfgOverride?)` signatures match between the orchestrator implementation (Task 8) and the call site in `artifact-create.ts` (Task 9).

### Known soft spots in the plan

- Task 9 Step 4 (production wiring) depends on identifying the right symbol names in `server.ts` / `server-context.ts`. The plan provides a template; the implementer must adapt. If the helper boundary is unclear, BLOCKED is acceptable — better than guessing the wrong import.
- The CSS extractor's brace scanner is intentionally simple. Complex CSS (nested selectors via SCSS preprocessors, unmatched braces in strings) may produce partial results. This is acceptable for v1 — the merge is append-only and the prompt charter discourages such CSS shapes.
