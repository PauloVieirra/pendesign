import { describe, expect, it } from 'vitest';
import { isAnchorValid, normalizeForAnchor } from '../../src/lean-inception/validate-anchor.js';

describe('normalizeForAnchor', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeForAnchor('Hello   World\n\tNice')).toBe('hello world nice');
  });

  it('handles empty string', () => {
    expect(normalizeForAnchor('')).toBe('');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeForAnchor('  foo  ')).toBe('foo');
  });
});

describe('isAnchorValid', () => {
  const doc = 'The product helps users.\n\nIt has THREE features.\nFirst, search.';

  it('returns true when anchor appears verbatim', () => {
    expect(isAnchorValid('It has THREE features.', doc)).toBe(true);
  });

  it('returns true when anchor matches with whitespace differences', () => {
    expect(isAnchorValid('It has   THREE   features.', doc)).toBe(true);
  });

  it('returns true case-insensitively', () => {
    expect(isAnchorValid('IT HAS three FEATURES.', doc)).toBe(true);
  });

  it('returns false for paraphrase (LLM hallucination)', () => {
    expect(isAnchorValid('The product has multiple features.', doc)).toBe(false);
  });

  it('returns false for empty anchor', () => {
    expect(isAnchorValid('', doc)).toBe(false);
  });

  it('returns false when anchor is not in doc', () => {
    expect(isAnchorValid('totally unrelated text', doc)).toBe(false);
  });
});
