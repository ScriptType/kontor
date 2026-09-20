# Aktionskatalog für Kontor Service

Kontor Service verwaltet Installation, Wartung und Reparatur von Kundenanlagen. Vorgänge verbinden Kunden, Aufgaben, Termine, Personal und Material. Die Bedienassistenz verwendet dieselben sichtbaren Bedienelemente wie der Nutzer.

Dieser Katalog beschreibt das Ausbauziel. Er ist keine Liste bereits implementierter Funktionen. Der aktuelle Funktionsumfang und ausführbare Beispiele stehen in [use-cases.md](use-cases.md).

## Fachaktionen

Die folgenden 120 Aktionstypen beschreiben unterschiedliche fachliche Operationen. Eine Aktion für zehn Tabellenzeilen zählt als ein Typ. Öffnen, Auswählen und Speichern können mehrere sichtbare Schritte einer Operation sein.

| Bereich | Geplante Aktionstypen |
| --- | --- |
| Vorgänge | Anlegen; aus Vorlage anlegen; Kunden zuordnen; Standort wechseln; Kategorie setzen; Priorität setzen; Verantwortlichen zuweisen; Fälligkeit setzen; Vorgänge verknüpfen; Vorgang aufteilen; pausieren; abschließen. |
| Aufgaben | Anlegen; Titel aus Auftrag übernehmen; zuweisen; Fälligkeit setzen; Aufwand planen; Reihenfolge ändern; Pflichtaufgabe festlegen; Abhängigkeit hinzufügen; Abhängigkeit entfernen; Blockade mit Grund setzen; erledigen; wieder öffnen. |
| Kunden und Standorte | Kunden anlegen; Stammdaten bearbeiten; Kontakt hinzufügen; Kontakt bearbeiten; Standort hinzufügen; Servicezeiten ändern; Schließtag eintragen; bevorzugtes Team setzen; bevorzugte Fachkraft setzen; Servicepaket ändern; verknüpfte Vorgänge öffnen; Kunden archivieren. |
| Anlagen | Anlegen; Seriennummer setzen; Raum zuordnen; Zustand ändern; Störung erfassen; Wartungsintervall setzen; Wartung planen; Ersatzanlage verknüpfen; Standort wechseln; Anlage stilllegen; wieder aktivieren; Historie öffnen. |
| Termine | Anlegen; freien Zeitraum suchen; Beginn ändern; Dauer ändern; Fachkraft wechseln; Qualifikation festlegen; Leihgerät zuordnen; Termin tauschen; Zeitfenster sperren; Konflikt öffnen; absagen; betroffene Vorgänge öffnen. |
| Team und Kapazität | Arbeitszeit ändern; Tageskapazität setzen; Qualifikation zuweisen; Qualifikation entfernen; Abwesenheit eintragen; Abwesenheit ändern; Abwesenheit aufheben; Vertretung bestimmen; Team wechseln; Einsatzgebiet setzen; Überlastungen filtern; betroffene Termine öffnen. |
| Material und Leihgeräte | Reservieren; Reservierungsmenge ändern; Reservierung freigeben; Lager wählen; Ersatzartikel wählen; Umlagerung anlegen; Verbrauch buchen; Rückgabe buchen; Leihgerät sperren; Sperre aufheben; Fehlbestand öffnen; Materialpaket konfigurieren. |
| Zeit und Budget | Zeiterfassung starten; stoppen; Dauer erfassen; Zeitbuchung korrigieren; Tätigkeit zuordnen; Kostenstelle setzen; Personalkosten zuordnen; Materialkosten zuordnen; Stundenbudget setzen; Kostenbudget setzen; Budgetabweichungen öffnen; Buchung stornieren. |
| Vorlagen | Anlegen; kopieren; Aufgabe hinzufügen; Pflichtfeld setzen; Abhängigkeit setzen; Materialbedarf setzen; Qualifikation setzen; Standarddauer setzen; Wiederholung festlegen; Version veröffentlichen; Vorlage anwenden; Vorlage deaktivieren. |
| Berichte | Zeitraum setzen; Kennzahl wählen; Dimension wählen; gruppieren; Vergleichszeitraum setzen; Diagrammtyp wählen; Diagrammausschnitt filtern; zu Datensätzen wechseln; Bericht speichern; gespeicherten Bericht öffnen; strukturierten Bericht exportieren; Berichtskonfiguration kopieren. |

## Gemeinsame Bedienaktionen

Navigation, Suche, Filter, Sortierung, Spaltenauswahl, Paginierung, Zeilenauswahl, Dialoge, Menüs und Formularfelder kommen zu den Fachaktionen hinzu. Die Ausführung muss zwischen "diese Seite auswählen" und "alle Treffer auswählen" unterscheiden. Bei einer Sammeländerung zeigt die Oberfläche die betroffenen Datensätze und den Umfang vor dem Speichern.

Geschlossene Menüs bieten nur die Aktion zum Öffnen an. Erst das geöffnete Menü bietet seine Einträge an. Ein modaler Dialog sperrt die darunterliegenden Aktionen. Deaktivierte Aktionen bleiben als Fachinformation beschreibbar, gehören aber nicht zur ausführbaren Auswahl.

Werte haben eine Herkunft. Das kann eine konkrete Textstelle des Nutzerauftrags, ein bestehender Datensatz oder eine ausdrücklich gewählte Antwort sein. Jev erzeugt keine freien Texte, Namen, Datumswerte oder Bestätigungen.

## Eigene Komponenten

| Komponente | Sinnvolle Bedienung |
| --- | --- |
| Einsatzplanung | Fachkraft, Datum, Beginn und Dauer über sichtbare Felder und Menüs ändern. Ziehen mit der Maus bleibt eine alternative Bedienung. |
| Filtereditor | Verschachtelte UND- und ODER-Gruppen öffnen, Bedingung hinzufügen und Werte aus verfügbaren Daten auswählen. |
| Aufgabenabhängigkeiten | Vorgänger auswählen, Blockaden anzeigen und zu betroffenen Aufgaben navigieren. Zyklen werden abgelehnt. |
| Materialpaket | Pflichtmaterial, Alternativen, verfügbare Menge und Reservierung gemeinsam zeigen. |
| Standortbaum | Kunde, Gebäude, Raum und Anlage schrittweise aufklappen. |
| Abschlussprüfung | Erfüllte Voraussetzungen und konkrete Blockaden anzeigen. Eine fehlende Prüfung erhält keine automatische Erledigt-Markierung. |
| Bericht mit Detailansicht | Eine Auswahl filtert die Kennzahl. Ein weiterer Schritt öffnet die zugehörigen Vorgänge mit nachvollziehbaren Filtern. |

## Auswirkungen über Seitengrenzen

Fachregeln berechnen die direkten Folgen einer gespeicherten Änderung. Zusätzliche Entscheidungen von Jev durchlaufen wieder die Oberfläche.

| Gespeicherte Änderung | Fachliche Auswirkung |
| --- | --- |
| Termin verschieben | Auslastung und zeitgebundene Gerätereservierung ändern sich. Ein anderer Vorgang wird nicht automatisch verschoben. |
| Abwesenheit eintragen | Betroffene Termine erscheinen als Konflikte. Eine Neuzuweisung benötigt einen eigenen Auftrag oder eine genehmigte Lösung. |
| Leihgerät sperren | Betroffene Vorgänge und Fehlbestandsberichte zeigen die Sperre. |
| Material reservieren | Verfügbare Menge sinkt. Der physische Lagerbestand sinkt erst durch eine Verbrauchsbuchung. |
| Pflichtaufgabe wieder öffnen | Der Vorgang verliert seine Abschlussbereitschaft. |
| Vorgang abschließen | Kundenhistorie und Berichte berücksichtigen die bestätigten Zeiten und Materialbuchungen. |
| Servicezeit eines Standorts ändern | Unpassende Termine erhalten einen Konflikt. Ihre Uhrzeiten bleiben bis zu einer bewussten Änderung bestehen. |

## Unvollständige und blockierte Aufträge

Das Ziel bleibt während der Navigation erhalten. Jeder Schritt erhält den aktuellen Bildschirmzustand, ausführbare Aktionen und relevante Blockaden. Der Server prüft die Fachregeln erneut beim Speichern.

| Situation | Erwartetes Verhalten |
| --- | --- |
| "Ändere den Nordwerk-Vorgang auf erledigt" passt auf mehrere Vorgänge. | Konkrete Datensätze zur Auswahl zeigen. Vor einer Auswahl nichts speichern. |
| "Weise V-1042 zu" nennt keine Person. | Nach der Person fragen. Verfügbare Personen aus vorhandenen Daten anbieten. |
| Ein verlangter Kundenfilter schließt den ebenfalls genannten Zielvorgang aus. | Den Widerspruch erklären und eine konkrete Änderung des Filterauftrags bestätigen lassen. Kein Wechselspiel zwischen Filtersetzen und Zurücksetzen. |
| "Schließe V-1042 ab und buche die genannten 90 Minuten" nennt die Ziele in ungünstiger Reihenfolge. | Wenn die Zeitbuchung ausdrücklich verlangt und der Wert eindeutig ist, zuerst buchen und danach abschließen. |
| "Zuerst abschließen, danach Zeit buchen" fordert eine unzulässige Reihenfolge. | Den Konflikt erklären und eine zulässige Reihenfolge zur Wahl stellen. |
| Gewünschter Termin kollidiert mit der aktuellen Fachkraft. | Freie qualifizierte Alternativen aus den Fachregeln anbieten. Eine zusätzliche Neuzuweisung konkret bestätigen lassen, sofern sie noch nicht beauftragt ist. |
| Eine Pflichtprüfung wurde noch nicht durchgeführt. | Die fehlende Tatsache erklären. Die Prüfung nicht als erledigt markieren, nur um den Abschluss zu ermöglichen. |
| "Archivieren" erfordert den Abschluss offener Aufgaben. | Die offenen Aufgaben zeigen. Archivieren erlaubt keine erfundenen Aufgabenergebnisse. |
| Zwischen Vorschlag und Zustimmung ändert sich die Verfügbarkeit. | Lösung erneut prüfen. Veraltete Zustimmung erlaubt keine anderen Änderungen. |
| Es gibt keine Lösung, oder die Abhängigkeiten bilden einen Zyklus. | Den konkreten Widerspruch anzeigen und den Lauf beenden oder auf eine geänderte Vorgabe warten. |

Eine genehmigte Lösung enthält Datensatz, bisherige Werte, neue Werte und bekannte Auswirkungen. Die Zustimmung gilt für diese Änderungen. Navigation und Menüschritte benötigen keine erneute Zustimmung. Neue fachliche Auswirkungen benötigen eine neue Prüfung des Auftragsumfangs.

Das Schließen einer Rückfrage mit Escape beantwortet sie nicht. Der Lauf bleibt bei "Antwort ausstehend". Ein Stopp verhindert weitere Schritte. Eine bereits bestätigte Speicherung bleibt bestehen.

## Jev-Kontext

Der Kontext enthält den ursprünglichen Auftrag, das strukturierte Ziel, offene Fragen, relevante gespeicherte Fakten, Formularentwürfe, abgeschlossene Schritte und den aktuellen Zustand der Oberfläche. Aktionen und Lösungen haben stabile IDs und verständliche Beschreibungen. IDs allein erklären dem Modell die Bedeutung nicht.

Jev wählt aus begrenzten Optionen. Anwendungscode prüft Datumswerte, Verfügbarkeit, Berechtigungen und Voraussetzungen. Unabhängige Fragen können denselben Aufruf teilen. Neue Informationen durch Navigation oder geöffnete Menüs benötigen einen neuen Zustand. Diese Aufteilung folgt den TypeSafe-Mustern für [Function Calling](https://docs.typesafe.ai/cookbooks/function_calling) und [vorab erkannte Wertkandidaten](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook).

Eine Zustandsrevision bindet jede Entscheidung an ihren Ausgangspunkt. Das Frontend verwirft verspätete Entscheidungen nach Stopp, Pause oder einer Änderung der verfügbaren Aktionen. Eine Operations-ID bindet eine Speicherung an ihr Ergebnis. Ein verlorenes Ergebnis darf keine zweite Speicherung auslösen.

## Stresstest

Die Prüfung bewertet den erreichten Zustand und die tatsächlich gespeicherten Änderungen. Sie fordert keine einzige feste Klickfolge, sofern mehrere sichtbare Wege zulässig sind.

Die Fälle umfassen unvollständige Namen, Pronomen, mehrere passende Datensätze, verneinte Änderungen, explizite Reihenfolgen, mehrere zulässige Lösungen, mehrstufige Blockaden, unmögliche Ziele, manuelle Eingriffe, Verbindungsverlust und zwischenzeitlich veränderte Daten. Jeder Fall legt erlaubte Änderungen und verbotene Nebenwirkungen fest.

Die Demo prüft die Anwendung mit vorgegebenen Entscheidungen. Sie belegt keine Sprachqualität von Jev. Eine separate Live-Auswertung muss deutsche Formulierungen, Auslassungen und Verneinungen mit dem tatsächlich verwendeten Jev-Modell prüfen.
