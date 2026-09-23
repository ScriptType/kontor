import {
  Component,
  HostListener,
  inject,
  signal,
  effect,
  untracked,
  computed,
  linkedSignal,
  afterRenderEffect,
  afterNextRender,
  Injector,
  viewChild,
  ElementRef,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { BrnDialogImports } from "@spartan-ng/brain/dialog";
import { CommandRunner, type RunState } from "./command-runner";
import { demos, type FieldDescription } from "../../shared/command";
import { composeAnswer, partialNotes } from "../../shared/field-values";
@Component({
  selector: "kontor-palette",
  imports: [FormsModule, BrnDialogImports, DatePipe],
  templateUrl: "./palette.html",
})
export class Palette {
  readonly runner = inject(CommandRunner);
  readonly confidenceInput = signal(String(this.runner.confidencePercent()));
  readonly demos = demos;
  readonly partialNotes = partialNotes;
  /** Why the last confirm was refused; cleared by the next run state. */
  readonly answerError = linkedSignal({
    source: this.runner.state,
    computation: () => "",
  });
  private readonly injector = inject(Injector);
  readonly attentionPanel =
    viewChild<ElementRef<HTMLElement>>("attentionPanel");
  private focusedAttention = 0;
  private pendingCloseAction: { state: RunState; action: () => void } | null =
    null;
  readonly focusTarget = computed(() => {
    const state = this.runner.state();
    if (state.kind === "needs_input")
      return ".answer-panel [data-answer-focus]";
    return state.kind === "needs_approval" ||
      state.kind === "review" ||
      state.kind === "blocked" ||
      state.kind === "completion_unconfirmed"
      ? ".answer-panel input, .answer-panel button"
      : "textarea";
  });
  constructor() {
    effect(() => {
      const attention = this.runner.attention();
      if (attention) untracked(() => this.setOpen(true));
    });
    afterRenderEffect(() => {
      const attention = this.runner.attention();
      const panel = this.attentionPanel()?.nativeElement;
      const control =
        panel?.querySelector<HTMLElement>("[data-answer-focus]") ??
        panel?.querySelector<HTMLElement>("input, button");
      if (this.open() && attention > this.focusedAttention && control) {
        this.focusedAttention = attention;
        control.focus();
      }
    });
  }
  editEvidence() {
    const control = this.runner.evidenceControl();
    if (!control) return;
    this.closeThen(() => {
      if (
        this.runner.evidenceControl() !== control ||
        !this.runner.registry
          .blockedSnapshot()
          .some(
            (current) => JSON.stringify(current) === JSON.stringify(control),
          )
      )
        return;
      this.runner.ui.navigate("cases", "manual");
      this.runner.ui.evidenceFocus.set(control.target.id);
    });
  }
  readonly open = signal(false);
  readonly shortcut = /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘ K"
    : "Ctrl K";
  @HostListener("document:keydown", ["$event"]) shortcutPressed(
    event: KeyboardEvent,
  ) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.setOpen(!this.open());
    }
  }
  setOpen(open: boolean) {
    if (open && this.runner.registry.modal && !this.open()) return;
    if (!open && !this.open()) return;
    this.open.set(open);
    if (open) {
      this.pendingCloseAction = null;
      this.runner.modal(true);
    }
  }
  private closeThen(action: () => void) {
    this.pendingCloseAction = { state: this.runner.state(), action };
    this.setOpen(false);
  }
  closed() {
    const pending = this.pendingCloseAction;
    this.pendingCloseAction = null;
    this.runner.registry.modal = false;
    if (pending) {
      afterNextRender(
        () => {
          if (
            !this.open() &&
            !this.runner.registry.modal &&
            pending.state === this.runner.state()
          )
            pending.action();
        },
        { injector: this.injector },
      );
    } else this.runner.modal(false);
  }
  submit(event: Event) {
    if (!this.runner.ui.source.data()) return;
    event.preventDefault();
    this.closeThen(() => void this.runner.start());
  }
  setConfidencePercent(raw: string) {
    this.confidenceInput.set(raw);
    this.runner.setConfidencePercent(raw);
  }
  enter(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) this.submit(event);
  }
  continueRun() {
    this.closeThen(() => void this.runner.resume());
  }
  answer(
    field: FieldDescription,
    parts: { date?: string; time?: string; value?: string },
  ) {
    const value = composeAnswer(field, parts);
    if (value === null || !this.runner.answer(value)) {
      this.answerError.set(
        field.type === "datetime-local"
          ? "Bitte Datum und Uhrzeit angeben."
          : "Bitte einen gültigen Wert angeben.",
      );
      return;
    }
    this.closeThen(() => void this.runner.resume());
  }
  approve() {
    this.closeThen(() => void this.runner.approve());
  }
  selectRanked(choice: string) {
    this.closeThen(() => void this.runner.selectRanked(choice));
  }
  revise() {
    this.runner.pauseManual();
    document
      .querySelector<HTMLTextAreaElement>('textarea[name="command"]')
      ?.focus();
  }
  editCommand(value: string) {
    this.runner.pauseManual();
    this.runner.command.set(value);
  }
}
