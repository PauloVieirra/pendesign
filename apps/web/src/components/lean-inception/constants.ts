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
  'objective',
  'problem',
  'personas',
  'features',
  'business_rules',
  'acceptance_criteria',
];

export const MAX_FILE_BYTES = 500 * 1024;
