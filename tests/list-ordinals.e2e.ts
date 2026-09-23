import { test, expect } from "@playwright/test";
import { start, withLive } from "./live-fixture.js";

const request =
  "zeig die offenen vorgänge von jonas weber.\nWähle den ersten aus und gib den lea";
const hintsOf = (observation: unknown) =>
  (observation as { requestHints?: { listOrdinals?: unknown } }).requestHints;

for (const run of [
  {
    opened: "case:V-1042",
    bound: [{ mention: "den ersten", caseId: "V-1042", openedAtRow: 1 }],
  },
  { opened: "case:V-1041", bound: undefined },
] as const)
  test(`opening ${run.opened} from Jonas's list ${run.bound ? "binds" : "does not bind"} 'den ersten'`, async ({
    page,
  }) => {
    const sequence = [
      "menu:filter-technician",
      "filter-technician:jonas",
      run.opened,
    ];
    await withLive(
      page,
      sequence,
      async (_store, _held, _arrived, _snapshots, observations) => {
        await start(page, request);
        await expect(page.locator(".choice-review")).toBeVisible();
        expect(observations).toHaveLength(4);
        for (const observation of observations.slice(0, 3))
          expect(hintsOf(observation)?.listOrdinals).toBeUndefined();
        expect(hintsOf(observations[3])?.listOrdinals).toEqual(run.bound);
      },
      {
        nextAnswer: (index) => ({
          choice: sequence[index] ?? "abstain",
          confidence: 1,
        }),
      },
    );
  });
