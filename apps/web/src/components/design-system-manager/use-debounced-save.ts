import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Debounced save trigger. The component calls `schedule()` with the
 * current draft on every keystroke; the hook fires the underlying
 * save callback at most every `delay` ms (default 600). Returns the
 * current save state for the header indicator.
 */
export function useDebouncedSave<T>(
  saveFn: (value: T) => Promise<{ ok: true } | { error: { message: string } }>,
  delay = 600,
): {
  schedule: (value: T) => void;
  state: SaveState;
  flush: () => void;
} {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<number | null>(null);
  const pending = useRef<T | null>(null);

  const flush = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const value = pending.current;
    if (value == null) return;
    pending.current = null;
    setState('saving');
    void saveFn(value).then((result) => {
      setState('error' in result ? 'error' : 'saved');
    });
  }, [saveFn]);

  const schedule = useCallback((value: T) => {
    pending.current = value;
    setState('saving');
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  }, [delay, flush]);

  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);

  return { schedule, state, flush };
}
