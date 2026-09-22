import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  actionEffects,
  coverageProblems,
  dimension,
  dimensionOptions,
  withCaseValue,
} from "../shared/dimensions.js";
import {
  caseFiltersSchema,
  caseSchema,
  defaultCaseFilters,
  draftOf,
  editableSchema,
  pageSchema,
  seedWorkspace,
} from "../shared/domain.js";

const workspace = seedWorkspace();
const values = (
  id: Parameters<typeof dimension>[0],
  request = "",
  extra: Partial<Parameters<typeof dimensionOptions>[1]> = {},
) =>
  dimensionOptions(dimension(id), { workspace, request, ...extra }).map(
    (option) => option.value,
  );

test("every editable and filter field has a dimension or a stated exclusion", () => {
  assert.deepEqual(coverageProblems(), []);
});
test("a new schema field without a dimension fails with a message naming the field", () => {
  const problems = coverageProblems({
    editable: editableSchema.extend({ travelMinutes: z.number() }).shape,
    filters: caseFiltersSchema.extend({ site: z.string().nullable() }).shape,
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0] ?? "", /editableSchema .*field "travelMinutes"/);
  assert.match(problems[1] ?? "", /caseFiltersSchema .*field "site"/);
});
test("a nullable field needs a dimension that says what null means", () => {
  const problems = coverageProblems({
    editable: editableSchema.shape,
    filters: caseFiltersSchema.extend({ search: z.string().nullable() }).shape,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /field "search" is nullable/);
});
test("enum and page values come from the zod schemas", () => {
  assert.deepEqual(values("priority"), caseSchema.shape.priority.options);
  assert.deepEqual(values("status"), caseSchema.shape.status.options);
  assert.deepEqual(values("statusFilter"), ["all", "open", "done"]);
  assert.deepEqual(values("page"), pageSchema.options);
});
test("foreign-key values come from workspace data, with the null meaning appended", () => {
  const extended = {
    ...workspace,
    technicians: [
      ...workspace.technicians,
      { id: "ida", name: "Ida Brandt", skills: ["Service"] },
    ],
  };
  assert.deepEqual(
    dimensionOptions(dimension("technician"), {
      workspace: extended,
      request: "",
    }).map((option) => option.value),
    ["lea", "jonas", "mara", "ida"],
  );
  assert.deepEqual(values("customerFilter"), [
    "nord",
    "hafen",
    "linden",
    "all",
  ]);
  assert.deepEqual(
    values("cases"),
    workspace.cases.map((c) => c.id),
  );
});
test("number values are literal candidates within the schema bounds, never an identifier's digits", () => {
  const request =
    "Ändere 1041 auf Mara. 60 Minuten, nicht 20000 und nicht 10 Minuten.";
  const minutes = dimensionOptions(dimension("workedMinutes"), {
    workspace,
    request,
  });
  assert.deepEqual(
    minutes.map((option) => option.value),
    ["60", "10"],
  );
  assert.equal(minutes[0]?.label, "wörtliche Zahl aus Auftrag");
  assert.deepEqual(values("appointmentDuration", request), []);
  assert.deepEqual(values("appointmentDuration", "Termin 60 Minuten"), ["60"]);
});
test("an explicit answer is a candidate only for its own case", () => {
  const answers = [{ fieldId: "minutes", scope: "V-1042", value: "45" }];
  assert.deepEqual(
    values("workedMinutes", "Erfasse Arbeitszeit", {
      answers,
      caseId: "V-1042",
    }),
    ["45"],
  );
  assert.deepEqual(
    values("workedMinutes", "Erfasse Arbeitszeit", {
      answers,
      caseId: "V-1041",
    }),
    [],
  );
});
test("datetime and text values are literal candidates", () => {
  assert.deepEqual(values("appointmentStart", "Termin am 2026-09-25 10:00"), [
    "2026-09-25T10:00",
    "none",
  ]);
  assert.deepEqual(values("search", 'Suche nach "Wartung"'), ["Wartung"]);
});
test("writing a case value follows the UI's appointment rules", () => {
  const plain = draftOf(workspace.cases[0]!);
  const scheduled = draftOf(workspace.cases[1]!);
  assert.deepEqual(
    withCaseValue("appointmentStart", plain, "2026-09-25T10:00")?.appointment,
    { start: "2026-09-25T10:00:00", minutes: 60 },
  );
  assert.equal(withCaseValue("appointmentDuration", plain, "90"), null);
  assert.deepEqual(
    withCaseValue("appointmentDuration", scheduled, "90")?.appointment,
    { start: "2026-09-24T09:00:00", minutes: 90 },
  );
  assert.equal(
    withCaseValue("appointmentStart", scheduled, "none")?.appointment,
    null,
  );
  assert.equal(withCaseValue("workedMinutes", plain, "60")?.minutes, 60);
  assert.equal(withCaseValue("workedMinutes", plain, "20000"), null);
  assert.equal(withCaseValue("priority", plain, "Dringend"), null);
});
test("action ids map to dimensions through their grammar", () => {
  const cases: [string, ReturnType<typeof actionEffects>][] = [
    ["technician:lea", [{ dimension: "technician", value: "lea" }]],
    ["menu:technician", [{ dimension: "technician", value: null }]],
    [
      "menu:filter-technician",
      [{ dimension: "technicianFilter", value: null }],
    ],
    [
      "filter-technician:all",
      [{ dimension: "technicianFilter", value: "all" }],
    ],
    ["customer:nord", [{ dimension: "customerFilter", value: "nord" }]],
    ["filter:open", [{ dimension: "statusFilter", value: "open" }]],
    ["priority:Hoch", [{ dimension: "priority", value: "Hoch" }]],
    ["nav:reports", [{ dimension: "page", value: "reports" }]],
    ["field:minutes:60", [{ dimension: "workedMinutes", value: "60" }]],
    ["field:duration:90", [{ dimension: "appointmentDuration", value: "90" }]],
    [
      "field:appointment:2026-09-25T10:00",
      [{ dimension: "appointmentStart", value: "2026-09-25T10:00" }],
    ],
    ["ask:minutes", [{ dimension: "workedMinutes", value: null }]],
    [
      "case:V-1041",
      [
        { dimension: "cases", value: "V-1041" },
        { dimension: "page", value: "cases" },
      ],
    ],
    ["complete", [{ dimension: "status", value: "done" }]],
    ["remove-appointment", [{ dimension: "appointmentStart", value: "none" }]],
    ["save", [{ dimension: "save", value: "yes" }]],
    ["close", []],
    ["status-cases:bogus", null],
    ["unknown:x", null],
    ["unknown", null],
  ];
  for (const [id, effects] of cases)
    assert.deepEqual(actionEffects(id), effects, id);
});
test("list shortcuts and reset replace every filter", () => {
  assert.deepEqual(actionEffects("filter:reset"), [
    { dimension: "customerFilter", value: "all" },
    { dimension: "technicianFilter", value: "all" },
    { dimension: "statusFilter", value: "all" },
    { dimension: "search", value: defaultCaseFilters.search },
  ]);
  assert.deepEqual(actionEffects("technician-cases:lea"), [
    { dimension: "customerFilter", value: "all" },
    { dimension: "technicianFilter", value: "lea" },
    { dimension: "statusFilter", value: "open" },
    { dimension: "search", value: "" },
    { dimension: "page", value: "cases" },
  ]);
});
test("worked minutes and appointment duration carry the product meaning", () => {
  assert.match(
    dimension("workedMinutes").description,
    /spends or needs on the case.*Not the length of the appointment slot/,
  );
  assert.match(
    dimension("appointmentDuration").description,
    /length of the appointment slot.*Not the technician's worked minutes/,
  );
});
