import { describe, expect, it } from "vitest";
import { extractNotes, versionFromTag } from "./release-notes.mjs";

const changelog = `# Changelog

## [Unreleased]

### Added

- Next thing.

## [0.2.0] - 2026-12-01

### Added

- Feature B.

## [0.1.0] - 2026-11-20

### Added

- Feature A.
`;

describe("extractNotes", () => {
  it("returns only the requested version's section", () => {
    expect(extractNotes(changelog, "0.2.0")).toBe("### Added\n\n- Feature B.");
    expect(extractNotes(changelog, "0.1.0")).toBe("### Added\n\n- Feature A.");
  });

  it("works with Windows line endings", () => {
    expect(extractNotes(changelog.replace(/\n/g, "\r\n"), "0.2.0")).toBe("### Added\n\n- Feature B.");
  });

  it("refuses to release a version that has no changelog section yet", () => {
    expect(() => extractNotes(changelog, "0.3.0")).toThrow(/## \[0\.3\.0\]/);
  });

  it("does not treat a version prefix as a match", () => {
    expect(() => extractNotes(changelog, "0.1")).toThrow(/## \[0\.1\]/);
  });

  it("refuses an empty section", () => {
    expect(() => extractNotes("## [1.0.0] - 2026-01-01\n\n## [0.9.0]\n\n- x\n", "1.0.0")).toThrow(/empty/);
  });
});

describe("versionFromTag", () => {
  it("accepts a v-prefixed tag that matches package.json", () => {
    expect(versionFromTag("v0.1.0", "0.1.0")).toBe("0.1.0");
  });

  it.each(["0.1.0", "v0.1", "v0.1.0-beta.1", "vx.y.z", ""])("rejects the malformed tag %j", (tag) => {
    expect(() => versionFromTag(tag, "0.1.0")).toThrow(/vMAJOR\.MINOR\.PATCH/);
  });

  it("rejects a tag that disagrees with package.json", () => {
    expect(() => versionFromTag("v0.2.0", "0.1.0")).toThrow(/does not match package\.json version 0\.1\.0/);
  });
});
