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
import type {
  ActionDescription,
  FieldDescription,
  DecisionInput,
} from "../../shared/command";
import { fieldValues } from "../../shared/field-values";
export type Actor = "manual" | "jev";
interface Control {
  available(): boolean;
}
@Injectable({ providedIn: "root" })
export class ActionRegistry {
  private readonly entries = new Set<ActionControl>();
  private readonly fields = new Set<FieldControl>();
  private offers = new Map<
    string,
    { description: ActionDescription; execute: () => void }
  >();
  actor: Actor = "manual";
  modal = false;
  add(control: ActionControl) {
    this.entries.add(control);
  }
  remove(control: ActionControl) {
    this.entries.delete(control);
  }
  addField(control: FieldControl) {
    this.fields.add(control);
  }
  removeField(control: FieldControl) {
    this.fields.delete(control);
  }
  fieldSnapshot() {
    return this.modal
      ? []
      : [...this.fields]
          .filter((f) => f.available())
          .map((f) => f.kontorField());
  }
  snapshot(
    request = "",
    answers: DecisionInput["answers"] = [],
    existing: string[] = [],
  ) {
    this.offers.clear();
    if (this.modal) return [];
    const add = (
      description: ActionDescription,
      control: Control,
      execute: () => void,
    ) => {
      if (this.offers.has(description.id))
        throw new Error("Doppelte Bedienelementkennung.");
      this.offers.set(description.id, {
        description,
        execute: () => {
          if (!control.available())
            throw new Error("Das Bedienelement ist nicht mehr zugänglich.");
          execute();
        },
      });
    };
    for (const control of this.entries)
      if (control.available())
        add(control.kontorAction(), control, () => control.element.click());
    for (const control of this.fields)
      if (control.available()) {
        const field = control.kontorField();
        for (const { value, source } of fieldValues(
          field,
          request,
          answers,
          existing,
        ))
          add(
            {
              id: `field:${field.id}:${value}`,
              label: `${field.label} auf ${value} setzen`,
              effect: `${field.label}: ${field.current || "leer"} → ${value}; ${source}`,
              kind: field.kind,
            },
            control,
            () => {
              control.element.value = value;
              control.element.dispatchEvent(
                new Event("input", { bubbles: true }),
              );
              control.element.dispatchEvent(
                new Event("change", { bubbles: true }),
              );
            },
          );
      }
    return [...this.offers.values()].map((o) => o.description);
  }
  execute(action: ActionDescription) {
    const offer = this.offers.get(action.id);
    if (
      !offer ||
      this.modal ||
      JSON.stringify(offer.description) !== JSON.stringify(action)
    )
      throw new Error("Entscheidung gehört nicht zum aktuellen Zustand.");
    this.actor = "jev";
    try {
      offer.execute();
    } finally {
      this.actor = "manual";
    }
  }
}
function available(element: HTMLInputElement | HTMLButtonElement) {
  return (
    element.isConnected &&
    !element.disabled &&
    !element.closest('[inert], [aria-hidden="true"]') &&
    element.checkVisibility({ checkVisibilityCSS: true })
  );
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
    return available(this.element);
  }
  clicked() {
    this.invoked.emit(this.registry.actor);
  }
}
@Directive({
  selector: "[kontorField]",
  host: { "[attr.data-field]": "kontorField().id" },
})
export class FieldControl implements OnInit, OnDestroy {
  readonly kontorField = input.required<FieldDescription>();
  readonly element =
    inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly registry = inject(ActionRegistry);
  ngOnInit() {
    this.registry.addField(this);
  }
  ngOnDestroy() {
    this.registry.removeField(this);
  }
  available() {
    return !this.element.readOnly && available(this.element);
  }
}
