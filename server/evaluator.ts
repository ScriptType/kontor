import {
  TypeSafeClient,
  choice,
  score,
  noul,
  type Fetch,
} from "@typesafe-ai/sdk";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
  answersSchema,
  type Evaluation,
  type EvaluationInput,
} from "../shared/contract.js";
import { scoreCriteria } from "../shared/questions.js";
import type { Config } from "./config.js";
import { providerUnavailable } from "./jev.js";

const questions = {
  category: choice("Welche sprachliche Form überwiegt im Text?", {
    statement: "Aussage",
    question: "Frage",
    request: "Aufforderung",
  }),
  clarity: score("Wie verständlich ist der Text?", scoreCriteria),
  containsAction: noul("Enthält der Text eine konkrete Handlungsaufforderung?"),
};
const providerSchema = z.object({
  model: z.string().min(1),
  answers: answersSchema,
});
const fixture: Evaluation = {
  mode: "demo",
  model: null,
  answers: {
    category: {
      type: "choice",
      choice: "request",
      confidence: 0.82,
      probabilities: { statement: 0.12, question: 0.06, request: 0.82 },
    },
    clarity: {
      type: "score",
      score: 1.7,
      confidence: 0.8,
      probabilities: { "0": 0.05, "1": 0.2, "2": 0.75 },
    },
    containsAction: { type: "noul", noul: 0.91 },
  },
};
export function createEvaluator(config: Config, fetch?: Fetch) {
  if (config.mode === "demo")
    return async (
      _input: EvaluationInput,
      _signal?: AbortSignal,
    ): Promise<Evaluation> => fixture;
  const client = new TypeSafeClient({
    apiKey: config.apiKey,
    defaultModel: config.model,
    baseURL: "https://api.typesafe.ai",
    timeout: 10_000,
    retry: { maxRetries: 0 },
    logLevel: "off",
    fetch,
  });
  return async (
    input: EvaluationInput,
    signal?: AbortSignal,
  ): Promise<Evaluation> => {
    let raw: unknown;
    try {
      raw = await client.systemOne(
        { state: input.text, questions },
        { signal },
      );
    } catch (cause) {
      throw providerUnavailable(
        cause,
        "TypeSafe ist gerade nicht erreichbar. Bitte erneut versuchen.",
      );
    }
    const parsed = providerSchema.safeParse(raw);
    if (!parsed.success)
      throw new ORPCError("PROVIDER_INVALID_RESPONSE", {
        message:
          "TypeSafe hat eine ungültige Antwort geliefert. Bitte erneut versuchen.",
      });
    return { mode: "live", ...parsed.data };
  };
}
