import { vi } from "vitest";

type Handler = (message: any) => unknown;

export class EventEmitter<T = void> {
  private listeners: ((e: T) => void)[] = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => undefined };
  };
  fire(e?: T) {
    this.listeners.forEach((l) => l(e as T));
  }
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class ThemeIcon {
  constructor(public id: string, public color?: ThemeColor) {}
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

export class TreeItem {
  description?: string;
  tooltip?: string;
  iconPath?: ThemeIcon;
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  constructor(public label: string, public collapsibleState?: number) {}
}

export class Range {
  constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) {}
}

export class CodeLens {
  constructor(public range: Range, public command?: { title: string; command: string; arguments?: unknown[] }) {}
}

export class MarkdownString {
  isTrusted?: boolean | { enabledCommands: string[] };
  supportThemeIcons?: boolean;
  supportHtml?: boolean;
  constructor(public value = "") {}
}

export class Hover {
  constructor(public contents: MarkdownString) {}
}

export const ViewColumn = { Active: -1 };
export const ProgressLocation = { Notification: 15 };
export const ConfigurationTarget = { Global: 1 };
export const Uri = { parse: (value: string) => ({ value, toString: () => value }) };

export class FakePanel {
  title = "";
  posted: any[] = [];
  reveal = vi.fn();
  private onMessage?: Handler;
  private onDispose?: () => void;

  webview = {
    html: "",
    postMessage: vi.fn(async (message: unknown) => {
      this.posted.push(message);
      return true;
    }),
    onDidReceiveMessage: (handler: Handler) => {
      this.onMessage = handler;
      return { dispose: () => undefined };
    },
  };

  onDidDispose(handler: () => void) {
    this.onDispose = handler;
    return { dispose: () => undefined };
  }

  receive(message: unknown) {
    return this.onMessage?.(message);
  }

  dispose() {
    this.onDispose?.();
  }

  get last() {
    return this.posted[this.posted.length - 1];
  }
}

export const fake = {
  panels: [] as FakePanel[],
  config: {} as Record<string, unknown>,
  commands: new Map<string, (...args: any[]) => unknown>(),
  reset() {
    this.panels.forEach((p) => p.dispose());
    this.panels = [];
    this.config = {};
    this.commands.clear();
  },
};

export const window = {
  createWebviewPanel: vi.fn(() => {
    const panel = new FakePanel();
    fake.panels.push(panel);
    return panel;
  }),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => undefined),
  showInformationMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => undefined),
  showInputBox: vi.fn(async (_options?: unknown): Promise<string | undefined> => undefined),
  createTerminal: vi.fn(() => ({ show: vi.fn(), sendText: vi.fn() })),
  createTreeView: vi.fn(() => ({ message: undefined as string | undefined, description: undefined as string | undefined, dispose: () => undefined })),
  setStatusBarMessage: vi.fn(),
  withProgress: vi.fn(async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
    task({ report: () => undefined }, { onCancellationRequested: () => undefined }),
  ),
};

export const configUpdate = vi.fn(async (key: string, value: unknown, _target?: unknown) => {
  fake.config[key] = value;
});

export const workspace = {
  getConfiguration: () => ({
    get: (key: string, fallback?: unknown) => fake.config[key] ?? fallback,
    update: configUpdate,
  }),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: () => undefined })),
};

export const languages = {
  registerCodeLensProvider: vi.fn(() => ({ dispose: () => undefined })),
  registerHoverProvider: vi.fn(() => ({ dispose: () => undefined })),
};

export const commands = {
  registerCommand: vi.fn((id: string, handler: (...args: any[]) => unknown) => {
    fake.commands.set(id, handler);
    return { dispose: () => undefined };
  }),
  executeCommand: vi.fn(async (id: string, ...args: unknown[]) => fake.commands.get(id)?.(...args)),
};

export const env = {
  clipboard: { writeText: vi.fn(async (_text: string) => undefined) },
  openExternal: vi.fn(async (_uri: unknown) => true),
};
