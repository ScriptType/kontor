import {
  Injectable,
  afterNextRender,
  inject,
  Injector,
  signal,
  computed,
  effect,
} from "@angular/core";
import { z } from "zod";
import { readBrowserState, writeBrowserState } from "./browser-state";
import {
  answerSchema,
  stepSchema,
  type ActionDescription,
  type DecisionInput,
  type FieldDescription,
} from "../../shared/command";
import { validFieldValue } from "../../shared/field-values";
import { blockers, receiptSchema } from "../../shared/domain";
import { WorkspaceUi } from "./workspace";
import { ActionRegistry } from "./action-registry";
export type RunState =
  | {
      kind:
        | "idle"
        | "deciding"
        | "executing"
        | "done"
        | "stopped"
        | "reconciling";
    }
  | {
      kind: "paused";
      reason: "modal" | "manual" | "reload" | "error";
      message: string;
    }
  | { kind: "blocked"; message: string }
  | { kind: "needs_input"; field: FieldDescription }
  | {
      kind: "needs_approval";
      action: ActionDescription;
      fingerprint: string;
      message: string;
    };
const historySchema = z.object({
  id: z.string(),
  request: z.string(),
  entries: z.array(z.string()),
  operations: z.array(z.string()),
  savedOperations: z.array(z.string()),
  receipts: z.array(receiptSchema),
  answers: z.array(answerSchema),
  steps: z.array(stepSchema),
  createdAt: z.string(),
  outcome: z.string(),
});
const persistedSchema = z.object({
  version: z.literal(3),
  command: z.string(),
  history: z.array(historySchema),
  unfinished: z.boolean(),
});
@Injectable({ providedIn: "root" })
export class CommandRunner {
  readonly ui = inject(WorkspaceUi);
  readonly registry = inject(ActionRegistry);
  private readonly injector = inject(Injector);
  readonly state = signal<RunState>({ kind: "idle" });
  readonly attention = signal(0);
  readonly targetCase = this.ui.selected;
  readonly disabledCompletionReasons = computed(() => {
    const data = this.ui.data(),
      selected = this.ui.selected(),
      draft = this.ui.draft();
    return this.ui.page() === "cases" && data && selected && draft
      ? blockers(data, { ...selected, ...draft, status: "done" })
      : [];
  });
  readonly evidenceGuidance = computed(
    () =>
      this.state().kind === "blocked" &&
      this.disabledCompletionReasons().some(
        (reason) => reason.kind === "evidence",
      ),
  );
  readonly command = signal("");
  readonly historyStored = signal(true);
  readonly history = signal<z.infer<typeof historySchema>[]>([]);
  readonly confirmedReceipts = computed(() => this.run()?.receipts ?? []);
  private activeId: string | null = null;
  private epoch = 0;
  private abort: AbortController | null = null;
  private approved: { action: ActionDescription; fingerprint: string } | null =
    null;
  constructor() {
    this.restore();
    this.ui.currentRunId = () => this.activeId;
    this.ui.beforeManual = () => this.pauseManual();
    this.ui.onSave = (input) => {
      if (input.actor === "jev")
        this.update((r) => ({
          ...r,
          operations: [...r.operations, input.operationId],
        }));
    };
    this.ui.onReceipt = (receipt, runId, actor) => {
      const owner = this.history().find(
        (r) => r.id === runId || r.operations.includes(receipt.operationId),
      );
      if (!owner) return actor === "manual";
      this.history.update((history) =>
        history.map((r) =>
          r.id === owner.id && !r.savedOperations.includes(receipt.operationId)
            ? {
                ...r,
                operations: r.operations.includes(receipt.operationId)
                  ? r.operations
                  : [...r.operations, receipt.operationId],
                receipts: [...r.receipts, receipt],
                savedOperations: [...r.savedOperations, receipt.operationId],
                entries: [
                  ...r.entries,
                  `${receipt.caseId} gespeichert · Revision ${receipt.revision}`,
                ],
              }
            : r,
        ),
      );
      return this.persist();
    };
    effect(() => this.persist());
  }
  private persist() {
    const stored = writeBrowserState("kontor-command-v1", {
      version: 3,
      command: this.command(),
      history: this.history(),
      unfinished: !["idle", "done", "stopped"].includes(this.state().kind),
    });
    this.historyStored.set(stored);
    return stored;
  }
  private run() {
    return this.history().find((r) => r.id === this.activeId);
  }
  private update(
    change: (
      run: z.infer<typeof historySchema>,
    ) => z.infer<typeof historySchema>,
  ) {
    this.history.update((h) =>
      h.map((r) => (r.id === this.activeId ? change(r) : r)),
    );
  }
  label() {
    const state = this.state();
    switch (state.kind) {
      case "idle":
        return "Bereit für deinen Auftrag";
      case "deciding":
        return "Jev wählt den nächsten sichtbaren Schritt";
      case "executing":
        return "Schritt wird ausgeführt";
      case "needs_input":
        return "Antwort ausstehend";
      case "needs_approval":
        return "Konkreten Schritt bestätigen";
      case "paused":
      case "blocked":
        return state.message;
      case "reconciling":
        return "Speicherergebnis wird geprüft";
      case "done":
        return this.ui.dirty()
          ? "Entwurf vorbereitet · nicht gespeichert · Jev meldet Auftrag erledigt"
          : "Jev meldet den Auftrag als erledigt";
      case "stopped":
        return "Gestoppt · bereits gespeicherte Änderungen bleiben erhalten";
    }
  }
  running() {
    return (
      this.state().kind === "deciding" || this.state().kind === "executing"
    );
  }
  private invalidate() {
    this.ui.cancelFocus();
    this.epoch++;
    this.abort?.abort();
    this.abort = null;
  }
  modal(open: boolean) {
    if (open) this.ui.cancelFocus();
    this.registry.modal = open;
    if (open && this.running()) {
      this.invalidate();
      this.state.set({
        kind: "paused",
        reason: "modal",
        message: "Palette schließen zum Fortsetzen",
      });
    } else if (!open) {
      const state = this.state();
      if (state.kind === "paused" && state.reason === "modal")
        void this.resume();
    }
  }
  pauseManual() {
    this.approved = null;
    if (!["idle", "done", "stopped"].includes(this.state().kind)) {
      this.invalidate();
      this.state.set({
        kind: "paused",
        reason: "manual",
        message: "Pausiert nach manuellem Eingriff · ausdrücklich fortsetzen",
      });
    }
  }
  stop() {
    this.invalidate();
    this.approved = null;
    this.state.set({ kind: "stopped" });
    this.finish(this.label());
  }
  clearAfterReset() {
    this.stop();
    this.activeId = null;
    this.command.set("");
    this.history.set([]);
    this.state.set({ kind: "idle" });
    return writeBrowserState("kontor-command-v1", null);
  }
  async start() {
    this.invalidate();
    this.approved = null;
    if (!this.command().trim()) return;
    if (this.ui.dirty() || this.ui.unknownSave()) {
      this.block(
        "Offenen Entwurf oder unbekanntes Speicherergebnis zuerst prüfen. Danach den Auftrag erneut starten.",
      );
      return;
    }
    this.activeId = crypto.randomUUID();
    this.history.update((h) =>
      [
        {
          id: this.activeId ?? "",
          request: this.command(),
          entries: [],
          operations: [],
          savedOperations: [],
          receipts: [],
          answers: [],
          steps: [],
          createdAt: new Date().toISOString(),
          outcome: "In Arbeit",
        },
        ...h,
      ].slice(0, 20),
    );
    await this.resume();
  }
  async resume() {
    if (this.registry.modal || !this.run()) return;
    this.invalidate();
    const epoch = this.epoch;
    this.abort = new AbortController();
    this.state.set({ kind: "deciding" });
    try {
      await this.ui.pending;
      if (epoch !== this.epoch) return;
      if (this.ui.unknownSave()) {
        this.state.set({ kind: "reconciling" });
        await this.ui.reconcile();
        if (epoch !== this.epoch) return;
        if (this.ui.unknownSave()) return;
      }
      await this.ui.refresh();
      if (epoch !== this.epoch) return;
      if (this.ui.dirty() && this.ui.draftOwner() === "manual") {
        this.block(
          "Manuellen Entwurf zuerst speichern oder verwerfen. Jev übernimmt ihn nicht automatisch.",
        );
        return;
      }
      await this.loop(epoch);
    } catch (error) {
      if (epoch === this.epoch) this.fail(error);
    }
  }
  answer(value: string) {
    const state = this.state();
    if (state.kind !== "needs_input" || !validFieldValue(state.field, value))
      return false;
    this.update((r) => ({
      ...r,
      answers: [
        ...r.answers,
        { fieldId: state.field.id, scope: state.field.scope, value },
      ],
      entries: [
        ...r.entries,
        `${state.field.label}: ${value} ausdrücklich angegeben`,
      ],
    }));
    this.state.set({
      kind: "paused",
      reason: "manual",
      message: "Antwort übernommen",
    });
    return true;
  }
  approve() {
    const state = this.state();
    if (state.kind !== "needs_approval") return;
    this.approved = { action: state.action, fingerprint: state.fingerprint };
    this.state.set({
      kind: "paused",
      reason: "manual",
      message: "Schritt bestätigt",
    });
  }
  private facts() {
    const screen = this.registry.observeScreen();
    const selected = this.ui.selected(),
      draft = this.ui.draft(),
      data = this.ui.data();
    const detailMounted = selected && screen.currentDetail?.id === selected.id;
    return JSON.stringify({
      currentPage: this.ui.page(),
      currentScreen: this.screenText(),
      screen,
      revision: data?.revision,
      filters: {
        customer: this.ui.customer(),
        openOnly: this.ui.openOnly(),
        search: this.ui.search(),
      },
      menu: this.ui.menu(),
      visibleCases: this.ui.page() === "cases" ? this.ui.filtered() : [],
      selected: detailMounted ? selected : undefined,
      draft: detailMounted ? draft : undefined,
      dirty: detailMounted ? this.ui.dirty() : undefined,
      blockers: detailMounted ? this.ui.blocked() : undefined,
      completionBlockers:
        detailMounted && data && selected && draft
          ? blockers(data, { ...selected, ...draft, status: "done" })
          : undefined,
      retainedDraft:
        !detailMounted && this.ui.dirty()
          ? { caseId: this.ui.selectedId(), draft, mounted: false }
          : undefined,
      receipts: this.run()?.receipts,
      message: detailMounted ? this.ui.message() : undefined,
    });
  }
  private screenText() {
    const content = document.querySelector(".content");
    return content instanceof HTMLElement
      ? content.innerText.slice(0, 12000)
      : "";
  }
  private observed() {
    return JSON.stringify({
      page: this.ui.page(),
      revision: this.ui.data()?.revision,
      customer: this.ui.customer(),
      openOnly: this.ui.openOnly(),
      search: this.ui.search(),
      menu: this.ui.menu(),
      caseId: this.ui.selectedId(),
      draft: this.ui.draft(),
      message: this.ui.message(),
    });
  }
  private snapshot(): DecisionInput {
    const run = this.run();
    if (!run) throw new Error("Kein Auftrag");
    const data = this.ui.data();
    const existing = [
      ...(data?.cases.flatMap((c) => [c.id, c.title]) ?? []),
      ...(data?.customers.map((c) => c.name) ?? []),
    ];
    return {
      request: run.request,
      snapshotId: crypto.randomUUID(),
      context: this.facts(),
      actions: this.registry.snapshot(run.request, run.answers, existing),
      fields: this.registry.fieldSnapshot(),
      answers: run.answers,
      steps: run.steps,
    };
  }
  private async loop(epoch: number) {
    for (let count = 0; count < 40 && epoch === this.epoch; count++) {
      this.state.set({ kind: "deciding" });
      await this.render();
      if (epoch !== this.epoch || this.registry.modal) return;
      const input = this.snapshot(),
        fingerprint = input.context,
        before = this.observed(),
        runId = this.activeId;
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 180000) {
        this.block(
          "Verlaufslimit erreicht. Bereits ausgeführte Schritte bleiben im Verlauf. Bitte verbleibende Arbeit als neuen Auftrag formulieren.",
        );
        return;
      }
      if (input.steps.length >= 40) {
        this.block(
          "Schrittgrenze erreicht. Ausgeführte Änderungen bleiben erhalten.",
        );
        return;
      }
      let action: ActionDescription | undefined;
      let authorizedBy: "request" | "user" = "request";
      if (this.approved && this.approved.fingerprint === fingerprint) {
        const approved = this.approved;
        authorizedBy = "user";
        action = input.actions.find(
          (a) => JSON.stringify(a) === JSON.stringify(approved.action),
        );
        this.approved = null;
        if (!action) {
          this.block(
            "Bestätigter Schritt ist nicht mehr verfügbar. Bitte erneut prüfen.",
          );
          return;
        }
      } else {
        this.approved = null;
        const decision = await this.ui.api.decide.call(input, {
          signal: this.abort?.signal,
        });
        if (epoch !== this.epoch) return;
        if (
          decision.snapshotId !== input.snapshotId ||
          fingerprint !== this.facts()
        ) {
          this.block(
            "Daten haben sich während der Entscheidung geändert. Bitte fortsetzen.",
          );
          return;
        }
        if (decision.choice === "blocked") {
          this.block(
            "Auftrag teilweise oder nicht erledigt. Für verbleibende Arbeit fehlt ein ausführbarer Schritt.",
          );
          return;
        }
        if (decision.choice === "done") {
          const assessment = await this.ui.api.assess.call(
            { ...input, selected: "done" },
            { signal: this.abort?.signal },
          );
          if (epoch !== this.epoch) return;
          if (
            assessment.snapshotId !== input.snapshotId ||
            fingerprint !== this.facts()
          ) {
            this.block("Daten geändert. Abschluss erneut prüfen.");
            return;
          }
          if (
            assessment.verdict !== "complete" ||
            assessment.confidence < 0.75 ||
            decision.confidence < 0.75 ||
            this.ui.busy() ||
            this.ui.unknownSave() ||
            this.run()?.operations.some(
              (id) =>
                !this.run()?.receipts.some(
                  (receipt) => receipt.operationId === id,
                ),
            )
          ) {
            this.block(
              "Auftrag nicht vollständig bestätigt. Bereits ausgeführte Schritte stehen im Verlauf.",
            );
            return;
          }
          this.state.set({ kind: "done" });
          this.finish(this.label());
          return;
        }
        if (decision.choice.startsWith("ask:")) {
          const field = input.fields.find(
            (f) => `ask:${f.id}` === decision.choice,
          );
          if (!field) throw new Error("Unbekannte Rückfrage.");
          this.state.set({ kind: "needs_input", field });
          this.attention.update((n) => n + 1);
          return;
        }
        action = input.actions.find((a) => a.id === decision.choice);
        if (!action)
          throw new Error("Entscheidung gehört nicht zum sichtbaren Zustand.");
        let needsApproval = decision.confidence < 0.75;
        if (action.kind !== "view") {
          const assessment = await this.ui.api.assess.call(
            { ...input, selected: action },
            { signal: this.abort?.signal },
          );
          if (epoch !== this.epoch) return;
          if (
            assessment.snapshotId !== input.snapshotId ||
            fingerprint !== this.facts()
          ) {
            this.block("Daten geändert. Schritt erneut prüfen.");
            return;
          }
          if (assessment.verdict === "forbidden") {
            this.block(`Schritt widerspricht dem Auftrag: ${action.effect}`);
            return;
          }
          needsApproval ||=
            assessment.verdict !== "authorized" || assessment.confidence < 0.75;
        }
        if (needsApproval) {
          this.state.set({
            kind: "needs_approval",
            action,
            fingerprint,
            message: `Diesen konkreten Schritt bestätigen: ${action.effect}`,
          });
          this.attention.update((n) => n + 1);
          return;
        }
      }
      if (!action) throw new Error("Kein ausführbarer Schritt.");
      if (
        input.steps.filter(
          (s) => s.before === before && s.action.id === action.id,
        ).length >= 2
      ) {
        this.block(
          "Wiederholter Schritt ohne Fortschritt. Bitte aktuellen Stand prüfen.",
        );
        return;
      }
      this.state.set({ kind: "executing" });
      this.registry.execute(action);
      await this.ui.pending;
      await this.render();
      const after = this.observed();
      this.history.update((history) =>
        history.map((r) =>
          r.id === runId
            ? {
                ...r,
                steps: [
                  ...r.steps,
                  {
                    snapshotId: input.snapshotId,
                    action,
                    authorizedBy,
                    before,
                    after,
                  },
                ],
                entries: [...r.entries, action.effect],
              }
            : r,
        ),
      );
      if (epoch !== this.epoch) return;
      if (this.ui.unknownSave()) {
        this.state.set({ kind: "reconciling" });
        return;
      }
      if (action.kind === "commit" && this.ui.dirty()) {
        this.block(this.ui.message() || "Speichern nicht bestätigt.");
        return;
      }
    }
    if (epoch === this.epoch)
      this.block("Zu viele Schritte. Bitte aktuellen Stand prüfen.");
  }
  private render() {
    return new Promise<void>((resolve) =>
      afterNextRender(() => resolve(), { injector: this.injector }),
    );
  }
  private block(message: string) {
    this.state.set({ kind: "blocked", message });
    this.finish(message);
    this.attention.update((n) => n + 1);
  }
  private fail(error: unknown) {
    this.state.set({
      kind: "paused",
      reason: "error",
      message:
        error instanceof Error ? error.message : "Anfrage fehlgeschlagen",
    });
    this.finish(this.label());
  }
  private finish(outcome: string) {
    this.update((r) => ({ ...r, outcome }));
  }
  private restore() {
    const parsed = persistedSchema.safeParse(
      readBrowserState("kontor-command-v1"),
    );
    if (!parsed.success) {
      const legacy = z
        .object({
          version: z.union([z.literal(1), z.literal(2)]),
          command: z.string(),
          history: z.array(
            historySchema
              .omit({ receipts: true, answers: true, steps: true })
              .extend({
                operations: z.array(z.string()).default([]),
                savedOperations: z.array(z.string()).default([]),
              }),
          ),
        })
        .safeParse(readBrowserState("kontor-command-v1"));
      if (legacy.success) {
        this.command.set(legacy.data.command);
        this.history.set(
          legacy.data.history.map((run) => ({
            ...run,
            receipts: [],
            answers: [],
            steps: [],
          })),
        );
      }
      return;
    }
    this.command.set(parsed.data.command);
    this.history.set(parsed.data.history);
    this.activeId = parsed.data.history[0]?.id ?? null;
    if (parsed.data.unfinished)
      this.state.set({
        kind: "paused",
        reason: "reload",
        message: "Nach Neuladen pausiert · ausdrücklich fortsetzen",
      });
  }
}
