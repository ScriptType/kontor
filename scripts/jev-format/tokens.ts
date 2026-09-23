import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatDir } from "./bench.js";

// Token and size statistics over every recorded decide and check call.
type DecideCall = {
  holdout: string;
  duel?: boolean;
  onPath: boolean;
  steps: number;
  options: number;
  inputTokens: number;
  outputTokens: number;
  chars: number;
  parts: Record<string, number>;
};
const recorded = JSON.parse(
  await readFile(join(formatDir, "calls.json"), "utf8"),
) as {
  decideCalls: DecideCall[];
  assessCalls: { selected: string; inputTokens: number }[];
};
const { assessCalls } = recorded;
// A duel's second look sends the same state with two options; it is
// counted apart so the part sizes describe the first decide.
const decideCalls = recorded.decideCalls.filter((c) => !c.duel);
const duels = recorded.decideCalls.filter((c) => c.duel);
const mean = (values: number[]) =>
  values.reduce((s, v) => s + v, 0) / (values.length || 1);
/** A part's tokens, estimated from its share of its call's characters. */
const tokensOf = (c: DecideCall, part: number) =>
  (part * c.inputTokens) / c.chars;
const quantile = (values: number[], q: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  );
};
const round = (n: number) => (n < 10 ? n.toFixed(2) : String(Math.round(n)));
const row = (label: string, values: number[]) =>
  `| ${label} | ${round(quantile(values, 0.5))} | ${round(quantile(values, 0.9))} | ${round(Math.max(...values))} | ${round(values.reduce((s, v) => s + v, 0) / values.length)} |`;
const partNames = [
  ...new Set(decideCalls.flatMap((c) => Object.keys(c.parts))),
].toSorted(
  (a, b) =>
    decideCalls.reduce((s, c) => s + (c.parts[b] ?? 0), 0) -
    decideCalls.reduce((s, c) => s + (c.parts[a] ?? 0), 0),
);
const totalChars = decideCalls.reduce((s, c) => s + c.chars, 0);
const byDepth = Object.entries(
  Object.groupBy(decideCalls, (c) => String(Math.min(c.steps, 6))),
);
const lines = [
  "# Token statistics of recorded decide and check calls",
  "",
  `${decideCalls.length} decide calls (${decideCalls.filter((c) => c.onPath).length} on the human path), ${duels.length} duel calls (mean ${Math.round(mean(duels.map((c) => c.inputTokens)))} input tokens), ${assessCalls.length} check calls, recorded in ${formatDir}. Tokens are the provider's reported usage.`,
  "",
  "| measure | median | p90 | max | mean |",
  "| --- | --- | --- | --- | --- |",
  row(
    "decide input tokens",
    decideCalls.map((c) => c.inputTokens),
  ),
  row(
    "decide output tokens",
    decideCalls.map((c) => c.outputTokens),
  ),
  row(
    "decide request chars",
    decideCalls.map((c) => c.chars),
  ),
  row(
    "chars per input token",
    decideCalls.map((c) => c.chars / c.inputTokens),
  ),
  row(
    "options per decide",
    decideCalls.map((c) => c.options),
  ),
  row(
    "check input tokens (done)",
    assessCalls.filter((c) => c.selected === "done").map((c) => c.inputTokens),
  ),
  row(
    "check input tokens (action)",
    assessCalls.filter((c) => c.selected !== "done").map((c) => c.inputTokens),
  ),
  "",
  "Decide input tokens by executed steps before the call:",
  "",
  "| steps | calls | median tokens | mean tokens | mean observedSteps tokens (est.) |",
  "| --- | --- | --- | --- | --- |",
  ...byDepth.map(
    ([depth, calls]) =>
      `| ${depth === "6" ? "6+" : depth} | ${calls!.length} | ${Math.round(
        quantile(
          calls!.map((c) => c.inputTokens),
          0.5,
        ),
      )} | ${Math.round(mean(calls!.map((c) => c.inputTokens)))} | ${Math.round(mean(calls!.map((c) => tokensOf(c, c.parts["observedSteps"] ?? 0))))} |`,
  ),
  "",
  "Characters per part of the decide request (JSON of the part; options and instructions as sent). Tokens per part are estimated from the part's share of its call's characters:",
  "",
  "| part | median chars | p90 | max | mean chars | mean tokens (est.) | share of all request chars |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...partNames.map((name) => {
    const values = decideCalls.map((c) => c.parts[name] ?? 0);
    const share = values.reduce((s, v) => s + v, 0) / totalChars;
    return `| ${name} | ${Math.round(quantile(values, 0.5))} | ${Math.round(quantile(values, 0.9))} | ${Math.max(...values)} | ${Math.round(mean(values))} | ${Math.round(mean(decideCalls.map((c) => tokensOf(c, c.parts[name] ?? 0))))} | ${(share * 100).toFixed(1)} % |`;
  }),
  "",
];
await writeFile(join(formatDir, "tokens.md"), lines.join("\n"));
process.stdout.write(lines.join("\n"));
