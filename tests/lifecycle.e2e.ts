import { test, expect, type Page } from "@playwright/test";
import { once } from "node:events";
import { z } from "zod";
import { createApp } from "../server/app.js";
import { WorkspaceStore } from "../server/workspace-store.js";
import type { Fetch } from "@typesafe-ai/sdk";
function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function withLive(
  page: Page,
  holdAction: string,
  run: (
    store: WorkspaceStore,
    held: ReturnType<typeof barrier>,
    arrived: Promise<void>,
    snapshots: string[][],
  ) => Promise<void>,
  persistence = "save",
  interpretation: Record<string, string> = {},
  confidence: Record<string, number> = {},
) {
  const held = barrier(),
    arrived = barrier();
  let heldOnce = false;
  const snapshots: string[][] = [];
  const fetch: Fetch = async (_url, init) => {
    const payload = z
      .object({
        state: z.string(),
        questions: z.record(
          z.string(),
          z.object({ criteria: z.record(z.string(), z.string()) }),
        ),
      })
      .parse(JSON.parse(String(init?.body)));
    let values: Record<string, string>;
    if (payload.questions["next"]) {
      snapshots.push(Object.keys(payload.questions["next"].criteria));
      const state = z
        .object({ context: z.string() })
        .parse(JSON.parse(payload.state));
      const context = z
        .object({ nextRequiredAction: z.string() })
        .parse(JSON.parse(state.context));
      if (context.nextRequiredAction === holdAction && !heldOnce) {
        heldOnce = true;
        arrived.release();
        await held.promise;
      }
      values = { next: context.nextRequiredAction };
    } else
      values = {
        remedy: "unclear",
        capability: "yes",
        coverage: "complete",
        cardinality: "yes",
        persistence,
        openOnly: "no",
        filter: "no",
        assign: "yes",
        schedule: "no",
        time: "no",
        complete: "no",
        case: "V-1042",
        technician: "lea",
        customer: "unclear",
        workMinutes: "unclear",
        appointmentMinutes: "unclear",
        slot: "unclear",
        order: "no",
        ...interpretation,
      };
    return Response.json({
      model: "injected-test-provider",
      answers: Object.fromEntries(
        Object.entries(values).map(([k, v]) => [
          k,
          {
            type: "choice",
            choice: v,
            confidence: confidence[k] ?? 1,
            probabilities: { [v]: 1 },
          },
        ]),
      ),
    });
  };
  const store = new WorkspaceStore();
  const app = createApp(
    { mode: "live", apiKey: "injected-only", model: "jev-latest" },
    fetch,
    store,
  );
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await run(store, held, arrived.promise, snapshots);
  } finally {
    held.release();
    await app.close();
  }
}
async function start(page: Page, request = "V-1042 Lea Sommer zuweisen") {
  await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
  await page.getByRole("textbox", { name: "Auftrag an Jev" }).fill(request);
  await page.getByRole("button", { name: "Ausführen" }).click();
}
test("Stop discards a held late provider decision without hidden menu actions", async ({
  page,
}) => {
  await withLive(
    page,
    "menu:technician",
    async (store, held, arrived, snapshots) => {
      await start(page);
      await arrived;
      expect(snapshots.at(-1)).not.toContain("technician:lea");
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      held.release();
      await expect(page.locator(".activity-label")).toContainText("Gestoppt");
      await page.getByRole("button", { name: "Verlauf", exact: true }).click();
      await expect(page.locator(".history ol")).not.toContainText(
        "Lea Sommer zuweisen",
      );
      expect(store.snapshot().revision).toBe(0);
      await page.keyboard.press("Escape");
      await expect(
        page.locator('[data-action="menu:technician"]'),
      ).toHaveAttribute("aria-expanded", "false");
    },
  );
});
test("opening palette while own draft awaits Save pauses, closes, decides fresh and saves once", async ({
  page,
}) => {
  await withLive(page, "save", async (store, held, arrived, snapshots) => {
    await start(page);
    await arrived;
    expect(store.snapshot().revision).toBe(0);
    await page.getByRole("button", { name: "Verlauf", exact: true }).click();
    await expect(
      page
        .getByText("Pausiert, solange ein Dialog offen ist", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    held.release();
    expect(store.snapshot().cases[0]?.technicianId).toBe("jonas");
    await page.keyboard.press("Escape");
    await expect(page.locator(".activity-label")).toHaveText(
      "Auftrag abgeschlossen",
    );
    expect(store.snapshot().revision).toBe(1);
    expect(store.snapshot().cases[0]?.technicianId).toBe("lea");
    expect(
      snapshots.filter((s) => s.includes("save")).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
test("manual editing invalidates late decision and retains the user draft; reload never executes", async ({
  page,
}) => {
  await withLive(page, "menu:technician", async (store, held, arrived) => {
    await start(page);
    await arrived;
    await page
      .getByRole("spinbutton", { name: "Geleistete Arbeitszeit in Minuten" })
      .fill("17");
    held.release();
    await expect(page.locator(".activity-label")).toContainText(
      "manuellem Eingriff",
    );
    expect(store.snapshot().revision).toBe(0);
    await expect(
      page.getByRole("spinbutton", {
        name: "Geleistete Arbeitszeit in Minuten",
      }),
    ).toHaveValue("17");
    await page.reload();
    await expect(page.locator(".activity-label")).toContainText(
      "Nach Neuladen pausiert",
    );
    expect(store.snapshot().revision).toBe(0);
  });
});
test("live draft authority never saves automatically", async ({ page }) => {
  await withLive(
    page,
    "never",
    async (store) => {
      await start(page);
      await expect(page.locator(".activity-label")).toHaveText(
        "Entwurf vorbereitet · nicht gespeichert",
      );
      expect(store.snapshot().revision).toBe(0);
      await expect(
        page.locator('[data-action="menu:technician"]'),
      ).toContainText("Lea Sommer");
    },
    "draft",
  );
});

test("explicit completion before time preserves ordered committed outcomes when existing time makes it feasible", async ({
  page,
}) => {
  await withLive(
    page,
    "never",
    async (store) => {
      await start(
        page,
        "Zuerst V-1041 abschließen, dann 60 Minuten erfassen und speichern",
      );
      await expect(page.locator(".activity-label")).toHaveText(
        "Auftrag abgeschlossen",
      );
      const history = z
        .object({
          history: z.array(
            z.object({
              entries: z.array(z.string()),
              operations: z.array(z.string()),
            }),
          ),
        })
        .parse(
          JSON.parse(
            await page.evaluate(
              () => localStorage.getItem("kontor-command-v1") ?? "null",
            ),
          ),
        ).history[0];
      expect(history?.entries).toEqual([
        "V-1041 öffnen",
        "Vorgang als erledigt markieren",
        "V-1041 gespeichert",
        "60 angeforderte Minuten eintragen",
        "V-1041 gespeichert",
      ]);
      const receipts = history?.operations.map((id) => store.receipt(id));
      expect(
        receipts?.map((receipt) => ({
          revision: receipt?.revision,
          status: receipt?.saved.status,
          minutes: receipt?.saved.minutes,
        })),
      ).toEqual([
        { revision: 1, status: "done", minutes: 45 },
        { revision: 2, status: "done", minutes: 60 },
      ]);
    },
    "save",
    {
      assign: "no",
      time: "yes",
      complete: "yes",
      case: "V-1041",
      technician: "unclear",
      workMinutes: "60",
      order: "yes",
    },
  );
});

for (const pageName of ["Kunden", "Team"]) {
  test(`${pageName} registers mounted case links and Jev opens its target through that shared action`, async ({
    page,
  }) => {
    await withLive(page, "never", async (store, _held, _arrived, snapshots) => {
      await page.getByRole("button", { name: pageName, exact: true }).click();
      await expect(
        page.locator('kontor-overview [data-action="case:V-1042"]'),
      ).toBeVisible();
      const mounted = await page
        .locator("kontor-overview [data-action]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-action")),
        );
      expect(mounted).toContain("case:V-1042");
      await start(page);
      await expect(page.locator(".activity-label")).toHaveText(
        "Auftrag abgeschlossen",
      );
      for (const id of mounted) expect(snapshots[0]).toContain(id);
      expect(snapshots[0]).not.toContain("menu:customer");
      expect(snapshots[0]).not.toContain("technician:lea");
      expect(snapshots[0]).not.toContain("customer-cases:nord");
      if (pageName === "Team")
        expect(snapshots[0]).not.toContain("case:V-1035");
      const history = z
        .object({
          history: z.array(z.object({ entries: z.array(z.string()) })),
        })
        .parse(
          JSON.parse(
            await page.evaluate(
              () => localStorage.getItem("kontor-command-v1") ?? "null",
            ),
          ),
        ).history[0];
      expect(history?.entries[0]).toBe("V-1042 öffnen");
      expect(store.snapshot().cases[0]?.technicianId).toBe("lea");
    });
  });
}

test("report drilldown is a registered action chosen directly for a matching filter goal", async ({
  page,
}) => {
  await withLive(
    page,
    "never",
    async (store, _held, _arrived, snapshots) => {
      await page.getByRole("button", { name: "Berichte", exact: true }).click();
      await expect(
        page.locator('[data-action="customer-cases:nord"]'),
      ).toBeVisible();
      await start(page, "Zeige offene Vorgänge von Nordwerk");
      await expect(page.locator(".activity-label")).toHaveText(
        "Auftrag abgeschlossen",
      );
      expect(snapshots[0]).toContain("customer-cases:nord");
      expect(snapshots[0]).not.toContain("case:V-1042");
      expect(snapshots[0]).not.toContain("menu:customer");
      const history = z
        .object({
          history: z.array(z.object({ entries: z.array(z.string()) })),
        })
        .parse(
          JSON.parse(
            await page.evaluate(
              () => localStorage.getItem("kontor-command-v1") ?? "null",
            ),
          ),
        ).history[0];
      expect(history?.entries).toEqual([
        "Vorgänge von Nordwerk GmbH anzeigen",
        "Nur offene Vorgänge anzeigen",
      ]);
      await expect(page.locator("tbody tr")).toHaveCount(2);
      expect(store.snapshot().revision).toBe(0);
    },
    "save",
    {
      assign: "no",
      filter: "yes",
      openOnly: "yes",
      customer: "nord",
      case: "unclear",
      technician: "unclear",
    },
  );
});

for (const target of [
  { caseId: "V-1042", customer: "hafen", reason: "Nordwerk" },
  { caseId: "V-1035", customer: "hafen", reason: "erledigt" },
]) {
  test(`requested filter excluding ${target.caseId} asks before writes and resumes only after scope answer`, async ({ page }) => {
    await withLive(
      page,
      "never",
      async (store, _held, _arrived, snapshots) => {
        const before = store.snapshot();
        await start(
          page,
          `Zeige offene Hafen-Vorgänge und weise ${target.caseId} Lea Sommer zu`,
        );
        await expect(page.locator(".activity-label")).toHaveText("Antwort ausstehend");
        expect(snapshots).toHaveLength(0);
        expect(store.snapshot()).toEqual(before);
        await expect(page.locator(".answer-panel")).toBeVisible();
        await expect(page.locator(".answer-panel")).toContainText(target.caseId);
        await expect(page.locator(".answer-panel")).toContainText(target.reason);
        await page.keyboard.press("Escape");
        await expect(page.locator(".activity-label")).toHaveText("Antwort ausstehend");
        expect(snapshots).toHaveLength(0);
        expect(store.snapshot()).toEqual(before);
        await page.getByRole("button", { name: "Antworten", exact: true }).click();
        await page.getByRole("button", {
          name: "Angeforderten Filter entfernen, Vorgang beibehalten",
          exact: true,
        }).click();
        await expect(page.locator(".activity-label")).toHaveText("Auftrag abgeschlossen");
        expect(store.snapshot()).toEqual({
          ...before,
          revision: before.revision + 1,
          cases: before.cases.map((c) =>
            c.id === target.caseId ? { ...c, technicianId: "lea" } : c,
          ),
        });
        expect(snapshots.length).toBeLessThan(10);
      },
      "save",
      {
        case: target.caseId,
        filter: "yes",
        openOnly: "yes",
        customer: target.customer,
      },
    );
  });
}

for (const persistence of ["save", "draft"]) {
  test(`recognized assignment has no effect before confirmation and exact ${persistence} afterward`, async ({
    page,
  }) => {
    await withLive(
      page,
      "never",
      async (store, _held, _arrived, snapshots) => {
        const before = store.snapshot();
        await page.getByRole("button", { name: "Kunden", exact: true }).click();
        await start(page);
        await expect(page.locator(".review-panel")).toBeVisible();
        await expect(page.locator(".review-panel li")).toHaveText([
          "V-1042 · Wartung Standort Nord · Nordwerk GmbH · Hamburg · Halle A",
          "Lea Sommer zuweisen.",
          persistence === "save"
            ? "Änderungen speichern."
            : "Nur als Entwurf vorbereiten. Nicht speichern.",
        ]);
        expect(snapshots).toEqual([]);
        expect(store.snapshot()).toEqual(before);
        await expect(page.locator(".editor")).toHaveCount(0);
        await page
          .getByRole("button", { name: "Diesen Auftrag ausführen" })
          .click();
        await expect(page.locator(".activity-label")).toHaveText(
          persistence === "save"
            ? "Auftrag abgeschlossen"
            : "Entwurf vorbereitet · nicht gespeichert",
        );
        expect(snapshots.length).toBeGreaterThan(0);
        expect(store.snapshot()).toEqual(
          persistence === "save"
            ? {
                ...before,
                revision: 1,
                cases: before.cases.map((c) =>
                  c.id === "V-1042" ? { ...c, technicianId: "lea" } : c,
                ),
              }
            : before,
        );
        await expect(
          page.locator('[data-action="menu:technician"]'),
        ).toContainText("Lea Sommer");
      },
      persistence,
      {},
      { capability: 0.3 },
    );
  });
}

test("missing value answer retains review and cannot navigate before confirmation", async ({
  page,
}) => {
  await withLive(
    page,
    "never",
    async (store, _held, _arrived, snapshots) => {
      const before = store.snapshot();
      await start(page);
      await expect(page.locator(".answer-panel")).toContainText(
        "Welcher Vorgang ist gemeint?",
      );
      expect(snapshots).toEqual([]);
      await page.getByRole("button", { name: /V-1042 · Wartung/ }).click();
      await expect(page.locator(".review-panel")).toBeVisible();
      expect(snapshots).toEqual([]);
      expect(store.snapshot()).toEqual(before);
      await page.getByRole("button", { name: "Auftrag stoppen" }).click();
      await expect(page.locator(".review-panel")).toHaveCount(0);
      expect(store.snapshot()).toEqual(before);
    },
    "save",
    { case: "unclear" },
    { coverage: 0.6 },
  );
});

test("review survives reload and replacement never reuses confirmation", async ({
  page,
}) => {
  await withLive(
    page,
    "never",
    async (store, _held, _arrived, snapshots) => {
      const before = store.snapshot();
      await start(page);
      await expect(page.locator(".review-panel")).toBeVisible();
      await page.reload();
      await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
      await page
        .locator(".answer-panel")
        .getByRole("button", { name: "Fortsetzen", exact: true })
        .click();
      await expect(page.locator(".review-panel")).toBeVisible();
      await page
        .getByRole("textbox", { name: "Auftrag an Jev" })
        .fill("V-1042 erneut Lea zuweisen");
      await page
        .getByRole("button", { name: "Ausführen", exact: false })
        .filter({ hasText: "Ausführen ↵" })
        .click();
      await expect(page.locator(".review-panel")).toContainText(
        "Originalauftrag: V-1042 erneut Lea zuweisen",
      );
      expect(snapshots).toEqual([]);
      expect(store.snapshot()).toEqual(before);
    },
    "save",
    {},
    { coverage: 0.6 },
  );
});

test("unfinished confirmed run requires another review after reload", async ({
  page,
}) => {
  await withLive(
    page,
    "case:V-1042",
    async (store, held, arrived) => {
      const before = store.snapshot();
      await start(page);
      await page
        .getByRole("button", { name: "Diesen Auftrag ausführen" })
        .click();
      await arrived;
      await page.reload();
      held.release();
      await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
      await page
        .locator(".answer-panel")
        .getByRole("button", { name: "Fortsetzen", exact: true })
        .click();
      await expect(page.locator(".review-panel")).toBeVisible();
      expect(store.snapshot()).toEqual(before);
      await expect(page.locator(".editor")).toHaveCount(0);
    },
    "save",
    {},
    { capability: 0.3 },
  );
});

test("changed workspace cannot accept displayed old review", async ({
  page,
}) => {
  await withLive(
    page,
    "never",
    async (store, _held, _arrived, snapshots) => {
      await start(page);
      await expect(page.locator(".review-panel")).toBeVisible();
      store.reset(0);
      await page
        .getByRole("button", { name: "Diesen Auftrag ausführen" })
        .click();
      await expect(page.locator(".answer-panel")).toContainText(
        "Daten geändert",
      );
      expect(snapshots).toEqual([]);
      expect(store.snapshot().revision).toBe(1);
      await page
        .locator(".answer-panel")
        .getByRole("button", { name: "Fortsetzen", exact: true })
        .click();
      await expect(page.locator(".review-panel")).toBeVisible();
      expect(snapshots).toEqual([]);
    },
    "save",
    {},
    { capability: 0.3 },
  );
});

test("plan confirmation does not bypass low action confidence", async ({
  page,
}) => {
  await withLive(
    page,
    "never",
    async (store) => {
      const before = store.snapshot();
      await start(page);
      await page
        .getByRole("button", { name: "Diesen Auftrag ausführen" })
        .click();
      await expect(page.locator(".activity-label")).toContainText(
        "Keine sichere zielkonforme Entscheidung",
      );
      await expect(page.locator(".editor")).toHaveCount(0);
      expect(store.snapshot()).toEqual(before);
    },
    "save",
    {},
    { capability: 0.3, next: 0.6 },
  );
});

test("uncertain remedy lists only domain alternatives and requires actual choice", async ({
  page,
}) => {
  await withLive(
    page,
    "never",
    async (store) => {
      const before = store.snapshot();
      await start(page, "Termin V-1042 2026-09-24 09:00 für 60 Minuten");
      await expect(page.locator(".answer-panel")).toContainText(
        "Bitte eine verfügbare Person auswählen.",
      );
      await expect(page.locator(".answer-options button")).toHaveText([
        "Termin + Zuweisung an Lea Sommer freigeben",
      ]);
      expect(store.snapshot()).toEqual(before);
      await page
        .getByRole("button", {
          name: "Termin + Zuweisung an Lea Sommer freigeben",
        })
        .click();
      await expect(page.locator(".activity-label")).toHaveText(
        "Auftrag abgeschlossen",
      );
      expect(store.snapshot()).toEqual({
        ...before,
        revision: 1,
        cases: before.cases.map((c) =>
          c.id === "V-1042"
            ? {
                ...c,
                technicianId: "lea",
                appointment: { start: "2026-09-24T09:00:00", minutes: 60 },
              }
            : c,
        ),
      });
    },
    "save",
    {
      assign: "no",
      schedule: "yes",
      slot: "2026-09-24T09:00:00",
      appointmentMinutes: "60",
    },
  );
});

const refusedInterpretations: Record<string, string>[] = [
  { capability: "no", filter: "yes", customer: "hafen" },
  { cardinality: "no" },
  { coverage: "mismatch" },
];
for (const interpretation of refusedInterpretations) {
  test(`refused ${JSON.stringify(interpretation)} never offers confirmation or effects`, async ({
    page,
  }) => {
    await withLive(
      page,
      "never",
      async (store, _held, _arrived, snapshots) => {
        const before = store.snapshot();
        await start(
          page,
          "Weise V-1042 zuerst Lea und dann Jonas zu und lösche alle Kunden",
        );
        await expect(page.locator(".answer-panel")).toContainText(
          "Der vollständige Auftrag ist nicht unterstützt",
        );
        await expect(page.locator(".review-panel")).toHaveCount(0);
        expect(snapshots).toEqual([]);
        expect(store.snapshot()).toEqual(before);
        await expect(page.locator(".editor")).toHaveCount(0);
      },
      "save",
      interpretation,
      { capability: 0.3, cardinality: 0.3, coverage: 0.3 },
    );
  });
}

test("manual navigation invalidates review until refreshed and reset discards it", async ({
  page,
}) => {
  await withLive(
    page,
    "never",
    async (store, _held, _arrived, snapshots) => {
      await start(page);
      await expect(page.locator(".review-panel")).toBeVisible();
      await page
        .getByRole("button", { name: "Befehlspalette schließen" })
        .click();
      await page.getByRole("button", { name: "Kunden", exact: true }).click();
      await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
      await expect(page.locator(".review-panel")).toHaveCount(0);
      await page
        .locator(".answer-panel")
        .getByRole("button", { name: "Fortsetzen", exact: true })
        .click();
      await expect(page.locator(".review-panel")).toBeVisible();
      expect(snapshots).toEqual([]);
      expect(store.snapshot().revision).toBe(0);
      await page
        .getByRole("button", { name: "Befehlspalette schließen" })
        .click();
      await page
        .getByRole("button", { name: "Demodaten zurücksetzen", exact: true })
        .click();
      await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
      await expect(page.locator(".activity-label")).toHaveText(
        "Bereit für deinen Auftrag",
      );
      await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
      await expect(page.locator(".review-panel")).toHaveCount(0);
      expect(store.snapshot().revision).toBe(1);
      expect(snapshots).toEqual([]);
    },
    "save",
    {},
    { capability: 0.3 },
  );
});
