import { extractFromDeclarations } from './extract-declarations.js';
import { emptyExtractedTokens, type ExtractedTokens } from './types.js';

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Find every `{ ... }` block at any depth and call extractFromDeclarations
 * on its body. This is a lightweight tokenizer: we scan character-by-character,
 * track brace depth, and emit each innermost block's content. @media or @supports
 * blocks themselves produce no declarations at their level — we recurse into them
 * by yielding their nested blocks.
 */
function* iterateDeclarationBlocks(css: string): Generator<string> {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const block = css.slice(start, i);
        // If the block contains nested `{`, it's an at-rule wrapper; recurse.
        if (block.includes('{')) {
          yield* iterateDeclarationBlocks(block);
        } else {
          yield block;
        }
        start = -1;
      }
      if (depth < 0) depth = 0; // forgiving on malformed input
    }
  }
}

export function extractFromCss(cssText: string, sourcePath: string): ExtractedTokens {
  const stripped = stripComments(cssText);
  const out = emptyExtractedTokens();
  try {
    for (const block of iterateDeclarationBlocks(stripped)) {
      extractFromDeclarations(block, sourcePath, out);
    }
  } catch {
    // Best-effort: malformed CSS shouldn't crash the daemon.
  }
  return out;
}
