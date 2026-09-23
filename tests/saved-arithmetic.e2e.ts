import { test, expect } from "@playwright/test";
import { start, withLive } from "./live-fixture.js";

const minutes = (snapshot: string[] | undefined) =>
  snapshot?.filter((id) => id.startsWith("field:minutes:"));

test("after the run saves a value, the next sum builds on it", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1041", "field:minutes:20", "save", "field:minutes:35", "save"],
    async (store, _held, _arrived, snapshots, _o, _a, choiceTexts) => {
      await start(
        page,
        "1041 arbeitszeit auf 20 und speichern, dann noch 15 dazu und speichern",
      );
      await expect.poll(() => snapshots.length).toBeGreaterThan(3);
      expect(minutes(snapshots[1])).toContain("field:minutes:60");
      expect(minutes(snapshots[3])).toContain("field:minutes:35");
      expect(minutes(snapshots[3])).not.toContain("field:minutes:60");
      expect(choiceTexts[3]?.["field:minutes:35"]).toContain(
        "sum: saved 20 plus 15 from the request = 35",
      );
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(minutes(snapshots[5])).toContain("field:minutes:15");
      expect(minutes(snapshots[5])).not.toContain("field:minutes:50");
      expect(
        store.snapshot().cases.find((c) => c.id === "V-1041")?.minutes,
      ).toBe(35);
    },
  );
});

test("after the run saves a sum, the same number is not added again", async ({
  page,
}) => {
  await withLive(
    page,
    ["case:V-1041", "field:minutes:60", "save"],
    async (store, _held, _arrived, snapshots) => {
      await start(page, "1041 noch 15 min dazu und speichern");
      await expect(page.locator(".activity-label")).toContainText("Jev meldet");
      expect(minutes(snapshots[1])).toContain("field:minutes:60");
      expect(minutes(snapshots[3])).toContain("field:minutes:15");
      expect(minutes(snapshots[3])).not.toContain("field:minutes:75");
      expect(
        store.snapshot().cases.find((c) => c.id === "V-1041")?.minutes,
      ).toBe(60);
    },
  );
});
