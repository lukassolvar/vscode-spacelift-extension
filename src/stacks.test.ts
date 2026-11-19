import { describe, expect, it } from "vitest";
import { filterStacks, sortStacks, type Stack } from "./stacks";

const stack = (id: string, state: string, extra: Partial<Stack> = {}): Stack => ({
  id,
  name: `acme-prod/shared/${id}`,
  state,
  needsApproval: false,
  stateSetAt: 0,
  spaceDetails: { name: "acme-prod" },
  ...extra,
});

describe("filterStacks", () => {
  const stacks = [stack("waf", "FINISHED"), stack("api", "FAILED"), stack("dev-api", "FINISHED", { name: "acme-dev/shared/dev-api", spaceDetails: { name: "acme-dev" } })];

  it("matches case-insensitively on name, state and space", () => {
    expect(filterStacks(stacks, "WAF").map((s) => s.id)).toEqual(["waf"]);
    expect(filterStacks(stacks, "failed").map((s) => s.id)).toEqual(["api"]);
    expect(filterStacks(stacks, "acme-dev").map((s) => s.id)).toEqual(["dev-api"]);
  });

  it("requires every whitespace-separated term to match", () => {
    expect(filterStacks(stacks, "api prod").map((s) => s.id)).toEqual(["api"]);
  });

  it("returns everything for an empty filter", () => {
    expect(filterStacks(stacks, "  ")).toHaveLength(3);
  });
});

describe("sortStacks", () => {
  it("puts stacks needing approval, then failed, then the rest in attention mode", () => {
    const sorted = sortStacks(
      [stack("a", "FINISHED"), stack("b", "FAILED"), stack("c", "UNCONFIRMED", { needsApproval: true })],
      "attention",
    );
    expect(sorted.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("orders by most recent state change in recent mode", () => {
    const sorted = sortStacks([stack("old", "FINISHED", { stateSetAt: 1 }), stack("new", "FINISHED", { stateSetAt: 9 }), stack("none", "NONE", { stateSetAt: null })], "recent");
    expect(sorted.map((s) => s.id)).toEqual(["new", "old", "none"]);
  });
});
