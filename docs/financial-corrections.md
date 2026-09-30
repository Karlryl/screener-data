# Finanzdatenkorrektur F2 — 29.09.2026

> **Auf einen Blick:** Die Handtabelle korrigiert 20 Umsatzwerte und kennzeichnet 16 belegte falsche Nullen als fehlend. Banpu erhält wegen vermischter Gesellschaftsdaten keinen Score.
> - 16118 Unternehmensstände geprüft; 16110 bleiben vollständig unverändert.
> - Breite Nullwertregel: 9900 Kandidaten, 122 Scoreänderungen im gepaarten Hauptbestandstest; deshalb ausschließlich Schattenbetrieb.
> - Noch keine Veröffentlichung. Der genaue historische Smallcap-Eingabestand fehlt; sämtliche 1.100 Quality-Ausgangsscores stimmen mit der Veröffentlichung überein.

## Ursache und begrenzte Reparatur

BANPU.BK: Der aktuelle Yahoo-Abruf nennt Banpu PCL und USD, liefert aber die THB-Quartalsumsätze von Banpu Power. Der echte Mapper liefert 5.092.756.000; die ursprüngliche USD-Konvertierung übernimmt ihn mit Faktor 1. Der 2025-Jahresumsatz 27.850.393.000, Bruttogewinn 4.540.955.000 und die Aktienzahl 3.047.731.700 identifizieren zusätzlich das Tochter-Datenpaket. Andere Felder, etwa TTM-Umsatz, stammen aus der Mutter. Deshalb werden fünf Umsätze ersetzt und genau dieses gemischte Paket vom Scoring ausgeschlossen; der Grund erscheint sichtbar. Die am selben Jahresindex zusammengehörigen Fingerabdrücke gelten auch nach einem Jahreswechsel. Eine Verhältnis-Heuristik ändert keine Daten.

HTGC: Alle fünf Yahoo-Umsätze sind rechnerisch „investment income + realized/unrealized gains − interest expense − gain/loss on debt extinguishment“. Q2 2026 beispielsweise: 149,114 + 37,266 − 28,130 − (−0,002) = 158,252 Mio. USD. Das ist nicht „Total investment income“. Die Reihe ist mit echten Unternehmens-/SEC-Daten nachgestellt; der interne Yahoo-Algorithmus ist nicht einsehbar. ARCC und FSK liefern ebenfalls andere Ergebnisgrößen als den belegten Investmentertrag; nur diese drei nachgeprüften BDCs werden korrigiert.

Die Nullfälle sind genau **15 Bruttogewinne plus ein Umsatz**, insgesamt 16 Zellen. Sie werden leer, nie durch geschätzte Werte ersetzt. Die allgemeine Regel prüft exakte Null, datengleich zugeordnete Gegenfelder oder direkte nicht-null Nachbarperioden; belegte echte Null bleibt erhalten. Weil die breitere Regel die 50-Grenze überschreitet, protokolliert sie nur. Nicht-null Werte verändert sie in keinem der 16118 Stände.

## Neue Quartale und veränderte Anbieterwerte (Nachtrag 30.09.2026)

Bei HTGC, ARCC, FSK und BANPU.BK ist die Umsatzreihe des Anbieters in ihrer Basis falsch, nicht nur in einzelnen Werten. Die Handtabelle trägt deshalb je Reihe ein `coversThrough` (letztes gegen die Primärquelle geprüfte Quartal: 30.06.2026, bei Banpu 31.03.2026). Jedes neuere Quartal wird leer gesetzt (Code `period-after-coverage`), ebenso eine nicht gelistete ältere oder undatierte Periode (`period-not-verified`). Ein Tabellenfall, dessen Anbieterwert sich seit der Prüfung geändert hat, wird ebenfalls leer (`vendor-value-changed`, bei geänderter Währung, Quelle, Einheit oder doppeltem Datum `context-changed`), statt den Anbieterwert stehen zu lassen. Jede solche Zelle zählt als „stale"; die Tageszusammenfassung trägt dann `::warning::`. Wachstum und Scores sehen „fehlt": das Quartalsbein fällt weg, es trägt das Jahreswachstum (kein Ersatzwert 0). Der Text erscheint im Export im zusätzlichen Feld `financialDataReasons`, nicht in `lamps`.

## Jede aktive Zelländerung

Beträge in Originalwährung; FX-umgerechnete Eingaben erhalten denselben gespeicherten Kursfaktor. URL, Originalzitat und PDF-Seite bzw. HTML/XBRL-Fundstelle stehen je Zelle in der Handtabelle.

| Ticker | Periode | Feld | Währung | Alt | Neu |
| --- | --- | --- | --- | --- | --- |
| HTGC | 2026-06-30 | revenueQ | USD | 158252000 | 149114000 |
| HTGC | 2026-03-31 | revenueQ | USD | 67782000 | 141536000 |
| HTGC | 2025-12-31 | revenueQ | USD | 115987000 | 137430000 |
| HTGC | 2025-09-30 | revenueQ | USD | 145121000 | 138093000 |
| HTGC | 2025-06-30 | revenueQ | USD | 104703000 | 137459000 |
| YSN.DE | 2026-06-30 | grossProfitQ | EUR | 0 | fehlt |
| YSN.DE | 2025-09-30 | grossProfitQ | EUR | 0 | fehlt |
| YSN.DE | 2025-06-30 | grossProfitQ | EUR | 0 | fehlt |
| YSN.DE | 2025-03-31 | grossProfitQ | EUR | 0 | fehlt |
| 5930.T | 2025-12-31 | grossProfitQ | JPY | 0 | fehlt |
| 5930.T | 2025-06-30 | grossProfitQ | JPY | 0 | fehlt |
| 5930.T | 2024-12-31 | grossProfitQ | JPY | 0 | fehlt |
| 5930.T | 2024-06-30 | grossProfitQ | JPY | 0 | fehlt |
| 002092.SZ | 2014-06-30 | grossProfitQ | CNY | 0 | fehlt |
| 002092.SZ | 2014-03-31 | grossProfitQ | CNY | 0 | fehlt |
| 002092.SZ | 2013-12-31 | grossProfitQ | CNY | 0 | fehlt |
| 002092.SZ | 2013-09-30 | grossProfitQ | CNY | 0 | fehlt |
| PDN.AX | 2017-03-31 | grossProfitQ | USD | 0 | fehlt |
| PDN.AX | 2016-12-31 | grossProfitQ | USD | 0 | fehlt |
| PDN.AX | 2016-06-30 | grossProfitQ | USD | 0 | fehlt |
| PDN.AX | 2016-12-31 | revenueQ | USD | 0 | fehlt |
| BANPU.BK | 2026-03-31 | revenueQ | USD | 5092756000 | 1340143000 |
| BANPU.BK | 2025-12-31 | revenueQ | USD | 6736722000 | 1398885000 |
| BANPU.BK | 2025-09-30 | revenueQ | USD | 7450422000 | 1358440000 |
| BANPU.BK | 2025-06-30 | revenueQ | USD | 6557265000 | 1237174000 |
| BANPU.BK | 2025-03-31 | revenueQ | USD | 7105984000 | 1283603000 |
| ARCC | 2026-06-30 | revenueQ | USD | 219000000 | 768000000 |
| ARCC | 2026-03-31 | revenueQ | USD | 151000000 | 763000000 |
| ARCC | 2025-12-31 | revenueQ | USD | 344000000 | 793000000 |
| ARCC | 2025-09-30 | revenueQ | USD | 460000000 | 782000000 |
| ARCC | 2025-06-30 | revenueQ | USD | 407000000 | 745000000 |
| FSK | 2026-06-30 | revenueQ | USD | -32000000 | 290000000 |
| FSK | 2026-03-31 | revenueQ | USD | -427000000 | 304000000 |
| FSK | 2025-12-31 | revenueQ | USD | -76000000 | 348000000 |
| FSK | 2025-09-30 | revenueQ | USD | 228000000 | 373000000 |
| FSK | 2025-06-30 | revenueQ | USD | -184000000 | 398000000 |

## Jede sichtbare Scoreänderung im gepaarten Test

Growth verwendet die gespeicherte Kalibrierung vom 29.09.2026. Quality und Smallcap werden einmal mit der Ausgangskalibrierung festgehalten (direkte Wirkung), zusätzlich mit regulär neu berechneter Kalibrierung (einschließlich Verschiebungen anderer Rangwerte). Die historische Unternehmensliste des wirklichen Scoring-Laufs (256d26910e637142ceddedf51cf39b394be9287f) liefert genau 15.986 zugelassene Stände. Die folgende Tabelle enthält alle 26 aktiven Änderungen dieses Vergleichs. Davon sind vier direkte Growth-Wirkungen; 22 Quality-Werte bewegen sich um 0,1 durch Banpus Ausscheiden aus dem Vergleichskollektiv. Diese 22 Unternehmen erhalten keine Datenkorrektur.

| Ticker | Familie / Board | Score alt | Score neu |
| --- | --- | --- | --- |
| HTGC | growth / financials | 59.5 | 48.3 |
| ARCC | growth / financials | 32.6 | 36 |
| BANPU.BK | growth / utilities | 27.1 | fehlt |
| FSK | growth / financials | fehlt | 37.5 |
| ENRIN.BO | quality / quality-utilities | 82.5 | 82.6 |
| 600236.SS | quality / quality-utilities | 77 | 77.1 |
| TRN.MI | quality / quality-utilities | 73.5 | 73.6 |
| CEZ.WA | quality / quality-utilities | 73.3 | 73.4 |
| 600995.SS | quality / quality-utilities | 72.6 | 72.7 |
| ENLT | quality / quality-utilities | 72 | 72.1 |
| ATO | quality / quality-utilities | 71.2 | 71.1 |
| RENE.LS | quality / quality-utilities | 70.1 | 70.2 |
| NTPCGREEN.NS | quality / quality-utilities | 69.1 | 69.2 |
| ALUP3.SA | quality / quality-utilities | 69 | 69.1 |
| BREN.JK | quality / quality-utilities | 66.9 | 67 |
| ACMESOLAR.BO | quality / quality-utilities | 66 | 66.1 |
| 3868.HK | quality / quality-utilities | 64.7 | 64.6 |
| NWE | quality / quality-utilities | 63.8 | 63.7 |
| BLX.TO | quality / quality-utilities | 63.5 | 63.6 |
| 8174.T | quality / quality-utilities | 63.3 | 63.2 |
| 1SLR.MI | quality / quality-utilities | 63.1 | 63.2 |
| 0579.HK | quality / quality-utilities | 63 | 62.9 |
| IG.VI | quality / quality-utilities | 62.3 | 62.4 |
| ETR | quality / quality-utilities | 61 | 61.1 |
| EOAN.VI | quality / quality-utilities | 60.6 | 60.5 |
| SO | quality / quality-utilities | 60.6 | 60.5 |

Die vier Unternehmen mit belegten falschen Nullen behalten ihre Growth-Scores: secunet 73,0; Bunka Shutter 41,7; Zhongtai 44,1; Paladin 60,9. Ihre betroffenen Felder fehlen nun mit Begründung. HTGC-Umsatzwachstum: 51,143711 % → 8,478892 %.

## Breite Nullregel: ausschließlich Schattenrechnung

Alle 122 gemessenen Scoreänderungen stehen in der folgenden Tabelle und in financial-corrections-board-changes.csv. Alle 9900 Zellen stehen in financial-corrections-shadow-cells.csv. 26 sichtbare Auswirkungen bleiben auch bei festgehaltener Vergleichskalibrierung; die übrigen entstehen bei der regulären Neukalibrierung. Keine dieser breiten Änderungen ist aktiviert.

| Ticker | Familie / Board | Score alt | Score Schatten |
| --- | --- | --- | --- |
| M4I.DE | growth / financials | 65.7 | fehlt |
| AGTF.TO | growth / consumer-staples | 54.2 | 54.7 |
| 0291.HK | growth / consumer-staples | 31.5 | 41.6 |
| VPK.VI | growth / energy | 46.4 | 44.3 |
| 601881.SS | growth / financials | 45.9 | 49.8 |
| IGG.L | growth / financials | 35.7 | 44.7 |
| OXLC | growth / financials | 29.2 | 35 |
| MAZE | growth / health-care | 34.8 | fehlt |
| PYC.AX | growth / health-care | 26.8 | 41.4 |
| 600582.SS | growth / industrials | 31.7 | 47 |
| 600525.SS | growth / industrials | 31 | 44.5 |
| HMMC.TO | growth / materials | 55.5 | 63.1 |
| EQR.AX | growth / materials | 41.3 | fehlt |
| RML | growth / materials | 41.3 | fehlt |
| 603993.SS | growth / materials | 26.1 | 29.5 |
| 3888.HK | growth / software-comm-services | 25 | 16.6 |
| V03.SI | growth / tech-hardware | 37.3 | 38.3 |
| 0285.HK | growth / tech-hardware | 26.3 | 26.1 |
| ADV.DE | growth / tech-hardware | 62.8 | 69.2 |
| 2498.HK | growth / tech-hardware | 43 | 52.8 |
| EYDAP.AT | growth / utilities | 21.9 | fehlt |
| BAJFINANCE.NS | growth / financials | fehlt | 57 |
| MA | growth / financials | fehlt | 54.6 |
| PAG.L | growth / financials | fehlt | 43.8 |
| FMCC | growth / financials | fehlt | 41.5 |
| 8425.T | growth / financials | fehlt | 32.4 |
| 7936.T | quality / quality-consumer-discretionary | 80.6 | 80.5 |
| CHALET.BO | quality / quality-consumer-discretionary | 77.2 | 77.1 |
| 6181.HK | quality / quality-consumer-discretionary | 76.2 | 76.1 |
| SANSERA.NS | quality / quality-consumer-discretionary | 74.4 | 74.3 |
| 3306.HK | quality / quality-consumer-discretionary | 74.3 | 74.2 |
| HEROMOTOCO.NS | quality / quality-consumer-discretionary | 74.1 | 74 |
| ONON | quality / quality-consumer-discretionary | 74 | 73.9 |
| PUUILO.HE | quality / quality-consumer-discretionary | 73.8 | 73.7 |
| SUNDRMFAST.NS | quality / quality-consumer-discretionary | 72.7 | 72.6 |
| 600660.SS | quality / quality-consumer-discretionary | 72.3 | 72.2 |
| MSUMI.BO | quality / quality-consumer-discretionary | 71.7 | 71.6 |
| PGHH.BO | quality / quality-consumer-staples | 80.9 | 80.8 |
| DNO.OL | quality / quality-energy | 75.8 | 75.7 |
| RRC | quality / quality-energy | 72 | 71.9 |
| COALINDIA.NS | quality / quality-energy | 69.7 | 69.8 |
| PSK.TO | quality / quality-energy | 68.5 | 68.4 |
| CHENNPETRO.NS | quality / quality-energy | 67.9 | 67.8 |
| PARR | quality / quality-energy | 65.9 | 65.8 |
| AROC | quality / quality-energy | 65.9 | 65.8 |
| PTTEP.BK | quality / quality-energy | 65.7 | 65.8 |
| CEU.TO | quality / quality-energy | 63.7 | 63.6 |
| CVI | quality / quality-energy | 62.6 | 62.5 |
| VLE.TO | quality / quality-energy | 62.4 | 62.5 |
| CNQ | quality / quality-energy | 62.2 | 62.1 |
| MATR.TO | quality / quality-energy | 61.5 | 61.4 |
| SM | quality / quality-energy | 59.9 | 59.8 |
| 2382.SR | quality / quality-energy | 59.7 | 59.8 |
| BRAV3.SA | quality / quality-energy | 59.7 | 59.6 |
| BP | quality / quality-energy | 58.6 | 58.5 |
| 214150.KQ | quality / quality-health-care | 88.6 | 88.5 |
| RUBICON.NS | quality / quality-health-care | 79.4 | 79.3 |
| 688677.SS | quality / quality-health-care | 79.3 | 79.2 |
| 600867.SS | quality / quality-health-care | 79 | 78.9 |
| 7741.T | quality / quality-health-care | 78.7 | 78.8 |
| METROPOLIS.NS | quality / quality-health-care | 77.8 | 77.7 |
| 3692.HK | quality / quality-health-care | 75.9 | 75.8 |
| THYROCARE.NS | quality / quality-health-care | 75.2 | 75.1 |
| MAXHEALTH.BO | quality / quality-health-care | 73.6 | 73.5 |
| ALK-B.CO | quality / quality-health-care | 70 | 69.9 |
| MANIPALHOS.NS | quality / quality-health-care | 69.9 | 69.8 |
| GLAXO.BO | quality / quality-health-care | 69.7 | 69.6 |
| DOCS | quality / quality-health-care | 69.2 | 69.1 |
| LKFT | quality / quality-health-care | 68.9 | 69 |
| ALKEM.BO | quality / quality-health-care | 68.4 | 68.3 |
| GLAND.NS | quality / quality-health-care | 68.2 | 68.1 |
| PFIZER.BO | quality / quality-health-care | 68 | 67.9 |
| IDXX | quality / quality-health-care | 67.7 | 67.6 |
| 2637.HK | quality / quality-health-care | 67.6 | 67.7 |
| 215A.T | quality / quality-industrials | 90.2 | 90.1 |
| 8996.TW | quality / quality-industrials | 78.2 | 78.1 |
| NWG.WA | quality / quality-industrials | 76.4 | 76.3 |
| ALQ.AX | quality / quality-industrials | 75.8 | 75.7 |
| 002690.SZ | quality / quality-industrials | 75.8 | 75.7 |
| ZEHN.SW | quality / quality-industrials | 75.7 | 75.6 |
| CUMMINSIND.NS | quality / quality-industrials | 75.1 | 75 |
| SUZLON.BO | quality / quality-industrials | 75.1 | 75 |
| HINDCOPPER.NS | quality / quality-materials | 86.8 | 86.7 |
| 001337.SZ | quality / quality-materials | 85.9 | 85.8 |
| BHP | quality / quality-materials | 81.3 | 81.2 |
| ANTO.L | quality / quality-materials | 76.7 | 76.6 |
| ASIANPAINT.NS | quality / quality-materials | 74.9 | 74.8 |
| GNG.AX | quality / quality-materials | 74.7 | 74.6 |
| III.TO | quality / quality-materials | 73.1 | 73 |
| 688093.SS | quality / quality-materials | 71.4 | 71.3 |
| APP | quality / quality-software-comm-services | 86.8 | 86.7 |
| 1INN.DE | quality / quality-software-comm-services | 81.5 | 81.4 |
| FICO | quality / quality-software-comm-services | 77.2 | 77.1 |
| FTNT | quality / quality-software-comm-services | 76.3 | 76.2 |
| AOF.DE | quality / quality-software-comm-services | 76.2 | 76.1 |
| OFSS.BO | quality / quality-software-comm-services | 75 | 74.9 |
| PAYX | quality / quality-software-comm-services | 75 | 74.9 |
| 5032.T | quality / quality-software-comm-services | 74.1 | 74 |
| 9911.HK | quality / quality-software-comm-services | 71.9 | 71.8 |
| NFLX | quality / quality-software-comm-services | 71.3 | 71.2 |
| BLACKBUCK.NS | quality / quality-software-comm-services | 70.5 | 70.4 |
| NEM.DE | quality / quality-software-comm-services | 69.9 | 69.8 |
| QLYS | quality / quality-software-comm-services | 68.7 | 68.6 |
| HAV2.VI | quality / quality-software-comm-services | 68.3 | 68.4 |
| SGE.L | quality / quality-software-comm-services | 68.3 | 68.4 |
| 9766.T | quality / quality-software-comm-services | 68.2 | 68.1 |
| GRND | quality / quality-software-comm-services | 68.2 | 68.1 |
| INTU | quality / quality-software-comm-services | 67.7 | 67.6 |
| 2371.T | quality / quality-software-comm-services | 67 | 67.1 |
| LMN.V | quality / quality-software-comm-services | 66.9 | 66.8 |
| FRSH | quality / quality-software-comm-services | 66.8 | 66.7 |
| TOTS3.SA | quality / quality-software-comm-services | 66.6 | 66.5 |
| PTC | quality / quality-software-comm-services | 66 | 65.9 |
| NTAP | quality / quality-software-comm-services | 65.2 | 65.1 |
| PEXIP.OL | quality / quality-software-comm-services | 64.6 | 64.5 |
| PCTY | quality / quality-software-comm-services | 64.3 | 64.2 |
| 1860.HK | quality / quality-software-comm-services | 63.1 | 63 |
| PEGA | quality / quality-software-comm-services | 62.9 | 62.8 |
| 3769.T | quality / quality-software-comm-services | 62.5 | 62.4 |
| NTES | quality / quality-software-comm-services | 61.6 | 61.5 |
| 002052.SZ | quality / quality-tech-hardware | 74.6 | 74.5 |
| ASTRAMICRO.NS | quality / quality-tech-hardware | 72.6 | 72.5 |

## Verdachtsliste mit Gegenprüfung

39 Kandidaten erfüllen USD-Berichtswährung bei anderer Handelswährung und Jahresumsatz/Marktkapitalisierung >5 oder starkem Quartalssprung (>3 bzw. <1/3). Das sind Suchsignale, kein Fehlerbeweis: kleine Marktkapitalisierung, Saisonalität und fehlende Quartalswerte können dieselben Verhältnisse erzeugen. Alle Eingangsbeträge, Aktienzahlen und Vorquartale stehen in financial-corrections-suspects.json. Nur BANPU ist als Fremdgesellschaft/Währung belegt. Keine der übrigen 38 Zeilen wird aufgrund dieser Liste verändert. Sicherheitsurteil für einen tatsächlichen Fehler dort: offen, unter 60 %.

| Ticker | Handelswährung | Jahresumsatz / Marktkap. | Quartal / Vorquartal | Befund |
| --- | --- | --- | --- | --- |
| 1199.HK | HKD | 0.548 | fehlt | ungeklärt; unverändert |
| 1860.HK | HKD | 0.768 | fehlt | ungeklärt; unverändert |
| 1AAL.MI | EUR | 6.123 | 1.203 | ungeklärt; unverändert |
| 1CNC.MI | EUR | 6.376 | 1.073 | ungeklärt; unverändert |
| 1COR.MI | EUR | 5.242 | 1.082 | ungeklärt; unverändert |
| 1DINO.MI | EUR | fehlt | 1.102 | ungeklärt; unverändert |
| 1GLXY.MI | EUR | 6.123 | 0.854 | ungeklärt; unverändert |
| 1GT.MI | EUR | 12.563 | 1.095 | ungeklärt; unverändert |
| 1JAM.MI | EUR | 5.786 | 1.204 | ungeklärt; unverändert |
| 2343.HK | HKD | 0.819 | 0.000 | ungeklärt; unverändert |
| 2637.TW | TWD | 7.614 | 1.231 | ungeklärt; unverändert |
| 4335.HK | HKD | fehlt | 1.188 | ungeklärt; unverändert |
| A1G.DE | EUR | 6.137 | 1.203 | ungeklärt; unverändert |
| AAL.SW | CHF | 7.717 | 1.203 | ungeklärt; unverändert |
| AAL.VI | EUR | 6.097 | 1.203 | ungeklärt; unverändert |
| ABC.VI | EUR | 5.554 | 1.082 | ungeklärt; unverändert |
| ANTARCHILE.SN | CLP | 8.489 | 1.178 | ungeklärt; unverändert |
| BANPU.BK | THB | 20.868 | 0.756 | belegt; Handtabelle |
| BBUC.TO | CAD | 5.300 | 1.009 | ungeklärt; unverändert |
| CAPT.OL | NOK | 0.017 | 4.256 | ungeklärt; unverändert |
| CEF.TO | CAD | 0.600 | -2.473 | ungeklärt; unverändert |
| CGG.TO | CAD | fehlt | 1.017 | ungeklärt; unverändert |
| DEC.L | GBp | 1.740 | 19.189 | ungeklärt; unverändert |
| EMAS.JK | IDR | 0.000 | 10.668 | ungeklärt; unverändert |
| ENOG.L | GBp | 1.004 | 0.329 | ungeklärt; unverändert |
| EXM.BR | EUR | fehlt | 0.317 | ungeklärt; unverändert |
| G92.SI | SGD | 18.516 | fehlt | ungeklärt; unverändert |
| GYT.VI | EUR | 12.474 | 1.095 | ungeklärt; unverändert |
| HCLTECH.NS | INR | 37.495 | 1.018 | ungeklärt; unverändert |
| KD.VI | EUR | 6.183 | 0.960 | ungeklärt; unverändert |
| MSB.AX | AUD | 0.063 | 8.223 | ungeklärt; unverändert |
| OCI.AS | EUR | fehlt | 0.989 | ungeklärt; unverändert |
| PDN.AX | AUD | 0.102 | 0.000 | ungeklärt; unverändert |
| PDN.TO | CAD | fehlt | 0.000 | ungeklärt; unverändert |
| PTTEP.BK | THB | 16.245 | 1.264 | ungeklärt; unverändert |
| QBE.AX | AUD | fehlt | fehlt | ungeklärt; unverändert |
| RRC.RO | RON | 6.702 | 1.307 | ungeklärt; unverändert |
| SFC.TO | CAD | 0.000 | 3.573 | ungeklärt; unverändert |
| STO.AX | AUD | fehlt | 1.061 | ungeklärt; unverändert |

BDC-Prüfumfang: ARCC, BBDC, BXSL, CSWC, FSK, GBDC, HTGC, MAIN, OBDC, OCSL, PSEC, TRIN, TSLX. Belegt: HTGC, ARCC, FSK. Die zehn übrigen sind in diesem Durchgang nicht durch Primärquellen entschieden; ihre ursprünglichen fünf Quartale bleiben erhalten. 2155 Gruppen identischer Jahresumsätze wurden erfasst (häufig Zweitnotierungen); kein weiterer Fremdgesellschaftsfehler allein aus diesem Vergleich bewiesen.

## Belege, Unverändertheit und Grenzen

SHA-256 der sortierten Liste aller Quelldatei-Hashes: `81c96b4789073dac5e6085c9fb2bfe489cd1e57629228f66ffbcbe12db3e4397`. Vor und nach dem Lauf bleiben alle 16118 Dateihashes identisch. Jede bearbeitete Zeile wird für den Vergleich auf ihre exakt gespeicherte Originalzeile zurückgesetzt; einschließlich der ausdrücklich erlaubten Banpu-Metadaten ergibt sich derselbe JSON-Byte-String. Alle anderen Eingabezellen sind damit identisch. Scoregleichheit aller übrigen Unternehmen wird wegen Neukalibrierung ausdrücklich nicht behauptet.

Reproduzierbar: `node scripts/financial-corrections-replay.js <read-only-snapshot-directory> [veröffentlichungs-ref]` (Nachlauf 30.09. mit Ref d164b75262 = Veröffentlichung vom 29.09.: dieselben 36 Zellen, 0 stale, identische Board-Wirkung). Die 16.118 Originale kommen aus dem r1-Archiv snapshots-20260929 im freigegebenen sd-ro-Arbeitsbaum. Es wird keine Historie geschrieben und kein loadUniverse-Aufruf verwendet, der eine Baseline-Datei anlegen könnte. Die vorhandene Q4-Reparatur bildet den Ausgangsstand beider Arme.

Die Quality-Ausgangsscores stimmen vollständig mit allen 1.100 veröffentlichten Zeilen überein. Growth hat genau eine Abweichung: CHWY 42,4 veröffentlicht, 42,5 im Replay; CHWY wird durch F2 nicht verändert. Smallcap ist nur eine Diagnose mit dem Hauptbestand (517 Feed-Abweichungen), kein gültiger historischer Nachbau. Der wirkliche Smallcap-Lauf verwendete den Cache snapshots-smallcap-store-36236295562 vom 26.09. mit 769 Dateien und 490 zugelassenen Firmen. Das vorhandene Archiv des gescheiterten späteren 29.09.-Laufs enthält 418 neuere Stände und wäre eine falsche Grundlage. Das passende ältere Artefakt ist lokal und über die geprüfte GitHub-Artefaktliste nicht erreichbar. Zusätzlich braucht Smallcap seine eigene historische Unternehmensliste und die Produktions-Abdeckungsgrenze. Vollständige Smallcap-Board-Parität bleibt deshalb offen.

Rule of 40: 16118 Originaldateien, 5221 Kandidaten, 469 sichtbare Zeilen. Ausgangsabweichungen zur Veröffentlichung: 0. Aktive Änderungen: 0. Im Schatten ändern sich 34 Zeilen bei R40/R40-EBITDA oder Rang; kein übernommener Engine-Score ändert sich. Alle Alt/Neu-Werte stehen unter rule40 in financial-corrections-replay.json. Der echte Produktions-Sammler läuft mit ausschließlich lesendem Speicheradapter; Originaldateinamen, Währungsbelege und Veröffentlichungsdatum bleiben erhalten.

Druckenmiller wurde unabhängig mit dem echten loadCandidates und denselben drei Armen geprüft: 2.277 Kandidaten in jedem Arm; vollständige Kandidaten-Inhalte bytegleich, keine unlesbaren Dateien. Es gibt damit keine geänderten Eingaben für dieses separate Modul (Prüferbeleg, Sicherheit 99 %).

Primärquelle Banpu: [Quartalsabschluss](https://www.banpu.com/wp-content/uploads/2026/03/Banpu-PLC_Mar26Q1-EN.pdf), PDF8 (gedruckt7), „Sales and service income“. Primärquelle Tochter: [Banpu Power](https://www.banpupower.com/wp-content/uploads/2026/05/BPP-Q1Mar69-EN-Signed.pdf), PDF6, „Sales“. HTGC: [10-Q](https://investor.htgc.com/sec-filings/all-sec-filings/content/0001280784-26-000042/0001280784-26-000042.pdf), PDF82, „Total investment income“. Vollständige USD-Quartale, SEC-Fundstellen, Ableitungen und Abrufstand in financial-corrections-source-evidence.json; Yahoo-Wiederholung in financial-corrections-yahoo-evidence.json.

## Prüfung und Übergabe

Unabhängiger Astra-ultra-Prüfer: 16.118 Stände, genau acht Änderungen/36 Zellen, Eingaben unverändert, Wiederholung idempotent, Schattenbetrieb ohne Mutation; alle 15 BDC-Umsätze gegen SEC bestätigt. Sein nachgestellter Banpu-Jahreswechsel-Fund ist repariert und mit einer absichtlich roten In-Memory-Gegenprobe abgesichert. Die neue Suite besteht mit 42 Prüfblöcken und 41 absichtlichen Fehlern; SHA-256 des echten Codes davor/danach unverändert. GQS besteht unabhängig mit 25 Referenzfällen/13 Branchen und keiner Score-/Rangabweichung. Der Prüfer meldet keine offenen Blocker (97 % Sicherheit). Veröffentlichung und Claude-Freigabe sind nicht Bestandteil dieses Auftrags.

Gesamtprüfung `node scripts/test-gate.js --mode=all`: 580 echte Testdateien, 499 PASS, 74 FAIL, 7 ohne ausgeführte Prüfung. Alle 74 fehlgeschlagenen Dateien sind gegenüber HEAD unverändert; Python-Start wird mit EPERM verweigert, in einem Test scheitern zusätzlich Windows-Benutzerabfragen mit ENOMEM. Beide Umgebungsfehler wurden unabhängig nachgestellt. Die Gesamtprüfung ist rot; fehlende Archivdaten sind nicht als Ursache behauptet. Gezielte F2-, Q4-, FX- und GQS-Suiten laufen nach dem letzten Code-Stand erfolgreich. Der separate alte Q4-Bestandsreplay hat einen festen Vortags-Sollwert von 27 und schlägt am neuen Tagesbestand mit 19 neuen Treffern fehl: acht weitere Zellen sind bereits korrekt (27 = 19 neu + 8 bereits korrigiert), anhand aller urspr?nglichen Fallzeilen nachgepr?ft. Seine Vorgabe wurde nicht gelockert.

Befehle und Ausgaben liegen unter _scratch/f2: targeted-financial-final.log (42/41), targeted-q4-final.log, targeted-gqs-final.log, targeted-fx-final.log sowie full-test-gate-final.log. Reproduzierbare Belege sind die beiden echten Module mapFTSToQuarterly/_convertSnapshotToUSD, die Quellen-Handtabelle und financial-corrections-replay.js. Keine Datenhistorie, Formel, Achsengewichtung oder eingefrorene GQS-Referenz wurde verändert.

Git-Abschluss: git add scheitert an index.lock (Permission denied). Alle ?nderungen bleiben auf fix/banpu-htgc-and-false-zeros-20260929 uncommittet; kein Push, kein PR, kein Merge. Sitzungs-ID und vorgesehene Trailer stehen in financial-corrections-validation.json.
