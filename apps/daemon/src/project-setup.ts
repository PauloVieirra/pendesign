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
import { buildStandaloneBridgeJs, buildStandaloneBridgeCss } from '@open-design/edit-bridge';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_DIR = path.resolve(__dirname, 'templates/vite-react');
const SPA_TEMPLATE_DIR = path.resolve(__dirname, 'templates/spa-single-file');

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
  await writeBridgeAssets(projectDir);
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

// SPA single-file projects don't need a dependency install — the template
// is one HTML file that pulls React + Babel from a CDN at runtime. The
// setup endpoint returns 'ready' as soon as the copy is done.
export async function setupSpaSingleFileProject(projectId: string, projectDir: string): Promise<void> {
  await copyDirRecursive(SPA_TEMPLATE_DIR, projectDir);
  void projectId;
}

// Writes the edit-mode bridge into the project's public/ folder so the
// Vite dev server serves it first-party. The iframe carrying the React
// app loads /edit-bridge.js the same way it loads any other asset — no
// cross-origin shim, no rewrite — and the bridge can mutate DOM and
// postMessage back to the host canvas.
//
// Re-running setup overwrites public/edit-bridge.js on purpose: if the
// bridge gets a fix or feature, every project picks it up on next open
// (or on the next `od files refresh` round-trip). User edits to other
// files under public/ are not touched.
async function writeBridgeAssets(projectDir: string): Promise<void> {
  const publicDir = path.join(projectDir, 'public');
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, 'edit-bridge.js'), buildStandaloneBridgeJs(), 'utf8');
  await writeFile(path.join(publicDir, 'edit-bridge.css'), buildStandaloneBridgeCss(), 'utf8');
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
    // Critical: if the daemon is running inside a pnpm workspace (the
    // Vision Design monorepo, for example), pnpm walks up from `cwd` and
    // discovers pnpm-workspace.yaml, then treats the new project as a
    // workspace member. It then ignores the project's package.json and
    // re-runs the monorepo's postinstall scripts instead of installing
    // React. `--ignore-workspace` opts out of that walk so the project is
    // installed in isolation. npm doesn't auto-detect workspaces this
    // way, but we pass --no-workspaces defensively in case a future
    // packaged build runs inside an npm workspace.
    const args = pm === 'pnpm'
      ? ['install', '--ignore-workspace']
      : ['install', '--no-workspaces'];
    const child = spawn(pm, args, {
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

// ─────────────────────────────────────────────────────────────────────
// Vite dev server lifecycle. The daemon spawns `<pm> run dev`, parses
// the "Local: http://..." line from Vite's stdout to learn the port, and
// keeps a handle so the canvas-side proxy can forward HTTP requests to
// the right port. Servers are scoped per project; calling startDevServer
// while one is already running for the same project returns the existing
// status (idempotent).
// ─────────────────────────────────────────────────────────────────────

export type DevServerPhase = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export interface DevServerStatus {
  phase: DevServerPhase;
  port?: number;
  url?: string;
  pid?: number;
  startedAt?: number;
  recentLog: string[];
  error?: string;
}

interface DevServerInternal extends DevServerStatus {
  child?: import('node:child_process').ChildProcess;
}

const devServers = new Map<string, DevServerInternal>();
const DEV_LOG_MAX = 60;

export function getDevServerStatus(projectId: string): DevServerStatus | null {
  const state = devServers.get(projectId);
  if (!state) return null;
  return {
    phase: state.phase,
    port: state.port,
    url: state.url,
    pid: state.pid,
    startedAt: state.startedAt,
    recentLog: state.recentLog.slice(-DEV_LOG_MAX),
    error: state.error,
  };
}

export function startDevServer(projectId: string, projectDir: string): DevServerStatus {
  const existing = devServers.get(projectId);
  if (existing && (existing.phase === 'starting' || existing.phase === 'running')) {
    return getDevServerStatus(projectId)!;
  }
  const state: DevServerInternal = {
    phase: 'starting',
    startedAt: Date.now(),
    recentLog: [],
  };
  devServers.set(projectId, state);
  void launchDevServer(projectId, projectDir).catch((err) => {
    const s = devServers.get(projectId);
    if (s) {
      s.phase = 'error';
      s.error = String(err?.message ?? err);
    }
  });
  return getDevServerStatus(projectId)!;
}

export function stopDevServer(projectId: string): boolean {
  const state = devServers.get(projectId);
  if (!state || !state.child) return false;
  try {
    // SIGTERM gives Vite a chance to clean up. We don't wait — the exit
    // handler below flips the phase to 'stopped' when the child reports.
    state.child.kill('SIGTERM');
  } catch { /* already gone */ }
  return true;
}

async function launchDevServer(projectId: string, projectDir: string): Promise<void> {
  const pm = await detectPackageManager(projectDir);
  const state = devServers.get(projectId);
  if (!state) return;
  appendDevLog(projectId, `[dev] launching ${pm} run dev`);
  // Same workspace-isolation precaution as runInstall — see comment there.
  const args = pm === 'pnpm'
    ? ['--ignore-workspace', 'run', 'dev']
    : ['run', 'dev'];
  const child = spawn(pm, args, {
    cwd: projectDir,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  state.child = child;
  state.pid = child.pid ?? undefined;

  const handleChunk = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    appendDevLog(projectId, text);
    // Vite reports its bound port via a "Local: http://host:port/" line.
    // We accept either ipv4 hostnames or "localhost" and tolerate ANSI
    // codes that occasionally leak through despite NO_COLOR=1.
    if (state.phase === 'starting') {
      const stripped = text.replace(/\[[0-9;]*m/g, '');
      const match = stripped.match(/Local:\s+(https?:\/\/[^\s]+)/i);
      if (match) {
        let url = match[1];
        // Vite emits "http://localhost:5173/" — strip a trailing slash so
        // proxy targets join cleanly without doubling up.
        if (url.endsWith('/')) url = url.slice(0, -1);
        const portMatch = url.match(/:(\d+)/);
        const port = portMatch ? Number(portMatch[1]) : undefined;
        state.url = url;
        state.port = port;
        state.phase = 'running';
        appendDevLog(projectId, `[dev] running on ${url}`);
      }
    }
  };

  child.stdout?.on('data', handleChunk);
  child.stderr?.on('data', handleChunk);
  child.on('error', (err) => {
    state.phase = 'error';
    state.error = `Could not spawn ${pm} run dev: ${err.message}`;
  });
  child.on('exit', (code, signal) => {
    if (state.phase !== 'error') {
      state.phase = code === 0 || signal === 'SIGTERM' ? 'stopped' : 'error';
      if (state.phase === 'error') state.error = `dev server exited with code ${code}`;
    }
    state.child = undefined;
    state.pid = undefined;
  });
}

function appendDevLog(projectId: string, chunk: string): void {
  const state = devServers.get(projectId);
  if (!state) return;
  const lines = chunk.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    state.recentLog.push(line);
    if (state.recentLog.length > DEV_LOG_MAX * 2) {
      state.recentLog.splice(0, state.recentLog.length - DEV_LOG_MAX);
    }
  }
}

// Cleanup hook. Called when the daemon is shutting down so dev servers
// don't outlive the process they were spawned from.
export function stopAllDevServers(): void {
  for (const [projectId] of devServers) {
    stopDevServer(projectId);
  }
}
