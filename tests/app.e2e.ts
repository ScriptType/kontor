import { test as base, expect, type Page } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { demos } from "../shared/command.js";
import { WorkspaceStore } from "../server/workspace-store.js";
const test = base.extend<{ workspace: WorkspaceStore; address: string }>({
  workspace: async ({}, use) => {
    const store = new WorkspaceStore();
    await use(store);
  },
  address: async ({ workspace }, use) => {
    const app = createApp({ mode: "demo" }, undefined, workspace);
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("No server address");
    await use(`http://127.0.0.1:${address.port}`);
    await app.close();
  },
});
async function command(page: Page, text: string) {
  await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
  await page.getByRole("textbox", { name: "Auftrag an Jev" }).fill(text);
  await page.getByRole("button", { name: "Ausführen" }).click();
}
test("finite demo fixture saves once and reports saved state across reload", async ({
  page,
  address,
  workspace,
}) => {
  await page.goto(address);
  await command(page, demos[2]);
  await expect(page.locator(".activity-label")).toContainText("Jev meldet");
  expect(workspace.snapshot().revision).toBe(1);
  expect(workspace.snapshot().cases[0]?.technicianId).toBe("lea");
  await page.locator('[data-action="nav:team"]').click();
  await expect(
    page
      .locator(".card")
      .filter({ has: page.getByRole("heading", { name: "Lea Sommer" }) }),
  ).toContainText("V-1042");
  await page.reload();
  await expect(page.locator(".workspace-foot")).toContainText("Revision 1");
});
test("finite demo missing value goes through actual input and saves the explicit answer", async ({
  page,
  address,
  workspace,
}) => {
  await page.goto(address);
  await command(page, demos[4]);
  await expect(page.locator(".answer-panel input")).toBeFocused();
  expect(workspace.snapshot().revision).toBe(0);
  await page.locator(".answer-panel input").fill("47");
  await page.getByRole("button", { name: "Wert bestätigen" }).click();
  await expect(page.locator(".activity-label")).toContainText("Jev meldet");
  expect(workspace.snapshot().cases[0]?.minutes).toBe(47);
  expect(workspace.snapshot().revision).toBe(1);
});
test("manual draft is preserved when a new command starts", async ({
  page,
  address,
  workspace,
}) => {
  await page.goto(address);
  await page.locator('[data-action="case:V-1042"]').click();
  await page.locator("#minutes").fill("17");
  await command(page, demos[0]);
  await expect(page.locator(".activity-label")).toContainText(
    "Offenen Entwurf",
  );
  await expect(page.locator("#minutes")).toHaveValue("17");
  expect(workspace.snapshot().revision).toBe(0);
});
test("manual reset preserves canceled drafts then clears saved data, drafts, filters and history over WebSocket", async ({
  page,
  address,
  workspace,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (["fetch", "xhr"].includes(request.resourceType()))
      requests.push(request.url());
  });
  const seed = workspace.snapshot();
  await page.goto(address);
  await command(page, demos[2]);
  await expect(page.locator(".activity-label")).toHaveText(
    "Jev meldet den Auftrag als erledigt",
  );
  await page.locator('[data-action="menu:technician"]').click();
  await page.getByRole("button", { name: /Jonas Weber/ }).click();
  await page
    .getByRole("button", { name: "Demodaten zurücksetzen", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Abbrechen" })).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("textbox", { name: "Auftrag an Jev" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.locator(".editor-footer")).toContainText(
    "Ungespeicherter Entwurf",
  );
  expect(workspace.snapshot().revision).toBe(1);
  await page
    .getByRole("searchbox", { name: "Vorgänge durchsuchen" })
    .fill("Nord");
  await page.getByRole("button", { name: "Nur offen", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Demodaten zurücksetzen", exact: true })
    .click();
  await page.screenshot({
    path: "/tmp/kontor-reset/mobile-confirm.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Demodaten zurückgesetzt.",
  );
  expect(workspace.snapshot()).toEqual({ ...seed, revision: 2 });
  await expect(
    page.getByRole("searchbox", { name: "Vorgänge durchsuchen" }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Nur offen", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".editor-footer")).not.toBeVisible();
  await expect(page.locator(".activity-label")).toHaveText(
    "Bereit für deinen Auftrag",
  );
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kontor-command-v1") ?? "null"),
    ),
  ).toMatchObject({ command: "", history: [], unfinished: false });
  await page.reload();
  await expect(page.locator(".workspace-foot")).toContainText("Revision 2");
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Auftrag an Jev" }),
  ).toHaveValue("");
  await expect(page.locator(".history ol")).not.toBeVisible();
  expect(requests).toEqual([]);
});

test("reset finishes while Save response is held and late receipt cannot restore old state", async ({
  page,
  address,
  workspace,
}) => {
  let release = () => {};
  let arrived = () => {};
  const held = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.routeWebSocket("**/rpc", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const text =
        typeof message === "string" ? message : message.toString("utf8");
      if (text.includes("operationId") && text.includes("saved")) {
        release = () => socket.send(message);
        arrived();
      } else socket.send(message);
    });
  });
  const seed = workspace.snapshot();
  await page.goto(address);
  await command(page, demos[2]);
  await held;
  await page
    .getByRole("button", { name: "Demodaten zurücksetzen", exact: true })
    .click();
  await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Demodaten zurückgesetzt.",
  );
  expect(workspace.snapshot()).toEqual({ ...seed, revision: 2 });
  release();
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Auftrag an Jev" }),
  ).toHaveValue("");
  await expect(page.locator(".history ol")).not.toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Wartung Standort Nord", exact: true })
    .click();
  await expect(page.locator(".editor-footer")).not.toContainText("gespeichert");
  expect(
    await page.evaluate(() => localStorage.getItem("kontor-save-v1")),
  ).toBeNull();
  await expect(page.locator(".activity-label")).toHaveText(
    "Bereit für deinen Auftrag",
  );
  expect(workspace.snapshot()).toEqual({ ...seed, revision: 2 });
});

test("failed confirmed reset keeps Jev stopped and never retries automatically", async ({
  page,
  address,
  workspace,
}) => {
  let attempts = 0;
  workspace.reset = () => {
    attempts++;
    throw new Error("isolated reset failure");
  };
  await page.goto(address);
  await command(page, demos[2]);
  await expect(page.locator(".activity-label")).toHaveText(
    "Jev meldet den Auftrag als erledigt",
  );
  const before = workspace.snapshot();
  await page
    .getByRole("button", { name: "Demodaten zurücksetzen", exact: true })
    .click();
  await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Zurücksetzen nicht bestätigt",
  );
  await expect(
    page.getByRole("button", { name: "Jetzt zurücksetzen" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(page.locator(".activity-label")).toContainText("Gestoppt");
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(page.locator(".history")).toContainText(demos[2]);
  expect(workspace.snapshot()).toEqual(before);
  expect(attempts).toBe(1);
});

test("reset cancels a held Jev decision and keeps the confirmation modal exclusive", async ({
  page,
  address,
  workspace,
}) => {
  let release = () => {};
  let arrived = () => {};
  const held = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let hold = true;
  await page.routeWebSocket("**/rpc", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const text =
        typeof message === "string" ? message : message.toString("utf8");
      if (hold && text.includes("snapshotId") && text.includes("choice")) {
        hold = false;
        release = () => socket.send(message);
        arrived();
      } else socket.send(message);
    });
  });
  await page.goto(address);
  await command(page, demos[2]);
  await held;
  await page
    .getByRole("button", { name: "Demodaten zurücksetzen", exact: true })
    .click();
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Abbrechen" })).toBeFocused();
  await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Demodaten zurückgesetzt.",
  );
  release();
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Team & Kapazität" }),
  ).toBeVisible();
  await expect(page.locator(".activity-label")).toHaveText(
    "Bereit für deinen Auftrag",
  );
  expect(workspace.snapshot().revision).toBe(1);
  expect(workspace.snapshot().cases[0]?.technicianId).toBe("jonas");
});

test("late reconciliation cannot restore a draft after reset", async ({
  page,
  address,
  workspace,
}) => {
  const original = workspace.snapshot().cases[0];
  if (!original) throw new Error("Missing seed case");
  const input = {
    operationId: crypto.randomUUID(),
    revision: 0,
    caseId: original.id,
    actor: "manual" as const,
    draft: {
      technicianId: original.technicianId,
      minutes: 88,
      status: original.status,
      appointment: original.appointment,
      inspection: original.inspection,
    },
  };
  workspace.save(input);
  await page.addInitScript(
    (input) => localStorage.setItem("kontor-save-v1", JSON.stringify(input)),
    input,
  );
  let release = () => {};
  let arrived = () => {};
  const held = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.routeWebSocket("**/rpc", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const text =
        typeof message === "string" ? message : message.toString("utf8");
      if (text.includes("operationId") && text.includes("saved")) {
        release = () => socket.send(message);
        arrived();
      } else socket.send(message);
    });
  });
  await page.goto(address);
  await page
    .getByRole("button", { name: "Ergebnis prüfen", exact: true })
    .click();
  await held;
  await page
    .getByRole("button", { name: "Demodaten zurücksetzen", exact: true })
    .click();
  await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Demodaten zurückgesetzt.",
  );
  release();
  await page
    .getByRole("button", { name: "Wartung Standort Nord", exact: true })
    .click();
  await expect(page.locator(".editor-footer")).not.toContainText("gespeichert");
  expect(workspace.snapshot().cases[0]?.minutes).toBe(original.minutes);
  expect(
    await page.evaluate(() => localStorage.getItem("kontor-save-v1")),
  ).toBeNull();
});

test("pending reset traps the dialog until the held reset reply arrives", async ({
  page,
  address,
  workspace,
}) => {
  let replies = 0;
  let release = () => {};
  let arrived = () => {};
  const held = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.routeWebSocket("**/rpc", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const text =
        typeof message === "string" ? message : message.toString("utf8");
      if (text.includes("customers") && text.includes("technicians")) replies++;
      if (replies === 3 && text.includes("customers")) {
        release = () => socket.send(message);
        arrived();
      } else socket.send(message);
    });
  });
  await page.goto(address);
  await page
    .getByRole("button", { name: "Demodaten zurücksetzen", exact: true })
    .click();
  await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
  await held;
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.locator(".reset-dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Abbrechen" })).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Auftrag an Jev" }),
  ).not.toBeVisible();
  expect(workspace.snapshot().revision).toBe(1);
  release();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Demodaten zurückgesetzt.",
  );
});

test("Stop while Save reply is held records the committed result without resuming", async ({
  page,
  address,
  workspace,
}) => {
  let release = () => {};
  let arrived = () => {};
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.routeWebSocket("**/rpc", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const text =
        typeof message === "string" ? message : message.toString("utf8");
      if (text.includes("operationId") && text.includes("saved")) {
        release = () => socket.send(message);
        arrived();
      } else socket.send(message);
    });
  });
  await page.goto(address);
  await command(page, demos[2]);
  await received;
  expect(workspace.snapshot().revision).toBe(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  release();
  await expect(page.locator(".editor-footer")).toContainText(
    "V-1042 gespeichert",
  );
  await expect(page.locator(".activity-label")).toContainText("Gestoppt");
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(page.locator(".history ol")).toContainText("V-1042 gespeichert");
  expect(workspace.snapshot().revision).toBe(1);
});
test("unavailable browser storage refuses sending a save instead of losing its receipt identity", async ({
  page,
  address,
  workspace,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  await page.goto(address);
  await page
    .getByRole("button", { name: "Wartung Standort Nord", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Geleistete Arbeitszeit in Minuten" })
    .fill("20");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator(".editor-footer")).toContainText(
    "Speichern wurde nicht gesendet",
  );
  expect(workspace.snapshot().revision).toBe(0);
});

test("late saved step cannot enter a replacement run after reset", async ({
  page,
  address,
  workspace,
}) => {
  let release = () => {},
    arrived = () => {};
  const held = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let hold = true;
  await page.routeWebSocket("**/rpc", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const text =
        typeof message === "string" ? message : message.toString("utf8");
      if (hold && text.includes("operationId") && text.includes("saved")) {
        hold = false;
        release = () => socket.send(message);
        arrived();
      } else socket.send(message);
    });
  });
  await page.goto(address);
  await command(page, demos[2]);
  await held;
  await page
    .getByRole("button", { name: "Demodaten zurücksetzen", exact: true })
    .click();
  await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await command(page, demos[0]);
  await expect(page.locator(".activity-label")).toContainText("Jev meldet");
  release();
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  const history = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}"),
  );
  expect(history.history).toHaveLength(1);
  expect(
    history.history[0].steps.map(
      (s: { action: { id: string } }) => s.action.id,
    ),
  ).toEqual(["nav:customers"]);
  expect(history.history[0].receipts).toEqual([]);
  expect(workspace.snapshot().revision).toBe(2);
});
