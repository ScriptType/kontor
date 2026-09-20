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
type Answer = z.infer<typeof answerSchema>["answers"][string];
function selected(answer: Answer | undefined): string | null {
  return answer && answer.confidence >= 0.75 && answer.choice !== "unclear"
    ? answer.choice
    : null;
}
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
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(questions)) {
      const answer = parsed.data.answers[key];
      if (!answer || !Object.hasOwn(question.options, answer.choice))
        throw new ORPCError("PROVIDER_INVALID_RESPONSE");
      answers[key] = answer;
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
            text: "Welche der von der Anwendung als frei und qualifiziert geprüften Personen soll für den Auftrag in originalRequest als zusätzliche Zuweisung vorgeschlagen werden? Dies ist nur ein Vorschlag zur separaten Freigabe, keine Ausführung.",
            options: {
              unclear: "Kein sicherer Vorschlag",
              ...Object.fromEntries(
                alternatives.map((a) => [
                  a.id,
                  `${a.label}: von der Anwendung als frei und qualifiziert geprüft; zur Freigabe vorschlagen`,
                ]),
              ),
            },
          },
        },
        signal,
      );
      return {
        technicianId: selected(answers["remedy"]),
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
      const state = {
        originalRequest: request,
        references: {
          cases: workspace.cases.map(({ id, title, site, customerId }) => ({
            id,
            title,
            site,
            customerId,
          })),
          technicians: workspace.technicians.map(({ id, name }) => ({
            id,
            name,
          })),
          customers: workspace.customers.map(({ id, name }) => ({
            id,
            name,
          })),
        },
        instructions:
          "Erkenne ausschließlich die Bedeutung des Originalauftrags. Die Referenzen dienen nur zur Identifikation. Ob eine Änderung aktuell ausgeführt werden darf, prüft die Anwendung danach anhand von Arbeitszeit, Prüfbelegen, Qualifikation und Terminkonflikten. Solche Voraussetzungen ändern die angeforderte Absicht nicht. Beurteile jede Frage unabhängig. Keine Teilaufträge übergehen. Keine Werte erfinden. Bei Mehrdeutigkeit unclear wählen. Die Reihenfolge der Zielarten ist filter, assign, schedule, time, complete; beurteile explizite Reihenfolge getrennt.",
      };
      const questions = {
        capability: {
          text: "Enthält originalRequest ausschließlich Aufträge zum Filtern/Anzeigen von Vorgängen, Zuweisen von Personen, Setzen von Terminen, Erfassen von Arbeitszeit oder Abschließen von Vorgängen? Speichern und Entwurf sind dabei zulässige Ausführungsweisen. Fehlende Angaben werden später erfragt.",
          options: {
            yes: "Alle gewünschten Aufgaben sind Filtern, Zuweisen, Termin, Arbeitszeit oder Abschluss. Auch ein reiner Filter oder ein Auftrag mit fehlenden Angaben gehört dazu.",
            no: "Mindestens eine andere Aufgabe wird verlangt, zum Beispiel Daten löschen, exportieren, Nachrichten senden oder Kunden ändern.",
            unclear: "Die angeforderten Aufgaben sind nicht erkennbar.",
          },
        },
        cardinality: {
          text: "Ist originalRequest ein Einzelauftrag? Mehrere verschiedene Änderungen am selben Vorgang sind ein Einzelauftrag. Erst Änderungen an mehreren Vorgängen oder wiederholte unterschiedliche Werte für dieselbe Eigenschaft sind ein Mehrfachauftrag. Ein unbenannter Vorgang und ein Listenfilter sind ebenfalls Einzelaufträge.",
          options: {
            yes: "Höchstens ein Änderungsvorgang und ein Zielwert je Eigenschaft; reine Filter oder fehlende Zielangaben sind ebenfalls zulässig.",
            no: "Änderungen an mehreren Vorgängen oder wiederholte unterschiedliche Zuweisungen, Termine oder Arbeitszeiten werden verlangt.",
            unclear: "Unklar, ob ein ausdrücklicher Mehrfachauftrag vorliegt.",
          },
        },
        persistence: {
          text: "Soll die in originalRequest gewünschte Änderung gespeichert oder nur als Entwurf eingetragen werden? Ein direkter Änderungsauftrag wie weise zu, erfasse oder schließe ab bedeutet save, auch ohne das Wort speichern. Ein ausdrückliches Nicht-speichern oder nur als Entwurf bedeutet draft und hat Vorrang. Bei widersprüchlicher oder unklarer Änderungsabsicht unclear wählen. Fehlende Ausführungsvoraussetzungen ändern diese Speicherabsicht nicht.",
          options: {
            save: "Änderung verbindlich speichern",
            draft: "Nur Entwurf, nicht speichern",
            unclear: "Unklar",
          },
        },
        openOnly: {
          text: "Soll die Anzeige laut originalRequest auf offene Vorgänge beschränkt werden?",
          options: {
            yes: "Nur offene Vorgänge anzeigen.",
            no: "Keine Beschränkung der Anzeige auf offene Vorgänge verlangt.",
            unclear: "Statusfilter widersprüchlich.",
          },
        },
        filter: {
          text: "Wird in originalRequest verlangt, die Vorgangsliste zu filtern oder Vorgänge eines Kunden anzuzeigen? Die bloße Nennung eines Kunden als Teil einer Vorgangsidentifikation ist kein Filterauftrag.",
          options: {
            yes: "Vorgänge nach Kunde oder offenem Status filtern/anzeigen.",
            no: "Keine Filterung oder kundenbezogene Anzeige verlangt.",
            unclear: "Unklar, ob eine Filterung gewünscht ist.",
          },
        },
        assign: {
          text: "Wird in originalRequest eine Zuweisung oder Änderung der zuständigen Person für einen Vorgang verlangt? Auch ohne konkrete Person zählt dies als Zuweisungsauftrag.",
          options: {
            yes: "Eine Person soll einem Vorgang zugewiesen werden.",
            no: "Keine Zuweisung einer Person verlangt.",
            unclear: "Unklar, ob eine Zuweisung gewünscht ist.",
          },
        },
        schedule: {
          text: "Wird in originalRequest ein Termin für einen Vorgang gesetzt oder geändert? Auch ein Terminauftrag ohne Datum zählt; geleistete Arbeitszeit ist kein Termin.",
          options: {
            yes: "Einen Termin planen, setzen oder ändern.",
            no: "Keine Terminplanung verlangt.",
            unclear: "Unklar, ob ein Termin gewünscht ist.",
          },
        },
        time: {
          text: "Soll laut originalRequest Arbeitszeit eingetragen werden? Das gilt auch für einen Entwurf ohne Speichern und für einen Auftrag ohne Minutenzahl. Termindauer zählt nicht als Arbeitszeit.",
          options: {
            yes: "Arbeitszeit oder Arbeitsminuten eintragen, auch als Entwurf.",
            no: "Keine geleistete Arbeitszeit erfassen.",
            unclear: "Unklar, ob Arbeitszeit erfasst werden soll.",
          },
        },
        complete: {
          text: "Wird in originalRequest verlangt, einen Vorgang abzuschließen oder als erledigt zu markieren? Fehlende Voraussetzungen ändern diese Absicht nicht.",
          options: {
            yes: "Vorgang abschließen oder erledigen.",
            no: "Kein Abschluss eines Vorgangs verlangt.",
            unclear: "Unklar, ob ein Abschluss gewünscht ist.",
          },
        },
        case: {
          text: "Welcher einzelne Vorgang aus references.cases ist durch originalRequest eindeutig identifiziert? Stimmen mehrere Referenzen mit der Bezeichnung überein oder fehlt die Bezeichnung, wähle unclear.",
          options: {
            unclear: "Fehlend oder mehrdeutig",
            ...Object.fromEntries(
              workspace.cases.map((c) => [
                c.id,
                `${c.id} ${c.title} · ${c.site}`,
              ]),
            ),
          },
        },
        technician: {
          text: "Welche Person aus references.technicians ist in originalRequest ausdrücklich als Ziel der Zuweisung genannt?",
          options: {
            unclear: "Fehlend oder mehrdeutig",
            ...Object.fromEntries(
              workspace.technicians.map((t) => [t.id, t.name]),
            ),
          },
        },
        customer: {
          text: "Welcher Kunde aus references.customers ist in originalRequest zum Filtern genannt?",
          options: {
            unclear: "Fehlend oder mehrdeutig",
            ...Object.fromEntries(
              workspace.customers.map((c) => [c.id, c.name]),
            ),
          },
        },
        workMinutes: {
          text: "Welche in originalRequest wörtlich genannte Minutenzahl ist ausschließlich als geleistete Arbeitszeit bestimmt?",
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
          text: "Welche in originalRequest wörtlich genannte Minutenzahl ist ausschließlich als geplante Termindauer bestimmt?",
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
          text: "Welcher in originalRequest wörtlich genannte Zeitpunkt ist der gewünschte Termin?",
          options: {
            unclear: "Fehlend oder mehrdeutig",
            ...Object.fromEntries(slots.map((s) => [s, s])),
          },
        },
        order: {
          text: "Fordert originalRequest ausdrücklich eine andere Reihenfolge als Filtern, Zuweisen, Termin, Arbeitszeit, Abschluss?",
          options: {
            yes: "Ja, zuerst abschließen dann Zeit erfassen",
            no: "Keine feste Reihenfolge oder dieselbe Reihenfolge wie Filtern, Zuweisen, Termin, Arbeitszeit, Abschluss",
            unclear: "Andere ausdrückliche Reihenfolge oder unklar",
          },
        },
      };
      const kinds = ["filter", "assign", "schedule", "time", "complete"];
      const classificationKeys = ["capability", "cardinality", ...kinds];
      const classification = await ask(
        JSON.stringify({ originalRequest: request }),
        Object.fromEntries(
          Object.entries(questions).filter(([key]) =>
            classificationKeys.includes(key),
          ),
        ),
        signal,
      );
      const requested = kinds.filter(
        (key) => selected(classification[key]) === "yes",
      );
      if (
        selected(classification["capability"]) !== "yes" ||
        selected(classification["cardinality"]) !== "yes" ||
        requested.length === 0
      )
        return {
          request,
          caseId: null,
          objectives: [],
          persistence: "unclear",
          order: "flexible",
          supported: false,
        };
      const slotKeys = new Set<string>();
      if (requested.some((kind) => kind !== "filter")) {
        slotKeys.add("case");
        slotKeys.add("persistence");
      }
      if (requested.includes("filter")) {
        slotKeys.add("customer");
        slotKeys.add("openOnly");
      }
      if (requested.includes("assign")) slotKeys.add("technician");
      if (requested.includes("schedule")) {
        slotKeys.add("slot");
        slotKeys.add("appointmentMinutes");
      }
      if (requested.includes("time")) slotKeys.add("workMinutes");
      if (requested.length > 1) slotKeys.add("order");
      const slotsAnswers = await ask(
        JSON.stringify({ ...state, requestedKinds: requested }),
        {
          ...Object.fromEntries(
            Object.entries(questions).filter(([key]) => slotKeys.has(key)),
          ),
          coverage: {
            text: "Decken requestedKinds alle in originalRequest gewünschten Zielarten vollständig ab? filter bedeutet Vorgänge filtern/anzeigen, assign eine Person zuweisen, schedule einen Termin setzen, time Arbeitszeit erfassen, complete einen Vorgang abschließen. Speichern/Entwurf sind Ausführungsweisen, keine eigene Zielart. Fehlende Zielwerte sind erlaubt. Jede im Auftrag gewünschte Zielart muss enthalten sein; keine zusätzliche Zielart darf enthalten sein.",
            options: {
              complete:
                "Die ausgewählten Zielarten stimmen vollständig mit dem gesamten Auftrag überein.",
              mismatch:
                "Mindestens eine gewünschte Zielart fehlt oder eine nicht gewünschte Zielart ist enthalten.",
              unclear: "Die vollständige Übereinstimmung ist unklar.",
            },
          },
        },
        signal,
      );
      const answers = { ...classification, ...slotsAnswers };
      const objectives: Objective[] = [];
      const value = (key: string) => selected(answers[key]);
      if (value("filter") === "yes")
        objectives.push({
          kind: "filter",
          customerId: value("customer"),
          openOnly: value("openOnly") === "yes",
        });
      if (value("assign") === "yes")
        objectives.push({
          kind: "assign",
          technicianId: value("technician"),
        });
      const slot = value("slot"),
        appointmentMinutes = value("appointmentMinutes");
      if (value("schedule") === "yes")
        objectives.push({
          kind: "schedule",
          appointment:
            slot && appointmentMinutes
              ? { start: slot, minutes: Number(appointmentMinutes) }
              : null,
        });
      if (value("order") === "yes" && value("complete") === "yes")
        objectives.push({ kind: "complete" });
      if (value("time") === "yes")
        objectives.push({
          kind: "time",
          minutes: value("workMinutes") ? Number(value("workMinutes")) : null,
        });
      if (value("complete") === "yes" && value("order") !== "yes")
        objectives.push({ kind: "complete" });
      return {
        request,
        caseId: objectives.some((objective) => objective.kind !== "filter")
          ? value("case")
          : null,
        objectives,
        persistence:
          value("persistence") === "save"
            ? "save"
            : value("persistence") === "draft"
              ? "draft"
              : "unclear",
        order: value("order") === "yes" ? "listed" : "flexible",
        supported:
          !(value("filter") === "yes" && value("openOnly") === null) &&
          (objectives.length < 2 || value("order") !== null) &&
          value("coverage") === "complete" &&
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
        actionId: selected(answer["next"]),
      };
    },
  };
}
