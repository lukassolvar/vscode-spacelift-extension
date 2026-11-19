import { describe, expect, it } from "vitest";
import { changesHtml, emptyLogMessage, entryKey, needsLogFetch, formatDuration, headerHtml, stepHtml, type RunData, type StackData, type Transition } from "./runView";

const stack: StackData = { id: "s", name: "acme-dev/shared/x", spaceDetails: { name: "acme-dev" }, projectRoot: "tf/x", terraformVersion: "1.5.7" };
const run: RunData = {
  id: "r",
  title: "<img src=x onerror=alert(1)>",
  state: "UNCONFIRMED",
  type: "TRACKED",
  branch: "main",
  triggeredBy: "vcs/commit",
  createdAt: 1790000000,
  canConfirm: true,
  needsApproval: false,
  commit: { hash: "d2e6c30a2d61", authorName: "A", message: "m", url: "javascript:alert(1)", timestamp: 1790000000 },
  delta: { addCount: 1, changeCount: 2, deleteCount: 3 },
  history: [],
};

describe("headerHtml", () => {
  it("escapes untrusted run titles and refuses non-https commit links", () => {
    const html = headerHtml(stack, run);

    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("d2e6c30");
  });

  it("offers approve only when confirmable and discard only when unconfirmed", () => {
    expect(headerHtml(stack, run)).toContain('data-cmd="confirm"');
    expect(headerHtml(stack, run)).toContain('data-cmd="discard"');
    const finished = headerHtml(stack, { ...run, state: "FINISHED", canConfirm: false });
    expect(finished).not.toContain('data-cmd="confirm"');
    expect(finished).not.toContain('data-cmd="discard"');
  });
});

describe("headerHtml review actions", () => {
  it("offers approve and reject reviews instead of confirm for a run pending review", () => {
    const html = headerHtml(stack, { ...run, state: "PENDING_REVIEW", canConfirm: false, needsApproval: true });

    expect(html).toContain('data-cmd="approve"');
    expect(html).toContain('data-cmd="reject"');
    expect(html).not.toContain('data-cmd="confirm"');
    expect(html).not.toContain('data-cmd="discard"');
  });

  it("keeps discard available while an unconfirmed run waits for reviews", () => {
    const html = headerHtml(stack, { ...run, canConfirm: false, needsApproval: true });

    expect(html).toContain('data-cmd="approve"');
    expect(html).toContain('data-cmd="discard"');
    expect(html).not.toContain('data-cmd="confirm"');
  });
});

describe("stepHtml", () => {
  const planning: Transition = { state: "PLANNING", hasLogs: true, stateVersion: 4, timestamp: 100, until: 149, terminal: false };

  it("shows the phase duration and is selectable only when the phase has logs", () => {
    const html = stepHtml(planning, false, 200);
    expect(html).toContain("00:49");
    expect(html).toContain('data-cmd="select"');
    expect(html).toContain('data-value="PLANNING:4"');
    expect(stepHtml({ ...planning, hasLogs: false }, false, 200)).not.toContain("data-cmd");
  });

  it("marks the selected step and uses elapsed time for the phase in progress", () => {
    expect(stepHtml(planning, true, 200)).toContain("selected");
    const running = stepHtml({ ...planning, until: null }, false, 160);
    expect(running).toContain("01:00");
    expect(running).toContain("running");
  });

  it("flags failed phases", () => {
    expect(stepHtml({ ...planning, state: "FAILED", hasLogs: false, until: null, terminal: true }, false, 200)).toContain("failed");
  });
});

describe("needsLogFetch", () => {
  const phase: Transition = { state: "APPLYING", hasLogs: true, stateVersion: 8, timestamp: 1, until: 9, terminal: false };

  it("serves finished phases from cache but keeps refetching the phase in progress", () => {
    expect(needsLogFetch(phase, true)).toBe(false);
    expect(needsLogFetch(phase, false)).toBe(true);
    expect(needsLogFetch({ ...phase, until: null }, true)).toBe(true);
  });
});

describe("emptyLogMessage", () => {
  const day = 86400;

  it("explains retention when the run is older than the log retention period", () => {
    const message = emptyLogMessage(0, 60, 63 * day);
    expect(message).toContain("63 days old");
    expect(message).toContain("60 days");
  });

  it("gives a plain message for recent runs and when retention is unknown", () => {
    expect(emptyLogMessage(0, 60, 10 * day)).toBe("No log output for this phase.");
    expect(emptyLogMessage(0, null, 400 * day)).toBe("No log output for this phase.");
  });
});

describe("helpers", () => {
  it("formats durations as mm:ss", () => {
    expect(formatDuration(49)).toBe("00:49");
    expect(formatDuration(125)).toBe("02:05");
  });

  it("keys history entries by state and version", () => {
    expect(entryKey({ state: "PLANNING", stateVersion: 4, timestamp: 1 } as Transition)).toBe("PLANNING:4");
  });

  it("hides no-op resource changes and escapes addresses", () => {
    const html = changesHtml([
      { address: "aws_x.<b>", metadata: { type: "ADD" } },
      { address: "aws_noop.y", metadata: { type: "NOOP" } },
    ]);
    expect(html).toContain("aws_x.&lt;b&gt;");
    expect(html).not.toContain("aws_noop");
  });
});
