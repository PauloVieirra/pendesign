import fs from 'node:fs';
import path from 'node:path';
import {
  LEAN_INCEPTION_COLUMN_KEYS,
  type LeanInceptionColumnKey,
} from './column-keys.js';
import { computeContentHash } from './content-hash.js';
import { isAnchorValid } from './validate-anchor.js';
import { parseLlmJsonOutput } from './parse-llm-output.js';
import {
  LEAN_INCEPTION_SYSTEM_PROMPT_V1,
  LEAN_INCEPTION_PROMPT_VERSION,
  buildUserPromptV1,
} from './prompts/v1.js';
import {
  findDocumentByHash,
  findDocumentByFilename,
  insertDocument,
  deleteDocument,
  insertExtraction,
  finalizeExtraction,
  insertCardsAtomic,
  updateDocumentExtractionStatus,
  type InceptionRow,
} from './persistence.js';
import type { LeanInceptionRuntimeInvoker } from './runtime-invoke.js';
import type {
  LeanInceptionErrorCode,
  LeanInceptionError,
} from '@open-design/contracts';
import type Database from 'better-sqlite3';

type SqliteDb = Database.Database;

const MAX_BYTES = 500 * 1024;
const EXTRACTION_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Manual schema validation for LLM output (no direct zod dependency in daemon)
// ---------------------------------------------------------------------------

interface RawCard {
  column_key: LeanInceptionColumnKey;
  title: string;
  content: string;
  confidence: 'low' | 'medium' | 'high';
  source_anchor: string;
  source_line: number | null;
}

type ValidationResult =
  | { ok: true; cards: RawCard[] }
  | { ok: false; message: string };

function validateRawOutput(value: unknown): ValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, message: 'output is not an object' };
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj['cards'])) {
    return { ok: false, message: 'output.cards is not an array' };
  }
  const cards: RawCard[] = [];
  for (let i = 0; i < obj['cards'].length; i++) {
    const c = obj['cards'][i] as Record<string, unknown>;
    if (typeof c !== 'object' || c === null) {
      return { ok: false, message: `card[${i}] is not an object` };
    }
    if (!(LEAN_INCEPTION_COLUMN_KEYS as readonly string[]).includes(c['column_key'] as string)) {
      return { ok: false, message: `card[${i}].column_key is invalid: ${c['column_key']}` };
    }
    if (typeof c['title'] !== 'string' || c['title'].length < 5 || c['title'].length > 120) {
      return { ok: false, message: `card[${i}].title must be a string between 5 and 120 chars` };
    }
    if (typeof c['content'] !== 'string' || c['content'].length < 1) {
      return { ok: false, message: `card[${i}].content must be a non-empty string` };
    }
    if (!['low', 'medium', 'high'].includes(c['confidence'] as string)) {
      return { ok: false, message: `card[${i}].confidence must be low|medium|high` };
    }
    if (
      typeof c['source_anchor'] !== 'string' ||
      c['source_anchor'].length < 1 ||
      c['source_anchor'].length > 280
    ) {
      return { ok: false, message: `card[${i}].source_anchor must be a string between 1 and 280 chars` };
    }
    if (c['source_line'] !== null && typeof c['source_line'] !== 'number') {
      return { ok: false, message: `card[${i}].source_line must be a number or null` };
    }
    if (typeof c['source_line'] === 'number' && (!Number.isInteger(c['source_line']) || c['source_line'] <= 0)) {
      return { ok: false, message: `card[${i}].source_line must be a positive integer` };
    }
    cards.push({
      column_key: c['column_key'] as LeanInceptionColumnKey,
      title: c['title'] as string,
      content: c['content'] as string,
      confidence: c['confidence'] as 'low' | 'medium' | 'high',
      source_anchor: c['source_anchor'] as string,
      source_line: (c['source_line'] as number | null) ?? null,
    });
  }
  return { ok: true, cards };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExtractDocumentInput {
  filename: string;
  mimeType: 'text/markdown' | 'text/plain';
  content: Buffer;
}

export interface ExtractDocumentForInceptionParams {
  db: SqliteDb;
  inception: InceptionRow;
  storageRoot: string;
  runtime: string;
  invoke: LeanInceptionRuntimeInvoker;
  document: ExtractDocumentInput;
}

export type ExtractionResult =
  | {
      ok: true;
      documentId: string;
      cardsPersisted: number;
      cardsDropped: number;
      extractionInfo: ExtractionInfoSnapshot;
    }
  | { ok: false; error: LeanInceptionError; documentId?: string };

export interface ExtractionInfoSnapshot {
  runtime: string;
  model: string | null;
  prompt_version: number;
  duration_ms: number;
  prompt_tokens: number | null;
  output_tokens: number | null;
}

function errorResult(
  code: LeanInceptionErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ExtractionResult {
  return { ok: false, error: { code, message, details } };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function extractDocumentForInception(
  params: ExtractDocumentForInceptionParams,
): Promise<ExtractionResult> {
  const { db, inception, storageRoot, runtime, invoke, document } = params;

  // 1. Emptiness validation.
  if (
    document.content.byteLength === 0 ||
    document.content.toString('utf8').trim().length === 0
  ) {
    return errorResult('EMPTY_DOCUMENT', 'document content is empty', {
      filename: document.filename,
    });
  }

  // 2. Size validation.
  if (document.content.byteLength > MAX_BYTES) {
    return errorResult(
      'DOCUMENT_TOO_LARGE',
      `document exceeds ${MAX_BYTES} bytes`,
      { filename: document.filename, byte_size: document.content.byteLength },
    );
  }

  const contentText = document.content.toString('utf8');

  // 3. Idempotency: identical hash → return existing.
  const contentHash = computeContentHash(document.content);
  const sameHash = findDocumentByHash(db, inception.id, contentHash);
  if (sameHash) {
    const cardsPersistedRow = db
      .prepare('SELECT COUNT(*) AS c FROM lean_inception_cards WHERE document_id = ?')
      .get(sameHash.id) as { c: number };
    return {
      ok: true,
      documentId: sameHash.id,
      cardsPersisted: cardsPersistedRow.c,
      cardsDropped: 0,
      extractionInfo: {
        runtime,
        model: null,
        prompt_version: LEAN_INCEPTION_PROMPT_VERSION,
        duration_ms: 0,
        prompt_tokens: null,
        output_tokens: null,
      },
    };
  }

  // 4. Replace-by-filename: same filename + different hash → drop old.
  const sameName = findDocumentByFilename(db, inception.id, document.filename);
  if (sameName) {
    deleteDocument(db, sameName.id);
  }

  // 5. Persist doc + write file.
  const projectStorageDir = path.join(
    storageRoot,
    'projects',
    inception.project_id,
    'lean-inception',
    'docs',
  );
  fs.mkdirSync(projectStorageDir, { recursive: true });
  const ext = document.mimeType === 'text/markdown' ? '.md' : '.txt';

  // Insert with a provisional storage_path then patch with the real one once we know the doc id.
  const docRow = insertDocument(db, {
    inception_id: inception.id,
    filename: document.filename,
    mime_type: document.mimeType,
    byte_size: document.content.byteLength,
    content_hash: contentHash,
    storage_path: '__pending__',
  });
  const finalStorageAbs = path.join(projectStorageDir, `${docRow.id}${ext}`);
  fs.writeFileSync(finalStorageAbs, document.content);
  db.prepare('UPDATE lean_inception_documents SET storage_path = ? WHERE id = ?').run(
    path.relative(storageRoot, finalStorageAbs),
    docRow.id,
  );

  updateDocumentExtractionStatus(db, docRow.id, 'extracting');

  // 6. Begin extraction log.
  const extraction = insertExtraction(db, {
    inception_id: inception.id,
    document_id: docRow.id,
    runtime,
    model: null,
    prompt_version: LEAN_INCEPTION_PROMPT_VERSION,
  });

  // 7. Invoke runtime.
  let invokeResult;
  try {
    invokeResult = await invoke({
      runtime,
      systemPrompt: LEAN_INCEPTION_SYSTEM_PROMPT_V1,
      userPrompt: buildUserPromptV1({
        filename: document.filename,
        mimeType: document.mimeType,
        content: contentText,
      }),
      timeoutMs: EXTRACTION_TIMEOUT_MS,
    });
  } catch (err: any) {
    const code: LeanInceptionErrorCode =
      err?.code === 'RUNTIME_UNAVAILABLE'
        ? 'RUNTIME_UNAVAILABLE'
        : err?.code === 'EXTRACTION_TIMEOUT'
          ? 'EXTRACTION_TIMEOUT'
          : 'EXTRACTION_FAILED';
    finalizeExtraction(db, extraction.id, {
      status: 'failed',
      error_message: err?.message ?? String(err),
    });
    updateDocumentExtractionStatus(
      db,
      docRow.id,
      'failed',
      err?.message ?? String(err),
    );
    return {
      ok: false,
      error: { code, message: err?.message ?? String(err) },
      documentId: docRow.id,
    };
  }

  // 8. Parse JSON.
  const parsed = parseLlmJsonOutput(invokeResult.rawStdout);
  if (!parsed.ok) {
    finalizeExtraction(db, extraction.id, {
      status: 'failed',
      error_message: parsed.reason,
    });
    updateDocumentExtractionStatus(
      db,
      docRow.id,
      'failed',
      `parse: ${parsed.reason}`,
    );
    return {
      ok: false,
      error: { code: 'INVALID_JSON_OUTPUT', message: parsed.reason },
      documentId: docRow.id,
    };
  }

  // 9. Validate schema.
  const validation = validateRawOutput(parsed.value);
  if (!validation.ok) {
    finalizeExtraction(db, extraction.id, {
      status: 'failed',
      error_message: validation.message,
    });
    updateDocumentExtractionStatus(
      db,
      docRow.id,
      'failed',
      `schema: ${validation.message}`,
    );
    return {
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: validation.message,
      },
      documentId: docRow.id,
    };
  }

  // 10. Anchor verification: drop cards with paraphrased / hallucinated anchors.
  const acceptedCards: Array<Parameters<typeof insertCardsAtomic>[1][number]> = [];
  let dropped = 0;
  for (const c of validation.cards) {
    if (!isAnchorValid(c.source_anchor, contentText)) {
      dropped += 1;
      continue;
    }
    acceptedCards.push({
      inception_id: inception.id,
      document_id: docRow.id,
      column_key: c.column_key,
      title: c.title,
      content: c.content,
      confidence: c.confidence,
      source_anchor: c.source_anchor.slice(0, 280),
      source_line: c.source_line,
      extraction_id: extraction.id,
    });
  }

  // 11. Atomic card insert + finalize extraction log.
  insertCardsAtomic(db, acceptedCards);
  finalizeExtraction(db, extraction.id, {
    status: 'succeeded',
    cards_persisted: acceptedCards.length,
    cards_dropped: dropped,
    warnings_count: dropped,
    duration_ms: invokeResult.durationMs,
    prompt_tokens: invokeResult.promptTokens,
    output_tokens: invokeResult.outputTokens,
  });
  updateDocumentExtractionStatus(db, docRow.id, 'extracted', null);

  return {
    ok: true,
    documentId: docRow.id,
    cardsPersisted: acceptedCards.length,
    cardsDropped: dropped,
    extractionInfo: {
      runtime,
      model: invokeResult.model,
      prompt_version: LEAN_INCEPTION_PROMPT_VERSION,
      duration_ms: invokeResult.durationMs,
      prompt_tokens: invokeResult.promptTokens,
      output_tokens: invokeResult.outputTokens,
    },
  };
}
