import { extractFromCss } from './extract-css.js';
import { extractFromDeclarations } from './extract-declarations.js';
import { emptyExtractedTokens, type ExtractedToken, type ExtractedTokens } from './types.js';

const STYLE_ATTR_RE = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const STYLE_TAG_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

function mergeBucket<V>(
  target: ExtractedToken<V>[],
  incoming: ExtractedToken<V>[],
): void {
  for (const t of incoming) {
    const existing = target.find((x) => x.value === t.value);
    if (existing) {
      existing.usageCount += t.usageCount;
      for (const sf of t.sourceFiles) {
        if (!existing.sourceFiles.includes(sf)) existing.sourceFiles.push(sf);
      }
    } else {
      target.push({ ...t, sourceFiles: [...t.sourceFiles] });
    }
  }
}

function merge(into: ExtractedTokens, from: ExtractedTokens): void {
  mergeBucket(into.colors, from.colors);
  mergeBucket(into.fonts, from.fonts);
  mergeBucket(into.sizes, from.sizes);
  mergeBucket(into.spacing, from.spacing);
}

/**
 * Extract tokens from an HTML file.
 *
 * Three sources contribute:
 * 1. Inline `style="..."` attributes — treated as declaration blocks.
 * 2. `<style>...</style>` tag contents — full CSS, parsed via extractFromCss.
 *    This is where most AI-generated single-file designs put their tokens
 *    (`:root { --color-* }` blocks declaring the project palette).
 * 3. Tailwind / Bootstrap utility classes are intentionally NOT extracted —
 *    the system prompt charter forbids those frameworks.
 */
export function extractFromHtml(htmlText: string, sourcePath: string): ExtractedTokens {
  const out = emptyExtractedTokens();

  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = STYLE_ATTR_RE.exec(htmlText)) !== null) {
    const declarations = attrMatch[1] ?? attrMatch[2] ?? '';
    if (declarations) extractFromDeclarations(declarations, sourcePath, out);
  }

  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = STYLE_TAG_RE.exec(htmlText)) !== null) {
    const css = tagMatch[1];
    if (css && css.trim()) {
      merge(out, extractFromCss(css, sourcePath));
    }
  }

  return out;
}
