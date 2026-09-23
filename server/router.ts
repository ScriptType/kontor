import { implement } from "@orpc/server";
import type { Fetch } from "@typesafe-ai/sdk";
import { contract } from "../shared/contract.js";
import type { Config } from "./config.js";
import { createEvaluator } from "./evaluator.js";

import { WorkspaceStore } from "./workspace-store.js";
import { createJev } from "./jev.js";
import { createPlanner } from "./plan.js";

export function createRouter(
  config: Config,
  fetch?: Fetch,
  store = new WorkspaceStore(),
) {
  const jev = createJev(config, fetch);
  const evaluate = createEvaluator(config, fetch);
  const plan = createPlanner(config, fetch);
  const os = implement(contract);
  return os.router({
    workspace: os.workspace.handler(() => store.snapshot()),
    resetWorkspace: os.resetWorkspace.handler(({ input }) =>
      store.reset(input.expectedRevision),
    ),
    saveCase: os.saveCase.handler(({ input }) => store.save(input)),
    receipt: os.receipt.handler(({ input }) =>
      store.receipt(input.operationId),
    ),
    assess: os.assess.handler(({ input, signal }) => jev.assess(input, signal)),
    decide: os.decide.handler(({ input, signal }) => jev.decide(input, signal)),
    plan: os.plan.handler(({ input, signal }) =>
      plan({ ...input, workspace: store.snapshot() }, signal),
    ),
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
