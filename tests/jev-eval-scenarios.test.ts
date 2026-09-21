import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateScenarios,
  recipes,
  regressionScenarios,
  scenario,
  validateScenario,
  type Scenario,
} from "../scripts/jev-eval/scenarios.js";
import { draftOf, seedWorkspace } from "../shared/domain.js";

const byId = (id: string) => {
  const found = regressionScenarios().find((s) => s.id === id);
  assert(found, id);
  return found;
};
const seedRecord = (id: string) => {
  const found = seedWorkspace().cases.find((c) => c.id === id);
  assert(found, id);
  return draftOf(found);
};

test("the same seed generates the same scenarios, another seed different ones", () => {
  const first = generateScenarios(880001, 30);
  assert.deepEqual(generateScenarios(880001, 30), first);
  const other = generateScenarios(777001, 30).map((s) => s.request);
  assert(
    other.filter((request, i) => request !== first[i]?.request).length > 20,
  );
});
test("generation cycles the recipes and keeps ids unique", () => {
  const scenarios = generateScenarios(880001, recipes.length + 5);
  assert.equal(scenarios.length, recipes.length + 5);
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
});
test("every regression and generated scenario passes the validator", () => {
  for (const s of [...regressionScenarios(), ...generateScenarios(880001, 60)])
    assert.deepEqual(validateScenario(s), [], `${s.id}: ${s.request}`);
});
test("the repeat of the user request starts where the first run should end and expects no save", () => {
  const fresh = byId("user-fresh");
  const repeat = byId("user-repeat");
  assert.equal(repeat.request, fresh.request);
  assert.deepEqual(repeat.expected.saves, {});
  assert.deepEqual(repeat.expected.records, fresh.expected.records);
  assert.deepEqual(repeat.start.filters, fresh.expected.filters);
  assert.equal(repeat.start.page, "reports");
  assert.deepEqual(fresh.expected.saves["V-1041"], [
    { ...seedRecord("V-1041"), technicianId: "mara", minutes: 60 },
  ]);
  assert.equal(fresh.minSamples, 2);
});
test("ordered saves, drafts and handoffs follow from the intent", () => {
  assert.deepEqual(
    byId("use-11").expected.saves["V-1042"]?.map((s) => s.technicianId),
    ["lea", "jonas"],
  );
  const draft = byId("use-10").expected;
  assert.deepEqual(draft.saves, {});
  assert.equal(draft.draft?.values.minutes, 25);
  const blocked = byId("use-14").expected;
  assert.equal(blocked.handoff, "blocked");
  assert.deepEqual(blocked.records["V-1039"], seedRecord("V-1039"));
  assert.equal(byId("use-15").expected.handoff, "unsupported");
  assert.deepEqual(byId("use-02").expected.pageOrder, [
    "customers",
    "reports",
    "team",
  ]);
});
test("a value the request does not contain is reachable only as an answer", () => {
  const definition = {
    id: "minutes",
    source: "use-case" as const,
    request: "Erfasse Arbeitszeit für V-1042 und speichere.",
    intent: {
      cases: { "V-1042": { workedMinutes: "60" } },
      flags: { save: true },
    },
  };
  assert.match(
    validateScenario(scenario(definition)).join("\n"),
    /V-1042: worked minutes 60 are neither a literal/,
  );
  assert.deepEqual(
    validateScenario(
      scenario({
        ...definition,
        ambiguous: [{ dimension: "workedMinutes", caseId: "V-1042" }],
      }),
    ),
    [],
  );
});
test("the validator rejects expected records the controls cannot produce", () => {
  const base = byId("use-05");
  const expecting = (
    caseId: string,
    record: Scenario["expected"]["records"][string],
  ) => ({
    ...base,
    expected: {
      ...base.expected,
      records: { ...base.expected.records, [caseId]: record },
      saves: { [caseId]: [record] },
    },
  });
  assert.match(
    validateScenario(
      expecting("V-1042", { ...seedRecord("V-1042"), technicianId: "mara" }),
    ).join("\n"),
    /technician mara lacks Elektro/,
  );
  assert.match(
    validateScenario(
      expecting("V-1042", {
        ...seedRecord("V-1042"),
        appointment: { start: "2026-09-25T10:00:00", minutes: 90 },
      }),
    ).join("\n"),
    /appointment start 2026-09-25T10:00 is not reachable/,
  );
  assert.match(
    validateScenario(
      expecting("V-1039", { ...seedRecord("V-1039"), status: "done" }),
    ).join("\n"),
    /V-1039: expected record violates a business rule/,
  );
});
test("the validator rejects a sequence whose first save changes nothing", () => {
  const s = scenario({
    id: "sequence",
    source: "use-case",
    request: "Weise V-1042 erst Jonas zu, speichere, dann Lea und speichere.",
    intent: {
      cases: { "V-1042": { technician: "lea" } },
      sequence: { "V-1042": [{ technician: "jonas" }, { technician: "lea" }] },
      flags: { save: true, sequence: true },
    },
  });
  assert.match(validateScenario(s).join("\n"), /a save without a change/);
});
test("the validator rejects two unsaved drafts and a search the request never names", () => {
  const drafts = scenario({
    id: "drafts",
    source: "use-case",
    request: "V-1041 und V-1037 an Lea, nicht speichern.",
    intent: {
      cases: {
        "V-1041": { technician: "lea" },
        "V-1037": { technician: "lea" },
      },
      flags: { noSave: true },
    },
  });
  assert.match(validateScenario(drafts).join("\n"), /only one case/);
  const search = scenario({
    id: "search",
    source: "use-case",
    request: "Suche nach Wartung.",
    intent: { filters: { search: "Wartung" } },
  });
  assert.match(validateScenario(search).join("\n"), /search "Wartung"/);
});
