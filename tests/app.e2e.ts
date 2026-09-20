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
async function answerPanel(page: Page) {
  await expect(page.locator(".answer-panel")).toBeVisible();
}
test("assignment follows visible menus, saves once, updates cross-page state, and persists on reload", async ({
  page,
  address,
  workspace,
}) => {
  const httpBusiness: string[] = [];
  page.on("request", (req) => {
    if (["fetch", "xhr"].includes(req.resourceType()))
      httpBusiness.push(req.url());
  });
  await page.goto(address);
  await expect(
    page.getByRole("heading", { name: "Vorgänge", exact: true }),
  ).toBeVisible();
  await command(page, demos[0]);
  await expect(
    page
      .locator(".activity-label")
      .filter({ hasText: /^Auftrag abgeschlossen$/ }),
  ).toBeVisible();
  expect(workspace.snapshot().cases[0]?.technicianId).toBe("lea");
  expect(workspace.snapshot().revision).toBe(1);
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await expect(
    page
      .locator(".card")
      .filter({ has: page.getByRole("heading", { name: "Lea Sommer" }) }),
  ).toContainText("V-1042");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Team & Kapazität" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(page.locator(".history")).toContainText(demos[0]);
  expect(httpBusiness).toEqual([]);
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "/tmp/kontor-implementation/desktop.png",
    fullPage: true,
  });
});
test("manual draft does not affect saved table or reports and blocks unrelated command", async ({
  page,
  address,
  workspace,
}) => {
  await page.goto(address);
  await page
    .getByRole("button", { name: "Wartung Standort Nord", exact: true })
    .click();
  await page.locator('[data-action="menu:technician"]').click();
  await page.getByRole("button", { name: /Lea Sommer Elektro/ }).click();
  expect(workspace.snapshot().cases[0]?.technicianId).toBe("jonas");
  await command(page, demos[3]);
  await answerPanel(page);
  await expect(page.getByText(/Es gibt einen offenen Entwurf/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.locator(".activity-label").filter({ hasText: /^Antwort ausstehend$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByText(/V-1042 gespeichert/)).toBeVisible();
  expect(workspace.snapshot().cases[0]?.technicianId).toBe("lea");
});
test("ambiguous case and missing time ask concrete questions, Escape retains input", async ({
  page,
  address,
  workspace,
}) => {
  await page.goto(address);
  await command(page, demos[1]);
  await answerPanel(page);
  await expect(
    page.getByRole("button", { name: /V-1042 · Wartung Standort Nord/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /V-1039 · Wartung Standort Süd/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(workspace.snapshot().revision).toBe(0);
  await page.getByRole("button", { name: "Antworten", exact: true }).click();
  await page
    .getByRole("button", { name: /V-1042 · Wartung Standort Nord/ })
    .click();
  await expect(
    page
      .locator(".activity-label")
      .filter({ hasText: /^Auftrag abgeschlossen$/ }),
  ).toBeVisible();
  await command(page, demos[2]);
  await answerPanel(page);
  await page
    .getByRole("spinbutton", { name: "Tatsächlich geleistete Minuten" })
    .fill("35");
  await page.getByRole("button", { name: "Minuten bestätigen" }).click();
  await expect(
    page
      .locator(".activity-label")
      .filter({ hasText: /^Auftrag abgeschlossen$/ }),
  ).toBeVisible();
  expect(workspace.snapshot().cases[0]?.minutes).toBe(35);
});
test("completion reorders requested time; explicit wrong order requires consent", async ({
  page,
  address,
  workspace,
}) => {
  await page.goto(address);
  await command(page, demos[4]);
  await answerPanel(page);
  await expect(
    page.getByText(/Deine feste Reihenfolge ist so nicht möglich/),
  ).toBeVisible();
  expect(workspace.snapshot().revision).toBe(0);
  await page
    .getByRole("button", { name: "Zeit zuerst erfassen, dann abschließen" })
    .click();
  await expect(
    page
      .locator(".activity-label")
      .filter({ hasText: /^Auftrag abgeschlossen$/ }),
  ).toBeVisible();
  expect(workspace.snapshot().cases[0]).toMatchObject({
    status: "done",
    minutes: 45,
  });
  await page.getByRole("button", { name: "Berichte", exact: true }).click();
  await expect(page.locator(".metrics")).toContainText("230");
});
test("conflict proposal can be rejected; approval changes only the displayed job", async ({
  page,
  address,
  workspace,
}) => {
  await page.goto(address);
  await command(page, demos[5]);
  await answerPanel(page);
  await expect(page.getByText(/durch V-1041 belegt/)).toBeVisible();
  await expect(page.locator(".answer-options button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".activity-label")).toHaveText(
    "Freigabe ausstehend",
  );
  await page.getByRole("button", { name: "Antworten", exact: true }).click();
  await page.getByRole("button", { name: "Ablehnen und stoppen" }).click();
  expect(workspace.snapshot().revision).toBe(0);
  await page.keyboard.press("Escape");
  await command(page, demos[5]);
  await answerPanel(page);
  await page
    .getByRole("button", { name: "Termin + Zuweisung an Lea Sommer freigeben" })
    .click();
  await expect(
    page
      .locator(".activity-label")
      .filter({ hasText: /^Auftrag abgeschlossen$/ }),
  ).toBeVisible();
  expect(workspace.snapshot().cases[0]).toMatchObject({
    technicianId: "lea",
    appointment: { start: "2026-09-24T09:00:00", minutes: 60 },
  });
  expect(workspace.snapshot().cases[1]?.appointment).toEqual({
    start: "2026-09-24T09:00:00",
    minutes: 120,
  });
});
test("unverified physical work and unknown demo input never mutate; mobile dialog keyboard works", async ({
  page,
  address,
  workspace,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(address);
  await command(page, demos[6]);
  await answerPanel(page);
  await expect(
    page
      .locator(".answer-panel")
      .getByText(/Die Prüfung vor Ort ist nicht belegt/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("textbox", { name: "Auftrag an Jev" }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Auftrag an Jev" })
    .fill("Bestelle einen Hubschrauber");
  await page.getByRole("button", { name: "Ausführen" }).click();
  await answerPanel(page);
  await expect(
    page.getByText(/vollständige Auftrag ist nicht unterstützt/),
  ).toBeVisible();
  expect(workspace.snapshot().revision).toBe(0);
  await page.screenshot({
    path: "/tmp/kontor-implementation/mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("stale proposal asks again before any approved change", async ({
  page,
  address,
  workspace,
}) => {
  await page.goto(address);
  await command(page, demos[5]);
  await answerPanel(page);
  const other = workspace.snapshot().cases[3];
  if (!other) throw new Error("Missing seed");
  workspace.save({
    operationId: crypto.randomUUID(),
    revision: 0,
    caseId: other.id,
    actor: "manual",
    draft: {
      technicianId: other.technicianId,
      minutes: 25,
      appointment: other.appointment,
      inspection: other.inspection,
      status: other.status,
    },
  });
  await page
    .getByRole("button", { name: "Termin + Zuweisung an Lea Sommer freigeben" })
    .click();
  await expect(page.locator(".activity-label")).toHaveText(
    "Freigabe ausstehend",
  );
  expect(workspace.snapshot().revision).toBe(1);
  expect(workspace.snapshot().cases[0]?.appointment).toBeNull();
  await answerPanel(page);
  await page
    .getByRole("button", { name: "Termin + Zuweisung an Lea Sommer freigeben" })
    .click();
  await expect(page.locator(".activity-label")).toHaveText(
    "Auftrag abgeschlossen",
  );
  expect(workspace.snapshot().revision).toBe(2);
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
  await command(page, demos[0]);
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
test("review screenshots show desktop and mobile workspace and palette", async ({
  page,
  address,
}) => {
  await page.goto(address);
  await expect(
    page.getByRole("heading", { name: "Vorgänge", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/kontor-implementation/screenshots/desktop-workspace.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Auftrag an Jev" }),
  ).toBeFocused();
  await page.screenshot({
    path: "/tmp/kontor-implementation/screenshots/desktop-palette.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.screenshot({
    path: "/tmp/kontor-implementation/screenshots/mobile-workspace.png",
    fullPage: true,
  });
  await page.keyboard.press("Meta+k");
  await expect(
    page.getByRole("textbox", { name: "Auftrag an Jev" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("dialog")).toContainText(
    "Was soll Jev erledigen?",
  );
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/kontor-implementation/screenshots/mobile-palette.png",
    fullPage: true,
  });
});

test("missing schedule asks for concrete source values and then saves them", async ({
  page,
  address,
  workspace,
}) => {
  await page.goto(address);
  await command(page, demos[7]);
  await answerPanel(page);
  await page
    .getByLabel("Gewünschter Termin", { exact: true })
    .fill("2026-09-25T11:00");
  await page
    .locator(".answer-panel")
    .getByLabel("Termindauer in Minuten", { exact: true })
    .fill("75");
  await page.getByRole("button", { name: "Diesen Termin bestätigen" }).click();
  await expect(page.locator(".activity-label")).toHaveText(
    "Auftrag abgeschlossen",
  );
  expect(workspace.snapshot().cases[0]?.appointment).toEqual({
    start: "2026-09-25T11:00:00",
    minutes: 75,
  });
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

for (const entry of ["cases", "customers", "reports", "filtered"]) {
  test(`pending attention opens once and evidence hands off from ${entry} to the correct manual editor`, async ({
    page,
    address,
    workspace,
  }) => {
    await page.goto(address + "#" + (entry === "filtered" ? "cases" : entry));
    if (entry === "filtered")
      await page.getByLabel("Vorgänge durchsuchen").fill("V-1042");
    await command(page, demos[6]);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".answer-panel")).toContainText("V-1039");
    const evidence = page.getByRole("button", {
      name: "Prüfbeleg erfassen",
      exact: true,
    });
    await expect(evidence).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator(".editor")).toContainText("V-1039");
    await expect(page.locator(".activity-label")).toHaveText(
      "Antwort ausstehend",
    );
    await page.waitForTimeout(150);
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "Antworten", exact: true }).click();
    await evidence.click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByLabel("Tatsächlicher Prüfbeleg")).toBeFocused();
    const before = workspace.snapshot();
    expect(before.revision).toBe(0);
    await page
      .getByLabel("Tatsächlicher Prüfbeleg")
      .fill("Testbeobachtung am isolierten Prüfstand dokumentiert.");
    expect(workspace.snapshot()).toEqual(before);
    await page
      .getByRole("button", { name: "Eigenen Prüfbeleg in Entwurf übernehmen" })
      .click();
    await expect(
      page.getByRole("button", { name: "Auftrag fortsetzen", exact: true }),
    ).toBeDisabled();
    expect(workspace.snapshot()).toEqual(before);
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(page.locator(".editor-footer")).toContainText(
      "V-1039 gespeichert",
    );
    expect(
      workspace.snapshot().cases.find((c) => c.id === "V-1039"),
    ).toMatchObject({ status: "open", inspection: { by: "user" } });
    await expect(
      page.getByRole("button", { name: "Auftrag fortsetzen", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Auftrag fortsetzen", exact: true })
      .click();
    await expect(page.locator(".activity-label")).toHaveText(
      "Auftrag abgeschlossen",
    );
    const after = workspace.snapshot();
    expect(after.revision).toBe(2);
    expect(after.cases.find((c) => c.id === "V-1039")).toMatchObject({
      status: "done",
      inspection: { by: "user" },
    });
    expect(after.cases.filter((c) => c.id !== "V-1039")).toEqual(
      before.cases.filter((c) => c.id !== "V-1039"),
    );
    await page.getByRole("button", { name: "Berichte", exact: true }).click();
    await expect(
      page
        .locator(".metrics article")
        .filter({ hasText: "Abgeschlossen" })
        .locator("strong"),
    ).toHaveText("2");
  });
}

test("foreign draft stays intact and can be reached from reports", async ({
  page,
  address,
  workspace,
}) => {
  await page.goto(address);
  await page
    .getByRole("button", { name: "Wartung Standort Nord", exact: true })
    .click();
  await page.getByLabel("Geleistete Arbeitszeit in Minuten").fill("19");
  await page.getByRole("button", { name: "Berichte", exact: true }).click();
  await command(page, demos[6]);
  await expect(page.locator(".answer-panel")).toContainText("V-1042");
  await expect(
    page.getByRole("button", { name: "Offenen Entwurf prüfen" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Offenen Entwurf prüfen" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".editor")).toContainText("V-1042");
  await expect(
    page.getByLabel("Geleistete Arbeitszeit in Minuten"),
  ).toHaveValue("19");
  expect(workspace.snapshot().revision).toBe(0);
});
