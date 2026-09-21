**Gesamturteil (vorläufig): drift 0 / sprung 0 / nicht entscheidbar 152 (Feldzeilen der Ticker-Schnittmenge). Zwei Stände können eine Drift-Richtung nicht belegen.**

# Signatur-Quotienten — 20.09.2026

AUF EINEN BLICK: Rein deskriptive Offline-Messung aller Wächter-Feldfunde in mindestens einem Lauf. Keine Verankerung, keine Baseline-Änderung und keine Aussage zur Ursache. Konfidenz 100 % für die reproduzierten Zähler dieser Eingaben; keine quantifizierte FX-/Quellenwahrscheinlichkeit.

Messbefund: 152 von 152 verglichenen Feldzeilen haben in allen Läufen exakt dieselben drei Signaturwerte; 4 Zeilen haben keinen Baseline-Eintrag und deshalb kein k. Ein Abstand zur Baseline ist keine zeitliche Veränderung zwischen diesen Läufen.

## Population und Reproduktion

Aufruf: `node scripts/t-kdrift-signatur.js <lauf1> <lauf2> [...]`; ohne Argumente werden die beiden vorgegebenen Stände verwendet. Argumente müssen chronologisch geordnet sein; die Reihenfolge ist eine Annahme des Aufrufers, keine aus Verzeichnisnamen verifizierte Zeitreihe. Einziger Schreibpfad: dieser Bericht (auch bei späteren Läufen bleibt der Dateiname gleich).

Die Vorgaben bezeichnen Lauf 35438100627 als roh (17 Shards) und Lauf 35500025507 als gemergt. Diese unterschiedliche Population ist kein k-Signal. Die Vorgabe nennt 30 Stunden Abstand; eine Kursbewegung von etwa 0,5 % wird dabei als plausibel angenommen, hier ohne externe Kursdaten nicht geprüft. Ein Beleg erfordert erst eine Reihe über mehrere Tage und einen unabhängigen FX-Abgleich.

Ticker-Union: 17395; Schnittmenge über alle 2 Läufe: 16044; nicht in allen Läufen: 1351; nur in genau einem Lauf: 1351. Ausschließlich die Schnittmenge geht in Vergleich und Gesamturteil ein.

| Lauf | Pfad | Ticker | Feldfunde | Manifeste (keine Ticker) | nur in diesem Lauf | Populations-SHA256 |
| --- | --- | --- | --- | --- | --- | --- |
| Lauf 1 | C:\Users\Anwender\AppData\Local\Temp\claude\C--Users-Anwender-Market-Structure-research\754a849d-444e-4e77-98cd-1d62ad581fad\scratchpad\ci-pop-35438100627 | 17392 | 166 | 0 | 1348 | 659b6e9734ab5b4831256d467998fb34b451e68ee71fd54cdafb7c7d7b775966 |
| Lauf 2 | C:\Users\Anwender\AppData\Local\Temp\claude\C--Users-Anwender-Market-Structure-research\754a849d-444e-4e77-98cd-1d62ad581fad\scratchpad\ci-merged-35500025507 | 16047 | 152 | 1 | 3 | 262e6f310878ba6729c72aacbcda6a31558176031816325ce8cc390d5dd19774 |

## Messregel und Grenzen

Extraktion der reinen Wächter-Funktionen wie in scripts/t-jahresausreisser-klassifikation.js, ohne Modulimport oder transitive Scoring-Imports. Feldfunde aus annual.<feld>; Periodenauflösung aus timeseries.<feld>Ends wie dort. Keine Behauptung vollständiger main()-Parität. Daten-JSON muss ein Snapshot oder ein anhand Name und Schema erkanntes _manifest.json sein; Manifeste gehen nur in den Dateihash ein. Duplikate, Links, unbekannte Metadaten und Parsefehler brechen den Lauf ab.

k wird für links / wert / rechts getrennt und ungerundet ausgewiesen. Spanne = max(k) − min(k) der definierten Komponenten. 0/0 bleibt n/a; Nullbasis mit Nichtnullwert macht die Zeile unentscheidbar. Exakt bedeutet vollständiger stabiler Signaturtreffer in der Baseline, nicht gerundete Nähe. Fehlender Ticker oder Feldfund ist n/a, niemals 0.

Mehrere Baseline-Einträge: Auswahl anhand des nächstliegenden Ausreisserfaktors zum ersten vorhandenen Fund (wie im Klassifikationsskript); Gleichstand lexikographisch. Dieser Eintrag bleibt über ALLE Läufe fest. Die gewählte Signatur und Kandidatenzahl stehen unten. Die Baseline enthält keinen Jahresindex: gleiche Indexposition ist ein Proxy, keine gesicherte Jahresidentität; Rollovers können daher wie Quellenänderungen aussehen.

Schwelle: |delta_k| > 0.01 je aufeinanderfolgenden Lauf und je definierter Komponente ergibt sprung; ebenso ein Vorzeichenwechsel der Schritte einer Komponente (numerisches Rauschen bis 1e-10 ignoriert). Die absolute Schwelle entspricht bei k nahe 1 ungefähr 1 %: bewusst doppelt so groß wie die im Brief genannten 0,5 %, eine transparente heuristische Trennlinie, keine validierte FX-Grenze (Konfidenz 60 % für ihre Eignung). Sie wird nicht an die Messwerte angepasst und ist nicht zeitnormalisiert; bei längeren Abständen nur eingeschränkt vergleichbar.

drift verlangt mindestens drei vollständige Stände, jeden Schritt ungleich null, gleiches Vorzeichen in allen definierten Komponenten, |delta_k| <= 0.01 und je Lauf Komponentenspanne <= 1e-10. Konstante Reihen, uneinheitliche Komponenten oder fehlende Beobachtungen bleiben unentscheidbar. Der vorgegebene Klassenname „nicht entscheidbar mit 2 Ständen“ bleibt aus Formatgründen auch bei mehr als zwei unzureichenden Ständen bestehen.

Zwei Stände können eine Drift-Richtung nicht belegen. Ein großer Schritt kann bereits mit zwei Ständen als sprung markiert werden; kleine Schritte belegen noch keine drift. Auch monotone k-Werte beweisen keine FX-Ursache, und Sprünge beweisen keinen Quellenwechsel. Wiederholte CI-Snapshots können denselben alten Abruf enthalten und sind dann keine unabhängigen Aktualisierungen. Keine Empfehlung zu Weg C.

## Vergleich der Feldzeilen in der Schnittmenge

Je k- und delta_k-Zelle: links / wert / rechts. Delta-Zellen stehen für aufeinanderfolgende Läufe, nicht nur für Endpunkt minus Startpunkt. Exakt-Spalte folgt der Laufreihenfolge.

| ticker | feld | index | k(Lauf 1) | k(Lauf 2) | delta_k(1→2) | exakt? | Urteil |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 000301.SZ | annualOpInc | 1 | n/a | n/a | n/a | n/a / n/a | nicht entscheidbar mit 2 Ständen |
| 000815.SZ | annualNetIncome | 1 | 1.0052403351378223 / 1.0052403351378223 / 1.0052403351378223 | 1.0052403351378223 / 1.0052403351378223 / 1.0052403351378223 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 001450.KS | annualOpInc | 1 | 9.065441143085614 / 9.065441143085616 / 9.065441143085614 | 9.065441143085614 / 9.065441143085616 / 9.065441143085614 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 001450.KS | annualRev | 1 | 1.0424722164540012 / 1.0424722164540012 / 1.042472216454001 | 1.0424722164540012 / 1.0424722164540012 / 1.042472216454001 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 002446.SZ | annualNetIncome | 1 | 1.005240335137822 / 1.0052403351378223 / 1.005240335137822 | 1.005240335137822 / 1.0052403351378223 / 1.005240335137822 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 002446.SZ | annualOpInc | 1 | 1.0052403351378223 / 1.005240335137822 / 1.005240335137822 | 1.0052403351378223 / 1.005240335137822 / 1.005240335137822 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 002583.SZ | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 002759.SZ | annualNetIncome | 1 | 1.005240335137822 / 1.0052403351378223 / 1.005240335137822 | 1.005240335137822 / 1.0052403351378223 / 1.005240335137822 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 002759.SZ | annualOpInc | 1 | 1.005240335137822 / 1.005240335137822 / 1.005240335137822 | 1.005240335137822 / 1.005240335137822 / 1.005240335137822 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 097230.KS | annualOpInc | 2 | 1.0531640116844736 / 1.0531640116844736 / 1.0531640116844736 | 1.0531640116844736 / 1.0531640116844736 / 1.0531640116844736 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 1BR1.DE | annualNetIncome | 2 | 1.0041672099385661 / 1.0041672099385661 / 1.0041672099385661 | 1.0041672099385661 / 1.0041672099385661 / 1.0041672099385661 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 1BTDR.MI | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 1CORZ.MI | annualOpInc | 3 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 1CPNG.MI | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 1CYTH.MI | annualOpInc | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 1INTC.MI | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 1SINC.MI | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 1SMTC.MI | annualOpInc | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 1STZ.MI | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 1TUB.MI | annualRev | 1 | 1.0068684305437712 / 1.0068684305437712 / n/a | 1.0068684305437712 / 1.0068684305437712 / n/a | 0 / 0 / n/a | nein / nein | nicht entscheidbar mit 2 Ständen |
| 1VIV.MI | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 2007.HK | annualOpInc | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 2050.SR | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 2160.T | annualOpInc | 2 | 1.0285770206316207 / 1.0285770206316205 / 1.0285770206316207 | 1.0285770206316207 / 1.0285770206316205 / 1.0285770206316207 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 300377.SZ | annualOpInc | 1 | 1.0052403351378223 / 1.0052403351378223 / 1.0052403351378223 | 1.0052403351378223 / 1.0052403351378223 / 1.0052403351378223 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 4005.T | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 4335.HK | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 600094.SS | annualNetIncome | 1 | 1.0052403351378223 / 1.0052403351378223 / 1.005240335137822 | 1.0052403351378223 / 1.0052403351378223 / 1.005240335137822 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 600166.SS | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 600166.SS | annualOpInc | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 600310.SS | annualOpInc | 1 | 1.005240335137822 / 1.005240335137822 / 1.005240335137822 | 1.005240335137822 / 1.005240335137822 / 1.005240335137822 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 600590.SS | annualNetIncome | 1 | 1.0052403351378223 / 1.005240335137822 / 1.0052403351378223 | 1.0052403351378223 / 1.005240335137822 / 1.0052403351378223 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 600973.SS | annualOpInc | 1 | 1.005240335137822 / 1.005240335137822 / 1.005240335137822 | 1.005240335137822 / 1.005240335137822 / 1.005240335137822 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 600975.SS | annualNetIncome | 2 | 1.0052403351378223 / 1.005240335137822 / 1.0052403351378223 | 1.0052403351378223 / 1.005240335137822 / 1.0052403351378223 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 600975.SS | annualOpInc | 2 | 1.005240335137822 / 1.005240335137822 / 1.0052403351378223 | 1.005240335137822 / 1.005240335137822 / 1.0052403351378223 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 601068.SS | annualNetIncome | 2 | 1.0043736189602213 / 1.0043736189602213 / 1.0043736189602213 | 1.0043736189602213 / 1.0043736189602213 / 1.0043736189602213 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 601068.SS | annualOpInc | 2 | 1.0043736189602213 / 1.0043736189602213 / 1.0043736189602213 | 1.0043736189602213 / 1.0043736189602213 / 1.0043736189602213 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 601606.SS | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 601606.SS | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| 601718.SS | annualNetIncome | 1 | 1.0052403351378223 / 1.0052403351378223 / 1.0052403351378223 | 1.0052403351378223 / 1.0052403351378223 / 1.0052403351378223 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 601718.SS | annualOpInc | 1 | 1.0052403351378223 / 1.005240335137822 / 1.005240335137822 | 1.0052403351378223 / 1.005240335137822 / 1.005240335137822 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 8795.T | annualOpInc | 2 | 0.2961392266722547 / 0.29613922667225473 / 0.29613922667225473 | 0.2961392266722547 / 0.29613922667225473 / 0.29613922667225473 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| 8795.T | annualRev | 2 | 1.0252902468630436 / 1.0252902468630434 / 1.0252902468630436 | 1.0252902468630436 / 1.0252902468630434 / 1.0252902468630436 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| AAP | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| AFK.OL | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| AKBM.OL | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| ALPA3.SA | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| ASTERDM.BO | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| ASTERDM.NS | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| BBUC.TO | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| BBUC | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| BTDR | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| BVS.AX | annualNetIncome | 2 | 1.0218124421770873 / 1.0218124421770873 / 1.0218124421770873 | 1.0218124421770873 / 1.0218124421770873 / 1.0218124421770873 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| CB1A.DE | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CGD.DE | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CMHC.SW | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CMHC.SW | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CMOPF | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CMOPF | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CNX | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| COPN.VI | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| COPN.VI | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CORZ | annualOpInc | 3 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CPNG | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CREDIA.AT | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CRSP | annualRev | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CUBEINVIT.BO | annualNetIncome | 2 | 1.0092371874115837 / 1.0092371874115837 / 1.0092371874115837 | 1.0092371874115837 / 1.0092371874115837 / 1.0092371874115837 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| CWAN | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| CXO.AX | annualNetIncome | 1 | 1.0215054098290346 / 1.0215054098290346 / 1.0215054098290346 | 1.0215054098290346 / 1.0215054098290346 / 1.0215054098290346 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| DIGIS.MC | annualNetIncome | 1 | 0.9910426644744167 / 0.9910426644744166 / 0.9910426644744166 | 0.9910426644744167 / 0.9910426644744166 / 0.9910426644744166 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| DIGIS.MC | annualOpInc | 1 | 0.9910426644744166 / 0.9910426644744166 / 0.9910426644744164 | 0.9910426644744166 / 0.9910426644744166 / 0.9910426644744164 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| DK | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| ENTOF | annualNetIncome | 2 | 1.001623658976908 / 1.001623658976908 / 1.0016236589769079 | 1.001623658976908 / 1.001623658976908 / 1.0016236589769079 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| ENTRA.OL | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| FG | annualNetIncome | 1 | n/a / 1 / 1 | n/a / 1 / 1 | n/a / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| FLR | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| FMCC | annualNetIncome | 2 | 1 / 1 / n/a | 1 / 1 / n/a | 0 / 0 / n/a | ja / ja | nicht entscheidbar mit 2 Ständen |
| GCP.L | annualNetIncome | 2 | n/a / 1.0006230152103786 / 1.0006230152103786 | n/a / 1.0006230152103786 / 1.0006230152103786 | n/a / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| GNIIF | annualOpInc | 2 | 1.0289322879316665 / 1.0289322879316665 / 1.0289322879316665 | 1.0289322879316665 / 1.0289322879316665 / 1.0289322879316665 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| GNK | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| H15.SI | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| HMMC.TO | annualRev | 1 | n/a / 1 / 1 | n/a / 1 / 1 | n/a / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| HMMCF | annualRev | 1 | n/a / 1 / 1 | n/a / 1 / 1 | n/a / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| INL.DE | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| INTC.SW | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| INTC.VI | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| INTC | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| INTL.WA | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| INVES.IS | annualRev | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| KINV-A.ST | annualOpInc | 2 | 0.9966587100759894 / 0.9966587100759893 / n/a | 0.9966587100759894 / 0.9966587100759893 / n/a | 0 / 0 / n/a | nein / nein | nicht entscheidbar mit 2 Ständen |
| KINV-A.ST | annualRev | 2 | 0.9966587100759892 / 0.9966587100759892 / n/a | 0.9966587100759892 / 0.9966587100759892 / n/a | 0 / 0 / n/a | nein / nein | nicht entscheidbar mit 2 Ständen |
| KINV-B.ST | annualOpInc | 2 | 0.985758056525362 / 0.9857580565253619 / n/a | 0.985758056525362 / 0.9857580565253619 / n/a | 0 / 0 / n/a | nein / nein | nicht entscheidbar mit 2 Ständen |
| KINV-B.ST | annualRev | 2 | 0.9857580565253617 / 0.9857580565253619 / n/a | 0.9857580565253617 / 0.9857580565253619 / n/a | 0 / 0 / n/a | nein / nein | nicht entscheidbar mit 2 Ständen |
| KYN | annualOpInc | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| KYN | annualRev | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| LAR.TO | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| LAR | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| LB | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| LMN.V | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| LUMN | annualOpInc | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| MDV.WA | annualNetIncome | 1 | 1.002556920383763 / 1.0025569203837632 / 1.002556920383763 | 1.002556920383763 / 1.0025569203837632 / 1.002556920383763 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| MFSL.BO | annualOpInc | 1 | 1.0092371874115835 / 1.0092371874115835 / 1.0092371874115837 | 1.0092371874115835 / 1.0092371874115835 / 1.0092371874115837 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| MFSL.BO | annualRev | 1 | 1.0092371874115835 / 1.0092371874115837 / 1.0092371874115835 | 1.0092371874115835 / 1.0092371874115837 / 1.0092371874115835 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| MFSL.NS | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| MFSL.NS | annualRev | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NATU3.SA | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NEOG | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NEOG | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NHP | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NMZ | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NMZ | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NMZ | annualRev | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NVG | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NVG | annualOpInc | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NVG | annualRev | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| NVST | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| OCI.AS | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| PLGO | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| PPT.AX | annualNetIncome | 2 | 1.0105752020369994 / 1.0105752020369994 / 1.0105752020369994 | 1.0105752020369994 / 1.0105752020369994 / 1.0105752020369994 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| PRSU | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| SESG.PA | annualNetIncome | 2 | 1.0041672099385663 / 1.0041672099385661 / 1.0041672099385661 | 1.0041672099385663 / 1.0041672099385661 / 1.0041672099385661 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| SFNXF | annualNetIncome | 1 | n/a | n/a | n/a | n/a / n/a | nicht entscheidbar mit 2 Ständen |
| SGBAF | annualNetIncome | 2 | 1.0041672099385663 / 1.0041672099385661 / 1.0041672099385661 | 1.0041672099385663 / 1.0041672099385661 / 1.0041672099385661 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| SGM.AX | annualOpInc | 2 | 1.0206393609083744 / 1.0206393609083744 / 1.0206393609083744 | 1.0206393609083744 / 1.0206393609083744 / 1.0206393609083744 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| SINCH.ST | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| SMSAAM.SN | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| SMTC | annualOpInc | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| SOMMF | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| SPB | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| STZ.VI | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| STZ | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| TABCF | annualNetIncome | 2 | 1.0206393609083744 / 1.0206393609083744 / 1.0206393609083744 | 1.0206393609083744 / 1.0206393609083744 / 1.0206393609083744 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| TAH.AX | annualNetIncome | 2 | 1.0206393609083744 / 1.0206393609083744 / 1.0206393609083744 | 1.0206393609083744 / 1.0206393609083744 / 1.0206393609083744 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| TDHOF | annualOpInc | 2 | 0.2961392266722547 / 0.29613922667225473 / 0.29613922667225473 | 0.2961392266722547 / 0.29613922667225473 / 0.29613922667225473 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| TDHOF | annualRev | 2 | 1.0252902468630436 / 1.0252902468630434 / 1.0252902468630436 | 1.0252902468630436 / 1.0252902468630434 / 1.0252902468630436 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| TDS | annualNetIncome | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| TKFEN.IS | annualOpInc | 2 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| TSRYF | annualOpInc | 1 | n/a | n/a | n/a | n/a / n/a | nicht entscheidbar mit 2 Ständen |
| TUB.BR | annualRev | 1 | 1 / 1 / n/a | 1 / 1 / n/a | 0 / 0 / n/a | ja / ja | nicht entscheidbar mit 2 Ständen |
| TUBI.VI | annualRev | 1 | 1 / 1 / n/a | 1 / 1 / n/a | 0 / 0 / n/a | ja / ja | nicht entscheidbar mit 2 Ständen |
| TWE.AX | annualOpInc | 1 | n/a | n/a | n/a | n/a / n/a | nicht entscheidbar mit 2 Ständen |
| UNBLF | annualNetIncome | 2 | 1.0047630044205038 / 1.0047630044205038 / 1.0047630044205038 | 1.0047630044205038 / 1.0047630044205038 / 1.0047630044205038 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| URW.PA | annualNetIncome | 2 | 1.0047630044205038 / 1.0047630044205038 / 1.0047630044205038 | 1.0047630044205038 / 1.0047630044205038 / 1.0047630044205038 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| VIV.PA | annualNetIncome | 1 | 1.0068684305437714 / 1.0068684305437712 / 1.0068684305437712 | 1.0068684305437714 / 1.0068684305437712 / 1.0068684305437712 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| VIV.VI | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |
| VOGL.BO | annualNetIncome | 1 | 1.0092371874115837 / 1.0092371874115837 / 1.0092371874115837 | 1.0092371874115837 / 1.0092371874115837 / 1.0092371874115837 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| VOGL.BO | annualOpInc | 1 | 1.0092371874115837 / 1.0092371874115835 / 1.0092371874115837 | 1.0092371874115837 / 1.0092371874115835 / 1.0092371874115837 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| VOGL.NS | annualNetIncome | 1 | 1.0092371874115837 / 1.0092371874115837 / 1.0092371874115837 | 1.0092371874115837 / 1.0092371874115837 / 1.0092371874115837 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| VOGL.NS | annualOpInc | 1 | 1.0092371874115837 / 1.0092371874115835 / 1.0092371874115837 | 1.0092371874115837 / 1.0092371874115835 / 1.0092371874115837 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| VPLAY-A.ST | annualNetIncome | 2 | 0.9966587100759893 / 0.9966587100759893 / 0.996658710075989 | 0.9966587100759893 / 0.9966587100759893 / 0.996658710075989 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| VPLAY-A.ST | annualOpInc | 2 | 0.9966587100759892 / 0.9966587100759892 / 0.9966587100759893 | 0.9966587100759892 / 0.9966587100759892 / 0.9966587100759893 | 0 / 0 / 0 | nein / nein | nicht entscheidbar mit 2 Ständen |
| VVU.DE | annualNetIncome | 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | ja / ja | nicht entscheidbar mit 2 Ständen |

## Fester Baseline-Bezug und Komponentenspanne

| ticker | feld | index | Baseline-Signatur | Kandidaten | Spanne Lauf 1 | Spanne Lauf 2 | Fundstatus |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 000301.SZ | annualOpInc | 1 | kein Eintrag | 0 | n/a | n/a | Fund / Fund |
| 000815.SZ | annualNetIncome | 1 | 000815.SZ&#124;annualNetIncome&#124;werte:9867396.696321366&#124;-81227616.98389228&#124;-2631194.6290613865 | 1 | 0 | 0 | Fund / Fund |
| 001450.KS | annualOpInc | 1 | 001450.KS&#124;annualOpInc&#124;werte:4085611.0168801122&#124;145145887.4848816&#124;5430383.133459464 | 1 | 1.7763568394002505e-15 | 1.7763568394002505e-15 | Fund / Fund |
| 001450.KS | annualRev | 1 | 001450.KS&#124;annualRev&#124;werte:279644833.46202&#124;9934694557.486763&#124;371689468.409272 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| 002446.SZ | annualNetIncome | 1 | 002446.SZ&#124;annualNetIncome&#124;werte:10311793.399718395&#124;-110989551.0669367&#124;7759186.68946062 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| 002446.SZ | annualOpInc | 1 | 002446.SZ&#124;annualOpInc&#124;werte:10373743.797269838&#124;-112244404.5408278&#124;10819629.352018392 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| 002583.SZ | annualNetIncome | 1 | 002583.SZ&#124;annualNetIncome&#124;werte:-38364274.240275934&#124;-518551730.5870835&#124;-57717593.712587856 | 1 | 0 | 0 | Fund / Fund |
| 002759.SZ | annualNetIncome | 1 | 002759.SZ&#124;annualNetIncome&#124;werte:12170686.981668107&#124;-200030255.89915913&#124;5197431.624665658 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| 002759.SZ | annualOpInc | 1 | 002759.SZ&#124;annualOpInc&#124;werte:21342011.76616921&#124;-209441649.621875&#124;7658780.818812172 | 1 | 0 | 0 | Fund / Fund |
| 097230.KS | annualOpInc | 2 | 097230.KS&#124;annualOpInc&#124;werte:5077435.5856&#124;-76166434.7836&#124;4638446.05 | 1 | 0 | 0 | Fund / Fund |
| 1BR1.DE | annualNetIncome | 2 | 1BR1.DE&#124;annualNetIncome&#124;werte:168530251.74&#124;-1877924987.0700002&#124;205417858.14000002 | 1 | 0 | 0 | Fund / Fund |
| 1BTDR.MI | annualNetIncome | 1 | 1BTDR.MI&#124;annualNetIncome&#124;werte:65597000&#124;-599151000&#124;-56656000 | 1 | 0 | 0 | Fund / Fund |
| 1CORZ.MI | annualOpInc | 3 | 1CORZ.MI&#124;annualOpInc&#124;werte:8961000&#124;-2109553000&#124;131494000 | 1 | 0 | 0 | Fund / Fund |
| 1CPNG.MI | annualNetIncome | 2 | 1CPNG.MI&#124;annualNetIncome&#124;werte:154000000&#124;1360000000&#124;-92000000 | 1 | 0 | 0 | Fund / Fund |
| 1CYTH.MI | annualOpInc | 2 | 1CYTH.MI&#124;annualOpInc&#124;werte:460000000&#124;-9584000000&#124;95000000 | 1 | 0 | 0 | Fund / Fund |
| 1INTC.MI | annualNetIncome | 1 | 1INTC.MI&#124;annualNetIncome&#124;werte:-267000000&#124;-18756000000&#124;1689000000 | 1 | 0 | 0 | Fund / Fund |
| 1SINC.MI | annualNetIncome | 1 | 1SINC.MI&#124;annualNetIncome&#124;werte:22941478.7&#124;-677989414.3&#124;4440286.2 | 1 | 0 | 0 | Fund / Fund |
| 1SMTC.MI | annualOpInc | 2 | 1SMTC.MI&#124;annualOpInc&#124;werte:49934000&#124;-944322000&#124;92799000 | 1 | 0 | 0 | Fund / Fund |
| 1STZ.MI | annualNetIncome | 2 | 1STZ.MI&#124;annualNetIncome&#124;werte:-81400000&#124;1727400000&#124;-71000000 | 1 | 0 | 0 | Fund / Fund |
| 1TUB.MI | annualRev | 1 | 1TUB.MI&#124;annualRev&#124;werte:42779.511000000006&#124;93652443&#124;0 | 1 | 0 | 0 | Fund / Fund |
| 1VIV.MI | annualNetIncome | 1 | 1VIV.MI&#124;annualNetIncome&#124;werte:23258519.999999996&#124;-6982207703.999999&#124;470985029.99999994 | 2 | 0 | 0 | Fund / Fund |
| 2007.HK | annualOpInc | 2 | 2007.HK&#124;annualOpInc&#124;werte:-2633434968.1&#124;-24097313783.7&#124;958559614.9 | 1 | 0 | 0 | Fund / Fund |
| 2050.SR | annualNetIncome | 1 | 2050.SR&#124;annualNetIncome&#124;werte:232910374.0371&#124;2656616325.0153&#124;239495272.15424997 | 1 | 0 | 0 | Fund / Fund |
| 2160.T | annualOpInc | 2 | 2160.T&#124;annualOpInc&#124;werte:8800728.8948&#124;82287712.8156182&#124;8649691.5638886 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| 300377.SZ | annualOpInc | 1 | 300377.SZ&#124;annualOpInc&#124;werte:-1405229.869908907&#124;-71515270.28402407&#124;8595223.127583755 | 1 | 0 | 0 | Fund / Fund |
| 4005.T | annualNetIncome | 2 | 4005.T&#124;annualNetIncome&#124;werte:246874962.656&#124;-1994895043.008&#124;44697348.192 | 2 | 0 | 0 | Fund / Fund |
| 4335.HK | annualNetIncome | 1 | 4335.HK&#124;annualNetIncome&#124;werte:-267000000&#124;-18756000000&#124;1689000000 | 1 | 0 | 0 | Fund / Fund |
| 600094.SS | annualNetIncome | 1 | 600094.SS&#124;annualNetIncome&#124;werte:21248591.342083693&#124;-345953740.6292422&#124;32958845.363830097 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| 600166.SS | annualNetIncome | 2 | 600166.SS&#124;annualNetIncome&#124;werte:11985712.574054742&#124;135341434.63944775&#124;9935003.688474188 | 1 | 0 | 0 | Fund / Fund |
| 600166.SS | annualOpInc | 2 | 600166.SS&#124;annualOpInc&#124;werte:3230531.0409957045&#124;134673481.38684216&#124;14528971.361937525 | 1 | 0 | 0 | Fund / Fund |
| 600310.SS | annualOpInc | 1 | 600310.SS&#124;annualOpInc&#124;werte:-6741614.228046895&#124;73323061.16095003&#124;-934081.782175466 | 1 | 0 | 0 | Fund / Fund |
| 600590.SS | annualNetIncome | 1 | 600590.SS&#124;annualNetIncome&#124;werte:8965267.583881883&#124;-146767731.96277723&#124;8329548.548752891 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| 600973.SS | annualOpInc | 1 | 600973.SS&#124;annualOpInc&#124;werte:3462817.055928838&#124;-53093083.903985165&#124;5822652.200127648 | 1 | 0 | 0 | Fund / Fund |
| 600975.SS | annualNetIncome | 2 | 600975.SS&#124;annualNetIncome&#124;werte:5823172.666917703&#124;-178220779.29708824&#124;-11507512.470333636 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| 600975.SS | annualOpInc | 2 | 600975.SS&#124;annualOpInc&#124;werte:10243624.182274686&#124;-180669883.52220175&#124;-3890608.6087859008 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| 601068.SS | annualNetIncome | 2 | 601068.SS&#124;annualNetIncome&#124;werte:32759197.84808&#124;-393678980.13752&#124;16656496.25232 | 1 | 0 | 0 | Fund / Fund |
| 601068.SS | annualOpInc | 2 | 601068.SS&#124;annualOpInc&#124;werte:50175810.22168&#124;-436985011.33792&#124;44220629.2224 | 1 | 0 | 0 | Fund / Fund |
| 601606.SS | annualNetIncome | 1 | 601606.SS&#124;annualNetIncome&#124;werte:1242014.394117928&#124;-54059892.99297001&#124;3979745.5469456143 | 1 | 0 | 0 | Fund / Fund |
| 601606.SS | annualOpInc | 1 | 601606.SS&#124;annualOpInc&#124;werte:2051145.3995218494&#124;-59762445.03771995&#124;1906711.6949601797 | 1 | 0 | 0 | Fund / Fund |
| 601718.SS | annualNetIncome | 1 | 601718.SS&#124;annualNetIncome&#124;werte:-43581641.128932565&#124;-626185909.5555199&#124;27003597.165528394 | 1 | 0 | 0 | Fund / Fund |
| 601718.SS | annualOpInc | 1 | 601718.SS&#124;annualOpInc&#124;werte:-41603297.75738904&#124;-621439845.8177376&#124;31913575.51222798 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| 8795.T | annualOpInc | 2 | 8795.T&#124;annualOpInc&#124;werte:353762635.379229&#124;12886262324.940367&#124;208984589.9559405 | 1 | 5.551115123125783e-17 | 5.551115123125783e-17 | Fund / Fund |
| 8795.T | annualRev | 2 | 8795.T&#124;annualRev&#124;werte:558293435.4599999&#124;20336561705.895&#124;329810762.96999997 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| AAP | annualOpInc | 1 | AAP&#124;annualOpInc&#124;werte:-43000000&#124;-713000000&#124;39000000 | 1 | 0 | 0 | Fund / Fund |
| AFK.OL | annualNetIncome | 1 | AFK.OL&#124;annualNetIncome&#124;werte:-5980286.256&#124;238997868.588&#124;3480313.01934 | 1 | 0 | 0 | Fund / Fund |
| AKBM.OL | annualNetIncome | 1 | AKBM.OL&#124;annualNetIncome&#124;werte:-22800000&#124;182600000&#124;-9000000 | 1 | 0 | 0 | Fund / Fund |
| ALPA3.SA | annualNetIncome | 2 | ALPA3.SA&#124;annualNetIncome&#124;werte:20743651.327800002&#124;-358593008.28400004&#124;23333846.1884 | 1 | 0 | 0 | Fund / Fund |
| ASTERDM.BO | annualNetIncome | 1 | ASTERDM.BO&#124;annualNetIncome&#124;werte:41092581.692099996&#124;569353631.6824499&#124;13686940.1792 | 2 | 0 | 0 | Fund / Fund |
| ASTERDM.NS | annualNetIncome | 1 | ASTERDM.NS&#124;annualNetIncome&#124;werte:40684679.544&#124;563701989.468&#124;13551077.888 | 1 | 0 | 0 | Fund / Fund |
| BBUC.TO | annualNetIncome | 2 | BBUC.TO&#124;annualNetIncome&#124;werte:15000000&#124;565000000&#124;63000000 | 1 | 0 | 0 | Fund / Fund |
| BBUC | annualNetIncome | 2 | BBUC&#124;annualNetIncome&#124;werte:15000000&#124;565000000&#124;63000000 | 1 | 0 | 0 | Fund / Fund |
| BTDR | annualNetIncome | 1 | BTDR&#124;annualNetIncome&#124;werte:65597000&#124;-599151000&#124;-56656000 | 1 | 0 | 0 | Fund / Fund |
| BVS.AX | annualNetIncome | 2 | BVS.AX&#124;annualNetIncome&#124;werte:6163190.52945&#124;-197116767.2649&#124;21013972.8591 | 1 | 0 | 0 | Fund / Fund |
| CB1A.DE | annualNetIncome | 2 | CB1A.DE&#124;annualNetIncome&#124;werte:-81400000&#124;1727400000&#124;-71000000 | 1 | 0 | 0 | Fund / Fund |
| CGD.DE | annualNetIncome | 2 | CGD.DE&#124;annualNetIncome&#124;werte:-90494000&#124;1720716000&#124;-142077000 | 1 | 0 | 0 | Fund / Fund |
| CMHC.SW | annualNetIncome | 1 | CMHC.SW&#124;annualNetIncome&#124;werte:-4180764.9488&#124;154387028.4696&#124;-12494786.1538 | 1 | 0 | 0 | Fund / Fund |
| CMHC.SW | annualOpInc | 1 | CMHC.SW&#124;annualOpInc&#124;werte:-3749710.4696&#124;172516809.0652&#124;-2172653.625 | 1 | 0 | 0 | Fund / Fund |
| CMOPF | annualNetIncome | 1 | CMOPF&#124;annualNetIncome&#124;werte:-4210526.2584&#124;155486052.2628&#124;-12583731.8859 | 1 | 0 | 0 | Fund / Fund |
| CMOPF | annualOpInc | 1 | CMOPF&#124;annualOpInc&#124;werte:-3776403.2628&#124;173744892.01860002&#124;-2188119.9375 | 1 | 0 | 0 | Fund / Fund |
| CNX | annualNetIncome | 2 | CNX&#124;annualNetIncome&#124;werte:-90494000&#124;1720716000&#124;-142077000 | 1 | 0 | 0 | Fund / Fund |
| COPN.VI | annualNetIncome | 1 | COPN.VI&#124;annualNetIncome&#124;werte:-4180764.9488&#124;154387028.4696&#124;-12494786.1538 | 1 | 0 | 0 | Fund / Fund |
| COPN.VI | annualOpInc | 1 | COPN.VI&#124;annualOpInc&#124;werte:-3749710.4696&#124;172516809.0652&#124;-2172653.625 | 1 | 0 | 0 | Fund / Fund |
| CORZ | annualOpInc | 3 | CORZ&#124;annualOpInc&#124;werte:8961000&#124;-2109553000&#124;131494000 | 1 | 0 | 0 | Fund / Fund |
| CPNG | annualNetIncome | 2 | CPNG&#124;annualNetIncome&#124;werte:154000000&#124;1360000000&#124;-92000000 | 1 | 0 | 0 | Fund / Fund |
| CREDIA.AT | annualNetIncome | 1 | CREDIA.AT&#124;annualNetIncome&#124;werte:17755863.9195&#124;-379809774.2607&#124;32209125.48 | 1 | 0 | 0 | Fund / Fund |
| CRSP | annualRev | 2 | CRSP&#124;annualRev&#124;werte:37314000&#124;371206000&#124;1198000 | 1 | 0 | 0 | Fund / Fund |
| CUBEINVIT.BO | annualNetIncome | 2 | CUBEINVIT.BO&#124;annualNetIncome&#124;werte:-3748446.0141600003&#124;-74052290.80144&#124;-2915003.43776 | 1 | 0 | 0 | Fund / Fund |
| CWAN | annualNetIncome | 1 | CWAN&#124;annualNetIncome&#124;werte:-38807000&#124;424378000&#124;-21627000 | 1 | 0 | 0 | Fund / Fund |
| CXO.AX | annualNetIncome | 1 | CXO.AX&#124;annualNetIncome&#124;werte:-16510066.017&#124;-146247252.7333&#124;7636876.921 | 1 | 0 | 0 | Fund / Fund |
| DIGIS.MC | annualNetIncome | 1 | DIGIS.MC&#124;annualNetIncome&#124;werte:4403244.68&#124;343800709.62&#124;-18887602.18 | 1 | 1.1102230246251565e-16 | 1.1102230246251565e-16 | Fund / Fund |
| DIGIS.MC | annualOpInc | 1 | DIGIS.MC&#124;annualOpInc&#124;werte:55851682.52&#124;485168038.82&#124;10660487.120000001 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| DK | annualNetIncome | 1 | DK&#124;annualNetIncome&#124;werte:-22800000&#124;-560400000&#124;19800000 | 1 | 0 | 0 | Fund / Fund |
| ENTOF | annualNetIncome | 2 | ENTOF&#124;annualNetIncome&#124;werte:1378257.4&#124;-577701890.1999999&#124;-67216553.2 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| ENTRA.OL | annualNetIncome | 2 | ENTRA.OL&#124;annualNetIncome&#124;werte:1386989.24&#124;-581361874.52&#124;-67642398.32000001 | 1 | 0 | 0 | Fund / Fund |
| FG | annualNetIncome | 1 | FG&#124;annualNetIncome&#124;werte:0&#124;622000000&#124;-58000000 | 1 | 0 | 0 | Fund / Fund |
| FLR | annualNetIncome | 1 | FLR&#124;annualNetIncome&#124;werte:-51000000&#124;2145000000&#124;139000000 | 1 | 0 | 0 | Fund / Fund |
| FMCC | annualNetIncome | 2 | FMCC&#124;annualNetIncome&#124;werte:5000000&#124;-166000000&#124;0 | 1 | 0 | 0 | Fund / Fund |
| GCP.L | annualNetIncome | 2 | GCP.L&#124;annualNetIncome&#124;werte:0&#124;84393732.808&#124;-982581.468 | 1 | 0 | 0 | Fund / Fund |
| GNIIF | annualOpInc | 2 | GNIIF&#124;annualOpInc&#124;werte:8797690.2&#124;82259300.7093&#124;8646705.0189 | 1 | 0 | 0 | Fund / Fund |
| GNK | annualOpInc | 1 | GNK&#124;annualOpInc&#124;werte:7470000&#124;87049000&#124;-5847000 | 1 | 0 | 0 | Fund / Fund |
| H15.SI | annualNetIncome | 2 | H15.SI&#124;annualNetIncome&#124;werte:21439093.292600002&#124;441924318.3315&#124;31645072.1225 | 1 | 0 | 0 | Fund / Fund |
| HMMC.TO | annualRev | 1 | HMMC.TO&#124;annualRev&#124;werte:0&#124;487159620&#124;5618960 | 1 | 0 | 0 | Fund / Fund |
| HMMCF | annualRev | 1 | HMMCF&#124;annualRev&#124;werte:0&#124;487159620&#124;5618960 | 1 | 0 | 0 | Fund / Fund |
| INL.DE | annualNetIncome | 1 | INL.DE&#124;annualNetIncome&#124;werte:-267000000&#124;-18756000000&#124;1689000000 | 1 | 0 | 0 | Fund / Fund |
| INTC.SW | annualNetIncome | 1 | INTC.SW&#124;annualNetIncome&#124;werte:-267000000&#124;-18756000000&#124;1689000000 | 1 | 0 | 0 | Fund / Fund |
| INTC.VI | annualNetIncome | 1 | INTC.VI&#124;annualNetIncome&#124;werte:-267000000&#124;-18756000000&#124;1689000000 | 1 | 0 | 0 | Fund / Fund |
| INTC | annualNetIncome | 1 | INTC&#124;annualNetIncome&#124;werte:-267000000&#124;-18756000000&#124;1689000000 | 1 | 0 | 0 | Fund / Fund |
| INTL.WA | annualNetIncome | 1 | INTL.WA&#124;annualNetIncome&#124;werte:-267000000&#124;-18756000000&#124;1689000000 | 1 | 0 | 0 | Fund / Fund |
| INVES.IS | annualRev | 1 | INVES.IS&#124;annualRev&#124;werte:1108589.427415512&#124;86828820.87533456&#124;3178750.9853304243 | 1 | 0 | 0 | Fund / Fund |
| KINV-A.ST | annualOpInc | 2 | KINV-A.ST&#124;annualOpInc&#124;werte:2296750.789494&#124;93467771.259408&#124;0 | 1 | 1.1102230246251565e-16 | 1.1102230246251565e-16 | Fund / Fund |
| KINV-A.ST | annualRev | 2 | KINV-A.ST&#124;annualRev&#124;werte:2405050.2&#124;97875086.4&#124;0 | 1 | 0 | 0 | Fund / Fund |
| KINV-B.ST | annualOpInc | 2 | KINV-B.ST&#124;annualOpInc&#124;werte:2318005.76210255&#124;94332756.2316516&#124;0 | 1 | 1.1102230246251565e-16 | 1.1102230246251565e-16 | Fund / Fund |
| KINV-B.ST | annualRev | 2 | KINV-B.ST&#124;annualRev&#124;werte:2427307.415&#124;98780858.28&#124;0 | 1 | 1.1102230246251565e-16 | 1.1102230246251565e-16 | Fund / Fund |
| KYN | annualOpInc | 2 | KYN&#124;annualOpInc&#124;werte:9578698.5&#124;176823233.72&#124;18377778.23 | 1 | 0 | 0 | Fund / Fund |
| KYN | annualRev | 2 | KYN&#124;annualRev&#124;werte:20850000&#124;384892000&#124;40003000 | 1 | 0 | 0 | Fund / Fund |
| LAR.TO | annualNetIncome | 2 | LAR.TO&#124;annualNetIncome&#124;werte:-15234000&#124;1288369000&#124;-93568000 | 1 | 0 | 0 | Fund / Fund |
| LAR | annualNetIncome | 2 | LAR&#124;annualNetIncome&#124;werte:-15234000&#124;1288369000&#124;-93568000 | 1 | 0 | 0 | Fund / Fund |
| LB | annualNetIncome | 2 | LB&#124;annualNetIncome&#124;werte:5110000&#124;63172000&#124;-6361000 | 1 | 0 | 0 | Fund / Fund |
| LMN.V | annualNetIncome | 2 | LMN.V&#124;annualNetIncome&#124;werte:-258909000&#124;-2825588000&#124;27402000 | 1 | 0 | 0 | Fund / Fund |
| LUMN | annualOpInc | 2 | LUMN&#124;annualOpInc&#124;werte:460000000&#124;-9584000000&#124;95000000 | 1 | 0 | 0 | Fund / Fund |
| MDV.WA | annualNetIncome | 1 | MDV.WA&#124;annualNetIncome&#124;werte:5852506.044&#124;248355657.85799998&#124;-15060806.838 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| MFSL.BO | annualOpInc | 1 | MFSL.BO&#124;annualOpInc&#124;werte:77576.68814918402&#124;224906349.31044692&#124;280926.029286504 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| MFSL.BO | annualRev | 1 | MFSL.BO&#124;annualRev&#124;werte:1686816.4416000003&#124;4890331578.831201&#124;6108415.5096 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| MFSL.NS | annualOpInc | 1 | MFSL.NS&#124;annualOpInc&#124;werte:77516.10673632001&#124;224730714.79022723&#124;280706.64771492 | 1 | 0 | 0 | Fund / Fund |
| MFSL.NS | annualRev | 1 | MFSL.NS&#124;annualRev&#124;werte:1685499.168&#124;4886512606.876&#124;6103645.308 | 1 | 0 | 0 | Fund / Fund |
| NATU3.SA | annualNetIncome | 2 | NATU3.SA&#124;annualNetIncome&#124;werte:147782984.39366&#124;1251204230.62712&#124;24036721.072979998 | 1 | 0 | 0 | Fund / Fund |
| NEOG | annualNetIncome | 1 | NEOG&#124;annualNetIncome&#124;werte:-7900000&#124;-1092000000&#124;-9400000 | 1 | 0 | 0 | Fund / Fund |
| NEOG | annualOpInc | 1 | NEOG&#124;annualOpInc&#124;werte:-21600000&#124;-1061000000&#124;58600000 | 1 | 0 | 0 | Fund / Fund |
| NHP | annualOpInc | 1 | NHP&#124;annualOpInc&#124;werte:3300000&#124;-123541000&#124;-4738000 | 1 | 0 | 0 | Fund / Fund |
| NMZ | annualNetIncome | 1 | NMZ&#124;annualNetIncome&#124;werte:26234679&#124;258785930&#124;7255561 | 1 | 0 | 0 | Fund / Fund |
| NMZ | annualOpInc | 1 | NMZ&#124;annualOpInc&#124;werte:23659798.95523&#124;226809613.99913&#124;7460507.597890001 | 1 | 0 | 0 | Fund / Fund |
| NMZ | annualRev | 1 | NMZ&#124;annualRev&#124;werte:27143069&#124;260201239&#124;8558867 | 1 | 0 | 0 | Fund / Fund |
| NVG | annualNetIncome | 1 | NVG&#124;annualNetIncome&#124;werte:57029572&#124;555649234&#124;27293130 | 1 | 0 | 0 | Fund / Fund |
| NVG | annualOpInc | 1 | NVG&#124;annualOpInc&#124;werte:57780453.2613&#124;465171402.82734&#124;33149342.39826 | 1 | 0 | 0 | Fund / Fund |
| NVG | annualRev | 1 | NVG&#124;annualRev&#124;werte:70801570&#124;570000126&#124;40619714 | 1 | 0 | 0 | Fund / Fund |
| NVST | annualNetIncome | 1 | NVST&#124;annualNetIncome&#124;werte:47000000&#124;-1118600000&#124;-100200000 | 1 | 0 | 0 | Fund / Fund |
| OCI.AS | annualNetIncome | 1 | OCI.AS&#124;annualNetIncome&#124;werte:183700000&#124;4978800000&#124;-392000000 | 1 | 0 | 0 | Fund / Fund |
| PLGO | annualNetIncome | 2 | PLGO&#124;annualNetIncome&#124;werte:113300000&#124;2132500000&#124;52600000 | 1 | 0 | 0 | Fund / Fund |
| PPT.AX | annualNetIncome | 2 | PPT.AX&#124;annualNetIncome&#124;werte:-41151099.192&#124;-333875413.032&#124;41716750.04 | 1 | 0 | 0 | Fund / Fund |
| PRSU | annualNetIncome | 1 | PRSU&#124;annualNetIncome&#124;werte:22668000&#124;368544000&#124;16017000 | 1 | 0 | 0 | Fund / Fund |
| SESG.PA | annualNetIncome | 2 | SESG.PA&#124;annualNetIncome&#124;werte:17291065.5&#124;-1043227618.5000001&#124;-39193081.800000004 | 2 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| SFNXF | annualNetIncome | 1 | kein Eintrag | 0 | n/a | n/a | Fund / Fund |
| SGBAF | annualNetIncome | 2 | SGBAF&#124;annualNetIncome&#124;werte:17291065.5&#124;-1043227618.5000001&#124;-39193081.800000004 | 2 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| SGM.AX | annualOpInc | 2 | SGM.AX&#124;annualOpInc&#124;werte:-2828254.24&#124;-83292087.368&#124;-7141341.956 | 1 | 0 | 0 | Fund / Fund |
| SINCH.ST | annualNetIncome | 1 | SINCH.ST&#124;annualNetIncome&#124;werte:22941478.7&#124;-677989414.3&#124;4440286.2 | 1 | 0 | 0 | Fund / Fund |
| SMSAAM.SN | annualNetIncome | 2 | SMSAAM.SN&#124;annualNetIncome&#124;werte:59185000&#124;500920000&#124;48176000 | 1 | 0 | 0 | Fund / Fund |
| SMTC | annualOpInc | 2 | SMTC&#124;annualOpInc&#124;werte:49934000&#124;-944322000&#124;92799000 | 1 | 0 | 0 | Fund / Fund |
| SOMMF | annualNetIncome | 2 | SOMMF&#124;annualNetIncome&#124;werte:246874962.656&#124;-1994895043.008&#124;44697348.192 | 2 | 0 | 0 | Fund / Fund |
| SPB | annualNetIncome | 2 | SPB&#124;annualNetIncome&#124;werte:124800000&#124;1801500000&#124;71600000 | 1 | 0 | 0 | Fund / Fund |
| STZ.VI | annualNetIncome | 2 | STZ.VI&#124;annualNetIncome&#124;werte:-81400000&#124;1727400000&#124;-71000000 | 1 | 0 | 0 | Fund / Fund |
| STZ | annualNetIncome | 2 | STZ&#124;annualNetIncome&#124;werte:-81400000&#124;1727400000&#124;-71000000 | 1 | 0 | 0 | Fund / Fund |
| TABCF | annualNetIncome | 2 | TABCF&#124;annualNetIncome&#124;werte:25878526.296&#124;-961394322.5320001&#124;47019726.74 | 1 | 0 | 0 | Fund / Fund |
| TAH.AX | annualNetIncome | 2 | TAH.AX&#124;annualNetIncome&#124;werte:25878526.296&#124;-961394322.5320001&#124;47019726.74 | 1 | 0 | 0 | Fund / Fund |
| TDHOF | annualOpInc | 2 | TDHOF&#124;annualOpInc&#124;werte:353762635.379229&#124;12886262324.940367&#124;208984589.9559405 | 1 | 5.551115123125783e-17 | 5.551115123125783e-17 | Fund / Fund |
| TDHOF | annualRev | 2 | TDHOF&#124;annualRev&#124;werte:558293435.4599999&#124;20336561705.895&#124;329810762.96999997 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| TDS | annualNetIncome | 2 | TDS&#124;annualNetIncome&#124;werte:-27705000&#124;-500009000&#124;62000000 | 1 | 0 | 0 | Fund / Fund |
| TKFEN.IS | annualOpInc | 2 | TKFEN.IS&#124;annualOpInc&#124;werte:-4361724.857412&#124;-107776503.208902&#124;5632075.20057 | 1 | 0 | 0 | Fund / Fund |
| TSRYF | annualOpInc | 1 | kein Eintrag | 0 | n/a | n/a | Fund / Fund |
| TUB.BR | annualRev | 1 | TUB.BR&#124;annualRev&#124;werte:42873.6982&#124;93858636.6&#124;0 | 1 | 0 | 0 | Fund / Fund |
| TUBI.VI | annualRev | 1 | TUBI.VI&#124;annualRev&#124;werte:42873.6982&#124;93858636.6&#124;0 | 1 | 0 | 0 | Fund / Fund |
| TWE.AX | annualOpInc | 1 | kein Eintrag | 0 | n/a | n/a | Fund / Fund |
| UNBLF | annualNetIncome | 2 | UNBLF&#124;annualNetIncome&#124;werte:169036878.60000002&#124;-1883570307.3000002&#124;206035374.60000002 | 1 | 0 | 0 | Fund / Fund |
| URW.PA | annualNetIncome | 2 | URW.PA&#124;annualNetIncome&#124;werte:169036878.60000002&#124;-1883570307.3000002&#124;206035374.60000002 | 1 | 0 | 0 | Fund / Fund |
| VIV.PA | annualNetIncome | 1 | VIV.PA&#124;annualNetIncome&#124;werte:23124060&#124;-6941842812.000001&#124;468262215.00000006 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| VIV.VI | annualNetIncome | 1 | VIV.VI&#124;annualNetIncome&#124;werte:23339946&#124;-7006651789.2&#124;472633906.5 | 1 | 0 | 0 | Fund / Fund |
| VOGL.BO | annualNetIncome | 1 | VOGL.BO&#124;annualNetIncome&#124;werte:5664682.08&#124;203508948.8&#124;-12317536.478400001 | 1 | 0 | 0 | Fund / Fund |
| VOGL.BO | annualOpInc | 1 | VOGL.BO&#124;annualOpInc&#124;werte:-18567569.040000003&#124;167737530.48000002&#124;-9102304.8904 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| VOGL.NS | annualNetIncome | 1 | VOGL.NS&#124;annualNetIncome&#124;werte:5664682.08&#124;203508948.8&#124;-12317536.478400001 | 1 | 0 | 0 | Fund / Fund |
| VOGL.NS | annualOpInc | 1 | VOGL.NS&#124;annualOpInc&#124;werte:-18567569.040000003&#124;167737530.48000002&#124;-9102304.8904 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| VPLAY-A.ST | annualNetIncome | 2 | VPLAY-A.ST&#124;annualNetIncome&#124;werte:11084144.4&#124;-1019218447.8000001&#124;33775270.2 | 1 | 2.220446049250313e-16 | 2.220446049250313e-16 | Fund / Fund |
| VPLAY-A.ST | annualOpInc | 2 | VPLAY-A.ST&#124;annualOpInc&#124;werte:-58348609.2&#124;1074534602.4&#124;43186336.2 | 1 | 1.1102230246251565e-16 | 1.1102230246251565e-16 | Fund / Fund |
| VVU.DE | annualNetIncome | 1 | VVU.DE&#124;annualNetIncome&#124;werte:23339946&#124;-7006651789.2&#124;472633906.5 | 1 | 0 | 0 | Fund / Fund |

## Ausgeschlossene Feldzeilen außerhalb der Schnittmenge (14)

Diese Zeilen zählen nicht im Gesamturteil. Wegen fehlender Ticker sind sie nicht entscheidbar; es wird kein delta_k berechnet.

| ticker | feld | index | Lauf 1 | Lauf 2 | Urteil |
| --- | --- | --- | --- | --- | --- |
| 1INDU.MI | annualRev | 2 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| CLCMF | annualNetIncome | 1 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| IDDTF | annualRev | 2 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| IDTVF | annualRev | 2 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| INDU-A.ST | annualOpInc | 2 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| INDU-A.ST | annualRev | 2 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| INDU-C.ST | annualOpInc | 2 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| INDU-C.ST | annualRev | 2 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| LMGIF | annualNetIncome | 2 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| OCINF | annualNetIncome | 1 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| PPTTF | annualNetIncome | 1 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| SMUPF | annualOpInc | 1 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| VETTF | annualNetIncome | 2 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |
| VVVNF | annualNetIncome | 1 | vorhanden | fehlt | nicht entscheidbar mit 2 Ständen |

## Unverändertheit und offene Punkte

Baseline SHA256 vorher: 0343988c93541855a6f0cf0550fc004a7b4e85b902c707e292599a49550dea77.
Wächter SHA256: 7ef49183a0668db8d7a88cdc2f8b5f67b9285701f999eaefa514651037af68af. Populationshash: sortierte relative Pfade plus SHA256 der Originalbytes.
Offen: dritter zeitlich späterer Stand, verifizierte Abruf-/Jahresidentität und unabhängiger FX-Abgleich. Alle Feldfunde werden gemessen, nicht nur die acht im Brief erwähnten (b)-Zeilen; eine Klassifikationsauswahl wird nicht als Tatsachenfilter nachgebaut.
Brief-Feedback: Die klaren Schreib- und Netzgrenzen erlauben eine vollständig lokale Messung. Die kausale Gleichsetzung monoton = FX bzw. Sprung = Quelle ist stärker als die Messung tragen kann.

Baseline SHA256 nachher: 0343988c93541855a6f0cf0550fc004a7b4e85b902c707e292599a49550dea77. Bytegleich; nicht ergänzt, nicht sortiert, nicht geschrieben.
