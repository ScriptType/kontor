import { test, expect } from "@playwright/test";
test("demo form, responsive results and recovery from transport failure", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rpcHttp: string[] = [];
  let frames = 0;
  let connections = 0;
  let failNextMessage = false;
  page.on("request", (request) => {
    if (
      ["fetch", "xhr"].includes(request.resourceType()) &&
      new URL(request.url()).pathname.startsWith("/rpc")
    )
      rpcHttp.push(request.url());
  });
  await page.routeWebSocket("**/rpc", (socket) => {
    connections++;
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      frames++;
      if (failNextMessage) {
        failNextMessage = false;
        server.close();
        socket.close({ code: 1011, reason: "Test disconnect" });
      } else server.send(message);
    });
  });
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
  expect(connections).toBe(1);
  failNextMessage = true;
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
  expect(connections).toBe(2);
  expect(frames).toBeGreaterThanOrEqual(4);
  expect(rpcHttp).toEqual([]);
  expect(errors).toEqual([]);
});

test("initial connection failure leaves a usable form and recovers on submit", async ({
  page,
}) => {
  let rejectFirst = true;
  await page.routeWebSocket("**/rpc", (socket) => {
    if (rejectFirst) {
      rejectFirst = false;
      socket.close({ code: 1011, reason: "Unavailable" });
    } else socket.connectToServer();
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("nicht erreichbar");
  await expect(
    page.getByRole("button", { name: "Antworten anzeigen" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Antworten anzeigen" }).click();
  await expect(page.locator("article")).toHaveCount(3);
  await expect(page.getByText("Demo · lokal")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
