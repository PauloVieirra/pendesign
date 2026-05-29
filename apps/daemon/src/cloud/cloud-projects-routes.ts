// Routes for cloud project lifecycle (Phase 1).
//
// All routes are gated behind:
//   1. same-origin (private daemon surface)
//   2. cloud configured (OD_CLOUD_URL + OD_CLOUD_ANON_KEY)
//   3. signed in (cloud_session row exists; access token refreshes on demand)
//
// Uploads/downloads use Supabase Storage; metadata lives in Postgres via
// RLS-checked inserts/selects. The daemon stays the only client-side
// perimeter that holds the session.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import { CloudClient } from './cloud-client.js';
import { readCloudConfig, type CloudConfig } from './cloud-config.js';
import { CloudError } from './cloud-errors.js';
import {
  ensureCloudProjectsSchema,
  getCloudProject,
  listCloudProjects,
  removeCloudProject,
  upsertCloudProject,
  type CloudProjectRow,
} from './cloud-projects.js';
import {
  zipProjectDirectory,
  unzipToDirectory,
  ZipTooLargeError,
} from './cloud-projects-fs.js';
import { getAuthedSupabase } from './cloud-supabase.js';
import { getCloudSession } from './cloud-session.js';

export interface CloudProjectsRouteDeps {
  db: Database;
  http: {
    isLocalSameOrigin: (req: Request, port: number) => boolean;
    resolvedPortRef: { current: number };
  };
  paths: {
    PROJECTS_DIR: string;
    RUNTIME_DATA_DIR: string;
  };
  /** Override for tests so we can inject a stub Supabase client. */
  cloudClientFactory?: (config: Extract<CloudConfig, { enabled: true }>) => CloudClient;
  readConfig?: () => CloudConfig;
}

interface ProjectRowFromBackend {
  id: string;
  owner_id: string;
  name: string;
  current_version: number;
  updated_at: string;
  created_at: string;
}

interface VersionRowFromBackend {
  version_num: number;
  storage_path: string;
  message: string | null;
  size_bytes: number;
  author_id: string;
  proposed_by: string | null;
  created_at: string;
}

export function registerCloudProjectsRoutes(app: Express, deps: CloudProjectsRouteDeps): void {
  const { db, http, paths } = deps;
  const readConfig = deps.readConfig ?? (() => readCloudConfig());
  const cloudClientFactory =
    deps.cloudClientFactory ??
    ((config) => new CloudClient({ url: config.url, anonKey: config.anonKey }));

  ensureCloudProjectsSchema(db);
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
    const cloudClient = cloudClientFactory(config);
    return { config, cloudClient };
  }

  function cloudProjectsDir(): string {
    return path.join(paths.RUNTIME_DATA_DIR, 'cloud-projects');
  }
  function projectLocalDir(cloudProjectId: string): string {
    return path.join(cloudProjectsDir(), cloudProjectId);
  }
  /** Persist the current canonical snapshot zip alongside the working tree.
   * Phase 3 diffing compares against this. Hidden filename (.od-baseline.zip)
   * keeps it out of normal file walks. */
  async function persistBaselineZip(cloudProjectId: string, zipBytes: Uint8Array): Promise<void> {
    const dir = projectLocalDir(cloudProjectId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, '.od-baseline.zip'), zipBytes);
  }

  // -----------------------------------------------------------------------
  // GET /api/cloud/projects — list my cloud projects (joined with local state)
  // -----------------------------------------------------------------------
  app.get('/api/cloud/projects', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { data, error } = await client
        .from('projects')
        .select('id, owner_id, name, current_version, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw new CloudError('unknown', error.message);
      const rows = (data ?? []) as ProjectRowFromBackend[];

      const localById = new Map(listCloudProjects(db).map((p) => [p.projectId, p]));
      const enriched = rows.map((p) => {
        const local = localById.get(p.id);
        return {
          id: p.id,
          name: p.name,
          owner_id: p.owner_id,
          role: local?.role ?? (p.owner_id === ready.config.url ? 'owner' : 'editor'),
          current_version: p.current_version,
          base_version: local?.baseVersion ?? null,
          local_dirty: local?.localDirty ?? false,
          updated_at: p.updated_at,
        };
      });
      res.json({ projects: enriched });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/projects/publish — publish a local project
  //   Body: { local_project_id, name?, message? }
  // -----------------------------------------------------------------------
  app.post('/api/cloud/projects/publish', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const body = req.body as { local_project_id?: unknown; name?: unknown; message?: unknown };
    const localId = typeof body.local_project_id === 'string' ? body.local_project_id.trim() : '';
    if (!localId) {
      res.status(422).json({ error: 'validation_error', details: 'local_project_id required' });
      return;
    }
    const customName = typeof body.name === 'string' ? body.name.trim() : '';
    const message = typeof body.message === 'string' ? body.message.slice(0, 500) : '';

    const localDir = path.join(paths.PROJECTS_DIR, localId);
    let zipResult;
    try {
      zipResult = await zipProjectDirectory(localDir);
    } catch (err) {
      if (err instanceof ZipTooLargeError) {
        res.status(413).json({ error: 'payload_too_large', details: `${err.actualBytes} bytes > ${err.limitBytes}` });
        return;
      }
      respondError(res, err);
      return;
    }

    try {
      const { client, session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);

      const projectName = customName || localId;
      const { data: created, error: insertErr } = await client
        .from('projects')
        .insert({ owner_id: session.userId, name: projectName })
        .select('id, name, current_version, created_at, updated_at')
        .single();
      if (insertErr) throw new CloudError('unknown', insertErr.message);
      const project = created as { id: string; name: string; current_version: number };

      // Upload v1.zip
      const storagePath = `${project.id}/v1.zip`;
      const { error: uploadErr } = await client.storage
        .from('projects')
        .upload(storagePath, zipResult.bytes, { contentType: 'application/zip', upsert: false });
      if (uploadErr) {
        // best-effort rollback
        await client.from('projects').delete().eq('id', project.id);
        throw new CloudError('unknown', `storage upload failed: ${uploadErr.message}`);
      }

      const { error: versionErr } = await client
        .from('project_versions')
        .insert({
          project_id: project.id,
          version_num: 1,
          storage_path: storagePath,
          message: message || 'Initial publish',
          size_bytes: zipResult.bytes.byteLength,
          author_id: session.userId,
        });
      if (versionErr) {
        await client.storage.from('projects').remove([storagePath]).catch(() => {});
        await client.from('projects').delete().eq('id', project.id);
        throw new CloudError('unknown', `version insert failed: ${versionErr.message}`);
      }

      // Update projects.current_version = 1
      await client.from('projects').update({ current_version: 1 }).eq('id', project.id);

      // Track in local SQLite (extract into cloud-projects dir for parity with open).
      const destDir = projectLocalDir(project.id);
      await mkdir(destDir, { recursive: true });
      await unzipToDirectory(zipResult.bytes, destDir, { wipeExisting: true });
      await persistBaselineZip(project.id, zipResult.bytes);
      upsertCloudProject(db, {
        projectId: project.id,
        name: projectName,
        role: 'owner',
        baseVersion: 1,
        pendingProposalId: null,
        localDirty: false,
        lastSyncAt: Date.now(),
      });

      res.json({
        project: {
          id: project.id,
          name: projectName,
          current_version: 1,
          base_version: 1,
          role: 'owner',
        },
      });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cloud/projects/:id — fetch a single project with members
  // -----------------------------------------------------------------------
  app.get('/api/cloud/projects/:id', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const id = req.params.id;
    try {
      const { client, session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { data, error } = await client
        .from('projects')
        .select('id, owner_id, name, current_version, created_at, updated_at')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new CloudError('unknown', error.message);
      if (!data) {
        res.status(404).json({ error: 'project_not_found' });
        return;
      }
      const project = data as ProjectRowFromBackend;
      const local = getCloudProject(db, id);
      res.json({
        project: {
          ...project,
          role: local?.role ?? (project.owner_id === session.userId ? 'owner' : 'editor'),
          base_version: local?.baseVersion ?? null,
        },
      });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/cloud/projects/:id/versions
  // -----------------------------------------------------------------------
  app.get('/api/cloud/projects/:id/versions', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const id = req.params.id;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { data, error } = await client
        .from('project_versions')
        .select('version_num, storage_path, message, size_bytes, author_id, proposed_by, created_at')
        .eq('project_id', id)
        .order('version_num', { ascending: false });
      if (error) throw new CloudError('unknown', error.message);
      res.json({ versions: (data ?? []) as VersionRowFromBackend[] });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/projects/:id/open
  // -----------------------------------------------------------------------
  app.post('/api/cloud/projects/:id/open', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const id = req.params.id;
    try {
      const { client, session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { data: project } = await client
        .from('projects')
        .select('id, owner_id, name, current_version')
        .eq('id', id)
        .maybeSingle();
      if (!project) {
        res.status(404).json({ error: 'project_not_found' });
        return;
      }
      const proj = project as ProjectRowFromBackend;
      if (!proj.current_version) {
        res.status(409).json({ error: 'no_versions_yet' });
        return;
      }
      const { data: version } = await client
        .from('project_versions')
        .select('storage_path, version_num')
        .eq('project_id', id)
        .eq('version_num', proj.current_version)
        .maybeSingle();
      if (!version) {
        res.status(404).json({ error: 'current_version_not_found' });
        return;
      }
      const v = version as VersionRowFromBackend;
      const { data: blob, error: dlErr } = await client.storage.from('projects').download(v.storage_path);
      if (dlErr || !blob) throw new CloudError('unknown', dlErr?.message ?? 'download failed');
      const buf = new Uint8Array(await blob.arrayBuffer());

      const destDir = projectLocalDir(id);
      await mkdir(destDir, { recursive: true });
      await unzipToDirectory(buf, destDir, { wipeExisting: true });
      await persistBaselineZip(id, buf);

      const role: CloudProjectRow['role'] = proj.owner_id === session.userId ? 'owner' : 'editor';
      upsertCloudProject(db, {
        projectId: id,
        name: proj.name,
        role,
        baseVersion: proj.current_version,
        pendingProposalId: null,
        localDirty: false,
        lastSyncAt: Date.now(),
      });

      res.json({ local_path: destDir, base_version: proj.current_version });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/cloud/projects/:id/refresh — pull latest if local is behind
  // -----------------------------------------------------------------------
  app.post('/api/cloud/projects/:id/refresh', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const id = req.params.id;
    try {
      const { client, session } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { data: proj } = await client
        .from('projects')
        .select('current_version, owner_id, name')
        .eq('id', id)
        .maybeSingle();
      if (!proj) {
        res.status(404).json({ error: 'project_not_found' });
        return;
      }
      const local = getCloudProject(db, id);
      const currentVersion = (proj as { current_version: number }).current_version;
      if (local && local.baseVersion === currentVersion) {
        res.json({ current_version: currentVersion, base_version: currentVersion, downloaded: false });
        return;
      }
      // Else download via the open path. Reuse logic.
      const { data: version } = await client
        .from('project_versions')
        .select('storage_path')
        .eq('project_id', id)
        .eq('version_num', currentVersion)
        .maybeSingle();
      if (!version) throw new CloudError('unknown', 'current version row missing');
      const { data: blob, error: dlErr } = await client.storage
        .from('projects')
        .download((version as VersionRowFromBackend).storage_path);
      if (dlErr || !blob) throw new CloudError('unknown', dlErr?.message ?? 'download failed');
      const buf = new Uint8Array(await blob.arrayBuffer());
      const destDir = projectLocalDir(id);
      await mkdir(destDir, { recursive: true });
      await unzipToDirectory(buf, destDir, { wipeExisting: true });
      await persistBaselineZip(id, buf);

      const projObj = proj as ProjectRowFromBackend;
      const role: CloudProjectRow['role'] = projObj.owner_id === session.userId ? 'owner' : 'editor';
      upsertCloudProject(db, {
        projectId: id,
        name: projObj.name,
        role,
        baseVersion: currentVersion,
        pendingProposalId: null,
        localDirty: false,
        lastSyncAt: Date.now(),
      });
      res.json({ current_version: currentVersion, base_version: currentVersion, downloaded: true });
    } catch (err) {
      respondError(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /api/cloud/projects/:id — owner only
  // -----------------------------------------------------------------------
  app.delete('/api/cloud/projects/:id', async (req, res) => {
    const ready = gate(req, res);
    if (!ready) return;
    const id = req.params.id;
    try {
      const { client } = await getAuthedSupabase(ready.config, ready.cloudClient, db);
      const { error } = await client.from('projects').delete().eq('id', id);
      if (error) throw new CloudError('unknown', error.message);
      removeCloudProject(db, id);
      const localDir = projectLocalDir(id);
      await rm(localDir, { recursive: true, force: true });
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
