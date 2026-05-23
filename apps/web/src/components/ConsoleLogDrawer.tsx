import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

export type ConsoleLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleLogEntry {
  id: number;
  ts: number;
  level: ConsoleLogLevel;
  source: 'iframe' | 'host';
  args: string[];
  stack: string | null;
}

const BUFFER_LIMIT = 200;
const LEVELS: ReadonlyArray<ConsoleLogLevel> = ['log', 'info', 'warn', 'error', 'debug'];

let counter = 0;
function nextId(): number {
  counter = (counter + 1) | 0;
  return counter;
}

function coerceLevel(value: unknown): ConsoleLogLevel {
  if (typeof value !== 'string') return 'log';
  return (LEVELS as readonly string[]).includes(value)
    ? (value as ConsoleLogLevel)
    : 'log';
}

function coerceArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [String(value)];
  return value.map((item) => {
    if (item === null || item === undefined) return String(item);
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && (item as { __error?: boolean }).__error) {
      const err = item as { name?: string; message?: string; stack?: string | null };
      return `${err.name ?? 'Error'}: ${err.message ?? ''}`;
    }
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  });
}

/**
 * Captures console + error events from any iframe child window (via the
 * `od:console-log` postMessage protocol installed by `buildConsoleBridge`)
 * AND mirrors host-side `console.error` so React errors land in the same
 * panel. Ring-buffered at BUFFER_LIMIT to keep memory bounded.
 */
export function useConsoleLog(): {
  entries: ConsoleLogEntry[];
  errorCount: number;
  warnCount: number;
  clear: () => void;
} {
  const [entries, setEntries] = useState<ConsoleLogEntry[]>([]);

  const append = useCallback((entry: ConsoleLogEntry) => {
    setEntries((prev) => {
      const next = prev.concat(entry);
      if (next.length > BUFFER_LIMIT) next.splice(0, next.length - BUFFER_LIMIT);
      return next;
    });
  }, []);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data as
        | { type?: string; level?: unknown; args?: unknown; stack?: unknown; ts?: unknown }
        | null;
      if (!data || data.type !== 'od:console-log') return;
      append({
        id: nextId(),
        ts: typeof data.ts === 'number' ? data.ts : Date.now(),
        level: coerceLevel(data.level),
        source: 'iframe',
        args: coerceArgs(data.args),
        stack: typeof data.stack === 'string' ? data.stack : null,
      });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [append]);

  useEffect(() => {
    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...args: unknown[]) => {
      try {
        append({
          id: nextId(),
          ts: Date.now(),
          level: 'error',
          source: 'host',
          args: coerceArgs(args),
          stack: null,
        });
      } catch {
        /* never let logging crash the host */
      }
      origError.apply(console, args as []);
    };
    console.warn = (...args: unknown[]) => {
      try {
        append({
          id: nextId(),
          ts: Date.now(),
          level: 'warn',
          source: 'host',
          args: coerceArgs(args),
          stack: null,
        });
      } catch {
        /* never let logging crash the host */
      }
      origWarn.apply(console, args as []);
    };
    return () => {
      console.error = origError;
      console.warn = origWarn;
    };
  }, [append]);

  const { errorCount, warnCount } = useMemo(() => {
    let e = 0;
    let w = 0;
    for (const entry of entries) {
      if (entry.level === 'error') e += 1;
      else if (entry.level === 'warn') w += 1;
    }
    return { errorCount: e, warnCount: w };
  }, [entries]);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, errorCount, warnCount, clear };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

interface ConsoleLogDrawerProps {
  open: boolean;
  onClose: () => void;
  entries: ConsoleLogEntry[];
  onClear: () => void;
}

export function ConsoleLogDrawer({ open, onClose, entries, onClear }: ConsoleLogDrawerProps) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warn'>('all');
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === 'error' && entry.level !== 'error') return false;
      if (filter === 'warn' && entry.level !== 'warn' && entry.level !== 'error') return false;
      if (!q) return true;
      const haystack = entry.args.join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, filter, query]);

  useEffect(() => {
    if (!open) return;
    if (!stickToBottomRef.current) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, filtered.length]);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 24;
  }

  if (!open) return null;
  return (
    <div className="console-log-drawer" data-testid="console-log-drawer">
      <div className="console-log-header">
        <span className="console-log-title">Console · {filtered.length}/{entries.length}</span>
        <div className="console-log-filters">
          <button
            type="button"
            className={filter === 'all' ? 'active' : ''}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            className={filter === 'warn' ? 'active' : ''}
            onClick={() => setFilter('warn')}
          >
            Warn+
          </button>
          <button
            type="button"
            className={filter === 'error' ? 'active' : ''}
            onClick={() => setFilter('error')}
          >
            Errors
          </button>
        </div>
        <input
          type="search"
          className="console-log-search"
          placeholder="Filter…"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
        />
        <button type="button" className="console-log-action" onClick={onClear}>
          Clear
        </button>
        <button
          type="button"
          className="console-log-close"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="console-log-list" ref={listRef} onScroll={onListScroll}>
        {filtered.length === 0 ? (
          <p className="console-log-empty">No entries.</p>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} className={`console-log-entry level-${entry.level}`}>
              <span className="console-log-ts">{formatTime(entry.ts)}</span>
              <span className="console-log-src">{entry.source === 'iframe' ? 'iframe' : 'host'}</span>
              <span className={`console-log-lvl lvl-${entry.level}`}>{entry.level}</span>
              <div className="console-log-msg">
                {entry.args.join(' ')}
                {entry.stack ? (
                  <details>
                    <summary>stack</summary>
                    <pre>{entry.stack}</pre>
                  </details>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
