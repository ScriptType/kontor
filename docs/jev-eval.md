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

Jede beantwortete Rückfrage zählt als Frage. Nach höchstens zwölf Antworten endet der Lauf.

## Endzustand und Kennzahlen

Der Lauf liest den Endzustand ohne Prüfhaken im Produktcode:

- gespeicherte Datensätze und Speicherbelege aus der Datenbank des Servers,
- die Seite aus der URL,
- Filter und einen offenen Entwurf aus der Vorgangsseite,
- besuchte Seiten aus dem gespeicherten Jev-Verlauf im Browser.

Der Vergleich verlangt jeden Datensatz exakt. Gespeicherte Zwischenzustände müssen in der erwarteten Reihenfolge vorkommen. Eine Speicherung an einem Vorgang ohne erwartete Änderung ist eine unerwartete Speicherung. Ein ungespeicherter Entwurf ist nur bei „nicht speichern“ richtig. Verlangt ein Auftrag etwas Unmögliches, darf Jev den Auftrag nicht als erledigt melden. Eine abschließende Blockade nach der erreichbaren Arbeit gilt dann als erwartete Übergabe und nicht als Frage.

| Kennzahl | Bedeutung |
| --- | --- |
| magic | Endzustand richtig und keine Frage. |
| Fragen | Mittelwert je Lauf und Anteil der Läufe mit mindestens einer Frage. |
| silent-wrong | Endzustand falsch oder unerwartete Speicherung, ohne Frage. |
| correct after questions | Endzustand richtig nach mindestens einer Frage. |
| asked, still wrong | Frage gestellt, Endzustand trotzdem falsch. |
| errors | Anbieter- oder Harnessfehler, etwa Zeitüberschreitung. |
| Aufrufe, Zeit | Anbieteraufrufe und Laufzeit vom Absenden bis zum letzten Halt. |

## Ausgabe

Das Ausgabeverzeichnis enthält `report.md`, `results.json`, `scenarios.json` und je Lauf eine Datei unter `samples/`. Eine Lauf-Datei enthält Halte, Schritte, beobachteten Endzustand, Abweichungen und die Anbieterantworten mit Auswahl und Confidence. `live-results/` bleibt außerhalb von Git.

## Nicht gemessen

- Verständlichkeit und Qualität der Rückfragen. Der Lauf zählt sie nur.
- Die richtige Antwort auf eine heutige Rückfrage. Der Lauf endet dort.
- Sichtbarkeit, Fokus und Lesbarkeit des Endzustands für Menschen.
- Wirkungen auf Kennzahlen anderer Seiten. Sie folgen aus den gespeicherten Daten.
- Varianz jenseits der gewählten Stichproben. Ein Lauf pro Szenario zeigt Tendenzen, keine stabilen Raten.
