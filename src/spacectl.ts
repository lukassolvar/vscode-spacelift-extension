import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Exec = (args: string[]) => Promise<string>;
export type SetupStatus = "no-spacectl" | "not-logged-in" | "no-endpoint" | "ready";

export function spacectlExec(binary: () => string): Exec {
  return async (args) => (await run(binary(), args)).stdout;
}

export function spacectlTokenProvider(exec: Exec) {
  let cached: string | undefined;
  return async (refresh: boolean): Promise<string> => {
    if (!cached || refresh) {
      try {
        cached = (await exec(["profile", "export-token"])).trim();
      } catch (e) {
        throw new Error(`Could not get a token from spacectl. Run "spacectl profile login" first. (${(e as Error).message})`);
      }
      if (!cached) {
        throw new Error('spacectl returned an empty token. Run "spacectl profile login" first.');
      }
    }
    return cached;
  };
}

export async function diagnose(exec: Exec, endpoint: string): Promise<SetupStatus> {
  try {
    await exec(["--version"]);
  } catch {
    return "no-spacectl";
  }
  if (!endpoint) return "no-endpoint";
  try {
    if (!(await exec(["profile", "export-token"])).trim()) return "not-logged-in";
  } catch {
    return "not-logged-in";
  }
  return "ready";
}

export async function browserLogin(binary: string, endpoint: string, signal: AbortSignal): Promise<void> {
  try {
    await run(binary, ["profile", "login", "--method", "browser", "--endpoint", endpoint, aliasFromEndpoint(endpoint)], {
      signal,
      timeout: 5 * 60_000,
    });
  } catch (e) {
    const err = e as Error & { stderr?: string };
    throw new Error(err.stderr?.trim().split("\n").pop() || err.message);
  }
}

export function aliasFromEndpoint(endpoint: string): string {
  return new URL(endpoint).hostname.split(".")[0];
}
