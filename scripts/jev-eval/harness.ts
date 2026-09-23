import { once } from "node:events";
import { expect, type Browser, type Page } from "@playwright/test";
import type { Fetch } from "@typesafe-ai/sdk";
import { z } from "zod";
import { createApp } from "../../server/app.js";
import type { Config } from "../../server/config.js";
import { WorkspaceStore } from "../../server/workspace-store.js";
import { gatePreferenceKey, type GateName } from "../../frontend/src/gate.js";
import { fieldSchema } from "../../shared/command.js";
import { actionEffects } from "../../shared/dimensions.js";
import {
  caseFiltersSchema,
  caseSchema,
  draftOf,
  editableSchema,
  pageSchema,
  type CaseDraft,
  type Page as View,
  type Receipt,
  type Save,
  type Workspace,
} from "../../shared/domain.js";
import {
  answerFor,
  judge,
  valueAnswer,
  type AnswerParts,
  type Observed,
  type Stop,
} from "./judge.js";
import type { SampleResult } from "./report.js";
import { reviewChoice } from "./review.js";
import { startWorkspace, type Scenario, type StartState } from "./scenarios.js";

export const confidencePercent = 75;
export const saveModes = ["auto", "confirm"] as const;
export type SaveMode = (typeof saveModes)[number];
const maxConfirmations = 12;
// "Antwort übernommen" is the pause between a panel answer and Jev resuming.
const running =
  /^(Bereit für deinen Auftrag|Jev wählt den nächsten sichtbaren Schritt|Schritt wird ausgeführt|Speicherergebnis wird geprüft|Antwort übernommen)$/;

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
  if (
    /^(Jev meldet|Entwurf vorbereitet|Vom Nutzer als erledigt)/.test(message)
  )
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

export async function answerValue(
  page: Page,
  scenario: Scenario,
): Promise<Stop | null> {
  const panel = page.locator("[data-answer-field]:visible").first();
  await panel.waitFor({ timeout: 2000 }).catch(() => undefined);
  if (!(await panel.count())) return null;
  const input = (part: keyof AnswerParts) =>
    panel.locator(`[data-answer-part="${part}"]`);
  const prefill: AnswerParts = {};
  for (const part of ["date", "time", "value"] as const)
    if (await input(part).count())
      prefill[part] = await input(part).inputValue();
  const answer = valueAnswer(
    scenario,
    {
      id: (await panel.getAttribute("data-answer-field")) ?? "",
      scope: (await panel.getAttribute("data-answer-scope")) ?? "",
      type:
        prefill.value === undefined
          ? "datetime-local"
          : fieldSchema.shape.type.parse(
              await input("value").getAttribute("type"),
            ),
    },
    prefill,
  );
  const text = async () =>
    (await panel.innerText()).replace(/\s+/g, " ").slice(0, 400);
  const asked = {
    ...(answer.dimension ? { dimension: answer.dimension } : {}),
    ...(answer.caseId ? { caseId: answer.caseId } : {}),
  };
  if (answer.parts === null)
    return { kind: "input", message: await text(), ...asked };
  for (const [part, value] of Object.entries(answer.parts))
    await input(part as keyof AnswerParts).fill(value);
  const message = [
    await text(),
    ...answer.kept.map((kept) => `kept prefilled ${kept}`),
  ].join(" · ");
  const handle = await panel.elementHandle();
  const error = page.locator("[data-answer-error]:visible");
  await panel.locator("[data-answer-submit]").click();
  await expect
    .poll(
      async () => (await error.count()) > 0 || !(await handle?.isVisible()),
      { timeout: 10000 },
    )
    .toBe(true);
  if (await error.count())
    return {
      kind: "input",
      message: `${message} · ${(await error.innerText()).trim()}`,
      ...asked,
      value: answer.value,
    };
  return { kind: "answer", message, ...asked, value: answer.value };
}

const viewOf = (page: Page) =>
  pageSchema.catch("cases").parse(new URL(page.url()).hash.slice(1));

const historySchema = z.object({
  history: z
    .array(
      z.object({
        coverageProbability: z.number().optional().catch(undefined),
        checklist: z.unknown().optional(),
        plan: z.unknown().optional(),
        votes: z.unknown().optional(),
        duels: z.unknown().optional(),
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
  plan: unknown;
  votes: unknown;
  duels: unknown;
};
const stepAfterSchema = z.object({
  page: pageSchema,
  filters: caseFiltersSchema,
  caseId: z.string().nullable(),
  draft: editableSchema.nullable(),
  dirty: z.boolean(),
});
const storedRun = async (page: Page) =>
  historySchema.parse(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}"),
    ),
  ).history[0];
const visited = (steps: { after: string }[]) =>
  steps.flatMap((step) => {
    const parsed = pageSchema.safeParse(JSON.parse(step.after).page);
    return parsed.success ? [parsed.data as View] : [];
  });
const recordsOf = (saved: Workspace) =>
  Object.fromEntries(saved.cases.map((c) => [c.id, draftOf(c)]));
const receiptsOf = (receipts: Receipt[]) =>
  receipts.map((r) => ({ caseId: r.caseId, saved: draftOf(r.saved) }));

/**
 * Answers a review or approval stop with the option a person who knows the
 * scenario clicks. The state comes from the last step's observation, since
 * reading the screen would close the palette and change the page.
 */
async function answerReview(
  page: Page,
  stop: Stop,
  scenario: Scenario,
  store: RecordingStore,
  steps: string[] | undefined,
): Promise<Stop> {
  const options = page.locator("[data-review-option]:visible");
  await options
    .first()
    .waitFor({ timeout: 2000 })
    .catch(() => undefined);
  if (!(await options.count())) {
    await page.locator(".activity .text-button").click();
    await options
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => undefined);
  }
  const offered = await options.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("data-review-option") ?? ""),
  );
  const [fromPlan] = await page
    .locator("[data-review-plan] [data-review-option]:visible")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-review-option")),
    );
  const executed = (await storedRun(page))?.steps ?? [];
  const last = executed.at(-1);
  const after = last ? stepAfterSchema.parse(JSON.parse(last.after)) : null;
  const pick = reviewChoice({
    scenario,
    observed: {
      page: viewOf(page),
      filters: after?.filters ?? scenario.start.filters,
      records: recordsOf(store.snapshot()),
      receipts: receiptsOf(store.receipts),
      draft:
        after?.caseId && after.draft && after.dirty
          ? { caseId: after.caseId, values: after.draft, dirty: true }
          : null,
      pagesVisited: visited(executed),
    },
    offered,
    prefix: executed.map((step) => step.action.id),
    steps,
  });
  const shown = `offered ${offered.join(", ") || "nothing"}${fromPlan ? ` · plan row ${fromPlan}` : ""}`;
  if (pick.option === null)
    return {
      ...stop,
      message: `${stop.message} · ${shown} · no click: ${pick.reason}`,
    };
  const button = page
    .locator(`[data-review-option=${JSON.stringify(pick.option)}]:visible`)
    .first();
  const forced = (await button.getAttribute("data-review-force")) !== null;
  const label = page.locator(".activity-label");
  const before = (await label.innerText()).trim();
  await button.click();
  await expect(label).not.toHaveText(before, { timeout: 15000 });
  return {
    kind: "review-answer",
    message: `${stop.message} · ${shown} · clicked ${pick.option}${forced ? " with Trotzdem ausführen" : ""}`,
    value: pick.option,
  };
}

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
  const stored = await storedRun(page);
  const steps = stored?.steps ?? [];
  return {
    page: view,
    filters,
    records: recordsOf(saved),
    receipts: receiptsOf(receipts),
    draft,
    pagesVisited: visited(steps),
    stops,
    steps: steps.map((step) => `${step.action.id}:${step.outcome}`),
    coverageProbability: stored?.coverageProbability ?? null,
    checklist: stored?.checklist ?? null,
    plan: stored?.plan ?? null,
    votes: stored?.votes ?? null,
    duels: stored?.duels ?? null,
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

/** The day the scenarios are written on, a Tuesday; "morgen" in a scenario means the day after it. */
export const scenarioDay = new Date("2026-09-22T09:00:00");
export async function evalContext(
  browser: Browser,
  saveMode: SaveMode,
  threshold = confidencePercent,
  gate: GateName = "threshold",
) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.clock.setFixedTime(scenarioDay);
  await context.addInitScript(
    ({ percent, mode, gate, gateKey }) => {
      localStorage.setItem(
        "kontor-jev-confidence-v1",
        JSON.stringify({ version: 1, percent }),
      );
      localStorage.setItem(
        "kontor-jev-save-mode-v1",
        JSON.stringify({ version: 1, mode }),
      );
      localStorage.setItem(gateKey, JSON.stringify({ version: 2, gate }));
    },
    { percent: threshold, mode: saveMode, gate, gateKey: gatePreferenceKey },
  );
  return context;
}

export type Budget = { used: number; limit: number };
export type CallRecord = {
  question: string;
  choice: string | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
  ms: number;
  /** The provider's HTTP status; null while no response has arrived. */
  status: number | null;
  payload?: { request: unknown; answers: unknown; usage: unknown };
};
const providerAnswerSchema = z.object({
  answers: z
    .record(
      z.string(),
      z
        .object({
          choice: z.string().optional(),
          confidence: z.number().optional(),
          probabilities: z.record(z.string(), z.number()).optional(),
        })
        .loose(),
    )
    .optional(),
  usage: z.unknown().optional(),
});
/**
 * Sends and records the sample's provider calls. A call past the run's budget
 * or the sample's limit is refused unsent; the app only sees a connection
 * failure, so the reason is kept in `refused` for the sample's result.
 */
export function recordingFetch(options: {
  budget: Budget;
  callLog: CallRecord[];
  refused: string[];
  maxCalls: number;
  recordPayloads: boolean;
  fetch?: Fetch;
}): Fetch {
  const { budget, callLog, refused, maxCalls } = options;
  const send = options.fetch ?? globalThis.fetch;
  const refuse = (reason: string) => {
    refused.push(reason);
    throw new Error(reason);
  };
  return async (url, init) => {
    if (budget.used >= budget.limit) refuse("Eval call budget exhausted");
    if (callLog.length >= maxCalls) refuse("Sample call limit reached");
    budget.used++;
    const began = Date.now();
    const record: CallRecord = {
      question: "",
      choice: null,
      confidence: null,
      probabilities: null,
      ms: 0,
      status: null,
    };
    callLog.push(record);
    const request: unknown = JSON.parse(String(init?.body));
    record.question = Object.keys(
      z.object({ questions: z.record(z.string(), z.unknown()) }).parse(request)
        .questions,
    ).join(",");
    const response = await send(url, init);
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const answer = providerAnswerSchema.safeParse(body);
    const answers = answer.success ? (answer.data.answers ?? null) : null;
    const first = answers ? Object.values(answers)[0] : undefined;
    Object.assign(record, {
      choice: first?.choice ?? null,
      confidence: first?.confidence ?? null,
      probabilities: first?.probabilities ?? null,
      ms: Date.now() - began,
      status: response.status,
      ...(options.recordPayloads
        ? {
            payload: {
              request,
              answers,
              usage: answer.success ? (answer.data.usage ?? null) : null,
            },
          }
        : {}),
    });
    return response;
  };
}
export async function runSample(options: {
  browser: Browser;
  config: Config;
  scenario: Scenario;
  sample: number;
  variant: string;
  saveMode: SaveMode;
  threshold?: number;
  gate?: GateName;
  budget: Budget;
  maxCalls?: number;
  timeoutMs?: number;
  recordPayloads?: boolean;
  /** Answer review and approval stops along the human path in `humanSteps`. */
  answerReview?: boolean;
  humanSteps?: string[];
  fetch?: Fetch;
}): Promise<
  SampleResult & { observed: Observed | null; callLog: CallRecord[] }
> {
  const { browser, config, scenario, budget } = options;
  const deadline = Date.now() + (options.timeoutMs ?? 300000);
  const store = seededStore(scenario.start);
  const workspace = store.snapshot();
  const callLog: CallRecord[] = [];
  const refused: string[] = [];
  const fetch = recordingFetch({
    budget,
    callLog,
    refused,
    maxCalls: options.maxCalls ?? 40,
    recordPayloads: options.recordPayloads ?? false,
    fetch: options.fetch,
  });
  const app = await serve(config, store, fetch);
  const context = await evalContext(
    browser,
    options.saveMode,
    options.threshold,
    options.gate,
  );
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
      if (
        options.answerReview &&
        (stop.kind === "review" || stop.kind === "approval")
      ) {
        const answered = await answerReview(
          page,
          stop,
          scenario,
          store,
          options.humanSteps,
        );
        stops.push(answered);
        if (
          answered.kind === "review-answer" &&
          stops.length <= maxConfirmations
        )
          continue;
        break;
      }
      if (stop.kind === "input") {
        const answered = (await answerValue(page, scenario)) ?? stop;
        stops.push(answered);
        if (answered.kind === "answer" && stops.length <= maxConfirmations)
          continue;
        break;
      }
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
    reviewClicks: stops.filter((stop) => stop.kind === "review-answer").length,
    calls: callLog.length,
    wallMs: ended - began,
    error: error ?? refused[0] ?? null,
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
