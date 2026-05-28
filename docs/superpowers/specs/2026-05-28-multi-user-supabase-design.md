# Multi-user collaboration (Supabase) — master architecture

Status: Approved (brainstorm phase). Master spec; each phase gets its own detailed spec.
Owner: paulo.junior@seatecnologia.com.br
Date: 2026-05-28

## Problem

Open Design today is **single-user, local-first**. Projects live in `.od/projects/<id>/` on the owner's machine; the daemon owns all I/O; there is no notion of identity, sharing, or remote access. The owner can't invite anyone else to view or edit a project.

The user need is concrete: *"I have a project; I want to invite another person by email so they can view or edit it, with permissions."* That requires identity, hosted storage of the project, an ACL, and a controlled write workflow so two people can't silently overwrite each other.

## Goals

1. Owner can publish a local project to a hosted backend and invite collaborators by email.
2. Collaborator receives email → signs up/in → sees the shared project → opens a **local copy** in their own desktop install → edits freely.
3. Collaborator submits changes as a **proposal** for owner review. Owner approves → project advances to a new version. Owner rejects → proposal closes without effect.
4. In-app inbox surfaces invitations, proposal events, and comments — so users don't need to refresh manually to know something happened.
5. Threaded comments on each proposal so reviewer and submitter can discuss before approval.
6. Local-first stays intact: working solo on a non-cloud project must keep working with **zero** dependency on internet, login, or the backend.

## Non-goals

- **No real-time collaborative editing.** No CRDT, no operational transform, no presence cursors. Two people never edit the same file simultaneously in this design; concurrency is resolved by the propose/approve loop.
- **No file locks.** Earlier design draft used per-HTML-file locks. Dropped during brainstorm — the propose/approve workflow obsoletes them: each collaborator edits their own local copy, conflicts are surfaced as `stale` proposals at submit time.
- **No web-only experience for collaborators.** Collaborators install the desktop app, just like the owner. Web-only access for invitees is a deferred Phase 5+ feature; would require running `apps/web` against the backend as a separate deployment.
- **No DM between users.** Messages are scoped to proposals only.
- **No backend role for the AI agent runtime.** Claude/etc. continue to spawn locally in the daemon. "Who pays for agent calls when invitee uses AI" is deferred to Phase 5.
- **No background sync.** Updates are pulled on demand (open project / refresh / submit). No WebSocket push in MVP; in-app inbox polls every 30s.

## Architecture overview

### Topology: hybrid local-first

```
Owner's machine                 Backend (Supabase)            Collaborator's machine
─────────────────              ──────────────────             ─────────────────────
[Desktop / Web]                                                  [Desktop / Web]
       ↓                                                              ↓
   [Daemon]    ──── HTTPS ────  ─── HTTPS ────────              [Daemon]
       ↓                       Postgres + Auth                       ↓
  .od/projects/                Storage + Edge Fns            .od/cloud-projects/
  (solo work)                                                (downloaded copy)
  .od/cloud-projects/          ─── Email ────────►           
  (published copies)               (Resend)
```

- **Daemon stays the single client-side perimeter.** UI (web/Electron) talks only to local daemon `/api/cloud/*`. Daemon proxies to Supabase. Session token lives in daemon-managed SQLite (`.od/app.sqlite` table `cloud_session`) — not in browser localStorage.
- **Project content** lives in two places concurrently: the canonical snapshot in Supabase Storage, and the local working copy in `.od/cloud-projects/<id>/`. Local working copy is editable; canonical advances only through proposals.
- **Solo work is untouched.** `.od/projects/<id>/` remains the path for non-cloud projects; opt-in is per project via an explicit "Publish to cloud" action.

### Concurrency model: propose / review / approve

Inspired by Git pull-requests but **without Git** as the storage layer:

- **Editor edits freely** on their local copy. No lock, no contention. They can save many times locally; the backend doesn't see anything until they submit.
- **Submit creates a Change Proposal.** Daemon computes which files differ from the editor's `base_version` (the version they downloaded), zips only those files plus a manifest, uploads as a proposal. Backend marks the proposal `pending`.
- **Owner reviews.** Sees the diff (text-level for MVP) per file, can comment, approves or rejects.
- **Approval applies the payload** to the snapshot at `base_version`, producing `base_version + 1`. New canonical version stored. Any other open proposals against the now-stale base get marked `stale` automatically; their submitters must pull, rebase, and re-submit.
- **Rejection** closes the proposal with the reviewer's message. No state change to the canonical project.

This pushes conflict resolution to a human review step, which is the right answer for "one edit per page at a time" where the editor's intent matters and silent merges are dangerous.

### Sync model: pull on demand

The daemon does not push changes automatically. Three triggers re-sync from the backend:

1. **Open project** — daemon fetches latest version metadata; if `current_version` on backend > `local.base_version`, prompts to download the new snapshot.
2. **Submit proposal** — daemon checks `base_version` against `current_version`; refuses to upload if stale, telling the user to re-sync first.
3. **Manual refresh** — explicit "Sync" button (and `od cloud refresh`).

Inbox notifications poll every 30s. Real-time push (WebSocket/SSE from Supabase Realtime) is a Phase 5+ optimization.

## Data model

### Postgres (Supabase)

```sql
-- Identity: Supabase Auth owns auth.users. Public mirror for app-readable fields.
users                          -- public.users joined to auth.users by id
├── id (uuid, pk, fk → auth.users.id)
├── email (text, unique)
├── name (text)
├── avatar_url (text, nullable)
└── created_at (timestamptz)

projects
├── id (uuid, pk)
├── owner_id (uuid, fk → users.id)
├── name (text)
├── current_version (int, default 0)
└── created_at (timestamptz)

project_members
├── project_id (uuid, fk → projects.id)
├── user_id (uuid, fk → users.id)
├── role (text: 'owner' | 'editor' | 'viewer')
├── invited_at (timestamptz)
└── accepted_at (timestamptz, nullable)
PRIMARY KEY (project_id, user_id)

project_invitations
├── id (uuid, pk)
├── project_id (uuid, fk → projects.id)
├── email (text)
├── role (text: 'editor' | 'viewer')
├── token (text, unique)                  -- random; embedded in magic link
├── expires_at (timestamptz)
└── created_at (timestamptz)

project_versions
├── id (uuid, pk)
├── project_id (uuid, fk → projects.id)
├── version_num (int)
├── storage_path (text)                   -- e.g. 'projects/{project_id}/v{n}.zip'
├── message (text, nullable)
├── size_bytes (bigint)
├── author_id (uuid, fk → users.id)       -- whoever finalized this version (approver)
├── proposed_by (uuid, fk → users.id, nullable)  -- null if owner published directly
└── created_at (timestamptz)
UNIQUE (project_id, version_num)

change_proposals
├── id (uuid, pk)
├── project_id (uuid, fk → projects.id)
├── submitter_id (uuid, fk → users.id)
├── base_version (int)
├── storage_path (text)                   -- e.g. 'proposals/{id}/payload.zip'
├── message (text, nullable)
├── status (text: 'pending' | 'approved' | 'rejected' | 'stale')
├── reviewed_by (uuid, fk → users.id, nullable)
├── reviewer_message (text, nullable)
├── created_at (timestamptz)
└── reviewed_at (timestamptz, nullable)

proposal_comments
├── id (uuid, pk)
├── proposal_id (uuid, fk → change_proposals.id)
├── author_id (uuid, fk → users.id)
├── body (text)
├── created_at (timestamptz)
└── edited_at (timestamptz, nullable)

notifications
├── id (uuid, pk)
├── user_id (uuid, fk → users.id)        -- recipient
├── type (text)                           -- 'invitation' | 'proposal_submitted'
│                                         -- | 'proposal_reviewed' | 'proposal_commented'
├── payload (jsonb)                       -- { project_id, project_name, proposal_id?, actor_*, ... }
├── read_at (timestamptz, nullable)
└── created_at (timestamptz)
INDEX (user_id, created_at DESC)
INDEX (user_id, read_at) WHERE read_at IS NULL
```

### Local (daemon SQLite, `.od/app.sqlite`)

```sql
cloud_session
├── user_id (text)
├── email (text)
├── access_token (text)                   -- short-lived JWT from Supabase Auth
├── refresh_token (text)
├── expires_at (text)
└── updated_at (text)

cloud_projects
├── project_id (text, pk)                 -- mirrors backend id
├── name (text)
├── role (text: 'owner' | 'editor' | 'viewer')
├── base_version (int)                    -- version of local working copy
├── pending_proposal_id (text, nullable)
├── local_dirty (int)                     -- 0/1, computed at sync time
└── last_sync_at (text)
```

### Storage (Supabase Storage)

```
projects/
└── {project_id}/
    ├── v1.zip
    ├── v2.zip
    └── ...

proposals/
└── {proposal_id}/
    └── payload.zip   -- only modified/added files + manifest.json
```

`manifest.json` inside `payload.zip`:
```json
{
  "base_version": 3,
  "files_changed": [
    {"path": "index.html", "action": "modified"},
    {"path": "css/new.css", "action": "added"},
    {"path": "assets/old.png", "action": "deleted"}
  ]
}
```

## HTTP protocol (backend surface)

All endpoints below are backend (Supabase REST/Edge Functions). Daemon mirrors them 1:1 under `/api/cloud/*` for the UI.

### Auth (Supabase Auth)
```
POST /auth/signup        { email, password, name } → { user, session }
POST /auth/signin        { email, password }       → { user, session }
POST /auth/signout                                  → 204
GET  /auth/me                                       → { user }
```

### Projects
```
GET    /projects                            → [{id, name, owner_id, role, current_version, updated_at}]
POST   /projects                            (multipart: name, snapshot.zip, message?) → { project }
GET    /projects/:id                        → { project, members, my_role }
DELETE /projects/:id                        → 204 (owner only)
```

### Versions
```
GET /projects/:id/versions                  → [{version_num, message, size_bytes, author, proposed_by?, created_at}]
GET /projects/:id/versions/latest           → 302 → signed storage URL
GET /projects/:id/versions/:n               → 302 → signed storage URL
```

### Members + invitations
```
GET    /projects/:id/members                → [{user_id, name, email, role, accepted_at}]
POST   /projects/:id/invitations            { email, role } → { id, email, role, expires_at }
DELETE /projects/:id/invitations/:id        → 204
GET    /invitations/pending                 → [{id, project_name, owner_name, role, expires_at}]
POST   /invitations/:id/accept              → { project_id }
POST   /invitations/:id/decline             → 204
POST   /invitations/accept-by-token         { token } → { project_id }
```

### Change proposals
```
POST /projects/:id/proposals                (multipart: payload.zip, base_version, message?)
                                            → { proposal_id, status: 'pending' | 'stale' }
GET  /projects/:id/proposals?status=pending → [{id, submitter, base_version, message, status, created_at}]
GET  /proposals/:id                         → { id, project_id, submitter, base_version, message, status,
                                                files_changed:[{path, action}], created_at,
                                                reviewed_at?, reviewed_by?, reviewer_message? }
GET  /proposals/:id/payload                 → 302 → signed storage URL
POST /proposals/:id/approve                 { message? } → { new_version: int }   -- Edge Function
POST /proposals/:id/reject                  { message? } → { proposal_id, status: 'rejected' }
```

### Comments
```
GET  /proposals/:id/comments                → [{id, author:{id,name,avatar_url}, body, created_at, edited_at?}]
POST /proposals/:id/comments                { body } → { id, author, body, created_at }
```

### Notifications
```
GET   /notifications?unread_only&limit&before    → [{id, type, payload, read_at, created_at}]
GET   /notifications/unread-count                → { count }
PATCH /notifications/:id/read                    → 204
PATCH /notifications/mark-all-read               → { updated_count }
```

### Error codes
```
401 Unauthenticated   422 Validation error    410 Gone (invitation expired)
403 Forbidden         429 Rate limit          413 Payload too large (>100MB MVP cap)
404 Not found         409 Conflict (stale base_version)
```

### CLI mirror (per AGENTS.md dual-track rule)

Every endpoint above ships with a paired `od cloud …` subcommand in the same PR. Full list captured during brainstorm — repeated here as the canonical reference:

```
od cloud login [--email <e>] | logout | whoami
od cloud projects list | publish <path> [--message ...] | open <id> | delete <id>
od cloud share <project-id> --email <e> --role <editor|viewer>
od cloud invitations list | accept <id> | decline <id>
od cloud propose <project-id> [--message ...]
od cloud proposals list <project-id> [--status <s>] | view <id> | approve <id> [--message ...] | reject <id> [--message ...]
od cloud comments list <proposal-id> | add <proposal-id> --body "..."
od cloud notifications list [--unread] | read <id> | read-all
```

All support `--json`. Long-form messages support `--message-file <path|->`.

## Supabase concrete mapping

| Layer | Primitive |
|---|---|
| Identity | Supabase Auth (`auth.users` + public `users` mirror) |
| All tables above (except `cloud_*` SQLite ones) | Postgres `public.*` |
| Per-row authorization | Row-Level Security policies (one set per table) |
| Snapshot/payload storage | Supabase Storage buckets `projects/` and `proposals/` |
| `POST /proposals/:id/approve` server-side logic | Edge Function `approve-proposal` (Deno) |
| Email send on invitation | Edge Function `send-invitation-email` calling Resend API |
| Notifications fan-out | Postgres triggers (`AFTER INSERT` on invitations/proposals/comments) → INSERT rows in `notifications` |
| Daemon client | `@supabase/supabase-js` npm package |
| Invitation landing page | Cloudflare Pages (static HTML + JS that attempts deep link `od://accept-invite?token=…`) |

### RLS policy strategy

Default-deny. Each table receives explicit `SELECT/INSERT/UPDATE/DELETE` policies. Examples (full set written in per-phase specs):

```sql
-- Read your own projects (membership-based)
CREATE POLICY "members read projects" ON projects FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = projects.id AND user_id = auth.uid()
  ));

-- Only owners delete
CREATE POLICY "owners delete projects" ON projects FOR DELETE
  USING (owner_id = auth.uid());

-- Editors create proposals
CREATE POLICY "editors create proposals" ON change_proposals FOR INSERT
  WITH CHECK (
    submitter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM project_members
      WHERE project_id = change_proposals.project_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'editor')
    )
  );

-- Notifications are private
CREATE POLICY "own notifications" ON notifications FOR SELECT
  USING (user_id = auth.uid());
```

Storage RLS uses the same `auth.uid()` plus path conventions (e.g., `projects/{project_id}/*` readable only by members of that project).

### Edge Functions (3 total for MVP)

1. **`approve-proposal`** — transactional merge. Downloads `base_version` snapshot + proposal payload, applies file actions (modified/added/deleted), uploads new zip, inserts `project_versions` row, updates `projects.current_version`, marks proposal `approved`, marks other open proposals against the same project `stale`. Wrapped in a Postgres transaction; Edge Function commits on success.
2. **`send-invitation-email`** — triggered by `AFTER INSERT ON project_invitations`. Calls Resend with the templated invite link `https://<landing>/invite?token=<token>`.
3. **`accept-by-token`** — validates token, matches JWT email to invitation email, creates `project_members` row, marks invitation accepted, fires notification fan-out (handled by the existing trigger).

## Workflows (end-to-end)

### Workflow 1 — Publish

```
[Owner UI]               [Owner daemon]                  [Supabase]
clicks "Publish to cloud"
→ POST /api/cloud/publish
   { local_project_path, name }
                         zip(.od/projects/X) → payload.zip
                         (auth: refresh access_token if needed)
                         multipart POST /projects → name, payload.zip
                                                          → INSERT projects (owner=me, current_version=0)
                                                          → upload Storage projects/{id}/v1.zip
                                                          → INSERT project_versions v1
                                                          → UPDATE projects.current_version=1
                                                          ← { project: {id, name, current_version:1} }
                         INSERT INTO cloud_projects (project_id, role='owner', base_version=1)
                         ← { project_id }
← { project_id }
shows "Published" + project in Cloud projects list
```

### Workflow 2 — Share

```
[Owner]                                                [Supabase]
"Share" dialog: email + role
→ POST /api/cloud/projects/:id/invitations { email, role }
                                              INSERT project_invitations
                                              trigger sends notification + email
                                              (Edge Function send-invitation-email → Resend → bruno@…)

[Bruno's email]
clicks link https://<landing>/invite?token=<...>
[Landing page]
attempts od://accept-invite?token=<...> (deep link)
                       OR shows "Install app" + manual login

[Bruno's daemon, post-signup-or-signin]
                       POST /invitations/accept-by-token { token }   (Edge Function)
                                              validates token, JWT email match
                                              INSERT project_members (project, bruno, role)
                                              UPDATE project_invitations.accepted_at
                                              trigger: notify owner
                                              ← { project_id }
                       INSERT cloud_projects (project_id, role='editor', base_version=null)
                       UI shows projet in Bruno's list
```

### Workflow 3 — Propose

```
[Editor]
edits locally, clicks "Submit for review"
→ POST /api/cloud/projects/:id/propose { message }
                       compare cloud_projects/{id} vs last-downloaded snapshot baseline
                       (baseline = unpacked snapshot at base_version, kept in `.od/cloud-projects/{id}/.baseline/`)
                       compute changed files (modified/added/deleted)
                       zip(changed files + manifest.json) → payload.zip
                       multipart POST /projects/:id/proposals
                                              IF base_version != current_version → 409 stale
                                              ELSE INSERT change_proposals (pending)
                                                   upload Storage proposals/{id}/payload.zip
                                                   trigger notify owner
                                              ← { proposal_id, status: 'pending' }
                       UPDATE cloud_projects.pending_proposal_id = X
                       ← shown in UI: "Submitted, awaiting review"
```

### Workflow 4 — Approve / Reject

```
[Owner]
opens proposal X
→ GET /api/cloud/proposals/X        ← { meta, files_changed: [...] }
→ GET /api/cloud/proposals/X/payload (signed URL stream)
   daemon unzips into tmp dir, computes text diff against base_version
   UI renders side-by-side diff per file

clicks Approve [+ message]
→ POST /api/cloud/proposals/X/approve { message }
                       (Edge Function approve-proposal)
                       BEGIN TX:
                         download projects/{id}/v{base}.zip
                         download proposals/X/payload.zip
                         merge: apply files_changed onto base snapshot
                         upload projects/{id}/v{base+1}.zip
                         INSERT project_versions v{base+1} (author=owner, proposed_by=submitter)
                         UPDATE projects.current_version = base+1
                         UPDATE change_proposals X status='approved'
                         UPDATE other proposals same project status='stale' (where base_version <= base)
                         INSERT notifications (proposal_reviewed, target=submitter)
                       COMMIT
                       ← { new_version: base+1 }
← shown: "Approved → v{n}"
```

### Workflow 5 — Comment

```
[Either party on proposal X]
posts body
→ POST /api/cloud/proposals/X/comments { body }
                       INSERT proposal_comments
                       trigger: notify other participants (submitter + reviewer if differ from author)
                       ← { id, author, body, created_at }
inbox badge updates for the other(s) within 30s
```

## Phasing — five sub-projects

Each phase below is an independent spec + plan + PR. Order is sequential because of dependencies; can't parallelize without context corruption.

### Phase 0 — Auth foundation
Backend: Supabase project, `users` public mirror, RLS, Auth enabled.
Daemon: `apps/daemon/src/cloud/` (`cloud-client.ts`, `cloud-session.ts`, `cloud-routes.ts`); session in `.od/app.sqlite` `cloud_session` table; `/api/cloud/auth/*` endpoints.
Web/desktop: login/signup screens, "logged in as X" indicator, logout button.
CLI: `od cloud login | logout | whoami`.
E2E: signup → signin → restart daemon → still authenticated → signout.
Effort: M.

### Phase 1 — Project publish + download
Backend tables: `projects`, `project_versions`. Storage bucket `projects/` with RLS. Endpoints in §HTTP protocol Projects + Versions.
Daemon: zip+upload, download+unzip, `cloud_projects` SQLite table; `/api/cloud/publish`, `/api/cloud/projects/*`, `/api/cloud/open`.
UI: "Publish to cloud" button on local project, Cloud projects list, "Open" downloads + opens.
CLI: `od cloud projects list | publish | open | delete`.
E2E: publish → list → delete local → open from list → content matches.
Effort: M.
Depends on: Phase 0.

### Phase 2 — Sharing + invitations
Backend tables: `project_members`, `project_invitations`. Edge Function `send-invitation-email` (Resend). Edge Function `accept-by-token`. Endpoints in §HTTP protocol Members + invitations.
Landing page (Cloudflare Pages) at `/invite?token=...`; Electron `od://` scheme registered.
Daemon: `/api/cloud/projects/:id/invitations`, `/api/cloud/invitations/*`, deep-link handler.
UI: Share dialog, Members list, Pending invitations screen.
CLI: `od cloud share`, `od cloud invitations {list,accept,decline}`.
E2E: invite → email sent (mocked) → bruno accepts via deep link → projects list shows shared project → open.
Effort: M-L (email setup + deep link).
Depends on: Phase 1.

### Phase 3 — Proposal workflow (MVP complete here)
Backend table: `change_proposals`. Storage bucket `proposals/` with RLS. Edge Function `approve-proposal`. Endpoints in §HTTP protocol Change proposals.
Daemon: baseline tracking in `.od/cloud-projects/{id}/.baseline/`, diff compute, zip-changed-only, manifest, submit; download payload + unzip for review.
UI: "Submit for review" button (editor's daemon), Proposals tab on project, Review screen with text diff side-by-side per file (HTML/CSS/JS as text).
CLI: `od cloud propose`, `od cloud proposals {list,view,approve,reject}`.
E2E: editor edits → submit → owner sees pending → review diff → approve → editor pulls → sees v2. Stale path tested (two editors submit, owner approves one, other stale).
Effort: L (diff UI + Edge Function merge logic).
Depends on: Phase 2.

### Phase 4 — Notifications + comments
Backend tables: `notifications`, `proposal_comments`. Postgres triggers fan out notifications. Endpoints in §HTTP protocol Notifications + Comments.
Daemon: poll `/notifications/unread-count` every 30s, push updates to UI via existing SSE.
UI: inbox icon + badge on top bar, drawer with paginated list, comments panel inside proposal review.
CLI: `od cloud notifications {list,read,read-all}`, `od cloud comments {list,add}`.
E2E: invite fires notification, submit fires owner notification, review fires submitter notification, comment fires participant notifications; mark-read decrements badge.
Effort: M.
Depends on: Phase 3.

### Phase 5+ — Deferred follow-ups (no fixed order)

| Item | Why deferred |
|---|---|
| Agent attribution (who pays Claude calls when invitee uses AI) | MVP simplification: each user uses own API key configured locally |
| Email digest for non-invitation notifications | In-app inbox suffices initially |
| Realtime push (Supabase Realtime or WebSocket) | 30s poll is acceptable for async PR-style workflow |
| Visual HTML diff (render side-by-side) | Text diff resolves the essential review case; visual DOM diff is its own design problem |
| Audit log | Compliance/forensics not needed until scale |
| Project export/archive | Exit-path safety; build when first user asks |
| Web-only experience for collaborators (hosted `apps/web` against Supabase) | Requires a separate deployment of `apps/web` (Railway candidate); collaborator install via desktop is acceptable for MVP |

## Cross-cutting

### Backend provisioning (before Phase 0 starts)

1. Create Supabase project (free tier).
2. Configure Auth: enable email/password; defer OAuth providers.
3. Buy or pick a domain for `from:` in transactional emails; set up DNS records (SPF, DKIM) for Resend.
4. Create Cloudflare Pages site for invitation landing.
5. Set up Resend account, API key.
6. Daemon env vars in `apps/daemon/src/config.ts`: `OD_CLOUD_URL`, `OD_CLOUD_ANON_KEY`. Stored in `.od/` config or read from process env.

### Testing strategy

- **Backend integration tests** for Edge Functions (Deno test runner against a Supabase staging project — distinct from prod).
- **Daemon unit tests** in `apps/daemon/tests/cloud/` mocking the backend client.
- **Daemon E2E tests** in `e2e/tests/cloud/` hitting daemon HTTP `/api/cloud/*` against a real staging Supabase.
- **Web UI tests** in `apps/web/tests/` mocking the daemon `/api/cloud/*`.
- **Full E2E (UI → daemon → backend)** in `e2e/ui/` for each phase's happy path + critical error paths (stale, expired invitation, rejected proposal).

### Vendor lock-in & exit

- **Postgres** → portable via `pg_dump` to Neon, Railway, RDS, etc.
- **Auth** → moderate lock-in; `auth.users` is Supabase-shaped, but `supabase-auth` is open source and self-hostable.
- **Storage** → S3-compatible, exportable with `aws s3 sync`.
- **Edge Functions** → Deno; would need rewriting to Node/AWS Lambda. Only 3 functions, so cost is bounded.

Aggregate exit cost: weeks of work, not months. Acceptable for MVP.

### Cost preview

- Supabase free: 500MB Postgres / 1GB Storage / 50k MAU. Outgrown when 100+ projects with frequent pushes or sustained user count.
- Resend free: 3000 emails/month, 100/day. Outgrown when invitation volume crosses ~100/day.
- Cloudflare Pages: free for the static landing.
- Railway: not used in MVP. Reserved for future hosted `apps/web`.

Pro tier kick-in: Supabase Pro $25/mo + Resend Pro $20/mo if you cross either threshold.

## Open questions (acknowledged, deferred to per-phase specs)

1. **Snapshot size limit policy.** MVP caps at 100MB per project; how to communicate this and what behavior on overrun (reject with clear error vs auto-shrink)?
2. **Local baseline storage strategy.** Keeping `.od/cloud-projects/{id}/.baseline/` as a full snapshot doubles disk usage per cloud project. Could use a single zip kept around, decompressed on demand for diff. Decide in Phase 3 spec.
3. **Diff renderer for non-text files.** What does an image change look like in review UI? MVP: "binary changed, X→Y bytes". Phase 5 could do thumbnails side-by-side.
4. **Session refresh strategy.** Supabase access tokens are short-lived (~1h). Daemon must refresh proactively before expiry to avoid mid-action 401s. Spec in Phase 0.
5. **Backend env separation.** Dev / staging / prod Supabase projects — how to switch via env var. Spec in Phase 0.
6. **OS keychain for refresh token storage.** Storing refresh token in SQLite is OK MVP but plaintext. Phase 5+ improvement: encrypt with OS keychain (`keytar` or platform equivalent).
