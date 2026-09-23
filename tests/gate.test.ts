import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acts,
  assesses,
  completes,
  decisionHints,
  gateKind,
  gateNames,
  gates,
  pick,
  workKind,
} from "../frontend/src/gate.js";
import type { ActionDescription } from "../shared/command.js";
import { defaultCaseFilters, draftOf, seedWorkspace } from "../shared/domain.js";

const offered = (id: string, kind: ActionDescription["kind"]) => ({
  id,
  label: id,
  effect: id,
  kind,
  jev: { does: id },
});
const input = {
  actions: [
    offered("nav:reports", "view"),
    offered("technician:lea", "draft"),
    offered("save", "commit"),
    offered("discard", "discard"),
    {
      ...offered("field:minutes:45", "draft"),
      value: { source: "number", bound: false },
    },
  ],
} satisfies { actions: ActionDescription[] };
const decision = (confidence: number, pmax: number) => ({
  confidence,
  ranked: [
    { choice: "first", probability: pmax },
    { choice: "second", probability: Math.min(pmax, 1 - pmax) },
  ],
});

test("g1 lets a view choice at pmax 0.72 act where the 75 % threshold does not", () => {
  const kind = gateKind("nav:reports", input);
  assert.equal(kind, "view");
  assert.equal(acts("g1", 75, decision(0.72, 0.72), kind), true);
  assert.equal(acts("threshold", 75, decision(0.72, 0.72), kind), false);
});
test("g1 holds a draft choice at pmax 0.80", () => {
  for (const [choice, expected] of [
    ["technician:lea", "set"],
    ["field:minutes:45", "draft"],
  ] as const) {
    const kind = gateKind(choice, input);
    assert.equal(kind, expected);
    assert.equal(acts("g1", 75, decision(0.8, 0.8), kind), false);
    assert.equal(acts("g1", 75, decision(0.85, 0.85), kind), true);
  }
});
test("discard counts as commit, and so does an unknown choice", () => {
  assert.equal(gateKind("discard", input), "commit");
  assert.equal(gateKind("save", input), "commit");
  assert.equal(gateKind("case:V-1042", input), "commit");
  assert.equal(acts("g1", 75, decision(0.74, 0.74), "commit"), false);
  assert.equal(acts("g1", 75, decision(0.75, 0.75), "commit"), true);
});
test("terminal choices use the terminal bar", () => {
  for (const choice of ["done", "blocked", "abstain"])
    assert.equal(gateKind(choice, input), "terminal");
  assert.equal(acts("g1", 75, decision(0.66, 0.66), "terminal"), true);
  assert.equal(acts("g1", 75, decision(0.64, 0.64), "terminal"), false);
});
test("an ask choice under g1 uses the configured threshold", () => {
  const kind = gateKind("ask:minutes", input);
  assert.equal(kind, "ask");
  assert.equal(acts("g1", 75, decision(0.7, 0.7), kind), false);
  assert.equal(acts("g1", 60, decision(0.7, 0.7), kind), true);
});
test("the threshold gate reads confidence, not pmax", () => {
  assert.equal(acts("threshold", 75, decision(0.9, 0.5), "view"), true);
  assert.equal(acts("threshold", 75, decision(0.5, 0.9), "view"), false);
  assert.equal(acts("threshold", 75, decision(0.75, 0.1), "commit"), true);
});
test("g1 reads pmax, not confidence", () => {
  assert.equal(acts("g1", 75, decision(0.2, 0.9), "draft"), true);
  assert.equal(acts("g1", 75, decision(0.99, 0.6), "view"), false);
});

const step = (kind: ActionDescription["kind"]) => ({
  action: offered(kind, kind),
});
const assessed = (
  complete: number,
  verdict: "complete" | "outstanding" = complete >= 0.5
    ? "complete"
    : "outstanding",
) => ({
  verdict,
  confidence: Math.max(complete, 1 - complete),
  probabilities: { complete, outstanding: 1 - complete, unclear: 0 },
});

test("the kind of work is saved once any step committed, else draft once any step drafted", () => {
  assert.equal(workKind([]), "view");
  assert.equal(workKind([step("view"), step("discard")]), "view");
  assert.equal(workKind([step("view"), step("draft")]), "draft");
  assert.equal(workKind([step("draft"), step("discard")]), "draft");
  assert.equal(
    workKind([step("draft"), step("commit"), step("draft")]),
    "saved",
  );
  assert.equal(workKind([step("commit"), step("view")]), "saved");
});
test("g1 confirms done when P(complete) reaches the bar of the kind of work", () => {
  for (const [kind, bar] of [
    ["view", 0.6],
    ["draft", 0.85],
    ["saved", 0.8],
  ] as const) {
    assert.equal(completes("g1", 75, assessed(bar), kind), true, kind);
    assert.equal(completes("g1", 75, assessed(bar - 0.01), kind), false, kind);
  }
});
test("g1 reads P(complete), not the verdict confidence or the configured threshold", () => {
  const sure = { ...assessed(0.7), confidence: 0.99 };
  assert.equal(completes("g1", 75, sure, "saved"), false);
  assert.equal(completes("g1", 100, assessed(0.62), "view"), true);
  assert.equal(completes("g1", 0, assessed(0.84), "draft"), false);
});
test("the threshold gate keeps the verdict and its confidence for every kind of work", () => {
  for (const kind of ["view", "draft", "saved"] as const) {
    assert.equal(completes("threshold", 75, assessed(0.75), kind), true);
    assert.equal(completes("threshold", 75, assessed(0.74), kind), false);
    assert.equal(completes("threshold", 60, assessed(0.62), kind), true);
    assert.equal(
      completes("threshold", 0, assessed(0.2, "outstanding"), kind),
      false,
    );
  }
});

const boundInput = {
  actions: [
    ...input.actions,
    {
      ...offered("field:minutes:50", "draft"),
      value: { source: "number", bound: true },
    },
    {
      ...offered("field:minutes:55", "draft"),
      value: { source: "number", bound: false },
    },
  ],
} satisfies { actions: ActionDescription[] };

test("a draft action whose value is a bound request candidate is its own kind", () => {
  assert.equal(gateKind("field:minutes:50", boundInput), "bound");
  assert.equal(gateKind("field:minutes:55", boundInput), "draft");
  assert.equal(gateKind("field:minutes:45", boundInput), "draft");
  assert.equal(gateKind("technician:lea", boundInput), "set");
});
test("threshold and g1 treat a bound draft exactly like a draft", () => {
  for (const gate of ["threshold", "g1"] as const) {
    assert.equal(assesses(gate, "bound"), true);
    assert.equal(assesses(gate, "draft"), true);
    assert.equal(assesses(gate, "view"), false);
    for (const [confidence, pmax] of [
      [0.8, 0.8],
      [0.85, 0.85],
      [0.5, 0.9],
      [0.9, 0.5],
    ] as const)
      assert.equal(
        acts(gate, 75, decision(confidence, pmax), "bound"),
        acts(gate, 75, decision(confidence, pmax), "draft"),
      );
  }
});
test("g2-effect lets a view act from pmax 0.30", () => {
  assert.equal(acts("g2-effect", 75, decision(0.31, 0.31), "view"), true);
  assert.equal(acts("g2-effect", 75, decision(0.29, 0.29), "view"), false);
});
test("g2-effect lets a bound draft act at 0.70 while a plain draft at 0.80 holds", () => {
  const bound = gateKind("field:minutes:50", boundInput);
  const plain = gateKind("field:minutes:55", boundInput);
  assert.equal(acts("g2-effect", 75, decision(0.7, 0.7), bound), true);
  assert.equal(acts("g2-effect", 75, decision(0.69, 0.69), bound), false);
  assert.equal(acts("g2-effect", 75, decision(0.8, 0.8), plain), false);
  assert.equal(acts("g2-effect", 75, decision(0.85, 0.85), plain), true);
});
test("g2-effect keeps the commit, terminal and ask bars of g1", () => {
  for (const [kind, below, at] of [
    ["commit", 0.74, 0.75],
    ["terminal", 0.64, 0.65],
    ["ask", 0.74, 0.75],
  ] as const) {
    assert.equal(acts("g2-effect", 75, decision(below, below), kind), false);
    assert.equal(acts("g2-effect", 75, decision(at, at), kind), true);
  }
});
test("g2-effect checks the effect of drafts and saves but not of views or bound drafts", () => {
  assert.equal(assesses("g2-effect", "draft"), true);
  assert.equal(assesses("g2-effect", "commit"), true);
  assert.equal(assesses("g2-effect", "bound"), false);
  assert.equal(assesses("g2-effect", "view"), false);
});
test("g2-exits keeps the g1 bars and effect checks and offers no done before the first step", () => {
  for (const kind of ["view", "draft", "bound", "commit", "terminal"] as const)
    for (const pmax of [0.64, 0.65, 0.7, 0.74, 0.75, 0.84, 0.85])
      assert.equal(
        acts("g2-exits", 75, decision(pmax, pmax), kind),
        acts("g1", 75, decision(pmax, pmax), kind),
        `${kind} ${pmax}`,
      );
  for (const kind of ["view", "draft", "bound", "commit"] as const)
    assert.equal(assesses("g2-exits", kind), assesses("g1", kind));
  assert.equal(gates["g2-exits"].doneBeforeFirstStep, false);
  assert.equal(gates.g1.doneBeforeFirstStep, true);
  assert.equal(gates.threshold.doneBeforeFirstStep, true);
});

const caseList = {
  actions: [
    offered("filter:open", "view"),
    offered("status-cases:open", "view"),
    offered("nav:cases", "view"),
    offered("nav:reports", "view"),
    offered("nav:team", "view"),
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

test("g2-pool acts on two options with one effect that neither clears alone", () => {
  const decision = decided({
    "filter:open": 0.4,
    "status-cases:open": 0.35,
    "nav:team": 0.25,
  });
  const pooled = pick("g2-pool", 75, decision, caseList);
  assert.equal(pooled.choice, "filter:open");
  assert.equal(pooled.kind, "view");
  assert.equal(pooled.acts, true);
  assert.equal(pooled.total.toFixed(2), "0.75");
  assert.equal(pooled.margin.toFixed(2), "0.50");
  assert.equal(pick("g1", 75, decision, caseList).acts, false);
});
test("g2-pool picks done when the options that change nothing win together", () => {
  const decision = decided({
    "nav:cases": 0.36,
    done: 0.3,
    "nav:reports": 0.34,
  });
  const pooled = pick("g2-pool", 75, decision, caseList);
  assert.equal(pooled.choice, "done");
  assert.equal(pooled.kind, "terminal");
  assert.equal(pooled.acts, true);
  assert.equal(pooled.total.toFixed(2), "0.66");
  assert.equal(pick("g1", 75, decision, caseList).choice, "nav:cases");
  assert.equal(pick("g1", 75, decision, caseList).acts, false);
});
test("g2-pool holds a pick that clears its bar but leads the next effect by less than 0.10", () => {
  const close = decided({
    "ask:minutes": 0.46,
    "nav:reports": 0.44,
    done: 0.1,
  });
  assert.equal(pick("g2-pool", 40, close, caseList).choice, "ask:minutes");
  assert.equal(pick("g2-pool", 40, close, caseList).acts, false);
  const clear = decided({
    "ask:minutes": 0.56,
    "nav:reports": 0.34,
    done: 0.1,
  });
  assert.equal(pick("g2-pool", 40, clear, caseList).acts, true);
});
test("unpooled gates follow Jev's own choice", () => {
  const decision = {
    ...decided({ "filter:open": 0.4, "status-cases:open": 0.35, done: 0.25 }),
    choice: "status-cases:open",
  };
  for (const gate of ["threshold", "g1", "g2-effect", "g2-exits"] as const)
    assert.equal(
      pick(gate, 75, decision, caseList).choice,
      "status-cases:open",
    );
});
test("g2 reads pooled totals against the g2-effect bars and offers no done before the first step", () => {
  const views = decided({
    "filter:open": 0.2,
    "status-cases:open": 0.16,
    "nav:team": 0.22,
    "nav:reports": 0.2,
    done: 0.22,
  });
  assert.equal(pick("g2", 75, views, caseList).choice, "filter:open");
  assert.equal(pick("g2", 75, views, caseList).acts, true);
  assert.equal(pick("g2-pool", 75, views, caseList).acts, false);
  assert.equal(pick("g2-effect", 75, views, caseList).acts, false);
  const close = decided({
    "filter:open": 0.2,
    "status-cases:open": 0.16,
    "nav:team": 0.3,
    "nav:reports": 0.34,
  });
  assert.equal(pick("g2", 75, close, caseList).acts, false);
  const draftList = {
    ...caseList,
    actions: [...caseList.actions, ...boundInput.actions],
  };
  const bound = decided({ "field:minutes:50": 0.72, "nav:team": 0.28 });
  assert.equal(pick("g2", 75, bound, draftList).kind, "bound");
  assert.equal(pick("g2", 75, bound, draftList).acts, true);
  assert.equal(pick("g2-pool", 75, bound, draftList).acts, false);
  const plain = decided({ "field:minutes:55": 0.8, "nav:team": 0.2 });
  assert.equal(pick("g2", 75, plain, draftList).acts, false);
  assert.equal(assesses("g2", "bound"), false);
  assert.equal(assesses("g2", "view"), false);
  assert.equal(assesses("g2", "draft"), true);
  assert.equal(assesses("g2", "commit"), true);
  assert.equal(gates.g2.doneBeforeFirstStep, false);
});
for (const gate of ["explore-nomem", "explore"] as const) {
  test(`${gate} lets any view act and a draft act from 0.60 without an effect check`, () => {
    assert.equal(acts(gate, 75, decision(0.05, 0.05), "view"), true);
    assert.equal(assesses(gate, "view"), false);
    for (const choice of ["field:minutes:50", "field:minutes:55"]) {
      const kind = gateKind(choice, boundInput);
      assert.equal(acts(gate, 75, decision(0.6, 0.6), kind), true, choice);
      assert.equal(acts(gate, 75, decision(0.59, 0.59), kind), false, choice);
      assert.equal(assesses(gate, kind), false, choice);
    }
  });
  test(`${gate} keeps the save bar and check, and the done bar and completion check`, () => {
    const save = gateKind("save", input);
    assert.equal(acts(gate, 75, decision(0.74, 0.74), save), false);
    assert.equal(acts(gate, 75, decision(0.75, 0.75), save), true);
    assert.equal(assesses(gate, save), true);
    const done = gateKind("done", input);
    assert.equal(acts(gate, 75, decision(0.64, 0.64), done), false);
    assert.equal(acts(gate, 75, decision(0.65, 0.65), done), true);
    assert.equal(completes(gate, 75, assessed(0.84), "draft"), false);
    assert.equal(completes(gate, 75, assessed(0.85), "draft"), true);
    assert.equal(gates[gate].doneBeforeFirstStep, false);
    assert.equal(gates[gate].guard, true);
  });
}
test("explore sends Jev the lean state, explore-nomem the full one", () => {
  assert.equal(gates.explore.memory, "all");
  assert.equal(gates["explore-nomem"].memory, "off");
  for (const gate of gateNames)
    if (gate !== "explore" && gate !== "g3-mem")
      assert.equal(gates[gate].memory, "off", gate);
});

test("a draft button without a value is set, a field candidate is draft or bound", () => {
  assert.equal(gateKind("technician:lea", input), "set");
  assert.equal(gateKind("field:minutes:45", input), "draft");
  assert.equal(gateKind("field:minutes:50", boundInput), "bound");
  assert.equal(gateKind("nav:reports", input), "view");
});
test("every gate before g3 treats set exactly like draft", () => {
  const list = {
    ...caseList,
    actions: [...caseList.actions, ...input.actions],
  };
  assert.equal(gateKind("technician:lea", list), "set");
  assert.equal(gateKind("field:minutes:45", list), "draft");
  for (const gate of gateNames) {
    if (gate.startsWith("g3")) continue;
    assert.equal(assesses(gate, "set"), assesses(gate, "draft"), gate);
    for (const pmax of [0, 0.59, 0.6, 0.84, 0.85])
      for (const percent of [60, 75])
        assert.equal(
          pick(
            gate,
            percent,
            decided({ "technician:lea": pmax, "nav:team": 1 - pmax }),
            list,
          ).acts,
          pick(
            gate,
            percent,
            decided({ "field:minutes:45": pmax, "nav:team": 1 - pmax }),
            list,
          ).acts,
          `${gate} ${pmax} ${percent}`,
        );
  }
});
test("g3 lets a button draft or a bound value act at 0.60 without an effect check", () => {
  const list = {
    ...caseList,
    actions: [...caseList.actions, ...boundInput.actions],
  };
  for (const choice of ["technician:lea", "field:minutes:50"]) {
    const at = pick(
      "g3",
      75,
      decided({ [choice]: 0.6, "nav:team": 0.4 }),
      list,
    );
    assert.equal(at.acts, true, choice);
    assert.equal(assesses("g3", at.kind), false, choice);
    assert.equal(
      pick("g3", 75, decided({ [choice]: 0.59, "nav:team": 0.41 }), list).acts,
      false,
      choice,
    );
  }
  const unbound = pick(
    "g3",
    75,
    decided({ "field:minutes:55": 0.6, "nav:team": 0.4 }),
    list,
  );
  assert.equal(unbound.kind, "draft");
  assert.equal(unbound.acts, true);
  assert.equal(assesses("g3", unbound.kind), true);
});
test("g3 holds a view at 0.31 that leads the next effect by only 0.09", () => {
  const torn = decided({
    "nav:reports": 0.31,
    "nav:team": 0.22,
    done: 0.22,
    "ask:minutes": 0.22,
    abstain: 0.03,
  });
  const held = pick("g3", 75, torn, caseList);
  assert.equal(held.choice, "nav:reports");
  assert.equal(held.margin.toFixed(2), "0.09");
  assert.equal(held.acts, false);
  const clear = decided({
    "nav:reports": 0.32,
    "nav:team": 0.22,
    done: 0.22,
    "ask:minutes": 0.22,
    abstain: 0.02,
  });
  assert.equal(pick("g3", 75, clear, caseList).acts, true);
});
test("g3 keeps the save bar and check, offers no done before the first step and guards the run", () => {
  const list = {
    ...caseList,
    actions: [...caseList.actions, ...input.actions],
  };
  assert.equal(
    pick("g3", 75, decided({ save: 0.74, "nav:team": 0.26 }), list).acts,
    false,
  );
  assert.equal(
    pick("g3", 75, decided({ save: 0.75, "nav:team": 0.25 }), list).acts,
    true,
  );
  assert.equal(assesses("g3", "commit"), true);
  assert.equal(assesses("g3", "view"), false);
  assert.equal(gates.g3.doneBeforeFirstStep, false);
  assert.equal(gates.g3.guard, true);
  assert.equal(gates.g3.memory, "off");
});
test("g3-mem is g3 with the lean state for decide only", () => {
  const { memory, ...rest } = gates["g3-mem"];
  const { memory: g3Memory, ...g3 } = gates.g3;
  assert.deepEqual(rest, g3);
  assert.equal(memory, "decide");
  assert.equal(g3Memory, "off");
});
test("only the plan gates let the plan release a check", () => {
  for (const gate of gateNames)
    if (!gate.startsWith("g3-compact-plan") && gate !== "g3-cpe-todo")
      assert.deepEqual(gates[gate].planVote, [], gate);
  assert.deepEqual(gates["g3-compact-plan"].planVote, ["pick", "completion"]);
  assert.deepEqual(gates["g3-compact-plan-effect"].planVote, [
    "pick",
    "completion",
    "effect",
  ]);
});
test("the plan gates are g3-compact apart from the plan vote", () => {
  const { planVote: _compact, ...compact } = gates["g3-compact"];
  for (const gate of ["g3-compact-plan", "g3-compact-plan-effect"] as const) {
    const { planVote: _plan, ...rest } = gates[gate];
    assert.deepEqual(rest, compact, gate);
  }
});
test("g3-cpe-todo is g3-compact-plan-effect with the plan's todo list", () => {
  const { todo, ...rest } = gates["g3-cpe-todo"];
  const { todo: effectTodo, ...effect } = gates["g3-compact-plan-effect"];
  assert.deepEqual(rest, effect);
  assert.equal(todo, true);
  assert.equal(effectTodo, false);
});
test("only g3-cpe-todo sends Jev the plan reading with its hints", () => {
  const workspace = seedWorkspace();
  const plan = {
    run: {
      plan: {
        segments: [],
        cases: { "V-1041": { technician: "lea" } },
        sequence: {},
        filters: {},
        visits: [],
        flags: { noSave: false, unsupported: false },
      },
      start: {
        workspace,
        page: "cases" as const,
        filters: defaultCaseFilters,
      },
    },
    world: {
      page: "cases" as const,
      filters: defaultCaseFilters,
      selected: null,
      draft: null,
      dirty: false,
      records: Object.fromEntries(
        workspace.cases.map((c) => [c.id, draftOf(c)]),
      ),
      receipts: [],
      visited: [],
      answers: [],
    },
  };
  const request = "Gib V-1041 an Lea und speichere.";
  for (const gate of gateNames) {
    const hints = decisionHints(gate, request, workspace, [], plan);
    assert.equal(hints === undefined, gates[gate].prompt === "full", gate);
    assert.equal(hints?.planReading !== undefined, gate === "g3-cpe-todo", gate);
  }
  assert.deepEqual(
    decisionHints("g3-cpe-todo", request, workspace, [], plan)?.planReading
      ?.stillOpen,
    [
      "case V-1041: assigned technician should become Lea Sommer (now Jonas Weber)",
      "case V-1041: save the change",
    ],
  );
  assert.equal(
    decisionHints("g3-cpe-todo", request, workspace, [], null)?.planReading,
    undefined,
  );
});
