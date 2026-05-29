import { extractFromDeclarations } from './extract-declarations.js';
import { emptyExtractedTokens, type ExtractedTokens } from './types.js';

const STYLE_ATTR_RE = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

export function extractFromHtml(htmlText: string, sourcePath: string): ExtractedTokens {
  const out = emptyExtractedTokens();
  let match: RegExpExecArray | null;
  while ((match = STYLE_ATTR_RE.exec(htmlText)) !== null) {
    const declarations = match[1] ?? match[2] ?? '';
    if (declarations) extractFromDeclarations(declarations, sourcePath, out);
  }
  return out;
}
