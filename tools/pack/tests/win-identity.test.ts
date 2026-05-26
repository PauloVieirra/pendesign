import { describe, expect, it } from "vitest";

import { resolveWinInstallIdentity } from "../src/win/identity.js";

describe("resolveWinInstallIdentity", () => {
  it("keeps the default namespace on the canonical Windows display name", () => {
    expect(resolveWinInstallIdentity({ namespace: "default" })).toMatchObject({
      displayName: "Vision Design",
      shortcutName: "Vision Design.lnk",
      uninstallerName: "Uninstall Vision Design.exe",
    });
  });

  it("uses first-class beta display identity for beta release namespaces", () => {
    expect(resolveWinInstallIdentity({ namespace: "release-beta-win" })).toMatchObject({
      appPathsKey: "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Vision Design Beta.exe",
      displayName: "Vision Design Beta",
      shortcutName: "Vision Design Beta.lnk",
      uninstallerName: "Uninstall Vision Design Beta.exe",
    });
  });

  it("uses first-class preview display identity for preview release namespaces", () => {
    expect(resolveWinInstallIdentity({ namespace: "release-preview-win" })).toMatchObject({
      appPathsKey: "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Vision Design Preview.exe",
      displayName: "Vision Design Preview",
      shortcutName: "Vision Design Preview.lnk",
      uninstallerName: "Uninstall Vision Design Preview.exe",
    });
  });
});
