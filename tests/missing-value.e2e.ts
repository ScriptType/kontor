import { test, expect } from "@playwright/test";
import { start, withLive } from "./live-fixture.js";

const report =
  "Setze V-1042 auf einen am 06.09 und setzt wen anderes vom team dort ein als gerade gegeben der verfügbar ist";

test("a date without a time is prefilled, the time is asked, and the answer saves both", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-22T09:00:00"));
  const before = [
    "case:V-1042",
    "menu:technician",
    "technician:lea",
    "ask:appointment",
  ];
  const after = ["field:appointment:2026-09-06T10:00", "save", "done"];
  let answeredAt: number | null = null;
  await withLive(
    page,
    [],
    async (store, _held, _arrived, snapshots) => {
      await start(page, report);
      const panel = page.locator(".answer-panel");
      await expect(panel).toContainText("Antwort ausstehend");
      const date = panel.getByLabel("V-1042 · Termin · Datum");
      const time = panel.getByLabel("V-1042 · Termin · Uhrzeit");
      await expect(date).toHaveValue("2026-09-06");
      await expect(time).toHaveValue("");
      await expect(time).toBeFocused();
      await expect(panel).toContainText(
        "06.09.2026 liegt in der Vergangenheit.",
      );
      await expect(panel).toContainText(
        "Entwurf von V-1042 ist vorbereitet und noch nicht gespeichert.",
      );
      expect(store.snapshot().revision).toBe(0);
      await page.getByRole("button", { name: "Wert bestätigen" }).click();
      await expect(panel).toContainText("Bitte Datum und Uhrzeit angeben.");
      await expect(panel).toContainText("Antwort ausstehend");
      await time.fill("10:00");
      answeredAt = snapshots.length;
      await page.getByRole("button", { name: "Wert bestätigen" }).click();
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(store.snapshot().revision).toBe(1);
      expect(
        store.snapshot().cases.find((c) => c.id === "V-1042"),
      ).toMatchObject({
        technicianId: "lea",
        appointment: { start: "2026-09-06T10:00:00", minutes: 60 },
      });
    },
    {
      nextAnswer: (index) => ({
        choice:
          answeredAt === null
            ? (before[index] ?? "save")
            : (after[index - answeredAt] ?? "done"),
        confidence: 1,
      }),
    },
  );
});
