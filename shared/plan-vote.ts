import type { DecisionInput } from "./command.js";
import {
  dimensions,
  effectKey,
  filterValue,
  withCaseValue,
  type CaseDimensionId,
  type DimensionId,
  type ListDimensionId,
} from "./dimensions.js";
import type { CaseDraft, CaseFilters, Page, Workspace } from "./domain.js";
import {
  caseDimensions,
  endMismatches,
  expectEnd,
  listDimensions,
  type CaseValues,
  type ExpectedEnd,
  type Intent,
} from "./intent.js";
import { ASK, planVisits, type Plan } from "./plan.js";

/** The plan of a run and the screen it was read on. */
export type RunPlan = {
  plan: Plan;
  start: { workspace: Workspace; page: Page; filters: CaseFilters };
};
/** The run as the plan compares it; drafts and records in editableSchema key order. */
export type PlanWorld = {
  page: Page;
  filters: CaseFilters;
  /** The selected case, whether or not its detail is on screen. */
  selected: string | null;
  draft: CaseDraft | null;
  dirty: boolean;
  /** Saved records by case id. */
  records: Record<string, CaseDraft>;
  /** Saves of this run, in order. */
  receipts: { caseId: string; saved: CaseDraft }[];
  /** The page after each step of this run. */
  visited: Page[];
  answers: DecisionInput["answers"];
};

type Answers = DecisionInput["answers"];
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The literal field a user answer fills for this dimension. */
function fieldOf(id: DimensionId) {
  const entry = dimensions.find((candidate) => candidate.id === id);
  return entry && "controls" in entry
    ? (entry.controls as { field?: string }).field
    : undefined;
}
function answered(answers: Answers, id: DimensionId, scope: string) {
  const field = fieldOf(id);
  return answers
    .filter((answer) => answer.fieldId === field && answer.scope === scope)
    .at(-1)?.value;
}

/** The plan as an intent, each ASK filled by the run's answer; null while one stays open. */
export function planIntent(plan: Plan, answers: Answers): Intent | null {
  let open = false;
  const resolve = (id: DimensionId, scope: string, value: string) => {
    if (value !== ASK) return value;
    const answer = answered(answers, id, scope);
    if (answer === undefined) open = true;
    return answer ?? value;
  };
  const fill = (caseId: string, values: CaseValues): CaseValues =>
    Object.fromEntries(
      caseDimensions.flatMap((id) => {
        const value = values[id];
        return value === undefined ? [] : [[id, resolve(id, caseId, value)]];
      }),
    );
  const cases = Object.fromEntries(
    Object.entries(plan.cases).map(([id, values]) => [id, fill(id, values)]),
  );
  const sequence = Object.fromEntries(
    Object.entries(plan.sequence).map(([id, steps]) => [
      id,
      steps.map((values) => fill(id, values)),
    ]),
  );
  const filters: Intent["filters"] = Object.fromEntries(
    listDimensions.flatMap((id) => {
      const value = plan.filters[id];
      return value === undefined ? [] : [[id, resolve(id, "cases", value)]];
    }),
  );
  if (open) return null;
  const changes = Object.values(cases).some(
    (values) => Object.keys(values).length,
  );
  return {
    cases,
    sequence,
    filters,
    pages: planVisits(plan),
    flags: {
      save: changes && !plan.flags.noSave,
      noSave: plan.flags.noSave,
      unsupported: plan.flags.unsupported,
      sequence: Object.keys(sequence).length > 0 || plan.visits.length > 1,
    },
  };
}

/** Where the plan ends from the run's start; null while an ASK stays open or the plan does not fit the start. */
export function expectedEnd(
  run: RunPlan,
  answers: Answers,
): ExpectedEnd | null {
  const intent = planIntent(run.plan, answers);
  if (!intent) return null;
  try {
    return expectEnd(run.start.workspace, run.start.filters, intent);
  } catch {
    return null;
  }
}

function endErrors(run: RunPlan, expected: ExpectedEnd, world: PlanWorld) {
  const { mismatches, unexpectedSaves } = endMismatches(
    expected,
    {
      page: world.page,
      filters: world.filters,
      records: world.records,
      receipts: world.receipts,
      draft:
        world.selected && world.draft
          ? { caseId: world.selected, values: world.draft, dirty: world.dirty }
          : null,
      pagesVisited: world.visited,
    },
    run.start.page,
  );
  return [...mismatches, ...unexpectedSaves];
}

/** Whether the run stands where the plan ends, with nothing left to hand off. */
export function reached(run: RunPlan, world: PlanWorld) {
  const expected = expectedEnd(run, world.answers);
  return (
    expected !== null &&
    expected.handoff === null &&
    !endErrors(run, expected, world).length
  );
}

/** A case dimension's value on a draft, as the plan writes it. */
function caseValue(draft: CaseDraft, id: CaseDimensionId): string {
  switch (id) {
    case "technician":
      return draft.technicianId;
    case "workedMinutes":
      return String(draft.minutes);
    case "appointmentStart":
      return draft.appointment ? draft.appointment.start.slice(0, 16) : "none";
    case "appointmentDuration":
      return draft.appointment ? String(draft.appointment.minutes) : "";
    case "status":
      return draft.status;
    case "priority":
      return draft.priority;
  }
}
const isCaseDimension = (id: string): id is CaseDimensionId =>
  (caseDimensions as string[]).includes(id);
const isListDimension = (id: string): id is ListDimensionId =>
  (listDimensions as string[]).includes(id);

/** The next save the plan expects on this case, or its unsaved draft. */
function caseTarget(
  expected: ExpectedEnd,
  world: PlanWorld,
  caseId: string,
): CaseDraft | undefined {
  const k = world.receipts.filter((r) => r.caseId === caseId).length;
  return (
    expected.saves[caseId]?.[k] ??
    (expected.draft?.caseId === caseId ? expected.draft.values : undefined)
  );
}

/** The first planned view the run has not shown yet, walking its views in order. */
function nextVisit(run: RunPlan, world: PlanWorld): Page | undefined {
  const planned = planVisits(run.plan);
  let index = 0;
  for (const page of [run.start.page, ...world.visited])
    if (page === planned[index]) index++;
  return planned[index];
}

/** The plan slot a choice agrees with, or null. */
export function stepVote(
  run: RunPlan,
  choice: string,
  input: Pick<DecisionInput, "actions" | "context">,
  world: PlanWorld,
): string | null {
  const { plan } = run;
  const expected = expectedEnd(run, world.answers);
  if (choice === "done") return reached(run, world) ? "done" : null;
  if (choice === "blocked")
    return expected &&
      expected.handoff !== null &&
      !endErrors(run, expected, world).length
      ? "blocked"
      : null;
  if (choice.startsWith("ask:")) {
    const field = choice.slice("ask:".length);
    const id = dimensions.find((entry) => fieldOf(entry.id) === field)?.id;
    if (id === undefined) return null;
    if (isListDimension(id))
      return plan.filters[id] === ASK &&
        answered(world.answers, id, "cases") === undefined
        ? `ask:${id}`
        : null;
    const caseId = world.selected;
    if (!isCaseDimension(id) || caseId === null) return null;
    const planned = [plan.cases[caseId], ...(plan.sequence[caseId] ?? [])];
    return planned.some((values) => values?.[id] === ASK) &&
      answered(world.answers, id, caseId) === undefined
      ? `ask:${caseId}.${id}`
      : null;
  }
  const kind = input.actions.find((action) => action.id === choice)?.kind;
  if (kind === undefined || kind === "discard") return null;
  if (kind === "commit") {
    const caseId = world.selected;
    // A no-save plan expects no saves, so its drafts never match one.
    if (!expected || !caseId || !world.draft) return null;
    const k = world.receipts.filter((r) => r.caseId === caseId).length;
    return world.dirty && same(world.draft, expected.saves[caseId]?.[k])
      ? `save:${caseId}#${k}`
      : null;
  }
  let changes: unknown;
  try {
    changes = JSON.parse(effectKey(choice, input));
  } catch {
    return null;
  }
  if (!Array.isArray(changes) || !changes.length) return null;
  const slots: string[] = [];
  for (const change of changes) {
    const slot =
      typeof change === "string"
        ? changeSlot(run, expected, world, change)
        : null;
    if (slot === null) return null;
    slots.push(slot);
  }
  return slots.join(" + ");
}

/** The slot one change of an action agrees with, or null. */
function changeSlot(
  run: RunPlan,
  expected: ExpectedEnd | null,
  world: PlanWorld,
  change: string,
): string | null {
  const at = change.indexOf("=");
  const [key, value] = [change.slice(0, at), change.slice(at + 1)];
  if (key === "cases")
    return Object.hasOwn(run.plan.cases, value) ? change : null;
  if (key === "page") {
    const next = nextVisit(run, world);
    return value === next ||
      (next === undefined && expected !== null && value === expected.page)
      ? change
      : null;
  }
  if (isListDimension(key))
    return expected && filterValue(key, expected.filters) === value
      ? change
      : null;
  const caseId = world.selected;
  const draft = world.draft;
  const target =
    expected && caseId ? caseTarget(expected, world, caseId) : undefined;
  if (isCaseDimension(key)) {
    const next = draft && withCaseValue(key, draft, value);
    return draft &&
      next &&
      target &&
      caseValue(next, key) === caseValue(target, key) &&
      caseValue(draft, key) !== caseValue(target, key)
      ? `${caseId}.${change}`
      : null;
  }
  if (key !== "menu") return null;
  const id = dimensions.find(
    (entry) =>
      "controls" in entry &&
      (entry.controls as { menu?: string }).menu === value,
  )?.id;
  if (id === undefined) return null;
  if (isListDimension(id))
    return expected &&
      filterValue(id, expected.filters) !== filterValue(id, world.filters)
      ? change
      : null;
  return isCaseDimension(id) &&
    draft &&
    target &&
    caseValue(draft, id) !== caseValue(target, id)
    ? `${change}@${caseId}`
    : null;
}

/**
 * The option of a decision the plan agrees with that Jev gives the highest
 * probability: an offered action, done or blocked, never a question or
 * abstain. Ties keep the offered order; null when the plan agrees with none.
 */
export function planOption(
  run: RunPlan,
  probabilities: Record<string, number>,
  input: Pick<DecisionInput, "actions" | "context">,
  world: PlanWorld,
): { choice: string; probability: number; slot: string } | null {
  let best: { choice: string; probability: number; slot: string } | null = null;
  for (const choice of [
    ...input.actions.map((action) => action.id),
    "done",
    "blocked",
  ]) {
    const probability = probabilities[choice];
    if (probability === undefined || (best && probability <= best.probability))
      continue;
    const slot = stepVote(run, choice, input, world);
    if (slot) best = { choice, probability, slot };
  }
  return best;
}
