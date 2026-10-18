> **Auf einen Blick**
>
> Auf dem Datenstand vom 17.10.2026 ändern die zwölf neuen Handtabellenzeilen genau die vier beanstandeten Firmen; alle übrigen Bewegungen liegen in deren drei Ranglisten und kommen aus der neuen Rangfolge.
> - CD Projekt (CDR.WA): Umsatzwachstum 12,67 % → 39,60 %, Software und Kommunikation unprofitabel Rang 11 → 3, Score 70,4 → 79,6.
> - Bullish (BLSH) und Victory Capital (VCTR): Bruttogewinnwachstum +1.303,1 % bzw. +34,2 % → leer mit Grund; BLSH Rang 99 → 111 (Score 34,5 → 24,9, fällt aus den ersten 100), VCTR Rang 38 → 76 (Score 67,4 → 61,0, fällt aus der Finanzen-Kurzliste).
> - Gansu Energy Chemical (000552.SZ): Umsatzwachstum 22,20 % → 21,20 %, Rang 19 und Score 39,3 unverändert.

# Handtabelle 18.10.2026: vorher und nachher

## Messung

Beide Arme rechnen denselben Tageslauf vom 17.10.2026 nach: Code und Daten des damaligen Auslösecommits `df47be8`, das Snapshot-Artefakt des Laufs 39036704898 (16.111 Dateien, 16.091 bewertete Snapshots) und dessen Übergabedateien (ATH-Stand, Makroregime, Abdeckung). Die Uhr steht in jedem Prozess fest auf 2026-10-17T14:47:00Z. Gerechnet werden dieselben Schritte wie im Bewertungsjob: OpInc-Quelle, Screener, Wert-Merkliste, findash-Export, Ausschlussliste, Rule of 40, Filter, Bewertung und das Board-Vintage. Der einzige Unterschied zwischen den Armen ist `configs/financial-known-cases.json` (vorher Stand `df47be8`, nachher dieser Zweig).

**Nachstellung geprüft:** Der Vorher-Arm trifft den veröffentlichten Export vom 17.10. (gh-pages) in allen 63 Listen außerhalb des Small-Cap-Bestands bei jedem Rang und jedem Score; abweichend sind nur die Herkunftsangaben (Laufkennung und Zeit). Nicht nachgestellt ist der Small-Cap-Bestand, weil dessen Zwischenspeicher nicht abrufbar ist; die Small-Cap-Listen fehlen deshalb in beiden Armen gleich.

**Werkzeug Tagesdifferenz:** `scripts/tagesdifferenz.js` vergleicht die beiden Board-Vintages mit der neuen Handtabelle. Weil das Werkzeug aufsteigende Daten verlangt, liegt der Nachher-Arm unter dem Hilfsdatum 18.10.; Datenstand ist in beiden Armen der 17.10. Ergebnis: 9.656 Kürzel in beiden Ständen, 0 Abgänge, 0 Zugänge, 306 geänderte Historienzeilen, alle in drei Kohorten (Finanzen profitabel 212, Software und Kommunikation unprofitabel 93, Energie unprofitabel 1). Klasse HANDTABELLE bei CDR.WA und 000552.SZ, bei allen übrigen „Eingabe unverändert“. Andere Firmen verschieben sich in der vollständigen Historie um höchstens 3 Plätze. Die Jahreszellen von BLSH und VCTR rekonstruiert das Werkzeug ausdrücklich nicht; dort steht deshalb ebenfalls „Eingabe unverändert“.

## Die vier Firmen

| Firma | Liste | Rang vorher → nachher | Score vorher → nachher | Kennzahl vorher → nachher |
|---|---|---:|---:|---|
| CD Projekt (CDR.WA) | Software und Kommunikation, unprofitabel | 11 → 3 | 70,4 → 79,6 | Umsatzwachstum 12,67 % → 39,60 % |
| CD Projekt (CDR.WA) | Qualität Software und Kommunikation, profitabel | 39 → 27 | 72,1 → 75,7 | Umsatzwachstum 12,67 % → 39,60 % |
| CD Projekt (OTGLF, Ausschlussliste) | nicht auf einem Board (Notierung außerhalb der USA) | ohne Rang | ohne Score | Umsatzwachstum 12,67 % → 39,60 % |
| Bullish (BLSH) | Software und Kommunikation, unprofitabel | 99 → 111 | 34,5 → 24,9 | Bruttogewinnwachstum +1.303,1 % → leer |
| Victory Capital (VCTR) | Finanzen, profitabel | 38 → 76 | 67,4 → 61,0 | Bruttogewinnwachstum +34,2 % → leer |
| Gansu Energy Chemical (000552.SZ) | Energie, unprofitabel | 19 → 19 | 39,3 → 39,3 | Umsatzwachstum 22,20 % → 21,20 % |

Bei BLSH und VCTR entfällt die Achse Bruttogewinnwachstum (Perzentil 99,6 bzw. 81,6); die übrigen Achsen tragen den Score allein (kein Ersatzwert 0). Bei CDR.WA steigen Umsatzwachstum und Rule of X von Perzentil 43,9 auf 79,9; bei 000552.SZ bleibt das Perzentil 50, weil in der Kohorte zwischen 21,20 % und 22,20 % kein anderer Wert liegt.

## Kurzlisten

- Software und Kommunikation, unprofitabel (erste 100): BLSH fällt heraus (Rang 99), 600037.SS kommt auf Rang 99 hinzu.
- Finanzen, profitabel (Kurzliste mit 100 Zeilen): VCTR fällt heraus (Rang 38), NAM-INDIA.NS kommt auf Rang 63 hinzu.
- Alle übrigen Kurzlisten haben dieselben Mitglieder.

## Weitere Bewegungen

Insgesamt ändern sich 450 Listenzeilen bei 322 Kürzeln (Rang oder Score), alle in den drei Ranglisten der vier Firmen und den daraus gebildeten Übersichten: Finanzen profitabel, Software und Kommunikation unprofitabel, Qualität Software und Kommunikation profitabel, Überblick, Qualität Überblick sowie zwei Zeilen der Rule-of-40-Übersicht. Grund ist die Rangfolge innerhalb der Kohorte: Fällt ein Wert weg oder steigt er, verschieben sich die Perzentile der Nachbarn. Kein anderes Board und keine andere Kohorte ändert sich. Bei den übrigen Firmen bewegt sich der Score um höchstens 0,2 Punkte; der größte sichtbare Rangwechsel ist NBIS im Überblick (192 → 183, Score 84,2 → 84,4). Die Datei `handtabelle-20261018-vorher-nachher-2026-10-17.csv` daneben enthält alle 454 Zeilen (450 geänderte, 2 Abgänge, 2 Zugänge) einschließlich der vollständigen Listen.

Sichtbare Rangwechsel anderer Firmen (Kurzlisten und Übersichten; viele sind Platztausche bei gleichem angezeigtem Score):

| Liste | Kürzel | Rang vorher → nachher | Score vorher → nachher |
|---|---|---:|---:|
| Finanzen, profitabel | 0373.HK | 6 → 7 | 79,3 → 79,3 |
| Finanzen, profitabel | 023590.KS | 7 → 6 | 79,3 → 79,3 |
| Finanzen, profitabel | SII | 10 → 11 | 75,6 → 75,6 |
| Finanzen, profitabel | HABITAT.SN | 11 → 10 | 75,6 → 75,6 |
| Finanzen, profitabel | CHOICEIN.NS | 32 → 33 | 68,6 → 68,6 |
| Finanzen, profitabel | AFPCAPITAL.SN | 33 → 32 | 68,6 → 68,6 |
| Finanzen, profitabel | SHRIRAMFIN.NS | 39 → 38 | 67,2 → 67,3 |
| Finanzen, profitabel | ROKO-B.ST | 40 → 39 | 67,2 → 67,3 |
| Finanzen, profitabel | POLICYBZR.NS | 41 → 40 | 66,6 → 66,6 |
| Finanzen, profitabel | BICE.SN | 42 → 41 | 66,2 → 66,2 |
| Finanzen, profitabel | MOL.MI | 43 → 42 | 66 → 66 |
| Finanzen, profitabel | UPST | 44 → 43 | 65,8 → 65,8 |
| Finanzen, profitabel | 600621.SS | 45 → 44 | 65,8 → 65,8 |
| Finanzen, profitabel | MA | 46 → 45 | 65,7 → 65,8 |
| Finanzen, profitabel | 8473.T | 47 → 46 | 65,2 → 65,3 |
| Finanzen, profitabel | 600095.SS | 48 → 47 | 65,1 → 65,1 |
| Finanzen, profitabel | 2127.T | 50 → 48 | 64,8 → 64,9 |
| Finanzen, profitabel | IGG.L | 51 → 50 | 64,7 → 64,8 |
| Finanzen, profitabel | 6080.T | 52 → 51 | 64,7 → 64,8 |
| Finanzen, profitabel | POLR.L | 53 → 52 | 64,3 → 64,3 |
| Finanzen, profitabel | AJG | 55 → 53 | 64,1 → 64,1 |
| Finanzen, profitabel | COF | 57 → 55 | 64 → 64 |
| Finanzen, profitabel | MCX.NS | 59 → 57 | 63,5 → 63,5 |
| Finanzen, profitabel | ABCAPITAL.NS | 60 → 59 | 63,4 → 63,4 |
| Finanzen, profitabel | JCAP | 62 → 60 | 63 → 63,1 |
| Finanzen, profitabel | RKT | 63 → 62 | 63 → 63 |
| Überblick | 688169.SS | 183 → 184 | 84,3 → 84,3 |
| Überblick | UAN | 184 → 185 | 84,3 → 84,3 |
| Überblick | 001267.SZ | 185 → 186 | 84,3 → 84,3 |
| Überblick | IMP.JO | 186 → 187 | 84,3 → 84,3 |
| Überblick | 300033.SZ | 187 → 188 | 84,3 → 84,3 |
| Überblick | CVNA | 188 → 189 | 84,2 → 84,2 |
| Überblick | DOFG.OL | 189 → 190 | 84,2 → 84,2 |
| Überblick | 689009.SS | 190 → 191 | 84,2 → 84,2 |
| Überblick | 298380.KQ | 191 → 192 | 84,2 → 84,2 |
| Überblick | NBIS | 192 → 183 | 84,2 → 84,4 |
| Qualität Überblick | FDJ.VI | 120 → 121 | 82,1 → 82,1 |
| Qualität Überblick | HINDZINC.BO | 121 → 122 | 82,1 → 82,1 |
| Qualität Überblick | 3563.TW | 122 → 123 | 82,1 → 82,1 |
| Qualität Überblick | 259960.KS | 123 → 120 | 82,1 → 82,1 |
| Qualität Überblick | FRES.MX | 124 → 125 | 81,9 → 81,9 |
| Qualität Überblick | 002558.SZ | 125 → 124 | 81,9 → 81,9 |
| Qualität Überblick | 6805.TW | 149 → 150 | 80,8 → 80,8 |
| Qualität Überblick | 688615.SS | 150 → 149 | 80,8 → 80,8 |
| Qualität Überblick | CMB.MI | 162 → 163 | 80,5 → 80,5 |
| Qualität Überblick | ADYEN.SW | 163 → 162 | 80,5 → 80,5 |
| Qualität Software und Kommunikation, profitabel | LFTO | 27 → 28 | 75,5 → 75,5 |
| Qualität Software und Kommunikation, profitabel | 688111.SS | 28 → 29 | 75,1 → 75,1 |
| Qualität Software und Kommunikation, profitabel | BVS.AX | 29 → 30 | 75 → 75 |
| Qualität Software und Kommunikation, profitabel | OFSS.NS | 30 → 31 | 74,9 → 74,9 |
| Qualität Software und Kommunikation, profitabel | 002602.SZ | 31 → 33 | 74,9 → 74,9 |
| Qualität Software und Kommunikation, profitabel | KARO | 33 → 34 | 73,9 → 73,9 |
| Qualität Software und Kommunikation, profitabel | 5032.T | 34 → 35 | 73,8 → 73,8 |
| Qualität Software und Kommunikation, profitabel | 300803.SZ | 35 → 36 | 73,6 → 73,6 |
| Qualität Software und Kommunikation, profitabel | ADSK | 36 → 37 | 73,2 → 73,2 |
| Qualität Software und Kommunikation, profitabel | 377300.KS | 37 → 38 | 72,4 → 72,4 |
| Qualität Software und Kommunikation, profitabel | BYI.JO | 38 → 39 | 72,4 → 72,4 |
| Qualität Software und Kommunikation, profitabel | SGE.L | 59 → 60 | 68,1 → 68,1 |
| Qualität Software und Kommunikation, profitabel | CAR.AX | 60 → 59 | 68,1 → 68,1 |
| Qualität Software und Kommunikation, profitabel | DLO | 77 → 78 | 66,1 → 66,1 |
| Qualität Software und Kommunikation, profitabel | PAYP | 78 → 77 | 66,1 → 66,1 |
| Qualität Software und Kommunikation, profitabel | 0700.HK | 93 → 94 | 63,2 → 63,2 |
| Qualität Software und Kommunikation, profitabel | 4704.T | 94 → 93 | 63,2 → 63,2 |
| Qualität Software und Kommunikation, profitabel | 3769.T | 98 → 99 | 62,5 → 62,5 |
| Qualität Software und Kommunikation, profitabel | PRGS | 99 → 98 | 62,5 → 62,5 |
| Software und Kommunikation, unprofitabel | 301091.SZ | 3 → 4 | 79,1 → 79,2 |
| Software und Kommunikation, unprofitabel | PAYTM.BO | 4 → 6 | 78,4 → 78,3 |
| Software und Kommunikation, unprofitabel | BTDR | 6 → 7 | 77,9 → 77,9 |
| Software und Kommunikation, unprofitabel | WRD | 7 → 8 | 76,9 → 77,1 |
| Software und Kommunikation, unprofitabel | 300496.SZ | 8 → 9 | 76,6 → 76,7 |
| Software und Kommunikation, unprofitabel | 300133.SZ | 9 → 10 | 76,6 → 76,7 |
| Software und Kommunikation, unprofitabel | 688158.SS | 10 → 11 | 70,8 → 70,7 |
| Software und Kommunikation, unprofitabel | GRAB | 18 → 19 | 67,2 → 67,1 |
| Software und Kommunikation, unprofitabel | 0020.HK | 19 → 21 | 67,2 → 67,1 |
| Software und Kommunikation, unprofitabel | 0100.HK | 21 → 18 | 67 → 67,2 |
| Software und Kommunikation, unprofitabel | 6682.HK | 22 → 23 | 66,1 → 65,9 |
| Software und Kommunikation, unprofitabel | 2590.HK | 23 → 22 | 66,1 → 66 |
| Software und Kommunikation, unprofitabel | SUNTV.BO | 28 → 29 | 62 → 61,9 |
| Software und Kommunikation, unprofitabel | QNT | 29 → 28 | 62 → 62,1 |
| Software und Kommunikation, unprofitabel | GOTO.JK | 32 → 33 | 60,7 → 60,6 |
| Software und Kommunikation, unprofitabel | 600986.SS | 33 → 32 | 60,7 → 60,8 |
| Software und Kommunikation, unprofitabel | SAREGAMA.NS | 39 → 40 | 57,1 → 57 |
| Software und Kommunikation, unprofitabel | 601360.SS | 40 → 39 | 57 → 57,1 |
| Software und Kommunikation, unprofitabel | 3738.HK | 45 → 46 | 53,6 → 53,4 |
| Software und Kommunikation, unprofitabel | 2513.HK | 46 → 45 | 53,5 → 53,6 |
| Software und Kommunikation, unprofitabel | 300166.SZ | 52 → 53 | 49,8 → 49,6 |
| Software und Kommunikation, unprofitabel | 301248.SZ | 53 → 52 | 49,7 → 49,7 |
| Software und Kommunikation, unprofitabel | 300226.SZ | 90 → 91 | 37,7 → 37,6 |
| Software und Kommunikation, unprofitabel | 002195.SZ | 91 → 90 | 37,7 → 37,6 |
| Software und Kommunikation, unprofitabel | 6651.HK | 92 → 93 | 36,8 → 36,6 |
| Software und Kommunikation, unprofitabel | 002153.SZ | 93 → 92 | 36,5 → 36,6 |

## Grenzen

- Der Small-Cap-Bestand des 17.10. ist nicht abrufbar und deshalb nicht nachgestellt. Beim Lesen läuft jede Datei durch dieselbe Handtabelle; Small-Cap-Zeilen der vier Firmen ändern sich beim nächsten Lauf auf dieselbe Weise.
- Der quartalsweise Bruttogewinn von BLSH und VCTR bleibt unverändert (bei VCTR wie bisher ohne das vierte Quartal 2025). Er fließt weder in Score noch in die angezeigte Bruttogewinnspalte, steht aber im Schattenfeld `g31OverviewShadow` weiter mit Anbieterwerten (BLSH +290,6 %, VCTR +32,2 %). Würde dieser Schatten live geschaltet, brauchen beide Reihen dieselbe Zurückhaltung.
- Wirkung im Betrieb: Die Tabelle wirkt beim nächsten Tageslauf sofort beim Lesen; ein neues Abrufen der Firmen ist nicht nötig.

## Nachweis

Gerechnet in zwei lokalen Arbeitskopien außerhalb des Repositorys mit identischen Eingaben; alle Rohdateien blieben unverändert. Die Zahlen oben stammen aus dem Vergleich der beiden Exportbäume (`outputs/findash-export/v1`) und aus dem Bericht von `scripts/tagesdifferenz.js` mit `--full-changes`.
