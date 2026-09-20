import { ORPCError, implement } from "@orpc/server";
import type { Fetch } from "@typesafe-ai/sdk";
import { contract } from "../shared/contract.js";
import type { Config } from "./config.js";
import { createEvaluator } from "./evaluator.js";

import { WorkspaceStore } from "./workspace-store.js";
import { blockers } from "../shared/domain.js";
import { createJev } from "./jev.js";

export function createRouter(
  config: Config,
  fetch?: Fetch,
  store = new WorkspaceStore(),
) {
  const jev = createJev(config, fetch);
  const evaluate = createEvaluator(config, fetch);
  const os = implement(contract);
  return os.router({
    remedy: os.remedy.handler(({ input, signal }) => {
      const workspace = store.snapshot();
      if (workspace.revision !== input.revision)
        throw new ORPCError("CONFLICT");
      const original = workspace.cases.find((c) => c.id === input.caseId);
      if (!original) throw new ORPCError("NOT_FOUND");
      const ids =
        blockers(workspace, { ...original, ...input.draft }).find(
          (b) => b.kind === "conflict" || b.kind === "qualification",
        )?.alternatives ?? [];
      return jev.remedy(
        input.request,
        ids.map((id) => ({
          id,
          label: workspace.technicians.find((t) => t.id === id)?.name ?? id,
        })),
        JSON.stringify({
          before: original,
          requested: input.draft,
          revision: input.revision,
        }),
        signal,
      );
    }),
    workspace: os.workspace.handler(() => store.snapshot()),
    resetWorkspace: os.resetWorkspace.handler(({ input }) =>
      store.reset(input.expectedRevision),
    ),
    saveCase: os.saveCase.handler(({ input }) => store.save(input)),
    receipt: os.receipt.handler(({ input }) =>
      store.receipt(input.operationId),
    ),
    interpret: os.interpret.handler(({ input, signal }) =>
      jev.interpret(input.text, store.snapshot(), signal),
    ),
    decide: os.decide.handler(({ input, signal }) => jev.decide(input, signal)),
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
