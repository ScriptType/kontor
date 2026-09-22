import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  formatDir,
  recordedDecide,
  type AssessQuestions,
  type BenchState,
} from "./bench.js";
import { variants } from "./variants.js";

// Prints what a variant sends for one state, and the mean decide size of
// every variant, without calling the provider.
const { values } = parseArgs({
  options: { variant: { type: "string" }, state: { type: "string" } },
});
const states: BenchState[] = JSON.parse(
  await readFile(join(formatDir, "states.json"), "utf8"),
);
const questions: AssessQuestions = JSON.parse(
  await readFile(join(formatDir, "assess-questions.json"), "utf8"),
);
if (values.variant) {
  const variant = variants[values.variant as keyof typeof variants];
  const state = states.find((s) => s.id === values.state) ?? states[0]!;
  const sent = variant.decide(state);
  process.stdout.write(
    `${state.id}\n${typeof sent.state === "string" ? sent.state : JSON.stringify(sent.state, null, 1)}\n\n${JSON.stringify(sent.questions, null, 1)}\n\ncheck state:\n${JSON.stringify(variant.assess(state, "done", questions).state).slice(0, 400)}\n`,
  );
} else {
  const base = states.reduce(
    (sum, s) => sum + JSON.stringify(recordedDecide(s)).length,
    0,
  );
  for (const [name, variant] of Object.entries(variants)) {
    const chars = states.reduce(
      (sum, s) => sum + JSON.stringify(variant.decide(s)).length,
      0,
    );
    process.stdout.write(
      `${name.padEnd(18)} ${Math.round(chars / states.length)} chars (${Math.round((chars / base - 1) * 100)} %)\n`,
    );
  }
}
