import {
  Component,
  HostListener,
  inject,
  signal,
  effect,
  untracked,
  computed,
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
import { demos } from "../../shared/command";
@Component({
  selector: "kontor-palette",
  imports: [FormsModule, BrnDialogImports, DatePipe],
  templateUrl: "./palette.html",
})
export class Palette {
  readonly runner = inject(CommandRunner);
  readonly demos = demos;
  private readonly injector = inject(Injector);
  readonly attentionPanel =
    viewChild<ElementRef<HTMLElement>>("attentionPanel");
  private focusedAttention = 0;
  private pendingCloseAction: { state: RunState; action: () => void } | null =
    null;
  readonly focusTarget = computed(() => {
    const state = this.runner.state();
    return state.kind === "needs_input" ||
      state.kind === "needs_approval" ||
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
      const control =
        this.attentionPanel()?.nativeElement.querySelector<HTMLElement>(
          "input, button",
        );
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
  enter(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) this.submit(event);
  }
  continueRun() {
    this.closeThen(() => void this.runner.resume());
  }
  answer(id: string) {
    if (!this.runner.answer(id)) return;
    this.closeThen(() => void this.runner.resume());
  }
  approve() {
    this.runner.approve();
    this.closeThen(() => void this.runner.resume());
  }
}
