import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionDescription, DecisionInput } from "../shared/command.js";
import {
  defaultCaseFilters,
  draftOf,
  seedWorkspace,
  type CaseDraft,
} from "../shared/domain.js";
import { ASK, type Plan } from "../shared/plan.js";
import {
  planIntent,
  reached,
  stepVote,
  type PlanWorld,
  type RunPlan,
} from "../shared/plan-vote.js";

const workspace = seedWorkspace();
const records = Object.fromEntries(
  workspace.cases.map((c) => [c.id, draftOf(c)]),
);
const saved = (caseId: string, change: Partial<CaseDraft>): CaseDraft => ({
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
/** The actions on screen and the facts effectKey reads, with the detail of the selected case mounted. */
function inputOf(
  world: PlanWorld,
  actions: [string, ActionDescription["kind"]][],
  menu: string | null = null,
): Pick<DecisionInput, "actions" | "context"> {
  return {
    actions: actions.map(([id, kind]) => ({
      id,
      label: id,
      effect: id,
      kind,
      jev: { does: id },
    })),
    context: JSON.stringify({
      currentPage: world.page,
      filters: world.filters,
      menu,
      ...(world.selected && world.draft
        ? { selected: { id: world.selected }, draft: world.draft }
        : {}),
    }),
  };
}
const vote = (
  run: RunPlan,
  world: PlanWorld,
  choice: string,
  kind: ActionDescription["kind"] = "view",
  menu: string | null = null,
) => stepVote(run, choice, inputOf(world, [[choice, kind]], menu), world);

const assignLea = runOf({
  cases: { "V-1042": { technician: "lea" } },
  visits: ["cases"],
});
const onV1042 = (draft: Partial<CaseDraft> = {}, dirty = false) =>
  worldOf({
    selected: "V-1042",
    draft: saved("V-1042", draft),
    dirty,
  });

test("opening a case agrees only with a case the plan works on", () => {
  assert.equal(vote(assignLea, worldOf(), "case:V-1042"), "cases=V-1042");
  assert.equal(vote(assignLea, worldOf(), "case:V-1041"), null);
});

test("a case field agrees when it moves the draft to the plan's value", () => {
  const world = onV1042();
  assert.equal(
    vote(assignLea, world, "technician:lea", "draft"),
    "V-1042.technician=lea",
  );
  assert.equal(vote(assignLea, world, "technician:mara", "draft"), null);
});

test("a case field agrees only when the plan's value differs before it", () => {
  const run = runOf({
    cases: {
      "V-1041": { appointmentStart: "2026-09-24T09:00", workedMinutes: "60" },
    },
  });
  const world = worldOf({
    selected: "V-1041",
    draft: saved("V-1041", {
      appointment: { start: "2026-09-24T09:00:30", minutes: 120 },
    }),
  });
  assert.equal(
    vote(run, world, "field:appointment:2026-09-24T09:00", "draft"),
    null,
  );
});

test("a menu agrees while its dimension still has a planned change", () => {
  assert.equal(
    vote(assignLea, onV1042(), "menu:technician"),
    "menu=technician@V-1042",
  );
  assert.equal(
    vote(assignLea, onV1042({ technicianId: "lea" }), "menu:technician"),
    null,
  );
  assert.equal(
    vote(assignLea, onV1042(), "menu:technician", "view", "technician"),
    null,
    "closing a menu never agrees",
  );
  const hafen = runOf({ filters: { customerFilter: "hafen" } });
  assert.equal(vote(hafen, worldOf(), "menu:customer"), "menu=customer");
  assert.equal(
    vote(
      hafen,
      worldOf({ filters: { ...defaultCaseFilters, customerId: "hafen" } }),
      "menu:customer",
    ),
    null,
  );
});

test("a list filter agrees with the plan's filter value", () => {
  const hafen = runOf({ filters: { customerFilter: "hafen" } });
  assert.equal(
    vote(hafen, worldOf(), "customer:hafen"),
    "customerFilter=hafen",
  );
  assert.equal(vote(hafen, worldOf(), "customer:nord"), null);
});

test("a view agrees when it is the next planned visit, or the end page once all are shown", () => {
  const run = runOf({ visits: ["customers", "reports"] });
  assert.equal(vote(run, worldOf(), "nav:customers"), "page=customers");
  assert.equal(vote(run, worldOf(), "nav:reports"), null, "out of order");
  const onCustomers = worldOf({ page: "customers", visited: ["customers"] });
  assert.equal(vote(run, onCustomers, "nav:reports"), "page=reports");
  assert.equal(vote(run, onCustomers, "nav:team"), null);
  const shown = worldOf({
    page: "customers",
    visited: ["customers", "reports", "customers"],
  });
  assert.equal(vote(run, shown, "nav:reports"), "page=reports");
  assert.equal(vote(run, shown, "nav:team"), null);
});

test("every change of an action must agree, and the slots join", () => {
  const run = runOf({
    cases: { "V-1042": { technician: "lea" } },
    visits: ["customers", "cases"],
  });
  assert.equal(
    vote(
      run,
      worldOf({ page: "customers", visited: ["customers"] }),
      "case:V-1042",
    ),
    "cases=V-1042 + page=cases",
  );
  const late = runOf({
    cases: { "V-1042": { technician: "lea" } },
    visits: ["cases", "reports"],
  });
  assert.equal(
    vote(late, worldOf({ page: "team", visited: ["team"] }), "case:V-1042"),
    null,
    "the case agrees, the page does not",
  );
});

test("save agrees only with the next planned save of the dirty draft", () => {
  assert.equal(
    vote(assignLea, onV1042({ technicianId: "lea" }, true), "save", "commit"),
    "save:V-1042#0",
  );
  assert.equal(
    vote(assignLea, onV1042({ technicianId: "mara" }, true), "save", "commit"),
    null,
    "wrong draft",
  );
  const noSave = runOf({
    cases: { "V-1042": { technician: "lea" } },
    flags: { noSave: true, unsupported: false },
  });
  assert.equal(
    vote(noSave, onV1042({ technicianId: "lea" }, true), "save", "commit"),
    null,
    "no save",
  );
  const twice = runOf({
    cases: { "V-1042": { technician: "jonas" } },
    sequence: {
      "V-1042": [{ technician: "lea" }, { technician: "jonas" }],
    },
  });
  const afterFirst = {
    ...onV1042({ technicianId: "jonas" }, true),
    receipts: [
      { caseId: "V-1042", saved: saved("V-1042", { technicianId: "lea" }) },
    ],
  };
  assert.equal(vote(twice, afterFirst, "save", "commit"), "save:V-1042#1");
  assert.equal(
    vote(twice, onV1042({ technicianId: "jonas" }, true), "save", "commit"),
    null,
    "the first save must hold the first value",
  );
});

test("discard and abstain never agree", () => {
  assert.equal(vote(assignLea, onV1042({}, true), "discard", "discard"), null);
  assert.equal(vote(assignLea, onV1042(), "abstain"), null);
});

const leaSaved = saved("V-1042", { technicianId: "lea" });
const afterSave = (change: Partial<PlanWorld> = {}) =>
  worldOf({
    selected: "V-1042",
    draft: leaSaved,
    records: { ...records, "V-1042": leaSaved },
    receipts: [{ caseId: "V-1042", saved: leaSaved }],
    ...change,
  });

test("done agrees once the run stands at the plan's end", () => {
  assert.equal(vote(assignLea, afterSave(), "done"), "done");
  assert(reached(assignLea, afterSave()));
  assert.equal(
    vote(assignLea, afterSave({ receipts: [] }), "done"),
    null,
    "a saved record without this run's receipt",
  );
  const thenReports = runOf({
    cases: { "V-1042": { technician: "lea" } },
    visits: ["cases", "reports"],
  });
  assert.equal(vote(thenReports, afterSave(), "done"), null, "wrong page");
  assert.equal(
    vote(
      thenReports,
      afterSave({ page: "reports", visited: ["reports"] }),
      "done",
    ),
    "done",
  );
});

test("blocked agrees when the rest of the plan is done and the plan hands off", () => {
  const mail = runOf({
    visits: ["customers"],
    flags: { noSave: false, unsupported: true },
  });
  const shown = worldOf({ page: "customers", visited: ["customers"] });
  assert.equal(vote(mail, shown, "blocked"), "blocked");
  assert.equal(vote(mail, shown, "done"), null, "unsupported work remains");
  assert.equal(vote(mail, worldOf(), "blocked"), null, "the view is not shown");
  assert.equal(
    vote(assignLea, afterSave(), "blocked"),
    null,
    "nothing to hand off",
  );
});

test("ask agrees while the plan leaves the field's value open", () => {
  const minutes = runOf({ cases: { "V-1042": { workedMinutes: ASK } } });
  assert.equal(
    vote(minutes, onV1042(), "ask:minutes"),
    "ask:V-1042.workedMinutes",
  );
  const answers = [{ fieldId: "minutes", scope: "V-1042", value: "45" }];
  assert.equal(vote(minutes, { ...onV1042(), answers }, "ask:minutes"), null);
  assert.equal(vote(assignLea, onV1042(), "ask:minutes"), null);
  const search = runOf({ filters: { search: ASK } });
  assert.equal(vote(search, worldOf(), "ask:search"), "ask:search");
  const searched = [{ fieldId: "search", scope: "cases", value: "Wartung" }];
  assert.equal(
    vote(search, worldOf({ answers: searched }), "ask:search"),
    null,
  );
  assert.equal(vote(assignLea, worldOf(), "ask:search"), null);
});

test("an open ask leaves only case and ask votes until the run answers it", () => {
  const run = runOf({
    cases: { "V-1042": { technician: "lea", workedMinutes: ASK } },
  });
  assert.equal(planIntent(run.plan, []), null);
  assert.equal(vote(run, worldOf(), "case:V-1042"), "cases=V-1042");
  assert.equal(vote(run, onV1042(), "technician:lea", "draft"), null);
  const answers = [{ fieldId: "minutes", scope: "V-1042", value: "45" }];
  assert.deepEqual(planIntent(run.plan, answers)?.cases, {
    "V-1042": { technician: "lea", workedMinutes: "45" },
  });
  assert.equal(
    vote(run, { ...onV1042(), answers }, "technician:lea", "draft"),
    "V-1042.technician=lea",
  );
});
