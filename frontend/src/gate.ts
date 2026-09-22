import type {
  Assessment,
  Decision,
  DecisionInput,
} from "../../shared/command.js";

export const gateNames = ["threshold", "g1"] as const;
export type GateName = (typeof gateNames)[number];
export type GateKind = "view" | "draft" | "commit" | "terminal" | "ask";

// Bars fitted on holdout-1 by the Jev bench (bench/gate-table.json); ask keeps
// the configured threshold.
const g1Bars = (percent: number): Record<GateKind, number> => ({
  view: 0.7,
  draft: 0.85,
  commit: 0.75,
  terminal: 0.65,
  ask: percent / 100,
});

export function gateKind(
  choice: string,
  input: Pick<DecisionInput, "actions">,
): GateKind {
  if (choice === "done" || choice === "blocked" || choice === "abstain")
    return "terminal";
  if (choice.startsWith("ask:")) return "ask";
  const kind = input.actions.find((action) => action.id === choice)?.kind;
  return kind === undefined || kind === "discard" ? "commit" : kind;
}

export function acts(
  gate: GateName,
  percent: number,
  decision: Pick<Decision, "confidence" | "ranked">,
  kind: GateKind,
) {
  switch (gate) {
    case "threshold":
      return decision.confidence >= percent / 100;
    case "g1":
      return (decision.ranked[0]?.probability ?? 0) >= g1Bars(percent)[kind];
  }
}

export type WorkKind = "view" | "draft" | "saved";

/** Saved once any step committed, else draft once any step drafted. */
export function workKind(
  steps: Pick<DecisionInput["steps"][number], "action">[],
): WorkKind {
  const kinds = new Set(steps.map((step) => step.action.kind));
  return kinds.has("commit") ? "saved" : kinds.has("draft") ? "draft" : "view";
}

// P(complete) bars per kind of work from the done bench (bench/done-results.md,
// lever c): stable when fitted on either holdout, no new wrong done act on both.
const g1CompletionBars: Record<WorkKind, number> = {
  view: 0.6,
  draft: 0.85,
  saved: 0.8,
};

/** Whether the completion check confirms done for a run with this kind of work. */
export function completes(
  gate: GateName,
  percent: number,
  assessment: Pick<Assessment, "verdict" | "confidence" | "probabilities">,
  kind: WorkKind,
) {
  switch (gate) {
    case "threshold":
      return (
        assessment.verdict === "complete" &&
        assessment.confidence >= percent / 100
      );
    case "g1":
      return (assessment.probabilities.complete ?? 0) >= g1CompletionBars[kind];
  }
}
