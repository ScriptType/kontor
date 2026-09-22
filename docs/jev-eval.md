# Jev-Auswertung über ganze Läufe

`npm run eval:jev` misst, wie gut Jev einen deutschen Auftrag über die sichtbare Oberfläche erledigt. Gezählt wird der ganze Lauf: Startzustand, Auftrag, Rückfragen und der erreichte Endzustand. Varianten des Ablaufs lassen sich so mit denselben Szenarien vergleichen.

Ein Lauf ist magisch, wenn der Endzustand stimmt und Jev nichts fragen musste. Das ist das Produktziel: Dinge passieren genau wie erwartet, ohne viel Aufwand.

## Aufruf

```sh
npm run eval:jev -- --variant baseline
```

Der Befehl baut die Anwendung und sendet echte Anfragen an TypeSafe. Er benötigt den API-Key aus `.env`. Ein Aufruf kostet Bruchteile eines Cents.

| Option | Standard | Bedeutung |
| --- | --- | --- |
| `--variant <label>` | `unlabeled` | Name der Variante. Er steht in allen Ergebnissen. |
| `--seed <n>` | `880001` | Startwert des Szenariogenerators. |
| `--count <n>` | `30` | Anzahl generierter Szenarien zusätzlich zu den festen Szenarien. |
| `--samples <n>` | `1` | Läufe pro Szenario. Die beiden Szenarien mit dem Nutzerauftrag laufen mindestens zweimal. |
| `--only <ids>` | alle | Kommagetrennte Szenario-IDs, etwa `user-fresh,use-10`. |
| `--concurrency <n>` | `1` | Parallele Läufe. Jeder Lauf hat eigenen Server, eigene Datenbank und eigenen Browserkontext. |
| `--out <dir>` | `live-results/jev-eval/<variant>-<zeit>` | Ausgabeverzeichnis. |
| `--max-calls <n>` | `600` | Obergrenze für Anbieteraufrufe des ganzen Laufs. Ein einzelner Lauf endet nach 40 Aufrufen. |
| `--save-mode <modus>` | `auto` | `auto` speichert ohne Nachfrage, `confirm` fragt vor dem Speichern. Der Lauf schreibt `kontor-jev-save-mode-v1` = `{"version":1,"mode":"<modus>"}` vor dem Laden der Seite. Zweige ohne diese Einstellung ignorieren den Schlüssel. |
| `--scenarios <datei>` | eingebaute Szenarien | JSON-Array vollständiger Szenarien statt der festen und generierten Szenarien. `--seed` und `--count` gelten dann nicht. |

## Dimensionen

`shared/dimensions.ts` beschreibt die Stellgrößen eines Auftrags. Wertdimensionen entstehen aus `editableSchema`, `caseFiltersSchema`, `pageSchema` und den Arbeitsbereichsdaten. Zahlen, Termine und Suchtexte sind wörtliche Kandidaten aus `shared/field-values.ts`. Dazu kommen die Menge der betroffenen Vorgänge und vier Schalter: Speichern gewünscht, ausdrücklich nicht speichern, nicht unterstützte Zusatzaufgabe und geordnete Zwischenzustände. Jeder Eintrag enthält seine englische Frage und Beschreibung.

Arbeitszeit ist die Zeit, die die zuständige Person für den Vorgang aufwendet oder braucht. Die Termindauer ist die Länge des Terminfensters.

Ein neues Feld in `editableSchema` oder `caseFiltersSchema` braucht einen Eintrag oder eine begründete Ausnahme in `excludedFields`. Sonst schlägt `tests/dimensions.test.ts` mit dem Feldnamen fehl. Ein neues Bedienelement braucht eine Zuordnung in `actionEffects`. Sonst schlägt `tests/dimensions.e2e.ts` mit der Aktionskennung fehl.

## Szenarien

`scripts/jev-eval/scenarios.ts` erzeugt die Szenarien. Jedes Szenario enthält:

- den deutschen Auftrag mit markierten Störungen, etwa Tippfehlern, bloßen Zahlen wie 1041, Reihenfolgewörtern, Verneinung, zwei Vorgängen, Umgangssprache und nicht unterstützten Zusatzaufgaben,
- den Startzustand mit Seite, geöffnetem Vorgang, Filtern und bereits gespeicherten Werten,
- die beabsichtigten Dimensionswerte, auch für wirklich mehrdeutige Angaben wie „eine Stunde“,
- den genauen erwarteten Endzustand.

Feste Szenarien decken den Nutzerauftrag „Ändere 1041 auf marla …“ zweimal ab. `user-fresh` startet mit geöffnetem V-1041. `user-repeat` startet im erwarteten Ergebnis des ersten Laufs, also mit gespeicherter Mara und 60 Minuten. Dazu kommen die 15 prüfbaren Aufträge aus [use-cases.md](use-cases.md). Generierte Szenarien folgen einem Startwert und bleiben damit reproduzierbar.

Eine Änderung ohne ausdrückliches „nicht speichern“ soll gespeichert werden. Der erwartete Endzustand des Nutzerauftrags legt das fest.

Der Validator verwirft Szenarien, deren erwartete Werte die Oberfläche nicht erreichen kann. Dazu gehören Zahlen ohne wörtlichen Kandidaten oder Antwort, deaktivierte Personen, eine Termindauer ohne Termin, verletzte Fachregeln, eine Speicherung ohne Änderung und mehr als ein ungespeicherter Entwurf.

Eine Szenariodatei hat das Format der `scenarios.json` im Ausgabeverzeichnis. Der Lauf prüft sie vor dem ersten Anbieteraufruf: Schema ohne unbekannte Schlüssel, Validator, eindeutige IDs und ob der erwartete Endzustand aus Start und Absicht folgt. Ein Fehler nennt Szenario und Grund. `report.md` und `results.json` enthalten die SHA-256 der Datei. Ohne Datei steht dort die SHA-256 der geschriebenen `scenarios.json`.

## Ablauf eines Laufs

Jeder Lauf startet den echten Server mit einer Datenbank im Arbeitsspeicher und öffnet Chrome. Gespeicherte Startwerte schreibt der Lauf direkt in die Datenbank. Seite, Vorgang und Filter stellt er über die Oberfläche ein. Die Bestätigungsschwelle ist 75 Prozent.

Danach sendet der Lauf den Auftrag über die Befehlspalette. Er wartet, bis Jev anhält. Ein Halt vor dem Abschluss zählt als Rückfrage: Auswahlprüfung, fehlender Wert, Freigabe und Blockade. Die heutige Oberfläche erhält keine simulierte Antwort. Der Lauf endet an dieser Stelle.

## Bestätigungsvertrag für Varianten

Eine Variante kann Rückfragen zu Dimensionen stellen. Der Lauf beantwortet sie aus der Wahrheit des Szenarios und setzt fort, wenn die Oberfläche diesen Vertrag einhält:

- Ein sichtbares Element mit `data-confirm-dimension="<id>"` ist eine Rückfrage. Die ID stammt aus `shared/dimensions.ts`.
- Bei vorgangsbezogenen Dimensionen nennt `data-confirm-case="<Vorgang>"` den Vorgang. Ohne Angabe gilt der einzige beabsichtigte Wert. Unterscheiden sich die Werte je Vorgang, bleibt die Rückfrage unbeantwortbar.
- Schaltflächen im Element tragen `data-confirm-value`. Werte sind die Schlüssel aus `dimensionOptions`, also Personen-, Kunden- und Vorgangs-IDs, Enumwerte, wörtliche Kandidaten, `all` und `none`. Schalter verwenden `yes` und `no`. `unstated` bedeutet, dass der Auftrag die Dimension nicht setzt.
- Für die Menge `cases` klickt der Lauf jeden beabsichtigten Vorgang und danach `[data-confirm-submit]` im Element.
- Nach einer Antwort muss das Element verschwinden. Solange Jev arbeitet, zeigt die Aktivitätsleiste den laufenden Zustand. Sonst liest der Lauf den Halt zu früh.
- Fehlt der passende Wert, zählt die Rückfrage als unbeantwortbar und der Lauf endet.
- Die Speicherfrage im Modus `confirm` ist ein Element mit `data-confirm-dimension="save"`, optional `data-confirm-case`, und den Schaltflächen `data-confirm-value="yes"` und `"no"`. Der Lauf antwortet `yes`, wenn das Szenario eine Speicherung dieses Vorgangs erwartet, sonst `no`. Ohne Vorgang antwortet er `yes`, wenn das Szenario überhaupt eine Speicherung erwartet.

Jede beantwortete Rückfrage zählt als Frage. Nach höchstens zwölf Antworten endet der Lauf.

## Endzustand und Kennzahlen

Der Lauf liest den Endzustand ohne Prüfhaken im Produktcode:

- gespeicherte Datensätze und Speicherbelege aus der Datenbank des Servers,
- die Seite aus der URL,
- Filter und einen offenen Entwurf aus der Vorgangsseite,
- besuchte Seiten aus dem gespeicherten Jev-Verlauf im Browser.

Der Vergleich verlangt jeden Datensatz exakt. Gespeicherte Zwischenzustände müssen in der erwarteten Reihenfolge vorkommen. Eine Speicherung an einem Vorgang ohne erwartete Änderung ist eine unerwartete Speicherung. Ein ungespeicherter Entwurf ist nur bei „nicht speichern“ richtig. Verlangt ein Auftrag etwas Unmögliches, darf Jev den Auftrag nicht als erledigt melden. Eine abschließende Blockade nach der erreichbaren Arbeit gilt dann als erwartete Übergabe und nicht als Frage.

Jeder Lauf erhält genau eine Kategorie. Ein Fehler geht vor, danach der Halt an einer unbeantworteten Frage, danach der Endzustand.

| Kategorie | Bedeutung |
| --- | --- |
| magic | Endzustand richtig, keine Frage und keine Übergabe. |
| handoff | Endzustand richtig, und der Lauf hält korrekt für die erwartete Übergabe an einen Menschen an. Das ist nicht magic, auch nicht nach beantworteten Chips. |
| correct-after-chips | Endzustand richtig, und jede Frage war ein Chip, den der Lauf beantwortet hat. |
| stopped-unanswered | Der Lauf endet an einer Frage ohne Chip-Antwort: Auswahlprüfung, fehlender Wert, Freigabe, Blockade ohne erwartete Übergabe oder unbeantwortbarer Chip. Der Bericht zählt in Klammern, wie oft der Endzustand in diesem Moment schon stimmte. |
| asked-wrong | Chips beantwortet, Endzustand trotzdem falsch. |
| silent-wrong | Endzustand falsch oder unerwartete Speicherung, ohne Frage. |
| error | Anbieter- oder Harnessfehler, etwa Zeitüberschreitung. |

`magic-save-check` zählt magic und die Läufe unter correct-after-chips, deren Chips alle Speicherfragen waren. Das ist das Ziel des Modus `confirm`: Jev fragt nur, ob gespeichert werden soll. Der Bericht zeigt die Kennzahl in beiden Modi. Im Modus `auto` erscheint keine Speicherfrage, dort entspricht sie magic.

Dazu kommen die Fragen als Mittelwert je Lauf und als Anteil der Läufe mit mindestens einer Frage, die Anbieteraufrufe und die Laufzeit vom Absenden bis zum letzten Halt.

Ältere Berichte kennen `correct-after-questions` statt `correct-after-chips` und zählen eine erwartete Übergabe als magic. Läufe, die an einer unbeantworteten Frage endeten, stehen dort unter `correct-after-questions` oder `asked-wrong`. magic und silent-wrong bleiben vergleichbar: Ein älterer magic-Wert entspricht magic plus handoff ohne Chips, silent-wrong ist unverändert.

## Ausgabe

Das Ausgabeverzeichnis enthält `report.md`, `results.json`, `scenarios.json` und je Lauf eine Datei unter `samples/`. Eine Lauf-Datei enthält Halte, Schritte, beobachteten Endzustand, Abweichungen und die Anbieterantworten mit Auswahl und Confidence. Trägt der Eintrag des Laufs im Jev-Verlauf `coverageProbability` oder `checklist`, übernimmt der Lauf beide in den beobachteten Endzustand. `coverageProbability` steht zusätzlich im Ergebnis und in der Spalte coverage des Berichts. Fehlt ein Feld, steht dort `null`. `live-results/` bleibt außerhalb von Git.

Jeder Aufruf hängt nach dem letzten Lauf eine Zeile an `live-results/jev-eval-runs.tsv` im Hauptverzeichnis des Repositorys an, auch aus einem Worktree. Die Datei beginnt mit der Kopfzeile `ts`, `variant`, `branch`, `commit`, `scenarios sha256`, `count`, `samples`, `save mode`, `threshold`, `out dir`, `provider calls`, `magic`, `silent-wrong`. `count` ist die Zahl der Szenarien und `samples` die Zahl der abgeschlossenen Läufe. `magic` und `silent-wrong` sind Anzahlen dieser Läufe. `commit` endet auf `-dirty`, wenn versionierte Dateien geändert sind. Parallele Aufrufe schreiben jede Zeile vollständig und die Kopfzeile genau einmal.

## Pfad nachspielen

`scripts/jev-eval/replay.ts` spielt einen menschlichen Pfad durch die Oberfläche nach, ohne Anbieteraufruf. So lässt sich prüfen, welche Schritte ein Szenario braucht und ob sein erwarteter Endzustand erreichbar ist. Der Befehl läuft im Wurzelverzeichnis des Checkouts:

```sh
node --import tsx scripts/jev-eval/replay.ts --scenarios <datei.json> --id <szenario-id> --steps '<json-array>'
```

Ohne `--scenarios` gelten die festen Szenarien. Ein Schritt ist `{"action":"<data-action>"}` oder `{"field":"<data-field>","value":"<text>"}`. Beispiel für `user-fresh`:

```sh
node --import tsx scripts/jev-eval/replay.ts --id user-fresh --steps '[{"action":"case:V-1041"},{"action":"menu:technician"},{"action":"technician:mara"},{"field":"minutes","value":"60"},{"action":"save"},{"action":"menu:customer"},{"action":"customer:nord"},{"action":"nav:reports"}]'
```

Der Befehl verwendet den vorhandenen Build in `dist/` und baut nie. Er startet Server und Chrome wie ein Lauf und stellt den Startzustand mit demselben Code ein. Eine Aktion klickt das sichtbare, aktive Element. Ein Feld füllt das sichtbare Eingabefeld und löst `input` und `change` aus. Nach jedem Schritt wartet der Befehl auf offene Speicherungen und das Rendern. Den Endzustand liest und bewertet er wie ein Lauf. Als letzter Halt gilt „erledigt“, bei erwarteter Übergabe die Blockade. Besuchte Seiten stammen aus der URL nach jedem Schritt.

Die Ausgabe ist JSON mit `id`, `endCorrect`, `mismatches`, `unexpectedSaves`, `executed` und `failedStep`. `executed` nennt die ausgeführten Schritte im Schrittformat von Jev, Felder als `field:<id>:<wert>`. `failedStep` ist `null` oder `{index, step, reason}` mit dem Grund `not on screen`, `not visible`, `disabled` oder der Meldung von Playwright. Nach einem fehlgeschlagenen Schritt endet das Nachspielen und bewertet den erreichten Zustand.

## Nicht gemessen

- Verständlichkeit und Qualität der Rückfragen. Der Lauf zählt sie nur.
- Die richtige Antwort auf eine heutige Rückfrage. Der Lauf endet dort.
- Sichtbarkeit, Fokus und Lesbarkeit des Endzustands für Menschen.
- Wirkungen auf Kennzahlen anderer Seiten. Sie folgen aus den gespeicherten Daten.
- Varianz jenseits der gewählten Stichproben. Ein Lauf pro Szenario zeigt Tendenzen, keine stabilen Raten.
