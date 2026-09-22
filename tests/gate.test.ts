import assert from "node:assert/strict";
import { test } from "node:test";
import { acts, gateKind } from "../frontend/src/gate.js";
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
