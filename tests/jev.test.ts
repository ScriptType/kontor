import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createJev } from "../server/jev.js";
import { fieldValues, validFieldValue } from "../shared/field-values.js";
import {
  decisionInputSchema,
  demos,
  jevText,
  type DecisionInput,
} from "../shared/command.js";
const input: DecisionInput = {
  doneBeforeFirstStep: true,
  state: "full",
  request: "Zeig Kunden, danach Team",
  context: "{}",
  snapshotId: "fresh",
  actions: [
    {
      id: "nav:customers",
      label: "Kunden",
      effect: "Kunden anzeigen",
      kind: "view",
      jev: { does: "Go to the customer overview page" },
    },
  ],
  fields: [],
  blockedControls: [],
  answers: [],
  steps: [],
};
const steppedInput: DecisionInput = {
  ...input,
  steps: [
    {
      snapshotId: "earlier",
      action: {
        id: "nav:customers",
        label: "Kunden",
        effect: "Kunden anzeigen",
        kind: "view",
        jev: { does: "Go to the customer overview page" },
      },
      authorizedBy: "request",
      outcome: "changed",
      before: "{}",
      after: "{}",
    },
  ],
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
            probabilities: Object.fromEntries(
              Object.keys(payload.questions[key ?? "next"].criteria).map(
                (option) => [option, option === choice ? 1 : 0],
              ),
            ),
          },
        },
      });
    },
  );
}
test("a real choice uses visible membership and preserves low confidence for concrete confirmation", async () => {
  assert.partialDeepStrictEqual(
    await provider("nav:customers", 0.4).decide(input),
    {
      snapshotId: "fresh",
      choice: "nav:customers",
      confidence: 0.4,
    },
  );
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
          jev: { does: "Save the draft of case V-1041 permanently" },
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
            jev: { name: "worked minutes" },
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
    jev: { name: "worked minutes" },
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
    [{ value: "42", source: "answer", bound: false }],
  );
  assert(!validFieldValue(field, "-1"));
  assert(!validFieldValue(field, "10001"));
  assert.deepEqual(
    fieldValues({ ...field, current: "35" }, "35 Minuten", [], []),
    [{ value: "35", source: "number", bound: false }],
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
    jev: { name: "case list search text" },
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
    jev: { name: "worked minutes" },
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
    jev: { name: "appointment start" },
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
        jev: { does: "Mark case V-1039 as done" },
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
  const calls: {
    key: string;
    options: string[];
    criteria: Record<string, string>;
    state: unknown;
  }[] = [];
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
        criteria: question.criteria,
        state: JSON.parse(payload.state),
      });
      return Response.json({
        model: "test",
        answers: {
          [key]: {
            type: "choice",
            ...answer,
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map((option) => [
                option,
                option === answer.choice ? 1 : 0,
              ]),
            ),
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
    [{ choice: "blocked", confidence: 1 }, steppedInput],
    [{ choice: "blocked", confidence: 0.1 }, steppedInput],
  ] satisfies [{ choice: string; confidence: number }, DecisionInput][]) {
    const { jev, calls } = causalProvider([next]);
    assert.partialDeepStrictEqual(await jev.decide(decisionInput), {
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
    assert.partialDeepStrictEqual(await jev.decide(blockedInput), {
      snapshotId: "fresh",
      choice: "blocked",
      confidence,
      blockedCause: { controlId: "complete", confidence: 0.98 },
    });
    assert.deepEqual(
      calls.map((call) => call.key),
      ["next", "cause"],
    );
    assert.deepEqual(calls[1]?.options, ["blocked:complete", "unknown"]);
    assert.deepEqual(
      z.object({ blockedControls: z.unknown() }).parse(calls[1]?.state)
        .blockedControls,
      [
        {
          action: {
            id: "complete",
            label: "Erledigt markieren",
            effect:
              "Mark case V-1039 as done. Changes only the unsaved draft; nothing is saved until save",
            kind: "draft",
          },
          target: { kind: "case", id: "V-1039" },
          reasons: blockedInput.blockedControls[0]?.reasons,
        },
      ],
    );
  }
});
test("unknown causes stay absent, uncertain causes keep their own confidence and unoffered causes are rejected", async () => {
  for (const confidence of [0.52, 1]) {
    for (const cause of [
      { choice: "blocked:complete", confidence: 0.74 },
      { choice: "unknown", confidence: 1 },
    ]) {
      const { jev, calls } = causalProvider([
        { choice: "blocked", confidence },
        cause,
      ]);
      const decision = await jev.decide(blockedInput);
      assert.partialDeepStrictEqual(decision, {
        snapshotId: "fresh",
        choice: "blocked",
        confidence,
      });
      assert.deepEqual(
        decision.blockedCause,
        cause.choice === "unknown"
          ? undefined
          : { controlId: "complete", confidence: 0.74 },
      );
      assert.deepEqual(
        calls.map((call) => call.key),
        ["next", "cause"],
      );
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
          jev: { does: "Injected marker" },
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
test("blocked is offered only after a step or with a blocked control", async () => {
  const offered = async (decisionInput: DecisionInput) => {
    const { jev, calls } = causalProvider([
      { choice: "abstain", confidence: 1 },
    ]);
    await jev.decide(decisionInput);
    return calls[0]?.options ?? [];
  };
  assert.deepEqual(await offered(input), ["nav:customers", "done", "abstain"]);
  assert((await offered(steppedInput)).includes("blocked"));
  assert((await offered(blockedInput)).includes("blocked"));
  await assert.rejects(provider("blocked").decide(input), {
    code: "PROVIDER_INVALID_RESPONSE",
  });
});
test("done is offered before the first step only when the input allows it", async () => {
  const offered = async (decisionInput: DecisionInput) => {
    const { jev, calls } = causalProvider([
      { choice: "abstain", confidence: 1 },
    ]);
    await jev.decide(decisionInput);
    return calls[0];
  };
  const early = await offered({ ...input, doneBeforeFirstStep: false });
  assert.deepEqual(early?.options, ["nav:customers", "abstain"]);
  assert(!JSON.stringify(early?.state).includes("doneBeforeFirstStep"));
  assert((await offered(input))?.options.includes("done"));
  assert(
    (
      await offered({ ...steppedInput, doneBeforeFirstStep: false })
    )?.options.includes("done"),
  );
  const { doneBeforeFirstStep: _, ...unset } = input;
  assert.equal(decisionInputSchema.parse(unset).doneBeforeFirstStep, true);
  await assert.rejects(
    provider("done").decide({ ...input, doneBeforeFirstStep: false }),
    { code: "PROVIDER_INVALID_RESPONSE" },
  );
});
test("the demo fixture still runs its sequence when done waits for a first step", async () => {
  const demo = createJev({ mode: "demo" });
  const request = demos[0];
  assert.equal(
    (await demo.decide({ ...input, request, doneBeforeFirstStep: false }))
      .choice,
    "nav:customers",
  );
  assert.equal(
    (
      await demo.decide({
        ...steppedInput,
        request,
        doneBeforeFirstStep: false,
      })
    ).choice,
    "done",
  );
});
test("a lean decide state carries a step log and no duplicate options, snapshots or snapshot id", async () => {
  const stateOf = async (decisionInput: DecisionInput) => {
    const { jev, calls } = causalProvider([
      { choice: "abstain", confidence: 1 },
      { choice: "authorized", confidence: 1 },
    ]);
    await jev.decide(decisionInput);
    const [selected] = decisionInput.actions;
    assert(selected);
    await jev.assess({ ...decisionInput, selected });
    return calls.map((call) =>
      z.record(z.string(), z.unknown()).parse(call.state),
    );
  };
  const stepped: DecisionInput = {
    ...blockedInput,
    context: JSON.stringify({
      currentPage: "customers",
      blockedControls: ["copy"],
    }),
    steps: steppedInput.steps.map((step) => ({
      ...step,
      before: JSON.stringify({ page: "cases", receipts: [] }),
      after: JSON.stringify({ page: "customers", receipts: [] }),
    })),
  };
  const [decide, assess] = await stateOf({ ...stepped, state: "lean" });
  assert(decide && assess);
  assert(!("availableActions" in decide));
  assert(!("snapshotId" in decide));
  assert(!JSON.stringify(decide).includes('"before"'));
  assert(!JSON.stringify(decide).includes('"lean"'));
  assert.deepEqual(decide["currentFacts"], { currentPage: "customers" });
  assert.equal(z.array(z.unknown()).parse(decide["blockedControls"]).length, 1);
  assert.deepEqual(decide["observedSteps"], [
    {
      action:
        "Go to the customer overview page. View only; changes no case data",
      kind: "view",
      authorizedBy: "request",
      outcome: "changed",
      changes: [{ path: "page", from: "cases", to: "customers" }],
    },
  ]);
  assert("availableActions" in assess);
  assert.deepEqual(assess["observedSteps"], decide["observedSteps"]);
  const [fullDecide, fullAssess] = await stateOf(stepped);
  assert(fullDecide && fullAssess);
  assert.deepEqual(Object.keys(fullDecide), [
    "snapshotId",
    "originalRequest",
    "explicitAnswers",
    "currentFacts",
    "observedSteps",
    "availableActions",
    "availableFields",
    "blockedControls",
  ]);
  assert.deepEqual(z.array(z.unknown()).parse(fullDecide["observedSteps"])[0], {
    action: {
      id: "nav:customers",
      label: "Kunden",
      effect:
        "Go to the customer overview page. View only; changes no case data",
      kind: "view",
    },
    authorizedBy: "request",
    outcome: "changed",
    before: { page: "cases", receipts: [] },
    after: { page: "customers", receipts: [] },
  });
  assert.deepEqual(fullDecide["currentFacts"], {
    currentPage: "customers",
    blockedControls: ["copy"],
  });
});
test("the demo fixture abstains instead of choosing an unoffered blocked", async () => {
  const demo = createJev({ mode: "demo" });
  assert.equal(
    (await demo.decide({ ...input, request: "Unbekannter Auftrag" })).choice,
    "abstain",
  );
  assert.equal(
    (await demo.decide({ ...steppedInput, request: "Unbekannter Auftrag" }))
      .choice,
    "blocked",
  );
});
test("Jev reads the English action text while labels stay the German UI labels", async () => {
  const action = {
    id: "technician:lea",
    label: "Lea Sommer zuweisen",
    effect: "V-1042: Zuständigkeit von Jonas Weber auf Lea Sommer ändern",
    kind: "draft",
    jev: {
      does: "Assign Lea Sommer to case V-1042",
      now: "assignee Jonas Weber → Lea Sommer",
      notFor: "filtering the case list to Lea Sommer",
    },
  } as const;
  const { jev, calls } = causalProvider([{ choice: "abstain", confidence: 1 }]);
  await jev.decide({
    ...steppedInput,
    actions: [action],
    fields: [
      {
        id: "minutes",
        scope: "V-1042",
        label: "Arbeitszeit",
        kind: "draft",
        type: "number",
        current: "",
        jev: { name: "worked minutes", notFor: "the appointment duration" },
      },
    ],
  });
  const text =
    "Assign Lea Sommer to case V-1042. Now: assignee Jonas Weber → Lea Sommer. Changes only the unsaved draft; nothing is saved until save. Not for: filtering the case list to Lea Sommer";
  assert.equal(jevText(action), text);
  const [call] = calls;
  assert(call);
  assert.equal(
    call.criteria["technician:lea"],
    `${text}. UI "Lea Sommer zuweisen", kind draft`,
  );
  assert.equal(
    call.criteria["ask:minutes"],
    'Ask the user for a missing value of worked minutes of case V-1042, only if the request and previous answers do not supply it. Now: UI "Arbeitszeit", current value empty. Not for: the appointment duration',
  );
  const state = z
    .object({
      availableActions: z.array(z.unknown()),
      availableFields: z.array(z.record(z.string(), z.unknown())),
      observedSteps: z.array(z.object({ action: z.unknown() })),
    })
    .parse(call.state);
  assert.deepEqual(state.availableActions, [
    {
      id: "technician:lea",
      label: "Lea Sommer zuweisen",
      effect: text,
      kind: "draft",
    },
  ]);
  assert(!JSON.stringify(call.state).includes("Zuständigkeit von"));
  assert.deepEqual(state.observedSteps[0]?.action, {
    id: "nav:customers",
    label: "Kunden",
    effect: "Go to the customer overview page. View only; changes no case data",
    kind: "view",
  });
  assert.deepEqual(
    state.availableFields.map((field) => Object.keys(field).sort()),
    [["current", "id", "kind", "label", "scope", "type"]],
  );
});
