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
