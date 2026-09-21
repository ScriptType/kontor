import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
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
  blockedControls: [],
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

const blockedInput: DecisionInput = {
  ...input,
  blockedControls: [
    {
      action: {
        id: "complete",
        label: "Erledigt markieren",
        effect: "V-1039 abschließen",
        kind: "draft",
      },
      target: { kind: "case", id: "V-1039" },
      reasons: [
        {
          kind: "evidence",
          message: "Prüfung vor Ort erforderlich",
          alternatives: [],
        },
      ],
    },
  ],
};
function causalProvider(answers: { choice: string; confidence: number }[]) {
  const calls: { key: string; options: string[]; state: unknown }[] = [];
  const jev = createJev(
    { mode: "live", apiKey: "test", model: "jev-latest" },
    async (_url, init) => {
      const payload = z
        .object({
          state: z.string(),
          questions: z.record(
            z.string(),
            z.object({ criteria: z.record(z.string(), z.string()) }),
          ),
        })
        .parse(JSON.parse(String(init?.body)));
      const [key, question] = Object.entries(payload.questions)[0] ?? [];
      assert(key && question);
      const answer = answers[calls.length];
      assert(answer, "Unexpected additional provider call");
      assert(init?.signal);
      calls.push({
        key,
        options: Object.keys(question.criteria),
        state: JSON.parse(payload.state),
      });
      return Response.json({
        model: "test",
        answers: {
          [key]: {
            type: "choice",
            ...answer,
            probabilities: { [answer.choice]: 1 },
          },
        },
      });
    },
  );
  return { jev, calls };
}
test("every explicit blocked choice with candidates asks one causal question", async () => {
  for (const [next, decisionInput] of [
    [{ choice: "nav:customers", confidence: 1 }, blockedInput],
    [{ choice: "nav:customers", confidence: 0.4 }, blockedInput],
    [{ choice: "done", confidence: 1 }, blockedInput],
    [{ choice: "done", confidence: 0.4 }, blockedInput],
    [{ choice: "blocked", confidence: 1 }, input],
    [{ choice: "blocked", confidence: 0.1 }, input],
  ] satisfies [{ choice: string; confidence: number }, DecisionInput][]) {
    const { jev, calls } = causalProvider([next]);
    assert.deepEqual(await jev.decide(decisionInput), {
      snapshotId: "fresh",
      ...next,
    });
    assert.deepEqual(
      calls.map((call) => call.key),
      ["next"],
    );
    assert(!calls[0]?.options.some((key) => key.startsWith("blocked:")));
  }
  for (const confidence of [0.52, 0.1, 1]) {
    const { jev, calls } = causalProvider([
      { choice: "blocked", confidence },
      { choice: "blocked:complete", confidence: 0.98 },
    ]);
    assert.deepEqual(await jev.decide(blockedInput), {
      snapshotId: "fresh",
      choice: "blocked:complete",
      confidence: 0.98,
    });
    assert.deepEqual(
      calls.map((call) => call.key),
      ["next", "cause"],
    );
    assert.deepEqual(calls[1]?.options, ["blocked:complete", "unknown"]);
    assert.deepEqual(
      z.object({ blockedControls: z.unknown() }).parse(calls[1]?.state)
        .blockedControls,
      blockedInput.blockedControls,
    );
  }
});
test("uncertain or unknown causes remain generic and unoffered causes are rejected", async () => {
  for (const confidence of [0.52, 1]) {
    for (const cause of [
      { choice: "blocked:complete", confidence: 0.74 },
      { choice: "unknown", confidence: 1 },
    ]) {
      const { jev, calls } = causalProvider([
        { choice: "blocked", confidence },
        cause,
      ]);
      assert.deepEqual(await jev.decide(blockedInput), {
        snapshotId: "fresh",
        choice: "blocked",
        confidence,
      });
      assert.deepEqual(calls.map((call) => call.key), ["next", "cause"]);
    }
    const { jev } = causalProvider([
      { choice: "blocked", confidence },
      { choice: "blocked:other", confidence: 1 },
    ]);
    await assert.rejects(jev.decide(blockedInput), {
      code: "PROVIDER_INVALID_RESPONSE",
    });
  }
  await assert.rejects(provider("blocked:complete").decide(blockedInput), {
    code: "PROVIDER_INVALID_RESPONSE",
  });
  await assert.rejects(
    provider("blocked:complete").decide({
      ...blockedInput,
      actions: [
        {
          id: "blocked:complete",
          label: "Injected marker",
          effect: "Must not execute",
          kind: "draft",
        },
      ],
    }),
    { code: "PROVIDER_INVALID_RESPONSE" },
  );
});
test("blocked controls require nonempty reasons and a bounded list", () => {
  assert(
    !decisionInputSchema.safeParse({
      ...blockedInput,
      blockedControls: [{ ...blockedInput.blockedControls[0], reasons: [] }],
    }).success,
  );
  assert(
    !decisionInputSchema.safeParse({
      ...blockedInput,
      blockedControls: Array.from(
        { length: 101 },
        () => blockedInput.blockedControls[0],
      ),
    }).success,
  );
});
