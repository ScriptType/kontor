import { Component, inject } from "@angular/core";
import { ResetWorkspace } from "./reset-workspace";
import { Cases } from "./cases";
import { Overview } from "./overview";
import { Palette } from "./palette";
import { ActionControl, RegionControl } from "./action-registry";
import { ActionDispatcher, action } from "./action-dispatcher";
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
  readonly action = action;
  readonly pages = [
    { id: "cases", label: "Vorgänge", icon: "▤" },
    { id: "customers", label: "Kunden", icon: "▦" },
    { id: "team", label: "Team", icon: "♧" },
    { id: "reports", label: "Berichte", icon: "▥" },
  ];
}
