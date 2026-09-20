import {
  Directive,
  ElementRef,
  Injectable,
  type OnDestroy,
  type OnInit,
  input,
  output,
  inject,
} from "@angular/core";
import type { ActionDescription } from "../../shared/command";
export type Actor = "manual" | "jev";
@Injectable({ providedIn: "root" })
export class ActionRegistry {
  private readonly entries = new Set<ActionControl>();
  actor: Actor = "manual";
  modal = false;
  add(control: ActionControl) {
    this.entries.add(control);
  }
  remove(control: ActionControl) {
    this.entries.delete(control);
  }
  snapshot() {
    return this.modal
      ? []
      : [...this.entries]
          .filter((c) => c.available())
          .map((c) => c.kontorAction());
  }
  execute(id: string) {
    const control = [...this.entries].find(
      (c) => c.kontorAction().id === id && c.available(),
    );
    if (!control || this.modal)
      throw new Error("Das Bedienelement ist nicht mehr zugänglich.");
    this.actor = "jev";
    try {
      control.element.scrollIntoView({ block: "nearest" });
      control.element.click();
    } finally {
      this.actor = "manual";
    }
  }
}
@Directive({
  selector: "[kontorAction]",
  host: { "(click)": "clicked()", "[attr.data-action]": "kontorAction().id" },
})
export class ActionControl implements OnInit, OnDestroy {
  readonly kontorAction = input.required<ActionDescription>();
  readonly invoked = output<Actor>();
  readonly element =
    inject<ElementRef<HTMLButtonElement>>(ElementRef).nativeElement;
  private readonly registry = inject(ActionRegistry);
  ngOnInit() {
    this.registry.add(this);
  }
  ngOnDestroy() {
    this.registry.remove(this);
  }
  available() {
    return (
      this.element.isConnected &&
      !this.element.disabled &&
      !this.element.closest('[inert], [aria-hidden="true"]') &&
      this.element.checkVisibility({ checkVisibilityCSS: true })
    );
  }
  clicked() {
    this.invoked.emit(this.registry.actor);
  }
}
