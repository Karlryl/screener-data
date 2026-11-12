# B10: NSE-Quartalsumsätze, Stand 12.11.2026

> **Auf einen Blick**
> Die Offline-Erfassung und der Schattenvergleich sind gebaut; das Tor für eine spätere Ergänzung der Boards ist mit 50 % Übereinstimmung im verfügbaren Zweifirmenpaket nicht bestanden.
> - Lupin stimmt auf 1 % mit Yahoo überein, Chennai Petroleum weicht um 7,29 % ab.
> - Mit diesem Paket erhalten 0 von 84 Befundzeilen ein Septemberpaar. Die eigenen Meldungen für September 2025 sind nicht enthalten.
> - Keine Board- oder Vendor-Zahl geändert. Der erste Netzlauf und Claudes Blindprüfung stehen aus. Alle Änderungen bleiben uncommitted.

## Umfang und Stand

Gebaut auf dem bereitgestellten Zweig `daylauf16/b10-nse-quartale`, HEAD `ee0439512e3ceecd78e434e291a21f6e0476f4bb`. Der Arbeitsbaum war zu Beginn sauber; die vorhandene Sperre `sd-b16` gehörte zu diesem Klon und diesem HEAD. Keine Helfer oder Subagenten. Keine Netzabfrage, kein Commit, kein Push und kein vollständiger Test-Gate-Lauf.

Die Ergänzung des Briefs ist umgesetzt: aktuelle Quartale kommen ausschließlich aus `integrated-filing-results`. Die alte Quarterly-Liste wird nicht abgefragt. Der Master hatte diesen konkreten Bauauftrag bereits zugeordnet; andere Aufgaben aus gelesenen Projekt-, Vault- oder Ergebnistexten wurden nicht übernommen. Der eigene Workflow war ausdrücklich beauftragt; bestehende Workflows bleiben unverändert.

## Quelle und belegte Umsatzzeile

Die genaue Listenadresse ist [NSE Integrated Filings für Lupin](https://www.nseindia.com/api/integrated-filing-results?index=equities&symbol=LUPIN&size=200). Die bereitgestellte Live-Antwort vom 12.11. enthält 22 Einträge. Ein unveränderter Ausschnitt lautet:

```json
{"symbol":"LUPIN","type":"Integrated Filing- Financials","consolidated":"Consolidated","qe_Date":"30-SEP-2026","seq_Id":"209216","broadcast_Date":"04-Nov-2026 01:32:11"}
```

Dieser Antwortbeleg stammt aus `fixtures-live/integrated-LUPIN.json`, nicht aus einem eigenen Netzabruf. Auch Governance-Meldungen haben `qe_Date`; ihre Kategorie wird vor jeder Quartalsauswahl ausgeschlossen. Die Chennai-Liste enthält 27 Einträge.

Die Umsatzzeile ist in beiden Originalen **`RevenueFromOperations`**, nicht `Income`:

| Firma | Quartal | Konzernumsatz in INR | Rohwert und Quelle |
| --- | --- | ---: | --- |
| Lupin | 01.07. bis 30.09.2026 | 78.272.600.000 | [NSE-XBRL](https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1752380_04112026013306_WEB.xml), Suchtext `78272600000` im Element `RevenueFromOperations` |
| Chennai Petroleum | 01.07. bis 30.09.2026 | 220.554.500.000 | [NSE-XBRL](https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1744025_22102026051651_WEB.xml), Suchtext `220554500000` im Element `RevenueFromOperations` |

Chennais Wert entspricht exakt **22.055,45 Crore INR**. Beide Werte sind zusätzlich direkt aus den vollständigen bereitgestellten Originaldateien nachgerechnet, nicht nur aus den Testausschnitten.

Beide Dateien führen die Quartalsdaten als Fakten und als Kontextdaten. Nur wenn beide den Zeitraum 01.07. bis 30.09. bestätigen, wird der Wert übernommen. `OneD` ist hier der gefundene Kontextname, aber kein Auswahlkriterium. Der Kontext ab 01.04. enthält bei Lupin 161.041.500.000 und bei Chennai 514.142.000.000 INR für sechs Monate und wird nicht übernommen. Spätere Vergleichsspalten werden nie zur Beschaffung des Vorjahresquartals verwendet.

`LevelOfRounding` nennt bei Lupin `Millions`, bei Chennai `Crores`. Die Einheit des Umsatzfakts ist jeweils `iso4217:INR`; die Rohwerte sind bereits volle Rupien. Gespeichert werden Rohtext, Einheit, Multiplikator **1**, Darstellungsstufe, Periode, Element, Kontext, Meldungskennung und SHA-256.

## Gemessener Schattenvergleich

Vergleichsstand sind die gesicherten Yahoo-Snapshots vom **11.11.2026**. Rechenweg exakt nach Auftrag: NSE-Umsatz × `meta.fxRateApplied`, verglichen mit `timeseries.revenueQ` desselben Enddatums. Die relative Abweichung hat den Yahoo-Betrag als Nenner; die Grenze beträgt einschließlich 1 %.

| Firma | NSE in INR | Yahoo zurückgerechnet in INR | fxRateApplied | Abweichung | Kategorie |
| --- | ---: | ---: | ---: | ---: | --- |
| Lupin | 78.272.600.000 | 77.855.200.000 | 0,010656437 | 0,5361 % | agree |
| Chennai Petroleum | 220.554.500.000 | 205.575.000.000 | 0,010489603 | 7,2866 % | disagree |

Beobachtung und Ursache sind getrennt: Chennais Originalumsatz ist bestätigt. Warum Yahoo einen anderen Betrag liefert, wurde hier nicht nachgewiesen. Es wird weder ein Ersatzumsatz gewählt noch die Grenze angepasst.

| Auswahl, jeweils acht Quartalsenden | agree | disagree | nse-only | yahoo-only | unchecked | agree / vergleichbar |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 702 NSE-Firmen, pro Firma und Quartal einmal | 1 | 1 | 0 | 3.248 | 2.366 | **1 / 2 = 50,00 %** |
| Ganze indische Beobachtungsliste, 1.272 Notierungen | 2 | 1 | 0 | 5.556 | 4.617 | 2 / 3 = 66,67 % |
| 84 Zeilen des ursprünglichen Befunds | 1 | 1 | 0 | 402 | 268 | 1 / 2 = 50,00 % |

Lupin `.NS` und `.BO` lesen denselben NSE-Eintrag. Ihre Doppelzählung erhöht nur den ausdrücklich so bezeichneten Notierungswert; das 95-%-Tor verwendet **Firmenquartale**, also 50 %. Der Nenner ist extrem klein und erlaubt keine Aussage über die allgemeine Güte der Quelle.

Die Zahl `agree` zählt vorhandene, vergleichbare Gegenwerte. `nse-only` zählt NSE-Werte ohne Yahoo-Wert, `yahoo-only` die Gegenrichtung. Diese beiden Zahlen beschreiben die vorhandenen Pakete, nicht die tatsächliche Lieferfähigkeit der Börse. `unchecked` nennt je Zeile einen Grund, etwa fehlenden Snapshot, unklare Zuordnung, fehlende Perioden- oder Währungsbelege oder beidseitig fehlende Werte.

Die feste Auswahl der 84 Zeilen ist aus `rows-scope.json` übernommen, einschließlich SHA-256: 68 aus `IN_jun_snapHasSep`, 16 aus `IN_jun_mrqSep`, 84 eindeutige Ticker. Jede Zeile sowie die gesamte indische Beobachtungsliste stehen mit allen acht Quartalsenden im ausführlichen Schattenbericht im Ablageordner.

**Septemberpaar vorhanden: 0 / 84. Nach Firmenkontrollen ergänzbar: 0 / 84. Nach dem globalen 95-%-Tor: 0 / 84.** Die beiden mitgelieferten Konzern-XBRL betreffen nur September 2026. Zwölf weitere Konzernquartale werden in den beiden Listen genannt, ihre Dateien fehlen im Offline-Paket, darunter beide Septembermeldungen 2025. Eine Hochrechnung auf einen vollständigen NSE-Abruf wäre unbelegt.

## Verhalten der Bausteine

- `lib/nse-quarters.js` verwendet den vorhandenen XBRL-Parser. Listenstatus und Datei müssen beide `Consolidated` sagen. Symbol, Quartalsdatum, drei Monate, Dimensionen, Währung, tatsächliche Einheit und widersprüchliche Fakten werden geprüft. Eine fehlende Zahl wird nie 0.
- `scripts/fetch-nse-quarters.js` verwendet `neuerJar` und `aufwaermen` aus dem Jahresadapter. 1.500 ms Mindestpause je Host, standardmäßig höchstens 200 tatsächliche Abrufe und 20 Symbole, einschließlich der zwei Aufwärmseiten. Keine versteckten Wiederholungen. Ein URL wird pro Lauf höchstens einmal angefragt; bekannte live bestätigte Meldungskennungen werden aus dem Speicher wiederverwendet. Drei aufeinanderfolgende Quellenausfälle beenden den Lauf. Eine gealterte Cookie-Sitzung wird nicht durch eine erneute Seitenabfrage verlängert, sondern beendet den Teilabruf.
- Am längsten nicht versuchte Symbole kommen zuerst. Ein abgeschlossener, aber fehlerhafter Versuch wird mitgezählt, damit eine einzelne defekte Firma nicht dauerhaft alle nachfolgenden Firmen verdrängt. Ein am Abruflimit unterbrochenes Symbol bleibt für die Fortsetzung vorn. Einträge werden mit `mergeObservation` ergänzt, mit `assertAppendOnly` geprüft und mit `serialiseStore` atomar geschrieben. Frühere Quellen und Beobachtungen bleiben erhalten. Vor dem Schreiben wird außerdem kontrolliert, dass kein anderer Lauf die Datei verändert hat.
- Revisionen folgen der bereits verwendeten Zeitregel: spätester Zeitpunkt aus Veröffentlichung, Erzeugung und Revision, dann die höhere laufende Kennung. `filed` und das tatsächlich verwendete Zeitfeld werden gespeichert. Bei fehlender `broadcast_Date` wird die spätere Erzeugungs-/Revisionszeit offen als Ersatz bezeichnet. `availableAfter` verhindert, dass eine Revision rückwirkend den ursprünglichen Meldetag erbt. Gleiche Kalendertage werden nach der vollständigen Uhrzeit geordnet.
- T7 bleibt ausdrücklich erhalten: Daten sind erst ab dem folgenden NSE-Handelstag verwendbar. Der Schattenvergleich lässt am Meldetag keinen Wert zu. Im Speicher steht die Handelsregel, kein geratener Werktag. Da kein Leser aktiviert wird, ist noch kein Börsenkalender in eine Board-Berechnung eingebunden; diese Prüfung gehört vor einen späteren Schritt 3.
- 493 `.BO`-Notierungen werden anhand eindeutig gleicher vollständiger Firmennamen der Beobachtungsliste einem `.NS`-Schlüssel zugeordnet; die Begründung steht je Alias im Speicher. 77 `.BO`-Notierungen bleiben ohne eindeutige Zuordnung. Das ist eine nachvollziehbare Namenszuordnung für den Schatten, keine separat belegte ISIN-Zuordnung. Es wird weder ein Börsenkürzel geraten noch ein Firmenname verkürzt.
- `.github/workflows/nse-quarters.yml` ist ein eigener manueller Schattenlauf mit ausschließlich lesenden Repository-Rechten. Er stellt Speicher und Bericht als Artefakt bereit. Er committet, pusht und veröffentlicht keine Boards. Ohne zugelieferte Yahoo-Snapshots weist sein Bericht diese Vergleiche als `unchecked` aus; der vollständige Vergleich mit dem gesicherten Datentag erfolgt lokal.

## Prüfung und Übergabe

**61 / 61 eigene Tests bestanden**, keine ausgelassenen Tests. Die Originalausschnitte umfassen zwei Firmen und je Konzern-, Einzelabschluss- und Governance-Meldung. Die große Lupin-Einzelabschlussdatei wurde auf 3.863 Byte gekürzt. Original- und Ausschnitthashes sind im Fixture-Manifest hinterlegt.

Die gezielten Bruchfälle decken unter anderem beide Konzernsperren, Governance, Halbjahr, Vergleichsspalten, abweichende Perioden, Dimensionen, fehlenden Umsatz, Null gegen 0, Währung, Skalierung, Einheit, doppelte Fakten, Revisionen, Meldetag, Fremdhost, abgeschnittene Listen, Abruflimit, Cookies, Dateizugriff, Anhängeschutz, beide Schwellen und fehlende Gegenquartale ab. Brüche bleiben im Speicher; schreibende Tests sind keine Bruchziele. SHA-256 der echten Store- und Leserdateien wird vor und nach jedem Test verglichen.

Zusätzlich bestanden: Syntaxprüfung aller drei neuen Module, Dokumentationsprüfung der Bibliotheksexporte (`fehlend=0`) und `git diff --check`. Der volle Test-Gate-Lauf wurde entsprechend dem Brief nicht gestartet. Es gibt noch keine fremde Freigabe.

**Schritt 3 wurde nicht gebaut**, weil 50 % die geforderten mindestens 95 % unterschreiten und der vollständige Quellenlauf noch fehlt. `lib/g31-recency.js`, `protocol/gqs-00/1.2.0-pending/transition.json`, `scripts/fetch-exchange-quarters.js`, `.github/workflows/exchange-quarters.yml` und `lib/exchange-quarter-check.js` sind unverändert. Keine neue Abhängigkeit.

Für Claudes ersten Live-Teilabruf im Klon:

```text
node scripts/fetch-nse-quarters.js --cap=200 --symbols=20
node scripts/nse-shadow-report.js --snapshots=<gesicherter Snapshot-Ordner> --as-of=2026-11-11 --json=<neue Berichtsdatei>
```

Weitere Teilabrufe ergänzen denselben Speicher. Vor Schritt 3 muss der Vergleich auf dem vollständiger erfassten Bestand erneut gerechnet werden. Das globale Tor allein genügt nicht: Für jede Firma müssen sämtliche anderen vorhandenen Quartale innerhalb des Achtquartalsfensters ebenfalls auf 1 % stimmen. Anschließend folgen die gesonderte Änderung, Protokollregistrierung und Blindprüfung.

Im Ablageordner liegen zusätzlich `shadow-2026-11-11.json`, `shadow-2026-11-11.md` und dieser Bericht. Die ausführlichen Dateien enthalten sämtliche Vergleichszeilen; die entscheidenden Ergebnisse stehen oben. Alle Repo-Änderungen sind uncommitted zur Prüfung übergeben.

## Erster Netzlauf und Korrektur (Claude, 12.11.2026, gemessen mit Uhr 13:45 bis 13:49 MEZ)

- Zwei Läufe mit `--cap=200 --symbols=20` (zusammen 110 Abrufe): 12 Firmen, 80 Firmenquartale im Speicher `external-data/exchange-quarters/in.json` (ersetzt den aus den Test-Fixtures abgeleiteten Stand).
- **Fehler im Bau, behoben:** Das Listenfeld `type_Sub` heißt bei Nachmeldungen live `Revision`, nicht `Revised` (gemessen an AADHARHFC, AARTIIND, 360ONE; `broadcast_Date` ist dort null, die Zeit steht in `revised_Date`). Der Bau verwarf deshalb jede Firma mit einer Nachmeldung (`Unbekannte Meldungsfassung`). Jetzt werden `Original`, `Revised` und `Revision` angenommen, alles andere bricht weiter ab; neuer Test.
- **Drosselung:** Nach etwa 10 bis 12 Firmen (rund 50 Abrufe) antwortet NSE mit `ECONNRESET`; drei Ausfälle in Folge beenden den Lauf. Ein Lauf schafft also etwa 12 Firmen. Für 700 Firmen braucht es viele Läufe über mehrere Tage oder einen Neustart der Sitzung nach einem Reset (nicht gebaut). Zusätzlich einmal `Datei gehoert zu anderem Symbol` bei ACUTAAS.NS 2025-03-31 (abgelehnt, richtig so).
- **Schattenvergleich** gegen die gesicherten Yahoo-Snapshots (`sd-halbjahr-data/snap`, 16.426 Dateien), Stand 12.11.: Firmenquartale 44 agree / 13 disagree / 23 nse-only (genau die Lücken, die Yahoo nicht liefert) = **77,19 %** Übereinstimmung unter den vergleichbaren; Befundzeilen 14 agree / 1 disagree / 5 nse-only = 93,33 %. Septemberpaar vorhanden für 3 von 84 Zeilen, nach dem 95-%-Tor 0. Abweichungen: ABDL 81 bis 93 % (vermutlich anderer Umsatzbegriff bei Yahoo, nicht untersucht), ADANIGREEN 1,6 bis 7,6 %, ABB 1 bis 2 %, ACUTAAS 2,5 %.
- Folge: Das Tor von Schritt 3 (mindestens 95 % Übereinstimmung) ist mit diesem kleinen Ausschnitt nicht erfüllt; die Quelle schließt die Yahoo-Lücken (23 nse-only), aber die Abweichungen müssen erst erklärt werden (Umsatzbegriff, Nachmeldungen) und der Lauf braucht eine Strategie gegen die Drosselung.
