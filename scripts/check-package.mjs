import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ALLOWED = [
  /^(CHANGELOG\.md|LICENSE|README\.md|package\.json)$/,
  /^media\/icon\.png$/,
  /^out\/[A-Za-z]+\.js$/,
];
const REQUIRED = ["CHANGELOG.md", "LICENSE", "README.md", "package.json", "media/icon.png", "out/extension.js"];

export function checkPackage(files) {
  return {
    unexpected: files.filter((file) => !ALLOWED.some((pattern) => pattern.test(file))),
    missing: REQUIRED.filter((file) => !files.includes(file)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = execFileSync("npx", ["--no-install", "vsce", "ls"], { encoding: "utf8", shell: process.platform === "win32" })
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
  const { unexpected, missing } = checkPackage(files);
  for (const file of unexpected) console.error(`::error::Unexpected file in package: ${file}`);
  for (const file of missing) console.error(`::error::Missing file in package: ${file}`);
  if (unexpected.length || missing.length) process.exit(1);
  console.log(`Package contents OK (${files.length} files).`);
}
