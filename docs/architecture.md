# Architektur der Grundinstallation

Das Projekt erprobt TypeSafe mit Angular und typisierten RPC-Aufrufen. Ein gemeinsamer Vertrag beschreibt Eingaben, Ergebnisse und Fehler. Das Backend hält den API-Key und übersetzt die TypeSafe-Antworten in diesen Vertrag.

## Ein Repository, ein Paket

`frontend/` enthält Angular, `server/` enthält Hono und die TypeSafe-Anbindung. `shared/` enthält den API-Vertrag. Eine `package.json` und eine Lockdatei verwalten das Projekt. Es gibt keine separat veröffentlichten Pakete und kein zusätzliches Monorepo-Werkzeug.

Angular läuft mit Standalone-Komponenten und Signals. Der oRPC-Client liefert Promises. Für den ersten Aufruf brauchen wir weder einen globalen Store noch eine zusätzliche Query-Bibliothek.

## Warum oRPC

Recherche vom 20. September 2026. Die Veröffentlichungsdaten stammen aus der npm-Registry.

| Bibliothek | Geprüfte Version | Veröffentlicht | Einordnung |
| --- | --- | --- | --- |
| [oRPC](https://orpc.dev/docs/contract-first) | 2.0.0-beta.37 | 19.09.2026 | Typisierte Prozeduren, eigenständige Verträge, deklarierte Fehler und später OpenAPI oder Streams. Die Beta der Version 2 ist gewählt. |
| [tRPC](https://trpc.io/docs/client/vanilla) | 11.19.0 | 16.09.2026 | Ebenfalls echte Prozeduraufrufe. Der frameworkunabhängige Client funktioniert auch mit Angular. Gute Alternative. |
| [Elysia/Eden](https://elysiajs.com/eden/overview) | Elysia 1.4.30, Eden 1.4.9 | 26.08.2026, 31.03.2026 | Typisierter Zugriff auf HTTP-Routen. Interessant für ein Elysia-Projekt, weniger passend zum gewünschten Prozedurmodell. |

oRPC gewinnt durch den eigenständigen Vertrag und die Erweiterungsmöglichkeiten. tRPC kann Backend-Typen ebenfalls ausschließlich als Typen importieren. Ein solcher Import liefert keinen Backend-Code an den Browser aus. Der unabhängige Vertrag ist hier eine Entscheidung über die Zuständigkeit im Code.

Alle verglichenen Projekte veröffentlichen weiterhin Pakete. Die aktuelle Aktivität ist ein positives Signal, keine Garantie für ihre Zukunft. Die geprüften Paketdaten stehen in der Registry für [oRPC](https://registry.npmjs.org/@orpc/server), [tRPC](https://registry.npmjs.org/@trpc/client), [Elysia](https://registry.npmjs.org/elysia) und [Eden](https://registry.npmjs.org/@elysiajs/eden).

Client, Vertrag und Server verwenden exakt `2.0.0-beta.37`. Die [Dokumentation zu Version 2](https://orpc.dev/docs/getting-started) gilt für dieses Projekt. Der Clienttyp heißt `RouterContractClient`. Die Beta kann weitere API-Änderungen erhalten. Updates aller oRPC-Pakete erfolgen gemeinsam, da Version 1 und Version 2 unterschiedliche Übertragungsformate verwenden. [Migrationshinweise](https://orpc.dev/docs/migrations/from-v1).

## Backend und Laufzeit

[Hono](https://hono.dev/docs/getting-started/nodejs) stellt den HTTP-Server bereit. Der [oRPC-Adapter](https://orpc.dev/docs/adapters/hono) verarbeitet die Prozeduraufrufe. Node 24 passt sowohl zur Angular-Werkzeugkette als auch zur dokumentierten Laufzeit des [offiziellen TypeSafe-SDKs](https://docs.typesafe.ai/sdk/javascript).

Angular 22 benötigt TypeScript 6.0. Das Projekt verwendet deshalb nicht ungeprüft die neueste TypeScript-Hauptversion. Die [Angular-Kompatibilitätstabelle](https://angular.dev/reference/versions) beschreibt diese Bindung.

## Daten und Grenzen

`evaluate({ text })` liefert eine Auswertung mit Choice, Score und Noul. Das Ergebnis kennzeichnet den Demo- oder Live-Modus. Eingaben und externe Antworten werden an den Schnittstellen mit Zod geprüft. Der Browser erhält weder den API-Key noch rohe Fehlerantworten des Anbieters.

Der Demo-Modus zeigt feste Beispieldaten. Er bewertet den eingegebenen Text nicht. Der Live-Modus erfordert eine ausdrückliche Konfiguration und einen API-Key. Ein fehlgeschlagener Live-Aufruf liefert einen Fehler und wechselt nicht zum Demo-Ergebnis.

Choice liefert eine Auswahl, Wahrscheinlichkeiten und Confidence. Score liefert einen Erwartungswert auf einer geordneten Skala, der zwischen zwei Stufen liegen kann. Noul liefert die Wahrscheinlichkeit für Ja und keine zusätzliche Confidence. Die Oberfläche hält diese Größen auseinander. [TypeSafe-Primitiven](https://docs.typesafe.ai/primitives).

Die Fragen eines Aufrufs bewerten denselben Zustand unabhängig. Eine Frage kann in diesem Aufruf keine vorherige Antwort verwenden. Regeln, die Ergebnisse kombinieren, gehören in den Anwendungscode. [TypeSafe-Einführung](https://docs.typesafe.ai/introduction).

Persistenz, Hintergrundaufträge, Anmeldung und Live-Updates folgen aus dem späteren Fachthema. [Mögliche Anwendungen](use-cases.md) beschreiben die nächsten Optionen.
