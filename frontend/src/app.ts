import { Component, inject } from "@angular/core";
import { ResetWorkspace } from "./reset-workspace";
import { Cases } from "./cases";
import { Overview } from "./overview";
import { Palette } from "./palette";
import { ActionControl, RegionControl } from "./action-registry";
import { ActionDispatcher, action, pageNames } from "./action-dispatcher";
import type { Page } from "../../shared/domain";
type NavPage = { id: Page; label: string; icon: string };
@Component({
  selector: "app-root",
  imports: [
    Cases,
    Overview,
    Palette,
    ActionControl,
    RegionControl,
    ResetWorkspace,
  ],
  templateUrl: "./app.html",
})
export class App {
  readonly actions = inject(ActionDispatcher);
  readonly ui = this.actions.ui;
  readonly runner = this.actions.runner;
  readonly pages: NavPage[] = [
    { id: "cases", label: "Vorgänge", icon: "▤" },
    { id: "customers", label: "Kunden", icon: "▦" },
    { id: "team", label: "Team", icon: "♧" },
    { id: "reports", label: "Berichte", icon: "▥" },
  ];
  navAction(page: NavPage) {
    const selected = this.ui.page() === "cases" && this.ui.selectedId();
    return action(`nav:${page.id}`, `${page.label} öffnen`, {
      does: `Go to ${pageNames[page.id]}`,
      now:
        this.ui.page() === page.id
          ? "you are already on this page"
          : this.actions.currentPage(),
      reveals: `View only; changes no case data; only switches the page${selected && page.id !== "cases" ? `; the open detail of case ${selected} leaves the screen` : ""}`,
    });
  }
}
