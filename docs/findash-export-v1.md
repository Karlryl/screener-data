# findash-export v1 — Datenvertrag (Task 1.1)

> **Schema-String:** `findash-export/v1` (Feld `schema` auf JEDER Datei).
> **Status:** 1.1 umgesetzt; **1.2 ergaenzt `profitTier` + `ipoYear`** (real emittiert); **2.13 #23 ergaenzt `coverageAxes` + `coverageWeight`** (optional additiv, score-inert); **2.10 ergaenzt `cohortN` + `cohortFallback`** (Pflicht, `--check`-geprueft, Tamper→exit1); **2.11 Stufe A ergaenzt `scoreBase` + `scoreShrunk` + `factors`** (optional additiv, Score-Herkunft); **2.7 ergaenzt `axisBreakdown`** (optional additiv, Achsen-Beitrag je Zeile). Nur `currency` bleibt RESERVIERT.
> **Quelle der Wahrheit:** Engine-Output `outputs/hypergrowth/*.json` (score.js / run-screener.js). Der Writer kopiert NUR echte Engine-Felder + ein abgeleitetes `rank`. Kein erfundenes Feld.
> **Publiziert:** ausschliesslich nach gh-pages (`outputs/` ist gitignored). Der Dashboard-Consumer liest von der gh-pages-URL, nie von main.

---

## 0. Warum es diesen Vertrag gibt

Das Dashboard (findash-Cockpit) bindet an eine **stabile, versionierte** Form. Der Engine-Output (`outputs/hypergrowth/`) ist ein internes Rechen-Artefakt und darf sich frei aendern; dieser Export ist die **eingefrorene Aussenschnittstelle**.

Bricht das Schema still (fehlendes Feld, falscher Typ, kaputter Enum), zeigt das Dashboard falsche Daten ohne Warnung. **Dagegen steht der Schema-Check-Step (rotes X, Karls einziger Alarm-Kanal).** Damit dieses Versprechen echt ist, muss der Check JEDES Pflicht-Feld auf **Praesenz UND Typ/Enum** pruefen — sonst ist der Alarm-Kanal eine Attrappe.

**Vertrags-Garantie (verifiziert gegen echte `outputs/hypergrowth/*` via materialisiertem Writer):** Der `--check`-Step blockt den Deploy (exit 1) bei jedem der folgenden Brueche auf einer beliebigen der 15 Dateien: fehlendes Pflicht-Feld, falsch getyptes Feld (Zahl statt String, String statt Zahl, NaN/Infinity), kaputter Enum-Wert (`track`, `phase`, `mcapBand`, `ipoRecency`, `overview.kind`/`overviewKind`, `coverage.status`), fehlendes/falsch getyptes Huellen-Feld (`schema`, `generated_at`, `branch`, `coverage`), verletzte Meta-Struktur (`index`). Empirisch: 22 Bruch-Varianten getestet, davon der 4-fach-gleichzeitige Bruch auf `energy.json` (branch entfernt + country entfernt + sector=42 numerisch + overview.companion='X') => **exit 1, Deploy geblockt** (frueher: exit 0).

**Konvention der Pflicht-Semantik:**
- **Pflicht** = Schluessel muss existieren UND den geforderten Typ/Enum haben (nicht null, ausser explizit "nullable").
- **Pflicht (nullable)** = Schluessel muss existieren und ist entweder `null` oder der geforderte Typ/Enum. **Abwesenheit des Schluessels ist ein Bruch**, `null` ist es nicht.
- **optional / reserviert** = darf fehlen; Abwesenheit ist vertragskonform ("nicht verfuegbar").

---

## 1. Dateien (alle unter `outputs/findash-export/v1/`)

| Datei | Inhalt | Laenge |
| --- | --- | --- |
| `<branche>.json` (12) | Ein Board je Branche: `{branch, profitable[], unprofitable[]}` | topN=100 je Track (score-desc) |
| `overview.json` | Flaches Cross-Branch-Top nach Score | ~200 (topN*2) |
| `survival.json` | Flaches Pre-Revenue-Board nach Runway | 73 (ungekappt) |
| `index.json` | Meta/Zaehlung + Coverage-Banner-Marker | 1 Objekt |

Die 12 Branchen (formulaId): `consumer-discretionary, consumer-staples, energy, financials, health-care, industrials, it-services, materials, real-estate, semiconductors, software-comm-services, utilities`.

**NICHT im Export:** `outputs/hypergrowth/calib/<branche>.json` (Achsen-Perzentile) bleibt getrennter Diagnostik-Kanal — siehe §6.

---

## 2. Gemeinsame Datei-Huelle (jede der 15 Dateien)

| Feld | Typ | Pflicht | Geprueft vom `--check` | Bedeutung |
| --- | --- | --- | --- | --- |
| `schema` | `"findash-export/v1"` | Pflicht | ja (String-Gleichheit) | Versions-Pin. Aenderung nur per v2-Bump (§7). |
| `generated_at` | string (ISO-8601) | Pflicht | ja (Typ string) | Build-Zeit des Writers. |
| `coverage` | `{status,degraded,blocked,coverage_pct}` \| null | Pflicht (Wert nullable) | ja (Schluessel-Praesenz + Objekt-Typen) | Durchgereicht aus `outputs/coverage-status.json`. `null` = Marker fehlte (Consumer liest als "unbekannt"). |

`coverage`-Objekt (wenn nicht null), alle Felder geprueft:

| Sub-Feld | Typ | Pflicht |
| --- | --- | --- |
| `status` | `'ok'`\|`'degradiert'`\|`'katastrophal'` (Enum) | Pflicht |
| `degraded` | boolean | Pflicht |
| `blocked` | boolean | Pflicht |
| `coverage_pct` | number (finite) | Pflicht |

Treibt das Degradiert-Banner im Dashboard. **Faellt `coverage` still weg oder wird `status` kaputt** (real relevant: aktuell `status='degradiert'`, `coverage_pct` 20.1), blockt der Check den Deploy — genau der stille Datenbruch, gegen den §0 den Gate positioniert.

---

## 3. Board-Datei `<branche>.json`

Zusaetzlich zur Huelle (§2):

| Feld | Typ | Pflicht | Geprueft | Bedeutung |
| --- | --- | --- | --- | --- |
| `branch` | string (= Dateiname) | Pflicht | ja (Typ string UND `=== <dateiname>`) | Branchen-ID (= formulaId, = Dateiname). Implizit im Board, hier explizit gemacht. |
| `boardStatus` | `'core'` \| `'diagnostic'` | Pflicht | ja (Enum) | **Court-Standing des Boards** (Quelle `src/scoring/board-status.js`, Vault-Ledger §2.1). `core` = Court-PASSED/bewiesen; `diagnostic` = gebaut, aber Court NICHT bestanden → laeuft sichtbar als „unbewiesen" mit, zaehlt nicht als geprueft (Board-NO-GO-Ausweg). Das Dashboard (1.3) MUSS `diagnostic`-Boards sichtbar als unbewiesen kennzeichnen. Aktuell `diagnostic`: consumer-staples, materials, real-estate, it-services. |
| `profitable` | Array\<BoardRow\> | Pflicht | ja (Array + jede Zeile) | Track `profitable`, score-desc, topN=100. |
| `unprofitable` | Array\<BoardRow\> | Pflicht | ja (Array + jede Zeile) | Track `unprofitable`, score-desc, topN=100 (kann `[]`). |

### BoardRow — jedes Pflicht-Feld wird vom `--check` auf Praesenz+Typ/Enum geprueft

| Feld | Typ | Pflicht | Geprueft | Bedeutung / Herkunft |
| --- | --- | --- | --- | --- |
| `rank` | int ≥ 1 | Pflicht | ja (Integer ≥ 1) | **Abgeleitet** = Array-Index+1. Die Engine hat KEIN rank-Feld; Rang war nur implizit ueber score-desc-Sortierung. Der Export macht ihn explizit. |
| `ticker` | string (nichtleer) | Pflicht | ja | z.B. `"NVDA"`. |
| `score` | number (round1, finite) | Pflicht | ja (finite) | Anzeige-gerundet, z.B. `88.2`. Sortier-Determinismus lag intern an `_raw` (nicht im Output) — daher ist `rank` die verbindliche Reihenfolge, nicht `score`-Vergleich. |
| `track` | `"profitable"` \| `"unprofitable"` (Enum) | Pflicht | ja (Enum) | |
| `lamps` | string[] | Pflicht | ja (Array) | z.B. `["peakMargin","cyclePeak"]`, kann `[]`. |
| `overview` | Objekt \| null | Pflicht (Wert nullable) | ja (Schluessel-Praesenz; wenn Objekt: alle Sub-Felder) | VERSCHACHTELT (im Gegensatz zu overview.json). |
| `overview.kind` | `"gp"`\|`"revenue-badge"`\|`"ffo-badge"`\|`"runway-badge"` (Enum) | wenn overview≠null | ja (Enum gegen die 4 Werte) | In Boards nur `gp`/`revenue-badge`/`ffo-badge` beobachtet; `runway-badge` schema-erlaubt. |
| `overview.value` | number \| null | wenn overview≠null | ja (finite\|null) | **KANN NEGATIV sein** (z.B. `-0.055`, `-1.17` = YoY-Schrumpfung). |
| `overview.companion` | number (round1) \| null | wenn overview≠null | ja (finite\|null) | Rule-of-X-Companion, z.B. `195.3`; kann `null`. |
| `country` | string \| null | Pflicht (nullable) | ja (Praesenz + string\|null) | z.B. `"United States"`, `"Taiwan"`. |
| `region` | string \| null | Pflicht (nullable) | ja (Praesenz + string\|null) | z.B. `"North America"`, `"Asia"`, `"Europe"`. |
| `sector` | string \| null | Pflicht (nullable) | ja (Praesenz + string\|null) | Yahoo-Sektor (≠ formulaId-Branche!), z.B. `"Technology"`. |
| `marketCap` | number \| null | Pflicht (nullable) | ja (Praesenz + finite\|null) | Roh, ungerundet (z.B. `5457368842240` oder `26183936833.024`). **Ohne Currency-Tag** (siehe RESERVIERT). |
| `phase` | `"inflected"`\|`"established"`\|`"unprofitable"` \| null | Pflicht (nullable) | ja (Praesenz + Enum\|null) | Nur ueber Gewinn-Vorzeichen. **Real nullable** (3 Board-Rows null beobachtet). |
| `mcapBand` | `"micro"`\|`"small"`\|`"mid"`\|`"large"`\|`"mega"` \| null | Pflicht (nullable) | ja (Praesenz + Enum\|null) | Data-learned Quintil. |
| `ipoRecency` | `"recent"`\|`"growth"`\|`"seasoned"`\|`"veteran"`\|`"mature"` \| null | Pflicht (nullable) | ja (Praesenz + Enum\|null) | Data-learned Quintil. **Real nullable** (8 Board-Rows null beobachtet). |
| `profitTier` | `"nicht-profitabel"`\|`"kurz-vor-profitabel"`\|`"seit-kurzem-profitabel"`\|`"langfristig-profitabel"` \| null | Pflicht (nullable) | ja (Praesenz + Enum\|null) | **Task 1.2** (Karl B3). 4 lueckenlos kachelnde Stufen aus dem Yahoo-JAHRES-Stream (≥4 Perioden fuer „langfristig") + Quartals-Trajektorie. Deskriptiv, KEIN Score-Einfluss. Quelle `src/scoring/profit-tier.js`. `null` = zu wenig Daten. |
| `ipoYear` | number \| null | Pflicht (nullable) | ja (Praesenz + finite\|null) | **Task 1.2** — Boersen-IPO-Jahr (`meta.ipoYear` bzw. Jahr aus `firstTradeDate`), nur durchgereicht (nicht neu berechnet). Ergaenzt das abgeleitete `ipoRecency`-Quintil um die Rohzahl. |
| `coverageAxes` | string `"n/m"` \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`, Auflage B1) | **Task 2.13 #23** — present-Leitachsen / Achsenzahl der Formel (z.B. `"5/7"`). „Ausweisen statt verrechnen": macht sichtbar, dass ein Name auf weniger Achsen gerankt wurde (UK/AU/JP duenner als US). **KEIN Score-Einfluss** (der Score ist per C4-Shrinkage schon fair). Quelle `src/scoring/score.js`. |
| `coverageWeight` | number `[0,1]` \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`) | **Task 2.13 #23** — C4-Achsen-Gewichts-Coverage (1.0 = alle Achsen present, data-learned Shrink-Faktor). `n/n` ⇔ `1.0`. Reine Anzeige-Rohzahl zu `coverageAxes`. |
| `cohortN` | number (finite) | **Pflicht** | ja (Praesenz + finite) | **Task 2.10** — Groesse der Kohorte (formulaId\|track), gegen die dieser Name perzentiliert wurde. Ehrliche n-Ausweisung fuer die Anzeige: „Score 87 (n=424)" vs. „Score 71 (n=3 ⚠)". Auf gescorten Board/Overview-Zeilen IMMER eine finite Zahl (auf `survival.json` null, da nie gescort). Quelle `src/scoring/score.js`. |
| `cohortFallback` | boolean | **Pflicht** | ja (Praesenz + boolean) | **Task 2.10** — `true`, wenn die Kohorte < 15 Namen hatte und die Achsen gegen die ELTERN-Kohorte (Branche ueber beide Tracks) perzentiliert wurden (n-Ceiling-Reparatur, „unvergleichbare" Mini-Kohorten-Perzentile vermieden). Transparenz-Flag; `false` fuer ausreichend grosse Kohorten. |
| `scoreBase` | number \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`) | **Task 2.11 Stufe A** — der ROHE Perzentil-Score VOR EB-Shrinkage/C4/Post-Faktoren (Score-Herkunft; Nordstern „nachvollziehbare Begruendung"). Quelle `src/scoring/score.js`. |
| `scoreShrunk` | number \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`) | **Task 2.11 Stufe A** — Score NACH EB-Shrinkage + C4-Coverage-Shrinkage, VOR den Post-Faktoren. Die Shrinks sind affin (Richtung 50/Median), daher als Zwischenzahl statt Ratio ausgewiesen (robust bei scoreBase≈0). |
| `factors` | `{burn,growth,cycle}` (je number\|null) \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`) | **Task 2.11 Stufe A** — die 3 ECHTEN multiplikativen Post-Faktoren (burnPress/growthBoost/cycleDamper). **Rang-identisch rekonstruierbar:** `score ≈ scoreShrunk·burn·growth·cycle` (Test `score-breakdown.test.js`). |
| `axisBreakdown` | `[{key,pct,weight}]` \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`) | **Task 2.7 (Score-Transparenz)** — je Achse der Perzentil-Beitrag `pct` (0–100, `null` = gedroppt/renorm-on-drop) + `weight`. Der Nordstern verlangt „nachvollziehbare Begründung": `scoreBase` == gewichtetes Mittel der present-Achsen. Quelle `src/scoring/score.js`. |
| `ath` | `{distancePct,athDate,monthsAgo}` \| null | **OPTIONAL (additiv)** | FORM ja (wenn present: distancePct finite, athDate ISO, monthsAgo ≥ 0), Anwesenheit NEIN | **Task 2.2 (Karl-A6-Lösung)** — Abstand zum ALLZEIT-Hoch als reine **Anzeige** (nie Score-Input, Grundgesetz 1). `distancePct` = lastClose/ATH−1 in % (≤ 0 unter ATH; währungsfrei, Verhältnis in Handelswährung), `monthsAgo` = Monate seit ATH. **Semantik (dokumentierte Abweichung, L7):** ATH = höchster **adjustierter Tagesschluss** (A7-b-Preis-Vertrag: nur Closes, adjclose) — Chart-Spitzen (Intraday-Dochte, z. B. TradingView-52w-Hoch) liegen typisch 1–3 % darüber; bei Dividenden-Zahlern weicht die adjustierte Serie zusätzlich vom nominalen Chart ab (im Growth-Universum selten relevant). Verifiziert 14.07.: lastClose NVDA/CRDO/AAPL auf den Cent identisch mit externen Quotes; NVDA-ATH in korrekter Post-10:1-Split-Skala (235,47 close-basiert vs 236,54 Intraday-52w-Hoch = −0,45 %). Quelle: `external-data/ath-state.json` (committeter Vertrag; geseedet vom **lokalen** Max-Batch `scripts/backfill-prices-max.js` — die Max-Historie `prices-max/` liegt per GG7c AUSSERHALB des CI-Checkouts; täglich billig fortgeschrieben via `scripts/update-ath-state.js` aus dem 400d-Store). `null` = nicht geseedet ODER Split-Wächter aktiv (adjclose-Re-Basierung erkannt → ehrlich aus statt falsch, bis der lokale Batch `--only-stale` neu seedet). |

---

## 4. `overview.json` (FLACH)

Huelle (§2) + `rows: Array<OverviewRow>`. Cross-Branch, score-desc, ~200 Zeilen.

**Bewusst flach** — `overviewKind/Value/Companion` einzeln statt `row.overview`-Objekt, plus `formulaId`. Das spiegelt die Engine-Form exakt; ein Umbau auf verschachtelt waere ein v2-Bruch.

### OverviewRow — jedes Pflicht-Feld geprueft

| Feld | Typ | Pflicht | Geprueft | Bedeutung |
| --- | --- | --- | --- | --- |
| `rank` | int ≥ 1 | Pflicht | ja (Integer ≥ 1) | Abgeleitet (Index+1). |
| `ticker` | string (nichtleer) | Pflicht | ja | |
| `formulaId` | string (nichtleer) | Pflicht | ja | Branchen-ID (nur hier als Feld; in Boards implizit ueber Datei). |
| `track` | `"profitable"`\|`"unprofitable"` (Enum) | Pflicht | ja (Enum) | **Meistgelesene Cross-Branch-Liste — der Enum-Bruch bei `track` wird hier erkannt.** |
| `score` | number (round1, finite) | Pflicht | ja (finite) | z.B. `94.9`. |
| `overviewKind` | `"gp"`\|`"revenue-badge"`\|`"ffo-badge"`\|`"runway-badge"` \| null | Pflicht (nullable) | ja (Praesenz + Enum\|null) | Wie board `overview.kind`, aber FLACH. |
| `overviewValue` | number \| null | Pflicht (nullable) | ja (Praesenz + finite\|null) | KANN NEGATIV. |
| `overviewCompanion` | number \| null | Pflicht (nullable) | ja (Praesenz + finite\|null) | |
| `lamps` | string[] | Pflicht | ja (Array) | Kann `[]`. |
| `country/region/sector/marketCap/phase/mcapBand/ipoRecency/profitTier/ipoYear` | wie BoardRow §3 | Pflicht (nullable) | ja (jedes einzeln, Praesenz + Typ/Enum\|null) | Volle geo-Felder (inkl. 1.2 `profitTier`+`ipoYear`). |

---

## 5. `survival.json` (FLACH, Sonderform)

Huelle (§2) + `rows: Array<SurvivalRow>`, 73 Zeilen, **runway-desc nulls-last**, ungekappt.

**Sonderform:** Pre-Revenue-Namen laufen NIE durch Scoring — es gibt **kein `score`, kein `track` profitable/unprofitable, kein `overview.kind`**. Stattdessen `runwayQuarters`. Der Check prueft hier bewusst KEIN `score`/`track` (existieren nicht), aber `rank`, `runwayQuarters` und alle 7 geo-Felder.

### SurvivalRow — jedes Pflicht-Feld geprueft

| Feld | Typ | Pflicht | Geprueft | Bedeutung |
| --- | --- | --- | --- | --- |
| `rank` | int ≥ 1 | Pflicht | ja (Integer ≥ 1) | Abgeleitet (Index+1), = Runway-Rang. |
| `ticker` | string (nichtleer) | Pflicht | ja | z.B. `"PAH3.DE"`. |
| `runwayQuarters` | number \| null | Pflicht (nullable) | ja (Praesenz + finite\|null) | Runway in Quartalen. **`9999` = Sentinel fuer quasi-unendlichen Runway** (pre-revenue mit Cash-Ueberdeckung). Sortierschluessel. **Real nullable** (3 von 73 Rows null). |
| `lamps` | string[] | Pflicht | ja (Array) | z.B. `unprofit/lowRoic/burning/burnAccelerating/crashRisk/shortRunway`, kann `[]`. |
| `country/region/sector/marketCap/phase/mcapBand/ipoRecency/profitTier/ipoYear` | wie BoardRow §3 | Pflicht (nullable) | ja (jedes einzeln, Praesenz + Typ/Enum\|null) | Volle geo-Felder (inkl. 1.2 `profitTier`+`ipoYear`). Ein typ-falsches geo-Feld (z.B. `marketCap='GARBAGE'`, `phase='zombie'`) blockt jetzt den Deploy. |

---

## 6. `index.json` (Meta)

Huelle (§2) +:

| Feld | Typ | Pflicht | Geprueft | Bedeutung |
| --- | --- | --- | --- | --- |
| `generatedFromSnapshots` | number (finite) | Pflicht | ja | z.B. `4681`. Wie viele Snapshots in den Lauf gingen. |
| `branches` | string[] (Laenge 12) | Pflicht | ja (Array + Laenge===12) | Sortiert. **Haerte-Hinweis:** die Laenge-12-Pruefung ist an die Nebenannahme gekoppelt, dass alle 12 Branchen geroutete Zeilen haben (run-screener.js baut `branches` aus `Object.keys(ranked.branches)`). Real 12/12; faellt eine Branche komplett aus, schlaegt der Gate mit `index: branches` fehl — bewusste konservative Haerte, hier als Invariante dokumentiert. |
| `boardStatus` | `{[branche]: 'core'\|'diagnostic'}` | Pflicht | ja (Map-Praesenz + jeder Wert Enum) | Zentrale Court-Standing-Map aller 12 Boards (= das Board-Datei-Feld `boardStatus`, hier gebuendelt). Das Dashboard joint Overview-Zeilen per `formulaId` gegen diese Map, um `diagnostic`-Namen zu badgen. Quelle `src/scoring/board-status.js`, Ledger §2.1. |
| `counts` | `{[branche]: {profitable:int, unprofitable:int}}` | Pflicht | ja (Objekt-Praesenz) | **ECHTE Kohorten-Counts** (ganze Population), NICHT die topN-Anzeigeliste. |
| `survivalCount` | number (finite) | Pflicht | ja | z.B. `73`. |
| `excluded` | `{[grund]: count}` | Pflicht | ja (Objekt-Praesenz) | Ausschluss-Gruende, z.B. `{"non-us":326,"balance-sheet-bank":305,...}`. Gruende: `balance-sheet-bank, data-suspect, dup-issuer, insurer, lender-gp0, mortgage-reit, no-axes, no-sector, non-operating-rev, non-us, telecom`. |

### Achsen-Coverage — bewusst NICHT im Board-Vertrag

Die 8 Achsen-Perzentile (`revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution`) stehen NUR in `outputs/hypergrowth/calib/<branche>.json` unter `rows[].pct` — getrennter Diagnostik-Kanal, **nicht Teil des v1-Board-Vertrags**. `coverageWeight` (scoring-internes Shrinkage) wird gar nicht emittiert. Falls das Dashboard Achsen-Coverage braucht, ist das ein **eigener v1.1-Zusatz-Feed** (`axes.json`), kein stiller Einbau in BoardRow — sonst v2-Bruch.

---

## RESERVIERTE Felder (existieren NICHT in 1.1 — nicht faelschen)

| Feld | Status 1.1 | Wann |
| --- | --- | --- |
| `profitTier` | ✅ **UMGESETZT in 1.2** — reales 4-Stufen-Enum-Feld, siehe §3/§4/§5. (War in 1.1 reserviert.) | erledigt (Tag 264) |
| `currency` | KEIN Feld. `marketCap` ist roh ohne Currency-Tag; der Snapshot fuehrt keine `price.currency`. Achsen sind waehrungs-invariant, aber `marketCap`-Vergleichbarkeit ueber Laender ist ungeloest. | 1.2 — MUSS geloest werden bevor Cross-Country-marketCap-Ranking im Dashboard erscheint. |
| `ipoYear` | ✅ **UMGESETZT in 1.2** — Boersen-IPO-Jahr durchgereicht, reales `number\|null`-Feld, siehe §3. (War in 1.1 reserviert.) | erledigt (Tag 264) |
| `axes` (pro Board-Row) | EXISTIERT NICHT in Boards. Nur im calib-Diagnostik-Kanal. | Optionaler Zusatz-Feed, nicht in BoardRow. |

**Regel:** Ein reserviertes Feld wird erst emittiert, wenn die Engine es echt liefert. Bis dahin ist "abwesend" die vertragskonforme Aussage — der Consumer behandelt fehlend als "nicht verfuegbar". Ein additives OPTIONALES Feld (nur hinzufuegen, nie bestehendes brechen) ist KEIN v2-Bump. Der `--check` prueft nur die Pflicht-Felder; ein spaeter additiv hinzugefuegtes optionales Feld loest KEINEN Bruch aus.

---

## 7. v2-Bump-Regel (explizit)

`schema` bleibt `findash-export/v1`, **solange NUR additiv geaendert wird**:

- **ERLAUBT in v1 (kein Bump):** ein NEUES optionales Feld hinzufuegen (z.B. `profitTier`, `ipoYear` [1.2], `coverageAxes`/`coverageWeight` [2.13 #23], `currency` sobald verfuegbar); einen neuen Enum-Wert ergaenzen, den der Consumer als "unbekannt" tolerieren kann. **Wird ein neuer Enum-Wert erlaubt, muss die entsprechende `VALID_*`-Liste im Writer erweitert werden**, sonst blockt der Check den legitimen neuen Wert faelschlich.
- **ERZWINGT v2-Bump (`schema: 'findash-export/v2'`):** ein Feld **umbenennen, entfernen, seinen Typ aendern** (z.B. `overview.value` von nullable-number auf number); die Verschachtelung aendern (overview.json flach → verschachtelt oder umgekehrt); die Semantik eines bestehenden Feldes aendern (z.B. `score` von round1 auf roh); den `runwayQuarters`-Sentinel `9999` neu belegen; einen Pflicht-Enum-Wert entfernen; ein bisher nullable-Pflichtfeld auf non-null verschaerfen.
- Bei v2: neue Datei `outputs/findash-export/v2/`, der v1-Ordner bleibt eine Migrationsphase lang parallel bestehen, damit das Dashboard umstellen kann. `SCHEMA`, die `VALID_*`-Enum-Listen und `validateFile()`/`validate*Row()` im Writer werden auf v2 gepinnt, der Selftest auf v2-Cases.

Faustregel: **Kann ein v1-Consumer die Datei ohne Code-Aenderung weiterlesen? → v1. Sonst → v2.**

---

## 8. Retention Grundgesetz 7 (Aufbewahrung)

**Teil a — "nur latest" (UMGESETZT in 1.1):** Der Writer schreibt ausschliesslich `outputs/findash-export/v1/` und ueberschreibt es atomar bei jedem Lauf. **Keine** datierte Historie, **kein** Anhaengen. Der Deploy-Step force-pusht denselben Pfad auf gh-pages — der Vorlauf wird ersetzt, nicht akkumuliert. Das haelt gh-pages und den Runner-Footprint konstant.

**Teil b — board-history (DOKUMENTIERT, ausserhalb CI, gebunden an Task 2.3):** Eine datierte Board-Historie (`findash-export/history/YYYY-MM-DD/`) fuer Zeitreihen-Analyse im Dashboard ist bewusst NICHT im CI-Writer. Grund: sie waechst monoton und wuerde gh-pages aufblaehen; sie gehoert in denselben Pfad-getrennten Mechanismus wie `picks-history/` (vom pull-Job/snapshot-picks bewirtschaftet, in main committet, nicht ueber den scoring-Loop). **Bindung:** wird mit Task 2.3 aktiviert, dann als separater Retention-Pfad mit eigenem Deckel (siehe §9), nie ueber diesen 1.1-Writer.

**Teil c — XBRL/prices-max (DOKUMENTIERT, ausserhalb CI, gebunden an 2.2/4.1):** Die tiefe Roh-Historie (SEC-XBRL-Serien, `prices/`-Vollhistorie) ist die Basis fuer spaetere Deep-Work-Achsen, gehoert aber NICHT in den findash-export. Sie wird von `pull-sec-xbrl.js` / `pull-historical-prices.js` in eigene, gitignored bzw. tracked-external Pfade geschrieben. **Bindung:** XBRL-Tiefe an Task 2.2 (EDGAR-Merge), prices-max an Task 4.1 (Preis-Historie). Der 1.1-Writer liest diese Quellen NICHT und darf sie nie als Zielpfad bekommen.

**Schutzliste (read-only fuer den 1.1-Writer, NIE Zielpfad):** `picks-history/`, `earnings-calendar.json`. Beide werden vom pull-Job bewirtschaftet; der scoring-Job laeuft auf frischem Runner und schreibt ausschliesslich unter `outputs/` — damit sind sie faktisch geschuetzt, aber der Writer dokumentiert sie explizit als read-only, um die Trennung zu zementieren.

---

## 9. Groessen-Budget (Jahres-Wachstum + Deckel)

**Pro Lauf (latest-only, Teil a):** ~1,3 MB (12 Boards + overview + survival + index; calib NICHT im Export). Da nur `latest` geschrieben und force-gepusht wird, ist der **stationaere gh-pages-Footprint konstant ~1,3 MB** — kein Jahres-Wachstum. Das ist der Sinn von Grundgesetz 7a.

**Geschaetztes Jahres-Wachstum FALLS Teil b (board-history) aktiviert wird:** ~1,3 MB/Lauf × ~250 Handelstage = **~325 MB/Jahr** (unkomprimiert; gzip auf gh-pages drueckt real auf ~50–80 MB/Jahr).

**Deckel: < 1 GB.** Board-History (Teil b) bekommt bei Aktivierung einen harten Retention-Deckel von **< 1 GB** — praktisch via rollierendem Fenster (aelteste datierte Ordner werden geloescht, sobald der Ordner-Gesamtstand 1 GB naehert, entsprechend ~3 Jahren unkomprimiert / deutlich mehr gzip). Der latest-only-Export (1.1) beruehrt diesen Deckel nie, weil er nicht akkumuliert. XBRL/prices-max (Teil c) haben eigene, groessere Budgets ausserhalb dieses Vertrags (an 2.2/4.1 gebunden).

---

## 10. `quality/` (QC-Board, DIAGNOSTIC) — additiver Feed (Task 3.2)

Der **Quality-Compounder-Screener** (QC-Board, gebaut Tag 290) laeuft parallel zum Hypergrowth-Screener und wird **additiv** in denselben v1-Vertrag aufgenommen — als Unterordner `outputs/findash-export/v1/quality/`. Kein v2-Bump: bestehende HG-Dateien/-Felder werden **nicht** angefasst. Quelle: `outputs/quality/*` (erzeugt von `src/scoring/run-screener.js::runQualityPass`).

### Dateien (unter `outputs/findash-export/v1/quality/`)

| Datei | Inhalt | Herkunft |
| --- | --- | --- |
| `<id>.json` (dynamisch, aktuell 11) | Ein QC-Board je Branche: `{schema, generated_at, branch, boardStatus, coverage, profitable[], unprofitable[]}` | `outputs/quality/quality-<id>.json` (Prefix `quality-` fallengelassen; `branch` = Dateiname-Stamm, z.B. `semiconductors`) |
| `overview.json` | Flaches Cross-Branch-QC-Top nach Score, `{…, rows: OverviewRow[]}` | `outputs/quality/overview.json` |
| `index.json` | Meta/Zaehlung: `{schema, generated_at, coverage, generatedFromSnapshots, boards, boardStatus, counts, excluded}` | `outputs/quality/index.json` |

**Board-Anzahl ist dynamisch** (aus den vorhandenen `quality-*.json` entdeckt, nicht hartkodiert) — heute 11 Boards (kein `survival`-Board; QC-Namen sind per Konstruktion profitabel, `unprofitable[]` meist `[]`). Der CI-Count-Check leitet die Soll-Zahl dynamisch ab (`#quality-*.json + overview + index`).

### Zeilenform = HG-Board-/Overview-Zeilenform (voll wiederverwendet)

QC-Board-Zeilen sind **byte-fuer-byte dieselbe `BoardRow`-Form wie §3** (verschachteltes `overview`, alle geo-Felder inkl. `profitTier`/`ipoYear`/`cohortN`/`cohortFallback`, optional `scoreBase`/`scoreShrunk`/`factors`/`axisBreakdown`). QC-`overview.json`-Zeilen sind die **flache `OverviewRow`-Form wie §4** (mit `formulaId`, hier `quality-`-praefigiert). Der Writer nutzt darum `mapBoardRow`/`mapOverviewRow` und die Validatoren `validateBoardRow`/`validateOverviewRow` **unveraendert** — kein Parallel-Validator. Die QC-`index.json` ist die HG-`index.json` **ohne** `branches`/`survivalCount` (QC hat kein Survival-Board und eine dynamische Board-Menge); dafuer gibt es einen kleinen dedizierten `validateQualityIndex`.

### `boardStatus`-Semantik: QC ist bis auf Weiteres IMMER `diagnostic`

Jedes QC-Board traegt `boardStatus: 'diagnostic'` — **per Konstruktion**, nicht per Hardcode: `src/scoring/board-status.js` gibt fuer jeden `quality-`-praefigierten Key `'diagnostic'` zurueck und kann ihn nie auf `'core'` promoten. Das Dashboard (1.3) MUSS QC-Boards sichtbar als **unbewiesen** kennzeichnen.

- **`--check`-Verhalten:** `boardStatus` wird gegen das **bestehende Enum** `['core','diagnostic']` geprueft (dieselbe `VALID_BOARDSTATUS`-Liste wie HG). D.h. ein manipuliertes `'core'` auf einer QC-Datei ist enum-legal und trippt **nicht**; ein **fehlendes** oder **bogus** `boardStatus` (und ein bogus Wert in der QC-`index`-`boardStatus`-Map) trippt (exit 1). Der Build-Zeit-Invariante „QC == diagnostic" wird zusaetzlich im `--selftest` asserted.
- **Core-Promotion** ist gated auf **ρ < 0,4 + rankIC** (QC-Rangkorrelation zum HG-Board niedrig genug, dass QC eigenstaendige Information traegt) — siehe **Masterplan 3.1**. Bis dieser Nachweis vorliegt, bleibt QC diagnostic.

### Optional-when-absent (kein stiller Weglass, kein Crash)

Fehlt `outputs/quality/` (alte lokale Laeufe ohne QC-Pass), schreibt der Writer **keine** `quality/`-Dateien und loggt eine **deutliche Warnung** (`::warning::`) — er crasht nicht und laesst nichts still weg. Der `--check` behandelt `quality/` als **optional-wenn-abwesend**: ohne `quality/index.json` auf Platte gibt es nichts zu pruefen (kein Bruch). **Sobald `quality/index.json` existiert**, sind alle darin gelisteten QC-Boards **plus** `overview.json` **Pflicht** und werden voll validiert (Zeilen wie `validateBoardRow`/`validateOverviewRow`, `boardStatus` gegen das Enum). Alle QC-Fehlermeldungen tragen ein `quality/`-Praefix, damit der Alarm-Kanal einen QC-Bruch nie mit einem HG-Bruch verwechselt.

### Bewusste Disclosure: leere Dauerhaftigkeits-Achse

Das QC-Achsenset enthaelt eine **Dauerhaftigkeits-/Stabilitaets-Achse `roicStability` mit Gewicht `w=0`** — sie ist derzeit **leer** (keine belastbare Zeitreihen-Basis fuer ROIC-Stabilitaet), traegt also **nicht** zum Score bei. Das ist eine **bewusste Offenlegung**, kein Bug: die Achse ist im Formel-Gerüst reserviert und wird erst gewichtet, wenn die Datenbasis steht. Sie erscheint (falls emittiert) in `axisBreakdown` mit `weight: 0` und ist score-inert.

### Retention / Deploy

`quality/` faellt unter dieselbe **Retention-Grundgesetz-7a**-Regel (§8): latest-only, atomar ueberschrieben, kein Anhaengen. Der Deploy-Step kopiert `outputs/findash-export/v1/.` rekursiv (`cp -r`) und nimmt den `quality/`-Unterordner damit automatisch mit — **keine** Aenderung am Deploy-Step noetig.