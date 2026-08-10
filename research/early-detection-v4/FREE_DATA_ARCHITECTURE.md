# Kostenfreie Datenarchitektur der Früherkennungsstudie V4

Stand: 10. August 2026

## Aktueller Prüfstand

Der kostenlose Point-in-Time-Unterbau ist inzwischen deutlich weiter als der
ursprüngliche Bootstrap, aber noch nicht auswertungsbereit. Der kompakte
SEC-FSD-Index enthält 127 unveränderte Quellpayloads von `2009q1` bis `2024q4`,
1.097.249 Einreichungen, 308.848.369 Fakten, 102.628.203 Darstellungszeilen und
9.709.074 Tagzeilen. Der vollständige Integritätsaudit prüfte den gesamten Stand:
jede Rohdatei, Observation, ZIP-CRC, Fremdschlüsselbeziehung, physische
Zeilenzahl und gespeicherte Zeilenhashfolge stimmten. Er endete mit
`PASS_FULL_INTEGRITY`, null Fehlern und dem Evidenzhash
`69bc58ee84bf936e25a5d0d56699dff6d588b34500a5d51ef68aba2bf9c937de`.
Der Berichtshash lautet
`9b2b660bd0d5cc65b49618a2e4a119359e33c07891d045817e2d41a000a1885f`.

Der getrennte append-only Gesamtcheckpoint schliesst inzwischen auch die
Revisions- und Originalfiling-Luecke. Er rehasht 952 Observationen, 794
verschiedene Payloads mit 12.930.873.291 Bytes, alle 178 gueltigen archivierten
SEC-FSD-Revisionen von `2009q1` bis `2024q4` sowie 178.601
Originalfiling-Ereignisse. Die Originalpopulation umfasst 18.317 Form-8-A-,
115.932 EFFECT- und 44.352 Form-25/15-Ereignisse; 101.881 verschiedene
Originalfiling-Dateien wurden bytegeprueft, drei EFFECT-Ereignisse bleiben als
explizite `NOT_FOUND`-Quellbefunde erhalten. Der signierte Checkpoint ist ueber
Commit `4055c8a2212cc4ce691fc319826b960b58b0544c` bytegleich an den autorisierten
`origin/main`-Stand `221503a3f6d64ba13a841e96832653f52cf39733`
gebunden. Damit ist `appendOnlySecStore` technisch gruen; der unabhaengige
menschliche Audit bleibt als eigenes Ausfuehrungsgate rot.

Zusätzlich sind alle 64 SEC-EDGAR-Masterindizes von `2009q1` bis `2024q4`
digestgeprüft archiviert und in 16.380.919 Filing-Locator-Zeilen überführt. Darin
liegen 27.285 Form-25- und 17.067 Form-15-Ereigniskandidaten. Eine offizielle
2016Q1-Zeile ohne Emittentennamen bleibt als Quellanomalie erhalten und ist fuer
Namensabgleiche gesperrt. Diese Filingdaten
schließen den kostenlosen Locator-Pfad, aber noch nicht den Ereignisbeweis:
Acceptance- und Effective-Zeitpunkt müssen aus den Originaleinreichungen kommen.

Der kostenlose Originalfiling-Transport ist fuer die drei registrierten
SEC-Ereignispopulationen geschlossen. Fruehere Feed-, `Oldloads`-, Einzel-Wayback-
und Common-Crawl-Laeufe bleiben als append-only Transportprovenienz erhalten;
ihre damalige Locator-Teilabdeckung ist aber nicht mehr der Gate-Stand. Massgeblich
sind jetzt die vollstaendigen Capture-State-Datenbanken, ihre eingefrorenen
Zeilenfolgen und der ueber `origin/main` gebundene Gesamtcheckpoint.

Die fruehere feste, outcome-blinde 43-Batch-Queue dokumentiert den Aufbaupfad,
ist aber kein aktueller Restblocker mehr. Der Abschlussnachweis kommt aus den
vollstaendigen populationsspezifischen Capture-States; Quell-`NOT_FOUND` wird
dort nicht als Payloadfund umetikettiert.

Die erweiterte Entity-Brücke verbindet jetzt 54 exakte Börsensnapshots von 2009
bis 2024 mit damaligen EDGAR-Namensaliasen. Sie liefert 112.476 ungeprüfte
CIK-Kandidaten in 227.516 Snapshotzeilen, 5.653 Mehrdeutigkeiten und 67.398
ungelöste Zeilen. Das bleibt ein Kandidatengenerator, kein permanenter
Security-/Listing-Identifier.

Ein zweiter, primaerer Pfad nutzt 41 digestgepruefte historische Kopien der
offiziellen SEC-Dateien `company_tickers.json` und
`company_tickers_exchange.json`. Die Captures enthalten 422.146 Quellzeilen;
elf vollstaendig identische Doppelzeilen wurden explizit gezaehlt und
dedupliziert, null widerspruechliche Doppelidentitaeten akzeptiert. Der daraus
gebaute Evidence-Ledger prueft den Namensmatcher an 32.662 direkt vergleichbaren
Faellen: 32.613 stimmen mit der offiziellen CIK-Ticker-Zuordnung ueberein, 49
nicht (99,85 Prozent). 1.831 Mehrdeutigkeiten wurden direkt aufgeloest und
1.029 zuvor ungelöste Namen wiedergewonnen. Das uebertrifft die lokale
500/99,5-Prozent-Mindestprobe, schliesst das Gate aber nicht: die SEC-Snapshots
beginnen erst 2017 und beweisen einen Zustand am Capture-Zeitpunkt, keine exakten
effektiven Von-/Bis-Daten.
Der vorhandene aktuelle-Ticker-Preisspeicher deckt nur 9.095 der 23.165
Kandidatenzeilen ab (39,26 Prozent) und bleibt wegen Survivorship Bias,
Tickerwiederverwendung, fehlendem OHLCV und rückwirkenden Adjustierungen ausdrücklich
nicht confirmatorisch.

## Neu erschlossene offizielle Markt-Grundgesamtheit

SEC MIDAS `Metrics by Individual Security` enthaelt ab 2012 taegliche Ticker
einschliesslich spaeter verschwundener Titel sowie Preis-, Groessen-, Turnover- und
Volatilitaetsraenge und Marktaktivitaetsmetriken. Die SEC-Methodik nennt CRSP als
Quelle des Aktienuniversums und des Schlusskurses sowie einen Aktualisierungsverzug
von drei bis vier Wochen. Die Reihe wird deshalb als historische Grundgesamtheit,
Ticker-Zeitreihe und Marktanerkennungs-Proxy genutzt, aber nicht als OHLCV-Ersatz und
nicht ohne konservativen Availability-Lag als damals bekanntes Signal. Der direkte
Ticker-CIK-Link ist ab 2017 punktuell belegt; offen bleiben effektive Ereignisintervalle,
die vollstaendige Vor-2017-Zuordnung und die Jahre 2009 bis 2011 im MIDAS-Universum.

Der archivierte Ausbau ist fuer alle 52 Quartale von `2012q1` bis `2024q4`
lueckenlos: 19.149.242 Tageszeilen, 3.269 Handelstage und 13.616 verschiedene
Security-/Ticker-Paare, davon 8.119 als `Stock` und 5.497 als `ETF` klassifiziert.
CDX-SHA-1, lokaler SHA-256, ZIP-CRC und SQLite-`quick_check` bestanden; der logische
Manifesthash lautet
`8f7cd4974f979381f58b762bab25f482ddb97e8eae9dc9ec6b2878d78264b9df`.
Das offizielle `2014q2`-Payload war ein ZIP in einem ZIP; der Parser prueft deshalb
beide CRC-Ebenen, den aeusseren CDX-Digest und den inneren CSV-Hash. Der Befund
schliesst den kostenlosen Transport und den Security-Type-Parser bis 2024, aber noch
nicht die Jahre 2009 bis 2011 oder den Ticker-CIK-/Corporate-Action-Link.

## SEC-Konzept- und SIC-Bruecke: erster Realdatentest

Auf den 127 SEC-FSD-Payloads 2009 bis 2024 sind alle neun
fundamentalen GQS-Eingaberollen einschliesslich Nettoeinkommen sowie der fuer
Quartals-FCF benoetigten kumulierten OCF-/Capex-Perioden vorhanden. Der korrigierte
Audit prueft die exakten `qtrs`-Zustaende 0 bis 4; der fruehere Acht-Rollen-Bericht
war unvollstaendig und wurde ersetzt. Die Semantik ist nun vor dem Oeffnen realer
Wachstumsoutcomes als `FEM-SEC-CONCEPT-MAP@1.0.0` lokal versiegelt. Offen bleiben
der volle Zeitraum, der Remote-Commit und eine unabhaengige semantische Pruefung.

Die getrennte SIC-Bruecke prüft 17.429 letzte SEC-Meldeidentitäten. 12.167 lassen sich
mit einem unzweideutigen SIC einer Forschungskohorte zuweisen, 2.565 werden wie vom
Produktionsvertrag strukturell ausgeschlossen, und 2.697 beziehungsweise 15,47 Prozent
bleiben ausdrücklich mehrdeutig oder ungelöst. 1.453 Zeilen haben keine SIC; keine
davon hatte in einem früheren FSD-Payload eine SIC. Darunter liegen viele Fonds und
andere Meldeeinheiten außerhalb eines Common-Stock-Universums. Damit ist ein
SEC-only-Schattenlauf technisch realistisch; Produktionsgleichheit und die
Common-Stock-Abgrenzung sind ohne historische Yahoo-Sektor-/Branchenlabels und ein
effekt-datiertes Listing-Ledger nicht belegt und dürfen nicht behauptet werden.

Urteil: **TRAGFÄHIG MIT LÜCKEN**

## Was jetzt belastbar feststeht

Der fundamentale Teil ist kostenfrei lösbar: Die SEC stellt seit 2009 quartalsweise
As-filed-Finanzdaten mit Filing- und Acceptance-Metadaten sowie Originalfilings,
Indexdateien und Companyfacts bereit. Der bisherige lokale Aggregatbestand ist dafür
nicht ausreichend, weil bei der Verdichtung die zeitliche Filing-Provenienz teilweise
entfernt wurde. Er darf nur als Parserprobe, nie als confirmatorischer Input dienen.

Das schwierigste kostenfreie Problem ist nicht SEC, sondern die Verbindung aus
historischem Listinguniversum, verschwundenen Tickern, lückenloser OHLCV-Historie und
damals bekannter Corporate-Action-Anpassung. Kein geprüfter Gratisanbieter erfüllt
diesen Vertrag für das vollständige US-Universum 2009–2024 allein. Der kostenpflichtige
Nasdaq Daily List ist nicht autorisiert. Deshalb wird die benötigte Identitäts- und
Exit-Historie primär aus SEC-Covern, Originalfilings, Form 25/15 und effekt-datierten
Ereignissen rekonstruiert; Gratispreisquellen werden nur nach unabhängiger Kreuzprüfung
zugelassen.

## Unveränderlicher Rohdatenvertrag

`scripts/early-detection-foundation.py` legt jedes Quellpayload bytegleich und
inhaltsadressiert unter seinem SHA-256 ab. Eine Observation enthält Quelle, CIK oder
Quartal, den real belegten Abrufzeitpunkt, Payloadpfad, Hash, Qualitätszustand und
Quarantänegründe. Bestehende Dateien werden nie überschrieben. Eine spätere
Quellenrevision erzeugt ein neues Payload und eine neue Observation.

Fehlt der belegte Abrufzeitpunkt, wird er nicht aus Dateizeit, Berichtsperiode oder
Filingdatum erfunden. Das Payload bleibt als nützlicher Rohbestand erhalten, trägt aber
`qualityState=quarantined` und ist für As-of-Auswertungen gesperrt. Genau deshalb sind
die vorhandenen Companyfacts-Dateien zweigeteilt: Manifest-gebundene Dateien können
als beobachtet importiert werden; Dateien ohne passenden Manifestbeleg bleiben in
Quarantäne.

## Gate-für-Gate-Entscheidung

| Gate | Kostenfreier Primärpfad | Heutiger Status | Bestehende Lücke |
|---|---|---|---|
| Entity-/Listing-Ledger | CIK + Filing-Cover + Form 25/15 + effekt-datierte Security-/Listing-IDs | MIDAS 2012-2024 + 54 exakte Börsen-Snapshots + 41 direkte SEC-CIK/Ticker-Snapshots; 32.613/32.662 Matcherfaelle korrekt (99,85 Prozent), 1.831 Mehrdeutigkeiten aufgeloest, 1.029 direkte Recoveries | Direkte SEC-Zustaende beginnen 2017 und sind keine effekt-datierten Intervalle; Vor-2017-Cover und Ereignisdaten offen |
| Append-only SEC Store | SEC FSD, Originalfilings, Companyfacts; bytegleich + SHA-256 | **PASS:** 952 Observationen, 794 Payloads, 12.930.873.291 Bytes, 178/178 gueltige FSD-Revisionen, 178.601 Originalfiling-Ereignisse und 101.881 verifizierte Originaldateien; Checkpoint-Commit `4055c8a…` bytegleich an `origin/main` `221503a…` gebunden | keine technische Store-Luecke; unabhaengiger Human-Audit bleibt separat rot |
| Historisches Universum | damalige SEC-Emittenten + MIDAS + Listing-Cover + Exit-Ereignisse | tägliche MIDAS-Reihe 2012-2024 lückenlos; 8.119 Stock- und 5.497 ETF-Tickerpaare | 2009-2011, CIK-Link und Common-Stock-Untertypen offen |
| As-of-Leakage | `known_at=max(required source timestamps)`; unbekannt = nicht verwendbar | 100/100 Vertragsfixtures, sieben gezielte Regressionstests und ein echter Common-Crawl-WARC-Pfad bis zur normalisierten Verfügbarkeitsfunktion des versiegelten Runners bestanden | vollständiger SEC-/Corporate-Action-, Issuer-/Public-Web-, Market-Bar- und historischer GQS-Pfad bis zum exakten autorisierten FEM-Input fehlt; Gate bleibt rot |
| Adjusted OHLCV | mehrstufige Gratisquellen + Split/Dividend-/Exit-Ereignisse | begrenzte aktuelle-Ticker-Kohorte deckt 9.095/23.165 Kandidatenzeilen beziehungsweise 39,26182 Prozent ab; 2.028 gueltige Dateien enthalten nur Datum und adjusted close; SEC MIDAS liefert 19.149.242 Marktaktivitaetszeilen, aber kein OHLCV | reproduzierbarer Unmoeglichkeitsnachweis: kein kostenloses, survivorship-sicheres 2009-2024-Volluniversum mit permanenten IDs, Actions und Delisting-Renditen belegt; Gate bleibt rot, kostenloser Fallback ist begrenzter Technik-Anhang plus prospektiver append-only Collector |
| Corporate Actions/Delistings | SEC Form 25/15, 8-K, Filing-Cover, Börsenmeldungen | 44.352 Ereigniskandidaten, 27.427 Accessions; Feed+Oldloads-Vereinigung 24.681 Accessions, outcome-blinde Restqueue nach 17/43 gueltigen Batches plus 285 Individual-Locator = 24.966 beziehungsweise 91,02709 Prozent; alle 285 Zusatzinhalte validiert, die Batchindizes 7, 13, 15, 19 und 20 bleiben offen | 1.754 Accessions unbefragt oder technisch offen; vollständige Acceptance-/Effective-Zeitpunkte, lokaler Inhaltsbestand und Delisting-Renditen fehlen |
| Historischer GQS-Adapter | GQS-00@1.0.0 gegen damals bekannte SEC-Vintages | 12 Quartalspunkte 2012-2014 reproduziert | nur SEC-Schatten, Outcome- und Preisvergleich offen |
| Konzeptkarte | SEC-Tags + Statement-Rolle + sektoraler Fallback, vor Outcomes eingefroren | `FEM-SEC-CONCEPT-MAP@1.0.0` lokal versiegelt; vorhandener 2009q1-2024q4-Audit deckt 64 Quartale, 127 Payloads und alle neun Rollen ohne ungelöste Coverage ab | Map und Siegel fehlen auf `origin/main`; unabhängiger Semantikaudit fehlt; zwei frische Vollzeit-Reproduktionen endeten nach 60/300 Sekunden am Laufzeitlimit ohne Teilreport, daher Gate weiter rot |
| Blind Coding | zwei wirklich unabhängige, outcome-blinde menschliche Codierer | fail-closed Kit gebaut: exaktes CSV-Schema, T/E/L-Vollständigkeit, Cutoff-, Identitäts-, Kappa- und Exact-Agreement-Prüfung; Kompilierung, positiver Test und vier Negativtests bestanden | zwei echte unabhängige Menschen, Blinding-/Unabhängigkeitsatteste, echte Codierdateien und Remote-Hashbindung fehlen; Gate bleibt rot |
| Research-Korpus | append-only Quellenpayloads, Suchprotokoll, Cutoff und Hashmanifest | Store-Grundlage gebaut | historische Themenquellen noch nicht vollständig eingesammelt |
| Unabhängiger Audit | genaue Input-/Komponentenhashes und Gate-Artefakte gegen origin/main | später ausführbar | kann erst nach fertigem Input grün werden |

## Harte Grenze des versiegelten Protokolls

Das Blind-Coding-Gate von FEM-SEC-US@1.2.0 verlangt zwei unabhängige Codierer und
bestimmte Übereinstimmungswerte. Derselbe Agent in zwei Durchläufen, zwei Subagenten
oder zwei Sprachmodelle sind keine unabhängigen menschlichen Codierer und dürfen nicht
als solche ausgegeben werden. Ohne zwei freiwillige unabhängige Menschen bleibt der
confirmatorische Lauf 1.2.0 an diesem Gate rot. Die kostenfreie autonome Alternative
ist eine neue, vor Outcome-Zugriff versiegelte Prospektivversion mit deterministischen
Quellenregeln und ausschließlich künftig entstehenden Beobachtungen. Sie ersetzt nicht
rückwirkend das Ergebnis der Version 1.2.0.

Das kostenfreie `blind-coding-kit-v1` macht den verbleibenden menschlichen Schritt
vollständig ausführbar, ohne ihn vorzutäuschen. Der Prüfer berechnet lineares und
quadratisches gewichtetes Cohen-Kappa, weil das versiegelte Protokoll das
Gewichtungsschema nicht festlegt. Ein PASS wird nur ausgegeben, wenn jede T-/E-/L-
Dimension unter beiden Varianten mindestens 0,70 erreicht und die gesamte exakte
Übereinstimmung mindestens 0,80 beträgt. Der positive Selbsttest und vier
adversariale Negativtests bestanden. Der Entscheidungsreport mit SHA-256
`29d8ecbcf4c7bdc942656ab78c2aef1c30b4eb05a7835734b7ec73a7b9e13e70`
setzt das Gate ausdrücklich nicht grün: Ohne zwei unabhängige Menschen gibt es
keinen beobachteten Agreement-Wert.

## Beschaffungsreihenfolge

1. Vorhandene Companyfacts bytegleich importieren und fehlende Abrufbelege
   quarantänisieren.
2. SEC-FSD-Quartale 2009q1–2026q1 über einen verifizierten Netzpfad abrufen, jedes ZIP
   dauerhaft behalten und hashen.
3. Aus `sub.txt` die Acceptance-/Accession-Tabelle und aus `num.txt` eine ungeglättete
   Fact-Tabelle aufbauen; keine heutige Konzeptentscheidung zurückschreiben.
4. Filing-Cover und Form-25/15-Ereignisse abrufen und ein effekt-datiertes
   Entity/Security/Listing-Ledger aufbauen.
5. Erst danach kostenlose Preisquellen gegen die bekannte Listingpopulation testen.
   Fehlende delistete Reihen werden nicht still aus der Population entfernt.
6. Concept-Map und As-of-Query versiegeln, historische GQS-Schattenvintages erzeugen,
   dann erst Forschungs- und Auditkorpus aufbauen.

## Abbruch- und Fallback-Regeln

- Ein Anbieter mit erforderlichem Bezahlplan wird nicht verwendet.
- Ein Gratisanbieter ohne belegte Delistingabdeckung kann nur Explorations- oder
  Kontrollquelle sein.
- Ein fehlender Ticker, Acceptance-Zeitpunkt oder Corporate-Action-Beleg führt zu
  `UNKNOWN` beziehungsweise Quarantäne, nie zu einer rückwirkenden Annahme.
- Wenn vollständige kostenlose OHLCV trotz SEC-rekonstruiertem Universum nicht
  erreichbar ist, bleibt der Volluniversumstest `INCONCLUSIVE`. Zulässig bleibt eine
  vorab definierte Coverage-Kohorte mit offen ausgewiesener Auswahlgrenze; sie darf
  nicht als vollständige US-Studie bezeichnet werden.
- Produktive GQS-Logik, Gewichte, Filter, Exporte und Rangfolge bleiben unverändert.

Die maschinenlesbare Quellenentscheidung steht in `free-source-registry.json`.

## Umgesetzter SEC-PIT-Index

`scripts/early-detection-pit.py` liest ausschließlich akzeptierte, hashgeprüfte
SEC-FSD-Payloads aus dem unveränderlichen Store. Der abgeleitete SQLite-Index
bewahrt jede Payloadversion separat auf und verbindet `sub`, `num`, `pre` und
`tag`, ohne Quartalsende oder Abrufzeit als Veröffentlichungszeit auszugeben.

Die SEC-Acceptance-Wanduhr wird für den Studienzeitraum ab 2009 nach der
offiziellen Eastern-Time-Regel mit den seit 2007 geltenden US-DST-Grenzen in UTC
qualifiziert. Rohwert und Umrechnungsregel bleiben gespeichert. Ein Negativtest
enthält bewusst eine spätere Einreichung und beweist, dass sie vor ihrem
Acceptance-Zeitpunkt nicht in einer As-of-Abfrage erscheint. Damit ist die
technische Basis des Leakage-Gates gebaut; grün wird das Gesamtgate erst nach dem
vollständigen echten Datenabruf und End-to-End-Test bis zum GQS-/FEM-Input.

## Verifizierter SEC-Archivtransport

Der lokale HTTP-403-Block ist kein grundsaetzlicher Datenblocker mehr.
`scripts/early-detection-sec-wayback.py` hat im kostenlosen Wayback-CDX-Index
247 verschiedene SEC-FSD-Captures und alle 69 Quartale von `2009q1` bis
`2026q1` nachgewiesen. Jeder Replay-Download wird gegen den im CDX gespeicherten
SHA-1-Payloaddigest geprueft, danach als ZIP vollstaendig gelesen und zusaetzlich
per SHA-256 im lokalen append-only Store versiegelt.

Der Ausbau umfasst 127 Payloadversionen aus `2009q1` bis `2024q4`: bis `2014q4`
pro Quartal die frueheste archivierte Legacy-Datei und die nach der
SEC-Neuverarbeitung verfuegbare aktuelle Datei; fuer `2015q1` bis `2015q3` beide
Varianten, fuer `2015q4` die gesicherte Legacy-Datei und fuer 2016 bis 2024 wieder
beide Varianten. Alle 127 bestanden Digest-
und ZIP-Pruefung. Eine reale
SEC-Quelleninkonsistenz mit 1.953 `num.txt`-Zeilen ohne zugehoerige `sub.txt`-
Einreichung ist verlustfrei quarantainisiert; keine dieser Zeilen ueberschneidet
sich mit nutzbaren Einreichungen.

Die Wayback-Capturezeit wird nur als Transport- und Abrufprovenienz gespeichert.
Fuer einzelne SEC-Filings bleibt `accepted` die fachliche Verfuegbarkeitszeit;
das Rohfeld und die dokumentierte Eastern-Time-Umrechnung werden beide erhalten.
Eine spaete Archivaufnahme wird nicht als fruehe Publikation ausgegeben.

Der kompakte PIT-Index hat alle 127 Versionen committed. Der zuvor offene
Vollintegritaetslauf ist inzwischen bestanden: `PRAGMA integrity_check`, alle
Fremdschluessel, Rohpayload- und Observation-Hashes, ZIP-CRCs, physische
Payloadzeilen und gespeicherte Zeilenhashfolgen stimmen; es gibt null Befunde.
Der Reportstatus lautet `PASS_FULL_INTEGRITY`. Das schliesst den technischen
FSD-Audit fuer den registrierten Zeitraum 2009 bis 2024, nicht die noch offenen
Originalfiling-, Listing-, Preis- und Research-Gates.

## Originalfiling-Transport: belegte Grenze und Fallbacks

Die zwei Bulk-Transporte sind nicht austauschbar. Der Feed-Pfad lokalisiert 18.503
eindeutige Accessions, der getrennte SEC-`Oldloads`-Pfad 16.571. Ihre
populationsgenau rekonstruierte Vereinigung umfasst 40.033 von 44.352
Ereigniszeilen und 24.681 von 27.427 Accessions. Der kombinierte Entscheidungsbericht
`reports/early-detection/sec-original-filing-transport-decision-2009-2024.json`
weist den kanonischen Berichtskörper-Hash
`621c519e9b02a8b5b0efc711538019230c65a3b0cb96fc7a1b1456e71cd55915`
aus; der SHA-256 der vollständigen JSON-Datei ist
`d1e060c492e421ea34edb32aed256e605b4d93ca2b1f9c47986a16080b1fed86`.
Der Bericht urteilt bewusst
`USABLE_FOR_EVIDENCE_ACQUISITION_NOT_POPULATION_CONTENT_COMPLETE`.

Der Oldloads-Nachweis wurde auf dem vom Feed nicht gedeckten 22. Mai 2009 als
echter Inhaltstest ausgefuehrt. Das 128.746.816-Byte-GZIP mit SHA-256
`4f6234b9547bfec02da726f941a5cb7a3fa10e5e1abbb5978d2d95f1f82cf34f`
bestand CDX-SHA-1 und GZIP-Integritaet, expandierte auf 534.538.621 Bytes in
2.640 Submission-Bloecke und enthielt 11/11 Zielaccessions mit passendem Formtyp.
Der akzeptierte V2-Bericht weist den kanonischen Berichtskörper-Hash
`ac491625b6ab687696cc850dca9a2ea5647c4e438d530e4f7b27318e37ae2278`
aus; der SHA-256 der vollständigen JSON-Datei ist
`f2dc4f431edfbb1375523623641eebd22ce1d9053410e300183efec9a0847a68`;
der erste Parserlauf mit falscher Blockgrenze bleibt als abgewiesene Observation
erhalten. Der volle Oldloads-Locatorbericht weist den kanonischen
Berichtskörper-Hash
`f6c72d13d30117b7ec775f37a10a220c570d1623c16c496ddbba58cb115d12db`
aus; sein vollständiger JSON-Dateihash ist
`b3f3a471818543c155170097c32f6a19b2d8dbafa8ddee3185e77bbfbd83c57a`.

Die Vereinigung ist kein Vollstaendigkeitsbeweis: 2.746 Accessions bleiben ohne
Archiv-Locator, und fuer die gefundenen Locators ist der Grossteil der Inhalte
noch nicht lokal bezogen und geprueft. Der offizielle SEC-Pfad ist kostenlos und
kanonisch, antwortet in dieser Laufzeit aber mit HTTP 403. Deshalb bleibt das Gate
rot; fehlende Inhalte werden weder als nicht existent noch als erfolgreich
beschafft ausgegeben.

`scripts/early-detection-sec-filing-gap.py` macht diese Restluecke fortsetzbar.
Der signierte Plan ordnet alle 2.746 Accessions mit Seed
`FEM-SEC-US@1.2.0-unresolved-filing-gap-v1` fest in 43 Batches zu. Der kanonische
Planhash ist
`5ef95826f3fc2060e5fc965322089309b44f2261f8a71f0511dcdb1a571aeebb`,
der vollstaendige JSON-Dateihash
`d22c829a345b595926f582ab417f58cda43ade485fea854070aca2fa67ad225c`.
Die ersten 128 Accessions ergaben nach vier append-only Wiederholungen je Batch
30 Captures, 73 belegte Nulltreffer und 25 technische Unbekannte. Der gemeinsame
Teilbericht weist den kanonischen Berichtskörper-Hash
`85aed97da6cb9573fc54a0bebb57c2cdcd86e62d20a1eb87bf29f30d3468a5dd`
und den vollständigen JSON-Dateihash
`2ead1429278181c30f5c7809ac4d4a004efaafa1afdfafa50e786c1657fe0297`
aus. Die zugehoerigen Inhaltslaeufe validierten 14/14 und 16/16 Filings. Die
Archivaufnahme lag bei diesen Treffern teils Jahre nach dem Filing und bleibt
reine Transportprovenienz; fachliches `known_at` muss aus dem Filingheader kommen.

`scripts/early-detection-sec-filing-archive.py` hat die kostenlosen EDGAR-
Tagesarchive fuer alle Kandidatentage 2009 bis 2024 gegen den Wayback-CDX-Index
vermessen. 30.552 von 44.352 Ereigniszeilen und 18.503 von 27.427 eindeutigen
Accessions liegen auf einem Capture-Tag. Der ausgewaehlte WARC-Record-Umfang von
1.911.290.820.771 Bytes ist nur eine Transportplanung und kein exakter Replay-
Payloadwert. Ein HEAD-Gegencheck bewies diese notwendige Unterscheidung: ein
CDX-WARC-Eintrag von 549.886 Bytes verwies auf 791.328.619 Replay-Bytes.

Die kleinste real gemessene Probe vom 2. Januar 2009 hatte 48.994.926 Bytes,
entpackte sich zu 273.882.931 Bytes in 1.781 Dateien und enthielt alle 15
angeforderten Accessions mit passendem Formtyp. Der V1-Parserbefund bleibt als
abgewiesene Observation erhalten; die historische `<TYPE>`-/`<FORM-TYPE>`-Variante
wurde in V2 getrennt versioniert. V2-Berichtshash:
`adfa4233e4aa700ccf66809b234838b6ba72722706e9f5385dec762fef3112c7`.

`scripts/early-detection-sec-filing-individual.py` testete dieselbe Population mit
einer festen SHA-256-Rangstichprobe von je einer Accessions pro Jahr und
Ereignisklasse. Nach vollstaendiger Wiederholung lagen 5 Captures, 27 belegte
Nulltreffer und null unbekannte Abfragen vor. Der Trefferbericht hat den Hash
`8e966b24f0f272cded05c24975083ab965a9966694361ee39949b6127f6ea8d6`.
Eine reale Einreichung (`0001104659-11-061252`, Form 25) wurde mit 16.734 Bytes,
CDX-SHA-1, SHA-256
`b6e62f71108e14887158dd9f14a34de2786b5f3d00f9e5ac02cd52a44ffedfc4`
und klassischem SEC-Klartextheader verifiziert. Berichtshash:
`20350241240da15247069f3c515079b4dac8d5f6070e9bb914a9345038350bf3`.

Common Crawl wurde zunaechst ueber die offizielle CDX-API, danach ueber Remote-
Parquet und schliesslich ueber den statischen ZipNum-Rohindex geprueft. Nur der
statische Pfad war lokal skalierbar: sortierte `cluster.idx`-Ranges und genau ein
komprimierter CDX-Block je URL, jeweils content-addressed gespeichert. In der
identischen 32er-Probe und der vorab festgelegten Policy aus naechster spaeterer
plus neuester Collection wurden 0 Captures, 32 Nulltreffer und 0 unbekannte Faelle
gefunden. Das widerlegt Common Crawl nicht fuer alle 126 Collections, belegt aber,
dass diese ressourcenschonende Policy die Wayback-Luecke nicht schliesst.
Berichtshash:
`d13f7e6d3699859643ada7f1eb32f72ff610721c11941fbf551818d663eb68fb`.

## Verlustfreier Kompaktindex

Der erste breite SQLite-Referenzindex war fuer den Vollbestand zu teuer, weil er
lange Payload-Hashes, Acceptance-Zeiten, Konzepte und Taxonomietexte millionenfach
wiederholte. `scripts/early-detection-pit-compact.py` normalisiert diese Werte in
Schluesseltabellen, speichert SHA-256-Zeilenhashes als 32-Byte-BLOB und dedupliziert
identische Tagdefinitionen. Der append-only Rohstore bleibt dabei die Autoritaet.

Fuer `2009q1` bis `2012q4` wurden breite und kompakte Ableitung unabhaengig
verglichen. Alle 32 Payloadmengen, 35.174.832 Fakten, 13.523.112
Darstellungszeilen, 111.374 Einreichungen und 1.339.541 Tags stimmen in Zahl und
Quellzeilenhash exakt ueberein. Vergleichsmanifest:
`59d84eece27a2e3aaa921dcb4883a415799782decab2e7aa195d859c8d3ca093`.
Der kompakte Index benoetigt 4.901.367.808 statt 27.191.382.016 Bytes und ist
damit 5,55-mal kleiner. Das ist eine technische Optimierung ohne Daten- oder
Methodikaenderung.

Der Kompaktindex ist danach bis `2024q4` erweitert worden und enthaelt jetzt
308.848.369 Fakten, 102.628.203 Darstellungszeilen, 1.097.249 Einreichungen,
9.709.074 Tags und die 1.953 quarantainisierten SEC-Anomaliezeilen. Alle 127
Quellpayloads sind gebunden. Der vorhandene Datenstand hat den Vollintegritaetsaudit
bestanden; bis zur confirmatorischen Nutzung fehlen dennoch der registrierte
Gesamtzeitraum und die anderen Readiness-Gates.

## Historische GQS-Schattenkalender

`scripts/early-detection-gqs-calendar.py` hat zwoelf Quartalsstaende von `2012q1`
bis `2014q4` gegen denselben unveraenderten Scoringbaum
`297d53aa8e36332cd629fd843235b0ed7f1e3a77f07eca02b6799d8a1ea35eb0`
materialisiert. Die Population waechst von 8.075 auf 9.813 SEC-Entitaeten; die
explorativ qualifizierten Boardzeilen von 1.859 auf 2.023. Erzeugungszeitstempel
wurden nach einer Reproduzierbarkeits-Gegenprobe aus Input und Shadow entfernt:
identischer Datenstand erzeugt nun identische semantische und exakte Dateihashes.

Die Kalenderpunkte sind ausdruecklich `SEC_ONLY_SHADOW_NOT_PRODUCTION_RECONSTRUCTION`.
Sie enthalten keine historischen Yahoo-Branchen, Preise, Marktkapitalisierungen oder
Analystenrevisionen und lesen keine Wachstums- oder Kursoutcomes. Sie schaffen die
Zeitachse fuer den spaeteren Vorlaufvergleich, beweisen ihn aber noch nicht.

## Historische Boersen-Snapshots

Als kostenloser Gegenbeleg zum heutigen Tickerbestand wurden aus dem Wayback-Archiv
54 Nasdaq-Trader-Symbolverzeichnisse von 2009 bis 2024 digestgeprueft gesichert:
zwoelf fruehe Captures bis 2014 und 42 weitere ab 2015. Zwei 2022er Antworten waren
gzip-komprimiert; der Rohblob bleibt unveraendert, waehrend der Parser die
Transportkompression separat belegt. Alle 42 im 2015-2024-CDX ausgewaehlten
Captures wurden akzeptiert, null Downloadfehler blieben; 38 Quartals-/Datasetzellen
haben keinen archivierten Capture. Die 2009er Other-Listed-Datei verwendet die
historische Spalte `Symbol` statt `ACT Symbol`; beide Varianten sind explizit
getestet. Jeder Snapshot gilt nur an seinem exakten Capture-Zeitpunkt. Fehlende
Quartale werden nicht vor- oder rueckwaerts aufgefuellt.

## Direkte historische SEC-CIK-/Ticker-Snapshots

Die offiziellen SEC-Dateien `company_tickers.json` und
`company_tickers_exchange.json` sind im Wayback-CDX ab 2017 beziehungsweise 2021
belegt. Der Adapter waehlt outcome-blind den letzten digest-eindeutigen Capture je
Quartal, akzeptiert Base32- und einen historischen Hex-SHA1-Digest und speichert
die Originalbytes append-only. 41 von 41 ausgewaehlten Captures bestanden; sie
enthalten 422.135 eindeutige Mappingzeilen nach elf exakt identischen
Quelldopplungen. Der kombinierte Ledger enthaelt ausserdem 13.499 MIDAS-Ticker,
darunter 8.119 mit Stock-Evidenz, und 153.504 direkte SEC-Mappingbeobachtungen mit
MIDAS-Stock-Praesenz. MIDAS darf dabei nur Markt-Praesenz bestaetigen, nie CIK oder
Listingkontinuitaet.

## Historische Research-Verfuegbarkeit

Eine heutige Kopie einer alten Webseite beweist nicht, dass ihr Inhalt damals
bereits oeffentlich war. Deshalb nutzt `scripts/early-detection-web-archive.py`
den kostenfreien Common-Crawl-Index und laedt den originalen WARC-Bytebereich.
Der Crawl-Zeitstempel wird nur als `observedAt` verwendet. Er wird niemals als
Publikationszeit ausgegeben.

Historisch signalberechtigt wird eine Archivquelle nur, wenn der damalige
Payload selbst genau einen zeitzonenqualifizierten Publikationszeitpunkt traegt,
dieser zum registrierten Publikationstag passt und vor dem Crawl liegt. WARC,
HTTP-Antwort und Nutzpayload werden separat gehasht und unveraenderlich
gespeichert. Der erste bestandene Echttest ist S025 (NIST Post-Quantum-Standards):
Publikation `2024-08-13T12:00:00.000Z`, Common-Crawl-Beobachtung
`2024-09-14T13:32:34.000Z`. S028 wurde zwar historisch gefunden, blieb aber rot,
weil sein damaliger Payload keine exakte Publikationszeit enthielt.

Damit ist ein vorher offener kostenloser Pfad technisch bewiesen, aber noch
nicht fuer den gesamten Korpus geschlossen. Fehlende Captures, Rate Limits und
Quellen ohne exakte Metadaten bleiben offen beziehungsweise in Quarantaene.

## Leakage-Negativbatterie

Der gemeinsame Availability-Vertrag hat nun 100 deterministische Negativfixtures
bestanden: je zehn spaete Amendments, After-Close-Filings, spaete
Emittentenmeldungen, Tickerwechsel, Future-Splits, Fusionen, Spin-offs,
Insolvenzen, Delistings und erst spaeter verfuegbare Markt-Bars. In allen 100
Faellen wurde die Verwendung eine Millisekunde vor `known_at` abgelehnt, die
exakte Grenze akzeptiert, ein fehlender Pflichtzeitstempel abgelehnt und eine
spaetere Mutation in `known_at` fortgeschrieben. Reporthash:
`1f90bde228a397904fb70501299f0b70019d279487b2428210a32b86399815f0`.

Das ist ein bestandener Vertrags-Layer, aber noch kein gruenes End-to-End-Gate.
Jede Quellenklasse muss zusaetzlich ihren realen Parser sowie den vollstaendigen
GQS-/FEM-Inputpfad durchlaufen.

Ein zusätzlicher Realquellen-Probeweg führt nun die historisch archivierte und
signalberechtigte NIST-Beobachtung S025 aus ihrem unveränderlichen Common-Crawl-
WARC-Datensatz in die normalisierte Verfügbarkeitsfunktion des versiegelten
Confirmatory-Runners. Archivbeobachtung und Runner berechnen bytegebunden denselben
`known_at`; eine spätere Beobachtungsmutation verschiebt ihn, und fehlender
Pflichtzeitpunkt sowie unbekannte Quellenklasse werden abgelehnt. Probe-Reporthash:
`bec558080a78eaa72df0c384d3783c113ddfe5eb3cb0b2212f95b771e281806f`.

Das beweist genau einen realen Research-Quellenpfad, nicht den vollständigen
FEM-Input. Der fail-closed Gateentscheid mit Datei-SHA-256
`0eeb8770265df2364ea0eb8485d332c696d27f2475af3f07d4d3353fe66b6cfa`
hält `asOfLeakageGate` deshalb rot, bis jede reale Quellenklasse einschließlich
SEC-Aktionen, Markt-Bars und historischem GQS durch denselben negativen Test läuft.
