# Klassensumme der Börsenwerte (P1): Vorher/Nachher am Datenstand 07.11.2026

> **Auf einen Blick**
>
> 24 Firmen mit zwei oder drei börsennotierten Aktienklassen (A und H, A und B, bei Haier dazu D) zeigen ihren Börsenwert jetzt als Summe der Klassen, jede Klasse zu ihrem eigenen, nicht bereinigten Schlusskurs desselben abgeschlossenen Handelstags und zum Devisenkurs dieses Tages. Am Datenstand 07.11.2026 sinken die bisher zu hohen Werte um 3,3 bis 21,4 % (Jiangling 2,13 auf 1,67, ZTE 20,22 auf 18,80, Shandong Gold 18,11 auf 16,46 Mrd. USD).
> - Gegen den Code des veröffentlichten Boards vom 07.11. ändert sich kein Rang und kein Score; die gezeigte Notierung bleibt bei allen 24 Firmen dieselbe (bei CNOOC über eine feste Angabe, siehe unten), das Börsenjahr der Firma ebenso. Gegen den heutigen main bleibt zusätzlich Shandong Gold auf der Shanghaier Zeile, statt mit #111 auf die Hongkonger zu wechseln.
> - Die 16 Zeilen der Aktienzahl-Handtabelle mit eingefrorenem Kursverhältnis vom 30.10. entfallen; damit fällt auch ihr Ablauf am 31.12.2026 weg, an dem 12 dieser Firmen sonst vom Board gefallen wären.

## Was falsch war

Yahoo rechnet bei diesen Firmen den Börsenwert einer Zeile als alle Aktien der Firma mal den Kurs dieser einen Zeile. Die Zeile der teureren Klasse (meist die Shanghaier oder Shenzhener A-Aktie) gewinnt dann die Wahl der gezeigten Notierung, weil diese Wahl den höchsten Börsenwert nimmt, und zeigt zu viel. Codex hat das am 04.11.2026 als Befund P1 gemeldet (neun Firmen, 3,9 bis 25,1 % zu viel am 31.10.). Für 16 weitere Firmen gab es seit 01.11. Zeilen der Aktienzahl-Handtabelle, die die zweite Klasse mit dem Kursverhältnis vom 30.10.2026 in Gegenwerte der ersten umrechneten; das Verhältnis ändert sich aber täglich (Hua Hong am 07.11. 5,5 % daneben).

## Was jetzt gerechnet wird

- **Aktienzahlen:** je Klasse die Zahl der Firma ohne eigene Aktien und ohne zurückgekaufte, noch nicht eingezogene Aktien, jede mit eigenem Stichtag, Quelle, Seite und Zitat in `configs/mcap-class-sum.json`. Für die 16 Firmen der alten Zeilen sind es deren Zahlen und Quellen, für die acht Firmen aus P1 die Zahlen der zwei unabhängigen Quellenprüfungen vom 01.11.2026. Haier ist am 07.11. nachgeführt: A-Aktien abzüglich der Oktober-Rückkäufe (6.108,2 Mio., 31.10.), H-Aktien abzüglich 150.000 am 30.10. zurückgekaufter (2.848,9 Mio.), D-Aktien abzüglich 865.598 im Februar und 79.392.362 im Rückkaufangebot zurückgekaufter (190,8 Mio.; Abwicklung laut Ergebnismitteilung „on or about 13 October 2026“, die Stimmrechtsmitteilung vom 14.10. nennt den 13.10. als Schwellentag; die Einziehung ist noch nicht gemeldet, Sicherheit 85 %).
- **Kurse:** der nicht bereinigte Schlusskurs jeder Klasse aus dem täglichen Yahoo-Kursverlauf, nur von abgeschlossenen Sitzungen. Der Kursspeicher des Laufs taugt dafür nicht, er führt dividenden- und splitbereinigte Kurse für Renditerechnungen. Läuft eine Sitzung noch (Frankfurt bis 16:30 UTC, wenn der Tageslauf werktags um 09:00 UTC rechnet), zählt der Tag für diese Klasse nicht.
- **Gemeinsamer Tag und Devisen:** der letzte Tag, an dem alle Klassen und die Devisenpaare aller Klassenwährungen (CNYUSD, HKDUSD, EURUSD) einen abgeschlossenen Schlusskurs haben; umgerechnet mit dem Devisen-Schlusskurs genau dieses Tages. Werktags um 09:00 UTC ist der Devisentag noch offen, dann nimmt die Summe den Vortag für alle Klassen. Am Samstag, 07.11., ist es der 06.11.
- **Ort:** ein eigener Schritt im Merge-Job, auf dem vollständigen Bestand aller Klassen und vor der Weitergabe an Bewertung und Exporte. Er holt dafür rund 50 Kursverläufe bei Yahoo, je zwei Versuche mit Pause; nach 5 Minuten startet kein neuer Abruf und keine Wiederholung mehr (eine kurz vor Ablauf begonnene Wiederholung kann das um rund 32 Sekunden überschreiten: 2 Sekunden Pause und 30 Sekunden Zeitgrenze des Abrufs). Fehlt danach eine Summe, meldet der Lauf das als Fehlerhinweis, läuft aber weiter. Der Tag eines Kurses gilt in der Zeitzone seiner Börse (auch über eine Zeitumstellung hinweg).
- **Gezeigte Zeile:** Die Summe kommt in die Zeile, die die bestehende Wahl der Notierung zeigt (derselbe Vergleich wie in der Bewertung, auf den Werten des Abrufs). Bei CNOOC hält die Datei die bisher gezeigte Hongkonger Zeile 0883.HK fest: Ohne die alte Tabellenzeile bewertet Yahoo die Shanghaier Zeile höher, und die Wahl spränge auf 600938.SS (im ersten Entwurf Energie-Wachstum Rang 204 auf 208). Jede andere nicht gesperrte Zeile der Firma wird mit dem Hinweis „Der Börsenwert der Firma steht an der Zeile …“ geleert, damit an einem Tag, an dem die Bewertung die Zeile mit der Summe ausschließt, keine Zeile mit dem Ein-Kurs-Wert von Yahoo übernimmt; die Firma fehlt dann eher, als einen falschen Wert zu zeigen. Gesperrte Zeilen bleiben gesperrt. Die gezeigte Zeile übernimmt das früheste Datum der ersten Notierung der geleerten Zeilen, damit das Börsenjahr der Firma gleich bleibt (bei Hua Hong 2014 über 1347.HK).
- **Mindestgröße:** Fällt die Summe unter die Mindestgröße von 800 Mio. USD, nimmt die bestehende Prüfung die Zeile vom Board, wie bei einer korrigierten Zeile der Aktienzahl-Tabelle (heute ist Jiangling mit 1,67 Mrd. USD der kleinste Wert).
- **Leer statt geschätzt:** Ist keine Summe möglich (Kursverlauf nicht abrufbar, Kurs in anderer Währung, kein gemeinsamer abgeschlossener Tag in 10 Tagen, kein Devisenkurs zu diesem Tag), bleibt der Börsenwert leer mit Hinweis.
- **Hinweis am Board**, zum Beispiel: „Börsenwert als Summe der Aktienklassen, jede zu ihrem eigenen Schlusskurs vom 06.11.2026 und zum Devisenkurs desselben Tages: 3.999,4 Mio. A-Aktien zu 28,2 CNY plus 755,5 Mio. H-Aktien zu 20,06 HKD (Aktienzahlen ohne eigene Aktien laut Firma vom 30.09.2026).“
- **Herkunft im Export:** Der Wert ist als Rechnung gekennzeichnet, mit je Klasse der Aktienzahl samt Quelle, Seite, Zitat und Stichtag und dem Schlusskurs samt Datum und Devisenkurs.
- **Prüfdatum** der Aktienzahlen ist der 31.03.2027. Die tägliche Fristenmeldung nennt die 24 Firmen 30 Tage vorher; danach rechnet der Lauf mit den bisherigen Zahlen weiter und warnt.

## Vorher/Nachher

Gleiche Schnappschüsse (Lauf 42356903064), gleiche Watchlist, gleiche SEC-Dateien in beiden Armen; vorher der Code von main (de509263a7), nachher derselbe Code plus nur die Dateien dieses Entwurfs, mit den am 07.11. um 12:43 UTC aufgezeichneten Kursverläufen (`tests/fixtures/mcap-class-sum-charts-20261107.json`, Schlusskurse vom 06.11.). Für die Nachher-Seite wurden die 16 entfernten Zeilen so zurückgenommen, wie der Abruf ohne sie schreibt (Yahoo-Wert). Die Börsenwerte der Vorher-Seite stimmen mit dem veröffentlichten Export vom 07.11. (10:15 UTC) überein. Die Ränge im Nachspiel gelten für eine Bewertung ohne Kalibrierdatei und ohne Small-Cap-Bestand; verglichen wird nur Vorher gegen Nachher.

| Firma | gezeigte Zeile | vorher Mrd. USD | nachher Mrd. USD | Änderung | Board (Wachstum) |
|---|---|---|---|---|---|
| Jiangling Motors | 000550.SZ | 2,13 | 1,67 | -21,4 % | consumer-discretionary |
| Shanghai Pharmaceuticals | 601607.SS | 9,32 | 8,32 | -10,7 % | health-care |
| China Railway Signal & Communication | 688009.SS | 8,14 | 7,37 | -9,5 % | industrials |
| Shandong Gold Mining | 600547.SS | 18,11 | 16,46 | -9,1 % | materials |
| Anhui Expressway | 600012.SS | 4,53 | 4,12 | -8,9 % | industrials |
| Haier Smart Home | 600690.SS | 30,14 | 27,85 | -7,6 % | consumer-discretionary |
| ZTE | 000063.SZ | 20,22 | 18,80 | -7,0 % | tech-hardware |
| Qingdao Port | 601298.SS | 9,49 | 8,94 | -5,8 % | industrials |
| Hua Hong Semiconductor | 688347.SS | 29,01 | 27,40 | -5,5 % | semiconductors |
| PetroChina | 601857.SS | 348,43 | 335,42 | -3,7 % | energy |
| SMIC | 688981.SS | 80,05 | 77,22 | -3,5 % | semiconductors |
| CRRC | 1766.HK | 27,78 | 26,88 | -3,3 % | industrials |
| Yangtze Optical Fibre and Cable | 601869.SS | 19,39 | 19,08 | -1,6 % | tech-hardware |
| CSSC Offshore & Marine | 600685.SS | 4,17 | 4,12 | -1,1 % | industrials |
| China Suntien Green Energy | 600956.SS | 3,28 | 3,27 | -0,4 % | utilities |
| Shanghai Fudan Microelectronics | 688385.SS | 4,59 | 4,58 | -0,2 % | semiconductors |
| InnoCare Pharma | 688428.SS | 3,38 | 3,38 | 0,0 % | health-care |
| Sinopec Oilfield Service | 600871.SS | 4,68 | 4,68 | 0,1 % | energy |
| Sinopec Shanghai Petrochemical | 600688.SS | 3,73 | 3,73 | 0,1 % | energy |
| Swire Pacific | 0019.HK | 16,94 | 16,97 | 0,2 % | industrials |
| CanSino Biologics | 688185.SS | 1,72 | 1,72 | 0,3 % | health-care |
| China Longyuan Power | 001289.SZ | 13,52 | 13,68 | 1,2 % | utilities |
| Yankuang Energy | 600188.SS | 19,86 | 20,51 | 3,2 % | energy |
| CNOOC | 0883.HK | 142,35 | 147,40 | 3,5 % | energy |

**Ränge und Scores:** Wachstum 9.346 und Qualität 7.187 Zeilen in beiden Armen; bewegt haben sich nur die Börsenwerte der 24 gezeigten Zeilen (24 Wachstums- und 22 Qualitätszeilen). Kein Rang, kein Score und keine gezeigte Notierung ändert sich. Das Börsenjahr der gezeigten Zeile ist bei allen 24 Firmen dasselbe wie vorher, also das früheste der nicht gesperrten Zeilen; gesperrte Hongkonger Zeilen (etwa SMIC 2004, CanSino, Longyuan, Suntien, Fudan) zählten schon vorher nicht mit.

**Gegen den heutigen main** (e0dd8a9e14, mit #111, das noch in keinem Lauf live war): #111 legte für Shandong Gold eine Zeile mit Kursverhältnis auf 600547.SS an; mit ihr hätte ab dem nächsten Lauf die Hongkonger Zeile 1787.HK knapp gewonnen (16,73 gegen 16,45 Mrd. USD) und auf dem Rohstoff-Board gestanden (Wachstum Rang 762 mit 36,9 Punkten, Qualität Rang 459 mit 46,7, im Nachspiel). Dieser Entwurf entfernt die Zeile wieder; Shandong Gold bleibt wie auf dem veröffentlichten Board vom 07.11. auf 600547.SS (Wachstum Rang 472 mit 49,9, Qualität Rang 347 mit 54,0). Dadurch verschieben sich auf dem Rohstoff-Board 436 Wachstums- und 208 Qualitätszeilen um höchstens 0,1 Punkte und 3 Plätze; sonst gleich wie oben. Dass die Zeilen derselben Firma so verschiedene Scores tragen, liegt an den Yahoo-Daten je Notierung, nicht an der Klassensumme (Thema Heimatnotierung, #89).

**Weitere sichtbare Wirkungen:**
- Nebenzeilen ohne Board werden geleert (am 07.11. zwölf: 0763.HK, 0857.HK, 0995.HK, 1347.HK, 1787.HK, 2607.HK, 3969.HK, 600938.SS, 6198.HK, 6690.HK, 6869.HK, 9969.HK; vorher etwa 0857.HK mit 242,33 Mrd. USD für PetroChina).
- Kennzahlen aus dem falschen Wert: Bei neun gezeigten Zeilen (die acht Firmen aus P1 und Shandong Gold) werden Kurs-Umsatz-Verhältnis, Unternehmenswert und die zwei Unternehmenswert-Verhältnisse von Yahoo geleert, weil Yahoo sie aus dem Ein-Kurs-Wert rechnet; bei den 16 früheren Zeilen waren sie schon leer.
- Größenklasse: Jiangling wechselt von Mid (ab 2 Mrd. USD) zu Small. Im Größenband des Exports (eingefrorene Grenzen je Board) wechselt Shanghai Pharmaceuticals laut beiden Prüfungen von mega zu large.
- Gegenüber dem ersten Entwurf liegen die Werte 0,0 bis 0,3 % tiefer, weil jetzt der Devisenkurs vom 06.11. statt des Abrufs vom 07.11. gilt; Haier 0,8 % tiefer wegen der zurückgekauften Aktien.

## Was nicht abgedeckt ist

- Pinfra (Mexiko, Serien * und L): die L-Serie hat keine Kursreihe; Pinfra bleibt bei 3,9 % zu viel (Nachfolger-Test, bekannte Abweichung).
- Die drei übrigen Zeilen mit Kursverhältnis in der Aktienzahl-Handtabelle (ISA Energia ISAE3.SA, Hanwha 003535.KS, Lindt LISN.SW) haben andere Klassenarten (Vorzugsaktien, Partizipationsscheine) und bleiben unverändert.
- Der Small-Cap-Bestand bekommt keine Klassensumme.
- Zusammenspiel mit dem Kurs-Wächter von Tag 1538 (07.11.2026, P3-2): Die Zeile, die die Summe trägt, wird unter den Zeilen mit aktueller Yahoo-Kursmeldung gewählt; eine Zeile mit alter Meldung trägt die Summe nie. So leert der Wächter die Summe nicht mehr, wenn eine andere Klasse aktuell gemeldet ist (Beispiel: Shandong Gold mit alter Meldung der A-Zeile steht über 1787.HK statt gar nicht). Die fest gezeigte Zeile von CNOOC bleibt, solange ihre eigene Meldung nicht alt ist, auch an einem Tag ohne eigenen Yahoo-Börsenwert. Sind die Meldungen aller Zeilen mit Börsenwert alt und ist die Summe berechenbar, zeigt keine Zeile die Summe, und jede nennt denselben Grund: Die Kursmeldungen von Yahoo zu allen Zeilen der Firma sind zu alt, die Summe kommt von selbst zurück. Am 07.11. ist keine der 49 Klassenzeilen bei Yahoo älter als 7 Wochentage; mit den echten Kurszeiten dieses Tages liefern alter und neuer Stand bei allen 49 Zeilen dasselbe. Eine von der Summe geleerte Nebenzeile mit altem Kurs zeigt in der Filterliste keine Yahoo-Kurswerte (Tag 1545), solange der Abruf ihr den Vermerk über den alten Kurs mitgegeben hat; ist ihre Meldung nur an der Kurszeit als alt erkennbar, zeigt die Filterliste die Yahoo-Kurswerte noch (offen, wie oft das vorkommt, ist erst mit den Kurszeiten ab dem nächsten Lauf messbar).
- Neue Aktien oder spätere Rückkäufe sieht der Schritt nicht von selbst; dafür gilt das Prüfdatum. Bei Jiangling sind alle 8,6 Mio. zurückgekauften Aktien den A-Aktien zugerechnet; der Halbjahresbericht trennt sie nicht nach Klasse (Wirkung höchstens 0,7 %).
- Ist Yahoo am Lauftag nicht erreichbar, bleiben die 24 Börsenwerte für diesen Tag leer und die Firmen fehlen auf den Boards (zwei Versuche je Kursverlauf).

## Prüfung

`tests/mcap-class-sum.test.js` auf den echten Paketen und Kursverläufen des 07.11.: unabhängig nachgerechnete Summe aller 24 Firmen, vorher falsch und nachher richtig für neun, nur abgeschlossene Sitzungen (Frankfurt um 09:00 UTC zählt nicht), nicht bereinigter Kurs auch beim Rückgriff auf einen älteren Tag, Devisenkurs genau des gemeinsamen Tages, Werktagslauf nimmt den Vortag, leere Werte mit Grund, gesperrte Zeilen unberührt, Nebenzeilen geleert, gezeigte Zeile und Börsenjahr unverändert, Mindestgröße, Herkunft mit Quellen, Fristenmeldung, Lesekopie des Wächters, Schritt im Merge-Job; `--prove-red` vertauscht die Devisenkurse CNY und HKD und muss rot werden. Angepasst: `tests/share-count-hand-table.test.js`, `tests/hand-table-boersenwerte-20261101.test.js`, `tests/hand-table-zahlenjagd-r25-20261030.test.js`, `tests/hand-table-nachfolger-20261104.test.js` (spielt die Summe mit; die acht P1-Firmen jetzt innerhalb von 3 %, beim Ablauf am 01.01.2027 fallen statt 16 nur noch vier Firmen weg), `tests/fixtures/yahoo-q4-reader-policy.json`.
