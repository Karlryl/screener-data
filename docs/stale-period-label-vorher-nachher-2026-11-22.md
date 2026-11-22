# Kennzeichnung „neuerer Zeitraum veröffentlicht, nicht geladen": Vorher/Nachher am Datentag 21.11.2026

Stand 22.11.2026, Zweig `claude/stale-period-label` (Basis `origin/main` 08c9b5ca), zweite Fassung nach der Blindprüfung (Befunde B1, S1 bis S3 und Kleinigkeiten). Stufe 4 der K2-Diagnose (`C:\Users\Anwender\.codex\reports\k2-rest-2026-11-22\diagnose.md`, Abschnitt 6 Punkt 5).

> **Auf einen Blick**
>
> **Jede Board-Zeile, deren gezeigter Zeitraum älter ist als ein in unseren Daten belegter neuerer Zeitraum, trägt das Feld `newerPeriod` (Filter-Feed: `np`) mit festem Grundcode und deutschem Hinweis; keine einzige Zahl hat sich geändert (alle 2.756.812 Werte der 52 Exportdateien gleich).**
>
> - **HyperGrowth:** 4.682 von 8.809 Zeilen gekennzeichnet (3.337 beim Umsatzwachstum, 4.228 beim Bruttogewinn-Wachstum), sichtbar in den Top-Listen 978 von 1.920. **Rule of 40:** 119 von 484 (111 Wachstum, 35 FCF-Marge). **Filter-Feed:** 6.041 von 15.769, Größe 6.063.719 Byte (Grenze 6.500.000).
> - Auf den HyperGrowth-Vollboards behauptet nach der Prüfung kein Grund mehr eine Lücke beim Anbieter, wo der Anbieter geliefert hat und wir den Wert zurückhalten: 374 Felder heißen jetzt `quartale-zu-alt` statt „nur Jahreswerte", 33 `wert-zurueckgehalten`, 103 `vorjahr-nicht-positiv` statt „Datenprüfung nicht bestanden".

## 1. Was gebaut ist

- **Regel.** Ein gezeigter Zeitraum bekommt das Etikett, wenn der neueste Zeitraum, den unsere eigenen Daten als veröffentlicht belegen, mehr als 45 Tage später endet. Beleg ist nur, was im Snapshot steht: das neueste gespeicherte Quartal mit Wert (`timeseries.revenueQ`) oder Yahoos `meta.mostRecentQuarter`; ein Datum nach dem Datentag (`RUN_DATE_UTC`, jetzt in allen drei Schreibern dieselbe Grenze) zählt nicht. Neu: Yahoos Datum zählt auch dann nicht, wenn `earnings-calendar.json` den Bericht der Firma erst nach dem Datentag und höchstens 95 Tage nach diesem Datum erwartet (ZEG.L, ZEGLF: Yahoo 30.09.2026, Bericht am 24.11.2026). Für den neueren Zeitraum wird nichts geschätzt.
- **Anbieterwert oder Lücke.** Eine Quartalszelle, die unsere eigenen Regeln zurückhalten (Handtabelle, Nullwächter, Börsenabgleich, Altersmaske `series-stale`), trägt den Anbieterwert in `financialMissing.originalVendorRow`. Das Etikett zählt sie als geliefert und nennt die Zurückhaltung statt einer Lücke beim Anbieter.
- **Geprüfte Felder.** Umsatzwachstum (`revGrowthPeriodEnd`, HyperGrowth und Rule of 40), Bruttogewinn-Wachstum (`overviewPeriod` bei Übersichtsart `gp`, HyperGrowth; ein von der Übersichtssperre zurückgehaltener Bruttogewinn trägt kein Etikett mehr), FCF-Marge (`fcfMarginPeriodEnd` bzw. `fp`, Rule of 40 und Filter-Feed).
- **Feste Gründe.**

| Code | Kurz | Bedeutung |
|---|---|---|
| `vorjahr-fehlt` | `vf` | neuestes Quartal gespeichert, das Vorjahresquartal fehlt beim Anbieter |
| `boersenabgleich` | `ba` | wie oben, und der Börsenabgleich findet bei einem älteren Quartal eine Abweichung von der Börsenmeldung (nur A-Aktien und Taiwan) |
| `vorjahr-zurueckgehalten` | `vz` | neu: der Anbieter hat das Vorjahresquartal geliefert, unsere Datenprüfung hält es zurück |
| `vorjahr-nicht-positiv` | `vn` | neu: beide Quartale da, der Vorjahreswert ist null oder negativ, ein Wachstum in Prozent lässt sich nicht rechnen (richtige Daten, keine gescheiterte Prüfung) |
| `paar-gesperrt` | `pg` | beide Quartale da, Vorjahreswert positiv, das Paar besteht eine Datenprüfung nicht |
| `anbieter-verzug` | `av` | Quartalsreihe vorhanden, der neueste gemeldete Zeitraum fehlt noch beim Anbieter |
| `wert-zurueckgehalten` | `wz` | neu: der Anbieter hat den neuesten Zeitraum geliefert, unsere Datenprüfung hält ihn zurück (meist Handtabelle `period-after-coverage`, etwa JIOFIN.NS) |
| `quartale-zu-alt` | `qa` | neu: der Anbieter hat Quartale geliefert, das neueste liegt aber mehr als 365 Tage vor dem Datenstand, deshalb nimmt die Altersmaske die ganze Reihe aus der Rechnung (MKS.L, BFIT.AS, FNAC.PA) |
| `nur-jahreswerte` | `nj` | der Anbieter liefert für diese Zahl überhaupt keine Quartalswerte, auch keine zurückgehaltenen |
| `fcf-ttm-alt` | `fa` | die Zwölfmonatswerte der FCF-Marge enden mehr als 45 Tage vor dem neuesten Zeitraum |

- **Kurzform im Filter-Feed.** `np` ist jetzt eine Zeichenkette `<Ende>[y]:<Wachstumscode>:<FCF-Code>`, etwa `2026-09-30:vf:` oder `2026-06-30y:qa:`; lesbar über `lib/stale-period.js decodeNewerPeriod` und die Tabelle oben.
- **Beispiele (21.11.2026).** DNO.OL zeigt +194,8 % für das Quartal bis 30.06.2026; Hinweis: „Neuerer Zeitraum veröffentlicht (bis 30.09.2026), hier noch nicht verwendet: Umsatzwachstum und Bruttogewinn-Wachstum, weil das Vorjahresquartal in den Anbieterdaten fehlt." Marks and Spencer (MKS.L) trägt jetzt „weil die Quartalswerte des Anbieters zu alt sind und deshalb nicht verwendet werden" statt „weil der Anbieter dafür nur Jahreswerte liefert". JIOFIN.NS trägt „weil unsere Datenprüfung den neuesten Quartalswert des Anbieters zurückhält".

## 2. Zählung nach Board und Grund

Messweise: voller Exportlauf (findash-Export, Ausschlussliste, `--check`, Rule of 40 mit `--check`, Filter-Feed mit `--check`) auf denselben Snapshots des Lauf-Artefakts vom 21.11.2026 wie in der ersten Fassung (Arbeitskopie der Prüfung, OpInc- und FCF-Schritt schon angewandt), `RUN_DATE_UTC=2026-11-21`. Die Ausgabe von run-screener ist dieselbe wie in der ersten Fassung, weil die Änderung keine Datei unter `src/` berührt. Ohne Small-Cap-Speicher, daher keine Small-Cap-Zeilen.

**HyperGrowth, Vollboards (8.809 Zeilen, 4.682 gekennzeichnet; Beleg: 3.505 gespeichertes Quartal, 1.177 nur Yahoo)**

| Grund | Umsatzwachstum | Bruttogewinn-Wachstum |
|---|---|---|
| `vorjahr-fehlt` | 2.137 | 3.128 |
| `nur-jahreswerte` | 486 | 470 |
| `anbieter-verzug` | 357 | 353 |
| `quartale-zu-alt` | 205 | 169 |
| `boersenabgleich` | 119 | – |
| `wert-zurueckgehalten` | 30 | 3 |
| `paar-gesperrt` | 2 | 2 |
| `vorjahr-nicht-positiv` | 1 | 102 |
| `vorjahr-zurueckgehalten` | – | 1 |
| **Summe** | **3.337** | **4.228** |

**HyperGrowth, Top-Listen (1.920 Zeilen, 978 gekennzeichnet; 709 Quartal, 269 Yahoo):** Umsatzwachstum 666 (`vorjahr-fehlt` 427, `nur-jahreswerte` 93, `anbieter-verzug` 81, `quartale-zu-alt` 26, `boersenabgleich` 26, `wert-zurueckgehalten` 12, `paar-gesperrt` 1); Bruttogewinn-Wachstum 862 (`vorjahr-fehlt` 620, `nur-jahreswerte` 113, `anbieter-verzug` 81, `quartale-zu-alt` 23, `vorjahr-nicht-positiv` 20, `wert-zurueckgehalten` 3, `paar-gesperrt` 2).

**Rule of 40 (484 Zeilen, 119 gekennzeichnet; 62 Quartal, 57 Yahoo):** Umsatzwachstum 111 (`vorjahr-fehlt` 55, `anbieter-verzug` 29, `nur-jahreswerte` 22, `quartale-zu-alt` 4, `wert-zurueckgehalten` 1), FCF-Marge 35 (`fcf-ttm-alt`).

**Filter-Feed (15.769 Zeilen, 6.041 mit `np`; 3.899 Quartal, 2.142 Yahoo):** Wachstum 5.892 (`vf` 3.625, `nj` 856, `av` 795, `qa` 445, `ba` 124, `wz` 36, `vn` 9, `pg` 2), FCF-Marge 834 (`fa`). Größe 5.927.305 Byte ohne Etikett, 6.063.719 mit (+136.414; die erste Fassung mit Objekt-Form brauchte +254.010), Grenze 6.500.000, Luft 436.281 Byte.

**Größte Board-Datei:** `full/industrials.json` mit 7.013.534 Byte, findash liest höchstens 8 MiB (8.388.608 Byte, `data-layer/http-get.js`). Der Schreiber warnt jetzt ab 90 % dieser Grenze (7.549.747 Byte); am 21.11. bleibt er still.

**Was sich gegenüber der ersten Fassung am selben Datentag geändert hat (HyperGrowth-Vollboards):** 374 Felder `nur-jahreswerte` → `quartale-zu-alt` (205 Wachstum, 169 Bruttogewinn), 33 → `wert-zurueckgehalten` (28 und 3 aus `anbieter-verzug`, 2 aus `nur-jahreswerte`), 103 `paar-gesperrt` → `vorjahr-nicht-positiv`, 1 `vorjahr-fehlt` → `vorjahr-zurueckgehalten` (AHCO, Bruttogewinn), und eine Zeile verliert das Etikett, weil der Bericht laut Kalender noch aussteht (SNEX: Yahoo 30.09.2026, Bericht am 23.11.2026; siehe Grenzen). Im Filter-Feed verlieren ZEG.L und ZEGLF ihr `np` aus demselben Grund. Die Nachprüfung der Prüfung (jede gekennzeichnete Zeile gegen die rohen und die vorbereiteten Snapshots) findet keinen Fall mehr, in dem ein Grund eine Lücke beim Anbieter behauptet, obwohl der Anbieter den Wert geliefert hat.

## 3. Beweis: keine gezeigte Zahl ändert sich

- Der neue Exportbaum wurde vollständig neu geschrieben; daraus wurden nur die Schlüssel `newerPeriod` und `np` entfernt und `generated_at` geleert, dann gegen den unveränderten Basisbaum (08c9b5ca, gleicher Datentag) `node scripts/check-export-additive.js --provenance-content`: **52 Dateien, 35.567 Zeilen, 2.756.812 Werte, 0 Abweichungen.**
- Ohne das Entfernen meldet derselbe Vergleich 18.767 Abweichungen: genau 18.754 neue Schlüssel (`newerPeriod` auf jeder Board-Zeile, auch als `null`, und 6.041 `np` im Filter-Feed) plus 13 geänderte Vollboard-Dateien, sonst nichts.
- Gegenprobe: eine um 1e-9 verschobene Wachstumszahl in `full/energy.json` meldet der Vergleich sofort (2 Abweichungen).
- Alle drei `--check`-Tore grün wie vorher (Rule of 40 484 Zeilen, Filter OK); das findash-`--check` meldet wie im Basisstand dieselbe eine Verletzung `smallcap/index: boards`, weil der Small-Cap-Speicher lokal fehlt.

## 4. Abgleich mit der Diagnose

| | Zeilen |
|---|---|
| HyperGrowth, laut Diagnose veraltet und gekennzeichnet | 3.309 |
| laut Diagnose veraltet, nicht gekennzeichnet: neuerer Zeitraum nur im Börsenspeicher belegt | 33 (+1 Rule of 40) |
| laut Diagnose veraltet, nicht gekennzeichnet: neuestes Quartal per Handtabelle zurückgehalten (1941.T) | 1 |
| gekennzeichnet, in der Diagnose ohne Snapshot | 27 (+4 Rule of 40) |

Diese Tabelle stammt aus der ersten Fassung; die Prüfung hat nur Gründe umbenannt und eine Zeile (SNEX) wegen des Kalenders entfernt, die Gesamtmenge ist sonst gleich.

## 5. Tests

- `tests/stale-period-label.test.js`, jetzt 13 Fälle. Neu: eine von der Altersmaske genullte Reihe heißt `quartale-zu-alt` (mit echter `maskStaleQuarterSeries`), ein zurückgehaltener neuester Wert `wert-zurueckgehalten` (auch verschachtelt), ein zurückgehaltenes Vorjahresquartal `vorjahr-zurueckgehalten`, ein negativer Vorjahreswert `vorjahr-nicht-positiv`; die Kalenderprüfung (55 Tage fällt weg, 95 Tage ist die Grenze, 106 Tage bleibt); die Kurzform hin und zurück für jeden Code; der Board-Schreiber (`mapBoardRow` mit den echten export-w8-Snapshots: DAR.L gekennzeichnet, CBDK.JK `null`) und der Rule-of-40-Schreiber (`build` mit Testsnapshot: Wachstum und FCF gekennzeichnet, die aktuelle Zeile `null`).
- Einmal absichtlich rot gemacht: `newerPeriodFacts` in `scripts/write-findash-export.js` auf `null` gesetzt (1 von 13 rot), dann `newerPeriodLabel(k.newerPeriodFacts, …)` in `scripts/write-rule40-export.js` mit `null` (1 von 13 rot); beide Male zurückgestellt, sha256 vorher und nachher gleich.
- Die stillen Ersatzfunktionen beim Einbinden von `lib/stale-period.js` im Board-Schreiber sind entfernt; fehlt eine Funktion, bricht der Schreiber laut ab. Der einzige Test, der das Modul durch einen Platzhalter ersetzt hatte (`tests/scoring/dup-issuer-shadow-export.test.js`), bekommt jetzt das echte Modul. Die `typeof`-Prüfung in `snapAbleitungenFuer` bleibt, weil `tests/smallcap-store-evidence-p159.test.js` diese Funktion ohne die übrigen Bindungen des Moduls ausführt.
- Grün im Klon: `stale-period-label`, `jsdoc-exports`, `yahoo-q4-known-cases`, `source-priority`, `scoring/gqs00-freeze`, `export-hinweis-neuerer-bericht`, `feed-fill-guard`, `w6-filter-universe`, `smallcap-store-evidence-p159`, `scoring/dup-issuer-shadow-export`, `annual-pairs-shadow-export`, `export-w8-ffo-reason`, `export-w8-rev-growth-reason`, `fcf-stmt-shadow`, `g31-aktualitaet-p184`, `mcap-classes-shadow`, `rule40-source-ends`, `value-flags`, `g31-p267`, `non-operating-classes` (mit LF-Arbeitskopie wie in CI), `export-provenance`, `market-cap-export-p205`.

## 6. Grenzen

- Börsenspeicher (MOPS, Eastmoney, HK-Halbjahre) sind nie Beleg für den neueren Zeitraum; das kostet 34 Zeilen. Einbauen, sobald diese Zeilen sichtbar stören (Sicherheit, dass es weniger als 1 % der veralteten Zeilen bleibt: 80 %).
- Wo nur Yahoos `mostRecentQuarter` den neueren Zeitraum belegt (1.177 HyperGrowth-Zeilen), ist nicht an der Primärquelle geprüft, dass er veröffentlicht ist; das Feld sagt das mit `evidence: "yahoo"` und der Hinweis mit „laut Yahoo". Der Kalender fängt nur den Fall, dass der Bericht dieses Zeitraums noch aussteht und bekannt ist; ein Jahresbericht, der mehr als 95 Tage nach Periodenende kommt, fällt nicht darunter (Sicherheit, dass der Zeitraum veröffentlicht ist: 85 %, aus der Diagnose).
- Der Hinweis `neuerer-bericht` in `g31Hinweis` bleibt unverändert (Exportvertrag: nur hinzufügen) und liest den Kalender nicht; auf Zeilen, bei denen der Kalender greift, können beide deshalb verschiedene Daten nennen (am 21.11. trägt keine dieser Zeilen den Hinweis).
- SNEX zeigt selbst schon ein Geschäftsjahr bis 30.09.2026 (`yearNewerRecord`), der Zeitraum ist also veröffentlicht, obwohl der Kalender den Bericht für den 23.11. nennt. Das Etikett fehlt dort jetzt (keine falsche Aussage, aber ein fehlender Hinweis auf das ältere Bruttogewinn-Quartal). Abhilfe wäre, ein gezeigtes Periodenende selbst als Beleg zu zählen; nicht gebaut.
- Die Übersichtssperre (`applyOverviewHold`) streicht jetzt auch das Bruttogewinn-Etikett; am 21.11. betraf das keine Zeile (vorher und nachher 0), es gibt dafür keinen eigenen Test.
- findash zeigt das Feld noch nicht an; das ist ein eigener Schritt.
