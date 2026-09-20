import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createJev } from "../server/jev.js";
import { seedWorkspace } from "../shared/domain.js";
import { demoGoal, demos } from "../shared/command.js";
import { prepareGoal } from "../frontend/src/command-plan.js";
const config = {
  mode: "live",
  apiKey: "test-only",
  model: "jev-latest",
} as const;
const provider = (
  values: Record<string, string>,
  inspect: (raw: unknown) => void = () => {},
) =>
  createJev(config, async (_url, init) => {
    const payload: unknown = JSON.parse(String(init?.body));
    inspect(payload);
    return Response.json({
      model: "jev-test",
      answers: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          {
            type: "choice",
            choice: value,
            confidence: 0.95,
            probabilities: { [value]: 1 },
          },
        ]),
      ),
    });
  });
const answers = {
  supported: "yes",
  persistence: "draft",
  openOnly: "no",
  filter: "no",
  assign: "no",
  schedule: "yes",
  time: "yes",
  complete: "no",
  case: "V-1042",
  technician: "unclear",
  customer: "unclear",
  workMinutes: "45",
  appointmentMinutes: "60",
  slot: "2026-09-24T09:00:00",
  order: "no",
};
test("live uses independent bounded source choices and preserves no-save plus distinct durations", async () => {
  let checked = false;
  const jev = provider(answers, (raw) => {
    const payload = z
      .object({
        state: z.string(),
        questions: z.record(
          z.string(),
          z.object({
            type: z.literal("choice"),
            criteria: z.record(z.string(), z.string()),
          }),
        ),
      })
      .parse(raw);
    checked = true;
    assert(payload.state.includes("NICHT speichern"));
    assert.deepEqual(
      Object.keys(payload.questions["workMinutes"]?.criteria ?? {}).sort(),
      ["45", "60", "unclear"],
    );
    assert(payload.questions["appointmentMinutes"]);
  });
  const goal = await jev.interpret(
    "V-1042 45 Minuten Arbeit erfassen, Termin 2026-09-24 09:00 für 60 Minuten, NICHT speichern",
    seedWorkspace(),
  );
  assert(checked);
  assert.equal(goal.persistence, "draft");
  assert.deepEqual(goal.objectives, [
    {
      kind: "schedule",
      appointment: { start: "2026-09-24T09:00:00", minutes: 60 },
    },
    { kind: "time", minutes: 45 },
  ]);
});
test("unsupported multi-record or partial request does not produce executable plan", async () => {
  const goal = await provider({ ...answers, supported: "no" }).interpret(
    "V-1042 Lea und V-1039 Jonas zuweisen, 45 Minuten und 60 Minuten am 2026-09-24 09:00",
    seedWorkspace(),
  );
  assert.equal(prepareGoal(goal, seedWorkspace(), null).kind, "question");
  assert.equal(goal.supported, false);
});
test("live rejects invented slots and controls outside the current candidate snapshot", async () => {
  await assert.rejects(
    provider({ ...answers, case: "V-9999" }).interpret(
      "45 Minuten 60 Minuten 2026-09-24 09:00",
      seedWorkspace(),
    ),
  );
  await assert.rejects(
    provider({ next: "hidden" }).decide({
      request: "Assign",
      context: "{}",
      actions: [{ id: "visible", label: "Visible", effect: "Open menu" }],
      expectedDemoAction: null,
      snapshotId: "one",
    }),
  );
});
test("planner keeps fixed order, physical facts, and stale approvals as blockers", () => {
  const workspace = seedWorkspace();
  const ordered = prepareGoal(demoGoal(demos[4]), workspace, null);
  assert.equal(ordered.kind, "question");
  if (ordered.kind === "question") assert.equal(ordered.question.kind, "order");
  const physical = prepareGoal(demoGoal(demos[6]), workspace, null);
  assert.equal(physical.kind, "question");
  if (physical.kind === "question")
    assert.equal(physical.question.kind, "evidence");
  const proposal = prepareGoal(demoGoal(demos[5]), workspace, null);
  assert.equal(proposal.kind, "proposal");
  if (proposal.kind !== "proposal") return;
  assert.equal(
    prepareGoal(demoGoal(demos[5]), workspace, proposal.proposal).kind,
    "ready",
  );
  assert.equal(
    prepareGoal(
      demoGoal(demos[5]),
      { ...workspace, revision: 1 },
      proposal.proposal,
    ).kind,
    "proposal",
  );
});
