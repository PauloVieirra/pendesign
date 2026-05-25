import type { LeanInceptionState, LeanInceptionColumnKey } from '@open-design/contracts';
import { COLUMN_LABELS_PT } from './constants';

export type ReadinessLevel = 'ready' | 'partial' | 'insufficient';

export interface ReadinessAssessment {
  level: ReadinessLevel;
  /** Critical columns missing at least one card with confidence >= medium. */
  missingCritical: LeanInceptionColumnKey[];
  /** Important columns missing at least one card (any confidence). */
  missingImportant: LeanInceptionColumnKey[];
  /** Human-readable PT labels of the missing items (critical + important). */
  missingLabels: string[];
  /** One-line PT summary suitable for the badge label. */
  summary: string;
}

/** For UI screen construction we need to know WHO the users are, HOW they use
 * the product, and WHAT functionality matters. These three are the gating
 * criteria. */
const CRITICAL_COLUMNS: readonly LeanInceptionColumnKey[] = [
  'personas',
  'user_journey',
  'features',
];

/** Strong-but-not-blocking signals that still inform UI direction. */
const IMPORTANT_COLUMNS: readonly LeanInceptionColumnKey[] = [
  'vision',
  'problem',
];

function hasSolidCard(
  state: LeanInceptionState,
  column: LeanInceptionColumnKey,
): boolean {
  const snap = state.columns[column];
  if (!snap) return false;
  return snap.cards.some((c) => c.confidence === 'high' || c.confidence === 'medium');
}

function hasAnyCard(
  state: LeanInceptionState,
  column: LeanInceptionColumnKey,
): boolean {
  const snap = state.columns[column];
  if (!snap) return false;
  return snap.cards.length > 0;
}

export function assessReadiness(state: LeanInceptionState | null): ReadinessAssessment {
  if (!state) {
    return {
      level: 'insufficient',
      missingCritical: [...CRITICAL_COLUMNS],
      missingImportant: [...IMPORTANT_COLUMNS],
      missingLabels: [...CRITICAL_COLUMNS, ...IMPORTANT_COLUMNS].map((k) => COLUMN_LABELS_PT[k]),
      summary: 'Sem dados suficientes para iniciar telas',
    };
  }

  const missingCritical = CRITICAL_COLUMNS.filter((c) => !hasSolidCard(state, c));
  const missingImportant = IMPORTANT_COLUMNS.filter((c) => !hasAnyCard(state, c));
  const missingLabels = [...missingCritical, ...missingImportant].map(
    (k) => COLUMN_LABELS_PT[k],
  );

  let level: ReadinessLevel;
  let summary: string;
  if (missingCritical.length === 0 && missingImportant.length === 0) {
    level = 'ready';
    summary = 'Pronto para iniciar telas';
  } else if (missingCritical.length === 0) {
    level = 'partial';
    summary = `Quase pronto — falta ${missingImportant.length === 1 ? COLUMN_LABELS_PT[missingImportant[0]!] : `${missingImportant.length} colunas`}`;
  } else if (missingCritical.length < CRITICAL_COLUMNS.length) {
    level = 'partial';
    summary = `Falta ${missingCritical.length === 1 ? COLUMN_LABELS_PT[missingCritical[0]!] : `${missingCritical.length} colunas críticas`}`;
  } else {
    level = 'insufficient';
    summary = 'Dados insuficientes para iniciar telas';
  }

  return { level, missingCritical, missingImportant, missingLabels, summary };
}
