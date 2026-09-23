import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import type { FieldDescription } from "../../shared/command.js";
import type { ValueReading } from "../../shared/value-reading.js";
import { seedWorkspace } from "../../shared/domain.js";
import { readConfig } from "../../server/config.js";
import { createClient } from "../../server/jev.js";
import { readAnswers } from "../../server/plan.js";
import { readValues } from "../../server/reader.js";
import { phrasings, type Expected } from "./phrasings.js";

// Measures the value reader on the phrasing table and on the value mentions of
// scenario files: one live call per item, the pick, its confidence and whether
// it matches, then the prefill a bar would give.
const { values } = parseArgs({
  options: {
    scenarios: { type: "string", multiple: true, default: [] },
    out: { type: "string" },
    concurrency: { type: "string", default: "4" },
    only: { type: "string" },
    match: { type: "string" },
  },
});
const today = "2026-09-22";
// The labels, limits and texts the case screen gives these fields (frontend/src/cases.ts, cases.html).
const labels = {
  minutes: [
    "Arbeitszeit in Minuten",
    0,
    10000,
    "worked minutes (time actually spent on the case, Arbeitszeit)",
    "the planned length of an appointment (that is the appointment duration field)",
  ],
  duration: [
    "Termindauer in Minuten",
    15,
    480,
    "appointment duration in minutes (planned length of the appointment, Termindauer)",
    "time actually worked on the case (that is the worked minutes field)",
  ],
  appointment: [
    "Termin",
    undefined,
    undefined,
    "appointment start date and time (Termin)",
    "worked minutes or the appointment duration",
  ],
} as const;
function field(id: Expected["field"], scope: string): FieldDescription {
  const [label, min, max, name, notFor] = labels[id];
  return {
    id,
    scope,
    label: `${scope} · ${label}`,
    kind: "draft",
    type: id === "appointment" ? "datetime-local" : "number",
    current: "",
    ...(min === undefined ? {} : { min, max }),
    jev: { name, notFor },
  };
}
type Item = {
  set: string;
  id: string;
  request: string;
  scope: string;
} & Expected;
const dimensionField = {
  workedMinutes: "minutes",
  appointmentDuration: "duration",
  appointmentStart: "appointment",
} as const;
async function scenarioItems(path: string): Promise<Item[]> {
  const name = basename(path, ".json");
  const set =
    ({ holdout: "h1", holdout2: "h2" } as Record<string, string>)[name] ?? name;
  const scenarios = JSON.parse(await readFile(path, "utf8")) as {
    id: string;
    request: string;
    intent: {
      cases: Record<string, Record<string, string>>;
      sequence: Record<string, Record<string, string>[]>;
    };
  }[];
  return scenarios.flatMap((s) =>
    Object.entries(s.intent.cases).flatMap(([scope, dims]) =>
      Object.entries(dimensionField).flatMap(([dim, id]): Item[] => {
        const value = dims[dim];
        const sequenced = s.intent.sequence[scope]?.some((step) => dim in step);
        if (sequenced || value === "none" || value === "__ask") return [];
        const base = {
          set,
          id: `${s.id}/${scope}/${id}`,
          request: s.request,
          scope,
        };
        if (id === "appointment")
          return [
            value === undefined
              ? { ...base, field: id, date: null, time: null }
              : {
                  ...base,
                  field: id,
                  date: value.slice(0, 10),
                  time: value.slice(11, 16),
                },
          ];
        return [{ ...base, field: id, value: value ?? null }];
      }),
    ),
  );
}
const items: Item[] = [
  ...phrasings.map((p, i) => ({
    set: "table",
    id: `t${i}`,
    scope: "V-1042",
    ...p,
  })),
  ...(await Promise.all(values.scenarios.map(scenarioItems))).flat(),
].filter(
  (item) =>
    (!values.only || item.set === values.only) &&
    (!values.match || new RegExp(values.match, "i").test(item.request)),
);

const config = readConfig({ ...process.env, TYPESAFE_MODE: "live" });
if (config.mode !== "live") throw new Error("live config required");
const usage = { calls: 0, input: 0, output: 0 };
const client = createClient(
  config,
  async (url, init) => {
    const response = await fetch(url, init);
    const body = (await response.clone().json()) as {
      usage?: { input_tokens: number; output_tokens: number };
    };
    usage.calls++;
    usage.input += body.usage?.input_tokens ?? 0;
    usage.output += body.usage?.output_tokens ?? 0;
    return response;
  },
  60000,
);

type Part = {
  expected: string | null;
  value: string | null;
  confidence: number;
};
type Row = Item & {
  parts: Record<string, Part>;
  picks?: Record<string, string>;
  error?: string;
};
async function measure(item: Item): Promise<Row> {
  const picks: Record<string, string> = {};
  try {
    const [reading] = await readValues(
      { request: item.request, today, fields: [field(item.field, item.scope)] },
      seedWorkspace(),
      async (sent) => {
        let raw: unknown;
        for (let attempt = 0; ; attempt++)
          try {
            raw = await client.systemOne(sent);
            break;
          } catch (error) {
            if (attempt >= 3) throw error;
            await new Promise((resolve) =>
              setTimeout(resolve, 3000 * (attempt + 1)),
            );
          }
        const answers = readAnswers(sent.questions, raw);
        for (const [key, a] of Object.entries(answers))
          if (a.type === "choice")
            picks[key] =
              `${a.choice} ${a.confidence.toFixed(2)} [${Object.entries(
                a.probabilities,
              )
                .sort((x, y) => y[1] - x[1])
                .slice(0, 3)
                .map(([k, v]) => `${k}:${v.toFixed(2)}`)
                .join(" ")}]`;
        return answers;
      },
    );
    const r = reading as ValueReading;
    const parts: Record<string, Part> =
      item.field === "appointment" && r.type === "datetime-local"
        ? {
            date: { expected: item.date, ...r.date },
            time: { expected: item.time, ...r.time },
          }
        : r.type === "number" && item.field !== "appointment"
          ? { value: { expected: item.value, ...r.value } }
          : {};
    return { ...item, parts, picks };
  } catch (error) {
    return { ...item, parts: {}, error: String(error) };
  }
}
const rows: Row[] = [];
const queue = [...items];
await Promise.all(
  Array.from({ length: Number(values.concurrency) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const row = await measure(item);
      rows.push(row);
      const shown = Object.entries(row.parts)
        .map(
          ([k, p]) =>
            `${k}=${p.value}(${p.confidence.toFixed(2)})${p.value === p.expected ? "" : ` want ${p.expected}`}`,
        )
        .join(" ");
      process.stdout.write(
        `${row.set} ${row.id} ${row.error ?? shown} | ${row.request.slice(0, 70)}\n`,
      );
    }
  }),
);

const bars = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
const lines: string[] = [];
for (const set of [...new Set(rows.map((r) => r.set))]) {
  const parts = rows
    .filter((r) => r.set === set)
    .flatMap((r) => Object.values(r.parts));
  const errors = rows.filter((r) => r.set === set && r.error).length;
  const exact = parts.filter((p) => p.value === p.expected).length;
  lines.push(
    `${set}: ${parts.length} parts, read exactly ${exact}, errors ${errors}`,
  );
  for (const bar of bars) {
    const shown = parts.filter((p) => p.value !== null && p.confidence >= bar);
    const right = shown.filter((p) => p.value === p.expected).length;
    const wanted = parts.filter((p) => p.expected !== null).length;
    lines.push(
      `  bar ${bar.toFixed(2)}: prefilled ${shown.length}, right ${right}, wrong ${shown.length - right}, missed ${wanted - right} of ${wanted} stated`,
    );
  }
}
lines.push(
  `calls ${usage.calls}, input tokens ${usage.input} (${Math.round(usage.input / Math.max(1, usage.calls))}/call), output tokens ${usage.output}`,
);
process.stdout.write(`${lines.join("\n")}\n`);
if (values.out)
  await writeFile(
    values.out,
    JSON.stringify({ rows, summary: lines }, null, 2),
  );
