import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendTsv } from "../scripts/jev-eval/report.js";
import {
  readScenarios,
  scenarioFromDraft,
  type Draft,
} from "../scripts/jev-eval/scenario-files.js";
import { allScenarios } from "../scripts/jev-eval/scenarios.js";
import { draftOf, seedWorkspace } from "../shared/domain.js";

async function file(content: unknown) {
  const path = join(await mkdtemp(join(tmpdir(), "jev-eval-")), "s.json");
  await writeFile(path, JSON.stringify(content, null, 2));
  return path;
}

test("a written scenario set reads back unchanged with the file's sha256", async () => {
  const scenarios = allScenarios({ seed: 880001, count: 30 });
  const path = await file(scenarios);
  const read = await readScenarios(path);
  assert.deepEqual(read.scenarios, scenarios);
  assert.equal(
    read.sha256,
    createHash("sha256")
      .update(JSON.stringify(scenarios, null, 2))
      .digest("hex"),
  );
});
test("a scenario file with a misspelled dimension, a stale expectation or a twice used id is refused", async () => {
  const [fresh, repeat] = allScenarios({ seed: 1, count: 0 });
  assert(fresh && repeat);
  const typo = {
    ...fresh,
    intent: { ...fresh.intent, cases: { "V-1041": { minutes: "60" } } },
  };
  await assert.rejects(readScenarios(await file([typo])), /minutes/);
  const stale = {
    ...fresh,
    expected: { ...fresh.expected, page: "team" },
  };
  await assert.rejects(
    readScenarios(await file([stale])),
    /user-fresh: expected differs from the end its start and intent imply/,
  );
  await assert.rejects(
    readScenarios(await file([fresh, { ...repeat, id: fresh.id }])),
    /user-fresh: the id is used twice/,
  );
});
test("the run index writes its header once and one tab-separated line per run", async () => {
  const path = join(
    await mkdtemp(join(tmpdir(), "jev-eval-")),
    "live-results",
    "runs.tsv",
  );
  await Promise.all([
    appendTsv(path, [
      ["variant", "a"],
      ["magic", 3],
    ]),
    appendTsv(path, [
      ["variant", "b\tc"],
      ["magic", 0],
    ]),
  ]);
  const lines = (await readFile(path, "utf8")).split("\n");
  assert.equal(lines[0], "variant\tmagic");
  assert.deepEqual(lines.slice(1).sort(), ["", "a\t3", "b c\t0"]);
});

const seedRecord = (id: string) => {
  const found = seedWorkspace().cases.find((c) => c.id === id);
  assert(found, id);
  return draftOf(found);
};
const sloppyUser: Draft = {
  id: "ctl-01",
  persona: "Disponentin am Handy",
  request: "1041 an marla, 60 min, dann nordweg filter u berichte",
  start: { selectedCase: "V-1041" },
  intent: {
    cases: { "V-1041": { technician: "mara", workedMinutes: "60" } },
    filters: { customerFilter: "nord" },
    pages: ["reports"],
  },
  tags: ["bare-id-number", "typo-name"],
  rationale: "Kurzform des Nutzerauftrags",
};
test("a draft becomes an authored scenario whose expected end follows from its start and intent", async () => {
  const s = scenarioFromDraft(sloppyUser);
  assert.equal(s.source, "authored");
  assert.equal(s.persona, "Disponentin am Handy");
  assert.equal(s.rationale, "Kurzform des Nutzerauftrags");
  assert.deepEqual(s.noise, ["bare-id-number", "typo-name"]);
  assert.deepEqual(s.intent.flags, {
    save: true,
    noSave: false,
    unsupported: false,
    sequence: false,
  });
  assert.equal(s.expected.page, "reports");
  assert.equal(s.expected.filters.customerId, "nord");
  assert.deepEqual(s.expected.saves, {
    "V-1041": [{ ...seedRecord("V-1041"), technicianId: "mara", minutes: 60 }],
  });
  assert.deepEqual((await readScenarios(await file([s]))).scenarios, [s]);
});
test("a draft fills partial start filters and derives the save and sequence flags unless it sets them", () => {
  const s = scenarioFromDraft({
    id: "ctl-02",
    persona: "Teamleiter",
    request:
      "bei 1042 ne stunde eintragen aber nicht speichern, dann kunden und team",
    start: { page: "team", filters: { status: "open" } },
    intent: {
      cases: { "V-1042": { workedMinutes: "60" } },
      pages: ["customers", "team"],
      flags: { noSave: true },
    },
    ambiguous: [{ dimension: "workedMinutes", caseId: "V-1042" }],
    rationale: "Einheit statt Zahl, nur Entwurf",
  });
  assert.deepEqual(s.start.filters, {
    customerId: null,
    technicianId: null,
    status: "open",
    search: "",
  });
  assert.equal(s.intent.flags.save, false);
  assert.equal(s.intent.flags.sequence, true);
  assert.deepEqual(s.expected.saves, {});
  assert.deepEqual(s.expected.draft, {
    caseId: "V-1042",
    values: { ...seedRecord("V-1042"), minutes: 60 },
  });
});
test("a draft with a misspelled dimension or a value the UI cannot reach is refused with the reason", () => {
  assert.throws(
    () =>
      scenarioFromDraft({
        ...sloppyUser,
        intent: { cases: { "V-1041": { workedMinute: "60" } } },
      }),
    /Unrecognized key: "workedMinute"/,
  );
  assert.throws(
    () =>
      scenarioFromDraft({
        ...sloppyUser,
        request: "1041 an marla, so lange wie letztes mal",
        intent: { cases: { "V-1041": { workedMinutes: "60" } } },
      }),
    /ctl-01: V-1041: worked minutes 60 are neither a literal in the request nor an answer to an ambiguous dimension/,
  );
});
