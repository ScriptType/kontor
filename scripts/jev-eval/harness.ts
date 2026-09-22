import { once } from "node:events";
import { expect, type Browser, type Page } from "@playwright/test";
import type { Fetch } from "@typesafe-ai/sdk";
import { z } from "zod";
import { createApp } from "../../server/app.js";
import type { Config } from "../../server/config.js";
import { WorkspaceStore } from "../../server/workspace-store.js";
import { actionEffects } from "../../shared/dimensions.js";
import {
  caseFiltersSchema,
  caseSchema,
  draftOf,
  pageSchema,
  type CaseDraft,
  type Page as View,
  type Receipt,
  type Save,
  type Workspace,
} from "../../shared/domain.js";
import { answerFor, judge, type Observed, type Stop } from "./judge.js";
import type { SampleResult } from "./report.js";
import { startWorkspace, type Scenario, type StartState } from "./scenarios.js";

export const confidencePercent = 75;
export const saveModes = ["auto", "confirm"] as const;
export type SaveMode = (typeof saveModes)[number];
const maxConfirmations = 12;
const running =
  /^(Bereit für deinen Auftrag|Jev wählt den nächsten sichtbaren Schritt|Schritt wird ausgeführt|Speicherergebnis wird geprüft)$/;

class RecordingStore extends WorkspaceStore {
  readonly receipts: Receipt[] = [];
  override save(input: Save): Receipt {
    const receipt = super.save(input);
    if (!this.receipts.some((r) => r.operationId === receipt.operationId))
      this.receipts.push(receipt);
    return receipt;
  }
}

export function seededStore(start: StartState) {
  const store = new RecordingStore(":memory:");
  for (const c of startWorkspace(start, store.snapshot()).cases)
    if (start.saved[c.id])
      store.save({
        operationId: crypto.randomUUID(),
        revision: store.snapshot().revision,
        caseId: c.id,
        draft: draftOf(c),
        actor: "manual",
      });
  store.receipts.length = 0;
  return store;
}

export async function applyStart(page: Page, start: StartState) {
  const click = (action: string) =>
    page.locator(`[data-action="${action}"]`).first().click();
  if (start.selectedCase) {
    await click(`case:${start.selectedCase}`);
    await expect(page.locator(".editor .eyebrow")).toContainText(
      start.selectedCase,
    );
  }
  if (start.filters.customerId) {
    await click("menu:customer");
    await click(`customer:${start.filters.customerId}`);
  }
  if (start.filters.technicianId) {
    await click("menu:filter-technician");
    await click(`filter-technician:${start.filters.technicianId}`);
  }
  if (start.filters.status !== "all")
    await click(`filter:${start.filters.status}`);
  if (start.filters.search)
    await page.locator("input.search").fill(start.filters.search);
  if (start.page !== "cases") {
    await click(`nav:${start.page}`);
    await expect(page.locator(`[data-region="${start.page}"]`)).toBeVisible();
  }
}

async function submit(page: Page, request: string) {
  await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
  await page.getByRole("textbox", { name: "Auftrag an Jev" }).fill(request);
  await page.getByRole("button", { name: /^Ausführen/ }).click();
}

async function awaitStop(page: Page, timeout: number): Promise<Stop> {
  const label = page.locator(".activity-label");
  try {
    await expect(label).not.toHaveText(running, { timeout });
    await expect(page.locator(".activity-dot.running")).toHaveCount(0, {
      timeout,
    });
  } catch {
    const stop = page.locator(".activity button.danger");
    if (await stop.count()) await stop.click();
    return { kind: "timeout", message: await label.innerText() };
  }
  const message = (await label.innerText()).trim();
  const pending = (await page.locator(".activity .text-button").innerText())
    .trim()
    .startsWith("Antworten");
  const detail = async () =>
    (
      await page
        .locator(".palette .answer-panel")
        .first()
        .innerText({ timeout: 2000 })
        .catch(() => message)
    )
      .replace(/\s+/g, " ")
      .slice(0, 400);
  if (/^(Jev meldet|Entwurf vorbereitet)/.test(message))
    return { kind: "done", message };
  if (pending)
    return {
      kind:
        message === "Antwort ausstehend"
          ? "input"
          : message === "Konkreten Schritt bestätigen"
            ? "approval"
            : "review",
      message: await detail(),
    };
  if (
    message.startsWith("Gestoppt") ||
    (await page.locator(".activity button", { hasText: "Fortsetzen" }).count())
  )
    return { kind: "error", message };
  return { kind: "blocked", message: await detail() };
}

export async function answerConfirmations(
  page: Page,
  scenario: Scenario,
): Promise<Stop[]> {
  const stops: Stop[] = [];
  for (let index = 0; index < maxConfirmations; index++) {
    const group = page.locator("[data-confirm-dimension]:visible").first();
    if (!(await group.count())) break;
    const dimension =
      (await group.getAttribute("data-confirm-dimension")) ?? "";
    const caseId = (await group.getAttribute("data-confirm-case")) ?? undefined;
    const truth = answerFor(scenario, dimension, caseId);
    const option = (value: string) =>
      group.locator(`[data-confirm-value=${JSON.stringify(value)}]`);
    const stop: Stop = {
      kind: "confirm",
      message: (await group.innerText()).replace(/\s+/g, " ").slice(0, 300),
      dimension,
      ...(caseId ? { caseId } : {}),
      ...(truth === null ? {} : { value: truth }),
    };
    const values = Array.isArray(truth) ? truth : truth === null ? [] : [truth];
    const missing = [];
    for (const value of values)
      if (!(await option(value).count())) missing.push(value);
    if (truth === null || missing.length) {
      stops.push({ ...stop, kind: "unanswerable" });
      break;
    }
    const handle = await group.elementHandle();
    for (const value of values) await option(value).click();
    if (Array.isArray(truth))
      await group.locator("[data-confirm-submit]").click();
    stops.push(stop);
    await handle?.waitForElementState("hidden", { timeout: 10000 });
  }
  return stops;
}

const viewOf = (page: Page) =>
  pageSchema.catch("cases").parse(new URL(page.url()).hash.slice(1));

const historySchema = z.object({
  history: z
    .array(
      z.object({
        coverageProbability: z.number().optional().catch(undefined),
        checklist: z.unknown().optional(),
        steps: z.array(
          z.object({
            action: z.object({ id: z.string() }),
            outcome: z.string(),
            after: z.string(),
          }),
        ),
      }),
    )
    .default([]),
});
type Run = {
  steps: string[];
  coverageProbability: number | null;
  checklist: unknown;
};
export async function readEnd(
  page: Page,
  workspace: Workspace,
  saved: Workspace,
  receipts: Receipt[],
  stops: Stop[],
): Promise<Observed & Run> {
  if (await page.locator(".palette").isVisible()) {
    await page.keyboard.press("Escape");
    await expect(page.locator(".palette")).toBeHidden();
  }
  const view = viewOf(page);
  if (view !== "cases") {
    await page.evaluate(() => {
      location.hash = "cases";
    });
    await expect(page.locator('[data-region="cases"]')).toBeVisible();
  }
  const text = async (selector: string) =>
    (await page.locator(selector).first().innerText()).trim();
  const byName = (rows: { id: string; name: string }[], label: string) =>
    rows.find((row) => label.includes(row.name))?.id ?? null;
  const pressed = async (prefix: string) =>
    (
      (await page
        .locator(`[data-action^="${prefix}:"][aria-pressed="true"]`)
        .first()
        .getAttribute("data-action")) ?? ""
    ).slice(prefix.length + 1);
  const status = caseFiltersSchema.shape.status.parse(await pressed("filter"));
  const filters = {
    customerId: byName(
      workspace.customers,
      await text('[data-action="menu:customer"]'),
    ),
    technicianId: byName(
      workspace.technicians,
      await text('[data-action="menu:filter-technician"]'),
    ),
    status,
    search: await page.locator("input.search").inputValue(),
  };
  let draft: Observed["draft"] = null;
  const detail = page.locator('[data-region^="case-detail:"]');
  if (await detail.count()) {
    const caseId = ((await detail.getAttribute("data-region")) ?? "").slice(
      "case-detail:".length,
    );
    const record = saved.cases.find((c) => c.id === caseId);
    const technicianId = byName(
      workspace.technicians,
      await text('[data-action="menu:technician"]'),
    );
    if (record && technicianId) {
      const scheduled = await page
        .locator('[data-action="remove-appointment"]')
        .count();
      const values: CaseDraft = {
        technicianId,
        minutes: Number(await page.locator("#minutes").inputValue()),
        appointment: scheduled
          ? {
              start: `${await page.locator("#appointment").inputValue()}:00`,
              minutes: Number(
                await page
                  .getByRole("spinbutton", { name: "Termindauer in Minuten" })
                  .inputValue(),
              ),
            }
          : null,
        status: (await page.locator('[data-action="reopen"]').count())
          ? "done"
          : "open",
        inspection: record.inspection,
        priority: caseSchema.shape.priority.parse(await pressed("priority")),
      };
      draft = {
        caseId,
        values,
        dirty: await page
          .locator(".editor-footer [role=status]")
          .evaluate((element) => element.classList.contains("unsaved")),
      };
    }
  }
  const stored = historySchema.parse(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}"),
    ),
  ).history[0];
  const steps = stored?.steps ?? [];
  return {
    page: view,
    filters,
    records: Object.fromEntries(saved.cases.map((c) => [c.id, draftOf(c)])),
    receipts: receipts.map((r) => ({
      caseId: r.caseId,
      saved: draftOf(r.saved),
    })),
    draft,
    pagesVisited: steps.flatMap((step) => {
      const parsed = pageSchema.safeParse(JSON.parse(step.after).page);
      return parsed.success ? [parsed.data as View] : [];
    }),
    stops,
    steps: steps.map((step) => `${step.action.id}:${step.outcome}`),
    coverageProbability: stored?.coverageProbability ?? null,
    checklist: stored?.checklist ?? null,
  };
}

async function serve(config: Config, store: WorkspaceStore, fetch?: Fetch) {
  const app = createApp(config, fetch, store);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return { url: `http://127.0.0.1:${address.port}`, close: () => app.close() };
}

export async function evalContext(browser: Browser, saveMode: SaveMode) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(
    ({ percent, mode }) => {
      localStorage.setItem(
        "kontor-jev-confidence-v1",
        JSON.stringify({ version: 1, percent }),
      );
      localStorage.setItem(
        "kontor-jev-save-mode-v1",
        JSON.stringify({ version: 1, mode }),
      );
    },
    { percent: confidencePercent, mode: saveMode },
  );
  return context;
}

export type Budget = { used: number; limit: number };
export type CallRecord = {
  question: string;
  choice: string | null;
  confidence: number | null;
  ms: number;
};
export async function runSample(options: {
  browser: Browser;
  config: Config;
  scenario: Scenario;
  sample: number;
  variant: string;
  saveMode: SaveMode;
  budget: Budget;
  maxCalls?: number;
  timeoutMs?: number;
}): Promise<
  SampleResult & { observed: Observed | null; callLog: CallRecord[] }
> {
  const { browser, config, scenario, budget } = options;
  const maxCalls = options.maxCalls ?? 40;
  const deadline = Date.now() + (options.timeoutMs ?? 300000);
  const store = seededStore(scenario.start);
  const workspace = store.snapshot();
  const callLog: CallRecord[] = [];
  const fetch: Fetch = async (url, init) => {
    if (budget.used >= budget.limit)
      throw new Error("Eval call budget exhausted");
    if (callLog.length >= maxCalls)
      throw new Error("Sample call limit reached");
    budget.used++;
    const began = Date.now();
    const record: CallRecord = {
      question: "",
      choice: null,
      confidence: null,
      ms: 0,
    };
    callLog.push(record);
    record.question = Object.keys(
      z
        .object({ questions: z.record(z.string(), z.unknown()) })
        .parse(JSON.parse(String(init?.body))).questions,
    ).join(",");
    const response = await globalThis.fetch(url, init);
    const answer = z
      .object({
        answers: z
          .record(
            z.string(),
            z.object({ choice: z.string(), confidence: z.number() }),
          )
          .optional(),
      })
      .safeParse(
        await response
          .clone()
          .json()
          .catch(() => null),
      );
    const first = answer.success
      ? Object.values(answer.data.answers ?? {})[0]
      : undefined;
    Object.assign(record, {
      choice: first?.choice ?? null,
      confidence: first?.confidence ?? null,
      ms: Date.now() - began,
    });
    return response;
  };
  const app = await serve(config, store, fetch);
  const context = await evalContext(browser, options.saveMode);
  const page = await context.newPage();
  const stops: Stop[] = [];
  let observed: (Observed & Run) | null = null;
  let error: string | null = null;
  let began = Date.now();
  let ended = began;
  try {
    await page.goto(app.url);
    await expect(page.locator("tbody tr")).toHaveCount(workspace.cases.length);
    await applyStart(page, scenario.start);
    began = Date.now();
    await submit(page, scenario.request);
    while (true) {
      const stop = await awaitStop(page, Math.max(1000, deadline - Date.now()));
      const confirmations = await answerConfirmations(page, scenario);
      stops.push(...confirmations);
      if (
        !confirmations.length ||
        confirmations.at(-1)?.kind === "unanswerable" ||
        stops.length > maxConfirmations
      ) {
        if (!confirmations.length) stops.push(stop);
        break;
      }
    }
    ended = Date.now();
    observed = await readEnd(
      page,
      workspace,
      store.snapshot(),
      store.receipts,
      stops,
    );
  } catch (cause) {
    ended = Date.now();
    error =
      cause instanceof Error
        ? (cause.message.split("\n")[0] ?? "")
        : String(cause);
    stops.push({ kind: "error", message: error });
  } finally {
    await context.close();
    await app.close();
  }
  const verdict = observed
    ? judge(scenario, observed)
    : {
        outcome: "error" as const,
        endCorrect: false,
        questions: 0,
        magicSaveCheck: false,
        mismatches: [],
        unexpectedSaves: [],
      };
  return {
    ...verdict,
    variant: options.variant,
    saveMode: options.saveMode,
    scenarioId: scenario.id,
    source: scenario.source,
    sample: options.sample,
    request: scenario.request,
    stops,
    steps: observed?.steps ?? [],
    coverageProbability: observed?.coverageProbability ?? null,
    unmappedActions: (observed?.steps ?? [])
      .map((step) => step.slice(0, step.lastIndexOf(":")))
      .filter((id) => actionEffects(id) === null),
    calls: callLog.length,
    wallMs: ended - began,
    error,
    observed,
    callLog,
  };
}

export const replayStepSchema = z.union([
  z.strictObject({ action: z.string().min(1) }),
  z.strictObject({ field: z.string().min(1), value: z.string() }),
]);
export type ReplayStep = z.infer<typeof replayStepSchema>;
export type Replay = {
  id: string;
  endCorrect: boolean;
  mismatches: string[];
  unexpectedSaves: string[];
  executed: string[];
  failedStep: { index: number; step: string; reason: string } | null;
};
const stepId = (step: ReplayStep) =>
  "action" in step ? step.action : `field:${step.field}:${step.value}`;

async function perform(page: Page, step: ReplayStep): Promise<string | null> {
  const selector =
    "action" in step
      ? `[data-action=${JSON.stringify(step.action)}]`
      : `[data-field=${JSON.stringify(step.field)}]`;
  const target = page
    .locator(`${selector}:not([disabled]):not([readonly])`)
    .filter({ visible: true })
    .first();
  if (!(await target.count()))
    return (await page.locator(selector).filter({ visible: true }).count())
      ? "disabled"
      : (await page.locator(selector).count())
        ? "not visible"
        : "not on screen";
  try {
    if ("action" in step) await target.click({ timeout: 5000 });
    else {
      await target.fill(step.value, { timeout: 5000 });
      await target.dispatchEvent("change");
    }
    await page.waitForFunction(
      () =>
        localStorage.getItem("kontor-save-v1") === null &&
        !document
          .querySelector(".editor-footer [role=status]")
          ?.textContent?.includes("Wird gespeichert"),
      undefined,
      { timeout: 10000 },
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    return null;
  } catch (error) {
    return error instanceof Error
      ? (error.message.split("\n")[0] ?? "")
      : String(error);
  }
}

export async function replay(options: {
  browser: Browser;
  scenario: Scenario;
  steps: ReplayStep[];
}): Promise<Replay> {
  const { scenario } = options;
  const store = seededStore(scenario.start);
  const workspace = store.snapshot();
  const app = await serve({ mode: "demo" }, store);
  const context = await evalContext(options.browser, "auto");
  try {
    const page = await context.newPage();
    await page.goto(app.url);
    await expect(page.locator("tbody tr")).toHaveCount(workspace.cases.length);
    await applyStart(page, scenario.start);
    const executed: string[] = [];
    const pagesVisited: View[] = [];
    let failedStep: Replay["failedStep"] = null;
    for (const [index, step] of options.steps.entries()) {
      const reason = await perform(page, step);
      if (reason) {
        failedStep = { index, step: stepId(step), reason };
        break;
      }
      executed.push(stepId(step));
      pagesVisited.push(viewOf(page));
    }
    const final: Stop = scenario.expected.handoff
      ? { kind: "blocked", message: "replay stops for the handoff" }
      : { kind: "done", message: "replay done" };
    const observed = await readEnd(
      page,
      workspace,
      store.snapshot(),
      store.receipts,
      [final],
    );
    const verdict = judge(scenario, { ...observed, pagesVisited });
    return {
      id: scenario.id,
      endCorrect: verdict.endCorrect,
      mismatches: verdict.mismatches,
      unexpectedSaves: verdict.unexpectedSaves,
      executed,
      failedStep,
    };
  } finally {
    await context.close();
    await app.close();
  }
}
