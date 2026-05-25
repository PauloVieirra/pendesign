import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  migrateLeanInception,
  upsertInceptionForProject,
  listCardsByDocument,
} from '../../src/lean-inception/persistence.js';
import { extractDocumentForInception } from '../../src/lean-inception/extraction-service.js';
import type { LeanInceptionRuntimeInvoker } from '../../src/lean-inception/runtime-invoke.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateLeanInception(db);
  return db;
}

function tmpStorageRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'li-envelope-'));
}

const claudeEnvelopeInvoker = (innerCards: object): LeanInceptionRuntimeInvoker =>
  async () => ({
    rawStdout: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: JSON.stringify(innerCards),
      usage: { input_tokens: 500, output_tokens: 120 },
      session_id: 'sess_x',
    }),
    durationMs: 50,
    model: 'claude-opus-4-7',
    promptTokens: null,
    outputTokens: null,
  });

describe('extraction-service — Claude CLI envelope', () => {
  it('unwraps `{result: "<json string>"}` envelope before validating', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const docContent = '# Vision\nBuild the best product.';

    const invoker = claudeEnvelopeInvoker({
      cards: [
        {
          column_key: 'vision',
          title: 'Build best product',
          content: 'desc',
          confidence: 'high',
          source_anchor: 'Build the best product.',
          source_line: 2,
        },
      ],
    });

    const result = await extractDocumentForInception({
      db,
      inception,
      storageRoot,
      runtime: 'claude',
      invoke: invoker,
      document: {
        filename: 'a.md',
        mimeType: 'text/markdown',
        content: Buffer.from(docContent),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(listCardsByDocument(db, result.documentId)).toHaveLength(1);
  });

  it('extracts token counts from envelope usage field', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const docContent = '# Vision\nBuild the best product.';

    const invoker = claudeEnvelopeInvoker({
      cards: [
        {
          column_key: 'vision',
          title: 'Build best product',
          content: 'desc',
          confidence: 'high',
          source_anchor: 'Build the best product.',
          source_line: 2,
        },
      ],
    });

    const result = await extractDocumentForInception({
      db,
      inception,
      storageRoot,
      runtime: 'claude',
      invoke: invoker,
      document: {
        filename: 'b.md',
        mimeType: 'text/markdown',
        content: Buffer.from(docContent),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.extractionInfo.prompt_tokens).toBe(500);
    expect(result.extractionInfo.output_tokens).toBe(120);
  });

  it('falls back to raw value when no envelope (direct cards JSON)', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const invoker: LeanInceptionRuntimeInvoker = async () => ({
      rawStdout: JSON.stringify({ cards: [] }),
      durationMs: 10,
      model: null,
      promptTokens: null,
      outputTokens: null,
    });

    const result = await extractDocumentForInception({
      db,
      inception,
      storageRoot,
      runtime: 'claude',
      invoke: invoker,
      document: {
        filename: 'c.md',
        mimeType: 'text/markdown',
        content: Buffer.from('hi'),
      },
    });
    expect(result.ok).toBe(true);
  });

  it('includes raw head in error message when schema validation fails after envelope unwrap', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();

    // Envelope wraps invalid inner JSON (not an object with `cards`)
    const invoker: LeanInceptionRuntimeInvoker = async () => ({
      rawStdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: JSON.stringify({ wrong_field: 'oops' }),
        usage: { input_tokens: 10, output_tokens: 5 },
        session_id: 'sess_y',
      }),
      durationMs: 10,
      model: null,
      promptTokens: null,
      outputTokens: null,
    });

    const result = await extractDocumentForInception({
      db,
      inception,
      storageRoot,
      runtime: 'claude',
      invoke: invoker,
      document: {
        filename: 'd.md',
        mimeType: 'text/markdown',
        content: Buffer.from('some content'),
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });
});
