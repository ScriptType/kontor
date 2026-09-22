import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendTsv } from "../scripts/jev-eval/report.js";
import { readScenarios } from "../scripts/jev-eval/scenario-files.js";
import { allScenarios } from "../scripts/jev-eval/scenarios.js";

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
