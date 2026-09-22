import { choice, type EntryType } from "@typesafe-ai/sdk";
import { seedWorkspace } from "../../shared/domain.js";
import { requestNumbers } from "../../shared/field-values.js";
import { observedChanges } from "../../shared/step-log.js";
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
const requestInInstructions = (payload: Payload): Question => ({
  instructions: `Original request: "${payload.state.originalRequest}". ${payload.instructions}`,
  options: payload.options,
});

// f5: facts code already knows about the request.
const workspace = seedWorkspace();
const pageCues: [string, RegExp][] = [
  ["cases", /vorg[aä]ng|auftr[aä]g|fallliste|liste/giu],
  ["customers", /kunde/giu],
  ["team", /team|kapazit|auslastung/giu],
  ["reports", /bericht|report|auswertung|statistik/giu],
];
function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = kept;
    }
  }
  return row[b.length]!;
}
const commonWords = new Set(["haben", "neben", "leben", "lesen", "mehr"]);
const resembles = (token: string, word: string) =>
  token.length >= 3 &&
  !commonWords.has(token) &&
  (token === word ||
    (token.length >= 4 && (word.startsWith(token) || token.startsWith(word))) ||
    (token.length >= 4 && token[0] === word[0] && distance(token, word) <= 1));
export function requestHints(request: string) {
  const tokens = request.toLowerCase().match(/\p{L}+/gu) ?? [];
  const mention = (words: string[]) => [
    ...new Set(
      tokens.filter((t) => words.some((w) => resembles(t, w.toLowerCase()))),
    ),
  ];
  const cases = workspace.cases.map((c) => c.id);
  const digits = (id: string) => id.replace(/\D/g, "");
  return {
    numbers: requestNumbers(request, cases).map((n) => ({
      value: Number(n.value),
      ...(n.span === undefined ? {} : { from: n.span }),
      fields: n.fields,
      cases: n.cases,
      tiedByFieldWord: n.bound,
    })),
    cases: cases
      .map((id) => ({
        id,
        at: request.search(
          new RegExp(
            `(?<!\\d)${digits(id).slice(0, 2)}\\s?${digits(id).slice(2)}(?!\\d)`,
          ),
        ),
      }))
      .filter((c) => c.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((c) => c.id),
    technicians: workspace.technicians.flatMap((t) => {
      const found = mention(t.name.split(" "));
      return found.length
        ? [{ mention: found.join(" "), id: t.id, name: t.name }]
        : [];
    }),
    customers: workspace.customers.flatMap((c) => {
      const words = c.name
        .split(/[\s&]+/)
        .filter((w) => w.length >= 4 && !/^(gmbh|partner)$/i.test(w));
      const found = mention(words);
      return found.length
        ? [{ mention: found.join(" "), id: c.id, name: c.name }]
        : [];
    }),
    pageWordsInOrder: pageCues
      .flatMap(([page, cue]) =>
        [...request.matchAll(cue)].map((m) => ({ page, at: m.index })),
      )
      .sort((a, b) => a.at - b.at)
      .map((m) => m.page)
      .filter((page, i, all) => page !== all[i - 1]),
  };
}
const withHints = (s: State) => {
  const { originalRequest, ...rest } = s;
  return {
    ...("snapshotId" in rest ? { snapshotId: rest["snapshotId"] } : {}),
    originalRequest,
    requestHints: requestHints(String(originalRequest)),
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
    requestHints: requestHints(String(s["originalRequest"])),
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
} satisfies Record<string, Variant>;
