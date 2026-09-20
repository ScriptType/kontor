import { Component, HostListener, inject, signal } from "@angular/core";
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
    await this.runner.answer(id);
    this.setOpen(false);
    await this.runner.resume();
  }
  async schedule(start: string, minutes: number) {
    if (!this.runner.answerSchedule(start, minutes)) {
      this.scheduleError.set(
        "Bitte Datum, Uhrzeit und eine Dauer von 15 bis 480 Minuten angeben.",
      );
      return;
    }
    this.scheduleError.set("");
    this.setOpen(false);
    await this.runner.resume();
  }
  async approve(id: string) {
    await this.runner.approve(id);
    this.setOpen(false);
    await this.runner.resume();
  }
}
