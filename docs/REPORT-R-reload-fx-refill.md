# Klasse R (B): Neuabruf nicht mehr am Wechselkurs scheitern lassen

> **Auf einen Blick**
> Der Neuabruf veralteter Quartale verwarf bisher den ganzen neuen Yahoo-Datensatz, wenn Yahoo eine einzelne alte Zelle leer ließ und sich der Wechselkurs seit dem letzten Abruf geändert hatte. Neu wird diese Zelle aus der Originalwährung zum neuen Kurs wiederhergestellt. Im echten Neuabruf der 521 am 21.11. verworfenen Firmen (23.11.2026) sinken die Verwerfungen von 492 auf 317, und 196 statt 26 Firmen bekommen ein neueres Quartal.
>
> - Boards (Datentag 21.11., feste Kalibrierung): Von 244 HyperGrowth-Zeilen dieser Firmen zeigen 49 einen neueren Zeitraum (42 davon Q3 2026 statt Q2 2026), **keine einen älteren**, bei keiner geht das Wachstum verloren; keine Zeile außerhalb dieser Firmen ändert ihren Score.
> - Sichtbare Beispiele: Endesa (ELE.MC) Versorger 127 → 26 (+3,5 % → +26,9 %), Prio (PRIO3.SA) Energie 167 → 48, ITEQ (6213.TW) 242 → 76, Terna (TRN.MI) 70 → 228 (+13,4 % → +1,3 %).

Stand 23.11.2026, Zählebene Ticker, Code main `98d40dcf` gegen diesen Zweig. Gebaut von Claude (Opus), Codex war leer. Ändert sichtbare Zahlen, deshalb Entwurf bis zur Prüfung durch die andere KI.

## 1. Ursache (nachgestellt an 20 der 521 Fälle)

Die Sperre steht in `pull-yahoo.js` (Repo-Hauptordner) beim Neuabruf: `lib/reload-history.js` `historyIsThinner` meldet den neuen Datensatz als „dünner“, dann bleiben die alten Zahlen und nur der Kurs wird erneuert. Vorher füllt `preserveReloadHistory` leere Zellen aus dem gespeicherten Stand, aber nur bei exakt gleichem Umrechnungskurs. Weil der Kurs sich täglich ändert, blieb bei Firmen außerhalb der USA jede von Yahoo leer gelassene alte Zelle leer, und der ganze Abruf wurde verworfen, auch das neue Quartal. Bei 9 der 20 nachgestellten Fälle war das die Ursache (ISA Energia, Usiminas, Eni und andere); bei 9 rutscht Yahoos Quartalsfenster (eigener Zweig A, nicht Teil dieses PR), bei 3 fehlt neu ein Reingewinn-Quartal (offen). Ein Fall (8362.T) hat beide ersten Ursachen, deshalb ergeben die Zahlen zusammen 21. Bericht: `C:\Users\Anwender\.codex\reports\f5-rest-2026-11-23\diener3\t5\mechanismus.md`.

## 2. Was sich ändert

- Eine leere Zelle einer Geldreihe derselben Originalwährung wird aus dem gespeicherten Wert zurückgerechnet (gespeicherter USD-Wert / alter Kurs × neuer Kurs). So steht jeder Zeitraum eines Datensatzes auf einem Kurs (T1). Ausgenommen sind die Firmen der Abschlusswährungs-Handtabelle (etwa Petrobras, Vale, YPF): Ihre Reihen stehen zum Faktor 1, dort gilt weiter die alte Regel „gleicher Kurs“ (Auflage der Opus-Prüfung).
- Nur wenn die Reihe zum neuen Datensatz passt: Alle Zeiträume, die beide Datensätze mit Wert haben, müssen in der Originalwährung auf 0,5 % übereinstimmen. Anlass: Bei Logista (LOG.MC) hat Yahoo die Umsatzzeile umgestellt (gespeichert rund 2 Mrd., neu 13,8 Mrd. EUR) und 2025 leer gelassen; ohne diese Prüfung hätte das Board +664,9 % gezeigt.
- Aktienzahlen, Bilanzzeilen und Zellen mit Handtabellen- oder Börsenvermerk brauchen weiter den gleichen Kurs.
- Neue Sperre beim Neuabruf: Würde der gezeigte Wachstumszeitraum älter, bleibt der alte Stand (`shown growth period regressed`). Anlass: Bei Mirae Asset (006800.KS) kam das neueste Quartal ohne Umsatz, und das Board wäre von Q2 2026 auf das Geschäftsjahr 2025 zurückgefallen. Im Lauf griff die Sperre 22-mal.

## 3. Vorher/Nachher

Messweise: Beide Arme haben am 23.11.2026 zur selben Zeit (etwa 08:57 bis 09:15 MEZ) dieselben 521 Firmen bei Yahoo neu abgerufen, gespeicherter Stand jeweils der Snapshot vom 21.11. (Lauf 44891236922), erzwungener Neuabruf (`STALE_QUARTER_RELOAD=local`). Danach die übrigen 15.251 Snapshots vom 21.11. unverändert dazu, `src/scoring/run-screener.js` mit fester Kalibrierung (Lineal von main) und `scripts/write-findash-export.js`, Uhr `RUN_DATE_UTC=2026-11-21`.

| Neuabruf der 521 Firmen | main | dieser Zweig |
|---|---:|---:|
| verworfen („shared-period fundamentals missing“) | 492 | 295 |
| verworfen (gezeigter Zeitraum würde älter) | 0 | 22 |
| übernommen mit neuerem Quartal | 26 | 196 |

| 244 HyperGrowth-Zeilen dieser Firmen | Anzahl |
|---|---:|
| gezeigter Zeitraum neuer | 49 (42 × Q2 → Q3 2026, 5 Geschäftsjahre, 1 erstmals mit Wachstum, 1 Quartal → neueres Geschäftsjahr) |
| gezeigter Zeitraum älter | **0** |
| Wachstum verloren | **0** |
| neu auf einem Board | 4 |
| gleicher Zeitraum, andere Wachstumszahl | 0 |

Rangbewegungen in den Top-Listen (85 sichtbare Zeilen dieser Firmen): 40 Zeilen bewegen sich, auch solche mit gleichem Wachstumszeitraum, weil andere Achsen (Bruttogewinn, Marge, Beschleunigung) jetzt das neue Quartal sehen, etwa Al Masane (4030.SR) 46 → 120. Größte Wechsel mit neuem Zeitraum: ZF CV India 611 → 76, ITEQ 242 → 76, Prio 167 → 48, Endesa 127 → 26, Euronext (ENX.VI) 78 → 48; abwärts Terna 70 → 228, 300469.SZ 54 → 134, Pell Bio-Med (6949.TW) 46 → 113, Stellantis (8TI.DE) 30 → 67.

Auffällig, aber erklärbar: Bradsaúde (SAUD3.SA) +1.213 % → +1.830 %; Yahoo selbst meldet Q3 2026 rund 2,0 Mrd. gegen Q3 2025 rund 105 Mio. BRL (Zusammenschluss), die Rückrechnung betraf nur Q2 2025 (104 Mio., passend zu den Nachbarquartalen).

## 4. Prüfung

- Blinde Opus-Prüfung 23.11.: APPROVE MIT AUFLAGEN (80 %), Bericht `C:\Users\Anwender\.codex\reports\diener3-2026-11-23\review-153.md`. Umgesetzt: Ausnahme für die Abschlusswährungs-Handtabelle mit Test (M1), Grenzen zum Vollabruf und zur Wachstums-Zusage im Bericht (M2, N2), Warnung statt stillem Abschalten der Sperre (N1), Fallzählung (N6). Offen und vermerkt: doppelte Handtabellen-Zähler durch die lesenden Aufrufe (N3), ein Pull-Test für einen Fensterwechsel, der weiter in den Cache schreibt (N4), sha256-Vergleich im Speicher-Absichtlich-rot-Test (N5).

- `tests/reload-fx-refill.test.js` (neu, 7 grün): echter ISA-Datensatz (opIncQ 30.06.2025 zum neuen BRL-Kurs), gleicher Kurs wie bisher, keine Füllung bei anderer Originalwährung, abweichendem Nachbarwert oder Vermerk, echter Logista-Fall bleibt leer; Absichtlich-rot-Prüfungen für Kursfaktor, Originalwährungs-Vergleich und Reihenprüfung.
- `tests/c10-reload-boundaries.test.js` (21 grün): zwei Erwartungen bewusst angepasst (Kurswechsel ohne passenden Originalwert, Fensterwechsel verliert das Vorjahresquartal des gezeigten Wachstums und wird jetzt verworfen), neuer Fall für die Zeitraum-Sperre mit Absichtlich-rot-Prüfung.
- `tests/exchange-quarter-check-wiring.test.js`: zweite, rein lesende Aufrufstelle von `prepareSnapshot(…, { atPull: true })` zugelassen und geprüft.
- Weitere Neuabruf-, Handtabellen- und JSDoc-Tests grün.

## 5. Grenzen

- Die Nachfüllung läuft nicht nur beim Neuabruf, sondern bei jedem Vollabruf mit gespeichertem Snapshot. Im Betrieb ändert sie also auch Zahlen von Firmen außerhalb der 521; dieses Vorher/Nachher hat nur die 521 neu abgerufen und alle übrigen Snapshots festgehalten. Wie viele Vollabrufe sie im Tageslauf trifft, ist nicht gemessen; die Einträge `fxRescaled` in `meta.reloadHistoryRetained` zeigen es nach dem ersten Lauf.
- „Wachstum verloren: 0“ ist eine Messung aus diesem Lauf: Verschwindet das Wachstum beim Neuabruf ganz (etwa nach einem Wechsel des Geschäftsjahres), übernimmt der Code den neuen Stand wie bisher; die Sperre greift nur, wenn ein Wachstum mit älterem Zeitraum übrig bliebe.

- 317 Neuabrufe scheitern weiter, vor allem am rutschenden Quartalsfenster (Zweig A `claude/reload-keep-yago`, gebaut, noch nicht fertig: er verwirft im selben Lauf mehr statt weniger, Mechanismus im Codex-Auftrag beschrieben) und am rutschenden Jahresfenster (etwa ISA Energia, annualFCF 2021).
- Die Reihenprüfung gilt nur für den neuen Kurs-Weg. Bei gleichem Kurs (USD-Berichter) füllt der alte Weg wie bisher ohne sie; dieselbe Schwachstelle wie bei Logista ist dort möglich (nicht gemessen).
- 29 Neuabrufe übernimmt schon main (26 davon mit neuerem Quartal); sie sind in beiden Armen gleich behandelt.

Arbeitsdateien: `C:\Users\Anwender\.codex\reports\f5-rest-2026-11-23\diener3\r2\` (Arme `old`, `b`, `ab`, Logs, `score-old`, `score-b`), Vergleich `...\diener3\rB\cmpR.js`.
