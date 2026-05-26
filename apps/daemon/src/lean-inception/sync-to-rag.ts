import type Database from 'better-sqlite3';
import type { LeanInceptionState } from '@open-design/contracts';
import { ingestDoc } from '../rag.js';
import { deleteProjectDocsByName } from '../db.js';
import { COLUMN_LABELS_PT } from './column-labels-pt.js';
import { LEAN_INCEPTION_COLUMN_KEYS } from './column-keys.js';

export const LEAN_INCEPTION_SUMMARY_DOC_NAME = '__lean-inception-summary__.md';

export function buildInceptionMarkdown(state: LeanInceptionState): string {
  const lines: string[] = [];
  lines.push('# Lean Inception — Resumo do projeto');
  lines.push('');
  lines.push(
    'Este documento é o contexto canônico do projeto. Foi gerado automaticamente a partir do Lean Inception e deve ser usado como fonte de verdade para entender visão, problema, personas, jornadas, features, regras de negócio e ideação. Sempre que possível, baseie respostas e geração de telas nestes itens.',
  );
  lines.push('');

  for (const key of LEAN_INCEPTION_COLUMN_KEYS) {
    const snap = state.columns[key];
    if (!snap || snap.cards.length === 0) continue;
    lines.push(`## ${COLUMN_LABELS_PT[key]}`);
    lines.push('');
    for (const card of snap.cards) {
      lines.push(`- **${card.title}** — ${card.content}`);
      if (card.source_anchor) {
        const anchor =
          card.source_anchor.length > 200
            ? `${card.source_anchor.slice(0, 200)}…`
            : card.source_anchor;
        lines.push(`  - _fonte: ${anchor}_`);
      }
    }
    lines.push('');
  }

  if (state.documents.length > 0) {
    lines.push('## Documentos fonte');
    lines.push('');
    for (const d of state.documents) {
      lines.push(`- ${d.filename} (${d.card_count} cards extraídos)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export interface SyncResult {
  docId: string;
  chunkCount: number;
  embedded: boolean;
  charsIngested: number;
}

export async function syncInceptionToRag(
  db: Database.Database,
  projectId: string,
  state: LeanInceptionState,
): Promise<SyncResult> {
  const markdown = buildInceptionMarkdown(state);
  // Idempotent: drop prior chunks for this synthetic doc name before re-ingesting
  deleteProjectDocsByName(db, projectId, LEAN_INCEPTION_SUMMARY_DOC_NAME);

  const result = await ingestDoc(db, projectId, {
    name: LEAN_INCEPTION_SUMMARY_DOC_NAME,
    content: markdown,
  });

  return {
    docId: result.docId,
    chunkCount: result.chunkCount,
    embedded: result.embedded,
    charsIngested: markdown.length,
  };
}
