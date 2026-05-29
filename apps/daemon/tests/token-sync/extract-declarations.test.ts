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
