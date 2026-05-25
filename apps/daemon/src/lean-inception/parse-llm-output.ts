export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'no_json_found' | 'invalid_json' };

const FENCE_RE = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/i;

export function parseLlmJsonOutput(raw: string): ParseResult {
  if (!raw || raw.trim().length === 0) return { ok: false, reason: 'no_json_found' };

  const fenceMatch = raw.match(FENCE_RE);
  if (fenceMatch) {
    return tryParse(fenceMatch[1]);
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return tryParse(raw.slice(firstBrace, lastBrace + 1));
  }

  return { ok: false, reason: 'no_json_found' };
}

function tryParse(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}
