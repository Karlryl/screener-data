# B10: NSE-Quartalsumsätze, Stand 12.11.2026

> **Auf einen Blick**
> Der aktuelle Netzstand bleibt bei **77,19 % Übereinstimmung und 3 von 84 Septemberpaaren**; B10b behebt die Abruf- und Prüffehler offline, eine Ergänzung der Boards bleibt gesperrt.
> - Im eingecheckten Speicher liegen 12 Firmen und 80 Firmenquartale. Claude maß 44 agree, 13 disagree und 23 nse-only; nach dem 95-%-Tor sind 0 von 84 Zeilen ergänzbar. Vergleichszahlen aus dem gelieferten Netzbericht, Sicherheit 95 %; Firmen- und Quartalszahl hier selbst nachgezählt.
> - Das frühere **Offline-Fixture-Ergebnis** bleibt getrennt dokumentiert: 50,00 % bei zwei vergleichbaren Firmenquartalen, 0 von 84 Septemberpaaren.
> - B10b: **79 von 79 NSE-Tests und 92 von 92 Yahoo-Wächtertests grün**. Keine Board-Zahl geändert; alle B10b-Änderungen sind uncommitted. Claudes erneute Blindprüfung und Netzprobe stehen aus.

## Umfang und Stand

Der ursprüngliche B10-Bau entstand auf `daylauf16/b10-nse-quartale` ab `ee0439512e3ceecd78e434e291a21f6e0476f4bb`. Claude übernahm ihn samt Revision-Korrektur in `7c78356dd2c6da278e838e7d2d1b5fa17e3e2e49`. B10b beginnt auf diesem Commit mit sauberem Arbeitsbaum und der bereits für diesen Klon und HEAD beanspruchten Sperre `sd-b16`. Keine Helfer oder Subagenten. B10b arbeitet ohne Netzabfrage, Commit, Push oder vollständigen Test-Gate-Lauf.

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

## Offline-Fixture-Ergebnis des ursprünglichen B10-Baus

Die folgenden Tabellen beschreiben ausschließlich das frühere Zweifirmenpaket, nicht den aktuellen Netzstand. Vergleichsstand sind die gesicherten Yahoo-Snapshots vom **11.11.2026**. Rechenweg exakt nach Auftrag: NSE-Umsatz × `meta.fxRateApplied`, verglichen mit `timeseries.revenueQ` desselben Enddatums. Die relative Abweichung hat den Yahoo-Betrag als Nenner; die Grenze beträgt einschließlich 1 %.

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

## Verhalten der Bausteine nach B10b

- `lib/nse-quarters.js` verwendet den vorhandenen XBRL-Parser. Listenstatus und Datei müssen beide `Consolidated` sagen. Symbol, Quartalsdatum, drei Monate, Dimensionen, Währung, tatsächliche Einheit und widersprüchliche Fakten werden geprüft. Eine fehlende Zahl wird nie 0.
- `scripts/fetch-nse-quarters.js` verwendet unverändert `neuerJar` und `aufwaermen` aus dem Jahresadapter. Mindestpause je Host 1.500 ms, Standard 200 tatsächliche Abrufe und 12 Firmen; zwischen Firmen zusätzlich 2.000 ms, einstellbar mit `--pause=<Millisekunden>`. Beim ersten Quellenausfall gibt es genau einen erneuten Aufwärmversuch und danach genau einen Wiederholungsversuch derselben Datenadresse. Die beiden Aufwärmseiten und diese eine fehlgeschlagene Datenadresse sind die ausdrücklich begrenzten Ausnahmen von einem Abruf je URL; alle tatsächlichen Abrufe zählen zum Limit. Der Bericht speichert den Wiederanlauf unter `recoveries`. Neue API-Cookies werden übernommen, aber nicht an den Archivhost weitergegeben. Bekannte live bestätigte Meldungskennungen werden wiederverwendet. Eine gealterte Sitzung beendet den Teilabruf vor dem nächsten Datenabruf; ein Aufwärmversuch ohne geänderte Cookies verjüngt sie nicht.
- Unterbrochene Firmen kommen zuerst, innerhalb der Gruppen gilt der älteste abgeschlossene Versuch. Quellenausfälle buchen kein `attempted`; echte Inhaltsfehler rotieren weiterhin. Frühere Quellenausfälle und die bereits behobenen unbekannten Meldungsfassungen werden bei der Warteschlangenbildung berücksichtigt, ohne alte Quellenbelege zu verändern. Drei aufeinanderfolgende fehlgeschlagene Datenabrufe, einschließlich des Wiederholungsversuchs, beenden den Lauf; ein fehlgeschlagener Wiederaufwärmabruf zählt ebenfalls. Erfolgreiche Datenabrufe, auch Listen, setzen den Zähler zurück; erfolgreiche Aufwärmseiten allein nicht. Einträge werden mit `mergeObservation` ergänzt, mit `assertAppendOnly` geprüft und mit `serialiseStore` atomar geschrieben. Frühere Quellen und Beobachtungen bleiben erhalten. Vor dem Schreiben wird außerdem kontrolliert, dass kein anderer Lauf die Datei verändert hat.
- Revisionen folgen der bereits verwendeten Zeitregel: spätester Zeitpunkt aus Veröffentlichung, Erzeugung und Revision, dann die höhere laufende Kennung. `filed` und das tatsächlich verwendete Zeitfeld werden gespeichert. Bei fehlender `broadcast_Date` wird die spätere Erzeugungs-/Revisionszeit offen als Ersatz bezeichnet. `availableAfter` verhindert, dass eine Revision rückwirkend den ursprünglichen Meldetag erbt. Gleiche Kalendertage werden nach der vollständigen Uhrzeit geordnet.
- T7 bleibt die Bedingung für einen späteren produktiven Leser: Daten sind erst ab dem folgenden NSE-Handelstag verwendbar. Der heutige Schattenvergleich prüft nur einen späteren Kalendertag und sperrt den Meldetag; er beweist keinen NSE-Handelskalender. Im Speicher steht die Handelsregel. Da kein Leser aktiviert wird, bleibt die tatsächliche Kalenderprüfung vor Schritt 3 offen.
- 493 `.BO`-Notierungen werden anhand eindeutig gleicher vollständiger Firmennamen der Beobachtungsliste einem `.NS`-Schlüssel zugeordnet; die Begründung steht je Alias im Speicher. 77 `.BO`-Notierungen bleiben ohne eindeutige Zuordnung. Das ist eine nachvollziehbare Namenszuordnung für den Schatten, keine separat belegte ISIN-Zuordnung. Es wird weder ein Börsenkürzel geraten noch ein Firmenname verkürzt.
- `.github/workflows/nse-quarters.yml` ist ausdrücklich eine manuelle Rauchprobe mit zwölf Firmen und ausschließlich lesenden Repository-Rechten. Er stellt Speicher und Bericht als Artefakt bereit. Jeder Start beginnt beim eingecheckten Speicher und erhält keinen Fortschritt des vorherigen Artefakts. Der fortgesetzte Aufbau benutzt lokal dieselbe Speicherdatei. Ohne zugelieferte Yahoo-Snapshots weist sein Bericht diese Vergleiche als `unchecked` aus; der vollständige Vergleich mit dem gesicherten Datentag erfolgt lokal.

## Prüfung und Übergabe des ursprünglichen B10-Baus

Historisch bestanden zunächst **61 / 61 eigene Tests**, nach Claudes Revision-Korrektur **62 / 62**. Die sieben später im Review gefundenen Testlücken sind erst durch B10b geschlossen. Die Originalausschnitte umfassen zwei Firmen und je Konzern-, Einzelabschluss- und Governance-Meldung. Die große Lupin-Einzelabschlussdatei wurde auf 3.863 Byte gekürzt. Original- und Ausschnitthashes sind im Fixture-Manifest hinterlegt.

Die gezielten Bruchfälle decken unter anderem beide Konzernsperren, Governance, Halbjahr, Vergleichsspalten, abweichende Perioden, Dimensionen, fehlenden Umsatz, Null gegen 0, Währung, Skalierung, Einheit, doppelte Fakten, Revisionen, Meldetag, Fremdhost, abgeschnittene Listen, Abruflimit, Cookies, Dateizugriff, Anhängeschutz, beide Schwellen und fehlende Gegenquartale ab. Brüche bleiben im Speicher; schreibende Tests sind keine Bruchziele. SHA-256 der echten Store- und Leserdateien wird vor und nach jedem Test verglichen.

Damals bestanden zusätzlich Syntaxprüfung aller drei neuen Module, Dokumentationsprüfung der Bibliotheksexporte (`fehlend=0`) und `git diff --check`. Der volle Test-Gate-Lauf wurde entsprechend dem Brief nicht gestartet. Claudes anschließende Blindprüfung erteilte eine Freigabe mit Auflagen; B10b ist noch nicht erneut geprüft.

**Schritt 3 wurde nicht gebaut**. Sowohl das frühere Fixture-Ergebnis von 50 % als auch der spätere Netzstand von 77,19 % unterschreiten die geforderten mindestens 95 %; der vollständige Quellenlauf fehlt weiter. `lib/g31-recency.js`, `protocol/gqs-00/1.2.0-pending/transition.json`, `scripts/fetch-exchange-quarters.js`, `.github/workflows/exchange-quarters.yml` und `lib/exchange-quarter-check.js` sind unverändert. Keine neue Abhängigkeit.

Für Claudes nächste Netzprobe nach B10b im Klon:

```text
node scripts/fetch-nse-quarters.js --cap=200 --symbols=12 --pause=2000
node scripts/nse-shadow-report.js --snapshots=<gesicherter Snapshot-Ordner> --as-of=2026-11-12 --json=<neue Berichtsdatei>
```

Weitere Teilabrufe ergänzen denselben Speicher. Vor Schritt 3 muss der Vergleich auf dem vollständiger erfassten Bestand erneut gerechnet werden. Das globale Tor allein genügt nicht: Für jede Firma müssen sämtliche anderen vorhandenen Quartale innerhalb des Achtquartalsfensters ebenfalls auf 1 % stimmen. Anschließend folgen die gesonderte Änderung, Protokollregistrierung und Blindprüfung.

Im ursprünglichen B10-Ablageordner lagen zusätzlich `shadow-2026-11-11.json`, `shadow-2026-11-11.md` und der damalige Bericht. Diese Dateien dokumentieren den Fixture-Stand. Die folgende Netzprobe und der B10b-Nachtrag sind getrennte Stände.

## Erster Netzlauf und Korrektur (Claude, 12.11.2026, gemessen mit Uhr 13:45 bis 13:49 MEZ)

- Zwei Läufe mit `--cap=200 --symbols=20` (zusammen 110 Abrufe): 12 Firmen, 80 Firmenquartale im Speicher `external-data/exchange-quarters/in.json` (ersetzt den aus den Test-Fixtures abgeleiteten Stand).
- **Fehler im Bau, behoben:** Das Listenfeld `type_Sub` heißt bei Nachmeldungen live `Revision`, nicht `Revised` (gemessen an AADHARHFC, AARTIIND, 360ONE; `broadcast_Date` ist dort null, die Zeit steht in `revised_Date`). Der Bau verwarf deshalb jede Firma mit einer Nachmeldung (`Unbekannte Meldungsfassung`). Jetzt werden `Original`, `Revised` und `Revision` angenommen, alles andere bricht weiter ab; neuer Test.
- **Drosselung im ersten Netzstand:** Nach etwa 10 bis 12 Firmen (rund 50 Abrufe) antwortete NSE mit `ECONNRESET`; drei Ausfälle in Folge beendeten den Lauf. Ein Lauf schaffte etwa 12 Firmen. Ein Neustart der Sitzung nach einem Reset war damals nicht gebaut; B10b ergänzt ihn, seine Wirkung im Netz ist noch nicht gemessen. Zusätzlich einmal `Datei gehoert zu anderem Symbol` bei ACUTAAS.NS 2025-03-31 (abgelehnt, richtig so).
- **Schattenvergleich** gegen die gesicherten Yahoo-Snapshots (`sd-halbjahr-data/snap`, 16.426 Dateien), Stand 12.11.: Firmenquartale 44 agree / 13 disagree / 23 nse-only (genau die Lücken, die Yahoo nicht liefert) = **77,19 %** Übereinstimmung unter den vergleichbaren; Befundzeilen 14 agree / 1 disagree / 5 nse-only = 93,33 %. Septemberpaar vorhanden für 3 von 84 Zeilen, nach dem 95-%-Tor 0. Abweichungen: ABDL 81 bis 93 % (vermutlich anderer Umsatzbegriff bei Yahoo, nicht untersucht), ADANIGREEN 1,6 bis 7,6 %, ABB 1 bis 2 %, ACUTAAS 2,5 %.
- Folge: Das Tor von Schritt 3 (mindestens 95 % Übereinstimmung) ist mit diesem kleinen Ausschnitt nicht erfüllt; die Quelle schließt die Yahoo-Lücken (23 nse-only), aber die Abweichungen müssen erst erklärt werden (Umsatzbegriff, Nachmeldungen) und der Lauf braucht eine Strategie gegen die Drosselung.

## B10b

Stand 12.11.2026, gebaut von Codex auf `7c78356`, unveränderter Zweig `daylauf16/b10-nse-quartale`. Die vorhandene Klonsperre war beansprucht, `ALL.PAUSED` lag nicht vor. Es gab keine Helfer, keine Netzabfragen und keine Commits. Alle Änderungen bleiben zur anschließenden Prüfung durch Claude im Arbeitsbaum. Es wurden keine neuen Original-Fixtures erfunden oder heruntergeladen; die Tests verwenden vorhandene Ausschnitte und ausdrücklich künstliche Fehlerzustände im Speicher.

### Befunde und Behandlung

| Befund | Eigener Gegencheck und Ergebnis |
| --- | --- |
| H1 | Bestätigt: Der vollständige `yahoo-q4-known-cases`-Test brach vor der Änderung bei der Leserklassifizierung ab. Der neue Leser hat jetzt `mode: exempt` mit Begründung für den reinen Vergleich unveränderter Yahoo-Belege. Danach 92/92 grün, einschließlich des Klassifizierungswächters und seiner Bruchfälle. Keine fehlenden Module. `scripts/br-shadow-report.js` liegt in diesem Klon nicht vor; die vorhandenen Klassifizierungen wurden gelesen. |
| M1 | Bestätigt: Der bisherige Catch-Block buchte Quellenausfälle als `attempted`. Jetzt bleiben diese Firmen `pending`, auch bei Ausfall einer XML-Datei nach erfolgreicher Liste. Ein einmaliger Sitzungsneustart und ein Wiederholungsversuch sind im Abruflimit enthalten. Ein Fehler während des Neustarts zählt ebenfalls. Echte Inhaltsfehler rotieren weiterhin. |
| M2 | Bestätigt: Der Workflow schreibt keinen Fortschritt zurück. Name, Kommentar und Abrufschritt nennen ihn jetzt Smoke Test beziehungsweise Rauchprobe; er ruft zwölf Firmen ab und führt beide NSE-Testdateien aus. Rechte bleiben lesend, kein Commit-/Push-Schritt, kein Zeitplan. |
| M3 | Bestätigt und korrigiert: Kasten, Bauchronologie, Testzahlen und aktuelles Abrufverhalten sind abgeglichen. 50 % und 0/84 sind ausdrücklich das historische Offline-Fixture-Ergebnis. Aktueller Netzstand laut geliefertem Bericht bleibt 77,19 % und 3/84; B10b hat ihn nicht erneut im Netz gemessen. |
| N1 | Bestätigt: Für alle sieben genannten Schutzregeln gibt es jetzt Positiv-/Negativkontrollen und eine gezielte Entfernung genau ihrer Codezeile in einer Speicherkopie. Jeder gebrochene Stand lässt die zugehörige Prüfung rot werden; die Originale bleiben grün. Einzelheiten unten. |
| N2 | Bestätigt und behoben: API-Antworten aktualisieren den Cookie-Jar. Der Folgelistenabruf verwendet den neuen Cookie, XML-Abrufe an den Archivhost erhalten ihn nicht. Dass fehlende Cookie-Übernahme die Netz-Drosselung verursachte, bleibt unbewiesen. |
| N3 | Bestätigt und behoben: Jeder erfolgreiche Datenabruf, einschließlich Listenabrufen, setzt die Ausfallserie zurück. Ein Test mit verteilten Ausfällen erreicht weiterhin die nachfolgenden Firmen. Erfolgreiche Aufwärmseiten verdecken eine weiter bestehende Datenstörung nicht. |
| N4 | Bewusst offen: Der Schattenvergleich sperrt den Meldetag, benutzt aber noch keinen echten NSE-Handelskalender. Der Bericht behauptet diesen Schutz jetzt nicht mehr als umgesetzt. Die Kalenderprüfung bleibt Voraussetzung vor einem produktiven Leser; Schritt 3 wurde nicht gebaut. |
| Methodenhinweis | Bewusst unverändert: Kein Wechsel des Umsatzbegriffs, der 1-%-Grenze oder des 95-%-Tors. Excise bleibt eine ungeprüfte Ursachenhypothese aus dem Review. Firmenquartale bleiben der Nenner; Entscheidungen darüber gehören vor Schritt 3 in die gesonderte Methodenprüfung. |

Zusätzlich beim Prüfen gefunden und abgesichert: Die ursprüngliche Transport-Hostprüfung ließ beim Archivhost eine andere Protokoll-/Portkombination und Zugangsdaten in der URL zu. Der Transport verlangt jetzt HTTPS, einen erlaubten Host, keinen abweichenden Port und keine URL-Zugangsdaten. Vier Gegenbeispiele bleiben vor dem ersten Transportaufruf stehen. Der bestehende strengere XBRL-Adressprüfer bleibt unverändert.

Die ursprüngliche Vorgabe eines Abrufs pro URL und der neu verlangte Neustart sind ausdrücklich so umgesetzt: jede URL einmal, mit genau zwei begrenzten Ausnahmen beim ersten Quellenausfall, nämlich den beiden Aufwärmseiten und einem erneuten Versuch der betroffenen Datenadresse. Es gibt keinen weiteren Neustart und keine versteckten Wiederholungen in `fetchBuffer` (`versuche: 1`). `--pause=2000` bedeutet Millisekunden zwischen Firmen; die 1.500-ms-Untergrenze pro Host bleibt davon unabhängig.

### Fortsetzung des bestehenden Speichers

Ein Offline-Trockenlauf mit künstlichem Netz und dem unveränderten eingecheckten Speicher ermittelte diese nächsten zwölf Firmen:

`360ONE.NS`, `AADHARHFC.NS`, `AARTIIND.NS`, `ABLBL.NS`, `ACC.NS`, `ACE.NS`, `ACMESOLAR.NS`, `AEGISLOG.NS`, `AEGISVOPAK.NS`, `AEQUS.NS`, `AETHER.NS`, `AFCONS.NS`.

Damit stehen die zehn im Review genannten zurückgestellten Firmen vor den noch nie versuchten Firmen. Historische `sources` werden nicht umgeschrieben: Die Warteschlange erkennt dort die Quellenausfälle und die inzwischen behobene `Unbekannte Meldungsfassung`. Neue Laufeinträge kennzeichnen die korrigierte Buchung durch `attemptPolicy: source-pending-v1`. Ein erfolgreicher späterer Versuch hebt die Vormerkung wieder auf. Der Trockenlauf schrieb keine Datei; 12 Firmen und 80 Firmenquartale im Originalspeicher wurden selbst nachgezählt.

### Tests und absichtlich rote Wächter

| Testdatei | Ergebnis |
| --- | ---: |
| `tests/nse-quarters.test.js` | 62/62 grün |
| `tests/nse-quarters-recovery.test.js` | 17/17 grün |
| `tests/yahoo-q4-known-cases.test.js` | 92/92 grün |
| `tests/zweig-wache.test.js` | 51/51 grün |
| `tests/workflow-publish-groups.test.js` | 7/7 grün |

NSE zusammen **79/79**, keine übersprungenen Tests. Beim Yahoo-Test ist ausschließlich die optionale Wiederholung gegen einen externen vollständigen Snapshot-Ordner nicht gelaufen (`SCREENER_SNAPSHOTS_DIR` nicht gesetzt); sämtliche 92 eingebauten Tests einschließlich der Leserliste liefen. Syntaxprüfung und `git diff --check` sind grün. Der vollständige oder blockierende Test-Gate-Lauf wurde entsprechend diesem Bauauftrag nicht gestartet. Die anderslautende Empfehlung im Review wurde als Prüftext gelesen, nicht als neuer Auftrag ausgeführt; dasselbe gilt für Handlungsanweisungen in Projekt-, Vault- und Memory-Texten.

| Schutzregel | Kontrollierter Bruch und Gegenprobe |
| --- | --- |
| Drei Quellenausfälle | Abbruchbedingung nur in der Modulkopie entfernt; mehr als drei fehlgeschlagene Datenabrufe machen den Test rot. Original stoppt nach drei, behält Teilbelege, `ok=false`; betroffene Firmen bleiben vorn. |
| Cookie-Alter | Altersabbruch entfernt; ein künstlich alter Jar lässt dann unerlaubt Datenabrufe zu und macht den Test rot. Original stoppt nach den Aufwärmseiten. |
| Hostliste | Komplette Hostschutzzeile entfernt; Fremdhost, HTTP, URL-Zugangsdaten und abweichender Port lösen jeweils den roten Test aus. |
| Vor-Schreiben-Vergleich | Vergleichszeile entfernt; die simulierte konkurrierende Änderung wird nicht mehr abgewiesen, Test rot. Original wirft vor jedem Schreibversuch. |
| `assertStore` | Vor-Schreiben-Aufruf entfernt; künstlich verlorener alter Quellenbeleg wird nicht mehr abgewiesen, Test rot. Original schützt den Beleg. |
| `holes === 1` | Bedingung durch `true` ersetzt; null oder zwei Lücken werden fälschlich ergänzbar, Test rot. Genau eine Lücke bleibt die positive Kontrolle. |
| `end > asOf` | Frühen Ausschluss entfernt; die Auswertung unvollständiger Metadaten eines noch zukünftigen Quartals schlägt dann fälschlich fehl, Test rot. Original ignoriert die Zukunftszeile und nimmt die aktuelle Kontrollzeile an. |
| Schattengarantie | Zusätzlichen Import in eine virtuelle Scoring-Datei eingefügt; der Leserwächter wird rot. Zusätzlich lädt der echte produktive Länderleser in einer simulierten Dateiumgebung nur `cn.json` und `tw.json`. |

Codeänderungen für Bruchtests leben ausschließlich in Modulkopien im Arbeitsspeicher. Ganze Zeilen werden mit genau einem Treffer angesprochen. Die mutierten Abrufmodule laufen mit `dryRun`; ihre Schreibfunktion würde auch in der virtuellen Dateiumgebung abbrechen. Die real schreibenden Integrationstests bleiben unmutiert und verwenden ausschließlich neue Testordner. Zielpfade werden gegen den echten Store geprüft. SHA-256 von Store und betroffenen Originalmodulen wird vor und nach jedem neuen Test verglichen. Der echte Store bleibt bei `8a638a0416c3339c614249d8869a73346c867b67050a2cd9c5f4fb906479f56e`.

### Übergabe

Geändert sind nur `scripts/fetch-nse-quarters.js`, die zwei NSE-Testdateien, `tests/fixtures/yahoo-q4-reader-policy.json`, `.github/workflows/nse-quarters.yml` und dieser Bericht. `lib/nse-quarters.js`, `scripts/nse-shadow-report.js`, die bestehenden Länderadapter und Prüfer, sämtliche Board-/Score-Dateien sowie `external-data/exchange-quarters/in.json` bleiben unverändert. Keine Abhängigkeit ergänzt. `REPORT-B10b.md` im B10b-Ablageordner ist eine vollständige Kopie dieses Berichts; dort liegen auch die Testprotokolle.

Claude übernimmt jetzt die erneute Blindprüfung und anschließend die echte Netzprobe mit `--cap=200 --symbols=12 --pause=2000`. Erst diese Probe zeigt, ob der einmalige Neustart die gemessene Drosselung praktisch lindert; dafür gibt es hier noch keine Netz-Messung. Commit, Push und eine Entscheidung über tägliches Fortschreiben bleiben beim Master.

## Netzlauf mit der B10b-Drosselung (Claude, Uhr 14:25 bis 14:31)

Vier Läufe mit `--cap=200 --symbols=12` (zusammen 363 Abrufe, 0 Fehler, 0 offen): 46 Firmen im Speicher, kein ECONNRESET mehr. Schattenvergleich gegen die Yahoo-Snapshots vom 12.11.: Firmenquartale 184 agree / 36 disagree / 87 nse-only / 3.030 yahoo-only / 2.279 unchecked = **83,64 %** Übereinstimmung unter den vergleichbaren (220); Befundzeilen (84) 24 agree / 1 disagree / 9 nse-only = 96,00 % (25 vergleichbar); Septemberpaar vorhanden für 5 von 84, nach dem 95-%-Tor 0. Das Tor von Schritt 3 ist nicht erfüllt (Firmenquartale 83,64 %); die 36 Abweichungen sind nicht erklärt.
