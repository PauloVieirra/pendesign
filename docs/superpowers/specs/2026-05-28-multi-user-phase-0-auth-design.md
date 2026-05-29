# Phase 0 — Auth foundation (detailed spec)

Status: Approved (autonomous execution). Parent: `2026-05-28-multi-user-supabase-design.md`.
Owner: paulo.junior@seatecnologia.com.br
Date: 2026-05-28

## Goal

The user can sign up, sign in, and sign out of their Supabase-backed account through the desktop app, the web UI, or the CLI. The session token persists across daemon restarts. With `OD_CLOUD_URL` unset, the cloud surface stays invisible and the daemon keeps working as a single-user local-first app.

## File structure

```
apps/daemon/src/cloud/
├── cloud-config.ts          — reads OD_CLOUD_URL / OD_CLOUD_ANON_KEY
├── cloud-session.ts         — SQLite cloud_session row (CRUD + migration)
├── cloud-client.ts          — Supabase SDK wrapper, refresh-on-expiry
├── cloud-errors.ts          — typed CloudError + status mapping
├── cloud-auth-routes.ts     — Express /api/cloud/auth/* handlers
└── index.ts                 — barrel exports

apps/daemon/tests/cloud/
├── cloud-config.test.ts
├── cloud-session.test.ts
├── cloud-client.test.ts     — fetch mock for Supabase HTTP
├── cloud-auth-routes.test.ts
```

## HTTP surface

All under `/api/cloud/auth/*`, requires same-origin (per existing daemon convention for private endpoints):

```
POST /api/cloud/auth/signup    { email, password, name }     → 200 { user } | 4xx
POST /api/cloud/auth/signin    { email, password }            → 200 { user } | 4xx
POST /api/cloud/auth/signout                                  → 204
GET  /api/cloud/auth/me                                       → 200 { user, configured: true } | 401
GET  /api/cloud/auth/status                                   → 200 { configured: boolean, signed_in: boolean }
```

If `OD_CLOUD_URL` / `OD_CLOUD_ANON_KEY` are unset, all five routes return `503 { error: 'cloud_not_configured' }` except `/status`, which returns `{ configured: false, signed_in: false }`.

### Error shape

```json
{ "error": "code_snake_case", "details": "human-readable optional" }
```

Codes:
- `cloud_not_configured` (503)
- `validation_error` (422)
- `auth_failed` (401) — wrong creds, invalid token
- `email_already_exists` (409)
- `weak_password` (422)
- `network_error` (502) — daemon couldn't reach Supabase
- `not_signed_in` (401)

## CLI surface

```
od cloud login [--email <e>] [--json]
od cloud logout [--json]
od cloud whoami [--json]
```

`login` prompts for email if missing and always prompts for password securely (no-echo). All three use the local daemon `/api/cloud/auth/*` endpoints (consistent with AGENTS.md dual-track requirement).

## Local data

### SQLite schema (`.od/app.sqlite`)

```sql
CREATE TABLE IF NOT EXISTS cloud_session (
  id            INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  user_id       TEXT NOT NULL,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,                    -- unix ms
  updated_at    INTEGER NOT NULL                     -- unix ms
);
```

Singleton row (only one logged-in account at a time). Signout deletes the row.

## Component responsibilities

### cloud-config.ts
Pure function reading env vars. Returns:
```typescript
type CloudConfig =
  | { enabled: true; url: string; anonKey: string; inviteLandingUrl?: string }
  | { enabled: false; reason: 'missing_url' | 'missing_key' };

export function readCloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig;
```

Validates `OD_CLOUD_URL` is a valid URL. Required env vars: `OD_CLOUD_URL`, `OD_CLOUD_ANON_KEY`. Optional: `OD_CLOUD_INVITE_LANDING_URL`.

### cloud-session.ts
Singleton-row CRUD. Migration runs idempotently on first call. API:
```typescript
export interface CloudSessionRow {
  userId: string;
  email: string;
  name: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;  // unix ms
}

export function ensureCloudSessionSchema(db: Database): void;
export function getCloudSession(db: Database): CloudSessionRow | null;
export function saveCloudSession(db: Database, session: CloudSessionRow): void;
export function clearCloudSession(db: Database): void;
```

### cloud-client.ts
Wraps `@supabase/supabase-js`:
```typescript
export class CloudClient {
  constructor(config: { url: string; anonKey: string }, session?: CloudSessionRow);
  async signup(email: string, password: string, name: string): Promise<CloudSessionRow>;
  async signin(email: string, password: string): Promise<CloudSessionRow>;
  async signout(): Promise<void>;
  async refresh(refreshToken: string): Promise<CloudSessionRow>;
  async getCurrentUser(): Promise<{ id: string; email: string; name: string }>;
  // Auto-refreshes if token expires within 60s; throws auth_failed if refresh fails.
  async ensureFreshAccessToken(currentSession: CloudSessionRow): Promise<CloudSessionRow>;
}
```

All methods throw `CloudError` on failure (typed code, mapping to HTTP status).

### cloud-auth-routes.ts
Express handlers that wire up the HTTP surface. Each handler:
1. Checks same-origin.
2. Checks `cloudConfig.enabled` (returns 503 if not).
3. Validates body schema.
4. Calls `CloudClient` method.
5. On success: persists session to SQLite, returns user payload.

`/me` reads session from SQLite, calls `ensureFreshAccessToken`, returns user.

## Web/Desktop UI (minimal — polish in follow-up commits)

A minimal `<CloudLoginCard>` component in `apps/web/src/components/`:
- Shows when `/api/cloud/auth/status` returns `{ configured: true, signed_in: false }`.
- Has Sign in tab + Sign up tab, with email + password (+ name for signup).
- On submit, POSTs to the daemon, refreshes status.

Top-bar menu entry (small): "Signed in as {email}" with logout option when signed in. Hidden when `configured: false`.

Full account dashboard, password reset, profile editing → Phase 5 polish.

## Tests

### Unit (vitest)

- `cloud-config.test.ts`:
  - Returns `enabled:true` when both env vars set.
  - Returns `enabled:false, reason:'missing_url'` when URL absent.
  - Returns `enabled:false, reason:'missing_key'` when key absent.
  - Rejects malformed URL.

- `cloud-session.test.ts`:
  - `ensureCloudSessionSchema` creates table idempotently.
  - `saveCloudSession` upserts singleton row.
  - `getCloudSession` returns null when empty, row when present.
  - `clearCloudSession` removes row; subsequent get returns null.

- `cloud-client.test.ts`:
  - Mocks `fetch` (Supabase SDK uses fetch under the hood) to return canned responses.
  - `signin` happy path returns CloudSessionRow.
  - `signin` invalid credentials throws CloudError('auth_failed').
  - `refresh` happy path.
  - `ensureFreshAccessToken` refreshes only when within 60s of expiry.

- `cloud-auth-routes.test.ts`:
  - Boots a minimal Express app with the routes registered + an in-memory SQLite.
  - Each route's happy/error path.
  - `/status` returns `{ configured: false }` when env unset.
  - 503 for non-status routes when env unset.

### Integration (manual, requires real Supabase schema applied)

- Signup with new email → user exists in `auth.users` + `public.profiles`.
- Signin with the password → session persists in SQLite.
- Restart daemon → `/me` returns the user without re-login.
- Signout → SQLite row gone; `/me` returns 401.

## Acceptance criteria

1. With `OD_CLOUD_URL` unset, all daemon tests pass and no cloud UI appears.
2. With `OD_CLOUD_URL` set and schema applied:
   - `od cloud login --email me@example.com` succeeds.
   - `od cloud whoami --json` returns `{ id, email, name }`.
   - Restart daemon. `od cloud whoami` still works.
   - `od cloud logout`. `od cloud whoami` returns `not_signed_in`.
3. Unit tests pass; typecheck clean.

## Out of scope (deferred)

- OAuth providers (Google, GitHub) — Phase 5.
- Magic link login — Phase 5.
- Password reset flow — Phase 5.
- Profile editing (name/avatar) — Phase 5.
- Multi-account support (one daemon, multiple users) — Phase 5, may need rearch.
- OS keychain for refresh token storage (currently plaintext in SQLite) — Phase 5.
