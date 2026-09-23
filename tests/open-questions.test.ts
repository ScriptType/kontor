import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dueQuestion,
  openQuestions,
  withheld,
} from "../shared/open-questions.js";
import { defaultCaseFilters } from "../shared/domain.js";
import type { ActionDescription, FieldDescription } from "../shared/command.js";

const field = (
  id: string,
  scope: string,
  type: FieldDescription["type"] = "number",
): FieldDescription => ({
  id,
  scope,
  label: `${scope} · ${id}`,
  kind: scope === "cases" ? "view" : "draft",
  type,
  current: "",
  jev: { name: id },
});
const appointment = field("appointment", "V-1042", "datetime-local");
const minutes = field("minutes", "V-1042");
const search = field("search", "cases", "text");
const offered = (
  id: string,
  kind: ActionDescription["kind"] = "draft",
): ActionDescription => ({
  id,
  label: id,
  effect: id,
  kind,
  jev: { does: id },
});
const onCase = (selected: string | null) => ({
  context: JSON.stringify({
    currentPage: "cases",
    filters: defaultCaseFilters,
    menu: null,
    ...(selected ? { selected: { id: selected } } : {}),
  }),
  fields: [appointment, minutes, search].map((f) =>
    f.scope === "cases" ? f : { ...f, scope: selected ?? "" },
  ),
  actions: [
    offered("technician:lea"),
    offered("menu:technician", "view"),
    offered("priority:Normal"),
    offered("field:minutes:45"),
    offered("field:appointment:2026-09-30T10:00"),
    offered("remove-appointment"),
    offered("save", "commit"),
    offered("discard", "discard"),
    offered("close", "view"),
    offered("case:V-1039", "view"),
    offered("nav:reports", "view"),
    offered("filter:open", "view"),
    offered("menu:customer", "view"),
  ],
});

test("work on the asked case's other values stays inside the question's item", () => {
  for (const choice of [
    "technician:lea",
    "menu:technician",
    "priority:Normal",
    "field:minutes:45",
    "ask:minutes",
  ])
    assert.equal(
      dueQuestion([appointment], choice, onCase("V-1042")),
      null,
      choice,
    );
});
test("saving, leaving, finishing or guessing the asked value brings the question", () => {
  for (const choice of [
    "save",
    "discard",
    "close",
    "case:V-1039",
    "nav:reports",
    "filter:open",
    "done",
    "blocked",
    "abstain",
    "ask:appointment",
    "field:appointment:2026-09-30T10:00",
    "remove-appointment",
    "technician:mara",
  ])
    assert.equal(
      dueQuestion([appointment], choice, onCase("V-1042")),
      appointment,
      choice,
    );
});
test("a draft change on another case is outside the asked case's item", () => {
  assert.equal(
    dueQuestion([appointment], "technician:lea", onCase("V-1039")),
    appointment,
  );
});
test("a list question lets filters change and brings the question before a case opens", () => {
  assert.equal(dueQuestion([search], "filter:open", onCase(null)), null);
  assert.equal(dueQuestion([search], "menu:customer", onCase(null)), null);
  for (const choice of ["case:V-1039", "technician:lea", "save", "done"])
    assert.equal(dueQuestion([search], choice, onCase(null)), search, choice);
});
test("without an open question nothing is due", () => {
  assert.equal(dueQuestion([], "done", onCase("V-1042")), null);
});
test("the oldest open question comes first", () => {
  assert.equal(
    dueQuestion([minutes, appointment], "save", onCase("V-1042")),
    minutes,
  );
});
test("an answer after the note closes it, one before it or on another case does not", () => {
  const noted = [{ field: appointment, since: 1 }];
  const answer = (scope: string) => ({
    fieldId: "appointment",
    scope,
    value: "2026-09-06T10:00",
  });
  const other = { fieldId: "minutes", scope: "V-1042", value: "45" };
  assert.deepEqual(openQuestions(noted, [other, answer("V-1042")]), []);
  assert.deepEqual(openQuestions(noted, [answer("V-1042")]), [appointment]);
  assert.deepEqual(openQuestions(noted, [other, answer("V-1039")]), [
    appointment,
  ]);
  assert.deepEqual(
    openQuestions([...noted, { field: appointment, since: 1 }], [other]),
    [appointment],
  );
});
test("an open question hides its ask and its value candidates on its case only", () => {
  const input = onCase("V-1042");
  const shown = withheld(input, [appointment]);
  assert.deepEqual(
    shown.fields.map((f) => f.id),
    ["minutes", "search"],
  );
  assert.equal(
    shown.actions.some((a) => a.id.startsWith("field:appointment:")),
    false,
  );
  assert.equal(
    shown.actions.some((a) => a.id === "field:minutes:45"),
    true,
  );
  assert.equal(shown.context, input.context);
  const elsewhere = onCase("V-1039");
  assert.deepEqual(withheld(elsewhere, [appointment]), elsewhere);
});
