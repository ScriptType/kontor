import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  actsAfterCheck,
  checkFor,
  formatDir,
  g3Pick,
  providerCache,
  type AssessAnswer,
  type AssessQuestions,
  type BenchState,
  type Sent,
  type Usage,
} from "./bench.js";
import { variants } from "./variants.js";

const { values } = parseArgs({
  options: {
    variants: { type: "string" },
    samples: { type: "string", default: "1" },
    concurrency: { type: "string", default: "8" },
    states: { type: "string", default: join(formatDir, "states.json") },
    out: { type: "string", default: join(formatDir, "results") },
  },
});
const names = z
  .string({ error: "--variants a,b is required" })
  .parse(values.variants)
  .split(",");
for (const name of names)
  if (name !== "recorded" && !(name in variants))
    throw new Error(`unknown variant ${name}`);
const samples = z.coerce.number().int().min(1).parse(values.samples);
const concurrency = z.coerce
  .number()
  .int()
  .min(1)
  .max(24)
  .parse(values.concurrency);

const states: BenchState[] = JSON.parse(await readFile(values.states, "utf8"));
const assessQuestions: AssessQuestions = JSON.parse(
  await readFile(join(formatDir, "assess-questions.json"), "utf8"),
);
await mkdir(values.out, { recursive: true });
const { stats, answer } = await providerCache(join(formatDir, "cache"));

export type Row = {
  id: string;
  holdout: string;
  persona: string;
  depth: number;
  choice: string;
  kind: string;
  pickActs: boolean;
  total: number;
  margin: number;
  check: { verdict: string; confidence: number; complete: number } | null;
  act: boolean;
  safe: boolean;
  argmaxSafe: boolean;
  /** Probability Jev puts on the labelled safe options. */
  safeMass: number;
  decideTokens: number;
  decideChars: number;
  checkTokens: number | null;
  error: string | null;
};

const size = (sent: Sent) => JSON.stringify(sent).length;
function row(
  state: BenchState,
  probabilities: Record<string, number>,
  decide: { usage: Usage; chars: number },
  check: (AssessAnswer & { usage: Usage }) | null,
): Row {
  const picked = g3Pick(state, probabilities);
  const [argmax] = Object.entries(probabilities).sort(([, a], [, b]) => b - a);
  return {
    id: state.id,
    holdout: state.holdout,
    persona: state.persona,
    depth: state.labels.prefix.length,
    choice: picked.choice,
    kind: picked.kind,
    pickActs: picked.acts,
    total: picked.total,
    margin: picked.margin,
    check: check && {
      verdict: check.verdict,
      confidence: check.confidence,
      complete: check.probabilities["complete"] ?? 0,
    },
    act: actsAfterCheck(state, picked, check),
    safe: state.labels.safe.includes(picked.choice),
    argmaxSafe: argmax !== undefined && state.labels.safe.includes(argmax[0]),
    safeMass: state.labels.safe.reduce(
      (sum, id) => sum + (probabilities[id] ?? 0),
      0,
    ),
    decideTokens: decide.usage.input_tokens,
    decideChars: decide.chars,
    checkTokens: check?.usage.input_tokens ?? null,
    error: null,
  };
}

async function evaluate(
  name: string,
  state: BenchState,
  salt: string,
): Promise<Row> {
  if (name === "recorded") {
    const picked = g3Pick(state, state.recorded.probabilities);
    const needed = picked.acts && checkFor(picked) !== null;
    if (needed && !state.recorded.check)
      throw new Error(`${state.id}: recorded run lacks its check`);
    return row(
      state,
      state.recorded.probabilities,
      state.recorded,
      needed ? state.recorded.check : null,
    );
  }
  const variant = variants[name as keyof typeof variants];
  const sent = variant.decide(state);
  const decided = await answer(sent, salt);
  const next = decided.answers["next"];
  if (next?.type !== "choice") throw new Error("next is not a choice");
  const probabilities = variant.read(next, state);
  const picked = g3Pick(state, probabilities);
  let check: (AssessAnswer & { usage: Usage }) | null = null;
  if (picked.acts && checkFor(picked) !== null) {
    const asked = await answer(
      variant.assess(state, picked.choice, assessQuestions),
      salt,
    );
    const assessment = asked.answers["assessment"];
    if (assessment?.type !== "choice") throw new Error("no assessment");
    check = {
      verdict: assessment.choice,
      confidence: assessment.confidence,
      probabilities: assessment.probabilities,
      usage: asked.usage,
    };
  }
  return row(
    state,
    probabilities,
    { usage: decided.usage, chars: size(sent) },
    check,
  );
}

const jobs = names.flatMap((name) =>
  Array.from({ length: name === "recorded" ? 1 : samples }, (_, i) => ({
    name,
    sample: i + 1,
  })),
);
for (const { name, sample } of jobs) {
  const salt = sample === 1 ? "" : `sample-${sample}`;
  const rows: Row[] = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let state = states[index++]; state; state = states[index++]) {
        try {
          rows.push(await evaluate(name, state, salt));
        } catch (error) {
          rows.push({
            id: state.id,
            holdout: state.holdout,
            persona: state.persona,
            depth: state.labels.prefix.length,
            choice: "",
            kind: "",
            pickActs: false,
            total: 0,
            margin: 0,
            check: null,
            act: false,
            safe: false,
            argmaxSafe: false,
            safeMass: 0,
            decideTokens: NaN,
            decideChars: NaN,
            checkTokens: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }),
  );
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const file = join(values.out, `${name}@${sample}.json`);
  await writeFile(file, JSON.stringify(rows));
  const ok = rows.filter((r) => r.error === null);
  const mean = (pick: (r: Row) => number) =>
    Math.round(ok.reduce((sum, r) => sum + pick(r), 0) / (ok.length || 1));
  process.stdout.write(
    `${name}@${sample}: act-correct ${ok.filter((r) => r.act && r.safe).length}, act-wrong ${ok.filter((r) => r.act && !r.safe).length}, top1-safe ${ok.filter((r) => r.safe).length}/${ok.length}, safe mass ${(ok.reduce((sum, r) => sum + r.safeMass, 0) / (ok.length || 1)).toFixed(3)}, decide tokens ${mean((r) => r.decideTokens)}, errors ${rows.length - ok.length}, calls ${stats.called}, cached ${stats.cached}\n`,
  );
}
