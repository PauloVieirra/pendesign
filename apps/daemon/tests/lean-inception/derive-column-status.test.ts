import { describe, expect, it } from 'vitest';
import { deriveColumnStatus } from '../../src/lean-inception/derive-column-status.js';

const make = (confidence: 'low' | 'medium' | 'high') => ({ confidence });

describe('deriveColumnStatus', () => {
  it('returns not_identified for empty array', () => {
    expect(deriveColumnStatus([])).toBe('not_identified');
  });

  it('returns insufficient when score < 1.5', () => {
    expect(deriveColumnStatus([make('low')])).toBe('insufficient');
    expect(deriveColumnStatus([make('medium')])).toBe('insufficient');
    expect(deriveColumnStatus([make('low'), make('low')])).toBe('insufficient');
  });

  it('returns partial when 1.5 <= score < 3.0', () => {
    expect(deriveColumnStatus([make('high'), make('medium')])).toBe('partial');
    expect(deriveColumnStatus([make('high'), make('high')])).toBe('partial');
  });

  it('returns complete when score >= 3.0', () => {
    expect(deriveColumnStatus([make('high'), make('high'), make('high')])).toBe('complete');
    expect(deriveColumnStatus(Array(5).fill(make('medium')))).toBe('complete');
  });
});
