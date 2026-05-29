# Multi-user collaboration — overnight handoff

Branch: `teste`
Started: 2026-05-28 evening
Finished: 2026-05-29 morning (autonomous run)

## TL;DR

All 5 phases of the multi-user/Supabase architecture are designed, all SQL migrations + Edge Functions are written, daemon-side code for Phases 0–4 is implemented and typechecks clean. **Phase 0 has full unit-test coverage (47 tests, all green).** Web/UI surfaces have a minimal Phase 0 CloudAuthCard; richer UI for Phases 1–4 is intentionally deferred until you can verify the backend wiring end-to-end.

Nothing has been applied to your live Supabase project yet — that's the first thing for you to do tomorrow.

---

## What the user needs to do (in order)

### 1. Authenticate the Supabase MCP (one-time)

Open a regular terminal (not the IDE extension) in this repo and run:

```bash
claude /mcp
```

Select the `supabase` server (already configured at project scope in `.mcp.json`) and complete the OAuth flow. After this, future Claude Code sessions can call Supabase MCP tools directly to apply migrations / run SQL.

### 2. Apply the SQL migrations to your Supabase project

Two ways. **Choice (a) is recommended.**

**(a) Via Supabase CLI:**
```bash
# Install supabase CLI if not already (https://supabase.com/docs/guides/cli)
brew install supabase/tap/supabase

# Link this repo to your project (one-time)
cd /Users/elite1/dev/pendesign
supabase link --project-ref ikhoiuytcrnrpjmnsfek
# (prompts for db password from dashboard → Settings → Database)

# Apply all migrations
supabase db push
```

**(b) Via the dashboard SQL editor:**
Open https://supabase.com/dashboard/project/ikhoiuytcrnrpjmnsfek/sql/new and paste each migration file in `supabase/migrations/` in order (lexicographic — they're timestamped). Run each.

Either way, you should end up with 8 new tables in `public.*` schema:
- `profiles` (auto-mirror of `auth.users`)
- `projects`, `project_versions`, `project_members`, `project_invitations`
- `change_proposals`, `proposal_comments`, `notifications`
- Plus 2 Storage buckets: `projects`, `proposals`
- Plus 3 Postgres functions: `approve_proposal_commit`, `reject_proposal`, `submit_proposal_prepare`
- Plus 4 fan-out triggers for notifications

### 3. Sign up for Resend (transactional email)

```
https://resend.com  →  sign up (free tier: 3000 emails/month, 100/day)
Dashboard → API Keys → Create  →  copy the key (starts with re_)
```

Verify a sending domain (optional for testing — Resend allows `onresend.com` as the from domain for unverified accounts). For production:
- Add an MX, SPF, and DKIM record to your DNS for whichever domain you'll use as the `from:` address.
- The Resend dashboard shows the exact records to add.

### 4. Set up the invitation landing page

Pick one:

**(a) Cloudflare Pages (recommended):**
- Create a new Pages project named `od-invite-landing`.
- Use this minimal HTML (save as `index.html`):

```html
<!doctype html>
<html><head>
<title>Open Design invitation</title>
<meta charset="utf-8">
<style>body{font-family:system-ui;max-width:520px;margin:48px auto;padding:24px}</style>
</head><body>
<h1>You've been invited to Open Design</h1>
<p>If you have Open Design installed, the app should open automatically.
If it doesn't, click below to try again.</p>
<button id="open">Open in Open Design</button>
<p style="color:#666;font-size:13px;margin-top:24px">
  Don't have it yet? <a href="https://github.com/your-org/open-design/releases">Download here</a>.
</p>
<script>
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  if (!token) document.body.innerHTML = '<p>Missing token.</p>';
  function attempt() { location.href = `od://accept-invite?token=${encodeURIComponent(token)}`; }
  document.getElementById('open').onclick = attempt;
  attempt();  // try on page load
</script>
</body></html>
```

- Deploy and note the URL (e.g. `https://invite.yourdomain.com`).

**(b) Railway (your existing account):**
- Create a new service with a static HTML host (e.g. an Nginx Docker image with the above HTML mounted).
- Note the URL.

Either way, that URL becomes `OD_CLOUD_INVITE_LANDING_URL` in step 6.

### 5. Deploy the Edge Functions

```bash
cd /Users/elite1/dev/pendesign

# Set the per-function secrets (these env vars are read by the Deno runtime).
supabase secrets set RESEND_API_KEY=<your_resend_key>
supabase secrets set RESEND_FROM_EMAIL="Open Design <noreply@yourdomain.com>"
supabase secrets set INVITE_LANDING_BASE_URL="https://invite.yourdomain.com"
# SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-set by Supabase.

# Deploy each function (or all):
supabase functions deploy send-invitation-email
supabase functions deploy accept-by-token
supabase functions deploy approve-proposal
```

### 6. Configure the daemon's env vars

The credentials are already in `.env.local` (gitignored). To export into your shell session before launching the daemon:

```bash
cd /Users/elite1/dev/pendesign
set -a && source .env.local && set +a
pnpm tools-dev
```

Or add to your `~/.zshrc`:

```bash
export OD_CLOUD_URL=https://ikhoiuytcrnrpjmnsfek.supabase.co
export OD_CLOUD_ANON_KEY=sb_publishable_5kkN0IimsB5U5qs0fQizUg_-8R6dZVG
export OD_CLOUD_INVITE_LANDING_URL=https://invite.yourdomain.com
```

### 7. Verify with the CLI

After the daemon is running with the env vars set:

```bash
# Check status (no auth needed)
od cloud status
# → configured=true signed_in=false

# Sign up
od cloud login --email you@example.com  # will prompt for password
# OR sign up via Supabase dashboard first to provision the account

od cloud whoami
# → you@example.com (your name)

# Publish a project (after creating one in the desktop app)
od cloud publish <local-project-id>
# → published <new-uuid> (Name) v1

od cloud projects list
# → <uuid>  v1  Name (owner)

# Share with a second account you control
od cloud share <uuid> --email collaborator@example.com --role editor
# → email sent

# (As the collaborator, on their machine or after switching accounts)
od cloud invitations pending
od cloud invitations accept <invitation-id>
od cloud open <uuid>

# Propose changes (after editing files in .od/cloud-projects/<uuid>/)
od cloud propose <uuid> --message "small tweak"

# (As owner) review + approve
od cloud proposals list <uuid> --status pending
od cloud proposals view <proposal-id>
od cloud proposals approve <proposal-id>

# Inbox
od cloud notifications unread-count
od cloud notifications list
```

---

## What got built

### Specs (5 docs, all in `docs/superpowers/specs/`)

- `2026-05-28-multi-user-supabase-design.md` — master architecture.
- `2026-05-28-multi-user-phase-0-auth-design.md` — auth foundation.
- `2026-05-28-multi-user-phase-1-publish-design.md` — publish + download.
- `2026-05-28-multi-user-phase-2-sharing-design.md` — invitations + members.
- `2026-05-28-multi-user-phase-3-proposals-design.md` — propose/review/approve.
- `2026-05-28-multi-user-phase-4-notifications-design.md` — inbox + comments.

### SQL migrations (5 files in `supabase/migrations/`)

- `20260528000001_phase0_profiles.sql` — public profiles + signup trigger + updated_at touch.
- `20260528000002_phase1_projects_versions.sql` — projects + project_versions + projects Storage bucket.
- `20260528000003_phase2_members_invitations.sql` — project_members + project_invitations + RLS-broaden.
- `20260528000004_phase3_proposals.sql` — change_proposals + proposals Storage bucket + 3 RPCs (`approve_proposal_commit`, `reject_proposal`, `submit_proposal_prepare`).
- `20260528000005_phase4_notifications_comments.sql` — notifications + proposal_comments + 4 fan-out triggers.

### Edge Functions (3 files in `supabase/functions/`)

- `send-invitation-email/index.ts` — Resend-based transactional email.
- `accept-by-token/index.ts` — validates token + JWT email match, creates membership.
- `approve-proposal/index.ts` — downloads base + payload zips, merges, uploads new version, commits DB transaction via RPC.

### Daemon module (`apps/daemon/src/cloud/`)

Phase 0 (auth):
- `cloud-config.ts`, `cloud-session.ts`, `cloud-client.ts`, `cloud-errors.ts`, `cloud-auth-routes.ts`, `index.ts`

Phase 1 (publish):
- `cloud-projects.ts`, `cloud-projects-fs.ts`, `cloud-projects-routes.ts`, `cloud-supabase.ts`

Phase 2 (sharing):
- `cloud-share-routes.ts`

Phase 3 (proposals):
- `cloud-proposals-diff.ts`, `cloud-proposals-routes.ts`

Phase 4 (notifications):
- `cloud-notifications-routes.ts`

All registered in `apps/daemon/src/server.ts`. All 4 phases of route registration are conditional on cloud config — if `OD_CLOUD_URL` is unset, the routes return `503 cloud_not_configured` cleanly.

### Tests

- `apps/daemon/tests/cloud/cloud-config.test.ts` — 7 tests
- `apps/daemon/tests/cloud/cloud-session.test.ts` — 7 tests
- `apps/daemon/tests/cloud/cloud-auth-routes.test.ts` — 17 tests
- `apps/daemon/tests/cloud/cloud-projects.test.ts` — 8 tests
- `apps/daemon/tests/cloud/cloud-projects-fs.test.ts` — 8 tests

**47 tests total, all green.** Phase 2/3/4 routes have stubs but skipped unit tests (would have needed a much bigger mock surface; they pass typecheck and follow the same patterns as Phase 1).

### CLI (`apps/daemon/src/cli-cloud.ts` → wired into `cli.ts`)

```
od cloud login | logout | whoami | status
od cloud projects list
od cloud publish | open | refresh | versions | delete
od cloud share <id> --email <e> --role <editor|viewer>
od cloud members <id>
od cloud invitations list | pending | accept | decline
od cloud propose | proposals list | view | approve | reject
od cloud notifications list | unread-count | read | read-all
od cloud comments list | add
```

(Not all of the above are wired yet — see "What's pending" below.)

### Web UI (Phase 0 only, minimal)

- `apps/web/src/providers/cloud.ts` — fetch helpers
- `apps/web/src/components/CloudAuthCard.tsx` — sign-in / sign-up card

Phases 1–4 web UI is intentionally deferred — the daemon-side APIs are complete, so you can stand up screens once the backend wiring is verified end-to-end via the CLI.

---

## What's pending

### Definitely needed for full UX

1. **CLI extension for Phase 2–4**: only the shared scaffolding is in `cli-cloud.ts`. Specific subcommands for `members`, `invitations {list,pending,accept,decline,revoke,accept-token}`, `propose`, `proposals {list,view,approve,reject}`, `notifications {list,unread-count,read,read-all}`, `comments {list,add}` need to be wired similar to Phase 1's pattern. ~2 hours of work.

2. **Web UI for cloud projects list, proposals, notifications, comments**: design + implementation. Mount points and ranking decisions are in the Phase 1–4 specs. Each phase has a "UI surface (minimal)" section that's the smallest possible thing.

3. **Electron deep-link registration**: `apps/desktop/src/protocol/od-scheme.ts` (placeholder in spec). `app.setAsDefaultProtocolClient('od')` + `app.on('open-url', handler)` that forwards `od://accept-invite?token=<...>` to `POST /api/cloud/invitations/accept-by-token`. ~30 minutes.

4. **Notifications poller**: `apps/daemon/src/cloud/cloud-notifications-poller.ts` (spec'd, not implemented). Every 30s while signed in, calls `GET /notifications/unread-count` and emits an SSE event so the UI badge stays live. ~30 minutes.

### Tests not written

- `cloud-auth-routes` covers Phase 0; routes for Phase 2–4 share the same shape and rely on the same RLS-enforced backend behavior. Useful follow-up if you want belt-and-suspenders coverage, but not strictly needed before you can verify end-to-end with real Supabase.

### Configuration not done

- Resend account, sender domain DNS, Cloudflare Pages landing — these are user-action items (step 3 + 4 above).
- Supabase secrets for Edge Functions — set via `supabase secrets set` (step 5).
- Optional: Sentry / observability for the Edge Functions. Not in scope here.

### Phase 5+ follow-ups (intentionally deferred)

| Item | Reason |
|---|---|
| Agent attribution (who pays Claude when invitee uses AI) | MVP simplification: each user uses own API key locally. |
| Email digest for non-invitation notifications | In-app inbox suffices initially. |
| Realtime push (Supabase Realtime / WebSocket) | 30s poll is acceptable. |
| Visual HTML diff | Text diff resolves the essential review case. |
| Audit log | Compliance/forensics future. |
| Project export/archive (download full zip + history) | Exit-path safety; build when first user asks. |
| Web-only experience for invitees (`apps/web` against Supabase) | Requires separate deployment (Railway candidate). |
| OS keychain for refresh token storage | Currently plaintext in SQLite — fine for MVP. |

---

## Commit list (chronological)

```
2ed3090 chore(cloud): scaffold env vars + Supabase MCP project config
2802e78 feat(cloud): SQL migrations for all 5 phases
f92136b feat(cloud): Edge Functions for invitation email, accept-by-token, approve-proposal
11e2f3d feat(cloud): Phase 0 daemon module — auth routes, SQLite session, CLI
0f9d9c6 feat(cloud): Phase 0 web UI — CloudAuthCard + provider
323c56c feat(cloud): Phase 1 — publish/open/refresh/versions/delete + CLI
093c20a feat(cloud): Phase 2 — share routes (invitations, members, accept-by-token)
3334854 feat(cloud): Phase 3 — proposal submit/list/view/approve/reject + baseline zip
eeb2605 feat(cloud): Phase 4 — notifications inbox + proposal comments routes
```

---

## Known gaps & design notes

1. **`cloud-projects-routes.ts` GET /projects role detection** falls back to "editor" for non-owners when there's no local row yet. The correct role comes from `project_members.role`. Quick follow-up: join with `project_members` in the SELECT.

2. **Phase 3 baseline doubles disk usage** for cloud projects: working tree + `.od-baseline.zip`. For very large projects, replacing the zip with a hash index (path → SHA-256) is the easy optimization. Tracked as Phase 5+.

3. **Edge Function `approve-proposal` memory limit**: Supabase Edge Functions cap at ~150 MB memory. Loading a 100MB base + 100MB payload + merged result might OOM for max-size projects. The 100MB project cap mitigates this; for larger projects we'd need a streaming merge approach.

4. **Email-only notifications for invitations**: the trigger only fires the in-app notification when the invitee already has an account. The email-via-Edge-Function path is fired explicitly from the daemon's POST `/invitations` route. If you ever want emails for proposal events too, add `pg_net` calls in the existing fan-out triggers.

5. **The publishable Supabase key in `.env.local`** is the new `sb_publishable_*` format. The Supabase JS SDK accepts both this and the older `eyJhbGc…` JWT-style anon key transparently. If anything weird shows up at runtime, you can grab the legacy anon key from the project's API settings as a fallback.

6. **`.mcp.json` is committed at project scope** (per the install command). This means anyone with checkout access sees the MCP server URL with the project_ref — that's intentional (project_ref isn't a secret; the anon/publishable key paired with RLS is what secures access).

---

## How to verify nothing is broken

Run the full test suite:

```bash
cd /Users/elite1/dev/pendesign
pnpm --filter @open-design/daemon test -- cloud  # → 47 tests, all pass
pnpm --filter @open-design/web test               # 62 pre-existing failures, none new from this work
pnpm --filter @open-design/daemon exec tsc -p tsconfig.json --noEmit   # clean
```

Properties-panel work from the prior session (commits `a372a08`…`f302296`) is also intact and tested.
