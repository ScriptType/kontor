import { test, expect } from "@playwright/test";
import { start, storeGate, withLive } from "./live-fixture.js";

const request = "Zeige zuerst Kunden, danach Berichte und zuletzt Team.";
const sequence = ["nav:customers", "nav:reports", "nav:team"];
const tie = {
  choice: "nav:customers",
  confidence: 0.51,
  probabilities: { "nav:customers": 0.51, "nav:reports": 0.49 },
};
const duelAnswer = (probability: number) => ({
  choice: "nav:customers",
  confidence: probability,
  probabilities: {
    "nav:customers": probability,
    "nav:reports": 1 - probability,
  },
});

for (const run of [
  { gate: "g3-cpe-duel", duel: 0.9, finishes: true },
  { gate: "g3-cpe-duel", duel: 0.6, finishes: false },
  { gate: "g3-compact-plan-effect", duel: null, finishes: false },
] as const)
  test(`${run.gate} on a near tie between two views, duel at ${run.duel ?? "none"}`, async ({
    page,
  }) => {
    await storeGate(page, run.gate);
    await withLive(
      page,
      sequence,
      async (
        _store,
        _held,
        _arrived,
        snapshots,
        _observations,
        _assessed,
        texts,
      ) => {
        await start(page, request);
        await expect(page.locator(".activity-label")).toContainText(
          run.finishes
            ? "Jev meldet"
            : "Auswahl unter der Schwelle für diese Art von Schritt",
        );
        const history = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}")
              .history[0],
        );
        if (run.duel === null) {
          expect(snapshots.length).toBe(1);
          expect(history.duels).toBeUndefined();
          return;
        }
        expect(snapshots[1]).toEqual(["nav:customers", "nav:reports"]);
        expect(texts[1]?.["nav:customers"]).toContain('UI "');
        expect(history.duels).toEqual([
          {
            step: 0,
            options: ["nav:customers", "nav:reports"],
            choice: "nav:customers",
            probability: run.duel,
            acts: run.finishes,
          },
        ]);
        expect(
          history.steps.map(
            (step: { action: { id: string } }) => step.action.id,
          ),
        ).toEqual(run.finishes ? sequence : []);
      },
      {
        nextAnswer: (index) =>
          index === 0
            ? tie
            : index === 1 && run.duel !== null
              ? duelAnswer(run.duel)
              : {
                  choice:
                    sequence[index - (run.duel === null ? 0 : 1)] ?? "done",
                  confidence: 1,
                },
      },
    );
  });
