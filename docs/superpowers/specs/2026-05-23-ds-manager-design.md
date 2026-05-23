# Design System Manager (project-scoped) — Design

Status: approved
Owner: paulo.junior@seatecnologia.com.br
Subproject: A of A/B/C/D (see "Roadmap" below)

## Goal

When the user is inside a project and clicks **Design Systems** in the
file viewer toolbar, the app opens a Figma-Variables-style management
screen for the project's design system. The user can browse, create,
edit, group, and delete variables of four types (color, number,
string, boolean). Changes are persisted to disk and become the
source of truth for the DS attached to the project.

This document covers ONLY the Manager surface (Subproject A).
Three companion subprojects are out of scope here and tracked
separately:

- **B — DS↔project wiring.** Inject `<link rel="stylesheet" href="...">`
  into project HTML, serve `tokens.css` from the DS path, hot-reload on
  edits.
- **C — Property bar binding.** Add a "variable" affordance to each
  editable property in `ManualEditPanel` so the user can bind a prop to
  a DS variable (writes `var(--token-name)` to the inline style).
- **D — Agent-aware generation.** When a project has a DS attached, the
  generator agent receives `tokens.css` and instructions to use the
  variables + add the stylesheet link in newly generated screens.

Subproject A is the foundation; B/C/D depend on its variable model
and storage layout.

## Constraints and decisions

- **DSs are exclusive to a project.** A DS created or imported from
  inside a project carries `manifest.source.projectId = <projectId>`.
  Project-bound DSs are NOT listed in the global library. Library DSs
  are NOT mutable from inside a project (they are read-only templates).
- **Auto-save.** No "Save" button. Edits are debounced ~600ms and
  written atomically via per-variable PUT.
- **Structured storage replaces freeform tokens.css.** A new file
  `variables.json` carries the editable model. `tokens.css` is
  regenerated from it on every save and remains the runtime-facing
  artifact.
- **Migration is automatic and idempotent.** First time a DS is opened
  in the Manager, if `variables.json` is missing, it is created from
  the existing `tokens.css` heuristically.
- **Figma import writes `variables.json` directly.** Future imports
  (Subproject A onward) preserve the file's collection / group
  hierarchy verbatim instead of flattening into `tokens.css`.
- **Variable types are color, number, string, boolean.** Only these
  four. Aliases / references between variables are out of scope for
  Subproject A.

## Route and entry points

| Route | View |
|---|---|
| `/design-systems` | Existing global library (no change). |
| `/design-systems?project=<id>` | New `DesignSystemManagerView`. Shows the project's DS, or an empty state if the project has none. |

The toolbar button in `FileViewer.tsx` already navigates to
`/design-systems?project=<id>` (from the earlier rename PR). No
router changes needed.

## UI layout

### Empty state (project has no DS)

A centered card with three actions:

- **Create new design system** (defers to `/design-systems/create`
  with the project id carried through so the resulting DS is bound).
- **Import from Figma** (reuses `FigmaImportRow` from
  `DesignSystemsTab`; on success, sets `designSystemId` on the
  project and stamps `manifest.source.projectId`).
- **Import from disk** (reuses `importLocalDesignSystem`).
- **Pick from library** (lists existing library DSs as "fork into
  project" — clones into a new project-bound DS).

### Populated state — three-column layout

```
┌─────────────┬───────────────────────────────────────────────┐
│ Sidebar     │ Header: collection name + breadcrumb + status │
│             ├───────────────────────────────────────────────┤
│ Collections │ Group selector pills                          │
│  Cores 122  │                                                │
│  Spacing 48 │ Name        Value           Type   Actions    │
│  Style   12 │ ─────────────────────────────────────────────  │
│  Typo    15 │ 100         ■ #FDEEE9       color  Edit Del   │
│             │ 200         ■ #FAD8CD       color  Edit Del   │
│ Groups      │ ...                                            │
│  All  122   │ + Create variable                              │
│  Orange 9   │                                                │
│  Blue  13   │                                                │
└─────────────┴───────────────────────────────────────────────┘
```

Header: collection name, "Saved · 2s ago" indicator, "+ New collection".

### Per-row edit affordance

Inline editor by type:

| Type | Editor |
|---|---|
| `color` | hex text input + native `<input type="color">` swatch; both stay in sync |
| `number` | numeric input; optional unit toggle (px/rem) |
| `string` | text input |
| `boolean` | toggle switch |

Esc cancels; tab/enter commits. The row contains a per-variable
"actions" menu: Rename, Move to group, Delete.

## Data model

### `variables.json`

```json
{
  "version": 1,
  "collections": [
    {
      "id": "cores",
      "name": "Cores",
      "groups": [
        {
          "id": "orange",
          "name": "Orange",
          "variables": [
            {
              "id": "v_1",
              "name": "100",
              "type": "color",
              "value": "#FDEEE9"
            },
            {
              "id": "v_2",
              "name": "200",
              "type": "color",
              "value": "#FAD8CD"
            }
          ]
        }
      ]
    }
  ]
}
```

- `id` values are stable nanoids generated server-side. Renaming the
  human-readable `name` never changes the `id`, so future bindings
  (Subproject C) stay valid.
- Collections and groups are ordered arrays (preserve user reorder).
- Variables within a group are likewise ordered.

### CSS naming convention

`tokens.css` regenerated from `variables.json` uses
`--<collectionSlug>-<groupSlug>-<varNameSlug>`, e.g. `--cores-orange-100`.
Slugging: lowercase, hyphenated, non-alphanumeric collapsed. Two
variables that would resolve to the same slug get a `-2`, `-3` suffix.

### Manifest changes

`manifest.json` gains:

```json
{
  "source": {
    "type": "figma" | "local" | "github" | "created",
    "projectId": "<project-id-or-null>",
    ...existing fields
  }
}
```

`projectId` is `null` for library DSs and set when the DS was created
in the context of a project.

## API surface (daemon)

All endpoints under `/api/design-systems/:id/...` and gated by
`requireLocalOrigin`.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/variables` | Returns `variables.json`. If missing, runs migration from `tokens.css` and writes the file before responding. |
| `PUT` | `/variables` | Replaces `variables.json` (whole-document replace). Regenerates `tokens.css`. |
| `PUT` | `/variables/:variableId` | Atomic single-variable update — name/value/type. Server side: load, mutate, save, regen. |
| `POST` | `/variables/collections` | Creates a collection. Body: `{ name }`. |
| `DELETE` | `/variables/collections/:collectionId` | Removes a collection (and its groups + variables). |
| `POST` | `/variables/collections/:collectionId/groups` | Creates a group. Body: `{ name }`. |
| `DELETE` | `/variables/collections/:collectionId/groups/:groupId` | Removes a group. |
| `POST` | `/variables/collections/:collectionId/groups/:groupId/variables` | Creates a variable. Body: `{ name, type, value }`. |
| `DELETE` | `/variables/:variableId` | Deletes a variable. |

`tokens.css` regeneration runs synchronously inside the same request
so consumers reading `tokens.css` after the PUT response see the new
content.

Concurrency: the server uses a per-DS in-memory async lock so multiple
in-flight PUTs cannot interleave. Lock granularity is the DS dir.

Errors return `{ error: { code, message } }` with 400 for validation,
404 when the DS or sub-entity is missing, 409 on lock contention (the
client retries).

## Project ↔ DS binding

- When the user creates/imports a DS from the Manager's empty state,
  the daemon endpoint additionally writes the new DS id to the
  project record (`projects.<id>.designSystemId`).
- A project-bound DS carries `manifest.source.projectId` so it is
  excluded from the global library listing.
- `GET /api/design-systems?projectId=<id>` is added to list project-
  bound DSs (used by the Manager to discover the project's DS without
  fetching the full catalog).

Subproject A does NOT change how the project consumes the DS at
runtime — that is Subproject B's job.

## Migration logic

Run when `GET /api/design-systems/:id/variables` finds no
`variables.json`:

1. Read `tokens.css`. Bail if it does not exist (return empty
   `variables.json` with one default "Default" collection).
2. Tokenize `:root { ... }` block. For each CSS custom property:
   - `--color-*` → collection "Colors", type `color`.
   - `--font-*-family|size|weight|line-height|letter-spacing` →
     collection "Typography", type matching the family/weight/etc.
   - `--space-*` → collection "Spacing", type `number`.
   - `--radius-*` → collection "Radii", type `number`.
   - `--shadow-*` → collection "Effects", type `string` (full CSS
     value).
   - Anything else → "Other" collection, best-guess type.
3. Group by the second segment (`--cores-orange-100` →
   collection "Cores", group "Orange", variable "100"). Variables
   without a clear group land in a synthetic "Default" group.
4. Generate stable `v_N` ids. Persist `variables.json`.

Migration is one-way: subsequent PUTs always update
`variables.json` and regenerate `tokens.css` — never the other way.

## Web client components

New files under `apps/web/src/components/design-system-manager/`:

- `DesignSystemManagerView.tsx` — orchestrator. Owns fetch + state.
  Receives `projectContext` from the route.
- `EmptyState.tsx` — onboarding card when project has no DS.
- `CollectionsSidebar.tsx` — left rail.
- `VariablesTable.tsx` — center table.
- `VariableRow.tsx` — single row with the type-specific editor.
- `ColorEditor.tsx` — hex input + native color picker.
- `NumberEditor.tsx` — number input + unit toggle.
- `StringEditor.tsx` — plain text.
- `BooleanEditor.tsx` — toggle.

`EntryShell.tsx` branches: when `route.projectContext` is set, render
`DesignSystemManagerView` instead of the existing `DesignSystemsTab`.

New file `apps/web/src/providers/design-system-variables.ts` —
client functions for the new API endpoints, returning typed results.

## Auto-save behavior

- Per-row edits debounce 600ms and PUT
  `/api/design-systems/:id/variables/:variableId`.
- During the debounce window, the row shows a small "•" dot.
- On success, header updates "Saved · just now". On failure, the row
  shows an inline error and reverts to the previous value.
- Optimistic updates: local state changes immediately; rollback on
  failure.

## Error handling

| Scenario | Behavior |
|---|---|
| Network failure during PUT | Optimistic state rolled back; toast with retry. |
| DS id is invalid / DS deleted in another tab | View shows empty state with "Design system no longer exists". |
| Concurrent edit (409 from server lock) | Auto-retry once with 250ms delay; failure surfaces toast. |
| Type mismatch on PUT (color value when type is number) | Server rejects with 400; row shows inline error. |
| Migration fails (malformed `tokens.css`) | Manager opens with an empty `variables.json` and a warning banner explaining that the import was best-effort and the user can rebuild from scratch. |

## Testing

- Unit tests for the migration parser (`tokens.css` → `variables.json`).
  Sample inputs: airbnb-style flat names, namespaced names, mixed
  type tokens, malformed input.
- Unit tests for the slug → CSS name generator (collision handling).
- API integration: e2e covering CRUD on collection / group / variable
  endpoints, including the per-DS lock under concurrent PUTs.
- UI smoke: Playwright run that opens the Manager from the toolbar,
  edits a color, verifies `tokens.css` on disk reflects the change.

## Out of scope (deferred to B/C/D)

- Reading the user-edited tokens at preview time.
- Binding a variable to a component property in Edit mode.
- The agent receiving tokens during generation.
- Aliases / cross-variable references.
- Mode/theme support (Figma has multiple modes per collection;
  Subproject A persists only the default-mode value per variable).

## Roadmap

Once Subproject A ships:

1. **D — Agent-aware generation.** Smallest diff, biggest user value.
   Update `composeDaemonSystemPrompt` (already injects RAG chunks) to
   also embed the project's `tokens.css` and a CONTRACT instruction
   ("use these CSS variables; do not invent literal hex").
2. **B — DS↔project wiring.** Daemon serves `tokens.css` from the
   project's DS; project HTML gets a `<link>` injected at attach
   time; SSE notifies the iframe on variable changes so it
   hot-reloads.
3. **C — Property bar binding.** Each editable prop in
   `ManualEditPanel` gains a "Variable" picker. Persists as
   `var(--token-name)` in inline style. Editing the variable in A
   then propagates everywhere by virtue of CSS variable cascade
   (made live by B).

## Open risks

- **Slug collisions across collections.** Two collections named
  "Cores" + "Colors" both have an "Orange" group with a "100"
  variable: slugs collide. Resolved via numeric suffix; documented in
  the CSS rendering layer.
- **Migration losses.** Heuristic parsing of `tokens.css` may
  misclassify edge cases (e.g. `--brand-primary` → unclear which
  collection). Acceptable for v1: the user can re-group via the UI.
- **Single-machine lock.** Per-DS in-memory lock does not cover the
  case where two clients edit the same DS concurrently from different
  desktop sessions. Out of scope for now; the lock prevents the
  request-level race that matters.
