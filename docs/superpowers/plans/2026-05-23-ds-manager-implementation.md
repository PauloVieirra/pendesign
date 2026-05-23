# DS Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the project-scoped Design System Manager (Subproject A from the design doc): a Figma-Variables-style screen at `/design-systems?project=<id>` for browsing, editing, and creating typed variables in the project's DS, with auto-save and a regenerated `tokens.css`.

**Architecture:** A new `variables.json` lives in each DS directory as the editable source of truth. A daemon module reads/writes that file, regenerates `tokens.css` on every save, and exposes CRUD endpoints. The web shell branches on `route.projectContext` to render a new `DesignSystemManagerView` instead of the existing library tab. State is local-first with debounced PUTs against the daemon.

**Tech Stack:** TypeScript (daemon + web), Express routes, React 18 components, `nanoid` for stable ids (or Node's `crypto.randomUUID()` truncated), Node `node:test` for daemon tests, no new web testing harness (existing Playwright covers UI smoke).

**Spec:** `docs/superpowers/specs/2026-05-23-ds-manager-design.md`

---

## File structure

### Daemon (new)
- `apps/daemon/src/design-system-variables.ts` — types, read/write IO, regen `tokens.css`, migration from `tokens.css`, per-DS lock.

### Daemon (modify)
- `apps/daemon/src/static-resource-routes.ts` — register new endpoints.
- `apps/daemon/src/design-system-figma.ts` — write `variables.json` directly on import (preserving Figma collection/group hierarchy).
- `apps/daemon/src/design-systems.ts` — extend `listDesignSystems` to expose `source.projectId` on the summary so the web can filter.

### Daemon (tests, new)
- `apps/daemon/tests/design-system-variables.test.ts` — round-trip IO, migration parser, slug collision handling, CRUD helpers, lock semantics.

### Web (new)
- `apps/web/src/providers/design-system-variables.ts` — typed API client.
- `apps/web/src/components/design-system-manager/DesignSystemManagerView.tsx` — orchestrator.
- `apps/web/src/components/design-system-manager/EmptyState.tsx` — onboarding card.
- `apps/web/src/components/design-system-manager/CollectionsSidebar.tsx` — left rail.
- `apps/web/src/components/design-system-manager/VariablesTable.tsx` — center table.
- `apps/web/src/components/design-system-manager/VariableRow.tsx` — single row + per-type editor.
- `apps/web/src/components/design-system-manager/use-debounced-save.ts` — debounce hook.

### Web (modify)
- `apps/web/src/components/EntryShell.tsx` — branch on `route.projectContext` for the `design-systems` view.
- `apps/web/src/index.css` — styles for new components.
- `apps/web/src/types.ts` — extend `DesignSystemSummary` typing for `source.projectId` (if not already there).

### Specs (modify)
- (none — already in place.)

---

## Task 1: Variable types and read/write IO

**Files:**
- Create: `apps/daemon/src/design-system-variables.ts`
- Test: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 1.1: Write the failing round-trip test**

Create `apps/daemon/tests/design-system-variables.test.ts`:

```ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
```

- [ ] **Step 1.2: Run test, confirm it fails because module is missing**

```bash
cd apps/daemon
pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -20
```

Expected output contains: `Cannot find module './design-system-variables.js'`.

- [ ] **Step 1.3: Implement the minimal module**

Create `apps/daemon/src/design-system-variables.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type VariableType = 'color' | 'number' | 'string' | 'boolean';

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  value: string | number | boolean;
}

export interface VariableGroup {
  id: string;
  name: string;
  variables: Variable[];
}

export interface VariableCollection {
  id: string;
  name: string;
  groups: VariableGroup[];
}

export interface VariablesFile {
  version: 1;
  collections: VariableCollection[];
}

export const VARIABLES_FILE_NAME = 'variables.json';

export async function readVariables(dsDir: string): Promise<VariablesFile | null> {
  try {
    const raw = await readFile(path.join(dsDir, VARIABLES_FILE_NAME), 'utf8');
    const parsed = JSON.parse(raw) as VariablesFile;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.collections)) return parsed;
    return null;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeVariables(dsDir: string, data: VariablesFile): Promise<void> {
  await mkdir(dsDir, { recursive: true });
  await writeFile(path.join(dsDir, VARIABLES_FILE_NAME), JSON.stringify(data, null, 2) + '\n', 'utf8');
}
```

- [ ] **Step 1.4: Run test, confirm pass**

```bash
cd apps/daemon
pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
```

Expected: `# pass 1`.

- [ ] **Step 1.5: Commit**

```bash
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds-manager): variables.json types + read/write IO"
```

---

## Task 2: Stable id generator (deterministic for tests, unique in prod)

**Files:**
- Modify: `apps/daemon/src/design-system-variables.ts`
- Modify: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 2.1: Write the failing uniqueness test**

Append to `apps/daemon/tests/design-system-variables.test.ts`:

```ts
import { newVariableId } from '../src/design-system-variables.js';

test('newVariableId returns unique values across rapid calls', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = newVariableId();
    assert.match(id, /^v_[A-Za-z0-9_-]{8,}$/);
    assert.ok(!seen.has(id), `duplicate id ${id}`);
    seen.add(id);
  }
});
```

- [ ] **Step 2.2: Run, confirm failure**

```bash
cd apps/daemon
pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
```

Expected: `newVariableId is not a function` (or similar).

- [ ] **Step 2.3: Implement `newVariableId` + `newCollectionId` + `newGroupId`**

Append to `apps/daemon/src/design-system-variables.ts`:

```ts
import { randomBytes } from 'node:crypto';

function shortToken(): string {
  return randomBytes(6).toString('base64url');
}

export function newVariableId(): string {
  return `v_${shortToken()}`;
}
export function newCollectionId(): string {
  return `c_${shortToken()}`;
}
export function newGroupId(): string {
  return `g_${shortToken()}`;
}
```

- [ ] **Step 2.4: Confirm pass + commit**

```bash
cd apps/daemon
pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds-manager): stable id generators for variables/collections/groups"
```

Expected: `# pass 2`.

---

## Task 3: Slug + CSS variable name renderer with collision handling

**Files:**
- Modify: `apps/daemon/src/design-system-variables.ts`
- Modify: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 3.1: Write failing tests for renderTokensCss**

Append:

```ts
import { renderTokensCss } from '../src/design-system-variables.js';

test('renderTokensCss emits CSS variables with collection/group/name slugs', () => {
  const css = renderTokensCss({
    version: 1,
    collections: [
      {
        id: 'c_1', name: 'Cores',
        groups: [
          { id: 'g_1', name: 'Orange',
            variables: [
              { id: 'v_1', name: '100', type: 'color', value: '#FDEEE9' },
              { id: 'v_2', name: '200', type: 'color', value: '#FAD8CD' },
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
    version: 1,
    collections: [
      {
        id: 'c_1', name: 'A',
        groups: [{ id: 'g_1', name: 'X',
          variables: [
            { id: 'v_1', name: '100', type: 'color', value: '#ffffff' },
            { id: 'v_2', name: '100', type: 'color', value: '#000000' },
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
    version: 1,
    collections: [{ id: 'c_1', name: 'M', groups: [{ id: 'g_1', name: 'G', variables: [
      { id: 'v_1', name: 'gap', type: 'number', value: 16 },
      { id: 'v_2', name: 'fam', type: 'string', value: 'Inter, sans-serif' },
      { id: 'v_3', name: 'on', type: 'boolean', value: true },
    ] }] }],
  });
  assert.match(css, /--m-g-gap:\s*16px;/);
  assert.match(css, /--m-g-fam:\s*Inter, sans-serif;/);
  assert.match(css, /--m-g-on:\s*1;/);
});
```

- [ ] **Step 3.2: Confirm failure**

```bash
cd apps/daemon && pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -20
```

Expected: `renderTokensCss is not exported` or similar.

- [ ] **Step 3.3: Implement renderer**

Append to `apps/daemon/src/design-system-variables.ts`:

```ts
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

export function renderTokensCss(file: VariablesFile): string {
  const lines: string[] = [
    '/* Generated from variables.json. Edits made here will be overwritten on next save. */',
    ':root {',
  ];
  const used = new Set<string>();
  for (const collection of file.collections) {
    for (const group of collection.groups) {
      for (const variable of group.variables) {
        const baseName = `--${slug(collection.name)}-${slug(group.name)}-${slug(variable.name)}`;
        let name = baseName;
        let suffix = 2;
        while (used.has(name)) {
          name = `${baseName}-${suffix}`;
          suffix += 1;
        }
        used.add(name);
        lines.push(`  ${name}: ${formatValue(variable)};`);
      }
    }
  }
  lines.push('}', '');
  return lines.join('\n');
}

function formatValue(variable: Variable): string {
  if (variable.type === 'color' || variable.type === 'string') {
    return String(variable.value);
  }
  if (variable.type === 'number') {
    return `${Number(variable.value)}px`;
  }
  // boolean → CSS uses 0/1
  return variable.value ? '1' : '0';
}
```

- [ ] **Step 3.4: Confirm pass + commit**

```bash
cd apps/daemon && pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds-manager): tokens.css renderer with collision suffixes"
```

Expected: `# pass 5`.

---

## Task 4: Migration from tokens.css → variables.json

**Files:**
- Modify: `apps/daemon/src/design-system-variables.ts`
- Modify: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 4.1: Write failing tests**

Append:

```ts
import { migrateFromTokensCss } from '../src/design-system-variables.js';

test('migrateFromTokensCss groups color tokens into Colors collection', () => {
  const css = `:root { --color-rausch: #ff385c; --color-ink: #222222; }`;
  const file = migrateFromTokensCss(css);
  const colors = file.collections.find((c) => c.name === 'Colors');
  assert.ok(colors, 'Colors collection missing');
  const flat = colors!.groups.flatMap((g) => g.variables);
  assert.equal(flat.length, 2);
  assert.deepEqual(flat.map((v) => v.value), ['#ff385c', '#222222']);
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
  assert.equal(file.version, 1);
  assert.equal(file.collections.length, 1);
  assert.equal(file.collections[0].name, 'Default');
});
```

- [ ] **Step 4.2: Confirm failure**

```bash
cd apps/daemon && pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
```

- [ ] **Step 4.3: Implement migration parser**

Append:

```ts
const VAR_RE = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

interface MigrationBucket {
  collectionName: string;
  type: VariableType;
  rawValue: string;
  group: string;
  varName: string;
}

function classifyVariable(name: string, rawValue: string): MigrationBucket {
  const value = rawValue.trim();
  // --color-rausch / --color-primary-500 → Colors / <group>
  if (name.startsWith('color-')) {
    const rest = name.slice('color-'.length);
    const parts = rest.split('-');
    const group = parts.length > 1 ? parts[0] : 'Default';
    const varName = parts.length > 1 ? parts.slice(1).join('-') : parts[0];
    return { collectionName: 'Colors', type: 'color', rawValue: value, group: titleCase(group), varName };
  }
  if (name.startsWith('font-')) {
    return { collectionName: 'Typography', type: inferTypoType(name, value), rawValue: value, group: 'Default', varName: name.slice('font-'.length) };
  }
  if (name.startsWith('space-')) {
    return { collectionName: 'Spacing', type: 'number', rawValue: stripPx(value), group: 'Default', varName: name.slice('space-'.length) };
  }
  if (name.startsWith('radius-')) {
    return { collectionName: 'Radii', type: 'number', rawValue: stripPx(value), group: 'Default', varName: name.slice('radius-'.length) };
  }
  if (name.startsWith('shadow-')) {
    return { collectionName: 'Effects', type: 'string', rawValue: value, group: 'Default', varName: name.slice('shadow-'.length) };
  }
  return { collectionName: 'Other', type: guessTypeFromValue(value), rawValue: value, group: 'Default', varName: name };
}

function inferTypoType(name: string, value: string): VariableType {
  if (/family/.test(name)) return 'string';
  return /^[0-9.]+/.test(value.trim()) ? 'number' : 'string';
}

function stripPx(value: string): string {
  const m = /^(-?\d+(?:\.\d+)?)\s*px$/.exec(value.trim());
  return m ? m[1] : value;
}

function guessTypeFromValue(value: string): VariableType {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return 'color';
  if (/^-?\d+(?:\.\d+)?(?:px|rem|em)?$/.test(value)) return 'number';
  if (/^(true|false)$/i.test(value)) return 'boolean';
  return 'string';
}

function coerceValue(type: VariableType, raw: string): string | number | boolean {
  if (type === 'number') {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === 'boolean') return /^true$/i.test(raw.trim());
  return raw;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

export function migrateFromTokensCss(css: string): VariablesFile {
  if (!css || !css.trim()) {
    return {
      version: 1,
      collections: [
        {
          id: newCollectionId(),
          name: 'Default',
          groups: [{ id: newGroupId(), name: 'Default', variables: [] }],
        },
      ],
    };
  }
  const buckets = new Map<string, Map<string, Variable[]>>();
  VAR_RE.lastIndex = 0;
  let match;
  while ((match = VAR_RE.exec(css)) !== null) {
    const [, rawName, rawValue] = match;
    const cls = classifyVariable(rawName, rawValue);
    const variable: Variable = {
      id: newVariableId(),
      name: cls.varName,
      type: cls.type,
      value: coerceValue(cls.type, cls.rawValue),
    };
    const collection = buckets.get(cls.collectionName) ?? new Map<string, Variable[]>();
    const group = collection.get(cls.group) ?? [];
    group.push(variable);
    collection.set(cls.group, group);
    buckets.set(cls.collectionName, collection);
  }
  const collections: VariableCollection[] = [];
  for (const [collectionName, groups] of buckets) {
    const groupArray: VariableGroup[] = [];
    for (const [groupName, variables] of groups) {
      groupArray.push({ id: newGroupId(), name: groupName, variables });
    }
    collections.push({ id: newCollectionId(), name: collectionName, groups: groupArray });
  }
  if (collections.length === 0) {
    collections.push({
      id: newCollectionId(),
      name: 'Default',
      groups: [{ id: newGroupId(), name: 'Default', variables: [] }],
    });
  }
  return { version: 1, collections };
}
```

- [ ] **Step 4.4: Confirm pass + commit**

```bash
cd apps/daemon && pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds-manager): tokens.css → variables.json migration parser"
```

Expected: `# pass 8`.

---

## Task 5: Save flow — write variables.json + regen tokens.css atomically

**Files:**
- Modify: `apps/daemon/src/design-system-variables.ts`
- Modify: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 5.1: Write failing test**

Append:

```ts
import { saveVariables } from '../src/design-system-variables.js';

test('saveVariables writes variables.json AND regenerated tokens.css', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-ds-save-'));
  const file: VariablesFile = {
    version: 1,
    collections: [{ id: 'c_1', name: 'Cores', groups: [{ id: 'g_1', name: 'Orange',
      variables: [{ id: 'v_1', name: '100', type: 'color', value: '#FDEEE9' }],
    }] }],
  };
  await saveVariables(dir, file);
  const json = JSON.parse(await readFile(path.join(dir, 'variables.json'), 'utf8'));
  const css = await readFile(path.join(dir, 'tokens.css'), 'utf8');
  assert.equal(json.collections[0].variables?.[0]?.value ?? json.collections[0].groups[0].variables[0].value, '#FDEEE9');
  assert.match(css, /--cores-orange-100:\s*#FDEEE9;/);
});
```

- [ ] **Step 5.2: Confirm failure**

```bash
cd apps/daemon && pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
```

- [ ] **Step 5.3: Implement `saveVariables`**

Append:

```ts
const TOKENS_CSS_FILE_NAME = 'tokens.css';

export async function saveVariables(dsDir: string, data: VariablesFile): Promise<void> {
  await mkdir(dsDir, { recursive: true });
  await writeFile(path.join(dsDir, VARIABLES_FILE_NAME), JSON.stringify(data, null, 2) + '\n', 'utf8');
  await writeFile(path.join(dsDir, TOKENS_CSS_FILE_NAME), renderTokensCss(data), 'utf8');
}
```

- [ ] **Step 5.4: Confirm pass + commit**

```bash
cd apps/daemon && pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds-manager): saveVariables writes variables.json + regenerates tokens.css"
```

Expected: `# pass 9`.

---

## Task 6: Per-DS async lock

**Files:**
- Modify: `apps/daemon/src/design-system-variables.ts`
- Modify: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 6.1: Write failing concurrency test**

Append:

```ts
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
  // b runs and finishes before a finishes
  assert.deepEqual(events, ['a-start', 'b-start', 'b-end', 'a-end']);
});
```

- [ ] **Step 6.2: Confirm failure**

```bash
cd apps/daemon && pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
```

- [ ] **Step 6.3: Implement lock**

Append:

```ts
const dsLocks = new Map<string, Promise<unknown>>();

export async function withDsLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = dsLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => fn());
  dsLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (dsLocks.get(key) === next) dsLocks.delete(key);
  }
}
```

- [ ] **Step 6.4: Confirm pass + commit**

```bash
cd apps/daemon && pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds-manager): per-DS async lock for serialized writes"
```

Expected: `# pass 11`.

---

## Task 7: Granular mutation helpers (createVariable / updateVariable / deleteVariable / create+deleteGroup / create+deleteCollection)

**Files:**
- Modify: `apps/daemon/src/design-system-variables.ts`
- Modify: `apps/daemon/tests/design-system-variables.test.ts`

- [ ] **Step 7.1: Write failing tests for each helper**

Append:

```ts
import {
  applyCreateCollection,
  applyDeleteCollection,
  applyCreateGroup,
  applyDeleteGroup,
  applyCreateVariable,
  applyUpdateVariable,
  applyDeleteVariable,
} from '../src/design-system-variables.js';

function makeFile(): VariablesFile {
  return {
    version: 1,
    collections: [
      { id: 'c_1', name: 'Cores', groups: [
        { id: 'g_1', name: 'Orange', variables: [
          { id: 'v_1', name: '100', type: 'color', value: '#aaaaaa' },
        ] },
      ] },
    ],
  };
}

test('applyCreateCollection appends a collection with a default group', () => {
  const next = applyCreateCollection(makeFile(), { name: 'Spacing' });
  assert.equal(next.collections.length, 2);
  assert.equal(next.collections[1].name, 'Spacing');
  assert.equal(next.collections[1].groups.length, 1);
});

test('applyDeleteCollection removes by id', () => {
  const next = applyDeleteCollection(makeFile(), { collectionId: 'c_1' });
  assert.equal(next.collections.length, 0);
});

test('applyCreateGroup adds a group to the target collection', () => {
  const next = applyCreateGroup(makeFile(), { collectionId: 'c_1', name: 'Blue' });
  assert.equal(next.collections[0].groups.length, 2);
  assert.equal(next.collections[0].groups[1].name, 'Blue');
});

test('applyDeleteGroup removes a group by id', () => {
  const next = applyDeleteGroup(makeFile(), { collectionId: 'c_1', groupId: 'g_1' });
  assert.equal(next.collections[0].groups.length, 0);
});

test('applyCreateVariable appends to the target group', () => {
  const next = applyCreateVariable(makeFile(), {
    collectionId: 'c_1', groupId: 'g_1',
    name: '200', type: 'color', value: '#bbbbbb',
  });
  assert.equal(next.collections[0].groups[0].variables.length, 2);
});

test('applyUpdateVariable changes value by id', () => {
  const next = applyUpdateVariable(makeFile(), { variableId: 'v_1', patch: { value: '#cccccc' } });
  assert.equal(next.collections[0].groups[0].variables[0].value, '#cccccc');
});

test('applyDeleteVariable removes by id', () => {
  const next = applyDeleteVariable(makeFile(), { variableId: 'v_1' });
  assert.equal(next.collections[0].groups[0].variables.length, 0);
});
```

- [ ] **Step 7.2: Confirm failure**

```bash
cd apps/daemon && pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
```

- [ ] **Step 7.3: Implement helpers**

Append:

```ts
export function applyCreateCollection(file: VariablesFile, params: { name: string }): VariablesFile {
  const next = clone(file);
  next.collections.push({
    id: newCollectionId(),
    name: params.name.trim() || 'New collection',
    groups: [{ id: newGroupId(), name: 'Default', variables: [] }],
  });
  return next;
}

export function applyDeleteCollection(file: VariablesFile, params: { collectionId: string }): VariablesFile {
  const next = clone(file);
  next.collections = next.collections.filter((c) => c.id !== params.collectionId);
  return next;
}

export function applyCreateGroup(file: VariablesFile, params: { collectionId: string; name: string }): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection ${params.collectionId} not found`);
  collection.groups.push({ id: newGroupId(), name: params.name.trim() || 'New group', variables: [] });
  return next;
}

export function applyDeleteGroup(file: VariablesFile, params: { collectionId: string; groupId: string }): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection ${params.collectionId} not found`);
  collection.groups = collection.groups.filter((g) => g.id !== params.groupId);
  return next;
}

export function applyCreateVariable(file: VariablesFile, params: { collectionId: string; groupId: string; name: string; type: VariableType; value: Variable['value'] }): VariablesFile {
  const next = clone(file);
  const collection = next.collections.find((c) => c.id === params.collectionId);
  if (!collection) throw new VariablesError('NOT_FOUND', `collection ${params.collectionId} not found`);
  const group = collection.groups.find((g) => g.id === params.groupId);
  if (!group) throw new VariablesError('NOT_FOUND', `group ${params.groupId} not found`);
  group.variables.push({ id: newVariableId(), name: params.name, type: params.type, value: params.value });
  return next;
}

export function applyUpdateVariable(file: VariablesFile, params: { variableId: string; patch: Partial<Pick<Variable, 'name' | 'type' | 'value'>> }): VariablesFile {
  const next = clone(file);
  for (const collection of next.collections) {
    for (const group of collection.groups) {
      const idx = group.variables.findIndex((v) => v.id === params.variableId);
      if (idx >= 0) {
        group.variables[idx] = { ...group.variables[idx], ...params.patch } as Variable;
        return next;
      }
    }
  }
  throw new VariablesError('NOT_FOUND', `variable ${params.variableId} not found`);
}

export function applyDeleteVariable(file: VariablesFile, params: { variableId: string }): VariablesFile {
  const next = clone(file);
  for (const collection of next.collections) {
    for (const group of collection.groups) {
      group.variables = group.variables.filter((v) => v.id !== params.variableId);
    }
  }
  return next;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class VariablesError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'BAD_REQUEST', message: string) {
    super(message);
    this.name = 'VariablesError';
  }
}
```

- [ ] **Step 7.4: Confirm pass + commit**

```bash
cd apps/daemon && pnpm exec tsx --test tests/design-system-variables.test.ts 2>&1 | tail -10
git add apps/daemon/src/design-system-variables.ts apps/daemon/tests/design-system-variables.test.ts
git commit -m "feat(ds-manager): granular CRUD helpers (collection/group/variable)"
```

Expected: `# pass 18`.

---

## Task 8: Daemon endpoint — GET /api/design-systems/:id/variables (with auto-migration)

**Files:**
- Modify: `apps/daemon/src/static-resource-routes.ts`

- [ ] **Step 8.1: Add the import**

In `apps/daemon/src/static-resource-routes.ts`, find the existing import block (lines around 17-25) and add:

```ts
import {
  migrateFromTokensCss,
  readVariables,
  saveVariables,
  withDsLock,
  type VariablesFile,
} from './design-system-variables.js';
```

- [ ] **Step 8.2: Add helper to resolve DS dir from id**

Above the route declarations (near line 593), add:

```ts
import { readFile as fsReadFile } from 'node:fs/promises';

async function resolveDsDir(id: string): Promise<{ dir: string; key: string } | null> {
  // The catalog lists user-owned DSs with a `user:` id prefix; the
  // on-disk directory is the bare slug. Built-in DSs are not editable
  // through this endpoint.
  if (!id.startsWith('user:')) return null;
  const dirName = id.slice('user:'.length);
  if (!/^[a-z0-9-]+$/.test(dirName)) return null;
  const dir = path.join(USER_DESIGN_SYSTEMS_DIR, dirName);
  try {
    const stats = fs.statSync(dir);
    if (!stats.isDirectory()) return null;
  } catch {
    return null;
  }
  return { dir, key: id };
}
```

- [ ] **Step 8.3: Register GET /variables**

After the existing `/api/design-systems/:id/showcase` endpoint, add:

```ts
app.get('/api/design-systems/:id/variables', async (req, res) => {
  if (!requireLocalOrigin(req, res)) return;
  try {
    const resolved = await resolveDsDir(req.params.id);
    if (!resolved) {
      return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found or not editable: ${req.params.id}`);
    }
    const existing = await readVariables(resolved.dir);
    if (existing) return res.json({ variables: existing });
    let tokensCss = '';
    try {
      tokensCss = await fsReadFile(path.join(resolved.dir, 'tokens.css'), 'utf8');
    } catch { /* tokens.css may not exist for empty DSs */ }
    const migrated = migrateFromTokensCss(tokensCss);
    await withDsLock(resolved.key, () => saveVariables(resolved.dir, migrated));
    res.json({ variables: migrated, migrated: true });
  } catch (err: any) {
    sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message ?? err));
  }
});
```

- [ ] **Step 8.4: Build daemon and verify it starts**

```bash
pnpm --filter @open-design/daemon build 2>&1 | tail -5
pnpm tools-dev restart 2>&1 | tail -5
```

Expected: build succeeds, daemon prints "started".

- [ ] **Step 8.5: Curl-test against an existing imported DS**

```bash
# Find a user-prefixed DS id:
curl -sS http://127.0.0.1:$(pnpm tools-dev status --json | python3 -c 'import sys, json; print(json.load(sys.stdin)["apps"]["daemon"]["url"].split(":")[-1])')/api/design-systems | python3 -c 'import sys, json; d=json.load(sys.stdin); [print(s["id"]) for s in d["designSystems"] if s["id"].startswith("user:")]'
```

Pick one user id, then:

```bash
DS_ID=user:<copy-the-id>
PORT=$(pnpm tools-dev status --json | python3 -c 'import sys, json; print(json.load(sys.stdin)["apps"]["daemon"]["url"].split(":")[-1])')
curl -sS "http://127.0.0.1:$PORT/api/design-systems/$DS_ID/variables" | python3 -m json.tool | head -30
```

Expected: a JSON envelope `{ "variables": { "version": 1, "collections": [...] }, "migrated": true }`.

- [ ] **Step 8.6: Commit**

```bash
git add apps/daemon/src/static-resource-routes.ts
git commit -m "feat(ds-manager): GET /api/design-systems/:id/variables with auto-migration"
```

---

## Task 9: Daemon endpoint — PUT /variables (replace entire file)

**Files:**
- Modify: `apps/daemon/src/static-resource-routes.ts`

- [ ] **Step 9.1: Add PUT handler**

After the GET handler from Task 8, add:

```ts
app.put('/api/design-systems/:id/variables', async (req, res) => {
  if (!requireLocalOrigin(req, res)) return;
  try {
    const resolved = await resolveDsDir(req.params.id);
    if (!resolved) {
      return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found or not editable: ${req.params.id}`);
    }
    const body = req.body as VariablesFile | undefined;
    if (!body || body.version !== 1 || !Array.isArray(body.collections)) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'request body must be a VariablesFile { version: 1, collections: [...] }');
    }
    await withDsLock(resolved.key, () => saveVariables(resolved.dir, body));
    res.json({ variables: body });
  } catch (err: any) {
    sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message ?? err));
  }
});
```

- [ ] **Step 9.2: Rebuild + restart + smoke-test**

```bash
pnpm --filter @open-design/daemon build 2>&1 | tail -3
pnpm tools-dev restart 2>&1 | tail -3
```

Then:

```bash
PORT=$(pnpm tools-dev status --json | python3 -c 'import sys, json; print(json.load(sys.stdin)["apps"]["daemon"]["url"].split(":")[-1])')
# Read current, modify, write back:
curl -sS "http://127.0.0.1:$PORT/api/design-systems/$DS_ID/variables" | python3 -c '
import sys, json
data = json.load(sys.stdin)["variables"]
print(json.dumps(data))' > /tmp/ds-vars.json
curl -sS -X PUT -H "Content-Type: application/json" --data @/tmp/ds-vars.json "http://127.0.0.1:$PORT/api/design-systems/$DS_ID/variables" | python3 -m json.tool | head -10
```

Expected: response echoes the same payload.

- [ ] **Step 9.3: Commit**

```bash
git add apps/daemon/src/static-resource-routes.ts
git commit -m "feat(ds-manager): PUT /api/design-systems/:id/variables (whole-document replace)"
```

---

## Task 10: Daemon endpoints — granular per-variable / per-group / per-collection CRUD

**Files:**
- Modify: `apps/daemon/src/static-resource-routes.ts`

- [ ] **Step 10.1: Add the granular handlers**

After the PUT handler, add:

```ts
import {
  applyCreateCollection,
  applyDeleteCollection,
  applyCreateGroup,
  applyDeleteGroup,
  applyCreateVariable,
  applyUpdateVariable,
  applyDeleteVariable,
  VariablesError,
} from './design-system-variables.js';

async function loadOrMigrate(dir: string, key: string): Promise<VariablesFile> {
  const existing = await readVariables(dir);
  if (existing) return existing;
  let css = '';
  try { css = await fsReadFile(path.join(dir, 'tokens.css'), 'utf8'); } catch {}
  const migrated = migrateFromTokensCss(css);
  await withDsLock(key, () => saveVariables(dir, migrated));
  return migrated;
}

function variablesErrorToStatus(err: unknown): { status: number; code: string; message: string } | null {
  if (err instanceof VariablesError) {
    return { status: err.code === 'NOT_FOUND' ? 404 : 400, code: err.code, message: err.message };
  }
  return null;
}

app.put('/api/design-systems/:id/variables/:variableId', async (req, res) => {
  if (!requireLocalOrigin(req, res)) return;
  try {
    const resolved = await resolveDsDir(req.params.id);
    if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
    const patch = req.body as Partial<{ name: string; type: string; value: unknown }>;
    if (!patch || typeof patch !== 'object') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'patch body required');
    }
    await withDsLock(resolved.key, async () => {
      const current = await loadOrMigrate(resolved.dir, resolved.key);
      const next = applyUpdateVariable(current, { variableId: req.params.variableId, patch: patch as any });
      await saveVariables(resolved.dir, next);
      return next;
    }).then(() => res.json({ ok: true }));
  } catch (err) {
    const mapped = variablesErrorToStatus(err);
    if (mapped) return sendApiError(res, mapped.status, mapped.code, mapped.message);
    sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
  }
});

app.delete('/api/design-systems/:id/variables/:variableId', async (req, res) => {
  if (!requireLocalOrigin(req, res)) return;
  try {
    const resolved = await resolveDsDir(req.params.id);
    if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
    await withDsLock(resolved.key, async () => {
      const current = await loadOrMigrate(resolved.dir, resolved.key);
      const next = applyDeleteVariable(current, { variableId: req.params.variableId });
      await saveVariables(resolved.dir, next);
    });
    res.json({ ok: true });
  } catch (err) {
    sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
  }
});

app.post('/api/design-systems/:id/variables/collections', async (req, res) => {
  if (!requireLocalOrigin(req, res)) return;
  try {
    const resolved = await resolveDsDir(req.params.id);
    if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return sendApiError(res, 400, 'BAD_REQUEST', 'collection name required');
    await withDsLock(resolved.key, async () => {
      const current = await loadOrMigrate(resolved.dir, resolved.key);
      const next = applyCreateCollection(current, { name });
      await saveVariables(resolved.dir, next);
    });
    res.json({ ok: true });
  } catch (err) {
    sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
  }
});

app.delete('/api/design-systems/:id/variables/collections/:collectionId', async (req, res) => {
  if (!requireLocalOrigin(req, res)) return;
  try {
    const resolved = await resolveDsDir(req.params.id);
    if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
    await withDsLock(resolved.key, async () => {
      const current = await loadOrMigrate(resolved.dir, resolved.key);
      const next = applyDeleteCollection(current, { collectionId: req.params.collectionId });
      await saveVariables(resolved.dir, next);
    });
    res.json({ ok: true });
  } catch (err) {
    sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
  }
});

app.post('/api/design-systems/:id/variables/collections/:collectionId/groups', async (req, res) => {
  if (!requireLocalOrigin(req, res)) return;
  try {
    const resolved = await resolveDsDir(req.params.id);
    if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return sendApiError(res, 400, 'BAD_REQUEST', 'group name required');
    await withDsLock(resolved.key, async () => {
      const current = await loadOrMigrate(resolved.dir, resolved.key);
      const next = applyCreateGroup(current, { collectionId: req.params.collectionId, name });
      await saveVariables(resolved.dir, next);
    });
    res.json({ ok: true });
  } catch (err) {
    const mapped = variablesErrorToStatus(err);
    if (mapped) return sendApiError(res, mapped.status, mapped.code, mapped.message);
    sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
  }
});

app.delete('/api/design-systems/:id/variables/collections/:collectionId/groups/:groupId', async (req, res) => {
  if (!requireLocalOrigin(req, res)) return;
  try {
    const resolved = await resolveDsDir(req.params.id);
    if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
    await withDsLock(resolved.key, async () => {
      const current = await loadOrMigrate(resolved.dir, resolved.key);
      const next = applyDeleteGroup(current, {
        collectionId: req.params.collectionId,
        groupId: req.params.groupId,
      });
      await saveVariables(resolved.dir, next);
    });
    res.json({ ok: true });
  } catch (err) {
    const mapped = variablesErrorToStatus(err);
    if (mapped) return sendApiError(res, mapped.status, mapped.code, mapped.message);
    sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
  }
});

app.post('/api/design-systems/:id/variables/collections/:collectionId/groups/:groupId/variables', async (req, res) => {
  if (!requireLocalOrigin(req, res)) return;
  try {
    const resolved = await resolveDsDir(req.params.id);
    if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
    const { name, type, value } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) return sendApiError(res, 400, 'BAD_REQUEST', 'variable name required');
    if (!['color', 'number', 'string', 'boolean'].includes(type)) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'type must be color | number | string | boolean');
    }
    await withDsLock(resolved.key, async () => {
      const current = await loadOrMigrate(resolved.dir, resolved.key);
      const next = applyCreateVariable(current, {
        collectionId: req.params.collectionId,
        groupId: req.params.groupId,
        name: name.trim(),
        type,
        value,
      });
      await saveVariables(resolved.dir, next);
    });
    res.json({ ok: true });
  } catch (err) {
    const mapped = variablesErrorToStatus(err);
    if (mapped) return sendApiError(res, mapped.status, mapped.code, mapped.message);
    sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
  }
});
```

- [ ] **Step 10.2: Rebuild + restart**

```bash
pnpm --filter @open-design/daemon build 2>&1 | tail -3
pnpm tools-dev restart 2>&1 | tail -3
```

- [ ] **Step 10.3: Curl-test the per-variable PUT**

```bash
PORT=$(pnpm tools-dev status --json | python3 -c 'import sys, json; print(json.load(sys.stdin)["apps"]["daemon"]["url"].split(":")[-1])')
# Pick the first variable id:
VAR_ID=$(curl -sS "http://127.0.0.1:$PORT/api/design-systems/$DS_ID/variables" | python3 -c 'import sys, json; d=json.load(sys.stdin)["variables"]; print(d["collections"][0]["groups"][0]["variables"][0]["id"])')
curl -sS -X PUT -H "Content-Type: application/json" --data '{"value":"#abcdef"}' "http://127.0.0.1:$PORT/api/design-systems/$DS_ID/variables/$VAR_ID"
# Confirm tokens.css was regenerated:
curl -sS "http://127.0.0.1:$PORT/api/design-systems/$DS_ID/showcase" | head -20 || true
```

Expected: PUT returns `{"ok":true}`. The DS dir's `tokens.css` now contains `#abcdef`.

- [ ] **Step 10.4: Commit**

```bash
git add apps/daemon/src/static-resource-routes.ts
git commit -m "feat(ds-manager): granular variable/group/collection CRUD endpoints"
```

---

## Task 11: Web — typed API client

**Files:**
- Create: `apps/web/src/providers/design-system-variables.ts`

- [ ] **Step 11.1: Create the client module**

```ts
import type { ApiErrorEnvelope } from './registry';

export type VariableType = 'color' | 'number' | 'string' | 'boolean';

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  value: string | number | boolean;
}

export interface VariableGroup {
  id: string;
  name: string;
  variables: Variable[];
}

export interface VariableCollection {
  id: string;
  name: string;
  groups: VariableGroup[];
}

export interface VariablesFile {
  version: 1;
  collections: VariableCollection[];
}

interface ErrorResult { error: { code?: string; message: string } }

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T | ErrorResult> {
  try {
    const resp = await fetch(input, init);
    if (!resp.ok) {
      const body = (await resp.json().catch(() => null)) as ApiErrorEnvelope | null;
      const err = body?.error;
      if (typeof err === 'object' && err !== null) return { error: { code: (err as any).code, message: (err as any).message } };
      return { error: { message: typeof err === 'string' ? err : `${resp.status} ${resp.statusText}` } };
    }
    return (await resp.json()) as T;
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'request failed' } };
  }
}

export function fetchVariables(dsId: string) {
  return jsonFetch<{ variables: VariablesFile; migrated?: boolean }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables`,
  );
}

export function updateVariable(dsId: string, variableId: string, patch: Partial<Pick<Variable, 'name' | 'type' | 'value'>>) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/${encodeURIComponent(variableId)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
  );
}

export function deleteVariable(dsId: string, variableId: string) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/${encodeURIComponent(variableId)}`,
    { method: 'DELETE' },
  );
}

export function createVariable(dsId: string, collectionId: string, groupId: string, body: { name: string; type: VariableType; value: Variable['value'] }) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/collections/${encodeURIComponent(collectionId)}/groups/${encodeURIComponent(groupId)}/variables`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

export function createCollection(dsId: string, name: string) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/collections`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
  );
}

export function deleteCollection(dsId: string, collectionId: string) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/collections/${encodeURIComponent(collectionId)}`,
    { method: 'DELETE' },
  );
}

export function createGroup(dsId: string, collectionId: string, name: string) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/collections/${encodeURIComponent(collectionId)}/groups`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
  );
}

export function deleteGroup(dsId: string, collectionId: string, groupId: string) {
  return jsonFetch<{ ok: true }>(
    `/api/design-systems/${encodeURIComponent(dsId)}/variables/collections/${encodeURIComponent(collectionId)}/groups/${encodeURIComponent(groupId)}`,
    { method: 'DELETE' },
  );
}
```

- [ ] **Step 11.2: Add `ApiErrorEnvelope` to registry.ts if not already exported**

Check `apps/web/src/providers/registry.ts` for an exported type. If absent, append:

```ts
export interface ApiErrorEnvelope {
  error?: { code?: string; message?: string } | string;
}
```

- [ ] **Step 11.3: Commit**

```bash
git add apps/web/src/providers/design-system-variables.ts apps/web/src/providers/registry.ts
git commit -m "feat(ds-manager): typed web client for variables endpoints"
```

---

## Task 12: Web — debounce hook

**Files:**
- Create: `apps/web/src/components/design-system-manager/use-debounced-save.ts`

- [ ] **Step 12.1: Implement the hook**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Debounced save trigger. The component calls `schedule()` with the
 * current draft on every keystroke; the hook fires the underlying
 * save callback at most every `delay` ms (default 600). Returns the
 * current save state for the header indicator.
 */
export function useDebouncedSave<T>(
  saveFn: (value: T) => Promise<{ ok: true } | { error: { message: string } }>,
  delay = 600,
): {
  schedule: (value: T) => void;
  state: SaveState;
  flush: () => void;
} {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<number | null>(null);
  const pending = useRef<T | null>(null);

  const flush = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const value = pending.current;
    if (value == null) return;
    pending.current = null;
    setState('saving');
    void saveFn(value).then((result) => {
      setState('error' in result ? 'error' : 'saved');
    });
  }, [saveFn]);

  const schedule = useCallback((value: T) => {
    pending.current = value;
    setState('saving');
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  }, [delay, flush]);

  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);

  return { schedule, state, flush };
}
```

- [ ] **Step 12.2: Commit**

```bash
git add apps/web/src/components/design-system-manager/use-debounced-save.ts
git commit -m "feat(ds-manager): useDebouncedSave hook for auto-save"
```

Expected: clean commit.

---

## Task 13: Web — empty state component

**Files:**
- Create: `apps/web/src/components/design-system-manager/EmptyState.tsx`

- [ ] **Step 13.1: Implement**

```tsx
import { useState } from 'react';
import { Icon } from '../Icon';

interface Props {
  projectName: string;
  onPickFromLibrary: () => void;
  onImportFromFigma: () => void;
  onCreateNew: () => void;
}

export function DesignSystemEmptyState({
  projectName,
  onPickFromLibrary,
  onImportFromFigma,
  onCreateNew,
}: Props) {
  return (
    <div className="ds-mgr-empty">
      <h2>This project has no design system yet</h2>
      <p>
        Attach a design system to <strong>{projectName}</strong> to define
        colors, typography, spacing, and other tokens that the project's
        screens can bind to. The design system is exclusive to this project.
      </p>
      <div className="ds-mgr-empty__actions">
        <button type="button" className="primary" onClick={onCreateNew} data-testid="ds-mgr-create-new">
          <Icon name="plus" size={14} /> Create new
        </button>
        <button type="button" onClick={onImportFromFigma} data-testid="ds-mgr-import-figma">
          Import from Figma
        </button>
        <button type="button" onClick={onPickFromLibrary} data-testid="ds-mgr-pick-library">
          Pick from library
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.2: Commit**

```bash
git add apps/web/src/components/design-system-manager/EmptyState.tsx
git commit -m "feat(ds-manager): empty-state component"
```

---

## Task 14: Web — type-specific editors (color/number/string/boolean)

**Files:**
- Create: `apps/web/src/components/design-system-manager/VariableEditors.tsx`

- [ ] **Step 14.1: Implement**

```tsx
import { useId } from 'react';

interface BaseProps<T> {
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function ColorEditor({ value, onChange, disabled }: BaseProps<string>) {
  const id = useId();
  return (
    <div className="ds-mgr-editor ds-mgr-editor-color">
      <input
        type="color"
        value={normalizeHex(value)}
        onChange={(ev) => onChange(ev.target.value)}
        disabled={disabled}
        aria-labelledby={id}
      />
      <input
        id={id}
        type="text"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        placeholder="#000000"
        spellCheck={false}
        disabled={disabled}
      />
    </div>
  );
}

export function NumberEditor({ value, onChange, disabled }: BaseProps<number>) {
  return (
    <input
      className="ds-mgr-editor ds-mgr-editor-number"
      type="number"
      step="0.5"
      value={Number.isFinite(value) ? value : 0}
      onChange={(ev) => onChange(Number(ev.target.value))}
      disabled={disabled}
    />
  );
}

export function StringEditor({ value, onChange, disabled }: BaseProps<string>) {
  return (
    <input
      className="ds-mgr-editor ds-mgr-editor-string"
      type="text"
      value={value}
      onChange={(ev) => onChange(ev.target.value)}
      disabled={disabled}
    />
  );
}

export function BooleanEditor({ value, onChange, disabled }: BaseProps<boolean>) {
  return (
    <label className="ds-mgr-editor ds-mgr-editor-boolean">
      <input
        type="checkbox"
        checked={value}
        onChange={(ev) => onChange(ev.target.checked)}
        disabled={disabled}
      />
      <span>{value ? 'true' : 'false'}</span>
    </label>
  );
}

function normalizeHex(value: string): string {
  // <input type="color"> rejects #fff and #ffaabb-style inputs without padding.
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return '#000000';
}
```

- [ ] **Step 14.2: Commit**

```bash
git add apps/web/src/components/design-system-manager/VariableEditors.tsx
git commit -m "feat(ds-manager): per-type variable editors"
```

---

## Task 15: Web — single VariableRow component

**Files:**
- Create: `apps/web/src/components/design-system-manager/VariableRow.tsx`

- [ ] **Step 15.1: Implement**

```tsx
import { useState } from 'react';
import type { Variable, VariableType } from '../../providers/design-system-variables';
import { Icon } from '../Icon';
import {
  BooleanEditor,
  ColorEditor,
  NumberEditor,
  StringEditor,
} from './VariableEditors';

interface Props {
  variable: Variable;
  onChangeValue: (next: Variable['value']) => void;
  onRename: (nextName: string) => void;
  onChangeType: (nextType: VariableType) => void;
  onDelete: () => void;
}

export function VariableRow({
  variable,
  onChangeValue,
  onRename,
  onChangeType,
  onDelete,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(variable.name);

  function commitRename() {
    setRenaming(false);
    if (draftName.trim() && draftName !== variable.name) onRename(draftName.trim());
    else setDraftName(variable.name);
  }

  return (
    <tr className="ds-mgr-row" data-testid={`ds-mgr-var-${variable.id}`}>
      <td className="ds-mgr-row__name">
        {renaming ? (
          <input
            autoFocus
            type="text"
            value={draftName}
            onChange={(ev) => setDraftName(ev.target.value)}
            onBlur={commitRename}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') commitRename();
              if (ev.key === 'Escape') { setRenaming(false); setDraftName(variable.name); }
            }}
          />
        ) : (
          <button type="button" className="ds-mgr-row__name-btn" onClick={() => setRenaming(true)}>
            {variable.name}
          </button>
        )}
      </td>
      <td className="ds-mgr-row__value">
        {variable.type === 'color' ? (
          <ColorEditor value={String(variable.value)} onChange={onChangeValue} />
        ) : variable.type === 'number' ? (
          <NumberEditor value={Number(variable.value)} onChange={onChangeValue} />
        ) : variable.type === 'string' ? (
          <StringEditor value={String(variable.value)} onChange={onChangeValue} />
        ) : (
          <BooleanEditor value={Boolean(variable.value)} onChange={onChangeValue} />
        )}
      </td>
      <td className="ds-mgr-row__type">
        <select value={variable.type} onChange={(ev) => onChangeType(ev.target.value as VariableType)}>
          <option value="color">color</option>
          <option value="number">number</option>
          <option value="string">string</option>
          <option value="boolean">boolean</option>
        </select>
      </td>
      <td className="ds-mgr-row__actions">
        <button type="button" className="ghost" onClick={onDelete} aria-label={`Delete ${variable.name}`}>
          <Icon name="trash" size={13} />
        </button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 15.2: Commit**

```bash
git add apps/web/src/components/design-system-manager/VariableRow.tsx
git commit -m "feat(ds-manager): VariableRow component with inline rename + type-aware editor"
```

---

## Task 16: Web — collections sidebar

**Files:**
- Create: `apps/web/src/components/design-system-manager/CollectionsSidebar.tsx`

- [ ] **Step 16.1: Implement**

```tsx
import { useState } from 'react';
import type { VariableCollection } from '../../providers/design-system-variables';
import { Icon } from '../Icon';

interface Props {
  collections: VariableCollection[];
  activeCollectionId: string | null;
  onSelect: (collectionId: string) => void;
  onCreate: (name: string) => void;
  onDelete: (collectionId: string) => void;
}

export function CollectionsSidebar({
  collections,
  activeCollectionId,
  onSelect,
  onCreate,
  onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  function commit() {
    setCreating(false);
    if (draft.trim()) onCreate(draft.trim());
    setDraft('');
  }

  return (
    <aside className="ds-mgr-sidebar" aria-label="Collections">
      <header className="ds-mgr-sidebar__head">
        <h3>Collections</h3>
        <button
          type="button"
          className="ghost"
          aria-label="New collection"
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={13} />
        </button>
      </header>
      <ul>
        {collections.map((collection) => {
          const total = collection.groups.reduce((acc, g) => acc + g.variables.length, 0);
          return (
            <li key={collection.id} className={collection.id === activeCollectionId ? 'active' : ''}>
              <button type="button" onClick={() => onSelect(collection.id)}>
                <span>{collection.name}</span>
                <span className="ds-mgr-sidebar__count">{total}</span>
              </button>
              <button
                type="button"
                className="ghost ds-mgr-sidebar__delete"
                aria-label={`Delete ${collection.name}`}
                onClick={() => onDelete(collection.id)}
              >
                <Icon name="trash" size={11} />
              </button>
            </li>
          );
        })}
        {creating ? (
          <li className="ds-mgr-sidebar__create">
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              onBlur={commit}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') commit();
                if (ev.key === 'Escape') { setCreating(false); setDraft(''); }
              }}
              placeholder="Collection name"
            />
          </li>
        ) : null}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 16.2: Commit**

```bash
git add apps/web/src/components/design-system-manager/CollectionsSidebar.tsx
git commit -m "feat(ds-manager): CollectionsSidebar with inline create/delete"
```

---

## Task 17: Web — variables table (groups + rows)

**Files:**
- Create: `apps/web/src/components/design-system-manager/VariablesTable.tsx`

- [ ] **Step 17.1: Implement**

```tsx
import { useState } from 'react';
import type { Variable, VariableCollection, VariableType } from '../../providers/design-system-variables';
import { Icon } from '../Icon';
import { VariableRow } from './VariableRow';

interface Props {
  collection: VariableCollection;
  onUpdateVariable: (variableId: string, patch: Partial<Pick<Variable, 'name' | 'type' | 'value'>>) => void;
  onDeleteVariable: (variableId: string) => void;
  onCreateVariable: (groupId: string, body: { name: string; type: VariableType; value: Variable['value'] }) => void;
  onCreateGroup: (name: string) => void;
  onDeleteGroup: (groupId: string) => void;
}

export function VariablesTable({
  collection,
  onUpdateVariable,
  onDeleteVariable,
  onCreateVariable,
  onCreateGroup,
  onDeleteGroup,
}: Props) {
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState('');

  function commitGroup() {
    setCreatingGroup(false);
    if (groupDraft.trim()) onCreateGroup(groupDraft.trim());
    setGroupDraft('');
  }

  return (
    <section className="ds-mgr-table">
      <header className="ds-mgr-table__head">
        <h2>{collection.name}</h2>
        <button type="button" onClick={() => setCreatingGroup(true)}>
          <Icon name="plus" size={13} /> New group
        </button>
      </header>
      {creatingGroup ? (
        <div className="ds-mgr-table__group-input">
          <input
            autoFocus
            type="text"
            value={groupDraft}
            onChange={(ev) => setGroupDraft(ev.target.value)}
            onBlur={commitGroup}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') commitGroup();
              if (ev.key === 'Escape') { setCreatingGroup(false); setGroupDraft(''); }
            }}
            placeholder="Group name"
          />
        </div>
      ) : null}
      {collection.groups.map((group) => (
        <GroupBlock
          key={group.id}
          collectionId={collection.id}
          groupId={group.id}
          groupName={group.name}
          variables={group.variables}
          onUpdateVariable={onUpdateVariable}
          onDeleteVariable={onDeleteVariable}
          onCreateVariable={(body) => onCreateVariable(group.id, body)}
          onDeleteGroup={() => onDeleteGroup(group.id)}
        />
      ))}
    </section>
  );
}

interface GroupBlockProps {
  collectionId: string;
  groupId: string;
  groupName: string;
  variables: Variable[];
  onUpdateVariable: Props['onUpdateVariable'];
  onDeleteVariable: Props['onDeleteVariable'];
  onCreateVariable: (body: { name: string; type: VariableType; value: Variable['value'] }) => void;
  onDeleteGroup: () => void;
}

function GroupBlock({
  groupName,
  variables,
  onUpdateVariable,
  onDeleteVariable,
  onCreateVariable,
  onDeleteGroup,
}: GroupBlockProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', type: 'color' as VariableType });

  function commit() {
    setAdding(false);
    if (!draft.name.trim()) return;
    const defaultValue: Variable['value'] =
      draft.type === 'color' ? '#000000'
      : draft.type === 'number' ? 0
      : draft.type === 'boolean' ? false
      : '';
    onCreateVariable({ name: draft.name.trim(), type: draft.type, value: defaultValue });
    setDraft({ name: '', type: 'color' });
  }

  return (
    <div className="ds-mgr-group">
      <header>
        <h3>{groupName}</h3>
        <button type="button" className="ghost" onClick={onDeleteGroup} aria-label={`Delete ${groupName}`}>
          <Icon name="trash" size={12} />
        </button>
      </header>
      <table>
        <thead>
          <tr><th>Name</th><th>Value</th><th>Type</th><th></th></tr>
        </thead>
        <tbody>
          {variables.map((variable) => (
            <VariableRow
              key={variable.id}
              variable={variable}
              onChangeValue={(value) => onUpdateVariable(variable.id, { value })}
              onRename={(name) => onUpdateVariable(variable.id, { name })}
              onChangeType={(type) => onUpdateVariable(variable.id, { type })}
              onDelete={() => onDeleteVariable(variable.id)}
            />
          ))}
          {adding ? (
            <tr>
              <td>
                <input
                  autoFocus
                  type="text"
                  value={draft.name}
                  onChange={(ev) => setDraft((d) => ({ ...d, name: ev.target.value }))}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') commit();
                    if (ev.key === 'Escape') { setAdding(false); setDraft({ name: '', type: 'color' }); }
                  }}
                  placeholder="Variable name"
                />
              </td>
              <td></td>
              <td>
                <select
                  value={draft.type}
                  onChange={(ev) => setDraft((d) => ({ ...d, type: ev.target.value as VariableType }))}
                >
                  <option value="color">color</option>
                  <option value="number">number</option>
                  <option value="string">string</option>
                  <option value="boolean">boolean</option>
                </select>
              </td>
              <td>
                <button type="button" onClick={commit}>Add</button>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {!adding ? (
        <button type="button" className="ghost ds-mgr-group__add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Create variable
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 17.2: Commit**

```bash
git add apps/web/src/components/design-system-manager/VariablesTable.tsx
git commit -m "feat(ds-manager): VariablesTable with grouped rows + create-variable form"
```

---

## Task 18: Web — orchestrator (DesignSystemManagerView)

**Files:**
- Create: `apps/web/src/components/design-system-manager/DesignSystemManagerView.tsx`

- [ ] **Step 18.1: Implement**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createCollection,
  createGroup,
  createVariable,
  deleteCollection,
  deleteGroup,
  deleteVariable,
  fetchVariables,
  updateVariable,
  type Variable,
  type VariablesFile,
  type VariableType,
} from '../../providers/design-system-variables';
import { CollectionsSidebar } from './CollectionsSidebar';
import { DesignSystemEmptyState } from './EmptyState';
import { VariablesTable } from './VariablesTable';

interface Props {
  projectId: string;
  designSystemId: string | null;
  projectName: string;
  onAttachDsRequested: (kind: 'create' | 'figma' | 'library') => void;
}

export function DesignSystemManagerView({
  projectId,
  designSystemId,
  projectName,
  onAttachDsRequested,
}: Props) {
  const [variables, setVariables] = useState<VariablesFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);

  // Initial load.
  useEffect(() => {
    if (!designSystemId) {
      setVariables(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchVariables(designSystemId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if ('error' in result) {
        setLoadError(result.error.message);
        return;
      }
      setVariables(result.variables);
      setActiveCollectionId(result.variables.collections[0]?.id ?? null);
    });
    return () => { cancelled = true; };
  }, [designSystemId]);

  const activeCollection = useMemo(
    () => variables?.collections.find((c) => c.id === activeCollectionId) ?? null,
    [variables, activeCollectionId],
  );

  // Optimistic local mutation; refetch on failure.
  const refetch = useCallback(async () => {
    if (!designSystemId) return;
    const result = await fetchVariables(designSystemId);
    if ('error' in result) {
      setLoadError(result.error.message);
      return;
    }
    setVariables(result.variables);
  }, [designSystemId]);

  const handleUpdateVariable = useCallback(
    (variableId: string, patch: Partial<Pick<Variable, 'name' | 'type' | 'value'>>) => {
      if (!designSystemId || !variables) return;
      // Optimistic local update.
      setVariables((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          collections: prev.collections.map((c) => ({
            ...c,
            groups: c.groups.map((g) => ({
              ...g,
              variables: g.variables.map((v) =>
                v.id === variableId ? { ...v, ...patch } as Variable : v,
              ),
            })),
          })),
        };
      });
      void updateVariable(designSystemId, variableId, patch).then((result) => {
        if ('error' in result) {
          setLoadError(result.error.message);
          void refetch();
        }
      });
    },
    [designSystemId, variables, refetch],
  );

  if (!designSystemId) {
    return (
      <DesignSystemEmptyState
        projectName={projectName}
        onCreateNew={() => onAttachDsRequested('create')}
        onImportFromFigma={() => onAttachDsRequested('figma')}
        onPickFromLibrary={() => onAttachDsRequested('library')}
      />
    );
  }
  if (loading && !variables) return <p className="ds-mgr-loading">Loading…</p>;
  if (loadError && !variables) return <p className="ds-mgr-error">{loadError}</p>;
  if (!variables) return null;

  return (
    <div className="ds-mgr">
      <CollectionsSidebar
        collections={variables.collections}
        activeCollectionId={activeCollectionId}
        onSelect={setActiveCollectionId}
        onCreate={async (name) => {
          await createCollection(designSystemId, name);
          await refetch();
        }}
        onDelete={async (collectionId) => {
          await deleteCollection(designSystemId, collectionId);
          await refetch();
        }}
      />
      {activeCollection ? (
        <VariablesTable
          collection={activeCollection}
          onUpdateVariable={handleUpdateVariable}
          onDeleteVariable={async (variableId) => {
            await deleteVariable(designSystemId, variableId);
            await refetch();
          }}
          onCreateVariable={async (groupId, body) => {
            await createVariable(designSystemId, activeCollection.id, groupId, body);
            await refetch();
          }}
          onCreateGroup={async (name) => {
            await createGroup(designSystemId, activeCollection.id, name);
            await refetch();
          }}
          onDeleteGroup={async (groupId) => {
            await deleteGroup(designSystemId, activeCollection.id, groupId);
            await refetch();
          }}
        />
      ) : (
        <p className="ds-mgr-empty-collection">Select a collection from the left, or create one.</p>
      )}
      {loadError ? <p className="ds-mgr-toast">{loadError}</p> : null}
    </div>
  );
}
```

- [ ] **Step 18.2: Commit**

```bash
git add apps/web/src/components/design-system-manager/DesignSystemManagerView.tsx
git commit -m "feat(ds-manager): orchestrator wiring fetch/CRUD into UI components"
```

---

## Task 19: Web — route branching in EntryShell

**Files:**
- Modify: `apps/web/src/components/EntryShell.tsx`

- [ ] **Step 19.1: Import the new view**

Near the other component imports (around the top of the file), add:

```ts
import { DesignSystemManagerView } from './design-system-manager/DesignSystemManagerView';
```

- [ ] **Step 19.2: Branch the design-systems render**

Find the existing block (around line 585):

```tsx
{view === 'design-systems' ? (
  designSystemsLoading ? (
    <CenteredLoader label={t('common.loading')} />
  ) : (
    <div className="entry-section">
      ...
      <DesignSystemsTab ... />
    </div>
  )
) : null}
```

Wrap it with the project-aware branch:

```tsx
{view === 'design-systems' ? (
  route.kind === 'home' && route.projectContext ? (
    <DesignSystemManagerView
      projectId={route.projectContext}
      designSystemId={designSystemForProject(route.projectContext, projects)?.designSystemId ?? null}
      projectName={projects.find((p) => p.id === route.projectContext)?.name ?? 'this project'}
      onAttachDsRequested={(kind) => {
        if (kind === 'create') onCreateDesignSystem?.();
        // 'figma' and 'library' open existing affordances in the library tab; route there.
        else navigate({ kind: 'home', view: 'design-systems' });
      }}
    />
  ) : designSystemsLoading ? (
    /* existing library content unchanged */
  ) : (
    /* existing library content unchanged */
  )
) : null}
```

Where `designSystemForProject` is a tiny helper inline:

```ts
function designSystemForProject(projectId: string, projects: ProjectSummary[]) {
  const project = projects.find((p) => p.id === projectId);
  return project ? { designSystemId: project.designSystemId ?? null } : null;
}
```

- [ ] **Step 19.3: Verify compile**

```bash
pnpm tools-dev status --json | tail -10
# wait for the next compile (web hot-reloads):
sleep 4
grep -E "Compiled|error" .tmp/tools-dev/default/logs/web/latest.log | tail -3
```

Expected: `Compiled in <X>ms` on the last line.

- [ ] **Step 19.4: Commit**

```bash
git add apps/web/src/components/EntryShell.tsx
git commit -m "feat(ds-manager): EntryShell routes /design-systems?project= to manager view"
```

---

## Task 20: CSS styling

**Files:**
- Modify: `apps/web/src/index.css`

- [ ] **Step 20.1: Append styles**

At the end of the file (after the existing `.ds-figma-import*` rules), append:

```css
/* ---- Design System Manager ----------------------------------------- */
.ds-mgr {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 0;
  min-height: 480px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: var(--radius-sm, 8px);
  overflow: hidden;
}
.ds-mgr-loading,
.ds-mgr-error,
.ds-mgr-empty-collection {
  padding: 24px;
  color: var(--text-muted, #6a6a6a);
}
.ds-mgr-toast {
  position: fixed;
  bottom: 16px;
  right: 16px;
  background: rgba(220, 38, 38, 0.1);
  color: rgb(170, 30, 30);
  padding: 10px 14px;
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
  max-width: 320px;
}

.ds-mgr-sidebar {
  background: var(--bg-subtle, #fafafa);
  border-right: 1px solid var(--border, #e5e5e5);
  display: flex;
  flex-direction: column;
}
.ds-mgr-sidebar__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--border, #e5e5e5);
}
.ds-mgr-sidebar__head h3 { margin: 0; font-size: 12px; text-transform: uppercase; color: var(--text-muted, #6a6a6a); letter-spacing: 0.04em; }
.ds-mgr-sidebar ul {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}
.ds-mgr-sidebar li {
  display: flex;
  align-items: center;
}
.ds-mgr-sidebar li button:first-child {
  flex: 1;
  background: transparent;
  border: 0;
  text-align: left;
  padding: 8px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  cursor: pointer;
  color: inherit;
}
.ds-mgr-sidebar li.active button:first-child {
  background: var(--accent-soft, rgba(37, 99, 235, 0.08));
  font-weight: 600;
}
.ds-mgr-sidebar__count {
  font-size: 11px;
  color: var(--text-muted, #6a6a6a);
}
.ds-mgr-sidebar__delete {
  padding: 6px 10px;
  opacity: 0;
  transition: opacity 80ms ease-out;
}
.ds-mgr-sidebar li:hover .ds-mgr-sidebar__delete {
  opacity: 0.7;
}
.ds-mgr-sidebar__create input {
  margin: 6px 12px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--border, #d4d4d4);
  background: var(--surface, #fff);
  font: inherit;
}

.ds-mgr-table {
  display: flex;
  flex-direction: column;
  padding: 16px 24px;
  gap: 16px;
  overflow: auto;
}
.ds-mgr-table__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ds-mgr-table__head h2 { margin: 0; font-size: 18px; }
.ds-mgr-table__head button {
  background: transparent;
  border: 1px solid var(--border, #d4d4d4);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.ds-mgr-table__group-input input {
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--border, #d4d4d4);
  background: var(--surface, #fff);
  font: inherit;
}

.ds-mgr-group {
  border: 1px solid var(--border-soft, rgba(0,0,0,0.05));
  border-radius: var(--radius-sm, 6px);
  background: var(--surface, #fff);
}
.ds-mgr-group > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-soft, rgba(0,0,0,0.05));
  background: var(--bg-subtle, #fafafa);
}
.ds-mgr-group > header h3 {
  margin: 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #6a6a6a);
}
.ds-mgr-group table {
  width: 100%;
  border-collapse: collapse;
}
.ds-mgr-group thead th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #6a6a6a);
  padding: 6px 12px;
  font-weight: 500;
}
.ds-mgr-row td {
  padding: 6px 12px;
  border-top: 1px solid var(--border-soft, rgba(0,0,0,0.04));
  font-size: 13px;
}
.ds-mgr-row__name-btn {
  background: transparent;
  border: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
  padding: 0;
}
.ds-mgr-row__name input,
.ds-mgr-row__value input[type="text"],
.ds-mgr-row__value input[type="number"],
.ds-mgr-row__type select {
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid var(--border, #d4d4d4);
  background: var(--surface, #fff);
  font: inherit;
  width: 100%;
}
.ds-mgr-editor-color {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ds-mgr-editor-color input[type="color"] {
  width: 28px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border, #d4d4d4);
  background: none;
  cursor: pointer;
}
.ds-mgr-group__add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 0;
  color: var(--accent, #2563eb);
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
}

.ds-mgr-empty {
  margin: 60px auto;
  max-width: 480px;
  text-align: center;
  padding: 32px;
  border: 1px dashed var(--border, #d4d4d4);
  border-radius: var(--radius-sm, 8px);
}
.ds-mgr-empty h2 { margin: 0 0 12px 0; font-size: 18px; }
.ds-mgr-empty p { margin: 0 0 20px 0; color: var(--text-muted, #6a6a6a); font-size: 13px; line-height: 1.5; }
.ds-mgr-empty__actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.ds-mgr-empty__actions button {
  padding: 8px 14px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--border, #d4d4d4);
  background: var(--surface, #fff);
  font: inherit;
  cursor: pointer;
}
.ds-mgr-empty__actions button.primary {
  background: var(--accent, #2563eb);
  color: var(--accent-on, #fff);
  border-color: var(--accent, #2563eb);
}
```

- [ ] **Step 20.2: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat(ds-manager): styles for sidebar, table, rows, empty state"
```

---

## Task 21: Wire ProjectSummary.designSystemId to the route view

**Files:**
- Inspect: `apps/web/src/components/EntryShell.tsx`

The view depends on each project carrying `designSystemId`. Verify the existing types and runtime payload include it.

- [ ] **Step 21.1: Confirm ProjectSummary has designSystemId**

```bash
grep -an "designSystemId" apps/web/src/types.ts | head -5
grep -an "designSystemId" apps/web/src/providers/registry.ts | head -10
```

If `designSystemId` is not part of the project summary returned by `/api/projects`, the manager view will always show the empty state. If it is missing, add it via the existing project shape (this should already exist — `NewProjectPanel` writes it).

If it's missing, add a follow-up task to expose it. Otherwise:

- [ ] **Step 21.2: No code change needed — commit a NOOP touch only if you had to amend**

(Skip if no edits.)

---

## Task 22: Daemon — update Figma import to write variables.json directly

**Files:**
- Modify: `apps/daemon/src/design-system-figma.ts`

- [ ] **Step 22.1: After the existing `saveVariables` import in static-resource-routes.ts, also import it in design-system-figma.ts**

Find the existing imports in `apps/daemon/src/design-system-figma.ts` and add:

```ts
import {
  newCollectionId,
  newGroupId,
  newVariableId,
  saveVariables,
  type VariablesFile,
  type Variable,
} from './design-system-variables.js';
```

- [ ] **Step 22.2: At the point where the import writes the DS to disk, also write variables.json**

Find the section that writes `tokens.css` / `DESIGN.md` / `manifest.json` (search for `writeFile(path.join(outDir, 'tokens.css')`). Just before those writes, build a `VariablesFile` from the in-memory arrays:

```ts
const variablesFile: VariablesFile = {
  version: 1,
  collections: buildVariablesCollectionsFromFigma(colors, fonts, shadows, spacings, radii),
};
// Write tokens.css from variables.json so the two files cannot drift.
await saveVariables(outDir, variablesFile);
// design.md + manifest.json still written below — but DROP the manual
// tokens.css write because saveVariables already produced one.
```

Remove the old `await writeFile(path.join(outDir, 'tokens.css'), tokensCss, 'utf8');`.

- [ ] **Step 22.3: Implement buildVariablesCollectionsFromFigma helper**

At the bottom of `design-system-figma.ts`, append:

```ts
function buildVariablesCollectionsFromFigma(
  colors: FigmaColor[],
  fonts: FigmaFont[],
  shadows: FigmaShadow[],
  spacings: FigmaSpacing[],
  radii: FigmaRadius[],
): VariableCollection[] {
  const out: VariableCollection[] = [];
  if (colors.length > 0) {
    const groupsMap = new Map<string, Variable[]>();
    for (const c of colors) {
      const parts = c.name.split('/');
      const group = parts.length > 1 ? parts[0] : 'Default';
      const varName = parts.slice(1).join('/') || parts[0];
      const list = groupsMap.get(group) ?? [];
      list.push({ id: newVariableId(), name: varName, type: 'color', value: c.hex });
      groupsMap.set(group, list);
    }
    out.push({
      id: newCollectionId(),
      name: 'Colors',
      groups: Array.from(groupsMap.entries()).map(([name, variables]) => ({
        id: newGroupId(), name, variables,
      })),
    });
  }
  if (fonts.length > 0) {
    const variables: Variable[] = [];
    for (const f of fonts) {
      const slug = f.name.replace(/[^A-Za-z0-9]+/g, '_');
      variables.push({ id: newVariableId(), name: `${slug}_family`, type: 'string', value: f.family });
      variables.push({ id: newVariableId(), name: `${slug}_size`, type: 'number', value: f.size });
      variables.push({ id: newVariableId(), name: `${slug}_weight`, type: 'number', value: f.weight });
      if (f.lineHeight != null) variables.push({ id: newVariableId(), name: `${slug}_line_height`, type: 'string', value: f.lineHeight });
    }
    out.push({
      id: newCollectionId(), name: 'Typography',
      groups: [{ id: newGroupId(), name: 'Default', variables }],
    });
  }
  if (shadows.length > 0) {
    out.push({
      id: newCollectionId(), name: 'Effects',
      groups: [{
        id: newGroupId(), name: 'Default',
        variables: shadows.map((s) => ({ id: newVariableId(), name: s.name, type: 'string' as const, value: s.value })),
      }],
    });
  }
  if (spacings.length > 0) {
    out.push({
      id: newCollectionId(), name: 'Spacing',
      groups: [{
        id: newGroupId(), name: 'Default',
        variables: spacings.map((s) => ({ id: newVariableId(), name: s.name, type: 'number' as const, value: s.value })),
      }],
    });
  }
  if (radii.length > 0) {
    out.push({
      id: newCollectionId(), name: 'Radii',
      groups: [{
        id: newGroupId(), name: 'Default',
        variables: radii.map((r) => ({ id: newVariableId(), name: r.name, type: 'number' as const, value: r.value })),
      }],
    });
  }
  return out;
}

// Re-export VariableCollection so the helper can declare its return type.
export type { VariableCollection } from './design-system-variables.js';
```

- [ ] **Step 22.4: Rebuild daemon**

```bash
pnpm --filter @open-design/daemon build 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 22.5: Commit**

```bash
git add apps/daemon/src/design-system-figma.ts
git commit -m "feat(ds-manager): Figma import writes variables.json directly (collection/group hierarchy preserved)"
```

---

## Task 23: End-to-end smoke test (manual)

- [ ] **Step 23.1: Restart everything**

```bash
pnpm tools-dev restart 2>&1 | tail -4
```

- [ ] **Step 23.2: Navigate to a project's manager view**

```bash
pnpm tools-dev inspect desktop eval --expr "(() => { const cards = Array.from(document.querySelectorAll('a, button')); const card = cards.find(c => /Portal|PagarMEI|Ticket/.test(c.textContent||'')); if (card) card.click(); return 'opened'; })()" 2>&1 | tail -3
sleep 2
pnpm tools-dev inspect desktop click --selector "[data-testid='design-systems-toggle']" 2>&1 | tail -3
sleep 3
pnpm tools-dev inspect desktop screenshot --path /tmp/od-ds-mgr.png 2>&1 | tail -3
```

- [ ] **Step 23.3: Inspect the screenshot**

Open `/tmp/od-ds-mgr.png`. Expected:
- If the project has `designSystemId`: a two-column layout with Collections list on the left, variables table on the right.
- If not: the empty state card with "Create new", "Import from Figma", "Pick from library" buttons.

- [ ] **Step 23.4: Edit a color and verify tokens.css updates**

```bash
pnpm tools-dev inspect desktop eval --expr "(() => { const row = document.querySelector('.ds-mgr-row'); if (!row) return 'no-row'; const colorInput = row.querySelector('input[type=color]'); if (!colorInput) return 'no-color-input'; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(colorInput, '#ff00ff'); colorInput.dispatchEvent(new Event('change', { bubbles:true })); return 'changed'; })()" 2>&1 | tail -3
sleep 1
# Read the DS dir to verify tokens.css picked up the new value:
ls /Users/elite1/dev/pendesign/.od/design-systems/
grep '#ff00ff' /Users/elite1/dev/pendesign/.od/design-systems/*/tokens.css | head -5
```

Expected: at least one `tokens.css` contains `#ff00ff`.

- [ ] **Step 23.5: Commit any final polish**

If you found and fixed any styling glitch during the smoke, commit it.

---

## Task 24: Self-review checklist

Run the spec coverage check from `writing-plans.md`:

- [ ] **Step 24.1: Skim the spec section by section against the plan tasks**

Open `docs/superpowers/specs/2026-05-23-ds-manager-design.md` and confirm each requirement maps to a task:

| Spec requirement | Implemented in |
|---|---|
| Route `/design-systems?project=<id>` | Task 19 (EntryShell branch) |
| Empty state with 4 actions | Task 13 (EmptyState) + Task 18 (wire) |
| Three-column populated layout | Task 16 + 17 + 18 + 20 (CSS) |
| Inline editor by type | Task 14 + 15 |
| `variables.json` schema v1 | Task 1 |
| Stable `v_N` / `c_N` / `g_N` ids | Task 2 |
| CSS naming + collision suffix | Task 3 |
| Migration from tokens.css | Task 4 |
| Save flow (atomic) | Task 5 |
| Per-DS async lock | Task 6 |
| Granular CRUD helpers | Task 7 |
| API: GET / PUT / per-id / per-collection / per-group | Tasks 8 + 9 + 10 |
| Project ↔ DS binding (`source.projectId`) | (Deferred — see Open follow-ups below) |
| Figma import writes variables.json | Task 22 |
| Auto-save debounce 600ms | Task 12 |
| Optimistic + rollback on failure | Task 18 |

- [ ] **Step 24.2: Note deferred items**

The spec calls for `manifest.source.projectId` to mark project-exclusive DSs and a `GET /api/design-systems?projectId=<id>` filter. This plan ships the Manager UI but does NOT yet:

- Stamp `manifest.source.projectId` on newly imported DSs.
- Add the `?projectId=<id>` filter to the existing list endpoint.
- Hide project-bound DSs from the library tab.

This means in v1 the Manager view CAN show a DS the user attached to the project, but a DS imported in-project will ALSO appear in the global library. Add this as a small follow-up plan once the Manager itself is shipped — it is not blocking the user value of editing tokens.

- [ ] **Step 24.3: Commit the plan**

```bash
git add docs/superpowers/plans/2026-05-23-ds-manager-implementation.md
git commit -m "docs: implementation plan for Subproject A (DS Manager)"
```

---

## Open follow-ups (post-A)

1. **DS exclusivity at API level**: stamp `manifest.source.projectId` on creation/import; filter list endpoint; mark library DSs read-only when opened from a project context.
2. **Subproject B (Wiring)**: serve `tokens.css` from the project's DS via `/api/projects/:id/design-system/tokens.css`; inject a `<link>` into the project's HTML at attach time; SSE-notify the iframe on variable changes for hot-reload.
3. **Subproject C (Property bar binding)**: extend `ManualEditPanel` with a "Variable" picker per editable property; persist binding as `var(--token-name)` inline; resolve names via the active DS's variables.json.
4. **Subproject D (Agent-aware generation)**: extend `composeDaemonSystemPrompt` to include the project's `tokens.css` and an instruction to use the variables.
