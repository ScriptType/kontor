# Jev-Formatbank

Die Formatbank misst, wie Form und Umfang der Anfrage an Jev die Entscheidungen unter dem Gate `g3` verändern. Sie stellt aufgenommene Entscheidungszustände in einer anderen Schreibweise erneut an den Anbieter und liest die Antwort genau so, wie die Schleife in `frontend/src/command-runner.ts` sie liest. So lassen sich gekürzte oder umformatierte Zustände an rund 250 Zuständen vergleichen, bevor ganze Läufe mit `npm run eval:jev` sie bestätigen.

## Ablauf

1. Läufe unter `g3` mit `--record-payloads` aufnehmen.
2. Zustände mit `scripts/jev-format/extract.ts` herausziehen und beschriften.
3. Varianten mit `scripts/jev-format/run.ts` stellen.
4. Die Rangliste mit `scripts/jev-format/table.ts` schreiben.

Alle Dateien liegen unter `live-results/question-pipeline-2026-09-21/round4/format/` im Hauptverzeichnis des Repositorys, auch aus einem Worktree. `JEV_FORMAT_DIR` wählt einen anderen Ordner (siehe [Aufnahmen mit kompaktem Zustand](#aufnahmen-mit-kompaktem-zustand)).

## Aufnehmen

```sh
npm run build
node --env-file-if-exists=.env --import tsx scripts/jev-eval/run.ts \
  --variant r4f-rec-h1-g3 --scenarios <holdout.json> --samples 1 --gate g3 \
  --concurrency 4 --max-calls 2500 --record-payloads \
  --out live-results/question-pipeline-2026-09-21/round4/format/rec-h1-g3
```

## Herausziehen

```sh
node --import tsx scripts/jev-format/extract.ts
```

Der Befehl liest die Läufe `rec-h1-g3` und `rec-h2-g3` (`--runs` ändert das) und schreibt drei Dateien:

| Datei | Inhalt |
| --- | --- |
| `states.json` | Jeder Entscheidungszustand auf dem menschlichen Pfad aus `holdout-meta.json` und `holdout2-meta.json`, beschriftet wie in der Entscheidungsbank (`labelState`): `next`, `acceptable`, `safe`. Dazu die Art jeder Option unter `g3` und die aufgenommene Antwort samt Prüfung. |
| `calls.json` | Jeder Entscheidungs- und Prüfaufruf mit Tokenverbrauch und der Größe jedes Zustandsteils, auch abseits des Pfads. |
| `assess-questions.json` | Die beiden Prüffragen (Wirkung und Abschluss) wörtlich aus den Aufnahmen. |

Ob ein Feldwert an den Auftrag gebunden ist, sendet die App nicht an Jev. Der Befehl berechnet es mit `fieldCandidates` aus `scripts/jev-format/bench.ts` neu. Die Funktion ruft `fieldValues` aus `shared/field-values.ts` mit den Vorgängen und Kunden des Startzustands auf. Hat der Lauf eine Summe oder Differenz gesendet, rechnet sie wie die App mit den gespeicherten Minuten des Startzustands. Aufnahmen aus der Zeit vor den Summen bindet sie ohne gespeicherten Wert. Danach prüft er an jeder aufgenommenen Entscheidung vier Dinge und gibt die Abweichungen aus:

- Der neu serialisierte Zustand gleicht dem gesendeten Text.
- Der gebaute Prüfzustand gleicht dem gesendeten Prüfzustand.
- Nach genau den Entscheidungen, nach denen die Bank eine Prüfung erwartet, folgt in der Aufnahme eine Prüfung.
- Genau die Aktionen, die die Bank ausführen würde, hat der Lauf ausgeführt.

Ein Aufruf ohne Antwort des Anbieters (`answers: null`, etwa nach einem 503) enthält keine Entscheidung. Der Befehl überspringt ihn und gibt aus, wie viele solche Aufrufe in den gelesenen Läufen und im Katalog lagen. Der Befehl für Runde 6 unten überspringt 232, alle im Katalog.

Vor einer Bank auf neuen Aufnahmen prüft `scripts/jev-format/candidates.ts`, ob die Neuberechnung jede gesendete Feldoption samt Wertquelle trifft:

```sh
node --import tsx scripts/jev-format/candidates.ts --runs <Lauf,…>
```

Der Befehl zählt je Wertquelle die gesendeten, die fehlenden und die abweichenden Optionen und endet mit Code 1, sobald eine abweicht. Aufrufe ohne Antwort überspringt er. Auf den Aufnahmen der Runde 4 weicht keine der 289 Feldoptionen ab. Auf allen Läufen der Runde 6 weichen 77 von 84306 ab. Diese 77 sind Zahlwörter, die Kontrollarme mit einem Stand vor dem Lesen von Zahlwörtern als Antwort der Person sendeten. Art und Bindung der Option ändert das nicht.

### Aufnahmen mit kompaktem Zustand

Unter `"focused"` und `"compact"` fehlen der Entscheidung `snapshotId` und `availableActions`. Dafür enthält sie `requestHints` und am Ende `originalRequestAgain`. Die Bank liest beide Formen. Die Art jeder Aktion braucht sie für das Gate, Label und vollen Text für die Prüfung. Folgt der Entscheidung eine Prüfung, nimmt die Bank deren `availableActions`. Sonst baut sie die Aktionen aus einem Katalog. Der Katalog kennt je Kennung und Wirkungstext Label, Art und den Text nach dem Optionstext. Er lernt aus allen Prüfungen, Zweikämpfen und bisherigen Schritten der gelesenen Läufe und der Läufe unter `--catalog <Ordner,…>`. Eine Kennung kann zwei Bedienelemente benennen, etwa `technician:mara` in der Zuweisung und im Filter. Deshalb gehört der Wirkungstext zum Schlüssel. Feldwerte (`field:<Feld>:<Wert>`) und Vorgänge der Vorgangsauswahl (`open-case:<Vorgang>`) baut die App aus einer Vorlage. Label und Art eines Feldwerts liest die Bank aus `availableFields` im Zustand. Das Label eines Vorgangs der Auswahl ist seine Kennung mit „öffnen“. Für diese Optionen lernt der Katalog nur den Text nach dem Optionstext, je Feld und einmal für die Vorgangsauswahl. Einen bisherigen Schritt liest er mit dem Optionstext der Entscheidung, die ihn wählte. Kennt der Katalog eine Option oder ihre Vorlage nicht, bricht der Befehl ab.

Unter `g4-lean` und `g4-lean-e1` sendet die App den schlanken Verlauf (`history: "slim"`, `slimObservations` in `shared/step-log.ts`). Ein Schritt trägt `before` dort nur, wo es vom `after` des Schritts davor abweicht. `fullStateSchema` liest beide Verläufe. Für den Wächter, die Varianten und `check-product.ts` ergänzt `stepsWithBefore` ein fehlendes `before` aus dem `after` des Schritts davor.

Aufrufe eines Zweikampfs (`duel`) zählt `calls.json` mit, sie werden aber keine Zustände. Plan-Freigaben, Zweikampf und Lenkung bildet die Bank nicht nach. Die beiden letzten Prüfungen oben melden deshalb unter `g3-cpe-duel` Abweichungen, die der Plan erklärt.

`JEV_FORMAT_DIR` legt den Ordner aller Bankdateien relativ zu `question-pipeline-2026-09-21` fest, Standard `round4/format`. `run.ts`, `table.ts`, `tokens.ts` und `preview.ts` lesen und schreiben dort, auch den Cache. Für Runde 6:

```sh
export JEV_FORMAT_DIR=round6/format
node --import tsx scripts/jev-format/extract.ts \
  --runs <lab>/round6/i5words-h1,<lab>/round6/i5words-h2 \
  --catalog <lab>/round6,<lab>/round4/format
```

## Varianten

`scripts/jev-format/variants.ts` enthält eine Tabelle der Varianten. Eine Variante hat drei Teile:

- `decide(payload)` gibt Zustand und Fragen der Entscheidung zurück.
- `read(answer, payload)` bildet die Antwort auf Wahrscheinlichkeiten über die aufgenommenen Options-IDs ab.
- `assess(payload, selected, questions)` gibt Zustand und Frage einer Prüfung zurück.

Eine Variante mit `shape` ändert den Zustand der Entscheidung und beider Prüfungen, wie eine Änderung an `modelState` in `server/jev.ts` es täte. `decideShape` ändert nur die Entscheidung, `question` nur Anweisung und Optionen der Entscheidung.

`node --import tsx scripts/jev-format/preview.ts` zeigt die mittlere Größe jeder Variante. Mit `--variant <name> --state <id>` zeigt es, was die Variante für einen Zustand sendet.

## Messen

```sh
node --env-file-if-exists=.env --import tsx scripts/jev-format/run.ts \
  --variants identity,f1-dedupe --samples 2 --concurrency 16
node --import tsx scripts/jev-format/table.ts
```

| Option | Standard | Bedeutung |
| --- | --- | --- |
| `--variants <a,b>` | Pflicht | Namen aus `variants.ts`. `recorded` wertet die aufgenommenen Antworten ohne Anbieteraufruf aus. |
| `--samples <n>` | `1` | Unabhängige Stichproben je Variante. Ab der zweiten Stichprobe geht ein Salz in den Cache-Schlüssel ein. |
| `--concurrency <n>` | `8` | Parallele Zustände, höchstens 24. |

Je Zustand stellt der Befehl die Entscheidung, liest sie mit `pick` aus `frontend/src/gate.ts` unter `g3` und stellt die Prüfung, wenn die Schleife sie vor dem Handeln stellen würde. Er handelt wie die Schleife: Die Auswahl muss ihre Schwelle und den Abstand erreichen, der Laufwächter darf nicht anhalten, eine Wirkungsprüfung muss `authorized` mit mindestens 75 % liefern und eine Abschlussprüfung die Schwelle je Art der Arbeit. Prüfungen, die die Schleife nur für den Hinweistext stellt, stellt die Bank nicht.

Jede Antwort landet unter `cache/<sha256>.json` mit dem gemeldeten Tokenverbrauch. Der Schlüssel ist der Hash aus Modell, Anfrage und Salz. Bei 429 oder 529 wartet der Befehl länger und versucht es bis zu siebenmal, bei 402 bricht er ab.

`results/<variante>@<n>.json` enthält eine Zeile je Zustand. `table.md` zeigt je Holdout:

| Kennzahl | Bedeutung |
| --- | --- |
| act-correct | Die Schleife würde handeln, und die Auswahl liegt in `safe`. |
| act-wrong | Die Schleife würde handeln, und die Auswahl liegt nicht in `safe`. „not a view“ zählt davon nur Entwürfe, Speichern, Abschluss und Halt. |
| stop | Die Schleife würde nachfragen. |
| top1-safe | Die gelesene Auswahl liegt in `safe`, unabhängig vom Handeln. |
| safe mass | Mittlere Wahrscheinlichkeit auf den Optionen in `safe`. |
| decide input tokens | Vom Anbieter gemeldete Eingabetokens der Entscheidung, Mittel je Zustand. |

Die Grundlinie mittelt alle Stichproben von `identity` und die aufgenommenen Antworten. Als Rauschen gilt der größte Abstand einer dieser Stichproben zum Mittel der übrigen. Fett markiert eine Abweichung darüber.

`node --import tsx scripts/jev-format/tokens.ts` schreibt `tokens.md` mit Tokenverbrauch und Größe der Zustandsteile aller aufgenommenen Aufrufe.

## Grenzen

- Die Zustände liegen auf dem Pfad, den Jev unter `g3` bis dahin richtig ging. Zustände nach einem Fehler fehlen.
- Die Beschriftung kennt einen richtigen Weg. Öffnet Jev einen Vorgang vor einer Navigation, die der menschliche Pfad zuerst macht, zählt das als falsch, auch wenn der Lauf danach richtig endet.
- Eine Variante sieht nur den aufgenommenen Zustand. Folgen für spätere Schritte, etwa ein kürzerer Verlauf, zeigt erst ein ganzer Lauf.
- Die Nachfrage nach der Ursache einer Blockade (`cause`) stellt die Bank nicht.
- `extract.ts` liest die 20 Läufe `f3arith`, `k1clock`, `k1rows`, `k2clock`, `k2rows`, `m2cand`, `r1arith`, `r1rows`, `s1le1` und `s1lean` (je `h1` und `h2`) als `--runs` mit allen Läufen der Runde 6 als `--catalog`. Keiner der 10624 wieder serialisierten Zustände und keiner der 2982 gebauten Prüfzustände weicht vom Gesendeten ab. Von den 57184 Aktionen, die eine Prüfung aufnahm, baut der Katalog keine Art falsch. 2831 Labels weichen ab: 2129 Labels von `case:` ohne die Zeile in der Vorgangsliste und 702 Labels von `close` mit dem Vorgang, den der Katalog zuerst sah. Das Gate liest diese Labels nicht, eine Prüfung der Bank schon. Diese Läufe liefen unter `g4-lean` und `g4-lean-e1`. Die Bank liest sie unter `g3`, deshalb weichen 535 der 10463 vorhergesagten Prüfungen und 982 Schritte vom Lauf ab.
