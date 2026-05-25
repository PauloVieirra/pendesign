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
} from './lean-inception/persistence.js';
import {
  extractDocumentForInception,
  type ExtractionInfoSnapshot,
} from './lean-inception/extraction-service.js';
import type { LeanInceptionRuntimeInvoker } from './lean-inception/runtime-invoke.js';
import { invokeAgentForExtraction } from './lean-inception/runtime-invoke.js';

export interface LeanInceptionRoutesDeps {
  db: Database.Database;
  storageRoot: string;
  runtimeInvoker?: LeanInceptionRuntimeInvoker;
  defaultRuntime?: string;
}

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
    const extractions: ExtractionInfoSnapshot[] = [];
    for (const docInput of parse.data.documents) {
      const buf = Buffer.from(docInput.content_base64, 'base64');
      const result = await extractDocumentForInception({
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
      });
      if (!result.ok) {
        const status =
          result.error.code === 'DOCUMENT_TOO_LARGE' ? 413
          : result.error.code === 'RUNTIME_UNAVAILABLE' ? 503
          : result.error.code === 'EXTRACTION_TIMEOUT' ? 504
          : 400;
        return sendError(res, status, result.error);
      }
      extractions.push(result.extractionInfo);
    }
    res.json({
      state: readInceptionState(deps.db, inception.id),
      extractions,
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
