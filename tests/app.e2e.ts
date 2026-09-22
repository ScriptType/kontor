import { test as base, expect, type Page } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { demos } from "../shared/command.js";
import { WorkspaceStore } from "../server/workspace-store.js";
import { draftOf } from "../shared/domain.js";
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
test("opening a case reveals and focuses its detail heading without changing data", async ({
  page,
  address,
  workspace,
}) => {
  const before = workspace.snapshot();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(address);
  await page.locator('[data-action="case:V-1042"]').click();
  const heading = page.locator(".editor h2");
  await expect(heading).toHaveText("Wartung Standort Nord");
  await expect(async () => {
    const bounds = await heading.evaluate((element) => {
      const heading = element.getBoundingClientRect();
      const activity = document
        .querySelector(".activity")
        ?.getBoundingClientRect();
      const overlapsActivity =
        activity &&
        heading.left < activity.right &&
        heading.right > activity.left;
      return {
        top: heading.top,
        bottom: heading.bottom,
        left: heading.left,
        right: heading.right,
        visibleTop: overlapsActivity ? activity.bottom : 0,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });
    expect(bounds.top).toBeGreaterThanOrEqual(bounds.visibleTop);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  }).toPass({ timeout: 3000 });
  await expect(heading).toBeFocused();
  expect(workspace.snapshot()).toEqual(before);
});
test("mobile cross-page opening reveals details and reopening preserves the draft and input focus", async ({
  page,
  address,
  workspace,
}) => {
  const before = workspace.snapshot();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(address);
  await page.locator('[data-action="nav:team"]').click();
  await page.locator('[data-action="case:V-1042"]').click();
  const heading = page.locator(".editor h2");
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport({ ratio: 1 });
  expect(
    await heading.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const activity = document
        .querySelector(".activity")
        ?.getBoundingClientRect();
      return rect.top >= (activity?.bottom ?? 0) && rect.bottom <= innerHeight;
    }),
  ).toBe(true);
  await page.locator("#minutes").fill("17");
  await expect(page.locator("#minutes")).toBeFocused();
  await page.locator('[data-action="case:V-1042"]').click();
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#minutes")).toHaveValue("17");
  await page.locator("#minutes").fill("18");
  await expect(page.locator("#minutes")).toBeFocused();
  await page.locator('[data-action="nav:reports"]').click();
  await page.locator('[data-action="nav:cases"]').click();
  await expect(page.locator("#minutes")).toHaveValue("18");
  await expect(heading).not.toBeFocused();
  expect(workspace.snapshot()).toEqual(before);
});

test("a modal or navigation cancels a detail reveal before rendering", async ({
  page,
  address,
  workspace,
}) => {
  const before = workspace.snapshot();
  await page.goto(address);
  await expect(page.locator('[data-action="case:V-1042"]')).toBeVisible();
  await page.evaluate(() => {
    document
      .querySelector<HTMLButtonElement>('[data-action="case:V-1042"]')
      ?.click();
    document.querySelector<HTMLButtonElement>(".command-trigger")?.click();
  });
  await expect(
    page.getByRole("textbox", { name: "Auftrag an Jev" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor h2")).not.toBeFocused();
  await page.evaluate(() => {
    document
      .querySelector<HTMLButtonElement>('[data-action="case:V-1042"]')
      ?.click();
    document
      .querySelector<HTMLButtonElement>('[data-action="nav:reports"]')
      ?.click();
  });
  await expect(
    page.getByRole("heading", { name: "Berichte", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".editor")).toHaveCount(0);
  await page.locator('[data-action="nav:cases"]').click();
  await expect(page.locator(".editor h2")).not.toBeFocused();
  expect(workspace.snapshot()).toEqual(before);
});

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
  await expect(page.locator(".editor-footer [role=status]")).toHaveText(
    "V-1042 gespeichert",
  );
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
  await page.addStyleTag({
    content:
      '@keyframes close-palette { from { opacity: 1; } to { opacity: 0.99; } } .cdk-overlay-pane[data-state="closed"] { animation: close-palette 250ms linear; }',
  });
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
  for (const dismissal of ["Escape", "backdrop"]) {
    await page.getByRole("button", { name: "Demodaten zurücksetzen", exact: true }).click();
    await expect(page.getByRole("button", { name: "Abbrechen" })).toBeFocused();
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else await page.mouse.click(5, 5);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect(page.locator(".editor-footer")).toContainText(
    "Ungespeicherter Entwurf",
  );
  expect(workspace.snapshot().revision).toBe(1);
  await page
    .getByRole("searchbox", { name: "Vorgänge durchsuchen" })
    .fill("Nord");
  await page.locator('[data-action="filter:open"]').click();
  await page.locator('[data-action="menu:customer"]').click();
  await page.locator('[data-action="customer:nord"]').click();
  await page.locator('[data-action="menu:filter-technician"]').click();
  await page.locator('[data-action="filter-technician:lea"]').click();
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
  await expect(page.locator('[data-action="filter:all"]')).toHaveAttribute(
    "aria-pressed", "true",
  );
  await expect(page.locator('[data-action="menu:customer"]')).toContainText(
    "Alle",
  );
  await expect(
    page.locator('[data-action="menu:filter-technician"]'),
  ).toContainText("Alle");
  await expect(page.locator("tbody tr")).toHaveCount(5);
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

for (const dismissal of ["button", "Escape", "backdrop"]) {
  test(`failed confirmed reset keeps Jev stopped and never retries after ${dismissal}`, async ({
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
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else if (dismissal === "backdrop") await page.mouse.click(5, 5);
    else await page.getByRole("button", { name: "Schließen", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator(".activity-label")).toContainText("Gestoppt");
    await page.getByRole("button", { name: "Verlauf", exact: true }).click();
    await expect(page.locator(".history")).toContainText(demos[2]);
    expect(workspace.snapshot()).toEqual(before);
    expect(attempts).toBe(1);
  });
}

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
      priority: original.priority,
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

for (const dismissal of ["Escape", "backdrop"]) {
  test(`pending reset traps ${dismissal} until the held reset reply arrives`, async ({
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
    await expect(page.getByRole("button", { name: "Abbrechen" })).toBeFocused();
    await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
    await held;
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else await page.mouse.click(5, 5);
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.locator(".reset-dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Abbrechen" })).toBeDisabled();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("dialog")).toBeFocused();
    await expect(
      page.getByRole("textbox", { name: "Auftrag an Jev" }),
    ).not.toBeVisible();
    expect(workspace.snapshot().revision).toBe(1);
    release();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "Demodaten zurückgesetzt.",
    );
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("textbox", { name: "Auftrag an Jev" })).toBeVisible();
  });
}

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
    .getByRole("spinbutton", { name: "Arbeitszeit in Minuten", exact: true })
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

test("a late receipt preserves manual edits made after submission", async ({
  page,
  address,
  workspace,
}) => {
  let release = () => {},
    arrived = () => {};
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
  await command(page, demos[3]);
  await held;
  expect(workspace.snapshot().cases[0]?.minutes).toBe(45);
  await page.locator("#minutes").fill("71");
  release();
  await expect(page.locator(".editor-footer")).toContainText(
    "neuerer Entwurf bleibt ungespeichert",
  );
  await expect(page.locator("#minutes")).toHaveValue("71");
  await expect(page.locator(".activity-label")).toContainText(
    "manuellem Eingriff",
  );
  expect(workspace.snapshot().cases[0]?.minutes).toBe(45);
  expect(workspace.snapshot().revision).toBe(1);
});
test("appointment duration is unavailable until its visible date exists", async ({
  page,
  address,
}) => {
  await page.goto(address);
  await page.locator('[data-action="case:V-1042"]').click();
  await expect(
    page.getByRole("spinbutton", { name: "Termindauer in Minuten" }),
  ).toBeDisabled();
  await page.locator("#appointment").fill("2026-09-25T09:00");
  await page.locator("#appointment").blur();
  await expect(
    page.getByRole("spinbutton", { name: "Termindauer in Minuten" }),
  ).toBeEnabled();
  await page
    .getByRole("spinbutton", { name: "Termindauer in Minuten" })
    .fill("75");
  await page.getByRole("spinbutton", { name: "Termindauer in Minuten" }).blur();
  await expect(page.locator("#appointment")).toHaveValue("2026-09-25T09:00");
});

test("legacy history remains readable without restoring execution authority", async ({
  page,
  address,
  workspace,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "kontor-command-v1",
      JSON.stringify({
        version: 2,
        command: "Alter Auftrag",
        goal: { stale: true },
        unfinished: true,
        history: [
          {
            id: "legacy",
            request: "Alter Auftrag",
            entries: ["Früherer sichtbarer Schritt"],
            operations: [],
            savedOperations: [],
            createdAt: "2026-09-01T12:00:00Z",
            outcome: "Pausiert",
          },
        ],
      }),
    ),
  );
  await page.goto(address);
  await expect(page.locator(".activity-label")).toHaveText(
    "Bereit für deinen Auftrag",
  );
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Auftrag an Jev" }),
  ).toHaveValue("Alter Auftrag");
  await expect(page.locator(".history")).toContainText("Alter Auftrag");
  expect(workspace.snapshot().revision).toBe(0);
});

test("a stored history whose steps lack Jev texts starts empty and idle", async ({
  page,
  address,
  workspace,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "kontor-command-v1",
      JSON.stringify({
        version: 3,
        command: "Früherer Auftrag",
        unfinished: true,
        history: [
          {
            id: "before-jev-texts",
            request: "Früherer Auftrag",
            entries: ["Kunden anzeigen"],
            operations: [],
            savedOperations: [],
            receipts: [],
            answers: [],
            steps: [
              {
                snapshotId: "earlier",
                action: {
                  id: "nav:customers",
                  label: "Kunden öffnen",
                  effect: "Kunden öffnen",
                  kind: "view",
                },
                authorizedBy: "request",
                outcome: "changed",
                before: "{}",
                after: "{}",
              },
            ],
            createdAt: "2026-09-01T12:00:00Z",
            outcome: "Pausiert",
          },
        ],
      }),
    ),
  );
  await page.goto(address);
  await expect(page.locator(".activity-label")).toHaveText(
    "Bereit für deinen Auftrag",
  );
  await page.locator('[data-action="nav:customers"]').click();
  await expect(page).toHaveURL(/#customers$/);
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(page.getByText("Früherer Auftrag")).toHaveCount(0);
  expect(workspace.snapshot().revision).toBe(0);
});

test("a done case still shows save blockers beside the reopen workflow", async ({
  page,
  address,
  workspace,
}) => {
  const before = workspace.snapshot();
  await page.goto(address);
  await page.locator('[data-action="case:V-1035"]').click();
  await page.locator('[data-action="menu:technician"]').click();
  await page.locator('[data-action="technician:jonas"]').click();
  await page.locator("#appointment").fill("2026-09-24T09:00");
  await page.locator("#minutes").click();
  await expect(page.locator('[data-action="reopen"]')).toBeEnabled();
  await expect(page.locator('[data-action="save"]')).toBeDisabled();
  await expect(
    page.getByText("Jonas Weber ist durch V-1041 belegt.", { exact: true }),
  ).toBeVisible();
  expect(workspace.snapshot()).toEqual(before);
});

test("priority, reopening and appointment removal stay in the draft until saved and discard restores every value", async ({
  page,
  address,
  workspace,
}) => {
  const original = workspace
    .snapshot()
    .cases.find((c) => c.id === "V-1039");
  if (!original) throw new Error("Missing seed case");
  const saved = workspace.save({
    operationId: crypto.randomUUID(),
    revision: 0,
    caseId: original.id,
    actor: "manual",
    draft: {
      ...draftOf(original),
      status: "done",
      appointment: { start: "2026-09-25T10:00:00", minutes: 60 },
      inspection: { note: "Schutzleiter vor Ort geprüft.", by: "user" },
    },
  }).saved;
  const before = workspace.snapshot();
  await page.goto(address);
  await page.locator('[data-action="case:V-1039"]').click();
  await expect(
    page.locator('[data-action="priority:Hoch"]'),
  ).toBeDisabled();
  for (const id of ["priority:Normal", "reopen", "remove-appointment"])
    await page.locator(`[data-action="${id}"]`).click();
  await expect(page.locator("#appointment")).toHaveValue("");
  await expect(
    page.locator('[data-action="priority:Normal"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-action="complete"]')).toBeEnabled();
  expect(workspace.snapshot()).toEqual(before);
  await page.locator('[data-action="discard"]').click();
  await expect(
    page.locator('[data-action="priority:Hoch"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#appointment")).toHaveValue(
    "2026-09-25T10:00",
  );
  await expect(page.locator('[data-action="reopen"]')).toBeVisible();
  await expect(page.locator("#evidence")).toHaveValue(
    saved.inspection?.note ?? "",
  );
  expect(workspace.snapshot()).toEqual(before);
  for (const id of ["priority:Normal", "reopen", "remove-appointment"])
    await page.locator(`[data-action="${id}"]`).click();
  await page.locator('[data-action="save"]').click();
  await expect(page.locator(".editor-footer [role=status]")).toHaveText(
    "V-1039 gespeichert",
  );
  expect(workspace.snapshot().cases.find((c) => c.id === saved.id)).toEqual(
    { ...saved, priority: "Normal", status: "open", appointment: null },
  );
  expect(workspace.snapshot().revision).toBe(before.revision + 1);
  await page.reload();
  await page.locator('[data-action="case:V-1039"]').click();
  await expect(
    page.locator('[data-action="priority:Normal"]'),
  ).toBeDisabled();
  await expect(
    page.locator('[data-action="remove-appointment"]'),
  ).toHaveCount(0);
  await expect(page.locator("#minutes")).toHaveValue(String(saved.minutes));
  await expect(page.locator("#evidence")).toHaveValue(
    saved.inspection?.note ?? "",
  );
});

test("case filters combine, reset and drilldowns replace filters while retaining a dirty selection", async ({
  page,
  address,
  workspace,
}) => {
  const before = workspace.snapshot();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(address);
  await page.locator('[data-action="case:V-1042"]').click();
  await page.locator('[data-action="priority:Normal"]').click();
  await page.locator('[data-action="menu:customer"]').click();
  await page.locator('[data-action="customer:nord"]').click();
  await page.locator('[data-action="menu:filter-technician"]').click();
  await page.locator('[data-action="filter-technician:lea"]').click();
  await page.locator('[data-action="filter:open"]').click();
  await page.getByRole("searchbox").fill("Süd");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("V-1039");
  await expect(page.locator(".editor h2")).toHaveText(
    "Wartung Standort Nord",
  );
  await page.locator('[data-action="case:V-1039"]').click();
  await expect(page.locator(".editor-footer")).toContainText(
    "zuerst speichern oder verwerfen",
  );
  await expect(page.locator(".editor h2")).toHaveText(
    "Wartung Standort Nord",
  );
  await page.locator('[data-action="filter:done"]').click();
  await expect(page.locator("tbody")).toContainText(
    "Keine passenden Vorgänge",
  );
  await page.locator('[data-action="filter:reset"]').click();
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.locator('[data-action="menu:customer"]')).toContainText(
    "Alle",
  );
  await expect(
    page.locator('[data-action="menu:filter-technician"]'),
  ).toContainText("Alle");
  await expect(page.locator('[data-action="filter:all"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("searchbox").fill("unpassend");
  await page.locator('[data-action="nav:team"]').click();
  await page.locator('[data-action="technician-cases:mara"]').click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("V-1037");
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.locator('[data-action="menu:customer"]')).toContainText(
    "Alle",
  );
  await expect(page.locator('[data-action="filter:open"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator('[data-action="nav:reports"]').click();
  await page.locator('[data-action="status-cases:done"]').click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("V-1035");
  await expect(
    page.locator('[data-action="menu:filter-technician"]'),
  ).toContainText("Alle");
  await page.locator('[data-action="nav:customers"]').click();
  await page.locator('[data-action="customer-cases:hafen"]').click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator('[data-action="filter:all"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator('[data-action="nav:reports"]').click();
  await page.locator('[data-action="status-cases:open"]').click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await expect(page.locator('[data-action="menu:customer"]')).toContainText(
    "Alle",
  );
  await expect(page.locator(".editor h2")).toHaveText(
    "Wartung Standort Nord",
  );
  await expect(
    page.locator('[data-action="priority:Normal"]'),
  ).toBeDisabled();
  await expect(page.locator('[data-action="save"]')).toBeEnabled();
  expect(workspace.snapshot()).toEqual(before);
});

for (const outcome of ["found", "missing"] as const) {
  test(`legacy pending save without priority stays blocked until ${outcome} receipt and never replays`, async ({
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
      draft: { ...draftOf(original), minutes: 88 },
    };
    if (outcome === "found") workspace.save(input);
    const { priority, ...legacyDraft } = input.draft;
    const legacy = { ...input, draft: legacyDraft };
    expect(priority).toBe("Hoch");
    const before = workspace.snapshot();
    const receiptIds: string[] = [];
    const receipt = workspace.receipt.bind(workspace);
    workspace.receipt = (id) => {
      receiptIds.push(id);
      return receipt(id);
    };
    let saves = 0;
    const save = workspace.save.bind(workspace);
    workspace.save = (value) => {
      saves++;
      return save(value);
    };
    await page.addInitScript(
      (journal) =>
        localStorage.setItem("kontor-save-v1", JSON.stringify(journal)),
      legacy,
    );
    await page.goto(address);
    await expect(
      page.getByRole("button", { name: "Ergebnis prüfen", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("kontor-save-v1") ?? "null"),
      ),
    ).toEqual(legacy);
    await page.locator('[data-action="case:V-1042"]').click();
    await page.locator('[data-action="priority:Normal"]').click();
    await expect(page.locator('[data-action="save"]')).toBeDisabled();
    await page
      .getByRole("button", { name: "Ergebnis prüfen", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Ergebnis prüfen", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".editor-footer")).toContainText(
      outcome === "found"
        ? "V-1042 gespeichert"
        : "Keine Speicherung gefunden",
    );
    await expect(page.locator('[data-action="save"]')).toBeEnabled();
    await expect(
      page.locator('[data-action="priority:Normal"]'),
    ).toBeDisabled();
    expect(
      await page.evaluate(() => localStorage.getItem("kontor-save-v1")),
    ).toBeNull();
    expect(receiptIds).toEqual([input.operationId]);
    expect(saves).toBe(0);
    expect(workspace.snapshot()).toEqual(before);
  });
}
