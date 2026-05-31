import {
  LEAN_INCEPTION_COLUMN_KEYS,
  type LeanInceptionColumnKey,
} from '@open-design/contracts';

export { LEAN_INCEPTION_COLUMN_KEYS, type LeanInceptionColumnKey };

export function isLeanInceptionColumnKey(value: unknown): value is LeanInceptionColumnKey {
  return typeof value === 'string'
    && (LEAN_INCEPTION_COLUMN_KEYS as readonly string[]).includes(value);
}
