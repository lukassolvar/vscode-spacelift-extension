import * as vscode from "vscode";
import { SpaceliftClient } from "./client";
import { InlineStatus } from "./inline";
import { RunPanel } from "./runPanel";
import { availableActions, mergeRuns, type Run, type RunAction } from "./runs";
import { filterStacks, sortStacks, type SortMode, type Stack } from "./stacks";
import { browserLogin, diagnose, installAction, spacectlExec, spacectlTokenProvider } from "./spacectl";

type Node =
  | { kind: "space"; name: string; stacks: Stack[] }
  | { kind: "stack"; stack: Stack }
  | { kind: "run"; stack: string; run: Run };

const STACKS_QUERY = `query { stacks { id name state needsApproval stateSetAt spaceDetails { name } } }`;
const RUN_FIELDS = "id title state type createdAt canConfirm needsApproval";
const RUNS_QUERY = `query($id: ID!) { stack(id: $id) { runs { ${RUN_FIELDS} } proposedRuns { ${RUN_FIELDS} } } }`;
const CONFIRM = `mutation($stack: ID!, $run: ID!) { runConfirm(stack: $stack, run: $run) { id state } }`;
const DISCARD = `mutation($stack: ID!, $run: ID!) { runDiscard(stack: $stack, run: $run) { id state } }`;
const REVIEW = `mutation($stack: ID!, $run: ID!, $decision: RunReviewDecision!) { runReview(stack: $stack, run: $run, decision: $decision) { id decision } }`;

const SORT_LABELS: Record<SortMode, string> = {
  name: "Name",
  attention: "Needs attention first",
  recent: "Recently changed",
};

const IN_PROGRESS = new Set(["QUEUED", "INITIALIZING", "PREPARING", "PLANNING", "CONFIRMED", "PREPARING_APPLY", "APPLYING", "DESTROYING", "PREPARING_REPLAN", "REPLAN_REQUESTED", "READY"]);

function icon(state: string): vscode.ThemeIcon {
  if (state === "FINISHED") return new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"));
  if (state === "FAILED") return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
  if (state === "UNCONFIRMED" || state === "PENDING_REVIEW") return new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"));
  if (IN_PROGRESS.has(state)) return new vscode.ThemeIcon("sync~spin");
  return new vscode.ThemeIcon("circle-outline");
}

export class StacksProvider implements vscode.TreeDataProvider<Node> {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  private lastError?: string;

  filter = "";
  sort: SortMode = "name";

  constructor(private client: SpaceliftClient) {}

  refresh() {
    this.changed.fire();
  }

  async getChildren(node?: Node): Promise<Node[]> {
    try {
      if (!node) {
        const { stacks } = await this.client.request<{ stacks: Stack[] }>(STACKS_QUERY);
        this.lastError = undefined;
        const bySpace = new Map<string, Stack[]>();
        for (const s of sortStacks(filterStacks(stacks, this.filter), this.sort)) bySpace.set(s.spaceDetails.name, [...(bySpace.get(s.spaceDetails.name) ?? []), s]);
        return [...bySpace].sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) => ({ kind: "space", name, stacks: list }));
      }
      if (node.kind === "space") return node.stacks.map((stack) => ({ kind: "stack", stack }));
      if (node.kind === "stack") {
        const data = await this.client.request<{ stack: { runs: Run[]; proposedRuns: Run[] } }>(RUNS_QUERY, { id: node.stack.id });
        return mergeRuns(data.stack.runs, data.stack.proposedRuns).map((run) => ({ kind: "run", stack: node.stack.id, run }));
      }
      return [];
    } catch (e) {
      const message = (e as Error).message;
      if (message !== this.lastError) {
        this.lastError = message;
        vscode.window.showErrorMessage(`Spacelift: ${message}`);
      }
      return [];
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "space") {
      const attention = node.stacks.filter((s) => s.needsApproval).length;
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
      item.description = attention ? `${attention} need approval` : `${node.stacks.length}`;
      return item;
    }
    if (node.kind === "stack") {
      const { stack } = node;
      const item = new vscode.TreeItem(stack.name.split("/").slice(1).join("/") || stack.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = stack.state;
      item.iconPath = icon(stack.needsApproval ? "UNCONFIRMED" : stack.state);
      return item;
    }
    const { run } = node;
    const item = new vscode.TreeItem(run.title, vscode.TreeItemCollapsibleState.None);
    item.description = [run.state, run.type === "PROPOSED" && "PROPOSED", new Date(run.createdAt * 1000).toLocaleString()].filter(Boolean).join(" · ");
    item.tooltip = `${run.id} (${run.type})`;
    item.iconPath = icon(run.state);
    const can = availableActions(run);
    item.contextValue = ["run", can.confirm && "confirmable", can.discard && "discardable", can.review && "reviewable"].filter(Boolean).join(" ");
    item.command = { command: "spacelift.openRun", title: "Open Run", arguments: [node] };
    return item;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const config = () => vscode.workspace.getConfiguration("spacelift");
  const exec = spacectlExec(() => config().get<string>("spacectlPath") || "spacectl");
  const runInTerminal = (command: string) => {
    const terminal = vscode.window.createTerminal("Spacelift setup");
    terminal.show();
    terminal.sendText(command);
  };
  const client = new SpaceliftClient({
    endpoint: () => {
      const endpoint = config().get<string>("endpoint");
      if (!endpoint) throw new Error("Set spacelift.endpoint in settings.");
      return endpoint;
    },
    getToken: spacectlTokenProvider(exec),
  });
  const stacks = new StacksProvider(client);
  stacks.filter = context.globalState.get<string>("filter", "");
  stacks.sort = context.globalState.get<SortMode>("sort", "name");
  const treeView = vscode.window.createTreeView("spacelift.stacks", { treeDataProvider: stacks });
  const applyView = (filter: string, sort: SortMode) => {
    stacks.filter = filter;
    stacks.sort = sort;
    context.globalState.update("filter", filter);
    context.globalState.update("sort", sort);
    treeView.message = filter ? `Filter: ${filter}` : undefined;
    treeView.description = SORT_LABELS[sort];
    vscode.commands.executeCommand("setContext", "spacelift.filtered", !!filter);
    vscode.commands.executeCommand("setContext", "spacelift.filter", filter);
    vscode.commands.executeCommand("setContext", "spacelift.sort", sort);
    stacks.refresh();
  };
  applyView(stacks.filter, stacks.sort);

  const setup = async () => {
    for (;;) {
      const status = await diagnose(exec, config().get<string>("endpoint") ?? "");
      if (status === "ready") {
        stacks.refresh();
        vscode.window.showInformationMessage("Spacelift is set up.");
        return;
      }
      if (status === "no-spacectl") {
        const install = installAction(process.platform);
        const pick = await vscode.window.showInformationMessage(
          "spacectl was not found. Spacelift needs it for authentication.",
          install.label,
          "Set Path",
        );
        if (pick === "Set Path") {
          await vscode.commands.executeCommand("workbench.action.openSettings", "spacelift.spacectlPath");
          return;
        }
        if (pick !== install.label) return;
        if ("url" in install) await vscode.env.openExternal(vscode.Uri.parse(install.url));
        else runInTerminal(install.command);
      } else if (status === "not-logged-in") {
        const pick = await vscode.window.showInformationMessage(
          "Sign in to Spacelift. Your browser will open to finish the login.",
          "Sign In",
        );
        if (!pick) return;
        try {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: "Spacelift: waiting for browser login", cancellable: true },
            (_progress, cancel) => {
              const abort = new AbortController();
              cancel.onCancellationRequested(() => abort.abort());
              return browserLogin(config().get<string>("spacectlPath") || "spacectl", config().get<string>("endpoint") ?? "", abort.signal);
            },
          );
        } catch (e) {
          if ((e as Error).name !== "AbortError") vscode.window.showErrorMessage(`Spacelift login failed: ${(e as Error).message}`);
          return;
        }
        continue;
      } else {
        const endpoint = await vscode.window.showInputBox({
          title: "Spacelift endpoint",
          prompt: "Your Spacelift account URL (same as the endpoint in your spacectl profile)",
          placeHolder: "https://<account>.app.spacelift.io",
          validateInput: (v) => (/^https:\/\/\S+$/.test(v.trim()) ? undefined : "Enter an https:// URL"),
        });
        if (!endpoint) return;
        await config().update("endpoint", endpoint.trim().replace(/\/$/, ""), vscode.ConfigurationTarget.Global);
        continue;
      }
      const next = await vscode.window.showInformationMessage(
        "Continue setup once the install has finished. If spacectl is still not found, restart VS Code so it sees the updated PATH.",
        "Continue",
      );
      if (next !== "Continue") return;
    }
  };

  diagnose(exec, config().get<string>("endpoint") ?? "").then((status) => {
    if (status !== "ready") {
      vscode.window.showInformationMessage("Spacelift needs a quick setup.", "Set Up").then((pick) => pick && setup());
    }
  });

  const act = async (kind: RunAction, stack: string, run: string) => {
    const [query, variables]: [string, Record<string, unknown>] =
      kind === "confirm" ? [CONFIRM, { stack, run }]
      : kind === "discard" ? [DISCARD, { stack, run }]
      : [REVIEW, { stack, run, decision: kind === "approve" ? "APPROVE" : "REJECT" }];
    const done = { confirm: "approved", discard: "discarded", approve: "approved review of", reject: "rejected" }[kind];
    try {
      await client.request(query, variables);
      vscode.window.setStatusBarMessage(`Spacelift: ${done} ${run}`, 4000);
    } catch (e) {
      vscode.window.showErrorMessage(`Spacelift: ${(e as Error).message}`);
    }
    stacks.refresh();
  };
  const inline = new InlineStatus(client, () => config().get<boolean>("inlineStatus", true));
  const refreshAll = () => {
    stacks.refresh();
    inline.refresh();
  };
  const inlineAction = async (kind: RunAction, stack: string, run: string, name: string) => {
    const label = { confirm: "Approve", discard: "Discard", approve: "Approve review", reject: "Reject" }[kind];
    const pick = await vscode.window.showWarningMessage(`${label} run ${run} on ${name}?`, { modal: true }, label);
    if (pick !== label) return;
    await act(kind, stack, run);
    inline.refresh();
  };
  const mutate = (kind: RunAction) => (node: Node) => (node?.kind === "run" ? act(kind, node.stack, node.run.id) : undefined);

  const timer = setInterval(refreshAll, 30_000);
  context.subscriptions.push(
    { dispose: () => clearInterval(timer) },
    treeView,
    vscode.languages.registerCodeLensProvider({ pattern: "**/*.tf" }, inline),
    vscode.languages.registerHoverProvider({ pattern: "**/*.tf" }, inline),
    vscode.commands.registerCommand("spacelift.inlineAction", inlineAction),
    vscode.commands.registerCommand("spacelift.filter", async () => {
      const text = await vscode.window.showInputBox({
        title: "Filter stacks",
        prompt: "Terms match name, space or state, e.g. `prod failed`. Leave empty to clear.",
        value: stacks.filter,
      });
      if (text !== undefined) applyView(text.trim(), stacks.sort);
    }),
    vscode.commands.registerCommand("spacelift.filterAll", () => applyView("", stacks.sort)),
    vscode.commands.registerCommand("spacelift.filterApproval", () => applyView("needs-approval", stacks.sort)),
    vscode.commands.registerCommand("spacelift.filterFailed", () => applyView("failed", stacks.sort)),
    vscode.commands.registerCommand("spacelift.sortName", () => applyView(stacks.filter, "name")),
    vscode.commands.registerCommand("spacelift.sortAttention", () => applyView(stacks.filter, "attention")),
    vscode.commands.registerCommand("spacelift.sortRecent", () => applyView(stacks.filter, "recent")),
    vscode.commands.registerCommand("spacelift.refresh", refreshAll),
    vscode.commands.registerCommand("spacelift.setup", setup),
    vscode.commands.registerCommand("spacelift.openRun", (n: Node) => n?.kind === "run" && RunPanel.show({ client, act }, n.stack, n.run.id)),
    vscode.commands.registerCommand("spacelift.confirm", mutate("confirm")),
    vscode.commands.registerCommand("spacelift.discard", mutate("discard")),
    vscode.commands.registerCommand("spacelift.approve", mutate("approve")),
    vscode.commands.registerCommand("spacelift.reject", mutate("reject")),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("spacelift") && refreshAll()),
  );
}

export function deactivate() {}
