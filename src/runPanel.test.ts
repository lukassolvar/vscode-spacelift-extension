import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { fake } from "../test/vscode";
import { RunPanel } from "./runPanel";
import type { Transition } from "./runView";

const NO_LOGS = new Set(["QUEUED", "READY", "FINISHED", "UNCONFIRMED", "CONFIRMED"]);
const step = (state: string, version: number, timestamp: number, until: number | null, extra: Partial<Transition> = {}): Transition => ({
  state,
  hasLogs: !NO_LOGS.has(state),
  stateVersion: version,
  timestamp,
  until,
  terminal: state === "FINISHED" || state === "FAILED",
  ...extra,
});

const finishedRun = () => [step("FINISHED", 3, 300, null), step("PLANNING", 2, 200, 300), step("PREPARING", 1, 100, 200)];
const planningRun = () => [step("PLANNING", 2, 200, null), step("PREPARING", 1, 100, 200)];

interface Scenario {
  state: string;
  history: Transition[];
  logs: Record<string, string>;
  createdAt: number;
  retention: number | null;
  canConfirm: boolean;
  needsApproval: boolean;
  failLogs: Set<string>;
  gates: Map<string, Promise<void>>;
  calls: { run: string[]; logs: string[] };
}

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  state: "FINISHED",
  history: finishedRun(),
  logs: { "PLANNING:2": "plan output", "PREPARING:1": "prepare output" },
  createdAt: Date.now() / 1000,
  retention: 60,
  canConfirm: false,
  needsApproval: false,
  failLogs: new Set(),
  gates: new Map(),
  calls: { run: [], logs: [] },
  ...over,
});

function clientFor(s: Scenario) {
  return {
    request: vi.fn(async (query: string, vars: any) => {
      if (query.includes("history {")) {
        s.calls.run.push(vars.run);
        return {
          runLogRetentionDays: s.retention,
          stack: {
            id: vars.stack,
            name: "acme-dev/network",
            projectRoot: null,
            terraformVersion: "1.9.8",
            spaceDetails: { name: "acme-dev" },
            run: {
              id: vars.run,
              title: "A run",
              state: s.state,
              type: "TRACKED",
              branch: "main",
              triggeredBy: null,
              createdAt: s.createdAt,
              canConfirm: s.canConfirm,
              needsApproval: s.needsApproval,
              commit: { hash: "abcdef1234", authorName: "a", message: "m", url: "https://example.com/c", timestamp: 1 },
              delta: null,
              history: s.history,
            },
          },
        };
      }
      if (query.includes("changesV3")) {
        return { stack: { run: { changesV3: [{ resources: [{ address: "aws_x.y", metadata: { type: "ADD" } }] }] } } };
      }
      const key = `${vars.state}:${vars.stateVersion}`;
      s.calls.logs.push(key);
      await s.gates.get(key);
      if (s.failLogs.has(key)) throw new Error("log fetch failed");
      return { stack: { run: { logs: { messages: [{ message: s.logs[key] ?? "" }], hasMore: false, nextToken: null, finished: true } } } };
    }),
  };
}

let timers: { fn: () => void; ms?: number }[];
const pollTimers = () => timers.filter((t) => t.ms === 5000);

async function open(s: Scenario) {
  const act = vi.fn(async () => undefined);
  RunPanel.show({ client: clientFor(s) as never, act }, "stack-1", "run-1");
  const panel = fake.panels[0];
  await panel.receive({ cmd: "ready" });
  return { panel, act };
}

beforeEach(() => {
  vi.clearAllMocks();
  timers = [];
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
    timers.push({ fn, ms });
    return 0;
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  fake.reset();
});

describe("RunPanel", () => {
  it("opens on the newest phase that has logs and shows its output and change count", async () => {
    const { panel } = await open(scenario());

    expect(panel.last.selected).toBe("PLANNING:2");
    expect(panel.last.logTitle).toBe("PLANNING");
    expect(panel.last.log).toContain("plan output");
    expect(panel.last.changesLabel).toBe("CHANGES (1)");
    expect(panel.webview.html).toContain("Content-Security-Policy");
  });

  it("shows a loading state while a newly selected phase is fetched, then its log", async () => {
    const s = scenario();
    let release!: () => void;
    s.gates.set("PREPARING:1", new Promise<void>((resolve) => (release = resolve)));
    const { panel } = await open(s);

    const pending = panel.receive({ cmd: "select", value: "PREPARING:1" });

    expect(panel.last.selected).toBe("PREPARING:1");
    expect(panel.last.log).toContain("Loading logs");
    release();
    await pending;
    expect(panel.last.log).toContain("prepare output");
    expect(panel.last.log).not.toContain("Loading logs");
  });

  it("fetches each finished phase only once however often it is selected", async () => {
    const s = scenario();
    const { panel } = await open(s);

    for (const key of ["PREPARING:1", "PLANNING:2", "PREPARING:1"]) await panel.receive({ cmd: "select", value: key });

    expect(s.calls.logs).toEqual(["PLANNING:2", "PREPARING:1"]);
  });

  it("keeps refetching the phase in progress and schedules the next poll", async () => {
    const s = scenario({ state: "PLANNING", history: planningRun() });
    await open(s);
    expect(pollTimers()).toHaveLength(1);

    pollTimers()[0].fn();

    await vi.waitFor(() => expect(s.calls.logs.filter((k) => k === "PLANNING:2")).toHaveLength(2));
    expect(s.calls.run).toHaveLength(2);
  });

  it.each([
    ["finished", "FINISHED", finishedRun()],
    ["waiting for confirmation", "UNCONFIRMED", [step("UNCONFIRMED", 3, 300, null), step("PLANNING", 2, 200, 300)]],
  ])("does not poll a run that is %s", async (_name, state, history) => {
    await open(scenario({ state, history }));

    expect(pollTimers()).toHaveLength(0);
  });

  it("follows the newest phase while the user has not picked one", async () => {
    const s = scenario({ state: "PLANNING", history: planningRun(), logs: { "PLANNING:2": "plan", "APPLYING:4": "apply output" } });
    const { panel } = await open(s);
    expect(panel.last.selected).toBe("PLANNING:2");

    s.history = [step("APPLYING", 4, 400, null), step("PLANNING", 2, 200, 400), step("PREPARING", 1, 100, 200)];
    pollTimers()[0].fn();

    await vi.waitFor(() => expect(panel.last.selected).toBe("APPLYING:4"));
    expect(panel.last.log).toContain("apply output");
  });

  it("keeps the phase the user picked when newer phases appear", async () => {
    const s = scenario({ state: "PLANNING", history: planningRun(), logs: { "PLANNING:2": "plan", "PREPARING:1": "prepare", "APPLYING:4": "apply" } });
    const { panel } = await open(s);
    await panel.receive({ cmd: "select", value: "PREPARING:1" });

    s.history = [step("APPLYING", 4, 400, null), step("PLANNING", 2, 200, 400), step("PREPARING", 1, 100, 200)];
    pollTimers().at(-1)!.fn();

    await vi.waitFor(() => expect(s.calls.run).toHaveLength(2));
    await vi.waitFor(() => expect(panel.last.steps).toContain("Applying"));
    expect(panel.last.selected).toBe("PREPARING:1");
  });

  it.each(["approve", "reject", "confirm", "discard"])("forwards %s to the action handler and reloads the run", async (cmd) => {
    const s = scenario({ state: "UNCONFIRMED", history: [step("UNCONFIRMED", 3, 300, null), step("PLANNING", 2, 200, 300)] });
    const { panel, act } = await open(s);

    await panel.receive({ cmd });

    expect(act).toHaveBeenCalledWith(cmd, "stack-1", "run-1");
    expect(s.calls.run).toHaveLength(2);
  });

  it("copies the raw log text, not its HTML, to the clipboard", async () => {
    const { panel } = await open(scenario({ logs: { "PLANNING:2": "a < b" } }));

    await panel.receive({ cmd: "copy" });

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith("a < b");
  });

  it("reports API errors in the panel instead of throwing", async () => {
    RunPanel.show({ client: { request: async () => Promise.reject(new Error("boom")) } as never, act: vi.fn() }, "s", "r");
    const panel = fake.panels[0];

    await panel.receive({ cmd: "ready" });

    expect(panel.last.error).toBe("boom");
  });

  it("reuses the open panel when another run is opened", async () => {
    const s = scenario();
    const { panel } = await open(s);

    RunPanel.show({ client: clientFor(s) as never, act: vi.fn() }, "stack-1", "run-2");

    expect(fake.panels).toHaveLength(1);
    expect(panel.reveal).toHaveBeenCalled();
    await vi.waitFor(() => expect(s.calls.run).toContain("run-2"));
  });

  it("explains missing logs on runs older than the retention period", async () => {
    const old = scenario({ createdAt: Date.now() / 1000 - 90 * 86400, logs: { "PLANNING:2": "" } });
    const { panel } = await open(old);

    expect(panel.last.log).toContain("probably been deleted");
  });

  it("uses a plain message for an empty log on a recent run", async () => {
    const { panel } = await open(scenario({ logs: { "PLANNING:2": "" } }));

    expect(panel.last.log).toContain("No log output for this phase.");
  });

  it("shows a log load failure and recovers when the phase is selected again", async () => {
    const s = scenario();
    s.failLogs.add("PLANNING:2");
    const { panel } = await open(s);
    expect(panel.last.log).toContain("Failed to load logs: log fetch failed");

    s.failLogs.clear();
    await panel.receive({ cmd: "select", value: "PLANNING:2" });

    expect(panel.last.log).toContain("plan output");
    expect(panel.last.log).not.toContain("Failed to load logs");
  });

  it("says so when no phase has logs yet", async () => {
    const { panel } = await open(scenario({ state: "QUEUED", history: [step("QUEUED", 0, 100, null)] }));

    expect(panel.last.log).toContain("No logs for this run yet");
  });
});
