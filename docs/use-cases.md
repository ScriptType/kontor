# Anwendungsfälle in Kontor Service

Kontor Service verwaltet Servicevorgänge für Nordwerk, Hafen & Partner und Lindenwerk. Zuständigkeit, Termin, Arbeitszeit und Abschlussvoraussetzungen gehören zu einem Vorgang. Kundenansicht, Team und Berichte verwenden dieselben gespeicherten Daten.

## Bedienbare Funktionen

Jev kann Seiten öffnen, Kunden-, Status- und Zuständigkeitsfilter sowie die Suche bedienen. Im Vorgang kann es Zuständigkeit, Priorität, Arbeitszeit und Termin bearbeiten, einen Termin entfernen und einen abgeschlossenen Vorgang wieder öffnen. Es wählt nach jedem Schritt erneut aus den zugänglichen Bedienelementen. Die Anwendung legt keine bestimmte Kombination dieser Funktionen als zulässigen Auftrag fest.

Die Oberfläche bleibt manuell bedienbar. Auswählen und Ausfüllen ändern zunächst einen Entwurf. Speichern prüft die Fachregeln erneut. Eine eigenständige Aufgabenverwaltung mit Abhängigkeiten und frei anlegbaren Aufgaben gehört zum [Ausbaukatalog](action-catalog.md).

Die Filter lassen sich kombinieren. **Zurücksetzen** entfernt alle Filter einschließlich der Suche. Kundenverweise öffnen alle Vorgänge des gewählten Kunden. Teamverweise öffnen die offenen Vorgänge der gewählten Person. Die Kennzahlen für offene und abgeschlossene Vorgänge in Berichten führen zur jeweiligen Liste. Diese Verweise ersetzen die bisherigen Filter. In Berichten stehen unter jeder Kundenzeile von „Arbeitszeit nach Kunde“ die Vorgänge dieses Kunden. Ein solcher Vorgang öffnet seine Details auf der Vorgangsseite wie in Kunden- und Teamansicht und lässt die Filter unverändert. Ein Auftrag, der einen Kunden und einen Vorgang nennt, erreicht den Vorgang so direkt aus den Berichten. Ein offener Entwurf bleibt erhalten und verhindert weiterhin das Öffnen eines anderen Vorgangs.

Prioritätsänderung, Wiederöffnung und Terminlöschung werden erst durch **Speichern** verbindlich. **Entwurf verwerfen** stellt den gespeicherten Stand wieder her. Arbeitszeit und Prüfbeleg bleiben bei einer Wiederöffnung erhalten. Team und Berichte berücksichtigen die Änderung nach dem Speichern.

## Aufträge und erwartete Ergebnisse

Diese Beispiele beschreiben die gewünschten Ergebnisse im Live-Modus. Die konkrete Bedienfolge wählt Jev. Modellunsicherheit kann eine Bestätigung oder Rückfrage erfordern. Der [Live-Testlauf](jev-live.md) misst, welche Fälle tatsächlich gelingen.

| Auftrag | Erwartetes Ergebnis |
| --- | --- |
| „Zeig mir die Kunden.“ | Die Kundenansicht ist geöffnet. Keine Fachdaten ändern sich. |
| „Öffne zuerst Kunden, dann Berichte und zuletzt das Team.“ | Die drei Ansichten wurden in dieser Reihenfolge geöffnet. Das Team bleibt sichtbar. |
| „Filter nach Nordwerk.“ | Die Vorgangsliste zeigt die Nordwerk-Vorgänge. |
| „Zeige die offenen Vorgänge von Lea Sommer.“ | Die Liste zeigt nur offene Vorgänge mit Lea Sommer als zuständiger Person. |
| „Setze V-1041 auf hohe Priorität und speichere.“ | Die gespeicherte Priorität lautet Hoch. Andere Felder bleiben unverändert. |
| „Öffne V-1035 wieder und speichere.“ | Der Vorgang ist wieder offen. Erfasste Arbeitszeit und ein vorhandener Prüfbeleg bleiben erhalten. |
| „Entferne den Termin von V-1041 und speichere.“ | Der Vorgang hat keinen Termin mehr. Zuständigkeit und Arbeitszeit bleiben erhalten. |
| „Suche nach "Lindenwerk".“ | Der vorhandene Suchtext wird in das sichtbare Suchfeld übernommen. |
| „Öffne V-1042, erfasse 35 Minuten, speichere und zeige Berichte.“ | V-1042 enthält die bestätigte Arbeitszeit. Danach sind die Berichte sichtbar. |
| „Trage für V-1042 25 Minuten als Entwurf ein, nicht speichern.“ | Das Formular enthält 25 Minuten. Die gespeicherten Daten bleiben unverändert. |
| „Weise V-1042 zuerst Lea Sommer zu und speichere. Danach Jonas Weber zuweisen und erneut speichern.“ | Zwei ausdrücklich verlangte Speicherungen bleiben im Verlauf unterscheidbar, auch wenn der Endwert dem Anfangswert entspricht. |
| „Weise V-1041 Mara Schulz zu, erfasse 60 Minuten, filtere nach Nordwerk und zeige Berichte.“ | Bereits passend gespeicherte Zuständigkeit und Minuten bleiben erhalten. Schritte ohne Änderung sind im Verlauf erkennbar. Der Filter und die Berichtsansicht bleiben eigene Teile des Auftrags. |
| „Erfasse Arbeitszeit für V-1042.“ | Jev öffnet den Vorgang und fragt nach einem fehlenden Wert. Es erfindet keine geleisteten Minuten. |
| „Schließe V-1039 ab.“ | Fehlende Abschlussvoraussetzungen werden im geöffneten Vorgang verständlich. Ein Prüfbeleg bleibt eine menschliche Eingabe. |
| „Weise V-1042 Lea Sommer zu und speichere. Sende danach eine E-Mail.“ | Die Anwendung hat keine E-Mail-Aktion. Sie darf den gesamten Auftrag nicht als erledigt melden. Bereits bestätigte Speicherungen bleiben erhalten. |

Mehrere Änderungen können verschiedene Vorgänge betreffen. Bei ausdrücklich verlangter Reihenfolge darf Jev diese nicht stillschweigend ändern. Fehlt eine Voraussetzung, kann es eine konkrete zusätzliche Änderung zur Freigabe vorschlagen. Eine fehlende Beobachtung oder unbekannte Zahl ist keine Erlaubnis, einen Wert zu erfinden.

## Rückfragen und Unterbrechungen

Neue Rückfragen und Freigaben öffnen das Auftragsfenster automatisch. Escape schließt es und lässt die Frage offen. Bei Unsicherheit stehen die zwei am höchsten bewerteten Jev-Optionen mit Prozentwerten zur Auswahl. Jede Option nennt ihre geplante Wirkung. Die ursprüngliche Auswahl und deren Confidence bleiben gesondert sichtbar. Die Bestätigung gilt für die gewählte Handlung und den dazugehörigen Zustand.

Die Prozentwerte der Rangfolge sind Optionswahrscheinlichkeiten aus derselben Antwort. Sie ersetzen nicht die Auswahl-Confidence für die Sicherheitsschwelle. Eine andere gewählte Aktion wird erneut geprüft. Zusätzliche oder unklare Änderungen benötigen eine konkrete Freigabe; widersprüchliche Änderungen bleiben gesperrt. Eine gewählte Abschlussprüfung kann keine Erledigung erzwingen.

Kann Jev keinen sinnvollen nächsten Schritt wählen, kann es ausdrücklich anhalten. Die Palette bietet die bewerteten Optionen sowie Überarbeiten und Stoppen an. Bereits gespeicherte Änderungen bleiben erhalten. Dieser Halt allein erzeugt keinen fachlichen Hinweis auf einen fehlenden Prüfbeleg.

Unter **Jev-Einstellungen** legt der Nutzer eine Sicherheitsschwelle von 0 bis 100 Prozent fest. Der Standard ist 75 Prozent. Unterhalb der Schwelle fragt Jev vor einem konkreten Schritt nach. Derselbe Wert gilt für die Auswahl und die gesonderte Bewertung des Auftragsabschlusses. Bei genau erreichter Schwelle genügt die Sicherheit. Zusätzliche Änderungen brauchen weiterhin eine Freigabe. Fehlende Werte und menschliche Prüfbelege bleiben eigene Voraussetzungen.

Die Einstellung bleibt in diesem Browser gespeichert. Scheitert das Speichern der Einstellung, weist die Palette darauf hin, dass sie nur für die aktuelle Sitzung gilt. Eine Änderung entwertet ausstehende Entscheidungen und Freigaben. Ein laufender Auftrag wartet anschließend auf ausdrückliches Fortsetzen. Jev kann seine eigene Sicherheitsschwelle nicht ändern.

Das Öffnen des Auftragsfensters pausiert einen laufenden Auftrag. Manuelle Änderungen pausieren ebenfalls. Ein fremder ungespeicherter Entwurf muss vor einem neuen Auftrag gespeichert oder verworfen werden. Jev übernimmt ihn nicht stillschweigend.

Stoppen verhindert weitere Schritte. Eine bereits gestartete Speicherung kann noch abgeschlossen werden. Speicherbelege bestimmen das Ergebnis. Nach Neuladen läuft kein unterbrochener Auftrag automatisch weiter.

**Demodaten zurücksetzen** stellt nach Bestätigung den Ausgangsstand her. Der Reset beendet den Auftrag im aktuellen Tab und leert dessen Entwürfe, Filter, Eingabe und Verlauf. API-Schlüssel, Betriebsmodus und die persönliche Sicherheitsschwelle bleiben erhalten.

## Demo und Live

Im Demo-Modus funktionieren nur die ausdrücklich angezeigten Beispieltexte. Ihre Entscheidungen sind vorgegeben. Bedienhandlungen und Speicherungen durchlaufen die tatsächliche Anwendung. Die Auswahl eines Beispiels setzt keine Daten zurück. Ein unbekannter Text startet keinen ähnlichen Beispielauftrag.

Der Live-Modus verwendet ausschließlich Jev. Werte stammen aus dem Auftrag, vorhandenen Daten oder ausdrücklich beantworteten Rückfragen. Jev erzeugt keine freien Texte. Wörtliche Datumsangaben und Zahlen müssen als passende Kandidaten verfügbar sein oder vom Nutzer eingegeben werden.

Die Demo belegt das Verhalten der Anwendung mit vorgegebenen Antworten. Echte Jev-Aufrufe prüfen zusätzlich das Sprachverständnis. Dabei zählen der beobachtete Endzustand, gespeicherte Änderungen, eingehaltene Reihenfolge und ausbleibende Nebenwirkungen. Confidence und eine Abschlussmeldung allein reichen nicht.

## Geplanter Ausbau

Der [Aktionskatalog](action-catalog.md) beschreibt 120 Fachaktionen für Vorgänge, Aufgaben, Kunden, Anlagen, Termine, Team, Material, Zeit, Vorlagen und Berichte. Eigene Komponenten sollen Abhängigkeiten, Materialpakete, verschachtelte Filter und Terminplanung bedienbar machen.

Jede neue Funktion benötigt eine manuelle Bedienung, beschriebene zugängliche Aktionen, Fachregeln und beobachtbare Ergebnisse. Neue Ablaufkombinationen benötigen keine weitere Fallunterscheidung in einem zentralen Auftragsplaner.
