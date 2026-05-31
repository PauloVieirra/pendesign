# Image Assets in Web Artifacts — Design

**Status:** Draft (awaiting user review)
**Date:** 2026-05-30
**Owner:** Paulo
**Scope:** Single PR

## Summary

Make AI-generated web artifacts (landing pages, sites, slide decks) actually carry images. Today the system prompt explicitly forbids embedding images in web outputs, so generated landing pages end up with empty image regions or descriptive captions where photos should be. This change:

1. **Lifts the embed restriction** in the official system prompt and replaces it with positive guidance on when to use stock photos vs custom-generated images.
2. **Adds a Pixabay image-search pipeline** as a new daemon CLI surface (`od images search`, `od images download`), so the agent can fetch free-to-use stock photos with one command and drop them into the project workspace.
3. **Wires the existing `od media generate --surface image`** as the second path for hero / branded imagery the agent identifies as needing custom artwork.

Result: AI-generated artifacts come out with real images by default. Hero shots are AI-generated for brand uniqueness; thematic / contextual photos come from Pixabay for cost and speed.

## Motivation

- Current state: `apps/daemon/src/prompts/official-system.ts:108` explicitly tells the agent: "Don't try to embed user images by URL into the artifact unless the user explicitly wants that". As a result, landing pages render with text-only sections where images should live.
- The image-generation pipeline (`od media generate --surface image`) already exists and works — multiple providers wired (OpenAI Azure, Volcengine Seedream, Grok image, Nano Banana). But it's invoked only when the project itself is an image-surface project (the Image plugin), not when an artifact-generation flow needs an embedded image.
- No stock photo search integration exists. Users who want filler imagery either paste URLs manually or live with empty regions.

The fix isn't another generator — it's removing the restriction, adding a cheap default path (stock), and instructing the agent on when to use each.

## Non-goals

- **No user-uploaded image library / asset manager** in this PR. The agent works with what it generates or fetches; reuse across projects comes later.
- **No on-the-fly image editing** (cropping, background removal). Pixabay's existing image is used as-is. Future enhancement.
- **No image search providers beyond Pixabay** in v1. Unsplash/Pexels can come as a follow-up if Pixabay coverage proves insufficient.
- **No cost cap / warning** on AI generation. The agent will be conservative (default to stock), but if it does call `od media generate` for, say, 5 hero images, the user pays the provider cost without an inline budget check.
- **No image alt-text generation via vision API**. The agent provides alt text based on its own context (since it knows what it requested). Future improvement: vision-API derived alt text for higher accuracy.

## Architecture

```
┌─ AI agent (generating an HTML / Markdown / Slide artifact) ────┐
│                                                                │
│ For each image slot identified in the output:                  │
│   classifyImageSlot(context) → 'hero' | 'thematic'             │
│                                                                │
│   if 'hero' / branded:                                         │
│     ↓                                                          │
│     `od media generate --surface image --prompt "..." \         │
│        --output ./assets/images/hero.png`                      │
│                                                                │
│   if 'thematic' / contextual:                                  │
│     ↓                                                          │
│     `od images search "<query>" --count 3 --orientation ...`   │
│        → JSON of candidates                                    │
│     ↓                                                          │
│     `od images download <url> ./assets/images/<name>.jpg`      │
│        → file at project-relative path                         │
│                                                                │
│   Embed: <img src="./assets/images/..." alt="..."              │
│              loading="lazy" width=".." height=".." />          │
└──────────────────┬─────────────────────────────────────────────┘
                   ↓
┌─ Daemon CLI surface (new) ─────────────────────────────────────┐
│ od images search "query"  →  pixabay client → normalized JSON  │
│ od images download URL    →  fetch + optimize + write to fs    │
└────────────────────────────────────────────────────────────────┘
```

## CLI surface

### `od images search`

```bash
od images search "<query>" \
  [--count <N>] \
  [--orientation horizontal|vertical|square] \
  [--min-width <px>] \
  [--category backgrounds|fashion|nature|science|education|feelings|health|people|religion|places|animals|industry|computer|food|sports|transportation|travel|buildings|business|music] \
  [--json]
```

Required:
- `<query>` — free text. Tokenized client-side, sent to Pixabay's `q` parameter.

Optional:
- `--count N` — number of candidates to return (default 5, max 20).
- `--orientation` — Pixabay accepts `horizontal`, `vertical`, `all` (default).
- `--min-width` — Pixabay `min_width` filter.
- `--category` — Pixabay's `category` enum (closed set above).
- `--json` — emit machine-readable JSON; default is a compact human table.

Output (JSON shape per result):

```typescript
interface PixabayResult {
  id: number;
  url: string;          // direct image URL (largeImageURL when available, falls back to webformatURL)
  width: number;
  height: number;
  tags: string;         // comma-separated Pixabay tags
  user: string;
  pageURL: string;      // attribution link
  previewURL: string;   // small thumbnail
}
```

Error exits:
- `PIXABAY_API_KEY not set` → exit 2 with link to settings
- Pixabay rate-limit (HTTP 429) → exit 3 with retry-after hint
- Network/timeout (15s default) → exit 4

### `od images download`

```bash
od images download <url> <project-relative-path> [--no-optimize]
```

Required:
- `<url>` — http(s) URL to a Pixabay-served image (validated to be on a `*.pixabay.com` host for safety).
- `<project-relative-path>` — destination inside the project workspace (e.g., `./assets/images/hero.jpg`). Path-traversal sanitized like other project-file writes.

Optional:
- `--no-optimize` — skip the resize+recompress step (default behavior is to resize anything > 2000px on the longest edge and re-encode JPEG at quality 85).

Behavior:
- Creates parent directories as needed.
- Fetches via existing daemon HTTP client (15s timeout, follows redirects, validates content-type starts with `image/`).
- If `--no-optimize` not set: uses `sharp` if installed; otherwise falls back to a node-native resize via `Sharp`-equivalent or skips optimization with a warning.
- Writes atomically (write to `<path>.tmp`, then rename).
- Emits a `od:artifact:wrote` event so the existing artifact-tracking surfaces (token-sync, file watcher) see the new file.

Output: the absolute resolved path on success; nothing on failure (non-zero exit).

## Pixabay client

Lives in `apps/daemon/src/images-search.ts`. One responsibility: take a query + filters, hit Pixabay's `GET https://pixabay.com/api/`, return a normalized typed array.

```typescript
export interface PixabaySearchInput {
  query: string;
  count?: number;
  orientation?: 'horizontal' | 'vertical' | 'all';
  minWidth?: number;
  category?: string;
  signal?: AbortSignal;
}

export interface PixabayImage {
  id: number;
  url: string;
  width: number;
  height: number;
  tags: string;
  user: string;
  pageURL: string;
  previewURL: string;
}

export async function searchPixabay(input: PixabaySearchInput): Promise<PixabayImage[]>;
```

Implementation notes:
- Reads `PIXABAY_API_KEY` from the daemon's existing API-key resolution layer (same place OpenAI/Anthropic keys live — `app-config.ts` / `media-config.json`).
- Uses `undici` (already in daemon deps) for fetch.
- Pixabay query params: `key, q, image_type=photo, safesearch=true, per_page, orientation, min_width, category`.
- Maps Pixabay's response: prefer `largeImageURL` then `webformatURL` then `imageURL` for the `url` field.
- 15s timeout, single retry on 502/503/504, no retry on 4xx.
- Returns at most `per_page` results, never more than 20.

## Image downloader

`apps/daemon/src/images-download.ts`. Two functions:

```typescript
export interface DownloadInput {
  url: string;
  projectId: string;
  destRelative: string;       // e.g. './assets/images/hero.jpg'
  optimize?: boolean;          // default true
}

export interface DownloadResult {
  absolutePath: string;
  bytesWritten: number;
  finalDimensions: { width: number; height: number };
}

export async function downloadImage(input: DownloadInput): Promise<DownloadResult>;
```

Optimization step:
- If `sharp` is available as a daemon dep, use it: `sharp(buffer).resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(...)`
- If not, write raw bytes and emit a `console.warn('image not optimized — install sharp')`.

URL safety:
- Allowlist hosts: `pixabay.com`, `cdn.pixabay.com`. Reject anything else (the AI shouldn't fetch random URLs through this command).
- Content-type must start with `image/`. Anything else → error.
- Max file size 10 MB. Past that → error (Pixabay images rarely exceed this; protects against hostile redirects).

## System prompt updates

Edit `apps/daemon/src/prompts/official-system.ts`:

Remove (around line 108):

> Don't try to embed user images by URL into the artifact unless the user explicitly wants that — copy or reference by path.

Replace with:

```markdown
## Embedding images in web artifacts

Real images make a landing page or marketing site land. Use them.

Two sources, both invocable via the CLI you already have:

**Hero / branded / scene-specific imagery** — when the image needs to look
like the brand, depict a specific product or service, or carry the
identity of the hero section:

\`\`\`bash
"$OD_NODE_BIN" "$OD_BIN" media generate \\
  --surface image \\
  --prompt "<one-paragraph visual description, including style + composition>" \\
  --output ./assets/images/<descriptive-name>.png
\`\`\`

**Thematic / stock imagery** — backgrounds, supporting photos, gallery
grids, blog post thumbnails, illustrative ornaments. Free, fast, no
generation cost:

\`\`\`bash
"$OD_NODE_BIN" "$OD_BIN" images search "people working in office" --count 3 --orientation horizontal --json
# Pick the URL that best matches the slot's style and tone.

"$OD_NODE_BIN" "$OD_BIN" images download "<url>" ./assets/images/<descriptive-name>.jpg
# File lands at the project-relative path; the optimizer resizes > 2000px and recompresses JPEG.
\`\`\`

Both paths write the file into the project workspace at the relative
path you specify. Reference it from your HTML / JSX / Markdown:

\`\`\`html
<img src="./assets/images/hero.png"
     alt="<concrete description of what's in the image>"
     loading="lazy"
     width="1200" height="600">
\`\`\`

Rules of thumb:
- Default to stock search. Only AI-generate when the visual is brand /
  product / hero specific.
- Always pass \`width\` + \`height\` (or CSS aspect-ratio) to prevent
  layout shift. The download command's JSON output includes finalDimensions.
- Always set \`loading="lazy"\` except for above-the-fold images.
- Alt text describes content, not "image of …". Empty alt only for
  decorative ornaments.
- Don't hotlink Pixabay URLs (don't embed the URL directly). Always
  download into the project first so the artifact is self-contained.
- Don't paste Pixabay's preview thumbnails — they're 640px max.

If \`PIXABAY_API_KEY\` is not configured, \`od images search\` exits with
a clear message. In that case, generate via \`od media generate\` or omit
the image and let the user fill it in later.
```

The existing user-attached-image guidance ("treat as visual reference, lift palette") stays — that's a different case (user-supplied reference vs. agent-fetched fill).

## Settings UI

In `apps/web/src/components/SettingsDialog.tsx`, mirror the existing API-key entry pattern (OpenAI, Anthropic) and add:

- Label: "Pixabay API key"
- Description: "Free key from pixabay.com/api — enables image search for AI-generated pages. 5000 requests/hour limit."
- Field type: password / secret
- Storage: same place existing keys live (env-mapped, persisted via the existing settings backend)
- Validation: trim, must be non-empty when set (no length / format check — Pixabay's keys are opaque strings)

When unset, the AI will simply skip image search and the user sees text-only fallback. The settings dialog should make this gentle, not alarming.

## Files

### New (daemon)
- `apps/daemon/src/images-search.ts` — Pixabay client (`searchPixabay`)
- `apps/daemon/src/images-download.ts` — downloader + optimizer (`downloadImage`)
- `apps/daemon/src/images-cli.ts` — CLI wiring for `od images search` and `od images download`
- `apps/daemon/tests/images-search.test.ts` — Pixabay client tests (mock fetch)
- `apps/daemon/tests/images-download.test.ts` — downloader tests (mock fetch + tmp dir)

### Modified (daemon)
- `apps/daemon/src/cli.ts` — register the `images` subcommand
- `apps/daemon/src/prompts/official-system.ts` — replace the embed restriction with the new section
- `apps/daemon/package.json` — add `sharp` dependency (optional with graceful fallback if not installed)

### Modified (web)
- `apps/web/src/components/SettingsDialog.tsx` — add Pixabay API key field

### i18n
- New keys for the settings dialog field (Pixabay key label, hint, save status) across 18 locales

## Testing

### Unit (daemon)
- `images-search.test.ts`:
  - `searchPixabay({ query: 'cars' })` builds correct Pixabay URL with default params, returns mapped array
  - Missing `PIXABAY_API_KEY` → throws `MissingApiKeyError` with `kind: 'pixabay'`
  - Pixabay returns 0 hits → empty array, no throw
  - Pixabay returns 429 → throws `RateLimitedError` with retry-after
  - Pixabay returns malformed JSON → throws `InvalidResponseError`
- `images-download.test.ts`:
  - Allowed host (`pixabay.com`) → downloads, writes file, returns dimensions
  - Disallowed host → throws `UnsafeUrlError`
  - Non-image content-type → throws `InvalidContentTypeError`
  - File > 10 MB → throws `FileTooLargeError`
  - Optimization on / off paths
  - Atomic write (`.tmp` then rename) verified by intermediate file check

### Integration (e2e)
- A single test under `e2e/tests/images-cli.test.ts`:
  - Boot daemon stack with a fake `PIXABAY_API_KEY=test`
  - Hit a mock Pixabay endpoint via test fixture
  - Run `od images search 'cats' --json` → assert JSON shape
  - Run `od images download <fake-url> ./test.jpg` → assert file written

### Prompt
- `apps/daemon/tests/prompts/official-system.test.ts` — verify the new "Embedding images" section is in the composed prompt; verify the old "Don't try to embed user images" string is gone.

## Edge cases

- **Pixabay key missing** — `od images search` exits with code 2 and a clear message pointing at Settings. The agent treats this as a soft fail (continues without images for that slot).
- **Pixabay temporarily down** — retry once, then give up. Agent falls back to AI gen if it deems the slot important; otherwise skips.
- **User-pasted reference image** — handled by the OLD prompt section, untouched. Different code path.
- **Project has no `./assets/images/` directory** — the downloader creates it.
- **Filename collision** — downloader fails fast (no overwrite). Agent is instructed to use unique descriptive names.
- **`sharp` not installed** — downloader writes the raw bytes, emits a warning, returns the original dimensions instead of optimized ones. The artifact still works; the file is just bigger.
- **AI gen failure mid-flow** — `od media generate` returns non-zero, agent falls back to `od images search` for that slot.
- **HTTPS required** — only `https://` URLs accepted by the downloader. `http://` rejected as unsafe.

## Rollout

Single PR.

No feature flag. The behavior change is contained to the prompt + new CLI subcommands. Old projects don't gain images retroactively (would require a re-generation), but every new artifact written after deploy will have the new behavior.

## Open questions

- **Should `sharp` be a hard dependency or optional?** Hard makes the binary heavier on Linux/Windows installers; optional means some users get unoptimized images. Decision: **optional**. The downloader checks for sharp at runtime and warns instead of failing if absent.
- **Should the AI consider video/audio with the same pattern?** This PR is image-only. Video already has its own `od media generate --surface video` path that's used in the deck plugin; we don't change that.
