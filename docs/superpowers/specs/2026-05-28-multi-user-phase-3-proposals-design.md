# Phase 3 — Change proposals (detailed spec)

Status: Approved (autonomous execution). Parent: `2026-05-28-multi-user-supabase-design.md`.
Owner: paulo.junior@seatecnologia.com.br
Date: 2026-05-28
Depends on: Phase 2 (sharing).

## Goal

Editor edits locally; submits a proposal for owner review; owner approves (project advances to new version) or rejects. Stale detection works automatically.

## File structure

```
apps/daemon/src/cloud/
├── cloud-proposals-routes.ts   — /api/cloud/projects/:id/proposals* + /proposals/:id/*
├── cloud-proposals-diff.ts     — compute changed files between baseline and working copy
└── (existing files)

apps/daemon/tests/cloud/
├── cloud-proposals-routes.test.ts
└── cloud-proposals-diff.test.ts
```

## Baseline strategy

The daemon stores the **last-known canonical snapshot zip** alongside the working copy:

```
.od/cloud-projects/<project-id>/
├── (working tree — editor's files)
└── .od-baseline.zip                     -- snapshot at base_version, do not modify
```

On submit, the diff is computed by:
1. Loading `.od-baseline.zip` in memory.
2. Walking the working tree, hashing each file.
3. Comparing against the baseline zip: added / modified / deleted paths.
4. Zipping only the added/modified file contents + a `manifest.json` describing the actions.

`.od-baseline.zip` is regenerated (overwritten) on every `open` / `refresh` / approve-by-owner.

The baseline file lives at the project root with a dotfile name so it's naturally hidden from editing surfaces. The zip ignores list adds `.od-baseline.zip` so it never gets accidentally re-uploaded.

## HTTP surface

```
POST /api/cloud/projects/:id/proposals/submit  { message? } → { proposal_id, status: 'pending' | 'stale' }
GET  /api/cloud/projects/:id/proposals?status=pending → [{id, submitter, base_version, message, status, created_at}]
GET  /api/cloud/proposals/:id                   → { ...proposal, files_changed:[{path, action}] }
POST /api/cloud/proposals/:id/approve  { message? } → { new_version: number }
POST /api/cloud/proposals/:id/reject   { message? } → 204
```

`submit` flow on daemon:
1. Verify there's a local copy of this cloud project (i.e. `.od/cloud-projects/<id>/` exists).
2. Verify `base_version` from local SQLite matches backend `current_version` (call `submit_proposal_prepare` RPC).
3. Compute diff between working tree and `.od-baseline.zip`.
4. Build payload zip (changed files only + manifest).
5. INSERT into `change_proposals` with status='pending' (RLS allows editors).
6. Upload payload zip to `proposals/{id}/payload.zip` via Supabase Storage (RLS-checked).

`approve` is a thin HTTP call to the `approve-proposal` Edge Function (already written). Daemon refreshes its local copy of the project on success.

`reject` calls the `reject_proposal` Postgres function via RPC.

## Local data tweaks

`cloud_projects.pending_proposal_id` gets set after submit, cleared on approve/reject notification (Phase 4 also sets it via the notifications poller).

## CLI surface

```
od cloud propose <cloud-project-id> [--message "<m>"]    Submit a proposal.
od cloud proposals list <cloud-project-id> [--status <s>]
od cloud proposals view <proposal-id>                     Show diff + status.
od cloud proposals approve <proposal-id> [--message "<m>"]
od cloud proposals reject <proposal-id>  [--message "<m>"]
```

## UI surface

`ProposalsTab` on a cloud project page:
- List of pending / approved / rejected proposals.
- Click a pending proposal → review screen with side-by-side text diff per file (HTML/CSS/JS).
- Approve / Reject buttons with reviewer message.

`ProposeButton` on the project view:
- Visible to editors (non-owners) when local changes exist.
- Click → confirm dialog → POST /submit.

## Tests

### Unit
- `cloud-proposals-diff.test.ts`:
  - Compute diff: modified / added / deleted detection.
  - Manifest serializes correctly.
- `cloud-proposals-routes.test.ts`:
  - Submit happy path (stubbed Supabase + filesystem).
  - Stale detection.
  - Approve calls Edge Function; refreshes local baseline.

## Acceptance criteria

1. Editor opens project, edits, runs `od cloud propose` → row created with `status='pending'`.
2. Owner sees pending proposal; `od cloud proposals view` shows diff; `approve` returns new version.
3. Stale path: two editors submit; owner approves first; second gets `status='stale'` on next submit attempt or via the notifications channel.

## Out of scope (deferred)

- Visual HTML diff. Text diff is enough for MVP.
- Auto-rebase of stale proposals on the new base. Editor must pull + re-propose.
- Partial approval (cherry-pick files). All-or-nothing for now.
- Binary diff for images. Just show "binary changed".
