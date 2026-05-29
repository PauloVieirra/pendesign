import type { ExtractedToken, ExtractedTokens } from './types.js';

const COLOR_PROPS = new Set([
  'color', 'background', 'background-color',
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color',
  'outline-color', 'caret-color', 'fill', 'stroke',
  'text-decoration-color',
]);

const FONT_PROPS = new Set(['font-family']);

const SIZE_PROPS = new Set(['font-size', 'line-height']);

const SPACING_PROPS = new Set([
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'gap', 'row-gap', 'column-gap',
  'top', 'right', 'bottom', 'left', 'inset',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
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
  if (t.toLowerCase() in NAMED_COLORS) return NAMED_COLORS[t.toLowerCase()];
  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(t);
  if (rgbMatch) {
    return rgbToHex(+rgbMatch[1], +rgbMatch[2], +rgbMatch[3], rgbMatch[4] != null ? +rgbMatch[4] : undefined);
  }
  const hslMatch = /^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(t);
  if (hslMatch) {
    return hslToHex(+hslMatch[1], +hslMatch[2], +hslMatch[3], hslMatch[4] != null ? +hslMatch[4] : undefined);
  }
  return null;
}

function extractPxNumber(token: string): number | null {
  const px = /^(-?\d+(?:\.\d+)?)px$/i.exec(token.trim());
  if (px) {
    const n = parseFloat(px[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const rem = /^(-?\d+(?:\.\d+)?)rem$/i.exec(token.trim());
  if (rem) {
    const n = parseFloat(rem[1]) * 16;
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

function ensureToken<V>(bucket: ExtractedToken<V>[], value: V, sourcePath: string): void {
  const existing = bucket.find((t) => t.value === value);
  if (existing) {
    existing.usageCount += 1;
    if (!existing.sourceFiles.includes(sourcePath)) existing.sourceFiles.push(sourcePath);
    return;
  }
  bucket.push({ value, usageCount: 1, sourceFiles: [sourcePath] });
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

    if (COLOR_PROPS.has(prop)) {
      // First try the whole value (handles rgb(...), hsl(...), named colors, hex).
      // Then try splitting by whitespace for shorthands like "background: #fff url(...)".
      const hexWhole = extractColorFromValueToken(value);
      if (hexWhole) {
        ensureToken(out.colors, hexWhole, sourcePath);
      } else {
        // Try each whitespace-split token (for shorthands).
        for (const token of value.split(/\s+/)) {
          const hex = extractColorFromValueToken(token);
          if (hex) {
            ensureToken(out.colors, hex, sourcePath);
            break; // only first color-like token in shorthand
          }
        }
      }
    } else if (FONT_PROPS.has(prop)) {
      const first = value.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
      if (first && first.toLowerCase() !== 'inherit') {
        ensureToken(out.fonts, first, sourcePath);
      }
    } else if (SIZE_PROPS.has(prop)) {
      const n = extractPxNumber(value);
      if (n != null) ensureToken(out.sizes, n, sourcePath);
    } else if (SPACING_PROPS.has(prop)) {
      for (const token of value.split(/\s+/)) {
        const n = extractPxNumber(token);
        if (n != null) ensureToken(out.spacing, n, sourcePath);
      }
    }
  }
}
