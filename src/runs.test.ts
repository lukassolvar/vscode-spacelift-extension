import { describe, expect, it } from "vitest";
import { availableActions, mergeRuns, type Run } from "./runs";

const run = (extra: Partial<Run> = {}): Run => ({
  id: "r",
  title: "t",
  state: "FINISHED",
  type: "TRACKED",
  createdAt: 0,
  canConfirm: false,
  needsApproval: false,
  ...extra,
});

describe("availableActions", () => {
  it.each([
    ["a finished run", { state: "FINISHED" }, { review: false, confirm: false, discard: false }],
    ["an unconfirmed run that can be confirmed", { state: "UNCONFIRMED", canConfirm: true }, { review: false, confirm: true, discard: true }],
    ["an unconfirmed run still waiting on approval policy reviews", { state: "UNCONFIRMED", needsApproval: true }, { review: true, confirm: false, discard: true }],
    ["a proposed run pending review", { state: "PENDING_REVIEW", needsApproval: true }, { review: true, confirm: false, discard: false }],
    ["a pending review run even if needsApproval is false", { state: "PENDING_REVIEW" }, { review: true, confirm: false, discard: false }],
    ["a run that both needs approval and can be confirmed", { state: "UNCONFIRMED", canConfirm: true, needsApproval: true }, { review: true, confirm: false, discard: true }],
  ])("offers the right actions for %s", (_name, extra, expected) => {
    expect(availableActions(run(extra))).toEqual(expected);
  });
});

describe("mergeRuns", () => {
  it("adds only proposed runs that await review and sorts newest first", () => {
    const tracked = [run({ id: "t-old", createdAt: 10 }), run({ id: "t-new", createdAt: 30 })];
    const proposed = [
      run({ id: "p-done", type: "PROPOSED", createdAt: 40 }),
      run({ id: "p-review", type: "PROPOSED", state: "PENDING_REVIEW", createdAt: 20 }),
      run({ id: "p-needs", type: "PROPOSED", needsApproval: true, createdAt: 50 }),
    ];

    expect(mergeRuns(tracked, proposed).map((r) => r.id)).toEqual(["p-needs", "t-new", "p-review", "t-old"]);
  });
});
