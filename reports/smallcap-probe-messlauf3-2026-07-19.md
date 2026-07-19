# Small-Cap-Coverage-Probe - Messlauf 3 (2026-07-19)

Run-Hash: `4639d5cd92861bf4` (Fingerabdruck ueber Seed, Filter und gezogene Ticker; identisch in JSON und MD).

> **Methodik-Korrektur zu BH-014:** Messlauf 2 zog seine Kandidaten aus 4 thematischen Yahoo-Screener-Seiten (kein Wahrscheinlichkeits-Sample). Messlauf 3 zieht per Rejection-Sampling aus der vollstaendigen SEC-EDGAR-Registranten-Liste (company_tickers.json) -- ein echtes Wahrscheinlichkeits-Sample der US-Operating-Company-Population, gefiltert auf dasselbe $300-800M-Marktkapitalisierungs-Band und dieselben R1-R6-Qualitaetsregeln wie Messlauf 2.

Reine Messung mit Zahlen, Ausschlussgruenden und Rohfeldern. Der Bericht enthaelt keine Schlussfolgerung ausser der expliziten GO-Aussage in Abschnitt "GO/NO-GO-Basis".

## Methodik

- Kandidatenbasis: SEC `company_tickers.json` (vollstaendige EDGAR-Registranten mit Ticker), 10414 eindeutige Ticker.
- Ziehung: deterministische Mischung per `fnv1a(seed:ticker)`-Rang (dieselbe Mechanik wie Messlauf 2s Seed-Rang), danach Rejection-Sampling einzeln gegen R1-R6 + Marktkapitalisierungs-Band + Emittenten-Dedupe bis 100 Treffer stehen.
- Seed: `smallcap-probe-2026-07-19-messlauf3`.
- Marktkapitalisierungs-Band: identisch zu Messlauf 2, USD 300-800 Mio.
- Coverage-Messung (Yahoo-Felder + SEC-XBRL-Ableitungen) verwendet unveraendert dieselben Achsen-Definitionen und dieselbe XBRL-Ableitungslogik wie Messlauf 2 (`scripts/probe-smallcap-coverage.js`, per `module.exports` wiederverwendet).
- Yahoo-Drosselung: mindestens 300 ms zwischen Requests; SEC-Drosselung: mindestens 175 ms. Bei Rate-Limit/WAF-Block reaktiver Backoff (3000/8000/20000/45000 ms) statt Hart-Abbruch.
- Der SEC-User-Agent kam zur Laufzeit aus `process.env.SEC_CONTACT`; sein Wert wurde nicht protokolliert.

## Filter-Definition R1-R6 + MCAP + DUP

| Regel | Definition | Fehlende Felder |
|---|---|---|
| R1 | quoteType (hart): behalten nur wenn quoteType == "EQUITY"; ETF/MUTUALFUND/CLOSEDEND/INDEX/CURRENCY/CRYPTOCURRENCY/TRUST werden ausgeschlossen. | fail-closed |
| R2 | Ticker-Struktur (hart): Endung .U, .WS, -WT oder -U sowie positiver Warrant/Unit-Marker werden ausgeschlossen. | fail-open |
| R3 | Sektor/Industry (hart): Financial Services zusammen mit Shell Companies, Asset Management, Closed-End Fund* oder Exchange Traded Fund wird ausgeschlossen. | fail-closed |
| R4 | Name (hart): /\b(Acquisition Corp\|Blank Check\|SPAC)\b/i auf longName+shortName wird ausgeschlossen. | fail-open |
| R5 | Struktur-Gate: behalten nur wenn fullTimeEmployees > 1 UND totalRevenue (TTM) > 0. | fail-closed |
| R6 | Name (weich): /\b(Trust\|Fund\|Royalty)\b/i wird nur bei nicht klar bestandenem R5 ausgeschlossen; bei bestandenem R5 bleibt der Name und kommt ins Grenzfall-Log. | fail-open |
| DUP | Emittenten-Dedupe (Mess-Hygiene, kein Council-Filter; Kreuz-Review Tag 315 P2): normalisierter Firmenname darf nur einmal in die Stichprobe — Share-Klassen desselben Emittenten werden nachgezogen statt doppelt gezaehlt. | fail-open |
| MCAP | Marktkapitalisierungs-Band (hart, identisch zu Messlauf 2): behalten nur wenn Yahoo price.marketCap zwischen USD 300 Mio. und USD 800 Mio. liegt (inklusive Grenzen). In Messlauf 2 war das ein Vorfilter der Kandidatenbasis; hier ist es eine explizite Regel, weil die Kandidatenbasis (volles SEC-Universum) keine Marktkapitalisierung voraussetzt. | fail-closed |

Erster Treffer entscheidet (Reihenfolge R1-R6, dann MCAP, dann DUP).

## Ziehungs-Bilanz

| Kennzahl | Anzahl |
|---|---:|
| Ticker im Kandidatenpool | 10414 |
| Gezogen gesamt | 1732 |
| Ausgeschlossen R1 (quoteType) | 118 |
| Ausgeschlossen R2 (Ticker-Struktur) | 16 |
| Ausgeschlossen R3 (Sektor/Industry) | 409 |
| Ausgeschlossen R4 (SPAC-Name) | 0 |
| Ausgeschlossen R5 (Struktur-Gate) | 252 |
| Ausgeschlossen R6 (weicher Namensmatch) | 0 |
| Ausgeschlossen MCAP (ausserhalb Band) | 836 |
| Ausgeschlossen DUP (Emittenten-Dublette) | 1 |
| Finale Stichprobe | 100 |

## Coverage je Achse -- Yahoo

Nenner ist die gefilterte finale Stichprobe (n=100). CI = 95%-Wilson-Intervall. ciOverlap95=nein heisst: die beiden 95%-Intervalle ueberlappen nicht -> statistisch nachweisbarer Unterschied bei n=100 je Lauf.

| Achse | Messlauf 3 | 95%-CI | Messlauf 2 | 95%-CI | Delta pp | CI ueberlappt |
|---|---:|---:|---:|---:|---:|---:|
| revGrowthLevel | 97.0% (97/100) | [91.5, 99.0] | 97.0% (97/100) | [91.5, 99.0] | +0.0 | ja |
| revAcceleration | 90.0% (90/100) | [82.6, 94.5] | 98.0% (98/100) | [93.0, 99.4] | -8.0 | ja |
| gpGrowth | 71.0% (71/100) | [61.5, 79.0] | 74.0% (74/100) | [64.6, 81.6] | -3.0 | ja |
| ruleOfX | 97.0% (97/100) | [91.5, 99.0] | 97.0% (97/100) | [91.5, 99.0] | +0.0 | ja |
| marginTrajectory | 74.0% (74/100) | [64.6, 81.6] | 87.0% (87/100) | [79.0, 92.2] | -13.0 | ja |
| capitalEfficiency | 82.0% (82/100) | [73.3, 88.3] | 89.0% (89/100) | [81.4, 93.7] | -7.0 | ja |
| revisionsMomentum | 75.0% (75/100) | [65.7, 82.5] | 85.0% (85/100) | [76.7, 90.7] | -10.0 | ja |
| dilution | 90.0% (90/100) | [82.6, 94.5] | 98.0% (98/100) | [93.0, 99.4] | -8.0 | ja |

## Coverage je Achse -- SEC-XBRL

| Achse | Messlauf 3 | 95%-CI | Messlauf 2 | 95%-CI | Delta pp | CI ueberlappt |
|---|---:|---:|---:|---:|---:|---:|
| revGrowthLevel | 67.0% (67/100) | [57.3, 75.4] | 89.0% (89/100) | [81.4, 93.7] | -22.0 | nein |
| revAcceleration | 68.0% (68/100) | [58.3, 76.3] | 87.0% (87/100) | [79.0, 92.2] | -19.0 | nein |
| gpGrowth | 32.0% (32/100) | [23.7, 41.7] | 42.0% (42/100) | [32.8, 51.8] | -10.0 | ja |
| ruleOfX | 67.0% (67/100) | [57.3, 75.4] | 89.0% (89/100) | [81.4, 93.7] | -22.0 | nein |
| marginTrajectory | 61.0% (61/100) | [51.2, 70.0] | 76.0% (76/100) | [66.8, 83.3] | -15.0 | ja |
| capitalEfficiency | 57.0% (57/100) | [47.2, 66.3] | 75.0% (75/100) | [65.7, 82.5] | -18.0 | ja |
| revisionsMomentum | 0.0% (0/100) | [0.0, 3.7] | 0.0% (0/100) | [0.0, 3.7] | +0.0 | ja |
| dilution | 64.0% (64/100) | [54.2, 72.7] | 84.0% (84/100) | [75.6, 89.9] | -20.0 | nein |

## Coverage je Achse -- kombiniert (Yahoo ODER XBRL)

| Achse | Messlauf 3 | 95%-CI | Messlauf 2 (kombiniert) | Delta pp | CI ueberlappt |
|---|---:|---:|---:|---:|---:|
| revGrowthLevel | 98.0% (98/100) | [93.0, 99.4] | 100.0% (100/100) | -2.0 | ja |
| revAcceleration | 91.0% (91/100) | [83.8, 95.2] | 99.0% (99/100) | -8.0 | ja |
| gpGrowth | 71.0% (71/100) | [61.5, 79.0] | 75.0% (75/100) | -4.0 | ja |
| ruleOfX | 98.0% (98/100) | [93.0, 99.4] | 100.0% (100/100) | -2.0 | ja |
| marginTrajectory | 75.0% (75/100) | [65.7, 82.5] | 89.0% (89/100) | -14.0 | ja |
| capitalEfficiency | 82.0% (82/100) | [73.3, 88.3] | 89.0% (89/100) | -7.0 | ja |
| revisionsMomentum | 75.0% (75/100) | [65.7, 82.5] | 85.0% (85/100) | -10.0 | ja |
| dilution | 93.0% (93/100) | [86.3, 96.6] | 99.0% (99/100) | -6.0 | ja |

## GO/NO-GO-Basis fuer das $300M-Floor-GO vom 17.07.

USD-Floor: 300 Mio.

Kombinierte Coverage (Yahoo ODER SEC-XBRL deckt die Achse) je Achse, verglichen per nicht-ueberlappendem 95%-Wilson-Intervall gegen Messlauf 2. Dies ist eine Mess-Aussage, keine Geschaeftsentscheidung -- die GO/NO-GO-Entscheidung selbst bleibt bei Karl.

**HAELT: keine Achse zeigt unter der unverzerrten Ziehung einen statistisch signifikanten (95%-CI, nicht ueberlappend) Rueckgang der kombinierten Yahoo+XBRL-Coverage gegenueber Messlauf 2.**

## Ausschluss-Tabelle (Auszug, alle Datensaetze im JSON)

| Ticker | Regel-ID | Grund |
|---|---|---|
| UMH | MCAP | marketCap=1336257536 (Band 300000000-800000000) |
| RILYL | MCAP | marketCap=FEHLT (Band 300000000-800000000) |
| ALV | MCAP | marketCap=8803032064 (Band 300000000-800000000) |
| USDW | R3 | Pflichtfeld fehlt: sector=FEHLT, industry=FEHLT |
| NGNE | R5 | Struktur-Gate nicht bestanden: employees=131, revenue=FEHLT |
| RFAIU | R3 | sector=Financial Services und industry=Shell Companies |
| BRK-A | MCAP | marketCap=1058296627200 (Band 300000000-800000000) |
| BIRD | MCAP | marketCap=23776338 (Band 300000000-800000000) |
| WBX | MCAP | marketCap=109991536 (Band 300000000-800000000) |
| EBOSF | MCAP | marketCap=4869669376 (Band 300000000-800000000) |
| ATKR | MCAP | marketCap=2479192576 (Band 300000000-800000000) |
| ASRMF | MCAP | marketCap=8213999616 (Band 300000000-800000000) |
| PPT | R3 | sector=Financial Services und industry=Asset Management |
| BLMOY | MCAP | marketCap=12668968960 (Band 300000000-800000000) |
| CSLLY | MCAP | marketCap=41684496384 (Band 300000000-800000000) |
| MMXGY | R1 | quoteType=MUTUALFUND (nur EQUITY bleibt) |
| TOPP | MCAP | marketCap=19241300 (Band 300000000-800000000) |
| MTTCF | R5 | Struktur-Gate nicht bestanden: employees=12, revenue=FEHLT |
| ABCP | R5 | Struktur-Gate nicht bestanden: employees=4, revenue=FEHLT |
| GIXXU | R3 | sector=Financial Services und industry=Shell Companies |
| PHAR | MCAP | marketCap=951321920 (Band 300000000-800000000) |
| HAWK | MCAP | marketCap=1830871808 (Band 300000000-800000000) |
| TACPF | R1 | quoteType=MUTUALFUND (nur EQUITY bleibt) |
| MESH | R3 | sector=Financial Services und industry=Shell Companies |
| FINCF | R1 | quoteType=NONE (nur EQUITY bleibt); Yahoo-Abruf: Failed Yahoo Schema validation |
| MDDTY | R1 | quoteType=NONE (nur EQUITY bleibt); Yahoo-Abruf: Failed Yahoo Schema validation |
| BWIV | R3 | sector=Financial Services und industry=Shell Companies |
| FREVS | MCAP | marketCap=158253440 (Band 300000000-800000000) |
| LKSP | R3 | sector=Financial Services und industry=Shell Companies |
| ESE | MCAP | marketCap=8251952128 (Band 300000000-800000000) |
| ENDMF | R5 | Struktur-Gate nicht bestanden: employees=FEHLT, revenue=FEHLT |
| LIVE | MCAP | marketCap=34403160 (Band 300000000-800000000) |
| SEER | MCAP | marketCap=119309976 (Band 300000000-800000000) |
| FXACW | R3 | Pflichtfeld fehlt: sector=FEHLT, industry=FEHLT |
| OXLC | R3 | sector=Financial Services und industry=Asset Management |
| TRNR | MCAP | marketCap=1589496 (Band 300000000-800000000) |
| APOG | MCAP | marketCap=856226048 (Band 300000000-800000000) |
| SLDE | MCAP | marketCap=2348464640 (Band 300000000-800000000) |
| RNXT | MCAP | marketCap=39024280 (Band 300000000-800000000) |
| QURE | MCAP | marketCap=2767360512 (Band 300000000-800000000) |
| ABG | MCAP | marketCap=4102838784 (Band 300000000-800000000) |
| MOBXW | R3 | Pflichtfeld fehlt: sector=FEHLT, industry=FEHLT |
| MHLA | R3 | Pflichtfeld fehlt: sector=FEHLT, industry=FEHLT |
| ECCC | R3 | sector=Financial Services und industry=Asset Management |
| MOBBW | R3 | Pflichtfeld fehlt: sector=FEHLT, industry=FEHLT |
| AEG | MCAP | marketCap=13322330112 (Band 300000000-800000000) |
| CVSI | MCAP | marketCap=4079550 (Band 300000000-800000000) |
| NTLA | MCAP | marketCap=1589340800 (Band 300000000-800000000) |
| EDTK | MCAP | marketCap=15005542 (Band 300000000-800000000) |
| IPEXR | R3 | Pflichtfeld fehlt: sector=FEHLT, industry=FEHLT |
| WABC | MCAP | marketCap=1411402752 (Band 300000000-800000000) |
| FNFPA | R3 | Pflichtfeld fehlt: sector=FEHLT, industry=FEHLT |
| SZZLU | R3 | sector=Financial Services und industry=Shell Companies |
| SIDU | MCAP | marketCap=151217280 (Band 300000000-800000000) |
| ATMU | MCAP | marketCap=4194696192 (Band 300000000-800000000) |
| ABVC | R5 | Struktur-Gate nicht bestanden: employees=16, revenue=FEHLT |
| MTMCF | R5 | Struktur-Gate nicht bestanden: employees=FEHLT, revenue=436194 |
| PGC | MCAP | marketCap=816817216 (Band 300000000-800000000) |
| CXAIW | R3 | Pflichtfeld fehlt: sector=FEHLT, industry=FEHLT |
| SKK | MCAP | marketCap=11912823 (Band 300000000-800000000) |
| ... | ... | +1572 weitere, siehe JSON |

## Finale Firmenliste

| Ticker | Name | MCap USD Mio. | CIK | Yahoo-Achsen | XBRL-Achsen |
|---|---|---:|---|---:|---:|
| MCFT | MasterCraft Boat Holdings, Inc. | 605.1 | 0001638290 | 8/8 | 7/8 |
| IDPUF | IDP Education Limited | 565.0 | 0002062803 | 4/8 | 0/8 |
| CLDT | Chatham Lodging Trust | 656.2 | 0001476045 | 7/8 | 5/8 |
| IBCP | Independent Bank Corporation | 750.3 | 0000039311 | 5/8 | 4/8 |
| CBAN | Colony Bankcorp, Inc. | 443.9 | 0000711669 | 5/8 | 0/8 |
| SBC | SBC Medical Group Holdings Incorporated | 316.8 | 0001930313 | 8/8 | 7/8 |
| PFIS | Peoples Financial Services Corp. | 688.0 | 0001056943 | 5/8 | 0/8 |
| ALT | Altimmune, Inc. | 558.1 | 0001326190 | 7/8 | 6/8 |
| CLB | Core Laboratories Inc. | 522.7 | 0001958086 | 8/8 | 6/8 |
| VTEX | VTEX | 716.0 | 0001793663 | 8/8 | 0/8 |
| EGY | VAALCO Energy, Inc. | 567.2 | 0000894627 | 8/8 | 6/8 |
| CTKB | Cytek Biosciences, Inc. | 596.6 | 0001831915 | 8/8 | 7/8 |
| BWAY | BrainsWay Ltd. | 631.2 | 0001505065 | 8/8 | 0/8 |
| PROK | ProKidney Corp. | 489.3 | 0001850270 | 7/8 | 6/8 |
| OABI | OmniAb, Inc. | 307.3 | 0001846253 | 8/8 | 6/8 |
| SERV | Serve Robotics Inc. | 433.1 | 0001832483 | 7/8 | 6/8 |
| RYAM | Rayonier Advanced Materials Inc. | 555.0 | 0001597672 | 8/8 | 7/8 |
| HNRG | Hallador Energy Company | 753.1 | 0000788965 | 8/8 | 6/8 |
| KIDS | OrthoPediatrics Corp. | 493.5 | 0001425450 | 8/8 | 7/8 |
| ELMD | Electromed, Inc. | 348.6 | 0001488917 | 8/8 | 7/8 |
| CWH | Camping World Holdings, Inc. | 392.6 | 0001669779 | 8/8 | 6/8 |
| NVEC | NVE Corporation | 417.5 | 0000724910 | 7/8 | 7/8 |
| LYEL | Lyell Immunopharma, Inc. | 310.8 | 0001806952 | 7/8 | 6/8 |
| CBK | Commercial Bancgroup, Inc. | 466.4 | 0001981546 | 5/8 | 0/8 |
| GMRS | GMR Solutions Inc. | 720.5 | 0001898718 | 6/8 | 1/8 |
| URG | Ur-Energy Inc. | 488.7 | 0001375205 | 7/8 | 6/8 |
| COFS | ChoiceOne Financial Services, Inc. | 508.1 | 0000803164 | 5/8 | 4/8 |
| MVBF | MVB Financial Corp. | 376.6 | 0001277902 | 5/8 | 4/8 |
| ATNI | ATN International, Inc. | 356.4 | 0000879585 | 8/8 | 6/8 |
| ECX | ECARX Holdings Inc. | 432.3 | 0001861974 | 8/8 | 0/8 |
| OMER | Omeros Corporation | 701.3 | 0001285819 | 2/8 | 6/8 |
| BWMX | Betterware de México, S.A.P.I. de C.V. | 683.1 | 0001788257 | 8/8 | 0/8 |
| ETD | Ethan Allen Interiors Inc. | 579.7 | 0000896156 | 8/8 | 7/8 |
| CTO | CTO Realty Growth, Inc. | 750.7 | 0000023795 | 8/8 | 6/8 |
| LDI | loanDepot, Inc. | 706.9 | 0001831631 | 5/8 | 0/8 |
| AXG | Solowin Holdings | 615.2 | 0001959224 | 5/8 | 0/8 |
| PDLB | Ponce Financial Group, Inc. | 489.8 | 0001874071 | 5/8 | 0/8 |
| EBS | Emergent BioSolutions Inc. | 393.7 | 0001367644 | 8/8 | 7/8 |
| USCB | USCB Financial Holdings, Inc. | 374.0 | 0001901637 | 5/8 | 0/8 |
| TATT | TAT Technologies Ltd. | 521.9 | 0000808439 | 8/8 | 0/8 |
| OFIX | Orthofix Medical Inc. | 468.1 | 0000884624 | 8/8 | 7/8 |
| BTBT | Bit Digital, Inc. | 494.8 | 0001710350 | 8/8 | 6/8 |
| PTLO | Portillo's Inc. | 338.0 | 0001871509 | 8/8 | 6/8 |
| BMBL | Bumble Inc. | 442.9 | 0001830043 | 8/8 | 6/8 |
| OSPN | OneSpan Inc. | 573.5 | 0001044777 | 8/8 | 7/8 |
| NRC | NRC Health | 490.8 | 0000070487 | 7/8 | 6/8 |
| RMR | The RMR Group Inc. | 352.8 | 0001644378 | 7/8 | 6/8 |
| EFTY | Etoiles Capital Group Co., Ltd | 302.1 | 0002058349 | 4/8 | 0/8 |
| CINT | CI&T Inc. | 415.2 | 0001868995 | 8/8 | 0/8 |
| NATR | Nature's Sunshine Products, Inc. | 359.3 | 0000275053 | 8/8 | 7/8 |
| OFLX | Omega Flex, Inc. | 301.6 | 0001317945 | 7/8 | 7/8 |
| FSBW | FS Bancorp, Inc. | 326.9 | 0001530249 | 5/8 | 4/8 |
| IPI | Intrepid Potash, Inc. | 459.4 | 0001421461 | 8/8 | 7/8 |
| GYRE | Gyre Therapeutics, Inc. | 674.5 | 0001124105 | 8/8 | 7/8 |
| CYH | Community Health Systems, Inc. | 465.0 | 0001108109 | 8/8 | 6/8 |
| PCB | PCB Bancorp | 424.3 | 0001423869 | 5/8 | 4/8 |
| WOOF | Petco Health and Wellness Company, Inc. | 759.6 | 0001826470 | 8/8 | 7/8 |
| AGNT | AGNT, Inc | 752.6 | 0001495932 | 8/8 | 7/8 |
| BKKT | Bakkt, Inc. | 324.1 | 0001820302 | 8/8 | 6/8 |
| GSM | Ferroglobe PLC | 626.0 | 0001639877 | 8/8 | 0/8 |
| ELMT | The Elmet Group Co. | 432.0 | 0002101698 | 7/8 | 1/8 |
| SBOEF | SBO AG | 481.6 | 0001578955 | 6/8 | 0/8 |
| AUTL | Autolus Therapeutics plc | 383.2 | 0001730463 | 7/8 | 5/8 |
| CPS | Cooper-Standard Holdings Inc. | 490.4 | 0001320461 | 8/8 | 7/8 |
| MGPI | MGP Ingredients, Inc. | 381.7 | 0000835011 | 8/8 | 7/8 |
| CRD-A | Crawford & Company | 536.6 | 0000025475 | 8/8 | 6/8 |
| EACO | EACO Corporation | 491.0 | 0000784539 | 6/8 | 6/8 |
| KRNGY | Karoon Energy Ltd | 675.1 | 0001494191 | 4/8 | 0/8 |
| FCCO | First Community Corporation | 307.4 | 0000932781 | 5/8 | 4/8 |
| GFR | Greenfire Resources Ltd. | 796.5 | 0001966287 | 7/8 | 0/8 |
| FCCN | Spectral Capital Corporation | 486.5 | 0001131903 | 4/8 | 4/8 |
| LEGH | Legacy Housing Corporation | 637.1 | 0001436208 | 8/8 | 6/8 |
| UNTY | Unity Bancorp, Inc. | 574.8 | 0000920427 | 5/8 | 0/8 |
| NATH | Nathan's Famous, Inc. | 393.3 | 0000069733 | 7/8 | 7/8 |
| SWRD | Stewards Inc. | 606.4 | 0001795851 | 0/8 | 0/8 |
| OVID | Ovid Therapeutics Inc. | 455.4 | 0001636651 | 7/8 | 6/8 |
| JMSB | John Marshall Bancorp, Inc. | 313.0 | 0001710482 | 5/8 | 0/8 |
| ELTP | Elite Pharmaceuticals, Inc. | 420.1 | 0001053369 | 7/8 | 7/8 |
| KODK | Eastman Kodak Company | 750.0 | 0000031235 | 7/8 | 7/8 |
| ALTO | Alto Ingredients, Inc. | 452.5 | 0000778164 | 8/8 | 7/8 |
| CZFS | Citizens Financial Services, Inc. | 353.7 | 0000739421 | 5/8 | 4/8 |
| CGC | Canopy Growth Corporation | 421.5 | 0001737927 | 8/8 | 7/8 |
| TRC | Tejon Ranch Co. | 490.7 | 0000096869 | 7/8 | 7/8 |
| ARQQ | Arqit Quantum Inc. | 303.2 | 0001859690 | 4/8 | 0/8 |
| SFST | Southern First Bancshares, Inc. | 588.1 | 0001090009 | 5/8 | 4/8 |
| PTCHF | PureTech Health plc | 388.7 | 0001782999 | 4/8 | 0/8 |
| VALU | Value Line, Inc. | 384.9 | 0000717720 | 6/8 | 6/8 |
| NCMI | National CineMedia, Inc. | 354.5 | 0001377630 | 8/8 | 6/8 |
| CIX | CompX International Inc. | 309.3 | 0001049606 | 6/8 | 6/8 |
| RBB | RBB Bancorp | 458.3 | 0001499422 | 5/8 | 4/8 |
| YSG | Yatsen Holding Limited | 334.9 | 0001819580 | 8/8 | 0/8 |
| CWCO | Consolidated Water Co. Ltd. | 466.7 | 0000928340 | 8/8 | 7/8 |
| FSTR | L.B. Foster Company | 438.5 | 0000352825 | 8/8 | 7/8 |
| DGMDF | Digital Domain Holdings Limited | 351.1 | 0002034300 | 5/8 | 0/8 |
| CSV | Carriage Services, Inc. | 597.9 | 0001016281 | 8/8 | 7/8 |
| OTLY | Oatly Group AB | 313.5 | 0001843586 | 8/8 | 0/8 |
| TWIN | Twin Disc, Incorporated | 325.8 | 0000100378 | 8/8 | 6/8 |
| AUNA | Auna SA | 379.2 | 0001799207 | 8/8 | 0/8 |
| VALN | Valneva SE | 510.6 | 0001836564 | 8/8 | 0/8 |
| XNET | Xunlei Limited | 367.3 | 0001510593 | 7/8 | 0/8 |

