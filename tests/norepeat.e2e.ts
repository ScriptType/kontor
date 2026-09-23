import { test, expect } from "@playwright/test";
import { z } from "zod";
import { start, storeGate, withLive } from "./live-fixture.js";

for (const run of [
  { gate: "g3-cpe-duel-nr", offeredAgain: false },
  { gate: "g3-cpe-duel", offeredAgain: true },
] as const)
  test(`${run.gate}: opening another case over an unsaved draft ${run.offeredAgain ? "stays" : "is no longer"} offered`, async ({
    page,
  }) => {
    await storeGate(page, run.gate);
    await withLive(
      page,
      [
        "case:V-1041",
        "menu:technician",
        "technician:lea",
        "case:V-1042",
        "case:V-1042",
        "done",
      ],
      async (_store, _held, _arrived, snapshots) => {
        await start(page, "Gib V-1041 an Lea, dann öffne V-1042.");
        await expect.poll(() => snapshots.length).toBe(6);
        const history = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}")
              .history[0],
        );
        // The first refusal changes the message; the second changes nothing.
        expect(
          z
            .array(
              z.object({
                action: z.object({ id: z.string() }),
                outcome: z.string(),
              }),
            )
            .parse(history.steps)
            .slice(3)
            .map((step) => [step.action.id, step.outcome]),
        ).toEqual([
          ["case:V-1042", "changed"],
          ["case:V-1042", "unchanged"],
        ]);
        expect(snapshots[4]).toContain("case:V-1042");
        expect(snapshots[5]?.includes("case:V-1042")).toBe(run.offeredAgain);
        expect(snapshots[5]).toContain("save");
        expect(snapshots[5]).toContain("done");
      },
    );
  });
