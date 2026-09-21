import assert from "node:assert/strict";
import { test } from "node:test";
import { UNSTATED } from "../shared/dimensions.js";
import {
  answerFor,
  judge,
  type Observed,
  type Stop,
} from "../scripts/jev-eval/judge.js";
import { summarize, type SampleResult } from "../scripts/jev-eval/report.js";
import {
  generateScenarios,
  regressionScenarios,
  type Scenario,
} from "../scripts/jev-eval/scenarios.js";

const byId = (id: string) => {
  const found = [
    ...regressionScenarios(),
    ...generateScenarios(880001, 30),
  ].find((s) => s.id === id);
  assert(found, id);
  return found;
};
function asExpected(s: Scenario, stops: Stop[]): Observed {
  return {
    page: s.expected.page ?? s.start.page,
    filters: s.expected.filters,
    records: s.expected.records,
    receipts: Object.entries(s.expected.saves).flatMap(([caseId, states]) =>
      states.map((saved) => ({ caseId, saved })),
    ),
    draft: s.expected.draft && { ...s.expected.draft, dirty: true },
    pagesVisited: s.expected.pageOrder,
    stops,
  };
}
const done: Stop = {
  kind: "done",
  message: "Jev meldet den Auftrag als erledigt",
};
const review: Stop = { kind: "review", message: "Vorschläge prüfen" };
const blocked: Stop = { kind: "blocked", message: "Auftrag teilweise" };

test("the expected end state without a question is magic", () => {
  const s = byId("user-fresh");
  assert.deepEqual(judge(s, asExpected(s, [done])), {
    outcome: "magic",
    endCorrect: true,
    questions: 0,
    mismatches: [],
    unexpectedSaves: [],
  });
});
test("a wrong saved value without a question is silent-wrong and names the field", () => {
  const s = byId("user-fresh");
  const observed = asExpected(s, [done]);
  const record = observed.records["V-1041"];
  assert(record);
  observed.records = {
    ...observed.records,
    "V-1041": { ...record, minutes: 1041 },
  };
  const verdict = judge(s, observed);
  assert.equal(verdict.outcome, "silent-wrong");
  assert.deepEqual(verdict.mismatches, [
    "V-1041 saved minutes 1041, expected 60",
  ]);
});
test("a save over already matching values is an unexpected save", () => {
  const s = byId("user-repeat");
  const observed = asExpected(s, [done]);
  const record = observed.records["V-1041"];
  assert(record);
  observed.receipts = [{ caseId: "V-1041", saved: record }];
  const verdict = judge(s, observed);
  assert.equal(verdict.outcome, "silent-wrong");
  assert.deepEqual(verdict.unexpectedSaves, ["V-1041 saved 1x"]);
});
test("questions separate correct-after-questions from asked-but-wrong", () => {
  const s = byId("use-09");
  assert.equal(
    judge(s, asExpected(s, [review])).outcome,
    "correct-after-questions",
  );
  const observed = { ...asExpected(s, [review]), page: "cases" as const };
  const verdict = judge(s, observed);
  assert.equal(verdict.outcome, "asked-wrong");
  assert.equal(verdict.questions, 1);
});
test("a final blocked handoff after the reachable work is not a question, done is wrong", () => {
  const s = byId("use-15");
  const handed = judge(s, asExpected(s, [blocked]));
  assert.equal(handed.outcome, "magic");
  assert.equal(handed.questions, 0);
  const claimed = judge(s, asExpected(s, [done]));
  assert.equal(claimed.outcome, "silent-wrong");
  assert.match(claimed.mismatches.join(), /reported done/);
  const early = { ...asExpected(s, [blocked]), receipts: [] };
  assert.equal(judge(s, early).outcome, "asked-wrong");
});
test("ordered intermediate states are checked, not only the end", () => {
  const sequence = byId("use-11");
  const observed = asExpected(sequence, [done]);
  observed.receipts = observed.receipts.slice(1);
  assert.match(
    judge(sequence, observed).mismatches.join(),
    /intermediate state/,
  );
  const views = byId("use-02");
  assert.equal(judge(views, asExpected(views, [done])).outcome, "magic");
  const reordered: Observed = {
    ...asExpected(views, [done]),
    pagesVisited: ["reports", "customers", "team"],
  };
  assert.match(judge(views, reordered).mismatches.join(), /not shown in order/);
});
test("an expected draft must be unsaved and exact, an unexpected one is wrong", () => {
  const s = byId("use-10");
  assert.equal(judge(s, asExpected(s, [done])).outcome, "magic");
  assert.match(
    judge(s, { ...asExpected(s, [done]), draft: null }).mismatches.join(),
    /expected an unsaved draft on V-1042/,
  );
  const saved = byId("use-05");
  const record = saved.expected.records["V-1041"];
  assert(record);
  assert.match(
    judge(saved, {
      ...asExpected(saved, [done]),
      draft: { caseId: "V-1041", values: record, dirty: true },
    }).mismatches.join(),
    /unsaved draft left on V-1041/,
  );
});
test("a provider or harness failure is an error, not a verdict on Jev", () => {
  const s = byId("use-01");
  assert.equal(
    judge(
      s,
      asExpected(s, [{ kind: "error", message: "Jev ist nicht erreichbar." }]),
    ).outcome,
    "error",
  );
});
test("the simulated user answers from the scenario's ground truth", () => {
  const fresh = byId("user-fresh");
  assert.equal(answerFor(fresh, "technician", "V-1041"), "mara");
  assert.equal(answerFor(fresh, "technician"), "mara");
  assert.equal(answerFor(fresh, "workedMinutes", "V-1041"), "60");
  assert.equal(answerFor(fresh, "priority", "V-1041"), UNSTATED);
  assert.equal(answerFor(fresh, "customerFilter"), "nord");
  assert.equal(answerFor(fresh, "search"), UNSTATED);
  assert.equal(answerFor(fresh, "page"), "reports");
  assert.deepEqual(answerFor(fresh, "cases"), ["V-1041"]);
  assert.equal(answerFor(fresh, "save"), "yes");
  assert.equal(answerFor(fresh, "noSave"), "no");
  assert.equal(answerFor(fresh, "bogus"), null);
  assert.equal(answerFor(byId("use-13"), "workedMinutes", "V-1042"), "30");
  const twoPeople = regressionScenarios()[0];
  assert(twoPeople);
  assert.equal(
    answerFor(
      {
        ...twoPeople,
        intent: {
          ...twoPeople.intent,
          cases: {
            "V-1042": { technician: "lea" },
            "V-1041": { technician: "jonas" },
          },
        },
      },
      "technician",
    ),
    null,
  );
});
test("the summary counts outcomes, questions, calls and wall time per sample", () => {
  const sample = (
    outcome: SampleResult["outcome"],
    questions: number,
    calls: number,
  ): SampleResult => ({
    outcome,
    endCorrect: outcome === "magic" || outcome === "correct-after-questions",
    questions,
    mismatches: [],
    unexpectedSaves: [],
    variant: "test",
    scenarioId: "x",
    source: "generated",
    sample: 1,
    request: "",
    stops: [],
    steps: [],
    unmappedActions: [],
    calls,
    wallMs: calls * 1000,
    error: null,
  });
  const summary = summarize([
    sample("magic", 0, 4),
    sample("silent-wrong", 0, 6),
    sample("correct-after-questions", 2, 8),
    sample("asked-wrong", 1, 2),
  ]);
  assert.deepEqual(
    {
      magic: summary.magic,
      silentWrong: summary.silentWrong,
      correctAfterQuestions: summary.correctAfterQuestions,
      askedWrong: summary.askedWrong,
      questionsMean: summary.questionsMean,
      withQuestions: summary.withQuestions,
      callsMean: summary.callsMean,
      callsTotal: summary.callsTotal,
      wallMeanMs: summary.wallMeanMs,
    },
    {
      magic: 1,
      silentWrong: 1,
      correctAfterQuestions: 1,
      askedWrong: 1,
      questionsMean: 0.75,
      withQuestions: 2,
      callsMean: 5,
      callsTotal: 20,
      wallMeanMs: 5000,
    },
  );
});
