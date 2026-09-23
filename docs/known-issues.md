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

Die Korrektur von KI-007 ergänzt einen Renderdurchlauf nach `closed`. Eine synchrone Prüfung des Prüfbeleg-Ziels kam sonst noch vor der Wiederherstellung von `aria-hidden` durch Angular CDK. Der Browser-Test prüft die Übergabe sowie Stoppen, Zielwechsel und ausgeblendete Bedienelemente während dieser Wartezeit.

## KI-007: Unpassender Prüfbeleg nach einem Kundenfilter

Status: behoben und auf `a58d322` im Browser und mit Live-Jev geprüft.

Der Auftrag "zeige mir alle vorgänge von nordwerk" konnte bei geöffnetem V-1039 einen Prüfbeleg-Hinweis auslösen. In der entscheidenden Live-Reproduktion war die Liste bereits korrekt gefiltert. Jev führte keine Aktion aus und schlug den Abschluss des Auftrags vor. Seine Confidence und die anschließende Ergebnisbewertung lagen unter der Ausführungsschwelle.

Die Anwendung behandelte diese Unsicherheit als allgemeine Blockade. Die Palette leitete daraus die Abschlussvoraussetzungen des gerade ausgewählten Vorgangs ab. So erschien dessen fehlender Prüfbeleg als vermeintlich notwendiger nächster Schritt, obwohl der Auftrag nur die Liste betraf. Die gespeicherten Daten blieben unverändert.

Die Korrektur trennt eine unbestätigte Ergebnisbewertung von einer konkret zugeordneten blockierten Aktion. Hinweise beziehen sich auf deren erfassten Zielvorgang. Eine bloße Auswahl oder eine unsichere Abschlussmeldung erzeugt keine Prüfbeleg-Übergabe.

Die drei abschließenden unabhängigen Filterprüfungen zeigten die richtigen Zeilen ohne den falschen Hinweis. Daten und offene Entwürfe blieben unverändert. Zwei Menüschritte benötigten eine geprüfte Bestätigung. Zwei Ergebnisbewertungen blieben unsicher; sie zählen nicht als autonome Erledigung. Der echte Abschlussauftrag für V-1039 führte zur passenden Prüfbeleg-Übergabe und nach einem manuellen Klick zum leeren, fokussierten Eingabefeld. Die [Live-Messung](jev-live.md#auftragsbezogene-blockaden) enthält auch die fehlgeschlagenen Autonomietests.

Unabhängig davon schlug Jev in einem anderen Live-Lauf nach erfolgreichem Filtern unnötig das Öffnen von V-1042 vor. Dieser unsichere Vorschlag wurde nicht bestätigt. Die Zuordnung von Aufgaben bleibt eine Modellentscheidung und fällt weiterhin unter KI-002.

## KI-008: Laufender Reset lässt sich über den Dialog ausblenden

Status: auf `74de5c3` behoben; beide Schließwege vor der Korrektur im Browser reproduziert.

Während einer zurückgehaltenen Reset-Antwort konnten Escape und ein Klick außerhalb den Dialog schließen. Die Anwendung hielt den Reset noch für modal und sperrte die Jev-Palette. Der ursprüngliche Test scheiterte auch fünfmal auf dem unveränderten Ausgangsstand `2468329`.

Spartan Brain 1.4.1 übernimmt `disableClose` beim Öffnen des Dialogs. Eine spätere Änderung des Inputs während des Resets aktualisiert diese Optionen nicht. Das `stateChanged`-Ereignis meldet den bereits begonnenen Schließvorgang; der bisherige Guard in der Anwendung konnte ihn nicht verhindern.

Solange der Reset aussteht, stellt die Anwendung den geöffneten Zustand synchron über die öffentliche Dialog-API wieder her. Nach einer bestätigten Antwort schließt der Dialog. Bei der Bestätigung und nach einem Fehler bleiben Abbrechen, Escape und Außenklick möglich. Die Browser-Tests halten die echte WebSocket-Antwort zurück und prüfen beide Schließversuche, die Fokussperre und die anschließende Freigabe der Bedienung.

## KI-009: Wiederholte Aufträge verlieren bereits passende Feldwerte

Status: bei niedriger Sicherheitsschwelle im echten Lauf autonom erfüllt. Bei der Standardschwelle von 75 Prozent hält Jev weiterhin zur Auswahl an.

Ein wiederholter Auftrag für V-1041 enthielt die alleinstehenden Zahlen 1041 und 60. Bei bereits erfassten 60 Minuten entfernte die Kandidatensuche den passenden Wert aus den Feldaktionen. Die Zahl 1041 blieb als gültiger numerischer Kandidat verfügbar. Eine echte Jev-Antwort wählte diesen falschen Wert. Die gesonderte Auftragsprüfung lehnte ihn ab; die gespeicherten 60 Minuten blieben unverändert.

Die Browser-Reproduktion mit drei aufgezeichneten Anbieterantworten zeigte denselben Hinweis wie der gemeldete Fehler. Zwei weitere echte Läufe über den bereits gespeicherten Stand mit Mara Schulz und 60 Minuten endeten als blockiert. Sie zählen als fehlgeschlagene Autonomietests. Die Berichte und Traces liegen lokal unter `live-results/repeated-actions-2026-09-21/`.

Die aktuelle Zuständigkeit blieb dagegen als sichtbarer Menüeintrag verfügbar. Ihre erneute Auswahl setzte bisher trotz gleichen Werts den Entwurfseigentümer und die Meldung über einen ungespeicherten Entwurf. Diese Unterschiede zwischen Feld- und Menüaktionen erklären die inkonsistente Behandlung gleicher Werte. Sie beweisen nicht, dass das Entfernen des passenden Kandidaten jede falsche Modellentscheidung verursacht.

Alleinstehende Zahlen bleiben grundsätzlich Kandidaten, sofern sie die Feldvalidierung erfüllen und keiner vorhandenen Kennung entsprechen. Ihre Bedeutung muss Jev beurteilen. Eine besondere Regel für diese Vorgangsnummer oder diesen Auftrag würde andere gültige Minutenwerte ausschließen. Die unter KI-002 beschriebenen Grenzen der Zielwahl und Auftragsauswertung bleiben bestehen.

Nach der Korrektur bleibt ein passender Wert als Kandidat verfügbar. Gleiche Zuweisungen verändern weder Entwurf noch Eigentümer oder Statusmeldung. Der Verlauf kennzeichnet sie als Schritt ohne Änderung. Die Browser-Tests mit vorgegebenen Antworten führen den Auftrag zweimal ohne Speicherung und ohne erfundene Speicherbelege aus.

Zwei echte Jev-Läufe nach der Korrektur liefen mit einer Schwelle von 10 Prozent über den gespeicherten Stand mit Mara Schulz und 60 Minuten. Beide Läufe speicherten nichts; Revision und Werte blieben unverändert. Der erste Lauf öffnete das Zuständigkeitsmenü, setzte den Kundenfilter und zeigte die Berichte. Er wählte weder die vorhandene Zuständigkeit noch die vorhandenen Minuten. Seine Abschlussprüfung ergab `outstanding` mit 25 Prozent; der Lauf endete in der Auswahl. Der zweite Lauf wählte sofort `blocked`. Falsche Änderungen entstanden nicht. Ob Jev bereits passende gespeicherte Werte als erfüllt bewertet, bleibt eine offene Grenze der Modellentscheidung. Die Aufzeichnungen liegen lokal unter `live-results/repeated-actions-2026-09-21/live-first/`.

Seitdem beschreibt `retainedSelection` den gespeicherten Stand des ausgewählten Vorgangs auch auf der Berichtsansicht. Eine unsichere `blocked`-Entscheidung öffnet die Auswahl, statt den Lauf zu beenden. Eine Zahl, die einer vorhandenen Kennung entsprach, nannte diese Kennung in ihrer Herkunftsangabe. Inzwischen wird eine solche Zahl nicht mehr als Feldwert angeboten; eine ausdrückliche Antwort mit denselben Ziffern bleibt möglich. Der lokale Prüftreiber liest den Filter aus der letzten Jev-Entscheidung; ein richtiger Lauf ohne Schritte kann dadurch bestehen.

Drei echte Läufe mit einer Schwelle von 10 Prozent führten beide Wiederholungen jeweils autonom aus. Keiner speicherte etwas. Die erste Wiederholung setzte Filter und Berichtsansicht; ihre Abschlussprüfung ergab `complete` mit einer Confidence von 61 bis 65 Prozent. Die zweite Wiederholung meldete ohne weiteren Schritt den Abschluss. Ihre Abschlussprüfung ergab `complete` mit nur 30 bis 34 Prozent und würde bei einer höheren Schwelle zur Auswahl führen. Jev wählte `field:minutes:1041` in keinem Lauf. Diese Option erhielt weiterhin 2 bis 19 Prozent der Optionswahrscheinlichkeit, die Termindauer von 60 Minuten 11 bis 24 Prozent. Bei 75 Prozent hielt der Lauf bereits beim ersten Schritt mit einer Auswahl-Confidence von 23 Prozent zur Auswahl an. Die Aufzeichnungen liegen lokal unter `live-results/repeated-actions-2026-09-21/retained-10`, `retained-10b`, `retained-10c` und `retained-75`.

## KI-010: Vorbelegung übernimmt den alten Wert statt des neuen

Status: am 23. September 2026 im Eval-Lauf auf holdout-1 beobachtet, auf dem Zweig `exp/jev-fix-prefill` behoben (noch nicht in `main`).

Die Antwortvorbelegung für ein Zahlenfeld übernimmt den einzigen Zahlwert, den `partialAnswer` im Auftrag findet. Nennt der Auftrag den alten Wert als Zahl und den neuen nur als Zahlwort, ist dieser einzige Wert der alte. Im Auftrag „zwei Stunden is zu lang, mach mal neunzig Minuten draus“ (Szenario `h-diktat-05`) liest `partialAnswer` für die Termindauer „zwei Stunden“ als 120. „neunzig“ liest es nicht. Das Antwortfeld zeigt „Aus dem Auftrag: 120. Bitte prüfen.“, obwohl 90 gemeint ist. Steht dort „90“, findet es zwei Werte und belegt nichts vor.

Ein Mensch, der die Vorbelegung ungeprüft bestätigt, setzt den alten Wert erneut. Der Eval-Lauf bestätigt Vorbelegungen unverändert und zählt den Lauf deshalb als asked-wrong. Die Aufzeichnung liegt lokal unter `live-results/question-pipeline-2026-09-21/round5/eval-answers/h1/samples/h-diktat-05__1.json`.

Die Vorbelegung liest den Wert jetzt nicht mehr im Code, sondern Jev liest ihn (`readValues` in `server/reader.ts`, `shared/value-reading.ts`). Code rechnet jede geschriebene Zahl und jede gesprochene Dauer in Minuten um und bietet sie als Auswahl an. Jev wählt die Angabe mit dem neuen Wert. Für den Auftrag aus `h-diktat-05` wählt Jev „neunzig (Minuten)“ = 90, und das Antwortfeld zeigt 90. Liest Jev keinen neuen Wert mit mindestens 0,6 Konfidenz, bleibt das Feld leer, auch wenn der Auftrag den alten Wert als Zahl nennt. Der Browser-Test `tests/missing-value.e2e.ts` hält beides fest. Im Eval-Lauf auf holdout-1 endete `h-diktat-05` danach als correct-after-answers mit der Vorbelegung 90.

Grenzen: Fragt man nach der Termindauer, liest Jev eine Minutenangabe ohne Feldwort („75 min“, „az 50 min“) sicher als Termindauer, auch wo die Szenarien Arbeitszeit meinen. Eine eigene Frage nach dem Feld half nicht: auch sie nannte bei „az 50 min“ die Termindauer (0,85). In 1529 aufgezeichneten Läufen fragte Jev nie nach der Termindauer, wo das Szenario keine nennt; die Vorbelegung kann diesen Fehler also nur zeigen, wenn Jev falsch nach der Termindauer fragt. Zahlwörter über hundert („hundertzwanzig“) stehen nicht in der Auswahl.

## KI-011: Grenzen der gerechneten Werte und der Zeilenbindung

Status: am 23. September 2026 in Runde 6 beim Bau der gerechneten Kandidaten festgestellt, nicht behoben.

Die Summen und Differenzen der Arbeitszeit rechnen mit dem Stand beim Start des Laufs. Ein Auftrag wie „auf 45 speichern, dann noch 15 dazu“ erreicht deshalb nicht 60. Die zweite Angabe bietet 45 + 15 nicht an, sondern den Startwert plus 15.

Die Zeitspannen für die Termindauer kennen keinen Wechsel über 12 Uhr. „von 11 bis 1“ ergibt keinen Kandidaten. „bis um 15“ gilt nicht als Ende einer Spanne. Eine Uhrzeit mit Punkt am Satzende („9.45.“) liest die Anwendung als Datum. Stundenwörter ohne Uhrzeitform („von neun bis elf“) ergeben keine Spanne.

Öffnet Jev einen Vorgang über das Menü **Vorgang öffnen** statt über seine Zeile, bindet der Lauf eine Angabe wie „den ersten“ nicht an diesen Vorgang. `listOrdinals` nennt sie dann nicht.

Eine abgebrochene Messung zeigte zudem, dass eine Aufrufgrenze der Auswertung wie ein Ausfall von Jev aussah. Die Auswertung nennt eine solche Grenze jetzt als Ursache, und der Server gibt Fehlername und HTTP-Status des Anbieters in den Fehlerdaten mit.
