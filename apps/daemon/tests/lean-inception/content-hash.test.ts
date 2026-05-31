import { describe, expect, it } from 'vitest';
import { computeContentHash } from '../../src/lean-inception/content-hash.js';

describe('computeContentHash', () => {
  it('returns 64-char hex sha256', () => {
    const hash = computeContentHash(Buffer.from('hello world'));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for same input', () => {
    const a = computeContentHash(Buffer.from('same'));
    const b = computeContentHash(Buffer.from('same'));
    expect(a).toBe(b);
  });

  it('differs when whitespace is added (trailing newline counts)', () => {
    const a = computeContentHash(Buffer.from('foo'));
    const b = computeContentHash(Buffer.from('foo\n'));
    expect(a).not.toBe(b);
  });

  it('handles empty buffer', () => {
    const hash = computeContentHash(Buffer.from(''));
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
