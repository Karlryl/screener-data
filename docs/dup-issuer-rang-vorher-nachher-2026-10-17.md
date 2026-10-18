> **Auf einen Blick**
>
> Auf dem Datenstand vom 17.10.2026 verlieren neun Listenzeilen ihren Rang, alle Zweitnotierungen von fünf Firmen: AeroVironment (AVAV.SW), GE Aerospace (GE.VI), Galaxy Digital (1GLXY.MI), Copel (ELPC) und AXIA (AXIA). Sie bleiben mit allen Zahlen sichtbar und tragen den Grund `dupIssuer`; jede Firma steht danach nur noch einmal mit Rang in einer Rangliste.
> - Maßgeblich ist die Heimatnotierung aus der Handtabelle. Bei Copel und AXIA saß die Markierung `dupIssuer` bisher auf der Heimatnotierung (CPLE3.SA, AXIA3.SA); sie sitzt jetzt auf ELPC und AXIA. CPLE3.SA und AXIA3.SA behalten ihren Rang (Versorger 55, Qualität Versorger 58 → 57) und sind im Filter-Reiter sichtbar, ELPC und AXIA verlieren ihn und sind dort standardmäßig ausgeblendet.
> - Die Zeilen darunter rücken um genau einen Platz je entrangter Zeile darüber auf (höchstens zwei, bei den Versorgern). Klöckner, Amrize, Aeroméxico und Ascentage Pharma bleiben unverändert.
> - INPP.L und OCI.L bekommen nur den Klassengrund „geschlossener Fonds“ im Schattenfeld; an dem, was Karl sieht, ändert das nichts (INPP.L zeigt weiter 7.614 % Umsatzwachstum, beide stehen weiter ohne Rang in der Finanzen-Liste). Fondsvehikel aus der operativen Rangliste zu nehmen, also die Klassentabelle scharf zu schalten, ist eine eigene, spätere Änderung mit eigenem Vorher/Nachher; dieser Zweig behebt das nicht.

# Zweitnotierungen ohne Rang: vorher und nachher (Datenstand 17.10.2026)

## Regel

Die Heimatnotierung kommt allein aus der Handtabelle `configs/dup-issuer-shadow-table.json` (Feld `homeListingProposal`, Herkunft R11 mit Quelle und Zitat). Jede andere Notierung derselben Firma bekommt `rank: null` mit `rankGrund: "dupIssuer"`, sobald die Heimatnotierung in derselben Rangliste steht (bei einer Kurzliste: in der Vollkohorte desselben Tracks, damit Kurzliste und Vollboard deckungsgleich bleiben). Steht die andere Notierung allein, behält sie ihren Rang, sonst verschwände die Firma aus der Rangliste. Ist die Heimatnotierung offen (`null`), ändert sich nichts. Die Markierung `dupIssuer` folgt bei Copel und AXIA ebenfalls der Heimatnotierung (neues Tabellenfeld `markFollowsHomeListing`, Entscheidung des Masters vom 18.10.2026): Markiert sind jetzt ELPC und AXIA, nicht mehr CPLE3.SA und AXIA3.SA. Bei allen anderen Firmen bleibt die Markierung, wo sie war. Allgemein angewandt würde sie nur bei Klöckner wandern: KCO.VI, am 17.10. die einzige ausgelieferte Zeile der Firma, wäre dann markiert und im Filter-Reiter standardmäßig ausgeblendet; deshalb bleibt Klöckner unverändert und braucht eine eigene Entscheidung.

## Messung

Grundlage ist die Nachstellung des Bewertungslaufs vom 17.10.2026 aus PR #10 (Code und Daten des Auslösecommits `df47be8`, Snapshot-Artefakt des Laufs 39036704898, Uhr fest auf 2026-10-17T14:47:00Z). Für die Exportskripte ist `df47be8` mit der Basis `b59a1d1` identisch; dazwischen kam nur `scripts/clock-shift-gate.js` hinzu. Die Bewertung selbst ändert sich durch diesen Zweig nicht, deshalb laufen in beiden Armen nur die Exportschritte des Bewertungsjobs neu, in derselben Kopie und mit denselben Eingaben: findash-Export, Ausschlussliste, Rule of 40, Filter-Universum, Bewertungs-Feed. Der einzige Unterschied sind fünf Dateien dieses Zweigs (`scripts/write-findash-export.js`, `scripts/write-rule40-export.js`, `lib/dup-issuer-shadow-table.js`, `configs/dup-issuer-shadow-table.json`, `configs/non-operating-classes.json`).

**Auf dem Stand nach PR #10:** Seit PR #10 (Handtabelle 18.10., `14a0c80`) auf main ist, rechnen beide Arme auf dem Nachher-Arm von PR #10 (dessen Handtabelle ist byte-gleich mit main). Der Vorher-Arm trifft diesen Export bei jedem Rang und Score. Gegenüber der Rechnung ohne PR #10 ändert sich nur die Finanzen-Liste: Victory Capital (VCTR) steht dort jetzt auf Rang 76 statt 38, deshalb rückt 1GLXY.MI von 74 auf 73 vor und verliert dort seinen Rang, und im Vollboard verschieben sich 220 statt 219 Zeilen. Alle anderen Listen und alle übrigen Zahlen unten sind unverändert.

**Nachstellung geprüft:** Der Vorher-Arm trifft den veröffentlichten Export vom 17.10. (gh-pages) bei jedem Rang und jedem Score in allen Listen außerhalb des Small-Cap-Bestands; abweichend sind nur Laufkennung und Zeit. Der Small-Cap-Bestand ist wie in PR #10 nicht abrufbar und fehlt in beiden Armen gleich; der Dateicheck meldet deshalb in beiden Armen dieselbe eine Small-Cap-Zeile und sonst nichts.

**Was sich ändert:** Nur acht Dateien unterscheiden sich inhaltlich (ohne Laufstempel): `industrials.json`, `utilities.json`, `financials.json`, `full/industrials.json`, `full/utilities.json`, `full/financials.json`, `quality/utilities.json` und `filter/universum.json`. Kein Score, keine Reihenfolge und keine Listenmitgliedschaft ändert sich; Rule of 40, beide Überblicke und alle anderen Branchen bleiben gleich.

## Zeilen, die ihren Rang verlieren

| Liste | Kürzel | Rang vorher → nachher | Heimatnotierung (bleibt gerankt) |
|---|---|---:|---|
| Industrie, unprofitabel (Kurzliste) | AVAV.SW | 38 → ohne Rang | AVAV (nicht in der Kurzliste; Vollboard 140 → 139) |
| Industrie, unprofitabel (Vollboard) | AVAV.SW | 38 → ohne Rang | AVAV, 140 → 139 |
| Industrie, profitabel (Vollboard) | GE.VI | 243 → ohne Rang | GE, 242 → 242 |
| Finanzen, profitabel (Vollboard) | 1GLXY.MI | 73 → ohne Rang | GLXY, 74 → 73 |
| Versorger, profitabel (Kurzliste) | ELPC | 56 → ohne Rang | CPLE3.SA, 55 → 55 |
| Versorger, profitabel (Vollboard) | ELPC | 56 → ohne Rang | CPLE3.SA, 55 → 55 |
| Versorger, profitabel (Kurzliste) | AXIA | 90 → ohne Rang | AXIA3.SA (nicht in der Kurzliste; Vollboard 105 → 103) |
| Versorger, profitabel (Vollboard) | AXIA | 90 → ohne Rang | AXIA3.SA, 105 → 103 |
| Qualität Versorger, profitabel | AXIA | 57 → ohne Rang | AXIA3.SA, 58 → 57 |

Jede dieser Zeilen behält Score, Lampen und Kennzahlen; neu ist `rank: null` mit `rankGrund: "dupIssuer"`. ELPC und AXIA tragen jetzt die Markierung `dupIssuer` (Verweis auf CPLE3.SA bzw. AXIA3.SA); CPLE3.SA und AXIA3.SA tragen keine mehr. Das sind die einzigen Markierungen, die sich bewegen.

## Verschobene Ränge

Jede andere Zeile rückt um genau so viele Plätze auf, wie über ihr Zeilen entrangt wurden; keine Zeile oberhalb bewegt sich.

| Liste | verschobene Zeilen | Ränge vorher → nachher |
|---|---:|---|
| Industrie, unprofitabel (Kurzliste) | 58 | 39–96 → 38–95 (je 1) |
| Industrie, unprofitabel (Vollboard) | 134 | 39–172 → 38–171 (je 1) |
| Industrie, profitabel (Vollboard) | 1.666 | 244–1.909 → 243–1.908 (je 1) |
| Finanzen, profitabel (Vollboard) | 220 | 74–293 → 73–292 (je 1) |
| Versorger, profitabel (Kurzliste) | 43 | 57–89 → 56–88 (je 1), 91–100 → 89–98 (je 2) |
| Versorger, profitabel (Vollboard) | 286 | 57–89 → 56–88 (je 1, 33 Zeilen), 91–343 → 89–341 (je 2, 253 Zeilen) |
| Qualität Versorger, profitabel | 43 | 58–100 → 57–99 (je 1) |

Sichtbar in der Kurzliste Industrie, unprofitabel: 688005.SS 39 → 38, ALX.AX 40 → 39, 030530.KQ 41 → 40, BETA 42 → 41, PLUG 43 → 42, CYRX 44 → 43, TH 45 → 44, 300506.SZ 46 → 45, 002272.SZ 47 → 46, LUNR 48 → 47, 603618.SS 49 → 48, AXON 50 → 49, 2432.HK 51 → 50, 605178.SS 52 → 51, 300593.SZ 53 → 52, 3928.HK 54 → 53, HAWK 55 → 54, 301070.SZ 56 → 55, 600500.SS 57 → 56, 2464.TW 58 → 57, 002097.SZ 59 → 58, 600115.SS 60 → 59, 002426.SZ 61 → 60, TPK.L 62 → 61, DCO 63 → 62, MMTC.BO 64 → 63, 454910.KS 65 → 64, 600698.SS 66 → 65, JBLU 67 → 66, 300328.SZ 68 → 67, SYM 69 → 68, 601700.SS 70 → 69, 600843.SS 71 → 70, 600343.SS 72 → 71, 301306.SZ 73 → 72, 601111.SS 74 → 73, FCEL 75 → 74, 301307.SZ 76 → 75, 4264.SR 77 → 76, 300648.SZ 78 → 77, 002141.SZ 79 → 78, IJ8.DE 80 → 79, 006400.KS 81 → 80, 002310.SZ 82 → 81, 301326.SZ 83 → 82, RKLB 84 → 83, 002176.SZ 85 → 84, 6871.HK 86 → 85, 603033.SS 87 → 86, 600153.SS 88 → 87, 000008.SZ 89 → 88, 603595.SS 90 → 89, 300900.SZ 91 → 90, 300842.SZ 92 → 91, XE 93 → 92, 600158.SS 94 → 93, 688559.SS 95 → 94, NWCL 96 → 95.

Sichtbar in der Kurzliste Versorger, profitabel: CDIA.JK 57 → 56, CEG 58 → 57, NHPC.BO 59 → 58, AES 60 → 59, 001376.SZ 61 → 60, ENEV3.SA 62 → 61, D 63 → 62, ED 64 → 63, NEE 65 → 64, UTL 66 → 65, SCATC.OL 67 → 66, ADANIGREEN.NS 68 → 67, IGL.NS 69 → 68, 2083.SR 70 → 69, EQTL3.SA 71 → 70, JPPOWER.BO 72 → 71, ECL.SN 73 → 72, VCT.NZ 74 → 73, BIP 75 → 74, TAC 76 → 75, SR 77 → 76, MGL.NS 78 → 77, 4677.KL 79 → 78, IBE.VI 80 → 79, ACO.TO 81 → 80, 2082.SR 82 → 81, ADMIE.AT 83 → 82, 5347.KL 84 → 83, AWR 85 → 84, 000899.SZ 86 → 85, NWE 87 → 86, CNP 88 → 87, 600982.SS 89 → 88, MSEX 91 → 89, 000993.SZ 92 → 90, AURE3.SA 93 → 91, COLBUN.SN 94 → 92, ES 95 → 93, MINERA.SN 96 → 94, 6742.KL 97 → 95, NTGCLGAS.SN 98 → 96, A2A.MI 99 → 97, DUK 100 → 98.

Sichtbar in Qualität Versorger, profitabel: AXIA3.SA 58 → 57, CEGR3.SA 59 → 58, VER.VI 60 → 59, ACO.TO 61 → 60, 3868.HK 62 → 61, D 63 → 62, ENEV3.SA 64 → 63, PGEO.JK 65 → 64, TXNM 66 → 65, 600025.SS 67 → 66, WTRG 68 → 67, DUK 69 → 68, EMA 70 → 69, EIX 71 → 70, AEP 72 → 71, ENELGXCH.SN 73 → 72, IRE.MI 74 → 73, AEE 75 → 74, NWE 76 → 75, 8174.T 77 → 76, ATGL.BO 78 → 77, CEPU 79 → 78, ERG.MI 80 → 79, 0579.HK 81 → 80, CNP 82 → 81, NI 83 → 82, IG.VI 84 → 83, ELI.BR 85 → 84, LNT 86 → 85, CPFE3.SA 87 → 86, WEC 88 → 87, TEP.L 89 → 88, ETR 90 → 89, 1SLR.MI 91 → 90, DTE 92 → 91, 000993.SZ 93 → 92, 002256.SZ 94 → 93, NGG 95 → 94, EOAN.DE 96 → 95, MGL.NS 97 → 96, ACE.MI 98 → 97, VEDPOWER.BO 99 → 98, REE.VI 100 → 99.

Das Filter-Universum übernimmt die Vollboard-Ränge: 2.311 Zeilen ändern `rk` genau wie ihre Vollboard-Zeile (fünf davon auf leer). Die fünf entrangten Notierungen tragen dort zusätzlich den Grund `dupIssuer`. findash blendet im Filter standardmäßig `dup-issuer` aus, also die markierten Zeilen. Copel und AXIA im Filter-Reiter: vorher CPLE3.SA (Rang 55) und AXIA3.SA (Rang 105) ausgeblendet, ELPC (56) und AXIA (90) sichtbar; nachher CPLE3.SA (55) und AXIA3.SA (103) sichtbar ohne Ausschlussgrund, ELPC und AXIA ohne Rang und ausgeblendet. KCO.VI bleibt sichtbar mit Rang 908.

Die Datei `dup-issuer-rang-vorher-nachher-2026-10-17.csv` daneben enthält alle 2.465 geänderten Brettzeilen auf dem Stand nach PR #10 (9 entrangte, 2.450 verschobene, 2 nur mit entfernter Markierung (CPLE3.SA), 4 Zeilen mit neuem Klassengrund), mit Rang, Grund, Klassengrund und Markierung vorher und nachher.

## Unverändert

| Firma | Zeilen am 17.10. | warum unverändert |
|---|---|---|
| Klöckner & Co | KCO.VI: Vollboard Rohstoffe 908; KCO.DE nicht im Export | Heimatnotierung KCO.DE steht in keiner Rangliste; KCO.VI ist die einzige Zeile der Firma und behält Rang und Sichtbarkeit. Die Markierung bleibt auf KCO.DE (siehe Regel). |
| Amrize | AMRZ 424, AMRZ.SW 425 (Vollboard Rohstoffe) | Heimatnotierung offen (null). |
| Grupo Aeroméxico | AERO 1.448 → 1.447, AERO.MX 1.449 → 1.448 (nur Verschiebung durch GE.VI) | Heimatnotierung offen (null). |
| Ascentage Pharma | AAPG 268, 6855.HK 267 (Vollboard Gesundheit, unprofitabel) | Heimatnotierung offen (null). |

GCP.DE (GE Aerospace) steht am 17.10. nur in der Ausschlussliste; käme es neben GE auf ein Brett, verlöre es seinen Rang auf dieselbe Weise.

## INPP.L und OCI.L

Beide stehen jetzt in `configs/non-operating-classes.json` als `nichtOperativGeschlossenerFonds`, mit Primärquelle und wörtlichem Zitat: International Public Partnerships, Startseite des Emittenten („The Company is a closed ended FTSE 250 listed investment company which is incorporated in Guernsey“), Oakley Capital Investments, Jahresbericht 2025, Note 1 („is a closed-end investment company incorporated and registered“). Wirkung am 17.10.: Beide Zeilen der Finanzen-Kurzliste (Position 10 und 18) und des Vollboards tragen jetzt `rankGrundShadow: "nichtOperativGeschlossenerFonds"`. Einen Rang hatten sie schon vorher nicht (`rankGrund: "zuWenigBelegteAchsen"`, 3 von 7 Achsen); INPP.L zeigt weiter 7.614 % Umsatzwachstum. Die Klassentabelle ist nur ein Schattenfeld, das findash nicht anzeigt; sichtbar ändert sich für beide nichts. Fondsvehikel aus der operativen Rangliste zu nehmen hieße, die Tabelle scharf zu schalten; das ist eine eigene, spätere Änderung mit eigenem Vorher/Nachher und gehört nicht zu diesem Zweig.

## Rule of 40

Der Rule-of-40-Schreiber wies bisher jede Brettzeile mit einem Rang-Grund ab. Für `dupIssuer` gilt das nicht: Die Zweitnotierungen blieben sonst aus dem Kandidatenkreis, die gelernten Wachstumsgrenzen verschöben sich, und bei 30 anderen Firmen änderten sich Rule-of-40-Werte leicht (im ersten Nachher-Lauf ohne die Ausnahme: `r40` bei 11, `r40Ebitda` bei 12, `fcfShadow.r40Shadow` bei 13 Zeilen, in der Stichprobe je 0,1; Ränge unverändert). Mit der Ausnahme bleibt die Rule-of-40-Datei inhaltlich gleich.

## Grenzen

- Small-Cap-Bestand nicht nachgestellt (nicht abrufbar); dieselbe Regel greift dort beim nächsten Lauf.
- Qualität-Bretter werden nur mit 100 Zeilen ausgeliefert; dort ist die Rangliste die ausgelieferte Liste selbst.
- Überlebensliste (Runway-Rang) läuft nie durch das Gate; am 17.10. steht dort keine Zeile der Tabelle.
- findash zeigt den neuen Grund noch nicht in Worten: Eine Zeile ohne Rang mit unbekanntem Grund erscheint als „Nicht rankbar: Grund nicht im Datenstand“. Ein Satz für `dupIssuer` in `web/src/lib/screener-rows.ts` (RANG_GRUENDE) wäre eine findash-Änderung.
- Wirkung im Betrieb: ab dem nächsten Tageslauf beim Export, ohne neues Abrufen.

## Nachweis

Gerechnet in einer Kopie der Nachstellung außerhalb des Repositorys (`C:/Users/Anwender/.codex/t/sddup/arm`); Vergleich der beiden Exportbäume Liste für Liste, Zeile für Zeile, ohne Laufstempel.
