import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { chromium, expect, type Page } from "@playwright/test";
import type { Fetch } from "@typesafe-ai/sdk";
import { z } from "zod";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { WorkspaceStore } from "../server/workspace-store.js";
import type { CaseDraft } from "../shared/domain.js";

type Outcome =
  | { kind: "filter"; customer: string; rows: string[]; open: boolean }
  | { kind: "question"; text: string; label?: string }
  | { kind: "change"; persistence: "save" | "draft"; patch: Partial<CaseDraft> };
type Scenario = { id: string; request: string; page?: string; outcome: Outcome };
const scenarios: Scenario[] = [
  { id: "filter-original", request: "Filter nach nordwerk", outcome: { kind: "filter", customer: "Nordwerk GmbH", rows: ["V-1042", "V-1039"], open: false } },
  { id: "filter-open", page: "Berichte", request: "Zeige mir nur die offenen Vorgänge von Nordwerk.", outcome: { kind: "filter", customer: "Nordwerk GmbH", rows: ["V-1042", "V-1039"], open: true } },
  { id: "filter-hafen", page: "Team", request: "Bitte nach Hafen & Partner filtern.", outcome: { kind: "filter", customer: "Hafen & Partner", rows: ["V-1041", "V-1035"], open: false } },
  { id: "time-draft", request: "Trage für V-1042 25 Minuten Arbeitszeit als Entwurf ein, nicht speichern.", outcome: { kind: "change", persistence: "draft", patch: { minutes: 25 } } },
  { id: "assign", page: "Kunden", request: "Weise V-1042 Lea Sommer zu.", outcome: { kind: "change", persistence: "save", patch: { technicianId: "lea" } } },
  { id: "evidence", request: "Schließe V-1039 ab.", outcome: { kind: "question", text: "Die Prüfung vor Ort ist nicht belegt." } },
  { id: "ambiguous-case", request: "Weise die Wartung Lea Sommer zu und speichere.", outcome: { kind: "question", text: "Welcher Vorgang ist gemeint?" } },
  { id: "order", request: "Zuerst V-1042 abschließen, dann 60 Minuten Arbeitszeit erfassen.", outcome: { kind: "question", text: "Deine feste Reihenfolge ist so nicht möglich." } },
  { id: "schedule-conflict", request: "Setze für V-1042 einen Termin am 2026-09-24 um 09:00 für 60 Minuten.", outcome: { kind: "question", text: "V-1041", label: "Freigabe ausstehend" } },
  { id: "unsupported-delete", request: "Weise V-1042 Lea Sommer zu und lösche alle Kunden.", outcome: { kind: "question", text: "Der vollständige Auftrag ist nicht unterstützt oder nicht eindeutig." } },
  { id: "multi-case", request: "Weise V-1042 Lea Sommer und V-1039 Jonas Weber zu.", outcome: { kind: "question", text: "Der vollständige Auftrag ist nicht unterstützt oder nicht eindeutig." } },
  { id: "filter-scope", request: "Zeige offene Hafen-Vorgänge und weise V-1042 Lea Sommer zu.", outcome: { kind: "question", text: "Soll ich den angeforderten Filter entfernen" } },
  { id: "durations", request: "V-1042 45 Minuten Arbeit erfassen, Termin 2026-09-25 09:00 für 60 Minuten, NICHT speichern", outcome: { kind: "change", persistence: "draft", patch: { minutes: 45, appointment: { start: "2026-09-25T09:00:00", minutes: 60 } } } },
  { id: "assign-no-save", page: "Team", request: "V-1042 Lea Sommer zuweisen, aber nicht speichern.", outcome: { kind: "change", persistence: "draft", patch: { technicianId: "lea" } } },
  { id: "missing-minutes", request: "Erfasse Arbeitszeit für V-1042.", outcome: { kind: "question", text: "Wie viele tatsächlich geleistete Minuten" } },
  { id: "missing-person", request: "Weise V-1042 einer Person zu.", outcome: { kind: "question", text: "Wer soll den Vorgang übernehmen?" } },
  { id: "missing-customer", request: "Filter nach Kunde", outcome: { kind: "question", text: "Für welchen Kunden soll ich filtern?" } },
  { id: "repeated-assignment", request: "Weise V-1042 zuerst Lea Sommer und danach Jonas Weber zu.", outcome: { kind: "question", text: "Der vollständige Auftrag ist nicht unterstützt oder nicht eindeutig." } },
];
const { values } = parseArgs({ options: {
  live: { type: "boolean", default: false },
  scenario: { type: "string" }, repeat: { type: "string", default: "1" },
  "max-calls": { type: "string", default: "150" },
  "timeout-ms": { type: "string", default: "300000" },
} });
if (!values.live) throw new Error("Opt in with --live. This suite makes paid real-provider calls using synthetic data.");
const positive = z.coerce.number().int().positive();
const repeat = positive.max(20).parse(values.repeat);
const maxCalls = positive.max(1000).parse(values["max-calls"]);
const timeout = positive.max(1800000).parse(values["timeout-ms"]);
const selected = scenarios.filter(s => !values.scenario || values.scenario.split(",").includes(s.id));
assert(selected.length && (!values.scenario || values.scenario.split(",").every(id => selected.some(s => s.id === id))), "Unknown scenario");
const config = readConfig({ ...process.env, TYPESAFE_MODE: "live" });
const output = `live-results/${new Date().toISOString().replaceAll(":", "-")}`;
await mkdir(output, { recursive: true });
const deadline = AbortSignal.timeout(timeout);
const diagnostics = z.object({ model: z.string().optional(), answers: z.record(z.string(), z.object({ choice: z.string(), confidence: z.number() })).optional(), usage: z.unknown().optional() });
const envelope = z.object({ state: z.string(), questions: z.record(z.string(), z.unknown()) });
const calls: unknown[] = [];
const results: unknown[] = [];
let callCount = 0;
let active = "";
let failed = false;
const liveFetch: Fetch = async (url, init) => {
  if (callCount >= maxCalls || deadline.aborted) throw new Error("Live suite call/time budget exhausted");
  callCount++;
  const payload = envelope.parse(JSON.parse(String(init?.body)));
  const start = performance.now();
  const entry = { scenario: active, questions: Object.keys(payload.questions), state: JSON.parse(payload.state) };
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]) });
    const body: unknown = await response.clone().json();
    calls.push({ ...entry, elapsedMs: Math.round(performance.now() - start), status: response.status, ...diagnostics.parse(body) });
    return response;
  } catch {
    calls.push({ ...entry, elapsedMs: Math.round(performance.now() - start), error: "Provider request failed" });
    throw new Error("Live provider request failed");
  }
};
async function snapshot(page: Page) {
  return {
    activity: await page.locator(".activity-label").textContent(),
    question: await page.locator(".answer-panel").allTextContents(),
    editor: await page.locator(".editor").allTextContents(),
    rows: await page.locator("tbody tr td:first-child").allTextContents(),
    history: await page.evaluate(() => localStorage.getItem("kontor-command-v1")),
  };
}
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (let iteration = 1; iteration <= repeat; iteration++) for (const scenario of selected) {
    active = `${scenario.id}/${iteration}`;
    if (deadline.aborted || callCount >= maxCalls) {
      failed = true;
      results.push({ scenario: active, status: "unexecuted", reason: "Call/time budget exhausted" });
      continue;
    }
    const store = new WorkspaceStore();
    const before = store.snapshot();
    const app = createApp(config, liveFetch, store);
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const closeOnDeadline = () => { void context.close(); };
    deadline.addEventListener("abort", closeOnDeadline, { once: true });
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const address = app.server.address();
    assert(address && typeof address !== "string");
    let error: string | null = null;
    const firstCall = callCount;
    const started = performance.now();
    try {
      await page.goto(`http://127.0.0.1:${address.port}`);
      if (scenario.page) await page.getByRole("button", { name: scenario.page, exact: true }).click();
      await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
      await page.getByRole("textbox", { name: "Auftrag an Jev" }).fill(scenario.request);
      await page.getByRole("button", { name: "Ausführen", exact: true }).click();
      const outcome = scenario.outcome;
      const label = outcome.kind === "question" ? outcome.label ?? "Antwort ausstehend" : outcome.kind === "change" && outcome.persistence === "draft" ? "Entwurf vorbereitet · nicht gespeichert" : "Auftrag abgeschlossen";
      await expect(page.locator(".activity-label")).toHaveText(label, { timeout: 45000 });
      if (outcome.kind === "question") {
        await expect(page.locator(".answer-panel, .approval-panel")).toContainText(outcome.text);
        await expect(page.locator(".editor")).toHaveCount(0);
      } else if (outcome.kind === "filter") {
        await expect(page.locator('[data-action="menu:customer"]')).toContainText(outcome.customer);
        assert.deepEqual((await page.locator("tbody tr td:first-child").allTextContents()).map(s => s.trim()), outcome.rows);
        if (outcome.open) await expect(page.locator('[data-action="filter:open"]')).toHaveClass(/active-filter/);
        else await expect(page.locator('[data-action="filter:open"]')).not.toHaveClass(/active-filter/);
        await expect(page.locator(".editor")).toHaveCount(0);
      } else {
        await expect(page.locator(".editor")).toContainText("V-1042");
        const target = before.cases.find(c => c.id === "V-1042");
        assert(target);
        const expected = { ...target, ...outcome.patch };
        await expect(page.locator('[data-action="menu:technician"]')).toContainText(before.technicians.find(t => t.id === expected.technicianId)?.name ?? "");
        await expect(page.locator("#minutes")).toHaveValue(String(expected.minutes));
        await expect(page.locator("#appointment")).toHaveValue(expected.appointment?.start.slice(0, 16) ?? "");
        await expect(page.getByRole("spinbutton", { name: "Termindauer in Minuten" })).toHaveValue(String(expected.appointment?.minutes ?? 60));
      }
      const expectedDb = outcome.kind === "change" && outcome.persistence === "save" ? { ...before, revision: 1, cases: before.cases.map(c => c.id === "V-1042" ? { ...c, ...outcome.patch } : c) } : before;
      assert.deepEqual(store.snapshot(), expectedDb);
    } catch (caught) {
      failed = true;
      error = caught instanceof Error ? caught.message : "Scenario failed";
    } finally {
      const ui = page.isClosed() ? null : await snapshot(page);
      results.push({ scenario: active, request: scenario.request, expected: scenario.outcome, status: error ? "failed" : "passed", error, elapsedMs: Math.round(performance.now() - started), calls: callCount - firstCall, ui, database: store.snapshot() });
      if (!page.isClosed()) await page.screenshot({ path: `${output}/${scenario.id}-${iteration}.png`, fullPage: true });
      console.log(`${active}: ${error ? "FAILED" : "passed"} (${callCount - firstCall} calls)`);
      deadline.removeEventListener("abort", closeOnDeadline);
      await context.close();
      await app.close();
      await writeFile(`${output}/report.json`, JSON.stringify({ maxCalls, callCount, timeout, results, calls }, null, 2));
    }
  }
} finally {
  await browser.close();
}
console.log(`Report: ${output}/report.json. ${callCount} provider calls. All browser contexts and servers stopped.`);
if (failed) process.exitCode = 1;
