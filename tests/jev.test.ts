import assert from "node:assert/strict";
import { test } from "node:test";
import { createJev } from "../server/jev.js";
import { fieldValues, validFieldValue } from "../shared/field-values.js";
import { decisionInputSchema, type DecisionInput } from "../shared/command.js";
const input: DecisionInput = {
  request: "Zeig Kunden, danach Team",
  context: "{}",
  snapshotId: "fresh",
  actions: [
    {
      id: "nav:customers",
      label: "Kunden",
      effect: "Kunden anzeigen",
      kind: "view",
    },
  ],
  fields: [],
  answers: [],
  steps: [],
};
function provider(choice: string, confidence = 1) {
  return createJev(
    { mode: "live", apiKey: "test", model: "jev-latest" },
    async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.equal(JSON.parse(payload.state).originalRequest, input.request);
      assert(!String(init?.body).includes("expectedDemoAction"));
      const key = Object.keys(payload.questions)[0];
      return Response.json({
        model: "test",
        answers: {
          [key ?? "next"]: {
            type: "choice",
            choice,
            confidence,
            probabilities: { [choice]: 1 },
          },
        },
      });
    },
  );
}
test("a real choice uses visible membership and preserves low confidence for concrete confirmation", async () => {
  assert.deepEqual(await provider("nav:customers", 0.4).decide(input), {
    snapshotId: "fresh",
    choice: "nav:customers",
    confidence: 0.4,
  });
  await assert.rejects(provider("technician:invented").decide(input));
});
test("terminal checks are independent from the original next choice", async () => {
  assert.equal(
    (await provider("outstanding").assess({ ...input, selected: "done" }))
      .verdict,
    "outstanding",
  );
  assert.equal(
    (
      await provider("forbidden").assess({
        ...input,
        selected: {
          id: "save",
          label: "Save",
          effect: "Exact draft",
          kind: "commit",
        },
      })
    ).verdict,
    "forbidden",
  );
});
test("missing input questions name only mounted fields", async () => {
  await assert.rejects(provider("ask:minutes").decide(input));
  assert.equal(
    (
      await provider("ask:minutes").decide({
        ...input,
        fields: [
          {
            id: "minutes",
            scope: "V-1042",
            label: "Arbeitszeit",
            kind: "draft",
            type: "number",
            current: "0",
          },
        ],
      })
    ).choice,
    "ask:minutes",
  );
});
test("lexical candidates exclude IDs and dates and carry explicit provenance", () => {
  const field = {
    id: "minutes",
    scope: "V-1042",
    label: "Arbeitszeit",
    kind: "draft",
    type: "number",
    current: "0",
    min: 0,
    max: 10000,
  } as const;
  assert.deepEqual(
    fieldValues(field, "V-1042 am 2026-09-24 09:00 für 35 Minuten", [], []).map(
      (v) => v.value,
    ),
    ["35"],
  );
  assert.deepEqual(
    fieldValues(
      field,
      "",
      [{ fieldId: "minutes", scope: "V-1042", value: "42" }],
      [],
    ),
    [{ value: "42", source: "aus ausdrücklicher Antwort" }],
  );
  assert(!validFieldValue(field, "-1"));
  assert(!validFieldValue(field, "10001"));
  assert.deepEqual(
    fieldValues({ ...field, current: "35" }, "35 Minuten", [], []),
    [],
  );
});
test("search accepts quoted and mentioned existing text, never invented values", () => {
  const field = {
    id: "search",
    scope: "cases",
    label: "Suche",
    kind: "view",
    type: "text",
    current: "",
  } as const;
  assert.deepEqual(
    fieldValues(
      field,
      'Suche "Wartung" bei Nordwerk',
      [],
      ["Nordwerk", "Hafen"],
    ).map((v) => v.value),
    ["Wartung", "Nordwerk"],
  );
});
test("bounded protocol rejects oversized history", () => {
  assert(
    !decisionInputSchema.safeParse({ ...input, context: "x".repeat(40001) })
      .success,
  );
});

test("answers for another record never become candidates in the current field", () => {
  const field = {
    id: "minutes",
    scope: "V-1041",
    label: "Arbeitszeit",
    kind: "draft",
    type: "number",
    current: "0",
  } as const;
  assert.deepEqual(
    fieldValues(
      field,
      "",
      [{ fieldId: "minutes", scope: "V-1042", value: "77" }],
      [],
    ),
    [],
  );
});

test("datetime offers keep lexical date-time pairs and reject impossible calendars", () => {
  const field = {
    id: "appointment",
    scope: "V-1042",
    label: "Termin",
    kind: "draft",
    type: "datetime-local",
    current: "",
  } as const;
  assert.deepEqual(
    fieldValues(
      field,
      "V-1041 am 2026-09-24 um 09:00 und V-1042 am 2026-09-25 14:00",
      [],
      [],
    ).map((v) => v.value),
    ["2026-09-24T09:00", "2026-09-25T14:00"],
  );
  assert.deepEqual(
    fieldValues(field, "Datum 2026-09-24, Zeit eventuell 09:00", [], []),
    [],
  );
  assert(!validFieldValue(field, "2026-02-30T09:00"));
  assert(!validFieldValue(field, "2026-02-31T09:00"));
  assert(validFieldValue(field, "2028-02-29T09:00"));
  assert.deepEqual(
    fieldValues(
      field,
      "2026-02-30 09:00",
      [{ fieldId: field.id, scope: field.scope, value: "2026-02-31T09:00" }],
      [],
    ),
    [],
  );
});
