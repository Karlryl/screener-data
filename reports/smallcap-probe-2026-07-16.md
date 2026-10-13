# Small-Cap-Daten-Coverage-Probe (2026-07-16)

Reine Messung: Zahlen, Felddefinitionen und Fehllisten. Der Bericht enthaelt keine GO/NO-GO-Empfehlung und keine Schwellen-Interpretation.

## Stichproben-Definition

- Datum: 2026-07-16
- Seed: `smallcap-probe-2026-07-16-v1`
- Ticker-Basis: lokaler Read-only-SEC-Pipeline-Fallback nach Fehler bei company_tickers.json (9863 Eintraege)
- Auswahlregel: SEC-Basis ticker/CIK aufsteigend sortieren; FNV-1a-Rang ueber Seed+Ticker+CIK; nach Rang aufsteigend scannen; Yahoo trailingMarketCap im Band; dann Yahoo chart.meta = USD-EQUITY in America/New_York; erste N Treffer.
- Marktkapitalisierungsband: USD 300-800 Mio. (Yahoo trailingMarketCap, inklusive Grenzen)
- Stichprobe: 100 Firmen; 1066 Kandidaten der Seed-Reihenfolge bis zum Erreichen von N geprueft
- US-Abgrenzung: SEC-registrierter Ticker plus bei Yahoo als USD-EQUITY mit Exchange-Zeitzone America/New_York gefuehrt; Sitzland/Domizil wird mangels Feld in company_tickers.json nicht behauptet.
- Drosselung: SEC 175 ms Mindestabstand; Yahoo 300 ms Mindestabstand

- Fehler beim Live-Abruf der SEC-Basis: HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"

## Coverage je Achse

| Achse | Yahoo-only | XBRL-only | beide | keins |
|---|---:|---:|---:|---:|
| revGrowthLevel | 79.0 % (79/100) | 0.0 % (0/100) | 1.0 % (1/100) | 20.0 % (20/100) |
| revAcceleration | 60.0 % (60/100) | 0.0 % (0/100) | 1.0 % (1/100) | 39.0 % (39/100) |
| gpGrowth | 55.0 % (55/100) | 0.0 % (0/100) | 1.0 % (1/100) | 44.0 % (44/100) |
| ruleOfX | 79.0 % (79/100) | 0.0 % (0/100) | 1.0 % (1/100) | 20.0 % (20/100) |
| marginTrajectory | 54.0 % (54/100) | 0.0 % (0/100) | 1.0 % (1/100) | 45.0 % (45/100) |
| capitalEfficiency | 73.0 % (73/100) | 0.0 % (0/100) | 1.0 % (1/100) | 26.0 % (26/100) |
| revisionsMomentum | 0.0 % (0/100) | 0.0 % (0/100) | 0.0 % (0/100) | 100.0 % (100/100) |
| dilution | 59.0 % (59/100) | 0.0 % (0/100) | 1.0 % (1/100) | 40.0 % (40/100) |

## Felder je Achse

| Achse | Mindestfelder fuer die Coverage-Zaehlung | Zusaetzliche/bedingte Rohfelder | Quellen-Mapping |
|---|---|---|---|
| revGrowthLevel | quartalsweiser Umsatz >=5 ODER jaehrlicher Umsatz >=2 | keine | quarterlyRevenue: Yahoo [quarterlyTotalRevenue]; XBRL [RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet]; annualRevenue: Yahoo [annualTotalRevenue]; XBRL [RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet] |
| revAcceleration | quartalsweiser Umsatz mit >=2 positiven QoQ-Paaren (mind. 3 Werte) | keine | quarterlyRevenue: Yahoo [quarterlyTotalRevenue]; XBRL [RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet] |
| gpGrowth | jaehrlicher Bruttogewinn >=2; aelterer Wert >0 | jaehrlicher Umsatz fuer den GM-Trajektorie-Tilt | annualGrossProfit: Yahoo [annualGrossProfit]; XBRL [GrossProfit]; annualRevenue: Yahoo [annualTotalRevenue]; XBRL [RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet] |
| ruleOfX | derselbe Umsatz-Wachstumspfad wie revGrowthLevel | FCF-Marge TTM sowie jaehrlicher FCF/OCF als Vorzeichen-Guard; im Unprofit-Track deaktiviert | quarterlyRevenue: Yahoo [quarterlyTotalRevenue]; XBRL [RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet]; annualRevenue: Yahoo [annualTotalRevenue]; XBRL [RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet]; fcfMarginTTM: Yahoo [trailingFreeCashFlow / trailingTotalRevenue]; XBRL [nicht als eigener TTM-Fakt; Jahres-FCF/Jahresumsatz nur Guard-Hilfe]; annualFCF: Yahoo [annualFreeCashFlow]; XBRL [abgeleitet: OCF minus Capex]; annualOCF: Yahoo [annualOperatingCashFlow]; XBRL [NetCashProvidedByUsedInOperatingActivities, NetCashProvidedByUsedInOperatingActivitiesContinuingOperations] |
| marginTrajectory | >=2 zeitgleiche Quartale mit Umsatz >0 und operativem Ergebnis | keine | quarterlyRevenue: Yahoo [quarterlyTotalRevenue]; XBRL [RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet]; quarterlyOperatingIncome: Yahoo [quarterlyOperatingIncome]; XBRL [OperatingIncomeLoss] |
| capitalEfficiency | >=1 zeitgleiches Jahr: operatives Ergebnis, Bilanzsumme, kurzfristige Verbindlichkeiten; investiertes Kapital >0 | >=2 Bilanzsummen und Umsaetze fuer Asset-Growth-Penalty; >=3 OpMargin-Jahre fuer Zyklus-Discount | annualOperatingIncome: Yahoo [annualOperatingIncome]; XBRL [OperatingIncomeLoss]; annualAssets: Yahoo [annualTotalAssets]; XBRL [Assets]; annualCurrentLiabilities: Yahoo [annualCurrentLiabilities]; XBRL [LiabilitiesCurrent]; annualRevenue: Yahoo [annualTotalRevenue]; XBRL [RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet] |
| revisionsMomentum | >=1 Up/Down-Paar fuer 0y/+1y und 30/90 Tage mit Summe >0 | keine | estimateRevisions: Yahoo [earningsTrend.epsRevisions]; XBRL [kein SEC-XBRL-Konzept] |
| dilution | >=1 zeitgleiches Jahr mit SBC und Umsatz !=0 | zweites Jahr fuer den SBC/Umsatz-Trend | annualSBC: Yahoo [annualStockBasedCompensation]; XBRL [ShareBasedCompensation]; annualRevenue: Yahoo [annualTotalRevenue]; XBRL [RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet] |

## 10 haeufigste fehlende Felder

Gezählt wird Feldabwesenheit (keine gelieferte Beobachtung) je Quelle und Firma; Abruffehler bleiben zusaetzlich in der Fehlerliste sichtbar.

| Rang | Quelle | Rohfeld | Fehlend | Ticker (max. 20) |
|---:|---|---|---:|---|
| 1 | xbrl | Free Cashflow, jaehrlich (`annualFCF`) | 100.0 % (100/100) | HELP, RZLT, NRDS, BLW, GDYN, SHIP, SG, RAAQ, CVGW, SPIR, BUI, TITN, ONT, AXG, ROMA, RNGR, VHI, MYGN, IMXI, DSAC, ... (+80) |
| 2 | xbrl | Analystenrevisionen 0y/+1y, 30/90 Tage (`estimateRevisions`) | 100.0 % (100/100) | HELP, RZLT, NRDS, BLW, GDYN, SHIP, SG, RAAQ, CVGW, SPIR, BUI, TITN, ONT, AXG, ROMA, RNGR, VHI, MYGN, IMXI, DSAC, ... (+80) |
| 3 | xbrl | FCF-Marge, TTM (`fcfMarginTTM`) | 100.0 % (100/100) | HELP, RZLT, NRDS, BLW, GDYN, SHIP, SG, RAAQ, CVGW, SPIR, BUI, TITN, ONT, AXG, ROMA, RNGR, VHI, MYGN, IMXI, DSAC, ... (+80) |
| 4 | yahoo | Analystenrevisionen 0y/+1y, 30/90 Tage (`estimateRevisions`) | 100.0 % (100/100) | HELP, RZLT, NRDS, BLW, GDYN, SHIP, SG, RAAQ, CVGW, SPIR, BUI, TITN, ONT, AXG, ROMA, RNGR, VHI, MYGN, IMXI, DSAC, ... (+80) |
| 5 | xbrl | Bilanzsumme, jaehrlich (`annualAssets`) | 99.0 % (99/100) | HELP, RZLT, NRDS, BLW, GDYN, SHIP, SG, RAAQ, CVGW, SPIR, BUI, TITN, ONT, AXG, ROMA, RNGR, VHI, MYGN, IMXI, DSAC, ... (+79) |
| 6 | xbrl | Kurzfristige Verbindlichkeiten, jaehrlich (`annualCurrentLiabilities`) | 99.0 % (99/100) | HELP, RZLT, NRDS, BLW, GDYN, SHIP, SG, RAAQ, CVGW, SPIR, BUI, TITN, ONT, AXG, ROMA, RNGR, VHI, MYGN, IMXI, DSAC, ... (+79) |
| 7 | xbrl | Bruttogewinn, jaehrlich (`annualGrossProfit`) | 99.0 % (99/100) | HELP, RZLT, NRDS, BLW, GDYN, SHIP, SG, RAAQ, CVGW, SPIR, BUI, TITN, ONT, AXG, ROMA, RNGR, VHI, MYGN, IMXI, DSAC, ... (+79) |
| 8 | xbrl | Operativer Cashflow, jaehrlich (`annualOCF`) | 99.0 % (99/100) | HELP, RZLT, NRDS, BLW, GDYN, SHIP, SG, RAAQ, CVGW, SPIR, BUI, TITN, ONT, AXG, ROMA, RNGR, VHI, MYGN, IMXI, DSAC, ... (+79) |
| 9 | xbrl | Operatives Ergebnis, jaehrlich (`annualOperatingIncome`) | 99.0 % (99/100) | HELP, RZLT, NRDS, BLW, GDYN, SHIP, SG, RAAQ, CVGW, SPIR, BUI, TITN, ONT, AXG, ROMA, RNGR, VHI, MYGN, IMXI, DSAC, ... (+79) |
| 10 | xbrl | Umsatz, jaehrlich (`annualRevenue`) | 99.0 % (99/100) | HELP, RZLT, NRDS, BLW, GDYN, SHIP, SG, RAAQ, CVGW, SPIR, BUI, TITN, ONT, AXG, ROMA, RNGR, VHI, MYGN, IMXI, DSAC, ... (+79) |

## Quellenabrufe und Firmenliste

- Yahoo-Fundamentals-Abruffehler: 0/100
- Yahoo-earningsTrend-Zugriff: nicht verfuegbar (HTTP 401 {"finance":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}})
- SEC-companyfacts live: 0/100
- SEC lokaler companyfacts-Cache nach Live-Fehler: 1/100
- SEC lokaler secannual-Extrakt nach Live-Fehler: 0/100
- SEC ohne Rohdaten nach Live-Fehler: 99/100

| Ticker | MCap USD Mio. | Boerse | Yahoo-Fehler | SEC-Modus | SEC-Live-Fehler |
|---|---:|---|---|---|---|
| HELP | 400.4 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| RZLT | 455.5 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| NRDS | 627.1 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| BLW | 496.0 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| GDYN | 481.7 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| SHIP | 330.2 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| SG | 798.5 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| RAAQ | 308.7 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| CVGW | 466.3 | NMS | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| SPIR | 527.6 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| BUI | 751.7 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| TITN | 443.2 | NMS | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ONT | 742.7 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| AXG | 617.1 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ROMA | 594.8 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| RNGR | 385.2 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| VHI | 392.8 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| MYGN | 596.0 | NMS | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| IMXI | 411.1 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| DSAC | 345.6 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| BBOT | 674.1 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| CWBC | 736.7 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| RFI | 304.1 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| RIV | 315.3 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| UHT | 592.1 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ALCO | 302.3 | NMS | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| DIN | 447.7 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| OOMA | 556.4 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| FOF | 380.8 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| SVA | 460.2 | NMS | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| THM | 558.4 | ASE | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| SAC | 316.2 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| BHB | 634.7 | ASE | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| PRE | 332.9 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| PAXS | 684.7 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| HELE | 653.6 | NMS | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| IMMX | 748.9 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| MBUU | 549.6 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ETD | 582.5 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| UWMC | 688.6 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| EFR | 312.4 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| TRON | 683.1 | NCM | - | local-companyfacts-cache | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| BGR | 405.8 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ASPN | 439.3 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| DSM | 300.0 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| HYLN | 704.4 | ASE | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| HLLY | 309.4 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| MTW | 465.0 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| JACS | 317.8 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| SI | 452.5 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| NEWT | 438.9 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| VMD | 457.0 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| NBB | 456.2 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| MVST | 327.9 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| CNNE | 667.5 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ACAT | 772.1 | OID | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| HSHP | 703.0 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| BOC | 427.2 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| DVLT | 331.6 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| CLMB | 465.3 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| AENT | 303.3 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| SLI | 551.4 | ASE | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| WDH | 416.8 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| GMRS | 756.2 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| PLTS | 316.0 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| GAU | 474.7 | ASE | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| IIM | 605.7 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| HPS | 461.6 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| FDBC | 302.3 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| KRAQ | 432.1 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| CMTG | 332.3 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| TECX | 613.2 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| CXII | 594.4 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| RYAM | 517.3 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| NWAX | 505.0 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| COFS | 500.9 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| DGXX | 358.0 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| RREV | 329.7 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| OMER | 749.8 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| DFPH | 435.7 | PNK | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ZURA | 511.6 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| SPRY | 749.7 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ZUMZ | 315.7 | NMS | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ILPT | 591.3 | NMS | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| CCIX | 397.8 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| SNDL | 337.1 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| FFC | 783.4 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| BBNX | 751.3 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| KOPN | 787.5 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| TASK | 547.2 | NMS | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| NGS | 529.3 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ELVA | 572.9 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| GPRK | 639.9 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| ACGP | 702.1 | OQX | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| LXFR | 465.9 | NYQ | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| API | 341.6 | NMS | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| HDL | 761.6 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| MAKO | 627.9 | NCM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| PTCHF | 399.1 | PNK | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |
| XRPN | 329.6 | NGM | - | unavailable | HTTP 403 <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" |

## Messannahmen

- Achsenliste ist exakt die acht in src/scoring/axes.js benannten Funktionen: revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution.
- Achsen-Coverage folgt der minimalen Nicht-null-Semantik der Funktion in axes.js. Optionale Tilts/Guards werden als Felder ausgewiesen, bestimmen aber nicht die Kern-Coverage.
- revGrowthLevel und ruleOfX gelten als lieferbar bei >=5 Quartalsumsaetzen (Lag 4) oder >=2 Jahresumsaetzen mit positivem aelterem Wert.
- revAcceleration gilt als lieferbar bei mindestens drei positiven Quartalsumsaetzen; das bildet mindestens zwei positive QoQ-Paare wie quarterQoQRates.
- gpGrowth verlangt fuer den Rueckgabewert zwei Jahres-Bruttogewinne und einen positiven aelteren Wert; Jahresumsatz fuer die GM-Trajektorie ist optional und separat gemessen.
- ruleOfX verlangt fuer den Rueckgabewert nur den Umsatz-Wachstumspfad. FCF-Marge und annualFCF/annualOCF sind bedingt (Profitable-Track/Sign-Guard) und separat gemessen.
- marginTrajectory verlangt zwei nach Periodenende gepaarte Quartale mit Umsatz >0 und operativem Ergebnis.
- capitalEfficiency verlangt mindestens ein nach Periodenende gepaartes Jahr aus Operating Income, Assets und Current Liabilities mit positivem investiertem Kapital; Asset-Growth-Penalty und Zyklus-Discount sind optionale Komponenten.
- revisionsMomentum nutzt Yahoo earningsTrend.epsRevisions. SEC-XBRL enthaelt keine Analystenrevisionen; XBRL-Coverage dieser Achse ist daher per Quellenvertrag null.
- dilution verlangt mindestens ein nach Periodenende gepaartes Jahr aus ShareBasedCompensation und Umsatz ungleich null; ein zweites Jahr fuegt nur den Trend hinzu.
- SEC-Umsatz akzeptiert vier uebliche us-gaap-Tags in dokumentierter Prioritaet; gleiche Perioden werden nicht addiert. Q4-Flows werden nur als FY minus passendem 9M-YTD-Fakt abgeleitet.
- Yahoo-Fundamentals werden aus dem keylosen Fundamentals-Time-Series-Endpunkt gelesen. Der separate quoteSummary-earningsTrend-Endpunkt wird einmal auf Zugriff faehigkeit geprueft und bei globalem Auth-Fehler fuer den Lauf als nicht verfuegbar markiert.
- Wenn der vorgeschriebene kontaktfreie SEC-User-Agent vom SEC-WAF abgewiesen wird, werden vorhandene, von der Repo-SEC-Pipeline erzeugte Rohcaches nur lesend verwendet; Modus und Live-Fehler stehen je Firma im Report. Nicht gecachte Firmen bleiben XBRL-seitig leer.
