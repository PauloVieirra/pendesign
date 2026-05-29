// Express handlers for /api/cloud/auth/*.
//
// All routes are private to the local machine (same-origin enforced). Cloud
// being unconfigured is not a failure: /status reports it cleanly, and the
// other routes return 503 with `cloud_not_configured` so the UI can hide
// itself instead of crashing.

import type { Express, Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import { CloudClient } from './cloud-client.js';
import { readCloudConfig, type CloudConfig } from './cloud-config.js';
import { CloudError } from './cloud-errors.js';
import {
  clearCloudSession,
  ensureCloudSessionSchema,
  getCloudSession,
  saveCloudSession,
} from './cloud-session.js';

export interface CloudAuthRouteDeps {
  db: Database;
  http: {
    isLocalSameOrigin: (req: Request, port: number) => boolean;
    resolvedPortRef: { current: number };
    sendApiError: (res: Response, status: number, code: string, message: string) => void;
  };
  /** Override for tests so we can inject a stubbed CloudClient + config. */
  cloudFactory?: (config: CloudConfig) => CloudClient | null;
  /** Override for tests; default reads process.env. */
  readConfig?: () => CloudConfig;
}

interface SignupBody { email?: unknown; password?: unknown; name?: unknown }
interface SigninBody { email?: unknown; password?: unknown }

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function registerCloudAuthRoutes(app: Express, deps: CloudAuthRouteDeps): void {
  const { db, http } = deps;
  const readConfig = deps.readConfig ?? (() => readCloudConfig());
  const cloudFactory =
    deps.cloudFactory ??
    ((config: CloudConfig) =>
      config.enabled ? new CloudClient({ url: config.url, anonKey: config.anonKey }) : null);

  ensureCloudSessionSchema(db);

  const getResolvedPort = () => http.resolvedPortRef.current;

  function requireSameOrigin(req: Request, res: Response): boolean {
    if (!http.isLocalSameOrigin(req, getResolvedPort())) {
      res.status(403).json({ error: 'cross-origin request rejected' });
      return false;
    }
    return true;
  }

  function getEnabledClient(res: Response): { client: CloudClient; config: Extract<CloudConfig, { enabled: true }> } | null {
    const config = readConfig();
    if (!config.enabled) {
      res.status(503).json({ error: 'cloud_not_configured', details: config.reason });
      return null;
    }
    const client = cloudFactory(config);
    if (!client) {
      res.status(503).json({ error: 'cloud_not_configured', details: 'cloud factory returned null' });
      return null;
    }
    return { client, config };
  }

  app.get('/api/cloud/auth/status', (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const config = readConfig();
    if (!config.enabled) {
      res.json({ configured: false, signed_in: false, reason: config.reason });
      return;
    }
    const session = getCloudSession(db);
    res.json({
      configured: true,
      signed_in: !!session,
      email: session?.email ?? null,
      name: session?.name ?? null,
    });
  });

  app.post('/api/cloud/auth/signup', async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const ready = getEnabledClient(res);
    if (!ready) return;
    const { email, password, name } = parseSignup(req.body as SignupBody);
    if (!email || !password || !name) {
      res.status(422).json({ error: 'validation_error', details: 'email, password, and name are required' });
      return;
    }
    try {
      const session = await ready.client.signup(email, password, name);
      saveCloudSession(db, session);
      res.json({ user: publicUser(session) });
    } catch (err) {
      respondError(res, err);
    }
  });

  app.post('/api/cloud/auth/signin', async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const ready = getEnabledClient(res);
    if (!ready) return;
    const { email, password } = parseSignin(req.body as SigninBody);
    if (!email || !password) {
      res.status(422).json({ error: 'validation_error', details: 'email and password are required' });
      return;
    }
    try {
      const session = await ready.client.signin(email, password);
      saveCloudSession(db, session);
      res.json({ user: publicUser(session) });
    } catch (err) {
      respondError(res, err);
    }
  });

  app.post('/api/cloud/auth/signout', async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const ready = getEnabledClient(res);
    if (!ready) return;
    const session = getCloudSession(db);
    if (session) {
      await ready.client.signout(session.accessToken);
      clearCloudSession(db);
    }
    res.status(204).end();
  });

  app.get('/api/cloud/auth/me', async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const ready = getEnabledClient(res);
    if (!ready) return;
    const session = getCloudSession(db);
    if (!session) {
      res.status(401).json({ error: 'not_signed_in' });
      return;
    }
    try {
      const fresh = await ready.client.ensureFreshAccessToken(session);
      if (fresh.accessToken !== session.accessToken) saveCloudSession(db, fresh);
      const user = await ready.client.getCurrentUser(fresh.accessToken);
      res.json({ configured: true, user });
    } catch (err) {
      if (err instanceof CloudError && err.code === 'auth_failed') {
        clearCloudSession(db);
      }
      respondError(res, err);
    }
  });
}

function parseSignup(body: SignupBody): { email: string; password: string; name: string } {
  return {
    email: validEmail(body.email),
    password: validString(body.password, 8),
    name: validString(body.name, 1, 120),
  };
}

function parseSignin(body: SigninBody): { email: string; password: string } {
  return {
    email: validEmail(body.email),
    password: validString(body.password, 1),
  };
}

function validEmail(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(trimmed) ? trimmed : '';
}

function validString(value: unknown, minLength: number, maxLength = 1000): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) return '';
  return trimmed;
}

function publicUser(session: { userId: string; email: string; name: string }): {
  id: string;
  email: string;
  name: string;
} {
  return { id: session.userId, email: session.email, name: session.name };
}

function respondError(res: Response, err: unknown): void {
  if (err instanceof CloudError) {
    res.status(err.httpStatus).json(err.toJSON());
    return;
  }
  const message = err instanceof Error ? err.message : 'unknown error';
  res.status(500).json({ error: 'unknown', details: message });
}
