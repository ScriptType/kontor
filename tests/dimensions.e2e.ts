import { test, expect, type Page } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { WorkspaceStore } from "../server/workspace-store.js";
import { actionEffects } from "../shared/dimensions.js";
import { storeGate } from "./live-fixture.js";

async function renderedIds(page: Page) {
  return page.evaluate(() => [
    ...Array.from(document.querySelectorAll("[data-action]"), (element) =>
      element.getAttribute("data-action"),
    ),
    ...Array.from(
      document.querySelectorAll("[data-field]"),
      (element) => `field:${element.getAttribute("data-field")}:1`,
    ),
  ]);
}

test("every rendered action and field maps to a dimension or an explicit entry", async ({
  page,
}) => {
  await storeGate(page, "g3-cpe-duel-jump");
  const app = createApp({ mode: "demo" }, undefined, new WorkspaceStore());
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    const ids = new Set<string | null>();
    const collect = async () => {
      for (const id of await renderedIds(page)) ids.add(id);
    };
    for (const menu of [
      "menu:customer",
      "menu:filter-technician",
      "menu:open-case",
    ]) {
      const button = page.locator(`[data-action="${menu}"]`);
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await collect();
    }
    for (const caseId of ["V-1041", "V-1035"]) {
      await page.locator(`[data-action="case:${caseId}"]`).click();
      await expect(page.locator(".editor .eyebrow")).toContainText(caseId);
      await page.locator('[data-action="menu:technician"]').click();
      await collect();
    }
    for (const nav of ["nav:customers", "nav:team", "nav:reports"]) {
      await page.locator(`[data-action="${nav}"]`).click();
      await collect();
    }
    expect([...ids]).toContain("open-case:V-1041");
    expect(ids.size).toBeGreaterThan(30);
    expect(
      [...ids].filter((id) => id === null || actionEffects(id) === null),
    ).toEqual([]);
  } finally {
    await app.close();
  }
});
