import type { Outcome, Stop, Verdict } from "./judge.js";
import type { Scenario } from "./scenarios.js";

export type SampleResult = Verdict & {
  variant: string;
  scenarioId: string;
  source: Scenario["source"];
  sample: number;
  request: string;
  stops: Stop[];
  steps: string[];
  unmappedActions: string[];
  calls: number;
  wallMs: number;
  error: string | null;
};
export type Summary = {
  samples: number;
  magic: number;
  correctAfterQuestions: number;
  askedWrong: number;
  silentWrong: number;
  errors: number;
  questionsMean: number;
  withQuestions: number;
  callsMean: number;
  callsTotal: number;
  wallMeanMs: number;
  wallTotalMs: number;
};

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
const count = (results: SampleResult[], outcome: Outcome) =>
  results.filter((r) => r.outcome === outcome).length;
export function summarize(results: SampleResult[]): Summary {
  return {
    samples: results.length,
    magic: count(results, "magic"),
    correctAfterQuestions: count(results, "correct-after-questions"),
    askedWrong: count(results, "asked-wrong"),
    silentWrong: count(results, "silent-wrong"),
    errors: count(results, "error"),
    questionsMean: mean(results.map((r) => r.questions)),
    withQuestions: results.filter((r) => r.questions > 0).length,
    callsMean: mean(results.map((r) => r.calls)),
    callsTotal: results.reduce((sum, r) => sum + r.calls, 0),
    wallMeanMs: mean(results.map((r) => r.wallMs)),
    wallTotalMs: results.reduce((sum, r) => sum + r.wallMs, 0),
  };
}
export function summaries(results: SampleResult[]) {
  const groups: [string, SampleResult[]][] = [
    ["all", results],
    ["regression", results.filter((r) => r.source !== "generated")],
    ["generated", results.filter((r) => r.source === "generated")],
  ];
  return Object.fromEntries(
    groups.map(([name, group]) => [name, summarize(group)]),
  );
}

const share = (part: number, total: number) =>
  total ? `${part}/${total} (${Math.round((part / total) * 100)} %)` : "0/0";
const cell = (text: string) =>
  text.replaceAll("|", "\\|").replaceAll("\n", " ");
export function markdown(
  variant: string,
  results: SampleResult[],
  meta: Record<string, string | number>,
) {
  const rows = Object.entries(summaries(results)).map(
    ([group, s]) =>
      `| ${group} | ${s.samples} | ${share(s.magic, s.samples)} | ${s.questionsMean.toFixed(2)} | ${share(s.withQuestions, s.samples)} | ${share(s.silentWrong, s.samples)} | ${share(s.correctAfterQuestions, s.samples)} | ${share(s.askedWrong, s.samples)} | ${s.errors} | ${s.callsMean.toFixed(1)} (${s.callsTotal}) | ${(s.wallMeanMs / 1000).toFixed(1)} s |`,
  );
  const samples = results.map(
    (r) =>
      `| ${r.scenarioId} #${r.sample} | ${r.outcome} | ${r.questions} | ${cell(r.stops.map((s) => `${s.kind}${s.dimension ? `:${s.dimension}` : ""}`).join(", "))} | ${cell([...r.mismatches, ...r.unexpectedSaves.map((s) => `unexpected save: ${s}`), ...(r.error ? [`error: ${r.error}`] : [])].join("; "))} | ${r.calls} | ${(r.wallMs / 1000).toFixed(1)} |`,
  );
  return [
    `# Jev eval · ${variant}`,
    "",
    ...Object.entries(meta).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "Magic: end state correct and no question. Silent-wrong: end state wrong or an unexpected save, and no question. Rates count every sample; errors are provider or harness failures.",
    "",
    "| group | samples | magic | questions mean | ≥1 question | silent-wrong | correct after questions | asked, still wrong | errors | calls mean (total) | wall mean |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "| sample | outcome | questions | stops | mismatches | calls | wall s |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...samples,
    "",
  ].join("\n");
}
