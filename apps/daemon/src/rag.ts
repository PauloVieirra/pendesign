// Project documentation RAG: chunking + Voyage AI embeddings + per-project
// retrieval. Used by the New Project wizard Step 3 to ingest user-supplied
// .md / .txt docs and feed top-k snippets back into the agent's system
// prompt at conversation time.
//
// Isolation contract: every storage and search call is keyed by projectId.
// The SQLite schema enforces that with a FOREIGN KEY on projects(id) and an
// (project_id, doc_id, chunk_idx) index — see db.ts. Callers MUST pass the
// projectId; there is no global search surface by design.

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  insertProjectDocChunks,
  loadAllProjectDocChunks,
  type ProjectDocRow,
} from './db.js';

// Voyage-3-lite is the recommended cost/quality default for English +
// Portuguese. 1024-dim embeddings, ~$0.02 / 1M tokens. The model id is
// pinned here; a future settings panel can override it.
const VOYAGE_MODEL = 'voyage-3-lite';
const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

// ~600 char chunks with 80 char overlap is a pragmatic default for prose
// documentation (rules / briefings). Small enough that a top-3 retrieval
// fits in a tight token budget; overlapping enough that a single requirement
// is not split awkwardly across chunks.
const CHUNK_SIZE_CHARS = 600;
const CHUNK_OVERLAP_CHARS = 80;

export interface DocChunkInput {
  docId: string;
  docName: string;
  content: string;
}

export interface RetrievedChunk {
  docId: string;
  docName: string;
  chunkIdx: number;
  content: string;
  score: number;
}

export class RagDisabledError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'RagDisabledError';
  }
}

export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= CHUNK_SIZE_CHARS) return [trimmed];

  const out: string[] = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    const end = Math.min(cursor + CHUNK_SIZE_CHARS, trimmed.length);
    let slice = trimmed.slice(cursor, end);
    // Prefer to break on a sentence boundary or newline so chunks read
    // naturally when injected into the prompt.
    if (end < trimmed.length) {
      const lastNewline = slice.lastIndexOf('\n');
      const lastPeriod = slice.lastIndexOf('. ');
      const breakAt = Math.max(lastNewline, lastPeriod);
      if (breakAt > CHUNK_SIZE_CHARS * 0.5) {
        slice = slice.slice(0, breakAt + 1);
      }
    }
    out.push(slice.trim());
    if (end >= trimmed.length) break;
    cursor += slice.length - CHUNK_OVERLAP_CHARS;
    if (cursor < 0) cursor = 0;
  }
  return out.filter((s) => s.length > 0);
}

// Public: embed an array of texts via Voyage AI. Returns null embeddings
// when the API key is missing — callers store chunks without vectors and
// retrieval falls back to lexical scoring. This keeps the wizard usable
// before the user has configured Voyage.
export async function embedTexts(
  texts: string[],
  input_type: 'document' | 'query',
): Promise<{ vectors: (number[] | null)[]; model: string | null }> {
  if (texts.length === 0) return { vectors: [], model: null };
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    return { vectors: texts.map(() => null), model: null };
  }
  try {
    const response = await fetch(VOYAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: texts,
        input_type,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Voyage AI returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }
    const body = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    const data = body.data ?? [];
    const vectors: (number[] | null)[] = new Array(texts.length).fill(null);
    for (const entry of data) {
      if (
        typeof entry.index === 'number'
        && entry.index >= 0
        && entry.index < texts.length
        && Array.isArray(entry.embedding)
      ) {
        vectors[entry.index] = entry.embedding;
      }
    }
    return { vectors, model: VOYAGE_MODEL };
  } catch (err) {
    // Fall back to no embeddings so the wizard doesn't fail the project
    // creation. The chunks still land in SQLite — search will degrade to
    // lexical until the user fixes the API key.
    // eslint-disable-next-line no-console
    console.warn('[rag] voyage embedding failed:', err);
    return { vectors: texts.map(() => null), model: null };
  }
}

// Ingest one document into the project_docs table. Chunks the text,
// embeds the chunks, and writes them transactionally — partial failure
// leaves no orphan rows.
export async function ingestDoc(
  db: Database.Database,
  projectId: string,
  doc: { name: string; content: string },
): Promise<{ docId: string; chunkCount: number; embedded: boolean }> {
  if (!projectId) throw new Error('ingestDoc: projectId is required');
  const chunks = chunkText(doc.content);
  if (chunks.length === 0) {
    return { docId: '', chunkCount: 0, embedded: false };
  }
  const docId = randomUUID();
  const { vectors, model } = await embedTexts(chunks, 'document');
  const rows = chunks.map((content, idx) => ({
    projectId,
    docId,
    docName: doc.name,
    chunkIdx: idx,
    content,
    embedding: vectors[idx] ?? null,
    embeddingModel: model,
  }));
  insertProjectDocChunks(db, rows);
  return {
    docId,
    chunkCount: chunks.length,
    embedded: vectors.some((v) => v !== null),
  };
}

// Retrieve top-K chunks most relevant to `query`, scoped to a single
// project. When embeddings exist we use cosine similarity; when they
// don't (Voyage key absent during ingest) we fall back to lexical token
// overlap so the feature degrades gracefully.
//
// NOTE: never call this without a projectId. The SQL filter is the
// isolation boundary — there is no surface for cross-project retrieval.
export async function searchProjectDocs(
  db: Database.Database,
  projectId: string,
  query: string,
  topK = 3,
): Promise<RetrievedChunk[]> {
  if (!projectId) throw new Error('searchProjectDocs: projectId is required');
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return [];

  const allChunks = loadAllProjectDocChunks(db, projectId);
  if (allChunks.length === 0) return [];

  const hasEmbeddings = allChunks.some(
    (c) => c.embedding && c.embedding.length > 0,
  );

  if (hasEmbeddings) {
    const { vectors } = await embedTexts([trimmedQuery], 'query');
    const queryVec = vectors[0];
    if (queryVec) {
      return rankByCosine(allChunks, queryVec, topK);
    }
  }
  return rankByLexical(allChunks, trimmedQuery, topK);
}

function rankByCosine(
  chunks: ProjectDocRow[],
  queryVec: number[],
  topK: number,
): RetrievedChunk[] {
  const scored: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    if (!chunk.embedding || chunk.embedding.length !== queryVec.length) continue;
    const score = cosineSimilarity(chunk.embedding, queryVec);
    scored.push({
      docId: chunk.docId,
      docName: chunk.docName,
      chunkIdx: chunk.chunkIdx,
      content: chunk.content,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

function rankByLexical(
  chunks: ProjectDocRow[],
  query: string,
  topK: number,
): RetrievedChunk[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const queryTokenSet = new Set(queryTokens);
  const scored: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const chunkTokens = tokenize(chunk.content);
    if (chunkTokens.length === 0) continue;
    let overlap = 0;
    for (const token of chunkTokens) {
      if (queryTokenSet.has(token)) overlap += 1;
    }
    const score = overlap / Math.sqrt(chunkTokens.length * queryTokens.length);
    if (score > 0) {
      scored.push({
        docId: chunk.docId,
        docName: chunk.docName,
        chunkIdx: chunk.chunkIdx,
        content: chunk.content,
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

// Compact prompt section ready to be appended to the system message. The
// retrieval is scoped to one project; the section is omitted entirely when
// nothing relevant is found, so we never pollute the prompt with empty
// boilerplate.
export function formatRagSection(chunks: RetrievedChunk[]): string | null {
  if (chunks.length === 0) return null;
  const blocks = chunks.map((chunk) => {
    return `### ${chunk.docName} (chunk ${chunk.chunkIdx + 1})\n${chunk.content.trim()}`;
  });
  return [
    '## Project documentation (RAG retrieval)',
    '',
    'The following excerpts come from documents the user attached to this',
    'project at creation time (Step 3 of the New Project wizard). They are',
    'project-scoped — never blend them with other projects\' context.',
    '',
    blocks.join('\n\n'),
  ].join('\n');
}
