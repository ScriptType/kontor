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
  type CaseFilters,
  type Page,
  type ServiceCase,
} from "../../shared/domain";
@Injectable({ providedIn: "root" })
export class ActionDispatcher {
  readonly ui = inject(WorkspaceUi);
  readonly runner = inject(CommandRunner);
  caseAction(c: ServiceCase) {
    return action(
      `case:${c.id}`,
      `Details von ${c.id} öffnen`,
      {
        does: `Open the detail editor of case ${c.id} "${c.title}"`,
        now: this.caseNow(c),
        reveals:
          "Shows its editor with its fields and actions; view only; changes no case data",
      },
      `Details von ${c.id} auf der Vorgangsseite unterhalb der Tabelle öffnen und in den sichtbaren Bereich bringen`,
    );
  }
  openCaseMenuAction() {
    const hidden = this.hiddenCases();
    return action("menu:open-case", "Vorgang öffnen", {
      does: "Open the case picker, which lists every case by id and title whatever the case list filters hide",
      now: hidden.length
        ? `the case list filters hide ${hidden.join(", ")}`
        : "the case list filters hide no case",
      reveals:
        "Only opens a list of cases; opens no case yet (a case option follows); changes no filters",
      notFor: "filtering or searching the case list",
    });
  }
  openCaseAction(c: ServiceCase) {
    const hidden = this.hiddenCases().includes(c.id);
    return action(
      `open-case:${c.id}`,
      `${c.id} öffnen`,
      {
        does: `Open case ${c.id} "${c.title}" in the detail view; works even when the list filter hides it; does not change filters`,
        now: `the case list filters ${hidden ? "hide" : "show"} it; ${this.caseNow(c)}`,
        reveals:
          "Goes to the case list page and shows its editor; the list filters stay as they are; view only; changes no case data",
        notFor: "filtering the case list to this case",
      },
      `Details von ${c.id} auf der Vorgangsseite öffnen; die Listenfilter bleiben unverändert`,
    );
  }
  private caseNow(c: ServiceCase) {
    const open = this.ui.page() === "cases" && this.ui.selectedId() === c.id;
    return `${open ? "its detail is already open; " : ""}status ${c.status}, assignee ${this.ui.technicianName(c.technicianId)}, worked ${c.minutes} min, appointment ${appointmentText(c.appointment)}, priority ${c.priority}`;
  }
  private hiddenCases() {
    const listed = new Set(this.ui.filtered().map((c) => c.id));
    return (this.ui.data()?.cases ?? [])
      .map((c) => c.id)
      .filter((id) => !listed.has(id));
  }
  currentPage() {
    return `current page is ${pageNames[this.ui.page()]}`;
  }
  filterChange(next: CaseFilters) {
    const describe = (filters: CaseFilters) => ({
      customer:
        filters.customerId === null
          ? "all customers"
          : this.ui.customerName(filters.customerId),
      technician:
        filters.technicianId === null
          ? "all"
          : this.ui.technicianName(filters.technicianId),
      status: filters.status,
      search: `"${filters.search}"`,
    });
    const before = describe(this.ui.filters());
    const after = describe(next);
    const changes = (Object.keys(before) as (keyof typeof before)[])
      .filter((key) => before[key] !== after[key])
      .map((key) => `${key} filter ${before[key]} → ${after[key]}`);
    return changes.length
      ? changes.join("; ")
      : "the case list filters already match; no change";
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
                .enum([
                  "customer",
                  "filter-technician",
                  "technician",
                  "open-case",
                ])
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
      case "open-case":
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
export const filterReveals =
  "Changes only the case list filters, not case data; the filters stay set after the request and are part of what the user sees";
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
