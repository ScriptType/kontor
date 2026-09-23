import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createJev } from "../server/jev.js";
import { stepSchema, type DecisionInput } from "../shared/command.js";

const input: DecisionInput = {
  doneBeforeFirstStep: true,
  state: "full",
  prompt: "full",
  snapshotId: "capture",
  request: "Zeige Kunden",
  context: "{}",
  actions: [
    {
      id: "nav:customers",
      label: "Kunden",
      effect: "Kunden anzeigen",
      kind: "view",
      jev: { does: "Go to the customer overview page" },
    },
  ],
  fields: [
    {
      id: "search",
      scope: "cases",
      label: "Suche",
      type: "text",
      kind: "view",
      current: "",
      jev: { name: "case list search text" },
    },
  ],
  blockedControls: [],
  answers: [],
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
function provider(answer: (options: string[]) => unknown) {
  const calls: string[] = [];
  const jev = createJev(
    { mode: "live", apiKey: "test", model: "jev-latest" },
    async (_url, init) => {
      const payload = z
        .object({
          questions: z.record(
            z.string(),
            z.object({ criteria: z.record(z.string(), z.string()) }),
          ),
        })
        .parse(JSON.parse(String(init?.body)));
      const [key, question] = Object.entries(payload.questions)[0] ?? [];
      assert(key && question);
      calls.push(key);
      return Response.json({
        model: "test",
        answers: {
          [key]: {
            type: "choice",
            ...z
              .record(z.string(), z.unknown())
              .parse(answer(Object.keys(question.criteria))),
          },
        },
      });
    },
  );
  return { jev, calls };
}
const probabilities = {
  "nav:customers": 0.1,
  "ask:search": 0.3,
  done: 0.4,
  blocked: 0.05,
  abstain: 0.15,
};
test("native top two include terminal and question choices independently of selected confidence", async () => {
  const { jev, calls } = provider(() => ({
    choice: "nav:customers",
    confidence: 0.57,
    probabilities,
  }));
  assert.deepEqual(await jev.decide(input), {
    snapshotId: "capture",
    choice: "nav:customers",
    confidence: 0.57,
    ranked: [
      { choice: "done", probability: 0.4 },
      { choice: "ask:search", probability: 0.3 },
    ],
    probabilities,
  });
  assert.deepEqual(calls, ["next"]);
});
test("equal native scores retain offered order and do not require an exact floating sum", async () => {
  const { jev } = provider((options) => ({
    choice: "abstain",
    confidence: 0.8,
    probabilities: Object.fromEntries(
      options.map((key) => [key, 0.2000000001]),
    ),
  }));
  assert.deepEqual((await jev.decide(input)).ranked, [
    { choice: "nav:customers", probability: 0.2000000001 },
    { choice: "ask:search", probability: 0.2000000001 },
  ]);
});
test("abstention never asks a blocked-cause question", async () => {
  const { jev, calls } = provider(() => ({
    choice: "abstain",
    confidence: 0.2,
    probabilities,
  }));
  const decision = await jev.decide({
    ...input,
    blockedControls: [
      {
        action: {
          id: "save",
          label: "Speichern",
          effect: "Speichern",
          kind: "commit",
          jev: { does: "Save the draft of case V-1041 permanently" },
        },
        target: { kind: "case", id: "V-1041" },
        reasons: [
          { kind: "evidence", message: "Beleg fehlt", alternatives: [] },
        ],
      },
    ],
  });
  assert.equal(decision.choice, "abstain");
  assert.equal(decision.blockedCause, undefined);
  assert.deepEqual(calls, ["next"]);
});
for (const [name, patch] of Object.entries({
  missing: { probabilities: { done: 1 } },
  extra: { probabilities: { ...probabilities, hidden: 0 } },
  reserved: { probabilities: { ...probabilities, "blocked:save": 0 } },
  negative: { probabilities: { ...probabilities, done: -0.1 } },
  over: { probabilities: { ...probabilities, done: 1.1 } },
  nonfinite: { probabilities: { ...probabilities, done: Infinity } },
  confidence: { confidence: Infinity },
  selected: { choice: "blocked:save" },
})) {
  test(`provider rejects ${name} probability/selection payload`, async () => {
    const { jev } = provider(() => ({
      choice: "done",
      confidence: 0.8,
      probabilities,
      ...patch,
    }));
    await assert.rejects(jev.decide(input));
  });
}
test("historical steps have unknown outcome, never invented no-op evidence", () => {
  assert.equal(
    stepSchema.parse({
      snapshotId: "old",
      action: input.actions[0],
      before: "{}",
      after: "{}",
    }).outcome,
    "unknown",
  );
});
