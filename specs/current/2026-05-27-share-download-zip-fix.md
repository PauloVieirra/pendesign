# Share → Download as zip: full project + skip build dirs

## Purpose

Fix the Share menu's "Download as .zip" so the resulting archive contains
the **entire project tree** instead of being silently scoped to the first
path segment of whichever file the user happens to have open. While
fixing, exclude install/build directories (`node_modules`, `.git`,
`dist`, etc.) from the archive so React/SPA projects do not balloon to
hundreds of MB.

## Scope

### In scope

1. **Frontend**: `exportProjectAsZip` always requests the whole project
   (no `?root=` query). Drop `archiveRootFromFilePath` and the `filePath`
   parameter on the call site.
2. **Backend**: `collectArchiveEntries` filters out the same directory
   set that `listFiles` already filters
   (`node_modules`, `.git`, `dist`, `build`, `.next`, `.nuxt`, `.turbo`,
   `.cache`, `.output`, `out`, `coverage`, `__pycache__`, `.venv`,
   `vendor`, `target`, `.od`, `.tmp`).
3. **Cleanup**: delete the duplicate `/api/projects/:id/archive` (and
   `/archive/batch`) route block in `apps/daemon/src/server.ts` —
   identical handler already lives in `import-export-routes.ts` and is
   the active registration.
4. **Tests**:
   - Backend unit test asserting `node_modules/` is excluded and
     ordinary files are included.
   - Backend unit test asserting an archive of a multi-level project
     contains files from sibling directories (no implicit scoping).
   - Frontend unit test asserting `exportProjectAsZip` fetches
     `/api/projects/:id/archive` with **no query string**.

### Out of scope

- Adding a separate "Download this subfolder" affordance. Removed.
- Renaming the archive (still derives from project name via daemon's
  Content-Disposition).
- Streaming the archive (current handler reads into a `Buffer` then
  responds; fine for typical project sizes).
- Filtering `.gitignore` rules. The fixed denylist is enough.

## Architecture

### Current behavior (the bug)

```
[FileViewer share menu]
    ↓ exportProjectAsZip({ projectId, filePath: "subdir/foo.html", ... })
[runtime/exports.ts]
    root = archiveRootFromFilePath("subdir/foo.html")  // → "subdir"
    fetch("/api/projects/:id/archive?root=subdir")
[daemon: import-export-routes.ts → buildProjectArchive]
    archiveRoot = projectRoot/subdir
    collectArchiveEntries walks subdir only
    → zip contains files inside subdir/, NOTHING ELSE
```

For React/SPA projects the open file is usually `src/main.tsx` or
similar, so the user gets `src/` only and loses `package.json`, `public/`,
`vite.config.ts`, etc.

### Fixed behavior

```
[FileViewer share menu]
    ↓ exportProjectAsZip({ projectId })  // no filePath
[runtime/exports.ts]
    fetch("/api/projects/:id/archive")   // no ?root
[daemon: import-export-routes.ts → buildProjectArchive]
    archiveRoot = projectRoot
    collectArchiveEntries walks projectRoot
        skipping SKIP_DIRS at every level
    → zip contains every visible file across the whole project,
      minus node_modules and friends
```

### `SKIP_DIRS` reuse

The backend already defines this set for the file panel:

```ts
// apps/daemon/src/projects.ts:80
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.turbo',
  '.cache', '.output', 'out', 'coverage', '__pycache__', '.venv',
  'vendor', 'target', '.od', '.tmp',
]);
```

`collectArchiveEntries` will check `SKIP_DIRS.has(entry.name)` before
recursing into a directory. Files at the top-level of the project that
happen to share the name (e.g. a file literally named `dist`) keep their
existing handling — only the directory check matters.

### Why exclude unconditionally (not just for `metadata.baseDir`)

`listFiles` today only applies `SKIP_DIRS` when the project is linked to
a user folder (`metadata.baseDir` set). For Vision-Design-managed
projects under `~/Library/Application Support/.../projects/`, `node_modules`
is unlikely, but `.git` and `.tmp` may appear (especially from imports
or from `agent-browser` skills that scaffold their own toolchains).
Exclusion is cheap and consistent — always-skip is simpler than
conditional-skip and matches the user's stated wish ("a pasta node_modules
não deve ser incluida").

### Duplicate route removal

`server.ts:7621-7706` registers `app.get('/api/projects/:id/archive', …)`
and the matching `/archive/batch` POST. The same handlers exist verbatim
in `import-export-routes.ts:257-329`, which `registerImportExportRoutes`
wires up earlier in server bootstrap. Express keeps the first match; the
duplicate is dead code that creates drift risk. Delete the `server.ts`
copy.

## Implementation surface

| File | Change |
|------|--------|
| `apps/web/src/runtime/exports.ts` | Simplify `exportProjectAsZip` to fetch without `?root`; drop `archiveRootFromFilePath`. Keep `archiveFilenameFrom` and the fallback to `exportAsZip(fallbackHtml, fallbackTitle)`. |
| `apps/web/src/components/FileViewer.tsx:7114` | Stop passing `filePath`; pass only `projectId`, `fallbackHtml`, `fallbackTitle`. |
| `apps/web/tests/runtime/exports.test.ts` (or wherever current tests live) | Remove `archiveRootFromFilePath` tests; add an `exportProjectAsZip` test that asserts the fetched URL has no query string. |
| `apps/daemon/src/projects.ts:444-465` | `collectArchiveEntries` skips `SKIP_DIRS` entries. |
| `apps/daemon/tests/...` | Add a test that creates a temp project with `node_modules/foo.js` + `index.html` and asserts the archive contains only `index.html` plus the two synthetic handoff files. Add a second test creating `src/main.tsx` + `package.json` at root and asserts both land in the zip. |
| `apps/daemon/src/server.ts:7615-7706` | Delete the duplicate route block. |

## Edge cases

- **Empty project after exclusion**: a project that contains only
  `node_modules/` would archive empty. `buildProjectArchive` already
  throws `archive root is empty` → 404 in that case. Fine.
- **Symlinks**: `collectArchiveEntries` reuses the same `lstat` walk;
  removing entries by name happens before recursion. No symlink-escape
  regression.
- **Nested `node_modules`**: a `lean-inception/node_modules` would also
  be skipped (the check is name-based at every level). Intended.
- **Case sensitivity**: `SKIP_DIRS` entries are lowercase. On
  case-insensitive filesystems (macOS default APFS, Windows), a
  directory named `Node_Modules` is the same inode but compares
  differently as a JS string. Use `entry.name.toLowerCase()` for the
  check — keeps behavior identical to what users expect from
  case-insensitive filesystems.

## Tests

### Backend (new)

`apps/daemon/tests/build-project-archive.test.ts` (or extend an existing
sibling):

```ts
it('excludes node_modules and other build dirs', async () => {
  await mkdir(join(projectRoot, 'node_modules', 'left-pad'), { recursive: true });
  await writeFile(join(projectRoot, 'node_modules', 'left-pad', 'index.js'), 'export default 1');
  await writeFile(join(projectRoot, 'index.html'), '<!doctype html>');
  const { buffer } = await buildProjectArchive(projectsRoot, projectId, '');
  const names = listZipEntries(buffer);
  expect(names).toContain('index.html');
  expect(names.some((n) => n.startsWith('node_modules/'))).toBe(false);
});

it('archives sibling directories without scoping', async () => {
  await mkdir(join(projectRoot, 'src'), { recursive: true });
  await mkdir(join(projectRoot, 'public'), { recursive: true });
  await writeFile(join(projectRoot, 'src', 'main.tsx'), 'export {}');
  await writeFile(join(projectRoot, 'public', 'favicon.ico'), '');
  await writeFile(join(projectRoot, 'package.json'), '{}');
  const { buffer } = await buildProjectArchive(projectsRoot, projectId, '');
  const names = listZipEntries(buffer);
  expect(names).toContain('src/main.tsx');
  expect(names).toContain('public/favicon.ico');
  expect(names).toContain('package.json');
});
```

### Frontend (revised)

`apps/web/tests/runtime/exports.test.ts` (extend the existing file
covering `archiveRootFromFilePath` / `archiveFilenameFrom`):

```ts
it('fetches the project archive without scoping the request', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(new Blob(['ok']), { status: 200, headers: { 'content-disposition': 'attachment; filename="p.zip"' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await exportProjectAsZip({ projectId: 'p1', fallbackHtml: '<i/>', fallbackTitle: 'p' });
  expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/archive');
});
```

Existing `archiveRootFromFilePath` tests get deleted alongside the
helper.

## Risks

- **Removing scoping silently changes UX for power users who relied on
  the auto-scope behavior**: unlikely (the auto-scope was undocumented
  and arguably accidental — the comment string in the function names it
  as "if you're viewing a file in a subdirectory"). The plan note +
  release notes flag the change.
- **Server-side `SKIP_DIRS` change affects `/archive/batch` too if it
  shared the walker**: confirmed it does not — `buildBatchArchive`
  walks via explicit filenames, not recursion. Safe.
- **Duplicate-route removal could regress if the wrong copy was the
  active one**: verified by reading the bootstrap — `registerImportExportRoutes`
  runs before the in-`server.ts` block, so Express resolves to the
  import-export-routes copy. Deleting the duplicate is a no-op in
  effect.

## Open questions

None. The user confirmed: always whole project, always exclude
`node_modules` and build dirs.
