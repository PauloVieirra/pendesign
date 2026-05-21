// Plan §3.D — built-in atom workers.
//
// Registered on first use into the worker registry. Every atom in
// FIRST_PARTY_ATOMS gets at least a permissive worker so the
// registry-driven pipeline runner stays at parity with the v1 stub
// for atoms whose real work happens entirely inside the agent CLI
// (file-write, todo-write, media-image, …) — the daemon has no
// independent ground truth to observe there and shipping a real
// watcher would force the agent into a fixed protocol we explicitly
// kept out of scope.
//
// Two atoms have daemon-observable behaviour today:
//
//   - `critique-theater` walks the run's devloop audit log
//     (`run_devloop_iterations.critique_summary`) and surfaces the
//     most recent numeric score it finds. Picking "latest" rather
//     than "lowest" matches real critique-loop semantics: the agent
//     revises based on prior critique, so each new score reflects
//     the current quality bar, not the worst earlier attempt.
//
//   - `figma-extract` calls the Figma REST API directly with the
//     user's PAT (sourced from mcp-config.json:servers.figma-context
//     or the FIGMA_TOKEN env var). Writing tree.json + tokens.json
//     to <cwd>/figma/ before the agent runs guarantees the rest of
//     the pipeline has a deterministic on-disk pivot, even if the
//     agent doesn't call the Framelink MCP server itself.

import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { FIRST_PARTY_ATOMS } from '../atoms.js';
import { getFigmaPat } from '../../mcp-config.js';
import { extractNodeId, runFigmaExtract } from './figma-extract.js';
import {
  registerAtomWorker,
  type AtomOutcome,
  type AtomWorkerContext,
} from './registry.js';

let installed = false;

export function registerBuiltInAtomWorkers(): void {
  if (installed) return;
  for (const atom of FIRST_PARTY_ATOMS) {
    if (atom.id === 'critique-theater') {
      registerAtomWorker({
        id:       atom.id,
        describe: 'reads run_devloop_iterations.critique_summary for real critique scores',
        run:      critiqueTheaterWorker,
      });
      continue;
    }
    if (atom.id === 'figma-extract') {
      registerAtomWorker({
        id:       atom.id,
        describe: 'native Figma REST extraction using PAT from mcp-config / FIGMA_TOKEN',
        run:      figmaExtractWorker,
      });
      continue;
    }
    registerAtomWorker({
      id:       atom.id,
      describe: 'permissive default (daemon has no independent ground truth for this atom)',
      run:      () => ({ signals: {} }),
    });
  }
  installed = true;
}

export function resetBuiltInAtomWorkersForTests(): void {
  installed = false;
}

async function critiqueTheaterWorker(ctx: AtomWorkerContext): Promise<AtomOutcome> {
  type Row = { iteration: number; critique_summary: string | null };
  const rows = ctx.db
    .prepare(
      'SELECT iteration, critique_summary FROM run_devloop_iterations WHERE run_id = ? AND stage_id = ? ORDER BY iteration DESC',
    )
    .all(ctx.runId, ctx.stage.id) as Row[];
  let baseScore: number | null = null;
  let baseIteration: number | null = null;
  for (const row of rows) {
    const score = parseCritiqueScore(row.critique_summary);
    if (score === null) continue;
    baseScore = score;
    baseIteration = row.iteration;
    break;
  }
  const structural = await reactSplitPenalty(ctx);
  if (baseScore === null && structural === null) {
    return { signals: {} };
  }
  const finalScore = (() => {
    if (baseScore !== null && structural !== null) return Math.min(baseScore, structural.cappedScore);
    if (structural !== null) return structural.cappedScore;
    return baseScore as number;
  })();
  const noteParts: string[] = [];
  if (baseScore !== null) noteParts.push(`latest critique score=${baseScore} from iteration ${baseIteration}`);
  if (structural !== null) noteParts.push(structural.note);
  return {
    signals: { 'critique.score': finalScore },
    note:    noteParts.join('; '),
  };
}

// React-output structural gate. When the active scenario emits React
// and a page file contains more than one component declaration, the
// agent is inlining components that should live under `components/`.
// Cap the critique score at REACT_INLINE_SCORE_CAP so the devloop
// triggers another iteration, even if the LLM critique self-graded
// the work as passing.
const REACT_INLINE_SCORE_CAP = 3;

async function reactSplitPenalty(
  ctx: AtomWorkerContext,
): Promise<{ cappedScore: number; note: string } | null> {
  if (!ctx.cwd) return null;
  const outputFormat = stringInput(ctx.snapshot.inputs?.outputFormat).toLowerCase();
  if (outputFormat !== 'react') return null;
  const pagesDir = path.join(ctx.cwd, 'pages');
  let entries: string[];
  try {
    entries = await fsp.readdir(pagesDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
  const offenders: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.tsx') && !entry.endsWith('.jsx')) continue;
    let src: string;
    try {
      src = await fsp.readFile(path.join(pagesDir, entry), 'utf8');
    } catch {
      continue;
    }
    if (countComponentDeclarations(src) > 1) {
      offenders.push(entry);
    }
  }
  if (offenders.length === 0) return null;
  return {
    cappedScore: REACT_INLINE_SCORE_CAP,
    note:        `react-split: ${offenders.length} page(s) declare inline components — move them under <cwd>/components/ (${offenders.slice(0, 3).join(', ')}${offenders.length > 3 ? '…' : ''})`,
  };
}

// Counts top-level component declarations in a React source file.
// A "component" is a function whose name starts with an uppercase
// letter — either `function Foo` or `const Foo =`. We deliberately
// keep the heuristic shallow: tools like SWC AST would be more
// precise but pull in a parser dependency the gate doesn't need.
function countComponentDeclarations(src: string): number {
  let count = 0;
  const patterns = [
    /\bfunction\s+([A-Z]\w*)\s*\(/g,
    /\bconst\s+([A-Z]\w*)\s*[:=]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) count++;
  }
  return count;
}

// Matches `score=4`, `score: 4.5`, `Critique score 4/5`, etc.
function parseCritiqueScore(summary: string | null): number | null {
  if (!summary) return null;
  const match = summary.match(/score\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

// figma-extract worker — sources the PAT and calls runFigmaExtract.
// Signals:
//   - figma.tree.nodes: total node count of the screens tree (0 on failure)
//   - figma.components.nodes: total node count of the components tree
//     (only emitted when componentsUrl was provided and extraction succeeded)
// Notes ride into run_devloop_iterations.critique_summary so the human
// can audit why a run failed without trawling daemon logs.
async function figmaExtractWorker(ctx: AtomWorkerContext): Promise<AtomOutcome> {
  if (!ctx.cwd || !ctx.dataDir) {
    return {
      signals: { 'figma.tree.nodes': 0 },
      note:    'figma-extract skipped: missing cwd or dataDir in worker context',
    };
  }
  const figmaUrl = stringInput(ctx.snapshot.inputs?.figmaUrl);
  if (!figmaUrl) {
    return {
      signals: { 'figma.tree.nodes': 0 },
      note:    'figma-extract skipped: input "figmaUrl" is empty',
    };
  }
  const pat = await getFigmaPat(ctx.dataDir);
  if (!pat) {
    return {
      signals: { 'figma.tree.nodes': 0 },
      note:    'figma-extract failed: no Figma PAT configured (Settings → MCP → figma-context, or export FIGMA_TOKEN)',
    };
  }
  const componentsUrl = stringInput(ctx.snapshot.inputs?.componentsUrl);
  const componentsNodeId = extractNodeId(componentsUrl);
  try {
    const report = await runFigmaExtract({
      cwd:     ctx.cwd,
      fileUrl: figmaUrl,
      token:   pat,
      // Spread so `exactOptionalPropertyTypes` doesn't see an
      // explicit `undefined` when no components URL was provided.
      ...(componentsNodeId ? { componentsNodeId } : {}),
    });
    const noteParts: string[] = [
      `figma-extract: ${report.meta.nodeCount} nodes from ${report.meta.fileKey}`,
    ];
    if (componentsNodeId) {
      noteParts.push(`components root=${componentsNodeId}`);
    }
    return {
      signals: { 'figma.tree.nodes': report.meta.nodeCount },
      note:    noteParts.join('; '),
    };
  } catch (err) {
    return {
      signals: { 'figma.tree.nodes': 0 },
      note:    `figma-extract failed: ${(err as Error).message ?? String(err)}`,
    };
  }
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
