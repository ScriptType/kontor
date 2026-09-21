import { TypeSafeClient, choice, type Fetch } from "@typesafe-ai/sdk";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
  demos,
  type DecisionInput,
  type assessmentInputSchema,
} from "../shared/command.js";
import type { Config } from "./config.js";
const answerSchema = z.object({
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
type Answer = z.infer<typeof answerSchema>["answers"][string];
export function createJev(config: Config, fetch?: Fetch) {
  const client =
    config.mode === "live"
      ? new TypeSafeClient({
          apiKey: config.apiKey,
          defaultModel: config.model,
          baseURL: "https://api.typesafe.ai",
          retry: { maxRetries: 0 },
          timeout: 10000,
          logLevel: "off",
          fetch,
        })
      : null;
  async function ask(
    state: string,
    questions: Record<
      string,
      { text: string; options: Record<string, string> }
    >,
    signal?: AbortSignal,
  ) {
    if (!client) throw new Error("Live client missing");
    let raw: unknown;
    try {
      raw = await client.systemOne(
        {
          state,
          questions: Object.fromEntries(
            Object.entries(questions).map(([key, q]) => [
              key,
              choice(q.text, q.options),
            ]),
          ),
        },
        { signal },
      );
    } catch {
      throw new ORPCError("PROVIDER_UNAVAILABLE", {
        message:
          "Jev ist nicht erreichbar. Es wurde keine Entscheidung ausgeführt.",
      });
    }
    const parsed = answerSchema.safeParse(raw);
    if (!parsed.success) throw new ORPCError("PROVIDER_INVALID_RESPONSE");
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(questions)) {
      const answer = parsed.data.answers[key];
      if (!answer || !Object.hasOwn(question.options, answer.choice))
        throw new ORPCError("PROVIDER_INVALID_RESPONSE");
      answers[key] = answer;
    }
    return answers;
  }
  return {
    async decide(input: DecisionInput, signal?: AbortSignal) {
      if (!client)
        return {
          snapshotId: input.snapshotId,
          choice: fixture(input),
          confidence: 1,
        };
      const options = Object.fromEntries(
        input.actions
          .filter((a) => !a.id.startsWith("blocked:"))
          .map((a) => [a.id, `${a.label}. ${a.effect}. Effect ${a.kind}`]),
      );
      for (const field of input.fields)
        options[`ask:${field.id}`] =
          `Ask the user for a missing ${field.label} value (${field.type}), only if the request and previous answers do not supply it.`;
      options["done"] =
        "Every part of the original request is satisfied, in its requested order. Drafts are not saved changes.";
      options["blocked"] =
        "Outstanding request work cannot proceed with available controls or needs human evidence. Never silently omit a trailing task.";
      const answers = await ask(
        JSON.stringify(modelState(input)),
        {
          next: {
            text: "Choose ONE currently offered UI action toward the entire original request. Use observed history to remember earlier work and explicit order. Repeated assignments and multiple records are allowed. Saves are stepwise; earlier saved work remains if later work is blocked. Do not invent values or evidence. Select done only when nothing remains; select blocked for unsupported remaining work. A menu, navigation or input is a real intermediate step. Displayed records and unfinished checklists are context, not additional requested tasks. A restriction applies only to its owning action and target. Displaying a requested list does not require opening, completing, editing or saving its records.",
            options,
          },
        },
        signal,
      );
      const answer = answers["next"];
      if (!answer) throw new ORPCError("PROVIDER_INVALID_RESPONSE");
      if (
        answer.choice === "blocked" &&
        answer.confidence >= 0.75 &&
        input.blockedControls.length
      ) {
        const causes = Object.fromEntries(
          input.blockedControls.map((control) => [
            `blocked:${control.action.id}`,
            JSON.stringify(control),
          ]),
        );
        const answers = await ask(
          JSON.stringify(modelState(input)),
          {
            cause: {
              text: "Which captured disabled action is required to satisfy the original request and explains the blockage? Choose unknown if none is required or the cause is uncertain. Displayed records and unfinished checklists do not add tasks. This identifies guidance only and authorizes no action, change or evidence.",
              options: {
                ...causes,
                unknown: "No established required disabled action.",
              },
            },
          },
          signal,
        );
        const cause = answers["cause"];
        if (!cause) throw new ORPCError("PROVIDER_INVALID_RESPONSE");
        return {
          snapshotId: input.snapshotId,
          choice:
            cause.choice !== "unknown" && cause.confidence >= 0.75
              ? cause.choice
              : "blocked",
          confidence: Math.min(answer.confidence, cause.confidence),
        };
      }
      return {
        snapshotId: input.snapshotId,
        choice: answer.choice,
        confidence: answer.confidence,
      };
    },
    async assess(
      input: z.infer<typeof assessmentInputSchema>,
      signal?: AbortSignal,
    ) {
      if (!client)
        return {
          snapshotId: input.snapshotId,
          verdict:
            input.selected === "done"
              ? ("complete" as const)
              : ("authorized" as const),
          confidence: 1,
        };
      const options: Record<string, string> =
        input.selected === "done"
          ? {
              complete:
                "The entire original request is satisfied by observed steps and current screen facts, respecting order. Navigation, search, filters and requested drafts need no save receipt. Requested persisted changes need matching receipts.",
              outstanding:
                "Some requested work remains, including unsupported trailing tasks or work not yet observed.",
              unclear: "Cannot establish that all original work is satisfied.",
            }
          : {
              authorized:
                "The original request or explicit user answers authorize this EXACT target, value and effect. For commit, every changed field and saving itself are authorized.",
              additional:
                "This is a useful additional change or ambiguous effect, requiring explicit user approval before execution.",
              forbidden:
                "This contradicts the request, including saving a no-save draft, discarding requested work, wrong target/value/order, or fabricating evidence.",
              unclear:
                "Authority for this concrete effect is unclear; ask the user.",
            };
      const answers = await ask(
        JSON.stringify(modelState(input)),
        {
          assessment: {
            text:
              input.selected === "done"
                ? "Independently inspect the FULL original request against observed history and current screen facts. Is the entire request satisfied? Read-only UI work and no-save drafts do not need receipts; requested saves do. A trailing unsupported task remains outstanding. Do not assume proposed done is correct. Displayed records and unfinished checklists are context, not additional requested tasks. Restrictions apply only to their owning action and target. Displaying a requested list does not require opening, completing, editing or saving its records."
                : "Evaluate authority for selected, a concrete effect already chosen. A necessary prerequisite is not permission for an extra mutation. Saving must cover exactly the authorized draft, and explicit no-save always forbids commit.",
            options,
          },
        },
        signal,
      );
      const answer = answers["assessment"];
      if (!answer) throw new ORPCError("PROVIDER_INVALID_RESPONSE");
      return {
        snapshotId: input.snapshotId,
        verdict: z
          .enum([
            "authorized",
            "additional",
            "forbidden",
            "complete",
            "outstanding",
            "unclear",
          ])
          .parse(answer.choice),
        confidence: answer.confidence,
      };
    },
  };
}
function fixture(input: DecisionInput): string {
  const sequences: Record<string, string[]> = {
    [demos[0]]: ["nav:customers"],
    [demos[1]]: ["nav:customers", "nav:reports", "nav:team"],
    [demos[2]]: ["case:V-1042", "menu:technician", "technician:lea", "save"],
    [demos[3]]: ["case:V-1042", "field:minutes:45", "save"],
    [demos[4]]: [
      "case:V-1042",
      ...(input.answers.find((a) => a.fieldId === "minutes")
        ? [
            `field:minutes:${input.answers.find((a) => a.fieldId === "minutes")?.value}`,
            "save",
          ]
        : ["ask:minutes"]),
    ],
  };
  const sequence = sequences[input.request];
  if (!sequence) return "blocked";
  const next = sequence[input.steps.length];
  if (!next) return "done";
  return input.actions.some((a) => a.id === next) ||
    input.fields.some((f) => `ask:${f.id}` === next)
    ? next
    : "blocked";
}

function modelState(input: DecisionInput & { selected?: unknown }) {
  return {
    snapshotId: input.snapshotId,
    originalRequest: input.request,
    explicitAnswers: input.answers,
    currentFacts: JSON.parse(input.context),
    observedSteps: input.steps.map((step) => ({
      action: step.action,
      authorizedBy: step.authorizedBy,
      before: JSON.parse(step.before),
      after: JSON.parse(step.after),
    })),
    availableActions: input.actions,
    availableFields: input.fields,
    blockedControls: input.blockedControls,
    ...(input.selected === undefined ? {} : { selected: input.selected }),
  };
}
