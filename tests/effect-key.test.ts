import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionDescription } from "../shared/command.js";
import { effectKey, noChangeKey } from "../shared/dimensions.js";
import {
  defaultCaseFilters,
  type CaseDraft,
  type CaseFilters,
} from "../shared/domain.js";

const action = (id: string, kind: ActionDescription["kind"] = "view") => ({
  id,
  label: id,
  effect: id,
  kind,
  jev: { does: id },
});
const draft: CaseDraft = {
  technicianId: "jonas",
  minutes: 20,
  appointment: null,
  status: "open",
  inspection: null,
  priority: "Normal",
};
const actions = [
  action("nav:cases"),
  action("nav:reports"),
  action("filter:open"),
  action("status-cases:open"),
  action("customer:nord"),
  action("menu:technician"),
  action("menu:customer"),
  action("case:V-1042"),
  action("technician:jonas", "draft"),
  action("technician:lea", "draft"),
  action("field:minutes:20", "draft"),
  action("field:minutes:45", "draft"),
  action("close"),
  action("save", "commit"),
  action("discard", "discard"),
];
const on = (
  facts: {
    currentPage?: string;
    filters?: CaseFilters;
    menu?: string | null;
    mounted?: boolean;
  } = {},
) => {
  const mounted = facts.mounted ?? true;
  const context = JSON.stringify({
    currentPage: facts.currentPage ?? "cases",
    currentScreen: "Vorgänge",
    filters: facts.filters ?? defaultCaseFilters,
    menu: facts.menu ?? null,
    selected: mounted ? { id: "V-1042", title: "Wartung" } : undefined,
    draft: mounted ? draft : undefined,
    retainedSelection: mounted
      ? undefined
      : { caseId: "V-1042", mounted: false, saved: { id: "V-1042" } },
  });
  return (choice: string) => effectKey(choice, { actions, context });
};

test("a navigation to the current page changes nothing, like done", () => {
  const key = on();
  assert.equal(key("done"), noChangeKey);
  assert.equal(key("nav:cases"), noChangeKey);
  assert.notEqual(key("nav:reports"), noChangeKey);
  assert.equal(on({ currentPage: "reports" })("nav:reports"), noChangeKey);
});
test("a field candidate or option equal to the current draft value changes nothing", () => {
  const key = on();
  assert.equal(key("field:minutes:20"), noChangeKey);
  assert.equal(key("technician:jonas"), noChangeKey);
  assert.notEqual(key("field:minutes:45"), noChangeKey);
  assert.notEqual(key("technician:lea"), key("field:minutes:45"));
});
test("reopening the mounted case changes nothing, a retained unmounted one is a change", () => {
  assert.equal(on()("case:V-1042"), noChangeKey);
  const retained = on({ currentPage: "reports", mounted: false });
  assert.notEqual(retained("case:V-1042"), noChangeKey);
  assert.notEqual(retained("case:V-1042"), retained("nav:cases"));
});
test("a status link and the status filter share a key only when the other filters are default", () => {
  const plain = on();
  assert.equal(plain("status-cases:open"), plain("filter:open"));
  assert.notEqual(plain("filter:open"), noChangeKey);
  const nord = on({ filters: { ...defaultCaseFilters, customerId: "nord" } });
  assert.notEqual(nord("status-cases:open"), nord("filter:open"));
  assert.equal(nord("customer:nord"), noChangeKey);
});
test("a menu button opens its menu, or closes it when it is the open one", () => {
  const closed = on();
  assert.notEqual(closed("menu:technician"), noChangeKey);
  assert.notEqual(closed("menu:technician"), closed("menu:customer"));
  const technicianOpen = on({ menu: "technician" });
  const customerOpen = on({ menu: "customer" });
  assert.equal(
    technicianOpen("menu:technician"),
    customerOpen("menu:customer"),
  );
  assert.notEqual(technicianOpen("menu:technician"), noChangeKey);
  assert.equal(technicianOpen("menu:customer"), closed("menu:customer"));
});
test("saves, discards, questions, halts and effectless actions are their own key", () => {
  const key = on();
  const singletons = [
    "save",
    "discard",
    "close",
    "ask:minutes",
    "blocked",
    "abstain",
    "nav:unknown",
  ];
  const all = [
    ...new Set([...actions.map((a) => a.id), "done", ...singletons]),
  ];
  for (const choice of singletons)
    assert.deepEqual(
      all.filter((other) => key(other) === key(choice)),
      [choice],
      choice,
    );
});
test("case values have no shared key without a mounted draft", () => {
  const key = on({ mounted: false });
  assert.notEqual(key("technician:jonas"), key("technician:lea"));
  assert.notEqual(key("technician:jonas"), noChangeKey);
});
test("unreadable facts leave every option its own key", () => {
  for (const context of ["not json", JSON.stringify({ currentPage: "x" })]) {
    const key = (choice: string) => effectKey(choice, { actions, context });
    assert.notEqual(key("nav:cases"), key("done"));
    assert.notEqual(key("nav:cases"), key("nav:reports"));
  }
});
