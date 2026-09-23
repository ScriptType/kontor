import assert from "node:assert/strict";
import { test } from "node:test";
import type { ObservedEnd } from "../shared/intent.js";
import { reviewChoice } from "../scripts/jev-eval/review.js";
import {
  regressionScenarios,
  type Scenario,
} from "../scripts/jev-eval/scenarios.js";

const byId = (id: string) => {
  const found = regressionScenarios().find((s) => s.id === id);
  assert(found, id);
  return found;
};
const reached = (s: Scenario): ObservedEnd => ({
  page: s.expected.page ?? s.start.page,
  filters: s.expected.filters,
  records: s.expected.records,
  receipts: Object.entries(s.expected.saves).flatMap(([caseId, states]) =>
    states.map((saved) => ({ caseId, saved })),
  ),
  draft: s.expected.draft && { ...s.expected.draft, dirty: true },
  pagesVisited: s.expected.pageOrder,
});
const fresh = byId("user-fresh");
const humanFresh = [
  "case:V-1041",
  "menu:technician",
  "technician:mara",
  "field:minutes:60",
  "save",
  "menu:customer",
  "customer:nord",
  "nav:reports",
];
const choose = (
  s: Scenario,
  offered: string[],
  prefix: string[],
  observed = reached(s),
  steps: string[] | undefined = humanFresh,
) => reviewChoice({ scenario: s, observed, offered, prefix, steps });

test("done is clicked only when the state already judges correct", () => {
  assert.deepEqual(choose(fresh, ["save", "done"], humanFresh), {
    option: "done",
  });
  const early = { ...reached(fresh), receipts: [], page: "cases" as const };
  const pick = choose(fresh, ["done", "abstain"], humanFresh, early);
  assert.equal(pick.option, null);
  assert.match("reason" in pick ? pick.reason : "", /^done: .*was not saved/);
});

test("an offered action on the human path is clicked, the next barrier is not", () => {
  assert.deepEqual(
    choose(fresh, ["save", "menu:technician"], ["case:V-1041"]),
    { option: "menu:technician" },
  );
  const pick = choose(fresh, ["save", "abstain"], ["case:V-1041"]);
  assert.equal(pick.option, null);
  assert.match(
    "reason" in pick ? pick.reason : "",
    /save not safe, human next menu:technician/,
  );
});

test("a run off the human path gets no click and names where it left", () => {
  const pick = choose(
    fresh,
    ["save", "menu:technician"],
    ["case:V-1041", "field:minutes:60"],
  );
  assert.equal(pick.option, null);
  assert.match(
    "reason" in pick ? pick.reason : "",
    /left the human path at step 2: field:minutes:60, human menu:technician/,
  );
});

test("without human steps only done or blocked can be clicked", () => {
  const pick = reviewChoice({
    scenario: fresh,
    observed: reached(fresh),
    offered: ["menu:technician", "abstain"],
    prefix: ["case:V-1041"],
    steps: undefined,
  });
  assert.equal(pick.option, null);
  assert.match("reason" in pick ? pick.reason : "", /no human steps/);
});

test("a handoff is clicked as blocked once the reachable work is done, never as done", () => {
  const s = byId("use-15");
  const steps = ["case:V-1042", "menu:technician", "technician:lea", "save"];
  assert.deepEqual(choose(s, ["done", "blocked"], steps, reached(s), steps), {
    option: "blocked",
  });
  const pick = choose(s, ["done", "save"], steps, reached(s), steps);
  assert.equal(pick.option, null);
  assert.match("reason" in pick ? pick.reason : "", /done: handoff expected/);
  const unsaved = { ...reached(s), receipts: [] };
  assert.equal(
    choose(s, ["blocked", "abstain"], steps.slice(0, 3), unsaved, steps).option,
    null,
  );
});
