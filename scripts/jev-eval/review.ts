import type { ObservedEnd } from "../../shared/intent.js";
import { labelState } from "../jev-format/bench.js";
import { judge } from "./judge.js";
import type { Scenario } from "./scenarios.js";

const exits = new Set(["done", "blocked", "abstain"]);

/**
 * The review or approval option a person who knows the scenario clicks, or why
 * they click none. `offered` are the visible option ids in display order;
 * `prefix` are the actions the run executed; `steps` is the human path.
 */
export function reviewChoice(input: {
  scenario: Scenario;
  observed: ObservedEnd;
  offered: string[];
  prefix: string[];
  steps: string[] | undefined;
}): { option: string } | { option: null; reason: string } {
  const { scenario, observed, offered, prefix, steps } = input;
  const handoff = scenario.expected.handoff !== null;
  const reasons: string[] = [];
  for (const end of ["done", "blocked"] as const) {
    if (!offered.includes(end)) continue;
    if (handoff !== (end === "blocked")) {
      reasons.push(
        `${end}: ${handoff ? "handoff expected" : "no handoff expected"}`,
      );
      continue;
    }
    const verdict = judge(scenario, {
      ...observed,
      stops: [{ kind: end, message: "" }],
    });
    if (verdict.endCorrect) return { option: end };
    reasons.push(
      `${end}: ${[...verdict.mismatches, ...verdict.unexpectedSaves].join(", ")}`,
    );
  }
  const actions = offered.filter((option) => !exits.has(option));
  if (!actions.length) return { option: null, reason: reasons.join("; ") };
  if (!steps)
    return {
      option: null,
      reason: [...reasons, "no human steps"].join("; "),
    };
  const labels = labelState({
    prefix,
    replay: steps,
    handoff,
    pages: scenario.intent.pages,
    options: offered,
  });
  if (!labels) {
    const at = prefix.findIndex((step, i) => step !== steps[i]);
    return {
      option: null,
      reason: [
        ...reasons,
        `run left the human path at step ${at + 1}: ${prefix[at]}, human ${steps[at] ?? "had ended"}`,
      ].join("; "),
    };
  }
  const safe = actions.find((option) => labels.safe.includes(option));
  if (safe) return { option: safe };
  return {
    option: null,
    reason: [
      ...reasons,
      `${actions.join(", ")} not safe, human next ${labels.next}`,
    ].join("; "),
  };
}
