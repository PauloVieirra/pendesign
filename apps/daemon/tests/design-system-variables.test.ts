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
    version: 3,
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
    version: 3,
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
    version: 3,
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
    version: 3,
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
  assert.equal(file.version, 3);
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
  assert.equal(file.version, 3);
  assert.equal(file.collections.length, 1);
  assert.equal(file.collections[0].name, 'Default');
});

import { saveVariables } from '../src/design-system-variables.js';
import { readFile } from 'node:fs/promises';

test('saveVariables writes variables.json AND regenerated tokens.css', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-ds-save-'));
  const modeId = 'm_1';
  const file: VariablesFile = {
    version: 3,
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

function emptyV2(): VariablesFile { return { version: 3, collections: [] }; } // v2 name kept for historical context; now returns v3

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

import {
  applyCreateMode, applyUpdateMode, applyDeleteMode, VariablesError,
} from '../src/design-system-variables.js';

test('applyCreateMode appends mode and seeds variable values from previous last mode', () => {
  let file = applyCreateCollection(emptyV2(), { name: 'Grid' });
  const c = file.collections[0];
  file = applyCreateGroup(file, { collectionId: c.id, name: 'g' });
  file = applyCreateVariable(file, {
    collectionId: c.id, groupId: file.collections[0].groups[0].id,
    name: 'col', type: 'number', valueByDefault: 12,
  });
  file = applyCreateMode(file, { collectionId: c.id, name: 'Tablet', width: 834 });
  const collection = file.collections[0];
  assert.equal(collection.modes.length, 2);
  const newId = collection.modes[1].id;
  const v = collection.groups[0].variables[0];
  assert.equal(v.valuesByMode[newId], 12); // seeded from previous last mode
});

test('applyDeleteMode strips that mode from all variables', () => {
  let file = applyCreateCollection(emptyV2(), { name: 'X' });
  const c = file.collections[0];
  file = applyCreateMode(file, { collectionId: c.id, name: 'B' });
  const modeBId = file.collections[0].modes[1].id;
  file = applyCreateGroup(file, { collectionId: c.id, name: 'g' });
  file = applyCreateVariable(file, {
    collectionId: c.id, groupId: file.collections[0].groups[0].id,
    name: 'v', type: 'number', valueByDefault: 1,
  });
  file = applyDeleteMode(file, { collectionId: c.id, modeId: modeBId });
  const v = file.collections[0].groups[0].variables[0];
  assert.equal(Object.keys(v.valuesByMode).length, 1);
  assert.equal(v.valuesByMode[modeBId], undefined);
});

test('applyDeleteMode refuses to remove the last mode', () => {
  let file = applyCreateCollection(emptyV2(), { name: 'X' });
  const modeId = file.collections[0].modes[0].id;
  assert.throws(() => applyDeleteMode(file, { collectionId: file.collections[0].id, modeId }), VariablesError);
});

test('applyCreateMode rejects duplicate name within collection', () => {
  let file = applyCreateCollection(emptyV2(), { name: 'X' });
  assert.throws(() => applyCreateMode(file, { collectionId: file.collections[0].id, name: 'Default' }), VariablesError);
});

test('applyUpdateMode renames and updates width', () => {
  let file = applyCreateCollection(emptyV2(), { name: 'X' });
  const modeId = file.collections[0].modes[0].id;
  file = applyUpdateMode(file, { collectionId: file.collections[0].id, modeId, patch: { name: 'Desktop', width: 1440 } });
  assert.equal(file.collections[0].modes[0].name, 'Desktop');
  assert.equal(file.collections[0].modes[0].width, 1440);
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
    version: 3,
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
    version: 3,
    collections: [{
      id: 'c_1', name: 'X', modes: [{ id: 'm_1', name: 'Default' }],
      groups: [{ id: 'g_1', name: 'A', variables: [{ id: 'v_1', name: 'a', type: 'color', valuesByMode: { m_1: '#fff' } }] }],
    }],
  };
  const out = migrateV1ToV2(v2);
  assert.deepEqual(out, v2);
});

test('readVariables auto-migrates v1 files to v3 (via v1→v2→v3 chain)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-ds-vars-mig-'));
  const v1 = {
    version: 1,
    collections: [{ id: 'c1', name: 'X', groups: [{ id: 'g1', name: 'g', variables: [
      { id: 'v1', name: 'a', type: 'color', value: '#000' },
    ]}]}],
  };
  await writeFile(path.join(dir, VARIABLES_FILE_NAME), JSON.stringify(v1), 'utf8');
  const out = await readVariables(dir);
  assert.equal(out?.version, 3);
  assert.equal(out?.collections[0].modes.length, 1);
});

import { migrateV2ToV3 } from '../src/design-system-variables.js';

test('migrateV2ToV3 adds scope:null to all variables and sets version:3', () => {
  const v2: any = {
    version: 2,
    collections: [{
      id: 'c_1', name: 'Cores',
      modes: [{ id: 'm_1', name: 'Default' }],
      groups: [{
        id: 'g_1', name: 'Orange',
        variables: [
          { id: 'v_1', name: '100', type: 'color', valuesByMode: { m_1: '#FDEEE9' } },
          { id: 'v_2', name: '200', type: 'color', valuesByMode: { m_1: '#FAD8CD' } },
        ],
      }],
    }],
  };
  const v3 = migrateV2ToV3(v2);
  assert.equal(v3.version, 3);
  const variables = v3.collections[0]!.groups[0]!.variables;
  assert.equal(variables.length, 2);
  for (const v of variables) {
    assert.ok('scope' in v, 'scope field must be present');
    assert.equal(v.scope, null);
  }
});

test('migrateV2ToV3 is idempotent on v3 file', () => {
  const v3: any = {
    version: 3,
    collections: [{
      id: 'c_1', name: 'Cores',
      modes: [{ id: 'm_1', name: 'Default' }],
      groups: [{
        id: 'g_1', name: 'Orange',
        variables: [
          { id: 'v_1', name: '100', type: 'color', valuesByMode: { m_1: '#FDEEE9' }, scope: 'color' },
        ],
      }],
    }],
  };
  const out = migrateV2ToV3(v3);
  assert.equal(out.version, 3);
  assert.equal(out.collections[0]?.groups[0]?.variables[0]?.scope, 'color');
});

test('readVariables chains v1→v3 (full migration path)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-ds-vars-v3-'));
  const v1 = {
    version: 1,
    collections: [{ id: 'c1', name: 'X', groups: [{ id: 'g1', name: 'g', variables: [
      { id: 'v1', name: 'a', type: 'color', value: '#000' },
    ]}]}],
  };
  await writeFile(path.join(dir, VARIABLES_FILE_NAME), JSON.stringify(v1), 'utf8');
  const out = await readVariables(dir);
  assert.equal(out?.version, 3);
  const variable = out?.collections[0].groups[0].variables[0];
  assert.ok(variable && 'scope' in variable, 'scope field must be present after full migration');
  assert.equal(variable?.scope, null);
});

// ── Fluid responsive renderTokensCss tests ──────────────────────────────────

test('renderTokensCss single-mode numeric variable → flat output with px', () => {
  const css = renderTokensCss({
    version: 3,
    collections: [{
      id: 'c_1', name: 'Typography',
      modes: [{ id: 'm_1', name: 'Default' }],
      groups: [{ id: 'g_1', name: 'Size', variables: [
        { id: 'v_1', name: 'body', type: 'number', valuesByMode: { m_1: 16 }, scope: 'font-size' },
      ] }],
    }],
  });
  assert.match(css, /--typography-size-body:\s*16px;/);
  assert.ok(!css.includes('@media'), 'no @media blocks for single mode');
  assert.ok(!css.includes('clamp'), 'no clamp for single mode');
});

test('renderTokensCss multi-mode numeric font-size (3 modes) → piecewise clamp', () => {
  const css = renderTokensCss({
    version: 3,
    collections: [{
      id: 'c_1', name: 'Typography',
      modes: [
        { id: 'm_mob', name: 'Mobile', width: 412 },
        { id: 'm_tab', name: 'Tablet', width: 834 },
        { id: 'm_des', name: 'Desktop', width: 1440 },
      ],
      groups: [{ id: 'g_1', name: 'Size', variables: [
        { id: 'v_1', name: 'h1', type: 'number', valuesByMode: { m_mob: 32, m_tab: 40, m_des: 48 }, scope: 'font-size' },
      ] }],
    }],
  });
  // Baseline :root declaration
  assert.match(css, /--typography-size-h1:\s*32px;/);
  // Two @media blocks at the lo-breakpoints (412 and 834)
  assert.ok(css.includes('@media (min-width: 412px)'), 'missing 412px breakpoint');
  assert.ok(css.includes('@media (min-width: 834px)'), 'missing 834px breakpoint');
  // clamp boundaries present
  assert.ok(css.includes('32px'), 'missing lower bound 32px');
  assert.ok(css.includes('40px'), 'missing mid bound 40px');
  assert.ok(css.includes('48px'), 'missing upper bound 48px');
  assert.ok(css.includes('clamp('), 'missing clamp()');
  // interpolation: the calc uses the lo-width in the subtraction
  assert.ok(css.includes('412px'), 'missing 412px in calc');
  assert.ok(css.includes('834px'), 'missing 834px in calc');
  // widthDiff for first segment (834-412=422) and second (1440-834=606)
  assert.ok(css.includes('422'), 'missing widthDiff 422 for first segment');
  assert.ok(css.includes('606'), 'missing widthDiff 606 for second segment (1440-834)');
});

test('renderTokensCss multi-mode with all equal values → flat output (no clamps)', () => {
  const css = renderTokensCss({
    version: 3,
    collections: [{
      id: 'c_1', name: 'Space',
      modes: [
        { id: 'm_mob', name: 'Mobile', width: 375 },
        { id: 'm_des', name: 'Desktop', width: 1280 },
      ],
      groups: [{ id: 'g_1', name: 'Gap', variables: [
        { id: 'v_1', name: 'md', type: 'number', valuesByMode: { m_mob: 16, m_des: 16 }, scope: 'gap' },
      ] }],
    }],
  });
  assert.match(css, /--space-gap-md:\s*16px;/);
  assert.ok(!css.includes('@media'), 'no @media for equal values');
  assert.ok(!css.includes('clamp'), 'no clamp for equal values');
});

test('renderTokensCss multi-mode color → emits @media steps with raw hex values', () => {
  const css = renderTokensCss({
    version: 3,
    collections: [{
      id: 'c_1', name: 'Colors',
      modes: [
        { id: 'm_light', name: 'Light', width: 375 },
        { id: 'm_dark', name: 'Dark', width: 1280 },
      ],
      groups: [{ id: 'g_1', name: 'Brand', variables: [
        { id: 'v_1', name: 'primary', type: 'color', valuesByMode: { m_light: '#ffffff', m_dark: '#000000' }, scope: 'color' },
      ] }],
    }],
  });
  assert.match(css, /--colors-brand-primary:\s*#ffffff;/);
  assert.ok(css.includes('@media (min-width: 1280px)'), 'missing 1280px breakpoint');
  assert.ok(css.includes('#000000'), 'missing dark hex');
  assert.ok(!css.includes('clamp'), 'no clamp for color type');
});

test('renderTokensCss multi-mode with one mode missing width → falls back to flat', () => {
  const css = renderTokensCss({
    version: 3,
    collections: [{
      id: 'c_1', name: 'Typography',
      modes: [
        { id: 'm_mob', name: 'Mobile', width: 375 },
        { id: 'm_des', name: 'Desktop' }, // no width
      ],
      groups: [{ id: 'g_1', name: 'Size', variables: [
        { id: 'v_1', name: 'body', type: 'number', valuesByMode: { m_mob: 14, m_des: 18 }, scope: 'font-size' },
      ] }],
    }],
  });
  // Should use first mode value (14px) flat
  assert.match(css, /--typography-size-body:\s*14px;/);
  assert.ok(!css.includes('@media'), 'no @media when a mode is missing width');
  assert.ok(!css.includes('clamp'), 'no clamp when a mode is missing width');
});

test('renderTokensCss line-height scope → emits unitless number', () => {
  const css = renderTokensCss({
    version: 3,
    collections: [{
      id: 'c_1', name: 'Typography',
      modes: [{ id: 'm_1', name: 'Default' }],
      groups: [{ id: 'g_1', name: 'Leading', variables: [
        { id: 'v_1', name: 'normal', type: 'number', valuesByMode: { m_1: 1.5 }, scope: 'line-height' },
      ] }],
    }],
  });
  assert.match(css, /--typography-leading-normal:\s*1\.5;/);
  assert.ok(!css.includes('1.5px'), 'line-height must not append px');
});

test('renderTokensCss scope null with numeric value → defaults to px', () => {
  const css = renderTokensCss({
    version: 3,
    collections: [{
      id: 'c_1', name: 'Misc',
      modes: [{ id: 'm_1', name: 'Default' }],
      groups: [{ id: 'g_1', name: 'X', variables: [
        { id: 'v_1', name: 'val', type: 'number', valuesByMode: { m_1: 24 }, scope: null },
      ] }],
    }],
  });
  assert.match(css, /--misc-x-val:\s*24px;/);
});
