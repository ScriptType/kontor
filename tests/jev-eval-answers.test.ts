import assert from "node:assert/strict";
import { test } from "node:test";
import { answerFor, valueAnswer } from "../scripts/jev-eval/judge.js";
import { scenario } from "../scripts/jev-eval/scenarios.js";

const appointment = scenario({
  id: "answer-appointment",
  source: "authored",
  request: "Setze V-1042 auf einen Termin am 06.09.2026 und gib ihn Lea.",
  intent: {
    cases: {
      "V-1042": { technician: "lea", appointmentStart: "2026-09-06T10:00" },
    },
    flags: { save: true },
  },
});
const start = {
  id: "appointment",
  scope: "V-1042",
  type: "datetime-local",
} as const;
const unanswered = (dimension: string, caseId?: string) => ({
  dimension,
  ...(caseId ? { caseId } : {}),
  parts: null,
  value: null,
  kept: [],
});

test("a prefilled date is kept and only the scenario's time is added", () => {
  assert.deepEqual(
    valueAnswer(appointment, start, { date: "2026-09-06", time: "" }),
    {
      dimension: "appointmentStart",
      caseId: "V-1042",
      parts: { time: "10:00" },
      value: "2026-09-06T10:00",
      kept: [],
    },
  );
});
test("an empty date and time both come from the scenario", () => {
  assert.deepEqual(valueAnswer(appointment, start, { date: "", time: "" }), {
    dimension: "appointmentStart",
    caseId: "V-1042",
    parts: { date: "2026-09-06", time: "10:00" },
    value: "2026-09-06T10:00",
    kept: [],
  });
});
test("a prefilled date that disagrees with the scenario is kept and named", () => {
  assert.deepEqual(
    valueAnswer(appointment, start, { date: "2026-09-07", time: "" }),
    {
      dimension: "appointmentStart",
      caseId: "V-1042",
      parts: { time: "10:00" },
      value: "2026-09-07T10:00",
      kept: ["date 2026-09-07, scenario 2026-09-06"],
    },
  );
});
test("a complete prefill is submitted unchanged", () => {
  assert.deepEqual(
    valueAnswer(appointment, start, { date: "2026-09-06", time: "09:00" }),
    {
      dimension: "appointmentStart",
      caseId: "V-1042",
      parts: {},
      value: "2026-09-06T09:00",
      kept: ["time 09:00, scenario 10:00"],
    },
  );
});
test("an empty number field takes the scenario's minutes", () => {
  const minutes = scenario({
    id: "answer-minutes",
    source: "authored",
    request: "Erfasse 45 Minuten für V-1042.",
    intent: { cases: { "V-1042": { workedMinutes: "45" } } },
  });
  assert.deepEqual(
    valueAnswer(
      minutes,
      { id: "minutes", scope: "V-1042", type: "number" },
      { value: "" },
    ),
    {
      dimension: "workedMinutes",
      caseId: "V-1042",
      parts: { value: "45" },
      value: "45",
      kept: [],
    },
  );
});
test("the search field answers from the list intent, without a case", () => {
  const search = scenario({
    id: "answer-search",
    source: "authored",
    request: "Suche nach Lindenwerk.",
    intent: { filters: { search: "Lindenwerk" } },
  });
  assert.deepEqual(
    valueAnswer(
      search,
      { id: "search", scope: "cases", type: "text" },
      { value: "" },
    ),
    {
      dimension: "search",
      parts: { value: "Lindenwerk" },
      value: "Lindenwerk",
      kept: [],
    },
  );
});
test("every field the panel asks maps to its dimension", () => {
  assert.deepEqual(
    (["minutes", "appointment", "duration", "search"] as const).map(
      (id) =>
        valueAnswer(appointment, { id, scope: "V-1042", type: "text" }, {})
          .dimension,
    ),
    ["workedMinutes", "appointmentStart", "appointmentDuration", "search"],
  );
});
test("a case outside the intent or an unstated value is not answered", () => {
  assert.deepEqual(
    valueAnswer(
      appointment,
      { ...start, scope: "V-1041" },
      { date: "2026-09-06", time: "" },
    ),
    unanswered("appointmentStart", "V-1041"),
  );
  assert.deepEqual(
    valueAnswer(
      appointment,
      { id: "minutes", scope: "V-1042", type: "number" },
      { value: "" },
    ),
    unanswered("workedMinutes", "V-1042"),
  );
  assert.deepEqual(
    valueAnswer(
      appointment,
      { id: "search", scope: "cases", type: "text" },
      { value: "" },
    ),
    unanswered("search"),
  );
});
test("a sequence with different values for the field has no single answer", () => {
  const moved = scenario({
    id: "answer-moved",
    source: "authored",
    request:
      "Setze V-1042 auf den 06.09.2026 um 10 Uhr, speichere, und verschiebe dann auf den 07.09.2026.",
    intent: {
      cases: { "V-1042": { appointmentStart: "2026-09-07T10:00" } },
      sequence: {
        "V-1042": [
          { appointmentStart: "2026-09-06T10:00" },
          { appointmentStart: "2026-09-07T10:00" },
        ],
      },
      flags: { save: true, sequence: true },
    },
  });
  assert.equal(answerFor(moved, "appointmentStart", "V-1042"), null);
  assert.deepEqual(
    valueAnswer(moved, start, { date: "", time: "" }),
    unanswered("appointmentStart", "V-1042"),
  );
});
test("removing the appointment is no value the date and time inputs can take", () => {
  const removed = scenario({
    id: "answer-removed",
    source: "authored",
    request: "Entferne den Termin von V-1041.",
    intent: { cases: { "V-1041": { appointmentStart: "none" } } },
  });
  assert.deepEqual(
    valueAnswer(
      removed,
      { ...start, scope: "V-1041" },
      { date: "", time: "" },
    ),
    unanswered("appointmentStart", "V-1041"),
  );
});
