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
type Scenario = {
  id: string;
  request: string;
  page?: string;
  patch?: Partial<CaseDraft>;
  secondPatch?: Partial<CaseDraft>;
  draft?: boolean;
  blocked?: boolean;
  missing?: boolean;
  rows?: string[];
  customer?: string;
  openOnly?: boolean;
  search?: string;
  revisions?: number;
  order?: string[];
};
const scenarios: Scenario[] = [
  { id: "customers", request: "Zeig mir die Kunden.", page: "customers" },
  {
    id: "navigation",
    request: "Öffne Kunden und danach Team.",
    page: "team",
    order: ["customers", "team"],
  },
  {
    id: "ordered-navigation",
    request: "Zeige zuerst Kunden, danach Berichte und zuletzt Team.",
    page: "team",
    order: ["customers", "reports", "team"],
  },
  {
    id: "search",
    request: 'Suche in den Vorgängen nach "Wartung".',
    rows: ["V-1042", "V-1039"],
    search: "Wartung",
  },
  {
    id: "filter-original",
    request: "Filter nach nordwerk",
    rows: ["V-1042", "V-1039"],
    customer: "Nordwerk GmbH",
    openOnly: false,
  },
  {
    id: "filter-open",
    request: "Zeige mir nur offene Nordwerk-Vorgänge.",
    rows: ["V-1042", "V-1039"],
    customer: "Nordwerk GmbH",
    openOnly: true,
  },
  {
    id: "filter-hafen",
    request: "Bitte nach Hafen & Partner filtern.",
    rows: ["V-1041", "V-1035"],
    customer: "Hafen & Partner",
    openOnly: false,
  },
  {
    id: "edit-save-reports",
    request:
      "Weise V-1042 Lea Sommer zu, trage 35 Minuten ein, speichere und öffne Berichte.",
    page: "reports",
    patch: { technicianId: "lea", minutes: 35 },
    revisions: 1,
  },
  {
    id: "assign",
    request: "Weise V-1042 Lea Sommer zu und speichere.",
    patch: { technicianId: "lea" },
    revisions: 1,
  },
  {
    id: "multi-record",
    request:
      "Weise V-1042 Lea Sommer zu und speichere. Weise danach V-1039 Jonas Weber zu und speichere.",
    patch: { technicianId: "lea" },
    secondPatch: { technicianId: "jonas" },
    revisions: 2,
  },
  {
    id: "repeated-assignment",
    request:
      "Weise V-1042 zuerst Lea Sommer zu und speichere. Weise denselben Vorgang danach Jonas Weber zu und speichere erneut.",
    patch: { technicianId: "jonas" },
    revisions: 2,
  },
  {
    id: "missing-value",
    request: "Erfasse Arbeitszeit für V-1042 und speichere.",
    missing: true,
  },
  {
    id: "no-save",
    request:
      "Trage für V-1042 25 Minuten Arbeitszeit als Entwurf ein, nicht speichern.",
    patch: { minutes: 25 },
    draft: true,
  },
  {
    id: "assign-no-save",
    request: "V-1042 Lea Sommer zuweisen, aber nicht speichern.",
    patch: { technicianId: "lea" },
    draft: true,
  },
  { id: "domain-blocker", request: "Schließe V-1039 ab.", blocked: true },
  {
    id: "partial-trailing",
    request:
      "Weise V-1042 Lea Sommer zu und speichere. Sende danach eine E-Mail an den Kunden.",
    patch: { technicianId: "lea" },
    revisions: 1,
    blocked: true,
  },
  {
    id: "requested-order",
    request: "Zuerst V-1042 abschließen, dann 45 Minuten Arbeitszeit erfassen.",
    blocked: true,
  },
  {
    id: "durations",
    request:
      "V-1042 45 Minuten Arbeit erfassen, Termin 2026-09-25 09:00 für 60 Minuten, NICHT speichern",
    patch: {
      minutes: 45,
      appointment: { start: "2026-09-25T09:00:00", minutes: 60 },
    },
    draft: true,
  },
];
const { values } = parseArgs({
  options: {
    scenario: { type: "string" },
    repeat: { type: "string", default: "1" },
    "max-calls": { type: "string", default: "160" },
    "timeout-ms": { type: "string", default: "600000" },
  },
});
const positive = z.coerce.number().int().positive();
const repeat = positive.max(10).parse(values.repeat),
  maxCalls = positive.max(1000).parse(values["max-calls"]),
  timeout = positive.max(1800000).parse(values["timeout-ms"]);
const selected = scenarios.filter(
  (s) => !values.scenario || values.scenario.split(",").includes(s.id),
);
assert(
  selected.length &&
    (!values.scenario ||
      values.scenario
        .split(",")
        .every((id) => selected.some((s) => s.id === id))),
  "Unknown scenario",
);
const config = readConfig({ ...process.env, TYPESAFE_MODE: "live" });
const output = `live-results/${new Date().toISOString().replaceAll(":", "-")}`;
await mkdir(output, { recursive: true });
const deadline = AbortSignal.timeout(timeout);
let callCount = 0,
  active = "",
  failed = false;
const calls: unknown[] = [],
  results: unknown[] = [];
const liveFetch: Fetch = async (url, init) => {
  if (callCount >= maxCalls || deadline.aborted)
    throw new Error("Live budget exhausted");
  callCount++;
  const payload = z
    .object({ state: z.string(), questions: z.record(z.string(), z.unknown()) })
    .parse(JSON.parse(String(init?.body)));
  const state = z
    .object({
      snapshotId: z.string(),
      originalRequest: z.string(),
      availableActions: z.unknown(),
      observedSteps: z.unknown(),
    })
    .parse(JSON.parse(payload.state));
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]),
  });
  const result = z
    .object({
      model: z.string().optional(),
      answers: z.unknown().optional(),
      usage: z.unknown().optional(),
    })
    .parse(await response.clone().json());
  calls.push({
    scenario: active,
    snapshotId: state.snapshotId,
    request: state.originalRequest,
    actions: state.availableActions,
    observedSteps: state.observedSteps,
    questions: payload.questions,
    ...result,
  });
  return response;
};
async function settled(page: Page) {
  await expect(page.locator(".activity-label")).not.toHaveText(
    /^(Bereit für deinen Auftrag|Jev wählt den nächsten sichtbaren Schritt|Schritt wird ausgeführt|Speicherergebnis wird geprüft)$/,
    { timeout: 90000 },
  );
}
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (let iteration = 1; iteration <= repeat; iteration++)
    for (const scenario of selected) {
      active = `${scenario.id}/${iteration}`;
      if (callCount >= maxCalls || deadline.aborted) {
        failed = true;
        results.push({
          scenario: active,
          status: "unexecuted",
          reason: "budget",
        });
        continue;
      }
      const store = new WorkspaceStore(":memory:"),
        before = store.snapshot();
      const app = createApp(config, liveFetch, store),
        context = await browser.newContext(),
        page = await context.newPage();
      app.server.listen(0, "127.0.0.1");
      await once(app.server, "listening");
      const address = app.server.address();
      assert(address && typeof address !== "string");
      const firstCall = callCount;
      let error: string | null = null;
      try {
        await page.goto(`http://127.0.0.1:${address.port}`);
        await page
          .getByRole("button", { name: /Jev · Befehl eingeben/ })
          .click();
        await page
          .getByRole("textbox", { name: "Auftrag an Jev" })
          .fill(scenario.request);
        await page.getByRole("button", { name: "Ausführen" }).click();
        await settled(page);
        const activity = await page.locator(".activity-label").innerText();
        if (scenario.missing) {
          await expect(
            page.locator(".answer-panel input[type=number]"),
          ).toBeVisible();
          assert.equal(store.snapshot().revision, 0);
        } else if (scenario.blocked) {
          assert(
            activity.startsWith("Auftrag teilweise oder nicht erledigt."),
            `Expected actual blocked handoff, received ${activity}`,
          );
          await expect(page.locator(".answer-panel")).toBeVisible();
          await expect(page.locator(".editor")).toContainText(
            scenario.id === "domain-blocker" ? "V-1039" : "V-1042",
          );
          if (scenario.id === "domain-blocker")
            await expect(page.locator(".answer-panel")).toContainText(
              "Prüfung vor Ort",
            );
          if (scenario.id === "requested-order")
            await expect(page.locator(".answer-panel")).toContainText(
              "Arbeitszeit",
            );
        } else
          assert(
            activity.includes("Jev meldet"),
            `Not autonomous completion: ${activity}`,
          );
        const after = store.snapshot();
        assert.equal(after.revision, scenario.revisions ?? 0);
        if (scenario.draft) {
          assert.deepEqual(
            after,
            before,
            "No-save must not mutate persistence",
          );
          if (scenario.patch?.minutes !== undefined)
            await expect(page.locator("#minutes")).toHaveValue(
              String(scenario.patch.minutes),
            );
          if (scenario.patch?.technicianId)
            await expect(
              page.locator('[data-action="menu:technician"]'),
            ).toContainText(
              before.technicians.find(
                (t) => t.id === scenario.patch?.technicianId,
              )?.name ?? "missing",
            );
          if (scenario.patch?.appointment)
            await expect(page.locator("#appointment")).toHaveValue(
              scenario.patch.appointment.start.slice(0, 16),
            );
        } else if (scenario.patch)
          for (const [key, value] of Object.entries(scenario.patch))
            assert.deepEqual(
              after.cases.find((c) => c.id === "V-1042")?.[
                key as keyof CaseDraft
              ],
              value,
            );
        if (scenario.secondPatch)
          for (const [key, value] of Object.entries(scenario.secondPatch))
            assert.deepEqual(
              after.cases.find((c) => c.id === "V-1039")?.[
                key as keyof CaseDraft
              ],
              value,
            );
        if (scenario.page)
          assert.equal(new URL(page.url()).hash, `#${scenario.page}`);
        if (scenario.rows)
          expect(
            await page.locator("tbody tr td:first-child").allTextContents(),
          ).toEqual(scenario.rows);
        if (scenario.customer)
          await expect(
            page.locator('[data-action="menu:customer"]'),
          ).toContainText(scenario.customer);
        if (scenario.openOnly !== undefined)
          await expect(
            page.locator('[data-action="filter:open"]'),
          ).toHaveAttribute("aria-pressed", String(scenario.openOnly));
        if (scenario.search)
          await expect(page.getByRole("searchbox")).toHaveValue(
            scenario.search,
          );
        if (scenario.draft && scenario.patch?.appointment)
          await expect(
            page.getByRole("spinbutton", { name: "Termindauer in Minuten" }),
          ).toHaveValue(String(scenario.patch.appointment.minutes));
        const expected = {
          ...before,
          revision: scenario.revisions ?? 0,
          cases: before.cases.map((c) => ({
            ...c,
            ...(!scenario.draft && c.id === "V-1042" ? scenario.patch : {}),
            ...(c.id === "V-1039" ? scenario.secondPatch : {}),
          })),
        };
        assert.deepEqual(
          after,
          expected,
          "Exact workspace, including unrelated fields and records",
        );
        const stored = await page.evaluate(() =>
          JSON.parse(localStorage.getItem("kontor-command-v1") ?? "{}"),
        );
        const run = z
          .object({
            history: z.array(
              z.object({
                steps: z.array(z.object({ after: z.string() })),
                receipts: z.array(
                  z.object({
                    saved: z.object({ technicianId: z.string().nullable() }),
                  }),
                ),
              }),
            ),
          })
          .parse(stored).history[0];
        if (scenario.order) {
          let index = 0;
          for (const step of run?.steps ?? []) {
            const facts = JSON.parse(step.after);
            if ((facts.page ?? facts.currentPage) === scenario.order[index])
              index++;
          }
          assert.equal(
            index,
            scenario.order.length,
            "Requested navigation order",
          );
        }
        if (scenario.id === "repeated-assignment")
          assert.deepEqual(
            run?.receipts.map((r) => r.saved.technicianId),
            ["lea", "jonas"],
          );
      } catch (cause) {
        failed = true;
        error = cause instanceof Error ? cause.message : String(cause);
      }
      results.push({
        scenario: active,
        request: scenario.request,
        status: error
          ? "failed"
          : scenario.missing || scenario.blocked
            ? "expected-handoff"
            : "autonomous-completion",
        error,
        calls: callCount - firstCall,
        confirmations: 0,
        activity: await page
          .locator(".activity-label")
          .textContent()
          .catch(() => null),
        observedEffects: await page
          .evaluate(() => localStorage.getItem("kontor-command-v1"))
          .catch(() => null),
        saved: store.snapshot(),
      });
      await context.close();
      await app.close();
    }
} finally {
  await browser.close();
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ callCount, results, calls }, null, 2),
  );
}
process.stdout.write(`${output}/report.json\n`);
if (failed) process.exitCode = 1;
