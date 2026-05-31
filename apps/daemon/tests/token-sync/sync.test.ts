import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { syncProjectNow, scheduleTokenSync } from '../../src/token-sync/index.js';
import { buildSeededVariablesFile } from '../../src/design-system-seed.js';
import { VARIABLES_FILE_NAME } from '../../src/design-system-variables.js';

// The integration test sets up a minimal project + DS layout and exercises
// the sync end-to-end. The orchestrator MUST accept a configuration shape
// that lets us point at temp directories (real production resolvers go
// through server-context). See Step 3 for that contract.

test('syncProjectNow extracts CSS values into the attached DS', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-sync-int-'));
  const projectDir = path.join(root, 'projects', 'p1');
  const dsDir = path.join(root, 'design-systems', 'd1');
  await mkdir(projectDir, { recursive: true });
  await mkdir(dsDir, { recursive: true });

  // Seed DS file on disk
  const seed = buildSeededVariablesFile();
  await writeFile(path.join(dsDir, VARIABLES_FILE_NAME), JSON.stringify(seed), 'utf8');

  // Write a project CSS file with a literal not in the seed
  await writeFile(path.join(projectDir, 'style.css'), `
    .a { color: #0066ff; padding: 16px; }
  `, 'utf8');

  await syncProjectNow('p1', {
    resolveProjectDir: () => projectDir,
    resolveDsDir: () => dsDir,
    getDesignSystemId: () => 'd1',
  });

  const out = JSON.parse(await readFile(path.join(dsDir, VARIABLES_FILE_NAME), 'utf8'));
  const cores = out.collections.find((c: any) => c.name === 'Cores')!;
  const extracted = cores.groups.find((g: any) => g.name === 'Extracted')!;
  const v = extracted.variables.find((x: any) => x.name === 'color-0066ff');
  assert.ok(v, 'extracted color must appear in Cores/Extracted');
});

test('syncProjectNow is a no-op when project has no DS attached', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-sync-noop-'));
  const projectDir = path.join(root, 'projects', 'p1');
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, 'style.css'), '.a { color: red }', 'utf8');

  // Should resolve and exit cleanly without throwing.
  await syncProjectNow('p1', {
    resolveProjectDir: () => projectDir,
    resolveDsDir: () => null,
    getDesignSystemId: () => null,
  });
});

test('scheduleTokenSync debounces multiple rapid calls', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-sync-debounce-'));
  const projectDir = path.join(root, 'projects', 'p1');
  const dsDir = path.join(root, 'design-systems', 'd1');
  await mkdir(projectDir, { recursive: true });
  await mkdir(dsDir, { recursive: true });
  await writeFile(path.join(dsDir, VARIABLES_FILE_NAME), JSON.stringify(buildSeededVariablesFile()), 'utf8');
  await writeFile(path.join(projectDir, 'style.css'), '.a { color: #abcdef }', 'utf8');

  let syncs = 0;
  const config = {
    resolveProjectDir: () => projectDir,
    resolveDsDir: () => dsDir,
    getDesignSystemId: () => 'd1',
    onSyncRun: () => { syncs++; },
  };

  scheduleTokenSync('p1', config);
  scheduleTokenSync('p1', config);
  scheduleTokenSync('p1', config);

  await new Promise((r) => setTimeout(r, 800));
  assert.equal(syncs, 1, 'debounce must coalesce rapid calls to one sync');
});
