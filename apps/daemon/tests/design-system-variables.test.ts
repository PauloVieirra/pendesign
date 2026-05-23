import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
  readVariables,
  writeVariables,
  type VariablesFile,
} from '../src/design-system-variables.js';
import { newVariableId, newCollectionId, newGroupId } from '../src/design-system-variables.js';

test('readVariables returns parsed JSON, writeVariables roundtrips it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-ds-vars-'));
  const file: VariablesFile = {
    version: 1,
    collections: [
      {
        id: 'c_1',
        name: 'Cores',
        groups: [
          {
            id: 'g_1',
            name: 'Orange',
            variables: [
              { id: 'v_1', name: '100', type: 'color', value: '#FDEEE9' },
              { id: 'v_2', name: '200', type: 'color', value: '#FAD8CD' },
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
