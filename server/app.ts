import { Hono } from "hono";
import { COMMON_ERROR_STATUS_MAP, implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { Fetch } from "@typesafe-ai/sdk";
import { contract } from "../shared/contract.js";
import type { Config } from "./config.js";
import { createEvaluator } from "./evaluator.js";

export function createApp(config: Config, fetch?: Fetch) {
  const evaluate = createEvaluator(config, fetch);
  const os = implement(contract);
  const handler = new RPCHandler(
    os.router({
      status: os.status.handler(() =>
        config.mode === "demo"
          ? { mode: "demo", model: null }
          : { mode: "live", model: config.model },
      ),
      evaluate: os.evaluate.handler(({ input, signal }) =>
        evaluate(input, signal),
      ),
    }),
    {
      errorStatusMap: {
        ...COMMON_ERROR_STATUS_MAP,
        PROVIDER_UNAVAILABLE: 502,
        PROVIDER_INVALID_RESPONSE: 502,
      },
    },
  );
  return new Hono().use("/rpc/*", async (c, next) => {
    const result = await handler.handle(c.req.raw, { prefix: "/rpc" });
    if (result.matched)
      return c.newResponse(result.response.body, result.response);
    await next();
  });
}
