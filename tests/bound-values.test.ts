import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDescription } from "../shared/command.js";
import { fieldValues } from "../shared/field-values.js";

const ids = ["V-1042", "V-1041", "V-1039"];
const number = (
  id: "minutes" | "duration",
  scope = "V-1041",
): FieldDescription => ({
  id,
  scope,
  label: id,
  kind: "draft",
  type: "number",
  current: "0",
  min: id === "duration" ? 15 : 0,
  max: id === "duration" ? 480 : 10000,
  jev: { name: id },
});
const appointment: FieldDescription = {
  id: "appointment",
  scope: "V-1041",
  label: "Termin",
  kind: "draft",
  type: "datetime-local",
  current: "",
  jev: { name: "appointment start" },
};
const bound = (
  field: FieldDescription,
  request: string,
  answers: { fieldId: string; scope: string; value: string }[] = [],
) =>
  Object.fromEntries(
    fieldValues(field, request, answers, ids).map((v) => [v.value, v.bound]),
  );

for (const [request, field, expected] of [
  ["1041 arbeitszeit 45 min", number("minutes"), { 45: true }],
  ["arbeitszeit 45, nee 55", number("minutes"), { 45: false, 55: false }],
  ["erst 30 speichern dann 55", number("minutes"), { 30: false, 55: false }],
  [
    "arbeitszeit erst 30 speichern, dann arbeitszeit 55",
    number("minutes"),
    { 30: false, 55: false },
  ],
  ["1041 auf lea mit 75 min", number("minutes"), { 75: false }],
  ["1041 auf lea mit 75 min", number("duration"), { 75: false }],
  ["1041 war lea 2 std dran", number("minutes"), { 120: true }],
  ["termin 45 min, arbeitszeit 30", number("duration"), { 45: true }],
  ["termin 45 min, arbeitszeit 30", number("minutes"), { 30: true }],
  [
    "1039 arbeitszeit 45. 1041 arbeitszeit 55",
    number("minutes", "V-1041"),
    { 55: true },
  ],
  [
    "1039 arbeitszeit 45. 1041 arbeitszeit 55",
    number("minutes", "V-1039"),
    { 45: true },
  ],
  ["termin am 2026-09-25 10:00", appointment, { "2026-09-25T10:00": true }],
  [
    "termin 2026-09-25 10:00, nee 2026-09-25 11:00",
    appointment,
    { "2026-09-25T10:00": false, "2026-09-25T11:00": false },
  ],
] as const)
  test(`bound for "${request}" on ${field.id} of ${field.scope}`, () => {
    assert.deepEqual(bound(field, request), expected);
  });

test("an answer is never bound, and a request value beside it stays bound", () => {
  const answer = { fieldId: "minutes", scope: "V-1041", value: "40" };
  assert.deepEqual(bound(number("minutes"), "", [answer]), { 40: false });
  assert.deepEqual(bound(number("minutes"), "arbeitszeit 45", [answer]), {
    40: false,
    45: true,
  });
  assert.deepEqual(bound(number("minutes"), "arbeitszeit 40", [answer]), {
    40: false,
  });
});
test("quoted and existing text candidates are never bound", () => {
  const search: FieldDescription = {
    id: "search",
    scope: "cases",
    label: "Suche",
    kind: "view",
    type: "text",
    current: "",
    jev: { name: "case list search text" },
  };
  assert.deepEqual(bound(search, 'Suche "Wartung" bei V-1042'), {
    Wartung: false,
    "V-1042": false,
  });
});
test("a number word is a minute candidate; a clock hour and a spoken case id are not", () => {
  const offered = (field: FieldDescription, request: string) =>
    fieldValues(field, request, [], ids).map((v) => [v.value, v.source]);
  assert.deepEqual(
    offered(
      number("duration"),
      "Fau 10 41, der Termin, zwei Stunden is zu lang, mach mal neunzig Minuten draus",
    ),
    [
      ["120", "hours"],
      ["90", "word"],
    ],
  );
  assert.deepEqual(
    offered(number("minutes"), "Arbeitszeit fünfundsiebzig, nee warte, achtzig"),
    [
      ["75", "word"],
      ["80", "word"],
    ],
  );
  assert.deepEqual(
    offered(number("minutes"), "termin um halb elf, bis zwanzig Uhr"),
    [],
  );
  assert.deepEqual(offered(number("minutes"), "vorgang zehn einundvierzig"), []);
});
