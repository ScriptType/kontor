import { test, expect, type Page } from "@playwright/test";
import { z } from "zod";
import { barrier, start, withLive } from "./live-fixture.js";

const preferenceKey = "kontor-jev-confidence-v1";
const assignment = ["case:V-1042", "menu:technician", "technician:lea", "save"];
const confidence = (page: Page) =>
  page.getByLabel("Bestätigungsschwelle in Prozent");
const feedback = (page: Page) => page.locator("#jev-confidence-feedback");
async function openSettings(page: Page) {
  const settings = page.locator(".jev-settings");
  if ((await settings.getAttribute("open")) === null)
    await settings.locator("summary").click();
}
async function chooseConfidence(page: Page, percent: number) {
  await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
  await openSettings(page);
  await confidence(page).fill(String(percent));
  await expect(feedback(page)).toContainText(`Aktiver Wert: ${percent} %`);
  await page.getByRole("button", { name: "Befehlspalette schließen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("raw confidence input rejects invalid values and Enter cannot submit a command", async ({
  page,
}) => {
  await withLive(page, [], async (_store, _held, _arrived, snapshots) => {
    await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
    await expect(page.locator(".jev-settings > summary")).toHaveText(
      "Jev-Einstellungen · 75 %",
    );
    await expect(confidence(page)).not.toBeVisible();
    await page.screenshot({
      path: "live-results/confidence/settings-collapsed.png",
    });
    await openSettings(page);
    await expect(confidence(page)).toHaveValue("75");
    await page.screenshot({
      path: "live-results/confidence/settings-desktop.png",
    });
    await expect(page.locator("#jev-confidence-help")).toContainText(
      "Unter 75 %",
    );
    await expect(page.locator("#jev-confidence-help")).toContainText(
      "Ab diesem Wert",
    );
    await page
      .getByRole("textbox", { name: "Auftrag an Jev" })
      .fill("Zeige Kunden");
    for (const raw of [
      "",
      " ",
      "74.5",
      "75.00000000000000001",
      "1e-324",
      "NaN",
      "Infinity",
      "-1",
      "101",
    ]) {
      await confidence(page).fill(raw);
      await expect(confidence(page)).toHaveAttribute("aria-invalid", "true");
      await expect(feedback(page)).toContainText("ganze Zahl von 0 bis 100");
      await expect(feedback(page)).toContainText("Aktiver Wert: 75 %");
      await confidence(page).press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
    }
    await page.getByRole("button", { name: "Standard 75 %" }).click();
    await expect(confidence(page)).toHaveValue("75");
    await expect(feedback(page)).not.toContainText("ganze Zahl");
    await confidence(page).fill("29");
    await confidence(page).press("Enter");
    await expect(feedback(page)).toContainText("Aktiver Wert: 29 %");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".activity-label")).toHaveText(
      "Bereit für deinen Auftrag",
    );
    expect(snapshots).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await confidence(page).scrollIntoViewIfNeeded();
    expect(
      await page
        .locator(".palette")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: "live-results/confidence/settings-mobile.png",
    });
  });
});

test("browser preference survives reload and workspace reset, with an explicit default reset", async ({
  page,
}) => {
  await withLive(page, [], async (store) => {
    await chooseConfidence(page, 83);
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
        preferenceKey,
      ),
    ).toEqual({ version: 1, percent: 83 });
    await page.reload();
    await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
    await openSettings(page);
    await expect(confidence(page)).toHaveValue("83");
    await page
      .getByRole("button", { name: "Befehlspalette schließen" })
      .click();
    await page
      .getByRole("button", { name: "Demodaten zurücksetzen", exact: true })
      .click();
    await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
    await expect(
      page.locator("kontor-reset-workspace [role=status]"),
    ).toContainText("Demodaten zurückgesetzt.");
    expect(store.snapshot().revision).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
    await openSettings(page);
    await expect(confidence(page)).toHaveValue("83");
    await page.getByRole("button", { name: "Standard 75 %" }).click();
    await expect(confidence(page)).toHaveValue("75");
    await page.reload();
    await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
    await openSettings(page);
    await expect(confidence(page)).toHaveValue("75");
  });
});

for (const stored of [
  "not json",
  '{"version":2,"percent":29}',
  '{"version":1,"percent":"29"}',
  '{"version":1,"percent":29.5}',
  '{"version":1,"percent":101}',
]) {
  test(`invalid preference ${stored} falls back to 75 percent`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: preferenceKey, value: stored },
    );
    await withLive(page, [], async () => {
      await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
      await openSettings(page);
      await expect(confidence(page)).toHaveValue("75");
      await expect(feedback(page)).toContainText("Aktiver Wert: 75 %");
    });
  });
}

test("failed preference persistence keeps the session value effective and explains its lifetime", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key)
        throw new DOMException("Storage blocked", "QuotaExceededError");
      setItem.call(this, name, value);
    };
  }, preferenceKey);
  await withLive(
    page,
    ["nav:customers"],
    async (store) => {
      await chooseConfidence(page, 29);
      await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
      await openSettings(page);
      await expect(feedback(page)).toContainText("nur für diese Sitzung");
      await page
        .getByRole("button", { name: "Befehlspalette schließen" })
        .click();
      await start(page, "Zeige Kunden");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      await expect(
        page.getByRole("heading", { name: "Kunden & Standorte" }),
      ).toBeVisible();
      expect(
        await page.evaluate((key) => localStorage.getItem(key), preferenceKey),
      ).toBeNull();
      expect(store.snapshot().revision).toBe(0);
      await page.reload();
      await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
      await openSettings(page);
      await expect(confidence(page)).toHaveValue("75");
    },
    { low: "nav:customers", lowConfidence: 0.29 },
  );
});

for (const scenario of [
  { percent: 75, score: 0.749999999999, approval: true },
  { percent: 29, score: 0.289999999999, approval: true },
  { percent: 29, score: 0.29, approval: false },
  { percent: 0, score: 0, approval: false },
  { percent: 100, score: 0.999999999999, approval: true },
  { percent: 100, score: 1, approval: false },
]) {
  test(`action confidence ${scenario.score} at ${scenario.percent} percent ${scenario.approval ? "requires approval" : "executes"}`, async ({
    page,
  }) => {
    await withLive(
      page,
      ["nav:customers"],
      async (store) => {
        await chooseConfidence(page, scenario.percent);
        await start(page, "Zeige Kunden");
        if (scenario.approval) {
          await expect(
            page.locator(".ranked-choices button").first(),
          ).toBeVisible();
          await expect(
            page.getByRole("heading", { name: "Kunden & Standorte" }),
          ).not.toBeVisible();
        } else {
          await expect(page.locator(".activity-label")).toContainText(
            "Jev meldet",
          );
          await expect(
            page.getByRole("heading", { name: "Kunden & Standorte" }),
          ).toBeVisible();
        }
        expect(store.snapshot().revision).toBe(0);
      },
      { low: "nav:customers", lowConfidence: scenario.score },
    );
  });
}

for (const scenario of [
  { percent: 29, score: 0.289999999999, approval: true },
  { percent: 29, score: 0.29, approval: false },
  { percent: 0, score: 0, approval: false },
  { percent: 100, score: 0.999999999999, approval: true },
  { percent: 100, score: 1, approval: false },
]) {
  test(`authorized scope confidence ${scenario.score} at ${scenario.percent} percent ${scenario.approval ? "requires approval" : "saves"}`, async ({
    page,
  }) => {
    await withLive(
      page,
      assignment,
      async (store) => {
        await chooseConfidence(page, scenario.percent);
        await start(page);
        if (scenario.approval) {
          await expect(page.locator(".answer-panel")).toContainText(
            "Zuständigkeit von Jonas Weber auf Lea Sommer",
          );
          await expect(
            page.locator(".ranked-choices button").first(),
          ).toBeVisible();
          expect(store.snapshot().revision).toBe(0);
          expect(store.snapshot().cases[0]?.technicianId).toBe("jonas");
        } else {
          await expect(page.locator(".activity-label")).toContainText(
            "Jev meldet",
          );
          expect(store.snapshot().revision).toBe(1);
          expect(store.snapshot().cases[0]?.technicianId).toBe("lea");
        }
      },
      { assessmentConfidence: scenario.score },
    );
  });
}

for (const verdict of ["additional", "unclear", "forbidden"]) {
  test(`${verdict} scope cannot auto-execute at zero percent`, async ({
    page,
  }) => {
    await withLive(
      page,
      assignment,
      async (store) => {
        await chooseConfidence(page, 0);
        await start(page);
        if (verdict === "forbidden") {
          await expect(page.locator(".activity-label")).toContainText(
            "widerspricht dem Auftrag",
          );
          await expect(
            page.locator(".ranked-choices button").first(),
          ).toBeDisabled();
        } else
          await expect(
            page.locator(".ranked-choices button").first(),
          ).toBeVisible();
        expect(store.snapshot().revision).toBe(0);
        expect(store.snapshot().cases[0]?.technicianId).toBe("jonas");
      },
      { assessment: verdict },
    );
  });
}

test("zero percent still asks for a missing value", async ({ page }) => {
  await withLive(page, ["case:V-1042", "ask:minutes"], async (store) => {
    await chooseConfidence(page, 0);
    await start(page, "Erfasse Minuten für V-1042.");
    await expect(page.locator(".answer-panel")).toContainText(
      "Antwort ausstehend",
    );
    await expect(page.locator(".answer-panel input")).toBeVisible();
    expect(store.snapshot().revision).toBe(0);
  });
});

for (const scenario of [
  { percent: 29, decision: 0.289999999999, assessment: 1, complete: false },
  { percent: 29, decision: 1, assessment: 0.289999999999, complete: false },
  { percent: 29, decision: 0.29, assessment: 0.29, complete: true },
  { percent: 0, decision: 0, assessment: 0, complete: true },
  { percent: 100, decision: 0.999999999999, assessment: 1, complete: false },
  { percent: 100, decision: 1, assessment: 0.999999999999, complete: false },
  { percent: 100, decision: 1, assessment: 1, complete: true },
]) {
  test(`completion scores ${scenario.decision} and ${scenario.assessment} at ${scenario.percent} percent ${scenario.complete ? "complete" : "remain unconfirmed"}`, async ({
    page,
  }) => {
    await withLive(
      page,
      [],
      async (store) => {
        await chooseConfidence(page, scenario.percent);
        await start(page, "Prüfe die sichtbare Liste.");
        await expect(page.locator(".activity-label")).toContainText(
          scenario.complete
            ? "Jev meldet"
            : "vollständige Erfüllung noch nicht bestätigen",
        );
        expect(store.snapshot().revision).toBe(0);
      },
      {
        low: "done",
        lowConfidence: scenario.decision,
        assessmentConfidence: scenario.assessment,
      },
    );
  });
}

for (const verdict of ["outstanding", "unclear"] as const) {
  test(`${verdict} completion remains unconfirmed at zero percent`, async ({
    page,
  }) => {
    await withLive(
      page,
      [],
      async () => {
        await chooseConfidence(page, 0);
        await start(page, "Prüfe die sichtbare Liste.");
        await expect(page.locator(".activity-label")).toContainText(
          "vollständige Erfüllung noch nicht bestätigen",
        );
      },
      { completionVerdict: verdict },
    );
  });
}

for (const scenario of [
  { percent: 0, score: 0.749999999999, guidance: false },
  { percent: 100, score: 0.75, guidance: true },
]) {
  test(`cause confidence ${scenario.score} stays fixed at 75 percent with user threshold ${scenario.percent}`, async ({
    page,
  }) => {
    await withLive(
      page,
      ["case:V-1039", "blocked"],
      async (store) => {
        const before = store.snapshot();
        await chooseConfidence(page, scenario.percent);
        await start(page, "Schließe V-1039 ab.");
        await expect(page.locator(".answer-panel")).toContainText(
          "fehlt ein ausführbarer Schritt",
        );
        await expect(
          page.getByRole("button", { name: "Prüfbeleg erfassen", exact: true }),
        ).toHaveCount(scenario.guidance ? 1 : 0);
        await expect(page.locator('[data-action="complete"]')).toBeDisabled();
        await expect(page.getByLabel("Tatsächlicher Prüfbeleg")).toHaveValue(
          "",
        );
        expect(store.snapshot()).toEqual(before);
      },
      { cause: "blocked:complete", causeConfidence: scenario.score },
    );
  });
}

for (const heldQuestion of ["decision", "assessment", "completion"]) {
  test(`changing confidence invalidates a held ${heldQuestion} until explicit resume`, async ({
    page,
  }) => {
    await withLive(
      page,
      assignment,
      async (store, held, arrived, snapshots) => {
        await start(page);
        await arrived;
        const revision = store.snapshot().revision;
        const count = snapshots.length;
        await page
          .getByRole("button", { name: "Verlauf", exact: true })
          .click();
        await openSettings(page);
        await confidence(page).fill("29");
        await expect(page.locator(".answer-panel")).toContainText(
          "manuellem Eingriff",
        );
        held.release();
        await page
          .getByRole("button", { name: "Befehlspalette schließen" })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.locator(".activity-label")).toContainText(
          "ausdrücklich fortsetzen",
        );
        expect(snapshots).toHaveLength(count);
        expect(store.snapshot().revision).toBe(revision);
        await page
          .getByRole("button", { name: "Fortsetzen", exact: true })
          .click();
        await expect(page.locator(".activity-label")).toContainText(
          "Jev meldet",
        );
        expect(snapshots.length).toBeGreaterThan(count);
        expect(store.snapshot().revision).toBe(1);
      },
      heldQuestion === "decision"
        ? { hold: "save" }
        : { holdAssessment: heldQuestion === "assessment" ? "save" : "done" },
    );
  });
}

test("changing confidence revokes a displayed approval and requires a fresh decision", async ({
  page,
}) => {
  await withLive(
    page,
    ["nav:customers"],
    async (_store, _held, _arrived, snapshots) => {
      await start(page, "Zeige Kunden");
      await expect(
        page.locator(".ranked-choices button").first(),
      ).toBeVisible();
      await openSettings(page);
      await confidence(page).fill("100");
      await expect(page.locator(".ranked-choices button").first()).toHaveCount(
        0,
      );
      await page
        .getByRole("button", { name: "Befehlspalette schließen" })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".activity-label")).toContainText(
        "ausdrücklich fortsetzen",
      );
      expect(snapshots).toHaveLength(1);
      await page
        .getByRole("button", { name: "Fortsetzen", exact: true })
        .click();
      await expect(
        page.locator(".ranked-choices button").first(),
      ).toBeVisible();
      expect(snapshots).toHaveLength(2);
      await expect(
        page.getByRole("heading", { name: "Kunden & Standorte" }),
      ).not.toBeVisible();
    },
    { low: "nav:customers", lowConfidence: 0.4 },
  );
});

test("changing confidence during palette close revokes an already queued approval", async ({
  page,
}) => {
  await withLive(
    page,
    ["nav:customers"],
    async (_store, _held, _arrived, snapshots) => {
      await page.addStyleTag({
        content:
          '@keyframes close-palette { from { opacity: 1; } to { opacity: 0.99; } } .cdk-overlay-pane[data-state="closed"] { animation: close-palette 250ms linear; }',
      });
      await start(page, "Zeige Kunden");
      await expect(
        page.locator(".ranked-choices button").first(),
      ).toBeFocused();
      await openSettings(page);
      await page
        .locator(".ranked-choices button")
        .first()
        .evaluate((button) => {
          if (!(button instanceof HTMLButtonElement))
            throw new Error("Missing approval");
          button.click();
          const input = document.querySelector("#jev-confidence");
          if (!(input instanceof HTMLInputElement))
            throw new Error("Missing preference");
          input.value = "100";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".activity-label")).toContainText(
        "ausdrücklich fortsetzen",
      );
      expect(snapshots).toHaveLength(1);
      await expect(
        page.getByRole("heading", { name: "Kunden & Standorte" }),
      ).not.toBeVisible();
      await page
        .getByRole("button", { name: "Fortsetzen", exact: true })
        .click();
      await expect(
        page.locator(".ranked-choices button").first(),
      ).toBeVisible();
      expect(snapshots).toHaveLength(2);
    },
    { low: "nav:customers", lowConfidence: 0.4 },
  );
});

test("confidence settings never enter Jev choices, facts or command history", async ({
  page,
}) => {
  await withLive(
    page,
    assignment,
    async (_store, _held, _arrived, snapshots, observations) => {
      await chooseConfidence(page, 29);
      await start(page);
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      for (const options of snapshots)
        expect(options.join(" ")).not.toMatch(
          /confidence|Einstellungen|Bestätigungsschwelle|Standard 75/,
        );
      for (const observation of observations) {
        expect(JSON.stringify(observation)).not.toMatch(
          /confidence|Einstellungen|Bestätigungsschwelle|Aktiver Wert|kontor-jev-confidence/,
        );
        const fields = z
          .object({ availableFields: z.array(z.object({ id: z.string() })) })
          .parse(observation).availableFields;
        expect(fields.map((field) => field.id)).not.toContain("jev-confidence");
      }
      const history = await page.evaluate(() =>
        localStorage.getItem("kontor-command-v1"),
      );
      expect(history).not.toMatch(
        /confidence|Einstellungen|Bestätigungsschwelle|Aktiver Wert/,
      );
    },
  );
});

test("zero percent cannot finish while a save receipt is unknown", async ({
  page,
}) => {
  const arrived = barrier();
  await page.routeWebSocket("**/rpc", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const text =
        typeof message === "string" ? message : message.toString("utf8");
      if (text.includes("operationId") && text.includes("saved"))
        arrived.release();
      else socket.send(message);
    });
  });
  await withLive(
    page,
    assignment,
    async (store, _held, _arrived, _snapshots, observations) => {
      await chooseConfidence(page, 0);
      await start(page);
      await arrived.promise;
      expect(store.snapshot().revision).toBe(1);
      await expect(page.locator(".activity-label")).not.toContainText(
        "Jev meldet",
      );
      await page.reload();
      await expect(page.locator(".activity-label")).toContainText(
        "Neuladen pausiert",
      );
      await page
        .getByRole("button", { name: "Fortsetzen", exact: true })
        .click();
      await expect(page.locator(".activity-label")).toContainText(
        "Speicherergebnis wird geprüft",
      );
      await expect(page.locator(".notice")).toContainText(
        "Speicherergebnis ist unbekannt",
      );
      expect(observations).toHaveLength(4);
      expect(store.snapshot().revision).toBe(1);
    },
  );
});

test("zero percent completion still requires a receipt for every operation", async ({
  page,
}) => {
  await withLive(page, ["nav:customers"], async (store) => {
    await chooseConfidence(page, 0);
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
    await expect(page.locator(".activity-label")).toContainText(
      "Neuladen pausiert",
    );
    await page.getByRole("button", { name: "Fortsetzen", exact: true }).click();
    await expect(page.locator(".activity-label")).toContainText(
      "vollständige Erfüllung noch nicht bestätigen",
    );
    expect(store.snapshot().revision).toBe(0);
  });
});

for (const stored of [
  null,
  '{"version":1,"gate":"g1"}',
  '{"version":1,"gate":"g2"}',
])
  test(`stored gate ${stored} decides whether a view choice at 72 percent acts`, async ({
    page,
  }) => {
    if (stored)
      await page.addInitScript(
        (value) => localStorage.setItem("kontor-jev-gate-v1", value),
        stored,
      );
    await withLive(
      page,
      [],
      async () => {
        await start(page, "Zeige Berichte.");
        if (stored?.includes('"g1"')) {
          await expect(page.locator(".activity-label")).toContainText(
            "Jev meldet",
          );
          await expect(page).toHaveURL(/#reports$/);
        } else {
          await expect(
            page.getByRole("region", { name: "Jev-Vorschläge prüfen" }),
          ).toContainText("Auswahlkonfidenz 72 %");
          await expect(page).not.toHaveURL(/#reports$/);
        }
      },
      {
        nextAnswer: (index) =>
          index === 0
            ? {
                choice: "nav:reports",
                confidence: 0.72,
                probabilities: { "nav:reports": 0.72, "nav:team": 0.28 },
              }
            : { choice: "done", confidence: 1 },
      },
    );
  });

for (const run of [
  {
    work: "view-only",
    request: "Zeige Berichte.",
    sequence: ["nav:reports"],
    complete: 0.62,
    finishes: { g1: true, threshold: false },
  },
  {
    work: "saved",
    request: "Weise V-1042 Lea Sommer zu und speichere.",
    sequence: ["case:V-1042", "menu:technician", "technician:lea", "save"],
    complete: 0.78,
    finishes: { g1: false, threshold: true },
  },
] as const)
  for (const gate of ["g1", "threshold"] as const)
    test(`${gate} completion of a ${run.work} run at P(complete) ${run.complete}`, async ({
      page,
    }) => {
      await page.addInitScript(
        (value) => localStorage.setItem("kontor-jev-gate-v1", value),
        JSON.stringify({ version: 1, gate }),
      );
      await withLive(
        page,
        [...run.sequence],
        async () => {
          await start(page, run.request);
          await expect(page.locator(".activity-label")).toContainText(
            run.finishes[gate]
              ? "Jev meldet"
              : "vollständige Erfüllung noch nicht bestätigen",
          );
        },
        { completeProbability: run.complete },
      );
    });
