import { test, expect, type Page } from "@playwright/test";
import { once } from "node:events";
import { z } from "zod";
import { createApp } from "../server/app.js";
import { WorkspaceStore } from "../server/workspace-store.js";
function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function withLive(
  page: Page,
  sequence: string[],
  run: (
    store: WorkspaceStore,
    held: ReturnType<typeof barrier>,
    arrived: Promise<void>,
    snapshots: string[][],
    observations: unknown[],
  ) => Promise<void>,
  options: {
    hold?: string;
    low?: string;
    assessment?: string;
    forbidCommit?: boolean;
    outstanding?: boolean;
    receiptComplete?: boolean;
  } = {},
) {
  const held = barrier(),
    arrived = barrier();
  let heldOnce = false;
  const snapshots: string[][] = [];
  const observations: unknown[] = [];
  const store = new WorkspaceStore(":memory:");
  const app = createApp(
    { mode: "live", apiKey: "test", model: "jev-latest" },
    async (_url, init) => {
      const payload = z
        .object({
          state: z.string(),
          questions: z.record(
            z.string(),
            z.object({ criteria: z.record(z.string(), z.string()) }),
          ),
        })
        .parse(JSON.parse(String(init?.body)));
      const input = z
        .object({ observedSteps: z.array(z.unknown()) })
        .parse(JSON.parse(payload.state));
      const key = payload.questions["next"] ? "next" : "assessment";
      const facts = z
        .object({
          currentFacts: z.object({ receipts: z.array(z.unknown()).optional() }),
        })
        .parse(JSON.parse(payload.state));
      const next =
        options.receiptComplete && facts.currentFacts.receipts?.length
          ? "done"
          : (sequence[input.observedSteps.length] ?? "done");
      const selected = z
        .object({ selected: z.unknown().optional() })
        .parse(JSON.parse(payload.state)).selected;
      const commit = z
        .object({ kind: z.literal("commit") })
        .safeParse(selected).success;
      const choice =
        key === "next"
          ? next
          : next === "done"
            ? options.outstanding
              ? "outstanding"
              : "complete"
            : options.forbidCommit && commit
              ? "forbidden"
              : (options.assessment ?? "authorized");
      if (key === "next") {
        observations.push(JSON.parse(payload.state));
        snapshots.push(Object.keys(payload.questions["next"]?.criteria ?? {}));
        if (next === options.hold && !heldOnce) {
          heldOnce = true;
          arrived.release();
          await held.promise;
        }
      }
      return Response.json({
        model: "scripted-test-fixture",
        answers: {
          [key]: {
            type: "choice",
            choice,
            confidence: next === options.low && key === "next" ? 0.4 : 1,
            probabilities: { [choice]: 1 },
          },
        },
      });
    },
    store,
  );
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await run(store, held, arrived.promise, snapshots, observations);
  } finally {
    held.release();
    await app.close();
  }
}
async function start(
  page: Page,
  request = "Weise V-1042 Lea Sommer zu und speichere.",
) {
  await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
  await page.getByRole("textbox", { name: "Auftrag an Jev" }).fill(request);
  await page.getByRole("button", { name: "Ausführen" }).click();
}
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
                actionIds: ["close", "menu:technician"],
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
    await expect(page.locator(".blocked-control")).toContainText(
      "Schaltfläche „Als erledigt markieren“",
    );
    await expect(page.locator(".blocked-control")).toContainText("Arbeitszeit");
    await expect(page.locator(".blocked-control")).toHaveJSProperty(
      "open",
      false,
    );
    await expect(
      page.locator(".blocked-control li").filter({ hasText: "Arbeitszeit" }),
    ).toBeHidden();
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
        "nicht vollständig",
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
    async (store) => {
      const before = store.snapshot();
      await page.locator('[data-action="case:V-1039"]').click();
      await page.locator('[data-action="menu:customer"]').click();
      await page.locator('[data-action="customer:nord"]').click();
      await start(page, "zeige mir alle vorgänge von nordwerk");
      await expect(page.locator(".answer-panel")).toBeVisible();
      await expect(page.locator(".answer-panel")).toContainText(
        "Auftrag nicht vollständig bestätigt",
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
    },
    { low: "done" },
  );
});

test("missing evidence stays a concrete handoff tied to the disabled completion control", async ({
  page,
}) => {
  await withLive(page, ["case:V-1039", "blocked"], async (store) => {
    await page.addStyleTag({ content: slowPaletteClose });
    await start(page, "Schließe V-1039 ab.");
    await expect(page.locator(".blocked-control")).toContainText(
      "Schaltfläche „Als erledigt markieren“",
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
    await page
      .getByRole("button", { name: "Prüfbeleg erfassen", exact: true })
      .click();
    await expect(page.getByLabel("Tatsächlicher Prüfbeleg")).toBeFocused();
    await expect(page.locator(".editor")).toContainText("V-1039");
    expect(store.snapshot().revision).toBe(0);
  });
});
