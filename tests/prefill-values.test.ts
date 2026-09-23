import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDescription } from "../shared/command.js";
import { seedWorkspace } from "../shared/domain.js";
import {
  numberSpans,
  prefillFrom,
  readers,
  readingKind,
  type PartPick,
} from "../shared/value-reading.js";
import { readValues } from "../server/reader.js";

const field = (
  id: "minutes" | "duration" | "appointment" | "search",
): FieldDescription => ({
  id,
  scope: "V-1042",
  label: `V-1042 · ${id}`,
  kind: "draft",
  type:
    id === "appointment"
      ? "datetime-local"
      : id === "search"
        ? "text"
        : "number",
  current: "",
  ...(id === "duration"
    ? { min: 15, max: 480 }
    : id === "minutes"
      ? { min: 0, max: 10000 }
      : {}),
  jev: { name: id },
});
// The demo reference day, a Tuesday.
const today = "2026-09-22";
const sure = (choice: string, confidence = 1): PartPick => ({
  choice,
  confidence,
});
const picks = (parts: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(parts).map(([part, choice]) => [part, sure(choice)]),
  );
const minutesOf = (
  id: "minutes" | "duration",
  request: string,
  parts: Record<string, string>,
) => {
  const reading = readers.minutes.assemble(
    picks({ field: id, ...parts }),
    field(id),
    request,
    today,
  );
  return reading.type === "number" ? reading.value.value : undefined;
};
const dateTimeOf = (parts: Record<string, string>) => {
  const reading = readers.dateTime.assemble(
    picks({
      mode: "none",
      hour: "none",
      relation: "none",
      minute: "none",
      daypart: "none",
      ...parts,
    }),
    field("appointment"),
    "",
    today,
  );
  return reading.type === "datetime-local"
    ? [reading.date.value, reading.time.value]
    : undefined;
};

test("every number is enumerated exactly as written", () => {
  assert.deepEqual(
    numberSpans(
      "1,3h und 1.25 std, dann 37 min, 2h15, 1 std 20 und 3/4 bei V-1042",
    ).map((s) => [s.text, s.amounts]),
    [
      ["1,3", [1.3]],
      ["1.25", [1.25]],
      ["37", [37]],
      ["2h15", [2, 15]],
      ["1 std 20", [1, 20]],
      ["3/4", [0.75]],
      ["1042", [1042]],
    ],
  );
});

// request, field, picks, minutes code computes from them
const minuteReadings: [
  string,
  "minutes" | "duration",
  Record<string, string>,
  string | null,
][] = [
  ["1,3h gearbeitet", "minutes", { span: "s0", unit: "hours" }, "78"],
  ["1.25 std dran", "minutes", { span: "s0", unit: "hours" }, "75"],
  ["37 min Arbeit", "minutes", { span: "s0", unit: "minutes" }, "37"],
  ["Arbeitszeit 2h15", "minutes", { span: "s0", unit: "minutes" }, "135"],
  ["Arbeitszeit 1 std 20", "minutes", { span: "s0", unit: "none" }, "80"],
  [
    "ne halbe stunde",
    "minutes",
    { span: "word", word: "halbe", unit: "hours" },
    "30",
  ],
  [
    "anderthalb",
    "minutes",
    { span: "word", word: "anderthalb", unit: "hours" },
    "90",
  ],
  [
    "zwei stunden is zu lang, mach neunzig draus",
    "duration",
    { span: "word", word: "90", unit: "minutes" },
    "90",
  ],
  ["Termin 120, nee 90", "duration", { span: "s1", unit: "minutes" }, "90"],
  ["zwei Stunden is zu lang", "duration", { span: "none" }, null],
  ["az 50 min", "duration", { span: "elsewhere" }, null],
  ["10 Stunden", "duration", { span: "s0", unit: "hours" }, null],
  ["45 Minuten", "duration", { span: "s0", unit: "none" }, null],
  ["neunzig", "duration", { span: "word", word: "none" }, null],
];
test("code computes whole minutes from the picked span, word and unit", () => {
  for (const [request, id, parts, value] of minuteReadings)
    assert.equal(minutesOf(id, request, parts), value, request);
});
test("a value the model gives to another field is no value for this one", () => {
  const reading = readers.minutes.assemble(
    picks({ field: "minutes", span: "s0", unit: "minutes" }),
    field("duration"),
    "az 50 min",
    today,
  );
  assert.deepEqual(reading, {
    type: "number",
    value: { value: null, confidence: 1 },
  });
});
test("a reading's confidence is the lowest of the parts it used", () => {
  const reading = readers.minutes.assemble(
    {
      field: sure("duration", 0.9),
      span: sure("s1", 0.8),
      unit: sure("minutes", 0.7),
      word: sure("none", 0.1),
    },
    field("duration"),
    "Termin 60, nee 90",
    today,
  );
  assert.deepEqual(reading, {
    type: "number",
    value: { value: "90", confidence: 0.7 },
  });
});

// date parts, day code assembles against Tuesday 2026-09-22
const dates: [Record<string, string>, string | null][] = [
  [{ mode: "relative", anchor: "today" }, "2026-09-22"],
  [{ mode: "relative", anchor: "tomorrow" }, "2026-09-23"],
  [{ mode: "relative", anchor: "day_after" }, "2026-09-24"],
  [
    { mode: "relative", anchor: "weekday", weekday: "3", week: "none" },
    "2026-09-24",
  ],
  [
    { mode: "relative", anchor: "weekday", weekday: "0", week: "none" },
    "2026-09-28",
  ],
  [
    { mode: "relative", anchor: "weekday", weekday: "1", week: "none" },
    "2026-09-22",
  ],
  [
    { mode: "relative", anchor: "weekday", weekday: "3", week: "next" },
    "2026-10-01",
  ],
  [
    { mode: "relative", anchor: "weekday", weekday: "0", week: "current" },
    "2026-09-21",
  ],
  [{ mode: "relative", anchor: "weekday", weekday: "none" }, null],
  [{ mode: "absolute", month: "10", day: "3", year: "none" }, "2026-10-03"],
  [{ mode: "absolute", month: "9", day: "6", year: "none" }, "2026-09-06"],
  [{ mode: "absolute", month: "1", day: "5", year: "none" }, "2027-01-05"],
  [{ mode: "absolute", month: "9", day: "6", year: "2025" }, "2025-09-06"],
  [{ mode: "absolute", month: "2", day: "30", year: "none" }, null],
  [{ mode: "absolute", month: "none", day: "3", year: "none" }, null],
  [{ mode: "absolute", month: "9", day: "6", year: "out_of_range" }, null],
  [{ mode: "none", anchor: "tomorrow" }, null],
];
test("code assembles the day from the date parts as the date cookbook does", () => {
  for (const [parts, day] of dates)
    assert.equal(dateTimeOf(parts)?.[0], day, JSON.stringify(parts));
});

// time parts ("halb 10" is hour 10, half), clock time code assembles
const times: [Record<string, string>, string | null][] = [
  [{ hour: "9", relation: "exact", minute: "none" }, "09:00"],
  [{ hour: "9", relation: "exact", minute: "30" }, "09:30"],
  [{ hour: "10", relation: "half" }, "09:30"],
  [{ hour: "11", relation: "half" }, "10:30"],
  [{ hour: "8", relation: "quarter_to" }, "07:45"],
  [{ hour: "2", relation: "quarter_past", daypart: "afternoon" }, "14:15"],
  [{ hour: "14", relation: "exact", minute: "0", daypart: "morning" }, "14:00"],
  [{ hour: "3", relation: "exact", minute: "0" }, "15:00"],
  [{ hour: "3", relation: "exact", daypart: "afternoon" }, "15:00"],
  [{ hour: "8", relation: "exact", daypart: "evening" }, "20:00"],
  [{ hour: "12", relation: "exact", daypart: "noon" }, "12:00"],
  [{ hour: "1", relation: "half" }, "12:30"],
  [{ hour: "9", relation: "exact", minute: "other" }, null],
  [{ hour: "none", relation: "exact" }, null],
];
test("code assembles the clock time from hour, relation, minutes and day part", () => {
  for (const [parts, time] of times)
    assert.equal(dateTimeOf(parts)?.[1], time, JSON.stringify(parts));
});

test("a part prefills only at the bar's confidence, and a past day says so", () => {
  const read = (value: string | null, confidence: number) => ({
    value,
    confidence,
  });
  assert.deepEqual(
    prefillFrom({ type: "number", value: read("90", 0.59) }, today),
    { type: "number", value: null },
  );
  assert.deepEqual(
    prefillFrom({ type: "number", value: read("90", 0.6) }, today),
    { type: "number", value: "90" },
  );
  assert.deepEqual(
    prefillFrom(
      {
        type: "datetime-local",
        date: read("2026-09-06", 0.9),
        time: read("10:00", 0.3),
      },
      today,
    ),
    {
      type: "datetime-local",
      date: { day: "2026-09-06", past: true },
      time: null,
    },
  );
});

test("the registry names which fields the model reads and how", () => {
  assert.equal(readingKind(field("minutes")), "minutes");
  assert.equal(readingKind(field("duration")), "minutes");
  assert.equal(readingKind(field("appointment")), "dateTime");
  assert.equal(readingKind(field("search")), null);
});

test("all fields are read in one call, each from its own parts", async () => {
  const calls: string[][] = [];
  const readings = await readValues(
    {
      request:
        "Termin morgen um 9, zwei Stunden is zu lang, mach neunzig draus",
      today,
      fields: [field("appointment"), field("search"), field("duration")],
    },
    seedWorkspace(),
    async ({ questions }) => {
      calls.push(Object.keys(questions));
      const answer = (key: string, choice: string) => [
        key,
        { type: "choice" as const, choice, confidence: 0.9, probabilities: {} },
      ];
      return Object.fromEntries([
        answer("f0.mode", "relative"),
        answer("f0.anchor", "tomorrow"),
        answer("f0.hour", "9"),
        answer("f0.relation", "exact"),
        answer("f0.minute", "0"),
        answer("f0.daypart", "none"),
        answer("f2.field", "duration"),
        answer("f2.span", "word"),
        answer("f2.word", "90"),
        answer("f2.unit", "minutes"),
      ]);
    },
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.every((key) => /^f[02]\./.test(key)));
  assert.deepEqual(readings, [
    {
      type: "datetime-local",
      date: { value: "2026-09-23", confidence: 0.9 },
      time: { value: "09:00", confidence: 0.9 },
    },
    null,
    { type: "number", value: { value: "90", confidence: 0.9 } },
  ]);
});
