import type { Page } from "@playwright/test";
import { once } from "node:events";
import { z } from "zod";
import { createApp } from "../server/app.js";
import { WorkspaceStore } from "../server/workspace-store.js";
export function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
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
  ) => Promise<void>,
  options: {
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
  } = {},
) {
  const held = barrier(),
    arrived = barrier();
  let heldOnce = false;
  const snapshots: string[][] = [];
  const observations: unknown[] = [];
  const store = new WorkspaceStore(":memory:");
  const app = createApp(
    { mode: "live", apiKey: "test", model: "jev-latest" },
    async (_url, init) => {
      const payload = z
        .object({
          state: z.string(),
          questions: z.record(
            z.string(),
            z.object({ criteria: z.record(z.string(), z.string()) }),
          ),
        })
        .parse(JSON.parse(String(init?.body)));
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
            : next === "done"
              ? options.outstanding
                ? "outstanding"
                : (options.completionVerdict ?? "complete")
              : options.forbidCommit && commit
                ? "forbidden"
                : (options.assessment ?? "authorized"));
      if (key === "next") {
        observations.push(JSON.parse(payload.state));
        snapshots.push(Object.keys(payload.questions["next"]?.criteria ?? {}));
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
    },
    store,
  );
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await run(store, held, arrived.promise, snapshots, observations);
  } finally {
    held.release();
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
