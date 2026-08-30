# F1 — Datenfundament des verbreiterten Konzept-Panels

**Stufe:** F1 der Studie 2.0 · **Erzeugt:** 2026-08-30
**Autorisierung:** ratifiziertes Rats-Verdikt `_COURT-ZWEITQUELLE-2026-08-30.md` (ENTSCHIED 78 — F1–F3 ausdrücklich frei, F4/F5/F5b/F6 gesperrt) · Orchestrator ENTSCHIED 120
**Status:** Messbefund und eingefrorener Stand. **Kein Beschluss, kein Register-Eintrag, kein Siegel berührt, keine Empfehlung.**

---

## AUF EINEN BLICK

**F1 steht. Der F1-Freeze-Hash lautet `58b865592069254808348e0b6c0bbb69600dd74110613ac809050107ef7b9a66`. Und der wichtigste Befund der Stufe war nicht geplant: der FSD-Speicher ist nicht weg — er liegt vollständig auf der Platte.**

1. **Trägerfrage (B1) beantwortet, positiv.** Der versiegelte Sichtkasten `early-detection-v4-sealed127` führt **127 Payloads / 7.540.082.000 Bytes** und 64 Quartals-Ordner; der übergeordnete Speicher `early-detection-v4` **16.984 Dateien / 169,98 GB**. Die 48 registrierten `legacy_earliest_archived`-Payloads des Fensters 2009q1–2020q4 sind **48 von 48 bit-gleich** mit dem im Repo registrierten `payloadSha256`. **Abbruchregel B1 feuert nicht.**
2. **Warum ihn niemand fand:** Die A1-Suche vom Vormittag suchte nach dem Dateinamensmuster `<jjjj>q<n>.zip`. Ein inhaltsadressierter Speicher legt seine Payloads unter `blobs/sha256/xx/<sha256>.zip` ab — dieses Muster **konnte** dort nichts finden. Dazu war `EARLY_DETECTION_DATA_ROOT` nicht gesetzt. Das ist Muster-Lehre 11 im Spiegel: die Negativ-Behauptung nannte die durchsuchten **Orte**, aber nicht die durchsuchte **Achse**.
3. **Zweite, unabhängige Beweislinie.** Zusätzlich wurden dieselben 48 Payloads frisch von den registrierten Quell-URLs bezogen: **48/48 bit-gleich**, 1.718.255.454 Bytes. Beide Linien tragen denselben Payload-Mengen-Hash `cd371f21…`. Die Vintage-Identität (A2) ist damit **doppelt belegt**.
4. **Die Regel erzeugt bit-identisch die Liste des Urteils.** Die mechanische Auswahlregel Z0–Z4 auf dem blinden Inventar liefert über alle zehn Entity-Klassen **genau die vier Kennungen** der beschlossenen Minimalliste — kein Rest, keine fünfte. K7 (a) steht bei 2:2; solange die Form offen ist, tragen **beide Lesarten dieselben Bytes**.
5. **Die Quelle trägt alle vier.** Der Zensus über den wiederhergestellten Jahrgang findet für jede der vier Kennungen konsolidierte Quartalszeilen in 39–45 der 48 Quartale. **Keine Kennung ohne Zeilen.**
6. **Was F1 nicht schließt:** RR-4 (PIT-feste Entity-Klasse) bleibt ungelöst und ist im Freeze offen ausgewiesen. Auflage **A8** (`asOf`-Wächter) ist unerledigt und gehört nicht zu F1 — Einzelheiten in §6.

**Sprungkarte:** [§1 Trägerfrage](#1-die-trägerfrage--der-speicher-ist-da) · [§2 Vintage-Identität](#2-vintage-identität-a2--zwei-unabhängige-linien) · [§3 Die Regel](#3-die-regel-und-die-liste-daraus) · [§4 Der Zensus](#4-der-zensus-trägt-die-quelle-die-vier-kennungen) · [§5 Was eingefroren ist](#5-was-eingefroren-ist) · [§6 Offen](#6-offen--ohne-glättung) · [§7 Neue Fragen](#7-neue-fragen-und-hypothesen) · [§8 Blindheit](#8-blindheits-erklärung)

---

## 1. DIE TRÄGERFRAGE — DER SPEICHER IST DA

Das Urteil führt die Trägerfrage als **Hardware, nicht Methodik** und als Abbruchregel **B1**: ist der FSD-Speicher nach gehärtetem Negativ-Nachweis nicht wiederherstellbar, wird der Pfad ohne weitere Beratung beerdigt. Der Befund ist das Gegenteil.

| Ort | Befund |
| --- | --- |
| `<Datenwurzel>` / `early-detection-v4-sealed127` / `VIEW.json` | vorhanden, `payloadCount 127`, `payloadSetSha256 c861d255…`, `blobsVerknuepft 127` |
| `early-detection-v4-sealed127` / `blobs` / `sha256` | **127 Dateien / 7.540.082.000 Bytes** |
| `early-detection-v4-sealed127` / `observations` / `sec-fsd` | **64 Quartals-Ordner** |
| `early-detection-v4` / `blobs` / `sha256` | **16.984 Dateien / 169.978.794.950 Bytes** |
| `<Datenwurzel>` / `panel` | `panel-entdeckung.sqlite` (6.843,7 MB), `panel-validierung.sqlite` (4.241,6 MB) — **als Dateinamen gezählt, nicht geöffnet** |
| freier Plattenplatz des Systemlaufwerks | 606,6 GB (A7-Gate bestanden, gefordert waren 0,13 GB) |

**Die Datenwurzel ist damit bestimmt:** `EARLY_DETECTION_DATA_ROOT` zeigt auf das Verzeichnis `GrowthScreenerResearchData` (der absolute Pfad steht nach R12a in keinem Artefakt, nur in der Umgebung). `studie-panel-bau.py` sucht den Sichtkasten entweder in der Wurzel selbst oder unter `early-detection-v4-sealed127` darunter — beides trifft zu. Für die F1-Werkzeuge wurde direkt auf den Sichtkasten gezeigt.

**Warum das nicht früher auffiel, ohne Schuldzuweisung:** Der A1-Sweep vom Vormittag suchte über das Nutzerverzeichnis nach Dateien mit dem Namensmuster `<jjjj>q<n>.zip` und fand vier Treffer, alle im Sitzungs-Scratchpad. Das ist korrekt gemessen und trotzdem blind: der Speicher ist **inhaltsadressiert**, seine Payloads heißen `<sha256>.zip`. Die Suchachse „Dateiname" konnte den Speicher nicht sehen. Zusammen mit dem nicht gesetzten `EARLY_DETECTION_DATA_ROOT` ergab das eine Negativ-Behauptung, die auf einer einzigen, ungeeigneten Achse ruhte — **genau die Klasse, gegen die Muster-Lehre 11 und Auflage A13/W9 geschrieben sind**.

**Folge für den Rat:** Die Kostengabel aus K9 kollabiert. Ast **(a-2)** („Store weg → Neubezug", 11–19,5 Tage plus eine ungelöste R6-Frage) hat keine Grundlage mehr; es gilt Ast **(a-1)**. Der Neubezug entfällt, damit auch das Plattenplatz-Problem, die Leser-Migration 9→10 Spalten für den Neubestand und der R6-Gegenstück-Verlust (RR-5) in der Form, in der er dort steht. **Das ist ein Befund, kein Beschluss** — die Umschrift von A2/A12/B3 und RR-5 ist Sache der nächsten Ratssitzung (RR-9).

---

## 2. VINTAGE-IDENTITÄT (A2) — ZWEI UNABHÄNGIGE LINIEN

Auflage A2 verlangt: *„Vintage-Identität beweisen oder als gebrochen deklarieren."* Der Maßstab ist der committete `payloadSha256` aus `protocol/early-detection/2.0.0/provenance-closure.json` (sha256 der Datei: `f316859e…`), nicht ein heute abgefragter Index.

| Linie | Quelle | Payloads | bit-gleich | Bytes | Urteil |
| --- | --- | ---: | ---: | ---: | --- |
| **primär** | Bytes im versiegelten Sichtkasten | 48 | **48** | 1.718.255.454 | **BEWIESEN** |
| **zweitlinie** | frischer Abruf der registrierten Quell-URLs | 48 | **48** | 1.718.255.454 | **BEWIESEN** |

Beide Linien tragen denselben Payload-Mengen-Hash **`cd371f211c62e3c8cf12a8948bc0a89312e2f7da7bb84ccd5302396f0a4ba571`**; der Freeze weist die Deckungsgleichheit als eigenes Feld aus (`zweitlinieDeckungsgleich: true`).

**Warum nicht `early-detection-sec-wayback.py acquire`:** Jenes Werkzeug wählt den Schnappschuss aus einer **frischen** CDX-Abfrage und prüft gegen den dort gemeldeten SHA-1. Das belegt, dass der Abruf zu sich selbst passt — nicht, dass er zum registrierten Jahrgang passt. A2 fragt nach dem Zweiten. Das F1-Werkzeug ruft deshalb die **registrierte** `sourceUrl` ab und vergleicht gegen den **registrierten** `payloadSha256`, fail-closed: bei Abweichung wird nichts abgelegt und der Payload als `VINTAGE_GEBROCHEN` gezählt. Die Speicher-Ablage selbst benutzt weiter `foundation.ingest_fsd_bytes`.

**Netzabrufe:** 48, alle gratis, alle mit höflichem User-Agent `Karl Viehrig karl_viehrig@web.de research`, alle gegen registrierte URLs. **Keine Kosten.**

---

## 3. DIE REGEL — UND DIE LISTE DARAUS

K7 (a) steht bei **2:2**: mechanische Auswahlregel gegen beschlossene Minimalliste. Das Gericht konstruiert keine Mehrheit, stellt aber fest, dass beide Lager dasselbe erzeugen. Die Kanzlei-Empfehlung an den Orchestrator (RR-1) lautet: Regel formulieren, Liste daraus erzeugen, **beide** hashen, in dieser Reihenfolge. Genau das liegt jetzt vor.

### Die Schranken, mit ihrer Herkunft

| Schranke | Größe | Schwelle | Herkunft |
| --- | --- | --- | --- |
| **Z0** | `ciksRettung` | ≥ 10 | Dissens D9 (S1) |
| **Z1** | `RettQ/Rett` | ≥ 0,90 | Position P2 (S3) |
| **Z2** | `qtrs1AnteilFakten` | ≥ 0,50 | Position P2 (S3) |
| **Z3a** | Kennungsname als Zins-/Investment-/Dividendenertrag | nur im Bank-Stratum zulässig | Rang-4-Sperre, K7/K8 |
| **Z3b** | Kennungsname als **Komplement** einer Ertragskomponente (`Noninterest…`, `…ExcludingInterest…`) | nie zulässig | Bestands-Doktrin, K7 (b) |
| **Z4** | `taxonomy` | nur `us-gaap` | K7, 4:0 IFRS-Ausschluss |
| **Z5** | Koexistenz | **entfällt** | K7 (c), 3:0 reiner Fallback |

Ausgewählt wird je Entity-Klasse die Kennung mit der **höchsten Rettungszahl in dieser Klasse**, die alle Schranken erfüllt. Gleichstand ist **NICHT BERECHENBAR** — für die Klasse, nie eine stille Auswahl und nie ein Abbruch des ganzen Laufs.

**Z3b ist die einzige Schranke, die nicht wörtlich in P2 steht.** Sie ist nötig und sie ist abgeleitet, nicht erfunden: Ohne sie gewinnen `NoninterestIncome` (biotech_pharma, spac_blankcheck) und `RevenuesExcludingInterestAndDividends` (finanz_sonstige) ihre Klassen — und **`NoninterestIncome` ist im Urteil mit 3:0 ausdrücklich draußen**. Ihre Begründung ist die von K7 (b) wörtlich zitierte Bestands-Doktrin (`merge-sec-xbrl.js:88-92`): *„Eine fehlende Jahreszahl ist ehrlich, ein Bestandteil in der Rolle der Gesamtgroesse ist falsch."* Eine Kennung, die sich als Komplement einer Ertragskomponente definiert, ist ein Bestandteil. Die Abgrenzung hält: `…ExcludingAssessedTax` schließt eine **Steuer** aus, keine Ertragskomponente — die Kennung der akzeptierten Liste bleibt unberührt, und der Selbsttest prüft genau das.

### Was die Regel erzeugt

| Klasse | Kennung | Rett. in Klasse | Rett. gesamt | Z1 | Z2 | nächster Verfolger |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| bank | `InterestAndDividendIncomeOperating` | 653 | 734 | 0,986 | 0,551 | — |
| reit | `RealEstateRevenueNet` | 23 | 32 | 0,938 | 0,569 | — |
| immobilien | `RealEstateRevenueNet` | 7 | 32 | 0,938 | 0,569 | — |
| versorger | `RegulatedAndUnregulatedOperatingRevenue` | 9 | **10** | 1,000 | 0,590 | `OilAndGasRevenue` |
| operativ | `OilAndGasRevenue` | 60 | 63 | 1,000 | 0,515 | `OilAndGasSalesRevenue` |

**Vier Kennungen — bit-identisch die Liste des Urteils.** `reit` und `immobilien` fallen auf dieselbe Kennung, genau wie die Urteilszeile „Equity-REIT / Immobilien". Der Freeze führt die Deckungsgleichheit als geprüftes Feld (`k7aDeckungsgleich: true`), der Test schlägt fehl, wenn sie je auseinanderläuft.

### Was die Regel nicht erzeugt — ehrliche Ausschlüsse

| Klasse | Grund |
| --- | --- |
| `versicherer` | keine Kennung erfüllt Z0–Z4. Deckt sich mit K7 4:0 zu `PremiumsEarnedNet` (Inventar misst **0** Rettungen) |
| `spac_blankcheck` | keine Kennung erfüllt Z0–Z4. Die 492 Rettungen von `InvestmentIncomeInterest` sind Zins auf Treuhandbestand — Z3a |
| `biotech_pharma` | keine Kennung erfüllt Z0–Z4 |
| `unbekannt` | keine Kennung erfüllt Z0–Z4 (211 Firmen ohne SIC) |
| `finanz_sonstige` | **NICHT BERECHENBAR**: Gleichstand bei 1 Rettung zwischen `OilAndGasRevenue` und `RegulatedAndUnregulatedOperatingRevenue` |

Das sind **eigene protokollierte Ursachenklassen, nie Imputation und nie ein Miss** (K10, 4:0).

### Die protokollierte Unterschreitung

S1s Dissens **D9** verlangt eine Rettungs-Untergrenze **über** 10. Die Regel trägt ≥ 10, und `RegulatedAndUnregulatedOperatingRevenue` steht bei **genau 10**. Die Mehrheit lässt sie zu; die Unterschreitung ist im Artefakt als eigenes Feld protokolliert. **Der Dissens bleibt bestehen und ist als solcher zu zitieren.**

---

## 4. DER ZENSUS — TRÄGT DIE QUELLE DIE VIER KENNUNGEN?

Gelaufen **nach** dem Einfrieren von Regel und Liste: seine Zahlen konnten die Wahl nicht mehr steuern. 48 Payloads, Fenster 2009q1–2020q4, `qtrs=1`, Dimensionsfilter `segments=''` **und** `coreg=''`.

| Gruppe | Kennung | Zeilen roh | konsolidiert | verworfen | roh/kons. | Quartale |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| **Verbreiterung** | `InterestAndDividendIncomeOperating` | 51.702 | **50.821** | 881 | 1,02 | 45 |
| **Verbreiterung** | `RealEstateRevenueNet` | 11.796 | **10.093** | 1.703 | 1,17 | 39 |
| **Verbreiterung** | `OilAndGasRevenue` | 7.509 | **6.617** | 892 | 1,13 | 40 |
| **Verbreiterung** | `RegulatedAndUnregulatedOperatingRevenue` | 3.462 | **2.258** | 1.204 | 1,53 | 45 |
| Kontrolle | `Revenues` | 309.145 | 275.004 | 34.141 | 1,12 | 47 |
| Kontrolle | `SalesRevenueNet` | 168.773 | 146.663 | 22.110 | 1,15 | 47 |
| Kontrolle | `SalesRevenueGoodsNet` | 73.241 | 64.134 | 9.107 | 1,14 | 46 |
| Kontrolle | `RevenueFromContractWithCustomerExcludingAssessedTax` | 54.366 | 53.239 | 1.127 | 1,02 | 14 |
| Kontrolle | `SalesRevenueServicesNet` | 40.328 | 35.952 | 4.376 | 1,12 | 45 |

**Keine Kennung ohne Zeilen** (`ohneZeilen: []`). Die Kontrollgruppe ist die akzeptierte Umsatz-Abbildungsschicht der laufenden Studie — sie steht hier als Referenz unter derselben Leseregel, **nicht** als Änderung an ihr.

**Zwei Beobachtungen, ohne Interpretation:**
* `RevenueFromContractWithCustomerExcludingAssessedTax` trägt in nur **14** der 48 Quartale Zeilen. Das ist der ASC-606-Lebenszyklus (ab 2018), kein Datenmangel.
* Die Verhältnisse roh/konsolidiert liegen im Alt-Jahrgang zwischen 1,02 und 1,53. Der Faktor 11,3, den `k9-restschluss` §6.2 für `RevenueFromContractWithCustomerExcludingAssessedTax` in **2020q4 der heutigen Neuveröffentlichung** misst, tritt hier nicht auf — **weil der archivierte Jahrgang keine `segments`-Spalte hat und dort allein `coreg` trennt**. Die beiden Jahrgänge sind auf dieser Achse **nicht vergleichbar** (A4, offen protokolliert); der Zensus weist die Achse je Payload aus, statt sie zu glätten.

---

## 5. WAS EINGEFROREN IST

Der Bauplan verlangt an dieser Stelle nur den SHA über die Wahl-Grundlage. Der Auftrag dieser Phase ist breiter, deshalb deckt der Freeze sechs Blöcke:

| Block | Inhalt | Hash |
| --- | --- | --- |
| 1 | **Wahl-Grundlage** `konzept-inventar-blind-2026-08-30.json` (im Vault, gehasht statt kopiert) | `d86b1b129d7ec1ed25600f8f51cf9efdbb433cf7c00c1d73128af277985a4850` |
| 2 | **Regel** Z0–Z4 mit ihren Zahlen | `6b3777186781084c9f0b2352aa25d5337f080afca16d2c546e5355fbcc622343` |
| 3 | **Liste** (Ableitung aus der Regel — Regel VOR Liste) | `88ba14a298837bcc6287c4f52a3ba61296b6ba56d96ba78cba0470335df99247` |
| 4 | **Datenfundament** 48 Payloads, beide Linien | `cd371f211c62e3c8cf12a8948bc0a89312e2f7da7bb84ccd5302396f0a4ba571` |
| 5 | **Extraktions-Code** sha256 der vier F1-Skripte | im Freeze je Datei |
| 6 | **Kontaminations-Vorgeschichte, wörtlich** (K3 Bed. 5, A16, A18) | im Freeze |

> **F1-FREEZE-HASH: `58b865592069254808348e0b6c0bbb69600dd74110613ac809050107ef7b9a66`**

Der Extraktions-Code steht **mit im Hash**: eine Regel, deren Implementierung sich danach still ändern kann, ist nicht eingefroren. Der Freeze übernimmt keine gemeldeten Hashes, er rechnet sie nach und lehnt einen Bericht ab, dessen gemeldeter Hash nicht zu seinem Inhalt passt.

**F1 schreibt keinen Register-Eintrag** — die Stufe arbeitet ausschließlich auf öffentlichen Daten (Bauplan §6, Zeile F1). Der Eintrag fällt bei F3.

### Die Wächter, jeder einmal absichtlich rot

| Wächter | Bruchprobe |
| --- | --- |
| **A3** Spaltensatz | umbenannte / zusätzliche / fehlende / doppelte Spalte → jeweils rot; 9- und 10-Spalten-Kopf parsen beide |
| **W-A4-a** überlebende Dimensionszeile | Filter im Lauf abgeschaltet → rot; eingeschaltet → grün (Gegenprobe) |
| **W-A4-b** Filter feuert nie | 10-Spalten-Payload ohne verworfene Zeile → rot; Alt-Jahrgang darf ihn **nicht** auslösen |
| **W-A4-c** Verhältnis-Deckel | Deckel auf 2,0 gesetzt → rot |
| **A2** Vintage | richtige Bytes → BEWIESEN; falsche Bytes **unter richtigem Dateinamen** → GEBROCHEN |
| **A7** Plattenplatz | Anforderung = freier Platz → Gate reißt |
| Siegel-Zaun | Quartal hinter `2020q4` → Abbruch |
| Regel | Z0/Z1/Z2/Z4 einzeln; Z3a nur außerhalb des Bank-Stratums; Gleichstand; eine vom Urteil ausgeschlossene Kennung, die alle Schranken passiert |
| Freeze | manipulierte Liste, geänderter Code, falsch gemeldeter Hash, abweichende Zweitlinie, **CRLF im Extraktions-Code** |

Der letzte kam aus einem echten Fehler dieser Stufe: der erste Freeze hashte Skript-Bytes **mit CRLF**, während `.gitattributes` diese Pfade auf `eol=lf` pinnt — der Hash wäre nach dem nächsten Checkout falsch gewesen, ohne dass es jemand sieht. Der Wächter steht jetzt im Code, nicht im Kopf.

---

## 6. OFFEN — OHNE GLÄTTUNG

1. **RR-4, PIT-feste Entity-Klasse: ungelöst.** Die Klassenspalte des blinden Inventars stammt aus dem **heutigen** SIC (`submissions.zip`) und ist zeitpunktlos; 211 Firmen tragen gar keinen. Die Regel benutzt sie, weil es keine andere gibt. Das ist im Freeze offen ausgewiesen. **Jede klassengebundene Regel — die Mehrheit in K7, das Stratum in K8 — hängt daran.** F1 kann das nicht schließen; es braucht eine Quelle, die die Klasse zum Signalzeitpunkt trägt.
2. **Auflage A8 ist unerledigt und gehört nicht zu F1.** Der Befund steht: `lib/sec-pit.js` liefert bei fehlendem `asOf` still `Infinity` statt abzubrechen — die Zeile ist inzwischen **`lib/sec-pit.js:231`**, nicht mehr 206. Kein F1-Skript importiert diese Datei; die Auflage trifft die blinden Vormessungen (V2/V2′), die den Leser benutzen. **Nicht angefasst**, weil einer ihrer Importeure (`scripts/d2-submissions-bulk.js`) laut ENTSCHIED 121 von einer anderen Session beansprucht ist und ein gemeinsam genutztes Modul kein Ort für einen Seitenschritt ist.
3. **Z3b ist eine Ableitung, kein Zitat.** Sie ist begründet (§3) und getestet, aber sie steht nicht wörtlich in P2. Wer die Regel prüft, sollte hier zuerst hinsehen.
4. **Der Zensus deckt 48 Quartale eines Jahrgangs.** Die heutige Neuveröffentlichung wurde in F1 **nicht** gezählt; die Aussagen gelten für `legacy_earliest_archived`.
5. **Ein roter Fremdtest in der CI, reproduziert und weitergereicht.** `tests/early-detection-foundation.test.js` fällt sporadisch mit *„self-test FSD replay should reuse the immutable payload"*. Ursache reproduziert: `make_test_fsd()` (`scripts/early-detection-foundation.py:784-789`) baut die Fixtur-ZIP ohne festes `ZipInfo`, `writestr` stempelt die aktuelle Uhrzeit, ZIP speichert mtime mit 2-Sekunden-Raster — zwei Aufrufe über eine Grenze hinweg ergeben andere Bytes und damit einen zweiten Blob. **Nicht von F1 verursacht, nicht in F1 repariert** (Kern-Studienskript außerhalb des Auftrags), als eigene Aufgabe abgelegt.

**Was F1 ausdrücklich NICHT getan hat:** keine Lückenliste, keine `s0-*`-Datei, keine E4g/E4h-Berichtstexte über die Zitate des Urteils hinaus, kein `outcome-access-ledger.json`, keine Panel-Datei geöffnet, kein Endtest-Quartal berührt, keine Zählprobe auf dem versiegelten Fenster (K11 ist vor F2/F3 mit 4:0 ausgeschlossen). **F2 ist nicht meine Stufe; hier ist Schluss.**

---

## 7. NEUE FRAGEN UND HYPOTHESEN

Aus F1 sind fünf Fragen entstanden, die vorher nicht auf dem Tisch lagen. Keine davon ist hier beantwortet, und keine ist eine Empfehlung.

1. **Wie viele weitere Negativ-Befunde des Pakets ruhen auf einer einzigen Suchachse?** Der Trägerbefund war acht Stunden lang falsch, weil eine korrekt ausgeführte Suche auf der einen Achse suchte, auf der der Gegenstand unsichtbar ist. Auflage A13/W9 verlangt die Achsenliste bereits für jede „Quelle X trägt Y nicht"-Aussage — **die Trägerfrage war formal keine solche Aussage und fiel deshalb durch das Raster**. Hypothese: W9 muss auf jede Existenz-Negation ausgedehnt werden, nicht nur auf Quellen-Aussagen.
   - VORSCHLAG: Sweep über die Negativ-Behauptungen der Akte, je Behauptung die geprüften Achsen nachtragen — 0,5 Tage.
2. **Ist `EARLY_DETECTION_DATA_ROOT` reproduzierbar gesetzt, oder hängt es an der jeweiligen Sitzung?** Die Variable war auf dieser Maschine nicht gesetzt, obwohl der Speicher lag. Solange das so bleibt, wird derselbe Fehlschluss wieder passieren. Hypothese: die Wurzel gehört in eine Datei, die jeder Lauf liest, nicht in eine Shell-Umgebung — ohne den absoluten Pfad in ein Artefakt zu schreiben (R12a).
   - VORSCHLAG: Entwurf für eine maschinenlokale, nicht versionierte Wurzel-Datei plus Fehlermeldung, die auf sie zeigt — 0,5 Tage.
3. **Trägt der Alt-Jahrgang seine Dimensionszeilen wirklich nur über `coreg`?** Die gemessenen Verhältnisse roh/konsolidiert liegen im Archiv bei 1,02–1,53, in der heutigen Neuveröffentlichung bei bis zu 11,3. Das ist mit der fehlenden `segments`-Spalte erklärbar — **aber nicht gemessen**. Wenn der Alt-Jahrgang Segmentzeilen führt, die er nicht als solche kennzeichnet, zählte das Panel sie als Konzernzeilen, und zwar seit jeher.
   - VORSCHLAG: Gegenüberstellung derselben Einreichung in beiden Jahrgängen, Zeile für Zeile, auf zwei Quartalen — 0,5 Tage.
4. **Kann die Entity-Klasse überhaupt PIT-fest werden?** RR-4 verlangt eine Klasse zum Signalzeitpunkt. `sub.txt` trägt je Einreichung ein `sic`-Feld — das wäre eine filing-granulare, also zeitpunktfeste Quelle, die niemand bisher gegen den heutigen `submissions.zip`-SIC gehalten hat. Hypothese: die PIT-feste Klasse existiert bereits im Payload und muss nur gelesen werden.
   - VORSCHLAG: Abgleich `sub.txt.sic` gegen den heutigen SIC über zwei Quartale, blind, nur Zählungen — 0,5 Tage.
5. **Was kostet die Verbreiterung wirklich, jetzt ohne Neubezug?** Die K9-Preisspanne war für Ast (a-2) gerechnet. Ast (a-1) ist die Lage; die Spanne 8,5–14,5 Tage ist damit die einzige noch tragende, und auch sie ist nicht auf den heutigen Stand gerechnet.
   - VORSCHLAG: Preisrechnung für Ast (a-1) neu aufstellen, nachdem F2/F3 die Form entschieden haben — 0,5 Tage.

---

## 8. BLINDHEITS-ERKLÄRUNG

**Gelesen:** `_COURT-ZWEITQUELLE-2026-08-30.md` vollständig inkl. beider Orchestrator-Nachträge · `BAUPLAN-STUDIE-2.0-ENTWURF-2026-08-30.md` · `k1-restkanaele-messung-2026-08-30.md` · `k9-restschluss-2026-08-30.md` · `konzept-inventar-blind-2026-08-30.json` + `.md` · `protocol/early-detection/2.0.0/provenance-closure.json` · Kopfbereiche von `studie-panel-bau.py`, `studie-basisraten.py`, `preregistration.json` (Feld `umsatzQuellenAllowlist`) · `early-detection-sec-wayback.py`, `early-detection-foundation.py` · `lib/sec-pit.js` (eine Zeile) · `.gitattributes` · `scripts/test-gate.js` · die DERA-Payload-Bytes bis 2020q4 (öffentliche SEC-Daten) · `VIEW.json` des Sichtkastens.

**Nicht geöffnet, nicht gesucht, nicht abgeleitet:** jede `s0-*`-Datei · jede Lücken- oder Fehlfirmen-Liste · `E4g`/`E4h`-Berichtstexte über die Zitate des Urteils hinaus · `outcome-access-ledger.json` · `panel-entdeckung.sqlite` und `panel-validierung.sqlite` (als Dateinamen im Trägerbefund gezählt, **nicht geöffnet**) · das Endtest-Fenster 2021q1–2024q4 in jeder Form · Signalwerte, Outcomes, Allowlists · `data/lockbox` in jeder Form.

**Geschrieben:** `scripts/studie-f1-*.py`, `tests/studie-f1-datenfundament.test.js`, `reports/studie/f1-*` sowie die Datenwurzel außerhalb des Repos. **Kein Register-Eintrag, kein Ledger-Eintrag, kein Siegel berührt, keine Datei gelöscht.** Netzabrufe: 48, alle gratis, alle gegen registrierte URLs, alle mit höflichem User-Agent.

---

**Ende.** Vorzulegen an: Orchestrator (F1-Ende, Freeze-Hash vor F2). Kein Beschluss, keine Empfehlung enthalten.
