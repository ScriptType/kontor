import { test, expect, type Page } from "@playwright/test";
import { z } from "zod";
import { start, storeGate, withLive } from "./live-fixture.js";

// Pinned tests rely on the threshold gate: its 75 percent bar sends these picks
// to review, it checks set buttons' effects and it offers done before any step.
const rows = (page: Page) =>
  page
    .getByRole("list", { name: "Jevs zwei wahrscheinlichste Optionen" })
    .locator("li");
const review = (page: Page) =>
  page.getByRole("region", { name: "Jev-Vorschläge prüfen" });
const choose = (page: Page, name: string) =>
  review(page).getByRole("button", { name, exact: true });
const alternative = {
  choice: "nav:customers",
  confidence: 0.4,
  probabilities: { "nav:team": 0.6, "nav:reports": 0.3, "nav:customers": 0.1 },
};
const stopped = {
  choice: "abstain",
  confidence: 0.9,
  probabilities: { abstain: 0.7, done: 0.3 },
};
const selectedId = (selected: unknown) =>
  z.object({ id: z.string() }).parse(selected).id;

test("native ranking keeps original confidence and the second option gets its own assessment", async ({
  page,
}) => {
  await storeGate(page, "threshold");
  const assessments: string[] = [];
  await withLive(
    page,
    [],
    async (store) => {
      const before = store.snapshot();
      await start(page, "Zeige Berichte oder Team.");
      await expect(rows(page)).toHaveCount(2);
      await expect(rows(page).nth(0)).toContainText("Team öffnen");
      await expect(rows(page).nth(0)).toContainText("60 %");
      await expect(rows(page).nth(1)).toContainText("Berichte öffnen");
      await expect(rows(page).nth(1)).toContainText("30 %");
      await expect(review(page)).toContainText("Auswahlkonfidenz 40 %");
      await expect(review(page)).toContainText("Kunden öffnen");
      await expect(choose(page, "Team öffnen")).toHaveAttribute(
        "data-review-option",
        "nav:team",
      );
      await expect(choose(page, "Berichte öffnen")).not.toHaveAttribute(
        "data-review-force",
      );
      await choose(page, "Berichte öffnen").click();
      await expect(page).toHaveURL(/#reports$/);
      await expect(review(page)).toContainText("Jev hält bei Unklarheit an");
      expect(assessments).toEqual(["nav:reports"]);
      expect(store.snapshot()).toEqual(before);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page
          .locator(".palette")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    },
    {
      nextAnswer: (index) => (index === 0 ? alternative : stopped),
      effectAnswer: (selected) => {
        assessments.push(selectedId(selected));
        return { choice: "authorized", confidence: 1 };
      },
    },
  );
});

for (const verdict of ["additional", "unclear"]) {
  test(`second option ${verdict} needs a separate concrete approval`, async ({
    page,
  }) => {
    await storeGate(page, "threshold");
    await withLive(
      page,
      [],
      async (store) => {
        await start(page, "Zeige Berichte oder Team.");
        await choose(page, "Berichte öffnen").click();
        await expect(
          page.getByRole("button", { name: "Diesen Schritt freigeben" }),
        ).toBeVisible();
        expect(page.url()).not.toMatch(/#reports$/);
        await expect(page.locator(".answer-panel")).toContainText(
          "Berichte öffnen",
        );
        await expect(
          page.getByRole("button", { name: "Diesen Schritt freigeben" }),
        ).toHaveAttribute("data-review-option", "nav:reports");
        await page
          .getByRole("button", { name: "Diesen Schritt freigeben" })
          .click();
        await expect(page).toHaveURL(/#reports$/);
        await expect(review(page)).toContainText("Jev hält bei Unklarheit an");
        expect(store.snapshot().revision).toBe(0);
      },
      {
        nextAnswer: (index) => (index === 0 ? alternative : stopped),
        effectAnswer: () => ({ choice: verdict, confidence: 1 }),
      },
    );
  });
}

test("selecting Jev's own additional choice keeps its verdict and needs a concrete approval", async ({
  page,
}) => {
  await storeGate(page, "threshold");
  const assessments: string[] = [];
  await withLive(
    page,
    ["case:V-1042", "menu:technician", "technician:lea"],
    async (store) => {
      await start(page);
      await choose(page, "Lea Sommer zuweisen").click();
      await expect(
        page.getByRole("button", { name: "Diesen Schritt freigeben" }),
      ).toBeVisible();
      await expect(page.locator(".answer-panel")).toContainText(
        "zusätzliche Änderung",
      );
      await expect(
        page.getByText("Ungespeicherter Entwurf", { exact: true }),
      ).toHaveCount(0);
      expect(assessments).toEqual(["technician:lea"]);
      await page
        .getByRole("button", { name: "Diesen Schritt freigeben" })
        .click();
      await expect(
        page.getByText("Ungespeicherter Entwurf", { exact: true }),
      ).toBeVisible();
      expect(assessments).toEqual(["technician:lea"]);
      expect(store.snapshot().revision).toBe(0);
    },
    {
      effectAnswer: (selected) => {
        assessments.push(selectedId(selected));
        return {
          choice: assessments.length === 1 ? "additional" : "authorized",
          confidence: 1,
        };
      },
    },
  );
});

test("a forbidden alternative warns first and runs on the user's click", async ({
  page,
}) => {
  await storeGate(page, "threshold");
  const assessments: string[] = [];
  await withLive(
    page,
    [],
    async (store, _held, _arrived, snapshots) => {
      await start(page, "Zeige Berichte oder Team.");
      await choose(page, "Berichte öffnen").click();
      const override = choose(page, "Trotzdem ausführen: Berichte öffnen");
      await expect(override).toBeEnabled();
      await expect(override).toHaveAttribute(
        "data-review-option",
        "nav:reports",
      );
      await expect(override).toHaveAttribute("data-review-force", "");
      await expect(review(page)).toContainText(
        "Jev hält diesen Schritt für einen Widerspruch zum Auftrag. Du kannst ihn trotzdem ausführen.",
      );
      expect(page.url()).not.toMatch(/#reports$/);
      await override.click();
      await expect(page).toHaveURL(/#reports$/);
      await expect(review(page)).toContainText("Jev hält bei Unklarheit an");
      expect(assessments).toEqual(["nav:reports"]);
      expect(snapshots).toHaveLength(2);
      const steps = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("kontor-command-v1") ?? "null")
            .history[0].steps,
      );
      expect(
        z
          .array(
            z.object({
              action: z.object({ id: z.string() }),
              authorizedBy: z.string(),
            }),
          )
          .parse(steps)
          .map((step) => [step.action.id, step.authorizedBy]),
      ).toEqual([["nav:reports", "user"]]);
      expect(store.snapshot().revision).toBe(0);
    },
    {
      nextAnswer: (index) => (index === 0 ? alternative : stopped),
      effectAnswer: (selected) => {
        assessments.push(selectedId(selected));
        return { choice: "forbidden", confidence: 1 };
      },
    },
  );
});

for (const interruption of [
  "stop",
  "manual",
  "threshold",
  "reload",
  "reset",
] as const) {
  test(`late alternative assessment is discarded after ${interruption}`, async ({
    page,
  }) => {
    await storeGate(page, "threshold");
    await withLive(
      page,
      ["nav:reports"],
      async (store, held, arrived) => {
        await start(page, "Zeige Berichte oder Team.");
        await choose(page, "Berichte öffnen").click();
        await arrived;
        if (interruption === "stop")
          await page.getByRole("button", { name: "Stop", exact: true }).click();
        if (interruption === "manual")
          await page.locator('[data-action="nav:team"]').click();
        if (interruption === "threshold") {
          await page
            .getByRole("button", { name: /Jev · Befehl eingeben/ })
            .click();
          await page.locator(".jev-settings summary").click();
          await page.getByLabel("Bestätigungsschwelle in Prozent").fill("100");
        }
        if (interruption === "reload") await page.reload();
        if (interruption === "reset") {
          await page
            .getByRole("button", {
              name: "Demodaten zurücksetzen",
              exact: true,
            })
            .click();
          await page
            .getByRole("button", { name: "Jetzt zurücksetzen", exact: true })
            .click();
          await expect.poll(() => store.snapshot().revision).toBe(1);
        }
        held.release();
        if (interruption === "threshold") await page.keyboard.press("Escape");
        await expect(page.locator('[data-action="nav:reports"]')).toBeVisible();
        await start(page, "Zeige Berichte oder Team.");
        await expect(review(page)).toBeVisible();
        expect(page.url()).not.toMatch(/#reports$/);
        expect(store.snapshot().revision).toBe(
          interruption === "reset" ? 1 : 0,
        );
      },
      {
        nextAnswer: () => alternative,
        effectAnswer: () => ({ choice: "authorized", confidence: 1 }),
        holdAssessment: "nav:reports",
      },
    );
  });
}

test("a hidden alternative during palette close cannot be executed", async ({
  page,
}) => {
  await storeGate(page, "threshold");
  await withLive(
    page,
    [],
    async (store) => {
      await page.addStyleTag({
        content:
          '@keyframes closing { from { opacity: 1; } to { opacity: .99; } } .cdk-overlay-pane[data-state="closed"] { animation: closing 250ms linear; }',
      });
      await start(page, "Zeige Berichte oder Team.");
      await choose(page, "Berichte öffnen").evaluate((button) => {
        (button as HTMLButtonElement).click();
        const target = document.querySelector<HTMLElement>(
          '[data-action="nav:reports"]',
        );
        if (!target) throw new Error("Missing reports control");
        target.hidden = true;
      });
      await expect(page.locator(".activity-label")).toContainText(
        "Schritte geändert",
      );
      expect(page.url()).not.toMatch(/#reports$/);
      expect(store.snapshot().revision).toBe(0);
    },
    { nextAnswer: () => alternative },
  );
});

const finishing = {
  abstain: {
    choice: "abstain",
    confidence: 1,
    probabilities: { abstain: 0.6, done: 0.4 },
  },
  completion: {
    choice: "done",
    confidence: 1,
    probabilities: { done: 0.6, abstain: 0.4 },
  },
} as const;
for (const [reason, answer] of Object.entries(finishing)) {
  test(`finishing from the ${reason} review ends the run without asking Jev again`, async ({
    page,
  }) => {
    await storeGate(page, "threshold");
    await withLive(
      page,
      [],
      async (store, _held, _arrived, snapshots, _observations, assessed) => {
        const before = store.snapshot();
        await start(page, "Zeige Berichte.");
        await expect(review(page)).toBeVisible();
        const calls = { decide: snapshots.length, assess: assessed.length };
        await choose(page, "Als erledigt abschließen").click();
        await expect(page.locator(".activity-label")).toHaveText(
          "Vom Nutzer als erledigt abgeschlossen",
        );
        await expect(review(page)).toHaveCount(0);
        await page
          .getByRole("button", { name: /Jev · Befehl eingeben/ })
          .click();
        await expect(page.locator(".history")).toContainText(
          "Vom Nutzer als erledigt abgeschlossen",
        );
        await expect(review(page)).toHaveCount(0);
        const run = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("kontor-command-v1") ?? "null")
              .history[0],
        );
        expect(
          z
            .object({ entries: z.array(z.string()), outcome: z.string() })
            .parse(run),
        ).toEqual({
          entries: ["Vom Nutzer als erledigt abgeschlossen"],
          outcome: "Vom Nutzer als erledigt abgeschlossen",
        });
        expect({ decide: snapshots.length, assess: assessed.length }).toEqual(
          calls,
        );
        expect(page.url()).not.toMatch(/#reports$/);
        expect(store.snapshot()).toEqual(before);
      },
      { nextAnswer: () => answer, completeProbability: 0.2 },
    );
  });
}

test("finishing by hand waits for a receipt of every save", async ({
  page,
}) => {
  await withLive(
    page,
    ["nav:customers"],
    async (store, _held, _arrived, snapshots, _observations, assessed) => {
      await start(page, "Zeige Kunden");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      await page.evaluate(() => {
        const history = JSON.parse(
          localStorage.getItem("kontor-command-v1") ?? "null",
        );
        history.history[0].operations.push("unconfirmed-operation");
        history.unfinished = true;
        localStorage.setItem("kontor-command-v1", JSON.stringify(history));
      });
      await page.reload();
      await page
        .getByRole("button", { name: "Fortsetzen", exact: true })
        .click();
      await expect(review(page)).toContainText(
        "vollständige Erfüllung noch nicht bestätigen",
      );
      const calls = { decide: snapshots.length, assess: assessed.length };
      await choose(page, "Als erledigt abschließen").click();
      await expect(page.locator(".activity-label")).toHaveText(
        "Ein Speicherergebnis ist noch nicht bestätigt. Abschluss erst nach der Prüfung möglich.",
      );
      await expect(review(page)).toHaveCount(0);
      expect({ decide: snapshots.length, assess: assessed.length }).toEqual(
        calls,
      );
      expect(store.snapshot().revision).toBe(0);
    },
  );
});

test("an uncertain blocked choice opens the review and a ranked navigation proceeds", async ({
  page,
}) => {
  await withLive(
    page,
    [],
    async (store) => {
      const before = store.snapshot();
      await start(page, "Zeige die offenen Vorgänge.");
      await expect(review(page)).toBeVisible();
      await expect(rows(page)).toHaveCount(2);
      await expect(rows(page).nth(0)).toContainText("Als blockiert anhalten");
      await expect(rows(page).nth(1)).toContainText("Vorgänge öffnen");
      await expect(review(page)).toContainText("Auswahlkonfidenz 54 %");
      await expect(
        page.getByText("Auftrag teilweise oder nicht erledigt"),
      ).toHaveCount(0);
      await expect(page.locator(".blocked-control")).toHaveCount(0);
      expect(store.snapshot()).toEqual(before);
      await choose(page, "Vorgänge öffnen").click();
      await expect(page).toHaveURL(/#cases$/);
      await expect(review(page)).toContainText("Jev hält bei Unklarheit an");
      expect(store.snapshot()).toEqual(before);
    },
    {
      nextAnswer: (index) =>
        index === 0
          ? { choice: "nav:reports", confidence: 1 }
          : index === 1
            ? {
                choice: "blocked",
                confidence: 0.54,
                probabilities: { blocked: 0.54, "nav:cases": 0.3 },
              }
            : stopped,
      effectAnswer: () => ({ choice: "authorized", confidence: 1 }),
    },
  );
});

test("abstention keeps a real earlier receipt visible and invents no cause", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1042", "field:minutes:37", "save", "abstain"],
    async (store) => {
      await start(
        page,
        "Erfasse für V-1042 37 Minuten, speichere und prüfe den Rest.",
      );
      await expect(review(page)).toContainText("Jev hält bei Unklarheit an");
      await expect(
        page.getByRole("region", {
          name: "Bestätigte Speicherungen dieses Auftrags",
        }),
      ).toContainText("V-1042 · Revision 1");
      await expect(page.locator(".blocked-control")).toHaveCount(0);
      expect(
        store.snapshot().cases.find((item) => item.id === "V-1042")?.minutes,
      ).toBe(37);
      await choose(page, "Stoppen").click();
      expect(store.snapshot().revision).toBe(1);
    },
  );
});
