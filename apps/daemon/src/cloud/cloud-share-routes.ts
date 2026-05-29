// Phase 2 — sharing + invitations.
//
// Routes for managing members on a cloud project and the email-invitation
// lifecycle. The actual email send is offloaded to the `send-invitation-email`
// Supabase Edge Function (which calls Resend). Accept-by-token also routes
// through an Edge Function so token + JWT email match validation happens
// server-side.

import { randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import { CloudClient } from './cloud-client.js';
import { readCloudConfig, type CloudConfig } from './cloud-config.js';
import { CloudError } from './cloud-errors.js';
import { getAuthedSupabase } from './cloud-supabase.js';
import { getCloudSession } from './cloud-session.js';
import { upsertCloudProject } from './cloud-projects.js';

export interface CloudShareRouteDeps {
  db: Database;
  http: {
    isLocalSameOrigin: (req: Request, port: number) => boolean;
    resolvedPortRef: { current: number };
  };
  cloudClientFactory?: (config: Extract<CloudConfig, { enabled: true }>) => CloudClient;
  readConfig?: () => CloudConfig;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface CreatedInvitationRow {
  id: string;
  email: string;
  role: 'editor' | 'viewer';
  token: string;
  expires_at: string;
}

export function registerCloudShareRoutes(app: Express, deps: CloudShareRouteDeps): void {
  const { db, http } = deps;
  const readConfig = deps.readConfig ?? (() => readCloudConfig());
  const cloudClientFactory =
    deps.cloudClientFactory ??
    ((config) => new CloudClient({ url: config.url, anonKey: config.anonKey }));

  const getResolvedPort = () => http.resolvedPortRef.current;

  function gate(req: Request, res: Response): { config: Extract<CloudConfig, { enabled: true }>; cloudClient: CloudClient } | null {
    if (!http.isLocalSameOrigin(req, getResolvedPort())) {
      res.status(403).json({ error: 'cross-origin request rejected' });
      return null;
    }
    const config = readConfig();
    if (!config.enabled) {
      res.status(503).json({ error: 'cloud_not_configured', details: config.reason });
      return null;
    }
    const session = getCloudSession(db);
    if (!session) {
      res.status(401).json({ error: 'not_signed_in' });
      return null;
    }
    return { config, cloudClient: cloudClientFactory(config) };
  }

  // -----------------------------------------------------------------------
  // GET /api/cloud/projects/:id/members
  // -----------------------------------------------------------------------
  app.get('/api/cloud/projects/:id/members', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { data, error } = await client
        .from('project_members')
        .select('user_id, role, invited_at, accepted_at, profile:profiles!project_members_user_id_fkey(name, avatar_url)')
        .eq('project_id', req.params.id);
      if (error) throw new CloudError('unknown', error.message);
      const members = (data ?? []).map((row: any) => ({
        user_id: row.user_id,
        role: row.role,
        name: row.profile?.name ?? null,
        avatar_url: row.profile?.avatar_url ?? null,
        invited_at: row.invited_at,
        accepted_at: row.accepted_at,
      }));
      res.json({ members });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/projects/:id/invitations
  // -----------------------------------------------------------------------
  app.post('/api/cloud/projects/:id/invitations', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const body = req.body as { email?: unknown; role?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = typeof body.role === 'string' ? body.role : '';
    if (!EMAIL_PATTERN.test(email)) {
      res.status(422).json({ error: 'validation_error', details: 'invalid email' });
      return;
    }
    if (role !== 'editor' && role !== 'viewer') {
      res.status(422).json({ error: 'validation_error', details: 'role must be editor or viewer' });
      return;
    }
    try {
      const { client, session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const token = randomBytes(24).toString('base64url');
      const { data, error } = await client
        .from('project_invitations')
        .insert({
          project_id: req.params.id,
          email,
          role,
          token,
          created_by: session.userId,
        })
        .select('id, email, role, token, expires_at')
        .single();
      if (error) throw new CloudError('unknown', error.message);
      const inv = data as CreatedInvitationRow;

      // Fire-and-forget email send (don't block on email failures — the
      // invitation row exists and the user can re-trigger).
      try {
        await callEdgeFunction(ready.config, session.accessToken, 'send-invitation-email', {
          invitation_id: inv.id,
        });
      } catch {
        // log via console.warn; routes are noisy by design
        console.warn('[cloud-share] send-invitation-email call failed (invitation row exists)');
      }

      res.json({
        invitation: {
          id: inv.id,
          email: inv.email,
          role: inv.role,
          expires_at: inv.expires_at,
        },
      });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /api/cloud/projects/:id/invitations/:invitationId
  // -----------------------------------------------------------------------
  app.delete('/api/cloud/projects/:id/invitations/:invitationId', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { error } = await client
        .from('project_invitations')
        .delete()
        .eq('id', req.params.invitationId)
        .eq('project_id', req.params.id);
      if (error) throw new CloudError('unknown', error.message);
      res.status(204).end();
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cloud/invitations/pending — invitations addressed to me
  // -----------------------------------------------------------------------
  app.get('/api/cloud/invitations/pending', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client, session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { data, error } = await client
        .from('project_invitations')
        .select('id, project_id, role, expires_at, created_at, project:projects(name), inviter:profiles!project_invitations_created_by_fkey(name)')
        .is('accepted_at', null)
        .is('declined_at', null)
        .eq('email', session.email);
      if (error) throw new CloudError('unknown', error.message);
      const list = (data ?? []).map((row: any) => ({
        id: row.id,
        project_id: row.project_id,
        project_name: row.project?.name ?? null,
        role: row.role,
        expires_at: row.expires_at,
        created_at: row.created_at,
        inviter_name: row.inviter?.name ?? null,
      }));
      res.json({ invitations: list });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/invitations/:id/accept
  // -----------------------------------------------------------------------
  app.post('/api/cloud/invitations/:id/accept', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client, session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      // Look up the invitation to get its token; the Edge Function expects the token
      // (it validates token + email match in one shot).
      const { data, error } = await client
        .from('project_invitations')
        .select('token')
        .eq('id', req.params.id)
        .maybeSingle();
      if (error || !data) {
        res.status(404).json({ error: 'invitation_not_found' });
        return;
      }
      const result = await callEdgeFunction(ready.config, session.accessToken, 'accept-by-token', {
        token: (data as { token: string }).token,
      });
      if (!result.ok) {
        res.status(result.status).json(result.body);
        return;
      }
      const projectId = (result.body as { project_id: string }).project_id;
      // Track in local cloud_projects so the row appears immediately.
      const { data: project } = await client
        .from('projects')
        .select('name, current_version')
        .eq('id', projectId)
        .maybeSingle();
      const { data: membership } = await client
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', session.userId)
        .maybeSingle();
      upsertCloudProject(db, {
        projectId,
        name: (project as { name?: string } | null)?.name ?? '(unknown)',
        role: ((membership as { role?: 'editor' | 'viewer' } | null)?.role) ?? 'editor',
        baseVersion: null,
        pendingProposalId: null,
        localDirty: false,
        lastSyncAt: Date.now(),
      });
      res.json({ project_id: projectId });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/invitations/:id/decline
  // -----------------------------------------------------------------------
  app.post('/api/cloud/invitations/:id/decline', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { error } = await client
        .from('project_invitations')
        .update({ declined_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (error) throw new CloudError('unknown', error.message);
      res.status(204).end();
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/invitations/accept-by-token — deep-link entrypoint
  // -----------------------------------------------------------------------
  app.post('/api/cloud/invitations/accept-by-token', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) {
      res.status(422).json({ error: 'validation_error', details: 'token required' });
      return;
    }
    try {
      const { session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const result = await callEdgeFunction(ready.config, session.accessToken, 'accept-by-token', {
        token,
      });
      if (!result.ok) {
        res.status(result.status).json(result.body);
        return;
      }
      const projectId = (result.body as { project_id: string }).project_id;
      // Lazily track in local cloud_projects (member upsert happens next time
      // `od cloud projects list` runs and the row syncs).
      res.json({ project_id: projectId });
    } catch (err) {
      respondError(res, err);
    }
  });
}

async function callEdgeFunction(
  config: Extract<CloudConfig, { enabled: true }>,
  accessToken: string,
  fnName: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${config.url.replace(/\/$/, '')}/functions/v1/${fnName}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: config.anonKey,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: unknown = text;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
  }
  return { ok: resp.ok, status: resp.status, body: parsed };
}

function respondError(res: Response, err: unknown): void {
  if (err instanceof CloudError) {
    res.status(err.httpStatus).json(err.toJSON());
    return;
  }
  const message = err instanceof Error ? err.message : 'unknown error';
  res.status(500).json({ error: 'unknown', details: message });
}
