import { DatabaseSync } from "node:sqlite";
import { ORPCError } from "@orpc/server";
import {
  blockers,
  saveSchema,
  receiptSchema,
  seedWorkspace,
  workspaceSchema,
  type Save,
  type Workspace,
  type Receipt,
} from "../shared/domain.js";

export class WorkspaceStore {
  private readonly db: DatabaseSync;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, payload TEXT NOT NULL, data TEXT NOT NULL);",
    );
    this.db
      .prepare("INSERT OR IGNORE INTO workspace VALUES (1, ?)")
      .run(JSON.stringify(seedWorkspace()));
  }
  snapshot(): Workspace {
    const row = this.db.prepare("SELECT data FROM workspace WHERE id=1").get();
    if (!row || typeof row["data"] !== "string")
      throw new Error("Workspace missing");
    return workspaceSchema.parse(JSON.parse(row["data"]));
  }
  receipt(id: string): Receipt | null {
    const row = this.db.prepare("SELECT data FROM receipts WHERE id=?").get(id);
    return row && typeof row["data"] === "string"
      ? receiptSchema.parse(JSON.parse(row["data"]))
      : null;
  }
  save(input: Save): Receipt {
    const payload = JSON.stringify(saveSchema.parse(input));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.db
        .prepare("SELECT payload, data FROM receipts WHERE id=?")
        .get(input.operationId);
      if (previous) {
        if (previous["payload"] !== payload)
          throw new ORPCError("CONFLICT", {
            message: "Die Operations-ID gehört zu einer anderen Änderung.",
          });
        const receipt = this.receipt(input.operationId);
        if (!receipt) throw new Error("Receipt missing");
        this.db.exec("COMMIT");
        return receipt;
      }
      const workspace = this.snapshot();
      if (workspace.revision !== input.revision)
        throw new ORPCError("CONFLICT", {
          message:
            "Daten wurden zwischenzeitlich geändert. Bitte erneut prüfen.",
        });
      const index = workspace.cases.findIndex((c) => c.id === input.caseId);
      const original = workspace.cases[index];
      if (!original) throw new ORPCError("NOT_FOUND");
      if (
        input.actor === "jev" &&
        JSON.stringify(input.draft.inspection) !==
          JSON.stringify(original.inspection)
      )
        throw new ORPCError("FORBIDDEN", {
          message: "Jev darf keine Prüfbelege erzeugen oder ändern.",
        });
      const saved = { ...original, ...input.draft };
      const blocked = blockers(workspace, saved);
      if (blocked.length)
        throw new ORPCError("PRECONDITION_FAILED", {
          message: blocked.map((b) => b.message).join(" "),
        });
      workspace.cases[index] = saved;
      workspace.revision += 1;
      const receipt: Receipt = {
        operationId: input.operationId,
        caseId: saved.id,
        saved,
        revision: workspace.revision,
      };
      this.db
        .prepare("UPDATE workspace SET data=? WHERE id=1")
        .run(JSON.stringify(workspace));
      this.db
        .prepare("INSERT INTO receipts VALUES (?, ?, ?)")
        .run(input.operationId, payload, JSON.stringify(receipt));
      this.db.exec("COMMIT");
      return receipt;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
