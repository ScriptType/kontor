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

Ein laufender Auftrag enthält den unveränderten Nutzertext, ausdrückliche Antworten, beobachtete Bedienhandlungen und Speicherbelege. Es gibt keinen Katalog erlaubter Auftragskombinationen und keinen vom Anwendungscode vorgegebenen nächsten Schritt.

Der Ablauf wiederholt diese Schritte:

1. Angular liest den aktuellen Bildschirmzustand und die registrierten, zugänglichen Bedienelemente.
2. Jev erhält den ursprünglichen Auftrag, die bisherigen Ergebnisse, offene Blockaden und diese Auswahl.
3. Jev wählt eine Aktion, eine angebotene Rückfrage oder einen Abschluss.
4. Die Anwendung prüft, ob die Entscheidung noch zum aktuellen Zustand gehört und die konkrete Änderung beauftragt oder bestätigt ist.
5. Das sichtbare Bedienelement führt dieselbe Bedienhandlung wie bei manueller Eingabe aus. Nach Rendering und ausstehenden Speicherungen beginnt die nächste Entscheidung mit neuen Beobachtungen.

Menüeinträge sind erst nach dem Öffnen des Menüs ausführbar. Unsichtbare, deaktivierte oder durch einen Dialog gesperrte Elemente gehören nicht zur Auswahl. Fachliche Blockaden bleiben als Informationen verfügbar. Eine Beschreibung einer künftig erreichbaren Seite erteilt keine Ausführungsberechtigung für ihre versteckten Elemente.

Buttons beschreiben ihre konkrete Wirkung. Eingabefelder beschreiben ihren Datentyp, ihren aktuellen Wert und zulässige Wertkandidaten. Werte stammen aus wörtlichen Angaben im Auftrag, vorhandenen Daten oder ausdrücklichen Antworten. Jev wählt einen solchen Kandidaten. Die Registrierung verbindet ihn mit dem sichtbaren Feld und dessen normalem Handler. Es gibt keinen versteckten Zielentwurf, aus dem ein Handler nachträglich seinen Wert liest.

Ein Lauf ist auf 40 ausgeführte Schritte begrenzt. Ein Zustand enthält höchstens 100 Aktionen und 30 Eingabefelder. Der Browser stoppt vor einer Anfrage über 180.000 Byte. Wiederholungen ohne Fortschritt werden ebenfalls beendet. Diese Grenzen schützen den lokalen Versuch; größere Tabellen benötigen eine passende sichtbare Auswahl oder Paginierung.

Eine neue Komponente registriert ihre Bedienelemente und beschreibt die beobachtbaren Wirkungen. Der Entscheidungszyklus benötigt dafür keine neue Aufgabenart und keine festgelegte Klickfolge. Die Fachfunktion selbst benötigt weiterhin manuelle Bedienung, Validierung und einen prüfbaren Effekt.

Jede Entscheidung gehört zu einem bestimmten Lauf und Bildschirmzustand. Öffnen des Auftragsfensters, manuelle Änderungen, Stoppen und Reset entwerten ausstehende Antworten. Nach einem Neuladen startet kein Auftrag automatisch. Vor der ausdrücklichen Fortsetzung werden Daten und Bedienelemente erneut gelesen.

## Freigaben, Teilfortschritt und Abschluss

Eine unsichere, aber konkrete Aktionsauswahl erscheint zur Bestätigung in der Palette. Sie nennt das Bedienelement und die geplante Wirkung. Die Bestätigung gilt für diesen Schritt im geprüften Zustand. Sie erlaubt keine späteren, andersartigen Änderungen.

Zusätzliche fachliche Änderungen benötigen eine eigene Freigabe, sofern sie nicht schon im ursprünglichen Auftrag enthalten sind. Eine Speicherung beschreibt alle Änderungen des betroffenen Entwurfs. Eine hohe Confidence ersetzt diese Umfangsprüfung nicht. Fehlende menschliche Beobachtungen, etwa ein Prüfbeleg, bleiben eine manuelle Aufgabe.

Ausdrücklich beauftragte Änderungen dürfen schrittweise gespeichert werden. Wird ein späterer Teil blockiert, bleiben bestätigte Speicherungen bestehen. Die Rückfrage zeigt diese Speicherungen direkt mit Vorgang und Revision. Der Verlauf enthält die einzelnen Wirkungen. Stoppen ist kein Zurückrollen. Ein unbekanntes Speicherergebnis wird über die Operations-ID abgeglichen und nicht durch eine neue Mutation wiederholt.

Ein ausdrücklich gewünschter Entwurf kann fertig vorbereitet sein, ohne gespeichert zu werden. Dagegen dürfen ausstehende oder unbekannte Speicherungen nicht als erfolgreich gelten. Speicherbelege und gelesene Werte belegen tatsächliche Änderungen. Ob ein beliebiger mehrteiliger Text vollständig erfüllt ist, bleibt zusätzlich eine Bewertung des Modells. Ein Abschlussvorschlag wird deshalb nochmals gegen den ursprünglichen Auftrag und die beobachteten Ergebnisse geprüft. Diese Prüfung ist kein formaler Nachweis des Sprachverständnisses.

Neue Rückfragen und Freigaben öffnen das Auftragsfenster. Escape schließt es, ohne die Frage zu beantworten. Dieselbe Frage öffnet sich dadurch nicht sofort erneut. Die Palette und der Verlauf zeigen, was ausgeführt wurde und wo eine Entscheidung des Nutzers fehlt.

## Jev und seine Grenzen

Jev liefert geschlossene Entscheidungen über angebotene Optionen. Es erzeugt keine freien Texte, Funktionsargumente oder Belege. Anwendungscode gewinnt wörtliche Zahlen und Datumsangaben als Kandidaten; Jev beurteilt deren Bedeutung im Auftrag. Eingaben, gespeicherte Daten und Anbieterantworten werden an ihren Schnittstellen mit Zod geprüft. Nur das Backend besitzt den API-Key.

Unabhängige Fragen können denselben Aufruf teilen. Eine Frage kann keine andere Antwort desselben Aufrufs lesen. Die Beurteilung einer erst gewählten Änderung benötigt deshalb einen Folgeaufruf mit dieser konkreten Änderung als Eingabe. Navigation und geöffnete Menüs benötigen ebenfalls eine neue Beobachtung. [TypeSafe-Primitiven](https://docs.typesafe.ai/primitives).

[Jev Browser](https://github.com/tontoko/jev-browser/blob/0b516327152f3772bebe275f7cbe3d651d106ed6/src/runner.ts) verwendet ebenfalls eine wiederholte Auswahl aus beobachteten Bedienelementen mit ursprünglichem Auftrag, Verlauf und Speicherprüfungen. Kontor übernimmt dieses Ablaufprinzip mit ausdrücklich registrierten Angular-Elementen. Es übernimmt keinen allgemeinen DOM-Klickagenten und kein Versprechen unbegrenzter Auftragsplanung.

Der Demo-Modus verwendet gekennzeichnete, feste Beispiele ohne Anbieterzugriff. Er prüft die Bedienung und ihre Grenzen. Freie Texte werden nur im Live-Modus durch Jev bewertet. Ein fehlgeschlagener Live-Aufruf liefert keinen ersatzweisen Demo-Erfolg.

Die Tests mit simulierten Antworten prüfen Vertrag, Fachregeln und Lebensdauer des Ablaufs. Der [Live-Testlauf](jev-live.md) prüft echte Modellantworten anhand fester Erwartungen an Oberfläche und Datenbank. Er verrät dem Modell weder den nächsten Schritt noch den erwarteten Endzustand. Confidence ist eine Modellbewertung und keine gemessene Erfolgsquote.

Anmeldung, Mehrmandantenbetrieb und automatische Fortsetzung auf einem anderen Gerät gehören nicht zur lokalen Anwendung. [Anwendungsfälle](use-cases.md) beschreiben den aktuellen Umfang. Der [Aktionskatalog](action-catalog.md) beschreibt den geplanten Ausbau.
