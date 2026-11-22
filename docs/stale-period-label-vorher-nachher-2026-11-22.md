# Kennzeichnung „neuerer Zeitraum veröffentlicht, nicht geladen": Vorher/Nachher am Datentag 21.11.2026

Stand 22.11.2026, Zweig `claude/stale-period-label` (Basis `origin/main` 08c9b5ca). Stufe 4 der K2-Diagnose (`C:\Users\Anwender\.codex\reports\k2-rest-2026-11-22\diagnose.md`, Abschnitt 6 Punkt 5).

> **Auf einen Blick**
>
> **Jede Board-Zeile, deren gezeigter Zeitraum älter ist als ein in unseren Daten belegter neuerer Zeitraum, trägt jetzt das Feld `newerPeriod` (Filter-Feed: `np`) mit festem Grundcode und deutschem Hinweis; keine einzige Zahl hat sich geändert (alle 2.756.812 Werte der 52 Exportdateien gleich).**
>
> - **HyperGrowth:** 4.683 von 8.809 Zeilen gekennzeichnet (3.337 beim Umsatzwachstum, 4.229 beim Bruttogewinn-Wachstum), sichtbar in den Top-Listen 978 von 1.920. **Rule of 40:** 119 von 484 (111 Wachstum, 35 FCF-Marge). **Filter-Feed:** 6.045 von 15.769.
> - Von den 3.344 Zeilen, die die Diagnose auf HyperGrowth als veraltet zählte, tragen 3.309 das Etikett; die übrigen 35 belegt nur ein Börsenspeicher (MOPS, Eastmoney, HK), den das Etikett bewusst nicht liest (34), oder der neueste Wert ist per Handtabelle zurückgehalten (1).

## 1. Was gebaut ist

- **Regel.** Ein gezeigter Zeitraum bekommt das Etikett, wenn der neueste Zeitraum, den unsere eigenen Daten als veröffentlicht belegen, mehr als 45 Tage später endet. Beleg ist nur, was im Snapshot steht: das neueste gespeicherte Quartal mit Wert (`timeseries.revenueQ`) oder Yahoos `meta.mostRecentQuarter`; ein Datum nach dem Datentag zählt nicht. Für den neueren Zeitraum wird nichts geschätzt. Dieselbe Datumsregel nutzt schon der Hinweis `neuerer-bericht`; beide lesen jetzt eine gemeinsame Funktion (`lib/stale-period.js newestPublished`) und nennen in allen 1.565 Zeilen mit beiden dasselbe Datum.
- **Geprüfte Felder.** Umsatzwachstum (`revGrowthPeriodEnd`, HyperGrowth und Rule of 40), Bruttogewinn-Wachstum (`overviewPeriod` bei Übersichtsart `gp`, HyperGrowth), FCF-Marge (`fcfMarginPeriodEnd` bzw. `fp`, Rule of 40 und Filter-Feed).
- **Feste Gründe.**

| Code | Kurz | Bedeutung |
|---|---|---|
| `vorjahr-fehlt` | `vf` | neuestes Quartal gespeichert, das Vorjahresquartal fehlt beim Anbieter |
| `boersenabgleich` | `ba` | wie oben, und der Börsenabgleich findet bei einem älteren Quartal eine Abweichung zur Börsenmeldung (nur A-Aktien und Taiwan) |
| `paar-gesperrt` | `pg` | beide Quartale da, das Paar besteht eine Datenprüfung nicht |
| `anbieter-verzug` | `av` | Quartalsreihe vorhanden, der neueste gemeldete Zeitraum fehlt noch beim Anbieter |
| `nur-jahreswerte` | `nj` | für diese Zahl liefert der Anbieter nur Jahreswerte |
| `fcf-ttm-alt` | `fa` | die Zwölfmonatswerte der FCF-Marge enden mehr als 45 Tage vor dem neuesten Zeitraum |

- **Beispiele (21.11.2026).** DNO.OL zeigt +194,8 % für das Quartal bis 30.06.2026; Hinweis: „Neuerer Zeitraum veröffentlicht (bis 30.09.2026), hier noch nicht verwendet: Umsatzwachstum und Bruttogewinn-Wachstum, weil das Vorjahresquartal in den Anbieterdaten fehlt." Gold Fields (GFI) zeigt +68,2 % für das Geschäftsjahr 2025 mit `nur-jahreswerte` und dem Zusatz „laut Yahoo". Zhejiang Orient (600120.SS) zeigt das Geschäftsjahr 2025 mit `boersenabgleich`.

## 2. Zählung nach Board und Grund

Messweise: voller Exportlauf beider Stände (run-screener, findash-Export, Ausschlussliste, Rule of 40, Filter-Feed) auf denselben Snapshots des Lauf-Artefakts vom 21.11.2026, `RUN_DATE_UTC=2026-11-21`, OpInc- und FCF-Schritt einmal vorab angewandt. Speicher (FCF, Börsenquellen) sind die des Code-Stands 08c9b5ca, für beide Stände gleich; die Zeilenzahlen weichen deshalb um höchstens eine Zeile vom Live-Export ab (HyperGrowth 8.809 statt 8.808). Ohne Small-Cap-Speicher, daher keine Small-Cap-Zeilen.

**HyperGrowth, Vollboards (8.809 Zeilen, 4.683 gekennzeichnet; Beleg: 3.505 gespeichertes Quartal, 1.178 nur Yahoo)**

| Grund | Umsatzwachstum | Bruttogewinn-Wachstum |
|---|---|---|
| `vorjahr-fehlt` | 2.137 | 3.129 |
| `nur-jahreswerte` | 693 | 639 |
| `anbieter-verzug` | 385 | 357 |
| `boersenabgleich` | 119 | – |
| `paar-gesperrt` | 3 | 104 |
| **Summe** | **3.337** | **4.229** |

**HyperGrowth, Top-Listen (1.920 Zeilen, 978 gekennzeichnet; 709 Quartal, 269 Yahoo):** Umsatzwachstum 666 (`vorjahr-fehlt` 427, `nur-jahreswerte` 120, `anbieter-verzug` 92, `boersenabgleich` 26, `paar-gesperrt` 1); Bruttogewinn-Wachstum 862 (`vorjahr-fehlt` 620, `nur-jahreswerte` 136, `anbieter-verzug` 84, `paar-gesperrt` 22).

**Rule of 40 (484 Zeilen, 119 gekennzeichnet; 62 Quartal, 57 Yahoo):** Umsatzwachstum 111 (`vorjahr-fehlt` 55, `anbieter-verzug` 30, `nur-jahreswerte` 26), FCF-Marge 35 (`fcf-ttm-alt`).

**Filter-Feed (15.769 Zeilen, 6.045 mit `np`; 3.899 Quartal, 2.146 Yahoo):** Wachstum 5.893 (`vf` 3.625, `nj` 1.303, `av` 830, `ba` 124, `pg` 11), FCF-Marge 837 (`fa`). Größe 5.927.305 → 6.181.315 Byte (+254.010), Grenze 6.500.000, Luft 318.685 Byte.

## 3. Beweis: keine gezeigte Zahl ändert sich

- Beide Exportbäume wurden gleich neu geschrieben; aus dem neuen Stand wurden nur die Schlüssel `newerPeriod` und `np` entfernt und in beiden der Uhrzeit-Stempel `generated_at` geleert. Danach `node scripts/check-export-additive.js --provenance-content` (vergleicht jeden Wert, Herkunftskennungen nach Inhalt): **52 Dateien, 35.567 Zeilen, 2.756.812 Werte, 0 Abweichungen.**
- Ohne das Entfernen meldet derselbe Vergleich 18.771 Abweichungen: genau 18.758 neue Schlüssel (`newerPeriod` auf jeder Board-Zeile, auch als `null`, und `np` im Filter-Feed) plus 13 geänderte Vollboard-Dateien, sonst nichts.
- Gegenprobe: eine um 1e-9 verschobene Wachstumszahl in `full/energy.json` meldet der Vergleich sofort (2 Abweichungen).
- Alle drei `--check`-Tore grün wie vorher (Rule of 40 484 Zeilen, Filter OK); das findash-`--check` meldet in beiden Ständen dieselbe eine Verletzung `smallcap/index: boards`, weil der Small-Cap-Speicher lokal fehlt.

## 4. Abgleich mit der Diagnose

| | Zeilen |
|---|---|
| HyperGrowth, laut Diagnose veraltet und gekennzeichnet | 3.309 |
| laut Diagnose veraltet, nicht gekennzeichnet: neuerer Zeitraum nur im Börsenspeicher belegt | 33 (+1 Rule of 40) |
| laut Diagnose veraltet, nicht gekennzeichnet: neuestes Quartal per Handtabelle zurückgehalten (1941.T) | 1 |
| gekennzeichnet, in der Diagnose ohne Snapshot | 27 (+4 Rule of 40) |

## 5. Tests

- Neu: `tests/stale-period-label.test.js` (8 Fälle: veraltete Zeile mit Etikett, aktuelle ohne, Grenze 45/46 Tage, jeder Grund, Yahoo-Beleg, Datum nach dem Datentag, Kurzform, Vertragsprüfung in allen Schreibern). Einmal absichtlich rot gemacht (Vergleichsrichtung vertauscht: 6 von 8 rot), danach wieder grün mit unverändertem sha256.
- `lib/g31-recency.js` ist von GQS-00 versiegelt (`tests/scoring/gqs00-freeze.test.js`) und bleibt deshalb unverändert; `newerPeriod` steht in den HyperGrowth-Zeilen als letzter Schlüssel hinter dem G31-Block. Fünf Tests, die die Schlüsselreihenfolge festhalten, lassen den neuen Schlüssel jetzt ausdrücklich aus (export-w8-ffo-reason, export-w8-rev-growth-reason, fcf-stmt-shadow, g31-aktualitaet-p184, mcap-classes-shadow). `configs/feed-fill-floors.json` bekommt für `np` die Untergrenze 0 (fehlend heißt aktuell, wie `aus`).
- Neuer Leser in `tests/fixtures/yahoo-q4-reader-policy.json` eingetragen (`upstream`).
- `node scripts/test-gate.js --mode=blocking` im Klon (Windows): 19 Testdateien rot, alle 19 auf dem unveränderten Stand 08c9b5ca im selben Klon ebenso rot (Umgebung, nicht diese Änderung); `tests/non-operating-classes.test.js` war im zweiten Lauf nur wegen einer CRLF-Arbeitskopie rot und ist mit LF (wie in CI) grün. Grün unter anderem: `jsdoc-exports`, `yahoo-q4-known-cases`, `source-priority`, `scoring/gqs00-freeze`, `w6-filter-universe`, `feed-fill-guard`, `export-hinweis-neuerer-bericht`.

## 6. Grenzen

- Börsenspeicher (MOPS, Eastmoney, HK-Halbjahre) liest das Etikett nicht; das kostet heute 34 Zeilen. Einbauen, sobald diese Zeilen sichtbar stören (Sicherheit, dass es weniger als 1 % der veralteten Zeilen bleibt: 80 %).
- Wo nur Yahoos `mostRecentQuarter` den neueren Zeitraum belegt (1.178 HyperGrowth-Zeilen), ist nicht an der Primärquelle geprüft, dass er veröffentlicht ist; das Feld sagt das mit `evidence: "yahoo"` und der Hinweis mit „laut Yahoo" (Sicherheit, dass der Zeitraum veröffentlicht ist: 85 %, aus der Diagnose).
- Der Hinweis `neuerer-bericht` in `g31Hinweis` bleibt unverändert bestehen (Exportvertrag: nur hinzufügen); beide nennen dasselbe Datum.
- findash zeigt das Feld noch nicht an; das ist ein eigener Schritt.
