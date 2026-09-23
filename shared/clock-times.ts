import { germanWord } from "./number-words.js";

const numberWords = (upTo: number) =>
  new Map(
    Array.from({ length: upTo }, (_, i) =>
      germanWord(i + 1).map((word) => [word, i + 1] as const),
    ).flat(),
  );
const hourWords = numberWords(24);
const minuteWords = numberWords(59);
/** Where a text stands in the request. */
type Span = { at: number; end: number };
// "24.09.", "24.9.2026", "2026-09-25".
const writtenDate =
  /(?<![\p{N}.])(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:\d{4}|\d{2}(?!\p{N}))?|\d{4}-\d{2}-\d{2}/gu;
const dates = (request: string): Span[] =>
  [...request.matchAll(writtenDate)].map((m) => ({
    at: m.index,
    end: m.index + m[0].length,
  }));
const within = (spans: Span[], at: number) =>
  spans.some((span) => at >= span.at && at < span.end);
// Digits after a colon are minutes, not an hour.
const hourDigits = /(?<![\p{N}:])\d{1,2}(?!\p{N})/gu;
/**
 * Every hour number the request writes, in digits (0 to 24, also before ":"
 * or ".", but not in a date) or as a number word (1 to 24), ascending. Code
 * offers only these as the hour of a clock time: "halb elf" can only be hour 11.
 */
export function writtenHours(request: string): number[] {
  const inDate = dates(request);
  const hours = [
    ...[...request.matchAll(hourDigits)]
      .filter((m) => !within(inDate, m.index))
      .map((m) => Number(m[0])),
    ...[...request.matchAll(/\p{L}+/gu)].map((m) =>
      hourWords.get(m[0].toLowerCase()),
    ),
  ].filter((hour): hour is number => hour !== undefined && hour <= 24);
  return [...new Set(hours)].sort((a, b) => a - b);
}

const hourWordPattern = [...hourWords.keys()]
  .sort((a, b) => b.length - a.length)
  .join("|");
/** "halb elf" is 10:30: the minutes of each phrase and the hours it goes back. */
const relativeClock = {
  halb: [-1, 30],
  "viertel nach": [0, 15],
  "viertel vor": [-1, 45],
  dreiviertel: [-1, 45],
} as const satisfies Record<string, readonly [number, number]>;
const relativeTime = new RegExp(
  String.raw`(?<!\p{L})(halb|viertel\s+nach|viertel\s+vor|dreiviertel)\s+(\d{1,2}|${hourWordPattern})(?![\p{L}\p{N}])`,
  "giu",
);
const durationUnit = String.raw`\s*(?:h|std|stunden?|min|minuten?)(?!\p{L})`;
// "13", "13:30", "9.45", "9.45." at a sentence end. A number before a
// duration unit ("3 Stunden") is no clock time; neither is a date, which the
// callers skip.
const digitTime = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,:/])(\d{1,2})(?:[:.](\d{2})(?!\.?\p{N}))?(?!\p{N}|[.,:]\p{N}|${durationUnit})`,
  "giu",
);
// "neun" in "von neun bis elf". "ein" and "eine" are articles more often.
const bareHourWord = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${[...hourWords.keys()]
    .filter((word) => word !== "ein" && word !== "eine")
    .join("|")})(?![\p{L}\p{N}]|${durationUnit})`,
  "giu",
);
const minuteWordPattern = [...minuteWords.keys()]
  .sort((a, b) => b.length - a.length)
  .join("|");
const minutesAfterUhr = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:\d{1,2}|${hourWordPattern})\s*uhr\s+(\d{1,2}|${minuteWordPattern})(?![\p{L}\p{N}]|${durationUnit})`,
  "giu",
);
export function writtenMinutes(request: string): number[] {
  const inDate = dates(request);
  const minutes = [
    ...[...request.matchAll(digitTime)]
      .filter((m) => !within(inDate, m.index))
      .map((m) => (m[2] === undefined ? undefined : Number(m[2]))),
    ...[...request.matchAll(minutesAfterUhr)].map(
      (m) => Number(m[1]) || minuteWords.get(m[1]!.toLowerCase()),
    ),
  ].filter((minute): minute is number => minute !== undefined && minute < 60);
  return [...new Set(minutes)].sort((a, b) => a - b);
}
/** A clock time code reads without doubt, in minutes after midnight. */
type ClockTime = Span & { minutes: number };
function clockTimes(request: string): ClockTime[] {
  const taken = dates(request);
  const times: ClockTime[] = [];
  const free = (at: number, end: number) =>
    ![...taken, ...times].some((span) => at < span.end && end > span.at);
  for (const m of request.matchAll(relativeTime)) {
    const hour = Number(m[2]) || hourWords.get(m[2]!.toLowerCase());
    const [back, minutes] =
      relativeClock[
        m[1]!.toLowerCase().replace(/\s+/g, " ") as keyof typeof relativeClock
      ];
    if (hour !== undefined && hour <= 24)
      times.push({
        at: m.index,
        end: m.index + m[0].length,
        minutes: (hour + back) * 60 + minutes,
      });
  }
  for (const m of request.matchAll(digitTime)) {
    const [hour, minutes] = [Number(m[1]), Number(m[2] ?? 0)];
    const end = m.index + m[0].length;
    if (hour <= 24 && minutes < 60 && free(m.index, end))
      times.push({ at: m.index, end, minutes: hour * 60 + minutes });
  }
  for (const m of request.matchAll(bareHourWord)) {
    const end = m.index + m[0].length;
    if (free(m.index, end))
      times.push({
        at: m.index,
        end,
        minutes: hourWords.get(m[1]!.toLowerCase())! * 60,
      });
  }
  return times.sort((a, b) => a.at - b.at);
}
const rangeSeparator = /(?:\bbis(?:\s+um)?|[-–])\s*$/iu;
const noon = 12 * 60;
/** Two clock times the request writes as a range, in minutes after midnight. */
export type TimeRange = { text: string; from: number; to: number };
/**
 * Every range from a clock time to the next one that a separator right before
 * it ends ("von 13 bis 15 uhr", "9-11", "bis um 15"). An end before a morning
 * start is in the afternoon ("von 11 bis 1" ends at 13:00), unless it is hour 0.
 */
export function timeRanges(request: string): TimeRange[] {
  const times = clockTimes(request);
  return times.slice(1).flatMap((to, i) => {
    const from = times[i]!;
    return rangeSeparator.test(request.slice(from.end, to.at))
      ? [
          {
            text: request.slice(from.at, to.end),
            from: from.minutes,
            to:
              to.minutes < from.minutes &&
              from.minutes < noon &&
              to.minutes >= 60
                ? to.minutes + noon
                : to.minutes,
          },
        ]
      : [];
  });
}
