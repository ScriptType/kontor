import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { WorkspaceStore } from "../server/workspace-store.js";

test("the reports page opens a named case on the case list and keeps the filters", async ({
  page,
}) => {
  const app = createApp({ mode: "demo" }, undefined, new WorkspaceStore());
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator('[data-action="filter:open"]').click();
    await page.locator('[data-action="menu:customer"]').click();
    await page.locator('[data-action="customer:nord"]').click();
    await page.locator('[data-action="nav:reports"]').click();
    const byCustomer = page.getByRole("region", {
      name: "Arbeitszeit nach Kunde",
    });
    for (const id of ["V-1042", "V-1041", "V-1039", "V-1037", "V-1035"])
      await expect(
        byCustomer.locator(`[data-action="case:${id}"]`),
      ).toBeVisible();
    await byCustomer.locator('[data-action="case:V-1041"]').click();
    await expect(page).toHaveURL(/#cases$/);
    await expect(page.locator(".editor .eyebrow")).toContainText("V-1041");
    await expect(page.locator('[data-action="filter:open"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator('[data-action="menu:customer"]')).toContainText(
      "Nordwerk",
    );
  } finally {
    await app.close();
  }
});
