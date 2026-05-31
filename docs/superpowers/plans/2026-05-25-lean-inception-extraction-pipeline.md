# Lean Inception Extraction Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `od lean-inception extract <doc...>` CLI + matching HTTP API that ingests MD/TXT documents, calls an existing agent runtime to extract Lean Inception cards (7 columns) with per-doc provenance and confidence, and persists them to SQLite under the current OD project.

**Architecture:** Single daemon HTTP service (no new sidecars). CLI is a thin client over `fetch`. Extraction is a sequential per-doc pipeline: ingest → spawn runtime → parse JSON → validate (Zod + literal-anchor check) → atomic SQLite insert. Column status is derived on-read, never persisted. Source of truth for the design is `docs/superpowers/specs/2026-05-25-lean-inception-extraction-pipeline-design.md`.

**Tech Stack:** TypeScript 5.9 (strict), Node 24, Express (daemon), better-sqlite3, Zod (contracts), Vitest (tests), pnpm workspaces. Reuses existing `runtimes/` infrastructure (Claude/Codex/etc.) — no new agent dependencies.

---

## File Structure (locked decisions)

### New files

| Path | Responsibility |
|---|---|
| `packages/contracts/src/api/lean-inception.ts` | All Zod schemas + inferred types (DTOs, request/response, error codes) for HTTP API. Pure TS. |
| `apps/daemon/src/lean-inception/column-keys.ts` | Const array + union type for the 7 column keys. Single source of truth. |
| `apps/daemon/src/lean-inception/content-hash.ts` | `computeContentHash(bytes: Buffer): string` — sha256, hex. |
| `apps/daemon/src/lean-inception/derive-column-status.ts` | Pure: `deriveColumnStatus(cards): 'complete' \| 'partial' \| 'insufficient' \| 'not_identified'`. |
| `apps/daemon/src/lean-inception/validate-anchor.ts` | Pure: normalize whitespace + verify anchor appears literally in source doc. |
| `apps/daemon/src/lean-inception/parse-llm-output.ts` | Pure: extract JSON object from runtime stdout (handles ` ```json ``` ` blocks, raw JSON, JSON with prose around it). |
| `apps/daemon/src/lean-inception/line-prefixer.ts` | Pure: prefix `.md` content lines with `L<n>: ` for prompt injection. |
| `apps/daemon/src/lean-inception/prompts/v1.ts` | Exports `LEAN_INCEPTION_SYSTEM_PROMPT_V1`, `LEAN_INCEPTION_PROMPT_VERSION = 1`, `buildUserPrompt(doc)`. |
| `apps/daemon/src/lean-inception/persistence.ts` | All SQLite reads/writes for inceptions, documents, cards, extractions. Exports `migrateLeanInception(db)` (called from `db.ts#migrate()`). |
| `apps/daemon/src/lean-inception/runtime-invoke.ts` | Thin wrapper around existing `runtimes/` infra. Exposed as an interface so tests can stub it. |
| `apps/daemon/src/lean-inception/extraction-service.ts` | Orchestrator: ingest → invoke runtime → parse → validate → persist (atomic). |
| `apps/daemon/src/lean-inception-routes.ts` | Express route registration `registerLeanInceptionRoutes(app, ctx)`. |
| `apps/daemon/src/lean-inception-cli.ts` | CLI subcommand handlers (`extract`, `status`, `list`, `remove-doc`, `reset`). |
| `apps/daemon/tests/lean-inception/content-hash.test.ts` | Unit. |
| `apps/daemon/tests/lean-inception/derive-column-status.test.ts` | Unit. |
| `apps/daemon/tests/lean-inception/validate-anchor.test.ts` | Unit. |
| `apps/daemon/tests/lean-inception/parse-llm-output.test.ts` | Unit. |
| `apps/daemon/tests/lean-inception/line-prefixer.test.ts` | Unit. |
| `apps/daemon/tests/lean-inception/prompts.test.ts` | Unit (builder shape, version constant). |
| `apps/daemon/tests/lean-inception/persistence.test.ts` | Unit + integration with tmp SQLite. |
| `apps/daemon/tests/lean-inception/extraction-service.test.ts` | Integration with mocked runtime. |
| `apps/daemon/tests/lean-inception/routes.test.ts` | HTTP integration with supertest-style + mocked runtime. |
| `apps/daemon/tests/lean-inception/fixtures/discovery-notes.md` | Golden fixture (1 sample, more added in follow-up). |
| `apps/daemon/tests/lean-inception/fixtures/discovery-notes.expected.json` | Minimum coverage expectations. |

### Modified files

| Path | Change |
|---|---|
| `packages/contracts/src/api/index.ts` | Re-export `* from './lean-inception.js'`. |
| `apps/daemon/src/db.ts` | Import `migrateLeanInception`; call it inside `migrate()`. |
| `apps/daemon/src/server.ts` | Import + call `registerLeanInceptionRoutes(app, ctx)` near `registerMediaRoutes`. |
| `apps/daemon/src/cli.ts` | Add `runLeanInception` import; add `'lean-inception'` key to `SUBCOMMAND_MAP`. |

---

## Conventions Used Throughout

- **Commit format:** Conventional Commits with scope. Examples: `feat(contracts): add lean-inception schemas`, `feat(daemon): wire lean-inception routes`. No `Co-authored-by` trailers (per `AGENTS.md`).
- **Test runner:** Vitest. Run from `apps/daemon`: `pnpm --filter @open-design/daemon test <file>`.
- **TypeScript:** Strict. All exports typed.
- **TDD discipline:** Write failing test → run to confirm RED → minimal implementation → run to confirm GREEN → commit.

---

## Task 1: Contract — Zod schemas in `packages/contracts`

**Files:**
- Create: `packages/contracts/src/api/lean-inception.ts`
- Modify: `packages/contracts/src/api/index.ts`

- [ ] **Step 1: Create contract file with all schemas**

```ts
// packages/contracts/src/api/lean-inception.ts
import { z } from 'zod';

export const LEAN_INCEPTION_COLUMN_KEYS = [
  'vision',
  'objective',
  'problem',
  'personas',
  'features',
  'business_rules',
  'acceptance_criteria',
] as const;

export const LeanInceptionColumnKeySchema = z.enum(LEAN_INCEPTION_COLUMN_KEYS);
export type LeanInceptionColumnKey = z.infer<typeof LeanInceptionColumnKeySchema>;

export const LeanInceptionConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type LeanInceptionConfidence = z.infer<typeof LeanInceptionConfidenceSchema>;

export const LeanInceptionColumnStatusSchema = z.enum([
  'complete',
  'partial',
  'insufficient',
  'not_identified',
]);
export type LeanInceptionColumnStatus = z.infer<typeof LeanInceptionColumnStatusSchema>;

export const LeanInceptionCardSchema = z.object({
  id: z.string(),
  inception_id: z.string(),
  document_id: z.string(),
  column_key: LeanInceptionColumnKeySchema,
  title: z.string().min(5).max(120),
  content: z.string().min(1),
  confidence: LeanInceptionConfidenceSchema,
  source_anchor: z.string().min(1).max(280),
  source_line: z.number().int().positive().nullable(),
  extraction_id: z.string(),
  created_at: z.string(),
});
export type LeanInceptionCard = z.infer<typeof LeanInceptionCardSchema>;

export const LeanInceptionDocumentSchema = z.object({
  id: z.string(),
  inception_id: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  byte_size: z.number().int().nonnegative(),
  content_hash: z.string(),
  ingested_at: z.string(),
  last_extracted_at: z.string().nullable(),
  extraction_status: z.enum(['pending', 'extracting', 'extracted', 'failed']),
  extraction_error: z.string().nullable(),
  card_count: z.number().int().nonnegative(),
});
export type LeanInceptionDocument = z.infer<typeof LeanInceptionDocumentSchema>;

export const LeanInceptionColumnSnapshotSchema = z.object({
  status: LeanInceptionColumnStatusSchema,
  cards: z.array(LeanInceptionCardSchema),
});
export type LeanInceptionColumnSnapshot = z.infer<typeof LeanInceptionColumnSnapshotSchema>;

export const LeanInceptionStateSchema = z.object({
  inception_id: z.string(),
  project_id: z.string(),
  documents: z.array(LeanInceptionDocumentSchema),
  columns: z.record(LeanInceptionColumnKeySchema, LeanInceptionColumnSnapshotSchema),
});
export type LeanInceptionState = z.infer<typeof LeanInceptionStateSchema>;

export const ExtractDocumentInputSchema = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
  mime_type: z.enum(['text/markdown', 'text/plain']),
});
export type ExtractDocumentInput = z.infer<typeof ExtractDocumentInputSchema>;

export const ExtractDocumentsRequestSchema = z.object({
  documents: z.array(ExtractDocumentInputSchema).min(1).max(20),
  runtime: z.string().optional(),
});
export type ExtractDocumentsRequest = z.infer<typeof ExtractDocumentsRequestSchema>;

export const LeanInceptionExtractionInfoSchema = z.object({
  runtime: z.string(),
  model: z.string().nullable(),
  prompt_version: z.number().int().positive(),
  duration_ms: z.number().int().nonnegative(),
  prompt_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
});
export type LeanInceptionExtractionInfo = z.infer<typeof LeanInceptionExtractionInfoSchema>;

export const ExtractDocumentsResponseSchema = z.object({
  state: LeanInceptionStateSchema,
  extractions: z.array(LeanInceptionExtractionInfoSchema),
});
export type ExtractDocumentsResponse = z.infer<typeof ExtractDocumentsResponseSchema>;

export const RemoveDocumentResponseSchema = z.object({
  state: LeanInceptionStateSchema,
});
export type RemoveDocumentResponse = z.infer<typeof RemoveDocumentResponseSchema>;

export const LEAN_INCEPTION_ERROR_CODES = [
  'UNSUPPORTED_FORMAT',
  'DOCUMENT_TOO_LARGE',
  'EMPTY_DOCUMENT',
  'PROJECT_NOT_FOUND',
  'RUNTIME_UNAVAILABLE',
  'EXTRACTION_TIMEOUT',
  'EXTRACTION_FAILED',
  'INVALID_JSON_OUTPUT',
  'SCHEMA_VALIDATION_FAILED',
  'DOCUMENT_NOT_FOUND',
] as const;

export const LeanInceptionErrorCodeSchema = z.enum(LEAN_INCEPTION_ERROR_CODES);
export type LeanInceptionErrorCode = z.infer<typeof LeanInceptionErrorCodeSchema>;

export const LeanInceptionErrorSchema = z.object({
  code: LeanInceptionErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type LeanInceptionError = z.infer<typeof LeanInceptionErrorSchema>;
```

- [ ] **Step 2: Re-export from `packages/contracts/src/api/index.ts`**

Read the file, find the existing export pattern, then add:

```ts
export * from './lean-inception.js';
```

If the file uses `export type` re-exports only, mirror that style by listing each exported symbol.

- [ ] **Step 3: Verify contracts typecheck**

```bash
pnpm --filter @open-design/contracts typecheck
```

Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/api/lean-inception.ts packages/contracts/src/api/index.ts
git commit -m "feat(contracts): add lean-inception API schemas"
```

---

## Task 2: Column keys constant in daemon

**Files:**
- Create: `apps/daemon/src/lean-inception/column-keys.ts`

- [ ] **Step 1: Create the file (mirrors contract, re-exports for ergonomics in daemon code)**

```ts
// apps/daemon/src/lean-inception/column-keys.ts
import {
  LEAN_INCEPTION_COLUMN_KEYS,
  type LeanInceptionColumnKey,
} from '@open-design/contracts';

export { LEAN_INCEPTION_COLUMN_KEYS, type LeanInceptionColumnKey };

export function isLeanInceptionColumnKey(value: unknown): value is LeanInceptionColumnKey {
  return typeof value === 'string'
    && (LEAN_INCEPTION_COLUMN_KEYS as readonly string[]).includes(value);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/daemon/src/lean-inception/column-keys.ts
git commit -m "feat(daemon): add lean-inception column keys constant"
```

---

## Task 3: Pure utility — `content-hash`

**Files:**
- Create: `apps/daemon/src/lean-inception/content-hash.ts`
- Test: `apps/daemon/tests/lean-inception/content-hash.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/daemon/tests/lean-inception/content-hash.test.ts
import { describe, expect, it } from 'vitest';
import { computeContentHash } from '../../src/lean-inception/content-hash.js';

describe('computeContentHash', () => {
  it('returns 64-char hex sha256', () => {
    const hash = computeContentHash(Buffer.from('hello world'));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for same input', () => {
    const a = computeContentHash(Buffer.from('same'));
    const b = computeContentHash(Buffer.from('same'));
    expect(a).toBe(b);
  });

  it('differs when whitespace is added (trailing newline counts)', () => {
    const a = computeContentHash(Buffer.from('foo'));
    const b = computeContentHash(Buffer.from('foo\n'));
    expect(a).not.toBe(b);
  });

  it('handles empty buffer', () => {
    const hash = computeContentHash(Buffer.from(''));
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test content-hash
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimal**

```ts
// apps/daemon/src/lean-inception/content-hash.ts
import { createHash } from 'node:crypto';

export function computeContentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test content-hash
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/lean-inception/content-hash.ts apps/daemon/tests/lean-inception/content-hash.test.ts
git commit -m "feat(daemon): add lean-inception content-hash utility"
```

---

## Task 4: Pure utility — `derive-column-status`

**Files:**
- Create: `apps/daemon/src/lean-inception/derive-column-status.ts`
- Test: `apps/daemon/tests/lean-inception/derive-column-status.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/daemon/tests/lean-inception/derive-column-status.test.ts
import { describe, expect, it } from 'vitest';
import { deriveColumnStatus } from '../../src/lean-inception/derive-column-status.js';

const make = (confidence: 'low' | 'medium' | 'high') => ({ confidence });

describe('deriveColumnStatus', () => {
  it('returns not_identified for empty array', () => {
    expect(deriveColumnStatus([])).toBe('not_identified');
  });

  it('returns insufficient when score < 1.5', () => {
    // 1 low = 0.3
    expect(deriveColumnStatus([make('low')])).toBe('insufficient');
    // 1 medium = 0.6
    expect(deriveColumnStatus([make('medium')])).toBe('insufficient');
    // 2 low = 0.6
    expect(deriveColumnStatus([make('low'), make('low')])).toBe('insufficient');
  });

  it('returns partial when 1.5 <= score < 3.0', () => {
    // 1 high + 1 medium = 1.6
    expect(deriveColumnStatus([make('high'), make('medium')])).toBe('partial');
    // 2 high = 2.0
    expect(deriveColumnStatus([make('high'), make('high')])).toBe('partial');
  });

  it('returns complete when score >= 3.0', () => {
    // 3 high = 3.0
    expect(deriveColumnStatus([make('high'), make('high'), make('high')])).toBe('complete');
    // 5 medium = 3.0
    expect(deriveColumnStatus(Array(5).fill(make('medium')))).toBe('complete');
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test derive-column-status
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/daemon/src/lean-inception/derive-column-status.ts
import type { LeanInceptionColumnStatus } from '@open-design/contracts';

type CardLike = { confidence: 'low' | 'medium' | 'high' };

export function deriveColumnStatus(cards: readonly CardLike[]): LeanInceptionColumnStatus {
  if (cards.length === 0) return 'not_identified';
  let score = 0;
  for (const card of cards) {
    if (card.confidence === 'high') score += 1.0;
    else if (card.confidence === 'medium') score += 0.6;
    else score += 0.3;
  }
  if (score >= 3.0) return 'complete';
  if (score >= 1.5) return 'partial';
  return 'insufficient';
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test derive-column-status
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/lean-inception/derive-column-status.ts apps/daemon/tests/lean-inception/derive-column-status.test.ts
git commit -m "feat(daemon): add lean-inception column status derivation"
```

---

## Task 5: Pure utility — `validate-anchor`

**Files:**
- Create: `apps/daemon/src/lean-inception/validate-anchor.ts`
- Test: `apps/daemon/tests/lean-inception/validate-anchor.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/daemon/tests/lean-inception/validate-anchor.test.ts
import { describe, expect, it } from 'vitest';
import { isAnchorValid, normalizeForAnchor } from '../../src/lean-inception/validate-anchor.js';

describe('normalizeForAnchor', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeForAnchor('Hello   World\n\tNice')).toBe('hello world nice');
  });

  it('handles empty string', () => {
    expect(normalizeForAnchor('')).toBe('');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeForAnchor('  foo  ')).toBe('foo');
  });
});

describe('isAnchorValid', () => {
  const doc = 'The product helps users.\n\nIt has THREE features.\nFirst, search.';

  it('returns true when anchor appears verbatim', () => {
    expect(isAnchorValid('It has THREE features.', doc)).toBe(true);
  });

  it('returns true when anchor matches with whitespace differences', () => {
    expect(isAnchorValid('It has   THREE   features.', doc)).toBe(true);
  });

  it('returns true case-insensitively', () => {
    expect(isAnchorValid('IT HAS three FEATURES.', doc)).toBe(true);
  });

  it('returns false for paraphrase (LLM hallucination)', () => {
    expect(isAnchorValid('The product has multiple features.', doc)).toBe(false);
  });

  it('returns false for empty anchor', () => {
    expect(isAnchorValid('', doc)).toBe(false);
  });

  it('returns false when anchor is not in doc', () => {
    expect(isAnchorValid('totally unrelated text', doc)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test validate-anchor
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/daemon/src/lean-inception/validate-anchor.ts
export function normalizeForAnchor(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isAnchorValid(anchor: string, doc: string): boolean {
  const normAnchor = normalizeForAnchor(anchor);
  if (normAnchor.length === 0) return false;
  const normDoc = normalizeForAnchor(doc);
  return normDoc.includes(normAnchor);
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test validate-anchor
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/lean-inception/validate-anchor.ts apps/daemon/tests/lean-inception/validate-anchor.test.ts
git commit -m "feat(daemon): add lean-inception anchor validation"
```

---

## Task 6: Pure utility — `parse-llm-output`

**Files:**
- Create: `apps/daemon/src/lean-inception/parse-llm-output.ts`
- Test: `apps/daemon/tests/lean-inception/parse-llm-output.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/daemon/tests/lean-inception/parse-llm-output.test.ts
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
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test parse-llm-output
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/daemon/src/lean-inception/parse-llm-output.ts
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
```

- [ ] **Step 4: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test parse-llm-output
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/lean-inception/parse-llm-output.ts apps/daemon/tests/lean-inception/parse-llm-output.test.ts
git commit -m "feat(daemon): add lean-inception LLM output parser"
```

---

## Task 7: Pure utility — `line-prefixer`

**Files:**
- Create: `apps/daemon/src/lean-inception/line-prefixer.ts`
- Test: `apps/daemon/tests/lean-inception/line-prefixer.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/daemon/tests/lean-inception/line-prefixer.test.ts
import { describe, expect, it } from 'vitest';
import { prefixLines } from '../../src/lean-inception/line-prefixer.js';

describe('prefixLines', () => {
  it('prefixes every line with L<n>: ', () => {
    expect(prefixLines('a\nb\nc')).toBe('L1: a\nL2: b\nL3: c');
  });

  it('handles single line', () => {
    expect(prefixLines('only')).toBe('L1: only');
  });

  it('preserves empty lines with their number', () => {
    expect(prefixLines('a\n\nb')).toBe('L1: a\nL2: \nL3: b');
  });

  it('handles trailing newline (treats last empty line)', () => {
    expect(prefixLines('a\n')).toBe('L1: a\nL2: ');
  });

  it('handles empty string', () => {
    expect(prefixLines('')).toBe('L1: ');
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test line-prefixer
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/daemon/src/lean-inception/line-prefixer.ts
export function prefixLines(content: string): string {
  return content
    .split('\n')
    .map((line, idx) => `L${idx + 1}: ${line}`)
    .join('\n');
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test line-prefixer
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/lean-inception/line-prefixer.ts apps/daemon/tests/lean-inception/line-prefixer.test.ts
git commit -m "feat(daemon): add lean-inception line prefixer"
```

---

## Task 8: Prompts V1

**Files:**
- Create: `apps/daemon/src/lean-inception/prompts/v1.ts`
- Test: `apps/daemon/tests/lean-inception/prompts.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/daemon/tests/lean-inception/prompts.test.ts
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
  it('mentions all 7 column keys', () => {
    const p = LEAN_INCEPTION_SYSTEM_PROMPT_V1;
    for (const key of ['vision', 'objective', 'problem', 'personas', 'features', 'business_rules', 'acceptance_criteria']) {
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
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test prompts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/daemon/src/lean-inception/prompts/v1.ts
import { prefixLines } from '../line-prefixer.js';

export const LEAN_INCEPTION_PROMPT_VERSION = 1;

export const LEAN_INCEPTION_SYSTEM_PROMPT_V1 = `You are a requirements analyst specialized in Lean Inception. Your only task is to EXTRACT information from a document and classify it into pre-defined columns.

ABSOLUTE RULES:

1. NEVER invent information. If something is not in the document, do NOT include it.
2. Each card MUST contain source_anchor: a LITERAL excerpt from the document (up to 280 characters) that justifies the extraction. Do NOT paraphrase the anchor.
3. Output MUST be valid JSON matching the schema below. Nothing before or after.
4. If a column has no data, return an empty array for it.
5. confidence reflects your certainty:
   - "high": explicit, complete, unambiguous information.
   - "medium": clear but incomplete, OR implicit but unequivocal.
   - "low": heavily inferred, or mentioned in passing.

COLUMNS (extract exactly these, with these criteria):

vision:               product vision statement / macro purpose
objective:            measurable or strategic business objectives
problem:              problem/pain the product solves
personas:             user types (role + context + motivation)
features:             concrete functionalities the product must have
business_rules:       rules, validations, domain restrictions
acceptance_criteria:  objective acceptance / done criteria

OUTPUT SCHEMA (return EXACTLY this shape, JSON only):
{
  "cards": [
    {
      "column_key": "<one of: vision | objective | problem | personas | features | business_rules | acceptance_criteria>",
      "title": "<5-80 chars, short identifier>",
      "content": "<expanded description, 1-3 sentences>",
      "confidence": "<high | medium | low>",
      "source_anchor": "<literal excerpt from the document>",
      "source_line": <line number where the excerpt starts, or null if the document has no line prefixes>
    }
  ]
}`;

export interface UserPromptInputV1 {
  filename: string;
  mimeType: 'text/markdown' | 'text/plain';
  content: string;
}

export function buildUserPromptV1(input: UserPromptInputV1): string {
  const format = input.mimeType === 'text/markdown' ? 'md' : 'txt';
  const body = format === 'md' ? prefixLines(input.content) : input.content;
  return `DOCUMENT (filename: ${input.filename}, format: ${format}):
---
${body}
---

Extract the cards according to the system prompt rules and return ONLY the JSON of the schema.`;
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test prompts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/lean-inception/prompts/v1.ts apps/daemon/tests/lean-inception/prompts.test.ts
git commit -m "feat(daemon): add lean-inception V1 prompts"
```

---

## Task 9: DB migration

**Files:**
- Create: `apps/daemon/src/lean-inception/persistence.ts` (initial: only `migrateLeanInception`)
- Modify: `apps/daemon/src/db.ts`
- Test: `apps/daemon/tests/lean-inception/persistence.test.ts`

- [ ] **Step 1: Write failing test (verifies tables exist after migrate)**

```ts
// apps/daemon/tests/lean-inception/persistence.test.ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrateLeanInception } from '../../src/lean-inception/persistence.js';

describe('migrateLeanInception', () => {
  it('creates all 4 tables', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    // create stub projects table so FK can resolve later; for migration alone it's not required
    migrateLeanInception(db);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lean_inception%'`
    ).all() as Array<{ name: string }>;

    const names = tables.map(t => t.name).sort();
    expect(names).toEqual([
      'lean_inception_cards',
      'lean_inception_documents',
      'lean_inception_extractions',
      'lean_inceptions',
    ]);
  });

  it('is idempotent (can run twice)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    expect(() => migrateLeanInception(db)).not.toThrow();
  });

  it('creates expected indexes', () => {
    const db = new Database(':memory:');
    migrateLeanInception(db);
    const indexes = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_li%'`
    ).all() as Array<{ name: string }>;
    const names = indexes.map(i => i.name).sort();
    expect(names).toContain('idx_lid_inception');
    expect(names).toContain('idx_lid_hash');
    expect(names).toContain('idx_lic_doc');
    expect(names).toContain('idx_lic_inception_col');
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test persistence
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement persistence migration**

```ts
// apps/daemon/src/lean-inception/persistence.ts
import type Database from 'better-sqlite3';

type SqliteDb = Database.Database;

export function migrateLeanInception(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lean_inceptions (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lean_inception_documents (
      id                  TEXT PRIMARY KEY,
      inception_id        TEXT NOT NULL REFERENCES lean_inceptions(id) ON DELETE CASCADE,
      filename            TEXT NOT NULL,
      mime_type           TEXT NOT NULL,
      byte_size           INTEGER NOT NULL,
      content_hash        TEXT NOT NULL,
      storage_path        TEXT NOT NULL,
      ingested_at         TEXT NOT NULL,
      last_extracted_at   TEXT,
      extraction_status   TEXT NOT NULL,
      extraction_error    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_lid_inception ON lean_inception_documents(inception_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lid_hash ON lean_inception_documents(inception_id, content_hash);

    CREATE TABLE IF NOT EXISTS lean_inception_cards (
      id              TEXT PRIMARY KEY,
      inception_id    TEXT NOT NULL REFERENCES lean_inceptions(id) ON DELETE CASCADE,
      document_id     TEXT NOT NULL REFERENCES lean_inception_documents(id) ON DELETE CASCADE,
      column_key      TEXT NOT NULL,
      title           TEXT NOT NULL,
      content         TEXT NOT NULL,
      confidence      TEXT NOT NULL,
      source_anchor   TEXT NOT NULL,
      source_line     INTEGER,
      extraction_id   TEXT NOT NULL,
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lic_doc ON lean_inception_cards(document_id);
    CREATE INDEX IF NOT EXISTS idx_lic_inception_col ON lean_inception_cards(inception_id, column_key);

    CREATE TABLE IF NOT EXISTS lean_inception_extractions (
      id                TEXT PRIMARY KEY,
      inception_id      TEXT NOT NULL REFERENCES lean_inceptions(id) ON DELETE CASCADE,
      document_id       TEXT NOT NULL REFERENCES lean_inception_documents(id) ON DELETE CASCADE,
      runtime           TEXT NOT NULL,
      model             TEXT,
      prompt_version    INTEGER NOT NULL,
      prompt_tokens     INTEGER,
      output_tokens     INTEGER,
      duration_ms       INTEGER,
      warnings_count    INTEGER NOT NULL DEFAULT 0,
      cards_persisted   INTEGER NOT NULL DEFAULT 0,
      cards_dropped     INTEGER NOT NULL DEFAULT 0,
      started_at        TEXT NOT NULL,
      finished_at       TEXT,
      status            TEXT NOT NULL,
      error_message     TEXT
    );
  `);
}
```

- [ ] **Step 4: Wire into central migrate in `db.ts`**

Read `apps/daemon/src/db.ts`, find the `migrate(db: SqliteDb)` function. At the top of the file add the import:

```ts
import { migrateLeanInception } from './lean-inception/persistence.js';
```

Inside `migrate()`, after the existing `migrateMediaTasks(db)` / `migratePlugins(db)` calls (or at the end of the function before returning), add:

```ts
migrateLeanInception(db);
```

- [ ] **Step 5: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test persistence
pnpm --filter @open-design/daemon typecheck
```

Expected: PASS, 3 tests. Typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/lean-inception/persistence.ts apps/daemon/src/db.ts apps/daemon/tests/lean-inception/persistence.test.ts
git commit -m "feat(daemon): add lean-inception SQLite schema and migration"
```

---

## Task 10: Persistence — inception + document CRUD

**Files:**
- Modify: `apps/daemon/src/lean-inception/persistence.ts` (extend existing module)
- Modify: `apps/daemon/tests/lean-inception/persistence.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

Append to `apps/daemon/tests/lean-inception/persistence.test.ts`:

```ts
import {
  upsertInceptionForProject,
  insertDocument,
  findDocumentByHash,
  findDocumentByFilename,
  listDocuments,
  deleteDocument,
  deleteInception,
} from '../../src/lean-inception/persistence.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateLeanInception(db);
  return db;
}

describe('upsertInceptionForProject', () => {
  it('creates row when project has no inception', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    expect(inception.id).toMatch(/^li_/);
    expect(inception.project_id).toBe('prj_1');
  });

  it('returns existing row on second call', () => {
    const db = freshDb();
    const a = upsertInceptionForProject(db, 'prj_1');
    const b = upsertInceptionForProject(db, 'prj_1');
    expect(b.id).toBe(a.id);
  });
});

describe('document CRUD', () => {
  it('inserts and finds by hash', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const doc = insertDocument(db, {
      inception_id: inception.id,
      filename: 'a.md',
      mime_type: 'text/markdown',
      byte_size: 12,
      content_hash: 'h1',
      storage_path: 'projects/prj_1/lean-inception/docs/d1.md',
    });
    expect(doc.id).toMatch(/^doc_/);
    expect(doc.extraction_status).toBe('pending');

    const found = findDocumentByHash(db, inception.id, 'h1');
    expect(found?.id).toBe(doc.id);
  });

  it('findDocumentByFilename returns the doc when filename matches', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    insertDocument(db, {
      inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown',
      byte_size: 12, content_hash: 'h1', storage_path: 'x',
    });
    expect(findDocumentByFilename(db, inception.id, 'a.md')?.filename).toBe('a.md');
    expect(findDocumentByFilename(db, inception.id, 'b.md')).toBeNull();
  });

  it('listDocuments returns all docs for inception ordered by ingested_at', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    insertDocument(db, { inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown', byte_size: 1, content_hash: 'h1', storage_path: 'x' });
    insertDocument(db, { inception_id: inception.id, filename: 'b.md', mime_type: 'text/markdown', byte_size: 1, content_hash: 'h2', storage_path: 'y' });
    const docs = listDocuments(db, inception.id);
    expect(docs.map(d => d.filename)).toEqual(['a.md', 'b.md']);
  });

  it('deleteDocument removes the doc and (via cascade) its cards', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const doc = insertDocument(db, {
      inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown',
      byte_size: 1, content_hash: 'h1', storage_path: 'x',
    });
    expect(deleteDocument(db, doc.id)).toBe(true);
    expect(listDocuments(db, inception.id)).toHaveLength(0);
  });

  it('deleteInception cascades to docs', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    insertDocument(db, { inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown', byte_size: 1, content_hash: 'h1', storage_path: 'x' });
    expect(deleteInception(db, inception.id)).toBe(true);
    expect(db.prepare('SELECT count(*) AS c FROM lean_inception_documents').get()).toEqual({ c: 0 });
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test persistence
```

Expected: FAIL — exports not found.

- [ ] **Step 3: Implement CRUD**

Append to `apps/daemon/src/lean-inception/persistence.ts`:

```ts
import { randomUUID } from 'node:crypto';

export interface InceptionRow {
  id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  inception_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  content_hash: string;
  storage_path: string;
  ingested_at: string;
  last_extracted_at: string | null;
  extraction_status: 'pending' | 'extracting' | 'extracted' | 'failed';
  extraction_error: string | null;
}

function nowIso() { return new Date().toISOString(); }
function newInceptionId() { return `li_${randomUUID().replace(/-/g, '')}`; }
function newDocumentId() { return `doc_${randomUUID().replace(/-/g, '')}`; }

export function upsertInceptionForProject(db: SqliteDb, projectId: string): InceptionRow {
  const existing = db.prepare(
    'SELECT * FROM lean_inceptions WHERE project_id = ?'
  ).get(projectId) as InceptionRow | undefined;
  if (existing) return existing;

  const row: InceptionRow = {
    id: newInceptionId(),
    project_id: projectId,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO lean_inceptions (id, project_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(row.id, row.project_id, row.created_at, row.updated_at);
  return row;
}

export interface InsertDocumentInput {
  inception_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  content_hash: string;
  storage_path: string;
}

export function insertDocument(db: SqliteDb, input: InsertDocumentInput): DocumentRow {
  const row: DocumentRow = {
    id: newDocumentId(),
    inception_id: input.inception_id,
    filename: input.filename,
    mime_type: input.mime_type,
    byte_size: input.byte_size,
    content_hash: input.content_hash,
    storage_path: input.storage_path,
    ingested_at: nowIso(),
    last_extracted_at: null,
    extraction_status: 'pending',
    extraction_error: null,
  };
  db.prepare(
    `INSERT INTO lean_inception_documents
     (id, inception_id, filename, mime_type, byte_size, content_hash, storage_path,
      ingested_at, last_extracted_at, extraction_status, extraction_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id, row.inception_id, row.filename, row.mime_type, row.byte_size,
    row.content_hash, row.storage_path, row.ingested_at, row.last_extracted_at,
    row.extraction_status, row.extraction_error,
  );
  return row;
}

export function findDocumentByHash(db: SqliteDb, inceptionId: string, contentHash: string): DocumentRow | null {
  const row = db.prepare(
    'SELECT * FROM lean_inception_documents WHERE inception_id = ? AND content_hash = ?'
  ).get(inceptionId, contentHash) as DocumentRow | undefined;
  return row ?? null;
}

export function findDocumentByFilename(db: SqliteDb, inceptionId: string, filename: string): DocumentRow | null {
  const row = db.prepare(
    'SELECT * FROM lean_inception_documents WHERE inception_id = ? AND filename = ? ORDER BY ingested_at DESC LIMIT 1'
  ).get(inceptionId, filename) as DocumentRow | undefined;
  return row ?? null;
}

export function listDocuments(db: SqliteDb, inceptionId: string): DocumentRow[] {
  return db.prepare(
    'SELECT * FROM lean_inception_documents WHERE inception_id = ? ORDER BY ingested_at ASC'
  ).all(inceptionId) as DocumentRow[];
}

export function deleteDocument(db: SqliteDb, documentId: string): boolean {
  const info = db.prepare('DELETE FROM lean_inception_documents WHERE id = ?').run(documentId);
  return info.changes > 0;
}

export function deleteInception(db: SqliteDb, inceptionId: string): boolean {
  const info = db.prepare('DELETE FROM lean_inceptions WHERE id = ?').run(inceptionId);
  return info.changes > 0;
}

export function updateDocumentExtractionStatus(
  db: SqliteDb,
  documentId: string,
  status: DocumentRow['extraction_status'],
  errorMessage: string | null = null,
): void {
  db.prepare(
    `UPDATE lean_inception_documents
     SET extraction_status = ?, extraction_error = ?, last_extracted_at = ?
     WHERE id = ?`
  ).run(status, errorMessage, nowIso(), documentId);
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test persistence
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/lean-inception/persistence.ts apps/daemon/tests/lean-inception/persistence.test.ts
git commit -m "feat(daemon): add lean-inception inception/document CRUD"
```

---

## Task 11: Persistence — cards + extraction CRUD + state read

**Files:**
- Modify: `apps/daemon/src/lean-inception/persistence.ts`
- Modify: `apps/daemon/tests/lean-inception/persistence.test.ts`

- [ ] **Step 1: Write failing tests**

Append to test file:

```ts
import {
  insertExtraction, finalizeExtraction, insertCardsAtomic,
  listCardsByInception, listCardsByDocument, readInceptionState,
} from '../../src/lean-inception/persistence.js';

describe('extraction + cards + state', () => {
  it('inserts an extraction with running status, then finalizes it', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const doc = insertDocument(db, {
      inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown',
      byte_size: 1, content_hash: 'h1', storage_path: 'x',
    });
    const ext = insertExtraction(db, {
      inception_id: inception.id,
      document_id: doc.id,
      runtime: 'claude',
      model: 'claude-opus-4-7',
      prompt_version: 1,
    });
    expect(ext.status).toBe('running');

    finalizeExtraction(db, ext.id, {
      status: 'succeeded',
      cards_persisted: 3,
      cards_dropped: 1,
      warnings_count: 1,
      duration_ms: 1234,
      prompt_tokens: 100,
      output_tokens: 50,
    });

    const reread = db.prepare('SELECT * FROM lean_inception_extractions WHERE id = ?').get(ext.id) as any;
    expect(reread.status).toBe('succeeded');
    expect(reread.cards_persisted).toBe(3);
  });

  it('insertCardsAtomic persists all cards in a single transaction', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const doc = insertDocument(db, { inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown', byte_size: 1, content_hash: 'h1', storage_path: 'x' });
    const ext = insertExtraction(db, { inception_id: inception.id, document_id: doc.id, runtime: 'claude', model: null, prompt_version: 1 });

    insertCardsAtomic(db, [
      { inception_id: inception.id, document_id: doc.id, column_key: 'vision', title: 'Vision A', content: 'desc', confidence: 'high', source_anchor: 'a', source_line: 1, extraction_id: ext.id },
      { inception_id: inception.id, document_id: doc.id, column_key: 'personas', title: 'Persona A', content: 'desc', confidence: 'medium', source_anchor: 'b', source_line: 2, extraction_id: ext.id },
    ]);

    expect(listCardsByDocument(db, doc.id)).toHaveLength(2);
    expect(listCardsByInception(db, inception.id)).toHaveLength(2);
  });

  it('readInceptionState returns documents + columns with derived statuses', () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const doc = insertDocument(db, { inception_id: inception.id, filename: 'a.md', mime_type: 'text/markdown', byte_size: 1, content_hash: 'h1', storage_path: 'x' });
    const ext = insertExtraction(db, { inception_id: inception.id, document_id: doc.id, runtime: 'claude', model: null, prompt_version: 1 });
    insertCardsAtomic(db, [
      { inception_id: inception.id, document_id: doc.id, column_key: 'personas', title: 'P1', content: 'c', confidence: 'high', source_anchor: 'a1', source_line: 1, extraction_id: ext.id },
      { inception_id: inception.id, document_id: doc.id, column_key: 'personas', title: 'P2', content: 'c', confidence: 'high', source_anchor: 'a2', source_line: 2, extraction_id: ext.id },
      { inception_id: inception.id, document_id: doc.id, column_key: 'personas', title: 'P3', content: 'c', confidence: 'high', source_anchor: 'a3', source_line: 3, extraction_id: ext.id },
    ]);

    const state = readInceptionState(db, inception.id);
    expect(state.documents).toHaveLength(1);
    expect(state.documents[0].card_count).toBe(3);
    expect(state.columns.personas.status).toBe('complete');
    expect(state.columns.personas.cards).toHaveLength(3);
    expect(state.columns.vision.status).toBe('not_identified');
    expect(state.columns.vision.cards).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test persistence
```

Expected: FAIL — new exports not found.

- [ ] **Step 3: Implement**

Append to `apps/daemon/src/lean-inception/persistence.ts`:

```ts
import { deriveColumnStatus } from './derive-column-status.js';
import {
  LEAN_INCEPTION_COLUMN_KEYS,
  type LeanInceptionColumnKey,
} from './column-keys.js';
import type {
  LeanInceptionCard,
  LeanInceptionDocument,
  LeanInceptionState,
} from '@open-design/contracts';

export interface CardRow {
  id: string;
  inception_id: string;
  document_id: string;
  column_key: LeanInceptionColumnKey;
  title: string;
  content: string;
  confidence: 'low' | 'medium' | 'high';
  source_anchor: string;
  source_line: number | null;
  extraction_id: string;
  created_at: string;
}

export interface ExtractionRow {
  id: string;
  inception_id: string;
  document_id: string;
  runtime: string;
  model: string | null;
  prompt_version: number;
  prompt_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  warnings_count: number;
  cards_persisted: number;
  cards_dropped: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'succeeded' | 'failed';
  error_message: string | null;
}

function newCardId() { return `card_${randomUUID().replace(/-/g, '')}`; }
function newExtractionId() { return `ext_${randomUUID().replace(/-/g, '')}`; }

export interface InsertExtractionInput {
  inception_id: string;
  document_id: string;
  runtime: string;
  model: string | null;
  prompt_version: number;
}

export function insertExtraction(db: SqliteDb, input: InsertExtractionInput): ExtractionRow {
  const row: ExtractionRow = {
    id: newExtractionId(),
    inception_id: input.inception_id,
    document_id: input.document_id,
    runtime: input.runtime,
    model: input.model,
    prompt_version: input.prompt_version,
    prompt_tokens: null,
    output_tokens: null,
    duration_ms: null,
    warnings_count: 0,
    cards_persisted: 0,
    cards_dropped: 0,
    started_at: nowIso(),
    finished_at: null,
    status: 'running',
    error_message: null,
  };
  db.prepare(
    `INSERT INTO lean_inception_extractions
     (id, inception_id, document_id, runtime, model, prompt_version,
      prompt_tokens, output_tokens, duration_ms, warnings_count,
      cards_persisted, cards_dropped, started_at, finished_at, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id, row.inception_id, row.document_id, row.runtime, row.model, row.prompt_version,
    row.prompt_tokens, row.output_tokens, row.duration_ms, row.warnings_count,
    row.cards_persisted, row.cards_dropped, row.started_at, row.finished_at, row.status, row.error_message,
  );
  return row;
}

export interface FinalizeExtractionInput {
  status: 'succeeded' | 'failed';
  cards_persisted?: number;
  cards_dropped?: number;
  warnings_count?: number;
  duration_ms?: number;
  prompt_tokens?: number | null;
  output_tokens?: number | null;
  error_message?: string | null;
}

export function finalizeExtraction(db: SqliteDb, extractionId: string, input: FinalizeExtractionInput): void {
  db.prepare(
    `UPDATE lean_inception_extractions
     SET status = ?, cards_persisted = COALESCE(?, cards_persisted),
         cards_dropped = COALESCE(?, cards_dropped),
         warnings_count = COALESCE(?, warnings_count),
         duration_ms = COALESCE(?, duration_ms),
         prompt_tokens = COALESCE(?, prompt_tokens),
         output_tokens = COALESCE(?, output_tokens),
         error_message = COALESCE(?, error_message),
         finished_at = ?
     WHERE id = ?`
  ).run(
    input.status,
    input.cards_persisted ?? null,
    input.cards_dropped ?? null,
    input.warnings_count ?? null,
    input.duration_ms ?? null,
    input.prompt_tokens ?? null,
    input.output_tokens ?? null,
    input.error_message ?? null,
    nowIso(),
    extractionId,
  );
}

export interface InsertCardInput {
  inception_id: string;
  document_id: string;
  column_key: LeanInceptionColumnKey;
  title: string;
  content: string;
  confidence: 'low' | 'medium' | 'high';
  source_anchor: string;
  source_line: number | null;
  extraction_id: string;
}

export function insertCardsAtomic(db: SqliteDb, cards: readonly InsertCardInput[]): void {
  const stmt = db.prepare(
    `INSERT INTO lean_inception_cards
     (id, inception_id, document_id, column_key, title, content, confidence,
      source_anchor, source_line, extraction_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((rows: readonly InsertCardInput[]) => {
    const ts = nowIso();
    for (const c of rows) {
      stmt.run(
        newCardId(), c.inception_id, c.document_id, c.column_key, c.title, c.content,
        c.confidence, c.source_anchor, c.source_line, c.extraction_id, ts,
      );
    }
  });
  tx(cards);
}

export function listCardsByDocument(db: SqliteDb, documentId: string): CardRow[] {
  return db.prepare(
    'SELECT * FROM lean_inception_cards WHERE document_id = ? ORDER BY created_at ASC'
  ).all(documentId) as CardRow[];
}

export function listCardsByInception(db: SqliteDb, inceptionId: string): CardRow[] {
  return db.prepare(
    'SELECT * FROM lean_inception_cards WHERE inception_id = ? ORDER BY created_at ASC'
  ).all(inceptionId) as CardRow[];
}

function cardRowToDto(row: CardRow): LeanInceptionCard {
  return {
    id: row.id,
    inception_id: row.inception_id,
    document_id: row.document_id,
    column_key: row.column_key,
    title: row.title,
    content: row.content,
    confidence: row.confidence,
    source_anchor: row.source_anchor,
    source_line: row.source_line,
    extraction_id: row.extraction_id,
    created_at: row.created_at,
  };
}

function docRowToDto(row: DocumentRow, cardCount: number): LeanInceptionDocument {
  return {
    id: row.id,
    inception_id: row.inception_id,
    filename: row.filename,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    content_hash: row.content_hash,
    ingested_at: row.ingested_at,
    last_extracted_at: row.last_extracted_at,
    extraction_status: row.extraction_status,
    extraction_error: row.extraction_error,
    card_count: cardCount,
  };
}

export function readInceptionState(db: SqliteDb, inceptionId: string): LeanInceptionState {
  const inception = db.prepare(
    'SELECT * FROM lean_inceptions WHERE id = ?'
  ).get(inceptionId) as InceptionRow | undefined;
  if (!inception) {
    throw new Error(`inception not found: ${inceptionId}`);
  }

  const docs = listDocuments(db, inceptionId);
  const cardCounts = db.prepare(
    'SELECT document_id, COUNT(*) AS c FROM lean_inception_cards WHERE inception_id = ? GROUP BY document_id'
  ).all(inceptionId) as Array<{ document_id: string; c: number }>;
  const countByDoc = new Map(cardCounts.map(r => [r.document_id, r.c]));

  const cards = listCardsByInception(db, inceptionId);
  const cardsByColumn = new Map<LeanInceptionColumnKey, CardRow[]>();
  for (const key of LEAN_INCEPTION_COLUMN_KEYS) cardsByColumn.set(key, []);
  for (const c of cards) cardsByColumn.get(c.column_key)?.push(c);

  const columns = {} as LeanInceptionState['columns'];
  for (const key of LEAN_INCEPTION_COLUMN_KEYS) {
    const colCards = cardsByColumn.get(key) ?? [];
    columns[key] = {
      status: deriveColumnStatus(colCards),
      cards: colCards.map(cardRowToDto),
    };
  }

  return {
    inception_id: inception.id,
    project_id: inception.project_id,
    documents: docs.map(d => docRowToDto(d, countByDoc.get(d.id) ?? 0)),
    columns,
  };
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test persistence
pnpm --filter @open-design/daemon typecheck
```

Expected: PASS, 12 tests total. Typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/lean-inception/persistence.ts apps/daemon/tests/lean-inception/persistence.test.ts
git commit -m "feat(daemon): add lean-inception cards/extraction CRUD and state reader"
```

---

## Task 12: Runtime invocation wrapper (mockable)

**Files:**
- Create: `apps/daemon/src/lean-inception/runtime-invoke.ts`

This task creates the interface; tests for the actual runtime call are deferred to the golden tests (LLM-live). For unit tests of `extraction-service`, the interface is stubbed.

- [ ] **Step 1: Create the file**

```ts
// apps/daemon/src/lean-inception/runtime-invoke.ts
import { execAgentFile } from '../runtimes/invocation.js';
import { resolveRuntimeExecutable } from '../runtimes/resolution.js';

export interface LeanInceptionRuntimeRequest {
  runtime: string;            // 'claude' | 'codex' | ...
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
}

export interface LeanInceptionRuntimeResponse {
  rawStdout: string;
  durationMs: number;
  model: string | null;
  promptTokens: number | null;
  outputTokens: number | null;
}

export type LeanInceptionRuntimeInvoker =
  (req: LeanInceptionRuntimeRequest) => Promise<LeanInceptionRuntimeResponse>;

export const invokeAgentForExtraction: LeanInceptionRuntimeInvoker = async (req) => {
  const executable = await resolveRuntimeExecutable(req.runtime);
  if (!executable) {
    const err: any = new Error(`runtime not available: ${req.runtime}`);
    err.code = 'RUNTIME_UNAVAILABLE';
    throw err;
  }

  const args = [
    '--output-format', 'json',
    '--system-prompt', req.systemPrompt,
    '--prompt', req.userPrompt,
  ];

  const start = Date.now();
  try {
    const { stdout } = await execAgentFile(executable.command, args, {
      timeout: req.timeoutMs,
    });
    return {
      rawStdout: stdout,
      durationMs: Date.now() - start,
      model: executable.modelHint ?? null,
      promptTokens: null,
      outputTokens: null,
    };
  } catch (err: any) {
    if (err && err.killed) {
      const t: any = new Error('extraction timed out');
      t.code = 'EXTRACTION_TIMEOUT';
      throw t;
    }
    const f: any = new Error(err?.stderr || err?.message || 'extraction failed');
    f.code = 'EXTRACTION_FAILED';
    throw f;
  }
};
```

> **Note:** `resolveRuntimeExecutable` and the exact arg shape may need adaptation to the actual runtime-detection module signatures present in the codebase. Inspect `apps/daemon/src/runtimes/resolution.ts` and `apps/daemon/src/runtimes/defs/claude.ts` for the real API; adapt arg-building accordingly. The interface (`LeanInceptionRuntimeInvoker`) is what consumers depend on.

- [ ] **Step 2: Commit**

```bash
git add apps/daemon/src/lean-inception/runtime-invoke.ts
git commit -m "feat(daemon): add lean-inception runtime invocation wrapper"
```

---

## Task 13: Extraction service (orchestrator)

**Files:**
- Create: `apps/daemon/src/lean-inception/extraction-service.ts`
- Test: `apps/daemon/tests/lean-inception/extraction-service.test.ts`

- [ ] **Step 1: Write failing test (full orchestration with stubbed invoker)**

```ts
// apps/daemon/tests/lean-inception/extraction-service.test.ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  migrateLeanInception,
  upsertInceptionForProject,
  readInceptionState,
  listCardsByDocument,
} from '../../src/lean-inception/persistence.js';
import { extractDocumentForInception } from '../../src/lean-inception/extraction-service.js';
import type { LeanInceptionRuntimeInvoker } from '../../src/lean-inception/runtime-invoke.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateLeanInception(db);
  return db;
}

function tmpStorageRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-test-'));
  return dir;
}

const fakeInvoker = (jsonResponse: object): LeanInceptionRuntimeInvoker =>
  async () => ({
    rawStdout: JSON.stringify(jsonResponse),
    durationMs: 100,
    model: 'claude-opus-4-7',
    promptTokens: 500,
    outputTokens: 200,
  });

describe('extractDocumentForInception', () => {
  it('happy path: persists cards with valid anchors, drops invalid ones', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const docContent = '# Project Vision\n\nWe build the best product for analysts.\n\n## Personas\n\n- Senior Analyst Alice';

    const invoker = fakeInvoker({
      cards: [
        {
          column_key: 'vision',
          title: 'Build best product',
          content: 'Macro vision',
          confidence: 'high',
          source_anchor: 'We build the best product for analysts.',
          source_line: 3,
        },
        {
          column_key: 'personas',
          title: 'Senior Analyst Alice',
          content: 'Primary persona',
          confidence: 'medium',
          source_anchor: 'Senior Analyst Alice',
          source_line: 7,
        },
        {
          // INVALID: anchor is paraphrase
          column_key: 'features',
          title: 'Awesome feature',
          content: 'desc',
          confidence: 'high',
          source_anchor: 'Some feature we do not actually mention.',
          source_line: 99,
        },
      ],
    });

    const result = await extractDocumentForInception({
      db,
      inception,
      storageRoot,
      runtime: 'claude',
      invoke: invoker,
      document: {
        filename: 'vision.md',
        mimeType: 'text/markdown',
        content: Buffer.from(docContent),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const cards = listCardsByDocument(db, result.documentId);
    expect(cards).toHaveLength(2);
    expect(cards.map(c => c.column_key).sort()).toEqual(['personas', 'vision']);

    const extRow = db.prepare('SELECT * FROM lean_inception_extractions WHERE document_id = ?').get(result.documentId) as any;
    expect(extRow.status).toBe('succeeded');
    expect(extRow.cards_persisted).toBe(2);
    expect(extRow.cards_dropped).toBe(1);
    expect(extRow.warnings_count).toBe(1);
  });

  it('returns existing document id idempotently when re-ingesting same content', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const docContent = 'L1 content';
    const invoker = fakeInvoker({ cards: [] });

    const a = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'a.md', mimeType: 'text/markdown', content: Buffer.from(docContent) },
    });
    const b = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'a.md', mimeType: 'text/markdown', content: Buffer.from(docContent) },
    });

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.documentId).toBe(b.documentId);

    const docs = db.prepare('SELECT count(*) AS c FROM lean_inception_documents').get() as { c: number };
    expect(docs.c).toBe(1);
  });

  it('rejects documents larger than 500KB', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const big = Buffer.alloc(500 * 1024 + 1, 'x');

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: fakeInvoker({ cards: [] }),
      document: { filename: 'big.md', mimeType: 'text/markdown', content: big },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DOCUMENT_TOO_LARGE');
  });

  it('rejects empty documents', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: fakeInvoker({ cards: [] }),
      document: { filename: 'e.md', mimeType: 'text/markdown', content: Buffer.from('   \n  ') },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY_DOCUMENT');
  });

  it('marks extraction failed when LLM returns invalid JSON', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const invoker: LeanInceptionRuntimeInvoker = async () => ({
      rawStdout: 'I cannot do that.',
      durationMs: 50, model: null, promptTokens: null, outputTokens: null,
    });

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'a.md', mimeType: 'text/markdown', content: Buffer.from('hello') },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_JSON_OUTPUT');
  });

  it('replaces existing doc with same filename but different content', async () => {
    const db = freshDb();
    const inception = upsertInceptionForProject(db, 'prj_1');
    const storageRoot = tmpStorageRoot();
    const invoker = fakeInvoker({ cards: [] });

    const a = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'doc.md', mimeType: 'text/markdown', content: Buffer.from('v1') },
    });
    const b = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude', invoke: invoker,
      document: { filename: 'doc.md', mimeType: 'text/markdown', content: Buffer.from('v2') },
    });

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.documentId).not.toBe(b.documentId);

    const docs = db.prepare('SELECT count(*) AS c FROM lean_inception_documents').get() as { c: number };
    expect(docs.c).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test extraction-service
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/daemon/src/lean-inception/extraction-service.ts
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  LEAN_INCEPTION_COLUMN_KEYS,
  type LeanInceptionColumnKey,
} from './column-keys.js';
import { computeContentHash } from './content-hash.js';
import { isAnchorValid } from './validate-anchor.js';
import { parseLlmJsonOutput } from './parse-llm-output.js';
import {
  LEAN_INCEPTION_SYSTEM_PROMPT_V1,
  LEAN_INCEPTION_PROMPT_VERSION,
  buildUserPromptV1,
} from './prompts/v1.js';
import {
  findDocumentByHash,
  findDocumentByFilename,
  insertDocument,
  deleteDocument,
  insertExtraction,
  finalizeExtraction,
  insertCardsAtomic,
  updateDocumentExtractionStatus,
  type InceptionRow,
} from './persistence.js';
import type { LeanInceptionRuntimeInvoker } from './runtime-invoke.js';
import type {
  LeanInceptionErrorCode,
  LeanInceptionError,
} from '@open-design/contracts';
import type Database from 'better-sqlite3';

type SqliteDb = Database.Database;

const MAX_BYTES = 500 * 1024;
const EXTRACTION_TIMEOUT_MS = 120_000;

const RawCardSchema = z.object({
  column_key: z.enum(LEAN_INCEPTION_COLUMN_KEYS),
  title: z.string().min(5).max(120),
  content: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  source_anchor: z.string().min(1).max(280),
  source_line: z.number().int().positive().nullable(),
});

const RawOutputSchema = z.object({
  cards: z.array(RawCardSchema),
});

export interface ExtractDocumentInput {
  filename: string;
  mimeType: 'text/markdown' | 'text/plain';
  content: Buffer;
}

export interface ExtractDocumentForInceptionParams {
  db: SqliteDb;
  inception: InceptionRow;
  storageRoot: string;            // absolute path, e.g. <PROJECT_ROOT>/.od
  runtime: string;
  invoke: LeanInceptionRuntimeInvoker;
  document: ExtractDocumentInput;
}

export type ExtractionResult =
  | { ok: true; documentId: string; cardsPersisted: number; cardsDropped: number; extractionInfo: ExtractionInfoSnapshot }
  | { ok: false; error: LeanInceptionError; documentId?: string };

export interface ExtractionInfoSnapshot {
  runtime: string;
  model: string | null;
  prompt_version: number;
  duration_ms: number;
  prompt_tokens: number | null;
  output_tokens: number | null;
}

function errorResult(code: LeanInceptionErrorCode, message: string, details?: Record<string, unknown>): ExtractionResult {
  return { ok: false, error: { code, message, details } };
}

export async function extractDocumentForInception(
  params: ExtractDocumentForInceptionParams,
): Promise<ExtractionResult> {
  const { db, inception, storageRoot, runtime, invoke, document } = params;

  if (document.content.byteLength === 0 || document.content.toString('utf8').trim().length === 0) {
    return errorResult('EMPTY_DOCUMENT', 'document content is empty', { filename: document.filename });
  }
  if (document.content.byteLength > MAX_BYTES) {
    return errorResult('DOCUMENT_TOO_LARGE', `document exceeds ${MAX_BYTES} bytes`, {
      filename: document.filename, byte_size: document.content.byteLength,
    });
  }
  let contentText: string;
  try {
    contentText = document.content.toString('utf8');
    if (contentText.includes(' ')) throw new Error('null byte detected');
  } catch {
    return errorResult('UNSUPPORTED_FORMAT', 'document is not valid UTF-8', { filename: document.filename });
  }

  const contentHash = computeContentHash(document.content);

  const sameHash = findDocumentByHash(db, inception.id, contentHash);
  if (sameHash) {
    const cardsPersisted = db.prepare(
      'SELECT COUNT(*) AS c FROM lean_inception_cards WHERE document_id = ?'
    ).get(sameHash.id) as { c: number };
    return {
      ok: true, documentId: sameHash.id,
      cardsPersisted: cardsPersisted.c, cardsDropped: 0,
      extractionInfo: {
        runtime, model: null, prompt_version: LEAN_INCEPTION_PROMPT_VERSION,
        duration_ms: 0, prompt_tokens: null, output_tokens: null,
      },
    };
  }

  const sameName = findDocumentByFilename(db, inception.id, document.filename);
  if (sameName) {
    deleteDocument(db, sameName.id);
  }

  const projectStorageDir = path.join(storageRoot, 'projects', inception.project_id, 'lean-inception', 'docs');
  fs.mkdirSync(projectStorageDir, { recursive: true });
  const ext = document.mimeType === 'text/markdown' ? '.md' : '.txt';
  const docRow = insertDocument(db, {
    inception_id: inception.id,
    filename: document.filename,
    mime_type: document.mimeType,
    byte_size: document.content.byteLength,
    content_hash: contentHash,
    storage_path: path.relative(storageRoot, path.join(projectStorageDir, `${'placeholder'}${ext}`)),
  });
  const finalStorageAbs = path.join(projectStorageDir, `${docRow.id}${ext}`);
  fs.writeFileSync(finalStorageAbs, document.content);
  db.prepare('UPDATE lean_inception_documents SET storage_path = ? WHERE id = ?')
    .run(path.relative(storageRoot, finalStorageAbs), docRow.id);

  updateDocumentExtractionStatus(db, docRow.id, 'extracting');

  const extraction = insertExtraction(db, {
    inception_id: inception.id,
    document_id: docRow.id,
    runtime,
    model: null,
    prompt_version: LEAN_INCEPTION_PROMPT_VERSION,
  });

  let invokeResult;
  try {
    invokeResult = await invoke({
      runtime,
      systemPrompt: LEAN_INCEPTION_SYSTEM_PROMPT_V1,
      userPrompt: buildUserPromptV1({
        filename: document.filename,
        mimeType: document.mimeType,
        content: contentText,
      }),
      timeoutMs: EXTRACTION_TIMEOUT_MS,
    });
  } catch (err: any) {
    const code: LeanInceptionErrorCode =
      err?.code === 'RUNTIME_UNAVAILABLE' ? 'RUNTIME_UNAVAILABLE'
      : err?.code === 'EXTRACTION_TIMEOUT' ? 'EXTRACTION_TIMEOUT'
      : 'EXTRACTION_FAILED';
    finalizeExtraction(db, extraction.id, { status: 'failed', error_message: err?.message ?? String(err) });
    updateDocumentExtractionStatus(db, docRow.id, 'failed', err?.message ?? String(err));
    return { ok: false, error: { code, message: err?.message ?? String(err) }, documentId: docRow.id };
  }

  const parsed = parseLlmJsonOutput(invokeResult.rawStdout);
  if (!parsed.ok) {
    finalizeExtraction(db, extraction.id, { status: 'failed', error_message: parsed.reason });
    updateDocumentExtractionStatus(db, docRow.id, 'failed', `parse: ${parsed.reason}`);
    return { ok: false, error: { code: 'INVALID_JSON_OUTPUT', message: parsed.reason }, documentId: docRow.id };
  }

  const validation = RawOutputSchema.safeParse(parsed.value);
  if (!validation.success) {
    finalizeExtraction(db, extraction.id, { status: 'failed', error_message: validation.error.message });
    updateDocumentExtractionStatus(db, docRow.id, 'failed', `schema: ${validation.error.message}`);
    return { ok: false, error: { code: 'SCHEMA_VALIDATION_FAILED', message: validation.error.message }, documentId: docRow.id };
  }

  const rawCards = validation.data.cards;
  const acceptedCards = [];
  let dropped = 0;
  for (const c of rawCards) {
    if (!isAnchorValid(c.source_anchor, contentText)) {
      dropped += 1;
      continue;
    }
    acceptedCards.push({
      inception_id: inception.id,
      document_id: docRow.id,
      column_key: c.column_key as LeanInceptionColumnKey,
      title: c.title,
      content: c.content,
      confidence: c.confidence,
      source_anchor: c.source_anchor.slice(0, 280),
      source_line: c.source_line,
      extraction_id: extraction.id,
    });
  }

  insertCardsAtomic(db, acceptedCards);
  finalizeExtraction(db, extraction.id, {
    status: 'succeeded',
    cards_persisted: acceptedCards.length,
    cards_dropped: dropped,
    warnings_count: dropped,
    duration_ms: invokeResult.durationMs,
    prompt_tokens: invokeResult.promptTokens,
    output_tokens: invokeResult.outputTokens,
  });
  updateDocumentExtractionStatus(db, docRow.id, 'extracted', null);

  return {
    ok: true,
    documentId: docRow.id,
    cardsPersisted: acceptedCards.length,
    cardsDropped: dropped,
    extractionInfo: {
      runtime,
      model: invokeResult.model,
      prompt_version: LEAN_INCEPTION_PROMPT_VERSION,
      duration_ms: invokeResult.durationMs,
      prompt_tokens: invokeResult.promptTokens,
      output_tokens: invokeResult.outputTokens,
    },
  };
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test extraction-service
pnpm --filter @open-design/daemon typecheck
```

Expected: PASS, 6 tests. Typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/lean-inception/extraction-service.ts apps/daemon/tests/lean-inception/extraction-service.test.ts
git commit -m "feat(daemon): add lean-inception extraction orchestrator"
```

---

## Task 14: HTTP routes — register module + POST extract

**Files:**
- Create: `apps/daemon/src/lean-inception-routes.ts`
- Test: `apps/daemon/tests/lean-inception/routes.test.ts`

This task wires the Express routes with an injectable invoker for tests. The exact `RouteDeps` shape may need adaptation — inspect `apps/daemon/src/media-routes.ts` and `apps/daemon/src/server-context.ts` for the real types. The pattern below uses a self-contained dependency object to keep tests simple.

- [ ] **Step 1: Write failing integration test**

```ts
// apps/daemon/tests/lean-inception/routes.test.ts
import { describe, expect, it } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  migrateLeanInception,
  upsertInceptionForProject,
} from '../../src/lean-inception/persistence.js';
import { registerLeanInceptionRoutes } from '../../src/lean-inception-routes.js';
import type { LeanInceptionRuntimeInvoker } from '../../src/lean-inception/runtime-invoke.js';

function startServer(deps: Parameters<typeof registerLeanInceptionRoutes>[1]) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerLeanInceptionRoutes(app, deps);
  return new Promise<{ url: string; close: () => void }>(resolve => {
    const srv = app.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => srv.close() });
    });
  });
}

const fakeInvoker = (jsonResponse: object): LeanInceptionRuntimeInvoker =>
  async () => ({
    rawStdout: JSON.stringify(jsonResponse),
    durationMs: 50,
    model: 'claude-opus-4-7',
    promptTokens: 100,
    outputTokens: 50,
  });

describe('POST /api/projects/:id/lean-inception/documents', () => {
  it('extracts cards and returns state', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);

    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-'));
    const invoker = fakeInvoker({
      cards: [{
        column_key: 'vision',
        title: 'Big vision',
        content: 'desc',
        confidence: 'high',
        source_anchor: 'We build the best product.',
        source_line: 1,
      }],
    });

    const server = await startServer({
      db, storageRoot,
      runtimeInvoker: invoker,
      defaultRuntime: 'claude',
    });

    try {
      const docText = 'We build the best product.';
      const r = await fetch(`${server.url}/api/projects/prj_1/lean-inception/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documents: [{
            filename: 'a.md',
            mime_type: 'text/markdown',
            content_base64: Buffer.from(docText).toString('base64'),
          }],
        }),
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.state.columns.vision.cards).toHaveLength(1);
      expect(body.state.columns.vision.status).toBe('insufficient');
      expect(body.extractions).toHaveLength(1);
    } finally {
      server.close();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('returns 400 with code UNSUPPORTED_FORMAT for non-md/txt', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    const server = await startServer({
      db, storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-')),
      runtimeInvoker: fakeInvoker({ cards: [] }), defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_1/lean-inception/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documents: [{ filename: 'a.pdf', mime_type: 'application/pdf', content_base64: 'aGVsbG8=' }],
        }),
      });
      expect(r.status).toBe(400);
      const body = await r.json();
      expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    } finally {
      server.close();
    }
  });
});

describe('GET /api/projects/:id/lean-inception', () => {
  it('returns empty state when inception does not exist yet (auto-create on POST only)', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    const server = await startServer({
      db, storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-')),
      runtimeInvoker: fakeInvoker({ cards: [] }), defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_new/lean-inception`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.state.documents).toEqual([]);
      expect(body.state.columns.vision.status).toBe('not_identified');
    } finally {
      server.close();
    }
  });
});

describe('DELETE /api/projects/:id/lean-inception/documents/:docId', () => {
  it('removes the document and its cards', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    const inception = upsertInceptionForProject(db, 'prj_1');
    const server = await startServer({
      db, storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-')),
      runtimeInvoker: fakeInvoker({
        cards: [{
          column_key: 'vision', title: 'V', content: 'c', confidence: 'high',
          source_anchor: 'hi', source_line: 1,
        }],
      }),
      defaultRuntime: 'claude',
    });

    try {
      const postRes = await fetch(`${server.url}/api/projects/prj_1/lean-inception/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documents: [{ filename: 'a.md', mime_type: 'text/markdown', content_base64: Buffer.from('hi').toString('base64') }],
        }),
      });
      const postBody = await postRes.json();
      const docId = postBody.state.documents[0].id;

      const delRes = await fetch(`${server.url}/api/projects/prj_1/lean-inception/documents/${docId}`, { method: 'DELETE' });
      expect(delRes.status).toBe(200);
      const after = await delRes.json();
      expect(after.state.documents).toHaveLength(0);
      expect(after.state.columns.vision.cards).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it('returns 404 when doc does not exist', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    upsertInceptionForProject(db, 'prj_1');
    const server = await startServer({
      db, storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-')),
      runtimeInvoker: fakeInvoker({ cards: [] }), defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_1/lean-inception/documents/doc_missing`, { method: 'DELETE' });
      expect(r.status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('DELETE /api/projects/:id/lean-inception (reset)', () => {
  it('removes the entire inception', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    upsertInceptionForProject(db, 'prj_1');
    const server = await startServer({
      db, storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'li-routes-')),
      runtimeInvoker: fakeInvoker({ cards: [] }), defaultRuntime: 'claude',
    });
    try {
      const r = await fetch(`${server.url}/api/projects/prj_1/lean-inception`, { method: 'DELETE' });
      expect(r.status).toBe(200);
      const rows = db.prepare('SELECT count(*) AS c FROM lean_inceptions').get() as { c: number };
      expect(rows.c).toBe(0);
    } finally {
      server.close();
    }
  });
});
```

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @open-design/daemon test routes
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement routes module**

```ts
// apps/daemon/src/lean-inception-routes.ts
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import {
  ExtractDocumentsRequestSchema,
  type LeanInceptionError,
} from '@open-design/contracts';
import {
  upsertInceptionForProject,
  readInceptionState,
  deleteDocument,
  deleteInception,
} from './lean-inception/persistence.js';
import {
  extractDocumentForInception,
  type ExtractionInfoSnapshot,
} from './lean-inception/extraction-service.js';
import type { LeanInceptionRuntimeInvoker } from './lean-inception/runtime-invoke.js';
import { invokeAgentForExtraction } from './lean-inception/runtime-invoke.js';

export interface LeanInceptionRoutesDeps {
  db: Database.Database;
  storageRoot: string;
  runtimeInvoker?: LeanInceptionRuntimeInvoker;
  defaultRuntime?: string;
}

function sendError(res: any, status: number, error: LeanInceptionError) {
  res.status(status).json({ error });
}

export function registerLeanInceptionRoutes(app: Express, deps: LeanInceptionRoutesDeps) {
  const invoker = deps.runtimeInvoker ?? invokeAgentForExtraction;
  const defaultRuntime = deps.defaultRuntime ?? 'claude';

  app.get('/api/projects/:projectId/lean-inception', (req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId);
    res.json({ state: readInceptionState(deps.db, inception.id) });
  });

  app.get('/api/projects/:projectId/lean-inception/documents', (req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId);
    const state = readInceptionState(deps.db, inception.id);
    res.json({ documents: state.documents });
  });

  app.post('/api/projects/:projectId/lean-inception/documents', async (req, res) => {
    const parse = ExtractDocumentsRequestSchema.safeParse(req.body);
    if (!parse.success) {
      return sendError(res, 400, {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: parse.error.message,
      });
    }
    const inception = upsertInceptionForProject(deps.db, req.params.projectId);
    const runtime = parse.data.runtime ?? defaultRuntime;
    const extractions: ExtractionInfoSnapshot[] = [];
    for (const docInput of parse.data.documents) {
      const buf = Buffer.from(docInput.content_base64, 'base64');
      const result = await extractDocumentForInception({
        db: deps.db,
        inception,
        storageRoot: deps.storageRoot,
        runtime,
        invoke: invoker,
        document: {
          filename: docInput.filename,
          mimeType: docInput.mime_type,
          content: buf,
        },
      });
      if (!result.ok) {
        const status =
          result.error.code === 'DOCUMENT_TOO_LARGE' ? 413
          : result.error.code === 'RUNTIME_UNAVAILABLE' ? 503
          : result.error.code === 'EXTRACTION_TIMEOUT' ? 504
          : 400;
        return sendError(res, status, result.error);
      }
      extractions.push(result.extractionInfo);
    }
    res.json({
      state: readInceptionState(deps.db, inception.id),
      extractions,
    });
  });

  app.delete('/api/projects/:projectId/lean-inception/documents/:docId', (req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId);
    const removed = deleteDocument(deps.db, req.params.docId);
    if (!removed) {
      return sendError(res, 404, {
        code: 'DOCUMENT_NOT_FOUND',
        message: `document not found: ${req.params.docId}`,
      });
    }
    res.json({ state: readInceptionState(deps.db, inception.id) });
  });

  app.delete('/api/projects/:projectId/lean-inception', (req, res) => {
    const inception = upsertInceptionForProject(deps.db, req.params.projectId);
    deleteInception(deps.db, inception.id);
    res.json({ ok: true });
  });
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
pnpm --filter @open-design/daemon test routes
pnpm --filter @open-design/daemon typecheck
```

Expected: PASS, 6 tests. Typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/lean-inception-routes.ts apps/daemon/tests/lean-inception/routes.test.ts
git commit -m "feat(daemon): add lean-inception HTTP routes"
```

---

## Task 15: Wire routes into daemon `server.ts`

**Files:**
- Modify: `apps/daemon/src/server.ts`

- [ ] **Step 1: Add the import next to other route imports**

Read `apps/daemon/src/server.ts`, find the cluster of `import { registerXRoutes }` near the top (around line 360-368). Add:

```ts
import { registerLeanInceptionRoutes } from './lean-inception-routes.js';
```

- [ ] **Step 2: Register routes near `registerMediaRoutes`**

Find the `registerMediaRoutes(app, { ... })` call (around line 4266). Immediately after that call, add:

```ts
registerLeanInceptionRoutes(app, {
  db: ctx.db,
  storageRoot: ctx.paths.RUNTIME_DATA_DIR,
  defaultRuntime: 'claude',
});
```

Adapt property names if the existing `ctx` shape exposes them under different names; inspect surrounding code for the actual context type.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @open-design/daemon typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/daemon/src/server.ts
git commit -m "feat(daemon): register lean-inception routes in server"
```

---

## Task 16: CLI scaffold + project resolution + `extract` subcommand

**Files:**
- Create: `apps/daemon/src/lean-inception-cli.ts`

This file owns all CLI handlers for `od lean-inception <subcmd>`. Implementation talks to the running daemon via HTTP, matching the pattern of `od media`.

- [ ] **Step 1: Create the file with the entry point + `extract`**

```ts
// apps/daemon/src/lean-inception-cli.ts
// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { resolveDaemonUrl } from './daemon-url.js';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt']);

function printHelp() {
  process.stdout.write(`Usage:
  od lean-inception extract <doc-path...> [--project <id>] [--runtime <name>] [--json] [--quiet]
  od lean-inception status [--project <id>] [--json]
  od lean-inception list [--project <id>] [--json]
  od lean-inception remove-doc <doc-id> [--project <id>] [--json] [--yes]
  od lean-inception reset [--project <id>] [--yes] [--json]
`);
}

function parseFlags(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      if (a.startsWith('-') && a.length > 1) {
        if (a === '-h') flags['help'] = true;
        continue;
      }
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (['json', 'quiet', 'yes', 'help'].includes(name)) {
      flags[name] = true;
    } else {
      flags[name] = args[++i] ?? '';
    }
  }
  return { flags, positional };
}

function resolveProjectId(flags: Record<string, string | boolean>): string {
  const fromFlag = typeof flags['project'] === 'string' ? flags['project'] : '';
  if (fromFlag) return fromFlag;
  const fromEnv = process.env.OD_PROJECT_ID;
  if (fromEnv) return fromEnv;
  process.stderr.write('error: no project resolved; pass --project <id> or set OD_PROJECT_ID\n');
  process.exit(3);
}

async function callDaemon(method: string, url: string, body?: unknown): Promise<any> {
  const daemonUrl = await resolveDaemonUrl();
  const res = await fetch(`${daemonUrl}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* leave parsed as {} */ }
  return { status: res.status, body: parsed };
}

async function extract(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  if (flags['help']) { printHelp(); process.exit(0); }
  if (positional.length === 0) {
    process.stderr.write('error: extract requires at least one document path\n');
    process.exit(2);
  }
  const projectId = resolveProjectId(flags);
  const json = flags['json'] === true;
  const quiet = flags['quiet'] === true;
  const runtime = typeof flags['runtime'] === 'string' ? flags['runtime'] : undefined;

  const documents = [];
  for (const p of positional) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) {
      process.stderr.write(`error: file not found: ${p}\n`);
      process.exit(5);
    }
    const ext = path.extname(abs).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      process.stderr.write(`error: unsupported format (only .md and .txt): ${p}\n`);
      process.exit(5);
    }
    const buf = fs.readFileSync(abs);
    documents.push({
      filename: path.basename(abs),
      mime_type: ext === '.md' ? 'text/markdown' : 'text/plain',
      content_base64: buf.toString('base64'),
    });
  }

  if (!json && !quiet) {
    for (const d of documents) process.stdout.write(`↳ ${d.filename} ... extracting ...\n`);
  }

  const { status, body } = await callDaemon(
    'POST',
    `/api/projects/${encodeURIComponent(projectId)}/lean-inception/documents`,
    { documents, runtime },
  );
  if (status >= 400) {
    if (json) process.stdout.write(JSON.stringify(body) + '\n');
    else process.stderr.write(`error: ${body?.error?.code ?? 'UNKNOWN'}: ${body?.error?.message ?? ''}\n`);
    process.exit(1);
  }
  if (json) {
    process.stdout.write(JSON.stringify(body) + '\n');
    return;
  }
  printState(body.state);
}

function printState(state: any): void {
  process.stdout.write('↳ Lean Inception status:\n');
  for (const [key, snap] of Object.entries(state.columns)) {
    const padded = key.padEnd(22, ' ');
    const cards = (snap as any).cards as Array<any>;
    const dist = cards.length > 0
      ? ` (${countByConfidence(cards)})`
      : '';
    process.stdout.write(`    ${padded}${(snap as any).status}${dist}\n`);
  }
}

function countByConfidence(cards: Array<{ confidence: string }>): string {
  const counts: Record<string, number> = { high: 0, medium: 0, low: 0 };
  for (const c of cards) counts[c.confidence] = (counts[c.confidence] ?? 0) + 1;
  return Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ');
}

export async function runLeanInception(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'extract':    return extract(rest);
    case 'status':     return status(rest);
    case 'list':       return list(rest);
    case 'remove-doc': return removeDoc(rest);
    case 'reset':      return reset(rest);
    default:
      process.stderr.write(`error: unknown subcommand: ${sub}\n`);
      printHelp();
      process.exit(2);
  }
}

async function status(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = resolveProjectId(flags);
  const { status: code, body } = await callDaemon(
    'GET', `/api/projects/${encodeURIComponent(projectId)}/lean-inception`,
  );
  if (code >= 400) {
    process.stderr.write(`error: ${body?.error?.message ?? code}\n`);
    process.exit(1);
  }
  if (flags['json']) {
    process.stdout.write(JSON.stringify(body) + '\n');
    return;
  }
  printState(body.state);
}

async function list(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = resolveProjectId(flags);
  const { status: code, body } = await callDaemon(
    'GET', `/api/projects/${encodeURIComponent(projectId)}/lean-inception/documents`,
  );
  if (code >= 400) {
    process.stderr.write(`error: ${body?.error?.message ?? code}\n`);
    process.exit(1);
  }
  if (flags['json']) {
    process.stdout.write(JSON.stringify(body) + '\n');
    return;
  }
  for (const d of body.documents as Array<any>) {
    process.stdout.write(`${d.id}  ${d.filename}  (${d.card_count} cards, ${d.extraction_status})\n`);
  }
}

async function removeDoc(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const docId = positional[0];
  if (!docId) {
    process.stderr.write('error: remove-doc requires a document id\n');
    process.exit(2);
  }
  const projectId = resolveProjectId(flags);
  if (process.stdin.isTTY && !flags['yes']) {
    process.stderr.write(`warning: pass --yes to confirm removal of ${docId}\n`);
    process.exit(2);
  }
  const { status: code, body } = await callDaemon(
    'DELETE',
    `/api/projects/${encodeURIComponent(projectId)}/lean-inception/documents/${encodeURIComponent(docId)}`,
  );
  if (code >= 400) {
    process.stderr.write(`error: ${body?.error?.message ?? code}\n`);
    process.exit(1);
  }
  if (flags['json']) process.stdout.write(JSON.stringify(body) + '\n');
  else printState(body.state);
}

async function reset(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = resolveProjectId(flags);
  if (!flags['yes']) {
    process.stderr.write('error: reset is destructive; pass --yes to confirm\n');
    process.exit(2);
  }
  const { status: code, body } = await callDaemon(
    'DELETE', `/api/projects/${encodeURIComponent(projectId)}/lean-inception`,
  );
  if (code >= 400) {
    process.stderr.write(`error: ${body?.error?.message ?? code}\n`);
    process.exit(1);
  }
  if (flags['json']) process.stdout.write(JSON.stringify(body) + '\n');
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/daemon/src/lean-inception-cli.ts
git commit -m "feat(cli): add od lean-inception subcommand handlers"
```

---

## Task 17: Register `lean-inception` in `SUBCOMMAND_MAP`

**Files:**
- Modify: `apps/daemon/src/cli.ts`

- [ ] **Step 1: Import the handler**

Add near the top imports in `apps/daemon/src/cli.ts`:

```ts
import { runLeanInception } from './lean-inception-cli.js';
```

- [ ] **Step 2: Add to `SUBCOMMAND_MAP`**

Find the `SUBCOMMAND_MAP = { ... }` object (around line 204). Add the key alongside the others:

```ts
'lean-inception': runLeanInception,
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @open-design/daemon typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/daemon/src/cli.ts
git commit -m "feat(cli): register lean-inception in SUBCOMMAND_MAP"
```

---

## Task 18: Golden fixture scaffold

**Files:**
- Create: `apps/daemon/tests/lean-inception/fixtures/discovery-notes.md`
- Create: `apps/daemon/tests/lean-inception/fixtures/discovery-notes.expected.json`

This task seeds ONE realistic fixture and the minimum coverage expectations. Live-LLM validation (`OD_E2E_LIVE_LLM=1`) is wired in the next task as an opt-in test.

- [ ] **Step 1: Create the fixture document**

```markdown
# Lazuli Catalogue — Discovery Notes

## Vision

Lazuli helps independent bookshops keep their catalogue in sync across
their physical store, their website, and major marketplaces without
typing the same data three times.

## Problem

Independent bookshops lose hours per week duplicating SKU updates
between their POS, their Shopify store, and marketplaces such as
Mercado Livre. Mistakes lead to overselling and angry customers.

## Personas

- Owner-operator (e.g. Carla, owns a 200-title shop): cares about
  not overselling, wants 1-click sync.
- Part-time assistant: needs zero-training UI; sees the same screen
  as the owner.

## Goals

- Reduce the time spent on catalogue maintenance from ~6h/week
  to under 1h/week within 3 months.
- Eliminate oversell incidents (target: zero per month).

## Key Features

- One-click pull of stock counts from the POS.
- Push catalogue changes to Shopify and Mercado Livre simultaneously.
- Visual diff before any sync, so the owner can review.

## Business Rules

- Stock cannot go below zero. Any sync that would create negative
  stock must be blocked with a clear message.
- The system must support ISBN-10 and ISBN-13 as the canonical SKU.
- Prices are always stored in BRL; conversions are display-only.

## Acceptance Criteria

- Given a stock change in the POS, when the user clicks "Sync",
  then Shopify and Mercado Livre reflect the new count within 30
  seconds.
- Given a price change in the catalogue, when the user previews,
  then the diff lists each affected marketplace listing.
```

- [ ] **Step 2: Create the expected.json with MINIMUM coverage**

```json
{
  "minimums": {
    "vision":              { "min_cards": 1, "min_high_confidence": 0 },
    "objective":           { "min_cards": 1, "min_high_confidence": 0 },
    "problem":             { "min_cards": 1, "min_high_confidence": 0 },
    "personas":            { "min_cards": 2, "min_high_confidence": 0 },
    "features":            { "min_cards": 2, "min_high_confidence": 0 },
    "business_rules":      { "min_cards": 2, "min_high_confidence": 0 },
    "acceptance_criteria": { "min_cards": 1, "min_high_confidence": 0 }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/daemon/tests/lean-inception/fixtures/discovery-notes.md apps/daemon/tests/lean-inception/fixtures/discovery-notes.expected.json
git commit -m "test(daemon): add lean-inception discovery-notes golden fixture"
```

---

## Task 19: Golden live-LLM test (opt-in)

**Files:**
- Create: `apps/daemon/tests/lean-inception/golden.live.test.ts`

This test runs against a real runtime when `OD_E2E_LIVE_LLM=1`. Without the env var it skips. It is NOT run by default in CI.

- [ ] **Step 1: Create the test**

```ts
// apps/daemon/tests/lean-inception/golden.live.test.ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  migrateLeanInception,
  upsertInceptionForProject,
  readInceptionState,
} from '../../src/lean-inception/persistence.js';
import { extractDocumentForInception } from '../../src/lean-inception/extraction-service.js';
import { invokeAgentForExtraction } from '../../src/lean-inception/runtime-invoke.js';

const LIVE = process.env.OD_E2E_LIVE_LLM === '1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe.skipIf(!LIVE)('golden — discovery-notes.md', () => {
  it('extracts at least the documented minimums per column', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'discovery-notes.md');
    const expectedPath = path.join(__dirname, 'fixtures', 'discovery-notes.expected.json');
    const fixture = fs.readFileSync(fixturePath);
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateLeanInception(db);
    const inception = upsertInceptionForProject(db, 'prj_golden');
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'li-golden-'));

    const result = await extractDocumentForInception({
      db, inception, storageRoot, runtime: 'claude',
      invoke: invokeAgentForExtraction,
      document: { filename: 'discovery-notes.md', mimeType: 'text/markdown', content: fixture },
    });
    expect(result.ok).toBe(true);

    const state = readInceptionState(db, inception.id);
    for (const [key, mins] of Object.entries(expected.minimums)) {
      const snap = state.columns[key as keyof typeof state.columns];
      expect(snap.cards.length, `column ${key} card count`).toBeGreaterThanOrEqual((mins as any).min_cards);
    }
  }, 180_000);
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/daemon/tests/lean-inception/golden.live.test.ts
git commit -m "test(daemon): add lean-inception golden live-LLM test (opt-in)"
```

---

## Task 20: Final validation

- [ ] **Step 1: Run guard + typecheck + daemon tests**

```bash
pnpm guard
pnpm typecheck
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/contracts typecheck
```

Expected: All green. If anything fails, fix in place — do not skip.

- [ ] **Step 2: Smoke test the CLI end-to-end (manual, requires running daemon)**

In one shell:

```bash
pnpm tools-dev start daemon --namespace lean-test
```

In another shell (mock the runtime via env if a real one is not available — otherwise this exercises a real call):

```bash
# Create a minimal project via the existing API or pick an existing one.
# Then point OD_PROJECT_ID at it:
export OD_PROJECT_ID=<existing-project-id>

cat > /tmp/sample.md <<'EOF'
# Sample
This product helps users do X.
EOF

od lean-inception extract /tmp/sample.md
od lean-inception status --json
```

Expected: `extract` reports cards by column; `status --json` prints a snapshot whose `columns` reflects the extracted cards.

Stop the daemon:

```bash
pnpm tools-dev stop --namespace lean-test
```

- [ ] **Step 3: Final commit (if guard/typecheck required adjustments)**

```bash
git status
# If any uncommitted formatting/linting fixes remain:
git add <files>
git commit -m "chore(lean-inception): final guard/typecheck adjustments"
```

---

## Self-Review Checklist

Before handing off to executor:

- [ ] Every spec section in `2026-05-25-lean-inception-extraction-pipeline-design.md` has at least one task that implements it: contracts (Task 1), column status derivation (Task 4), data model + migration (Tasks 9-11), prompts (Task 8), validation (Tasks 5, 6, parts of 13), HTTP routes (Tasks 14-15), CLI (Tasks 16-17), tests (Tasks 3-13, 18-19), golden fixtures (Tasks 18-19), error catalog (Task 1 + Task 14), reprocessing semantics (Task 13). ✅
- [ ] All function/type names referenced in later tasks are defined in earlier tasks: `computeContentHash`, `deriveColumnStatus`, `isAnchorValid`, `parseLlmJsonOutput`, `prefixLines`, `buildUserPromptV1`, `migrateLeanInception`, `upsertInceptionForProject`, `insertDocument`, `insertCardsAtomic`, `readInceptionState`, `extractDocumentForInception`, `registerLeanInceptionRoutes`, `runLeanInception`. ✅
- [ ] No placeholders (TBD, "implement later", "similar to Task N"). The two "inspect the actual code" notes (Tasks 12 & 15) are explicit adaptation hooks for runtime-detection and ctx shape — not vague TODOs — and identify exact files to check. ✅
- [ ] Tests live in `tests/` sibling to `src/`, never under `src/` — confirmed for all test files. ✅
- [ ] Each step has either runnable code or an exact command. ✅
- [ ] Conventional Commits format with scope, no `Co-authored-by`. ✅
