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

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'li-img-'));

describe('image documents', () => {
  it('extracts cards from an image attachment with image:<filename> anchor', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpRoot();

    const invoker: LeanInceptionRuntimeInvoker = async (req) => {
      // The invoker should have received the image as an attachment.
      expect(req.attachments?.[0]?.filename).toBe('screenshot.png');
      return {
        rawStdout: JSON.stringify({
          cards: [{
            column_key: 'features', title: 'Sign-in form',
            content: 'Email + password layout with primary CTA.',
            confidence: 'high',
            source_anchor: 'image:screenshot.png',
            source_line: null,
          }],
        }),
        durationMs: 100, model: 'claude-opus-4-7', promptTokens: 80, outputTokens: 30,
      };
    };

    // Use a buffer with > 100 bytes to pass the emptiness check.
    const imageBytes = Buffer.alloc(200, 0x89);

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: {
        filename: 'screenshot.png',
        mimeType: 'image/png',
        content: imageBytes,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const cards = listCardsByDocument(db, result.documentId);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.source_anchor).toBe('image:screenshot.png');
  });

  it('drops image cards whose anchor is not image:<filename>', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpRoot();

    const invoker: LeanInceptionRuntimeInvoker = async () => ({
      rawStdout: JSON.stringify({
        cards: [{
          column_key: 'features', title: 'Some feature X', content: 'y', confidence: 'high',
          source_anchor: 'this is just text the model paraphrased',
          source_line: null,
        }],
      }),
      durationMs: 50, model: null, promptTokens: null, outputTokens: null,
    });

    const imageBytes = Buffer.alloc(200, 0xFF);

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'pic.jpg', mimeType: 'image/jpeg', content: imageBytes },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const cards = listCardsByDocument(db, result.documentId);
    expect(cards).toHaveLength(0);
  });

  it('rejects tiny images as EMPTY_DOCUMENT', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpRoot();

    const invoker: LeanInceptionRuntimeInvoker = async () => ({
      rawStdout: '{}', durationMs: 0, model: null, promptTokens: null, outputTokens: null,
    });

    // 4 bytes is below the 100-byte threshold.
    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: {
        filename: 'screenshot.png',
        mimeType: 'image/png',
        content: Buffer.from([0x89, 0x50, 0x4E, 0x47]),
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('EMPTY_DOCUMENT');
  });
});
