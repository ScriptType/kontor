import { test, expect } from "@playwright/test";
import { start, withLive } from "./live-fixture.js";

const report =
  "Setze V-1042 auf einen am 06.09 und setzt wen anderes vom team dort ein als gerade gegeben der verfügbar ist";
/** Jev reads the day of the report and no time. */
const readSixthOfSeptember = {
  "f0.mode": "absolute",
  "f0.month": "9",
  "f0.day": "6",
  "f0.year": "none",
};

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
      read: readSixthOfSeptember,
    },
  );
});

const script =
  (choices: string[]) =>
  (index: number): { choice: string; confidence: number } => ({
    choice: choices[index] ?? "done",
    confidence: 1,
  });

test("a noted question waits for the save while Jev assigns another technician", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-22T09:00:00"));
  await withLive(
    page,
    [],
    async (store, _held, _arrived, snapshots) => {
      await start(page, report);
      await expect(page.locator(".answer-panel")).toContainText(
        "Antwort ausstehend",
      );
      expect(snapshots).toHaveLength(5);
      await expect(
        page.locator('[data-action="menu:technician"]'),
      ).toContainText("Lea Sommer");
      expect(store.snapshot().revision).toBe(0);
      expect(snapshots[1]).toContain("ask:appointment");
      for (const options of snapshots.slice(2)) {
        expect(options).not.toContain("ask:appointment");
        expect(
          options.filter((id) => id.startsWith("field:appointment:")),
        ).toEqual([]);
      }
      await page.getByLabel("V-1042 · Termin · Uhrzeit").fill("10:00");
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
      nextAnswer: script([
        "case:V-1042",
        "ask:appointment",
        "menu:technician",
        "technician:lea",
        "save",
        "field:appointment:2026-09-06T10:00",
        "save",
      ]),
      read: readSixthOfSeptember,
    },
  );
});

test("done while a question is noted raises it instead of finishing", async ({
  page,
}) => {
  await withLive(
    page,
    [],
    async (store, _held, _arrived, snapshots, _observations, assessed) => {
      await start(page, "Erfasse Arbeitszeit für V-1042 und speichere.");
      await expect(page.locator(".answer-panel")).toContainText(
        "Antwort ausstehend",
      );
      await expect(page.locator(".answer-panel")).toContainText(
        "V-1042 · Arbeitszeit",
      );
      expect(snapshots).toHaveLength(3);
      expect(assessed).not.toContain("done");
      expect(store.snapshot().revision).toBe(0);
    },
    { nextAnswer: script(["case:V-1042", "ask:minutes", "done"]) },
  );
});

test("a noted question comes before the run leaves its case", async ({
  page,
}) => {
  await withLive(
    page,
    [],
    async (_store, _held, _arrived, snapshots) => {
      await start(
        page,
        "Erfasse Arbeitszeit für V-1042 und zeig dann Berichte",
      );
      await expect(page.locator(".answer-panel")).toContainText(
        "V-1042 · Arbeitszeit",
      );
      expect(snapshots).toHaveLength(3);
      await expect(page).not.toHaveURL(/#reports$/);
    },
    { nextAnswer: script(["case:V-1042", "ask:minutes", "nav:reports"]) },
  );
});

test("an unsure step after a noted question raises the question, not a review", async ({
  page,
}) => {
  const choices = ["case:V-1042", "ask:minutes"];
  await withLive(
    page,
    [],
    async (store, _held, _arrived, snapshots) => {
      await start(page, "Erfasse Arbeitszeit für V-1042 und speichere.");
      await expect(page.locator(".answer-panel")).toContainText(
        "V-1042 · Arbeitszeit",
      );
      await expect(page.locator(".choice-review")).toHaveCount(0);
      expect(snapshots).toHaveLength(3);
      expect(store.snapshot().revision).toBe(0);
    },
    {
      nextAnswer: (index) =>
        choices[index] === undefined
          ? {
              choice: "priority:Normal",
              confidence: 0.4,
              probabilities: {
                "priority:Normal": 0.4,
                "nav:team": 0.35,
                abstain: 0.25,
              },
            }
          : { choice: choices[index] ?? "done", confidence: 1 },
    },
  );
});

const correction =
  "V-1041: zwei Stunden is zu lang, mach mal neunzig Minuten draus";
test("the duration answer is prefilled with the value Jev reads as the new one, not the old one", async ({
  page,
}) => {
  await withLive(
    page,
    [],
    async () => {
      await start(page, correction);
      const panel = page.locator(".answer-panel");
      await expect(panel).toContainText("Aus dem Auftrag: 90. Bitte prüfen.");
      await expect(
        panel.getByLabel("V-1041 · Termindauer in Minuten"),
      ).toHaveValue("90");
    },
    {
      nextAnswer: script(["case:V-1041", "ask:duration", "done"]),
      read: {
        "f0.field": "duration",
        "f0.span": "word",
        "f0.word": "90",
        "f0.unit": "minutes",
      },
    },
  );
});

test("the answer stays empty when Jev reads no new value, though the request names the old one", async ({
  page,
}) => {
  await withLive(
    page,
    [],
    async () => {
      await start(page, correction);
      const panel = page.locator(".answer-panel");
      await expect(panel).toContainText("Antwort ausstehend");
      await expect(
        panel.getByLabel("V-1041 · Termindauer in Minuten"),
      ).toHaveValue("");
      await expect(panel).not.toContainText("Aus dem Auftrag");
    },
    { nextAnswer: script(["case:V-1041", "ask:duration", "done"]) },
  );
});
