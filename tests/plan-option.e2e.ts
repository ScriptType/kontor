import { test, expect, type Page } from "@playwright/test";
import { z } from "zod";
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
// Two views near a tie lead; the plan's case trails them.
const split = {
  choice: "nav:customers",
  confidence: 0.4,
  probabilities: {
    "nav:customers": 0.4,
    "nav:reports": 0.35,
    "case:V-1042": 0.25,
  },
};
const review = (page: Page) =>
  page.getByRole("region", { name: "Jev-Vorschläge prüfen" });
const offered = (page: Page) =>
  review(page)
    .locator("[data-review-option]")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-review-option")),
    );
const history = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}").history[0],
  );
const selectedId = (selected: unknown) =>
  z.object({ id: z.string() }).safeParse(selected).data?.id ?? selected;

test("a review offers the plan's option beside Jev's two and runs it after its own effect check", async ({
  page,
}) => {
  await storeGate(page, "g3-compact-plan-effect");
  await withLive(
    page,
    sequence,
    async (store, _held, _arrived, _snapshots, _observations, assessed) => {
      await start(page, request);
      await expect(review(page)).toBeVisible();
      expect(await offered(page)).toEqual([
        "nav:customers",
        "nav:reports",
        "case:V-1042",
      ]);
      const row = review(page).locator("[data-review-plan]");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Vorschlag aus dem gelesenen Auftrag");
      await expect(row).toContainText("Optionswahrscheinlichkeit 25 %");
      await row.locator('[data-review-option="case:V-1042"]').click();
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(assessed.map(selectedId)[0]).toBe("case:V-1042");
      expect(
        store.snapshot().cases.find((c) => c.id === "V-1042")?.technicianId,
      ).toBe("lea");
      const run = await history(page);
      expect(run.steps[0]).toMatchObject({
        action: { id: "case:V-1042" },
        authorizedBy: "user",
      });
    },
    {
      plan: { ...plan, calls: [] },
      nextAnswer: (index) =>
        index === 0
          ? split
          : { choice: sequence[index] ?? "done", confidence: 1 },
    },
  );
});

test("a review without a plan offers only Jev's two options", async ({
  page,
}) => {
  await storeGate(page, "g3-compact");
  await withLive(
    page,
    sequence,
    async () => {
      await start(page, request);
      await expect(review(page)).toBeVisible();
      expect(await offered(page)).toEqual(["nav:customers", "nav:reports"]);
      await expect(review(page).locator("[data-review-plan]")).toHaveCount(0);
    },
    {
      plan: { ...plan, calls: [] },
      nextAnswer: (index) =>
        index === 0
          ? split
          : { choice: sequence[index] ?? "done", confidence: 1 },
    },
  );
});

// Two views tie, the duel between them stays below its bar, and the plan's case trails.
const trailing = (probability: number) => ({
  choice: "nav:customers",
  confidence: (1 - probability) / 2,
  probabilities: {
    "nav:customers": (1 - probability) / 2,
    "nav:reports": (1 - probability) / 2,
    "case:V-1042": probability,
  },
});
const unsureDuel = {
  choice: "nav:customers",
  confidence: 0.6,
  probabilities: { "nav:customers": 0.6, "nav:reports": 0.4 },
};

for (const run of [
  { gate: "g3-cpe-steer", probability: 0.1, acts: true },
  { gate: "g3-cpe-steer", probability: 0.09, acts: false },
  { gate: "g3-cpe-duel", probability: 0.1, acts: false },
] as const)
  test(`${run.gate} with the plan's case at ${run.probability} after an unsure duel`, async ({
    page,
  }) => {
    await storeGate(page, run.gate);
    await withLive(
      page,
      sequence,
      async (store) => {
        await start(page, request);
        await expect(page.locator(".activity-label")).toContainText(
          run.acts ? "Jev meldet" : "Auswahl unter der Schwelle",
        );
        const history = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}")
              .history[0],
        );
        expect(history.duels).toMatchObject([{ step: 0, acts: false }]);
        expect(history.steers).toEqual(
          run.gate === "g3-cpe-steer"
            ? [
                {
                  step: 0,
                  choice: "case:V-1042",
                  probability: run.probability,
                  slot: "cases=V-1042",
                  acts: run.acts,
                },
              ]
            : undefined,
        );
        expect(
          store.snapshot().cases.find((c) => c.id === "V-1042")?.technicianId,
        ).toBe(run.acts ? "lea" : "jonas");
        if (!run.acts)
          expect(await offered(page)).toEqual([
            "nav:customers",
            "nav:reports",
            "case:V-1042",
          ]);
      },
      {
        plan: { ...plan, calls: [] },
        nextAnswer: (index) =>
          index === 0
            ? trailing(run.probability)
            : index === 1
              ? unsureDuel
              : { choice: sequence[index - 1] ?? "done", confidence: 1 },
      },
    );
  });

// Two views tie and their duel stays unsure while the plan's next step, a write or done, trails.
for (const run of [
  { kind: "draft", at: 2, trails: "technician:lea", saved: "jonas" },
  { kind: "save", at: 3, trails: "save", saved: "jonas" },
  { kind: "done", at: 4, trails: "done", saved: "lea" },
] as const)
  test(`g3-cpe-steer never steers to a ${run.kind}`, async ({ page }) => {
    await storeGate(page, "g3-cpe-steer");
    await withLive(
      page,
      sequence,
      async (store) => {
        await start(page, request);
        await expect(page.locator(".activity-label")).toContainText(
          "Auswahl unter der Schwelle",
        );
        expect(
          store.snapshot().cases.find((c) => c.id === "V-1042")?.technicianId,
        ).toBe(run.saved);
        const history = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}")
              .history[0],
        );
        expect(history.steps).toHaveLength(run.at);
        expect(history.duels).toMatchObject([{ step: run.at, acts: false }]);
        expect(
          (history.steers ?? []).filter(
            (steer: { acts: boolean }) => steer.acts,
          ),
        ).toEqual([]);
        expect(await offered(page)).toEqual([
          "nav:customers",
          "nav:reports",
          run.trails,
        ]);
      },
      {
        plan: { ...plan, calls: [] },
        nextAnswer: (index) =>
          index === run.at
            ? {
                choice: "nav:customers",
                confidence: 0.35,
                probabilities: {
                  "nav:customers": 0.35,
                  "nav:reports": 0.35,
                  [run.trails]: 0.3,
                },
              }
            : index === run.at + 1
              ? unsureDuel
              : { choice: sequence[index] ?? "done", confidence: 1 },
      },
    );
  });
