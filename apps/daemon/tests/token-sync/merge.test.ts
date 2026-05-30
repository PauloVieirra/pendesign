import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mergeExtractedIntoDs } from '../../src/token-sync/merge.js';
import type { ExtractedToken, ExtractedTokens } from '../../src/token-sync/types.js';
import type { VariableScope } from '../../src/design-system-variables.js';
import { buildSeededVariablesFile } from '../../src/design-system-seed.js';

function tok<V>(value: V, scope: VariableScope): ExtractedToken<V> {
  return { value, scope, usageCount: 1, sourceFiles: ['/p/a.css'] };
}

function tokensWith(overrides: Partial<ExtractedTokens>): ExtractedTokens {
  return {
    colors: overrides.colors ?? [],
    fonts: overrides.fonts ?? [],
    sizes: overrides.sizes ?? [],
    spacing: overrides.spacing ?? [],
    borderRadii: overrides.borderRadii ?? [],
    borderWidths: overrides.borderWidths ?? [],
  };
}

test('merges a new color into Cores/Extracted group', () => {
  const file = buildSeededVariablesFile();
  const next = mergeExtractedIntoDs(file, tokensWith({
    colors: [tok('#0066ff', 'color')],
  }));
  const cores = next.collections.find((c) => c.name === 'Cores')!;
  const extracted = cores.groups.find((g) => g.name === 'Extracted')!;
  const v = extracted.variables.find((x) => x.name === 'color-0066ff');
  assert.ok(v, 'color-0066ff must exist in Cores/Extracted');
  assert.equal(v!.scope, 'color');
  for (const mode of cores.modes) {
    assert.equal(v!.valuesByMode[mode.id], '#0066ff');
  }
});

test('does not duplicate an existing color (by value, anywhere in the DS)', () => {
  let file = buildSeededVariablesFile();
  file = mergeExtractedIntoDs(file, tokensWith({
    colors: [tok('#abcdef', 'color')],
  }));
  const before = JSON.stringify(file);
  file = mergeExtractedIntoDs(file, tokensWith({
    colors: [tok('#abcdef', 'color')],
  }));
  assert.equal(JSON.stringify(file), before, 'second merge of same value must be a no-op');
});

test('preserves user-renamed variables (matches by value, not by name)', () => {
  let file = buildSeededVariablesFile();
  file = mergeExtractedIntoDs(file, tokensWith({
    colors: [tok('#abcdef', 'color')],
  }));
  // Simulate user rename
  const cores = file.collections.find((c) => c.name === 'Cores')!;
  const extracted = cores.groups.find((g) => g.name === 'Extracted')!;
  const v = extracted.variables[0];
  v.name = 'brand-accent';

  // Re-extract: the literal still appears in code.
  file = mergeExtractedIntoDs(file, tokensWith({
    colors: [tok('#abcdef', 'color')],
  }));
  const reread = file.collections.find((c) => c.name === 'Cores')!
    .groups.find((g) => g.name === 'Extracted')!.variables[0];
  assert.equal(reread.name, 'brand-accent', 'user rename must be preserved');
});

test('fonts land in Typography/Font Family and skip duplicates with seed', () => {
  const file = buildSeededVariablesFile();
  // Seed has "Font Family: Inter" in Typography/Font Family.
  const next = mergeExtractedIntoDs(file, tokensWith({
    fonts: [tok('Inter', 'font-family')],
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
    sizes: [tok(14, 'font-size')],
  }));
  const typo = next.collections.find((c) => c.name === 'Typography')!;
  const detected = typo.groups.find((g) => g.name === 'Detected sizes');
  assert.ok(detected, 'Detected sizes group must be created');
  assert.equal(detected!.variables[0].name, 'size-14');
  assert.equal(detected!.variables[0].scope, 'font-size');
});

test('spacing lands in Spacing/Detected spacing', () => {
  const file = buildSeededVariablesFile();
  const next = mergeExtractedIntoDs(file, tokensWith({
    spacing: [tok(12, 'padding')],
  }));
  const spacing = next.collections.find((c) => c.name === 'Spacing')!;
  const detected = spacing.groups.find((g) => g.name === 'Detected spacing');
  assert.ok(detected);
  assert.equal(detected!.variables[0].name, 'space-12');
  assert.equal(detected!.variables[0].scope, 'padding');
});

test('border-radius lands in Border Radius/Detected with scope border-radius', () => {
  const file = buildSeededVariablesFile();
  const next = mergeExtractedIntoDs(file, tokensWith({
    borderRadii: [tok(8, 'border-radius')],
  }));
  const coll = next.collections.find((c) => c.name === 'Border Radius');
  assert.ok(coll, 'Border Radius collection must be created');
  const detected = coll!.groups.find((g) => g.name === 'Detected');
  assert.ok(detected, 'Detected group must be created');
  assert.equal(detected!.variables[0].name, 'radius-8');
  assert.equal(detected!.variables[0].scope, 'border-radius');
  for (const m of coll!.modes) {
    assert.equal(detected!.variables[0].valuesByMode[m.id], 8);
  }
});

test('border-width lands in Border Width/Detected with scope border-width', () => {
  const file = buildSeededVariablesFile();
  const next = mergeExtractedIntoDs(file, tokensWith({
    borderWidths: [tok(2, 'border-width')],
  }));
  const coll = next.collections.find((c) => c.name === 'Border Width');
  assert.ok(coll, 'Border Width collection must be created');
  const detected = coll!.groups.find((g) => g.name === 'Detected');
  assert.ok(detected);
  assert.equal(detected!.variables[0].name, 'border-2');
  assert.equal(detected!.variables[0].scope, 'border-width');
});

test('border-radius does not duplicate existing values in its collection', () => {
  let file = buildSeededVariablesFile();
  file = mergeExtractedIntoDs(file, tokensWith({ borderRadii: [tok(8, 'border-radius')] }));
  const before = JSON.stringify(file);
  file = mergeExtractedIntoDs(file, tokensWith({ borderRadii: [tok(8, 'border-radius')] }));
  assert.equal(JSON.stringify(file), before, 'second merge must be a no-op');
});
