import { Component, computed, inject } from "@angular/core";
import { ActionControl, RegionControl } from "./action-registry";
import { ActionDispatcher, action, filterReveals } from "./action-dispatcher";
import {
  defaultCaseFilters,
  type CaseFilters,
  type Workspace,
} from "../../shared/domain";
type Customer = Workspace["customers"][number];
type Technician = Workspace["technicians"][number];
@Component({
  selector: "kontor-overview",
  imports: [ActionControl, RegionControl],
  template: `
    @if (ui.page() === "customers") {
      <section [kontorRegion]="{ id: 'customers', kind: 'page', label: 'Kunden und Standorte' }">
      <div class="titleline">
        <div>
          <p class="eyebrow">BEZIEHUNGEN</p>
          <h1>Kunden & Standorte</h1>
          <p class="muted">Kontakte und offene Arbeit je Kunde.</p>
        </div>
      </div>
      <div class="cards">
        @for (customer of ui.data()?.customers; track customer.id) {
          <article class="card" [kontorRegion]="{ id: 'customer:' + customer.id, kind: 'section', label: customer.name }">
            <div class="card-icon">{{ customer.name.slice(0, 1) }}</div>
            <h2>{{ customer.name }}</h2>
            <p class="muted">{{ customer.contact }}</p>
            <p>
              {{ casesFor(customer.id).length }} Vorgänge ·
              {{ minutesFor(customer.id) }} Minuten erfasst
            </p>
            <button
              [kontorAction]="customerCasesAction(customer)"
              (invoked)="
                actions.execute('customer-cases:' + customer.id, $event)
              "
            >
              Alle Vorgänge anzeigen
            </button>
            <div class="linked-list">
              @for (c of casesFor(customer.id); track c.id) {
                <button
                  [kontorAction]="actions.caseAction(c)"
                  (invoked)="actions.execute('case:' + c.id, $event)"
                >
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
      </section>
    }
    @if (ui.page() === "team") {
      <section [kontorRegion]="{ id: 'team', kind: 'page', label: 'Team und Kapazität' }">
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
          <article class="card" [kontorRegion]="{ id: 'technician:' + t.id, kind: 'section', label: t.name }">
            <span class="avatar">{{ t.name.slice(0, 1) }}</span>
            <h2>{{ t.name }}</h2>
            <p class="muted">{{ t.skills.join(" · ") }}</p>
            <p>{{ assigned(t.id).length }} offene Vorgänge</p>
            <button
              [kontorAction]="technicianCasesAction(t)"
              (invoked)="actions.execute('technician-cases:' + t.id, $event)"
            >Offene Vorgänge anzeigen</button>
            <div class="linked-list">
              @for (c of assigned(t.id); track c.id) {
                <button
                  [kontorAction]="actions.caseAction(c)"
                  (invoked)="actions.execute('case:' + c.id, $event)"
                >
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
      </section>
    }
    @if (ui.page() === "reports") {
      <section [kontorRegion]="{ id: 'reports', kind: 'page', label: 'Berichte' }">
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
        <button class="card metric-link"
          [kontorAction]="statusCasesAction('open')"
          (invoked)="actions.execute('status-cases:open', $event)">
          <span class="muted">Offene Vorgänge</span
          ><strong>{{ openCount() }} ↗</strong>
        </button>
        <button class="card metric-link"
          [kontorAction]="statusCasesAction('done')"
          (invoked)="actions.execute('status-cases:done', $event)">
          <span class="muted">Abgeschlossen</span
          ><strong>{{ doneCount() }} ↗</strong>
        </button>
        <article class="card">
          <span class="muted">Geleistete Minuten</span
          ><strong>{{ totalMinutes() }}</strong>
        </article>
      </div>
      <section class="card" [kontorRegion]="{ id: 'customer-time', kind: 'section', label: 'Arbeitszeit nach Kunde' }">
        <h2>Arbeitszeit nach Kunde</h2>
        @for (c of ui.data()?.customers; track c.id) {
          <button
            class="report-row"
            [kontorAction]="customerCasesAction(c)"
            (invoked)="actions.execute('customer-cases:' + c.id, $event)"
          >
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
      </section>
    }
  `,
})
export class Overview {
  readonly actions = inject(ActionDispatcher);
  readonly ui = this.actions.ui;
  readonly openCount = computed(
    () => this.ui.data()?.cases.filter((c) => c.status === "open").length ?? 0,
  );
  readonly doneCount = computed(
    () => this.ui.data()?.cases.filter((c) => c.status === "done").length ?? 0,
  );
  readonly totalMinutes = computed(
    () => this.ui.data()?.cases.reduce((sum, c) => sum + c.minutes, 0) ?? 0,
  );
  customerCasesAction(customer: Customer) {
    return action(
      `customer-cases:${customer.id}`,
      `Vorgänge von ${customer.name} anzeigen`,
      {
        does: `Go to the case list filtered to customer ${customer.name}`,
        now: this.shownCases({
          ...defaultCaseFilters,
          customerId: customer.id,
        }),
        reveals: filterReveals,
        notFor: `reaching one case of ${customer.name}; open that case itself`,
      },
    );
  }
  technicianCasesAction(t: Technician) {
    return action(
      `technician-cases:${t.id}`,
      `Offene Vorgänge von ${t.name} anzeigen`,
      {
        does: `Go to the case list filtered to the open cases of ${t.name}`,
        now: this.shownCases({
          ...defaultCaseFilters,
          technicianId: t.id,
          status: "open",
        }),
        reveals: filterReveals,
        notFor: `assigning ${t.name} to a case`,
      },
    );
  }
  statusCasesAction(status: "open" | "done") {
    return action(
      `status-cases:${status}`,
      status === "open"
        ? "Offene Vorgänge anzeigen"
        : "Erledigte Vorgänge anzeigen",
      {
        does: `Go to the case list filtered to the ${status} cases`,
        now: this.shownCases({ ...defaultCaseFilters, status }),
        reveals: filterReveals,
        notFor: "changing the status of a case",
      },
    );
  }
  shownCases(filters: CaseFilters) {
    return `${this.actions.currentPage()}; ${this.actions.filterChange(filters)}`;
  }
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
}
