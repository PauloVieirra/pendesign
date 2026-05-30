# Recovered work

This directory holds patches reconstructed from orphaned git stashes —
work that was stashed and never applied/committed, found via
`git fsck --unreachable`. Each patch is committed here for safekeeping
so the underlying objects can be safely garbage-collected; manual port
to the current architecture is left as a TODO.

## Inventory

### `2026-05-24-drag-and-drop-edit-mode.patch`

- **Origin**: stash `21409b8` (author `vgents`, May 24 2026)
- **What it adds**: cross-parent drag-and-drop reordering for the
  edit-mode bridge. Hit-tests via `elementFromPoint`, axis-aware
  before/after decision driven by parent's `flex-direction`, 20% edge
  zones for sibling drops vs centre zone for drop-inside containers.
  Includes a `DROP_INSIDE_TAGS` allowlist (section/main/nav/article/
  header/footer/aside/div/figure/ul/ol/dl), `parentFlexAxis`,
  `paintDropIndicator`, and 114 lines of new tests.
- **Why it's a patch, not a cherry-pick**: the patch targets
  `apps/web/src/edit-mode/bridge.ts`, which has since been refactored
  into `packages/edit-bridge/src/bridge.ts` with a different
  surrounding architecture. Direct application produces non-trivial
  conflicts that need manual review against the new structure.
- **Port checklist**:
  - Identify the equivalent entry point in `packages/edit-bridge/src/bridge.ts`
    where pointer events are handled.
  - Re-implement the mousedown → custom-drag flow using the
    sibling-aware hit-testing logic from the patch.
  - Wire the drop indicator into the same overlay surface the new
    bridge already maintains for selection.
  - Re-add the test file at a current location
    (`packages/edit-bridge/tests/` or wherever the new bridge tests live).
  - Verify the message contract (`od-edit-reorder` or similar) matches
    what the host expects today.

Apply the patch verbatim only if you're checked out at base commit
`27566b2`; otherwise use it as a reference document for manual port.
