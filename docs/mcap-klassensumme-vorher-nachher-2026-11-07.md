# Klassensumme der Börsenwerte (P1): Vorher/Nachher am Datenstand 07.11.2026

> **Auf einen Blick**
>
> 24 Firmen mit zwei oder drei börsennotierten Aktienklassen (A und H, A und B, bei Haier dazu D) zeigen ihren Börsenwert jetzt als Summe der Klassen, jede Klasse zu ihrem eigenen Schlusskurs desselben Handelstags. Am Datenstand 07.11.2026 sinken die bisher zu hohen Werte um 3,4 bis 21,2 % (Jiangling 2,13 auf 1,68, ZTE 20,22 auf 18,84, Shandong Gold 18,11 auf 16,49 Mrd. USD).
> - Kein Score und kein Rang ändert sich, außer bei CNOOC: Die Firma steht jetzt über die Shanghaier Zeile 600938.SS statt über 0883.HK (Energie-Wachstum Rang 204 auf 208, Score 45,3 auf 45,1 im Nachspiel; vier Nachbarn rücken einen Platz, zwei Scores bewegen sich um 0,1).
> - Die 16 Zeilen der Aktienzahl-Handtabelle mit eingefrorenem Kursverhältnis vom 30.10. entfallen; damit fällt auch ihr Ablauf am 31.12.2026 weg, an dem 12 dieser Firmen sonst vom Board gefallen wären.

## Was falsch war

Yahoo rechnet bei diesen Firmen den Börsenwert einer Zeile als alle Aktien der Firma mal den Kurs dieser einen Zeile. Die Zeile der teureren Klasse (meist die Shanghaier oder Shenzhener A-Aktie) gewinnt dann die Wahl der gezeigten Notierung, weil diese Wahl den höchsten Börsenwert nimmt, und zeigt zu viel. Codex hat das am 04.11.2026 als Befund P1 gemeldet (neun Firmen, 3,9 bis 25,1 % zu viel am 31.10.). Für 16 weitere Firmen gab es seit 01.11. Zeilen der Aktienzahl-Handtabelle, die die zweite Klasse mit dem Kursverhältnis vom 30.10.2026 in Gegenwerte der ersten umrechneten; das Verhältnis ändert sich aber täglich (Hua Hong am 07.11. 5,4 % daneben).

## Was jetzt gerechnet wird

- Aktienzahlen: je Klasse die Zahl der Firma ohne eigene Aktien, mit Quelle und Zitat in `configs/mcap-class-sum.json`. Für die 16 Firmen der alten Zeilen sind es deren Zahlen und Quellen, für die acht Firmen aus P1 die Zahlen der zwei unabhängigen Quellenprüfungen vom 01.11.2026 (bei Haier H die neuere Monatsmeldung vom 30.10.).
- Kurse: der Schlusskurs jeder Klasse am letzten Handelstag, an dem alle Klassen der Firma einen Schlusskurs im Kursspeicher des Laufs haben (am 07.11. für alle 24 Firmen der 06.11.).
- Umrechnung: die Devisenkurse desselben Laufs (`fx-rates.json`).
- Ort: ein eigener Schritt im Merge-Job direkt nach dem Zusammenführen der Kurse, also auf dem vollständigen Bestand aller Klassen und vor der Weitergabe an Bewertung und Exporte.
- Die Summe kommt in die Zeile, die die bestehende Wahl der Notierung zeigt (derselbe Vergleich wie in der Bewertung). Eine andere Zeile, deren alter Wert mindestens so hoch wäre wie die Summe, wird geleert, damit sie nicht übernimmt. Gesperrte Zeilen bleiben gesperrt.
- Ist keine Summe möglich (eine Klasse ohne Schlusskurse, der letzte gemeinsame Tag älter als 10 Tage, kein Devisenkurs), bleibt der Börsenwert leer mit Hinweis, nie ein geschätzter Wert.
- Die gezeigte Zeile trägt einen Datenhinweis wie: „Börsenwert als Summe der Aktienklassen, jede zu ihrem eigenen Schlusskurs vom 06.11.2026: 3.999,4 Mio. A-Aktien zu 28,2 CNY plus 755,5 Mio. H-Aktien zu 20,06 HKD (Aktienzahlen laut Firma vom 30.09.2026).“
- Nach dem Prüfdatum (31.03.2027) rechnet der Schritt weiter und warnt im Lauf bei jeder Firma, bis die Zahlen neu belegt sind.

## Vorher/Nachher

Gleiche Schnappschüsse (Lauf 42356903064), gleiche Watchlist, gleiche SEC-Dateien in beiden Armen; vorher der Code von main (de509263a7), nachher derselbe Code plus nur die Dateien dieses Entwurfs. Für die Nachher-Seite wurden die 16 entfernten Zeilen so zurückgenommen, wie der Abruf ohne sie schreibt (Yahoo-Wert), dann lief der neue Schritt. Die Börsenwerte der Vorher-Seite stimmen mit dem veröffentlichten Export vom 07.11. (10:15 UTC) überein, die neuen Werte mit dessen Schattenrechnung (`marketCapClassesShadow`) auf 0,0 bis 1,3 % (der Schatten zählt bei Jiangling, Haier und ZTE die eigenen Aktien mit). Die Ränge im Nachspiel sind nicht die des Exports, weil das Nachspiel ohne Kalibrierdatei und Small-Cap-Bestand rechnet; verglichen wird nur Vorher gegen Nachher.

| Firma | gezeigte Zeile | vorher Mrd. USD | nachher Mrd. USD | Änderung | Board (Wachstum) |
|---|---|---|---|---|---|
| Jiangling Motors | 000550.SZ | 2,13 | 1,68 | -21,2 % | consumer-discretionary |
| Shanghai Pharmaceuticals | 601607.SS | 9,32 | 8,34 | -10,5 % | health-care |
| China Railway Signal & Communication | 688009.SS | 8,14 | 7,38 | -9,3 % | industrials |
| Shandong Gold Mining | 600547.SS | 18,11 | 16,49 | -8,9 % | materials |
| Anhui Expressway | 600012.SS | 4,53 | 4,13 | -8,8 % | industrials |
| Haier Smart Home | 600690.SS | 30,14 | 28,07 | -6,9 % | consumer-discretionary |
| ZTE | 000063.SZ | 20,22 | 18,84 | -6,8 % | tech-hardware |
| Qingdao Port | 601298.SS | 9,49 | 8,96 | -5,6 % | industrials |
| Hua Hong Semiconductor | 688347.SS | 29,01 | 27,44 | -5,4 % | semiconductors |
| PetroChina | 601857.SS | 348,43 | 336,20 | -3,5 % | energy |
| SMIC | 688981.SS | 80,05 | 77,32 | -3,4 % | semiconductors |
| CRRC | 1766.HK | 27,78 | 26,94 | -3,0 % | industrials |
| Yangtze Optical Fibre and Cable | 601869.SS | 19,39 | 19,12 | -1,4 % | tech-hardware |
| CSSC Offshore & Marine | 600685.SS | 4,17 | 4,13 | -0,9 % | industrials |
| China Suntien Green Energy | 600956.SS | 3,28 | 3,28 | -0,2 % | utilities |
| Shanghai Fudan Microelectronics | 688385.SS | 4,59 | 4,59 | 0,0 % | semiconductors |
| InnoCare Pharma | 688428.SS | 3,38 | 3,38 | 0,1 % | health-care |
| Swire Pacific | 0019.HK | 16,94 | 16,96 | 0,1 % | industrials |
| CanSino Biologics | 688185.SS | 1,72 | 1,72 | 0,4 % | health-care |
| Sinopec Oilfield Service | 600871.SS | 4,68 | 4,69 | 0,4 % | energy |
| Sinopec Shanghai Petrochemical | 600688.SS | 3,73 | 3,74 | 0,4 % | energy |
| China Longyuan Power | 001289.SZ | 13,52 | 13,71 | 1,4 % | utilities |
| Yankuang Energy | 600188.SS | 19,86 | 20,55 | 3,4 % | energy |
| CNOOC | 0883.HK, jetzt 600938.SS | 142,35 | 147,42 | 3,6 % | energy |

Ränge und Scores: Wachstum 9.346 Zeilen, Qualität 7.187 Zeilen in beiden Armen. Bewegt haben sich nur die 24 Börsenwerte der Tabelle und der Zeilentausch bei CNOOC (Wachstum: 0883.HK Rang 204, Score 45,3 fällt weg, 600938.SS kommt auf Rang 208 mit 45,1; PT Bukit Asam, GeoPark, AntarChile und China Aviation Oil rücken je einen Platz vor; Tourmaline 48,3 auf 48,4 und Eni 42,1 auf 42,2. Qualität: 0883.HK Rang 49 wird 600938.SS Rang 49, Score 65,1 gleich). Sonst ändert sich kein Rang und kein Score. Größenklasse: nur Jiangling wechselt von Mid (ab 2 Mrd. USD) zu Small.

Die nicht gezeigte Hongkonger Zeile 1787.HK von Shandong Gold trägt ohne ihre alte Zeile wieder den Yahoo-Wert (10,63 Mrd. USD); sie liegt unter der Summe und kann die gezeigte Zeile nicht ablösen.

## Was nicht abgedeckt ist

- Pinfra (Mexiko, Serien * und L): die L-Serie hat keine Schlusskurse im Kursspeicher; Pinfra bleibt bei 3,9 % zu viel (Nachfolger-Test, bekannte Abweichung).
- Die drei übrigen Zeilen mit Kursverhältnis in der Aktienzahl-Handtabelle (ISA Energia ISAE3.SA, Hanwha 003535.KS, Lindt LISN.SW) haben andere Klassenarten (Vorzugsaktien, Partizipationsscheine) und bleiben unverändert.
- Der Small-Cap-Bestand bekommt keine Klassensumme.
- Fällt die Summe unter die Mindestgröße von 800 Mio. USD, prüft der Lauf das nicht nach (heute ist der kleinste Wert CanSino mit 1,72 Mrd. USD).
- Die Aktienzahlen ändern sich nur mit neuen Belegen; neue Aktien sieht der Schritt nicht von selbst (Prüfdatum 31.03.2027).

## Prüfung

`tests/mcap-class-sum.test.js` auf den echten Paketen des 07.11.: Summe unabhängig nachgerechnet, vorher falsch und nachher richtig für neun Firmen, ein gemeinsamer Handelstag, leere Werte mit Grund, gesperrte Zeilen unberührt, keine andere Zeile überbietet die Summe, Lese-Kopie des Wächters behält Wert und Hinweis, Schritt im Merge-Job an der richtigen Stelle; `--prove-red` nimmt ZTE aus der Datei und muss rot werden. Angepasst: `tests/share-count-hand-table.test.js`, `tests/hand-table-boersenwerte-20261101.test.js`, `tests/hand-table-zahlenjagd-r25-20261030.test.js`, `tests/hand-table-nachfolger-20261104.test.js` (spielt die Summe mit; acht P1-Firmen jetzt innerhalb von 3 %, beim Ablauf am 01.01.2027 fallen statt 16 nur noch vier Firmen weg).
