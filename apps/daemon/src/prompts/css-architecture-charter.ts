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
