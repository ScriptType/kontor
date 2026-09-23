import {
  dimensions,
  withCaseValue,
  withFilterValue,
  type CaseDimensionId,
  type FlagDimensionId,
  type ListDimensionId,
} from "./dimensions.js";
import {
  blockers,
  draftOf,
  type CaseDraft,
  type CaseFilters,
  type Page,
  type Workspace,
} from "./domain.js";

export type CaseValues = Partial<Record<CaseDimensionId, string>>;
export type Intent = {
  cases: Record<string, CaseValues>;
  sequence: Record<string, CaseValues[]>;
  filters: Partial<Record<ListDimensionId, string>>;
  pages: Page[];
  flags: Record<FlagDimensionId, boolean>;
};
export type ExpectedEnd = {
  page: Page | null;
  pageOrder: Page[];
  filters: CaseFilters;
  records: Record<string, CaseDraft>;
  saves: Record<string, CaseDraft[]>;
  draft: { caseId: string; values: CaseDraft } | null;
  handoff: "unsupported" | "blocked" | null;
};
/** The end state a run left behind, as the judge compares it with an ExpectedEnd. */
export type ObservedEnd = {
  page: Page;
  filters: CaseFilters;
  records: Record<string, CaseDraft>;
  receipts: { caseId: string; saved: CaseDraft }[];
  draft: { caseId: string; values: CaseDraft; dirty: boolean } | null;
  pagesVisited: Page[];
};

export const caseDimensions = dimensions.flatMap((entry) =>
  "scope" in entry && entry.scope === "case" ? [entry.id] : [],
);
export const listDimensions = dimensions.flatMap((entry) =>
  "scope" in entry && entry.scope === "list" ? [entry.id] : [],
);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function applyValues(draft: CaseDraft, values: CaseValues) {
  let result: CaseDraft | null = draft;
  for (const id of caseDimensions) {
    const value = values[id];
    if (value !== undefined && result)
      result = withCaseValue(id, result, value);
  }
  return result;
}
export function blockedOn(
  workspace: Workspace,
  caseId: string,
  draft: CaseDraft,
) {
  const record = workspace.cases.find((c) => c.id === caseId);
  return !record || blockers(workspace, { ...record, ...draft }).length > 0;
}

export function expectEnd(
  workspace: Workspace,
  startFilters: CaseFilters,
  intent: Intent,
): ExpectedEnd {
  const records = Object.fromEntries(
    workspace.cases.map((c) => [c.id, draftOf(c)]),
  );
  const saves: Record<string, CaseDraft[]> = {};
  let draft: ExpectedEnd["draft"] = null;
  let blocked = false;
  let caseWork = false;
  for (const [caseId, values] of Object.entries(intent.cases)) {
    const current = records[caseId];
    if (!current) throw new Error(`Unknown case ${caseId}`);
    if (!Object.keys(values).length) caseWork = true;
    const states: CaseDraft[] = [];
    let reachable = true;
    for (const step of intent.sequence[caseId] ?? [values]) {
      const next = applyValues(states.at(-1) ?? current, step);
      if (!next || blockedOn(workspace, caseId, next)) {
        reachable = false;
        break;
      }
      states.push(next);
    }
    const target = states.at(-1);
    if (!reachable) {
      blocked = true;
      caseWork = true;
      continue;
    }
    if (!target || states.every((state) => same(state, current))) continue;
    caseWork = true;
    if (intent.flags.noSave) draft = { caseId, values: target };
    else {
      records[caseId] = target;
      saves[caseId] = states;
    }
  }
  let filters = startFilters;
  for (const id of listDimensions) {
    const value = intent.filters[id];
    const next =
      value === undefined ? filters : withFilterValue(id, filters, value);
    if (!next) throw new Error(`Filter value ${id}=${value} is not writable`);
    filters = next;
  }
  const page =
    intent.pages.at(-1) ??
    (Object.keys(intent.filters).length || caseWork ? "cases" : null);
  return {
    page,
    pageOrder: intent.pages.length > 1 ? intent.pages : [],
    filters,
    records,
    saves,
    draft,
    handoff: intent.flags.unsupported
      ? "unsupported"
      : blocked
        ? "blocked"
        : null,
  };
}

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

/** How an observed end differs from the expected one, apart from its handoff. */
export function endMismatches(
  expected: ExpectedEnd,
  observed: ObservedEnd,
  startPage: Page,
) {
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
    !inOrder(expected.pageOrder, [startPage, ...observed.pagesVisited])
  )
    mismatches.push(
      `views not shown in order ${expected.pageOrder.join(" > ")}`,
    );
  return { mismatches, unexpectedSaves };
}
