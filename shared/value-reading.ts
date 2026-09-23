import { z } from "zod";
import { fieldSchema, type FieldDescription } from "./command.js";
import { dimensions, type ReadingKind } from "./dimensions.js";
import type { PartialAnswer } from "./field-values.js";

/** One choice question of a reading: its text and its options by key. */
export type ReadingPart = { text: string; options: Record<string, string> };
/** The provider's pick for one part. */
export type PartPick = { choice: string; confidence: number };
const readSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
/** A value code assembled from the picks, with the lowest confidence of the parts it used; null when not stated, incomplete or invalid. */
export type Read = z.infer<typeof readSchema>;
export const valueReadingSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("number"), value: readSchema }),
  z.object({
    type: z.literal("datetime-local"),
    date: readSchema,
    time: readSchema,
  }),
]);
export type ValueReading = z.infer<typeof valueReadingSchema>;
export const readInputSchema = z.object({
  request: z.string().max(20000),
  /** The run's start day; relative days resolve against it. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fields: z.array(fieldSchema).min(1).max(10),
});
export type ReadInput = z.infer<typeof readInputSchema>;

/** The lowest part confidence a read value needs to prefill the answer, fitted on holdout-1 value mentions. */
export const prefillBar = 0.6;
/** The answer prefill from a reading: each part only when read with at least the bar's confidence. */
export function prefillFrom(
  reading: ValueReading,
  today: string,
): PartialAnswer {
  const sure = (read: Read) =>
    read.value !== null && read.confidence >= prefillBar ? read.value : null;
  if (reading.type === "number")
    return { type: "number", value: sure(reading.value) };
  const day = sure(reading.date);
  return {
    type: "datetime-local",
    date: day === null ? null : { day, past: day < today },
    time: sure(reading.time),
  };
}
type Reader = {
  parts(
    field: FieldDescription,
    request: string,
    today: string,
  ): Record<string, ReadingPart>;
  assemble(
    picks: Record<string, PartPick>,
    field: FieldDescription,
    request: string,
    today: string,
  ): ValueReading;
};

/** The fields the registry reads with this kind, by control field id, with their descriptions. */
function fieldsReadAs(kind: ReadingKind) {
  return dimensions.flatMap((entry) =>
    entry.kind === "value" &&
    "reading" in entry &&
    entry.reading === kind &&
    "field" in entry.controls
      ? [{ id: entry.controls.field, description: entry.description }]
      : [],
  );
}
/** The reading kind the registry gives the field, if the model may read its value. */
export function readingKind(field: FieldDescription): ReadingKind | null {
  for (const entry of dimensions)
    if (
      entry.kind === "value" &&
      "reading" in entry &&
      "field" in entry.controls &&
      entry.controls.field === field.id
    )
      return entry.reading;
  return null;
}

const newValue = (field: FieldDescription) =>
  `Gesucht ist der Wert, den das Feld „${field.label}“ von Vorgang ${field.scope} nach dem Auftrag haben soll: ${field.jev.name}.${field.jev.notFor ? ` Nicht gemeint: ${field.jev.notFor}.` : ""} Eine Angabe, die ausdrücklich einem anderen Vorgang oder einem anderen Feld gilt, zählt hier nicht. Korrigiert der Auftrag einen alten, bisherigen oder falschen Wert („60 ist zu lang, mach 45 draus“, „nicht 60 sondern 45“, „45, nee 50“), zählt nur der neue Wert.`;
const lowest = (...picks: PartPick[]) =>
  Math.min(...picks.map((pick) => pick.confidence));
const pickOf = (picks: Record<string, PartPick>, part: string): PartPick =>
  picks[part] ?? { choice: "none", confidence: 0 };

/** A number as the request writes it: one amount, or hours and minutes written together ("2h15"). */
export type NumberSpan = { text: string; at: number; amounts: number[] };
const combo =
  /(?<![\p{N}.,])(\d{1,2})\s?(?:h|std\.?|stunden?)\s?(\d{1,2})(?:\s?(?:minuten|min\.?))?(?![\p{N}\p{L}])/giu;
const single = /(?<![\p{N}.,/])(\d+)(?:([.,])(\d+)|\/(\d+))?(?![\p{N}])/gu;
/** Every number the request writes, exactly as written; code enumerates, the model picks. */
export function numberSpans(request: string): NumberSpan[] {
  const spans: NumberSpan[] = [...request.matchAll(combo)].map((m) => ({
    text: m[0],
    at: m.index,
    amounts: [Number(m[1]), Number(m[2])],
  }));
  for (const m of request.matchAll(single)) {
    if (
      spans.some(
        (s) => m.index < s.at + s.text.length && m.index + m[0].length > s.at,
      )
    )
      continue;
    const amount =
      m[4] !== undefined
        ? Number(m[1]) / Number(m[4])
        : Number(`${m[1]}.${m[3] ?? "0"}`);
    if (Number.isFinite(amount))
      spans.push({ text: m[0], at: m.index, amounts: [amount] });
  }
  return spans.sort((a, b) => a.at - b.at).slice(0, 250);
}
const snippet = (request: string, span: NumberSpan) =>
  `„${span.text}“ in „…${request.slice(Math.max(0, span.at - 30), span.at)}[${span.text}]${request.slice(span.at + span.text.length, span.at + span.text.length + 30)}…“`;

const ones = [
  "",
  "eins",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
];
const teens = [
  "zehn",
  "elf",
  "zwölf",
  "dreizehn",
  "vierzehn",
  "fünfzehn",
  "sechzehn",
  "siebzehn",
  "achtzehn",
  "neunzehn",
];
const tens = [
  "",
  "",
  "zwanzig",
  "dreißig",
  "vierzig",
  "fünfzig",
  "sechzig",
  "siebzig",
  "achtzig",
  "neunzig",
];
function germanWord(n: number): string {
  if (n === 100) return "hundert";
  if (n < 10) return n === 1 ? "eins / ein / eine" : ones[n]!;
  if (n < 20) return teens[n - 10]!;
  const unit = n % 10;
  const ten = tens[Math.floor(n / 10)]!;
  return unit ? `${unit === 1 ? "ein" : ones[unit]}und${ten}` : ten;
}
/** Number words the model can pick, by key: 1 to 100 and the common fractions. */
const numberWords: Record<string, { label: string; amount: number }> = {
  ...Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [
      String(i + 1),
      { label: `${germanWord(i + 1)} (${i + 1})`, amount: i + 1 },
    ]),
  ),
  viertel: { label: "viertel (0,25)", amount: 0.25 },
  halbe: { label: "halbe / halb (0,5)", amount: 0.5 },
  dreiviertel: { label: "dreiviertel (0,75)", amount: 0.75 },
  anderthalb: { label: "anderthalb (1,5)", amount: 1.5 },
  eineinhalb: { label: "eineinhalb (1,5)", amount: 1.5 },
  zweieinhalb: { label: "zweieinhalb (2,5)", amount: 2.5 },
};
const minutesPerUnit = { minutes: 1, hours: 60 } as const;

const minutesReader: Reader = {
  parts(field, request) {
    const spans = numberSpans(request);
    return {
      span: {
        text: `${newValue(field)} Welche Stelle des Auftrags nennt diesen Wert?`,
        options: {
          ...Object.fromEntries(
            spans.map((span, i) => [`s${i}`, snippet(request, span)]),
          ),
          word: "Der Wert steht als Zahlwort im Auftrag, auch mit Einheit zusammen (etwa „neunzig“, „zwanzig Minuten“, „ne halbe Stunde“, „dreiviertelstunde“, „anderthalb“).",
          elsewhere: `Die Zahlen im Auftrag gelten einem anderen Feld oder Vorgang${field.jev.notFor ? ` (etwa ${field.jev.notFor})` : ""}.`,
          none: "Der Auftrag nennt keinen Wert für dieses Feld.",
        },
      },
      unit: {
        text: `${newValue(field)} In welcher Einheit nennt der Auftrag diesen Wert?`,
        options: {
          minutes: "Minuten",
          hours: "Stunden (auch Bruchteile wie 1,5 h oder eine halbe Stunde)",
          hoursMinutes:
            "Stunden und Minuten zusammen (etwa „2h15“, „1 Std. 20“)",
          none: "Der Auftrag nennt keinen Wert für dieses Feld.",
        },
      },
      field: {
        text: `Der Auftrag nennt für Vorgang ${field.scope} eine Dauer oder Zeitangabe. Welches Feld von Vorgang ${field.scope} soll sie nach dem Auftrag setzen?`,
        options: {
          ...Object.fromEntries(
            fieldsReadAs("minutes").map((f) => [f.id, f.description]),
          ),
          none: "keines davon, oder der Auftrag nennt keine solche Angabe",
        },
      },
      word: {
        text: `${newValue(field)} Steht dieser Wert als Zahlwort im Auftrag: welches Zahlwort? Wähle das Wort selbst, ohne es mit der Einheit umzurechnen: bei „eine Stunde“ „eins“, bei „eine halbe Stunde“ „halbe“, bei „neunzig Minuten“ „neunzig“.`,
        options: {
          ...Object.fromEntries(
            Object.entries(numberWords).map(([key, w]) => [key, w.label]),
          ),
          none: "Der Wert steht nicht als Zahlwort im Auftrag, oder der Auftrag nennt keinen.",
        },
      },
    };
  },
  assemble(picks, field, request) {
    const none = (confidence: number): ValueReading => ({
      type: "number",
      value: { value: null, confidence },
    });
    const [target, span, unit, word] = ["field", "span", "unit", "word"].map(
      (part) => pickOf(picks, part),
    ) as [PartPick, PartPick, PartPick, PartPick];
    if (target.choice !== field.id) return none(target.confidence);
    if (span.choice === "none" || span.choice === "elsewhere")
      return none(span.confidence);
    const byWord = span.choice === "word";
    const written = byWord
      ? numberWords[word.choice]
      : numberSpans(request)[Number(span.choice.slice(1))];
    if (!written) return none(lowest(span, word));
    const amounts = "amounts" in written ? written.amounts : [written.amount];
    const combined = amounts.length === 2;
    const factor =
      unit.choice === "minutes" || unit.choice === "hours"
        ? minutesPerUnit[unit.choice]
        : null;
    const minutes = combined
      ? amounts[0]! * 60 + amounts[1]!
      : factor === null
        ? null
        : Math.round(amounts[0]! * factor);
    const valid =
      minutes !== null &&
      minutes >= (field.min ?? 0) &&
      minutes <= (field.max ?? 10000);
    const used = [
      target,
      span,
      ...(byWord ? [word] : []),
      ...(combined ? [] : [unit]),
    ];
    return {
      type: "number",
      value: {
        value: valid ? String(minutes) : null,
        confidence: lowest(...used),
      },
    };
  },
};

const months = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
const weekdays = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];
const yearWindow = { from: 1900, to: 2050 };
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dayOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const plusDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
/** Monday 0 to Sunday 6. */
const weekdayIndex = (date: Date) => (date.getDay() + 6) % 7;
const dayParts = {
  morning: "morgens oder vormittags",
  noon: "mittags",
  afternoon: "nachmittags",
  evening: "abends oder nachts",
  none: "keine Tageszeit genannt",
} as const;

const dateTimeReader: Reader = {
  parts(field, _request, today) {
    const intro = `${newValue(field)} Heute ist ${weekdays[weekdayIndex(dayOf(today))]}, der ${today.split("-").reverse().join(".")}.`;
    const none = { none: "nicht genannt" };
    return {
      mode: {
        text: `${intro} Wie nennt der Auftrag das Datum dieses neuen Werts?`,
        options: {
          absolute: "als Datum mit Monat (etwa „24.09.“, „3. Oktober“)",
          relative:
            "relativ zu heute (heute, morgen, übermorgen oder ein Wochentag)",
          none: "der Auftrag nennt kein Datum dafür",
        },
      },
      month: {
        text: `${intro} Welcher Monat?`,
        options: {
          ...Object.fromEntries(
            months.map((m, i) => [String(i + 1), `${m} (${i + 1})`]),
          ),
          ...none,
        },
      },
      day: {
        text: `${intro} Welcher Tag des Monats?`,
        options: {
          ...Object.fromEntries(
            Array.from({ length: 31 }, (_, i) => [
              String(i + 1),
              String(i + 1),
            ]),
          ),
          ...none,
        },
      },
      year: {
        text: `${intro} Welches Jahr nennt der Auftrag ausdrücklich?`,
        options: {
          ...Object.fromEntries(
            Array.from(
              { length: yearWindow.to - yearWindow.from + 1 },
              (_, i) => [
                String(yearWindow.from + i),
                String(yearWindow.from + i),
              ],
            ),
          ),
          none: "kein Jahr genannt",
          out_of_range: `ein Jahr vor ${yearWindow.from} oder nach ${yearWindow.to}`,
        },
      },
      anchor: {
        text: `${intro} Worauf bezieht sich ein relatives Datum?`,
        options: {
          today: "heute",
          tomorrow: "morgen",
          day_after: "übermorgen",
          weekday: "einen Wochentag",
          ...none,
        },
      },
      weekday: {
        text: `${intro} Welcher Wochentag?`,
        options: {
          ...Object.fromEntries(weekdays.map((w, i) => [String(i), w])),
          ...none,
        },
      },
      week: {
        text: `${intro} In welcher Woche liegt der Wochentag?`,
        options: {
          current:
            "ausdrücklich diese Woche („diesen Donnerstag“, „Donnerstag diese Woche“)",
          next: "ausdrücklich nächste Woche („nächste Woche Donnerstag“, „Donnerstag nächster Woche“)",
          none: "nur der Wochentag, ohne Woche („am Montag“, „Donnerstag“): der nächste solche Tag",
        },
      },
      hour: {
        text: `${intro} Welche Stunde nennt der Auftrag für die Uhrzeit, so wie sie dasteht („halb 10“: 10, „viertel nach 2“: 2, „14 Uhr“: 14)?`,
        options: {
          ...Object.fromEntries(
            Array.from({ length: 24 }, (_, i) => [
              String(i + 1),
              `${i + 1} (${germanWord(i + 1).split(" / ")[0]})`,
            ]),
          ),
          none: "der Auftrag nennt keine Stunde",
        },
      },
      relation: {
        text: `${intro} Wie steht die Uhrzeit zu dieser Stunde?`,
        options: {
          exact:
            "genau diese Stunde oder mit Minuten dahinter („9 Uhr“, „um 9“, „9:30“)",
          quarter_past: "viertel nach („viertel nach 2“ = 2:15)",
          half: "halb, eine halbe Stunde VOR der Stunde („halb 10“ = 9:30)",
          quarter_to:
            "dreiviertel oder viertel vor („dreiviertel 8“ = 7:45, „viertel vor 8“ = 7:45)",
          none: "keine Uhrzeit genannt",
        },
      },
      minute: {
        text: `${intro} Welche Minuten stehen hinter der Stunde („9:30“: 30, „9 Uhr“: 00)?`,
        options: {
          "0": ":00 oder keine Minuten",
          "15": ":15",
          "30": ":30",
          "45": ":45",
          other: "andere Minuten",
          none: "keine Uhrzeit genannt",
        },
      },
      daypart: {
        text: `${intro} Welche Tageszeit nennt der Auftrag zur Uhrzeit?`,
        options: { ...dayParts },
      },
    };
  },
  assemble(picks, _field, _request, today) {
    const p = (part: string) => pickOf(picks, part);
    return {
      type: "datetime-local",
      date: assembleDate(p, today),
      time: assembleTime(p),
    };
  },
};

function assembleDate(p: (part: string) => PartPick, today: string): Read {
  const mode = p("mode");
  const start = dayOf(today);
  const read = (date: Date | null, ...used: PartPick[]): Read => ({
    value: date ? isoDay(date) : null,
    confidence: lowest(mode, ...used),
  });
  if (mode.choice === "absolute") {
    const [month, day, year] = [p("month"), p("day"), p("year")];
    if (
      month.choice === "none" ||
      day.choice === "none" ||
      year.choice === "out_of_range"
    )
      return read(null, month, day, year);
    const build = (y: number) =>
      new Date(y, Number(month.choice) - 1, Number(day.choice));
    let date = build(
      year.choice === "none" ? start.getFullYear() : Number(year.choice),
    );
    if (year.choice === "none" && date < plusDays(start, -31))
      date = build(start.getFullYear() + 1);
    const real =
      date.getMonth() === Number(month.choice) - 1 &&
      date.getDate() === Number(day.choice);
    return read(real ? date : null, month, day, year);
  }
  if (mode.choice === "relative") {
    const anchor = p("anchor");
    const offset = { today: 0, tomorrow: 1, day_after: 2 }[anchor.choice];
    if (offset !== undefined) return read(plusDays(start, offset), anchor);
    const [weekday, week] = [p("weekday"), p("week")];
    if (anchor.choice !== "weekday" || weekday.choice === "none")
      return read(null, anchor, weekday);
    const target = Number(weekday.choice);
    const monday = plusDays(start, -weekdayIndex(start));
    const date =
      week.choice === "next"
        ? plusDays(monday, 7 + target)
        : week.choice === "current"
          ? plusDays(monday, target)
          : plusDays(start, (target - weekdayIndex(start) + 7) % 7);
    return read(date, anchor, weekday, week);
  }
  return read(null);
}

/** Hour shift and minutes of a clock time said relative to the written hour: "halb 10" is 9:30. */
const relativeClock: Record<string, [number, number]> = {
  quarter_past: [0, 15],
  half: [-1, 30],
  quarter_to: [-1, 45],
};
/** Hours from 1 to 6 without a day part are afternoon hours inside the working day. */
const workingDayStart = 7;
function assembleTime(p: (part: string) => PartPick): Read {
  const [hour, relation, minute, daypart] = [
    p("hour"),
    p("relation"),
    p("minute"),
    p("daypart"),
  ];
  if (hour.choice === "none" || relation.choice === "none")
    return { value: null, confidence: lowest(hour, relation) };
  const used = [hour, relation];
  let h = Number(hour.choice) % 24;
  if (h >= 1 && h <= 12) {
    used.push(daypart);
    const later =
      daypart.choice === "afternoon" || daypart.choice === "evening"
        ? h < 12
        : daypart.choice === "noon"
          ? h < workingDayStart
          : daypart.choice === "none" && h < workingDayStart;
    if (later) h += 12;
  }
  let m = 0;
  if (relation.choice === "exact") {
    used.push(minute);
    if (minute.choice === "other")
      return { value: null, confidence: lowest(...used) };
    m = minute.choice === "none" ? 0 : Number(minute.choice);
  } else {
    const [back, at] = relativeClock[relation.choice] ?? [0, 0];
    h += back;
    m = at;
  }
  return {
    value: `${pad((h + 24) % 24)}:${pad(m)}`,
    confidence: lowest(...used),
  };
}

export const readers: Record<ReadingKind, Reader> = {
  minutes: minutesReader,
  dateTime: dateTimeReader,
};
