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
  confidence: number | Record<string, number> = 0.95,
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
            confidence:
              typeof confidence === "number"
                ? confidence
                : (confidence[key] ?? 0.95),
            probabilities: { [value]: 1 },
          },
        ]),
      ),
    });
  });
const answers = {
  capability: "yes",
  coverage: "complete",
  cardinality: "yes",
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
    if (!payload.questions["workMinutes"]) return;
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
  const goal = await provider({ ...answers, cardinality: "no" }).interpret(
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

test("intent payload separates requested capability from mutable execution prerequisites", async () => {
  const workspace = seedWorkspace();
  const jev = provider(
    {
      ...answers,
      persistence: "save",
      schedule: "no",
      time: "no",
      complete: "yes",
      case: "V-1039",
      workMinutes: "unclear",
      appointmentMinutes: "unclear",
      slot: "unclear",
    },
    (raw) => {
      const payload = z
        .object({
          state: z.string(),
          questions: z.record(
            z.string(),
            z.object({
              instructions: z.string(),
              criteria: z.record(z.string(), z.string()),
            }),
          ),
        })
        .parse(raw);
      if (!payload.questions["case"]) return;
      const state = z
        .object({
          originalRequest: z.string(),
          references: z.unknown(),
          workspace: z.unknown().optional(),
        })
        .parse(JSON.parse(payload.state));
      assert.equal(state.originalRequest, "Schließe V-1039 ab.");
      assert.deepEqual(state.references, {
        cases: workspace.cases.map(({ id, title, site, customerId }) => ({
          id,
          title,
          site,
          customerId,
        })),
        technicians: workspace.technicians.map(({ id, name }) => ({
          id,
          name,
        })),
        customers: workspace.customers.map(({ id, name }) => ({ id, name })),
      });
      assert.equal(state.workspace, undefined);
      assert.match(
        payload.questions["persistence"]?.instructions ?? "",
        /direkter Änderungsauftrag/,
      );
      assert.match(
        payload.questions["persistence"]?.instructions ?? "",
        /draft und hat Vorrang/,
      );
      assert.deepEqual(
        Object.keys(payload.questions["case"]?.criteria ?? {}).sort(),
        ["unclear", ...workspace.cases.map((c) => c.id)].sort(),
      );
    },
  );
  const goal = await jev.interpret("Schließe V-1039 ab.", workspace);
  assert.equal(goal.supported, true);
  assert.equal(goal.persistence, "save");
  const prepared = prepareGoal(goal, workspace, null);
  assert.equal(prepared.kind, "question");
  if (prepared.kind === "question")
    assert.equal(prepared.question.kind, "evidence");
});

test("intent confidence below the existing threshold remains non-executable", async () => {
  const goal = await provider(answers, () => {}, 0.74).interpret(
    "V-1042 45 Minuten Arbeit erfassen, Termin 2026-09-24 09:00 für 60 Minuten, NICHT speichern",
    seedWorkspace(),
  );
  assert.equal(goal.supported, false);
  assert.equal(goal.persistence, "unclear");
  assert.equal(prepareGoal(goal, seedWorkspace(), null).kind, "question");
});

test("action selection still receives current execution context", async () => {
  const context = JSON.stringify(seedWorkspace());
  let checked = false;
  await provider({ next: "visible" }, (raw) => {
    const payload = z.object({ state: z.string() }).parse(raw);
    const state = z
      .object({ context: z.string() })
      .parse(JSON.parse(payload.state));
    assert.equal(state.context, context);
    checked = true;
  }).decide({
    request: "Schließe V-1039 ab.",
    context,
    actions: [{ id: "visible", label: "Visible", effect: "Open case" }],
    expectedDemoAction: null,
    snapshotId: "one",
  });
  assert(checked);
});

const filterAnswers = {
  ...answers,
  filter: "yes",
  schedule: "no",
  time: "no",
  customer: "nord",
  workMinutes: "unclear",
  appointmentMinutes: "unclear",
  slot: "unclear",
  persistence: "draft",
  order: "unclear",
  case: "V-1042",
};
test("read-only filter needs neither save authority nor a case draft", async () => {
  const workspace = seedWorkspace();
  const goal = await provider(filterAnswers).interpret(
    "Filter nach nordwerk",
    workspace,
  );
  assert.equal(goal.supported, true);
  assert.equal(goal.caseId, null);
  assert.equal(goal.persistence, "unclear");
  assert.deepEqual(goal.objectives, [
    { kind: "filter", customerId: "nord", openOnly: false },
  ]);
  assert.deepEqual(prepareGoal(goal, workspace, null), {
    kind: "ready",
    desired: null,
  });
  assert.deepEqual(
    prepareGoal({ ...goal, caseId: "V-1042" }, workspace, null),
    { kind: "ready", desired: null },
  );
});

for (const item of [
  { key: "case", question: "case" },
  { key: "technician", question: "technician" },
]) {
  test(`missing ${item.key} reaches its specific question`, async () => {
    const goal = await provider({
      ...filterAnswers,
      filter: "no",
      assign: "yes",
      persistence: "save",
      technician: "lea",
      [item.key]: "unclear",
    }).interpret("Bitte zuweisen", seedWorkspace());
    assert.equal(goal.supported, true);
    const result = prepareGoal(goal, seedWorkspace(), null);
    assert.equal(result.kind, "question");
    if (result.kind === "question")
      assert.equal(result.question.kind, item.question);
  });
}
for (const key of ["capability", "cardinality", "assign"]) {
  test(`uncertain ${key} cannot silently execute only a filter`, async () => {
    const goal = await provider({
      ...filterAnswers,
      [key]: "unclear",
      coverage: "mismatch",
    }).interpret("Filter und Änderung", seedWorkspace());
    assert.equal(goal.supported, false);
    const result = prepareGoal(goal, seedWorkspace(), null);
    assert.equal(result.kind, "question");
    if (result.kind === "question")
      assert.equal(result.question.kind, "unsupported");
  });
}
test("action and remedy confidence below .75 still cannot select a control or person", async () => {
  const jev = provider({ next: "save", remedy: "lea" }, () => {}, 0.74);
  assert.deepEqual(
    await jev.decide({
      request: "Speichern",
      context: "{}",
      actions: [{ id: "save", label: "Speichern", effect: "Persist" }],
      expectedDemoAction: "save",
      snapshotId: "one",
    }),
    { snapshotId: "one", actionId: null },
  );
  assert.deepEqual(
    await jev.remedy("Termin setzen", [{ id: "lea", label: "Lea" }], "{}"),
    { technicianId: null },
  );
});

for (const choice of ["yes", "no"]) {
  for (const coverage of ["mismatch", "unclear"]) {
    test(`coverage ${coverage} refuses a requested time clause classified ${choice} below threshold`, async () => {
      const goal = await provider(
        { ...filterAnswers, time: choice, coverage },
        () => {},
        { time: 0.6 },
      ).interpret(
        "Filter nach Nordwerk und erfasse 25 Minuten für V-1042",
        seedWorkspace(),
      );
      assert.equal(goal.supported, false);
      const result = prepareGoal(goal, seedWorkspace(), null);
      assert.equal(result.kind, "question");
      if (result.kind === "question")
        assert.equal(result.question.kind, "unsupported");
    });
  }
}
test("explicit coverage permits an irrelevant uncertain negative without inventing a goal", async () => {
  const goal = await provider({ ...filterAnswers, time: "no" }, () => {}, {
    time: 0.6,
  }).interpret("Filter nach Nordwerk", seedWorkspace());
  assert.equal(goal.supported, true);
  assert.deepEqual(goal.objectives, [
    { kind: "filter", customerId: "nord", openOnly: false },
  ]);
  assert.deepEqual(prepareGoal(goal, seedWorkspace(), null), {
    kind: "ready",
    desired: null,
  });
});
test("uncertain coverage cannot authorize a partially understood request", async () => {
  const goal = await provider(filterAnswers, () => {}, {
    coverage: 0.74,
  }).interpret("Filter und Arbeitszeit", seedWorkspace());
  assert.equal(goal.supported, false);
});

test("uncertain selected identity reaches a case question while clear assignment survives", async () => {
  const goal = await provider(
    {
      ...filterAnswers,
      filter: "no",
      assign: "yes",
      persistence: "save",
      technician: "lea",
    },
    () => {},
    { case: 0.6 },
  ).interpret("Weise die Wartung Lea Sommer zu", seedWorkspace());
  assert.equal(goal.supported, true);
  assert.equal(goal.caseId, null);
  assert.deepEqual(goal.objectives, [{ kind: "assign", technicianId: "lea" }]);
  const result = prepareGoal(goal, seedWorkspace(), null);
  assert.equal(result.kind, "question");
  if (result.kind === "question") assert.equal(result.question.kind, "case");
});

test("an empty confident kind set never reaches coverage or becomes executable", async () => {
  let calls = 0;
  const goal = await provider({ ...filterAnswers, filter: "no" }, () => {
    calls++;
  }).interpret("Unklarer Auftrag", seedWorkspace());
  assert.equal(calls, 1);
  assert.equal(goal.supported, false);
  assert.deepEqual(goal.objectives, []);
});
