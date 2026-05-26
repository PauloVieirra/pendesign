import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  migrateLeanInception,
  upsertInceptionForProject,
  insertDocument,
  insertExtraction,
  insertCardsAtomic,
  readInceptionState,
} from '../../src/lean-inception/persistence.js';
import { runResearchForInception } from '../../src/lean-inception/research-service.js';
import type { LeanInceptionRuntimeInvoker } from '../../src/lean-inception/runtime-invoke.js';

function setupSeeded() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateLeanInception(db);
  const inception = upsertInceptionForProject(db, 'prj_1');
  const doc = insertDocument(db, {
    inception_id: inception.id,
    filename: 'seed.md', mime_type: 'text/markdown',
    byte_size: 10, content_hash: 'h_seed', storage_path: 'x',
  });
  const ext = insertExtraction(db, {
    inception_id: inception.id, document_id: doc.id,
    runtime: 'claude', model: null, prompt_version: 1,
  });
  insertCardsAtomic(db, [
    { inception_id: inception.id, document_id: doc.id, column_key: 'vision', title: 'Build best app', content: 'desc', confidence: 'high', source_anchor: 'a', source_line: 1, extraction_id: ext.id },
    { inception_id: inception.id, document_id: doc.id, column_key: 'features', title: 'Auth feature', content: 'login flow', confidence: 'high', source_anchor: 'b', source_line: 2, extraction_id: ext.id },
  ]);
  return { db, inception };
}

describe('runResearchForInception', () => {
  it('persists research + opportunities + ideation cards', async () => {
    const { db, inception } = setupSeeded();
    const invoker: LeanInceptionRuntimeInvoker = async () => ({
      rawStdout: JSON.stringify({
        cards: [
          { column_key: 'market_research', title: 'Auth0 + Firebase', content: 'Existing managed auth providers dominate the SaaS auth market.', confidence: 'high', source_anchor: 'research:auth-market', source_line: null },
          { column_key: 'market_opportunities', title: 'No-vendor-lock', content: 'Teams want auth without locking into Auth0 pricing tiers.', confidence: 'medium', source_anchor: 'research:opportunities', source_line: null },
          { column_key: 'ideation', title: 'Hybrid OSS+Cloud', content: 'Position as OSS-first with optional managed cloud — capture devs who want migrate-able infra.', confidence: 'medium', source_anchor: 'research:positioning', source_line: null },
        ],
      }),
      durationMs: 100, model: null, promptTokens: 200, outputTokens: 80,
    });
    await runResearchForInception({ db, inception, runtime: 'claude', invoke: invoker });
    const state = readInceptionState(db, inception.id);
    expect(state.columns.market_research?.cards.length).toBeGreaterThan(0);
    expect(state.columns.market_opportunities?.cards.length).toBeGreaterThan(0);
    expect(state.columns.ideation?.cards.length).toBeGreaterThan(0);
  });

  it('skips when no seed cards present', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    const inception = upsertInceptionForProject(db, 'prj_2');
    let invokerCalled = false;
    const invoker: LeanInceptionRuntimeInvoker = async () => {
      invokerCalled = true;
      return { rawStdout: '{}', durationMs: 0, model: null, promptTokens: null, outputTokens: null };
    };
    await runResearchForInception({ db, inception, runtime: 'claude', invoke: invoker });
    expect(invokerCalled).toBe(false);
  });

  it('drops cards whose column_key is outside research columns', async () => {
    const { db, inception } = setupSeeded();
    const invoker: LeanInceptionRuntimeInvoker = async () => ({
      rawStdout: JSON.stringify({
        cards: [
          { column_key: 'features', title: 'Should be ignored', content: 'x', confidence: 'high', source_anchor: 'a', source_line: null }, // wrong column — silently dropped
          { column_key: 'market_research', title: 'Kept entry', content: 'y', confidence: 'high', source_anchor: 'research:x', source_line: null },
        ],
      }),
      durationMs: 50, model: null, promptTokens: null, outputTokens: null,
    });
    await runResearchForInception({ db, inception, runtime: 'claude', invoke: invoker });
    const state = readInceptionState(db, inception.id);
    // The seeded features card was 1; the research call should NOT add a second one.
    expect(state.columns.features?.cards.length).toBe(1);
    expect(state.columns.market_research?.cards.length).toBe(1);
  });
});
