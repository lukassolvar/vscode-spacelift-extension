import { describe, expect, it } from "vitest";
import { checkPackage } from "./check-package.mjs";

const good = ["CHANGELOG.md", "LICENSE", "README.md", "package.json", "media/icon.png", "out/extension.js", "out/runPanel.js"];

describe("checkPackage", () => {
  it("accepts the expected package layout", () => {
    expect(checkPackage(good)).toEqual({ unexpected: [], missing: [] });
  });

  it.each([
    "src/extension.ts",
    "test/vscode.ts",
    "coverage/index.html",
    "out/extension.test.js",
    "out/nested/file.js",
    "node_modules/x/index.js",
    ".github/workflows/ci.yml",
    "media/run-panel.png",
    "SECURITY.md",
    "scripts/release-notes.mjs",
  ])("flags the stray file %s", (file) => {
    expect(checkPackage([...good, file]).unexpected).toEqual([file]);
  });

  it("reports essential files that are missing, such as a forgotten build", () => {
    const withoutBuild = good.filter((f) => !f.startsWith("out/"));

    expect(checkPackage(withoutBuild).missing).toEqual(["out/extension.js"]);
  });
});
