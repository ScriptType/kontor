import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDescription } from "../shared/command.js";
import { savedMinutes } from "../shared/dimensions.js";
import { draftOf, seedWorkspace } from "../shared/domain.js";
import { describeSource, fieldValues } from "../shared/field-values.js";
import { readers } from "../shared/value-reading.js";

const ids = ["V-1042", "V-1041", "V-1039", "V-1037", "V-1035"];
const number = (
  id: "minutes" | "duration",
  scope: string,
): FieldDescription => ({
  id,
  scope,
  label: id,
  kind: "draft",
  type: "number",
  current: "",
  min: id === "duration" ? 15 : 0,
  max: id === "duration" ? 480 : 10000,
  jev: { name: id },
});
/** Each candidate as value, source and bound. */
const candidates = (field: FieldDescription, request: string, saved?: number) =>
  fieldValues(field, request, [], ids, saved).map((v) => [
    v.value,
    v.source,
    v.bound,
  ]);

for (const [request, scope, saved, expected] of [
  [
    "1037 noch 25 min dazu telefonat gestern abend vergessen",
    "V-1037",
    50,
    [
      ["25", "number", false],
      ["75", "sum", false],
    ],
  ],
  [
    "1042 pls nochmal 25min drauf, jonas musste nachmessen",
    "V-1042",
    50,
    [
      ["25", "number", false],
      ["75", "sum", false],
    ],
  ],
  [
    "1039 sind 20 min zu viel drin, zieh die bitte ab",
    "V-1039",
    110,
    [
      ["20", "number", false],
      ["130", "sum", false],
      ["90", "difference", false],
    ],
  ],
  [
    "jonas seine offenen vorgänge anzeigen bitte der von hafen und partner kriegt fünfzehn minuten mehr arbeitszeit",
    "V-1041",
    60,
    [
      ["15", "word", false],
      ["75", "sum", false],
      ["45", "difference", false],
    ],
  ],
  [
    "1041 arbeitszeit auf 45",
    "V-1041",
    60,
    [
      ["45", "number", false],
      ["105", "sum", false],
      ["15", "difference", false],
    ],
  ],
  ["1041 arbeitszeit auf 45", "V-1041", 0, [["45", "number", true]]],
  ["1041 arbeitszeit auf 45", "V-1041", undefined, [["45", "number", true]]],
] as const)
  test(`"${request}" with ${saved} saved offers ${expected.map(([v]) => v).join(", ")}`, () => {
    assert.deepEqual(
      candidates(number("minutes", scope), request, saved),
      expected,
    );
  });

test("a sum or difference outside the field's range is not offered", () => {
  assert.deepEqual(
    candidates(number("duration", "V-1041"), "termin 30 min länger", 470),
    [
      ["30", "number", false],
      ["440", "difference", false],
    ],
  );
  assert.deepEqual(
    candidates(number("duration", "V-1041"), "termin 10 min kürzer", 20),
    [["30", "sum", false]],
  );
  assert.deepEqual(
    candidates(number("minutes", "V-1041"), "arbeitszeit 20 min weniger", 10),
    [
      ["20", "number", false],
      ["30", "sum", false],
    ],
  );
});

test("a sum names the saved value, the amount and its origin in both languages", () => {
  const found = (request: string, value: string) => {
    const candidate = fieldValues(
      number("minutes", "V-1041"),
      request,
      [],
      ids,
      60,
    ).find((v) => v.value === value);
    assert.ok(candidate, `no ${value} for ${request}`);
    return [
      describeSource(candidate, value, "de"),
      describeSource(candidate, value, "en"),
    ];
  };
  assert.deepEqual(found("1041 noch 25 min dazu", "85"), [
    "Summe: gespeicherte 60 + 25 aus dem Auftrag = 85",
    "sum: saved 60 plus 25 from the request = 85",
  ]);
  assert.deepEqual(found("1041 fünfzehn minuten weniger", "45"), [
    "Differenz: gespeicherte 60 − „fünfzehn“ (15) aus dem Auftrag = 45",
    'difference: saved 60 minus "fünfzehn" (15) from the request = 45',
  ]);
});

test("the saved minutes come from the case record of a minutes field", () => {
  const [v1042, v1041] = seedWorkspace().cases.map(draftOf);
  assert.equal(savedMinutes(number("minutes", "V-1041"), v1041), 45);
  assert.equal(savedMinutes(number("duration", "V-1041"), v1041), 120);
  assert.equal(savedMinutes(number("duration", "V-1042"), v1042), undefined);
  assert.equal(savedMinutes(number("minutes", "V-1041"), undefined), undefined);
  assert.equal(
    savedMinutes({ ...number("minutes", "V-1041"), id: "search" }, v1041),
    undefined,
  );
});

test("the minutes reader offers the sum on the saved minutes and assembles it", () => {
  const scene = {
    request: "1041 noch 25 min dazu",
    today: "2026-09-22",
    cases: seedWorkspace().cases,
  };
  const field = number("minutes", "V-1041");
  const { options } = readers.minutes.parts(field, scene)["value"]!;
  const sum = Object.entries(options).find(
    ([, label]) => label === "Summe: gespeicherte 45 + 25 aus dem Auftrag = 70",
  );
  assert.ok(sum, "no sum option");
  assert.ok(
    Object.values(options).includes(
      "Differenz: gespeicherte 45 − 25 aus dem Auftrag = 20",
    ),
  );
  assert.equal(options["none"]?.includes("um einen Betrag"), false);
  const reading = readers.minutes.assemble(
    { value: { choice: sum[0], confidence: 0.9 } },
    field,
    scene,
  );
  assert.deepEqual(reading, {
    type: "number",
    value: { value: "70", confidence: 0.9 },
  });
  const unsaved = readers.minutes.parts(number("minutes", "V-1042"), {
    ...scene,
    request: "1042 noch 25 min dazu",
  })["value"]!.options;
  assert.equal(
    Object.values(unsaved).some((label) => label.startsWith("Summe")),
    false,
  );
  assert.equal(unsaved["none"]?.includes("um einen Betrag"), true);
});
