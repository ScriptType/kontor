import { test, expect, type Page } from "@playwright/test";
import { once } from "node:events";
import { z } from "zod";
import { createApp } from "../server/app.js";
import { WorkspaceStore } from "../server/workspace-store.js";
import { decisionInputSchema } from "../shared/command.js";
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
    await run(store, held, arrived.promise, snapshots);
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
    await expect(page.locator(".activity-label")).toContainText("teilweise");
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
