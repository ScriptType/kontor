import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  caseFiltersSchema,
  defaultCaseFilters,
  editableSchema,
  pageSchema,
} from "../../shared/domain.js";
import {
  caseDimensions,
  expectEnd,
  flagDimensions,
  listDimensions,
  scenario,
  validateScenario,
  type Scenario,
} from "./scenarios.js";

const caseValuesSchema = z.partialRecord(z.enum(caseDimensions), z.string());
const startSchema = z.strictObject({
  page: pageSchema,
  filters: caseFiltersSchema.strict(),
  selectedCase: z.string().nullable(),
  saved: z.record(z.string(), caseValuesSchema),
});
const intentSchema = z.strictObject({
  cases: z.record(z.string(), caseValuesSchema),
  sequence: z.record(z.string(), z.array(caseValuesSchema)),
  filters: z.partialRecord(z.enum(listDimensions), z.string()),
  pages: z.array(pageSchema),
  flags: z.record(z.enum(flagDimensions), z.boolean()),
});
const ambiguousSchema = z.union([
  z.strictObject({ dimension: z.enum(caseDimensions), caseId: z.string() }),
  z.strictObject({ dimension: z.enum(listDimensions) }),
]);
const scenarioId = z.string().regex(/^[\w.-]+$/);
export const scenarioSchema: z.ZodType<Scenario> = z.strictObject({
  id: scenarioId,
  source: z.enum(["regression", "use-case", "generated", "authored"]),
  persona: z.string().optional(),
  rationale: z.string().optional(),
  request: z.string().min(1),
  noise: z.array(z.string()),
  minSamples: z.number().int().min(1),
  start: startSchema,
  intent: intentSchema,
  ambiguous: z.array(ambiguousSchema),
  expected: z.strictObject({
    page: pageSchema.nullable(),
    pageOrder: z.array(pageSchema),
    filters: caseFiltersSchema.strict(),
    records: z.record(z.string(), editableSchema.strict()),
    saves: z.record(z.string(), z.array(editableSchema.strict())),
    draft: z
      .strictObject({ caseId: z.string(), values: editableSchema.strict() })
      .nullable(),
    handoff: z.enum(["unsupported", "blocked"]).nullable(),
  }),
});

export function scenarioProblems(scenarios: Scenario[]): string[] {
  const seen = new Set<string>();
  return scenarios.flatMap((s) => {
    const problems = [...validateScenario(s)];
    if (seen.has(s.id)) problems.push("the id is used twice");
    seen.add(s.id);
    try {
      if (!isDeepStrictEqual(expectEnd(s.start, s.intent), s.expected))
        problems.push(
          "expected differs from the end its start and intent imply",
        );
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    return problems.map((problem) => `${s.id}: ${problem}`);
  });
}

export async function readScenarios(path: string) {
  const bytes = await readFile(path);
  const parsed = z
    .array(scenarioSchema)
    .min(1)
    .safeParse(JSON.parse(bytes.toString("utf8")));
  if (!parsed.success)
    throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
  const problems = scenarioProblems(parsed.data);
  if (problems.length)
    throw new Error(`${path}:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  return {
    scenarios: parsed.data,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export const draftSchema = z.strictObject({
  id: scenarioId,
  persona: z.string().min(1),
  request: z.string().min(1),
  start: startSchema
    .extend({ filters: caseFiltersSchema.partial().strict() })
    .partial()
    .default({}),
  intent: intentSchema
    .extend({
      flags: z.partialRecord(z.enum(flagDimensions), z.boolean()),
    })
    .partial(),
  ambiguous: z.array(ambiguousSchema).default([]),
  tags: z.array(z.string()).default([]),
  rationale: z.string().min(1),
});
export type Draft = z.input<typeof draftSchema>;

export function scenarioFromDraft(input: unknown): Scenario {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  const draft = parsed.data;
  const { cases = {}, sequence = {}, pages = [], flags = {} } = draft.intent;
  const changes = Object.values(cases).some(
    (values) => Object.keys(values).length,
  );
  const built: Scenario = {
    ...scenario({
      id: draft.id,
      source: "authored",
      request: draft.request,
      noise: draft.tags,
      start: {
        ...draft.start,
        filters: { ...defaultCaseFilters, ...draft.start.filters },
      },
      intent: {
        ...draft.intent,
        flags: {
          ...flags,
          save: flags.save ?? (changes && !flags.noSave),
          sequence:
            flags.sequence ??
            (pages.length > 1 || Object.keys(sequence).length > 0),
        },
      },
      ambiguous: draft.ambiguous,
    }),
    persona: draft.persona,
    rationale: draft.rationale,
  };
  const problems = scenarioProblems([built]);
  if (problems.length) throw new Error(problems.join("\n"));
  return built;
}
