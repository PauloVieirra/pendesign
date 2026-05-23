import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  cleanDisplayName,
  LocalDesignSystemImportError,
  type LocalDesignSystemImportResult,
  nextAvailableSlug,
  slugify,
} from './design-system-import.js';

export type FigmaImportResult = LocalDesignSystemImportResult & {
  /** Surfaced to the UI as inline hints (no error path). */
  warnings: string[];
  /** Counts of what was extracted per source for diagnostics. */
  stats: {
    variables: { attempted: boolean; status: number; count: number };
    publishedStyles: { count: number };
    inline: { colors: number; fonts: number; shadows: number; spacings: number; radii: number };
  };
};

/**
 * Pulls a design system out of a Figma file via the REST API and writes
 * it to disk in the same `DESIGN.md` + `tokens.css` + `manifest.json`
 * shape that the local/GitHub import flows produce, so it appears in the
 * registry alongside the other user-owned design systems.
 *
 * Token extraction is intentionally narrow:
 *   - Color styles (FILL) become palette tokens.
 *   - Text styles (TEXT) become typography tokens.
 *   - Effect styles (EFFECT, drop / inner shadow) become elevation tokens.
 *
 * No components are extracted — the user explicitly asked for components
 * to be left for a separate flow.
 */

const FILE_URL_RE = /^https:\/\/(?:www\.)?figma\.com\/(?:file|design|board|proto)\/([A-Za-z0-9]+)/;

export type FigmaImportErrorCode =
  | 'BAD_REQUEST'
  | 'FIGMA_TOKEN_INVALID'
  | 'FIGMA_FORBIDDEN'
  | 'FIGMA_NOT_FOUND'
  | 'FIGMA_API'
  | 'INTERNAL_ERROR';

export class FigmaImportError extends Error {
  constructor(
    readonly code: FigmaImportErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FigmaImportError';
  }
}

async function safeReadBody(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.message === 'string') return parsed.message;
    } catch {
      // Not JSON — fall through to the raw text.
    }
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

function figmaFetchError(label: string, resp: Response, detail: string): FigmaImportError {
  const status = resp.status;
  if (status === 401) {
    return new FigmaImportError(
      'FIGMA_TOKEN_INVALID',
      `Figma rejected the token (401 ${resp.statusText}). The Personal Access Token is missing or revoked. Generate a new one at Figma → Settings → Personal access tokens and paste it below.${detail ? ` Figma said: ${detail}` : ''}`,
      status,
    );
  }
  if (status === 403) {
    return new FigmaImportError(
      'FIGMA_FORBIDDEN',
      `Figma rejected the token for this file (403 ${resp.statusText}). Most common causes: (1) the token's owner doesn't have access to this file or team, (2) the token was generated without the "file_content:read" scope. Generate a new scoped token at Figma → Settings → Personal access tokens (check "Read all files") and paste it below.${detail ? ` Figma said: ${detail}` : ''}`,
      status,
    );
  }
  if (status === 404) {
    return new FigmaImportError(
      'FIGMA_NOT_FOUND',
      `Figma file not found (404). Double-check the URL — Open Design expects https://figma.com/design/<KEY>/... or https://figma.com/file/<KEY>/...${detail ? ` Figma said: ${detail}` : ''}`,
      status,
    );
  }
  return new FigmaImportError(
    'FIGMA_API',
    `${label}: ${status} ${resp.statusText}${detail ? ` — ${detail}` : ''}`,
    status,
  );
}

export function extractFigmaFileKey(figmaUrl: string): string | null {
  const match = FILE_URL_RE.exec(figmaUrl.trim());
  return match ? (match[1] ?? null) : null;
}

interface FigmaColor {
  name: string;
  hex: string;
  rgba: { r: number; g: number; b: number; a: number };
  styleId: string;
}

interface FigmaFont {
  name: string;
  family: string;
  weight: number;
  size: number;
  lineHeight: string | null;
  letterSpacing: number | null;
  styleId: string;
}

interface FigmaShadow {
  name: string;
  value: string;
  styleId: string;
}

interface FigmaSpacing {
  name: string;
  value: number;
}

interface FigmaRadius {
  name: string;
  value: number;
}

export interface FigmaDesignSystemImportOptions {
  name?: string;
  reservedIds?: Iterable<string>;
  // Optional override for testing.
  fetchFn?: typeof fetch;
}

/**
 * Extract a DS from a Figma file URL. The URL can point at the file
 * root, a specific page (`?node-id=...`), or a frame inside a page.
 * We always read published *styles* (which are file-global) plus, when
 * a `node-id` is provided, walk that subtree for inline spacing /
 * radius candidates so a user pointing at a single screen still gets a
 * useful starting tokens set.
 */
export async function importFigmaDesignSystem(
  figmaUrl: string,
  token: string,
  userDesignSystemsRoot: string,
  options: FigmaDesignSystemImportOptions = {},
): Promise<FigmaImportResult> {
  const fileKey = extractFigmaFileKey(figmaUrl);
  if (!fileKey) {
    throw new FigmaImportError(
      'BAD_REQUEST',
      'Unrecognized Figma URL — expected https://figma.com/file/<KEY>/... or https://figma.com/design/<KEY>/...',
    );
  }
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (!fetchFn) {
    throw new FigmaImportError('INTERNAL_ERROR', 'no fetch implementation available');
  }

  // Personal Access Tokens authenticate via X-Figma-Token. The Bearer
  // header is for OAuth2 access tokens — scoped PATs (Figma's newer
  // model) reject Bearer with 403 "Invalid token".
  const headers = { 'X-Figma-Token': token } as const;

  // 1. File metadata (lightweight).
  const fileMetaUrl = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=1`;
  const fileResp = await fetchFn(fileMetaUrl, { headers });
  if (!fileResp.ok) {
    throw figmaFetchError('Figma file fetch failed', fileResp, await safeReadBody(fileResp));
  }
  const fileBody = (await fileResp.json()) as { name?: string; lastModified?: string; version?: string };
  const fileName = fileBody.name || 'Figma Design System';

  // 2. List published styles (file-global).
  const stylesUrl = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/styles`;
  const stylesResp = await fetchFn(stylesUrl, { headers });
  if (!stylesResp.ok) {
    throw figmaFetchError('Figma styles fetch failed', stylesResp, await safeReadBody(stylesResp));
  }
  const stylesBody = (await stylesResp.json()) as {
    meta?: {
      styles?: Array<{
        node_id: string;
        name: string;
        description?: string;
        style_type: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
      }>;
    };
  };
  const styles = stylesBody.meta?.styles ?? [];

  const colors: FigmaColor[] = [];
  const fonts: FigmaFont[] = [];
  const shadows: FigmaShadow[] = [];
  const spacings: FigmaSpacing[] = [];
  const radii: FigmaRadius[] = [];

  // ── 2a. Variables (modern, Figma's 2023+ Variables system). ─────────
  //
  // /v1/files/<key>/variables/local needs `file_variables:read` scope
  // and a Professional+ plan. We track the outcome so callers (and
  // the daemon endpoint) can surface a "regen your token with
  // file_variables:read checked" hint when Variables silently fall
  // through and the rest of the import had to rely on inline fills.
  let variablesAttempted = false;
  let variablesStatus = 0;
  let variablesCount = 0;
  try {
    variablesAttempted = true;
    const variablesUrl = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/variables/local`;
    const variablesResp = await fetchFn(variablesUrl, { headers });
    variablesStatus = variablesResp.status;
    if (variablesResp.ok) {
      const body = (await variablesResp.json()) as FigmaVariablesResponse;
      const vars = body.meta?.variables ?? {};
      const collections = body.meta?.variableCollections ?? {};
      for (const id of Object.keys(vars)) {
        const v = vars[id];
        if (!v || v.remote === true) continue;
        const collection = v.variableCollectionId ? collections[v.variableCollectionId] : undefined;
        const defaultModeId = collection?.defaultModeId ?? Object.keys(v.valuesByMode ?? {})[0];
        if (!defaultModeId) continue;
        const value = v.valuesByMode?.[defaultModeId];
        if (value === undefined || value === null) continue;
        // Variables can alias another variable; we only persist the
        // resolved primitive. Aliased values come back as `{ type:
        // "VARIABLE_ALIAS", id }` which we just skip — keeps the import
        // simple and avoids cross-variable resolution loops.
        if (typeof value === 'object' && (value as FigmaVariableAlias).type === 'VARIABLE_ALIAS') continue;
        const collectionPrefix = collection?.name ? `${collection.name}/` : '';
        const fullName = `${collectionPrefix}${v.name}`;
        if (v.resolvedType === 'COLOR' && typeof value === 'object') {
          const c = value as { r: number; g: number; b: number; a?: number };
          colors.push({
            name: fullName,
            hex: rgbaToHex(c, 1),
            rgba: { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 },
            styleId: v.id,
          });
          variablesCount += 1;
        } else if (v.resolvedType === 'FLOAT' && typeof value === 'number') {
          // Heuristic: variables named ".../radius/..." or ".../corner/..."
          // become radii; ".../space/...", ".../gap/...", ".../padding/..."
          // become spacings. Everything else still goes to spacings as
          // the safest default for a numeric design token.
          const lower = fullName.toLowerCase();
          if (/radius|corner|round/.test(lower)) {
            radii.push({ name: fullName, value: Math.round(value) });
          } else {
            spacings.push({ name: fullName, value: Math.round(value) });
          }
          variablesCount += 1;
        }
        // STRING / BOOLEAN variables don't map cleanly to CSS tokens; skip.
      }
    }
  } catch {
    // Best-effort — never block on Variables API errors.
  }

  if (styles.length > 0) {
    // 3. Resolve style values via /nodes (batched in chunks of 50).
    const styleIds = styles.map((s) => s.node_id);
    for (let i = 0; i < styleIds.length; i += 50) {
      const batch = styleIds.slice(i, i + 50);
      const nodesUrl = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(batch.join(','))}`;
      const nodesResp = await fetchFn(nodesUrl, { headers });
      if (!nodesResp.ok) {
        throw figmaFetchError('Figma nodes fetch failed', nodesResp, await safeReadBody(nodesResp));
      }
      const nodesBody = (await nodesResp.json()) as {
        nodes?: Record<string, { document?: FigmaNodeWithStyle } | null>;
      };
      const nodesMap = nodesBody.nodes ?? {};
      for (const style of styles.filter((s) => batch.includes(s.node_id))) {
        const node = nodesMap[style.node_id]?.document;
        if (!node) continue;
        if (style.style_type === 'FILL') {
          const fill = node.fills?.[0];
          if (fill && fill.type === 'SOLID' && fill.color) {
            const a = fill.opacity ?? 1;
            colors.push({
              name: style.name,
              hex: rgbaToHex(fill.color, a),
              rgba: { r: fill.color.r, g: fill.color.g, b: fill.color.b, a },
              styleId: style.node_id,
            });
          }
        } else if (style.style_type === 'TEXT') {
          const ts = node.style;
          if (ts) {
            fonts.push({
              name: style.name,
              family: ts.fontFamily || 'sans-serif',
              weight: Number.isFinite(ts.fontWeight) ? Number(ts.fontWeight) : 400,
              size: Number.isFinite(ts.fontSize) ? Number(ts.fontSize) : 16,
              lineHeight: ts.lineHeightPx ? `${roundTo(ts.lineHeightPx, 1)}px` : null,
              letterSpacing: Number.isFinite(ts.letterSpacing) ? Number(ts.letterSpacing) : null,
              styleId: style.node_id,
            });
          }
        } else if (style.style_type === 'EFFECT') {
          const effect = node.effects?.[0];
          if (
            effect &&
            (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') &&
            effect.color
          ) {
            const c = effect.color;
            const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
            const offsetX = roundTo(effect.offset?.x ?? 0, 1);
            const offsetY = roundTo(effect.offset?.y ?? 0, 1);
            const radius = roundTo(effect.radius ?? 0, 1);
            const r = clamp255(c.r);
            const g = clamp255(c.g);
            const b = clamp255(c.b);
            const a = Number.isFinite(c.a) ? Number(c.a) : 1;
            shadows.push({
              name: style.name,
              value: `${inset}${offsetX}px ${offsetY}px ${radius}px rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`,
              styleId: style.node_id,
            });
          }
        }
      }
    }
  }

  // 4. Subtree walk for spacing / radius signals (best-effort).
  //
  // Figma does not publish spacing as styles, but most teams encode
  // their scale as `itemSpacing` / `paddingX/Y` on auto-layout frames
  // and `cornerRadius` on visible rectangles. Walking the requested
  // node (or, if no node-id, the first canvas's first frame) gives us
  // a reasonable sample to seed `--space-*` and `--radius-*` tokens.
  // Components are intentionally not extracted; this is just numeric
  // distillation.
  try {
    const nodeId = extractNodeIdFromUrl(figmaUrl);
    let walkTargetId: string | null = nodeId;
    if (!walkTargetId) {
      // Use file metadata (depth=1 already returned) to pick the first
      // page. The page itself has no fills; we still walk the immediate
      // children for spacing on top-level frames.
      // (depth=1 only returns the canvas, no inner frames — we need
      // a second call to walk deeper, but at unknown cost. Skip when
      // the user did not point at a specific node.)
      walkTargetId = null;
    }
    if (walkTargetId) {
      const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(walkTargetId)}`;
      const resp = await fetchFn(url, { headers });
      if (resp.ok) {
        const body = (await resp.json()) as {
          nodes?: Record<string, { document?: FigmaNodeWithStyle } | null>;
        };
        const root = body.nodes?.[walkTargetId]?.document;
        if (root) {
          const spacingsRaw: number[] = [];
          const radiiRaw: number[] = [];
          // Walk for spacing / radii AND inline color / text / effect
          // fingerprints. Inline mining catches files that don't use
          // published styles or variables but still encode their
          // palette in actual frames (the most common case for files
          // built from scratch or migrated from Sketch / Photoshop).
          const inlineSeenColors = new Set<string>();
          const inlineSeenFonts = new Set<string>();
          const inlineSeenShadows = new Set<string>();
          walkInlineTokens(root, {
            spacings: spacingsRaw,
            radii: radiiRaw,
            colors,
            fonts,
            shadows,
            seenColors: inlineSeenColors,
            seenFonts: inlineSeenFonts,
            seenShadows: inlineSeenShadows,
            maxColors: 48,
            maxFonts: 24,
            maxShadows: 16,
          });
          for (const value of dedupeAndScale(spacingsRaw, 16)) {
            spacings.push({ name: `space-${value}`, value });
          }
          for (const value of dedupeAndScale(radiiRaw, 12)) {
            radii.push({ name: `radius-${value}`, value });
          }
        }
      }
      // If the node fetch failed (404 for an unpublished node, e.g.),
      // we just skip the spacing pass — the published styles / variables
      // are still useful on their own.
    } else {
      // No node-id provided AND no styles/variables came back — try a
      // shallow scan of the file's first page so we still surface
      // something. Cap depth to avoid pulling megabytes for huge files.
      if (colors.length === 0 && fonts.length === 0 && shadows.length === 0) {
        const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=4`;
        const resp = await fetchFn(url, { headers });
        if (resp.ok) {
          const body = (await resp.json()) as { document?: FigmaNodeWithStyle };
          if (body.document) {
            const spacingsRaw: number[] = [];
            const radiiRaw: number[] = [];
            walkInlineTokens(body.document, {
              spacings: spacingsRaw,
              radii: radiiRaw,
              colors,
              fonts,
              shadows,
              seenColors: new Set<string>(),
              seenFonts: new Set<string>(),
              seenShadows: new Set<string>(),
              maxColors: 48,
              maxFonts: 24,
              maxShadows: 16,
            });
            for (const value of dedupeAndScale(spacingsRaw, 16)) {
              spacings.push({ name: `space-${value}`, value });
            }
            for (const value of dedupeAndScale(radiiRaw, 12)) {
              radii.push({ name: `radius-${value}`, value });
            }
          }
        }
      }
    }
  } catch {
    // Best-effort. Spacing extraction errors do not block the import.
  }

  if (colors.length === 0 && fonts.length === 0 && shadows.length === 0 && spacings.length === 0 && radii.length === 0) {
    throw new FigmaImportError(
      'BAD_REQUEST',
      'No design tokens found in this Figma file. Tried three sources in order: (1) Local Variables, (2) Published Styles, (3) inline fills / text / effects on the targeted node. The token needs the `file_variables:read` scope to read Variables, and the file plan needs to be Professional+ for Variables to be exposed via the REST API. Try pointing the URL at a specific frame (paste with the `?node-id=...` query) so we can mine its inline colours and typography.',
    );
  }

  // 5. Write the DS to disk.
  const displayName = cleanDisplayName(options.name ?? fileName);
  const id = await nextAvailableSlug(userDesignSystemsRoot, slugify(displayName), options.reservedIds);
  const outDir = path.join(userDesignSystemsRoot, id);
  await mkdir(outDir, { recursive: true });

  const tokensCss = renderTokensCss(colors, fonts, shadows, spacings, radii);
  const designMd = renderDesignMd(id, displayName, figmaUrl, colors, fonts, shadows, spacings, radii);
  const manifest = renderManifest(id, displayName, figmaUrl, fileKey, fileBody, colors, fonts, shadows);

  const files = ['DESIGN.md', 'tokens.css', 'manifest.json'];
  await writeFile(path.join(outDir, 'DESIGN.md'), designMd, 'utf8');
  await writeFile(path.join(outDir, 'tokens.css'), tokensCss, 'utf8');
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const warnings: string[] = [];
  // The most common silent failure: the token does not have the
  // file_variables:read scope. When that happens /variables/local
  // returns 403 and we end up with inline-fingerprinted tokens
  // (generic `color-1`, `text-1` names) instead of the proper
  // collection-scoped names the user expects ("Cores/100" etc.).
  // Surface it so the user knows to re-issue the token.
  if (variablesAttempted && variablesStatus === 403 && variablesCount === 0) {
    warnings.push('Figma Variables were not read (403). The token is likely missing the "file_variables:read" scope, or this file is on a plan that does not expose Variables via REST. Re-generate the token at Figma → Settings → Personal access tokens with that scope checked to get proper variable names like "Cores/100" instead of the inline fallback.');
  } else if (variablesAttempted && variablesStatus === 404) {
    warnings.push('This Figma file has no Variables (404 on /variables/local). Tokens were extracted from inline fills and text styles on the targeted node instead.');
  } else if (variablesAttempted && variablesCount === 0 && variablesStatus !== 200) {
    warnings.push(`Figma Variables were not read (HTTP ${variablesStatus || 'n/a'}). Falling back to published Styles and inline scan.`);
  }

  return {
    id,
    dir: outDir,
    files,
    warnings,
    stats: {
      variables: { attempted: variablesAttempted, status: variablesStatus, count: variablesCount },
      publishedStyles: { count: styles.length },
      inline: {
        colors: colors.length - variablesCount,
        fonts: fonts.length,
        shadows: shadows.length,
        spacings: spacings.length,
        radii: radii.length,
      },
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Helpers.
// ───────────────────────────────────────────────────────────────────────

interface FigmaFill {
  type?: string;
  color?: { r: number; g: number; b: number; a?: number };
  opacity?: number;
}

interface FigmaTextStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
}

interface FigmaEffect {
  type?: string;
  color?: { r: number; g: number; b: number; a?: number };
  offset?: { x: number; y: number };
  radius?: number;
}

interface FigmaNodeWithStyle {
  type?: string;
  fills?: FigmaFill[];
  style?: FigmaTextStyle;
  effects?: FigmaEffect[];
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  children?: FigmaNodeWithStyle[];
}

function clamp255(v: number): number {
  const x = Math.round((v ?? 0) * 255);
  if (x < 0) return 0;
  if (x > 255) return 255;
  return x;
}

function rgbaToHex(color: { r: number; g: number; b: number; a?: number }, opacity: number): string {
  const r = clamp255(color.r).toString(16).padStart(2, '0');
  const g = clamp255(color.g).toString(16).padStart(2, '0');
  const b = clamp255(color.b).toString(16).padStart(2, '0');
  const alpha = Math.max(0, Math.min(1, (color.a ?? 1) * (opacity ?? 1)));
  if (alpha >= 1) return `#${r}${g}${b}`.toLowerCase();
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}${a}`.toLowerCase();
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function extractNodeIdFromUrl(figmaUrl: string): string | null {
  const match = /[?&]node-id=([^&]+)/.exec(figmaUrl);
  if (!match || !match[1]) return null;
  // Figma URLs use X-Y; the API uses X:Y.
  return decodeURIComponent(match[1]).replace(/-/g, ':');
}

interface FigmaVariableAlias { type: 'VARIABLE_ALIAS'; id: string }
interface FigmaVariablesResponse {
  meta?: {
    variables?: Record<string, {
      id: string;
      name: string;
      key: string;
      remote?: boolean;
      variableCollectionId?: string;
      resolvedType?: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
      valuesByMode?: Record<string, unknown>;
    } | undefined>;
    variableCollections?: Record<string, {
      id: string;
      name: string;
      defaultModeId?: string;
      modes?: Array<{ modeId: string; name: string }>;
    } | undefined>;
  };
}

interface InlineWalkCtx {
  spacings: number[];
  radii: number[];
  colors: FigmaColor[];
  fonts: FigmaFont[];
  shadows: FigmaShadow[];
  seenColors: Set<string>;
  seenFonts: Set<string>;
  seenShadows: Set<string>;
  maxColors: number;
  maxFonts: number;
  maxShadows: number;
}

function walkInlineTokens(node: FigmaNodeWithStyle, ctx: InlineWalkCtx, depth = 0): void {
  if (depth > 12) return;
  if (Number.isFinite(node.itemSpacing) && (node.itemSpacing ?? 0) > 0) ctx.spacings.push(Math.round(node.itemSpacing!));
  if (Number.isFinite(node.paddingLeft) && (node.paddingLeft ?? 0) > 0) ctx.spacings.push(Math.round(node.paddingLeft!));
  if (Number.isFinite(node.paddingTop) && (node.paddingTop ?? 0) > 0) ctx.spacings.push(Math.round(node.paddingTop!));
  if (Number.isFinite(node.cornerRadius) && (node.cornerRadius ?? 0) > 0) ctx.radii.push(Math.round(node.cornerRadius!));
  if (Array.isArray(node.rectangleCornerRadii)) {
    for (const r of node.rectangleCornerRadii) {
      if (Number.isFinite(r) && r > 0) ctx.radii.push(Math.round(r));
    }
  }
  if (Array.isArray(node.fills) && ctx.colors.length < ctx.maxColors) {
    for (const fill of node.fills) {
      if (fill && fill.type === 'SOLID' && fill.color) {
        const opacity = (fill.opacity ?? 1) * ((fill.color.a ?? 1));
        const hex = rgbaToHex(fill.color, fill.opacity ?? 1);
        if (!ctx.seenColors.has(hex)) {
          ctx.seenColors.add(hex);
          ctx.colors.push({
            name: `color-${ctx.colors.length + 1}`,
            hex,
            rgba: { r: fill.color.r, g: fill.color.g, b: fill.color.b, a: opacity },
            styleId: '',
          });
          if (ctx.colors.length >= ctx.maxColors) break;
        }
      }
    }
  }
  if (node.style && ctx.fonts.length < ctx.maxFonts) {
    const ts = node.style;
    const family = ts.fontFamily || '';
    if (family) {
      const sig = `${family}|${ts.fontWeight ?? 400}|${ts.fontSize ?? 16}`;
      if (!ctx.seenFonts.has(sig)) {
        ctx.seenFonts.add(sig);
        ctx.fonts.push({
          name: `text-${ctx.fonts.length + 1}`,
          family,
          weight: Number.isFinite(ts.fontWeight) ? Number(ts.fontWeight) : 400,
          size: Number.isFinite(ts.fontSize) ? Number(ts.fontSize) : 16,
          lineHeight: ts.lineHeightPx ? `${roundTo(ts.lineHeightPx, 1)}px` : null,
          letterSpacing: Number.isFinite(ts.letterSpacing) ? Number(ts.letterSpacing) : null,
          styleId: '',
        });
      }
    }
  }
  if (Array.isArray(node.effects) && ctx.shadows.length < ctx.maxShadows) {
    for (const effect of node.effects) {
      if (
        effect
        && (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW')
        && effect.color
      ) {
        const c = effect.color;
        const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
        const offsetX = roundTo(effect.offset?.x ?? 0, 1);
        const offsetY = roundTo(effect.offset?.y ?? 0, 1);
        const radius = roundTo(effect.radius ?? 0, 1);
        const r = clamp255(c.r);
        const g = clamp255(c.g);
        const b = clamp255(c.b);
        const a = Number.isFinite(c.a) ? Number(c.a) : 1;
        const value = `${inset}${offsetX}px ${offsetY}px ${radius}px rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
        if (!ctx.seenShadows.has(value)) {
          ctx.seenShadows.add(value);
          ctx.shadows.push({
            name: `shadow-${ctx.shadows.length + 1}`,
            value,
            styleId: '',
          });
          if (ctx.shadows.length >= ctx.maxShadows) break;
        }
      }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkInlineTokens(child, ctx, depth + 1);
  }
}

function walkNumericSignals(
  node: FigmaNodeWithStyle,
  spacings: number[],
  radii: number[],
): void {
  if (Number.isFinite(node.itemSpacing) && (node.itemSpacing ?? 0) > 0) spacings.push(Math.round(node.itemSpacing!));
  if (Number.isFinite(node.paddingLeft) && (node.paddingLeft ?? 0) > 0) spacings.push(Math.round(node.paddingLeft!));
  if (Number.isFinite(node.paddingTop) && (node.paddingTop ?? 0) > 0) spacings.push(Math.round(node.paddingTop!));
  if (Number.isFinite(node.cornerRadius) && (node.cornerRadius ?? 0) > 0) radii.push(Math.round(node.cornerRadius!));
  if (Array.isArray(node.rectangleCornerRadii)) {
    for (const r of node.rectangleCornerRadii) {
      if (Number.isFinite(r) && r > 0) radii.push(Math.round(r));
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkNumericSignals(child, spacings, radii);
  }
}

function dedupeAndScale(values: number[], cap: number): number[] {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
    .slice(0, cap)
    .map((entry) => entry[0])
    .sort((a, b) => a - b);
}

// ───────────────────────────────────────────────────────────────────────
// Output renderers.
// ───────────────────────────────────────────────────────────────────────

function cssVarName(prefix: string, raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `--${prefix}-${slug || 'token'}`;
}

function renderTokensCss(
  colors: FigmaColor[],
  fonts: FigmaFont[],
  shadows: FigmaShadow[],
  spacings: FigmaSpacing[],
  radii: FigmaRadius[],
): string {
  const lines: string[] = [];
  lines.push('/* Generated from Figma. Source-of-truth lives in the Figma file styles. */');
  lines.push(':root {');
  if (colors.length > 0) {
    lines.push('  /* Colors */');
    for (const c of colors) lines.push(`  ${cssVarName('color', c.name)}: ${c.hex};`);
  }
  if (fonts.length > 0) {
    lines.push('  /* Typography */');
    for (const f of fonts) {
      const safeFamily = /[\s,]/.test(f.family) ? `"${f.family.replace(/"/g, '\\"')}"` : f.family;
      const slug = (f.name || 'text').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      lines.push(`  --font-${slug}-family: ${safeFamily};`);
      lines.push(`  --font-${slug}-size: ${f.size}px;`);
      lines.push(`  --font-${slug}-weight: ${f.weight};`);
      if (f.lineHeight) lines.push(`  --font-${slug}-line-height: ${f.lineHeight};`);
      if (f.letterSpacing != null) lines.push(`  --font-${slug}-letter-spacing: ${roundTo(f.letterSpacing, 2)}px;`);
    }
  }
  if (shadows.length > 0) {
    lines.push('  /* Elevations */');
    for (const s of shadows) lines.push(`  ${cssVarName('shadow', s.name)}: ${s.value};`);
  }
  if (spacings.length > 0) {
    lines.push('  /* Spacing */');
    for (const s of spacings) lines.push(`  ${cssVarName('space', s.name)}: ${s.value}px;`);
  }
  if (radii.length > 0) {
    lines.push('  /* Radii */');
    for (const r of radii) lines.push(`  ${cssVarName('radius', r.name)}: ${r.value}px;`);
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function renderDesignMd(
  id: string,
  displayName: string,
  figmaUrl: string,
  colors: FigmaColor[],
  fonts: FigmaFont[],
  shadows: FigmaShadow[],
  spacings: FigmaSpacing[],
  radii: FigmaRadius[],
): string {
  const lines: string[] = [];
  lines.push(`# ${displayName}`);
  lines.push('');
  lines.push('> Category: Imported');
  lines.push(`> Source: [${figmaUrl}](${figmaUrl})`);
  lines.push('');
  lines.push('Generated from a Figma file. Colors, typography, and effect styles map to published Figma styles. Spacing and radius are sampled from the auto-layout signals on the targeted node (if a `node-id` was included in the URL).');
  lines.push('');
  if (colors.length > 0) {
    lines.push('## Color tokens');
    lines.push('');
    for (const c of colors) lines.push(`- **${c.name}** \`${c.hex}\``);
    lines.push('');
  }
  if (fonts.length > 0) {
    lines.push('## Typography tokens');
    lines.push('');
    for (const f of fonts) {
      const lh = f.lineHeight ? ` / line-height ${f.lineHeight}` : '';
      lines.push(`- **${f.name}** — ${f.family} ${f.size}px / ${f.weight}${lh}`);
    }
    lines.push('');
  }
  if (shadows.length > 0) {
    lines.push('## Elevation tokens');
    lines.push('');
    for (const s of shadows) lines.push(`- **${s.name}** \`${s.value}\``);
    lines.push('');
  }
  if (spacings.length > 0) {
    lines.push('## Spacing tokens');
    lines.push('');
    lines.push(spacings.map((s) => `\`${s.value}px\``).join(' · '));
    lines.push('');
  }
  if (radii.length > 0) {
    lines.push('## Radius tokens');
    lines.push('');
    lines.push(radii.map((r) => `\`${r.value}px\``).join(' · '));
    lines.push('');
  }
  lines.push('## Components');
  lines.push('');
  lines.push('Components were not extracted from this import. The component library lives outside the tokens pipeline.');
  lines.push('');
  return lines.join('\n');
}

function renderManifest(
  id: string,
  displayName: string,
  figmaUrl: string,
  fileKey: string,
  fileMeta: { name?: string; lastModified?: string; version?: string },
  colors: FigmaColor[],
  fonts: FigmaFont[],
  shadows: FigmaShadow[],
): Record<string, unknown> {
  const swatches = colors.slice(0, 6).map((c) => c.hex);
  return {
    id,
    name: displayName,
    summary: `${colors.length} colors · ${fonts.length} text styles · ${shadows.length} elevations`,
    category: 'Imported',
    source: {
      type: 'figma',
      url: figmaUrl,
      fileKey,
      figmaFileName: fileMeta.name ?? null,
      lastModified: fileMeta.lastModified ?? null,
      version: fileMeta.version ?? null,
      importedAt: new Date().toISOString(),
    },
    swatches,
    isEditable: true,
  };
}

// Re-export so callers can wrap the same error shape.
export { LocalDesignSystemImportError };
