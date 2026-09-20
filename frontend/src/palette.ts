import {
  Component,
  HostListener,
  inject,
  signal,
  effect,
  untracked,
  computed,
  afterRenderEffect,
  viewChild,
  ElementRef,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { BrnDialogImports } from "@spartan-ng/brain/dialog";
import { CommandRunner } from "./command-runner";
import { demos } from "../../shared/command";
@Component({
  selector: "kontor-palette",
  imports: [FormsModule, BrnDialogImports, DatePipe],
  templateUrl: "./palette.html",
})
export class Palette {
  readonly runner = inject(CommandRunner);
  readonly demos = demos;
  readonly attentionPanel =
    viewChild<ElementRef<HTMLElement>>("attentionPanel");
  private focusedAttention = 0;
  readonly focusTarget = computed(() => {
    const state = this.runner.state();
    return state.kind === "needs_input" || state.kind === "needs_approval"
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
  editDraft() {
    this.setOpen(false);
    this.runner.ui.navigate("cases", "manual");
  }
  editEvidence() {
    const target = this.runner.targetCase();
    if (!target || this.runner.ui.selectedId() !== target.id) return;
    this.setOpen(false);
    this.runner.ui.evidenceFocus.set(target.id);
  }
  readonly open = signal(false);
  readonly minutes = signal("");
  readonly scheduleError = signal("");
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
    this.runner.modal(open);
  }
  submit(event: Event) {
    if (!this.runner.ui.source.data()) return;
    event.preventDefault();
    this.open.set(false);
    this.runner.registry.modal = false;
    void this.runner.start();
  }
  enter(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) this.submit(event);
  }
  continueRun() {
    const s = this.runner.state();
    this.setOpen(false);
    if (s.kind !== "paused" || s.reason !== "modal") void this.runner.resume();
  }
  async answer(id: string) {
    if (!this.runner.answer(id)) return;
    this.setOpen(false);
    await this.runner.resume();
  }
  async approve() {
    this.runner.approve();
    this.setOpen(false);
    await this.runner.resume();
  }
}
