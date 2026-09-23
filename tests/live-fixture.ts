import type { Page } from "@playwright/test";
import type { Fetch } from "@typesafe-ai/sdk";
import { once } from "node:events";
import { z } from "zod";
import { createApp } from "../server/app.js";
import { WorkspaceStore } from "../server/workspace-store.js";
import { gatePreferenceKey, type GateName } from "../frontend/src/gate.js";
/** Stores the gate the app reads at load, as a person's browser would. */
export const storeGate = (page: Page, gate: GateName) =>
  page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: gatePreferenceKey,
    value: JSON.stringify({ version: 2, gate }),
  });
export function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
export type ScriptOptions = {
  hold?: string;
  low?: string;
  lowConfidence?: number;
  assessment?: string;
  assessmentConfidence?: number;
  completionVerdict?: "complete" | "outstanding" | "unclear";
  completeProbability?: number;
  holdAssessment?: string;
  forbidCommit?: boolean;
  outstanding?: boolean;
  receiptComplete?: boolean;
  cause?: string;
  causeConfidence?: number;
  nextAnswer?: (index: number) => {
    choice: string;
    confidence: number;
    probabilities?: Record<string, number>;
  };
  effectAnswer?: (selected: unknown) => {
    choice: string;
    confidence: number;
  };
  /**
   * Answers plan questions: yes to the named nouls, the named or first
   * option of each choice; records each call's question keys. Without it a
   * plan call gets no to every noul, a plan that asks for nothing.
   */
  plan?: {
    yes: readonly string[];
    choose?: Record<string, string>;
    calls: string[][];
  };
  /** Picks for value reading parts by question key ("f0.day"); an unscripted part reads "none", a request that states nothing. */
  read?: Record<string, string>;
};
export function scriptedProvider(
  sequence: string[],
  options: ScriptOptions = {},
) {
  const held = barrier(),
    arrived = barrier();
  let heldOnce = false;
  const snapshots: string[][] = [];
  const observations: unknown[] = [];
  const assessed: unknown[] = [];
  const choiceTexts: Record<string, string>[] = [];
  const fetch: Fetch = async (_url, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    const planCall = z
      .object({
        state: z.record(z.string(), z.unknown()),
        questions: z.record(
          z.string(),
          z.object({
            type: z.enum(["noul", "choice"]),
            criteria: z.record(z.string(), z.string()).optional(),
          }),
        ),
      })
      .safeParse(body);
    if (planCall.success) {
      const plan = options.plan ?? { yes: [], calls: [] };
      const { questions } = planCall.data;
      plan.calls.push(Object.keys(questions));
      return Response.json({
        model: "scripted-test-fixture",
        answers: Object.fromEntries(
          Object.entries(questions).map(([key, question]) => {
            if (question.type === "noul")
              return [
                key,
                { type: "noul", noul: plan.yes.includes(key) ? 1 : 0 },
              ];
            const labels = Object.keys(question.criteria ?? {});
            const reading = /^f\d+\./.test(key);
            const choice =
              (reading ? options.read?.[key] : plan.choose?.[key]) ??
              (reading && labels.includes("none") ? "none" : labels[0]) ??
              "";
            return [
              key,
              {
                type: "choice",
                choice,
                confidence: 1,
                probabilities: Object.fromEntries(
                  labels.map((label) => [label, label === choice ? 1 : 0]),
                ),
              },
            ];
          }),
        ),
      });
    }
    const payload = z
      .object({
        state: z.string(),
        questions: z.record(
          z.string(),
          z.object({ criteria: z.record(z.string(), z.string()) }),
        ),
      })
      .parse(body);
    const input = z
      .object({ observedSteps: z.array(z.unknown()) })
      .parse(JSON.parse(payload.state));
    const key = payload.questions["next"]
      ? "next"
      : payload.questions["cause"]
        ? "cause"
        : "assessment";
    const facts = z
      .object({
        currentFacts: z.object({ receipts: z.array(z.unknown()).optional() }),
      })
      .parse(JSON.parse(payload.state));
    const nextAnswer =
      key === "next" ? options.nextAnswer?.(snapshots.length) : undefined;
    const next =
      nextAnswer?.choice ??
      (options.receiptComplete && facts.currentFacts.receipts?.length
        ? "done"
        : (sequence[input.observedSteps.length] ?? "done"));
    const selected = z
      .object({ selected: z.unknown().optional() })
      .parse(JSON.parse(payload.state)).selected;
    const commit = z
      .object({ kind: z.literal("commit") })
      .safeParse(selected).success;
    const effectAnswer =
      key === "assessment" && selected !== "done"
        ? options.effectAnswer?.(selected)
        : undefined;
    const complete =
      key === "assessment" && selected === "done"
        ? options.completeProbability
        : undefined;
    const completion =
      complete === undefined
        ? undefined
        : {
            choice: complete >= 0.5 ? "complete" : "outstanding",
            confidence: Math.max(complete, 1 - complete),
            probabilities: {
              complete,
              outstanding: 1 - complete,
              unclear: 0,
            } as Record<string, number>,
          };
    const choice =
      completion?.choice ??
      effectAnswer?.choice ??
      (key === "next"
        ? next
        : key === "cause"
          ? (options.cause ?? "unknown")
          : selected === "done"
            ? options.outstanding
              ? "outstanding"
              : (options.completionVerdict ?? "complete")
            : options.forbidCommit && commit
              ? "forbidden"
              : (options.assessment ?? "authorized"));
    if (key === "assessment") assessed.push(selected);
    if (key === "next") {
      observations.push(JSON.parse(payload.state));
      snapshots.push(Object.keys(payload.questions["next"]?.criteria ?? {}));
      choiceTexts.push(payload.questions["next"]?.criteria ?? {});
    }
    if (
      ((key === "next" && next === options.hold) ||
        (key === "cause" && options.hold === "cause") ||
        (key === "assessment" && next === options.holdAssessment)) &&
      !heldOnce
    ) {
      heldOnce = true;
      arrived.release();
      await held.promise;
    }
    return Response.json({
      model: "scripted-test-fixture",
      answers: {
        [key]: {
          type: "choice",
          choice,
          confidence:
            completion?.confidence ??
            nextAnswer?.confidence ??
            effectAnswer?.confidence ??
            (key === "cause"
              ? (options.causeConfidence ?? 1)
              : key === "assessment"
                ? (options.assessmentConfidence ?? 1)
                : next === options.low
                  ? (options.lowConfidence ?? 0.4)
                  : 1),
          probabilities: Object.fromEntries(
            Object.keys(payload.questions[key]?.criteria ?? {}).map(
              (option) => [
                option,
                completion
                  ? (completion.probabilities[option] ?? 0)
                  : nextAnswer?.probabilities
                    ? (nextAnswer.probabilities[option] ?? 0)
                    : option === choice
                      ? 1
                      : 0,
              ],
            ),
          ),
        },
      },
    });
  };
  return {
    fetch,
    held,
    arrived,
    snapshots,
    observations,
    assessed,
    choiceTexts,
  };
}
export async function withLive(
  page: Page,
  sequence: string[],
  run: (
    store: WorkspaceStore,
    held: ReturnType<typeof barrier>,
    arrived: Promise<void>,
    snapshots: string[][],
    observations: unknown[],
    assessed: unknown[],
    choiceTexts: Record<string, string>[],
  ) => Promise<void>,
  options: ScriptOptions = {},
) {
  const provider = scriptedProvider(sequence, options);
  const store = new WorkspaceStore(":memory:");
  const app = createApp(
    { mode: "live", apiKey: "test", model: "jev-latest" },
    provider.fetch,
    store,
  );
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await run(
      store,
      provider.held,
      provider.arrived.promise,
      provider.snapshots,
      provider.observations,
      provider.assessed,
      provider.choiceTexts,
    );
  } finally {
    provider.held.release();
    await app.close();
  }
}
export async function start(
  page: Page,
  request = "Weise V-1042 Lea Sommer zu und speichere.",
) {
  await page.getByRole("button", { name: /Jev · Befehl eingeben/ }).click();
  await page.getByRole("textbox", { name: "Auftrag an Jev" }).fill(request);
  await page.getByRole("button", { name: "Ausführen" }).click();
}
