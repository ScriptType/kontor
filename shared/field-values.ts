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

/**
 * Words that tie a number in the request to one number field, keyed by field
 * id. A number belongs to the field whose word stands nearest to it in the
 * same clause, and to the cases that clause names. A number in a clause that
 * names no field is worked time: an appointment length always comes with the
 * appointment. The duration field only exists once an appointment has a
 * start, so without this binding a duration number would be offered to
 * worked minutes, the only number field on screen.
 */
export const numberFieldCues = {
  minutes: /arbeit|\bdran\b|geleistet|aufwand|\bwork/giu,
  duration:
    /termin|\bdauer\b|\bstunden?\b|\blang(?:e|en)?\b|länge|appointment|duration|\blong\b/giu,
} as const satisfies Record<string, RegExp>;
const bareNumberField: keyof typeof numberFieldCues = "minutes";
const clauseBreak =
  /(?<!\d)[.!?](?=\s|$)|[;\n]|\b(?:und|and|dann|danach|then)\b/giu;

const identifierDigits = (value: string) => /^\p{L}+-(\d+)$/u.exec(value)?.[1];

/**
 * Every literal number in the request with the number fields it belongs to and
 * the identifiers its clause names (empty when it names none).
 */
export function requestNumbers(request: string, identifiers: string[] = []) {
  const named = identifiers.flatMap((id) => {
    const digits = identifierDigits(id);
    return digits
      ? [{ id, pattern: new RegExp(`(?<!\\d)${digits}(?!\\d)`) }]
      : [];
  });
  const breaks = [0, request.length];
  for (const match of request.matchAll(clauseBreak))
    breaks.push(match.index, match.index + match[0].length);
  breaks.sort((a, b) => a - b);
  return [
    ...request.matchAll(
      /(?<![\p{L}\p{N}_.,:/+\-])(\d{1,5})(?![\p{L}\p{N}_.,:/+\-])/gu,
    ),
  ].map((match) => {
    const at = match.index;
    const start = breaks.filter((b) => b <= at).at(-1) ?? 0;
    const end = breaks.find((b) => b > at) ?? request.length;
    const clause = request.slice(start, end);
    const number = { from: at - start, to: at - start + match[0].length };
    const distances = Object.entries(numberFieldCues).flatMap(([id, cue]) =>
      [...clause.matchAll(cue)].map((word) => ({
        id,
        distance:
          word.index >= number.to
            ? word.index - number.to
            : Math.max(0, number.from - (word.index + word[0].length)),
      })),
    );
    const nearest = Math.min(...distances.map((d) => d.distance));
    const fields = distances.length
      ? [
          ...new Set(
            distances.filter((d) => d.distance === nearest).map((d) => d.id),
          ),
        ]
      : [bareNumberField];
    const cases = named
      .filter(({ pattern }) => pattern.test(clause))
      .map(({ id }) => id);
    return { value: match[0], fields, cases };
  });
}
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
    const digits = new Set(
      existing.flatMap((id) => identifierDigits(id) ?? []),
    );
    for (const { value, fields, cases } of requestNumbers(request, existing))
      if (
        !digits.has(value) &&
        fields.includes(field.id) &&
        (!cases.length || cases.includes(field.scope))
      )
        add(value, "number");
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
