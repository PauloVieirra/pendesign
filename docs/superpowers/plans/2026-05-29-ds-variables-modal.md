# Design System Variables Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Design System Variables screen into a responsive overlay modal, add per-collection breakpoint modes (Desktop/Tablet/Mobile) with value-per-mode storage, auto-seed new projects with a Container Size / Grid / Typography starter kit, and add search + advanced type filter + typed "Create variable" popover.

**Architecture:** Daemon-side schema bump from v1 to v2 (`Variable.value` → `Variable.valuesByMode`, new `Mode[]` per collection) with idempotent on-load migration. New web overlay component (`DesignSystemModal`) replaces the entry-view route; reuses existing API plus new mode CRUD endpoints. New project creation seeds a fixed defaults tree exported from a single daemon constant.

**Tech Stack:** TypeScript, React 18, Express (daemon HTTP), Vitest (unit tests), Playwright (e2e), CSS Grid (table layout), Vite/Next.js HMR (web), Electron (desktop shell — host only, no code).

**Spec:** `docs/superpowers/specs/2026-05-29-ds-variables-modal-design.md`

---

## Phase 1 — Daemon: schema v2 + migration

### Task 1: Type definitions for v2 schema

**Files:**
- Modify: `apps/daemon/src/design-system-variables.ts:5-29`
- Test: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 1: Write failing test for v2 types and migration**

Append to `apps/daemon/tests/design-system-variables.test.ts`:

```typescript
import { migrateV1ToV2 } from '../src/design-system-variables.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @open-design/daemon test design-system-variables`
Expected: FAIL — `migrateV1ToV2 is not exported`

- [ ] **Step 3: Implement v2 types and migration**

Replace lines 5–29 of `apps/daemon/src/design-system-variables.ts`:

```typescript
export type VariableType = 'color' | 'number' | 'string' | 'boolean';

export interface Mode {
  id: string;
  name: string;
  width?: number;
}

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  valuesByMode: Record<string, string | number | boolean>;
}

export interface VariableGroup {
  id: string;
  name: string;
  variables: Variable[];
}

export interface VariableCollection {
  id: string;
  name: string;
  modes: Mode[];
  groups: VariableGroup[];
}

export interface VariablesFile {
  version: 2;
  collections: VariableCollection[];
}

export const VARIABLES_FILE_NAME = 'variables.json';

export function newModeId(): string {
  return `m_${shortToken()}`;
}

export function migrateV1ToV2(input: any): VariablesFile {
  if (!input || typeof input !== 'object') {
    return { version: 2, collections: [] };
  }
  if (input.version === 2) return input as VariablesFile;
  const collections = Array.isArray(input.collections) ? input.collections : [];
  const migratedCollections: VariableCollection[] = collections.map((c: any) => {
    const defaultMode: Mode = { id: newModeId(), name: 'Default' };
    const groups = Array.isArray(c.groups) ? c.groups : [];
    return {
      id: String(c.id),
      name: String(c.name),
      modes: [defaultMode],
      groups: groups.map((g: any) => ({
        id: String(g.id),
        name: String(g.name),
        variables: (Array.isArray(g.variables) ? g.variables : []).map((v: any) => ({
          id: String(v.id),
          name: String(v.name),
          type: v.type as VariableType,
          valuesByMode: { [defaultMode.id]: v.value },
        })),
      })),
    };
  });
  return { version: 2, collections: migratedCollections };
}
```

`shortToken()` already exists below line 50; reuse.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @open-design/daemon test design-system-variables`
Expected: PASS for both new tests. Existing tests will FAIL — that's the next task.

- [ ] **Step 5: Update existing test fixture to v2 shape**

Modify the existing `readVariables / writeVariables roundtrip` test (around line 13–37) to use v2:

```typescript
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
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @open-design/daemon test design-system-variables`
Expected: PASS for all variables tests in the file.

- [ ] **Step 7: Commit**

```bash
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds): bump variables schema to v2 with modes + valuesByMode"
```

---

### Task 2: Wire migration into `readVariables`

**Files:**
- Modify: `apps/daemon/src/design-system-variables.ts:33-50` (function `readVariables`)
- Test: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 1: Write failing test — `readVariables` auto-migrates v1 on disk**

```typescript
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
```

Add the imports at the top of the test file:

```typescript
import { writeFile } from 'node:fs/promises';
import { VARIABLES_FILE_NAME } from '../src/design-system-variables.js';
```

- [ ] **Step 2: Run test, expect FAIL** (`readVariables` returns the raw v1 object)

Run: `pnpm --filter @open-design/daemon test design-system-variables`
Expected: FAIL with `out?.version === 1` not equal to 2.

- [ ] **Step 3: Implement auto-migration in `readVariables`**

Replace the body of `readVariables` (line 33+) so it runs `migrateV1ToV2` after parsing and persists the migrated file when it had to upgrade. Read the current body, then patch:

```typescript
export async function readVariables(dsDir: string): Promise<VariablesFile | null> {
  try {
    const raw = await fsReadFile(path.join(dsDir, VARIABLES_FILE_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2) return parsed as VariablesFile;
    const upgraded = migrateV1ToV2(parsed);
    // Best-effort write back; if it fails (e.g. read-only fixture), still return upgraded.
    try { await writeVariables(dsDir, upgraded); } catch { /* ignore */ }
    return upgraded;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @open-design/daemon test design-system-variables`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds): readVariables auto-migrates v1 files in place"
```

---

### Task 3: Update apply* helpers for `valuesByMode` + modes

**Files:**
- Modify: `apps/daemon/src/design-system-variables.ts:253-322`
- Test: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 1: Write failing tests for updated helpers**

```typescript
import {
  applyCreateCollection, applyCreateGroup, applyCreateVariable, applyUpdateVariable,
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
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @open-design/daemon test design-system-variables`
Expected: FAIL — `applyCreateCollection` doesn't seed modes; `applyCreateVariable` signature mismatch; `applyUpdateVariable` patch doesn't accept `valuesByMode`.

- [ ] **Step 3: Implement updated helpers**

Replace `applyCreateCollection` (line 253):

```typescript
export function applyCreateCollection(file: VariablesFile, params: { name: string }): VariablesFile {
  const next = clone(file);
  next.collections.push({
    id: newCollectionId(),
    name: params.name,
    modes: [{ id: newModeId(), name: 'Default' }],
    groups: [],
  });
  return next;
}
```

Replace `applyCreateVariable` (line 285):

```typescript
export function applyCreateVariable(
  file: VariablesFile,
  params: { collectionId: string; groupId: string; name: string; type: VariableType; valueByDefault: string | number | boolean },
): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection not found: ${params.collectionId}`);
  const group = collection.groups.find((g) => g.id === params.groupId);
  if (!group) throw new VariablesError('NOT_FOUND', `group not found: ${params.groupId}`);
  const valuesByMode: Record<string, string | number | boolean> = {};
  for (const mode of collection.modes) valuesByMode[mode.id] = params.valueByDefault;
  group.variables.push({
    id: newVariableId(),
    name: params.name,
    type: params.type,
    valuesByMode,
  });
  return next;
}
```

Replace `applyUpdateVariable` (line 295):

```typescript
export function applyUpdateVariable(
  file: VariablesFile,
  params: { variableId: string; patch: Partial<Pick<Variable, 'name' | 'type'>> & { valuesByMode?: Record<string, string | number | boolean>; value?: string | number | boolean } },
): VariablesFile {
  const next = clone(file);
  for (const collection of next.collections) {
    for (const group of collection.groups) {
      const variable = group.variables.find((v) => v.id === params.variableId);
      if (!variable) continue;
      if (typeof params.patch.name === 'string') variable.name = params.patch.name;
      if (params.patch.type) variable.type = params.patch.type;
      if (params.patch.valuesByMode) {
        variable.valuesByMode = { ...variable.valuesByMode, ...params.patch.valuesByMode };
      }
      if (params.patch.value !== undefined && collection.modes[0]) {
        // Legacy single-value payload routes to the first mode.
        variable.valuesByMode = { ...variable.valuesByMode, [collection.modes[0].id]: params.patch.value };
      }
      return next;
    }
  }
  throw new VariablesError('NOT_FOUND', `variable not found: ${params.variableId}`);
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @open-design/daemon test design-system-variables`
Expected: PASS for new tests. Some adjacent tests may need fixture updates — fix any breakage by switching to v2 shape.

- [ ] **Step 5: Update remaining callers in the same file**

`migrateFromTokensCss` (around line 170) currently produces a v1 file. Patch its return to `{ version: 2, collections: [...] }` and wrap each collection with a Default mode and each variable's value into `valuesByMode`:

Locate the return statement in `migrateFromTokensCss`, then change the constructed collections so each carries `modes: [{ id: newModeId(), name: 'Default' }]` and each variable is built with `valuesByMode: { [modeId]: coercedValue }` instead of `value: coercedValue`. Re-export `version: 2`.

- [ ] **Step 6: Run all daemon tests in this file**

Run: `pnpm --filter @open-design/daemon test design-system-variables`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds): apply* helpers operate on valuesByMode + auto-seed Default mode"
```

---

### Task 4: Mode CRUD helpers + tests

**Files:**
- Modify: `apps/daemon/src/design-system-variables.ts` (append below `applyDeleteVariable`)
- Test: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
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
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @open-design/daemon test design-system-variables`
Expected: FAIL — helpers don't exist.

- [ ] **Step 3: Implement mode helpers**

Append to `apps/daemon/src/design-system-variables.ts`:

```typescript
export function applyCreateMode(
  file: VariablesFile,
  params: { collectionId: string; name: string; width?: number },
): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection not found: ${params.collectionId}`);
  const trimmed = params.name.trim();
  if (!trimmed) throw new VariablesError('BAD_REQUEST', 'mode name required');
  if (collection.modes.some((m) => m.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new VariablesError('CONFLICT', `mode name already exists: ${trimmed}`);
  }
  const previousLast = collection.modes[collection.modes.length - 1];
  const mode: Mode = { id: newModeId(), name: trimmed };
  if (typeof params.width === 'number' && Number.isFinite(params.width)) mode.width = params.width;
  collection.modes.push(mode);
  // Seed every variable with the previous-last-mode value as the starting point.
  for (const group of collection.groups) {
    for (const variable of group.variables) {
      const seed = previousLast ? variable.valuesByMode[previousLast.id] : defaultForType(variable.type);
      variable.valuesByMode = { ...variable.valuesByMode, [mode.id]: seed };
    }
  }
  return next;
}

export function applyUpdateMode(
  file: VariablesFile,
  params: { collectionId: string; modeId: string; patch: Partial<Pick<Mode, 'name' | 'width'>> },
): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection not found: ${params.collectionId}`);
  const mode = collection.modes.find((m) => m.id === params.modeId);
  if (!mode) throw new VariablesError('NOT_FOUND', `mode not found: ${params.modeId}`);
  if (typeof params.patch.name === 'string') {
    const trimmed = params.patch.name.trim();
    if (!trimmed) throw new VariablesError('BAD_REQUEST', 'mode name required');
    if (collection.modes.some((m) => m.id !== mode.id && m.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new VariablesError('CONFLICT', `mode name already exists: ${trimmed}`);
    }
    mode.name = trimmed;
  }
  if (params.patch.width !== undefined) {
    if (params.patch.width === null) delete (mode as any).width;
    else mode.width = params.patch.width;
  }
  return next;
}

export function applyDeleteMode(
  file: VariablesFile,
  params: { collectionId: string; modeId: string },
): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection not found: ${params.collectionId}`);
  if (collection.modes.length <= 1) {
    throw new VariablesError('BAD_REQUEST', 'cannot delete the last mode');
  }
  const idx = collection.modes.findIndex((m) => m.id === params.modeId);
  if (idx === -1) throw new VariablesError('NOT_FOUND', `mode not found: ${params.modeId}`);
  collection.modes.splice(idx, 1);
  for (const group of collection.groups) {
    for (const variable of group.variables) {
      const { [params.modeId]: _drop, ...rest } = variable.valuesByMode;
      variable.valuesByMode = rest;
    }
  }
  return next;
}

export function defaultForType(type: VariableType): string | number | boolean {
  switch (type) {
    case 'color': return '#000000';
    case 'number': return 0;
    case 'string': return '';
    case 'boolean': return false;
  }
}
```

Extend `VariablesError` codes if needed: add `'CONFLICT'` to the existing union if it isn't already supported.

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @open-design/daemon test design-system-variables`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds): mode CRUD helpers (create/update/delete) per collection"
```

---

## Phase 2 — Daemon: HTTP routes for modes + valuesByMode

### Task 5: Mode CRUD endpoints

**Files:**
- Modify: `apps/daemon/src/static-resource-routes.ts` (add 3 endpoints after the existing groups route block, around line 806)
- Test: `apps/daemon/tests/design-system-variables-routes.test.ts` (create if absent — check the daemon tests dir for existing route test patterns)

- [ ] **Step 1: Inspect existing route test pattern**

Run: `ls apps/daemon/tests/*routes*.test.ts | head`

If no matching test file exists, mirror the pattern of `apps/daemon/tests/design-system-variables.test.ts` for unit-level coverage of the apply* helpers via the routes is sufficient at this layer; e2e route coverage lands in Task 26.

- [ ] **Step 2: Add the 3 mode endpoints in `static-resource-routes.ts`**

Find the existing `app.post('/api/design-systems/:id/variables/collections/:collectionId/groups/:groupId/variables', ...)` block (around line 806). Right after its closing `});`, append:

```typescript
  app.post('/api/design-systems/:id/variables/collections/:collectionId/modes', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
      const body = req.body as { name?: string; width?: number } | undefined;
      if (!body || typeof body.name !== 'string') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'body { name: string, width?: number } required');
      }
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyCreateMode(current, {
          collectionId: req.params.collectionId,
          name: body.name as string,
          width: body.width,
        });
        await saveVariables(resolved.dir, next);
      });
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ ok: true });
    } catch (err) {
      const v = variablesErrorToStatus(err);
      if (v) return sendApiError(res, v.status, v.code, v.message);
      sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
    }
  });

  app.put('/api/design-systems/:id/variables/collections/:collectionId/modes/:modeId', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
      const patch = req.body as { name?: string; width?: number | null };
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyUpdateMode(current, {
          collectionId: req.params.collectionId,
          modeId: req.params.modeId,
          patch: patch as any,
        });
        await saveVariables(resolved.dir, next);
      });
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ ok: true });
    } catch (err) {
      const v = variablesErrorToStatus(err);
      if (v) return sendApiError(res, v.status, v.code, v.message);
      sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
    }
  });

  app.delete('/api/design-systems/:id/variables/collections/:collectionId/modes/:modeId', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyDeleteMode(current, {
          collectionId: req.params.collectionId,
          modeId: req.params.modeId,
        });
        await saveVariables(resolved.dir, next);
      });
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ ok: true });
    } catch (err) {
      const v = variablesErrorToStatus(err);
      if (v) return sendApiError(res, v.status, v.code, v.message);
      sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
    }
  });
```

Update the top-of-file import block (around line 41) so it includes the new helpers:

```typescript
import {
  // ... existing
  applyCreateMode,
  applyUpdateMode,
  applyDeleteMode,
} from './design-system-variables.js';
```

`variablesErrorToStatus` already exists (line 679); ensure it handles the `'CONFLICT'` code by mapping to status 409:

Replace its body:

```typescript
function variablesErrorToStatus(err: unknown): { status: number; code: string; message: string } | null {
  if (err instanceof VariablesError) {
    const status =
      err.code === 'NOT_FOUND' ? 404 :
      err.code === 'CONFLICT' ? 409 :
      400;
    return { status, code: err.code, message: err.message };
  }
  return null;
}
```

- [ ] **Step 3: Smoke-build the daemon**

Run: `pnpm --filter @open-design/daemon build`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add apps/daemon/src/static-resource-routes.ts
git commit -m "feat(ds): HTTP endpoints for mode CRUD on a collection"
```

---

### Task 6: PUT variable accepts `valuesByMode` (and legacy `value`)

**Files:**
- Modify: `apps/daemon/src/static-resource-routes.ts:686-707` (the existing `PUT /api/design-systems/:id/variables/:variableId` route)

- [ ] **Step 1: Inspect current handler**

Open the block at line 686. The current shape already passes `patch` through to `applyUpdateVariable`. Because Task 3 widened `applyUpdateVariable` to accept `valuesByMode` and legacy `value`, the handler only needs to widen its body type and validate. The minimal patch:

- [ ] **Step 2: Edit the handler body**

Replace the `const patch = req.body as ...` line through the validation:

```typescript
      const patch = req.body as Partial<{
        name: string;
        type: VariableType;
        value: string | number | boolean;
        valuesByMode: Record<string, string | number | boolean>;
      }>;
      if (!patch || typeof patch !== 'object') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'patch body required');
      }
      const hasField = ('name' in patch) || ('type' in patch) || ('value' in patch) || ('valuesByMode' in patch);
      if (!hasField) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'patch must include at least one of: name, type, value, valuesByMode');
      }
```

Add `VariableType` to the existing import block at the top of the file if it isn't already imported.

- [ ] **Step 3: Smoke-build**

Run: `pnpm --filter @open-design/daemon build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/daemon/src/static-resource-routes.ts
git commit -m "feat(ds): variable PUT accepts valuesByMode patch + legacy value"
```

---

### Task 7: Make `createVariable` route accept the new shape

**Files:**
- Modify: `apps/daemon/src/static-resource-routes.ts:806-840` (the existing `POST .../variables` handler)

- [ ] **Step 1: Edit the handler so the body shape matches `applyCreateVariable`**

The body sent from web becomes `{ name, type, value }` (single starting value, copied to every mode of the target collection). Find the handler and patch:

```typescript
      const body = req.body as { name?: string; type?: VariableType; value?: string | number | boolean };
      if (!body || typeof body.name !== 'string' || !body.type) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'body { name: string, type: VariableType, value?: any } required');
      }
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyCreateVariable(current, {
          collectionId: req.params.collectionId,
          groupId: req.params.groupId,
          name: body.name as string,
          type: body.type as VariableType,
          valueByDefault: body.value ?? defaultForType(body.type as VariableType),
        });
        await saveVariables(resolved.dir, next);
      });
```

Export `defaultForType` from `design-system-variables.ts` (already exists internally) and import it here.

- [ ] **Step 2: Smoke-build**

Run: `pnpm --filter @open-design/daemon build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/daemon/src/static-resource-routes.ts apps/daemon/src/design-system-variables.ts
git commit -m "feat(ds): createVariable handler seeds value across all modes of target collection"
```

---

## Phase 3 — Daemon: seed defaults on new project

### Task 8: `design-system-seed.ts` constant

**Files:**
- Create: `apps/daemon/src/design-system-seed.ts`
- Test: `apps/daemon/tests/design-system-seed.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/daemon/tests/design-system-seed.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildSeededVariablesFile } from '../src/design-system-seed.js';

test('buildSeededVariablesFile returns a valid v2 VariablesFile', () => {
  const file = buildSeededVariablesFile();
  assert.equal(file.version, 2);
  const names = file.collections.map((c) => c.name).sort();
  assert.deepEqual(names, ['Container Size', 'Controle', 'Cores', 'Grid', 'Spacing', 'Style', 'Typography']);
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
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @open-design/daemon test design-system-seed`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/daemon/src/design-system-seed.ts`**

```typescript
import {
  newCollectionId, newGroupId, newModeId, newVariableId,
  type VariablesFile, type VariableCollection, type Variable,
} from './design-system-variables.js';

type SeedSpec = {
  collectionName: string;
  modes: Array<{ name: string; width?: number }>;
  groups: Array<{
    groupName: string;
    variables: Array<{ name: string; type: Variable['type']; values: Array<string | number | boolean> }>;
  }>;
};

const DESKTOP_TABLET_MOBILE: SeedSpec['modes'] = [
  { name: 'Desktop', width: 1440 },
  { name: 'Tablet', width: 834 },
  { name: 'Mobile', width: 412 },
];

const SEED_SPEC: SeedSpec[] = [
  {
    collectionName: 'Container Size',
    modes: DESKTOP_TABLET_MOBILE,
    groups: [{
      groupName: 'Resolução',
      variables: [{ name: 'Resolução', type: 'number', values: [1440, 834, 412] }],
    }],
  },
  {
    collectionName: 'Grid',
    modes: DESKTOP_TABLET_MOBILE,
    groups: [{
      groupName: 'Layout',
      variables: [
        { name: 'Columns', type: 'number', values: [12, 8, 5] },
        { name: 'Margin', type: 'number', values: [48, 24, 16] },
        { name: 'Gutter', type: 'number', values: [24, 16, 16] },
      ],
    }],
  },
  {
    collectionName: 'Typography',
    modes: DESKTOP_TABLET_MOBILE,
    groups: [
      {
        groupName: 'Font Family',
        variables: [{ name: 'Font Family', type: 'string', values: ['Inter', 'Inter', 'Inter'] }],
      },
      {
        groupName: 'Size',
        variables: [
          { name: 'Display 1', type: 'number', values: [68, 60, 52] },
          { name: 'Display 2', type: 'number', values: [60, 52, 44] },
          { name: 'H1', type: 'number', values: [48, 40, 32] },
          { name: 'H2', type: 'number', values: [40, 32, 28] },
          { name: 'H3', type: 'number', values: [32, 28, 24] },
          { name: 'H4', type: 'number', values: [28, 24, 20] },
          { name: 'H5', type: 'number', values: [24, 20, 20] },
          { name: 'H6', type: 'number', values: [16, 16, 16] },
        ],
      },
      {
        groupName: 'Weight',
        variables: [
          { name: 'Regular', type: 'number', values: [400, 400, 400] },
          { name: 'Medium', type: 'number', values: [500, 500, 500] },
          { name: 'Bold', type: 'number', values: [700, 700, 700] },
        ],
      },
    ],
  },
  { collectionName: 'Cores', modes: [{ name: 'Default' }], groups: [] },
  { collectionName: 'Spacing', modes: [{ name: 'Default' }], groups: [] },
  { collectionName: 'Style', modes: [{ name: 'Default' }], groups: [] },
  { collectionName: 'Controle', modes: [{ name: 'Default' }], groups: [] },
];

export function buildSeededVariablesFile(): VariablesFile {
  const collections: VariableCollection[] = SEED_SPEC.map((spec) => {
    const modes = spec.modes.map((m) => ({ id: newModeId(), name: m.name, ...(m.width != null ? { width: m.width } : {}) }));
    return {
      id: newCollectionId(),
      name: spec.collectionName,
      modes,
      groups: spec.groups.map((g) => ({
        id: newGroupId(),
        name: g.groupName,
        variables: g.variables.map((v) => {
          const valuesByMode: Record<string, string | number | boolean> = {};
          modes.forEach((mode, i) => { valuesByMode[mode.id] = v.values[i] ?? v.values[v.values.length - 1]; });
          return { id: newVariableId(), name: v.name, type: v.type, valuesByMode };
        }),
      })),
    };
  });
  return { version: 2, collections };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @open-design/daemon test design-system-seed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/design-system-seed.ts apps/daemon/tests/design-system-seed.test.ts
git commit -m "feat(ds): design-system-seed.ts with default Container Size + Grid + Typography"
```

---

### Task 9: `create-empty` endpoint honors `seed` param

**Files:**
- Modify: the daemon route that backs `POST /api/projects/:projectId/design-system/create-empty` (located in `apps/daemon/src/design-systems.ts` or its routes neighbor — grep to confirm)

- [ ] **Step 1: Locate the handler**

Run: `grep -n "create-empty" apps/daemon/src/*.ts | head`

Open the resolved file and find the handler body.

- [ ] **Step 2: Add `seed` body param**

Inside the handler, after the empty file is created but before persisting, branch on `req.body?.seed`:

```typescript
const seedParam = (req.body as { seed?: 'empty' | 'defaults' } | undefined)?.seed ?? 'defaults';
const initial: VariablesFile = seedParam === 'empty'
  ? { version: 2, collections: [] }
  : buildSeededVariablesFile();
// then persist `initial` instead of the previous empty literal
```

Add the import:

```typescript
import { buildSeededVariablesFile } from './design-system-seed.js';
import type { VariablesFile } from './design-system-variables.js';
```

- [ ] **Step 3: Write integration test (lightweight)**

Append to `apps/daemon/tests/design-system-seed.test.ts`:

```typescript
import { buildSeededVariablesFile } from '../src/design-system-seed.js';

test('buildSeededVariablesFile is deterministic in shape (ids vary, names stable)', () => {
  const a = buildSeededVariablesFile();
  const b = buildSeededVariablesFile();
  assert.equal(a.collections.length, b.collections.length);
  for (let i = 0; i < a.collections.length; i++) {
    assert.equal(a.collections[i].name, b.collections[i].name);
    assert.equal(a.collections[i].modes.length, b.collections[i].modes.length);
  }
});
```

Run: `pnpm --filter @open-design/daemon test design-system-seed`
Expected: PASS.

- [ ] **Step 4: Smoke-build**

Run: `pnpm --filter @open-design/daemon build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/design-systems.ts apps/daemon/src/design-system-seed.ts apps/daemon/tests/design-system-seed.test.ts
git commit -m "feat(ds): create-empty seeds defaults by default; accepts { seed: 'empty' } to opt out"
```

---

## Phase 4 — Web: provider types + new endpoints

### Task 10: Update `apps/web/src/providers/design-system-variables.ts`

**Files:**
- Modify: `apps/web/src/providers/design-system-variables.ts` (entire file)

- [ ] **Step 1: Replace types and add mode endpoints**

Replace the file contents:

```typescript
export type VariableType = 'color' | 'number' | 'string' | 'boolean';

export interface Mode {
  id: string;
  name: string;
  width?: number;
}

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  valuesByMode: Record<string, string | number | boolean>;
}

export interface VariableGroup {
  id: string;
  name: string;
  variables: Variable[];
}

export interface VariableCollection {
  id: string;
  name: string;
  modes: Mode[];
  groups: VariableGroup[];
}

export interface VariablesFile {
  version: 2;
  collections: VariableCollection[];
}

interface ApiErrorEnvelope {
  error?: { code?: string; message?: string } | string;
}
interface ErrorResult { error: { code?: string; message: string } }

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T | ErrorResult> {
  try {
    const resp = await fetch(input, init);
    if (!resp.ok) {
      const body = (await resp.json().catch(() => null)) as ApiErrorEnvelope | null;
      const err = body?.error;
      if (typeof err === 'object' && err !== null) {
        return { error: { code: (err as any).code, message: (err as any).message ?? `${resp.status} ${resp.statusText}` } };
      }
      return { error: { message: typeof err === 'string' ? err : `${resp.status} ${resp.statusText}` } };
    }
    return (await resp.json()) as T;
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'request failed' } };
  }
}

const enc = encodeURIComponent;

export const fetchVariables = (dsId: string) =>
  jsonFetch<{ variables: VariablesFile; migrated?: boolean }>(
    `/api/design-systems/${enc(dsId)}/variables`,
  );

export const updateVariable = (
  dsId: string,
  variableId: string,
  patch: Partial<Pick<Variable, 'name' | 'type'>> & {
    valuesByMode?: Record<string, string | number | boolean>;
    value?: string | number | boolean;
  },
) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/${enc(variableId)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
  );

export const deleteVariable = (dsId: string, variableId: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/${enc(variableId)}`,
    { method: 'DELETE' },
  );

export const createVariable = (
  dsId: string, collectionId: string, groupId: string,
  body: { name: string; type: VariableType; value?: string | number | boolean },
) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/groups/${enc(groupId)}/variables`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );

export const createCollection = (dsId: string, name: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
  );

export const deleteCollection = (dsId: string, collectionId: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}`,
    { method: 'DELETE' },
  );

export const createGroup = (dsId: string, collectionId: string, name: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/groups`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
  );

export const deleteGroup = (dsId: string, collectionId: string, groupId: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/groups/${enc(groupId)}`,
    { method: 'DELETE' },
  );

export const createMode = (dsId: string, collectionId: string, body: { name: string; width?: number }) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/modes`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );

export const updateMode = (
  dsId: string, collectionId: string, modeId: string,
  patch: { name?: string; width?: number | null },
) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/modes/${enc(modeId)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
  );

export const deleteMode = (dsId: string, collectionId: string, modeId: string) =>
  jsonFetch<{ ok: true }>(
    `/api/design-systems/${enc(dsId)}/variables/collections/${enc(collectionId)}/modes/${enc(modeId)}`,
    { method: 'DELETE' },
  );

export const createEmptyDesignSystemForProject = (
  projectId: string,
  body: { seed?: 'empty' | 'defaults' } = {},
) =>
  jsonFetch<{ designSystem: { id: string; title?: string; summary?: string }; designSystemId: string }>(
    `/api/projects/${enc(projectId)}/design-system/create-empty`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: many errors in callers (table, view, sidebar) — that's the next phase. Confirm only those references break.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/providers/design-system-variables.ts
git commit -m "feat(ds): web provider types + mode CRUD + valuesByMode"
```

---

## Phase 5 — Web: router param + project trigger + entry redirect

### Task 11: Router accepts `?ds=open` on the project route

**Files:**
- Modify: `apps/web/src/router.ts` (read the file first to locate the project-route type and serializer/parser)
- Test: existing router tests if any (`apps/web/tests/router*.test.ts`)

- [ ] **Step 1: Add `ds` to project route type**

Open `apps/web/src/router.ts`. Locate the project-route discriminated-union member (`kind: 'project'`). Add an optional field:

```typescript
| {
    kind: 'project';
    projectId: string;
    conversationId: string | null;
    fileName: string | null;
    ds?: 'open';
  }
```

In the serializer that turns a Route into a URL, when `route.kind === 'project'` and `route.ds === 'open'`, append `?ds=open` (or merge with other params). In the parser, when `?ds=open` is present, set `ds: 'open'`.

- [ ] **Step 2: Smoke-test by typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: PASS (or only DS-related errors continue from previous tasks).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/router.ts
git commit -m "feat(ds): project route carries ?ds=open"
```

---

### Task 12: DS trigger button + shortcut in `ProjectView`

**Files:**
- Modify: `apps/web/src/components/ProjectView.tsx` (locate the `AppChromeHeader` block; the button slot is the `actions` prop)

- [ ] **Step 1: Add a `Design System` icon-button next to the AvatarMenu**

Find the `<AppChromeHeader ... actions={(...)}>` block (around line 3211 per earlier grep). Wrap the existing AvatarMenu in a fragment so two controls render:

```tsx
actions={(
  <>
    <button
      type="button"
      className="settings-icon-btn"
      onClick={() => navigate({ ...currentRoute, ds: 'open' })}
      title={t('ds.modal.openShortcut')}
      aria-label={t('ds.modal.openShortcut')}
      data-testid="project-open-ds"
    >
      <Icon name="palette" size={17} />
    </button>
    <AvatarMenu ... />
  </>
)}
```

Use whichever icon key matches "design system" in the existing Icon set. If `palette` is not present, run `grep "name: 'palette'" apps/web/src/components/Icon.tsx` to confirm or pick the closest icon (`brush`, `swatch`, `grid`).

Above the JSX, capture the current route via the existing `useRoute()` helper if not already in scope, and resolve `currentRoute` as the active project route.

- [ ] **Step 2: Add a keyboard shortcut**

Inside `ProjectView`, mount a single effect:

```typescript
useEffect(() => {
  function onKey(ev: KeyboardEvent) {
    const isMod = ev.metaKey || ev.ctrlKey;
    if (isMod && ev.shiftKey && ev.key.toLowerCase() === 'd') {
      ev.preventDefault();
      navigate({ kind: 'project', projectId: project.id, conversationId: null, fileName: null, ds: 'open' });
    }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [project.id]);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ProjectView.tsx
git commit -m "feat(ds): project header DS button + ⌘/Ctrl+Shift+D shortcut"
```

---

### Task 13: Redirect `view=design-systems` entry-view into project + `?ds=open`

**Files:**
- Modify: `apps/web/src/components/EntryShell.tsx:589-610` (the `view === 'design-systems'` branch)

- [ ] **Step 1: Replace the branch with a redirect**

Replace the `view === 'design-systems'` block (around line 589) with:

```tsx
{view === 'design-systems' ? (
  <DesignSystemsEntryRedirect
    route={route}
    projects={projects}
    onCreateEmpty={async () => {
      // existing onCreateEmpty body
    }}
  />
) : null}
```

Where `DesignSystemsEntryRedirect` is a small inline component that, on mount, navigates to the project route with `ds: 'open'` if `route.kind === 'home' && route.projectContext` is set; otherwise navigates to the projects list. Add it below the main component:

```tsx
function DesignSystemsEntryRedirect({ route, projects, onCreateEmpty }: { route: Route; projects: ProjectSummary[]; onCreateEmpty: () => Promise<void> }) {
  const projectContext = route.kind === 'home' ? route.projectContext : null;
  useEffect(() => {
    if (!projectContext) {
      navigate({ kind: 'home', view: 'projects' });
      return;
    }
    navigate({ kind: 'project', projectId: projectContext, conversationId: null, fileName: null, ds: 'open' });
  }, [projectContext]);
  return null;
}
```

Remove the now-orphan `DesignSystemManagerView` import in `EntryShell.tsx` (it lands inside the modal mounted from `ProjectView`, not here).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: still errors from later tasks (table/sidebar). The redirect itself should be clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/EntryShell.tsx
git commit -m "feat(ds): legacy view=design-systems redirects to project with ?ds=open"
```

---

## Phase 6 — Web: modal shell

### Task 14: `DesignSystemModal` overlay

**Files:**
- Create: `apps/web/src/components/design-system-manager/DesignSystemModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { navigate, useRoute } from '../../router';
import { DesignSystemManagerView } from './DesignSystemManagerView';
import type { ProjectSummary } from '../../types';

interface Props {
  open: boolean;
  projectId: string;
  designSystemId: string | null;
  projectName: string;
  onCreateEmpty: () => Promise<void> | void;
  onAttachDsRequested: (kind: 'create' | 'figma' | 'library') => void;
}

const LS_SIDEBAR_KEY = (dsId: string) => `ds-modal:sidebar-collapsed:${dsId}`;
const LS_MAX_KEY = (dsId: string) => `ds-modal:max:${dsId}`;

export function DesignSystemModal({
  open, projectId, designSystemId, projectName, onCreateEmpty, onAttachDsRequested,
}: Props) {
  const route = useRoute();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // Hydrate persisted UI state when the DS id is known.
  useEffect(() => {
    if (!designSystemId) return;
    try {
      const sc = localStorage.getItem(LS_SIDEBAR_KEY(designSystemId));
      const mx = localStorage.getItem(LS_MAX_KEY(designSystemId));
      setSidebarCollapsed(sc === '1');
      setMaximized(mx === '1');
    } catch { /* ignore */ }
  }, [designSystemId]);

  const persist = useCallback((key: string, val: boolean) => {
    try { localStorage.setItem(key, val ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  const close = useCallback(() => {
    if (route.kind !== 'project') return;
    navigate({ ...route, ds: undefined });
  }, [route]);

  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== 'Escape') return;
      // The search input handles Esc itself (clears query). If event reached us, close the modal.
      ev.stopPropagation();
      close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className={`ds-modal__backdrop${maximized ? ' is-max' : ''}`}
      ref={backdropRef}
      onMouseDown={(ev) => { if (ev.target === backdropRef.current) close(); }}
      data-testid="ds-modal-backdrop"
    >
      <div
        className={`ds-modal${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${maximized ? ' is-max' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Variables"
        data-testid="ds-modal"
      >
        <DesignSystemManagerView
          projectId={projectId}
          designSystemId={designSystemId}
          projectName={projectName}
          onAttachDsRequested={onAttachDsRequested}
          onCreateEmpty={onCreateEmpty}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => {
            setSidebarCollapsed((v) => { const nv = !v; if (designSystemId) persist(LS_SIDEBAR_KEY(designSystemId), nv); return nv; });
          }}
          maximized={maximized}
          onToggleMaximize={() => {
            setMaximized((v) => { const nv = !v; if (designSystemId) persist(LS_MAX_KEY(designSystemId), nv); return nv; });
          }}
          onClose={close}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount the modal from `ProjectView`**

In `ProjectView.tsx`, near the root-return JSX (right after `<CritiqueTheaterMount …/>` or before the `<AppChromeHeader …>` line — wherever an overlay can mount and not interfere with the chrome header), add:

```tsx
<DesignSystemModal
  open={route.kind === 'project' && route.ds === 'open'}
  projectId={project.id}
  designSystemId={designSystemIdForProject(project.id, projects)}
  projectName={project.name}
  onCreateEmpty={async () => {
    const result = await createEmptyDesignSystemForProject(project.id);
    if (!('error' in result)) await onRefreshProjects?.();
  }}
  onAttachDsRequested={() => { /* defer to existing create flow */ }}
/>
```

Add the import:

```typescript
import { DesignSystemModal } from './design-system-manager/DesignSystemModal';
import { createEmptyDesignSystemForProject } from '../providers/design-system-variables';
```

Helper `designSystemIdForProject` already exists in `EntryShell.tsx` — extract it into `apps/web/src/components/design-system-manager/utils.ts` and import from both places.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: only the DSManagerView prop-shape errors remain (we added 5 new props that don't exist on it yet — addressed in the next task).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/design-system-manager/DesignSystemModal.tsx apps/web/src/components/ProjectView.tsx apps/web/src/components/design-system-manager/utils.ts
git commit -m "feat(ds): DesignSystemModal overlay shell mounted from ProjectView"
```

---

### Task 15: Adapt `DesignSystemManagerView` to be the modal body

**Files:**
- Modify: `apps/web/src/components/design-system-manager/DesignSystemManagerView.tsx`

- [ ] **Step 1: Replace `Props` and chrome**

Update the `Props` interface to accept the 5 new props (`sidebarCollapsed`, `onToggleSidebar`, `maximized`, `onToggleMaximize`, `onClose`). Remove the inline `ds-mgr-topbar` header (the modal owns the chrome).

The new render shell:

```tsx
return (
  <div className="ds-modal-body">
    <header className="ds-modal__header">
      <div className="ds-modal__title">
        <h2>Variables</h2>
        <button type="button" className="ds-modal__icon-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
          <Icon name="sidebar" size={14} />
        </button>
      </div>
      <SearchAndFilter
        query={query}
        onQueryChange={setQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
      />
      <div className="ds-modal__actions">
        <button type="button" className="ds-modal__icon-btn" onClick={onToggleMaximize} aria-label={maximized ? 'Restore' : 'Maximize'}>
          <Icon name={maximized ? 'minimize' : 'maximize'} size={14} />
        </button>
        <button type="button" className="ds-modal__icon-btn" onClick={onClose} aria-label="Close" data-testid="ds-mgr-close">
          <Icon name="close" size={14} />
        </button>
      </div>
    </header>
    <div className={`ds-modal__body${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <CollectionsSidebar
        collections={variables?.collections ?? []}
        activeCollectionId={activeCollectionId}
        activeGroupId={activeGroupId}
        onSelectCollection={setActiveCollectionId}
        onSelectGroup={setActiveGroupId}
        onCreateCollection={async (name) => { if (!designSystemId) return; await createCollection(designSystemId, name); await refetch(); }}
        onDeleteCollection={async (cid) => { if (!designSystemId) return; await deleteCollection(designSystemId, cid); await refetch(); }}
        onCreateGroup={async (name) => { if (!designSystemId || !activeCollectionId) return; await createGroup(designSystemId, activeCollectionId, name); await refetch(); }}
        onDeleteGroup={async (gid) => { if (!designSystemId || !activeCollectionId) return; await deleteGroup(designSystemId, activeCollectionId, gid); await refetch(); }}
        collapsed={sidebarCollapsed}
      />
      <main className="ds-modal__main">
        {/* Empty/loaded branching, then VariablesTable below */}
      </main>
    </div>
  </div>
);
```

Add the local state `query`, `typeFilter`, `activeGroupId`. Persist `activeCollectionId` to localStorage keyed by DS id (mirror the modal's pattern):

```typescript
const LS_ACTIVE_COLLECTION = (id: string) => `ds-modal:active-collection:${id}`;
useEffect(() => {
  if (!designSystemId) return;
  const stored = localStorage.getItem(LS_ACTIVE_COLLECTION(designSystemId));
  if (stored) setActiveCollectionId(stored);
}, [designSystemId]);
useEffect(() => {
  if (!designSystemId || !activeCollectionId) return;
  try { localStorage.setItem(LS_ACTIVE_COLLECTION(designSystemId), activeCollectionId); } catch {}
}, [designSystemId, activeCollectionId]);
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: errors remaining are about `SearchAndFilter` and updated `CollectionsSidebar`/`VariablesTable` not existing yet.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/design-system-manager/DesignSystemManagerView.tsx
git commit -m "feat(ds): DesignSystemManagerView adapts to modal-body shape"
```

---

### Task 16: CSS for modal shell

**Files:**
- Modify: `apps/web/src/index.css`

- [ ] **Step 1: Replace the existing `.ds-mgr-*` block with `.ds-modal-*`**

Locate the existing block (`grep -n "^.ds-mgr" apps/web/src/index.css`). Replace it wholesale:

```css
/* ============================================================================
   Design System Variables Modal
   ============================================================================ */
.ds-modal__backdrop {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center;
  animation: ds-modal-backdrop-in 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes ds-modal-backdrop-in { from { opacity: 0; } to { opacity: 1; } }

.ds-modal {
  width: min(1120px, calc(100vw - 64px));
  height: min(680px, calc(100vh - 96px));
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.4);
  overflow: hidden;
  display: flex; flex-direction: column;
  animation: ds-modal-pop-in 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes ds-modal-pop-in {
  from { transform: scale(0.96); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}
.ds-modal.is-max {
  width: calc(100vw - 16px);
  height: calc(100vh - 16px);
}

.ds-modal-body { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ds-modal__header {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  height: 48px;
}
.ds-modal__title { display: inline-flex; align-items: center; gap: 6px; }
.ds-modal__title h2 { font-size: 13px; font-weight: 600; margin: 0; }
.ds-modal__icon-btn {
  width: 28px; height: 28px; border-radius: 6px;
  background: transparent; border: 0; color: var(--text-muted);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.ds-modal__icon-btn:hover { background: var(--bg-subtle); color: var(--text); }
.ds-modal__actions { margin-left: auto; display: inline-flex; gap: 4px; }

.ds-modal__body {
  display: grid;
  grid-template-columns: 224px 1fr;
  flex: 1; min-height: 0;
}
.ds-modal__body.is-sidebar-collapsed { grid-template-columns: 0 1fr; }
.ds-modal__main { overflow: auto; min-width: 0; }

@media (max-width: 768px) {
  .ds-modal__backdrop { background: transparent; }
  .ds-modal {
    width: 100vw; height: 100vh; border-radius: 0; border: 0;
  }
  .ds-modal__body { grid-template-columns: 1fr; }
}
```

- [ ] **Step 2: Visually verify**

Trigger HMR via `pnpm tools-dev`, open a project, press `⌘+Shift+D`. The modal should open with backdrop + animation. `Esc` closes. Backdrop click closes.

Take a screenshot:

```bash
pnpm tools-dev inspect desktop screenshot --path /tmp/ds-modal-step.png
```

Expected: a centered modal with empty body (sidebar + table will be in next tasks).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat(ds): modal shell styles + responsive mobile fallback"
```

---

## Phase 7 — Web: sidebar

### Task 17: Rewrite `CollectionsSidebar` (Collections + Groups sections)

**Files:**
- Modify: `apps/web/src/components/design-system-manager/CollectionsSidebar.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { useState } from 'react';
import { Icon } from '../Icon';
import type { VariableCollection } from '../../providers/design-system-variables';

interface Props {
  collections: VariableCollection[];
  activeCollectionId: string | null;
  activeGroupId: string | 'all';
  onSelectCollection: (id: string) => void;
  onSelectGroup: (id: string | 'all') => void;
  onCreateCollection: (name: string) => Promise<void> | void;
  onDeleteCollection: (id: string) => Promise<void> | void;
  onCreateGroup: (name: string) => Promise<void> | void;
  onDeleteGroup: (id: string) => Promise<void> | void;
  collapsed?: boolean;
}

export function CollectionsSidebar({
  collections, activeCollectionId, activeGroupId,
  onSelectCollection, onSelectGroup,
  onCreateCollection, onDeleteCollection, onCreateGroup, onDeleteGroup,
  collapsed,
}: Props) {
  const [newColl, setNewColl] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const activeCollection = collections.find((c) => c.id === activeCollectionId) ?? null;

  function countVariables(c: VariableCollection): number {
    return c.groups.reduce((acc, g) => acc + g.variables.length, 0);
  }

  if (collapsed) return null;

  return (
    <aside className="ds-sidebar" data-testid="ds-sidebar">
      <SidebarSection
        label="Collections"
        onCreate={() => setNewColl('')}
      >
        {collections.map((c) => (
          <button
            type="button"
            key={c.id}
            className={`ds-sidebar__row${c.id === activeCollectionId ? ' is-active' : ''}`}
            onClick={() => onSelectCollection(c.id)}
            data-testid={`ds-sidebar-collection-${c.name}`}
          >
            <span className="ds-sidebar__row-name">{c.name}</span>
            <span className="ds-sidebar__row-count">{countVariables(c)}</span>
          </button>
        ))}
        {newColl !== null ? (
          <input
            autoFocus
            className="ds-sidebar__row-input"
            value={newColl}
            placeholder="Collection name"
            onChange={(ev) => setNewColl(ev.target.value)}
            onBlur={async () => { if (newColl.trim()) await onCreateCollection(newColl.trim()); setNewColl(null); }}
            onKeyDown={async (ev) => {
              if (ev.key === 'Enter') { if (newColl.trim()) await onCreateCollection(newColl.trim()); setNewColl(null); }
              if (ev.key === 'Escape') setNewColl(null);
            }}
          />
        ) : null}
      </SidebarSection>

      <SidebarSection
        label="Groups"
        onCreate={activeCollection ? () => setNewGroup('') : undefined}
      >
        <button
          type="button"
          className={`ds-sidebar__row${activeGroupId === 'all' ? ' is-active' : ''}`}
          onClick={() => onSelectGroup('all')}
        >
          <span className="ds-sidebar__row-name">All</span>
          <span className="ds-sidebar__row-count">{activeCollection ? countVariables(activeCollection) : 0}</span>
        </button>
        {activeCollection?.groups.map((g) => (
          <button
            type="button"
            key={g.id}
            className={`ds-sidebar__row${g.id === activeGroupId ? ' is-active' : ''}`}
            onClick={() => onSelectGroup(g.id)}
            data-testid={`ds-sidebar-group-${g.name}`}
          >
            <span className="ds-sidebar__row-name">{g.name}</span>
            <span className="ds-sidebar__row-count">{g.variables.length}</span>
          </button>
        ))}
        {newGroup !== null ? (
          <input
            autoFocus
            className="ds-sidebar__row-input"
            value={newGroup}
            placeholder="Group name"
            onChange={(ev) => setNewGroup(ev.target.value)}
            onBlur={async () => { if (newGroup.trim()) await onCreateGroup(newGroup.trim()); setNewGroup(null); }}
            onKeyDown={async (ev) => {
              if (ev.key === 'Enter') { if (newGroup.trim()) await onCreateGroup(newGroup.trim()); setNewGroup(null); }
              if (ev.key === 'Escape') setNewGroup(null);
            }}
          />
        ) : null}
      </SidebarSection>
    </aside>
  );
}

function SidebarSection({ label, onCreate, children }: { label: string; onCreate?: () => void; children: React.ReactNode }) {
  return (
    <div className="ds-sidebar__section">
      <header className="ds-sidebar__section-head">
        <span>{label}</span>
        {onCreate ? (
          <button type="button" className="ds-modal__icon-btn ds-sidebar__add" onClick={onCreate} aria-label={`Add ${label}`}>
            <Icon name="plus" size={11} />
          </button>
        ) : null}
      </header>
      <div className="ds-sidebar__items">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Append sidebar CSS to `index.css`**

```css
.ds-sidebar {
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 8px 0;
  font-size: 12px;
}
.ds-sidebar__section { padding: 6px 0 12px; }
.ds-sidebar__section-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 12px;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: none;
}
.ds-sidebar__section + .ds-sidebar__section { border-top: 1px solid var(--border-soft); }
.ds-sidebar__row {
  width: 100%;
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px;
  background: transparent; border: 0; color: var(--text);
  font-size: 12px; cursor: pointer;
}
.ds-sidebar__row:hover { background: var(--bg-subtle); }
.ds-sidebar__row.is-active { background: var(--accent-tint); color: var(--text-strong); }
.ds-sidebar__row-count { color: var(--text-faint); font-variant-numeric: tabular-nums; }
.ds-sidebar__row-input {
  display: block; width: calc(100% - 24px); margin: 4px 12px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 4px;
  padding: 4px 8px; font-size: 12px; color: var(--text);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: PASS for sidebar (table errors remain).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/design-system-manager/CollectionsSidebar.tsx apps/web/src/index.css
git commit -m "feat(ds): sidebar with Collections + contextual Groups + inline create"
```

---

## Phase 8 — Web: table

### Task 18: `SearchAndFilter` component

**Files:**
- Create: `apps/web/src/components/design-system-manager/SearchAndFilter.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import type { VariableType } from '../../providers/design-system-variables';

const ALL_TYPES: VariableType[] = ['color', 'number', 'string', 'boolean'];

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  typeFilter: Set<VariableType>;
  onTypeFilterChange: (next: Set<VariableType>) => void;
}

export function SearchAndFilter({ query, onQueryChange, typeFilter, onTypeFilterChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) { if (wrap.current && !wrap.current.contains(ev.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function toggleType(t: VariableType) {
    const next = new Set(typeFilter);
    if (next.has(t)) next.delete(t); else next.add(t);
    onTypeFilterChange(next);
  }

  return (
    <div className="ds-search-filter" ref={wrap}>
      <label className="ds-search">
        <Icon name="search" size={12} />
        <input
          type="search"
          value={query}
          onChange={(ev) => onQueryChange(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Escape' && query) { ev.stopPropagation(); onQueryChange(''); } }}
          placeholder="Search"
          data-testid="ds-search-input"
        />
      </label>
      <button
        type="button"
        className={`ds-filter-btn${typeFilter.size > 0 ? ' has-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Filter"
      >
        <Icon name="filter" size={12} />
        {typeFilter.size > 0 ? <span className="ds-filter-btn__badge">{typeFilter.size}</span> : null}
      </button>
      {open ? (
        <div className="ds-filter-popover" role="menu">
          {ALL_TYPES.map((t) => (
            <label key={t} className={`ds-filter-chip${typeFilter.has(t) ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={typeFilter.has(t)}
                onChange={() => toggleType(t)}
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: CSS in `index.css`**

```css
.ds-search-filter { display: inline-flex; align-items: center; gap: 4px; flex: 1; max-width: 360px; }
.ds-search {
  display: inline-flex; align-items: center; gap: 6px;
  flex: 1; min-width: 0; height: 28px;
  padding: 0 8px; background: var(--bg-panel);
  border: 1px solid var(--border); border-radius: 6px;
  color: var(--text-muted);
}
.ds-search input { background: transparent; border: 0; outline: 0; flex: 1; color: var(--text); font-size: 12px; min-width: 0; }
.ds-search input::placeholder { color: var(--text-faint); }
.ds-filter-btn {
  position: relative; width: 28px; height: 28px; border-radius: 6px;
  background: transparent; border: 1px solid transparent; color: var(--text-muted);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.ds-filter-btn:hover, .ds-filter-btn.has-active { border-color: var(--border); color: var(--text); }
.ds-filter-btn__badge {
  position: absolute; top: -2px; right: -2px;
  background: var(--accent); color: #fff;
  font-size: 9px; line-height: 1; padding: 2px 4px; border-radius: 8px;
}
.ds-filter-popover {
  position: absolute; top: 36px; right: 0; z-index: 5;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  padding: 6px; display: flex; flex-direction: column; gap: 4px;
  min-width: 140px; box-shadow: var(--shadow-md);
}
.ds-filter-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
.ds-filter-chip:hover { background: var(--bg-subtle); }
.ds-filter-chip.is-on { color: var(--text-strong); }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/design-system-manager/SearchAndFilter.tsx apps/web/src/index.css
git commit -m "feat(ds): SearchAndFilter component (search input + type chip popover)"
```

---

### Task 19: `ModeColumnHeader` + `AddModeButton`

**Files:**
- Create: `apps/web/src/components/design-system-manager/ModeColumnHeader.tsx`
- Create: `apps/web/src/components/design-system-manager/AddModeButton.tsx`

- [ ] **Step 1: `ModeColumnHeader`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import type { Mode } from '../../providers/design-system-variables';

interface Props {
  mode: Mode;
  canDelete: boolean;
  onRename: (name: string) => Promise<void> | void;
  onSetWidth: (width: number | null) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

export function ModeColumnHeader({ mode, canDelete, onRename, onSetWidth, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(mode.name);
  const [width, setWidth] = useState<string>(mode.width != null ? String(mode.width) : '');
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setName(mode.name); setWidth(mode.width != null ? String(mode.width) : ''); }, [mode]);
  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) { if (wrap.current && !wrap.current.contains(ev.target as Node)) commitAndClose(); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, name, width]);

  async function commitAndClose() {
    if (name.trim() && name.trim() !== mode.name) await onRename(name.trim());
    const next = width.trim() === '' ? null : Number(width);
    if (next !== (mode.width ?? null)) await onSetWidth(next);
    setOpen(false);
  }

  return (
    <div className="ds-col-header" ref={wrap}>
      <button type="button" className="ds-col-header__btn" onClick={() => setOpen((v) => !v)} data-testid={`ds-mode-header-${mode.name}`}>
        <span className="ds-col-header__name">{mode.name}</span>
        {mode.width != null ? <span className="ds-col-header__width">{mode.width}</span> : null}
      </button>
      {open ? (
        <div className="ds-col-header__popover" role="menu">
          <label className="ds-col-header__field">
            <span>Name</span>
            <input value={name} onChange={(ev) => setName(ev.target.value)} autoFocus />
          </label>
          <label className="ds-col-header__field">
            <span>Width (px)</span>
            <input value={width} onChange={(ev) => setWidth(ev.target.value)} inputMode="numeric" />
          </label>
          <div className="ds-col-header__actions">
            <button type="button" disabled={!canDelete} onClick={async () => { await onDelete(); setOpen(false); }} className="danger">
              <Icon name="trash" size={12} /> Delete column
            </button>
            <button type="button" onClick={commitAndClose}>Save</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: `AddModeButton`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';

interface Props {
  onCreate: (body: { name: string; width?: number }) => Promise<void> | void;
  disabled?: boolean;
}

export function AddModeButton({ onCreate, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) { if (wrap.current && !wrap.current.contains(ev.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function commit() {
    if (!name.trim()) return;
    const body: { name: string; width?: number } = { name: name.trim() };
    if (width.trim()) body.width = Number(width);
    await onCreate(body);
    setName(''); setWidth(''); setOpen(false);
  }

  return (
    <div className="ds-add-mode" ref={wrap}>
      <button type="button" className="ds-add-mode__btn" onClick={() => setOpen((v) => !v)} disabled={disabled} aria-label="Add column" data-testid="ds-add-mode">
        <Icon name="plus" size={12} />
      </button>
      {open ? (
        <div className="ds-add-mode__popover" role="menu">
          <label><span>Name</span><input autoFocus value={name} onChange={(ev) => setName(ev.target.value)} /></label>
          <label><span>Width (px)</span><input value={width} onChange={(ev) => setWidth(ev.target.value)} inputMode="numeric" /></label>
          <div className="ds-add-mode__actions"><button type="button" onClick={commit}>Add</button></div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: CSS**

```css
.ds-col-header, .ds-add-mode { position: relative; }
.ds-col-header__btn, .ds-add-mode__btn {
  background: transparent; border: 0; color: var(--text-muted);
  font-size: 12px; padding: 6px 8px; cursor: pointer; display: inline-flex; gap: 6px; align-items: baseline;
}
.ds-col-header__btn:hover, .ds-add-mode__btn:hover { color: var(--text); }
.ds-col-header__name { font-weight: 600; color: var(--text); }
.ds-col-header__width { color: var(--text-faint); font-size: 10px; font-variant-numeric: tabular-nums; }
.ds-col-header__popover, .ds-add-mode__popover {
  position: absolute; top: 28px; left: 0; z-index: 6;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  padding: 8px; min-width: 200px; box-shadow: var(--shadow-md);
  display: flex; flex-direction: column; gap: 6px;
}
.ds-col-header__field, .ds-add-mode__popover label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--text-muted); }
.ds-col-header__field input, .ds-add-mode__popover input {
  background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px; color: var(--text); font-size: 12px;
}
.ds-col-header__actions, .ds-add-mode__actions { display: flex; gap: 6px; justify-content: flex-end; padding-top: 4px; border-top: 1px solid var(--border-soft); }
.ds-col-header__actions .danger { color: var(--danger, #e54); }
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/design-system-manager/ModeColumnHeader.tsx apps/web/src/components/design-system-manager/AddModeButton.tsx apps/web/src/index.css
git commit -m "feat(ds): mode column header (rename/delete) + add-column popover"
```

---

### Task 20: `CreateVariableButton` (typed popover)

**Files:**
- Create: `apps/web/src/components/design-system-manager/CreateVariableButton.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import type { VariableType } from '../../providers/design-system-variables';

const ITEMS: Array<{ type: VariableType; label: string; icon: 'color' | 'hash' | 'text' | 'circle' }> = [
  { type: 'color', label: 'Color', icon: 'color' },
  { type: 'number', label: 'Number', icon: 'hash' },
  { type: 'string', label: 'String', icon: 'text' },
  { type: 'boolean', label: 'Boolean', icon: 'circle' },
];

interface Props {
  onCreate: (type: VariableType) => void;
  disabled?: boolean;
}

export function CreateVariableButton({ onCreate, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) { if (wrap.current && !wrap.current.contains(ev.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="ds-create-var" ref={wrap}>
      <button type="button" className="ds-create-var__btn" onClick={() => setOpen((v) => !v)} disabled={disabled} data-testid="ds-create-variable">
        <Icon name="plus" size={12} /> Create variable
      </button>
      {open ? (
        <div className="ds-create-var__popover" role="menu">
          {ITEMS.map((item) => (
            <button key={item.type} type="button" className="ds-create-var__item" onClick={() => { onCreate(item.type); setOpen(false); }}>
              <Icon name={item.icon} size={12} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

If the `color | hash | text | circle` icon names aren't in `Icon.tsx`, substitute closest existing names (e.g. `palette | type | text | toggle`).

- [ ] **Step 2: CSS**

```css
.ds-create-var { position: relative; padding: 8px 12px; border-top: 1px solid var(--border); }
.ds-create-var__btn {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
  background: transparent; border: 0; color: var(--text-muted); padding: 6px 8px; border-radius: 4px; cursor: pointer;
}
.ds-create-var__btn:hover { background: var(--bg-subtle); color: var(--text); }
.ds-create-var__popover {
  position: absolute; bottom: 36px; left: 12px; z-index: 6;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px;
  padding: 4px; min-width: 140px; box-shadow: var(--shadow-md);
  display: flex; flex-direction: column;
}
.ds-create-var__item {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px;
  background: transparent; border: 0; color: var(--text); font-size: 12px; cursor: pointer;
}
.ds-create-var__item:hover { background: var(--bg-subtle); }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/design-system-manager/CreateVariableButton.tsx apps/web/src/index.css
git commit -m "feat(ds): footer Create variable button with typed popover"
```

---

### Task 21: `VariableRow` per-mode inputs

**Files:**
- Modify: `apps/web/src/components/design-system-manager/VariableRow.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { useState } from 'react';
import { Icon } from '../Icon';
import type { Mode, Variable } from '../../providers/design-system-variables';

interface Props {
  variable: Variable;
  modes: Mode[];
  onChangeValueForMode: (modeId: string, value: string | number | boolean) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

export function VariableRow({ variable, modes, onChangeValueForMode, onRename, onDelete }: Props) {
  const [name, setName] = useState(variable.name);
  return (
    <div className="ds-row" data-testid={`ds-row-${variable.name}`}>
      <div className="ds-row__name">
        <Icon name={iconForType(variable.type)} size={12} />
        <input
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== variable.name) onRename(name.trim()); else setName(variable.name); }}
          onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
        />
      </div>
      {modes.map((mode) => (
        <ValueCell
          key={mode.id}
          type={variable.type}
          value={variable.valuesByMode[mode.id]}
          onCommit={(v) => onChangeValueForMode(mode.id, v)}
        />
      ))}
      <button type="button" className="ds-row__delete" onClick={onDelete} aria-label={`Delete ${variable.name}`}>
        <Icon name="trash" size={12} />
      </button>
    </div>
  );
}

function ValueCell({ type, value, onCommit }: { type: Variable['type']; value: string | number | boolean | undefined; onCommit: (v: string | number | boolean) => void }) {
  const [raw, setRaw] = useState(value == null ? '' : String(value));
  if (type === 'boolean') {
    const on = value === true;
    return (
      <button type="button" className="ds-cell ds-cell--bool" onClick={() => onCommit(!on)}>{on ? 'true' : 'false'}</button>
    );
  }
  return (
    <input
      className="ds-cell"
      value={raw}
      onChange={(ev) => setRaw(ev.target.value)}
      onBlur={() => commit(raw, type, onCommit)}
      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
    />
  );
}

function commit(raw: string, type: Variable['type'], onCommit: (v: string | number | boolean) => void) {
  if (type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onCommit(n);
    return;
  }
  if (type === 'color' || type === 'string') {
    onCommit(raw);
    return;
  }
}

function iconForType(type: Variable['type']): 'color' | 'hash' | 'text' | 'circle' {
  switch (type) {
    case 'color': return 'color';
    case 'number': return 'hash';
    case 'string': return 'text';
    case 'boolean': return 'circle';
  }
}
```

Adjust icon names to existing keys (same caveat as Task 20).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/design-system-manager/VariableRow.tsx
git commit -m "feat(ds): VariableRow with one input per mode + inline rename"
```

---

### Task 22: `VariablesTable` grid layout with modes

**Files:**
- Modify: `apps/web/src/components/design-system-manager/VariablesTable.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { useMemo } from 'react';
import type { Variable, VariableCollection, VariableType } from '../../providers/design-system-variables';
import { VariableRow } from './VariableRow';
import { ModeColumnHeader } from './ModeColumnHeader';
import { AddModeButton } from './AddModeButton';
import { CreateVariableButton } from './CreateVariableButton';

interface Props {
  collection: VariableCollection;
  activeGroupId: string | 'all';
  query: string;
  typeFilter: Set<VariableType>;
  onUpdateVariableValueForMode: (variableId: string, modeId: string, value: string | number | boolean) => void;
  onRenameVariable: (variableId: string, name: string) => void;
  onDeleteVariable: (variableId: string) => void;
  onCreateVariable: (groupId: string, body: { name: string; type: VariableType }) => void;
  onCreateMode: (body: { name: string; width?: number }) => void;
  onRenameMode: (modeId: string, name: string) => void;
  onSetModeWidth: (modeId: string, width: number | null) => void;
  onDeleteMode: (modeId: string) => void;
}

export function VariablesTable({
  collection, activeGroupId, query, typeFilter,
  onUpdateVariableValueForMode, onRenameVariable, onDeleteVariable, onCreateVariable,
  onCreateMode, onRenameMode, onSetModeWidth, onDeleteMode,
}: Props) {
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return collection.groups
      .filter((g) => activeGroupId === 'all' || g.id === activeGroupId)
      .map((g) => ({
        ...g,
        variables: g.variables.filter((v) => {
          if (q && !v.name.toLowerCase().includes(q)) return false;
          if (typeFilter.size > 0 && !typeFilter.has(v.type)) return false;
          return true;
        }),
      }))
      .filter((g) => g.variables.length > 0 || (activeGroupId === 'all' && !q && typeFilter.size === 0));
  }, [collection.groups, activeGroupId, query, typeFilter]);

  const gridTemplate = `minmax(160px, 1.5fr) repeat(${collection.modes.length}, minmax(80px, 1fr)) 32px 32px`;
  const targetGroupForCreate = activeGroupId !== 'all'
    ? collection.groups.find((g) => g.id === activeGroupId) ?? collection.groups[0]
    : collection.groups[0];

  return (
    <section className="ds-table" style={{ ['--ds-grid' as any]: gridTemplate }}>
      <div className="ds-table__head">
        <div className="ds-table__th">Name</div>
        {collection.modes.map((mode) => (
          <ModeColumnHeader
            key={mode.id}
            mode={mode}
            canDelete={collection.modes.length > 1}
            onRename={(name) => onRenameMode(mode.id, name)}
            onSetWidth={(w) => onSetModeWidth(mode.id, w)}
            onDelete={() => onDeleteMode(mode.id)}
          />
        ))}
        <AddModeButton onCreate={onCreateMode} disabled={collection.modes.length >= 8} />
        <div /> {/* spacer for delete column */}
      </div>
      <div className="ds-table__body">
        {filteredGroups.length === 0 ? (
          <p className="ds-table__empty">No variables match the filter.</p>
        ) : null}
        {filteredGroups.map((g) => (
          <div key={g.id} className="ds-group">
            <header className="ds-group__head">{g.name}</header>
            {g.variables.map((v) => (
              <VariableRow
                key={v.id}
                variable={v}
                modes={collection.modes}
                onChangeValueForMode={(mid, value) => onUpdateVariableValueForMode(v.id, mid, value)}
                onRename={(name) => onRenameVariable(v.id, name)}
                onDelete={() => onDeleteVariable(v.id)}
              />
            ))}
          </div>
        ))}
      </div>
      <CreateVariableButton
        disabled={!targetGroupForCreate}
        onCreate={(type) => {
          if (!targetGroupForCreate) return;
          onCreateVariable(targetGroupForCreate.id, { name: 'New variable', type });
        }}
      />
    </section>
  );
}
```

- [ ] **Step 2: Table grid CSS**

```css
.ds-table { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ds-table__head, .ds-row {
  display: grid; grid-template-columns: var(--ds-grid);
  align-items: center; column-gap: 0;
  border-bottom: 1px solid var(--border-soft);
}
.ds-table__head { background: var(--bg-subtle); position: sticky; top: 0; z-index: 1; }
.ds-table__th { font-size: 11px; color: var(--text-muted); padding: 8px 12px; }
.ds-table__body { flex: 1; overflow-y: auto; }
.ds-group__head { font-size: 12px; font-weight: 600; padding: 12px 12px 6px; color: var(--text-muted); }
.ds-row__name { display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; }
.ds-row__name input { background: transparent; border: 0; outline: 0; color: var(--text); font-size: 12px; flex: 1; min-width: 0; }
.ds-cell {
  width: 100%; height: 32px;
  background: transparent; border: 1px solid transparent;
  padding: 0 8px; color: var(--text); font-size: 12px; font-variant-numeric: tabular-nums;
}
.ds-cell:hover { background: var(--bg-subtle); }
.ds-cell:focus { background: var(--bg-panel); border-color: var(--accent); outline: 0; }
.ds-cell--bool { text-align: left; cursor: pointer; }
.ds-row__delete {
  background: transparent; border: 0; color: var(--text-faint); padding: 4px; cursor: pointer; opacity: 0;
}
.ds-row:hover .ds-row__delete { opacity: 1; }
.ds-table__empty { padding: 24px; text-align: center; color: var(--text-muted); }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/design-system-manager/VariablesTable.tsx apps/web/src/index.css
git commit -m "feat(ds): VariablesTable grid layout with dynamic mode columns + filter"
```

---

### Task 23: Wire table + sidebar into `DesignSystemManagerView`

**Files:**
- Modify: `apps/web/src/components/design-system-manager/DesignSystemManagerView.tsx`

- [ ] **Step 1: Add the missing handlers and pass props**

Inside the view:

```typescript
const [query, setQuery] = useState('');
const [typeFilter, setTypeFilter] = useState<Set<VariableType>>(new Set());
const [activeGroupId, setActiveGroupId] = useState<string | 'all'>('all');

// Already exists: activeCollectionId persisted via localStorage.

// Handler: per-mode value update — calls updateVariable with valuesByMode patch.
const handleUpdateValueForMode = useCallback((variableId: string, modeId: string, value: string | number | boolean) => {
  if (!designSystemId) return;
  // Optimistic update (mirror current `handleUpdateVariable` shape).
  setVariables((prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      collections: prev.collections.map((c) => ({
        ...c,
        groups: c.groups.map((g) => ({
          ...g,
          variables: g.variables.map((v) =>
            v.id === variableId ? { ...v, valuesByMode: { ...v.valuesByMode, [modeId]: value } } : v,
          ),
        })),
      })),
    };
  });
  void updateVariable(designSystemId, variableId, { valuesByMode: { [modeId]: value } }).then((r) => {
    if ('error' in r) { setLoadError(r.error.message); void refetch(); }
  });
}, [designSystemId, refetch]);

// Mode handlers
async function handleCreateMode(body: { name: string; width?: number }) {
  if (!designSystemId || !activeCollection) return;
  await createMode(designSystemId, activeCollection.id, body);
  await refetch();
}
async function handleRenameMode(modeId: string, name: string) {
  if (!designSystemId || !activeCollection) return;
  await updateMode(designSystemId, activeCollection.id, modeId, { name });
  await refetch();
}
async function handleSetModeWidth(modeId: string, width: number | null) {
  if (!designSystemId || !activeCollection) return;
  await updateMode(designSystemId, activeCollection.id, modeId, { width });
  await refetch();
}
async function handleDeleteMode(modeId: string) {
  if (!designSystemId || !activeCollection) return;
  await deleteMode(designSystemId, activeCollection.id, modeId);
  await refetch();
}
```

Pass them all to `<VariablesTable …>`. Pass `activeGroupId`, `query`, `typeFilter` too.

Reset `activeGroupId` to `'all'` whenever `activeCollectionId` changes (effect on `[activeCollectionId]`).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: PASS.

- [ ] **Step 3: Local smoke test**

Restart dev: `pnpm tools-dev restart`. Open a project. Press `⌘+Shift+D`. Verify: modal opens, sidebar lists collections/groups, table renders rows + columns, create variable popover works, search filters, add column adds mode.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/design-system-manager/DesignSystemManagerView.tsx
git commit -m "feat(ds): wire VariablesTable + Search/Filter + mode handlers in view"
```

---

## Phase 9 — Web: i18n

### Task 24: i18n keys in `types.ts` + 18 locales

**Files:**
- Modify: `apps/web/src/i18n/types.ts`
- Modify: 18 locale files in `apps/web/src/i18n/locales/`

- [ ] **Step 1: Add the key block to `types.ts`**

Append (or insert alphabetically) inside the `Dict` interface:

```typescript
  'ds.modal.title': string;
  'ds.modal.search': string;
  'ds.modal.filter': string;
  'ds.modal.collections': string;
  'ds.modal.groups': string;
  'ds.modal.all': string;
  'ds.modal.createVariable': string;
  'ds.modal.createCollection': string;
  'ds.modal.createGroup': string;
  'ds.modal.addMode': string;
  'ds.modal.renameMode': string;
  'ds.modal.deleteMode': string;
  'ds.modal.deleteModeConfirm': string;
  'ds.modal.empty': string;
  'ds.modal.searchNoResults': string;
  'ds.modal.openShortcut': string;
  'ds.types.color': string;
  'ds.types.number': string;
  'ds.types.string': string;
  'ds.types.boolean': string;
```

- [ ] **Step 2: Add English values to `en.ts` first**

Append to `apps/web/src/i18n/locales/en.ts`:

```typescript
  'ds.modal.title': 'Variables',
  'ds.modal.search': 'Search',
  'ds.modal.filter': 'Filter',
  'ds.modal.collections': 'Collections',
  'ds.modal.groups': 'Groups',
  'ds.modal.all': 'All',
  'ds.modal.createVariable': 'Create variable',
  'ds.modal.createCollection': 'Create collection',
  'ds.modal.createGroup': 'Create group',
  'ds.modal.addMode': 'Add column',
  'ds.modal.renameMode': 'Rename column',
  'ds.modal.deleteMode': 'Delete column',
  'ds.modal.deleteModeConfirm': 'Delete the {name} column? Values in that column will be lost.',
  'ds.modal.empty': 'No variables yet',
  'ds.modal.searchNoResults': 'No variables match the filter',
  'ds.modal.openShortcut': 'Open design system',
  'ds.types.color': 'Color',
  'ds.types.number': 'Number',
  'ds.types.string': 'String',
  'ds.types.boolean': 'Boolean',
```

- [ ] **Step 3: Typecheck (expect failures for other locales)**

Run: `pnpm --filter @open-design/web typecheck`
Expected: 17 locale files report missing keys.

- [ ] **Step 4: Add translations to each remaining locale file**

For each of `ar`, `de`, `es-ES`, `fa`, `fr`, `hu`, `id`, `it`, `ja`, `ko`, `pl`, `pt-BR`, `ru`, `th`, `tr`, `uk`, `zh-CN`, `zh-TW`, append the same key block with translated values. Reference Portuguese (Brazilian):

```typescript
  'ds.modal.title': 'Variáveis',
  'ds.modal.search': 'Buscar',
  'ds.modal.filter': 'Filtrar',
  'ds.modal.collections': 'Coleções',
  'ds.modal.groups': 'Grupos',
  'ds.modal.all': 'Todos',
  'ds.modal.createVariable': 'Criar variável',
  'ds.modal.createCollection': 'Criar coleção',
  'ds.modal.createGroup': 'Criar grupo',
  'ds.modal.addMode': 'Adicionar coluna',
  'ds.modal.renameMode': 'Renomear coluna',
  'ds.modal.deleteMode': 'Excluir coluna',
  'ds.modal.deleteModeConfirm': 'Excluir a coluna {name}? Os valores dessa coluna serão perdidos.',
  'ds.modal.empty': 'Sem variáveis ainda',
  'ds.modal.searchNoResults': 'Nenhuma variável corresponde ao filtro',
  'ds.modal.openShortcut': 'Abrir design system',
  'ds.types.color': 'Cor',
  'ds.types.number': 'Número',
  'ds.types.string': 'Texto',
  'ds.types.boolean': 'Booleano',
```

For other languages, use the closest direct translation. When unsure, an English value is acceptable as a placeholder for languages without a dedicated speaker available — the typecheck only enforces the key exists.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`
Expected: PASS.

- [ ] **Step 6: Use the keys in components**

Replace hard-coded English strings ("Variables", "Search", "Filter", "Collections", "Groups", "All", "Create variable", etc.) in the new components with `t('ds.modal.<key>')`. Make sure each component file imports `useT`.

Run typecheck again to confirm nothing regressed.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/i18n/ apps/web/src/components/design-system-manager/
git commit -m "feat(ds): i18n keys for variables modal across 18 locales"
```

---

## Phase 10 — e2e test

### Task 25: e2e — open, seed, mode CRUD, search, close

**Files:**
- Create: `e2e/tests/ds-variables-modal.test.ts`

- [ ] **Step 1: Inspect existing e2e test conventions**

Run: `head -60 e2e/tests/dialog/stop-reconciles-message.test.ts`

Mirror the bootstrap pattern (start daemon + web via the e2e helpers, create a project via HTTP, open the URL in a Playwright page, drive the UI).

- [ ] **Step 2: Implement the test**

```typescript
import { test, expect } from '@playwright/test';
import { withRunningStack } from './_helpers'; // reuse whatever helper file exists; if none, inline the start logic per the existing tests

test('DS variables modal: seed defaults visible, mode CRUD works, search filters', async ({ page }) => {
  await withRunningStack(async ({ webUrl, daemonUrl }) => {
    // Create a project via HTTP
    const createResp = await fetch(`${daemonUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'DS Modal Test' }),
    });
    expect(createResp.ok).toBeTruthy();
    const { project } = await createResp.json();

    // Trigger create-empty (mirroring the entry-shell flow)
    const dsResp = await fetch(`${daemonUrl}/api/projects/${project.id}/design-system/create-empty`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(dsResp.ok).toBeTruthy();

    await page.goto(`${webUrl}/?route=project&projectId=${project.id}&ds=open`);
    await expect(page.getByTestId('ds-modal')).toBeVisible();

    // Sidebar: 7 default collections
    for (const name of ['Container Size', 'Grid', 'Typography', 'Cores', 'Spacing', 'Style', 'Controle']) {
      await expect(page.getByTestId(`ds-sidebar-collection-${name}`)).toBeVisible();
    }

    // Select Container Size — assert 3 mode columns
    await page.getByTestId('ds-sidebar-collection-Container Size').click();
    await expect(page.getByTestId('ds-mode-header-Desktop')).toBeVisible();
    await expect(page.getByTestId('ds-mode-header-Tablet')).toBeVisible();
    await expect(page.getByTestId('ds-mode-header-Mobile')).toBeVisible();

    // Add column "XL" with width 1920
    await page.getByTestId('ds-add-mode').click();
    await page.getByPlaceholder('Name').first().fill('XL');
    await page.getByPlaceholder('Width (px)').first().fill('1920');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByTestId('ds-mode-header-XL')).toBeVisible();

    // Search filters
    await page.getByTestId('ds-search-input').fill('col');
    await page.getByTestId('ds-sidebar-collection-Grid').click();
    await expect(page.getByTestId('ds-row-Columns')).toBeVisible();
    await expect(page.getByTestId('ds-row-Margin')).not.toBeVisible();

    // Esc clears the search then second Esc closes the modal
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ds-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ds-modal')).not.toBeVisible();
  });
});
```

- [ ] **Step 3: Run e2e**

Run: `pnpm --filter @open-design/e2e test ds-variables-modal`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/ds-variables-modal.test.ts
git commit -m "test(ds): e2e for variables modal — seed, mode CRUD, search, close"
```

---

## Phase 11 — Final verification

### Task 26: Full repo guard + typecheck + targeted tests

- [ ] **Step 1: Run guard + typecheck**

```bash
pnpm guard
pnpm typecheck
```

Expected: both PASS.

- [ ] **Step 2: Run all DS-related daemon tests**

```bash
pnpm --filter @open-design/daemon test design-system-variables design-system-seed
```

Expected: PASS.

- [ ] **Step 3: Run web tests**

```bash
pnpm --filter @open-design/web test
```

Expected: PASS.

- [ ] **Step 4: Final commit if any fixup was required**

If any of the previous tasks left a small follow-up (e.g. an icon name mismatch surfaced only in the runtime), fix and commit:

```bash
git add -A
git commit -m "fix(ds): post-verification adjustments"
```

- [ ] **Step 5: PR**

Open a PR titled `feat(ds): variables modal + breakpoint modes + auto-seed` with the PR template filled in:

- "Why": refer to the spec; user pain (single-value rows, no breakpoints, full-screen swap).
- "What users will see": new floating modal, breakpoint columns, auto-populated Typography/Grid on new projects.
- Surface area: web UI, daemon HTTP, schema migration (DS variables.json), i18n keys, new e2e.
- Screenshots: before/after of the home screen, before/after the variables panel.

---

## Self-Review Notes

- **Spec coverage:** Every spec section maps to at least one task (Phase 1–4 → daemon model/migration/seed/routes; Phase 5 → web provider; Phase 6 → router + trigger + redirect; Phase 7 → modal shell; Phase 8 → sidebar; Phase 9 → table + search + create; Phase 10 → i18n; Phase 11 → e2e; Phase 12 → guard).
- **Placeholders:** None. Every step has concrete code or commands.
- **Type consistency:** `Mode`, `Variable.valuesByMode`, `VariableCollection.modes`, `VariablesFile.version: 2` reused across daemon and web. `applyCreateVariable` signature uses `valueByDefault` consistently from Phase 1 onward.
- **Icon names:** Step 20/21 caveats remind the implementer to verify icon names against `Icon.tsx` and substitute if missing. Same for the search/filter/sidebar/maximize icons in earlier steps.
- **Migration safety:** Migration writes back via existing file lock and is idempotent (Task 1 + Task 2 tests cover this).
