import { z } from "zod";
import type { DecisionInput, FieldDescription } from "./command.js";
import {
  appointmentSchema,
  caseFiltersSchema,
  defaultCaseFilters,
  editableSchema,
  pageSchema,
  type CaseDraft,
  type CaseFilters,
  type Workspace,
} from "./domain.js";
import { fieldValues, valueSources } from "./field-values.js";

export const UNSTATED = "unstated";

type EditableField = keyof typeof editableSchema.shape;
type FilterField = keyof typeof caseFiltersSchema.shape;
export type DimensionSource =
  | { schema: "editable"; field: Exclude<EditableField, "appointment"> }
  | {
      schema: "editable";
      field: "appointment";
      key: keyof typeof appointmentSchema.shape;
    }
  | { schema: "filters"; field: FilterField }
  | { schema: "page" };
export type DimensionOption = { value: string; label: string };
type Wording = { question: string; description: string };
type Controls = { menu?: string; option?: string; field?: string };
export type ValueDimension = Wording & {
  kind: "value";
  id: string;
  scope: "case" | "list" | "view";
  source: DimensionSource;
  references?: "technicians" | "customers";
  labels?: Record<string, string>;
  unset?: DimensionOption;
  controls: Controls;
};
export type FlagDimension = Wording & { kind: "flag"; id: string };
export type SetDimension = Wording & { kind: "set"; id: string };
export type Dimension = ValueDimension | FlagDimension | SetDimension;

export const dimensions = [
  {
    kind: "value",
    id: "technician",
    scope: "case",
    source: { schema: "editable", field: "technicianId" },
    references: "technicians",
    controls: { menu: "technician", option: "technician" },
    question: "Which technician should be responsible for the case?",
    description:
      "The technician assigned to the case. Filtering the case list by a person is not an assignment.",
  },
  {
    kind: "value",
    id: "workedMinutes",
    scope: "case",
    source: { schema: "editable", field: "minutes" },
    controls: { field: "minutes" },
    question: "How many minutes of work should be recorded for the case?",
    description:
      "Worked minutes: the time the technician spends or needs on the case. Not the length of the appointment slot, and not a case number.",
  },
  {
    kind: "value",
    id: "appointmentStart",
    scope: "case",
    source: { schema: "editable", field: "appointment", key: "start" },
    unset: { value: "none", label: "Remove the appointment" },
    controls: { field: "appointment" },
    question: "When should the case's appointment start?",
    description:
      "Start date and time of the appointment slot, or removing the appointment.",
  },
  {
    kind: "value",
    id: "appointmentDuration",
    scope: "case",
    source: { schema: "editable", field: "appointment", key: "minutes" },
    controls: { field: "duration" },
    question: "How long should the case's appointment slot be, in minutes?",
    description:
      "Appointment duration: the length of the appointment slot. Not the technician's worked minutes.",
  },
  {
    kind: "value",
    id: "status",
    scope: "case",
    source: { schema: "editable", field: "status" },
    labels: {
      open: "Open (reopen a completed case)",
      done: "Done (complete the case)",
    },
    controls: {},
    question: "Should the case be completed or reopened?",
    description: "The case status: done completes the case, open reopens it.",
  },
  {
    kind: "value",
    id: "priority",
    scope: "case",
    source: { schema: "editable", field: "priority" },
    controls: { option: "priority" },
    question: "Which priority should the case have?",
    description: "The case priority: Hoch is high, Normal is normal.",
  },
  {
    kind: "value",
    id: "customerFilter",
    scope: "list",
    source: { schema: "filters", field: "customerId" },
    references: "customers",
    unset: { value: "all", label: "All customers" },
    controls: { menu: "customer", option: "customer" },
    question: "Which customer should the case list be filtered to?",
    description:
      "Shows only one customer's cases in the case list. Opening the customers view is not a filter.",
  },
  {
    kind: "value",
    id: "technicianFilter",
    scope: "list",
    source: { schema: "filters", field: "technicianId" },
    references: "technicians",
    unset: { value: "all", label: "All technicians" },
    controls: { menu: "filter-technician", option: "filter-technician" },
    question: "Whose cases should the case list show?",
    description:
      "Shows only the cases one technician is responsible for. Assigning a case to a person is not a filter.",
  },
  {
    kind: "value",
    id: "statusFilter",
    scope: "list",
    source: { schema: "filters", field: "status" },
    labels: {
      all: "All statuses",
      open: "Only open cases",
      done: "Only completed cases",
    },
    controls: { option: "filter" },
    question: "Which case status should the case list show?",
    description: "Shows only open or only completed cases, or all again.",
  },
  {
    kind: "value",
    id: "search",
    scope: "list",
    source: { schema: "filters", field: "search" },
    controls: { field: "search" },
    question: "Which text should be typed into the case search?",
    description:
      "Free text typed into the case search box. Customer or person filters are not a search.",
  },
  {
    kind: "value",
    id: "page",
    scope: "view",
    source: { schema: "page" },
    labels: {
      cases: "The case list (Vorgänge)",
      customers: "The customers view (Kunden)",
      team: "The team view (Team)",
      reports: "The reports view (Berichte)",
    },
    controls: { option: "nav" },
    question: "Which view should be shown at the end?",
    description:
      "The visible page. Filtering or opening a single case happens on the case list.",
  },
  {
    kind: "set",
    id: "cases",
    question: "Which cases does the request act on?",
    description:
      "Cases the request opens, edits, assigns, records time for, completes, reopens or saves. A bare number such as 1041 can name case V-1041. Filtering or searching the list is not acting on a case.",
  },
  {
    kind: "flag",
    id: "save",
    question: "Should the changes be saved?",
    description:
      "The requested changes should become persistent, whether the request says so explicitly or asks to change a case.",
  },
  {
    kind: "flag",
    id: "noSave",
    question: "Does the request explicitly say not to save?",
    description:
      "The request asks to keep the change as an unsaved draft, for example 'nicht speichern' or 'nur als Entwurf'.",
  },
  {
    kind: "flag",
    id: "unsupported",
    question: "Does the request also ask for something this app cannot do?",
    description:
      "An extra task outside the case management app, such as sending an e-mail, calling someone, printing or writing an invoice.",
  },
  {
    kind: "flag",
    id: "sequence",
    question:
      "Does the request ask for intermediate states in a specific order?",
    description:
      "An order the end state cannot show: saving one value and changing it again later, or opening several views one after another.",
  },
] as const satisfies readonly Dimension[];

type Catalog = (typeof dimensions)[number];
export type DimensionId = Catalog["id"];
export type CaseDimensionId = Extract<Catalog, { scope: "case" }>["id"];
export type ListDimensionId = Extract<Catalog, { scope: "list" }>["id"];
export type FlagDimensionId = Extract<Catalog, { kind: "flag" }>["id"];

const excludedFields = {
  editable: {
    inspection:
      "Inspection evidence is a user-only observation; Jev never sets it.",
  },
  filters: {},
} satisfies {
  editable: Partial<Record<EditableField, string>>;
  filters: Partial<Record<FilterField, string>>;
};

export function dimension<const Id extends DimensionId>(
  id: Id,
): Extract<Catalog, { id: Id }> {
  const found = dimensions.find(
    (entry): entry is Extract<Catalog, { id: Id }> => entry.id === id,
  );
  if (!found) throw new Error(`Unknown dimension ${id}`);
  return found;
}

function sourceSchema(source: DimensionSource): z.ZodType {
  if (source.schema === "page") return pageSchema;
  if (source.schema === "filters") return caseFiltersSchema.shape[source.field];
  if (source.field === "appointment")
    return editableSchema.shape.appointment.unwrap().shape[source.key];
  return editableSchema.shape[source.field];
}

type ValueDomain =
  | { kind: "enum"; options: readonly string[] }
  | { kind: "number"; min: number; max: number }
  | { kind: "datetime" }
  | { kind: "text" };
function valueDomain(schema: z.ZodType): ValueDomain {
  const inner = schema instanceof z.ZodNullable ? schema.unwrap() : schema;
  if (inner instanceof z.ZodEnum)
    return { kind: "enum", options: inner.options.map(String) };
  if (inner instanceof z.ZodNumber)
    return {
      kind: "number",
      min: inner.minValue ?? Number.MIN_SAFE_INTEGER,
      max: inner.maxValue ?? Number.MAX_SAFE_INTEGER,
    };
  if (inner instanceof z.ZodString)
    return inner.format === "datetime"
      ? { kind: "datetime" }
      : { kind: "text" };
  throw new Error(`No value domain for a ${inner._zod.def.type} schema`);
}

export type ValueContext = {
  workspace: Workspace;
  request: string;
  answers?: DecisionInput["answers"];
  caseId?: string;
};
export function literalField(
  entry: ValueDimension,
  caseId = "",
): FieldDescription | null {
  const domain = valueDomain(sourceSchema(entry.source));
  if (entry.references || domain.kind === "enum" || !entry.controls.field)
    return null;
  return {
    id: entry.controls.field,
    scope: entry.scope === "list" ? "cases" : caseId,
    label: entry.question,
    kind: entry.scope === "list" ? "view" : "draft",
    type:
      domain.kind === "number"
        ? "number"
        : domain.kind === "datetime"
          ? "datetime-local"
          : "text",
    current: "",
    ...(domain.kind === "number" ? { min: domain.min, max: domain.max } : {}),
  };
}
export function dimensionOptions(
  entry: Dimension,
  context: ValueContext,
): DimensionOption[] {
  const { workspace } = context;
  if (entry.kind === "flag")
    return [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];
  if (entry.kind === "set")
    return workspace.cases.map((c) => ({ value: c.id, label: c.title }));
  const unset = entry.unset ? [entry.unset] : [];
  if (entry.references)
    return [
      ...workspace[entry.references].map((row) => ({
        value: row.id,
        label: row.name,
      })),
      ...unset,
    ];
  const domain = valueDomain(sourceSchema(entry.source));
  if (domain.kind === "enum")
    return [
      ...domain.options.map((value) => ({
        value,
        label: entry.labels?.[value] ?? value,
      })),
      ...unset,
    ];
  const field = literalField(entry, context.caseId);
  const literals = field
    ? fieldValues(
        field,
        context.request,
        context.answers ?? [],
        existingValues(workspace),
      ).map(({ value, source }) => ({
        value,
        label: valueSources[source].de,
      }))
    : [];
  return [...literals, ...unset];
}
function existingValues(workspace: Workspace) {
  return [
    ...workspace.cases.flatMap((c) => [c.id, c.title]),
    ...workspace.customers.map((c) => c.name),
  ];
}

export function withCaseValue(
  id: CaseDimensionId,
  draft: CaseDraft,
  value: string,
): CaseDraft | null {
  const entry = dimension(id);
  const { source } = entry;
  if (source.field === "appointment") {
    if (source.key === "start") {
      if (value === dimension("appointmentStart").unset.value)
        return { ...draft, appointment: null };
      const start = appointmentSchema.shape.start.safeParse(`${value}:00`);
      return start.success
        ? {
            ...draft,
            appointment: {
              start: start.data,
              minutes: draft.appointment?.minutes ?? 60,
            },
          }
        : null;
    }
    const minutes = appointmentSchema.shape.minutes.safeParse(Number(value));
    return draft.appointment && minutes.success
      ? {
          ...draft,
          appointment: { ...draft.appointment, minutes: minutes.data },
        }
      : null;
  }
  const schema = editableSchema.shape[source.field];
  const parsed = schema.safeParse(
    valueDomain(schema).kind === "number" ? Number(value) : value,
  );
  return parsed.success ? { ...draft, [source.field]: parsed.data } : null;
}
const unsetValue = (entry: ValueDimension) => entry.unset?.value;
export function filterValue(id: ListDimensionId, filters: CaseFilters) {
  const entry = dimension(id);
  const value = filters[entry.source.field];
  return value === null ? (unsetValue(entry) ?? "") : value;
}
export function withFilterValue(
  id: ListDimensionId,
  filters: CaseFilters,
  value: string,
): CaseFilters | null {
  const entry = dimension(id);
  const field = entry.source.field;
  const parsed = caseFiltersSchema.shape[field].safeParse(
    value === unsetValue(entry) ? null : value,
  );
  return parsed.success ? { ...filters, [field]: parsed.data } : null;
}

export type ActionEffect = { dimension: DimensionId; value: string | null };
const listDimensions = dimensions.filter(
  (entry): entry is Extract<Catalog, { scope: "list" }> =>
    "scope" in entry && entry.scope === "list",
);
const showFilters = (filters: CaseFilters): ActionEffect[] =>
  listDimensions.map((entry) => ({
    dimension: entry.id,
    value: filterValue(entry.id, filters),
  }));
const showCases = (filters: CaseFilters | null): ActionEffect[] | null =>
  filters && [...showFilters(filters), { dimension: "page", value: "cases" }];
const explicitActions: Record<string, ActionEffect[]> = {
  "filter:reset": showFilters(defaultCaseFilters),
  close: [],
  discard: [],
  save: [{ dimension: "save", value: "yes" }],
  complete: [{ dimension: "status", value: "done" }],
  reopen: [{ dimension: "status", value: "open" }],
  "remove-appointment": [
    {
      dimension: "appointmentStart",
      value: dimension("appointmentStart").unset.value,
    },
  ],
};
const explicitPrefixes: Record<
  string,
  (value: string) => ActionEffect[] | null
> = {
  case: (id) => [
    { dimension: "cases", value: id },
    { dimension: "page", value: "cases" },
  ],
  "customer-cases": (id) =>
    showCases({ ...defaultCaseFilters, customerId: id }),
  "technician-cases": (id) =>
    showCases({ ...defaultCaseFilters, technicianId: id, status: "open" }),
  "status-cases": (status) =>
    showCases(withFilterValue("statusFilter", defaultCaseFilters, status)),
};
function byControl(control: keyof Controls, name: string) {
  return dimensions.find((entry) => {
    const controls: Controls = "controls" in entry ? entry.controls : {};
    return controls[control] === name;
  });
}
export function actionEffects(actionId: string): ActionEffect[] | null {
  const explicit = explicitActions[actionId];
  if (explicit) return explicit;
  const [head = "", ...rest] = actionId.split(":");
  if (!rest.length) return null;
  const tail = rest.join(":");
  const prefix = explicitPrefixes[head];
  if (prefix) return prefix(tail);
  if (head === "field" || head === "ask") {
    const [field = "", ...value] = rest;
    const entry = byControl("field", field);
    return entry
      ? [
          {
            dimension: entry.id,
            value: head === "ask" ? null : value.join(":"),
          },
        ]
      : null;
  }
  const entry = byControl(
    head === "menu" ? "menu" : "option",
    head === "menu" ? tail : head,
  );
  return entry
    ? [{ dimension: entry.id, value: head === "menu" ? null : tail }]
    : null;
}

type Shape = Record<string, z.ZodType>;
export function coverageProblems(
  shapes: { editable: Shape; filters: Shape } = {
    editable: editableSchema.shape,
    filters: caseFiltersSchema.shape,
  },
): string[] {
  const schemaNames = {
    editable: "editableSchema (shared/domain.ts)",
    filters: "caseFiltersSchema (shared/domain.ts)",
  };
  const problems: string[] = [];
  for (const schema of ["editable", "filters"] as const)
    for (const [field, fieldSchema] of Object.entries(shapes[schema])) {
      const covering = dimensions.filter(
        (entry) =>
          "source" in entry &&
          entry.source.schema === schema &&
          entry.source.field === field,
      );
      const excluded: Record<string, string> = excludedFields[schema];
      if (!covering.length && !(field in excluded))
        problems.push(
          `${schemaNames[schema]} field "${field}" has no dimension. Add an entry with source { schema: "${schema}", field: "${field}" } to dimensions in shared/dimensions.ts, or add "${field}" with a reason to excludedFields.${schema}.`,
        );
      if (
        covering.length &&
        fieldSchema instanceof z.ZodNullable &&
        !covering.some((entry) => "unset" in entry)
      )
        problems.push(
          `${schemaNames[schema]} field "${field}" is nullable, but none of its dimensions (${covering.map((entry) => entry.id).join(", ")}) says what null means. Add unset: { value, label } to one of them.`,
        );
    }
  return problems;
}
