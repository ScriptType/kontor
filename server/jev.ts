import {
  APIError,
  TypeSafeClient,
  choice,
  type Fetch,
} from "@typesafe-ai/sdk";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
  demos,
  jevAction,
  jevBlockedControl,
  jevFieldName,
  jevText,
  renderJev,
  type Decision,
  type DecisionInput,
  assessmentSchema,
  type assessmentInputSchema,
} from "../shared/command.js";
import { slimObservations, stepLog } from "../shared/step-log.js";
import type { Config } from "./config.js";
const answerSchema = z.object({
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: z.number().min(0).max(1),
      probabilities: z.record(z.string(), z.number().min(0).max(1)),
    }),
  ),
});
type Answer = z.infer<typeof answerSchema>["answers"][string];
export function createClient(
  config: Extract<Config, { mode: "live" }>,
  fetch?: Fetch,
  timeout = 10000,
) {
  return new TypeSafeClient({
    apiKey: config.apiKey,
    defaultModel: config.model,
    baseURL: "https://api.typesafe.ai",
    retry: { maxRetries: 0 },
    timeout,
    logLevel: "off",
    fetch,
  });
}
/**
 * A failed provider call: the user sees `message`; `data` names the SDK error
 * and the HTTP status when a response arrived, so a rate limit, a payment
 * error and a rejected request read apart. The upstream body stays out.
 */
export function providerUnavailable(cause: unknown, message: string) {
  return new ORPCError("PROVIDER_UNAVAILABLE", {
    message,
    data: {
      error: cause instanceof Error ? cause.name : "unknown",
      status: cause instanceof APIError ? cause.status : null,
    },
    cause,
  });
}
export function createJev(config: Config, fetch?: Fetch) {
  const client = config.mode === "live" ? createClient(config, fetch) : null;
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
    } catch (cause) {
      throw providerUnavailable(
        cause,
        "Jev ist nicht erreichbar. Es wurde keine Entscheidung ausgeführt.",
      );
    }
    const parsed = answerSchema.safeParse(raw);
    if (!parsed.success) throw new ORPCError("PROVIDER_INVALID_RESPONSE");
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(questions)) {
      const answer = parsed.data.answers[key];
      if (
        !answer ||
        !Object.hasOwn(question.options, answer.choice) ||
        Object.keys(answer.probabilities).length !==
          Object.keys(question.options).length ||
        Object.keys(question.options).some(
          (option) => !Object.hasOwn(answer.probabilities, option),
        )
      )
        throw new ORPCError("PROVIDER_INVALID_RESPONSE");
      answers[key] = answer;
    }
    return answers;
  }
  return {
    async decide(
      input: DecisionInput,
      signal?: AbortSignal,
    ): Promise<Decision> {
      // A compact prompt keeps what an option does and its current value; a
      // duel weighs two options and reads each in full.
      const compact = input.prompt === "compact" && !input.duel;
      const offered = Object.fromEntries(
        input.actions
          .filter((a) => !a.id.startsWith("blocked:"))
          .map((a) => [
            a.id,
            compact
              ? renderJev({ does: a.jev.does, row: a.jev.row, now: a.jev.now })
              : `${jevText(a)}. UI "${a.label}", kind ${a.kind}`,
          ]),
      );
      for (const field of input.fields)
        offered[`ask:${field.id}`] = renderJev({
          does: `Ask the user for a missing value of ${jevFieldName(field)}, only if the request and previous answers do not supply it`,
          now: `UI "${field.label}", current value ${field.current === "" ? "empty" : field.current}`,
          notFor: compact ? undefined : field.jev.notFor,
        });
      if (input.doneBeforeFirstStep || input.steps.length > 0)
        offered["done"] =
          "Every part of the original request is satisfied, in its requested order. Drafts are not saved changes.";
      if (input.steps.length > 0 || input.blockedControls.length > 0)
        offered["blocked"] =
          "Outstanding request work cannot proceed with available controls or needs human evidence. Never silently omit a trailing task.";
      offered["abstain"] =
        "Cannot understand the request or choose a sensible next step. Stop automatic work and ask the user to revise or select a suggestion.";
      const { duel } = input;
      const options = duel
        ? Object.fromEntries(
            Object.entries(offered).filter(([option]) => duel.includes(option)),
          )
        : offered;
      if (duel && Object.keys(options).length !== 2)
        throw new ORPCError("BAD_REQUEST", {
          message: "A duel needs two different offered options.",
        });
      if (!client) {
        const fixed = fixture(input);
        const selected = Object.hasOwn(options, fixed)
          ? fixed
          : (duel?.[0] ?? "abstain");
        const probabilities = Object.fromEntries(
          Object.keys(options).map((key) => [key, key === selected ? 1 : 0]),
        );
        return {
          snapshotId: input.snapshotId,
          choice: selected,
          confidence: 1,
          ranked: rank(options, probabilities),
          probabilities,
        };
      }
      const answers = await ask(
        JSON.stringify(modelState(input)),
        {
          next: {
            text: duel
              ? "Two next steps are in question. Choose the ONE that comes next toward the entire original request, respecting any order it states. Prefer a step that still does requested work over stopping; choose a stop (done or blocked) only when no requested work remains that an offered control can do."
              : "Choose ONE currently offered UI action toward the entire original request. Use observed history to remember earlier work and explicit order. Repeated assignments and multiple records are allowed. Already matching saved values can satisfy an assignment without another write. retainedSelection is the saved record, and any unsaved draft, of the selected case whose detail is not on screen: current data, not a visible control. An unchanged step records no change; do not repeat it while its value remains the same. Respect explicitly requested sequences of different assignments. Saves are stepwise; earlier saved work remains if later work is blocked. Do not invent values or evidence. Select done only when nothing remains; select blocked for unsupported remaining work; select abstain when you cannot understand or choose sensibly. A menu, navigation or input is a real intermediate step. Displayed records and unfinished checklists are context, not additional requested tasks. A restriction applies only to its owning action and target. Displaying a requested list does not require opening, completing, editing or saving its records.",
            options,
          },
        },
        signal,
      );
      const answer = answers["next"];
      if (!answer) throw new ORPCError("PROVIDER_INVALID_RESPONSE");
      const decision: Decision = {
        snapshotId: input.snapshotId,
        choice: answer.choice,
        confidence: answer.confidence,
        ranked: rank(options, answer.probabilities),
        probabilities: answer.probabilities,
      };
      if (answer.choice === "blocked" && input.blockedControls.length) {
        const causes = Object.fromEntries(
          input.blockedControls.map((control) => [
            `blocked:${control.action.id}`,
            JSON.stringify(jevBlockedControl(control)),
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
        if (cause.choice !== "unknown")
          decision.blockedCause = {
            controlId: cause.choice.slice("blocked:".length),
            confidence: cause.confidence,
          };
      }
      return decision;
    },
    async assess(
      input: z.infer<typeof assessmentInputSchema>,
      signal?: AbortSignal,
    ) {
      if (!client) {
        const verdict =
          input.selected === "done"
            ? ("complete" as const)
            : ("authorized" as const);
        return {
          snapshotId: input.snapshotId,
          verdict,
          confidence: 1,
          probabilities: { [verdict]: 1 },
        };
      }
      const options: Record<string, string> =
        input.selected === "done"
          ? {
              complete:
                "The entire original request is satisfied by observed steps and current screen facts, respecting order. Navigation, search, filters and requested drafts need no save receipt. New persisted changes need matching receipts. Already matching saved records can satisfy repeated assignments without another write. Equal dirty drafts are not saved records.",
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
                ? "Independently inspect the FULL original request against observed history and current screen facts. Is the entire request satisfied? Read-only UI work and no-save drafts do not need receipts; new requested saves do. Already matching saved records need no duplicate write; dirty draft equality is not persisted evidence. retainedSelection is the saved record, and any unsaved draft, of the selected case whose detail is not on screen: current data, not a visible control. A trailing unsupported task remains outstanding. Do not assume proposed done is correct. Displayed records and unfinished checklists are context, not additional requested tasks. Restrictions apply only to their owning action and target. Displaying a requested list does not require opening, completing, editing or saving its records."
                : "Evaluate authority for selected, a concrete effect already chosen. A necessary prerequisite is not permission for an extra mutation. Saving must cover exactly the authorized draft, and explicit no-save always forbids commit.",
            options,
          },
        },
        signal,
      );
      const answer = answers["assessment"];
      if (!answer) throw new ORPCError("PROVIDER_INVALID_RESPONSE");
      return assessmentSchema.parse({
        snapshotId: input.snapshotId,
        verdict: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
      });
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

function modelState(
  input: DecisionInput & {
    selected?: z.infer<typeof assessmentInputSchema>["selected"];
  },
) {
  const selected =
    input.selected === undefined
      ? {}
      : {
          selected:
            input.selected === "done" ? "done" : jevAction(input.selected),
        };
  const facts = JSON.parse(input.context);
  if (
    input.state === "lean" ||
    (input.state === "leanDecide" && input.selected === undefined)
  ) {
    // The decide options already carry every action text; blocked controls
    // appear once at the top level.
    const { blockedControls: _blocked, ...currentFacts } = facts;
    return {
      originalRequest: input.request,
      explicitAnswers: input.answers,
      currentFacts,
      observedSteps: stepLog(input.steps),
      ...(input.selected === undefined
        ? {}
        : { availableActions: input.actions.map(jevAction) }),
      availableFields: input.fields.map(({ jev: _, ...field }) => field),
      blockedControls: input.blockedControls.map(jevBlockedControl),
      ...selected,
    };
  }
  // A focused prompt repeats the request last and leaves the action list and
  // the second copy of blocked controls to the decide options.
  const focused = input.prompt !== "full";
  const compact = input.prompt === "compact";
  const deciding = input.selected === undefined;
  const shownFacts = compact ? withoutViewport(facts) : facts;
  const { blockedControls: _blocked, ...factsOnce } = shownFacts;
  const slim = input.history === "slim" ? slimObservations(input.steps) : null;
  return {
    ...(compact ? {} : { snapshotId: input.snapshotId }),
    originalRequest: input.request,
    ...(focused && input.hints ? { requestHints: input.hints } : {}),
    explicitAnswers: input.answers,
    currentFacts: focused && deciding ? factsOnce : shownFacts,
    observedSteps: input.steps.map((step, index) => ({
      action: jevAction(step.action),
      authorizedBy: step.authorizedBy,
      outcome: step.outcome,
      ...(slim
        ? slim[index]
        : { before: JSON.parse(step.before), after: JSON.parse(step.after) }),
    })),
    ...(focused && deciding
      ? {}
      : { availableActions: input.actions.map(jevAction) }),
    availableFields: input.fields.map(({ jev: _, ...field }) => field),
    blockedControls: input.blockedControls.map(jevBlockedControl),
    ...selected,
    ...(focused ? { originalRequestAgain: input.request } : {}),
  };
}

/** Screen regions without their viewport position and order. */
function withoutViewport(facts: Record<string, unknown>) {
  const screen = facts["screen"];
  if (
    typeof screen !== "object" ||
    screen === null ||
    !("regions" in screen) ||
    !Array.isArray(screen.regions)
  )
    return facts;
  return {
    ...facts,
    screen: {
      ...screen,
      regions: screen.regions.map((region: Record<string, unknown>) => {
        const { viewport: _viewport, order: _order, ...rest } = region;
        return rest;
      }),
    },
  };
}

function rank(
  options: Record<string, string>,
  probabilities: Record<string, number>,
) {
  return Object.keys(options)
    .map((choice) => ({ choice, probability: probabilities[choice] ?? 0 }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 2);
}
