// Supabase SDK wrapper for the daemon.
//
// Encapsulates the Supabase JS client so the rest of the daemon doesn't depend
// on @supabase/supabase-js directly. All methods throw CloudError on failure
// with a stable code that the route layer maps to an HTTP status.
//
// Auto-refresh: the SDK manages its own refresh timer when persistSession is
// true, but we run server-side with a custom Storage adapter so we control
// when tokens get persisted. `ensureFreshAccessToken` is called before any
// authenticated call to refresh if expiry is within the safety window.

import { createClient, type Session as SupabaseSession, type SupabaseClient } from '@supabase/supabase-js';
import { CloudError } from './cloud-errors.js';
import type { CloudSessionRow } from './cloud-session.js';

const REFRESH_SAFETY_WINDOW_MS = 60 * 1000; // refresh if <60s to expiry

export interface CloudClientConfig {
  url: string;
  anonKey: string;
}

export interface CloudUserPayload {
  id: string;
  email: string;
  name: string;
}

export class CloudClient {
  private readonly client: SupabaseClient;

  constructor(config: CloudClientConfig) {
    this.client = createClient(config.url, config.anonKey, {
      auth: {
        // Daemon manages its own session persistence in SQLite. The SDK in-memory
        // representation only matters for the current Node process; we always
        // hydrate from our row before authenticated calls.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  async signup(email: string, password: string, name: string): Promise<CloudSessionRow> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) {
      throw mapAuthError(error, { fallback: 'unknown', defaultMessage: 'signup failed' });
    }
    if (!data.session) {
      // Email confirmation is enabled — the user must verify before signin works.
      // Surface as auth_failed so the UI can show "check your inbox".
      throw new CloudError('auth_failed', 'email confirmation required', 'check your inbox to verify the address');
    }
    return sessionFromSupabase(data.session, name);
  }

  async signin(email: string, password: string): Promise<CloudSessionRow> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      throw mapAuthError(error, { fallback: 'auth_failed', defaultMessage: 'signin failed' });
    }
    if (!data.session) {
      throw new CloudError('auth_failed', 'signin returned no session');
    }
    // The Supabase user object carries the auth.users.raw_user_meta_data.name
    // via user.user_metadata. Fall back to email local-part if missing.
    const name = pickName(data.session, email);
    return sessionFromSupabase(data.session, name);
  }

  async signout(accessToken: string): Promise<void> {
    // We can't use the SDK's signOut without a stateful client; instead we POST
    // the logout endpoint directly with the current access token. Failures are
    // swallowed because the local SQLite clear is what actually matters.
    try {
      await fetch(`${this.client['supabaseUrl']}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: this.client['supabaseKey'],
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      // ignore; the local session row will still be cleared by the caller.
    }
  }

  async refresh(refreshToken: string): Promise<CloudSessionRow> {
    const { data, error } = await this.client.auth.refreshSession({ refresh_token: refreshToken });
    if (error) {
      throw mapAuthError(error, { fallback: 'auth_failed', defaultMessage: 'refresh failed' });
    }
    if (!data.session) {
      throw new CloudError('auth_failed', 'refresh returned no session');
    }
    const name = pickName(data.session, data.session.user?.email ?? '');
    return sessionFromSupabase(data.session, name);
  }

  async getCurrentUser(accessToken: string): Promise<CloudUserPayload> {
    const { data, error } = await this.client.auth.getUser(accessToken);
    if (error || !data.user) {
      throw mapAuthError(error, { fallback: 'auth_failed', defaultMessage: 'user lookup failed' });
    }
    return {
      id: data.user.id,
      email: data.user.email ?? '',
      name: pickName({ user: data.user } as SupabaseSession, data.user.email ?? ''),
    };
  }

  /**
   * If the session expires within REFRESH_SAFETY_WINDOW_MS, refresh and return
   * the new row. Otherwise return the input unchanged. Caller persists the
   * returned row when it differs.
   */
  async ensureFreshAccessToken(session: CloudSessionRow): Promise<CloudSessionRow> {
    const msUntilExpiry = session.expiresAt - Date.now();
    if (msUntilExpiry > REFRESH_SAFETY_WINDOW_MS) return session;
    return this.refresh(session.refreshToken);
  }
}

function sessionFromSupabase(session: SupabaseSession, fallbackName: string): CloudSessionRow {
  if (!session.user) {
    throw new CloudError('auth_failed', 'session missing user');
  }
  return {
    userId: session.user.id,
    email: session.user.email ?? '',
    name: pickName(session, fallbackName),
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ? session.expires_at * 1000 : Date.now() + 3600 * 1000,
  };
}

function pickName(session: { user?: { email?: string | null; user_metadata?: Record<string, unknown> } | null }, fallback: string): string {
  const meta = session.user?.user_metadata ?? {};
  const fromMeta = typeof meta['name'] === 'string' ? (meta['name'] as string).trim() : '';
  if (fromMeta) return fromMeta;
  const email = session.user?.email ?? fallback;
  if (email && typeof email === 'string') {
    const local = email.split('@')[0];
    if (local) return local;
  }
  return fallback || 'User';
}

interface AuthErrorLike {
  message?: string | undefined;
  status?: number | undefined;
  code?: string | undefined;
}

function mapAuthError(
  err: AuthErrorLike | null | undefined,
  opts: { fallback: 'auth_failed' | 'unknown'; defaultMessage: string },
): CloudError {
  if (!err) return new CloudError(opts.fallback, opts.defaultMessage);
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  const status = typeof err.status === 'number' ? err.status : undefined;
  if (msg.includes('user already registered') || msg.includes('already exists') || status === 422) {
    if (msg.includes('password') && (msg.includes('weak') || msg.includes('short'))) {
      return new CloudError('weak_password', err.message, err.code);
    }
    if (msg.includes('already')) {
      return new CloudError('email_already_exists', err.message, err.code);
    }
  }
  if (msg.includes('invalid login') || msg.includes('invalid credentials') || status === 400) {
    return new CloudError('auth_failed', err.message, err.code);
  }
  if (msg.includes('rate limit') || status === 429) {
    return new CloudError('rate_limited', err.message, err.code);
  }
  if (msg.includes('network') || msg.includes('fetch failed')) {
    return new CloudError('network_error', err.message, err.code);
  }
  return new CloudError(opts.fallback, err.message ?? opts.defaultMessage, err.code);
}
