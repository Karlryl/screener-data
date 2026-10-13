# Tagesdifferenz

> **Auf einen Blick**
>
> Das Werkzeug vergleicht zwei gespeicherte Tagesläufe und erklärt beobachtete Eingangsänderungen, ohne Scores neu zu berechnen.
>
> * Der Standardlauf schreibt einen deutschen Bericht, Abgänge, Zugänge und einen klassifizierten Nachweis.
> * Die vollständige Änderungsliste entsteht nur auf ausdrücklichen Wunsch als Gzip-Datei.
> * Fehlende Belege bleiben als ungeklärte Ursachen sichtbar.

## Aufruf

Node.js mit Standardbibliothek genügt. Das Werkzeug lädt nichts aus dem Netz.
Alle Eingaben werden ausschließlich gelesen. Der Ausgabeordner ist verpflichtend
und muss außerhalb jedes Checkouts sowie außerhalb der Eingabeordner liegen.

```powershell
node scripts/tagesdifferenz.js `
  --before C:/job/20261009/snapshots `
  --after C:/job/20261010/snapshots `
  --repo C:/readonly/screener-data `
  --excluded-before C:/job/20261009/excluded.json `
  --excluded-after C:/job/20261010/excluded.json `
  --out C:/job/result
```

`--repo` liest beide Tage unter `board-history/` und die Handtabelle
`configs/financial-known-cases.json` über `git show` vom einmal aufgelösten lokalen
`origin/main`. Es verändert weder Referenzen noch Git-Konfiguration.
Bei einer Git-Besitzsperre wird abgebrochen. Die Alternative ist
`--boards C:/job/history --hand-table C:/job/financial-known-cases.json`.
Der History-Ordner enthält `YYYY-MM-DD/*.json` für beide Tage. Beide Tagesordner
müssen denselben Satz vollständiger Boards enthalten. Die Handtabelle gehört
zum selben festgehaltenen Quellstand.

Die optionalen Ausschlusslisten können auch als `_excluded.json` oder
`excluded.json` in den Board-Tagesordnern liegen. Ein falsches Datum oder eine
beschädigte ausdrücklich übergebene Datei führt zum Abbruch. Ohne Ausschlussliste
werden Ursachen nicht aus einem verschwundenen Snapshot erfunden.

Das Werkzeug liest außerdem `_manifest-size-exits.json` direkt aus jedem
Snapshot-Artefakt. Das Schema muss `size-exits/v2` sein, `known` ein Wahrheitswert,
`runDate` der Vergleichstag und `exits` eine Liste. Die Datei wird mit Prüfsumme
im Nachweis erfasst, aber nicht als Firmensnapshot gezählt. Bei vorhandenem
Manifest stammen Größenabgänge und deren Erfassungsstatus daraus. Die passende
`excluded.json` aus dem damaligen gh-pages-Deploy ergänzt Listingwechsel und
andere Ausschlüsse. Fehlt ein Manifest, bleibt die bisherige Auswertung der
Größenabgänge aus der Ausschlussliste möglich.

## Ergebnisse und Zählebene

| Datei | Inhalt |
|---|---|
| `tagesdifferenz-YYYY-MM-DD-YYYY-MM-DD.md` | Tagesabsatz, bis zu zehn auffällige historische Bewegungen und alle stillen Abgänge. |
| `abgaenge.csv` | Historienzeilen der Kürzel, die aus dem gesamten Hauptlistenuniversum verschwinden, einschließlich Belegen. |
| `zugaenge.csv` | Entsprechende neue Kürzel mit Belegen. |
| `nachweis.json` | Zählungen, Klassenhäufigkeiten, Eingangsprüfsummen, Quelldateien und gegebenenfalls der Git-Quellstand. |
| `aenderungen.csv.gz` | Sämtliche geänderten Historienzeilen, ausschließlich mit `--full-changes`. |

`historyExits`, `historyEntries` und die Ursachenbilanz zählen eindeutige Kürzel,
keine Firmen. `classCounts` und `changedRows` zählen dagegen Historienzeilen
einschließlich Board- und Kohortenwechseln. Positive Positionsdifferenzen bedeuten
eine schlechtere historische Position. Das sind keine angezeigten Kurzlistenränge.
Fehlende Felder bleiben von `null` und einer gemeldeten Null unterscheidbar.
CSV-Zellen enthalten dafür `{"absent":true}`, `null` beziehungsweise `0`;
ein tatsächlich leerer Text bleibt leer. Das gilt auch für Rang- und Scorefelder.
Die zusätzliche CSV-Spalte `reason` enthält den deutschen Mitgliedschaftsgrund;
bestehende Spaltennamen bleiben unverändert.

Die Klassen aus DL31 bleiben erhalten: `NEUES QUARTAL`, `HANDTABELLE`, `RÜCKHALT`,
`NUR KURS`, `NACHLADEN`, `UNVERÄNDERTE EINGABE`, `SNAPSHOT FEHLT`, `LISTINGWECHSEL`
und `BÖRSENWERTGRENZE`. Daneben stehen die Mitgliedschaftsgründe `AUSSCHLUSS`,
`LISTENWECHSEL` und `UNGEKLÄRT`. Eine Kursänderung beweist keine Ursache für eine
Scoreänderung. Aktuelle Handtabellen allein beweisen keinen früheren Einsatz.

P155 speichert auch frühere Größenabgänge in `sizeExits`. Bei ausdrücklich
bekannter oder unbekannter Erfassung werden diese gültigen Alteinträge akzeptiert, aber nicht
als neue Abgänge des Exporttages ausgegeben. Für die Größenklasse braucht es
einen zum Exporttag datierten Eintrag. Bei nicht unmittelbar aufeinanderfolgenden
Datenläufen kann deshalb ein zwischenzeitlicher Größenabgang ungeklärt bleiben.
Bei `known: false` beziehungsweise `sizeExitsKnown: false` erklären Größenabgänge
keinen heutigen Listenwechsel. Ohne einen anderen Beleg bleibt er `UNGEKLÄRT`
mit dem deutschen Hinweis auf die unbekannte Erfassung. Beschädigte Einträge
werden weiterhin abgewiesen.

Ein Zugang kann schon im vorherigen Snapshot-Artefakt stehen. Wenn dessen
`fetchedAt` den vorherigen Vergleichstag nennt und der Snapshot an beiden Tagen
vorliegt, erklärt `NACHLADEN` die erstmalige Ranglistenaufnahme nach dem Abruf.
Der genaue Aufnahmezeitpunkt oder eine frühere Abwesenheit vor dem Vergleich
wird daraus nicht behauptet. Ältere oder fehlende Abrufdaten genügen nicht.

Ausgaben enthalten keine Laufzeit oder aktuelle Uhrzeit. Bei identischen
Eingaben und derselben Node-/zlib-Version bleiben die Bytes einschließlich Gzip
identisch. Identische vorhandene Dateien werden belassen; andere Inhalte oder
verlinkte Ergebnisdateien führen vor dem ersten Schreiben zum Abbruch.
Für geänderte Eingaben oder Ausgabemodi ist ein neuer Jobordner zu verwenden.
Gegen einen gleichzeitig böswillig veränderten Dateibaum schützt dies nicht;
der Jobordner muss ausschließlich diesem Lauf gehören.

## Prüfungen

```powershell
$env:TEMP = 'C:/Users/Anwender/.codex/t/P167b'
$env:TMP = $env:TEMP
node --test tests/tagesdifferenz.test.js tests/yahoo-q4-known-cases.test.js tests/jsdoc-exports.test.js
node scripts/test-gate.js --mode=all
```

Der freigegebene Temp-Ordner muss vor dem Test existieren und beschreibbar sein.
Die Tests erstellen darin ausschließlich eigene Unterordner und räumen diese
wieder auf. Die synthetische Fixture enthält zehn Snapshots, zwei Mini-Boards
und eine Handtabelle sowie zwei Größenmanifeste. Ihre lokale `.gitignore` nimmt diese ausdrücklich vom
allgemeinen Ausschluss der Snapshot-Ordner aus.

Die integrierten Bruchtests verändern jeweils eine vollständig verankerte Zeile
in einer Modulkopie. Die lesenden Tests für `NUR KURS`, den neuen Snapshot als
Aufnahmegrund und die eingeschlossene Grenze von genau 20 Plätzen müssen gegen
die jeweilige Kopie mit Exitcode 1 scheitern. Die SHA256-Prüfsumme des echten Moduls wird
vorher und nachher verglichen. Schreibende Tests sind keine Bruchziele.

## Heartbeat-Anbindung

Der vorgeschlagene zusätzliche Heartbeat-Job lädt die beiden letzten planmäßigen
Tagesläufe mit erfolgreichem Scoring herunter. Ein erst danach gescheiterter
Wächter macht veröffentlichte Daten nicht unbrauchbar. Der Job liest genau die
zwei passenden Tagesordner der Historie sowie die Handtabelle aus einem
festgehaltenen Stand von origin/main. Ergebnisse werden außerhalb des
Checkouts berechnet und als eigenes Artefakt hochgeladen. Der Anwendungscode des
Screeners und die vorhandenen Heartbeat-Prüfungen bleiben unverändert.

Das bisherige Artefakt snapshots wird vor der Migration der Betriebsergebnisquelle
im Scoring gespeichert. Es ist deshalb kein vollständiges Abbild aller späteren
Recheneingaben. Die Größenmanifeste gehören zum Snapshot-Artefakt. Die datierten
Ausschlusslisten holt der Vorschlag aus dem passenden gh-pages-Deploy. Der
veröffentlichte Pipeline-Status muss Laufnummer, Versuch und Quellcommit bestätigen,
und der Deploy samt Exportzeit muss im erfolgreichen Scoring-Zeitfenster liegen.
Keine oder mehrere passende Veröffentlichungen führen zum Abbruch. Der Nachweis
enthält beide Git-Stände, die Deploy-Commits und die Prüfsummen der Ausschlusslisten.

Der genaue Workflow-Diff gehört zum Abnahmepaket P167b; er wird getrennt geprüft
und durch den Master übernommen. Dieses Paket verändert keine Workflow-Datei.
