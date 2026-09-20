import { Component, computed, inject, signal } from "@angular/core";
import { DecimalPipe, KeyValuePipe, PercentPipe } from "@angular/common";
import { ORPCError } from "@orpc/client";
import {
  injectQuery,
  injectMutation,
} from "@tanstack/angular-query-experimental";
import { scoreCriteria } from "../../shared/questions";
import { ORPC } from "./api";

@Component({
  selector: "app-root",
  imports: [DecimalPipe, KeyValuePipe, PercentPipe],
  templateUrl: "./app.html",
})
export class App {
  private readonly orpc = inject(ORPC);
  readonly status = injectQuery(() =>
    this.orpc.status.queryOptions({
      staleTime: Infinity,
      retry: false,
      networkMode: "always",
    }),
  );
  readonly evaluation = injectMutation(() =>
    this.orpc.evaluate.mutationOptions({
      retry: false,
      networkMode: "always",
    }),
  );
  readonly source = computed(
    () => this.evaluation.data() ?? this.status.data(),
  );
  readonly errorMessage = computed(() => {
    const error = this.evaluation.error();
    if (error instanceof ORPCError) {
      switch (error.code) {
        case "BAD_REQUEST":
          return "Bitte gib 1 bis 20.000 Zeichen ein.";
        case "PROVIDER_INVALID_RESPONSE":
          return "TypeSafe hat eine ungültige Antwort geliefert. Bitte erneut versuchen.";
        case "PROVIDER_UNAVAILABLE":
          return "TypeSafe ist gerade nicht erreichbar. Bitte erneut versuchen.";
      }
    }
    if (error)
      return "Die Anfrage ist fehlgeschlagen. Das Ergebnis ist unbekannt. Eine erneute Anfrage kann eine weitere Auswertung auslösen.";
    if (this.status.isError() && this.evaluation.isIdle())
      return "Der lokale Server ist nicht erreichbar. Bitte starten und erneut versuchen.";
    return null;
  });
  readonly text = signal(
    "Bitte prüfe den Entwurf bis Freitag und schicke mir deine Rückmeldung.",
  );
  readonly scoreCriteria = scoreCriteria;
  readonly labels = {
    statement: "Aussage",
    question: "Frage",
    request: "Aufforderung",
  };
  evaluate(event: Event) {
    event.preventDefault();
    this.evaluation.mutate({ text: this.text() });
  }
}
