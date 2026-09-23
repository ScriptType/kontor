import { germanWord } from "./number-words.js";

/** The hour words 1 to 24 ("eins", "ein", "eine", "zwei" … "vierundzwanzig"), with their hour. */
const hourWords = new Map(
  Array.from({ length: 24 }, (_, i) =>
    germanWord(i + 1)
      .split(" / ")
      .map((word) => [word, i + 1] as const),
  ).flat(),
);
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
