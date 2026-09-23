import { test, expect, type Page } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { WorkspaceStore } from "../server/workspace-store.js";
import type { GateName } from "../frontend/src/gate.js";
import { start, storeGate, withLive } from "./live-fixture.js";

async function withDemo(page: Page, run: () => Promise<void>) {
  const app = createApp({ mode: "demo" }, undefined, new WorkspaceStore());
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await run();
  } finally {
    await app.close();
  }
}
const click = (page: Page, id: string) =>
  page.locator(`[data-action="${id}"]`).click();
async function filterToLindenwerk(page: Page) {
  await click(page, "menu:customer");
  await click(page, "customer:linden");
  await expect(page.locator('[data-action^="case:"]')).toHaveCount(1);
  await expect(page.locator('[data-action="case:V-1041"]')).toHaveCount(0);
}
const customerFilter = (page: Page) =>
  page.locator('[data-action="menu:customer"]');
const eyebrow = (page: Page) => page.locator(".editor .eyebrow");

test("the case picker opens a case the list filter hides and leaves the filters alone", async ({
  page,
}) => {
  await storeGate(page, "g3-cpe-duel-jump");
  await withDemo(page, async () => {
    await filterToLindenwerk(page);
    await click(page, "menu:open-case");
    await expect(page.locator('[data-action^="open-case:"]')).toHaveText([
      /V-1042\s*Wartung Standort Nord/,
      /V-1041\s*Zugang für Einkauf einrichten/,
      /V-1039/,
      /V-1037/,
      /V-1035/,
    ]);
    await click(page, "open-case:V-1041");
    await expect(eyebrow(page)).toContainText("V-1041");
    await expect(page.locator('[data-action^="open-case:"]')).toHaveCount(0);
    await expect(customerFilter(page)).toContainText("Lindenwerk");
    await expect(page.locator('[data-action^="case:"]')).toHaveCount(1);
    await expect(page.getByText("1 von 5 Vorgängen")).toBeVisible();
  });
});

test("the case picker keeps an unsaved draft and reaches the cases page from another page", async ({
  page,
}) => {
  await storeGate(page, "g3-cpe-duel-jump");
  await withDemo(page, async () => {
    await filterToLindenwerk(page);
    await click(page, "menu:open-case");
    await click(page, "open-case:V-1041");
    await click(page, "priority:Hoch");
    await click(page, "menu:open-case");
    await click(page, "open-case:V-1039");
    await expect(eyebrow(page)).toContainText("V-1041");
    await expect(page.locator(".editor-footer [role=status]")).toHaveText(
      "Bitte den offenen Entwurf zuerst speichern oder verwerfen.",
    );
    await expect(
      page.locator('[data-action="priority:Hoch"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await click(page, "discard");
    await click(page, "nav:reports");
    await expect(eyebrow(page)).toHaveCount(0);
    await click(page, "menu:open-case");
    await click(page, "open-case:V-1039");
    await expect(page).toHaveURL(/#cases$/);
    await expect(eyebrow(page)).toContainText("V-1039");
    await expect(customerFilter(page)).toContainText("Lindenwerk");
  });
});

test("the default gate shows the case picker", async ({ page }) => {
  await withDemo(page, async () => {
    await expect(page.locator('[data-action="menu:open-case"]')).toHaveCount(1);
  });
});

for (const gate of ["g3-cpe-duel", "g3-compact-plan-effect"] as const)
  test(`no case picker under ${gate}`, async ({ page }) => {
    await storeGate(page, gate satisfies GateName);
    await withDemo(page, async () => {
      await expect(page.locator('[data-action="nav:cases"]')).toBeVisible();
      await expect(page.locator('[data-action="menu:open-case"]')).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: /Vorgang öffnen/ }),
      ).toHaveCount(0);
    });
  });

test("Jev opens a case the list filter hides through the case picker", async ({
  page,
}) => {
  await storeGate(page, "g3-cpe-duel-jump");
  await withLive(
    page,
    ["menu:open-case", "open-case:V-1041", "priority:Hoch", "save"],
    async (store, _held, _arrived, snapshots, _o, _a, texts) => {
      await filterToLindenwerk(page);
      await start(page, "1041 auf hoch, lindenwerk-filter bitte stehen lassen");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(
        store.snapshot().cases.find((c) => c.id === "V-1041")?.priority,
      ).toBe("Hoch");
      await expect(customerFilter(page)).toContainText("Lindenwerk");
      expect(snapshots[0]).toContain("menu:open-case");
      expect(snapshots[0]).not.toContain("case:V-1041");
      expect(snapshots[1]).toContain("open-case:V-1041");
      expect(texts[1]?.["open-case:V-1041"]).toContain(
        "works even when the list filter hides it",
      );
      expect(texts[1]?.["open-case:V-1041"]).toContain(
        "the case list filters hide it",
      );
    },
  );
});
