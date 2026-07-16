# Small-Cap-Coverage-Probe - Messlauf 2b XBRL (2026-07-16)

Reine SEC/XBRL-Messung mit Zahlen, Tabellen und Fehlgruenden.

## Stichprobe und Messdefinition

- Bindende Stichprobe: 100 Operating Companies aus `reports/smallcap-probe-messlauf2-2026-07-16.json`; keine neue Ziehung.
- Yahoo-Coverage und Yahoo-Firmenwerte wurden ausschliesslich aus dieser JSON-Datei gelesen; im XBRL-Modus gab es keine Yahoo-Requests.
- Die acht Achsen, us-gaap-Konzepte und Coverage-Praedikate stammen unveraendert aus dem bestehenden XBRL-Codepfad dieses Skripts.

## CIK-Mapping-Bilanz

| Kennzahl | Anzahl |
|---|---:|
| Ticker gesamt | 100 |
| Mit CIK | 100 |
| Ohne CIK | 0 |

### Ticker ohne CIK

| Ticker | Name |
|---|---|
| - | Keine |

## XBRL-Coverage je Achse

Der erste Nenner ist immer 100; ein fehlender CIK oder fehlgeschlagener companyfacts-Abruf zaehlt als nicht abgedeckt. Der zweite Nenner umfasst nur Firmen mit CIK.

| Achse | XBRL / 100 | XBRL / nur CIK vorhanden |
|---|---:|---:|
| revGrowthLevel | 89.0 % (89/100) | 89.0 % (89/100) |
| revAcceleration | 87.0 % (87/100) | 87.0 % (87/100) |
| gpGrowth | 42.0 % (42/100) | 42.0 % (42/100) |
| ruleOfX | 89.0 % (89/100) | 89.0 % (89/100) |
| marginTrajectory | 76.0 % (76/100) | 76.0 % (76/100) |
| capitalEfficiency | 75.0 % (75/100) | 75.0 % (75/100) |
| revisionsMomentum | 0.0 % (0/100) | 0.0 % (0/100) |
| dilution | 84.0 % (84/100) | 84.0 % (84/100) |

## Vergleich Yahoo und XBRL

Alle vier Spalten verwenden den Nenner 100. Yahoo und XBRL sind jeweilige Quellen-Coverage; beide und keine sind deren Schnittmenge beziehungsweise gemeinsame Abwesenheit.

| Achse | Yahoo | XBRL | beide | keine |
|---|---:|---:|---:|---:|
| revGrowthLevel | 97.0 % (97/100) | 89.0 % (89/100) | 86.0 % (86/100) | 0.0 % (0/100) |
| revAcceleration | 98.0 % (98/100) | 87.0 % (87/100) | 86.0 % (86/100) | 1.0 % (1/100) |
| gpGrowth | 74.0 % (74/100) | 42.0 % (42/100) | 41.0 % (41/100) | 25.0 % (25/100) |
| ruleOfX | 97.0 % (97/100) | 89.0 % (89/100) | 86.0 % (86/100) | 0.0 % (0/100) |
| marginTrajectory | 87.0 % (87/100) | 76.0 % (76/100) | 74.0 % (74/100) | 11.0 % (11/100) |
| capitalEfficiency | 89.0 % (89/100) | 75.0 % (75/100) | 75.0 % (75/100) | 11.0 % (11/100) |
| revisionsMomentum | 85.0 % (85/100) | 0.0 % (0/100) | 0.0 % (0/100) | 15.0 % (15/100) |
| dilution | 98.0 % (98/100) | 84.0 % (84/100) | 83.0 % (83/100) | 1.0 % (1/100) |

## Achse-Konzept-Zuordnung

| Achse | Mindestfelder fuer Coverage | XBRL-Konzepte |
|---|---|---|
| revGrowthLevel | quartalsweiser Umsatz >=5 ODER jaehrlicher Umsatz >=2 | quarterlyRevenue: RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet; annualRevenue: RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet |
| revAcceleration | quartalsweiser Umsatz mit >=2 positiven QoQ-Paaren (mind. 3 Werte) | quarterlyRevenue: RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet |
| gpGrowth | jaehrlicher Bruttogewinn >=2; aelterer Wert >0 | annualGrossProfit: GrossProfit; annualRevenue: RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet |
| ruleOfX | derselbe Umsatz-Wachstumspfad wie revGrowthLevel | quarterlyRevenue: RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet; annualRevenue: RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet; fcfMarginTTM: nicht als eigener TTM-Fakt; Jahres-FCF/Jahresumsatz nur Guard-Hilfe; annualFCF: abgeleitet: OCF minus Capex; annualOCF: NetCashProvidedByUsedInOperatingActivities, NetCashProvidedByUsedInOperatingActivitiesContinuingOperations |
| marginTrajectory | >=2 zeitgleiche Quartale mit Umsatz >0 und operativem Ergebnis | quarterlyRevenue: RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet; quarterlyOperatingIncome: OperatingIncomeLoss |
| capitalEfficiency | >=1 zeitgleiches Jahr: operatives Ergebnis, Bilanzsumme, kurzfristige Verbindlichkeiten; investiertes Kapital >0 | annualOperatingIncome: OperatingIncomeLoss; annualAssets: Assets; annualCurrentLiabilities: LiabilitiesCurrent; annualRevenue: RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet |
| revisionsMomentum | >=1 Up/Down-Paar fuer 0y/+1y und 30/90 Tage mit Summe >0 | estimateRevisions: kein SEC-XBRL-Konzept |
| dilution | >=1 zeitgleiches Jahr mit SBC und Umsatz !=0 | annualSBC: ShareBasedCompensation; annualRevenue: RevenueFromContractWithCustomerExcludingAssessedTax, RevenueFromContractWithCustomerIncludingAssessedTax, Revenues, SalesRevenueNet |

## Abrufstatistik

- Requests gesamt: 101 (company_tickers: 1; companyfacts: 100).
- companyfacts erfolgreich: 100; fehlgeschlagen: 0; wegen fehlendem CIK nicht angefragt: 0.
- Laufzeit: 27.2 Sekunden.
- SEC-Drosselung: mindestens 175 ms zwischen Requests.
- Der SEC-User-Agent kam zur Laufzeit aus `process.env.SEC_CONTACT`; sein Wert wurde nicht protokolliert.

| Fehler-Typ | Anzahl |
|---|---:|
| keine | 0 |

## Firmen-Rohbilanz

| Ticker | Name | CIK | Abruf | Abgedeckte XBRL-Achsen | Nicht abgedeckte XBRL-Achsen |
|---|---|---|---|---|---|
| RYAM | Rayonier Advanced Materials Inc. | 0001597672 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| KOPN | Kopin Corporation | 0000771266 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| GLRE | Greenlight Capital Re, Ltd. | 0001385613 | ok | revGrowthLevel, revAcceleration, ruleOfX, dilution | gpGrowth, marginTrajectory, capitalEfficiency, revisionsMomentum |
| SGU | Star Group, L.P. | 0001002590 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency | revisionsMomentum, dilution |
| HZO | MarineMax, Inc. | 0001057060 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| TASK | TaskUs, Inc. | 0001829864 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| MNRO | Monro, Inc. | 0000876427 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| CASS | Cass Information Systems, Inc. | 0000708781 | ok | revGrowthLevel, revAcceleration, ruleOfX, dilution | gpGrowth, marginTrajectory, capitalEfficiency, revisionsMomentum |
| SMWB | Similarweb Ltd. | 0001842731 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| CTKB | Cytek Biosciences, Inc. | 0001831915 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| FIP | FTAI Infrastructure Inc. | 0001899883 | ok | revGrowthLevel, revAcceleration, ruleOfX | gpGrowth, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| AQST | Aquestive Therapeutics, Inc. | 0001398733 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| ALT | Altimmune, Inc. | 0001326190 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| TLRY | Tilray Brands, Inc. | 0001731348 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| UMAC | Unusual Machines, Inc. | 0001956955 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| CWH | Camping World Holdings, Inc. | 0001669779 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| CCRN | Cross Country Healthcare, Inc. | 0001141103 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| OFIX | Orthofix Medical Inc. | 0000884624 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| ITIC | Investors Title Company | 0000720858 | ok | revGrowthLevel, revAcceleration, ruleOfX, dilution | gpGrowth, marginTrajectory, capitalEfficiency, revisionsMomentum |
| PFIS | Peoples Financial Services Corp. | 0001056943 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| MYGN | Myriad Genetics, Inc. | 0000899923 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| VTS | Vitesse Energy, Inc. | 0001944558 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| PACB | Pacific Biosciences of California, Inc. | 0001299130 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| XRX | Xerox Holdings Corporation | 0001770450 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, dilution | marginTrajectory, capitalEfficiency, revisionsMomentum |
| MLAB | Mesa Laboratories, Inc. | 0000724004 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| ORN | Orion Group Holdings, Inc. | 0001402829 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| CCCC | C4 Therapeutics, Inc. | 0001662579 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| VEL | Velocity Financial, Inc. | 0001692376 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| PACK | Ranpak Holdings Corp. | 0001712463 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency | revisionsMomentum, dilution |
| SHBI | Shore Bancshares, Inc. | 0001035092 | ok | revGrowthLevel, revAcceleration, ruleOfX, dilution | gpGrowth, marginTrajectory, capitalEfficiency, revisionsMomentum |
| AMCX | AMC Global Media Inc. | 0001514991 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| OSS | One Stop Systems, Inc. | 0001394056 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| ONT | Onterris, Inc. | 0001643615 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| BKSY | BlackSky Technology Inc. | 0001753539 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| SHEN | Shenandoah Telecommunications Company | 0000354963 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| CCOI | Cogent Communications Holdings, Inc. | 0001158324 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| ASPI | ASP Isotopes Inc. | 0001921865 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| KELYA | Kelly Services, Inc. | 0000055135 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| RBB | RBB Bancorp | 0001499422 | ok | revGrowthLevel, revAcceleration, ruleOfX, dilution | gpGrowth, marginTrajectory, capitalEfficiency, revisionsMomentum |
| HBB | Hamilton Beach Brands Holding Company | 0001709164 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| EVGO | EVgo, Inc. | 0001821159 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| EVMN | Evommune, Inc. | 0002044725 | ok | revGrowthLevel, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revAcceleration, gpGrowth, revisionsMomentum |
| FVR | FrontView REIT, Inc. | 0001988494 | ok | revGrowthLevel, revAcceleration, ruleOfX, dilution | gpGrowth, marginTrajectory, capitalEfficiency, revisionsMomentum |
| VALN | Valneva SE | 0001836564 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| SWBI | Smith & Wesson Brands, Inc. | 0001092796 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| PSFE | Paysafe Limited | 0001833835 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| HIVE | HIVE Digital Technologies Ltd. | 0001720424 | ok | revGrowthLevel, ruleOfX, dilution | revAcceleration, gpGrowth, marginTrajectory, capitalEfficiency, revisionsMomentum |
| TWI | Titan International, Inc. | 0000899751 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| BXC | BlueLinx Holdings Inc. | 0001301787 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| BGS | B&G Foods, Inc. | 0001278027 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| HTT | High Templar Tech Limited | 0001692705 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| TWIN | Twin Disc, Incorporated | 0000100378 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency | revisionsMomentum, dilution |
| ABAT | American Battery Technology Company | 0001576873 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| NUAI | New Era Energy & Digital, Inc. | 0002028336 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| PKE | Park Aerospace Corp. | 0000076267 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| NRGV | Energy Vault Holdings, Inc. | 0001828536 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| PTLO | Portillo's Inc. | 0001871509 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| PAR | PAR Technology Corporation | 0000708821 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| ABEO | Abeona Therapeutics Inc. | 0000318306 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| HTZ | Hertz Global Holdings, Inc. | 0001657853 | ok | revGrowthLevel, revAcceleration, ruleOfX, dilution | gpGrowth, marginTrajectory, capitalEfficiency, revisionsMomentum |
| WTI | W&T Offshore, Inc. | 0001288403 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| BETR | Better Home & Finance Holding Company | 0001835856 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| DDL | Dingdong (Cayman) Limited | 0001854545 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| BBW | Build-A-Bear Workshop, Inc. | 0001113809 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, dilution | marginTrajectory, capitalEfficiency, revisionsMomentum |
| FNLC | The First Bancorp, Inc. | 0000765207 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| RGNX | REGENXBIO Inc. | 0001590877 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| MAX | MediaAlpha, Inc. | 0001818383 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| BWMX | Betterware de México, S.A.P.I. de C.V. | 0001788257 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| OPTU | Optimum Communications, Inc. | 0001702780 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| DDD | 3D Systems Corporation | 0000910638 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| RIGL | Rigel Pharmaceuticals, Inc. | 0001034842 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| KE | Kimball Electronics, Inc. | 0001606757 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| NRIM | Northrim BanCorp, Inc. | 0001163370 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, dilution | marginTrajectory, capitalEfficiency, revisionsMomentum |
| UAMY | United States Antimony Corporation | 0000101538 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| AROW | Arrow Financial Corporation | 0000717538 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| FNKO | Funko, Inc. | 0001704711 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| CLPT | ClearPoint Neuro, Inc. | 0001285550 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| SG | Sweetgreen, Inc. | 0001477815 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| ONIT | Onity Group Inc. | 0000873860 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, dilution | gpGrowth, capitalEfficiency, revisionsMomentum |
| XPER | Xperi Inc. | 0001788999 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| CNNE | Cannae Holdings, Inc. | 0001704720 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| OCGN | Ocugen, Inc. | 0001372299 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency | gpGrowth, revisionsMomentum, dilution |
| VREX | Varex Imaging Corporation | 0001681622 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| SIBN | SI-BONE, Inc. | 0001459839 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| KRUS | Kura Sushi USA, Inc. | 0001772177 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| PCB | PCB Bancorp | 0001423869 | ok | revGrowthLevel, revAcceleration, ruleOfX, dilution | gpGrowth, marginTrajectory, capitalEfficiency, revisionsMomentum |
| CLFD | Clearfield, Inc. | 0000796505 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| ZUMZ | Zumiez Inc. | 0001318008 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| OEC | Orion S.A. | 0001609804 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| HSHP | Himalaya Shipping Ltd. | 0001959455 | ok | - | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution |
| EFOR | Everforth, Inc. | 0000890564 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| XPOF | Xponential Fitness, Inc. | 0001802156 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| OMER | Omeros Corporation | 0001285819 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| FUBO | FuboTV Inc. | 0001484769 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| OXM | Oxford Industries, Inc. | 0000075288 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| SERV | Serve Robotics Inc. | 0001832483 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| ARVN | Arvinas, Inc. | 0001655759 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| VELO | Velo3D, Inc. | 0001825079 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
| GCO | Genesco Inc. | 0000018498 | ok | revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution | revisionsMomentum |
| SPRY | ARS Pharmaceuticals, Inc. | 0001671858 | ok | revGrowthLevel, revAcceleration, ruleOfX, marginTrajectory, capitalEfficiency, dilution | gpGrowth, revisionsMomentum |
