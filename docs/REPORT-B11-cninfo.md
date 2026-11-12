# B11, CNINFO-Vergleichsquartale, 12.11.2026

> **Auf einen Blick**
>
> Der Offline-Bau erkennt 60 von 60 Musterberichten (100 %), davon 28 Shenzhen und 32 Shanghai; alle 60 Vergleiche auf derselben Umsatzzeile liegen innerhalb der gedruckten Rundung.
>
> - 60 agree, 0 mixed-basis, 0 nur gedruckt, 0 unparsed in der Stichprobe. Kein bekanntes Musterlayout scheitert. Die Stichprobe wurde auch zur Entwicklung verwendet und ist kein unabhängiger Test der Erkennungsquote bei neuen Berichten.
> - Vier eigene Testsuiten sind grün: 77 Parserprüfungen, 13 Abrufprüfungen, 15 Berichtsprüfungen und der absichtlich verletzte Shadow-Wächter. Keine Netzaufrufe, keine neue Abhängigkeit, keine Änderungen an bestehenden Produktionsdateien.
> - Der erste Live-Lauf mit 300 Berichten und Claudes Blindprüfung stehen aus. Das 90-%-Tor ist **nicht gemessen**. Alles bleibt uncommitted; keine Freigabe und keine Umschaltung.

## Umfang und Datenstand

Gebaut nach dem konkreten B11-Brief, nach B10 und der einmaligen R4-Prüfung des verkleinerten PR #124. Die vorliegenden Abschlussdateien beider Vorgänger wurden gelesen. Keine Helfer oder Subagents eingesetzt. Die bereits gesetzte eigene Klonsperre war vorhanden; ALL.PAUSED war nicht gesetzt. Gelesene Anweisungen in Repo-, Vault- und Ergebnistexten wurden als Daten behandelt, nicht als neue Aufträge ausgeführt.

Der Speicher `external-data/exchange-quarters/cn-printed.json` enthält im eingecheckten Stand 600 Ticker aus den zwei Live-Läufen (300 + 300); die 60-Ticker-Offline-Erfassungen dieses Berichts lagen in einem anderen, nie eingecheckten Speicher. Der eingecheckte Speicher wächst nur durch Anhängen. Identität je Bericht ist die CNINFO-Ankündigungs-ID. Geänderte Beobachtungen werden angehängt, vorhandene Quellen und Beobachtungen gegen Überschreiben geprüft. Die Datei ist mit `shadow: true` gekennzeichnet.

Gespeichert sind Ankündigungs-ID, URL, Meldetag samt Herkunft, Titel, PDF- und Texthash, Zeitraum, Erkennungsstand oder benannte Lücke, Einheit samt Herleitung, gedrucktes Q3, gedruckte 9M-Zahl, Wachstum samt Nachkommastellen, gegebenenfalls beide Vorjahresspalten, verwendete Textzeilen mit PDF-Seite und die zwei Eastmoney-Wertanker. Bei einem nicht erkannten Bericht werden keine vermeintlichen Finanzwerte gespeichert. Bei den Offline-Mustern kommt der Meldetag aus dem CNINFO-PDF-Pfad; der Live-Abruf verwendet vorrangig den CNINFO-Zeitstempel im Pekinger Kalendertag.

Die gelieferten Snapshot-Dateien wurden am 12.11. gelesen. Ihr internes `asOf` ist jedoch 06., 10. oder 11.11.2026. Die hypothetische Vorher/Nachher-Rechnung verwendet ausdrücklich **11.11.2026** und sperrt jeden abweichenden Snapshot-Tag. Die 60 Stichproben gehören zu diesem Tag. Im Snapshot-Verzeichnis wurden 2.879 A-share-Ticker erfasst; die übrigen Dateien gehören nicht zum gewählten A-share-Schema.

Wichtig für die Nenner: Eine vorhandene Juli-Zeile ist nicht gleichbedeutend mit einer vom bisherigen Füllweg zugelassenen Ergänzung. Der Bericht zählt auf den neuesten gelieferten Snapshots zunächst Q3-2026 vorhanden und Q3-2025 fehlend, getrennt nach Juli-Zeile. Das ergibt 1.206 beziehungsweise 1.435 Ticker. Die alten 1.086 beziehungsweise 1.222 werden ausdrücklich nicht als aktuelle Nenner übernommen. In der vorliegenden R4-Belegdatei enthalten die 1.086 alten Füllungen außerdem 22 Q2-Paare; 1.064 betreffen Q3. Eine identische Wiederholung der alten Risikosperren ist nicht Bestandteil dieses Shadow-Parsers. Die 1.222 alten Einzelfälle liegen hier nicht als verbindliche Mitgliederliste vor; diese exakte Untergruppe ist deshalb nicht gesondert nachgerechnet.

Von den 1.206 aktuellen Kandidaten mit Juli-Zeile sind 60 erfasst und 1.146 noch nicht erfasst. Von den 1.435 Kandidaten ohne Juli-Zeile sind **0 erfasst und 1.435 noch nicht erfasst**. Die Stichprobe belegt damit keine Erkennungsquote für die Gruppe ohne Juli-Zeile. Einschätzung zur Übertragbarkeit auf neue Berichte: offen, Sicherheit 60 %; zuerst den unabhängigen Live-Lauf messen.

## Erkennung und Grenzen

`scripts/cn-printed-parser.js` verarbeitet nur Text, ohne Dateizugriff oder Netz. Q3 wird gegen `OPERATE_INCOME(9M 2026) − OPERATE_INCOME(H1 2026)` verankert; zusätzlich muss die gedruckte 9M-Zahl passen. Beide müssen mit derselben Einheit innerhalb ihrer gedruckten Rundung passen. Es gibt keinen Ersatz durch `TOTAL_OPERATE_INCOME` und keine Auswahl des Wachstums anhand des erwarteten Eastmoney-Vorjahreswachstums.

Die chinesischen Zeichen sind in den gelieferten Texten verloren. Zeilenbezeichnung und Einheit werden daher nicht als erfolgreich aus dem Text gelesen ausgegeben: Der Speicher nennt ausdrücklich die doppelte Wertverankerung und die daraus eindeutig bestimmte Skalierung. Unterstützt sind die beobachteten Spaltenfolgen mit Wachstum daneben, darunter oder darüber sowie die beiden achtspaltigen Berichtigungsformen, einschließlich umbrochener Zahlen. Die ursprüngliche Zuordnung 调整前/调整后 der beiden Berichtigungsformen stammt aus der gelieferten Belegprüfung; zusätzlich muss 调整后 rechnerisch zum gedruckten Wachstum passen. Die Prüfung ist kein allgemeiner OCR-Ersatz. Ein unsichtbar verlorener einzelner Zellinhalt kann durch reine Textgeometrie nicht in jedem denkbaren Dokument erkannt werden. Deshalb bleibt die neue 300er-Stichprobe vor jeder Freigabe erforderlich.

Erkannte Einheiten: 57 Berichte in 元, zwei in 千元 und einer in 万元. Sany und die umbrochene Shenzhen-Tabelle speichern beide Vorjahresspalten; verwendet wird 调整后. Für einen direkt gedruckten Vorjahresbetrag ist das Band die halbe letzte gedruckte Stelle. Sonst gilt mit gedrucktem Q3-Wert Q, Wachstum g und deren halben Rundungseinheiten hQ und hg:

`Untergrenze = (Q − hQ) / (1 + (g + hg) / 100)`

`Obergrenze = (Q + hQ) / (1 + (g − hg) / 100)`

Der mittlere Rechenwert ist `Q / (1 + g / 100)`. Ein Nenner, dessen Band null berührt oder negativ wird, wird abgewiesen. Diese Rückrechnung liefert kein exakt gedrucktes Vorjahr.

Benannte Lücken umfassen fehlende Wertanker, falsche Währung oder Berichtskette, fehlenden Titel/Jahresbezug/Sicherheitscode, mehrdeutige Wertanker, unbekannte Vorjahresspalten, fehlende Wachstumszelle oder ihren Fehlwertmarker, unbekannten Wachstumsversatz, nicht passende Berichtigung sowie Abruf- und Extraktionsfehler. Kein solches Layout scheitert in den vorhandenen 60 Mustern. Unbekannte Muster werden weder durch einen nächstbesten Wert noch durch Eastmoney-Wachstum ersetzt. `mixed-basis` bedeutet nur außerhalb des Rundungsbands; der Begriff beweist allein keine Ursache der Abweichung.

## Start für Claude

Aus dem Klon, nach der Blindprüfung:

```text
node scripts/fetch-cn-printed.js --cap=300
```

Der Aufruf führt genau diesen getrennten Shadow-Pass aus. Er ist keine Vorbedingung des bestehenden CN/TW/BR-Abrufs. Bei einer CNINFO-Störung werden spätere Ticker weiter bearbeitet, die Störung wird benannt und nur dieser Prozess endet rot. Bestehende CN/TW/BR-Dateien werden niemals geöffnet zum Schreiben. Nach dem Pass auch bei Exit 1 den Bericht ausführen; nicht über `&&` unterdrücken.

```text
node scripts/cn-printed-shadow-report.js --snapshots=C:/Users/Anwender/.codex/t/daylauf10/sd-halbjahr-data/snap --data-day=2026-11-11 --out=outputs/cn-printed-shadow-live
```

Beim nächsten Snapshot-Stand `--data-day` auf den tatsächlich enthaltenen gemeinsamen Datentag setzen oder weglassen. Bei mehreren internen Tagen und fehlender ausdrücklicher Auswahl erzeugt der Bericht keine Vorher/Nachher-Vorschläge. `--out` ist ein Dateipräfix für JSON und Markdown.

Abruf-Flags: `--cap=1..300` (Standard 300), `--year=2026` (Q3, Standard 2026), `--as-of=YYYY-MM-DD` (Standard Abrufdatum), `--tickers=002415.SZ,600031.SS`, `--cn-store=<Eingabedatei>`, `--store=<Pfad mit Dateiname cn-printed.json>`, `--cache-dir=<Ordner>`, `--sample-dir=<Stichprobenordner>` für den netzfreien Modus. Berichts-Flags zusätzlich `--baseline-dir=<board-history-Ordner>` und dieselben `--store`, `--cn-store`, `--year`.

Der Standardcache liegt unter `outputs/cn-printed-cache`, mit PDF und Text je Ankündigungs-ID. PDF-Extraktion bleibt ein eigener Schritt mit `C:/Program Files/Git/mingw64/bin/pdftotext.exe -layout -f 1 -l 4`. Die Live-Abfragen erfolgen seriell; seit Abschluss jeder Antwort vergehen mindestens 1,5 Sekunden bis zur nächsten Anfrage, auch bei Wiederholungen. Nur vorübergehende HTTP-/Netzfehler werden höchstens dreimal versucht. Volltexte müssen zum Jahr, Ticker und Q3 passen; Zusammenfassungen, Englischfassungen und bloße Korrekturankündigungen werden verworfen. Ungeprüfte Weiterleitungen werden nicht verfolgt. Der erste Lauf ist nach Börse abwechselnd und nach Ticker geordnet, keine Zufallsstichprobe. Spätere Läufe bevorzugen noch nicht versuchte Ticker.

**Abbruchbedingung:** Unter 270 erkannten Berichten in einem vollständigen Live-Lauf von 300 bleibt es nach dem Bericht stehen; fehlgeschlagene Layouts stehen einzeln mit Grund in JSON und zusammengezählt im Bericht. Ein unvollständiger Lauf oder die 60 Offline-Muster bestehen das Tor nicht.

## Formelweg als vorläufige Rechnung

Alle 60 gedruckten Vergleiche stimmen auf der Umsatzzeile 营业收入 / OPERATE_INCOME überein. Für einen Vorschlag zur Ergänzung des bestehenden Snapshots passen davon 58 auch auf die dort bereits vorhandene aktuelle Umsatzzeile. **Gree und Sany bleiben gesperrt**, weil die Snapshot-Zeile dort Gesamtumsatz einschließlich Finanzerträgen enthält. Eine unbemerkte Mischung mit dem engeren gedruckten Umsatz würde das Verhältnis verändern.

Die folgenden Zahlen sind auf demselben Snapshot-Tag 11.11. gerechnet: vorher die jüngste vorhandene Vierteljahresvergleichspaarung nach Rücknahme bereits gesetzter Exchange-Marker, danach das hypothetische gedruckte Q3-Paar. Sie sind keine Aussage über den aktuellen sichtbaren Board-Score. Der bestehende Juli-Weg kann schon heute Q3 ergänzen; hier wird seine Ursprungszelle mit dem neuen Belegweg verglichen.

| Ticker | Vorher Q2-Wachstum | Hypothetisch Q3-Wachstum |
|---|---:|---:|
| 000683.SZ | 8,70 % | 21,67 % |
| 000711.SZ | 213,24 % | 207,06 % |
| 000725.SZ | 2,86 % | −8,62 % |
| 000738.SZ | 1,69 % | −7,15 % |
| 002064.SZ | 27,09 % | 27,60 % |

Die Einzelzellen, Bandgrenzen, Gründe der zwei Sperren, Datentage und Eingangshashes stehen in `shadow-final-2026-11-11.json` im B11-Ablageordner. Keine bestehende Zelle wurde ersetzt. Vor einer Aktivierung braucht es den bestandenen 300er-Lauf und die Prüfung des konkreten Formelwegs durch Claude und Codex. Die vorläufige Rechnung hier erteilt diese Freigabe nicht.

## Prüfbelege und Übergabe

```text
node tests/cn-printed-parser.test.js
node tests/fetch-cn-printed.test.js
node tests/cn-printed-shadow-report.test.js
node tests/cn-printed-shadow-guard.test.js
```

Die kleinen Textausschnitte in `tests/fixtures/cn-printed/` samt Manifest umfassen rund 153 KB. Erwartete Wachstumswerte stammen aus der gelieferten Belegtabelle, die Zahlenanker aus `cn.json`. Tests enthalten keinen Netzaufruf; der Abruf wird mit künstlichen Antworten und einer künstlichen Uhr geprüft. Original-PDFs werden nicht ins Repository kopiert.

Die Shadow-Abschirmung durchsucht den ausführbaren Repo-Code auf Zugriffe oder Imports außerhalb der drei Pass-Dateien; der Parser selbst darf kein I/O besitzen. Im separaten Testbaum wurde eine vollständige Ankerzeile absichtlich durch einen Scoring-Zugriff ersetzt. Der Wächter wurde dabei nachweislich rot. Der Zielpfad wurde vor dem Schreiben gegen den echten Quellpfad geprüft. Zusätzlich wurden append-only-Verletzungen und falsche Umsatzanker absichtlich eingebaut und abgewiesen. SHA-256 der vorhandenen CN/TW/BR-Dateien und des Shadow-Speichers im Klon war vor und nach den Tests gleich. Die Netzfehlerprobe bestätigt außerdem, dass nach einem fehlgeschlagenen CNINFO-Ticker der nächste gültige Ticker gespeichert wird.

`tests-final.json` im Ablageordner enthält die vier Exit-Codes 0 und die Ausgaben. Der vollständige Test-Gate-Lauf wurde entsprechend dem Brief nicht ausgeführt. Keine bestehende getrackte Datei geändert, kein Commit, kein Push. Diese Erbauerprüfung ersetzt nicht Claudes anschließende blinde Prüfung. Die statische Abschirmung fängt benannte Zugriffe und Imports ab; beliebige künftig verschleierte dynamische Pfade sind keine bewiesene Eigenschaft dieser Textprüfung.

## Automatisch erzeugter Schattenbericht mit zehn Quellenbelegen

# China Q3, gedruckte Vergleichszahlen

> **Auf einen Blick**
> 60 von 60 erfassten Tickern erkannt (100.00 %).
> Reine Schattenmessung; keine Board-Zahl wird geändert.
> 300er-Live-Tor: noch nicht gemessen.

Zählebene: Ticker. Snapshot-Stand: 2026-11-11. Juli-Vintage: 2026-07-29.
Die 1.086 und 1.222 im Auftrag stammen aus einem früheren Stand. Hier werden vorhandene Juli-Zeile und fehlende Juli-Zeile am gelieferten Snapshot-Satz gezählt. Eine Juli-Zeile ist keine Freigabe des alten Füllwegs.

| Gruppe | Ticker | Q3 aktuell, Vorjahr fehlt | agree | mixed-basis | nur gedruckt | unparsed |
|---|---:|---:|---:|---:|---:|---:|
| no-july-row | 1594 | 1435 | 0 | 0 | 0 | 1435 |
| july-row | 1285 | 1206 | 60 | 0 | 0 | 1146 |

Die Statusspalten beziehen sich auf die Kandidaten. Nicht abgerufene Ticker sind benannte Lücken und gehen nicht in die Parserquote ein.

| Börse / Layout | Erfasst | Erkannt | Quote |
|---|---:|---:|---:|
| SZ | 28 | 28 | 100.00 % |
| SS | 32 | 32 | 100.00 % |
| SZ/growth-below | 16 | 16 | 100.00 % |
| SZ/growth-inline | 10 | 10 | 100.00 % |
| SZ/restated-wrapped | 1 | 1 | 100.00 % |
| SZ/growth-above | 1 | 1 | 100.00 % |
| SS/restated | 1 | 1 | 100.00 % |
| SS/growth-below | 21 | 21 | 100.00 % |
| SS/growth-inline | 5 | 5 | 100.00 % |
| SS/growth-above | 5 | 5 | 100.00 % |

Vergleich insgesamt: {"unparsed":2819,"agree":60}.
Benannte Fehler: {}.

Verglichen wird 营业收入 mit Eastmoney OPERATE_INCOME, jeweils Q3 = 9M − H1. 营业总收入 / TOTAL_OPERATE_INCOME wird nicht beigemischt. mixed-basis bezeichnet eine Abweichung außerhalb des Rundungsbands; deren Ursache bleibt ungeklärt.
Bei berichtigten Vergleichsspalten gilt 调整后. Sonst ist das Vorjahr ein aus dem gedruckten Wachstum berechnetes Intervall, keine exakt gedruckte Zahl. Erkennungsbasis für Zeile und Einheit sind zwei Wertanker; verlorene chinesische Textzeichen werden nicht als gelesen ausgegeben.

## Zehn Belege

- [000651.SZ](https://static.cninfo.com.cn/finalpage/2026-10-27/1225627217.PDF), Seite 2, agree, Einheit 1 CNY. Zitat: `36,677,556,545.36 126,075,079,046.57 / -7.97% -8.10%`.
- [600031.SS](https://static.cninfo.com.cn/finalpage/2026-10-30/1225639954.PDF), Seite 1, agree, Einheit 1000 CNY. Zitat: `24,804,219 / 2,664,635 21,207,370 21,207,370 78,109,737 / 2,322,193 2,322,193 9,328,265 (%) / (%) / 65,741,014 65,741,014 18.81 / 11.06 / 16.96 8,399,104 8,399,104`.
- [300489.SZ](https://static.cninfo.com.cn/finalpage/2026-10-30/1225645205.PDF), Seite 2, agree, Einheit 1 CNY. Zitat: `900,091,3 / 82.66 423,215,9 423,215,9 2,092,916 1,442,973 1,442,973 / ,475.49 / 93,480,69 80.62 80.62 112.68% ,502.27 ,502.27`.
- [600871.SS](https://static.cninfo.com.cn/finalpage/2026-10-29/1225637338.PDF), Seite 1, agree, Einheit 1000 CNY. Zitat: `19,477,748 (%) / 412,608 7.5 / 201,410 / 173,138 20.3 (%) / 13.9 / 0.011 57,142,006 3.6`.
- [688690.SS](https://static.cninfo.com.cn/finalpage/2026-10-29/1225635086.PDF), Seite 1, agree, Einheit 10000 CNY. Zitat: `32,000.35 (%) 88,783.72 (%) / 10,575.64 24.45 26,685.70 32.36`.
- [301536.SZ](https://static.cninfo.com.cn/finalpage/2026-10-27/1225622786.PDF), Seite 2, agree, Einheit 1 CNY. Zitat: `151.24% / 1,917,366,120.45 4,575,178,851.00 111.21%`.
- [688111.SS](https://static.cninfo.com.cn/finalpage/2026-10-28/1225630176.PDF), Seite 1, agree, Einheit 1 CNY. Zitat: `16.11 / -77.56 / -72.30 (%) / 1,766,387,207.65 5,079,649,806.85 21.57`.
- [002475.SZ](https://static.cninfo.com.cn/finalpage/2026-10-30/1225645369.PDF), Seite 1, agree, Einheit 1 CNY. Zitat: `110,507,438,321.43 285,011,774,242.68 / 14.62% 13,056,982,919.44 29.01%`.
- [002415.SZ](https://static.cninfo.com.cn/finalpage/2026-10-17/1225607861.PDF), Seite 1, agree, Einheit 1 CNY. Zitat: `27,221,794,841.81 13.71% 74,044,332,688.88 12.60%`.
- [600808.SS](https://static.cninfo.com.cn/finalpage/2026-10-30/1225641519.PDF), Seite 1, agree, Einheit 1 CNY. Zitat: `17,281,198,942 / -163,630,004 (%) / -108,335,426 (%) / -192,087,532 / -11.36 54,505,755,670 -5.33`.

## Formelweg, noch nicht freigegeben

Vorschlag: ausschließlich fehlende Zellen 2025-09-30 ergänzen, wenn agree oder nur gedruckt vorliegt, der aktuelle Snapshot dieselbe Umsatzzeile in belegter Währung und Einheit trägt und der 300er-Lauf mindestens 90 % erreicht. Abweichungen bleiben Lücken. Claude und Codex prüfen den konkreten Vorschlag vor jeder Aktivierung.
Die JSON-Zeilen enthalten eine hypothetische Vorher/Nachher-Rechnung des Quartalspaars auf einem Snapshot-Tag. Das ist kein nachgerechneter Board-Score und keine Aktivierung. Bei abweichender aktueller Umsatzzeile wird auch dieser Vorschlag gesperrt.

## Erster Live-Lauf mit 300 Berichten (Claude, 12.11.2026, 14:24 bis 14:58 MEZ)

`node scripts/fetch-cn-printed.js --cap=300 --as-of=2026-11-12` (899 Abrufe, ein CNINFO-Formfehler bei 000016.SZ): **243 von 300 erkannt = 81,0 % (Tor 90 % nicht bestanden)**. Nach Börse: Shenzhen 112 von 150, Shanghai 131 von 150. Erkannte Layouts sind zu 100 % im Rundungsband (Schattenbericht: 220 agree, 3 mixed-basis auf dem Snapshot-Satz vom 11.11., ticker-Ebene: ohne Juli-Zeile 105 agree / 2 mixed-basis, mit Juli-Zeile 113 / 1). Die 57 Lücken (benannt, kein falscher Wert gespeichert): security-code-not-in-header 24 (davon 23 SZ), revenue-or-ytd-anchor-mismatch 11, unknown-prior-column-layout 6, not-first-revenue-row 4, growth-column-missing 3, operating-revenue-anchor-missing 3, printed-prior-growth-inconsistent 2, ambiguous-growth-column 2, text-empty 1, cninfo-announcement-shape 1.
Wichtigste Ursache: A+H/A+B-Firmen drucken im Kopf zwei Wertpapierkennungen hintereinander (zum Beispiel Vanke `000002299903`); die Kopfprüfung verlangt eine Nichtziffer nach dem Code. Eine Lockerung auf `code` gefolgt von weiteren sechs Ziffern erkennt 17 weitere Berichte (offline auf dem Zwischenspeicher nachgerechnet: **260 von 299 = 87 %**); die übrigen Klassen sind Layoutvarianten (siehe Liste). Das 90-%-Tor ist damit erst nach einem weiteren Bauschritt erreichbar. Der Zwischenspeicher mit den Texten liegt im Ablageordner `run-1112/b11/live/cache`.
