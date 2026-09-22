import {
  Component,
  computed,
  inject,
  afterRenderEffect,
  viewChild,
  ElementRef,
  DestroyRef,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { injectTable, tableFeatures } from "@tanstack/angular-table";
import { ActionControl, FieldControl, RegionControl } from "./action-registry";
import {
  ActionDispatcher,
  action,
  appointmentText,
  filterReveals,
} from "./action-dispatcher";
import type { FieldDescription } from "../../shared/command";
import {
  blockers,
  defaultCaseFilters,
  type CaseDraft,
  type CaseFilters,
  type ServiceCase,
  type Workspace,
} from "../../shared/domain";
type Customer = Workspace["customers"][number];
type Technician = Workspace["technicians"][number];
const statusNames: Record<CaseFilters["status"], string> = {
  all: "all statuses",
  open: "open",
  done: "done",
};
const fieldTexts = {
  search: { name: "case list search text" },
  minutes: {
    name: "worked minutes (time actually spent on the case, Arbeitszeit)",
    notFor:
      "the planned length of an appointment (that is the appointment duration field)",
  },
  appointment: {
    name: "appointment start date and time (Termin)",
    notFor: "worked minutes or the appointment duration",
  },
  duration: {
    name: "appointment duration in minutes (planned length of the appointment, Termindauer)",
    notFor:
      "time actually worked on the case (that is the worked minutes field)",
  },
} satisfies Record<string, FieldDescription["jev"]>;
const filterMenu =
  "Only opens a list of filter values; view only; changes no case data";
const features = tableFeatures({});
const columns = [
  { accessorKey: "id" },
  { accessorKey: "title" },
  { accessorKey: "customerId" },
];
@Component({
  selector: "kontor-cases",
  imports: [FormsModule, ActionControl, FieldControl, RegionControl],
  templateUrl: "./cases.html",
})
export class Cases {
  readonly actions = inject(ActionDispatcher);
  readonly ui = this.actions.ui;
  readonly runner = this.actions.runner;
  readonly statuses = [
    { value: "all", label: "Alle" },
    { value: "open", label: "Offen" },
    { value: "done", label: "Erledigt" },
  ] as const;
  readonly priorities = ["Normal", "Hoch"] as const;
  readonly evidenceInput =
    viewChild<ElementRef<HTMLTextAreaElement>>("evidenceNote");
  readonly detailHeading =
    viewChild<ElementRef<HTMLHeadingElement>>("detailHeading");
  constructor() {
    inject(DestroyRef).onDestroy(() => this.ui.cancelFocus());
    afterRenderEffect(() => {
      const evidence = this.ui.evidenceFocus();
      const request = evidence ?? this.ui.detailFocus();
      const target = evidence
        ? this.evidenceInput()?.nativeElement
        : this.detailHeading()?.nativeElement;
      if (!request) return;
      this.ui.cancelFocus();
      if (
        request === this.ui.selectedId() &&
        this.ui.page() === "cases" &&
        target?.isConnected &&
        !this.runner.registry.modal &&
        !target.closest('[inert], [aria-hidden="true"]')
      ) {
        target.scrollIntoView({ block: "center", behavior: "instant" });
        target.focus({ preventScroll: true });
      }
    });
  }
  readonly table = injectTable(() => ({
    features,
    columns,
    data: this.ui.filtered(),
    getRowId: (row) => row.id,
  }));
  readonly completionBlockers = computed(() => {
    const workspace = this.ui.data(),
      c = this.ui.selected(),
      d = this.ui.draft();
    return workspace && c && d
      ? blockers(workspace, { ...c, ...d, status: "done" })
      : [];
  });
  readonly String = String;
  field(
    id: keyof typeof fieldTexts,
    label: string,
    type: "text" | "number" | "datetime-local",
    current: string,
    min?: number,
    max?: number,
  ) {
    return {
      id,
      scope: id === "search" ? "cases" : (this.ui.selectedId() ?? ""),
      kind: id === "search" ? ("view" as const) : ("draft" as const),
      label: id === "search" ? label : `${this.ui.selectedId()} · ${label}`,
      type,
      current,
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
      jev: fieldTexts[id],
    };
  }
  customerFilterText() {
    const id = this.ui.filters().customerId;
    return id === null ? "all customers" : this.ui.customerName(id);
  }
  technicianFilterText() {
    const id = this.ui.filters().technicianId;
    return id === null ? "all" : this.ui.technicianName(id);
  }
  customerMenuAction() {
    return action("menu:customer", "Kundenfilter öffnen", {
      does: "Open the customer filter of the case list",
      now: `customer filter is ${this.customerFilterText()}`,
      reveals: filterMenu,
      notFor: "going to the customer overview page",
    });
  }
  customerAction(customer: Customer | null) {
    return action(
      `customer:${customer?.id ?? "all"}`,
      customer ? `${customer.name} anzeigen` : "Alle Kunden anzeigen",
      {
        does: customer
          ? `Filter the case list to customer ${customer.name}`
          : "Filter the case list to all customers (remove the customer filter)",
        now: this.actions.filterChange({
          ...this.ui.filters(),
          customerId: customer?.id ?? null,
        }),
        reveals: filterReveals,
        notFor: customer
          ? `going to the customer overview page, or reaching one case of ${customer.name}; open that case itself`
          : "going to the customer overview page",
      },
    );
  }
  technicianFilterMenuAction() {
    return action("menu:filter-technician", "Zuständigkeitsfilter öffnen", {
      does: "Open the technician filter of the case list",
      now: `technician filter is ${this.technicianFilterText()}`,
      reveals: filterMenu,
      notFor:
        "assigning a technician to a case (that is the assignee picker in the case detail)",
    });
  }
  technicianFilterAction(t: Technician | null) {
    return action(
      `filter-technician:${t?.id ?? "all"}`,
      t
        ? `Vorgänge mit Zuständigkeit ${t.name} anzeigen`
        : "Alle Zuständigen anzeigen",
      {
        does: t
          ? `Filter the case list to cases assigned to ${t.name}`
          : "Filter the case list to all technicians (remove the technician filter)",
        now: this.actions.filterChange({
          ...this.ui.filters(),
          technicianId: t?.id ?? null,
        }),
        reveals: filterReveals,
        notFor:
          "assigning a technician to a case (that is the assignee picker)",
      },
    );
  }
  statusFilterAction(status: { value: CaseFilters["status"]; label: string }) {
    return action(
      `filter:${status.value}`,
      `${status.label} · Vorgangsstatus anzeigen`,
      {
        does: `Filter the case list by status: ${statusNames[status.value]}`,
        now: this.actions.filterChange({
          ...this.ui.filters(),
          status: status.value,
        }),
        reveals: filterReveals,
        notFor: "changing the status of a case",
      },
    );
  }
  resetAction() {
    return action("filter:reset", "Filter zurücksetzen", {
      does: "Reset all case list filters (customer, technician, status, search)",
      now: this.actions.filterChange(defaultCaseFilters),
      reveals: filterReveals,
    });
  }
  closeAction(c: ServiceCase, draft: CaseDraft) {
    return action("close", `${c.id} schließen`, {
      does: `Close the detail view of case ${c.id} (hide its editor)`,
      now: `status ${draft.status}`,
      reveals:
        "View only: does NOT complete, save or change the case; its status stays the same",
      notFor: "marking the case done (that is complete)",
    });
  }
  priorityAction(
    priority: CaseDraft["priority"],
    c: ServiceCase,
    draft: CaseDraft,
  ) {
    return action(
      `priority:${priority}`,
      `Priorität ${priority} setzen`,
      {
        does: `Set the priority of case ${c.id} to ${priority}`,
        now:
          draft.priority === priority
            ? `priority is already ${priority}; no change`
            : `priority ${draft.priority} → ${priority}`,
      },
      `${c.id}: Priorität von ${draft.priority} auf ${priority} im Entwurf ändern`,
      "draft",
    );
  }
  technicianMenuAction(c: ServiceCase, draft: CaseDraft) {
    return action("menu:technician", "Zuständigkeit öffnen", {
      does: `Open the assignee picker of case ${c.id}`,
      now: `assignee is ${this.ui.technicianName(draft.technicianId)}`,
      reveals:
        "Only opens a list of technicians to assign; assigns nothing yet (a technician option follows)",
      notFor:
        "filtering the case list by technician (that is the technician filter menu)",
    });
  }
  technicianAction(t: Technician, c: ServiceCase, draft: CaseDraft) {
    const current = this.ui.technicianName(draft.technicianId);
    return action(
      `technician:${t.id}`,
      `${t.name} zuweisen`,
      {
        does: `Assign ${t.name} to case ${c.id}`,
        now:
          draft.technicianId === t.id
            ? `${t.name} is already the assignee; no change`
            : `assignee ${current} → ${t.name}`,
        notFor: `filtering the case list to ${t.name} (that is the technician filter)`,
      },
      draft.technicianId === t.id
        ? `${c.id}: Zuständigkeit ist bereits ${t.name}`
        : `${c.id}: Zuständigkeit von ${current} auf ${t.name} im Entwurf ändern`,
      "draft",
    );
  }
  removeAppointmentAction(c: ServiceCase, draft: CaseDraft) {
    return action(
      "remove-appointment",
      "Termin entfernen",
      {
        does: `Remove the appointment of case ${c.id}`,
        now: `appointment ${appointmentText(draft.appointment)} → none`,
        notFor: "changing worked minutes or the appointment duration",
      },
      `${c.id}: Bestehenden Termin im Entwurf entfernen`,
      "draft",
    );
  }
  reopenAction(c: ServiceCase, draft: CaseDraft) {
    return action(
      "reopen",
      "Vorgang wieder öffnen",
      {
        does: `Reopen case ${c.id}`,
        now: `status ${draft.status} → open`,
      },
      `${c.id}: Status auf offen im Entwurf ändern`,
      "draft",
    );
  }
  completeAction(c: ServiceCase, draft: CaseDraft) {
    return action(
      "complete",
      "Vorgang als erledigt markieren",
      {
        does: `Mark case ${c.id} as done`,
        now: `status ${draft.status} → done`,
        notFor: "closing the detail view (that is close)",
      },
      `${c.id}: Status auf erledigt im Entwurf ändern`,
      "draft",
    );
  }
  discardAction(c: ServiceCase) {
    return action(
      "discard",
      "Entwurf verwerfen",
      {
        does: `Discard the unsaved draft of case ${c.id} and restore the saved values`,
        now: `would undo: ${this.jevDraftChanges() || "no changes"}`,
        reveals: "Loses unsaved changes; saves nothing",
      },
      `${c.id}: Folgende Entwurfsänderungen verwerfen und gespeicherten Stand wiederherstellen. ${this.draftChanges()}`,
      "discard",
    );
  }
  saveAction(c: ServiceCase) {
    return action(
      "save",
      "Änderungen speichern",
      {
        does: `Save the draft of case ${c.id} permanently`,
        now: `changes: ${this.jevDraftChanges() || "none"}`,
        reveals:
          "Commits the draft; does not close the detail and does not mark the case done by itself",
      },
      `${c.id} verbindlich speichern. ${this.draftChanges()}`,
      "commit",
    );
  }
  jevDraftChanges() {
    const before = this.ui.selected(),
      after = this.ui.draft();
    if (!before || !after) return "";
    const name = (id: string) => this.ui.technicianName(id);
    const fields = [
      ["assignee", name(before.technicianId), name(after.technicianId)],
      ["worked minutes", String(before.minutes), String(after.minutes)],
      [
        "appointment",
        appointmentText(before.appointment),
        appointmentText(after.appointment),
      ],
      ["status", before.status, after.status],
      ["priority", before.priority, after.priority],
    ];
    return fields
      .filter(([, from, to]) => from !== to)
      .map(([label, from, to]) => `${label} ${from} → ${to}`)
      .join("; ");
  }
  search(value: string) {
    this.ui.setFilters(
      { ...this.ui.filters(), search: value },
      this.runner.registry.actor,
    );
  }
  draftChanges() {
    const before = this.ui.selected(),
      after = this.ui.draft();
    if (!before || !after) return "";
    const appointment = (value: CaseDraft["appointment"]) =>
      value
        ? `${value.start.replace("T", " ").slice(0, 16)} · ${value.minutes} Minuten`
        : "kein Termin";
    const fields = [
      ["Priorität", before.priority, after.priority],
      [
        "Zuständigkeit",
        this.ui.technicianName(before.technicianId),
        this.ui.technicianName(after.technicianId),
      ],
      ["Arbeitszeit", `${before.minutes} Minuten`, `${after.minutes} Minuten`],
      [
        "Termin",
        appointment(before.appointment),
        appointment(after.appointment),
      ],
      [
        "Status",
        before.status === "done" ? "erledigt" : "offen",
        after.status === "done" ? "erledigt" : "offen",
      ],
      [
        "Prüfbeleg",
        before.inspection?.note ?? "kein Beleg",
        after.inspection?.note ?? "kein Beleg",
      ],
    ];
    return fields
      .filter(([, from, to]) => from !== to)
      .map(([label, from, to]) => `${label} von ${from} auf ${to}`)
      .join("; ");
  }
  manualFieldInput() {
    if (this.runner.registry.actor === "manual") this.ui.manual();
  }
  number(event: Event) {
    if (event.target instanceof HTMLInputElement) {
      const value = Number(event.target.value);
      if (Number.isInteger(value) && value >= 0 && value <= 10000)
        this.ui.edit({ minutes: value }, this.runner.registry.actor);
      else this.manualFieldInput();
    }
  }
  appointment(start: string, minutes: number) {
    if (start && minutes >= 15 && minutes <= 480)
      this.ui.edit(
        {
          appointment: {
            start: start.length === 16 ? start + ":00" : start,
            minutes,
          },
        },
        this.runner.registry.actor,
      );
  }
  evidence(note: string) {
    if (note.trim().length >= 5)
      this.ui.edit({ inspection: { note: note.trim(), by: "user" } }, "manual");
  }
}
