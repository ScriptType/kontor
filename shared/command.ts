import { z } from "zod";
import { appointmentSchema } from "./domain.js";
export const objectiveSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("filter"),
    customerId: z.string().nullable(),
    openOnly: z.boolean(),
  }),
  z.object({ kind: z.literal("assign"), technicianId: z.string().nullable() }),
  z.object({
    kind: z.literal("schedule"),
    appointment: appointmentSchema.nullable(),
  }),
  z.object({
    kind: z.literal("time"),
    minutes: z.number().int().positive().max(10000).nullable(),
  }),
  z.object({ kind: z.literal("complete") }),
]);
export const goalSchema = z.object({
  request: z.string(),
  caseId: z.string().nullable(),
  objectives: z.array(objectiveSchema),
  order: z.enum(["flexible", "listed"]),
  supported: z.boolean(),
  persistence: z.enum(["save", "draft", "unclear"]),
});
export type Goal = z.infer<typeof goalSchema>;
export type Objective = z.infer<typeof objectiveSchema>;
export const actionSchema = z.object({
  id: z.string(),
  label: z.string(),
  effect: z.string(),
});
export const decisionInputSchema = z.object({
  request: z.string(),
  context: z.string().max(40000),
  actions: z.array(actionSchema).max(100),
  expectedDemoAction: z.string().nullable(),
  snapshotId: z.string(),
});
export const decisionSchema = z.object({
  snapshotId: z.string(),
  actionId: z.string().nullable(),
});
export type ActionDescription = z.infer<typeof actionSchema>;
export const demos = [
  "Zeige offene Nordwerk-Vorgänge, weise V-1042 Lea Sommer zu und speichere.",
  "Weise die Wartung Lea Sommer zu und speichere.",
  "Erfasse Arbeitszeit für V-1042 und speichere.",
  "Schließe V-1042 ab und erfasse 45 Minuten.",
  "Zuerst V-1042 abschließen, dann 45 Minuten erfassen.",
  "Plane V-1042 am 2026-09-24 um 09:00 für 60 Minuten.",
  "Schließe V-1039 ab.",
  "Plane V-1042 und speichere.",
  "Zeige offene Hafen-Vorgänge, weise V-1042 Lea Sommer zu und speichere.",
] as const;
export function demoGoal(request: string): Goal {
  const base: Goal = {
    request,
    caseId: "V-1042",
    objectives: [],
    order: "flexible",
    supported: true,
    persistence: "save",
  };
  switch (request) {
    case demos[0]:
      return {
        ...base,
        objectives: [
          { kind: "filter", customerId: "nord", openOnly: true },
          { kind: "assign", technicianId: "lea" },
        ],
      };
    case demos[8]:
      return {
        ...base,
        objectives: [
          { kind: "filter", customerId: "hafen", openOnly: true },
          { kind: "assign", technicianId: "lea" },
        ],
      };
    case demos[1]:
      return {
        ...base,
        caseId: null,
        objectives: [{ kind: "assign", technicianId: "lea" }],
      };
    case demos[2]:
      return { ...base, objectives: [{ kind: "time", minutes: null }] };
    case demos[3]:
      return {
        ...base,
        objectives: [{ kind: "complete" }, { kind: "time", minutes: 45 }],
      };
    case demos[4]:
      return {
        ...base,
        order: "listed",
        objectives: [{ kind: "complete" }, { kind: "time", minutes: 45 }],
      };
    case demos[5]:
      return {
        ...base,
        objectives: [
          {
            kind: "schedule",
            appointment: { start: "2026-09-24T09:00:00", minutes: 60 },
          },
        ],
      };
    case demos[7]:
      return { ...base, objectives: [{ kind: "schedule", appointment: null }] };
    case demos[6]:
      return { ...base, caseId: "V-1039", objectives: [{ kind: "complete" }] };
    default:
      return { ...base, caseId: null, supported: false };
  }
}
