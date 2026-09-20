import type { DecisionInput, FieldDescription } from "./command.js";
export function fieldValues(
  field: FieldDescription,
  request: string,
  answers: DecisionInput["answers"],
  existing: string[],
) {
  const values = new Map<string, string>();
  const add = (value: string, source: string) => {
    if (validFieldValue(field, value) && value !== field.current)
      values.set(value, source);
  };
  for (const answer of answers)
    if (answer.fieldId === field.id && answer.scope === field.scope)
      add(answer.value, "aus ausdrücklicher Antwort");
  if (field.type === "number") {
    for (const match of request.matchAll(
      /(?<![\p{L}\p{N}_.,:/+\-])(\d{1,5})(?![\p{L}\p{N}_.,:/+\-])/gu,
    ))
      add(match[0], "wörtliche Zahl aus Auftrag");
  } else if (field.type === "datetime-local") {
    const dates = [...request.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(
      (m) => m[0],
    );
    const times = [...request.matchAll(/\b\d{2}:\d{2}\b/g)].map((m) => m[0]);
    for (const date of dates)
      for (const time of times)
        add(`${date}T${time}`, "Datum und Uhrzeit wörtlich aus Auftrag");
  } else {
    for (const match of request.matchAll(/["„“]([^"„“]+)["“]/g))
      if (match[1]) add(match[1], "zitierter Text aus Auftrag");
    for (const value of existing)
      if (request.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
        add(value, "vorhandener Datenwert im Auftrag");
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
      Number.isFinite(Date.parse(value))
    );
  return value.length > 0 && value.length <= 200;
}
