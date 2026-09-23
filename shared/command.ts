import { z } from "zod";
import { blockerSchema } from "./domain.js";
import { valueSourceSchema } from "./field-values.js";
import { requestHintsSchema } from "./request-hints.js";
export const jevTextSchema = z.object({
  does: z.string().min(1),
  now: z.string().optional(),
  reveals: z.string().optional(),
  notFor: z.string().optional(),
});
export const actionSchema = z.object({
  id: z.string(),
  label: z.string(),
  effect: z.string(),
  kind: z.enum(["view", "draft", "commit", "discard"]),
  jev: jevTextSchema,
  /** Field candidates only: where the value comes from; never sent to Jev. */
  value: z.object({ source: valueSourceSchema, bound: z.boolean() }).optional(),
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
  jev: z.object({ name: z.string().min(1), notFor: z.string().optional() }),
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
  /** Gate setting filled by the runner; never part of the model context. */
  doneBeforeFirstStep: z.boolean().default(true),
  /**
   * Gate setting: lean sends Jev a compact step log instead of snapshots,
   * leanDecide does so for decide only and keeps the full state for assess.
   */
  state: z.enum(["full", "lean", "leanDecide"]).default("full"),
  /**
   * Gate setting: focused drops the duplicate action list from decide, adds
   * request hints and repeats the request at the end of the state; compact
   * also drops snapshot ids and viewport details and shortens option texts.
   */
  prompt: z.enum(["full", "focused", "compact"]).default("full"),
  /** Filled by the runner for a focused or compact prompt. */
  hints: requestHintsSchema.optional(),
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
  /** Every offered option with its probability; ranked keeps the top two. */
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
  blockedCause: z
    .object({ controlId: z.string(), confidence: z.number().min(0).max(1) })
    .optional(),
});
export type Decision = z.infer<typeof decisionSchema>;
export const assessmentInputSchema = decisionInputSchema.extend({
  selected: z.union([actionSchema, z.literal("done")]),
});
const verdictSchema = z.enum([
  "authorized",
  "additional",
  "forbidden",
  "complete",
  "outstanding",
  "unclear",
]);
export const assessmentSchema = z.object({
  snapshotId: z.string(),
  verdict: verdictSchema,
  confidence: z.number().min(0).max(1),
  probabilities: z.partialRecord(verdictSchema, z.number().min(0).max(1)),
});
export type Assessment = z.infer<typeof assessmentSchema>;
export type ActionDescription = z.infer<typeof actionSchema>;
export type JevText = z.infer<typeof jevTextSchema>;
const defaultReveals: Partial<Record<ActionDescription["kind"], string>> = {
  view: "View only; changes no case data",
  draft: "Changes only the unsaved draft; nothing is saved until save",
};
export function renderJev({ does, now, reveals, notFor }: JevText) {
  return [does, now && `Now: ${now}`, reveals, notFor && `Not for: ${notFor}`]
    .filter(Boolean)
    .join(". ");
}
export function jevText(action: Pick<ActionDescription, "kind" | "jev">) {
  return renderJev({
    ...action.jev,
    reveals: action.jev.reveals ?? defaultReveals[action.kind],
  });
}
export function jevAction(action: ActionDescription) {
  return {
    id: action.id,
    label: action.label,
    effect: jevText(action),
    kind: action.kind,
  };
}
export function jevBlockedControl(control: BlockedControl) {
  return { ...control, action: jevAction(control.action) };
}
export function jevFieldName(field: FieldDescription) {
  return `${field.jev.name}${field.kind === "draft" ? ` of case ${field.scope}` : ""}`;
}
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
