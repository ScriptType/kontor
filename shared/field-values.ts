import { appointmentSchema } from "./domain.js";
import type { DecisionInput, FieldDescription } from "./command.js";
export const valueSources = {
  answer: {
    de: "aus ausdrücklicher Antwort",
    en: "explicit answer from the user",
  },
  number: {
    de: "wörtliche Zahl aus Auftrag",
    en: "literal number from the request",
  },
  dateTime: {
    de: "zusammenhängender Datum-Uhrzeit-Wert aus Auftrag",
    en: "date and time taken from the request",
  },
  quote: {
    de: "zitierter Text aus Auftrag",
    en: "quoted text from the request",
  },
  existing: {
    de: "vorhandener Datenwert im Auftrag",
    en: "existing data value named in the request",
  },
} as const satisfies Record<string, { de: string; en: string }>;
export type ValueSource = keyof typeof valueSources;
export function fieldValues(
  field: FieldDescription,
  request: string,
  answers: DecisionInput["answers"],
  existing: string[],
) {
  const values = new Map<string, ValueSource>();
  const add = (value: string, source: ValueSource) => {
    if (validFieldValue(field, value))
      values.set(
        field.type === "number" ? String(Number(value)) : value,
        source,
      );
  };
  for (const answer of answers)
    if (answer.fieldId === field.id && answer.scope === field.scope)
      add(answer.value, "answer");
  if (field.type === "number") {
    const identifierDigits = new Set(
      existing.flatMap((value) => /^\p{L}+-(\d+)$/u.exec(value)?.[1] ?? []),
    );
    for (const match of request.matchAll(
      /(?<![\p{L}\p{N}_.,:/+\-])(\d{1,5})(?![\p{L}\p{N}_.,:/+\-])/gu,
    ))
      if (!identifierDigits.has(match[0])) add(match[0], "number");
  } else if (field.type === "datetime-local") {
    for (const match of request.matchAll(
      /\b(\d{4}-\d{2}-\d{2})(?:T|\s+(?:um\s+)?)(\d{2}:\d{2})\b/gi,
    ))
      add(`${match[1]}T${match[2]}`, "dateTime");
  } else {
    for (const match of request.matchAll(/["„“]([^"„“]+)["“]/g))
      if (match[1]) add(match[1], "quote");
    for (const value of existing)
      if (request.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
        add(value, "existing");
  }
  return [...values].map(([value, source]) => ({ value, source }));
}
export function validFieldValue(field: FieldDescription, value: string) {
  if (field.type === "number")
    return (
      /^\d+$/.test(value) &&
      Number(value) >= (field.min ?? 0) &&
      Number(value) <= (field.max ?? 10000)
    );
  if (field.type === "datetime-local")
    return (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) &&
      appointmentSchema.shape.start.safeParse(`${value}:00`).success
    );
  return value.length > 0 && value.length <= 200;
}
