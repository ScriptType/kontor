import { test, expect } from "@playwright/test";
import { start, withLive } from "./live-fixture.js";

const request =
  "zeig die offenen vorgänge von jonas weber.\nWähle den ersten aus und gib den lea";
const hintsOf = (observation: unknown) =>
  (observation as { requestHints?: { listOrdinals?: unknown } }).requestHints;
const bindsFirstRow = [
  { mention: "den ersten", caseId: "V-1042", openedAtRow: 1 },
];

for (const run of [
  { opens: ["case:V-1042"], bound: bindsFirstRow },
  { opens: ["case:V-1041"], bound: undefined },
  { opens: ["menu:open-case", "open-case:V-1042"], bound: bindsFirstRow },
  { opens: ["menu:open-case", "open-case:V-1039"], bound: undefined },
] as const)
  test(`opening ${run.opens.join(" > ")} from Jonas's list ${run.bound ? "binds" : "does not bind"} 'den ersten'`, async ({
    page,
  }) => {
    const sequence = [
      "menu:filter-technician",
      "filter-technician:jonas",
      ...run.opens,
    ];
    await withLive(
      page,
      sequence,
      async (_store, _held, _arrived, _snapshots, observations) => {
        await start(page, request);
        await expect(page.locator(".choice-review")).toBeVisible();
        expect(observations).toHaveLength(sequence.length + 1);
        for (const observation of observations.slice(0, -1))
          expect(hintsOf(observation)?.listOrdinals).toBeUndefined();
        expect(hintsOf(observations.at(-1))?.listOrdinals).toEqual(run.bound);
      },
      {
        nextAnswer: (index) => ({
          choice: sequence[index] ?? "abstain",
          confidence: 1,
        }),
      },
    );
  });
