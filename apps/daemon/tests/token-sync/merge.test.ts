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
