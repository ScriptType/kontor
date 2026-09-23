import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionDescription } from "../shared/command.js";
import {
  observedChanges,
  pagesShown,
  stepLog,
  visitedNote,
} from "../shared/step-log.js";

const observed = (state: Record<string, unknown> = {}) =>
  JSON.stringify({
    page: "cases",
    revision: 3,
    filters: {
      customerId: null,
      technicianId: null,
      status: "all",
      search: "",
    },
    menu: null,
    caseId: null,
    selected: null,
    draft: null,
    dirty: false,
    operations: [],
    receipts: [],
    message: "",
    ...state,
  });
const action = (id: string, kind: ActionDescription["kind"] = "view") => ({
  id,
  label: id,
  effect: id,
  kind,
  jev: { does: `Do ${id}` },
});
const step = (
  id: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  kind: ActionDescription["kind"] = "view",
) => ({
  snapshotId: id,
  action: action(id, kind),
  authorizedBy: "request" as const,
  outcome: "changed" as const,
  before: observed(before),
  after: observed(after),
});
const draft = { technicianId: "jonas", minutes: 20 };

test("a change lists every differing dotted path with its old and new value", () => {
  assert.deepEqual(
    observedChanges(
      observed({ draft }),
      observed({
        page: "reports",
        draft: { ...draft, minutes: 50 },
        filters: {
          customerId: "nord",
          technicianId: null,
          status: "all",
          search: "",
        },
      }),
    ),
    [
      { path: "page", from: "cases", to: "reports" },
      { path: "filters.customerId", from: null, to: "nord" },
      { path: "draft.minutes", from: 20, to: 50 },
    ],
  );
  assert.deepEqual(observedChanges(observed(), observed()), []);
});
test("a save shows as a new revision and a count of ids, not the ids", () => {
  assert.deepEqual(
    observedChanges(
      observed({ operations: [] }),
      observed({
        revision: 4,
        operations: ["op-7f3a"],
        receipts: ["op-7f3a"],
      }),
    ),
    [
      { path: "revision", from: 3, to: 4 },
      { path: "operations", from: 0, to: 1 },
      { path: "receipts", from: 0, to: 1 },
    ],
  );
});
test("an opened case shows its fields appearing", () => {
  const changes = observedChanges(
    observed(),
    observed({ caseId: "V-1042", selected: { id: "V-1042" }, draft }),
  );
  assert.deepEqual(changes, [
    { path: "caseId", from: null, to: "V-1042" },
    { path: "selected.id", from: null, to: "V-1042" },
    { path: "draft.technicianId", from: null, to: "jonas" },
    { path: "draft.minutes", from: null, to: 20 },
  ]);
});
test("each step carries its action text, kind, authority, outcome and changes, never snapshots", () => {
  const [entry] = stepLog([step("nav:reports", {}, { page: "reports" })]);
  assert.deepEqual(entry, {
    action: "Do nav:reports. View only; changes no case data",
    kind: "view",
    authorizedBy: "request",
    outcome: "changed",
    changes: [{ path: "page", from: "cases", to: "reports" }],
  });
});
test("a page visit left again with nothing changed in between is marked visited", () => {
  const log = stepLog([
    step("nav:reports", {}, { page: "reports" }),
    step(
      "menu:customer",
      { page: "reports" },
      { page: "reports", menu: "customer" },
    ),
    step("nav:team", { page: "reports" }, { page: "team" }),
  ]);
  assert.equal(log[0]?.note, visitedNote);
  assert.equal(log[1]?.note, undefined);
  assert.equal(log[2]?.note, undefined);
});
test("a visit is marked only when it changed nothing until the step that left, and only for a view", () => {
  const filtered = {
    customerId: "nord",
    technicianId: null,
    status: "all",
    search: "",
  };
  const changedThere = stepLog([
    step("nav:cases", { page: "reports" }, { page: "cases" }),
    step("customer:nord", {}, { filters: filtered }),
    step(
      "nav:team",
      { filters: filtered },
      { page: "team", filters: filtered },
    ),
  ]);
  assert.equal(changedThere[0]?.note, undefined);
  const stayed = stepLog([step("nav:reports", {}, { page: "reports" })]);
  assert.equal(stayed[0]?.note, undefined);
  const enteredWithFilter = stepLog([
    step(
      "status-cases:open",
      { page: "reports" },
      {
        filters: { ...filtered, customerId: null, status: "open" },
      },
    ),
    step("nav:team", {}, { page: "team" }),
  ]);
  assert.equal(enteredWithFilter[0]?.note, undefined);
  const leftByFiltering = stepLog([
    step("nav:reports", {}, { page: "reports" }),
    step(
      "customer-cases:nord",
      { page: "reports" },
      { page: "cases", filters: filtered },
    ),
  ]);
  assert.equal(leftByFiltering[0]?.note, visitedNote);
  const draftStep = stepLog([
    step("technician:lea", { page: "reports" }, { page: "cases" }, "draft"),
    step("nav:team", {}, { page: "team" }),
  ]);
  assert.equal(draftStep[0]?.note, undefined);
});

test("pages shown list the start page, then each page a step landed on, once per stay", () => {
  assert.deepEqual(pagesShown([], "customers"), ["customers"]);
  const move = (from: string, to: string) =>
    step(`nav:${to}`, { page: from }, { page: to });
  assert.deepEqual(
    pagesShown(
      [
        move("customers", "reports"),
        step("menu:customer", { page: "reports" }, { page: "reports" }),
        move("reports", "cases"),
        step("case:V-1041", { page: "cases" }, { caseId: "V-1041" }),
        move("cases", "reports"),
      ],
      "reports",
    ),
    ["customers", "reports", "cases", "reports"],
  );
});
