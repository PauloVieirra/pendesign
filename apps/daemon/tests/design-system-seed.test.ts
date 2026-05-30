import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildSeededVariablesFile } from '../src/design-system-seed.js';

test('buildSeededVariablesFile returns a valid v2 VariablesFile', () => {
  const file = buildSeededVariablesFile();
  assert.equal(file.version, 2);
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

test('buildSeededVariablesFile is deterministic in shape (ids vary, names stable)', () => {
  const a = buildSeededVariablesFile();
  const b = buildSeededVariablesFile();
  assert.equal(a.collections.length, b.collections.length);
  for (let i = 0; i < a.collections.length; i++) {
    assert.equal(a.collections[i].name, b.collections[i].name);
    assert.equal(a.collections[i].modes.length, b.collections[i].modes.length);
  }
});
