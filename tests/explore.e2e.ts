import { test, expect } from "@playwright/test";
import { z } from "zod";
import { start, storeGate, withLive } from "./live-fixture.js";

for (const run of [
  {
    gate: "explore-nomem",
    message: "Schritt zweimal ohne Wirkung ausgeführt",
  },
  { gate: "g1", message: "Wiederholter Schritt ohne Fortschritt" },
] as const)
  test(`${run.gate} stops a run that keeps choosing a view without effect`, async ({
    page,
  }) => {
    await storeGate(page, run.gate);
    await withLive(
      page,
      [],
      async (store, _held, _arrived, snapshots) => {
        await start(page, "Zeige die Vorgänge.");
        await expect(page.locator(".activity-label")).toContainText(
          run.message,
        );
        expect(snapshots).toHaveLength(3);
        expect(store.snapshot().revision).toBe(0);
      },
      {
        nextAnswer: () => ({
          choice: "nav:cases",
          confidence: 1,
          probabilities: { "nav:cases": 1 },
        }),
      },
    );
  });

const leanState = z.object({
  observedSteps: z.array(
    z.object({
      action: z.string(),
      kind: z.string(),
      changes: z.array(
        z.object({ path: z.string(), from: z.unknown(), to: z.unknown() }),
      ),
    }),
  ),
});
test("explore sends a lean state without options that change nothing", async ({
  page,
}) => {
  await storeGate(page, "explore");
  await withLive(
    page,
    ["nav:reports"],
    async (_store, _held, _arrived, snapshots, observations) => {
      await start(page, "Zeige Berichte.");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(snapshots[0]).not.toContain("nav:cases");
      expect(snapshots[0]).toContain("nav:reports");
      expect(snapshots[0]).not.toContain("done");
      expect(snapshots[1]).not.toContain("nav:reports");
      expect(snapshots[1]).toContain("done");
      const [, second] = observations;
      expect(second).not.toHaveProperty("availableActions");
      expect(second).not.toHaveProperty("snapshotId");
      expect(leanState.parse(second).observedSteps[0]?.changes).toContainEqual({
        path: "page",
        from: "cases",
        to: "reports",
      });
    },
  );
});
test("explore-nomem keeps the full state and every option", async ({
  page,
}) => {
  await storeGate(page, "explore-nomem");
  await withLive(
    page,
    ["nav:reports"],
    async (_store, _held, _arrived, snapshots, observations) => {
      await start(page, "Zeige Berichte.");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(snapshots[0]).toContain("nav:cases");
      expect(snapshots[1]).toContain("nav:reports");
      const [, second] = observations;
      expect(second).toHaveProperty("availableActions");
      expect(second).toHaveProperty("snapshotId");
      expect(second).toHaveProperty("observedSteps.0.before");
    },
  );
});
test("g3-mem sends the lean state to decide and drops options that change nothing", async ({
  page,
}) => {
  await storeGate(page, "g3-mem");
  await withLive(
    page,
    ["nav:reports"],
    async (_store, _held, _arrived, snapshots, observations) => {
      await start(page, "Zeige Berichte.");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(snapshots[0]).not.toContain("nav:cases");
      const [, second] = observations;
      expect(second).not.toHaveProperty("availableActions");
      expect(leanState.parse(second).observedSteps[0]?.changes).toContainEqual({
        path: "page",
        from: "cases",
        to: "reports",
      });
    },
  );
});
