export interface Stack {
  id: string;
  name: string;
  state: string;
  needsApproval: boolean;
  stateSetAt: number | null;
  spaceDetails: { name: string };
}

export type SortMode = "name" | "attention" | "recent";

export function filterStacks(stacks: Stack[], text: string): Stack[] {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return stacks;
  return stacks.filter((s) => {
    const haystack = `${s.name} ${s.state} ${s.spaceDetails.name} ${s.needsApproval ? "needs-approval" : ""}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

const attentionRank = (s: Stack) => (s.needsApproval ? 0 : s.state === "FAILED" ? 1 : 2);

export function sortStacks(stacks: Stack[], mode: SortMode): Stack[] {
  const byName = (a: Stack, b: Stack) => a.name.localeCompare(b.name);
  const compare: Record<SortMode, (a: Stack, b: Stack) => number> = {
    name: byName,
    attention: (a, b) => attentionRank(a) - attentionRank(b) || byName(a, b),
    recent: (a, b) => (b.stateSetAt ?? 0) - (a.stateSetAt ?? 0) || byName(a, b),
  };
  return [...stacks].sort(compare[mode]);
}
