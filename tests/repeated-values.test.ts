import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldValues } from "../shared/field-values.js";
import type { FieldDescription } from "../shared/command.js";

const minutes: FieldDescription = {
  id: "minutes",
  scope: "V-1041",
  label: "Arbeitszeit",
  kind: "draft",
  type: "number",
  current: "60",
  min: 0,
  max: 10000,
  jev: { name: "worked minutes" },
};
test("grounded repeated minutes remain available alongside a legitimate bare 1041", () => {
  assert.deepEqual(
    fieldValues(minutes, "Ändere 1041 auf Mara. 60 Minuten.", [], []).map(
      (item) => item.value,
    ),
    ["1041", "60"],
  );
});
test("a bare number that equals an identifier's digits is not a candidate, other literals stay", () => {
  assert.deepEqual(
    fieldValues(
      minutes,
      "Ändere 1041 auf Mara. 60 Minuten.",
      [],
      ["V-1042", "V-1041", "Wartung 1041", "Hafen 60"],
    ),
    [{ value: "60", source: "number", bound: false }],
  );
  assert.deepEqual(
    fieldValues(minutes, "1041 und 1040", [], ["A-1041", "V-1040x"]).map(
      (item) => item.value,
    ),
    ["1040"],
  );
});
test("an explicit answer equal to an identifier's digits stays a candidate", () => {
  assert.deepEqual(
    fieldValues(
      minutes,
      "Ändere 1041 und erfasse 30",
      [{ fieldId: "minutes", scope: "V-1041", value: "1041" }],
      ["V-1041"],
    ),
    [
      { value: "1041", source: "answer", bound: false },
      { value: "30", source: "number", bound: false },
    ],
  );
});
test("same explicit answer remains grounded and numeric aliases collapse", () => {
  assert.deepEqual(
    fieldValues(
      minutes,
      "60 Minuten",
      [{ fieldId: "minutes", scope: "V-1041", value: "060" }],
      [],
    ).map((item) => item.value),
    ["60"],
  );
});
