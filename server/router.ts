import { implement } from "@orpc/server";
import type { Fetch } from "@typesafe-ai/sdk";
import { contract } from "../shared/contract.js";
import type { Config } from "./config.js";
import { createEvaluator } from "./evaluator.js";

export function createRouter(config: Config, fetch?: Fetch) {
  const evaluate = createEvaluator(config, fetch);
  const os = implement(contract);
  return os.router({
    status: os.status.handler(() =>
      config.mode === "demo"
        ? { mode: "demo", model: null }
        : { mode: "live", model: config.model },
    ),
    evaluate: os.evaluate.handler(({ input, signal }) =>
      evaluate(input, signal),
    ),
  });
}
