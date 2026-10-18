> **Auf einen Blick**
>
> Auf dem Datenstand vom 17.10.2026 wechseln durch die G31-Umschaltung 33 von 668 Plätzen unter den ersten 20 (Wachstum 25 von 428, Qualität 4 von 220, Rule of 40 4 von 20). Jede Wachstumszahl stammt aus dem neuesten gültigen gemeldeten Zeitraum und trägt dessen Basis und, wo gespeichert, dessen Enddatum.
> - Neu nachgerechnet nach der Codex-Prüfung P267: Der Small-Cap-Bestand des Laufs ist jetzt dabei; dort wechselt keiner der 219 Plätze unter den ersten 20, nur 2 Wachstumszahlen ändern sich.
> - 000599.SZ steht nicht mehr mit 533,32 % auf Platz 9: Das nicht rückwirkend angepasste Vorjahresquartal hält jetzt die Handtabelle (P268), es zählt das Geschäftsjahr mit 6,84 %. Die fünf geprüften Ausreißer (SAUD3.SA, 002289.SZ, 688507.SS, RHLD, 002993.SZ) bleiben mit ihren richtigen Zahlen und tragen einen Prüfhinweis (Übernahme oder Saisonbasis).
> - Die Übersichtsspalte trägt jetzt den Zeitraum genau ihres Werts; auf dem ganzen Datentag ergibt die Nachrechnung des Exports keinen einzigen Widerspruch zwischen Wert und Zeitraum.

# G31-Umschaltung: vorher und nachher (Datenstand 17.10.2026)

## Messung

Beide Arme rechnen denselben Tageslauf vom 17.10.2026 nach: Daten, Zustände und Laufeingaben des Auslösecommits `df47be8`, das Snapshot-Artefakt des Laufs 39036704898 (16.111 Dateien), die Übergabedateien (ATH-Stand, Makroregime, Abdeckung), feste Uhr 2026-10-17T14:47:00Z, kein Netz und dieselben Schritte wie im Bewertungsjob (OpInc-Quelle, Screener, Wert-Merkliste, findash-Export, Ausschlussliste, Rule of 40, Filter, Bewertung, Board-Vintage). Dazu kommt jetzt der Small-Cap-Bestand, den dieser Lauf geladen hat: Der Log des Bewertungsjobs nennt „Cache restored from key: snapshots-smallcap-store-39024469668“. Cache und Artefakt `smallcap-store-merged` hat der Small-Cap-Lauf 39024469668 in zwei aufeinanderfolgenden Schritten aus demselben Ordner `snapshots-smallcap` geschrieben (Cache 10:27:46, Artefakt 10:27:47 UTC). Das Artefakt-Archiv (sha256 116c20c9…cbc2f, gleich der von GitHub gemeldeten Prüfsumme) enthält 400 Dateien, alle bytegleich mit der in beiden Armen verwendeten Kopie. Belege außerhalb des Repositorys: `C:/Users/Anwender/.codex/t/g31b/sc17-provenance.txt` und `sc17-manifest.sha256`.

Der einzige Unterschied ist der Code (`lib`, `src`, `scripts`, `configs`, `protocol`): **vorher** `origin/main` `bd0201d` (enthält schon die Handtabelle vom 18.10. und die Emittenten-Rangregel Tag 1471), **nachher** dieser Zweig: zuerst `7ceda25` gerechnet, nach den Korrekturen der zweiten und dritten Codex-Prüfung erneut auf `30b476b` und `aaeb0a9` (Laufzeitcode gleich dem geprüften Kopf; spätere Commits ändern nur die Dokumentation). Gleiche Firmenliste, gleicher Datentag; Perzentile, Winsor-Grenzen und Wachstumsbonus werden wie im Tageslauf in beiden Armen gleich neu gelernt. Deshalb bewegen sich auch Firmen, deren eigene Zahl gleich bleibt.

Weil der Vorher-Arm jetzt den heutigen `main` statt `df47be8` nutzt, trifft er nicht mehr den veröffentlichten Export vom 17.10.; das ist gewollt, er isoliert die Wirkung dieses Zweigs gegenüber dem Stand, auf den er zusammengeführt würde.

## Ergebnis je Board

| Board | Liste | Top 20 vorher | Eintritte = Austritte | sichtbare Zeilen | Wachstum geändert | Score geändert | Rang geändert |
|---|---|---:|---:|---:|---:|---:|---:|
| Wachstum consumer-discretionary | profitabel | 20 | 0 | 100 | 2 | 53 | 63 |
| Wachstum consumer-discretionary | unprofitabel | 20 | 1 | 100 | 11 | 91 | 74 |
| Wachstum consumer-staples | profitabel | 20 | 0 | 100 | 3 | 70 | 53 |
| Wachstum energy | profitabel | 20 | 2 | 100 | 3 | 95 | 89 |
| Wachstum energy | unprofitabel | 20 | 0 | 31 | 1 | 17 | 6 |
| Wachstum financials | profitabel | 20 | 1 | 100 | 9 | 90 | 37 |
| Wachstum financials | unprofitabel | 20 | 0 | 41 | 3 | 35 | 5 |
| Wachstum health-care | profitabel | 20 | 2 | 100 | 4 | 84 | 67 |
| Wachstum health-care | unprofitabel | 20 | 2 | 100 | 4 | 87 | 69 |
| Wachstum industrials | profitabel | 20 | 0 | 100 | 5 | 87 | 57 |
| Wachstum industrials | unprofitabel | 20 | 2 | 100 | 15 | 93 | 81 |
| Wachstum it-services | profitabel | 20 | 1 | 100 | 9 | 76 | 70 |
| Wachstum materials | profitabel | 20 | 0 | 100 | 2 | 77 | 58 |
| Wachstum real-estate | profitabel | 20 | 3 | 100 | 7 | 80 | 88 |
| Wachstum semiconductors | profitabel | 20 | 2 | 100 | 4 | 69 | 68 |
| Wachstum semiconductors | unprofitabel | 20 | 1 | 75 | 3 | 48 | 32 |
| Wachstum software-comm-services | profitabel | 20 | 1 | 100 | 3 | 89 | 75 |
| Wachstum software-comm-services | unprofitabel | 20 | 1 | 100 | 16 | 92 | 85 |
| Wachstum tech-hardware | profitabel | 20 | 1 | 100 | 5 | 85 | 71 |
| Wachstum tech-hardware | unprofitabel | 20 | 1 | 100 | 18 | 87 | 67 |
| Wachstum utilities | profitabel | 20 | 4 | 100 | 2 | 93 | 86 |
| Wachstum utilities | unprofitabel | 8 | 0 | 10 | 1 | 10 | 4 |
| Qualität consumer-discretionary | profitabel | 20 | 0 | 100 | 6 | 27 | 43 |
| Qualität consumer-staples | profitabel | 20 | 0 | 100 | 2 | 32 | 52 |
| Qualität energy | profitabel | 20 | 1 | 100 | 3 | 90 | 45 |
| Qualität health-care | profitabel | 20 | 0 | 100 | 5 | 42 | 50 |
| Qualität industrials | profitabel | 20 | 0 | 100 | 4 | 68 | 73 |
| Qualität it-services | profitabel | 20 | 0 | 100 | 8 | 70 | 37 |
| Qualität materials | profitabel | 20 | 0 | 100 | 5 | 91 | 48 |
| Qualität semiconductors | profitabel | 20 | 1 | 100 | 4 | 28 | 44 |
| Qualität software-comm-services | profitabel | 20 | 1 | 100 | 4 | 81 | 47 |
| Qualität tech-hardware | profitabel | 20 | 1 | 100 | 5 | 71 | 56 |
| Qualität utilities | profitabel | 20 | 0 | 100 | 6 | 70 | 52 |
| Rule of 40 | alle | 20 | 4 | 484 → 497 | 14 | – | – |
| **Summe** | | **668** | **33** | | | | |

Small-Cap (20 Listen mit Zeilen, 251 sichtbare Zeilen, 219 Plätze unter den ersten 20): 0 Wechsel unter den ersten 20; Wachstum bei 2, Score bei 35 und Rang bei 21 Zeilen geändert.
Vollständige Wachstums-Kohorten (findash `full/`, 9.558 Zeilen): Wachstum bei 934, Score bei 8.172 und Rang bei 7.861 Zeilen geändert. Für Qualität gibt es keinen exportierten Vollbestand; die 100 sichtbaren Zeilen je Liste enthalten jeden Platz unter den ersten 20.
Überblick (200 Zeilen): Eintritt unter die ersten 20 7685.T, Austritt CHENNPETRO.NS.

## Alle Wechsel unter den ersten 20

| Board | Liste | Firma | Rang vorher → nachher | Score vorher → nachher | Wachstum vorher → nachher | Zeitraum vorher → nachher | Prüfhinweis |
|---|---|---|---:|---:|---:|---|---|
| Eintritt Wachstum consumer-discretionary | unprofitabel | 600501.SS | 22 → 4 | 62,4 → 83 | -11,14 % → 52,13 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum energy | profitabel | 300191.SZ | 33 → 17 | 72,2 → 78,8 | 46,88 % → 317,09 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum energy | profitabel | VAR.OL | 63 → 18 | 65 → 78,3 | 8,05 % → 102,71 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum financials | profitabel | 601211.SS | 24 → 8 | 70,8 → 78,5 | 23,89 % → 146,31 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum health-care | profitabel | SAUD3.SA | 99 → 10 | 70 → 89,5 | 6,09 % → 1.213,1 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 | Übernahme |
| Eintritt Wachstum health-care | profitabel | 2359.HK | 29 → 14 | 80 → 87,1 | 15,84 % → 47,71 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum health-care | unprofitabel | MESO | 21 → 19 | 78,9 → 79 | 599,21 % → 599,21 % | Geschäftsjahr bis 30.06.2026 → Geschäftsjahr bis 30.06.2026 |  |
| Eintritt Wachstum health-care | unprofitabel | 290650.KQ | 22 → 20 | 76,9 → 77,3 | 88,45 % → 88,45 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum industrials | unprofitabel | 688646.SS | 29 → 9 | 66,8 → 77,7 | 16,03 % → 171,46 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum industrials | unprofitabel | 688660.SS | 24 → 12 | 68,8 → 76,3 | 31,07 % → 130,72 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum it-services | profitabel | 301085.SZ | 81 → 10 | 48,7 → 76,1 | -2,68 % → 45,87 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum real-estate | profitabel | CBDK.JK | 48 → 3 | 72,8 → 89,9 | 11,32 % → 89,73 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum real-estate | profitabel | PANI.JK | 23 → 19 | 79,4 → 80,4 | 52,37 % → 75,3 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum real-estate | profitabel | MINDSPACE.BO | 25 → 20 | 77,9 → 80,2 | 26,18 % → 30,9 % | Geschäftsjahr bis 31.03.2026 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum semiconductors | profitabel | AMD | 22 → 19 | 74,2 → 74,2 | 50,11 % → 50,11 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum semiconductors | profitabel | 688525.SS | 21 → 20 | 74,2 → 74,2 | 269,81 % → 269,81 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum semiconductors | unprofitabel | 2577.HK | 22 → 20 | 56,1 → 57,1 | 46,45 % → 46,45 % | Geschäftsjahr bis 31.12.2025 → Geschäftsjahr bis 31.12.2025 |  |
| Eintritt Wachstum software-comm-services | profitabel | TOTS3.SA | 50 → 17 | 71,6 → 80,1 | 17,44 % → 36,09 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum software-comm-services | unprofitabel | 600986.SS | 32 → 11 | 60,8 → 72,6 | 8,38 % → 52,92 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum tech-hardware | profitabel | 605118.SS | 26 → 12 | 78,4 → 82,1 | 33,85 % → 62,15 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum tech-hardware | unprofitabel | 002436.SZ | 21 → 20 | 61 → 60,8 | 20,22 % → 20,22 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum utilities | profitabel | 600292.SS | 291 → 4 | 25,1 → 91,2 | -15,9 % → 278,02 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum utilities | profitabel | ISAE3.SA | 31 → 5 | 80 → 91 | 18,13 % → 81,28 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum utilities | profitabel | 600163.SS | 166 → 15 | 52,4 → 83,8 | -7,69 % → 128,08 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Wachstum utilities | profitabel | ALUP3.SA | 107 → 17 | 62,8 → 83,4 | 9,89 % → 55,4 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum consumer-discretionary | unprofitabel | IP | 20 → 21 | 62,8 → 62,3 | -2,25 % → -2,25 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum energy | profitabel | OKE | 18 → 21 | 77,7 → 77,3 | 52,77 % → 52,77 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum energy | profitabel | ITH.L | 19 → 22 | 77,3 → 77,1 | 8,67 % → 8,67 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum financials | profitabel | CUPRUM.SN | 20 → 21 | 71,8 → 71,4 | 16,6 % → 16,6 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum health-care | profitabel | 688278.SS | 19 → 21 | 84,5 → 84,3 | 24,07 % → 24,07 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum health-care | profitabel | 1548.HK | 20 → 22 | 83,9 → 83,8 | 61,4 % → 61,4 % | Geschäftsjahr bis 31.12.2025 → Geschäftsjahr bis 31.12.2025 |  |
| Austritt Wachstum health-care | unprofitabel | 298380.KQ | 8 → 99 | 84,2 → 54,3 | 137,55 % → -73,99 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum health-care | unprofitabel | 688488.SS | 17 → 47 | 79,8 → 67,5 | 72,13 % → 14,1 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum industrials | unprofitabel | NX | 19 → 22 | 72,3 → 70,5 | 1,33 % → 1,33 % | Quartal bis 31.07.2026 → Quartal bis 31.07.2026 |  |
| Austritt Wachstum industrials | unprofitabel | PL | 20 → 21 | 71,9 → 71,2 | 58,14 % → 58,14 % | Quartal bis 31.07.2026 → Quartal bis 31.07.2026 |  |
| Austritt Wachstum it-services | profitabel | 688225.SS | 13 → 102 | 74 → 42,1 | 115,31 % → -16,78 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum real-estate | profitabel | 600064.SS | 3 → 72 | 92,2 → 68,8 | 72,61 % → -10,85 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum real-estate | profitabel | 2548.TW | 5 → 198 | 89,2 → 57,1 | 152,88 % → -25,56 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum real-estate | profitabel | 002314.SZ | 14 → 145 | 82,3 → 61,1 | 55,55 % → -1,68 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum semiconductors | profitabel | 6809.HK | 13 → 34 | 77 → 72,4 | 49,94 % → 32,85 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum semiconductors | profitabel | 3563.TW | 16 → 124 | 75,3 → 52,3 | 108,34 % → 8,1 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum semiconductors | unprofitabel | 301666.SZ | 20 → 22 | 56,2 → 56,1 | 656,4 % → 656,4 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum software-comm-services | profitabel | KARO | 20 → 21 | 78,8 → 78,6 | 22,47 % → 22,47 % | Quartal bis 31.05.2026 → Quartal bis 31.05.2026 |  |
| Austritt Wachstum software-comm-services | unprofitabel | 0020.HK | 18 → 22 | 67,5 → 66 | 32,94 % → 32,94 % | Geschäftsjahr bis 31.12.2025 → Geschäftsjahr bis 31.12.2025 |  |
| Austritt Wachstum tech-hardware | profitabel | 2308.TW | 20 → 21 | 79,6 → 79,4 | 47,75 % → 47,75 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum tech-hardware | unprofitabel | 002214.SZ | 15 → 22 | 66,6 → 60,4 | 26,41 % → 2,2 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum utilities | profitabel | ADANIPOWER.NS | 16 → 22 | 83,1 → 82,2 | 33,97 % → 33,97 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum utilities | profitabel | VEDPOWER.BO | 17 → 23 | 83 → 82,2 | 30,99 % → 30,99 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum utilities | profitabel | CLEANMAX.BO | 19 → 21 | 82,7 → 82,3 | 107,36 % → 107,36 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Wachstum utilities | profitabel | ENEL.VI | 20 → 25 | 82,4 → 81,6 | 30,29 % → 30,29 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Eintritt Qualität energy | profitabel | SDE.TO | 36 → 17 | 67,6 → 70,8 | 31,47 % → 113,2 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Eintritt Qualität semiconductors | profitabel | 603061.SS | 21 → 20 | 75,8 → 75,8 | 77,17 % → 77,17 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Eintritt Qualität software-comm-services | profitabel | RDDT | 21 → 20 | 77,8 → 77,7 | 61,1 % → 61,1 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Eintritt Qualität tech-hardware | profitabel | 605118.SS | 25 → 19 | 77,4 → 79,1 | 33,85 % → 62,15 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Qualität energy | profitabel | 2222.SR | 20 → 21 | 69,5 → 69,4 | 28,16 % → 28,16 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Qualität semiconductors | profitabel | 3563.TW | 9 → 21 | 82,1 → 75,7 | 108,34 % → 8,1 % | Geschäftsjahr bis 31.12.2025 → Quartal bis 30.06.2026 |  |
| Austritt Qualität software-comm-services | profitabel | TNE.AX | 20 → 21 | 77,9 → 77,7 | 18,16 % → 18,16 % | Geschäftsjahr bis 30.09.2025 → Geschäftsjahr bis 30.09.2025 |  |
| Austritt Qualität tech-hardware | profitabel | HMS.ST | 20 → 21 | 78,1 → 78 | 17,56 % → 17,56 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Eintritt Rule of 40 | alle | RHLD | – → 17 | r40 – → 186,8 | – → 295,7 % | – → Quartal bis 30.06.2026 | Übernahme |
| Eintritt Rule of 40 | alle | 002993.SZ | – → 18 | r40 – → 186 | – → 268,6 % | – → Quartal bis 30.06.2026 | Übernahme |
| Eintritt Rule of 40 | alle | 300475.SZ | 23 → 19 | r40 175,3 → 185,7 | 295,3 % → 295,3 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Eintritt Rule of 40 | alle | 2344.TW | 24 → 20 | r40 174,3 → 184,7 | 184,7 % → 184,7 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Rule of 40 | alle | BE | 15 → 23 | r40 182,6 → 182,6 | 165,5 % → 165,5 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Rule of 40 | alle | 420770.KQ | 16 → 24 | r40 181,6 → 181,6 | 150,8 % → 150,8 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |
| Austritt Rule of 40 | alle | GGP.AX | 17 → 25 | r40 180,5 → 180,5 | 158,2 % → 158,2 % | Geschäftsjahr bis 30.06.2026 → Geschäftsjahr bis 30.06.2026 |  |
| Austritt Rule of 40 | alle | EQX | 20 → 27 | r40 178 → 179,3 | 169,3 % → 169,3 % | Quartal bis 30.06.2026 → Quartal bis 30.06.2026 |  |

Von den 58 Wechseln in Wachstum und Qualität betreffen 31 Firmen, deren eigene Wachstumszahl sich ändert; die übrigen 27 folgen aus der neuen Rangfolge und den neu gelernten Perzentilen. In Rule of 40 kommen RHLD und 002993.SZ mit geänderter Zahl neu dazu, die übrigen sechs Wechsel sind Verschiebungen.
Ränge der Wachstums-Boards stammen aus den vollständigen Kohorten, auch wo eine Firma außerhalb der sichtbaren 100 stand.

## Ursachen

- **B1, leere Zwischenzeile:** 1.194 Snapshots (Haupt- und Small-Cap-Bestand) wechseln vom Geschäftsjahr auf das datierte Quartalspaar. Sichtbar sind das 270 Boardzeilen von 222 Notierungen, darunter 47 Plätze unter den ersten 20 von 43 Notierungen (Wachstum, Qualität, Small-Cap und Rule of 40 zusammen; eine Notierung kann auf mehreren Boards stehen).
- **B2, späteres Geschäftsjahr:** 125 Snapshots wechseln vom Quartal auf ein später endendes, belegtes Geschäftsjahr; sichtbar 13 Boardzeilen von 10 Notierungen, unter den ersten 20: 5292.KL (zweimal), PENG, ADV.VI, MU. Beispiel PENG: 47,64 % (Quartal bis 31.05.2026) → 26,5 % (Geschäftsjahr bis 31.08.2026), Rang 9 → 14.
- **B3, Wachstumsbonus:** Der Jahresbestandteil des Bonus nutzt den belegten neueren Jahresdatensatz auch neben einem Quartal (COST: 8,17 % → 10,14 %); Mittelwert und Begrenzung sind unverändert.
- **Halbjahre und Dauerwidersprüche:** Kein Paar des Datentags ist als 6M/6M gespeichert, keines als 6M gegen 3M; die neue Dauerprüfung ändert am 17.10. nichts.
- **Handtabelle:** 000599.SZ (Vorjahresquartal 2025 vor der rückwirkenden Anpassung wegen Kumho Tire, dazu Bruttogewinn und Betriebsergebnis desselben Quartals) und die Bruttogewinn-Quartale von BLSH und VCTR (die Firmen melden keinen Bruttogewinn) sind zurückgehalten. 000599.SZ steht dadurch mit dem Geschäftsjahr 2025 (6,84 %) auf Rang 43 statt 533,32 % auf Rang 9; im Vorher-Arm stand die Firma mit 6,84 % auf Rang 27 (die drei gehaltenen Zellen verschieben auch andere Achsen).

## Rule of 40

- Liste 484 → 497 Zeilen, 41 neu, 28 entfallen; unter den ersten 20 wechseln 4 Firmen.
- Frische-Tor: Es prüft das Ende des Zeitraums der angezeigten Zahl statt des jüngsten Quartals mit Wert. Als veraltet abgewiesen werden dadurch 6 statt 222 Firmen; ohne belegbaren Zeitraum: 0 (vorher 0).
- Wachstumsgrenzen (p1/p99) -38,91 / 168,08 → -40,14 / 178,53.

## Übersichtsspalte (B4/B5) und ihr Zeitraum

Bruttogewinnwachstum und Umsatz-Badge zeigen den beschrifteten neuesten Kandidaten. In Wachstum und Qualität weicht der neue Wert bei 2.152 von 2.771 sichtbaren Zeilen mit Vergleichswert ab, 445 davon unter den ersten 20; im Small-Cap-Bestand bei 214 von 235. Beispiel DAVE 70,4 % (Geschäftsjahr 2025) → 29,9 % (Quartal bis 30.06.2026). Die Spalte ist kein Sortierschlüssel (geprüft in `tests/g31-umschaltung.test.js`).

Neu nach P267 steht der Zeitraum genau dieses Werts im Feld `overviewPeriod`: 3.702 sichtbare Zeilen tragen es, 2.836 mit Quartal, 724 mit Geschäftsjahr, 142 ohne Zeitraum mit Grund (kein vergleichbares Wertepaar oder gehaltener Wert). Die Nachrechnung des Schreibers aus seinem eigenen Snapshot widerspricht an diesem Datentag in keiner Zeile dem von der Rechnung mitgegebenen Zeitraum (0 Etiketten „Zeitraum nicht bestätigt“).

## Prüfhinweise (Master-Entscheidung 18.10.2026)

Statt eines pauschalen Größenfilters trägt eine auffällige neue Quartalszahl den Diagnose-Hinweis `g31Hinweis`; er ändert keinen Wert, Score oder Rang. Auf dem Datentag tragen ihn 23 Notierungen im ganzen Bestand, sichtbar 11 Boardzeilen von 10 Notierungen, davon 5 Plätze unter den ersten 20:

| Firma | Board, Rang | Hinweis |
|---|---|---|
| SAUD3.SA | Wachstum health-care profitabel, 10 | geprüft (P268): Übernahme der Gesundheitssparte von Bradesco seit 01.05.2026; vergleichbar nennt die Firma plus 10,8 % |
| 688507.SS | Wachstum software-comm-services unprofitabel, 4 | geprüft (P268): Saisonbasis, Vorjahresquartal 3,99 % des Jahresumsatzes; Halbjahr plus 26,83 % |
| 002289.SZ | Wachstum tech-hardware unprofitabel, 14 | geprüft (P268): Übernahme Rechenzentrumsgeschäft seit 01.12.2025 |
| RHLD | Rule of 40, 17 | geprüft (P268): Übernahme Husky seit 12.01.2026; bestehendes Geschäft plus 12 % |
| 002993.SZ | Rule of 40, 18 | geprüft (P268): Übernahme Liangwo seit 19.03.2026; ohne sie Halbjahr plus 2,7 % |
| SUNC, 300611.SZ, SIGMAADV.NS (zweimal), LLYVA, 006800.KS | außerhalb der ersten 20 | Diagnose (nicht geprüft): neuestes Quartal über 75 % des Jahresumsatzes, Vorjahreswert unter 6,25 % oder Quartalssumme über 125 % |

Alle fünf geprüften Zahlen stimmen mit den Firmenberichten überein; sie bleiben deshalb sichtbar. Falsch war im P268-Befund nur 000599.SZ, und zwar die Zahl selbst (gemischte Basis); sie ist über die Handtabelle zurückgehalten.

## Grenzen

- Für die Qualitäts-Boards gibt es keinen exportierten Vollbestand; gezählt sind die 100 sichtbaren Zeilen je Liste.
- Die alte Kontrolle auf dem Datenstand 10.10.2026 aus P170 ist nicht erneut gerechnet.
- Gerechnet ist ein einzelner Datentag. Die Zahlen gelten für die gespeicherten Daten vom 17.10.2026; ein besseres künftiges Anlageergebnis ist damit nicht belegt.
- Die 18 Diagnose-Hinweise ohne Prüfeintrag sind nicht gegen Firmenberichte geprüft; der Hinweis sagt das ausdrücklich.

## Nachweis

Gerechnet in zwei Arbeitskopien außerhalb des Repositorys mit identischen Eingaben (Skript `arm.sh`, Vergleich `analyse.js`, beide unter `C:/Users/Anwender/.codex/t/g31b/replay`); alle Rohdateien blieben unverändert. Die Zahlen stammen aus dem Vergleich der beiden Exportbäume (`outputs/findash-export/v1`: Board-Listen, `full/`, `quality/`, `smallcap/`, `rule40/`), aus `rule40/index.json` und aus einer Zählung über alle vorbereiteten Snapshots des Nachher-Arms. Nach den Korrekturen der zweiten und dritten Codex-Prüfung (Stände `30b476b` und `aaeb0a9`) wurde der Nachher-Arm jeweils erneut gerechnet; alle Exportdateien sind bis auf Herkunftsangaben (Kennungen, Manifest-Prüfsummen) identisch, die Zahlen oben gelten unverändert.
