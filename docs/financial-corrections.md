# Finanzdatenkorrektur F2 — 29.09.2026

> **Auf einen Blick:** Die Handtabelle korrigiert 20 Umsatzwerte und kennzeichnet 16 belegte falsche Nullen als fehlend; dieselben 12 Nullzellen tragen drei Zweitnotierungen derselben Firmen (YSNG.VI, PDN.TO, PALAF) und werden ebenso leer. Banpu erhält wegen vermischter Gesellschaftsdaten keinen Score.
> - 16118 Unternehmensstände geprüft; 16107 bleiben vollständig unverändert (vor den Zweitnotierungen: 16110).
> - Mit der Live-Kalibrierung des Produktionslaufs bewegen sich 434 Growth-Scores sichtbar (4 direkt, 430 indirekt um 0,1 oder 0,2), nicht nur 4 (Abschnitt „Growth mit Live-Kalibrierung“).
> - Breite Nullwertregel: 9900 Kandidaten, 122 Scoreänderungen im gepaarten Hauptbestandstest; deshalb ausschließlich Schattenbetrieb.
> - Noch keine Veröffentlichung. Der genaue historische Smallcap-Eingabestand fehlt; sämtliche 1.100 Quality-Ausgangsscores stimmen mit der Veröffentlichung überein.
> - Nachtrag 01.10.2026: 62 weitere geprüfte Umsatzzellen für 13 BDCs/Fonds; fünf bisher ausgeschlossene Fonds kommen auf das Financials-Board, OTF und KBDC sind wegen falscher Anbieter-Jahresumsätze gesperrt (Grund sichtbar); über die Live-Kalibrierung bewegen sich 320 weitere Growth-Scores (Abschnitt „BDC-Handtabelle“).
> - Zweite Tabelle 01.10.2026: HOS, TYG und Olaplex sind gesperrt (Grund sichtbar); 23 Quartalszellen von CARG, PLUS, DCO, INFQ und SLC Agrícola ersetzt, 29 bestätigte Zellen, zwei falsche Einzelwerte (VCTR, Celesc) leer; bestätigte Zellen ersetzen das Kennzeichen `singleFalseValue`, OXLC hat jetzt `coversThrough` (Abschnitt „Zweite Tabelle vom 01.10.2026“).
> - Jahreszellen 01.10.2026: Die Handtabelle kann einzelne falsche Jahreswerte (Umsatz, Bruttogewinn) leer setzen. INFQ (alle vier), CARG (2022) und OTF (alle vier Jahresumsätze) sind leer mit sichtbarem Grund; OTF ist dafür nicht mehr gesperrt und steht wieder auf dem Financials-Board (Rang 389, +5,8 % aus geprüften Quartalen). INFQ 81,0 (Rang 3) → 68,2 (Rang 14), CARG 65,2 (Rang 99) → 61,5 (Rang 124); KBDC bleibt gesperrt (Abschnitt „Jahreszellen vom 01.10.2026“).

## Ursache und begrenzte Reparatur

BANPU.BK: Der aktuelle Yahoo-Abruf nennt Banpu PCL und USD, liefert aber die THB-Quartalsumsätze von Banpu Power. Der echte Mapper liefert 5.092.756.000; die ursprüngliche USD-Konvertierung übernimmt ihn mit Faktor 1. Der 2025-Jahresumsatz 27.850.393.000, Bruttogewinn 4.540.955.000 und die Aktienzahl 3.047.731.700 identifizieren zusätzlich das Tochter-Datenpaket. Andere Felder, etwa TTM-Umsatz, stammen aus der Mutter. Deshalb werden fünf Umsätze ersetzt und genau dieses gemischte Paket vom Scoring ausgeschlossen; der Grund erscheint sichtbar. Die am selben Jahresindex zusammengehörigen Fingerabdrücke gelten auch nach einem Jahreswechsel. Weicht später auch nur ein Anker ab (etwa die Aktienzahl um 0,1 %), wird die Sperre nicht still aufgehoben: sie bleibt bestehen, bis ein Mensch das Paket neu geprüft hat, und der Lauf zählt das als „stale“ (Code `quarantine-fingerprint-changed`, mit Fall-ID); die Tageszusammenfassung trägt dann `::warning::`. Eine Verhältnis-Heuristik ändert keine Daten. In der Ausschlussliste zeigt die Banpu-Zeile weder Sektor, Branche, Marktkapitalisierung noch Wachstum, weil der Grund-Text genau diese Werte als unzuverlässig bezeichnet; Grund-Code und Text bleiben.

HTGC: Alle fünf Yahoo-Umsätze sind rechnerisch „investment income + realized/unrealized gains − interest expense − gain/loss on debt extinguishment“. Q2 2026 beispielsweise: 149,114 + 37,266 − 28,130 − (−0,002) = 158,252 Mio. USD. Das ist nicht „Total investment income“. Die Reihe ist mit echten Unternehmens-/SEC-Daten nachgestellt; der interne Yahoo-Algorithmus ist nicht einsehbar. ARCC und FSK liefern ebenfalls andere Ergebnisgrößen als den belegten Investmentertrag; nur diese drei nachgeprüften BDCs werden korrigiert.

Die Nullfälle sind genau **15 Bruttogewinne plus ein Umsatz**, insgesamt 16 Zellen. Sie werden leer, nie durch geschätzte Werte ersetzt. Die allgemeine Regel prüft exakte Null, datengleich zugeordnete Gegenfelder oder direkte nicht-null Nachbarperioden; belegte echte Null bleibt erhalten. Weil die breitere Regel die 50-Grenze überschreitet, protokolliert sie nur. Nicht-null Werte verändert sie in keinem der 16118 Stände.

## Neue Quartale und veränderte Anbieterwerte (Nachtrag 30.09.2026)

Bei HTGC, ARCC, FSK und BANPU.BK ist die Umsatzreihe des Anbieters in ihrer Basis falsch, nicht nur in einzelnen Werten. Die Handtabelle trägt deshalb je Reihe ein `coversThrough` (letztes gegen die Primärquelle geprüfte Quartal: 30.06.2026, bei Banpu 31.03.2026). Jedes neuere Quartal wird leer gesetzt (Code `period-after-coverage`), ebenso eine nicht gelistete ältere oder undatierte Periode (`period-not-verified`). Ein Tabellenfall, dessen Anbieterwert sich seit der Prüfung geändert hat, wird ebenfalls leer (`vendor-value-changed`, bei geänderter Währung, Quelle, Einheit oder doppeltem Datum `context-changed`), statt den Anbieterwert stehen zu lassen. Jede solche Zelle zählt als „stale"; die Tageszusammenfassung trägt dann `::warning::`. Wachstum und Scores sehen „fehlt": das Quartalsbein fällt weg, es trägt das Jahreswachstum (kein Ersatzwert 0). Der Text erscheint im Export im zusätzlichen Feld `financialDataReasons`, nicht in `lamps`.

Nachtrag Prüfrunde 2: Jede Reihe mit ersetzten Werten muss genau einen `coversThrough`-Eintrag haben, sonst lehnt die Prüfung die ganze Handtabelle ab (fehlender Eintrag, fehlender Schlüssel, Doppeleintrag, doppelte Fall-ID). Die Nullfälle (Ersatz „leer“) brauchen keinen. In jeder Reihe mit Handtabellen-Einträgen wird ein Wert ohne brauchbares Periodendatum (Datumsliste fehlt, ist kürzer als die Werte oder enthält kein Datum) leer gesetzt (`period-not-verified`, stale). Scheitert die Handtabelle selbst beim Einlesen im Scoring, bricht der Hauptlauf rot ab (der Smallcap-Durchgang meldet einen Fehler und setzt seine Fehlermarke), statt die Firma still als defekte Datei zu überspringen.

Nachtrag Prüfrunde 3: Die tägliche Nachlade-Logik (`lib/reload-history.js`) füllt eine Zelle, die die Handtabelle leer gesetzt oder als falsche Null belegt hat, nie aus dem gespeicherten Vortagsstand auf. Ändert der Anbieter einen geprüften Wert, bleibt die Zelle auch auf der Platte und beim Scoring leer (`vendor-value-changed`) statt der alten Korrektur; die alte Korrekturmarke wird dabei entfernt, damit kein veralteter Text erscheint. In einer Reihe, die nur einzelne belegte falsche Nullen hat (keine falsche Basis), heißt ein Wert ohne Datum jetzt `period-undated` mit eigenem Text statt „falsche Basis“.

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

Growth verwendet hier die gespeicherte Kalibrierung vom 29.09.2026; das untertreibt die Wirkung, weil der Produktionslauf live kalibriert (siehe nächster Abschnitt). Quality und Smallcap werden einmal mit der Ausgangskalibrierung festgehalten (direkte Wirkung), zusätzlich mit regulär neu berechneter Kalibrierung (einschließlich Verschiebungen anderer Rangwerte). Die historische Unternehmensliste des wirklichen Scoring-Laufs (256d26910e637142ceddedf51cf39b394be9287f) liefert genau 15.986 zugelassene Stände. Die folgende Tabelle enthält alle 26 aktiven Änderungen dieses Vergleichs. Davon sind vier direkte Growth-Wirkungen; 22 Quality-Werte bewegen sich um 0,1 durch Banpus Ausscheiden aus dem Vergleichskollektiv. Diese 22 Unternehmen erhalten keine Datenkorrektur.

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

## Growth mit Live-Kalibrierung (Nachtrag Prüfrunde 3, 30.09.2026)

Der Produktionslauf (`src/scoring/run-screener.js`) rechnet Growth mit live neu berechneter Kalibrierung. Dann verschieben die korrigierten Firmen die Vergleichswerte ihrer Branchen mit. Gleicher Datenstand (16.118 Stände, Unternehmensliste 256d26910e), Scores auf eine Nachkommastelle wie auf dem Board:

- 434 Growth-Scores ändern sich: 4 direkt (HTGC, ARCC, FSK, Banpu), 430 indirekt ohne eigene Datenänderung; davon 399 um ±0,1 und 31 um ±0,2.
- Nach Sektor (einschließlich der direkten): Financial Services 215, Utilities 216, Technology 3. In den Top 100 eines Haupt-Boards stehen 78 der 434 Zeilen.
- Die Zweitnotierungen YSNG.VI, PDN.TO und PALAF ändern keinen Score (ihre korrigierten Felder gehen wie bei der Hauptnotierung nicht in den Score ein).
- FSK kommt neu auf das Financials-Board (37,5). Vorher schloss die Heuristik für Nicht-Betriebsvehikel in `src/scoring/router.js` (Zweig „negative Quartalsumsätze bei Asset Management“, etwa Zeile 199–201) FSK wegen der negativen Anbieter-Umsätze aus. Die korrigierten Umsätze sind positiv, die Heuristik greift nicht mehr. Das ist gewollt und gleich behandelt wie HTGC und ARCC.

Alle Zeilen, die sich um mehr als 0,1 bewegen:

| Ticker | Sektor | Score alt | Score neu |
| --- | --- | --- | --- |
| HTGC | Financial Services | 59,5 | 48,3 |
| ARCC | Financial Services | 32,6 | 36,0 |
| FSK | Financial Services | fehlt | 37,5 |
| BANPU.BK | Utilities | 27,1 | fehlt |
| BEN | Financial Services | 36,6 | 36,8 |
| HDFCAMC.BO | Financial Services | 55,7 | 55,9 |
| SPGI | Financial Services | 48,7 | 48,9 |
| VIRT | Financial Services | 53,7 | 53,9 |
| 000037.SZ | Utilities | 24,9 | 24,7 |
| 000685.SZ | Utilities | 18,4 | 18,2 |
| 001289.SZ | Utilities | 11,3 | 11,1 |
| 2380.HK | Utilities | 22,7 | 22,5 |
| 3633.HK | Utilities | 23,7 | 23,5 |
| 600021.SS | Utilities | 14,0 | 13,8 |
| 600131.SS | Utilities | 45,5 | 45,3 |
| 600292.SS | Utilities | 25,2 | 25,0 |
| 600886.SS | Utilities | 17,5 | 17,3 |
| 600905.SS | Utilities | 12,5 | 12,3 |
| 9501.T | Utilities | 26,4 | 26,2 |
| 9502.T | Utilities | 29,6 | 29,4 |
| 9509.T | Utilities | 26,6 | 26,4 |
| 9513.T | Utilities | 14,9 | 14,7 |
| 9532.T | Utilities | 36,0 | 35,8 |
| APA.AX | Utilities | 28,2 | 28,0 |
| ARN.MI | Utilities | 20,5 | 20,3 |
| AVA | Utilities | 26,6 | 26,4 |
| CKI.L | Utilities | 16,8 | 16,6 |
| EGCO.BK | Utilities | 18,1 | 17,9 |
| ENIC | Utilities | 39,0 | 38,8 |
| MEZ.AX | Utilities | 10,9 | 10,7 |
| PEG | Utilities | 29,1 | 28,9 |
| PEP.WA | Utilities | 16,6 | 16,4 |
| TAEE3.SA | Utilities | 27,9 | 27,7 |
| U96.SI | Utilities | 17,4 | 17,2 |
| VST | Utilities | 24,9 | 24,7 |

Reproduzierbar mit dem Prüfer-Skript `board-diff-live.js` (live kalibriert, ohne gespeicherte Kalibrierung); die Zählung pro Zeile stammt aus demselben Aufbau mit `scoreUniverse` ohne `refCalibration`.

## Zweitnotierungen (Nachtrag Prüfrunde 3)

Die Handtabelle kennt je Fall eine Liste `listingAliases`. YSNG.VI (secunet, Wien) trägt im Archiv vom 29.09. dieselben vier falschen Bruttogewinn-Nullen wie YSN.DE, PDN.TO und PALAF dieselben vier Nullzellen wie PDN.AX, jeweils in gleicher Berichtswährung (EUR bzw. USD), gleichem Kursfaktor und gleichen Perioden; die Datenpakete sind in diesen Reihen bytegleich. Ohne Alias konnte die Doppelnotierungs-Bereinigung (größere Marktkapitalisierung gewinnt, YSN.DE und YSNG.VI liegen 0,8 % auseinander) die unkorrigierte Notierung auf das Board bringen. Ein Alias, der zugleich Hauptticker eines anderen Falls ist, lässt die Prüfung der Handtabelle scheitern. Der Nachlauf ergibt damit 48 statt 36 Zellen: die 36 Zellen der acht Hauptticker unverändert, dazu 12 Aliaszellen (YSNG.VI 4, PDN.TO 4, PALAF 4); die Board-Wirkung bleibt gleich.

## BDC-Handtabelle: 13 Fonds (Nachtrag 01.10.2026, Prüfrunde 2)

Bei Business Development Companies und dem geschlossenen Fonds OXLC ist die Quartalsumsatzreihe des Anbieters falsch; das Board zeigte deshalb falsches Umsatzwachstum. Die Handtabelle enthält 62 weitere Zellen: zwölf Fonds mit je fünf Quartalen und zwei OXLC-Zellen. Jeder SEC-Wert ist gegen die wörtliche Zeile „Total investment income“ der zitierten Einreichung geprüft (KBDC, OBDC, OTF, TSLX und PSEC schreiben „Total Investment Income“); Quartale ohne eigenen Dreimonatswert sind Jahreswert minus neun Monate, beide Operanden mit eigener Periode in der Quelle. OXLC: Mitteilungen des Fonds, gegen die N-CSR- und N-CSRS-Summen gegengerechnet. Für die zwölf SEC-Fonds gilt `coversThrough` 30.06.2026; jedes neuere Anbieterquartal bleibt leer, bis es geprüft ist. Zweitnotierungen derselben Emittenten gibt es im Universum nicht (gesucht über Namen und identische Quartalswerte in allen 16.118 Ständen; die Anleihe-Ticker OXLCG, OXLCI, OXLCL und OXLCZ stehen nur in der Watchlist, ohne Datenstand), deshalb keine `listingAliases`.

Abgleich mit dem gespeicherten Stand: Alle 62 `expectedBadValue` sind gleich dem Anbieterwert im CI-Artefakt `snapshots` von Lauf 36690140002 (30.09.2026, Eingang der Boards vom 30.09.). Ändert der Anbieter später einen Wert, greift die bestehende Regel `vendor-value-changed` (Zelle leer, Warnung); es wird nichts geschätzt.

OTF und KBDC gesperrt (Prüfrunde 2): Bei beiden ist zusätzlich die Jahresumsatzreihe des Anbieters falsch, und die Handtabelle kann Jahreswerte nicht korrigieren. OTF: Jahresumsatz laut SEC 2025 1.145,4 Mio. USD, 2024 684,0 Mio.; der Anbieter führt 779,3 / 353,5 / 391,9 / 50,0 Mio. ohne Datum, das passt zu keinem Geschäftsjahr. Die Kennzahl der Board-Zeile (Umsatzwachstum aus der Jahresreihe) hätte +120,5 % statt +67,5 % gezeigt. KBDC: laut SEC 2025 235,8 Mio. USD, 2024 213,1 Mio.; beim Anbieter 102,1 und 123,8 Mio. (das Anbieterpaket führt die SEC-Werte selbst als Konflikt in `annualIncomeConflicts`). Die Beschleunigungsachse fällt bei fünf Quartalen auf die Jahresreihe zurück und trägt 61 % des KBDC-Scores (Gewicht 2,7 von 4,4). Beide Fonds stehen deshalb in `quarantines` mit sichtbarem Grund („Score fehlt: …“), Fingerabdruck auf Jahresumsatz und Jahresüberschuss desselben Jahres. Weicht ein Wert ab, bleibt die Sperre bestehen und der Lauf warnt (`quarantine-fingerprint-changed`), bis ein Mensch neu geprüft hat. Die geprüften Quartalszellen bleiben in der Tabelle und werden weiter korrigiert, für den Tag, an dem die Jahresreihe stimmt. Wie bei Banpu zeigt die Ausschlussliste für gesperrte Zeilen weder Sektor, Branche, Marktwert noch Wachstum. KBDC verlässt damit das Board (bisher 27,6 bei −51,2 %), OTF kommt nicht darauf.

Währungsregel (für KBDC, wirksam sobald die Sperre fällt): Der Anbieter liefert für KBDC keine Berichtswährung (`ccyAmbiguous`); der Abruf setzt dann die Handelswährung USD ein. Bisher galt jede solche Zeile als „Kontext geändert“, alle fünf geprüften Zellen wären leer geblieben. Neu wird eine solche Zeile als USD behandelt, wenn der Anbieter die Firma in den USA führt (`country`), sie an einer US-Börse (NYSE, NYSE American, NYSE Arca, Nasdaq GS/GM/CM, Cboe US) in USD gehandelt wird und die Handelswährung ausdrücklich nicht geraten ist. Das beweist keine USD-Abschlüsse; deshalb greift ein Fall dort nur mit eigener geprüfter Währung USD und nur in einer Reihe mit `coversThrough`. Dann ist jedes gezeigte Quartal dieser Reihe ein Emittentenwert (andere Reihen wie der Jahresumsatz bleiben Anbieterdaten). Eine Firma außerhalb der USA, eine USD-Notierung an der LSE, OTC, eine geratene oder fehlende Angabe zur Handelswährung, jede andere Währung und jede Reihe ohne `coversThrough` bleiben leer (`context-changed`). Mit der bisherigen Tabelle ändert diese Regel auf allen 16.118 Ständen keine Zelle.

OXLC (Oxford Lane Capital): Der jüngste Anbieterwert (Quartal bis 31.03.2026) ist 0, das Board zeigte −100 %. Die Quartalsmitteilung des Fonds nennt „approximately $94.0 million“, also auf 0,1 Mio. gerundet (rechnerisch aus N-CSR minus N-CSRS minus Vorquartal: 93,95 bis 93,98 Mio.); Wachstum −22,4 %, das wegen der Rundung in der letzten Stelle um 0,1 Punkte abweichen kann. Die Quartale bis 30.06.2025 und 31.03.2025 stimmen mit dem Fonds überein (124,0 und 121,2 Mio.) und bleiben stehen. Die gespeicherte Null zum 30.09.2024 ist ebenfalls falsch: die Mitteilung vom 01.11.2024 nennt „approximately $105.1 million“, der Halbjahresbericht (N-CSRS, sechs Monate bis 30.09.2024) 194,9 Mio. Sie wird leer gesetzt, nicht geschätzt. Stand zweite Tabelle (01.10.2026, Abschnitt „Zweite Tabelle vom 01.10.2026“): OXLC hat jetzt `coversThrough` 31.03.2026; die Quartale bis 30.06.2025 und 31.03.2025 stehen als bestätigte Zellen in der Tabelle (Anbieterwert gleich Ersatzwert, belegt durch die Mitteilungen des Fonds), das frühere Kennzeichen `singleFalseValue` ist samt Prüfregel und Tests entfernt. Ein neues Anbieterquartal wird damit leer gesetzt (`period-after-coverage`), auch eine erneute falsche Null; ebenso eine verschobene Periode (`period-not-verified`). Das Wachstum fällt dann auf den Jahresumsatz des Anbieters zurück (464,1 Mio., gleich dem N-CSR-Wert 464.064.404).

Fünf Fonds kommen neu auf das Financials-Board: OBDC, GBDC, TSLX, MSDL und PSEC waren mit „non-operating-rev“ ausgeschlossen, weil die Regel für Nicht-Betriebsvehikel in `src/scoring/router.js` (Asset Management mit negativem Quartalsumsatz) die negativen Anbieterquartale sah. Mit den SEC-Werten sind alle Quartale positiv. Das ist gewollt und gleich behandelt wie FSK am 29.09.; ihre Kennzahl aus der Jahresreihe stimmt mit der SEC überein (Zahlen-Prüfbericht 01.10.). OTF wäre der sechste, ist aber gesperrt. In der Quality-Familie bleiben alle 13 ausgeschlossen; bei OBDC, OTF, GBDC, TSLX, MSDL und PSEC lautet der Grund jetzt „qc-sector-unsupported“ wie bei den übrigen BDCs. PSEC zeigte bisher ein richtiges Jahreswachstum (−11,1 %, weil das Vorjahresquartal beim Anbieter −179,9 Mio. war); jetzt ist das Quartalsbein bildbar und zeigt −6,7 % (April bis Juni 2026 gegen Vorjahr).

Wachstum / Score / Rang im vollen Financials-Board, Spur profitabel (veröffentlicht 427 Zeilen, nach #398 428, mit dieser Tabelle 432). Gleicher Datenstand (Lauf 36690140002, Watchlist 8bbe9d9133, 16.097 zugelassene Stände), Live-Kalibrierung wie im Produktionslauf:

| Ticker | veröffentlicht 30.09. | main mit #398 | mit BDC-Tabelle |
| --- | --- | --- | --- |
| BXSL | −84,3 % / 34,2 / 374 | −84,3 % / 34,1 / 378 | −7,1 % / 35,6 / 367 |
| MAIN | 22,8 % / 49,7 / 222 | 22,8 % / 49,6 / 221 | 3,9 % / 42,6 / 308 |
| TRIN | 4,8 % / 40,1 / 322 | 4,8 % / 39,9 / 324 | 25,5 % / 48,6 / 238 |
| CSWC | −14,9 % / 41,6 / 310 | −14,9 % / 41,5 / 310 | 9,1 % / 46,5 / 261 |
| BBDC | −8,0 % / 44,4 / 290 | −8,0 % / 44,3 / 290 | −12,4 % / 43,7 / 298 |
| OXLC | −100,0 % / 29,3 / 402 | −100,0 % / 29,2 / 403 | −22,4 % / 29,7 / 404 |
| OBDC | ausgeschlossen (non-operating-rev), −43,9 % | ausgeschlossen (non-operating-rev), −43,9 % | −17,4 % / 50,3 / 211 |
| GBDC | ausgeschlossen (non-operating-rev), −31,9 % | ausgeschlossen (non-operating-rev), −31,9 % | −14,0 % / 42,8 / 304 |
| TSLX | ausgeschlossen (non-operating-rev), −27,8 % | ausgeschlossen (non-operating-rev), −27,8 % | −14,9 % / 32,9 / 384 |
| MSDL | ausgeschlossen (non-operating-rev), −71,8 % | ausgeschlossen (non-operating-rev), −71,8 % | −10,8 % / 32,2 / 390 |
| PSEC | ausgeschlossen (non-operating-rev), −11,1 % | ausgeschlossen (non-operating-rev), −11,1 % | −6,7 % / 49,2 / 228 |
| KBDC | −51,2 % / 27,7 / 406 | −51,2 % / 27,6 / 407 | gesperrt (data-suspect), Grund sichtbar |
| OTF | ausgeschlossen (non-operating-rev), −21,4 % | ausgeschlossen (non-operating-rev), −21,4 % | gesperrt (data-suspect), Grund sichtbar |

Keine der 13 Zeilen steht vorher oder nachher in den Top 100.

Indirekte Wirkung über die Live-Kalibrierung (Growth): 320 Scores ohne eigene Datenänderung bewegen sich, 270 um ±0,1, 46 um ±0,2, zwei um ±0,3, einer um +0,4 und einer um −1,2. Nach Board: Financials 280, Health Care 12, Industrials 6, Materials 5, Real Estate 5, Consumer Discretionary 4, Tech Hardware 4, Semiconductors 2, IT Services 1, Energy 1. 79 dieser Zeilen stehen vor oder nach der Änderung in den Top 100 eines Boards; keine Zeile wechselt in die Top 100 hinein oder heraus (HKB.SI rückt im Financials-Board von Rang 99 auf 100). Ursache: Die falschen Extremwerte der BDCs (bis −100 %) fallen aus den universumsweit gelernten Grenzen; die untere Wachstumsgrenze (p1) steigt von −49,2 % auf −48,5 %, dazu verschieben sich die Quartalsgrenzen und die Kohortenbasen. Der größte Ausschlag, 300723.SZ (Health Care, 12,8 → 11,6), hat −48,6 % Wachstum und liegt genau zwischen alter und neuer Grenze; er wird jetzt auf die Grenze gekappt und steht dort mit 21 anderen Werten gleichauf (nachgestellt im Zahlen-Prüfbericht vom 01.10.). Quality: keine Änderung. Smallcap: keiner der 13 steht in der Smallcap-Watchlist.

Nächstes Anbieterquartal: Sobald der Anbieter das Quartal bis 30.09.2026 führt, setzt die Tabelle es in jeder Reihe mit `coversThrough` leer (`period-after-coverage`, zählt als stale, `::warning::`), und das Wachstum fällt auf das Jahresbein des Anbieters zurück. Nachgestellt auf den Ständen vom 30.09. (Fenster um ein Quartal verschoben), heute → danach: HTGC 8,5 → 7,9 %, ARCC 3,1 → 2,1 %, FSK −27,1 → −11,7 %, BXSL −7,1 → 6,9 %, MAIN 3,9 → 4,7 %, TRIN 25,5 → 23,5 %, CSWC 9,1 → 13,5 %, BBDC −12,4 → −2,4 %, OBDC −17,4 → 15,9 %, GBDC −14,0 → 20,2 %, TSLX −14,9 → −6,9 %, MSDL −10,8 → −4,5 %, PSEC −6,7 → −11,1 %. Für diese Fonds stimmt die Jahresreihe des Anbieters mit der SEC überein (geprüft für die neuen Fonds außer KBDC und OTF sowie für FSK im Zahlen-Prüfbericht vom 01.10., für ARCC über die Quelle des Falls 31.12.2025; HTGC ist nicht gegen einen SEC-Jahreswert geprüft). Es ist dann ein richtiger Jahreswert, nur eine andere Größe als das Quartalswachstum. KBDC (−17,5 %) und OTF (+120,5 %) hätten falsche Werte gezeigt; beide sind gesperrt.

Folgeauftrag, datiert 27.10.2026, zuständig: der tägliche Lauf. Ab der ersten Einreichung (ARCC 27.10.2026) sind die Quartalszellen bis 30.09.2026 für alle 15 Reihen mit `coversThrough` gegen die SEC zu prüfen und einzutragen, bevor der Anbieter das Quartal führt. Weitere Termine laut `earnings-calendar.json`: HTGC 29.10., FSK, OBDC und OTF 04.11., MAIN, BBDC, MSDL und PSEC 05.11., GBDC 17.11.; für BXSL, KBDC, TSLX, CSWC und TRIN steht dort kein neuer Termin. Solange eine dieser Zellen fehlt und der Lauf `period-after-coverage` meldet, ist das eine Rotstelle im Tagesstatus.

Nachlauf mit `scripts/financial-corrections-replay.js` auf denselben 16.118 Ständen (gespeicherte Kalibrierung 30.09., Watchlist 8bbe9d9133, Veröffentlichung 485d17ca38): 110 Zellen (die 48 bisherigen und 62 neue), 0 stale, drei Sperren (Banpu, OTF, KBDC); alle Dateihashes vorher und nachher gleich. Ausgangsabgleich zur Veröffentlichung: Growth 2 Abweichungen um 0,1 (CHWY, NEXA), Quality 0, Rule of 40 0; Smallcap ist wie unten beschrieben nicht nachbaubar. Die Prüfsuite `tests/financial-known-cases.test.js` hat jetzt 117 Prüfblöcke und 123 absichtliche Fehler; neu sind die Wächter für die Währungsregel (Anwesenheit nach Umrechnung und zum Abrufzeitpunkt, zwölf Abwesenheitsfälle einschließlich Abdeckung je Feld), für `singleFalseValue` (nur mit Ersatzwert, genau einmal je Reihe) und für die Sperren von OTF und KBDC (Anwesenheit, Fingerabdruck-Drift, Jahreswechsel, Abwesenheit unter anderem Ticker).

| Ticker | Periode | Feld | Währung | Alt | Neu |
| --- | --- | --- | --- | --- | --- |
| BXSL | 2026-06-30 | revenueQ | USD | 26707000 | 320469000 |
| BXSL | 2026-03-31 | revenueQ | USD | 40519000 | 325471000 |
| BXSL | 2025-12-31 | revenueQ | USD | 126133000 | 357829000 |
| BXSL | 2025-09-30 | revenueQ | USD | 148049000 | 358557000 |
| BXSL | 2025-06-30 | revenueQ | USD | 170052000 | 344803000 |
| MAIN | 2026-06-30 | revenueQ | USD | 177983000 | 149572000 |
| MAIN | 2026-03-31 | revenueQ | USD | 73437000 | 140106000 |
| MAIN | 2025-12-31 | revenueQ | USD | 156172000 | 145541000 |
| MAIN | 2025-09-30 | revenueQ | USD | 151233000 | 139831000 |
| MAIN | 2025-06-30 | revenueQ | USD | 144923000 | 143973000 |
| TRIN | 2026-06-30 | revenueQ | USD | 60812000 | 87170000 |
| TRIN | 2026-03-31 | revenueQ | USD | 51369000 | 90129000 |
| TRIN | 2025-12-31 | revenueQ | USD | 58885000 | 83235000 |
| TRIN | 2025-09-30 | revenueQ | USD | 45248000 | 75550000 |
| TRIN | 2025-06-30 | revenueQ | USD | 58049000 | 69483000 |
| CSWC | 2026-06-30 | revenueQ | USD | 32691000 | 61048000 |
| CSWC | 2026-03-31 | revenueQ | USD | 32639000 | 57766000 |
| CSWC | 2025-12-31 | revenueQ | USD | 43887000 | 61447000 |
| CSWC | 2025-09-30 | revenueQ | USD | 36379000 | 56945000 |
| CSWC | 2025-06-30 | revenueQ | USD | 38436000 | 55947000 |
| BBDC | 2026-06-30 | revenueQ | USD | 21762000 | 65202000 |
| BBDC | 2026-03-31 | revenueQ | USD | 22706000 | 60566000 |
| BBDC | 2025-12-31 | revenueQ | USD | 28503000 | 67969000 |
| BBDC | 2025-09-30 | revenueQ | USD | 26784000 | 72404000 |
| BBDC | 2025-06-30 | revenueQ | USD | 23661000 | 74398000 |
| OXLC | 2026-03-31 | revenueQ | USD | 0 | 94000000 |
| OXLC | 2024-09-30 | revenueQ | USD | 0 | fehlt |
| KBDC | 2026-06-30 | revenueQ | USD | 12933000 | 55703000 |
| KBDC | 2026-03-31 | revenueQ | USD | 19789000 | 57325000 |
| KBDC | 2025-12-31 | revenueQ | USD | 25028000 | 61903000 |
| KBDC | 2025-09-30 | revenueQ | USD | 27139000 | 61373000 |
| KBDC | 2025-06-30 | revenueQ | USD | 26503000 | 57298000 |
| OBDC | 2026-06-30 | revenueQ | USD | 89075000 | 401342000 |
| OBDC | 2026-03-31 | revenueQ | USD | -2098000 | 396774000 |
| OBDC | 2025-12-31 | revenueQ | USD | 136215000 | 447750000 |
| OBDC | 2025-09-30 | revenueQ | USD | 151611000 | 453065000 |
| OBDC | 2025-06-30 | revenueQ | USD | 158831000 | 485843000 |
| OTF | 2026-06-30 | revenueQ | USD | 169321000 | 338032000 |
| OTF | 2026-03-31 | revenueQ | USD | -204389000 | 325940000 |
| OTF | 2025-12-31 | revenueQ | USD | 223752000 | 320575000 |
| OTF | 2025-06-30 | revenueQ | USD | 215435000 | 319467000 |
| OTF | 2025-03-31 | revenueQ | USD | 90923000 | 182817000 |
| GBDC | 2026-06-30 | revenueQ | USD | 65103000 | 187730000 |
| GBDC | 2026-03-31 | revenueQ | USD | -39283000 | 188134000 |
| GBDC | 2025-12-31 | revenueQ | USD | 73216000 | 207007000 |
| GBDC | 2025-09-30 | revenueQ | USD | 104356000 | 217841000 |
| GBDC | 2025-06-30 | revenueQ | USD | 95606000 | 218344000 |
| TSLX | 2026-06-30 | revenueQ | USD | 51447000 | 97844000 |
| TSLX | 2026-03-31 | revenueQ | USD | -17408000 | 93397000 |
| TSLX | 2025-12-31 | revenueQ | USD | 40847000 | 108247000 |
| TSLX | 2025-09-30 | revenueQ | USD | 57258000 | 109444000 |
| TSLX | 2025-06-30 | revenueQ | USD | 71228000 | 115015000 |
| MSDL | 2026-06-30 | revenueQ | USD | 10824000 | 88774000 |
| MSDL | 2026-03-31 | revenueQ | USD | -1851000 | 89064000 |
| MSDL | 2025-12-31 | revenueQ | USD | 32692000 | 96597000 |
| MSDL | 2025-09-30 | revenueQ | USD | 30781000 | 99722000 |
| MSDL | 2025-06-30 | revenueQ | USD | 38337000 | 99508000 |
| PSEC | 2026-06-30 | revenueQ | USD | 5946000 | 155761000 |
| PSEC | 2026-03-31 | revenueQ | USD | 66680000 | 150067000 |
| PSEC | 2025-12-31 | revenueQ | USD | 28921000 | 176002000 |
| PSEC | 2025-09-30 | revenueQ | USD | 91943000 | 157624000 |
| PSEC | 2025-06-30 | revenueQ | USD | -179931000 | 166946000 |

## Zweite Tabelle vom 01.10.2026: Sperren, bestätigte Zellen, Firmenreihen

Anlass: Die SEC-Doppelprüfung von 34 Firmen (01.10.) und die Einordnung der Wert-Tor-Meldungen fanden falsche Zahlen auf oder hinter den Boards. Jeder neu eingetragene Wert ist vom Erbauer am 01.10. selbst an der Primärquelle nachgelesen (wörtliche Zeile, Einheit, Währung, Periodenende); jeder `expectedBadValue` ist gleich dem Anbieterwert im CI-Artefakt `snapshots` von Lauf 36690140002 (30.09.2026). Datenstand aller Zahlen dieses Abschnitts: dieser Lauf, Watchlist 8bbe9d9133, Live-Kalibrierung wie im Produktionslauf, Code origin/main d90e04b259 gegen diesen Stand.

**Sperren (`quarantines`, Grund sichtbar, Fingerabdruck wie bei Banpu, OTF und KBDC):**

| Ticker | Grund | Fingerabdruck | Board vorher (origin/main) |
| --- | --- | --- | --- |
| HOS | Der Ticker gehört seit 01.09.2026 zur umbenannten Helix Energy Solutions (SEC-Nr. 866829, 8-K vom 04.09.2026); der Anbieter liefert noch die Zahlen der früheren Hornbeck Offshore (SEC-Nr. 1131227) von 2018/2019: Jahresumsatz 212.404 / 191.412 / 224.299 / 476.070 Tsd. USD wörtlich wie im 10-K 2018 („Revenues $ 212,404 $ 191,412 $ 224,299 $ 476,070 $ 634,793“). | Jahresumsatz 2018 212.404.000 und Jahresüberschuss −119.123.000 (gleicher Jahresindex, Jahresende 31.12.2018) | Industrie, unprofitabel, Rang 54, Score 59,2, Wachstum 11,0 % |
| TYG | Die Abschlusszahlen des Anbieters enden mit dem Geschäftsjahr bis 30.11.2017 (Gesamtanlageertrag laut N-CSR 2017 1.956.784 USD, Anbieter 1.956.780); das Wachstum −98,9 % ist kein aktueller Wert. Jüngster Abschluss (bis 30.11.2025): 24.889.525 USD. | Jahresumsatz 1.956.780 und Jahresergebnis −113.427.640 (Jahresende 30.11.2017) | Financials, profitabel, Rang 409, Score 28,0, Wachstum −98,9 % |
| OLPX | Seit 07.07.2026 nach einer Übernahme nicht mehr börsennotiert (8-K vom 07.07.2026, Item 3.01; Formular 25-NSE am selben Tag, 15-12G am 17.07.); alle Quartals-Bruttogewinne stehen beim Anbieter auf 0 (10-Q Q1 2026: „Gross profit 71,660 67,356“ Tsd. USD). | Quartalsumsatz 31.03.2026 99.369.000 und Bruttogewinn desselben Quartals 0 | Zykl. Konsum, unprofitabel, Rang 47, Score 49,9 |

Weicht ein Anker ab (etwa nach dem nächsten vollen Abruf von HOS, für den der Anbieter einen Umsatz 2025 von 0 meldet), bleibt die Sperre bestehen, und der Lauf warnt (`quarantine-fingerprint-changed`), bis ein Mensch neu prüft. Alle drei verlassen jedes Growth-Board; in der Ausschlussliste stehen sie mit `data-suspect`, sichtbarem Grund und ohne Sektor, Branche, Marktwert und Wachstum; das Rule-of-40-Board schließt sie über dieselbe Prüfung aus. In der Quality-Familie waren alle drei schon vorher ausgeschlossen (`qc-not-compounder` bzw. `qc-sector-unsupported`). Zweitnotierungen gibt es im Universum nicht (gesucht über identische Quartals- und Jahresumsätze und den Namen in allen 16.114 Ständen; einziger Treffer ist ein zufällig gleicher Jahresumsatz von INFQ und Almonty, kein Alias).

**Bestätigte Zellen statt `singleFalseValue`:** Ein Fall mit `expectedBadValue` gleich `replacementValue` ist eine bestätigte Zelle: Der Anbieterwert stimmt mit der Primärquelle überein und bleibt Byte für Byte stehen (kein Korrekturvermerk, kein sichtbarer Grund); weicht der Anbieter später ab, wird die Zelle leer (`vendor-value-changed`). Wie jeder Fall mit einem Wert gibt sie der Tabelle die Hoheit über die ganze Reihe und verlangt deshalb `coversThrough`. Ihr Grund beginnt mit „… bestätigt:“; sind beide Werte gleich, der Grund aber „korrigiert“ (etwa ein versehentlich kopierter Anbieterwert), oder umgekehrt, lehnt die Prüfung die ganze Tabelle ab. Das frühere Kennzeichen `singleFalseValue` ist mit seiner Prüfregel und seinen Tests entfernt (weniger Code, gleicher Schutz): OXLC hat jetzt `coversThrough` 31.03.2026 und die bestätigten Zellen 30.06.2025 (124.000.000; Mitteilung vom 23.07.2025 „approximately $124.0 million“) und 31.03.2025 (121.161.000; Mitteilung vom 19.05.2025 „approximately $121.2 million“, gegengerechnet mit N-CSR 430.539.101 minus N-CSRS 194.878.203). Nachweis am echten OXLC-Paket: heute unverändert (94,0 / 124,0 / 121,161 Mio. / leer, Wachstum −22,4 %, 0 stale); die alte Tabelle mit nur dieser OXLC-Umstellung ergibt unter dem neuen Lader auf allen 16.114 Ständen 0 abweichende Ergebnisse. Ein nachgestelltes nächstes Anbieterquartal 30.06.2026 = 0 zeigte bisher −100,0 %, jetzt bleibt es leer (`period-after-coverage`, Warnung) und das Wachstum fällt auf den Jahresumsatz zurück (+7,8 %, gleich dem N-CSR-Wert).

**Firmenreihen mit `coversThrough` 30.06.2026 (Umsatz und Bruttogewinn je Firma):** CARG, PLUS, DCO, INFQ (SEC) und SLC Agrícola (SLCE3.SA, BRL). Jedes gespeicherte Quartal ist ein Emittentenwert: ersetzt, wo der Anbieter abweicht, sonst bestätigte Zelle (von beiden Prüfern der Doppelprüfung oder dem Schiedsprüfer bestätigt und vom Erbauer nachgelesen). Ursachen: CARG hat 2025 nach dem Verkauf von CarOffer rückwirkend umgestellt (10-K 2025, Note 16), DCO hat das Jahr 2025 neu ausgewiesen (10-K/A vom 08.05.2026, Note 18), INFQ hat frühere Perioden berichtigt (10-Q Q2 2026, „Correction of Immaterial Errors“; die Quartale 31.03.2025 und 30.09.2025 sind Differenzen zweier dort ausgewiesener Werte), bei PLUS ist das vierte Geschäftsquartal (bis 31.03.2026) laut Ergebnismitteilung 576.174 statt Jahreswert minus erstmals berichteter neun Monate. SLC: Der Anbieter zählt in drei Quartalen die Neubewertung der Ernte („Var. do Valor Justo dos Ativos Biológicos“) zum Umsatz und führt für die Quartale 30.06.2026 und 30.06.2025 Umsatz- und Bruttogewinnwerte, die zu keiner Zeile passen; eingetragen sind „Receita Operacional Líquida“ und „Resultado Bruto“ der Ergebnismitteilungen (Anhang 3). Damit gilt die Marge der Firma selbst (2T26: 43,3 %).

**Einzelne falsche Werte, leer gesetzt (keine Schätzung, keine `coversThrough`):** VCTR Bruttogewinn 31.12.2025 (Anbieter 43,9 Mio. USD; die Firma weist keinen Bruttogewinn aus, und der Wert liegt unter dem Betriebsergebnis des Quartals von 153,2 Mio. = 478.423 − 325.248 Tsd.). Celesc (CLSC3.SA) Bruttogewinn 30.06.2025 (Anbieter 152,1 Mio. BRL; ITR 2T25 Seite 23 „Lucro Bruto 513.396“). Für VCTR wäre ein abgeleiteter Wert keine eingereichte Zahl; deshalb leer.

Jede aktive Zelländerung dieser Tabelle (25 Zellen: 23 ersetzt, 2 leer gesetzt; Beträge in Originalwährung, volle Einheiten; die übrigen 29 neuen Fälle sind bestätigte Zellen ohne Änderung):

| Ticker | Periode | Feld | Währung | Alt | Neu |
| --- | --- | --- | --- | --- | --- |
| CARG | 2025-12-31 | revenueQ | USD | 209093000 | 241094000 |
| CARG | 2025-09-30 | revenueQ | USD | 238696000 | 231653000 |
| CARG | 2025-12-31 | grossProfitQ | USD | 223892000 | 222593000 |
| CARG | 2025-09-30 | grossProfitQ | USD | 213532000 | 214707000 |
| PLUS | 2026-03-31 | revenueQ | USD | 581634000 | 576174000 |
| PLUS | 2026-03-31 | grossProfitQ | USD | 147087000 | 141627000 |
| DCO | 2025-12-31 | revenueQ | USD | 215798000 | 217133000 |
| DCO | 2025-09-30 | revenueQ | USD | 212558000 | 214422000 |
| DCO | 2025-12-31 | grossProfitQ | USD | 59805000 | 59238000 |
| DCO | 2025-09-30 | grossProfitQ | USD | 56475000 | 58950000 |
| INFQ | 2026-03-31 | revenueQ | USD | 9461000 | 9907000 |
| INFQ | 2025-09-30 | revenueQ | USD | 8202000 | 7311000 |
| INFQ | 2025-03-31 | revenueQ | USD | 8303000 | 8195000 |
| INFQ | 2026-03-31 | grossProfitQ | USD | 1991000 | 2535000 |
| INFQ | 2025-09-30 | grossProfitQ | USD | 3863000 | 3700000 |
| INFQ | 2025-03-31 | grossProfitQ | USD | 3377000 | 3543000 |
| SLCE3.SA | 2026-06-30 | revenueQ | BRL | 4703662000 | 2175612000 |
| SLCE3.SA | 2026-03-31 | revenueQ | BRL | 2665069000 | 2267501000 |
| SLCE3.SA | 2025-12-31 | revenueQ | BRL | 2290647000 | 2272265000 |
| SLCE3.SA | 2025-09-30 | revenueQ | BRL | 2379036000 | 2087705000 |
| SLCE3.SA | 2025-06-30 | revenueQ | BRL | 4043394000 | 1862135000 |
| SLCE3.SA | 2026-06-30 | grossProfitQ | BRL | 2879220000 | 941202000 |
| SLCE3.SA | 2025-06-30 | grossProfitQ | BRL | 2444562000 | 656027000 |
| VCTR | 2025-12-31 | grossProfitQ | USD | 43903000 | fehlt |
| CLSC3.SA | 2025-06-30 | grossProfitQ | BRL | 152109000 | fehlt |

Wachstum, Bruttomarge, Score und Rang (Growth-Board, origin/main → diese Tabelle). Das Wachstumspaar (jüngstes Quartal gegen Vorjahresquartal) bleibt bei allen Firmen bildbar und besteht jetzt aus Emittentenwerten:

| Ticker | Board (Spur) | Wachstum | Bruttomarge jüngstes Quartal | Bruttomarge vier Quartale | Score | Rang |
| --- | --- | --- | --- | --- | --- | --- |
| CARG | Software/Komm. (profitabel) | 13,1 % → 13,1 % | 92,1 % → 92,1 % | 94,8 % → 92,3 % | 65,1 → 65,1 | 99 → 99 |
| PLUS | Software/Komm. (unprofitabel) | 1,0 % → 1,0 % | 23,3 % → 23,3 % | 25,2 % → 25,1 % | 63,6 → 63,6 | 25 → 25 |
| DCO | Industrie (unprofitabel) | 11,8 % → 11,8 % | 28,0 % → 28,0 % | 27,3 % → 27,4 % | 55,5 → 55,5 | 68 → 67 |
| INFQ | Software/Komm. (unprofitabel) | 156,5 % → 156,5 % | 16,0 % → 16,0 % | 23,8 % → 25,2 % | 81,0 → 81,0 | 3 → 3 |
| SLCE3.SA | Basiskonsum (profitabel) | 16,3 % → 16,8 % | 61,2 % → 43,3 % | 41,7 % → 35,0 % | 81,6 → 82,0 | 27 → 25 |
| VCTR | Financials (profitabel) | 24,0 % → 24,0 % | 75,2 % → 75,2 % | 58,4 % → fehlt | 67,5 → 67,5 | 58 → 58 |
| CLSC3.SA | Versorger (profitabel) | 2,6 % → 2,6 % | 7,7 % → 7,7 % | 9,2 % → 9,2 % | 53,6 → 53,6 | 161 → 161 |
| OXLC | Financials (profitabel) | −22,4 % → −22,4 % | – | – | 29,7 → 29,6 | 404 → 404 |
| HOS, TYG, OLPX | siehe Sperren | – | – | – | gesperrt | – |

SLC Agrícola: Der Sprung von rund 50 auf 81,6 Punkte am 29.09. kommt nicht von den falschen Zellen: Mit den Werten der Firma bleibt der Score bei 82,0 (Wachstum +16,8 %, so auch die Firma: „crescimento de 16,8%“). Im Stand davor war 1T26 das jüngste Quartal (−6,0 % gegen 1T25 auf Anbieterbasis); am 29.09. kam 2T26 hinzu.

Indirekte Wirkung über die Live-Kalibrierung (Growth): 512 Scores ohne eigene Datenänderung bewegen sich (358 um −0,1, 99 um +0,1, 32 um −0,2, 20 um +0,2, zwei um −0,3, einer um −0,4); nach Board: Financials 304 (profitabel, ohne TYG), Industrie 116 (fast alle unprofitabel, ohne HOS), zykl. Konsum 76 (fast alle unprofitabel, ohne OLPX), Basiskonsum 7, Health Care 3, Materials 2, Tech Hardware 2, Halbleiter 2. 182 dieser Zeilen stehen vor oder nach der Änderung in den Top 100. HOS (Industrie, Rang 54) und OLPX (zykl. Konsum, Rang 47) verlassen ihre Top 100; dafür rücken 600153.SS (Industrie, unprofitabel, Rang 101 → 98) und 601718.SS (zykl. Konsum, Rang 101 → 100) hinein. 134 weitere Zeilen ändern nur den Rang. Quality: eine Zeile (DAR −0,1), Rule of 40 und Smallcap nicht gesondert nachgerechnet.

Nachlauf mit `scripts/financial-corrections-replay.js --live` (neue Option: Growth live kalibriert) auf den 16.118 Ständen von Lauf 36690140002: 135 Zellen (110 bisherige, 25 neue), 0 stale, sechs Sperren, alle Dateihashes vorher und nachher gleich, alle übrigen Zeilen bytegleich.

Nächste Quartale: In jeder Reihe mit `coversThrough` bleibt ein neues Anbieterquartal leer, bis es geprüft und eingetragen ist (Warnung im Tageslauf). Zu prüfen, sobald die Firmen berichten: das Quartal bis 30.09.2026 für CARG, PLUS (10-Q laut Kalender am 09.11.2026), DCO, INFQ und SLC; für OXLC das Quartal bis 30.06.2026 (Fondsmitteilung liegt seit Juli 2026 vor, der Anbieter kann es jederzeit nachladen).

Nicht in dieser Tabelle (Folgeaufträge, je eine Zeile):
- Betriebsergebnis je Quartal (opIncQ): HIVE fünf Quartale, CARG zwei, PLUS eins, DCO zwei, INFQ drei. Die Handtabelle kennt nur Umsatz und Bruttogewinn; der vorhandene Mechanismus trägt es mit einer Erweiterung der Feldliste (`opIncQ`) samt `coversThrough` je Feld. (Nachtrag 02.10.: erledigt, dazu SLC Agrícola; Abschnitt „Betriebsergebnis je Quartal in der Handtabelle“.)
- Jahresumsatz: HL drei Jahre (Neuausweis nach dem Verkauf von Casa Berardi), INFQ Jahr 2025, SLC (Anbieterbasis inklusive Neubewertung der Ernte, 2025: 9.759,2 statt 8.553,1 Mio. BRL). Die Handtabelle kann keine Jahreszellen korrigieren; heute bleibt nur eine Sperre wie bei OTF und KBDC oder eine Erweiterung um Jahreszellen. (Nachtrag: INFQ ist mit leeren Jahreszellen erledigt, Abschnitt „Jahreszellen vom 01.10.2026“; HL und SLC bleiben offen. Nachtrag 02.10.: bei HL ist der Jahres-Bruttogewinn leer, der Umsatz bleibt; Abschnitt „HL: Jahres-Bruttogewinn leer“.)
- Börsenwert: ABTC (nach der Zusammenlegung 1:15: 1,06 statt 0,63 Mrd. USD), Andersen (nur Klasse A gezählt: 1,0 statt rund 6 Mrd.), Energisa (8,2 statt 4,5 bis 4,9 Mrd.), Yunji (nach der Teilung 1:10: 8,6 statt rund 0,7 Mrd.). Tragbar über die vorhandene Aktienzahl-Handtabelle (ADS/Aktienzahl, PR #379). (Nachtrag 02.10.: ABTC und Andersen erledigt, Energisa und Yunji offen; Abschnitt „Börsenwert-Handtabelle vom 02.10.2026“.)
- JBS: Börsenwert springt zwischen zwei Aktienzahlen; eine Zeile in derselben Aktienzahl-Handtabelle (776.086.920 Klasse A plus 294.842.267 Klasse B laut 10-Q-Deckblatt). (Nachtrag 02.10.: erledigt.)
- Gespeicherte SEC-Dateien (`external-data/sec-*`): COP (Umsatz-Tag 2025), DCO (10-K/A wird absichtlich übersprungen), INFQ (Betriebsergebnis 2025), HL (Neuausweis 2025), HOS (Helix). Sie speisen Zyklus-Dämpfer und `roicStability`, nicht das Wachstum; braucht eine Korrektur in `merge-sec-xbrl.js` oder eine eigene Tabelle.
- Dian Tou (002128.SZ), Quartal 31.12.2025: Umsatz −914,6 Mio. CNY und Bruttogewinn 562,0 Mio. CNY (laut Firma 3,13 Mrd.). Nicht eingetragen: Die gespeicherten Werte sind nach der Umrechnung keine exakten Vielfachen eines ganzzahligen CNY-Betrags (der Abgleich `expectedBadValue` verlangt exakte Gleichheit), und zwei leere Zellen würden das Quartalswachstum abschalten; braucht alle fünf Quartale aus den Berichten auf cninfo.
- Wisdom Marine (2637.TW): Die ganze Reihe steht in Taiwan-Dollar unter dem Kennzeichen USD (Q4 2025 5,42 Mrd. statt 163,8 Mio. USD); kein Einzelzellenfehler, gehört zur Währungskorrektur wie bei YPF und Vale.
- Bullish (BLSH), Bruttogewinn 30.06.2025: Die Firma weist keinen Bruttogewinn aus, alle Anbieterwerte sind Konstrukte (wie bei VCTR); Methodenfrage für Firmen ohne Bruttogewinn-Zeile.
- Celesc Umsatzbasis: Anbieter 2T25 2.715,9 Mio. BRL, Firma („Receita Operacional Líquida“) 2.899,5 Mio.; ungeklärt, ob der Anbieter die Bauerlöse herausrechnet; nicht geprüft.
- Offene Prüfnotiz aus PR #400 (Low 2): Ersatzwerte werden nicht maschinell gegen den `value` ihrer Quelle geprüft. (Nachtrag 02.10.: erledigt, die Prüfung lehnt einen Ersatzwert ab, der zu keinem Quellwert passt.)
- Nachtragen eines Quartals: Eine Zelle, die beim Abruf schon leer gesetzt wurde (etwa `period-after-coverage`), bleibt nach dem Eintragen ihres geprüften Werts leer und meldet `vendor-value-changed`, bis der nächste volle Abruf den Anbieterwert neu liefert (keine falsche Zahl, nur zu lange leer). Abhilfe im Lader: bei einer fremden Leer-Markierung mit dem gespeicherten ursprünglichen Anbieterwert vergleichen; eigener Auftrag.

## Jahreszellen vom 01.10.2026 (INFQ, CARG, OTF)

Problem: Die Handtabelle kannte nur Quartalswerte. Bei INFQ, CARG und OTF ist die Jahresreihe des Anbieters falsch und speist sichtbare Zahlen (Kennzahl der Zeile, Bruttogewinn-Wachstum, Rückfall des Wachstums, wenn ein Quartal leer ist).

Mechanismus (`lib/financial-known-cases.js`): Ein Fall mit `field` `annualRev` oder `annualGP`, `periodType` `12M`, `index` und `replacementValue: null` setzt genau eine Jahreszelle leer (Wert `null`, Kennzeichen `financialCorrection` mit Grund, nie 0). Ist die gespeicherte Reihe datiert, zählt das Geschäftsjahresende (`period`); ist sie undatiert, die Position (`index`) zusammen mit dem exakten Anbieterwert. Die Jahreszellen versagen geschlossen, wie die Quartale: Passt auch nur ein Fall einer Reihe (Ticker und Feld) nicht mehr, weil der Anbieter ein neues Jahr vorn einfügt, einen Wert neu ausweist oder umsortiert, weil die Währung nicht die geprüfte ist oder weil der Stand keine verlässliche Währungsangabe hat, werden alle vorhandenen Zellen dieser Reihe leer (Kennzeichen `financialMissing`, Code `annual-value-changed`, Grund im Klartext) und der Lauf warnt (stale, `::warning::`), bis ein Mensch die Reihe neu prüft. Eine falsche Zahl kommt so nie zurück, es bleibt höchstens eine leere Stelle mit Hinweis. Außerdem gibt es keine Lücken: Wird ein Jahr leer gesetzt, werden alle älteren vorhandenen Jahre derselben Reihe mit demselben Grund ebenfalls leer (Code `annual-older-than-withheld`, ohne Warnung). Ein Leser, der Lücken überspringt, kann so nie zwei nicht benachbarte Jahre vergleichen oder ein älteres Jahr als das aktuelle zeigen. Heute greift diese Regel nicht: INFQ und OTF sind ganz leer, bei CARG ist nur das älteste Jahr leer. Kein Ersatzwert, kein Einfügen von Jahren, kein `coversThrough` für Jahresreihen; die Prüfung lehnt das als Eingabefehler ab. Die Tabelle wirkt beim Abruf und bei jedem Einlesen (Scoring, Export, Rule of 40); ein Anbieterwert, der auf der Platte steht (etwa aus einem älteren Abruf), wird beim Einlesen wieder leer. Die Nachlade-Logik (`lib/reload-history.js`) schützt Handtabellen-Lücken nur in Quartalsreihen; für die heutigen Fälle ist das ohne Wirkung, weil alle drei Jahresreihen undatiert sind und undatierte Werte nie nachgeladen werden.

| Firma | Jahr (Position) | Feld | Anbieter | Primärquelle | Warum leer |
|---|---|---|---|---|---|
| INFQ | 2024 (0) | Umsatz | 28.836.000 | Erstmeldung; berichtigt 28.094.000 (10-Q Q2 2026, „Correction of Immaterial Errors“) | Reihe endet ein Jahr zu früh, 2025 fehlt (berichtigt 31.108.000) |
| INFQ | 2023 (1) | Umsatz | 10.950.000 | 10.950.000 (Prospekt 424B3 vom 23.01.2026) | sonst Wachstum 2024/2023 (+163,3 %) als aktuelles Jahr |
| INFQ | 2024 (0) | Bruttogewinn | 9.064.000 | berichtigt 7.086.000; 2025: 11.380.000 | wie oben |
| INFQ | 2023 (1) | Bruttogewinn | 4.436.000 | 4.436.000 (Prospekt) | wie oben |
| CARG | 2022 (3) | Umsatz | 1.655.035.000 | 10-K 2022 mit CarOffer; 2023–2025 im 10-K 2025 ohne CarOffer | zwei Basen in einer Reihe |
| CARG | 2022 (3) | Bruttogewinn | 657.553.000 | wie oben (Marge 2022 39,7 % gegen 92,8 % 2025) | wie oben |
| OTF | 2025–2022 (0–3) | Umsatz | 779,3 / 353,5 / 391,9 / 50,0 Mio. | SEC 1.145,4 / 684,0 / 683,8 / 494,8 Mio. USD | passt zu keinem Geschäftsjahr |

Was jeder Leser der Jahresreihe zeigt (echter Code, Stände von Lauf 36839128456), vorher → nachher:
- INFQ: Jahresbein des Wachstums +163,3 % → leer; Quartalswachstum +156,5 % unverändert; Kennzahl (Bruttogewinn-Wachstum) +104,3 % → leer mit Grund; Achse Bruttogewinn-Wachstum 0,952 → leer; Verwässerung (SBC je Umsatz) → leer; Kapitaleffizienz unverändert; Rule of 40 nicht betroffen (Quartalsbein trägt). Kommt das nächste Quartal und bleibt es leer, zeigt die Wachstumsspalte nichts statt +163,3 %.
- CARG: Jahresbein +13,65 % und Kennzahl +15,6 % unverändert (2025/2024); Bruttogewinn-Wachstum 0,687 → 0,173 (Margenpfad 2023→2025 statt 2022→2025: +1,6 statt +53,1 Punkte); Kapitaleffizienz 0,174 → 0,206 (Zyklus-Abschlag ohne 2022); Verwässerung −0,078 → −0,020; Beschleunigung unverändert.
- OTF: Jahresbein +120,5 % → leer; Umsatz-Kennzahl +120,5 % → leer mit Grund; Quartalswachstum +5,8 % und Beschleunigung aus geprüften Quartalen unverändert; im Export steht der Grund in `financialDataReasons`. Kommt das nächste Quartal und bleibt leer: Wachstum leer statt +120,5 %.

Wirkung auf die Boards (Live-Kalibrierung, Watchlist d90e04b259, 16.108 Stände): INFQ Software/unprofitabel 81,0 Rang 3 → 68,2 Rang 14; CARG Software/profitabel 65,2 Rang 99 → 61,5 Rang 124 (verlässt die Top 100, NTES rückt von 101 auf 100); Quality CARG 77,4 → 77,5 (Rang 23); OTF ausgeschlossen → auf dem Financials-Board (profitabel) mit 32,1 Punkten, aber ohne Rang, weil zu wenige Achsen belegt sind (3 von 7; Export: `"rank": null`, `"rankGrund": "zuWenigBelegteAchsen"`; intern Position 389). Indirekt: Growth 375 Zeilen (328 um +0,1, 16 um −0,1, 26 um +0,2, 5 um +0,3), Quality 96 Zeilen (höchstens 0,2), Smallcap 0; Rule of 40: 31 Zeilen nur im Score um 0,1, keine Rang- oder R40-Änderung, keine der Firmen steht darauf. Die alte Tabelle unter dem neuen Lader verändert 0 der 16.108 Stände. Nachlauf `financial-corrections-replay.js --live`: 145 Zellen (135 bisherige, 10 neue), 0 stale, fünf Sperren, alle Dateihashes vorher und nachher gleich.

KBDC bleibt gesperrt: Mit leeren Jahreszellen käme KBDC zurück, zeigte aber „0 Jahre profitabel, letzter Verlust 2025“. Die Gewinnserie liest das SEC-Betriebsergebnis −118,2 Mio. USD; das ist der negierte Nettoaufwand (10-K 2025: „118,207 83,834 76,187 Net Investment Income (Loss) 117,612“), KBDC war 2025 profitabel. Außerdem stünde der Score (42,6, Rang 307) auf 2 von 7 Achsen statt etwa 32,4 mit den SEC-Jahreswerten (Prüfbericht zu PR #400).

Grenzen: Rückt der Anbieter in einer undatierten Reihe ein neues Jahr nach vorn, passen Position und Wert nicht mehr; die Zellen bleiben dann unverändert und der Lauf warnt, bis neu geprüft ist (INFQ mit 2025 vorn zeigte 31,1/28,8 Mio. = +7,9 % statt berichtigt +10,7 %). Ein leer gesetztes mittleres Jahr würde Leser, die Lücken überspringen (Kennzahl, Beschleunigungs-Rückfall), nicht benachbarte Jahre paaren lassen; keiner der heutigen Fälle setzt ein mittleres Jahr leer.

## Börsenwert-Handtabelle vom 02.10.2026 (Aktienzahl)

Problem: Der Anbieter rechnet bei einigen US-Notierungen den Börsenwert mit einer falschen Aktienzahl. Der Börsenwert geht nicht in den Score ein, steht aber auf dem Board, bestimmt Größenband und Größenklasse und entscheidet über die Untergrenze des Tageslaufs (800 Mio. USD).

Mechanismus (`lib/ads-hand-table.js`, Tabelle `configs/share-count-hand-table.json`, an denselben zwei Schreibstellen in `pull-yahoo.js` wie die ADS-Tabelle, nach ihr): Jede Zeile trägt die Aktienzahl laut Emittent (`shares`, mit Quelle, wörtlichem Zitat und Stichtag) und die bekannten falschen Zahlen des Anbieters (`wrongShares`). Verglichen wird die Zahl, die der Anbieterwert selbst ergibt (Börsenwert geteilt durch Kurs), mit 3 % Toleranz:
- gleich der Emittentenzahl: bestätigt, der Stand bleibt Byte für Byte;
- gleich einer bekannten falschen Zahl: Börsenwert = Kurs × Emittentenzahl, Herkunft `hand-table:shares`, der Anbieterwert bleibt in `yahooValue`, die aus ihm abgeleiteten Anbieterfelder (Kurs-Umsatz-Verhältnis, Unternehmenswert und dessen Verhältnisse) werden leer, nie 0;
- alles andere: Anbieterwert bleibt, der Stand trägt `_shareCountHandTableStale` mit Grund, der Abruf warnt, der Schnellweg (nur Kurs) verweigert und überlässt den vollen Abruf der Prüfung. Eine falsche Korrektur entsteht so nie stillschweigend.
Nicht-USD-Notierungen passen nie (Kurs und Börsenwert stehen dort in verschiedenen Währungen) und bleiben unverändert mit Warnung.
Eine veraltete Zeile erscheint als `::warning::` in der Zusammenfassung des Tageslaufs, nicht nur im Protokoll. Neue Aktien sieht eine Zeile nicht von selbst; deshalb trägt jede Zeile `reviewBy`, den spätesten Termin der nächsten Quartalsmeldung (hier 16.11.2026). Liegt der Datentag des Börsenwerts danach, wird die Zeile weiter angewandt, der Lauf warnt aber jeden Tag mit `::warning::`, bis die Aktienzahl neu geprüft und `reviewBy` versetzt ist.

| Ticker | Emittentenzahl | Quelle (wörtlich) | Anbieter falsch | Board 01.10. vorher → nachher (fester Datentag, Lauf 36839128456) |
| --- | --- | --- | --- | --- |
| ABTC | 72.819.713 (Klasse A + B, 30.07.2026, nach der Zusammenlegung 1:15) | 10-Q Q2 2026: „As of July 30, 2026, the registrant had 24,004,726 shares of Class A common stock, 48,814,987 shares of Class B common stock, and no shares of Class C common stock outstanding“ | 121.819.713 | 1,033 → 0,618 Mrd. USD; liegt unter der Untergrenze von 800 Mio., der Abruf entfernt den Stand: ABTC verlässt das Financials-Board (unprofitabel, Score 53,0, Rang 12) und das Universum |
| ANDG | 112.887.382 (Klasse A + B; jede B-Aktie ist an eine in eine A-Aktie tauschbare Einheit gekoppelt) | 424B4 vom 20.08.2026: „Total Class A common stock and Class B common stock to be outstanding immediately after this offering 112,887,382 shares“ (10-Q-Deckblatt 05.08.: 13.613.285 + 99.375.168 = 112.988.453, 0,09 % Abstand) | 18.540.410 (nur Klasse A) | 1,009 → 6,141 Mrd. USD; Größenband micro → large, Klasse small → mid; Score 62,7 und Position 19 (ohne Rang, zu wenige Achsen) unverändert |
| JBS | 1.070.929.187 (Klasse A + B, 30.06.2026) | 10-Q Q2 2026: „As of June 30, 2026, there were 776,086,920 Class A common shares, par value of €0.01 per share, and 294,842,267 Class B common shares, par value of €0.10 per share, outstanding.“ | 3.289.363.700 (17.09. und 22.09.; an den übrigen Tagen richtig) | am festen Tag richtig (12,09 Mrd.): bestätigt, unverändert; ein Stand wie am 22.09. (39,57 Mrd.) wird zu 12,88 Mrd. |

HLX: Der alte Helix-Ticker wird seit dem Zusammenschluss mit Hornbeck Offshore nicht mehr gehandelt (8-K vom 04.09.2026: „Helix was renamed“, Handelssymbol HOS); Kurs und Börsenwert (1,56 Mrd.) stehen beim Anbieter seit 01.09. still. HLX ist deshalb wie HOS, TYG und OLPX gesperrt (`quarantines`, Fingerabdruck Jahresumsatz 2025 1.291.474.000 und Jahresüberschuss 30.827.000): verlässt das Energie-Board (profitabel, Score 34,0, Rang 281) und steht mit Grund und ohne Börsenwert in der Ausschlussliste. HOS steht dort schon seit #402 ohne Börsenwert.

Gesperrt statt berichtigt (Prüfrunde 2, 02.10.): Drei falsche Börsenwerte kann die Aktienzahl-Tabelle nicht tragen. Sie stehen wie HLX in `quarantines` (Fingerabdruck: die beiden Aktienzahlen des Anbieters `meta.sharesOutstanding` und `meta.impliedSharesOutstanding`; ändert der Anbieter sie, bleibt die Sperre und der Lauf warnt). Aufgehoben wird eine Sperre erst, wenn der Abruf den richtigen Wert selbst bilden kann (Yunji: Kurs nach der Teilung; Energisa: Kurs der Vorzugsaktie; Z98.DE: Aktienzahl-Abgleich auf Nicht-USD-Notierungen).
- Yunji (2670.HK): Der Kurs im Anbieter-Quote steht seit 22.09. auf dem Wert vor der Teilung 1:10 (97 HKD; Tagesschlusskurse danach 9,50 bis 6,01 HKD); die Aktienzahl des Anbieters (693.459.820) ist richtig (HKEX FF305 vom 23.09.2026: „into 10 Subdivided Shares“, Schlussbestand 693,459,820 H-Aktien). Gezeigt werden 8,57 statt rund 0,53 Mrd. USD (6,01 HKD × 693.459.820 × 0,12745 USD/HKD), also unter der Untergrenze. Fester Tag: Industrials unprofitabel, Score 48,3, Position 99 von 100 ohne Rang (zu wenige Achsen), Band large/mid → gesperrt, steht mit Grund und ohne Börsenwert in der Ausschlussliste. 600153.SS (48,1, Rang 97) rückt dadurch auf Platz 100 der Liste.
- Energisa (ENGI3.SA): Der Anbieter multipliziert 3.777.747.805 Aktien mit dem Kurs der Stammaktie. Laut Energisa (Aktionärsstruktur, „OWNERSHIP STRUCTURE ON 08/31/2026“, Zeile „Total capital stock“) sind es 975.954.372 Stamm- und 1.542.412.758 Vorzugsaktien; mit den Schlusskursen vom 30.09. (12,49 und 10,15 BRL) und dem Kurs des Standes (0,19263 USD/BRL) rund 5,36 statt 9,14 Mrd. USD. Fester Tag: volles Utilities-Board profitabel, Score 52,2, Rang 171, Band mega/mid → gesperrt, Ausschlussliste ohne Börsenwert. Bleibt über der Untergrenze; zurück aufs Board, sobald der Abruf beide Kurse kennt.
- Z98.DE (JBS in Frankfurt): dieselbe falsche Aktienzahl wie JBS an den schlechten Tagen (3.289.961.848), aber auf einer Nicht-USD-Notierung, die die Tabelle nicht berichtigt. Stand nur in der Ausschlussliste (Zweitnotierung, 37,4 statt rund 12,2 Mrd. USD); dort jetzt „data-suspect“ mit Grund und ohne Börsenwert. JBS selbst steht unverändert auf dem Board.

Indirekte Wirkung am festen Tag, alles zusammen gegen origin/main (Live-Kalibrierung, alle übrigen Stände bytegleich, kein anderer Börsenwert ändert sich): 451 Firmen ändern einen Score (Growth, Quality oder Rule of 40), höchstens um 1,2 (BURE.ST +1,2), 403 davon um 0,1; 502 Rangzeilen verschieben sich, höchstens um 4 Plätze. Board-Ein- und Austritte außer den genannten Firmen: 600153.SS rückt auf Platz 100 der Industrials-Liste (unprofitabel), weil Yunji sie verlässt; auf Platz 100 der Quality-Liste Utilities tauschen zwei Firmen mit gleichem Score 60,3 (MGL.NS heraus, 600674.SS herein; beobachtet, Ursache vermutlich die kleinere Utilities-Kohorte ohne Energisa, nicht nachgewiesen). Das globale Größenband verschiebt sich minimal; drei Firmen wechseln das Band (1114.HK small → micro, SHOT.ST mid → small, MIR large → mid).

Nicht in dieser Tabelle:
- PSEC: Anbieter 1,110 Mrd. (533,8 Mio. Aktien) gegen 524.832.496 Aktien laut 10-K („As of August 19, 2026, there were 524,832,496 shares of the Registrant's common stock outstanding“), also 1,7 % zu hoch. Unter der Wesentlichkeit: kein Band- oder Klassenwechsel, weit über der Untergrenze, kleiner als eine normale Tagesbewegung des Kurses.
- Realord (1196.HK): erledigt; 5.769.239.520 Aktien = 1.442.309.880 × 4 nach der Teilung, Börsenwert 2,19 Mrd. stimmt.

## Betriebsergebnis je Quartal in der Handtabelle (02.10.2026)

Problem: Die SEC-Doppelprüfung vom 01.10. fand falsche Quartals-Betriebsergebnisse (`opIncQ`) bei HIVE, CARG, PLUS, DCO und INFQ; bei SLC Agrícola passt keiner der fünf Anbieterwerte zum Abschluss. Die Handtabelle kannte nur Umsatz und Bruttogewinn.

Mechanismus (`lib/financial-known-cases.js`): `opIncQ` ist ein drittes Quartalsfeld mit genau derselben Wirkung wie Umsatz und Bruttogewinn: Fall je Ticker (samt Zweitnotierung), Feld und Periode mit dem exakten Anbieterwert; weicht der Anbieter ab, wird die Zelle leer (`vendor-value-changed`, nie ersetzt, nie 0); `coversThrough` je Feld, ein neues Anbieterquartal bleibt leer, bis es geprüft und eingetragen ist. Neu für alle Fälle: Ein Ersatzwert muss zu seinen Quellen passen, nämlich gleich einem `value` einer Quelle sein, gleich der Differenz zweier Quellwerte (Jahr minus neun Monate) oder bei einer vom Emittenten gerundeten Quelle innerhalb ihrer Rundung liegen; sonst lehnt die Prüfung die ganze Tabelle ab. Fälle ohne Quellwert (HTGC, Banpu, aus der ersten Tabelle) sind ausgenommen. Am Stand 2026-10-01c bestehen alle 162 Fälle: 106 über einen Quellwert, 16 abgeleitete Quartale über die Differenz, OXLC 31.03.2025 über die Rundung („approximately $121.2 million“ gegen 121.161.000), 10 ohne Quellwert, 29 leer gesetzt. Damit ist die offene Prüfnotiz aus PR #400 (Low 2) erledigt.

Eingetragen sind 30 Zellen (sechs Firmen mal fünf Quartale, je `coversThrough` 30.06.2026): 18 ersetzt, 12 bestätigt. Jeder Wert ist am 02.10. vom Erbauer selbst im Bericht nachgelesen (SEC-Filings, CVM-Daten). Jeder `expectedBadValue` ist gleich dem Anbieterwert im Artefakt `snapshots` von Lauf 36839128456 (01.10.2026); kein gespeichertes Quartal der sechs Reihen bleibt ungeprüft (0 Zellen `period-not-verified`).

| Ticker | Periode | Anbieter | Firma | Quelle (wörtlich) |
| --- | --- | --- | --- | --- |
| HIVE (auch HIVE.TO) | 30.06.2026 | −131.052.000 | −141.332.000 | 10-Q Q1 FY2027: „(Loss) income from operations (141,332) 35,665“ |
| HIVE | 31.03.2026 | −51.804.000 | −74.637.000 | 10-K FY2026 „(Loss) income from operations (144,581) 1,612 32,685“ minus neun Monate laut 6-K „(Loss) income (90,831) 68,283 (69,944) 51,401“ |
| HIVE | 31.12.2025 | −39.173.000 | −90.831.000 | 6-K Q3 FY2026: „(Loss) income (90,831) 68,283 (69,944) 51,401“ |
| HIVE | 30.09.2025 | −9.160.000 | −14.778.000 | 6-K Q2 FY2026: „(Loss) income from operations (14,778) 398 20,887 (16,882)“ |
| HIVE | 30.06.2025 | 6.836.000 | 35.665.000 | 10-Q Q1 FY2027 (Vorjahresspalte), wie oben |
| CARG | 31.12.2025 | 119.172.000 | 69.127.000 | 10-K 2025, Note 16: „Income from continuing operations 69,127 64,115 60,549 50,654“ |
| CARG | 30.09.2025 | 54.674.000 | 64.115.000 | wie oben |
| PLUS | 31.03.2026 | 37.644.000 | 30.904.000 | Ergebnismitteilung (8-K vom 28.05.2026): „Operating income 30,904 18,766 166,145 99,686“ |
| DCO | 31.12.2025 | 13.998.000 | 16.882.000 | 10-K/A 2025: „Operating Income 13,998 2,884 16,882“ |
| DCO | 30.09.2025 | −80.050.000 | −75.317.000 | 10-K/A 2025: „Operating Loss (80,050) 4,733 (75,317)“ |
| INFQ | 31.03.2026 | −33.575.000 | −33.031.000 | 10-Q Q2 2026, Berichtigung: „Loss from operations $ (33,575) $ 544 $ (33,031)“ |
| INFQ | 30.09.2025 | −6.536.000 | −6.699.000 | neun Monate 2025 berichtigt (23.895) minus sechs Monate (17.196), beide im 10-Q Q2 2026 |
| INFQ | 31.03.2025 | −6.950.000 | −6.784.000 | sechs Monate 2025 (17.196) minus zweites Quartal (10.412), 10-Q Q2 2026 |
| SLCE3.SA | 30.06.2026 | 2.619.662.000 BRL | 677.429.000 BRL | CVM ITR 2026, Konto 3.05 „Resultado Antes do Resultado Financeiro e dos Tributos“ |
| SLCE3.SA | 31.03.2026 | 624.874.000 | 624.406.000 | CVM ITR 2026, 3.05 |
| SLCE3.SA | 31.12.2025 | 222.439.000 | 209.162.000 | CVM DFP 2025 3.05 (1.812.542) minus ITR 3T25 neun Monate (1.603.380) |
| SLCE3.SA | 30.09.2025 | 284.041.000 | 284.046.000 | CVM ITR 2025, 3.05 |
| SLCE3.SA | 30.06.2025 | 2.242.857.000 | 453.286.000 | CVM ITR 2026, Vorjahresspalte, 3.05 |

Bestätigt (Anbieter gleich Firma, Zeile bleibt Byte für Byte): CARG 30.06.2026, 31.03.2026, 30.06.2025; PLUS 30.06.2026, 31.12.2025, 30.09.2025, 30.06.2025; DCO 30.06.2026, 31.03.2026, 30.06.2025; INFQ 30.06.2026, 30.06.2025. CARG: „Income from continuing operations“ ist die Betriebsergebniszeile (Konzern-GuV des 10-K: Umsatz minus betriebliche Aufwendungen, vor „Other income, net“ und vor Steuern; „Income from continuing operations 244,445 157,147 120,329“), nicht das Ergebnis nach Steuern.

SLC Agrícola, Basis: Das Betriebsergebnis (CVM 3.05) steht wie der Bruttogewinn aus #402 (3.03, 941.202) auf der Umsatzbasis 3.01 (2T26: 2.765.644, mit Neubewertung der Ernte); der Umsatz der Handtabelle ist die „Receita Operacional Líquida“ der Ergebnismitteilung (2.175.612, ohne sie). Die Margenreihe mischt damit zwei Basen; auf einer Basis wäre die Margenbewegung kleiner (Rohwert +0,044 statt +0,068). Das ist keine wahre Margenbewegung, sondern eine geerbte Basisfrage aus #402 (Folgeauftrag).

Wirkung am festen Tag (Lauf 36839128456, 16.108 Stände, Watchlist d90e04b259, Growth live kalibriert; origin/main 347aaffb4e gegen diesen Stand): HIVE Financials unprofitabel 63,9 Rang 6 → 62,9 Rang 7 (Margen-Trajektorie roh −1,806 → −2,568, Perzentil 23,2 → 16,1, Gewicht 1,3); SLC Basiskonsum profitabel 81,8 Rang 25 → 82,7 Rang 22 (roh 0 → +0,068, Perzentil 53,7 → 89,8, Gewicht 0,3); INFQ 68,2 Rang 14 unverändert (roh −1,357 → −1,378); CARG, PLUS, DCO unverändert (korrigiert sind nur mittlere Quartale; Trajektorie, Gewinnstufe und Lampe lesen sie heute nicht). Gewinnstufe und Lampen aller sechs unverändert. Indirekt: 16 Scores um höchstens 0,3 (RIOT +0,3), 16 Zeilen nur im Rang um höchstens 2 Plätze; Quality und Smallcap unverändert; keine Board-Ein- oder Austritte. Die alte Tabelle unter dem neuen Lader verändert 0 der 16.108 Stände.

Grenzen: Solange ein neues Quartal leer ist, ist die Margen-Trajektorie leer (`axes.js` verlangt das jüngste Quartal) und die Gewinnstufe rechnet bei Verlustfirmen mit dem Vorquartal. Für HIVE ist das neu (sein Umsatz hat keine `coversThrough`). Die Lückenprüfung des Board-Verlaufs (`scripts/write-board-history.js`, opSlot) erkennt eine leer gesetzte Zelle der Handtabelle nicht als leeren Kopf; sie wirkt nur an angemeldeten Datensprung-Tagen (Folgeauftrag, die Datei ist in offenen PRs in Arbeit).

Eintragen der nächsten Quartale (bis 30.09.2026), Betriebsergebnis zusammen mit Umsatz und Bruttogewinn, sobald die Firma berichtet:
- HIVE: 10-Q Q2 FY2027, laut Anbieterkalender 12.11.2026 (nicht geprüft).
- CARG: 10-Q Q3 2026, Termin nicht geprüft (Vorjahr Anfang November).
- PLUS: 10-Q Q2 FY2027, laut Anbieterkalender 09.11.2026 (nicht geprüft).
- DCO: 10-Q Q3 2026, Termin nicht geprüft.
- INFQ: 10-Q Q3 2026, Termin nicht geprüft.
- SLC Agrícola: ITR 3T26, gesetzliche Frist 14.11.2026 (45 Tage nach Quartalsende).

## HL: Jahres-Bruttogewinn leer (02.10.2026)

Problem: Hecla (HL, auch HL.SW) hat die Jahre 2023 bis 2025 nach dem Verkauf der Mine Casa Berardi neu ausgewiesen (8-K vom 28.08.2026, Exhibit 99.1: „as a discontinued operation for all periods presented“). Der Anbieter führt den alten Stand. Sichtbar falsch ist vor allem der Bruttogewinn: Kennzahl der Zeile +213,9 % (neu ausgewiesen +178,3 %), Achse Bruttogewinn-Wachstum im 98. Perzentil.

Lösung: drei Jahreszellen `annualGP` (Position 0 bis 2, undatierte Reihe, Alias HL.SW) leer mit Grund; 2022 folgt nach der Regel ohne Lücken (`annual-older-than-withheld`). Der Jahresumsatz bleibt: Der Fehler im Wachstum ist 0,24 Punkte (alt 1.423,0/929,9 = +53,0 %, neu 1.103,9/720,2 = +53,3 %), und leere Umsatzjahre würden drei Achsen löschen und den Abschlag für Vermögenswachstum in der Kapitaleffizienz stillschweigend entfernen.

| Jahr (Position) | Anbieter | Neu ausgewiesen (Exhibit 99.1, Segmentnote, Spalte gesamt) |
| --- | --- | --- |
| 2025 (0) | 622.203.000 | 509.805.000: „Gross profit 322,646 132,950 53,665 509,261 544 509,805“ |
| 2024 (1) | 198.210.000 | 183.184.000: „Gross profit/(loss) (a) 153,447 56,462 (26,754) 183,155 29 183,184“ |
| 2023 (2) | 112.949.000 | 101.271.000: „Gross profit (loss) (a) 124,609 6,552 (29,793) 101,368 (97) 101,271“ |
| 2022 (3) | 116.156.000 | nicht neu ausgewiesen; leer nach der Regel ohne Lücken |

Wirkung am festen Tag (wie oben), jede Achse vorher → nachher:
- Growth, Materials profitabel: 79,3 Rang 39 → 73,5 Rang 93. Bruttogewinn-Wachstum Perzentil 98,1 → leer (Gewicht 0,8); unverändert: Wachstumsniveau 89,3 (0,5), Beschleunigung 85,9 (1,9), Rule of X 90,8 (0,6), Margen-Trajektorie 90,3 (0,4), Kapitaleffizienz 64,3 (2,0), Verwässerung 34,4 (0,8). Wachstum +52,45 % (Quartalsbein) unverändert. Kennzahl +213,9 % → leer mit Grund.
- Quality, Materials profitabel: 70,2 Rang 111 → 53,8 Rang 366. Bruttogewinn-Wachstum 98,4 → leer (Gewicht 1,5) und Margenniveau 77,7 → leer (Gewicht 2,2; `marginLevel` liest den Jahres-Bruttogewinn); unverändert: Kapitaleffizienz 59,9 (2,6), Verwässerung 31,1 (1,2), Wachstumsniveau 89,4 (0,8).
- Indirekt (zusammen mit dem Betriebsergebnis oben): Growth 82 Scores um höchstens 0,3, Quality 192 um höchstens 0,1, Ränge um höchstens 2 Plätze; keine Board-Ein- oder Austritte.

Offen: Das Margenniveau liegt neu ausgewiesen bei 46,2 % (509,8/1.103,9) statt 43,7 % beim Anbieter; die leere Zelle kostet HL in Quality mehr als der Fehler. Jahresersatzwerte schließt die Tabelle bewusst aus (#403); ob HL dafür eine Ausnahme bekommt, ist eine Methodenfrage. Ebenfalls offen: Betriebsergebnis 2023 bis 2025 auf altem Stand (514,8 / 106,3 / −44,7 Mio. statt 396,4 / 123,8 / 12,0 Mio. laut 8-K, „Income from operations / 396,409 / 123,762 / 12,009“); die Tabelle trägt `annualOpInc` nicht.

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

BDC-Prüfumfang: ARCC, BBDC, BXSL, CSWC, FSK, GBDC, HTGC, MAIN, OBDC, OCSL, PSEC, TRIN, TSLX. Belegt: HTGC, ARCC, FSK. Die zehn übrigen sind in diesem Durchgang nicht durch Primärquellen entschieden; ihre ursprünglichen fünf Quartale bleiben erhalten. (Nachtrag 01.10.: neun davon sind jetzt belegt und korrigiert, dazu KBDC, OTF, MSDL und OXLC (OTF und KBDC wegen falscher Anbieter-Jahresumsätze gesperrt); OCSL bleibt ungeprüft. Abschnitt „BDC-Handtabelle“.) 2155 Gruppen identischer Jahresumsätze wurden erfasst (häufig Zweitnotierungen); kein weiterer Fremdgesellschaftsfehler allein aus diesem Vergleich bewiesen.

## Belege, Unverändertheit und Grenzen

SHA-256 der sortierten Liste aller Quelldatei-Hashes: `81c96b4789073dac5e6085c9fb2bfe489cd1e57629228f66ffbcbe12db3e4397`. Vor und nach dem Lauf bleiben alle 16118 Dateihashes identisch. Jede bearbeitete Zeile wird für den Vergleich auf ihre exakt gespeicherte Originalzeile zurückgesetzt; einschließlich der ausdrücklich erlaubten Banpu-Metadaten ergibt sich derselbe JSON-Byte-String. Alle anderen Eingabezellen sind damit identisch. Scoregleichheit aller übrigen Unternehmen wird wegen Neukalibrierung ausdrücklich nicht behauptet.

Reproduzierbar: `node scripts/financial-corrections-replay.js <read-only-snapshot-directory> [veröffentlichungs-ref]` (Nachlauf 30.09. mit Ref d164b75262 = Veröffentlichung vom 29.09.: dieselben 36 Zellen der Hauptticker plus 12 Aliaszellen, 0 stale, identische Board-Wirkung). Die 16.118 Originale kommen aus dem r1-Archiv snapshots-20260929 im freigegebenen sd-ro-Arbeitsbaum. Es wird keine Historie geschrieben und kein loadUniverse-Aufruf verwendet, der eine Baseline-Datei anlegen könnte. Die vorhandene Q4-Reparatur bildet den Ausgangsstand beider Arme.

Die Quality-Ausgangsscores stimmen vollständig mit allen 1.100 veröffentlichten Zeilen überein. Growth hat genau eine Abweichung: CHWY 42,4 veröffentlicht, 42,5 im Replay; CHWY wird durch F2 nicht verändert. Smallcap ist nur eine Diagnose mit dem Hauptbestand (517 Feed-Abweichungen), kein gültiger historischer Nachbau. Der wirkliche Smallcap-Lauf verwendete den Cache snapshots-smallcap-store-36236295562 vom 26.09. mit 769 Dateien und 490 zugelassenen Firmen. Das vorhandene Archiv des gescheiterten späteren 29.09.-Laufs enthält 418 neuere Stände und wäre eine falsche Grundlage. Das passende ältere Artefakt ist lokal und über die geprüfte GitHub-Artefaktliste nicht erreichbar. Zusätzlich braucht Smallcap seine eigene historische Unternehmensliste und die Produktions-Abdeckungsgrenze. Vollständige Smallcap-Board-Parität bleibt deshalb offen.

Rule of 40: 16118 Originaldateien, 5221 Kandidaten, 469 sichtbare Zeilen. Ausgangsabweichungen zur Veröffentlichung: 0. Aktive Änderungen: 0. Im Schatten ändern sich 34 Zeilen bei R40/R40-EBITDA oder Rang; kein übernommener Engine-Score ändert sich. Alle Alt/Neu-Werte stehen unter rule40 in financial-corrections-replay.json. Der echte Produktions-Sammler läuft mit ausschließlich lesendem Speicheradapter; Originaldateinamen, Währungsbelege und Veröffentlichungsdatum bleiben erhalten.

Druckenmiller wurde unabhängig mit dem echten loadCandidates und denselben drei Armen geprüft: 2.277 Kandidaten in jedem Arm; vollständige Kandidaten-Inhalte bytegleich, keine unlesbaren Dateien. Es gibt damit keine geänderten Eingaben für dieses separate Modul (Prüferbeleg, Sicherheit 99 %).

Primärquelle Banpu: [Quartalsabschluss](https://www.banpu.com/wp-content/uploads/2026/03/Banpu-PLC_Mar26Q1-EN.pdf), PDF8 (gedruckt7), „Sales and service income“. Primärquelle Tochter: [Banpu Power](https://www.banpupower.com/wp-content/uploads/2026/05/BPP-Q1Mar69-EN-Signed.pdf), PDF6, „Sales“. HTGC: [10-Q](https://investor.htgc.com/sec-filings/all-sec-filings/content/0001280784-26-000042/0001280784-26-000042.pdf), PDF82, „Total investment income“. Vollständige USD-Quartale, SEC-Fundstellen, Ableitungen und Abrufstand in financial-corrections-source-evidence.json; Yahoo-Wiederholung in financial-corrections-yahoo-evidence.json.

## Prüfung und Übergabe

Unabhängiger Astra-ultra-Prüfer: 16.118 Stände, genau acht Änderungen/36 Zellen, Eingaben unverändert, Wiederholung idempotent, Schattenbetrieb ohne Mutation; alle 15 BDC-Umsätze gegen SEC bestätigt. Sein nachgestellter Banpu-Jahreswechsel-Fund ist repariert und mit einer absichtlich roten In-Memory-Gegenprobe abgesichert. Die neue Suite bestand damals mit 42 Prüfblöcken und 41 absichtlichen Fehlern (Stand Prüfrunde 3: 52 Prüfblöcke, 50 absichtliche Fehler); SHA-256 des echten Codes davor/danach unverändert. GQS besteht unabhängig mit 25 Referenzfällen/13 Branchen und keiner Score-/Rangabweichung. Der Prüfer meldet keine offenen Blocker (97 % Sicherheit). Veröffentlichung und Claude-Freigabe sind nicht Bestandteil dieses Auftrags.

Gesamtprüfung `node scripts/test-gate.js --mode=all`: 580 echte Testdateien, 499 PASS, 74 FAIL, 7 ohne ausgeführte Prüfung. Alle 74 fehlgeschlagenen Dateien sind gegenüber HEAD unverändert; Python-Start wird mit EPERM verweigert, in einem Test scheitern zusätzlich Windows-Benutzerabfragen mit ENOMEM. Beide Umgebungsfehler wurden unabhängig nachgestellt. Die Gesamtprüfung ist rot; fehlende Archivdaten sind nicht als Ursache behauptet. Gezielte F2-, Q4-, FX- und GQS-Suiten laufen nach dem letzten Code-Stand erfolgreich. Der separate alte Q4-Bestandsreplay hat einen festen Vortags-Sollwert von 27 und schlägt am neuen Tagesbestand mit 19 neuen Treffern fehl: acht weitere Zellen sind bereits korrekt (27 = 19 neu + 8 bereits korrigiert), anhand aller ursprünglichen Fallzeilen nachgeprüft. Seine Vorgabe wurde nicht gelockert.

Befehle und Ausgaben liegen unter _scratch/f2: targeted-financial-final.log (42/41), targeted-q4-final.log, targeted-gqs-final.log, targeted-fx-final.log sowie full-test-gate-final.log. Reproduzierbare Belege sind die beiden echten Module mapFTSToQuarterly/_convertSnapshotToUSD, die Quellen-Handtabelle und financial-corrections-replay.js. Keine Datenhistorie, Formel, Achsengewichtung oder eingefrorene GQS-Referenz wurde verändert.

Git-Abschluss (Stand 30.09.): Der ursprüngliche Lauf konnte wegen index.lock nicht committen. Inzwischen liegen alle Änderungen als Commits „Tag 1389“, „Tag 1389b“ und „Tag 1389c“ auf fix/banpu-htgc-and-false-zeros-20260929 und sind gepusht (PR #398); kein Merge. Sitzungs-ID und vorgesehene Trailer stehen in financial-corrections-validation.json.
