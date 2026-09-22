import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { scenarioFromDraft, scenarioProblems } from "./scenario-files.js";
import type { Scenario } from "./scenarios.js";

const { values } = parseArgs({
  options: { in: { type: "string" }, out: { type: "string" } },
});
if (!values.in || !values.out)
  throw new Error("Usage: draft.ts --in <draft.json> --out <scenarios.json>");
const input: unknown = JSON.parse(await readFile(values.in, "utf8"));
const problems: string[] = [];
const scenarios = (Array.isArray(input) ? input : [input]).flatMap(
  (draft: unknown, index) => {
    try {
      return [scenarioFromDraft(draft)];
    } catch (error) {
      const id = z.object({ id: z.string() }).safeParse(draft);
      problems.push(
        `draft ${index + 1}${id.success ? ` (${id.data.id})` : ""}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  },
);
problems.push(...scenarioProblems(scenarios));
if (problems.length) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}
await writeFile(values.out, `${JSON.stringify(scenarios, null, 2)}\n`);
const describe = ({ id, expected }: Scenario) =>
  [
    id,
    `page ${expected.page ?? "unchanged"}`,
    `filters ${JSON.stringify(expected.filters)}`,
    `saves ${
      Object.entries(expected.saves)
        .map(([caseId, states]) => `${caseId}x${states.length}`)
        .join(",") || "none"
    }`,
    ...(expected.draft ? [`draft ${expected.draft.caseId}`] : []),
    ...(expected.handoff ? [`handoff ${expected.handoff}`] : []),
  ].join(" · ");
process.stdout.write(
  `${scenarios.map(describe).join("\n")}\n${scenarios.length} scenarios → ${values.out}\n`,
);
