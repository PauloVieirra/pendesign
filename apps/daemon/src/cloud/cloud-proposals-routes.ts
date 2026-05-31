// Phase 3 — change proposal routes.
//
// Editor submits proposals (zip of changed files + manifest). Owner approves
// via the Edge Function `approve-proposal` (heavy merge logic) or rejects via
// the `reject_proposal` Postgres RPC.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import { CloudClient } from './cloud-client.js';
import { readCloudConfig, type CloudConfig } from './cloud-config.js';
import { CloudError } from './cloud-errors.js';
import { buildProposalPayload } from './cloud-proposals-diff.js';
import { getCloudProject, upsertCloudProject } from './cloud-projects.js';
import { getAuthedSupabase } from './cloud-supabase.js';
import { getCloudSession } from './cloud-session.js';

export interface CloudProposalsRouteDeps {
  db: Database;
  http: {
    isLocalSameOrigin: (req: Request, port: number) => boolean;
    resolvedPortRef: { current: number };
  };
  paths: { RUNTIME_DATA_DIR: string };
  cloudClientFactory?: (config: Extract<CloudConfig, { enabled: true }>) => CloudClient;
  readConfig?: () => CloudConfig;
}

export function registerCloudProposalsRoutes(app: Express, deps: CloudProposalsRouteDeps): void {
  const { db, http, paths } = deps;
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

  function projectLocalDir(cloudProjectId: string): string {
    return path.join(paths.RUNTIME_DATA_DIR, 'cloud-projects', cloudProjectId);
  }

  // -----------------------------------------------------------------------
  // POST /api/cloud/projects/:id/proposals/submit
  // -----------------------------------------------------------------------
  app.post('/api/cloud/projects/:id/proposals/submit', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const projectId = req.params.id;
    const message = typeof req.body?.message === 'string' ? req.body.message.slice(0, 500) : '';

    const local = getCloudProject(db, projectId);
    if (!local) {
      res.status(404).json({ error: 'project_not_open_locally' });
      return;
    }
    if (local.baseVersion == null) {
      res.status(409).json({ error: 'no_baseline', details: 'open the project first to download base version' });
      return;
    }

    try {
      const { client, session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);

      // Pre-flight stale check via RPC.
      const { data: prepareResult, error: prepErr } = await client.rpc('submit_proposal_prepare', {
        p_project_id: projectId,
        p_base_version: local.baseVersion,
      });
      if (prepErr) throw new CloudError('unknown', prepErr.message);
      const prep = prepareResult as { stale: boolean; current_version: number };
      if (prep.stale) {
        res.status(409).json({
          error: 'stale_base_version',
          your_base_version: local.baseVersion,
          current_version: prep.current_version,
        });
        return;
      }

      // Build payload from working tree.
      const workingDir = projectLocalDir(projectId);
      const baselineZipPath = path.join(workingDir, '.od-baseline.zip');
      let baselineBytes: Uint8Array;
      try {
        baselineBytes = new Uint8Array(await readFile(baselineZipPath));
      } catch {
        res.status(409).json({ error: 'no_baseline_zip', details: 'baseline file is missing — re-open the project' });
        return;
      }

      let diff;
      try {
        diff = await buildProposalPayload(workingDir, baselineBytes, local.baseVersion);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'no_changes_to_propose') {
          res.status(409).json({ error: 'no_changes_to_propose' });
          return;
        }
        throw err;
      }

      // Insert proposal row (RLS-checked).
      const { data: proposal, error: insertErr } = await client
        .from('change_proposals')
        .insert({
          project_id: projectId,
          submitter_id: session.userId,
          base_version: local.baseVersion,
          storage_path: 'PENDING_UPLOAD',
          message: message || null,
        })
        .select('id')
        .single();
      if (insertErr || !proposal) throw new CloudError('unknown', insertErr?.message ?? 'insert failed');
      const proposalId = (proposal as { id: string }).id;

      // Upload payload zip.
      const storagePath = `${proposalId}/payload.zip`;
      const { error: uploadErr } = await client.storage
        .from('proposals')
        .upload(storagePath, diff.payloadZip, { contentType: 'application/zip', upsert: false });
      if (uploadErr) {
        // Roll back the row.
        await client.from('change_proposals').delete().eq('id', proposalId);
        throw new CloudError('unknown', `payload upload failed: ${uploadErr.message}`);
      }

      // Persist storage_path on the row.
      const { error: updateErr } = await client
        .from('change_proposals')
        .update({ storage_path: storagePath })
        .eq('id', proposalId);
      if (updateErr) {
        console.warn('[cloud-proposals] proposal row created but storage_path update failed:', updateErr.message);
      }

      // Track locally.
      upsertCloudProject(db, { ...local, pendingProposalId: proposalId, lastSyncAt: Date.now() });

      res.json({
        proposal_id: proposalId,
        status: 'pending',
        files_changed: diff.manifest.files_changed.length,
      });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cloud/projects/:id/proposals
  // -----------------------------------------------------------------------
  app.get('/api/cloud/projects/:id/proposals', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      let query = client
        .from('change_proposals')
        .select('id, submitter_id, base_version, status, message, created_at, reviewed_at, reviewed_by, reviewer_message')
        .eq('project_id', req.params.id)
        .order('created_at', { ascending: false });
      if (typeof req.query.status === 'string') {
        query = query.eq('status', req.query.status);
      }
      const { data, error } = await query;
      if (error) throw new CloudError('unknown', error.message);
      res.json({ proposals: data ?? [] });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cloud/proposals/:id  (with manifest + files_changed)
  // -----------------------------------------------------------------------
  app.get('/api/cloud/proposals/:id', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { data, error } = await client
        .from('change_proposals')
        .select('id, project_id, submitter_id, base_version, storage_path, status, message, created_at, reviewed_at, reviewed_by, reviewer_message')
        .eq('id', req.params.id)
        .maybeSingle();
      if (error) throw new CloudError('unknown', error.message);
      if (!data) {
        res.status(404).json({ error: 'proposal_not_found' });
        return;
      }
      const proposal = data as {
        id: string;
        project_id: string;
        storage_path: string;
      } & Record<string, unknown>;

      // Download manifest from payload zip for diff view.
      let filesChanged: Array<{ path: string; action: string }> = [];
      try {
        const { data: blob } = await client.storage.from('proposals').download(proposal.storage_path);
        if (blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          const { default: JSZip } = await import('jszip');
          const zip = await JSZip.loadAsync(buf);
          const manifestEntry = zip.file('manifest.json');
          if (manifestEntry) {
            const text = await manifestEntry.async('text');
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed.files_changed)) filesChanged = parsed.files_changed;
          }
        }
      } catch {
        // If manifest extraction fails, return the proposal without diff.
      }

      res.json({ proposal: { ...proposal, files_changed: filesChanged } });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/proposals/:id/approve — calls Edge Function
  // -----------------------------------------------------------------------
  app.post('/api/cloud/proposals/:id/approve', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const message = typeof req.body?.message === 'string' ? req.body.message.slice(0, 500) : '';
    try {
      const { session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const url = `${ready.config.url.replace(/\/$/, '')}/functions/v1/approve-proposal`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          apikey: ready.config.anonKey,
        },
        body: JSON.stringify({ proposal_id: req.params.id, message }),
      });
      const text = await resp.text();
      let body: unknown = text;
      if (text) {
        try { body = JSON.parse(text); } catch { /* keep text */ }
      }
      res.status(resp.status).json(body);
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/proposals/:id/reject — calls reject_proposal RPC
  // -----------------------------------------------------------------------
  app.post('/api/cloud/proposals/:id/reject', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const message = typeof req.body?.message === 'string' ? req.body.message.slice(0, 500) : '';
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { error } = await client.rpc('reject_proposal', {
        p_proposal_id: req.params.id,
        p_reviewer_message: message || null,
      });
      if (error) {
        if (error.message?.toLowerCase().includes('forbidden')) {
          res.status(403).json({ error: 'forbidden', details: error.message });
        } else if (error.message?.toLowerCase().includes('not_found')) {
          res.status(404).json({ error: 'proposal_not_found' });
        } else if (error.message?.toLowerCase().includes('not_pending')) {
          res.status(409).json({ error: 'proposal_not_pending', details: error.message });
        } else {
          throw new CloudError('unknown', error.message);
        }
        return;
      }
      res.status(204).end();
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
