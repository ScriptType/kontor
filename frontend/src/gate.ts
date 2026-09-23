import type {
  Assessment,
  Decision,
  DecisionInput,
} from "../../shared/command.js";
import { effectKey, noChangeKey } from "../../shared/dimensions.js";

/**
 * A draft is a field candidate; set is a button with a fixed effect; bound is
 * a field candidate the request ties to that one field.
 */
export type GateKind =
  | "view"
  | "set"
  | "draft"
  | "bound"
  | "commit"
  | "terminal"
  | "ask";
type BarKind = Exclude<GateKind, "ask">;
/**
 * What a pick is read against: the choice confidence, the top option
 * probability, or the summed probability of the options with the top effect,
 * which must also lead the next effect by margin.
 */
type Read =
  | { read: "confidence" | "pmax" }
  | { read: "pooled"; margin: number };
export type GatePolicy = Read & {
  /** Bar per kind of choice; "percent" uses the configured threshold for every kind. */
  bars: "percent" | Record<BarKind, number>;
  /** Kinds of action that pay the separate effect check before they run. */
  assessed: readonly GateKind[];
  /** Whether Jev may choose done before any step ran. */
  doneBeforeFirstStep: boolean;
  /**
   * Where Jev gets the lean state (a compact step log) instead of snapshots:
   * nowhere, only for decide, or also for the effect and completion checks.
   * Any lean state also drops options that change nothing.
   */
  memory: "off" | "decide" | "all";
  /** Stop loops, repeated page visits and runs over their step budget. */
  guard: boolean;
  completion: "verdict" | "perKind";
  /** How the full state and the options are written for Jev. */
  prompt: DecisionInput["prompt"];
  /**
   * Checks below their bar that the plan read at run start may release when
   * it agrees with the exact choice: the step pick, the completion check on
   * done, or the effect check of the picked action.
   */
  planVote: readonly PlanVia[];
};
export type PlanVia = "pick" | "completion" | "effect";

// Bars fitted on holdout-1 by the Jev bench (bench/gate-table.json).
const g1Bars = {
  view: 0.7,
  set: 0.85,
  draft: 0.85,
  bound: 0.85,
  commit: 0.75,
  terminal: 0.65,
} as const satisfies Record<BarKind, number>;
const effectBars = { ...g1Bars, view: 0.3, bound: 0.7 } as const;
// Views and drafts are cheap to take back; the guard, not the bar, stops loops.
const exploreBars = {
  ...g1Bars,
  view: 0,
  set: 0.6,
  draft: 0.6,
  bound: 0.6,
} as const;
const g3Bars = { ...exploreBars, view: 0.3 } as const;

export const gates = {
  threshold: {
    read: "confidence",
    bars: "percent",
    assessed: ["set", "draft", "bound", "commit"],
    doneBeforeFirstStep: true,
    memory: "off",
    guard: false,
    completion: "verdict",
    prompt: "full",
    planVote: [],
  },
  g1: {
    read: "pmax",
    bars: g1Bars,
    assessed: ["set", "draft", "bound", "commit"],
    doneBeforeFirstStep: true,
    memory: "off",
    guard: false,
    completion: "perKind",
    prompt: "full",
    planVote: [],
  },
  "g2-effect": {
    read: "pmax",
    bars: effectBars,
    assessed: ["set", "draft", "commit"],
    doneBeforeFirstStep: true,
    memory: "off",
    guard: false,
    completion: "perKind",
    prompt: "full",
    planVote: [],
  },
  "g2-exits": {
    read: "pmax",
    bars: g1Bars,
    assessed: ["set", "draft", "bound", "commit"],
    doneBeforeFirstStep: false,
    memory: "off",
    guard: false,
    completion: "perKind",
    prompt: "full",
    planVote: [],
  },
  "g2-pool": {
    read: "pooled",
    margin: 0.1,
    bars: g1Bars,
    assessed: ["set", "draft", "bound", "commit"],
    doneBeforeFirstStep: true,
    memory: "off",
    guard: false,
    completion: "perKind",
    prompt: "full",
    planVote: [],
  },
  g2: {
    read: "pooled",
    margin: 0.1,
    bars: effectBars,
    assessed: ["set", "draft", "commit"],
    doneBeforeFirstStep: false,
    memory: "off",
    guard: false,
    completion: "perKind",
    prompt: "full",
    planVote: [],
  },
  "explore-nomem": {
    read: "pmax",
    bars: exploreBars,
    assessed: ["commit"],
    doneBeforeFirstStep: false,
    memory: "off",
    guard: true,
    completion: "perKind",
    prompt: "full",
    planVote: [],
  },
  explore: {
    read: "pmax",
    bars: exploreBars,
    assessed: ["commit"],
    doneBeforeFirstStep: false,
    memory: "all",
    guard: true,
    completion: "perKind",
    prompt: "full",
    planVote: [],
  },
  g3: {
    read: "pooled",
    margin: 0.1,
    bars: g3Bars,
    assessed: ["draft", "commit"],
    doneBeforeFirstStep: false,
    memory: "off",
    guard: true,
    completion: "perKind",
    prompt: "full",
    planVote: [],
  },
  "g3-focused": {
    read: "pooled",
    margin: 0.1,
    bars: g3Bars,
    assessed: ["draft", "commit"],
    doneBeforeFirstStep: false,
    memory: "off",
    guard: true,
    completion: "perKind",
    prompt: "focused",
    planVote: [],
  },
  "g3-compact": {
    read: "pooled",
    margin: 0.1,
    bars: g3Bars,
    assessed: ["draft", "commit"],
    doneBeforeFirstStep: false,
    memory: "off",
    guard: true,
    completion: "perKind",
    prompt: "compact",
    planVote: [],
  },
  "g3-mem": {
    read: "pooled",
    margin: 0.1,
    bars: g3Bars,
    assessed: ["draft", "commit"],
    doneBeforeFirstStep: false,
    memory: "decide",
    guard: true,
    completion: "perKind",
    prompt: "full",
    planVote: [],
  },
  "g3-compact-plan": {
    read: "pooled",
    margin: 0.1,
    bars: g3Bars,
    assessed: ["draft", "commit"],
    doneBeforeFirstStep: false,
    memory: "off",
    guard: true,
    completion: "perKind",
    prompt: "compact",
    planVote: ["pick", "completion"],
  },
  "g3-compact-plan-effect": {
    read: "pooled",
    margin: 0.1,
    bars: g3Bars,
    assessed: ["draft", "commit"],
    doneBeforeFirstStep: false,
    memory: "off",
    guard: true,
    completion: "perKind",
    prompt: "compact",
    planVote: ["pick", "completion", "effect"],
  },
} as const satisfies Record<string, GatePolicy>;
export type GateName = keyof typeof gates;
export const gateNames = Object.keys(gates) as GateName[];
/** The app's gate unless the browser stores another; won holdout-4. */
export const defaultGate: GateName = "g3-compact-plan-effect";
/** Browser key of the stored gate; v1 values are ignored so browsers move to the default. */
export const gatePreferenceKey = "kontor-jev-gate-v2";

export function gateKind(
  choice: string,
  input: Pick<DecisionInput, "actions">,
): GateKind {
  if (choice === "done" || choice === "blocked" || choice === "abstain")
    return "terminal";
  if (choice.startsWith("ask:")) return "ask";
  const action = input.actions.find((action) => action.id === choice);
  if (action === undefined || action.kind === "discard") return "commit";
  if (action.kind !== "draft") return action.kind;
  if (!action.value) return "set";
  return action.value.bound ? "bound" : "draft";
}

export function bar(gate: GateName, percent: number, kind: GateKind) {
  const { bars } = gates[gate];
  return kind === "ask" || bars === "percent" ? percent / 100 : bars[kind];
}

type UnpooledGate = {
  [Name in GateName]: (typeof gates)[Name]["read"] extends "pooled"
    ? never
    : Name;
}[GateName];

function reads(
  policy: Extract<GatePolicy, { read: "confidence" | "pmax" }>,
  decision: Pick<Decision, "confidence" | "ranked">,
) {
  return policy.read === "confidence"
    ? decision.confidence
    : (decision.ranked[0]?.probability ?? 0);
}

export function acts(
  gate: UnpooledGate,
  percent: number,
  decision: Pick<Decision, "confidence" | "ranked">,
  kind: GateKind,
) {
  return reads(gates[gate], decision) >= bar(gate, percent, kind);
}

export type GatePick = {
  choice: string;
  kind: GateKind;
  acts: boolean;
  /** The value read against the bar. */
  total: number;
  /** How far the pick leads the next option, or the next effect when pooled. */
  margin: number;
};

/** The choice the runner follows and whether it acts without review. */
export function pick(
  gate: GateName,
  percent: number,
  decision: Pick<
    Decision,
    "choice" | "confidence" | "ranked" | "probabilities"
  >,
  input: Pick<DecisionInput, "actions" | "context">,
): GatePick {
  const policy: GatePolicy = gates[gate];
  const [first, second] = decision.ranked;
  if (policy.read !== "pooled") {
    const kind = gateKind(decision.choice, input);
    const total = reads(policy, decision);
    return {
      choice: decision.choice,
      kind,
      acts: total >= bar(gate, percent, kind),
      total,
      margin: (first?.probability ?? 0) - (second?.probability ?? 0),
    };
  }
  const groups = new Map<
    string,
    { total: number; members: [string, number][] }
  >();
  for (const [option, probability] of Object.entries(decision.probabilities)) {
    const key = effectKey(option, input);
    const group = groups.get(key) ?? { total: 0, members: [] };
    group.total += probability;
    group.members.push([option, probability]);
    groups.set(key, group);
  }
  const [top, next] = [...groups].sort(([, a], [, b]) => b.total - a.total);
  if (!top) {
    const kind = gateKind(decision.choice, input);
    return { choice: decision.choice, kind, acts: false, total: 0, margin: 0 };
  }
  const [key, { total, members }] = top;
  const margin = total - (next?.[1].total ?? 0);
  const choice =
    key === noChangeKey && members.some(([option]) => option === "done")
      ? "done"
      : members.reduce((best, member) =>
          member[1] > best[1] ? member : best,
        )[0];
  const kind = gateKind(choice, input);
  return {
    choice,
    kind,
    acts: total >= bar(gate, percent, kind) && margin >= policy.margin,
    total,
    margin,
  };
}

/** Whether this gate runs the separate effect check for an action of this kind. */
export function assesses(gate: GateName, kind: GateKind) {
  return (gates[gate].assessed as readonly GateKind[]).includes(kind);
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
  switch (gates[gate].completion) {
    case "verdict":
      return (
        assessment.verdict === "complete" &&
        assessment.confidence >= percent / 100
      );
    case "perKind":
      return (assessment.probabilities.complete ?? 0) >= g1CompletionBars[kind];
  }
}
