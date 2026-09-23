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
const scene = (request: string) => ({
  request,
  today,
  cases: seedWorkspace().cases.filter((c) =>
    ["V-1041", "V-1042"].includes(c.id),
  ),
});
/** The options code offers for the field, as key and label. */
const optionsOf = (id: "minutes" | "duration", request: string) =>
  readers.minutes.parts(field(id), scene(request))["value"]!.options;
/** The minutes code assembles when the model picks the option whose label starts with this text. */
const minutesOf = (
  id: "minutes" | "duration",
  request: string,
  labelStart: string | null,
  confidence = 1,
) => {
  const key = labelStart
    ? Object.entries(optionsOf(id, request)).find(([, label]) =>
        label.startsWith(labelStart),
      )?.[0]
    : "none";
  assert.ok(key, `no option ${labelStart} for ${request}`);
  const reading = readers.minutes.assemble(
    { value: sure(key, confidence) },
    field(id),
    scene(request),
  );
  return reading.type === "number" ? reading.value : undefined;
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
    scene(""),
  );
  return reading.type === "datetime-local"
    ? [reading.date.value, reading.time.value]
    : undefined;
};

test("every number is enumerated exactly as written, without case ids and clock times", () => {
  assert.deepEqual(
    numberSpans(
      "1,3h und 1.25 std, dann 37 min, 2h15, 1 std 20 und 3/4 bei V-1042 und 1041 um 14:30",
      ["V-1041", "V-1042"],
    ).map((s) => [s.text, s.amounts, s.unit]),
    [
      ["1,3h", [1.3], "hours"],
      ["1.25 std", [1.25], "hours"],
      ["37 min", [37], "minutes"],
      ["2h15", [2, 15], null],
      ["1 std 20", [1, 20], null],
      ["3/4", [0.75], null],
    ],
  );
});

// request, field, the option the model picks (by label start), minutes code assembles
const minuteReadings: [
  string,
  "minutes" | "duration",
  string | null,
  string | null,
][] = [
  ["1,3h gearbeitet", "minutes", "„1,3h“ = 78 Minuten", "78"],
  ["1.25 std dran", "minutes", "„1.25 std“ = 75 Minuten", "75"],
  ["37 min Arbeit", "minutes", "„37 min“ = 37 Minuten", "37"],
  ["Arbeitszeit 2h15", "minutes", "„2h15“ = 135 Minuten", "135"],
  ["Arbeitszeit 1 std 20", "minutes", "„1 std 20“ = 80 Minuten", "80"],
  ["Arbeitszeit 1,5", "minutes", "„1,5“ als Stunden = 90 Minuten", "90"],
  ["Arbeitszeit 45", "minutes", "„45“ als Minuten = 45 Minuten", "45"],
  ["ne halbe stunde", "minutes", "als Wort: „eine halbe Stunde“", "30"],
  ["anderthalb", "minutes", "als Wort: „anderthalb", "90"],
  [
    "ne dreiviertel Stunde",
    "minutes",
    "als Wort: „eine Dreiviertelstunde“",
    "45",
  ],
  [
    "zwei stunden is zu lang, mach neunzig draus",
    "duration",
    "als Wort: „neunzig (Minuten)“",
    "90",
  ],
  ["Termin 120, nee 90", "duration", "„90“ als Minuten", "90"],
  ["zwei Stunden is zu lang", "duration", null, null],
];
test("code assembles whole minutes from the picked option", () => {
  for (const [request, id, label, value] of minuteReadings)
    assert.equal(minutesOf(id, request, label)?.value, value, request);
});
test("only values the field accepts are offered", () => {
  const labels = Object.values(optionsOf("duration", "Termin 10 Stunden, 45"));
  assert.ok(!labels.some((l) => l.startsWith("„10 Stunden“")));
  assert.ok(!labels.some((l) => l.includes("„45“ als Stunden")));
  assert.ok(labels.some((l) => l.startsWith("„45“ als Minuten")));
  assert.ok(!labels.some((l) => l.includes("= 5 Minuten")));
});
test("a reading carries the confidence of the model's pick", () => {
  assert.deepEqual(minutesOf("duration", "Termin 60, nee 90", "„90“", 0.7), {
    value: "90",
    confidence: 0.7,
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
  [{ hour: "9", relation: "exact", minute: "0" }, "09:00"],
  [{ hour: "9", relation: "exact", minute: "30" }, "09:30"],
  [{ hour: "10", relation: "half" }, "09:30"],
  [{ hour: "11", relation: "half" }, "10:30"],
  [{ hour: "8", relation: "quarter_to" }, "07:45"],
  [{ hour: "2", relation: "quarter_past", daypart: "afternoon" }, "14:15"],
  [{ hour: "14", relation: "exact", minute: "0", daypart: "morning" }, "14:00"],
  [{ hour: "3", relation: "exact", minute: "0" }, "15:00"],
  [
    { hour: "3", relation: "exact", minute: "0", daypart: "afternoon" },
    "15:00",
  ],
  [{ hour: "8", relation: "exact", minute: "0", daypart: "evening" }, "20:00"],
  [{ hour: "12", relation: "exact", minute: "0", daypart: "noon" }, "12:00"],
  [{ hour: "1", relation: "half" }, "12:30"],
  [{ hour: "9", relation: "exact", minute: "other" }, null],
  [{ hour: "9", relation: "exact" }, null],
  [{ hour: "none", relation: "exact" }, null],
];
test("code assembles the clock time from hour, relation, minutes and day part", () => {
  for (const [parts, time] of times)
    assert.equal(dateTimeOf(parts)?.[1], time, JSON.stringify(parts));
});

const hourOptions = (request: string) =>
  Object.keys(
    readers.dateTime.parts(field("appointment"), scene(request))["hour"]!
      .options,
  );
// request, the hour options code offers
const hourChoices: [string, string[]][] = [
  ["Termin halb elf", ["11", "none"]],
  ["Termin halb 12", ["12", "none"]],
  ["Termin morgen", ["none"]],
  ["um 14:15", ["14", "none"]],
  ["um 9.45", ["9", "none"]],
  ["um 0 Uhr oder um 24", ["0", "24", "none"]],
  ["eine halbe Stunde vor vierundzwanzig", ["1", "24", "none"]],
  ["1039 um 25 Uhr", ["none"]],
  ["Termin 9 uhr", ["9", "none"]],
  ["Termin 29.09.", ["none"]],
  ["Termin 24.9.", ["none"]],
  ["am 24.9. um 14 uhr", ["14", "none"]],
  ["am 24.09.2026 um 9", ["9", "none"]],
  ["termin 29.09. 10 uhr nee 11, 45 min", ["10", "11", "none"]],
  ["termin 2026-09-25 10:00", ["10", "none"]],
];
test("the hour is one the request writes, in digits or words, or none", () => {
  for (const [request, hours] of hourChoices)
    assert.deepEqual(hourOptions(request), hours, request);
});

const minuteOptions = (request: string) =>
  Object.keys(
    readers.dateTime.parts(field("appointment"), scene(request))["minute"]!
      .options,
  );
const minuteChoices: [request: string, options: string[]][] = [
  ["Termin 9 uhr", ["0", "other"]],
  ["Termin 9:30", ["0", "30", "other"]],
  ["um 9.45", ["0", "45", "other"]],
  ["um 9.45.", ["0", "45", "other"]],
  ["Termin 24.09.", ["0", "other"]],
  ["um 9:20", ["0", "20", "other"]],
  ["um 9 Uhr 30", ["0", "30", "other"]],
  ["um neun Uhr dreißig", ["0", "30", "other"]],
  ["Termin 9 Uhr 30 Minuten", ["0", "other"]],
  ["Termin 11 Uhr 45  min", ["0", "other"]],
  ["Uhr 20", ["0", "other"]],
  ["Termin halb 10", ["0", "other"]],
  ["termin 2026-09-25 10:00", ["0", "other"]],
  ["termin 10:15, 30 min", ["0", "15", "other"]],
  ["termin 29.09. 10 uhr nee 11, 45 min", ["0", "other"]],
  ["am 24.9. um 14 uhr 90 min termin", ["0", "other"]],
];
test("the minutes are :00, ones the request writes behind an hour, or other", () => {
  for (const [request, minutes] of minuteChoices)
    assert.deepEqual(minuteOptions(request), minutes, request);
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
        answer("f2.value", "w.m90"),
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
