import { test, expect } from "@playwright/test";
import { z } from "zod";
import { barrier, start, withLive } from "./live-fixture.js";
const assignment = ["case:V-1042", "menu:technician", "technician:lea", "save"];
const slowPaletteClose = `
  @keyframes close-palette { from { opacity: 1; } to { opacity: 0.99; } }
  .cdk-overlay-pane[data-state="closed"] { animation: close-palette 250ms linear; }
`;
test("provider receives mounted regions, ordered controls and detail state without expanding choices", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await withLive(
    page,
    ["case:V-1042", "nav:reports"],
    async (store, _held, _arrived, snapshots, observations) => {
      const before = store.snapshot();
      await start(page, "Öffne Details von 1042 und danach Berichte.");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(observations[0]).toMatchObject({
        currentFacts: {
          screen: {
            currentDetail: null,
            truncated: false,
            regions: [
              expect.objectContaining({
                id: "navigation",
                role: "navigation",
                order: 0,
              }),
              expect.objectContaining({
                id: "cases",
                parentId: null,
                order: 1,
              }),
              expect.objectContaining({
                id: "case-filters",
                parentId: "cases",
                role: "group",
                fieldIds: ["search"],
                order: 2,
              }),
              expect.objectContaining({
                id: "case-list",
                parentId: "cases",
                role: "table",
                label: "Vorgangsliste",
                order: 3,
                actionIds: [
                  "case:V-1042",
                  "case:V-1041",
                  "case:V-1039",
                  "case:V-1037",
                  "case:V-1035",
                ],
              }),
            ],
          },
        },
      });
      expect(observations[1]).toMatchObject({
        currentFacts: {
          selected: { id: "V-1042" },
          draft: { minutes: before.cases[0]?.minutes },
          screen: {
            currentDetail: { kind: "case", id: "V-1042", draft: "saved" },
            regions: expect.arrayContaining([
              expect.objectContaining({
                id: "case-detail:V-1042",
                kind: "detail",
                role: "region",
                parentId: "cases",
                label: "Details von V-1042 · Wartung Standort Nord",
                viewport: expect.objectContaining({
                  visibility: "partly-visible",
                  start: "middle",
                }),
                actionIds: ["close", "priority:Normal", "menu:technician"],
                fieldIds: ["minutes", "appointment"],
              }),
            ]),
          },
        },
      });
      const finalFacts = z
        .object({ currentFacts: z.record(z.string(), z.unknown()) })
        .parse(observations[2]).currentFacts;
      expect(finalFacts.screen).toMatchObject({
        currentDetail: null,
        regions: [
          expect.objectContaining({ id: "navigation" }),
          expect.objectContaining({ id: "reports" }),
          expect.objectContaining({ id: "customer-time", parentId: "reports" }),
        ],
      });
      for (const key of [
        "selected",
        "draft",
        "dirty",
        "blockers",
        "completionBlockers",
        "retainedDraft",
      ])
        expect(finalFacts).not.toHaveProperty(key);
      for (const observation of observations) {
        const state = z
          .object({
            currentFacts: z.record(z.string(), z.unknown()),
            availableActions: z.array(z.object({ id: z.string() })),
            availableFields: z.array(z.object({ id: z.string() })),
          })
          .parse(observation);
        expect(JSON.stringify(state.currentFacts).length).toBeLessThan(40000);
        expect(
          new TextEncoder().encode(JSON.stringify(observation)).byteLength,
        ).toBeLessThan(180000);
        expect(
          state.availableActions.some((action) =>
            action.id.startsWith("case-detail:"),
          ),
        ).toBe(false);
      }
      expect(snapshots[1]).not.toContain("case-detail:V-1042");
      expect(snapshots[2]).not.toContain("menu:technician");
      expect(store.snapshot()).toEqual(before);
    },
  );
});

test("table action descriptions use the filtered DOM row order without adding actions", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1039"],
    async (store, _held, _arrived, snapshots, observations) => {
      const before = store.snapshot();
      await page
        .getByRole("searchbox", { name: "Vorgänge durchsuchen" })
        .fill("Wartung");
      await expect(page.locator("tbody tr")).toHaveCount(2);
      await start(
        page,
        "Öffne die Details des letzten Vorgangs in der Tabelle.",
      );
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      const state = z
        .object({
          availableActions: z.array(
            z.object({ id: z.string(), label: z.string() }),
          ),
        })
        .parse(observations[0]);
      expect(
        state.availableActions.filter((action) =>
          action.id.startsWith("case:"),
        ),
      ).toEqual([
        {
          id: "case:V-1042",
          label:
            "Details von V-1042 öffnen · Vorgangsliste, Zeile 1 von 2, erste Zeile",
        },
        {
          id: "case:V-1039",
          label:
            "Details von V-1039 öffnen · Vorgangsliste, Zeile 2 von 2, letzte Zeile",
        },
      ]);
      expect(snapshots[0]?.filter((id) => id.startsWith("case:"))).toEqual([
        "case:V-1042",
        "case:V-1039",
      ]);
      await expect(page.locator(".editor .eyebrow")).toContainText("V-1039");
      await expect(page.locator(".editor h2")).toBeFocused();
      expect(store.snapshot()).toEqual(before);
    },
  );
});

test("scrolling while a choice is pending rejects the stale layout observation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await withLive(
    page,
    ["case:V-1042", "menu:technician"],
    async (store, held, arrived, _snapshots, observations) => {
      const before = store.snapshot();
      await start(page);
      await arrived;
      await expect(page.locator(".editor h2")).toBeFocused();
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      held.release();
      await expect(page.locator(".activity-label")).toContainText(
        "Daten haben sich während der Entscheidung geändert",
      );
      await expect(
        page.locator('[data-action="menu:technician"]'),
      ).toHaveAttribute("aria-expanded", "false");
      expect(observations).toHaveLength(2);
      expect(store.snapshot()).toEqual(before);
    },
    { hold: "menu:technician" },
  );
});

test("hidden and inert regions and controls stay absent from provider observations", async ({
  page,
}) => {
  await withLive(
    page,
    [],
    async (store, _held, _arrived, _snapshots, observations) => {
      const before = store.snapshot();
      await page.locator('[data-action="nav:customers"]').click();
      await page
        .locator('[data-region="customer:nord"]')
        .evaluate((element) => {
          element.setAttribute("inert", "");
        });
      await page
        .locator('[data-region="customer:hafen"]')
        .evaluate((element) => {
          element.setAttribute("hidden", "");
        });
      await start(page, "Zeige die aktuelle Kundenübersicht.");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      const serialized = JSON.stringify(observations[0]);
      for (const id of [
        "customer:nord",
        "customer:hafen",
        "customer-cases:nord",
        "customer-cases:hafen",
        "case:V-1042",
        "case:V-1041",
      ])
        expect(serialized).not.toContain(`"${id}"`);
      expect(store.snapshot()).toEqual(before);
    },
  );
});

test("held decision cannot execute after stop and menu children remain hidden", async ({
  page,
}) => {
  await withLive(
    page,
    assignment,
    async (store, held, arrived, snapshots) => {
      await start(page);
      await arrived;
      expect(snapshots.at(-1)).not.toContain("technician:lea");
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      held.release();
      await expect(page.locator(".activity-label")).toContainText("Gestoppt");
      await expect(
        page.locator('[data-action="menu:technician"]'),
      ).toHaveAttribute("aria-expanded", "false");
      expect(store.snapshot().revision).toBe(0);
    },
    { hold: "menu:technician" },
  );
});
test("palette pauses a pending choice then closes and uses a fresh snapshot", async ({
  page,
}) => {
  await withLive(
    page,
    assignment,
    async (store, held, arrived, snapshots) => {
      await start(page);
      await arrived;
      await page.addStyleTag({ content: slowPaletteClose });
      await page.getByRole("button", { name: "Verlauf", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Auftrag an Jev" }),
      ).toBeFocused();
      held.release();
      expect(store.snapshot().revision).toBe(0);
      await page.keyboard.press("Escape");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(store.snapshot().revision).toBe(1);
      expect(
        snapshots.filter((s) => s.includes("save")).length,
      ).toBeGreaterThanOrEqual(2);
    },
    { hold: "save" },
  );
});
test("stop during palette close cancels its queued resume", async ({
  page,
}) => {
  await withLive(
    page,
    assignment,
    async (store, held, arrived, snapshots) => {
      await start(page);
      await arrived;
      await page.addStyleTag({ content: slowPaletteClose });
      await page.getByRole("button", { name: "Verlauf", exact: true }).click();
      await page
        .locator(".answer-panel")
        .getByRole("button", { name: "Fortsetzen", exact: true })
        .evaluate((button) => {
          if (!(button instanceof HTMLButtonElement))
            throw new Error("Missing resume button");
          button.click();
          const stop = document.querySelector(".activity button.danger");
          if (!(stop instanceof HTMLButtonElement))
            throw new Error("Missing Stop button");
          stop.click();
        });
      held.release();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".activity-label")).toContainText("Gestoppt");
      expect(
        snapshots.filter((actions) => actions.includes("save")),
      ).toHaveLength(1);
      expect(store.snapshot().revision).toBe(0);
    },
    { hold: "save" },
  );
});

test("manual input invalidates held decision and reload retains paused history without execution", async ({
  page,
}) => {
  await withLive(
    page,
    assignment,
    async (store, held, arrived) => {
      await start(page);
      await arrived;
      await page.locator("#minutes").fill("17");
      held.release();
      await expect(page.locator(".activity-label")).toContainText(
        "manuellem Eingriff",
      );
      await expect(page.locator("#minutes")).toHaveValue("17");
      await page.reload();
      await expect(page.locator(".activity-label")).toContainText(
        "Neuladen pausiert",
      );
      expect(store.snapshot().revision).toBe(0);
    },
    { hold: "menu:technician" },
  );
});
test("low confidence exposes exact chosen action and requires confirmation", async ({
  page,
}) => {
  await withLive(
    page,
    ["nav:customers"],
    async (store) => {
      await start(page, "Zeige Kunden");
      await expect(page.locator(".answer-panel")).toContainText("Kunden");
      await expect(
        page.getByRole("heading", { name: "Kunden & Standorte" }),
      ).not.toBeVisible();
      await page
        .getByRole("button", { name: "Diesen Schritt freigeben" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Kunden & Standorte" }),
      ).toBeVisible();
      expect(store.snapshot().revision).toBe(0);
    },
    { low: "nav:customers" },
  );
});
test("additional mutation pauses with exact target and does not execute before approval", async ({
  page,
}) => {
  await withLive(
    page,
    assignment,
    async (store) => {
      await page.addStyleTag({ content: slowPaletteClose });
      await start(page);
      await expect(page.locator(".answer-panel")).toContainText(
        "V-1042: Zuständigkeit von Jonas Weber auf Lea Sommer",
      );
      expect(store.snapshot().revision).toBe(0);
      await page.getByRole("button", { name: "Ablehnen und stoppen" }).click();
      await expect(page.locator(".activity-label")).toContainText("Gestoppt");
      expect(store.snapshot().cases[0]?.technicianId).toBe("jonas");
    },
    { assessment: "additional" },
  );
});
test("forbidden no-save commit is rejected even if provider selects save", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1042", "field:minutes:25", "save"],
    async (store) => {
      await start(page, "25 Minuten für V-1042, nicht speichern");
      await expect(page.locator(".activity-label")).toContainText(
        "widerspricht",
      );
      expect(store.snapshot().revision).toBe(0);
      await page.keyboard.press("Escape");
      await expect(page.locator("#minutes")).toHaveValue("25");
    },
    { forbidCommit: true },
  );
});
test("visible report drilldown and actual search are selectable without a prescribed path", async ({
  page,
}) => {
  await withLive(
    page,
    ["nav:reports", "customer-cases:nord", "field:search:Wartung"],
    async (store, _held, _arrived, snapshots) => {
      await start(page, 'Berichte, dann Nordwerk-Vorgänge und suche "Wartung"');
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      await expect(page.getByRole("searchbox")).toHaveValue("Wartung");
      await expect(page.locator("tbody tr")).toHaveCount(2);
      expect(snapshots[0]).not.toContain("customer-cases:nord");
      expect(snapshots[1]).toContain("customer-cases:nord");
      expect(store.snapshot().revision).toBe(0);
    },
  );
});
test("multiple records and repeated assignments produce distinct saved receipts", async ({
  page,
}) => {
  const sequence = [
    ...assignment,
    "menu:technician",
    "technician:jonas",
    "save",
    "case:V-1039",
    "menu:technician",
    "technician:jonas",
    "save",
  ];
  await withLive(page, sequence, async (store) => {
    await start(
      page,
      "V-1042 Lea zuweisen und speichern, dann Jonas zuweisen und speichern; V-1039 Jonas zuweisen und speichern.",
    );
    await expect(page.locator(".activity-label")).toContainText("Jev meldet");
    expect(store.snapshot().revision).toBe(3);
    expect(
      store.snapshot().cases.find((c) => c.id === "V-1039")?.technicianId,
    ).toBe("jonas");
    const history = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}"),
    );
    expect(
      history.history[0].receipts.map(
        (r: { saved: { technicianId: string } }) => r.saved.technicianId,
      ),
    ).toEqual(["lea", "jonas", "jonas"]);
  });
});
test("unsupported trailing work remains partial after an authorized earlier save", async ({
  page,
}) => {
  await withLive(page, [...assignment, "blocked"], async (store) => {
    await start(
      page,
      "V-1042 Lea zuweisen und speichern, dann eine Mail senden.",
    );
    await expect(page.locator(".activity-label")).toHaveText(
      "Auftrag teilweise oder nicht erledigt. Für verbleibende Arbeit fehlt ein ausführbarer Schritt.",
    );
    await expect(page.locator(".blocked-control")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Prüfbeleg erfassen", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".confirmed-receipts li")).toHaveText(
      "V-1042 · Revision 1",
    );
    await expect(page.locator(".confirmed-receipts li")).toBeVisible();
    await expect(page.locator(".editor-footer [role=status]")).toHaveText(
      "V-1042 gespeichert",
    );
    expect(store.snapshot().revision).toBe(1);
    expect(store.snapshot().cases[0]?.technicianId).toBe("lea");
  });
});
test("repeated no-op actions stop within a bounded number of decisions", async ({
  page,
}) => {
  await withLive(
    page,
    Array.from({ length: 45 }, () => "nav:cases"),
    async (store) => {
      await start(page, "Zeige Vorgänge");
      await expect(page.locator(".activity-label")).toContainText(
        "Wiederholter Schritt",
      );
      expect(store.snapshot().revision).toBe(0);
    },
  );
});

test("independent outstanding verdict prevents an early done claim", async ({
  page,
}) => {
  await withLive(
    page,
    ["nav:customers"],
    async (store) => {
      await start(page, "Kunden öffnen und danach Team");
      await expect(page.locator(".activity-label")).toContainText(
        "vollständige Erfüllung noch nicht bestätigen",
      );
      expect(store.snapshot().revision).toBe(0);
    },
    { outstanding: true },
  );
});
test("reloading a concrete confirmation revokes approval authority", async ({
  page,
}) => {
  await withLive(
    page,
    assignment,
    async (store) => {
      await start(page);
      await expect(
        page.getByRole("button", { name: "Diesen Schritt freigeben" }),
      ).toBeVisible();
      await page.reload();
      await expect(page.locator(".activity-label")).toContainText(
        "Neuladen pausiert",
      );
      await page.getByRole("button", { name: "Verlauf", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Diesen Schritt freigeben" }),
      ).not.toBeVisible();
      expect(store.snapshot().revision).toBe(0);
    },
    { low: "technician:lea" },
  );
});
test("changed revision revokes a displayed concrete confirmation", async ({
  page,
}) => {
  await withLive(
    page,
    assignment,
    async (store) => {
      await start(page);
      await expect(
        page.getByRole("button", { name: "Diesen Schritt freigeben" }),
      ).toBeVisible();
      store.reset(store.snapshot().revision);
      await page
        .getByRole("button", { name: "Diesen Schritt freigeben" })
        .click();
      await expect(
        page.getByRole("button", { name: "Diesen Schritt freigeben" }),
      ).toBeVisible();
      expect(store.snapshot().revision).toBe(1);
      expect(store.snapshot().cases[0]?.technicianId).toBe("jonas");
    },
    { low: "technician:lea" },
  );
});

test("unknown save after reload reconciles once and never replays the mutation", async ({
  page,
}) => {
  let firstReceipt = true;
  const arrived = barrier();
  await page.routeWebSocket("**/rpc", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const text =
        typeof message === "string" ? message : message.toString("utf8");
      if (
        firstReceipt &&
        text.includes("operationId") &&
        text.includes("saved")
      ) {
        firstReceipt = false;
        arrived.release();
      } else socket.send(message);
    });
  });
  await withLive(
    page,
    assignment,
    async (store) => {
      await start(page);
      await arrived.promise;
      expect(store.snapshot().revision).toBe(1);
      await page.evaluate(() => {
        const history = JSON.parse(
          localStorage.getItem("kontor-command-v1") ?? "{}",
        );
        history.history[0].operations = [];
        localStorage.setItem("kontor-command-v1", JSON.stringify(history));
      });
      await page.reload();
      await expect(page.locator(".activity-label")).toContainText(
        "Neuladen pausiert",
      );
      await page
        .getByRole("button", { name: "Fortsetzen", exact: true })
        .click();
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(store.snapshot().revision).toBe(1);
      expect(
        await page.evaluate(() => localStorage.getItem("kontor-save-v1")),
      ).toBeNull();
      const history = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}"),
      );
      expect(history.history[0].receipts).toHaveLength(1);
      expect(history.history[0].operations).toHaveLength(1);
    },
    { receiptComplete: true },
  );
});

test("invalid manual input also invalidates an outstanding choice", async ({
  page,
}) => {
  await withLive(
    page,
    assignment,
    async (store, held, arrived) => {
      await start(page);
      await arrived;
      await page.locator("#minutes").fill("-1");
      held.release();
      await expect(page.locator(".activity-label")).toContainText(
        "manuellem Eingriff",
      );
      await expect(
        page.locator('[data-action="menu:technician"]'),
      ).toHaveAttribute("aria-expanded", "false");
      expect(store.snapshot().revision).toBe(0);
    },
    { hold: "menu:technician" },
  );
});

test("uncertain filter completion does not inherit the selected case's inspection handoff", async ({
  page,
}) => {
  await withLive(
    page,
    [],
    async (store, _held, _arrived, _snapshots, observations) => {
      const before = store.snapshot();
      await page.locator('[data-action="case:V-1039"]').click();
      await page.locator('[data-action="menu:customer"]').click();
      await page.locator('[data-action="customer:nord"]').click();
      await start(page, "zeige mir alle vorgänge von nordwerk");
      await expect(page.locator(".answer-panel")).toBeVisible();
      await expect(page.locator(".answer-panel")).toContainText(
        "vollständige Erfüllung noch nicht bestätigen",
      );
      await expect(page.locator("tbody tr")).toHaveCount(2);
      await expect(page.locator("tbody tr td:nth-child(3)")).toHaveText([
        "Nordwerk GmbH",
        "Nordwerk GmbH",
      ]);
      await expect(page.locator(".editor")).toContainText("V-1039");
      expect(store.snapshot()).toEqual(before);
      await expect(page.locator(".blocked-control")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Prüfbeleg erfassen", exact: true }),
      ).toHaveCount(0);
      expect(observations).toHaveLength(1);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
      await expect(page.locator(".answer-panel")).toContainText(
        "vollständige Erfüllung noch nicht bestätigen",
      );
      expect(observations).toHaveLength(1);
      expect(store.snapshot()).toEqual(before);
    },
    { low: "done" },
  );
});

test("a precise cause after uncertain blocked still requires a manual evidence handoff", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1039", "blocked"],
    async (store, _held, _arrived, snapshots, observations) => {
      const before = store.snapshot();
      await page.addStyleTag({ content: slowPaletteClose });
      await start(page, "Schließe V-1039 ab.");
      await expect(page.locator(".blocked-control")).toContainText(
        "Schaltfläche „Vorgang als erledigt markieren“",
      );
      await expect(page.locator(".blocked-control")).toContainText(
        "Prüfung vor Ort",
      );
      await expect(page.locator(".blocked-control")).toHaveJSProperty(
        "open",
        true,
      );
      await expect(
        page
          .locator(".blocked-control li")
          .filter({ hasText: "Prüfung vor Ort" }),
      ).toBeVisible();
      await expect(page.locator(".blocked-control")).toContainText("V-1039");
      await expect(page.locator("#evidence:focus")).toHaveCount(0);
      await expect(page.locator("#evidence")).toHaveValue("");
      await expect(page.locator('[data-action="complete"]')).toBeDisabled();
      expect(store.snapshot()).toEqual(before);
      await page
        .getByRole("button", { name: "Prüfbeleg erfassen", exact: true })
        .click();
      await expect(page.getByLabel("Tatsächlicher Prüfbeleg")).toBeFocused();
      await expect(page.locator(".editor")).toContainText("V-1039");
      await expect(page.getByLabel("Tatsächlicher Prüfbeleg")).toHaveValue("");
      expect(snapshots[1]).not.toContain("complete");
      expect(snapshots[1]).not.toContain("blocked:complete");
      expect(observations[1]).toMatchObject({
        blockedControls: [
          {
            action: { id: "complete", kind: "draft" },
            target: { kind: "case", id: "V-1039" },
            reasons: [{ kind: "evidence" }],
          },
        ],
        currentFacts: { blockedControls: [{ target: { id: "V-1039" } }] },
      });
      expect(observations[1]).not.toHaveProperty(
        "currentFacts.completionBlockers",
      );
      expect(store.snapshot()).toEqual(before);
    },
    {
      low: "blocked",
      lowConfidence: 0.52,
      cause: "blocked:complete",
      causeConfidence: 0.98,
    },
  );
});

for (const cause of ["unknown", "low", "wrong"]) {
  test(`${cause} cause never offers unrelated evidence guidance`, async ({
    page,
  }) => {
    await withLive(
      page,
      ["case:V-1039", "blocked"],
      async (store) => {
        const before = store.snapshot();
        await start(page, "Schließe V-1039 ab.");
        if (cause === "wrong") {
          await expect(page.locator(".activity-label")).not.toHaveText(
            /^(Bereit für deinen Auftrag|Jev wählt den nächsten sichtbaren Schritt|Schritt wird ausgeführt)$/,
          );
          await page
            .getByRole("button", { name: /Jev · Befehl eingeben/ })
            .click();
        }
        await expect(page.locator(".answer-panel")).toBeVisible();
        await expect(page.locator(".blocked-control")).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: "Prüfbeleg erfassen",
            exact: true,
          }),
        ).toHaveCount(0);
        expect(store.snapshot()).toEqual(before);
      },
      {
        cause:
          cause === "unknown"
            ? "unknown"
            : cause === "wrong"
              ? "blocked:other"
              : "blocked:complete",
        causeConfidence: cause === "low" ? 0.7 : 1,
      },
    );
  });
}
for (const hidden of ["hidden", "inert", "aria-hidden", "no-reasons"]) {
  test(`${hidden} disabled controls never become causal choices`, async ({
    page,
  }) => {
    await withLive(
      page,
      ["blocked"],
      async (store, _held, _arrived, snapshots, observations) => {
        const before = store.snapshot();
        await page
          .locator(
            `[data-action="case:${hidden === "no-reasons" ? "V-1035" : "V-1039"}"]`,
          )
          .click();
        if (hidden !== "no-reasons")
          await page
            .locator('[data-action="complete"]')
            .evaluate(
              (element, attribute) => element.setAttribute(attribute, "true"),
              hidden,
            );
        await start(page, "Schließe den offenen Vorgang ab.");
        await expect(page.locator(".answer-panel")).toBeVisible();
        expect(observations[0]).toMatchObject({
          blockedControls: [],
          currentFacts: { blockedControls: [] },
        });
        expect(snapshots[0]).not.toContain("complete");
        await expect(page.locator(".blocked-control")).toHaveCount(0);
        expect(store.snapshot()).toEqual(before);
      },
      { cause: "blocked:complete" },
    );
  });
}
test("a control hidden during causal attribution cannot supply stale guidance", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1039", "blocked"],
    async (store, held, arrived) => {
      const before = store.snapshot();
      await start(page, "Schließe V-1039 ab.");
      await arrived;
      await page
        .locator('[data-action="complete"]')
        .evaluate((element) => element.setAttribute("hidden", ""));
      held.release();
      await expect(page.locator(".answer-panel")).toContainText(
        "Daten haben sich während der Entscheidung geändert",
      );
      await expect(page.locator(".blocked-control")).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "Prüfbeleg erfassen",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(store.snapshot()).toEqual(before);
    },
    { cause: "blocked:complete", hold: "cause" },
  );
});
for (const changed of ["stop", "target", "hidden"]) {
  test(`${changed} during palette close cancels the captured evidence handoff`, async ({
    page,
  }) => {
    await withLive(
      page,
      ["case:V-1039", "blocked"],
      async (store) => {
        const before = store.snapshot();
        await page.addStyleTag({ content: slowPaletteClose });
        await start(page, "Schließe V-1039 ab.");
        const handoff = page.getByRole("button", {
          name: "Prüfbeleg erfassen",
          exact: true,
        });
        await expect(handoff).toBeVisible();
        await handoff.evaluate((button, change) => {
          if (!(button instanceof HTMLButtonElement))
            throw new Error("Missing handoff");
          button.click();
          if (change === "hidden")
            document
              .querySelector('[data-action="complete"]')
              ?.setAttribute("hidden", "");
          else {
            const control = document.querySelector(
              change === "stop"
                ? ".activity button.danger"
                : '[data-action="case:V-1042"]',
            );
            if (!(control instanceof HTMLButtonElement))
              throw new Error("Missing invalidation control");
            control.click();
          }
        }, changed);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.locator("#evidence:focus")).toHaveCount(0);
        if (changed === "target")
          await expect(page.locator(".editor")).toContainText("V-1042");
        if (changed === "stop")
          await expect(page.locator(".activity-label")).toContainText(
            "Gestoppt",
          );
        expect(store.snapshot()).toEqual(before);
      },
      { cause: "blocked:complete" },
    );
  });
}

test("Jev uses visible draft controls for priority, appointment removal and reopening with complete save effects", async ({
  page,
}) => {
  await withLive(
    page,
    [
      "case:V-1041",
      "priority:Hoch",
      "remove-appointment",
      "save",
      "case:V-1035",
      "reopen",
      "priority:Hoch",
      "save",
    ],
    async (store, _held, _arrived, snapshots, observations) => {
      const before = store.snapshot();
      await start(
        page,
        "Setze V-1041 auf Priorität Hoch, entferne den Termin und speichere. Öffne V-1035 wieder, setze Priorität Hoch und speichere.",
      );
      await expect(page.locator(".activity-label")).toContainText(
        "Jev meldet",
      );
      expect(store.snapshot().revision).toBe(2);
      expect(store.snapshot().cases.find((c) => c.id === "V-1041")).toEqual(
        {
          ...before.cases.find((c) => c.id === "V-1041"),
          priority: "Hoch",
          appointment: null,
        },
      );
      expect(store.snapshot().cases.find((c) => c.id === "V-1035")).toEqual(
        {
          ...before.cases.find((c) => c.id === "V-1035"),
          priority: "Hoch",
          status: "open",
        },
      );
      expect(snapshots[1]).toContain("priority:Hoch");
      expect(snapshots[1]).not.toContain("priority:Normal");
      expect(snapshots[1]).toContain("remove-appointment");
      expect(snapshots[2]).not.toContain("priority:Hoch");
      expect(snapshots[3]).not.toContain("remove-appointment");
      expect(snapshots[5]).toContain("reopen");
      expect(snapshots[5]).not.toContain("complete");
      expect(snapshots[6]).not.toContain("reopen");
      expect(snapshots[6]).toContain("complete");
      expect(observations[3]).toMatchObject({
        currentFacts: {
          revision: 0,
          selected: {
            priority: "Normal",
            appointment: before.cases[1]?.appointment,
          },
          draft: { priority: "Hoch", appointment: null },
        },
        availableActions: expect.arrayContaining([
          expect.objectContaining({
            id: "save",
            effect: expect.stringContaining(
              "Priorität von Normal auf Hoch",
            ),
          }),
          expect.objectContaining({
            id: "discard",
            effect: expect.stringContaining(
              "Priorität von Normal auf Hoch",
            ),
          }),
          expect.objectContaining({
            id: "save",
            effect: expect.stringContaining("auf kein Termin"),
          }),
        ]),
      });
      expect(observations[7]).toMatchObject({
        currentFacts: {
          revision: 1,
          selected: { status: "done", priority: "Normal" },
          draft: { status: "open", priority: "Hoch" },
        },
        availableActions: expect.arrayContaining([
          expect.objectContaining({
            id: "save",
            effect: expect.stringContaining(
              "Status von erledigt auf offen",
            ),
          }),
        ]),
      });
    },
  );
});

test("Jev sees complete combined filters and only mounted menu choices, then replaces filters through drilldowns", async ({
  page,
}) => {
  const sequence = [
    "menu:customer",
    "customer:nord",
    "menu:filter-technician",
    "filter-technician:lea",
    "filter:open",
    "filter:done",
    "filter:reset",
    "nav:team",
    "technician-cases:mara",
    "nav:reports",
    "status-cases:done",
    "nav:customers",
    "customer-cases:hafen",
  ];
  await withLive(
    page,
    sequence,
    async (store, _held, _arrived, snapshots, observations) => {
      const before = store.snapshot();
      await page.getByRole("searchbox").fill("Süd");
      await start(
        page,
        "Filtere Nordwerk, Lea und offene Vorgänge, dann erledigte. Setze Filter zurück. Zeige Maras offene Vorgänge, danach erledigte aus Berichte und dann alle von Hafen.",
      );
      await expect(page.locator(".activity-label")).toContainText(
        "Jev meldet",
      );
      expect(store.snapshot()).toEqual(before);
      expect(snapshots[0]).toContain("menu:customer");
      expect(snapshots[0]).toContain("menu:filter-technician");
      expect(snapshots[0]).not.toContain("customer:nord");
      expect(snapshots[0]).not.toContain("filter-technician:lea");
      expect(snapshots[0]).not.toContain("filter:all");
      expect(snapshots[1]).toContain("customer:nord");
      expect(snapshots[2]).not.toContain("customer:nord");
      expect(snapshots[3]).toContain("filter-technician:lea");
      expect(snapshots[3]).not.toContain("technician:lea");
      expect(snapshots[4]).not.toContain("filter-technician:lea");
      expect(snapshots[5]).not.toContain("filter:open");
      const filters = {
        customerId: "nord",
        technicianId: "lea",
        status: "open",
        search: "Süd",
      };
      expect(observations[5]).toMatchObject({
        currentFacts: {
          filters,
          visibleCases: [expect.objectContaining({ id: "V-1039" })],
        },
        observedSteps: expect.arrayContaining([
          expect.objectContaining({
            action: expect.objectContaining({ id: "filter:open" }),
            after: expect.objectContaining({ filters }),
          }),
        ]),
      });
      expect(observations[6]).toMatchObject({
        currentFacts: {
          filters: { ...filters, status: "done" },
          visibleCases: [],
        },
      });
      expect(observations[7]).toMatchObject({
        currentFacts: {
          filters: {
            customerId: null,
            technicianId: null,
            status: "all",
            search: "",
          },
        },
      });
      expect(observations[9]).toMatchObject({
        currentFacts: {
          filters: {
            customerId: null,
            technicianId: "mara",
            status: "open",
            search: "",
          },
          visibleCases: [expect.objectContaining({ id: "V-1037" })],
        },
      });
      expect(observations[11]).toMatchObject({
        currentFacts: {
          filters: {
            customerId: null,
            technicianId: null,
            status: "done",
            search: "",
          },
          visibleCases: [expect.objectContaining({ id: "V-1035" })],
        },
      });
      expect(observations[13]).toMatchObject({
        currentFacts: {
          filters: {
            customerId: "hafen",
            technicianId: null,
            status: "all",
            search: "",
          },
          visibleCases: [
            expect.objectContaining({ id: "V-1041" }),
            expect.objectContaining({ id: "V-1035" }),
          ],
        },
      });
    },
  );
});
