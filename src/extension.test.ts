import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { configUpdate, fake } from "../test/vscode";
import { activate, StacksProvider } from "./extension";
import { browserLogin, diagnose } from "./spacectl";

vi.mock("./spacectl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./spacectl")>()),
  diagnose: vi.fn(),
  browserLogin: vi.fn(),
  spacectlExec: vi.fn(() => vi.fn()),
  spacectlTokenProvider: vi.fn(() => async () => "token"),
}));

const stack = (id: string, name: string, state: string, space: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  state,
  needsApproval: false,
  stateSetAt: 0,
  spaceDetails: { name: space },
  ...extra,
});

const run = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `run ${id}`,
  state: "FINISHED",
  type: "TRACKED",
  createdAt: 100,
  canConfirm: false,
  needsApproval: false,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(diagnose).mockResolvedValue("ready");
});

describe("StacksProvider", () => {
  const providerWith = (request: (query: string, vars?: any) => Promise<unknown>) => new StacksProvider({ request: vi.fn(request) } as never);

  it("groups stacks by space alphabetically after applying the filter", async () => {
    const provider = providerWith(async () => ({
      stacks: [
        stack("a1", "acme-prod/a", "FINISHED", "acme-prod"),
        stack("b", "acme-dev/b", "FAILED", "acme-dev"),
        stack("a2", "acme-prod/zz", "FAILED", "acme-prod"),
      ],
    }));
    provider.filter = "failed";

    const spaces = (await provider.getChildren()) as any[];
    const prodStacks = (await provider.getChildren(spaces[1])) as any[];

    expect(spaces.map((s) => s.name)).toEqual(["acme-dev", "acme-prod"]);
    expect(prodStacks.map((s) => s.stack.id)).toEqual(["a2"]);
  });

  it("lists tracked runs plus only those proposed runs that await review, newest first", async () => {
    const request = vi.fn(async () => ({
      stack: {
        runs: [run("tracked", { createdAt: 10 })],
        proposedRuns: [
          run("pr-done", { type: "PROPOSED", createdAt: 50 }),
          run("pr-review", { type: "PROPOSED", state: "PENDING_REVIEW", createdAt: 30 }),
        ],
      },
    }));
    const provider = new StacksProvider({ request } as never);

    const nodes = (await provider.getChildren({ kind: "stack", stack: stack("s", "acme/s", "FINISHED", "acme") } as never)) as any[];

    expect(nodes.map((n) => n.run.id)).toEqual(["pr-review", "tracked"]);
    expect((request.mock.calls[0] as unknown[])[0]).toContain("proposedRuns");
  });

  it.each([
    ["a confirmable unconfirmed run", { state: "UNCONFIRMED", canConfirm: true }, "run confirmable discardable"],
    ["a run waiting on review", { state: "PENDING_REVIEW", needsApproval: true, type: "PROPOSED" }, "run reviewable"],
    ["a finished run", {}, "run"],
  ])("exposes only the valid actions on %s", (_name, extra, contextValue) => {
    const provider = providerWith(async () => ({}));

    const item = provider.getTreeItem({ kind: "run", stack: "s", run: run("r", extra) } as never);

    expect(item.contextValue).toBe(contextValue);
  });

  it("marks proposed runs and flags stacks and spaces that need approval", () => {
    const provider = providerWith(async () => ({}));
    const needy = stack("s", "acme-dev/network", "FINISHED", "acme-dev", { needsApproval: true });

    expect(provider.getTreeItem({ kind: "run", stack: "s", run: run("r", { type: "PROPOSED" }) } as never).description).toContain("PROPOSED");
    expect(provider.getTreeItem({ kind: "stack", stack: needy } as never).iconPath?.id).toBe("warning");
    expect(provider.getTreeItem({ kind: "space", name: "acme-dev", stacks: [needy] } as never).description).toBe("1 need approval");
  });

  it("shows an API error once instead of on every refresh", async () => {
    let failing = true;
    const provider = providerWith(async () => (failing ? Promise.reject(new Error("offline")) : { stacks: [] }));

    await provider.getChildren();
    await provider.getChildren();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);

    failing = false;
    await provider.getChildren();
    failing = true;
    await provider.getChildren();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(2);
  });
});

describe("activate", () => {
  const store: Record<string, unknown> = {};
  let context: { subscriptions: { dispose(): void }[]; globalState: { get: (k: string, d?: unknown) => unknown; update: ReturnType<typeof vi.fn> } };
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const setPlatform = (value: string) => Object.defineProperty(process, "platform", { value });
  const command = (id: string) => fake.commands.get(id)!;
  const prompts = (impl: (message: string, ...items: string[]) => string | undefined) =>
    vi.mocked(vscode.window.showInformationMessage).mockImplementation((async (message: string, ...items: string[]) => impl(message, ...items)) as never);

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    fake.reset();
    fake.config = { endpoint: "https://acme.app.spacelift.io" };
    context = {
      subscriptions: [],
      globalState: { get: (k, d) => store[k] ?? d, update: vi.fn(async (k: string, v: unknown) => void (store[k] = v)) },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: {} }))));
  });

  afterEach(() => {
    context.subscriptions.forEach((s) => s.dispose());
    Object.defineProperty(process, "platform", originalPlatform);
    vi.unstubAllGlobals();
  });

  describe("onboarding", () => {
    it("offers setup at startup, then collects the endpoint, signs in and confirms", async () => {
      fake.config = {};
      vi.mocked(diagnose)
        .mockResolvedValueOnce("no-endpoint")
        .mockResolvedValueOnce("no-endpoint")
        .mockResolvedValueOnce("not-logged-in")
        .mockResolvedValueOnce("ready");
      vi.mocked(vscode.window.showInputBox).mockResolvedValue("https://acme.app.spacelift.io/");
      prompts((m) => (m.includes("quick setup") ? "Set Up" : m.startsWith("Sign in") ? "Sign In" : undefined));

      activate(context as never);

      await vi.waitFor(() => expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Spacelift is set up."));
      expect(configUpdate).toHaveBeenCalledWith("endpoint", "https://acme.app.spacelift.io", vscode.ConfigurationTarget.Global);
      expect(browserLogin).toHaveBeenCalledWith("spacectl", "https://acme.app.spacelift.io", expect.any(AbortSignal));
    });

    it("does not prompt when everything is already configured", async () => {
      activate(context as never);
      await new Promise((resolve) => setImmediate(resolve));

      expect(diagnose).toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it("stops without saving anything when the endpoint prompt is dismissed", async () => {
      activate(context as never);
      vi.mocked(diagnose).mockResolvedValueOnce("no-endpoint");
      vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

      await command("spacelift.setup")();

      expect(configUpdate).not.toHaveBeenCalled();
      expect(browserLogin).not.toHaveBeenCalled();
    });

    it.each([
      ["darwin", "brew install spacelift-io/spacelift/spacectl"],
      ["win32", "winget install --id spacelift-io.spacectl"],
    ])("installs spacectl from a terminal on %s", async (platform, expectedCommand) => {
      setPlatform(platform);
      activate(context as never);
      vi.mocked(diagnose).mockResolvedValueOnce("no-spacectl");
      prompts((m, ...items) => (m.startsWith("spacectl was not found") ? items[0] : undefined));

      await command("spacelift.setup")();

      const terminal = vi.mocked(vscode.window.createTerminal).mock.results[0].value;
      expect(terminal.sendText).toHaveBeenCalledWith(expectedCommand);
    });

    it("opens the install guide instead of running a command on Linux", async () => {
      setPlatform("linux");
      activate(context as never);
      vi.mocked(diagnose).mockResolvedValueOnce("no-spacectl");
      prompts((m, ...items) => (m.startsWith("spacectl was not found") ? items[0] : undefined));

      await command("spacelift.setup")();

      expect(vscode.window.createTerminal).not.toHaveBeenCalled();
      expect(vscode.env.openExternal).toHaveBeenCalledWith(expect.objectContaining({ value: "https://github.com/spacelift-io/spacectl" }));
    });

    it("tells the user to restart VS Code if spacectl is still not found after installing", async () => {
      setPlatform("win32");
      activate(context as never);
      vi.mocked(diagnose).mockResolvedValueOnce("no-spacectl");
      prompts((m, ...items) => (m.startsWith("spacectl was not found") ? items[0] : undefined));

      await command("spacelift.setup")();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("restart VS Code"), "Continue");
    });

    it("reports a failed sign-in but stays quiet when the user cancels it", async () => {
      activate(context as never);
      prompts((m) => (m.startsWith("Sign in") ? "Sign In" : undefined));

      vi.mocked(diagnose).mockResolvedValueOnce("not-logged-in");
      vi.mocked(browserLogin).mockRejectedValueOnce(new Error("denied"));
      await command("spacelift.setup")();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Spacelift login failed: denied");

      vi.mocked(vscode.window.showErrorMessage).mockClear();
      vi.mocked(diagnose).mockResolvedValueOnce("not-logged-in");
      vi.mocked(browserLogin).mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
      await command("spacelift.setup")();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });

  describe("run actions", () => {
    const node = { kind: "run", stack: "s1", run: { id: "r1" } };
    const lastRequest = () => JSON.parse((vi.mocked(fetch).mock.calls.at(-1)![1] as { body: string }).body);

    it.each([
      ["spacelift.confirm", "runConfirm", undefined],
      ["spacelift.discard", "runDiscard", undefined],
      ["spacelift.approve", "runReview", "APPROVE"],
      ["spacelift.reject", "runReview", "REJECT"],
    ])("%s sends the %s mutation for the selected run", async (id, mutation, decision) => {
      activate(context as never);

      await command(id)(node);

      const { query, variables } = lastRequest();
      expect(query).toContain(mutation);
      expect(variables).toEqual({ stack: "s1", run: "r1", ...(decision && { decision }) });
      expect(vscode.window.setStatusBarMessage).toHaveBeenCalled();
    });

    it("surfaces the API message when an action is refused", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: "not allowed" }] })));
      activate(context as never);

      await command("spacelift.confirm")(node);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Spacelift: not allowed");
    });

    it("ignores action commands that are not invoked on a run", async () => {
      activate(context as never);

      await command("spacelift.confirm")({ kind: "stack" });

      expect(fetch).not.toHaveBeenCalled();
    });

    it("opens the run details panel for a run", () => {
      activate(context as never);

      command("spacelift.openRun")(node);

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    });
  });

  describe("filter and sort", () => {
    it.each([
      ["spacelift.filterApproval", "filter", "needs-approval"],
      ["spacelift.filterFailed", "filter", "failed"],
      ["spacelift.filterAll", "filter", ""],
      ["spacelift.sortRecent", "sort", "recent"],
      ["spacelift.sortAttention", "sort", "attention"],
    ])("%s persists the choice and updates the menu context", async (id, key, value) => {
      activate(context as never);

      await command(id)();

      expect(context.globalState.update).toHaveBeenCalledWith(key, value);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("setContext", `spacelift.${key}`, value);
    });

    it("restores the saved filter and sort when the extension starts", () => {
      store.filter = "failed";
      store.sort = "recent";

      activate(context as never);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("setContext", "spacelift.filtered", true);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("setContext", "spacelift.sort", "recent");
    });

    it("applies a custom filter typed by the user and clears it when emptied", async () => {
      activate(context as never);

      vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce("  prod  ");
      await command("spacelift.filter")();
      expect(context.globalState.update).toHaveBeenCalledWith("filter", "prod");

      vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce("");
      await command("spacelift.filter")();
      expect(context.globalState.update).toHaveBeenCalledWith("filter", "");
    });
  });
});
