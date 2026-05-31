import { describe, expect, it } from 'vitest';
import { parseLlmJsonOutput } from '../../src/lean-inception/parse-llm-output.js';

describe('parseLlmJsonOutput', () => {
  it('parses raw JSON object', () => {
    const out = parseLlmJsonOutput('{"cards":[]}');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual({ cards: [] });
  });

  it('parses JSON inside ```json fence', () => {
    const text = 'Some text\n```json\n{"cards":[{"id":"a"}]}\n```\nDone.';
    const out = parseLlmJsonOutput(text);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual({ cards: [{ id: 'a' }] });
  });

  it('parses JSON inside ``` fence (no language)', () => {
    const text = '```\n{"cards":[]}\n```';
    const out = parseLlmJsonOutput(text);
    expect(out.ok).toBe(true);
  });

  it('parses JSON with prose surrounding it (no fences)', () => {
    const text = 'Here is the result: {"cards":[{"k":1}]} and that is all.';
    const out = parseLlmJsonOutput(text);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual({ cards: [{ k: 1 }] });
  });

  it('returns error when no JSON found', () => {
    const out = parseLlmJsonOutput('I cannot do that.');
    expect(out.ok).toBe(false);
  });

  it('returns error for malformed JSON', () => {
    const out = parseLlmJsonOutput('{cards: [],}');
    expect(out.ok).toBe(false);
  });

  it('prefers fenced block over surrounding prose', () => {
    const text = '{"wrong":1}\n```json\n{"cards":[{"right":1}]}\n```';
    const out = parseLlmJsonOutput(text);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual({ cards: [{ right: 1 }] });
  });
});
