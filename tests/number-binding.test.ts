import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDescription } from "../shared/command.js";
import { dimensions, literalField } from "../shared/dimensions.js";
import { fieldValues, numberFieldCues } from "../shared/field-values.js";

const ids = ["V-1042", "V-1041", "V-1039", "V-1037", "V-1035"];
const field = (
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
const offered = (f: FieldDescription, request: string) =>
  fieldValues(f, request, [], ids).map((v) => v.value);

test("an appointment length is never offered as worked minutes", () => {
  for (const request of [
    "1042 muss am 2026-09-24 um 10:00 raus, termin 45 min.",
    "hab den termin vergessen: nächsten dienstag halb elf, 45 min. danach kunden",
    "dauer ne stunde, nee, 45 min reichen",
    "Die Termin soll 45 Minuten lang sein",
  ]) {
    assert.deepEqual(offered(field("minutes", "V-1042"), request), [], request);
    assert.deepEqual(offered(field("duration", "V-1042"), request), ["45"]);
  }
});
test("a number without a field word stays offered to every number field", () => {
  const request = "1041 auf lea mit 75 min dann teamansicht";
  assert.deepEqual(offered(field("minutes"), request), ["75"]);
  assert.deepEqual(offered(field("duration"), request), ["75"]);
});
test("the nearest preceding field word in a clause decides, and und starts a new clause", () => {
  const both = "Termin 60 min, Arbeitszeit 30 min";
  assert.deepEqual(offered(field("duration"), both), ["60"]);
  assert.deepEqual(offered(field("minutes"), both), ["30"]);
  const split = "bei 1041 die Termin remove und 75 Minuten Arbeitszeit";
  assert.deepEqual(offered(field("minutes"), split), ["75"]);
  assert.deepEqual(offered(field("duration"), split), []);
});
test("a number goes only to the case its clause names", () => {
  const request = "1039 kannst zumachen. bei 1037 arbeitszeit auf 35 mins";
  assert.deepEqual(offered(field("minutes", "V-1039"), request), []);
  assert.deepEqual(offered(field("minutes", "V-1037"), request), ["35"]);
  assert.deepEqual(
    offered(field("minutes", "V-1042"), "sie hat 40 Minuten gearbeitet"),
    ["40"],
  );
});
test("an explicit answer stays a candidate whatever the request binds", () => {
  assert.deepEqual(
    fieldValues(
      field("minutes"),
      "termin 45 min",
      [{ fieldId: "minutes", scope: "V-1041", value: "45" }],
      ids,
    ),
    [{ value: "45", source: "answer" }],
  );
});
test("every number field of a dimension has words that bind request numbers to it", () => {
  const numberFields = dimensions.flatMap((entry) => {
    const described = entry.kind === "value" ? literalField(entry) : null;
    return described?.type === "number" ? [described.id] : [];
  });
  assert.deepEqual(numberFields.sort(), ["duration", "minutes"]);
  for (const id of numberFields) assert(id in numberFieldCues, id);
});

test("an identifier spoken in two parts is no value and names its case", () => {
  const request = "Fau 10 41, der Termin vom Zugang, 90 min draus";
  assert.deepEqual(offered(field("duration"), request), ["90"]);
  assert.deepEqual(offered(field("minutes"), request), []);
  assert.deepEqual(offered(field("duration", "V-1042"), request), []);
});
