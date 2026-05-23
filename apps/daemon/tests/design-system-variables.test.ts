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
