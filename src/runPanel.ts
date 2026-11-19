import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { GraphQLClient } from "./client";
import { fetchLogs } from "./logs";
import type { RunAction } from "./runs";
import { esc, renderLog } from "./logRender";
import {
  changesHtml, emptyLogMessage, entryKey, headerHtml, LOADING_HTML, needsLogFetch, pageHtml, stepsHtml,
  type ResourceChangeItem, type RunData, type StackData, type Transition,
} from "./runView";

const RUN_QUERY = `query($stack: ID!, $run: ID!) { runLogRetentionDays stack(id: $stack) {
  id name projectRoot terraformVersion spaceDetails { name }
  run(id: $run) {
    id title state type branch triggeredBy createdAt canConfirm needsApproval
    commit { hash authorName message url timestamp }
    delta { addCount changeCount deleteCount }
    history { state hasLogs stateVersion timestamp until terminal }
  }
} }`;

const CHANGES_QUERY = `query($stack: ID!, $run: ID!) { stack(id: $stack) { run(id: $run) {
  changesV3(input: {}) { resources { address metadata { type } } }
} } }`;

export interface PanelDeps {
  client: GraphQLClient;
  act: (kind: RunAction, stack: string, run: string) => Promise<void>;
}

export class RunPanel {
  private static current?: RunPanel;

  private selected?: string;
  private selectionIsManual = false;
  private logCache = new Map<string, string>();
  private logError?: { key: string; message: string };
  private last?: { stack: StackData; run: RunData; resources: ResourceChangeItem[]; retention: number | null };
  private timer?: NodeJS.Timeout;
  private seq = 0;

  private constructor(
    private panel: vscode.WebviewPanel,
    private deps: PanelDeps,
    private stackId: string,
    private runId: string,
  ) {
    panel.webview.html = pageHtml(randomBytes(16).toString("hex"));
    panel.webview.onDidReceiveMessage((m: { cmd: string; value?: string }) => this.onMessage(m));
    panel.onDidDispose(() => {
      clearTimeout(this.timer);
      this.seq++;
      RunPanel.current = undefined;
    });
  }

  static show(deps: PanelDeps, stackId: string, runId: string) {
    const existing = RunPanel.current;
    if (existing) {
      existing.panel.reveal();
      if (existing.stackId !== stackId || existing.runId !== runId) existing.retarget(stackId, runId);
      return;
    }
    const panel = vscode.window.createWebviewPanel("spacelift.run", "Spacelift run", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    RunPanel.current = new RunPanel(panel, deps, stackId, runId);
  }

  private retarget(stackId: string, runId: string) {
    this.stackId = stackId;
    this.runId = runId;
    this.selected = undefined;
    this.selectionIsManual = false;
    this.logCache.clear();
    this.logError = undefined;
    this.last = undefined;
    clearTimeout(this.timer);
    void this.render();
  }

  private async onMessage(m: { cmd: string; value?: string }) {
    switch (m.cmd) {
      case "ready":
      case "refresh":
        return this.render();
      case "select": {
        this.selected = m.value;
        this.selectionIsManual = true;
        const step = this.currentStep();
        this.post();
        if (step && needsLogFetch(step, this.logCache.has(this.selected!))) {
          await this.loadLogs(step);
          this.post();
        }
        return;
      }
      case "copy": {
        const text = this.selected && this.logCache.get(this.selected);
        if (text) await vscode.env.clipboard.writeText(text);
        return;
      }
      case "confirm":
      case "discard":
      case "approve":
      case "reject":
        await this.deps.act(m.cmd, this.stackId, this.runId);
        return this.render();
    }
  }

  private currentStep(): Transition | undefined {
    return this.last?.run.history.find((t) => t.hasLogs && entryKey(t) === this.selected);
  }

  private async loadLogs(step: Transition) {
    const key = entryKey(step);
    try {
      const { text } = await fetchLogs(this.deps.client, this.stackId, this.runId, step.state, step.stateVersion ?? undefined);
      this.logCache.set(key, text);
      if (this.logError?.key === key) this.logError = undefined;
    } catch (e) {
      this.logError = { key, message: `Failed to load logs: ${(e as Error).message}` };
    }
  }

  private post() {
    if (!this.last) return;
    const { stack, run, resources, retention } = this.last;
    const step = this.currentStep();
    const now = Date.now() / 1000;
    const cached = this.selected === undefined ? undefined : this.logCache.get(this.selected);
    const failed = this.logError?.key === this.selected ? this.logError?.message : undefined;
    let log: string;
    if (failed) log = renderLog(failed);
    else if (!step) log = '<div class="empty">No logs for this run yet.</div>';
    else if (cached === undefined) log = LOADING_HTML;
    else log = cached.trim() ? renderLog(cached) : `<div class="empty">${esc(emptyLogMessage(run.createdAt, retention, now))}</div>`;
    const visible = resources.filter((r) => r.metadata.type !== "NOOP" && r.metadata.type !== "READ");
    this.panel.title = `${stack.name.split("/").pop()} · ${this.runId.slice(-6)}`;
    void this.panel.webview.postMessage({
      error: "",
      header: headerHtml(stack, run, now),
      steps: stepsHtml(run.history, this.selected, now),
      selected: this.selected,
      logTitle: step ? step.state : "",
      log,
      changesLabel: visible.length ? `CHANGES (${visible.length})` : "CHANGES",
      changes: changesHtml(resources),
    });
  }

  private async render() {
    const seq = ++this.seq;
    clearTimeout(this.timer);
    const { client } = this.deps;
    const vars = { stack: this.stackId, run: this.runId };
    try {
      const [data, resources] = await Promise.all([
        client.request<{ runLogRetentionDays: number | null; stack: StackData & { run: RunData } }>(RUN_QUERY, vars),
        client
          .request<{ stack: { run: { changesV3: { resources: ResourceChangeItem[] }[] } } }>(CHANGES_QUERY, vars)
          .then((d) => d.stack.run.changesV3.flatMap((c) => c.resources))
          .catch(() => [] as ResourceChangeItem[]),
      ]);
      const { run, ...stack } = data.stack;
      const withLogs = run.history.filter((t) => t.hasLogs);
      if (!this.selectionIsManual || !withLogs.some((t) => entryKey(t) === this.selected)) {
        this.selected = withLogs[0] && entryKey(withLogs[0]);
        this.selectionIsManual = false;
      }
      if (seq !== this.seq) return;
      this.last = { stack, run, resources, retention: data.runLogRetentionDays };

      const step = this.currentStep();
      if (step && needsLogFetch(step, this.logCache.has(this.selected!))) {
        this.post();
        await this.loadLogs(step);
        if (seq !== this.seq) return;
      }
      this.post();

      const done = run.history.some((t) => t.terminal) || run.state === "UNCONFIRMED";
      if (!done) this.timer = setTimeout(() => void this.render(), 5000);
    } catch (e) {
      if (seq === this.seq) void this.panel.webview.postMessage({ error: (e as Error).message });
    }
  }
}
