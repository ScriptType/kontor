import { z } from "zod";
import { appointmentSchema } from "./domain.js";
import { timeRanges } from "./clock-times.js";
import type { DecisionInput, FieldDescription } from "./command.js";
import { spokenNumbers } from "./number-words.js";
export const valueSourceSchema = z.enum([
  "answer",
  "number",
  "dateTime",
  "quote",
  "existing",
  "hours",
  "word",
  "sum",
  "difference",
  "range",
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
  word: {
    de: "Zahlwort aus Auftrag, als Minuten gelesen",
    en: "number word from the request read as minutes",
  },
  sum: { de: "Summe", en: "sum" },
  difference: { de: "Differenz", en: "difference" },
  range: { de: "Zeitspanne", en: "time range" },
} as const satisfies Record<ValueSource, { de: string; en: string }>;
const requestSources: ReadonlySet<ValueSource> = new Set([
  "number",
  "hours",
  "word",
  "sum",
  "difference",
  "range",
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
  /** A literal, an hour phrase converted to minutes, or a number word. */
  source: "number" | "hours" | "word";
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
        source: "number" as const,
        ...bind(at, match[0].length),
      },
    ];
  });
  const words = spokenNumbers(request).filter(
    ({ at }) =>
      !covered.some((span) => at >= span.from && at < span.to) &&
      !notMinutes.test(request.slice(at).replace(/^\p{L}+/u, "")),
  );
  return [
    ...numbers,
    ...hours.map((h) => ({
      at: h.at,
      value: h.value,
      span: h.span,
      source: "hours" as const,
      ...bind(h.at, h.end - h.at),
    })),
    ...words.map((w) => ({
      at: w.at,
      value: String(w.value),
      span: w.text,
      source: "word" as const,
      ...bind(w.at, w.text.length),
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .map(({ at: _, ...number }) => number);
}
/** Where a candidate comes from: the source, a converted hour phrase or number word, or the arithmetic on the saved value or a time range. */
export function describeSource(
  found: {
    source: ValueSource;
    span?: string;
    saved?: number;
    times?: { from: string; to: string };
  },
  value: string,
  language: "de" | "en",
) {
  const text = valueSources[found.source][language];
  if (found.times) {
    const { from, to } = found.times;
    return language === "de"
      ? `${text}: „${found.span}“ = ${to} − ${from} = ${value} Minuten`
      : `${text}: "${found.span}" = ${to} − ${from} = ${value} min`;
  }
  if (found.saved !== undefined) {
    const amount = Math.abs(Number(value) - found.saved);
    const plus = found.source === "sum";
    return language === "de"
      ? `${text}: gespeicherte ${found.saved} ${plus ? "+" : "−"} ${found.span === undefined ? amount : `„${found.span}“ (${amount})`} aus dem Auftrag = ${value}`
      : `${text}: saved ${found.saved} ${plus ? "plus" : "minus"} ${found.span === undefined ? amount : `"${found.span}" (${amount})`} from the request = ${value}`;
  }
  if (found.span === undefined) return text;
  return language === "de"
    ? `${text}: „${found.span}“ = ${value} Minuten`
    : `${text}: "${found.span}" = ${value} min`;
}
/** The request numbers that belong to this number field on its case. */
export function fieldNumbers(
  field: FieldDescription,
  request: string,
  existing: string[],
) {
  return requestNumbers(request, existing).filter(
    ({ fields, cases }) =>
      fields.includes(field.id) &&
      (!cases.length || cases.includes(field.scope)),
  );
}
/**
 * The saved minutes plus and minus each number, for a request that adds to or
 * takes from a saved value ("noch 25 dazu", "20 zu viel"). Code offers both;
 * Jev reads which one the request means.
 */
export function savedArithmetic(saved: number, numbers: RequestNumber[]) {
  return numbers.flatMap(({ value, span }) =>
    (
      [
        ["sum", saved + Number(value)],
        ["difference", saved - Number(value)],
      ] as const
    ).map(([source, result]) => ({
      value: String(result),
      source,
      saved,
      ...(span === undefined ? {} : { span }),
    })),
  );
}
const clock = (minutes: number) =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
/**
 * The appointment length each time range in the request gives ("von 13 bis 15
 * uhr" = 120), when the field accepts it. Code offers it; Jev reads whether
 * the range is the appointment.
 */
export function rangeDurations(field: FieldDescription, request: string) {
  if (field.id !== "duration") return [];
  return timeRanges(request).flatMap(({ text, from, to }) => {
    const value = String(to - from);
    return validFieldValue(field, value)
      ? [
          {
            value,
            source: "range" as const,
            span: text,
            times: { from: clock(from), to: clock(to) },
          },
        ]
      : [];
  });
}
/**
 * Value candidates for one field. A candidate is bound when the request ties it
 * to this field alone (a field word, or the field type for a date and time) and
 * it is the only request value offered to this field on this case. A
 * correction or a sequence offers two values, so neither is bound. With the
 * field's saved minutes, the sums and differences count as request values too,
 * so the number they come from is not bound. So does the length of a time
 * range for the appointment length.
 */
export function fieldValues(
  field: FieldDescription,
  request: string,
  answers: DecisionInput["answers"],
  existing: string[],
  saved?: number,
) {
  type Found = {
    source: ValueSource;
    span?: string;
    saved?: number;
    times?: { from: string; to: string };
    bound: boolean;
  };
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
    const numbers = fieldNumbers(field, request, existing);
    for (const { value, span, bound, source } of numbers)
      add(value, source, bound, span);
    if (saved !== undefined)
      for (const { value, ...found } of savedArithmetic(saved, numbers))
        if (!values.has(value) && validFieldValue(field, value))
          values.set(value, { ...found, bound: false });
    for (const { value, ...found } of rangeDurations(field, request))
      if (!values.has(value)) values.set(value, { ...found, bound: false });
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
const pad = (n: number) => String(n).padStart(2, "0");
/** Today's date in the browser's local time zone, not UTC. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
const isoDay = /(?<!\p{N})(\d{4})-(\d{2})-(\d{2})(?!\p{N})/gu;
// A d.m that an hour, minute or clock unit follows ("1.5 Stunden", "9.30 Uhr")
// is a quantity or a time, not a day.
const germanDay =
  /(?<![\p{N}.,:/-])(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2})?)?(?!\p{N}|[.,]\p{N}|\s?(?:h|std|stunden?|uhr|min|minuten)(?!\p{L}))/giu;
const clockTimes = [
  /(?<![\p{N}.:])(\d{1,2}):(\d{2})(?!\p{N})/gu,
  /(?<![\p{N}.,:])(\d{1,2})(?:\.(\d{2}))?\s?uhr(?!\p{L})/giu,
  /(?<!\p{L})um\s(\d{1,2})(?!\p{N}|[.:,]\p{N}|\s?(?:uhr|h|std|stunden?|min|minuten)(?!\p{L}))/giu,
];
/** Every real calendar day the request names; a day without a year is in `year`. */
function days(request: string, year: number) {
  return [
    ...[...request.matchAll(isoDay)].map((m) => [m[1], m[2], m[3]]),
    ...[...request.matchAll(germanDay)].map((m) => [
      m[3]?.length === 2 ? `20${m[3]}` : (m[3] ?? String(year)),
      m[2],
      m[1],
    ]),
  ].flatMap(([y, m, d]) => {
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.getMonth() === Number(m) - 1 && date.getDate() === Number(d)
      ? [localToday(date)]
      : [];
  });
}
function single(values: string[]) {
  const distinct = new Set(values);
  return distinct.size === 1 ? ([...distinct][0] ?? null) : null;
}
/**
 * What the request gives for a field, read by the field's type alone. A day
 * or time is kept only when the request names exactly one distinct value; a
 * day without a year takes today's year. Number and text fields take the
 * single value fieldValues() offers, without the length of a time range,
 * which code computes and does not read literally. Adds no field candidate.
 */
export function partialAnswer(
  field: FieldDescription,
  request: string,
  today: string,
  existing: string[],
): PartialAnswer {
  if (field.type !== "datetime-local") {
    const values = fieldValues(field, request, [], existing).filter(
      ({ source }) => source !== "range",
    );
    return {
      type: field.type,
      value: values.length === 1 ? (values[0]?.value ?? null) : null,
    };
  }
  const day = single(days(request, Number(today.slice(0, 4))));
  const time = single(
    clockTimes.flatMap((pattern) =>
      [...request.matchAll(pattern)].flatMap((m) => {
        const hours = Number(m[1]),
          minutes = Number(m[2] ?? 0);
        return hours < 24 && minutes < 60
          ? [`${pad(hours)}:${pad(minutes)}`]
          : [];
      }),
    ),
  );
  return {
    type: field.type,
    date: day === null ? null : { day, past: day < today },
    time,
  };
}
/** The answer panel's lines for a prefill, in order; empty when nothing is given. */
export function partialNotes(partial: PartialAnswer): string[] {
  if (partial.type !== "datetime-local")
    return partial.value === null
      ? []
      : [`Aus dem Auftrag: ${partial.value}. Bitte prüfen.`];
  const { date, time } = partial;
  const day = date && date.day.split("-").reverse().join(".");
  const given =
    day && time
      ? [`Aus dem Auftrag: ${day}, ${time}. Bitte prüfen.`]
      : day
        ? [`Datum aus dem Auftrag: ${day}. Bitte die Uhrzeit ergänzen.`]
        : time
          ? [`Uhrzeit aus dem Auftrag: ${time}. Bitte das Datum ergänzen.`]
          : [];
  return date?.past ? [...given, `${day} liegt in der Vergangenheit.`] : given;
}
/** The field's value from the answer control's parts; null when incomplete or invalid. */
export function composeAnswer(
  field: FieldDescription,
  parts: { date?: string; time?: string; value?: string },
): string | null {
  const value =
    field.type === "datetime-local"
      ? parts.date && parts.time
        ? `${parts.date}T${parts.time}`
        : ""
      : (parts.value ?? "");
  return validFieldValue(field, value) ? value : null;
}
