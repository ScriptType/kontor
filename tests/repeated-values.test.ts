import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldValues } from "../shared/field-values.js";
import type { FieldDescription } from "../shared/command.js";

const minutes: FieldDescription = {
  id: "minutes", scope: "V-1041", label: "Arbeitszeit", kind: "draft",
  type: "number", current: "60", min: 0, max: 10000,
};
test("grounded repeated minutes remain available alongside a legitimate bare 1041", () => {
  assert.deepEqual(
    fieldValues(minutes, "Ändere 1041. 060 minuten, 60 Minuten.", [], []).map((item) => item.value),
    ["1041", "60"],
  );
});
test("same explicit answer remains grounded and numeric aliases collapse", () => {
  assert.deepEqual(
    fieldValues(minutes, "60 Minuten", [{ fieldId: "minutes", scope: "V-1041", value: "060" }], []).map((item) => item.value),
    ["60"],
  );
});
