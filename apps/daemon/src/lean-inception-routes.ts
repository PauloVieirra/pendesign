import type { Express, Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  ExtractDocumentsRequestSchema,
  type LeanInceptionError,
} from '@open-design/contracts';
import {
  upsertInceptionForProject,
  readInceptionState,
  listDocuments,
  deleteDocument,
  deleteInception,
  findCardById,
  deleteCard,
} from './lean-inception/persistence.js';
import {
  ingestDocumentForInception,
  runExtractionForDocument,
  type RagIngestor,
} from './lean-inception/extraction-service.js';
import { runResearchForInception } from './lean-inception/research-service.js';
import type { LeanInceptionRuntimeInvoker } from './lean-inception/runtime-invoke.js';
import { invokeAgentForExtraction } from './lean-inception/runtime-invoke.js';
import { ingestDoc } from './rag.js';

export interface LeanInceptionRoutesDeps {
  db: Database.Database;
  storageRoot: string;
  runtimeInvoker?: LeanInceptionRuntimeInvoker;
  defaultRuntime?: string;
  ragIngest?: RagIngestor;
}

/** Per-inception in-flight extraction promise; serialises concurrent POSTs. */
const inFlightExtractions = new Map<string, Promise<void>>();

function sendError(res: Response, status: number, error: LeanInceptionError) {
  res.status(status).json({ error });
}

function safeRm(absolutePath: string) {
  try { fs.rmSync(absolutePath, { force: true }); } catch { /* best-effort */ }
}

function wrap(handler: (req: Request, res: Response) => unknown | Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((err) => {
        if (res.headersSent) { next(err); return; }
        sendError(res, 500, {
          code: 'EXTRACTION_FAILED',
          message: err instanceof Error ? err.message : String(err),
        });
      });
  };
}

export function registerLeanInceptionRoutes(app: Express, deps: LeanInceptionRoutesDeps) {
  const invoker = deps.runtimeInvoker ?? invokeAgentForExtraction;
  const defaultRuntime = deps.defaultRuntime ?? 'claude';

  // Build the RAG ingestor: use the injected one from tests, or the real one.
  const ragIngest: RagIngestor = deps.ragIngest ?? (async ({ projectId, name, content }) => {
    try {
      await ingestDoc(deps.db, projectId, { name, content });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[lean-inception] RAG ingest failed for', name, err);
    }
  });

  app.get('/api/projects/:projectId/lean-inception', wrap((req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId!);
    res.json({ state: readInceptionState(deps.db, inception.id) });
  }));

  app.get('/api/projects/:projectId/lean-inception/documents', wrap((req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId!);
    const state = readInceptionState(deps.db, inception.id);
    res.json({ documents: state.documents });
  }));

  app.post('/api/projects/:projectId/lean-inception/documents', wrap(async (req, res) => {
    const parse = ExtractDocumentsRequestSchema.safeParse(req.body);
    if (!parse.success) {
      return sendError(res, 400, {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: parse.error.message,
      });
    }
    const inception = upsertInceptionForProject(deps.db, req.params.projectId!);
    const runtime = parse.data.runtime ?? defaultRuntime;

    // Phase 1 (synchronous): validate + persist doc rows + fire RAG.
    // Collect (ingestResult, docInput) pairs so we can kick off background work.
    const ingestPairs: Array<{
      ingestResult: import('./lean-inception/extraction-service.js').IngestResult;
      docInput: (typeof parse.data.documents)[number];
    }> = [];

    for (const docInput of parse.data.documents) {
      const buf = Buffer.from(docInput.content_base64, 'base64');
      const ingestResult = await ingestDocumentForInception({
        db: deps.db,
        inception,
        storageRoot: deps.storageRoot,
        runtime,
        invoke: invoker,
        document: {
          filename: docInput.filename,
          mimeType: docInput.mime_type,
          content: buf,
        },
        ragIngest,
      });

      if (!ingestResult.ok) {
        const status =
          ingestResult.error.code === 'DOCUMENT_TOO_LARGE' ? 413
          : ingestResult.error.code === 'RUNTIME_UNAVAILABLE' ? 503
          : ingestResult.error.code === 'EXTRACTION_TIMEOUT' ? 504
          : 400;
        return sendError(res, status, ingestResult.error);
      }

      ingestPairs.push({ ingestResult, docInput });
    }

    // Respond 202 immediately with the current state (docs show extraction_status='extracting').
    res.status(202).json({ state: readInceptionState(deps.db, inception.id) });

    // Phase 2 (background): kick off the actual LLM extraction after responding.
    // Serialise per inception to avoid concurrent extractions for the same project.
    const backgroundWork = async () => {
      for (const { ingestResult, docInput } of ingestPairs) {
        // Skip idempotency fast-path (existing doc, no real extraction needed).
        if (!ingestResult.extractionId) continue;

        const buf = Buffer.from(docInput.content_base64, 'base64');
        await runExtractionForDocument({
          db: deps.db,
          inception,
          runtime,
          invoke: invoker,
          document: {
            filename: docInput.filename,
            mimeType: docInput.mime_type,
            content: buf,
          },
          documentId: ingestResult.documentId,
          extractionId: ingestResult.extractionId,
          contentText: ingestResult.contentText,
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[lean-inception] background extraction error for', docInput.filename, err);
        });
      }

      // After all docs are processed, run market research + ideation enrichment.
      try {
        await runResearchForInception({
          db: deps.db, inception, runtime, invoke: invoker,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[lean-inception] research enrichment failed', err);
      }
    };

    setImmediate(() => {
      const previous = inFlightExtractions.get(inception.id) ?? Promise.resolve();
      const next = previous.then(backgroundWork).catch(() => { /* logged inside */ });
      inFlightExtractions.set(inception.id, next);
      void next.finally(() => {
        // Remove from map only when this is still the latest promise.
        if (inFlightExtractions.get(inception.id) === next) {
          inFlightExtractions.delete(inception.id);
        }
      });
    });
  }));

  app.delete('/api/projects/:projectId/lean-inception/documents/:docId', wrap((req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId!);
    const docId = req.params.docId!;
    const target = listDocuments(deps.db, inception.id).find(d => d.id === docId);
    if (!target) {
      return sendError(res, 404, {
        code: 'DOCUMENT_NOT_FOUND',
        message: `document not found: ${docId}`,
      });
    }
    deleteDocument(deps.db, target.id);
    safeRm(path.resolve(deps.storageRoot, target.storage_path));
    res.json({ state: readInceptionState(deps.db, inception.id) });
  }));

  app.delete('/api/projects/:projectId/lean-inception/cards/:cardId', wrap((req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId!);
    const cardId = req.params.cardId!;
    const card = findCardById(deps.db, cardId);
    if (!card || card.inception_id !== inception.id) {
      return sendError(res, 404, {
        code: 'CARD_NOT_FOUND',
        message: `card not found: ${cardId}`,
      });
    }
    deleteCard(deps.db, cardId);
    res.json({ state: readInceptionState(deps.db, inception.id) });
  }));

  app.delete('/api/projects/:projectId/lean-inception', wrap((req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId!);
    const docs = listDocuments(deps.db, inception.id);
    deleteInception(deps.db, inception.id);
    for (const doc of docs) {
      safeRm(path.resolve(deps.storageRoot, doc.storage_path));
    }
    res.json({ ok: true });
  }));
}
