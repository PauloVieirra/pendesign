// ============================================================================
// approve-proposal
//
// Heavy lifting for approving a Change Proposal:
//   1. Authenticate caller; verify they own the project.
//   2. Download base_version snapshot zip + proposal payload zip.
//   3. Merge: apply payload's manifest (modified/added/deleted) onto base tree.
//   4. Zip the result; upload to projects/{project_id}/v{base+1}.zip.
//   5. Call RPC approve_proposal_commit to commit DB changes atomically:
//      - INSERT project_versions, UPDATE projects.current_version,
//        UPDATE proposal status, mark other pendings stale.
//   6. On RPC failure, delete the uploaded zip (best-effort).
//
// Body: { proposal_id: string, message?: string }
// Auth: requires JWT (verify_jwt = true in config.toml).
//
// Limits: payload + base zip + merged tree must fit in memory (Edge Function
// limit ~150MB). MVP cap is 100MB per project; tighter caps live in the daemon
// upload guard. For very large projects, a future optimization streams files
// from a single zip rather than reading both into memory.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3';

interface RequestBody { proposal_id: string; message?: string }

interface ProposalRow {
  id: string;
  project_id: string;
  submitter_id: string;
  base_version: number;
  storage_path: string;
  status: string;
}

interface ProjectRow {
  id: string;
  current_version: number;
}

interface VersionRow {
  storage_path: string;
}

interface ProposalManifest {
  base_version: number;
  files_changed: Array<{
    path: string;
    action: 'modified' | 'added' | 'deleted';
  }>;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !ANON || !SERVICE_ROLE) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'missing_bearer_token' }, 401);

  let body: RequestBody;
  try { body = (await req.json()) as RequestBody; }
  catch { return json({ error: 'invalid_json' }, 400); }
  if (!body.proposal_id) return json({ error: 'proposal_id_required' }, 400);

  // 1. Authenticate.
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) return json({ error: 'unauthenticated' }, 401);
  const callerId = userRes.user.id;

  // Service-role client for storage + RPC (needs to bypass storage RLS on write).
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 2. Fetch proposal + project + base version metadata.
  const { data: proposal } = await admin
    .from('change_proposals')
    .select('id, project_id, submitter_id, base_version, storage_path, status')
    .eq('id', body.proposal_id)
    .maybeSingle<ProposalRow>();
  if (!proposal) return json({ error: 'proposal_not_found' }, 404);
  if (proposal.status !== 'pending') {
    return json({ error: 'proposal_not_pending', current_status: proposal.status }, 409);
  }

  const { data: project } = await admin
    .from('projects')
    .select('id, current_version, owner_id')
    .eq('id', proposal.project_id)
    .maybeSingle<ProjectRow & { owner_id: string }>();
  if (!project) return json({ error: 'project_not_found' }, 404);
  if (project.owner_id !== callerId) return json({ error: 'forbidden_not_owner' }, 403);

  if (proposal.base_version !== project.current_version) {
    // Mark stale via RPC so the DB stays consistent (the RPC handles that
    // path internally — pass through and it will RAISE EXCEPTION).
    await admin.rpc('approve_proposal_commit', {
      p_proposal_id: proposal.id,
      p_reviewer_message: body.message ?? 'Base version stale',
      p_storage_path: '',
      p_size_bytes: 0,
    });
    return json({ error: 'stale_base_version', current_version: project.current_version }, 409);
  }

  const { data: baseVersion } = await admin
    .from('project_versions')
    .select('storage_path')
    .eq('project_id', proposal.project_id)
    .eq('version_num', proposal.base_version)
    .maybeSingle<VersionRow>();
  if (!baseVersion) return json({ error: 'base_version_not_found' }, 500);

  // 3. Download base + payload.
  const baseZipBytes = await downloadStorageObject(admin, 'projects', baseVersion.storage_path);
  if (!baseZipBytes) return json({ error: 'base_zip_download_failed' }, 502);
  const payloadZipBytes = await downloadStorageObject(admin, 'proposals', proposal.storage_path);
  if (!payloadZipBytes) return json({ error: 'payload_zip_download_failed' }, 502);

  let merged: Uint8Array;
  let mergedSize: number;
  try {
    const result = await mergeProposalOntoBase(baseZipBytes, payloadZipBytes);
    merged = result.bytes;
    mergedSize = merged.byteLength;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: 'merge_failed', details: message }, 500);
  }

  // 4. Upload merged zip to projects/{project_id}/v{base+1}.zip.
  const newVersion = proposal.base_version + 1;
  const newStoragePath = `${proposal.project_id}/v${newVersion}.zip`;
  const { error: uploadErr } = await admin.storage
    .from('projects')
    .upload(newStoragePath, merged, {
      contentType: 'application/zip',
      upsert: false,
    });
  if (uploadErr) {
    return json({ error: 'upload_failed', details: uploadErr.message }, 502);
  }

  // 5. Commit DB transaction via RPC.
  const { data: rpcData, error: rpcErr } = await admin.rpc('approve_proposal_commit', {
    p_proposal_id: proposal.id,
    p_reviewer_message: body.message ?? null,
    p_storage_path: newStoragePath,
    p_size_bytes: mergedSize,
  });

  if (rpcErr) {
    // 6. Cleanup orphan upload (best effort).
    await admin.storage.from('projects').remove([newStoragePath]).catch(() => {});
    return json({ error: 'commit_failed', details: rpcErr.message }, 500);
  }

  const newVersionFromRpc = typeof rpcData === 'number' ? rpcData : newVersion;
  return json({ ok: true, new_version: newVersionFromRpc });
});

// ---------------------------------------------------------------------------

async function downloadStorageObject(
  client: ReturnType<typeof createClient>,
  bucket: string,
  path: string,
): Promise<Uint8Array | null> {
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

async function mergeProposalOntoBase(
  baseZipBytes: Uint8Array,
  payloadZipBytes: Uint8Array,
): Promise<{ bytes: Uint8Array }> {
  const baseZip = await JSZip.loadAsync(baseZipBytes);
  const payloadZip = await JSZip.loadAsync(payloadZipBytes);

  const manifestFile = payloadZip.file('manifest.json');
  if (!manifestFile) throw new Error('payload missing manifest.json');
  const manifestText = await manifestFile.async('text');
  const manifest = JSON.parse(manifestText) as ProposalManifest;
  if (!Array.isArray(manifest.files_changed)) {
    throw new Error('manifest.files_changed must be an array');
  }

  for (const entry of manifest.files_changed) {
    if (!entry.path || entry.path.includes('..') || entry.path.startsWith('/')) {
      throw new Error(`unsafe manifest path: ${entry.path}`);
    }
    if (entry.action === 'deleted') {
      baseZip.remove(entry.path);
      continue;
    }
    if (entry.action === 'modified' || entry.action === 'added') {
      const payloadEntry = payloadZip.file(entry.path);
      if (!payloadEntry) {
        throw new Error(`manifest references ${entry.path} but file missing from payload`);
      }
      const bytes = await payloadEntry.async('uint8array');
      baseZip.file(entry.path, bytes);
      continue;
    }
    throw new Error(`unknown manifest action: ${entry.action}`);
  }

  const out = await baseZip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return { bytes: out };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
