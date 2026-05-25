import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  fetchDevServerStatus,
  startProjectDevServer,
  stopProjectDevServer,
} from '../providers/registry';
import type { DevServerPhase, DevServerStatusResponse } from '../types';
import { Icon } from './Icon';

interface Props {
  projectId: string;
  /** When true, the component triggers a start request on mount if the
   * dev server is currently idle / stopped. Defaults to true for the
   * canvas entry point. */
  autoStart?: boolean;
}

type Viewport = { id: string; label: string; width: number | null; height?: number | null };

// Same preset shape used by FileViewer's PreviewViewportControls so the
// React canvas mirrors the HTML canvas visually. The id "web" stays the
// full-width / no-frame variant.
const VIEWPORTS: Viewport[] = [
  { id: 'web', label: 'Web', width: null },
  { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024 },
  { id: 'mobile', label: 'Mobile', width: 375, height: 812 },
];

const VIEWPORT_STORAGE_KEY = 'od.reactDevPreview.viewportId';

function loadInitialViewport(): Viewport {
  try {
    const id = window.localStorage.getItem(VIEWPORT_STORAGE_KEY);
    const found = VIEWPORTS.find((v) => v.id === id);
    if (found) return found;
  } catch { /* SSR or non-secure context */ }
  return VIEWPORTS[0]!;
}

export function ReactDevPreview({ projectId, autoStart = true }: Props) {
  const [status, setStatus] = useState<DevServerStatusResponse | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [viewport, setViewport] = useState<Viewport>(loadInitialViewport);
  const startedRef = useRef(false);

  function pickViewport(v: Viewport) {
    setViewport(v);
    try { window.localStorage.setItem(VIEWPORT_STORAGE_KEY, v.id); } catch { /* ignore */ }
  }

  // Poll status every ~1.2s. Slower when we know the dev server is already
  // running (we still poll to detect crashes, but a 3s cadence is fine).
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      const next = await fetchDevServerStatus(projectId);
      if (cancelled) return;
      setStatus(next);
      const cadence = next?.phase === 'running' ? 3000 : 1200;
      timer = window.setTimeout(() => void tick(), cadence);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [projectId]);

  // Auto-start on mount when the server is idle. We guard with a ref so a
  // re-render that happens before the first poll lands does not fire the
  // start request twice.
  useEffect(() => {
    if (!autoStart || startedRef.current) return;
    if (!status) return;
    if (status.phase === 'idle' || status.phase === 'stopped') {
      startedRef.current = true;
      void startProjectDevServer(projectId);
    }
  }, [autoStart, projectId, status]);

  const phase: DevServerPhase = status?.phase ?? 'idle';
  // Point the iframe straight at the Vite dev server. Vite emits absolute
  // paths (/@vite/client, /node_modules/.vite/deps/*) so going through
  // the daemon proxy would require rewriting every JS chunk; loading the
  // dev server directly keeps HMR and asset resolution working out of
  // the box. The edit bridge is shipped through the project's own
  // public/edit-bridge.js so it stays first-party to the iframe.
  const iframeUrl = status?.url ?? '';

  const handleStart = useCallback(async () => {
    startedRef.current = true;
    await startProjectDevServer(projectId);
  }, [projectId]);
  const handleStop = useCallback(async () => {
    startedRef.current = false;
    await stopProjectDevServer(projectId);
  }, [projectId]);
  const handleReload = useCallback(() => setIframeKey((n) => n + 1), []);

  const isFullViewport = viewport.id === 'web' || viewport.width === null;
  const stageClassName = `react-dev-preview__stage preview-viewport preview-viewport-${viewport.id}`;

  return (
    <div className="react-dev-preview">
      <header className="viewer-toolbar react-dev-preview__toolbar">
        <div className="viewer-toolbar-left">
          <span className={`react-dev-preview__status react-dev-preview__status--${phase}`}>
            <span className="react-dev-preview__dot" aria-hidden="true" />
            {phaseLabel(phase)}
            {status?.port ? <span className="react-dev-preview__port">:{status.port}</span> : null}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          {phase === 'running' ? (
            <>
              <ViewportDropdown viewport={viewport} onChange={pickViewport} />
              <button
                type="button"
                className="viewer-action"
                onClick={handleReload}
                title="Reload preview"
              >
                <Icon name="refresh" size={13} />
                <span>Reload</span>
              </button>
              <button
                type="button"
                className="viewer-action"
                onClick={() => void handleStop()}
                title="Stop dev server"
              >
                Stop
              </button>
            </>
          ) : (
            <button
              type="button"
              className="viewer-action primary"
              onClick={() => void handleStart()}
              disabled={phase === 'starting'}
            >
              {phase === 'starting' ? 'Starting…' : 'Start dev server'}
            </button>
          )}
        </div>
      </header>
      <div className="react-dev-preview__body">
        {phase === 'running' && iframeUrl ? (
          <div
            className={stageClassName}
            style={
              !isFullViewport && viewport.width
                ? ({
                    ['--preview-viewport-width' as any]: `${viewport.width}px`,
                    ['--preview-viewport-height' as any]: viewport.height ? `${viewport.height}px` : '100%',
                  } as React.CSSProperties)
                : undefined
            }
          >
            <div className="react-dev-preview__frame preview-frame-clip">
              <iframe
                key={iframeKey}
                title="React dev preview"
                src={iframeUrl}
                className="react-dev-preview__iframe"
              />
            </div>
          </div>
        ) : phase === 'starting' ? (
          <div className="react-dev-preview__placeholder">
            <div className="react-dev-preview__spinner" aria-hidden="true" />
            <span>Starting Vite dev server…</span>
            <pre className="react-dev-preview__log">
              {(status?.recentLog ?? []).slice(-12).join('\n') || 'Waiting for output…'}
            </pre>
          </div>
        ) : phase === 'error' ? (
          <div className="react-dev-preview__placeholder react-dev-preview__placeholder--error">
            <strong>Dev server failed to start.</strong>
            <span>{status?.error ?? 'Unknown error'}</span>
            <pre className="react-dev-preview__log">
              {(status?.recentLog ?? []).slice(-12).join('\n')}
            </pre>
          </div>
        ) : (
          <div className="react-dev-preview__placeholder">
            <strong>Dev server is not running</strong>
            <span>Click <em>Start dev server</em> to launch <code>vite</code>.</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface ViewportDropdownProps {
  viewport: Viewport;
  onChange: (v: Viewport) => void;
}

function ViewportDropdown({ viewport, onChange }: ViewportDropdownProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="viewer-viewport-switcher" ref={menuRef}>
      <button
        type="button"
        className="viewer-action viewer-viewport-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={viewport.width ? `${viewport.width}px` : 'Full width'}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{viewport.label}</span>
        <Icon name="chevron-down" size={11} />
      </button>
      {open ? (
        <div
          className="viewer-viewport-menu"
          id={listboxId}
          role="listbox"
          aria-label="Viewport size"
        >
          {VIEWPORTS.map((v) => {
            const selected = v.id === viewport.id;
            return (
              <button
                key={v.id}
                type="button"
                className={`viewer-viewport-menu-item${selected ? ' active' : ''}`}
                role="option"
                aria-selected={selected}
                onClick={() => { onChange(v); setOpen(false); }}
              >
                <span>{v.label}{v.width ? ` · ${v.width}px` : ''}</span>
                {selected ? <Icon name="check" size={13} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function phaseLabel(phase: DevServerPhase): string {
  switch (phase) {
    case 'running': return 'Running';
    case 'starting': return 'Starting';
    case 'stopped': return 'Stopped';
    case 'error': return 'Error';
    case 'idle':
    default: return 'Idle';
  }
}
