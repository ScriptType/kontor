import {
  Component,
  computed,
  inject,
  afterRenderEffect,
  viewChild,
  ElementRef,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { injectTable, tableFeatures } from "@tanstack/angular-table";
import { ActionControl, FieldControl } from "./action-registry";
import { ActionDispatcher, action } from "./action-dispatcher";
import { blockers, type CaseDraft } from "../../shared/domain";
const features = tableFeatures({});
const columns = [
  { accessorKey: "id" },
  { accessorKey: "title" },
  { accessorKey: "customerId" },
];
@Component({
  selector: "kontor-cases",
  imports: [FormsModule, ActionControl, FieldControl],
  templateUrl: "./cases.html",
})
export class Cases {
  readonly actions = inject(ActionDispatcher);
  readonly ui = this.actions.ui;
  readonly runner = this.actions.runner;
  readonly action = action;
  readonly evidenceInput =
    viewChild<ElementRef<HTMLTextAreaElement>>("evidenceNote");
  constructor() {
    afterRenderEffect(() => {
      const request = this.ui.evidenceFocus();
      const field = this.evidenceInput()?.nativeElement;
      if (
        request &&
        request === this.ui.selectedId() &&
        field &&
        !this.runner.registry.modal
      ) {
        this.ui.evidenceFocus.set(null);
        field.scrollIntoView({ block: "center" });
        field.focus();
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
    id: string,
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
    };
  }
  search(value: string) {
    if (this.runner.registry.actor === "manual") this.ui.manual();
    this.ui.search.set(value);
  }
  draftChanges() {
    const before = this.ui.selected(), after = this.ui.draft();
    if (!before || !after) return "";
    const appointment = (value: CaseDraft["appointment"]) => value ? `${value.start.replace("T", " ").slice(0,16)} · ${value.minutes} Minuten` : "kein Termin";
    const fields = [
      ["Zuständigkeit", this.ui.technicianName(before.technicianId), this.ui.technicianName(after.technicianId)],
      ["Arbeitszeit", `${before.minutes} Minuten`, `${after.minutes} Minuten`],
      ["Termin", appointment(before.appointment), appointment(after.appointment)],
      ["Status", before.status === "done" ? "erledigt" : "offen", after.status === "done" ? "erledigt" : "offen"],
      ["Prüfbeleg", before.inspection?.note ?? "kein Beleg", after.inspection?.note ?? "kein Beleg"],
    ];
    return fields.filter(([, from, to]) => from !== to).map(([label, from, to]) => `${label} von ${from} auf ${to}`).join("; ");
  }
  saveEffect() { return `${this.ui.selectedId()} verbindlich speichern. ${this.draftChanges()}`; }
  discardEffect() { return `${this.ui.selectedId()}: Folgende Entwurfsänderungen verwerfen und gespeicherten Stand wiederherstellen. ${this.draftChanges()}`; }
  number(event: Event) {
    if (event.target instanceof HTMLInputElement) {
      const value = Number(event.target.value);
      if (Number.isInteger(value) && value >= 0 && value <= 10000)
        this.ui.edit({ minutes: value }, this.runner.registry.actor);
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
