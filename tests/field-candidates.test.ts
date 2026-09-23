import assert from "node:assert/strict";
import { test } from "node:test";
import { seedWorkspace } from "../shared/domain.js";
import { fieldCandidates } from "../scripts/jev-format/bench.js";

const seed = seedWorkspace();
const start = {
  ...seed,
  cases: seed.cases.map((c) => (c.id === "V-1041" ? { ...c, minutes: 50 } : c)),
};
const state = {
  originalRequest: "1041 arbeitszeit noch 15 min dazu",
  explicitAnswers: [],
  availableFields: [
    {
      id: "minutes",
      scope: "V-1041",
      label: "Arbeitszeit",
      kind: "draft" as const,
      type: "number" as const,
      current: "55",
      min: 0,
      max: 10000,
    },
  ],
};

test("the bench rebuilds a sum and a difference from the minutes saved at the run's start", () => {
  assert.deepEqual(Object.fromEntries(fieldCandidates(state, start, true)), {
    "field:minutes:15": {
      source: "number",
      bound: false,
      text: "literal number from the request",
    },
    "field:minutes:65": {
      source: "sum",
      bound: false,
      text: "sum: saved 50 plus 15 from the request = 65",
    },
    "field:minutes:35": {
      source: "difference",
      bound: false,
      text: "difference: saved 50 minus 15 from the request = 35",
    },
  });
});

test("a run recorded before sums and differences keeps the request number bound", () => {
  assert.deepEqual(Object.fromEntries(fieldCandidates(state, start, false)), {
    "field:minutes:15": {
      source: "number",
      bound: true,
      text: "literal number from the request",
    },
  });
});
