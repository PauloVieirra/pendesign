import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  migrateLeanInception,
  upsertInceptionForProject,
  readInceptionState,
} from '../../src/lean-inception/persistence.js';
import { extractDocumentForInception } from '../../src/lean-inception/extraction-service.js';
import { invokeAgentForExtraction } from '../../src/lean-inception/runtime-invoke.js';

const LIVE = process.env.OD_E2E_LIVE_LLM === '1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe.skipIf(!LIVE)('golden — discovery-notes.md', () => {
  it('extracts at least the documented minimums per column', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'discovery-notes.md');
    const expectedPath = path.join(__dirname, 'fixtures', 'discovery-notes.expected.json');
    const fixture = fs.readFileSync(fixturePath);
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    const inception = upsertInceptionForProject(db, 'prj_golden');
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'li-golden-'));

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude',
      invoke: invokeAgentForExtraction,
      document: { filename: 'discovery-notes.md', mimeType: 'text/markdown', content: fixture },
    });
    expect(result.ok).toBe(true);

    const state = readInceptionState(db, inception.id);
    for (const [key, mins] of Object.entries(expected.minimums)) {
      const snap = state.columns[key as keyof typeof state.columns];
      expect(snap!.cards.length, `column ${key} card count`).toBeGreaterThanOrEqual((mins as any).min_cards);
    }
  }, 180_000);
});
