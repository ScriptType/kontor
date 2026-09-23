import { z } from "zod";
import { actionEffects, dimensions } from "./dimensions.js";
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

/** Noted questions that no answer since their note covers, oldest first, one per field and scope. */
export function openQuestions(
  noted: readonly NotedQuestion[],
  answers: DecisionInput["answers"],
): FieldDescription[] {
  const open: FieldDescription[] = [];
  for (const { field, since } of noted) {
    const answered = answers
      .slice(since)
      .some((a) => a.fieldId === field.id && a.scope === field.scope);
    if (
      !answered &&
      !open.some((o) => o.id === field.id && o.scope === field.scope)
    )
      open.push(field);
  }
  return open;
}

const selectedSchema = z.object({
  selected: z.object({ id: z.string() }).optional(),
});
function selectedCase(context: string) {
  try {
    return selectedSchema.parse(JSON.parse(context)).selected?.id ?? null;
  } catch {
    return null;
  }
}
/**
 * Whether a choice stays inside the question's item: an offered action that
 * only changes or opens other values of the asked case's draft (for a list
 * question: only list filters), or asks for another field there.
 */
function inside(
  question: FieldDescription,
  choice: string,
  input: Pick<DecisionInput, "actions" | "fields" | "context">,
) {
  if (choice.startsWith("ask:"))
    return input.fields.some(
      (field) =>
        `ask:${field.id}` === choice &&
        field.id !== question.id &&
        field.scope === question.scope,
    );
  const effects = input.actions.some((action) => action.id === choice)
    ? actionEffects(choice)
    : null;
  const scope = question.kind === "view" ? "list" : "case";
  if (
    !effects?.length ||
    (scope === "case" && selectedCase(input.context) !== question.scope)
  )
    return false;
  const asked = actionEffects(`ask:${question.id}`)?.[0]?.dimension;
  return effects.every(
    ({ dimension: id }) =>
      id !== asked &&
      dimensions.some(
        (entry) => entry.id === id && "scope" in entry && entry.scope === scope,
      ),
  );
}
/**
 * The open question this choice may not pass, oldest first: saving, leaving
 * the item, finishing and anything unknown wait for the answer.
 */
export function dueQuestion(
  open: readonly FieldDescription[],
  choice: string,
  input: Pick<DecisionInput, "actions" | "fields" | "context">,
): FieldDescription | null {
  return open.find((question) => !inside(question, choice, input)) ?? null;
}

/**
 * The input without the ask option and the value candidates of each open
 * question's field, so Jev neither asks again nor picks a value it asked for.
 */
export function withheld<T extends Pick<DecisionInput, "actions" | "fields">>(
  input: T,
  open: readonly FieldDescription[],
): T {
  const locked = input.fields.filter((field) =>
    open.some((q) => q.id === field.id && q.scope === field.scope),
  );
  return {
    ...input,
    fields: input.fields.filter((field) => !locked.includes(field)),
    actions: input.actions.filter(
      (action) =>
        !locked.some((field) => action.id.startsWith(`field:${field.id}:`)),
    ),
  };
}
