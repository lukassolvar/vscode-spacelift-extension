import * as vscode from "vscode";
import type { GraphQLClient } from "./client";
import { availableActions, type RunAction } from "./runs";

export interface StackBlock {
  label: string;
  line: number;
  name?: string;
}

interface Blocker {
  id: string;
  state: string;
  canConfirm: boolean;
  needsApproval: boolean;
}

export interface InlineStack {
  id: string;
  name: string;
  state: string;
  needsApproval: boolean;
  stateSetAt: number | null;
  stateSetBy: string | null;
  isDisabled: boolean;
  lockedBy: string | null;
  blocker: Blocker | null;
}

export interface RunHistory {
  id: string;
  title?: string;
  branch?: string;
  triggeredBy: string | null;
  commit?: { hash: string; authorName: string; message: string; url: string } | null;
  delta?: { addCount: number; changeCount: number; deleteCount: number } | null;
  history: { state: string; username: string | null; timestamp: number }[];
}

export type Kind = "applied" | "attention" | "failed" | "hold" | "running" | "other";

const STACKS_QUERY = `query { stacks { id name state needsApproval stateSetAt stateSetBy isDisabled lockedBy blocker { id state canConfirm needsApproval } } }`;
const RUN_QUERY = `query($stack: ID!, $run: ID!) { stack(id: $stack) { run(id: $run) {
  id title branch triggeredBy
  commit { hash authorName message url }
  delta { addCount changeCount deleteCount }
  history { state username timestamp }
} } }`;

const RESOURCE = /^\s*resource\s+"spacelift_stack"\s+"([^"]+)"\s*\{/;
const NAME = /(?:^|[{\s])name\s*=\s*"([^"]*)"/;
const STRINGS = /"(?:[^"\\]|\\.)*"/g;

const braceDelta = (line: string) => {
  const code = line.replace(STRINGS, '""').replace(/#.*$|\/\/.*$/, "");
  return (code.match(/\{/g)?.length ?? 0) - (code.match(/\}/g)?.length ?? 0);
};

const literal = (value: string | undefined) => (value === undefined || value.includes("${") ? undefined : value);

export function findStackBlocks(text: string): StackBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: StackBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = RESOURCE.exec(lines[i]);
    if (!head) continue;
    const block: StackBlock = { label: head[1], line: i, name: undefined };
    blocks.push(block);
    let depth = braceDelta(lines[i]);
    if (depth <= 0) {
      block.name = literal(NAME.exec(lines[i].slice(head[0].length - 1))?.[1]);
      continue;
    }
    while (depth > 0 && ++i < lines.length) {
      if (depth === 1 && block.name === undefined) {
        const match = /^\s*name\s*=\s*"([^"]*)"\s*$/.exec(lines[i]);
        if (match) block.name = literal(match[1]);
      }
      depth += braceDelta(lines[i]);
    }
  }
  return blocks;
}

const IN_PROGRESS = new Set(["QUEUED", "INITIALIZING", "PREPARING", "PLANNING", "CONFIRMED", "PREPARING_APPLY", "APPLYING", "DESTROYING", "PREPARING_REPLAN", "REPLAN_REQUESTED", "READY"]);
const humanize = (state: string) => state.charAt(0) + state.slice(1).toLowerCase().replace(/_/g, " ");

export function classify(stack: InlineStack): { kind: Kind; label: string } {
  if (stack.lockedBy) return { kind: "hold", label: `On hold (locked by ${stack.lockedBy})` };
  if (stack.isDisabled) return { kind: "hold", label: "On hold (disabled)" };
  if (stack.needsApproval || stack.state === "UNCONFIRMED" || stack.state === "PENDING_REVIEW") return { kind: "attention", label: "Needs attention" };
  if (stack.state === "FAILED") return { kind: "failed", label: "Failed" };
  if (stack.state === "FINISHED") return { kind: "applied", label: "Applied" };
  if (IN_PROGRESS.has(stack.state)) return { kind: "running", label: humanize(stack.state) };
  return { kind: "other", label: humanize(stack.state) };
}

export function lastChange(run: RunHistory): { at: number; who?: string } {
  const at = run.history.reduce((max, t) => Math.max(max, t.timestamp), 0);
  const decision = [...run.history].sort((a, b) => b.timestamp - a.timestamp).find((t) => (t.state === "CONFIRMED" || t.state === "DISCARDED") && t.username);
  if (decision) return { at, who: `${decision.state === "CONFIRMED" ? "approved" : "discarded"} by ${decision.username}` };
  return { at, who: run.triggeredBy ? `triggered by ${run.triggeredBy}` : undefined };
}

export function lensActions(stack: InlineStack): { action: RunAction; title: string }[] {
  if (!stack.blocker) return [];
  const can = availableActions(stack.blocker);
  return [
    can.confirm && { action: "confirm" as const, title: "$(check) Approve" },
    can.review && { action: "approve" as const, title: "$(check) Approve review" },
    can.review && { action: "reject" as const, title: "$(close) Reject" },
    can.discard && { action: "discard" as const, title: "$(trash) Discard" },
  ].filter((a): a is { action: RunAction; title: string } => !!a);
}

export function ago(timestamp: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - timestamp);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const ICONS: Record<Kind, string> = { applied: "pass", attention: "warning", failed: "error", hold: "debug-pause", running: "sync", other: "circle-outline" };
export interface Details {
  stack: InlineStack;
  run?: RunHistory;
}

const STATUS_COLORS: Record<Kind, string> = {
  applied: "--vscode-testing-iconPassed",
  attention: "--vscode-editorWarning-foreground",
  failed: "--vscode-testing-iconFailed",
  hold: "--vscode-charts-purple",
  running: "--vscode-charts-blue",
  other: "--vscode-descriptionForeground",
};

// Hover links can run Approve/Discard, so text from the repository or API must never become markdown or HTML.
const md = (text: string) => text.replace(/[\\`*_{}[\]()#+\-.!|<>&~]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : `\\${c}`));
const code = (text: string) => `\`${text.replace(/[`\n]/g, "'")}\``;
const commandLink = (title: string, id: string, args: unknown[]) => `[${title}](command:${id}?${encodeURIComponent(JSON.stringify(args))})`;

export function hoverMarkdown({ stack, run }: Details, now = Date.now() / 1000): string {
  const status = classify(stack);
  const change = run && lastChange(run);
  const when = change?.at ?? stack.stateSetAt;
  const head = `$(${ICONS[status.kind]}) <span style="color:var(${STATUS_COLORS[status.kind]});">**${md(status.label)}**</span>`;
  const lines = [[head, when && ago(when, now), change?.who && md(change.who)].filter(Boolean).join(" · "), "", code(stack.name)];
  const runId = stack.blocker?.id ?? run?.id ?? stack.stateSetBy;
  const actions = [
    runId && commandLink("$(link-external) Open run", "spacelift.openRun", [{ kind: "run", stack: stack.id, run: { id: runId } }]),
    ...lensActions(stack).map((a) => commandLink(a.title, "spacelift.inlineAction", [a.action, stack.id, stack.blocker!.id, stack.name])),
  ].filter(Boolean);
  if (actions.length) lines.push("", actions.join(" &nbsp;·&nbsp; "));
  if (run) {
    lines.push("", "---", "", `$(play) ${md(run.title ?? run.id)}${run.branch ? ` on ${code(run.branch)}` : ""}`);
    const facts: string[] = [];
    if (run.commit) {
      const hash = md(run.commit.hash.slice(0, 7));
      const firstLine = run.commit.message.split("\n")[0];
      facts.push(`$(git-commit) ${/^https:\/\//.test(run.commit.url) ? `[${hash}](${run.commit.url.replace(/[()\s]/g, encodeURIComponent)})` : hash} ${md(run.commit.authorName)}${firstLine === run.title ? "" : `: ${md(firstLine)}`}`);
    }
    if (run.delta) {
      const { addCount, changeCount, deleteCount } = run.delta;
      facts.push(addCount || changeCount || deleteCount ? `$(diff) +${addCount} ~${changeCount} -${deleteCount}` : "$(diff) no resource changes");
    }
    if (facts.length) lines.push("", facts.join(" · "));
    lines.push("", "| State | When | By |", "|---|---|---|");
    for (const t of [...run.history].sort((a, b) => b.timestamp - a.timestamp)) lines.push(`| ${md(humanize(t.state))} | ${ago(t.timestamp, now)} | ${t.username ? md(t.username) : ""} |`);
  }
  if (stack.lockedBy) lines.push("", `$(lock) Locked by ${md(stack.lockedBy)}`);
  return lines.join("\n");
}

export function tooltipText({ stack, run }: Details, now = Date.now() / 1000): string {
  const status = classify(stack);
  const change = run && lastChange(run);
  const when = change?.at ?? stack.stateSetAt;
  const lines = [stack.name, [status.label, when && ago(when, now), change?.who].filter(Boolean).join(" · ")];
  if (run) {
    lines.push("", `${run.title ?? run.id}${run.branch ? ` on ${run.branch}` : ""}`);
    const facts = [
      run.commit && `${run.commit.hash.slice(0, 7)} ${run.commit.authorName}`,
      run.delta && (run.delta.addCount || run.delta.changeCount || run.delta.deleteCount ? `+${run.delta.addCount} ~${run.delta.changeCount} -${run.delta.deleteCount}` : "no resource changes"),
    ].filter(Boolean);
    if (facts.length) lines.push(facts.join(" · "));
  }
  lines.push("", "Click to open the run. Hover the resource line for actions and history.");
  return lines.join("\n");
}

interface Resolved {
  block: StackBlock;
  stack?: InlineStack;
  run?: RunHistory;
}

export class InlineStatus implements vscode.CodeLensProvider, vscode.HoverProvider {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  private stacks?: Promise<Map<string, InlineStack>>;
  private runs = new Map<string, Promise<RunHistory | undefined>>();

  constructor(private client: GraphQLClient, private enabled: () => boolean) {}

  refresh() {
    this.stacks = undefined;
    this.runs.clear();
    this.changed.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!this.enabled()) return [];
    const resolved = await this.resolve(document.getText());
    return resolved.flatMap(({ block, stack, run }) => {
      const range = new vscode.Range(block.line, 0, block.line, 0);
      const text = (title: string, command = "", args?: unknown[], tooltip?: string) => new vscode.CodeLens(range, { title, command, arguments: args, tooltip });
      if (!block.name) return [text("$(info) Spacelift: stack name is computed, cannot match it")];
      if (!stack) return [text("$(question) Spacelift: no stack with this name yet")];
      const status = classify(stack);
      const change = run && lastChange(run);
      const when = change?.at ?? stack.stateSetAt;
      const summary = [`$(${ICONS[status.kind]}) ${status.label}`, when && ago(when), change?.who].filter(Boolean).join(" · ");
      const runId = stack.blocker?.id ?? run?.id ?? stack.stateSetBy;
      const tooltip = tooltipText({ stack, run });
      return [
        runId ? text(summary, "spacelift.openRun", [{ kind: "run", stack: stack.id, run: { id: runId } }], tooltip) : text(summary),
        ...lensActions(stack).map((a) => text(a.title, "spacelift.inlineAction", [a.action, stack.id, stack.blocker!.id, stack.name])),
      ];
    });
  }

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    if (!this.enabled()) return undefined;
    const hit = (await this.resolve(document.getText())).find((r) => r.block.line === position.line && r.stack);
    if (!hit?.stack) return undefined;
    const content = new vscode.MarkdownString(hoverMarkdown({ stack: hit.stack, run: hit.run }));
    content.isTrusted = { enabledCommands: ["spacelift.openRun", "spacelift.inlineAction"] };
    content.supportThemeIcons = true;
    content.supportHtml = true;
    return new vscode.Hover(content);
  }

  private async resolve(text: string): Promise<Resolved[]> {
    const blocks = findStackBlocks(text);
    if (!blocks.length) return [];
    try {
      const stacks = await this.loadStacks();
      return await Promise.all(
        blocks.map(async (block) => {
          const stack = block.name ? stacks.get(block.name) : undefined;
          return { block, stack, run: stack?.stateSetBy ? await this.loadRun(stack.id, stack.stateSetBy) : undefined };
        }),
      );
    } catch {
      // The tree view already reports API errors; keep the editor quiet.
      this.stacks = undefined;
      return [];
    }
  }

  private loadStacks() {
    this.stacks ??= this.client
      .request<{ stacks: InlineStack[] }>(STACKS_QUERY)
      .then(({ stacks }) => new Map(stacks.map((s) => [s.name, s])));
    return this.stacks;
  }

  private loadRun(stack: string, run: string) {
    const key = `${stack}/${run}`;
    if (!this.runs.has(key)) {
      this.runs.set(key, this.client.request<{ stack: { run: RunHistory | null } }>(RUN_QUERY, { stack, run }).then((d) => d.stack.run ?? undefined, () => undefined));
    }
    return this.runs.get(key)!;
  }
}
