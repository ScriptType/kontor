import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeAnswer,
  fieldValues,
  localToday,
  partialAnswer,
  partialNotes,
} from "../shared/field-values.js";
import type { FieldDescription } from "../shared/command.js";

const appointment: FieldDescription = {
  id: "appointment",
  scope: "V-1042",
  label: "V-1042 · Termin",
  kind: "draft",
  type: "datetime-local",
  current: "",
  jev: { name: "appointment start date and time (Termin)" },
};
const minutes: FieldDescription = {
  ...appointment,
  id: "minutes",
  label: "V-1042 · Arbeitszeit",
  type: "number",
  min: 0,
  max: 10000,
  jev: { name: "worked minutes" },
};
const today = "2026-09-22";
const report =
  "Setze V-1042 auf einen am 06.09 und setzt wen anderes vom team dort ein als gerade gegeben der verfügbar ist";
const dateOf = (request: string) =>
  partialAnswer(appointment, request, today, []);
const parts = (request: string) => {
  const partial = dateOf(request);
  assert.equal(partial.type, "datetime-local");
  return partial.type === "datetime-local" ? partial : null;
};

test("the reported date without a time takes today's year and is flagged past", () => {
  assert.deepEqual(dateOf(report), {
    type: "datetime-local",
    date: { day: "2026-09-06", past: true },
    time: null,
  });
});
test("a future day with '10 Uhr' gives both parts and is not past", () => {
  assert.deepEqual(dateOf("Setze V-1042 am 30.09. um 10 Uhr"), {
    type: "datetime-local",
    date: { day: "2026-09-30", past: false },
    time: "10:00",
  });
});
test("every supported day form gives the same day, an explicit year stays", () => {
  for (const request of [
    "am 2026-09-06",
    "am 06.09.",
    "am 6.9.2026",
    "am 6.9.26",
  ])
    assert.equal(parts(request)?.date?.day, "2026-09-06", request);
  assert.deepEqual(dateOf("am 06.09.25"), {
    type: "datetime-local",
    date: { day: "2025-09-06", past: true },
    time: null,
  });
});
test("case ids, minutes, decimal hours and clock times give no day", () => {
  for (const request of [
    "Erfasse 45 Minuten für V-1042",
    "Arbeit 1.5 Stunden auf 1042",
    "Termin um 9.30 Uhr",
  ])
    assert.equal(parts(request)?.date, null, request);
});
test("clock times in each form, and none from minutes", () => {
  for (const [request, time] of [
    ["um 10:30", "10:30"],
    ["um 10 Uhr", "10:00"],
    ["gegen 9.30 Uhr", "09:30"],
    ["am 06.09 um 10", "10:00"],
    ["Erfasse 45 Minuten für V-1042", null],
  ] as const)
    assert.equal(parts(request)?.time, time, request);
});
test("two different days or times prefill neither, one day written twice still prefills", () => {
  const moved = dateOf(
    "Verschiebe V-1042 von 06.09 auf 08.09 um 10 oder 11 Uhr",
  );
  assert.deepEqual(moved, { type: "datetime-local", date: null, time: null });
  assert.equal(parts("am 06.09, also am 06.09.2026")?.date?.day, "2026-09-06");
});
test("an impossible calendar day is no day", () => {
  assert.deepEqual(dateOf("am 31.02."), {
    type: "datetime-local",
    date: null,
    time: null,
  });
});
test("a number field prefills only a single request value", () => {
  assert.deepEqual(
    partialAnswer(minutes, "Erfasse 45 Minuten für V-1042", today, []),
    {
      type: "number",
      value: "45",
    },
  );
  assert.deepEqual(
    partialAnswer(minutes, "Erfasse 45 oder 50 Minuten", today, []),
    {
      type: "number",
      value: null,
    },
  );
});
test("the prefill adds no field candidate", () => {
  assert.deepEqual(fieldValues(appointment, "am 06.09 um 10 Uhr", [], []), []);
});
test("today is the local day, not the UTC day", () => {
  const zone = process.env["TZ"];
  process.env["TZ"] = "Pacific/Kiritimati";
  try {
    assert.equal(localToday(new Date(2026, 8, 22, 0, 30)), "2026-09-22");
  } finally {
    if (zone === undefined) delete process.env["TZ"];
    else process.env["TZ"] = zone;
  }
});
test("the notes for the reported request say what is given and that the day is past", () => {
  assert.deepEqual(partialNotes(dateOf(report)), [
    "Datum aus dem Auftrag: 06.09.2026. Bitte die Uhrzeit ergänzen.",
    "06.09.2026 liegt in der Vergangenheit.",
  ]);
  assert.deepEqual(partialNotes(dateOf("am 30.09. um 10 Uhr")), [
    "Aus dem Auftrag: 30.09.2026, 10:00. Bitte prüfen.",
  ]);
  assert.deepEqual(partialNotes(dateOf("um 10 Uhr")), [
    "Uhrzeit aus dem Auftrag: 10:00. Bitte das Datum ergänzen.",
  ]);
  assert.deepEqual(partialNotes({ type: "number", value: "45" }), [
    "Aus dem Auftrag: 45. Bitte prüfen.",
  ]);
  assert.deepEqual(partialNotes(dateOf("Erfasse Arbeitszeit")), []);
});
test("an answer is composed only from complete, valid parts", () => {
  assert.equal(
    composeAnswer(appointment, { date: "2026-09-06", time: "10:00" }),
    "2026-09-06T10:00",
  );
  assert.equal(
    composeAnswer(appointment, { date: "2026-09-06", time: "" }),
    null,
  );
  assert.equal(composeAnswer(appointment, { date: "", time: "10:00" }), null);
  assert.equal(composeAnswer(minutes, { value: "47" }), "47");
  assert.equal(composeAnswer(minutes, { value: "-3" }), null);
});
