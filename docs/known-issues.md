# Offene Prüfungen

## KI-001: Sporadischer Fehler beim Fortsetzen nach einer Dialogpause

Status: historische Beobachtung, Ursache nicht nachgewiesen.

Ein Browser-Test des früheren festen Auftragsplaners meldete einmal `PROVIDER_INVALID_RESPONSE` nach Escape. Er verwendete einen lokal simulierten TypeSafe-Transport. Die Anwendung pausierte. Es gab keinen Nachweis einer unzulässigen Speicherung. Der vollständige Folgelauf und 13 gezielte Wiederholungen bestanden.

Der dynamische Entscheidungszyklus ersetzt inzwischen diesen Planer. Das erklärt die frühere Beobachtung nicht. Bei erneutem Auftreten müssen die erhaltene Provider-Antwort, die Optionen derselben Anfrage und der Playwright-Trace erhalten bleiben. Weitere erfolgreiche Wiederholungen allein klären die Ursache nicht.

Ein später reproduzierter Fall mit derselben Fehlermeldung ist unter KI-006 dokumentiert und behoben. Dieser Nachweis erklärt die historische Beobachtung nicht rückwirkend.

## KI-002: Modellunsicherheit und mehrteilige Aufträge

Status: im Live-Lauf vom 20. September 2026 mit `jev-1.13.0` beobachtet.

Jev kann einen passenden nächsten Schritt auswählen und zugleich eine niedrige Confidence liefern. Die Anwendung zeigt eine konkrete Auswahl zur Bestätigung. Eine bestätigte Bedienhandlung ist im Live-Bericht von einer automatisch ausgeführten Handlung zu unterscheiden.

Der Ablauf wiederholt den vollständigen ursprünglichen Auftrag und die beobachteten Ergebnisse nach jedem Schritt. Trotzdem kann Jev einen Teilauftrag übersehen, zu früh einen Abschluss vorschlagen oder keinen sinnvollen nächsten Schritt erkennen. Die gesonderte Abschlussbewertung und Speicherbelege reduzieren verschiedene Fehlerarten. Sie beweisen kein allgemeines Verständnis beliebiger Anweisungen.

Im vollständigen Lauf bestanden sieben von 18 Szenarien ihre Erwartungen nicht. Neben Bestätigungspausen gab es zwei semantische Fehler. Bei einer wiederholten Zuweisung öffnete Jev nach der ersten korrekten Speicherung einen anderen Vorgang. Die folgende Änderung blieb zur Bestätigung stehen. Bei „Zuerst V-1042 abschließen, dann 45 Minuten Arbeitszeit erfassen“ änderte es die Minuten bereits im Entwurf. Auch die gesonderte Bewertung erkannte diese Verletzung der Reihenfolge nicht. Der Lauf pausierte erst vor dem Abschluss; die Datenbank blieb unverändert.

Diese Fehler werden nicht durch feste Sonderfälle für die beiden Texte umgangen. Die Testfälle bleiben im Live-Lauf. Die dynamische Architektur erlaubt freie Kombinationen, garantiert aber weder die richtige Zielauswahl noch die Einhaltung beliebiger sprachlicher Reihenfolgen.

Die [Live-Szenarien](jev-live.md) prüfen daher Oberfläche, genaue Datenänderungen und ausbleibende Nebenwirkungen unabhängig von der Modellantwort. Ein grüner Lauf gilt nur für die enthaltenen Formulierungen und das gemeldete Modell. Bestätigungen, Blockaden und nicht ausgeführte Fälle zählen nicht als autonome Erledigung.

Auch räumliche Angaben bleiben modellabhängig. Mit Bereichsmetadaten allein wählte Jev für „letzter Vorgang in der Tabelle“ zunächst die erste Zeile und bewertete den Auftrag anschließend fälschlich als erledigt. Die zusätzliche, aus dem DOM abgeleitete Zeilenposition an jeder Tabellenaktion führte auf `4840c8d` zum richtigen Vorschlag V-1035. Bei Confidence 0,59 verlangte die Anwendung weiterhin eine Bestätigung. Der Autonomietest bleibt fehlgeschlagen; eine gesonderte Prüfung mit einer ausdrücklichen Bestätigung bestand.

## KI-003: Frühere Begrenzung auf einen Vorgang und eine Zuweisung

Status: die feste Einschränkung ist entfernt.

Der frühere Planer erlaubte einen Zielvorgang und einen Zielwert je Eigenschaft. Eine zusätzliche Namensprüfung lehnte Texte mit mehreren bekannten vollständigen Personennamen ab. Dadurch waren auch sinnvolle Vergleiche und wiederholte Zuweisungen ausgeschlossen.

Der dynamische Ablauf verwendet keine solche Prüfung. Jev kann mehrere sichtbare Vorgänge und aufeinanderfolgende Änderungen wählen. Die Prüfung einer wiederholten Zuweisung muss beide Speicherbelege untersuchen. Der letzte Datenstand allein erkennt nicht, ob der erste beauftragte Zwischenstand jemals gespeichert wurde.

## KI-004: Grenzen der Werte und der verfügbaren Bedienhandlungen

Status: beabsichtigte Grenzen mit offenem Ausbau.

Jev erzeugt keine freien Werte. Passende Literale müssen im Auftrag, in vorhandenen Daten oder in einer ausdrücklichen Antwort enthalten sein. Relative Daten, komplexe Umschreibungen und nicht registrierte Komponenten können deshalb eine Rückfrage oder einen Abbruch benötigen.

Der [Aktionskatalog](action-catalog.md) enthält Ausbauziele. Er ist keine Liste bereits ausführbarer Funktionen. Ein nicht vorhandener E-Mail-Versand bleibt beispielsweise unerfüllbar. Schon gespeicherte, ausdrücklich beauftragte Änderungen bleiben bei einer späteren Blockade erhalten.

## KI-005: Geöffnete Details liegen unterhalb des sichtbaren Ausschnitts

Status: behoben und auf `4840c8d` im Browser und mit Live-Jev geprüft.

Am 20. September 2026 wählte `jev-1.13.0` bei allen vier geprüften Formulierungen korrekt V-1042. Dazu gehörten "Öffne Details von 1042" und "Zeige mir die Details des ersten Vorgangs in der Tabelle". Die zwölf Anbieteraufrufe führten zu keiner Datenänderung. Die Details waren jeweils gerendert, ihre Überschrift lag aber unterhalb des 720 Pixel hohen Browserfensters.

Der Ablauf scrollte vor dem Klick zur Tabellenzeile. Das danach eingeblendete Detailformular erhielt weder Fokus noch eine passende Scrollposition. Der Seitentext im Modellkontext enthielt seine Inhalte bereits. Die zusätzliche Prüfung im Browser zeigte die Abweichung. Die Unterkante der Detailüberschrift lag bei rund 746 Pixeln, obwohl das Modell den Auftrag als erledigt meldete.

Diese Messung belegt einen Darstellungsfehler. Sie belegt keinen allgemeinen Erkennungsfehler für das Wort "Details" oder die Kurzform "1042".

Die gemeinsame Öffnen-Aktion fokussiert jetzt nach dem Rendern die Detailüberschrift und scrollt sie ins Fenster. Beim ursprünglichen Auftrag lag ihre Unterkante im abschließenden Live-Test bei rund 374 statt 746 Pixeln. Der Regressionstest prüft zusätzlich die fixierte Aktivitätsleiste, Fokus und unveränderte Daten. Mobile Ansicht, erneutes Öffnen mit Entwurf und ausbleibende Fokussprünge bei Feldeingaben sind ebenfalls geprüft.

## KI-006: Entscheidungen starten vor dem vollständigen Schließen der Palette

Status: behoben und auf `4840c8d` mit verzögertem Dialogschließen geprüft.

Bei verzögertem Schließen der Befehlspalette konnte der Lauf fortgesetzt werden, während Angular CDK die Hauptansicht noch als `aria-hidden` markierte. Die nächste Entscheidung enthielt dadurch keine bedienbaren Aktionen. Ein Browser-Test mit einer 250 Millisekunden langen Schließanimation reproduzierte den Fehler. Der Anbieter erhielt nur `done` und `blocked`, obwohl als nächster Schritt Speichern möglich sein sollte.

Start, Fortsetzen, Antworten, Freigaben und der Wechsel zum Prüfbeleg warten nun auf das tatsächliche `closed`-Ereignis des Dialogs. Eine zwischenzeitliche Änderung des Laufzustands verwirft die vorgemerkte Aktion. Die Sichtbarkeitsprüfung für ausgeblendete Inhalte bleibt bestehen.
