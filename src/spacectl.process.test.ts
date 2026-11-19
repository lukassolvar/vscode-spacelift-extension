import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { browserLogin, spacectlExec, spacectlTokenProvider } from "./spacectl";

describe("spacectlTokenProvider", () => {
  it("caches the token until a refresh is requested", async () => {
    const exec = vi.fn().mockResolvedValueOnce("first\n").mockResolvedValueOnce("second\n");
    const token = spacectlTokenProvider(exec);

    expect(await token(false)).toBe("first");
    expect(await token(false)).toBe("first");
    expect(await token(true)).toBe("second");
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenCalledWith(["profile", "export-token"]);
  });

  it("points the user to spacectl login when no token can be read", async () => {
    const failing = spacectlTokenProvider(vi.fn().mockRejectedValue(new Error("no profile")));
    const empty = spacectlTokenProvider(vi.fn().mockResolvedValue("  \n"));

    await expect(failing(false)).rejects.toThrow(/spacectl profile login.*no profile/);
    await expect(empty(false)).rejects.toThrow(/empty token/);
  });
});

describe.skipIf(process.platform === "win32")("spacectl subprocess", () => {
  const dir = mkdtempSync(join(tmpdir(), "spacectl-test-"));
  const argsFile = join(dir, "args");
  const script = (name: string, body: string) => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("runs the configured binary and returns its output", async () => {
    const bin = script("export", `echo "$@" > ${argsFile}; echo secret-token`);

    const out = await spacectlExec(() => bin)(["profile", "export-token"]);

    expect(out.trim()).toBe("secret-token");
    expect(readFileSync(argsFile, "utf8").trim()).toBe("profile export-token");
  });

  it("starts a browser login for the endpoint using the account subdomain as the alias", async () => {
    const bin = script("login", `echo "$@" > ${argsFile}`);

    await browserLogin(bin, "https://acme.app.spacelift.io", new AbortController().signal);

    expect(readFileSync(argsFile, "utf8").trim()).toBe("profile login --method browser --endpoint https://acme.app.spacelift.io acme");
  });

  it("surfaces the last line spacectl wrote to stderr when login fails", async () => {
    const bin = script("fail", `echo "warming up" >&2; echo "login denied by user" >&2; exit 1`);

    await expect(browserLogin(bin, "https://acme.app.spacelift.io", new AbortController().signal)).rejects.toThrow("login denied by user");
  });

  it("aborts a login in progress when cancelled", async () => {
    const bin = script("slow", "sleep 5");
    const abort = new AbortController();

    const login = browserLogin(bin, "https://acme.app.spacelift.io", abort.signal);
    abort.abort();

    await expect(login).rejects.toMatchObject({ name: "AbortError" });
  });
});
