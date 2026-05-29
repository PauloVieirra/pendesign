// Minimal sign-in / sign-up card for the cloud surface. Mount anywhere the
// app wants to gate cloud features behind authentication. Reads /api/cloud/auth/status
// on mount and self-hides when cloud is not configured.

import { useEffect, useState } from 'react';
import {
  cloudSignIn,
  cloudSignOut,
  cloudSignUp,
  fetchCloudStatus,
  type CloudStatus,
} from '../providers/cloud';
import { CLOUD_AUTH_CHANGED_EVENT } from './CloudLoginGate';

interface ErrorState { code: string; message: string }

export function CloudAuthCard({ onSignedIn }: { onSignedIn?: (email: string) => void } = {}) {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<ErrorState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function refreshStatus() {
    try {
      const next = await fetchCloudStatus();
      setStatus(next);
    } catch (err) {
      setError({ code: 'network', message: 'could not reach daemon' });
    }
  }

  if (!status) {
    return <div className="cloud-auth-card cloud-auth-card-loading">Loading cloud status…</div>;
  }

  if (!status.configured) {
    return (
      <div className="cloud-auth-card cloud-auth-card-disabled">
        <header className="cloud-auth-card-head">Account not configured</header>
        <p className="cloud-auth-card-hint">
          The system is running in local-only mode. Contact your administrator to enable accounts.
        </p>
      </div>
    );
  }

  if (status.signed_in) {
    return (
      <div className="cloud-auth-card cloud-auth-card-signed-in">
        <header className="cloud-auth-card-head">Signed in</header>
        <p className="cloud-auth-card-line">
          <strong>{status.name}</strong>
          <span className="cloud-auth-card-email"> · {status.email}</span>
        </p>
        <button
          type="button"
          className="cloud-auth-card-btn cloud-auth-card-btn-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await cloudSignOut();
              await refreshStatus();
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent(CLOUD_AUTH_CHANGED_EVENT));
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === 'signin') {
        await cloudSignIn({ email: email.trim(), password });
      } else {
        await cloudSignUp({ email: email.trim(), password, name: name.trim() });
      }
      await refreshStatus();
      onSignedIn?.(email.trim());
      setEmail('');
      setPassword('');
      setName('');
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: string };
      setError({
        code: e.code ?? 'unknown',
        message: friendlyError(e.code, e.details ?? e.message ?? ''),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cloud-auth-card">
      <header className="cloud-auth-card-head">
        <h3>Account</h3>
        <div className="cloud-auth-card-tabs">
          <button
            type="button"
            className={tab === 'signin' ? 'active' : ''}
            onClick={() => { setTab('signin'); setError(null); }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={tab === 'signup' ? 'active' : ''}
            onClick={() => { setTab('signup'); setError(null); }}
          >
            Sign up
          </button>
        </div>
      </header>

      <form className="cloud-auth-card-form" onSubmit={handleSubmit}>
        {tab === 'signup' ? (
          <label className="cloud-auth-card-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              maxLength={120}
            />
          </label>
        ) : null}
        <label className="cloud-auth-card-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label className="cloud-auth-card-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={tab === 'signup' ? 8 : 1}
          />
          {tab === 'signup' ? (
            <em className="cloud-auth-card-helptext">At least 8 characters.</em>
          ) : null}
        </label>
        {error ? (
          <div className="cloud-auth-card-error" role="alert">{error.message}</div>
        ) : null}
        <button
          type="submit"
          className="cloud-auth-card-btn cloud-auth-card-btn-primary"
          disabled={busy}
        >
          {busy ? '…' : tab === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function friendlyError(code: string | undefined, details: string): string {
  switch (code) {
    case 'validation_error': return details || 'Check email and password format.';
    case 'auth_failed':       return 'Email or password is wrong.';
    case 'email_already_exists': return 'An account with this email already exists. Sign in instead.';
    case 'weak_password':     return 'Password is too weak. Use at least 8 characters.';
    case 'rate_limited':      return 'Too many attempts. Try again in a minute.';
    case 'network_error':     return 'Could not reach the server. Check your internet.';
    case 'cloud_not_configured': return 'Accounts are not enabled on this machine.';
    default: return details || 'Something went wrong. Try again.';
  }
}
