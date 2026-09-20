# Architektur der Grundinstallation

Das Projekt erprobt TypeSafe mit Angular und typisierten RPC-Aufrufen. Ein gemeinsamer Vertrag beschreibt Eingaben, Ergebnisse und Fehler. Das Backend hält den API-Key und übersetzt die TypeSafe-Antworten in diesen Vertrag.

## Ein Repository, ein Paket

`frontend/` enthält Angular, `server/` enthält Hono und die TypeSafe-Anbindung. `shared/` enthält den API-Vertrag. Eine `package.json` und eine Lockdatei verwalten das Projekt. Es gibt keine separat veröffentlichten Pakete und kein zusätzliches Monorepo-Werkzeug.

Angular läuft mit Standalone-Komponenten und Signals. TanStack Query verwaltet Serverdaten und Mutationen. oRPC erzeugt die typisierten Query-Optionen aus dem gemeinsamen Vertrag.

## Warum oRPC

Recherche vom 20. September 2026. Die Veröffentlichungsdaten stammen aus der npm-Registry.

| Bibliothek | Geprüfte Version | Veröffentlicht | Einordnung |
| --- | --- | --- | --- |
| [oRPC](https://orpc.dev/docs/contract-first) | 2.0.0-beta.37 | 19.09.2026 | Typisierte Prozeduren, eigenständige Verträge, deklarierte Fehler und später OpenAPI oder Streams. Die Beta der Version 2 ist gewählt. |
| [tRPC](https://trpc.io/docs/client/vanilla) | 11.19.0 | 16.09.2026 | Ebenfalls echte Prozeduraufrufe. Der frameworkunabhängige Client funktioniert auch mit Angular. Gute Alternative. |
| [Elysia/Eden](https://elysiajs.com/eden/overview) | Elysia 1.4.30, Eden 1.4.9 | 26.08.2026, 31.03.2026 | Typisierter Zugriff auf HTTP-Routen. Interessant für ein Elysia-Projekt, weniger passend zum gewünschten Prozedurmodell. |

oRPC gewinnt durch den eigenständigen Vertrag und die Erweiterungsmöglichkeiten. tRPC kann Backend-Typen ebenfalls ausschließlich als Typen importieren. Ein solcher Import liefert keinen Backend-Code an den Browser aus. Der unabhängige Vertrag ist hier eine Entscheidung über die Zuständigkeit im Code.

Alle verglichenen Projekte veröffentlichen weiterhin Pakete. Die aktuelle Aktivität ist ein positives Signal, keine Garantie für ihre Zukunft. Die geprüften Paketdaten stehen in der Registry für [oRPC](https://registry.npmjs.org/@orpc/server), [tRPC](https://registry.npmjs.org/@trpc/client), [Elysia](https://registry.npmjs.org/elysia) und [Eden](https://registry.npmjs.org/@elysiajs/eden).

Client, Vertrag, Server und TanStack-Integration verwenden exakt `2.0.0-beta.37`. Die [Dokumentation zu Version 2](https://orpc.dev/docs/getting-started) gilt für dieses Projekt. Der Clienttyp heißt `RouterContractClient`. Die Beta kann weitere API-Änderungen erhalten. Updates aller oRPC-Pakete erfolgen gemeinsam, da Version 1 und Version 2 unterschiedliche Übertragungsformate verwenden. [Migrationshinweise](https://orpc.dev/docs/migrations/from-v1).

## TanStack Query über WebSockets

TanStack Query akzeptiert asynchrone Funktionen, die Promises liefern. Der Transport muss kein HTTP-Client sein. Die [Angular-Dokumentation](https://tanstack.com/query/latest/docs/framework/angular/angular-httpclient-and-other-data-fetching-clients) beschreibt diese Trennung. Hier liefert der WebSocket-Client von oRPC die Promises.

| Aufgabe | TanStack Query mit oRPC | Angular Resource |
| --- | --- | --- |
| Lesen | `injectQuery` mit generierten `queryOptions` | `resource` mit eigenem Loader |
| Auswertung auslösen | `injectMutation` mit generierten `mutationOptions` | Separate Mutation und Zustandsverwaltung nötig |
| Cache und Invalidierung | Query-Keys und QueryClient vorhanden | Zusätzliche gemeinsame Verwaltung nötig |
| Debugging | Query- und Mutation-Devtools | Angular-Werkzeuge und eigener Zustand |
| Spätere Server-Streams | oRPC `liveOptions` oder `streamedOptions` | Eigener Adapter zum Resource-Stream |

TanStack Query passt zur gewünschten Developer Experience und zum vorhandenen Angular-Wissen. `createTanstackQueryUtils` liefert Keys, Eingabe-, Ergebnis- und deklarierte Fehlertypen. Es entfällt ein separater API-Service pro Feature. Ein gemeinsamer injizierter Client reicht. Die [oRPC-Integration](https://orpc.dev/docs/integrations/tanstack-query) beschreibt auch Invalidierung und Streams.

Der Angular-Adapter ist experimentell und auf `5.103.1` festgelegt. Die Devtools werden nur im Entwicklungsmodus geladen. Ein Update muss zusammen mit oRPC durch die Typ- und Laufzeittests. [TanStack Angular Query](https://tanstack.com/query/latest/docs/framework/angular/overview).

## Verbindung und Lebensdauer

Angular öffnet den WebSocket bei Bedarf unter derselben Origin am Pfad `/rpc`. Gleichzeitige Aufrufe teilen eine Verbindung. Bei HTTPS verwendet der Client `wss:`. Der Backend-Server akzeptiert dort ausschließlich WebSocket-Upgrades für RPC. Es gibt keinen Fetch-Handler für Prozeduren.

oRPC übernimmt Serialisierung, Zuordnung paralleler Antworten, Fehler und Abbruchsignale. `frontend/src/rpc-connection.ts` wählt über den offiziellen `DynamicLink` den aktuellen WebSocket-Link. Nach einem geschlossenen Socket erhält erst der nächste Aufruf eine neue Verbindung. Der Angular-Injector schließt die Verbindung beim Abbau. [WebSocket-Adapter](https://orpc.dev/docs/adapters/websocket), [DynamicLink](https://orpc.dev/docs/client/dynamic-link).

Der Verbindungsaufbau hat ein Zeitlimit von drei Sekunden, ein einzelner Aufruf von 15 Sekunden. Es gibt keine Wiederholung laufender Mutationen und keine endlose Wiederverbindung im Hintergrund. Die native Wiederverbindung von oRPC beta.37 bleibt deaktiviert. Ihr begrenzter Versuchszähler bleibt nach vollständigem Fehlschlag ausgeschöpft; ein unbegrenzter Versuch läuft über den Abbruch eines einzelnen Aufrufs hinaus. Der nächste Aufruf bekommt deshalb bei Bedarf einen frischen Link.

Der Server prüft bei Browser-Verbindungen den Origin-Host gegen den angefragten Host. Der Angular-Proxy behält deshalb den ursprünglichen Host bei. WebSocket-Nachrichten sind auf 256 KiB begrenzt; die Textvalidierung erlaubt weiterhin höchstens 20.000 Zeichen.

TanStack reicht Abbruchsignale von Queries über oRPC an den Server weiter. Das Abbrechen einer Anfrage beweist nicht, dass eine bereits gestartete Anbieteroperation rückgängig gemacht wurde. Ein Verbindungsverlust kann daher ein unbekanntes Ergebnis hinterlassen. Neue Auswertungen erfolgen durch eine ausdrückliche Benutzeraktion.

Die Infrastruktur trägt später auch oRPC-Iteratoren. `liveOptions` hält den letzten Wert, `streamedOptions` sammelt Werte. Ein konkretes Fachfeature muss dafür Wiederanlauf, Event-Lücken und Zeitlimits festlegen. Die Grundinstallation enthält noch keinen fachlichen Stream.

## Backend und Laufzeit

[Hono](https://hono.dev/docs/getting-started/nodejs) liefert die statische Angular-Anwendung über seinen Node-Adapter aus. `ws` und der offizielle oRPC-WebSocket-Adapter verarbeiten die Prozeduraufrufe am selben Port. Node 24 passt sowohl zur Angular-Werkzeugkette als auch zur dokumentierten Laufzeit des [offiziellen TypeSafe-SDKs](https://docs.typesafe.ai/sdk/javascript).

HTTP bleibt für HTML, Assets und den WebSocket-Handshake erforderlich. Das TypeSafe-SDK verwendet vom Backend aus die HTTPS-API des Anbieters. Die ausschließliche WebSocket-Kommunikation gilt für die Anwendungsaufrufe zwischen Angular und Backend.

Angular 22 benötigt TypeScript 6.0. Das Projekt verwendet deshalb nicht ungeprüft die neueste TypeScript-Hauptversion. Die [Angular-Kompatibilitätstabelle](https://angular.dev/reference/versions) beschreibt diese Bindung.

## Daten und Grenzen

`evaluate({ text })` liefert eine Auswertung mit Choice, Score und Noul. Das Ergebnis kennzeichnet den Demo- oder Live-Modus. Eingaben und externe Antworten werden an den Schnittstellen mit Zod geprüft. Der Browser erhält weder den API-Key noch rohe Fehlerantworten des Anbieters.

Der Demo-Modus zeigt feste Beispieldaten. Er bewertet den eingegebenen Text nicht. Der Live-Modus erfordert eine ausdrückliche Konfiguration und einen API-Key. Ein fehlgeschlagener Live-Aufruf liefert einen Fehler und wechselt nicht zum Demo-Ergebnis.

Choice liefert eine Auswahl, Wahrscheinlichkeiten und Confidence. Score liefert einen Erwartungswert auf einer geordneten Skala, der zwischen zwei Stufen liegen kann. Noul liefert die Wahrscheinlichkeit für Ja und keine zusätzliche Confidence. Die Oberfläche hält diese Größen auseinander. [TypeSafe-Primitiven](https://docs.typesafe.ai/primitives).

Die Fragen eines Aufrufs bewerten denselben Zustand unabhängig. Eine Frage kann in diesem Aufruf keine vorherige Antwort verwenden. Regeln, die Ergebnisse kombinieren, gehören in den Anwendungscode. [TypeSafe-Einführung](https://docs.typesafe.ai/introduction).

Persistenz, Hintergrundaufträge, Anmeldung und Live-Updates folgen aus dem späteren Fachthema. [Mögliche Anwendungen](use-cases.md) beschreiben die nächsten Optionen.
