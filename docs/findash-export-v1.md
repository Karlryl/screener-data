# findash-export v1 — Datenvertrag (Task 1.1)

> **Schema-String:** `findash-export/v1` (Feld `schema` auf JEDER Datei).
> **Status:** 1.1 umgesetzt; **1.2 ergaenzt `profitTier` + `ipoYear`** (real emittiert); **2.13 #23 ergaenzt `coverageAxes` + `coverageWeight`** (optional additiv, score-inert); **2.10 ergaenzt `cohortN` + `cohortFallback`** (Pflicht, `--check`-geprueft, Tamper→exit1); **2.11 Stufe A ergaenzt `scoreBase` + `scoreShrunk` + `factors`** (optional additiv, Score-Herkunft); **2.7 ergaenzt `axisBreakdown`** (optional additiv, Achsen-Beitrag je Zeile). **Court-Auflage 27.07. ergaenzt `mcapBounds`** (optional additiv, auf Overview- und Board-DATEI-Ebene, nicht je Zeile: `[p20,p40,p60,p80]` in USD oder `null` — macht `mcapBand` lesbar, damit „mega" nicht nur „oberstes Fuenftel dieser Liste" heisst. Quelle sind die data-learned Quintil-Grenzen aus `outputs/calibration.json`, es wird NICHTS neu gerechnet. Fehlt die Datei oder ist das Feld unbrauchbar: `null`, und die Anzeige laesst die Spanne weg). **F-5 ergaenzt `revGrowthYoYPct`** (optional additiv, REINE ANZEIGE fuer die findash-Spalte "Umsatzwachstum": Quartals-Jahreswachstum in Prozent, aus den Rohreihen gerechnet wie die Achse `revGrowthLevel` — bewusst NICHT Yahoos `metrics.revenueGrowthYoY`, das wegen belegter Defekte am 14.07.2026 aus der Achse entfernt wurde; ungeklemmt, da Winsorisierung dem Ranking dient und in der Anzeige eine Verfaelschung waere. Kein Score-Input. Abdeckung auf dem Stand vom 26.07.2026: 418 von 421 Board-Zeilen = 99,3 %. ECHT optional: Abwesenheit des Feldes wird vom --check NICHT beanstandet, ein vorhandener Wert dagegen voll geprueft. Das ist bewusst so - Karls einziger Alarmkanal darf nicht an einem additiven Anzeigefeld rot werden). Nur `currency` bleibt RESERVIERT.
> **Quelle der Wahrheit:** Engine-Output `outputs/hypergrowth/*.json` (score.js / run-screener.js). Der Writer kopiert NUR echte Engine-Felder + ein abgeleitetes `rank`. Kein erfundenes Feld.
> **Publiziert:** ausschliesslich nach gh-pages (`outputs/` ist gitignored). Der Dashboard-Consumer liest von der gh-pages-URL, nie von main.

---

## 0. Warum es diesen Vertrag gibt

Das Dashboard (findash-Cockpit) bindet an eine **stabile, versionierte** Form. Der Engine-Output (`outputs/hypergrowth/`) ist ein internes Rechen-Artefakt und darf sich frei aendern; dieser Export ist die **eingefrorene Aussenschnittstelle**.

Bricht das Schema still (fehlendes Feld, falscher Typ, kaputter Enum), zeigt das Dashboard falsche Daten ohne Warnung. **Dagegen steht der Schema-Check-Step (rotes X, Karls einziger Alarm-Kanal).** Damit dieses Versprechen echt ist, muss der Check JEDES Pflicht-Feld auf **Praesenz UND Typ/Enum** pruefen — sonst ist der Alarm-Kanal eine Attrappe.

**Vertrags-Garantie (verifiziert gegen echte `outputs/hypergrowth/*` via materialisiertem Writer):** Der `--check`-Step blockt den Deploy (exit 1) bei jedem der folgenden Brueche auf einer beliebigen der 16 Dateien: fehlendes Pflicht-Feld, falsch getyptes Feld (Zahl statt String, String statt Zahl, NaN/Infinity), kaputter Enum-Wert (`track`, `phase`, `mcapBand`, `ipoRecency`, `overview.kind`/`overviewKind`, `coverage.status`), fehlendes/falsch getyptes Huellen-Feld (`schema`, `generated_at`, `branch`, `coverage`), verletzte Meta-Struktur (`index`). Empirisch: 22 Bruch-Varianten getestet, davon der 4-fach-gleichzeitige Bruch auf `energy.json` (branch entfernt + country entfernt + sector=42 numerisch + overview.companion='X') => **exit 1, Deploy geblockt** (frueher: exit 0).

**Konvention der Pflicht-Semantik:**
- **Pflicht** = Schluessel muss existieren UND den geforderten Typ/Enum haben (nicht null, ausser explizit "nullable").
- **Pflicht (nullable)** = Schluessel muss existieren und ist entweder `null` oder der geforderte Typ/Enum. **Abwesenheit des Schluessels ist ein Bruch**, `null` ist es nicht.
- **optional / reserviert** = darf fehlen; Abwesenheit ist vertragskonform ("nicht verfuegbar").

---

## 1. Dateien (alle unter `outputs/findash-export/v1/`)

| Datei | Inhalt | Laenge |
| --- | --- | --- |
| `<branche>.json` (13) | Ein Board je Branche: `{branch, profitable[], unprofitable[]}` | topN=100 je Track (score-desc) |
| `overview.json` | Flaches Cross-Branch-Top nach Score | ~200 (topN*2) |
| `survival.json` | Flaches Pre-Revenue-Board nach Runway | 73 (ungekappt) |
| `index.json` | Meta/Zaehlung + Coverage-Banner-Marker | 1 Objekt |

Die 13 Branchen (formulaId): `consumer-discretionary, consumer-staples, energy, financials, health-care, industrials, it-services, materials, real-estate, semiconductors, software-comm-services, tech-hardware, utilities`.

**NICHT im Export:** `outputs/hypergrowth/calib/<branche>.json` (Roh-Perzentil-Matrix ueber die GANZE Kohorte) bleibt getrennter Diagnostik-Kanal — siehe §6. Die Achsen-Perzentile der **exportierten** Zeilen stehen dagegen sehr wohl im Vertrag, per `axisBreakdown` (§3).

---

## 2. Gemeinsame Datei-Huelle (jede der 16 Dateien)

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
| `rank` | int ≥ 1 \| null | Pflicht (nullable) | ja (Integer ≥ 1 ODER null mit Grund) | **Abgeleitet** aus der score-desc-Reihenfolge. Die Engine hat KEIN rank-Feld; Rang war nur implizit ueber die Sortierung. Der Export macht ihn explizit. **Belegbarkeits-Gate (18.08.2026):** `null`, wenn die Zeile weniger als **4 belegte Messachsen** hat (`coverageAxes`) — dann steht der Grund in `rankGrund`. Die Zeile bleibt vollstaendig in der Liste (Score, Lampen, alle Felder) und verbraucht KEINE Rangnummer: die uebrigen Raenge laufen lueckenlos 1,2,3,… |
| `rankGrund` | `"zuWenigBelegteAchsen"` \| `"coverageUnbekannt"` \| null | **OPTIONAL (additiv)** | ja, beide Richtungen (`rank`=null ⇔ Grund gesetzt) | **Task Belegbarkeits-Gate (18.08.2026)** — warum die Zeile keinen Rang traegt. `zuWenigBelegteAchsen` = weniger als 4 von 7/8 Achsen belegt; `coverageUnbekannt` = `coverageAxes` fehlt oder ist unlesbar (ohne Beleg kein Rang — bewusst nicht durchgewunken). `null` = Rang vergeben. Abwesenheit des Feldes wird wie `null` gelesen. Score-inert: das Gate aendert keinen Score und keine Sortierung, nur die Rangnummer. |
| `ticker` | string (nichtleer) | Pflicht | ja | z.B. `"NVDA"`. |
| `name` | string \| null | **OPTIONAL (additiv)** | Form ja, wenn present; neuer Producer emittiert es immer | Bereinigter Emittentenname aus `snapshot.meta.name`; Rand-/Mehrfach-Whitespace wird normalisiert. Fehlend, leer oder nicht-string wird `null`. Alte v1-Daten ohne Feld bleiben consumer-kompatibel. Reine Anzeige, kein Score-/Rang-Einfluss. |
| `score` | number (round1, finite), **Spanne 0–100** | Pflicht | ja (finite) | Anzeige-gerundet, z.B. `88.2`. Sortier-Determinismus lag intern an `_raw` (nicht im Output) — daher ist `rank` die verbindliche Reihenfolge, nicht `score`-Vergleich. **Seit 19.08.2026 in DIESEM Feed bei 100,0 gedeckelt** — die Engine kann bis 105 liefern; Einzelheiten und der Grund fuer die zwei Skalen: §3a. |
| `track` | `"profitable"` \| `"unprofitable"` (Enum) | Pflicht | ja (Enum) | |
| `lamps` | string[] | Pflicht | ja (Array) | z.B. `["peakMargin","cyclePeak"]`, kann `[]`. Registry: `src/scoring/lamps.js` `LAMPS` (18 Lampen); ausgewiesen wird nur, was `true` ist (`evaluateLamps().active`) — `false` und `null` sind im Array nicht unterscheidbar. Die zwei juengsten Eintraege `opIncSynthetisch`/`opIncYahooAdjusted` sind der EINZIGE Weg, auf dem `meta.opIncSource` diesen Feed erreicht: §3c. |
| `overview` | Objekt \| null | Pflicht (Wert nullable) | ja (Schluessel-Praesenz; wenn Objekt: alle Sub-Felder) | VERSCHACHTELT (im Gegensatz zu overview.json). |
| `overview.kind` | `"gp"`\|`"revenue-badge"`\|`"ffo-badge"`\|`"runway-badge"` (Enum) | wenn overview≠null | ja (Enum gegen die 4 Werte) | In Boards nur `gp`/`revenue-badge`/`ffo-badge` beobachtet; `runway-badge` schema-erlaubt. |
| `overview.value` | number \| null | wenn overview≠null | ja (finite\|null) | **KANN NEGATIV sein** (z.B. `-0.055`, `-1.17` = YoY-Schrumpfung). |
| `overview.companion` | number (round1) \| null | wenn overview≠null | ja (finite\|null) | Rule-of-X-Companion, z.B. `195.3`; kann `null`. |
| `country` | string \| null | Pflicht (nullable) | ja (Praesenz + string\|null) | z.B. `"United States"`, `"Taiwan"`. |
| `region` | string \| null | Pflicht (nullable) | ja (Praesenz + string\|null) | z.B. `"North America"`, `"Asia"`, `"Europe"`. |
| `sector` | string \| null | Pflicht (nullable) | ja (Praesenz + string\|null) | Yahoo-Sektor (≠ formulaId-Branche!), z.B. `"Technology"`. |
| `marketCap` | number \| null | Pflicht (nullable) | ja (Praesenz + finite\|null) | Roh, ungerundet (z.B. `5457368842240` oder `26183936833.024`). **Immer USD** (seit 16.08. explizit ueber `marketCapCurrency`). **null auch dann, wenn die Umrechnung aus der Handelswaehrung nicht nachgewiesen ist** — Waehrungs-Waechter (Chunk 4a). |
| `marketCapCurrency` | `"USD"` \| null | additiv OPTIONAL (seit 16.08.) | ja, wenn present (Enum) | Die Einheit des FELDES `marketCap`, nicht die des Werts — im v1-Vertrag immer `"USD"`. Ein anderer Wert ist ein Vertragsbruch und blockt den Deploy. Abwesenheit bleibt legitim (Altbestands-Export). |
| `tradingFxRateApplied` | number \| null | additiv OPTIONAL (seit 16.08.) | ja, wenn present (finite\|null) | Der Kurs, mit dem die marketCap aus der HANDELS-Waehrung nach USD gebracht wurde (`meta.tradingFxRateApplied` des Snapshots). `null` = in USD gehandelt (nichts umzurechnen) oder Handel = Bericht. |
| `phase` | `"inflected"`\|`"established"`\|`"unprofitable"` \| null | Pflicht (nullable) | ja (Praesenz + Enum\|null) | Nur ueber Gewinn-Vorzeichen. **Real nullable** (3 Board-Rows null beobachtet). |
| `mcapBand` | `"micro"`\|`"small"`\|`"mid"`\|`"large"`\|`"mega"` \| null | Pflicht (nullable) | ja (Praesenz + Enum\|null) | Data-learned Quintil. |
| `ipoRecency` | `"recent"`\|`"growth"`\|`"seasoned"`\|`"veteran"`\|`"mature"` \| null | Pflicht (nullable) | ja (Praesenz + Enum\|null) | Data-learned Quintil. **Real nullable** (8 Board-Rows null beobachtet). |
| `profitTier` | `"nicht-profitabel"`\|`"kurz-vor-profitabel"`\|`"seit-kurzem-profitabel"`\|`"langfristig-profitabel"` \| null | Pflicht (nullable) | ja (Praesenz + Enum\|null) | **Task 1.2** (Karl B3). 4 lueckenlos kachelnde Stufen aus dem Yahoo-JAHRES-Stream (≥4 Perioden fuer „langfristig") + Quartals-Trajektorie. Deskriptiv, KEIN Score-Einfluss. Quelle `src/scoring/profit-tier.js`. `null` = zu wenig Daten. |
| `ipoYear` | number \| null | Pflicht (nullable) | ja (Praesenz + finite\|null) | **Task 1.2** — Boersen-IPO-Jahr (`meta.ipoYear` bzw. Jahr aus `firstTradeDate`), nur durchgereicht (nicht neu berechnet). Ergaenzt das abgeleitete `ipoRecency`-Quintil um die Rohzahl. |
| `coverageAxes` | string `"n/m"` \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`, Auflage B1) | **Task 2.13 #23** — present-Leitachsen / Achsenzahl der Formel (z.B. `"5/7"`). „Ausweisen statt verrechnen": macht sichtbar, dass ein Name auf weniger Achsen gerankt wurde (UK/AU/JP duenner als US). **KEIN Score-Einfluss** (der Score ist per C4-Shrinkage schon fair). Quelle `src/scoring/score.js`. |
| `coverageWeight` | number `[0,1]` \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`) | **Task 2.13 #23** — C4-Achsen-Gewichts-Coverage (1.0 = alle Achsen present, data-learned Shrink-Faktor). `n/n` ⇔ `1.0`. Reine Anzeige-Rohzahl zu `coverageAxes`. |
| `qPunkte` | int ≥ 0 \| null | **OPTIONAL (additiv)** | FORM ja, wenn present (ganzzahlig ≥ 0 \| null) | **Abhilfe A der Coverage-Akte (29.08.2026, Orchestrator ENTSCHIED 20)** — Anzahl der Quartale mit einem echten Umsatzwert (`snapshot.timeseries.revenueQ`, dieselbe Reihe, aus der `write-board-history.js` `pit.revenueQ` baut). **Warum es dieses Feld gibt:** `coverageAxes` zaehlt, wie viele Achsenfunktionen eine Zahl ZURUECKGEGEBEN haben — nicht, wie viele Rohdatenpunkte dahinterstanden. Die meisten Achsen liefern schon ab ZWEI Punkten einen Wert, deshalb kann eine Zeile `"7/7"` tragen und real auf zwei Quartalen ruhen (gemessen am Vintage 2026-08-29: 295 solche Zeilen; `7666.HK` steht mit `"7/7"` und zwei Quartalen auf Rang 7 des health-care-Boards). `qPunkte` stellt die Beleglage neben die Behauptung. **`null` heisst „nicht gemessen"** (kein Snapshot / kein Feld), NICHT „null Punkte" — eine erfundene 0 waere genau die Sorte Behauptung, die dieses Feld abschafft. **`0` heisst „kein QUARTALS-Beleg", nicht „keine Daten":** mehrere Achsen (`revGrowthLevel`, `revAcceleration`) haben einen JAHRES-Fallback, und Halbjahres-/Jahresmelder (HK/UK/SG) scoren genau darueber — am Vintage 2026-08-29 stehen 592 der 8.946 gescorten Zeilen bei `qPunkte: 0` und tragen trotzdem zu Recht einen Score. Wer das Feld als Datenluecken-Alarm liest, faerbt eine legitime Melde-Klasse falsch-rot. **Reine Anzeige:** kein Score-, kein Rang-, kein Gate-Einfluss; das Belegbarkeits-Gate prueft weiterhin `coverageAxes` (die Wurzel-Umstellung „rechenbar → belegt" in `src/scoring/score.js` ist versiegelt und braucht einen eigenen Gerichtstermin). Quelle `scripts/write-findash-export.js belegPunkte()`; Waechter `tests/belegpunkte.test.js`. |
| `qSpanTage` | number ≥ 0 \| null | **OPTIONAL (additiv)** | FORM ja, wenn present (finite \| null) | **Abhilfe A (29.08.2026)** — Tage zwischen aeltestem und juengstem DATIERTEN Quartalsende (`snapshot.timeseries.revenueQEnds`). Macht neben der ANZAHL auch die SPANNE der Belege lesbar: zwei Punkte 365 Tage auseinander sind eine Jahres-Kadenz, zwei Punkte 91 Tage auseinander echte Nachbarquartale. `null` = keine gueltigen Perioden-Enden (A10-Nachzuegler, ~6,6 % der Zeilen) — ohne Datum ist keine Spanne belegbar. Reine Anzeige wie `qPunkte`. **⚠ Die Kadenz-Zusage im vorigen Satz gilt NICHT — `qSpanTage` misst eine andere Menge als `qPunkte` (zwei unabhaengige Filter). Verbindlich ist §3b; dort steht, was das Feld wirklich misst.** |
| `cohortN` | number (finite) | **Pflicht** | ja (Praesenz + finite) | **Task 2.10** — Groesse der Kohorte (formulaId\|track), gegen die dieser Name perzentiliert wurde. Ehrliche n-Ausweisung fuer die Anzeige: „Score 87 (n=424)" vs. „Score 71 (n=3 ⚠)". Auf gescorten Board/Overview-Zeilen IMMER eine finite Zahl (auf `survival.json` null, da nie gescort). Quelle `src/scoring/score.js`. |
| `cohortFallback` | boolean | **Pflicht** | ja (Praesenz + boolean) | **Task 2.10** — `true`, wenn die Kohorte < 15 Namen hatte und die Achsen gegen die ELTERN-Kohorte (Branche ueber beide Tracks) perzentiliert wurden (n-Ceiling-Reparatur, „unvergleichbare" Mini-Kohorten-Perzentile vermieden). Transparenz-Flag; `false` fuer ausreichend grosse Kohorten. |
| `scoreBase` | number \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`) | **Task 2.11 Stufe A** — der ROHE Perzentil-Score VOR EB-Shrinkage/C4/Post-Faktoren (Score-Herkunft; Nordstern „nachvollziehbare Begruendung"). Quelle `src/scoring/score.js`. |
| `scoreShrunk` | number \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`) | **Task 2.11 Stufe A** — Score NACH EB-Shrinkage + C4-Coverage-Shrinkage, VOR den Post-Faktoren. Die Shrinks sind affin (Richtung 50/Median), daher als Zwischenzahl statt Ratio ausgewiesen (robust bei scoreBase≈0). |
| `factors` | `{burn,growth,cycle}` (je number\|null) \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`) | **Task 2.11 Stufe A** — die 3 ECHTEN multiplikativen Post-Faktoren (burnPress/growthBoost/cycleDamper). **Rang-identisch rekonstruierbar:** `score ≈ scoreShrunk·burn·growth·cycle` (Test `score-breakdown.test.js`). |
| `axisBreakdown` | `[{key,pct,weight}]` \| null | **OPTIONAL (additiv)** | NEIN (nicht im `--check`) | **Task 2.7 (Score-Transparenz)** — je Achse der Perzentil-Beitrag `pct` (0–100, `null` = gedroppt/renorm-on-drop) + `weight`. Der Nordstern verlangt „nachvollziehbare Begründung": `scoreBase` == gewichtetes Mittel der present-Achsen. Quelle `src/scoring/score.js`. |
| `ath` | `{distancePct,athDate,monthsAgo}` \| null | **OPTIONAL (additiv)** | FORM ja (wenn present: distancePct finite, athDate ISO, monthsAgo ≥ 0), Anwesenheit NEIN | **Task 2.2 (Karl-A6-Lösung)** — Abstand zum ALLZEIT-Hoch als reine **Anzeige** (nie Score-Input, Grundgesetz 1). `distancePct` = lastClose/ATH−1 in % (≤ 0 unter ATH; währungsfrei, Verhältnis in Handelswährung), `monthsAgo` = Monate seit ATH. **Semantik (dokumentierte Abweichung, L7):** ATH = höchster **adjustierter Tagesschluss** (A7-b-Preis-Vertrag: nur Closes, adjclose) — Chart-Spitzen (Intraday-Dochte, z. B. TradingView-52w-Hoch) liegen typisch 1–3 % darüber; bei Dividenden-Zahlern weicht die adjustierte Serie zusätzlich vom nominalen Chart ab (im Growth-Universum selten relevant). Verifiziert 14.07.: lastClose NVDA/CRDO/AAPL auf den Cent identisch mit externen Quotes; NVDA-ATH in korrekter Post-10:1-Split-Skala (235,47 close-basiert vs 236,54 Intraday-52w-Hoch = −0,45 %). Quelle: `external-data/ath-state.json` (committeter Vertrag; geseedet vom **lokalen** Max-Batch `scripts/backfill-prices-max.js` — die Max-Historie `prices-max/` liegt per GG7c AUSSERHALB des CI-Checkouts; täglich billig fortgeschrieben via `scripts/update-ath-state.js` aus dem 400d-Store). `null` = nicht geseedet ODER Split-Wächter aktiv (adjclose-Re-Basierung erkannt → ehrlich aus statt falsch, bis der lokale Batch `--only-stale` neu seedet). |
| `einmalertragPrognose` | `"bestaetigt"`\|`"eingebrochen"`\|`"nichtAnwendbar"`\|`"nichtPruefbar"` \| null | **OPTIONAL (additiv)** | WERTE ja (bekannter Zustand UND nur auf Zeilen mit der Lampe `einmalertrag`), Anwesenheit NEIN | **F-2 Stufe 1 (Karl-Mandat, 03.08.2026)** — Prognose-Zustand zur Lampe `einmalertrag`: haelt der Umsatzsprung nach heutigem Analystenstand? Quelle `src/scoring/lamps.js einmalertragPrognose()`, gelesen wird `external.revenueEstimates["+1y"]` (Periode = naechstes Geschaeftsjahr). Konsument: `findash/data-layer/lamp-legend.js einmalertragZustand()`. **Stufe 1 emittiert NUR die schwellenfreien Verfuegbarkeits-Zustaende** `nichtPruefbar` (keine verwertbare Prognose) und `nichtAnwendbar` (Schaetzung da, aber `growth === null` — Rechenartefakt der Quelle, in pull-yahoo.js so benannt). Die urteilenden Zustaende `bestaetigt`/`eingebrochen` stehen fuer Stufe 2 im Vertrag, werden heute NIE erzeugt: sie brauchen eine gelernte und praeregistrierte Einbruchs-Schwelle (Invariante 3; `scripts/einmalertrag-trefferquote.js` hat am 29.07. gezeigt, dass eine frei gewaehlte Schwelle das Vorzeichen des Befunds bestimmt). **`null` heisst NICHT "keine Daten" — es gibt genau zwei `null`-Faelle, und sie sind an der Lampe unterscheidbar:** (a) **Zeile OHNE die Lampe `einmalertrag`** → es gibt nichts auszusagen, die Frage stellt sich nicht. (b) **Zeile MIT der Lampe und trotzdem `null`** → die Prognosedaten sind **vollstaendig und vergleichbar** (Analysten > 0, `avg` > 0, `growth` finit); was fehlt, ist allein die Einbruchs-SCHWELLE. Die ist weder gelernt noch praeregistriert (Invariante 3), deshalb faellt Stufe 1 hier bewusst kein Urteil — genau diese Zeilen fuellt Stufe 2 mit `bestaetigt`/`eingebrochen`. Wer (b) als "keine Daten" anzeigt, dreht die Aussage um: es sind die am besten belegten Zeilen von allen. findash faellt dafuer heute auf seinen Fall D ("nicht pruefbar") zurueck — das ist der dokumentierte Uebergangszustand bis Stufe 2, keine Datenaussage. Reine Anzeige, kein Score-Input (Score-Neutralitaet bewiesen: Digest ueber 4.769 Snapshots / 1.087 Board-Zeilen vor und nach dem Einbau identisch). |
| `einmalertragBewertbarkeit` | `"zuWenigQuartale"`\|`"ungleicheKadenz"` \| null | **OPTIONAL (additiv)** | WERTE ja (bekannter Grund UND nur auf Zeilen OHNE die Lampe `einmalertrag`), Anwesenheit NEIN | **Urteil 16.08.2026 (Sichtbarkeits-Stufe, F-16-Einzelfreigabe Karl)** — der DRITTE Zustand der Lampe `einmalertrag`. `src/scoring/lamps.js einmalertrag()` hat drei Ausgaenge: `true` (Lampe an), `false` (geprueft und sauber) und `null` (**nicht bewertbar**). Bis heute kam `null` stumm an und war von "sauber" ununterscheidbar — drei verschiedene Lagen lieferten dasselbe Schweigen, und Zeilen wie 2548.TW (real-estate Rang 1) und 298380.KQ (Rang 5) standen ungeprueft oben und sahen aus wie geprueft. Dieses Feld benennt den Grund: `zuWenigQuartale` = keine vier verwertbaren Quartale im Fenster (Luecke, 0 oder negativ); `ungleicheKadenz` = vier Quartale vorhanden, aber die Periodenenden liegen nicht im Quartalsabstand (Halbjahres-Eimer bei CN-A-Aktien u. a.) oder ein Datum ist unlesbar. Quelle `src/scoring/lamps.js einmalertragBewertbarkeit()`, abgeleitet aus denselben Daten wie die `null`-Ausgaenge der Lampe — keine zweite Regel. **`null` heisst hier "die Lampe konnte urteilen"** (an ODER sauber), nicht "keine Daten". **Gegenrichtung geprueft:** ein Grund auf einer Zeile MIT der Lampe ist ein Widerspruch (brennt sie, WAR die Zeile bewertbar) und faellt im `--check` auf. Konsument: graue Kennzeichnung in `findash/data-layer/lamp-legend.js`. Reine Anzeige, KEIN Score-Input — die Score-Wirkung der Lampe haengt allein an der brennenden Lampe selbst (`EINMALERTRAG_BLIND` in `src/scoring/score.js`), nicht an diesem Feld. |
| `shareDilution` | `{ratePct,pctl}` | null | **OPTIONAL (additiv)** | WERTE ja (beide Zahlen finit, `pctl` in [0,1]; nur auf Zeilen MIT der Lampe `shareCountDilution` — und dort verpflichtend, s.u.), Anwesenheit NEIN | **03.08.2026, Betrag statt an/aus** — der Zahlenwert hinter der Lampe `shareCountDilution`: `ratePct` = Jahres-Verwaesserungsrate in Prozent (Median der organischen, split-bereinigten YoY-Beine der Aktienzahl, eine Nachkommastelle), `pctl` = Rang dieser Rate in der Board-Kohorte (0..1, Anteil strikt kleinerer Werte, drei Nachkommastellen). Quelle `src/scoring/lamps.js shareDilutionDetail()`, angeheftet in `src/scoring/run-screener.js lampeBNachruesten()`. **Warum:** seit dem Reichweiten-Fix (Tag 536) feuert die Lampe fuer 437 von 3.042 gerouteten Zeilen, sagte aber nur an/aus — ein Kohorten-Spitzenreiter mit +1 % Aktienzahl im Jahr sah exakt aus wie einer mit +66 %. **Ein Rechenweg:** die Lampe liest ihren Schwellvergleich an genau diesen Zahlen ab, es gibt keine zweite Rechnung, die ausscheren koennte; gerundet wird erst bei der Ausgabe, nie im Schwellvergleich. **Beide Richtungen geprueft, und anders als bei `einmalertragPrognose` gilt hier AUCH "Lampe ⟹ Betrag":** die Lampe feuert ausschliesslich, wenn Rate UND Perzentil vorliegen — ein leeres Feld auf einer Lampen-Zeile ist deshalb kein Schweigen, sondern eine gerissene Erzeuger-Kette (genau die Panne, die die Lampe von Tag 421 bis zum 03.08. unsichtbar stumm hielt). Die SCHWELLE prueft der `--check` bewusst NICHT, nur den Wertebereich — eine legitime Schwellen-Aenderung darf Karls Alarmkanal nicht falsch-rot faerben. Nur das 5.2-Small-Cap-Board verdrahtet die Lampe; auf HG/QC steht das Feld auf allen Zeilen `null`. Reine Anzeige, kein Score-Input (Score-Neutralitaet belegt: Gesamt-Digest ueber 4.036 Snapshots / 3.042 gescorte Zeilen vor und nach dem Einbau `1d8db4b2eb5ec8085fdefad68da0cb7ffb7fb26fca94d3d1e9525c002795443a`). |

---

## 3a. Skala des `score`-Feldes: hier gedeckelt, in `board-history/` ungedeckelt

**Die eine Zeile, die zaehlt: derselbe Name kann heute zwei verschiedene Scores tragen — 100,0 in diesem Feed und bis zu 101,0 in `board-history/`. Das ist gewollt und hier dokumentiert, damit keine Auswertung die zwei Quellen stillschweigend mischt.**

**Wo der Deckel sitzt:** `scripts/write-findash-export.js`, Konstante `SCORE_MAX = 100` + Funktion `gedeckelt()` — zum Zeitpunkt des Befunds Zeilen **411–414**, heute (nach dem Belegpunkte-Einbau vom 29.08.) Zeilen 461–464; verlaesslicher Anker ist der Funktionsname, nicht die Zeilennummer. Angewandt in `mapBoardRow` und `mapOverviewRow`, also auf `<branche>.json`, `overview.json`, `full/` und die additiven Feeds, die dieselben Mapper benutzen.

**Seit wann:** 19.08.2026.

**Warum die Engine ueber 100 kommt:** der Wachstums-Bonus in `src/scoring/score.js` (`GROWTH_BOOST_K = 0.05`) hebt einen Basis-Score strukturell um bis zu Faktor 1,05 — 96,2 × 1,05 = 101,0. Der Bonus ist gerichtlich bestaetigt; der Skalenbruch ist ein AUSGABE-Problem.

**Warum der Deckel hier steht und nicht in der Engine:** `Math.min(100, …)` VOR der Sortierung machte aus 101,0 und 100,5 einen exakten Gleichstand — dann entschiede der Ticker-Tie-Break ueber Platz 1 und 2. Der Deckel wuerde genau das verschieben, was er schuetzen soll. Hier ist der Rang bereits vergeben und positional (`rank: i + 1`), der Deckel kann also per Konstruktion keinen Rang aendern. `Infinity` wird bewusst nicht gedeckelt.

**Warum `board-history/` ungedeckelt bleibt — Absicht, kein vergessener Schritt:** `board-history/` ist das Forschungs-Substrat (Rank-IC, Vintage-Vergleiche, `lib/e1-compression.js`, `scripts/rank-ic.js`). Fuer eine Messung ist der ungekappte Wert der richtige: ein Deckel wuerde die Spitze kuenstlich zusammenschieben und Rangkorrelationen ueber Vintages verfaelschen. `scripts/write-board-history.js` kennt deshalb keinen Deckel und soll keinen bekommen. Dieser Feed ist die ANZEIGE fuer findash, `board-history/` ist die MESSUNG — zwei Zwecke, zwei zulaessige Skalen.

**Fuer Konsumenten heisst das:** wer Zahlen aus beiden Quellen vergleicht (z.B. einen Export-Score gegen einen Vintage-Score), muss den Deckel kennen; oberhalb von 100 sind die Quellen nicht deckungsgleich. Betroffen sind sehr wenige Zeilen: Vintage 2026-08-29 = **2 von 8.946** (0,022 %; Maximum 101,0).

**Scheiternskriterium (vorab deklariert, weiterhin gueltig):** liegen mehr als 10 Zeilen bzw. 0,1 % eines Vintages exakt auf 100,0, maskiert der Deckel echte Skaleninflation — dann geht der Fall mit Zahlen in den Gauntlet und diese Dokumentation ist ueberholt. Waechter: `tests/scoring/score-deckel.test.js` (5 Pruefungen, u.a. „Deckel verschiebt keinen Rang" und das Scheiternskriterium selbst).

Beleg-Akte: `agent-reports/befund-score-ueber-100-2026-08-29.md`, Orchestrator ENTSCHIED 20 (29.08.2026) — Option A (dokumentieren) beschlossen, Engine-Rescale/Clamp ausdruecklich NICHT.

---

## 3b. `qSpanTage` misst eine ANDERE Menge als `qPunkte` — keine Kadenz ableitbar

**Die eine Zeile, die zaehlt: `qPunkte` und `qSpanTage` sind kein Paar. Sie werden aus zwei unabhaengig gefilterten Reihen berechnet, und aus ihrem Verhaeltnis laesst sich KEINE Melde-Kadenz ableiten. Wer `qSpanTage / qPunkte` rechnet, bekommt eine Zahl, die nichts belegt.**

**Was jedes Feld wirklich zaehlt** (`scripts/write-findash-export.js`, Funktion `belegPunkte()` — verlaesslicher Anker ist der Funktionsname, nicht die Zeilennummer):

- `qPunkte` = Anzahl der **finiten Werte** in `snapshot.timeseries.revenueQ`.
- `qSpanTage` = Tage zwischen aeltestem und juengstem **parsebaren Datum** in `snapshot.timeseries.revenueQEnds`.

Zwei Filter, zwei Mengen, ein Paar im Export. Ein datiertes Periodenende ohne Umsatzwert zaehlt in die Spanne, aber nicht in die Punkte; ein Umsatzwert ohne lesbares Ende zaehlt in die Punkte, aber nicht in die Spanne.

**Was das konkret heisst** (gemessen am Vintage 2026-08-29, 8.946 gescorte Zeilen — der Code ist seither byte-identisch): **1.609 Zeilen (18 %) tragen mehr datierte Enden als Belegpunkte.** Zwei Extremfaelle: `AVTX` steht bei `qPunkte: 1` / `qSpanTage: 546`; **`600158.SS` steht bei `qPunkte: 0` und trotzdem `qSpanTage: 455`** — eine Beleg-Spanne ueber null Belegen.

**Die Zusage in §3 zu `qSpanTage` ("zwei Punkte 365 Tage auseinander sind eine Jahres-Kadenz, zwei Punkte 91 Tage auseinander echte Nachbarquartale") gilt damit NICHT.** Sie beschreibt, was das Feld leisten sollte, nicht was es misst. Die Spanne ist eine Aussage ueber die **datierten Enden** der Reihe, sonst nichts. Als solche bleibt sie brauchbar (wie weit reicht die datierte Historie zurueck), als Kadenz-Indikator ist sie es nicht.

**`qPunkte` selbst ist von diesem Befund NICHT betroffen** und behaelt seine volle Aussage aus §3: es zaehlt Quartals-Umsatzpunkte, und `0` heisst "kein Quartalsbeleg", nicht "keine Daten".

**Warum dokumentiert statt gefixt** (Orchestrator ENTSCHIED 52, 30.08.2026 — Option B des Memos `agent-reports/defer-queue-memos-2026-08-30.md` §H4): Der Formpruefer aus PR #96 (`checkOptionalSpanneOrNull`) faengt das nicht — `455` ist eine formgueltige Spanne. Ein Semantik-Fix (Enden indexgleich auf die finiten `revenueQ`-Slots filtern) waere die technisch schoenere Loesung, setzt aber eine ungepruefte Invariante ueber die Upstream-Serialisierung voraus (Index-Paritaet zwischen `revenueQ` und `revenueQEnds`) und wuerde bei Laengen-Drift eine **still falsche** Spanne liefern statt einer sichtbar falschen. Der Beschluss ist deshalb dieselbe Bauform wie §3a: die Wahrheit hinschreiben, statt eine Annahme einzubauen.

**Konsumenten-Stand — DATIERT, weil er sich aendern kann:** Zum **30.08.2026** hat `qSpanTage` **null** Konsumenten. Geprueft: findash (`86462c8`) enthaelt repo-weit keinen Treffer fuer `qPunkte`/`qSpanTage`; gelesen wird dort ausschliesslich `coverageAxes` (`data-layer/axis-labels.js`). `web/src/lib/screener-rows.ts` mappt eine explizite Feld-Whitelist (`type Row`) und reicht unbekannte Felder nicht durch. Beide Felder sind **OPTIONAL (additiv)**, score-, rang- und gate-inert und stammen aus PR #91 (29.08.2026) — sie waren bei dieser Beschlussfassung **einen Tag alt und noch von niemandem gelesen**. Findet sich spaeter ein Leser (Dossier-Kette, Briefing-Skript, Codex-Artefakt), ist diese Notiz veraltet: dann wird der Semantik-Fix zum echten Vertragswechsel mit Migrationspflicht und gehoert unter neuem Feldnamen ausgeliefert, nicht als stille Neudefinition.

**Kein Code geaendert.** `belegPunkte()` und `tests/belegpunkte.test.js` bleiben unberuehrt; dieser Abschnitt aendert nur, was der Vertrag ueber das Feld behauptet.

---

## 3c. `opIncSource` — Herkunft der Jahres-OpInc-Reihe: KEIN Export-Feld, aber zwei Lampen tragen es

**Die eine Zeile, die zaehlt: `meta.opIncSource` steht im Snapshot, nicht in diesem Feed — und anders als `qPunkte` ist es NICHT score-inert. Der Wert `computed-margin` nimmt der Zeile ihre gesamte OpInc-HISTORIE (hartes Gate, s.u.); in den Export gelangt das Etikett ausschliesslich ueber die zwei Lampen `opIncSynthetisch`/`opIncYahooAdjusted` im `lamps`-Array.**

**Warum es hier dokumentiert wird, obwohl es kein Vertragsfeld ist:** `opIncSource` traegt eine Herkunfts-Behauptung, die bis zum 29.08.2026 falsch war (s. „`'native'` ist tot"), es steuert seit demselben Tag ein Score-Gate, und seine beiden Lampen stehen ab sofort auf Board-Zeilen dieses Feeds. Ein Konsument, der `lamps` liest, braucht die Bedeutung — und dies ist die einzige feld-genaue Doku im Repo. Der Vertrag selbst aendert sich dadurch NICHT: `opIncSource` ist kein Export-Feld, steht in keinem `--check` und gehoert nicht in `docs/findash-export-v1.contract.json` (dort stuende sonst ein Feld, das der Export nie schreibt).

**Die Etiketten** — definiert an genau EINER Stelle, dem Modulkopf-Block „SEMANTIK VON meta.opIncSource" in `scripts/opinc-source-migrate.js` (verlaesslicher Anker ist der Block, nicht die Zeilennummer):

| Wert | Bedeutung |
| --- | --- |
| `'sec-gaap'` | `annual.annualOpInc` stammt aus dem eingereichten SEC-XBRL-Filing (`us-gaap`/`ifrs-full`, via `merge-sec-xbrl.js` → `external-data/*-secannual.json`). GAAP-as-filed, versioniert, reproduzierbar. Die ersetzte Yahoo-Reihe bleibt unter `annual.annualOpIncYahoo`, ihr altes Etikett unter `meta.opIncSourceYahoo` (K1.3: kein Name verliert Daten). |
| `'yahoo-adjusted'` | Die Reihe stammt aus Yahoo (`quoteSummary` isHist bzw. `fundamentalsTimeSeries`). Yahoo bereinigt still und unversioniert (Impairments, Restrukturierung). **Ehrlich etikettierter Proxy, kein Fehler** — nur eben nicht der eingereichte Abschluss. |
| `'computed-margin'` | Synthetisch: `annualRev x operatingMargins-TTM` (Financial-Services-Fallback, `pull-yahoo.js _deriveOpIncForFinancials` Pfad 3). EINE Marge, auf alle Jahre gestempelt. |
| `'computed-bank'` | Synthetisch: `totalRev - totalOpEx - Kreditrisikovorsorge` (Pfad 1). |
| `'computed-insurance'` | Synthetisch: `totalRev - costOfRev - SG&A` (Pfad 2). |
| `null` | Keine OpInc-Reihe vorhanden — **und ausdruecklich auch dann, wenn die Reihe existiert, aber keinen einzigen finiten Wert traegt**: ueber nichts gibt es keine Herkunft zu behaupten (M5a, `yahooLabelFuer()`, Orchestrator ENTSCHIED 52). |

**`'native'` ist tot** (PR #90, 29.08.2026 — Urteil `_COURT-T164-OPINC-2026-08-29.md` K1.2, ratifiziert als Orchestrator **ENTSCHIED 15**). Das alte Etikett behauptete eine ROH-Herkunft, die es bei Yahoo nicht gibt; alles, was `'native'` trug, heisst heute `'yahoo-adjusted'`. Der Bestand wurde lokal migriert (`scripts/opinc-source-migrate.js`), **kein Re-Pull**. `pull-yahoo.js` schreibt das Wort nicht mehr — `tests/opinc-source.test.js` pinnt beides: die Abwesenheit im Quelltext UND das neue Etikett am erzeugten Snapshot. Die synthetischen Etiketten blieben unangetastet, sie waren nie unehrlich (Urteil K2).

**Score-Wirkung: JA — hier liegt der Unterschied zu `qPunkte`/`qSpanTage`.** `computed-margin` fabriziert per Konstruktion konstante Marge und konstantes Vorzeichen, also genau die Stabilitaet, die jede historische Achse messen will. Seit PR #93 (ENTSCHIED 15, Karl-Freigabe **ENTSCHIED 18**, versiegelter Slot `protocol/gqs-00/1.2.0-pending/`) liefert `histOpInc()` in `src/scoring/snapshot.js` fuer solche Zeilen `[]` — alle historischen Achsen, Profitphasen und longitudinalen Lampen sehen dann „keine Jahresreihe". Das AKTUELLE Vorzeichen (`norm(s,'annualOpInc')`, Track-Split) bleibt bewusst erlaubt. **Ein FEHLENDES Etikett gilt nie als synthetisch** — sonst verloere ein Alt-Snapshot ohne `meta` still seine ganze Historie.

**Die beiden Lampen** (`src/scoring/lamps.js` 17/18, Auflagen K2-3 und K1-Doppelboden): `opIncSynthetisch` = die Reihe ist zurueckgerechnet; `opIncYahooAdjusted` = die Reihe ist Yahoos bereinigter Stream statt des eingereichten Abschlusses. Beide liefern `null`, solange `opIncSource` fehlt oder `null` ist (kein Urteil ohne Etikett) — und `null` wie `false` erscheinen im Export gleich, naemlich gar nicht (nur `true` landet in `lamps`). **Ausdruecklich KEINE data-suspect-Lampen** (`score.js` `DATA_SUSPECT_LAMPS`): `opIncSynthetisch` steht an 300 der 354 Zeilen des Financials-Boards, in der Exclude-Liste waere sie ein 300-Zeilen-Ausschluss durch die Hintertuer — das Gericht hat diese „Board-Ausweidung ohne Ersatz" 3:0 verboten. Wer die Lampen dort eintraegt, kippt das Urteil.

**Bestandszahlen, DATIERT** (Stand der Migration vom 29.08.2026, PR #90/#93 — nachgefuehrt in den Modulkoepfen von `lamps.js` und `snapshot.js`, nicht bei jedem Lauf neu gemessen): **12.629** Snapshots `yahoo-adjusted` gegen **128** `sec-gaap`; **1.859** `computed-margin` im Hauptstore, davon 100 % Financial Services. Die Breite der Lampe `opIncYahooAdjusted` IST der K1-Befund, keine Fehlkalibrierung.

**Wer es liest** (`grep` ueber den Baum, Stand 30.08.2026): Schreibseite `pull-yahoo.js` (`mapYahooToCanonical`, FTS-Merge) und `scripts/opinc-source-migrate.js` (taeglich im SCORING-Job vor `run-screener.js`, bewusst NICHT im Merge-Job — sonst verglichen `build-secannual{,-smallcap}.js` ihre `looseSanity` kuenftig SEC gegen SEC und das Tor waere still zur Tautologie geworden); Messung `scripts/ab-computed-margin.js`; Engine `src/scoring/snapshot.js` (Gate) und `src/scoring/lamps.js` (Lampen 17/18).

**Konsumenten-Stand — DATIERT, weil er sich aendern kann:** Zum **30.08.2026** hat findash (`29b8727`) repo-weit **null** Treffer fuer `opIncSource`, `opIncSynthetisch` und `opIncYahooAdjusted`; `data-layer/lamp-legend.js` fuehrt Eintraege fuer andere Lampen (u.a. `shareCountDilution`, `einmalertrag`), fuer diese beiden keinen. Die Lampennamen stehen also bereits im Feed, ohne dass eine Legende sie erklaert. Wer dort eine Legende ergaenzt, sollte die Trennung mitnehmen: `opIncSynthetisch` ist ein Qualitaets-Vorbehalt MIT Score-Wirkung, `opIncYahooAdjusted` ist eine reine Herkunfts-Angabe ohne — sie als eine Warnstufe zu zeichnen, faerbte 12.629 Zeilen falsch-rot.

**Waechter:** `tests/opinc-source.test.js` (Migration + toter `'native'`-Anker) und `tests/scoring/opinc-gate-computed-margin.test.js` (das Gate, inkl. byte-gleichem Zwilling, bei dem nur `meta.opIncSource` abweicht).

---

## 4. `overview.json` (FLACH)

Huelle (§2) + `rows: Array<OverviewRow>`. Cross-Branch, score-desc, ~200 Zeilen.

**Bewusst flach** — `overviewKind/Value/Companion` einzeln statt `row.overview`-Objekt, plus `formulaId`. Das spiegelt die Engine-Form exakt; ein Umbau auf verschachtelt waere ein v2-Bruch.

### OverviewRow — jedes Pflicht-Feld geprueft

| Feld | Typ | Pflicht | Geprueft | Bedeutung |
| --- | --- | --- | --- | --- |
| `rank` | int ≥ 1 \| null | Pflicht (nullable) | ja (Integer ≥ 1 ODER null mit Grund) | Abgeleitet aus der score-desc-Reihenfolge. **Belegbarkeits-Gate (18.08.2026):** `null`, wenn die Zeile weniger als **4 belegte Messachsen** hat (`coverageAxes`) — dann steht der Grund in `rankGrund`. Die Zeile bleibt vollstaendig in der Liste (Score, Lampen, alle Felder) und verbraucht KEINE Rangnummer: die uebrigen Raenge laufen lueckenlos 1,2,3,… |
| `rankGrund` | `"zuWenigBelegteAchsen"` \| `"coverageUnbekannt"` \| null | **OPTIONAL (additiv)** | ja, beide Richtungen (`rank`=null ⇔ Grund gesetzt) | **Task Belegbarkeits-Gate (18.08.2026)** — warum die Zeile keinen Rang traegt. `zuWenigBelegteAchsen` = weniger als 4 von 7/8 Achsen belegt; `coverageUnbekannt` = `coverageAxes` fehlt oder ist unlesbar (ohne Beleg kein Rang — bewusst nicht durchgewunken). `null` = Rang vergeben. Abwesenheit des Feldes wird wie `null` gelesen. Score-inert: das Gate aendert keinen Score und keine Sortierung, nur die Rangnummer. |
| `ticker` | string (nichtleer) | Pflicht | ja | |
| `name` | string \| null | **OPTIONAL (additiv)** | Form ja, wenn present; neuer Producer emittiert es immer | Wie BoardRow §3; derselbe bereinigte `snapshot.meta.name`, reine Anzeige. Alte v1-Daten ohne Feld bleiben lesbar. |
| `formulaId` | string (nichtleer) | Pflicht | ja | Branchen-ID (nur hier als Feld; in Boards implizit ueber Datei). |
| `track` | `"profitable"`\|`"unprofitable"` (Enum) | Pflicht | ja (Enum) | **Meistgelesene Cross-Branch-Liste — der Enum-Bruch bei `track` wird hier erkannt.** |
| `score` | number (round1, finite), **Spanne 0–100** | Pflicht | ja (finite) | z.B. `94.9`. Derselbe Deckel wie in §3 (`mapOverviewRow`, seit 19.08.2026) — s. §3a zu den zwei Skalen. |
| `overviewKind` | `"gp"`\|`"revenue-badge"`\|`"ffo-badge"`\|`"runway-badge"` \| null | Pflicht (nullable) | ja (Praesenz + Enum\|null) | Wie board `overview.kind`, aber FLACH. |
| `overviewValue` | number \| null | Pflicht (nullable) | ja (Praesenz + finite\|null) | KANN NEGATIV. |
| `overviewCompanion` | number \| null | Pflicht (nullable) | ja (Praesenz + finite\|null) | |
| `lamps` | string[] | Pflicht | ja (Array) | Kann `[]`. |
| `country/region/sector/marketCap/phase/mcapBand/ipoRecency/profitTier/ipoYear` | wie BoardRow §3 | Pflicht (nullable) | ja (jedes einzeln, Praesenz + Typ/Enum\|null) | Volle geo-Felder (inkl. 1.2 `profitTier`+`ipoYear`). |
| `qPunkte` / `qSpanTage` | wie BoardRow §3 | **OPTIONAL (additiv)** | FORM ja, wenn present | Belegpunkte zur `coverageAxes`-Behauptung, identische Semantik und identische Quelle wie in §3 — derselbe Mapper-Zweig; fuer `qSpanTage` gilt hier ebenso die Einschraenkung aus §3b (keine Kadenz ableitbar). `survival.json` traegt die Felder bewusst NICHT: Survival-Zeilen sind nie gescort und tragen kein `coverageAxes`, haben also keine Beleg-Behauptung zu stuetzen. |

---

## 5. `survival.json` (FLACH, Sonderform)

Huelle (§2) + `rows: Array<SurvivalRow>`, 73 Zeilen, **runway-desc nulls-last**, ungekappt.

**Sonderform:** Pre-Revenue-Namen laufen NIE durch Scoring — es gibt **kein `score`, kein `track` profitable/unprofitable, kein `overview.kind`**. Stattdessen `runwayQuarters`. Der Check prueft hier bewusst KEIN `score`/`track` (existieren nicht), aber `rank`, `runwayQuarters` und alle 7 geo-Felder.

### SurvivalRow — jedes Pflicht-Feld geprueft

| Feld | Typ | Pflicht | Geprueft | Bedeutung |
| --- | --- | --- | --- | --- |
| `rank` | int ≥ 1 | Pflicht | ja (Integer ≥ 1) | Abgeleitet (Index+1), = Runway-Rang. **Vom Belegbarkeits-Gate ausgenommen:** pre-revenue-Zeilen werden nie gescort und tragen `coverageAxes` nie — der Runway-Rang bleibt immer ein Integer, `rankGrund` ist hier immer `null` (geprueft). |
| `ticker` | string (nichtleer) | Pflicht | ja | z.B. `"PAH3.DE"`. |
| `name` | string \| null | **OPTIONAL (additiv)** | Form ja, wenn present; neuer Producer emittiert es immer | Wie BoardRow §3; derselbe bereinigte `snapshot.meta.name`, reine Anzeige. Alte v1-Daten ohne Feld bleiben lesbar. |
| `runwayQuarters` | number \| null | Pflicht (nullable) | ja (Praesenz + finite\|null) | Runway in Quartalen. **`9999` = Sentinel fuer quasi-unendlichen Runway** (pre-revenue mit Cash-Ueberdeckung). Sortierschluessel. **Real nullable** (3 von 73 Rows null). |
| `lamps` | string[] | Pflicht | ja (Array) | z.B. `unprofit/lowRoic/burning/burnAccelerating/crashRisk/shortRunway`, kann `[]`. |
| `country/region/sector/marketCap/phase/mcapBand/ipoRecency/profitTier/ipoYear` | wie BoardRow §3 | Pflicht (nullable) | ja (jedes einzeln, Praesenz + Typ/Enum\|null) | Volle geo-Felder (inkl. 1.2 `profitTier`+`ipoYear`). Ein typ-falsches geo-Feld (z.B. `marketCap='GARBAGE'`, `phase='zombie'`) blockt jetzt den Deploy. |

---

## 6. `index.json` (Meta)

Huelle (§2) +:

| Feld | Typ | Pflicht | Geprueft | Bedeutung |
| --- | --- | --- | --- | --- |
| `generatedFromSnapshots` | number (finite) | Pflicht | ja | z.B. `4681`. Wie viele Snapshots in den Lauf gingen. |
| `branches` | string[] (Laenge 13) | Pflicht | ja (Array + Laenge===13) | Sortiert. **Haerte-Hinweis:** die Laenge-13-Pruefung ist an die Nebenannahme gekoppelt, dass alle 13 Branchen geroutete Zeilen haben (run-screener.js baut `branches` aus `Object.keys(ranked.branches)`). Real 13/13; faellt eine Branche komplett aus, schlaegt der Gate mit `index: branches` fehl — bewusste konservative Haerte, hier als Invariante dokumentiert. |
| `boardStatus` | `{[branche]: 'core'\|'diagnostic'}` | Pflicht | ja (Map-Praesenz, Vollstaendigkeit gegen alle 13 Branchen UND jeder Wert Enum — BH-078) | Zentrale Court-Standing-Map aller 13 Boards (= das Board-Datei-Feld `boardStatus`, hier gebuendelt). Das Dashboard joint Overview-Zeilen per `formulaId` gegen diese Map, um `diagnostic`-Namen zu badgen. Quelle `src/scoring/board-status.js`, Ledger §2.1. |
| `counts` | `{[branche]: {profitable:int, unprofitable:int}}` | Pflicht | ja (Objekt-Praesenz) | **ECHTE Kohorten-Counts** (ganze Population), NICHT die topN-Anzeigeliste. |
| `survivalCount` | number (finite) | Pflicht | ja | z.B. `73`. |
| `excluded` | `{[grund]: count}` | Pflicht | ja (Objekt-Praesenz) | Ausschluss-Gruende, z.B. `{"non-us":326,"balance-sheet-bank":305,...}`. Gruende: `balance-sheet-bank, data-suspect, dup-issuer, insurer, lender-gp0, mortgage-reit, no-axes, no-sector, non-operating-rev, non-us, telecom`. |

### Achsen-Perzentile — seit 2.7/2.13 IM Board-Vertrag; calib ist nur noch die Roh-Matrix

> **Korrigiert (R-Gate 2.R, Fund R2.10).** Dieser Abschnitt behauptete frueher, die Achsen-Perzentile stuenden NUR im calib-Kanal und `coverageWeight` werde „gar nicht emittiert". Beides ist seit Task 2.7 (Tag 276) bzw. 2.13 #23 falsch und widersprach der Feldtabelle in §3 **derselben Datei**. Der Abschnitt beschrieb einen toten Zustand.

**Ist-Zustand (je Board-/Overview-Zeile, alles OPTIONAL/additiv und score-inert — kein `--check`-Pflichtfeld, kein v2-Bump):**

- **`axisBreakdown`** liefert je Achse den Perzentil-Beitrag `pct` (0–100 round1, `null` = gedroppt/renorm-on-drop) **plus** `weight`. Quelle: `src/scoring/score.js:849-851` (`breakdown()`), gespeist aus `score.js:644` (`entries[i]._axes`). Real belegt: `NVDA` traegt `[{key:'revGrowthLevel',pct:88.3,weight:1.7}, …]` ueber 7 Achsen.
- **`coverageAxes`** + **`coverageWeight`** werden ebenfalls je Zeile emittiert: berechnet in `score.js:651-652`, in die Export-Zeile durchgereicht von `geo()` in `score.js:878`. Real belegt: `NVDA` → `coverageAxes: "7/7"`, `coverageWeight: 1`.

**Die LIVE-Achsen sind 7, nicht 8** — in allen 13 HG-Formeln (`src/scoring/formulas/*.js`):
`revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, dilution`.
`marginLevel` kommt zusaetzlich in **genau einer** Formel vor (`tech-hardware`).

**`revisionsMomentum` ist KEINE Live-Achse mehr** — per Karl-Direktive entfernt, in **0 von 13** Formeln. Die Funktion existiert noch (`src/scoring/axes.js:270`, exportiert `:385`), wird aber von keiner Formel referenziert; die einzigen Nennungen sind Kommentare in `src/scoring/formulas/materials.js:10-12`. Der Achsen-Satz wird in `src/scoring/calibrate.js:67` **live** aus `formula.axes` abgeleitet — auf Platte liegende calib-Dateien mit `revisionsMomentum` sind **veraltete Artefakte** eines Laufs von vor der Entfernung (`outputs/` ist gitignored).

**Der calib-Kanal bleibt getrennt und NICHT im Vertrag:** `outputs/hypergrowth/calib/<branche>.json` haelt die Roh-Perzentil-Matrix ueber die **ganze Kohorte** (nicht nur topN), Form `{<track>: {formulaId, track, axisKeys, defaultWeights, alpha, rows:[{ticker, pct, lamps}]}}` — also `<track>.rows[].pct`, **nicht** `rows[].pct` auf oberster Ebene. Dump: `src/scoring/calibrate.js:172-192` (`dumpMatrix()`), Zweck: Sub-Agenten laden billig, statt das Universum neu zu parsen. Was das **Dashboard** an Achsen-Coverage braucht, steht per `axisBreakdown`/`coverageAxes`/`coverageWeight` schon in der Zeile — ein separater `axes.json`-Feed ist damit gegenstandslos.

---

## RESERVIERTE Felder (existieren NICHT in 1.1 — nicht faelschen)

| Feld | Status 1.1 | Wann |
| --- | --- | --- |
| `profitTier` | ✅ **UMGESETZT in 1.2** — reales 4-Stufen-Enum-Feld, siehe §3/§4/§5. (War in 1.1 reserviert.) | erledigt (Tag 264) |
| `currency` | ✅ **GELOEST am 16.08.2026 (Waehrungs-Chunk 4a)** — als `marketCapCurrency` + `tradingFxRateApplied`, siehe §3. `marketCap` ist immer USD; eine Zeile OHNE nachgewiesene Handelskurs-Umrechnung wird mit `marketCap: null` ausgeliefert statt mit einer falschen Groesse (Karl-Regel: eine fehlende Groesse ist harmlos, eine falsche nicht). Der Nachweis steckt in `scripts/write-findash-export.js` beurteileWaehrungsbeleg; Waechter: `tests/waehrung-ausliefer-waechter.test.js`. **Nachgezogen (Tag 941, Review-Fix):** die Abkuerzung „Handel = Bericht" gilt nur, wenn der heutige Mapper das ausdruecklich bestaetigt hat (`meta.tradingCurrencyAssumed === false`). Auf Snapshots von VOR Tag 938 fehlt dieses Feld — dort ist `tc === rc` nicht der Beleg einer Inlandsnotierung, sondern die Spur des Wurzelfehlers selbst; solche Zeilen werden jetzt genullt (Grund `herkunft-unbekannt`). Am eingefrorenen lokalen Bestand betraf das 749 von 4 476 Zeilen, die vorher faelschlich als belegt durchliefen. | erledigt (Tag 940), gehaertet (Tag 941) |
| `ipoYear` | ✅ **UMGESETZT in 1.2** — Boersen-IPO-Jahr durchgereicht, reales `number\|null`-Feld, siehe §3. (War in 1.1 reserviert.) | erledigt (Tag 264) |
| `axes` (pro Board-Row) | ✅ **GELIEFERT — als `axisBreakdown`** (Task 2.7, Tag 276). Jede Board-/Overview-Zeile traegt `[{key,pct,weight}]`, siehe §3/§6; Quelle `src/scoring/score.js:849-851`. (Die alte Aussage „EXISTIERT NICHT in Boards. Nur im calib-Diagnostik-Kanal." war tot und widersprach §3.) Ein Feld mit dem Namen `axes` gibt es nicht und ist nicht geplant — der erwogene `axes.json`-Zusatz-Feed ist gegenstandslos. | erledigt (Tag 276) |

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

**Teil b — board-history (UMGESETZT, scharf seit Tag 303, Task 2.3):** Eine datierte Board-Vintage-Historie liegt unter `board-history/` (**nicht** `findash-export/history/YYYY-MM-DD/` — frueherer Platzhalter-Pfad dieser Doku, nie real gebaut). Geschrieben von `scripts/write-board-history.js` als **eigener Schritt** in `daily-pull.yml` (NACH dem gh-pages-Deploy), getrennt vom 1.1-Export-Writer (`write-findash-export.js`) und separat nach main committet — derselbe Pfad-getrennte Mechanismus wie `picks-history/` (eigener Job, eigener Commit, nicht ueber den scoring-Loop). Retention siehe §9: der Writer selbst loescht nie.

**Teil c — XBRL/prices-max (DOKUMENTIERT, ausserhalb CI, gebunden an 4.1/2.2):** Die tiefe Roh-Historie (SEC-XBRL-Serien, `prices/`-Vollhistorie) ist die Basis fuer spaetere Deep-Work-Achsen, gehoert aber NICHT in den findash-export. Sie wird von `pull-sec-xbrl.js` / `pull-historical-prices.js` in eigene, gitignored bzw. tracked-external Pfade geschrieben. **Bindung:** XBRL-Tiefe an Task 4.1 (Buffett-Board Quant-Teil, Masterplan Phase 4), prices-max an Task 2.2 (ATH-Abstand-Spalte, `prices-max/`-Max-Batch, Masterplan Phase 2). Der 1.1-Writer liest diese Quellen NICHT und darf sie nie als Zielpfad bekommen.

**Schutzliste (read-only fuer den 1.1-Writer, NIE Zielpfad):** `picks-history/`, `earnings-calendar.json`. Beide werden vom pull-Job bewirtschaftet; der scoring-Job laeuft auf frischem Runner und schreibt ausschliesslich unter `outputs/` — damit sind sie faktisch geschuetzt, aber der Writer dokumentiert sie explizit als read-only, um die Trennung zu zementieren.

---

## 9. Groessen-Budget (Jahres-Wachstum + Deckel)

**Pro Lauf (latest-only, Teil a):** ~1,3 MB (13 Boards + overview + survival + index; calib NICHT im Export). Da nur `latest` geschrieben und force-gepusht wird, ist der **stationaere gh-pages-Footprint konstant ~1,3 MB** — kein Jahres-Wachstum. Das ist der Sinn von Grundgesetz 7a.

**Jahres-Wachstum seit Teil b (board-history) live ist:** ~1,3 MB/Vintage × ~250 Handelstage = **~325 MB/Jahr** (unkomprimiert; gzip drueckt real auf ~50–80 MB/Jahr). `board-history/` wird nach **main** committet, nicht nach gh-pages gepusht — das Wachstum betrifft den Repo-Baum, nicht den gh-pages-Footprint aus Teil a.

**Retention: kein automatisches Loeschen.** `write-board-history.js` kennt eine Kompaktierung (`--compact`, `RETENTION_DAYS = 180`): Vintages **aelter als 180 Tage** werden als Voll-Snapshot nach `board-history-archive/` (ausserhalb des CI-Checkouts, GG7c) kopiert und danach im committeten `board-history/`-Eintrag gestrippt (`compacted:true`) — **geloescht wird dabei nichts**. Der taegliche CI-Lauf (`daily-pull.yml`, Schritt „Write board-history vintage") ruft den Writer OHNE `--compact` auf; die Kompaktierung ist bis auf Weiteres ein manueller Schritt, kein automatischer harter 1-GB-Deckel. Der latest-only-Export (1.1) beruehrt das nie, weil er nicht akkumuliert. XBRL/prices-max (Teil c) haben eigene, groessere Budgets ausserhalb dieses Vertrags (an 4.1/2.2 gebunden).

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

- **`--check`-Verhalten (BH-160/BH-078 gefixt):** `boardStatus` ist auf QC-Dateien (Board-Datei UND die QC-`index`-`boardStatus`-Map) auf den **einzigen legitimen Wert `'diagnostic'`** gepinnt — NICHT das breitere `['core','diagnostic']`-Enum, das fuer HG gilt. Ein manipuliertes `'core'` auf einer QC-Datei oder in der QC-Index-Map **trippt jetzt** (exit 1), ebenso ein **fehlendes** oder **bogus** `boardStatus`. Die QC-`index`-`boardStatus`-Map wird zusaetzlich auf Key-Vollstaendigkeit gegen `boards` geprueft (fehlender oder ueberzaehliger Eintrag trippt). Der Build-Zeit-Invariante „QC == diagnostic" wird zusaetzlich im `--selftest` asserted.
- **Core-Promotion** ist gated auf **ρ < 0,4 + rankIC** (QC-Rangkorrelation zum HG-Board niedrig genug, dass QC eigenstaendige Information traegt) — siehe **Masterplan 3.1**. Bis dieser Nachweis vorliegt, bleibt QC diagnostic.

### Optional-when-absent (kein stiller Weglass, kein Crash)

Fehlt `outputs/quality/` (alte lokale Laeufe ohne QC-Pass), schreibt der Writer **keine** `quality/`-Dateien und loggt eine **deutliche Warnung** (`::warning::`) — er crasht nicht und laesst nichts still weg. Der `--check` behandelt `quality/` als **optional-wenn-abwesend**: ohne `quality/index.json` auf Platte gibt es nichts zu pruefen (kein Bruch). **Sobald `quality/index.json` existiert**, sind alle darin gelisteten QC-Boards **plus** `overview.json` **Pflicht** und werden voll validiert (Zeilen wie `validateBoardRow`/`validateOverviewRow`, `boardStatus` gegen das Enum). Alle QC-Fehlermeldungen tragen ein `quality/`-Praefix, damit der Alarm-Kanal einen QC-Bruch nie mit einem HG-Bruch verwechselt.

### Bewusste Disclosure: praktisch leere Dauerhaftigkeits-Achse `roicStability`

Das QC-Achsenset enthaelt eine **Dauerhaftigkeits-/Stabilitaets-Achse `roicStability` mit Gewicht `w=0`** (`src/scoring/formulas/quality/index.js:33,44`) — sie traegt **nicht** zum Score bei, ist score-inert und erscheint in `axisBreakdown` mit `weight: 0`. Das ist eine **bewusste Offenlegung**, kein Bug.

> **Praezisiert (R-Gate 2.R, Fund R2.10).** Die frueher hier genannte Begruendung — „sie ist derzeit leer (keine belastbare Zeitreihen-Basis fuer ROIC-Stabilitaet)" — war schon **beim Schreiben ueberholt**: der SEC-XBRL-Tiefkanal landete mit **Tag 291 (2026-07-10)**, dieser Absatz wurde mit **Tag 293 (2026-07-13)** geschrieben. Die Basis EXISTIERT.

**Was wirklich stimmt:** `roicStability` liest OpInc/Assets/CurrLiab als **Single-Source-Trio** aus `snapshot.secAnnual` (`src/scoring/axes.js:350-381`; angehaengt in `src/scoring/run-screener.js:142-145`, Tiefe ~10–15 GJ) und rechnet damit **echte** Werte — 61 der 124 Namen im committeten `external-data/sec-secannual.json` ergeben einen finiten CoV.

**Der Grund fuer `w=0` ist also nicht „keine Basis", sondern DUENNE ABDECKUNG:** der Tiefkanal umfasst heute **124 von 6406** Universe-Namen (**1,9 %**). Auf den realen QC-Boards ist `roicStability.pct` folglich in nur **7 von 1033** Zeilen non-null (**0,7 %**, Lauf 2026-07-14) — sonst greift das harte Daten-Gate `ROIC_STAB_MIN_YEARS = 6` (`axes.js:335`) und liefert `null` (renorm-on-drop, kein Fake-50). Eine so null-schwere Achse wuerde bei `w>0` ueber die C4-Coverage-Shrinkage das Board Richtung Median stauchen; mit `w=0` ueberspringen die engine-Guards sie (nicht in `totalW`) — **die Praxis-Aussage „leer" bleibt damit korrekt, nur ihre Begruendung war falsch.**

**Aufleuchten** (Gewicht `0` → ~`1.5`, eine Zeile) haengt damit an der **Verbreiterung des SEC-Stores**, nicht mehr am Bauen des Tiefkanals — der steht seit Tag 291.

### Retention / Deploy

`quality/` faellt unter dieselbe **Retention-Grundgesetz-7a**-Regel (§8): latest-only, atomar ueberschrieben, kein Anhaengen. Der Deploy-Step kopiert `outputs/findash-export/v1/.` rekursiv (`cp -r`) und nimmt den `quality/`-Unterordner damit automatisch mit — **keine** Aenderung am Deploy-Step noetig.

---

## 11. `full/` (Vollboards) — additiver Feed (19.08.2026)

`src/scoring/run-screener.js` ruft `produceRankings(results, { topN: topN || 100 })`, und die CI ruft ohne `--topN`. Jede Board-Liste ist damit bei **100 Zeilen je Track** gekappt — die Zeilen dahinter waren im Export weder abrufbar noch erwaehnt. Gemessen am Vintage 03.08.2026: **1.512 von 3.042** gescorten Board-Zeilen erreichten die Oberflaeche, **50,3 % fehlten**. Bei `industrials` standen 100 von 516 Zeilen zur Verfuegung. Das bricht die Direktive „nichts verschwindet".

Die vollen Kohorten liegen seit 2.3-A8 in `outputs/hypergrowth/full/`, wurden aber nie publiziert (der gh-pages-Deploy kopiert `hypergrowth` flach: `cp ../outputs/hypergrowth/*.json`). Sie werden jetzt **additiv** in denselben v1-Vertrag aufgenommen — als Unterordner `outputs/findash-export/v1/full/`. Kein v2-Bump: bestehende Dateien und Felder werden **nicht** angefasst.

### Dateien (unter `outputs/findash-export/v1/full/`)

| Datei | Inhalt | Quelle |
| --- | --- | --- |
| `<branche>.json` (13, PFLICHT) | Dieselbe Board-Datei-Form wie §3 (`{schema, generated_at, branch, boardStatus, coverage, mcapBounds, profitable[], unprofitable[]}`), aber mit der **ganzen** Kohorte je Track | `outputs/hypergrowth/full/<branche>.json` |

`survival` hat **kein** Vollboard und braucht keins: die Liste ist flach nach Runway sortiert und wird nie gekappt (§5). `overview.json` ebenfalls nicht — es ist per Definition ein Cross-Branch-Auszug, kein Board.

### Verhaeltnis zur gekappten Datei — die tragende Zusage

**Die ersten `topN` Zeilen je Track sind mit `<branche>.json` TIEF gleich, inklusive `rank`.** Nicht „ungefaehr dieselben Namen" — dieselben Objekte, Feld fuer Feld. Danach laeuft die Rangfolge im Vollboard einfach weiter: Zeile 101 traegt `rank: 101`, bis zum Ende der Kohorte.

Das ist **konstruktiv** garantiert, nicht gehofft. Das gekappte Board ist das byte-gleiche `topN`-Praefix der full-Liste (`tests/scoring/anchors.rank.test.js`, Pruefung A8), es laufen dieselben Mapper (`mapBoardRow`) und dieselbe Rangvergabe (`vergebeRaenge`, sequenziell-deterministisch je Zeile) darueber. Beides ist trotzdem festgenagelt statt vorausgesetzt: `tests/scoring/export-vollboard.test.js` (20 Pruefungen) vergleicht die ersten 100 Zeilen tief und pinnt den Deckel selbst.

Das **Belegbarkeits-Gate** (§3, seit 18.08.) laeuft auf beiden Dateien identisch: eine Zeile mit zu duenner Achsen-Abdeckung traegt `rank: null` + `rankGrund` und **verbraucht keine Rangnummer**. Die uebrigen Raenge bleiben dadurch in beiden Dateien lueckenlos `1..k` — und deckungsgleich.

### Ladeverhalten

`full/` wird **auf Anforderung** geladen, nicht im Erstaufschlag. `<branche>.json` bleibt der schnelle erste Blick; wer ueber Rang 100 hinaus will, holt die Vollliste derselben Branche nach. Eine zweite, schlanke Zeilenform im Erstladevorgang waere teurer — sie belastete **jeden** Aufruf, auch die grosse Mehrheit, die nie ueber Rang 100 hinausschaut, und braeuchte fuer die Detailzeilen trotzdem eine Nachlade-Quelle.

Die Dateien sind deshalb **kompakt** geschrieben (`indent 0`, wie die Quelle in `outputs/hypergrowth/full/`) — sie sind maschinell gelesen, nicht handgelesen.

### Groesse

Am Vintage 03.08.2026 gemessen (Dezimal-MB, wie `du -b` zaehlt): `full/` gesamt **3,63 MB** ueber 13 Dateien, von 54 kB (`it-services`) bis 651 kB (`industrials`). Der v1-Ordner waechst dadurch von **6,11 MB auf 9,74 MB** — die Differenz ist exakt `full/`, die 42 Bestandsdateien bleiben byte-identisch (sha256-Vergleich vor/nach dem Umbau). Der **Erstaufschlag waechst um 0 Byte** — das ist der Sinn der Trennung. §9 (latest-only, kein Jahres-Wachstum) gilt unveraendert.

### Gate

Anders als `quality/` ist `full/` **nicht** optional-wenn-abwesend. `run-screener.js` schreibt die Quelle bei jedem Lauf; zu jedem der 13 Branchen-Boards gehoert genau ein Vollboard. `--check` (`validateFullExport`) prueft alle 13 als **Pflicht** und validiert jede Datei mit derselben Board-Pruefung wie §3 (`branch` == Dateiname, `boardStatus`-Enum, jede Zeile, Rang- und Score-Folge). Alle Meldungen tragen ein `full/`-Praefix, damit der Alarm-Kanal ein Vollboard-Problem nie mit einem Board-Problem verwechselt.

Zusaetzlich zaehlt `daily-pull.yml` nach dem Bau die Dateien: **13 oder `::error::` + Exit 1**. Grund: ein still fehlendes Vollboard sieht in findash aus wie ein Board ohne Nachruecker — stumm halb statt sichtbar rot, und das ist der teuerste Fehlerfall dieses Feeds. Fehlt das **Quell**verzeichnis `outputs/hypergrowth/full/`, bricht der Bau laut ab statt einen leeren Feed auszuliefern.

### Waehrungs-Waechter: eigene Bilanz, KEINE eigene Abbruchgrenze

Die Zeilen der Vollboards laufen durch denselben Waehrungs-Waechter (§3): ohne Handelskurs-Nachweis wird `marketCap` genullt — sonst waere die Zeilen-Gleichheit mit der gekappten Datei gebrochen. Sie zaehlen aber **nicht** in die 25-%-Abbruchquote, denn die wurde auf den **gekappten** Listen gemessen; ~1.500 zusaetzliche Tail-Zeilen im Nenner verschoeben eine gemessene Grenze.

Damit der Tail trotzdem nicht unhoerbar wird, meldet der Bau eine **eigene** Bilanz (`::warning::Waehrungs-Waechter (Vollboards, EIGENE Bilanz, …)`). Der Tail ist nachweislich duenner belegt — am 19.08. gemessen: gekappt 61,9 %, voll 66,7 %. Eine **eigene Abbruchgrenze gibt es bewusst nicht**: jede Zahl waere auf dieser nie gemessenen Grundgesamtheit geraten, und ein geratener Abbruch kippte den ganzen Export. Erst wird gemessen, dann darf jemand eine Schwelle setzen.

### Retention / Deploy

`full/` faellt unter dieselbe **Retention-Grundgesetz-7a**-Regel (§8): latest-only, atomar ueberschrieben, kein Anhaengen; das Zielverzeichnis wird vor jedem Bau geleert, damit ein abgebrochener Lauf nie Vollboards zweier Vintages mischt. Der Deploy-Step kopiert `outputs/findash-export/v1/.` rekursiv (`cp -r`, `daily-pull.yml` Zeile 1757) und nimmt den `full/`-Unterordner damit automatisch mit — **keine** Aenderung am Deploy-Step noetig.

---

## 12. Datenkanal-Beipack (F-17a) — NICHT Teil des v1-Vertrags

**Karl-Entscheid 04.08.2026, Option c.** findash las bis dahin zwei Dinge per `git pull` aus einem lokalen Checkout dieses Repos statt aus dem oeffentlichen Kanal: den Termin-Kalender und die Vintages der Bewegungs-Anzeige. Auf dem findash-Server gibt es diesen Checkout nicht — der Pull wird dort abgeschaltet, beides liegt jetzt auf `gh-pages`.

Diese Pfade sind **bewusst ausserhalb** von `outputs/findash-export/v1/`: sie folgen nicht der v1-Datei-Huelle, unterliegen nicht dem `--check`-Vertragsgate und loesen keinen v2-Bump aus. Sie sind ein Beipack zum selben Publish, kein Vertragsbestandteil.

| Pfad auf `gh-pages` | Quelle | Publiziert von | Groesse |
| ------------------- | ------ | -------------- | ------- |
| `outputs/earnings-calendar.json` | `earnings-calendar.json` (Repo-Wurzel, aus dem prep-Job) | `daily-pull.yml`, merge-Job, Schritt „Stage earnings-calendar…" + Deploy 1/2 | ~0,54 MB, byte-genaue Kopie |
| `outputs/board-history/index.json` | abgeleitet | `daily-pull.yml`, scoring-Job, Schritt „Publish board-history vintages…" | ~1 KB |
| `outputs/board-history/<YYYY-MM-DD>/<board>.json` | `board-history/<datum>/` | dito | ~0,25 MB je Vintage |

**`index.json`** (`schema: board-history-publish/v1`) listet `vintages: [{ date, files: [...] }]`, aelteste zuerst. Ueber HTTP gibt es kein `readdir` — ohne diese Liste findet ein Konsument die Vintages nicht.

**Warum nur ein Ausschnitt** (`scripts/stage-public-data.js`): das ganze `board-history/` sind 95 MB, zwei volle Vintages 27 MB. Publiziert werden (1) nur die **2 juengsten** Vintages — findashs `computeMovement()` nimmt `vintages.slice(-2)`, aeltere liest es nie; (2) nur Dateien **mit `cohort`** — die Sidecars `calibration.json`/`regime.json` erkennt findash ohnehin inhaltsbasiert als Nicht-Board; (3) je Zeile nur **`rank`/`ticker`/`score`** — mehr liest die Bewegungs-Anzeige nicht (`score` bleibt, weil ihre Zeilen-Pruefung den anwesenden Schluessel verlangt). Ergebnis: **0,5 MB statt 27 MB**, bei unveraenderter Dateiform (`cohort.profitable` / `cohort.unprofitable`).

**Frische.** Der Kalender wird im merge-Job publiziert (dort ist er frisch; der scoring-Job checkt den Trigger-Commit aus und saehe den Vortagsstand). Die Vintages werden **nach** dem Vintage-Commit publiziert — vorher existiert das Vintage von heute noch nicht, und die Anzeige vergleicht die zwei juengsten Staende. Ein **SUSPECT**-Vintage (Wert-Gate, rc=2) geht weder nach `main` noch in den Kanal.

**Fail-loud.** Fehlt eine Quelle, endet der Publish mit `::error::` + Exit 1 statt sie still wegzulassen — sonst zeigte findash nach der Umstellung wortlos nichts. Waechter: `tests/stage-public-data.test.js`.
