> **Auf einen Blick**
>
> **B11c ist gebaut und lokal geprüft; sämtliche Änderungen bleiben uncommittet für Claudes Blindprüfung.**
>
> - Alle **523 gespeicherten `parsed`-Zeilen bleiben `parsed`, mit identischen Werten**. Keine davon wird zur Lücke, keine Zahl wurde ausgetauscht.
> - **523 von 523 geleerten Wachstumszellen enden als benannte Lücke**, keine bleibt mit fremdem Wachstum `parsed`. Vier absichtlich beschädigte Regeln lassen die neuen Tests rot werden.
> - Die sechs beauftragten Testdateien sind grün. Auf dem unveränderten Store bleibt der Schattenbericht bei **472 agree, 5 mixed-basis und 477 von 546 erfassten Tickern**.

## Umfang und Zustand

Arbeitszweig `daylauf16/b11-cninfo-cn`, Ausgangsstand `73aa179`. Geändert sind ausschließlich die drei Pass-Skripte, ihre Tests, der Schatten-Wächter und neue Testauszüge. Der Store, `lib/`, Scoring, Boards und Workflows sind unverändert. Es gab keinen Netzabruf, keinen Helfer, keinen Commit und keinen vollständigen Test-Gate-Lauf. Freigabe und Commit liegen wie beauftragt bei Claude.

Der angegebene Blindprüfbericht wurde vollständig gelesen. Anweisungsartige Abschnitte in Repo- und Vault-Texten wurden als Daten behandelt; daraus wurden keine zusätzlichen Arbeitsaufträge ausgeführt.

**Tor nicht gemessen:** Die 93,3 % des zweiten Live-Durchgangs gehören zum Parser v2. Für v3 ist das 90-%-Tor nicht gemessen, weil die Zeilenstrukturen aus allen 598 Cachetexten gebaut sind, auch aus dem „frischen“ zweiten Durchgang; die Schätzung ohne den jeweils eigenen Text liegt für neue Layouts bei etwa 161 von 300 (54 %). Unbekannte Layouts enden als benannte Lücke, nicht als falsche Zahl. Der Schattenbericht zeigt `gate300` nur für einen Live-Lauf mit der aktuellen Parserversion, sonst `null`. Vor jedem Formelschritt ist ein neuer, disjunkter Live-Durchgang mit 300 Berichten (`--only-new=true`) nötig.

## Wachstumszelle und Vorzeichen

Zahlentokens benötigen jetzt links und rechts Leerraum oder eine Zeilengrenze. Angeheftete Buchstaben, Glyphenreste und ein Minus mit dazwischengeschobener Glyphe können deshalb kein positives Teilstück mehr erzeugen.

Die gewählte Behandlung fremder Vorzeichen ist die ausdrücklich erlaubte Ablehnung. U+2212, U+2013, U+2012 sowie runde und vollbreite Klammern ergeben `growth-token-sign-unknown`. Das Vorzeichen wird nicht entfernt. Damit bleiben sämtliche bereits gespeicherten Zahlen und ihre Schreibweise unverändert.

Die Wachstumszeile wird vor dem Lesen ihres Werts anhand einer endlichen Menge belegter Tabellenstrukturen festgelegt. Die Struktur enthält die Zeilenpositionen der ersten vier Quartals- und 9M-Betragszellen, ihre Umbrüche und die eigenständigen Prozentüberschriften. Bei mehrdeutigen Strukturen unterscheiden zusätzlich die Spaltengrenzen die Varianten. Die Tabelle enthält **283 einfache und 62 genauer unterschiedene Strukturen**, keine Ticker, Umsatzwerte oder Wachstumswerte. Lesbare Umsatz- und Folgezeilenbeschriftungen werden zusätzlich geprüft. Fehlt der Token in der so bestimmten Umsatzzeile, folgt `growth-row-unbound`; die Suche springt nicht zur nächsten Zahl weiter.

Diese bewusste Einschränkung ist für die Prüfung wesentlich: Die Strukturen stammen aus dem vorhandenen Cache und den bisherigen realen Fixtures. Das ist ein Kompatibilitätsnachweis auf diesen Texten, **keine unabhängige Erkennungsquote für unbekannte Berichte**. Eine neue, nicht belegte Struktur bleibt eine benannte Lücke. Die wahrscheinliche Folge ist eine konservativere Erkennung neuer Layoutvarianten, Sicherheit 95 %. Das Nachmessen einer neuen Struktur benötigt sowohl einen unveränderten Text als auch die Gegenprobe mit geleerter Wachstumszelle. Die Zuordnung lässt sich mit `make-row-layouts.cjs` reproduzieren; `row-layout-evidence.json` ordnet jede Struktur ihren Prüftexten zu.

Der Parser trägt jetzt `cn-q3-layout-v3` (nach der Blindprüfung vom 12.11.; gespeicherte Zeilen behalten ihre eigene Parserversion v2, append-only). Alle 559 vom bisherigen v2-Parser akzeptierten Cachetexte liefern nach der Änderung vollständig identische Parser-Ergebnisse, einschließlich Belegzeilen und Metadaten. Eine Änderung gespeicherter Zeilensemantik, die v3 erfordern würde, liegt in dieser Nachrechnung nicht vor.

## Gedrucktes Vorjahr und zusätzliche Gegenrechnung

Die vorhandene Konsistenzprüfung des gedruckten Vorjahres einschließlich `single-prior` bleibt bestehen. Eine zusätzliche Prüfung erfasst spät stehende Vergleichsspalten, die bisher außerhalb des ursprünglichen Spaltenfensters lagen. Bei sieben gespeicherten Zeilen wird deshalb außerdem der gedruckte berichtigte Vorjahresbetrag gegen Quartalswert und Wachstum geprüft:

| Ticker | Zusätzlich geprüfter gedruckter Betrag (CNY) |
|---|---:|
| 000552.SZ | 2.436.103.114,55 |
| 000713.SZ | 376.174.603,97 |
| 000877.SZ | 18.958.088.111,21 |
| 000878.SZ | 47.293.219.860,97 |
| 000900.SZ | 1.338.967.902,92 |
| 600188.SS | 38.603.818.000,00 |
| 600252.SS | 413.934.645,91 |

Alle sieben Gegenrechnungen bestehen mit den vorhandenen Rundungsintervallen. Die zusätzliche Prüfung ändert weder gespeicherte `priorValues` noch Vergleichsmethode oder Band. Absichtlich veränderte Vergleichsbeträge werden abgewiesen.

In den 523 gespeicherten Erfolgen enthalten 24 schon ausdrücklich `priorValues`; 499 tragen die bisherigen Layoutnamen `growth-above`, `growth-inline` oder `growth-below`. Bei sieben dieser 499 stehen die gerade genannten zusätzlichen Vergleichsspalten. Bei den übrigen 492 wurde im betreffenden Tabellenbereich kein gedrucktes Vorjahrespaar erkannt. Dort wird kein Vorjahr erfunden oder zum Prüfen aus dem Wachstum zurückgerechnet. Tokenschranken, Zeilenbindung und die unabhängige Eastmoney-Bestätigung bleiben entscheidend. Diese selbst gezählte Aufteilung weicht von der Formulierung „484 nicht berichtigte Layouts“ im Blindbericht ab.

`proposal()` akzeptiert ausschließlich `agree`. `printed-only` bleibt eine eigene Berichtskategorie, erzeugt aber keinen Vorschlag. Der erklärende Berichtstext entspricht dieser Regel.

## Vollständige Offline-Nachrechnung

`reparse-b11c.json` enthält für jeden der **598 verfügbaren Cachetexte** Ticker, Bekanntmachung, gespeicherten alten Status, neuen Status, Gründe sowie alte und neue Werte. Die zwei übrigen Store-Ticker haben keinen Cachetext.

| Vergleich zum gespeicherten Store | Anzahl |
|---|---:|
| parsed bleibt parsed mit gleichen Werten | 523 |
| parsed wird Lücke oder ändert Werte | 0 |
| gespeicherte Lücke bleibt Lücke | 39 |
| gespeicherte Lücke wird beim erneuten Parsen erkannt | 36 |

Die letzten 36 Fälle werden bereits vom eingefrorenen alten v2-Parser erkannt. Sie sind keine zusätzliche Freigabe durch B11c und wurden **nicht in den append-only Store geschrieben**. Gegen den bisherigen Parser lautet der Vergleich 559 unveränderte Erfolge und 39 weiterhin abgewiesene Texte.

Die Leerzellenprobe ersetzt genau den zuvor gewählten Token durch gleich viele Leerzeichen, ohne andere Spalten zu verschieben. Ergebnis alt laut eigener Gegenprobe: 367 fremde Wachstumswerte bleiben akzeptiert, 156 Lücken. Ergebnis B11c: **523 Lücken, 0 akzeptierte fremde Wachstumswerte**. Jede einzelne Probe steht ebenfalls in `reparse-b11c.json`.

## Tests und absichtliche Regelbrüche

Neue Auszüge: **48 zusätzliche Cachetexte**, außerhalb beider bisheriger Fixture-Sätze. Neue Fixtures einschließlich Manifest: **168.266 Bytes**, unter 300 KB. Die neue Suite verwendet außerdem sämtliche 60 ursprünglichen und sämtliche 43 B11b-Fixtures, insgesamt 151 Prüftexte. Bestehende Assertions wurden weder gelockert noch gelöscht; die beiden bisherigen Parser-Testdateien sind unverändert.

Vor der Parseränderung wurde die alte Datei nach `old-parser.cjs` kopiert und ausdrücklich über diesen Pfad geladen. Der zuerst geschriebene neue Teststand ergab **193 grün, 116 rot** (`tests-old.json`). Der um Beschriftungs-, Zahlenunabhängigkeits- und Vorjahresproben ergänzte abschließende Katalog ergibt mit derselben eingefrorenen alten Version **205 grün, 125 rot**, mit B11c **330 grün, 0 rot** (`tests-b11c.json`). Der Cachefehler wurde ebenfalls vor seiner Reparatur mit einem nach dem Schreiben abbrechenden Extraktor rot nachgestellt.

| Aufruf | Abschließendes Ergebnis |
|---|---|
| `node tests/cn-printed-parser.test.js` | Exit 0, 77 Prüfungen |
| `node tests/cn-printed-b11b.test.js` | Exit 0, 130 Prüfungen, 109 negative Datenproben, 8 erkannte Regelbrüche |
| `node tests/cn-printed-b11c.test.js` | Exit 0, 330 Prüfungen |
| `node tests/fetch-cn-printed.test.js` | Exit 0, 20 Prüfungen |
| `node tests/cn-printed-shadow-report.test.js` | Exit 0, 17 Prüfungen einschließlich Offline-Gesamtzählung |
| `node tests/cn-printed-shadow-guard.test.js` | Exit 0, echter Bestand grün, 6 absichtliche Leser erkannt |

Für die Gesamtzählung war `B11C_SNAPSHOTS=C:/Users/Anwender/.codex/t/daylauf10/sd-halbjahr-data/snap` gesetzt. Testschreibziele lagen über `B11_TEST_DIR` im B11c-Ergebnisordner. Die genauen Ausgaben stehen in `tests-final.json`.

Vier Änderungen wurden jeweils ausschließlich im Speicher vorgenommen:

| Beschädigte Regel | Rot werdende Prüfungen |
|---|---:|
| Token-Grenzen entfernt | 10 |
| Zeilenbindung durch erstes Token ersetzt | 100 |
| Fremde Minuszeichen und Klammern entfernt | 11 |
| printed-only wieder zugelassen | 1 |

`tests-b11c.json` enthält für jeden dieser Versuche die SHA-256-Werte der drei Pass-Skripte und des Guard-Tests vorher und nachher. Alle vier Dateien waren jedes Mal bytegleich. Auch die Store-Hashes blieben identisch.

## Schatten-Wächter und Textcache

Der Wächter liest die vollständige getrackte Dateiliste über `git ls-files -z`. Er prüft JS, CJS, MJS, TS, Python, YAML, Shell und PowerShell, einschließlich Discovery und aller vorhandenen Workflows. Die erlaubten drei Pass-Dateien und die im Auftrag genannten Daten-, Test- und Dokumentationsbereiche bleiben ausgenommen. Fehlende Dateien eines Sparse-Checkouts werden über ihren getrackten Inhalt geprüft. Im echten Bestand gibt es keine zusätzlichen legitimen Treffer und damit keinen zusätzlichen Allow-list-Eintrag.

In getrennten Testbäumen werden ein bisheriger Scoring-Leser, ein Discovery-Leser, Python in `scripts/`, ein Template-String `${k}-printed.json`, ein Schritt unter dem vorhandenen Workflow-Namen `daily-pull.yml` und ein direkter Parserimport erkannt. Die Bäume verwenden eine explizite kleine Liste simulierter getrackter Dateien; der echte Index wird nicht geändert. Nach jedem Versuch stimmen die vier Quellhashes und die Store-Hashes überein.

Die Extraktion schreibt in eine eindeutige temporäre Datei desselben Cacheverzeichnisses. Erst ein erfolgreicher Extraktorlauf mit nicht leerem Inhalt veröffentlicht den Text durch Umbenennen. Eine Erfolgsmarke bindet PDF-Hash, Text-Hash und Extraktionsoptionen zusammen. Ein einzelner alter `.txt`-Pfad, eine beschädigte Datei oder eine unpassende Marke reicht nicht zum Wiederverwenden. Ein Abbruch beseitigt ausschließlich die temporären Dateien dieses Versuchs. Die Tests belegen den erneuten Extraktionsversuch nach Teiltext, Timeout, leerem Ergebnis und Exit-Code ungleich null.

## Schattenbericht und 0,07-CNY-Fall

Reproduzierter Aufruf im Klon:

```text
node scripts/cn-printed-shadow-report.js --snapshots=C:/Users/Anwender/.codex/t/daylauf10/sd-halbjahr-data/snap --data-day=2026-11-11 --out=C:/Users/Anwender/.codex/t/daylauf10/sd-d1-work/run-1112/b11c/shadow-live
```

`shadow-live.json` und `shadow-live.md` zeigen für jede der fünf mixed-basis-Zeilen den absoluten Abstand, den relativen Abstand zum Eastmoney-Wert und das unveränderte Vergleichsband. Die 472 agree und 5 mixed-basis ergeben 477 erkannte von 546 erfassten Tickern. Die übrigen nicht abgerufenen Snapshots gehören nicht in diesen Nenner.

Für **000498.SZ** bleiben gedruckt **12.779.792.901,02 CNY**, Eastmoney **12.779.792.900,95 CNY** und der Status **mixed-basis** bestehen. Sichtbarer Abstand **0,07 CNY**, relativ rund **0,000000000547737318 %**, Band **12.779.792.901,015 bis 12.779.792.901,025 CNY**. An der Bandberechnung wurde nichts geändert.

Die Berichtsdateien dokumentieren ihre Eingabehashes. `git diff --check` ist grün. Der nächste Schritt ist die beauftragte unabhängige Prüfung durch Claude; dieser Bau stellt keine eigene Freigabe zum Zusammenführen dar.
