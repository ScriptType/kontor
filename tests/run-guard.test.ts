import assert from "node:assert/strict";
import { test } from "node:test";
import { requestClauses } from "../shared/field-values.js";
import { guardStop, stepBudget } from "../shared/run-guard.js";

const filters = (customerId: string | null = null) => ({
  customerId,
  technicianId: null,
  status: "all",
  search: "",
});
const state = (page: string, customerId: string | null = null) =>
  JSON.stringify({ page, revision: 1, filters: filters(customerId) });
const step = (
  id: string,
  before: string,
  after: string,
  outcome: "changed" | "unchanged" = before === after ? "unchanged" : "changed",
) => ({
  snapshotId: id,
  action: {
    id,
    label: id,
    effect: id,
    kind: "view" as const,
    jev: { does: id },
  },
  authorizedBy: "request" as const,
  outcome,
  before,
  after,
});
const run = (
  steps: ReturnType<typeof step>[],
  request = "Zeige Berichte.",
) => ({
  request,
  steps,
});
const stay = (id: string, page = "cases") => step(id, state(page), state(page));
const move = (from: string, to: string) =>
  step(`nav:${to}`, state(from), state(to));

test("an action that already ran twice without change stops the run", () => {
  const noop = stay("nav:cases");
  assert.equal(guardStop(run([noop]), { id: "nav:cases" }, "cases"), null);
  assert.equal(
    guardStop(
      run([noop, stay("menu:customer"), noop]),
      { id: "nav:cases" },
      "cases",
    ),
    "repeat",
  );
  assert.equal(
    guardStop(run([noop, noop]), { id: "nav:reports" }, "cases"),
    null,
  );
  const changedTwice = [move("cases", "reports"), move("cases", "reports")];
  assert.equal(
    guardStop(run(changedTwice), { id: "nav:reports" }, "team"),
    "revisit",
  );
});
test("entering a page a third time with no data change since stops the run", () => {
  const pingPong = [
    move("cases", "reports"),
    move("reports", "cases"),
    move("cases", "reports"),
    move("reports", "cases"),
  ];
  assert.equal(
    guardStop(run(pingPong), { id: "nav:reports" }, "cases"),
    "revisit",
  );
  assert.equal(
    guardStop(run(pingPong.slice(0, 3)), { id: "nav:cases" }, "reports"),
    null,
  );
  assert.equal(guardStop(run(pingPong), { id: "nav:team" }, "cases"), null);
  assert.equal(
    guardStop(run(pingPong), { id: "customer-cases:nord" }, "cases"),
    null,
  );
  const filtered = [
    ...pingPong.slice(0, 3),
    step("customer-cases:nord", state("reports"), state("cases", "nord")),
  ];
  assert.equal(guardStop(run(filtered), { id: "nav:reports" }, "cases"), null);
  assert.equal(
    guardStop(run(pingPong), { id: "case:V-1042" }, "reports"),
    "revisit",
  );
});
test("the step budget is 8 plus 4 per clause, at most 24", () => {
  assert.equal(requestClauses("Zeige Berichte.").length, 1);
  assert.equal(
    requestClauses("Weise V-1042 Lea zu und speichere, dann zeige Berichte.")
      .length,
    3,
  );
  assert.equal(stepBudget(""), 8);
  assert.equal(stepBudget("Zeige Berichte."), 12);
  assert.equal(stepBudget("a und b und c und d"), 24);
  assert.equal(stepBudget("a und b und c und d und e und f"), 24);
  const eleven = Array.from({ length: 11 }, (_, index) =>
    index % 2 ? stay("menu:customer") : stay("menu:technician"),
  );
  assert.equal(guardStop(run(eleven), { id: "customer:nord" }, "cases"), null);
  assert.equal(
    guardStop(
      run([...eleven, stay("filter:open")]),
      { id: "customer:nord" },
      "cases",
    ),
    "budget",
  );
});
