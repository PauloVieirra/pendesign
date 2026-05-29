// Cloud (Supabase) provider — talks to the local daemon at /api/cloud/*.
//
// All cloud HTTP goes through the daemon. The web UI never holds a Supabase
// session token directly; the daemon is the only client-side perimeter that
// authenticates against Supabase.

export interface CloudUser {
  id: string;
  email: string;
  name: string;
}

export type CloudStatus =
  | { configured: false; signed_in: false; reason?: string }
  | { configured: true; signed_in: false }
  | { configured: true; signed_in: true; email: string; name: string };

export interface CloudError {
  error: string;
  details?: string;
}

const BASE = '/api/cloud/auth';

async function asJson<T>(resp: Response): Promise<T> {
  const text = await resp.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`invalid json from ${resp.url}: ${text.slice(0, 120)}`);
  }
}

export async function fetchCloudStatus(): Promise<CloudStatus> {
  const resp = await fetch(`${BASE}/status`, { credentials: 'same-origin' });
  if (!resp.ok) throw new Error(`status ${resp.status}`);
  return asJson<CloudStatus>(resp);
}

export async function fetchCloudMe(): Promise<{ user: CloudUser } | { error: string }> {
  const resp = await fetch(`${BASE}/me`, { credentials: 'same-origin' });
  return asJson(resp);
}

export interface CloudSignUpInput { email: string; password: string; name: string }
export interface CloudSignInInput { email: string; password: string }

export async function cloudSignUp(input: CloudSignUpInput): Promise<{ user: CloudUser }> {
  const resp = await fetch(`${BASE}/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  const body = await asJson<{ user?: CloudUser; error?: string; details?: string }>(resp);
  if (!resp.ok || !body.user) {
    const err = new Error(body.error ?? `signup_failed (${resp.status})`);
    (err as any).code = body.error ?? 'unknown';
    (err as any).details = body.details;
    (err as any).status = resp.status;
    throw err;
  }
  return { user: body.user };
}

export async function cloudSignIn(input: CloudSignInInput): Promise<{ user: CloudUser }> {
  const resp = await fetch(`${BASE}/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  const body = await asJson<{ user?: CloudUser; error?: string; details?: string }>(resp);
  if (!resp.ok || !body.user) {
    const err = new Error(body.error ?? `signin_failed (${resp.status})`);
    (err as any).code = body.error ?? 'unknown';
    (err as any).details = body.details;
    (err as any).status = resp.status;
    throw err;
  }
  return { user: body.user };
}

export async function cloudSignOut(): Promise<void> {
  await fetch(`${BASE}/signout`, { method: 'POST', credentials: 'same-origin' });
}
