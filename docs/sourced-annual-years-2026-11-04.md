# Neueres belegtes Geschäftsjahr, Entwurf vom 04.11.2026

> **Auf einen Blick**
>
> Sechs doppelt gelesene Jahresabschlüsse ergänzen ausschließlich Bruttogewinnwachstum und die jährliche Beschleunigung.
> - Pop Mart steigt im HG-Vergleich von Rang 135 auf 8; drei andere HG-Scores sinken.
> - Die übrigen acht Rohachsen sind über 15.815 Ticker unverändert.
> - 110 weitere Scan-Ticker bleiben ungeprüft; Claude-Freigabe steht aus.

## Auftrag und Stand

Branch `daylauf13/neueres-jahr`, Ausgangsstand `42ba5140c676e8cc5131bd350673e3e7f5c16258`. Änderungen liegen uncommittet im Klon. Der Auftrag ist der konkrete Build-Brief einschließlich Rundennotiz; die alte Helfer-/Replay-/Commit-Anweisung des Lane-Briefs wurde durch diese Vorgaben ersetzt. Der dort genannte fremde temporäre Replay-Pfad wurde nicht geöffnet. Ein neuer Replay nutzt die bestehenden Produktionsleser, Score-Berechnung und Exportfunktionen.

## Entscheidungen 1 bis 6

1. **Form des Datensatzes, Sicherheit 97 %.** Eine ausdrücklich freigegebene Konfiguration je Ticker enthält Enddatum, Vorjahresende, Umsatz und Bruttogewinn beider Jahre, native Berichtswährung, volle Währungseinheiten, zwei Lesungen mit Quellen, Prüfungstag und Wiedervorlage. Der Adapter ergänzt ausschließlich `meta.sourcedAnnualYear` beim Lesen. Jahresreihen, Bilanz, Operating Income und `meta.annualRevNewerYear` bleiben unverändert. Aliase sind vorbereitet, bleiben mangels gesonderter Prüfung leer. Wiederverwendet werden `envelope`, `validUnit` und die vorhandenen Periodenprüfungen.
2. **Lesende Achsen, Sicherheit 95 %.** Nur `gpGrowth` und der jährliche Rückfall von `revAcceleration` verwenden das neuere Jahr. Beide Vorjahresenden müssen genau an Position 0 stehen und beide Werte passen. Toleranz in gespeicherter Währung ist `max(snapshotFX, abs(sourcePrior × snapshotFX) × 1e-8)`, also eine native Währungseinheit oder 0,000001 % relativ. Das erlaubt Rundung, keine materiell abweichende Vergleichsbasis. Bruttogewinnwachstum behält die bisherige Margenkomponente gegen die älteste brauchbare Marge. Beschleunigung braucht zusätzlich das direkt folgende ältere Umsatzjahr ohne Lücke und mit gültigem Jahresabstand. Ein frisches Quartalspaar hat Vorrang. `capitalEfficiency` und alle übrigen Achsen bleiben unverändert. Ablehnung erhält einen deutschen Grund im Metadatensatz; die bestehende Anbieterlogik bleibt zuständig.
3. **Alter und Zeitraum, Sicherheit 98 %.** Die 550 Tage gelten für das Ende des neu belegten Jahres. Neuer Abschluss gegen Vorjahr und das ältere Umsatzpaar müssen 334 bis 397 Tage auseinanderliegen. Publikation muss spätestens am Datenstand erfolgt sein; für mehrere Quellen gilt konservativ die späteste Veröffentlichung. Die zusätzliche Wiedervorlage am 04.12.2026 lässt ungeprüft weiterlaufende Einträge auslaufen. Sie ist keine Verlängerung der Altersgrenze. Quellen waren am Replay-Tag veröffentlicht, die manuelle Verifikation erfolgte am 04.11.2026. Das ist eine Vorher/Nachher-Rechnung, kein Rendite-Backtest.
4. **Anbieter holt auf, Sicherheit 98 %.** Sobald eine der beiden Jahresreihen das belegte Ende oder ein neueres enthält, entfällt der gesamte Zusatzdatensatz. Auch ein nur teilweise nachgezogener Anbieterstand wird so nicht doppelt gezählt. Der Test prüft partielle und vollständige Aufholfälle sowie die gleiche Rechnung nach vollständigem Nachziehen. Bei teilweisem Nachziehen können Achsen vorübergehend wieder fehlen; das ist die bewusst konservative Wahl.
5. **Währung, Sicherheit 98 %.** Die Quellenwerte bleiben CNY beziehungsweise USD. Vorjahresabgleich erfolgt mit dem bereits im Snapshot verwendeten Faktor; die Berechnung verwendet nur Quotienten innerhalb derselben Währung. Unklare Berichtswährung, fehlender oder falscher Faktor, fremde Zellwährung und abweichende Einheit/Periodenlänge führen zur Ablehnung. Es wird kein neuer Wechselkurs abgerufen.
6. **Versiegelung, Sicherheit 99 %.** Die Änderung ist als `sourcedAnnualYear20261104` unter `protocol/gqs-00/1.2.0-pending/transition.json` registriert. Der aktuelle Achsenhash und die vier Abhängigkeiten sind hinterlegt. `node scripts/gqs00-freeze.js --verify` besteht mit 25 unveränderten Referenzfällen, 13 Zweigen, 14.801 Alt/Referenz-Zeilen, 8.908 veröffentlichten Zeilen, null Score-/Rangabweichungen und bestandener absichtlicher Gegenprobe. Das ist die Registrierung des Entwurfs, keine Freigabe durch den Erbauer.

## Vorher/Nachher

Am Datenstand 31.10.2026 wurden 15.826 gespeicherte Snapshots und das autorisierte Universum aus 15.815 Tickern gelesen. Vorher ist ausschließlich PR #88 bei `42ba5140c676e8cc5131bd350673e3e7f5c16258`; Nachher ist dieser Entwurf darauf. Discovery, SEC-Zulieferung, Datum, Wechselkurse und die aus Vorher festgehaltene Kalibrierung sind gleich. Eingabedateien wurden vor und nach dem Lesen per SHA-256 verglichen. Alle 9.243 HG-Zeilen des vorhandenen #88-Exports stimmen im Vorher-Lauf bei Score und Rang exakt überein.

HG wächst von 9.243 auf 9.244 Zeilen, Quality bleibt bei 7.147. Über beide Familien zusammen ändern sich bei elf bestehenden Zeilen die Scores, bei 608 die Ränge; eine neue Zeile kommt hinzu, keine fällt heraus. Acht weitere Rohachsen einschließlich Kapital­effizienz und ROIC-Stabilität bleiben bei allen 15.815 Tickern identisch. Nur sechs Ticker haben Änderungen an den zwei zugelassenen Rohachsen. Fenghua behält seine frische Quartalsbeschleunigung.

In die HG-Top-100 kommt Pop Mart (135 → 8); ALWN.AT geht dadurch von 100 auf 101. Bei Quality verlässt Energean die Top-100 (97 → 144), COP rückt von 101 auf 100. Mehr belegte Achsen verbessern einen Score nicht automatisch: Salubris, Energean und Fenghua sinken auf dem HG-Board. Jilin erscheint dort mit 40,7 Punkten und nur 2/7 belegten Achsen ohne Rang; Umsatzwachstum und Kapital­effizienz bleiben leer.

### HG

| Firma | Board | Score vorher → nachher | Rang vorher → nachher | Belegte Achsen vorher → nachher |
|---|---|---:|---:|---|
| Pop Mart International Group Limited (9992.HK) | consumer-discretionary/profitable | 70,6 → 93,2 | 135 → 8 | 4/7 → 6/7 |
| Shenzhen Salubris Pharmaceuticals (002294.SZ) | health-care/profitable | 57,4 → 51,4 | 228 → 300 | 4/7 → 6/7 |
| Nantong Jiangshan Agrochemical & Chemicals (600389.SS) | materials/profitable | 64,2 → 65,9 | 207 → 184 | 5/7 → 7/7 |
| Energean plc (ENOG.L) | energy/profitable | 39,6 → 21,3 | 256 → 323 | 4/7 → 6/7 |
| Jilin Sino-Microelectronics (600360.SS) | semiconductors/profitable | nicht auf Board → 40,7 | nicht auf Board → ohne Rang | keine Board-Zeile → 2/7 |
| Guangdong Fenghua Advanced Technology (000636.SZ) | tech-hardware/profitable | 60,3 → 52,7 | 143 → 233 | 6/8 → 7/8 |

### Quality

| Firma | Board | Score vorher → nachher | Rang vorher → nachher | Belegte Achsen vorher → nachher |
|---|---|---:|---:|---|
| Pop Mart International Group Limited (9992.HK) | quality-consumer-discretionary/profitable | 77,5 → 86,5 | 28 → 7 | 4/5 → 5/5 |
| Shenzhen Salubris Pharmaceuticals (002294.SZ) | quality-health-care/profitable | 59,4 → 61,2 | 194 → 169 | 3/5 → 4/5 |
| Nantong Jiangshan Agrochemical & Chemicals (600389.SS) | quality-materials/profitable | 61,3 → 64,4 | 223 → 179 | 4/5 → 5/5 |
| Energean plc (ENOG.L) | quality-energy/profitable | 58,3 → 53,6 | 97 → 144 | 3/5 → 4/5 |
| Jilin Sino-Microelectronics (600360.SS) | quality-semiconductors/profitable | 42,4 → 40,1 | 180 → 191 | 1/5 → 2/5 |
| Guangdong Fenghua Advanced Technology (000636.SZ) | quality-tech-hardware/profitable | 45 → 38,9 | 329 → 399 | 3/5 → 4/5 |

Die Nenner zeigen die je Formel erforderlichen Achsen; fehlende Achsen sind damit direkt erkennbar. Die im Board gezeigten Umsatzwachstumszahlen verändern sich bei keinem der sechs Ticker. Rohwerte von `gpGrowth` enthalten bereits die unveränderte Margenkomponente und sind deshalb nicht mit reinem Bruttogewinnwachstum gleichzusetzen.

## Quellen und getrennte Lesungen

Erste Lesung anhand der Konzern-Gewinn-und-Verlustrechnung, zweite Lesung jeweils neu vom Firmennamen ausgehend und ohne Suche nach dem zuerst erfassten Zahlenwert. Bei den vier chinesischen Festlandfirmen war die zweite Stelle die Umsatz-/Kosten-Anhangtabelle desselben Konzernabschlusses. Bei Pop Mart wurden Geschäftsbericht und Ergebnisveröffentlichung getrennt gelesen. Bei Energean wurden die PDF-Veröffentlichung und die RNS-Fassung getrennt gelesen; beide spiegeln dieselbe Firmenveröffentlichung. Die Unabhängigkeit betrifft die Lese- und Übertragungsvorgänge, nicht zwei verschiedene Wirtschaftsprüfer oder Datenanbieter. Erst nach beiden Übertragungen wurden die vier Werte verglichen.

Für CNY-Firmen ohne ausgewiesene Gross-profit-Zeile wurde ausschließlich Umsatz minus Umsatzkosten gerechnet. Bei Energean ist die in der Veröffentlichung dargestellte Vergleichsbasis mit dem gespeicherten Vorjahr identisch. Geschätzte Werte, Umsatz-Zwischenberichte und eigene Währungsraten wurden nicht verwendet. PDFs liegen ausschließlich im Ergebnisordner. Energeans lokale PDF-Abrufe wurden mit HTTP 403 abgewiesen; die veröffentlichte PDF wurde über das Web-Werkzeug und die RNS-Fassung separat gelesen.

### Pop Mart International Group Limited (9992.HK)

Umsatz 2025/2024: **37.120.052.000 / 13.037.749.000 CNY**. Bruttogewinn 2025/2024: **26.764.916.000 / 8.707.765.000 CNY**. Volle Währungseinheiten; Geschäftsjahresende jeweils 31.12.

Lesung 1: Ausgangssuche „Pop Mart 2025 annual results“. [Primärquelle](https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0421/2026042100395_c.pdf), PDF-Seite 219 (ab 1), veröffentlicht 2026-04-21. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> Revenue 收益 6 37,120,052 13,037,749
> Gross profit 毛利 26,764,916 8,707,765

Rechnung: Die ausgewiesenen Tausenderbeträge werden mit 1.000 multipliziert.

Lesung 2: Ausgangssuche „Pop Mart 2025 annual results“. [Primärquelle](https://prod-out-res.popmart.com/cms/ANNUAL_RESULTS_ANNOUNCEMENT_FOR_THE_YEAR_ENDED_31_DECEMBER_2025_AND_CHANGE_IN_USE_OF_PROCEEDS_af8bc550f1.pdf), PDF-Seite 2 (ab 1), veröffentlicht 2026-03-25. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> Revenue 4 37,120,052 13,037,749
> Gross profit 26,764,916 8,707,765

Rechnung: Die ausgewiesenen Tausenderbeträge werden mit 1.000 multipliziert.

### Shenzhen Salubris Pharmaceuticals (002294.SZ)

Umsatz 2025/2024: **4.352.661.358,61 / 4.012.231.593,39 CNY**. Bruttogewinn 2025/2024: **3.253.887.906,76 / 2.914.678.118,35 CNY**. Volle Währungseinheiten; Geschäftsjahresende jeweils 31.12.

Lesung 1: Ausgangssuche „Shenzhen Salubris Pharmaceuticals 2025 annual report“. [Primärquelle](https://static.cninfo.com.cn/finalpage/2026-04-21/1225130579.PDF), PDF-Seite 122 (ab 1), veröffentlicht 2026-04-21. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> 营业收入 4,352,661,358.61 4,012,231,593.39；营业成本 1,098,773,451.85 1,097,553,475.04

Rechnung: Bruttogewinn = 营业收入 minus 营业成本, für jedes Jahr separat; Beträge in CNY.

Lesung 2: Ausgangssuche „Shenzhen Salubris Pharmaceuticals 2025 annual report“. [Primärquelle](https://static.cninfo.com.cn/finalpage/2026-04-21/1225130579.PDF), PDF-Seite 201 (ab 1), veröffentlicht 2026-04-21. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> 合计 4,352,661,358.61 1,098,773,451.85 4,012,231,593.39 1,097,553,475.04

Rechnung: Bruttogewinn = 营业收入 minus 营业成本, für jedes Jahr separat; Beträge in CNY.

### Nantong Jiangshan Agrochemical & Chemicals (600389.SS)

Umsatz 2025/2024: **5.816.188.535,51 / 5.431.591.346,96 CNY**. Bruttogewinn 2025/2024: **1.009.920.393 / 786.936.091,19 CNY**. Volle Währungseinheiten; Geschäftsjahresende jeweils 31.12.

Lesung 1: Ausgangssuche „Nantong Jiangshan Agrochemical & Chemicals 2025 annual report“. [Primärquelle](https://static.cninfo.com.cn/finalpage/2026-04-21/1225128424.PDF), PDF-Seite 81 (ab 1), veröffentlicht 2026-04-21. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> 营业收入 七、61 5,816,188,535.51 5,431,591,346.96
> 其中：营业成本 七、61 4,806,268,142.51 4,644,655,255.77

Rechnung: Bruttogewinn = 营业收入 minus 营业成本, für jedes Jahr separat; Beträge in CNY.

Lesung 2: Ausgangssuche „Nantong Jiangshan Agrochemical & Chemicals 2025 annual report“. [Primärquelle](https://static.cninfo.com.cn/finalpage/2026-04-21/1225128424.PDF), PDF-Seite 167 (ab 1), veröffentlicht 2026-04-21. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> 合计 5,816,188,535.51 4,806,268,142.51 5,431,591,346.96 4,644,655,255.77

Rechnung: Bruttogewinn = 营业收入 minus 营业成本, für jedes Jahr separat; Beträge in CNY.

### Energean plc (ENOG.L)

Umsatz 2025/2024: **1.728.126.000 / 1.779.413.000 USD**. Bruttogewinn 2025/2024: **583.220.000 / 791.128.000 USD**. Volle Währungseinheiten; Geschäftsjahresende jeweils 31.12.

Lesung 1: Ausgangssuche „Energean 2025 Full Year Results“. [Primärquelle](https://mayafiles.tase.co.il/rpdf/1729001-1730000/P1729080-00.pdf), Group Income Statement, PDF page 20; pass 2 independently read the RNS HTML rendering of this filing; PDF-Seite 20 (ab 1), veröffentlicht 2026-03-19. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> Revenue 4 1,728,126 1,779,413
> Gross profit 583,220 791,128

Rechnung: Die ausgewiesenen Tausenderbeträge werden mit 1.000 multipliziert.

Lesung 2: Ausgangssuche „Energean 2025 Full Year Results“. [Primärquelle](https://rns-pdf.ir-alerter.com/files/85701.html), Group Income Statement, PDF page 20; pass 2 independently read the RNS HTML rendering of this filing; PDF-Seite 20 (ab 1), veröffentlicht 2026-03-19. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> Revenue 4 1,728,126 1,779,413
> Gross profit 583,220 791,128

Rechnung: Die ausgewiesenen Tausenderbeträge werden mit 1.000 multipliziert.

### Jilin Sino-Microelectronics (600360.SS)

Umsatz 2025/2024: **2.255.244.574,28 / 2.057.608.183,78 CNY**. Bruttogewinn 2025/2024: **551.950.592,49 / 540.270.887 CNY**. Volle Währungseinheiten; Geschäftsjahresende jeweils 31.12.

Lesung 1: Ausgangssuche „Jilin Sino-Microelectronics 2025 annual report“. [Primärquelle](https://static.cninfo.com.cn/finalpage/2026-04-21/1225133069.PDF), PDF-Seite 78 (ab 1), veröffentlicht 2026-04-21. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> 营业收入 2,255,244,574.28 2,057,608,183.78；营业成本 1,703,293,981.79 1,517,337,296.78

Rechnung: Bruttogewinn = 营业收入 minus 营业成本, für jedes Jahr separat; Beträge in CNY.

Lesung 2: Ausgangssuche „Jilin Sino-Microelectronics 2025 annual report“. [Primärquelle](https://static.cninfo.com.cn/finalpage/2026-04-21/1225133069.PDF), PDF-Seite 173 (ab 1), veröffentlicht 2026-04-21. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> 合计 2,255,244,574.28 1,703,293,981.79 2,057,608,183.78 1,517,337,296.78

Rechnung: Bruttogewinn = 营业收入 minus 营业成本, für jedes Jahr separat; Beträge in CNY.

### Guangdong Fenghua Advanced Technology (000636.SZ)

Umsatz 2025/2024: **5.756.408.165,14 / 4.939.246.038,11 CNY**. Bruttogewinn 2025/2024: **1.021.637.599,34 / 947.034.788,44 CNY**. Volle Währungseinheiten; Geschäftsjahresende jeweils 31.12.

Lesung 1: Ausgangssuche „Guangdong Fenghua Advanced Technology 2025 annual report“. [Primärquelle](https://static.cninfo.com.cn/finalpage/2026-04-21/1225129320.PDF), PDF-Seite 79 (ab 1), veröffentlicht 2026-04-21. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> 营业收入 5,756,408,165.14 4,939,246,038.11；营业成本 4,734,770,565.80 3,992,211,249.67

Rechnung: Bruttogewinn = 营业收入 minus 营业成本, für jedes Jahr separat; Beträge in CNY.

Lesung 2: Ausgangssuche „Guangdong Fenghua Advanced Technology 2025 annual report“. [Primärquelle](https://static.cninfo.com.cn/finalpage/2026-04-21/1225129320.PDF), PDF-Seite 172 (ab 1), veröffentlicht 2026-04-21. Wörtliche Zeilenauszüge; dazwischenliegende Tabellenzeilen ausgelassen:

> 合计 5,756,408,165.14 4,734,770,565.80 4,939,246,038.11 3,992,211,249.67

Rechnung: Bruttogewinn = 营业收入 minus 营业成本, für jedes Jahr separat; Beträge in CNY.

**BayWa (BYW.VI) bleibt ohne Datensatz.** Bei beiden getrennten Einstiegen wurde kein verwendbarer Konzernabschluss 2025 erreicht. Der [englische Finanzkalender](https://www.baywa.com/en/investor-relations/financial-calender/financial-events) nennt „Consolidated Financial Statements 2025“ am „22.12.2026“, der [deutsche Finanzkalender](https://www.baywa.com/investor-relations/finanzkalender/finanztermine) „Konzernfinanzbericht 2025“ am „22.12.2026“. Das ist der belegte Ausschlussgrund, keine geschätzte Finanzzahl.

## Nachzählung und nicht erreichte Firmen

Gezählt wird je eindeutigem Board-Ticker das Ende des ersten positiven, endlichen Umsatz- oder Bruttogewinnwerts **nach** der bestehenden Vorbereitung. Alter einschließlich 551 bis 730 Tage gegen 31.10.2026; leere vordere Zellen verstecken einen älteren Anker nicht. Im HG-Board erfüllen 113 von 9.243 Tickern die Bedingung, 9.130 nicht. Davon haben 76 einen solchen Umsatzanker und 103 einen solchen Bruttogewinnanker; diese Gruppen überschneiden sich. Quality enthält 45 von 7.147 passenden Tickern und ergänzt drei, die nicht im HG-Ergebnis stehen. Zusammen sind es 116 eindeutige Ticker. Die etwa 87 aus dem Brief werden mit dieser offengelegten Definition nicht reproduziert.

Sechs der 116 Ticker wurden in zwei getrennten Quellenlesungen geprüft und aufgenommen. Die übrigen 110 wurden nur im Bestand gezählt, nicht anhand zweier Quellenlesungen freigegeben. Zusätzlich wurde die ausdrücklich genannte BayWa geprüft und ausgeschlossen. BYW.VI erscheint in keiner der beiden Board-Familien dieses Ausgangslaufs. Der Hinweis zu Ab&B (2627.HK) aus dem Brief wurde nicht erneut durch Quellenlektüre geprüft; dafür wurde kein Datensatz angelegt.

| Nicht quellengeprüfter Ticker | Name im Datenstand | Alter Umsatz / Bruttogewinn in Tagen |
|---|---|---|
| 000090.SZ | Shenzhen Tagen Group Co., Ltd. | 669 / 669 |
| 000488.SZ | Shandong Chenming Paper Holdings Limited | außerhalb / 669 |
| 000534.SZ | Wedge Industrial Co.,Ltd. | 669 / 669 |
| 000560.SZ | 5i5j Holding Group Co., Ltd. | 669 / 669 |
| 000683.SZ | Inner Mongolia Berun Chemical Company Limited | 669 / 669 |
| 000690.SZ | Guangdong Baolihua New Energy Stock Co., Ltd. | 669 / 669 |
| 000711.SZ | Indium Target Advanced Materials (Harbin) Co., Ltd. | außerhalb / 669 |
| 000875.SZ | SPIC Green Energy Co., Ltd. | 669 / 669 |
| 002010.SZ | Transfar Zhilian Co., Ltd. | 669 / 669 |
| 002049.SZ | Unigroup Guoxin Microelectronics Co., Ltd. | 669 / 669 |
| 002167.SZ | Guangdong Orient Zirconic Ind Sci & Tech Co.,Ltd | 669 / 669 |
| 002208.SZ | Hefei Urban Construction Development Co., Ltd | 669 / 669 |
| 002307.SZ | Xinjiang Beixin Road & Bridge Group Co., Ltd | 669 / 669 |
| 002338.SZ | Changchun UP Optotech Co.,Ltd. | 669 / 669 |
| 002354.SZ | Tianyu Digital Technology Group Co.,Ltd. | 669 / 669 |
| 002364.SZ | Hangzhou Zhongheng Electric Co., Ltd | 669 / 669 |
| 002378.SZ | Chongyi Zhangyuan Tungsten Co., Ltd. | 669 / 669 |
| 002390.SZ | Guizhou Xinbang Pharmaceutical Co., Ltd. | 669 / 669 |
| 002434.SZ | Zhejiang Wanliyang Co., Ltd. | 669 / 669 |
| 002459.SZ | JA Solar Technology Co., Ltd. | außerhalb / 669 |
| 002510.SZ | Tianjin Motor Dies Co.,Ltd. | 669 / 669 |
| 002540.SZ | Jiangsu Asia-Pacific Light Alloy Technology Co., Ltd. | 669 / 669 |
| 002670.SZ | Guosheng Securities Inc | außerhalb / 669 |
| 002865.SZ | Hainan Drinda New Energy Technology Co., Ltd. | außerhalb / 669 |
| 002939.SZ | China Great Wall Securities Co.,Ltd. | 669 / außerhalb |
| 020150.KS | Lotte Energy Materials Corporation | außerhalb / 669 |
| 0267.HK | CITIC Limited | 669 / 669 |
| 036540.KQ | SFA Semicon Co., Ltd. | außerhalb / 669 |
| 0486.HK | United Company RUSAL, International Public Joint-Stock Company | 669 / 669 |
| 0667.HK | China East Education Holdings Limited | 669 / 669 |
| 1314.TW | China Petrochemical Development Corporation | außerhalb / 669 |
| 1818.HK | Zhaojin Mining Industry Company Limited | 669 / 669 |
| 1918.HK | Sunac China Holdings Limited | außerhalb / 669 |
| 1SDF.MI | K+S Aktiengesellschaft | außerhalb / 669 |
| 2467.TW | C Sun Mfg Ltd. | 669 / 669 |
| 2627.HK | Ab&B Bio-Tech CO., LTD. JS | 669 / 669 |
| 2638.HK | HK Electric Investments and HK Electric Investments Limited | 669 / 669 |
| 300018.SZ | Wuhan Zhongyuan Huadian Science & Technology Co.,Ltd. | 669 / 669 |
| 300026.SZ | Tianjin Chase Sun Pharmaceutical Co.,Ltd | 669 / 669 |
| 300145.SZ | Nanfang Pump Industry Co., Ltd. | 669 / 669 |
| 300393.SZ | Jolywood (Suzhou) Sunwatt Co.,Ltd. | außerhalb / 669 |
| 301013.SZ | Shenzhen Lihexing Co.,Ltd. | außerhalb / 669 |
| 3360.HK | Far East Horizon Limited | 669 / 669 |
| 336260.KS | Doosan Fuel Cell Co., Ltd. | außerhalb / 669 |
| 3576.TW | United Renewable Energy Co., Ltd. | außerhalb / 669 |
| 3715.TW | Dynamic Holding Co., Ltd. | 669 / 669 |
| 5555.KL | Sunway Healthcare Holdings Berhad | 669 / 669 |
| 600006.SS | DongFeng Automobile Co. LTD | außerhalb / 669 |
| 600072.SS | CSSC Science & Technology Co., Ltd | außerhalb / 669 |
| 600105.SS | Jiangsu Etern Company Limited | 669 / 669 |
| 600114.SS | NBTM New Materials Group Co., Ltd. | 669 / 669 |
| 600143.SS | Kingfa Sci. & Tech. Co., Ltd. | 669 / 669 |
| 600169.SS | Taiyuan Heavy Industry Co., Ltd. | 669 / 669 |
| 600185.SS | Zhuhai Zhumian Group Co., Ltd. | 669 / 669 |
| 600226.SS | Zhejiang Hengtong Holding Co.,Ltd. | 669 / 669 |
| 600261.SS | Zhejiang Yankon Group Co., Ltd. | 669 / 669 |
| 600309.SS | Wanhua Chemical Group Co., Ltd. | 669 / 669 |
| 600403.SS | Henan Dayou Energy Co., Ltd | außerhalb / 669 |
| 600510.SS | Black Peony (Group) Co., Ltd. | 669 / 669 |
| 600618.SS | Shanghai Chlor-Alkali Chemical Co., Ltd. | 669 / 669 |
| 600621.SS | Shanghai Chinafortune Co., Ltd. | außerhalb / 669 |
| 600623.SS | Shanghai Huayi Group Corporation Limited | 669 / 669 |
| 600637.SS | Oriental Pearl Group Co.,Ltd. | 669 / 669 |
| 600639.SS | Shanghai Jinqiao Export Processing Zone Development Co.,Ltd | 669 / 669 |
| 600740.SS | Shanxi Coking Co., Ltd. | 669 / außerhalb |
| 600782.SS | Xinyu Iron & Steel Co., Ltd | 669 / 669 |
| 600955.SS | Lihuayi Weiyuan Chemical Co., Ltd. | außerhalb / 669 |
| 600960.SS | Bohai Automotive Systems CO., LTD. | 669 / außerhalb |
| 601137.SS | Ningbo Boway Alloy Material Company Limited | 669 / 669 |
| 601238.SS | Guangzhou Automobile Group Co., Ltd. | außerhalb / 669 |
| 601700.SS | Changshu Fengfan Power Equipment Co., Ltd. | 669 / 669 |
| 601811.SS | Xinhua Winshare Publishing and Media Co., Ltd. | 669 / 669 |
| 601868.SS | China Energy Engineering Corporation Limited | 669 / 669 |
| 603776.SS | Youon Technology Co.,Ltd | außerhalb / 669 |
| 6594.T | Nidec Corporation | 579 / 579 |
| 6770.TW | Powerchip Semiconductor Manufacturing Corporation | außerhalb / 669 |
| 688020.SS | Guangzhou Fangbang Electronics Co.,Ltd | 669 / 669 |
| 688223.SS | Jinko Solar Co., Ltd. | außerhalb / 669 |
| 688303.SS | Xinjiang Daqo New Energy Co.,Ltd. | außerhalb / 669 |
| 8TI.DE | Stellantis N.V. | außerhalb / 669 |
| ABCL | AbCellera Biologics Inc. | außerhalb / 669 |
| AEGN.AT | Aegean Airlines S.A. | außerhalb / 669 |
| AGL | agilon health, inc. | außerhalb / 669 |
| ASST | Strive, Inc. | 669 / außerhalb |
| ATVK | GlobalTek Ventures, Inc. | 669 / außerhalb |
| CGON | CG Oncology, Inc. | außerhalb / 669 |
| CLF | Cleveland-Cliffs Inc. | außerhalb / 669 |
| CNR | Core Natural Resources, Inc. | außerhalb / 669 |
| EMAS.JK | PT Merdeka Gold Resources Tbk | außerhalb / 669 |
| FEVR.L | Fevertree Drinks PLC | 669 / 669 |
| FLR | Fluor Corporation | außerhalb / 669 |
| FRAGUA/B.MX | Corporativo Fragua, S.A.B. de C.V. | 669 / 669 |
| GEF | Greif, Inc. | 730 / 730 |
| GPP.WA | Grupa Pracuj S.A. | außerhalb / 669 |
| GULF.BK | Gulf Development Public Company Limited | 669 / 669 |
| HORIZONIND.NS | Horizon Industrial Parks Limited | außerhalb / 579 |
| LICHSGFIN.BO | LIC Housing Finance Limited | 579 / außerhalb |
| MAZE | Maze Therapeutics, Inc. | 669 / außerhalb |
| M&MFIN.BO | Mahindra & Mahindra Financial Services Limited | 579 / außerhalb |
| NESTLEIND.BO | Nestlé India Limited | 579 / außerhalb |
| OCTV | Octave Intelligence plc | 669 / 669 |
| PAYO | Payoneer Global Inc. | außerhalb / 669 |
| PSKY | Paramount Skydance Corp | 669 / 669 |
| SCATC.OL | Scatec ASA | außerhalb / 669 |
| SKYD | Skydance Corporation | 669 / 669 |
| SOL.MI | SOL S.p.A. | 669 / 669 |
| SVT.L | Severn Trent PLC | 579 / 579 |
| THEON.AS | Theon International Plc | 669 / 669 |
| TRN.VI | Terna S.p.A. | 669 / außerhalb |
| UIBU.SI | UI Boustead Real Estate Investment Trust | 579 / 579 |

## Prüfung

- `node tests/sourced-annual-years.test.js`: elf Prüfgruppen bestanden, einschließlich sechs echter Datenpakete, Währung, Abgleich beider Vorjahre, Lücken, Aufholen, Quellenfreigabe, Ablaufdatum, 550/551 Tage, Quartalsvorrang, unveränderter Reihen und erklärender Jahresbeschriftung. Zwei absichtlich im Speicher entfernte Leserzweige machen die positiven Prüfungen rot; Quelldatei vorher/nachher hashgleich.
- `node tests/stale-series-p286.test.js`: alle 19 Tests bestanden. Nur der Anker des vorhandenen Mutationstests wurde an den mehrzeiligen Quartalszweig angepasst; seine Gegenprobe und alle Assertions bleiben erhalten.
- `node scripts/gqs00-freeze.js --verify`: bestanden, Zahlen wie Entscheidung 6.
- `node scripts/sourced-annual-years-replay.js before|after|compare <Datenbaum> <neuer Ergebnisordner>`: alle drei Läufe Exit 0; Gleichheit der Eingaben und Kalibrierung, acht unveränderte Rohachsen und die Board-Zahlen oben maschinell geprüft.
- Vollständiger Testlauf: `node scripts/test-gate.js --mode=all` vollst?ndig ausgef?hrt, Exit 1: **1.112 Testdateien bestanden, 20 fehlgeschlagen, sieben ohne ausgef?hrte Pr?fungen**. Jede der 20 roten Testdateien wurde danach mit dem Ausgangscode von PR #88 und derselben Python-Auswahl erneut ausgef?hrt; alle 20 sind dort ebenfalls rot. Es bleibt deshalb ausdr?cklich kein gr?nes Gesamt-Gate. Der erste Lauf hatte 57 rote Dateien: 36 davon laufen mit dem freigegebenen Python erfolgreich, der durch den Umbau verschobene Mutationstest-Anker ist berichtigt, 20 Bestands-/Umgebungsl?cken bleiben. Keine Assertion, kein Testfall und keine Schutzgrenze wurde abgeschw?cht.

Der freigegebene Interpreter `C:/Users/Anwender/.codex/t/py312-codex/python.exe -I -B` wurde f?r Python-Kindprozesse per externem Startmodul gew?hlt; der Testcode blieb unver?ndert. `TEMP` und `TMP` liegen im erlaubten Ergebnisordner. Logs: `test-gate-final.log`, `baseline-final.json` und `baseline-final/`. Die Baseline-Ersetzung l?dt ausschlie?lich die vor dem Entwurf bestehenden Quelldateien aus dem festgelegten Commit in den Speicher; auch Kindprozesse erben sie.

Die Fehlermeldungen betreffen fehlende Datenartefakte im schmalen Klon (unter anderem historische Register, SEC-Daten, Snapshot-Verzeichnis und Namenskarte), von diesen Daten abh?ngige Archiv-/Issuer-Pr?fungen und den fehlgeschlagenen Zugriff auf eine tempor?re Foundation-Datei. Beim Q4-Test erzeugt die fehlende Exchange-Historie eine zweite Warnzeile; auch das wurde auf dem Ausgangscode nachgestellt. Die genaue Ursache des tempor?ren Foundation-Dateifehlers wurde nicht weiter untersucht. Gesch?tzte Daten wurden f?r diese fremden Tests nicht nachgebaut.

| Testdatei | Entwurf | Ausgangscode #88 |
|---|---|---|
| tests/archive-picks-frozen.test.js | Exit 1 | Exit 1 |
| tests/board-history-datenschub-zuschlag.test.js | Exit 1 | Exit 1 |
| tests/board-history-gate-neukalibrierung.test.js | Exit 1 | Exit 1 |
| tests/board-history-score-definitions-bruch.test.js | Exit 1 | Exit 1 |
| tests/form4-backfill-archive.test.js | Exit 1 | Exit 1 |
| tests/kohorten-persistenz-t199.test.js | Exit 1 | Exit 1 |
| tests/opinc-feld.test.js | Exit 1 | Exit 1 |
| tests/p0-haertung3-builder-cache-cursor.test.js | Exit 1 | Exit 1 |
| tests/plan-check-manifest-integrity.test.js | Exit 1 | Exit 1 |
| tests/scoring/bh-w2-13f.test.js | Exit 1 | Exit 1 |
| tests/scoring/findash-name-map.test.js | Exit 1 | Exit 1 |
| tests/scoring/phase.test.js | Exit 1 | Exit 1 |
| tests/scoring/score.integration.test.js | Exit 1 | Exit 1 |
| tests/studie-mitschrift.test.js | Exit 1 | Exit 1 |
| tests/t168-layer-diff-messwache.test.js | Exit 1 | Exit 1 |
| tests/t196-enden-zensus.test.js | Exit 1 | Exit 1 |
| tests/wertgate-261-entbunden.test.js | Exit 1 | Exit 1 |
| tests/wertgate-wb4strich.test.js | Exit 1 | Exit 1 |
| tests/yahoo-q4-known-cases.test.js | Exit 1 | Exit 1 |
| tests/early-detection-foundation.test.js | Exit 1 | Exit 1 |

## Reproduktion und Dateien

Dateneingang dieses Laufs: `C:/Users/Anwender/.codex/t/daylauf10/nachziehen-rv/r88/a88b`. Ausgabe: `C:/Users/Anwender/.codex/reports/daylauf-2026-11-04/ergebnisse/B02-neueres-jahr-bau/replay-v2`. Für einen erneuten Lauf einen neuen Ausgabeordner wählen. Das Skript setzt `RUN_DATE_UTC=2026-10-31` selbst, lädt Vorher-Quellcode aus dem festgelegten Commit nur in den Speicher und schreibt keine Eingabedateien. Es funktioniert auch nach einem Commit des Entwurfs, solange der festgelegte Ausgangsstand Vorfahr bleibt. Die Versionsgeschichte wird nicht geändert.

`inputDigest=2e7aab1f7a0ddc8c80150d0a49bdf6d9c7f7b6de071542a8843312dde174d024`

`calibrationDigest=87e2423d7af6a581e2a4415bf38daf62574c7e1111952a2e1257ceafd4d7f25e`

Maschinelle Belege im Ergebnisordner: `replay-v2/before.json`, `after.json`, `comparison.json`, beide Eingabemanifeste und `replay-verification.json`. Die Konfiguration enthält jede Quelle mit PDF-Seite, Originalauszug, Operanden und beiden unabhängig übertragenen Wertesätzen.

Geänderte/neue fachliche Dateien:

- `configs/sourced-annual-years.json`
- `lib/sourced-annual-years.js`
- `lib/yahoo-q4-known-cases.js`
- `src/scoring/axes.js`
- `lib/annual-pairs.js`
- `protocol/gqs-00/1.2.0-pending/transition.json`
- `tests/fixtures/sourced-annual-years.json`
- `tests/sourced-annual-years.test.js`
- `tests/stale-series-p286.test.js`
- `scripts/sourced-annual-years-replay.js`
- `docs/sourced-annual-years-2026-11-04.md`

Die beiden Übergabedateien `PR-BODY-neueres-jahr.md` und `REPORT-neueres-jahr.md` bleiben untracked und werden von der Lane nicht mitcommittet. Der sachliche Prüfbericht unter `docs/` gehört zum Entwurf.

## Grenzen und Übergabe

Die blinde Claude-Prüfung steht aus. Es gab keine Helfer, keinen Commit, Push, Merge oder Live-Aufruf. Kein laufender Reiter wurde aufgespielt oder im Browser abgenommen. Die zusätzlichen 110 Scan-Ticker, weitere Listings/Aliase, andere Datenstände und Änderungen nach dem festgelegten #88-Head sind nicht geprüft. Nach dem 04.12.2026 benötigt die Tabelle eine erneute Prüfung. Die sechs aufgenommenen Firmen haben übereinstimmende Lesungen, es gab keinen wegen unterschiedlicher Werte verworfenen Datensatz. Zwei getrennte Lesepässe desselben Erbauers ersetzen keine blinde Prüfung durch eine andere KI.

Kein privater Name und keine E-Mail wurden in neue Dateien aufgenommen. Geschützte Datenpfade, CI-Dateien und die Versionsgeschichte wurden nicht geändert. Umfang und verfügbaren Speicher nennt die abschließende lokale Prüfung. Ein Modell, keine Helfer: Codex in der vorgegebenen Sitzung; kein Modellwechsel. Die Lane erstellt nach Ende dieser Sitzung den Draft-PR; die Prüfung entscheidet über weitere Schritte.
