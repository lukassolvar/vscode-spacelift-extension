export interface Run {
  id: string;
  title: string;
  state: string;
  type: string;
  createdAt: number;
  canConfirm: boolean;
  needsApproval: boolean;
}

export type RunAction = "confirm" | "discard" | "approve" | "reject";

export function availableActions(run: Pick<Run, "state" | "canConfirm" | "needsApproval">) {
  const review = run.needsApproval || run.state === "PENDING_REVIEW";
  return {
    review,
    confirm: run.canConfirm && !review,
    discard: run.state === "UNCONFIRMED",
  };
}

const awaitsReview = (run: Run) => run.needsApproval || run.state === "PENDING_REVIEW";

export function mergeRuns(tracked: Run[], proposed: Run[]): Run[] {
  return [...tracked, ...proposed.filter(awaitsReview)].sort((a, b) => b.createdAt - a.createdAt);
}
