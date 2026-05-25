import type { Express } from 'express';
import type Database from 'better-sqlite3';
import {
  ExtractDocumentsRequestSchema,
  type LeanInceptionError,
} from '@open-design/contracts';
import {
  upsertInceptionForProject,
  readInceptionState,
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

function sendError(res: any, status: number, error: LeanInceptionError) {
  res.status(status).json({ error });
}

export function registerLeanInceptionRoutes(app: Express, deps: LeanInceptionRoutesDeps) {
  const invoker = deps.runtimeInvoker ?? invokeAgentForExtraction;
  const defaultRuntime = deps.defaultRuntime ?? 'claude';

  app.get('/api/projects/:projectId/lean-inception', (req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId);
    res.json({ state: readInceptionState(deps.db, inception.id) });
  });

  app.get('/api/projects/:projectId/lean-inception/documents', (req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId);
    const state = readInceptionState(deps.db, inception.id);
    res.json({ documents: state.documents });
  });

  app.post('/api/projects/:projectId/lean-inception/documents', async (req, res) => {
    const parse = ExtractDocumentsRequestSchema.safeParse(req.body);
    if (!parse.success) {
      return sendError(res, 400, {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: parse.error.message,
      });
    }
    const inception = upsertInceptionForProject(deps.db, req.params.projectId);
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
  });

  app.delete('/api/projects/:projectId/lean-inception/documents/:docId', (req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId);
    const removed = deleteDocument(deps.db, req.params.docId);
    if (!removed) {
      return sendError(res, 404, {
        code: 'DOCUMENT_NOT_FOUND',
        message: `document not found: ${req.params.docId}`,
      });
    }
    res.json({ state: readInceptionState(deps.db, inception.id) });
  });

  app.delete('/api/projects/:projectId/lean-inception', (req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId);
    deleteInception(deps.db, inception.id);
    res.json({ ok: true });
  });
}
