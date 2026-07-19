# ChatGPT Bug hunt

> Status: ABGESCHLOSSEN — read-only Vollprojekt-Audit 2026-07-18  
> Baseline: `main` @ `04053462b4670ce35b120ac3721f6e8a72c25a68`  
> Auftrag: Jeden belegbaren Code-, Daten-, Integrations-, Test-, Dokumentations- und Logikfehler sammeln. Nichts reparieren. Claude prüft und entscheidet anschließend, was ein echtes Problem ist.

## Leseschlüssel

- **T1 — belegt:** Mechanismus und Auslöser am aktuellen Code nachvollzogen.
- **T2 — starker Verdacht:** konkrete Evidenz und plausible Kausalkette; Gegenprüfung fehlt noch.
- **T3 — Prüfhinweis:** auffälliges Muster oder Widerspruch; bewusst noch kein bestätigter Bug.
- **Schweregrad:** `KRITISCH`, `HOCH`, `MITTEL`, `NIEDRIG` oder `HINWEIS`.
- Jeder Fund erhält genau eine fortlaufende Kennung `BH-###`. Ähnliche Rohfunde werden vor Aufnahme zusammengeführt.

## Audit-Grenzen und Vorgehen

- Der vorhandene `pipeline-audit`-Skill wurde vorab geprüft und unverändert verworfen: kaputter Pflichtpfad, nicht ausführbare Parallelitätsannahme, Konflikte mit aktuellen Projektregeln und nur etwa 40–45 % belastbare Gesamtprojekt-Abdeckung.
- Übernommen werden nur seine guten Qualitätsregeln: exakte Fundstelle, Mechanismus, Auslöser, Auswirkung, Evidenzstufe und unabhängige Deduplizierung.
- Geprüft werden Produktionscode, sämtliche Tests und Gates, CI/Automationen, Zustands- und Historienlogik, Datenverträge, Scoring-/Board-Logik, Mess-/Backtestlogik, Export/Findash-Vertrag sowie Widersprüche zwischen Code, Masterplan, Verfassung und aktiver Dokumentation.
- Frühere Audit-Funde werden nie ungeprüft übernommen. Produktcode, Tests, Konfigurationen, Daten und bestehende Historien werden nicht verändert.

## Ergebnis für Claude

- **198 fortlaufende Prüfkandidaten:** 19 `KRITISCH`, 103 `HOCH`, 61 `MITTEL`, 12 `NIEDRIG`, 3 `HINWEIS`.
- **Evidenz:** 146 T1-code-/datenbelegt, 39 T2-starker Verdacht, 13 T3-Prüf-/Governancehinweise. Das ist bewusst **keine** Behauptung „198 bestätigte Produktbugs“; Claude entscheidet nach Gegenprüfung, welche Punkte echte Probleme sind.
- **Unabhängige Schlussprüfung:** alle 19 kritischen, deutlich mehr als 15 hohe und anschließend BH-192 bis BH-198 separat gegen Code/Artefakte verifiziert; IDs 001–198 lückenlos, keine doppelte ID, kein zwingendes Duplikat, jeder Fund mit eigener Claude-Prüfung.
- **Höchste morgige Prüfreihenfolge:** (1) Pages-Löschung und falscher Live-Scoringkorpus BH-113/114/116; (2) Delisting-/FDR-/Bootstrap-/Survivorship-Messbruch BH-101/102/107/108/148/150/157; (3) aktuell ausgefallene Universe-/Coverage-Alarmkette BH-038/100/118/126; (4) irreversible State-/History-Verluste BH-103/144/152/190; (5) im Findash unsichtbare Fehler/Standing BH-089 bis BH-093.
- **Wichtig:** Der aktuelle Daily-Run ist grün, obwohl der Live-Log Universe-Ausfälle und 38,3-%-Coverage als Degradation belegt. „Workflow success“ ist daher ausdrücklich kein Gegenbeweis zu den Findings.
- **Änderungsnachweis:** Kein Code, keine Konfiguration, keine Daten, kein Workflow und kein bestehendes Dokument wurde geändert. Neu ist ausschließlich dieses Auditdokument; nichts wurde committed oder gepusht.

## Fortlaufende Findings

### BH-001 — HOCH · T1 — Frische Yahoo-Läufe entfernen alte Phantom- und Falschbasis-Preise nie

- **Fundstelle:** `pull-historical-prices.js:218-227`; gleicher Mechanismus in `scripts/backfill-prices.js:174-184`; direkte Consumer in `scripts/walk-forward-perf.js:217-230` und `scripts/walk-forward-perf.js:272-280`.
- **Fehler:** Beide Writer bauen den Merge zuerst aus *allen* vorhandenen Datumszeilen auf und überschreiben nur Datumswerte, die Yahoo erneut liefert. Alte Datumszeilen, die Yahoo heute gar nicht mehr liefert, werden nie entfernt. Der Kommentar nennt den Pfad „fetched wins“, tatsächlich gilt für nicht erneut gelieferte Schlüssel weiterhin „existing survives forever“.
- **Mechanismus:** Historische Phantom-Zeilen und alte Split-/Adjustierungsbasen bleiben im `Map`; der tägliche 400-Tage-Refresh kann sie nicht heilen. Die Return-Consumer akzeptieren einen vorhandenen exakten Datumsschlüssel ohne Plausibilitätsprüfung. Damit wird ein Phantom-Preis zum regulären Entry-/Exit-Preis.
- **Beleg am aktuellen Store:** 28.025 Wochenend-Zeilen in `prices/history/history-*.json`; 334 davon springen gegenüber dem benachbarten Werktag um Faktor >2 oder <0,5, verteilt auf 306 Ticker. Beispiel `history-00.json → KLAC`: 2026-05-09/10 = 1.869,19 und 2026-05-17 = 1.804,32, während die angrenzende frisch adjustierte Serie bei etwa 175–189 liegt. Noch extremer: `HGYMF` am 2026-05-17 = 251.450.560 gegenüber 34,99 am benachbarten Werktag.
- **Auswirkung:** Walk-forward-, Alpha- und rankIC-Auswertungen können bei passenden Vintage-/Horizontdaten Splitfaktoren oder Fantasiepreise als echte Rendite buchen. Das ist stille Messdaten-Korruption; bestandene Tests decken die Bereinigung bereits vorhandener Phantom-Schlüssel nicht ab.
- **Claude-Prüfung:** Store-Scan reproduzieren; für mehrere betroffene Ticker den aktuellen Yahoo-400-Tage-Datumsbestand gegen gespeicherte Schlüssel differenzieren; anschließend betroffene bestehende Walk-forward-/rankIC-Punkte bestimmen. Noch nichts bereinigen, bevor Umfang und Messbruch dokumentiert sind.

### BH-002 — HOCH · T1 — UTC-Konvertierung datiert australische Handelstage systematisch einen Tag zu früh

- **Fundstelle:** `pull-historical-prices.js:181-183`, `pull-historical-prices.js:219-222`, `pull-historical-prices.js:287-289`, `scripts/backfill-prices.js:73-76`.
- **Fehler:** Die Writer machen aus `quote.date` pauschal `toISOString().slice(0, 10)`. Bei ASX-Daten repräsentiert das Date-Objekt den lokalen Handelstag; die UTC-Konvertierung verschiebt den Kalendertag zurück.
- **Mechanismus:** Ein australischer Montag wird als UTC-Sonntag gespeichert. Die globale Return-Logik behandelt den String anschließend als echten kanonischen Handelstag und akzeptiert ihn als exakten Preis. Dadurch kann ein Sonntag-Target für Australien bereits den lokalen Montagsschluss enthalten, während der US-Benchmark noch auf Freitag steht.
- **Beleg am aktuellen Store:** Nach Ausschluss der drei bekannten globalen Phantomdaten verbleiben 2.475 Wochenend-Zeilen ausschließlich für `.AX`. `JBH.AX`, `BHP.AX` und `CSL.AX` zeigen wiederholt Sonntag–Donnerstag statt Montag–Freitag, z. B. 2026-03-15 bis 2026-03-19 und 2026-03-22 bis 2026-03-26; die Freitage fehlen entsprechend.
- **Auswirkung:** Globale Renditefenster, Staleness-Bewertung und Benchmarkvergleich sind für australische Titel um einen Handelstag versetzt; je nach Target entsteht Look-ahead oder ein verkürztes/verschobenes Fenster.
- **Claude-Prüfung:** `quote.date` plus Yahoo-Metadaten für mehrere `.AX`-Ticker offline/logisch gegen den tatsächlichen Exchange-Kalendertag prüfen und alle Datumskonsumenten auf die beabsichtigte Zeitzone abgleichen.

### BH-003 — HOCH · T1 — Die einzigen Live-Universums-Regressionstests laufen in CI nie gegen das frisch gescorte Universum

- **Fundstelle:** `.github/workflows/daily-pull.yml:90-170` und `.github/workflows/daily-pull.yml:759-838`; Skip-Pfade in `tests/scoring/score.integration.test.js:32-58`, `tests/scoring/quality-board.test.js:32-47`, `tests/scoring/phase.test.js:93-103` und `tests/scoring/score-breakdown.test.js:21-32`.
- **Fehler:** Das einzige vollständige Test-Gate läuft *vor* dem Pull. Ein frischer Checkout enthält unter `snapshots/` nur das getrackte `_manifest.json`, aber keine Ticker-Snapshots. Genau deshalb überspringen die datenabhängigen Tests ihre Live-Anker absichtlich und enden trotzdem mit Exit 0. Der spätere `scoring`-Job lädt zwar das frische Snapshot-Artefakt, führt danach jedoch keinen dieser Tests erneut aus; er prüft nur Dateizahlen und das Export-Schema.
- **Mechanismus:** Fehler, die nur an realer Universumszusammensetzung, Routing, Ranking, Kohortenbildung oder Board-Zerlegung sichtbar werden, passieren das Pre-Pull-Gate. Die frischen Daten stehen erst in dem Job zur Verfügung, in dem das Regressionnetz nicht mehr aufgerufen wird.
- **Reproduzierbarer Beleg:** Mit leerem Snapshot-Verzeichnis meldet `score.integration.test.js` **10 ok / 15 skipped**, `quality-board.test.js` **23 ok / 4 skipped**, `phase.test.js` **11 ok / 1 skipped**; `score-breakdown.test.js` beendet sich bei `<100` Snapshots vollständig mit **0 ok / 0 fail**. `skip-honesty.test.js` beweist nur, dass diese Auslassungen ehrlich beschriftet werden und Exit 0 behalten — nicht, dass die Produktionsinvarianten geprüft wurden.
- **Auswirkung:** Ein realdatenabhängiger Scoring-/Board-Regress kann mit vollständig grünem Test-Gate deployt werden. Betroffen sind unter anderem echte Anker-Ränge, reales Issuer-Dedup, Branchen-/Track-Routing, Quality-vs-Hypergrowth-Seam, Phase-Felder und Score-Breakdown.
- **Claude-Prüfung:** Im `scoring`-Job unmittelbar nach Artefakt-Download mindestens die vier Live-Universums-Suites ausführen und einen Vertrag ergänzen, dass dort kein Universums-Skip zulässig ist; den bestehenden Pre-Pull-Synthetik-Gate separat beibehalten.

### BH-004 — HOCH · T1 — Der monatliche SEC-XBRL-Job baut den vom Scorer gelesenen SEC-Store überhaupt nicht

- **Fundstelle:** `.github/workflows/monthly-sec-xbrl.yml:3-5`, `:58-73`, `:116-120`; `scripts/build-secannual.js:4-15`; Consumer `src/scoring/run-screener.js:118-145`.
- **Fehler/Mechanismus:** Ein frischer GitHub-Runner lädt höchstens 1.500 Company-Facts-Dateien in den git-ignorierten, ephemeren Ordner `external-data/sec-xbrl/` und committet nur dessen Manifest. `scripts/build-secannual.js` wird in keinem Workflow ausgeführt. Der Live-Scorer liest ausschließlich den separaten committeten Store `external-data/sec-secannual.json`.
- **Auswirkung:** Der Monatsjob kann grün und „fortgeschritten“ aussehen, ohne eine einzige der tatsächlich gescorten SEC-Serien zu aktualisieren; der Workflow räumt selbst ein, dass Roh-Coverage auf frischen Runnern nicht akkumuliert.
- **Claude-Prüfung:** Monatslauf aus frischem Checkout verfolgen; der End-Diff muss einen validierten Scorer-Store bzw. einen persistenten Rohbestand enthalten und nicht nur `_manifest.json`.

### BH-005 — HOCH · T1 — SEC-Höflichkeitsabbrüche enden als erfolgreicher Teil-Lauf mit Exit 0

- **Fundstelle:** `pull-sec-xbrl.js:198-220`, `:231-238`; Gate `.github/workflows/monthly-sec-xbrl.yml:88-114`.
- **Fehler/Mechanismus:** Bei mehr als 50 normalen Fehlern oder mehr als 200 Rate-Limits führt der Puller nur `break` aus. Die Summary enthält weder `aborted` noch `processed/completed`; `main()` endet regulär. Das Gate blockt nur bei Fehlerquote >50 %, während `ok<50` bloß warnt. Beispiel: 100 erfolgreiche Antworten plus 51 Serverfehler brechen nach 151 von 1.500 ab, bleiben mit 33,8 % Fehlerquote aber grün.
- **Auswirkung:** Ein abgebrochener Teilbestand wird als gesunder Monatsstand publiziert und dessen Manifest überschreibt den vorherigen Status.
- **Claude-Prüfung:** HTTP-Fixture `100×200 + 51×500`; zwingend non-zero oder `aborted=true` und harter `processed===todo`-Vertrag.

### BH-006 — HOCH · T1 — Der SEC-Extraktor ignoriert 10-K/A-Restaatements

- **Fundstelle:** `merge-sec-xbrl.js:53-63`; fehlende Killer-Fixture in `tests/scoring/merge-sec-xbrl.test.js`.
- **Fehler/Mechanismus:** `annualConcept()` akzeptiert exakt `form === '10-K'`, nicht `10-K/A`, und wählt nur über das größte Periodenende. Eine spätere Korrektur desselben Geschäftsjahres ist damit unsichtbar. Die synthetische Gegenprobe mit 10-K-Wert 100 und späterem 10-K/A-Wert 120 liefert weiterhin 100.
- **Auswirkung:** Als korrigiert bekannte Umsatz-, Ergebnis-, Cashflow- und Bilanzwerte bleiben veraltet in Cycle-Damper und Quality-Achsen.
- **Claude-Prüfung:** Restatement-Policy festlegen und Fixture mit gleicher FY/End-Periode, späterem `filed`/`accn` ergänzen.

### BH-007 — HOCH · T1 — Gleiche FY-Nummer wird fälschlich mit „derselbe 10-K“ gleichgesetzt

- **Fundstelle:** `merge-sec-xbrl.js:53-73`, `:76-109`, besonders die falsche Zusicherung in `:105-106`.
- **Fehler/Mechanismus:** Jede Kennzahl wird separat nach `fy` ausgewählt. `end`, `filed` und `accn` gehen anschließend verloren; `buildAnnual()` richtet nur auf dem FY-Schlüssel aus. Assets, Current Liabilities und Operating Income können daher aus verschiedenen Periodenenden oder Filing-Vintages stammen, obwohl der Kommentar „DEMSELBEN 10-K“ behauptet.
- **Auswirkung:** Margen, FCF- und ROIC-Paare wirken indexkohärent, können aber aus nicht zusammengehörigen Abschlüssen berechnet sein.
- **Claude-Prüfung:** End-/Accession-Mismatch-Fixture; Zellen nur paaren, wenn Perioden- und Filing-Identität nachgewiesen ist.

### BH-008 — HOCH · T1 — Der committete SEC-Vertrag kann Point-in-Time und Restatement-Vintages nicht darstellen

- **Fundstelle:** `merge-sec-xbrl.js:97-109`; `scripts/build-secannual.js:112-121`; Consumer `src/scoring/run-screener.js:142-145`; PIT-Mandat im Masterplan Abschnitt 6.2/B1–B6.
- **Fehler/Mechanismus:** Im Store bleiben nur Wertarrays und CIK. Geschäftsjahrachse, Periodenende, Filing-Datum, Accession, Unit/Quellwährung und der gültige Daten-Vintage werden entfernt. Ein späterer Neuaufbau kann frühere Perioden rückwirkend ändern, ohne dass ein historischer Scorer erkennen kann, wann der Wert verfügbar war.
- **Auswirkung:** `asOf < filed` lässt sich technisch nicht durchsetzen; historische Auswertungen können Restatements und später eingegangene Vergleichswerte vorwegnehmen.
- **Claude-Prüfung:** PIT-Schema und Killer-Test „Fakt vor Filing-Datum unsichtbar; Restatement als neuer Vintage erhalten“.

### BH-009 — MITTEL · T1 — Vollständig fehlende Current Liabilities bestehen den Bilanz-Plausibilitätsguard

- **Fundstelle:** `scripts/build-secannual.js:54`, `:112-119`.
- **Fehler/Mechanismus:** `newestPresent()` liefert bei vollständig leerer Serie `null`; `Number(null) >= 0` ist in JavaScript wahr. Mit vorhandenen Assets wird deshalb ein fehlendes Current-Liabilities-Feld als plausible Null in den tiefen Store übernommen.
- **Auswirkung:** Bilanz-/ROIC-Coverage wird überzeichnet und eine echte Datenlücke als geprüfter tiefer Kanal ausgegeben.
- **Claude-Prüfung:** Fixture `Assets>0`, alle Current Liabilities null; der Guard muss fail-closed bleiben.

### BH-010 — MITTEL · T1 — Ein alter Repo-Rohcache gewinnt gegen den ausdrücklich angegebenen frischen SEC-Cache

- **Fundstelle:** `scripts/build-secannual.js:95-107`, `:121`.
- **Fehler/Mechanismus:** Für dieselbe CIK wird zuerst `external-data/sec-xbrl/<CIK>.json` gelesen und erst danach `SEC_XBRL_CACHE_DIR`. Damit ignoriert der Build einen explizit übergebenen neueren Cache, sobald irgendeine alte Repo-Datei existiert. Rohcache und finaler Store werden außerdem direkt statt atomar überschrieben.
- **Auswirkung:** Rebuilds können deterministisch veraltete Fakten verwenden; Abbruch beim Schreiben kann Rohdatei oder Gesamtstore truncaten.
- **Claude-Prüfung:** Zwei Cache-Fixtures mit verschiedenen Vintages; expliziter Cache muss Priorität haben, Write-Abbruch darf den letzten guten Store nicht zerstören.

### BH-011 — MITTEL · T1 — SEC-Coverage zählt tote Null-Einträge als erfolgreich gemergte Tiefe

- **Fundstelle:** `merge-sec-xbrl.js:48-50`, `:116-118`; `scripts/build-secannual.js:112-119`; `src/scoring/run-screener.js:137-148`.
- **Fehler/Mechanismus:** Extrahiert werden nur `facts['us-gaap']` und `units.USD`; IFRS-/andere Unit-Filer können trotzdem als Ticker-Key mit Nullarrays im Store landen. `mergeSecIntoUniverse()` erhöht seinen `merged`-Zähler bereits bei vorhandenem Key, nicht bei vorhandenen finiten Serien.
- **Datenbeleg:** `external-data/sec-secannual.json` enthält 124 Ticker-Keys, aber nur 97 mit irgendeinem Umsatz, 93 mit Operating Income, 91 mit beiden und 91 mit einem finiten ROIC-Trio.
- **Auswirkung:** Logs und Dokumentation suggerieren tiefere Fundamentalabdeckung als der Scorer tatsächlich nutzen kann; betroffene Namen fallen still auf Yahoo zurück.
- **Claude-Prüfung:** Coverage anhand finiter Feld-/Paarverträge statt Key-Zahl ausweisen; IFRS/Unit-Grenze explizit machen.

### BH-012 — HOCH · T1 — Der Korea-Adapter paart bei einer Feldlücke verschiedene Geschäftsjahre

- **Fundstelle:** `scripts/build-krannual.js:67-83`; positionaler Consumer `src/scoring/score.js:342-359`.
- **Fehler/Mechanismus:** Revenue und Operating Income werden je Feld separat über vorhandene Jahre kompaktiert. Fehlt etwa 2020 nur im Operating Income, steht dessen 2019-Wert anschließend am selben Arrayindex wie Revenue 2020. Eine gemeinsame Year-Axis oder Nullzelle existiert nicht.
- **Auswirkung:** Vorzeichenwechsel, Margen, Drawdowns und der Cycle-Damper für SK Hynix können aus falsch gepaarten Jahren entstehen.
- **Claude-Prüfung:** Asymmetrische Missing-Year-Fixture; gemeinsame `_fys`-Achse mit erhaltenen Nullzellen erzwingen.

### BH-013 — MITTEL · T1 — Der Korea-Adapter endet dauerhaft bei 2024 und trägt keinerlei Freshness-/Jahresvertrag

- **Fundstelle:** `scripts/build-krannual.js:31-34`, `:62-90`; `external-data/kr-secannual.json`.
- **Fehler/Mechanismus:** `YEARS` ist statisch 2015–2024. Im Jahr 2026 kann der Build das abgeschlossene Geschäftsjahr 2025 nie abrufen. Die Ausgabe enthält weder `_fys`, `generatedAt/asOf` noch einen gemeinsamen Achsenvertrag und wird nicht atomar überschrieben.
- **Auswirkung:** Der neueste Abschluss fehlt still; CI kann Alter und Vollständigkeit der regionalen Quelle nicht prüfen.
- **Claude-Prüfung:** Jahre dynamisch bis zum letzten abgeschlossenen FY; Freshness-/Achsenmetadaten und atomarer Write-Gate.

### BH-014 — HOCH · T1 — Die offizielle Small-Cap-„Stichprobe“ stammt nur aus vier vorselektierten Yahoo-Listen

- **Fundstelle:** `scripts/probe-smallcap-coverage.js:60-68`, `:878-936`, `:1244-1261`; offizieller Report `reports/smallcap-probe-messlauf2-2026-07-16.json`.
- **Fehler/Mechanismus:** Kandidaten stammen ausschließlich aus „Aggressive Small Caps“, Gainers, Most Shorted und Undervalued Growth; große Listen werden nur auf wenigen Startseiten angeschnitten. Der Seed randomisiert lediglich die 222 bereits vorselektierten In-Band-Ticker, nicht das Small-Cap-Zieluniversum. Der Report zieht 100 aus genau diesen 222 Kandidaten.
- **Auswirkung:** Die gemessenen Yahoo-/XBRL-Coverage-Raten sind selection-biased und kein belastbarer Beleg für die allgemeine $300M-Floor-Operating-Company-Population; ein darauf gestütztes GO kann falsch sein.
- **Claude-Prüfung:** Probability-Sample aus einer vollständigen Listing-/SEC-Basis im Cap-Band und Vergleich samt Konfidenzintervall.

### BH-015 — HOCH · T1 — Die Small-Cap-Probe kann Q4 aus verschiedenen Konzepten, Units oder Filings errechnen

- **Fundstelle:** `scripts/probe-smallcap-coverage.js:602-675`.
- **Fehler/Mechanismus:** `conceptFacts()` mischt priorisierte Revenue-Konzepte und nimmt bei fehlendem USD die erste beliebige Unit. `groupFacts()` wählt je Enddatum, danach wird Q4 als FY minus 9M abgeleitet, ohne gleiche Concept-, Unit-, Accession- und Filing-Identität zu fordern. So ist etwa `Revenues` minus `SalesRevenueNet` möglich.
- **Auswirkung:** Erfundenes Q4 kann Growth, Acceleration und Margin-Trajectory fälschlich als vorhanden oder stabil markieren.
- **Claude-Prüfung:** Cross-Concept-/Cross-Unit-Fixture; Ableitung nur bei identischer Fakt-Identität.

### BH-016 — MITTEL · T1 — Der Legacy-SEC-Fallback erfindet Jahresgleichheit anhand des Arrayindex

- **Fundstelle:** `scripts/probe-smallcap-coverage.js:697-712`, `:746-763`.
- **Fehler/Mechanismus:** Jedes Feld erhält separat künstliche Datumswerte `index-000`, `index-001`, …; `alignedPairs()` behandelt gleiche Indizes danach als gleiches Jahr. Bei kompaktierten Serien oder asymmetrischen Lücken werden nicht zusammengehörige Jahre gepaart.
- **Auswirkung:** Capital-Efficiency-, Dilution-, FCF- und Margin-Coverage können im Fallback falsch positiv werden.
- **Claude-Prüfung:** Ohne echte `_fys` keine Cross-Field-Paarung; Missing-Year-Fixture.

### BH-017 — MITTEL · T1 — Der Quartalsumsatz-Enricher hält 6M/9M-YTD-Werte für diskrete Quartale

- **Fundstelle:** `scripts/enrich-q-revenue.js:108-115`, `:124-155`.
- **Fehler/Mechanismus:** Für `fp` Q1/Q2/Q3 liefert `isQuarterlyPoint()` sofort `true`, noch bevor die Periodendauer geprüft wird. SEC Company Facts kann zum selben Enddatum sowohl 3M- als auch 6M/9M-YTD-Fakten führen; `byEnd` kann den kumulierten Wert behalten. Das daraus abgeleitete Q4 wird ebenfalls falsch.
- **Auswirkung:** Die gespeicherte YoY-Serie und frühere Durability-Signale können aus kumulierten statt diskreten Quartalen bestehen.
- **Claude-Prüfung:** Fixture mit 3M+6M bei identischem Enddatum/Q2; nur echte Quartalsdauer zulassen.

### BH-018 — MITTEL · T1 — Der Quartalsumsatz-Enricher zeigt auf einen nicht existierenden alten Rechnerpfad und hat keinen aktuellen Consumer

- **Fundstelle:** `scripts/enrich-q-revenue.js:16-30`, `:194-215`; nur noch dokumentarische Erwähnung in `docs/formula-spec-fabless-ai-connectivity-v5.2.md`.
- **Fehler/Mechanismus:** `ZIP_PATH` ist fest auf `C:/Users/Karlr/...` verdrahtet; auf der aktuellen Box ist weder dieser noch der entsprechende Anwender-Pfad vorhanden. Repo-weite Consumersuche findet `revQYoYsec` außerhalb Skript/Doku nicht mehr. Die inzwischen exportierten Extraktionsfunktionen besitzen keine eigene Test-Suite.
- **Auswirkung:** Der behauptete Datenpfad ist nicht reproduzierbar und wahrscheinlich ein toter Altpfad, während aktive Doku ihn weiterhin als verifiziert beschreibt.
- **Claude-Prüfung:** Vor Erhalt einen aktuellen Producer→Consumer-Trace nachweisen; Cachepfad konfigurierbar machen und Extraktionsfixtures ergänzen.

### BH-019 — MITTEL · T1 — Bindende Small-Cap-Messreports werden nicht atomar und ohne Regressionvertrag erzeugt

- **Fundstelle:** `scripts/probe-smallcap-coverage.js:1281-1284`, `:1575-1576`, `:1670-1674`, `:1685-1689`; keine passende Testsuite/Package-Route.
- **Fehler/Mechanismus:** Große offizielle JSON- und Markdown-Berichte werden nacheinander direkt überschrieben. Crash/Timeout zwischen den Writes kann eine truncierte Datei oder ein JSON/MD-Paar aus verschiedenen Generationen hinterlassen. Das Skript auto-startet beim Laden, exportiert keine prüfbaren Kerne und besitzt keinen hermetischen Vertrag für Auswahl, Filter und XBRL-Ableitungen.
- **Auswirkung:** Ein bindender GO-Messreport kann unbemerkt inkonsistent sein; kritische Stichproben- und Coverage-Logik hat kein Regressionnetz.
- **Claude-Prüfung:** Temp+Rename, gemeinsamer Run-/Source-Hash in beiden Formaten und hermetische Fixtures für Auswahl/Q4/Alignment/Coverage.

### BH-020 — HOCH · T1 — Der tägliche Form-4-Pull hat keinen Cursor; Ausfälle über fünf Handelstage erzeugen permanente Lücken

- **Fundstelle:** `scripts/pull-insider-form4-daily.js:30-38`, `:157-177`; `.github/workflows/daily-pull.yml:251-258` (`continue-on-error: true`).
- **Fehler/Mechanismus:** Jeder Lauf fragt starr die letzten fünf Handelstage ab, unabhängig vom letzten erfolgreichen Indexdatum. Nach einem längeren SEC-/CI-Ausfall liegen ältere versäumte Filings außerhalb des Fensters; der getrennte Backfill füllt den Daily-Cache nicht automatisch nach.
- **Auswirkung:** Dauerhafte, nicht markierte Lücken in Insidertransaktionen.
- **Claude-Prüfung:** Cache mit letztem Erfolg T−10; alle fehlenden Tage nachholen oder einen harten Coverage-Gap ausgeben.

### BH-021 — HOCH · T1 — Shared-CIK-/Share-Class-Filings werden unter einem willkürlichen „first wins“-Ticker gespeichert

- **Fundstelle:** `scripts/pull-insider-form4-daily.js:197-216`, `:355-420`.
- **Fehler/Mechanismus:** `cikToTicker` behält den ersten Watchlist-Ticker. Obwohl der Parser das tatsächliche `issuerTradingSymbol` aus dem Filing liefert, wird anschließend immer unter dem first-wins-Key gemergt.
- **Datenbeleg:** Im aktuellen Cache weichen 1.503 von 41.243 Transaktionen (3,64 %) zwischen `issuerTradingSymbol` und `byTicker`-Key ab, etwa AXIA-Filing-Symbole unter AXIA3-Key.
- **Auswirkung:** Insiderkäufe/-verkäufe können der falschen Share Class oder Security zugerechnet werden.
- **Claude-Prüfung:** Alle Mismatches klassifizieren; Shared-CIK-Fixture und Key-Vertrag gegen `issuerTradingSymbol`.

### BH-022 — HOCH · T1 — Multi-Owner-Filings werden vollständig dem ersten Reporting Owner zugerechnet

- **Fundstelle:** `scripts/pull-insider-form4.js:256-298`; gleicher Mechanismus `scripts/backfill-form345.js:255-299`.
- **Fehler/Mechanismus:** Parser und Backfill lesen je Accession ausschließlich den ersten `reportingOwner`; sämtliche Transaktionen erben dessen Name, Rolle und teils CIK.
- **Auswirkung:** Personen- und Rollenhistorie wird bei Joint-/Group-Filings verschmolzen; jede spätere Routine-vs-opportunistic-Auswertung erhält falsche Eigentümer.
- **Claude-Prüfung:** Zwei-Owner-Fixture mit getrennten Transaktionen; explizite Owner↔Transaktions-Zuordnung.

### BH-023 — HOCH · T1 — Ein einziges 10b5-1-Indiz markiert pauschal alle Transaktionen des Filings

- **Fundstelle:** `scripts/pull-insider-form4.js:238-254`, `:287-298`; `scripts/backfill-form345.js:238-250`, `:286-300`.
- **Fehler/Mechanismus:** Irgendein strukturiertes Flag oder irgendeine Footnote-Erwähnung setzt `isTenB5One` einmal auf Filing-Ebene; jede Transaktion erbt den Wert. Gemischte Filings können nicht dargestellt werden.
- **Auswirkung:** Diskretionäre Käufe/Verkäufe werden als geplant klassifiziert und ein künftiges Insider-Signal systematisch abgeschwächt.
- **Claude-Prüfung:** Gemischte Footnote-IDs pro Transaktion; nur referenzierende Zeile markieren.

### BH-024 — HOCH · T1 — Form 4/A wird addiert, statt das Original zu korrigieren

- **Fundstelle:** `scripts/pull-insider-form4-daily.js:225-280`, `:403-420`.
- **Fehler/Mechanismus:** Der Index akzeptiert 4/A, aber das Cachemodell kennt keine Amendment-Beziehung. Original und Änderung besitzen verschiedene Accessions, weshalb der Dedup-Key die alte Transaktion nicht ersetzt.
- **Auswirkung:** Ursprungswert und korrigierter Wert werden gemeinsam gezählt; Nullierungen oder Owner-/Preis-Korrekturen bleiben als Doppelbestand.
- **Claude-Prüfung:** Original plus 4/A mit geänderter Stückzahl; erwarteter Cache enthält nur die wirksame Amendment-Semantik.

### BH-025 — HOCH · T1 — Der Form-4-Dedup-Key verschluckt reale Multi-Lot-Transaktionen

- **Fundstelle:** `scripts/pull-insider-form4-daily.js:249-280`; `scripts/backfill-form345.js:173-176`, `:303-317`.
- **Fehler/Mechanismus:** Der Schlüssel enthält nur Accession, Datum, Code und Stückzahl; Owner, Preis, Acquired/Disposed, Security und Zeilen-ID fehlen. Zwei Lots mit gleicher Stückzahl/Datum/Code, aber anderem Preis oder Owner kollidieren.
- **Auswirkung:** Volumen, Wert und Anzahl realer Insideraktionen werden unterschätzt.
- **Claude-Prüfung:** Multi-Lot-Fixture „100 Stück zu 10 und 12“ in beiden Mergepfaden.

### BH-026 — HOCH · T1 — Parserfehler werden als frischer erfolgreicher Form-4-Teilstand gespeichert

- **Fundstelle:** `scripts/pull-insider-form4-daily.js:399-449`; manueller Pfad `scripts/pull-insider-form4.js:387-424`, `:506-519`.
- **Fehler/Mechanismus:** Daily zählt den Fetch schon vor erfolgreichem Parse; Parsefehler werden ohne Errorzähler übersprungen. Das Total-Failure-Gate sieht `grandFetched>0`. Der manuelle Pull schluckt Einzelfehler und ersetzt den Ticker-Cache durch den partiellen Rest samt frischem `fetchedAt`.
- **Auswirkung:** Leere/partielle Insiderdaten gelten als frisch; im manuellen Pfad können zuvor korrekte Transaktionen verschwinden.
- **Claude-Prüfung:** 200-OK mit unparsebarem Inhalt; parsed/expected-Vertrag und kein Overwrite bei Partialfehler.

### BH-027 — HOCH · T1 — Form-4-, Form-3/5- und 13F-Daten haben keinen aktuellen Scoring-/Board-Consumer

- **Fundstelle:** Producer `scripts/pull-insider-form4.js:10-19`, `:46-48`; `scripts/pull-13f-institutional.js:10-17`, `:43`; fehlende Routen in `package.json:7-11` und aktuellem `methods/`/`src/scoring/`.
- **Fehler/Mechanismus:** Repo-weite Producer→Consumer-Suche findet `sec-form4-cache`, `sec-form4-history` und `sec-13f-by-ticker` außerhalb Producer/Dokumentation nicht mehr. Trotzdem pflegt CI täglich einen großen Form-4-Cache; 13F/History werden weiter als Projektquellen geführt.
- **Auswirkung:** Laufzeit, Repozustand und Health-Komplexität ohne Einfluss auf Boards oder Score; vorhandene Daten suggerieren eine Signalfunktion, die aktuell nicht existiert.
- **Claude-Prüfung:** End-to-end-Trace bis Snapshot/Score/Export; andernfalls ausdrücklich als inaktive Research-Datenquelle kennzeichnen und aus Produktions-Health herausnehmen.

### BH-028 — HOCH · T1 — Der 13F-Store überschreibt das Vorquartal, obwohl sein deklarierter Zweck Quartalsänderungen ist

- **Fundstelle:** `scripts/pull-13f-institutional.js:14-17`, `:372-445`, `:837-856`.
- **Fehler/Mechanismus:** Pro Institution wird nur das neueste Filing gewählt; `byInstitution[cik]` wird beim Refresh vollständig ersetzt. Eine Report-Period-/Filing-Historie gibt es nicht.
- **Auswirkung:** „Accumulation across quarters“ ist aus dem Datenvertrag unmöglich, weil das benötigte Vorquartal beim zweiten Lauf verloren geht.
- **Claude-Prüfung:** Zwei aufeinanderfolgende Quartalsfixtures; beide `reportPeriod`s müssen danach abrufbar sein.

### BH-029 — HOCH · T1 — Ein spätes 13F-Amendment kann mit dem falschen Quartal verschmolzen werden

- **Fundstelle:** `scripts/pull-13f-institutional.js:312-324`, `:383-408`, `:448-533`.
- **Fehler/Mechanismus:** `_normalizeSubmissions()` verwirft `reportDate`; Originalbasis und Amendment werden nur nach Filing-Datum gewählt. Ein verspätetes Q2-13F/A nach dem Q3-Original kann dadurch auf das Q3-Buch gemergt werden.
- **Auswirkung:** Holdings verschiedener Quartale ergeben ein erfundenes Portfolio.
- **Claude-Prüfung:** Q2 Original 14.08., Q3 Original 14.11., Q2 Amendment 01.12.; nur identische `reportDate/periodOfReport` dürfen verbunden werden.

### BH-030 — HOCH · T1 — 13F-Amendment-Semantik wird durch eine 50-%-Heuristik ersetzt

- **Fundstelle:** `scripts/pull-13f-institutional.js:392-406`, `:490-516`.
- **Fehler/Mechanismus:** `AMENDMENT_MIN_RATIO=0.5` entscheidet, ob ein Amendment Vollbuch oder Partial ist; der SEC-Amendmenttyp der Cover Page wird nicht ausgewertet. Ein Partial mit 51 % löscht den Rest, ein Vollrestatement unter 50 % behält gelöschte Altpositionen. Die Magic Number liegt zudem außerhalb zentraler Konfiguration.
- **Auswirkung:** Systematisch falsche Holdings nahe der willkürlichen Grenze.
- **Claude-Prüfung:** Cover-Page-Semantik verwenden; 49-/51-%-Fixtures dürfen nicht allein durch die Quote kippen.

### BH-031 — MITTEL · T1 — 13F ordnet Holdings per normalisiertem Firmennamen statt eindeutiger Security zu

- **Fundstelle:** `scripts/pull-13f-institutional.js:564-739`.
- **Fehler/Mechanismus:** CUSIP wird nicht gegen eine Security-Master-Map aufgelöst. Ein stark normalisierter Issuername entscheidet; bei Kollisionen gewinnt unter anderem der kürzeste Ticker bzw. irgendeine als primary verstandene Share Class.
- **Auswirkung:** GOOG/GOOGL und andere Share-Class-/Namenskollisionen können institutionelle Positionen der falschen Aktie zuweisen.
- **Claude-Prüfung:** Collision-Report Normalname→mehrere CIK/Ticker; nur eindeutige Security-Identität publizieren.

### BH-032 — MITTEL · T1 — `--out` beim 13F-Puller schützt den Produktions-Derived-View nicht

- **Fundstelle:** `scripts/pull-13f-institutional.js:537-559`, `:743-771`, `:911-923`.
- **Fehler/Mechanismus:** Der Hauptcache folgt `args.out`; das abgeleitete Ziel bleibt starr `external-data/sec-13f-by-ticker.json`.
- **Auswirkung:** Ein als isoliert erwarteter Ein-Institution-Smoke mit temporärem Output kann den echten by-ticker-Produktionsstand überschreiben.
- **Claude-Prüfung:** Temp-`--out`-Integrationstest; Derived-Ausgabe relativ/optional zum gewählten Ziel.

### BH-033 — MITTEL · T1 — Der committete 13F-Bestand ist praktisch leer, alt und dennoch nicht als inaktiv gekennzeichnet

- **Fundstelle:** `scripts/pull-13f-institutional.js:43`, `:115-156`; `external-data/sec-13f-cache.json`; `external-data/sec-13f-by-ticker.json`.
- **Datenbeleg/Mechanismus:** Das Skript ist manual-only mit 40 Bootstrap-Institutionen. Der aktuelle Store, zuletzt am 17.05.2026 aktualisiert, enthält nur eine Institution und 26 abgeleitete Ticker; zugleich fehlt der Consumer aus BH-027.
- **Auswirkung:** Die Dateien suggerieren aktuelle institutionelle Abdeckung, liefern aber weder belastbaren Querschnitt noch Verlauf.
- **Claude-Prüfung:** Freshness-, Mindestabdeckungs- und Consumer-Promotion-Gates; sonst sichtbar `research-inactive`.

### BH-034 — MITTEL · T1 — 13F-Fehler- und Stalenessstatus geht im Derived-View verloren

- **Fundstelle:** `scripts/pull-13f-institutional.js:692-739`, `:797-835`.
- **Fehler/Mechanismus:** Bei Pullfehlern bleiben alte Positionen mit `error/failedAt` im Hauptcache. `buildByTickerView()` publiziert diese Positionen weiter, übernimmt aber weder Fehler noch `fetchedAt/failedAt` oder Staleness.
- **Auswirkung:** Ein späterer Consumer kann einen alten Fehlerbestand nicht von frischen Holdings unterscheiden.
- **Claude-Prüfung:** Errored-stale-Fixture; Provenienz mitführen oder fehlerhafte Positionen ausschließen.

### BH-035 — MITTEL · T1 — Der CI-Testwächter übersieht Tests, die nicht exakt `*.test.js` heißen

- **Fundstelle:** `.github/workflows/daily-pull.yml:90-150`; unberücksichtigte Dateien `tests/13f-test.js`, `tests/sec-form4-test.js`, `tests/sec-user-agent-test.js`; Monatsjob führt nur letzteren aus (`monthly-sec-xbrl.yml:51-56`).
- **Fehler/Mechanismus:** Wächter und Gate suchen ausschließlich `*.test.js`. Die drei realen `*-test.js`-Dateien sind deshalb für ihn unsichtbar; Form-4- und 13F-Smokes laufen in keinem CI-Gate.
- **Auswirkung:** Parserregressionen in täglich/periodisch genutzten SEC-Pfaden können grün deployen, obwohl vorhandene Offline-Smokes sie finden würden.
- **Claude-Prüfung:** `git ls-files '*test.js'` gegen tatsächliche Gate-Menge; jede hermetische Datei gatet oder begründet ausnehmen.

### BH-036 — MITTEL · T1 — Die vorhandenen SEC-Smokes testen Kopien und Altverträge statt der kritischen Produktionssemantik

- **Fundstelle:** `tests/13f-test.js:121-145`; `tests/sec-form4-test.js:40-109`, `:139-158`; `tests/scoring/merge-sec-xbrl.test.js`.
- **Fehler/Mechanismus:** Der 13F-Test kopiert eine alte Freshness-Formel lokal und testet keine Amendment-/Report-Period-Semantik. Form 4 deckt nur einen Owner ab, kein 4/A, kein gemischtes 10b5-1 und keine Dedup-Kollision; sein fixer 2026-Lookback wird später zeitabhängig. Der XBRL-Test kennt weder 10-K/A noch Filing-/Perioden-Mismatch.
- **Auswirkung:** Grüne Smokes diskriminieren die Fehler BH-006 und BH-021 bis BH-030 nicht.
- **Claude-Prüfung:** Direkt exportierte Produktionsfunktionen testen, Uhr einfrieren, je Mechanismus eine Killer-Fixture.

### BH-037 — NIEDRIG · T1 — Der SEC-User-Agent-Guard lässt mehrere echte SEC-Clients aus

- **Fundstelle:** `tests/sec-user-agent-test.js:27-33`; ausgelassen `scripts/backfill-form345.js:61-64`, `scripts/pull-insider-form4-daily.js:59-70`, `scripts/probe-smallcap-coverage.js:51-53`.
- **Fehler/Mechanismus:** Die statische Liste deckt nur XBRL, manuellen Form-4-Pull und 13F ab. Daily, Backfill und Probe kontaktieren SEC ebenfalls. Deren aktuelle Strings sind zwar brauchbar, eine künftige Regression bleibt aber unsichtbar.
- **Auswirkung:** Der Guard kann vollständig grün bleiben, während ein produktiver SEC-Pfad vom WAF blockiert wird.
- **Claude-Prüfung:** SEC-Host-Literale dynamisch entdecken oder eine vollständige zentrale Clientliste testen.

### BH-038 — KRITISCH · T1 — Der Universe-Refresh nutzt wissentlich inkompatible Yahoo-Optionen und erreicht keinen Adapter

- **Fundstelle:** `refresh-universe.js:276-305`, `:475-501`, Adapter erst ab `:559`; Workflow `.github/workflows/daily-pull.yml:190-205`.
- **Fehler/Mechanismus:** `yf.screener({query,count,offset,sortField,sortType})` widerspricht dem installierten `yahoo-finance2@3.14.0`-Schema. Der Code erkennt den deterministischen „invalid options“-Fehler sogar ausdrücklich und ruft beim ersten Exchange `process.exit(1)` auf. Alle unabhängigen Länderadapter liegen dahinter. Der Workflow schluckt den Exit per `continue-on-error` und fährt mit der alten Watchlist fort.
- **Live-Beleg:** Im jüngsten erfolgreichen Daily-Lauf `29631632950` vom 18.07.2026 steht im Prep-Log exakt dieser `invalid options`-Fehler samt Exit 1; der Prep-Job und Gesamtlauf endeten dennoch grün und Prune/Fan-out liefen weiter.
- **Auswirkung:** Die automatische Universe-Erweiterung ist faktisch eingefroren, während die Pipeline insgesamt weiterläuft.
- **Claude-Prüfung:** Contract-Test gegen exakt die installierte Bibliothek; bei Ausfall des Custom-Screeners müssen unabhängige Adapter trotzdem laufen und der Health-Status darf nicht grün sein.

### BH-039 — HOCH · T1 — Universe-Intake lässt Fonds, Bonds und andere Nicht-Aktien in den Aktienpool

- **Fundstelle:** `refresh-universe.js:114-128`, `:425-457`, `:506-531`.
- **Fehler/Mechanismus:** Eingangslisten enthalten Fonds-/Bond-Kategorien; Haupt- und Custom-Loop besitzen keinen verbindlichen `quoteType`-/Instrumenttypfilter. Eine Quote `{quoteType:'ETF', marketCap:2e9, currency:'USD'}` passiert den Intake.
- **Auswirkung:** Nicht-Common-Equity-Instrumente kontaminieren Fundamentals, Kohorten und Rankings.
- **Claude-Prüfung:** Instrumentvertrag für Common Equity/ADR/Dual Class definieren und an jeder Quelle erzwingen.

### BH-040 — HOCH · T1 — `MAX_UNIVERSE` begrenzt nicht die tatsächlich gespeicherte Watchlist

- **Fundstelle:** `refresh-universe.js:322-389`, `:815-865`, `:987-1003`.
- **Fehler/Mechanismus:** Der Cap gilt nur für die neue Candidate-Map. Danach werden diese Kandidaten zu allen bestehenden `wlRaw.stocks` hinzugefügt, ohne die Gesamtmenge erneut zu begrenzen. Bestehende N plus ein neuer Kandidat ergibt N+1 trotz `MAX_UNIVERSE=N`.
- **Auswirkung:** Universum und CI-Kosten können unbegrenzt wachsen; der als kontrolliert verstandene Denominator ist falsch.
- **Claude-Prüfung:** Finaler Persistenz-Cap mit deterministischer Priorisierung und Bestand+Neuzugang-Fixture.

### BH-041 — HOCH · T1 — Fehlende FX-Raten können massenhaft ausländische Titel löschen

- **Fundstelle:** `discovery/mcap-prefilter.js:23-38`, `:76-82`; `refresh-universe.js:83-86`, `:425-440`, `:763-785`; Workflow erlaubt fehlende FX-Datei (`daily-pull.yml:224-249`).
- **Fehler/Mechanismus:** Bei defekter/fehlender FX-Datei bleibt nur `{USD:1}`. Ein EUR-/JPY-/KRW-Titel kann als von Yahoo „answered“, aber mangels Umrechnung nicht „kept“ gelten; der Refresh löscht beantwortete Nicht-Kept-Zeilen anschließend als unter Cap.
- **Auswirkung:** Ein einzelner FX-Artefaktfehler kann ganze Länder aus der Watchlist entfernen.
- **Claude-Prüfung:** Fehlende-FX-Fixtures; „nicht bewertbar“ strikt von „unter Mindest-Cap“ trennen.

### BH-042 — HOCH · T1 — KOSDAQ-Ticker behalten bei Prefilter-Problemen das falsche `.KS`-Suffix

- **Fundstelle:** `discovery/opendart-kr.js:131-142`; einzige Korrektur `discovery/mcap-prefilter.js:83-113`; `refresh-universe.js:767-785`.
- **Fehler/Mechanismus:** OpenDART emittiert zunächst alle koreanischen Codes als `.KS`; die `.KQ`-Korrektur geschieht nur über erfolgreiches Quote-Prefiltering. Bei unbeantwortetem Request bleibt `.KS`, obwohl es eine andere oder keine Security bezeichnen kann. Der im Kommentar erwartete Downstream-Retry existiert nicht.
- **Auswirkung:** KOSDAQ-Firmen fehlen oder werden einer falschen Yahoo-Line zugeordnet.
- **Claude-Prüfung:** End-to-end-Fixture `.KS` unauffindbar/falsch → `.KQ` korrekt.

### BH-043 — HOCH · T1 — Der globale Yahoo-Limiter limitiert Ticker, nicht die tatsächlichen Requests

- **Fundstelle:** `pull-yahoo.js:1303-1323`, `:1701-1738`, `:2190-2203`, `:2883-2918`.
- **Fehler/Mechanismus:** `acquireSlot()` läuft einmal pro Ticker. Innerhalb dieses Slots folgen QuoteSummary, Quote, bis zu vier Fundamentals-Time-Series-Requests und Retries ungedrosselt; mehrere Worker erzeugen daher Request-Bursts trotz scheinbarer Rate-Grenze.
- **Auswirkung:** 429-Wellen, partielle Fundamentals und unnötige Wiederholungen.
- **Claude-Prüfung:** Zeitstempel-Mock aller Yahoo-Aufrufe; Mindestabstand global pro HTTP-Request beweisen.

### BH-044 — HOCH · T1 — Die Staleness-Sortierung liest altes `fetchedAt` statt frischem `meta.asOf`

- **Fundstelle:** `pull-yahoo.js:1095-1113`, `:1599-1646`, `:1939-1940`; unrealistische Fixture `tests/sort-cache-order.test.js:20-23`.
- **Fehler/Mechanismus:** Der Schnellparser nimmt den ersten Texttreffer von `asOf|fetchedAt`. Im realen JSON steht `fetchedAt` vor `meta.asOf`; Price-only aktualisiert nur `asOf`. Ein frischer Preisstand bleibt dadurch als alt priorisiert.
- **Auswirkung:** Dieselben Ticker werden unnötig wiederholt gezogen, Budgets und faire Refresh-Reihenfolge verzerren sich.
- **Claude-Prüfung:** Reale Snapshot-Feldreihenfolge als Fixture; `meta.asOf` strukturell statt per erster Regex lesen.

### BH-045 — HOCH · T1 — Eine inhaltsleere Price-Quote macht alte Snapshot-Daten scheinbar frisch

- **Fundstelle:** `pull-yahoo.js:1936-1940`, `:1986-2023`, `:2035-2071`.
- **Fehler/Mechanismus:** Jede truthy Quote aktualisiert `meta.asOf`, während Preis und Market Cap nur optional gesetzt werden. Eine Antwort wie `{currency:'USD'}` lässt alle alten Werte stehen, zählt aber als erfolgreicher Price-only-Pull.
- **Auswirkung:** Stale Preis-/Cap-Daten passieren Freshness-Gates als frisch.
- **Claude-Prüfung:** Sparse-Quote-Fixture; Frische nur nach validem Preis plus zugehörigem Zeitfeld setzen.

### BH-046 — HOCH · T1 — Ein Market-Cap-Feldort-Drift löscht einen sonst gültigen Snapshot

- **Fundstelle:** `pull-yahoo.js:1161-1163`, `:2690-2721`; Yahoo-Schema kennt `price.marketCap` und `summaryDetail.marketCap`.
- **Fehler/Mechanismus:** Der Mapper liest nur `summaryDetail.marketCap`. Ist Market Cap ausschließlich im `price`-Modul vorhanden, gilt es als fehlend und der vorhandene Snapshot wird gelöscht.
- **Auswirkung:** Länderspezifische/Sparse-Schemaformen können valide Fundamentals vernichten.
- **Claude-Prüfung:** Fixture mit Cap nur in `price`; beide Pfade samt Konsistenzregel testen.

### BH-047 — HOCH · T1 — Ein einzelner breit klassifizierter Not-found-Fehler führt zur Watchlist-Löschung

- **Fundstelle:** `pull-yahoo.js:2815-2850`; `scripts/prune-watchlist.js:94-99`, `:210-214`; Prune läuft täglich (`daily-pull.yml:202-205`).
- **Fehler/Mechanismus:** Eine breite Textregex markiert nach einem Fehler sofort `meta.delisted`; der nächste Prune entfernt jeden so markierten Titel. Quorum, Wiederholung oder zeitlicher Abstand fehlen.
- **Auswirkung:** Ein transienter oder falsch klassifizierter 404/„no data found“ löscht weiterhin handelbare Titel dauerhaft.
- **Claude-Prüfung:** Zwei-Schritt-/Quorum-Fixtures mit getrennten Fehlerklassen und Zeitabstand.

### BH-048 — MITTEL · T1 — `PULL_CONCURRENCY=0` verarbeitet nichts und endet trotzdem grün

- **Fundstelle:** `pull-yahoo.js:1684-1688`, `:2915-2919`, `:3036-3052`.
- **Fehler/Mechanismus:** Null Worker liefern leere Results; Manifest- und Fail-Ratio-Logik interpretieren das nicht als Ausfall.
- **Auswirkung:** Fehlkonfiguration kann einen vollständigen No-op-Pull mit Exit 0 erzeugen.
- **Claude-Prüfung:** Sämtliche numerischen Env-Parameter vor I/O als positive Ganzzahlen validieren.

### BH-049 — KRITISCH · T1 — Historische Reihen mischen Adjusted Close und Raw Close barweise

- **Fundstelle:** `pull-historical-prices.js:164-171`, `:219-225`, `:281-310`; `scripts/backfill-prices.js:158-165`.
- **Fehler/Mechanismus:** Pro Bar wird `adjclose ?? close` gewählt. Fehlt `adjclose` nur auf einer Event-/Phantomzeile, landet Raw Close mitten in einer split-/dividendenadjustierten Reihe.
- **Datenbeleg:** KLAC springt 08.05. von 186,68 auf 1.869,19 am 09.05. und am 11.05. zurück auf 184,28. Storeweit wurden 17.755 ≤7-Tage-Sprünge >80 %, 5.529 >200 % und 1.922 >900 % gefunden.
- **Auswirkung:** Return-, Drawdown-, Triple-Barrier- und rankIC-Messungen buchen Basiswechsel als Marktrendite. BH-001 sorgt zusätzlich dafür, dass diese Zeilen nie verschwinden.
- **Claude-Prüfung:** Eine einheitliche Basis pro Serie erzwingen; Bars ohne passende Adjusted-Basis ablehnen/normalisieren.

### BH-050 — KRITISCH · T1 — Event-/Wochenendzeilen werden ohne Session-Vertrag als Handelspreise übernommen

- **Fundstelle:** `pull-historical-prices.js:172-225`.
- **Fehler/Mechanismus:** Die jüngste Datumskorrektur betrifft nur die letzte Quote. Der Serienmerge übernimmt jede Yahoo-Zeile, auch Event-only-Wochenendbars, ohne OHLC-/Venue-Session-Prüfung.
- **Datenbeleg:** 28.025 Wochenendbars bei 17.176 Tickern; davon 20.088 Bars bei 15.441 unsuffigierten US-Symbolen. KLACs Faktor-10-Bar liegt auf einem Samstag.
- **Auswirkung:** Nicht-Handelstage werden zu zulässigen Entry-/Exit-Daten. Zusammen mit BH-001 konserviert das System die Kontamination.
- **Claude-Prüfung:** Nur echte Session-Bars übernehmen; börsenkalenderbewusst statt pauschalem Wochenendfilter testen.

### BH-051 — HOCH · T1 — 19.774 ungültige Alt-Closes passieren jeden weiteren Merge

- **Fundstelle:** `pull-historical-prices.js:218-227`; `scripts/backfill-prices.js:163-165`, `:174-184`.
- **Fehler/Mechanismus:** Altbestand wird ungeprüft in die Map kopiert; nur neue Werte werden im Hauptwriter auf `>0` geprüft. Der Backfill akzeptiert neue `<=0` sogar weiterhin. Nicht erneut gelieferte Altzeilen überleben wegen BH-001.
- **Datenbeleg:** Vollscan des aktuellen Stores: 5.204.742 Preiszeilen, davon 19.774 nichtpositiv/nichtfinit; Beispiel `AHICF` über viele Tage mit −8,0599985.
- **Auswirkung:** Divisionen, Renditen und Barrieren werden vergiftet oder müssen Namen still ausschließen.
- **Claude-Prüfung:** Alt- und Neubestand identisch validieren; gezogenen Zeitraum autoritativ rekonstruieren.

### BH-052 — HOCH · T1 — Historische Preis-Batches haben weder Timeout noch request-zentrales Pacing

- **Fundstelle:** `pull-historical-prices.js:155-163`, `:236-255`; `scripts/backfill-prices.js:146-166`, `:201-208`.
- **Fehler/Mechanismus:** `Promise.all` wartet unbegrenzt auf jeden Chart-Request; zehn Calls starten gleichzeitig und Pace folgt erst nach dem ganzen Batch. Retry/Abort und `allSettled` fehlen.
- **Auswirkung:** Ein Hänger blockiert Checkpoints und den ganzen Lauf; Burst-Starts begünstigen 429.
- **Claude-Prüfung:** Nie auflösender Request-Mock plus Zeitstempel-Fixture.

### BH-053 — HOCH · T1 — Ein einziger erfolgreicher Preis-Ticker lässt einen nahezu vollständigen Ausfall grün enden

- **Fundstelle:** `pull-historical-prices.js:135-136`, `:229-233`, `:327-338`; `scripts/backfill-prices.js:24-25`, `:218`.
- **Fehler/Mechanismus:** Der Lauf scheitert nur, wenn exakt null Symbole erfolgreich waren. 1 Erfolg bei Tausenden Fehlern schreibt ein winziges Tagesartefakt und Exit 0.
- **Auswirkung:** Preis-Coverage kann kollabieren, ohne das nachfolgende Messsystem hart zu stoppen.
- **Claude-Prüfung:** Mindestabdeckung gegen adressierbaren Denominator und Vorlaufwert.

### BH-054 — HOCH · T1 — `PRICE_CONCURRENCY=0` erzeugt eine Endlosschleife

- **Fundstelle:** `pull-historical-prices.js:150-154`, `:236`.
- **Fehler/Mechanismus:** Der Batchloop erhöht mit `batchStart += CONCURRENCY`; bei null schreitet er nie fort.
- **Auswirkung:** Workflow hängt bis zum Timeout und hinterlässt je nach Zwischenwrites einen Partialstand.
- **Claude-Prüfung:** Positive-Integer-Guard vor dem Loop.

### BH-055 — KRITISCH · T1 — Earnings-Rollover entfernt genau den gerade berichteten Termin vor dem Fundamentals-Trigger

- **Fundstelle:** `pull-earnings-dates.js:25-49`, kompletter Neuaufbau `:69-85`; Kalender läuft vor dem Pull `.github/workflows/daily-pull.yml:260-312`; Trigger `pull-yahoo.js:3066-3091`.
- **Fehler/Mechanismus:** Der Kalender speichert nur Yahoos jeweils nächstes Earnings-Datum. Rollt Yahoo nach Veröffentlichung sofort auf das Folgequartal, verschwindet der gerade vergangene Termin, bevor `needsFullPull()` ihn mit `fundamentalsAsOf` vergleichen kann. Der Ticker erhält nur Price-only.
- **Auswirkung:** Gerade veröffentlichte Zahlen können bis zum periodischen 30-Tage-Sweep fehlen — exakt dann, wenn Aktualität am wichtigsten ist.
- **Claude-Prüfung:** End-to-end-Fixture gestern Termin D, heute Yahoo D+90; vergangenen Termin mit Grace Window bzw. `lastReported` getrennt erhalten.

### BH-056 — HOCH · T1 — Bis zu 49 % fehlgeschlagene Earnings-Abfragen werden aus dem Kalender gelöscht

- **Fundstelle:** `pull-earnings-dates.js:29-50`, `:69-85`.
- **Fehler/Mechanismus:** Einzelfehler werden still übersprungen und der Kalender wird vollständig neu gebaut. Der Collapse-Guard blockt erst unter 50 % des Vorbestands. Bei 100 alten Einträgen dürfen 49 Abrufe fehlen und die verbleibenden 51 überschreiben die Datei.
- **Auswirkung:** Fehlende Titel verlieren ihren Earnings-getriebenen Full-Pull-Trigger trotz vorhandenen Alttermins.
- **Claude-Prüfung:** Carry-forward je fehlgeschlagenem Ticker und adressierbarer Failure-Denominator.

### BH-057 — HOCH · T1 — Der Earnings-Pull bursted und kann an einem einzelnen Request hängen bleiben

- **Fundstelle:** `pull-earnings-dates.js:28-32`, `:52-67`.
- **Fehler/Mechanismus:** Alle Calls eines Batches starten gleichzeitig; die 300 ms gelten nur zwischen Batches. Timeout, Abort, Retry und `allSettled` fehlen; ein nie auflösender QuoteSummary-Call blockiert die gesamte Gruppe.
- **Auswirkung:** 429-Teilstände oder Job-Timeout mit altem Kalender.
- **Claude-Prüfung:** Request-Limiter und Hänger-Fixture.

### BH-058 — HOCH · T1 — OTC-Discovery ist hart auf 5.000 Zeilen gedeckelt und akzeptiert Seitenlöcher

- **Fundstelle:** `discovery/otc-markets.js:18-24`, `:159-245`.
- **Fehler/Mechanismus:** `MAX_PAGES=10` bei 500 Zeilen. Erkannte Trunkierung warnt nur; fehlgeschlagene Seiten werden übersprungen, spätere trotzdem verarbeitet. Ein nonempty Partial gilt im Aggregator als Erfolg.
- **Auswirkung:** OTC-Titel verschwinden systematisch oder durch einzelne Seitenfehler ohne harten Coverage-Status.
- **Claude-Prüfung:** `totalRecords` gegen empfangene Zeilen; Partial/Truncation quarantänisieren.

### BH-059 — HOCH · T1 — SZSE-Discovery akzeptiert unvollständige Pagination als Erfolg

- **Fundstelle:** `discovery/szse-cn.js:90-140`.
- **Fehler/Mechanismus:** Fehler späterer Seiten werden nur protokolliert und übersprungen; die erfolgreiche erste Seite macht den Gesamtadapter grün.
- **Auswirkung:** Teiluniversum ohne markierten Denominatorbruch.
- **Claude-Prüfung:** Erwartete Seiten/Gesamtmenge im Rückgabevertrag und harte Partial-Kennzeichnung.

### BH-060 — HOCH · T1 — TradingView verschluckt Länderausfälle und mögliche Range-Trunkierung

- **Fundstelle:** `discovery/tv-scanner.js:26-29`, `:82-109`, `:121-158`; Aggregation `refresh-universe.js:597-744`.
- **Fehler/Mechanismus:** Alle Länder starten gleichzeitig; jeder Fehler wird zu einer leeren Map. Ein einziges erfolgreiches Land macht die Quelle nonempty. `range:[0,2500]` wird nicht gegen `totalCount` geprüft.
- **Auswirkung:** Ganze Länder oder alle Titel hinter 2.500 verschwinden still.
- **Claude-Prüfung:** Per-Land-Health, begrenzte Parallelität und `rows===min(totalCount,range)`-Vertrag.

### BH-061 — HOCH · T1 — TSX überspringt strukturell kaputte Workbook-Sheets still

- **Fundstelle:** `discovery/tsx-ca.js:208-216`, `:247-272`.
- **Fehler/Mechanismus:** Fehlendes Sheet/Header liefert für diesen Teil null Titel; andere gültige Sheets lassen den Adapter erfolgreich erscheinen.
- **Auswirkung:** Börsensegmente können nach Workbook-Drift unbemerkt fehlen.
- **Claude-Prüfung:** Erwartete Sheet-Menge und Header je Sheet als Vertragsstatus.

### BH-062 — MITTEL · T2 — SSE verlässt sich auf undokumentiertes Ignorieren der eigenen Pagination

- **Fundstelle:** `discovery/sse-cn.js:30-34`; schwacher Live-Test `tests/discovery/sse-cn.test.js:24-46`.
- **Verdacht/Mechanismus:** Request setzt `pageSize=2000`, `pageNo=1`, `endPage=1`, obwohl etwa 2.508 Titel erwartet werden; der Kommentar behauptet lediglich, der Server ignoriere das. Sobald der Endpoint die Deklaration beachtet, fehlen rund 500 Titel ohne Alarm.
- **Claude-Prüfung:** Live-Contract `total vs rows` und echte Pagination.

### BH-063 — HOCH · T1 — TSX Preferred Securities und CPCs gelangen bewusst in den Common-Equity-Pool

- **Fundstelle:** `discovery/tsx-ca.js:20-23`, `:208-244`; `tests/discovery/tsx-ca.test.js:35-39`.
- **Fehler/Mechanismus:** Security-Type-Filter fehlt; der Test akzeptiert Bindestrich-Symbole ausdrücklich auch mit Preferred-Bezug. Yahoo kann sie dennoch als `EQUITY` klassifizieren.
- **Auswirkung:** Preferred/CPC-Instrumente kontaminieren Fundamental- und Rankingkohorten.
- **Claude-Prüfung:** TSX-Instrumenttyp-Erlaubnisliste; Dual Class separat behandeln.

### BH-064 — MITTEL · T2 — US-Namensfilter kann reale Emittenten und ADS vor dem strukturellen Dedup verwerfen

- **Fundstelle:** `discovery/nasdaq-all.js:30-43`; `discovery/nasdaq-api.js:36-48`; ADR/Home-Dedup erst `refresh-universe.js:690-704`.
- **Verdacht/Mechanismus:** Jeder Name mit `preferred` oder `depositary shares` wird per Substring vor Instrumenttyp-/Home-Listing-Abgleich ausgeschlossen. Reale Common-/ADS-Emittenten können dadurch nie den vorhandenen strukturellen Dedup erreichen.
- **Claude-Prüfung:** Aktuelle Gegenbeispiele ermitteln; Typfelder statt Namenssubstring.

### BH-065 — MITTEL · T1 — `MIN_USD_PRECUT` ist eine wirkungslose Konfiguration

- **Fundstelle:** `discovery/tv-scanner.js:26`, `:119`.
- **Fehler/Mechanismus:** Der Env-Wert wird gelesen, der Serverfilter bleibt fest auf 1,5 Mrd. USD.
- **Auswirkung:** Operator glaubt den Precut zu ändern, Request und Universum bleiben unverändert.
- **Claude-Prüfung:** Payload-Fixture mit zwei Env-Werten.

### BH-066 — MITTEL · T1 — Field-Coverage alarmiert nicht, wenn ein sparsames Feld vollständig verschwindet

- **Fundstelle:** `field-coverage.js:150-181`, `:194-210`.
- **Fehler/Mechanismus:** Für Baselines unter 50 % wird der Floor unterdrückt; der Standardalarm verlangt mindestens 20 Prozentpunkte absoluten Rückgang. Baseline 10 %, aktuell 0 % bleibt damit grün.
- **Auswirkung:** Seltene, aber methodisch wichtige Felder können komplett verschwinden, ohne Schema-/Coverage-Alarm.
- **Claude-Prüfung:** Relativen Rückgang plus eigenen Zero-Disappearance-Vertrag ergänzen.

### BH-067 — MITTEL · T1 — Watchlist-CSV ist nicht round-trip-sicher

- **Fundstelle:** `watchlist-cli.js:84-117`.
- **Fehler/Mechanismus:** Import verwendet `split(',')`, Export rohes `join(',')`; Quoting/Escaping fehlt. `Acme, Inc.` verschiebt alle Folgespalten.
- **Auswirkung:** Yahoo-Symbol, ISIN, Track oder Name können nach Export/Import vertauscht werden.
- **Claude-Prüfung:** Komma-, Quote- und Newline-Fixtures mit RFC-konformem Parser/Writer.

### BH-068 — MITTEL · T1 — CSV-importierte Watchlist-Zeilen ohne `added_at` entgehen dem Alters-Prune

- **Fundstelle:** `watchlist-cli.js:96-102`; `scripts/prune-watchlist.js:186-197`.
- **Fehler/Mechanismus:** CSV-Import setzt kein `added_at`; No-Snapshot-Alterung greift nur bei vorhandenem Datum.
- **Datenbeleg:** Aktuell fehlt `added_at` bei 3.341 von 11.106 Watchlist-Zeilen; nicht jede davon muss aus CSV stammen, der Importpfad erzeugt die Lücke aber deterministisch.
- **Auswirkung:** Tote nie erfolgreich gezogene Zeilen können dauerhaft im Denominator bleiben.
- **Claude-Prüfung:** Importdatum setzen und Legacy-Fallback für fehlende Werte.

### BH-069 — NIEDRIG · T1 — Der beworbene Watchlist-Befehl `position` existiert nicht

- **Fundstelle:** Usage `watchlist-cli.js:8-10`; Switch `:134-166`.
- **Fehler/Mechanismus:** Hilfe nennt den Befehl, der Dispatcher besitzt keinen Case.
- **Auswirkung:** Dokumentierter Aufruf endet als unbekannter Befehl.
- **Claude-Prüfung:** Implementieren oder Usage bereinigen.

### BH-070 — MITTEL · T1 — Aktienfinder-Import akzeptiert Infinity und Werte außerhalb der Skala

- **Fundstelle:** `aktienfinder-import.js:23-30`.
- **Fehler/Mechanismus:** Nur `isNaN` wird geprüft; `Infinity`, −1 oder 99 passieren und werden persistiert.
- **Auswirkung:** Externe Score-Daten können Rang-/Anzeigeverträge verletzen.
- **Claude-Prüfung:** `Number.isFinite` plus dokumentierter 0–10-Wertebereich.

### BH-071 — MITTEL · T1 — Die Yahoo-Schema-Canary maskiert einen Total-Ausfall doppelt

- **Fundstelle:** `tests/yahoo-schema-canary.js:31-37`, `:314-335`; Workflow `.github/workflows/daily-pull.yml:274-296`.
- **Fehler/Mechanismus:** Wenn beide Testticker komplett fehlschlagen, gibt die Canary nur Warnung und Exit 0; der Workflow ist zusätzlich `continue-on-error` und erzwingt am Ende nochmals Exit 0.
- **Auswirkung:** Weder Schema-Drift noch kompletter Yahoo-Transportausfall erzeugt aus diesem Gate einen bindenden roten Status.
- **Claude-Prüfung:** Drift und Outage getrennt klassifizieren; Outage mindestens in Health-Artefakt fail-loud.

### BH-072 — HINWEIS · T3 — Kritische Intake-/Preis-/Earnings-Pfade besitzen kein direktes Offline-Vertragsnetz

- **Fundstelle:** fehlende direkte Tests für Earnings-Pull, Watchlist-CSV, sparse Price-only, Adjusted/Raw-Mischung, Eventbars, Legacy-Preismerge und Field-Coverage; ohne eigenen Adaptertest: `finnhub`, `mcap-prefilter`, `nasdaq-all`, `nasdaq-api`, `otc-markets`, `sec-tickers`, `tv-scanner`, `wikipedia-indices`. `package.json:7-10` hat keinen gemeinsamen Test-Runner.
- **Mechanismus:** Mehrere Discovery-Tests sind Live-Netz-Smokes; `tests/discovery/hkex-hk.test.js:18-25` behandelt leeres Ergebnis sogar als Skip/Exit 0. Die wichtigsten Silent-Partial- und Datums-/Basis-Verträge sind damit nicht hermetisch reproduzierbar.
- **Auswirkung:** Die konkreten Fehler BH-038 bis BH-071 können trotz „Tests grün“ wiederkehren.
- **Claude-Prüfung:** Zuerst kleine Killer-Fixtures für Refresh-Abbruch, FX-Unknown, sparse Quote, Preisbasis/Eventbar, Earnings-Rollover und Partial-Adapter.

### BH-073 — HOCH · T1 — Produktions-Vintages laufen ohne das verlangte eingefrorene Referenzlineal

- **Fundstelle:** `src/scoring/run-screener.js:154-162`; `.github/workflows/daily-pull.yml:778-801`, `:882-899`; Masterplan `:284-289`; `screener-formel-ledger.md:438-442`.
- **Fehler/Mechanismus:** Der tägliche 2.3-Job schreibt und committet Board-History, ruft den Screener aber ohne `SCORING_REF_CALIB` auf. Damit lernt der Default bei jedem Lauf live aus dem aktuellen Universum. Selbst eine gesetzte, aber unlesbare Referenz fällt still auf live zurück.
- **Auswirkung:** Die Messreihe vermischt echte Formel-/Qualitätsänderungen mit Universe- und Normierungsdrift, obwohl das feste Lineal als Vergleichbarkeitsvoraussetzung dokumentiert ist.
- **Claude-Prüfung:** Board-History gegen konstanten Referenzhash prüfen; fehlende/defekte Referenz muss den Vintage ungültig machen statt live zurückzufallen.

### BH-074 — HOCH · T1 — Der Kalibrierungs-Driftwächter ist zugleich false-green und wirkungslos fail-soft

- **Fundstelle:** `src/scoring/score.js:994-1030`; `src/scoring/run-screener.js:163-167`; Workflow `daily-pull.yml:799-837`; Masterplan `:285-287`.
- **Fehler/Mechanismus:** Fehlende Kohorten und leere Verteilungen werden per `continue` übersprungen; `maxKs` bleibt 0 und `ok:true`. Bei echter Schwellenüberschreitung folgt nur `console.warn`; `calibDrift` wird nicht persistiert, Deploy und Vintage laufen weiter. Der Default 0,15 ist nicht aus den geforderten drei Läufen kalibriert.
- **Reproduktion:** Fehlende Kohorte und leere Live-Achse ergeben beide `{maxKs:0, drifted:[], ok:true}`.
- **Auswirkung:** Sogar vollständiger Kohortenkollaps kann als „Drift ok“ in einen ungeflaggt publizierten Vintage gelangen.
- **Claude-Prüfung:** Missing-Cohort-, Empty-Axis- und KS-Threshold-Fixtures mit bindendem Status/Flag/Exit.

### BH-075 — HOCH · T2 — Ein partielles Referenzartefakt wird akzeptiert und kann den Zyklusdämpfer verdoppeln

- **Fundstelle:** `src/scoring/score.js:474-485`, `:573-580`, `:633-648`, `:688`; Schwellenverbrauch `:365-370`.
- **Verdacht/Mechanismus:** Validiert werden nur Achsenarrays in `cohortBases`. `winsorBounds`, `growthBounds`, `cycleDDThreshold`, `n` und `median` werden ungeprüft verwendet. Fehlt `cycleDDThreshold`, greift der `null`-Guard nicht; Vergleich gegen `undefined` ist false und jedes passende Oszillationssignal dämpft.
- **Reproduktion:** Bei 4.681 scorebaren Snapshots stieg die Zahl gedämpfter Namen allein durch Löschen von `cycleDDThreshold` von 58 auf 121, ohne Fehler.
- **Auswirkung:** Syntaktisch gültige Teil-/Korruptreferenz erzeugt stille Fehlbewertung.
- **Claude-Prüfung:** Missing-/Typ-/Finitheits-Tamper für jedes konsumierte Feld, fail-loud vor dem ersten Score.

### BH-076 — HOCH · T2 — Der QC-Kalibrierungsharness verwendet Hypergrowth-Routing statt QC-Produktion

- **Fundstelle:** `src/scoring/calibrate.js:14`, `:21-27`, `:196-203`; produktiver QC-Pfad `src/scoring/run-screener.js:235-250`.
- **Verdacht/Mechanismus:** `buildCalibMatrix()` ruft fest `route()` auf; `productionCohortRanking()` nutzt `scoreUniverse()` ohne `classify: qualityRoute` und ohne `growthBoost:false`. QC-Formel-IDs passen deshalb nicht zu den erzeugten HG-Routen.
- **Reproduktion:** Auf 500 realen Snapshots routete QC produktiv 372 Namen, beide Kalibrier-/Ranking-Helfer lieferten für QC jedoch null Keys/Zeilen.
- **Auswirkung:** QC-Gewichte können über den vorgesehenen öffentlichen Harness weder kalibriert noch produktionsgetreu verifiziert werden.
- **Claude-Prüfung:** QC-Matrix/Ranking gegen `runQualityPass` auf identischem Fixture pinnen.

### BH-077 — MITTEL · T2 — Jede unbekannte Board-ID wird automatisch als `core` freigegeben

- **Fundstelle:** `src/scoring/board-status.js:21-32`.
- **Verdacht/Mechanismus:** Alles, was nicht explizit im `DIAGNOSTIC`-Set steht und nicht `quality-*` heißt, fällt auf `core`.
- **Auswirkung:** Tippfehler, neue Formel oder vergessener Registry-Eintrag kann ein nie geprüftes Board als freigegeben publizieren.
- **Claude-Prüfung:** Registry-Vollständigkeit gegen alle Formel-/Export-IDs; unknown muss fail-closed sein.

### BH-078 — MITTEL · T2 — Der Export-Validator prüft Board-Status-Maps weder auf Vollständigkeit noch auf die QC-Invariante

- **Fundstelle:** `scripts/write-findash-export.js:469-475`, `:529-540`, `:663-683`; Vertrag `docs/findash-export-v1.md:155`, `:244-249`.
- **Verdacht/Mechanismus:** Nur vorhandene Map-Einträge werden validiert; fehlende und überzählige Keys bleiben unbemerkt. Bei QC ist `core` sogar enum-legal und wird im Selftest als Pass erwartet, obwohl QC laut Vertrag immer diagnostic ist.
- **Reproduktion:** HG-Index mit nur einem Status-Key und QC-Index mit einem von zwei Keys lieferten jeweils null Validatorfehler.
- **Auswirkung:** Dashboard-Joins verlieren Badges; QC kann als core erscheinen und trotzdem den Contract-Gate passieren.
- **Claude-Prüfung:** Exakte Key-Gleichheit zu Branches/Boards und QC-Wert ausschließlich `diagnostic`.

### BH-079 — MITTEL · T2 — Jahreslücken werden zu falschem Einjahreswachstum zusammengezogen

- **Fundstelle:** `src/scoring/snapshot.js:124-136`; `src/scoring/axes.js:55-63`, `:113-128`.
- **Verdacht/Mechanismus:** `firstTwoPresent()` entfernt Periodenlücken. GP-Growth und Annual-Revenue-Pfad behandeln danach die ersten zwei vorhandenen Werte als benachbarte Jahre. `[100,null,80]` wird zu 25 % „YoY“, obwohl zwei Kalenderjahre überbrückt werden; führende Null macht einen Altwert zum aktuellen.
- **Datenbeleg:** 61 `annualGP`-Serien mit interner Lücke, 22 mit führender Lücke; zwölf davon regulär geroutet.
- **Auswirkung:** Mehrjahreswachstum wird als Einjahreswert perzentiliert und Score/Kohortenbasis verzerrt.
- **Claude-Prüfung:** Gap-Positionen und echte Periodenachse pinnen.

### BH-080 — MITTEL · T2 — Quartalsachsen komprimieren Lücken zu Phantom-QoQ und veralteter „aktueller“ Marge

- **Fundstelle:** `src/scoring/axes.js:91-109`, `:148-171`.
- **Verdacht/Mechanismus:** `quarterQoQRates()` filtert Nulls vor der Quotientenbildung; `quarterOpMargins()` kompaktiert nur valide Paare. Ein Zwei-Quartals-Abstand gilt als QoQ und eine alte Marge als jüngste.
- **Reproduktion:** Revenue `[120,null,100,90]` liefert eine Phantom-Acceleration; OpInc `[null,20,10]` bei konstantem Umsatz liefert 0,1 Margin-Trajectory. Realscan: 45 führende und 1.258 interne `opIncQ`-Lücken.
- **Auswirkung:** Acceleration, Margin-Trajectory und Winsor-Basis werden zeitlich falsch.
- **Claude-Prüfung:** Nicht benachbarte Quartale dürfen nicht als Nachbarn erscheinen.

### BH-081 — HOCH · T2 — „Aktuell profitabel“ kann tatsächlich ein altes Geschäftsjahr sein

- **Fundstelle:** `src/scoring/profit-tier.js:45-60`; `src/scoring/quality-route.js:21-31`; `src/scoring/engine.js:138-144`; `src/scoring/score.js:383-400`.
- **Verdacht/Mechanismus:** `presentValues`/`firstPresent` überspringen führende Nullwerte; anschließend behauptet `profit-tier`, Index 0 sei das jüngste Jahr. Derselbe Altwert steuert HG-Track und QC-Mitgliedschaft.
- **Reproduktion:** `annualOpInc=[null,+10,-5]` wird `seit-kurzem-profitabel`/profitable. Reales Beispiel `CI` mit führender Null und altem positivem OpInc landet in `quality-health-care`.
- **Auswirkung:** Firma ohne aktuellen Ergebnisbeleg kann als Profitabler/Compounder geroutet werden; Kohorten, Gewichte und Quality-Board ändern sich.
- **Claude-Prüfung:** Leading-null plus widersprechendes aktuelles Net Income als Routing-/QC-Fixture.

### BH-082 — MITTEL · T2 — Der Yahoo-Zykluspfad umgeht den eigenen Zeitfenster-Alignment-Guard

- **Fundstelle:** `src/scoring/score.js:342-370`.
- **Verdacht/Mechanismus:** Für SEC verlangt der Code OpInc und Revenue an Index 0. Der Yahoo-Fallback besteht dagegen bereits aus separat komprimierten `presentValues`-Serien und prüft keine gemeinsame Startperiode.
- **Auswirkung:** Sign-Flips und Revenue-Drawdown können aus unterschiedlichen Geschäftsjahresfenstern zu einem erfundenen Zyklussignal kombiniert werden.
- **Claude-Prüfung:** Yahoo-Paar mit einseitig führender Lücke darf kein Mischsignal erzeugen.

### BH-083 — MITTEL · T3 — `coverageAxes` und `coverageWeight` widersprechen dem Exportvertrag

- **Fundstelle:** `src/scoring/score.js:663-673`; `src/scoring/engine.js:73-90`; `src/scoring/formulas/quality/index.js:27-44`; `docs/findash-export-v1.md:94-95`; Ledger `:866`.
- **Widerspruch:** Vertrag: `n/n ⇔ 1.0` und „1.0 = alle Achsen present“. QC zählt die benannt-leere, Gewicht-0-Achse `roicStability` im Achsen-Nenner, ignoriert sie aber korrekt im Gewichtsnenner. In 500 Snapshots hatten 114 von 372 QC-Zeilen `coverageAxes:'5/6'` bei `coverageWeight:1`.
- **Auswirkung:** UI/Consumer können volle Score-Coverage fälschlich als unvollständig darstellen.
- **Claude-Prüfung:** Feldsemantik festlegen und Vertrag, Ledger, Export und Consumer synchronisieren.

### BH-084 — NIEDRIG · T3 — Die QC-Promotionsregel widerspricht sich zwischen „nie core“ und bindendem Core-Gate

- **Fundstelle:** `src/scoring/board-status.js:29-31`; `docs/findash-export-v1.md:244-249`; Masterplan `:330-331`; Formel-Ledger `:874`.
- **Widerspruch:** Code/Doku sagen, QC könne nie zu core promoten; unmittelbar daneben bzw. in Masterplan/Ledger existiert ein Core-Promotion-Gate.
- **Auswirkung:** Unklarer operativer Standing-Vertrag; Reviews können unterschiedliche Zielzustände anwenden.
- **Claude-Prüfung:** Eine kanonische Regel bestimmen und alle Fundstellen angleichen.

### BH-085 — NIEDRIG · T3 — `tech-hardware`-Statuskommentar beschreibt einen längst erledigten Vorzustand

- **Fundstelle:** `src/scoring/board-status.js:23-25`; aktuelle Formel `src/scoring/formulas/tech-hardware.js:8-31`; Masterplan `:305`, `:311-312`.
- **Widerspruch:** Kommentar begründet diagnostic mit noch fehlendem `marginLevel`; Formel und Masterplan belegen 2.12b als erledigt. Diagnostic kann weiterhin korrekt sein, aber aus einem anderen Grund (fehlender Walk-forward-Beleg).
- **Auswirkung:** Falsche Begründung bei Audit/Promotion.
- **Claude-Prüfung:** Kommentargrund gegen aktuellen Status aktualisieren.

### BH-086 — NIEDRIG · T3 — Exportdokumentation nennt weiterhin 12 statt 13 Hypergrowth-Boards

- **Fundstelle:** `docs/findash-export-v1.md:154-155`; aktuelle Liste `scripts/write-findash-export.js:53-57`; Masterplan `:305`, `:311`.
- **Widerspruch:** Vertrag beschreibt Arraylänge und Status-Map für zwölf Boards; Code führt seit `tech-hardware` dreizehn. Dadurch sind auch die dokumentierten 15 Exportdateien und das Workflow-Minimum `daily-pull.yml:812-816` veraltet: tatsächlich entstehen 16 Dateien.
- **Auswirkung:** Consumer nach Doku können korrekte Exporte ablehnen oder einen Status-Key auslassen.
- **Claude-Prüfung:** Schema-/Beispielzahlen maschinell aus `BRANCHES` ableiten.

### BH-087 — HOCH · T1 — Der Findash-„read-only“-Consumer verändert den Screener-Checkout stündlich

- **Fundstelle:** Geschwister-Repo `findash/data-layer/screener-sync.js:1-11`, `:67-99`, `:133-137`; Aufruf `findash/server.js:698-709`; harte Findash-Regel in `findash/AGENTS.md`/`CLAUDE.md`: `screener-data` nur lesen, nie schreiben.
- **Fehler/Mechanismus:** Der Consumer führt im Screener-Repo `git pull --ff-only` aus, schreibt die gh-pages-Dateien in dessen git-ignoriertes `outputs/` und legt dort `sync-status.json` ab. „Nur lesen“ wird im Kommentar zu „lesen/synchronisieren“ umdefiniert, tatsächlich mutiert Findash Repository und Working Tree.
- **Auswirkung:** Ein Dashboard-Prozess verändert stündlich den Arbeitsstand eines anderen Projekts, kann ungetrackte Arbeit kollidieren lassen und trennt Consumer-Cache nicht von Source-Repo.
- **Claude-Prüfung:** Screener-Export in einen Findash-eigenen Cache spiegeln; Source-Checkout vor/nach Serverlauf byte-/git-status-identisch erwarten.

### BH-088 — HOCH · T1 — Findash synchronisiert den Export dateiweise und akzeptiert gemischte Generationen

- **Fundstelle:** `findash/data-layer/screener-sync.js:29-45`, `:89-114`; Reader `findash/data-layer/screener.js:218-296`.
- **Fehler/Mechanismus:** Index, Overview, Survival und QC werden nacheinander jeweils sofort atomar ersetzt. Scheitert eine spätere Datei, bleibt dort die alte Generation. Der Reader validiert jede Datei isoliert, vergleicht aber weder `generated_at` noch Run-ID/Hash über Dateien.
- **Auswirkung:** Frische Counts/Coverage/Board-Status können mit alten Reihen kombiniert werden; ein Teil-Download erscheint als gültiges Board. Der `--check` im Producer hat denselben fehlenden Cross-File-Vertrag.
- **Claude-Prüfung:** Sync-Fixture: neuer Index, altes Overview wegen 500; Reader muss Gesamtgeneration ablehnen oder auf kompletten letzten guten Snapshot zurückrollen.

### BH-089 — HOCH · T1 — Der einzige sanktionierte Coverage-Alarm wird zwar geladen, aber niemals angezeigt oder ausgewertet

- **Fundstelle:** Sync `findash/data-layer/screener-sync.js:89-100`; Pfad `findash/data-layer/screener-paths.js:26-27`; Reader `findash/data-layer/screener.js:214-307` enthält keinen Read von `coverageStatus`; React `findash/web/src/routes/index.tsx:420-511`.
- **Fehler/Mechanismus:** `outputs/coverage-status.json` wird gespiegelt, sein Fetchfehler ist sogar ausdrücklich von Warnungen ausgenommen. `loadScreener()` liest nur `index.coverage`; das separate Status-/Degradationsartefakt gelangt weder ins API-Envelope noch ins aktuelle React-Banner.
- **Auswirkung:** `DEGRADIERT`/`KATASTROPHAL` kann im einzigen vorgesehenen Dashboard-Alarmkanal vollständig unsichtbar bleiben.
- **Claude-Prüfung:** Fixture mit rotem `coverage-status/v1`; `/api/screener` und UI müssen sichtbaren Alarm ausgeben.

### BH-090 — HOCH · T1 — Das aktuelle React-Frontend verschweigt Backend-, Sync- und QC-Ausfallfehler

- **Fundstelle:** Backendfelder `findash/data-layer/screener.js:110-120`, `:246-305`; aktuelles UI `findash/web/src/routes/index.tsx:198-260`, `:420-511` referenziert weder `env.error` noch `env.syncWarning` noch `env.qualityFailed`.
- **Fehler/Mechanismus:** Der alte Vanilla-Client zeigt diese Banner, der aktuelle React-Screener nur Staleness und einen pauschalen QC-Diagnostic-Hinweis. Bei fehlendem/korruptem Export erscheint „Stand — · Universum 0 Aktien“ ohne Fehler; ein neutralisierter QC-Lauf wird als „noch nicht synchronisiert“ fehlgedeutet.
- **Auswirkung:** Harte Contract-/Sync-/QC-Fehler werden im produktiven Frontend zu scheinbar leerem Normalzustand.
- **Claude-Prüfung:** UI-Fixtures für `error`, `syncWarning`, `qualityFailed`; jeweils `role=alert` und eindeutiger Text.

### BH-091 — HOCH · T1 — Diagnostic-Status einzelner Hypergrowth-Boards geht im React-Frontend verloren

- **Fundstelle:** Backend joint `boardStatus` in `findash/data-layer/screener.js:73-95`; React-Mapper `findash/web/src/routes/index.tsx:102-136` verwirft das Feld; Rendering `:1384-1462` zeigt keinen Status. Nur QC ist pauschal hardcodiert diagnostic (`:445-464`, `:495-510`).
- **Fehler/Mechanismus:** Zeilen aus diagnostic HG-Boards sehen im aktuellen Frontend exakt wie court-bewiesene Core-Zeilen aus.
- **Auswirkung:** Nutzer kann experimentelle Board-Ergebnisse für freigegebene Qualität halten; die dokumentierte „unübersehbare“ Standing-Weiche greift nicht.
- **Claude-Prüfung:** Gemischtes Core/Diagnostic-Overview rendern; jede diagnostic-Zeile braucht sichtbaren Badge.

### BH-092 — HOCH · T1 — „Aktualisieren“ im Screener aktualisiert den Screener gar nicht

- **Fundstelle:** Button `findash/web/src/routes/index.tsx:420-430`; Route `findash/server.js:400-403`; Screener-Sync ausschließlich stündlich `findash/server.js:698-709`.
- **Fehler/Mechanismus:** Der Button POSTet `/api/refresh`; diese Route ruft nur `runPull()` für die allgemeinen Findash-Feeds auf. `syncScreenerData()` wird nicht angestoßen. Danach invaliderte Queries lesen denselben alten Screenerstand erneut.
- **Auswirkung:** Sichtbares Nutzerkommando verspricht Frische, kann den Screener aber um bis zu eine weitere Stunde unverändert lassen.
- **Claude-Prüfung:** End-to-end-Test mit neuer Remote-Generation; Button muss Screener-Sync auslösen oder eindeutig anders benannt werden.

### BH-093 — HOCH · T1 — Das Survival-Board zeigt erfundenen Score 0 und „Profitabel“ statt Runway

- **Fundstelle:** Backend liefert `runwayQuarters` in `findash/data-layer/screener.js:98-107`; React-Mapper `findash/web/src/routes/index.tsx:105-135` setzt fehlenden Score auf 0, jeden Nicht-`unprofitable`-Track auf „Profitabel“ und ignoriert `runwayQuarters`; gemeinsame Filter `:214-230`, Tabelle `:1384-1462`.
- **Fehler/Mechanismus:** Survival besitzt semantisch weder Score noch Profit-Track. Das UI erfindet beides und lässt den zentralen Runway-Wert weg. Ein zuvor gesetzter Score-/Trackfilter bleibt beim Boardwechsel aktiv und kann alle Survival-Zeilen verstecken.
- **Auswirkung:** Falsche Anzeige und irreführende Filterung des gesamten Survival-Modus.
- **Claude-Prüfung:** Survival-Row rendern: Runway sichtbar, keine Score-/Profit-Aussage, inkompatible Filter deaktiviert/zurückgesetzt.

### BH-094 — MITTEL · T1 — Der sichtbare Umsatzwachstumsfilter ist nach eigener Codeaussage wirkungslos

- **Fundstelle:** State/Filter `findash/web/src/routes/index.tsx:193-230`, UI-Regler `:1229-1237`.
- **Fehler/Mechanismus:** Slider und Aktiv-Zähler reagieren, aber `filteredRows` verwendet `minGrowth` nicht. Kommentar `:227` räumt ein, dass der Export kein Wachstumsfeld trägt.
- **Auswirkung:** Nutzer glaubt, Mindestwachstum eingestellt zu haben; Treffer bleiben byte-identisch.
- **Claude-Prüfung:** Regler entfernen/deaktivieren oder echtes Vertragsfeld hinzufügen; Behavior-Test zwei Sliderwerte → unterschiedliche/erklärte Resultate.

### BH-095 — MITTEL · T1 — „Universum“ im Header ist nur die Zahl exportierter Top-Zeilen

- **Fundstelle:** `findash/web/src/routes/index.tsx:200-242`, Anzeige `:470-472`; Producer exportiert Overview bewusst als Top-N.
- **Fehler/Mechanismus:** `universe={allRows.length}` zählt im aktuellen Hypergrowth-Overview 200 Zeilen, nicht die 11.106 Watchlist-Titel, 4.681 scorebaren Namen oder die volle geroutete Population aus `index.counts`.
- **Auswirkung:** Header vermittelt einen falschen Universe-Denominator und ändert ihn je Board/Top-N.
- **Claude-Prüfung:** Klar „angezeigte Top-N“ nennen oder echten Denominator aus einem verpflichtenden Indexfeld beziehen.

### BH-096 — MITTEL · T1 — Ungültiges oder zukünftiges `generated_at` gilt im Dashboard als nicht veraltet

- **Fundstelle:** Consumer-Validator `findash/data-layer/screener-contract.js:37-51` prüft nur Schlüsselpäsenz; `findash/data-layer/screener.js:228-240` setzt bei nicht parsebarem Datum beide Stale-Flags auf false.
- **Fehler/Mechanismus:** `generated_at:null`, Müllstring oder weit zukünftiger Zeitpunkt passiert den Contract. `Date.parse` wird NaN bzw. Alter negativ; Ergebnis ist „frisch“ statt unbekannt/rot.
- **Auswirkung:** Defekte Provenienz schaltet gerade den Freshness-Alarm ab.
- **Claude-Prüfung:** Invalid-/Future-Time-Fixtures müssen Contractbruch oder sichtbares unknown/stale liefern.

### BH-097 — MITTEL · T2 — QC-404 ohne `_failed` lässt ein altes Quality-Board still weiterleben

- **Fundstelle:** `findash/data-layer/screener-sync.js:103-130`; Test schreibt dieses Verhalten fest `findash/test/screener-sync.test.js:127-133`.
- **Verdacht/Mechanismus:** Fehlen Quality-Index/Overview und zugleich `_failed`, bleibt der lokale alte QC-Spiegel absichtlich unangetastet und es gibt keine Warnung. Das war für den Übergangstag gedacht, gilt aber unbegrenzt auch bei Deploy-/Pfadfehlern nach erfolgter Einführung.
- **Auswirkung:** Ein veraltetes QC-Board kann ohne Freshness-/Sync-Hinweis als verfügbar erscheinen.
- **Claude-Prüfung:** Nach erstem erfolgreichen QC-Publish 404 als Anomalie behandeln; Generation/Freshness des lokalen Spiegels prüfen.

### BH-098 — MITTEL · T1 — Default-IPO-Filter schließt ab 2027 alle neuen IPOs aus

- **Fundstelle:** `findash/web/src/routes/index.tsx:150-151`, Filter `:225-226`.
- **Fehler/Mechanismus:** `IPO_MAX` ist fest 2026; die Defaultfilterung läuft immer. Ein Exportticker mit `ipoYear:2027` wird deshalb selbst bei unverändertem „Alle“-Zustand entfernt.
- **Auswirkung:** Ab Jahreswechsel verschwinden neue Börsengänge ohne Nutzerfilter.
- **Claude-Prüfung:** Obergrenze aus aktuellem Jahr/Daten ableiten und Future-Year-Fixture.

### BH-099 — HINWEIS · T3 — Die aktuelle React-Screenerlogik besitzt kein eigenes Verhaltenstestnetz

- **Fundstelle:** 573 grüne Findash-Node-Tests prüfen vor allem Backend und das alte `public/screener-view.js`; die produktive Logik in `findash/web/src/routes/index.tsx` (`mapScreenerRows`, gemeinsame Filter, Alarmbanner, Boardwechsel) hat keine entsprechenden Component-/Pure-Function-Tests. Der Vite-Build ist grün, beweist aber nur Kompilierbarkeit.
- **Auswirkung:** BH-090 bis BH-098 bleiben trotz vollständig grüner Suite unentdeckt.
- **Claude-Prüfung:** Mapper/Filter extrahieren oder per Component-Test die konkreten Alarm-, Survival-, Boardstatus- und Filterfälle pinnen.

### BH-100 — HOCH · T1 — Auch sämtliche Yahoo-Predefined-Screener liefern aktuell null, ohne eigenen Aggregat-Abbruch

- **Fundstelle:** `refresh-universe.js:241-265`, Aufrufer `:415-463`; Live-Log des Daily-Laufs `29631632950` vom 18.07.2026.
- **Fehler/Mechanismus:** `fetchScreener()` macht aus jeden nicht-429-Schemafehler sofort `[]`; der Aufrufer überspringt leere Ergebnisse und besitzt keinen Vertrag „alle Buckets/Regionen ausgefallen“. Im jüngsten Lauf scheiterten sämtliche geloggten Bucket-/Regionskombinationen mit `Failed Yahoo Schema validation`; erst der separate Custom-Screener-Bug BH-038 erzeugte später Exit 1, der ebenfalls geschluckt wurde.
- **Auswirkung:** Beide Yahoo-Universe-Kanäle liefern aktuell keinen Neuzugang. Würde BH-038 isoliert behoben, könnte der vollständig kollabierte Predefined-Kanal weiterhin nur warnend leer bleiben.
- **Claude-Prüfung:** Fehler-/Erfolgszähler je Bucket/Region; Total-/Massencollapse bindend in Universe-Health und CI-Status tragen.

### BH-101 — KRITISCH · T1 — Der Forward-Return klassifiziert nachweislich weitergehandelte Titel als delisted und bucht −100 %

- **Fundstelle:** `lib/forward-returns.js:91-107`; Verbraucher `scripts/rank-ic.js:303-305`; festgeschriebener Gegenfall `tests/rank-ic.test.js:74-89`.
- **Fehler/Mechanismus:** Fehlt am Zieltag ein Close, setzt die Hilfsfunktion `delisted`, sobald der jüngste bekannte Kurs **am oder nach** dem Exitdatum liegt. Das ist gerade der Beleg, dass der Titel weitergehandelt wurde. `rank-ic` ersetzt diesen Datenlückenfall anschließend durch −100 %. Der Test `DEAD` besitzt einen Kurs an t0+89 bei Ziel t0+84 und erwartet trotzdem Totalverlust.
- **Auswirkung:** Feiertag, Handelsunterbrechung, illiquider Titel oder fehlender Zielpunkt werden zu künstlichen Pleiten; IC, Gate und Boardvergleich können massiv verzerrt werden.
- **Claude-Prüfung:** Den Test semantisch umdrehen: ein Kurs nach dem Ziel darf nie Delisting beweisen; Delisting nur über belastbare Status-/Corporate-Action-Evidenz behandeln.

### BH-102 — KRITISCH · T1 — `series_ended` wird zwischen Hilfsfunktion und Rank-IC gegensätzlich interpretiert

- **Fundstelle:** `lib/forward-returns.js:65-70`; `scripts/rank-ic.js:306-309`.
- **Fehler/Mechanismus:** Die Hilfsfunktion verwendet `series_ended` für „Serie endete/Tracking unzureichend“ und verlangt, den Punkt zu verwerfen. Der Aufrufer deutet denselben Status als M&A/echten Marktaustritt und verbucht einen verkürzten Return.
- **Auswirkung:** Pull-Ausfälle, illiquide Auslandstitel oder abgeschnittene Historien fließen wie echte wirtschaftliche Exits in den Messbeleg ein.
- **Claude-Prüfung:** Statusvertrag als endliche Zustandsmenge testen; `series_ended` ohne externe Exit-Evidenz muss unknown/drop bleiben.

### BH-103 — KRITISCH · T1 — Die geplante History-Kompaktierung entfernt vor der Delivery-Auswertung genau das benötigte t0-PIT

- **Fundstelle:** `scripts/write-board-history.js:366-400`; `scripts/rank-ic.js:348-386`.
- **Fehler/Mechanismus:** `--compact` entfernt nach 180 Tagen sämtliche `pit`-Daten aus dem t0-Vintage. Delivery-IC benötigt genau diese t0-Revenuewerte erst beim späteren Vergleich; `rank-ic` liest das Vollarchiv nicht. Sobald der Messpunkt ausgewertet wird, fehlt damit die Ausgangsseite und `deliveryIC.n` fällt auf null.
- **Auswirkung:** Aktivierte Retention zerstört den für Delivery benötigten historischen Input unabhängig von Signalqualität. `MIN_NEFF` und Raw∧Residual gehören dagegen zum Rank-IC-Gate und sind nicht Teil dieses Delivery-Mechanismus.
- **Claude-Prüfung:** Retention und Delivery-Horizont als Zeitachsen-Simulation testen und das Vollarchiv in den Messpfad einbeziehen, bevor Kompaktierung produktiv wird.

### BH-104 — HOCH · T1 — Korrupte Ausschluss- und Gate-Dateien werden fail-open zu leerem Zustand überschrieben

- **Fundstelle:** `scripts/rank-ic.js:195-199`; `scripts/write-board-history.js:343-353`, `:459`, `:503`; Verhaltenstest `tests/rank-ic.test.js:396-399`.
- **Fehler/Mechanismus:** Fehlende und korrupte `_excluded.json` werden identisch als leere Ausschlussliste gelesen; der Writer ersetzt sie danach mit einem leeren Scaffold. Für eine korrupte `_gate-calibration.json` gilt dasselbe Muster.
- **Auswirkung:** Manuell eingefrorene Ausschlüsse oder Gatekalibrierung können durch einen Parse-/Teilwritefehler still verloren gehen; der nächste Lauf sieht einen legitimen leeren Zustand.
- **Claude-Prüfung:** Korruption muss hart stoppen und die letzte gute Datei erhalten; Missing-Initialzustand explizit von Parsefehler unterscheiden.

### BH-105 — HOCH · T1 — Board-Vintages behaupten eine falsche Formelversion und werden versionsübergreifend gepoolt

- **Fundstelle:** `scripts/write-board-history.js:245-247`, `:450-454`; reale Vintages 14.–18.07.2026; Scoringänderungen u. a. Tags 323 und 334–340.
- **Fehler/Mechanismus:** `formulaVersion` wird aus `calibration.schema` befüllt. Dadurch tragen alle geprüften Vintages `calibration/v4`, obwohl sich die tatsächliche Scoreformel mehrfach geändert hat. `rank-ic` trennt die Beobachtungen nicht nach Formel-/Codeversion.
- **Auswirkung:** Der Walk-forward-Beleg mischt Scores verschiedener Definitionen und etikettiert sie als einheitliche Formelhistorie.
- **Claude-Prüfung:** Unveränderlichen Formel-/Commit-/Config-Hash speichern und im Rank-IC entweder segmentieren oder Versionswechsel als neue Messserie beginnen.

### BH-106 — HOCH · T2 — Das Survival-Board ist im gemeinsamen Rank-IC-Vertrag strukturell unmessbar

- **Fundstelle:** `scripts/write-board-history.js:223-240`; `scripts/rank-ic.js:298-303`; zugleich wird Survival in der Boardfamilie mitgeführt.
- **Fehler/Mechanismus:** Survival speichert keinen numerischen Score, sondern `score:null` und Runway. `rank-ic` verwirft jede Zeile ohne finiten Score. Trotzdem wird Survival als zu messendes Board/Familienmitglied behandelt.
- **Auswirkung:** Für Survival können weder Raw- noch Residual-IC entstehen; Gate-/FDR-Erwartung und Datenvertrag passen nicht zusammen.
- **Claude-Prüfung:** Survival aus scorebasiertem Rank-IC entfernen oder eine fachlich vorregistrierte Survival-Metrik mit eigenem Nullmodell definieren.

### BH-107 — KRITISCH · T1 — Die FDR-Korrektur wird erst nach datenabhängiger Vorauswahl auf eine zu kleine Familie angewandt

- **Fundstelle:** Familienvertrag `scripts/rank-ic.js:16-19`; Auswahl `:443-461`; BY-Korrektur `:475-480`.
- **Fehler/Mechanismus:** Vertraglich gehören 14 Boards × zwei Horizonte (28d/84d) = 28 Board-Horizont-Hypothesen zur Familie. In die BY-Liste gelangen aber nur Kandidaten, die bereits CI und `N_eff>=8` besitzen. Der Korrekturfaktor `m` schrumpft damit datenabhängig. Obwohl LIVE zusätzlich Raw∧Residual verlangt, gelangt ausschließlich `ci.p` des Raw-IC in BY; die Residualseite passiert nur über ihr unadjustiertes 90-%-CI und besitzt keinen separat bestimmten effektiven Stichprobenumfang.
- **Auswirkung:** Multiples Testen wird liberaler als vorregistriert; schwache/fehlende Tests verschwinden aus dem Nenner und können Promotion erleichtern. Residual-IC kann zudem ohne eigenen Powernachweis zur LIVE-Konjunktion beitragen.
- **Claude-Prüfung:** Feste 28 Board-Horizont-Hypothesen inklusive nicht messbarer/fehlender Tests behandeln und für die Raw∧Residual-Konjunktion einen präregistrierten gemeinsamen p-/Power-Vertrag anwenden.

### BH-108 — KRITISCH · T1 — Delivery-IC misst bei Nicht-USD-Titeln wechselnde Tages-FX-Raten als Umsatzwachstum

- **Fundstelle:** `pull-yahoo.js:662-679`; `scripts/write-board-history.js:169-204`; `scripts/rank-ic.js:362-383`.
- **Datenbeleg:** Historische `revenueQ` werden bei jedem Snapshot erneut mit dem dann aktuellen FX-Faktor in USD umgerechnet; im PIT bleiben weder Originalwährung noch angewandter FX-Kurs. Für identische Periode `WTB.L` 2018-08-31 driftete der gespeicherte Umsatz vom 14.–18.07.2026 ohne neue Unternehmensperiode `720.284.699 → 730.299.102 → 725.691.444` USD. Dasselbe exakte 1,39-%-Muster trat u. a. bei MKS.L, BRBY.L, TSCO.L, BME.L und LSEG.L auf; 35 identische Ticker-/Periodenwerte änderten sich in nur fünf Vintages.
- **Auswirkung:** `rev1/rev0-1` enthält reales Umsatzdelta plus Abruf-FX-Bewegung; Delivery-Rank-IC wird für Auslandstitel durch Währungsrauschen/-trend kontaminiert und ist nachträglich nicht bereinigbar.
- **Claude-Prüfung:** PIT in Originalwährung plus Währungs-/FX-Provenienz speichern oder beide Vintages auf konsistenter vorregistrierter FX-Basis vergleichen.

### BH-109 — HOCH · T1 — PIT-Coverage zählt uralte Perioden als vollständig nutzbare Delivery-Abdeckung

- **Fundstelle:** `scripts/write-board-history.js:175-185`, `:207-216`; Gate `:282-287`; Verbraucher `scripts/rank-ic.js:362-381`.
- **Datenbeleg:** Der Writer prüft nur, ob im Ends-Array **irgendein** Datum ungleich null vorkommt; Alter und jüngstes Periodenende spielen keine Rolle. Am 18.07.2026 galten 205 Boardzeilen als `revenueQEnds`-present, davon 26 (12,7 %) mit jüngstem Ende älter als ein Jahr. Extreme: BA.L 2006-06-30, RAT.L 2010-03-31, SBRY.L 2011-06-30, BLND.L 2012-03-31, WTB.L 2018-08-31.
- **Auswirkung:** Das Coverage-Gate bleibt scheinbar gesund, obwohl die Daten den später geforderten +2Q-Delivery-Vergleich nicht liefern können.
- **Claude-Prüfung:** Nutzbarkeit pro Horizont messen: gemeinsames Periodenraster, Mindestfrische und tatsächlich erreichbare Folgequartale statt bloßer Nicht-null-Zählung.

### BH-110 — HOCH · T2 — Ein defektes Vintage blockiert den Messrasterpunkt; Boards werden nur aus dem ersten Vintage entdeckt

- **Fundstelle:** `scripts/rank-ic.js:248-252`, `:267-278`, `:413-430`.
- **Fehler/Mechanismus:** Missing, I/O-Fehler und kaputtes JSON werden alle zu `null`. Die 28-/84-Tage-Entscheidung wird aber vorher allein aus Dateinamen geplant; ist das gewählte t0 unlesbar, wird nur `continue` ausgeführt und kein benachbartes sauberes Vintage rückt nach. Zusätzlich stammt die globale Boardliste ausschließlich aus dem ersten Vintage.
- **Auswirkung:** Eine kaputte Datei kann einen ganzen Messpunkt lautlos entfernen; ein dort fehlendes Board bleibt selbst bei vollständigen späteren Vintages für die gesamte Historie und FDR-Familie unsichtbar.
- **Claude-Prüfung:** Parsefehler hart melden, Raster erst aus validierten Vintages bauen und Boards als Union der gültigen Historie bestimmen.

### BH-111 — HOCH · T2 — Das Vintage-Wert-Gate ist blind für Kohortenverlust und lässt Verdachtstage die Schwelle kalibrieren

- **Fundstelle:** `scripts/write-board-history.js:260-307`, `:475-486`.
- **Fehler/Mechanismus:** NaN wird nur für Ticker geprüft, die im neuen `nowMap` noch existieren; PIT-Coverage ist nur ein Anteil, der P99-Delta nur auf der Schnittmenge. Verschwinden 50–90 % der Boardzeilen, können die wenigen Überlebenden `p99Delta=0` und stabile Anteile liefern; es gibt weder Mindestkohorte noch Overlap-Floor. Zudem fließt der P99-Wert unabhängig von `gate.suspect` in `updateGateCalibration` ein.
- **Auswirkung:** Ein leerer oder fast leerer Volloutput kann als gesundes Vintage landen; ein bereits als korrupt erkannter Tag kann außerdem die eingefrorene Schwelle nach oben ziehen. Survival bleibt wegen `score:null` in diesem Modell dauerhaft `calibrating`.
- **Claude-Prüfung:** Absolute Boardgröße und Kohortenüberlappung gaten; verdächtige Tage strikt aus jeder Kalibrierung ausschließen; Survival separat behandeln.

### BH-112 — HOCH · T2 — Rank-IC verwirft den eigenen Stale-Exit-Hinweis und misst heterogene Horizonte als volle 84 Tage

- **Fundstelle:** `lib/forward-returns.js:38-51`, `:110-121`; `scripts/rank-ic.js:303-305`.
- **Fehler/Mechanismus:** `_priceAtCanonical` darf bis sieben Kalendertage rückwärts ausweichen. Ist der noch akzeptierte Exitclose mehr als zwei Geschäftstage alt, setzt die Hilfsfunktion korrekt `exitStale=true`; `rank-ic` übernimmt bei `status=ok` jedoch nur `ret` und verwirft Flag und Tageszahl. Entry und Exit werden je Ticker unabhängig verschoben; beim Entry kann sogar ein vor dem Vintage liegender, zu diesem Zeitpunkt nicht handelbarer Close verwendet werden.
- **Auswirkung:** Tatsächliche 77–84-Tage- und tickerabhängig unterschiedliche Fenster werden als homogene 84-Tage-Punkte gepoolt. Zusammen mit BH-002 kann ein `.AX`-Entrykey außerdem bereits den Schluss des folgenden australischen Handelstags enthalten.
- **Claude-Prüfung:** Entry-/Exit-Provenienz und effektiven Horizont verpflichtend ausgeben; stale/zeitlich unhandelbare Punkte verwerfen oder vorregistriert normalisieren.

### BH-113 — KRITISCH · T1 — Der erste Pages-Deploy löscht bei jedem Daily-Lauf sämtliche Scoring-Feeds

- **Fundstelle:** `.github/workflows/daily-pull.yml:716-741`; zweiter Deploy erst `:839-872`.
- **Produktionsbeleg:** Deploy-1-Commit `95473a69aa` enthält sechs Dateien und null Hypergrowth-/Findash-Dateien. Erst Commit `495fcff78c` rund zwei Minuten später stellt 51 Dateien wieder her.
- **Fehler/Mechanismus:** Deploy 1 initialisiert einen leeren Pages-Branch und force-pusht nur `index.html` plus Merge-Outputs; die Scoringpfade existieren in diesem Runner nicht.
- **Auswirkung:** Bei jedem Lauf sind die Feeds kurz 404. Scheitern Scoring, Export oder Vertrag danach, bleiben sie bis zum nächsten vollständig erfolgreichen Lauf gelöscht.
- **Claude-Prüfung:** Beide Trees vergleichen und ausschließlich eine atomare, vollständige Pages-Generation publizieren.

### BH-114 — KRITISCH · T1 — Ein transienter Clone-Fehler im zweiten Deploy löscht den übrigen Pages-Stand

- **Fundstelle:** `.github/workflows/daily-pull.yml:842-872`.
- **Fehler/Mechanismus:** Jeder `git clone`-Fehler wird wie „Branch existiert nicht“ behandelt. Der Fallback initialisiert einen leeren Branch; anschließend werden nur Scoringdateien kopiert und force-gepusht.
- **Auswirkung:** Ein DNS-, Auth-, Netzwerk- oder GitHub-Aussetzer kann `index.html`, Coverage, Macro-Regime und Pull-Stats aus Pages entfernen.
- **Claude-Prüfung:** Clone-Fehler injizieren und den vollständigen Zieltree zwingend vor Push validieren; Nicht-Existenz von transientem Fehler unterscheiden.

### BH-115 — HOCH · T1 — Manuelle Workflows sind trotz gemeinsamer Force-Push-Ziele nicht serialisiert

- **Fundstelle:** `daily-pull.yml:20-22`; `monthly-sec-xbrl.yml:21-23`; `weekly-guard.yml:23-26`; `monthly-plan-check.yml:23-25`.
- **Fehler/Mechanismus:** Jeder `workflow_dispatch` erhält eine eigene `manual-<run_id>`-Concurrency-Gruppe und kollidiert weder mit Main-Push noch mit einem zweiten manuellen Lauf. Rebase-Retries schützen den Pages-Force-Push nicht.
- **Auswirkung:** Ein älterer Lauf kann einen neueren Pages-Stand überschreiben; Reports, Marker, Boards und Generationen können gegeneinander laufen.
- **Claude-Prüfung:** Zwei manuelle Daily-Läufe als Ereignisfolge simulieren; alle Writer auf gemeinsamem Ziel serialisieren.

### BH-116 — KRITISCH · T1 — Der Live-Scorer rankt Tausende Cache-Altbestände außerhalb des aktuellen Pull-Vertrags

- **Fundstelle:** Cache `daily-pull.yml:380-473`; `scripts/merge-shard-manifests.js:107-111`, `:144-158`; `src/scoring/run-screener.js:69-84`.
- **Produktionsbeleg:** Coverage-Manifest: `n_ok=4.252`; aktueller HG-Index: `generatedFromSnapshots=6.399`. Von 1.504 aktuellen Boardzeilen fehlen 355 Ticker in `watchlist.json`, darunter SGHC, CYD, ATAT, AFYA und RACE.
- **Fehler/Mechanismus:** Shard-Caches werden nie auf aktuellen Shard-/Watchlistbestand bereinigt. Der Merge entfernt Extras nicht; der Scorer lädt jede JSON-Datei auf Disk.
- **Auswirkung:** Entfernte, geprunte oder nicht mehr autorisierte Titel beeinflussen Perzentile und erscheinen weiter auf Boards.
- **Claude-Prüfung:** Scoringkorpus als exakte autorisierte Ticker-Menge materialisieren und Cache-Union gegen Manifest/Watchlist differenzieren.

### BH-117 — HOCH · T1 — Der laufübergreifende Scoring-Coverage-Floor startet in CI täglich ohne Baseline

- **Fundstelle:** `src/scoring/run-screener.js:35-47`, `:90-113`; `.github/workflows/daily-pull.yml:759-798`.
- **Fehler/Mechanismus:** `_last_good_disk.json` ist git-ignoriert, wird erst im frischen Scoring-Runner geschrieben und weder geladen, committed, gecacht noch als Artefakt übergeben.
- **Produktionsindiz:** Pull-Stats und Scorer melden beide 6.399 JSON-Dateien; eine vorher existente Baseline wäre als zusätzliche JSON sichtbar. Sie entsteht erst im danach sterbenden Runner.
- **Auswirkung:** `baseline=null`; `assertCoverageFloor()` ist in jedem CI-Lauf fail-open und ein Korpuskollaps kann zur neuen Baseline werden.
- **Claude-Prüfung:** Existenz direkt vor Scoring messen und letzte gute Baseline persistent/atomar übergeben.

### BH-118 — HOCH · T1 — Coverage entsteht im Pull, erreicht aber den Findash-Export nicht

- **Fundstelle:** `.github/workflows/daily-pull.yml:571-575`, `:695-703`, `:759-798`; `scripts/write-findash-export.js:286-305`, `:428-438`.
- **Produktionsbeleg:** Aktueller `coverage-status.json`: `degradiert`, 38,3 %; aktueller `findash-export/v1/index.json`: `coverage:null`.
- **Fehler/Mechanismus:** Der Marker bleibt im Merge-Runner; der frische Scoring-Runner erhält ihn nicht. Der Writer setzt null und `--check` akzeptiert das als gültig.
- **Auswirkung:** Selbst nach Behebung des Consumerfehlers BH-089 trägt der produktive Export keine Alarmgrundlage.
- **Claude-Prüfung:** Marker verpflichtend im Handoff mitführen und `coverage:null` in einer Produktionsgeneration verbieten.

### BH-119 — HOCH · T1 — Der unabhängige Heartbeat verfehlt alle Fehler nach dem Main-Commit

- **Fundstelle:** Main-Commit `.github/workflows/daily-pull.yml:630-673`; nachgelagerte Schritte `:706-933`; `.github/workflows/heartbeat.yml:46-75`.
- **Fehler/Mechanismus:** Heartbeat liest nur `snapshots/_manifest.json.pulled_at`. Artifact-Upload, Pages, Scoring, Exportvertrag und Vintage passieren erst nach diesem Commit.
- **Auswirkung:** Daily kann rot und das Nutzerprodukt stale oder gelöscht sein, während der angeblich unabhängige Wächter grün meldet.
- **Claude-Prüfung:** Fehler direkt nach Main-Commit injizieren; Heartbeat muss die letzte vollständig publizierte Generation messen.

### BH-120 — HOCH · T1 — Pull-Stats hat in CI nie die vier benötigten Vergleichsläufe

- **Fundstelle:** `scripts/check-pull-stats.js:42`, `:98-141`; Workflow `.github/workflows/daily-pull.yml:591-600`.
- **Fehler/Mechanismus:** `outputs/pull-stats/history.json` wird auf jedem frischen Runner neu angelegt und vorher aus keinem persistenten Stand geladen.
- **Produktionsbeleg:** Die aktuelle Pages-History enthält exakt einen Eintrag vom 18.07.2026.
- **Auswirkung:** `MIN_HISTORY_RUNS=4` wird nie erreicht; der 25-%-Driftwächter kann in CI prinzipiell nicht feuern.
- **Claude-Prüfung:** Vier frische Runner hintereinander testen und History als persistentes Eingabeartefakt verlangen.

### BH-121 — HOCH · T1 — FX-Freshness prüft Checkout-Mtime statt Datenzeit

- **Fundstelle:** `.github/workflows/daily-pull.yml:231-249`; `fx-rates.json:2`; `scripts/refresh-fx.js:64-67`, `:133-139`.
- **Fehler/Mechanismus:** Ein frischer Checkout setzt die Datei-Mtime auf jetzt. Bei komplett gescheitertem Refresh bleibt `fetchedAt` alt, aber `stat` meldet Alter null.
- **Auswirkung:** Die Warnung ab sieben und der harte Stop ab 30 Tagen können in CI falsches Grün liefern.
- **Claude-Prüfung:** Altes `fetchedAt` in frischem Checkout mit Refreshfehler; ausschließlich Inhaltszeit auswerten.

### BH-122 — MITTEL · T1 — „Pipeline Health Check“ ist im sauberen CI-Checkout garantiert ein No-op

- **Fundstelle:** `scripts/pipeline-health-check.js:20-50`; Aufruf `.github/workflows/daily-pull.yml:706-714`.
- **Fehler/Mechanismus:** `EXPECTED_SCRIPTS=[]`; `pipeline-health/` ist git-ignoriert und fehlt im frischen Runner. Das Skript beendet sich sofort mit Exit 0.
- **Auswirkung:** Der zentrale Health-Schritt aggregiert keinen einzigen Best-effort-Pfad oder Watcher.
- **Claude-Prüfung:** Aus sauberem Checkout ausführen und eine nichtleere, maschinell geprüfte Producerliste verlangen.

### BH-123 — MITTEL · T1 — Exchange-Watcher übernimmt Totalausfälle in seine Baseline, bis der Verlust normal wirkt

- **Fundstelle:** `scripts/watch-exchange-coverage.js:54-76`, `:103-120`; Workflow fail-soft `daily-pull.yml:608-613`.
- **Produktionsbeleg:** Aktuelle Baselines enthalten etwa `Shenzhen [68,68,68,0,…,0]`; gleiches Muster bei KOSDAQ, Taiwan, Shanghai, Toronto und weiteren Börsen.
- **Fehler/Mechanismus:** Ein alarmierender Nullstand wird vor Exit 1 ins 14er-Fenster geschrieben und committed. Nach genügend Nullen ist der Median null und `med > 0` greift nicht mehr.
- **Auswirkung:** Anhaltender kompletter Börsenverlust wird nach einigen Läufen wieder grün.
- **Claude-Prüfung:** 3 gesunde + 11 Nulltage simulieren; Alarmtage dürfen die gesunde Referenz nicht ersetzen.

### BH-124 — MITTEL · T1 — FX-Sanity alarmiert einen anhaltenden Sprung nur am ersten Tag

- **Fundstelle:** `scripts/watch-fx-sanity.js:56-66`, `:96-112`; Workflow `daily-pull.yml:619-621`.
- **Fehler/Mechanismus:** Der anomale heutige Wert wird als `baseline.last` gespeichert. Bleibt die Korruption morgen gleich, ist die Tagesänderung null.
- **Auswirkung:** Persistente FX-Korruption verschwindet nach einem fail-soft-Lauf aus dem Alarm.
- **Claude-Prüfung:** Sequenz 100 → 50 → 50 muss auch am dritten Punkt rot bleiben.

### BH-125 — MITTEL · T1 — Taxonomie-Watcher erklärt jede neue unbekannte Bezeichnung ab dem Folgelauf für bekannt

- **Fundstelle:** `scripts/watch-unrouted-quote.js:60-84`; Workflow `daily-pull.yml:615-617`.
- **Fehler/Mechanismus:** Neue Labels werden vor dem Alarm in die wachsende Erlaubnis-Union geschrieben und committed. Beim nächsten Lauf gelten sie ohne Prüfung oder Routingfix als bekannte Baseline.
- **Auswirkung:** Echte Yahoo-Taxonomiedrift erzeugt höchstens einen fail-soft-Impuls und verschwindet danach.
- **Claude-Prüfung:** Dasselbe unbekannte Label zweimal einspeisen; unbestätigte Werte dürfen nicht automatisch legitim werden.

### BH-126 — HOCH · T1 — Der Coverage-Alarm darf ungültig oder ungeschrieben bleiben und trotzdem deployen

- **Fundstelle:** `scripts/coverage-gate.js:152-182`; Fallback `.github/workflows/weekly-guard.yml:50-59`.
- **Fehler/Mechanismus:** Marker-Vertrags- und I/O-Fehler sind nur Warnungen; `degradiert` schreibt zwar eine GitHub-Error-Annotation, beendet sich aber ausdrücklich mit Exit 0. Fehlt der Marker später auf Pages, warnt Weekly ebenfalls nur.
- **Produktionsbeleg:** Scheduled Run `29631632950` vom 18.07.2026 endete insgesamt `success`, obwohl sein Merge-Log `DEGRADIERT — Coverage 4252/11106 (38.3%), ehrlich 82.4% <90%` als Error annotierte. Derselbe Lauf exportierte `coverage:null` (BH-118).
- **Auswirkung:** Genau der Zustand, der ein Banner braucht, kann ohne gültigen Marker grün publiziert werden.
- **Claude-Prüfung:** Markerpfad unbeschreibbar machen; degradierter Lauf darf ohne validen Alarmvertrag nicht publizieren.

### BH-127 — MITTEL · T1 — Null Snapshot-Dateien gelten ausdrücklich als frisch

- **Fundstelle:** `scripts/verify-freshness.js:33-52`; Test `tests/freshness-gate.test.js:81-85`; `scripts/merge-shard-manifests.js:107-111` und Test `:245-247`.
- **Fehler/Mechanismus:** `total===0` setzt `ok=true`. Gleichzeitig gilt `onDisk=0` trotz nichtleer summiertem `n_ok` nicht als Reconciliation-Widerspruch.
- **Auswirkung:** Vorhandene Manifestartefakte plus leerer/fehlender Snapshotordner können Freshness und Coverage bestehen.
- **Claude-Prüfung:** Nichtleere Shard-Manifeste mit leerem Snapshotordner als bindende Workflow-Fixture.

### BH-128 — MITTEL · T1 — Zeitlich unbegrenzte Bootstrap-Ausnahmen schalten Dead-Men nach State-Verlust dauerhaft ab

- **Fundstelle:** `.github/workflows/heartbeat.yml:94-107`, `:124-132`; `scripts/cadence-marker.js:33-38`.
- **Fehler/Mechanismus:** Fehlende Preis-Meta oder fehlende/unparsebare Kadenzdatei bleiben ohne Bootstrap-Enddatum nur Warnungen. Der nichtatomare Writer ersetzt kaputten Zustand zudem durch ein Teilobjekt und kann das jeweils andere Feld verlieren.
- **Auswirkung:** Preisstore- sowie Wochen-/Monats-Dead-Man können auch Monate nach Inbetriebnahme dauerhaft blind werden.
- **Claude-Prüfung:** Heutigen Produktionsstand mit gelöschter oder korrupter Datei testen; dies darf nicht als Erststart gelten.

### BH-129 — HOCH · T1 — ATH-State publiziert wochenalte Einzelkurse unter einem heutigen globalen Zeitstempel

- **Fundstelle:** `scripts/update-ath-state.js:49-54`, `:72-91`, `:121-133`; Export `scripts/write-findash-export.js:69-81`, `:106`.
- **Produktionsbeleg:** Am 18.07.2026 enthielt der Store 956 Einträge; 158 hatten `lastDate` älter als sieben Tage, 133 davon exakt 16.06.2026. Nur fünf der 158 waren `needsReseed`; weitere Werte reichten bis 62 Tage zurück. BESI.AS und 6146.T fehlten komplett im Preisstore.
- **Fehler/Mechanismus:** Fehlende/stale Tickerserie lässt den Einzelstand unverändert, während `state.asOf` stets auf heute gesetzt wird. `displayFor` prüft weder `lastDate` noch Alter.
- **Auswirkung:** Findash zeigt `distancePct` auf ein bis zwei Monate altem Schlusskurs unter scheinbar frischem Gesamtstand.
- **Claude-Prüfung:** Einzel-`lastDate` verpflichtend gaten/exportieren; stale Anzeige auf unbekannt setzen.

### BH-130 — MITTEL · T1 — Der Monats-Plan-„Banner“ verlässt den Runner nie

- **Fundstelle:** `scripts/plan-check.js:100-114`; `.github/workflows/monthly-plan-check.yml:49-63`.
- **Fehler/Mechanismus:** `outputs/plan-check-status.json` liegt git-ignoriert in `outputs/`, wird weder als Artefakt übergeben noch auf Pages deployed; committed werden nur `reports/` und `state/`.
- **Auswirkung:** `needs_human_review=true` kann das versprochene Dashboard-Banner nicht auslösen.
- **Claude-Prüfung:** Main-/Pages-Tree nach dem Statusartefakt prüfen und Consumerpfad als Vertrag testen.

### BH-131 — MITTEL · T1 — Marker-/Report-Push kann dreimal scheitern und der Workflow bleibt grün

- **Fundstelle:** `.github/workflows/weekly-guard.yml:77-81`; `monthly-plan-check.yml:58-62`.
- **Fehler/Mechanismus:** Nach drei Pushfehlern endet das Shellskript mit einem erfolgreichen Warnungs-`echo`, nicht Exit 1; Rebasekonflikte werden nicht sauber abgebrochen.
- **Auswirkung:** Wochenmarker oder Monatsreport gehen verloren; der nächste Alarm folgt erst viele Tage später.
- **Claude-Prüfung:** Push dreimal mock-fehlschlagen lassen und Step-Exitcode prüfen.

### BH-132 — MITTEL · T1 — Gültige Windows-Reserved-Ticker sind für mehrere Gates unsichtbar

- **Fundstelle:** `lib/snapshot-fs.js:26-59`; Scorer `src/scoring/run-screener.js:74-77`; `scripts/verify-freshness.js:36`; `merge-shard-manifests.js:145`; die drei Watcher.
- **Datenbeleg:** Reales `_CON.json` existiert.
- **Fehler/Mechanismus:** Kanonischer Writer präfixt reservierte Namen mit `_`; Scorer berücksichtigt sie. Freshness, Merge und Watcher filtern dagegen pauschal jede Unterstrichdatei weg.
- **Auswirkung:** CON wird gescort, aber nicht auf Frische, Exchange, Routing oder FX überwacht und in der `n_ok`-Reconciliation falsch behandelt.
- **Claude-Prüfung:** `_CON.json` durch jeden Reader schicken; nur explizit bekannte Metadateien ausschließen.

### BH-133 — MITTEL · T1 — Zukunftszeitstempel gelten in allen Freshness-Gates als unbegrenzt frisch

- **Fundstelle:** `scripts/verify-freshness.js:47-48`; `.github/workflows/heartbeat.yml:52-62`, `:97-104`, `:130-134`; `weekly-guard.yml:45-47`.
- **Fehler/Mechanismus:** Negative Alterswerte werden nirgends als unplausibel geprüft.
- **Auswirkung:** Clock-Skew oder ein korrupter Zukunftsstempel unterdrückt Alarme bis nach diesem Datum.
- **Claude-Prüfung:** `now+365d` muss unknown/rot statt frisch liefern.

### BH-134 — NIEDRIG · T1 — Drei aktive Workflows verletzen den eigenen Node-Runtime-Vertrag

- **Fundstelle:** `package.json:12-14` verlangt `>=22`; `weekly-guard.yml:37-41`, `monthly-plan-check.yml:36-39`, `tv-reachability.yml:37-44` nutzen Node 20.
- **Auswirkung:** Unterschiedliche Laufzeitsemantik; zukünftiger Node-22-Code kann ausschließlich in den Schutzkadenzen brechen.
- **Claude-Prüfung:** Runtime zentral und einheitlich aus dem Projektvertrag ableiten.

### BH-135 — NIEDRIG · T3 — Der TradingView-„Gate“-Workflow kann technisch nie rot werden

- **Fundstelle:** `.github/workflows/tv-reachability.yml:17-45`.
- **Fehler/Mechanismus:** Beide Curl-Schritte setzen Fehlerfortsetzung; der Adapter fängt Fehler und beendet ausdrücklich mit Exit 0.
- **Auswirkung:** Vollständige Nichterreichbarkeit erscheint als grüner Workflow und ist nur durch manuelles Loglesen erkennbar.
- **Claude-Prüfung:** Alle Endpunkte auf Fehler mocken und Gate- oder reine Reportsemantik eindeutig festlegen.

### BH-136 — NIEDRIG · T3 — Schreibberechtigte Cron-Workflows nutzen veränderliche Major-Tags für Actions

- **Fundstelle:** `actions/checkout@v4`, `setup-node@v4`, Upload-/Download-/Cache-Actions in den Workflows; Daily/Monthly besitzen `contents:write`.
- **Risiko:** Ein kompromittierter oder unerwartet veränderter Major-Tag läuft automatisch mit Schreibrechten.
- **Claude-Prüfung:** Actions auf vollständige Commit-SHAs pinnen und Updates automatisiert pflegen.

### BH-137 — HOCH · T1 — Ein korrupter ATH-State wird als „nicht vorhanden“ geschluckt und friert den Stand still ein

- **Fundstelle:** `scripts/update-ath-state.js:115-120`; zusätzlich fail-soft in `.github/workflows/daily-pull.yml:623-628`.
- **Fehler/Mechanismus:** Jeder Read- oder JSON-Fehler wird als „kein ath-state“ behandelt; das Skript beendet sich erfolgreich ohne Update. Bootstrap und beschädigte committed State-Datei sind ununterscheidbar.
- **Auswirkung:** Ein truncierter State bleibt unbemerkt eingefroren beziehungsweise der Export fällt auf leeren Zustand, ohne Alarm.
- **Claude-Prüfung:** Missing einmalig erlauben, Parse-/Readfehler vorhandener Datei hart stoppen und letzte gute Kopie erhalten.

### BH-138 — HOCH · T1 — Macro-Regime ersetzt bei transientem Preislesefehler den letzten guten Stand durch gültig wirkendes `unknown`

- **Fundstelle:** `scripts/macro-regime.js:71-84`, `:97-111`; Workflow `daily-pull.yml:586-590`; `scripts/write-board-history.js:415-434`.
- **Fehler/Mechanismus:** Bei fehlendem/korruptem SPY-Shard oder leerer Serie schreibt der Producer `regimes:{}, error:no_price_data` über den Feed und beendet sich mit Exit 0; der fail-soft Workflow reicht diese neue leere Generation ans Scoring weiter.
- **Auswirkung:** Ein partieller Preisstore-Ausfall vernichtet den letzten belegten Regimestand und friert `unknown` als scheinbar legitimes PIT-Regime ein.
- **Claude-Prüfung:** Fehlergeneration getrennt publizieren, letzten guten Wert erhalten und im Scoring sichtbar als stale/error markieren.

### BH-139 — KRITISCH · T1 — Ein einziger vorhandener Preis-Shard schaltet auf Shard-Modus und lässt bis zu 31/32 Daten still verschwinden

- **Fundstelle:** `lib/price-history-store.js:96-140`; `scripts/rank-ic.js:492-502`; `scripts/update-ath-state.js:98-107`.
- **Fehler/Mechanismus:** Der Store prüft nur, ob irgendein Shard existiert; jeder fehlende Shard wird zu `{}`. Sobald einer da ist, bleibt der vollständige Legacy-Store ungenutzt. Rank-IC und ATH verlangen nur Gesamtmenge >0 und irgendein Meta.
- **Auswirkung:** Partial-Checkout, abgebrochene Migration oder gelöschter Shard erzeugt false-green Backtests/ATH statt Integritätsfehler. Aktuell sind 32/32 vorhanden; der Trigger ist reproduzierbar, nicht momentan aktiv.
- **Claude-Prüfung:** Exakte 32er-Shardmenge plus Manifest-/Ticker-Reconciliation vor jedem Verbraucher verlangen.

### BH-140 — MITTEL · T1 — Der ausführbare Legacy-Walk-forward misst pensioniertes Scoring, datiert das Ergebnis aber auf heute

- **Fundstelle:** `picks-history/latest.json` (`asOf=2026-07-02`, alte Modi); gelöschte Writer seit Commit `76da291`; README `:59-70`, `:156-184`, `:224-231`; `scripts/walk-forward-perf.js:803-816`.
- **Fehler/Mechanismus:** Daily erzeugt seit 25.06. keine neuen Picks-/Methods-Vintages und ruft Walk-forward nicht auf. README beschreibt die Kette weiter als aktiv; manuelles Ausführen schreibt trotzdem `outJson.asOf=today` über fossilierter Historie.
- **Auswirkung:** Ein Backtest der entfernten Engine kann wie aktuelle Qualitätsmessung aussehen.
- **Claude-Prüfung:** Legacy klar sperren/kennzeichnen oder auf das heutige Board-History-System migrieren; Datenenddatum statt Ausführungsdatum prominent führen.

### BH-141 — HOCH · T1 — Legacy-Walk-forward weist mehrere inkonsistente Stichprobenzähler aus

- **Fundstelle:** `scripts/walk-forward-perf.js:529-530`, `:589-590`, `:655-680`, `:696-735`, `:776-792`, `:833-843`.
- **Fehler/Mechanismus:** `n_evaluated` wird aus allen Picks statt wirklich mit zwei Kursen bewerteten `n` gebildet; Coverage zählt Wochenenddateien als erwartete Geschäftstage; Summary filtert Alpha/TotalPicks auf das Fenster, `vintageCount` jedoch nicht.
- **Auswirkung:** Reporttabellen und zugrunde liegende Messstichprobe divergieren; fehlende Werktagsvintages können maskiert werden.
- **Claude-Prüfung:** Zähler aus derselben evaluierten, zeitgefilterten Stichprobe ableiten.

### BH-142 — HOCH · T2 — Archiv-Rotation entfernt bereits archivierte Historie bei einer korrupten NDJSON-Zeile dauerhaft

- **Fundstelle:** `scripts/archive-old-snapshots.js:103-126`, `:200-202`.
- **Fehler/Mechanismus:** Unparsebare bestehende Zeilen und ganze Readfehler werden als leer/überspringbar behandelt. Danach wird der aus nur gültigen Zeilen plus Neuzugängen rekonstruierte Stand atomar zurückgeschrieben; Runtimefehler enden im Schluss-Catch ebenfalls grün.
- **Auswirkung:** Eine beschädigte Altzeile, deren Original schon gelöscht ist, verschwindet unwiederbringlich und ungemeldet. Der Pfad ist aktuell durch sehr hohe Retention weitgehend inaktiv, aber bereitliegend.
- **Claude-Prüfung:** Korruptes Archiv nie überschreiben; hard fail plus Backup-/Checksum-Vertrag.

### BH-143 — HOCH · T1 — Produktions-Prune hat keine Snapshots; seine Delisting-/Stale-Kernlogik ist in CI unerreichbar

- **Fundstelle:** `.github/workflows/daily-pull.yml:186-205`; `scripts/prune-watchlist.js:82-120`, `:210-217`; Schema `pull-yahoo.js:1986-2005`.
- **Fehler/Mechanismus:** Prune läuft im Prep-Job vor Shard-/Cache-Download. Im frischen Checkout ist nur `snapshots/_manifest.json` getrackt, daher liefert `loadSnapshot` für jeden echten Ticker null. Selbst lokal liest `hasPrice` fälschlich `snap.meta.regularMarketPrice`, während das Schema `snap.price.regularMarketPrice` schreibt.
- **Auswirkung:** Delisted-/DeadReason-/Stalepfade können produktiv nie greifen; die aktive Quote wäre lokal immer falsch klassifiziert. Effektiv laufen nur Symbol- und `added_at`-Regeln.
- **Claude-Prüfung:** Prune gegen den tatsächlichen aktuellen Snapshotkorpus ausführen und Schemafixture für aktive Quote pinnen.

### BH-144 — KRITISCH · T1 — ATH-Max-Backfill kann bei einer korrupten State-Datei fast den gesamten historischen State vernichten

- **Fundstelle:** `scripts/backfill-prices-max.js:46`, `:124-154`; unzureichender Test `tests/ath-state.test.js:83-86`.
- **Fehler/Mechanismus:** Jeder State-Read-/Parsefehler wird zu `{entries:{}}`. Recovery ist auf das momentane Boarduniversum begrenzt; bereits bekannte Ticker außerhalb davon werden nicht rekonstruiert. Nach dem ersten Batch überschreibt der Job die committed Datei atomar mit diesem Teilbestand.
- **Auswirkung:** Einzelne State-Korruption plus normaler Backfill löscht massenhaft ATH-Historie und erzeugt `ath:null`, während der Job grün läuft.
- **Claude-Prüfung:** Korrupte Kopie mit `--tickers X --limit 1`; Schlüsselmenge muss erhalten bleiben und Job hart stoppen.

### BH-145 — HOCH · T2 — Max-Backfill meldet auch einen vollständigen Fetch-Ausfall als Erfolg

- **Fundstelle:** `scripts/backfill-prices-max.js:20-21`, `:140-157`.
- **Fehler/Mechanismus:** Alle Tickerfehler werden nur in `failed` gesammelt; am Ende wird geloggt, aber kein Fehlercode oder Schwellen-Gate gesetzt. Der Header erklärt Teilfehler ausdrücklich als Exit 0.
- **Auswirkung:** Yahoo-Blockade, Schema- oder Netzausfall mit `0 ok, N failed` kann von Operator/Automation als erfolgreicher Seed verbucht werden.
- **Claude-Prüfung:** Stub lässt alle Fetches scheitern; Prozess muss nonzero und State unverändert bleiben.

### BH-146 — HOCH · T1 — Legacy-Walk-forward wählt nicht „backward-first“ und kann zukünftige Kurse als Entry verwenden

- **Fundstelle:** `scripts/walk-forward-perf.js:176-231`, `:380-385`, `:460-476`.
- **Fehler/Mechanismus:** `nearestTradingDay` prüft je Offset abwechselnd rückwärts und vorwärts. Für Sonntag wird Montag +1 gewählt, bevor Freitag −2 geprüft wird. Ein Freitagvormittags-Snapshot wird auf Samstag verschoben und anschließend auf den Freitagsschluss zurückgesnappt – einen nach dem Signal liegenden Kurs. Kommentare behaupten das Gegenteil.
- **Auswirkung:** Echter Look-ahead, Wochenendvorgriff und heterogene Returnfenster im weiterhin ausführbaren Legacy-Report.
- **Claude-Prüfung:** Fixture Freitag/Sonntag/Montag; erst alle erlaubten Rücktage prüfen und Signalzeit gegen Closezeit berücksichtigen.

### BH-147 — HOCH · T2 — Unvalidiertes Board-Vintage-Datum erlaubt PIT-Rückdatierung, Zukunftsdatierung und Pfad-Escape

- **Fundstelle:** `scripts/write-board-history.js:441`, `:460-503`, CLI `:510-518`.
- **Fehler/Mechanismus:** `--date` übernimmt jeden String ohne `YYYY-MM-DD`-, Plausibilitäts-, Today- oder Pfadprüfung und wird direkt mit `path.join(HISTORY_DIR,date)` verwendet.
- **Auswirkung:** Heutige Boards/PIT können als historischer t0 eingefroren werden (Look-ahead-Kontamination); `../foo` kann außerhalb `board-history` schreiben.
- **Claude-Prüfung:** Striktes Datum, zulässiger Backfillvertrag und resolved-path-Guard; absichtlich falsche/future/`..`-Fixtures.

### BH-148 — KRITISCH · T1 — Der präregistriert behauptete Block-Bootstrap ist tatsächlich ein IID-Einzelresampling

- **Fundstelle:** Ledger `:470`; Kopfvertrag `scripts/rank-ic.js:14-15`; `bootstrapCI` `:63`, `:133-152`; Aggregation `:420-443`; Autokorrelation nur `nEff` `:154-160`, `:443-451`.
- **Fehler/Mechanismus:** Eingefroren sind Panel-Block-Bootstrap mit gemeinsamen Zeit-/Querschnittsclustern, Blocklänge 2, B=10.000 und BCa. Der Code resampelt dagegen bereits aggregierte IC-Skalare IID, B=2.000, mit einfachem Perzentilintervall. Lag-1-Autokorrelation beeinflusst nur den Mindestpower-Schalter, nicht Konfidenzintervall oder p-Wert.
- **Auswirkung:** Bei persistenten Board-ICs/Regimeclustern können Intervalle zu eng und BY-p-Werte zu klein werden; LIVE würde zu früh bestätigt.
- **Claude-Prüfung:** Stark positiv autokorrelierte synthetische IC-Reihe gegen Moving-Block-Bootstrap vergleichen und Implementierung an Präregistrierung angleichen.

### BH-149 — HOCH · T1 — „Fenster abgelaufen“ hängt am neuesten Datum irgendeines Tickers statt an Benchmark/Kohorte

- **Fundstelle:** `scripts/rank-ic.js:283-294`, `:411-427`; ungeprüfter Preisindex `scripts/walk-forward-perf.js:104-111`.
- **Fehler/Mechanismus:** Das lexikographische Maximum aller Datumskeys lässt sämtliche Boards reifen. Ein einzelner Zukunftsbar oder ein früher aktualisierter Fremdmarkt reicht; kürzere Kohortenserien geraten anschließend in den problematischen `series_ended`-Pfad.
- **Auswirkung:** Wenige Tage Return können als vollständiger 28-/84-Tage-Punkt eingehen; fehlerhafte Zukunftsdaten können alle Fenster vorzeitig freigeben.
- **Claude-Prüfung:** Kohorte nur bis t0+3 plus Fremdticker t0+84; Ergebnis muss pending bleiben. Reife an kanonischen Benchmark und erforderliche Kohortenabdeckung binden.

### BH-150 — KRITISCH · T1 — Delivery-IC konditioniert auf spätere Board-Zugehörigkeit und entfernt die Aussteiger aus dem Outcome

- **Fundstelle:** `scripts/rank-ic.js:348-360`, `:353-386`.
- **Fehler/Mechanismus:** Die spätere PIT-Map wird ausschließlich aus der Kohorte des späteren Board-Vintages gebaut. Jeder t0-Ticker, der dort nicht mehr geführt wird, wird verworfen – auch wenn spätere Fundamentaldaten anderweitig vorliegen. Eine Attritionsquote wird nicht berichtet.
- **Auswirkung:** Eingebrochenes Wachstum, Delisting, Mapping-/Eligibility-Verlust und Boardausstieg verschwinden systematisch; nur spätere Überlebende prägen Delivery-IC (Survivorship-/Attrition-Bias).
- **Claude-Prüfung:** Eingefrorene t0-Kohorte extern nachverfolgen; A mit hohem Score und späterem Einbruch darf nicht verschwinden, nur weil es aus t1-Board fällt.

### BH-151 — HINWEIS · T3 — Der „residualisierte IC“ ist präregistriert als semi-partielle, nicht volle partielle Korrelation

- **Fundstelle:** `scripts/rank-ic.js:95-130`, `:334-342`, Gate `:446-450`.
- **Methodikhinweis:** Nur Return-Ränge werden gegen die drei Kontrollen residualisiert; anschließend korreliert der Code den **unbereinigten** Score-Rang mit den Return-Residuen. Das Ledger präregistriert genau dieses Vorgehen, daher liegt kein Code-vs.-Vertrag-Bruch vor. Der verkürzte Begriff „residualisierter IC“ kann jedoch mit einer vollen partiellen Rangkorrelation verwechselt werden, die beide Seiten residualisiert.
- **Auswirkung:** Die Kennzahl kann stärker attenuiert sein als ein voller Partial-IC; Interpretation und Schwelle müssen ausdrücklich zur semi-partiellen Definition gehören.
- **Claude-Prüfung:** Bewusste Wahl bestätigen und Begriff/Formel im Ledger/Report eindeutig „semi-partial: Return residualisiert“ nennen.

### BH-152 — HOCH · T1 — History-Kompaktierung kann das Git-Wachstum prinzipiell nicht deckeln

- **Fundstelle:** `scripts/write-board-history.js:365-404`; Masterplan `:67`, `:253`; Ledger `:482`; Full-Checkout `.github/workflows/daily-pull.yml:764-768`.
- **Datenbeleg:** Vintage 18.07.2026: 6.236.345 Byte, davon 5.436.034 Byte Boarddateien. Ein späterer Lean-Rewrite entfernt die bereits committeten Vollblobs nicht aus der Git-Historie. Hochrechnung: rund 1,49 GiB neue Vollblobs je 250 Läufe/Jahr; Scoring lädt mit `fetch-depth:0` täglich die komplette Historie.
- **Auswirkung:** Das bindende `<1 GB gedeckelt`-Ziel ist durch normale Rewrite-Commits unerreichbar; Repo-, Checkout- und Netzlast wachsen weiter.
- **Claude-Prüfung:** 180-Tage-Fixture committen/kompaktieren und `git rev-list --objects --all` beziehungsweise Packgröße messen, nicht nur Working Tree.

### BH-153 — HOCH · T1 — Die implementierte Board-History-Kompaktierung wird im Produktionsworkflow nie aktiviert

- **Fundstelle:** `scripts/write-board-history.js:444-446`, `:510-516`; Aufruf `.github/workflows/daily-pull.yml:882-886` ohne `--compact`.
- **Fehler/Mechanismus:** Nur das CLI-Flag startet `compact()`; außerhalb der Tests gibt es keinen produktiven Caller.
- **Auswirkung:** Selbst die begrenzte Working-Tree-Einsparung der vorhandenen Logik findet nicht statt; die dokumentierte Retention ist rein nominell.
- **Claude-Prüfung:** Workflowargv und reale alte Vintages nach 180 Tagen prüfen; Retention als eigener getesteter Job/Schritt.

### BH-154 — HOCH · T1 — Das angebliche Vollarchiv liegt im Repo-Checkout, ist git-ignoriert und wäre in CI flüchtig

- **Fundstelle:** `scripts/write-board-history.js:48-56`; `.gitignore:106-109`.
- **Fehler/Mechanismus:** `ARCHIVE_DIR=path.join(base,'board-history-archive')`, wobei `base` der Repo-Root ist. Der Pfad liegt damit nicht „außerhalb CI-Checkout“ und wird nicht persistiert.
- **Auswirkung:** Bei künftiger CI-Kompaktierung würde Voll-PIT in einen sterbenden Runner geschrieben, während das getrackte Vintage dauerhaft gestript wird. BH-103 verschärft das zur Messblockade.
- **Claude-Prüfung:** Absoluten Archivpfad und Persistenz über zwei frische Runner verifizieren.

### BH-155 — HOCH · T2 — Selbst Lean-History überschreitet wegen unkompaktierter Kalibrierungs-Sidecars den 1-GB-Deckel

- **Fundstelle:** `scripts/write-board-history.js:381-385`, `:498-503`.
- **Datenbeleg:** `calibration.json` vom 18.07. ist 800.163 Byte und wird täglich kopiert; Sidecars ohne `cohort` überspringt `compact()` ausdrücklich. Lean-Boards etwa 1,54 MB plus 0,80 MB Kalibrierung ergeben rund 558 MB je 250 Läufe im aktiven Baum – über 1 GB in unter zwei Jahren.
- **Auswirkung:** Auch bei aktivierter Kompaktierung bleibt der Working Tree ungebremst und die Kostenannahme falsch.
- **Claude-Prüfung:** Backdate-Fixture inklusive aller Sidecars kompaktieren und Gesamtgröße statt nur Boarddateien messen.

### BH-156 — HOCH · T2 — Ein als `suspect` erkanntes Vintage wird entgegen Masterplan zuerst committed und erst danach rot gemeldet

- **Fundstelle:** Masterplan `:253`; `.github/workflows/daily-pull.yml:895-932`.
- **Widerspruch:** Vertrag: „suspect … nicht committet“. Workflow committed und pusht das Vintage ausdrücklich, bevor er anhand des Status den Lauf scheitern lässt.
- **Auswirkung:** Gerade als potenziell korrupt erkannte Messdaten gelangen dauerhaft in die Historie und können spätere Kalibrierung/Messung kontaminieren.
- **Claude-Prüfung:** Suspect-Fixture; Main-Tree muss vor/nach Lauf identisch bleiben und Kalibrierung darf den Tag nicht sehen.

### BH-157 — KRITISCH · T1 — Rank-IC testet gegen Null statt gegen die eingefrorene Wirkungsschwelle

- **Fundstelle:** Ledger `:472`, `:475`; `scripts/rank-ic.js:150-152`, `:446-450`.
- **Fehler/Mechanismus:** Präregistriert ist eine Konfidenzuntergrenze über Schwelle X. Der Code berechnet den p-Wert gegen 0 und verlangt getrennt nur `mean > X` sowie `CI.lo > 0`.
- **Auswirkung:** Ein Mittel knapp über X mit Intervall weit unter X kann das Belegkriterium passieren; der Test beantwortet eine schwächere Hypothese als behauptet.
- **Claude-Prüfung:** H0/H1 exakt als `effect<=X` testen und Grenzfixture mit `mean>X`, aber `CI.lo<X` ablehnen.

### BH-158 — HOCH · T1 — Rank-IC lässt vorregistrierte MDE- und Size-Kontrolle vollständig aus

- **Fundstelle:** Ledger `:472`, `:475`; Kontrollen `scripts/rank-ic.js:334-340`.
- **Fehler/Mechanismus:** Es gibt keinen MDE-Ausweis. Residualisierung nutzt Beta, EV/Sales und Price/GP, aber nicht das vorgeschriebene log-MarketCap.
- **Auswirkung:** Power/Interpretierbarkeit und Small-/Large-Cap-Konfundierung entsprechen nicht der eingefrorenen Methodik; ein LIVE-Urteil kann auf unvollständigem Pflichtset beruhen.
- **Claude-Prüfung:** MDE als verpflichtenden Output/Gate ergänzen und Kontrollvektor maschinell gegen Präregistrierung abgleichen.

### BH-159 — HOCH · T1 — Jede unbekannte oder neue Formel-ID wird automatisch als CORE ausgeliefert

- **Fundstelle:** `src/scoring/board-status.js:21`, `:28-32`; Governance `CLAUDE.md:38`.
- **Fehler/Mechanismus:** Nur fünf explizite IDs und `quality-*` werden diagnostic; der Default ist `core`. Tippfehler oder neu hinzugefügtes Board umgeht damit den Grundsatz „Neue Methoden starten DIAGNOSTIC“.
- **Auswirkung:** Ungeprüfte Methodik kann ohne Court-/Walk-forward-Beleg als bewiesen im Export erscheinen.
- **Claude-Prüfung:** Erfundene `formulaId` muss fail-loud oder diagnostic liefern; CORE als explizite Allowlist.

### BH-160 — MITTEL · T2 — Der Exportvertrag akzeptiert ein manipuliertes QC-CORE trotz „immer diagnostic“-Regel

- **Fundstelle:** `docs/findash-export-v1.md:244-249`; Validator/Enum-Vertrag des Exportchecks.
- **Widerspruch:** Die Doku erklärt selbst, dass `quality` immer diagnostic sei, aber `core` enum-legal bleibt und `--check` nicht auslöst. Dies ist zusätzlich zur unerreichbaren Promotion in BH-084.
- **Auswirkung:** Ein Producer-/Mappingfehler kann QC als CORE publizieren, ohne den Contract zu brechen.
- **Claude-Prüfung:** Boardtypabhängige Statusinvariante im Validator pinnen oder die Governance eindeutig auf Promotion umstellen.

### BH-161 — HOCH · T1 — `CONTEXT.md` ist bindend erklärt, beschreibt aber einen monatelang veralteten Projektzustand

- **Fundstelle:** Bindung `AGENTS.md:3-4`, `:35-40`; `CONTEXT.md` Stand 18.05./Tag 231.
- **Widerspruch/Datenbeleg:** Kontext nennt 138 ungepushte Commits, 15.734 Ticker, alte Methodenengine, entfernte Tests und künftige Runs 110/111. Aktuell: Tag 355, `main=origin/main`, 11.106 Ticker und neue Scoring-Engine.
- **Auswirkung:** Agenten sollen „exakt“ einer falschen Architektur und falschem Betriebszustand folgen.
- **Claude-Prüfung:** Bindende Quellenhierarchie und Aktualitätsdatum maschinell prüfen; alte Generation ausdrücklich superseden.

### BH-162 — HOCH · T1 — README beschreibt überwiegend eine entfernte Pipeline und tote Befehle

- **Fundstelle:** `README.md:12-16`, `:26-62`, `:78-141`, `:149-248`.
- **Widerspruch:** Methodenregistry, Score-Aggregator, HTML-Dashboards, FCF-Yield, Generatoren/Tests und täglicher 02:00-Cron gehören nicht mehr zur aktiven Engine. Real läuft Daily Dienstag–Samstag 02:17 UTC und das Repo besitzt sechs Workflows.
- **Auswirkung:** Onboarding, Betrieb und manuelle Verifikation führen zu falschen oder nicht vorhandenen Pfaden.
- **Claude-Prüfung:** Jeden dokumentierten Befehl/Pfad gegen HEAD auf Existenz und produktiven Caller prüfen.

### BH-163 — HOCH · T2 — `PROJECT-STATUS.md` stellt den alten Tag-239-Zustand weiter als aktuelle Wahrheit dar

- **Fundstelle:** `PROJECT-STATUS.md:3-17`, `:21-61`.
- **Widerspruch:** Falsches Universum, alte Scorer, fünf gelöschte HTML-Artefakte, tote Skripte und alter Cron sind nicht als historisch/superseded markiert.
- **Auswirkung:** Planung und Claude-Triage können auf erledigte oder entfernte Komponenten gelenkt werden.
- **Claude-Prüfung:** Statusdokument entweder aus HEAD generieren oder mit eindeutiger Archivkennzeichnung aus der Source-of-Truth-Kette nehmen.

### BH-164 — HOCH · T2 — `CLAUDE.md`/`AGENTS.md` erzwingen ein Test-Gate, das 28 Root-/Lib-Tests auslässt

- **Fundstelle:** `CLAUDE.md:23-28`; `AGENTS.md:15-16`, `:53-54`; tatsächlich breiteres CI-Gate `.github/workflows/daily-pull.yml:95-109`.
- **Fehler/Mechanismus:** Die bindende lokale Anweisung nennt nur `tests/scoring/*.test.js`; aktuell liegen zusätzlich 23 Root- und fünf Lib-Tests außerhalb dieses Musters. CI dokumentiert, dass genau diese Klassen früher nicht ausgeführt wurden.
- **Auswirkung:** Agenten können „alle Tests grün“ melden, obwohl ein erheblicher Teil nie lief.
- **Claude-Prüfung:** Ein kanonisches vollständiges Testkommando in Package/CI/Agentregeln verwenden und Dateianzahl ausgeben.

### BH-165 — MITTEL · T2 — Weitere bindende `CLAUDE.md`-Anker zeigen auf nicht vorhandene oder falsche Betriebswege

- **Fundstelle:** `CLAUDE.md:6`, `:21`, `:56`, `:58`.
- **Widerspruch:** Falscher 02:00-Cron, fehlendes `fitness/measure.js`, gelöschte Shared-Registry-Dateien und ein überholtes `/audit`-Verfahren bleiben verbindlich.
- **Auswirkung:** Automatisierte Arbeit kann fehlschlagen oder den falschen Prüfansatz anwenden.
- **Claude-Prüfung:** Alle Pfad-/Command-Anker per Existenz- und Callercheck validieren.

### BH-166 — KRITISCH · T1 — Der aktive `/audit`-Command weist zu Outcome-Tuning an alten Ankertickern an

- **Fundstelle:** `.claude/commands/audit.md:9-30`, `:163-198`, `:308-309`.
- **Fehler/Mechanismus:** Command erzwingt alte Zeit-/Commit-/Methodenquoten, repariert über entfernte Architektur und verlangt Schwellen ausdrücklich so zu wählen, dass Anker hinein und Quarantänetitel heraus kommen. Zusätzlich enthält er tote Pfade und festen Tag 199.
- **Auswirkung:** Bei Ausführung entstehen Label-Leakage, Einzelticker-Overfit und falsche grüne Audits statt out-of-sample Qualitätsprüfung.
- **Claude-Prüfung:** Command bis methodischer Neufassung sperren; keinerlei Zielmitgliedschaft einzelner Titel als Kalibrierungsziel zulassen.

### BH-167 — HOCH · T1 — `.claude/commands/screener.md` ist falsch benannt, veraltet und kann ungefragt Dependencies installieren

- **Fundstelle:** `.claude/commands/screener.md` insbesondere `:22-23`; Datei heißt `/screener`, Inhalt behauptet `/goal`.
- **Fehler/Mechanismus:** Falscher Benutzerpfad, ungefragte Playwright-Installation, Bewertung/FCF/Damodaran, alte Methodenarchitektur und fester Tag 176. Macro/Technik werden verboten, obwohl die aktuelle Pipeline Macro/ATH bewusst nutzt.
- **Auswirkung:** Ein vermeintlicher Screenerlauf kann Setup verändern und methodisch die falsche Generation bearbeiten.
- **Claude-Prüfung:** Command aus aktiver Befehlsliste entfernen oder vollständig auf heutige read-only/run-Verträge neu schreiben; Installation nie implizit.

### BH-168 — HOCH · T2 — Repo-lokale Audit-Skills prüfen die entfernte Architektur und nur einen Teil der Workflows

- **Fundstelle:** Repo-Skills `full-audit`, `methods-audit`, `workflow-audit`.
- **Fehler/Mechanismus:** Sie suchen u. a. `methods/index.js`, Runner, Score-Aggregator und Tag28; Workflow-Audit liest nur zwei von sechs Workflows und nimmt ein falsches 180-Minuten-Modell an.
- **Auswirkung:** Gerade ein offizieller Audit kann scheitern oder falsches Grün melden – der vom Nutzer angezweifelte Pipeline-Audit deckt deshalb nicht das Gesamtprojekt.
- **Claude-Prüfung:** Skills gegen aktuellen File-/Workflowgraph testen und Version/Abdeckung als Output erzwingen.

### BH-169 — HOCH · T2 — Threshold-Policy empfiehlt hartkodierte Einzelticker-Ausnahmen und Literaturänderungen ohne Walk-forward

- **Fundstelle:** `docs/threshold-discipline.md:7`, `:17-23`, `:34-41`, `:56-65`.
- **Fehler/Mechanismus:** Doku empfiehlt explizite ExcludeLists/Whitelists für IONQ/NVDA und erlaubt Literatur allein als Begründung für Schwellenänderung ohne Walk-forward/Gauntlet.
- **Auswirkung:** Direkter Widerspruch zum Hardcoded-Ticker-Verbot; fördert Outcome-Leakage und nachträgliches Passendmachen.
- **Claude-Prüfung:** Policy unter Präregistrierung/Nullmodellen neu schreiben; keine Tickeridentität darf Regelparameter bestimmen.

### BH-170 — MITTEL · T2 — Alte Verbesserungspläne bleiben als aktive Prioritäten statt als superseded markiert

- **Fundstelle:** `IMPROVEMENT-PLAN-2026-06-10.md`; `screener-improvement-spec-2026-05.md`; Phase-1-Plan.
- **Widerspruch:** Offene Checkboxen fordern entfernte Architektur, Bewertungssignale und falsche Pfade.
- **Auswirkung:** Agenten können bereits verworfene Arbeit wiederbeleben oder gegen falsche Akzeptanzkriterien prüfen.
- **Claude-Prüfung:** Historische Pläne mit Statusbanner/Replacement-Link versehen und aus aktiver Queue trennen.

### BH-171 — MITTEL · T2 — ADR-001 bleibt „Accepted/weiter offen“, obwohl seine referenzierte Legacy-Schicht entfernt ist

- **Fundstelle:** `docs/decisions/ADR-001-retire-track-a-b-scoring.md:67-86`.
- **Widerspruch:** Architekturentscheidung und Aufgabenstatus passen nicht mehr zur vorhandenen Engine.
- **Auswirkung:** Ein Accepted-ADR kann fälschlich als bindender Implementierungsauftrag gelesen werden.
- **Claude-Prüfung:** ADR mit Superseded-Status und Nachfolgerentscheidung verknüpfen.

### BH-172 — MITTEL · T2 — Fabless-v5.2-Spezifikation ist durch fehlende Referenzimplementierung nicht mehr verifizierbar

- **Fundstelle:** `docs/formula-spec-fabless-ai-connectivity-v5.2.md:3-10`, `:66`; referenzierte `court-screen.js`, `court-score.js`, `court-score-tests.js` fehlen.
- **Widerspruch:** Spec bindet ihre Definition/Verifikation an Dateien, die aktuelle Main-Engine konsumiert den beschriebenen Pfad nicht.
- **Auswirkung:** Niemand kann aus der vermeintlich aktiven Spec zweifelsfrei ableiten, was noch gilt.
- **Claude-Prüfung:** Status/Supersession und heutigen Formelhash/Tests verknüpfen.

### BH-173 — HOCH · T1 — Masterplan-Kopf enthält gleichzeitig gegensätzliche Aussagen zur alten Formel

- **Fundstelle:** Masterplan `:15-16`; eigener Worklog `:579`.
- **Widerspruch:** Eine Zeile sagt, die alte Formel zeigte CRDO/ALAB; die nächste sagt „NIE“. Worklog belegt die NIE-Prämisse als git-falsch.
- **Auswirkung:** Zentrale Problemdiagnose und daraus abgeleitete Weichen beruhen je nach gelesener Zeile auf entgegengesetzter Historie.
- **Claude-Prüfung:** Historische Behauptung aus Commitartefakten festschreiben und Gegenbehauptung entfernen/erklären.

### BH-174 — HOCH · T1 — Masterplan/Queue behaupten ungepushte Fixes und offenen Carry, obwohl HEAD vollständig gepusht ist

- **Fundstelle:** Masterplan `:81`, `:95-105`; Queue `:24-27`; Git: HEAD=origin/main, Tags 333–355, Tag 349 „Carry C6“.
- **Auswirkung:** Folgephasen oder Freigaben können wegen eines nicht mehr existierenden Zustands unnötig blockiert werden.
- **Claude-Prüfung:** Statusaussagen automatisch gegen Git-Refs/Taglog prüfen und alle Querverweise nachziehen.

### BH-175 — MITTEL · T2 — Dieselbe Entscheidungs-ID bezeichnet zwei unterschiedliche Weichen

- **Fundstelle:** `_KARL-ENTSCHEIDE.md:24` versus `:181`, `:190`, `:205`.
- **Fehler:** `E-20260717-5` ist einmal Push-Freigabe für Tags 333–348/Findash und einmal entschiedener Kalibrier-Gauntlet/Heavy-Slot.
- **Auswirkung:** Status, Verweise und Claude-Handoff sind nicht eindeutig zuordenbar.
- **Claude-Prüfung:** Alle E-IDs auf Eindeutigkeit und tatsächliche Commit-/Entscheidungszuordnung prüfen.

### BH-176 — NIEDRIG · T3 — Masterplan verletzt seine eigene Kopf-Hygieneregel

- **Fundstelle:** Regel Masterplan `:558`; Kopf enthält 18 statt ungefähr acht aktuelle Statusbullets und den eigenen Hinweis „Prune fällig“.
- **Auswirkung:** Der wichtigste aktuelle Status wird durch überzählige/stale Punkte unübersichtlich; Widersprüche BH-173/174 bleiben leichter unentdeckt.
- **Claude-Prüfung:** Kopf auf kanonische aktive Weichen begrenzen, Historie in Worklog.

### BH-177 — MITTEL · T2 — Weitere Masterplan-Statuszeilen widersprechen Taskzustand

- **Fundstelle:** Masterplan `:89`, `:241`.
- **Widerspruch:** 2.3 soll erst nach 2.14 laufen, obwohl 2.3 bereits implementiert ist; 2.2 ist „KOMPLETT“, enthält aber weiter „Offen: Spalte im findash-Tab anzeigen“.
- **Auswirkung:** Fortschritt und Blocker erscheinen je Einstiegspunkt unterschiedlich.
- **Claude-Prüfung:** Pro Task Status, offene Punkte, Phasentabelle und Abhängigkeiten gemeinsam aktualisieren.

### BH-178 — HOCH · T1 — Das Formel-Ledger mischt alte und neue Generation als eine „zentrale lebende Wahrheit“

- **Fundstelle:** `screener-formel-ledger.md:1-10`, erst `:1063-1077` Wechsel zur neuen Engine.
- **Widerspruch:** Kopf nennt falschen Karlr-Pfad, alte SaaS-/Fabless-Formeln und lokalen ungepushten Branch; alte und neue Formelgeneration sind nicht sauber superseded.
- **Auswirkung:** Methodikreview kann alte Regeln als heute bindend behandeln oder umgekehrt neue Pflichten übersehen.
- **Claude-Prüfung:** Kanonische aktive Generation an den Anfang, historische Abschnitte unverwechselbar archivieren und Formeln versionieren.

### BH-179 — MITTEL · T2 — Findash-Retention-Doku nennt falschen Speicherpfad, vertauschte Tasks und nicht implementierte Löschung

- **Fundstelle:** `docs/findash-export-v1.md:208`, `:210`, `:220-222`.
- **Widerspruch:** Doku nennt `findash-export/history/...`, real ist es `board-history/...`; Taskbindungen XBRL 2.2/prices-max 4.1 sind vertauscht; sie verspricht rollierende Löschung bei 1 GB, während Masterplan Archiv+Kompaktierung und Code gar keinen automatischen Lauf haben.
- **Auswirkung:** Betrieb/Retention kann an falschem Pfad geprüft und fälschlich als erfüllt gemeldet werden.
- **Claude-Prüfung:** Doku direkt aus produktivem Writer-/Workflowvertrag ableiten.

### BH-180 — MITTEL · T3 — Gemeinsame Export-Contract-Fixture lässt Pflichtfelder aus

- **Fundstelle:** `docs/findash-export-v1.contract.json:5-6`; Doku `:4`; Writer `scripts/write-findash-export.js:62-64`.
- **Fehler:** `cohortN` und `cohortFallback` sind als Pflicht markiert, fehlen aber in der Shared-Fixture (bekannt als R-Gate-F7, weiter offen).
- **Auswirkung:** Producer und Consumer können bei diesen Feldern auseinanderdriften, obwohl der Fixture-Hash grün bleibt.
- **Claude-Prüfung:** Vollständige Schemafeldmenge maschinell zwischen Doku, Fixture, Writer und Consumer vergleichen.

### BH-181 — MITTEL · T3 — „Yahoo Pull (single)“ startet tatsächlich den kompletten 11.106-Ticker-Pull

- **Fundstelle:** `package.json:10`; `.claude/launch.json:17-19`; `pull-yahoo.js:2987-3001`.
- **Fehler/Mechanismus:** Launcher übergibt die volle Watchlist, anderes Outputverzeichnis und 100-ms-Rate; der Puller kennt keinen Single-/Tickerfilter.
- **Auswirkung:** Ein vermeintlicher Einzeltest verursacht sehr lange Laufzeit und hohe freie API-Last.
- **Claude-Prüfung:** ParseArgs/PullAll-Fixture muss exakt einen expliziten Ticker ausweisen oder Launcher eindeutig umbenennen.

### BH-182 — HOCH · T2 — `pull-yahoo.js --help` startet einen echten Voll-Pull

- **Fundstelle:** `pull-yahoo.js:2987-3001`; bereits eingetretener Vorfall im Masterplan `:584`.
- **Fehler/Mechanismus:** Unbekannte Flags werden ignoriert, `--help` ist nicht implementiert. Der dokumentierte Versuch startete bereits einen Vollabruf und wurde nach etwa zehn Sekunden gestoppt.
- **Auswirkung:** Harmlos erwartete Hilfe kann Arbeitsdaten/Manifest mutieren und den kompletten freien Yahoo-Abruf beginnen.
- **Claude-Prüfung:** Nur Parser/Quelltext testen, keinen echten Aufruf; unbekannte Flags nonzero, Help ausschließlich Text/Exit 0.

### BH-183 — NIEDRIG · T3 — Eine Kontext-Architektur-Spec behauptet weiter, die inzwischen vorhandenen Agentdateien existierten nicht

- **Fundstelle:** `docs/superpowers/specs/2026-06-20-claude-md-context-architecture-design.md:13-18`.
- **Widerspruch:** Spec sagt, es gebe keine `CLAUDE.md` und screener-data habe keine `AGENTS.md`; beides existiert und ist bindend.
- **Auswirkung:** Historische Architekturarbeit ist nicht als erledigt/superseded erkennbar.
- **Claude-Prüfung:** Archivbanner mit Erledigt-Datum und Nachfolgerquellen.

### BH-184 — HOCH · T2 — Teilkorruptes ATH-Entry wird still zu einem bloßen 400-Tage-Hoch „repariert“

- **Fundstelle:** `scripts/update-ath-state.js:49-78`, `:83-91`.
- **Fehler/Mechanismus:** Entry-Schema wird nicht validiert. Bei `ath:null` greift JS-Zahlkoercion in `b.close > out.ath`; aus dem rollenden Preisstore kann so ein neuer Wert entstehen. Fehlen `refDate/refClose`, ist auch der Split-Wächter aus. `displayFor` akzeptiert das Resultat als Lebenszeit-ATH.
- **Auswirkung:** Ein parsebares, aber unvollständiges Entry wird ohne `needsReseed` als valider ATH-Abstand angezeigt.
- **Claude-Prüfung:** `advanceEntry({ath:null,needsReseed:false}, 400d-Serie)` muss invalid/reseed statt gültigem ATH liefern.

### BH-185 — HOCH · T1 — Legacy-Walk-forward entfernt delistete/ausgelaufene Titel vollständig aus Strategie und Benchmarks

- **Fundstelle:** `scripts/walk-forward-perf.js:293-310`, `:327-345`, `:501-520`; `forward-returns.classify` wird dort nicht verwendet.
- **Fehler/Mechanismus:** Fehlt `p1`, wird Return null und der Titel weder in Picks-, Universe- noch Frozen-Benchmark-Verteilung gepusht. Exitgrund/-verlust bleibt unklassifiziert.
- **Auswirkung:** Totalausfälle verschwinden aus der Rendite; selektionsabhängige Attrition verzerrt Alpha. Der Pfad ist verwaist, wird aber laut BH-140 weiter als aktiv dokumentiert und ist ausführbar.
- **Claude-Prüfung:** Ticker mit Crash und anschließendem Serienende darf nicht kommentarlos aus Median/Benchmarks verschwinden.

### BH-186 — MITTEL · T2 — Legacy-Preisstalenztoleranz kann bis zu zwölf statt dokumentierter sieben Kalendertage betragen

- **Fundstelle:** `scripts/walk-forward-perf.js:217-231`, `:272-282`, Benchmark `:380-385`.
- **Fehler/Mechanismus:** Benchmarkziel wird erst bis zu fünf Tage verschoben; vom bereits verschobenen kanonischen Datum darf der Ticker nochmals sieben Tage zurückfallen. Gegen das ursprüngliche Ziel gibt es keine Endprüfung.
- **Auswirkung:** Feiertage/Wochenenden plus dünner Handel erzeugen deutlich ältere Entry-/Exitkurse als der Vertrag ausweist.
- **Claude-Prüfung:** Originalziel, kanonisches Benchmarkdatum und Tickerbar gemeinsam auf maximal zulässiges Gesamtalter prüfen.

### BH-187 — MITTEL · T2 — Legacy-Regimeattribution nutzt Snapshot- statt Entrydatum und erbt bis zu 30 Tage alte Labels

- **Fundstelle:** `scripts/walk-forward-perf.js:414-443`.
- **Fehler/Mechanismus:** Obwohl `entryDate` berechnet wird, fragt `macroRegime` mit `asOf` ab; `getRegimeAt` übernimmt bis 30 Tage zurück ohne den 7-Tage-Stale-Vertrag des neuen Writers.
- **Auswirkung:** Trades an Regimewechseln landen im Vorregime und stale Macrohistorie kontaminiert `regimeAlpha`.
- **Claude-Prüfung:** Regimewechsel zwischen asOf/Entry sowie 20 Tage alte letzte Beobachtung müssen korrekt auf Entry/unknown abgebildet werden.

### BH-188 — HOCH · T1 — Legacy-Returnfunktion akzeptiert nichtpositive Exitkurse und erzeugt Renditen unter −100 %

- **Fundstelle:** `scripts/walk-forward-perf.js:165-168`, Verbraucher `:308-310`, `:342-345`, `:519-520`; Datenbasis BH-051.
- **Fehler/Mechanismus:** Nur `p0<=0`, nicht `p1<=0`, wird abgewiesen. Der Store enthält 19.774 nichtpositive Bars; fünf betroffene Ticker liegen sogar in Legacy-Picks (AHICF, PIKQF, JGCCF, SMRGF, ICTEF).
- **Auswirkung:** `returnPct(10,-5)` wird zu −150 % statt DQ-Fall und fließt in Median/Alpha.
- **Claude-Prüfung:** Beide Preise endlich und strikt positiv verlangen; Altbars separat säubern/klassifizieren.

### BH-189 — MITTEL · T2 — Exit-Staleness nutzt für alle Weltbörsen nur einen US-ähnlichen Mo–Fr-Kalender

- **Fundstelle:** `scripts/walk-forward-perf.js:67-81`; `lib/forward-returns.js:113-120`.
- **Fehler/Mechanismus:** Business-Days kennt weder Exchange noch lokale Feiertage. LSE, ASX, TSE und US werden identisch gezählt.
- **Auswirkung:** `exitStaleDays` und >2-Tage-Flag sind je Venue falsch. Rank-IC ignoriert das Flag ohnehin (BH-112), aber selbst eine spätere Nutzung wäre nicht belastbar.
- **Claude-Prüfung:** Venue-Kalender-/Sessionlogik oder robuste tatsächliche Handelstage je Serie verwenden.

### BH-190 — KRITISCH · T1 — Archiv-Deduplizierung per Datum vernichtet korrigierte Vintages desselben Datums

- **Fundstelle:** `scripts/archive-old-snapshots.js:100-117`.
- **Fehler/Mechanismus:** Ein vorhandener parsebarer Datumskey gilt ohne Inhalts-/Hashvergleich als identisch. Ist das Datum schon im Archiv, wird die korrigierte Live-Datei danach gelöscht, während die alte Archivversion bestehen bleibt.
- **Auswirkung:** Backfill/Korrektur kann dauerhaft verloren gehen.
- **Claude-Prüfung:** Archiv D/v1 plus Live D/v2; entweder Versionierung/Hashkonflikt hard fail, nie still v1 behalten und v2 löschen.

### BH-191 — HOCH · T2 — Archiv-Merge besitzt trotz atomarem Rename keinen Lock und verliert parallele Updates

- **Fundstelle:** `scripts/archive-old-snapshots.js:103-126`, `:136-156`.
- **Fehler/Mechanismus:** Zwei Prozesse lesen denselben Stand, bauen getrennte Maps und ersetzen dieselbe Datei; last writer wins. Beide können danach ihre Sicht verifizieren und jeweilige Originale löschen. Rename verhindert halbe Datei, nicht TOCTOU/Lost Update.
- **Auswirkung:** Einer von zwei neuen Vintage-Sätzen kann aus Archiv und Quelle verschwinden. In heutigen getrennten CI-Runnern ist das gitignorierte Archiv ohnehin nicht geteilt; lokal oder bei künftiger persistenter Ablage ist es real.
- **Claude-Prüfung:** Zwei Prozesse nach Read barriern; Lock/CAS oder append-only Hashjournal verlangen.

### BH-192 — HOCH · T1 — Verschwundene Hypergrowth-Boards werden aus alten Dateien mit neuem Zeitstempel wiederbelebt

- **Fundstelle:** `src/scoring/run-screener.js:178-207`; `scripts/write-findash-export.js:53-57`, `:141-152`, `:294-305`; `scripts/write-board-history.js:455-475`.
- **Fehler/Mechanismus:** Scoring überschreibt nur aktuell erzeugte Branches, löscht aber keine alten Dateien in `outputs/hypergrowth/` und `full/`. Der Exportwriter liest anschließend eine feste 13er-Liste und versieht jede noch vorhandene Altdatei mit heutigem `generated_at`; der Historywriter friert sie erneut ein. QC räumt seinen Ordner dagegen indexgeführt auf.
- **Auswirkung:** Ein heute vollständig entfallenes oder nicht mehr erzeugtes Board kann morgen weiter als frisch und historisch beobachtet erscheinen.
- **Claude-Prüfung:** Vorhandenes Board in Lauf 1, in Lauf 2 absichtlich kein Output; Export/History müssen es entfernen oder explizit als fehlgeschlagen markieren, nie neu datieren.

### BH-193 — HOCH · T1 — `NaN` aus Umgebungsvariablen schaltet Universe-Gates aus oder entfernt alle beantworteten Auslandskandidaten

- **Fundstelle:** `refresh-universe.js:330-388`, `:734-743`, `:763-792`; `discovery/mcap-prefilter.js:20`, `:60-82`.
- **Fehler/Mechanismus:** `MIN_DISCOVERY_SOURCES`, `MIN_DISCOVERY_CANDIDATES`, `MAX_UNIVERSE`, `FOREIGN_NULLMCAP_SLOTS` und `MCAP_PREFILTER_MIN_USD` werden ohne `Number.isFinite`-/Bereichsprüfung übernommen. Mit `foo→NaN` sind Mindestvergleiche immer false; `usd >= NaN` ist ebenfalls immer false, worauf der Aufrufer alle beantworteten Auslandskandidaten entfernt.
- **Auswirkung:** Ein Tippfehler kann Schutzgates vollständig deaktivieren oder eine Kandidatenklasse massenhaft löschen, ohne Konfigurationsfehler zu melden.
- **Claude-Prüfung:** Für jede numerische Env `foo`, negativ, null und Infinity als Parserfixture; invalid muss vor Datenarbeit nonzero stoppen.

### BH-194 — MITTEL · T1 — Fehlerhaftes `--shard` fällt still auf einen echten Voll-Pull zurück

- **Fundstelle:** `pull-yahoo.js:2987-3001`, `:3024-3032`.
- **Fehler/Mechanismus:** `--shard 0/0`, `x/17` und ähnliche Werte erzeugen nur eine Warnung und lassen `args.shard=null`; anschließend wird die komplette Watchlist verarbeitet.
- **Auswirkung:** Tippfehler in manuellem/Matrix-Aufruf startet unbemerkt einen 11.106-Ticker-Pull statt eines kleinen Shards.
- **Claude-Prüfung:** Ungültige Shardformate müssen nonzero stoppen; „kein Flag“ und „invalides Flag“ strikt unterscheiden.

### BH-195 — MITTEL · T1 — `filter-config.json` bezeichnet sich als aktive Tuning-Schicht, besitzt aber keinen produktiven Leser

- **Fundstelle:** `filter-config.json`; vollständige Codesuche findet Treffer nur in historischen Dokumenten.
- **Fehler/Mechanismus:** Datei fordert dazu auf, R40-/RX-Schwellen und UI-Tabs hier statt in Methoden zu ändern; Produktcode lädt sie nirgends.
- **Auswirkung:** Bewusste Konfigurationsänderungen bleiben wirkungslos, obwohl die Datei einen aktiven Vertrag verspricht.
- **Claude-Prüfung:** Entweder Loader/Schema/Tests nachweisen oder Datei eindeutig archivieren/superseden.

### BH-196 — MITTEL · T2 — Unterschiedliche Ticker können auf denselben Snapshot-Dateinamen normalisiert werden

- **Fundstelle:** `lib/snapshot-fs.js:36-60`; `watchlist-cli.js:44-61`, `:121-141`; `scripts/prune-watchlist.js:64-74`; Toleranz `scripts/merge-shard-manifests.js:94-111`.
- **Fehler/Mechanismus:** Jedes nicht erlaubte Zeichen wird zu `_`, ohne Kollisionsregister: `ABC/A` und `ABC:A` ergeben beide `ABC_A.json`. Manuelle Watchlistpfade lassen solche kurzen Symbole zu; Merge toleriert bis `max(25,0,5 %)` Differenz.
- **Auswirkung:** Ein Titel kann einen anderen Snapshot überschreiben und die kleine Kollision bleibt innerhalb des erlaubten Reconciliation-Fensters. Aktuell sind alle 11.106 Dateinamen eindeutig; Trigger ist erreichbar, aber nicht aktiv.
- **Claude-Prüfung:** Kanonisierung injektiv machen oder Originalticker/Hash im Dateivertrag prüfen; Kollisionsfixture hard fail.

### BH-197 — NIEDRIG · T1 — Dokumentiertes SEC-`--concurrency`-Argument hat keinerlei Wirkung

- **Fundstelle:** `pull-sec-xbrl.js:21`, `:52-69`, serielle Schleife ab `:153`.
- **Fehler/Mechanismus:** CLI dokumentiert und parst die Parallelität; der Wert wird im eigentlichen Abruf nicht benutzt und der Code arbeitet weiterhin seriell.
- **Auswirkung:** Operatoren glauben Laufzeit/Last zu steuern, tatsächlich ändert das Argument nichts.
- **Claude-Prüfung:** Entweder Option entfernen/als reserviert kennzeichnen oder Concurrency mit Rate-/Politeness-Test implementieren.

### BH-198 — NIEDRIG · T1 — Negatives `run-screener --topN` erzeugt plausibel aussehende „alle außer N“-Boards

- **Fundstelle:** `src/scoring/run-screener.js:319-323`; `src/scoring/score.js:925-991`.
- **Fehler/Mechanismus:** `topN` wird weder auf Endlichkeit noch positiven Bereich geprüft. Ein negativer Wert gelangt in `slice(0,topN)` beziehungsweise `slice(0,topN*2)` und bedeutet in JavaScript „alles bis N vom Ende“.
- **Auswirkung:** Der Lauf bleibt grün und schreibt falsch dimensionierte Boards statt einer begrenzten Topliste.
- **Claude-Prüfung:** `--topN -1`, 0, NaN, Infinity als CLI-Fixtures; nur positive ganze Zahl zulassen.

## Abgewiesene oder zusammengeführte Rohfunde

_Hier werden wichtige False Positives und Duplikate dokumentiert, damit Claude die Triage nachvollziehen kann._

- **Kein genereller JSON-Korruptionsfund:** Alle 405 getrackten JSON-Dateien (rund 1,03 GB) ließen sich parsen. Ein doppelter Latest-/Datumsstand ist durch das aktuelle Ablagemodell erwartet und wurde nicht als Bug gezählt.
- **Keine pauschale Preisstore-Unsortiertheit/Future-Dates:** Im Vollscan der 5.204.742 Bars wurden keine allgemeinen Duplikat-, Sortier- oder Zukunftsdatumsfehler gefunden. Die spezifischen nichtpositiven/Phantom-/ASX-Probleme bleiben BH-001, BH-002, BH-051 und BH-188.
- **Saudi-Sonntage nicht als Wochenende-Fehler gezählt:** Sonntag kann dort reguläre Session sein; nur das reproduzierbare ASX-UTC-Muster ging in BH-002 ein.
- **Lokale ignorierte Snapshot-Frische nicht als Produktionsbeweis verwendet:** Der Workspace-Cache kann absichtlich älter als Pages/CI sein. Aktuelle Produktionsaussagen stützen sich stattdessen auf Run `29631632950`, Main-/Pages-Trees und publizierte Artefakte.
- **Stales SEC-Hilfsmanifest nicht eigenständig gezählt:** `_manifest-full` ist ohne nachgewiesenen Consumer kein Produktfehler. Gezählt wurden nur die belegten fehlenden Producer-/Store-/PIT-Verträge BH-004 bis BH-011.
- **Scheinbar fehlende JavaScript-Imports verworfen:** Die statischen Treffer lagen in Kommentaren/Beispielen; alle tatsächlich referenzierten Workflow-Skripte existieren.
- **Index-/Top-N-Zähler nicht pauschal als inkonsistent gewertet:** Begrenzte Boardexports sind beabsichtigt. Nur die irreführende UI-Bezeichnung „Universum“ wurde als BH-095 aufgenommen.
- **Rohduplikate zusammengeführt:** Live-Universumstestlücke → BH-003; QC-Promotion-Widerspruch → BH-084/BH-160; Coverage-Ende-zu-Ende-Kette bewusst in Producer-Handoff BH-118, Alarmexit BH-126 und Consumeranzeige BH-089 getrennt; ATH-Einzelfrische → BH-129; Rank-IC-FDR/Residual-Power → BH-107; Exportdateizahl/Boardzahl → BH-086.
- **Archiv-Exit-0 nicht doppelt gezählt:** Der in der Schlusswelle erneut gefundene Top-Level-Catch plus `continue-on-error` ist bereits Bestandteil von BH-142; BH-190/BH-191 sind die davon getrennten Datum-/Parallelitätsverluste.
- **Keine fremde Config-Regel importiert:** Das im Market-Structure-Projekt geforderte `configs/default.yaml` ist kein Screener-Vertrag und wurde hier nicht als Fehler gewertet.
- **Keine pauschale Supply-Chain- oder Totcode-Zählung:** Aktive Installationen verwenden überwiegend `npm ci`, Lockfile-Integritäten sind vorhanden. Nicht produktiv aufgerufene Diagnose-/Einmalskripte und `ki-infra.json` wurden ohne falsches Aktivversprechen nicht automatisch als Bug gewertet; mutable Action-Tags bleiben der konkrete BH-136.
- **Theoretische Finite-Asymmetrie verworfen:** Hypergrowth prüft nicht dieselbe `assertFinite`-Option wie QC, aber ohne nachgewiesenen Entstehungspfad für nichtendliche Werte wurde daraus kein separater Fund konstruiert.
- **Grüne Tests nicht als Fehler, aber auch nicht als Entwarnung:** Dependency-Audit meldet null bekannte Vulnerabilities; 57 Screener-Pre-Pull-Testdateien und 573 Findash-Tests liefen grün, ebenso der Findash-Build. Nur konkrete False-Green-Lücken wie BH-003, BH-035, BH-099, BH-122 und BH-164 wurden gezählt.

## Abdeckungsnachweis

- **Projektverfassung und Wahrheitsquellen:** `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, README, Status-/Masterplan-/Entscheidungs-/Ledgerdateien, ADRs, Formel-/Contract-/Retention-Dokumente, aktive `.claude/commands` und repo-lokale Audit-Skills.
- **Produktionscode:** sämtliche relevanten JS-Entry-Points, Bibliotheken, Dateisystem-/Schemahelfer, Configpfade, Puller/Enricher/Universe-/Preis-/SEC-/Altdata-/History-/Backtest-/Exportskripte.
- **Scoring/Methodik:** Engine, Formeln, Boardrouting/-status, Kalibrierung, Coverage, Point-in-Time, Delivery-/Rank-IC-, FDR-, Nullhypothesen-, Retention- und Versionslogik.
- **Automationen/State:** alle aktiven GitHub-Workflows, Concurrency, Caches, Artefakthandoffs, Main-/Pages-Deploys, Heartbeat, Watcher, Marker, Baselines und reale aktuelle Run-/Tree-Belege.
- **Datenplausibilität:** Watchlist/Metadaten, getrackte JSON-Verträge, aktueller Preisstore, Board-History, erlaubte externe Stores und publizierte Exportartefakte; große Bestände wurden mechanisch vollständig gescannt, Detailwerte stichprobenartig gegen Consumer geprüft.
- **Consumer:** Geschwisterprojekt `findash` – Sync, Contract/Reader/API, aktuelles React-Frontend, Filter/Mapper/Alarm-/Statuslogik, Backendtests und Build.
- **Tests/Negative Space:** vorhandene Testabdeckung, Skip-/Fail-open-Verhalten, tote Commands/Pfade, CLI-Exitcodes, unbekannte Flags, Korruptions-/Partial-/Zeit-/Pfadgrenzen und False-Positive-Gegenproben.
- **Bewusst ausgeschlossen:** `data/lockbox/**` und `data/validation/**` wurden nie gelesen; ebenso keine Secrets/`.env`-Inhalte, keine kostenpflichtigen APIs, keine schreibenden Live-Pulls und keine generierten Dependency-Verzeichnisse. Diese Grenzen sind Sicherheits-/Methodikvorgabe, keine behauptete Abdeckung.
