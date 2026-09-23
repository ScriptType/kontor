import { test, expect, type Browser, type Page } from "@playwright/test";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { demos } from "../shared/command.js";
import {
  answerConfirmations,
  applyStart,
  evalContext,
  readEnd,
  replay,
  runSample,
  seededStore,
} from "../scripts/jev-eval/harness.js";
import { judge, type Stop } from "../scripts/jev-eval/judge.js";
import {
  regressionScenarios,
  scenario,
  type Scenario,
} from "../scripts/jev-eval/scenarios.js";
import { scriptedProvider } from "./live-fixture.js";
/** Jev reads the day of the request "am 06.09" and no time. */
const readSixthOfSeptember = {
  "f0.mode": "absolute",
  "f0.month": "9",
  "f0.day": "6",
  "f0.year": "none",
};

const done: Stop = {
  kind: "done",
  message: "Jev meldet den Auftrag als erledigt",
};
const byId = (id: string) => {
  const found = regressionScenarios().find((s) => s.id === id);
  if (!found) throw new Error(id);
  return found;
};
async function withApp(
  page: Page,
  s: Scenario,
  run: (store: ReturnType<typeof seededStore>) => Promise<void>,
) {
  const store = seededStore(s.start);
  const app = createApp({ mode: "demo" }, undefined, store);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await expect(page.locator("tbody tr")).toHaveCount(5);
    await run(store);
  } finally {
    await app.close();
  }
}

test("a demo request runs through the real UI and is judged magic without provider calls", async ({
  browser,
}) => {
  const result = await runSample({
    browser,
    config: { mode: "demo" },
    scenario: scenario({
      id: "demo-assign",
      source: "use-case",
      request: demos[2],
      intent: {
        cases: { "V-1042": { technician: "lea" } },
        flags: { save: true },
      },
    }),
    sample: 1,
    variant: "test",
    saveMode: "auto",
    budget: { used: 0, limit: 0 },
  });
  expect(result.outcome).toBe("magic");
  expect(result.calls).toBe(0);
  expect(result.steps).toEqual([
    "case:V-1042:changed",
    "menu:technician:changed",
    "technician:lea:changed",
    "save:changed",
  ]);
  expect(result.observed?.receipts.map((r) => r.saved.technicianId)).toEqual([
    "lea",
  ]);
});

const appointmentRequest =
  "Setze V-1042 auf einen am 06.09.2026 und setzt wen anderes vom team dort ein als gerade gegeben der verfügbar ist";
const answerSample = (browser: Browser, s: Scenario) =>
  runSample({
    browser,
    config: { mode: "live", apiKey: "test", model: "jev-latest" },
    scenario: s,
    sample: 1,
    variant: "test",
    saveMode: "auto",
    budget: { used: 0, limit: 40 },
    fetch: scriptedProvider([], {
      nextAnswer: (index) => ({
        choice:
          [
            "case:V-1042",
            "menu:technician",
            "technician:lea",
            "ask:appointment",
            "save",
            "field:appointment:2026-09-06T10:00",
            "save",
          ][index] ?? "done",
        confidence: 1,
      }),
      read: readSixthOfSeptember,
    }).fetch,
  });

test("a value question is answered in the panel like a person would: the prefilled date stays, the time is typed, the run goes on", async ({
  browser,
}) => {
  const result = await answerSample(
    browser,
    scenario({
      id: "answer-appointment",
      source: "authored",
      request: appointmentRequest,
      intent: {
        cases: {
          "V-1042": { technician: "lea", appointmentStart: "2026-09-06T10:00" },
        },
        flags: { save: true },
      },
    }),
  );
  expect(result.outcome).toBe("correct-after-answers");
  expect(result.questions).toBe(1);
  expect(result.stops).toEqual([
    {
      kind: "answer",
      message: expect.stringContaining(
        "Datum aus dem Auftrag: 06.09.2026. Bitte die Uhrzeit ergänzen.",
      ),
      dimension: "appointmentStart",
      caseId: "V-1042",
      value: "2026-09-06T10:00",
    },
    expect.objectContaining({ kind: "done" }),
  ]);
  expect(result.stops[0]?.message).not.toContain("kept prefilled");
  expect(result.observed?.records["V-1042"]).toMatchObject({
    technicianId: "lea",
    appointment: { start: "2026-09-06T10:00:00", minutes: 60 },
  });
});

test("a prefilled part that disagrees with the scenario is kept, named in the stop, and judged by the end it leads to", async ({
  browser,
}) => {
  const result = await answerSample(
    browser,
    scenario({
      id: "answer-other-day",
      source: "authored",
      request: appointmentRequest,
      intent: {
        cases: {
          "V-1042": { technician: "lea", appointmentStart: "2026-09-07T10:00" },
        },
        flags: { save: true },
      },
    }),
  );
  expect(result.outcome).toBe("asked-wrong");
  expect(result.stops[0]).toEqual({
    kind: "answer",
    message: expect.stringContaining(
      "kept prefilled date 2026-09-06, scenario 2026-09-07",
    ),
    dimension: "appointmentStart",
    caseId: "V-1042",
    value: "2026-09-06T10:00",
  });
});

test("a value question without a single value in the scenario is left unanswered and ends the run", async ({
  browser,
}) => {
  const result = await answerSample(
    browser,
    scenario({
      id: "answer-moved",
      source: "authored",
      request: appointmentRequest,
      intent: {
        cases: { "V-1042": { appointmentStart: "2026-09-07T10:00" } },
        sequence: {
          "V-1042": [
            { appointmentStart: "2026-09-06T10:00" },
            { appointmentStart: "2026-09-07T10:00" },
          ],
        },
        flags: { save: true, sequence: true },
      },
    }),
  );
  expect(result.outcome).toBe("stopped-unanswered");
  expect(result.stops).toEqual([
    {
      kind: "input",
      message: expect.stringContaining("Antwort ausstehend"),
      dimension: "appointmentStart",
      caseId: "V-1042",
    },
  ]);
  expect(
    result.steps.some((step) => step.startsWith("field:appointment")),
  ).toBe(false);
  expect(result.observed?.receipts).toEqual([]);
});

const assignLea = scenario({
  id: "review-assign",
  source: "authored",
  request: "Weise V-1042 Lea Sommer zu und speichere.",
  intent: {
    cases: { "V-1042": { technician: "lea" } },
    flags: { save: true },
  },
});
const humanAssign = [
  "case:V-1042",
  "menu:technician",
  "technician:lea",
  "save",
];
/** Runs the human path with full confidence except the picks in `unsure`. */
const reviewSample = (
  browser: Browser,
  unsure: Record<
    number,
    { choice: string; probabilities: Record<string, number> }
  >,
  humanSteps?: string[],
  forbidCommit = false,
) =>
  runSample({
    browser,
    config: { mode: "live", apiKey: "test", model: "jev-latest" },
    scenario: assignLea,
    sample: 1,
    variant: "test",
    saveMode: "auto",
    budget: { used: 0, limit: 40 },
    answerReview: true,
    humanSteps,
    fetch: scriptedProvider([], {
      nextAnswer: (index) =>
        unsure[index]
          ? { ...unsure[index], confidence: 0.4 }
          : { choice: humanAssign[index] ?? "done", confidence: 1 },
      forbidCommit,
    }).fetch,
  });

test("a review is answered with the offered option on the human path and the run goes on", async ({
  browser,
}) => {
  const result = await reviewSample(
    browser,
    { 3: { choice: "save", probabilities: { save: 0.6, done: 0.4 } } },
    humanAssign,
  );
  expect(result.outcome).toBe("correct-after-answers");
  expect(result.questions).toBe(1);
  expect(result.reviewClicks).toBe(1);
  expect(result.stops).toEqual([
    {
      kind: "review-answer",
      message: expect.stringContaining("offered save, done · clicked save"),
      value: "save",
    },
    expect.objectContaining({ kind: "done" }),
  ]);
});

test("a forbidden step on the human path is run with Trotzdem ausführen in one click", async ({
  browser,
}) => {
  const result = await reviewSample(browser, {}, humanAssign, true);
  expect(result.outcome).toBe("correct-after-answers");
  expect(result.reviewClicks).toBe(1);
  expect(result.stops[0]).toEqual({
    kind: "review-answer",
    message: expect.stringContaining("clicked save with Trotzdem ausführen"),
    value: "save",
  });
});

test("a review is finished with done only once the state judges correct", async ({
  browser,
}) => {
  const result = await reviewSample(
    browser,
    { 4: { choice: "done", probabilities: { done: 0.6, save: 0.4 } } },
    humanAssign,
  );
  expect(result.outcome).toBe("correct-after-answers");
  expect(result.stops).toEqual([
    expect.objectContaining({ kind: "review-answer", value: "done" }),
    {
      kind: "done",
      message: "Vom Nutzer als erledigt abgeschlossen",
    },
  ]);
  const early = await reviewSample(browser, {
    3: { choice: "done", probabilities: { done: 0.6, save: 0.4 } },
  });
  expect(early.outcome).toBe("stopped-unanswered");
  expect(early.reviewClicks).toBe(0);
  expect(early.stops).toEqual([
    {
      kind: "review",
      message: expect.stringMatching(
        /offered done, save · no click: done: .*V-1042 was not saved.*; no human steps$/,
      ),
    },
  ]);
});

test("the repeat start state applies through the UI and reads back as its expected end", async ({
  page,
}) => {
  const repeat = byId("user-repeat");
  await withApp(page, repeat, async (store) => {
    await applyStart(page, repeat.start);
    const observed = await readEnd(
      page,
      store.snapshot(),
      store.snapshot(),
      store.receipts,
      [done],
    );
    expect(observed.page).toBe("reports");
    expect(observed.filters.customerId).toBe("nord");
    expect(observed.draft).toMatchObject({ caseId: "V-1041", dirty: false });
    expect(judge(repeat, observed)).toMatchObject({
      outcome: "magic",
      mismatches: [],
    });
  });
});

test("an unsaved draft is read from the editor after navigating away", async ({
  page,
}) => {
  const draft = byId("use-10");
  await withApp(page, draft, async (store) => {
    await page.locator('[data-action="case:V-1042"]').click();
    await page
      .getByRole("spinbutton", { name: "Arbeitszeit in Minuten", exact: true })
      .fill("25");
    await page.locator('[data-action="nav:team"]').click();
    const observed = await readEnd(
      page,
      store.snapshot(),
      store.snapshot(),
      store.receipts,
      [done],
    );
    expect(observed.draft).toMatchObject({ caseId: "V-1042", dirty: true });
    expect(judge(draft, { ...observed, page: "cases" })).toMatchObject({
      outcome: "magic",
      mismatches: [],
    });
    expect(judge(draft, observed).mismatches).toEqual([
      "page team, expected cases",
    ]);
  });
});

test("the run's coverage probability and checklist are read from the history when present", async ({
  page,
}) => {
  const s = byId("user-fresh");
  await withApp(page, s, async (store) => {
    const read = () =>
      readEnd(page, store.snapshot(), store.snapshot(), [], [done]);
    expect(await read()).toMatchObject({
      coverageProbability: null,
      checklist: null,
    });
    const checklist = { items: [{ id: "technician", done: true }] };
    await page.evaluate(
      (checklist) =>
        localStorage.setItem(
          "kontor-command-v1",
          JSON.stringify({
            version: 3,
            history: [{ steps: [], coverageProbability: 0.82, checklist }],
          }),
        ),
      checklist,
    );
    expect(await read()).toMatchObject({
      coverageProbability: 0.82,
      checklist,
    });
  });
});

test("the run's plan and votes are read from the history when present", async ({
  page,
}) => {
  const s = byId("user-fresh");
  await withApp(page, s, async (store) => {
    const read = () =>
      readEnd(page, store.snapshot(), store.snapshot(), [], [done]);
    expect(await read()).toMatchObject({ plan: null, votes: null });
    const plan = { cases: { "V-1041": { technician: "mara" } } };
    const votes = [
      { step: 0, choice: "case:V-1041", via: "pick", slot: "cases=V-1041" },
    ];
    await page.evaluate(
      (run) =>
        localStorage.setItem(
          "kontor-command-v1",
          JSON.stringify({ version: 3, history: [{ steps: [], ...run }] }),
        ),
      { plan, votes },
    );
    expect(await read()).toMatchObject({ plan, votes });
  });
});

test("confirmations are answered from the ground truth through data-confirm attributes", async ({
  page,
}) => {
  await page.setContent(`
    <section data-confirm-dimension="workedMinutes" data-confirm-case="V-1042">
      <button data-confirm-value="45">45</button><button data-confirm-value="30">30</button>
    </section>
    <section data-confirm-dimension="cases">
      <button data-confirm-value="V-1041">V-1041</button>
      <button data-confirm-value="V-1042">V-1042</button>
      <button data-confirm-submit>OK</button>
    </section>
    <section data-confirm-dimension="save" data-confirm-case="V-1041">
      <button data-confirm-value="yes">Ja</button><button data-confirm-value="no">Nein</button>
    </section>
    <section data-confirm-dimension="save" data-confirm-case="V-1042">
      <button data-confirm-value="yes">Ja</button><button data-confirm-value="no">Nein</button>
    </section>
    <section data-confirm-dimension="technician" data-confirm-case="V-1042">
      <button data-confirm-value="lea">Lea</button>
    </section>
    <script>
      window.clicked = [];
      document.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        const group = button.closest("[data-confirm-dimension]");
        const value = button.dataset.confirmValue ?? "submit";
        window.clicked.push(group.dataset.confirmDimension + "=" + value);
        if (group.dataset.confirmDimension !== "cases" || value === "submit") group.remove();
      });
    </script>`);
  const stops = await answerConfirmations(page, byId("use-13"));
  expect(
    stops.map(({ kind, dimension, value }) => ({ kind, dimension, value })),
  ).toEqual([
    { kind: "confirm", dimension: "workedMinutes", value: "30" },
    { kind: "confirm", dimension: "cases", value: ["V-1042"] },
    { kind: "confirm", dimension: "save", value: "no" },
    { kind: "confirm", dimension: "save", value: "yes" },
    { kind: "unanswerable", dimension: "technician", value: "unstated" },
  ]);
  expect(
    await page.evaluate(
      () => (window as unknown as { clicked: string[] }).clicked,
    ),
  ).toEqual([
    "workedMinutes=30",
    "cases=V-1042",
    "cases=submit",
    "save=no",
    "save=yes",
  ]);
});

test("the save mode is in local storage before the app loads", async ({
  browser,
}) => {
  const s = byId("user-fresh");
  const store = seededStore(s.start);
  const app = createApp({ mode: "demo" }, undefined, store);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const context = await evalContext(browser, "confirm");
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("kontor-jev-save-mode-v1") ?? "null"),
      ),
    ).toEqual({ version: 1, mode: "confirm" });
  } finally {
    await context.close();
    await app.close();
  }
});

test("replaying the human path of user-fresh reaches its expected end, a wrong value or an unreachable step does not", async ({
  browser,
}) => {
  const fresh = byId("user-fresh");
  const path = [
    { action: "case:V-1041" },
    { action: "menu:technician" },
    { action: "technician:mara" },
    { field: "minutes", value: "60" },
    { action: "save" },
    { action: "menu:customer" },
    { action: "customer:nord" },
    { action: "nav:reports" },
  ];
  expect(await replay({ browser, scenario: fresh, steps: path })).toEqual({
    id: "user-fresh",
    endCorrect: true,
    mismatches: [],
    unexpectedSaves: [],
    executed: [
      "case:V-1041",
      "menu:technician",
      "technician:mara",
      "field:minutes:60",
      "save",
      "menu:customer",
      "customer:nord",
      "nav:reports",
    ],
    failedStep: null,
  });
  const wrong = await replay({
    browser,
    scenario: fresh,
    steps: path.map((step) =>
      "field" in step ? { ...step, value: "1041" } : step,
    ),
  });
  expect(wrong).toMatchObject({
    endCorrect: false,
    mismatches: [
      "V-1041 saved minutes 1041, expected 60",
      "V-1041 saves miss an expected intermediate state",
    ],
    failedStep: null,
  });
  const closedMenu = await replay({
    browser,
    scenario: fresh,
    steps: [{ action: "technician:mara" }, ...path],
  });
  expect(closedMenu).toMatchObject({
    endCorrect: false,
    executed: [],
    failedStep: { index: 0, step: "technician:mara", reason: "not on screen" },
  });
});
