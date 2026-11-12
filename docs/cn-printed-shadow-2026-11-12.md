# China Q3, gedruckte Vergleichszahlen

> **Auf einen Blick**
> 223 von 274 erfassten Tickern erkannt (81.39 %).
> Reine Schattenmessung; keine Board-Zahl wird geändert.
> 300er-Live-Tor: nicht bestanden; nach diesem Bericht stoppen.

Zählebene: Ticker. Snapshot-Stand: 2026-11-11. Juli-Vintage: 2026-07-29.
Die 1.086 und 1.222 im Auftrag stammen aus einem früheren Stand. Hier werden vorhandene Juli-Zeile und fehlende Juli-Zeile am gelieferten Snapshot-Satz gezählt. Eine Juli-Zeile ist keine Freigabe des alten Füllwegs.

| Gruppe | Ticker | Q3 aktuell, Vorjahr fehlt | agree | mixed-basis | nur gedruckt | unparsed |
|---|---:|---:|---:|---:|---:|---:|
| no-july-row | 1594 | 1435 | 105 | 2 | 0 | 1328 |
| july-row | 1285 | 1206 | 113 | 1 | 0 | 1092 |

Die Statusspalten beziehen sich auf die Kandidaten. Nicht abgerufene Ticker sind benannte Lücken und gehen nicht in die Parserquote ein.

| Börse / Layout | Erfasst | Erkannt | Quote |
|---|---:|---:|---:|
| SZ | 134 | 100 | 74.63 % |
| SS | 140 | 123 | 87.86 % |
| SZ/unparsed | 34 | 0 | 0.00 % |
| SZ/growth-below | 56 | 56 | 100.00 % |
| SZ/growth-inline | 40 | 40 | 100.00 % |
| SZ/restated | 3 | 3 | 100.00 % |
| SZ/restated-wrapped | 1 | 1 | 100.00 % |
| SS/growth-below | 81 | 81 | 100.00 % |
| SS/growth-above | 16 | 16 | 100.00 % |
| SS/growth-inline | 20 | 20 | 100.00 % |
| SS/unparsed | 17 | 0 | 0.00 % |
| SS/restated | 6 | 6 | 100.00 % |

Vergleich insgesamt: {"unparsed":2656,"agree":220,"mixed-basis":3}.
Benannte Fehler: {"security-code-not-in-header":21,"unknown-prior-column-layout":6,"revenue-or-ytd-anchor-mismatch":11,"text-empty":1,"growth-column-missing":3,"operating-revenue-anchor-missing":1,"printed-prior-growth-inconsistent":2,"ambiguous-growth-column":2,"not-first-revenue-row":4}.

Verglichen wird 营业收入 mit Eastmoney OPERATE_INCOME, jeweils Q3 = 9M − H1. 营业总收入 / TOTAL_OPERATE_INCOME wird nicht beigemischt. mixed-basis bezeichnet eine Abweichung außerhalb des Rundungsbands; deren Ursache bleibt ungeklärt.
Bei berichtigten Vergleichsspalten gilt 调整后. Sonst ist das Vorjahr ein aus dem gedruckten Wachstum berechnetes Intervall, keine exakt gedruckte Zahl. Erkennungsbasis für Zeile und Einheit sind zwei Wertanker; verlorene chinesische Textzeichen werden nicht als gelesen ausgegeben.

## Zehn Belege

- [000651.SZ](https://static.cninfo.com.cn/finalpage/2026-10-27/1225627217.PDF), Seite 2, agree, Einheit 1 CNY. Zitat: `36,677,556,545.36 126,075,079,046.57 / -7.97% -8.10%`.
- [600031.SS](https://static.cninfo.com.cn/finalpage/2026-10-30/1225639954.PDF), Seite 1, agree, Einheit 1000 CNY. Zitat: `24,804,219 / 2,664,635 21,207,370 21,207,370 78,109,737 / 2,322,193 2,322,193 9,328,265 (%) / (%) / 65,741,014 65,741,014 18.81 / 11.06 / 16.96 8,399,104 8,399,104`.
- [000002.SZ](https://static.cninfo.com.cn/finalpage/2026-10-30/1225644984.PDF), Seite unbekannt, unparsed, Einheit unbekannt CNY. Zitat: `security-code-not-in-header`.
- [000006.SZ](https://static.cninfo.com.cn/finalpage/2026-10-29/1225634487.PDF), Seite unbekannt, unparsed, Einheit unbekannt CNY. Zitat: `security-code-not-in-header`.
- [000008.SZ](https://static.cninfo.com.cn/finalpage/2026-10-31/1225647202.PDF), Seite 2, agree, Einheit 1 CNY. Zitat: `313,499,155.03 904,612,424.03 / -16,043,417.32 -69,430,895.77 -20.40% / -44.44%`.
- [000009.SZ](https://static.cninfo.com.cn/finalpage/2026-10-30/1225645110.PDF), Seite 2, agree, Einheit 1 CNY. Zitat: `8,654,953,043.08 22,008,902,594.51 / 44.90% 30.91%`.
- [000011.SZ](https://static.cninfo.com.cn/finalpage/2026-10-30/1225640042.PDF), Seite unbekannt, unparsed, Einheit unbekannt CNY. Zitat: `security-code-not-in-header`.
- [000012.SZ](https://static.cninfo.com.cn/finalpage/2026-10-29/1225633747.PDF), Seite unbekannt, unparsed, Einheit unbekannt CNY. Zitat: `security-code-not-in-header`.
- [000019.SZ](https://static.cninfo.com.cn/finalpage/2026-10-27/1225626259.PDF), Seite unbekannt, unparsed, Einheit unbekannt CNY. Zitat: `security-code-not-in-header`.
- [000021.SZ](https://static.cninfo.com.cn/finalpage/2026-10-30/1225640380.PDF), Seite 2, agree, Einheit 1 CNY. Zitat: `4,623,169,275.65 30.66% 14.40% / 304,093,773.67 0.06% 12,901,626,446.04 12.15%`.

## Formelweg, noch nicht freigegeben

Vorschlag: ausschließlich fehlende Zellen 2025-09-30 ergänzen, wenn agree oder nur gedruckt vorliegt, der aktuelle Snapshot dieselbe Umsatzzeile in belegter Währung und Einheit trägt und der 300er-Lauf mindestens 90 % erreicht. Abweichungen bleiben Lücken. Claude und Codex prüfen den konkreten Vorschlag vor jeder Aktivierung.
Die JSON-Zeilen enthalten eine hypothetische Vorher/Nachher-Rechnung des Quartalspaars auf einem Snapshot-Tag. Das ist kein nachgerechneter Board-Score und keine Aktivierung. Bei abweichender aktueller Umsatzzeile wird auch dieser Vorschlag gesperrt.
