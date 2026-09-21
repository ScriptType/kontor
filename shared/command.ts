import { z } from "zod";
import { blockerSchema } from "./domain.js";
export const actionSchema = z.object({
  id: z.string(),
  label: z.string(),
  effect: z.string(),
  kind: z.enum(["view", "draft", "commit", "discard"]),
});
export const blockedControlSchema = z.object({
  action: actionSchema,
  target: z.object({ kind: z.literal("case"), id: z.string() }),
  reasons: z.array(blockerSchema).min(1),
});
export const fieldSchema = z.object({
  id: z.string(),
  scope: z.string(),
  label: z.string(),
  kind: z.enum(["view", "draft"]),
  type: z.enum(["text", "number", "datetime-local"]),
  current: z.string(),
  min: z.number().optional(),
  max: z.number().optional(),
});
export const answerSchema = z.object({
  fieldId: z.string(),
  scope: z.string(),
  value: z.string(),
});
export const stepSchema = z.object({
  snapshotId: z.string(),
  action: actionSchema,
  authorizedBy: z.enum(["request", "user"]).default("request"),
  outcome: z.enum(["changed", "unchanged", "unknown"]).default("unknown"),
  before: z.string(),
  after: z.string(),
});
export const decisionInputSchema = z.object({
  request: z.string().max(20000),
  snapshotId: z.string(),
  context: z.string().max(40000),
  actions: z.array(actionSchema).max(100),
  fields: z.array(fieldSchema).max(30),
  blockedControls: z.array(blockedControlSchema).max(100),
  answers: z.array(answerSchema).max(100),
  steps: z.array(stepSchema).max(60),
});
export const decisionSchema = z.object({
  snapshotId: z.string(),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  ranked: z
    .array(
      z.object({ choice: z.string(), probability: z.number().min(0).max(1) }),
    )
    .length(2),
  blockedCause: z
    .object({ controlId: z.string(), confidence: z.number().min(0).max(1) })
    .optional(),
});
export type Decision = z.infer<typeof decisionSchema>;
export const assessmentInputSchema = decisionInputSchema.extend({
  selected: z.union([actionSchema, z.literal("done")]),
});
export const assessmentSchema = z.object({
  snapshotId: z.string(),
  verdict: z.enum([
    "authorized",
    "additional",
    "forbidden",
    "complete",
    "outstanding",
    "unclear",
  ]),
  confidence: z.number().min(0).max(1),
});
export type Assessment = z.infer<typeof assessmentSchema>;
export type ActionDescription = z.infer<typeof actionSchema>;
export type BlockedControl = z.infer<typeof blockedControlSchema>;
export type FieldDescription = z.infer<typeof fieldSchema>;
export type DecisionInput = z.infer<typeof decisionInputSchema>;
export const demos = [
  "Zeig mir die Kunden.",
  "Zeige zuerst Kunden, danach Berichte und zuletzt Team.",
  "Weise V-1042 Lea Sommer zu und speichere.",
  "Erfasse 45 Minuten für V-1042 und speichere.",
  "Erfasse Arbeitszeit für V-1042 und speichere.",
] as const;
