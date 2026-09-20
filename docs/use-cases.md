# Mögliche Anwendungen

Die Grundinstallation legt noch kein Fachthema fest. TypeSafe bewertet Text anhand kleiner Fragen. Die Anwendung entscheidet anhand dieser Antworten, welcher Schritt folgt. Mehrere Fragen können denselben Zustand in einem Aufruf unabhängig bewerten. Abhängige Entscheidungen benötigen weitere Aufrufe.

## Incident-Triage

Ein Arbeitsbereich sammelt Störungsmeldungen und ordnet sie Teams zu. Choice bestimmt die Zuständigkeit, Score bewertet Auswirkungen, Noul prüft einzelne Eskalationsmerkmale. Unsichere Fälle landen in einer Prüfwarteschlange.

Angular trägt Filter, Detailansichten, Zuweisungen, Korrekturen und eine Live-Warteschlange. RPC verbindet Abfragen und Aktionen wie `incidents.assign`, `evaluations.run` und `reviews.resolve`. Ein späterer Ausbau kann Versionen der Bewertungsregeln, Wiederholungen mit neuen Modellen und einen nachvollziehbaren Verlauf enthalten.

Incident-Triage eignet sich als erster Ausbau. Der erste Ablauf ist überschaubar, spätere Nebenläufigkeit und menschliche Korrekturen machen ihn technisch anspruchsvoll. [Grundlage für das Routing](https://docs.typesafe.ai/patterns/confidence-routing).

## Quellenprüfung für Recherche

Ein Arbeitsbereich stellt Behauptungen ihren Quellen gegenüber. TypeSafe bewertet, ob die Quelle eine Behauptung stützt, ihr widerspricht oder keine Entscheidung ermöglicht. Die Oberfläche zeigt Textstellen nebeneinander und sammelt offene Prüfungen.

Die anspruchsvollen Teile sind die Aufteilung langer Dokumente, Quellenbezüge, parallele Auswertungen, Korrekturen und wiederholbare Vergleiche. Das Modell liefert Bewertungen. Belegstellen und Quellen müssen aus tatsächlich vorhandenen Dokumenten stammen. [Cookbook zur Zitatprüfung](https://docs.typesafe.ai/cookbooks/citation_check).

## Katalogabgleich

Zwei Datenquellen enthalten ähnliche Produkte, Medien oder andere Einträge. TypeSafe bewertet zuvor ermittelte Kandidatenpaare. Menschen bestätigen unsichere Zusammenführungen in einer Vergleichsansicht.

Der Ausbau umfasst Importaufträge, Kandidatensuche, Stapelaktionen, Konflikte zwischen Bearbeitern, rücknehmbare Zusammenführungen und Qualitätsmetriken. Die erste Version kann mit zwei kleinen JSON-Dateien beginnen. [Cookbook zum Entitätenabgleich](https://docs.typesafe.ai/cookbooks/entity_alignment).

## Auswahlkriterien

Ein gutes erstes Thema hat verfügbare Beispieldaten und Entscheidungen, deren Qualität anhand bekannter Fälle geprüft werden kann. Dazu braucht es einen sinnvollen nächsten Schritt nach der Bewertung. Confidence ersetzt diese Qualitätsprüfung nicht.

Für die Auswahl sind vorhandene Daten und persönliches Interesse wichtiger als die Zahl der eingebauten Frameworks. Persistenz, Hintergrundjobs und Live-Updates folgen aus dem gewählten Ablauf.
