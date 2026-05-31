import { useCallback, useEffect, useState } from 'react';
import type { LeanInceptionColumnKey } from '@open-design/contracts';
import { COLUMN_ORDER, DEFAULT_VISIBLE_COLUMNS } from './constants';

const storageKey = (projectId: string) => `od:lean-inception:visible-columns:${projectId}`;

export interface UseColumnVisibility {
  visible: ReadonlySet<LeanInceptionColumnKey>;
  isVisible: (key: LeanInceptionColumnKey) => boolean;
  toggle: (key: LeanInceptionColumnKey) => void;
  reset: () => void;
  orderedVisible: readonly LeanInceptionColumnKey[];
}

function loadInitial(projectId: string): Set<LeanInceptionColumnKey> {
  if (typeof window === 'undefined') return new Set(DEFAULT_VISIBLE_COLUMNS);
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return new Set(DEFAULT_VISIBLE_COLUMNS);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set(DEFAULT_VISIBLE_COLUMNS);
    const validKeys = new Set(COLUMN_ORDER as readonly LeanInceptionColumnKey[]);
    const filtered = parsed.filter((k): k is LeanInceptionColumnKey =>
      typeof k === 'string' && validKeys.has(k as LeanInceptionColumnKey)
    );
    return filtered.length > 0 ? new Set(filtered) : new Set(DEFAULT_VISIBLE_COLUMNS);
  } catch {
    return new Set(DEFAULT_VISIBLE_COLUMNS);
  }
}

export function useColumnVisibility(projectId: string): UseColumnVisibility {
  const [visible, setVisible] = useState<Set<LeanInceptionColumnKey>>(() => loadInitial(projectId));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(Array.from(visible)));
  }, [visible, projectId]);

  const isVisible = useCallback((key: LeanInceptionColumnKey) => visible.has(key), [visible]);
  const toggle = useCallback((key: LeanInceptionColumnKey) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const reset = useCallback(() => setVisible(new Set(DEFAULT_VISIBLE_COLUMNS)), []);

  const orderedVisible = COLUMN_ORDER.filter((k) => visible.has(k));

  return { visible, isVisible, toggle, reset, orderedVisible };
}
