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

test("an assignment is read even when a choice over all people would name the current assignee", async () => {
  const request =
    "zeig die offenen vorgänge von jonas weber.\nWähle den ersten aus und gib den lea";
  const sent: Questions[] = [];
  const asksAbout = (text: string) => (question: { instructions?: string }) =>
    question.instructions?.includes(text) ?? false;
  const plan = await createPlanner(live, async (_url, init) => {
    const { questions } = JSON.parse(String(init?.body)) as {
      questions: Record<
        string,
        {
          type: string;
          instructions?: string;
          criteria?: Record<string, string>;
        }
      >;
    };
    sent.push(questions);
    const yes = (question: { instructions?: string }) =>
      asksAbout("act on case V-1041 (")(question) ||
      (asksAbout("change this field of case V-1041 (")(question) &&
        asksAbout("The technician assigned")(question)) ||
      asksAbout("make Lea Sommer the value of this field of case V-1041 (")(
        question,
      );
    return Response.json({
      model: "test",
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => {
          if (question.type === "noul")
            return [key, { type: "noul", noul: yes(question) ? 0.8 : 0.1 }];
          const options = Object.keys(question.criteria ?? {});
          // The recorded model answer: the person the list is filtered by, not the one named for the case.
          const choice = options.includes("jonas") ? "jonas" : options[0];
          return [
            key,
            {
              type: "choice",
              choice,
              confidence: 0.7,
              probabilities: Object.fromEntries(
                options.map((option) => [
                  option,
                  option === choice ? 0.7 : 0.3 / (options.length - 1),
                ]),
              ),
            },
          ];
        }),
      ),
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  })({ ...scene, request });
  assert.deepEqual(plan?.cases, { "V-1041": { technician: "lea" } });
});
