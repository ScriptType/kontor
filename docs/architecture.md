# Architektur von Kontor Service

Kontor Service erprobt TypeSafe als sichtbare Bedienassistenz einer Angular-Anwendung. Angular besitzt den Bildschirmzustand, lokale Formularentwürfe und den laufenden Auftrag. Das Backend besitzt gespeicherte Fachdaten und prüft jede Änderung. Ein gemeinsamer oRPC-Vertrag beschreibt Eingaben, Ergebnisse und Fehler. Nur das Backend erhält den TypeSafe-Schlüssel.

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

Die Infrastruktur trägt später auch oRPC-Iteratoren. `liveOptions` hält den letzten Wert, `streamedOptions` sammelt Werte. Ein konkretes Fachfeature muss dafür Wiederanlauf, Event-Lücken und Zeitlimits festlegen. Die Anwendung enthält noch keinen fachlichen Stream.

## Backend und Laufzeit

[Hono](https://hono.dev/docs/getting-started/nodejs) liefert die statische Angular-Anwendung über seinen Node-Adapter aus. `ws` und der offizielle oRPC-WebSocket-Adapter verarbeiten die Prozeduraufrufe am selben Port. Node 24 passt sowohl zur Angular-Werkzeugkette als auch zur dokumentierten Laufzeit des [offiziellen TypeSafe-SDKs](https://docs.typesafe.ai/sdk/javascript).

HTTP bleibt für HTML, Assets und den WebSocket-Handshake erforderlich. Das TypeSafe-SDK verwendet vom Backend aus die HTTPS-API des Anbieters. Die ausschließliche WebSocket-Kommunikation gilt für die Anwendungsaufrufe zwischen Angular und Backend.

Angular 22 benötigt TypeScript 6.0. Das Projekt verwendet deshalb nicht ungeprüft die neueste TypeScript-Hauptversion. Die [Angular-Kompatibilitätstabelle](https://angular.dev/reference/versions) beschreibt diese Bindung.

## Fachmodell und Speichern

Ein Vorgang verbindet einen Kunden, einen Standort, eine zuständige Person, einen Termin und die geleistete Arbeitszeit. Ein Prüfbeleg kann eine weitere Abschlussvoraussetzung sein. Kundenansicht, Teamauslastung und Berichte leiten ihre Werte aus den gespeicherten Vorgängen ab.

Der Server speichert die lokalen Daten in SQLite. Eine Änderung enthält eine Operations-ID und die erwartete Datenrevision. Eine Transaktion speichert die Fachdaten und den zugehörigen Beleg gemeinsam. Derselbe Aufruf mit derselben Operations-ID liefert den ursprünglichen Beleg. Eine andere Nutzlast mit derselben ID wird abgelehnt. Die Prüfung auf einen vorhandenen Beleg erfolgt vor dem Revisionsvergleich.

Die Fachregeln prüfen Qualifikation, Terminüberschneidungen, Arbeitszeit und erforderliche Belege. Sie liefern konkrete Blockaden und mögliche Alternativen. Dieselben Regeln können einen Formularentwurf prüfen. Die Prüfung im Browser ersetzt nie die Prüfung beim Speichern.

Der manuelle Reset ersetzt die Fachdaten über WebSocket-RPC durch die Beispieldaten. Seine SQLite-Transaktion prüft die erwartete Revision und erhöht sie. Sie setzt die Revision nicht auf null zurück, damit verspätete Änderungen mit einem alten Datenstand weiterhin scheitern. Frühere Speicherbelege bleiben zur Erkennung wiederholter Operationen erhalten.

Im Browser entwertet der bestätigte Reset laufende Entscheidungen und ältere Speicherantworten. Nach erfolgreichem Reset werden der lokale Entwurf und Auftrag samt Verlauf geleert. Ein fehlgeschlagener oder unklarer Reset wird nicht automatisch wiederholt und setzt den vorherigen Jev-Auftrag nicht fort. Jev erhält keine Aktion zum Zurücksetzen des Arbeitsbereichs.

Ein Formularentwurf ist kein gespeicherter Vorgang. Jev und menschliche Bedienung verwenden dieselben sichtbaren Handler. Erst Speichern erzeugt eine fachliche Mutation. Jev darf einen Prüfbeleg weder erzeugen noch verändern.

## Auftrag und sichtbare Aktionen

Ein Auftrag besteht aus dem ursprünglichen Text und unterstützten Teilzielen. Fehlende Werte, Mehrdeutigkeit und widersprüchliche Reihenfolgen erzeugen eine Rückfrage. Eine zusätzlich erforderliche Änderung erhält einen konkreten Vorschlag mit bisherigen und neuen Werten.

Die erste Umsetzung unterstützt Filter, Zuweisung, Termin, Arbeitsminuten und Abschluss für jeweils einen Zielvorgang. Der Ablauf berechnet daraus den nächsten zulässigen Schritt und prüft Jevs Auswahl dagegen. Neue Zielarten benötigen entsprechende Fachregeln und Ablaufunterstützung; ihre Registrierung als sichtbarer Button allein reicht nicht aus.

Angular meldet nur aktuell zugängliche Bedienelemente als ausführbare Aktionen. Menüeinträge werden erst nach dem Öffnen angeboten. Nach jeder Änderung der Oberfläche wartet der Ablauf auf das Rendering und erstellt einen neuen Zustand. Fachliche Blockaden bleiben als Information getrennt von ausführbaren Aktionen.

Bei einem ausführbaren Auftrag kann die Navigation zum bekannten Zielvorgang vor einer fachlichen Rückfrage erfolgen. Die Navigation verwendet dieselben registrierten Aktionen und verändert keine Fachdaten. Ein noch zu bestätigender oder abgelehnter Auftrag bedient keine registrierte Aktion. Neue Rückfragen und Freigaben erhalten eine fortlaufende Kennung. Die Palette öffnet sie einmalig. Das Schließen entwertet den ausstehenden Inhalt nicht und löst keine erneute Öffnung aus.

Jede Entscheidung gehört zu einem bestimmten Lauf und Bildschirmzustand. Öffnen des Auftragsfensters, manuelle Änderungen und Stoppen machen ausstehende Entscheidungen unbrauchbar. Eine alte Antwort kann deshalb keinen inzwischen anderen Bildschirm bedienen. Ein bereits gestarteter Speichervorgang kann trotzdem abgeschlossen werden. Der Beleg bestimmt dann das tatsächliche Ergebnis.

Eine offene Rückfrage bleibt beim Schließen des Auftragsfensters offen. Nach einem Neuladen wird ein unterbrochener Auftrag nicht automatisch fortgesetzt. Vor weiteren Aktionen müssen die gespeicherten Daten und zugänglichen Bedienelemente erneut gelesen werden.

## Jev und seine Grenzen

Jev wählt aus vorgegebenen Bedeutungen, Datensätzen, Wertkandidaten und sichtbaren Aktionen. Anwendungscode erkennt wörtliche Zahlen und Datumswerte als Kandidaten. Jev bewertet ihre Zuordnung zum Auftrag. Es erzeugt keine freien Texte oder beliebige Funktionsargumente. Der Browser erhält weder den API-Key noch rohe Fehlerantworten des Anbieters. Eingaben, gespeicherte Daten und Anbieterantworten werden an ihren Schnittstellen mit Zod geprüft.

Die Auftragserkennung erhält Namen, Kennungen und Standorte zur Zuordnung. Veränderliche Abschlussvoraussetzungen gehören nicht in diese Erkennung. Ein unterstützter Abschlusswunsch bleibt unterstützt, wenn noch ein Prüfbeleg fehlt. Die Anwendung prüft diese Voraussetzung danach. Für die Auswahl des nächsten Bedienelements erhält Jev weiterhin den aktuellen Ausführungszustand.

Die Erkennung trennt Aufgabenarten von konkreten Werten. Zuerst bewertet Jev den ursprünglichen Auftrag. Danach ordnet es Namen und wörtlich vorhandene Zahlen oder Zeitpunkte den erkannten Aufgaben zu. Eine zusätzliche Prüfung bestätigt, dass die erkannten Aufgaben den vollständigen Auftrag abdecken. Ein unsicher bewerteter Teilauftrag darf dadurch nicht stillschweigend entfallen. Nicht unterstützte Zusatzaufträge und mehrere Zielvorgänge verhindern die Ausführung des gesamten Auftrags.

Reine Filter benötigen keinen einzelnen Zielvorgang und keine Speicherabsicht. Fehlende Werte für eine erkannte Änderung bleiben als fehlende Werte im Ziel erhalten, damit die Oberfläche gezielt nach Vorgang, Person, Minuten oder Termin fragen kann.

Ein erkanntes Ziel hat einen ausdrücklichen Zustand für Ausführung, Bestätigung oder Ablehnung. Bestätigt Jev die Zulässigkeit, den Einzelauftrag und die vollständige Abdeckung inhaltlich, aber mit zu geringer Confidence, zeigt die Palette den konkreten Plan zur Bestätigung. Fehlende Werte werden vorher erfragt. Die Zusammenfassung nennt alle erkannten Änderungen und deren Speicherabsicht. Erst die Bestätigung erlaubt die normale Auswahl sichtbarer Aktionen. Ein negativer oder unklarer Umfang sowie eine unvollständige Abdeckung können nicht auf diesem Weg freigegeben werden. Ein Auftrag mit mehr als einem bekannten vollständigen Personennamen wird unabhängig von Jevs gewählten Aufgabenarten abgelehnt. Diese konservative Grenze verhindert verkürzte Zuweisungen, lehnt aber auch Vergleichsformulierungen wie "Lea Sommer statt Jonas Weber" ab.

Die Auftragsbestätigung ersetzt keine Fachregel und keine Freigabe einer zusätzlichen Änderung. Nach einem Neuladen benötigt ein unterbrochener, zuvor bestätigter Auftrag erneut eine Bestätigung. Bei einem Terminkonflikt kann der Benutzer eine von der Anwendung geprüfte Alternative auswählen, auch wenn Jev keine Person sicher vorschlägt. Die Auswahl bleibt eine gesonderte Freigabe mit erneuter Revisionsprüfung.

Die Fragen eines Aufrufs bewerten denselben Zustand unabhängig. Eine Frage kann in diesem Aufruf keine vorherige Antwort verwenden. Regeln, die Ergebnisse kombinieren, gehören in den Anwendungscode. Neue Informationen nach einer Navigation erfordern einen neuen Aufruf. [TypeSafe-Einführung](https://docs.typesafe.ai/introduction).

Der Demo-Modus unterstützt ausdrücklich angezeigte Beispielaufträge. Er prüft die Anwendung mit vorgegebenen Entscheidungen und ruft TypeSafe nicht auf. Unbekannte Texte werden nicht durch einen ähnlichen Beispielauftrag ersetzt. Der Live-Modus erfordert eine ausdrückliche Konfiguration und einen API-Key. Ein fehlgeschlagener Live-Aufruf liefert einen Fehler und wechselt nicht zum Demo-Ergebnis.

Confidence ist eine Modellbewertung und keine gemessene Genauigkeit oder Erlaubnis zum Speichern. Die Tests mit simulierten Anbieterantworten prüfen den SDK-Vertrag und den Ablauf. Der separat aufrufbare [Live-Testlauf](jev-live.md) prüft deutsche Formulierungen mit echten Modellantworten, sichtbaren Ergebnissen und gespeicherten Daten. [TypeSafe-Primitiven](https://docs.typesafe.ai/primitives).

Anmeldung, Mehrmandantenbetrieb und automatische Fortsetzung auf einem anderen Gerät gehören nicht zur lokalen Anwendung. [Anwendungsfälle](use-cases.md) beschreiben den ersten Umfang. Der [Aktionskatalog](action-catalog.md) beschreibt den geplanten Ausbau.
