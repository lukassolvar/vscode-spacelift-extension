import { describe, expect, it, vi } from "vitest";
import { ago, classify, hoverMarkdown, tooltipText, findStackBlocks, InlineStatus, lastChange, lensActions, type InlineStack } from "./inline";

const tf = `
# IAM Users Stack
resource "spacelift_stack" "iam_users" {
  name        = "saiva-dev/shared/saiva-iam-users"
  space_id    = local.defaults.space_id

  additional_project_globs = [
    "terraform/modules/access/iam-groups/**/*",
  ]

  dynamic "github_enterprise" {
    content { name = "nested-should-be-ignored" }
  }

  labels = local.defaults.base_labels
}

resource "spacelift_stack" "templated" {
  name = "\${local.env}/shared/thing"
}

resource "aws_iam_user" "not_a_stack" {
  name = "bob"
}

resource "spacelift_stack"   "compact" { name = "acme/compact" }
`;

describe("findStackBlocks", () => {
  it("ignores braces inside strings and comments when finding the block's name", () => {
    const text = [
      'resource "spacelift_stack" "tricky" {',
      '  description = "uses } and { in text"',
      "  # closing } in a comment",
      "  // another } here",
      '  name = "acme/tricky"',
      "}",
    ].join("\r\n");

    expect(findStackBlocks(text)).toEqual([{ label: "tricky", line: 0, name: "acme/tricky" }]);
  });

  it("finds each spacelift_stack block with its literal name and resource line", () => {
    expect(findStackBlocks(tf)).toEqual([
      { label: "iam_users", line: 2, name: "saiva-dev/shared/saiva-iam-users" },
      { label: "templated", line: 17, name: undefined },
      { label: "compact", line: 25, name: "acme/compact" },
    ]);
  });
});

const stack = (extra: Partial<InlineStack> = {}): InlineStack => ({
  id: "iam",
  name: "saiva-dev/shared/saiva-iam-users",
  state: "FINISHED",
  needsApproval: false,
  stateSetAt: 100,
  stateSetBy: "r1",
  isDisabled: false,
  lockedBy: null,
  blocker: null,
  ...extra,
});

describe("classify", () => {
  it.each([
    [stack(), "applied"],
    [stack({ state: "UNCONFIRMED", needsApproval: true }), "attention"],
    [stack({ state: "FINISHED", needsApproval: true }), "attention"],
    [stack({ state: "FAILED" }), "failed"],
    [stack({ state: "FINISHED", isDisabled: true }), "hold"],
    [stack({ state: "FAILED", lockedBy: "alice" }), "hold"],
    [stack({ state: "APPLYING" }), "running"],
    [stack({ state: "NONE" }), "other"],
  ])("maps %o to %s", (s, kind) => {
    expect(classify(s).kind).toBe(kind);
  });

  it("explains a hold with who locked the stack", () => {
    expect(classify(stack({ lockedBy: "alice" })).label).toBe("On hold (locked by alice)");
  });
});

describe("lastChange", () => {
  it("names the person who confirmed the run as the approver", () => {
    const run = {
      id: "r1",
      triggeredBy: "vcs/commit",
      history: [
        { state: "QUEUED", username: null, timestamp: 10 },
        { state: "UNCONFIRMED", username: null, timestamp: 20 },
        { state: "CONFIRMED", username: "alice", timestamp: 30 },
        { state: "FINISHED", username: null, timestamp: 40 },
      ],
    };
    expect(lastChange(run)).toEqual({ at: 40, who: "approved by alice" });
  });

  it("names the person who discarded the run", () => {
    const run = { id: "r1", triggeredBy: "bob", history: [{ state: "UNCONFIRMED", username: null, timestamp: 20 }, { state: "DISCARDED", username: "dave", timestamp: 30 }] };
    expect(lastChange(run)).toEqual({ at: 30, who: "discarded by dave" });
  });

  it("falls back to who triggered the run when nobody confirmed it", () => {
    const run = { id: "r1", triggeredBy: "bob", history: [{ state: "FAILED", username: null, timestamp: 50 }] };
    expect(lastChange(run)).toEqual({ at: 50, who: "triggered by bob" });
  });
});

describe("lensActions", () => {
  it("offers approve and discard for an unconfirmed tracked run", () => {
    const s = stack({ state: "UNCONFIRMED", needsApproval: true, blocker: { id: "b1", state: "UNCONFIRMED", canConfirm: true, needsApproval: false } });
    expect(lensActions(s).map((a) => a.action)).toEqual(["confirm", "discard"]);
  });

  it("offers review decisions instead of confirm when an approval policy is waiting", () => {
    const s = stack({ blocker: { id: "b1", state: "UNCONFIRMED", canConfirm: true, needsApproval: true } });
    expect(lensActions(s).map((a) => a.action)).toEqual(["approve", "reject", "discard"]);
  });

  it("offers nothing when no run is blocking the stack", () => {
    expect(lensActions(stack())).toEqual([]);
  });
});

describe("ago", () => {
  it.each([
    [30, "just now"],
    [5 * 60, "5 min ago"],
    [3 * 3600, "3 h ago"],
    [2 * 86400, "2 d ago"],
  ])("formats %i seconds as %s", (delta, text) => {
    expect(ago(1_000_000 - delta, 1_000_000)).toBe(text);
  });
});

describe("InlineStatus.provideCodeLenses", () => {
  const doc = (text: string) => ({ getText: () => text }) as never;
  const now = Date.now() / 1000;
  const pending = stack({
    state: "UNCONFIRMED",
    needsApproval: true,
    stateSetBy: "b1",
    blocker: { id: "b1", state: "UNCONFIRMED", canConfirm: true, needsApproval: false },
  });
  const client = {
    request: vi.fn(async (query: string) =>
      query.includes("history")
        ? { stack: { run: { id: "b1", triggeredBy: "carol", history: [{ state: "UNCONFIRMED", username: null, timestamp: now - 300 }] } } }
        : { stacks: [pending] },
    ),
  };

  it("summarises the matched stack and points the action buttons at the blocking run", async () => {
    const lenses = await new InlineStatus(client, () => true).provideCodeLenses(doc(tf));
    const iam = lenses.filter((l: any) => l.range.startLine === 2).map((l: any) => l.command);

    expect(iam[0].title).toBe("$(warning) Needs attention · 5 min ago · triggered by carol");
    expect(iam[0].command).toBe("spacelift.openRun");
    expect(iam[0].arguments).toEqual([{ kind: "run", stack: "iam", run: { id: "b1" } }]);
    expect(iam.slice(1).map((c: any) => [c.title, c.arguments])).toEqual([
      ["$(check) Approve", ["confirm", "iam", "b1", "saiva-dev/shared/saiva-iam-users"]],
      ["$(trash) Discard", ["discard", "iam", "b1", "saiva-dev/shared/saiva-iam-users"]],
    ]);
  });

  it.each([
    [25, "no stack with this name"],
    [17, "stack name is computed"],
  ])("explains why the block on line %i has no status (%s) instead of guessing", async (line, text) => {
    const lenses = await new InlineStatus(client, () => true).provideCodeLenses(doc(tf));

    expect((lenses.find((l: any) => l.range.startLine === line) as any).command.title).toContain(text);
  });

  it("asks the API once per refresh, not on every edit, and refetches after refresh", async () => {
    const counting = { request: vi.fn(client.request) };
    const status = new InlineStatus(counting, () => true);
    const stackRequests = () => counting.request.mock.calls.filter(([q]) => !q.includes("history")).length;

    await status.provideCodeLenses(doc(tf));
    await status.provideCodeLenses(doc(tf));
    expect(stackRequests()).toBe(1);

    status.refresh();
    await status.provideCodeLenses(doc(tf));
    expect(stackRequests()).toBe(2);
  });

  it("stays quiet when the API fails and recovers on the next attempt instead of caching the failure", async () => {
    const flaky = { request: vi.fn(client.request).mockRejectedValueOnce(new Error("HTTP 502")) };
    const status = new InlineStatus(flaky, () => true);

    expect(await status.provideCodeLenses(doc(tf))).toEqual([]);
    const lenses = await status.provideCodeLenses(doc(tf));
    expect((lenses[0] as any).command.title).toContain("Needs attention");
  });

  it("still shows the stack status when the run details cannot be loaded", async () => {
    const noRun = { request: vi.fn(async (q: string) => (q.includes("history") ? Promise.reject(new Error("boom")) : { stacks: [pending] })) };
    const lenses = await new InlineStatus(noRun, () => true).provideCodeLenses(doc(tf));
    const first = (lenses.find((l: any) => l.range.startLine === 2) as any).command;

    expect(first.title).toMatch(/^\$\(warning\) Needs attention/);
    expect(first.title).not.toContain("triggered by");
  });

  it("shows the hover only on a matched resource line and lets it run only the extension's own commands", async () => {
    const status = new InlineStatus(client, () => true);

    const hover = (await status.provideHover(doc(tf), { line: 2 } as never)) as any;

    expect(hover.contents.value).toContain("Needs attention");
    expect(hover.contents.isTrusted).toEqual({ enabledCommands: ["spacelift.openRun", "spacelift.inlineAction"] });
    expect(await status.provideHover(doc(tf), { line: 3 } as never)).toBeUndefined();
    expect(await status.provideHover(doc(tf), { line: 25 } as never)).toBeUndefined();
  });

  it("shows nothing when the setting is off", async () => {
    expect(await new InlineStatus(client, () => false).provideCodeLenses(doc(tf))).toEqual([]);
  });
});

describe("hoverMarkdown", () => {
  const pending = stack({ state: "UNCONFIRMED", needsApproval: true, blocker: { id: "b1", state: "UNCONFIRMED", canConfirm: true, needsApproval: false } });
  const run = {
    id: "b1",
    title: "Add IAM user",
    branch: "main",
    triggeredBy: "carol",
    commit: { hash: "abcdef1234", authorName: "carol", message: "feat: add user", url: "https://github.com/acme/infra/commit/abcdef1234" },
    delta: { addCount: 2, changeCount: 1, deleteCount: 0 },
    history: [
      { state: "QUEUED", username: null, timestamp: 900 },
      { state: "UNCONFIRMED", username: null, timestamp: 940 },
    ],
  };
  const link = (command: string, args: unknown[]) => `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;

  it("renders status, run, changes, history and action links for the blocking run", () => {
    const md = hoverMarkdown({ stack: pending, run }, 1000);

    expect(md).toContain("Needs attention");
    expect(md).toContain("+2 ~1 -0");
    expect(md).toContain("`saiva-dev/shared/saiva-iam-users`");
    expect(md.indexOf("Unconfirmed")).toBeLessThan(md.indexOf("Queued"));
    expect(md).toContain(`(${link("spacelift.inlineAction", ["confirm", "iam", "b1", pending.name])})`);
    expect(md).toContain(`(${link("spacelift.openRun", [{ kind: "run", stack: "iam", run: { id: "b1" } }])})`);
  });

  it("does not repeat a commit message equal to the run title and spells out an empty plan", () => {
    const merge = { ...run, title: "Merge pull request #1", commit: { ...run.commit, message: "Merge pull request #1\n\nbody" }, delta: { addCount: 0, changeCount: 0, deleteCount: 0 } };
    const md = hoverMarkdown({ stack: stack(), run: merge }, 1000);

    expect(md.split("\n").find((l) => l.includes("$(git-commit)"))).not.toContain("Merge");
    expect(md).toContain("no resource changes");
  });

  it("escapes repository text so a commit message cannot inject an approve link", () => {
    const evil = "[click me](command:spacelift.inlineAction?%5B%22confirm%22%5D) <img src=x>";
    const md = hoverMarkdown({ stack: stack(), run: { ...run, title: evil, commit: { ...run.commit, message: evil } } }, 1000);

    expect(md).not.toContain("[click me](");
    expect(md).not.toContain("<img");
  });
});

describe("tooltipText", () => {
  it("summarises stack, status, run, commit and changes as plain text for the CodeLens tooltip", () => {
    const run = {
      id: "b1",
      title: "Add IAM user",
      branch: "main",
      triggeredBy: "carol",
      commit: { hash: "abcdef1234", authorName: "carol", message: "x", url: "https://example.com" },
      delta: { addCount: 2, changeCount: 1, deleteCount: 0 },
      history: [{ state: "UNCONFIRMED", username: null, timestamp: 700 }],
    };
    const text = tooltipText({ stack: stack({ state: "UNCONFIRMED" }), run }, 1000);

    expect(text.split("\n").slice(0, 5)).toEqual([
      "saiva-dev/shared/saiva-iam-users",
      "Needs attention · 5 min ago · triggered by carol",
      "",
      "Add IAM user on main",
      "abcdef1 carol · +2 ~1 -0",
    ]);
  });
});
