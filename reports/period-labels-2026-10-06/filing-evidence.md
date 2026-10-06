# P55 Originalbelege der Periodenstichprobe

> **Auf einen Blick**
>
> Vier gezielt ausgewählte Halbleiterzeilen tragen andere Periodenenden als ihre Originalberichte; bei zwei Kontrollfirmen stimmen die Enddaten. Sicherheit des Urteils 99 %.
>
> - Die sechs Umsatz-Wachstumszahlen stimmen mit den sechs Originalpaaren überein.
> - CRDO, ADI, KLIC und SKYT sind im eingefrorenen Halbleiterboard vorhanden. Meta und Microsoft sind im eingefrorenen Softwareboard vorhanden.
> - Dies ist eine gezielte Stichprobe, keine Hochrechnung auf alle Firmen und keine Bestätigung anderer Board-Felder.

Eigenständig geöffnet und abgerufen am 06.10.2026. Die gespeicherten HTTP-Abrufe liegen zwischen 07:56 und 07:58 UTC. Die Uhrzeiten, URLs, Dateigrößen und SHA256 stehen in den jeweiligen `.meta.json`-Dateien. Alle sieben gespeicherten Originalabrufe lieferten HTTP 200. Die Web-Ansicht des Microsoft-10-K meldete einen internen Werkzeugfehler; der direkte Abruf desselben SEC-Dokuments gelang. Keine Ratengrenze beobachtet. P09 diente ausschließlich als Wegweiser zu CRDO, ADI, KLIC und SKYT; die Aussagen wurden am erneut geöffneten Original nachgestellt.

## Abgleich mit dem eingefrorenen Export

Alle Beträge der folgenden Tabelle sind USD, nach Umrechnung der im Original bezeichneten Tausend- beziehungsweise Millioneneinheit. Die Formel lautet `(neuer Umsatz / Vorjahresumsatz - 1) × 100`. Die Differenz zur eingefrorenen Wachstumszahl beträgt in allen sechs Fällen weniger als 0,0000000001 Prozentpunkte. Sicherheit der Zuordnung von Betrag und Periode jeweils 99 %.

| Firma, Board/Spur/Rang | Exportenden neu / alt | Originalenden neu / alt | Originalumsatz neu / alt, USD | Wachstum, Prozent | Periodenurteil |
|---|---|---|---:|---:|---|
| CRDO, semiconductors/profitable/2 | 2026-07-31 / 2025-07-31 | 2026-08-01 / 2025-08-02 | 479.003.000 / 223.074.000 | 114,72829643974647 | falsch, 99 % |
| ADI, semiconductors/profitable/18 | 2026-07-31 / 2025-07-31 | 2026-08-01 / 2025-08-02 | 4.021.899.000 / 2.880.348.000 | 39,63239858517096 | falsch, 99 % |
| KLIC, semiconductors/unprofitable/17 | 2026-06-30 / 2025-06-30 | 2026-07-04 / 2025-06-28 | 330.409.000 / 148.413.000 | 122,6280716648811 | falsch, 99 % |
| SKYT, semiconductors/unprofitable/18 | 2026-03-31 / 2025-03-31 | 2026-03-29 / 2025-03-30 | 160.686.000 / 61.296.000 | 162,14761158966326 | falsch, 99 % |
| META, software-comm-services/profitable/75 | 2026-06-30 / 2025-06-30 | 2026-06-30 / 2025-06-30 | 60.801.000.000 / 47.516.000.000 | 27,959003283104632 | richtig, 99 % |
| MSFT, software-comm-services/profitable/88 | 2026-06-30 / 2025-06-30 | 2026-06-30 / 2025-06-30 | 90.007.000.000 / 76.441.000.000 | 17,74702057796209 | richtig, 99 % |

Snapshotquelle ist `C:/Users/Anwender/.codex/reports/tagesauftrag-2026-10-04/_work/public-export/`. Ausschließlich die Dateien `semiconductors.json` und `software-comm-services.json` wurden für die Mitgliedschaft dieser sechs Zeilen ausgewertet.

| Datei | generated_at | SHA256 |
|---|---|---|
| semiconductors.json | 2026-10-03T09:31:17.085Z | 73304fd57880d44ae0d5f86c45ffa96cf88dd57b41ce475ec425c26f8a25dafa |
| software-comm-services.json | 2026-10-03T09:31:17.125Z | 8c7c3b4ff098bd942c0d7b26f618e595749b7182299a5ef6de814b74b1023ee0 |

## Originalfundstellen für eine unabhängige Gegenprüfung

1. **CRDO**. [Form 10-Q, SEC 0001628280-26-060111](https://www.sec.gov/Archives/edgar/data/1807794/000162828026060111/crdo-20260801.htm), Condensed Consolidated Statements of Operations, drei Monate, Einheit Tausend USD. Suchzitate „August 1, 2026“, „August 2, 2025“ und „479,003“. Die Umsatzzeile enthält 479.003 und 223.074. Die Inline-XBRL-Umsatzwerte verweisen auf dimensionslose Kontexte `c-1` mit 2026-05-03 bis 2026-08-01 und `c-5` mit 2025-05-04 bis 2025-08-02. Datei `CRDO-20260801-10Q.html`.

2. **ADI**. [Form 10-Q beim Emittenten](https://investor.analog.com/static-files/4c652382-cb7c-4418-a71f-45af25c7584b), PDF-Seite 2, gedruckte Seite 1, Condensed Consolidated Statements of Income. Suchzitat „Revenue $ 4,021,899 $ 2,880,348“. Der Kopf der Dreimonatsspalten nennt 01.08.2026 und 02.08.2025; Einheit Tausend USD. PDF-Seite 8 beschreibt den 52-/53-Wochen-Kalender. Datei `ADI-20260801-10Q.pdf`; Seite 2 zusätzlich mit lokal vorhandenem `pdftotext` in `ADI-income-statement-page2.txt` extrahiert.

3. **KLIC**. [Form 10-Q, SEC 0000056978-26-000032](https://www.sec.gov/Archives/edgar/data/56978/000005697826000032/klic-20260704.htm), gedruckte Seite 2, Consolidated Condensed Statements of Operations. Suchzitate „July 4, 2026“, „June 28, 2025“ und „330,409“. Die ersten beiden Umsatzspalten nennen 330.409 und 148.413 Tausend USD. Inline-XBRL-Kontexte `c-6` und `c-7` nennen 2026-04-05 bis 2026-07-04 sowie 2025-03-30 bis 2025-06-28; beide ohne Segmentdimension. Datei `KLIC-20260704-10Q.html`.

4. **SKYT**. [Form 10-Q, SEC 0001819974-26-000014](https://www.sec.gov/Archives/edgar/data/1819974/000181997426000014/skyt-20260329.htm), Condensed Consolidated Statements of Operations, außerdem Management Discussion mit Suchzitat „First Quarter Ended“. Die Spalten bis 29.03.2026 und 30.03.2025 enthalten 160.686 und 61.296 Tausend USD Umsatz. Datei `SKYT-20260329-10Q.html`. Die Board-Mitgliedschaft ist hier unmittelbar am Snapshot nachgewiesen; eine Prüfung von Übernahme, Börsenwert oder gewünschter weiterer Sichtbarkeit ist kein Teil dieses Befunds.

5. **META, Kalenderkontrolle**. [Form 10-Q, SEC 0001628280-26-050705](https://www.sec.gov/Archives/edgar/data/1326801/000162828026050705/meta-20260630.htm), Note 2 Revenue, gedruckte Seite 13, zusätzlich Condensed Consolidated Statements of Income. Suchzitate „Three Months Ended June 30,“ und „60,801“. Die Umsatzspalten für 2026 und 2025 enthalten 60.801 und 47.516 Millionen USD. Dimensionslose Inline-XBRL-Kontexte `c-10` und `c-11` nennen 2026-04-01 bis 2026-06-30 sowie 2025-04-01 bis 2025-06-30. Datei `META-20260630-10Q.html`.

6. **MSFT, Monatsendkontrolle bei abweichendem Geschäftsjahr**. [Q4-Ergebnisveröffentlichung des Emittenten](https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast), Income Statements. Suchzitate „Three Months Ended“ und „Total revenue“. Die Dreimonatsspalten bis zum 30. Juni nennen 2026 und 2025 sowie 90.007 und 76.441 Millionen USD. Zusätzlich [Form 10-K, SEC 0001193125-26-323660](https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm) mit Geschäftsjahresende 30.06.2026 gespeichert. Der Quartalsvergleich stammt ausdrücklich aus der Original-Ergebnisveröffentlichung, nicht aus der Jahresumsatzzeile. Dateien `MSFT-20260630-earnings.html` und `MSFT-20260630-10K.html`.

## Nachrechenbarer Nachweis und Grenzen

`filing-comparisons.json` enthält je Firma die beiden eingefrorenen Enddaten, die Originalenden, Umsatzoperanden, Quelle samt SHA256 und das Rechenergebnis. `node check-filing-evidence.cjs` prüft die sechs aktuellen Snapshot-Zeilen, die Originaldatei-Hashes, die Umsatzrechnung und die erwarteten vier abweichenden sowie zwei passenden Periodenpaare. Ausgeführtes Ergebnis: 6 geprüfte Zeilen, 4 abweichende Periodenpaare, 2 passende Kontrollpaare, 6 passende Wachstumszahlen.

Die Quellenwerte im Prüfskript wurden aus den geöffneten Originaltabellen übertragen. Das Skript ist ein Rechen- und Integritätscheck und ersetzt die unabhängige Sichtung der Tabellen nicht. Es ändert weder Export noch Repository. Eine Zuordnung zum vollständigen ursprünglichen Rechenweg des Screeners, eine Häufigkeitsmessung und eine Änderung der Periodenlogik sind nicht Gegenstand dieser Teilprüfung. Aus der Stichprobe folgt ausschließlich: Die vier dargestellten Periodenpaare widersprechen ihren Originalberichten, während die Umsatzrechnung zu den identifizierten Originalquartalen passt. Sicherheit 99 %.

## P68: historical fixture evidence (offline, 06.10.2026)

The following excerpts are verbatim JSON facts from the supplied `tests/fixtures/period-labels/period-fixtures.json`, not quotations from reopened filing pages. The fixture records the original SEC-cache hashes. Filing index URLs below are constructed from its CIK/accession identifiers; no network request was made. Each hand-table source identifies this copied SEC-fact provenance in `page`. Current P55 pairs above keep their original filing quotes. Three historical Q4 values are exact annual-minus-nine-month differences with the same start date. This proves those individual labels only; it changes neither a computational rule nor the Q4 overlay.

### CRDO: 2026-04-30 -> 2026-05-02, USD 437003000

Exact value proof: 1335116000 - 898113000 = 437003000.

Source: https://www.sec.gov/Archives/edgar/data/1807794/000162828026043303/0001628280-26-043303-index.html

Copied SEC companyfacts, us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax, 0001628280-26-043303; JSON fact, not a filing-page quotation

```json
{
  "start": "2025-05-04",
  "end": "2026-05-02",
  "val": 1335116000,
  "accn": "0001628280-26-043303",
  "fy": 2026,
  "fp": "FY",
  "form": "10-K",
  "filed": "2026-06-15",
  "frame": "CY2025"
}
```

Source: https://www.sec.gov/Archives/edgar/data/1807794/000162828026014017/0001628280-26-014017-index.html

Copied SEC companyfacts, us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax, 0001628280-26-014017; JSON fact, not a filing-page quotation

```json
{
  "start": "2025-05-04",
  "end": "2026-01-31",
  "val": 898113000,
  "accn": "0001628280-26-014017",
  "fy": 2026,
  "fp": "Q3",
  "form": "10-Q",
  "filed": "2026-03-03"
}
```

### CRDO: 2026-01-31 -> 2026-01-31, USD 407012000

Exact value proof: 407012000 = 407012000.

Source: https://www.sec.gov/Archives/edgar/data/1807794/000162828026014017/0001628280-26-014017-index.html

Copied SEC companyfacts, us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax, 0001628280-26-014017; JSON fact, not a filing-page quotation

```json
{
  "start": "2025-11-02",
  "end": "2026-01-31",
  "val": 407012000,
  "accn": "0001628280-26-014017",
  "fy": 2026,
  "fp": "Q3",
  "form": "10-Q",
  "filed": "2026-03-03",
  "frame": "CY2025Q4"
}
```

### CRDO: 2025-10-31 -> 2025-11-01, USD 268027000

Exact value proof: 268027000 = 268027000.

Source: https://www.sec.gov/Archives/edgar/data/1807794/000162828025054549/0001628280-25-054549-index.html

Copied SEC companyfacts, us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax, 0001628280-25-054549; JSON fact, not a filing-page quotation

```json
{
  "start": "2025-08-03",
  "end": "2025-11-01",
  "val": 268027000,
  "accn": "0001628280-25-054549",
  "fy": 2026,
  "fp": "Q2",
  "form": "10-Q",
  "filed": "2025-12-02",
  "frame": "CY2025Q3"
}
```

### CRDO: 2025-04-30 -> 2025-05-03, USD 170025000

Exact value proof: 436775000 - 266750000 = 170025000.

Source: https://www.sec.gov/Archives/edgar/data/1807794/000162828025033813/0001628280-25-033813-index.html

Copied SEC companyfacts, us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax, 0001628280-25-033813; JSON fact, not a filing-page quotation

```json
{
  "start": "2024-04-28",
  "end": "2025-05-03",
  "val": 436775000,
  "accn": "0001628280-25-033813",
  "fy": 2025,
  "fp": "FY",
  "form": "10-K",
  "filed": "2025-07-02"
}
```

Source: https://www.sec.gov/Archives/edgar/data/1807794/000162828025011738/0001628280-25-011738-index.html

Copied SEC companyfacts, us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax, 0001628280-25-011738; JSON fact, not a filing-page quotation

```json
{
  "start": "2024-04-28",
  "end": "2025-02-01",
  "val": 266750000,
  "accn": "0001628280-25-011738",
  "fy": 2025,
  "fp": "Q3",
  "form": "10-Q",
  "filed": "2025-03-10"
}
```

### KLIC: 2026-03-31 -> 2026-04-04, USD 242621000

Exact value proof: 242621000 = 242621000.

Source: https://www.sec.gov/Archives/edgar/data/56978/000005697826000020/0000056978-26-000020-index.html

Copied SEC companyfacts, us-gaap:Revenues, 0000056978-26-000020; JSON fact, not a filing-page quotation

```json
{
  "start": "2026-01-04",
  "end": "2026-04-04",
  "val": 242621000,
  "accn": "0000056978-26-000020",
  "fy": 2026,
  "fp": "Q2",
  "form": "10-Q",
  "filed": "2026-05-07",
  "frame": "CY2026Q1"
}
```

### KLIC: 2025-12-31 -> 2026-01-03, USD 199625000

Exact value proof: 199625000 = 199625000.

Source: https://www.sec.gov/Archives/edgar/data/56978/000005697826000012/0000056978-26-000012-index.html

Copied SEC companyfacts, us-gaap:Revenues, 0000056978-26-000012; JSON fact, not a filing-page quotation

```json
{
  "start": "2025-10-05",
  "end": "2026-01-03",
  "val": 199625000,
  "accn": "0000056978-26-000012",
  "fy": 2026,
  "fp": "Q1",
  "form": "10-Q",
  "filed": "2026-02-05",
  "frame": "CY2025Q4"
}
```

### KLIC: 2025-09-30 -> 2025-10-04, USD 177558000

Exact value proof: 654081000 - 476523000 = 177558000.

Source: https://www.sec.gov/Archives/edgar/data/56978/000005697825000081/0000056978-25-000081-index.html

Copied SEC companyfacts, us-gaap:Revenues, 0000056978-25-000081; JSON fact, not a filing-page quotation

```json
{
  "start": "2024-09-29",
  "end": "2025-10-04",
  "val": 654081000,
  "accn": "0000056978-25-000081",
  "fy": 2025,
  "fp": "FY",
  "form": "10-K",
  "filed": "2025-11-20",
  "frame": "CY2025"
}
```

Source: https://www.sec.gov/Archives/edgar/data/56978/000005697825000071/0000056978-25-000071-index.html

Copied SEC companyfacts, us-gaap:Revenues, 0000056978-25-000071; JSON fact, not a filing-page quotation

```json
{
  "start": "2024-09-29",
  "end": "2025-06-28",
  "val": 476523000,
  "accn": "0000056978-25-000071",
  "fy": 2025,
  "fp": "Q3",
  "form": "10-Q",
  "filed": "2025-08-06"
}
```

### KLIC: 2025-03-31 -> 2025-03-29, USD 161986000

Exact value proof: 161986000 = 161986000.

Source: https://www.sec.gov/Archives/edgar/data/56978/000005697826000020/0000056978-26-000020-index.html

Copied SEC companyfacts, us-gaap:Revenues, 0000056978-26-000020; JSON fact, not a filing-page quotation

```json
{
  "start": "2024-12-29",
  "end": "2025-03-29",
  "val": 161986000,
  "accn": "0000056978-26-000020",
  "fy": 2026,
  "fp": "Q2",
  "form": "10-Q",
  "filed": "2026-05-07",
  "frame": "CY2025Q1"
}
```
