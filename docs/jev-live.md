# Deutsche Aufträge mit Live-Jev prüfen

Der Live-Lauf bedient die gebaute Angular-Anwendung in Google Chrome. Auftragserkennung und jede Auswahl eines sichtbaren Bedienelements gehen an TypeSafe. Die Prüfung der Ergebnisse erfolgt im Testcode anhand der Oberfläche und der Datenbank.

## Voraussetzungen

Verwende Node 24 und installiere die Projektabhängigkeiten mit `npm ci`. Google Chrome muss lokal verfügbar sein. Hinterlege `TYPESAFE_API_KEY` in der nicht versionierten `.env`. Der Lauf sendet die festgelegten Beispielaufträge an TypeSafe und kann Kosten verursachen.

## Szenarien ausführen

```sh
npm run test:live
```

Wiederhole nur den ursprünglichen Filterfall mit einem kleineren Aufrufbudget:

```sh
npm run test:live -- --scenario=filter-original --repeat=3 --max-calls=40
```

Mit `--scenario=filter-original,time-draft,assign` wählst du mehrere Fälle aus. `--repeat` ist standardmäßig `1`, `--max-calls` begrenzt den gesamten Lauf auf `150` Provider-Aufrufe. `--timeout-ms` begrenzt die Laufzeit auf standardmäßig `300000` Millisekunden. Ein ausgeschöpftes Budget lässt übrige Fälle als nicht ausgeführt im Bericht stehen und beendet den Lauf mit einem Fehlerstatus.

Jedes Szenario beginnt mit einer neuen Browserumgebung und einer eigenen Datenbank im Arbeitsspeicher. `kontor.sqlite`, offene Formulare und gespeicherte Aufträge der laufenden Entwicklungsanwendung werden nicht verwendet.

Das Szenario `filter-scope` beantwortet nur seine festgelegten Rückfragen nach V-1042 und Hafen & Partner. Danach muss die App den Konflikt zwischen Filter und Zielvorgang zeigen. `schedule-conflict` prüft die angebotene Alternative und bestätigt ausdrücklich Lea Sommer, bevor es den gespeicherten Termin und die Zuweisung prüft.

Die Szenarien prüfen Kundenfilter, Kombinationen mit offenen Vorgängen, gespeicherte Zuweisungen, ungespeicherte Entwürfe, fehlende Angaben, Abschlussblockaden und ausdrücklich vorgegebene Reihenfolgen. Aufträge mit nicht unterstützten zusätzlichen Änderungen oder mehreren Zielvorgängen dürfen keine Teiländerung ausführen.

Wenn ein Szenario eine Auftragsbestätigung erreicht, prüft es die konkrete Zusammenfassung vor dem Klick. Bis dahin dürfen weder sichtbare Aktionen noch gespeicherte Änderungen erfolgt sein. Der Bericht trennt `interpretationPath` mit `direct` oder `confirmed` vom erwarteten Ergebnis `outcomeKind` mit `filter`, `change` oder `question`. Eine direkt erkannte Rückfrage ist damit keine abgeschlossene Änderung. Ein allgemeiner Abbruch zählt nicht als erfolgreiche Rückfrage.

Ein erfolgreicher Filter benötigt den richtigen sichtbaren Filter und unveränderte Fachdaten. Ein erfolgreicher Speicherauftrag benötigt die erwartete Änderung am richtigen Vorgang. Eine erwartete Rückfrage muss den fehlenden Wert oder die tatsächliche Blockade betreffen. Die bloße Rückmeldung des Modells, dass eine Aktion passend sei, ist kein bestandener Test.

## Fehler auswerten

Die Ausgabe nennt den Bericht unter `live-results/<Zeitstempel>/report.json`. Dieses Verzeichnis bleibt außerhalb von Git. Der Bericht enthält die erwarteten und beobachteten Ergebnisse, die Antworten mit Confidence, das vom Anbieter gemeldete Modell, Aufrufzahlen und Laufzeiten. Screenshots zeigen die Oberfläche am Ende jedes Szenarios. Der API-Key und Anfrageheader gehören nicht zum Bericht.

Prüfe bei einem Fehler zuerst die tatsächlich angebotenen Fragen und Antwortoptionen, danach Jevs Auswahl und Confidence. Vergleiche diese mit dem beobachteten UI-Zustand und den gespeicherten Daten. So lassen sich Erkennungsfehler, unsichere Aktionsentscheidungen und Fehler bei der Ausführung unterscheiden.

Eine fehlgeschlagene oder unvollständige Prüfung zählt nicht als bestanden. Provider-Ausfälle und Budgetgrenzen dürfen das Ergebnis nicht in einen Erfolg umwandeln. Ein einzelner grüner Lauf misst nur die enthaltenen Formulierungen mit dem im Bericht genannten Modell.

## Zuständigkeiten und Quellen

Die normalen Prüfungen über `npm run verify` bleiben ohne Anbieterzugriff. Sie prüfen Regeln, Fehlerfälle und den Ablauf mit vorgegebenen Antworten. Live-Szenarien prüfen zusätzlich, ob echte Modellantworten für diese Formulierungen zum erwarteten Verhalten führen.

Die [TypeSafe-Primitiven](https://docs.typesafe.ai/primitives) beschreiben vollständige Einzelfragen, explizite Bezüge auf Eingabefelder und das gemeinsame Senden unabhängiger Fragen. Nicht relevante Antworten werden erst im Anwendungscode ausgeblendet. Die [Confidence-Dokumentation](https://docs.typesafe.ai/confidence) trennt Modellunsicherheit von der Entscheidung, eine Aktion auszuführen.

[Jev Browser](https://github.com/tontoko/jev-browser/blob/0b516327152f3772bebe275f7cbe3d651d106ed6/test/live-goal.mjs) prüft echte Provider-Aufrufe ebenfalls an synthetischen Anwendungen und kontrolliert Ergebnisse unabhängig vom Modell. Kontor verwendet dieses Prüfprinzip. Die Ausführung in der Anwendung bleibt bei den registrierten Angular-Bedienelementen.
