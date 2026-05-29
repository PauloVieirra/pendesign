import assert from 'node:assert/strict';
import { test } from 'vitest';
import { CSS_ARCHITECTURE_CHARTER } from '../../src/prompts/css-architecture-charter.js';
import { composeSystemPrompt } from '../../src/prompts/system.js';

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
