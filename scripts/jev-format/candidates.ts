import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { seededStore } from "../jev-eval/harness.js";
import type { StartState } from "../jev-eval/scenarios.js";
import {
  fieldCandidates,
  fullStateSchema,
  isDuel,
  recordedCallSchema,
} from "./bench.js";

// Every field option an answered decide sent, against the candidate
// fieldCandidates rebuilds from the run's start state. A bench on the runs
// needs every option rebuilt with the value source Jev read.
const { values } = parseArgs({
  options: { runs: { type: "string", default: "" } },
});
const sampleSchema = z.object({
  scenario: z.object({ start: z.custom<StartState>() }),
  callLog: z.array(
    z.object({ question: z.string(), payload: z.unknown().optional() }),
  ),
});
const sourceText = ". Value source: ";
type Tally = { sent: number; missing: number; differs: number };
const bySource = new Map<string, Tally>();
const examples: string[] = [];
let unanswered = 0;
for (const run of values.runs.split(",").filter(Boolean))
  for (const file of (await readdir(join(run, "samples"))).sort()) {
    const sample = sampleSchema.parse(
      JSON.parse(await readFile(join(run, "samples", file), "utf8")),
    );
    const start = seededStore(sample.scenario.start).snapshot();
    for (const [call, { question, payload }] of sample.callLog.entries()) {
      if (question !== "next") continue;
      const recorded = recordedCallSchema.safeParse(payload);
      if (!recorded.success) {
        unanswered++;
        continue;
      }
      if (isDuel(recorded.data)) continue;
      const rebuilt = fieldCandidates(
        fullStateSchema
          .pick({
            originalRequest: true,
            explicitAnswers: true,
            availableFields: true,
          })
          .loose()
          .parse(JSON.parse(recorded.data.request.state)),
        start,
      );
      for (const [id, text] of Object.entries(
        recorded.data.request.questions["next"]?.criteria ?? {},
      )) {
        if (!id.startsWith("field:")) continue;
        const sent = text.slice(text.indexOf(sourceText) + sourceText.length);
        const source = sent.split(":")[0]!;
        const tally = bySource.get(source) ?? {
          sent: 0,
          missing: 0,
          differs: 0,
        };
        bySource.set(source, tally);
        tally.sent++;
        const found = rebuilt.get(id);
        if (found?.text === sent) continue;
        if (found) tally.differs++;
        else tally.missing++;
        if (examples.length < 10)
          examples.push(
            `${basename(run)}/${file} call ${call} ${id}: sent "${sent}", rebuilt ${found ? `"${found.text}"` : "none"}`,
          );
      }
    }
  }
const tallies = [...bySource.values()];
const wrong = tallies.reduce((sum, t) => sum + t.missing + t.differs, 0);
process.stdout.write(
  [
    `decide calls without a recorded answer, skipped: ${unanswered}`,
    ...[...bySource]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([source, t]) =>
          `${source}: ${t.sent} sent, ${t.missing} not rebuilt, ${t.differs} with another value source`,
      ),
    `field options the bench does not rebuild as sent: ${wrong} of ${tallies.reduce((sum, t) => sum + t.sent, 0)}`,
    ...examples.map((e) => `  ${e}`),
  ].join("\n") + "\n",
);
if (wrong) process.exitCode = 1;
