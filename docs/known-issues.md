# Offene Prüfungen

## KI-001: Sporadischer Fehler beim Fortsetzen nach einer Dialogpause

Status: nicht reproduziert, Ursache offen.

Der Browser-Test `opening palette while own draft awaits Save pauses, closes, decides fresh and saves once` meldete einmal `PROVIDER_INVALID_RESPONSE` nach Escape. Der Test verwendet einen lokal simulierten TypeSafe-Transport. Die Anwendung pausierte. Es gab keinen Nachweis einer unzulässigen Speicherung.

Anschließend bestanden der vollständige Browserlauf und 13 gezielte Wiederholungen dieses Falls. Eine vorübergehende Diagnose prüfte, ob die gewählte Aktion in den angebotenen Optionen fehlte. Sie lieferte keinen entsprechenden Befund. Daraus folgt weder ein bestätigter Anwendungsfehler noch ein bestätigter Fehler der Testsimulation.

Bei erneutem Auftreten müssen die erhaltene Provider-Antwort, die Optionen derselben Anfrage und der Playwright-Trace erhalten bleiben. Ein weiterer erfolgreicher Wiederholungslauf klärt die Ursache nicht.

## KI-002: Unterstützte Formulierungen werden teilweise zurückgewiesen

Status: mit echtem Jev beobachtet, weitere Auswertung offen.

Am 20. September 2026 wurde die echte TypeSafe-Anbindung geprüft. Der Auftrag "Schließe V-1039 ab." liefert nach der Trennung von Absicht und Abschlussvoraussetzungen den richtigen Vorgang, das Abschlussziel und die Speicherabsicht. Der vollständige Browserablauf bestand mit separaten Testdaten und fünf echten Jev-Aufrufen. Er umfasst Navigation aus den Berichten, automatische Rückfrage, manuelle Belegeingabe, Speicherung, ausdrückliches Fortsetzen und Abschluss. Desktop und mobile Darstellung wurden dabei geprüft.

Zwei weitere Formulierungen wurden wegen einzelner Bewertungen unter der vorhandenen Confidence-Schwelle von 0,75 als nicht unterstützt behandelt. Das betraf "Trage für V-1042 25 Minuten Arbeitszeit als Entwurf ein, nicht speichern." und "Weise die Wartung Lea Sommer zu und speichere." Die erste Antwort erkannte den Entwurfswunsch. Die zweite erkannte die Zuweisung und ließ den mehrdeutigen Vorgang offen. Die zusätzliche Umfangsprüfung verhinderte aber den Übergang zur passenden Ausführung beziehungsweise Rückfrage.

Einzelne erfolgreiche Modellaufrufe belegen keine allgemeine Sprachqualität. Die automatisierten Tests verwenden weiterhin simulierte Antworten. Eine reproduzierbare Live-Auswertung muss erwartete Ziele, erforderliche Rückfragen und erlaubte Änderungen prüfen. Die Confidence-Schwelle wurde nicht abgesenkt.
