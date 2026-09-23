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
| `--threshold <n>` | `75` | Sicherheitsschwelle in Prozent von 0 bis 100. Der Lauf schreibt sie vor dem Laden der Seite nach `kontor-jev-confidence-v1`. |
| `--gate <name>` | `threshold` | Regel, nach der eine Entscheidung ohne Nachfrage ausgeführt wird. Die Anwendung verwendet ohne gespeicherte Wahl `g4`. Die Auswertung bleibt bei `threshold`, damit frühere Läufe vergleichbar bleiben; das Produktverhalten misst `--gate g4`. `threshold` vergleicht die Auswahl-Confidence mit der Schwelle. `g1` vergleicht die höchste Optionswahrscheinlichkeit mit einer Schwelle je Art der Wahl: Ansicht 70 %, Entwurf 85 %, Speichern oder Verwerfen 75 %, Abschluss oder Halt 65 %. Eine Rückfrage behält die Schwelle aus `--threshold`. Die Abschlussbewertung prüft unter `g1` die Wahrscheinlichkeit von `complete` je Art der bisherigen Arbeit: nur Ansicht 60 %, Entwurf ohne Speichern 85 %, gespeichert 80 %. `g2-effect` gleicht `g1`, lässt aber eine Ansicht ab 30 % wirken und einen gebundenen Entwurf ab 70 % ohne eigene Umfangsprüfung. Gebunden ist ein Wert aus dem Auftrag, den ein Feldwort oder der Feldtyp genau diesem Feld zuordnet und der als einziger Auftragswert für dieses Feld des Vorgangs angeboten wird. `g2-exits` gleicht `g1`, bietet `done` aber erst nach dem ersten ausgeführten Schritt an. `g2-pool` gleicht `g1`, summiert aber die Wahrscheinlichkeiten aller Optionen mit gleicher Wirkung. Die stärkste Gruppe muss die Schwelle erreichen und die nächste um 10 Prozentpunkte übertreffen. `g2` verbindet `g2-pool` mit den Schwellen und Umfangsprüfungen von `g2-effect` und bietet `done` wie `g2-exits` erst nach dem ersten Schritt an. `explore-nomem` lässt jede Ansicht sofort und einen Entwurf ab 60 % ohne Umfangsprüfung wirken, behält für Speichern, Abschluss und Halt die Schwellen von `g1`, bietet `done` erst nach dem ersten Schritt an und hält bei Schleifen und nach dem Schrittbudget an: eine Aktion zweimal ohne Änderung, dieselbe Seite zum dritten Mal ohne Datenänderung, 8 plus 4 Schritte je Teilsatz, höchstens 24. `explore` gleicht `explore-nomem` und sendet Jev zusätzlich den schlanken Zustand mit kurzem Schrittverlauf und ohne Optionen ohne Wirkung. `g3` summiert Optionen mit gleicher Wirkung und verlangt 10 Prozentpunkte Abstand zur nächsten Wirkung. Ansichten wirken ab 30 %, Entwürfe über Buttons und Feldwerte ab 60 %. Nur ungebundene Feldwerte, Speichern und Verwerfen erhalten eine Umfangsprüfung. Speichern, Abschluss und Halt behalten die Schwellen von `g1`. `done` gibt es erst nach dem ersten Schritt, und Schleifen und Schrittzahl sind begrenzt wie unter `explore-nomem`. `g3-mem` gleicht `g3` und sendet der Entscheidung den schlanken Zustand ohne Optionen ohne Wirkung. Umfangs- und Abschlussprüfung erhalten den vollständigen Zustand. `g3-focused` gleicht `g3`, wiederholt den Auftrag am Ende des Zustands, ergänzt Hinweise aus dem Auftrag und sendet der Entscheidung keine Aktionsliste im Zustand. `g3-compact` gleicht `g3-focused` und kürzt zusätzlich Optionstexte und Bildschirmangaben, siehe [architecture.md](architecture.md). `g3-compact-plan` gleicht `g3-compact` und liest beim Start den ganzen Auftrag als Plan. Stimmt der Plan genau mit der Wahl überein, gibt er eine Auswahl unter ihrer Schwelle und die Abschlussbewertung von `done` frei. `g3-compact-plan-effect` gibt zusätzlich eine nicht bestätigte Umfangsprüfung frei, außer bei einem verbotenen Schritt. `g3-cpe-duel` gleicht `g3-compact-plan-effect`. Wirkt eine Ansicht, ein Entwurf oder `blocked` nicht, wählt Jev in einem zweiten Aufruf erneut zwischen den beiden stärksten Wirkungen. Ab 75 % für die Gewinnerin läuft der Lauf mit ihr weiter, sonst hält er wie bisher. Die Stichprobe enthält jeden zweiten Blick unter `observed.duels`. `g3-cpe-duel-nr` gleicht `g3-cpe-duel` und bietet eine Ansicht oder einen Entwurf nicht erneut an, der aus demselben Stand schon ohne Wirkung lief. `g3-cpe-duel-jump` gleicht `g3-cpe-duel` und zeigt in der Kopfzeile das Menü **Vorgang öffnen**. Es öffnet jeden Vorgang, auch einen von den Listenfiltern ausgeblendeten, ohne die Filter zu ändern. `g4` verbindet `g3-cpe-duel-nr` und `g3-cpe-duel-jump` und ist die Regel der Anwendung, siehe [architecture.md](architecture.md). `g4-lean` gleicht `g4` und sendet jeden bisherigen Schritt mit einer schlanken Beobachtung danach statt mit beiden vollen Beobachtungen. `g4-e1` gleicht `g4` und prüft nur die Wirkung von Speichern und Verwerfen, `g4-e0` prüft keine Wirkung. `g4-lean-e1` verbindet `g4-lean` und `g4-e1`. Die vier Regeln sind Versuche, siehe [architecture.md](architecture.md). Der Lauf schreibt `kontor-jev-gate-v2` = `{"version":2,"gate":"<name>"}` vor dem Laden der Seite. |
| `--record-payloads` | aus | Speichert je Anbieteraufruf im `callLog` der Lauf-Datei unter `payload` den vollständigen Anfragekörper (`state`, `questions`, `model`), die Antworten mit Auswahl, Confidence und Wahrscheinlichkeiten und den vom Anbieter gemeldeten Tokenverbrauch (`usage`). Grundlage der Formatbank in [jev-format.md](jev-format.md). |
| `--scenarios <datei>` | eingebaute Szenarien | JSON-Array vollständiger Szenarien statt der festen und generierten Szenarien. `--seed` und `--count` gelten dann nicht. |
| `--answer-review` | aus | Beantwortet Auswahlprüfung und Freigabe mit einem Klick, siehe [Klickvertrag für Auswahlprüfung und Freigabe](#klickvertrag-für-auswahlprüfung-und-freigabe). Ohne die Option endet der Lauf dort wie bisher. |
| `--meta <datei>` | keine | Menschliche Pfade je Szenario im Format der `holdout-meta.json`: je ID ein Objekt mit `steps`, einem Array von Schritten im Format von `executed` beim [Nachspielen](#pfad-nachspielen). Andere Schlüssel ignoriert der Lauf. Nur `--answer-review` liest die Pfade. |

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

## Szenarioentwürfe

`scripts/jev-eval/draft.ts` macht aus Entwürfen vollständige Szenarien. Der Befehl ruft keinen Anbieter auf:

```sh
node --import tsx scripts/jev-eval/draft.ts --in <entwurf.json> --out <szenarien.json>
```

`--in` enthält einen Entwurf oder ein Array von Entwürfen. `--out` erhält immer ein Array und passt direkt zu `--scenarios` von Lauf und Nachspielen. Der Befehl berechnet den erwarteten Endzustand mit `expectEnd`, prüft jedes Szenario wie eine Szenariodatei und gibt je Szenario eine Zeile mit Seite, Filtern, Speicherungen, Entwurf und Übergabe aus. Bei einem Fehler nennt er Entwurf und Grund, schreibt nichts und endet mit Status 1. Im Code heißt die Funktion `scenarioFromDraft`.

Start und Absicht haben dieselbe Form wie in den festen Szenarien in `scenarios.ts`. Unbekannte Schlüssel sind Fehler.

| Feld | Pflicht | Inhalt |
| --- | --- | --- |
| `id` | ja | Buchstaben, Ziffern, `_`, `.` und `-`. Eindeutig in der Datei. |
| `persona` | ja | Wer den Auftrag schreibt. Steht im Szenario. |
| `request` | ja | Der Auftrag an Jev. Minuten, Termine und Suchtexte müssen wörtlich darin stehen oder in `ambiguous` genannt sein. |
| `start` | nein | `page` (`cases`, `customers`, `team`, `reports`, Standard `cases`), `filters` (beliebige Teilmenge von `customerId`, `technicianId`, `status` mit `all`, `open` oder `done` und `search`), `selectedCase` (Vorgang, der vor dem Auftrag offen ist, Standard `null`), `saved` (bereits gespeicherte Werte je Vorgang in der Form von `intent.cases`). |
| `intent` | ja | `cases` (je Vorgang die Werte der Fall-Dimensionen, `{}` heißt nur öffnen), `sequence` (geordnete Zwischenstände je Vorgang, jeder wird gespeichert), `filters` (Listen-Dimensionen), `pages` (Seiten in Reihenfolge, die letzte ist das Ende), `flags` (`save`, `noSave`, `unsupported`, `sequence`). |
| `ambiguous` | nein | Werte ohne wörtlichen Kandidaten, etwa `{"dimension":"workedMinutes","caseId":"V-1042"}` für „ne Stunde“ oder `{"dimension":"search"}`. |
| `tags` | nein | Störungen im Auftrag. Sie werden zu `noise`. |
| `rationale` | ja | Warum das Szenario zählt. |

Fall-Dimensionen und Werte: `technician` (`lea`, `jonas`, `mara`), `workedMinutes` (`"60"`), `appointmentStart` (`"2026-09-25T10:00"` oder `"none"`), `appointmentDuration` (`"45"`), `status` (`open`, `done`), `priority` (`Hoch`, `Normal`). Listen-Dimensionen: `customerFilter` (`nord`, `hafen`, `linden`, `all`), `technicianFilter` (Personen-ID oder `all`), `statusFilter` (`all`, `open`, `done`), `search` (Text). Alle Werte sind Zeichenketten.

Fehlt `flags.save`, gilt `true`, sobald ein Vorgang Werte erhält und `noSave` fehlt. Fehlt `flags.sequence`, gilt `true` bei mehr als einer Seite oder bei `sequence`. `unsupported` markiert eine Zusatzaufgabe außerhalb der App und erwartet eine Übergabe.

```json
{
  "id": "ctl-01",
  "persona": "Disponentin am Handy, tippt schnell",
  "request": "1041 an marla, 60 min, dann nordweg filter u berichte",
  "start": { "page": "cases", "selectedCase": "V-1041", "filters": { "status": "open" } },
  "intent": {
    "cases": { "V-1041": { "technician": "mara", "workedMinutes": "60" } },
    "filters": { "customerFilter": "nord" },
    "pages": ["reports"]
  },
  "ambiguous": [],
  "tags": ["bare-id-number", "typo-name", "typo-customer", "abbreviation"],
  "rationale": "Kurzform des Nutzerauftrags. Prüft die bloße Zahl als Vorgang und zwei Tippfehler."
}
```

## Ablauf eines Laufs

Jeder Lauf startet den echten Server mit einer Datenbank im Arbeitsspeicher und öffnet Chrome. Gespeicherte Startwerte schreibt der Lauf direkt in die Datenbank. Seite, Vorgang und Filter stellt er über die Oberfläche ein. Die Bestätigungsschwelle ist 75 Prozent. Die Uhr des Browsers steht auf Dienstag, 22.09.2026, 9 Uhr (`scenarioDay` in `scripts/jev-eval/harness.ts`), dem Tag, an dem die Szenarien geschrieben sind. So meint „morgen“ im Szenario den 23.09.2026.

Danach sendet der Lauf den Auftrag über die Befehlspalette. Er wartet, bis Jev anhält. Ein Halt vor dem Abschluss zählt als Rückfrage: Auswahlprüfung, fehlender Wert, Freigabe und Blockade. Einen fehlenden Wert beantwortet der Lauf im Antwortfeld, siehe [Antwortvertrag für fehlende Werte](#antwortvertrag-für-fehlende-werte), und wartet auf den nächsten Halt. Auswahlprüfung und Freigabe beantwortet der Lauf nur mit `--answer-review`, siehe [Klickvertrag für Auswahlprüfung und Freigabe](#klickvertrag-für-auswahlprüfung-und-freigabe). Sonst endet er dort. Eine Blockade erhält keine simulierte Antwort. Der Lauf endet dort.

## Bestätigungsvertrag für Varianten

Eine Variante kann Rückfragen zu Dimensionen stellen. Der Lauf beantwortet sie aus der Wahrheit des Szenarios und setzt fort, wenn die Oberfläche diesen Vertrag einhält:

- Ein sichtbares Element mit `data-confirm-dimension="<id>"` ist eine Rückfrage. Die ID stammt aus `shared/dimensions.ts`.
- Bei vorgangsbezogenen Dimensionen nennt `data-confirm-case="<Vorgang>"` den Vorgang. Ohne Angabe gilt der einzige beabsichtigte Wert. Unterscheiden sich die Werte je Vorgang, bleibt die Rückfrage unbeantwortbar. Das gilt auch, wenn die Zwischenstände eines Vorgangs in `sequence` verschiedene Werte nennen.
- Schaltflächen im Element tragen `data-confirm-value`. Werte sind die Schlüssel aus `dimensionOptions`, also Personen-, Kunden- und Vorgangs-IDs, Enumwerte, wörtliche Kandidaten, `all` und `none`. Schalter verwenden `yes` und `no`. `unstated` bedeutet, dass der Auftrag die Dimension nicht setzt.
- Für die Menge `cases` klickt der Lauf jeden beabsichtigten Vorgang und danach `[data-confirm-submit]` im Element.
- Nach einer Antwort muss das Element verschwinden. Solange Jev arbeitet, zeigt die Aktivitätsleiste den laufenden Zustand. Sonst liest der Lauf den Halt zu früh.
- Fehlt der passende Wert, zählt die Rückfrage als unbeantwortbar und der Lauf endet.
- Die Speicherfrage im Modus `confirm` ist ein Element mit `data-confirm-dimension="save"`, optional `data-confirm-case`, und den Schaltflächen `data-confirm-value="yes"` und `"no"`. Der Lauf antwortet `yes`, wenn das Szenario eine Speicherung dieses Vorgangs erwartet, sonst `no`. Ohne Vorgang antwortet er `yes`, wenn das Szenario überhaupt eine Speicherung erwartet.

Jede beantwortete Rückfrage zählt als Frage. Nach höchstens zwölf Antworten endet der Lauf.

## Antwortvertrag für fehlende Werte

Fragt Jev nach einem fehlenden Wert, zeigt die Befehlspalette den Abschnitt „Antwort ausstehend“. Der Lauf beantwortet ihn aus der Absicht des Szenarios, so wie ein Mensch den Wert eintippt. Er liest den Abschnitt nur über diese Attribute, nicht über Texte oder Beschriftungen:

- `data-answer-field="<Feld>"` am Abschnitt nennt das gefragte Feld: `minutes`, `appointment`, `duration` oder `search`. `data-answer-scope` nennt den Vorgang, bei der Suche `cases`.
- Die Eingaben tragen `data-answer-part`: `date` und `time` für einen Termin, sonst `value`. Ob `value` eine Zahl oder ein Text ist, steht im `type` der Eingabe.
- `[data-answer-submit]` bestätigt den Wert. Ein sichtbares `[data-answer-error]` heißt, dass die Oberfläche den Wert abgelehnt hat.

Die Dimension folgt aus `actionEffects("ask:<Feld>")` in `shared/dimensions.ts`, wie in `shared/open-questions.ts`. Den Wert liefert dieselbe Wahrheit wie für Chips. Der Lauf füllt nur leere Teile. Was die Oberfläche aus dem Auftrag vorbelegt hat, bleibt stehen, auch wenn es von der Absicht abweicht. Die Meldung des Halts nennt die Abweichung dann, und der Endzustand entscheidet über die Kategorie. Beispiel: Das Datum 06.09.2026 ist vorbelegt, die Uhrzeit ist leer, und die Absicht ist `2026-09-06T10:00`. Der Lauf tippt nur 10:00. Sind alle Teile vorbelegt, bestätigt er sie unverändert.

Hat die Absicht keinen einzelnen Wert, antwortet der Lauf nicht und tippt nichts. Das gilt, wenn die Dimension `unstated` ist, wenn der gefragte Vorgang nicht in der Absicht steht, wenn die Zwischenstände in `sequence` verschiedene Werte nennen und wenn der Wert nicht in die Eingabe passt, etwa `none` für den Terminbeginn. Der Halt bleibt dann ein fehlender Wert mit Dimension und Vorgang, und der Lauf endet als stopped-unanswered. Lehnt die Oberfläche die Antwort ab, gilt dasselbe. Die Meldung enthält dann den Fehlertext.

Eine beantwortete Frage ist ein Halt der Art `answer`. Er nennt die Dimension, bei vorgangsbezogenen Dimensionen den Vorgang, und den bestätigten Wert. Er zählt als Frage wie ein Chip. Chips und Antworten teilen sich die Obergrenze von zwölf Antworten je Lauf.

## Klickvertrag für Auswahlprüfung und Freigabe

Mit `--answer-review` klickt der Lauf bei einer Auswahlprüfung („Nächsten Schritt prüfen“, „Jev hält bei Unklarheit an“) und bei einer Freigabe („Konkreten Schritt bestätigen“) die Option, die ein Mensch mit Kenntnis des Szenarios wählt. Er liest die Optionen nur über diese Attribute:

- `data-review-option="<Kennung>"` steht an jeder Schaltfläche einer Option. Die Kennung ist die Entscheidungsoption: eine Aktions-ID, `done`, `blocked`, `abstain` oder `ask:<Feld>`. In der Freigabe trägt „Diesen Schritt freigeben“ die ID der Aktion.
- `data-review-force` steht zusätzlich an „Trotzdem ausführen“. Diese Schaltfläche ersetzt die Option, die die Umfangsprüfung verbietet. Ein Klick darauf führt den Schritt aus.

Angeboten sind nur die sichtbaren Optionen, also die beiden bestbewerteten der Auswahlprüfung oder die eine Aktion der Freigabe. Unter einer Regel mit Plan kann die Auswahlprüfung als dritte Zeile die Option des Plans zeigen. Ihr Listeneintrag trägt `data-review-plan`, und die Meldung des Halts nennt sie als `plan row <Kennung>`. Weitere Optionen derselben Jev-Antwort kann ein Mensch dort nicht klicken. Der Lauf wählt nach dieser Regel:

1. `done`, wenn der Zustand in diesem Moment schon richtig bewertet wird und das Szenario keine Übergabe erwartet. Den Zustand liest der Lauf aus der Beobachtung nach dem letzten Schritt im Jev-Verlauf und aus der Datenbank. Er liest ihn nicht vom Bildschirm, denn das würde die Palette schließen und die Seite wechseln.
2. `blocked`, wenn das Szenario eine Übergabe erwartet und der Zustand abgesehen von der Übergabe richtig bewertet wird.
3. Sonst die erste angebotene Aktion oder Rückfrage `ask:<Feld>`, die auf dem menschlichen Pfad aus `--meta` sicher ist. Sicher bedeutet: Der Lauf ist bisher genau den ersten Schritten des Pfads gefolgt, und die Option ist der nächste Schritt oder gehört zu dessen Abschnitt bis zur nächsten Speicherung, Navigation oder Vorgangsauswahl. Führt der nächste Schritt nur auf eine Seite, die der Auftrag nicht zeigen will, ist auch der Schritt danach sicher. Das ist `safe` aus `labelState` der Formatbank in `scripts/jev-format/bench.ts`.
4. `abstain` wählt der Lauf nie.

Findet der Lauf keine Option, bleibt der Halt unbeantwortet wie ohne die Option. Seine Meldung nennt dann die angebotenen Optionen und den Grund, etwa die Abweichungen für `done` oder den Schritt, an dem der Lauf den menschlichen Pfad verlassen hat. Ohne Pfad für das Szenario kann der Lauf nur `done` und `blocked` klicken.

Ein Klick ist ein Halt der Art `review-answer` mit der Kennung in `value`. Er zählt als Frage. Klicks, Chips und Antworten teilen sich die Obergrenze von zwölf Antworten je Lauf. Danach wartet der Lauf auf den nächsten Halt. Bestätigt die Umfangsprüfung die geklickte Aktion nicht sicher, folgt eine Freigabe für denselben Schritt. Das sind zwei Klicks. Für Jevs eigene Auswahl gilt dabei die Umfangsprüfung, die zur Auswahlprüfung geführt hat. Nach einer unsicheren Umfangsprüfung kostet sie deshalb immer zwei Klicks.

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
| handoff | Endzustand richtig, und der Lauf hält korrekt für die erwartete Übergabe an einen Menschen an. Das ist nicht magic, auch nicht nach beantworteten Fragen. |
| correct-after-answers | Endzustand richtig, und der Lauf hat jede Frage beantwortet, als Chip, als Wert im Antwortfeld oder als Klick in Auswahlprüfung und Freigabe. |
| stopped-unanswered | Der Lauf endet an einer Frage ohne Antwort: Auswahlprüfung, fehlender Wert ohne einzelnen Wert in der Absicht, Freigabe, Blockade ohne erwartete Übergabe oder unbeantwortbarer Chip. Der Bericht zählt in Klammern, wie oft der Endzustand in diesem Moment schon stimmte. |
| asked-wrong | Fragen beantwortet, Endzustand trotzdem falsch. |
| silent-wrong | Endzustand falsch oder unerwartete Speicherung, ohne Frage. |
| error | Anbieter- oder Harnessfehler, etwa Zeitüberschreitung. |

`magic-save-check` zählt magic und die Läufe unter correct-after-answers, deren Fragen alle Speicherfragen waren. Das ist das Ziel des Modus `confirm`: Jev fragt nur, ob gespeichert werden soll. Der Bericht zeigt die Kennzahl in beiden Modi. Im Modus `auto` erscheint keine Speicherfrage, dort entspricht sie magic.

`correct ≤1 question` zählt magic und die Läufe unter correct-after-answers mit genau einer Frage. Die Spalte ist kumulativ und enthält magic. Sie zeigt, wie oft Jev mit höchstens einer Rückfrage ans Ziel kommt.

`one-click` zählt die Läufe unter correct-after-answers und handoff mit genau einer Frage, die ein Klick in Auswahlprüfung oder Freigabe war. Sie zeigt, wie oft ein Klick auf eine angebotene Option zum richtigen Ende führt. `results.json` nennt je Lauf die Zahl der Klicks in `reviewClicks`. Ohne `--answer-review` ist die Spalte 0.

Dazu kommen die Fragen als Mittelwert je Lauf in der Spalte `questions per run` und als Anteil der Läufe mit mindestens einer Frage, die Anbieteraufrufe und die Laufzeit vom Absenden bis zum letzten Halt.

Berichte vor dem Antwortvertrag nennen die Kategorie `correct-after-chips` statt `correct-after-answers`. Sie enthalten keine Spalte `correct ≤1 question`, und ein fehlender Wert beendete dort jeden Lauf als stopped-unanswered.

Noch ältere Berichte kennen `correct-after-questions` statt `correct-after-chips` und zählen eine erwartete Übergabe als magic. Läufe, die an einer unbeantworteten Frage endeten, stehen dort unter `correct-after-questions` oder `asked-wrong`. magic und silent-wrong bleiben vergleichbar: Ein älterer magic-Wert entspricht magic plus handoff ohne Chips, silent-wrong ist unverändert.

## Ausgabe

Das Ausgabeverzeichnis enthält `report.md`, `results.json`, `scenarios.json` und je Lauf eine Datei unter `samples/`. Eine Lauf-Datei enthält Halte, Schritte, beobachteten Endzustand, Abweichungen und die Anbieterantworten mit Auswahl, Confidence und den Wahrscheinlichkeiten aller Optionen der ersten Antwort (`probabilities`, sonst `null`). Trägt der Eintrag des Laufs im Jev-Verlauf `coverageProbability` oder `checklist`, übernimmt der Lauf beide in den beobachteten Endzustand. `coverageProbability` steht zusätzlich im Ergebnis und in der Spalte coverage des Berichts. Fehlt ein Feld, steht dort `null`. `live-results/` bleibt außerhalb von Git.

Jeder Aufruf hängt nach dem letzten Lauf eine Zeile an `live-results/jev-eval-runs.tsv` im Hauptverzeichnis des Repositorys an, auch aus einem Worktree. Die Datei beginnt mit der Kopfzeile `ts`, `variant`, `branch`, `commit`, `scenarios sha256`, `count`, `samples`, `save mode`, `threshold`, `out dir`, `provider calls`, `magic`, `silent-wrong`. `count` ist die Zahl der Szenarien und `samples` die Zahl der abgeschlossenen Läufe. `threshold` enthält die Schwelle, mit `--gate g1` in der Form `g1/75`. `magic` und `silent-wrong` sind Anzahlen dieser Läufe. `commit` endet auf `-dirty`, wenn versionierte Dateien geändert sind. Parallele Aufrufe schreiben jede Zeile vollständig und die Kopfzeile genau einmal.

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
- Die richtige Antwort auf eine Blockade. Der Lauf endet dort. Auswahlprüfung und Freigabe beantwortet er nur mit `--answer-review` und nur entlang des menschlichen Pfads.
- Sichtbarkeit, Fokus und Lesbarkeit des Endzustands für Menschen.
- Wirkungen auf Kennzahlen anderer Seiten. Sie folgen aus den gespeicherten Daten.
- Varianz jenseits der gewählten Stichproben. Ein Lauf pro Szenario zeigt Tendenzen, keine stabilen Raten.

## Wertlesung messen

`scripts/value-reading/measure.ts` misst die Wertlesung ohne Oberfläche, mit einem Live-Aufruf je Angabe. Gemessen werden die Formulierungen in `scripts/value-reading/phrasings.ts` und, mit `--scenarios <Datei>` (mehrfach möglich), die Werte für Arbeitszeit, Termindauer und Terminbeginn in der Absicht jedes Szenarios. Fehlt ein Feld in der Absicht eines genannten Vorgangs, zählt es als „nicht genannt“. Bezugstag ist der 22.09.2026.

```sh
node --env-file-if-exists=.env --import tsx scripts/value-reading/measure.ts --scenarios <holdout.json> --out <ergebnis.json>
```

Die Ausgabe nennt je Menge und Schwelle, wie viele Teile richtig, falsch oder gar nicht vorbelegt würden, dazu Aufrufe und Tokens. `--only table|h1|h2` und `--match <regex>` grenzen die Angaben ein.
