import { describe, expect, it } from 'vitest';
import { assessReadiness } from '../../src/components/lean-inception/readiness';

const emptySnap = { status: 'not_identified' as const, cards: [] };

const baseColumns = {
  vision: emptySnap,
  problem: emptySnap,
  objective: emptySnap,
  csd_matrix: emptySnap,
  market_research: emptySnap,
  market_opportunities: emptySnap,
  personas: emptySnap,
  user_journey: emptySnap,
  features: emptySnap,
  business_rules: emptySnap,
  ideation: emptySnap,
  acceptance_criteria: emptySnap,
};

const cardOf = (column_key: string, confidence: 'high' | 'medium' | 'low') => ({
  id: `c_${column_key}`,
  inception_id: 'li_1',
  document_id: 'doc_1',
  column_key,
  title: 'X',
  content: 'y',
  confidence,
  source_anchor: 'a',
  source_line: 1,
  extraction_id: 'ext_1',
  created_at: 't',
});

const stateWith = (overrides: Partial<typeof baseColumns>) => ({
  inception_id: 'li_1',
  project_id: 'prj_1',
  documents: [],
  columns: { ...baseColumns, ...overrides },
});

describe('assessReadiness', () => {
  it('returns insufficient when state is null', () => {
    const r = assessReadiness(null);
    expect(r.level).toBe('insufficient');
  });

  it('returns insufficient when all critical columns are empty', () => {
    const r = assessReadiness(stateWith({}));
    expect(r.level).toBe('insufficient');
    expect(r.missingCritical).toEqual(['personas', 'user_journey', 'features']);
  });

  it('returns ready when critical + important all have solid cards', () => {
    const r = assessReadiness(stateWith({
      personas:     { status: 'partial', cards: [cardOf('personas', 'high') as any] },
      user_journey: { status: 'partial', cards: [cardOf('user_journey', 'medium') as any] },
      features:     { status: 'partial', cards: [cardOf('features', 'high') as any] },
      vision:       { status: 'partial', cards: [cardOf('vision', 'low') as any] },
      problem:      { status: 'partial', cards: [cardOf('problem', 'low') as any] },
    }));
    expect(r.level).toBe('ready');
    expect(r.missingCritical).toEqual([]);
    expect(r.missingImportant).toEqual([]);
  });

  it('returns partial when critical present but vision missing', () => {
    const r = assessReadiness(stateWith({
      personas:     { status: 'partial', cards: [cardOf('personas', 'high') as any] },
      user_journey: { status: 'partial', cards: [cardOf('user_journey', 'medium') as any] },
      features:     { status: 'partial', cards: [cardOf('features', 'high') as any] },
    }));
    expect(r.level).toBe('partial');
    expect(r.missingImportant).toContain('vision');
  });

  it('counts low-confidence cards as not solid for critical columns', () => {
    const r = assessReadiness(stateWith({
      personas:     { status: 'insufficient', cards: [cardOf('personas', 'low') as any] },
      user_journey: { status: 'partial', cards: [cardOf('user_journey', 'medium') as any] },
      features:     { status: 'partial', cards: [cardOf('features', 'high') as any] },
    }));
    expect(r.missingCritical).toContain('personas');
  });
});
