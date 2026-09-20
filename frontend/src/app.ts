import { Component, inject, signal } from "@angular/core";
import { DecimalPipe, KeyValuePipe, PercentPipe } from "@angular/common";
import { ORPCError } from "@orpc/client";
import type { Evaluation, Source } from "../../shared/contract";
import { scoreCriteria } from "../../shared/questions";
import { API } from "./api";

type RequestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: Evaluation }
  | { kind: "error"; message: string };
@Component({
  selector: "app-root",
  imports: [DecimalPipe, KeyValuePipe, PercentPipe],
  templateUrl: "./app.html",
})
export class App {
  private readonly api = inject(API);
  readonly state = signal<RequestState>({ kind: "idle" });
  readonly source = signal<Source | null>(null);
  readonly text = signal(
    "Bitte prüfe den Entwurf bis Freitag und schicke mir deine Rückmeldung.",
  );
  readonly scoreCriteria = scoreCriteria;
  readonly labels = {
    statement: "Aussage",
    question: "Frage",
    request: "Aufforderung",
  };
  constructor() {
    void this.api
      .status()
      .then((source) => this.source.set(source))
      .catch(() =>
        this.state.set({
          kind: "error",
          message:
            "Der lokale Server ist nicht erreichbar. Bitte starten und erneut versuchen.",
        }),
      );
  }
  async evaluate(event: Event) {
    event.preventDefault();
    this.state.set({ kind: "loading" });
    try {
      const result = await this.api.evaluate({ text: this.text() });
      this.source.set(result);
      this.state.set({ kind: "success", result });
    } catch (error: unknown) {
      let message =
        "Die Anfrage ist fehlgeschlagen. Prüfe den lokalen Server und versuche es erneut.";
      if (error instanceof ORPCError) {
        switch (error.code) {
          case "BAD_REQUEST":
            message = "Bitte gib 1 bis 20.000 Zeichen ein.";
            break;
          case "PROVIDER_INVALID_RESPONSE":
            message = "TypeSafe hat eine ungültige Antwort geliefert. Bitte erneut versuchen.";
            break;
          case "PROVIDER_UNAVAILABLE":
            message = "TypeSafe ist gerade nicht erreichbar. Bitte erneut versuchen.";
            break;
        }
      }
      this.state.set({ kind: "error", message });
    }
  }
}
