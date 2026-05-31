# Phase 4 — Notifications + proposal comments (detailed spec)

Status: Approved (autonomous execution). Parent: `2026-05-28-multi-user-supabase-design.md`.
Owner: paulo.junior@seatecnologia.com.br
Date: 2026-05-28
Depends on: Phase 3 (proposals).

## Goal

In-app inbox surfaces invitations, proposal events, and comments. Threaded comments on each proposal. Background polling keeps the badge counter live.

## File structure

```
apps/daemon/src/cloud/
├── cloud-notifications-routes.ts   — /api/cloud/notifications/* + comments
└── cloud-notifications-poller.ts   — periodic poll, pushes to SSE channel

apps/daemon/tests/cloud/
└── cloud-notifications-routes.test.ts
```

## HTTP surface

```
GET    /api/cloud/notifications [?unread_only=1&limit=50&before=<cursor>]
                                        → { notifications:[{id, type, payload, read_at, created_at}], cursor? }
GET    /api/cloud/notifications/unread-count
                                        → { count: number }
PATCH  /api/cloud/notifications/:id/read
                                        → 204
POST   /api/cloud/notifications/mark-all-read
                                        → { updated_count: number }

GET    /api/cloud/proposals/:id/comments
                                        → { comments:[{id, author_id, author_name, body, created_at, edited_at?}] }
POST   /api/cloud/proposals/:id/comments  { body }
                                        → { comment: {...} }
```

All four notifications routes pass the call through to Supabase RLS (the user only sees their own rows). All comments routes are gated by membership (RLS-enforced).

## Database side

Notification fan-out triggers are already in `20260528000005_phase4_notifications_comments.sql`:
- `invitations_notify` on `project_invitations` INSERT
- `proposals_notify` on `change_proposals` INSERT
- `proposals_review_notify` on `change_proposals` UPDATE
- `comments_notify` on `proposal_comments` INSERT

The daemon doesn't need to insert notifications itself.

## Daemon-side poller

Every 30 seconds while the daemon is running AND a session exists:
1. GET `/notifications/unread-count`.
2. If changed since last poll, broadcast via the daemon's existing SSE channel
   so the web UI's badge updates without a manual refresh.

(Re-using the daemon's existing SSE event system; new event type
`'cloud:notifications-changed'` with payload `{ count: number }`.)

## CLI surface

```
od cloud notifications list [--unread] [--json]
od cloud notifications unread-count [--json]
od cloud notifications read <id> [--json]
od cloud notifications read-all [--json]
od cloud comments list <proposal-id> [--json]
od cloud comments add <proposal-id> --body "..." [--json]
```

## UI surface

`InboxButton` in the app chrome top bar:
- Badge with unread count (from SSE-driven state).
- Click opens a drawer with paginated list.
- Each notification click leads to context (open proposal, accept invitation, etc.) and marks as read.

`ProposalCommentsPanel` on the proposal review screen:
- Thread list (sorted oldest-first).
- Add-comment field at the bottom.

## Tests

### Unit
- `cloud-notifications-routes.test.ts`:
  - Notification list/unread-count/read endpoints with stubbed Supabase.
  - Comments list + add.

### Integration (manual)
- Invite user → invited account sees a notification.
- Submit proposal → owner sees notification.
- Add comment → other participant sees notification.

## Acceptance criteria

1. `od cloud notifications list` shows entries with type + payload.
2. `od cloud notifications unread-count` returns a number.
3. `od cloud comments add <prop> --body "lgtm"` succeeds; `comments list` shows it.

## Out of scope (deferred)

- Email digest for non-invitation notifications. Phase 5.
- Realtime push via Supabase Realtime (replacing the 30s poll). Phase 5.
- Comment editing / deletion. Phase 5.
- Threaded replies (nested comments). Phase 5.
