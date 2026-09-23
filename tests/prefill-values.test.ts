import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDescription } from "../shared/command.js";
import {
  describeSource,
  fieldValues,
  partialAnswer,
  partialNotes,
  requestNumbers,
} from "../shared/field-values.js";
import { requestHints } from "../shared/request-hints.js";

const ids = ["V-1041", "V-1042"];
const numberField = (id: "minutes" | "duration"): FieldDescription => ({
  id,
  scope: "V-1042",
  label: id,
  kind: "draft",
  type: "number",
  current: "",
  min: id === "duration" ? 15 : 0,
  max: id === "duration" ? 480 : 10000,
  jev: { name: id },
});
const appointment: FieldDescription = {
  id: "appointment",
  scope: "V-1042",
  label: "V-1042 · Termin",
  kind: "draft",
  type: "datetime-local",
  current: "",
  jev: { name: "appointment start date and time (Termin)" },
};
// The demo reference day, a Tuesday.
const today = "2026-09-22";
const prefill = (id: "minutes" | "duration", request: string) => {
  const partial = partialAnswer(numberField(id), request, today, ids);
  return partial.type === "datetime-local" ? undefined : partial.value;
};
const dateParts = (request: string) => {
  const partial = partialAnswer(appointment, request, today, ids);
  return partial.type === "datetime-local"
    ? [partial.date?.day ?? null, partial.time]
    : undefined;
};

// request, value and source span requestNumbers reads from a number word
const numberWords: [string, [string, string][]][] = [
  ["mach mal neunzig Minuten draus", [["90", "neunzig Minuten"]]],
  ["fünfundvierzig Minuten gearbeitet", [["45", "fünfundvierzig Minuten"]]],
  ["zwanzig min dran", [["20", "zwanzig min"]]],
  ["Dreißig Minuten", [["30", "Dreißig Minuten"]]],
  ["dreissig minuten", [["30", "dreissig minuten"]]],
  ["einundzwanzig Minuten", [["21", "einundzwanzig Minuten"]]],
  ["elf Minuten", [["11", "elf Minuten"]]],
  ["hundert Minuten", [["100", "hundert Minuten"]]],
  ["hundertzwanzig Minuten", [["120", "hundertzwanzig Minuten"]]],
  ["Termin auf neunzig", [["90", "neunzig"]]],
  ["fünf Minuten", [["5", "fünf Minuten"]]],
  ["fünf Stunden", [["300", "fünf Stunden"]]],
  ["zweieinhalb Stunden", [["150", "zweieinhalb Stunden"]]],
  ["anderthalb Std", [["90", "anderthalb Std"]]],
  ["eine halbe Stunde", [["30", "eine halbe Stunde"]]],
  ["ne dreiviertel Stunde", [["45", "dreiviertel Stunde"]]],
  ["eine Stunde", [["60", "eine Stunde"]]],
  ["zwei Stunden", [["120", "zwei Stunden"]]],
];
// requests whose number words are no quantity
const noQuantity = [
  "die zwei Fälle von Jonas",
  "ein Termin für Lea",
  "um zehn Uhr",
  "gegen elf Uhr",
  "halb elf",
  "die zweite Zeile",
  "eins nach dem anderen",
  "Vierzehntägig prüfen",
];

test("number words are read as quantities with their source span", () => {
  for (const [request, expected] of numberWords)
    assert.deepEqual(
      requestNumbers(request, ids).map((n) => [n.value, n.span]),
      expected,
      request,
    );
});
test("number words that name no quantity are no number", () => {
  for (const request of noQuantity)
    assert.deepEqual(requestNumbers(request, ids), [], request);
});
test("a number word is a candidate from its own source, and Jev sees its span", () => {
  assert.deepEqual(
    fieldValues(numberField("duration"), "Termin neunzig Minuten", [], ids),
    [{ value: "90", source: "words", span: "neunzig Minuten", bound: true }],
  );
  assert.equal(
    describeSource({ source: "words", span: "neunzig Minuten" }, "90", "de"),
    "Zahlwort aus Auftrag: „neunzig Minuten“ = 90 Minuten",
  );
  const hints = requestHints("Termin neunzig Minuten", {
    cases: [],
    technicians: [],
    customers: [],
  });
  assert.deepEqual(
    hints.numbers.map(({ value, from }) => ({ value, from })),
    [{ value: 90, from: "neunzig Minuten" }],
  );
});
test("a correction offers Jev both values and binds neither", () => {
  assert.deepEqual(
    fieldValues(
      numberField("duration"),
      "zwei Stunden is zu lang, mach mal neunzig Minuten draus",
      [],
      ids,
    ).map((v) => [v.value, v.bound]),
    [
      ["120", false],
      ["90", false],
    ],
  );
});

// request, prefilled duration: the value the request asks for, never the one
// it names as current, wrong or replaced, and nothing when that is unclear
const durations: [string, string | null][] = [
  ["zwei Stunden is zu lang, mach mal neunzig Minuten draus", "90"],
  ["zwei Stunden is zu lang", null],
  ["2 Stunden sind zu lang", null],
  ["Termin 120 Minuten ist zu lang, mach 90 draus", "90"],
  ["Termin 30 Minuten ist zu kurz, lieber 45", "45"],
  ["Dauer 90 statt 120", "90"],
  ["statt 120 Minuten lieber 90", "90"],
  ["anstatt 60 Minuten bitte 45", "45"],
  ["nicht 60 sondern 45 Minuten", "45"],
  ["60 Minuten ist falsch, richtig sind 45", "45"],
  ["die 60 Minuten stimmen nicht, 45", "45"],
  ["Termin 60, nee 90", "90"],
  ["Termin 60 Minuten, nein, 90", "90"],
  ["45 äh 50 Minuten", "50"],
  ["Termin 60 min, ich meine 75", "75"],
  ["Termin 60, sorry, 75 Minuten", "75"],
  ["Termin von 120 auf 60 min kürzen", "60"],
  ["Termin 120 → 90 Minuten", "90"],
  ["aktuell 120 Minuten, bitte 90", "90"],
  ["bisher 60 Minuten, neu 90", "90"],
  ["mach neunzig draus", "90"],
  ["Termin 60 Minuten", "60"],
  ["Termin eine Stunde, nee, fünfundvierzig Minuten", "45"],
  ["den Termin um 30 min kürzen", null],
  ["Termin 30 Minuten länger", null],
  ["45 oder 50 Minuten", null],
  ["bisher 60 Minuten", null],
];

test("the duration prefill takes the value the request asks for", () => {
  for (const [request, value] of durations)
    assert.equal(prefill("duration", request), value, request);
});
test("a correction for one field leaves the other field's value", () => {
  const request = "Arbeitszeit 45 Minuten, Termin 60, nee 90";
  assert.equal(prefill("minutes", request), "45");
  assert.equal(prefill("duration", request), "90");
});
test("the panel names the corrected value, not the old one", () => {
  assert.deepEqual(
    partialNotes(
      partialAnswer(
        numberField("duration"),
        "zwei Stunden is zu lang, mach mal neunzig Minuten draus",
        today,
        ids,
      ),
    ),
    ["Aus dem Auftrag: 90. Bitte prüfen."],
  );
});

// request, prefilled day and time, read against the run's start day
const relativeDays: [string, string | null, string | null][] = [
  ["Termin morgen", "2026-09-23", null],
  ["Termin morgen um 10 Uhr", "2026-09-23", "10:00"],
  ["Morgen um 9", "2026-09-23", "09:00"],
  ["morgen früh", "2026-09-23", null],
  ["übermorgen um 14:30", "2026-09-24", "14:30"],
  ["heute um 15 Uhr", "2026-09-22", "15:00"],
  ["heute morgen", "2026-09-22", null],
  ["am Donnerstag um 9", "2026-09-24", "09:00"],
  ["Donnerstag", "2026-09-24", null],
  ["am Montag", "2026-09-28", null],
  ["Dienstag", "2026-09-29", null],
  ["nächsten Dienstag", "2026-09-29", null],
  ["nächsten Donnerstag", "2026-09-24", null],
  ["kommenden Freitag", "2026-09-25", null],
  ["übernächsten Donnerstag", "2026-10-01", null],
  ["Donnerstag nächster Woche", "2026-10-01", null],
  ["nächste Woche Donnerstag", "2026-10-01", null],
  ["nächste Woche am Montag", "2026-09-28", null],
  ["am 3.", "2026-10-03", null],
  ["am 3. um 10 Uhr", "2026-10-03", "10:00"],
  ["am 30.", "2026-09-30", null],
  ["am 22.", "2026-09-22", null],
  ["am 31.", "2026-10-31", null],
  ["am 3. Oktober", "2026-10-03", null],
  ["am 3. Dezember", "2026-12-03", null],
  ["am 24. Sept. um 8 Uhr", "2026-09-24", "08:00"],
  ["morgen, also am 23.09.", "2026-09-23", null],
  ["am Donnerstag, den 24.9.", "2026-09-24", null],
  ["am Donnerstag, den 25.9.", null, null],
  ["morgen oder übermorgen", null, null],
  ["am Morgen", null, null],
  ["guten Morgen, Termin für V-1042", null, null],
  ["letzten Donnerstag", null, null],
  ["donnerstags", null, null],
  ["Ende der Woche", null, null],
];

test("relative days and weekdays prefill the day, read against the run's start day", () => {
  for (const [request, day, time] of relativeDays)
    assert.deepEqual(dateParts(request), [day, time], request);
});
test("a relative day is never a date Jev can set on its own", () => {
  for (const request of [
    "Termin morgen um 10 Uhr",
    "am Donnerstag um 09:00",
    "am 3. um 10:00",
  ])
    assert.deepEqual(fieldValues(appointment, request, [], ids), [], request);
});
test("a relative day is not in the past and reads against another start day", () => {
  assert.deepEqual(partialAnswer(appointment, "morgen", "2026-12-31", ids), {
    type: "datetime-local",
    date: { day: "2027-01-01", past: false },
    time: null,
  });
  assert.deepEqual(
    partialAnswer(appointment, "Donnerstag", "2026-09-24", ids),
    {
      type: "datetime-local",
      date: { day: "2026-10-01", past: false },
      time: null,
    },
  );
});
