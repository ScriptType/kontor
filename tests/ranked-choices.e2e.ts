import { test, expect, type Page } from "@playwright/test";
import { z } from "zod";
import { start, withLive } from "./live-fixture.js";

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

test("both forbidden alternatives stay disabled in the same captured answer", async ({
  page,
}) => {
  const assessments: string[] = [];
  await withLive(
    page,
    [],
    async (store) => {
      await start(page, "Zeige Berichte oder Team.");
      await choose(page, "Berichte öffnen").click();
      await expect(choose(page, "Berichte öffnen")).toBeDisabled();
      await choose(page, "Team öffnen").click();
      await expect(choose(page, "Team öffnen")).toBeDisabled();
      await expect(choose(page, "Berichte öffnen")).toBeDisabled();
      expect(assessments).toEqual(["nav:reports", "nav:team"]);
      expect(page.url()).not.toMatch(/#reports$|#team$/);
      expect(store.snapshot().revision).toBe(0);
    },
    {
      nextAnswer: () => alternative,
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

for (const fresh of ["nav:reports", "done"] as const) {
  test(`ranked completion with fresh ${fresh} cannot borrow another choice confidence`, async ({
    page,
  }) => {
    await withLive(
      page,
      [],
      async (store, _held, _arrived, snapshots) => {
        await start(page, "Zeige Berichte.");
        await choose(page, "Abschluss prüfen").click();
        await expect.poll(() => snapshots.length).toBe(2);
        await expect(review(page)).toBeVisible();
        await expect(page.locator(".activity-label")).not.toContainText(
          "Jev meldet",
        );
        expect(page.url()).not.toMatch(/#reports$/);
        expect(store.snapshot().revision).toBe(0);
      },
      {
        nextAnswer: (index) =>
          index === 0
            ? {
                choice: "abstain",
                confidence: 1,
                probabilities: { abstain: 0.6, done: 0.4 },
              }
            : {
                choice: fresh,
                confidence: fresh === "done" ? 0.2 : 1,
                probabilities: { [fresh]: 1 },
              },
      },
    );
  });
}

test("an uncertain blocked choice opens the review and a ranked navigation proceeds", async ({
  page,
}) => {
  await withLive(
    page,
    [],
    async (store) => {
      const before = store.snapshot();
      await page.locator('[data-action="nav:reports"]').click();
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
