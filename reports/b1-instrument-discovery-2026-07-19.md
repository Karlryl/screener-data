# B1 Discovery-Instrumentierung (2026-07-19)

Protokoll: Tag 389, SHA-256 `7b20e750…cf0f79`. Scope: NUR ≤ 2018-12-31 (§6). Keine Preise, keine Outcomes, Validation unberührt. Erkennung: geteilte lib/b1-detect.js.

## Zählwerk

| Größe | Wert |
| --- | --- |
| CIKs im Archiv  | 20072 |
| davon geparst / ohne Umsatzserie | 20072 / 8745 |
| Firmen-Quartale evaluiert (≤2018) | 111467 |
| davon auswertbar (ΔYoY(t) UND ΔYoY(t−1) definiert) | 53415 |
| YoY-/ΔYoY-Ausfälle | 49302 / 8670 |
| OpMargin undefiniert | 12981 |
| Punkte mit abgeleitetem Q4 beteiligt | 10943 |
| **Event-Kandidaten gesamt (§1-Kriterien)** | **1315** |
| davon heute ticker-mappbar (Preis-Chance) | 375 (29 %) |
| Kalenderquartale mit ≥1 Event (Cluster-Grundlage) | 34 |

## Events je Kalenderquartal

```json
{
 "2018Q4": 75,
 "2017Q1": 59,
 "2016Q4": 42,
 "2016Q3": 42,
 "2017Q3": 39,
 "2015Q3": 49,
 "2015Q2": 46,
 "2018Q3": 72,
 "2016Q2": 41,
 "2016Q1": 34,
 "2018Q2": 41,
 "2010Q3": 3,
 "2013Q3": 63,
 "2013Q4": 59,
 "2015Q4": 28,
 "2012Q3": 50,
 "2014Q4": 45,
 "2011Q4": 12,
 "2013Q2": 41,
 "2017Q2": 46,
 "2014Q3": 64,
 "2014Q2": 53,
 "2011Q3": 14,
 "2012Q4": 46,
 "2018Q1": 26,
 "2015Q1": 51,
 "2013Q1": 56,
 "2014Q1": 43,
 "2012Q2": 14,
 "2012Q1": 13,
 "2017Q4": 30,
 "2010Q4": 6,
 "2011Q1": 4,
 "2011Q2": 8
}
```

Kohorten-Detail (n, winsorisierte P90-Schwelle, belowMinN): siehe JSON.

Laufzeit: 80 s.