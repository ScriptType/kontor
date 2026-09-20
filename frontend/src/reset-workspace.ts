import { Component, inject, signal } from "@angular/core";
import { BrnDialogImports } from "@spartan-ng/brain/dialog";
import { CommandRunner } from "./command-runner";

type ResetState =
  | { kind: "closed" | "confirm" | "pending" }
  | { kind: "error"; message: string };

@Component({
  selector: "kontor-reset-workspace",
  imports: [BrnDialogImports],
  template: `
    <button class="text-button" (click)="open()">Demodaten zurücksetzen</button>
    <span role="status">{{ result() }}</span>
    <brn-dialog
      [state]="state().kind === 'closed' ? 'closed' : 'open'"
      (stateChanged)="$event === 'closed' && close()"
      [disableClose]="state().kind === 'pending'"
      [autoFocus]="'.reset-cancel'"
    >
      <ng-template brnDialogContent>
        <section class="palette reset-dialog" [attr.aria-busy]="state().kind === 'pending'">
          <header class="palette-head">
            <strong brnDialogTitle>Demodaten zurücksetzen?</strong>
          </header>
          <div class="reset-body">
            <p brnDialogDescription>
              Gespeicherte Änderungen und offene Entwürfe werden durch die Beispieldaten ersetzt.
              Jevs Auftrag und Verlauf werden gelöscht. Betriebsmodus und API-Schlüssel bleiben erhalten.
            </p>
            @if (state().kind === 'pending') {
              <p role="status">Demodaten werden zurückgesetzt …</p>
            }
            @if (error(); as message) {
              <p class="notice" role="alert">{{ message }}</p>
            }
            <div class="reset-actions">
              <button class="reset-cancel" [disabled]="state().kind === 'pending'" (click)="close()">
                {{ state().kind === 'error' ? 'Schließen' : 'Abbrechen' }}
              </button>
              @if (state().kind === 'confirm') {
                <button class="danger" (click)="confirm()">Jetzt zurücksetzen</button>
              }
            </div>
          </div>
        </section>
      </ng-template>
    </brn-dialog>
  `,
})
export class ResetWorkspace {
  readonly runner = inject(CommandRunner);
  readonly state = signal<ResetState>({ kind: "closed" });
  readonly result = signal("");
  error() {
    const state = this.state();
    return state.kind === "error" ? state.message : "";
  }
  open() {
    if (this.runner.registry.modal) return;
    this.result.set("");
    this.runner.modal(true);
    this.state.set({ kind: "confirm" });
  }
  close() {
    if (this.state().kind === "pending" || this.state().kind === "closed") return;
    this.state.set({ kind: "closed" });
    this.runner.modal(false);
  }
  async confirm() {
    if (this.state().kind !== "confirm") return;
    this.runner.stop();
    this.state.set({ kind: "pending" });
    try {
      const saveCleared = await this.runner.ui.reset();
      const historyCleared = this.runner.clearAfterReset();
      this.result.set(saveCleared && historyCleared
        ? "Demodaten zurückgesetzt."
        : "Demodaten zurückgesetzt. Lokale Browserdaten konnten nicht vollständig gelöscht werden.");
      this.state.set({ kind: "closed" });
      this.runner.modal(false);
    } catch {
      this.state.set({ kind: "error", message:
        "Zurücksetzen nicht bestätigt. Der aktuelle Datenstand wurde soweit erreichbar neu geladen. Jev bleibt gestoppt. Bitte Daten und Verbindung prüfen, bevor du erneut zurücksetzt." });
    }
  }
}
