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
  buildImagePromptV1,
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
// Claude CLI envelope helpers
// ---------------------------------------------------------------------------

/**
 * `claude -p --output-format json` wraps the model's actual text output inside
 * an envelope: `{ type: 'result', subtype, is_error, result: '<text>', usage, session_id }`.
 * When the envelope is present, parse the `result` string again to get the real value.
 * Falls back to the original value when no envelope is detected.
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

/**
 * Extract token counts from the Claude CLI JSON envelope's `usage` field.
 * Returns nulls when the envelope or its fields are absent.
 */
function readEnvelopeUsage(
  value: unknown,
): { prompt_tokens: number | null; output_tokens: number | null } {
  if (typeof value !== 'object' || value === null)
    return { prompt_tokens: null, output_tokens: null };
  const obj = value as Record<string, unknown>;
  const usage = obj['usage'];
  if (typeof usage !== 'object' || usage === null)
    return { prompt_tokens: null, output_tokens: null };
  const u = usage as Record<string, unknown>;
  return {
    prompt_tokens:
      typeof u['input_tokens'] === 'number' ? (u['input_tokens'] as number) : null,
    output_tokens:
      typeof u['output_tokens'] === 'number' ? (u['output_tokens'] as number) : null,
  };
}

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
  mimeType: 'text/markdown' | 'text/plain' | 'image/png' | 'image/jpeg';
  content: Buffer;
}

/**
 * Optional RAG injector. When provided, the content of the ingested document
 * is fire-and-forget indexed into the project's vector store. Errors are
 * caught internally and never bubble up — RAG failure must NOT break extraction.
 */
export interface RagIngestor {
  (params: { projectId: string; name: string; content: string }): Promise<void>;
}

export interface ExtractDocumentForInceptionParams {
  db: SqliteDb;
  inception: InceptionRow;
  storageRoot: string;
  runtime: string;
  invoke: LeanInceptionRuntimeInvoker;
  document: ExtractDocumentInput;
  ragIngest?: RagIngestor;
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

/** Returned by `ingestDocumentForInception` on success. */
export interface IngestResult {
  ok: true;
  documentId: string;
  /** contentText extracted from the buffer — passed to runExtractionForDocument (empty for images). */
  contentText: string;
  extractionId: string;
}

export type IngestDocumentResult =
  | IngestResult
  | { ok: false; error: LeanInceptionError; documentId?: string };

export interface ExtractionInfoSnapshot {
  runtime: string;
  model: string | null;
  prompt_version: number;
  duration_ms: number;
  prompt_tokens: number | null;
  output_tokens: number | null;
}

export interface RunExtractionParams {
  db: SqliteDb;
  inception: InceptionRow;
  runtime: string;
  invoke: LeanInceptionRuntimeInvoker;
  document: ExtractDocumentInput;
  documentId: string;
  extractionId: string;
  /** For text documents: the decoded UTF-8 text. For image documents: empty string. */
  contentText: string;
}

function errorResult(
  code: LeanInceptionErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ExtractionResult {
  return { ok: false, error: { code, message, details } };
}

// ---------------------------------------------------------------------------
// Phase 1: synchronous ingestion (validate + persist doc row + fire RAG)
// ---------------------------------------------------------------------------

/**
 * Validates size/format/hash, persists the document row and writes the file,
 * opens an extraction row (status='extracting'), and returns immediately.
 * Also fires a fire-and-forget RAG ingest call when `ragIngest` is provided.
 *
 * Returns a discriminated union — callers should check `.ok` before calling
 * `runExtractionForDocument`.
 */
export async function ingestDocumentForInception(
  params: ExtractDocumentForInceptionParams,
): Promise<IngestDocumentResult> {
  const { db, inception, storageRoot, runtime, document, ragIngest } = params;

  const isImage = document.mimeType === 'image/png' || document.mimeType === 'image/jpeg';

  // 1. Emptiness validation.
  if (isImage) {
    // For images use byte length as the emptiness proxy (< 100 bytes is not a real image).
    if (document.content.byteLength < 100) {
      return { ok: false, error: { code: 'EMPTY_DOCUMENT', message: 'image content is too small', details: { filename: document.filename } } };
    }
  } else {
    if (
      document.content.byteLength === 0 ||
      document.content.toString('utf8').trim().length === 0
    ) {
      return { ok: false, error: { code: 'EMPTY_DOCUMENT', message: 'document content is empty', details: { filename: document.filename } } };
    }
  }

  // 2. Size validation.
  if (document.content.byteLength > MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: 'DOCUMENT_TOO_LARGE',
        message: `document exceeds ${MAX_BYTES} bytes`,
        details: { filename: document.filename, byte_size: document.content.byteLength },
      },
    };
  }

  // For images contentText is empty — the actual bytes are passed as an attachment in runExtractionForDocument.
  const contentText = isImage ? '' : document.content.toString('utf8');

  // 3. Idempotency: identical hash → return existing without re-running extraction.
  const contentHash = computeContentHash(document.content);
  const sameHash = findDocumentByHash(db, inception.id, contentHash);
  if (sameHash) {
    const cardsPersistedRow = db
      .prepare('SELECT COUNT(*) AS c FROM lean_inception_cards WHERE document_id = ?')
      .get(sameHash.id) as { c: number };
    const existingExtraction = db
      .prepare('SELECT id FROM lean_inception_extractions WHERE document_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(sameHash.id) as { id: string } | undefined;
    return {
      ok: true,
      documentId: sameHash.id,
      contentText,
      // Provide a sentinel extraction id so runExtractionForDocument can be skipped
      extractionId: existingExtraction?.id ?? '',
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
  const ext = document.mimeType === 'text/markdown' ? '.md'
    : document.mimeType === 'image/png' ? '.png'
    : document.mimeType === 'image/jpeg' ? '.jpg'
    : '.txt';

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

  // 7. Fire-and-forget RAG ingest (errors must not break ingestion; skip for images).
  if (ragIngest && !isImage) {
    void ragIngest({ projectId: inception.project_id, name: document.filename, content: contentText })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[lean-inception] RAG ingest failed for', document.filename, err);
      });
  }

  return {
    ok: true,
    documentId: docRow.id,
    contentText,
    extractionId: extraction.id,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: async runtime call + parse + persist cards
// ---------------------------------------------------------------------------

/**
 * Executes the LLM extraction for a document that has already been ingested
 * (status='extracting'). Updates the document status to 'extracted' or 'failed'
 * when done. This is safe to run in the background after the HTTP response has
 * been sent.
 */
export async function runExtractionForDocument(
  params: RunExtractionParams,
): Promise<ExtractionResult> {
  const { db, inception, runtime, invoke, document, documentId, extractionId, contentText } = params;

  const isImage = document.mimeType === 'image/png' || document.mimeType === 'image/jpeg';

  // 7. Invoke runtime.
  let invokeResult;
  try {
    const userPrompt = isImage
      ? buildImagePromptV1(document.filename)
      : buildUserPromptV1({
          filename: document.filename,
          mimeType: document.mimeType as 'text/markdown' | 'text/plain',
          content: contentText,
        });
    const baseReq = {
      runtime,
      systemPrompt: LEAN_INCEPTION_SYSTEM_PROMPT_V1,
      userPrompt,
      timeoutMs: EXTRACTION_TIMEOUT_MS,
    };
    invokeResult = await invoke(
      isImage
        ? { ...baseReq, attachments: [{ filename: document.filename, mimeType: document.mimeType, content: document.content }] }
        : baseReq,
    );
  } catch (err: any) {
    const code: LeanInceptionErrorCode =
      err?.code === 'RUNTIME_UNAVAILABLE'
        ? 'RUNTIME_UNAVAILABLE'
        : err?.code === 'EXTRACTION_TIMEOUT'
          ? 'EXTRACTION_TIMEOUT'
          : 'EXTRACTION_FAILED';
    finalizeExtraction(db, extractionId, {
      status: 'failed',
      error_message: err?.message ?? String(err),
    });
    updateDocumentExtractionStatus(
      db,
      documentId,
      'failed',
      err?.message ?? String(err),
    );
    return {
      ok: false,
      error: { code, message: err?.message ?? String(err) },
      documentId,
    };
  }

  // 8. Parse JSON.
  const parsed = parseLlmJsonOutput(invokeResult.rawStdout);
  if (!parsed.ok) {
    finalizeExtraction(db, extractionId, {
      status: 'failed',
      error_message: parsed.reason,
    });
    updateDocumentExtractionStatus(
      db,
      documentId,
      'failed',
      `parse: ${parsed.reason}`,
    );
    return {
      ok: false,
      error: { code: 'INVALID_JSON_OUTPUT', message: parsed.reason },
      documentId,
    };
  }

  // 9. Validate schema — unwrap Claude CLI envelope first.
  const unwrapped = unwrapClaudeEnvelope(parsed.value);
  const envelopeUsage = readEnvelopeUsage(parsed.value);
  const validation = validateRawOutput(unwrapped);
  if (!validation.ok) {
    finalizeExtraction(db, extractionId, {
      status: 'failed',
      error_message: `${validation.message} (raw head: ${JSON.stringify(unwrapped).slice(0, 200)})`,
    });
    updateDocumentExtractionStatus(
      db,
      documentId,
      'failed',
      `schema: ${validation.message}`,
    );
    return {
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: validation.message,
      },
      documentId,
    };
  }

  // 10. Anchor verification: drop cards with paraphrased / hallucinated anchors.
  // For image-derived cards there is no text to quote — the anchor must be exactly "image:<filename>".
  const expectedImageAnchor = `image:${document.filename}`;
  const acceptedCards: Array<Parameters<typeof insertCardsAtomic>[1][number]> = [];
  let dropped = 0;
  for (const c of validation.cards) {
    const anchorAcceptable = isImage
      ? c.source_anchor === expectedImageAnchor
      : isAnchorValid(c.source_anchor, contentText);
    if (!anchorAcceptable) {
      dropped += 1;
      continue;
    }
    acceptedCards.push({
      inception_id: inception.id,
      document_id: documentId,
      column_key: c.column_key,
      title: c.title,
      content: c.content,
      confidence: c.confidence,
      source_anchor: c.source_anchor.slice(0, 280),
      source_line: c.source_line,
      extraction_id: extractionId,
    });
  }

  // 11. Atomic card insert + finalize extraction log.
  const finalPromptTokens = envelopeUsage.prompt_tokens ?? invokeResult.promptTokens;
  const finalOutputTokens = envelopeUsage.output_tokens ?? invokeResult.outputTokens;

  insertCardsAtomic(db, acceptedCards);
  finalizeExtraction(db, extractionId, {
    status: 'succeeded',
    cards_persisted: acceptedCards.length,
    cards_dropped: dropped,
    warnings_count: dropped,
    duration_ms: invokeResult.durationMs,
    prompt_tokens: finalPromptTokens,
    output_tokens: finalOutputTokens,
  });
  updateDocumentExtractionStatus(db, documentId, 'extracted', null);

  return {
    ok: true,
    documentId,
    cardsPersisted: acceptedCards.length,
    cardsDropped: dropped,
    extractionInfo: {
      runtime,
      model: invokeResult.model,
      prompt_version: LEAN_INCEPTION_PROMPT_VERSION,
      duration_ms: invokeResult.durationMs,
      prompt_tokens: finalPromptTokens,
      output_tokens: finalOutputTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestrator (kept for backward compat + direct test usage)
// ---------------------------------------------------------------------------

export async function extractDocumentForInception(
  params: ExtractDocumentForInceptionParams,
): Promise<ExtractionResult> {
  const ingestResult = await ingestDocumentForInception(params);

  if (!ingestResult.ok) {
    return ingestResult;
  }

  // Idempotency fast-path: hash already existed, extraction row may be empty sentinel.
  if (!ingestResult.extractionId) {
    const cardsPersistedRow = params.db
      .prepare('SELECT COUNT(*) AS c FROM lean_inception_cards WHERE document_id = ?')
      .get(ingestResult.documentId) as { c: number };
    return {
      ok: true,
      documentId: ingestResult.documentId,
      cardsPersisted: cardsPersistedRow.c,
      cardsDropped: 0,
      extractionInfo: {
        runtime: params.runtime,
        model: null,
        prompt_version: LEAN_INCEPTION_PROMPT_VERSION,
        duration_ms: 0,
        prompt_tokens: null,
        output_tokens: null,
      },
    };
  }

  return runExtractionForDocument({
    db: params.db,
    inception: params.inception,
    runtime: params.runtime,
    invoke: params.invoke,
    document: params.document,
    documentId: ingestResult.documentId,
    extractionId: ingestResult.extractionId,
    contentText: ingestResult.contentText,
  });
}
