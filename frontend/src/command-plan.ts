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
    | "persistence"
    | "filter_scope";
  message: string;
  options: { id: string; label: string }[];
};
export type Proposal = {
  caseId: string;
  revision: number;
  before: CaseDraft;
  requested: CaseDraft;
  after: Omit<CaseDraft, "technicianId"> & { technicianId: string | null };
  message: string;
  alternatives: { id: string; label: string }[];
};
export type GoalReview = {
  revision: number;
  request: string;
  summary: string[];
};
export type Preparation =
  | { kind: "review"; review: GoalReview }
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
  if (goal.readiness.kind === "refused" || !goal.objectives.length)
    return question({
      kind: "unsupported",
      message:
        "Der vollständige Auftrag ist nicht unterstützt oder nicht eindeutig. Im Demo-Modus werden ausschließlich die angezeigten Beispiele ausgeführt. Bitte einen neuen Auftrag formulieren.",
      options: [],
    });
  const needsCase = goal.objectives.some((o) => o.kind !== "filter");
  if (needsCase && goal.persistence === "unclear")
    return question({
      kind: "persistence",
      message:
        "Soll die Änderung gespeichert werden oder nur als Entwurf bleiben?",
      options: [
        { id: "save", label: "Speichern" },
        { id: "draft", label: "Nur Entwurf" },
      ],
    });
  const selected = needsCase
    ? workspace.cases.find((c) => c.id === goal.caseId)
    : undefined;
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
        if (!workspace.customers.some((c) => c.id === objective.customerId))
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
        if (
          !objective.technicianId ||
          !workspace.technicians.some((t) => t.id === objective.technicianId)
        )
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
  if (goal.readiness.kind === "review") {
    const summary: string[] = [];
    if (selected)
      summary.push(
        `${selected.id} · ${selected.title} · ${workspace.customers.find((c) => c.id === selected.customerId)?.name ?? selected.customerId} · ${selected.site}`,
      );
    for (const objective of goal.objectives) {
      switch (objective.kind) {
        case "filter":
          summary.push(
            `${objective.openOnly ? "Offene" : "Alle"} Vorgänge von ${workspace.customers.find((c) => c.id === objective.customerId)?.name ?? objective.customerId} anzeigen.`,
          );
          break;
        case "assign":
          summary.push(
            `${workspace.technicians.find((t) => t.id === objective.technicianId)?.name ?? objective.technicianId} zuweisen.`,
          );
          break;
        case "schedule":
          summary.push(
            `Termin am ${objective.appointment?.start.replace("T", " ")} für ${objective.appointment?.minutes} Minuten setzen.`,
          );
          break;
        case "time":
          summary.push(
            `${objective.minutes} Minuten tatsächlich geleistete Arbeitszeit erfassen.`,
          );
          break;
        case "complete":
          summary.push("Vorgang abschließen.");
          break;
      }
    }
    if (goal.objectives.length > 1)
      summary.push(
        goal.order === "listed"
          ? "Angegebene Reihenfolge einhalten."
          : "Reihenfolge nach fachlichen Voraussetzungen.",
      );
    summary.push(
      needsCase
        ? goal.persistence === "save"
          ? "Änderungen speichern."
          : "Nur als Entwurf vorbereiten. Nicht speichern."
        : "Keine Daten speichern.",
    );
    return {
      kind: "review",
      review: { revision: workspace.revision, request: goal.request, summary },
    };
  }
  if (!selected || !desired) return { kind: "ready", desired };
  if (
    approved &&
    approved.revision === workspace.revision &&
    approved.caseId === selected.id &&
    approved.after.technicianId !== null
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
