import type { ActionDescription, DecisionInput } from "./command.js";
import { actionEffects } from "./dimensions.js";
import { requestClauses } from "./field-values.js";
import { changesData, observedChanges } from "./step-log.js";

type Step = DecisionInput["steps"][number];
export type GuardStop = "repeat" | "revisit" | "budget";

/** Steps a run may take: 8, plus 4 per clause of the request, at most 24. */
export function stepBudget(request: string) {
  return Math.min(24, 8 + 4 * requestClauses(request).length);
}

/**
 * Why a guarded run must stop before this action: it already ran twice
 * without change, it would enter a page a third time since the last data
 * change, or the run used its step budget.
 */
export function guardStop(
  run: { request: string; steps: Step[] },
  action: Pick<ActionDescription, "id">,
  currentPage: string,
): GuardStop | null {
  if (run.steps.length >= stepBudget(run.request)) return "budget";
  if (
    run.steps.filter(
      (step) => step.action.id === action.id && step.outcome === "unchanged",
    ).length >= 2
  )
    return "repeat";
  const target = actionEffects(action.id)?.find(
    (effect) => effect.dimension === "page",
  )?.value;
  if (!target || target === currentPage) return null;
  const changes = run.steps.map((step) =>
    observedChanges(step.before, step.after),
  );
  const since = changes.map(changesData).lastIndexOf(true) + 1;
  const entries = changes
    .slice(since)
    .filter((change) =>
      change.some(({ path, to }) => path === "page" && to === target),
    ).length;
  return entries >= 2 ? "revisit" : null;
}
