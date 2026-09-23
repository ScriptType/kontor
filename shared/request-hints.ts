import { z } from "zod";
import type { Workspace } from "./domain.js";
import { requestNumbers } from "./field-values.js";

const mentionSchema = z.object({
  mention: z.string(),
  id: z.string(),
  name: z.string(),
});
/** A list ordinal of the request bound to the case Jev opened at that row. */
export const listOrdinalSchema = z.object({
  mention: z.string(),
  caseId: z.string(),
  openedAtRow: z.number(),
});
export const requestHintsSchema = z.object({
  numbers: z.array(
    z.object({
      value: z.number(),
      from: z.string().optional(),
      fields: z.array(z.string()),
      cases: z.array(z.string()),
      tiedByFieldWord: z.boolean(),
    }),
  ),
  cases: z.array(z.string()),
  technicians: z.array(mentionSchema),
  customers: z.array(mentionSchema),
  pageWordsInOrder: z.array(z.string()),
  listOrdinals: z.array(listOrdinalSchema).optional(),
});
export type RequestHints = z.infer<typeof requestHintsSchema>;

const pageCues: [string, RegExp][] = [
  ["cases", /vorg[aä]ng|auftr[aä]g|fallliste|liste/giu],
  ["customers", /kunde/giu],
  ["team", /team|kapazit|auslastung/giu],
  ["reports", /bericht|report|auswertung|statistik/giu],
];
/** Edits between two words, a swap of neighbouring letters counting as one. */
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
          ? d[i - 2]![j - 2]! + 1
          : Infinity,
      );
    }
  return d[a.length]![b.length]!;
}
const commonWords = new Set(["haben", "neben", "leben", "lesen", "mehr"]);
const resembles = (token: string, word: string) =>
  token.length >= 3 &&
  !commonWords.has(token) &&
  (token === word ||
    (token.length >= 4 && (word.startsWith(token) || token.startsWith(word))) ||
    (token.length >= 4 && token[0] === word[0] && distance(token, word) <= 1));
/**
 * What code can read from the request before Jev does: numbers with the
 * fields and cases their clause ties them to, named cases in the order the
 * request names them, technicians and customers a word resembles (one typo
 * or swapped letter pair still counts), and page words in order.
 */
export function requestHints(
  request: string,
  workspace: Pick<Workspace, "cases" | "technicians" | "customers">,
): RequestHints {
  const tokens = request.toLowerCase().match(/\p{L}+/gu) ?? [];
  const mention = (words: string[]) => [
    ...new Set(
      tokens.filter((t) => words.some((w) => resembles(t, w.toLowerCase()))),
    ),
  ];
  const cases = workspace.cases.map((c) => c.id);
  const digits = (id: string) => id.replace(/\D/g, "");
  return {
    numbers: requestNumbers(request, cases).map((n) => ({
      value: Number(n.value),
      ...(n.span === undefined ? {} : { from: n.span }),
      fields: n.fields,
      cases: n.cases,
      tiedByFieldWord: n.bound,
    })),
    cases: cases
      .map((id) => ({
        id,
        at: request.search(
          new RegExp(
            `(?<!\\d)${digits(id).slice(0, 2)}\\s?${digits(id).slice(2)}(?!\\d)`,
          ),
        ),
      }))
      .filter((c) => c.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((c) => c.id),
    technicians: workspace.technicians.flatMap((t) => {
      const found = mention(t.name.split(" "));
      return found.length
        ? [{ mention: found.join(" "), id: t.id, name: t.name }]
        : [];
    }),
    customers: workspace.customers.flatMap((c) => {
      const words = c.name
        .split(/[\s&]+/)
        .filter((w) => w.length >= 4 && !/^(gmbh|partner)$/i.test(w));
      const found = mention(words);
      return found.length
        ? [{ mention: found.join(" "), id: c.id, name: c.name }]
        : [];
    }),
    pageWordsInOrder: pageCues
      .flatMap(([page, cue]) =>
        [...request.matchAll(cue)].map((m) => ({ page, at: m.index })),
      )
      .sort((a, b) => a.at - b.at)
      .map((m) => m.page)
      .filter((page, i, all) => page !== all[i - 1]),
  };
}

const ordinalRows: [RegExp, number][] = [
  [/^(erst|oberst|ober)/, 1],
  [/^zweit/, 2],
  [/^dritt/, 3],
  [/^viert/, 4],
  [/^fünft/, 5],
  [/^(letzt|unterst|unter)/, -1],
];
/** List rows the request names with an article, 1 for the first and -1 for the last. */
export function requestOrdinals(request: string) {
  return [
    ...request.matchAll(
      /\b(?:den|die|das|der|dem)\s+((?:erst|zweit|dritt|viert|fünft|letzt|oberst|ober|unterst|unter)(?:e|en|er|es|em))\b/giu,
    ),
  ].flatMap((match) => {
    const row = ordinalRows.find(([word]) =>
      word.test(match[1]!.toLowerCase()),
    )?.[1];
    return row === undefined ? [] : [{ mention: match[0], row }];
  });
}
