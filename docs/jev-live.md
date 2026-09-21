# Deutsche Aufträge mit Live-Jev prüfen

Der Live-Lauf bedient die gebaute Angular-Anwendung in Google Chrome. Jev wählt bei jedem Schritt aus den tatsächlich angebotenen Bedienelementen. Eine weitere Bewertung prüft konkrete Änderungen und Abschlussvorschläge. Der Test kontrolliert Oberfläche und Datenbank unabhängig davon. Erwartete Ergebnisse werden nicht an Jev gesendet.

## Voraussetzungen

Verwende Node 24 und installiere die Projektabhängigkeiten mit `npm ci`. Google Chrome muss lokal verfügbar sein. Hinterlege `TYPESAFE_API_KEY` in der nicht versionierten `.env`. Der Lauf sendet die festgelegten Beispielaufträge an TypeSafe und kann Kosten verursachen.

## Szenarien ausführen

```sh
npm run test:live
npm run test:live -- --scenario=customers,filter-original,no-save --max-calls=40
npm run test:live -- --scenario=repeated-assignment --repeat=2 --max-calls=40
npm run test:live -- --scenario=detail-short-id,detail-first-row,detail-last-row --max-calls=20
npm run test:live -- --scenario=filter-exact-clean,filter-exact-preselected,filter-exact-already-filtered,domain-blocker --max-calls=30
```

`--scenario` wählt eine durch Kommas getrennte Liste aus. `--repeat` ist standardmäßig `1`. `--max-calls` begrenzt den gesamten Lauf auf standardmäßig `160` Anbieteraufrufe. `--timeout-ms` begrenzt ihn auf standardmäßig `600000` Millisekunden. Ein ausgeschöpftes Budget lässt übrige Fälle als nicht ausgeführt im Bericht stehen und beendet den Lauf mit einem Fehlerstatus.

Jedes Szenario beginnt mit einer neuen Browserumgebung und einer eigenen Datenbank im Arbeitsspeicher. `kontor.sqlite`, offene Formulare und gespeicherte Aufträge der laufenden Entwicklungsanwendung werden nicht verwendet.

Die Szenarien prüfen Navigation, ausdrücklich geordnete Seitenwechsel, Suche, Kundenfilter, Änderungen und anschließende Navigation, mehrere Vorgänge, wiederholte Zuweisungen, fehlende Werte, ungespeicherte Entwürfe und fachliche Blockaden. Ein weiterer Fall verlangt nach einer beauftragten Speicherung eine nicht verfügbare E-Mail-Aktion. Bereits gespeicherte Änderungen müssen erhalten bleiben, ohne den gesamten Auftrag als erledigt auszugeben.

Die drei Detailfälle prüfen eine verkürzte Vorgangskennung sowie die erste und letzte Tabellenzeile. Die erwartete Zeile wird vor dem Auftrag aus der gerenderten Tabelle gelesen. Der Test verlangt den richtigen Vorgang, eine vollständig sichtbare und fokussierte Detailüberschrift unterhalb der fixierten Aktivitätsleiste und unveränderte gespeicherte Daten.

Die drei `filter-exact-*`-Fälle verwenden "zeige mir alle vorgänge von nordwerk". Sie beginnen ohne Auswahl, mit geöffnetem V-1039 oder mit geöffnetem V-1039 und bereits gesetztem Kundenfilter. Neben den richtigen Zeilen prüft der Lauf unveränderte Daten, Auswahl und Formularwerte. Ein Hinweis auf den fehlenden Prüfbeleg ist bei diesem Auftrag ein Fehler. `domain-blocker` prüft dagegen den ausdrücklich gewünschten Abschluss von V-1039.

## Ergebnisse bewerten

Der Standardlauf bestätigt keine unsicheren Schritte automatisch. Eine solche Pause bleibt für einen vorgesehenen vollständigen Ablauf ein fehlgeschlagenes Szenario. `autonomous-completion` bezeichnet einen vollständig erreichten und unabhängig geprüften Endzustand. `expected-handoff` bezeichnet eine ausdrücklich erwartete konkrete Rückfrage oder Blockade. Beides sind unterschiedliche Ergebnisse.

Ein Kundenfilter benötigt die richtigen Zeilen und Filterwerte bei unveränderten Fachdaten. Eine Mutation benötigt den genauen erwarteten Datenstand ohne zusätzliche Änderungen. Ein Entwurf muss den gewünschten sichtbaren Wert enthalten und die gespeicherten Daten unverändert lassen. Eine Rückfrage muss den richtigen Vorgang und fehlenden Wert oder die vorhandene Blockade betreffen. Ein Anbieterfehler zählt nicht als gelungene Rückfrage.

Bei wiederholten Zuweisungen prüft der Lauf die Speicherbelege in Reihenfolge. Der Endwert allein genügt nicht, weil eine Rückkehr zum Ausgangswert einen übersprungenen Zwischenstand verbergen könnte. Navigation darf unterschiedliche sichtbare Wege verwenden, sofern der Auftrag keine bestimmte Reihenfolge verlangt.

Eine gesonderte Prüfung mit menschlicher Bestätigung muss vor dem Klick den konkreten Vorschlag gegen den ursprünglichen Auftrag prüfen. Sie muss die Bestätigung im Ergebnis ausweisen. Eine falsche vorgeschlagene Änderung darf nicht bloß zum Fortsetzen bestätigt werden.

## Fehler auswerten

Die Ausgabe nennt den Bericht unter `live-results/<Zeitstempel>/report.json`. Dieses Verzeichnis bleibt außerhalb von Git. Der Bericht enthält Aufträge, angebotene Aktionen, aktuelle Bildschirmfakten, beobachtete Schritte, Modellantworten und Confidence, das gemeldete Modell, Aufrufzahlen und den gespeicherten Endzustand. API-Key und Anfrageheader werden nicht aufgezeichnet.

Prüfe zuerst die angebotenen Optionen, danach Jevs Auswahl und Confidence. Vergleiche sie mit sichtbarem Zustand, tatsächlichen Feldwerten und Speicherbelegen. So lassen sich falsche Auswahl, unsichere Bewertung und Fehler bei der Bedienung unterscheiden. Eine Abschlussmeldung allein beweist keinen Erfolg.

Fehlgeschlagene und unvollständige Prüfungen bleiben im Bericht. Ein erneuter erfolgreicher Lauf ersetzt sie nicht. Ein grüner Lauf misst nur seine Formulierungen mit dem gemeldeten Modell. [Offene Prüfungen](known-issues.md) dokumentiert die bekannten Grenzen.

## Messung vom 20. September 2026

Der vollständige Lauf auf `f9828d2` verwendete `jev-1.13.0` und 86 Anbieteraufrufe. Alle 18 Szenarien wurden ausgeführt. Acht erreichten ihr Ziel autonom, drei übergaben wie erwartet an den Nutzer, sieben bestanden ihre Erwartungen nicht. Der Prozess endete entsprechend mit Exit-Code 1. Der lokale Bericht liegt unter `live-results/2026-09-20T19-20-39.762Z/report.json`.

| Szenario | Ergebnis | Beobachtung |
| --- | --- | --- |
| `customers` | Autonom erledigt | Kundenansicht geöffnet. |
| `navigation` | Autonom erledigt | Kunden, danach Team. |
| `ordered-navigation` | Autonom erledigt | Kunden, Berichte, Team in verlangter Reihenfolge. |
| `search` | Autonom erledigt | Suche nach „Wartung“ und genaue Ergebniszeilen. |
| `filter-original` | Autonom erledigt | „Filter nach nordwerk“ öffnet das Menü und setzt den Kundenfilter. |
| `filter-open` | Nicht bestanden | Passender erster Schritt benötigt Bestätigung bei Confidence 0,50. |
| `filter-hafen` | Nicht bestanden | Jev verwendet die Textsuche; die Abschlussbewertung bleibt unter der Schwelle. |
| `edit-save-reports` | Nicht bestanden | Die angefragten 35 Minuten benötigen Bestätigung bei Bewertungs-Confidence 0,74. |
| `assign` | Autonom erledigt | V-1042 wird Lea zugewiesen und gespeichert. |
| `multi-record` | Autonom erledigt | Zwei Vorgänge mit den richtigen Zuweisungen gespeichert. |
| `repeated-assignment` | Nicht bestanden | Erste Speicherung korrekt; danach falschen Vorgang geöffnet und bei unsicherer Änderung pausiert. |
| `missing-value` | Erwartete Übergabe | Richtiger Vorgang geöffnet; Arbeitszeit erfragt. |
| `no-save` | Autonom erledigt | 25 Minuten als sichtbarer Entwurf, Datenbank unverändert. |
| `assign-no-save` | Nicht bestanden | Passende Zuweisung benötigt Bestätigung bei Bewertungs-Confidence 0,71. |
| `domain-blocker` | Erwartete Übergabe | V-1039 geöffnet; fehlender menschlicher Prüfbeleg sichtbar. |
| `partial-trailing` | Erwartete Übergabe | Zuweisung gespeichert; nicht verfügbarer E-Mail-Auftrag bleibt offen. |
| `requested-order` | Nicht bestanden | Minuten entgegen der verlangten Reihenfolge im Entwurf geändert; vor Abschluss pausiert. Keine Speicherung. |
| `durations` | Nicht bestanden | Arbeitszeit benötigt Bestätigung; Termin und Dauer noch nicht ausgefüllt. |

Gesonderte Läufe prüften abweichende Formulierungen. Auf `850a4d8` gelangen Kundenansicht, Suche und „37 Minuten speichern, danach Team öffnen“ autonom. Ein Auftrag über zwei Vorgänge mit abschließender Berichtsansicht gelang mit einer ausdrücklichen Bestätigung zum Öffnen des Personenmenüs. Diese vier gezielten Erfolge ersetzen die Fehler des vollständigen Laufs nicht.

Auf `5013c8a` bestanden vier weitere Live-Prüfungen mit insgesamt 20 Anbieteraufrufen. Kundenansicht und „37 Minuten speichern, danach Team öffnen“ wurden autonom erledigt. Die Zuweisung vor einem nicht verfügbaren E-Mail-Versand blieb gespeichert; V-1039 führte zur sichtbaren Übergabe für den Prüfbeleg. Keine der vier Prüfungen benötigte eine Bestätigung. Sie kontrollierten außerdem, dass eine normale Speicherung keinen neueren ungespeicherten Entwurf meldet. Der Bericht liegt lokal unter `live-results/independent-2026-09-20T19-26-23.883Z/report.json`.

Der integrierte Stand `2ed6c20` zeigt bestätigte Speicherungen unmittelbar in der Rückfrage. Zwei abschließende Live-Prüfungen belegten diese Anzeige und die Prüfbeleg-Übergabe mit neun Aufrufen ohne Bestätigung. Bericht und Bildschirmaufnahmen liegen lokal unter `live-results/independent-2026-09-20T19-28-23.707Z/`. `npm run verify` bestand auf diesem Stand mit 27 Unit- und Integrationstests sowie 31 Browser-Tests einschließlich Unterbrechung, Reset, Neuladen und verspäteter Speicherantworten.

Die Confidence-Schwelle blieb bei 0,75. Es wurden weder erwartete nächste Aktionen an Jev übermittelt noch falsche Vorschläge bestätigt. Die Beobachtungen zu Zielvorgang und Reihenfolge bleiben als [bekannte Modellfehler](known-issues.md#ki-002-modellunsicherheit-und-mehrteilige-aufträge) offen.

## Bildschirmkontext und Detailansicht

Auf `4840c8d` prüfte der unveränderte Live-Runner sechs Szenarien mit `jev-1.13.0` und 22 Anbieteraufrufen. Der Bericht liegt lokal unter `live-results/2026-09-20T19-58-19.605Z/report.json`. Der Prozess endete wegen der Bestätigungspause mit Exit-Code 1.

| Szenario | Ergebnis | Beobachtung |
| --- | --- | --- |
| `detail-short-id` | Autonom erledigt | V-1042 geöffnet; Detailüberschrift sichtbar und fokussiert. |
| `detail-first-row` | Autonom erledigt | Tatsächliche erste Tabellenzeile geöffnet; Überschrift sichtbar und fokussiert. |
| `detail-last-row` | Nicht autonom erledigt | Richtiger Vorschlag V-1035, Bestätigung bei Confidence 0,59 erforderlich. |
| `assign` | Autonom erledigt | V-1042 Lea zugewiesen und gespeichert. |
| `no-save` | Autonom erledigt | 25 Minuten im sichtbaren Entwurf; gespeicherte Daten unverändert. |
| `domain-blocker` | Erwartete Übergabe | V-1039 geöffnet; fehlender menschlicher Prüfbeleg sichtbar. |

Eine unabhängige anschließende Browserprüfung auf demselben Stand verwendete sechs weitere Anbieteraufrufe. „Öffne Details von 1042“ gelang autonom. Für die letzte Tabellenzeile wurde der konkrete Vorschlag V-1035 geprüft und einmal ausdrücklich bestätigt. Danach war auch diese Detailüberschrift sichtbar und fokussiert. Beide gespeicherten Datenstände blieben unverändert. Dieser bestätigte Ablauf ersetzt den fehlgeschlagenen Autonomietest nicht.

Die Berichte, Vorher-Messung, Kontextversuche und Bildschirmaufnahmen liegen lokal unter `live-results/screen-context-2026-09-20/`. Die endgültige Prüfung verändert keine Anbieteranfragen. `npm run verify` bestand auf dem integrierten Stand mit 27 Unit-/Integrationstests und 39 Browser-Tests. Dazu gehören tatsächliche Tabellenreihenfolge nach Filtern, ausgeblendete Bereiche, verspätete Antworten nach Scrollen, Entwurfserhalt und ein Stopp während des verzögerten Schließens der Palette.

## Auftragsbezogene Blockaden

Auf `a58d322` prüfte der Standardlauf vier Szenarien mit `jev-1.13.0` und zehn Anbieteraufrufen. Er bestätigte keinen Vorschlag automatisch und endete mit Exit-Code 1. Der Bericht liegt lokal unter `live-results/2026-09-21T11-39-47.898Z/report.json`.

| Szenario | Ergebnis | Beobachtung |
| --- | --- | --- |
| `filter-exact-clean` | Nicht autonom erledigt | Kundenfilter gesetzt; Abschlussbewertung bei 0,71. Kein fachlicher Blockadehinweis. |
| `filter-exact-preselected` | Nicht autonom erledigt | Passender Vorschlag zum Öffnen des Kundenfilters benötigt Bestätigung bei 0,59. Auswahl und Entwurf unverändert. |
| `filter-exact-already-filtered` | Nicht autonom erledigt | Richtige Liste bleibt sichtbar; `done` bei 0,73, Abschlussbewertung bei 0,62. Kein Prüfbeleg-Hinweis. |
| `domain-blocker` | Erwartete Übergabe | V-1039 geöffnet; `blocked` bei 0,73, konkret zugeordnete Abschlussaktion bei 0,98. Keine Datenänderung. |

Eine unabhängige Prüfung verwendete dieselben drei Filterzustände und zehn weitere Aufrufe. Alle zeigten die richtigen Nordwerk-Zeilen ohne Prüfbeleg-Hinweis. Gespeicherte Daten, Auswahl und Formularwerte blieben unverändert. In zwei Fällen wurde der konkrete Vorschlag zum Öffnen des Filtermenüs geprüft und einmal bestätigt. Nur der Fall mit vorher geöffnetem V-1039 erreichte danach eine Erledigungsmeldung. Die beiden anderen blieben bei der Ergebnisbewertung unsicher. Der Bericht liegt unter `live-results/filter-scope-2026-09-21/probe-2026-09-21T11-39-47.780Z/report.json`.

Die gesonderte Live-Prüfung von "Schließe V-1039 ab." benötigte drei Aufrufe und keine Freigabe eines Modellvorschlags. Die Palette zeigte den fehlenden Prüfbeleg für V-1039. Erst ein Klick auf **Prüfbeleg erfassen** fokussierte dessen leeres Eingabefeld. Die Daten blieben unverändert. Bericht und Bildschirmaufnahmen liegen unter `live-results/filter-scope-2026-09-21/handoff-2026-09-21T11-40-20.875Z/`.

Frühere Fehlversuche bleiben in `live-results/filter-scope-2026-09-21/` erhalten. Dazu gehört die genaue Reproduktion des falschen Hinweises bei null ausgeführten Aktionen. Eine erste Umsetzung verhinderte außerdem bei unsicherem `blocked` schon die reine Nachfrage nach der Ursache. Der aktuelle Ablauf trennt diese Informationsfrage von einer Ausführungsfreigabe. Die Schwellen für Bedienhandlungen und Abschlussbewertungen bleiben bei 0,75.

`npm run verify` bestand auch nach der Übernahme ins Hauptverzeichnis mit Typprüfung, Build, 30 Unit- und Integrationstests sowie 51 Browser-Tests. Die ursprüngliche Regression verlangte null unpassende Blockadehinweise und erhielt vor der Korrektur einen. Sie besteht jetzt ebenso wie unbekannte Ursachen, veraltete Antworten und die manuelle Übergabe nach dem Dialogschließen. Das Protokoll liegt unter `live-results/filter-scope-2026-09-21/integrated-verify.log`.

## Zuständigkeiten und Quellen

`npm run verify` bleibt ohne Anbieterzugriff. Es prüft Regeln, Transport, Fehlerfälle und den Ablauf mit vorgegebenen Antworten. Live-Szenarien prüfen zusätzlich, ob echte Modellantworten zum erwarteten Verhalten führen.

Die [TypeSafe-Primitiven](https://docs.typesafe.ai/primitives) beschreiben geschlossene Fragen und die unabhängige Bewertung gemeinsamer Eingaben. Die [Confidence-Dokumentation](https://docs.typesafe.ai/confidence) trennt Modellunsicherheit von einer Entscheidung über Ausführung.

[Jev Browser](https://github.com/tontoko/jev-browser/blob/0b516327152f3772bebe275f7cbe3d651d106ed6/src/runner.ts) verwendet ebenfalls wiederholte Entscheidungen auf aktuellen Beobachtungen und führt Ergebnisse im Verlauf mit. Kontor verwendet ausdrücklich registrierte Angular-Bedienelemente und prüft deren Auswirkungen unabhängig vom Modell.
