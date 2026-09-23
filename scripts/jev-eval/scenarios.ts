import {
  dimension,
  dimensionOptions,
  dimensions,
  filterValue,
  literalField,
  type CaseDimensionId,
  type ListDimensionId,
} from "../../shared/dimensions.js";
import {
  blockers,
  caseFiltersSchema,
  defaultCaseFilters,
  draftOf,
  seedWorkspace,
  type CaseDraft,
  type CaseFilters,
  type Page,
  type Workspace,
} from "../../shared/domain.js";
import {
  applyValues,
  blockedOn,
  caseDimensions,
  expectEnd,
  listDimensions,
  type CaseValues,
  type ExpectedEnd,
  type Intent,
} from "../../shared/intent.js";

export type AmbiguousValue =
  | { dimension: CaseDimensionId; caseId: string }
  | { dimension: ListDimensionId };
export type StartState = {
  page: Page;
  filters: CaseFilters;
  selectedCase: string | null;
  saved: Record<string, CaseValues>;
};
export type Scenario = {
  id: string;
  source: "regression" | "use-case" | "generated" | "authored";
  persona?: string;
  rationale?: string;
  request: string;
  noise: string[];
  minSamples: number;
  start: StartState;
  intent: Intent;
  ambiguous: AmbiguousValue[];
  expected: ExpectedEnd;
};

export const flagDimensions = dimensions.flatMap((entry) =>
  entry.kind === "flag" ? [entry.id] : [],
);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function startWorkspace(
  start: StartState,
  seed: Workspace = seedWorkspace(),
): Workspace {
  return {
    ...seed,
    cases: seed.cases.map((c) => {
      const values = start.saved[c.id];
      const draft = values && applyValues(draftOf(c), values);
      if (values && !draft)
        throw new Error(`Start values for ${c.id} are not writable`);
      return draft ? { ...c, ...draft } : c;
    }),
  };
}

type Definition = {
  id: string;
  source: Scenario["source"];
  request: string;
  noise?: string[];
  minSamples?: number;
  start?: Partial<StartState>;
  intent: Partial<Omit<Intent, "flags">> & { flags?: Partial<Intent["flags"]> };
  ambiguous?: AmbiguousValue[];
};
export function scenario(definition: Definition): Scenario {
  const start: StartState = {
    page: "cases",
    filters: defaultCaseFilters,
    selectedCase: null,
    saved: {},
    ...definition.start,
  };
  const intent: Intent = {
    cases: {},
    sequence: {},
    filters: {},
    pages: [],
    ...definition.intent,
    flags: {
      save: false,
      noSave: false,
      unsupported: false,
      sequence: false,
      ...definition.intent.flags,
    },
  };
  return {
    id: definition.id,
    source: definition.source,
    request: definition.request,
    noise: definition.noise ?? [],
    minSamples: definition.minSamples ?? 1,
    start,
    intent,
    ambiguous: definition.ambiguous ?? [],
    expected: expectEnd(startWorkspace(start), start.filters, intent),
  };
}

export function validateScenario(
  s: Scenario,
  seed: Workspace = seedWorkspace(),
): string[] {
  const problems: string[] = [];
  let workspace: Workspace;
  try {
    workspace = startWorkspace(s.start, seed);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const record = (id: string) => workspace.cases.find((c) => c.id === id);
  if (s.start.selectedCase && !record(s.start.selectedCase))
    problems.push(`start selects unknown case ${s.start.selectedCase}`);
  for (const c of workspace.cases)
    if (s.start.saved[c.id] && blockers(workspace, c).length)
      problems.push(`start record ${c.id} violates a business rule`);
  problems.push(...filterProblems(s, s.start.filters, workspace, "start"));

  const answers = s.ambiguous.flatMap((entry) => {
    const field = literalField(dimension(entry.dimension))?.id;
    const value =
      "caseId" in entry
        ? s.intent.cases[entry.caseId]?.[entry.dimension]
        : s.intent.filters[entry.dimension];
    if (value === undefined) {
      problems.push(`ambiguous ${entry.dimension} has no intended value`);
      return [];
    }
    return field
      ? [
          {
            fieldId: field,
            scope: "caseId" in entry ? entry.caseId : "cases",
            value,
          },
        ]
      : [];
  });
  const literal = (
    id: "workedMinutes" | "appointmentStart" | "appointmentDuration" | "search",
    value: string,
    caseId?: string,
  ) =>
    dimensionOptions(dimension(id), {
      workspace,
      request: s.request,
      answers,
      ...(caseId ? { caseId } : {}),
    }).some((option) => option.value === value);
  const reachable = (caseId: string, from: CaseDraft, to: CaseDraft) => {
    const c = record(caseId);
    if (!c) return [`unknown case ${caseId}`];
    const found: string[] = [];
    const technician = workspace.technicians.find(
      (t) => t.id === to.technicianId,
    );
    if (
      from.technicianId !== to.technicianId &&
      !technician?.skills.includes(c.skill)
    )
      found.push(
        `${caseId}: technician ${to.technicianId} lacks ${c.skill}, the menu entry is disabled`,
      );
    if (
      from.minutes !== to.minutes &&
      !literal("workedMinutes", String(to.minutes), caseId)
    )
      found.push(
        `${caseId}: worked minutes ${to.minutes} are neither a literal in the request nor an answer to an ambiguous dimension`,
      );
    if (to.appointment) {
      const start = to.appointment.start.slice(0, 16);
      if (
        start !== from.appointment?.start.slice(0, 16) &&
        !literal("appointmentStart", start, caseId)
      )
        found.push(`${caseId}: appointment start ${start} is not reachable`);
      if (
        to.appointment.minutes !== (from.appointment?.minutes ?? 60) &&
        !literal("appointmentDuration", String(to.appointment.minutes), caseId)
      )
        found.push(
          `${caseId}: appointment duration ${to.appointment.minutes} is not reachable`,
        );
    }
    if (!same(from.inspection, to.inspection))
      found.push(`${caseId}: inspection evidence can only come from the user`);
    if (blockedOn(workspace, caseId, to))
      found.push(`${caseId}: expected record violates a business rule`);
    return found;
  };

  const startDraft = (id: string) => {
    const c = record(id);
    if (!c) problems.push(`unknown case ${id}`);
    return c && draftOf(c);
  };
  const changed = Object.entries(s.expected.records).filter(
    ([id, values]) => !same(startDraft(id), values),
  );
  for (const [id, values] of changed) {
    const saves = s.expected.saves[id] ?? [];
    if (!saves.length) problems.push(`${id} changes without an expected save`);
    if (!same(saves.at(-1), values))
      problems.push(`${id}: last expected save differs from the end record`);
  }
  for (const [id, states] of Object.entries(s.expected.saves)) {
    let previous = startDraft(id);
    for (const state of states) {
      if (!previous) break;
      if (same(previous, state))
        problems.push(`${id}: a save without a change cannot be clicked`);
      problems.push(...reachable(id, previous, state));
      previous = state;
    }
  }
  if (s.expected.draft) {
    const { caseId, values } = s.expected.draft;
    const saved = record(caseId);
    if (saved) problems.push(...reachable(caseId, draftOf(saved), values));
    if (Object.keys(s.expected.saves).length)
      problems.push("a no-save request expects saves");
  }
  const draftCases = Object.entries(s.intent.cases).filter(([id, values]) => {
    const current = startDraft(id);
    return (
      current &&
      Object.keys(values).length &&
      !same(applyValues(current, values), current)
    );
  });
  if (s.intent.flags.noSave && draftCases.length > 1)
    problems.push("only one case can hold an unsaved draft");
  if (draftCases.length && !s.intent.flags.save && !s.intent.flags.noSave)
    problems.push("a change needs the save or the noSave flag");
  if (
    (s.expected.pageOrder.length || Object.keys(s.intent.sequence).length) &&
    !s.intent.flags.sequence
  )
    problems.push("an ordered intermediate state needs the sequence flag");
  problems.push(
    ...filterProblems(s, s.expected.filters, workspace, "expected"),
  );
  return problems;
}
function filterProblems(
  s: Scenario,
  filters: CaseFilters,
  workspace: Workspace,
  label: string,
) {
  const problems: string[] = [];
  if (!caseFiltersSchema.safeParse(filters).success)
    problems.push(`${label} filters do not match the filter schema`);
  const ids = (table: "customers" | "technicians") =>
    workspace[table].map((row) => row.id);
  if (
    filters.customerId !== null &&
    !ids("customers").includes(filters.customerId)
  )
    problems.push(`${label} customer filter ${filters.customerId} is unknown`);
  if (
    filters.technicianId !== null &&
    !ids("technicians").includes(filters.technicianId)
  )
    problems.push(
      `${label} technician filter ${filters.technicianId} is unknown`,
    );
  if (
    label === "expected" &&
    filters.search !== s.start.filters.search &&
    filters.search !== defaultCaseFilters.search &&
    !dimensionOptions(dimension("search"), {
      workspace,
      request: s.request,
    }).some((option) => option.value === filters.search)
  )
    problems.push(`search "${filters.search}" is not a literal in the request`);
  return problems;
}

const userRequest =
  "Ändere 1041 auf marla, sie wird das machen. 60 minuten wird sie brauchen.\nSetze einen Filter auf nordweg, und dann zeig mir die berichte ansicht";
const userIntent: Definition["intent"] = {
  cases: { "V-1041": { technician: "mara", workedMinutes: "60" } },
  filters: { customerFilter: "nord" },
  pages: ["reports"],
  flags: { save: true },
};
const userNoise = [
  "bare-id-number",
  "typo-name",
  "typo-customer",
  "order-words",
  "colloquial",
];
const useCases: Omit<Definition, "source">[] = [
  {
    id: "use-01",
    request: "Zeig mir die Kunden.",
    intent: { pages: ["customers"] },
  },
  {
    id: "use-02",
    request: "Öffne zuerst Kunden, dann Berichte und zuletzt das Team.",
    intent: {
      pages: ["customers", "reports", "team"],
      flags: { sequence: true },
    },
  },
  {
    id: "use-03",
    request: "Filter nach Nordwerk.",
    intent: { filters: { customerFilter: "nord" } },
  },
  {
    id: "use-04",
    request: "Zeige die offenen Vorgänge von Lea Sommer.",
    intent: { filters: { technicianFilter: "lea", statusFilter: "open" } },
  },
  {
    id: "use-05",
    request: "Setze V-1041 auf hohe Priorität und speichere.",
    intent: {
      cases: { "V-1041": { priority: "Hoch" } },
      flags: { save: true },
    },
  },
  {
    id: "use-06",
    request: "Öffne V-1035 wieder und speichere.",
    intent: { cases: { "V-1035": { status: "open" } }, flags: { save: true } },
  },
  {
    id: "use-07",
    request: "Entferne den Termin von V-1041 und speichere.",
    intent: {
      cases: { "V-1041": { appointmentStart: "none" } },
      flags: { save: true },
    },
  },
  {
    id: "use-08",
    request: 'Suche nach "Lindenwerk".',
    intent: { filters: { search: "Lindenwerk" } },
  },
  {
    id: "use-09",
    request: "Öffne V-1042, erfasse 35 Minuten, speichere und zeige Berichte.",
    intent: {
      cases: { "V-1042": { workedMinutes: "35" } },
      pages: ["reports"],
      flags: { save: true },
    },
  },
  {
    id: "use-10",
    request: "Trage für V-1042 25 Minuten als Entwurf ein, nicht speichern.",
    intent: {
      cases: { "V-1042": { workedMinutes: "25" } },
      flags: { noSave: true },
    },
  },
  {
    id: "use-11",
    request:
      "Weise V-1042 zuerst Lea Sommer zu und speichere. Danach Jonas Weber zuweisen und erneut speichern.",
    intent: {
      cases: { "V-1042": { technician: "jonas" } },
      sequence: {
        "V-1042": [{ technician: "lea" }, { technician: "jonas" }],
      },
      flags: { save: true, sequence: true },
    },
  },
  {
    id: "use-12",
    request:
      "Weise V-1041 Mara Schulz zu, erfasse 60 Minuten, filtere nach Nordwerk und zeige Berichte.",
    intent: userIntent,
  },
  {
    id: "use-13",
    request: "Erfasse Arbeitszeit für V-1042.",
    intent: {
      cases: { "V-1042": { workedMinutes: "30" } },
      flags: { save: true },
    },
    ambiguous: [{ dimension: "workedMinutes", caseId: "V-1042" }],
  },
  {
    id: "use-14",
    request: "Schließe V-1039 ab.",
    intent: { cases: { "V-1039": { status: "done" } }, flags: { save: true } },
  },
  {
    id: "use-15",
    request:
      "Weise V-1042 Lea Sommer zu und speichere. Sende danach eine E-Mail.",
    intent: {
      cases: { "V-1042": { technician: "lea" } },
      flags: { save: true, unsupported: true },
    },
  },
];
export function regressionScenarios(): Scenario[] {
  const fresh = scenario({
    id: "user-fresh",
    source: "regression",
    request: userRequest,
    noise: userNoise,
    minSamples: 2,
    start: { selectedCase: "V-1041" },
    intent: userIntent,
  });
  const repeat = scenario({
    id: "user-repeat",
    source: "regression",
    request: userRequest,
    noise: [...userNoise, "already-saved"],
    minSamples: 2,
    start: {
      page: fresh.expected.page ?? "cases",
      filters: fresh.expected.filters,
      selectedCase: "V-1041",
      saved: { "V-1041": { technician: "mara", workedMinutes: "60" } },
    },
    intent: userIntent,
  });
  return [
    fresh,
    repeat,
    ...useCases.map((definition) =>
      scenario({ ...definition, source: "use-case" }),
    ),
  ];
}

class Random {
  private state: number;
  constructor(seed: number) {
    this.state = seed;
  }
  next() {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  pick<T>(values: readonly T[]): T {
    const value = values[Math.floor(this.next() * values.length)];
    if (value === undefined) throw new Error("pick from an empty list");
    return value;
  }
  chance(p: number) {
    return this.next() < p;
  }
  shuffle<T>(values: readonly T[]): T[] {
    return [...values]
      .map((value) => ({ value, key: this.next() }))
      .sort((a, b) => a.key - b.key)
      .map(({ value }) => value);
  }
}

const titles: Record<string, string> = {
  "V-1042": "die Wartung Standort Nord",
  "V-1041": "den Zugang für Einkauf",
  "V-1039": "die Wartung Standort Süd",
  "V-1037": "die Rückfrage zur Jahresrechnung",
  "V-1035": "das Onboarding",
};
const technicianNames = {
  lea: ["Lea", "Lea Sommer", "lea", "Leah", "Frau Sommer"],
  jonas: ["Jonas", "Jonas Weber", "Jonsa", "jonas", "Jonas W."],
  mara: ["Mara", "Mara Schulz", "marla", "Mahra", "mara"],
} as const;
type Technician = keyof typeof technicianNames;
const technicians = Object.keys(technicianNames) as Technician[];
const customerNames = {
  nord: ["Nordwerk", "nordweg", "nordwerk", "Nordwerck", "Nordwerk GmbH"],
  hafen: ["Hafen & Partner", "Hafen und Partner", "hafen", "Hafen&Partner"],
  linden: ["Lindenwerk", "lindenwerk ag", "Lindwerk", "Lindenwerk AG"],
} as const;
type Customer = keyof typeof customerNames;
const customers = Object.keys(customerNames) as Customer[];
const typos = new Set([
  "marla",
  "Mahra",
  "Jonsa",
  "Leah",
  "nordweg",
  "Nordwerck",
  "Lindwerk",
]);
const minuteValues = [15, 20, 30, 45, 60, 75, 90, 120];
const unitPhrases = [
  ["eine Stunde", "60"],
  ["anderthalb Stunden", "90"],
  ["eine halbe Stunde", "30"],
  ["zwei Stunden", "120"],
] as const;
const naturalDates = [
  ["am Donnerstag um 10 Uhr", "2026-09-24T10:00"],
  ["nächsten Montag um 9", "2026-09-28T09:00"],
] as const;
const openCases = ["V-1042", "V-1041", "V-1039", "V-1037"] as const;

type Draft = {
  clauses: string[];
  intent: Intent;
  ambiguous: AmbiguousValue[];
  noise: Set<string>;
  saveMentioned: boolean;
};
type Context = { draft: Draft; caseId: string; ref: string | null; r: Random };
function caseRef(id: string, draft: Draft, r: Random) {
  const digits = id.slice(2);
  const form = r.pick(["id", "bare", "vorgang", "bare", "fall"] as const);
  if (form === "bare" || form === "fall") draft.noise.add("bare-id-number");
  return {
    id: `V-${digits}`,
    bare: digits,
    vorgang: `Vorgang ${digits}`,
    fall: `Fall ${digits}`,
  }[form];
}
function technicianName(t: Technician, draft: Draft, r: Random) {
  const name = r.pick(technicianNames[t]);
  if (typos.has(name)) draft.noise.add("typo-name");
  return name;
}
function customerName(c: Customer, draft: Draft, r: Random) {
  const name = r.pick(customerNames[c]);
  if (typos.has(name)) draft.noise.add("typo-customer");
  return name;
}
function setCase(draft: Draft, caseId: string, values: CaseValues = {}) {
  draft.intent.cases[caseId] = { ...draft.intent.cases[caseId], ...values };
}
const either = (
  r: Random,
  ref: string | null,
  withRef: (ref: string) => string[],
  without: string[],
) => r.pick(ref === null ? without : withRef(ref));

const intents: Record<string, (context: Context) => void> = {
  assign({ draft, caseId, ref, r }) {
    const t = r.pick(technicians);
    const name = technicianName(t, draft, r);
    draft.clauses.push(
      either(
        r,
        ref,
        (x) => [
          `weise ${x} ${name} zu`,
          `${name} soll ${x} übernehmen`,
          `ändere ${x} auf ${name}`,
          `${x} geht an ${name}`,
          `gib ${x} an ${name}`,
          `bei ${x} ist ab jetzt ${name} zuständig`,
        ],
        [
          `weise das ${name} zu`,
          `${name} soll das übernehmen`,
          `zuständig ist ${name}`,
        ],
      ) +
        r.pick(
          t === "jonas"
            ? ["", ", der kümmert sich drum"]
            : ["", "", ", sie macht das"],
        ),
    );
    setCase(draft, caseId, { technician: t });
  },
  assignByTitle({ draft, caseId, r }) {
    const t = r.pick(technicians);
    draft.clauses.push(
      `${titles[caseId]} soll ${technicianName(t, draft, r)} machen`,
    );
    draft.noise.add("case-by-title");
    setCase(draft, caseId, { technician: t });
  },
  openCase({ draft, caseId, ref, r }) {
    draft.clauses.push(
      either(
        r,
        ref,
        (x) => [`öffne ${x}`, `mach mal ${x} auf`, `geh in ${x}`],
        ["öffne den"],
      ),
    );
    setCase(draft, caseId);
  },
  worked({ draft, caseId, ref, r }) {
    const n = r.pick(minuteValues);
    if (r.chance(0.25)) {
      draft.noise.add("name-without-assignment");
      draft.clauses.push(
        `${technicianName(r.pick(technicians), draft, r)} hat ${ref === null ? "da" : `bei ${ref}`} ${n} Minuten gearbeitet`,
      );
    } else
      draft.clauses.push(
        either(
          r,
          ref,
          (x) => [
            `erfasse ${n} Minuten für ${x}`,
            `bei ${x} ${n} min Arbeitszeit eintragen`,
            `${x}: ${n} minuten gearbeitet`,
            `${x} braucht ${n} Minuten`,
          ],
          [
            `erfasse ${n} Minuten`,
            `trag ${n} min Arbeitszeit ein`,
            `Arbeitszeit ${n} Minuten`,
            `buch ${n} minuten drauf`,
            `${n} minuten wird das dauern`,
          ],
        ),
      );
    setCase(draft, caseId, { workedMinutes: String(n) });
  },
  workedUnits({ draft, caseId, ref, r }) {
    const [phrase, minutes] = r.pick(unitPhrases);
    draft.clauses.push(
      either(
        r,
        ref,
        (x) => [
          `erfasse für ${x} ${phrase} Arbeitszeit`,
          `bei ${x} ${phrase} gearbeitet`,
        ],
        [`erfasse ${phrase} Arbeitszeit`],
      ),
    );
    draft.noise.add("unit-words");
    setCase(draft, caseId, { workedMinutes: minutes });
    draft.ambiguous.push({ dimension: "workedMinutes", caseId });
  },
  workedNoValue({ draft, caseId, ref, r }) {
    draft.clauses.push(
      either(
        r,
        ref,
        (x) => [
          `trag bei ${x} die Arbeitszeit ein`,
          `erfasse noch die Arbeitszeit für ${x}`,
        ],
        ["trag noch die Arbeitszeit ein"],
      ),
    );
    setCase(draft, caseId, { workedMinutes: String(r.pick(minuteValues)) });
    draft.ambiguous.push({ dimension: "workedMinutes", caseId });
  },
  duration({ draft, caseId, ref, r }) {
    const n = r.pick([30, 45, 90, 180]);
    draft.clauses.push(
      either(r, ref, (x) => [`der Termin von ${x} soll ${n} Minuten dauern`], [
        `der Termin soll ${n} Minuten dauern`,
        `plan ${n} Minuten für den Termin ein`,
        `Termindauer ${n} min`,
      ]),
    );
    setCase(draft, caseId, { appointmentDuration: String(n) });
  },
  appointmentStart({ draft, caseId, ref, r }) {
    const date = r.pick(["2026-09-25", "2026-09-28", "2026-10-01"]);
    const time = r.pick(["08:30", "10:00", "13:15"]);
    draft.clauses.push(
      either(
        r,
        ref,
        (x) => [
          `Termin für ${x} am ${date} um ${time}`,
          `leg den Termin von ${x} auf ${date} ${time}`,
        ],
        [`Termin am ${date} um ${time}`, `Termin auf ${date} ${time} legen`],
      ),
    );
    setCase(draft, caseId, { appointmentStart: `${date}T${time}` });
  },
  appointmentWords({ draft, caseId, ref, r }) {
    const [phrase, value] = r.pick(naturalDates);
    draft.clauses.push(
      either(
        r,
        ref,
        (x) => [
          `Termin für ${x} ${phrase}`,
          `${x} bekommt einen Termin ${phrase}`,
        ],
        [`Termin ${phrase}`],
      ),
    );
    draft.noise.add("natural-date");
    setCase(draft, caseId, { appointmentStart: value });
    draft.ambiguous.push({ dimension: "appointmentStart", caseId });
  },
  appointmentClear({ draft, caseId, ref, r }) {
    draft.clauses.push(
      either(
        r,
        ref,
        (x) => [
          `entferne den Termin von ${x}`,
          `Termin bei ${x} streichen`,
          `${x} braucht keinen Termin mehr`,
        ],
        ["Termin entfernen"],
      ),
    );
    setCase(draft, caseId, { appointmentStart: "none" });
  },
  complete({ draft, caseId, ref, r }) {
    draft.clauses.push(
      either(
        r,
        ref,
        (x) => [
          `schließ ${x} ab`,
          `setz ${x} auf erledigt`,
          `${x} ist fertig, markier das als erledigt`,
        ],
        ["als erledigt markieren", "dann abschließen"],
      ),
    );
    setCase(draft, caseId, { status: "done" });
  },
  reopen({ draft, r }) {
    const x = caseRef("V-1035", draft, r);
    draft.clauses.push(
      r.pick([
        `öffne ${x} wieder`,
        `${x} nochmal aufmachen, war doch nicht fertig`,
      ]),
    );
    setCase(draft, "V-1035", { status: "open" });
  },
  priority({ draft, caseId, ref, r }) {
    const high = r.chance(0.6);
    draft.clauses.push(
      high
        ? either(
            r,
            ref,
            (x) => [
              `setz ${x} auf hohe Priorität`,
              `${x} ist dringend, Prio hoch`,
            ],
            ["Prio hoch"],
          )
        : either(
            r,
            ref,
            (x) => [
              `Priorität von ${x} auf normal`,
              `${x} ist nicht mehr dringend, normale Prio`,
            ],
            ["Priorität normal"],
          ),
    );
    setCase(draft, caseId, { priority: high ? "Hoch" : "Normal" });
  },
  customerFilter({ draft, r }) {
    const c = r.pick(customers);
    const name = customerName(c, draft, r);
    draft.clauses.push(
      r.pick([
        `filter auf ${name}`,
        `setz einen Filter auf ${name}`,
        `Kundenfilter ${name}`,
        `grenz die Liste auf ${name} ein`,
      ]),
    );
    draft.intent.filters.customerFilter = c;
  },
  customerAll({ draft, r }) {
    draft.clauses.push(
      r.pick(["nimm den Kundenfilter raus", "Kundenfilter wieder auf alle"]),
    );
    draft.intent.filters.customerFilter = "all";
  },
  technicianFilter({ draft, r }) {
    const t = r.pick(technicians);
    const name = technicianName(t, draft, r);
    draft.noise.add("name-without-assignment");
    draft.clauses.push(
      r.pick([
        `filter die Liste nach ${name}`,
        `Zuständigkeitsfilter auf ${name}`,
        `nur die Fälle, für die ${name} zuständig ist`,
      ]),
    );
    draft.intent.filters.technicianFilter = t;
  },
  statusFilter({ draft, r }) {
    const open = r.chance(0.6);
    draft.clauses.push(
      open
        ? r.pick(["nur offene", "blende die erledigten aus"])
        : r.pick(["nur die erledigten", "zeig nur abgeschlossene"]),
    );
    draft.intent.filters.statusFilter = open ? "open" : "done";
  },
  search({ draft, r }) {
    const text = r.pick(["Wartung", "Zugang", "Onboarding", "Halle"]);
    draft.clauses.push(r.pick([`such nach "${text}"`, `Suche: „${text}“`]));
    draft.intent.filters.search = text;
  },
  resetAll({ draft, r }) {
    draft.clauses.push(
      r.pick([
        "setz alle Filter und die Suche zurück",
        "Filter und Suche komplett zurücksetzen",
      ]),
    );
    for (const id of listDimensions)
      draft.intent.filters[id] = filterValue(id, defaultCaseFilters);
  },
  page({ draft, r }) {
    const options: [Page, string[]][] = [
      [
        "reports",
        [
          "zeig mir die Berichte",
          "berichte ansicht",
          "dann die Berrichte",
          "öffne Berichte",
        ],
      ],
      ["team", ["geh ins Team", "zeig das Team", "Teamansicht bitte"]],
      ["customers", ["öffne die Kundenübersicht", "zeig die Kunden"]],
      ["cases", ["zeig die Vorgangsliste", "zurück zu den Vorgängen"]],
    ];
    const [page, phrases] = r.pick(
      options.filter(([p]) => !draft.intent.pages.includes(p)),
    );
    const phrase = r.pick(phrases);
    if (phrase.includes("Berrichte")) draft.noise.add("typo-view");
    draft.clauses.push(phrase);
    draft.intent.pages.push(page);
    if (draft.intent.pages.length > 1) draft.intent.flags.sequence = true;
  },
  save({ draft, r }) {
    draft.clauses.push(
      r.pick([
        "und speichern",
        "speicher das",
        "dann sichern",
        "abspeichern bitte",
      ]),
    );
    draft.saveMentioned = true;
  },
  noSave({ draft, r }) {
    draft.clauses.push(
      r.pick([
        "aber nicht speichern",
        "nur als Entwurf, noch nicht speichern",
        "nicht sichern",
      ]),
    );
    draft.noise.add("negation");
    draft.intent.flags.noSave = true;
  },
  unsupported({ draft, r }) {
    draft.clauses.push(
      r.pick([
        "schick danach eine Mail an den Kunden",
        "und ruf Mia Hansen an",
        "druck mir das aus",
        "schreib eine Rechnung dafür",
      ]),
    );
    draft.noise.add("unsupported-task");
    draft.intent.flags.unsupported = true;
  },
  overwrite({ draft, caseId, ref, r }) {
    const [first, second] = r.shuffle(technicians) as [Technician, Technician];
    const x = ref ?? caseRef(caseId, draft, r);
    const a = technicianName(first, draft, r);
    const b = technicianName(second, draft, r);
    draft.clauses.push(
      r.pick([
        `weise ${x} erst ${a} zu und speichere, danach doch ${b} und nochmal speichern`,
        `${x} zuerst an ${a}, speichern, und anschließend auf ${b} ändern und wieder speichern`,
      ]),
    );
    draft.noise.add("order-words");
    setCase(draft, caseId, { technician: second });
    draft.intent.sequence[caseId] = [
      { technician: first },
      { technician: second },
    ];
    draft.intent.flags.sequence = true;
    draft.saveMentioned = true;
  },
  twoCasesSameTechnician({ draft, caseId, r }) {
    const other = r.pick(openCases.filter((c) => c !== caseId));
    const t = r.pick(technicians);
    draft.clauses.push(
      `${caseRef(caseId, draft, r)} und ${caseRef(other, draft, r)} an ${technicianName(t, draft, r)}`,
    );
    draft.noise.add("two-cases");
    setCase(draft, caseId, { technician: t });
    setCase(draft, other, { technician: t });
  },
  twoCasesDifferentTechnicians({ draft, caseId, r }) {
    const other = r.pick(openCases.filter((c) => c !== caseId));
    const [first, second] = r.shuffle(technicians) as [Technician, Technician];
    draft.clauses.push(
      `${caseRef(caseId, draft, r)} an ${technicianName(first, draft, r)}, ${caseRef(other, draft, r)} an ${technicianName(second, draft, r)}`,
    );
    draft.noise.add("two-cases");
    setCase(draft, caseId, { technician: first });
    setCase(draft, other, { technician: second });
  },
  twoCasesTechnicianAndMinutes({ draft, caseId, r }) {
    const other = r.pick(openCases.filter((c) => c !== caseId));
    const t = r.pick(technicians);
    const n = r.pick(minuteValues);
    draft.clauses.push(
      `${caseRef(caseId, draft, r)} an ${technicianName(t, draft, r)} und bei ${caseRef(other, draft, r)} ${n} Minuten eintragen`,
    );
    draft.noise.add("two-cases");
    setCase(draft, caseId, { technician: t });
    setCase(draft, other, { workedMinutes: String(n) });
  },
};
const referring = new Set([
  "assign",
  "openCase",
  "worked",
  "workedUnits",
  "workedNoValue",
  "duration",
  "appointmentStart",
  "appointmentWords",
  "appointmentClear",
  "complete",
  "priority",
  "overwrite",
]);
export const recipes: string[][] = [
  ["assign", "worked", "customerFilter", "page"],
  ["assign", "save"],
  ["worked", "save"],
  ["workedUnits", "save"],
  ["assign", "worked", "noSave"],
  ["openCase", "appointmentStart", "duration", "save"],
  ["appointmentClear", "save"],
  ["complete"],
  ["reopen", "save"],
  ["priority", "save", "unsupported"],
  ["technicianFilter", "statusFilter"],
  ["customerFilter", "statusFilter", "page"],
  ["search", "page"],
  ["page", "page"],
  ["overwrite"],
  ["twoCasesSameTechnician", "save"],
  ["twoCasesDifferentTechnicians", "save"],
  ["assign", "worked", "save", "unsupported"],
  ["resetAll", "page"],
  ["workedNoValue"],
  ["openCase", "duration", "worked", "save"],
  ["appointmentWords", "save"],
  ["customerAll", "search"],
  ["assignByTitle", "save"],
  ["assign", "page"],
  ["twoCasesTechnicianAndMinutes", "save"],
  ["assign", "worked", "customerFilter", "page"],
  ["overwrite", "page"],
  ["priority", "noSave"],
  ["appointmentClear", "page"],
];

function draw(recipe: string[], r: Random, index: number, seed: Workspace) {
  const draft: Draft = {
    clauses: [],
    intent: {
      cases: {},
      sequence: {},
      filters: {},
      pages: [],
      flags: {
        save: false,
        noSave: false,
        unsupported: false,
        sequence: false,
      },
    },
    ambiguous: [],
    noise: new Set(),
    saveMentioned: false,
  };
  const caseId = r.pick(openCases);
  let introduced = false;
  for (const kind of recipe) {
    const refers = referring.has(kind);
    const ref =
      !refers || (introduced && r.chance(0.6))
        ? null
        : caseRef(caseId, draft, r);
    const intent = intents[kind];
    if (!intent) throw new Error(`Unknown intent ${kind}`);
    intent({ draft, caseId, ref, r });
    if (refers) introduced = true;
  }
  let text = draft.clauses[0] ?? "";
  for (const clause of draft.clauses.slice(1)) {
    const connector = r.pick([
      ", ",
      " und ",
      ". ",
      ", dann ",
      "\n",
      " und dann ",
    ]);
    if (connector.includes("dann")) draft.noise.add("order-words");
    text +=
      connector +
      (/(und|dann) $/.test(connector)
        ? clause.replace(/^(und|dann) /, "")
        : clause);
  }
  const prefix = r.pick([
    "",
    "",
    "hey, ",
    "bitte ",
    "kannst du mal ",
    "so, ",
    "äh ",
  ]);
  const suffix = r.pick(["", "", " danke", " bitte", "!", " thx"]);
  if (prefix || suffix) draft.noise.add("filler");
  text = prefix + text + suffix;
  if (r.chance(0.3)) {
    text = text.toLowerCase();
    if (draft.intent.filters.search)
      draft.intent.filters.search = draft.intent.filters.search.toLowerCase();
    draft.noise.add("lowercase");
  } else text = text.charAt(0).toUpperCase() + text.slice(1);

  const changes = Object.values(draft.intent.cases).some(
    (v) => Object.keys(v).length,
  );
  draft.intent.flags.save =
    draft.saveMentioned || (changes && !draft.intent.flags.noSave);
  const start: StartState = {
    page: r.pick(["cases", "cases", "customers", "team", "reports"] as const),
    filters: defaultCaseFilters,
    selectedCase: r.chance(0.4) ? r.pick(seed.cases).id : null,
    saved: {},
  };
  const filters = draft.intent.filters;
  if (filters.customerFilter === "all" || recipe.includes("resetAll"))
    start.filters = {
      ...start.filters,
      customerId: r.pick(customers),
      ...(recipe.includes("resetAll")
        ? { status: r.pick(["open", "done"] as const) }
        : {}),
    };
  else if (!Object.keys(filters).length && r.chance(0.25))
    start.filters = r.chance(0.5)
      ? { ...start.filters, customerId: r.pick(customers) }
      : { ...start.filters, status: "open" };
  const repeatable = Object.entries(draft.intent.cases).find(
    ([id, values]) =>
      values.technician &&
      !draft.intent.sequence[id] &&
      !draft.ambiguous.some(
        (entry) => "caseId" in entry && entry.caseId === id,
      ),
  );
  if (repeatable && r.chance(0.2)) {
    start.saved[repeatable[0]] = repeatable[1];
    draft.noise.add("already-saved");
  }
  return scenario({
    id: `gen-${String(index + 1).padStart(2, "0")}`,
    source: "generated",
    request: text,
    noise: [...draft.noise].sort(),
    start,
    intent: draft.intent,
    ambiguous: draft.ambiguous,
  });
}
function generationProblems(s: Scenario, seed: Workspace) {
  const problems = validateScenario(s, seed);
  if (s.expected.handoff === "blocked")
    problems.push("generated scenarios keep every intended change reachable");
  for (const [caseId, values] of Object.entries(s.intent.cases)) {
    const original = seed.cases.find((c) => c.id === caseId);
    const unchanged =
      original &&
      Object.keys(values).length > 0 &&
      !s.start.saved[caseId] &&
      same(applyValues(draftOf(original), values), draftOf(original));
    if (unchanged)
      problems.push(`${caseId}: the request asks for its current values`);
  }
  return problems;
}
export function generateScenarios(
  seedNumber: number,
  count: number,
): Scenario[] {
  const r = new Random(seedNumber);
  const seed = seedWorkspace();
  return Array.from({ length: count }, (_, index) => {
    const recipe = recipes[index % recipes.length] ?? [];
    for (let attempt = 0; attempt < 200; attempt++) {
      const candidate = draw(recipe, r, index, seed);
      if (!generationProblems(candidate, seed).length) return candidate;
    }
    throw new Error(`No valid scenario for recipe ${recipe.join("+")}`);
  });
}
export function allScenarios(options: { seed: number; count: number }) {
  return [
    ...regressionScenarios(),
    ...generateScenarios(options.seed, options.count),
  ];
}
