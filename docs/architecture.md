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

Priorität, Status und ein optionaler Termin gehören zu `CaseDraft`. Die Wiederöffnung setzt den Status auf offen, die Terminlöschung setzt den Termin auf `null`. Beide Änderungen erhalten Arbeitszeit und Prüfbeleg. Ihre beschriebenen Wirkungen fließen wie die Priorität in die Umfangsprüfung einer Speicherung ein.

Neue Speicheraufträge enthalten die Priorität ausdrücklich. Der private Parser des Browser-Speicherprotokolls akzeptiert auch ältere Einträge ohne Priorität. Sie dienen ausschließlich zum Abgleichen eines Ergebnisses über die Operations-ID. Der Browser ergänzt keine vermutete Priorität und sendet die alte Änderung nicht erneut.

`WorkspaceUi` hält Kundenfilter, Status, Zuständigkeit und Suchtext in einem gemeinsamen Filterwert. Tabelle, Jev-Kontext und Zustandsvergleich verwenden diesen Wert. Kunden-, Team- und Berichtsverweise ersetzen ihn vollständig durch den passenden Ausschnitt. Auswahl und Entwurf bleiben davon unabhängig. Der bestehende Entwurfsschutz greift beim Öffnen eines anderen Vorgangs.

## Auftrag und sichtbare Aktionen

Ein laufender Auftrag enthält den unveränderten Nutzertext, ausdrückliche Antworten, beobachtete Bedienhandlungen und Speicherbelege. Es gibt keinen Katalog erlaubter Auftragskombinationen und keinen vom Anwendungscode vorgegebenen nächsten Schritt.

Der Ablauf wiederholt diese Schritte:

1. Angular liest den aktuellen Bildschirmzustand und die registrierten, zugänglichen Bedienelemente.
2. Jev erhält den ursprünglichen Auftrag, die bisherigen Ergebnisse, offene Blockaden und diese Auswahl.
3. Jev wählt eine Aktion, eine angebotene Rückfrage, einen Abschluss, eine Blockade oder einen Halt bei fehlender Orientierung.
4. Die Anwendung prüft, ob die Entscheidung noch zum aktuellen Zustand gehört und die konkrete Änderung beauftragt oder bestätigt ist.
5. Das sichtbare Bedienelement führt dieselbe Bedienhandlung wie bei manueller Eingabe aus. Nach Rendering und ausstehenden Speicherungen beginnt die nächste Entscheidung mit neuen Beobachtungen.

Menüeinträge sind erst nach dem Öffnen des Menüs ausführbar. Unsichtbare, deaktivierte oder durch einen Dialog gesperrte Elemente gehören nicht zur Auswahl. Eine Beschreibung einer künftig erreichbaren Seite erteilt keine Ausführungsberechtigung für ihre versteckten Elemente.

Sichtbare deaktivierte Bedienelemente können ihre fachlichen Voraussetzungen getrennt als `BlockedControl` beschreiben. Die Beschreibung bindet Gründe an eine konkrete Aktion und einen Zielvorgang. Sie macht das Element nicht ausführbar. Erst wenn Jev ausdrücklich eine Blockade meldet, fragt das Backend nach der dafür erforderlichen deaktivierten Aktion. Die geschlossene Auswahl enthält auch eine unbekannte Ursache. Nur eine ausreichend sichere Zuordnung erlaubt einen konkreten Hinweis. Normale Bedienhandlungen und Abschlussprüfungen benötigen diesen zusätzlichen Aufruf nicht.

Die Nachfrage ist auch bei einer unsicheren Blockademeldung zulässig. Sie klärt ausschließlich den Grund und erteilt keine Ausführungsfreigabe. Ihre eigene Confidence bestimmt, ob die Palette einen konkreten Hinweis zeigt. Unsicherheit über den nächsten Schritt wird damit nicht als Unsicherheit über jede mögliche Ursache behandelt. Beide Antworten bleiben im Live-Bericht sichtbar.

Angezeigte Vorgänge und unerledigte Checklisten erweitern den Nutzerauftrag nicht. Beispielsweise verlangt das Anzeigen einer Vorgangsliste keinen Abschluss ihrer Einträge. Die Modellfragen unterscheiden deshalb das gewünschte Ergebnis in der Oberfläche von den fachlichen Voraussetzungen einzelner Bedienelemente.

Buttons beschreiben ihre konkrete Wirkung. Eingabefelder beschreiben ihren Datentyp, ihren aktuellen Wert und zulässige Wertkandidaten. Werte stammen aus wörtlichen Angaben im Auftrag, vorhandenen Daten oder ausdrücklichen Antworten. Jev wählt einen solchen Kandidaten. Die Registrierung verbindet ihn mit dem sichtbaren Feld und dessen normalem Handler. Es gibt keinen versteckten Zielentwurf, aus dem ein Handler nachträglich seinen Wert liest.

Jede registrierte Aktion trägt neben ihrer deutschen Wirkung einen englischen Text für Jev. Die deutsche Wirkung erscheint weiterhin in Freigaben, Verlauf und Auswahl. Der Jev-Text nennt zuerst die Wirkung und danach den aktuellen Wert aus dem Anwendungszustand. Er sagt außerdem, was die Aktion verändert, und grenzt sie von einer naheliegenden Verwechslung ab. Beispielsweise filtert das Zuweisen einer Person nicht die Vorgangsliste. Die Registrierungsstelle schreibt diesen Text. Der Server ergänzt nur die sichtbare Beschriftung und die Art der Aktion. Eingabefelder tragen einen englischen Namen und eine Abgrenzung. Wertkandidaten nennen ihre Herkunft in beiden Sprachen. Jev erhält verfügbare Aktionen, beobachtete Schritte und deaktivierte Bedienelemente ausschließlich in der englischen Form.

Ein passender Wert bleibt auch dann als Kandidat verfügbar, wenn er bereits im sichtbaren Feld steht. Gleiche numerische Werte werden vereinheitlicht. Eine erneute gleiche Zuweisung verwendet den normalen Handler, verändert aber weder den Entwurf noch dessen Eigentümer oder Statusmeldung. Manuelle Eingaben entwerten trotzdem ausstehende Entscheidungen. Bereits ausgewählte, deaktivierte Buttons werden dadurch nicht ausführbar.

Eine alleinstehende Zahl im Auftrag wird kein Kandidat für Zahlenfelder, wenn sie eine vorhandene Kennung bezeichnen kann. Das gilt, wenn ihre Ziffern der abschließenden Zifferngruppe einer Kennung aus Buchstaben, Bindestrich und Ziffern entsprechen. Beispielsweise bietet `1042` bei vorhandenem `V-1042` keine Feldaktion an. Titel und Namen lösen diese Regel nicht aus. Andere Zahlen aus dem Auftrag bleiben Kandidaten. Eine ausdrückliche Antwort mit denselben Ziffern bleibt ebenfalls ein Kandidat.

Der Verlauf unterscheidet tatsächliche Änderungen von Schritten ohne Änderung. Er hält gespeicherten Vorgang, Entwurf und Änderungszustand getrennt fest. Diese Beobachtung bleibt auch nach einer Navigation verfügbar. Ältere Verlaufseinträge ohne solche Ergebnisangabe erhalten keine nachträglich erfundene Bewertung.

Ein Lauf ist auf 40 ausgeführte Schritte begrenzt. Ein Zustand enthält höchstens 100 Aktionen und 30 Eingabefelder. Der Browser stoppt vor einer Anfrage über 180.000 Byte. Wiederholungen ohne Fortschritt werden ebenfalls beendet. Diese Grenzen schützen den lokalen Versuch; größere Tabellen benötigen eine passende sichtbare Auswahl oder Paginierung.

Eine neue Komponente registriert ihre Bedienelemente und beschreibt die beobachtbaren Wirkungen auf Deutsch für Nutzer und auf Englisch für Jev. Der Entscheidungszyklus benötigt dafür keine neue Aufgabenart und keine festgelegte Klickfolge. Die Fachfunktion selbst benötigt weiterhin manuelle Bedienung, Validierung und einen prüfbaren Effekt.

## Bildschirmkontext

Der gerenderte Seitentext allein enthält keine verlässliche räumliche Gliederung. Deshalb beschreiben benannte Bereiche zusätzlich Hauptnavigation, Filter, Tabelle, Detailformular und Übersichten. Die Komponenten benennen die Bereiche an ihren tatsächlichen DOM-Elementen. Reihenfolge, Verschachtelung, grobe Position im Browserfenster und zugehörige Aktions- und Feldkennungen werden daraus abgeleitet.

Ein vorhandener Bereich kann oberhalb oder unterhalb des sichtbaren Ausschnitts liegen. Diese Angabe unterscheidet sich von einem ausgeblendeten oder nicht gerenderten Bereich. Eine im Arbeitsbereich erhaltene Auswahl bedeutet ebenfalls nicht, dass ihre Details auf der aktuellen Seite geöffnet sind.

Die aktuellen Fakten beschreiben eine solche Auswahl deshalb getrennt als `retainedSelection`. Die Angabe `mounted` ist dort immer `false`. `retainedSelection` enthält den gespeicherten Vorgang. Ein Entwurf erscheint nur, wenn er vom gespeicherten Stand abweicht. `selected`, `draft`, `dirty`, `blockers` und `message` gehören weiterhin ausschließlich zu geöffneten Details. Die Modellfragen bezeichnen `retainedSelection` als aktuelle Daten und nicht als sichtbares Bedienelement. So erkennt Jev bereits gespeicherte Werte auch auf einer anderen Seite.

Aktionen in nativen Tabellen erhalten zusätzlich den Tabellennamen und ihre aktuelle Zeilenposition in ihrer Beschreibung. Beispielsweise bezeichnet „Vorgangsliste, Zeile 5 von 5, letzte Zeile“ das tatsächlich gerenderte Bedienelement. Filter verändern diese Angabe mit der Tabelle. Die Ermittlung wertet keinen Nutzerauftrag aus.

Die Bereichsbeschreibungen stehen neben dem begrenzten Seitentext in den aktuellen Fakten. Sie erlauben keine zusätzlichen Bedienhandlungen. Ausschließlich die angebotenen Aktionen bleiben ausführbar. Ändert sich die beschriebene Anordnung während einer Entscheidung, prüft der bestehende Zustandsvergleich diese Änderung vor der Ausführung. Die Beobachtung umfasst höchstens 24 Bereiche. Bei weiteren Bereichen zeigt `truncated` die Kürzung an.

Das Öffnen eines Vorgangs zeigt seine Details unterhalb der Tabelle. Nach dem Rendern scrollt die Anwendung die Detailüberschrift in den sichtbaren Ausschnitt und fokussiert sie. Manuelle Klicks und Jev verwenden denselben Ablauf. Das erneute Öffnen desselben Vorgangs erhält seinen ungespeicherten Entwurf. Normale Feldeingaben lösen keine erneute Fokussierung der Überschrift aus. Die Umsetzung verwendet Angulars [`afterRenderEffect`](https://angular.dev/api/core/afterRenderEffect).

Jede Entscheidung gehört zu einem bestimmten Lauf und Bildschirmzustand. Öffnen des Auftragsfensters, manuelle Änderungen, Stoppen und Reset entwerten ausstehende Antworten. Nach einem Neuladen startet kein Auftrag automatisch. Vor der ausdrücklichen Fortsetzung werden Daten und Bedienelemente erneut gelesen.

Aktionen nach dem Schließen der Palette warten auf das `closed`-Ereignis des Dialogs und den nächsten Renderdurchlauf. Angular CDK stellt die Zugänglichkeit der Hauptansicht erst nach den `closed`-Abonnenten wieder her. Eine vorgemerkte Aktion entfällt, wenn die Palette erneut geöffnet wurde oder sich der Laufzustand während des Schließens verändert hat.

## Freigaben, Teilfortschritt und Abschluss

Bei Unsicherheit zeigt die Palette die beiden am höchsten bewerteten Optionen derselben Jev-Antwort. Die Optionen können auch eine Rückfrage, Abschlussprüfung, Blockade oder einen Halt enthalten. Die ursprüngliche Auswahl bleibt zusammen mit ihrer Confidence erkennbar, auch wenn sie nicht an erster Stelle der Rangfolge steht.

Der Anbieter liefert Auswahl-Confidence und Optionswahrscheinlichkeiten als unterschiedliche Werte. Die Sicherheitsschwelle verwendet weiterhin die Auswahl-Confidence. Die Rangfolge verwendet die unveränderten Optionswahrscheinlichkeiten. Bei Gleichstand gilt die Reihenfolge der angebotenen Optionen. Das Backend prüft die vollständige Zuordnung der Wahrscheinlichkeiten zu den angebotenen Kennungen und Werte zwischen 0 und 1. Ein weiterer Aufruf zur Ermittlung einer zweiten Option ist nicht erforderlich.

Eine gewählte Alternative wird nach dem tatsächlichen Schließen der Palette erneut gegen den vollständigen aktuellen Katalog geprüft. Sie erhält eine eigene Umfangsbewertung. Für Jevs ursprüngliche Auswahl gilt dagegen die Umfangsbewertung aus demselben geprüften Zustand weiter. Zusätzliche oder unklare Änderungen benötigen anschließend eine konkrete Freigabe; eine erneute Bewertung kann diese Freigabe nicht ersetzen. Ein verbotener Schritt bleibt unbestätigbar. Die Freigabe gilt ausschließlich für diese Wirkung im geprüften Zustand.

Die Entscheidung `abstain` hält den Lauf an, wenn Jev keinen sinnvollen nächsten Schritt wählen kann. Sie öffnet die Auswahl mit den beiden Bewertungen und Möglichkeiten zum Überarbeiten oder Stoppen. Sie erzeugt keine fachliche Blockadeursache. Eine tatsächliche `blocked`-Entscheidung kann weiterhin eine unabhängig bewertete Ursache enthalten; deren Confidence ersetzt niemals die ursprüngliche Auswahl-Confidence.

Eine `blocked`-Entscheidung unter der Sicherheitsschwelle beendet den Lauf nicht sofort. Sie öffnet wie eine unsichere Rückfrage die Auswahl mit den beiden Bewertungen. Eine angebotene Navigation oder ein anderer Schritt bleibt so erreichbar. Wählt der Nutzer dort die Blockade, gilt die Ursache aus derselben Jev-Antwort. Ab der Schwelle hält eine `blocked`-Entscheidung den Lauf weiterhin unmittelbar an.

Vor dem ersten ausgeführten Schritt bietet Jev `blocked` nur an, wenn ein deaktiviertes Bedienelement mit Begründung sichtbar ist. Ohne Schritt und ohne solches Bedienelement kann noch nichts blockiert sein. Ein unklarer Auftrag endet dann mit `abstain`. Das Demo-Szenario wählt in diesem Fall ebenfalls `abstain`.

Die Auswahl einer niedriger bewerteten Abschlussoption startet eine neue Abschlussprüfung. Nur eine neue Jev-Auswahl von `done` kann deren Auswahl-Confidence liefern. Eine andere neue Auswahl erscheint zur Prüfung und wird dabei nicht unmittelbar ausgeführt. Optionswahrscheinlichkeit oder Nutzerklick ersetzen keine der Abschlussvoraussetzungen.

`CommandRunner` besitzt eine persönliche Sicherheitsschwelle als ganzen Prozentwert von 0 bis 100, mit Standard 75. Sie bleibt separat von Verlauf und Speicherprotokoll im Browser gespeichert. Die Prüfung lautet `confidence < percent / 100`. Sie gilt für Aktionsauswahl, Auftragsumfang und beide Modellbewertungen des Abschlusses. Zusätzliche oder unklare Änderungen benötigen unabhängig vom Wert eine Freigabe. Ein verbotener Schritt bleibt gesperrt. Auch bei 0 Prozent gelten die Anforderungen an Abschlussurteil, ausstehende Speicherungen und Speicherbelege.

Nur das manuelle Einstellungsfeld in der Palette kann die Schwelle ändern. Der Setter entwertet laufende Entscheidungen und bestehende Freigaben synchron über die vorhandene Unterbrechung. Die Einstellung erscheint weder in den angebotenen Jev-Aktionen noch im Modellkontext. Ein Reset der Fachdaten erhält sie. Ungültige gespeicherte Werte fallen auf 75 zurück. Scheitert das Speichern einer neuen Einstellung, gilt sie im aktuellen Tab mit einem sichtbaren Hinweis.

Für die Auswahl von Jev gibt es mehrere Regeln. Der Browserschlüssel `kontor-jev-gate-v1` wählt sie; ohne gültigen Wert gilt `threshold`. `frontend/src/gate.ts` beschreibt jede Regel als Zeile einer Tabelle: gelesener Wert, Schwelle je Art der Wahl, Arten mit eigener Umfangsprüfung und Art der Abschlussbewertung. Die Regel `threshold` prüft die Auswahl-Confidence gegen die persönliche Schwelle wie oben. Die Regel `g1` prüft stattdessen die höchste Optionswahrscheinlichkeit gegen eine Schwelle je Art der Wahl: Ansicht 0,70, Entwurf 0,85, Speichern oder Verwerfen 0,75, Abschluss oder Halt 0,65. Eine Rückfrage behält die persönliche Schwelle. Unbekannte Wahlen zählen als Speichern. Die Werte stammen aus der Anpassung an Holdout 1 im Jev-Bench. Beide Regeln gelten für Aktionsauswahl, Rückfrage, Blockade und die Entscheidung zum Abschluss. Für die Abschlussbewertung prüft `threshold` wie oben das Urteil `complete` und seine Confidence. `g1` prüft stattdessen die Wahrscheinlichkeit von `complete` gegen eine Schwelle je Art der bisherigen Arbeit des Laufs: nur Ansicht 0,60, Entwurf ohne Speichern 0,85, gespeichert 0,80. Ein Lauf gilt als gespeichert, sobald ein Schritt gespeichert hat, sonst als Entwurf, sobald ein Schritt einen Entwurf geändert hat. Diese Werte stammen aus der Abschlussbank. Umfangsprüfung und Blockadeursache verwenden weiterhin ihre bisherigen Schwellen. Die Palette bietet keine Einstellung dafür; die Auswertung setzt den Schlüssel mit `--gate`.

Unter `threshold` und `g1` erhält jede Aktion außer einer Ansicht vor der Ausführung eine eigene Umfangsprüfung. Die Regel `g2-effect` richtet Schwelle und Prüfung nach der Wirkung aus. Eine Ansicht ändert keine Daten und wirkt ab 0,30. Ein gebundener Entwurf wirkt ab 0,70 und ohne eigene Umfangsprüfung. Gebunden ist ein Feldkandidat, wenn der Auftrag seinen Wert genau diesem Feld zuordnet und er der einzige Wert aus dem Auftrag für dieses Feld dieses Vorgangs ist. Die Zuordnung leistet ein Feldwort wie „Arbeitszeit“ oder bei Datum und Uhrzeit der Feldtyp, denn nur das Terminfeld nimmt diesen Wert. Eine Korrektur („45, nee 55“), eine Reihenfolge („erst 30, dann 55“) und eine Zahl ohne Feldwort sind nicht gebunden. Antworten, Zitate und vorhandene Datenwerte sind nie gebunden. Die Registrierung vermerkt Herkunft und Bindung als `value` an der Aktionsbeschreibung. Jev erhält diese Angabe nicht. Alle anderen Entwürfe, Speichern, Verwerfen, Abschluss, Halt und Rückfrage behalten unter `g2-effect` die Schwellen und Prüfungen von `g1`. Unter `threshold` und `g1` gilt ein gebundener Entwurf wie jeder andere Entwurf.

Die Regel `g2-exits` gleicht `g1`, bietet `done` aber erst nach dem ersten ausgeführten Schritt an. Ein Abschluss vor dem ersten Schritt zieht sonst Wahrscheinlichkeit von der ersten Aktion ab. Ein schon beim Start erfüllter Auftrag braucht unter dieser Regel einen Schritt, etwa eine Ansicht, bevor Jev ihn abschließen kann. Der Browser übergibt die Einstellung als `doneBeforeFirstStep` in der Entscheidungseingabe, Standard `true`. Sie erscheint nicht im Modellkontext. `blocked` und `abstain` folgen weiterhin ihren eigenen Regeln.

Die Regel `g2-pool` gleicht `g1`, fasst aber Optionen mit gleicher Wirkung zusammen. Die Entscheidung enthält dafür neben den beiden bestbewerteten Optionen die Wahrscheinlichkeiten aller angebotenen Optionen. `effectKey` in `shared/dimensions.ts` ordnet jeder Option ihre Wirkung auf die aktuellen Fakten zu: Seite, Listenfilter, geöffneter Vorgang, Wert im geöffneten Entwurf und geöffnetes Menü. Zwei Optionen mit gleicher Wirkung hinterlassen denselben sichtbaren Zustand. Ein Schritt ohne Wirkung, etwa die Navigation zur aktuellen Seite oder ein Feldwert gleich dem Entwurf, gehört zur Gruppe von `done`. Speichern, Verwerfen, Rückfragen, Halt und Optionen ohne bekannte Wirkung bleiben allein. Die Gruppe mit der höchsten Summe gewinnt. Sie wirkt, wenn ihre Summe die Schwelle der Art der gewählten Option erreicht und die nächste Gruppe um mindestens 0,10 übertrifft. Gewählt wird ihre wahrscheinlichste Option, in der Gruppe ohne Wirkung `done`. Die Palette zeigt weiterhin Jevs eigene Auswahl und die beiden bestbewerteten Optionen.

Die Regel `g2` verbindet die drei vorigen: Sie fasst Optionen mit gleicher Wirkung zusammen wie `g2-pool`, verwendet die Schwellen und Umfangsprüfungen von `g2-effect` und bietet `done` wie `g2-exits` erst nach dem ersten ausgeführten Schritt an.

Die Confidence für eine konkrete Blockadeursache bleibt getrennt und unverändert bei mindestens 0,75. Sie entscheidet über die Zuordnung eines Hinweises zu einer deaktivierten Aktion. Die persönliche Schwelle verändert diese fachliche Zuordnung nicht.

Zusätzliche fachliche Änderungen benötigen eine eigene Freigabe, sofern sie nicht schon im ursprünglichen Auftrag enthalten sind. Eine Speicherung beschreibt alle Änderungen des betroffenen Entwurfs. Eine hohe Confidence ersetzt diese Umfangsprüfung nicht. Fehlende menschliche Beobachtungen, etwa ein Prüfbeleg, bleiben eine manuelle Aufgabe.

Ausdrücklich beauftragte Änderungen dürfen schrittweise gespeichert werden. Wird ein späterer Teil blockiert, bleiben bestätigte Speicherungen bestehen. Die Rückfrage zeigt diese Speicherungen direkt mit Vorgang und Revision. Der Verlauf enthält die einzelnen Wirkungen. Stoppen ist kein Zurückrollen. Ein unbekanntes Speicherergebnis wird über die Operations-ID abgeglichen und nicht durch eine neue Mutation wiederholt.

Ein ausdrücklich gewünschter Entwurf kann fertig vorbereitet sein, ohne gespeichert zu werden. Dagegen dürfen ausstehende oder unbekannte Speicherungen nicht als erfolgreich gelten. Speicherbelege und gelesene Werte belegen tatsächliche Änderungen. Ob ein beliebiger mehrteiliger Text vollständig erfüllt ist, bleibt zusätzlich eine Bewertung des Modells. Ein Abschlussvorschlag wird deshalb nochmals gegen den ursprünglichen Auftrag und die beobachteten Ergebnisse geprüft. Diese Prüfung ist kein formaler Nachweis des Sprachverständnisses.

Bereits passend gespeicherte Werte benötigen keine erneute Speicherung. Für jede im aktuellen Lauf gesendete Änderung bleibt dagegen ihr eigener Speicherbeleg erforderlich. Ein passender Entwurf ersetzt weder den gespeicherten Wert noch einen ausstehenden Beleg. Schritte ohne Änderung erzeugen keine künstlichen Operations-IDs oder Speicherbelege.

Eine nicht bestätigte Abschlussbewertung öffnet die Auswahl mit den beiden bewerteten Optionen und nennt das Ergebnis der Abschlussprüfung. Ändern sich Daten oder verfügbare Schritte während der Abschlussprüfung, entsteht der Zustand `completion_unconfirmed`. Beide Fälle enthalten keine fachliche Blockade und bieten keinen Prüfbeleg an. Bereits bestätigte Speicherungen bleiben sichtbar. Fortsetzen prüft den Auftrag erneut. Das bloße Schließen der Palette startet keine weitere Arbeit.

Die Übergabe zum Prüfbeleg benötigt eine dem Auftrag zugeordnete Abschlussaktion mit fehlendem Beleg. Die Palette merkt sich den Zielvorgang dieser Aktion. Nach dem tatsächlichen Schließen prüft sie Laufzustand, ausgewählten Vorgang und aktuelle Voraussetzung erneut, bevor sie das manuelle Eingabefeld fokussiert. Ein beliebiger geöffneter Vorgang genügt nicht als Grund für diese Übergabe.

Neue Rückfragen und Freigaben öffnen das Auftragsfenster. Escape schließt es, ohne die Frage zu beantworten. Dieselbe Frage öffnet sich dadurch nicht sofort erneut. Die Palette und der Verlauf zeigen, was ausgeführt wurde und wo eine Entscheidung des Nutzers fehlt.

## Jev und seine Grenzen

Jev liefert geschlossene Entscheidungen über angebotene Optionen. Es erzeugt keine freien Texte, Funktionsargumente oder Belege. Anwendungscode gewinnt wörtliche Zahlen und Datumsangaben als Kandidaten; Jev beurteilt deren Bedeutung im Auftrag. Eingaben, gespeicherte Daten und Anbieterantworten werden an ihren Schnittstellen mit Zod geprüft. Nur das Backend besitzt den API-Key.

Unabhängige Fragen können denselben Aufruf teilen. Eine Frage kann keine andere Antwort desselben Aufrufs lesen. Die Beurteilung einer erst gewählten Änderung benötigt deshalb einen Folgeaufruf mit dieser konkreten Änderung als Eingabe. Navigation und geöffnete Menüs benötigen ebenfalls eine neue Beobachtung. [TypeSafe-Primitiven](https://docs.typesafe.ai/primitives).

[Jev Browser](https://github.com/tontoko/jev-browser/blob/0b516327152f3772bebe275f7cbe3d651d106ed6/src/runner.ts) verwendet ebenfalls eine wiederholte Auswahl aus beobachteten Bedienelementen mit ursprünglichem Auftrag, Verlauf und Speicherprüfungen. Kontor übernimmt dieses Ablaufprinzip mit ausdrücklich registrierten Angular-Elementen. Es übernimmt keinen allgemeinen DOM-Klickagenten und kein Versprechen unbegrenzter Auftragsplanung.

Der Demo-Modus verwendet gekennzeichnete, feste Beispiele ohne Anbieterzugriff. Er prüft die Bedienung und ihre Grenzen. Freie Texte werden nur im Live-Modus durch Jev bewertet. Ein fehlgeschlagener Live-Aufruf liefert keinen ersatzweisen Demo-Erfolg.

Die Tests mit simulierten Antworten prüfen Vertrag, Fachregeln und Lebensdauer des Ablaufs. Der [Live-Testlauf](jev-live.md) prüft echte Modellantworten anhand fester Erwartungen an Oberfläche und Datenbank. Er verrät dem Modell weder den nächsten Schritt noch den erwarteten Endzustand. Confidence ist eine Modellbewertung und keine gemessene Erfolgsquote.

Anmeldung, Mehrmandantenbetrieb und automatische Fortsetzung auf einem anderen Gerät gehören nicht zur lokalen Anwendung. [Anwendungsfälle](use-cases.md) beschreiben den aktuellen Umfang. Der [Aktionskatalog](action-catalog.md) beschreibt den geplanten Ausbau.
