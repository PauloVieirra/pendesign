import type {
  LeanInceptionColumnStatus,
  LeanInceptionConfidence,
  LeanInceptionColumnKey,
} from '@open-design/contracts';

export const LEAN_INCEPTION_TAB = '__lean_inception__';

export const SUPPORTED_EXTENSIONS = new Set<string>(['.md', '.txt']);

export const STATUS_COLOR_CLASS: Record<LeanInceptionColumnStatus, string> = {
  complete:        'text-green-500',
  partial:         'text-amber-500',
  insufficient:    'text-orange-500',
  not_identified:  'text-neutral-400',
};

export const CONFIDENCE_DOT_CLASS: Record<LeanInceptionConfidence, string> = {
  high:   'bg-green-500',
  medium: 'bg-amber-500',
  low:    'bg-neutral-400',
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
