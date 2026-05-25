import type {
  LeanInceptionColumnStatus,
  LeanInceptionConfidence,
  LeanInceptionColumnKey,
} from '@open-design/contracts';

export const LEAN_INCEPTION_TAB = '__lean_inception__';

export const SUPPORTED_EXTENSIONS = new Set<string>(['.md', '.txt']);

export const STATUS_COLOR_CLASS: Record<LeanInceptionColumnStatus, string> = {
  complete:        'li-status--complete',
  partial:         'li-status--partial',
  insufficient:    'li-status--insufficient',
  not_identified:  'li-status--not_identified',
};

export const CONFIDENCE_DOT_CLASS: Record<LeanInceptionConfidence, string> = {
  high:   'li-confidence-dot--high',
  medium: 'li-confidence-dot--medium',
  low:    'li-confidence-dot--low',
};

export const COLUMN_ORDER: readonly LeanInceptionColumnKey[] = [
  'vision',
  'problem',
  'objective',
  'csd_matrix',
  'market_research',
  'market_opportunities',
  'personas',
  'user_journey',
  'features',
  'business_rules',
  'ideation',
  'acceptance_criteria',
];

export const DEFAULT_VISIBLE_COLUMNS: readonly LeanInceptionColumnKey[] = [
  'vision',
  'problem',
  'objective',
  'csd_matrix',
  'market_research',
  'market_opportunities',
  'personas',
  'user_journey',
  'features',
  'business_rules',
  'ideation',
];

export const COLUMN_LABELS_PT: Record<LeanInceptionColumnKey, string> = {
  vision: 'Visão',
  problem: 'Problema',
  objective: 'Objetivo',
  csd_matrix: 'Matriz CSD',
  market_research: 'Pesquisa de mercado',
  market_opportunities: 'Oportunidade de mercado',
  personas: 'Persona',
  user_journey: 'Jornada do usuário',
  features: 'Features',
  business_rules: 'Regra de negócio',
  ideation: 'Ideação',
  acceptance_criteria: 'Critérios de aceite',
};

export const MAX_FILE_BYTES = 500 * 1024;
