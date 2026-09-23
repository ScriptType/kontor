import { test, expect, type Page } from "@playwright/test";
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
