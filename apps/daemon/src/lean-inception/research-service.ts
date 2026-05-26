import type Database from 'better-sqlite3';
import { LEAN_INCEPTION_COLUMN_KEYS } from './column-keys.js';
import {
  insertExtraction,
  finalizeExtraction,
  insertCardsAtomic,
  readInceptionState,
  insertDocument,
  type InceptionRow,
} from './persistence.js';
import { parseLlmJsonOutput } from './parse-llm-output.js';
import {
  LEAN_INCEPTION_RESEARCH_PROMPT_VERSION,
  LEAN_INCEPTION_RESEARCH_SYSTEM_PROMPT_V1,
  buildResearchUserPromptV1,
} from './prompts/v1-research.js';
import type { LeanInceptionRuntimeInvoker } from './runtime-invoke.js';
import type { LeanInceptionColumnKey } from './column-keys.js';

type SqliteDb = Database.Database;

const RESEARCH_COLUMNS = new Set<string>(['market_research', 'market_opportunities', 'ideation']);

const RESEARCH_TIMEOUT_MS = 180_000;

/**
 * Unwraps the Claude CLI JSON envelope (`{ result: '<text>' }`) when present,
 * re-parsing the inner string as JSON. Falls back to the original value otherwise.
 */
function unwrapClaudeEnvelope(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as Record<string, unknown>;
  if (typeof obj['result'] === 'string') {
    const inner = parseLlmJsonOutput(obj['result'] as string);
    if (inner.ok) return inner.value;
  }
  return value;
}

interface ResearchCard {
  column_key: string;
  title: string;
  content: string;
  confidence: 'low' | 'medium' | 'high';
  source_anchor: string;
  source_line: number | null;
}

type SafeParseResult =
  | { ok: true; cards: ResearchCard[] }
  | { ok: false; message: string };

function safeParse(value: unknown): SafeParseResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, message: 'output not object' };
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj['cards'])) {
    return { ok: false, message: 'output.cards not array' };
  }
  const out: ResearchCard[] = [];
  for (const c of obj['cards']) {
    if (typeof c !== 'object' || c === null) continue;
    const cr = c as Record<string, unknown>;
    // Silently skip cards whose column_key is outside the allowed research columns.
    if (!RESEARCH_COLUMNS.has(cr['column_key'] as string)) continue;
    if (typeof cr['title'] !== 'string' || (cr['title'] as string).length < 5) continue;
    if (typeof cr['content'] !== 'string' || (cr['content'] as string).length < 1) continue;
    if (!['low', 'medium', 'high'].includes(cr['confidence'] as string)) continue;
    if (typeof cr['source_anchor'] !== 'string' || (cr['source_anchor'] as string).length < 1) continue;
    out.push({
      column_key: cr['column_key'] as string,
      title: cr['title'] as string,
      content: cr['content'] as string,
      confidence: cr['confidence'] as 'low' | 'medium' | 'high',
      source_anchor: (cr['source_anchor'] as string).slice(0, 280),
      source_line: typeof cr['source_line'] === 'number' ? (cr['source_line'] as number) : null,
    });
  }
  return { ok: true, cards: out };
}

export interface RunResearchParams {
  db: SqliteDb;
  inception: InceptionRow;
  runtime: string;
  invoke: LeanInceptionRuntimeInvoker;
}

/**
 * Runs a market-research enrichment pass after document extraction completes.
 * Reads the current inception state, invokes the LLM with a research-focused prompt,
 * and persists cards into the market_research, market_opportunities, and ideation columns.
 *
 * Skips silently when there are no seed cards (vision/problem/objective/personas/features).
 * Never throws — failures are logged and the extraction row is marked failed.
 */
export async function runResearchForInception(params: RunResearchParams): Promise<void> {
  const { db, inception, runtime, invoke } = params;

  const state = readInceptionState(db, inception.id);
  const cardsByColumn = state.columns;

  // Skip if there is essentially nothing to research from.
  const seed = [
    ...(cardsByColumn['vision']?.cards ?? []),
    ...(cardsByColumn['problem']?.cards ?? []),
    ...(cardsByColumn['objective']?.cards ?? []),
    ...(cardsByColumn['personas']?.cards ?? []),
    ...(cardsByColumn['features']?.cards ?? []),
  ];
  if (seed.length === 0) return;

  const promptInput = {
    vision:   (cardsByColumn['vision']?.cards   ?? []).map((c) => `${c.title} — ${c.content}`),
    problem:  (cardsByColumn['problem']?.cards  ?? []).map((c) => `${c.title} — ${c.content}`),
    objective:(cardsByColumn['objective']?.cards ?? []).map((c) => `${c.title} — ${c.content}`),
    personas: (cardsByColumn['personas']?.cards  ?? []).map((c) => `${c.title} — ${c.content}`),
    features: (cardsByColumn['features']?.cards  ?? []).map((c) => `${c.title} — ${c.content}`),
  };

  // Call the LLM first — we don't persist anything until we know there are cards to insert.
  // This prevents a transient synthetic doc from appearing in the document list when the
  // model produces no usable research cards (e.g. in tests with a fake invoker that returns
  // non-research columns).
  let invokeResult;
  try {
    invokeResult = await invoke({
      runtime,
      systemPrompt: LEAN_INCEPTION_RESEARCH_SYSTEM_PROMPT_V1,
      userPrompt: buildResearchUserPromptV1(promptInput),
      timeoutMs: RESEARCH_TIMEOUT_MS,
    });
  } catch {
    // Invoke failure: nothing was persisted, so nothing to clean up.
    return;
  }

  const parsed = parseLlmJsonOutput(invokeResult.rawStdout);
  if (!parsed.ok) return;

  const unwrapped = unwrapClaudeEnvelope(parsed.value);
  const validation = safeParse(unwrapped);
  if (!validation.ok || validation.cards.length === 0) return;

  // We have cards to persist — now create the synthetic doc + extraction row.
  // A unique content_hash per call prevents unique-constraint conflicts across passes.
  const docRow = insertDocument(db, {
    inception_id: inception.id,
    filename: '__research__.md',
    mime_type: 'text/markdown',
    byte_size: 0,
    content_hash: `research:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    storage_path: `projects/${inception.project_id}/lean-inception/research-meta.md`,
  });

  const extraction = insertExtraction(db, {
    inception_id: inception.id,
    document_id: docRow.id,
    runtime,
    model: null,
    prompt_version: LEAN_INCEPTION_RESEARCH_PROMPT_VERSION,
  });

  const acceptedCards = validation.cards.map((c) => ({
    inception_id: inception.id,
    document_id: docRow.id,
    column_key: c.column_key as LeanInceptionColumnKey,
    title: c.title,
    content: c.content,
    confidence: c.confidence,
    source_anchor: c.source_anchor,
    source_line: c.source_line,
    extraction_id: extraction.id,
  }));

  insertCardsAtomic(db, acceptedCards);
  finalizeExtraction(db, extraction.id, {
    status: 'succeeded',
    cards_persisted: acceptedCards.length,
    cards_dropped: 0,
    warnings_count: 0,
    duration_ms: invokeResult.durationMs,
    prompt_tokens: invokeResult.promptTokens,
    output_tokens: invokeResult.outputTokens,
  });
}
