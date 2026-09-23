import type { CaseDraft, CaseFilters, Workspace } from "./domain.js";
import type { ExpectedEnd } from "./intent.js";
import { expectedEnd, type PlanWorld, type RunPlan } from "./plan-vote.js";
import type { RequestHints } from "./request-hints.js";

export const planReadingNote =
  "A machine reading of the request. It can be wrong; the request itself decides.";
/** What the plan read at run start says the run still has to do. */
export type PlanReading = NonNullable<RequestHints["planReading"]>;
export const nothingRemains = "nothing remains per the reading";

type Names = Pick<Workspace, "customers" | "technicians">;
type Change = { label: string; from: string; to: string };

const handoffs: Record<NonNullable<ExpectedEnd["handoff"]>, string> = {
  unsupported: "hand off: part of the request is outside the app",
  blocked: "hand off: part of the request is not allowed in the app",
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const nameOf = (entries: { id: string; name: string }[], id: string) =>
  entries.find((entry) => entry.id === id)?.name ?? id;

function caseField(key: keyof CaseDraft, draft: CaseDraft, names: Names) {
  switch (key) {
    case "technicianId":
      return {
        label: "assigned technician",
        value: nameOf(names.technicians, draft.technicianId),
      };
    case "minutes":
      return { label: "worked minutes", value: String(draft.minutes) };
    case "appointment":
      return {
        label: "appointment",
        value: draft.appointment
          ? `${draft.appointment.start.replace("T", " ")} for ${draft.appointment.minutes} min`
          : "none",
      };
    case "status":
      return { label: "status", value: draft.status };
    case "inspection":
      return {
        label: "inspection note",
        value: draft.inspection
          ? JSON.stringify(draft.inspection.note)
          : "none",
      };
    case "priority":
      return { label: "priority", value: draft.priority };
  }
}
function filterField(
  key: keyof CaseFilters,
  filters: CaseFilters,
  names: Names,
) {
  switch (key) {
    case "customerId":
      return {
        label: "customer",
        value:
          filters.customerId === null
            ? "all"
            : nameOf(names.customers, filters.customerId),
      };
    case "technicianId":
      return {
        label: "technician",
        value:
          filters.technicianId === null
            ? "all"
            : nameOf(names.technicians, filters.technicianId),
      };
    case "status":
      return { label: "status", value: filters.status };
    case "search":
      return {
        label: "search",
        value: filters.search === "" ? "empty" : JSON.stringify(filters.search),
      };
  }
}
function caseChanges(from: CaseDraft, to: CaseDraft, names: Names): Change[] {
  return (Object.keys(to) as (keyof CaseDraft)[])
    .filter((key) => !same(from[key], to[key]))
    .map((key) => ({
      label: caseField(key, to, names).label,
      from: caseField(key, from, names).value,
      to: caseField(key, to, names).value,
    }));
}
const becomes = (change: Change) =>
  `${change.label} should become ${change.to} (now ${change.from})`;

/**
 * What the plan says the run still has to do, in plain English; null while
 * the plan leaves a value to ask or does not fit the start. The list reads
 * exactly `nothingRemains` when the run stands where the plan ends.
 */
function stillOpen(run: RunPlan, world: PlanWorld): string[] | null {
  const expected = expectedEnd(run, world.answers);
  if (!expected) return null;
  const names = run.start.workspace;
  const items: string[] = [];
  for (const key of Object.keys(expected.filters) as (keyof CaseFilters)[])
    if (world.filters[key] !== expected.filters[key]) {
      const want = filterField(key, expected.filters, names);
      const now = filterField(key, world.filters, names);
      items.push(
        `list filter ${want.label} should be ${want.value} (now ${now.value})`,
      );
    }
  const current = (caseId: string) =>
    world.selected === caseId && world.draft
      ? world.draft
      : world.records[caseId];
  const dirtyCase = world.dirty && world.draft ? world.selected : null;
  const pending = new Set<string>();
  for (const [caseId, saves] of Object.entries(expected.saves)) {
    const k = world.receipts.filter((r) => r.caseId === caseId).length;
    const record = expected.records[caseId];
    const remaining =
      k < saves.length
        ? saves.slice(k)
        : record && !same(world.records[caseId], record)
          ? [record]
          : [];
    const [next, ...later] = remaining;
    const now = current(caseId);
    if (!next || !now) continue;
    pending.add(caseId);
    for (const change of caseChanges(now, next, names))
      items.push(`case ${caseId}: ${becomes(change)}`);
    items.push(`case ${caseId}: save the change`);
    later.forEach((state, i) =>
      items.push(
        `case ${caseId}: after that save, ${caseChanges(
          remaining[i]!,
          state,
          names,
        )
          .map((change) => `${change.label} should become ${change.to}`)
          .join(" and ")}, saved again`,
      ),
    );
  }
  const draft = expected.draft;
  const now = draft && current(draft.caseId);
  if (draft && now) {
    const changes = caseChanges(now, draft.values, names);
    if (changes.length || dirtyCase !== draft.caseId)
      items.push(
        ...changes.map((change) => `case ${draft.caseId}: ${becomes(change)}`),
        `case ${draft.caseId}: keep the change as an unsaved draft (do not save)`,
      );
  }
  if (dirtyCase && !pending.has(dirtyCase) && draft?.caseId !== dirtyCase)
    items.push(
      `case ${dirtyCase}: has unsaved changes the reading does not expect`,
    );
  for (const caseId of new Set(world.receipts.map((r) => r.caseId)))
    if (!expected.saves[caseId])
      items.push(`case ${caseId}: was saved, but the reading expects no save`);
  const order = expected.pageOrder;
  let shown = 0;
  for (const page of [run.start.page, ...world.visited])
    if (page === order[shown]) shown++;
  if (shown < order.length)
    items.push(
      `pages still to show in order: ${order.slice(shown).join(", ")}`,
    );
  if (expected.page !== null && world.page !== expected.page)
    items.push(`end on the ${expected.page} page`);
  if (expected.handoff) items.push(handoffs[expected.handoff]);
  return items.length ? items : [nothingRemains];
}

/** The plan's reading for Jev, or null when the plan cannot say what remains. */
export function planReading(
  run: RunPlan,
  world: PlanWorld,
): PlanReading | null {
  const open = stillOpen(run, world);
  return open && { note: planReadingNote, stillOpen: open };
}
