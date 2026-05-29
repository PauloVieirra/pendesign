import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
  readVariables,
  writeVariables,
  type VariablesFile,
  migrateV1ToV2,
  VARIABLES_FILE_NAME,
} from '../src/design-system-variables.js';
import { newVariableId, newCollectionId, newGroupId } from '../src/design-system-variables.js';

test('readVariables returns parsed JSON, writeVariables roundtrips it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-ds-vars-'));
  const modeId = 'm_default';
  const file: VariablesFile = {
    version: 2,
    collections: [
      {
        id: 'c_1',
        name: 'Cores',
        modes: [{ id: modeId, name: 'Default' }],
        groups: [
          {
            id: 'g_1',
            name: 'Orange',
            variables: [
              { id: 'v_1', name: '100', type: 'color', valuesByMode: { [modeId]: '#FDEEE9' } },
              { id: 'v_2', name: '200', type: 'color', valuesByMode: { [modeId]: '#FAD8CD' } },
            ],
          },
        ],
      },
    ],
  };
  await writeVariables(dir, file);
  const read = await readVariables(dir);
  assert.deepEqual(read, file);
});

test('newVariableId / newCollectionId / newGroupId return unique values across rapid calls', () => {
  for (const [factory, prefix] of [
    [newVariableId, 'v_'],
    [newCollectionId, 'c_'],
    [newGroupId, 'g_'],
  ] as const) {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = factory();
      assert.match(id, new RegExp(`^${prefix}[A-Za-z0-9_-]{6,}$`));
      assert.ok(!seen.has(id), `duplicate id ${id}`);
      seen.add(id);
    }
  }
});

import { renderTokensCss } from '../src/design-system-variables.js';

test('renderTokensCss emits CSS variables with collection/group/name slugs', () => {
  const css = renderTokensCss({
    version: 2,
    collections: [
      {
        id: 'c_1', name: 'Cores',
        modes: [{ id: 'm_1', name: 'Default' }],
        groups: [
          { id: 'g_1', name: 'Orange',
            variables: [
              { id: 'v_1', name: '100', type: 'color', valuesByMode: { m_1: '#FDEEE9' } },
              { id: 'v_2', name: '200', type: 'color', valuesByMode: { m_1: '#FAD8CD' } },
            ],
          },
        ],
      },
    ],
  });
  assert.match(css, /--cores-orange-100:\s*#FDEEE9;/);
  assert.match(css, /--cores-orange-200:\s*#FAD8CD;/);
});

test('renderTokensCss disambiguates colliding slugs with numeric suffix', () => {
  const css = renderTokensCss({
    version: 2,
    collections: [
      {
        id: 'c_1', name: 'A',
        modes: [{ id: 'm_1', name: 'Default' }],
        groups: [{ id: 'g_1', name: 'X',
          variables: [
            { id: 'v_1', name: '100', type: 'color', valuesByMode: { m_1: '#ffffff' } },
            { id: 'v_2', name: '100', type: 'color', valuesByMode: { m_1: '#000000' } },
          ],
        }],
      },
    ],
  });
  assert.match(css, /--a-x-100:\s*#ffffff;/);
  assert.match(css, /--a-x-100-2:\s*#000000;/);
});

test('renderTokensCss serializes number/string/boolean variables', () => {
  const css = renderTokensCss({
    version: 2,
    collections: [{ id: 'c_1', name: 'M', modes: [{ id: 'm_1', name: 'Default' }], groups: [{ id: 'g_1', name: 'G', variables: [
      { id: 'v_1', name: 'gap', type: 'number', valuesByMode: { m_1: 16 } },
      { id: 'v_2', name: 'fam', type: 'string', valuesByMode: { m_1: 'Inter, sans-serif' } },
      { id: 'v_3', name: 'on', type: 'boolean', valuesByMode: { m_1: true } },
    ] }] }],
  });
  assert.match(css, /--m-g-gap:\s*16px;/);
  assert.match(css, /--m-g-fam:\s*Inter, sans-serif;/);
  assert.match(css, /--m-g-on:\s*1;/);
});

import { migrateFromTokensCss } from '../src/design-system-variables.js';

test('migrateFromTokensCss groups color tokens into Colors collection', () => {
  const css = `:root { --color-rausch: #ff385c; --color-ink: #222222; }`;
  const file = migrateFromTokensCss(css);
  assert.equal(file.version, 2);
  const colors = file.collections.find((c) => c.name === 'Colors');
  assert.ok(colors, 'Colors collection missing');
  assert.equal(colors!.modes.length, 1);
  const flat = colors!.groups.flatMap((g) => g.variables);
  assert.equal(flat.length, 2);
  const modeId = colors!.modes[0].id;
  assert.deepEqual(flat.map((v) => v.valuesByMode[modeId]), ['#ff385c', '#222222']);
  for (const v of flat) assert.equal(v.type, 'color');
});

test('migrateFromTokensCss puts space and radius into separate collections', () => {
  const css = `:root { --space-sm: 8px; --space-md: 16px; --radius-lg: 12px; }`;
  const file = migrateFromTokensCss(css);
  const space = file.collections.find((c) => c.name === 'Spacing');
  const radius = file.collections.find((c) => c.name === 'Radii');
  assert.ok(space && radius);
  assert.equal(space!.groups.flatMap((g) => g.variables).length, 2);
  assert.equal(radius!.groups.flatMap((g) => g.variables).length, 1);
});

test('migrateFromTokensCss returns single default collection when input is empty', () => {
  const file = migrateFromTokensCss('');
  assert.equal(file.version, 2);
  assert.equal(file.collections.length, 1);
  assert.equal(file.collections[0].name, 'Default');
});

import { saveVariables } from '../src/design-system-variables.js';
import { readFile } from 'node:fs/promises';

test('saveVariables writes variables.json AND regenerated tokens.css', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-ds-save-'));
  const modeId = 'm_1';
  const file: VariablesFile = {
    version: 2,
    collections: [{ id: 'c_1', name: 'Cores', modes: [{ id: modeId, name: 'Default' }], groups: [{ id: 'g_1', name: 'Orange',
      variables: [{ id: 'v_1', name: '100', type: 'color', valuesByMode: { [modeId]: '#FDEEE9' } }],
    }] }],
  };
  await saveVariables(dir, file);
  const json = JSON.parse(await readFile(path.join(dir, 'variables.json'), 'utf8'));
  const css = await readFile(path.join(dir, 'tokens.css'), 'utf8');
  assert.equal(json.collections[0].groups[0].variables[0].valuesByMode[modeId], '#FDEEE9');
  assert.match(css, /--cores-orange-100:\s*#FDEEE9;/);
});

import { withDsLock } from '../src/design-system-variables.js';

test('withDsLock serializes concurrent writes to the same key', async () => {
  const events: string[] = [];
  const a = withDsLock('ds-x', async () => {
    events.push('a-start');
    await new Promise((r) => setTimeout(r, 30));
    events.push('a-end');
    return 'a';
  });
  const b = withDsLock('ds-x', async () => {
    events.push('b-start');
    events.push('b-end');
    return 'b';
  });
  const [va, vb] = await Promise.all([a, b]);
  assert.equal(va, 'a');
  assert.equal(vb, 'b');
  assert.deepEqual(events, ['a-start', 'a-end', 'b-start', 'b-end']);
});

test('withDsLock does NOT block different keys', async () => {
  const events: string[] = [];
  const a = withDsLock('ds-1', async () => {
    events.push('a-start');
    await new Promise((r) => setTimeout(r, 30));
    events.push('a-end');
  });
  const b = withDsLock('ds-2', async () => {
    events.push('b-start');
    events.push('b-end');
  });
  await Promise.all([a, b]);
  assert.deepEqual(events, ['a-start', 'b-start', 'b-end', 'a-end']);
});

import {
  applyCreateCollection,
  applyDeleteCollection,
  applyCreateGroup,
  applyDeleteGroup,
  applyCreateVariable,
  applyUpdateVariable,
  applyDeleteVariable,
} from '../src/design-system-variables.js';

function emptyV2(): VariablesFile { return { version: 2, collections: [] }; }

test('applyCreateCollection seeds a single Default mode', () => {
  const file = applyCreateCollection(emptyV2(), { name: 'Cores' });
  assert.equal(file.collections[0].modes.length, 1);
  assert.equal(file.collections[0].modes[0].name, 'Default');
});

test('applyCreateVariable seeds valuesByMode for every mode in the collection', () => {
  let file = applyCreateCollection(emptyV2(), { name: 'Grid' });
  const c = file.collections[0];
  // Hand-add a second mode for the test
  c.modes.push({ id: 'm_tab', name: 'Tablet', width: 834 });
  file = applyCreateGroup(file, { collectionId: c.id, name: 'Layout' });
  const g = file.collections[0].groups[0];
  file = applyCreateVariable(file, {
    collectionId: c.id, groupId: g.id, name: 'Columns', type: 'number',
    valueByDefault: 12,
  });
  const v = file.collections[0].groups[0].variables[0];
  assert.equal(Object.keys(v.valuesByMode).length, 2);
  for (const id of Object.keys(v.valuesByMode)) assert.equal(v.valuesByMode[id], 12);
});

test('applyUpdateVariable patches valuesByMode (partial merge)', () => {
  let file = applyCreateCollection(emptyV2(), { name: 'X' });
  const c = file.collections[0];
  c.modes.push({ id: 'm_b', name: 'B' });
  file = applyCreateGroup(file, { collectionId: c.id, name: 'g' });
  file = applyCreateVariable(file, {
    collectionId: c.id, groupId: file.collections[0].groups[0].id,
    name: 'v', type: 'number', valueByDefault: 0,
  });
  const v0 = file.collections[0].groups[0].variables[0];
  const aId = c.modes[0].id;
  file = applyUpdateVariable(file, { variableId: v0.id, patch: { valuesByMode: { [aId]: 42 } } });
  const v1 = file.collections[0].groups[0].variables[0];
  assert.equal(v1.valuesByMode[aId], 42);
  assert.equal(v1.valuesByMode['m_b'], 0); // not patched
});

const MAKE_FILE_MODE_ID = 'm_default';
function makeFile(): VariablesFile {
  return {
    version: 2,
    collections: [
      { id: 'c_1', name: 'Cores', modes: [{ id: MAKE_FILE_MODE_ID, name: 'Default' }], groups: [
        { id: 'g_1', name: 'Orange', variables: [
          { id: 'v_1', name: '100', type: 'color', valuesByMode: { [MAKE_FILE_MODE_ID]: '#aaaaaa' } },
        ] },
      ] },
    ],
  };
}

test('applyCreateCollection appends a collection with a Default mode and no groups', () => {
  const next = applyCreateCollection(makeFile(), { name: 'Spacing' });
  assert.equal(next.collections.length, 2);
  assert.equal(next.collections[1]!.name, 'Spacing');
  assert.equal(next.collections[1]!.modes.length, 1);
  assert.equal(next.collections[1]!.modes[0]!.name, 'Default');
  assert.equal(next.collections[1]!.groups.length, 0);
});

test('applyDeleteCollection removes by id', () => {
  const next = applyDeleteCollection(makeFile(), { collectionId: 'c_1' });
  assert.equal(next.collections.length, 0);
});

test('applyCreateGroup adds a group to the target collection', () => {
  const next = applyCreateGroup(makeFile(), { collectionId: 'c_1', name: 'Blue' });
  assert.equal(next.collections[0]!.groups.length, 2);
  assert.equal(next.collections[0]!.groups[1]!.name, 'Blue');
});

test('applyDeleteGroup removes a group by id', () => {
  const next = applyDeleteGroup(makeFile(), { collectionId: 'c_1', groupId: 'g_1' });
  assert.equal(next.collections[0]!.groups.length, 0);
});

test('applyCreateVariable appends to the target group', () => {
  const next = applyCreateVariable(makeFile(), {
    collectionId: 'c_1', groupId: 'g_1',
    name: '200', type: 'color', valueByDefault: '#bbbbbb',
  });
  assert.equal(next.collections[0]!.groups[0]!.variables.length, 2);
});

test('applyUpdateVariable changes value via legacy value patch (routes to first mode)', () => {
  const next = applyUpdateVariable(makeFile(), { variableId: 'v_1', patch: { value: '#cccccc' } });
  assert.equal(next.collections[0]!.groups[0]!.variables[0]!.valuesByMode[MAKE_FILE_MODE_ID], '#cccccc');
});

test('applyDeleteVariable removes by id', () => {
  const next = applyDeleteVariable(makeFile(), { variableId: 'v_1' });
  assert.equal(next.collections[0]!.groups[0]!.variables.length, 0);
});

test('migrateV1ToV2 converts v1 file to v2 with single Default mode', () => {
  const v1: any = {
    version: 1,
    collections: [{
      id: 'c_1',
      name: 'Cores',
      groups: [{
        id: 'g_1',
        name: 'Orange',
        variables: [{ id: 'v_1', name: '100', type: 'color', value: '#FDEEE9' }],
      }],
    }],
  };
  const v2 = migrateV1ToV2(v1);
  assert.equal(v2.version, 2);
  assert.equal(v2.collections[0].modes.length, 1);
  assert.equal(v2.collections[0].modes[0].name, 'Default');
  const modeId = v2.collections[0].modes[0].id;
  const variable = v2.collections[0].groups[0].variables[0];
  assert.deepEqual(variable.valuesByMode, { [modeId]: '#FDEEE9' });
  assert.equal((variable as any).value, undefined);
});

test('migrateV1ToV2 is idempotent on v2 file', () => {
  const v2: any = {
    version: 2,
    collections: [{
      id: 'c_1', name: 'X', modes: [{ id: 'm_1', name: 'Default' }],
      groups: [{ id: 'g_1', name: 'A', variables: [{ id: 'v_1', name: 'a', type: 'color', valuesByMode: { m_1: '#fff' } }] }],
    }],
  };
  const out = migrateV1ToV2(v2);
  assert.deepEqual(out, v2);
});

test('readVariables auto-migrates v1 files to v2', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-ds-vars-mig-'));
  const v1 = {
    version: 1,
    collections: [{ id: 'c1', name: 'X', groups: [{ id: 'g1', name: 'g', variables: [
      { id: 'v1', name: 'a', type: 'color', value: '#000' },
    ]}]}],
  };
  await writeFile(path.join(dir, VARIABLES_FILE_NAME), JSON.stringify(v1), 'utf8');
  const out = await readVariables(dir);
  assert.equal(out?.version, 2);
  assert.equal(out?.collections[0].modes.length, 1);
});
