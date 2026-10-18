> **Auf einen Blick**
>
> Auf dem Datenstand vom 17.10.2026 ändern die 26 neuen Handtabellenzeilen die vier beanstandeten Firmen; fast alle übrigen Bewegungen liegen in deren drei Ranglisten und kommen aus der neuen Rangfolge.
> - CD Projekt (CDR.WA): Kein Wert mehr vergleicht über den Verkauf von GOG hinweg. Umsatzwachstum 12,67 % (Quartal) → 8,59 % (Geschäftsjahr 2025 gegen 2024, beide ohne GOG), Rule of X −14,3 → −23,7; Software und Kommunikation unprofitabel Rang 11 → 40, Score 70,4 → 57,3.
> - Bullish (BLSH) und Victory Capital (VCTR): Bruttogewinnwachstum +1.303,1 % bzw. +34,2 % → leer mit Grund; BLSH Rang 99 → 111 (Score 34,5 → 24,9, fällt aus den ersten 100), VCTR Rang 38 → 76 (Score 67,4 → 61,0, fällt aus der Finanzen-Kurzliste).
> - Gansu Energy Chemical (000552.SZ): Umsatzwachstum 22,20 % → 21,20 %, Rule of X 10,7 → 8,4, Rang 19 und Score 39,3 unverändert.

# Handtabelle 18.10.2026: vorher und nachher

## Messung

Beide Arme rechnen denselben Tageslauf vom 17.10.2026 nach: Code und Daten des damaligen Auslösecommits `df47be8`, das Snapshot-Artefakt des Laufs 39036704898 (16.111 Dateien, 16.091 bewertete Snapshots) und dessen Übergabedateien (ATH-Stand, Makroregime, Abdeckung). Die Uhr steht in jedem Prozess fest auf 2026-10-17T14:47:00Z. Gerechnet werden dieselben Schritte wie im Bewertungsjob: OpInc-Quelle, Screener, Wert-Merkliste, findash-Export, Ausschlussliste, Rule of 40, Filter-Universum, Bewertung, Preisschritt (Kursbestand des damaligen main-Stands `7f6980d`) und das Board-Vintage. Der einzige Unterschied zwischen den Armen ist `configs/financial-known-cases.json` (vorher Stand `df47be8`, nachher dieser Zweig mit 26 Zeilen).

**Nachstellung geprüft:** Der Vorher-Arm trifft den veröffentlichten Export vom 17.10. (gh-pages) in allen 64 Listen außerhalb des Small-Cap-Bestands, einschließlich `filter/universum.json` und `filter/preisschritt.json`, bei jedem Rang und jedem Score; abweichend sind nur die Herkunftsangaben (Laufkennung und Zeit). Nicht nachgestellt ist der Small-Cap-Bestand, weil dessen Zwischenspeicher nicht abrufbar ist; die Small-Cap-Listen fehlen deshalb in beiden Armen gleich.

**Werkzeug Tagesdifferenz:** `scripts/tagesdifferenz.js` vergleicht die beiden Board-Vintages mit der neuen Handtabelle. Weil das Werkzeug aufsteigende Daten verlangt, liegt der Nachher-Arm unter dem Hilfsdatum 18.10.; Datenstand ist in beiden Armen der 17.10. Ergebnis: 9.656 Kürzel in beiden Ständen, 0 Abgänge, 0 Zugänge, 338 geänderte Historienzeilen (Finanzen profitabel 216, Software und Kommunikation unprofitabel 118, Energie unprofitabel 1, Immobilien profitabel 2, Zyklischer Konsum profitabel 1). Klasse HANDTABELLE bei CDR.WA und 000552.SZ, bei allen übrigen „Eingabe unverändert“. Andere Firmen verschieben sich in der vollständigen Historie um höchstens 2 Plätze. Jahreszellen rekonstruiert das Werkzeug ausdrücklich nicht; bei BLSH und VCTR steht deshalb ebenfalls „Eingabe unverändert“.

## Die vier Firmen

| Firma | Liste | Rang vorher → nachher | Score vorher → nachher | Sichtbare Kennzahlen vorher → nachher |
|---|---|---:|---:|---|
| CD Projekt (CDR.WA) | Software und Kommunikation, unprofitabel | 11 → 40 | 70,4 → 57,3 | Umsatzwachstum 12,67 % (Quartal) → 8,59 % (Jahr); Rule of X −14,3 → −23,7; Bruttogewinnwachstum 15,8 % unverändert |
| CD Projekt (CDR.WA) | Qualität Software und Kommunikation, profitabel | 39 → 47 | 72,1 → 70,3 | wie oben |
| CD Projekt (OTGLF, Ausschlussliste) | nicht auf einem Board (Notierung außerhalb der USA) | ohne Rang | ohne Score | Umsatzwachstum 12,67 % → 8,59 % |
| Bullish (BLSH) | Software und Kommunikation, unprofitabel | 99 → 111 | 34,5 → 24,9 | Bruttogewinnwachstum +1.303,1 % → leer; Rule of X −102 unverändert |
| Victory Capital (VCTR) | Finanzen, profitabel | 38 → 76 | 67,4 → 61,0 | Bruttogewinnwachstum +34,2 % → leer; Rule of X 88,5 unverändert |
| Gansu Energy Chemical (000552.SZ) | Energie, unprofitabel | 19 → 19 | 39,3 → 39,3 | Umsatzwachstum 22,20 % → 21,20 %; Rule of X 10,7 → 8,4 |

**CD Projekt im Einzelnen:** Die Firma weist 2024, 2025 und die Vorjahresquartale 2025 nach dem Verkauf von GOG ohne GOG aus; die Anbieterreihen mischten beide Abgrenzungen. Jetzt gilt:

- Zweites Quartal 2025 auf der neuen Basis: Umsatz 216,7 → 174,9, Betriebsergebnis 72,5 → 72,2, Bruttogewinn 163,9 → 150,9 Mio. PLN.
- Viertes Quartal 2025 zurückgehalten (Umsatz 74,9, Betriebsergebnis 108,0, Bruttogewinn 149,8 Mio. PLN): jeweils Jahr ohne GOG minus neun Monate mit GOG, keine berichteten Zahlen. Damit gibt es kein Quartalspaar mehr; das Umsatzwachstum kommt aus dem bestehenden Jahresvergleich 2025 gegen 2024 (8,59 %).
- Jahreswerte 2023 (Umsatz, Bruttogewinn) zurückgehalten, 2022 nach der Regel ohne Lücken mit: Diese Jahre enthalten GOG.
- Achsen (Perzentile vorher → nachher): Umsatzwachstum und Rule of X 43,9 → 39,8, Umsatzbeschleunigung 88,8 → leer, Bruttogewinnwachstum 71,7 → 61,8, Margentrajektorie 79,9 → 77,7 (jetzt zweites Quartal 2026 gegen zweites Quartal 2025, beide ohne GOG), Kapitaleffizienz 94,3 → 96,1; abgedeckte Achsen 6/7 → 5/7.
- Weitere sichtbare Felder: Lampe „Spitzenmarge“ entfällt; Quartalspunkte 5 → 4; Einmalertrag-Bewertbarkeit leer → „zu wenige Quartale“; Dreijahreswachstum im Filter −3,09 % → leer; Rule of 40 im Filter −30,79 → −34,87. Das angezeigte Bruttogewinnwachstum (2025 gegen 2024, beide ohne GOG) bleibt 15,8 %.
- Ablauf: Zeigt der Bericht zum dritten Quartal 2026 das dritte Quartal 2025 ohne GOG, lassen sich drittes und viertes Quartal 2025 auf einer Basis eintragen; dann ist wieder ein Quartalsvergleich möglich.

**Gansu Energy Chemical im Einzelnen:** Das zweite Quartal 2025 steht auf der angepassten Basis (Umsatz 1.802,1 → 1.817,1 Mio. CNY). Betriebsergebnis (−212,5 Mio. CNY) und Bruttogewinn (205,1 Mio. CNY) dieses Quartals stehen beim Anbieter noch vor dem Zusammenschluss und werden zurückgehalten, damit sie nicht mit dem angepassten Umsatz verrechnet werden. Score und Rang ändern sich nicht: Die Margentrajektorie vergleicht das zweite Quartal 2026 mit dem ersten Quartal 2025, und beim Umsatzwachstum liegt in der Kohorte zwischen 21,20 % und 22,20 % kein anderer Wert. Das Schattenfeld des Bruttogewinnwachstums (`g31OverviewShadow`) fällt von +174,2 % (Quartal gegen nicht angepasstes Vorjahr) auf den Jahreswert −60,9 %.

Bei BLSH und VCTR entfällt die Achse Bruttogewinnwachstum (Perzentil 99,6 bzw. 81,6); die übrigen Achsen tragen den Score allein (kein Ersatzwert 0).

## Kurzlisten

- Software und Kommunikation, unprofitabel (erste 100): BLSH fällt heraus (Rang 99), 600037.SS kommt auf Rang 99 hinzu. CDR.WA bleibt mit Rang 40 in der Kurzliste.
- Finanzen, profitabel (Kurzliste mit 100 Zeilen): VCTR fällt heraus (Rang 38), NAM-INDIA.NS kommt auf Rang 63 hinzu.
- Alle übrigen Kurzlisten haben dieselben Mitglieder.

## Weitere Bewegungen

Insgesamt ändern sich 848 Listenzeilen bei 382 Kürzeln (Rang oder Score), davon 310 im Filter-Universum (Spalten Rang und Score, Spiegel der Boards) und 538 in Boards und Übersichten. Fast alle liegen in den drei Ranglisten der vier Firmen und den daraus gebildeten Übersichten: Finanzen profitabel, Software und Kommunikation unprofitabel, Qualität Software und Kommunikation profitabel, Überblick, Qualität Überblick sowie zwei Zeilen der Rule-of-40-Übersicht. Grund ist die Rangfolge innerhalb der Kohorte: Fällt ein Wert weg oder ändert er sich, verschieben sich die Perzentile der Nachbarn.

Drei Zeilen liegen außerhalb dieser Kohorten: 300043.SZ (Zyklischer Konsum, vollständige Liste Rang 1069, Score 13,4 → 13,5) sowie ein Platztausch EMBDL.BO / 600657.SS (Immobilien, vollständige Liste 523/524, Score 12,7 unverändert). Ursache ist die universumsweite Begrenzung der Quartalsraten (Winsor-Grenzen) und der Wachstumsgrenzen: Mit dem zurückgehaltenen vierten Quartal von CD Projekt fallen zwei extreme Quartalsraten (+155 % und −79 %) aus der Stichprobe, eine dritte ändert sich, und die Grenzen verschieben sich minimal (Quartalsrate obere Grenze 1,69191 → 1,69199). Dadurch ändern sich bei sechs Firmen in diesen beiden Kohorten Achsenperzentile um Bruchteile eines Punkts; sichtbar wird das nur in den drei genannten Zeilen. Aus demselben Grund ändert sich das Schattenfeld `annualPairsShadow` bei 272 Zeilen; es geht in keinen Score ein.

Bei den übrigen Firmen bewegt sich der Score um höchstens 0,5 Punkte (300496.SZ 76,6 → 77,1); der größte sichtbare Rangwechsel ist NBIS im Überblick (192 → 177, Score 84,2 → 84,5). Der Preisschritt (`filter/preisschritt.json`) ist in beiden Armen gleich. Die Datei `handtabelle-20261018-vorher-nachher-2026-10-17.csv` daneben enthält alle 852 Zeilen (848 geänderte, 2 Abgänge, 2 Zugänge) einschließlich der vollständigen Listen und des Filter-Universums.

Sichtbare Rangwechsel anderer Firmen (Kurzlisten und Übersichten ohne Filter-Spiegel; viele sind Platztausche bei gleichem angezeigtem Score):

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
| Überblick | HEROMOTOCO.NS | 177 → 178 | 84,4 → 84,4 |
| Überblick | 3677.HK | 178 → 179 | 84,4 → 84,4 |
| Überblick | 300502.SZ | 179 → 180 | 84,4 → 84,4 |
| Überblick | LUXE | 180 → 181 | 84,4 → 84,4 |
| Überblick | OPCT3.SA | 181 → 182 | 84,4 → 84,4 |
| Überblick | 688331.SS | 182 → 183 | 84,4 → 84,4 |
| Überblick | 688169.SS | 183 → 184 | 84,3 → 84,3 |
| Überblick | UAN | 184 → 185 | 84,3 → 84,3 |
| Überblick | 001267.SZ | 185 → 186 | 84,3 → 84,3 |
| Überblick | IMP.JO | 186 → 187 | 84,3 → 84,3 |
| Überblick | 300033.SZ | 187 → 188 | 84,3 → 84,3 |
| Überblick | CVNA | 188 → 189 | 84,2 → 84,2 |
| Überblick | DOFG.OL | 189 → 190 | 84,2 → 84,2 |
| Überblick | 689009.SS | 190 → 191 | 84,2 → 84,2 |
| Überblick | 298380.KQ | 191 → 192 | 84,2 → 84,2 |
| Überblick | NBIS | 192 → 177 | 84,2 → 84,5 |
| Qualität Überblick | SCCO | 101 → 102 | 82,9 → 82,9 |
| Qualität Überblick | 6656.HK | 102 → 103 | 82,9 → 82,9 |
| Qualität Überblick | 3293.TWO | 103 → 101 | 82,9 → 82,9 |
| Qualität Überblick | 3308.HK | 112 → 113 | 82,4 → 82,4 |
| Qualität Überblick | 462870.KS | 113 → 112 | 82,3 → 82,4 |
| Qualität Überblick | MSA.TO | 119 → 120 | 82,1 → 82,1 |
| Qualität Überblick | FDJ.VI | 120 → 121 | 82,1 → 82,1 |
| Qualität Überblick | HINDZINC.BO | 121 → 122 | 82,1 → 82,1 |
| Qualität Überblick | 3563.TW | 122 → 123 | 82,1 → 82,1 |
| Qualität Überblick | 259960.KS | 123 → 119 | 82,1 → 82,2 |
| Qualität Überblick | FRES.MX | 124 → 125 | 81,9 → 81,9 |
| Qualität Überblick | 002558.SZ | 125 → 124 | 81,9 → 81,9 |
| Qualität Überblick | CPPLUS.BO | 142 → 143 | 81 → 81 |
| Qualität Überblick | 688692.SS | 143 → 142 | 81 → 81 |
| Qualität Überblick | 1208.HK | 148 → 149 | 80,8 → 80,8 |
| Qualität Überblick | 6805.TW | 149 → 150 | 80,8 → 80,8 |
| Qualität Überblick | 688615.SS | 150 → 148 | 80,8 → 80,9 |
| Qualität Überblick | 688836.SS | 159 → 160 | 80,6 → 80,6 |
| Qualität Überblick | HCLTECH.NS | 160 → 161 | 80,5 → 80,5 |
| Qualität Überblick | RGSI.TO | 161 → 163 | 80,5 → 80,5 |
| Qualität Überblick | CMB.MI | 162 → 164 | 80,5 → 80,5 |
| Qualität Überblick | ADYEN.SW | 163 → 162 | 80,5 → 80,5 |
| Qualität Überblick | 4776.T | 164 → 159 | 80,5 → 80,6 |
| Qualität Software und Kommunikation, profitabel | ADYEN.SW | 14 → 15 | 80,5 → 80,5 |
| Qualität Software und Kommunikation, profitabel | 4776.T | 15 → 14 | 80,5 → 80,6 |
| Qualität Software und Kommunikation, profitabel | OFSS.NS | 30 → 31 | 74,9 → 74,9 |
| Qualität Software und Kommunikation, profitabel | 002602.SZ | 31 → 32 | 74,9 → 74,9 |
| Qualität Software und Kommunikation, profitabel | PAYX | 32 → 30 | 74,9 → 74,9 |
| Qualität Software und Kommunikation, profitabel | 9911.HK | 40 → 39 | 71,8 → 71,8 |
| Qualität Software und Kommunikation, profitabel | SEK.AX | 41 → 40 | 71,4 → 71,4 |
| Qualität Software und Kommunikation, profitabel | ADBE | 42 → 41 | 71,1 → 71,1 |
| Qualität Software und Kommunikation, profitabel | NFLX | 43 → 42 | 71 → 71 |
| Qualität Software und Kommunikation, profitabel | 2492.T | 44 → 43 | 70,8 → 70,8 |
| Qualität Software und Kommunikation, profitabel | VRSN | 45 → 44 | 70,5 → 70,5 |
| Qualität Software und Kommunikation, profitabel | REA.AX | 46 → 45 | 70,5 → 70,5 |
| Qualität Software und Kommunikation, profitabel | BLACKBUCK.BO | 47 → 46 | 70,4 → 70,4 |
| Qualität Software und Kommunikation, profitabel | SGE.L | 59 → 61 | 68,1 → 68,1 |
| Qualität Software und Kommunikation, profitabel | GRND | 61 → 59 | 68,1 → 68,1 |
| Qualität Software und Kommunikation, profitabel | MSFT | 62 → 63 | 67,9 → 68 |
| Qualität Software und Kommunikation, profitabel | 9766.T | 63 → 64 | 67,9 → 67,9 |
| Qualität Software und Kommunikation, profitabel | SHOP | 64 → 62 | 67,9 → 68 |
| Qualität Software und Kommunikation, profitabel | 581A.T | 76 → 78 | 66,1 → 66,1 |
| Qualität Software und Kommunikation, profitabel | PAYP | 78 → 76 | 66,1 → 66,2 |
| Qualität Software und Kommunikation, profitabel | PEXIP.OL | 85 → 86 | 64,4 → 64,4 |
| Qualität Software und Kommunikation, profitabel | RDVT | 86 → 85 | 64,4 → 64,4 |
| Software und Kommunikation, unprofitabel | PAYTM.BO | 4 → 5 | 78,4 → 78,7 |
| Software und Kommunikation, unprofitabel | 6880.HK | 5 → 4 | 78,3 → 78,7 |
| Software und Kommunikation, unprofitabel | WRD | 7 → 8 | 76,9 → 77,1 |
| Software und Kommunikation, unprofitabel | 300496.SZ | 8 → 7 | 76,6 → 77,1 |
| Software und Kommunikation, unprofitabel | SOUN | 12 → 11 | 70,3 → 70,6 |
| Software und Kommunikation, unprofitabel | PLUS | 13 → 12 | 70,2 → 70,5 |
| Software und Kommunikation, unprofitabel | 2643.HK | 14 → 13 | 70 → 70,3 |
| Software und Kommunikation, unprofitabel | 688507.SS | 15 → 14 | 69,7 → 69,8 |
| Software und Kommunikation, unprofitabel | INFQ | 16 → 15 | 67,7 → 67,9 |
| Software und Kommunikation, unprofitabel | CRWV | 17 → 16 | 67,3 → 67,5 |
| Software und Kommunikation, unprofitabel | GRAB | 18 → 17 | 67,2 → 67,5 |
| Software und Kommunikation, unprofitabel | 0020.HK | 19 → 18 | 67,2 → 67,5 |
| Software und Kommunikation, unprofitabel | AMAGI.NS | 20 → 19 | 67,1 → 67,4 |
| Software und Kommunikation, unprofitabel | 0100.HK | 21 → 20 | 67 → 67,3 |
| Software und Kommunikation, unprofitabel | 2590.HK | 23 → 21 | 66,1 → 66,4 |
| Software und Kommunikation, unprofitabel | MP1.AX | 24 → 23 | 64,8 → 65,2 |
| Software und Kommunikation, unprofitabel | 300418.SZ | 25 → 24 | 63,3 → 63,7 |
| Software und Kommunikation, unprofitabel | 4478.T | 26 → 25 | 62,3 → 62,6 |
| Software und Kommunikation, unprofitabel | 4180.T | 27 → 26 | 62,2 → 62,5 |
| Software und Kommunikation, unprofitabel | SUNTV.BO | 28 → 27 | 62 → 62,3 |
| Software und Kommunikation, unprofitabel | QNT | 29 → 28 | 62 → 62,2 |
| Software und Kommunikation, unprofitabel | 300442.SZ | 30 → 29 | 61 → 61,2 |
| Software und Kommunikation, unprofitabel | GOTO.JK | 32 → 30 | 60,7 → 61,2 |
| Software und Kommunikation, unprofitabel | 600986.SS | 33 → 32 | 60,7 → 60,8 |
| Software und Kommunikation, unprofitabel | 000676.SZ | 34 → 33 | 59,5 → 59,8 |
| Software und Kommunikation, unprofitabel | KC | 35 → 34 | 59 → 59,4 |
| Software und Kommunikation, unprofitabel | AMC | 36 → 35 | 59 → 59,2 |
| Software und Kommunikation, unprofitabel | URBANCO.BO | 37 → 36 | 58,8 → 59 |
| Software und Kommunikation, unprofitabel | PDFS | 38 → 37 | 58,4 → 58,9 |
| Software und Kommunikation, unprofitabel | 601360.SS | 40 → 38 | 57 → 57,5 |
| Software und Kommunikation, unprofitabel | XNDU | 50 → 51 | 50,4 → 50,5 |
| Software und Kommunikation, unprofitabel | 3994.T | 51 → 50 | 50,2 → 50,6 |
| Software und Kommunikation, unprofitabel | LSPD | 61 → 62 | 46,2 → 46,3 |
| Software und Kommunikation, unprofitabel | 4072.SR | 62 → 61 | 46 → 46,3 |
| Software und Kommunikation, unprofitabel | 601098.SS | 86 → 87 | 38,3 → 38,3 |
| Software und Kommunikation, unprofitabel | RUM | 87 → 86 | 38,3 → 38,4 |

## Grenzen

- Der Small-Cap-Bestand des 17.10. ist nicht abrufbar und deshalb nicht nachgestellt. Beim Lesen läuft jede Datei durch dieselbe Handtabelle; Small-Cap-Zeilen der vier Firmen ändern sich beim nächsten Lauf auf dieselbe Weise.
- Der quartalsweise Bruttogewinn von BLSH und VCTR bleibt unverändert (bei VCTR wie bisher ohne das vierte Quartal 2025). Er fließt weder in Score noch in die angezeigte Bruttogewinnspalte, steht aber im Schattenfeld `g31OverviewShadow` weiter mit Anbieterwerten (BLSH +290,6 %, VCTR +32,2 %). Würde dieser Schatten live geschaltet, brauchen beide Reihen dieselbe Zurückhaltung.
- Die Abdeckung reicht bis 30.06.2026. Liefert der Anbieter das dritte Quartal 2026, wird es bis zur nächsten geprüften Zeile zurückgehalten (bei CD Projekt für Umsatz, Betriebsergebnis und Bruttogewinn). Bei 000552.SZ fehlt das dritte Quartal 2025 schon in der Anbieterreihe; dort entfällt das Quartalspaar mit dem nächsten Bericht unabhängig von dieser Tabelle. Termine: Berichte zum dritten Quartal 2026 bis Ende Oktober (000552.SZ) beziehungsweise Ende November (CD Projekt).
- Wirkung im Betrieb: Die Tabelle wirkt beim nächsten Tageslauf sofort beim Lesen; ein neues Abrufen der Firmen ist nicht nötig.

## Nachweis

Gerechnet in zwei lokalen Arbeitskopien außerhalb des Repositorys mit identischen Eingaben; alle Rohdateien blieben unverändert. Die Zahlen oben stammen aus dem Vergleich der beiden Exportbäume (`outputs/findash-export/v1`) und aus dem Bericht von `scripts/tagesdifferenz.js` mit `--full-changes`.
