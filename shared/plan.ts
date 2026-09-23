import { z } from "zod";
import { caseFiltersSchema, pageSchema, type Page } from "./domain.js";
import { caseDimensions, listDimensions } from "./intent.js";

/** A plan value the request does not state: the run has to ask the user for it. */
export const ASK = "__ask";

const caseValuesSchema = z.partialRecord(z.enum(caseDimensions), z.string());
/** The whole request read up front: the end values per case, filters and views. */
export const planSchema = z.object({
  segments: z.array(z.string()),
  cases: z.record(z.string(), caseValuesSchema),
  /** Saved intermediate states per case, when the request orders them. */
  sequence: z.record(z.string(), z.array(caseValuesSchema)),
  filters: z.partialRecord(z.enum(listDimensions), z.string()),
  visits: z.array(pageSchema),
  flags: z.object({ noSave: z.boolean(), unsupported: z.boolean() }),
});
export type Plan = z.infer<typeof planSchema>;

export const planInputSchema = z.object({
  request: z.string().max(20000),
  page: pageSchema,
  filters: caseFiltersSchema,
  selectedCase: z.string().nullable(),
});
export type PlanInput = z.infer<typeof planInputSchema>;

/** The planned views in order, a repeated view counted once. */
export function planVisits(plan: Pick<Plan, "visits">): Page[] {
  return plan.visits.filter((page, i) => page !== plan.visits[i - 1]);
}
