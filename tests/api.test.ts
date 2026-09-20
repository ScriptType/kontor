import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { RouterContractClient } from "@orpc/contract";
import { WebSocket } from "ws";
import { createRpcConnection } from "../frontend/src/rpc-connection.js";
import type { Fetch } from "@typesafe-ai/sdk";
import { z } from "zod";
import { contract } from "../shared/contract.js";
import { createApp } from "../server/app.js";
import { readConfig, type Config } from "../server/config.js";

async function withApi(
  config: Config,
  fetch: Fetch,
  run: (
    api: RouterContractClient<typeof contract>,
    invalidInput: (input: unknown) => Promise<unknown>,
  ) => Promise<void>,
) {
  const app = createApp(config, fetch);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address !== "string");
  const url = `ws://127.0.0.1:${address.port}/rpc`;
  const connection = createRpcConnection({
    url,
    createSocket: (url) => new WebSocket(url),
  });
  const invalidSocket = new WebSocket(url);
  const untyped = createORPCClient<{
    evaluate: (input: unknown) => Promise<unknown>;
  }>(new RPCLink({ connect: () => invalidSocket }));
  try {
    await run(connection.client, untyped.evaluate);
  } finally {
    connection.close();
    invalidSocket.close();
    await app.close();
  }
}

const live: Config = {
  mode: "live",
  apiKey: "secret-test-key",
  model: "jev-latest",
};
const response = {
  model: "jev-test-resolved",
  answers: {
    category: {
      type: "choice",
      choice: "request",
      confidence: 0.8,
      probabilities: { statement: 0.1, question: 0.1, request: 0.8 },
    },
    clarity: {
      type: "score",
      score: 1.65,
      confidence: 0.75,
      probabilities: { "0": 0.1, "1": 0.15, "2": 0.75 },
      legend: { "0": "a", "1": "b", "2": "c" },
    },
    containsAction: { type: "noul", noul: 0.9 },
  },
  usage: { input_tokens: 10, output_tokens: 5 },
};

test("demo is the default even with a key and never calls upstream", async () => {
  const config = readConfig({ TYPESAFE_API_KEY: "unused-key" });
  assert.deepEqual(config, { mode: "demo" });
  await withApi(
    config,
    async () => {
      throw new Error("upstream must not run");
    },
    async (api) => {
      assert.deepEqual(await api.status(), { mode: "demo", model: null });
      const first = await api.evaluate({ text: "Hello" });
      assert.equal(first.mode, "demo");
      assert.equal(first.answers.category.choice, "request");
      assert.equal(first.answers.clarity.score, 1.7);
      assert.equal(first.answers.containsAction.noul, 0.91);
      assert.deepEqual(await api.evaluate({ text: "Different input?" }), first);
    },
  );
});
test("input rejects wrong types, blank and overlong text across WebSocket", async () => {
  await withApi(
    { mode: "demo" },
    async () => {
      throw new Error("upstream must not run");
    },
    async (api, invalidInput) => {
      await assert.rejects(
        invalidInput({ text: 42 }),
        (error) => error instanceof ORPCError && error.code === "BAD_REQUEST",
      );
      for (const text of ["", "  \n", "x".repeat(20_001)]) {
        await assert.rejects(
          api.evaluate({ text }),
          (error) => error instanceof ORPCError && error.code === "BAD_REQUEST",
        );
      }
    },
  );
});
test("live requires an explicit mode and nonblank credentials", () => {
  for (const env of [
    { TYPESAFE_MODE: "live" },
    { TYPESAFE_MODE: "live", TYPESAFE_API_KEY: " " },
    { TYPESAFE_MODE: "typo" },
  ])
    assert.throws(() => readConfig(env));
});
test("live sends all questions through SDK and preserves fractional score and resolved model", async () => {
  let requests = 0;
  await withApi(
    live,
    async (url, init) => {
      requests++;
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert(init?.signal);
      assert.equal(typeof init.body, "string");
      const payload = z
        .object({
          state: z.string(),
          model: z.string(),
          questions: z.object({
            category: z.object({ type: z.literal("choice") }),
            clarity: z.object({
              type: z.literal("score"),
              criteria: z.array(z.string()).length(3),
            }),
            containsAction: z.object({ type: z.literal("noul") }),
          }),
        })
        .parse(JSON.parse(String(init.body)));
      assert.equal(payload.state, "Bitte prüfen");
      assert.equal(payload.model, "jev-latest");
      return Response.json(response);
    },
    async (api) => {
      assert.deepEqual(await api.status(), {
        mode: "live",
        model: "jev-latest",
      });
      const result = await api.evaluate({ text: " Bitte prüfen " });
      assert.equal(result.mode, "live");
      assert.equal(result.model, "jev-test-resolved");
      assert.equal(result.answers.clarity.score, 1.65);
      assert.equal(result.answers.containsAction.noul, 0.9);
    },
  );
  assert.equal(requests, 1);
});
for (const [name, upstream, code] of [
  [
    "malformed output",
    () =>
      Response.json({
        ...response,
        answers: {
          ...response.answers,
          clarity: { ...response.answers.clarity, score: 9 },
        },
      }),
    "PROVIDER_INVALID_RESPONSE",
  ],
  [
    "provider error",
    () =>
      Response.json(
        { error: "secret-test-key confidential upstream details" },
        { status: 503 },
      ),
    "PROVIDER_UNAVAILABLE",
  ],
] satisfies [string, () => Response, string][]) {
  test(`${name} yields a safe error without retry or fallback`, async () => {
    let requests = 0;
    await withApi(
      live,
      async () => {
        requests++;
        return upstream();
      },
      async (api) => {
        await assert.rejects(api.evaluate({ text: "Hello" }), (error) => {
          assert(error instanceof ORPCError);
          assert.equal(error.code, code);
          assert(!JSON.stringify(error).includes("secret-test-key"));
          assert(!JSON.stringify(error).includes("confidential"));
          return true;
        });
      },
    );
    assert.equal(requests, 1);
  });
}
