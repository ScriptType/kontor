import { randomUUID } from "node:crypto";
import { appendFile, link, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SaveMode } from "./harness.js";
import type { Outcome, Stop, Verdict } from "./judge.js";
import type { Scenario } from "./scenarios.js";

export type SampleResult = Verdict & {
  variant: string;
  saveMode: SaveMode;
  scenarioId: string;
  source: Scenario["source"];
  sample: number;
  request: string;
  stops: Stop[];
  steps: string[];
  coverageProbability: number | null;
  unmappedActions: string[];
  calls: number;
  wallMs: number;
  error: string | null;
};
export type Summary = {
  samples: number;
  magic: number;
  handoff: number;
  correctAfterAnswers: number;
  stoppedUnanswered: number;
  stoppedUnansweredEndCorrect: number;
  askedWrong: number;
  silentWrong: number;
  errors: number;
  magicSaveCheck: number;
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
    handoff: count(results, "handoff"),
    correctAfterAnswers: count(results, "correct-after-answers"),
    stoppedUnanswered: count(results, "stopped-unanswered"),
    stoppedUnansweredEndCorrect: results.filter(
      (r) => r.outcome === "stopped-unanswered" && r.endCorrect,
    ).length,
    askedWrong: count(results, "asked-wrong"),
    silentWrong: count(results, "silent-wrong"),
    errors: count(results, "error"),
    magicSaveCheck: results.filter((r) => r.magicSaveCheck).length,
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
    [
      "regression",
      results.filter(
        (r) => r.source === "regression" || r.source === "use-case",
      ),
    ],
    ["generated", results.filter((r) => r.source === "generated")],
    ["authored", results.filter((r) => r.source === "authored")],
  ];
  return Object.fromEntries(
    groups
      .filter(([name, group]) => name === "all" || group.length)
      .map(([name, group]) => [name, summarize(group)]),
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
      `| ${group} | ${s.samples} | ${share(s.magic, s.samples)} | ${share(s.magicSaveCheck, s.samples)} | ${share(s.handoff, s.samples)} | ${share(s.correctAfterAnswers, s.samples)} | ${share(s.stoppedUnanswered, s.samples)} (${s.stoppedUnansweredEndCorrect}) | ${share(s.askedWrong, s.samples)} | ${share(s.silentWrong, s.samples)} | ${s.errors} | ${s.questionsMean.toFixed(2)} | ${share(s.withQuestions, s.samples)} | ${s.callsMean.toFixed(1)} (${s.callsTotal}) | ${(s.wallMeanMs / 1000).toFixed(1)} s |`,
  );
  const samples = results.map(
    (r) =>
      `| ${r.scenarioId} #${r.sample} | ${r.outcome} | ${r.endCorrect ? "yes" : "no"} | ${r.questions} | ${cell(r.stops.map((s) => `${s.kind}${s.dimension ? `:${s.dimension}` : ""}`).join(", "))} | ${cell([...r.mismatches, ...r.unexpectedSaves.map((s) => `unexpected save: ${s}`), ...(r.error ? [`error: ${r.error}`] : [])].join("; "))} | ${r.coverageProbability?.toFixed(2) ?? ""} | ${r.calls} | ${(r.wallMs / 1000).toFixed(1)} |`,
  );
  return [
    `# Jev eval · ${variant}`,
    "",
    ...Object.entries(meta).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "Magic: end state correct, no question and no handoff. Handoff: end state correct and the run stopped for the expected human handoff. Correct after chips: end state correct and every question was a chip the harness answered. Stopped unanswered: the run ended at a question the harness cannot answer; the number in brackets ended there with a correct state. Asked, still wrong: chips answered, end state wrong. Silent-wrong: end state wrong or an unexpected save, and no question. Magic-save-check: magic, or correct after chips where every chip asked whether to save; in auto save mode no save chip appears and it equals magic. Rates count every sample; errors are provider or harness failures.",
    "",
    "| group | samples | magic | magic-save-check | handoff | correct after chips | stopped unanswered (end correct) | asked, still wrong | silent-wrong | errors | questions mean | ≥1 question | calls mean (total) | wall mean |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "| sample | outcome | end correct | questions | stops | mismatches | coverage | calls | wall s |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...samples,
    "",
  ].join("\n");
}

export async function appendTsv(
  path: string,
  row: [header: string, value: string | number][],
) {
  const line = (cells: (string | number)[]) =>
    `${cells.map((c) => String(c).replace(/[\t\r\n]+/g, " ")).join("\t")}\n`;
  const entry = line(row.map(([, value]) => value));
  await mkdir(dirname(path), { recursive: true });
  const fresh = `${path}.${randomUUID()}`;
  await writeFile(fresh, line(row.map(([header]) => header)) + entry);
  try {
    await link(fresh, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await appendFile(path, entry);
  } finally {
    await unlink(fresh);
  }
}
