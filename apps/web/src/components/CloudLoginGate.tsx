// Sign-in gate that wraps the whole app shell.
//
// Behavior:
//   - cloud not configured  → renders children unchanged (gate is invisible).
//   - cloud configured + signed out → renders a centered login surface only.
//   - cloud configured + signed in  → renders children.
//
// Status is fetched once on mount. The auth card emits the custom event
// `od:cloud-auth-changed` after successful sign-in / sign-out, which we
// listen for to re-fetch and either reveal or hide the gate.

import { useEffect, useState, type ReactNode } from 'react';
import { CloudAuthCard } from './CloudAuthCard';
import { fetchCloudStatus, type CloudStatus } from '../providers/cloud';

export const CLOUD_AUTH_CHANGED_EVENT = 'od:cloud-auth-changed';

export function dispatchCloudAuthChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CLOUD_AUTH_CHANGED_EVENT));
  }
}

interface GateState {
  loading: boolean;
  status: CloudStatus | null;
  error: string | null;
}

export function CloudLoginGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ loading: true, status: null, error: null });

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const status = await fetchCloudStatus();
        if (!canceled) setState({ loading: false, status, error: null });
      } catch (err) {
        if (!canceled) {
          setState({
            loading: false,
            status: null,
            error: err instanceof Error ? err.message : 'failed to fetch cloud status',
          });
        }
      }
    }
    void load();
    const handler = () => {
      setState((prev) => ({ ...prev, loading: true }));
      void load();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener(CLOUD_AUTH_CHANGED_EVENT, handler);
    }
    return () => {
      canceled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener(CLOUD_AUTH_CHANGED_EVENT, handler);
      }
    };
  }, []);

  if (state.loading) {
    return (
      <div className="cloud-gate cloud-gate-loading">
        <div className="cloud-gate-spinner" />
        <p>Connecting to local daemon…</p>
      </div>
    );
  }

  // Failure to reach the daemon means cloud status is unknown. Fail open
  // so the app stays usable locally; the gate doesn't add a hard wall when
  // the underlying transport is broken. The error is logged so devs notice.
  if (state.error || !state.status) {
    if (state.error) console.warn('[cloud-gate] status fetch failed:', state.error);
    return <>{children}</>;
  }

  if (!state.status.configured) {
    return <>{children}</>;
  }

  if (!state.status.signed_in) {
    return (
      <div className="cloud-gate cloud-gate-signin">
        <div className="cloud-gate-brand">
          <span className="cloud-gate-logo">◆</span>
          <h1>Open Design</h1>
        </div>
        <p className="cloud-gate-tagline">
          Sign in to your cloud account to load projects and collaborate.
        </p>
        <CloudAuthCard onSignedIn={() => dispatchCloudAuthChanged()} />
        <footer className="cloud-gate-footer">
          <small>
            Cloud collaboration is opt-in. To work fully local without an account,
            unset <code>OD_CLOUD_URL</code> in the daemon environment and restart.
          </small>
        </footer>
      </div>
    );
  }

  return <>{children}</>;
}
