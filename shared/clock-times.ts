import { germanWord } from "./number-words.js";

const numberWords = (upTo: number) =>
  new Map(
    Array.from({ length: upTo }, (_, i) =>
      germanWord(i + 1).map((word) => [word, i + 1] as const),
    ).flat(),
  );
const hourWords = numberWords(24);
const minuteWords = numberWords(59);
// Digits after a colon are minutes, not an hour.
const hourDigits = /(?<![\p{N}:])\d{1,2}(?!\p{N})/gu;
/**
 * Every hour number the request writes, in digits (0 to 24, also before ":"
 * or ".") or as a number word (1 to 24), ascending. Code offers only these as
 * the hour of a clock time: "halb elf" can only be hour 11.
 */
export function writtenHours(request: string): number[] {
  const hours = [
    ...[...request.matchAll(hourDigits)].map((m) => Number(m[0])),
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
// "13", "13:30", "9.45". A "24.09." is a day, and a number before a duration
// unit ("3 Stunden") is no clock time.
const digitTime =
  /(?<![\p{L}\p{N}.,:/])(\d{1,2})(?:[:.](\d{2})(?![.\p{N}]))?(?![\p{N}]|[.,:]\p{N}|\s?(?:h|std|stunden?|min|minuten?)(?!\p{L}))/giu;
const minuteWordPattern = [...minuteWords.keys()]
  .sort((a, b) => b.length - a.length)
  .join("|");
const durationUnit = String.raw`\s*(?:h|std|stunden?|min|minuten?)(?!\p{L})`;
const minutesAfterUhr = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:\d{1,2}|${hourWordPattern})\s*uhr\s+(\d{1,2}|${minuteWordPattern})(?![\p{L}\p{N}]|${durationUnit})`,
  "giu",
);
export function writtenMinutes(request: string): number[] {
  const minutes = [
    ...[...request.matchAll(digitTime)].map((m) =>
      m[2] === undefined ? undefined : Number(m[2]),
    ),
    ...[...request.matchAll(minutesAfterUhr)].map(
      (m) => Number(m[1]) || minuteWords.get(m[1]!.toLowerCase()),
    ),
  ].filter((minute): minute is number => minute !== undefined && minute < 60);
  return [...new Set(minutes)].sort((a, b) => a - b);
}
const isoDate = /\d{4}-\d{2}-\d{2}/g;
/** A clock time code reads without doubt, in minutes after midnight. */
type ClockTime = { at: number; end: number; minutes: number };
function clockTimes(request: string): ClockTime[] {
  const dates = [...request.matchAll(isoDate)].map((m) => ({
    at: m.index,
    end: m.index + m[0].length,
  }));
  const times: ClockTime[] = [];
  const free = (at: number, end: number) =>
    ![...dates, ...times].some((span) => at < span.end && end > span.at);
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
  return times.sort((a, b) => a.at - b.at);
}
const rangeSeparator = /(?:\bbis|[-–])\s*$/iu;
/** Two clock times the request writes as a range, in minutes after midnight. */
export type TimeRange = { text: string; from: number; to: number };
/** Every range from a clock time to the next one that a separator right before it ends ("von 13 bis 15 uhr", "9-11"). */
export function timeRanges(request: string): TimeRange[] {
  const times = clockTimes(request);
  return times.slice(1).flatMap((to, i) => {
    const from = times[i]!;
    return rangeSeparator.test(request.slice(from.end, to.at))
      ? [
          {
            text: request.slice(from.at, to.end),
            from: from.minutes,
            to: to.minutes,
          },
        ]
      : [];
  });
}
