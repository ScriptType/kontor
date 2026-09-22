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
  jevBlockedControl,
  stepSchema,
  type ActionDescription,
  type BlockedControl,
  type Assessment,
  type DecisionInput,
  type Decision,
  type FieldDescription,
} from "../../shared/command";
import { validFieldValue } from "../../shared/field-values";
import { blockers, receiptSchema } from "../../shared/domain";
import { WorkspaceUi } from "./workspace";
import { ActionRegistry } from "./action-registry";
import {
  catalogFingerprint,
  choiceDescription,
  type DecisionCapture,
} from "./decision-review";
import {
  acts,
  assesses,
  completes,
  gateKind,
  gateNames,
  workKind,
} from "./gate";
export type RunState =
  | {
      kind:
        "idle" | "deciding" | "executing" | "done" | "stopped" | "reconciling";
    }
  | {
      kind: "paused";
      reason: "modal" | "manual" | "reload" | "error";
      message: string;
    }
  | { kind: "completion_unconfirmed"; message: string }
  | {
      kind: "blocked";
      message: string;
      cause: { kind: "unknown" } | { kind: "control"; control: BlockedControl };
    }
  | { kind: "needs_input"; field: FieldDescription }
  | {
      kind: "review";
      capture: DecisionCapture;
      reason: "uncertain" | "forbidden" | "abstain" | "completion";
      message: string;
    }
  | {
      kind: "needs_approval";
      action: ActionDescription;
      capture: DecisionCapture;
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
const confidencePercentSchema = z.number().int().min(0).max(100);
const confidenceInputSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(confidencePercentSchema);
const confidencePreferenceSchema = z.object({
  version: z.literal(1),
  percent: confidencePercentSchema,
});
const confidencePreferenceKey = "kontor-jev-confidence-v1";
const gatePreferenceSchema = z.object({
  version: z.literal(1),
  gate: z.enum(gateNames),
});
const gatePreferenceKey = "kontor-jev-gate-v1";
@Injectable({ providedIn: "root" })
export class CommandRunner {
  readonly ui = inject(WorkspaceUi);
  readonly registry = inject(ActionRegistry);
  private readonly injector = inject(Injector);
  readonly state = signal<RunState>({ kind: "idle" });
  readonly attention = signal(0);
  readonly evidenceControl = computed(() => {
    const state = this.state(),
      selected = this.ui.selected(),
      draft = this.ui.draft(),
      data = this.ui.data();
    if (
      state.kind !== "blocked" ||
      state.cause.kind !== "control" ||
      state.cause.control.action.id !== "complete" ||
      !state.cause.control.reasons.some(
        (reason) => reason.kind === "evidence",
      ) ||
      this.ui.page() !== "cases" ||
      !selected ||
      !draft ||
      !data ||
      selected.id !== state.cause.control.target.id ||
      !blockers(data, { ...selected, ...draft, status: "done" }).some(
        (reason) => reason.kind === "evidence",
      )
    )
      return null;
    return state.cause.control;
  });
  readonly evidenceGuidance = computed(() => this.evidenceControl() !== null);
  readonly command = signal("");
  private readonly confidenceValue = signal(75);
  readonly confidencePercent = this.confidenceValue.asReadonly();
  private readonly confidenceValidation = signal("");
  readonly confidenceError = this.confidenceValidation.asReadonly();
  private readonly confidencePersistence = signal(true);
  readonly confidenceStored = this.confidencePersistence.asReadonly();
  private readonly gate = gatePreferenceSchema.catch({
    version: 1,
    gate: "threshold",
  }).parse(readBrowserState(gatePreferenceKey)).gate;
  readonly historyStored = signal(true);
  readonly history = signal<z.infer<typeof historySchema>[]>([]);
  readonly confirmedReceipts = computed(() => this.run()?.receipts ?? []);
  private activeId: string | null = null;
  private epoch = 0;
  private abort: AbortController | null = null;
  constructor() {
    const preference = confidencePreferenceSchema.safeParse(
      readBrowserState(confidencePreferenceKey),
    );
    if (preference.success) this.confidenceValue.set(preference.data.percent);
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
  setConfidencePercent(raw: string) {
    const parsed = confidenceInputSchema.safeParse(raw);
    if (!parsed.success) {
      this.confidenceValidation.set(
        "Bitte eine ganze Zahl von 0 bis 100 eingeben.",
      );
      return;
    }
    this.confidenceValidation.set("");
    if (parsed.data !== this.confidenceValue()) {
      this.pauseManual();
      this.confidenceValue.set(parsed.data);
    }
    this.confidencePersistence.set(
      writeBrowserState(confidencePreferenceKey, {
        version: 1,
        percent: parsed.data,
      }),
    );
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
      case "review":
      case "paused":
      case "blocked":
      case "completion_unconfirmed":
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
  describeChoice(choice: string, capture: DecisionCapture) {
    return choiceDescription(choice, capture.input);
  }
  async approve() {
    const state = this.state();
    if (state.kind !== "needs_approval") return;
    const capture = state.capture;
    if (!this.resolveCapture(capture)) return;
    this.state.set({ kind: "deciding" });
    try {
      await this.ui.refresh();
      await this.render();
      const input = this.resolveCapture(capture);
      if (input) await this.performReviewed(capture, input, state.action);
    } catch (error) {
      if (capture.epoch === this.epoch) this.fail(error);
    }
  }
  async selectRanked(choice: string) {
    const state = this.state();
    if (
      state.kind !== "review" ||
      state.capture.assessments[choice]?.verdict === "forbidden" ||
      !state.capture.decision.ranked.some((row) => row.choice === choice)
    )
      return;
    const capture = state.capture;
    if (!this.resolveCapture(capture)) return;
    this.state.set({ kind: "deciding" });
    try {
      await this.ui.refresh();
      await this.render();
      const input = this.resolveCapture(capture);
      if (!input) return;
      if (choice === "done") {
        const decision = await this.ui.api.decide.call(input, {
          signal: this.abort?.signal,
        });
        if (!this.resolveCapture(capture)) return;
        if (decision.snapshotId !== input.snapshotId)
          throw new Error("Veraltete Entscheidung.");
        const fresh = this.capture(input, decision);
        if (decision.choice === "done") await this.checkCompletion(fresh);
        else
          this.review(
            fresh,
            "Neue Entscheidung nach Abschlussprüfung. Bitte den nächsten Schritt prüfen.",
            decision.choice === "abstain" ? "abstain" : "uncertain",
          );
        return;
      }
      if (this.terminalOrQuestion(choice, capture, input)) return;
      const action = input.actions.find((action) => action.id === choice);
      if (!action) throw new Error("Schritt ist nicht mehr verfügbar.");
      let assessment = capture.assessments[action.id];
      if (!assessment) {
        assessment = await this.ui.api.assess.call(
          { ...input, selected: action },
          { signal: this.abort?.signal },
        );
        if (!this.resolveCapture(capture)) return;
        if (assessment.snapshotId !== input.snapshotId)
          throw new Error("Veraltete Schrittprüfung.");
      }
      if (assessment.verdict === "forbidden") {
        this.review(
          capture,
          `Schritt widerspricht dem Auftrag: ${action.effect}`,
          "forbidden",
          { choice: action.id, assessment },
        );
        return;
      }
      if (
        assessment.verdict !== "authorized" ||
        assessment.confidence < this.confidencePercent() / 100
      ) {
        this.state.set({
          kind: "needs_approval",
          action,
          capture,
          message: `Diesen konkreten Effekt gesondert bestätigen: ${action.effect}. Effektprüfung ${Math.round(assessment.confidence * 100)} %; ${assessment.verdict === "additional" ? "zusätzliche Änderung" : "Auftragsfreigabe nicht sicher bestätigt"}.`,
        });
        this.attention.update((n) => n + 1);
        return;
      }
      await this.performReviewed(capture, input, action);
    } catch (error) {
      if (capture.epoch === this.epoch) this.fail(error);
    }
  }
  private async performReviewed(
    capture: DecisionCapture,
    input: DecisionInput,
    action: ActionDescription,
  ) {
    if (await this.execute(input, action, "user", capture.epoch, capture.runId))
      await this.loop(capture.epoch);
  }
  private facts(blockedControls = this.registry.blockedSnapshot()) {
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
      filters: this.ui.filters(),
      menu: this.ui.menu(),
      visibleCases: this.ui.page() === "cases" ? this.ui.filtered() : [],
      selected: detailMounted ? selected : undefined,
      draft: detailMounted ? draft : undefined,
      dirty: detailMounted ? this.ui.dirty() : undefined,
      blockers: detailMounted
        ? {
            actionId: "save",
            target: { kind: "case", id: selected.id },
            reasons: this.ui.blocked(),
          }
        : undefined,
      blockedControls: blockedControls.map(jevBlockedControl),
      retainedSelection:
        selected && !detailMounted
          ? {
              caseId: selected.id,
              mounted: false,
              saved: selected,
              draft: this.ui.dirty() ? draft : undefined,
            }
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
  private observed(draftAssignment = false) {
    return JSON.stringify({
      page: this.ui.page(),
      revision: this.ui.data()?.revision,
      filters: this.ui.filters(),
      ...(draftAssignment ? {} : { menu: this.ui.menu() }),
      caseId: this.ui.selectedId(),
      selected: this.ui.selected(),
      draft: this.ui.draft(),
      dirty: this.ui.dirty(),
      draftOwner: this.ui.draftOwner(),
      operations: this.run()?.operations,
      receipts: this.run()?.receipts.map((receipt) => receipt.operationId),
      unknownSave: this.ui.unknownSave(),
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
    const blockedControls = this.registry.blockedSnapshot();
    return {
      request: run.request,
      snapshotId: crypto.randomUUID(),
      context: this.facts(blockedControls),
      blockedControls,
      actions: this.registry.snapshot(run.request, run.answers, existing),
      fields: this.registry.fieldSnapshot(),
      answers: run.answers,
      steps: run.steps,
    };
  }
  private capture(input: DecisionInput, decision: Decision): DecisionCapture {
    return {
      input,
      decision,
      fingerprint: catalogFingerprint(input),
      epoch: this.epoch,
      runId: this.activeId,
      assessments: {},
    };
  }
  private resolveCapture(capture: DecisionCapture) {
    if (
      capture.epoch !== this.epoch ||
      capture.runId !== this.activeId ||
      this.registry.modal
    )
      return null;
    const input = this.snapshot();
    if (catalogFingerprint(input) !== capture.fingerprint) {
      if (capture.decision.choice === "done")
        this.unconfirmed("Daten geändert. Abschluss erneut prüfen.");
      else
        this.block(
          "Daten oder verfügbare Schritte geändert. Bitte erneut prüfen.",
        );
      return null;
    }
    return input;
  }
  private review(
    capture: DecisionCapture,
    message: string,
    reason: Extract<RunState, { kind: "review" }>["reason"] = "uncertain",
    assessed?: { choice: string; assessment: Assessment },
  ) {
    const reviewed = assessed
      ? {
          ...capture,
          assessments: {
            ...capture.assessments,
            [assessed.choice]: assessed.assessment,
          },
        }
      : capture;
    this.state.set({ kind: "review", capture: reviewed, message, reason });
    this.finish(message);
    this.attention.update((n) => n + 1);
  }
  private terminalOrQuestion(
    choice: string,
    capture: DecisionCapture,
    input: DecisionInput,
  ) {
    if (choice === "abstain") {
      this.review(
        capture,
        "Jev kann keinen sinnvollen nächsten Schritt wählen. Auftrag überarbeiten oder Vorschlag prüfen.",
        "abstain",
      );
      return true;
    }
    if (choice === "blocked") {
      const cause =
        capture.decision.choice === "blocked"
          ? capture.decision.blockedCause
          : undefined;
      const control =
        cause && cause.confidence >= 0.75
          ? input.blockedControls.find(
              (control) => control.action.id === cause.controlId,
            )
          : undefined;
      this.block(
        "Auftrag teilweise oder nicht erledigt. Für verbleibende Arbeit fehlt ein ausführbarer Schritt.",
        control ? { kind: "control", control } : { kind: "unknown" },
      );
      return true;
    }
    if (choice.startsWith("ask:")) {
      const field = input.fields.find((field) => `ask:${field.id}` === choice);
      if (!field) throw new Error("Unbekannte Rückfrage.");
      this.state.set({ kind: "needs_input", field });
      this.attention.update((n) => n + 1);
      return true;
    }
    return false;
  }
  private acts({ input, decision }: DecisionCapture) {
    return acts(
      this.gate,
      this.confidencePercent(),
      decision,
      gateKind(decision.choice, input),
    );
  }
  private async checkCompletion(capture: DecisionCapture) {
    const { input } = capture;
    const assessment = await this.ui.api.assess.call(
      { ...input, selected: "done" },
      { signal: this.abort?.signal },
    );
    if (!this.resolveCapture(capture)) return;
    if (assessment.snapshotId !== input.snapshotId) {
      this.unconfirmed("Daten geändert. Abschluss erneut prüfen.");
      return;
    }
    if (
      !completes(
        this.gate,
        this.confidencePercent(),
        assessment,
        workKind(input.steps),
      ) ||
      !this.acts(capture) ||
      this.ui.busy() ||
      this.ui.unknownSave() ||
      this.run()?.operations.some(
        (id) =>
          !this.run()?.receipts.some((receipt) => receipt.operationId === id),
      )
    ) {
      this.review(
        capture,
        `Jev konnte die vollständige Erfüllung noch nicht bestätigen. Abschlussprüfung ${Math.round(assessment.confidence * 100)} %. Bereits ausgeführte Schritte stehen im Verlauf.`,
        "completion",
      );
      return;
    }
    this.state.set({ kind: "done" });
    this.finish(this.label());
  }
  private async loop(epoch: number) {
    for (let count = 0; count < 40 && epoch === this.epoch; count++) {
      this.state.set({ kind: "deciding" });
      await this.render();
      if (epoch !== this.epoch || this.registry.modal) return;
      const input = this.snapshot();
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
      const decision = await this.ui.api.decide.call(input, {
        signal: this.abort?.signal,
      });
      if (epoch !== this.epoch) return;
      const capture = this.capture(input, decision);
      if (!this.resolveCapture(capture)) return;
      if (decision.snapshotId !== input.snapshotId)
        throw new Error("Veraltete Entscheidung.");
      if (decision.choice === "done") {
        await this.checkCompletion(capture);
        return;
      }
      if (decision.choice === "abstain") {
        this.terminalOrQuestion(decision.choice, capture, input);
        return;
      }
      if (decision.choice === "blocked" || decision.choice.startsWith("ask:")) {
        if (!this.acts(capture))
          this.review(
            capture,
            decision.choice === "blocked"
              ? "Jev ist unsicher, ob verbleibende Arbeit blockiert ist. Vorschläge prüfen."
              : "Jev ist bei der Rückfrage unsicher. Vorschläge prüfen.",
          );
        else this.terminalOrQuestion(decision.choice, capture, input);
        return;
      }
      const action = input.actions.find(
        (action) => action.id === decision.choice,
      );
      if (!action)
        throw new Error("Entscheidung gehört nicht zum sichtbaren Zustand.");
      let reason = this.acts(capture)
        ? ""
        : "Auswahlkonfidenz unter der Bestätigungsschwelle. Vorschläge prüfen.";
      let assessed: { choice: string; assessment: Assessment } | undefined;
      if (assesses(this.gate, gateKind(action.id, input))) {
        const assessment = await this.ui.api.assess.call(
          { ...input, selected: action },
          { signal: this.abort?.signal },
        );
        if (!this.resolveCapture(capture)) return;
        if (assessment.snapshotId !== input.snapshotId)
          throw new Error("Veraltete Schrittprüfung.");
        assessed = { choice: action.id, assessment };
        if (assessment.verdict === "forbidden") {
          this.review(
            capture,
            `Schritt widerspricht dem Auftrag: ${action.effect}`,
            "forbidden",
            assessed,
          );
          return;
        }
        if (
          assessment.verdict !== "authorized" ||
          assessment.confidence < this.confidencePercent() / 100
        )
          reason = `Effektprüfung ${Math.round(assessment.confidence * 100)} %: ${assessment.verdict === "additional" ? "zusätzliche Änderung" : "Auftragsfreigabe nicht sicher bestätigt"}. Vorschläge prüfen.`;
      }
      if (reason) {
        this.review(capture, reason, "uncertain", assessed);
        return;
      }
      if (!(await this.execute(input, action, "request", epoch, capture.runId)))
        return;
    }
    if (epoch === this.epoch)
      this.block("Zu viele Schritte. Bitte aktuellen Stand prüfen.");
  }
  private async execute(
    input: DecisionInput,
    action: ActionDescription,
    authorizedBy: "request" | "user",
    epoch: number,
    runId: string | null,
  ) {
    if (epoch !== this.epoch || this.registry.modal || runId !== this.activeId)
      return false;
    const before = this.observed();
    const semanticBefore = this.observed(action.kind === "draft");
    if (
      input.steps.filter(
        (s) => s.before === before && s.action.id === action.id,
      ).length >= 2
    ) {
      this.block(
        "Wiederholter Schritt ohne Fortschritt. Bitte aktuellen Stand prüfen.",
      );
      return false;
    }
    this.state.set({ kind: "executing" });
    this.registry.execute(action);
    await this.ui.pending;
    await this.render();
    const after = this.observed();
    const outcome =
      semanticBefore === this.observed(action.kind === "draft")
        ? "unchanged"
        : "changed";
    this.history.update((history) =>
      history.map((run) =>
        run.id === runId
          ? {
              ...run,
              steps: [
                ...run.steps,
                {
                  snapshotId: input.snapshotId,
                  action,
                  authorizedBy,
                  before,
                  after,
                  outcome,
                },
              ],
              entries: [
                ...run.entries,
                `${action.effect}${outcome === "unchanged" ? " · ohne Änderung" : ""}`,
              ],
            }
          : run,
      ),
    );
    if (epoch !== this.epoch) return false;
    if (this.ui.unknownSave()) {
      this.state.set({ kind: "reconciling" });
      return false;
    }
    if (action.kind === "commit" && this.ui.dirty()) {
      this.block(this.ui.message() || "Speichern nicht bestätigt.");
      return false;
    }
    return true;
  }
  private render() {
    return new Promise<void>((resolve) =>
      afterNextRender(() => resolve(), { injector: this.injector }),
    );
  }
  private unconfirmed(message: string) {
    this.state.set({ kind: "completion_unconfirmed", message });
    this.finish(message);
    this.attention.update((n) => n + 1);
  }
  private block(
    message: string,
    cause: Extract<RunState, { kind: "blocked" }>["cause"] = {
      kind: "unknown",
    },
  ) {
    this.state.set({ kind: "blocked", message, cause });
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
