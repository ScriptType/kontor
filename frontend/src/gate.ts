import type { Decision, DecisionInput } from "../../shared/command.js";

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
