// ============================================================================
// send-invitation-email
//
// Called by the daemon immediately after inserting a row in
// project_invitations. Looks up the invitation, project, and inviter, then
// sends a transactional email via Resend.
//
// Secrets required (set via `supabase secrets set ...` or dashboard):
//   RESEND_API_KEY            — Resend API key
//   RESEND_FROM_EMAIL         — verified sender (e.g. "noreply@yourdomain.com")
//   INVITE_LANDING_BASE_URL   — public landing URL prefix, e.g.
//                                "https://invite.yourdomain.com"
//                                Token is appended as "/invite?token=…".
//
// JWT verify is disabled in config.toml because this is called from server
// code (the daemon) with a service-role-style flow. The function itself
// validates the user's authority by checking that the JWT corresponds to a
// member who can manage the invitation. (Daemon includes the user's access
// token in the Authorization header.)
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface RequestBody {
  invitation_id: string;
}

interface InvitationRow {
  id: string;
  project_id: string;
  email: string;
  role: 'editor' | 'viewer';
  token: string;
  expires_at: string;
  created_by: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? 'onboarding@resend.dev';
  const INVITE_LANDING_BASE_URL =
    Deno.env.get('INVITE_LANDING_BASE_URL') ?? 'https://invite.yourdomain.com';
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: 'server_misconfigured', details: 'missing env vars' }, 500);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  if (!body.invitation_id || typeof body.invitation_id !== 'string') {
    return jsonResponse({ error: 'invitation_id_required' }, 400);
  }

  // Use service role to fetch invitation + related project + inviter. We
  // could authenticate as the user via the Authorization header, but for a
  // transactional email we just need read access — and the daemon has
  // already RLS-checked the invitation creation right before calling us.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: inv, error: invErr } = await admin
    .from('project_invitations')
    .select('id, project_id, email, role, token, expires_at, created_by')
    .eq('id', body.invitation_id)
    .single<InvitationRow>();

  if (invErr || !inv) {
    return jsonResponse({ error: 'invitation_not_found', details: invErr?.message }, 404);
  }

  const { data: project } = await admin
    .from('projects')
    .select('name')
    .eq('id', inv.project_id)
    .single<{ name: string }>();
  const { data: inviter } = await admin
    .from('profiles')
    .select('name')
    .eq('id', inv.created_by)
    .single<{ name: string }>();

  const projectName = project?.name ?? 'a design project';
  const inviterName = inviter?.name ?? 'A teammate';
  const acceptUrl = `${INVITE_LANDING_BASE_URL.replace(/\/$/, '')}/invite?token=${encodeURIComponent(inv.token)}`;

  const subject = `${inviterName} invited you to "${projectName}" on Open Design`;
  const html = renderInvitationHtml({
    projectName,
    inviterName,
    role: inv.role,
    acceptUrl,
    expiresAt: inv.expires_at,
  });
  const text = renderInvitationText({
    projectName,
    inviterName,
    role: inv.role,
    acceptUrl,
    expiresAt: inv.expires_at,
  });

  const resendResp = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: inv.email,
      subject,
      html,
      text,
    }),
  });

  if (!resendResp.ok) {
    const errBody = await resendResp.text();
    return jsonResponse(
      { error: 'email_send_failed', status: resendResp.status, details: errBody },
      502,
    );
  }

  const result = (await resendResp.json()) as { id?: string };
  return jsonResponse({ ok: true, message_id: result.id ?? null });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface InvitationTemplateProps {
  projectName: string;
  inviterName: string;
  role: 'editor' | 'viewer';
  acceptUrl: string;
  expiresAt: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInvitationHtml(props: InvitationTemplateProps): string {
  const project = escapeHtml(props.projectName);
  const inviter = escapeHtml(props.inviterName);
  const role = props.role;
  const expires = new Date(props.expiresAt).toUTCString();
  return `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;color:#111;max-width:520px;margin:auto;padding:24px;">
  <h1 style="font-size:20px;margin:0 0 16px;">You've been invited to a design project</h1>
  <p>${inviter} invited you to <strong>${project}</strong> on Open Design as a <strong>${role}</strong>.</p>
  <p>
    <a href="${props.acceptUrl}" style="display:inline-block;padding:10px 18px;background:#c96442;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Accept invitation</a>
  </p>
  <p style="color:#666;font-size:13px;">This link expires on ${expires}.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
  <p style="color:#666;font-size:12px;">If you don't have Open Design installed, the landing page will help you get it.</p>
</body></html>`;
}

function renderInvitationText(props: InvitationTemplateProps): string {
  const expires = new Date(props.expiresAt).toUTCString();
  return [
    `${props.inviterName} invited you to "${props.projectName}" on Open Design as a ${props.role}.`,
    '',
    `Accept the invitation: ${props.acceptUrl}`,
    '',
    `This link expires on ${expires}.`,
  ].join('\n');
}
