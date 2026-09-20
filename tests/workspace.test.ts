import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkspaceStore } from "../server/workspace-store.js";
import { draftOf } from "../shared/domain.js";

test("atomic save persists across restart, deduplicates before stale checks, and refuses payload reuse", () => {
  const dir = mkdtempSync(join(tmpdir(), "kontor-"));
  const path = join(dir, "test.sqlite");
  let store = new WorkspaceStore(path);
  try {
    const first = store.snapshot().cases[0];
    assert(first);
    const input = {
      operationId: randomUUID(),
      revision: 0,
      caseId: first.id,
      actor: "jev" as const,
      draft: { ...draftOf(first), technicianId: "lea" },
    };
    const receipt = store.save(input);
    store.close();
    store = new WorkspaceStore(path);
    assert.deepEqual(store.save(input), receipt);
    assert.equal(store.snapshot().revision, 1);
    assert.equal(store.snapshot().cases[0]?.technicianId, "lea");
    assert.throws(() =>
      store.save({ ...input, draft: { ...input.draft, minutes: 99 } }),
    );
    assert.throws(() => store.save({ ...input, operationId: randomUUID() }));
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("completion requires time and actual user evidence; conflict never moves unrelated case", () => {
  const store = new WorkspaceStore();
  try {
    const snapshot = store.snapshot();
    const first = snapshot.cases[0],
      physical = snapshot.cases[2];
    assert(first && physical);
    const save = (
      id: string,
      draft: ReturnType<typeof draftOf>,
      actor: "manual" | "jev" = "jev",
    ) =>
      store.save({
        operationId: randomUUID(),
        revision: store.snapshot().revision,
        caseId: id,
        draft,
        actor,
      });
    assert.throws(() => save(first.id, { ...draftOf(first), status: "done" }));
    assert.throws(() =>
      save(physical.id, { ...draftOf(physical), status: "done" }),
    );
    assert.throws(() =>
      save(physical.id, {
        ...draftOf(physical),
        status: "done",
        inspection: { note: "Erfunden", by: "user" },
      }),
    );
    assert.throws(() =>
      save(first.id, {
        ...draftOf(first),
        appointment: { start: "2026-09-24T09:00:00", minutes: 60 },
      }),
    );
    assert.deepEqual(store.snapshot(), snapshot);
    save(first.id, {
      ...draftOf(first),
      technicianId: "lea",
      appointment: { start: "2026-09-24T09:00:00", minutes: 60 },
    });
    assert.deepEqual(store.snapshot().cases[1], snapshot.cases[1]);
    save(
      physical.id,
      {
        ...draftOf(physical),
        status: "done",
        inspection: {
          note: "Vor Ort geprüft, Schutzleiter gemessen.",
          by: "user",
        },
      },
      "manual",
    );
    assert.equal(store.snapshot().cases[2]?.status, "done");
  } finally {
    store.close();
  }
});

test("reset persists seed data with increasing revisions and keeps historical save receipts", () => {
  const dir = mkdtempSync(join(tmpdir(), "kontor-reset-"));
  const path = join(dir, "test.sqlite");
  let store = new WorkspaceStore(path);
  try {
    const seed = store.snapshot();
    const first = seed.cases[0];
    assert(first);
    const input = {
      operationId: randomUUID(), revision: seed.revision, caseId: first.id,
      actor: "manual" as const, draft: { ...draftOf(first), minutes: 123 },
    };
    const receipt = store.save(input);
    assert.throws(() => store.reset(seed.revision));
    assert.equal(store.snapshot().revision, receipt.revision);
    const reset = store.reset(receipt.revision);
    assert.deepEqual(reset, { ...seed, revision: receipt.revision + 1 });
    assert.deepEqual(store.save(input), receipt);
    assert.deepEqual(store.receipt(input.operationId), receipt);
    assert.deepEqual(store.snapshot(), reset);
    assert.throws(() => store.save({ ...input, operationId: randomUUID() }));
    assert.throws(() => store.save({ ...input, operationId: randomUUID(), revision: receipt.revision }));
    store.close();
    store = new WorkspaceStore(path);
    assert.deepEqual(store.snapshot(), reset);
    assert.deepEqual(store.reset(reset.revision), { ...seed, revision: reset.revision + 1 });
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
