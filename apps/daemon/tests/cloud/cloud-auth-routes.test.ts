import Database from 'better-sqlite3';
import express, { type Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerCloudAuthRoutes } from '../../src/cloud/cloud-auth-routes.js';
import { CloudError } from '../../src/cloud/cloud-errors.js';
import type { CloudConfig } from '../../src/cloud/cloud-config.js';
import type { CloudSessionRow } from '../../src/cloud/cloud-session.js';
import { getCloudSession, saveCloudSession } from '../../src/cloud/cloud-session.js';

interface ClientCalls {
  signup: Array<{ email: string; password: string; name: string }>;
  signin: Array<{ email: string; password: string }>;
  signout: Array<{ accessToken: string }>;
  refresh: Array<{ refreshToken: string }>;
  getCurrentUser: Array<{ accessToken: string }>;
  ensureFreshAccessToken: Array<{ session: CloudSessionRow }>;
}

interface StubClientBehavior {
  signupResponse?: CloudSessionRow | CloudError;
  signinResponse?: CloudSessionRow | CloudError;
  refreshResponse?: CloudSessionRow | CloudError;
  getCurrentUserResponse?: { id: string; email: string; name: string } | CloudError;
  ensureFreshResponse?: CloudSessionRow | CloudError;
}

class StubCloudClient {
  calls: ClientCalls = {
    signup: [], signin: [], signout: [], refresh: [], getCurrentUser: [],
    ensureFreshAccessToken: [],
  };
  constructor(private behavior: StubClientBehavior = {}) {}
  async signup(email: string, password: string, name: string) {
    this.calls.signup.push({ email, password, name });
    if (this.behavior.signupResponse instanceof CloudError) throw this.behavior.signupResponse;
    if (this.behavior.signupResponse) return this.behavior.signupResponse;
    return defaultSession(email, name);
  }
  async signin(email: string, password: string) {
    this.calls.signin.push({ email, password });
    if (this.behavior.signinResponse instanceof CloudError) throw this.behavior.signinResponse;
    if (this.behavior.signinResponse) return this.behavior.signinResponse;
    return defaultSession(email, 'Bob');
  }
  async signout(accessToken: string) {
    this.calls.signout.push({ accessToken });
  }
  async refresh(refreshToken: string) {
    this.calls.refresh.push({ refreshToken });
    if (this.behavior.refreshResponse instanceof CloudError) throw this.behavior.refreshResponse;
    if (this.behavior.refreshResponse) return this.behavior.refreshResponse;
    return defaultSession('refreshed@example.com', 'Refresh');
  }
  async getCurrentUser(accessToken: string) {
    this.calls.getCurrentUser.push({ accessToken });
    if (this.behavior.getCurrentUserResponse instanceof CloudError) {
      throw this.behavior.getCurrentUserResponse;
    }
    if (this.behavior.getCurrentUserResponse) return this.behavior.getCurrentUserResponse;
    return { id: 'user-stub', email: 'me@example.com', name: 'Me' };
  }
  async ensureFreshAccessToken(session: CloudSessionRow) {
    this.calls.ensureFreshAccessToken.push({ session });
    if (this.behavior.ensureFreshResponse instanceof CloudError) throw this.behavior.ensureFreshResponse;
    if (this.behavior.ensureFreshResponse) return this.behavior.ensureFreshResponse;
    return session;
  }
}

function defaultSession(email: string, name: string): CloudSessionRow {
  return {
    userId: 'user-1',
    email,
    name,
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: Date.now() + 3600 * 1000,
  };
}

const ENABLED_CONFIG: CloudConfig = {
  enabled: true,
  url: 'https://example.supabase.co',
  anonKey: 'sb_publishable_x',
  inviteLandingUrl: 'https://invite.example.com',
};
const DISABLED_CONFIG: CloudConfig = { enabled: false, reason: 'missing_url' };

interface TestApp {
  app: Express;
  db: Database.Database;
  stub: StubCloudClient;
}

function setupApp(opts: {
  config?: CloudConfig;
  behavior?: StubClientBehavior;
  sameOrigin?: boolean;
} = {}): TestApp {
  const config = opts.config ?? ENABLED_CONFIG;
  const stub = new StubCloudClient(opts.behavior ?? {});
  const db = new Database(':memory:');
  const app = express();
  app.use(express.json());
  registerCloudAuthRoutes(app, {
    db,
    http: {
      isLocalSameOrigin: () => opts.sameOrigin ?? true,
      resolvedPortRef: { current: 12345 },
      sendApiError: (res, status, code, message) => {
        res.status(status).json({ error: code, details: message });
      },
    },
    readConfig: () => config,
    cloudFactory: () => (config.enabled ? (stub as unknown as ReturnType<typeof Object.create>) : null),
  });
  return { app, db, stub };
}

async function request(app: Express, method: string, url: string, body?: unknown) {
  return await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = {
      method,
      headers: { 'content-type': 'application/json' },
      body,
    };
    const handler = (app as any)._router?.handle ?? (app as any).handle;
    if (!handler) {
      reject(new Error('no handler'));
      return;
    }
    // Use supertest-style via plain http: spin up a server.
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
        .then(async (res) => {
          const text = await res.text();
          let parsed: any = text;
          try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
          server.close();
          resolve({ status: res.status, body: parsed });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe('cloud-auth-routes', () => {
  let testApp: TestApp | null = null;

  afterEach(() => {
    testApp?.db.close();
    testApp = null;
  });

  describe('GET /api/cloud/auth/status', () => {
    it('returns configured:false when env is unset', async () => {
      testApp = setupApp({ config: DISABLED_CONFIG });
      const res = await request(testApp.app, 'GET', '/api/cloud/auth/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false, signed_in: false, reason: 'missing_url' });
    });

    it('returns configured:true signed_in:false when configured but no session', async () => {
      testApp = setupApp();
      const res = await request(testApp.app, 'GET', '/api/cloud/auth/status');
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.signed_in).toBe(false);
    });

    it('returns signed_in:true and email when session exists', async () => {
      testApp = setupApp();
      saveCloudSession(testApp.db, defaultSession('alice@example.com', 'Alice'));
      const res = await request(testApp.app, 'GET', '/api/cloud/auth/status');
      expect(res.body).toEqual({
        configured: true,
        signed_in: true,
        email: 'alice@example.com',
        name: 'Alice',
      });
    });
  });

  describe('POST /api/cloud/auth/signup', () => {
    it('returns 503 when cloud not configured', async () => {
      testApp = setupApp({ config: DISABLED_CONFIG });
      const res = await request(testApp.app, 'POST', '/api/cloud/auth/signup', {
        email: 'a@b.com', password: 'longenough', name: 'Alice',
      });
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('cloud_not_configured');
    });

    it('returns 422 when email is invalid', async () => {
      testApp = setupApp();
      const res = await request(testApp.app, 'POST', '/api/cloud/auth/signup', {
        email: 'not-email', password: 'longenough', name: 'Alice',
      });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('validation_error');
    });

    it('returns 422 when password is too short', async () => {
      testApp = setupApp();
      const res = await request(testApp.app, 'POST', '/api/cloud/auth/signup', {
        email: 'a@b.com', password: 'short', name: 'Alice',
      });
      expect(res.status).toBe(422);
    });

    it('on success: persists session and returns user', async () => {
      testApp = setupApp();
      const res = await request(testApp.app, 'POST', '/api/cloud/auth/signup', {
        email: 'a@b.com', password: 'longenough', name: 'Alice',
      });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('a@b.com');
      expect(getCloudSession(testApp.db)).not.toBeNull();
    });

    it('returns 409 when email already exists', async () => {
      testApp = setupApp({
        behavior: { signupResponse: new CloudError('email_already_exists', 'taken') },
      });
      const res = await request(testApp.app, 'POST', '/api/cloud/auth/signup', {
        email: 'a@b.com', password: 'longenough', name: 'Alice',
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('email_already_exists');
    });
  });

  describe('POST /api/cloud/auth/signin', () => {
    it('on success: persists session', async () => {
      testApp = setupApp();
      const res = await request(testApp.app, 'POST', '/api/cloud/auth/signin', {
        email: 'a@b.com', password: 'any',
      });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('a@b.com');
      expect(getCloudSession(testApp.db)).not.toBeNull();
    });

    it('returns 401 on bad credentials', async () => {
      testApp = setupApp({
        behavior: { signinResponse: new CloudError('auth_failed', 'bad creds') },
      });
      const res = await request(testApp.app, 'POST', '/api/cloud/auth/signin', {
        email: 'a@b.com', password: 'wrong',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/cloud/auth/signout', () => {
    it('clears the session and returns 204', async () => {
      testApp = setupApp();
      saveCloudSession(testApp.db, defaultSession('a@b.com', 'A'));
      const res = await request(testApp.app, 'POST', '/api/cloud/auth/signout');
      expect(res.status).toBe(204);
      expect(getCloudSession(testApp.db)).toBeNull();
    });

    it('returns 204 even when no session existed (idempotent)', async () => {
      testApp = setupApp();
      const res = await request(testApp.app, 'POST', '/api/cloud/auth/signout');
      expect(res.status).toBe(204);
    });
  });

  describe('GET /api/cloud/auth/me', () => {
    it('returns 401 when no session', async () => {
      testApp = setupApp();
      const res = await request(testApp.app, 'GET', '/api/cloud/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('not_signed_in');
    });

    it('returns user when session is valid', async () => {
      testApp = setupApp();
      saveCloudSession(testApp.db, defaultSession('me@example.com', 'Me'));
      const res = await request(testApp.app, 'GET', '/api/cloud/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('me@example.com');
    });

    it('clears session when refresh fails with auth_failed', async () => {
      testApp = setupApp({
        behavior: { ensureFreshResponse: new CloudError('auth_failed', 'expired') },
      });
      saveCloudSession(testApp.db, defaultSession('me@example.com', 'Me'));
      const res = await request(testApp.app, 'GET', '/api/cloud/auth/me');
      expect(res.status).toBe(401);
      expect(getCloudSession(testApp.db)).toBeNull();
    });
  });

  describe('cross-origin', () => {
    it('rejects non-same-origin requests with 403', async () => {
      testApp = setupApp({ sameOrigin: false });
      const res = await request(testApp.app, 'GET', '/api/cloud/auth/status');
      expect(res.status).toBe(403);
    });
  });
});
