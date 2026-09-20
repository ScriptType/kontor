import { Injectable, inject } from "@angular/core";
import { z } from "zod";
import { WorkspaceUi } from "./workspace";
import { CommandRunner } from "./command-runner";
import type { Actor } from "./action-registry";
@Injectable({ providedIn: "root" })
export class ActionDispatcher {
  readonly ui = inject(WorkspaceUi);
  readonly runner = inject(CommandRunner);
  execute(id: string, actor: Actor) {
    if (actor === "manual") this.ui.manual();
    const [kind, value] = id.split(":");
    switch (kind) {
      case "nav":
        this.ui.navigate(
          z.enum(["cases", "customers", "team", "reports"]).parse(value),
          actor,
        );
        break;
      case "menu":
        this.ui.menu.set(
          this.ui.menu() === value
            ? null
            : z.enum(["customer", "technician"]).parse(value),
        );
        break;
      case "customer-cases":
        this.ui.navigate("cases", actor);
        this.ui.customer.set(value ?? "all");
        this.ui.openOnly.set(false);
        this.ui.search.set("");
        break;
      case "customer":
        this.ui.customer.set(value ?? "all");
        this.ui.menu.set(null);
        break;
      case "filter":
        if (value === "reset") {
          this.ui.customer.set("all");
          this.ui.openOnly.set(false);
          this.ui.search.set("");
        } else this.ui.openOnly.update((v) => !v);
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
