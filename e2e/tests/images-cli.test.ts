// @vitest-environment node

// e2e smoke for `od images` CLI surface.
//
// Spawns the pre-built daemon CLI as a child process and asserts:
//   1. `od images` (no sub-command) prints usage help.
//   2. `od images search cats` without PIXABAY_API_KEY exits with code 2.
//
// The daemon must be built before this test runs:
//   pnpm --filter @open-design/daemon build

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const daemonBin = path.resolve(repoRoot, 'apps/daemon/dist/cli.js');

test('od images (no command) prints help', async () => {
  const result = await execFileAsync('node', [daemonBin, 'images'], {
    env: { ...process.env, PIXABAY_API_KEY: '' },
  }).catch((err: { stdout?: string; stderr?: string }) => ({
    stdout: err.stdout ?? '',
    stderr: err.stderr ?? '',
  }));
  expect((result.stdout + result.stderr).toLowerCase()).toMatch(/usage:\s*od\s+images/);
});

test('od images search exits 2 without PIXABAY_API_KEY', async () => {
  let exitCode = 0;
  try {
    await execFileAsync('node', [daemonBin, 'images', 'search', 'cats'], {
      env: { ...process.env, PIXABAY_API_KEY: '' },
    });
  } catch (err) {
    exitCode = (err as { code?: number }).code ?? -1;
  }
  expect(exitCode).toBe(2);
});
