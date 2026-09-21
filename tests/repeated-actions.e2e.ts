import { test, expect } from "@playwright/test";
import { start, withLive } from "./live-fixture.js";
import { z } from "zod";

test("same technician uses the visible handler without claiming an unsaved draft", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1041", "menu:technician", "technician:jonas"],
    async (store) => {
      const before = store.snapshot();
      await start(page, "Weise V-1041 erneut Jonas zu.");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      await expect(
        page.getByText("Ungespeicherter Entwurf", { exact: true }),
      ).toHaveCount(0);
      expect(store.snapshot()).toEqual(before);
    },
  );
});

test("saved matching assignments can run twice without writes or fake receipts", async ({
  page,
}) => {
  const choices = [
    "field:minutes:60",
    "menu:technician",
    "technician:mara",
    "menu:customer",
    "customer:nord",
    "nav:reports",
    "done",
    "nav:cases",
    "field:minutes:60",
    "menu:technician",
    "technician:mara",
    "nav:reports",
    "done",
  ];
  await withLive(
    page,
    [],
    async (store, _held, _arrived, snapshots) => {
      await page.locator('[data-action="case:V-1041"]').click();
      await page.locator('[data-action="menu:technician"]').click();
      await page.locator('[data-action="technician:mara"]').click();
      await page.locator("#minutes").fill("60");
      await page.locator('[data-action="save"]').click();
      await expect.poll(() => store.snapshot().revision).toBe(1);
      await expect(page.locator('[data-action="save"]')).toBeDisabled();
      const before = store.snapshot();
      for (let repetition = 1; repetition <= 2; repetition++) {
        await start(
          page,
          "Ändere 1041 auf marla, sie wird das machen. 60 minuten wird sie brauchen. Setze einen Filter auf nordweg, und dann zeig mir die berichte ansicht",
        );
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}")
                  .history?.length,
            ),
          )
          .toBe(repetition);
        await expect(page.locator(".activity-label")).toContainText(
          "Jev meldet",
        );
        await expect(page).toHaveURL(/#reports$/);
        const run = z
          .object({
            operations: z.array(z.string()),
            receipts: z.array(z.unknown()),
            steps: z.array(
              z.object({
                action: z.object({ id: z.string() }),
                outcome: z.string(),
                after: z.string(),
              }),
            ),
          })
          .parse(
            await page.evaluate(
              () =>
                JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}")
                  .history[0],
            ),
          );
        expect(run.operations).toEqual([]);
        expect(run.receipts).toEqual([]);
        expect(
          run.steps
            .filter((step) =>
              ["field:minutes:60", "technician:mara"].includes(step.action.id),
            )
            .map((step) => step.outcome),
        ).toEqual(["unchanged", "unchanged"]);
        const last = run.steps.at(-1);
        expect(JSON.parse(last?.after ?? "{}")).toMatchObject({
          selected: { minutes: 60, technicianId: "mara" },
          dirty: false,
          draftOwner: "manual",
        });
        expect(store.snapshot()).toEqual(before);
      }
      expect(snapshots[0]).toContain("field:minutes:60");
      expect(snapshots[0]).toContain("field:minutes:1041");
    },
    {
      nextAnswer: (index) => ({
        choice: choices[index] ?? "abstain",
        confidence: 1,
      }),
      effectAnswer: () => ({ choice: "authorized", confidence: 1 }),
    },
  );
});

test("an equal manual input invalidates a pending decision", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1041", "field:minutes:60"],
    async (store, held, arrived) => {
      await start(page, "Erfasse 60 Minuten für V-1041.");
      await arrived;
      await page
        .locator("#minutes")
        .evaluate((input) =>
          input.dispatchEvent(new Event("input", { bubbles: true })),
        );
      await expect(page.locator(".activity-label")).toContainText(
        "manuellem Eingriff",
      );
      held.release();
      await expect(page.locator("#minutes")).toHaveValue("45");
      await expect(
        page.getByText("Ungespeicherter Entwurf", { exact: true }),
      ).toHaveCount(0);
      expect(store.snapshot().revision).toBe(0);
    },
    { hold: "field:minutes:60" },
  );
});

test("equal values in a dirty draft remain unsaved evidence", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1041", "field:minutes:60", "field:minutes:60", "nav:reports"],
    async (store, _held, _arrived, _snapshots, observations) => {
      await start(
        page,
        "Trage 60 Minuten als Entwurf für V-1041 ein und zeige Berichte. Nicht speichern.",
      );
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      const facts = z
        .object({
          observedSteps: z.array(
            z.object({
              outcome: z.string(),
              after: z.object({
                draft: z.object({ minutes: z.number() }),
                selected: z.object({ minutes: z.number() }),
                dirty: z.boolean(),
              }),
            }),
          ),
        })
        .parse(observations.at(-1));
      expect(facts.observedSteps[2]).toMatchObject({
        outcome: "unchanged",
        after: {
          draft: { minutes: 60 },
          selected: { minutes: 45 },
          dirty: true,
        },
      });
      expect(store.snapshot().revision).toBe(0);
    },
  );
});
