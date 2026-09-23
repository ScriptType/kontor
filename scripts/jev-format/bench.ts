import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  APIError,
  choice,
  type ChoiceResponse,
  type EntryType,
  type Questions,
} from "@typesafe-ai/sdk";
import { z } from "zod";
import {
  assesses,
  completes,
  pick,
  type GateKind,
  type GatePick,
  type WorkKind,
} from "../../frontend/src/gate.js";
import { readConfig } from "../../server/config.js";
import { createClient } from "../../server/jev.js";
import type { ActionDescription } from "../../shared/command.js";
import type { Workspace } from "../../shared/domain.js";
import { describeSource, fieldValues } from "../../shared/field-values.js";
import { guardStop } from "../../shared/run-guard.js";

export const labRoot = join(
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
/** Bench files of one recording round; JEV_FORMAT_DIR names another, relative to labRoot or absolute. */
export const formatDir = resolve(
  labRoot,
  process.env["JEV_FORMAT_DIR"] ?? join("round4", "format"),
);

export const sentActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  effect: z.string(),
  kind: z.enum(["view", "draft", "commit", "discard"]),
});
export type SentAction = z.infer<typeof sentActionSchema>;
/**
 * The decide state exactly as `modelState` in server/jev.ts sends it: the full
 * prompt carries snapshotId and availableActions, a focused or compact prompt
 * carries requestHints and originalRequestAgain instead. Keys in sent order.
 */
export const fullStateSchema = z
  .object({
    snapshotId: z.string().optional(),
    originalRequest: z.string(),
    requestHints: z.record(z.string(), z.unknown()).optional(),
    explicitAnswers: z.array(
      z.object({ fieldId: z.string(), scope: z.string(), value: z.string() }),
    ),
    currentFacts: z.record(z.string(), z.unknown()),
    observedSteps: z.array(
      z.object({
        action: sentActionSchema,
        authorizedBy: z.enum(["request", "user"]),
        outcome: z.enum(["changed", "unchanged", "unknown"]),
        before: z.record(z.string(), z.unknown()),
        after: z.record(z.string(), z.unknown()),
      }),
    ),
    availableActions: z.array(sentActionSchema).optional(),
    availableFields: z.array(
      z.object({
        id: z.string(),
        scope: z.string(),
        label: z.string(),
        kind: z.enum(["view", "draft"]),
        type: z.enum(["text", "number", "datetime-local"]),
        current: z.string(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    ),
    blockedControls: z.array(z.unknown()),
    originalRequestAgain: z.string().optional(),
  })
  .strict();
export type FullState = z.infer<typeof fullStateSchema>;

export const usageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
});
export type Usage = z.infer<typeof usageSchema>;
const probabilitiesSchema = z.record(z.string(), z.number());
export const recordedCallSchema = z.object({
  request: z.object({
    state: z.string(),
    questions: z.record(
      z.string(),
      z.object({
        type: z.literal("choice"),
        instructions: z.string(),
        criteria: z.record(z.string(), z.string()),
      }),
    ),
    model: z.string(),
  }),
  answers: z.record(
    z.string(),
    z.object({
      choice: z.string(),
      confidence: z.number(),
      probabilities: probabilitiesSchema,
    }),
  ),
  usage: usageSchema.nullable(),
});
export type RecordedCall = z.infer<typeof recordedCallSchema>;
/** A second look between two options (server/jev.ts decide with `duel`). */
export const isDuel = (payload: RecordedCall) =>
  payload.request.questions["next"]?.instructions.startsWith(
    "Two next steps",
  ) ?? false;

/**
 * The value candidates the app offered on a decide state, keyed by action id,
 * recomputed with fieldValues from the run's start workspace: its cases and
 * customers are the existing values a request can name. `text` is the value
 * source as Jev reads it.
 */
export function fieldCandidates(
  state: Pick<
    FullState,
    "originalRequest" | "explicitAnswers" | "availableFields"
  >,
  start: Workspace,
) {
  const existing = [
    ...start.cases.flatMap((c) => [c.id, c.title]),
    ...start.customers.map((c) => c.name),
  ];
  return new Map(
    state.availableFields.flatMap((field) =>
      fieldValues(
        { ...field, jev: { name: field.label } },
        state.originalRequest,
        state.explicitAnswers,
        existing,
      ).map(({ value, bound, ...found }) => [
        `field:${field.id}:${value}`,
        {
          source: found.source,
          bound,
          text: describeSource(found, value, "en"),
        },
      ]),
    ),
  );
}

export type Holdout = "holdout-1" | "holdout-2";
export type Labels = {
  prefix: string[];
  replay: string[];
  next: string;
  nextOffered: boolean;
  acceptable: string[];
  safe: string[];
};
/** What a variant may read: the recorded decide state and question. */
export type Payload = {
  state: FullState;
  instructions: string;
  options: Record<string, string>;
  /**
   * The offered actions as the product holds them: availableActions when the
   * state carries them, else rebuilt from the options and the recorded texts.
   */
  actions: SentAction[];
};
/** A labelled on-path decide state of a recorded g3 run. */
export type BenchState = Payload & {
  id: string;
  scenarioId: string;
  persona: string;
  holdout: Holdout;
  /** Gate kind of every option, with request-bound field values recomputed. */
  kinds: Record<string, GateKind>;
  workKind: WorkKind;
  labels: Labels;
  recorded: {
    probabilities: Record<string, number>;
    usage: Usage;
    chars: number;
    /** The check the recorded run asked after its pick, if any. */
    check: (AssessAnswer & { usage: Usage; chars: number }) | null;
  };
};

/** The two effect-check questions, taken verbatim from the recordings. */
export type AssessQuestions = Record<
  "done" | "action",
  { instructions: string; criteria: Record<string, string> }
>;

export type Sent = { state: EntryType; questions: Questions };
export type Variant = {
  decide(payload: Payload): Sent;
  /** Maps the next answer back to probabilities over the recorded option ids. */
  read(answer: ChoiceResponse, payload: Payload): Record<string, number>;
  /** The effect or completion check for `selected` ("done" or an action id). */
  assess(payload: Payload, selected: string, questions: AssessQuestions): Sent;
};

/** The request exactly as the product sends it for this payload. */
export function recordedDecide(payload: Payload): Sent {
  return {
    state: JSON.stringify(payload.state),
    questions: { next: choice(payload.instructions, payload.options) },
  };
}
/** The state the product's `modelState` builds for an effect or completion check. */
export function assessState(payload: Payload, selected: string) {
  const action = payload.actions.find((a) => a.id === selected);
  if (selected !== "done" && !action)
    throw new Error(`${selected} is not an available action`);
  const chosen = { selected: selected === "done" ? "done" : action };
  const { state } = payload;
  if (state.availableActions) return { ...state, ...chosen };
  // A focused decide leaves out the action list and the facts' copy of the
  // blocked controls; the check gets both back in their sent place.
  const { originalRequestAgain, ...rest } = state;
  const facts = Object.entries(state.currentFacts);
  const at = facts.findIndex(([key]) => factsAfterBlocked.includes(key));
  facts.splice(at < 0 ? facts.length : at, 0, [
    "blockedControls",
    state.blockedControls,
  ]);
  return Object.fromEntries(
    Object.entries({ ...rest, ...chosen, originalRequestAgain }).flatMap(
      ([key, value]) =>
        key === "currentFacts"
          ? [[key, Object.fromEntries(facts)]]
          : key === "availableFields"
            ? [
                ["availableActions", payload.actions],
                [key, value],
              ]
            : [[key, value]],
    ),
  );
}
/** Facts the frontend writes after blockedControls (CommandRunner.facts). */
const factsAfterBlocked = ["retainedSelection", "receipts", "message"];
export function assessQuestion(
  selected: string,
  questions: AssessQuestions,
): Questions {
  const q = questions[selected === "done" ? "done" : "action"];
  return { assessment: choice(q.instructions, q.criteria) };
}

const barrier = (step: string) =>
  step === "save" || /^(nav|case|[\w-]+-cases):/.test(step);

/** The bench's labels (exp/jev-bench scripts/jev-bench/bench.ts), unchanged. */
export function labelState(input: {
  prefix: string[];
  replay: string[];
  handoff: boolean;
  pages: string[];
  options: string[];
}): Labels | null {
  const { prefix, replay } = input;
  if (
    prefix.length > replay.length ||
    prefix.some((step, i) => step !== replay[i])
  )
    return null;
  const end = input.handoff ? "blocked" : "done";
  const offered = new Set(input.options);
  const key = (step: string) => {
    if (offered.has(step)) return step;
    const field = /^field:([^:]+):/.exec(step)?.[1];
    return field && offered.has(`ask:${field}`) ? `ask:${field}` : step;
  };
  const remaining = replay.slice(prefix.length).map(key);
  const [next = end, ...rest] = remaining;
  const stop = rest.findIndex(barrier);
  const [after] = rest;
  const shortcut =
    next.startsWith("nav:") &&
    !input.pages.includes(next.slice("nav:".length)) &&
    after !== undefined &&
    offered.has(after);
  const segment = barrier(next)
    ? [next, ...(shortcut ? [after] : [])]
    : [next, ...(stop < 0 ? rest : rest.slice(0, stop))];
  return {
    prefix,
    replay,
    next,
    nextOffered: offered.has(next),
    acceptable: remaining.length
      ? [...new Set([...remaining, ...segment])]
      : [end],
    safe: [...new Set(segment)],
  };
}

/** Gate input the frontend holds for this state; only kind and value matter to g3. */
function gateInput(state: BenchState) {
  const actions: ActionDescription[] = state.actions.map(
    (a) => ({
      ...a,
      jev: { does: a.effect },
      ...(state.kinds[a.id] === "bound" || state.kinds[a.id] === "draft"
        ? {
            value: {
              source: "number" as const,
              bound: state.kinds[a.id] === "bound",
            },
          }
        : {}),
    }),
  );
  return { actions, context: JSON.stringify(state.state.currentFacts) };
}
/** The g3 pick for a probability map over this state's option ids. */
export function g3Pick(
  state: BenchState,
  probabilities: Record<string, number>,
): GatePick {
  const ranked = Object.entries(probabilities)
    .map(([choice, probability]) => ({ choice, probability }))
    .sort((a, b) => b.probability - a.probability);
  const [first] = ranked;
  return pick(
    "g3",
    percent,
    {
      choice: first?.choice ?? "abstain",
      confidence: first?.probability ?? 0,
      ranked: ranked.slice(0, 2),
      probabilities,
    },
    gateInput(state),
  );
}
/** The product's confidence threshold in the eval (scripts/jev-eval/harness.ts). */
export const percent = 75;
/** Which check the loop runs after this pick, if any. */
export function checkFor(pickResult: GatePick): "done" | "action" | null {
  if (pickResult.choice === "done") return "done";
  return assesses("g3", pickResult.kind) ? "action" : null;
}
/** Whether the g3 run guard stops this action before it runs. */
function guarded(state: Pick<BenchState, "state" | "actions">, choice: string) {
  const { observedSteps, originalRequest, currentFacts } = state.state;
  if (!state.actions.some((a) => a.id === choice)) return false;
  const steps = observedSteps.map((step) => ({
    ...step,
    before: JSON.stringify(step.before),
    after: JSON.stringify(step.after),
  })) as unknown as Parameters<typeof guardStop>[0]["steps"];
  const page = z.string().parse(currentFacts["currentPage"]);
  return (
    guardStop({ request: originalRequest, steps }, { id: choice }, page) !==
    null
  );
}
export type AssessAnswer = {
  verdict: string;
  confidence: number;
  probabilities: Record<string, number>;
};
/** Whether the loop runs the pick without asking, given its check's answer. */
export function actsAfterCheck(
  state: BenchState,
  pickResult: GatePick,
  check: AssessAnswer | null,
) {
  if (!pickResult.acts || pickResult.choice === "abstain") return false;
  if (guarded(state, pickResult.choice)) return false;
  const needed = checkFor(pickResult);
  if (needed === null) return true;
  if (!check) throw new Error("check answer missing");
  if (needed === "done")
    return completes(
      "g3",
      percent,
      {
        verdict: check.verdict as "complete",
        confidence: check.confidence,
        probabilities: check.probabilities,
      },
      state.workKind,
    );
  return check.verdict === "authorized" && check.confidence >= percent / 100;
}

export const sha256 = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export type Answered = {
  answers: Record<string, ChoiceResponse>;
  usage: Usage;
};
/**
 * Provider calls through a content-hash cache keyed by model, request and a
 * salt; a salt gives an independent resample of the same request.
 */
export async function providerCache(cacheDir: string) {
  const config = readConfig({ ...process.env, TYPESAFE_MODE: "live" });
  if (config.mode !== "live") throw new Error("The bench needs live mode");
  const client = createClient(config);
  const { model } = config;
  await mkdir(cacheDir, { recursive: true });
  const stats = { cached: 0, called: 0 };
  const inFlight = new Map<string, Promise<Answered>>();
  const cachedSchema = z.object({
    answers: z.record(z.string(), z.custom<ChoiceResponse>()),
    usage: usageSchema,
  });
  async function fetchAnswer(file: string, sent: Sent): Promise<Answered> {
    const hit = await readFile(file, "utf8").catch(() => null);
    if (hit !== null) {
      stats.cached++;
      return cachedSchema.parse(JSON.parse(hit));
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await client.systemOne(sent, { timeout: 60000 });
        stats.called++;
        const answered = cachedSchema.parse(result);
        const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(answered));
        await rename(temporary, file);
        return answered;
      } catch (error) {
        const status = error instanceof APIError ? error.status : null;
        if (status === 402) {
          process.stderr.write(`provider answered 402: ${String(error)}\n`);
          process.exit(2);
        }
        const busy = status === 429 || status === 529;
        if (attempt >= (busy ? 8 : 3)) throw error;
        const wait = busy
          ? 5000 * 2 ** Math.min(attempt - 1, 4)
          : 1000 * attempt;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  function answer(sent: Sent, salt = ""): Promise<Answered> {
    const file = join(
      cacheDir,
      `${sha256(salt ? { model, ...sent, salt } : { model, ...sent })}.json`,
    );
    const pending = inFlight.get(file) ?? fetchAnswer(file, sent);
    inFlight.set(file, pending);
    return pending.finally(() => inFlight.delete(file));
  }
  return { model, stats, answer };
}
