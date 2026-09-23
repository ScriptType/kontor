import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  duelPair,
  effectGroups,
  gateNames,
  gates,
  pick,
} from "../frontend/src/gate.js";
import { createJev } from "../server/jev.js";
import {
  jevText,
  type ActionDescription,
  type DecisionInput,
} from "../shared/command.js";

const offered = (id: string, kind: ActionDescription["kind"]) => ({
  id,
  label: id,
  effect: id,
  kind,
  jev: { does: id },
});
const caseList = {
  actions: [
    offered("filter:open", "view"),
    offered("status-cases:open", "view"),
    offered("nav:cases", "view"),
    offered("nav:customers", "view"),
    offered("nav:reports", "view"),
    offered("nav:team", "view"),
    offered("save", "commit"),
  ],
  context: JSON.stringify({
    currentPage: "cases",
    filters: {
      customerId: null,
      technicianId: null,
      status: "all",
      search: "",
    },
    menu: null,
  }),
};
const decided = (probabilities: Record<string, number>) => {
  const ranked = Object.entries(probabilities)
    .map(([choice, probability]) => ({ choice, probability }))
    .sort((a, b) => b.probability - a.probability);
  const [first, second] = ranked;
  assert(first && second);
  return {
    choice: first.choice,
    confidence: first.probability,
    ranked: [first, second],
    probabilities,
  };
};
const pairOf = (
  probabilities: Record<string, number>,
  gate = "g3-cpe-duel" as const,
) => {
  const decision = decided(probabilities);
  const chosen = pick(gate, 75, decision, caseList);
  return { chosen, pair: duelPair(gate, chosen, decision, caseList) };
};

test("effect groups pool options with one effect, strongest first, and name the no-change group done", () => {
  const groups = effectGroups(
    {
      "filter:open": 0.3,
      "status-cases:open": 0.25,
      "nav:cases": 0.2,
      done: 0.15,
      "nav:team": 0.1,
    },
    caseList,
  );
  assert.deepEqual(
    groups.map(({ choice, total }) => [choice, total.toFixed(2)]),
    [
      ["filter:open", "0.55"],
      ["done", "0.35"],
      ["nav:team", "0.10"],
    ],
  );
});

test("a near tie between two effects that does not act duels them, strongest first", () => {
  const { chosen, pair } = pairOf({
    "nav:team": 0.51,
    "nav:reports": 0.49,
  });
  assert.equal(chosen.acts, false);
  assert.deepEqual(pair, ["nav:team", "nav:reports"]);
});

test("only a gate with a duel duels", () => {
  const tie = { "nav:team": 0.51, "nav:reports": 0.49 };
  for (const gate of gateNames)
    if (gate !== "g3-cpe-duel")
      assert.equal(
        duelPair(
          gate,
          pick(gate, 75, decided(tie), caseList),
          decided(tie),
          caseList,
        ),
        null,
        gate,
      );
});

test("the runner-up effect needs 0.15 to duel", () => {
  const rest = { "nav:customers": 0.14, "filter:open": 0.13, done: 0.13 };
  assert.equal(
    pairOf({ "nav:team": 0.45, "nav:reports": 0.149, ...rest }).pair,
    null,
  );
  assert.deepEqual(
    pairOf({ "nav:team": 0.45, "nav:reports": 0.15, ...rest }).pair,
    ["nav:team", "nav:reports"],
  );
});

test("abstain never enters a duel", () => {
  assert.equal(
    pairOf({ "nav:team": 0.5, abstain: 0.45, done: 0.05 }).pair,
    null,
  );
  assert.equal(
    pairOf({ abstain: 0.5, "nav:team": 0.45, done: 0.05 }).pair,
    null,
  );
});

test("a pick that saves, asks or is done does not duel", () => {
  assert.equal(
    pairOf({ save: 0.5, "nav:team": 0.45, abstain: 0.05 }).pair,
    null,
  );
  assert.equal(
    pairOf({ "ask:minutes": 0.5, "nav:team": 0.45, abstain: 0.05 }).pair,
    null,
  );
  assert.equal(
    pairOf({ done: 0.5, "nav:team": 0.45, abstain: 0.05 }).pair,
    null,
  );
});

test("a blocked pick duels, and the no-change effect enters as done", () => {
  assert.deepEqual(
    pairOf({ blocked: 0.53, "nav:customers": 0.44, abstain: 0.03 }).pair,
    ["blocked", "nav:customers"],
  );
  assert.deepEqual(
    pairOf({ "nav:team": 0.45, "nav:cases": 0.25, done: 0.15, abstain: 0.15 })
      .pair,
    ["nav:team", "done"],
  );
});

test("g3-cpe-duel is g3-compact-plan-effect with a duel bar of 0.75", () => {
  const { duel, ...rest } = gates["g3-cpe-duel"];
  assert.deepEqual(rest, gates["g3-compact-plan-effect"]);
  assert.equal(duel, 0.75);
});

const team = {
  id: "nav:team",
  label: "Team",
  effect: "Team anzeigen",
  kind: "view",
  jev: { does: "Go to the team page", now: "Cases page" },
} satisfies ActionDescription;
const input: DecisionInput = {
  doneBeforeFirstStep: false,
  state: "full",
  prompt: "compact",
  snapshotId: "capture",
  request: "Zeige das Team",
  context: "{}",
  actions: [team, offered("nav:reports", "view")],
  fields: [],
  blockedControls: [],
  answers: [],
  steps: [
    {
      snapshotId: "earlier",
      action: offered("nav:customers", "view"),
      authorizedBy: "request",
      outcome: "changed",
      before: "{}",
      after: "{}",
    },
  ],
};
function provider() {
  const questions: {
    instructions: string;
    criteria: Record<string, string>;
  }[] = [];
  const jev = createJev(
    { mode: "live", apiKey: "test", model: "jev-latest" },
    async (_url, init) => {
      const payload = z
        .object({
          questions: z.record(
            z.string(),
            z.object({
              instructions: z.string(),
              criteria: z.record(z.string(), z.string()),
            }),
          ),
        })
        .parse(JSON.parse(String(init?.body)));
      const [key, question] = Object.entries(payload.questions)[0] ?? [];
      assert(key && question);
      questions.push(question);
      const [first, second] = Object.keys(question.criteria);
      assert(first && second);
      return Response.json({
        model: "test",
        answers: {
          [key]: {
            type: "choice",
            choice: second,
            confidence: 0.8,
            probabilities: {
              ...Object.fromEntries(
                Object.keys(question.criteria).map((id) => [id, 0]),
              ),
              [first]: 0.2,
              [second]: 0.8,
            },
          },
        },
      });
    },
  );
  return { jev, questions };
}

test("a duel offers exactly its two options in full text and asks which comes next", async () => {
  const { jev, questions } = provider();
  const decision = await jev.decide({ ...input, duel: ["nav:team", "done"] });
  const [question] = questions;
  assert(question);
  assert.deepEqual(Object.keys(question.criteria), ["nav:team", "done"]);
  assert.equal(
    question.criteria["nav:team"],
    `${jevText(team)}. UI "Team", kind view`,
  );
  assert.match(question.instructions, /^Two next steps are in question\./);
  assert.deepEqual(decision.ranked, [
    { choice: "done", probability: 0.8 },
    { choice: "nav:team", probability: 0.2 },
  ]);
  assert.equal(decision.choice, "done");
});

test("without a duel a compact decide keeps its short texts and every option", async () => {
  const { jev, questions } = provider();
  await jev.decide(input);
  const [question] = questions;
  assert(question);
  assert.deepEqual(Object.keys(question.criteria), [
    "nav:team",
    "nav:reports",
    "done",
    "blocked",
    "abstain",
  ]);
  assert.equal(
    question.criteria["nav:team"],
    "Go to the team page. Now: Cases page",
  );
});

test("a duel over an option decide does not offer asks nothing", async () => {
  const { jev, questions } = provider();
  await assert.rejects(
    jev.decide({ ...input, duel: ["nav:team", "nav:cases"] }),
  );
  await assert.rejects(
    jev.decide({ ...input, duel: ["nav:team", "nav:team"] }),
  );
  await assert.rejects(
    jev.decide({ ...input, steps: [], duel: ["nav:team", "done"] }),
  );
  assert.equal(questions.length, 0);
});
