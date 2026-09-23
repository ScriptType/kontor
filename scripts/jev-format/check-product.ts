import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  gates,
  type GateName,
  type GatePolicy,
} from "../../frontend/src/gate.js";
import { createJev } from "../../server/jev.js";
import type { DecisionInput } from "../../shared/command.js";
import { seedWorkspace } from "../../shared/domain.js";
import { requestHints } from "../../shared/request-hints.js";
import {
  assessState,
  formatDir,
  type AssessQuestions,
  type BenchState,
  type SentAction,
} from "./bench.js";
import { variants } from "./variants.js";

// The product gates must send the state their bench variant measured. Each
// recorded state is turned back into a decision input, sent through
// server/jev.ts under the gate's prompt, and compared with the variant.
// Recordings under g3 carry the full state, those under g3-cpe-duel the
// compact one that g4 also sends; each form checks the gates built on it.
const states: BenchState[] = JSON.parse(
  await readFile(join(formatDir, "states.json"), "utf8"),
);
const arms: { gate: GateName; variant: keyof typeof variants }[] = states[0]
  ?.state.availableActions
  ? [
      { gate: "g3", variant: "identity" },
      { gate: "g3-focused", variant: "c3-dedupe-end-hints" },
      { gate: "g3-compact", variant: "c6-squeeze-hints" },
    ]
  : [
      { gate: "g3-cpe-duel", variant: "identity" },
      { gate: "g4", variant: "identity" },
      { gate: "g4-lean", variant: "l9-slim-after" },
    ];
const questions: AssessQuestions = JSON.parse(
  await readFile(join(formatDir, "assess-questions.json"), "utf8"),
);
// An action whose text is already rendered: `does` carries it whole.
const action = (a: SentAction) => ({
  ...a,
  jev: { does: a.effect, reveals: "" },
});
function inputOf(state: BenchState, gate: GateName) {
  const s = state.state;
  const policy: GatePolicy = gates[gate];
  const { prompt } = policy;
  // A compact decide leaves the facts' blocked controls out; the check state
  // puts them back where the browser wrote them.
  const facts = z
    .object({ currentFacts: z.record(z.string(), z.unknown()) })
    .loose()
    .parse(assessState(state, "done")).currentFacts;
  const blocked = z
    .array(
      z
        .object({ action: z.custom<SentAction>() })
        .loose()
        .transform((c) => ({ ...c, action: action(c.action) })),
    )
    .parse(s.blockedControls);
  return {
    request: s.originalRequest,
    snapshotId: s.snapshotId ?? state.id,
    context: JSON.stringify(facts),
    actions: state.actions.map(action),
    fields: s.availableFields.map((f) => ({ ...f, jev: { name: f.label } })),
    blockedControls: blocked,
    answers: s.explicitAnswers,
    steps: s.observedSteps.map((step) => ({
      snapshotId: "earlier",
      action: action(step.action),
      authorizedBy: step.authorizedBy,
      outcome: step.outcome,
      before: JSON.stringify(step.before),
      after: JSON.stringify(step.after),
    })),
    doneBeforeFirstStep: false,
    state: "full",
    prompt,
    history: policy.history ?? "full",
    ...(prompt === "full"
      ? {}
      : {
          hints:
            s.requestHints ?? requestHints(s.originalRequest, seedWorkspace()),
        }),
  } as DecisionInput;
}
let differences = 0;
for (const { gate, variant } of arms) {
  const sent: string[] = [];
  const jev = createJev(
    { mode: "live", apiKey: "check", model: "check" },
    async (_url, init) => {
      const body = z
        .object({
          state: z.string(),
          questions: z.record(
            z.string(),
            z.object({ criteria: z.record(z.string(), z.unknown()) }),
          ),
        })
        .parse(JSON.parse(String(init?.body)));
      sent.push(body.state);
      const [key, question] = Object.entries(body.questions)[0]!;
      const options = Object.keys(question.criteria);
      return Response.json({
        model: "check",
        answers: {
          [key]: {
            type: "choice",
            choice: options[0],
            confidence: 1,
            probabilities: Object.fromEntries(
              options.map((o, i) => [o, i === 0 ? 1 : 0]),
            ),
          },
        },
      });
    },
  );
  const bench = variants[variant];
  let differ = 0;
  for (const state of states) {
    const input = inputOf(state, gate);
    sent.length = 0;
    await jev.decide(input);
    await jev.assess({ ...input, selected: "done" });
    const [first] = input.actions;
    if (first) await jev.assess({ ...input, selected: first });
    const expected = [
      bench.decide(state).state,
      bench.assess(state, "done", questions).state,
      ...(first ? [bench.assess(state, first.id, questions).state] : []),
    ];
    if (JSON.stringify(expected) !== JSON.stringify(sent.slice(0, 3))) differ++;
  }
  differences += differ;
  process.stdout.write(
    `${gate} vs ${variant}: ${differ} of ${states.length} states send a different decide or check state\n`,
  );
}
process.exit(differences ? 1 : 0);
