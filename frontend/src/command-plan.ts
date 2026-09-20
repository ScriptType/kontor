import type { Goal } from "../../shared/command.js";
import {
  blockers,
  draftOf,
  type CaseDraft,
  type Workspace,
} from "../../shared/domain.js";
export type Question = {
  kind:
    | "case"
    | "minutes"
    | "technician"
    | "order"
    | "unsupported"
    | "evidence"
    | "draft"
    | "schedule"
    | "customer"
    | "persistence";
  message: string;
  options: { id: string; label: string }[];
};
export type Proposal = {
  caseId: string;
  revision: number;
  before: CaseDraft;
  requested: CaseDraft;
  after: CaseDraft;
  message: string;
  alternatives: { id: string; label: string }[];
};
export type Preparation =
  | { kind: "ready"; desired: CaseDraft | null }
  | { kind: "question"; question: Question }
  | { kind: "proposal"; proposal: Proposal };
export function prepareGoal(
  goal: Goal,
  workspace: Workspace,
  approved: Proposal | null,
): Preparation {
  const question = (value: Question): Preparation => ({
    kind: "question",
    question: value,
  });
  if (!goal.supported || !goal.objectives.length)
    return question({
      kind: "unsupported",
      message:
        "Der vollständige Auftrag ist nicht unterstützt oder nicht eindeutig. Im Demo-Modus werden ausschließlich die angezeigten Beispiele ausgeführt. Bitte einen neuen Auftrag formulieren.",
      options: [],
    });
  if (goal.persistence === "unclear")
    return question({
      kind: "persistence",
      message:
        "Soll die Änderung gespeichert werden oder nur als Entwurf bleiben?",
      options: [
        { id: "save", label: "Speichern" },
        { id: "draft", label: "Nur Entwurf" },
      ],
    });
  const needsCase = goal.objectives.some((o) => o.kind !== "filter");
  const selected = workspace.cases.find((c) => c.id === goal.caseId);
  if (needsCase && !selected)
    return question({
      kind: "case",
      message:
        "Welcher Vorgang ist gemeint? Bitte anhand von Kennung und Standort auswählen.",
      options: workspace.cases
        .filter((c) => c.status === "open")
        .map((c) => ({ id: c.id, label: `${c.id} · ${c.title} · ${c.site}` })),
    });
  if (
    goal.order === "listed" &&
    goal.objectives.findIndex((o) => o.kind === "complete") >= 0 &&
    goal.objectives.findIndex((o) => o.kind === "complete") <
      goal.objectives.findIndex((o) => o.kind === "time") &&
    !selected?.minutes
  )
    return question({
      kind: "order",
      message:
        "Der Abschluss benötigt Arbeitszeit. Deine feste Reihenfolge ist so nicht möglich. Darf ich zuerst die angeforderten Minuten erfassen und danach abschließen?",
      options: [
        { id: "reorder", label: "Zeit zuerst erfassen, dann abschließen" },
      ],
    });
  const desired = selected ? draftOf(selected) : null;
  for (const objective of goal.objectives) {
    switch (objective.kind) {
      case "filter":
        if (!objective.customerId)
          return question({
            kind: "customer",
            message: "Für welchen Kunden soll ich filtern?",
            options: workspace.customers.map((c) => ({
              id: c.id,
              label: c.name,
            })),
          });
        break;
      case "assign":
        if (!objective.technicianId)
          return question({
            kind: "technician",
            message: "Wer soll den Vorgang übernehmen?",
            options: workspace.technicians
              .filter((t) => selected && t.skills.includes(selected.skill))
              .map((t) => ({ id: t.id, label: t.name })),
          });
        if (desired) desired.technicianId = objective.technicianId;
        break;
      case "time":
        if (!objective.minutes)
          return question({
            kind: "minutes",
            message:
              "Wie viele tatsächlich geleistete Minuten sollen erfasst werden?",
            options: [],
          });
        if (desired) desired.minutes = objective.minutes;
        break;
      case "schedule":
        if (!objective.appointment)
          return question({
            kind: "schedule",
            message:
              "Welcher Termin ist gewünscht? Bitte Datum, Uhrzeit und Dauer angeben.",
            options: [],
          });
        if (desired) desired.appointment = objective.appointment;
        break;
      case "complete":
        if (desired) desired.status = "done";
        break;
    }
  }
  if (!selected || !desired) return { kind: "ready", desired };
  if (
    approved &&
    approved.revision === workspace.revision &&
    approved.caseId === selected.id
  )
    desired.technicianId = approved.after.technicianId;
  const blocked = blockers(workspace, { ...selected, ...desired });
  const evidence = blocked.find((b) => b.kind === "evidence");
  if (evidence)
    return question({
      kind: "evidence",
      message:
        evidence.message +
        " Den tatsächlichen Prüfbeleg kannst du manuell im Vorgang erfassen. Anschließend ausdrücklich fortsetzen.",
      options: [],
    });
  const time = blocked.find((b) => b.kind === "time");
  if (time)
    return question({
      kind: "minutes",
      message:
        time.message + " Wie viele Minuten wurden tatsächlich gearbeitet?",
      options: [],
    });
  const conflict = blocked.find(
    (b) => b.kind === "conflict" || b.kind === "qualification",
  );
  if (conflict) {
    const alternatives = conflict.alternatives.map((id) => ({
      id,
      label: workspace.technicians.find((t) => t.id === id)?.name ?? id,
    }));
    const first = alternatives[0];
    if (!first)
      return question({
        kind: "schedule",
        message:
          conflict.message +
          " Keine freie qualifizierte Alternative verfügbar. Bitte den Auftrag ändern.",
        options: [],
      });
    return {
      kind: "proposal",
      proposal: {
        caseId: selected.id,
        revision: workspace.revision,
        before: draftOf(selected),
        requested: desired,
        after: { ...desired, technicianId: first.id },
        message:
          conflict.message +
          " Der angeforderte Termin benötigt eine zusätzliche Zuweisung. Andere Vorgänge bleiben unverändert.",
        alternatives,
      },
    };
  }
  return { kind: "ready", desired };
}
