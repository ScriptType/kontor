import { z } from "zod";
import {
  fullStateSchema,
  isDuel,
  sentActionSchema,
  type FullState,
  type RecordedCall,
  type SentAction,
} from "./bench.js";

export const stateOf = (payload: RecordedCall) =>
  fullStateSchema.parse(JSON.parse(payload.request.state));
const terminal = (option: string) =>
  ["done", "blocked", "abstain"].includes(option) || option.startsWith("ask:");
const duelText = /^([^]*)\. UI "([^"]*)", kind (view|draft|commit|discard)$/;
const defaultTail: Partial<Record<SentAction["kind"], string>> = {
  view: ". View only; changes no case data",
  draft: ". Changes only the unsaved draft; nothing is saved until save",
};
/** What the control does, with the case it acts on left out. */
const doesOf = (text: string) =>
  text.split(". Now: ")[0]!.replace(/V-\d+( "[^"]*")?/g, "V-…");

// A compact decide sends each action as `does. Now: now`; the product holds
// label, kind and the full effect, which a check and a duel send. One id can
// name two controls (technician:mara assigns in the picker and filters in the
// filter menu), so the catalog keys by id and the text before "Now:", and
// keeps every text seen after the option text. A field value or a picker case
// fills a template whose text after the option is the same for every value
// and case, so the catalog keys those by template.
type Known = {
  label: string;
  kind: SentAction["kind"];
  tails: Map<string, number>;
};

/** The template a field value (`field:minutes`) or a picker case (`open-case`) fills. */
function templateOf(id: string) {
  const field = /^field:([^:]+):/.exec(id);
  if (field) return `field:${field[1]}`;
  return id.startsWith("open-case:") ? "open-case" : undefined;
}
/**
 * Label and kind the product gives a field value (ActionRegistry.snapshot) or
 * a picker case (ActionDispatcher.openCaseAction), from the fields the state
 * lists and the case the id names.
 */
function templatedControl(
  id: string,
  state: FullState,
  learned: SentAction["kind"],
) {
  const value = /^field:([^:]+):(.*)$/s.exec(id);
  if (!value)
    return { label: `${id.slice("open-case:".length)} öffnen`, kind: learned };
  const field = state.availableFields.find((f) => f.id === value[1]);
  if (!field) throw new Error(`${id} sets no field the state lists`);
  return { label: `${field.label} auf ${value[2]} setzen`, kind: field.kind };
}

/** Labels, kinds and effect texts of the controls recorded runs show. */
export function createCatalog() {
  const known = new Map<string, Known>();
  function remember(action: SentAction, option?: string) {
    const key =
      templateOf(action.id) ?? `${action.id}\n${doesOf(action.effect)}`;
    const entry = known.get(key) ?? {
      label: action.label,
      kind: action.kind,
      tails: new Map<string, number>(),
    };
    if (entry.kind !== action.kind)
      throw new Error(`${key} is both ${entry.kind} and ${action.kind}`);
    if (option !== undefined && action.effect.startsWith(option)) {
      const tail = action.effect.slice(option.length).replace(/V-\d+/g, "V-…");
      entry.tails.set(tail, (entry.tails.get(tail) ?? 0) + 1);
    }
    known.set(key, entry);
  }
  /** The known control for an option, else the one kind its id was seen with. */
  function lookup(id: string, text: string): Known {
    const exact = known.get(`${id}\n${doesOf(text)}`);
    if (exact) return exact;
    const seen = [...known].filter(([key]) => key.startsWith(`${id}\n`));
    const [first] = seen;
    if (!first || new Set(seen.map(([, entry]) => entry.kind)).size !== 1)
      throw new Error(`${id} "${doesOf(text)}" has no recorded kind`);
    return { ...first[1], tails: new Map() };
  }
  return {
    learn(callLog: { question: string; payload?: RecordedCall }[]) {
      let options: Record<string, string> = {};
      for (const { question, payload } of callLog) {
        if (!payload) continue;
        if (question === "next" && !isDuel(payload)) {
          const state = stateOf(payload);
          // A step was offered by the decide before, as the option it took.
          for (const step of state.observedSteps)
            remember(step.action, options[step.action.id]);
          options = payload.request.questions["next"]?.criteria ?? {};
          for (const action of state.availableActions ?? [])
            remember(action, options[action.id]);
        } else if (question === "next") {
          for (const [id, text] of Object.entries(
            payload.request.questions["next"]?.criteria ?? {},
          )) {
            const match = duelText.exec(text);
            if (match)
              remember(
                {
                  id,
                  label: match[2]!,
                  effect: match[1]!,
                  kind: match[3] as SentAction["kind"],
                },
                options[id],
              );
          }
        } else if (question === "assessment") {
          const state = z
            .object({ availableActions: z.array(sentActionSchema) })
            .loose()
            .parse(JSON.parse(payload.request.state));
          for (const action of state.availableActions)
            remember(action, options[action.id]);
        }
      }
    },
    /** The offered actions of a decide, with the text most often seen after each option. */
    rebuild(state: FullState, options: Record<string, string>): SentAction[] {
      const open = z
        .object({ selected: z.object({ id: z.string() }).optional() })
        .loose()
        .parse(state.currentFacts).selected?.id;
      return Object.entries(options)
        .filter(([id]) => !terminal(id))
        .map(([id, text]) => {
          const template = templateOf(id);
          const entry = template ? known.get(template) : lookup(id, text);
          if (!entry) throw new Error(`${id}: no recording shows ${template}`);
          const { label, kind } = template
            ? templatedControl(id, state, entry.kind)
            : entry;
          // Texts that name the open case fit only while a detail is open.
          const fits = ([tail]: [string, number]) =>
            tail.includes("V-…") === (open !== undefined);
          const [tail] = [...entry.tails].sort(
            (a, b) => Number(fits(b)) - Number(fits(a)) || b[1] - a[1],
          )[0] ?? [defaultTail[kind] ?? ""];
          return {
            id,
            label,
            effect: text + tail.replaceAll("V-…", open ?? "V-…"),
            kind,
          };
        });
    },
  };
}
