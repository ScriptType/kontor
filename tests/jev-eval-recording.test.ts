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
async function call(recordPayloads: boolean) {
  const callLog: CallRecord[] = [];
  const budget: Budget = { used: 0, limit: 5 };
  const client = new TypeSafeClient({
    apiKey: "test",
    defaultModel: "jev-latest",
    retry: { maxRetries: 0 },
    logLevel: "off",
    fetch: recordingFetch({
      budget,
      callLog,
      maxCalls: 5,
      recordPayloads,
      fetch: async () => Response.json({ answers, usage }),
    }),
  });
  const questions = {
    next: choice("Choose ONE", { save: "Save", done: "Done" }),
  };
  await client.systemOne({ state: '{"page":"cases"}', questions });
  return { callLog, budget, questions };
}

test("a recorded call keeps the exact request body, the provider's answers and its usage", async () => {
  const { callLog, budget, questions } = await call(true);
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
