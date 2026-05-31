// ============================================================================
// accept-by-token
//
// Called by the daemon when the user clicks an invitation link. Verifies:
//   1. The token exists, hasn't expired, hasn't been accepted/declined.
//   2. The JWT belongs to a user whose email matches the invitation's email.
// Then creates the project_members row and marks the invitation accepted.
//
// Body: { token: string }
// Auth: requires JWT (verify_jwt = true in config.toml).
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface RequestBody { token: string }

interface InvitationRow {
  id: string;
  project_id: string;
  email: string;
  role: 'editor' | 'viewer';
  expires_at: string;
  accepted_at: string | null;
  declined_at: string | null;
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
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'missing_bearer_token' }, 401);
  }

  let body: RequestBody;
  try { body = (await req.json()) as RequestBody; }
  catch { return json({ error: 'invalid_json' }, 400); }

  if (!body.token || typeof body.token !== 'string') {
    return json({ error: 'token_required' }, 400);
  }

  // Authenticate the caller using their JWT.
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) {
    return json({ error: 'unauthenticated', details: userErr?.message }, 401);
  }
  const caller = userRes.user;

  // Use service role for the rest (we need to bypass RLS to look up by token
  // and validate the email match server-side).
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: inv, error: invErr } = await admin
    .from('project_invitations')
    .select('id, project_id, email, role, expires_at, accepted_at, declined_at')
    .eq('token', body.token)
    .maybeSingle<InvitationRow>();

  if (invErr) return json({ error: 'lookup_failed', details: invErr.message }, 500);
  if (!inv) return json({ error: 'token_not_found' }, 404);

  if (inv.accepted_at) return json({ error: 'already_accepted' }, 409);
  if (inv.declined_at) return json({ error: 'already_declined' }, 409);
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    return json({ error: 'expired' }, 410);
  }

  if (!caller.email || caller.email.toLowerCase() !== inv.email.toLowerCase()) {
    return json(
      { error: 'email_mismatch', expected_email: inv.email },
      403,
    );
  }

  // Idempotent INSERT — if Bruno was already added (e.g. retried call), do nothing.
  const { error: memberErr } = await admin
    .from('project_members')
    .upsert(
      {
        project_id: inv.project_id,
        user_id: caller.id,
        role: inv.role,
        invited_at: new Date().toISOString(),
        accepted_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,user_id', ignoreDuplicates: false },
    );

  if (memberErr) {
    return json({ error: 'membership_create_failed', details: memberErr.message }, 500);
  }

  const { error: updErr } = await admin
    .from('project_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inv.id);

  if (updErr) {
    return json({ error: 'invitation_update_failed', details: updErr.message }, 500);
  }

  return json({ ok: true, project_id: inv.project_id });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
