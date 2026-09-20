import { Component, computed, inject } from "@angular/core";
import { WorkspaceUi } from "./workspace";
import type { ServiceCase } from "../../shared/domain";
@Component({
  selector: "kontor-overview",
  template: `
    @if (ui.page() === "customers") {
      <div class="titleline">
        <div>
          <p class="eyebrow">BEZIEHUNGEN</p>
          <h1>Kunden & Standorte</h1>
          <p class="muted">Kontakte und offene Arbeit je Kunde.</p>
        </div>
      </div>
      <div class="cards">
        @for (customer of ui.data()?.customers; track customer.id) {
          <article class="card">
            <div class="card-icon">{{ customer.name.slice(0, 1) }}</div>
            <h2>{{ customer.name }}</h2>
            <p class="muted">{{ customer.contact }}</p>
            <p>
              {{ casesFor(customer.id).length }} Vorgänge ·
              {{ minutesFor(customer.id) }} Minuten erfasst
            </p>
            <div class="linked-list">
              @for (c of casesFor(customer.id); track c.id) {
                <button (click)="open(c)">
                  <span
                    >{{ c.id }} · {{ c.title }}<small>{{ c.site }}</small></span
                  ><span
                    >{{ c.status === "done" ? "Erledigt" : "Offen" }} ↗</span
                  >
                </button>
              }
            </div>
          </article>
        }
      </div>
    }
    @if (ui.page() === "team") {
      <div class="titleline">
        <div>
          <p class="eyebrow">EINSATZPLANUNG</p>
          <h1>Team & Kapazität</h1>
          <p class="muted">
            Verbindliche Zuständigkeiten und Termine aus gespeicherten
            Vorgängen.
          </p>
        </div>
      </div>
      <div class="cards">
        @for (t of ui.data()?.technicians; track t.id) {
          <article class="card">
            <span class="avatar">{{ t.name.slice(0, 1) }}</span>
            <h2>{{ t.name }}</h2>
            <p class="muted">{{ t.skills.join(" · ") }}</p>
            <p>{{ assigned(t.id).length }} offene Vorgänge</p>
            <div class="linked-list">
              @for (c of assigned(t.id); track c.id) {
                <button (click)="open(c)">
                  <span
                    >{{ c.id }} · {{ c.title
                    }}<small>{{
                      c.appointment
                        ? c.appointment.start.replace("T", " ").slice(0, 16) +
                          " · " +
                          c.appointment.minutes +
                          " min"
                        : "Noch kein Termin"
                    }}</small></span
                  ><span>↗</span>
                </button>
              } @empty {
                <p class="muted">Keine offenen Einsätze.</p>
              }
            </div>
          </article>
        }
      </div>
    }
    @if (ui.page() === "reports") {
      <div class="titleline">
        <div>
          <p class="eyebrow">GESPEICHERTE ERGEBNISSE</p>
          <h1>Berichte</h1>
          <p class="muted">
            Auswertung aller gespeicherten Vorgänge. Offene Entwürfe sind nicht
            enthalten.
          </p>
        </div>
      </div>
      <div class="metrics">
        <article class="card">
          <span class="muted">Offene Vorgänge</span
          ><strong>{{ openCount() }}</strong>
        </article>
        <article class="card">
          <span class="muted">Abgeschlossen</span
          ><strong>{{ doneCount() }}</strong>
        </article>
        <article class="card">
          <span class="muted">Geleistete Minuten</span
          ><strong>{{ totalMinutes() }}</strong>
        </article>
      </div>
      <section class="card">
        <h2>Arbeitszeit nach Kunde</h2>
        @for (c of ui.data()?.customers; track c.id) {
          <button class="report-row" (click)="filterCustomer(c.id)">
            <span>{{ c.name }}</span
            ><span class="bar-track"
              ><span
                [style.width.%]="
                  totalMinutes() ? (minutesFor(c.id) / totalMinutes()) * 100 : 0
                "
              ></span></span
            ><strong>{{ minutesFor(c.id) }} min ↗</strong>
          </button>
        }
      </section>
    }
  `,
})
export class Overview {
  readonly ui = inject(WorkspaceUi);
  readonly openCount = computed(
    () => this.ui.data()?.cases.filter((c) => c.status === "open").length ?? 0,
  );
  readonly doneCount = computed(
    () => this.ui.data()?.cases.filter((c) => c.status === "done").length ?? 0,
  );
  readonly totalMinutes = computed(
    () => this.ui.data()?.cases.reduce((sum, c) => sum + c.minutes, 0) ?? 0,
  );
  casesFor(id: string) {
    return this.ui.data()?.cases.filter((c) => c.customerId === id) ?? [];
  }
  minutesFor(id: string) {
    return this.casesFor(id).reduce((sum, c) => sum + c.minutes, 0);
  }
  assigned(id: string) {
    return (
      this.ui
        .data()
        ?.cases.filter((c) => c.technicianId === id && c.status === "open") ??
      []
    );
  }
  open(c: ServiceCase) {
    this.ui.navigate("cases", "manual");
    this.ui.openCase(c.id, "manual");
  }
  filterCustomer(id: string) {
    this.ui.navigate("cases", "manual");
    this.ui.customer.set(id);
    this.ui.openOnly.set(false);
  }
}
