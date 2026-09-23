import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readConfig } from "../../server/config.js";
import { extractPlan, readAnswers, type Ask } from "../../server/plan.js";
import { planVisits, type Plan } from "../../shared/plan.js";
import { readScenarios } from "../jev-eval/scenario-files.js";
import {
  regressionScenarios,
  startWorkspace,
  type Scenario,
} from "../jev-eval/scenarios.js";

const labRoot = join(
  dirname(
    execFileSync("git", [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
      .toString()
      .trim(),
  ),
  "live-results",
  "question-pipeline-2026-09-21",
);
const protoDir = join(labRoot, "round4", "plan-proto");
const config = readConfig({ ...process.env, TYPESAFE_MODE: "live" });
if (config.mode !== "live") throw new Error("needs a live model name");
const { model } = config;

type Row = { id: string; set: string; plan: Plan | null };
const rows = new Map(
  (
    JSON.parse(
      await readFile(join(protoDir, "raw", "S3.json"), "utf8"),
    ) as Row[]
  ).map((row) => [row.id, row]),
);
const items: { set: string; scenario: Scenario }[] = [
  ...regressionScenarios().map((scenario) => ({ set: "dev", scenario })),
  ...(
    await readScenarios(join(labRoot, "holdout", "holdout.json"))
  ).scenarios.map((scenario) => ({ set: "h1", scenario })),
  ...(
    await readScenarios(join(labRoot, "holdout2", "holdout2.json"))
  ).scenarios.map((scenario) => ({ set: "h2", scenario })),
];

const cacheOnly =
  (misses: string[]): Ask =>
  async (sent) => {
    const key = createHash("sha256")
      .update(JSON.stringify({ model, ...sent }))
      .digest("hex");
    const hit = await readFile(
      join(protoDir, "cache", `${key}.json`),
      "utf8",
    ).catch(() => null);
    if (hit === null) {
      misses.push(
        `${key} (${Object.keys(sent.questions).slice(0, 3).join(",")}…)`,
      );
      throw new Error(`cache miss ${key}`);
    }
    return readAnswers(sent.questions, JSON.parse(hit));
  };

const compared = ["cases", "sequence", "filters", "visits", "flags"] as const;
const view = (plan: Plan) => ({
  cases: plan.cases,
  sequence: plan.sequence,
  filters: plan.filters,
  visits: planVisits(plan),
  flags: plan.flags,
});
const counts = { scenarios: items.length, cacheHit: 0, equal: 0, noRow: 0 };
for (const { set, scenario } of items) {
  const row = rows.get(scenario.id);
  if (!row?.plan) {
    counts.noRow++;
    console.log(`${set} ${scenario.id}: no S3 row`);
    continue;
  }
  const misses: string[] = [];
  let plan: Plan;
  try {
    plan = await extractPlan(
      {
        request: scenario.request,
        page: scenario.start.page,
        filters: scenario.start.filters,
        selectedCase: scenario.start.selectedCase,
        workspace: startWorkspace(scenario.start),
      },
      cacheOnly(misses),
    );
  } catch (error) {
    console.log(
      `${set} ${scenario.id}: ${misses.length ? `cache miss ${misses.join("; ")}` : String(error)}`,
    );
    continue;
  }
  counts.cacheHit++;
  const [ported, recorded] = [view(plan), view(row.plan)];
  const differing = compared.filter(
    (field) => !isDeepStrictEqual(ported[field], recorded[field]),
  );
  if (!differing.length) {
    counts.equal++;
    continue;
  }
  console.log(`${set} ${scenario.id}: differs in ${differing.join(", ")}`);
  for (const field of differing)
    console.log(
      `  ${field}: port ${JSON.stringify(ported[field])} vs S3 ${JSON.stringify(recorded[field])}`,
    );
}
console.log(JSON.stringify(counts));
