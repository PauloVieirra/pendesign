# Design System Variables — Modal refactor + breakpoint modes + auto-seed

**Status:** Draft (awaiting user review)
**Date:** 2026-05-29
**Owner:** Paulo
**Scope:** Single PR

## Summary

Refactor the Design System Variables screen from a full entry-view into a responsive overlay modal aligned with Figma's Variables panel. Introduce **modes (breakpoints)** as columns per collection so each variable carries a value per breakpoint (Desktop/Tablet/Mobile). On new-project creation, seed the design system with a standard set of collections, modes, and starting values. Add search, type filter, typed "Create variable" popover, and column-management UI.

## Motivation

- Current screen is a flat single-value table that doesn't reflect responsive design's per-breakpoint reality. Users have to maintain breakpoint-specific values mentally or in code.
- Layout and interactions diverge from the industry-standard Figma pattern users already know.
- New projects start empty, forcing users to recreate the same baseline (resolution, grid, typography scale) every time.
- Discovery is poor: opening the DS today swaps the entire canvas away, breaking flow.

## Non-goals

- Variable **aliases** (referencing another variable's value). Useful but adds resolution complexity; defer.
- Cross-collection **mode linking** (a single "breakpoint" concept shared across collections). Figma does this but doubles model complexity; per-collection modes are simpler and the common case here.
- Filter by **group** in the advanced filter popover. Only type filter in this PR.
- Importing breakpoints from existing designs/Figma files. Auto-seed uses static defaults; "detect from design" is a future enhancement.

## Data model

### Before

```ts
interface Variable {
  id: string;
  name: string;
  type: 'color' | 'number' | 'string' | 'boolean';
  value: string | number | boolean;
}

interface VariableGroup { id; name; variables: Variable[]; }
interface VariableCollection { id; name; groups: VariableGroup[]; }
interface VariablesFile { version: 1; collections: VariableCollection[]; }
```

### After

```ts
interface Mode {
  id: string;             // stable opaque id
  name: string;           // "Desktop", "Tablet", "Mobile", "Default", or user-defined
  width?: number;         // optional breakpoint width hint (px); displayed under name
}

interface Variable {
  id: string;
  name: string;
  type: 'color' | 'number' | 'string' | 'boolean';
  valuesByMode: Record<string, string | number | boolean>;
}

interface VariableGroup { id; name; variables: Variable[]; }

interface VariableCollection {
  id;
  name;
  groups: VariableGroup[];
  modes: Mode[];          // ordered; at least one mode always present
}

interface VariablesFile { version: 2; collections: VariableCollection[]; }
```

### Migration (daemon-side, on load)

When the daemon loads a `version: 1` file:

1. For each collection, create a single mode `{ id: 'default', name: 'Default' }` and set `collection.modes = [defaultMode]`.
2. For each variable, copy `value` to `valuesByMode['default']`. Remove the `value` field from the in-memory representation; the file written back to disk contains `valuesByMode` only.
3. Set `file.version = 2`.
4. Write the migrated file back atomically.

The migration is idempotent and runs once per file. The on-disk format after migration carries no `value` field — only `valuesByMode`. The PUT endpoint still accepts a legacy `value` payload shape for backwards compatibility with in-flight clients (see API section); incoming `value` is translated server-side into `valuesByMode[<first-mode-id>] = value`.

## Modal

### Trigger

- Button "Design System" in `ProjectView` header (between project title and `AvatarMenu`). Icon + label.
- Keyboard shortcut: `⌘+Shift+D` (macOS) / `Ctrl+Shift+D` (Win/Linux). Bound only when a project is active.
- URL param: `?ds=open` on the project route. Preserved across reload; cleared when modal closes.
- Existing entry-view route `view=design-systems` becomes a redirect: navigate to `{ kind: 'project', projectId, ds: 'open' }`. Old bookmarks keep working.

### Layout

Centered overlay card on top of the project canvas. Backdrop is `rgba(0,0,0,0.45)`, blocks pointer events on canvas. Modal dimensions:

- Desktop (≥1024px): width `min(1120px, calc(100vw - 64px))`, height `min(680px, calc(100vh - 96px))`.
- Tablet (768–1023px): width `calc(100vw - 32px)`, height `calc(100vh - 64px)`. Sidebar collapses to a top tab strip.
- Mobile (<768px): full-screen, no backdrop, no rounded corners. Sidebar slides in as a drawer.

### Close

- `Esc` key (only when search input is not focused; when search is focused, first `Esc` clears search, second `Esc` closes modal).
- Click on backdrop.
- Click on `×` button (top-right).

### Structure

```
┌─ Header (48px) ─────────────────────────────────────────────────────┐
│ Variables  [⤢ sidebar]                  [🔍 Search] [Filter ▾] [⤢ max] [×] │
├─ Sidebar (224px) ────┬─ Main (flex) ───────────────────────────────┤
│ Collections      +   │  Name        Desktop  Tablet  Mobile     +  │
│   Controle       4   │  ── Container Size ────────────────────────  │
│ ▸ Resolution     4   │  □ Resolução  1440    834     412            │
│   Cores        122   │  ── Grid ──────────────────────────────────  │
│   Spacing       48   │  □ Columns    12      8       5              │
│   Style         12   │  □ Margin     48      24      16             │
│   Typography    15   │  □ Gutter     24      16      16             │
│ ────────────         │                                              │
│ Groups           ≡   │                                              │
│ ▸ All            4   │                                              │
│   Container..    1   │                                              │
│   Grid           3   │                                              │
│                      │  + Create variable ▾                         │
└──────────────────────┴──────────────────────────────────────────────┘
```

### Sidebar

**Collections section** (top):

- List of `variables.collections` ordered by their stored order.
- Each item: name + count badge (sum of variables across groups).
- Hover reveals trash + rename pencil icons; active is highlighted.
- "+" button at section header opens an inline input to create a new collection.

**Groups section** (bottom):

- Title "Groups" + a "≡ Group manage" icon (opens a popover with create/rename/delete group actions). Same affordance as image 1.
- "All" pseudo-item at top → clears group filter; its count is the collection total.
- Items: each group in the active collection with count.
- Click filters the main table to only that group; "All" clears the filter.

### Main table

CSS grid with `grid-template-columns: minmax(160px, 1.5fr) repeat(var(--mode-count), minmax(80px, 1fr)) 32px`.

- Header row: `Name | <mode 1> | <mode 2> | ... | +`
- Mode headers are interactive: click opens a popover with rename input and "Delete column" button (with confirm).
- The trailing "+" header button opens a popover to add a new mode (name + optional width). On confirm, new column appears; values copied from the last existing mode as starting points.
- Below header, rows are grouped by `group.name`. Group header is a borderless row with the group name in muted text + small icon to delete the group (right-side, on hover).
- Variable rows: name (left, inline-editable) + one cell per mode (inline-editable). Type icon prefixes the name (Color swatch / Number `#` / String `T` / Boolean `◉`).
- Last row spans full width: `+ Create variable ▾` opens a popover to choose type. Selecting a type appends a new variable to the currently-active group (or first group when "All" is selected), focuses the name input, and sets default values for all modes (`#000000` / `0` / `''` / `false`).
- Right-click (or hover dots) on a variable row reveals: Duplicate, Delete, Move to group…

### Search and filter

**Search input** in header:

- Case-insensitive substring match against `variable.name`.
- Filters the main table only. Group section headers in the table hide when empty.
- Sidebar (Collections + Groups) counts stay total (they don't reflect filter), but a small "× 3 of 4 visible" hint appears under the search input when filtering.
- First `Esc` clears query; second `Esc` closes modal.

**Filter popover** (icon to the right of search):

- Multi-select chips: `Color`, `Number`, `String`, `Boolean`.
- Composes with search (AND).
- Active filter count shows as a badge on the filter icon (`[Filter • 2]`).

### Sidebar toggle and maximize

- `[⤢ sidebar]` button in the title area collapses/expands the sidebar (persists in localStorage per DS).
- `[⤢ max]` button toggles the modal between standard size and `calc(100vw - 16px) × calc(100vh - 16px)` (persists in localStorage per DS).

## Auto-seed on new project

`createEmptyDesignSystemForProject` (already wired in `EntryShell.tsx` ~line 600) gains an optional body param:

```ts
{ seed?: 'empty' | 'defaults' }   // default: 'defaults'
```

When `seed === 'defaults'`, the daemon initializes the file with the following structure before persisting:

| Collection | Modes | Groups | Variables |
|---|---|---|---|
| **Container Size** | Desktop (1440), Tablet (834), Mobile (412) | Resolução | Resolução: `1440 / 834 / 412` |
| **Grid** | Desktop, Tablet, Mobile | Layout | Columns: `12 / 8 / 5`, Margin: `48 / 24 / 16`, Gutter: `24 / 16 / 16` |
| **Typography** | Desktop, Tablet, Mobile | Font Family | Font Family: `Inter / Inter / Inter` |
| | | Size | Display1: `68 / 60 / 52`, Display2: `60 / 52 / 44`, H1: `48 / 40 / 32`, H2: `40 / 32 / 28`, H3: `32 / 28 / 24`, H4: `28 / 24 / 20`, H5: `24 / 20 / 20`, H6: `16 / 16 / 16` |
| | | Weight | Regular: `400 / 400 / 400`, Medium: `500 / 500 / 500`, Bold: `700 / 700 / 700` |
| **Cores** | Default | — | (empty — user adds) |
| **Spacing** | Default | — | (empty) |
| **Style** | Default | — | (empty) |
| **Controle** | Default | — | (empty) |

Values are extracted from the user-supplied reference images. User can edit, rename, delete any of it after creation.

The `seed` constants live in a new file `apps/daemon/src/design-system-seed.ts` exported as `DEFAULT_SEED_V1` for traceability/testing.

## API changes

### Existing endpoints (modified)

- `PUT /api/design-systems/:dsId/variables/:variableId` — body now accepts `valuesByMode?: Record<string, value>` as a **partial patch** (server merges). `value` (legacy single-value) still accepted during migration grace period and routes to the collection's first mode.
- `POST /api/projects/:projectId/design-system/create-empty` — body accepts `{ seed?: 'empty' | 'defaults' }`; default `'defaults'`.

### New endpoints

- `POST /api/design-systems/:dsId/variables/collections/:cid/modes` — body `{ name, width? }`. On create: new mode appended; for every variable in the collection, `valuesByMode[newId]` is initialized as a copy of the last existing mode's value.
- `PUT /api/design-systems/:dsId/variables/collections/:cid/modes/:mid` — body `{ name?, width? }`.
- `DELETE /api/design-systems/:dsId/variables/collections/:cid/modes/:mid` — refuses to delete the last mode (returns 400). Otherwise removes mode + strips that mode's values from all variables in the collection.

### Errors

- 400 — invalid name (empty, > 64 chars), invalid type, refusal cases (last mode, etc.)
- 404 — collection / mode / variable not found
- 409 — duplicate mode name within collection

## Frontend architecture

### New files

- `apps/web/src/components/design-system-manager/DesignSystemModal.tsx` — overlay container, animations, keyboard handling, responsive breakpoints, maximize/sidebar toggle state.
- `apps/web/src/components/design-system-manager/SearchAndFilter.tsx` — search input + filter popover (chips for type).
- `apps/web/src/components/design-system-manager/ModeColumnHeader.tsx` — column cell rendering name + width hint + click-to-popover (rename / delete).
- `apps/web/src/components/design-system-manager/AddModeButton.tsx` — "+" cell at end of header row + popover (name + width).
- `apps/web/src/components/design-system-manager/CreateVariableButton.tsx` — footer "+ Create variable" + type popover.
- `apps/daemon/src/design-system-seed.ts` — `DEFAULT_SEED_V1` constant exported.

### Rewritten files

- `apps/web/src/providers/design-system-variables.ts` — new types (`Mode`, `valuesByMode`); endpoints for modes; updated `updateVariable` payload shape.
- `apps/web/src/components/design-system-manager/VariablesTable.tsx` — CSS-grid layout with dynamic column count; replaces the per-group `<table>` with a single grid; group headers are spanning rows.
- `apps/web/src/components/design-system-manager/VariableRow.tsx` — one input per mode; type icon prefix; row-level menu.
- `apps/web/src/components/design-system-manager/CollectionsSidebar.tsx` — two sections (Collections + Groups), counts, hover actions, manage popover.
- `apps/web/src/components/design-system-manager/DesignSystemManagerView.tsx` — becomes the modal body; no own header/close (modal owns those); receives filtered data.

### Edited files

- `apps/web/src/components/ProjectView.tsx` — DS button in header + `⌘/Ctrl+Shift+D` handler.
- `apps/web/src/components/EntryShell.tsx` — `view === 'design-systems'` branch redirects to project route with `ds=open`.
- `apps/web/src/router.ts` — add `ds?: 'open'` to the project route type and parsers/serializers.
- `apps/web/src/index.css` — modal styles (`.ds-modal__*`), table grid (`.ds-table__*`).

### Daemon-side

- `apps/daemon/src/design-systems.ts` — migration on load; new mode endpoints; `seed` param in `create-empty`.
- `apps/daemon/src/design-system-seed.ts` — new constants file.
- Tests under `apps/daemon/tests/` (or `apps/daemon/src/__tests__/` depending on existing convention) for migration, mode CRUD, seed defaults.

### i18n

New keys (added to `apps/web/src/i18n/types.ts` and all 18 locale files in `apps/web/src/i18n/locales/`):

- `ds.modal.title` — "Variables"
- `ds.modal.search` — "Search"
- `ds.modal.filter` — "Filter"
- `ds.modal.collections` — "Collections"
- `ds.modal.groups` — "Groups"
- `ds.modal.all` — "All"
- `ds.modal.createVariable` — "Create variable"
- `ds.modal.createCollection` — "Create collection"
- `ds.modal.createGroup` — "Create group"
- `ds.modal.addMode` — "Add column"
- `ds.modal.renameMode` — "Rename column"
- `ds.modal.deleteMode` — "Delete column"
- `ds.modal.deleteModeConfirm` — "Delete the {name} column? Values in that column will be lost."
- `ds.modal.empty` — "No variables yet"
- `ds.modal.searchNoResults` — "No variables match the filter"
- `ds.modal.openShortcut` — "Open design system" (used as button title + shortcut hint)
- `ds.types.color`, `ds.types.number`, `ds.types.string`, `ds.types.boolean`
- Seed defaults stay in English on disk (data, not UI); only the labels users see in the UI are translated.

## State

In-modal local state (not persisted across sessions unless noted):

- `activeCollectionId: string | null` — persisted in `localStorage` keyed by DS id.
- `activeGroupId: string | 'all'` — not persisted; defaults to `'all'`.
- `query: string` — not persisted.
- `typeFilter: Set<VariableType>` — not persisted.
- `sidebarCollapsed: boolean` — persisted in `localStorage` keyed by DS id.
- `maximized: boolean` — persisted in `localStorage` keyed by DS id.

`?ds=open` URL param controls mount/unmount.

## Edge cases

- **Last mode delete** — UI disables the delete option when the collection has only one mode. Server enforces with 400.
- **Empty collection / no groups** — table shows a centered empty state ("No groups yet — create one"). Header columns still visible.
- **Empty DS** — modal opens onto the existing empty banner (`DesignSystemEmptyBanner`) unchanged, with same "Create empty / Import" CTAs.
- **Migration concurrency** — if two clients open the same DS during migration, daemon serializes writes via the existing file lock; second client gets the migrated file.
- **Search with empty result** — table shows "No variables match the filter" + a "Clear filter" button.
- **Sidebar collapse on mobile** — collapse is a no-op; sidebar is a drawer regardless.
- **Variable with stale mode value** — if a mode was deleted while another tab had stale state, `updateVariable` against the missing mode id returns 404; client refetches and recovers.
- **Mode count limit** — soft cap at 8 modes per collection (UI hides "+" button above 8). Server doesn't enforce.

## Testing

### Daemon (`apps/daemon`)

- Migration: write a `version: 1` fixture, load → assert `version: 2`, `modes: [default]`, `valuesByMode: { default: <old value> }`. Round-trip idempotent.
- Mode CRUD: create / rename / delete; assert variable `valuesByMode` keys reflect the change; assert "last mode" delete returns 400; assert duplicate name returns 409.
- Seed: `create-empty` with `seed: 'defaults'` returns the full default tree; with `seed: 'empty'` returns version-2 file with no collections.
- Variable PUT: legacy `value` payload routes to first mode; new `valuesByMode` payload merges partial map; unknown mode id returns 404.

### Web (`apps/web`)

Unit tests via Vitest under `apps/web/tests/`:

- `VariablesTable` renders grid with N mode columns for N modes; clicking column header opens rename popover; clicking "+" header opens add-mode popover.
- `CreateVariableButton` popover lists 4 types; clicking type creates row with default values.
- `SearchAndFilter` filters by name and composes with type filter.
- `CollectionsSidebar` renders two sections; clicking a group filters; "All" clears filter.

### e2e (`e2e/tests/`)

New file `ds-variables-modal.test.ts`:

- Create a project (assert defaults seeded — Container Size with 3 modes, Resolução 1440/834/412).
- Open modal via `⌘+Shift+D`, assert overlay visible, project canvas dimmed.
- Add a mode "XL" with width 1920; assert column appears + all variables get a value.
- Edit a value; close modal; reopen; assert persisted.
- Search "col"; assert only Columns row visible across groups.
- Filter type=Number; combined with search.
- Delete a mode (not last); confirm dialog; assert column gone.
- Try delete last mode; assert disabled.
- Close via Esc; assert URL param cleared.

## Rollout

- Single PR, gated only by the PR template's existing checklist (no feature flag — the migration runs on every load).
- Risk: legacy DS files are rewritten on first load post-deploy. Mitigation: migration is idempotent and only adds; original values land verbatim under the `default` mode id.
- Recovery: if migration corrupts a file in the wild, the daemon keeps a `.bak` next to the JSON for ~1 release.

## Open questions (none blocking)

- Should new collections created by the user default to 1 mode ("Default") or 3 modes (Desktop/Tablet/Mobile)? **Decision:** 1 mode. User explicitly adds modes if they need them.
- Should mode order be drag-reorderable? **Decision:** No drag in this PR — order is creation order. Future enhancement.
- Should the filter popover include "has empty values" filter? **Decision:** No, future enhancement.
