import { choice, type EntryType } from "@typesafe-ai/sdk";
import { seedWorkspace } from "../../shared/domain.js";
import { requestHints } from "../../shared/request-hints.js";
import { observedChanges, stepLog } from "../../shared/step-log.js";
import {
  assessQuestion,
  assessState,
  sha256,
  type FullState,
  type Payload,
  type Variant,
} from "./bench.js";
import { keyValue, markdown, toon, xmlSections, yaml } from "./formats.js";

type State = Record<string, unknown>;
/** Turns the state object (with `selected` on a check) into what is sent. */
type Shape = (state: State, payload: Payload) => EntryType;
type Question = { instructions: EntryType; options: Record<string, EntryType> };

const asJson: Shape = (state) => JSON.stringify(state);

/**
 * A variant from its parts: `shape` rewrites the state of decide and of both
 * checks, as a change to the product's shared modelState would; `decideShape`
 * rewrites decide only; `question` rewrites the decide question.
 */
function variant(parts: {
  shape?: Shape;
  decideShape?: Shape;
  question?: (payload: Payload) => Question;
}): Variant {
  const shape = parts.shape ?? asJson;
  const decideShape = parts.decideShape ?? shape;
  return {
    decide(payload) {
      const q = parts.question?.(payload) ?? {
        instructions: payload.instructions,
        options: payload.options,
      };
      return {
        state: decideShape(payload.state, payload),
        questions: { next: choice(q.instructions, q.options) },
      };
    },
    read: (answer) => answer.probabilities,
    assess(payload, selected, questions) {
      return {
        state: shape(assessState(payload, selected), payload),
        questions: assessQuestion(selected, questions),
      };
    },
  };
}
/** Applies object rewrites in order, then serializes. */
const pipe =
  (...steps: ((state: State, payload: Payload) => State)[]) =>
  (serialize: Shape = asJson): Shape =>
  (state, payload) =>
    serialize(
      steps.reduce((s, step) => step(s, payload), state),
      payload,
    );

const facts = (state: State) => state["currentFacts"] as State;
const withFacts = (state: State, rewrite: (f: State) => State): State => ({
  ...state,
  currentFacts: rewrite(facts(state)),
});
const omit = (value: State, ...keys: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));

// f1: noise the options or visibleCases already carry.
const noSnapshotId = (s: State) => omit(s, "snapshotId");
const noViewport = (s: State) =>
  withFacts(s, (f) => {
    const screen = f["screen"] as { regions: State[] } & State;
    return {
      ...f,
      screen: {
        ...screen,
        regions: screen.regions.map((r) => omit(r, "viewport", "order")),
      },
    };
  });
const noRegions = (s: State) => withFacts(s, (f) => omit(f, "screen"));
const noScreenText = (s: State) =>
  withFacts(s, (f) => omit(f, "currentScreen"));
const noDuplicates = (s: State) => ({
  ...omit(s, "availableActions"),
  currentFacts: omit(facts(s), "blockedControls"),
});

// f2: the avatar initial the table renders in front of each name.
const gluedInitial = /(?<![\p{L}])(\p{Lu})(?=\1\p{Ll})/gu;
const chrome = [
  /^SERVICE & BETRIEB$/,
  /^Demodaten zurücksetzen$/,
  /^Live · Jev$/,
  /^Gespeicherter Datenstand · Revision \d+$/,
];
const fixInitials = (s: State) =>
  withFacts(s, (f) => ({
    ...f,
    currentScreen: String(f["currentScreen"]).replace(gluedInitial, ""),
  }));
const noChrome = (s: State) =>
  withFacts(s, (f) => ({
    ...f,
    currentScreen: String(f["currentScreen"])
      .split("\n")
      .filter((line) => !chrome.some((c) => c.test(line)))
      .join("\n"),
  }));

// f4: where the request sits.
const requestFirst = (s: State) => ({
  originalRequest: s["originalRequest"],
  ...omit(s, "originalRequest"),
});
const requestLast = (s: State) => ({
  ...s,
  originalRequestAgain: s["originalRequest"],
});
const requestMovedLast = (s: State) => ({
  ...omit(s, "originalRequest"),
  originalRequest: s["originalRequest"],
});
const requestInInstructions = (payload: Payload): Question => ({
  instructions: `Original request: "${payload.state.originalRequest}". ${payload.instructions}`,
  options: payload.options,
});

// f5: facts code already knows about the request.
const workspace = seedWorkspace();
const withHints = (s: State) => {
  const { originalRequest, ...rest } = s;
  return {
    ...("snapshotId" in rest ? { snapshotId: rest["snapshotId"] } : {}),
    originalRequest,
    requestHints: requestHints(String(originalRequest), workspace),
    ...omit(rest, "snapshotId"),
  };
};

// f6: history formats; the steps change, the rest of the state stays.
type Step = FullState["observedSteps"][number];
const stepsOf = (s: State) => s["observedSteps"] as Step[];
const changesOf = (step: Step) =>
  observedChanges(JSON.stringify(step.before), JSON.stringify(step.after));
const changeText = (step: Step) =>
  changesOf(step)
    .map((c) => `${c.path} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`)
    .join("; ") || "nothing changed";
const lastSteps = (k: number) => (s: State) => {
  const steps = stepsOf(s);
  return {
    ...s,
    observedSteps: steps.slice(-k),
    ...(steps.length > k ? { earlierStepsOmitted: steps.length - k } : {}),
  };
};
const stepLines = (s: State) => ({
  ...s,
  observedSteps: stepsOf(s).map(
    (step, i) =>
      `${i + 1}. ${step.action.id}: ${step.action.effect} → ${step.outcome}`,
  ),
});
const stepDiffs = (s: State) => ({
  ...s,
  observedSteps: stepsOf(s).map((step) => ({
    action: step.action.effect,
    kind: step.action.kind,
    authorizedBy: step.authorizedBy,
    outcome: step.outcome,
    changes: changesOf(step),
  })),
});
const stepDiffLines = (s: State) => ({
  ...s,
  observedSteps: stepsOf(s).map(
    (step, i) =>
      `${i + 1}. ${step.action.id} (${step.action.kind}, ${step.outcome}): ${changeText(step)}`,
  ),
});

// f7: the instructions.
const german =
  "Wähle GENAU EINE aktuell angebotene UI-Aktion, die dem gesamten ursprünglichen Auftrag dient. Nutze den beobachteten Verlauf, um frühere Arbeit und eine ausdrückliche Reihenfolge zu erinnern. Wiederholte Zuweisungen und mehrere Datensätze sind erlaubt. Bereits passende gespeicherte Werte können eine Zuweisung ohne erneutes Schreiben erfüllen. retainedSelection ist der gespeicherte Datensatz, samt ungespeichertem Entwurf, des ausgewählten Vorgangs, dessen Detail nicht auf dem Bildschirm ist: aktuelle Daten, kein sichtbares Bedienelement. Ein Schritt ohne Änderung bewirkt nichts; wiederhole ihn nicht, solange sein Wert gleich bleibt. Halte ausdrücklich verlangte Abfolgen verschiedener Zuweisungen ein. Gespeichert wird schrittweise; früher gespeicherte Arbeit bleibt, wenn spätere Arbeit blockiert ist. Erfinde keine Werte oder Belege. Wähle done nur, wenn nichts mehr offen ist; blocked für nicht unterstützte offene Arbeit; abstain, wenn du den Auftrag nicht verstehst oder nicht sinnvoll wählen kannst. Ein Menü, eine Navigation oder eine Eingabe ist ein echter Zwischenschritt. Angezeigte Datensätze und offene Checklisten sind Kontext, keine zusätzlichen Aufgaben. Eine Einschränkung gilt nur für ihre eigene Aktion und ihr Ziel. Eine verlangte Liste anzuzeigen verlangt nicht, ihre Datensätze zu öffnen, abzuschließen, zu bearbeiten oder zu speichern.";
const shortInstructions =
  "Choose ONE offered action that moves the entire original request forward, in its requested order. observedSteps is work already done; do not repeat an unchanged step. Matching saved values need no new write. Do not invent values. done: nothing remains. blocked: remaining work is unsupported. abstain: the request is unclear. Menus, navigation and inputs are real steps. Displayed records and checklists are context, not tasks.";
const sentences = (text: string) =>
  text.split(/(?<=\.) (?=[A-Z])/).map((s) => s.trim());
const instructionsAs =
  (text: (payload: Payload) => EntryType) =>
  (payload: Payload): Question => ({
    instructions: text(payload),
    options: payload.options,
  });

// f8: option texts and order. An option reads
// `does. Now: now. reveals. Not for: notFor. UI "label", kind kind`.
const reveals =
  /\. (View only|Changes only|Only opens|Shows its editor|Commits the draft|Loses unsaved|Saves|Leaves|Opens)[^]*$/;
function optionParts(text: string) {
  const ui = /\. UI "([^"]*)", kind (\w+)$/.exec(text);
  let rest = ui ? text.slice(0, ui.index) : text;
  const notFor = /\. Not for: ([^]*)$/.exec(rest);
  if (notFor) rest = rest.slice(0, notFor.index);
  const reveal = reveals.exec(rest);
  if (reveal) rest = rest.slice(0, reveal.index);
  const now = /\. Now: ([^]*)$/.exec(rest);
  const does = now ? rest.slice(0, now.index) : rest;
  return {
    does,
    ...(now ? { now: now[1] } : {}),
    ...(reveal ? { reveals: reveal[0].slice(2) } : {}),
    ...(notFor ? { notFor: notFor[1] } : {}),
    ...(ui ? { ui: ui[1], kind: ui[2] } : {}),
  };
}
const mapOptions =
  (rewrite: (text: string) => EntryType) =>
  (payload: Payload): Question => ({
    instructions: payload.instructions,
    options: Object.fromEntries(
      Object.entries(payload.options).map(([id, text]) => [id, rewrite(text)]),
    ),
  });
const reorder =
  (order: (ids: string[], payload: Payload) => string[]) =>
  (payload: Payload): Question => ({
    instructions: payload.instructions,
    options: Object.fromEntries(
      order(Object.keys(payload.options), payload).map((id) => [
        id,
        payload.options[id]!,
      ]),
    ),
  });
/** Actions of the open detail first, then the page, then navigation, then the rest. */
function regionOrder(ids: string[], payload: Payload) {
  const screen = payload.state.currentFacts["screen"] as {
    regions: { kind: string; actionIds: string[] }[];
  };
  const rank = { detail: 0, section: 1, page: 1, navigation: 2 } as Record<
    string,
    number
  >;
  const place = new Map<string, number>();
  screen.regions.forEach((region, i) =>
    region.actionIds.forEach((id) =>
      place.set(id, (rank[region.kind] ?? 1) * 1000 + i),
    ),
  );
  return ids
    .map((id, i) => ({ id, key: place.get(id) ?? 5000 + i }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.id);
}
function shuffled(ids: string[], payload: Payload) {
  return ids
    .map((id) => ({ id, key: sha256([payload.state.snapshotId, id]) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry) => entry.id);
}

// f9: only what the decision reads: the request with hints, the page, the
// open case and its draft, a one-line history; options carry the rest.
const minimal = (s: State): State => {
  const f = facts(s);
  return {
    originalRequest: s["originalRequest"],
    requestHints: requestHints(String(s["originalRequest"]), workspace),
    explicitAnswers: s["explicitAnswers"],
    currentPage: f["currentPage"],
    filters: f["filters"],
    menu: f["menu"],
    openCase: f["selected"] ?? null,
    draft: f["draft"] ?? null,
    dirty: f["dirty"],
    retainedSelection: f["retainedSelection"] ?? null,
    savedThisRun: Array.isArray(f["receipts"]) ? f["receipts"].length : 0,
    message: f["message"],
    observedSteps: stepDiffLines(s)["observedSteps"],
    availableFields: s["availableFields"],
    ...("selected" in s ? { selected: s["selected"] } : {}),
  };
};

// l: cost cuts for the compact state of g3-cpe-duel. Most decide input is
// the history: every step repeats the whole observation before and after.
/** The recorded steps as the product's step input, effect text taken whole. */
const productSteps = (s: State) =>
  stepsOf(s).map((step) => ({
    snapshotId: "earlier",
    action: { ...step.action, jev: { does: step.action.effect, reveals: "" } },
    authorizedBy: step.authorizedBy,
    outcome: step.outcome,
    before: JSON.stringify(step.before),
    after: JSON.stringify(step.after),
  }));
/** l1: the lean step log of shared/step-log.ts, one change list per step. */
const leanSteps = (s: State) => ({
  ...s,
  observedSteps: stepLog(productSteps(s)),
});
/** l2: the lean step log plus where each step ran: page and open case. */
const placedSteps = (s: State) => {
  const log = stepLog(productSteps(s));
  return {
    ...s,
    observedSteps: stepsOf(s).map((step, i) => {
      const { changes, ...entry } = log[i]!;
      return {
        ...entry,
        at: { page: step.before["page"], caseId: step.before["caseId"] },
        changes,
      };
    }),
  };
};
/**
 * l3: the snapshots kept, without the saved case record (the facts carry the
 * current one), id lists as counts, and fields that stay empty.
 */
const slimObservation = (observed: Record<string, unknown>) => {
  const { selected: _, draftOwner: __, ...rest } = observed;
  return Object.fromEntries(
    Object.entries(rest).flatMap(([key, value]) =>
      key === "operations" || key === "receipts"
        ? [[key, Array.isArray(value) ? value.length : value]]
        : key === "unknownSave" && value === null
          ? []
          : [[key, value]],
    ),
  );
};
const slimSteps = (s: State) => ({
  ...s,
  observedSteps: stepsOf(s).map((step) => ({
    ...step,
    before: slimObservation(step.before),
    after: slimObservation(step.after),
  })),
});
/**
 * l8: each step's observation before it is the one after the step before, so
 * only the first step keeps its `before`.
 */
const afterOnly = (s: State) => ({
  ...s,
  observedSteps: stepsOf(s).map((step, i) =>
    i === 0 ? step : omit(step, "before"),
  ),
});

/** l10: operation and receipt id lists of each observation as counts. */
const countedIds = (s: State) => ({
  ...s,
  observedSteps: stepsOf(s).map((step) =>
    Object.fromEntries(
      Object.entries(step).map(([key, value]) =>
        key === "before" || key === "after"
          ? [
              key,
              Object.fromEntries(
                Object.entries(value as State).map(([k, v]) =>
                  (k === "operations" || k === "receipts") && Array.isArray(v)
                    ? [k, v.length]
                    : [k, v],
                ),
              ),
            ]
          : [key, value],
      ),
    ),
  ),
});

export const variants = {
  identity: variant({}),
  "f1-meta": variant({ shape: pipe(noSnapshotId, noViewport)() }),
  "f1-regions": variant({ shape: pipe(noRegions)() }),
  "f1-text": variant({ shape: pipe(noScreenText)() }),
  "f1-dedupe": variant({ decideShape: pipe(noDuplicates)() }),
  f1: variant({ shape: pipe(noSnapshotId, noRegions, noScreenText)() }),
  "f2-initials": variant({ shape: pipe(fixInitials)() }),
  "f2-chrome": variant({ shape: pipe(fixInitials, noChrome)() }),
  "f3-object": variant({ shape: (s) => s as EntryType }),
  "f3-yaml": variant({ shape: (s) => yaml(s) }),
  "f3-toon": variant({ shape: (s) => toon(s) }),
  "f3-md": variant({ shape: (s) => markdown(s) }),
  "f3-kv": variant({ shape: (s) => keyValue(s).join("\n") }),
  "f3-xml": variant({ shape: (s) => xmlSections(s) }),
  "f4-first": variant({ shape: pipe(requestFirst)() }),
  "f4-instructions": variant({ question: requestInInstructions }),
  "f4-end": variant({ shape: pipe(requestLast)() }),
  f5: variant({ shape: pipe(withHints)() }),
  "f6-last2": variant({ decideShape: pipe(lastSteps(2))() }),
  "f6-lines": variant({ decideShape: pipe(stepLines)() }),
  "f6-diff": variant({ decideShape: pipe(stepDiffs)() }),
  "f6-difflines": variant({ decideShape: pipe(stepDiffLines)() }),
  "f6-difflines-all": variant({ shape: pipe(stepDiffLines)() }),
  "f7-bullets": variant({
    question: instructionsAs((p) =>
      sentences(p.instructions)
        .map((s) => `- ${s}`)
        .join("\n"),
    ),
  }),
  "f7-object": variant({
    question: instructionsAs((p) => {
      const [question = "", ...rules] = sentences(p.instructions);
      return { question, rules };
    }),
  }),
  "f7-de": variant({ question: instructionsAs(() => german) }),
  "f7-short": variant({ question: instructionsAs(() => shortInstructions) }),
  "f8-short": variant({
    question: mapOptions((text) => {
      const { does, now } = optionParts(text);
      return now ? `${does}. Now: ${now}` : does;
    }),
  }),
  "f8-does": variant({
    question: mapOptions((text) => optionParts(text).does),
  }),
  "f8-object": variant({ question: mapOptions((text) => optionParts(text)) }),
  "f8-region": variant({ question: reorder(regionOrder) }),
  "f8-shuffle": variant({ question: reorder(shuffled) }),
  "f8-reverse": variant({ question: reorder((ids) => ids.toReversed()) }),
  f9: variant({ decideShape: pipe(minimal)() }),
  "f4-last": variant({ shape: pipe(requestMovedLast)() }),
  "c1-dedupe-end": variant({
    shape: pipe(requestLast)(),
    decideShape: pipe(noDuplicates, requestLast)(),
  }),
  "c2-dedupe-end-instr": variant({
    shape: pipe(requestLast)(),
    decideShape: pipe(noDuplicates, requestLast)(),
    question: requestInInstructions,
  }),
  "c3-dedupe-end-hints": variant({
    shape: pipe(withHints, requestLast)(),
    decideShape: pipe(withHints, noDuplicates, requestLast)(),
  }),
  "c4-squeeze": variant({
    shape: pipe(noSnapshotId, noViewport, requestLast)(),
    decideShape: pipe(noSnapshotId, noViewport, noDuplicates, requestLast)(),
    question: mapOptions((text) => {
      const { does, now } = optionParts(text);
      return now ? `${does}. Now: ${now}` : does;
    }),
  }),
  "c6-squeeze-hints": variant({
    shape: pipe(noSnapshotId, noViewport, withHints, requestLast)(),
    decideShape: pipe(
      noSnapshotId,
      noViewport,
      withHints,
      noDuplicates,
      requestLast,
    )(),
    question: mapOptions((text) => {
      const { does, now } = optionParts(text);
      return now ? `${does}. Now: ${now}` : does;
    }),
  }),
  "c5-dedupe-end-region": variant({
    shape: pipe(requestLast)(),
    decideShape: pipe(noDuplicates, requestLast)(),
    question: reorder(regionOrder),
  }),
  "l1-steplog": variant({ shape: pipe(leanSteps)() }),
  "l1d-steplog": variant({ decideShape: pipe(leanSteps)() }),
  "l2-placed": variant({ shape: pipe(placedSteps)() }),
  "l3-slim": variant({ shape: pipe(slimSteps)() }),
  "l4-noregions": variant({ shape: pipe(noRegions)() }),
  "l5-steplog-noregions": variant({ shape: pipe(leanSteps, noRegions)() }),
  "l6-placed-noregions": variant({ shape: pipe(placedSteps, noRegions)() }),
  "l7-slim-noregions": variant({ shape: pipe(slimSteps, noRegions)() }),
  "l8-after": variant({ shape: pipe(afterOnly)() }),
  "l9-slim-after": variant({ shape: pipe(slimSteps, afterOnly)() }),
  "l10-after-counted": variant({ shape: pipe(countedIds, afterOnly)() }),
} satisfies Record<string, Variant>;
