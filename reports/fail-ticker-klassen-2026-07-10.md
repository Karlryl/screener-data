# Task 0.12 — Fail-Ticker-Klassifizierung & ehrlicher Coverage-Nenner (2026-07-10)

**Fail-Quelle:** alle **4 209** per-Ticker-ERROR-Zeilen (`✗ TICKER: [errClass] msg`) aus den
17 Shard-Logs des letzten grünen Daily-Pull-Laufs **28998189660** (2026-07-09, `6266a7d969`) —
deckungsgleich mit `n_failed = 4209` im committeten `snapshots/_manifest.json`.
Rohverteilung errClass: **2 537 schema-fail · 1 671 not-found · 1 other · 0 rate-limit/timeout/auth.**

## Klassen-Tabelle (jede Zeile mit echten Belegen, nichts geraten)

| Klasse | n | Beleg-Verfahren | Politik (umgesetzt) |
|---|---:|---|---|
| **delisted / kein Yahoo-Listing** (`delisted-kein-yahoo-listing`) | **1 374** | errClass `not-found` = definitive Yahoo-Ablehnung („Quote not found for symbol"); Stichprobe 11/11 per lokaler quote-Probe erneut tot; WebFetch-Gegencheck s. u. Enthält GGP (Yahoo-Platzhalter YHD, Typ MUTUALFUND, kein Preis — Brookfield-Übernahme 2018). | **Austrag** (Registry + Watchlist) |
| **Fractional-/Reg-A-Serien = keine Aktien** (`kein-listing-fraktional`) | **545** | Namensmuster im Watchlist-Eintrag (ARRIVED HOMES …SER…, MASTERWORKS VAULT, RSE/1SE ARCHIVE, …), alle via finnhub-US-Discovery reingekommen; Stichprobe 3/3 (ADHFS, MKSVS, RAGHS): quote=null, quoteSummary trägt selbst unvalidiert nur 1 Modul, kein Preis. | **Austrag** |
| **schema-fail, quote-tot** (`schemafail-quote-tot`) | **1 118** | **alle 2 537 schema-fail-Ticker einzeln** per yahoo-finance2-quote-Probe verifiziert (2026-07-10, 0×429): diese 1 118 liefern quote=null/not-found → 0 Daten auf Yahoo (überwiegend tote OTC-Zweitlistings: ARBGF≙ARBB.L, BCAEF≙BCE, GRCPY, KKSIY, AAC). | **Austrag** |
| **Zombie ohne Marktdaten** (`zombie-kein-marktdatum`) | **6** | quote-Objekt existiert, aber weder Preis noch MarketCap (leere Hüllen à la Waitr/ASAP) — einzeln probiert. | **Austrag** |
| **Suffix-/Mapping-Fehler HK** (`mapping-hk-unpadded`) | **29** | Legacy-v9-Zeilen wie `12.HK`/`2.HK`; Gegenprobe: `0012.HK` = Henderson Land (25.36 HKD, 122,8 Mrd.), `0002.HK` = CLP Holdings — quoteSummary OK. | **Suffix-Fix:** 0-Padding auf 4 Stellen in der Watchlist (29 umbenannt, 0 Kollisionen) |
| **lebendig, aber schema-fail** (`lebendig-schemafail`) | **1 126** | quote-Probe: lebendig mit Preis+MCap; unvalidierte quoteSummary trägt 12–13 Module inkl. Jahres-GuV. Beispiele: **ADYEN.AS** (841 €, 26,5 Mrd.), **4188.T** Mitsubishi Chemical, **5101.T** Yokohama Rubber, **ALOT** AstroNova. | **BLEIBEN im Universum** = dokumentierter **Rest-Blocker** (s. u.) |
| **transient** | **11** | quote-Probe-Fehler ≠ not-found (Netz/einmalig). Im 4 209er-Set selbst: **0** Throttle-Fails (kein rate-limit/timeout/auth). | **Retry-Budget** = bestehendes tägliches Re-Pull-Verhalten; kein Austrag |
| Summe | **4 209** | | |

**Austrag gesamt: 3 043 Ticker** → `data-health/dead-tickers.json` (Klasse je Ticker, committet).

## Stichproben-Belege (Auszug)

- **CADE** (not-found): WebFetch stockanalysis.com — Huntington/Cadence-Merger von Aktionären
  am 06.01.2026 gebilligt, letzter Handelstag 30.01.2026 → delistet. quote-Probe: null.
- **CUTR** (not-found): stockanalysis.com liefert 404; quote-Probe null (Insolvenz/Delisting).
- **AVST.L, DLG.DE, HBP.L** (not-found, legacy-v9): quote-Probe null (Übernahmen: Avast→Gen Digital, Dialog→Renesas).
- **ADHFS** „ARRIVED HOMES 4 SER LENDRUM", **MKSVS** „MASTERWORKS VAULT 2 SER 347" (fraktional): quote null, 1 Modul, kein Preis.
- **12.HK → 0012.HK** (Mapping): ungepolstert null, gepolstert = Henderson Land voll pullbar.
- **ADYEN.AS / 4188.T / ALOT** (lebendig-schemafail): quote lebendig, volle Fundamentaldaten im Payload —
  nur der strikte yahoo-finance2-Validator lehnt ab. Beweis, dass Austrag hier FALSCH wäre.

## Umgesetzte Mechanik

1. **`data-health/dead-tickers.json`** (neu, committet): Registry Ticker→Klasse + Methodik-Header.
2. **`refresh-universe.js`**: (a) blockt tote Kandidaten vor dem Merge (Discovery kann sie nie wieder
   einschleusen — finnhub liefert die Fractional-Serien sonst täglich neu), (b) trägt tote
   Bestandszeilen in-place aus (analog ADR-Dedup). Fail-open: kaputte Registry = kein Austrag.
3. **`watchlist.json`** einmalig bereinigt: 23 689 → **20 646** (−3 043 tot, 29 HK-Zeilen repariert).
   Snapshots wurden **nicht** angefasst → der 0.8-Börsen-Coverage-Wächter (zählt Snapshots je Börse)
   meldet keinen Länder-Kipp.
4. **Ehrlicher Nenner** `n_addressable = n_total − n_skipped_mcap` (Tote sind bereits aus n_total raus):
   in `pull-yahoo.js` (Slim-Manifest), `scripts/merge-shard-manifests.js` (CI-Merge-Pfad) und
   `scripts/coverage-gate.js` (Gate + Marker `n_addressable`/`honest_coverage_pct`).
5. **90-%-Latte präzisiert, nicht relaxt (L6):** coverage-gate prüft zusätzlich
   `n_ok / n_addressable ≥ 90 %` → sonst `degradiert` mit ehrlichem Rest im Banner-Text.
   HARD-Floor, SOFT-Target und Fail-Mass-Schwelle bleiben unverändert aktiv.
   Selftest-Case beweist: ein echter Pull-Einbruch (82,4 % ehrlich) bleibt rot/degradiert. 19/19 grün.

## Ehrlicher Nenner & erwartete Coverage

| | vorher (09.07.) | nach Austrag (erwartet nächster Lauf) |
|---|---:|---:|
| n_total (Watchlist) | 23 689 | 20 646 |
| mcap-Skips | 13 392 | ~13 392 (unverändert, Tote waren alle „attempted") |
| **adressierbar** | 10 297 | **~7 254** |
| n_ok | 6 088 | ~6 117 (+29 reparierte HK) |
| **ehrliche Coverage** | **59,1 %** | **~84,3 %** |
| Fail-Mass | 40,9 % (Banner an) | ~15,7 % (< 35 % → dieser Banner-Grund verschwindet) |

## Rest-Blocker (dokumentiert, Akzeptanz-Alternative zur 90-%-Latte)

**1 126 lebende Ticker scheitern client-seitig am strikten Schema-Validator von yahoo-finance2**
(„Failed Yahoo Schema validation"), obwohl der Payload Preis, MCap und Jahres-GuV trägt —
darunter Blue Chips wie Adyen, Mitsubishi Chemical, Yokohama Rubber. Sie gehören in den Nenner
(sie sind adressierbar) und drücken die ehrliche Coverage auf ~84 %. Der Fix liegt auf
Pull-Ebene (Umgang mit `validateResult` / tolerantere Feld-Extraktion) und ist ein bewusster
**Folge-Task** — 0.12 mandatiert Datenhygiene, keinen Eingriff in die Pull-/Datenqualitäts-Semantik
(Vorsicht: F-A-2026-06-21 hat genau hier schon einmal Survivorship-Schäden repariert).
Wird er gelöst, springt die ehrliche Coverage rechnerisch auf ~99 %.

## Invarianten / Schutz

- Kein Scoring-/Formel-Eingriff: `tests/scoring` 25/25 grün, `anchors.rank.test.js` 8/8,
  `tests/fixture-hash.txt` unverändert. Root-Tests (pull-diet, silent-errors, freshness-gate,
  pull-shard, sort-cache-order) grün. coverage-gate-Selftest 19/19, merge-Selftest 13/13.
- Schutzliste unberührt (picks-history/, methods-history/, earnings-calendar.json, rgate/).
- Kein Snapshot gelöscht; Austrag ist reine Watchlist-/Discovery-Hygiene.
