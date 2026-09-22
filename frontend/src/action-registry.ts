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
import {
  jevFieldName,
  type ActionDescription,
  type BlockedControl,
  type FieldDescription,
  type DecisionInput,
} from "../../shared/command";
import { describeSource, fieldValues } from "../../shared/field-values";
export type Actor = "manual" | "jev";
interface Control {
  element: HTMLElement;
  available(): boolean;
}
type RegionDescription = {
  id: string;
  label: string;
} & (
  | { kind: "navigation" | "page" | "section" }
  | {
      kind: "detail";
      detail: { kind: "case"; id: string; draft: "saved" | "draft" };
    }
);
@Injectable({ providedIn: "root" })
export class ActionRegistry {
  private readonly entries = new Set<ActionControl>();
  private readonly fields = new Set<FieldControl>();
  private readonly regions = new Set<RegionControl>();
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
  addRegion(control: RegionControl) {
    this.regions.add(control);
  }
  removeRegion(control: RegionControl) {
    this.regions.delete(control);
  }
  observeScreen() {
    const mounted = this.modal
      ? []
      : [...this.regions]
          .filter((region) => rendered(region.element))
          .sort(domOrder);
    const regions = mounted.slice(0, 24);
    const owner = (element: HTMLElement) =>
      regions.find(
        (region) => region.element === element.closest("[data-region]"),
      );
    const actions = [...this.entries]
      .filter((control) => control.available())
      .sort(domOrder)
      .slice(0, 100);
    const fields = [...this.fields]
      .filter((control) => control.available())
      .sort(domOrder)
      .slice(0, 30);
    const detail = regions
      .find((region) => region.kontorRegion().kind === "detail")
      ?.kontorRegion();
    return {
      currentDetail: detail?.kind === "detail" ? detail.detail : null,
      truncated: mounted.length > regions.length,
      regions: regions.map((region, order) => {
        const description = region.kontorRegion();
        const element = region.element;
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement
          ? owner(element.parentElement)
          : undefined;
        const visibility =
          rect.bottom <= 0
            ? "above"
            : rect.top >= innerHeight
              ? "below"
              : rect.right <= 0 || rect.left >= innerWidth
                ? "outside"
                : rect.top >= 0 &&
                    rect.bottom <= innerHeight &&
                    rect.left >= 0 &&
                    rect.right <= innerWidth
                  ? "fully-visible"
                  : "partly-visible";
        return {
          id: description.id,
          kind: description.kind,
          role:
            element.getAttribute("role") ??
            nativeRoles.get(element.tagName) ??
            "group",
          label: (element.getAttribute("aria-label") ?? "").slice(0, 160),
          parentId: parent?.kontorRegion().id ?? null,
          order,
          viewport: {
            visibility,
            start:
              rect.top < 0
                ? "above"
                : rect.top >= innerHeight
                  ? "below"
                  : rect.top < innerHeight / 3
                    ? "top"
                    : rect.top < (innerHeight * 2) / 3
                      ? "middle"
                      : "bottom",
            horizontal:
              rect.width > (innerWidth * 2) / 3
                ? "wide"
                : (rect.left + rect.right) / 2 < innerWidth / 3
                  ? "left"
                  : (rect.left + rect.right) / 2 < (innerWidth * 2) / 3
                    ? "center"
                    : "right",
          },
          actionIds: actions
            .filter((control) => owner(control.element) === region)
            .map((control) => control.kontorAction().id),
          fieldIds: fields
            .filter((control) => owner(control.element) === region)
            .map((control) => control.kontorField().id),
        };
      }),
    };
  }
  fieldSnapshot() {
    return this.modal
      ? []
      : [...this.fields]
          .filter((f) => f.available())
          .map((f) => f.description());
  }
  blockedSnapshot(): BlockedControl[] {
    if (this.modal) return [];
    const blocked: BlockedControl[] = [];
    for (const control of this.entries) {
      const constraint = control.kontorBlocked();
      if (
        !constraint?.reasons.length ||
        !control.element.disabled ||
        !rendered(control.element)
      )
        continue;
      const action = describeAction(control);
      if (
        [...this.entries].some(
          (other) =>
            other !== control &&
            rendered(other.element) &&
            other.kontorAction().id === action.id,
        )
      )
        throw new Error("Doppelte Bedienelementkennung.");
      blocked.push({ action, ...constraint });
    }
    return blocked.slice(0, 100);
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
          control.element.scrollIntoView({ block: "nearest" });
          execute();
        },
      });
    };
    for (const control of this.entries)
      if (control.available())
        add(describeAction(control), control, () => control.element.click());
    for (const control of this.fields)
      if (control.available()) {
        const field = control.description();
        for (const { value, ...found } of fieldValues(
          field,
          request,
          answers,
          existing,
        ))
          add(
            {
              id: `field:${field.id}:${value}`,
              label: `${field.label} auf ${value} setzen`,
              effect:
                field.current === value
                  ? `${field.label} ist bereits ${value}; ${describeSource(found, value, "de")}`
                  : `${field.label}: ${field.current || "leer"} → ${value}; ${describeSource(found, value, "de")}`,
              kind: field.kind,
              jev: {
                does: `Set ${jevFieldName(field)} to ${value}`,
                now: `${
                  field.current === value
                    ? `value is already ${value}; no change`
                    : `current value ${field.current || "empty"} → ${value}`
                }. Value source: ${describeSource(found, value, "en")}`,
                notFor: field.jev.notFor,
              },
            },
            control,
            () => {
              control.element.focus();
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
function describeAction(control: ActionControl): ActionDescription {
  const description = control.kontorAction();
  const row = control.element.closest("tbody > tr");
  const table = row?.closest("table");
  if (
    !(row instanceof HTMLTableRowElement) ||
    !(table instanceof HTMLTableElement)
  )
    return description;
  const rows = Array.from(table.tBodies)
    .flatMap((body) => Array.from(body.rows))
    .filter(rendered);
  const index = rows.indexOf(row);
  if (index < 0) return description;
  const name = table.getAttribute("aria-label")?.slice(0, 160) || "Tabelle";
  return {
    ...description,
    label: `${description.label} · ${name}, Zeile ${index + 1} von ${rows.length}${index === 0 ? ", erste Zeile" : ""}${index === rows.length - 1 ? ", letzte Zeile" : ""}`,
  };
}
function domOrder(a: { element: HTMLElement }, b: { element: HTMLElement }) {
  return a.element === b.element
    ? 0
    : a.element.compareDocumentPosition(b.element) &
        Node.DOCUMENT_POSITION_FOLLOWING
      ? -1
      : 1;
}
const nativeRoles = new Map([
  ["NAV", "navigation"],
  ["MAIN", "main"],
  ["SECTION", "region"],
  ["ARTICLE", "article"],
  ["TABLE", "table"],
]);
function rendered(element: HTMLElement) {
  return (
    element.isConnected &&
    !element.closest('[inert], [aria-hidden="true"]') &&
    element.checkVisibility({ checkVisibilityCSS: true })
  );
}
function available(element: HTMLInputElement | HTMLButtonElement) {
  return !element.disabled && rendered(element);
}
@Directive({
  selector: "[kontorRegion]",
  host: {
    "[attr.data-region]": "kontorRegion().id",
    "[attr.aria-label]": "kontorRegion().label",
  },
})
export class RegionControl implements OnInit, OnDestroy {
  readonly kontorRegion = input.required<RegionDescription>();
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly registry = inject(ActionRegistry);
  ngOnInit() {
    this.registry.addRegion(this);
  }
  ngOnDestroy() {
    this.registry.removeRegion(this);
  }
}
@Directive({
  selector: "[kontorAction]",
  host: { "(click)": "clicked()", "[attr.data-action]": "kontorAction().id" },
})
export class ActionControl implements OnInit, OnDestroy {
  readonly kontorAction = input.required<ActionDescription>();
  readonly kontorBlocked = input<Omit<BlockedControl, "action">>();
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
  description() {
    return { ...this.kontorField(), current: this.element.value };
  }
  available() {
    return !this.element.readOnly && available(this.element);
  }
}
