# Offene Prüfungen

## KI-001: Sporadischer Fehler beim Fortsetzen nach einer Dialogpause

Status: historische Beobachtung, Ursache nicht nachgewiesen.

Ein Browser-Test des früheren festen Auftragsplaners meldete einmal `PROVIDER_INVALID_RESPONSE` nach Escape. Er verwendete einen lokal simulierten TypeSafe-Transport. Die Anwendung pausierte. Es gab keinen Nachweis einer unzulässigen Speicherung. Der vollständige Folgelauf und 13 gezielte Wiederholungen bestanden.

Der dynamische Entscheidungszyklus ersetzt inzwischen diesen Planer. Das erklärt die frühere Beobachtung nicht. Bei erneutem Auftreten müssen die erhaltene Provider-Antwort, die Optionen derselben Anfrage und der Playwright-Trace erhalten bleiben. Weitere erfolgreiche Wiederholungen allein klären die Ursache nicht.

## KI-002: Modellunsicherheit und mehrteilige Aufträge

Status: im Live-Lauf vom 20. September 2026 mit `jev-1.13.0` beobachtet.

Jev kann einen passenden nächsten Schritt auswählen und zugleich eine niedrige Confidence liefern. Die Anwendung zeigt eine konkrete Auswahl zur Bestätigung. Eine bestätigte Bedienhandlung ist im Live-Bericht von einer automatisch ausgeführten Handlung zu unterscheiden.

Der Ablauf wiederholt den vollständigen ursprünglichen Auftrag und die beobachteten Ergebnisse nach jedem Schritt. Trotzdem kann Jev einen Teilauftrag übersehen, zu früh einen Abschluss vorschlagen oder keinen sinnvollen nächsten Schritt erkennen. Die gesonderte Abschlussbewertung und Speicherbelege reduzieren verschiedene Fehlerarten. Sie beweisen kein allgemeines Verständnis beliebiger Anweisungen.

Im vollständigen Lauf bestanden sieben von 18 Szenarien ihre Erwartungen nicht. Neben Bestätigungspausen gab es zwei semantische Fehler. Bei einer wiederholten Zuweisung öffnete Jev nach der ersten korrekten Speicherung einen anderen Vorgang. Die folgende Änderung blieb zur Bestätigung stehen. Bei „Zuerst V-1042 abschließen, dann 45 Minuten Arbeitszeit erfassen“ änderte es die Minuten bereits im Entwurf. Auch die gesonderte Bewertung erkannte diese Verletzung der Reihenfolge nicht. Der Lauf pausierte erst vor dem Abschluss; die Datenbank blieb unverändert.

Diese Fehler werden nicht durch feste Sonderfälle für die beiden Texte umgangen. Die Testfälle bleiben im Live-Lauf. Die dynamische Architektur erlaubt freie Kombinationen, garantiert aber weder die richtige Zielauswahl noch die Einhaltung beliebiger sprachlicher Reihenfolgen.

Die [Live-Szenarien](jev-live.md) prüfen daher Oberfläche, genaue Datenänderungen und ausbleibende Nebenwirkungen unabhängig von der Modellantwort. Ein grüner Lauf gilt nur für die enthaltenen Formulierungen und das gemeldete Modell. Bestätigungen, Blockaden und nicht ausgeführte Fälle zählen nicht als autonome Erledigung.

## KI-003: Frühere Begrenzung auf einen Vorgang und eine Zuweisung

Status: die feste Einschränkung ist entfernt.

Der frühere Planer erlaubte einen Zielvorgang und einen Zielwert je Eigenschaft. Eine zusätzliche Namensprüfung lehnte Texte mit mehreren bekannten vollständigen Personennamen ab. Dadurch waren auch sinnvolle Vergleiche und wiederholte Zuweisungen ausgeschlossen.

Der dynamische Ablauf verwendet keine solche Prüfung. Jev kann mehrere sichtbare Vorgänge und aufeinanderfolgende Änderungen wählen. Die Prüfung einer wiederholten Zuweisung muss beide Speicherbelege untersuchen. Der letzte Datenstand allein erkennt nicht, ob der erste beauftragte Zwischenstand jemals gespeichert wurde.

## KI-004: Grenzen der Werte und der verfügbaren Bedienhandlungen

Status: beabsichtigte Grenzen mit offenem Ausbau.

Jev erzeugt keine freien Werte. Passende Literale müssen im Auftrag, in vorhandenen Daten oder in einer ausdrücklichen Antwort enthalten sein. Relative Daten, komplexe Umschreibungen und nicht registrierte Komponenten können deshalb eine Rückfrage oder einen Abbruch benötigen.

Der [Aktionskatalog](action-catalog.md) enthält Ausbauziele. Er ist keine Liste bereits ausführbarer Funktionen. Ein nicht vorhandener E-Mail-Versand bleibt beispielsweise unerfüllbar. Schon gespeicherte, ausdrücklich beauftragte Änderungen bleiben bei einer späteren Blockade erhalten.
