# TypeSafe Lab

Lokales Angular-Lab mit oRPC v2 über WebSockets, TanStack Query, Hono und dem TypeSafe SDK. Der Demo-Modus zeigt feste Beispielwerte für Choice, Score und Noul. Er wertet den Text nicht aus und ruft TypeSafe auch bei vorhandenem API-Key nicht auf.

oRPC ist exakt auf `2.0.0-beta.37` festgelegt. Client und Server nutzen dieselbe Beta-Version.

## Starten

Node 24.19.0 verwenden, siehe `.nvmrc`. Unterstützt wird Node 24 ab 24.15.0.

```sh
npm ci
cp .env.example .env
npm run dev
```

Die Oberfläche läuft auf http://127.0.0.1:4200. Angular leitet den WebSocket unter `/rpc` an den lokalen Server auf Port 3000 weiter. `.env` wird automatisch geladen und bleibt außerhalb von Git. TanStack Query Devtools stehen im Entwicklungsmodus bereit.

Alle Anwendungsaufrufe zwischen Frontend und Backend verwenden denselben WebSocket. HTML, Assets und der WebSocket-Handshake verwenden HTTP. Die Verbindung vom Backend zur TypeSafe-API verwendet HTTPS.

## Live-Modus

In `.env` explizit `TYPESAFE_MODE=live` und `TYPESAFE_API_KEY` setzen. `TYPESAFE_DEFAULT_MODEL=jev-latest` ist der Standard. Server danach neu starten. Live sendet den eingegebenen Text an TypeSafe und kann Kosten verursachen. Ein fehlender oder leerer Key verhindert den Serverstart. Fehler führen nie zu einem Demo-Ergebnis. Pro Anfrage gilt ein Timeout von zehn Sekunden ohne Wiederholungen.

## Prüfen und gebaut starten

```sh
npm run verify
npm start
```

`verify` prüft Typen, baut Frontend und Server und führt WebSocket- sowie Browser-Tests aus. Der Browser-Test benötigt lokal installiertes Google Chrome und startet immer einen Demo-Server ohne API-Key. `npm start` stellt den Build unter http://127.0.0.1:3000 bereit. Nur Loopback wird gebunden.

`npm test` prüft den echten WebSocket-Transport sowie das SDK mit lokal simulierten Provider-Antworten. Es sendet keine Anfrage an TypeSafe. Ein erfolgreicher echter Live-Aufruf wurde nicht geprüft.

## Aufrufe in Angular

Der öffentliche Vertrag liegt in `shared/contract.ts`, das SDK ausschließlich in `server/evaluator.ts`. Die oRPC-Utilities erzeugen typisierte Optionen und Query-Keys. Komponenten verwalten keinen Socket und schreiben keine `queryFn` von Hand.

```ts
private readonly orpc = inject(ORPC);
readonly status = injectQuery(() => this.orpc.status.queryOptions());
readonly evaluation = injectMutation(() =>
  this.orpc.evaluate.mutationOptions({ retry: false }),
);

evaluate() {
  this.evaluation.mutate({ text: this.text() });
}
```

Die Ergebnisse stehen als Angular-Signals bereit, beispielsweise `evaluation.data()` und `evaluation.isPending()`. Eine neue Prozedur wird im gemeinsamen Vertrag und im Server-Router ergänzt. Der Client und seine Query-Optionen erhalten die Typen daraus ohne Codegenerierung.

Nach einem Verbindungsabbruch öffnet der nächste Aufruf einen neuen Socket. Laufende Auswertungen werden nicht automatisch wiederholt. Ein Abbruch nach dem Senden kann bedeuten, dass TypeSafe den Text bereits verarbeitet hat.

Der angezeigte Score darf Nachkommastellen haben. Noul besitzt keinen Confidence-Wert; Confidence ist keine gemessene Genauigkeit.

[Architektur und Bibliotheksvergleich](docs/architecture.md) erläutern die Auswahl. [Mögliche Anwendungen](docs/use-cases.md) beschreiben weitere Einsatzmöglichkeiten für TypeSafe.

[Oberfläche und Bedienassistenz](docs/design-system.md) beschreibt die geplante Vorgangsverwaltung, das gemeinsame Designsystem und Jevs schrittweise Bedienung der sichtbaren Oberfläche.
