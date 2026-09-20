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
        supported: "yes",
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
            confidence: 1,
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
        .getByText("Pausiert, solange die Befehlspalette offen ist", {
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
