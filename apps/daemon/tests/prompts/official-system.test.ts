import assert from 'node:assert/strict';
import { test } from 'vitest';
import { OFFICIAL_DESIGNER_PROMPT } from '../../src/prompts/official-system.js';

test('official prompt no longer forbids image embedding', () => {
  assert.ok(
    !OFFICIAL_DESIGNER_PROMPT.includes("Don't try to embed user images"),
    'old restriction should be removed',
  );
});

test('official prompt teaches od images search / download', () => {
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('od images search'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('od images download'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('od media generate'));
});

test('official prompt covers alt text + loading lazy + width/height guidance', () => {
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('alt'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('loading="lazy"'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('width'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.includes('height'));
});

test('official prompt instructs to default to stock search for thematic / Hero for branded', () => {
  assert.ok(OFFICIAL_DESIGNER_PROMPT.toLowerCase().includes('hero'));
  assert.ok(OFFICIAL_DESIGNER_PROMPT.toLowerCase().includes('stock'));
});
