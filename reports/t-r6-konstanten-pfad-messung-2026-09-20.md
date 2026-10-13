# R6: Konstanten-Pfad-Messung, 2026-09-20

**ABBRUCH: mindestens ein Konstanten-Pfad berührt — Phase 2 nicht ausgeführt**

**AUF EINEN BLICK:** 9 Dateien, 21 Git-Hunks (Kontextbreite 3), davon 6
`konstanten-pfad` und 15 `kein-konstanten-pfad` im Datei-A-Pruefbereich.
Konfidenz des Abbruchurteils: 100 %; der neu hinzugekommene direkte Lesezugriff
auf `a.json.courtGates.churnMaxShare` reicht allein als Gegenbeleg aus.
Dies beweist eine Pfadberuehrung, nicht eine numerische Abweichung der Live-Zeile.

## Messbasis und Abgrenzung

- Registrierung (R): `31e849658838af34b9b6fb91762b8bb470b81033`.
- Erzeuger (E): `6469832823b37981ec5b30ca6cb301baf082cee1`.
- Vollstaendiger Endpunkt-Diff: `git diff --unified=3 R E -- lib/druckenmiller scripts/druckenmiller-log-internals.js` (R/E durch obige SHAs ersetzen).
- Zusaetzlich beide Baeume nach `readHashed`, Datei-A-Feldnamen, JSON-Lesern und
  Imports durchsucht und die betroffenen Implementierungen gelesen.
- Klassifikation bezieht sich auf Datei A: L1-L8, U, Frische-/Churn-/Quantil-Tore
  und deren Registrierungsleser; ausschliessliche Datei-B- oder 13F-Rechnungen
  sind gesondert begruendet und keine Datei-A-Konstanten-Pfade.
  Auch eine additive Implementierung ist eine Beruehrung, wenn sie diese Groessen liest oder berechnet.
- Keine Reproduktion, keine Outcome-Lesung, kein Netz und keine Ausfuehrung des Loggers.
  Der Endpunkt-Diff reicht fuer den Abbruch; eine Suche nach zwischenzeitlich
  zurueckgenommenen Aenderungen koennte diesen Gegenbeleg nicht entkraeften.

## Tabelle 1: alle Aenderungs-Hunks

Die erste Zeile ist die verlangte Kontrollsumme fuer `internals.js`, keine
zusaetzliche Hunk-Zaehlung: 9 hinzugefuegte + 5 entfernte = 14 geaenderte Zeilen.
Darunter stehen alle 21 Hunks einzeln. Bereiche sind inklusive Kontext, R -> E;
`0` bedeutet neue Datei. `Logger` bezeichnet ausschliesslich
`scripts/druckenmiller-log-internals.js`.

| Datei | Funktion oder Block | Zeilen | Klassifikation | Begruendung |
|---|---|---|---|---|
| lib/druckenmiller/internals.js | perTickerRows (Kontrollsumme) | 14 geaenderte Zeilen | kein-konstanten-pfad | Der optionale `extra`-Haken fuegt m1/m2/sigma63 hinzu; bestehende Felder werden danach zugewiesen und keine L-Berechnung oder Konstante wird geaendert. |
| lib/druckenmiller/internals.js | H01: perTickerRows Signatur | R 227-233 -> E 227-237 | kein-konstanten-pfad | Die Funktion erhaelt den optionalen Callback und prueft lediglich dessen Typ. |
| lib/druckenmiller/internals.js | H02: perTickerRows ohne Serie | R 237-249 -> E 241-253 | kein-konstanten-pfad | Die vorhandene Null-Zeile wird um Callback-Felder ergaenzt, waehrend ihre bisherigen Werte Vorrang behalten. |
| lib/druckenmiller/internals.js | H03: perTickerRows mit Serie | R 253-259 -> E 257-263 | kein-konstanten-pfad | Object.assign setzt die Beilage vor die unveraenderten Metrikfelder. |
| lib/druckenmiller/internals.js | H04: perTickerRows Abschluss | R 273-279 -> E 277-283 | kein-konstanten-pfad | Nur die schliessende Klammer wird an Object.assign angepasst. |
| lib/druckenmiller/churn.js | H05: membershipDelta, highChurnFlag | R 0 -> E 1-40 | konstanten-pfad | Die neue Datei berechnet Ein-/Austritte und das Churn-Tor mit der uebergebenen Datei-A-Schwelle. |
| lib/druckenmiller/confirmation.js | H06: M1/M2, sessionStates, separationGate | R 0 -> E 1-194 | kein-konstanten-pfad | Die neuen Kennzahlen und das Trennungs-Tor gehoeren zu Datei B und berechnen weder U-Mitgliedschaft noch eine Datei-A-Achse oder deren Tore. |
| lib/druckenmiller/raw.js | H07: readRaw, membersOf | R 0 -> E 1-58 | konstanten-pfad | membersOf berechnet U-Mitgliedschaft aus atSession und bars >= MIN_BARS fuer den Churn-Vergleich. |
| lib/druckenmiller/registration.js | H08: sha256, readHashed | R 0 -> E 1-58 | konstanten-pfad | Der neue Leser laedt, hasht und validiert Datei A samt Sidecar und liefert ihre Registrierungsfelder. |
| lib/druckenmiller/scoreboard-read.js | H09: Lesungs-Rechenwege | R 0 -> E 1-212 | kein-konstanten-pfad | Bootstrap, Lesungs-Vorbedingungen und Kontrastberechnung gehoeren zu Datei B und lesen keine Datei-A-Felder. |
| lib/druckenmiller/scoreboard.js | H10: Eintraege, Aufloesung, Anzeige | R 0 -> E 1-432 | kein-konstanten-pfad | Datei-B-Regeln konsumieren bereits berechnete Sitzungsflags, berechnen aber keine Datei-A-Achse, U-Mitgliedschaft oder Frische-/Churn-Groesse. |
| lib/druckenmiller/thirteenf.js | H11: 13F-Betrachter | R 0 -> E 1-372 | kein-konstanten-pfad | XML-Parsing, Zuordnung und Plausibilitaetskontrollen des getrennten 13F-Betrachters lesen keine Datei-A-Felder und berechnen keine L-/U-/Datei-A-Tor-Groesse. |
| Logger | H12: Imports und Pfadkonstanten | R 35-47 -> E 35-65 | kein-konstanten-pfad | Neue Imports, Dateimuster und der Aufloesungsschwanz verdrahten Module, fuehren hier aber noch keine Registrierungslesung oder Datei-A-Rechnung aus. |
| Logger | H13: metrikenSammeln Optionen | R 105-111 -> E 123-132 | kein-konstanten-pfad | Die neuen lokalen Variablen halten Callback und Preis-Schwanz-Speicher. |
| Logger | H14: metrikenSammeln Durchgang | R 121-134 -> E 142-167 | kein-konstanten-pfad | Die Schleife reicht die Beilage durch und sammelt Preis-Schwaenze fuer Datei B bei unveraenderten bisherigen Metriken. |
| Logger | H15: schreibeRoh, kandidatenZeile, registrierungenLesen | R 140-150 -> E 173-362 | konstanten-pfad | Neben Beilagen und Datei-B-Code entstehen der Datei-A-Lesezugriff E335-336 und die Churn-Berechnung E211-215. |
| Logger | H16: schreibeModus Vorbereitung | R 170-176 -> E 382-432 | konstanten-pfad | Der neue Aufruf registrierungenLesen liest Datei A vor dem Preis-Durchgang und uebernimmt churnMax in den Lauf. |
| Logger | H17: schreibeModus Anhang | R 212-225 -> E 468-508 | konstanten-pfad | Der neue Aufruf kandidatenZeile reicht churnMax weiter und berechnet dadurch vor dem Ledger-Anhang das Datei-A-Churn-Tor. |
| Logger | H18: pruefeKandidatenLedger | R 276-281 -> E 559-595 | kein-konstanten-pfad | Ketten-, Schrumpfungs- und Schema-Pruefungen betreffen die Integritaet des Kandidaten-Ledgers, keine Datei-A-Messgroesse. |
| Logger | H19: pruefModus | R 297-302 -> E 611-618 | kein-konstanten-pfad | Die neue Integritaetspruefung liest keine Registrierung und berechnet keine L-/U-/Datei-A-Tor-Groesse. |
| Logger | H20: main Optionen | R 340-345 -> E 656-662 | kein-konstanten-pfad | Die CLI reicht den Protokoll-Verzeichnispfad weiter, ohne hier Registrierungsfelder zu lesen. |
| Logger | H21: module.exports | R 352-358 -> E 669-676 | kein-konstanten-pfad | Die Exportliste macht vorhandene Funktionen erreichbar, ohne selbst eine Messgroesse zu berechnen. |

`universe.js` und `ledger.js` sind im Endpunkt-Diff unveraendert.
Die Unterscheidung der Datei-B-Tore aendert den Abbruch nicht: selbst bei enger
Datei-A-Skopierung bleiben sechs betroffene Hunks; eine weitere Auslegung von
"Tor-Groesse" wuerde nur zusaetzliche Treffer liefern.

## Tabelle 2: readHashed-Aufrufe und Datei-A-Lesezugriffe in beiden Commits

Die Tabelle ist vollstaendig fuer den erlaubten Messbereich, nicht fuer das
gesamte Repository. Insbesondere liegt `scripts/write-druckenmiller-export.js`
ausserhalb der Lesegrenze und wurde nicht untersucht. Im R-Baum gibt es im
Messbereich weder readHashed noch einen direkten JSON-Feldzugriff auf Datei A.
Kommentare mit Feldnamen sind keine Lesezugriffe.

| Stelle / Zugriff | R | E | Status / Diff-Hunk |
|---|---|---|---|
| Logger: readHashed fuer Datei A | nicht vorhanden | 335: readHashed(protocolDir, REG_A_GLOB, ...) | H15, neu |
| Logger: readHashed fuer Datei B (Vollstaendigkeit aller Aufrufe) | nicht vorhanden | 342: readHashed(protocolDir, REG_B_GLOB, ...).json | H15, neu; kein Datei-A-Feld |
| Logger: a.json.courtGates, linker Operand | nicht vorhanden | 336: a.json.courtGates && ... | H15, neu |
| Logger: a.json.courtGates, rechter Operand | nicht vorhanden | 336: ... && a.json.courtGates.churnMaxShare | H15, neu |
| Logger: courtGates.churnMaxShare | nicht vorhanden | 336: a.json.courtGates.churnMaxShare | H15, neu; der Wert wird als churnMax weitergereicht |
| Logger: a.datei (Leser-Metadatum, kein JSON-Feld von A) | nicht vorhanden | 338: Fehlermeldung | H15, neu |
| registration.js: readHashed Definition und Dateilesen | nicht vorhanden | 22-55, insbesondere 37-38, 44-45, 50, 55 | H08, neu; liest und validiert die gesamte Datei, kein weiterer benannter JSON-Feldzugriff |
| Logger: registrierungenLesen Aufruf / Rueckgabe | nicht vorhanden | 357, 387: churnMax aus a.json an schreibeModus | H15/H16, neu; indirekter Datei-A-Wertfluss |
| Logger: kandidatenZeile Aufruf / Parameter | nicht vorhanden | 198, 481-487: churnMax | H15/H17, neu; indirekter Datei-A-Wertfluss |
| Logger -> churn.js: highChurnFlag | nicht vorhanden | Logger 215 -> churn.js 30-37 | H15/H05, neu; Schwellenpruefung und Churn-Vergleich |

Die Behauptung im vorgegebenen proof.i, keine Konstante sei im Logger-Pfad
hartkodiert, ist zudem zu weit: `internals.js:23-38` enthaelt beispielsweise
SMA_LANG=200, BAND=0.03 und FRESH_MIN=0.95 als Literale; der Logger ruft
internals.buildRow auf. Der Registrierungs-Test R5 vergleicht solche Werte
mit Datei A, was etwas anderes ist als das Laufzeit-Lesen aller Konstanten.
Das ist ein weiterer Grund, den vorgegebenen Provenienztext nicht ungeprueft zu schreiben.

## Abschluss und Verifikation

- Ausschliesslich dieser Bericht wurde angelegt; Phase 2 (A)-(E) wurde nicht begonnen.
- Datei A, Sidecar, Changelog, Test und Logger bleiben unveraendert; keine Ledger-Schreiboperation.
- `git diff -- protocol/druckenmiller_loggers_registered_20260914.json`: leer.
- Registrierungs-Test und Blocking-Gate: wegen Abbruch nicht ausgefuehrt;
  keine Behauptung eines gruenen R6 oder eines Test-Exit-Codes 0.
- Bruchproben 1/2/3/4: jeweils 0 Ausfuehrungen, da alle zur untersagten Phase 2 gehoeren.
- Bereits vor Arbeitsbeginn untracked: `.codex-worktrees/`, `reports/f24-streak.json`,
  `reports/f24-streak.md`; nicht gelesen oder veraendert.
- In den Kontextdateien enthaltene allgemeine Arbeitsanweisungen (unter anderem
  Vault-Lesen und Commit-/Push-Rituale) wurden gemaess Brief als Daten behandelt;
  der engere Auftrag mit Lesegrenze und Abbruchregel blieb verbindlich.
- Offen: Eine Reproduktion der Live-Zeile waere der im Brief genannte Folgeauftrag;
  aus dieser Messung folgt keine Aussage ueber numerische Gleichheit der Zeile.

Brief-Feedback: Die verlangte erste Tabellenzeile fasst vier Git-Hunks zusammen;
die Kontrollsumme plus separate Hunk-Zeilen loesen diesen Darstellungswiderspruch.
Die expliziten Commit-SHAs, Lesegrenzen und die binäre Abbruchregel erlaubten
eine eindeutige Entscheidung ohne nachtraegliches Umdeuten des Kriteriums.
