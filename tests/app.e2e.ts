import { test, expect } from "@playwright/test";
test("demo form, responsive results and recovery from transport failure", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Demo · lokal")).toBeVisible();
  await expect(
    page.getByText(/Es findet keine KI-Auswertung statt/),
  ).toBeVisible();
  await page.getByLabel("Dein Text").fill("Bitte überprüfe diese Nachricht.");
  await page.getByRole("button", { name: "Antworten anzeigen" }).click();
  await expect(
    page.getByRole("heading", { name: "Antworten", exact: true }),
  ).toBeVisible();
  await expect(page.locator("article")).toHaveCount(3);
  await expect(page.locator("article").nth(1).locator(".value")).toContainText(
    "1,7",
  );
  await expect(page.locator("article").nth(2).locator(".value")).toContainText(
    "91",
  );
  await page.route("**/rpc/evaluate", (route) => route.abort(), { times: 1 });
  await page.getByRole("button", { name: "Antworten anzeigen" }).click();
  await expect(page.getByRole("alert")).toContainText("fehlgeschlagen");
  await page.getByRole("button", { name: "Antworten anzeigen" }).click();
  await expect(page.locator("article")).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Dein Text").fill("   ");
  await expect(
    page.getByRole("button", { name: "Antworten anzeigen" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
