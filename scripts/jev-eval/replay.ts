import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { z } from "zod";
import { replay, replayStepSchema } from "./harness.js";
import { readScenarios } from "./scenario-files.js";
import { regressionScenarios } from "./scenarios.js";

const { values } = parseArgs({
  options: {
    scenarios: { type: "string" },
    id: { type: "string" },
    steps: { type: "string" },
  },
});
if (!values.id || !values.steps)
  throw new Error(
    "Usage: replay.ts [--scenarios <file.json>] --id <scenario-id> --steps '<json array>'",
  );
if (!existsSync("dist/frontend/browser/index.html"))
  throw new Error(
    "No build in dist/frontend/browser. Run npm run build once; replay never builds.",
  );
const steps = z.array(replayStepSchema).parse(JSON.parse(values.steps));
const scenarios = values.scenarios
  ? (await readScenarios(values.scenarios)).scenarios
  : regressionScenarios();
const scenario = scenarios.find((s) => s.id === values.id);
if (!scenario) throw new Error(`Unknown scenario ${values.id}`);
const browser = await chromium.launch({ channel: "chrome" });
try {
  process.stdout.write(
    `${JSON.stringify(await replay({ browser, scenario, steps }), null, 2)}\n`,
  );
} finally {
  await browser.close();
}
