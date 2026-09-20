import { TypeSafeClient, choice, type Fetch } from "@typesafe-ai/sdk";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
  demoGoal,
  type Goal,
  type Objective,
  type decisionInputSchema,
} from "../shared/command.js";
import type { Workspace } from "../shared/domain.js";
import type { Config } from "./config.js";
const answerSchema = z.object({
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export function createJev(config: Config, fetch?: Fetch) {
  const client =
    config.mode === "live"
      ? new TypeSafeClient({
          apiKey: config.apiKey,
          defaultModel: config.model,
          baseURL: "https://api.typesafe.ai",
          retry: { maxRetries: 0 },
          timeout: 10000,
          logLevel: "off",
          fetch,
        })
      : null;
  async function ask(
    state: string,
    questions: Record<
      string,
      { text: string; options: Record<string, string> }
    >,
    signal?: AbortSignal,
  ) {
    if (!client) throw new Error("Live client missing");
    let raw: unknown;
    try {
      raw = await client.systemOne(
        {
          state,
          questions: Object.fromEntries(
            Object.entries(questions).map(([key, q]) => [
              key,
              choice(q.text, q.options),
            ]),
          ),
        },
        { signal },
      );
    } catch {
      throw new ORPCError("PROVIDER_UNAVAILABLE", {
        message:
          "Jev ist nicht erreichbar. Es wurde keine Entscheidung ausgeführt.",
      });
    }
    const parsed = answerSchema.safeParse(raw);
    if (!parsed.success) throw new ORPCError("PROVIDER_INVALID_RESPONSE");
    const answers: Record<string, string> = {};
    for (const [key, question] of Object.entries(questions)) {
      const answer = parsed.data.answers[key];
      if (!answer || !Object.hasOwn(question.options, answer.choice))
        throw new ORPCError("PROVIDER_INVALID_RESPONSE");
      answers[key] = answer.confidence >= 0.75 ? answer.choice : "unclear";
    }
    return answers;
  }
  return {
    async remedy(
      request: string,
      alternatives: { id: string; label: string }[],
      context: string,
      signal?: AbortSignal,
    ) {
      if (!client) return { technicianId: alternatives[0]?.id ?? null };
      const answers = await ask(
        JSON.stringify({
          originalRequest: request,
          context,
          instruction:
            "Nur einen konkreten Vorschlag auswählen. Keine Änderung ausführen. Der Benutzer muss die zusätzliche Zuweisung separat freigeben.",
        }),
        {
          remedy: {
            text: "Welche freie qualifizierte Person ist als konkrete zusätzliche Zuweisung vorzuschlagen?",
            options: {
              unclear: "Kein sicherer Vorschlag",
              ...Object.fromEntries(alternatives.map((a) => [a.id, a.label])),
            },
          },
        },
        signal,
      );
      return {
        technicianId:
          answers["remedy"] && answers["remedy"] !== "unclear"
            ? answers["remedy"]
            : null,
      };
    },
    async interpret(
      request: string,
      workspace: Workspace,
      signal?: AbortSignal,
    ): Promise<Goal> {
      if (!client) return demoGoal(request);
      const minuteValues = [
        ...request.matchAll(/\b(\d{1,4})\s*(?:Minuten|min)\b/gi),
      ]
        .map((m) => Number(m[1]))
        .filter((n) => n > 0);
      const dates = [...request.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(
        (m) => m[1],
      );
      const times = [...request.matchAll(/\b(\d{2}:\d{2})\b/g)].map(
        (m) => m[1],
      );
      const slots = dates.flatMap((date) =>
        times.map((time) => `${date}T${time}:00`),
      );
      const yesNo = {
        yes: "Ausdrücklich angefordert",
        no: "Nicht angefordert",
        unclear: "Unklar",
      };
      const answers = await ask(
        JSON.stringify({
          originalRequest: request,
          workspace,
          instructions:
            "Beurteile jede Frage unabhängig. Keine Teilaufträge übergehen. Keine Werte erfinden. Bei Mehrdeutigkeit unclear wählen. Die Reihenfolge der Zielarten ist filter, assign, schedule, time, complete; beurteile explizite Reihenfolge getrennt.",
        }),
        {
          supported: {
            text: "Ist der vollständige Auftrag mit Filtern, Zuweisen, Termin setzen, vorgegebene Minuten erfassen und Abschließen erfüllbar? Unterstützt ist genau ein Zielvorgang und höchstens ein Ziel je Art. Mehrere Vorgänge, wiederholte unterschiedliche Zuweisungen oder zusätzliche/verbotene Änderungen machen den GESAMTEN Auftrag nicht unterstützt. Dann no wählen; bei fehlender Klarheit unclear.",
            options: yesNo,
          },
          persistence: {
            text: "Soll die gewünschte Änderung gespeichert oder nur als Entwurf eingetragen werden? Ein ausdrückliches Nicht-speichern bedeutet draft.",
            options: {
              save: "Änderung verbindlich speichern",
              draft: "Nur Entwurf, nicht speichern",
              unclear: "Unklar",
            },
          },
          openOnly: {
            text: "Fordert der Auftrag ausdrücklich nur offene Vorgänge?",
            options: yesNo,
          },
          filter: { text: "Vorgänge nach Kunde anzeigen?", options: yesNo },
          assign: { text: "Eine Person zuweisen?", options: yesNo },
          schedule: { text: "Einen Termin setzen?", options: yesNo },
          time: { text: "Arbeitsminuten erfassen?", options: yesNo },
          complete: { text: "Vorgang abschließen?", options: yesNo },
          case: {
            text: "Welcher einzelne Vorgang ist eindeutig gemeint?",
            options: {
              unclear: "Fehlend oder mehrdeutig",
              ...Object.fromEntries(
                workspace.cases.map((c) => [c.id, `${c.id} ${c.title}`]),
              ),
            },
          },
          technician: {
            text: "Welche Person ist ausdrücklich als Ziel genannt?",
            options: {
              unclear: "Fehlend oder mehrdeutig",
              ...Object.fromEntries(
                workspace.technicians.map((t) => [t.id, t.name]),
              ),
            },
          },
          customer: {
            text: "Welcher Kunde ist zum Filtern genannt?",
            options: {
              unclear: "Fehlend oder mehrdeutig",
              ...Object.fromEntries(
                workspace.customers.map((c) => [c.id, c.name]),
              ),
            },
          },
          workMinutes: {
            text: "Welche wörtlich genannte Minutenzahl ist ausschließlich als geleistete Arbeitszeit bestimmt?",
            options: {
              unclear: "Fehlend oder mehrdeutig",
              ...Object.fromEntries(
                minuteValues.map((n) => [
                  String(n),
                  `${n} Minuten aus Originalauftrag`,
                ]),
              ),
            },
          },
          appointmentMinutes: {
            text: "Welche wörtlich genannte Minutenzahl ist ausschließlich als geplante Termindauer bestimmt?",
            options: {
              unclear: "Fehlend oder mehrdeutig",
              ...Object.fromEntries(
                minuteValues.map((n) => [
                  String(n),
                  `${n} Minuten aus Originalauftrag`,
                ]),
              ),
            },
          },
          slot: {
            text: "Welcher wörtlich genannte Zeitpunkt ist der gewünschte Termin?",
            options: {
              unclear: "Fehlend oder mehrdeutig",
              ...Object.fromEntries(slots.map((s) => [s, s])),
            },
          },
          order: {
            text: "Fordert der Auftrag ausdrücklich den Abschluss VOR dem Erfassen der Arbeitszeit?",
            options: {
              yes: "Ja, zuerst abschließen dann Zeit erfassen",
              no: "Nein, keine solche feste Reihenfolge",
              unclear: "Andere ausdrückliche Reihenfolge oder unklar",
            },
          },
        },
        signal,
      );
      const objectives: Objective[] = [];
      const selected = (key: string) =>
        answers[key] && answers[key] !== "unclear" ? answers[key] : null;
      if (answers["filter"] === "yes")
        objectives.push({
          kind: "filter",
          customerId: selected("customer"),
          openOnly: answers["openOnly"] === "yes",
        });
      if (answers["assign"] === "yes")
        objectives.push({
          kind: "assign",
          technicianId: selected("technician"),
        });
      const slot = selected("slot"),
        appointmentMinutes = selected("appointmentMinutes");
      if (answers["schedule"] === "yes")
        objectives.push({
          kind: "schedule",
          appointment:
            slot && appointmentMinutes
              ? { start: slot, minutes: Number(appointmentMinutes) }
              : null,
        });
      if (answers["order"] === "yes" && answers["complete"] === "yes")
        objectives.push({ kind: "complete" });
      if (answers["time"] === "yes")
        objectives.push({
          kind: "time",
          minutes: selected("workMinutes")
            ? Number(selected("workMinutes"))
            : null,
        });
      if (answers["complete"] === "yes" && answers["order"] !== "yes")
        objectives.push({ kind: "complete" });
      return {
        request,
        caseId: selected("case"),
        objectives,
        persistence:
          answers["persistence"] === "save"
            ? "save"
            : answers["persistence"] === "draft"
              ? "draft"
              : "unclear",
        order: answers["order"] === "yes" ? "listed" : "flexible",
        supported:
          answers["supported"] === "yes" &&
          answers["order"] !== "unclear" &&
          !["filter", "assign", "schedule", "time", "complete"].some(
            (key) => answers[key] === "unclear",
          ) &&
          objectives.length > 0,
      };
    },
    async decide(
      input: z.infer<typeof decisionInputSchema>,
      signal?: AbortSignal,
    ) {
      if (!client)
        return {
          snapshotId: input.snapshotId,
          actionId: input.actions.some((a) => a.id === input.expectedDemoAction)
            ? input.expectedDemoAction
            : null,
        };
      const answer = await ask(
        JSON.stringify({
          originalRequest: input.request,
          context: input.context,
          instructions:
            "Wähle nur den nächsten sichtbaren, erlaubten Schritt zum vollständigen Ziel. Keine zusätzliche Änderung ohne konkrete Freigabe. Blocker sind keine Aktionen.",
        }),
        {
          next: {
            text: "Welches aktuell zugängliche Bedienelement führt den nächsten erlaubten Schritt aus?",
            options: {
              unclear: "Warten, kein sicherer Schritt",
              ...Object.fromEntries(
                input.actions.map((a) => [a.id, `${a.label}. ${a.effect}`]),
              ),
            },
          },
        },
        signal,
      );
      return {
        snapshotId: input.snapshotId,
        actionId:
          answer["next"] && answer["next"] !== "unclear"
            ? answer["next"]
            : null,
      };
    },
  };
}
