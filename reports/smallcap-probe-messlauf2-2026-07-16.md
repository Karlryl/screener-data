# Small-Cap-Coverage-Probe - Messlauf 2 (2026-07-16)

Reine Messung mit Zahlen, Ausschlussgruenden und Rohfeldern. Der Bericht enthaelt keine Schlussfolgerung oder Empfehlung.

## Stichproben-Definition

- Finale Stichprobe: 100 Operating Companies mit Yahoo-Market-Cap von USD 300-800 Mio. (inklusive Grenzen).
- Seed: `smallcap-probe-2026-07-16-messlauf2`.
- Kandidatenbasis: Yahoo predefined screener pages, dedupliziert und per FNV-1a-Seed gerankt; 218 eindeutige Ticker im Band.
- Ziehung: Kandidaten werden nach Seed-Rang einzeln geprueft; beim ersten Treffer R1-R6 verworfen und sofort nachgezogen, bis das finale N erreicht ist.
- Yahoo-Drosselung: mindestens 300 ms zwischen ausgegebenen Requests; quoteSummary-Cookie/Crumb via yahoo-finance2 wie in pull-yahoo.js.
- SEC/EDGAR: in Messlauf 2 nicht aufgerufen.

| Yahoo-Screener | Start | Geliefert | Im MCap-Band |
|---|---:|---:|---:|
| aggressive_small_caps | 0 | 250 | 75 |
| aggressive_small_caps | 250 | 238 | 54 |
| small_cap_gainers | 0 | 64 | 19 |
| most_shorted_stocks | 0 | 250 | 54 |
| most_shorted_stocks | 250 | 250 | 36 |
| undervalued_growth_stocks | 0 | 208 | 36 |

## Filter-Definition R1-R6

| Regel | Definition | Fehlende Felder |
|---|---|---|
| R1 | quoteType (hart): behalten nur wenn quoteType == "EQUITY"; ETF/MUTUALFUND/CLOSEDEND/INDEX/CURRENCY/CRYPTOCURRENCY/TRUST werden ausgeschlossen. | fail-closed |
| R2 | Ticker-Struktur (hart): Endung .U, .WS, -WT oder -U sowie positiver Warrant/Unit-Marker werden ausgeschlossen. | fail-open |
| R3 | Sektor/Industry (hart): Financial Services zusammen mit Shell Companies, Asset Management, Closed-End Fund* oder Exchange Traded Fund wird ausgeschlossen. | fail-closed |
| R4 | Name (hart): /\b(Acquisition Corp\|Blank Check\|SPAC)\b/i auf longName+shortName wird ausgeschlossen. | fail-open |
| R5 | Struktur-Gate: behalten nur wenn fullTimeEmployees > 1 UND totalRevenue (TTM) > 0. | fail-closed |
| R6 | Name (weich): /\b(Trust\|Fund\|Royalty)\b/i wird nur bei nicht klar bestandenem R5 ausgeschlossen; bei bestandenem R5 bleibt der Name und kommt ins Grenzfall-Log. | fail-open |

Erster Treffer entscheidet. Daher werden nicht klar bestandene Strukturfaelle bereits unter R5 gezaehlt; ein R6-Namensmatch nach bestandenem R5 wird behalten und unten protokolliert.

## Ziehungs-Bilanz

| Kennzahl | Anzahl |
|---|---:|
| Gezogen gesamt | 132 |
| Ausgeschlossen R1 | 0 |
| Ausgeschlossen R2 | 0 |
| Ausgeschlossen R3 | 19 |
| Ausgeschlossen R4 | 0 |
| Ausgeschlossen R5 | 13 |
| Ausgeschlossen R6 | 0 |
| Nachgezogen | 32 |
| Finale Stichprobe | 100 |

## Coverage je Yahoo-Achse

Nenner fuer Messlauf 2 ist ausschliesslich die gefilterte finale Stichprobe. Die Vergleichswerte sind Yahoo-Coverage (Yahoo-only plus beide) aus Messlauf 1.

| Achse | Messlauf 2 Yahoo | Messlauf 1 Yahoo | Delta |
|---|---:|---:|---:|
| revGrowthLevel | 97.0 % (97/100) | 80.0 % (80/100) | +17.0 pp |
| revAcceleration | 97.0 % (97/100) | 61.0 % (61/100) | +36.0 pp |
| gpGrowth | 73.0 % (73/100) | 56.0 % (56/100) | +17.0 pp |
| ruleOfX | 97.0 % (97/100) | 80.0 % (80/100) | +17.0 pp |
| marginTrajectory | 87.0 % (87/100) | 55.0 % (55/100) | +32.0 pp |
| capitalEfficiency | 89.0 % (89/100) | 74.0 % (74/100) | +15.0 pp |
| revisionsMomentum | 83.0 % (83/100) | 0.0 % (0/100) | +83.0 pp |
| dilution | 98.0 % (98/100) | 60.0 % (60/100) | +38.0 pp |

## XBRL-Achsen

**UNGEMESSEN.** SEC_CONTACT fehlt; gemaess Messlauf-2-Vorgabe wurden keine SEC/EDGAR-Requests und keine lokalen SEC/XBRL-Fallbacks verwendet.

## Ausschluss-Tabelle

| Ticker | Name | Regel-ID | Grund | quoteType | sector / industry | employees | revenue TTM |
|---|---|---|---|---|---|---:|---:|
| NMG | Nouveau Monde Graphite Inc. | R5 | Struktur-Gate nicht bestanden: employees=144, revenue=FEHLT | EQUITY | Basic Materials / Other Industrial Metals & Mining | 144 | FEHLT |
| EMF | Templeton Emerging Markets Fund | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 6914560 |
| EMD | Western Asset Emerging Markets Debt Fund Inc. | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 68093472 |
| PALI | Palisade Bio, Inc. | R5 | Struktur-Gate nicht bestanden: employees=14, revenue=FEHLT | EQUITY | Healthcare / Biotechnology | 14 | FEHLT |
| ALLO | Allogene Therapeutics, Inc. | R5 | Struktur-Gate nicht bestanden: employees=150, revenue=FEHLT | EQUITY | Healthcare / Biotechnology | 150 | FEHLT |
| ETO | Eaton Vance Tax-Advantaged Global Dividend Opportunities Fund | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 24902404 |
| JOF | Japan Smaller Capitalization Fund, Inc. | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 9538537 |
| RMT | Royce Micro-Cap Trust, Inc. | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 4924477 |
| HIX | Western Asset High Income Fund II Inc. | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 48613600 |
| AFB | AllianceBernstein National Municipal Income Fund, Inc. | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 28306874 |
| IMRX | Immuneering Corporation | R5 | Struktur-Gate nicht bestanden: employees=55, revenue=FEHLT | EQUITY | Healthcare / Biotechnology | 55 | FEHLT |
| IMSR | Terrestrial Energy Inc. | R5 | Struktur-Gate nicht bestanden: employees=74, revenue=FEHLT | EQUITY | Utilities / Utilities - Regulated Electric | 74 | FEHLT |
| AVIR | Atea Pharmaceuticals, Inc. | R5 | Struktur-Gate nicht bestanden: employees=55, revenue=FEHLT | EQUITY | Healthcare / Biotechnology | 55 | FEHLT |
| TEI | Templeton Emerging Markets Income Fund | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 39533052 |
| AVK | Advent Convertible and Income Fund | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 42328924 |
| ACP | Abrdn Income Credit Strategies Fund | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 91201728 |
| AGD | Abrdn Global Dynamic Dividend Fund | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 21714580 |
| RZLT | Rezolute, Inc. | R5 | Struktur-Gate nicht bestanden: employees=68, revenue=FEHLT | EQUITY | Healthcare / Biotechnology | 68 | FEHLT |
| BGR | BlackRock Energy and Resources Trust | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 13492308 |
| TECX | Tectonic Therapeutic, Inc. | R5 | Struktur-Gate nicht bestanden: employees=60, revenue=FEHLT | EQUITY | Healthcare / Biotechnology | 60 | FEHLT |
| BGY | BlackRock Enhanced International Dividend Trust | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 15482797 |
| PEO | Adams Natural Resources Fund, Inc. | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 20288422 |
| BKT | BlackRock Income Trust, Inc. | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 12211314 |
| GAIN | Gladstone Investment Corporation | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 99077000 |
| BOE | BlackRock Enhanced Global Dividend Trust | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 15546859 |
| DIN | Dine Brands Global, Inc. | R5 | Struktur-Gate nicht bestanden: employees=FEHLT, revenue=889699968 | EQUITY | Consumer Cyclical / Restaurants | FEHLT | 889699968 |
| PPT | Franklin Premier Income Trust | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 20925082 |
| NGNE | Neurogene Inc. | R5 | Struktur-Gate nicht bestanden: employees=131, revenue=FEHLT | EQUITY | Healthcare / Biotechnology | 131 | FEHLT |
| EVEX | Eve Holding, Inc. | R5 | Struktur-Gate nicht bestanden: employees=198, revenue=FEHLT | EQUITY | Industrials / Aerospace & Defense | 198 | FEHLT |
| AGMB | AgomAb Therapeutics NV | R5 | Struktur-Gate nicht bestanden: employees=62, revenue=FEHLT | EQUITY | Healthcare / Biotechnology | 62 | FEHLT |
| CMTG | Claros Mortgage Trust, Inc. | R5 | Struktur-Gate nicht bestanden: employees=FEHLT, revenue=-318585984 | EQUITY | Real Estate / REIT - Mortgage | FEHLT | -318585984 |
| MHD | BlackRock MuniHoldings Fund, Inc. | R3 | sector=Financial Services und industry=Asset Management | EQUITY | Financial Services / Asset Management | FEHLT | 52300008 |

## Grenzfall-Log R6

| Ticker | Name | Namensmatch | employees | revenue TTM | Behandlung |
|---|---|---|---:|---:|---|
| - | - | - | - | - | Kein R6-Namensmatch unter den behaltenen Firmen |

## Abrufstatus und finale Firmenliste

- Yahoo-Fundamentals-Time-Series-Abruffehler: 0/100.
- quoteSummary-Schema-Salvage mit verwertbarem Payload: 0/100.
- earningsTrend-Achse ist numerisch gemessen; revisionsMomentum-Coverage: 83.0 % (83/100).

| Ticker | Name | MCap USD Mio. | employees | revenue TTM | earningsTrend-Zeilen | FTS-Fehler |
|---|---|---:|---:|---:|---:|---|
| RYAM | Rayonier Advanced Materials Inc. | 548.6 | 2325 | 1432877952 | 2 | - |
| KOPN | Kopin Corporation | 683.8 | 145 | 39336608 | 2 | - |
| GLRE | Greenlight Capital Re, Ltd. | 557.2 | 84 | 706929984 | 0 | - |
| SGU | Star Group, L.P. | 433.6 | 3024 | 1859281024 | 0 | - |
| HZO | MarineMax, Inc. | 776.6 | 3385 | 2241902080 | 2 | - |
| TASK | TaskUs, Inc. | 546.7 | 65500 | 1212020992 | 2 | - |
| MNRO | Monro, Inc. | 545.6 | 6440 | 1157176064 | 2 | - |
| CASS | Cass Information Systems, Inc. | 697.7 | 923 | 209046000 | 2 | - |
| SMWB | Similarweb Ltd. | 615.4 | 1000 | 289391008 | 2 | - |
| CTKB | Cytek Biosciences, Inc. | 599.2 | 678 | 204171008 | 2 | - |
| FIP | FTAI Infrastructure Inc. | 498.7 | 1110 | 594723008 | 2 | - |
| AQST | Aquestive Therapeutics, Inc. | 494.3 | 147 | 50271000 | 2 | - |
| ALT | Altimmune, Inc. | 554.3 | 57 | 36000 | 2 | - |
| TLRY | Tilray Brands, Inc. | 537.0 | 2842 | 858275008 | 2 | - |
| UMAC | Unusual Machines, Inc. | 795.8 | 141 | 17252752 | 2 | - |
| CWH | Camping World Holdings, Inc. | 415.1 | 11144 | 6310230016 | 2 | - |
| CCRN | Cross Country Healthcare, Inc. | 427.7 | 7890 | 1001942016 | 2 | - |
| ITIC | Investors Title Company | 536.1 | 548 | 280156000 | 0 | - |
| PFIS | Peoples Financial Services Corp. | 701.6 | 547 | 190364992 | 2 | - |
| MYGN | Myriad Genetics, Inc. | 584.6 | 2700 | 557000000 | 2 | - |
| VTS | Vitesse Energy, Inc. | 653.6 | 37 | 251983008 | 2 | - |
| PACB | Pacific Biosciences of California, Inc. | 462.8 | 485 | 160030000 | 2 | - |
| XRX | Xerox Holdings Corporation | 350.5 | 22900 | 7410999808 | 2 | - |
| ORN | Orion Group Holdings, Inc. | 533.3 | 2076 | 879907968 | 2 | - |
| CCCC | C4 Therapeutics, Inc. | 395.8 | 104 | 34861000 | 2 | - |
| VEL | Velocity Financial, Inc. | 696.8 | 364 | 271590016 | 2 | - |
| PACK | Ranpak Holdings Corp. | 591.1 | 800 | 405000000 | 2 | - |
| SHBI | Shore Bancshares, Inc. | 790.2 | 595 | 224400000 | 2 | - |
| AMCX | AMC Global Media Inc. | 478.8 | 1675 | 2298694912 | 2 | - |
| OSS | One Stop Systems, Inc. | 302.2 | 56 | 35078300 | 2 | - |
| ONT | Onterris, Inc. | 789.3 | 3500 | 821222016 | 2 | - |
| BKSY | BlackSky Technology Inc. | 795.2 | 321 | 97805000 | 2 | - |
| SHEN | Shenandoah Telecommunications Company | 678.8 | 1041 | 362108992 | 2 | - |
| CCOI | Cogent Communications Holdings, Inc. | 586.4 | 1795 | 889404992 | 2 | - |
| KELYB | Kelly Services, Inc. | 793.6 | 4900 | 4126700032 | 0 | - |
| ASPI | ASP Isotopes Inc. | 496.7 | 271 | 26927000 | 2 | - |
| KELYA | Kelly Services, Inc. | 534.3 | 4900 | 4126700032 | 2 | - |
| RBB | RBB Bancorp | 472.5 | 369 | 126839000 | 2 | - |
| HBB | Hamilton Beach Brands Holding Company | 325.9 | 640 | 595443008 | 0 | - |
| EVGO | EVgo, Inc. | 543.0 | 376 | 418329984 | 2 | - |
| EVMN | Evommune, Inc. | 421.4 | 48 | 10000000 | 2 | - |
| FVR | FrontView REIT, Inc. | 637.3 | 22 | 68498000 | 2 | - |
| VALN | Valneva SE | 518.8 | 674 | 156331008 | 2 | - |
| SWBI | Smith & Wesson Brands, Inc. | 682.1 | 1378 | 523844992 | 1 | - |
| PSFE | Paysafe Limited | 436.7 | 2900 | 1743111040 | 2 | - |
| HIVE | HIVE Digital Technologies Ltd. | 770.2 | 29 | 297791008 | 2 | - |
| TWI | Titan International, Inc. | 504.4 | 8200 | 1842808064 | 2 | - |
| BGS | B&G Foods, Inc. | 309.2 | 2349 | 1812221056 | 2 | - |
| HTT | High Templar Tech Limited | 409.9 | 101 | 40963624 | 0 | - |
| TWIN | Twin Disc, Incorporated | 321.6 | 980 | 363548000 | 2 | - |
| ABAT | American Battery Technology Company | 330.1 | 157 | 16284496 | 2 | - |
| NUAI | New Era Energy & Digital, Inc. | 403.6 | 5 | 1361298 | 2 | - |
| PKE | Park Aerospace Corp. | 673.9 | 125 | 73301000 | 2 | - |
| NRGV | Energy Vault Holdings, Inc. | 547.0 | 142 | 217016000 | 2 | - |
| PTLO | Portillo's Inc. | 340.9 | 7890 | 738252032 | 2 | - |
| PAR | PAR Technology Corporation | 696.2 | 1800 | 475660992 | 2 | - |
| ABEO | Abeona Therapeutics Inc. | 400.1 | 226 | 14540000 | 2 | - |
| HTZ | Hertz Global Holdings, Inc. | 590.5 | 26000 | 8695000064 | 2 | - |
| WTI | W&T Offshore, Inc. | 495.4 | 370 | 521614016 | 2 | - |
| BETR | Better Home & Finance Holding Company | 427.4 | 1329 | 181040992 | 2 | - |
| DDL | Dingdong (Cayman) Limited | 508.4 | 3658 | 24452055040 | 2 | - |
| BBW | Build-A-Bear Workshop, Inc. | 438.8 | 1200 | 526707008 | 2 | - |
| FNLC | The First Bancorp, Inc. | 395.7 | 278 | 95978000 | 0 | - |
| RGNX | REGENXBIO Inc. | 579.0 | 371 | 87822000 | 2 | - |
| MAX | MediaAlpha, Inc. | 759.6 | 147 | 1159294976 | 2 | - |
| BWMX | Betterware de México, S.A.P.I. de C.V. | 688.6 | 2591 | 14275182592 | 2 | - |
| OPTU | Optimum Communications, Inc. | 350.1 | 9500 | 8503553024 | 2 | - |
| DDD | 3D Systems Corporation | 459.8 | 1418 | 387900000 | 2 | - |
| RIGL | Rigel Pharmaceuticals, Inc. | 771.0 | 172 | 299767008 | 2 | - |
| KE | Kimball Electronics, Inc. | 586.8 | 5700 | 1440276992 | 2 | - |
| NRIM | Northrim BanCorp, Inc. | 633.5 | 516 | 211736000 | 2 | - |
| UAMY | United States Antimony Corporation | 789.1 | 100 | 39041772 | 2 | - |
| AROW | Arrow Financial Corporation | 702.5 | 575 | 168355008 | 2 | - |
| FNKO | Funko, Inc. | 328.9 | 1104 | 918388992 | 2 | - |
| CLPT | ClearPoint Neuro, Inc. | 451.6 | 172 | 40614000 | 2 | - |
| SG | Sweetgreen, Inc. | 740.9 | 6486 | 674691008 | 2 | - |
| ONIT | Onity Group Inc. | 351.4 | 4200 | 1111200000 | 2 | - |
| XPER | Xperi Inc. | 364.0 | 1380 | 448278016 | 2 | - |
| CNNE | Cannae Holdings, Inc. | 670.5 | 6602 | 416600000 | 2 | - |
| OCGN | Ocugen, Inc. | 463.8 | 116 | 4465000 | 2 | - |
| VREX | Varex Imaging Corporation | 453.5 | 2450 | 857500032 | 2 | - |
| SIBN | SI-BONE, Inc. | 785.9 | 376 | 206223008 | 2 | - |
| KRUS | Kura Sushi USA, Inc. | 577.2 | 3900 | 318843008 | 2 | - |
| PCB | PCB Bancorp | 435.9 | 264 | 116138000 | 2 | - |
| CLFD | Clearfield, Inc. | 420.2 | 243 | 148547008 | 2 | - |
| ZUMZ | Zumiez Inc. | 318.4 | 2400 | 938062016 | 2 | - |
| HSHP | Himalaya Shipping Ltd. | 722.7 | 3 | 143500000 | 0 | - |
| EFOR | Everforth, Inc. | 765.9 | 2800 | 3980400128 | 2 | - |
| XPOF | Xponential Fitness, Inc. | 334.9 | 226 | 298710016 | 2 | - |
| OMER | Omeros Corporation | 667.3 | 175 | 9893000 | 2 | - |
| FUBO | FuboTV Inc. | 301.8 | 510 | 5304069120 | 2 | - |
| OXM | Oxford Industries, Inc. | 612.6 | 6000 | 1476375040 | 2 | - |
| SERV | Serve Robotics Inc. | 448.4 | 370 | 5195000 | 2 | - |
| ARVN | Arvinas, Inc. | 518.1 | 246 | 89400000 | 2 | - |
| VELO | Velo3D, Inc. | 308.3 | 134 | 50469000 | 2 | - |
| SPRY | ARS Pharmaceuticals, Inc. | 740.8 | 154 | 98986000 | 2 | - |
| PERI | Perion Network Ltd. | 399.0 | 511 | 440959008 | 2 | - |
| PRTA | Prothena Corporation plc | 443.4 | 67 | 57940000 | 2 | - |
| CINT | CI&T Inc. | 429.3 | 8015 | 515382016 | 2 | - |
| NVRI | Enviri Corporation | 640.4 | 12000 | 2242254080 | 2 | - |

