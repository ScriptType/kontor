import { test, expect } from "@playwright/test";
import { start, withLive } from "./live-fixture.js";

test("same technician uses the visible handler without claiming an unsaved draft", async ({ page }) => {
  await withLive(page, ["case:V-1041", "menu:technician", "technician:jonas"], async (store) => {
    const before = store.snapshot();
    await start(page, "Weise V-1041 erneut Jonas zu.");
    await expect(page.locator(".activity-label")).toContainText("Jev meldet");
    await expect(page.getByText("Ungespeicherter Entwurf", { exact: true })).toHaveCount(0);
    expect(store.snapshot()).toEqual(before);
  });
});
