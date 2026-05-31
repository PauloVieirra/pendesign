import type { VariableScope } from '../design-system-variables.js';
import type { ExtractedToken, ExtractedTokens } from './types.js';

const COLOR_PROPS = new Set([
  'color', 'background', 'background-color',
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color',
  'outline-color', 'caret-color', 'fill', 'stroke',
  'text-decoration-color',
]);

const FONT_PROPS = new Set(['font-family']);

const FONT_SIZE_PROPS = new Set(['font-size']);
const LINE_HEIGHT_PROPS = new Set(['line-height']);

const PADDING_PROPS = new Set([
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
]);

const MARGIN_PROPS = new Set([
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
]);

const GAP_PROPS = new Set(['gap', 'row-gap', 'column-gap']);

const BORDER_RADIUS_PROPS = new Set([
  'border-radius',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
]);

const BORDER_WIDTH_PROPS = new Set([
  'border-width',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
]);

const SKIP_VALUES = new Set([
  'inherit', 'initial', 'unset', 'currentcolor', 'transparent',
  'none', 'auto', '0', '0px', '0%',
]);

const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
  olive: '#808000', lime: '#00ff00', aqua: '#00ffff', teal: '#008080',
  navy: '#000080', fuchsia: '#ff00ff', purple: '#800080', orange: '#ffa500',
  pink: '#ffc0cb', brown: '#a52a2a', tan: '#d2b48c', salmon: '#fa8072',
  gold: '#ffd700', indigo: '#4b0082', violet: '#ee82ee', khaki: '#f0e68c',
  beige: '#f5f5dc', ivory: '#fffff0', snow: '#fffafa', tomato: '#ff6347',
  coral: '#ff7f50', orchid: '#da70d6', plum: '#dda0dd', wheat: '#f5deb3',
  azure: '#f0ffff', linen: '#faf0e6', crimson: '#dc143c',
  // 50 most common; extend as needed
};

function canonicalizeHex(hex: string): string | null {
  const h = hex.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) {
    return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  if (/^#[0-9a-f]{4}$/.test(h)) {
    const a = h[4];
    if (a === 'f') {
      return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    }
    return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] + a + a;
  }
  if (/^#[0-9a-f]{6}$/.test(h)) return h;
  if (/^#[0-9a-f]{8}$/.test(h)) {
    if (h.slice(7) === 'ff') return h.slice(0, 7);
    return h;
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number, a?: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const hex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  const base = '#' + hex(r) + hex(g) + hex(b);
  if (a == null || a >= 1) return base;
  return base + hex(a * 255);
}

function hslToHex(h: number, s: number, l: number, a?: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const cf = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbToHex(cf(0) * 255, cf(8) * 255, cf(4) * 255, a);
}

function extractColorFromValueToken(token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  if (t.startsWith('#')) return canonicalizeHex(t);
  const named = NAMED_COLORS[t.toLowerCase()];
  if (named) return named;
  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(t);
  if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
    return rgbToHex(+rgbMatch[1], +rgbMatch[2], +rgbMatch[3], rgbMatch[4] != null ? +rgbMatch[4] : undefined);
  }
  const hslMatch = /^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(t);
  if (hslMatch && hslMatch[1] && hslMatch[2] && hslMatch[3]) {
    return hslToHex(+hslMatch[1], +hslMatch[2], +hslMatch[3], hslMatch[4] != null ? +hslMatch[4] : undefined);
  }
  return null;
}

function extractPxNumber(token: string): number | null {
  const px = /^(-?\d+(?:\.\d+)?)px$/i.exec(token.trim());
  if (px && px[1]) {
    const n = parseFloat(px[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const rem = /^(-?\d+(?:\.\d+)?)rem$/i.exec(token.trim());
  if (rem && rem[1]) {
    const n = parseFloat(rem[1]) * 16;
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

function ensureToken<V>(bucket: ExtractedToken<V>[], value: V, scope: VariableScope, sourcePath: string): void {
  // Tokens with the same value but different scopes are distinct entries.
  const existing = bucket.find((t) => t.value === value && t.scope === scope);
  if (existing) {
    existing.usageCount += 1;
    if (!existing.sourceFiles.includes(sourcePath)) existing.sourceFiles.push(sourcePath);
    return;
  }
  bucket.push({ value, scope, usageCount: 1, sourceFiles: [sourcePath] });
}

/**
 * Parse a CSS-declaration-block contents (without the surrounding braces)
 * and accumulate extracted tokens into `out`.
 */
export function extractFromDeclarations(
  declarations: string,
  sourcePath: string,
  out: ExtractedTokens,
): void {
  for (const raw of declarations.split(';')) {
    const decl = raw.trim();
    if (!decl) continue;
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!value) continue;
    if (value.includes('var(')) continue;
    const lower = value.toLowerCase();
    if (SKIP_VALUES.has(lower)) continue;

    // CSS custom properties (--*) with color-like values are also extracted.
    if (prop.startsWith('--') || COLOR_PROPS.has(prop)) {
      // First try the whole value (handles rgb(...), hsl(...), named colors, hex).
      // Then try splitting by whitespace for shorthands like "background: #fff url(...)".
      const hexWhole = extractColorFromValueToken(value);
      if (hexWhole) {
        ensureToken(out.colors, hexWhole, 'color', sourcePath);
      } else {
        // Try each whitespace-split token (for shorthands).
        for (const token of value.split(/\s+/)) {
          const hex = extractColorFromValueToken(token);
          if (hex) {
            ensureToken(out.colors, hex, 'color', sourcePath);
            break; // only first color-like token in shorthand
          }
        }
      }
    } else if (FONT_PROPS.has(prop)) {
      const first = value.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
      if (first && first.toLowerCase() !== 'inherit') {
        ensureToken(out.fonts, first, 'font-family', sourcePath);
      }
    } else if (FONT_SIZE_PROPS.has(prop)) {
      const n = extractPxNumber(value);
      if (n != null) ensureToken(out.sizes, n, 'font-size', sourcePath);
    } else if (LINE_HEIGHT_PROPS.has(prop)) {
      const n = extractPxNumber(value);
      if (n != null) ensureToken(out.sizes, n, 'line-height', sourcePath);
    } else if (PADDING_PROPS.has(prop)) {
      for (const token of value.split(/\s+/)) {
        const n = extractPxNumber(token);
        if (n != null) ensureToken(out.spacing, n, 'padding', sourcePath);
      }
    } else if (MARGIN_PROPS.has(prop)) {
      for (const token of value.split(/\s+/)) {
        const n = extractPxNumber(token);
        if (n != null) ensureToken(out.spacing, n, 'margin', sourcePath);
      }
    } else if (GAP_PROPS.has(prop)) {
      for (const token of value.split(/\s+/)) {
        const n = extractPxNumber(token);
        if (n != null) ensureToken(out.spacing, n, 'gap', sourcePath);
      }
    } else if (BORDER_RADIUS_PROPS.has(prop)) {
      for (const token of value.split(/\s+/)) {
        const n = extractPxNumber(token);
        if (n != null) ensureToken(out.borderRadii, n, 'border-radius', sourcePath);
      }
    } else if (BORDER_WIDTH_PROPS.has(prop)) {
      for (const token of value.split(/\s+/)) {
        const n = extractPxNumber(token);
        if (n != null) ensureToken(out.borderWidths, n, 'border-width', sourcePath);
      }
    }
  }
}
