import assert from "node:assert/strict";
import { test } from "node:test";
import { slimObservations } from "../shared/step-log.js";
import {
  actsAfterCheck,
  callLogEntrySchema,
  fullStateSchema,
  type BenchState,
  type FullState,
} from "../scripts/jev-format/bench.js";

const observation = (page: string) => ({
  page,
  revision: 1,
  filters: { customerId: null, technicianId: null, status: "all", search: "" },
});
const move = (from: string, to: string) => ({
  action: {
    id: `nav:${to}`,
    label: to,
    effect: `Open ${to}`,
    kind: "view" as const,
  },
  authorizedBy: "request" as const,
  outcome: "changed" as const,
  before: observation(from),
  after: observation(to),
});
const pingPong = [
  move("cases", "reports"),
  move("reports", "cases"),
  move("cases", "reports"),
  move("reports", "cases"),
];
const slim = slimObservations(
  pingPong.map(({ before, after }) => ({
    before: JSON.stringify(before),
    after: JSON.stringify(after),
  })),
);
const decideState = (observedSteps: unknown[]) => ({
  originalRequest: "Zeige Berichte.",
  explicitAnswers: [],
  currentFacts: { currentPage: "cases" },
  observedSteps,
  availableFields: [],
  blockedControls: [],
});
const fullSent = JSON.stringify(decideState(pingPong));
const slimSent = JSON.stringify(
  decideState(
    pingPong.map(({ action, authorizedBy, outcome }, i) => ({
      action,
      authorizedBy,
      outcome,
      ...slim[i],
    })),
  ),
);

test("the bench reads a decide state with the slim history as it was sent", () => {
  assert.equal(
    JSON.stringify(fullStateSchema.parse(JSON.parse(slimSent))),
    slimSent,
  );
});

test("the g3 run guard reads the slim history like the full one", () => {
  const acts = (sent: string, choice: string) => {
    const state: FullState = fullStateSchema.parse(JSON.parse(sent));
    const bench = {
      state,
      actions: [move("cases", "reports").action, move("cases", "team").action],
      workKind: "view",
    } as unknown as BenchState;
    return actsAfterCheck(
      bench,
      { choice, kind: "view", acts: true, total: 0.9, margin: 0.8 },
      null,
    );
  };
  for (const sent of [fullSent, slimSent]) {
    assert.equal(acts(sent, "nav:reports"), false, "a third visit stops");
    assert.equal(acts(sent, "nav:team"), true, "a first visit runs");
  }
});

test("a call the provider never answered is skipped, not read as a decision", () => {
  const request = {
    state: slimSent,
    questions: {
      next: {
        type: "choice",
        instructions: "Choose",
        criteria: { done: "Done" },
      },
    },
    model: "jev",
  };
  assert.deepEqual(
    callLogEntrySchema.parse({
      question: "next",
      payload: { request, answers: null, usage: null },
    }),
    { question: "next", unanswered: true, payload: undefined },
  );
  const answers = {
    next: { choice: "done", confidence: 0.9, probabilities: { done: 0.9 } },
  };
  assert.deepEqual(
    callLogEntrySchema.parse({
      question: "next",
      payload: { request, answers, usage: null },
    }),
    {
      question: "next",
      unanswered: false,
      payload: { request, answers, usage: null },
    },
  );
});
