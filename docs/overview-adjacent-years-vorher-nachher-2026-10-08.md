# Übersichtsspalte Wachstum: nur noch aus benachbarten Geschäftsjahren (P158, 08.10.2026)

> **Auf einen Blick**
> **Die Wachstumsspalte der Übersicht zeigt bei 23 Firmen künftig keine Zahl mehr, weil die bisherige Zahl kein Jahreswachstum war; Score, Rang und Reihenfolge aller 9.668 Übersichtszeilen bleiben unverändert.**
> - 11 Firmen verglichen zwei Jahre mit einem Jahr ohne Wert dazwischen, zum Beispiel 7827.TW (bisher +15.152,7 %, weil 9,8 Mio. gegen 64 Tsd. aus dem vierten Jahr zurück standen) und 301563.SZ (bisher minus 80,5 %, weil 2025 gegen 2023 verglichen wurde).
> - 12 weitere Firmen haben aufeinanderfolgende Werte, deren Jahresenden aber 184 bis 731 Tage auseinanderliegen. Diese Gruppe ist größer als die Zählung der Prüfung V-DL3 und kann bei Bedarf einzeln zurückgenommen werden (eine Bedingung im Code).
> - Sicherheit, dass die Änderung genau diese 23 Zeilen betrifft und sonst nichts: 92 %. Sicherheit, dass die 23 Zahlen vorher falsch als Jahreswachstum standen: 90 %, bei den 12 Firmen mit abweichenden Jahresenden 80 %, weil dort ein verlängertes oder verkürztes Geschäftsjahr nach einem Wechsel des Bilanzstichtags vorliegen kann.

## Was sich ändert

Die Spalte rechnet bisher aus den zwei jüngsten vorhandenen Jahreswerten, auch wenn dazwischen ein Jahr ohne Wert lag. Jetzt gilt: Die beiden Werte müssen direkt hintereinander gespeichert sein, und wenn beide Jahresenden bekannt sind, müssen sie 334 bis 397 Tage auseinanderliegen. Sonst bleibt das Feld leer. Eine echte Null (zwei gleiche Jahre) bleibt eine Null. Der Quartalsweg (acht lückenlose Quartale) und die Regel, dass ein nicht positives Vorjahr kein Wachstum ergibt, sind unverändert. Der Auftrag nannte 330 bis 400 Tage; verwendet werden die bereits gemessenen Grenzen 334 bis 397 aus P115. Zwischen 330 und 333 sowie zwischen 398 und 400 liegt in den 07.10.-Daten kein einziges Paar (Befehl: window-scan.js, 0 und 0), das Ergebnis wäre mit den Auftragsgrenzen also gleich.

Der Grund („Jahreswachstum nicht belegt, Jahre liegen nicht hintereinander") und die Kennzeichnung „Wert fehlt" hängen am Rechenergebnis der Spalte. Der Export reicht sie nicht weiter, weil score.js unbekannte Schlüssel verwirft. In findash erscheint das Feld deshalb leer, ohne Begründung. Das zu ändern verlangt eine Änderung an score.js (ebenfalls unter dem Siegel) und am Exportvertrag.

## Messung

Datenstand: Snapshots vom 07.10.2026 (16.150 Dateien, 16.145 Firmen geladen). Gleicher Ablauf wie die tägliche Berechnung (laden, bewerten, ordnen), einmal mit dem Code vor der Änderung (215f0f7821) und einmal mit der Änderung, sonst Zeile für Zeile identisch. Befehle: replay.js old und new, danach compare.js (alle unter ergebnisse\P158\tools\).

| Vergleich | Ergebnis |
|---|---|
| Übersichtszeilen vorher und nachher | 9.668 und 9.668 |
| Zeilen mit anderem Score | 0 |
| Zeilen mit anderem Platz | 0 |
| Zeilen mit anderer Spaltenart oder anderer Begleitspalte | 0 und 0 |
| Reiter (13 Branchen mal 2 Tracks), Zeilen mit anderem Score oder anderer Reihenfolge | 26 Reiter, 0 und 0 |
| Zeilen mit geänderter Wachstumszahl (Übersicht und Reiter) | 23 und 23 |
| Zeilen der Überlebensliste mit anderer Zahl | 0 |

Von den 23 Firmen stehen 4 in den ersten 100 Plätzen eines Branchen-Reiters: PGHL.NS (health-care, profitabel, Platz 31); TIC (industrials, unprofitabel, Platz 15); LSF.AX (financials, profitabel, Platz 88); HAS.L (industrials, unprofitabel, Platz 68). Alle 23 gehören zur Kohorte des Boards vom 07.10.2026 (board-history). Der beste Übersichtsplatz unter den 23 ist 383, in den ersten 200 der Übersicht ändert sich also nichts.

## Die 11 Firmen mit fehlendem Jahr dazwischen

| Firma | Reiter | Spalte | Vorher | Nachher | Platz in der Übersicht (vorher und nachher) | Grund |
|---|---|---|---|---|---|---|
| SNL.AX (Supply Network Limited) | consumer-discretionary, profitabel | Bruttogewinn | +33,7 % | leer | 989 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |
| VAU.AX (Vault Minerals Limited) | materials, profitabel | Bruttogewinn | +367,0 % | leer | 1.006 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |
| DRD (DRDGOLD Limited) | materials, profitabel | Bruttogewinn | +229,6 % | leer | 1.203 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |
| 301563.SZ (ICkey (Shanghai) Internet and Technology Co.,Ltd.) | consumer-discretionary, profitabel | Bruttogewinn | -80,5 % | leer | 1.775 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |
| LSF.AX (L1 Long Short Fund Limited) | financials, profitabel | Umsatz (Ersatzspalte für Finanzfirmen) | +237,3 % | leer | 2.111 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |
| HAS.L (Hays plc) | industrials, unprofitabel | Bruttogewinn | -18,7 % | leer | 3.417 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |
| KRT.BO (Knowledge Realty Trust) | real-estate, profitabel | Mittelzufluss aus dem Betrieb, Näherung (Immobilienfirmen) | +53,8 % | leer | 3.457 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |
| 9887.HK (Nanjing Leads Biolabs Co., Ltd.) | health-care, unprofitabel | Bruttogewinn | +3.020,7 % | leer | 5.006 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |
| P40U.SI (Starhill Global Real Estate Investment Trust) | real-estate, profitabel | Mittelzufluss aus dem Betrieb, Näherung (Immobilienfirmen) | +5,5 % | leer | 5.241 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |
| 7827.TW (HanchorBio Inc.) | health-care, unprofitabel | Bruttogewinn | +15.152,7 % | leer | 6.144 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |
| CHA (Chagee Holdings Limited) | consumer-discretionary, profitabel | Bruttogewinn | +4,1 % | leer | 6.317 | Zwischen den beiden Werten fehlt der Wert eines Geschäftsjahres |

## Die 12 Firmen mit abweichenden Jahresenden

| Firma | Reiter | Spalte | Vorher | Nachher | Platz in der Übersicht (vorher und nachher) | Grund |
|---|---|---|---|---|---|---|
| PGHL.NS (Procter & Gamble Health Limited) | health-care, profitabel | Bruttogewinn | +28,2 % | leer | 383 | Die Jahresenden liegen 639 Tage auseinander (erlaubt sind 334 bis 397) |
| TIC (TIC Solutions, Inc.) | industrials, unprofitabel | Bruttogewinn | +87,6 % | leer | 772 | Die Jahresenden liegen 731 Tage auseinander (erlaubt sind 334 bis 397) |
| MIN.AX (Mineral Resources Limited) | materials, profitabel | Bruttogewinn | +40,3 % | leer | 961 | Die Jahresenden liegen 730 Tage auseinander (erlaubt sind 334 bis 397) |
| OBM.AX (Ora Banda Mining Limited) | materials, profitabel | Bruttogewinn | +813,4 % | leer | 1.359 | Die Jahresenden liegen 730 Tage auseinander (erlaubt sind 334 bis 397) |
| CMM.AX (Capricorn Metals Ltd) | materials, profitabel | Bruttogewinn | +122,8 % | leer | 1.469 | Die Jahresenden liegen 730 Tage auseinander (erlaubt sind 334 bis 397) |
| 3391.T (Tsuruha Holdings Inc.) | health-care, profitabel | Bruttogewinn | +42,2 % | leer | 2.736 | Die Jahresenden liegen 638 Tage auseinander (erlaubt sind 334 bis 397) |
| BXB.AX (Brambles Limited) | industrials, profitabel | Bruttogewinn | +7,6 % | leer | 4.025 | Die Jahresenden liegen 730 Tage auseinander (erlaubt sind 334 bis 397) |
| PGHH.BO (Procter & Gamble Hygiene and Health Care Limited) | consumer-staples, profitabel | Bruttogewinn | +7,1 % | leer | 4.282 | Die Jahresenden liegen 639 Tage auseinander (erlaubt sind 334 bis 397) |
| 330590.KS (LOTTE REIT Co., Ltd.) | real-estate, profitabel | Mittelzufluss aus dem Betrieb, Näherung (Immobilienfirmen) | +7,9 % | leer | 5.689 | Die Jahresenden liegen 184 Tage auseinander (erlaubt sind 334 bis 397) |
| SPHR (Sphere Entertainment Co.) | software-comm-services, profitabel | Bruttogewinn | +31,5 % | leer | 5.983 | Die Jahresenden liegen 549 Tage auseinander (erlaubt sind 334 bis 397) |
| 8961.T (MORI TRUST REIT, Inc.) | real-estate, profitabel | Mittelzufluss aus dem Betrieb, Näherung (Immobilienfirmen) | +62,6 % | leer | 7.060 | Die Jahresenden liegen 517 Tage auseinander (erlaubt sind 334 bis 397) |
| NTDU.SI (NTT DC REIT) | real-estate, profitabel | Mittelzufluss aus dem Betrieb, Näherung (Immobilienfirmen) | +38,9 % | leer | 7.937 | Die Jahresenden liegen 730 Tage auseinander (erlaubt sind 334 bis 397) |

## Abgleich mit der Zählung der Prüfung V-DL3

Die Prüfung nannte 16 Firmen (12 über den Bruttogewinn, 4 über den Umsatz). Das waren 13 verschiedene Firmen, weil 7827.TW, 9887.HK und KRT.BO in beiden Zählungen standen; sie rechnete außerdem auf den Rohsnapshots statt auf den aufbereiteten. In der Übersicht stehen davon 10: CRNLF und REDLF gehören nicht zur Übersichtsliste, INA.AX hatte schon vorher keinen Wert. Hinzu kommen P40U.SI (Immobilienfirma mit fehlendem Jahr) und die 12 Firmen mit abweichenden Jahresenden. Zusammen sind es 23.

## Offen

- Entscheiden, ob die 12 Firmen mit abweichenden Jahresenden bleiben dürfen. Ein Beispiel ist 330590.KS mit 184 Tagen Abstand, dort ist der deutsche Grundtext „Jahre liegen nicht hintereinander" ungenau, weil es sich um einen Kurzzeitraum handelt. Der Text wird nicht angezeigt.
- Die Begründung im Export sichtbar machen (score.js und Exportvertrag, getrenntes Paket).
- Das Ergebnis gilt für die Snapshots vom 07.10.2026; bei späteren Datenständen können weitere Firmen hinzukommen oder wegfallen.
