import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { z } from "zod";
import { readConfig } from "../../server/config.js";
import {
  confidencePercent,
  runSample,
  saveModes,
  type Budget,
} from "./harness.js";
import {
  appendTsv,
  markdown,
  summaries,
  summarize,
  type SampleResult,
} from "./report.js";
import { readScenarios, scenarioProblems } from "./scenario-files.js";
import { allScenarios } from "./scenarios.js";

const { values } = parseArgs({
  options: {
    variant: { type: "string", default: "unlabeled" },
    seed: { type: "string", default: "880001" },
    count: { type: "string", default: "30" },
    samples: { type: "string", default: "1" },
    only: { type: "string" },
    concurrency: { type: "string", default: "1" },
    out: { type: "string" },
    "max-calls": { type: "string", default: "600" },
    scenarios: { type: "string" },
    "save-mode": { type: "string", default: "auto" },
  },
});
const whole = z.coerce.number().int();
const variant = z
  .string()
  .regex(/^[\w.-]+$/)
  .parse(values.variant);
const seed = whole.parse(values.seed);
const count = whole.min(0).parse(values.count);
const samples = whole.min(1).max(10).parse(values.samples);
const concurrency = whole.min(1).max(8).parse(values.concurrency);
const saveMode = z.enum(saveModes).parse(values["save-mode"]);
const budget: Budget = {
  used: 0,
  limit: whole.min(1).parse(values["max-calls"]),
};
const only = values.only?.split(",");
const out =
  values.out ??
  join(
    "live-results",
    "jev-eval",
    `${variant}-${new Date().toISOString().replaceAll(":", "-")}`,
  );

const file = values.scenarios ? await readScenarios(values.scenarios) : null;
const scenarios = (file?.scenarios ?? allScenarios({ seed, count })).filter(
  (s) => !only || only.includes(s.id),
);
const unknown = only?.filter((id) => !scenarios.some((s) => s.id === id));
if (!scenarios.length || unknown?.length)
  throw new Error(`Unknown scenario: ${unknown?.join(", ")}`);
const problems = scenarioProblems(scenarios);
if (problems.length) throw new Error(problems.join("\n"));
const scenariosJson = JSON.stringify(scenarios, null, 2);
const jobs = scenarios.flatMap((scenario) =>
  Array.from({ length: Math.max(samples, scenario.minSamples) }, (_, i) => ({
    scenario,
    sample: i + 1,
  })),
);
const scenariosSha256 =
  file?.sha256 ?? createHash("sha256").update(scenariosJson).digest("hex");
const config = readConfig({ ...process.env, TYPESAFE_MODE: "live" });
const git = (...args: string[]) => execFileSync("git", args).toString().trim();
const commit = `${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain", "--untracked-files=no") ? "-dirty" : ""}`;
const runIndex = join(
  dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir")),
  "live-results",
  "jev-eval-runs.tsv",
);
const meta = {
  variant,
  commit,
  model: config.mode === "live" ? config.model : "demo",
  ...(values.scenarios ? { scenarios: values.scenarios } : { seed, count }),
  ...(only ? { only: only.join(",") } : {}),
  "scenarios sha256": scenariosSha256,
  samples,
  concurrency,
  "confidence threshold": `${confidencePercent} %`,
  "save mode": saveMode,
  started: new Date().toISOString(),
};
await mkdir(join(out, "samples"), { recursive: true });
await writeFile(join(out, "scenarios.json"), scenariosJson);

const results: SampleResult[] = [];
const write = () =>
  Promise.all([
    writeFile(
      join(out, "results.json"),
      JSON.stringify(
        {
          meta: { ...meta, calls: budget.used },
          summary: summaries(results),
          samples: results,
        },
        null,
        2,
      ),
    ),
    writeFile(
      join(out, "report.md"),
      markdown(variant, results, { ...meta, calls: budget.used }),
    ),
  ]);
const browser = await chromium.launch({ channel: "chrome" });
try {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let job = jobs[next++]; job; job = jobs[next++]) {
        const { observed, callLog, ...result } = await runSample({
          browser,
          config,
          variant,
          saveMode,
          budget,
          ...job,
        });
        results.push(result);
        await writeFile(
          join(out, "samples", `${job.scenario.id}__${job.sample}.json`),
          JSON.stringify(
            { result, observed, callLog, scenario: job.scenario },
            null,
            2,
          ),
        );
        await write();
        process.stdout.write(
          `${result.scenarioId} #${result.sample} ${result.outcome} q=${result.questions} calls=${result.calls} ${(result.wallMs / 1000).toFixed(1)}s ${[...result.mismatches, ...result.unexpectedSaves, ...(result.error ? [result.error] : [])].join("; ")}\n`,
        );
      }
    }),
  );
} finally {
  await browser.close();
  await write();
  const all = summarize(results);
  await appendTsv(runIndex, [
    ["ts", meta.started],
    ["variant", variant],
    ["branch", git("rev-parse", "--abbrev-ref", "HEAD")],
    ["commit", commit],
    ["scenarios sha256", scenariosSha256],
    ["count", scenarios.length],
    ["samples", results.length],
    ["save mode", saveMode],
    ["threshold", confidencePercent],
    ["out dir", resolve(out)],
    ["provider calls", budget.used],
    ["magic", all.magic],
    ["silent-wrong", all.silentWrong],
  ]);
}
process.stdout.write(`${join(out, "report.md")}\n${runIndex}\n`);
