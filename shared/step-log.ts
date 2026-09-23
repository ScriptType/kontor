import { z } from "zod";
import { jevText, type DecisionInput } from "./command.js";

type Step = DecisionInput["steps"][number];
export type Change = { path: string; from: unknown; to: unknown };

// Id lists grow with every save; only how many there are tells Jev something.
const counted = new Set(["operations", "receipts"]);

function flatten(value: unknown, path: string, into: Map<string, unknown>) {
  if (counted.has(path) && Array.isArray(value)) into.set(path, value.length);
  else if (value && typeof value === "object" && !Array.isArray(value))
    for (const [key, inner] of Object.entries(value))
      flatten(inner, path ? `${path}.${key}` : key, into);
  else into.set(path, value ?? null);
}

/** What differs between two observed states, as dotted paths. */
export function observedChanges(before: string, after: string): Change[] {
  const from = new Map<string, unknown>();
  const to = new Map<string, unknown>();
  flatten(JSON.parse(before), "", from);
  flatten(JSON.parse(after), "", to);
  return [...new Set([...from.keys(), ...to.keys()])].flatMap((path) => {
    const was = from.get(path) ?? null;
    const is = to.get(path) ?? null;
    return JSON.stringify(was) === JSON.stringify(is)
      ? []
      : [{ path, from: was, to: is }];
  });
}

const within = (path: string, root: string) =>
  path === root || path.startsWith(`${root}.`);
/** A change to the draft, the filters or saved data. */
export function changesData(changes: Change[]) {
  return changes.some(
    ({ path }) =>
      within(path, "draft") ||
      within(path, "filters") ||
      path === "revision" ||
      path === "receipts",
  );
}
const movesPage = (changes: Change[]) =>
  changes.some(({ path }) => path === "page");

export const visitedNote = "visited; nothing changed here";

/**
 * The lean history: each step with what it changed. A view step that entered
 * a page the run left again, with no data change until it left, is marked as
 * a visit that changed nothing.
 */
export function stepLog(steps: Step[]) {
  const changes = steps.map((step) => observedChanges(step.before, step.after));
  return steps.map((step, index) => {
    const own = changes[index] ?? [];
    const later = changes.slice(index + 1);
    const leaving = later.findIndex(movesPage);
    const visited =
      step.action.kind === "view" &&
      movesPage(own) &&
      leaving >= 0 &&
      ![own, ...later.slice(0, leaving)].some(changesData);
    return {
      action: jevText(step.action),
      kind: step.action.kind,
      authorizedBy: step.authorizedBy,
      outcome: step.outcome,
      changes: own,
      ...(visited ? { note: visitedNote } : {}),
    };
  });
}

const pageOf = (observed: string) =>
  z.object({ page: z.string() }).parse(JSON.parse(observed)).page;
/**
 * The pages a run has shown in order: the page it started on, then each page
 * a step landed on, with a page shown twice in a row listed once.
 */
export function pagesShown(
  steps: Pick<Step, "before" | "after">[],
  currentPage: string,
) {
  const [first] = steps;
  const pages = first
    ? [pageOf(first.before), ...steps.map((step) => pageOf(step.after))]
    : [currentPage];
  return pages.filter((page, index) => page !== pages[index - 1]);
}
