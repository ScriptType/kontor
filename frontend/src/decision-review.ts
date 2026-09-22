import type { Assessment, Decision, DecisionInput } from "../../shared/command";
import type { GatePick } from "./gate";

export interface DecisionCapture {
  input: DecisionInput;
  decision: Decision;
  /** What the gate follows: the choice, and whether it acts without review. */
  pick: GatePick;
  fingerprint: string;
  epoch: number;
  runId: string | null;
  assessments: Readonly<Record<string, Assessment>>;
}
export function catalogFingerprint(input: DecisionInput) {
  return JSON.stringify({
    context: input.context,
    actions: input.actions,
    fields: input.fields,
    blockedControls: input.blockedControls,
    request: input.request,
    answers: input.answers,
    steps: input.steps,
  });
}
export function choiceDescription(choice: string, input: DecisionInput) {
  const action = input.actions.find((action) => action.id === choice);
  if (action) return { label: action.label, effect: action.effect };
  const field = input.fields.find((field) => `ask:${field.id}` === choice);
  if (field)
    return {
      label: `${field.label} erfragen`,
      effect: "Fehlenden Wert ausdrücklich eingeben.",
    };
  switch (choice) {
    case "done":
      return {
        label: "Abschluss prüfen",
        effect:
          "Erfüllung mit einer neuen Entscheidung und eigener Abschlussprüfung prüfen.",
      };
    case "blocked":
      return {
        label: "Als blockiert anhalten",
        effect:
          "Verbleibende Arbeit ist mit den verfügbaren Schritten nicht ausführbar.",
      };
    case "abstain":
      return {
        label: "Bei Unklarheit anhalten",
        effect: "Jev kann keinen sinnvollen nächsten Schritt wählen.",
      };
    default:
      return { label: choice, effect: "Nicht verfügbar." };
  }
}
