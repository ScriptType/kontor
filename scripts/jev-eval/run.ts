import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { z } from "zod";
import { readConfig } from "../../server/config.js";
import { confidencePercent, runSample, type Budget } from "./harness.js";
import { markdown, summaries, type SampleResult } from "./report.js";
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
const config = readConfig({ ...process.env, TYPESAFE_MODE: "live" });
const meta = {
  variant,
  commit: execFileSync("git", ["rev-parse", "--short", "HEAD"])
    .toString()
    .trim(),
  model: config.mode === "live" ? config.model : "demo",
  ...(values.scenarios ? { scenarios: values.scenarios } : { seed, count }),
  ...(only ? { only: only.join(",") } : {}),
  "scenarios sha256":
    file?.sha256 ?? createHash("sha256").update(scenariosJson).digest("hex"),
  samples,
  concurrency,
  "confidence threshold": `${confidencePercent} %`,
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
}
process.stdout.write(`${join(out, "report.md")}\n`);
