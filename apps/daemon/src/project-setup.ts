// @ts-nocheck
// React project setup — runs after a kind:'react-vite' project is created.
// Extracts the Vite-React template files into the project's directory,
// detects the available package manager (pnpm preferred, npm fallback),
// and runs `<pm> install` in the background. The frontend polls
// getProjectSetupStatus() to render its loading screen.
//
// State is kept in-memory; on daemon restart any in-flight install is
// orphaned (the spawned child will keep running but the daemon forgets).
// That is acceptable for now — the user only sees "stuck installing", and
// clicking the project again will re-trigger setup which is idempotent.

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_DIR = path.resolve(__dirname, 'templates/vite-react');

export type ProjectSetupPhase = 'extracting' | 'installing' | 'ready' | 'error';

export interface ProjectSetupStatus {
  phase: ProjectSetupPhase;
  startedAt: number;
  /** Package manager actually used (set once we've decided). */
  packageManager?: 'pnpm' | 'npm';
  /** Last few stdout/stderr lines from the installer, for debugging. */
  recentLog: string[];
  error?: string;
}

interface InternalState extends ProjectSetupStatus {
  installerPid?: number;
}

const states = new Map<string, InternalState>();
const RECENT_LOG_MAX = 40;

export function getProjectSetupStatus(projectId: string): ProjectSetupStatus | null {
  const state = states.get(projectId);
  if (!state) return null;
  // Strip internal-only fields before returning.
  return {
    phase: state.phase,
    startedAt: state.startedAt,
    packageManager: state.packageManager,
    recentLog: state.recentLog.slice(-RECENT_LOG_MAX),
    error: state.error,
  };
}

export function startProjectSetup(projectId: string, projectDir: string): ProjectSetupStatus {
  // Idempotent: if a setup is already in flight or finished, return the
  // existing state instead of relaunching. The frontend polls this same
  // endpoint, so a refresh during install doesn't restart anything.
  const existing = states.get(projectId);
  if (existing && existing.phase !== 'error') {
    return getProjectSetupStatus(projectId)!;
  }
  const state: InternalState = {
    phase: 'extracting',
    startedAt: Date.now(),
    recentLog: [],
  };
  states.set(projectId, state);
  // Fire and forget — the route handler returns immediately and the work
  // continues in the background. We catch all errors and surface them via
  // the status state.
  void runSetup(projectId, projectDir).catch((err) => {
    const s = states.get(projectId);
    if (s) {
      s.phase = 'error';
      s.error = String(err?.message ?? err);
    }
  });
  return getProjectSetupStatus(projectId)!;
}

async function runSetup(projectId: string, projectDir: string): Promise<void> {
  await extractViteReactTemplate(projectDir);
  const state = states.get(projectId);
  if (!state) return;
  state.phase = 'installing';
  const pm = await detectPackageManager(projectDir);
  state.packageManager = pm;
  appendLog(projectId, `[setup] using ${pm}`);
  await runInstall(projectId, projectDir, pm);
  const final = states.get(projectId);
  if (final && final.phase !== 'error') final.phase = 'ready';
}

async function extractViteReactTemplate(targetDir: string): Promise<void> {
  await copyDirRecursive(TEMPLATE_DIR, targetDir);
}

async function copyDirRecursive(srcDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      // Idempotent: only write when the destination doesn't already exist,
      // so re-running setup on a project that already has files doesn't
      // clobber user edits.
      try {
        await stat(destPath);
        continue;
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
      }
      const data = await readFile(srcPath);
      await writeFile(destPath, data);
    }
  }
}

async function detectPackageManager(projectDir: string): Promise<'pnpm' | 'npm'> {
  // pnpm preferred — much faster install. We probe by spawning the binary
  // with `--version`; if it exits cleanly within 1s, we use it. ENOENT means
  // pnpm isn't on the PATH the daemon inherited.
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pnpm', ['--version'], { cwd: projectDir, stdio: 'ignore' });
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        reject(new Error('pnpm probe timed out'));
      }, 2000);
      child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`pnpm exited ${code}`)); });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
    return 'pnpm';
  } catch {
    return 'npm';
  }
}

async function runInstall(projectId: string, projectDir: string, pm: 'pnpm' | 'npm'): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(pm, ['install'], {
      cwd: projectDir,
      env: { ...process.env, CI: '1' }, // suppresses interactive prompts
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const state = states.get(projectId);
    if (state) state.installerPid = child.pid ?? undefined;
    child.stdout?.on('data', (chunk: Buffer) => appendLog(projectId, chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => appendLog(projectId, chunk.toString('utf8')));
    child.on('error', (err) => {
      const s = states.get(projectId);
      if (s) {
        s.phase = 'error';
        s.error = `Could not spawn ${pm}: ${err.message}`;
      }
      reject(err);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const s = states.get(projectId);
        if (s) {
          s.phase = 'error';
          s.error = `${pm} install exited with code ${code}`;
        }
        reject(new Error(`${pm} install failed (exit ${code})`));
      }
    });
  });
}

function appendLog(projectId: string, chunk: string): void {
  const state = states.get(projectId);
  if (!state) return;
  // Split incoming stream by newlines and keep the tail of the most recent
  // lines. This keeps memory bounded even if `pnpm install` floods stdout.
  const lines = chunk.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    state.recentLog.push(line);
    if (state.recentLog.length > RECENT_LOG_MAX * 2) {
      state.recentLog.splice(0, state.recentLog.length - RECENT_LOG_MAX);
    }
  }
}
