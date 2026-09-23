import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fetch } from "@typesafe-ai/sdk";
import { createPlanner, type PlanScene } from "../server/plan.js";
import { defaultCaseFilters, seedWorkspace } from "../shared/domain.js";

const live = { mode: "live", apiKey: "test", model: "jev-latest" } as const;
const scene: PlanScene = {
  request: "Zeig mir die Kunden.",
  page: "cases",
  filters: defaultCaseFilters,
  selectedCase: null,
  workspace: seedWorkspace(),
};
type Questions = Record<
  string,
  { type: string; criteria?: Record<string, string> }
>;
/** Answers yes only to the named nouls and the first option of each choice, or what `choose` returns. */
function provider(
  yes: string[],
  sent: Questions[],
  choose = (options: string[]) => options[0] ?? "",
): Fetch {
  return async (_url, init) => {
    const { questions } = JSON.parse(String(init?.body)) as {
      questions: Questions;
    };
    sent.push(questions);
    return Response.json({
      model: "test",
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => {
          if (question.type === "noul")
            return [key, { type: "noul", noul: yes.includes(key) ? 1 : 0 }];
          const options = Object.keys(question.criteria ?? {});
          const choice = choose(options);
          return [
            key,
            {
              type: "choice",
              choice,
              confidence: 1,
              probabilities: Object.fromEntries(
                options.map((option) => [option, option === choice ? 1 : 0]),
              ),
            },
          ];
        }),
      ),
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  };
}

test("demo mode has no plan", async () => {
  assert.equal(await createPlanner({ mode: "demo" })(scene), null);
});

test("a single-step request is read in one call and skips empty follow-up questions", async () => {
  const sent: Questions[] = [];
  const plan = await createPlanner(
    live,
    provider(["s0.page.customers"], sent),
  )(scene);
  assert.equal(sent.length, 1);
  assert.deepEqual(plan, {
    segments: ["Zeig mir die Kunden."],
    cases: {},
    sequence: {},
    filters: {},
    visits: ["customers"],
    flags: { noSave: false, unsupported: false },
  });
});

test("an answer outside the offered options or a failed call is a provider error", async () => {
  await assert.rejects(
    createPlanner(
      live,
      provider([], [], () => "invented"),
    )(scene),
    { code: "PROVIDER_INVALID_RESPONSE" },
  );
  await assert.rejects(
    createPlanner(live, async () => {
      throw new Error("offline");
    })(scene),
    { code: "PROVIDER_UNAVAILABLE" },
  );
});
