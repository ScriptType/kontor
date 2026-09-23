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
  return scripted(
    Object.fromEntries(yes.map((key) => [key, 1])),
    sent,
    (_key, options) => choose(options),
  );
}
/** Answers each yes/no with its number in `yes` (else 0) and each choice with the option `choose` names for its key. */
function scripted(
  yes: Record<string, number>,
  sent: Questions[],
  choose = (_key: string, options: string[]) => options[0] ?? "",
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
            return [key, { type: "noul", noul: yes[key] ?? 0 }];
          const options = Object.keys(question.criteria ?? {});
          const choice = choose(key, options);
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

/**
 * Reads the user's request with the answers the model gave on it: the case,
 * its assignee and, wrongly, its status change; a choice over all people names
 * jonas, the person the list is filtered by, a status choice says done, the
 * yes/no for Lea is `lea` and every other yes/no is 0.1.
 */
function readAssignment(lea: number) {
  const request =
    "zeig die offenen vorgänge von jonas weber.\nWähle den ersten aus und gib den lea";
  const asksAbout = (text: string) => (question: { instructions?: string }) =>
    question.instructions?.includes(text) ?? false;
  return createPlanner(live, async (_url, init) => {
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
    const yes = (question: { instructions?: string }) =>
      asksAbout("act on case V-1041 (")(question) ||
      (asksAbout("change this field of case V-1041 (")(question) &&
        (asksAbout("The technician assigned")(question) ||
          asksAbout("The case status")(question)))
        ? 0.8
        : asksAbout("make Lea Sommer the value of this field of case V-1041 (")(
              question,
            )
          ? lea
          : 0.1;
    return Response.json({
      model: "test",
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => {
          if (question.type === "noul")
            return [key, { type: "noul", noul: yes(question) }];
          const options = Object.keys(question.criteria ?? {});
          const choice = options.includes("jonas")
            ? "jonas"
            : options.includes("done")
              ? "done"
              : options[0];
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
}

test("an assignment is read even when a choice over all people would name the current assignee", async () => {
  assert.deepEqual((await readAssignment(0.8))?.cases, {
    "V-1041": { technician: "lea" },
  });
});

test("a status change whose own yes/no is low does not complete the case", async () => {
  assert.equal((await readAssignment(0.8))?.cases["V-1041"]?.status, undefined);
});

test("an assignee change that names no person changes nobody", async () => {
  assert.deepEqual((await readAssignment(0.1))?.cases, { "V-1041": {} });
});

test("a status filter is read from its own yes/no per value", async () => {
  const plan = await createPlanner(
    live,
    provider(["s0.fis.statusFilter.open"], []),
  )({ ...scene, request: "Zeig die offenen Vorgänge." });
  assert.deepEqual(plan?.filters, { statusFilter: "open" });
});

test("a sentence that ends a line ends its part without asking", async () => {
  const sent: Questions[] = [];
  const plan = await createPlanner(
    live,
    provider(["g6"], sent),
  )({
    ...scene,
    request: "zeig die offenen vorgänge von jonas weber.\nWähle den ersten aus",
  });
  assert.deepEqual(plan?.segments, [
    "zeig die offenen vorgänge von jonas weber.",
    "Wähle den ersten aus",
  ]);
  assert.equal(
    sent.flatMap((questions) => Object.keys(questions)).includes("g6"),
    false,
  );
});

/** Plans the request with the scripted answers. */
function planOf(
  request: string,
  yes: Record<string, number>,
  choices: Record<string, string> = {},
  sent: Questions[] = [],
) {
  return createPlanner(
    live,
    scripted(yes, sent, (key, options) => choices[key] ?? options[0] ?? ""),
  )({ ...scene, request });
}

test("a slot length read for a case without an appointment is its worked minutes", async () => {
  const plan = await planOf(
    "1037 bitte 75 min eintragen",
    { "s0.case.V-1037": 1, "s0.V-1037.chg.appointmentDuration": 1 },
    { "s0.V-1037.val.appointmentDuration": "75" },
  );
  assert.deepEqual(plan?.cases, { "V-1037": { workedMinutes: "75" } });
});

test("two views read at the same word keep the likelier one", async () => {
  const plan = await planOf(
    "danach wieder zur liste",
    { "s0.page.cases": 0.9, "s0.page.customers": 0.7 },
    { "s0.at.cases": "w3", "s0.at.customers": "w3" },
  );
  assert.deepEqual(plan?.visits, ["cases"]);
});
