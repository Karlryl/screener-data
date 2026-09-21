# T178: Reihen-Zwillinge, CI-Lauf 35500025507

## Messbasis und Quellhashes

Populations-SHA256: `27841c97eb794fa02073cfab8bcf61a7a1edc10ac8c8626a0d4703aeda6d29ae` (Sollwert stimmt).

Wiederverwendete Quelle: `scripts/probe-emittenten-zwillinge.js`; SHA256: `acbb4c4575919283506d7571829a609fca0203c04e517cc35aa0b36b1f6fc5fe`.

Population: `C:\Users\Anwender\AppData\Local\Temp\claude\C--Users-Anwender-Market-Structure-research\754a849d-444e-4e77-98cd-1d62ad581fad\scratchpad\ci-merged-35500025507`. Snapshots: 16047/16048 (99.99 %) JSON-Dateien; Manifeste: 1/16048 (0.01 %) JSON-Dateien.

Hashmethode wie t-veraltung-zwei-definitionen.js: rekursiv nach Dateinamen sortiert, fuer jede JSON-Datei relativer Pfad mit /, NUL, SHA256 der Rohbytes, LF; SHA256 ueber diese Folge, inklusive Manifest. Keine benachbarten Dateien gelesen.

## Umsatzreihen und Belastbarkeit

Kanonisch bytegleich bedeutet JSON-serialisierte Zahlenwerte in gespeicherter Reihenfolge, ohne Rundung, ohne FX-Umrechnung, mit allen Lueckenpositionen und Nullen. Zahlen und {value,...} werden gleich entpackt; nicht-endliche/nicht-numerische Werte werden null. Keine Gleichheit der Rohdateien oder Kalenderjahre behauptet. Mindestens drei endliche Werte ungleich null sind erforderlich, negative Werte zaehlen mit.

Belastbar: 15601/16047 (97.22 %) Snapshots. Nicht belastbar: 446/16047 (2.78 %) Snapshots.

In Mehrfachgruppen: 5531/15601 (35.45 %) belastbare Snapshots. Gruppen: 2179/12249 (17.79 %) verschiedene belastbare Reihen.

## Identitaet und Klassen

CIK-Prueffeld: meta.cik; vorhanden/gueltig: 0/16047 (0.00 %) Snapshots. Der Bestands-Scan fand auch an anderen Feldpfaden keine CIK-/ISIN-/Issuer-Felder. Identitaetsnahe vorhandene Felder: meta.name, meta.exchangeName, meta.sharesOutstanding. Boerse und Aktienzahl allein beweisen keine Firmenidentitaet.

Wiederverwendung: wert-Entpackung und exakter Namensvergleich (namen.length === 1) aus probe-emittenten-zwillinge.js werden unveraendert per Quelltext-Extraktion ausgefuehrt. Leere Namen sind kein Identitaetsbeleg. (a) heisst gleiche CIK oder gleicher Name nach dieser Probe; der Namensteil bleibt eine Heuristik, kein Registerbeweis (Konfidenz fuer reale Firmenidentitaet nicht quantifizierbar).

Die umfassendere issuerKeyLoose-/Milan-Logik des Zensus ist nur aus src/scoring/score.js bzw. filter-snapshot-merge.js importiert; diese Quellen liegen ausserhalb der erlaubten Lesegrenze. Sie wurde weder geladen noch nachgebaut. Reihen-Gleichheit selbst wird nicht als Firmenidentitaet verwendet: das waere bei dieser Fragestellung zirkulaer.

(b) verlangt mindestens ein Paar mit verschiedenen gueltigen CIK, auch bei gleichem Namen. (c) gilt bei mindestens einem nicht entscheidbaren Paar und ohne (b)-Beleg. (a) verlangt ausschliesslich (a)-Paare. Diese Vorrangregel macht gemischte Gruppen disjunkt; Zeilenanteile sind Snapshot-Anteile, keine Firmenanteile.

| Klasse | Gruppen / alle Mehrfachgruppen | Zeilen / belastbare Snapshots | Paare / alle Paare in Mehrfachgruppen |
| --- | --- | --- | --- |
| a | 2155/2179 (98.90 %) | 5460/15601 (35.00 %) | 5212/5262 (99.05 %) |
| b | 0/2179 (0.00 %) | 0/15601 (0.00 %) | 0/5262 (0.00 %) |
| c | 24/2179 (1.10 %) | 71/15601 (0.46 %) | 50/5262 (0.95 %) |

Zusammenfassung: (a) 2155/2179 Gruppen, 5460/15601 (35.00 %) Zeilen; (b) 0/2179 Gruppen, 0/15601 (0.00 %) Zeilen; (c) 24/2179 Gruppen, 71/15601 (0.46 %) Zeilen.

## Alle Gruppen verschiedener Firmen (b)

Jahreszahl = endliche gleiche Werte / alle Reihenpositionen; erster Jahreswert = erste gespeicherte Position, nicht das aelteste Jahr. Aktienzahlen und Umsatzwerte sind Feldwerte, keine Anteilszaehler.

| Gruppe | Ticker | Name | Boerse | CIK | sharesOutstanding | Gleiche Jahre / Positionen | Erster Jahreswert |
| --- | --- | --- | --- | --- | --- | --- | --- |
Keine belegte Gruppe: 0/2179 (0.00 %) Mehrfachgruppen; fehlende CIK sind kein Beleg fuer Abwesenheit verschiedener Firmen.

## AVB/VMRK und offene Befundgrenze

AVB: 1/16047 (0.01 %) Snapshots; Name AvalonBay Communities Inc, CIK fehlt, Reihe [3040725000,2913757000,2767909000,2593446000]; Mehrfachgruppe a

VMRK: 0/16047 (0.00 %) Snapshots; fehlt in dieser Population (Dateiname und meta.ticker geprueft).

AVB/VMRK kann damit nicht als belegtes Paar in Tabelle (b) erscheinen. Ob dieser Fall ein Einzelfall oder eine Klasse verschiedener Firmen ist, bleibt mit dieser Population und ihren fehlenden Identifikatoren OFFEN. Die Gruppen-/Paarzaehlung ist reproduziert; eine gesicherte Emittentenanzahl ist daraus nicht ableitbar.

Welche Zeile falsche Zahlen aus dem Roh-Feed traegt, bleibt offen und wurde nicht untersucht. Nur Befund, kein Fix ohne Orchestrator-Entscheid; keine Dedup-Regel und keine Empfehlung fuer eine richtige Zeile.

Reproduktion: `node scripts/t178-reihen-zwillinge.js --population <POPULATION>`; Test: `node tests/t178-reihen-zwillinge.test.js`.

Brief-Feedback: Die feste Population samt Sollhash macht die Messung eindeutig reproduzierbar. Fehlende CIK und die ausserhalb der Lesegrenze implementierte Emittentenlogik begrenzen den Identitaetsnachweis.
