import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availability,
  blockers,
  seedWorkspace,
  type ServiceCase,
  type Workspace,
} from "../shared/domain.js";

const at = { start: "2026-09-24T10:00:00", minutes: 60 };
const seed = seedWorkspace();
const saved = (id: string) => {
  const found = seed.cases.find((c) => c.id === id);
  assert(found);
  return found;
};
const drafted = { ...saved("V-1042"), appointment: at };
const withCase = (workspace: Workspace, changed: ServiceCase): Workspace => ({
  ...workspace,
  cases: workspace.cases.map((c) => (c.id === changed.id ? changed : c)),
});

test("availability follows the draft's appointment: jonas is busy with V-1041, lea is available, mara lacks Elektro", () => {
  assert.equal(saved("V-1042").appointment, null);
  assert.deepEqual(availability(seed, drafted, "jonas"), {
    kind: "busy",
    cases: ["V-1041"],
  });
  assert.deepEqual(availability(seed, drafted, "lea"), {
    kind: "available",
    at,
  });
  assert.deepEqual(availability(seed, drafted, "mara"), {
    kind: "unqualified",
    skill: "Elektro",
  });
});

test("without an appointment every qualified technician is available with no time checked", () => {
  const value = saved("V-1042");
  assert.deepEqual(availability(seed, value, "jonas"), {
    kind: "available",
    at: null,
  });
  assert.deepEqual(availability(seed, value, "lea"), {
    kind: "available",
    at: null,
  });
  assert.deepEqual(availability(seed, value, "mara"), {
    kind: "unqualified",
    skill: "Elektro",
  });
});

test("a done case and the case itself never make a technician busy", () => {
  const workspace = withCase(
    withCase(seed, {
      ...saved("V-1035"),
      technicianId: "lea",
      appointment: at,
    }),
    drafted,
  );
  assert.deepEqual(availability(workspace, drafted, "lea"), {
    kind: "available",
    at,
  });
  assert.deepEqual(availability(workspace, drafted, "jonas"), {
    kind: "busy",
    cases: ["V-1041"],
  });
});

const time = {
  kind: "time",
  message:
    "Vor dem Abschluss muss die tatsächlich geleistete Arbeitszeit erfasst sein.",
  alternatives: [],
};
const evidence = {
  kind: "evidence",
  message:
    "Die Prüfung vor Ort ist nicht belegt. Nur eine tatsächliche Beobachtung der Benutzerin oder des Benutzers kann dies bestätigen.",
  alternatives: [],
};
const qualification = {
  kind: "qualification",
  message: "Die zuständige Person benötigt die Qualifikation Elektro.",
  alternatives: ["lea", "jonas"],
};

test("save blockers of the seed cases are unchanged", () => {
  const expected: Record<string, [unknown[], unknown[]]> = {
    "V-1042": [[], [time]],
    "V-1041": [[], []],
    "V-1039": [[], [evidence]],
    "V-1037": [[], []],
    "V-1035": [[], []],
  };
  for (const c of seed.cases)
    assert.deepEqual(
      [blockers(seed, c), blockers(seed, { ...c, status: "done" })],
      expected[c.id],
      c.id,
    );
});

test("save blockers of conflicting drafts are unchanged", () => {
  assert.deepEqual(blockers(seed, drafted), [
    {
      kind: "conflict",
      message: "Jonas Weber ist durch V-1041 belegt.",
      alternatives: ["lea"],
    },
  ]);
  const maraBusy = withCase(seed, { ...saved("V-1037"), appointment: at });
  assert.deepEqual(blockers(maraBusy, { ...drafted, technicianId: "mara" }), [
    qualification,
    {
      kind: "conflict",
      message: "Mara Schulz ist durch V-1037 belegt.",
      alternatives: ["lea"],
    },
  ]);
  assert.deepEqual(blockers(seed, { ...drafted, technicianId: "ghost" }), [
    qualification,
  ]);
});
