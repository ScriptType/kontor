import { test, expect } from "@playwright/test";
import { start, withLive } from "./live-fixture.js";

test("Jev uses visible draft controls for priority, appointment removal and reopening with complete save effects", async ({
  page,
}) => {
  await withLive(
    page,
    [
      "case:V-1041",
      "priority:Hoch",
      "remove-appointment",
      "save",
      "case:V-1035",
      "reopen",
      "priority:Hoch",
      "save",
    ],
    async (
      store,
      _held,
      _arrived,
      snapshots,
      observations,
      _assessed,
      choiceTexts,
    ) => {
      const before = store.snapshot();
      await start(
        page,
        "Setze V-1041 auf Priorität Hoch, entferne den Termin und speichere. Öffne V-1035 wieder, setze Priorität Hoch und speichere.",
      );
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(store.snapshot().revision).toBe(2);
      expect(store.snapshot().cases.find((c) => c.id === "V-1041")).toEqual({
        ...before.cases.find((c) => c.id === "V-1041"),
        priority: "Hoch",
        appointment: null,
      });
      expect(store.snapshot().cases.find((c) => c.id === "V-1035")).toEqual({
        ...before.cases.find((c) => c.id === "V-1035"),
        priority: "Hoch",
        status: "open",
      });
      expect(snapshots[1]).toContain("priority:Hoch");
      expect(snapshots[1]).not.toContain("priority:Normal");
      expect(snapshots[1]).toContain("remove-appointment");
      expect(snapshots[2]).not.toContain("priority:Hoch");
      expect(snapshots[3]).not.toContain("remove-appointment");
      expect(snapshots[5]).toContain("reopen");
      expect(snapshots[5]).not.toContain("complete");
      expect(snapshots[6]).not.toContain("reopen");
      expect(snapshots[6]).toContain("complete");
      expect(observations[3]).toMatchObject({
        currentFacts: {
          revision: 0,
          selected: {
            priority: "Normal",
            appointment: before.cases[1]?.appointment,
          },
          draft: { priority: "Hoch", appointment: null },
        },
      });
      expect(choiceTexts[3]).toMatchObject({
        save: expect.stringContaining("priority Normal → Hoch"),
        discard: expect.stringContaining("priority Normal → Hoch"),
      });
      expect(choiceTexts[3]?.["save"]).toMatch(/appointment [^;]+ → none/);
      expect(observations[7]).toMatchObject({
        currentFacts: {
          revision: 1,
          selected: { status: "done", priority: "Normal" },
          draft: { status: "open", priority: "Hoch" },
        },
      });
      expect(choiceTexts[7]?.["save"]).toContain("status done → open");
    },
  );
});

test("Jev sees complete combined filters and only mounted menu choices, then replaces filters through drilldowns", async ({
  page,
}) => {
  const sequence = [
    "menu:customer",
    "customer:nord",
    "menu:filter-technician",
    "filter-technician:lea",
    "filter:open",
    "filter:done",
    "filter:reset",
    "nav:team",
    "technician-cases:mara",
    "nav:reports",
    "status-cases:done",
    "nav:customers",
    "customer-cases:hafen",
  ];
  await withLive(
    page,
    sequence,
    async (store, _held, _arrived, snapshots, observations) => {
      const before = store.snapshot();
      await page.getByRole("searchbox").fill("Süd");
      await start(
        page,
        "Filtere Nordwerk, Lea und offene Vorgänge, dann erledigte. Setze Filter zurück. Zeige Maras offene Vorgänge, danach erledigte aus Berichte und dann alle von Hafen.",
      );
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(store.snapshot()).toEqual(before);
      expect(snapshots[0]).toContain("menu:customer");
      expect(snapshots[0]).toContain("menu:filter-technician");
      expect(snapshots[0]).not.toContain("customer:nord");
      expect(snapshots[0]).not.toContain("filter-technician:lea");
      expect(snapshots[0]).not.toContain("filter:all");
      expect(snapshots[1]).toContain("customer:nord");
      expect(snapshots[2]).not.toContain("customer:nord");
      expect(snapshots[3]).toContain("filter-technician:lea");
      expect(snapshots[3]).not.toContain("technician:lea");
      expect(snapshots[4]).not.toContain("filter-technician:lea");
      expect(snapshots[5]).not.toContain("filter:open");
      const filters = {
        customerId: "nord",
        technicianId: "lea",
        status: "open",
        search: "Süd",
      };
      expect(observations[5]).toMatchObject({
        currentFacts: {
          filters,
          visibleCases: [expect.objectContaining({ id: "V-1039" })],
        },
        observedSteps: expect.arrayContaining([
          expect.objectContaining({
            action: expect.objectContaining({ id: "filter:open" }),
            after: expect.objectContaining({ filters }),
          }),
        ]),
      });
      expect(observations[6]).toMatchObject({
        currentFacts: {
          filters: { ...filters, status: "done" },
          visibleCases: [],
        },
      });
      expect(observations[7]).toMatchObject({
        currentFacts: {
          filters: {
            customerId: null,
            technicianId: null,
            status: "all",
            search: "",
          },
        },
      });
      expect(observations[9]).toMatchObject({
        currentFacts: {
          filters: {
            customerId: null,
            technicianId: "mara",
            status: "open",
            search: "",
          },
          visibleCases: [expect.objectContaining({ id: "V-1037" })],
        },
      });
      expect(observations[11]).toMatchObject({
        currentFacts: {
          filters: {
            customerId: null,
            technicianId: null,
            status: "done",
            search: "",
          },
          visibleCases: [expect.objectContaining({ id: "V-1035" })],
        },
      });
      expect(observations[13]).toMatchObject({
        currentFacts: {
          filters: {
            customerId: "hafen",
            technicianId: null,
            status: "all",
            search: "",
          },
          visibleCases: [
            expect.objectContaining({ id: "V-1041" }),
            expect.objectContaining({ id: "V-1035" }),
          ],
        },
      });
    },
  );
});

test("the assignee options say who is available at the drafted appointment", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1042", "field:appointment:2026-09-24T10:00", "menu:technician"],
    async (
      _store,
      _held,
      _arrived,
      _snapshots,
      _observations,
      _assessed,
      choiceTexts,
    ) => {
      await start(
        page,
        "Setze V-1042 auf 2026-09-24 10:00 und setze jemand anderen ein, der dann frei ist.",
      );
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(choiceTexts[2]?.["menu:technician"]).toContain(
        "assignee is Jonas Weber; available for V-1042 at 2026-09-24 10:00: Lea Sommer; busy then: Jonas Weber (current) (V-1041); lacking skill Elektro: Mara Schulz",
      );
      expect(choiceTexts[3]?.["technician:lea"]).toContain(
        "assignee Jonas Weber → Lea Sommer; Lea Sommer is available",
      );
      expect(choiceTexts[3]?.["technician:jonas"]).toContain(
        "Jonas Weber is already the assignee; no change; Jonas Weber is busy then with V-1041",
      );
      expect(choiceTexts[3]).not.toHaveProperty("technician:mara");
      const menu = page.locator('[data-action="menu:technician"]');
      if ((await menu.getAttribute("aria-expanded")) !== "true")
        await menu.click();
      await expect(
        page.locator('[data-action="technician:lea"]'),
      ).toContainText("Elektro, Service · verfügbar");
      await expect(
        page.locator('[data-action="technician:jonas"]'),
      ).toContainText("Elektro, Service · belegt durch V-1041");
      await expect(
        page.locator('[data-action="technician:mara"]'),
      ).toContainText("Service · ohne Qualifikation Elektro");
    },
  );
});

test("without an appointment the assignee options name the qualified technicians and say times are not checked", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1042", "menu:technician"],
    async (
      _store,
      _held,
      _arrived,
      _snapshots,
      _observations,
      _assessed,
      choiceTexts,
    ) => {
      await start(page, "Setze für V-1042 jemand anderen ein.");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(choiceTexts[1]?.["menu:technician"]).toContain(
        "assignee is Jonas Weber; qualified for V-1042 (skill Elektro; no appointment in the draft, times not checked): Lea Sommer, Jonas Weber (current); lacking skill Elektro: Mara Schulz",
      );
      expect(choiceTexts[2]?.["technician:lea"]).toContain(
        "assignee Jonas Weber → Lea Sommer; no appointment in the draft, times not checked",
      );
      const menu = page.locator('[data-action="menu:technician"]');
      if ((await menu.getAttribute("aria-expanded")) !== "true")
        await menu.click();
      await expect(
        page.locator('[data-action="technician:lea"]'),
      ).toContainText("Elektro, Service");
      await expect(
        page.locator('[data-action="technician:lea"]'),
      ).not.toContainText("verfügbar");
      await expect(
        page.locator('[data-action="technician:mara"]'),
      ).toContainText("Service · ohne Qualifikation Elektro");
    },
  );
});
