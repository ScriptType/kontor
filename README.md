# Kontor Service

Lokale Vorgangsverwaltung zum Erproben von Jev als sichtbare Bedienassistenz. Angular stellt Vorgänge, Kunden, Team und Berichte dar. Jev verwendet dieselben Bedienelemente wie der Nutzer. Ein Auftragsfenster enthält die Eingabe, Rückfragen und den Verlauf.

Die Anwendung verwendet oRPC v2 über WebSockets, TanStack Query, Hono und das TypeSafe SDK. Der Demo-Modus führt gekennzeichnete Beispielaufträge ohne KI-Auswertung aus. Unbekannte Texte starten keinen ähnlichen Beispielauftrag. Nur der Live-Modus sendet Aufträge an TypeSafe.

oRPC ist exakt auf `2.0.0-beta.37` festgelegt. Client und Server nutzen dieselbe Beta-Version.

## Starten

Node 24.19.0 verwenden, siehe `.nvmrc`. Unterstützt wird Node 24 ab 24.15.0.

```sh
npm ci
cp .env.example .env
npm run dev
```

Die Oberfläche läuft auf http://127.0.0.1:4200. Angular leitet den WebSocket unter `/rpc` an den lokalen Server auf Port 3000 weiter. `.env` wird automatisch geladen und bleibt außerhalb von Git. TanStack Query Devtools stehen im Entwicklungsmodus bereit.

Der Server speichert Beispieldaten und Speicherbelege in `kontor.sqlite`. `KONTOR_DB` setzt einen anderen Dateipfad. Die Daten bleiben nach einem Neustart erhalten. Der Entwurf des Jev-Auftrags und sein Verlauf werden lokal im Browser gespeichert. Ungespeicherte Vorgangsformulare überstehen das Öffnen der Palette, aber kein Neuladen der Seite. Unterbrochene Aufträge starten nach Neuladen nicht selbstständig erneut.

Alle Anwendungsaufrufe zwischen Frontend und Backend verwenden denselben WebSocket. HTML, Assets und der WebSocket-Handshake verwenden HTTP. Die Verbindung vom Backend zur TypeSafe-API verwendet HTTPS.

## Live-Modus

In `.env` explizit `TYPESAFE_MODE=live` und `TYPESAFE_API_KEY` setzen. `TYPESAFE_DEFAULT_MODEL=jev-latest` ist der Standard. Server danach neu starten. Live sendet den eingegebenen Text an TypeSafe und kann Kosten verursachen. Ein fehlender oder leerer Key verhindert den Serverstart. Fehler führen nie zu einem Demo-Ergebnis. Pro Anfrage gilt ein Timeout von zehn Sekunden ohne Wiederholungen.

## Prüfen und gebaut starten

```sh
npm run verify
npm start
```

`verify` prüft Typen, baut Frontend und Server und führt WebSocket- sowie Browser-Tests aus. Die Browser-Tests benötigen lokal installiertes Google Chrome. Sie verwenden den Demo-Modus oder simulierte Provider-Antworten und benötigen keinen API-Key. `npm start` stellt den Build unter http://127.0.0.1:3000 bereit. Nur Loopback wird gebunden.

`npm test` prüft Fachregeln, den WebSocket-Transport und das SDK mit lokal simulierten Provider-Antworten. Es sendet keine Anfrage an TypeSafe.

`npm run test:live` prüft deutsche Aufträge im Browser mit echten Jev-Antworten. Der Lauf benötigt den API-Key aus `.env` und verwendet für jedes Szenario frische Beispieldaten in einer eigenen Datenbank im Arbeitsspeicher. Er prüft sichtbare Filter, Rückfragen und Formulare sowie die tatsächlich gespeicherten Änderungen. Die lokale `kontor.sqlite` wird dabei nicht verwendet. Die Aufrufe können Kosten verursachen. [Live-Szenarien und Auswertung](docs/jev-live.md) beschreibt Aufruf, Ergebnisse und Grenzen.

`npm run eval:jev -- --variant <Name>` misst ganze Jev-Läufe über feste und generierte Szenarien. [Jev-Auswertung](docs/jev-eval.md) beschreibt Szenarien, Kennzahlen und den Bestätigungsvertrag für Varianten.

[Offene Prüfungen](docs/known-issues.md) dokumentiert beobachtete Modellfehler und die Grenzen der Live-Messungen.

## Aufträge ausführen

Öffne Jev über den sichtbaren Button oder mit `⌘K` unter macOS beziehungsweise `Strg+K` unter Windows. Nach dem Absenden schließt sich das Fenster. Die Statusleiste zeigt den Fortschritt und einen Stopp-Schalter. Der Verlauf enthält tatsächlich ausgeführte Schritte.

Das Öffnen des Auftragsfensters pausiert die Bedienung. Escape schließt das Fenster und behält den Eingabeentwurf. Eine offene Rückfrage bleibt unbeantwortet. Stoppen verhindert weitere Schritte und macht gespeicherte Änderungen nicht rückgängig.

Neue Rückfragen und Freigaben öffnen das Auftragsfenster automatisch. Jev kann zuvor über sichtbare Bedienelemente zum betroffenen Vorgang navigieren. Escape schließt die aktuelle Rückfrage, ohne sie sofort erneut zu öffnen. Über **Antworten** erreichst du sie wieder.

Fehlt Jev ein Wert, merkt Jev die Rückfrage vor und erledigt zuerst die übrigen Änderungen am selben Vorgang. Die Frage erscheint, bevor Jev den Vorgang speichert, verlässt oder den Auftrag abschließt. Nennt der Auftrag einen Teil des Werts, etwa ein Datum ohne Uhrzeit, ist dieser Teil schon eingetragen. Ein Datum ohne Jahr gilt im Jahr des Auftragsstarts. Liegt es in der Vergangenheit, weist die Rückfrage darauf hin.

Öffne **Jev-Einstellungen** in der Palette, um die Sicherheitsschwelle einzustellen. Wähle einen ganzen Prozentwert von 0 bis 100. Unterhalb dieses Werts verlangt Jev eine Bestätigung vor Aktionen und bestätigt keinen Auftragsabschluss. Der Standard ist 75 Prozent. Die Einstellung bleibt in diesem Browser erhalten. Änderst du sie während eines Auftrags, musst du anschließend ausdrücklich fortsetzen.

Bei einem fehlenden Prüfbeleg führt **Prüfbeleg erfassen** direkt zum Feld im betroffenen Vorgang. Trage deine tatsächliche Beobachtung ein, übernimm sie in den Entwurf und speichere. Mit **Auftrag fortsetzen** prüft Jev anschließend den ursprünglichen Abschlussauftrag erneut.

Mit **Demodaten zurücksetzen** unten im Arbeitsbereich stellst du die ursprünglichen Beispieldaten wieder her. Die Bestätigung verwirft gespeicherte Änderungen sowie Entwürfe, Filter und den Jev-Verlauf im aktuellen Tab. Ein laufender Auftrag wird beendet. API-Schlüssel, Betriebsmodus und Sicherheitsschwelle bleiben erhalten, sodass der Reset auch im Live-Modus funktioniert.

Nach jeder Bedienhandlung wählt Jev erneut aus den aktuell zugänglichen Aktionen. Der ursprüngliche Auftrag und die beobachteten Schritte bleiben erhalten. Unsichere Schritte erscheinen konkret zur Bestätigung. Ausdrücklich beauftragte Änderungen werden schrittweise gespeichert. Eine spätere Blockade lässt diese Speicherungen bestehen und wird mit dem erreichten Stand angezeigt.

Zusätzliche fachliche Änderungen, etwa ein Personenwechsel zum Beheben eines Terminkonflikts, benötigen eine konkrete Freigabe. Eine fehlende Prüfung vor Ort lässt sich nicht durch Jev bestätigen. Werte stammen aus dem Auftrag oder vorhandenen Daten.

## Entwicklung

Der öffentliche Vertrag liegt in `shared/contract.ts`. Die TypeSafe-Anbindung läuft ausschließlich im Backend. Die oRPC-Utilities erzeugen typisierte Optionen und Query-Keys. TanStack Query verwaltet Serverdaten über den WebSocket-Client. Fachliche Mutationen prüfen Voraussetzungen und Datenversionen im Backend.

Nach einem Verbindungsabbruch öffnet der nächste Aufruf einen neuen Socket. Laufende Auswertungen werden nicht automatisch wiederholt. Ein Abbruch nach dem Senden kann bedeuten, dass TypeSafe den Text bereits verarbeitet hat.

[Architektur](docs/architecture.md) beschreibt die Zuständigkeiten und den Transport. [Anwendungsfälle](docs/use-cases.md) enthält Auftragsbeispiele mit erwarteten Ergebnissen. [Designsystem](docs/design-system.md) beschreibt die gemeinsame Gestaltung und Bedienung. Der [Aktionskatalog](docs/action-catalog.md) hält 120 geplante Fachaktionen und weitere Stresstestfälle fest.
