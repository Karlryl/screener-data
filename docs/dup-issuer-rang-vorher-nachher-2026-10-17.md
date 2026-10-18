> **Auf einen Blick**
>
> Auf dem Datenstand vom 17.10.2026 verlieren genau vier Listenzeilen ihren Rang: die Zweitnotierungen von AeroVironment (AVAV.SW, zweimal), GE Aerospace (GE.VI) und Galaxy Digital (1GLXY.MI). Sie bleiben mit allen Zahlen sichtbar und tragen den Grund `dupIssuer`.
> - AVAV.SW stand in Industrie, unprofitabel, auf Rang 38 (Kurzliste und Vollboard). Die Zeilen darunter rücken um genau einen Platz auf; AeroVironment selbst (AVAV) steht im Vollboard jetzt auf Rang 139 statt 140.
> - Sieben weitere markierte Zeilen bleiben unverändert, weil die Handtabelle ihre Hauptnotierung nicht entscheidet: Copel (CPLE3.SA, Versorger Rang 55), AXIA (AXIA3.SA, Qualität Versorger Rang 58, Vollboard 105), Amrize, Aeroméxico und Ascentage Pharma.
> - INPP.L und OCI.L stehen jetzt als geschlossene Fonds in der Klassentabelle. Sie hatten schon vorher keinen Rang (zu wenig belegte Achsen); Scores, Reihenfolge und alle anderen Zahlen bleiben gleich.

# Zweitnotierungen ohne Rang: vorher und nachher (Datenstand 17.10.2026)

## Messung

Grundlage ist die Nachstellung des Bewertungslaufs vom 17.10.2026 aus PR #10 (Code und Daten des Auslösecommits `df47be8`, Snapshot-Artefakt des Laufs 39036704898, Uhr fest auf 2026-10-17T14:47:00Z). Für die Exportskripte ist `df47be8` mit der Basis `b59a1d1` identisch; dazwischen kam nur `scripts/clock-shift-gate.js` hinzu. Die Bewertung selbst ändert sich durch diesen Zweig nicht, deshalb laufen in beiden Armen nur die Exportschritte des Bewertungsjobs neu, in derselben Kopie und mit denselben Eingaben: findash-Export, Ausschlussliste, Rule of 40, Filter-Universum, Bewertungs-Feed. Der einzige Unterschied sind fünf Dateien dieses Zweigs (`scripts/write-findash-export.js`, `scripts/write-rule40-export.js`, `lib/dup-issuer-shadow-table.js`, `configs/dup-issuer-shadow-table.json`, `configs/non-operating-classes.json`).

**Nachstellung geprüft:** Der Vorher-Arm trifft den veröffentlichten Export vom 17.10. (gh-pages) bei jedem Rang und jedem Score in allen Listen außerhalb des Small-Cap-Bestands; abweichend sind nur Laufkennung und Zeit. Der Small-Cap-Bestand ist wie in PR #10 nicht abrufbar und fehlt in beiden Armen gleich; der Dateicheck meldet deshalb in beiden Armen dieselbe eine Small-Cap-Zeile und sonst nichts.

**Was sich ändert:** Nur fünf Dateien unterscheiden sich inhaltlich (ohne Laufstempel): `industrials.json`, `full/industrials.json`, `full/financials.json`, `financials.json` und `filter/universum.json`. Kein Score, keine Reihenfolge und keine Listenmitgliedschaft ändert sich; Rule of 40, Überblick, Qualität und alle anderen Branchen bleiben gleich.

## Zeilen, die ihren Rang verlieren

| Liste | Kürzel | Rang vorher → nachher | Hauptnotierung (bleibt gerankt) | Beleg der Hauptnotierung |
|---|---|---:|---|---|
| Industrie, unprofitabel (Kurzliste) | AVAV.SW | 38 → ohne Rang | AVAV (nicht in der Kurzliste, Vollboard 140 → 139) | Handtabelle: `homeListingProposal` AVAV = `codeKeeps` |
| Industrie, unprofitabel (Vollboard) | AVAV.SW | 38 → ohne Rang | AVAV, 140 → 139 | wie oben |
| Industrie, profitabel (Vollboard) | GE.VI | 243 → ohne Rang | GE, 242 → 242 | Handtabelle: GE = GE |
| Finanzen, profitabel (Vollboard) | 1GLXY.MI | 74 → ohne Rang | GLXY, 75 → 74 | Handtabelle: GLXY = GLXY |

Jede dieser Zeilen behält Score, Lampen, Kennzahlen und die Markierung `dupIssuer`; neu ist nur `rank: null` mit `rankGrund: "dupIssuer"`.

## Verschobene Ränge

Jede andere Zeile unterhalb einer entrangten Zeile rückt um genau einen Platz auf; keine Zeile bewegt sich um mehr als einen Platz, keine Zeile oberhalb bewegt sich.

| Liste | verschobene Zeilen | Ränge vorher → nachher |
|---|---:|---|
| Industrie, unprofitabel (Kurzliste) | 58 | 39–96 → 38–95 |
| Industrie, unprofitabel (Vollboard) | 134 | 39–172 → 38–171 |
| Industrie, profitabel (Vollboard) | 1.666 | 244–1.909 → 243–1.908 |
| Finanzen, profitabel (Vollboard) | 219 | 75–293 → 74–292 |

Sichtbar in der Kurzliste Industrie, unprofitabel (alle 58): 688005.SS 39 → 38, ALX.AX 40 → 39, 030530.KQ 41 → 40, BETA 42 → 41, PLUG 43 → 42, CYRX 44 → 43, TH 45 → 44, 300506.SZ 46 → 45, 002272.SZ 47 → 46, LUNR 48 → 47, 603618.SS 49 → 48, AXON 50 → 49, 2432.HK 51 → 50, 605178.SS 52 → 51, 300593.SZ 53 → 52, 3928.HK 54 → 53, HAWK 55 → 54, 301070.SZ 56 → 55, 600500.SS 57 → 56, 2464.TW 58 → 57, 002097.SZ 59 → 58, 600115.SS 60 → 59, 002426.SZ 61 → 60, TPK.L 62 → 61, DCO 63 → 62, MMTC.BO 64 → 63, 454910.KS 65 → 64, 600698.SS 66 → 65, JBLU 67 → 66, 300328.SZ 68 → 67, SYM 69 → 68, 601700.SS 70 → 69, 600843.SS 71 → 70, 600343.SS 72 → 71, 301306.SZ 73 → 72, 601111.SS 74 → 73, FCEL 75 → 74, 301307.SZ 76 → 75, 4264.SR 77 → 76, 300648.SZ 78 → 77, 002141.SZ 79 → 78, IJ8.DE 80 → 79, 006400.KS 81 → 80, 002310.SZ 82 → 81, 301326.SZ 83 → 82, RKLB 84 → 83, 002176.SZ 85 → 84, 6871.HK 86 → 85, 603033.SS 87 → 86, 600153.SS 88 → 87, 000008.SZ 89 → 88, 603595.SS 90 → 89, 300900.SZ 91 → 90, 300842.SZ 92 → 91, XE 93 → 92, 600158.SS 94 → 93, 688559.SS 95 → 94, NWCL 96 → 95.

Das Filter-Universum übernimmt die Brett-Ränge: 2.022 Zeilen ändern `rk` genau wie ihre Vollboard-Zeile (2.019 um einen Platz, drei auf leer). Die drei Zweitnotierungen tragen dort zusätzlich den Grund `dupIssuer` neben dem schon vorhandenen `dup-issuer`; findash blendet `dup-issuer` im Filter ohnehin standardmäßig aus.

Die Datei `dup-issuer-rang-vorher-nachher-2026-10-17.csv` daneben enthält alle 2.085 geänderten Brettzeilen (4 entrangte, 2.077 verschobene, 4 Zeilen mit neuem Klassengrund).

## Markierte Zeilen, die unverändert bleiben

Die Hauptnotierung kommt allein aus der Handtabelle `configs/dup-issuer-shadow-table.json` (Feld `homeListingProposal`, Herkunft R11 mit Quelle und Zitat). Eine Zweitnotierung verliert ihren Rang nur, wenn diese Angabe auf den Ticker zeigt, den die Markierung `dupIssuer.of` nennt. Sonst entscheidet die Tabelle nichts, und die Zeile bleibt, wie sie war:

| Firma | markierte Zeile (Rang 17.10.) | zweite Zeile (Rang 17.10.) | warum unverändert |
|---|---|---|---|
| Copel | CPLE3.SA: Versorger profitabel 55 (Kurzliste und Vollboard) | ELPC: 56 | Vorschlag Hauptnotierung ist CPLE3.SA selbst (B3; ELPC ist ein ADS laut 20-F). Die Markierung zeigt aber auf ELPC. |
| AXIA Energia | AXIA3.SA: Vollboard Versorger 105, Qualität Versorger 58 | AXIA: 90 und 57 | Vorschlag ist AXIA3.SA selbst (90 %). |
| Amrize | AMRZ.SW: Vollboard Rohstoffe 425 | AMRZ: 424 | Vorschlag offen (null). |
| Grupo Aeroméxico | AERO.MX: Vollboard Industrie profitabel 1.449 → 1.448 (nur Verschiebung) | AERO: 1.448 → 1.447 | Vorschlag offen (null). |
| Ascentage Pharma | 6855.HK: Vollboard Gesundheit unprofitabel 267 | AAPG: 268 | Vorschlag offen (null). |
| Klöckner & Co | KCO.DE: nicht im Export | KCO.VI: Vollboard Rohstoffe 908 | Keine Doppelung am 17.10.; Vorschlag ist KCO.DE selbst. |

Bei Copel, AXIA und Klöckner wäre nach der Heimatbörse die unmarkierte Zeile (ELPC, AXIA, KCO.VI) die zweite. Sie zu entrangen, ginge über diesen Auftrag hinaus („höchstens die markierten Zweitnotierungen“); das braucht eine eigene Entscheidung.

GCP.DE (GE Aerospace) steht am 17.10. nur in der Ausschlussliste, nicht auf einem Brett; käme es zurück, verlöre es seinen Rang auf dieselbe Weise.

## INPP.L und OCI.L

Beide stehen jetzt in `configs/non-operating-classes.json` als `nichtOperativGeschlossenerFonds`, mit Primärquelle und wörtlichem Zitat: International Public Partnerships, Startseite des Emittenten („The Company is a closed ended FTSE 250 listed investment company which is incorporated in Guernsey“), Oakley Capital Investments, Jahresbericht 2025, Note 1 („is a closed-end investment company incorporated and registered“). Wirkung am 17.10.: Beide Zeilen der Finanzen-Kurzliste (Position 10 und 18) und des Vollboards tragen jetzt `rankGrundShadow: "nichtOperativGeschlossenerFonds"`. Einen Rang hatten sie schon vorher nicht (`rankGrund: "zuWenigBelegteAchsen"`, 3 von 7 Achsen); INPP.L zeigt weiter 7.614 % Umsatzwachstum. Die Klassentabelle ist ein Schatten: Sie aus der Liste zu nehmen, hieße die Tabelle scharf zu schalten, und das ist eine eigene Entscheidung.

## Rule of 40

Der Rule-of-40-Schreiber wies bisher jede Brettzeile mit einem Rang-Grund ab. Für `dupIssuer` gilt das nicht: Die drei Zweitnotierungen blieben sonst aus dem Kandidatenkreis, die gelernten Wachstumsgrenzen verschöben sich, und bei 30 anderen Firmen änderten sich Rule-of-40-Werte leicht (im ersten Nachher-Lauf ohne die Ausnahme: `r40` bei 11, `r40Ebitda` bei 12, `fcfShadow.r40Shadow` bei 13 Zeilen, in der Stichprobe je 0,1; Ränge unverändert). Mit der Ausnahme bleibt die Rule-of-40-Datei inhaltlich gleich.

## Grenzen

- Small-Cap-Bestand nicht nachgestellt (nicht abrufbar); dieselbe Regel greift dort beim nächsten Lauf.
- Überlebensliste (Runway-Rang) läuft nie durch das Gate; am 17.10. steht dort keine markierte Zeile.
- findash zeigt den neuen Grund noch nicht in Worten: Eine Zeile ohne Rang mit unbekanntem Grund erscheint als „Nicht rankbar: Grund nicht im Datenstand“. Ein Satz für `dupIssuer` in `web/src/lib/screener-rows.ts` (RANG_GRUENDE) wäre eine findash-Änderung.
- Wirkung im Betrieb: ab dem nächsten Tageslauf beim Export, ohne neues Abrufen.

## Nachweis

Gerechnet in einer Kopie der Nachstellung außerhalb des Repositorys (`C:/Users/Anwender/.codex/t/sddup/arm`); Vergleich der beiden Exportbäume Liste für Liste, Zeile für Zeile, ohne Laufstempel.
