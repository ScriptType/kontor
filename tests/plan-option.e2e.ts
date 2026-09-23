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
