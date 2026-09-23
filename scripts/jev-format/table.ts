import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatDir } from "./bench.js";
import type { Row } from "./run.js";

// Ranks variants against identity. Accuracy counts are means over a variant's
// samples; the identity baseline pools identity@n and the recorded answers.
// Noise: each identity sample against the mean of the other identity samples.
const { values } = parseArgs({
  options: {
    results: { type: "string", default: join(formatDir, "results") },
    out: { type: "string", default: join(formatDir, "table.md") },
  },
});
const files = (await readdir(values.results)).filter((f) =>
  f.endsWith(".json"),
);
const runs = new Map<string, Row[][]>();
for (const file of files.sort()) {
  const name = file.replace(/@\d+\.json$/, "");
  const rows: Row[] = JSON.parse(
    await readFile(join(values.results, file), "utf8"),
  );
  runs.set(name, [...(runs.get(name) ?? []), rows]);
}
const baseline = [
  ...(runs.get("identity") ?? []),
  ...(runs.get("recorded") ?? []),
];
if (baseline.length < 2) throw new Error("need at least two identity samples");

const groups = ["holdout-1", "holdout-2", "all"] as const;
type Group = (typeof groups)[number];
const inGroup = (group: Group) => (r: Row) =>
  group === "all" || r.holdout === group;
type Counts = {
  correct: number;
  wrong: number;
  hardWrong: number;
  stop: number;
  top1: number;
  /** Mean probability on the safe options, in percent. */
  mass: number;
  errors: number;
};
function counts(rows: Row[]): Counts {
  const ok = rows.filter((r) => r.error === null);
  return {
    correct: ok.filter((r) => r.act && r.safe).length,
    wrong: ok.filter((r) => r.act && !r.safe).length,
    hardWrong: ok.filter((r) => r.act && !r.safe && r.kind !== "view").length,
    stop: ok.filter((r) => !r.act).length,
    top1: ok.filter((r) => r.safe).length,
    mass: (100 * ok.reduce((s, r) => s + r.safeMass, 0)) / (ok.length || 1),
    errors: rows.length - ok.length,
  };
}
const keys = [
  "correct",
  "wrong",
  "hardWrong",
  "stop",
  "top1",
  "mass",
  "errors",
] as const;
function mean(samples: Row[][], group: Group): Counts {
  const each = samples.map((rows) => counts(rows.filter(inGroup(group))));
  return Object.fromEntries(
    keys.map((k) => [k, each.reduce((s, c) => s + c[k], 0) / each.length]),
  ) as Counts;
}
/** Largest leave-one-out difference of the identity samples, per count. */
function noise(group: Group) {
  const each = baseline.map((rows) => counts(rows.filter(inGroup(group))));
  return Object.fromEntries(
    keys.map((k) => [
      k,
      Math.max(
        ...each.map((c, i) => {
          const others = each.filter((_, j) => j !== i);
          return Math.abs(
            c[k] - others.reduce((s, o) => s + o[k], 0) / others.length,
          );
        }),
      ),
    ]),
  ) as Counts;
}
const tokens = (
  samples: Row[][],
  group: Group,
  pick: (r: Row) => number | null,
) => {
  const all = samples
    .flatMap((rows) => rows.filter(inGroup(group)))
    .map(pick)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return all.length ? all.reduce((s, v) => s + v, 0) / all.length : NaN;
};

const base = Object.fromEntries(groups.map((g) => [g, mean(baseline, g)]));
const band = Object.fromEntries(groups.map((g) => [g, noise(g)]));
const identityRuns = runs.get("identity") ?? [];
const baseTokens = Object.fromEntries(
  groups.map((g) => [g, tokens(identityRuns, g, (r) => r.decideTokens)]),
);
const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const flag = (delta: number, limit: number) =>
  Math.abs(delta) > limit ? `**${signed(delta)}**` : signed(delta);

type Line = {
  name: string;
  group: Group;
  samples: number;
  score: number;
  cells: string[];
};
const lines: Line[] = [];
for (const [name, samples] of runs) {
  if (name === "recorded") continue;
  for (const group of groups) {
    const c = mean(samples, group);
    const b = base[group]!;
    const n = band[group]!;
    const decide = tokens(samples, group, (r) => r.decideTokens);
    const check = tokens(samples, group, (r) => r.checkTokens);
    const saved = 1 - decide / baseTokens[group]!;
    lines.push({
      name,
      group,
      samples: samples.length,
      score: c.correct - b.correct - 2 * (c.hardWrong - b.hardWrong),
      cells: [
        name,
        String(samples.length),
        `${fmt(c.correct)} (${flag(c.correct - b.correct, n.correct)})`,
        `${fmt(c.wrong)} (${flag(c.wrong - b.wrong, n.wrong)})`,
        `${fmt(c.hardWrong)} (${flag(c.hardWrong - b.hardWrong, n.hardWrong)})`,
        `${fmt(c.stop)} (${flag(c.stop - b.stop, n.stop)})`,
        `${fmt(c.top1)} (${flag(c.top1 - b.top1, n.top1)})`,
        `${c.mass.toFixed(1)} (${flag(Math.round((c.mass - b.mass) * 10) / 10, n.mass)})`,
        `${Math.round(decide)}`,
        `${signed(Math.round(saved * 1000) / 10)} %`,
        Number.isNaN(check) ? "-" : `${Math.round(check)}`,
        fmt(c.errors),
      ],
    });
  }
}
const header = [
  "| variant | samples | act-correct (Δ) | act-wrong (Δ) | of which not a view (Δ) | stop (Δ) | top1-safe (Δ) | safe mass % (Δ) | decide input tokens | tokens saved | check input tokens | errors |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
const section = (group: Group) => {
  const b = base[group]!;
  const n = band[group]!;
  const states = baseline[0]!.filter(inGroup(group)).length;
  return [
    `## ${group} (${states} states)`,
    "",
    `Identity baseline (${baseline.length} samples${runs.has("recorded") ? " incl. the recorded answers" : ""}): act-correct ${fmt(b.correct)}, act-wrong ${fmt(b.wrong)} (not a view ${fmt(b.hardWrong)}), stop ${fmt(b.stop)}, top1-safe ${fmt(b.top1)}, decide input tokens ${Math.round(baseTokens[group]!)}. Noise (largest leave-one-out gap of one identity sample): act-correct ±${fmt(n.correct)}, act-wrong ±${fmt(n.wrong)}, not a view ±${fmt(n.hardWrong)}, stop ±${fmt(n.stop)}, top1-safe ±${fmt(n.top1)}, safe mass ±${n.mass.toFixed(1)} points (baseline ${b.mass.toFixed(1)} %). Bold: beyond that gap.`,
    "",
    ...header,
    ...lines
      .filter((l) => l.group === group)
      .sort((a, b) => b.score - a.score)
      .map((l) => `| ${l.cells.join(" | ")} |`),
    "",
  ];
};
const markdown = [
  "# Format bench (g3 gate)",
  "",
  "Rows sorted by act-correct gain minus twice the gain in wrong acts that are not views. Tokens: provider-reported input tokens of the decide call, mean per state; check tokens: mean per asked effect or completion check.",
  "",
  ...groups.flatMap(section),
].join("\n");
await writeFile(values.out, markdown);
process.stdout.write(`${markdown}\n`);
