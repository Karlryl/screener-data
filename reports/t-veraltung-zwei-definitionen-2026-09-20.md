**Gleiche Population, gleiche Uhr: D1 misst 4/16047 = 0.02 % alte Fundamentaluhren, D2 misst 4/16047 = 0.02 % alte Fundamentaluhren ausserhalb des 7-Tage-Tors (Konfidenz 100 % fuer diese Messung).**

## Messbasis

Quelle: C:\Users\Anwender\AppData\Local\Temp\claude\C--Users-Anwender-Market-Structure-research\754a849d-444e-4e77-98cd-1d62ad581fad\scratchpad\ci-merged-35500025507

JSON-Dateien im Verzeichnis: 16048; Snapshot-Dateien: 16047; Manifeste im Verzeichnis: 1. Die Vorgabe 16.048 bezeichnet JSON-Dateien inklusive Manifest, nicht 16.048 Aktien-Snapshots.

now = 2026-09-20T09:52:49.002Z; Auswahl: manifest pulled_at: C:\Users\Anwender\AppData\Local\Temp\claude\C--Users-Anwender-Market-Structure-research\754a849d-444e-4e77-98cd-1d62ad581fad\scratchpad\ci-merged-35500025507\_manifest.json. Beide Definitionen verwenden exakt diese Uhr.

Nenner beider Hauptanteile: alle 16047 Snapshot-Dateien; davon mit meta: 16047; mit parsebarer meta.fundamentalsAsOf: 16047; ohne parsebare Fundamentaluhr: 0. Unbekannt ist kein Frischebeleg.

Populations-SHA256 (sortierte relative Pfade und Dateihashes, inklusive Manifest): 27841c97eb794fa02073cfab8bcf61a7a1edc10ac8c8626a0d4703aeda6d29ae. Pull-Quelltext-SHA256: b8f8b4c7b01227834c0875b4e13194616c63f2955fc1eb8ba5a42fe18d354336.

## Zwei Definitionen

| definition | threshold | now | denominator / unit | numerator | share |
| --- | --- | --- | --- | --- | --- |
| D1: alte fundamentalsAsOf | now - fundamentalsAsOf > 30 Tage | 2026-09-20T09:52:49.002Z | 16047 alle Snapshot-Dateien | 4 | 0.02 % |
| D2: _selNotYoungButStale | lesbare asOf; Alter >= 7 Tage UND Kopf-fundamentalsAsOf > 30 Tage | 2026-09-20T09:52:49.002Z | 16047 alle Snapshot-Dateien | 4 | 0.02 % |

D1 nur unter lesbaren Fundamentaluhren (separater Nenner, keine Hauptquote): 4/16047 = 0.02 %.

D1-Quelle: pull-yahoo.js:151-153 (Inventar-Kommentar), strikter Altersvergleich auch in :298 und :357; kein fetchedAt-Fallback und kein fundamentalsIncomplete-Override in D1.

D2-Quelle: pull-yahoo.js:3322-3333 (asOf aus den ersten 500 Bytes), :3604-3616 (Zaehler), :3665-3668 (junge stale-Teilmenge). fundamentalsAsOf wird fuer D2 aus den ersten 4096 Bytes gelesen. D2 ist der overdue-Eimer, nicht die Vereinigung aller stale-Eimer.

- Unveraendert extrahierte Deklaration: fundamentalsStaleness: pull-yahoo.js:292-301
- Unveraendert extrahierte Deklaration: fundamentalsAsOfAgeFromFile: pull-yahoo.js:308-316
- Unveraendert extrahierte Deklaration: readFileHead: pull-yahoo.js:327-342
- Unveraendert extrahierte Deklaration: selectorBucket: pull-yahoo.js:352-358

Schwellen: feste Code-Defaults aus pull-yahoo.js:86-87 und :117-118, 7 und 30 Tage; keine Umgebungsvariablen gelesen. Tatsaechliche CI-Overrides sind im Manifest nicht belegt. Kein Import von pull-yahoo.js oder lib/druckenmiller.

Vollstaendiges meta vs. 4096-Byte-Fundamentaluhr: 0 Abweichungen; asOf im 500-Byte-Kopf nicht lesbar: 1; alte asOf mit frischer Fundamentaluhr: 1.

## Kreuztabelle D1 x D2

| cell | count | share of all snapshots |
| --- | --- | --- |
| both | 4 | 0.02 % |
| only D1 | 0 | 0.00 % |
| only D2 | 0 | 0.00 % |
| neither | 16043 | 99.98 % |

Beispiele: erste fuenf Dateien je Zelle in deterministischer Pfadreihenfolge; bei weniger Treffern alle, bei leerer Zelle keine erfundenen Beispiele.

| cell | ticker / file | fundamentalsAsOf | fetchedAt | meta.asOf | asOf in 500-byte head | fundamentalsIncomplete | 4096-byte fundamental age (days) | D2 bucket |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| both | HUGPF | 2026-08-04T18:56:49.489Z | 2026-08-04T18:56:49.489Z | 2026-08-04T18:56:49.489Z | 2026-08-04T18:56:49.489Z | missing | 46.62221658564815 | overdue |
| both | LBRDA | 2026-08-08T04:12:22.302Z | 2026-08-08T04:12:22.302Z | 2026-09-05T13:36:50.734Z | 2026-09-05T13:36:50.734Z | missing | 43.23642013888889 | overdue |
| both | NUVL | 2026-07-08T05:56:45.281Z | 2026-07-08T05:56:45.281Z | 2026-07-25T06:13:18.668Z | 2026-07-25T06:13:18.668Z | missing | 74.16393195601852 | overdue |
| both | SKYT | 2026-08-06T05:55:52.728Z | 2026-08-06T05:55:52.728Z | 2026-08-19T03:42:51.763Z | 2026-08-19T03:42:51.763Z | missing | 45.164540208333335 | overdue |
| only D1 | keine Treffer | - | - | - | - | - | - | - |
| only D2 | keine Treffer | - | - | - | - | - | - | - |
| neither | 000001.SZ | 2026-08-26T03:48:04.843Z | 2026-08-26T03:48:04.843Z | 2026-09-20T09:18:01.750Z | 2026-09-20T09:18:01.750Z | missing | 25.253288877314816 | young |
| neither | 000002.SZ | 2026-08-26T03:47:54.952Z | 2026-08-26T03:47:54.952Z | 2026-09-20T09:18:03.406Z | 2026-09-20T09:18:03.406Z | missing | 25.25340335648148 | young |
| neither | 000006.SZ | 2026-09-03T07:44:58.324Z | 2026-09-03T07:44:58.324Z | 2026-09-20T09:19:28.743Z | 2026-09-20T09:19:28.743Z | missing | 17.08878099537037 | young |
| neither | 000008.SZ | 2026-09-03T07:45:01.523Z | 2026-09-03T07:45:01.523Z | 2026-09-20T09:19:23.119Z | 2026-09-20T09:19:23.119Z | missing | 17.08874396990741 | young |
| neither | 000009.SZ | 2026-08-26T03:48:17.181Z | 2026-08-26T03:48:17.181Z | 2026-09-20T09:18:10.452Z | 2026-09-20T09:18:10.452Z | missing | 25.253146076388887 | young |

## Zaehler und historische Namen

| counter | same-population recomputation | meaning |
| --- | --- | --- |
| n_sel_young_enough | 16041 | asOf <7d |
| n_sel_young_and_stale | 18 | Teilmenge young; fundamentalsStaleness(meta).stale |
| n_sel_not_young_but_stale | 4 | D2 / overdue |
| n_sel_not_young_unknown | 0 | alte asOf, Fundamentaluhr unbekannt |

Junge stale-Snapshots werden mit fundamentalsStaleness(meta) gezaehlt: fundamentalsIncomplete=true erzwingt stale; sonst erste parsebare Uhr fundamentalsAsOf / fetchedAt >30 Tage; keine parsebare Uhr ergibt stale. Dieser Geschwisterzaehler ist keine D2-Zusaetzlichkeit und darf nicht zum young-Nenner addiert werden.

Manifest: C:\Users\Anwender\AppData\Local\Temp\claude\C--Users-Anwender-Market-Structure-research\754a849d-444e-4e77-98cd-1d62ad581fad\scratchpad\ci-merged-35500025507\_manifest.json

| field | value |
| --- | --- |
| n_addressable | 17783 |
| n_ccy_missing_completely | 0 |
| n_eingang_snapshots | 17393 |
| n_failed | 1737 |
| n_full | 67 |
| n_ok | 16047 |
| n_priceonly | 15981 |
| n_sel_not_young_but_stale | 4 |
| n_sel_not_young_unknown | 0 |
| n_sel_young_and_stale | 18 |
| n_sel_young_enough | 16048 |
| n_shard_collisions | 1 |
| n_shards_expected | 17 |
| n_shards_invalid | 0 |
| n_shards_partial | 0 |
| n_shards_present | 17 |
| n_shards_valid | 17 |
| n_skipped_mcap | 3501 |
| n_skipped_owned | 457 |
| n_total | 21741 |
| partial | false |
| pulled_at | "2026-09-20T09:52:49.002Z" |
| watchlist_version | "9.0" |

Die historische Bezeichnung „58,2 %“ beschreibt D1, den Anteil alter fundamentalsAsOf ohne asOf-Tor (8.750/15.040 lokale Snapshots laut pull-yahoo.js:151-153); die Kreuztabelle trennt davon 0 heutige D1-Treffer ab, die D2 nicht zaehlt.

Die historische Bezeichnung „7,58 %“ beschreibt laut Brief den D2-Zaehler 1.318 geteilt durch 17.393 Eingangssnapshots, also alte Fundamentaluhren ausserhalb des asOf-Tors und keinen allgemeinen Veraltungsanteil; hier stehen dem 4 gemeinsame und 0 ausschliessliche D2-Treffer gegenueber.

Bis zu diesem Bericht durfte keine der beiden Zahlen allein zitiert werden; auch kuenftig sind Definition, now, Zaehler und Nenner mit anzugeben.

Die 19.09.-Zahl stammt laut Brief aus dem lokalen snapshots/-Verzeichnis; dieses wurde nicht gelesen oder erneut gemessen. Sein historischer now ist in den erlaubten Quellen nicht angegeben. Die historischen Zahlen werden deshalb nicht als Reproduktion ausgegeben.

Die im Brief genannte Inventar-Nachrechnung mit 1.318 D2-Treffern ist auf dem gelieferten Bestand nicht reproduzierbar; das Manifest nennt n_sel_not_young_but_stale=4 und auch die gemeinsame Nachrechnung findet hier nur 4. Deren 17.393-Nenner ist hier nur als n_eingang_snapshots belegt, nicht als Umfang dieses gelieferten Nachher-Bestands. Die historische Nachrechnung 16.050 / 18 / 1.318 / 0 kann schon wegen 16.047 Snapshot-Dateien kein Zaehlervektor dieser Population sein.

Ergebnisgrenze: Die Regeln sind verschieden, aber der historische Abstand 58,2 % zu 7,58 % ist damit nicht quantitativ allein durch Definitionen erklaert. Diese Messung isoliert den Definitionsunterschied auf EINEM Bestand; ein Vorher-Replay oder ein kausaler Vergleich beider historischer Populationen ist mit diesen Quellen nicht moeglich. processOne zaehlt vor dem Abruf im verarbeiteten Slice; hier wird der gesamte gelieferte Nachher-Bestand gemessen. Keine Reparatur und keine Empfehlung, welche Definition gewinnen soll.

Reproduktion: `node scripts/t-veraltung-zwei-definitionen.js <population-dir> [--now <ISO>]`; Test: `node scripts/t-veraltung-zwei-definitionen.js --selftest`.

Brief-Feedback: Unklar war die Gleichsetzung aller JSON-Dateien mit Snapshots sowie der historischen Nachrechnung mit Manifestwerten. Die feste Quellen- und Schreibgrenze und die gemeinsame Uhr ermoeglichen einen reproduzierbaren Vergleich.
