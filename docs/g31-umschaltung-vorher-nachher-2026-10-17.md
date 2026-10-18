> **Auf einen Blick**
>
> Auf dem Datenstand vom 17.10.2026 wechseln durch die G31-Umschaltung 34 von 668 Plätzen unter den ersten 20 (Wachstum 27 von 428, Qualität 3 von 220, Rule of 40 4 von 20). Jede Wachstumszahl stammt jetzt aus dem neuesten gültigen gemeldeten Zeitraum und trägt dessen Basis und, wo gespeichert, dessen Enddatum.
> - Ursache der Platzwechsel ist fast nur B1: 1198 Firmen rechnen das neueste Quartal jetzt gegen ihr datiertes Vorjahresquartal, obwohl dazwischen ein Quartal leer ist (42 davon unter den ersten 20). 6 dieser 42 Spitzenzeilen passen nicht zur gespeicherten Jahreszahl (Beispiel SAUD3.SA: 1.213 % statt 6,09 %).
> - Ein späteres Geschäftsjahr gewinnt bei 125 Firmen gegen ein älteres Quartal (B2), darunter PENG 47,64 % → 26,5 % (Geschäftsjahr bis 31.08.2026).
> - Die Übersichtsspalte (Bruttogewinn, Umsatz-Badge) zeigt bei 2.178 von 2.798 sichtbaren Zeilen einen anderen Wert, den des neuesten beschrifteten Zeitraums; das ändert keinen Score, Rang und keine Mitgliedschaft. Der Small-Cap-Bestand ist nicht nachgerechnet, seine Wirkung ist unbekannt, nicht null.

# G31-Umschaltung: vorher und nachher (Datenstand 17.10.2026)

## Messung

Beide Arme rechnen denselben Tageslauf vom 17.10.2026 nach, genau wie im Vorher/Nachher der Handtabelle vom 18.10.2026: Code und Daten des Auslösecommits `df47be8`, das Snapshot-Artefakt des Laufs 39036704898 (16.111 Dateien), dessen Übergabedateien (ATH-Stand, Makroregime, Abdeckung), feste Uhr 2026-10-17T14:47:00Z und dieselben Schritte wie im Bewertungsjob (OpInc-Quelle, Screener, Wert-Merkliste, findash-Export, Ausschlussliste, Rule of 40, Filter, Bewertung, Board-Vintage). Der einzige Unterschied ist der Code dieses Zweigs (Commit `777de27` auf `df47be8` angewandt; der Bewertungscode von `df47be8` ist mit `b59a1d1` identisch).

**Nachstellung geprüft:** Der Vorher-Arm ist in allen 63 Listen außerhalb des Small-Cap-Bestands bei jedem Rang und jedem Score identisch mit dem Vorher-Arm des Handtabellen-Laufs, der laut dessen Vorher/Nachher (PR #10, `docs/handtabelle-20261018-vorher-nachher-2026-10-17.md`) den veröffentlichten Export vom 17.10. (gh-pages) trifft; abweichend sind nur die Herkunftsangaben (Laufkennung und Zeit).

Wie im Tageslauf werden Perzentile, Winsor-Grenzen und Wachstumsbonus im Nachher-Arm neu gelernt. Deshalb bewegen sich auch Firmen, deren eigene Zahl gleich bleibt.

## Ergebnis je Board

| Board | Liste | Top 20 vorher | Eintritte = Austritte | sichtbare Zeilen | Wachstum geändert | Score geändert | Rang geändert |
|---|---|---:|---:|---:|---:|---:|---:|
| Wachstum consumer-discretionary | profitabel | 20 | 0 | 100 | 2 | 56 | 66 |
| Wachstum consumer-discretionary | unprofitabel | 20 | 2 | 100 | 12 | 95 | 77 |
| Wachstum consumer-staples | profitabel | 20 | 0 | 100 | 6 | 73 | 56 |
| Wachstum energy | profitabel | 20 | 2 | 100 | 4 | 99 | 93 |
| Wachstum energy | unprofitabel | 20 | 0 | 31 | 1 | 17 | 6 |
| Wachstum financials | profitabel | 20 | 1 | 100 | 11 | 98 | 40 |
| Wachstum financials | unprofitabel | 20 | 0 | 41 | 3 | 35 | 5 |
| Wachstum health-care | profitabel | 20 | 2 | 100 | 6 | 87 | 70 |
| Wachstum health-care | unprofitabel | 20 | 2 | 100 | 7 | 91 | 74 |
| Wachstum industrials | profitabel | 20 | 0 | 100 | 6 | 92 | 62 |
| Wachstum industrials | unprofitabel | 20 | 2 | 100 | 15 | 96 | 85 |
| Wachstum it-services | profitabel | 20 | 1 | 100 | 12 | 79 | 73 |
| Wachstum materials | profitabel | 20 | 0 | 100 | 2 | 79 | 62 |
| Wachstum real-estate | profitabel | 20 | 3 | 100 | 13 | 86 | 94 |
| Wachstum semiconductors | profitabel | 20 | 2 | 100 | 5 | 70 | 71 |
| Wachstum semiconductors | unprofitabel | 20 | 1 | 75 | 3 | 48 | 32 |
| Wachstum software-comm-services | profitabel | 20 | 1 | 100 | 3 | 90 | 76 |
| Wachstum software-comm-services | unprofitabel | 20 | 2 | 100 | 15 | 85 | 83 |
| Wachstum tech-hardware | profitabel | 20 | 1 | 100 | 8 | 88 | 74 |
| Wachstum tech-hardware | unprofitabel | 20 | 1 | 100 | 18 | 88 | 68 |
| Wachstum utilities | profitabel | 20 | 4 | 100 | 4 | 100 | 94 |
| Wachstum utilities | unprofitabel | 8 | 0 | 10 | 1 | 10 | 4 |
| Qualität consumer-discretionary | profitabel | 20 | 0 | 100 | 6 | 27 | 43 |
| Qualität consumer-staples | profitabel | 20 | 0 | 100 | 2 | 32 | 52 |
| Qualität energy | profitabel | 20 | 1 | 100 | 3 | 90 | 45 |
| Qualität health-care | profitabel | 20 | 0 | 100 | 5 | 42 | 50 |
| Qualität industrials | profitabel | 20 | 0 | 100 | 4 | 68 | 73 |
| Qualität it-services | profitabel | 20 | 0 | 100 | 8 | 70 | 37 |
| Qualität materials | profitabel | 20 | 0 | 100 | 5 | 91 | 48 |
| Qualität semiconductors | profitabel | 20 | 1 | 100 | 4 | 28 | 44 |
| Qualität software-comm-services | profitabel | 20 | 0 | 100 | 3 | 79 | 32 |
| Qualität tech-hardware | profitabel | 20 | 1 | 100 | 5 | 71 | 56 |
| Qualität utilities | profitabel | 20 | 0 | 100 | 6 | 70 | 52 |
| Rule of 40 | alle | 20 | 4 | 484 → 497 | 14 | – | – |
| **Summe** | | **668** | **34** | | | | |

Vollständige Wachstums-Kohorten (findash `full/`, 9.558 Zeilen): Wachstum bei 934, Score bei 8.162 und Rang bei 7.867 Zeilen geändert. Für Qualität gibt es keinen exportierten Vollbestand; die 100 sichtbaren Zeilen je Liste enthalten jeden Platz unter den ersten 20.
Überblick (200 Zeilen): Eintritt unter die ersten 20 7685.T, Austritt CHENNPETRO.NS; 6 Firmen kommen in die 200, 6 gehen. Qualität-Überblick: 0 Wechsel unter den ersten 20, 3 Wechsel in den 200.

## Alle Wechsel unter den ersten 20

| Board | Liste | Firma | Rang vorher → nachher | Score vorher → nachher | Wachstum vorher → nachher | Zeitraum vorher → nachher |
|---|---|---|---:|---:|---:|---|
| Eintritt Wachstum consumer-discretionary | unprofitabel | 600501.SS | 22 → 4 | 62,4 → 82,3 | -11,14 % → 52,13 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum consumer-discretionary | unprofitabel | 000599.SZ | 27 → 9 | 61 → 76,5 | 6,84 % → 533,32 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum energy | profitabel | 300191.SZ | 33 → 17 | 72,2 → 78,8 | 46,88 % → 317,09 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum energy | profitabel | VAR.OL | 63 → 18 | 65 → 78,3 | 8,05 % → 102,71 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum financials | profitabel | 601211.SS | 24 → 8 | 70,8 → 78,5 | 23,89 % → 146,31 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum health-care | profitabel | SAUD3.SA | 99 → 10 | 70 → 89,5 | 6,09 % → 1.213 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum health-care | profitabel | 2359.HK | 29 → 14 | 80 → 87,1 | 15,84 % → 47,71 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum health-care | unprofitabel | MESO | 21 → 19 | 78,9 → 79 | 599,21 % → 599,21 % | Geschäftsjahr bis 30.06.2026 → Geschäftsjahr bis 30.06.2026 |
| Eintritt Wachstum health-care | unprofitabel | 290650.KQ | 22 → 20 | 76,9 → 77,3 | 88,45 % → 88,45 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Eintritt Wachstum industrials | unprofitabel | 688646.SS | 29 → 9 | 66,8 → 77,7 | 16,03 % → 171,46 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum industrials | unprofitabel | 688660.SS | 24 → 12 | 68,8 → 76,3 | 31,07 % → 130,72 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum it-services | profitabel | 301085.SZ | 81 → 10 | 48,7 → 76,1 | -2,68 % → 45,87 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum real-estate | profitabel | CBDK.JK | 48 → 3 | 72,8 → 89,9 | 11,32 % → 89,73 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum real-estate | profitabel | PANI.JK | 23 → 19 | 79,4 → 80,4 | 52,37 % → 75,3 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum real-estate | profitabel | MINDSPACE.BO | 25 → 20 | 77,9 → 80,2 | 26,18 % → 30,9 % | Geschäftsjahr bis 31.03.2026 → Quartal bis 30.06.2026 |
| Eintritt Wachstum semiconductors | profitabel | AMD | 22 → 19 | 74,2 → 74,2 | 50,11 % → 50,11 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Eintritt Wachstum semiconductors | profitabel | 688525.SS | 21 → 20 | 74,2 → 74,2 | 269,81 % → 269,81 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Eintritt Wachstum semiconductors | unprofitabel | 2577.HK | 22 → 20 | 56,1 → 57,1 | 46,45 % → 46,45 % | Geschäftsjahr bis 31.12.2025 → Geschäftsjahr bis 31.12.2025 |
| Eintritt Wachstum software-comm-services | profitabel | TOTS3.SA | 50 → 17 | 71,6 → 80,1 | 17,44 % → 36,09 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum software-comm-services | unprofitabel | 600986.SS | 33 → 11 | 60,7 → 72,5 | 8,38 % → 52,92 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum software-comm-services | unprofitabel | 0100.HK | 21 → 19 | 67 → 66,9 | 158,95 % → 158,95 % | Geschäftsjahr bis 31.12.2025 → Geschäftsjahr bis 31.12.2025 |
| Eintritt Wachstum tech-hardware | profitabel | 605118.SS | 26 → 12 | 78,4 → 82,1 | 33,85 % → 62,15 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum tech-hardware | unprofitabel | 002436.SZ | 21 → 20 | 61 → 60,8 | 20,22 % → 20,22 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Eintritt Wachstum utilities | profitabel | 600292.SS | 293 → 4 | 25,1 → 91,2 | -15,9 % → 278,02 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum utilities | profitabel | ISAE3.SA | 31 → 5 | 80 → 91 | 18,13 % → 81,28 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum utilities | profitabel | 600163.SS | 168 → 15 | 52,4 → 83,8 | -7,69 % → 128,08 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Wachstum utilities | profitabel | ALUP3.SA | 109 → 17 | 62,8 → 83,4 | 9,89 % → 55,4 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Qualität energy | profitabel | SDE.TO | 36 → 17 | 67,6 → 70,8 | 31,47 % → 113,2 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Eintritt Qualität semiconductors | profitabel | 603061.SS | 21 → 20 | 75,8 → 75,8 | 77,17 % → 77,17 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Eintritt Qualität tech-hardware | profitabel | 605118.SS | 25 → 19 | 77,4 → 79,1 | 33,85 % → 62,15 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Wachstum consumer-discretionary | unprofitabel | 600676.SS | 19 → 21 | 63,2 → 62,2 | 8,32 % → 8,32 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum consumer-discretionary | unprofitabel | IP | 20 → 22 | 62,8 → 61,9 | -2,25 % → -2,25 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum energy | profitabel | OKE | 18 → 21 | 77,7 → 77,3 | 52,77 % → 52,77 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum energy | profitabel | ITH.L | 19 → 22 | 77,3 → 77,1 | 8,67 % → 8,67 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum financials | profitabel | CUPRUM.SN | 20 → 21 | 71,7 → 71,3 | 16,6 % → 16,6 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum health-care | profitabel | 688278.SS | 19 → 21 | 84,5 → 84,3 | 24,07 % → 24,07 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum health-care | profitabel | 1548.HK | 20 → 22 | 83,9 → 83,8 | 61,4 % → 61,4 % | Geschäftsjahr bis 31.12.2025 → Geschäftsjahr bis 31.12.2025 |
| Austritt Wachstum health-care | unprofitabel | 298380.KQ | 8 → 99 | 84,2 → 54,3 | 137,55 % → -73,99 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Wachstum health-care | unprofitabel | 688488.SS | 17 → 47 | 79,8 → 67,5 | 72,13 % → 14,1 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Wachstum industrials | unprofitabel | NX | 19 → 22 | 72,3 → 70,5 | 1,33 % → 1,33 % | Quartal bis 31.07.2026 → Quartal bis 31.07.2026 |
| Austritt Wachstum industrials | unprofitabel | PL | 20 → 21 | 71,9 → 71,2 | 58,14 % → 58,14 % | Quartal bis 31.07.2026 → Quartal bis 31.07.2026 |
| Austritt Wachstum it-services | profitabel | 688225.SS | 13 → 102 | 74 → 42,1 | 115,31 % → -16,78 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Wachstum real-estate | profitabel | 600064.SS | 3 → 72 | 92,2 → 68,8 | 72,61 % → -10,85 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Wachstum real-estate | profitabel | 2548.TW | 5 → 198 | 89,2 → 57,1 | 152,88 % → -25,56 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Wachstum real-estate | profitabel | 002314.SZ | 14 → 145 | 82,3 → 61,1 | 55,55 % → -1,68 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Wachstum semiconductors | profitabel | 6809.HK | 13 → 34 | 77 → 72,4 | 49,94 % → 32,85 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Wachstum semiconductors | profitabel | 3563.TW | 16 → 124 | 75,3 → 52,3 | 108,34 % → 8,1 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Wachstum semiconductors | unprofitabel | 301666.SZ | 20 → 22 | 56,2 → 56,1 | 656,4 % → 656,4 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum software-comm-services | profitabel | KARO | 20 → 21 | 78,8 → 78,6 | 22,47 % → 22,47 % | Quartal bis 31.05.2026 → Quartal bis 31.05.2026 |
| Austritt Wachstum software-comm-services | unprofitabel | 0020.HK | 19 → 22 | 67,2 → 65,9 | 32,94 % → 32,94 % | Geschäftsjahr bis 31.12.2025 → Geschäftsjahr bis 31.12.2025 |
| Austritt Wachstum software-comm-services | unprofitabel | AMAGI.NS | 20 → 21 | 67,1 → 66 | 32,36 % → 32,36 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum tech-hardware | profitabel | 2308.TW | 20 → 21 | 79,6 → 79,4 | 47,75 % → 47,75 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum tech-hardware | unprofitabel | 002214.SZ | 15 → 22 | 66,6 → 60,4 | 26,41 % → 2,2 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Wachstum utilities | profitabel | ADANIPOWER.NS | 16 → 22 | 83,1 → 82,2 | 33,97 % → 33,97 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum utilities | profitabel | VEDPOWER.BO | 17 → 23 | 83 → 82,2 | 30,99 % → 30,99 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum utilities | profitabel | CLEANMAX.BO | 19 → 21 | 82,7 → 82,3 | 107,36 % → 107,36 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Wachstum utilities | profitabel | ENEL.VI | 20 → 25 | 82,4 → 81,6 | 30,29 % → 30,29 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Qualität energy | profitabel | 2222.SR | 20 → 21 | 69,5 → 69,4 | 28,16 % → 28,16 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Qualität semiconductors | profitabel | 3563.TW | 9 → 21 | 82,1 → 75,7 | 108,34 % → 8,1 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Austritt Qualität tech-hardware | profitabel | HMS.ST | 20 → 21 | 78,1 → 78 | 17,56 % → 17,56 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Eintritt Rule of 40 | alle | RHLD | – → 17 | r40 – → 190,4 | – → 295,7 % | – → Quartal bis 30.06.2026 |
| Eintritt Rule of 40 | alle | 002993.SZ | – → 18 | r40 – → 189,6 | – → 268,6 % | – → Quartal bis 30.06.2026 |
| Eintritt Rule of 40 | alle | 300475.SZ | 23 → 19 | r40 175,3 → 189,3 | 295,3 % → 295,3 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Eintritt Rule of 40 | alle | 2344.TW | 24 → 20 | r40 174,3 → 188,3 | 184,7 % → 184,7 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Rule of 40 | alle | BE | 15 → 24 | r40 182,6 → 182,6 | 165,5 % → 165,5 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Rule of 40 | alle | 420770.KQ | 16 → 25 | r40 181,6 → 181,6 | 150,8 % → 150,8 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |
| Austritt Rule of 40 | alle | GGP.AX | 17 → 27 | r40 180,5 → 180,5 | 158,2 % → 158,2 % | Geschäftsjahr bis 30.06.2026 → Geschäftsjahr bis 30.06.2026 |
| Austritt Rule of 40 | alle | EQX | 20 → 29 | r40 178 → 179,3 | 169,3 % → 169,3 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |

Von den 60 Wechseln in Wachstum und Qualität betreffen 32 Firmen, deren eigene Wachstumszahl sich ändert; die übrigen 28 folgen aus der neuen Rangfolge und den neu gelernten Perzentilen. In Rule of 40 kommen RHLD und 002993.SZ mit geänderter Zahl neu dazu, die übrigen sechs Wechsel sind Verschiebungen.

Ränge der Wachstums-Boards stammen aus den vollständigen Kohorten, auch wo eine Firma außerhalb der sichtbaren 100 stand. Austritte ohne eigene Zahlenänderung entstehen nur aus der neuen Rangfolge der Nachbarn.

## Größte Bewegungen (unter den ersten 20 vorher oder nachher)

| Board | Liste | Firma | Rang vorher → nachher | Wachstum vorher → nachher | Zeitraum vorher → nachher |
|---|---|---|---:|---:|---|
| Wachstum utilities | profitabel | 600292.SS | 293 → 4 | -15,9 % → 278,02 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum real-estate | profitabel | 2548.TW | 5 → 198 | 152,88 % → -25,56 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum utilities | profitabel | 600163.SS | 168 → 15 | -7,69 % → 128,08 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum real-estate | profitabel | 002314.SZ | 14 → 145 | 55,55 % → -1,68 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum semiconductors | profitabel | 3563.TW | 16 → 124 | 108,34 % → 8,1 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum utilities | profitabel | ALUP3.SA | 109 → 17 | 9,89 % → 55,4 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum health-care | unprofitabel | 298380.KQ | 8 → 99 | 137,55 % → -73,99 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum health-care | profitabel | SAUD3.SA | 99 → 10 | 6,09 % → 1.213 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum it-services | profitabel | 688225.SS | 13 → 102 | 115,31 % → -16,78 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum it-services | profitabel | 301085.SZ | 81 → 10 | -2,68 % → 45,87 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum real-estate | profitabel | 600064.SS | 3 → 72 | 72,61 % → -10,85 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum energy | profitabel | VAR.OL | 63 → 18 | 8,05 % → 102,71 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum real-estate | profitabel | CBDK.JK | 48 → 3 | 11,32 % → 89,73 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum software-comm-services | profitabel | TOTS3.SA | 50 → 17 | 17,44 % → 36,09 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |
| Wachstum health-care | unprofitabel | 688488.SS | 17 → 47 | 72,13 % → 14,1 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |

## Ursachen

- **B1, leere Zwischenzeile:** 1198 Snapshots (222 sichtbare Zeilen, 42 unter den ersten 20) wechseln vom Geschäftsjahr auf das datierte Quartalspaar.
- **B2, späteres Geschäftsjahr:** 32 Snapshots mit belegtem neuerem Jahresdatensatz und 93 mit einem gespeicherten Geschäftsjahr, das nach dem neuesten Quartal endet (meist Quartalsreihen, die Jahre zurückliegen), wechseln vom Quartal auf das Geschäftsjahr; unter den ersten 20: 5292.KL, MU, PENG, ADV.VI.
- **B3, Wachstumsbonus:** Der Jahresbestandteil des Bonus nutzt den belegten neueren Jahresdatensatz auch neben einem Quartal (COST: 8,17 % → 10,14 %); Mittelwert und Begrenzung sind unverändert.
- **B4/B5, Übersichtsspalte:** reine Anzeige, siehe unten.

## Rule of 40

- Liste 484 → 497 Zeilen, 41 neu, 28 entfallen; unter den ersten 20 wechseln 4 Firmen (19 der 20 Plätze tragen eine andere Firma).
- Frische-Tor: Es prüft jetzt das Ende des Zeitraums der angezeigten Zahl statt des jüngsten Quartals mit Wert. Als veraltet abgewiesen werden dadurch 6 statt 222 Firmen (meist Firmen mit einer seit Jahren stehenden Quartalsreihe, deren angezeigte Zahl aus einem aktuellen Geschäftsjahr stammt); ohne belegbaren Zeitraum: 0 (vorher 0).
- Ursachen der 41 neuen Zeilen: 33 mit geänderter Wachstumszahl, 5 nur durch das Frische-Tor (vorher Anker über 550 Tage alt), 3 durch die neu gelernte Begrenzung oder Verdrängung. Die 28 entfallenen Zeilen standen alle auf Platz 41 oder tiefer.
- Wachstumsgrenzen (p1/p99) -38,91 / 168,08 → -40,14 / 182,14.

## Übersichtsspalte (B4/B5)

Bruttogewinnwachstum und Umsatz-Badge zeigen jetzt den beschrifteten neuesten Kandidaten: bei 2.178 von 2.798 sichtbaren Board-Zeilen mit Vergleichswert weicht der neue Wert ab, 441 davon unter den ersten 20. Beispiele: DAVE 70,4 % (Geschäftsjahr 2025) → 29,9 % (Quartal bis 30.06.2026), 2059.TW 90,1 % → 188,9 %, UWMC Umsatz-Badge 11,1 % → −117,2 % (gleich der Wachstumsspalte). Die Spalte ist kein Sortierschlüssel: die Prüfung in `tests/g31-umschaltung.test.js` rangiert dieselben Zeilen mit altem und neuem Übersichtswert und erhält identische Scores und Ränge.

## Datenqualität der neuen Quartalspaare

Eine reine Meldeprüfung (kein Filter) vergleicht jedes neu genutzte Quartalspaar mit dem gespeicherten letzten Geschäftsjahr: Quartal größer als das ganze Geschäftsjahr, Quartal über dem Dreifachen eines Durchschnittsquartals oder Vorjahresquartal unter 25 % davon (Schwelle des Basisquartal-Tors der Rule of 40). Betroffen sind 21 der 1198 B1-Snapshots, 11 sichtbare Zeilen und 6 Plätze unter den ersten 20:

| Firma | Wachstum vorher → nachher | Befund | Platz nachher |
|---|---:|---|---|
| 000563.SZ | -10,71 % → 47,34 % | Quartal > 3 × Durchschnitt | außerhalb der ersten 20 |
| 000599.SZ | 6,84 % → 533,32 % | Quartal > Geschäftsjahr, Quartal > 3 × Durchschnitt | hg/consumer-discretionary unprofitabel #9 |
| 002289.SZ | 48,64 % → 217,34 % | Quartal > 3 × Durchschnitt | hg/tech-hardware unprofitabel #14 |
| 002993.SZ | 11,38 % → 268,65 % | Quartal > 3 × Durchschnitt | r40#18 |
| 006800.KS | 38,07 % → 238,31 % | Quartal > Geschäftsjahr, Quartal > 3 × Durchschnitt | außerhalb der ersten 20 |
| 300611.SZ | 25,48 % → 238,99 % | Quartal > 3 × Durchschnitt | außerhalb der ersten 20 |
| 688507.SS | 22,97 % → 79,44 % | Vorjahresquartal < 25 % | hg/software-comm-services unprofitabel #4 |
| RHLD | 9,86 % → 295,65 % | Quartal > Geschäftsjahr, Quartal > 3 × Durchschnitt | r40#17 |
| SAUD3.SA | 6,09 % → 1.213 % | Quartal > Geschäftsjahr, Quartal > 3 × Durchschnitt | hg/health-care profitabel #10 |
| SIGMAADV.NS | 358,66 % → 7.078 % | Vorjahresquartal < 25 %, Quartal > 3 × Durchschnitt | außerhalb der ersten 20 |
| SUNC | 11,05 % → 164,55 % | Quartal > Geschäftsjahr, Quartal > 3 × Durchschnitt | außerhalb der ersten 20 |

Diese Zeilen zeigen eine dem Datenpfad entnommene, datierte Quartalszahl, die vor G31 nur deshalb verborgen blieb, weil eine Zwischenzeile fehlte. Ein Teil ist echtes Wachstum (etwa durch Zukäufe), ein Teil wahrscheinlich eine Mischung aus kumulierten und einzelnen Quartalen. Diese Änderung baut dafür bewusst keinen neuen Filter; ob vor dem Zusammenführen eine Plausibilitätsprüfung nötig ist, ist eine Methodenfrage für Claude und Codex.

## Grenzen

- Der Small-Cap-Bestand des 17.10. ist nicht abrufbar und nicht nachgerechnet; seine Wirkung ist unbekannt, nicht null. Small-Cap-Zeilen laufen beim nächsten Lauf durch dieselbe Auswahl.
- Für die Qualitäts-Boards gibt es keinen exportierten Vollbestand; gezählt sind die 100 sichtbaren Zeilen je Liste.
- Gerechnet ist ein einzelner Datentag. Die Zahlen gelten für die gespeicherten Daten vom 17.10.2026; ein besseres künftiges Anlageergebnis ist damit nicht belegt.
- Die Quartals- und Jahreswerte sind nicht einzeln gegen Unternehmensberichte geprüft; die Meldeprüfung oben nennt nur auffällige Paare.

## Nachweis

Gerechnet in zwei Arbeitskopien außerhalb des Repositorys mit identischen Eingaben; alle Rohdateien blieben unverändert. Die Zahlen stammen aus dem Vergleich der beiden Exportbäume (`outputs/findash-export/v1`, Board-Listen, `full/`, `quality/`, `rule40/`) und aus der Rule-of-40-Zählung in `rule40/index.json`.
