import type { FieldDescription } from "../../shared/command.js";
import {
  UNSTATED,
  actionEffects,
  dimensions,
} from "../../shared/dimensions.js";
import { endMismatches, type ObservedEnd } from "../../shared/intent.js";
import type { Scenario } from "./scenarios.js";

export type Stop = {
  kind:
    | "done"
    | "input"
    | "review"
    | "approval"
    | "blocked"
    | "confirm"
    | "answer"
    | "review-answer"
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
  "answer",
  "review-answer",
  "unanswerable",
]);
export type Observed = ObservedEnd & { stops: Stop[] };
export type Outcome =
  | "magic"
  | "handoff"
  | "correct-after-answers"
  | "stopped-unanswered"
  | "asked-wrong"
  | "silent-wrong"
  | "error";
export type Verdict = {
  outcome: Outcome;
  endCorrect: boolean;
  questions: number;
  magicSaveCheck: boolean;
  mismatches: string[];
  unexpectedSaves: string[];
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function judge(scenario: Scenario, observed: Observed): Verdict {
  const { expected } = scenario;
  const { mismatches, unexpectedSaves } = endMismatches(
    expected,
    observed,
    scenario.start.page,
  );
  const final = observed.stops.at(-1);
  if (expected.handoff && final?.kind === "done")
    mismatches.push(
      `reported done although the request needs a handoff (${expected.handoff})`,
    );
  const endCorrect = !mismatches.length && !unexpectedSaves.length;
  const handedOff =
    endCorrect && expected.handoff !== null && final?.kind === "blocked";
  const asked = observed.stops.filter((stop) => questionKinds.has(stop.kind));
  const questions = asked.length - (handedOff ? 1 : 0);
  const wroteWrong =
    unexpectedSaves.length > 0 ||
    observed.receipts.some(
      (receipt) =>
        !(expected.saves[receipt.caseId] ?? []).some((wanted) =>
          same(wanted, receipt.saved),
        ),
    );
  const unanswered =
    !handedOff &&
    !wroteWrong &&
    final !== undefined &&
    final.kind !== "confirm" &&
    final.kind !== "answer" &&
    final.kind !== "review-answer" &&
    questionKinds.has(final.kind);
  const outcome: Outcome = observed.stops.some(
    (stop) => stop.kind === "error" || stop.kind === "timeout",
  )
    ? "error"
    : unanswered
      ? "stopped-unanswered"
      : endCorrect
        ? handedOff
          ? "handoff"
          : questions
            ? "correct-after-answers"
            : "magic"
        : questions
          ? "asked-wrong"
          : "silent-wrong";
  const magicSaveCheck =
    outcome === "magic" ||
    (outcome === "correct-after-answers" &&
      asked.every((stop) => stop.dimension === "save"));
  return {
    outcome,
    endCorrect,
    questions,
    magicSaveCheck,
    mismatches,
    unexpectedSaves,
  };
}

export function answerFor(
  scenario: Scenario,
  dimensionId: string,
  caseId?: string,
): string | string[] | null {
  const { intent } = scenario;
  const entry = dimensions.find((candidate) => candidate.id === dimensionId);
  if (!entry) return null;
  if (entry.id === "save") {
    const saved = Object.keys(scenario.expected.saves);
    return (caseId ? saved.includes(caseId) : saved.length) ? "yes" : "no";
  }
  if (entry.kind === "flag") return intent.flags[entry.id] ? "yes" : "no";
  if (entry.kind === "set") return Object.keys(intent.cases);
  if (entry.scope === "view") return intent.pages.at(-1) ?? UNSTATED;
  if (entry.scope === "list") return intent.filters[entry.id] ?? UNSTATED;
  if (caseId) {
    const values = new Set(
      [
        intent.cases[caseId]?.[entry.id],
        ...(intent.sequence[caseId] ?? []).map((step) => step[entry.id]),
      ].filter((value) => value !== undefined),
    );
    return values.size > 1 ? null : ([...values][0] ?? UNSTATED);
  }
  const values = new Set(
    Object.values(intent.cases).flatMap((values) => {
      const value = values[entry.id];
      return value === undefined ? [] : [value];
    }),
  );
  return values.size > 1 ? null : ([...values][0] ?? UNSTATED);
}

/** The parts of the answer panel's inputs; an empty input is "". */
export type AnswerParts = { date?: string; time?: string; value?: string };
export type ValueAnswer = { dimension: string | null; caseId?: string } & (
  | { parts: null; value: null; kept: [] }
  | {
      /** The parts to type: only those that were empty. */
      parts: AnswerParts;
      value: string;
      /** Prefilled parts that differ from the scenario, kept as the panel showed them. */
      kept: string[];
    }
);
const inputValue: Record<FieldDescription["type"], RegExp> = {
  "datetime-local": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
  number: /^\d+$/,
  text: /./,
};
export function valueAnswer(
  scenario: Scenario,
  field: { id: string; scope: string; type: FieldDescription["type"] },
  prefill: AnswerParts,
): ValueAnswer {
  const dimension = actionEffects(`ask:${field.id}`)?.[0]?.dimension ?? null;
  const entry = dimensions.find((candidate) => candidate.id === dimension);
  const caseId =
    entry && "scope" in entry && entry.scope === "case"
      ? field.scope
      : undefined;
  const found = { dimension, ...(caseId ? { caseId } : {}) };
  const truth = dimension && answerFor(scenario, dimension, caseId);
  if (
    typeof truth !== "string" ||
    truth === UNSTATED ||
    !inputValue[field.type].test(truth)
  )
    return { ...found, parts: null, value: null, kept: [] };
  const wanted: AnswerParts =
    field.type === "datetime-local"
      ? { date: truth.slice(0, 10), time: truth.slice(11) }
      : { value: truth };
  const parts: AnswerParts = {};
  const submitted: AnswerParts = {};
  const kept: string[] = [];
  for (const part of ["date", "time", "value"] as const) {
    const want = wanted[part];
    if (want === undefined) continue;
    const given = prefill[part];
    if (!given) parts[part] = want;
    else if (given !== want) kept.push(`${part} ${given}, scenario ${want}`);
    submitted[part] = given || want;
  }
  return {
    ...found,
    parts,
    value:
      field.type === "datetime-local"
        ? `${submitted.date}T${submitted.time}`
        : (submitted.value ?? truth),
    kept,
  };
}
