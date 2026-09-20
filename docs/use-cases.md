# Anwendungsfälle in Kontor Service

Kontor Service verwaltet Servicevorgänge für Nordwerk, Hafen & Partner und Lindenwerk. Vorgänge enthalten Zuständigkeit, Termin, Arbeitszeit und Abschlussvoraussetzungen. Kundenansicht, Team und Berichte verwenden dieselben gespeicherten Daten.

## Erster Funktionsumfang

Die Bedienassistenz unterstützt Kundenfilter, offene Vorgänge, Zuweisung, Termine, Arbeitsminuten und Abschluss. Ein Auftrag bearbeitet derzeit einen Zielvorgang und höchstens eine Änderung je unterstützter Zielart. Fehlende Angaben erzeugen Rückfragen. Ein Terminkonflikt kann einen zusätzlichen Personenwechsel erfordern. Dafür zeigt die Anwendung eine konkrete Lösung zur Bestätigung.

Die Oberfläche bleibt manuell bedienbar. Auswählen und Ausfüllen ändern zunächst den Entwurf. Speichern prüft die Fachregeln erneut. Die Aufgaben eines Vorgangs zeigen seinen Bearbeitungsstand und die fehlenden Voraussetzungen. Eine eigenständige Aufgabenverwaltung mit Abhängigkeiten und frei anlegbaren Aufgaben gehört zum [Ausbaukatalog](action-catalog.md).

## Demo-Aufträge

Das Auftragsfenster zeigt die verfügbaren Beispielaufträge. Im Demo-Modus funktionieren ausschließlich diese Texte. Ihre Entscheidungen sind vorgegeben; die sichtbaren Bedienhandlungen und Speicherungen laufen durch die tatsächliche Anwendung. Beispielauswahl setzt keine Daten zurück. Das Ergebnis hängt deshalb vom aktuellen gespeicherten Zustand ab.

| Fall | Erwartetes Verhalten |
| --- | --- |
| Offene Nordwerk-Vorgänge anzeigen und V-1042 Lea Sommer zuweisen. | Kundenfilter öffnen, Nordwerk wählen, offene Vorgänge filtern, V-1042 öffnen, Personenmenü öffnen, Lea wählen und speichern. |
| "Die Wartung" Lea Sommer zuweisen. | Den gemeinten Vorgang anhand der vorhandenen Datensätze erfragen. Bis dahin bleibt die Zuweisung unverändert. |
| Arbeitszeit für V-1042 ohne Minutenzahl erfassen. | Tatsächlich geleistete Minuten erfragen und den ausdrücklich gelieferten Wert verwenden. |
| V-1042 abschließen und 45 Minuten erfassen. | Die Abschlussvoraussetzung berücksichtigen und die beauftragte Zeit erfassen. |
| Zuerst V-1042 abschließen, danach 45 Minuten erfassen. | Wenn noch keine Arbeitszeit vorliegt, die unmögliche Reihenfolge erklären und eine zulässige Reihenfolge bestätigen lassen. |
| Einen Termin mit belegter zuständiger Person planen. | Konflikt und freie qualifizierte Alternative anzeigen. Nur die konkret genehmigte zusätzliche Zuweisung ausführen. |
| "Plane V-1042 und speichere" ohne konkrete Zeitangaben. | Datum, Beginn und Dauer als strukturierte Eingabe erfragen. |
| Offene Hafen-Vorgänge anzeigen und den Nordwerk-Vorgang V-1042 Lea Sommer zuweisen. | Den Widerspruch zwischen gewünschtem Filter und Zielvorgang zeigen. Erst nach Zustimmung den widersprechenden Filter aus dem Auftrag entfernen und den Vorgang bearbeiten. |
| V-1039 ohne Prüfbeleg abschließen. | Den fehlenden Beleg erklären. Jev erzeugt oder ändert keinen Prüfbeleg. |
| Einen unbekannten Text im Demo-Modus eingeben. | Die Einschränkung des Demo-Modus erklären und keine ähnliche Beispielaktion starten. |

Ein bereits erfülltes Teilziel benötigt keine erneute Speicherung. Bereits gespeicherte Änderungen aus einem früheren Beispiel bleiben bestehen.

## Rückfragen und Unterbrechungen

Rückfragen stehen im Auftragsfenster. Escape schließt das Fenster; der Status bleibt bei "Antwort ausstehend". Eine bestätigte zusätzliche Änderung gilt nur für den angezeigten Vorschlag und den dazugehörigen Datenstand.

Das Öffnen des Auftragsfensters pausiert einen laufenden Auftrag. Manuelle Änderungen pausieren ebenfalls. Ein fremder ungespeicherter Entwurf muss vor einem neuen Auftrag bewusst gespeichert oder verworfen werden. Jev übernimmt ihn nicht stillschweigend.

Stoppen verhindert weitere Schritte. Eine bereits gestartete Speicherung kann noch abgeschlossen werden. Die Oberfläche zeigt dann ihr tatsächliches Ergebnis. Nach Neuladen läuft kein unterbrochener Auftrag automatisch weiter.

## Live-Auswertung

Der Live-Modus benötigt einen TypeSafe-Schlüssel. Jev beurteilt unterstützte Ziele, Wertkandidaten und aktuell zugängliche Aktionen. Die Anwendung validiert die gewählten Optionen. Fehlende Angaben und unsichere Zuordnungen erlauben keine erfundenen Werte. Wörtliche Datumskandidaten verwenden derzeit `YYYY-MM-DD` und `HH:mm`. Fehlen passende Kandidaten, fragt die Anwendung die Werte ab.

Die lokale Demo belegt das Verhalten der Anwendung. Sie belegt weder das Verständnis deutscher Texte noch die Zuverlässigkeit frei formulierter mehrteiliger Aufträge. Dafür sind echte Jev-Aufrufe mit einer eigenen Auswertungsmenge nötig.

Geeignete Sprachtests verwenden alternative Formulierungen derselben Absicht, ähnliche Vorgangstitel, fehlende Namen, getrennte Arbeits- und Termindauern, "nicht speichern" sowie ausdrückliche Reihenfolgen. Der erwartete Endzustand und die erlaubten Änderungen bilden die Bewertung. Confidence allein entscheidet nicht, ob ein Test bestanden ist.

## Geplanter Ausbau

Der [Aktionskatalog](action-catalog.md) beschreibt 120 Fachaktionen für Vorgänge, Aufgaben, Kunden, Anlagen, Termine, Team, Material, Zeit, Vorlagen und Berichte. Eigene Komponenten sollen Abhängigkeiten, Materialpakete, verschachtelte Filter und Terminplanung bedienbar machen.

Jede neue Funktion benötigt eine manuelle Bedienung, eine beschriebene sichtbare Aktion, fachliche Voraussetzungen und einen beobachtbaren Erfolg. Ein zusätzlicher Jev-Aufruf ersetzt keine Fachregel.
