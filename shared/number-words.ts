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
export function germanWord(n: number): string {
  if (n === 100) return "hundert";
  if (n < 10) return n === 1 ? "eins / ein / eine" : ones[n]!;
  if (n < 20) return teens[n - 10]!;
  const unit = n % 10;
  const ten = tens[Math.floor(n / 10)]!;
  return unit ? `${unit === 1 ? "ein" : ones[unit]}und${ten}` : ten;
}
const clockBefore = /(?:\bum|\bgegen|\bhalb|\bviertel)\s$/iu;
/** "zehn nach drei", "zwanzig vor elf": minutes before or after an hour on the clock. */
const clockAfter = /^\s(?:vor|nach)\s/iu;
const hourAfterVorNach = /(?:\bvor|\bnach)\s$/iu;
const minuteUnit = /^\s?(?:min|minuten?)\b/iu;
/**
 * Every number from 10 to 100 the request writes as a word ("achtzig"), except
 * a clock time ("halb elf", "zwanzig vor elf", "zehn nach drei") and a word
 * next to another number word, which belongs to a longer spoken number such
 * as a case id.
 */
export function spokenNumbers(request: string) {
  const words = new Map(
    Array.from({ length: 91 }, (_, i) => [germanWord(i + 10), i + 10]),
  );
  const found = [...request.matchAll(/\p{L}+/gu)].map((m, i) => ({
    i,
    text: m[0],
    at: m.index,
    value: words.get(m[0].toLowerCase()),
  }));
  const number = (i: number) => found[i]?.value !== undefined;
  return found.flatMap(({ i, text, at, value }) => {
    const before = request.slice(Math.max(0, at - 12), at);
    const after = request.slice(at + text.length);
    return value === undefined ||
      number(i - 1) ||
      number(i + 1) ||
      clockBefore.test(before) ||
      clockAfter.test(after) ||
      (hourAfterVorNach.test(before) && !minuteUnit.test(after))
      ? []
      : [{ text, at, value }];
  });
}
