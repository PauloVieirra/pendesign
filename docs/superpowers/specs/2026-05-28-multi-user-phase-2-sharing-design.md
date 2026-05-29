# Phase 2 — Sharing + invitations (detailed spec)

Status: Approved (autonomous execution). Parent: `2026-05-28-multi-user-supabase-design.md`.
Owner: paulo.junior@seatecnologia.com.br
Date: 2026-05-28
Depends on: Phase 1 (publish).

## Goal

Project owner invites a teammate by email. Teammate receives email, clicks link, signs up or in, ends up with the project in their cloud projects list, and can download the local copy. No editing yet (Phase 3); the invitee is a viewer or editor by role but cannot push back without proposals.

## File structure

```
apps/daemon/src/cloud/
├── cloud-share-routes.ts        — /api/cloud/projects/:id/invitations, /api/cloud/invitations/*
└── cloud-deep-link.ts           — handles od://accept-invite?token=… (forwards to accept-by-token Edge Function)

apps/daemon/tests/cloud/
└── cloud-share-routes.test.ts

apps/desktop/src/protocol/
└── od-scheme.ts                 — register custom protocol on app startup (Electron)

infra/invite-landing/             — Cloudflare Pages site (separate from monorepo, optional)
└── index.html                   — minimal page that attempts od:// deep link
```

## HTTP surface

```
GET    /api/cloud/projects/:id/members            → [{user_id, name, email, role, accepted_at}]
POST   /api/cloud/projects/:id/invitations        { email, role } → { id, email, role, expires_at }
DELETE /api/cloud/projects/:id/invitations/:invitationId → 204
GET    /api/cloud/invitations/pending             → [{id, project_name, owner_name, role, expires_at}]
POST   /api/cloud/invitations/:id/accept          → { project_id }
POST   /api/cloud/invitations/:id/decline         → 204
POST   /api/cloud/invitations/accept-by-token     { token } → { project_id }   -- deep link entry
```

The POST invitation flow:
1. RLS-checked INSERT into `project_invitations` table (server-side trigger generates token).
2. Daemon calls Supabase Edge Function `send-invitation-email` with the new invitation id.

Wait — token generation. Looking at the migration I wrote, the `token TEXT NOT NULL UNIQUE` column doesn't have a default. The client must generate it. Let me check the Phase 2 migration… yes the migration says `token TEXT NOT NULL UNIQUE` without a default. The daemon will generate a cryptographically random token using `crypto.randomBytes(24).toString('base64url')` and include it in the INSERT.

## Token format

`crypto.randomBytes(24).toString('base64url')` → 32-character URL-safe string. Enough entropy (192 bits) to make guessing infeasible. Stored in the URL query param `?token=…`.

## Deep link handler

`od://accept-invite?token=<...>` registered via Electron's `app.setAsDefaultProtocolClient('od')`. On macOS, single-instance — `app.on('open-url', ...)` receives the URL while the app is running. On Windows / Linux, the URL is passed as argv on launch.

The desktop module forwards the URL via IPC to the daemon's `/api/cloud/invitations/accept-by-token` endpoint with the token.

## CLI surface

```
od cloud share <cloud-project-id> --email <e> --role <editor|viewer>
od cloud members <cloud-project-id>
od cloud invitations list                  # outgoing on my projects
od cloud invitations pending               # incoming (waiting for me to accept)
od cloud invitations accept <invitation-id>
od cloud invitations decline <invitation-id>
od cloud invitations accept-token <token>  # for testing or direct CLI
od cloud invitations revoke <invitation-id>
```

## UI surface (minimal)

`ShareDialog` component:
- Open from a cloud project's overflow menu.
- Form: email + role select (Editor / Viewer).
- On submit, calls POST invite, shows toast + invite link.
- Members list below with current memberships + role + remove.

`PendingInvitations` component:
- Renders a list of invitations addressed to me.
- Accept / Decline buttons.

## Tests

### Unit
- `cloud-share-routes.test.ts`:
  - Invite happy path (creates row + sends email — email call mocked).
  - Invite with invalid email → 422.
  - Accept-by-token happy path (calls Edge Function).
  - Pending list filters by my email.
  - Revoke deletes the row.

### Integration (manual)
- Owner invites; invitee receives email; clicks link; accepts via deep link.

## Acceptance criteria

1. Owner: `od cloud share <id> --email <e> --role editor` → row created, email sent.
2. Invitee logs in on their machine; `od cloud invitations pending` shows the row.
3. `od cloud invitations accept <id>` returns the project_id; the project appears in `od cloud projects list`.
4. `od cloud open <id>` extracts the project locally.

## Out of scope (deferred)

- Configurable invitation expiry (currently 14 days hard-coded in migration).
- Invitation resend (just create another or delete + recreate).
- Domain allow-list (only allow emails from corp domain). Phase 5.
- Account-bound public profile pages. Phase 5.
