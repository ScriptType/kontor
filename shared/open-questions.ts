import { z } from "zod";
import {
  fieldSchema,
  type DecisionInput,
  type FieldDescription,
} from "./command.js";

/** A question Jev chose to ask, noted at `since` = the number of answers then. */
export const notedQuestionSchema = z.object({
  field: fieldSchema,
  since: z.number().int().nonnegative(),
});
export type NotedQuestion = z.infer<typeof notedQuestionSchema>;

export function openQuestions(
  _noted: readonly NotedQuestion[],
  _answers: DecisionInput["answers"],
): FieldDescription[] {
  throw new Error("not implemented");
}

export function dueQuestion(
  _open: readonly FieldDescription[],
  _choice: string,
  _input: Pick<DecisionInput, "actions" | "fields" | "context">,
): FieldDescription | null {
  throw new Error("not implemented");
}

export function withheld<T extends Pick<DecisionInput, "actions" | "fields">>(
  _input: T,
  _open: readonly FieldDescription[],
): T {
  throw new Error("not implemented");
}
