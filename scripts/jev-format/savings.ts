import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { slimObservations } from "../../shared/step-log.js";

// Input tokens per run the slim history (gate g4-lean) would save on
// recorded runs: every decide, duel and check state rewritten, its character
// cut scaled by that call's reported tokens per character. Plan calls keep
// their size.
const { values } = parseArgs({ options: { runs: { type: "string" } } });
const callSchema = z.object({
  question: z.string(),
  payload: z
    .object({
      request: z.object({ state: z.unknown() }).loose(),
      usage: z.object({ input_tokens: z.number() }).nullable(),
    })
    .loose()
    .optional(),
});
const stepSchema = z
  .object({ before: z.unknown(), after: z.unknown() })
  .loose();
const slim = (state: string) => {
  const parsed = z
    .object({ observedSteps: z.array(stepSchema) })
    .loose()
    .parse(JSON.parse(state));
  const steps = parsed.observedSteps.map((step) => ({
    before: JSON.stringify(step.before),
    after: JSON.stringify(step.after),
  }));
  const observed = slimObservations(steps);
  return JSON.stringify({
    ...parsed,
    observedSteps: parsed.observedSteps.map(
      ({ before: _before, after: _after, ...step }, i) => ({
        ...step,
        ...observed[i],
      }),
    ),
  });
};
type Tally = { calls: number; tokens: number; saved: number };
const tally: Record<string, Tally> = {};
let runs = 0;
for (const dir of z.string().parse(values.runs).split(",")) {
  for (const file of await readdir(join(dir, "samples"))) {
    runs++;
    const { callLog } = z
      .object({ callLog: z.array(callSchema) })
      .parse(JSON.parse(await readFile(join(dir, "samples", file), "utf8")));
    for (const { question, payload } of callLog) {
      const kind =
        question === "next" || question === "assessment" ? question : "plan";
      const entry = (tally[kind] ??= { calls: 0, tokens: 0, saved: 0 });
      const tokens = payload?.usage?.input_tokens ?? 0;
      entry.calls++;
      entry.tokens += tokens;
      if (kind === "plan" || !payload) continue;
      const state = z.string().parse(payload.request.state);
      const perChar = tokens / JSON.stringify(payload.request).length;
      entry.saved += (state.length - slim(state).length) * perChar;
    }
  }
}
const all = Object.values(tally).reduce(
  (sum, t) => ({
    calls: sum.calls + t.calls,
    tokens: sum.tokens + t.tokens,
    saved: sum.saved + t.saved,
  }),
  { calls: 0, tokens: 0, saved: 0 },
);
for (const [kind, t] of [...Object.entries(tally), ["all", all] as const])
  process.stdout.write(
    `${kind.padEnd(10)} calls/run ${(t.calls / runs).toFixed(1)}, input tokens/run ${Math.round(t.tokens / runs)}, saved/run ${Math.round(t.saved / runs)} (${((100 * t.saved) / (t.tokens || 1)).toFixed(1)} %)\n`,
  );
