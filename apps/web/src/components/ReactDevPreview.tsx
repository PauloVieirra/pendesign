import { useEffect, useRef, useState } from 'react';
import {
  fetchDevServerStatus,
  startProjectDevServer,
  stopProjectDevServer,
} from '../providers/registry';
import type { DevServerPhase, DevServerStatusResponse } from '../types';

interface Props {
  projectId: string;
  /** When true, the component triggers a start request on mount if the
   * dev server is currently idle / stopped. Defaults to true for the
   * canvas entry point. */
  autoStart?: boolean;
}

export function ReactDevPreview({ projectId, autoStart = true }: Props) {
  const [status, setStatus] = useState<DevServerStatusResponse | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const startedRef = useRef(false);

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
  // Point the iframe straight at the Vite dev server. We intentionally
  // sidestep the daemon proxy here: Vite emits absolute paths
  // (/@vite/client, /node_modules/.vite/deps/*) that the browser resolves
  // against the iframe's host, and rewriting every asset URL through the
  // proxy would mean intercepting the JS bundle too. The trade-off is the
  // iframe runs cross-origin to the host (different port), so the edit
  // bridge can't reach into the DOM yet — that lands in M4 when the
  // bridge is moved into a shared package the dev server can serve
  // first-party. Until then the preview works (HMR included) and the
  // canvas just shows the live app.
  const iframeUrl = status?.url ?? '';

  const handleStart = async () => {
    startedRef.current = true;
    await startProjectDevServer(projectId);
  };
  const handleStop = async () => {
    startedRef.current = false;
    await stopProjectDevServer(projectId);
  };
  const handleReload = () => setIframeKey((n) => n + 1);

  return (
    <div className="react-dev-preview">
      <header className="react-dev-preview__bar">
        <span className={`react-dev-preview__status react-dev-preview__status--${phase}`}>
          <span className="react-dev-preview__dot" aria-hidden="true" />
          {phaseLabel(phase)}
          {status?.port ? <span className="react-dev-preview__port">:{status.port}</span> : null}
        </span>
        <div className="react-dev-preview__actions">
          {phase === 'running' ? (
            <>
              <button type="button" className="react-dev-preview__btn" onClick={handleReload}>
                Reload
              </button>
              <button type="button" className="react-dev-preview__btn" onClick={() => void handleStop()}>
                Stop
              </button>
            </>
          ) : (
            <button
              type="button"
              className="react-dev-preview__btn react-dev-preview__btn--primary"
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
          <iframe
            key={iframeKey}
            title="React dev preview"
            src={iframeUrl}
            className="react-dev-preview__iframe"
          />
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
