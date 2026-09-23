import { test, expect } from "@playwright/test";
import { start, storeGate, withLive } from "./live-fixture.js";

const request = "Weise V-1042 Lea Sommer zu und speichere.";
const sequence = ["case:V-1042", "menu:technician", "technician:lea", "save"];
// One work step on V-1042 that sets its technician to Lea.
const plan = {
  yes: [
    "g0",
    "g4",
    "s0.case.V-1042",
    "s0.V-1042.chg.technician",
    "s0.V-1042.is.technician.lea",
  ],
};

for (const run of [
  { gate: "g3-compact-plan", finishes: true },
  { gate: "g3-compact", finishes: false },
] as const)
  test(`${run.gate} with a save pick at 60 percent and P(complete) 0.5`, async ({
    page,
  }) => {
    await storeGate(page, run.gate);
    const calls: string[][] = [];
    await withLive(
      page,
      sequence,
      async (store) => {
        await start(page, request);
        await expect(page.locator(".activity-label")).toContainText(
          run.finishes
            ? "Jev meldet"
            : "Auswahl unter der Schwelle für diese Art von Schritt",
        );
        const saved = store.snapshot().cases.find((c) => c.id === "V-1042");
        expect(saved?.technicianId).toBe(run.finishes ? "lea" : "jonas");
        const history = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}")
              .history[0],
        );
        if (!run.finishes) {
          expect(calls).toEqual([]);
          expect(history.plan).toBeUndefined();
          expect(history.votes).toBeUndefined();
          return;
        }
        expect(calls.length).toBe(3);
        expect(history.plan).toMatchObject({
          cases: { "V-1042": { technician: "lea" } },
          visits: ["cases"],
        });
        expect(history.votes).toEqual([
          { step: 3, choice: "save", via: "pick", slot: "save:V-1042#0" },
          { step: 4, choice: "done", via: "completion", slot: "done" },
        ]);
      },
      {
        plan: { ...plan, calls },
        completeProbability: 0.5,
        nextAnswer: (index) =>
          index === 3
            ? {
                choice: "save",
                confidence: 0.6,
                probabilities: { save: 0.6, abstain: 0.4 },
              }
            : { choice: sequence[index] ?? "done", confidence: 1 },
      },
    );
  });

for (const run of [
  { gate: "g3-compact-plan-effect", finishes: true },
  { gate: "g3-compact-plan", finishes: false },
] as const)
  test(`${run.gate} with an effect check calling the save additional`, async ({
    page,
  }) => {
    await storeGate(page, run.gate);
    await withLive(
      page,
      sequence,
      async (store) => {
        await start(page, request);
        await expect(page.locator(".activity-label")).toContainText(
          run.finishes ? "Jev meldet" : "Effektprüfung",
        );
        const saved = store.snapshot().cases.find((c) => c.id === "V-1042");
        expect(saved?.technicianId).toBe(run.finishes ? "lea" : "jonas");
        const history = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}")
              .history[0],
        );
        expect(history.votes ?? []).toEqual(
          run.finishes
            ? [
                {
                  step: 3,
                  choice: "save",
                  via: "effect",
                  slot: "save:V-1042#0",
                },
              ]
            : [],
        );
      },
      {
        plan: { ...plan, calls: [] },
        effectAnswer: () => ({ choice: "additional", confidence: 0.9 }),
      },
    );
  });

for (const gate of ["g3-cpe-todo", "g3-compact-plan-effect"] as const)
  test(`${gate} tells Jev what the plan still leaves open at each step`, async ({
    page,
  }) => {
    await storeGate(page, gate);
    await withLive(
      page,
      sequence,
      async (_store, _held, _arrived, _snapshots, observations) => {
        await start(page, request);
        await expect(page.locator(".activity-label")).toContainText(
          "Jev meldet",
        );
        const readings = observations.map(
          (state) =>
            (state as { requestHints?: { planReading?: unknown } })
              .requestHints?.planReading,
        );
        const edit = [
          "case V-1042: assigned technician should become Lea Sommer (now Jonas Weber)",
          "case V-1042: save the change",
        ];
        expect(readings).toEqual(
          gate === "g3-cpe-todo"
            ? [
                edit,
                edit,
                edit,
                ["case V-1042: save the change"],
                ["nothing remains per the reading"],
              ].map((stillOpen) => ({
                note: "A machine reading of the request. It can be wrong; the request itself decides.",
                stillOpen,
              }))
            : Array(5).fill(undefined),
        );
      },
      { plan: { ...plan, calls: [] } },
    );
  });
