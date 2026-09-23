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
import {
  localToday,
  partialAnswer,
  validFieldValue,
  type PartialAnswer,
} from "../../shared/field-values";
import { changingActions } from "../../shared/dimensions";
import { prefillFrom, readingKind } from "../../shared/value-reading";
import {
  dueQuestion,
  notedQuestionSchema,
  openQuestions,
  withheld,
} from "../../shared/open-questions";
import {
  listOrdinalSchema,
  requestOrdinals,
} from "../../shared/request-hints";
import { guardStop, type GuardStop } from "../../shared/run-guard";
import {
  blockers,
  draftOf,
  pageSchema,
  receiptSchema,
} from "../../shared/domain";
import { planSchema, type Plan } from "../../shared/plan";
import { stepVote, type PlanWorld, type RunPlan } from "../../shared/plan-vote";
import { WorkspaceUi } from "./workspace";
import { ActionRegistry } from "./action-registry";
import {
  catalogFingerprint,
  choiceDescription,
  type DecisionCapture,
} from "./decision-review";
import {
  assesses,
  completes,
  decisionHints,
  defaultGate,
  duelPair,
  gateKind,
  gatePreferenceKey,
  gateNames,
  gates,
  pick,
  workKind,
  type GatePolicy,
  type PlanVia,
} from "./gate";
export type RunState =
  | {
      kind: "idle" | "deciding" | "executing" | "stopped" | "reconciling";
    }
  | { kind: "done"; by: "jev" | "user" }
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
  | { kind: "needs_input"; field: FieldDescription; partial: PartialAnswer }
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
  /** Questions Jev chose to ask; each waits until its case is saved or left. */
  questions: z.array(notedQuestionSchema).default([]),
  /** The request's list ordinals, each bound to the case Jev opened at that row. */
  ordinals: z.array(listOrdinalSchema).default([]),
  steps: z.array(stepSchema),
  createdAt: z.string(),
  outcome: z.string(),
  /** The plan read at run start under a plan-voting gate, recorded for measurement. */
  plan: z.union([planSchema, z.object({ failed: z.string() })]).optional(),
  /** Each check the plan released, with the slot it agreed on. */
  votes: z
    .array(
      z.object({
        step: z.number(),
        choice: z.string(),
        via: z.enum(["pick", "completion", "effect"]),
        slot: z.string(),
      }),
    )
    .optional(),
  /** Each second look between two effects, with its winner and whether it acted. */
  duels: z
    .array(
      z.object({
        step: z.number(),
        options: z.tuple([z.string(), z.string()]),
        choice: z.string(),
        probability: z.number(),
        acts: z.boolean(),
      }),
    )
    .optional(),
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
  version: z.literal(2),
  gate: z.enum(gateNames),
});
const leanStates = {
  off: "full",
  decide: "leanDecide",
  all: "lean",
} as const satisfies Record<GatePolicy["memory"], DecisionInput["state"]>;
const guardMessages: Record<GuardStop, string> = {
  repeat:
    "Schritt zweimal ohne Wirkung ausgeführt. Bitte aktuellen Stand prüfen.",
  revisit:
    "Seite ohne Fortschritt erneut aufgerufen. Bitte aktuellen Stand prüfen.",
  budget:
    "Schrittbudget für diesen Auftrag erreicht. Ausgeführte Änderungen bleiben erhalten.",
};
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
  private readonly gate = gatePreferenceSchema
    .catch({
      version: 2,
      gate: defaultGate,
    })
    .parse(readBrowserState(gatePreferenceKey)).gate;
  /** Whether the personal percent also decides the step pick, not only asks and effect checks. */
  readonly percentPicks = gates[this.gate].bars === "percent";
  readonly historyStored = signal(true);
  readonly history = signal<z.infer<typeof historySchema>[]>([]);
  readonly confirmedReceipts = computed(() => this.run()?.receipts ?? []);
  private activeId: string | null = null;
  /** The plan of the active run; run is set once a todo gate awaited it. */
  private planned: {
    runId: string;
    ready: Promise<RunPlan | null>;
    run?: RunPlan | null;
  } | null = null;
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
        if (state.by === "user")
          return this.ui.dirty()
            ? "Entwurf vorbereitet · nicht gespeichert · vom Nutzer als erledigt abgeschlossen"
            : "Vom Nutzer als erledigt abgeschlossen";
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
          questions: [],
          ordinals: [],
          steps: [],
          createdAt: new Date().toISOString(),
          outcome: "In Arbeit",
        },
        ...h,
      ].slice(0, 20),
    );
    const policy: GatePolicy = gates[this.gate];
    this.planned =
      policy.planVote.length || policy.todo
        ? { runId: this.activeId, ready: this.readPlan(this.activeId) }
        : null;
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
      const due = this.due(choice, input);
      if (due) {
        this.raise(due);
        return;
      }
      if (choice === "done") {
        if (this.unsettled()) {
          this.unconfirmed(
            "Ein Speicherergebnis ist noch nicht bestätigt. Abschluss erst nach der Prüfung möglich.",
          );
          return;
        }
        this.update((r) => ({
          ...r,
          entries: [...r.entries, "Vom Nutzer als erledigt abgeschlossen"],
        }));
        this.state.set({ kind: "done", by: "user" });
        this.finish(this.label());
        return;
      }
      if (this.terminalOrQuestion(choice, capture, input)) return;
      const action = input.actions.find((action) => action.id === choice);
      if (!action) throw new Error("Schritt ist nicht mehr verfügbar.");
      const warned = capture.assessments[action.id];
      let assessment = warned;
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
        // The review showed the warning with this verdict, so the click is the user's decision.
        if (warned) await this.performReviewed(capture, input, action);
        else
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
  /** The visible text of the page as a screen reader gets it: innerText ignores aria-hidden, so those parts are hidden while it is read. */
  private screenText() {
    const content = document.querySelector(".content");
    if (!(content instanceof HTMLElement)) return "";
    const hidden = [
      ...content.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
    ].map((element) => ({ element, display: element.style.display }));
    for (const { element } of hidden) element.style.display = "none";
    try {
      return content.innerText.slice(0, 12000);
    } finally {
      for (const { element, display } of hidden)
        element.style.display = display;
    }
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
  private existing() {
    const data = this.ui.data();
    return [
      ...(data?.cases.flatMap((c) => [c.id, c.title]) ?? []),
      ...(data?.customers.map((c) => c.name) ?? []),
    ];
  }
  private snapshot(): DecisionInput {
    const run = this.run();
    if (!run) throw new Error("Kein Auftrag");
    const data = this.ui.data();
    const existing = this.existing();
    const blockedControls = this.registry.blockedSnapshot();
    const policy = gates[this.gate];
    const context = this.facts(blockedControls);
    const actions = this.registry.snapshot(run.request, run.answers, existing);
    const plan = this.awaitedPlan();
    const world = plan && this.planWorld();
    const hints =
      data &&
      decisionHints(
        this.gate,
        run.request,
        data,
        run.ordinals,
        plan && world ? { run: plan, world } : null,
      );
    const shown = withheld(
      {
        actions:
          policy.memory === "off"
            ? actions
            : changingActions({ actions, context }),
        fields: this.registry.fieldSnapshot(),
      },
      openQuestions(run.questions, run.answers),
    );
    return {
      request: run.request,
      snapshotId: crypto.randomUUID(),
      context,
      blockedControls,
      actions: shown.actions,
      fields: shown.fields,
      answers: run.answers,
      steps: run.steps,
      doneBeforeFirstStep: policy.doneBeforeFirstStep,
      state: leanStates[policy.memory],
      prompt: policy.prompt,
      ...(hints ? { hints } : {}),
    };
  }
  private capture(input: DecisionInput, decision: Decision): DecisionCapture {
    return {
      input,
      decision,
      pick: pick(this.gate, this.confidencePercent(), decision, input),
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
      if (capture.pick.choice === "done")
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
      this.raise(field);
      return true;
    }
    return false;
  }
  /** The noted question this choice has to wait for, or null. */
  private due(choice: string, input: DecisionInput) {
    return dueQuestion(
      openQuestions(this.run()?.questions ?? [], input.answers),
      choice,
      input,
    );
  }
  /** Asks the oldest open noted question instead of an unsure step: Jev did what it could. */
  private askNoted() {
    const run = this.run();
    const open = run && openQuestions(run.questions, run.answers)[0];
    if (open) this.raise(open);
    return Boolean(open);
  }
  /** Keeps Jev's question for later, so the rest of its case goes on first. */
  private note(choice: string, input: DecisionInput) {
    const field = input.fields.find((field) => `ask:${field.id}` === choice);
    if (!field) throw new Error("Unbekannte Rückfrage.");
    this.update((r) => ({
      ...r,
      questions: [...r.questions, { field, since: r.answers.length }],
      entries: [
        ...r.entries,
        `${field.label}: Rückfrage vorgemerkt · Jev fragt, bevor der Vorgang gespeichert oder verlassen wird`,
      ],
    }));
  }
  /** Asks the user, prefilled with the value Jev reads from the request on the run's start day. */
  private raise(field: FieldDescription) {
    const run = this.run();
    if (!run) throw new Error("Kein Auftrag");
    const epoch = this.epoch;
    void this.prefill(
      field,
      run.request,
      localToday(new Date(run.createdAt)),
    ).then((partial) => {
      if (epoch !== this.epoch) return;
      this.state.set({ kind: "needs_input", field, partial });
      this.attention.update((n) => n + 1);
    });
  }
  /**
   * The model's reading when the field has a reading kind, or nothing when it
   * cannot read it with confidence; the literal reading without a live model.
   */
  private async prefill(
    field: FieldDescription,
    request: string,
    today: string,
  ): Promise<PartialAnswer> {
    const literal = partialAnswer(field, request, today, this.existing());
    if (!readingKind(field)) return literal;
    try {
      const readings = await this.ui.api.readValues.call(
        { request, today, fields: [field] },
        { signal: this.abort?.signal },
      );
      const reading = readings?.[0];
      return reading ? prefillFrom(reading, today) : literal;
    } catch {
      return field.type === "datetime-local"
        ? { type: field.type, date: null, time: null }
        : { type: field.type, value: null };
    }
  }
  /** Reads the plan once for the run on the screen it starts from; a failure leaves the run without one. */
  private async readPlan(runId: string): Promise<RunPlan | null> {
    const workspace = this.ui.data();
    const request = this.run()?.request ?? "";
    const start = { page: this.ui.page(), filters: this.ui.filters() };
    let plan: Plan | null = null;
    let failure = "no plan";
    if (workspace)
      try {
        plan = await this.ui.api.plan.call({
          request,
          ...start,
          selectedCase: this.ui.selectedId(),
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    this.history.update((history) =>
      history.map((run) =>
        run.id === runId ? { ...run, plan: plan ?? { failed: failure } } : run,
      ),
    );
    return plan && workspace ? { plan, start: { ...start, workspace } } : null;
  }
  /** The active run's plan once a todo gate awaited it, else null. */
  private awaitedPlan() {
    const planned = this.planned;
    return planned?.runId === this.activeId ? (planned.run ?? null) : null;
  }
  /** Waits for the plan under a todo gate so Jev reads what remains from step 1. */
  private async awaitPlan() {
    const planned = this.planned;
    if (gates[this.gate].todo && planned?.runId === this.activeId)
      planned.run = await planned.ready;
  }
  private planWorld(): PlanWorld | null {
    const run = this.run(),
      data = this.ui.data();
    if (!run || !data) return null;
    return {
      page: this.ui.page(),
      filters: this.ui.filters(),
      selected: this.ui.selectedId(),
      draft: this.ui.draft(),
      dirty: this.ui.dirty(),
      records: Object.fromEntries(data.cases.map((c) => [c.id, draftOf(c)])),
      receipts: run.receipts.map((receipt) => ({
        caseId: receipt.caseId,
        saved: draftOf(receipt.saved),
      })),
      visited: run.steps.flatMap((step) => {
        const page = pageSchema.safeParse(JSON.parse(step.after).page);
        return page.success ? [page.data] : [];
      }),
      answers: run.answers,
    };
  }
  private votes(vias: readonly PlanVia[]) {
    const allowed: readonly PlanVia[] = gates[this.gate].planVote;
    return vias.every((via) => allowed.includes(via));
  }
  /**
   * Whether the run's plan agrees with this choice, recording each check it
   * releases; null once the capture went stale while the plan was read.
   */
  private async planAgrees(
    capture: DecisionCapture,
    choice: string,
    vias: readonly PlanVia[],
  ): Promise<boolean | null> {
    const planned = this.planned;
    if (!planned || planned.runId !== capture.runId) return false;
    const run = await planned.ready;
    if (!this.resolveCapture(capture)) return null;
    const world = this.planWorld();
    const slot = run && world && stepVote(run, choice, capture.input, world);
    if (!slot) return false;
    this.update((r) => ({
      ...r,
      votes: [
        ...(r.votes ?? []),
        ...vias.map((via) => ({ step: r.steps.length, choice, via, slot })),
      ],
    }));
    return true;
  }
  /**
   * A second look between the two strongest effects of a pick that does not
   * act: the capture to follow when its winner acts, false when there is no
   * duel or the winner stays below the bar, null once the capture went stale.
   */
  private async duel(
    capture: DecisionCapture,
  ): Promise<DecisionCapture | false | null> {
    const { input } = capture;
    const policy: GatePolicy = gates[this.gate];
    const options = duelPair(this.gate, capture.pick, capture.decision, input);
    if (policy.duel === undefined || !options) return false;
    const decision = await this.ui.api.decide.call(
      { ...input, duel: options },
      { signal: this.abort?.signal },
    );
    if (!this.resolveCapture(capture)) return null;
    if (decision.snapshotId !== input.snapshotId)
      throw new Error("Veraltete Entscheidung.");
    const [winner, other] = decision.ranked;
    if (!winner) throw new Error("Unvollständige Entscheidung.");
    const acts = winner.probability >= policy.duel;
    this.update((r) => ({
      ...r,
      duels: [
        ...(r.duels ?? []),
        {
          step: r.steps.length,
          options,
          choice: winner.choice,
          probability: winner.probability,
          acts,
        },
      ],
    }));
    if (!acts) return false;
    return {
      ...capture,
      decision,
      pick: {
        choice: winner.choice,
        kind: gateKind(winner.choice, input),
        acts: true,
        total: winner.probability,
        margin: winner.probability - (other?.probability ?? 0),
      },
    };
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
    const below: PlanVia[] = [
      ...(completes(
        this.gate,
        this.confidencePercent(),
        assessment,
        workKind(input.steps),
      )
        ? []
        : (["completion"] as const)),
      ...(capture.pick.acts ? [] : (["pick"] as const)),
    ];
    let confirmed = !below.length;
    if (!confirmed && this.votes(below)) {
      const agrees = await this.planAgrees(capture, "done", below);
      if (agrees === null) return;
      confirmed = agrees;
    }
    if (!confirmed || this.unsettled()) {
      this.review(
        capture,
        `Jev konnte die vollständige Erfüllung noch nicht bestätigen. Abschlussprüfung ${Math.round(assessment.confidence * 100)} %. Bereits ausgeführte Schritte stehen im Verlauf.`,
        "completion",
      );
      return;
    }
    this.state.set({ kind: "done", by: "jev" });
    this.finish(this.label());
  }
  /** Whether a save is still running, has an unknown result or lacks its receipt. */
  private unsettled() {
    const run = this.run();
    return (
      this.ui.busy() ||
      this.ui.unknownSave() ||
      Boolean(
        run?.operations.some(
          (id) => !run.receipts.some((receipt) => receipt.operationId === id),
        ),
      )
    );
  }
  private async loop(epoch: number) {
    for (let count = 0; count < 40 && epoch === this.epoch; count++) {
      this.state.set({ kind: "deciding" });
      await this.awaitPlan();
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
      let capture = this.capture(input, decision);
      if (!this.resolveCapture(capture)) return;
      if (decision.snapshotId !== input.snapshotId)
        throw new Error("Veraltete Entscheidung.");
      let chosen = capture.pick;
      const due = this.due(chosen.choice, input);
      if (due) {
        this.raise(due);
        return;
      }
      if (chosen.choice === "done") {
        await this.checkCompletion(capture);
        return;
      }
      if (chosen.choice === "abstain") {
        this.terminalOrQuestion(chosen.choice, capture, input);
        return;
      }
      let acts = chosen.acts;
      if (!acts && this.votes(["pick"])) {
        const agrees = await this.planAgrees(capture, chosen.choice, ["pick"]);
        if (agrees === null) return;
        acts = agrees;
      }
      if (!acts) {
        const won = await this.duel(capture);
        if (won === null) return;
        if (won) {
          capture = won;
          chosen = won.pick;
          acts = true;
          const due = this.due(chosen.choice, input);
          if (due) {
            this.raise(due);
            return;
          }
          if (chosen.choice === "done") {
            await this.checkCompletion(capture);
            return;
          }
        }
      }
      if (acts && chosen.choice.startsWith("ask:")) {
        this.note(chosen.choice, input);
        continue;
      }
      if (chosen.choice === "blocked" || chosen.choice.startsWith("ask:")) {
        if (!acts && this.askNoted()) return;
        if (!acts)
          this.review(
            capture,
            chosen.choice === "blocked"
              ? "Jev ist unsicher, ob verbleibende Arbeit blockiert ist. Vorschläge prüfen."
              : "Jev ist bei der Rückfrage unsicher. Vorschläge prüfen.",
          );
        else this.terminalOrQuestion(chosen.choice, capture, input);
        return;
      }
      const action = input.actions.find(
        (action) => action.id === chosen.choice,
      );
      if (!action)
        throw new Error("Entscheidung gehört nicht zum sichtbaren Zustand.");
      let reason = acts
        ? ""
        : this.percentPicks
          ? "Auswahlkonfidenz unter der Bestätigungsschwelle. Vorschläge prüfen."
          : "Auswahl unter der Schwelle für diese Art von Schritt. Vorschläge prüfen.";
      let assessed: { choice: string; assessment: Assessment } | undefined;
      if (assesses(this.gate, chosen.kind)) {
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
        let doubtful =
          assessment.verdict !== "authorized" ||
          assessment.confidence < this.confidencePercent() / 100;
        if (doubtful && !reason && this.votes(["effect"])) {
          const agrees = await this.planAgrees(capture, action.id, ["effect"]);
          if (agrees === null) return;
          doubtful = !agrees;
        }
        if (doubtful)
          reason = `Effektprüfung ${Math.round(assessment.confidence * 100)} %: ${assessment.verdict === "additional" ? "zusätzliche Änderung" : "Auftragsfreigabe nicht sicher bestätigt"}. Vorschläge prüfen.`;
      }
      if (reason) {
        if (this.askNoted()) return;
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
    const stop = gates[this.gate].guard
      ? guardStop(input, action, this.ui.page())
      : null;
    if (stop) {
      this.block(guardMessages[stop]);
      return false;
    }
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
    this.bindOrdinals(action, runId);
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
  /** Binds each request ordinal naming the row of the case this step opens, so a later shift of the list does not move it. */
  private bindOrdinals(action: ActionDescription, runId: string | null) {
    const run = this.history().find((r) => r.id === runId);
    if (!run || !action.id.startsWith("case:") || this.ui.page() !== "cases")
      return;
    const caseId = action.id.slice("case:".length);
    const rows = this.ui.filtered().map((c) => c.id);
    const openedAtRow = rows.indexOf(caseId) + 1;
    const bound = requestOrdinals(run.request).filter(
      ({ mention, row }) =>
        openedAtRow > 0 &&
        (row > 0 ? row : rows.length + 1 + row) === openedAtRow &&
        !run.ordinals.some((ordinal) => ordinal.mention === mention),
    );
    if (!bound.length) return;
    this.history.update((history) =>
      history.map((r) =>
        r.id === runId
          ? {
              ...r,
              ordinals: [
                ...r.ordinals,
                ...bound.map(({ mention }) => ({
                  mention,
                  caseId,
                  openedAtRow,
                })),
              ],
            }
          : r,
      ),
    );
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
