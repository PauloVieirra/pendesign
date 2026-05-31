import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildSeededVariablesFile } from '../src/design-system-seed.js';

test('buildSeededVariablesFile returns a valid v3 VariablesFile', () => {
  const file = buildSeededVariablesFile();
  assert.equal(file.version, 3);
  const names = file.collections.map((c) => c.name).sort();
  assert.deepEqual(names, ['Container Size', 'Cores', 'Grid', 'Spacing', 'Typography']);
});

test('Typography collection seeds Desktop/Tablet/Mobile modes with Display 1 = 68/60/52', () => {
  const file = buildSeededVariablesFile();
  const typo = file.collections.find((c) => c.name === 'Typography')!;
  const modes = typo.modes.map((m) => m.name);
  assert.deepEqual(modes, ['Desktop', 'Tablet', 'Mobile']);
  const sizeGroup = typo.groups.find((g) => g.name === 'Size')!;
  const display1 = sizeGroup.variables.find((v) => v.name === 'Display 1')!;
  const [d, t, m] = typo.modes.map((m) => m.id);
  assert.equal(display1.valuesByMode[d], 68);
  assert.equal(display1.valuesByMode[t], 60);
  assert.equal(display1.valuesByMode[m], 52);
});

test('Cores collection seeds a single Default mode with no variables', () => {
  const file = buildSeededVariablesFile();
  const cores = file.collections.find((c) => c.name === 'Cores')!;
  assert.equal(cores.modes.length, 1);
  assert.equal(cores.modes[0].name, 'Default');
  assert.equal(cores.groups.length, 0);
});

test('Spacing collection seeds Desktop/Tablet/Mobile modes with Padding + Margin groups', () => {
  const file = buildSeededVariablesFile();
  const spacing = file.collections.find((c) => c.name === 'Spacing')!;
  const modes = spacing.modes.map((m) => m.name);
  assert.deepEqual(modes, ['Desktop', 'Tablet', 'Mobile']);
  const groupNames = spacing.groups.map((g) => g.name).sort();
  assert.deepEqual(groupNames, ['Margin', 'Padding']);
  const padding = spacing.groups.find((g) => g.name === 'Padding')!;
  assert.equal(padding.variables.length, 8);
  for (const v of padding.variables) assert.equal(v.scope, 'padding');
  const margin = spacing.groups.find((g) => g.name === 'Margin')!;
  for (const v of margin.variables) assert.equal(v.scope, 'margin');
});

test('Spacing Padding md has values 16/14/12 across modes', () => {
  const file = buildSeededVariablesFile();
  const spacing = file.collections.find((c) => c.name === 'Spacing')!;
  const padding = spacing.groups.find((g) => g.name === 'Padding')!;
  const md = padding.variables.find((v) => v.name === 'md')!;
  const [d, t, m] = spacing.modes.map((mode) => mode.id);
  assert.equal(md.valuesByMode[d], 16);
  assert.equal(md.valuesByMode[t], 14);
  assert.equal(md.valuesByMode[m], 12);
});

test('buildSeededVariablesFile is deterministic in shape (ids vary, names stable)', () => {
  const a = buildSeededVariablesFile();
  const b = buildSeededVariablesFile();
  assert.equal(a.collections.length, b.collections.length);
  for (let i = 0; i < a.collections.length; i++) {
    assert.equal(a.collections[i].name, b.collections[i].name);
    assert.equal(a.collections[i].modes.length, b.collections[i].modes.length);
  }
});

test('seeded Typography/Size Display 1 has scope font-size', () => {
  const file = buildSeededVariablesFile();
  const typo = file.collections.find((c) => c.name === 'Typography')!;
  const sizeGroup = typo.groups.find((g) => g.name === 'Size')!;
  const display1 = sizeGroup.variables.find((v) => v.name === 'Display 1')!;
  assert.equal(display1.scope, 'font-size');
});

test('seeded Container Size/Resolução/Resolução has scope width', () => {
  const file = buildSeededVariablesFile();
  const coll = file.collections.find((c) => c.name === 'Container Size')!;
  const group = coll.groups.find((g) => g.name === 'Resolução')!;
  const v = group.variables.find((x) => x.name === 'Resolução')!;
  assert.equal(v.scope, 'width');
});

test('seeded Grid/Layout/Columns has scope null (unscoped)', () => {
  const file = buildSeededVariablesFile();
  const grid = file.collections.find((c) => c.name === 'Grid')!;
  const layout = grid.groups.find((g) => g.name === 'Layout')!;
  const columns = layout.variables.find((v) => v.name === 'Columns')!;
  assert.equal(columns.scope, null);
});

test('seeded Grid/Layout/Margin has scope margin', () => {
  const file = buildSeededVariablesFile();
  const grid = file.collections.find((c) => c.name === 'Grid')!;
  const layout = grid.groups.find((g) => g.name === 'Layout')!;
  const margin = layout.variables.find((v) => v.name === 'Margin')!;
  assert.equal(margin.scope, 'margin');
});

test('seeded Grid/Layout/Gutter has scope gap', () => {
  const file = buildSeededVariablesFile();
  const grid = file.collections.find((c) => c.name === 'Grid')!;
  const layout = grid.groups.find((g) => g.name === 'Layout')!;
  const gutter = layout.variables.find((v) => v.name === 'Gutter')!;
  assert.equal(gutter.scope, 'gap');
});

test('seeded Typography/Font Family has scope font-family', () => {
  const file = buildSeededVariablesFile();
  const typo = file.collections.find((c) => c.name === 'Typography')!;
  const ffGroup = typo.groups.find((g) => g.name === 'Font Family')!;
  const ff = ffGroup.variables.find((v) => v.name === 'Font Family')!;
  assert.equal(ff.scope, 'font-family');
});

test('seeded Typography/Weight variables have scope font-weight', () => {
  const file = buildSeededVariablesFile();
  const typo = file.collections.find((c) => c.name === 'Typography')!;
  const weightGroup = typo.groups.find((g) => g.name === 'Weight')!;
  for (const v of weightGroup.variables) {
    assert.equal(v.scope, 'font-weight', `${v.name} should have scope font-weight`);
  }
});
