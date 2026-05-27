# Share Download Zip Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Share → Download as .zip` produce a full-project archive that excludes regenerable directories (`node_modules`, build outputs, etc.).

**Architecture:** Two surgical fixes. (1) Backend `collectArchiveEntries` honors the existing `SKIP_DIRS` set (the same one `listFiles` uses) and applies a case-insensitive directory-name check. (2) Frontend `exportProjectAsZip` stops scoping the request to the open file's first path segment, and the `archiveRootFromFilePath` helper + its tests are removed. Also deletes a duplicate `/api/projects/:id/archive` route registration that drifted from its sibling in `import-export-routes.ts`.

**Tech Stack:** Node 24 / pnpm 10.33.2 / TypeScript / Express (daemon) / React 18 + Next.js (web) / Vitest + JSZip for tests.

**Spec:** `specs/current/2026-05-27-share-download-zip-fix.md`

---

## Pre-flight

- [ ] **Confirm working tree clean on branch `teste` from HEAD `c4f55cb`:**
  ```bash
  cd /Users/elite1/dev/pendesign && git status
  ```
  Expected: `nothing to commit, working tree clean`. If anything is staged or modified, stash before proceeding.

- [ ] **Run baseline tests** so post-task drift is attributable:
  ```bash
  cd /Users/elite1/dev/pendesign/apps/web && npx vitest run tests/runtime/exports.test.ts --reporter=line 2>&1 | tail -5
  cd /Users/elite1/dev/pendesign/apps/daemon && npx vitest run tests/project-archive.test.ts --reporter=line 2>&1 | tail -5
  ```
  Expected: both green pre-change. Capture the test counts so the new ones can be told apart.

---

## Task 1: Backend — `collectArchiveEntries` skips build/install dirs

**Files:**
- Modify: `apps/daemon/src/projects.ts:444-465` (`collectArchiveEntries`)
- Test: `apps/daemon/tests/project-archive.test.ts` (extend existing `describe('buildProjectArchive')`)

- [ ] **Step 1: Read current `collectArchiveEntries` to confirm shape.**

```bash
sed -n '440,470p' /Users/elite1/dev/pendesign/apps/daemon/src/projects.ts
```

Expected output is the function below (only the loop changes; the entry-shape and traversal-order stay):

```ts
async function collectArchiveEntries(dir, relDir, out) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (!e.isDirectory() && !e.isFile()) continue;
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await collectArchiveEntries(full, rel, out);
      continue;
    }
    if (e.name.endsWith('.artifact.json')) continue;
    const st = await stat(full);
    out.push({ relPath: rel, fullPath: full, mtime: st.mtimeMs });
  }
}
```

- [ ] **Step 2: Write the failing tests.**

Open `apps/daemon/tests/project-archive.test.ts` and append two new `it` blocks **inside** the existing `describe('buildProjectArchive', () => { … })` (before its closing `});`).

The fixture's `beforeEach` already creates `ui-design/`, `src/`, `frames/`, etc. The new tests create *additional* tree pieces in their own setup so they remain independent. Add at the end of the describe:

```ts
  it('excludes node_modules and other build dirs from the whole-project archive', async () => {
    const dir = path.join(projectsRoot, projectId);
    await mkdir(path.join(dir, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(
      path.join(dir, 'node_modules', 'left-pad', 'index.js'),
      'module.exports = (s) => s;',
    );
    await mkdir(path.join(dir, 'dist'), { recursive: true });
    await writeFile(path.join(dir, 'dist', 'bundle.js'), '/* compiled */');
    await mkdir(path.join(dir, '.next'), { recursive: true });
    await writeFile(path.join(dir, '.next', 'build-manifest.json'), '{}');

    const { buffer } = await buildProjectArchive(projectsRoot, projectId, '');
    const zip = await JSZip.loadAsync(buffer);
    const fileEntries = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name);

    expect(fileEntries).toContain('README.md');
    expect(fileEntries.some((n) => n.startsWith('node_modules/'))).toBe(false);
    expect(fileEntries.some((n) => n.startsWith('dist/'))).toBe(false);
    expect(fileEntries.some((n) => n.startsWith('.next/'))).toBe(false);
  });

  it('excludes build dirs case-insensitively (Node_Modules, DIST)', async () => {
    const dir = path.join(projectsRoot, projectId);
    await mkdir(path.join(dir, 'Node_Modules'), { recursive: true });
    await writeFile(path.join(dir, 'Node_Modules', 'a.js'), '');
    await mkdir(path.join(dir, 'DIST'), { recursive: true });
    await writeFile(path.join(dir, 'DIST', 'b.js'), '');

    const { buffer } = await buildProjectArchive(projectsRoot, projectId, '');
    const zip = await JSZip.loadAsync(buffer);
    const fileEntries = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name);

    expect(fileEntries.some((n) => /^node_modules\//i.test(n))).toBe(false);
    expect(fileEntries.some((n) => /^dist\//i.test(n))).toBe(false);
  });
```

- [ ] **Step 3: Run the new tests; confirm they FAIL.**

```bash
cd /Users/elite1/dev/pendesign/apps/daemon
npx vitest run tests/project-archive.test.ts --reporter=line 2>&1 | tail -15
```

Expected: both new tests FAIL — current `collectArchiveEntries` includes those directories. Existing tests (whole-project, subdirectory, etc.) still pass.

- [ ] **Step 4: Implement the skip.**

`SKIP_DIRS` already exists at `apps/daemon/src/projects.ts:80` and is **module-scoped** to that file. Reuse it directly inside `collectArchiveEntries`. Replace the body so the directory branch checks the name before recursing:

```ts
async function collectArchiveEntries(dir, relDir, out) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (!e.isDirectory() && !e.isFile()) continue;
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip install/build dirs that npm/yarn/etc. regenerate locally.
      // Case-insensitive match (macOS APFS and Windows are case-insensitive
      // by default — a folder named "Node_Modules" should still be skipped).
      if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
      await collectArchiveEntries(full, rel, out);
      continue;
    }
    if (e.name.endsWith('.artifact.json')) continue;
    const st = await stat(full);
    out.push({ relPath: rel, fullPath: full, mtime: st.mtimeMs });
  }
}
```

`SKIP_DIRS` entries are already lowercase (`node_modules`, `.git`, `dist`, etc.), so `entry.name.toLowerCase()` produces the right comparison key.

Note: the existing `if (e.name.startsWith('.'))` line above already drops `.git` (which begins with `.`). The `SKIP_DIRS` check is redundant for `.git` but covers the remaining entries (`node_modules`, `dist`, `build`, …). Keep both — the dotfile filter exists for sidecar metadata files too, not just dirs.

- [ ] **Step 5: Re-run; confirm tests PASS, no regression.**

```bash
cd /Users/elite1/dev/pendesign/apps/daemon
npx vitest run tests/project-archive.test.ts --reporter=line 2>&1 | tail -15
```

Expected: all tests in the file PASS, including the two new ones and the four existing assertions (subdir scoping, whole-project, traversal rejection, etc.).

- [ ] **Step 6: Commit.**

```bash
cd /Users/elite1/dev/pendesign
git add apps/daemon/src/projects.ts apps/daemon/tests/project-archive.test.ts
git commit -m "fix(daemon): exclude node_modules and build dirs from project archive"
```

No `Co-Authored-By` trailer (AGENTS.md root).

---

## Task 2: Backend — remove duplicate `/api/projects/:id/archive` route in `server.ts`

**Files:**
- Modify: `apps/daemon/src/server.ts:7615-7706` (delete the duplicate block)

The active route registration is in `apps/daemon/src/import-export-routes.ts:257-329`, wired by `registerImportExportRoutes` early in server bootstrap. Express uses the **first** registration, so the `server.ts` copy is dead. Deletion is a no-op in behavior; it prevents future drift between the two copies.

- [ ] **Step 1: Confirm the block to delete.**

```bash
sed -n '7615,7710p' /Users/elite1/dev/pendesign/apps/daemon/src/server.ts | head -100
```

Expected: starts with the comment `// Streams a ZIP of the project's on-disk tree so the "Download as .zip"` and ends just past the matching `/archive/batch` `app.post` handler (around line 7706, before whatever route follows it).

- [ ] **Step 2: Delete the duplicate block.**

Use the Edit tool to remove lines 7615-7706 (the `// Streams a ZIP …` comment through the closing `});` of the second `app.post('/api/projects/:id/archive/batch', …)` block). Preserve the route immediately following the duplicate (do not over-delete).

After the edit, run:

```bash
sed -n '7610,7625p' /Users/elite1/dev/pendesign/apps/daemon/src/server.ts
```

Expected: lines around 7615 now show whatever route used to follow the duplicate, with no `/api/projects/:id/archive` registration in `server.ts`.

- [ ] **Step 3: Re-run the daemon archive tests; confirm still green.**

```bash
cd /Users/elite1/dev/pendesign/apps/daemon
npx vitest run tests/project-archive.test.ts --reporter=line 2>&1 | tail -5
```

Expected: same passing count as after Task 1. (These tests call `buildProjectArchive` directly, not the HTTP route — so deletion doesn't affect them. The route-level coverage is the existing `app-manual-edit.test.ts` / smoke tests; if any of those hit the archive endpoint, run them too.)

- [ ] **Step 4: Build the daemon to confirm TypeScript still compiles.**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/daemon build 2>&1 | tail -10
```

Expected: build succeeds with no errors. If `buildProjectArchive` import in `server.ts` becomes unused, remove it (TypeScript will flag with TS6133 on `noUnusedLocals` configs, otherwise grep `git diff` for it after the deletion).

- [ ] **Step 5: Commit.**

```bash
cd /Users/elite1/dev/pendesign
git add apps/daemon/src/server.ts
git commit -m "chore(daemon): remove duplicate /api/projects/:id/archive route"
```

---

## Task 3: Frontend — `exportProjectAsZip` stops scoping the request

**Files:**
- Modify: `apps/web/src/runtime/exports.ts` (`exportProjectAsZip`, remove `archiveRootFromFilePath`)
- Modify: `apps/web/tests/runtime/exports.test.ts` (delete `describe('archiveRootFromFilePath', …)`; add an `exportProjectAsZip` test)

- [ ] **Step 1: Read `exportProjectAsZip` and confirm current shape.**

```bash
sed -n '585,615p' /Users/elite1/dev/pendesign/apps/web/src/runtime/exports.ts
```

Expected to show the existing implementation (it computes `root` from `opts.filePath`, includes `?root=` in the URL, falls back to `exportAsZip` on error).

- [ ] **Step 2: Write the failing test.**

Open `apps/web/tests/runtime/exports.test.ts`. In the SAME describe-block where `archiveRootFromFilePath` lives today, ADD a new top-level describe BELOW the existing ones (at the bottom of the file, before the closing line). The test mocks `fetch` and asserts the URL has no query string:

```ts
describe('exportProjectAsZip', () => {
  it('fetches the project archive without scoping the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['zip']), {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="p.zip"' },
      }),
    );
    const createObjectURLMock = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURLMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    });

    // jsdom is needed because exportProjectAsZip ultimately calls
    // triggerDownload which creates and clicks an <a> element.
    const { exportProjectAsZip } = await import('../../src/runtime/exports');
    await exportProjectAsZip({
      projectId: 'p1',
      fallbackHtml: '<i/>',
      fallbackTitle: 'p',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/archive');

    vi.unstubAllGlobals();
  });
});
```

NOTE: the file may not have `// @vitest-environment jsdom` at the top yet. Check via `head -3` — if absent, add it as the very first line so `document.createElement('a')` works in `triggerDownload`. Other tests in the file (`exportAsImage`, `requestPreviewSnapshot`) already need it, so it should already be there.

ALSO delete the existing `describe('archiveRootFromFilePath', () => { … })` block (currently around lines 20-40) and remove `archiveRootFromFilePath` from the import list at the top of the test file. Don't delete `archiveFilenameFrom` — that one stays.

- [ ] **Step 3: Run the test; confirm it FAILS for the right reason.**

```bash
cd /Users/elite1/dev/pendesign/apps/web
npx vitest run tests/runtime/exports.test.ts --reporter=line 2>&1 | tail -15
```

Expected FAILs:
- The new `exportProjectAsZip` test fails because the implementation today calls `/api/projects/p1/archive?root=...` derived from `filePath` (which is now `undefined` after we changed the signature in the test — actually, since the current code does `archiveRootFromFilePath(opts.filePath)` and `(opts.filePath || '')` defends against `undefined`, root will be `''` and the URL will be `/api/projects/p1/archive`).

If the new test passes by accident (because `filePath` defaults to empty string and the URL ends up unscoped), still proceed to Step 4 — the goal is to remove the scoping code path entirely and the helper export.

The deleted `archiveRootFromFilePath` describe block will obviously fail to compile because the function no longer exists. That's expected when the import line is also updated.

- [ ] **Step 4: Update `exportProjectAsZip` and delete the helper.**

Open `apps/web/src/runtime/exports.ts`. Replace `exportProjectAsZip` (lines ~585-607) with:

```ts
// Streams the full project tree as a ZIP via the daemon's archive
// endpoint. Build/install directories (node_modules, dist, .next, …)
// are excluded server-side so the download stays lean — the user can
// regenerate them with `npm install`. Falls back to the in-memory
// single-file ZIP only if the daemon request fails so the action
// never silently no-ops.
export async function exportProjectAsZip(opts: {
  projectId: string;
  fallbackHtml: string;
  fallbackTitle: string;
}): Promise<void> {
  const url = `/api/projects/${encodeURIComponent(opts.projectId)}/archive`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`archive request failed (${resp.status})`);
    const blob = await resp.blob();
    triggerDownload(blob, archiveFilenameFrom(resp, opts.fallbackTitle, ''));
  } catch (err) {
    console.warn('[exportProjectAsZip] falling back to single-file ZIP:', err);
    exportAsZip(opts.fallbackHtml, opts.fallbackTitle);
  }
}
```

Notice the `opts` shape lost `filePath`. The third arg to `archiveFilenameFrom` is now `''` because there's no longer a "root slug" to derive from — the helper already falls through to `fallbackTitle` when `root` is empty (verified in its body).

Then DELETE the helper `archiveRootFromFilePath` immediately below `exportProjectAsZip` (lines ~609-615 of the original file). It's only exported for tests today and has no other consumer.

- [ ] **Step 5: Re-run the test; confirm PASS.**

```bash
cd /Users/elite1/dev/pendesign/apps/web
npx vitest run tests/runtime/exports.test.ts --reporter=line 2>&1 | tail -10
```

Expected: PASS. The deleted `archiveRootFromFilePath` describe is gone, the new `exportProjectAsZip` test is green, `archiveFilenameFrom` tests still green.

- [ ] **Step 6: TypeScript check.**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web typecheck 2>&1 | grep "error TS" | grep -v "lean-inception" | head -10
```

Expected: 0 lines outside the documented baseline. TypeScript will catch the call-site mismatch in `FileViewer.tsx:7114` next — Task 4 fixes it.

If you see an error about the call site, that's the trigger to move on to Task 4. Do NOT try to keep `filePath` for backward compat — the field is dead.

- [ ] **Step 7: Commit.**

```bash
cd /Users/elite1/dev/pendesign
git add apps/web/src/runtime/exports.ts apps/web/tests/runtime/exports.test.ts
git commit -m "fix(web): exportProjectAsZip always requests the full project archive"
```

---

## Task 4: Frontend — update `FileViewer.tsx` call site

**Files:**
- Modify: `apps/web/src/components/FileViewer.tsx:7114-7119`

- [ ] **Step 1: Find the existing call.**

```bash
grep -n "exportProjectAsZip" /Users/elite1/dev/pendesign/apps/web/src/components/FileViewer.tsx
```

Expected: line 58 (import) and line 7114 (call). If grep hangs (it does on this 8k-line file occasionally), use awk:

```bash
awk '/exportProjectAsZip/ {print NR": "$0}' /Users/elite1/dev/pendesign/apps/web/src/components/FileViewer.tsx
```

- [ ] **Step 2: Read around the call to confirm context.**

```bash
sed -n '7110,7125p' /Users/elite1/dev/pendesign/apps/web/src/components/FileViewer.tsx
```

Expected output:
```tsx
              onClick={() => {
                setShareMenuOpen(false);
                fireShareExport('zip', () => exportProjectAsZip({
                  projectId,
                  filePath: file.name,
                  fallbackHtml: source ?? '',
                  fallbackTitle: exportTitle,
                }));
              }}
```

- [ ] **Step 3: Drop the `filePath` argument.**

Use the Edit tool. Replace:

```tsx
                fireShareExport('zip', () => exportProjectAsZip({
                  projectId,
                  filePath: file.name,
                  fallbackHtml: source ?? '',
                  fallbackTitle: exportTitle,
                }));
```

with:

```tsx
                fireShareExport('zip', () => exportProjectAsZip({
                  projectId,
                  fallbackHtml: source ?? '',
                  fallbackTitle: exportTitle,
                }));
```

- [ ] **Step 4: Typecheck the web app.**

```bash
cd /Users/elite1/dev/pendesign && pnpm --filter @open-design/web typecheck 2>&1 | grep "error TS" | grep -v "lean-inception" | head -10
```

Expected: 0 lines.

- [ ] **Step 5: Run the FileViewer-adjacent unit tests as a smoke check.**

```bash
cd /Users/elite1/dev/pendesign/apps/web
npx vitest run tests/components/FileViewer.insert-commit.test.tsx tests/runtime/exports.test.ts --reporter=line 2>&1 | tail -10
```

Expected: green. (`FileViewer.insert-commit.test.tsx` does not exercise the share menu, but it does mount `FileViewer` — confirming the typing changes didn't break the React tree.)

- [ ] **Step 6: Commit.**

```bash
cd /Users/elite1/dev/pendesign
git add apps/web/src/components/FileViewer.tsx
git commit -m "fix(web): drop filePath from share-menu zip export call"
```

---

## Task 5: Final validation + manual smoke

- [ ] **Step 1: Repo-wide guard + typecheck.**

```bash
cd /Users/elite1/dev/pendesign
pnpm guard 2>&1 | tail -5
pnpm typecheck 2>&1 | grep "error TS" | grep -v "lean-inception" | wc -l
```

Expected: `pnpm guard` PASS; non-baseline typecheck error count = `0`.

- [ ] **Step 2: Targeted test sweep.**

```bash
cd /Users/elite1/dev/pendesign/apps/daemon && npx vitest run tests/project-archive.test.ts --reporter=line 2>&1 | tail -5
cd /Users/elite1/dev/pendesign/apps/web && npx vitest run tests/runtime/exports.test.ts --reporter=line 2>&1 | tail -5
```

Expected: both PASS, with test counts increased by the new assertions.

- [ ] **Step 3: Manual smoke against the running daemon.**

If `pnpm tools-dev` is currently running (as it was for testing the prior feature), restart only the daemon so the new code is loaded:

```bash
cd /Users/elite1/dev/pendesign
pnpm tools-dev restart daemon 2>&1 | tail -5
```

If `pnpm tools-dev` is not running:

```bash
cd /Users/elite1/dev/pendesign
pnpm tools-dev start 2>&1 | tail -10
```

Get a real project id:

```bash
DAEMON_PORT=$(pnpm tools-dev status --json 2>/dev/null | grep -oE '"daemon":[^}]*"port":[0-9]+' | grep -oE '[0-9]+$')
PROJECT_ID=$(curl -s "http://127.0.0.1:${DAEMON_PORT}/api/projects" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
echo "Using daemon port ${DAEMON_PORT}, project ${PROJECT_ID}"
```

Download the archive and inspect:

```bash
rm -f /tmp/share-zip-smoke.zip
curl -s -o /tmp/share-zip-smoke.zip -w "HTTP %{http_code} size %{size_download}\n" \
  "http://127.0.0.1:${DAEMON_PORT}/api/projects/${PROJECT_ID}/archive"
unzip -l /tmp/share-zip-smoke.zip 2>&1 | grep -E "node_modules|\.git|dist|\.next|^---|files$" | head -20
unzip -l /tmp/share-zip-smoke.zip 2>&1 | wc -l
```

Expected:
- HTTP 200
- `node_modules`, `.git`, `dist`, `.next` entries: NONE
- File count > 1 (real projects have multiple HTML files plus assets)

Compare to the bug repro: the user previously saw a single file. The fixed archive must contain everything visible in the file panel for that project.

- [ ] **Step 4: UI smoke in the desktop app.**

Open the Vision Design desktop window (running via `pnpm tools-dev`). Pick a project that has multiple files (e.g. one with sibling HTMLs + a `lean-inception/` folder). Click `Share → Download as .zip`. Extract the resulting zip somewhere temporary:

```bash
mkdir -p /tmp/share-zip-ui-smoke && unzip -o ~/Downloads/*.zip -d /tmp/share-zip-ui-smoke 2>&1 | tail -5
ls /tmp/share-zip-ui-smoke
```

Expected: the directory contains every file the user sees in the project's file panel, plus the auto-generated `DESIGN-HANDOFF.md` and `DESIGN-MANIFEST.json`. No `node_modules`, no `.git`.

- [ ] **Step 5: Mark the task list complete and report back.**

Summarize the four feature commits + the spec commit, the bug reproduction (single-file zip vs full-project zip), and the manual-smoke result. Offer to push the branch if appropriate.

---

## Self-review notes

Cross-checked against `specs/current/2026-05-27-share-download-zip-fix.md`:

- **Spec coverage:**
  - "Frontend always whole project" → Task 3 (URL drops `?root=`) + Task 4 (call site loses `filePath`).
  - "Backend skips `SKIP_DIRS`" → Task 1 (with case-insensitive check).
  - "Cleanup duplicate route" → Task 2.
  - "Tests" → Task 1 adds two backend assertions; Task 3 adds one frontend assertion; Task 3 also removes obsolete `archiveRootFromFilePath` coverage.
  - Manual smoke per the user's specific complaint ("só existe um arquivo") → Task 5 Step 3 + Step 4.

- **No placeholders.** Every code step contains the literal code to write; every command has expected output; every commit message is concrete and follows the repo's conventional-commits style with no `Co-Authored-By` trailer per AGENTS.md.

- **Type consistency.** `exportProjectAsZip`'s new signature (`{ projectId; fallbackHtml; fallbackTitle }`) is used identically in Task 3 (definition + test) and Task 4 (call site). `archiveRootFromFilePath` is removed in Task 3 and not referenced in any later task.

- **Risk mitigation.**
  - The `archiveFilenameFrom(resp, fallbackTitle, '')` call in the new `exportProjectAsZip` passes empty `root`. The helper handles this by falling through to `fallbackTitle` when root is empty (existing logic, not modified).
  - Duplicate-route deletion is verified safe because `registerImportExportRoutes` runs first and Express resolves to the first match. Task 2 Step 4 explicitly builds the daemon to surface any unused-import errors after the deletion.
  - Case-insensitive dir check (`entry.name.toLowerCase()`) won't break Linux setups where `node_modules` is the canonical lowercase form — it's a no-op there and a safety net on macOS/Windows.
