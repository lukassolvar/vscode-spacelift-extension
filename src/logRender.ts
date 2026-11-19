export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type LineClass = "err" | "warn" | "add" | "del" | "chg" | "head" | "ok" | "";

export function classifyLine(line: string): LineClass {
  const t = line.trimStart();
  if (/^(Error\b|╷|│ Error)|Unexpected exit code|Operation failed/.test(t)) return "err";
  if (/^(Warning\b|│ Warning)/.test(t)) return "warn";
  if (/^(-\/\+|\+\/-)\s/.test(t) || /^~\s/.test(t)) return "chg";
  if (/^\+(\s|$)/.test(t)) return "add";
  if (/^-(\s|$)/.test(t)) return "del";
  if (/^(Plan:|#\s.*\bwill be\b|Apply complete|Changes to Outputs)/.test(t)) return "head";
  if (/\bis GO$|^Changes are GO|^No changes\./.test(t)) return "ok";
  return "";
}

export function renderLog(text: string): string {
  return text
    .split("\n")
    .map((line) => `<div class="l ${classifyLine(line)}">${esc(line) || "&nbsp;"}</div>`)
    .join("");
}
