// Phase 4 — notifications inbox + proposal comments.
//
// All reads are RLS-checked at the Postgres layer; the daemon is a thin pipe.

import type { Express, Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import { CloudClient } from './cloud-client.js';
import { readCloudConfig, type CloudConfig } from './cloud-config.js';
import { CloudError } from './cloud-errors.js';
import { getAuthedSupabase } from './cloud-supabase.js';
import { getCloudSession } from './cloud-session.js';

export interface CloudNotificationsRouteDeps {
  db: Database;
  http: {
    isLocalSameOrigin: (req: Request, port: number) => boolean;
    resolvedPortRef: { current: number };
  };
  cloudClientFactory?: (config: Extract<CloudConfig, { enabled: true }>) => CloudClient;
  readConfig?: () => CloudConfig;
}

export function registerCloudNotificationsRoutes(
  app: Express,
  deps: CloudNotificationsRouteDeps,
): void {
  const { db, http } = deps;
  const readConfig = deps.readConfig ?? (() => readCloudConfig());
  const cloudClientFactory =
    deps.cloudClientFactory ??
    ((config) => new CloudClient({ url: config.url, anonKey: config.anonKey }));

  function gate(req: Request, res: Response): {
    config: Extract<CloudConfig, { enabled: true }>;
    cloudClient: CloudClient;
  } | null {
    if (!http.isLocalSameOrigin(req, http.resolvedPortRef.current)) {
      res.status(403).json({ error: 'cross-origin request rejected' });
      return null;
    }
    const config = readConfig();
    if (!config.enabled) {
      res.status(503).json({ error: 'cloud_not_configured', details: config.reason });
      return null;
    }
    if (!getCloudSession(db)) {
      res.status(401).json({ error: 'not_signed_in' });
      return null;
    }
    return { config, cloudClient: cloudClientFactory(config) };
  }

  // -----------------------------------------------------------------------
  // GET /api/cloud/notifications
  // -----------------------------------------------------------------------
  app.get('/api/cloud/notifications', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const unreadOnly = req.query.unread_only === '1' || req.query.unread_only === 'true';
      const limitRaw = Number(req.query.limit ?? 50);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
      const before = typeof req.query.before === 'string' ? req.query.before : null;

      let query = client
        .from('notifications')
        .select('id, type, payload, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (unreadOnly) query = query.is('read_at', null);
      if (before) query = query.lt('created_at', before);
      const { data, error } = await query;
      if (error) throw new CloudError('unknown', error.message);

      const notifications = (data ?? []) as Array<{ created_at: string }>;
      const cursor = notifications.length === limit ? notifications[notifications.length - 1]?.created_at : null;
      res.json({ notifications, cursor });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cloud/notifications/unread-count
  // -----------------------------------------------------------------------
  app.get('/api/cloud/notifications/unread-count', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { count, error } = await client
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (error) throw new CloudError('unknown', error.message);
      res.json({ count: count ?? 0 });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // PATCH /api/cloud/notifications/:id/read
  // -----------------------------------------------------------------------
  app.patch('/api/cloud/notifications/:id/read', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { error } = await client
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .is('read_at', null);
      if (error) throw new CloudError('unknown', error.message);
      res.status(204).end();
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/notifications/mark-all-read
  // -----------------------------------------------------------------------
  app.post('/api/cloud/notifications/mark-all-read', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client, session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { error, count } = await client
        .from('notifications')
        .update({ read_at: new Date().toISOString() }, { count: 'exact' })
        .eq('user_id', session.userId)
        .is('read_at', null);
      if (error) throw new CloudError('unknown', error.message);
      res.json({ updated_count: count ?? 0 });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cloud/proposals/:id/comments
  // -----------------------------------------------------------------------
  app.get('/api/cloud/proposals/:id/comments', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { data, error } = await client
        .from('proposal_comments')
        .select('id, author_id, body, created_at, edited_at, author:profiles!proposal_comments_author_id_fkey(name, avatar_url)')
        .eq('proposal_id', req.params.id)
        .order('created_at', { ascending: true });
      if (error) throw new CloudError('unknown', error.message);
      const comments = (data ?? []).map((row: any) => ({
        id: row.id,
        author_id: row.author_id,
        author_name: row.author?.name ?? null,
        avatar_url: row.author?.avatar_url ?? null,
        body: row.body,
        created_at: row.created_at,
        edited_at: row.edited_at,
      }));
      res.json({ comments });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/proposals/:id/comments
  // -----------------------------------------------------------------------
  app.post('/api/cloud/proposals/:id/comments', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body || body.length > 8000) {
      res.status(422).json({ error: 'validation_error', details: 'body must be 1-8000 chars' });
      return;
    }
    try {
      const { client, session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { data, error } = await client
        .from('proposal_comments')
        .insert({
          proposal_id: req.params.id,
          author_id: session.userId,
          body,
        })
        .select('id, body, created_at, author_id')
        .single();
      if (error) throw new CloudError('unknown', error.message);
      res.json({ comment: data });
    } catch (err) {
      respondError(res, err);
    }
  });
}

function respondError(res: Response, err: unknown): void {
  if (err instanceof CloudError) {
    res.status(err.httpStatus).json(err.toJSON());
    return;
  }
  const message = err instanceof Error ? err.message : 'unknown error';
  res.status(500).json({ error: 'unknown', details: message });
}
