import { Injectable, inject } from "@angular/core";
import { z } from "zod";
import { WorkspaceUi } from "./workspace";
import { CommandRunner } from "./command-runner";
import type { Actor } from "./action-registry";
import {
  caseFiltersSchema,
  caseSchema,
  defaultCaseFilters,
  pageSchema,
} from "../../shared/domain";
@Injectable({ providedIn: "root" })
export class ActionDispatcher {
  readonly ui = inject(WorkspaceUi);
  readonly runner = inject(CommandRunner);
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
  effect = label,
  kind: "view" | "draft" | "commit" | "discard" = "view",
) {
  return { id, label, effect, kind };
}
export function caseAction(id: string) {
  return action(
    `case:${id}`,
    `Details von ${id} öffnen`,
    `Details von ${id} auf der Vorgangsseite unterhalb der Tabelle öffnen und in den sichtbaren Bereich bringen`,
  );
}
