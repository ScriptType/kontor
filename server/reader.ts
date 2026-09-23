import { choice, type Fetch, type Questions } from "@typesafe-ai/sdk";
import type { Workspace } from "../shared/domain.js";
import {
  readers,
  readingKind,
  type PartPick,
  type ReadInput,
  type ValueReading,
} from "../shared/value-reading.js";
import type { Config } from "./config.js";
import { createClient, providerUnavailable } from "./jev.js";
import { readAnswers, type Ask } from "./plan.js";

/** Reads each field's new value from the request in one call; a field without a reading kind reads as null. */
export async function readValues(
  input: ReadInput,
  workspace: Workspace,
  ask: Ask,
): Promise<(ValueReading | null)[]> {
  const kinds = input.fields.map(readingKind);
  const scene = {
    request: input.request,
    today: input.today,
    cases: workspace.cases,
  };
  const questions: Questions = {};
  input.fields.forEach((field, i) => {
    const kind = kinds[i];
    if (!kind) return;
    for (const [part, { text, options }] of Object.entries(
      readers[kind].parts(field, scene),
    ))
      questions[`f${i}.${part}`] = choice(text, options);
  });
  if (!Object.keys(questions).length) return input.fields.map(() => null);
  const answers = await ask({
    state: {
      auftrag: input.request,
      heute: input.today,
      vorgänge: workspace.cases.map((c) => ({
        id: c.id,
        titel: c.title,
        kunde:
          workspace.customers.find((k) => k.id === c.customerId)?.name ??
          c.customerId,
        standort: c.site,
      })),
    },
    questions,
  });
  return input.fields.map((field, i) => {
    const kind = kinds[i];
    if (!kind) return null;
    const picks: Record<string, PartPick> = {};
    for (const [key, answer] of Object.entries(answers))
      if (key.startsWith(`f${i}.`) && answer.type === "choice")
        picks[key.slice(`f${i}.`.length)] = {
          choice: answer.choice,
          confidence: answer.confidence,
        };
    return readers[kind].assemble(picks, field, scene);
  });
}

export function createReader(config: Config, fetch?: Fetch) {
  if (config.mode !== "live") return async () => null;
  const client = createClient(config, fetch, 30000);
  return async (input: ReadInput, workspace: Workspace, signal?: AbortSignal) =>
    readValues(input, workspace, async (sent) => {
      let raw: unknown;
      try {
        raw = await client.systemOne(sent, { signal });
      } catch (cause) {
        throw providerUnavailable(
          cause,
          "Jev ist nicht erreichbar. Der Wert wurde nicht gelesen.",
        );
      }
      return readAnswers(sent.questions, raw);
    });
}
