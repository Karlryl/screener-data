# B1 Discovery-Instrumentierung (2026-07-19)

Protokoll: Tag 389, SHA-256 `7b20e750…cf0f79`. Scope: NUR ≤ 2018-12-31 (§6). Keine Preise, keine Outcomes, Validation unberührt.

## Zählwerk

| Größe | Wert |
| --- | --- |
| CIKs im Archiv  | 20072 |
| davon geparst / ohne Umsatzserie / zu kurz (<6 Discovery-Q) | 20072 / 8745 / 4829 |
| Firmen-Quartale evaluiert (≤2018) | 103815 |
| davon auswertbar (ΔYoY(t) UND ΔYoY(t−1) definiert) | 53183 |
| YoY-/ΔYoY-Ausfälle | 42311 / 8252 |
| OpMargin undefiniert | 12953 |
| Punkte mit abgeleitetem Q4 beteiligt | 10900 |
| **Event-Kandidaten gesamt (§1-Kriterien)** | **1310** |
| davon heute ticker-mappbar (Preis-Chance) | 373 (28 %) |
| Kalenderquartale mit ≥1 Event (Cluster-Grundlage) | 34 |

## Events je Kalenderquartal

```json
{
 "2010Q3": 3,
 "2010Q4": 6,
 "2011Q1": 4,
 "2011Q2": 8,
 "2011Q3": 14,
 "2011Q4": 12,
 "2012Q1": 13,
 "2012Q2": 15,
 "2012Q3": 50,
 "2012Q4": 46,
 "2013Q1": 56,
 "2013Q2": 41,
 "2013Q3": 63,
 "2013Q4": 59,
 "2014Q1": 43,
 "2014Q2": 53,
 "2014Q3": 64,
 "2014Q4": 45,
 "2015Q1": 51,
 "2015Q2": 46,
 "2015Q3": 49,
 "2015Q4": 28,
 "2016Q1": 34,
 "2016Q2": 41,
 "2016Q3": 42,
 "2016Q4": 42,
 "2017Q1": 59,
 "2017Q2": 45,
 "2017Q3": 37,
 "2017Q4": 30,
 "2018Q1": 25,
 "2018Q2": 40,
 "2018Q3": 72,
 "2018Q4": 74
}
```

Kohorten-Detail (n, winsorisierte P90-Schwelle, belowMinN): siehe JSON.

Laufzeit: 65 s.