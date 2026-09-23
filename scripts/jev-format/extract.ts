import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { gateKind, workKind, type GateKind } from "../../frontend/src/gate.js";
import type { ActionDescription } from "../../shared/command.js";
import { seededStore } from "../jev-eval/harness.js";
import type { StartState } from "../jev-eval/scenarios.js";
import {
  actsAfterCheck,
  assessState,
  checkFor,
  fieldCandidates,
  formatDir,
  fullStateSchema,
  g3Pick,
  isDuel,
  labelState,
  labRoot,
  offersSavedArithmetic,
  recordedCallSchema,
  sentActionSchema,
  sha256,
  type AssessQuestions,
  type BenchState,
  type FullState,
  type Holdout,
  type RecordedCall,
  type SentAction,
} from "./bench.js";

const { values } = parseArgs({
  options: {
    runs: {
      type: "string",
      default: ["rec-h1-g3", "rec-h2-g3"]
        .map((run) => join(formatDir, run))
        .join(","),
    },
    /** Folders of recorded runs; each run in them only teaches the catalog labels, kinds and texts. */
    catalog: { type: "string", default: "" },
    out: { type: "string", default: formatDir },
  },
});
const holdouts = [
  { name: "holdout-1", meta: join(labRoot, "holdout", "holdout-meta.json") },
  { name: "holdout-2", meta: join(labRoot, "holdout2", "holdout2-meta.json") },
] as const;
const metaSchema = z.record(
  z.string(),
  z.object({ persona: z.string(), steps: z.array(z.string()) }),
);
const meta = new Map<
  string,
  { persona: string; steps: string[]; holdout: Holdout }
>();
for (const { name, meta: file } of holdouts)
  for (const [id, entry] of Object.entries(
    metaSchema.parse(JSON.parse(await readFile(file, "utf8"))),
  ))
    meta.set(id, { ...entry, holdout: name });

const sampleSchema = z.object({
  result: z.object({ scenarioId: z.string(), steps: z.array(z.string()) }),
  // Plan calls ask other question types; only decide and check calls count.
  callLog: z.array(
    z
      .object({ question: z.string(), payload: z.unknown().optional() })
      .transform(({ question, payload }) => ({
        question,
        payload:
          question === "next" || question === "assessment"
            ? recordedCallSchema.optional().parse(payload)
            : undefined,
      })),
  ),
  scenario: z.object({
    request: z.string(),
    start: z.custom<StartState>(),
    intent: z.object({ pages: z.array(z.string()) }),
    expected: z.object({ handoff: z.string().nullable() }),
  }),
});

/** Gate kind per option; field candidates get `bound` the way ActionRegistry.snapshot does. */
function optionKinds(
  sent: SentAction[],
  options: string[],
  candidates: ReturnType<typeof fieldCandidates>,
): Record<string, GateKind> {
  const actions: ActionDescription[] = sent.map((action) => {
    if (!action.id.startsWith("field:"))
      return { ...action, jev: { does: action.effect } };
    const found = candidates.get(action.id);
    if (!found) throw new Error(`${action.id} is not a recomputed candidate`);
    return {
      ...action,
      jev: { does: action.effect },
      value: { source: found.source, bound: found.bound },
    };
  });
  return Object.fromEntries(
    options.map((option) => [option, gateKind(option, { actions })]),
  );
}

type Sample = z.infer<typeof sampleSchema>;
async function samplesOf(dirs: string) {
  const found: { file: string; sample: Sample }[] = [];
  for (const dir of dirs.split(",").filter(Boolean))
    for (const file of (await readdir(join(dir, "samples"))).sort())
      found.push({
        file,
        sample: sampleSchema.parse(
          JSON.parse(await readFile(join(dir, "samples", file), "utf8")),
        ),
      });
  return found;
}
const samples = await samplesOf(values.runs);

const terminal = (option: string) =>
  ["done", "blocked", "abstain"].includes(option) || option.startsWith("ask:");
const duelText = /^([^]*)\. UI "([^"]*)", kind (view|draft|commit|discard)$/;
const stateOf = (payload: RecordedCall) =>
  fullStateSchema.parse(JSON.parse(payload.request.state));

// A compact decide sends each action as `does. Now: now`; the product holds
// label, kind and the full effect, which a check and a duel send. One id can
// name two controls (technician:mara assigns in the picker and filters in the
// filter menu), so the catalog keys by id and the text before "Now:", and
// keeps every text seen after the option text.
type Known = {
  label: string;
  kind: SentAction["kind"];
  tails: Map<string, number>;
};
const catalog = new Map<string, Known>();
/** What the control does, with the case it acts on left out. */
const doesOf = (text: string) =>
  text.split(". Now: ")[0]!.replace(/V-\d+( "[^"]*")?/g, "V-…");
function remember(action: SentAction, option?: string) {
  const key = `${action.id}\n${doesOf(action.effect)}`;
  const entry = catalog.get(key) ?? {
    label: action.label,
    kind: action.kind,
    tails: new Map<string, number>(),
  };
  if (entry.kind !== action.kind)
    throw new Error(`${key} is both ${entry.kind} and ${action.kind}`);
  if (option !== undefined && action.effect.startsWith(option)) {
    const tail = action.effect.slice(option.length).replace(/V-\d+/g, "V-…");
    entry.tails.set(tail, (entry.tails.get(tail) ?? 0) + 1);
  }
  catalog.set(key, entry);
}
/** The known control for an option, else the one kind its id was seen with. */
function lookup(id: string, text: string): Known {
  const exact = catalog.get(`${id}\n${doesOf(text)}`);
  if (exact) return exact;
  const seen = [...catalog].filter(([key]) => key.startsWith(`${id}\n`));
  const [first] = seen;
  if (!first || new Set(seen.map(([, known]) => known.kind)).size !== 1)
    throw new Error(`${id} "${doesOf(text)}" has no recorded kind`);
  return { ...first[1], tails: new Map() };
}
function learn(sample: Sample) {
  let options: Record<string, string> = {};
  for (const { question, payload } of sample.callLog) {
    if (!payload) continue;
    if (question === "next" && !isDuel(payload)) {
      options = payload.request.questions["next"]?.criteria ?? {};
      const state = stateOf(payload);
      for (const step of state.observedSteps) remember(step.action);
      for (const action of state.availableActions ?? [])
        remember(action, options[action.id]);
    } else if (question === "next") {
      for (const [id, text] of Object.entries(
        payload.request.questions["next"]?.criteria ?? {},
      )) {
        const match = duelText.exec(text);
        if (match)
          remember(
            {
              id,
              label: match[2]!,
              effect: match[1]!,
              kind: match[3] as SentAction["kind"],
            },
            options[id],
          );
      }
    } else if (question === "assessment") {
      const state = z
        .object({ availableActions: z.array(sentActionSchema) })
        .loose()
        .parse(JSON.parse(payload.request.state));
      for (const action of state.availableActions)
        remember(action, options[action.id]);
    }
  }
}
for (const { sample } of samples) learn(sample);
for (const folder of values.catalog.split(",").filter(Boolean))
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const dir = join(folder, entry.name);
    if (entry.isDirectory() && existsSync(join(dir, "samples")))
      for (const { sample } of await samplesOf(dir)) learn(sample);
  }
/**
 * The offered actions of a decide: sent as availableActions, else those of
 * the check asked on the same screen, else rebuilt from the catalog with the
 * text most often seen after that option.
 */
function actionsOf(
  state: FullState,
  options: Record<string, string>,
  check: RecordedCall | undefined,
): { actions: SentAction[]; rebuilt: boolean } {
  if (state.availableActions)
    return { actions: state.availableActions, rebuilt: false };
  if (check)
    return {
      actions: z
        .object({ availableActions: z.array(sentActionSchema) })
        .loose()
        .parse(JSON.parse(check.request.state)).availableActions,
      rebuilt: false,
    };
  const open = z
    .object({ selected: z.object({ id: z.string() }).optional() })
    .loose()
    .parse(state.currentFacts).selected?.id;
  const actions = Object.entries(options)
    .filter(([id]) => !terminal(id))
    .map(([id, text]) => {
      const entry = lookup(id, text);
      // Texts that name the open case fit only while a detail is open.
      const fits = ([tail]: [string, number]) =>
        tail.includes("V-…") === (open !== undefined);
      const [tail] = [...entry.tails].sort(
        (a, b) => Number(fits(b)) - Number(fits(a)) || b[1] - a[1],
      )[0] ?? [defaultTail[entry.kind] ?? ""];
      return {
        id,
        label: entry.label,
        effect: text + tail.replaceAll("V-…", open ?? "V-…"),
        kind: entry.kind,
      };
    });
  return { actions, rebuilt: true };
}
const defaultTail: Partial<Record<SentAction["kind"], string>> = {
  view: ". View only; changes no case data",
  draft: ". Changes only the unsaved draft; nothing is saved until save",
};

const runWork = (state: FullState) =>
  workKind(
    state.observedSteps.map((step) => ({
      action: { ...step.action, jev: { does: step.action.effect } },
    })),
  );
const stepId = (observed: string) =>
  observed.slice(0, observed.lastIndexOf(":"));

const states: BenchState[] = [];
const decideCalls: {
  holdout: Holdout;
  scenarioId: string;
  call: number;
  duel: boolean;
  onPath: boolean;
  steps: number;
  options: number;
  inputTokens: number;
  outputTokens: number;
  chars: number;
  parts: Record<string, number>;
}[] = [];
const assessCalls: { selected: string; inputTokens: number }[] = [];
const assessQuestions: Partial<AssessQuestions> = {};
const check = {
  checkPredicted: 0,
  checkMismatch: [] as string[],
  boundDecided: 0,
  identityStateMismatch: 0,
  assessStateMismatch: 0,
  assessStatesCompared: 0,
  actsChecked: 0,
  checksBelowBar: 0,
  actsMismatch: [] as string[],
  duelFollowed: 0,
  actionsRebuilt: 0,
  rebuildCompared: 0,
  rebuildKind: 0,
  rebuildText: 0,
};

{
  for (const { file, sample } of samples) {
    const { scenarioId } = sample.result;
    const scenario = meta.get(scenarioId);
    if (!scenario) throw new Error(`${scenarioId} has no replay path`);
    const workspace = seededStore(sample.scenario.start).snapshot();
    const savedArithmetic = offersSavedArithmetic(
      sample.callLog.flatMap(({ payload }) => (payload ? [payload] : [])),
    );
    const executed = sample.result.steps.map(stepId);
    for (const [call, record] of sample.callLog.entries()) {
      const payload = record.payload;
      if (record.question !== "next" && record.question !== "assessment")
        continue;
      if (!payload) throw new Error(`${file} call ${call} was not recorded`);
      if (record.question === "assessment") {
        const q = payload.request.questions["assessment"];
        if (!q) throw new Error(`${file} call ${call} lacks assessment`);
        const selected = z
          .object({
            selected: z.union([
              z.literal("done"),
              z.object({ id: z.string() }),
            ]),
          })
          .parse(JSON.parse(payload.request.state)).selected;
        const slot = selected === "done" ? "done" : "action";
        const asked = { instructions: q.instructions, criteria: q.criteria };
        const seen = assessQuestions[slot];
        if (seen && sha256(seen) !== sha256(asked))
          throw new Error(`${file} call ${call}: assessment question differs`);
        assessQuestions[slot] = asked;
        assessCalls.push({
          selected: selected === "done" ? "done" : selected.id,
          inputTokens: payload.usage?.input_tokens ?? NaN,
        });
        continue;
      }
      if (record.question !== "next") continue;
      const question = payload.request.questions["next"];
      const answer = payload.answers["next"];
      if (!question || !answer || !payload.usage)
        throw new Error(`${file} call ${call} lacks next or usage`);
      const state = stateOf(payload);
      const duel = isDuel(payload);
      const { currentFacts } = state;
      const prefix = state.observedSteps.map((s) => s.action.id);
      const options = Object.keys(question.criteria);
      if (prefix.some((step, i) => step !== executed[i]))
        throw new Error(`${file} call ${call}: history is not the run's prefix`);
      const labels = labelState({
        prefix,
        replay: scenario.steps,
        handoff: sample.scenario.expected.handoff !== null,
        pages: sample.scenario.intent.pages,
        options,
      });
      decideCalls.push({
        holdout: scenario.holdout,
        scenarioId,
        call,
        duel,
        onPath: labels !== null,
        steps: prefix.length,
        options: options.length,
        inputTokens: payload.usage.input_tokens,
        outputTokens: payload.usage.output_tokens,
        chars: JSON.stringify(payload.request).length,
        parts: {
          instructions: question.instructions.length,
          options: JSON.stringify(question.criteria).length,
          ...Object.fromEntries(
            Object.entries(state)
              .filter(([key]) => key !== "currentFacts")
              .map(([key, value]) => [key, JSON.stringify(value).length]),
          ),
          ...Object.fromEntries(
            Object.entries(currentFacts).map(([key, value]) => [
              `currentFacts.${key}`,
              JSON.stringify(value).length,
            ]),
          ),
          "observedSteps.before+after": state.observedSteps.reduce(
            (sum, step) =>
              sum +
              (step.before ? JSON.stringify(step.before).length : 0) +
              JSON.stringify(step.after).length,
            0,
          ),
        },
      });
      if (duel) continue;
      if (JSON.stringify(state) !== payload.request.state)
        check.identityStateMismatch++;
      const next = sample.callLog[call + 1];
      const following = next?.question === "assessment";
      const { actions, rebuilt } = actionsOf(
        state,
        question.criteria,
        following ? next.payload : undefined,
      );
      if (rebuilt) check.actionsRebuilt++;
      const kinds = optionKinds(
        actions,
        options,
        fieldCandidates(state, workspace, savedArithmetic),
      );
      const bench = {
        state,
        instructions: question.instructions,
        options: question.criteria,
        actions,
        kinds,
      };
      // The recorded run tells which check followed each pick; the bench's
      // g3 reading and recomputed kinds must predict it.
      const recordedPick = g3Pick(
        { ...bench, workKind: "view" } as BenchState,
        answer.probabilities,
      );
      const predicted = checkFor(recordedPick) !== null;
      // A duel, the plan's vote or its steer may change the pick the run
      // follows; the bench models none of them, so those calls are counted
      // apart instead of as mismatches.
      const secondLook = next?.payload !== undefined && isDuel(next.payload);
      if (secondLook) check.duelFollowed++;
      check.checkPredicted++;
      if (following && !recordedPick.acts) check.checksBelowBar++;
      if (recordedPick.choice.startsWith("field:")) check.boundDecided++;
      if (!secondLook && predicted !== following)
        check.checkMismatch.push(
          `${scenarioId} call ${call}: ${recordedPick.choice} (${recordedPick.kind}) predicted ${predicted}, recorded ${following}`,
        );
      if (following && next.payload) {
        check.assessStatesCompared++;
        const built = JSON.stringify(
          assessState(bench, recordedPick.choice),
        );
        if (built !== next.payload.request.state) check.assessStateMismatch++;
      }
      if (following && next.payload && !state.availableActions) {
        // How close the catalog comes to the actions the check recorded.
        const { actions: catalogued } = actionsOf(
          state,
          question.criteria,
          undefined,
        );
        // Per action: the kind decides the gate, label and effect only the check.
        for (const [i, action] of actions.entries()) {
          const built = catalogued[i];
          check.rebuildCompared++;
          if (built?.id !== action.id || built.kind !== action.kind)
            check.rebuildKind++;
          else if (JSON.stringify(built) !== JSON.stringify(action))
            check.rebuildText++;
        }
      }
      const checkAnswer = following
        ? next?.payload?.answers["assessment"]
        : null;
      // A pick that needed a check the run never asked is already a check
      // mismatch above.
      const unchecked =
        recordedPick.acts && checkFor(recordedPick) !== null && !checkAnswer;
      const acts =
        !unchecked &&
        actsAfterCheck(
        { ...bench, workKind: runWork(state) } as BenchState,
        recordedPick,
        checkAnswer
          ? {
              verdict: checkAnswer.choice,
              confidence: checkAnswer.confidence,
              probabilities: checkAnswer.probabilities,
            }
          : null,
      );
      const stepped =
        !["done", "blocked", "abstain"].includes(recordedPick.choice) &&
        !recordedPick.choice.startsWith("ask:") &&
        executed[state.observedSteps.length] === recordedPick.choice &&
        executed.length > state.observedSteps.length &&
        sample.callLog.slice(call + 1).some((c) => c.question === "next");
      const actsOnAction =
        acts &&
        !["done", "blocked", "abstain"].includes(recordedPick.choice) &&
        !recordedPick.choice.startsWith("ask:");
      check.actsChecked++;
      if (!secondLook && actsOnAction !== stepped)
        check.actsMismatch.push(
          `${scenarioId} call ${call}: ${recordedPick.choice} acts ${actsOnAction}, run stepped ${stepped}`,
        );
      if (!labels) continue;
      states.push({
        ...bench,
        id: `${basename(file, ".json")}:${call}`,
        scenarioId,
        persona: scenario.persona,
        holdout: scenario.holdout,
        workKind: runWork(state),
        labels,
        recorded: {
          probabilities: answer.probabilities,
          usage: payload.usage,
          chars: JSON.stringify(payload.request).length,
          check:
            checkAnswer && next?.payload?.usage
              ? {
                  verdict: checkAnswer.choice,
                  confidence: checkAnswer.confidence,
                  probabilities: checkAnswer.probabilities,
                  usage: next.payload.usage,
                  chars: JSON.stringify(next.payload.request).length,
                }
              : null,
        },
      });
    }
  }
}
if (!assessQuestions.done || !assessQuestions.action)
  throw new Error("recordings lack one of the two checks");
await mkdir(values.out, { recursive: true });
await writeFile(join(values.out, "states.json"), JSON.stringify(states));
await writeFile(
  join(values.out, "calls.json"),
  JSON.stringify({ decideCalls, assessCalls }),
);
await writeFile(
  join(values.out, "assess-questions.json"),
  JSON.stringify(assessQuestions, null, 1),
);
const tally = <T>(items: T[], pick: (item: T) => string) =>
  Object.entries(Object.groupBy(items, pick))
    .map(([key, group]) => `${key} ${group?.length ?? 0}`)
    .join(", ");
process.stdout.write(
  [
    `runs: ${values.runs
      .split(",")
      .map((d) => basename(d))
      .join(", ")}`,
    `decide calls: ${decideCalls.length} (${tally(decideCalls, (c) => c.holdout)}), on path ${decideCalls.filter((c) => c.onPath).length}`,
    `assess calls: ${assessCalls.length}`,
    `on-path states: ${states.length} (${tally(states, (s) => s.holdout)})`,
    `by depth: ${tally(states, (s) => String(s.labels.prefix.length))}`,
    `next not offered: ${states.filter((s) => !s.labels.nextOffered).length}`,
    `re-serialized decide state differs from the recording: ${check.identityStateMismatch}`,
    `built check state differs from the recorded check: ${check.assessStateMismatch} of ${check.assessStatesCompared}`,
    `decide states whose actions the catalog rebuilt: ${check.actionsRebuilt}; of the actions a check recorded, the catalog gets id or kind wrong for ${check.rebuildKind} and label or effect for ${check.rebuildText} of ${check.rebuildCompared}`,
    `picks followed by a duel, left out of the two checks below: ${check.duelFollowed}`,
    `g3 check predicted vs recorded: ${check.checkMismatch.length} mismatches of ${check.checkPredicted} (field picks ${check.boundDecided})`,
    ...check.checkMismatch.map((m) => `  ${m}`),
    `checks asked although the pick was below its bar (the loop only words its review with them): ${check.checksBelowBar}`,
    `g3 acts on an action vs the run took that step: ${check.actsMismatch.length} mismatches of ${check.actsChecked}`,
    ...check.actsMismatch.map((m) => `  ${m}`),
  ].join("\n") + "\n",
);
