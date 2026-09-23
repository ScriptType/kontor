import { oc } from "@orpc/contract";
import { z } from "zod";

import { workspaceSchema, saveSchema, receiptSchema } from "./domain.js";
import {
  decisionInputSchema,
  decisionSchema,
  assessmentInputSchema,
  assessmentSchema,
} from "./command.js";
import { planInputSchema, planSchema } from "./plan.js";
import { readInputSchema, valueReadingSchema } from "./value-reading.js";

const probability = z.number().min(0).max(1);
export const evaluationInputSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
});
export const answersSchema = z.object({
  category: z.object({
    type: z.literal("choice"),
    choice: z.enum(["statement", "question", "request"]),
    confidence: probability,
    probabilities: z.object({
      statement: probability,
      question: probability,
      request: probability,
    }),
  }),
  clarity: z.object({
    type: z.literal("score"),
    score: z.number().min(0).max(2),
    confidence: probability,
    probabilities: z.object({
      "0": probability,
      "1": probability,
      "2": probability,
    }),
  }),
  containsAction: z.object({ type: z.literal("noul"), noul: probability }),
});
export const sourceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("demo"), model: z.null() }),
  z.object({ mode: z.literal("live"), model: z.string().min(1) }),
]);
export const evaluationSchema = z.discriminatedUnion("mode", [
  sourceSchema.options[0].extend({ answers: answersSchema }),
  sourceSchema.options[1].extend({ answers: answersSchema }),
]);
export const contract = {
  workspace: oc.output(workspaceSchema),
  resetWorkspace: oc
    .input(z.object({ expectedRevision: z.number().int().nonnegative() }))
    .output(workspaceSchema),
  saveCase: oc.input(saveSchema).output(receiptSchema),
  receipt: oc
    .input(z.object({ operationId: z.string() }))
    .output(receiptSchema.nullable()),
  assess: oc.input(assessmentInputSchema).output(assessmentSchema),
  decide: oc.input(decisionInputSchema).output(decisionSchema),
  plan: oc.input(planInputSchema).output(planSchema.nullable()),
  /** Each field's new value read from the request; null without a live model. */
  readValues: oc
    .input(readInputSchema)
    .output(z.array(valueReadingSchema.nullable()).nullable()),
  status: oc.output(sourceSchema),
  evaluate: oc
    .input(evaluationInputSchema)
    .output(evaluationSchema)
    .errors({
      PROVIDER_UNAVAILABLE: {
        message:
          "TypeSafe ist gerade nicht erreichbar. Bitte erneut versuchen.",
      },
      PROVIDER_INVALID_RESPONSE: {
        message:
          "TypeSafe hat eine ungültige Antwort geliefert. Bitte erneut versuchen.",
      },
    }),
};
export type EvaluationInput = z.output<typeof evaluationInputSchema>;
export type Evaluation = z.output<typeof evaluationSchema>;
export type Source = z.output<typeof sourceSchema>;
