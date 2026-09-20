import { Component, computed, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { injectTable, tableFeatures } from "@tanstack/angular-table";
import { ActionControl } from "./action-registry";
import { ActionDispatcher, action } from "./action-dispatcher";
import { blockers } from "../../shared/domain";
const features = tableFeatures({});
const columns = [
  { accessorKey: "id" },
  { accessorKey: "title" },
  { accessorKey: "customerId" },
];
@Component({
  selector: "kontor-cases",
  imports: [FormsModule, ActionControl],
  templateUrl: "./cases.html",
})
export class Cases {
  readonly actions = inject(ActionDispatcher);
  readonly ui = this.actions.ui;
  readonly runner = this.actions.runner;
  readonly action = action;
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
  number(event: Event) {
    if (event.target instanceof HTMLInputElement) {
      const value = Number(event.target.value);
      if (Number.isInteger(value) && value >= 0 && value <= 10000)
        this.ui.edit({ minutes: value }, "manual");
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
        "manual",
      );
  }
  evidence(note: string) {
    if (note.trim().length >= 5)
      this.ui.edit({ inspection: { note: note.trim(), by: "user" } }, "manual");
  }
}
