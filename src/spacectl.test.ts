import { describe, expect, it } from "vitest";
import { aliasFromEndpoint, diagnose, installAction } from "./spacectl";

describe("installAction", () => {
  it("installs with Homebrew on macOS and winget on Windows", () => {
    expect(installAction("darwin")).toMatchObject({ command: "brew install spacelift-io/spacelift/spacectl" });
    expect(installAction("win32")).toMatchObject({ command: "winget install --id spacelift-io.spacectl" });
  });

  it("falls back to the install guide where no single command fits", () => {
    expect(installAction("linux")).toMatchObject({ url: "https://github.com/spacelift-io/spacectl" });
  });
});

describe("aliasFromEndpoint", () => {
  it("uses the account subdomain as the profile alias", () => {
    expect(aliasFromEndpoint("https://acme.app.spacelift.io/")).toBe("acme");
  });
});

const ok = async () => "token";
const fail = async () => {
  throw new Error("boom");
};

describe("diagnose", () => {
  it.each([
    ["spacectl binary is missing", fail, "https://x", "no-spacectl"],
    ["there is no logged-in profile", async (args: string[]) => (args[0] === "--version" ? "v1" : fail()), "https://x", "not-logged-in"],
    ["a profile returns an empty token", async (args: string[]) => (args[0] === "--version" ? "v1" : "  "), "https://x", "not-logged-in"],
    ["the endpoint setting is empty", ok, "", "no-endpoint"],
    ["the endpoint is empty and nobody is logged in", async (args: string[]) => (args[0] === "--version" ? "v1" : fail()), "", "no-endpoint"],
    ["everything is configured", ok, "https://x", "ready"],
  ])("reports the first missing step when %s", async (_name, exec, endpoint, expected) => {
    await expect(diagnose(exec, endpoint)).resolves.toBe(expected);
  });
});
