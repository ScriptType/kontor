import { Injectable, inject } from "@angular/core";
import { z } from "zod";
import { WorkspaceUi } from "./workspace";
import { CommandRunner } from "./command-runner";
import type { Actor } from "./action-registry";
import type { ActionDescription, JevText } from "../../shared/command";
import {
  caseFiltersSchema,
  caseSchema,
  defaultCaseFilters,
  pageSchema,
  type Page,
  type ServiceCase,
} from "../../shared/domain";
@Injectable({ providedIn: "root" })
export class ActionDispatcher {
  readonly ui = inject(WorkspaceUi);
  readonly runner = inject(CommandRunner);
  caseAction(c: ServiceCase) {
    const open = this.ui.page() === "cases" && this.ui.selectedId() === c.id;
    return action(
      `case:${c.id}`,
      `Details von ${c.id} öffnen`,
      {
        does: `Open the detail editor of case ${c.id} "${c.title}"`,
        now: `${open ? "its detail is already open; " : ""}status ${c.status}, assignee ${this.ui.technicianName(c.technicianId)}, worked ${c.minutes} min, appointment ${appointmentText(c.appointment)}, priority ${c.priority}`,
        reveals:
          "Shows its editor with its fields and actions; view only; changes no case data",
      },
      `Details von ${c.id} auf der Vorgangsseite unterhalb der Tabelle öffnen und in den sichtbaren Bereich bringen`,
    );
  }
  currentPage() {
    return `current page is ${pageNames[this.ui.page()]}`;
  }
  execute(id: string, actor: Actor) {
    const [kind, value] = id.split(":");
    switch (kind) {
      case "nav":
        this.ui.navigate(pageSchema.parse(value), actor);
        break;
      case "menu":
        if (actor === "manual") this.ui.manual();
        this.ui.menu.set(
          this.ui.menu() === value
            ? null
            : z
                .enum(["customer", "filter-technician", "technician"])
                .parse(value),
        );
        break;
      case "customer-cases":
        this.ui.showCases(
          { ...defaultCaseFilters, customerId: value ?? null },
          actor,
        );
        break;
      case "technician-cases":
        this.ui.showCases(
          {
            ...defaultCaseFilters,
            technicianId: value ?? null,
            status: "open",
          },
          actor,
        );
        break;
      case "status-cases":
        this.ui.showCases(
          {
            ...defaultCaseFilters,
            status: caseSchema.shape.status.parse(value),
          },
          actor,
        );
        break;
      case "customer":
        this.ui.setFilters(
          {
            ...this.ui.filters(),
            customerId: value === "all" ? null : (value ?? null),
          },
          actor,
        );
        break;
      case "filter-technician":
        this.ui.setFilters(
          {
            ...this.ui.filters(),
            technicianId: value === "all" ? null : (value ?? null),
          },
          actor,
        );
        break;
      case "filter":
        this.ui.setFilters(
          value === "reset"
            ? { ...defaultCaseFilters }
            : {
                ...this.ui.filters(),
                status: caseFiltersSchema.shape.status.parse(value),
              },
          actor,
        );
        break;
      case "case":
        this.ui.navigate("cases", actor);
        this.ui.openCase(value ?? "", actor);
        break;
      case "technician":
        this.ui.edit({ technicianId: value ?? "" }, actor);
        this.ui.menu.set(null);
        break;
      case "complete":
        this.ui.edit({ status: "done" }, actor);
        break;
      case "reopen":
        this.ui.edit({ status: "open" }, actor);
        break;
      case "priority":
        this.ui.edit(
          { priority: z.enum(["Hoch", "Normal"]).parse(value) },
          actor,
        );
        break;
      case "remove-appointment":
        this.ui.edit({ appointment: null }, actor);
        break;
      case "close":
        this.ui.closeCase(actor);
        break;
      case "discard":
        this.ui.discard(actor);
        break;
      case "save":
        this.ui.save(actor);
        break;
    }
  }
}
export function action(
  id: string,
  label: string,
  jev: JevText,
  effect = label,
  kind: ActionDescription["kind"] = "view",
): ActionDescription {
  return { id, label, effect, kind, jev };
}
export const pageNames: Record<Page, string> = {
  cases: "the case list page",
  customers: "the customer overview page",
  team: "the team and capacity page",
  reports: "the reports page",
};
export function appointmentText(value: ServiceCase["appointment"]) {
  return value
    ? `${value.start.replace("T", " ").slice(0, 16)} for ${value.minutes} min`
    : "none";
}
