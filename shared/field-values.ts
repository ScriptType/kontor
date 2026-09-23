import { z } from "zod";
import { appointmentSchema } from "./domain.js";
import type { DecisionInput, FieldDescription } from "./command.js";
export const valueSourceSchema = z.enum([
  "answer",
  "number",
  "dateTime",
  "quote",
  "existing",
  "hours",
]);
export type ValueSource = z.infer<typeof valueSourceSchema>;
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
  hours: {
    de: "Stundenangabe aus Auftrag, in Minuten umgerechnet",
    en: "hours from the request converted to minutes",
  },
} as const satisfies Record<ValueSource, { de: string; en: string }>;
const requestSources: ReadonlySet<ValueSource> = new Set([
  "number",
  "hours",
  "dateTime",
]);

/**
 * Field words that tie a number in the request to one number field, keyed by
 * field id. Units (Minuten, Stunden, h, std) and verbs such as "dauert" are
 * not field words: worked time and appointment length share them. A number
 * belongs to the field whose word precedes it most closely in its clause, else
 * to the one that follows it most closely, and only to the cases that clause
 * names. A clause without a field word leaves the number to every number
 * field. The duration field only exists once an appointment has a start, so
 * without this binding "termin 45 min" would be offered to worked minutes, the
 * only number field on screen.
 */
export const numberFieldCues = {
  minutes: /arbeit|\bdran\b|geleistet|aufwand|\bwork/giu,
  duration: /termin|\bdauer\b|länge|appointment|\bduration\b/giu,
} as const satisfies Record<string, RegExp>;
const clauseBreak =
  /(?<!\b\d{1,2}\.\d{1,2})[.!?](?=\s|$)|[;\n]|\b(?:und|and|dann|danach|then)\b/giu;
/** The request's clauses, split where number binding splits them. */
export function requestClauses(request: string) {
  return request
    .split(clauseBreak)
    .filter((clause) => /[\p{L}\p{N}]/u.test(clause));
}
// A number followed by a minute unit, glued or not, or standing alone. Digits
// inside ids, dates, times and decimals ("V-1041", "28.9.", "9:30", "1,5")
// are no number.
const quantity =
  /(?<![\p{L}\p{N}_.,:/+\-])(\d{1,5})(?=\s?(?:minuten|minutes|minute|mins|min)\b|(?![\p{L}\p{N}_:/+\-]|[.,]\d))/giu;
// A number before an hour unit belongs to an hour phrase, and a clock time is
// no quantity at all.
const notMinutes = /^\s?(?:h|std|stunden?|hours?|hrs?|uhr)\b/iu;
const clockBefore = /(?:\bum|\bgegen|\bhalb|\bviertel)\s$/iu;
const minuteUnit = /^\s?(?:minuten|minutes|minute|mins|min)\b/iu;

const hourUnit = String.raw`(?:h|std\.?|stunden?|hours?|hrs?)(?![\p{L}])`;
const minuteTail = String.raw`(?:\s?(?:minuten|minutes|minute|mins|min)(?![\p{L}]))?`;
// Hours in digits or words, each with its minutes. Longer phrases come first,
// so "eine halbe stunde" is never read as "eine stunde".
const hourPhrases: [RegExp, (m: RegExpMatchArray) => number][] = [
  [
    new RegExp(
      String.raw`(?<![\p{L}\p{N}_.,:/+\-])(\d{1,2})(?:[.,](\d{1,2}))?\s?${hourUnit}(?:\s?(\d{1,2})${minuteTail}(?!\d))?`,
      "giu",
    ),
    (m) =>
      Math.round(Number(`${m[1]}.${m[2] ?? "0"}`) * 60) + Number(m[3] ?? 0),
  ],
  [/\b(?:anderthalb|eineinhalb)\s?stunden?\b/giu, () => 90],
  [/(?<![\p{N}/])1\/2\s?(?:stunde|std\.?)(?![\p{L}])/giu, () => 30],
  [/\b(?:(?:eine|ne|einer)\s)?halben?\s(?:stunde|std)\b/giu, () => 30],
  [/\bdreiviertel\s?stunde\b/giu, () => 45],
  [/\b(?:(?:eine|ne|einer)\s)?viertel\s?stunde\b/giu, () => 15],
  [
    /\b(eine|ne|einer|zwei|drei|vier)\s(?:stunden?|std\.?)(?![\p{L}])/giu,
    (m) =>
      60 * ({ zwei: 2, drei: 3, vier: 4 }[(m[1] ?? "").toLowerCase()] ?? 1),
  ],
];

const identifierDigits = (value: string) => /^\p{L}+-(\d+)$/u.exec(value)?.[1];

/**
 * Every literal minute quantity in the request that is not an identifier's
 * digits, and every hour phrase converted to minutes with its source span,
 * each with the number fields it belongs to and the identifiers its clause
 * names (empty when it names none).
 */
export type RequestNumber = {
  value: string;
  /** The hour phrase a converted value came from; absent for a literal. */
  span?: string;
  fields: string[];
  cases: string[];
  /** A field word, not the fallback to every number field, decided the fields. */
  bound: boolean;
};
export function requestNumbers(
  request: string,
  identifiers: string[] = [],
): RequestNumber[] {
  // "1041" or, spoken in two parts, "10 41" names case V-1041.
  const named = identifiers.flatMap((id) => {
    const digits = identifierDigits(id);
    if (!digits) return [];
    const spellings = [
      digits,
      ...Array.from(
        { length: digits.length - 1 },
        (_, k) => `${digits.slice(0, k + 1)}\\s${digits.slice(k + 1)}`,
      ),
    ];
    return [
      {
        id,
        pattern: new RegExp(`(?<!\\d)(?:${spellings.join("|")})(?!\\d)`, "g"),
      },
    ];
  });
  const idSpans = named.flatMap(({ pattern }) =>
    [...request.matchAll(pattern)].map((m) => ({
      from: m.index,
      to: m.index + m[0].length,
    })),
  );
  const breaks = [0, request.length];
  for (const match of request.matchAll(clauseBreak))
    breaks.push(match.index, match.index + match[0].length);
  breaks.sort((a, b) => a - b);
  const bind = (at: number, length: number) => {
    const start = breaks.filter((b) => b <= at).at(-1) ?? 0;
    const end = breaks.find((b) => b > at) ?? request.length;
    const clause = request.slice(start, end);
    const from = at - start;
    const to = from + length;
    const words = Object.entries(numberFieldCues).flatMap(([id, cue]) =>
      [...clause.matchAll(cue)].map((word) => ({
        id,
        start: word.index,
        end: word.index + word[0].length,
      })),
    );
    const preceding = words.filter((w) => w.end <= from);
    const following = words.filter((w) => w.start >= to);
    const nearest = preceding.length
      ? preceding.filter(
          (w) => w.end === Math.max(...preceding.map((p) => p.end)),
        )
      : following.filter(
          (w) => w.start === Math.min(...following.map((f) => f.start)),
        );
    return {
      fields: nearest.length
        ? [...new Set(nearest.map((w) => w.id))]
        : Object.keys(numberFieldCues),
      bound: nearest.length > 0,
      cases: named
        .filter(({ pattern }) => clause.search(pattern) >= 0)
        .map(({ id }) => id),
    };
  };
  const hours: { at: number; end: number; value: string; span: string }[] = [];
  for (const [pattern, minutes] of hourPhrases)
    for (const match of request.matchAll(pattern)) {
      const at = match.index;
      const end = at + match[0].length;
      if (hours.some((h) => at < h.end && end > h.at)) continue;
      hours.push({ at, end, value: String(minutes(match)), span: match[0] });
    }
  const covered = [
    ...idSpans,
    ...hours.map((h) => ({ from: h.at, to: h.end })),
  ];
  const numbers = [...request.matchAll(quantity)].flatMap((match) => {
    const at = match.index;
    const after = request.slice(at + match[0].length);
    const before = request.slice(Math.max(0, at - 12), at);
    if (
      covered.some((span) => at >= span.from && at < span.to) ||
      notMinutes.test(after) ||
      (clockBefore.test(before) && !minuteUnit.test(after))
    )
      return [];
    return [
      {
        at,
        value: match[1] ?? match[0],
        ...bind(at, match[0].length),
      },
    ];
  });
  return [
    ...numbers,
    ...hours.map((h) => ({
      at: h.at,
      value: h.value,
      span: h.span,
      ...bind(h.at, h.end - h.at),
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .map(({ at: _, ...number }) => number);
}
/** Where a candidate comes from, with the converted hour phrase when there is one. */
export function describeSource(
  found: { source: ValueSource; span?: string },
  value: string,
  language: "de" | "en",
) {
  const text = valueSources[found.source][language];
  if (found.span === undefined) return text;
  return language === "de"
    ? `${text}: „${found.span}“ = ${value} Minuten`
    : `${text}: "${found.span}" = ${value} min`;
}
/**
 * Value candidates for one field. A candidate is bound when the request ties it
 * to this field alone (a field word, or the field type for a date and time) and
 * it is the only request value offered to this field on this case. A
 * correction or a sequence offers two values, so neither is bound.
 */
export function fieldValues(
  field: FieldDescription,
  request: string,
  answers: DecisionInput["answers"],
  existing: string[],
) {
  type Found = { source: ValueSource; span?: string; bound: boolean };
  const values = new Map<string, Found>();
  const add = (
    value: string,
    source: ValueSource,
    tied: boolean,
    span?: string,
  ) => {
    if (!validFieldValue(field, value)) return;
    const key = field.type === "number" ? String(Number(value)) : value;
    const bound = tied && (values.get(key)?.bound ?? true);
    values.set(
      key,
      span === undefined ? { source, bound } : { source, span, bound },
    );
  };
  for (const answer of answers)
    if (answer.fieldId === field.id && answer.scope === field.scope)
      add(answer.value, "answer", false);
  if (field.type === "number") {
    for (const { value, fields, cases, span, bound } of requestNumbers(
      request,
      existing,
    ))
      if (
        fields.includes(field.id) &&
        (!cases.length || cases.includes(field.scope))
      )
        add(value, span === undefined ? "number" : "hours", bound, span);
  } else if (field.type === "datetime-local") {
    for (const match of request.matchAll(
      /\b(\d{4}-\d{2}-\d{2})(?:T|\s+(?:um\s+)?)(\d{2}:\d{2})\b/gi,
    ))
      add(`${match[1]}T${match[2]}`, "dateTime", true);
  } else {
    for (const match of request.matchAll(/["„“]([^"„“]+)["“]/g))
      if (match[1]) add(match[1], "quote", false);
    for (const value of existing)
      if (request.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
        add(value, "existing", false);
  }
  const single =
    [...values.values()].filter((found) => requestSources.has(found.source))
      .length === 1;
  return [...values].map(([value, found]) => ({
    value,
    ...found,
    bound: found.bound && single,
  }));
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

/** What the request already gives for a field Jev asks about, in the answer control's parts. */
export type PartialAnswer =
  | {
      type: "datetime-local";
      date: { day: string; past: boolean } | null;
      time: string | null;
    }
  | { type: "number" | "text"; value: string | null };
/** Today's date in the browser's local time zone, not UTC. */
export function localToday(_now = new Date()): string {
  throw new Error("not implemented");
}
export function partialAnswer(
  _field: FieldDescription,
  _request: string,
  _today: string,
  _existing: string[],
): PartialAnswer {
  throw new Error("not implemented");
}
export function partialNotes(_partial: PartialAnswer): string[] {
  throw new Error("not implemented");
}
export function composeAnswer(
  _field: FieldDescription,
  _parts: { date?: string; time?: string; value?: string },
): string | null {
  throw new Error("not implemented");
}
