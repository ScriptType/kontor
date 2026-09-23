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
import { createCatalog } from "../scripts/jev-format/catalog.js";

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

test("the catalog rebuilds a field value and a picker case no recording offered", () => {
  const minutes = (scope: string, current: string) => ({
    id: "minutes",
    scope,
    label: `${scope} · Arbeitszeit in Minuten`,
    kind: "draft" as const,
    type: "number" as const,
    current,
    min: 0,
    max: 10000,
  });
  const setMinutes = (scope: string, value: number) =>
    `Set worked minutes (time actually spent on the case, Arbeitszeit) of case ${scope} to ${value}. Now: current value 0 → ${value}. Value source: literal number from the request`;
  const openCase = (id: string, title: string) =>
    `Open case ${id} "${title}" in the detail view; works even when the list filter hides it; does not change filters. Now: the case list filters hide it; status open, assignee Jonas Weber, worked 0 min, appointment none, priority Hoch`;
  const minutesTail =
    ". Changes only the unsaved draft; nothing is saved until save. Not for: the planned length of an appointment (that is the appointment duration field)";
  const openTail =
    ". Goes to the case list page and shows its editor; the list filters stay as they are; view only; changes no case data. Not for: filtering the case list to this case";
  const state = (
    observedSteps: unknown[],
    availableFields: unknown[],
    selected?: string,
  ) =>
    JSON.stringify({
      originalRequest: "Trag 45 Minuten ein.",
      explicitAnswers: [],
      currentFacts: {
        currentPage: "cases",
        ...(selected ? { selected: { id: selected } } : {}),
      },
      observedSteps,
      availableFields,
      blockedControls: [],
    });
  const call = (
    question: "next" | "assessment",
    sent: string,
    criteria: Record<string, string>,
  ) => ({
    question,
    payload: {
      request: {
        state: sent,
        questions: {
          [question]: { type: "choice", instructions: "Choose", criteria },
        },
        model: "jev",
      },
      answers: {},
      usage: null,
    },
  });
  const firstOptions = {
    "field:minutes:45": setMinutes("V-1041", 45),
    "open-case:V-1041": openCase("V-1041", "Zugang für Einkauf einrichten"),
  };
  const catalog = createCatalog();
  catalog.learn(
    callLogEntrySchema.array().parse([
      call("next", state([], [minutes("V-1041", "0")]), firstOptions),
      call(
        "assessment",
        JSON.stringify({
          availableActions: [
            {
              id: "field:minutes:45",
              label: "V-1041 · Arbeitszeit in Minuten auf 45 setzen",
              effect: setMinutes("V-1041", 45) + minutesTail,
              kind: "draft",
            },
          ],
        }),
        { authorized: "The step is authorized" },
      ),
      call(
        "next",
        state(
          [
            {
              action: {
                id: "open-case:V-1041",
                label: "V-1041 öffnen",
                effect: firstOptions["open-case:V-1041"] + openTail,
                kind: "view",
              },
              authorizedBy: "request",
              outcome: "changed",
              before: observation("cases"),
              after: observation("cases"),
            },
          ],
          [minutes("V-1041", "0")],
          "V-1041",
        ),
        { done: "Done" },
      ),
    ]),
  );
  const options = {
    "field:minutes:34": setMinutes("V-1042", 34),
    "open-case:V-1039": openCase("V-1039", "Wartung Standort Süd"),
    done: "Done",
  };
  assert.deepEqual(
    catalog.rebuild(
      fullStateSchema.parse(
        JSON.parse(state([], [minutes("V-1042", "0")], "V-1042")),
      ),
      options,
    ),
    [
      {
        id: "field:minutes:34",
        label: "V-1042 · Arbeitszeit in Minuten auf 34 setzen",
        effect: options["field:minutes:34"] + minutesTail,
        kind: "draft",
      },
      {
        id: "open-case:V-1039",
        label: "V-1039 öffnen",
        effect: options["open-case:V-1039"] + openTail,
        kind: "view",
      },
    ],
  );
});
