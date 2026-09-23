import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDescription } from "../shared/command.js";
import { seedWorkspace } from "../shared/domain.js";
import { fieldValues, partialAnswer } from "../shared/field-values.js";
import { readers } from "../shared/value-reading.js";

const ids = ["V-1042", "V-1041", "V-1039"];
const number = (id: "minutes" | "duration"): FieldDescription => ({
  id,
  scope: "V-1039",
  label: id,
  kind: "draft",
  type: "number",
  current: "",
  min: id === "duration" ? 15 : 0,
  max: id === "duration" ? 480 : 10000,
  jev: { name: id },
});
const ranges = (id: "minutes" | "duration", request: string) =>
  fieldValues(number(id), request, [], ids)
    .filter(({ source }) => source === "range")
    .map(({ value, bound }) => [value, bound]);

// request, the appointment lengths its time ranges give
const lengths: [string, string[]][] = [
  ["1039 übermorgen von 13 bis 15 uhr eintragen", ["120"]],
  ["am dienstag lieber schon um halb 12 anfangen, dann bis 14 uhr", ["150"]],
  ["9-11 Uhr", ["120"]],
  ["9 Uhr – 11 Uhr", ["120"]],
  ["von 8.30 bis 9.45 Uhr", ["75"]],
  ["von viertel nach neun bis dreiviertel elf", ["90"]],
  ["von 11 bis 1", ["120"]],
  ["von 11:30 bis halb 2", ["120"]],
  ["von 13 bis um 15", ["120"]],
  ["von 8.30 bis 9.45.", ["75"]],
  ["von neun bis elf", ["120"]],
  ["von neun bis elf Uhr", ["120"]],
  ["neun bis elf.", ["120"]],
  ["um 9.10. bis 11", ["110"]],
  ["von zehn bis halb zwölf Uhr", ["90"]],
  ["von 9 Uhr 30 bis 11", ["90"]],
  ["von neun Uhr dreißig bis elf", ["90"]],
  ["von zwanzig vor elf bis zwölf", ["80"]],
  ["von 20 vor 11 bis 12", ["80"]],
  ["zehn nach drei bis vier", ["50"]],
  ["fünf nach halb zehn bis elf", ["85"]],
  ["von 13:15 bis viertel vor 3", []],
  ["2 bis 3 Stunden", []],
  ["2  bis 3  Stunden", []],
  ["2 bis 3 Tagen", []],
  ["30 bis 45 Minuten", []],
  ["von 15 bis 13", []],
  ["von 9 bis 0 Uhr", []],
  ["von 10 vor 0 bis 1", []],
  ["von 10 vor halb 0 bis 1", []],
  ["von halb 0 bis 1", []],
  ["von viertel vor 0 bis 1", []],
  ["von dreiviertel 0 bis 1", []],
  ["von 23 bis 5 nach 24", []],
  ["von 23 bis viertel nach 24", []],
  ["von 23 bis 24 Uhr 30", []],
  ["von 22 bis 24:30", []],
  ["von 20 bis 24 Uhr", ["240"]],
  ["von 23 bis 10 vor 24", ["50"]],
  ["von 9 bis 18 Uhr", []],
  ["um 9 und um 11", []],
  ["am 2026-09-10 um 9", []],
  ["am 24.09. bis 15 uhr", []],
  ["am 24.9. bis 15 uhr", []],
  ["zwei bis drei Stunden", []],
  ["von zwei bis drei Leuten", []],
  ["zwei bis drei Termine", []],
  ["3 vor 2 Tagen", []],
  ["5 nach 10 Minuten", []],
  ["neun bis drei vor zwei Tagen", []],
  ["neun bis fünf nach zehn Minuten", []],
];
test("a time range offers its length to the appointment length, unbound", () => {
  for (const [request, values] of lengths)
    assert.deepEqual(
      ranges("duration", request),
      values.map((v) => [v, false]),
      request,
    );
});
test("a time range's length unbinds the number beside it", () => {
  const bound = (request: string) =>
    fieldValues(number("duration"), request, [], ids).map(({ value, bound }) => [
      value,
      bound,
    ]);
  assert.deepEqual(bound("Termin 45 Minuten"), [["45", true]]);
  assert.deepEqual(bound("Arbeitszeit von 9 bis 11, Termin 45 Minuten"), [
    ["45", false],
    ["120", false],
  ]);
});
test("a time range gives no worked minutes", () => {
  assert.deepEqual(ranges("minutes", "von 13 bis 15 uhr gearbeitet"), []);
});
test("the reader offers the range's length with its arithmetic", () => {
  const scene = {
    request: "1039 übermorgen von 13 bis 15 uhr eintragen",
    today: "2026-09-22",
    cases: seedWorkspace().cases,
  };
  const options = readers.minutes.parts(number("duration"), scene)["value"]!
    .options;
  const key = Object.keys(options).find(
    (k) => options[k] === "Zeitspanne: „13 bis 15“ = 15:00 − 13:00 = 120 Minuten",
  );
  assert.ok(key, JSON.stringify(options));
  assert.deepEqual(
    readers.minutes.assemble(
      { value: { choice: key, confidence: 0.8 } },
      number("duration"),
      scene,
    ),
    { type: "number", value: { value: "120", confidence: 0.8 } },
  );
});
test("without the live model, a range's length is no literal prefill", () => {
  assert.deepEqual(
    partialAnswer(number("duration"), "von 9 bis 11", "2026-09-22", ids),
    { type: "number", value: null },
  );
});
