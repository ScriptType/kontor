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
    async (store, _held, _arrived, snapshots, observations) => {
      const before = store.snapshot();
      await start(
        page,
        "Setze V-1041 auf Priorität Hoch, entferne den Termin und speichere. Öffne V-1035 wieder, setze Priorität Hoch und speichere.",
      );
      await expect(page.locator(".activity-label")).toContainText(
        "Jev meldet",
      );
      expect(store.snapshot().revision).toBe(2);
      expect(store.snapshot().cases.find((c) => c.id === "V-1041")).toEqual(
        {
          ...before.cases.find((c) => c.id === "V-1041"),
          priority: "Hoch",
          appointment: null,
        },
      );
      expect(store.snapshot().cases.find((c) => c.id === "V-1035")).toEqual(
        {
          ...before.cases.find((c) => c.id === "V-1035"),
          priority: "Hoch",
          status: "open",
        },
      );
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
        availableActions: expect.arrayContaining([
          expect.objectContaining({
            id: "save",
            effect: expect.stringContaining(
              "Priorität von Normal auf Hoch",
            ),
          }),
          expect.objectContaining({
            id: "discard",
            effect: expect.stringContaining(
              "Priorität von Normal auf Hoch",
            ),
          }),
          expect.objectContaining({
            id: "save",
            effect: expect.stringContaining("auf kein Termin"),
          }),
        ]),
      });
      expect(observations[7]).toMatchObject({
        currentFacts: {
          revision: 1,
          selected: { status: "done", priority: "Normal" },
          draft: { status: "open", priority: "Hoch" },
        },
        availableActions: expect.arrayContaining([
          expect.objectContaining({
            id: "save",
            effect: expect.stringContaining(
              "Status von erledigt auf offen",
            ),
          }),
        ]),
      });
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
      await expect(page.locator(".activity-label")).toContainText(
        "Jev meldet",
      );
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
