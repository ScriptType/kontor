import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acts,
  assesses,
  completes,
  gateKind,
  workKind,
} from "../frontend/src/gate.js";
import type { ActionDescription } from "../shared/command.js";

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
    offered("field:minutes:45", "draft"),
  ],
};
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
  for (const choice of ["technician:lea", "field:minutes:45"]) {
    const kind = gateKind(choice, input);
    assert.equal(kind, "draft");
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
  assert.equal(gateKind("technician:lea", boundInput), "draft");
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
