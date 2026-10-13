# Produktionsprovenienz GQS-00@1.0.0

Stand: 8. August 2026. Urteil: **VERIFIED** für das Produktionsboard vom 7. August 2026.

## Eindeutige Kette

Der geplante Lauf `daily-pull` mit Run-ID `31147698301` startete auf `4cae8dcdbe445abf9bc03dadc3f852e6b0fd864b`. Der Scoring-Job checkte exakt diesen SHA aus und erzeugte um `2026-08-07T05:47:40.859Z` 8.763 geroutete Scores. Die Rohsnapshots kamen aus dem im selben Workflow erzeugten Merge-Artefakt; der Yahoo-Datencommit `b26e1c0b4a0f5fc00f04a7b5229941186d3fad38` wurde danach zur Git-Basis. Der Board-Writer schrieb die Vintages im Commit `734025a1915d4bda5947a75ab71d9ba4bd9f8ded`. Deshalb sind Formelcheckout, Datencommit und Boardcommit drei verschiedene, jeweils belegte Identitäten.

Das Boardfeld `formulaCommit` enthält korrekt `4cae8d…`; `formulaVersion: calibration/v4` bezeichnet nur das Kalibrierungsschema. Die neue semantische Identität `GQS-00@1.0.0` ist additive Provenienz und wird nicht rückwirkend als altes Exportfeld ausgegeben.

## Evidenztabelle

| Aussage | Beleg | Commit/Hash | Status | Schadenswirkung bei falscher Zuordnung |
|---|---|---|---|---|
| Lokales und Remote-`main` vor dem Freeze waren synchron. | `git rev-parse HEAD` und `origin/main` nach vorgeschriebenem Pull. | `6c15d48f686c5d01dbe42bcb1644d9a19e3cd30b` | VERIFIED | Ein Freeze auf veraltetem Code könnte spätere Formeländerungen übersehen. |
| Der Produktionsworkflow vom 7. August startete auf dem Formelcheckout `4cae8d…`. | Workflowmetadaten `headSha`; Checkout-Log und `git log -1` im Scoring-Job `92782010111`. | Run `31147698301`; `4cae8dcdbe445abf9bc03dadc3f852e6b0fd864b` | VERIFIED | Ohne Checkoutbeleg wäre nur zeitliche Nähe, keine Produktionszuordnung belegt. |
| Der Yahoo-Datencommit ist nicht der Formelcommit. | Git-Elternkette und Commitzeit des Pull-Jobs. | `b26e1c0b4a0f5fc00f04a7b5229941186d3fad38`, Parent `4cae8d…` | VERIFIED | Vermischung würde Code- und Datenänderungen ununterscheidbar machen. |
| Das veröffentlichte Board-Vintage wurde im Boardcommit materialisiert. | Git-Historie und alle 14 Dateien unter `board-history/2026-08-07`. | `734025a1915d4bda5947a75ab71d9ba4bd9f8ded` | VERIFIED | Der Formel-SHA allein beweist nicht, welches Board tatsächlich committet wurde. |
| Alle Boarddateien tragen denselben Formel-SHA. | Vollscan über 13 Branchenboards plus Survival. | `formulaCommit=4cae8d…`; `formulaVersion=calibration/v4` | VERIFIED | Gemischte Formelstände in einem Vintage würden den Querschnitt entwerten. |
| Der Scoring-Baum ist vom auditieren Stand bis heute bytegleich. | Git-Tree-Vergleich über `6b57f777…`, `4cae8d…`, `599e8f3…`, `734025a…`, `6c15d48…`. | `src/scoring` Tree `2728be605cc614cec2863c937c423afd8a249efe` | VERIFIED | Schon ein Byte Unterschied hätte die behauptete Formelgleichheit geöffnet. |
| Alter Formelcommit und Freeze-Code liefern identische Rohscores und Ränge. | Zwei getrennte `scoreUniverse`-Ausführungen auf demselben geladenen Universum. | 14.654 Ergebniszeilen; 0 Shape-, 0 ungerundete Score-, 0 Rangabweichungen | VERIFIED | Ein nur gerundeter Vergleich könnte kleine, rangwirksame Drifts verbergen. |
| Der Freeze reproduziert das veröffentlichte Board. | Vergleich jeder Trackliste gegen `board-history/2026-08-07`. | 8.763/8.763 Zeilen; 0 Tickerreihenfolge-, 0 Displayscore-, 0 Rangabweichungen | VERIFIED | Ohne Boardvergleich wäre nur Code-zu-Code-, nicht Code-zu-Produktion-Gleichheit belegt. |
| Der vollständige Merge-Rohdatenlauf war am 8. August abrufbar. | Actions-Artefaktmetadaten und lokaler Vollscan. | Artefakt `8983459896`; Digest `sha256:7134ad55484e1d607868cf0f04570b5b210a2d8d3ccdd7dee0c45acecfc9c664`; 14.695 Snapshots | VERIFIED | Ohne Rohinput wäre eine unabhängige Produktionsreproduktion nicht möglich. |
| Der Rohdatenlauf ist dauerhaft revisionssicher persistiert. | Git- und Artefaktprüfung: Actions-Ablauf am 14. August; nur ausgewählte Board-/Fixture-Daten sind committet. | Manifest SHA-256 `c514b6678eb9b9ecc7c551496812f2ff83adf62f7c793033515d37ac18dc8d90` | NOT_FOUND | Nach Ablauf ist ein Vollreplay dieses Tages aus dem Repository allein nicht mehr möglich. |
| Per-Shard-Zwischenartefakte sind noch verfügbar. | Actions-Artefaktliste; eintägige Retention bereits abgelaufen. | 17/17 Shards laut Merge-Manifest, Einzelartefakte abgelaufen | NOT_FOUND | Shardgenaue Transportdiagnose ist nur noch über Manifest/Logs, nicht über die einzelnen Payloads möglich. |
| Der 8.-August-Lauf ersetzte das Hypergrowth-Board. | Workflow- und `gh-pages`-Historie: der Lauf scheiterte vor einem neuen Hypergrowth-Publish; nur Small-Cap lief weiter. | letztes Hypergrowth-Publish `25e7e2832f3500da73a93983d9d9480fa8d9b57a`; Board-Publish `f07560a9b03a3dc99502e016f9c121bc6665d852` | VERIFIED (Negativbefund) | Sonst wäre fälschlich ein älteres Vintage als aktuell eingefroren worden. |

## Daten- und Zwischenzählungen des reproduzierten Laufs

- Merge-Manifest: 20.586 Watchlistnamen, 16.521 adressierbar, 14.688 erfolgreich, 1.168 Full- und 13.520 Price-only-Antworten, 1.839 Fehlschläge, 3.488 Market-Cap-Skips, 577 bereits im anderen Kanal gehaltene Namen, 17/17 Shards, `partial=false`.
- Rohartefakt: 14.696 JSON-Dateien einschließlich Manifest; 113.133.386 Bytes unkomprimiert.
- Scoring-Lader: 14.654 Snapshots, 0 Parsefehler, 0 fehlende Ticker, 41 nicht mehr im damaligen Watchlist-Schnitt.
- SEC-Anreicherung: 112 Namen mit SEC-Key; bei 75 war die tiefe Serie in mindestens einer Achse wirksam.
- Ergebnis: 8.763 Branchenzeilen plus 97 Survival-Zeilen. Die Trackzählungen stehen unverändert in `production-equivalence.json`.

## Abgrenzung

`GQS-00@1.0.0` beweist die heutige Formel- und Produktionsgleichheit. Es beweist keinen historischen globalen Point-in-Time-Backtest. Die verfügbaren Yahoo-Snapshots sind current/latest, der vollständige Workflow-Rohinput ist nur temporär, und ein effekt-datiertes Entity-/Delisting-Ledger fehlt. Diese Lücke wird nicht durch Rückdatierung oder Interpolation kaschiert; sie ist Gegenstand der Foundation-Spezifikation.
