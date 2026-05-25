import { describe, expect, it } from 'vitest';
import {
  LEAN_INCEPTION_PROMPT_VERSION,
  LEAN_INCEPTION_SYSTEM_PROMPT_V1,
  buildUserPromptV1,
} from '../../src/lean-inception/prompts/v1.js';

describe('LEAN_INCEPTION_PROMPT_VERSION', () => {
  it('is 1', () => {
    expect(LEAN_INCEPTION_PROMPT_VERSION).toBe(1);
  });
});

describe('LEAN_INCEPTION_SYSTEM_PROMPT_V1', () => {
  it('mentions all 11 column keys', () => {
    const p = LEAN_INCEPTION_SYSTEM_PROMPT_V1;
    for (const key of ['market_research', 'market_opportunities', 'vision', 'problem', 'objective', 'personas', 'user_journey', 'features', 'business_rules', 'ideation', 'acceptance_criteria']) {
      expect(p).toContain(key);
    }
  });

  it('mentions source_anchor rule and JSON-only output', () => {
    expect(LEAN_INCEPTION_SYSTEM_PROMPT_V1).toContain('source_anchor');
    expect(LEAN_INCEPTION_SYSTEM_PROMPT_V1.toLowerCase()).toContain('json');
  });
});

describe('buildUserPromptV1', () => {
  it('prefixes MD content with L<n>: per line', () => {
    const out = buildUserPromptV1({ filename: 'a.md', mimeType: 'text/markdown', content: 'foo\nbar' });
    expect(out).toContain('L1: foo');
    expect(out).toContain('L2: bar');
    expect(out).toContain('a.md');
    expect(out).toContain('md');
  });

  it('omits line prefixes for TXT (source_line stays null)', () => {
    const out = buildUserPromptV1({ filename: 'b.txt', mimeType: 'text/plain', content: 'foo\nbar' });
    expect(out).not.toContain('L1:');
    expect(out).toContain('foo');
    expect(out).toContain('bar');
    expect(out).toContain('b.txt');
    expect(out).toContain('txt');
  });
});
