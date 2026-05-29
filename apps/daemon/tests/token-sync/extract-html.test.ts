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
