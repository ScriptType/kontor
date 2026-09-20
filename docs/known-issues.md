# Offene Prüfungen

## KI-001: Sporadischer Fehler beim Fortsetzen nach einer Dialogpause

Status: nicht reproduziert, Ursache offen.

Der Browser-Test `opening palette while own draft awaits Save pauses, closes, decides fresh and saves once` meldete einmal `PROVIDER_INVALID_RESPONSE` nach Escape. Der Test verwendet einen lokal simulierten TypeSafe-Transport. Die Anwendung pausierte. Es gab keinen Nachweis einer unzulässigen Speicherung.

Anschließend bestanden der vollständige Browserlauf und 13 gezielte Wiederholungen dieses Falls. Eine vorübergehende Diagnose prüfte, ob die gewählte Aktion in den angebotenen Optionen fehlte. Sie lieferte keinen entsprechenden Befund. Daraus folgt weder ein bestätigter Anwendungsfehler noch ein bestätigter Fehler der Testsimulation.

Bei erneutem Auftreten müssen die erhaltene Provider-Antwort, die Optionen derselben Anfrage und der Playwright-Trace erhalten bleiben. Ein weiterer erfolgreicher Wiederholungslauf klärt die Ursache nicht.

## Echte Jev-Auswertung

Die lokalen Tests prüfen das SDK mit simulierten Antworten. Es war kein TypeSafe-Schlüssel konfiguriert. Sprachverständnis, Confidence-Verhalten, Anbieter-Latenz und die Zuverlässigkeit deutscher mehrteiliger Aufträge sind deshalb nicht mit dem tatsächlichen Modell geprüft.
