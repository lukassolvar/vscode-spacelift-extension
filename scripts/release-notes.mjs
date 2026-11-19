import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function extractNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\]`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no "## [${version}]" section. Rename [Unreleased] to the version being released.`);
  }
  const next = lines.findIndex((line, i) => i > start && /^## \[/.test(line));
  const notes = lines.slice(start + 1, next === -1 ? undefined : next).join("\n").trim();
  if (!notes) throw new Error(`The "## [${version}]" section in CHANGELOG.md is empty.`);
  return notes;
}

export function versionFromTag(tag, packageVersion) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) throw new Error(`Tag "${tag}" must look like vMAJOR.MINOR.PATCH, for example v1.2.3.`);
  if (match[1] !== packageVersion) {
    throw new Error(`Tag ${tag} does not match package.json version ${packageVersion}. Bump the version before tagging.`);
  }
  return match[1];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { version } = JSON.parse(readFileSync("package.json", "utf8"));
    process.stdout.write(`${extractNotes(readFileSync("CHANGELOG.md", "utf8"), versionFromTag(process.argv[2] ?? "", version))}\n`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
