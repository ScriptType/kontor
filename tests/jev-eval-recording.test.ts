import assert from "node:assert/strict";
import { test } from "node:test";
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import {
  recordingFetch,
  type Budget,
  type CallRecord,
} from "../scripts/jev-eval/harness.js";

const usage = { input_tokens: 40, output_tokens: 3 };
const answers = {
  next: {
    type: "choice",
    choice: "save",
    confidence: 0.62,
    probabilities: { save: 0.62, done: 0.38 },
  },
};
const questions = {
  next: choice("Choose ONE", { save: "Save", done: "Done" }),
};
function recorder(options: {
  recordPayloads?: boolean;
  limit?: number;
  respond?: () => Response;
}) {
  const callLog: CallRecord[] = [];
  const refused: string[] = [];
  const budget: Budget = { used: 0, limit: options.limit ?? 5 };
  const respond = options.respond ?? (() => Response.json({ answers, usage }));
  let sent = 0;
  const client = new TypeSafeClient({
    apiKey: "test",
    defaultModel: "jev-latest",
    retry: { maxRetries: 0 },
    logLevel: "off",
    fetch: recordingFetch({
      budget,
      callLog,
      refused,
      maxCalls: 5,
      recordPayloads: options.recordPayloads ?? false,
      fetch: async () => {
        sent++;
        return respond();
      },
    }),
  });
  return {
    ask: () => client.systemOne({ state: '{"page":"cases"}', questions }),
    callLog,
    refused,
    budget,
    sent: () => sent,
  };
}
async function call(recordPayloads: boolean) {
  const recording = recorder({ recordPayloads });
  await recording.ask();
  return recording;
}

test("a recorded call keeps the exact request body, the provider's answers and its usage", async () => {
  const { callLog, budget } = await call(true);
  assert.equal(budget.used, 1);
  assert.deepEqual(
    callLog.map(({ ms: _, ...rest }) => rest),
    [
      {
        question: "next",
        choice: "save",
        confidence: 0.62,
        probabilities: { save: 0.62, done: 0.38 },
        payload: {
          request: {
            state: '{"page":"cases"}',
            questions,
            model: "jev-latest",
          },
          answers,
          usage,
        },
      },
    ],
  );
});
test("without recording the call log holds no payload", async () => {
  const { callLog } = await call(false);
  assert.equal(callLog.length, 1);
  assert.equal("payload" in callLog[0]!, false);
  assert.equal(callLog[0]!.choice, "save");
});
test("a call past the eval budget is refused unsent and the refusal is kept for the sample", async () => {
  const recording = recorder({ limit: 1 });
  await recording.ask();
  await assert.rejects(recording.ask());
  assert.equal(recording.sent(), 1);
  assert.equal(recording.callLog.length, 1);
  assert.deepEqual(recording.refused, ["Eval call budget exhausted"]);
});
