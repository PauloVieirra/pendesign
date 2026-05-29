import { readFile } from 'node:fs/promises';
import {
  readVariables,
  saveVariables,
  withDsLock,
} from '../design-system-variables.js';
import { extractFromCss } from './extract-css.js';
import { extractFromHtml } from './extract-html.js';
import { listProjectSourceFiles } from './listing.js';
import { mergeExtractedIntoDs } from './merge.js';
import { emptyExtractedTokens, type ExtractedTokens } from './types.js';

export interface TokenSyncConfig {
  /** Returns the project's working directory (absolute). */
  resolveProjectDir: (projectId: string) => string | Promise<string>;
  /** Returns the DS directory (absolute) or null if no DS attached. */
  resolveDsDir: (designSystemId: string) => string | null | Promise<string | null>;
  /** Returns the DS id for the project or null if none attached. */
  getDesignSystemId: (projectId: string) => string | null | Promise<string | null>;
  /** Optional: invoked after each completed sync. Used by tests. */
  onSyncRun?: (projectId: string) => void;
}

let defaultConfig: TokenSyncConfig | null = null;

/**
 * Production wiring registers a TokenSyncConfig at daemon startup. Until then,
 * each call must pass `config` explicitly.
 */
export function setDefaultTokenSyncConfig(cfg: TokenSyncConfig): void {
  defaultConfig = cfg;
}

const timers: Map<string, NodeJS.Timeout> = new Map();
const running: Set<string> = new Set();
const DEBOUNCE_MS = 500;

export function scheduleTokenSync(projectId: string, cfgOverride?: TokenSyncConfig): void {
  const cfg = cfgOverride ?? defaultConfig;
  if (!cfg) return;
  const existing = timers.get(projectId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    timers.delete(projectId);
    if (running.has(projectId)) {
      // Re-schedule so the next sync sees the latest state.
      scheduleTokenSync(projectId, cfg);
      return;
    }
    running.add(projectId);
    syncProjectNow(projectId, cfg)
      .catch(() => { /* swallow */ })
      .finally(() => { running.delete(projectId); });
  }, DEBOUNCE_MS);
  timers.set(projectId, timer);
}

export async function syncProjectNow(projectId: string, cfgOverride?: TokenSyncConfig): Promise<void> {
  const cfg = cfgOverride ?? defaultConfig;
  if (!cfg) return;
  const dsId = await cfg.getDesignSystemId(projectId);
  if (!dsId) return;
  const dsDir = await cfg.resolveDsDir(dsId);
  if (!dsDir) return;
  const projectDir = await cfg.resolveProjectDir(projectId);
  if (!projectDir) return;

  const files = await listProjectSourceFiles(projectDir);
  const accum: ExtractedTokens = emptyExtractedTokens();
  for (const f of files) {
    let text: string;
    try {
      text = await readFile(f.path, 'utf8');
    } catch {
      continue;
    }
    const extracted = f.kind === 'css'
      ? extractFromCss(text, f.path)
      : extractFromHtml(text, f.path);
    mergeAccumulator(accum, extracted);
  }

  await withDsLock(dsId, async () => {
    const current = await readVariables(dsDir);
    if (!current) return; // no DS variables file — bail
    const next = mergeExtractedIntoDs(current, accum);
    await saveVariables(dsDir, next);
  });
  cfg.onSyncRun?.(projectId);
}

function mergeAccumulator(target: ExtractedTokens, incoming: ExtractedTokens): void {
  function merge<V>(
    targetArr: { value: V; usageCount: number; sourceFiles: string[] }[],
    incomingArr: typeof targetArr,
  ): void {
    for (const t of incomingArr) {
      const existing = targetArr.find((x) => x.value === t.value);
      if (existing) {
        existing.usageCount += t.usageCount;
        for (const sf of t.sourceFiles) {
          if (!existing.sourceFiles.includes(sf)) existing.sourceFiles.push(sf);
        }
      } else {
        targetArr.push({ ...t, sourceFiles: [...t.sourceFiles] });
      }
    }
  }
  merge(target.colors, incoming.colors);
  merge(target.fonts, incoming.fonts);
  merge(target.sizes, incoming.sizes);
  merge(target.spacing, incoming.spacing);
}
