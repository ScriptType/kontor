import { z } from "zod";

export const appointmentSchema = z.object({
  start: z.string().datetime({ local: true }),
  minutes: z.number().int().min(15).max(480),
});
export const caseSchema = z.object({
  id: z.string(),
  title: z.string(),
  customerId: z.string(),
  site: z.string(),
  skill: z.string(),
  technicianId: z.string(),
  status: z.enum(["open", "done"]),
  minutes: z.number().int().min(0).max(10000),
  appointment: appointmentSchema.nullable(),
  inspection: z
    .object({ note: z.string().min(5), by: z.literal("user") })
    .nullable(),
  requiresInspection: z.boolean(),
  priority: z.enum(["Hoch", "Normal"]),
});
export const workspaceSchema = z.object({
  revision: z.number().int().nonnegative(),
  customers: z.array(
    z.object({ id: z.string(), name: z.string(), contact: z.string() }),
  ),
  technicians: z.array(
    z.object({ id: z.string(), name: z.string(), skills: z.array(z.string()) }),
  ),
  cases: z.array(caseSchema),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export type ServiceCase = z.infer<typeof caseSchema>;
export const editableSchema = caseSchema.pick({
  technicianId: true,
  minutes: true,
  appointment: true,
  status: true,
  inspection: true,
  priority: true,
});
export type CaseDraft = z.infer<typeof editableSchema>;
export function draftOf(value: ServiceCase): CaseDraft {
  return editableSchema.parse(value);
}
export const pageSchema = z.enum(["cases", "customers", "team", "reports"]);
export type Page = z.infer<typeof pageSchema>;
export const caseFiltersSchema = z.object({
  customerId: z.string().nullable(),
  technicianId: z.string().nullable(),
  status: z.enum(["all", ...caseSchema.shape.status.options]),
  search: z.string(),
});
export type CaseFilters = Readonly<z.infer<typeof caseFiltersSchema>>;
export const defaultCaseFilters: CaseFilters = {
  customerId: null,
  technicianId: null,
  status: "all",
  search: "",
};
export const saveSchema = z.object({
  operationId: z.string().uuid(),
  revision: z.number().int(),
  caseId: z.string(),
  draft: editableSchema,
  actor: z.enum(["manual", "jev"]),
});
export const receiptSchema = z.object({
  operationId: z.string(),
  caseId: z.string(),
  revision: z.number(),
  saved: caseSchema,
});
export type Save = z.infer<typeof saveSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export const blockerSchema = z.object({
  kind: z.enum(["time", "evidence", "conflict", "qualification"]),
  message: z.string(),
  alternatives: z.array(z.string()),
});
export type Blocker = z.infer<typeof blockerSchema>;
export function overlaps(
  a: NonNullable<ServiceCase["appointment"]>,
  b: NonNullable<ServiceCase["appointment"]>,
) {
  const startA = Date.parse(a.start),
    startB = Date.parse(b.start);
  return (
    startA < startB + b.minutes * 60000 && startB < startA + a.minutes * 60000
  );
}
export type Availability =
  | { kind: "available"; at: ServiceCase["appointment"] }
  | { kind: "unqualified"; skill: string }
  | { kind: "busy"; cases: string[] };
function busyWith(
  workspace: Workspace,
  value: ServiceCase,
  technicianId: string,
) {
  const appointment = value.appointment;
  return appointment
    ? workspace.cases
        .filter(
          (c) =>
            c.id !== value.id &&
            c.status === "open" &&
            c.technicianId === technicianId &&
            c.appointment &&
            overlaps(appointment, c.appointment),
        )
        .map((c) => c.id)
    : [];
}
export function availability(
  workspace: Workspace,
  value: ServiceCase,
  technicianId: string,
): Availability {
  const technician = workspace.technicians.find((t) => t.id === technicianId);
  if (!technician?.skills.includes(value.skill))
    return { kind: "unqualified", skill: value.skill };
  const cases = busyWith(workspace, value, technicianId);
  return cases.length
    ? { kind: "busy", cases }
    : { kind: "available", at: value.appointment };
}
export function blockers(workspace: Workspace, value: ServiceCase): Blocker[] {
  const result: Blocker[] = [];
  const technician = workspace.technicians.find(
    (t) => t.id === value.technicianId,
  );
  const alternatives = (fits: (a: Availability) => boolean) =>
    workspace.technicians
      .filter((t) => fits(availability(workspace, value, t.id)))
      .map((t) => t.id);
  if (availability(workspace, value, value.technicianId).kind === "unqualified")
    result.push({
      kind: "qualification",
      message:
        "Die zuständige Person benötigt die Qualifikation " + value.skill + ".",
      alternatives: alternatives((a) => a.kind !== "unqualified"),
    });
  const conflicts = busyWith(workspace, value, value.technicianId);
  if (conflicts.length)
    result.push({
      kind: "conflict",
      message: `${technician?.name} ist durch ${conflicts.join(", ")} belegt.`,
      alternatives: alternatives((a) => a.kind === "available"),
    });
  if (value.status === "done") {
    if (value.minutes === 0)
      result.push({
        kind: "time",
        message:
          "Vor dem Abschluss muss die tatsächlich geleistete Arbeitszeit erfasst sein.",
        alternatives: [],
      });
    if (value.requiresInspection && !value.inspection)
      result.push({
        kind: "evidence",
        message:
          "Die Prüfung vor Ort ist nicht belegt. Nur eine tatsächliche Beobachtung der Benutzerin oder des Benutzers kann dies bestätigen.",
        alternatives: [],
      });
  }
  return result;
}
export function seedWorkspace(): Workspace {
  return workspaceSchema.parse({
    revision: 0,
    customers: [
      { id: "nord", name: "Nordwerk GmbH", contact: "Mia Hansen · Einkauf" },
      {
        id: "hafen",
        name: "Hafen & Partner",
        contact: "Paul Friedrich · Verwaltung",
      },
      { id: "linden", name: "Lindenwerk AG", contact: "Emil Bauer · Betrieb" },
    ],
    technicians: [
      { id: "lea", name: "Lea Sommer", skills: ["Elektro", "Service"] },
      { id: "jonas", name: "Jonas Weber", skills: ["Elektro", "Service"] },
      { id: "mara", name: "Mara Schulz", skills: ["Service"] },
    ],
    cases: [
      {
        id: "V-1042",
        title: "Wartung Standort Nord",
        customerId: "nord",
        site: "Hamburg · Halle A",
        skill: "Elektro",
        technicianId: "jonas",
        status: "open",
        minutes: 0,
        appointment: null,
        inspection: null,
        requiresInspection: false,
        priority: "Hoch",
      },
      {
        id: "V-1041",
        title: "Zugang für Einkauf einrichten",
        customerId: "hafen",
        site: "Bremen · Büro",
        skill: "Service",
        technicianId: "jonas",
        status: "open",
        minutes: 45,
        appointment: { start: "2026-09-24T09:00:00", minutes: 120 },
        inspection: null,
        requiresInspection: false,
        priority: "Normal",
      },
      {
        id: "V-1039",
        title: "Wartung Standort Süd",
        customerId: "nord",
        site: "Hamburg · Halle B",
        skill: "Elektro",
        technicianId: "lea",
        status: "open",
        minutes: 30,
        appointment: null,
        inspection: null,
        requiresInspection: true,
        priority: "Hoch",
      },
      {
        id: "V-1037",
        title: "Rückfrage zur Jahresrechnung",
        customerId: "linden",
        site: "Kiel · Zentrale",
        skill: "Service",
        technicianId: "mara",
        status: "open",
        minutes: 20,
        appointment: null,
        inspection: null,
        requiresInspection: false,
        priority: "Normal",
      },
      {
        id: "V-1035",
        title: "Onboarding vorbereiten",
        customerId: "hafen",
        site: "Bremen · Büro",
        skill: "Service",
        technicianId: "mara",
        status: "done",
        minutes: 90,
        appointment: null,
        inspection: null,
        requiresInspection: false,
        priority: "Normal",
      },
    ],
  });
}
