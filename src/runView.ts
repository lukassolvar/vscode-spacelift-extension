import { esc } from "./logRender";
import { availableActions } from "./runs";

export interface Transition {
  state: string;
  hasLogs: boolean;
  stateVersion: number | null;
  timestamp: number;
  until: number | null;
  terminal: boolean;
}

export interface RunData {
  id: string;
  title: string;
  state: string;
  type: string;
  branch: string;
  triggeredBy: string | null;
  createdAt: number;
  canConfirm: boolean;
  needsApproval: boolean;
  commit: { hash: string; authorName: string; message: string; url: string; timestamp: number };
  delta: { addCount: number; changeCount: number; deleteCount: number } | null;
  history: Transition[];
}

export interface StackData {
  id: string;
  name: string;
  spaceDetails: { name: string };
  projectRoot: string | null;
  terraformVersion: string | null;
}

export interface ResourceChangeItem {
  address: string;
  metadata: { type: string };
}

type Status = "ok" | "failed" | "warn" | "stopped" | "running";

const GLYPH: Record<Status, string> = { ok: "✓", failed: "✕", warn: "!", stopped: "■", running: "●" };
const STOPPED = new Set(["DISCARDED", "CANCELED", "STOPPED", "SKIPPED"]);

export const entryKey = (t: Pick<Transition, "state" | "stateVersion" | "timestamp">) => `${t.state}:${t.stateVersion ?? t.timestamp}`;

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const stateLabel = (state: string) => {
  const words = state.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function badgeStatus(state: string): Status {
  if (state === "FINISHED") return "ok";
  if (state === "FAILED") return "failed";
  if (state === "UNCONFIRMED") return "warn";
  if (STOPPED.has(state)) return "stopped";
  return "running";
}

function stepStatus(t: Transition): Status {
  if (t.state === "FAILED") return "failed";
  if (t.state === "UNCONFIRMED" && t.until === null) return "warn";
  if (STOPPED.has(t.state)) return "stopped";
  if (t.until === null && !t.terminal) return "running";
  return "ok";
}

export function stepHtml(t: Transition, selected: boolean, now: number): string {
  const status = stepStatus(t);
  const duration = t.terminal ? "" : `<span class="dim">${formatDuration((t.until ?? now) - t.timestamp)}</span>`;
  const attrs = t.hasLogs ? ` data-cmd="select" data-value="${esc(entryKey(t))}"` : "";
  const classes = ["step", status, selected && "selected", t.hasLogs && "clickable"].filter(Boolean).join(" ");
  return `<div class="${classes}"${attrs}><span class="dot">${GLYPH[status]}</span><span class="name">${esc(stateLabel(t.state))}</span>${duration}</div>`;
}

export function stepsHtml(history: Transition[], selectedKey: string | undefined, now: number): string {
  return [...history].reverse().map((t) => stepHtml(t, entryKey(t) === selectedKey, now)).join("");
}

export function emptyLogMessage(createdAt: number, retentionDays: number | null, now: number): string {
  const ageDays = Math.floor((now - createdAt) / 86400);
  if (retentionDays !== null && ageDays >= retentionDays) {
    return `No log output available. This run is ${ageDays} days old and Spacelift keeps logs for ${retentionDays} days, so they have probably been deleted.`;
  }
  return "No log output for this phase.";
}

export const needsLogFetch = (step: Transition, cached: boolean) => !cached || step.until === null;

export const LOADING_HTML = '<div class="loading"><span class="spinner"></span>Loading logs…</div>';

const date = (ts: number) => new Date(ts * 1000).toLocaleString();

export function headerHtml(stack: StackData, run: RunData, now = Date.now() / 1000): string {
  const status = badgeStatus(run.state);
  const first = run.history[run.history.length - 1];
  const latest = run.history[0];
  const total = first && latest ? `<span class="dim">· ${formatDuration((latest.terminal ? latest.timestamp : now) - first.timestamp)}</span>` : "";
  const commit = /^https:\/\//.test(run.commit.url)
    ? `<a href="${esc(run.commit.url)}">${esc(run.commit.hash.slice(0, 7))}</a>`
    : esc(run.commit.hash.slice(0, 7));
  const delta = run.delta && (run.delta.addCount || run.delta.changeCount || run.delta.deleteCount)
    ? `<span class="add">+${run.delta.addCount}</span> <span class="chg">~${run.delta.changeCount}</span> <span class="del">-${run.delta.deleteCount}</span>`
    : "";
  const chips = [
    esc(stack.spaceDetails.name),
    stack.terraformVersion && `v${esc(stack.terraformVersion)}`,
    stack.projectRoot && esc(stack.projectRoot),
    esc(run.branch),
    commit,
    run.triggeredBy && esc(run.triggeredBy),
    `Started ${esc(date(run.createdAt))}`,
    esc(stateLabel(run.type)),
  ].filter(Boolean);
  const can = availableActions(run);
  const actions = [
    can.review && '<button class="primary" data-cmd="approve">Approve</button>',
    can.review && '<button data-cmd="reject">Reject</button>',
    can.confirm && '<button class="primary" data-cmd="confirm">Approve</button>',
    can.discard && '<button data-cmd="discard">Discard</button>',
    '<button data-cmd="refresh" title="Reload this run">↻ Refresh</button>',
  ].filter(Boolean).join("");
  return `<div class="crumb">${esc(stack.name)}</div>
<div class="titlerow"><h1>${esc(run.title)}</h1><span class="actions">${actions}</span></div>
<div class="status"><span class="badge ${status}">${GLYPH[status]} ${esc(stateLabel(run.state))}</span> ${total} ${delta}</div>
<div class="meta">${chips.join(" · ")}</div>`;
}

const CHANGE_CLASS = (type: string) => (type === "DELETE" ? "del" : type.startsWith("ADD") || type === "IMPORT" || type === "CREATE_AFTER_FORGOTTEN" ? "add" : "chg");

export function changesHtml(resources: ResourceChangeItem[]): string {
  const rows = resources
    .filter((r) => r.metadata.type !== "NOOP" && r.metadata.type !== "READ")
    .map((r) => `<div class="change"><span class="tag ${CHANGE_CLASS(r.metadata.type)}">${esc(r.metadata.type.split("_")[0])}</span><code>${esc(r.address)}</code></div>`);
  return rows.length ? rows.join("") : '<div class="empty">No resource changes.</div>';
}

export function pageHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  [hidden] { display: none !important; }
  html, body { height: 100%; margin: 0; }
  body { overflow: hidden; display: flex; flex-direction: column; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 13px var(--vscode-font-family); }
  header { padding: 14px 20px 6px; }
  .crumb, .meta, .dim { color: var(--vscode-descriptionForeground); }
  .titlerow { display: flex; align-items: center; gap: 12px; }
  h1 { font-size: 20px; font-weight: 600; margin: 4px 0; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { margin: 4px 0; display: flex; gap: 8px; align-items: center; }
  .meta { margin: 4px 0 8px; }
  a { color: var(--vscode-textLink-foreground); }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 0; padding: 4px 12px; border-radius: 2px; cursor: pointer; margin-left: 6px; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .tabs { display: flex; padding: 0 20px; border-bottom: 1px solid var(--vscode-panel-border); }
  .tab { background: none; color: var(--vscode-descriptionForeground); border-bottom: 2px solid transparent; border-radius: 0; margin: 0 16px 0 0; padding: 6px 0; letter-spacing: .04em; }
  .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
  .panes { flex: 1; min-height: 0; display: grid; grid-template-columns: 280px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  #steps { border-right: 1px solid var(--vscode-panel-border); overflow: auto; padding: 4px 0; }
  .step { display: flex; align-items: center; gap: 8px; padding: 6px 16px; }
  .step.clickable { cursor: pointer; }
  .step.clickable:hover { background: var(--vscode-list-hoverBackground); }
  .step.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .step .name { flex: 1; }
  .dot { width: 16px; text-align: center; font-weight: 700; }
  .ok { color: var(--vscode-testing-iconPassed); }
  .failed { color: var(--vscode-testing-iconFailed); }
  .warn { color: var(--vscode-editorWarning-foreground); }
  .stopped { color: var(--vscode-descriptionForeground); }
  .running { color: var(--vscode-textLink-foreground); }
  .running .dot { animation: pulse 1.2s infinite; }
  @keyframes pulse { 50% { opacity: .3; } }
  .badge { font-weight: 600; padding: 1px 8px; border-radius: 10px; border: 1px solid currentColor; }
  .logpane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .logbar { flex: none; display: flex; justify-content: space-between; align-items: center; padding: 6px 16px; color: var(--vscode-descriptionForeground); }
  .log { flex: 1; min-height: 0; overflow: auto; padding: 0 16px 16px; font: var(--vscode-editor-font-size, 12px) var(--vscode-editor-font-family, monospace); counter-reset: line; }
  .l { white-space: pre-wrap; word-break: break-word; counter-increment: line; padding-left: 4px; }
  .l::before { content: counter(line); display: inline-block; width: 3ch; margin-right: 12px; text-align: right; color: var(--vscode-editorLineNumber-foreground); user-select: none; }
  .l.err { color: var(--vscode-testing-iconFailed); }
  .l.warn { color: var(--vscode-editorWarning-foreground); }
  .l.add, .add { color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950); }
  .l.del, .del { color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149); }
  .l.chg, .chg { color: var(--vscode-gitDecoration-modifiedResourceForeground, #d29922); }
  .l.head { font-weight: 700; }
  .l.ok { color: var(--vscode-testing-iconPassed); }
  #pane-changes { flex: 1; min-height: 0; padding: 12px 20px; overflow: auto; }
  header, .tabs { flex: none; }
  .change { display: flex; gap: 12px; padding: 3px 0; align-items: baseline; }
  .tag { width: 72px; font-weight: 700; font-size: 11px; }
  .error { margin: 8px 20px; padding: 8px 12px; border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); }
  .empty { color: var(--vscode-descriptionForeground); padding: 8px 0; }
  .loading { display: flex; align-items: center; gap: 10px; padding: 12px 4px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-font-family); }
  .spinner { width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  body.busy::before { content: ""; position: fixed; top: 0; left: 0; height: 2px; width: 40%; background: var(--vscode-progressBar-background, var(--vscode-focusBorder)); animation: slide 1s ease-in-out infinite; }
  @keyframes slide { from { left: -40%; } to { left: 100%; } }
</style></head>
<body>
<div id="error" class="error" hidden></div>
<header id="header"></header>
<nav class="tabs">
  <button class="tab active" id="tab-steps" data-cmd="tab" data-value="steps">STEPS</button>
  <button class="tab" id="tab-changes" data-cmd="tab" data-value="changes">CHANGES</button>
</nav>
<main id="pane-steps" class="panes">
  <aside id="steps"></aside>
  <section class="logpane">
    <div class="logbar"><span id="logtitle"></span><button data-cmd="copy" title="Copy log">Copy</button></div>
    <div id="log" class="log"></div>
  </section>
</main>
<main id="pane-changes" hidden><div id="changes"></div></main>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const last = {};
  let selected;
  function setHtml(id, html) { if (last[id] !== html) { last[id] = html; $(id).innerHTML = html; } }
  function showTab(name) {
    for (const n of ['steps', 'changes']) {
      $('pane-' + n).hidden = n !== name;
      $('tab-' + n).classList.toggle('active', n === name);
    }
  }
  window.addEventListener('message', (e) => {
    const d = e.data;
    document.body.classList.remove('busy');
    $('error').hidden = !d.error;
    $('error').textContent = d.error || '';
    if (d.header === undefined) return;
    setHtml('header', d.header);
    setHtml('steps', d.steps);
    setHtml('changes', d.changes);
    $('tab-changes').textContent = d.changesLabel;
    $('logtitle').textContent = d.logTitle;
    const log = $('log');
    const follow = d.selected !== selected || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    selected = d.selected;
    if (last.log !== d.log) { last.log = d.log; log.innerHTML = d.log; }
    if (follow) log.scrollTop = log.scrollHeight;
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-cmd]');
    if (!t) return;
    if (t.dataset.cmd === 'tab') return showTab(t.dataset.value);
    if (['refresh', 'confirm', 'discard', 'approve', 'reject'].includes(t.dataset.cmd)) document.body.classList.add('busy');
    vscode.postMessage({ cmd: t.dataset.cmd, value: t.dataset.value });
  });
  vscode.postMessage({ cmd: 'ready' });
</script>
</body></html>`;
}
