**B11b erkennt offline 279 von 300 Berichten (93,0 %); alle bisherigen 243 Ergebnisse bleiben inhaltlich bytegleich.**

> **Auf einen Blick**
>
> Das Bauziel von mindestens 92 % ist am gespeicherten Entwicklungssatz erreicht.
>
> - Shenzhen steigt von 112 auf 138 von 150, Shanghai von 131 auf 141 von 150. 36 zusätzliche Berichte werden erkannt; 21 bleiben benannte Lücken ohne Finanzwerte.
> - 240 Testfälle und der Shadow-Wächter sind grün. 109 negative Datenproben, acht absichtliche Code-Mutationen und der absichtliche Scoring-Zugriff werden erkannt.
> - Die 300 Berichte waren Entwicklungsdaten. Die unabhängige Live-Quote bleibt offen; Claude prüft den Bau und misst anschließend eine disjunkte Auswahl. Alles ist uncommittet.

Stand 12.11.2026. Konkreter B11b-Auftrag auf `e3b17ee`, Branch `daylauf16/b11-cninfo-cn`. Keine Helfer, kein Netz, kein vollständiger Test-Gate-Lauf. Die vorhandene Sperre für diesen Klon wurde gelesen, ALL.PAUSED war nicht gesetzt. Historische Arbeitsanweisungen in Projekt-, Memory- und Berichtstexten wurden als Daten behandelt; daraus wurde kein zusätzlicher Auftrag ausgeführt.

## Messung auf denselben 300 Tickern

Gezählt werden 300 versuchte Ticker, einschließlich des Abruffehlers ohne PDF. Es gibt 299 gespeicherte PDFs und 299 Textdateien. Der Abruffehler und das Bild-PDF bleiben im Nenner. Der Store und die Eastmoney-Anker wurden nicht verändert.

| Börse | Vorher erkannt | Nachher erkannt | Vorher | Nachher |
|---|---:|---:|---:|---:|
| Shenzhen | 112 / 150 | 138 / 150 | 74,67 % | 92,00 % |
| Shanghai | 131 / 150 | 141 / 150 | 87,33 % | 94,00 % |
| Gesamt | 243 / 300 | 279 / 300 | 81,00 % | 93,00 % |

| Lückengrund | Vorher | Nachher | Aus dieser ursprünglichen Gruppe zusätzlich erkannt |
|---|---:|---:|---:|
| security-code-not-in-header | 24 | 3 | 20 |
| revenue-or-ytd-anchor-mismatch | 11 | 8 | 4 |
| unknown-prior-column-layout | 6 | 0 | 6 |
| not-first-revenue-row | 4 | 4 | 0 |
| growth-column-missing | 3 | 0 | 3 |
| operating-revenue-anchor-missing | 3 | 3 | 0 |
| printed-prior-growth-inconsistent | 2 | 1 | 1 |
| ambiguous-growth-column | 2 | 0 | 2 |
| text-empty | 1 | 1 | 0 |
| cninfo-announcement-shape | 1 | 1 | 0 |
| Summe | 57 | 21 | 36 |

000026.SZ wechselt vom fehlenden Code zum nicht passenden Umsatzanker. Deshalb sinkt die erste Gruppe um 21, obwohl daraus 20 neue Erkennungen entstehen; die Ankergruppe bekommt eine Lücke hinzu.

Alle 243 bisher erkannten Berichte wurden sowohl gegen den unveränderten ursprünglichen Parser als auch gegen die tatsächlich gespeicherten Live-Beobachtungen verglichen. Das vollständige Parserergebnis ist nach Ausklammern allein von `parserVersion` identisch, einschließlich Wert, Einheit, Wachstum, Vorjahreszellen, Rundungsbreiten, Ankern und sämtlichen Zitatzeilen samt Zeilen- und Seitenzahlen. Es wurde kein alter Wert neu geschrieben. Der Parser versucht zuerst die bestehende Erkennung; erst bei einer Lücke folgen die zusätzlichen Layoutregeln. Die neue Versionskennung lautet `cn-q3-layout-v2`.

Die Rechnung gegen die Vorjahresanker derselben `cn.json` ergibt 276 agree und 3 mixed-basis. Das ist der direkte Umsatzvergleich und nicht die gesonderte Snapshot-Auswertung vom 11.11. aus B11. Eine mixed-basis-Beobachtung wird dadurch nicht zur Freigabe für ein Board.

## Zusätzliche Erkennungsregeln und ihr gemessener Anteil

Für jede Zeile wurde genau diese Erweiterung nur im Arbeitsspeicher abgeschaltet und der gesamte Satz erneut geparst. Die Anzahl bezeichnet erfolgreiche Berichte, deren Ergebnis davon abhängt. Die Mengen überschneiden sich; sie werden nicht zu einer vermeintlichen zusätzlichen Abdeckung addiert. Keine der 243 alten Erkennungen hängt von einer Erweiterung ab.

| Erweiterung | Betroffene erfolgreiche Berichte | Beleg und Abgrenzung |
|---|---:|---|
| Vollständiger Codeblock mit angehängten Codes | 20 | Zusätzlich zum einzelnen sechsstelligen Code werden genau 6+6, 6+5 und 6+5+6 Stellen erkannt. Die Ziffernfolge muss links und rechts begrenzt sein. |
| Umbruch mit weiteren Kommagruppen | 2 | 000028.SZ und 000543.SZ. Ein Fortsetzungsstück darf selbst Tausenderkommas enthalten. Höchstens zwei physische Folgezeilen, dieselbe Spalte, genau ein Kandidat, gültige zusammengesetzte Zahl und keine dazwischenliegende Zelle bleiben Pflicht. |
| Millionen CNY | 3 | 600019.SS, 600029.SS, 600115.SS. Die zusätzliche Skala 1.000.000 muss gleichzeitig zum gedruckten Quartal und zu 9M passen. |
| Vorjahresspalten der Umsatzzeile zuordnen | 11 | 000028.SZ, 000050.SZ, 000058.SZ, 000069.SZ, 000530.SZ, 600022.SS, 600048.SS, 600062.SS, 600105.SS, 600110.SS, 600246.SS. Folgezeilen mit Gewinnbeträgen oder Wachstum über 1.000 % gelten nicht mehr automatisch als Umsatz-Vorjahr. Bei versetzten Tabellen kann das erste Vorjahrespaar oberhalb des Q3-Werts oder bis auf Höhe des 9M-Ankers stehen. |
| Separates Prozentzeichen im Shenzhen-Spaltenkopf | 3 | 000551.SZ, 000601.SZ, 000680.SZ. Ein Prozentzeichen im Kopf genau der Quartalswachstumsspalte ersetzt das bisher verlangte Prozentzeichen an jeder einzelnen Zahl. Ein Zeichen nur über der 9M-Spalte genügt nicht. |
| Ein ausdrückliches Vorjahr statt Berichtigungspaar | 1 | 600100.SS. Genau eine Vorjahresspalte für Q3 und eine für 9M; die Kopfzeile muss ausdrücklich 2025 7-9 und 2025 1-9 nennen. Das gedruckte Q3-Wachstum wird zusätzlich gegen das gedruckte Vorjahr geprüft. |

Die Codeerweiterung übernimmt nicht einfach die vorgeschlagene Lockerung. Sie deckt zusätzlich die tatsächlich beobachteten fünfstelligen und dreifachen Codeblöcke ab und findet keinen Code innerhalb einer längeren unpassenden Ziffernfolge. [Vanke, PDF Seite 1](https://static.cninfo.com.cn/finalpage/2026-10-30/1225644984.PDF), Textzitat `000002299903`; weitere beobachtete Blöcke sind `00051301513` und `00003902039299901`. Die automatische Prüfung lehnt insbesondere `600000` innerhalb von `1600000`, zusätzliche vorangestellte oder angehängte Ziffern und einen nur als zweiten Code vorkommenden Ticker ab. Die Identität wird weiterhin zusätzlich durch die vorhandenen CNINFO-Metadaten und die zwei firmenspezifischen Betragsanker abgesichert. Eine bloße Übereinstimmung beliebiger längerer Zahlen wird nicht freigegeben.

Bei den elf Fällen mit veränderter Zeilenzuordnung sind zwei Arten zu unterscheiden. 000050, 000069, 600105, 600110 und 600246 haben keine neue fachliche Spaltenfolge; die alte Erkennung griff fälschlich auf spätere Gewinnzeilen zu. 600022, 600048 und 600062 haben die bekannte Achtspaltenfolge `Q3, Vorjahr vorher, Vorjahr nachher, Q3-Wachstum, 9M, Vorjahr vorher, Vorjahr nachher, 9M-Wachstum`, jedoch vertikal versetzte Textzellen. Die PDF-Ansichten bestätigen die Beschriftung 调整前 / 调整后 und die Reihenfolge. Beispiele sind [600022, Seite 2](https://static.cninfo.com.cn/finalpage/2026-10-31/1225646716.PDF), `16,539,111,642.54`, Wachstum `4.99`, und [600062, Seite 3](https://static.cninfo.com.cn/finalpage/2026-10-28/1225629526.PDF), `2,586,650,961.69`, Wachstum `-5.26`. Es wird weiterhin die Nachher-Spalte verwendet und rechnerisch geprüft. Kein Vorjahr wird danach ausgewählt, welches besser zum erwarteten Eastmoney-Wachstum passt.

Die neue Sechsspaltenfolge lautet `Q3 aktuell, Q3 Vorjahr, Q3-Wachstum, 9M aktuell, 9M Vorjahr, 9M-Wachstum`. [600100, Seite 1](https://static.cninfo.com.cn/finalpage/2026-10-31/1225649705.PDF), `2,738,398,721.24` und `1.76`. Sie wird als `single-prior` ausgewiesen; die Vergleichsmethode heißt `printed-prior`. `priorValues.before` ist hier ausdrücklich null. Eine Berichtigung wird nicht behauptet. Bestehende Feldnamen bleiben unverändert; `layout`, `unitName`, `comparable.method` und die optionale Vorher-Zelle erhalten die beschriebenen zusätzlichen Ausprägungen.

Alle neuen Layouts durchlaufen weiterhin Titeljahr, Codeprüfung, genau ein Ankerpaar, gleiche eindeutige Skala, Q3 innerhalb der gedruckten Rundung um `9M 2026 minus H1 2026`, gedrucktes 9M innerhalb seiner Rundung, erste Umsatzzeile, fehlende Wachstumsmarker, Mehrdeutigkeit, Nennerprüfung und gegebenenfalls Vorjahreskonsistenz. Es gibt keine Ausweichrechnung mit TOTAL_OPERATE_INCOME. Neue Zitate enthalten zusätzlich den geprüften Kopfbereich. Die neue Millionenskala weitet das Band ausschließlich entsprechend der tatsächlich gedruckten Stelle aus.

## Die 21 verbleibenden Lücken

| Ticker | Nachgewiesener Grund |
|---|---|
| 000006.SZ, 000402.SZ, 600028.SS | Kein passender Sicherheitscode in den ersten 20 Textzeilen. Die Identitätsprüfung wird nicht entfernt und nicht auf beliebige Zahlen im Bericht ausgeweitet. |
| 000016.SZ | Fehler an der Antwortform der Ankündigungssuche, kein heruntergeladener Bericht. Zusätzlich fehlt in der gelieferten cn.json das aktuelle 9M-Glied. |
| 000026.SZ | Gedrucktes Q3 949.629.450,61 gegenüber Anker 1.173.997.476,97 CNY; 9M passt. Die Codekorrektur löst den sachlichen Unterschied nicht. |
| 000100.SZ | Die vier gespeicherten Textseiten enthalten Titel, Inhalt, Hinweise und Definitionen, jedoch nicht die benötigte Umsatztabelle. Kein Nachladen weiterer Seiten in dieser Messung. |
| 000401.SZ | Gedrucktes Q3 7.723.325.353,37 gegenüber Anker 8.779.709.576,61 CNY; 9M passt. Der Bericht enthält eine Berichtigung wegen 同一控制下企业合并. Der unpassende H1-Bezug wird nicht still ersetzt. |
| 000544.SZ | Das 9M-Fortsetzungsstück `28.19` liegt außerhalb der zulässigen Spaltengeometrie. Keine weitere räumliche Lockerung. |
| 000617.SZ | Die Haupttabelle zeigt 营业总收入 mit Q3 7.501.951.352,50 CNY; der geforderte engere OPERATE_INCOME-Anker ist 244.373.391,80 CNY. Kein Wechsel der Umsatzzeile. |
| 000631.SZ | Gedrucktes Q3 146.958.544,94 gegenüber Anker 167.070.757,65 CNY. Ein besserer Umbruchparser würde diese echte Differenz nicht beseitigen. |
| 000657.SZ | Die 9M-Zahl ist auf drei physische Zeilen verteilt, einschließlich eines einzelnen letzten Dezimalzeichens. Das weiterhin auf zwei Folgezeilen beschränkte Zusammenfügen liefert keinen vollständigen Anker. |
| 600186.SS | Gedrucktes Q3 995.202.119,90 gegenüber Anker 981.670.241,12 CNY; 9M passt. Ursache der abweichenden Basis hier nicht nachgewiesen. |
| 000420.SZ | Bild-PDF: zehn Seiten, zehn Bildobjekte, keine gefundenen Font-Objekte. Die vierseitige Extraktion enthält nur vier Seitenwechselzeichen. Seite 1 wurde lokal gerendert und angesehen. Keine OCR-Zahl wird erfunden. |
| 000567.SZ | 9M minus H1 ergibt −1.004.706.773,82 CNY. Der vorhandene positive Umsatzanker ist deshalb bewusst nicht verfügbar. |
| 600073.SS, 600234.SS | Das aktuelle 9M-Glied fehlt in der gelieferten cn.json. Der gedruckte Wert allein ersetzt den vorgeschriebenen zweiten Beleg nicht. |
| 600061.SS, 600095.SS, 600104.SS, 600120.SS | In allen vier angesehenen PDF-Tabellen steht zunächst 营业总收入 und erst darunter 营业收入. Bei 600120 ist zusätzlich ein Berichtigungspaar vorhanden. Die chinesischen Zeilenbezeichnungen fehlen im extrahierten Text. Die erste-Zeile-Sperre bleibt bestehen, statt das erste Wachstum der Gesamtumsatzzeile der zweiten Zeile zuzuordnen. |
| 600072.SS | Wachstum `−26.11` ist über getrenntes Vorzeichen sowie `26.1` und `1` umbrochen. Der isolierte Token `26.1` widerspricht dem gedruckten Vorjahr; die Konsistenzprüfung blockiert ihn. |

Nachprüfbare Beispiele sind [000401, Seite 2](https://static.cninfo.com.cn/finalpage/2026-10-29/1225635071.PDF), `7,723,325,353.37`; [000617, Seite 2](https://static.cninfo.com.cn/finalpage/2026-10-30/1225643998.PDF), `营业总收入（元）`; [600061, Seite 1](https://static.cninfo.com.cn/finalpage/2026-10-27/1225625862.PDF), `13,744,041.35`; und [600072, Seite 2](https://static.cninfo.com.cn/finalpage/2026-10-31/1225648730.PDF), `2,629,162,859.43`. Die lokal erzeugten Ansichten liegen ausschließlich im B11b-Ablageordner.

Bei 000016 wirft `findAnnouncement` genau dann `cninfo-announcement-shape`, wenn die Antwort auf `hisAnnouncement/query` selbst fehlt oder `q.announcements` kein Array ist. Ein leeres Array ist dagegen eine gültige Form und führt anschließend zu `q3-report-not-found`. Der gespeicherte Lauf enthält nur den Fehlercode, nicht den Antwortkörper. **Ob damals null, eine fehlende Eigenschaft oder ein anderer Typ vorlag, lässt sich offline nicht bestimmen.** Keine Vermutung über einen Serverwechsel oder ein alternatives Antwortfeld wurde in Code umgesetzt. Neue Mocktests prüfen alle genannten ungültigen Formen und das gültige leere Array.

## Unabhängiger Folgelauf

Die 300 gespeicherten Versuche wurden für Analyse, Regeln und Gegenproben benutzt. Die 93,0 % sind eine Entwicklungsquote, kein unabhängiger Nachweis des Live-Tors. Auch die 60 älteren B11-Muster bleiben Entwicklungsdaten. Eine Erfolgsquote auf ungelesenen Berichten ist noch nicht gemessen.

Die bestehende Warteschlange war bereits nach zuletzt gelesenem Zeitpunkt sortiert, mit ungelesenen Tickern zuerst und bei gleichem Zeitpunkt abwechselnd SZ/SS. Gegen den tatsächlichen Live-Store ergibt der unveränderte Auswahlmodus für den nächsten `--cap=300`-Lauf 300 neue Ticker, 150 je Börse und **null Überschneidungen mit den 300**. Allerdings wären sieben Ticker aus den älteren 60 Mustern dabei.

Neu ist `--only-new=true`. Damit werden alle Ticker ausgeschlossen, die entweder als Firma im übergebenen Store oder in dessen Abrufhistorie vorkommen, auch gescheiterte Versuche und frühere Jahre. Bei weniger als 300 verbleibenden Tickern wird nicht mit Wiederholungen aufgefüllt; ein unvollständiger Lauf besteht das 300er-Tor nicht. Die normale Auswahl ohne dieses Flag behält ihr bisheriges Verhalten.

`fresh-tickers.txt` im B11b-Ablageordner enthält zusätzlich eine vorbereitete Auswahl von 300 Tickern, 150 SZ und 150 SS, die weder zu den 300 noch zu den 60 älteren Mustern gehören. Deren PDFs oder Texte wurden in B11b nicht gelesen. `verify.cjs` kann diese Liste anhand der gespeicherten Eingaben erneut erzeugen. Die Auswahl bleibt deterministisch und nach Börse geschichtet; sie ist keine Zufallsstichprobe.

Claude kann nach seiner Prüfung aus dem Klon ausführen; diese Befehle wurden hier nicht ausgeführt:

```powershell
$fresh = (Get-Content -Raw 'C:/Users/Anwender/.codex/t/daylauf10/sd-d1-work/run-1112/b11b/fresh-tickers.txt').Trim()
node scripts/fetch-cn-printed.js --cap=300 --year=2026 --only-new=true "--tickers=$fresh" --store=C:/Users/Anwender/.codex/t/daylauf10/sd-d1-work/run-1112/b11/live/cn-printed.json --cache-dir=C:/Users/Anwender/.codex/t/daylauf10/sd-d1-work/run-1112/b11b/fresh-cache
```

Dabei ausdrücklich denselben bisherigen Store angeben; ein anderer oder leerer Store kennt die bereits gelesenen Ticker nicht. Der bisherige Store bleibt durch den vorhandenen Append-only- und Paralleländerungscheck geschützt. Das bestehende Live-Tor bleibt bei 90 % und wird erst an diesem disjunkten vollständigen Lauf gemessen. Das B11b-Bauziel von 92 % wurde nicht zum Herabsetzen eines anderen Tors benutzt. Anfrageabstand, Wiederholungen, Weiterleitungssperre und sämtliche Zugriffsadressen bleiben unverändert.

## Tests und Gegenproben

| Aufruf | Ergebnis |
|---|---:|
| `node tests/cn-printed-parser.test.js` | 77 bestanden, einschließlich aller 60 alten Muster |
| `node tests/cn-printed-b11b.test.js` | 130 bestanden, darunter 43 echte Textausschnitte, 109 negative Datenprüfungen und acht absichtliche Code-Mutationen |
| `node tests/fetch-cn-printed.test.js` | 18 bestanden |
| `node tests/cn-printed-shadow-report.test.js` | 15 bestanden |
| `node tests/cn-printed-shadow-guard.test.js` | bestanden, absichtlicher unerlaubter Scoring-Zugriff erkannt |

Die Zählungen innerhalb der B11b-Suite sind enthaltene Prüfungen und werden nicht zusätzlich aufaddiert. Die 43 neuen Ausschnitte plus Manifest umfassen 108.419 Byte. Sie stammen unverändert hinsichtlich der extrahierten Zeilenpositionen aus den Cachetexten; CR-Zeichen sind wie im Parser normalisiert. Die Erwartungswerte wurden aus den gedruckten Zeilen übernommen. Das Manifest hält Quelle, Ankündigungs-ID, ursprünglichen Texthash, Ausschnitt und Anker fest.

Für jeden der 36 zusätzlichen Erfolge wurde getrennt der Quartalsanker und der 9M-Anker um 1 % beschädigt; alle 72 Proben bleiben wertlose Lücken. Weitere Gegenproben betreffen eingebettete Codes, beschädigte und entfernte Zahlenfortsetzungen, einen falschen berichtigten Vorjahreswert, eine nur einseitig passende Millionenskala, fehlende Prozentköpfe, Prozentzeichen ausschließlich in der falschen Spalte, fehlende Wachstumsmarker, fehlende Vorjahreszellen und falsche Vergleichsjahre. Die acht Code-Mutationen schalten Erkennungsteile ausschließlich im Arbeitsspeicher ab und lassen die zugehörigen echten Positivbeispiele nachweislich scheitern. Der echte Parser wird dafür nicht umgeschrieben.

Der Abruf-Test fährt zwei simulierte Läufe mit jeweils 300 vollständig gescheiterten Versuchen und weist dennoch null wiederholte Ticker nach. Ein dritter Lauf mit `only-new` verarbeitet die restlichen 200, ohne mit bekannten Tickern aufzufüllen; der anschließende leere Lauf schreibt nichts und ruft nichts ab. Zwei absichtlich beschädigte Historien machen die Ausschlussprüfung rot. Der Shadow-Wächter wurde unverändert in seinem getrennten Testbaum absichtlich verletzt; die Live-Dateihashes sind davor und danach gleich.

`offline-verification.json` dokumentiert die Übergangszähler aller 300 Ticker, einzeln die 36 neuen Ergebnisse und 21 Lücken, die Abhängigkeit jeder Erweiterung, die Wiederholungsfreiheit und die Eingangs- und Codehashes. `baseline.json` hält alle 300 ursprünglichen Ergebnisse für die Wiederholung fest. 598 Cachebelege stimmen mit den ursprünglichen Live-Hashes überein: PDF als Bytes, Text wie im Abruf als UTF-8-Zeichenfolge. Die 243 alten Ergebnisse sind außerdem gegen die ursprünglichen gespeicherten Beobachtungen geprüft. `tests-final.json` hält die fünf Exit-Codes 0 und ihre Ausgaben fest. `git diff --check` ist grün.

## Übergabe

Geändert sind ausschließlich Parser, eigener CNINFO-Abruf, dessen Tests, die neue B11b-Testsuite, ihre kleinen Fixtures und dieser Bericht. Die drei im Brief ausgeschlossenen Dateien, `src/scoring/`, Schutzpfade und bestehende Stores bleiben unverändert. Nur die bereits zugelassenen Shadow-Pass-Dateien lesen `cn-printed.json`; der unveränderte Wächter bestätigt die Abschirmung. Keine neue Bibliothek, keine Datenkorrektur, kein Commit, kein Push und keine Live-Freigabe.

Die im Brief genannte Python-Datei ist hier nicht vorhanden. Die PDF-Sichtprüfung wurde deshalb lokal über Windows.Data.Pdf durchgeführt; es wurde nichts heruntergeladen. Die Erbauerprüfung ersetzt nicht Claudes angekündigte Blindprüfung. Die unbekannten Layouts und fehlenden Anker bleiben ausdrücklich offen.
