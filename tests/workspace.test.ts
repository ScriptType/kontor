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
