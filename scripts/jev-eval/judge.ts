import { UNSTATED, dimensions } from "../../shared/dimensions.js";
import type { CaseDraft, CaseFilters, Page } from "../../shared/domain.js";
import type { Scenario } from "./scenarios.js";

export type Stop = {
  kind:
    | "done"
    | "input"
    | "review"
    | "approval"
    | "blocked"
    | "confirm"
    | "unanswerable"
    | "error"
    | "timeout";
  message: string;
  dimension?: string;
  caseId?: string;
  value?: string | string[];
};
const questionKinds = new Set<Stop["kind"]>([
  "input",
  "review",
  "approval",
  "blocked",
  "confirm",
  "unanswerable",
]);
export type Observed = {
  page: Page;
  filters: CaseFilters;
  records: Record<string, CaseDraft>;
  receipts: { caseId: string; saved: CaseDraft }[];
  draft: { caseId: string; values: CaseDraft; dirty: boolean } | null;
  pagesVisited: Page[];
  stops: Stop[];
};
export type Outcome =
  | "magic"
  | "correct-after-questions"
  | "asked-wrong"
  | "silent-wrong"
  | "error";
export type Verdict = {
  outcome: Outcome;
  endCorrect: boolean;
  questions: number;
  mismatches: string[];
  unexpectedSaves: string[];
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function differences(actual: CaseDraft, expected: CaseDraft) {
  return (Object.keys(expected) as (keyof CaseDraft)[])
    .filter((key) => !same(actual[key], expected[key]))
    .map(
      (key) =>
        `${key} ${JSON.stringify(actual[key])}, expected ${JSON.stringify(expected[key])}`,
    );
}
function inOrder<T>(wanted: T[], seen: T[]) {
  let index = 0;
  for (const item of seen) if (same(item, wanted[index])) index++;
  return index === wanted.length;
}

export function judge(scenario: Scenario, observed: Observed): Verdict {
  const { expected } = scenario;
  const mismatches: string[] = [];
  const unexpectedSaves: string[] = [];
  if (expected.page !== null && observed.page !== expected.page)
    mismatches.push(`page ${observed.page}, expected ${expected.page}`);
  for (const key of Object.keys(expected.filters) as (keyof CaseFilters)[])
    if (observed.filters[key] !== expected.filters[key])
      mismatches.push(
        `filter ${key} ${JSON.stringify(observed.filters[key])}, expected ${JSON.stringify(expected.filters[key])}`,
      );
  for (const [caseId, record] of Object.entries(expected.records)) {
    const actual = observed.records[caseId];
    if (!actual) mismatches.push(`${caseId} missing`);
    else
      for (const difference of differences(actual, record))
        mismatches.push(`${caseId} saved ${difference}`);
  }
  const receiptCases = new Set(observed.receipts.map((r) => r.caseId));
  for (const caseId of receiptCases) {
    const saved = observed.receipts
      .filter((r) => r.caseId === caseId)
      .map((r) => r.saved);
    const wanted = expected.saves[caseId];
    if (!wanted) unexpectedSaves.push(`${caseId} saved ${saved.length}x`);
    else if (!inOrder(wanted, saved))
      mismatches.push(`${caseId} saves miss an expected intermediate state`);
  }
  for (const caseId of Object.keys(expected.saves))
    if (!receiptCases.has(caseId)) mismatches.push(`${caseId} was not saved`);
  const draft = observed.draft?.dirty ? observed.draft : null;
  if (expected.draft) {
    if (!draft || draft.caseId !== expected.draft.caseId)
      mismatches.push(`expected an unsaved draft on ${expected.draft.caseId}`);
    else
      for (const difference of differences(draft.values, expected.draft.values))
        mismatches.push(`${draft.caseId} draft ${difference}`);
  } else if (draft) mismatches.push(`unsaved draft left on ${draft.caseId}`);
  if (
    expected.pageOrder.length &&
    !inOrder(expected.pageOrder, [
      scenario.start.page,
      ...observed.pagesVisited,
    ])
  )
    mismatches.push(
      `views not shown in order ${expected.pageOrder.join(" > ")}`,
    );
  const final = observed.stops.at(-1);
  if (expected.handoff && final?.kind === "done")
    mismatches.push(
      `reported done although the request needs a handoff (${expected.handoff})`,
    );
  const endCorrect = !mismatches.length && !unexpectedSaves.length;
  const handoff =
    endCorrect && expected.handoff !== null && final?.kind === "blocked"
      ? 1
      : 0;
  const questions =
    observed.stops.filter((stop) => questionKinds.has(stop.kind)).length -
    handoff;
  const outcome: Outcome = observed.stops.some(
    (stop) => stop.kind === "error" || stop.kind === "timeout",
  )
    ? "error"
    : endCorrect
      ? questions
        ? "correct-after-questions"
        : "magic"
      : questions
        ? "asked-wrong"
        : "silent-wrong";
  return { outcome, endCorrect, questions, mismatches, unexpectedSaves };
}

export function answerFor(
  scenario: Scenario,
  dimensionId: string,
  caseId?: string,
): string | string[] | null {
  const { intent } = scenario;
  const entry = dimensions.find((candidate) => candidate.id === dimensionId);
  if (!entry) return null;
  if (entry.kind === "flag") return intent.flags[entry.id] ? "yes" : "no";
  if (entry.kind === "set") return Object.keys(intent.cases);
  if (entry.scope === "view") return intent.pages.at(-1) ?? UNSTATED;
  if (entry.scope === "list") return intent.filters[entry.id] ?? UNSTATED;
  if (caseId) return intent.cases[caseId]?.[entry.id] ?? UNSTATED;
  const values = new Set(
    Object.values(intent.cases).flatMap((values) => {
      const value = values[entry.id];
      return value === undefined ? [] : [value];
    }),
  );
  return values.size > 1 ? null : ([...values][0] ?? UNSTATED);
}
