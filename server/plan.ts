import {
  choice,
  noul,
  type EntryType,
  type Fetch,
  type Questions,
} from "@typesafe-ai/sdk";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
  dimension,
  dimensionOptions,
  filterValue,
  type CaseDimensionId,
  type DimensionOption,
  type ListDimensionId,
} from "../shared/dimensions.js";
import {
  defaultCaseFilters,
  pageSchema,
  type Page,
  type Workspace,
} from "../shared/domain.js";
import {
  caseDimensions,
  listDimensions,
  type CaseValues,
} from "../shared/intent.js";
import { ASK, type Plan, type PlanInput } from "../shared/plan.js";
import type { Config } from "./config.js";
import { createClient } from "./jev.js";

/** What the plan is read from: the request and the screen it was given on. */
export type PlanScene = PlanInput & { workspace: Workspace };

const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  }),
]);
type Answer = z.infer<typeof answerSchema>;
export type Sent = { state: EntryType; questions: Questions };
export type Ask = (sent: Sent) => Promise<Record<string, Answer>>;

/** The provider's answers, each of its question's type and among its options. */
export function readAnswers(
  questions: Questions,
  raw: unknown,
): Record<string, Answer> {
  const parsed = z
    .object({ answers: z.record(z.string(), answerSchema) })
    .safeParse(raw);
  if (!parsed.success) throw new ORPCError("PROVIDER_INVALID_RESPONSE");
  for (const [key, question] of Object.entries(questions)) {
    const answer = parsed.data.answers[key];
    if (
      !answer ||
      answer.type !== question.type ||
      (answer.type === "choice" &&
        question.type === "choice" &&
        !Object.hasOwn(question.criteria, answer.choice))
    )
      throw new ORPCError("PROVIDER_INVALID_RESPONSE");
  }
  return parsed.data.answers;
}

export function createPlanner(config: Config, fetch?: Fetch) {
  if (config.mode !== "live") return async () => null;
  const client = createClient(config, fetch, 60000);
  return async (scene: PlanScene, signal?: AbortSignal) =>
    extractPlan(scene, async (sent) => {
      let raw: unknown;
      try {
        raw = await client.systemOne(sent, { signal });
      } catch {
        throw new ORPCError("PROVIDER_UNAVAILABLE", {
          message:
            "Jev ist nicht erreichbar. Es wurde keine Entscheidung ausgeführt.",
        });
      }
      return readAnswers(sent.questions, raw);
    });
}

const yes = (answer: Answer | undefined) => {
  if (answer?.type !== "noul") throw new Error("missing noul answer");
  return answer.noul;
};
const picked = (answer: Answer | undefined) => {
  if (answer?.type !== "choice") throw new Error("missing choice answer");
  return answer.choice;
};

function worldState(scene: PlanScene) {
  const ws = scene.workspace;
  const tech = (id: string) =>
    ws.technicians.find((t) => t.id === id)?.name ?? id;
  return {
    auftrag: scene.request,
    ansicht: {
      seite: scene.page,
      filter: Object.fromEntries(
        listDimensions.map((id) => [id, filterValue(id, scene.filters)]),
      ),
      geöffneterVorgang: scene.selectedCase,
    },
    vorgänge: ws.cases.map((c) => {
      const kunde = ws.customers.find((k) => k.id === c.customerId)?.name;
      return {
        id: c.id,
        titel: c.title,
        ...(kunde === undefined ? {} : { kunde }),
        standort: c.site,
        qualifikation: c.skill,
        zuständig: tech(c.technicianId),
        status: c.status,
        arbeitszeitMinuten: c.minutes,
        termin: c.appointment
          ? {
              start: c.appointment.start.slice(0, 16),
              minuten: c.appointment.minutes,
            }
          : null,
        priorität: c.priority,
      };
    }),
    team: ws.technicians.map((t) => ({
      id: t.id,
      name: t.name,
      qualifikationen: t.skills,
    })),
    kunden: ws.customers.map((k) => ({
      id: k.id,
      name: k.name,
      kontakt: k.contact,
    })),
  };
}

function currentCaseValue(
  scene: PlanScene,
  caseId: string,
  dim: CaseDimensionId,
): string {
  const c = scene.workspace.cases.find((x) => x.id === caseId);
  if (!c) return "";
  switch (dim) {
    case "technician":
      return c.technicianId;
    case "workedMinutes":
      return String(c.minutes);
    case "appointmentStart":
      return c.appointment ? c.appointment.start.slice(0, 16) : "none";
    case "appointmentDuration":
      return c.appointment ? String(c.appointment.minutes) : "";
    case "status":
      return c.status;
    case "priority":
      return c.priority;
  }
}

/** Registry-derived value options: candidates, unset, the default for list filters, and ask for literal fields. */
function valueOptions(
  scene: PlanScene,
  dim: CaseDimensionId | ListDimensionId,
  caseId?: string,
): DimensionOption[] {
  const entry = dimension(dim);
  const options = dimensionOptions(entry, {
    workspace: scene.workspace,
    request: scene.request,
    ...(caseId ? { caseId } : {}),
  });
  if (entry.scope === "list") {
    const reset = filterValue(entry.id, defaultCaseFilters);
    if (!options.some((o) => o.value === reset))
      options.push({ value: reset, label: "Reset to the default (empty)" });
  }
  const literal =
    !("references" in entry) && !("labels" in entry) && dim !== "priority";
  if (literal)
    options.push({
      value: ASK,
      label: "None of these values is stated in the request: ask the user",
    });
  return options;
}

type Token = { index: number; text: string; from: number; to: number };
function tokens(request: string): Token[] {
  return [...request.matchAll(/\S+/g)].map((m, index) => ({
    index,
    text: m[0],
    from: m.index,
    to: m.index + m[0].length,
  }));
}
/** A segment is a run of tokens [from, to]; its text is the verbatim request span. */
type Segment = { from: number; to: number; text: string };
function segmentsFromEnds(
  request: string,
  toks: Token[],
  ends: number[],
): Segment[] {
  const sorted = [...new Set(ends)]
    .filter((e) => e >= 0 && e < toks.length - 1)
    .sort((a, b) => a - b);
  const out: Segment[] = [];
  let from = 0;
  for (const end of [...sorted, toks.length - 1]) {
    const a = toks[from];
    const b = toks[end];
    if (a && b) out.push({ from, to: end, text: request.slice(a.from, b.to) });
    from = end + 1;
  }
  return out;
}

const definition =
  "Ein Arbeitsschritt ist eine zusammenhängende Anweisung an die Vorgangsverwaltung: einen Vorgang öffnen oder ändern (mit allen seinen Feldänderungen), einen Listenfilter oder die Suche ändern, oder eine Ansicht öffnen. Korrekturen („45, nee 55“, „Mara, äh nee, Lea“), Begründungen und Füllwörter gehören zu dem Schritt, den sie betreffen. Nennt ein Satz mehrere Vorgänge mit demselben Wert („1041 und 1042 beide auf Mara“), bleibt das ein Schritt. Eine Aufgabe außerhalb der App (Mail, Anruf, Druck) ist ein eigener Schritt.";
const connectors = new Set([
  "und",
  "dann",
  "danach",
  "außerdem",
  "noch",
  "auch",
  "zuerst",
  "erst",
  "erstens",
  "zweitens",
  "drittens",
  "anschließend",
  "zuletzt",
  "sowie",
  "and",
  "then",
  "nacha",
  "no",
  "ond",
  "aber",
  "plus",
]);
const bare = (t: string) =>
  t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const caseRef = /^[„"(]?(?:v-?)?\d{4}\b/i;
function names(ws: Workspace) {
  return new Set(
    [
      ...ws.technicians.flatMap((t) => t.name.split(" ")),
      ...ws.customers.map((c) => c.name.split(/[ &]/)[0] ?? ""),
    ]
      .map((n) => n.toLowerCase())
      .filter((n) => n.length > 2),
  );
}
/** Word gaps after punctuation or a line break, before a connector, a case id or a name. */
function gapCandidates(scene: PlanScene, toks: Token[]): number[] {
  const known = names(scene.workspace);
  const gaps: number[] = [];
  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i]!;
    const n = toks[i + 1]!;
    const between = scene.request.slice(t.to, n.from);
    if (
      /[,.;:!?)\]–→]$/.test(t.text) ||
      between.includes("\n") ||
      /^[–→\-/]$/.test(n.text) ||
      connectors.has(bare(n.text)) ||
      caseRef.test(n.text) ||
      known.has(bare(n.text))
    )
      gaps.push(i);
  }
  return gaps;
}
/** Clause boundaries pushed to high recall: every comma, connector and case id. */
function overSplit(request: string, toks: Token[]): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i]!;
    const n = toks[i + 1]!;
    const between = request.slice(t.to, n.from);
    if (
      between.includes("\n") ||
      /[;!?…]$/.test(t.text) ||
      /(?<!\d)\.$/.test(t.text) ||
      /,$/.test(t.text) ||
      [
        "und",
        "dann",
        "danach",
        "außerdem",
        "auch",
        "noch",
        "sowie",
        "and",
        "then",
      ].includes(bare(n.text)) ||
      caseRef.test(n.text)
    )
      gaps.push(i);
  }
  return gaps;
}
const tokenLabel = (toks: Token[], i: number) =>
  `„${toks[i]!.text}“ (Wort ${i + 1}, in: …${toks
    .slice(Math.max(0, i - 3), i)
    .map((t) => t.text)
    .join(" ")} [${toks[i]!.text}] ${toks
    .slice(i + 1, i + 3)
    .map((t) => t.text)
    .join(" ")}…)`;
/** Choice options over word indices, capped at 255: past the cap only gap candidates and the last word. */
function tokenOptions(
  scene: PlanScene,
  toks: Token[],
  from: number,
  to: number,
) {
  let indices = toks.slice(from, to + 1).map((t) => t.index);
  const room = 255;
  if (indices.length > room) {
    const gaps = new Set(gapCandidates(scene, toks));
    indices = indices
      .filter((i) => gaps.has(i) || i === toks.length - 1)
      .slice(-room);
  }
  return Object.fromEntries(indices.map((i) => [`w${i}`, tokenLabel(toks, i)]));
}

const pages = pageSchema.options;
const pageLabels = dimension("page").labels;
const partRef = (segments: Segment[], i: number) =>
  segments.length === 1
    ? `The request (single part): "${segments[0]!.text}"`
    : `Request part ${i + 1} of ${segments.length}: "${segments[i]!.text}"`;
const resolveNote =
  "Use the whole request (auftrag in the state) to resolve references such as 'das', 'sie' or 'den', but answer for this part only.";
function caseLabel(scene: PlanScene, id: string) {
  const ws = scene.workspace;
  const c = ws.cases.find((x) => x.id === id)!;
  return `${id} ("${c.title}", ${ws.customers.find((k) => k.id === c.customerId)?.name}, ${c.site})`;
}
const unsupportedQuestion = `${dimension("unsupported").question} ${dimension("unsupported").description} Only count tasks the request asks the assistant to do; what the person says they will do themselves does not count.`;
const optionMap = (options: DimensionOption[]) =>
  Object.fromEntries(options.map((o) => [o.value, o.label]));

/** Reads the plan in two steps: split the request into work steps, then read each step's slots. */
export async function extractPlan(scene: PlanScene, ask: Ask): Promise<Plan> {
  const askAll = async (state: EntryType, questions: Questions) =>
    Object.keys(questions).length ? ask({ state, questions }) : {};
  return extractSteps(scene, await segment(scene, askAll), askAll);
}

type AskAll = (
  state: EntryType,
  questions: Questions,
) => Promise<Record<string, Answer>>;

/** Over-splits the request at every clause boundary, then asks which neighbouring parts belong together. */
async function segment(scene: PlanScene, ask: AskAll): Promise<Segment[]> {
  const { request } = scene;
  const toks = tokens(request);
  const whole = segmentsFromEnds(request, toks, []);
  if (toks.length < 2) return whole;
  const gaps = overSplit(request, toks);
  if (!gaps.length) return whole;
  const parts = segmentsFromEnds(request, toks, gaps);
  const questions: Questions = {};
  for (let i = 0; i < parts.length - 1; i++)
    questions[`g${parts[i]!.to}`] = noul(
      `Teil ${i + 1}: „${parts[i]!.text}“\nTeil ${i + 2}: „${parts[i + 1]!.text}“\n\nGehören Teil ${i + 1} und Teil ${i + 2} zum selben Arbeitsschritt?`,
    );
  const answers = await ask(
    { ...worldState(scene), arbeitsschritt: definition },
    questions,
  );
  const ends = Object.keys(questions)
    .filter((key) => 1 - yes(answers[key]) >= 0.5)
    .map((key) => Number(key.slice(1)));
  return segmentsFromEnds(request, toks, ends);
}

type Step = {
  cases: string[];
  filters: Plan["filters"];
  pages: Page[];
};
async function extractSteps(
  scene: PlanScene,
  segments: Segment[],
  ask: AskAll,
): Promise<Plan> {
  const state = {
    ...worldState(scene),
    abschnitte: segments.map((x, i) => `${i + 1}: ${x.text}`),
  };
  const ws = scene.workspace;
  const toks = tokens(scene.request);
  const qa: Questions = {
    "flag.noSave": noul(
      `${dimension("noSave").question} ${dimension("noSave").description}`,
    ),
    "flag.unsupported": noul(unsupportedQuestion),
  };
  segments.forEach((_, i) => {
    const ref = partRef(segments, i);
    for (const c of ws.cases)
      qa[`s${i}.case.${c.id}`] = noul(
        `${ref}\n\nDoes this part act on case ${caseLabel(scene, c.id)}? ${dimension("cases").description} ${resolveNote}`,
      );
    for (const dim of listDimensions) {
      const d = dimension(dim);
      qa[`s${i}.fchg.${dim}`] = noul(
        `${ref}\n\nDoes this part ask to change this case-list setting? ${d.description} Current value: ${filterValue(dim, scene.filters) || "empty"}.`,
      );
      qa[`s${i}.fval.${dim}`] = choice(
        `${ref}\n\n${d.question} ${d.description}`,
        optionMap(valueOptions(scene, dim)),
      );
    }
    for (const pg of pages)
      qa[`s${i}.page.${pg}`] = noul(
        `${ref}\n\nVerlangt dieser Teil, zur Ansicht ${pageLabels[pg]} zu wechseln (sie zu öffnen oder anzuzeigen)?`,
      );
  });
  const a = await ask(state, qa);
  const flags = {
    noSave: yes(a["flag.noSave"]) >= 0.5,
    unsupported: yes(a["flag.unsupported"]) >= 0.5,
  };
  const steps: Step[] = segments.map((_, i) => {
    const cases = ws.cases
      .map((c) => c.id)
      .filter((id) => yes(a[`s${i}.case.${id}`]) >= 0.5);
    const filters: Plan["filters"] = {};
    for (const dim of listDimensions) {
      if (yes(a[`s${i}.fchg.${dim}`]) < 0.5) continue;
      const value = picked(a[`s${i}.fval.${dim}`]);
      if (value !== filterValue(dim, scene.filters)) filters[dim] = value;
    }
    const opened = pages.filter((pg) => yes(a[`s${i}.page.${pg}`]) >= 0.5);
    return { cases, filters, pages: opened };
  });

  const qb: Questions = {};
  const fixed: Record<string, string> = {};
  steps.forEach((step, i) => {
    const ref = partRef(segments, i);
    if (step.pages.length > 1)
      for (const pg of step.pages)
        qb[`s${i}.at.${pg}`] = choice(
          `${ref}\n\nWhich word of this part asks for ${pageLabels[pg]}?`,
          tokenOptions(scene, toks, segments[i]!.from, segments[i]!.to),
        );
    if (step.cases.length && segments.length > 1)
      qb[`s${i}.save`] = noul(
        `${ref}\n\nDoes this part itself ask to save its changes before the request goes on (for example 'speichern', 'save')?`,
      );
    for (const id of step.cases)
      for (const dim of caseDimensions) {
        const d = dimension(dim);
        qb[`s${i}.${id}.chg.${dim}`] = noul(
          `${ref}\n\nDoes this part ask to change this field of case ${caseLabel(scene, id)}? ${d.description} Current value: ${currentCaseValue(scene, id, dim) || "none"}. ${resolveNote}`,
        );
        const options = valueOptions(scene, dim, id);
        if (options.length === 1)
          fixed[`s${i}.${id}.val.${dim}`] = options[0]!.value;
        else if (options.length > 1)
          qb[`s${i}.${id}.val.${dim}`] = choice(
            `${ref}\n\nFor case ${caseLabel(scene, id)}: ${d.question} ${d.description} ${resolveNote}`,
            optionMap(options),
          );
      }
  });
  const b = await ask(state, qb);
  for (const [i, step] of steps.entries())
    if (step.pages.length > 1) {
      const at = Object.fromEntries(
        step.pages.map((pg) => [
          pg,
          Number(picked(b[`s${i}.at.${pg}`]).slice(1)),
        ]),
      );
      step.pages.sort((x, y) => at[x]! - at[y]!);
    }
  const perCase: Record<string, { seg: number; values: CaseValues }[]> = {};
  steps.forEach((step, i) => {
    for (const id of step.cases) {
      const values: CaseValues = {};
      const changeP: Partial<Record<CaseDimensionId, number>> = {};
      for (const dim of caseDimensions) {
        const py = yes(b[`s${i}.${id}.chg.${dim}`]);
        if (py < 0.5) continue;
        const key = `s${i}.${id}.val.${dim}`;
        const value = fixed[key] ?? (key in qb ? picked(b[key]) : ASK);
        // Setting a field to its current value is no change.
        if (value === currentCaseValue(scene, id, dim)) continue;
        values[dim] = value;
        changeP[dim] = py;
      }
      // One number fills one field: the same value in worked minutes and appointment length goes to the likelier field.
      const [m, d] = [values.workedMinutes, values.appointmentDuration];
      if (m !== undefined && m !== ASK && m === d) {
        const pm = changeP.workedMinutes ?? 0;
        const pd = changeP.appointmentDuration ?? 0;
        delete values[pm >= pd ? "appointmentDuration" : "workedMinutes"];
      }
      (perCase[id] ??= []).push({ seg: i, values });
    }
  });
  // A field set again in a later part is a sequence only when the earlier part saves; otherwise the later value corrects it.
  const cases: Record<string, CaseValues> = {};
  const sequence: Record<string, CaseValues[]> = {};
  for (const [id, entries] of Object.entries(perCase)) {
    const merged: CaseValues = {};
    let ordered = false;
    entries.forEach((entry, n) => {
      const overwritten = entries.slice(n + 1).some((later) =>
        Object.entries(later.values).some(([dim, v]) => {
          const previous = entry.values[dim as CaseDimensionId];
          return previous !== undefined && previous !== v;
        }),
      );
      if (overwritten && yes(b[`s${entry.seg}.save`]) >= 0.5) ordered = true;
      Object.assign(merged, entry.values);
    });
    cases[id] = merged;
    if (!ordered) continue;
    // Keep only steps that change the record; a repeated or current value is no step.
    let current = Object.fromEntries(
      caseDimensions.map((dim) => [dim, currentCaseValue(scene, id, dim)]),
    );
    const effective = entries
      .map((e) => e.values)
      .filter((values) => {
        const next = { ...current, ...values };
        const changed = JSON.stringify(next) !== JSON.stringify(current);
        current = next;
        return changed;
      });
    if (effective.length > 1) sequence[id] = effective;
  }
  const filters: Plan["filters"] = Object.assign(
    {},
    ...steps.map((st) => st.filters),
  );
  const visits: Page[] = steps.flatMap((st) => {
    const work = st.cases.length > 0 || Object.keys(st.filters).length > 0;
    return work && !st.pages.includes("cases")
      ? (["cases", ...st.pages] as Page[])
      : st.pages;
  });
  return {
    segments: segments.map((x) => x.text),
    cases,
    sequence,
    filters,
    visits,
    flags,
  };
}
