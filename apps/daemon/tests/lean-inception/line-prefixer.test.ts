import { describe, expect, it } from 'vitest';
import { prefixLines } from '../../src/lean-inception/line-prefixer.js';

describe('prefixLines', () => {
  it('prefixes every line with L<n>: ', () => {
    expect(prefixLines('a\nb\nc')).toBe('L1: a\nL2: b\nL3: c');
  });

  it('handles single line', () => {
    expect(prefixLines('only')).toBe('L1: only');
  });

  it('preserves empty lines with their number', () => {
    expect(prefixLines('a\n\nb')).toBe('L1: a\nL2: \nL3: b');
  });

  it('handles trailing newline (treats last empty line)', () => {
    expect(prefixLines('a\n')).toBe('L1: a\nL2: ');
  });

  it('handles empty string', () => {
    expect(prefixLines('')).toBe('L1: ');
  });
});
