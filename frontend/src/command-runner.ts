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
import { goalSchema, type Goal } from "../../shared/command";
import {
  appointmentSchema,
  draftOf,
  type CaseDraft,
} from "../../shared/domain";
import { WorkspaceUi } from "./workspace";
import { ActionRegistry } from "./action-registry";
import { prepareGoal, type Proposal, type Question } from "./command-plan";

export type RunState =
  | {
      kind:
        | "idle"
        | "interpreting"
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
  | { kind: "needs_input"; question: Question }
  | { kind: "needs_approval"; proposal: Proposal };
const historySchema = z.object({
  id: z.string(),
  request: z.string(),
  entries: z.array(z.string()),
  operations: z.array(z.string()).default([]),
  savedOperations: z.array(z.string()).default([]),
  createdAt: z.string(),
  outcome: z.string(),
});
const persistedSchema = z.object({
  version: z.literal(1),
  command: z.string(),
  goal: goalSchema.nullable(),
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
  readonly targetCase = computed(() =>
    this.ui.data()?.cases.find((c) => c.id === this.goal()?.caseId),
  );
  private readonly evidenceCaseId = signal<string | null>(null);
  readonly evidenceGuidance = computed(() => {
    const caseId = this.evidenceCaseId();
    return caseId !== null && this.ui.selectedId() === caseId;
  });
  readonly goal = signal<Goal | null>(null);
  readonly command = signal("");
  readonly historyStored = signal(true);
  readonly history = signal<z.infer<typeof historySchema>[]>([]);
  readonly approved = signal<Proposal | null>(null);
  readonly desired = signal<CaseDraft | null>(null);
  private epoch = 0;
  private activeId: string | null = null;
  private abort: AbortController | null = null;
  constructor() {
    this.restore();
    this.ui.beforeManual = () => this.pauseManual();
    this.ui.onSave = (input) => {
      if (input.actor === "jev")
        this.history.update((h) =>
          h.map((r) =>
            r.id === this.activeId
              ? { ...r, operations: [...r.operations, input.operationId] }
              : r,
          ),
        );
    };
    this.ui.onReceipt = (receipt) =>
      this.history.update((h) =>
        h.map((r) =>
          r.operations.includes(receipt.operationId) &&
          !r.savedOperations.includes(receipt.operationId)
            ? {
                ...r,
                savedOperations: [...r.savedOperations, receipt.operationId],
                entries: [...r.entries, `${receipt.caseId} gespeichert`],
              }
            : r,
        ),
      );
    effect(() => {
      this.historyStored.set(
        writeBrowserState("kontor-command-v1", {
          version: 1,
          command: this.command(),
          goal: this.goal(),
          history: this.history(),
          unfinished: !["idle", "done", "stopped"].includes(this.state().kind),
        }),
      );
    });
  }
  private requestAttention(
    state: Extract<RunState, { kind: "needs_input" | "needs_approval" }>,
  ) {
    this.evidenceCaseId.set(
      state.kind === "needs_input" && state.question.kind === "evidence"
        ? (this.goal()?.caseId ?? null)
        : null,
    );
    this.state.set(state);
    this.attention.update((value) => value + 1);
  }
  label() {
    const s = this.state();
    switch (s.kind) {
      case "idle":
        return "Bereit für deinen Auftrag";
      case "interpreting":
        return "Auftrag wird geprüft";
      case "deciding":
        return "Jev wählt den nächsten sichtbaren Schritt";
      case "executing":
        return "Schritt wird ausgeführt";
      case "needs_input":
        return "Antwort ausstehend";
      case "needs_approval":
        return "Freigabe ausstehend";
      case "paused":
        return s.message;
      case "reconciling":
        return "Speicherergebnis wird geprüft";
      case "done":
        return this.goal()?.persistence === "draft"
          ? "Entwurf vorbereitet · nicht gespeichert"
          : "Auftrag abgeschlossen";
      case "stopped":
        return "Gestoppt · bereits gespeicherte Änderungen bleiben erhalten";
    }
  }
  running() {
    return ["interpreting", "deciding", "executing"].includes(
      this.state().kind,
    );
  }
  private invalidate() {
    this.epoch++;
    this.abort?.abort();
    this.abort = null;
  }
  modal(open: boolean) {
    this.registry.modal = open;
    if (open && this.running()) {
      this.invalidate();
      this.state.set({
        kind: "paused",
        reason: "modal",
        message: "Pausiert, solange ein Dialog offen ist",
      });
    }
    if (!open && this.state().kind === "paused") {
      const s = this.state();
      if (s.kind === "paused" && s.reason === "modal") void this.resume();
    }
  }
  pauseManual() {
    if (!["idle", "done", "stopped"].includes(this.state().kind)) {
      this.invalidate();
      this.approved.set(null);
      this.state.set({
        kind: "paused",
        reason: "manual",
        message: "Pausiert nach manuellem Eingriff · ausdrücklich fortsetzen",
      });
    }
  }
  stop() {
    this.evidenceCaseId.set(null);
    this.invalidate();
    this.approved.set(null);
    this.state.set({ kind: "stopped" });
    this.finish("Gestoppt");
  }
  clearAfterReset() {
    this.invalidate();
    this.evidenceCaseId.set(null);
    this.activeId = null;
    this.goal.set(null);
    this.desired.set(null);
    this.approved.set(null);
    this.command.set("");
    this.history.set([]);
    this.state.set({ kind: "idle" });
    const stored = writeBrowserState("kontor-command-v1", null);
    this.historyStored.set(stored);
    return stored;
  }
  async start(reuse = false) {
    this.evidenceCaseId.set(null);
    this.invalidate();
    if (this.ui.dirty() || this.ui.unknownSave()) {
      this.requestAttention({
        kind: "needs_input",
        question: {
          kind: "draft",
          message: `Es gibt einen offenen Entwurf oder ein unbekanntes Speicherergebnis für ${this.ui.selectedId() ?? "den aktuellen Vorgang"}. Bitte zuerst speichern, verwerfen oder Ergebnis prüfen. Danach den Auftrag erneut starten.`,
          options: [],
        },
      });
      return;
    }
    const epoch = this.epoch;
    this.goal.set(null);
    this.approved.set(null);
    this.desired.set(null);
    if (!reuse) {
      if (
        this.activeId &&
        !["idle", "done", "stopped"].includes(this.state().kind)
      )
        this.finish("Durch neuen Auftrag beendet");
      this.activeId = crypto.randomUUID();
      this.history.update((h) =>
        [
          {
            id: this.activeId ?? "",
            request: this.command(),
            entries: [],
            operations: [],
            savedOperations: [],
            createdAt: new Date().toISOString(),
            outcome: "In Arbeit",
          },
          ...h,
        ].slice(0, 20),
      );
    }
    const request =
      this.history().find((h) => h.id === this.activeId)?.request ??
      this.command();
    this.state.set({ kind: "interpreting" });
    this.abort = new AbortController();
    try {
      await this.ui.refresh();
      if (epoch !== this.epoch) return;
      const goal = await this.ui.api.interpret.call(
        { text: request },
        { signal: this.abort.signal },
      );
      if (epoch !== this.epoch) return;
      this.goal.set(goal);
      await this.loop(epoch);
    } catch (error) {
      if (epoch === this.epoch) this.fail(error);
    }
  }
  async resume() {
    if (this.registry.modal) return;
    const waitingEpoch = this.epoch;
    if (this.ui.busy()) await this.ui.pending;
    if (
      waitingEpoch !== this.epoch ||
      this.registry.modal ||
      this.state().kind === "stopped"
    )
      return;
    if (this.ui.unknownSave()) {
      this.state.set({ kind: "reconciling" });
      await this.ui.reconcile();
      if (
        waitingEpoch !== this.epoch ||
        this.registry.modal ||
        this.ui.unknownSave()
      ) return;
    }
    if (!this.goal()) {
      await this.start(true);
      return;
    }
    if (this.ui.dirty() && this.ui.draftOwner() !== "jev") {
      this.requestAttention({
        kind: "needs_input",
        question: {
          kind: "draft",
          message:
            "Der offene Entwurf muss vor dem Fortsetzen gespeichert oder verworfen werden. Jev übernimmt keine fremden Änderungen.",
          options: [],
        },
      });
      return;
    }
    this.invalidate();
    const epoch = this.epoch;
    try {
      await this.ui.refresh();
      if (
        epoch === this.epoch &&
        this.ui.draftOwner() === "jev" &&
        this.ui.data()?.revision !== this.ui.draftRevision()
      ) {
        const selected = this.ui.selected();
        if (selected) {
          this.ui.draft.set(draftOf(selected));
          this.ui.draftRevision.set(this.ui.data()?.revision ?? 0);
          this.approved.set(null);
        }
      }
      if (epoch === this.epoch) await this.loop(epoch);
    } catch (error) {
      if (epoch === this.epoch) this.fail(error);
    }
  }
  async answer(id: string) {
    const state = this.state(),
      goal = this.goal();
    if (state.kind !== "needs_input" || !goal) return;
    const kind = state.question.kind;
    if (
      state.question.options.length &&
      !state.question.options.some((o) => o.id === id)
    )
      return;
    const next = structuredClone(goal);
    switch (kind) {
      case "case":
        next.caseId = id;
        break;
      case "technician":
        next.objectives = next.objectives.map((o) =>
          o.kind === "assign" ? { ...o, technicianId: id } : o,
        );
        break;
      case "customer":
        next.objectives = next.objectives.map((o) =>
          o.kind === "filter" ? { ...o, customerId: id } : o,
        );
        break;
      case "minutes": {
        const minutes = Number(id);
        if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 10000)
          return;
        if (next.objectives.some((o) => o.kind === "time"))
          next.objectives = next.objectives.map((o) =>
            o.kind === "time" ? { ...o, minutes } : o,
          );
        else next.objectives.push({ kind: "time", minutes });
        break;
      }
      case "order":
        next.order = "flexible";
        break;
      case "filter_scope":
        if (id !== "remove-filter") return;
        next.objectives = next.objectives.filter((o) => o.kind !== "filter");
        break;
      case "persistence":
        if (id === "save" || id === "draft") next.persistence = id;
        break;
      default:
        return;
    }
    this.goal.set(next);
    this.log(
      `Antwort erhalten: ${state.question.options.find((o) => o.id === id)?.label ?? id}`,
    );
    this.state.set({
      kind: "paused",
      reason: "manual",
      message: "Antwort übernommen · Palette schließen und fortsetzen",
    });
  }
  answerSchedule(start: string, minutes: number) {
    const state = this.state(),
      goal = this.goal();
    if (
      state.kind !== "needs_input" ||
      state.question.kind !== "schedule" ||
      !goal
    )
      return false;
    const parsed = appointmentSchema.safeParse({
      start: start.length === 16 ? start + ":00" : start,
      minutes,
    });
    if (!parsed.success) return false;
    const objectives = goal.objectives.some((o) => o.kind === "schedule")
      ? goal.objectives.map((o) =>
          o.kind === "schedule" ? { ...o, appointment: parsed.data } : o,
        )
      : [
          ...goal.objectives,
          { kind: "schedule" as const, appointment: parsed.data },
        ];
    this.goal.set({ ...goal, objectives });
    this.approved.set(null);
    this.log(`Termin bestätigt: ${parsed.data.start} · ${minutes} Minuten`);
    this.state.set({
      kind: "paused",
      reason: "manual",
      message: "Termin übernommen · ausdrücklich fortsetzen",
    });
    return true;
  }
  async approve(technicianId: string) {
    const state = this.state();
    if (state.kind !== "needs_approval") return;
    const proposal = state.proposal;
    if (!proposal.alternatives.some((a) => a.id === technicianId)) return;
    await this.ui.refresh();
    if (this.state() !== state) return;
    if (this.ui.data()?.revision !== proposal.revision) {
      this.approved.set(null);
      this.state.set({
        kind: "paused",
        reason: "manual",
        message: "Daten geändert · Vorschlag erneut prüfen",
      });
      return;
    }
    this.approved.set({
      ...proposal,
      after: { ...proposal.after, technicianId },
    });
    this.log(
      `Zusätzliche Zuweisung an ${this.ui.technicianName(technicianId)} für ${proposal.caseId} ausdrücklich freigegeben`,
    );
    this.state.set({
      kind: "paused",
      reason: "manual",
      message: "Freigabe erhalten · Palette schließen und fortsetzen",
    });
  }
  private async loop(epoch: number) {
    const initialGoal = this.goal(),
      workspace = this.ui.data();
    const selected = workspace?.cases.find((c) => c.id === initialGoal?.caseId);
    const filter = initialGoal?.objectives.find((o) => o.kind === "filter");
    if (
      selected &&
      filter?.customerId &&
      initialGoal?.objectives.some((o) => o.kind !== "filter")
    ) {
      const conflicts: string[] = [];
      if (selected.customerId !== filter.customerId) {
        const customer = workspace?.customers.find(
          (c) => c.id === selected.customerId,
        )?.name;
        const requested = workspace?.customers.find(
          (c) => c.id === filter.customerId,
        )?.name;
        conflicts.push(
          `${selected.id} gehört zu ${customer ?? selected.customerId}, der angeforderte Filter zeigt ${requested ?? filter.customerId}`,
        );
      }
      if (filter.openOnly && selected.status === "done")
        conflicts.push(
          `${selected.id} ist bereits erledigt, der angeforderte Filter zeigt nur offene Vorgänge`,
        );
      if (conflicts.length) {
        this.requestAttention({
          kind: "needs_input",
          question: {
            kind: "filter_scope",
            message: `${conflicts.join(". ")}. Soll ich den angeforderten Filter entfernen und die Änderung an ${selected.id} ausführen? Für einen anderen Vorgang bitte einen neuen Auftrag formulieren.`,
            options: [
              {
                id: "remove-filter",
                label: "Angeforderten Filter entfernen, Vorgang beibehalten",
              },
            ],
          },
        });
        return;
      }
    }
    this.abort = new AbortController();
    for (let steps = 0; steps < 35 && epoch === this.epoch; steps++) {
      const goal = this.goal(),
        workspace = this.ui.data();
      if (!goal || !workspace) return;
      if (this.registry.modal) {
        this.state.set({
          kind: "paused",
          reason: "modal",
          message: "Palette schließen zum Fortsetzen",
        });
        return;
      }
      this.state.set({ kind: "deciding" });
      await this.render();
      if (epoch !== this.epoch) return;
      const preparation = prepareGoal(goal, workspace, this.approved());
      const contextAction =
        goal.supported &&
        goal.objectives.length > 0 &&
        !goal.objectives.some((o) => o.kind === "filter" && !o.customerId) &&
        workspace.cases.some((c) => c.id === goal.caseId)
          ? this.nextContextAction(
              goal,
              goal.objectives.some((o) => o.kind !== "filter"),
            )
          : null;
      if (!contextAction && preparation.kind === "question") {
        this.requestAttention({
          kind: "needs_input",
          question: preparation.question,
        });
        return;
      }
      if (!contextAction && preparation.kind === "proposal") {
        const proposal = preparation.proposal;
        const selected = await this.ui.api.remedy.call(
          {
            caseId: proposal.caseId,
            revision: proposal.revision,
            request: goal.request,
            draft: proposal.requested,
          },
          { signal: this.abort.signal },
        );
        if (epoch !== this.epoch) return;
        if (
          !selected.technicianId ||
          !proposal.alternatives.some((a) => a.id === selected.technicianId)
        ) {
          this.fail(
            new Error(
              "Kein sicherer Vorschlag. Bitte den Termin manuell prüfen.",
            ),
          );
          return;
        }
        this.requestAttention({
          kind: "needs_approval",
          proposal: {
            ...proposal,
            after: { ...proposal.after, technicianId: selected.technicianId },
          },
        });
        return;
      }
      const desired = preparation.kind === "ready" ? preparation.desired : null;
      this.desired.set(desired);
      this.state.set({ kind: "deciding" });
      await this.render();
      if (epoch !== this.epoch) return;
      const target = contextAction ?? this.nextAction(goal, desired);
      if (!target) {
        this.evidenceCaseId.set(null);
        this.state.set({ kind: "done" });
        this.finish(this.label());
        return;
      }
      const actions = this.registry.snapshot();
      const snapshotId = `${epoch}:${steps}:${workspace.revision}`;
      const decision = await this.ui.api.decide.call(
        {
          request: goal.request,
          snapshotId,
          actions,
          expectedDemoAction: target,
          context: JSON.stringify({
            goal,
            approved: this.approved(),
            desired,
            currentPage: this.ui.page(),
            filters: {
              customer: this.ui.customer(),
              openOnly: this.ui.openOnly(),
            },
            currentDraft: this.ui.draft(),
            saved: workspace,
            blockers: this.ui.blocked(),
            completed: this.history().find((h) => h.id === this.activeId)
              ?.entries,
            nextRequiredAction: target,
          }),
        },
        { signal: this.abort.signal },
      );
      if (epoch !== this.epoch || decision.snapshotId !== snapshotId) return;
      if (!decision.actionId || decision.actionId !== target) {
        this.state.set({
          kind: "paused",
          reason: "error",
          message: "Keine sichere zielkonforme Entscheidung · bitte prüfen",
        });
        return;
      }
      const action = actions.find((a) => a.id === decision.actionId);
      if (!action)
        throw new Error("Entscheidung gehört nicht zu diesem Zustand.");
      this.state.set({ kind: "executing" });
      this.registry.execute(action.id);
      await this.ui.pending;
      if (epoch !== this.epoch) return;
      if (action.id !== "save") this.log(action.label);
      if (this.ui.unknownSave()) {
        this.state.set({ kind: "reconciling" });
        return;
      }
      if (action.id === "save" && this.ui.dirty()) {
        this.fail(new Error(this.ui.message()));
        return;
      }
    }
    if (epoch === this.epoch)
      this.fail(
        new Error("Zu viele Schritte. Bitte den aktuellen Stand prüfen."),
      );
  }
  private nextContextAction(goal: Goal, needsCase: boolean): string | null {
    const filter = goal.objectives.find((o) => o.kind === "filter");
    if (this.ui.page() !== "cases") {
      const available = this.registry.snapshot();
      const directCase = `case:${goal.caseId}`;
      if (goal.caseId && available.some((action) => action.id === directCase))
        return directCase;
      const directCustomer =
        filter?.kind === "filter"
          ? `customer-cases:${filter.customerId}`
          : null;
      if (
        directCustomer &&
        available.some((action) => action.id === directCustomer)
      )
        return directCustomer;
      return "nav:cases";
    }
    if (filter?.kind === "filter") {
      if (this.ui.customer() !== filter.customerId)
        return this.ui.menu() === "customer"
          ? `customer:${filter.customerId}`
          : "menu:customer";
      if (this.ui.openOnly() !== filter.openOnly) return "filter:open";
    }
    if (!needsCase || !goal.caseId) return null;
    if (this.ui.selectedId() !== goal.caseId) {
      if (!this.ui.filtered().some((c) => c.id === goal.caseId))
        return "filter:reset";
      return `case:${goal.caseId}`;
    }
    return null;
  }
  private nextAction(goal: Goal, desired: CaseDraft | null): string | null {
    const context = this.nextContextAction(goal, !!desired);
    if (context) return context;
    if (!desired || !goal.caseId) return null;
    const draft = this.ui.draft();
    if (!draft) return `case:${goal.caseId}`;
    if (draft.technicianId !== desired.technicianId)
      return this.ui.menu() === "technician"
        ? `technician:${desired.technicianId}`
        : "menu:technician";
    const completeIndex = goal.objectives.findIndex(
      (objective) => objective.kind === "complete",
    );
    const completeBeforeTime =
      goal.order === "listed" &&
      completeIndex >= 0 &&
      completeIndex <
        goal.objectives.findIndex((objective) => objective.kind === "time");
    if (completeBeforeTime && this.ui.selected()?.status !== "done") {
      if (draft.status !== "done") return "complete";
      if (goal.persistence === "save") return "save";
    }
    if (draft.minutes !== desired.minutes) return "time:requested";
    if (
      JSON.stringify(draft.appointment) !== JSON.stringify(desired.appointment)
    )
      return "appointment:requested";
    if (draft.status !== desired.status) return "complete";
    if (this.ui.dirty() && goal.persistence === "save") return "save";
    return null;
  }
  private render() {
    return new Promise<void>((resolve) =>
      afterNextRender(() => resolve(), { injector: this.injector }),
    );
  }
  private fail(error: unknown) {
    this.state.set({
      kind: "paused",
      reason: "error",
      message:
        error instanceof Error ? error.message : "Anfrage fehlgeschlagen",
    });
    this.finish("Pausiert nach Fehler");
  }
  private log(entry: string) {
    this.history.update((h) =>
      h.map((r) =>
        r.id === this.activeId ? { ...r, entries: [...r.entries, entry] } : r,
      ),
    );
  }
  private finish(outcome: string) {
    this.history.update((h) =>
      h.map((r) => (r.id === this.activeId ? { ...r, outcome } : r)),
    );
  }
  private restore() {
    const parsed = persistedSchema.safeParse(
      readBrowserState("kontor-command-v1"),
    );
    if (!parsed.success) return;
    const stored = parsed.data;
    this.command.set(stored.command);
    this.history.set(stored.history);
    this.goal.set(stored.goal);
    this.activeId = stored.history[0]?.id ?? null;
    if (stored.unfinished)
      this.state.set({
        kind: "paused",
        reason: "reload",
        message: "Nach Neuladen pausiert · Daten vor Fortsetzen erneut prüfen",
      });
  }
}
