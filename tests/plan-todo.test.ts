import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultCaseFilters,
  draftOf,
  seedWorkspace,
  type CaseDraft,
} from "../shared/domain.js";
import { ASK, type Plan } from "../shared/plan.js";
import {
  nothingRemains,
  planReading,
  planReadingNote,
} from "../shared/plan-todo.js";
import { reached, type PlanWorld, type RunPlan } from "../shared/plan-vote.js";

const workspace = seedWorkspace();
const records = Object.fromEntries(
  workspace.cases.map((c) => [c.id, draftOf(c)]),
);
const edited = (caseId: string, change: Partial<CaseDraft>): CaseDraft => ({
  ...records[caseId]!,
  ...change,
});
function runOf(plan: Partial<Plan>): RunPlan {
  return {
    plan: {
      segments: [],
      cases: {},
      sequence: {},
      filters: {},
      visits: [],
      flags: { noSave: false, unsupported: false },
      ...plan,
    },
    start: { workspace, page: "cases", filters: defaultCaseFilters },
  };
}
function worldOf(change: Partial<PlanWorld> = {}): PlanWorld {
  return {
    page: "cases",
    filters: defaultCaseFilters,
    selected: null,
    draft: null,
    dirty: false,
    records,
    receipts: [],
    visited: [],
    answers: [],
    ...change,
  };
}
/** The case open in its editor with this draft. */
const drafting = (caseId: string, change: Partial<CaseDraft>) =>
  worldOf({ selected: caseId, draft: edited(caseId, change), dirty: true });
/** The case saved once with this change, its editor still open. */
const savedOnce = (caseId: string, change: Partial<CaseDraft>) => {
  const saved = edited(caseId, change);
  return worldOf({
    selected: caseId,
    draft: saved,
    records: { ...records, [caseId]: saved },
    receipts: [{ caseId, saved }],
  });
};

const checked: [RunPlan, PlanWorld][] = [];
function open(run: RunPlan, world: PlanWorld) {
  checked.push([run, world]);
  return planReading(run, world)?.stillOpen ?? null;
}

test("an edit with a save left names the field, then the save, then nothing", () => {
  const run = runOf({ cases: { "V-1041": { technician: "lea" } } });
  assert.deepEqual(open(run, worldOf()), [
    "case V-1041: assigned technician should become Lea Sommer (now Jonas Weber)",
    "case V-1041: save the change",
  ]);
  assert.deepEqual(open(run, drafting("V-1041", { technicianId: "lea" })), [
    "case V-1041: save the change",
  ]);
  assert.deepEqual(open(run, savedOnce("V-1041", { technicianId: "lea" })), [
    nothingRemains,
  ]);
  assert.deepEqual(planReading(run, worldOf())?.note, planReadingNote);
});

test("a wrong saved value stays open with its fix and another save", () => {
  const run = runOf({ cases: { "V-1041": { technician: "lea" } } });
  assert.deepEqual(open(run, savedOnce("V-1041", { technicianId: "mara" })), [
    "case V-1041: assigned technician should become Lea Sommer (now Mara Schulz)",
    "case V-1041: save the change",
  ]);
});

test("ordered saves list each later state after the next save", () => {
  const run = runOf({
    cases: { "V-1041": { technician: "lea", status: "done" } },
    sequence: { "V-1041": [{ technician: "lea" }, { status: "done" }] },
  });
  assert.deepEqual(open(run, worldOf()), [
    "case V-1041: assigned technician should become Lea Sommer (now Jonas Weber)",
    "case V-1041: save the change",
    "case V-1041: after that save, status should become done, saved again",
  ]);
  assert.deepEqual(open(run, savedOnce("V-1041", { technicianId: "lea" })), [
    "case V-1041: status should become done (now open)",
    "case V-1041: save the change",
  ]);
});

test("a filter left open names the wanted and the current value", () => {
  const run = runOf({ filters: { customerFilter: "nord" } });
  assert.deepEqual(open(run, worldOf()), [
    "list filter customer should be Nordwerk GmbH (now all)",
  ]);
  assert.deepEqual(
    open(
      run,
      worldOf({ filters: { ...defaultCaseFilters, customerId: "nord" } }),
    ),
    [nothingRemains],
  );
});

test("ordered pages list only the views still to show and the end page", () => {
  const run = runOf({ visits: ["customers", "reports"] });
  assert.deepEqual(open(run, worldOf()), [
    "pages still to show in order: customers, reports",
    "end on the reports page",
  ]);
  const customers = worldOf({ page: "customers", visited: ["customers"] });
  assert.deepEqual(open(run, customers), [
    "pages still to show in order: reports",
    "end on the reports page",
  ]);
  const skipped = worldOf({ page: "reports", visited: ["reports"] });
  assert.deepEqual(open(run, skipped), [
    "pages still to show in order: customers, reports",
  ]);
  const done = worldOf({
    page: "reports",
    visited: ["customers", "reports"],
  });
  assert.deepEqual(open(run, done), [nothingRemains]);
});

test("a no-save edit asks for an unsaved draft and flags a save", () => {
  const run = runOf({
    cases: { "V-1042": { technician: "lea" } },
    flags: { noSave: true, unsupported: false },
  });
  assert.deepEqual(open(run, worldOf()), [
    "case V-1042: assigned technician should become Lea Sommer (now Jonas Weber)",
    "case V-1042: keep the change as an unsaved draft (do not save)",
  ]);
  assert.deepEqual(open(run, drafting("V-1042", { technicianId: "lea" })), [
    nothingRemains,
  ]);
  assert.ok(
    open(run, savedOnce("V-1042", { technicianId: "lea" }))?.includes(
      "case V-1042: was saved, but the reading expects no save",
    ),
  );
});

test("a draft the reading does not expect stays open", () => {
  const run = runOf({ visits: ["reports"] });
  assert.deepEqual(
    open(run, {
      ...drafting("V-1041", { minutes: 50 }),
      page: "reports",
      visited: ["reports"],
    }),
    ["case V-1041: has unsaved changes the reading does not expect"],
  );
});

test("a handoff never reads as nothing left", () => {
  const unsupported = runOf({
    visits: ["reports"],
    flags: { noSave: false, unsupported: true },
  });
  assert.deepEqual(
    open(unsupported, worldOf({ page: "reports", visited: ["reports"] })),
    ["hand off: part of the request is outside the app"],
  );
  const blocked = runOf({ cases: { "V-1039": { status: "done" } } });
  assert.deepEqual(open(blocked, worldOf()), [
    "hand off: part of the request is not allowed in the app",
  ]);
});

test("an open ASK gives no reading until the user answers", () => {
  const run = runOf({ cases: { "V-1042": { workedMinutes: ASK } } });
  assert.equal(open(run, worldOf()), null);
  const answered = worldOf({
    answers: [{ fieldId: "minutes", scope: "V-1042", value: "45" }],
  });
  assert.deepEqual(open(run, answered), [
    "case V-1042: worked minutes should become 45 (now 0)",
    "case V-1042: save the change",
  ]);
});

test("nothing remains exactly where the plan counts the run as reached", () => {
  assert.ok(checked.length > 10);
  for (const [run, world] of checked) {
    const items = planReading(run, world)?.stillOpen;
    if (items === undefined) continue;
    assert.equal(
      items.length === 1 && items[0] === nothingRemains,
      reached(run, world),
      JSON.stringify({ plan: run.plan, world, items }),
    );
  }
});
