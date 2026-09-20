# Offene Prüfungen

## KI-001: Sporadischer Fehler beim Fortsetzen nach einer Dialogpause

Status: nicht reproduziert, Ursache offen.

Der Browser-Test `opening palette while own draft awaits Save pauses, closes, decides fresh and saves once` meldete einmal `PROVIDER_INVALID_RESPONSE` nach Escape. Der Test verwendet einen lokal simulierten TypeSafe-Transport. Die Anwendung pausierte. Es gab keinen Nachweis einer unzulässigen Speicherung.

Anschließend bestanden der vollständige Browserlauf und 13 gezielte Wiederholungen dieses Falls. Eine vorübergehende Diagnose prüfte, ob die gewählte Aktion in den angebotenen Optionen fehlte. Sie lieferte keinen entsprechenden Befund. Daraus folgt weder ein bestätigter Anwendungsfehler noch ein bestätigter Fehler der Testsimulation.

Bei erneutem Auftreten müssen die erhaltene Provider-Antwort, die Optionen derselben Anfrage und der Playwright-Trace erhalten bleiben. Ein weiterer erfolgreicher Wiederholungslauf klärt die Ursache nicht.

## KI-002: Unterschiedliche Bewertungen klarer Aufträge durch Live-Jev

Status: Integrationsfehler korrigiert, Sprachvariabilität weiterhin beobachtet.

Der ursprüngliche Auftrag "Filter nach nordwerk" wird jetzt korrekt ausgeführt. Die Erkennung trennt Aufgabenarten, Werte und vollständige Abdeckung. Unsichere Bewertungen irrelevanter Aufgabenarten blockieren nicht mehr pauschal den Auftrag. Reine Filter benötigen weder einen Vorgang noch eine Speicherabsicht. Auch "35 geleistete Minuten" liefert jetzt die Zahl als Kandidaten an Jev.

Wenn Jev den vollständigen Auftrag inhaltlich bejaht, aber zu unsicher bewertet, zeigt die Palette den konkreten Plan zur Bestätigung. Fehlende Angaben werden vorher erfragt. Vor dieser Bestätigung sind keine UI-Aktionen oder Datenänderungen erlaubt. Negative oder unklare Umfangsentscheidungen bleiben abgelehnt. Die Confidence-Schwelle für die Auswahl konkreter Bedienelemente bleibt bei 0,75.

Am 20. September 2026 bestand der abschließende integrierte Lauf auf `4f67dd0` alle 18 Szenarien mit `jev-1.13.0` und 62 Anbieteraufrufen. Acht Szenarien erreichten das erwartete Filter-, Entwurfs- oder Speicherergebnis. Zwei davon erforderten die Auftragsbestätigung. Ein Terminkonflikt benötigte zusätzlich die ausdrückliche Wahl der vorgeschlagenen Person. Sieben Szenarien stellten die erwartete Rückfrage, drei lehnten nicht unterstützte Aufträge ab. Der lokale Bericht liegt unter `live-results/2026-09-20T18-45-52.185Z/report.json`.

Ein früherer vollständiger Lauf bestand 14 von 18 Szenarien. Er enthielt einen Fehler im Browser-Test beim Ablesen der Ausgangsseite und echte Fehlbewertungen des Modells. Die Kombination aus 45 Minuten Arbeitszeit und 60 Minuten Termindauer wurde einmal korrekt zur Bestätigung vorgelegt und später als nicht unterstützt bewertet. Der abschließende Erfolg hebt diese Beobachtung nicht auf. Der Live-Test bleibt deshalb eine wiederholbare Messung mit festen Ergebniserwartungen.

Eine zusätzliche Prüfung verwendete den ursprünglichen Filter und drei neue Formulierungen. Sie prüfte den Hafen-Filter aus den Berichten, eine ungespeicherte Zuweisung bei 390 Pixeln Bildschirmbreite und die Speicherung von 35 geleisteten Minuten. Der Minutenfall bestand nach der Korrektur seiner Kandidatenerkennung. Die Prüfung verglich jeweils den gesamten gespeicherten Datenstand mit dem erwarteten Ergebnis.

## KI-003: Konservative Grenze bei mehreren Personennamen

Status: bekannte Einschränkung der Auftragserkennung.

Jev bewertete eine wiederholte Zuweisung an zwei Personen fälschlich als Einzelauftrag. Deshalb lehnt die Anwendung einen Auftrag mit mehr als einem bekannten vollständigen Personennamen bereits vor der Planung ab. Sie bietet keine Bestätigung eines verkürzten Teilauftrags an.

Diese Grenze betrifft auch Vergleichsformulierungen wie "Lea Sommer statt Jonas Weber". Verwende zunächst einen Auftrag mit genau einer Zielperson, etwa "Weise V-1042 Lea Sommer zu." Die Grenze erkennt vollständige Namen aus dem Arbeitsbereich. Sie ist kein allgemeiner Nachweis, dass jede sprachliche Mehrdeutigkeit erkannt wird.

[Live-Szenarien ausführen und auswerten](jev-live.md) beschreibt die Befehle, die isolierten Testdaten und die Auswertung fehlgeschlagener oder unvollständiger Läufe.
