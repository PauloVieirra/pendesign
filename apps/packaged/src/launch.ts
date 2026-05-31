import { access, cp, mkdir, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, userInfo } from "node:os";

import { app } from "electron";

import type { PackagedNamespacePaths } from "./paths.js";

export class PackagedPathAccessError extends Error {
  readonly title: string;

  constructor(message: string, options?: { cause?: unknown; title?: string }) {
    super(message, options);
    this.name = "PackagedPathAccessError";
    this.title = options?.title ?? "Vision Design cannot access its data folder";
  }
}

type PathDiagnostic = {
  exists: boolean;
  mode?: number;
  path: string;
};

function formatMode(mode: number | undefined): string {
  if (mode == null) return "unknown";
  return `0${(mode & 0o777).toString(8)}`;
}

async function inspectPath(path: string): Promise<PathDiagnostic> {
  try {
    const stats = await stat(path);
    return { exists: true, mode: stats.mode, path };
  } catch {
    return { exists: false, path };
  }
}

function formatWritablePathError(options: {
  attemptedPath: string;
  currentUser: string;
  diagnostic: PathDiagnostic;
  error: unknown;
  parentDiagnostic: PathDiagnostic;
}): string {
  const { attemptedPath, currentUser, diagnostic, error, parentDiagnostic } = options;
  const message = error instanceof Error ? error.message : String(error);
  const parentPath = dirname(attemptedPath);
  const diagLines = [
    `Vision Design could not create or write to:`,
    attemptedPath,
    "",
    `Current user: ${currentUser}`,
    `Node error: ${message}`,
    `Target exists: ${diagnostic.exists ? "yes" : "no"}`,
    `Target mode: ${formatMode(diagnostic.mode)}`,
    `Parent exists: ${parentDiagnostic.exists ? "yes" : "no"}`,
    `Parent mode: ${formatMode(parentDiagnostic.mode)}`,
    "",
    `Common causes:`,
    `• the folder was created by another user (for example with sudo)`,
    `• the parent folder is not writable`,
    `• the folder is a symlink to a protected location`,
    "",
    `Try in Terminal:`,
    `ls -ld \"${parentPath}\" \"${attemptedPath}\"`,
    `sudo chown -R \"${currentUser}\":staff \"${parentPath}\"`,
    `chmod -R u+rwX \"${parentPath}\"`,
  ];
  return diagLines.join("\n");
}

export async function verifyPackagedDataRootWritable(paths: Pick<PackagedNamespacePaths, "dataRoot">): Promise<void> {
  try {
    await mkdir(paths.dataRoot, { recursive: true });
    await access(paths.dataRoot, fsConstants.W_OK);
  } catch (error) {
    const [diagnostic, parentDiagnostic] = await Promise.all([
      inspectPath(paths.dataRoot),
      inspectPath(dirname(paths.dataRoot)),
    ]);
    throw new PackagedPathAccessError(
      formatWritablePathError({
        attemptedPath: paths.dataRoot,
        currentUser: userInfo().username,
        diagnostic,
        error,
        parentDiagnostic,
      }),
      { cause: error },
    );
  }
}

export async function ensurePackagedNamespacePaths(
  paths: PackagedNamespacePaths,
): Promise<void> {
  await verifyPackagedDataRootWritable(paths);
  await Promise.all([
    mkdir(paths.namespaceRoot, { recursive: true }),
    mkdir(paths.cacheRoot, { recursive: true }),
    mkdir(paths.dataRoot, { recursive: true }),
    mkdir(paths.logsRoot, { recursive: true }),
    mkdir(paths.desktopLogsRoot, { recursive: true }),
    mkdir(paths.runtimeRoot, { recursive: true }),
    mkdir(paths.updateRoot, { recursive: true }),
    mkdir(paths.electronUserDataRoot, { recursive: true }),
    mkdir(paths.electronSessionDataRoot, { recursive: true }),
  ]);
}

export function applyPackagedElectronPathOverrides(
  paths: PackagedNamespacePaths,
): void {
  app.setPath("userData", paths.electronUserDataRoot);
  app.setPath("sessionData", paths.electronSessionDataRoot);
  app.setPath("logs", paths.desktopLogsRoot);
}

// ---------------------------------------------------------------------------
// One-shot data migration: "Open Design" → "Vision Design" userData
// ---------------------------------------------------------------------------
// Electron derives userData from productName. After the rename from
// "Open Design" to "Vision Design" the default userData path changes from
//   ~/Library/Application Support/Open Design/
// to
//   ~/Library/Application Support/Vision Design/
// which would make existing namespaces (projects, SQLite, etc.) invisible.
//
// This migration copies the legacy namespaces tree into the new root once,
// then writes a marker file so it never runs again.
// ---------------------------------------------------------------------------

const LEGACY_PRODUCT_NAME = "Open Design";
const MIGRATION_MARKER = ".vision-design-migrated";

async function pathExistsAsync(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrates the legacy "Open Design" userData namespaces into the new
 * "Vision Design" userData root when:
 *   1. The migration marker does not yet exist (never run before).
 *   2. The legacy root exists on disk.
 *   3. The new root either does not exist, or exists but has no namespaces dir.
 *
 * Call this BEFORE ensurePackagedNamespacePaths / sidecar startup so that
 * the daemon finds migrated data when it opens SQLite.
 *
 * @param newUserDataRoot  The resolved Vision Design userData directory
 *                         (i.e. path.dirname(config.namespaceBaseRoot) when
 *                          namespaceBaseRoot was not explicitly configured).
 */
export async function migrateLegacyOpenDesignDataIfNeeded(newUserDataRoot: string): Promise<void> {
  // Only migrate when the caller is using the default (Electron-derived) path.
  // If the user has a custom namespaceBaseRoot configured we leave their data
  // alone — it is already in a stable, explicitly chosen location.
  const legacyRoot = join(homedir(), "Library", "Application Support", LEGACY_PRODUCT_NAME);
  const marker = join(newUserDataRoot, MIGRATION_MARKER);

  // Already migrated — nothing to do.
  if (await pathExistsAsync(marker)) return;

  // No legacy data — nothing to migrate.
  if (!(await pathExistsAsync(legacyRoot))) return;

  // If the new root already has a namespaces directory the user has already
  // used Vision Design directly.  Skip the copy to avoid clobbering their data
  // and write the marker so we don't check again.
  const newNamespacesDir = join(newUserDataRoot, "namespaces");
  if (await pathExistsAsync(newNamespacesDir)) {
    await mkdir(newUserDataRoot, { recursive: true });
    await writeFile(marker, "skipped: new namespaces dir already present\n", "utf8");
    return;
  }

  await mkdir(newUserDataRoot, { recursive: true });

  // Copy the legacy namespaces tree.
  const legacyNamespacesDir = join(legacyRoot, "namespaces");
  if (await pathExistsAsync(legacyNamespacesDir)) {
    await cp(legacyNamespacesDir, newNamespacesDir, { recursive: true });
  }

  await writeFile(
    marker,
    `migrated from ${legacyRoot} on ${new Date().toISOString()}\n`,
    "utf8",
  );
}
