# Konflikt-/Duplikat-Audit Codex-Queue screener-data (S01–S65)

Stand: `codex-queue/QUEUE.md` @ 865a645 (2026-09-24). Nur gelesen, kein Repo-File geändert (`git status` leer).
Quelle je Befund: ZIEL-DATEIEN-Zeile + genannte Zeilennummern im Task-Text; Repo-Fakten per `ls`/`grep` gegengeprüft.
Von Codex zu überspringen (STATUS „CLAUDE bearbeitet", 12 Branches `claude/Sxx` existieren): **S22 S24 S25 S35 S36 S37 S38 S43 S49 S53 S59 S62**.

## 0. Kurzfazit (die 8 Befunde, die morgen wirklich zählen)

| # | Befund | Konsequenz |
|---|--------|------------|
| 1 | **S31 löscht Exporte, die S35 (Claude, Branch existiert) gerade testet**: `toYahooClassShare`, `_looksUS`, `dedupKey` aus `refresh-universe.js`. | S31 um den refresh-universe-Teil kürzen (Soll 37 Keys → 40; nur `MIN_PREDEFINED_NONEMPTY_ANTEIL`, `EXCHANGE_SEITE` raus) **oder** S31 komplett hinter S35 und Liste anpassen. |
| 2 | **S17 (Scripts-Smoke-Fixes) kollidiert semantisch mit S07/S08**: S17-Klasse K2 macht aus `assert('--now requires population-dir')` in `t-veraltung-zwei-definitionen.js` einen `Usage`-Exit 2; S07(g) pinnt Exit 1 + genau diesen stderr-Text. K3 macht in `t-kdrift-signatur.js:13` den Pfad zum Pflichtargument; S08(3) pinnt die heutige Usage-Assertion. | S17 als **letzten** scripts-Task fahren und `t135-paritaetsluecke.js`, `t-veraltung-zwei-definitionen.js`, `t-kdrift-signatur.js` in die S17-Ausschlussliste („gepinnt durch S07/S08") aufnehmen. |
| 3 | **S18 (JSDoc-Wächter über `lib/**`) wird rot durch jeden späteren lib-Task**: neue Module S23 (`lib/path-within.js`), S25 (`lib/env-key.js`), S48 (`lib/md-table.js`) und neue Exporte S26/S27/S28/S29 ohne `/** */`-Block. Außerdem Merge-Konflikt mit S43 in `lib/studie-verfassung.js` (ladeRegelwerk :147). | S18 **ganz zum Schluss** (nach S23/S25/S26–S29/S43/S48), oder Brief der lib-Tasks um „JSDoc-Block Pflicht" ergänzen. |
| 4 | **S10 ist zu ~80 % Doppelarbeit**: `hitRate/_median/resolveWindow/loadWatchlist` macht S14; `annual-currency-guard 100 %` = S37, `read-json 100 %` = S38, `newest-qtr-guard 100 %` = S53 (alle drei Claude, in Arbeit). | S10 morgen **nicht** starten; nach Merge von S14/S37/S38/S53 neu messen (S09-Tool) und ggf. schlankes S10' nur für `cohortSpread`/`quintileMonotonicity`-Ties + `forward-returns.classify`. |
| 5 | **S03 dupliziert Bestand**: `tests/price-history-store.test.js` + 3 Guard-Tests (`layout-paths`, `shard-filename`, `shard-path`) existieren bereits; S15 referenziert `tests/price-history-store.test.js` sogar als Mutations-Ziel. | S03 streichen oder auf „nur Fehlerpfade, die der Bestand nicht deckt" umschreiben. |
| 6 | **S01/S02-Prämisse „ohne Test" stimmt für 8 von 11 Modulen nicht** (Bestand in `tests/`: sec-rate-limit ×2, sec-user-agent, alter ×2, snapshot-fs ×3, fetch-retry ×3, zip-stream ×3, sec-pit ×2; spearman via `lib/metrics.test.js:37`). Wirklich ungetestet: `lib/region-mapping.js`, `lib/ledger-single-appender.js`. | S01/S02 auf Region-Mapping, Ledger-Single-Appender, `fetch-retry._internals.warteAufSlot` und dokumentierte Konstanten einschränken; ZIP-Rest liegt bei S11, fetch-retry-Rest bei S12. |
| 7 | **S30 erwartet `lib/metrics.js :: hitRate` als „stabil tot"** — S14 (und S10) machen `hitRate` per Test lebendig (S30 scannt `tests/` mit). | S30 vor S14 fahren **oder** `hitRate` aus S30-Mindestliste streichen (bleiben: `corruptYoung`, `ftsCacheParse`). |
| 8 | **S15/S16 behaupten „disjunkte Dateien", teilen aber 3 Testdateien** (siehe Tabelle 1). Plus S15 fasst `tests/pr-check-live-gate.test.js:66` an — dieselbe Datei wie S22 und S25 (beide Claude). | S15 erst nach Merge von S22+S25 und nach S16 (Rebase); S16 direkt nach S14. |

## 1. Datei-Kollisionen (gleiche Datei in ZIEL-DATEIEN mehrerer Tasks)

„Parallel" = disjunkte Regionen, Textmerge realistisch (Rebase vor Push reicht). „Seriell" = gleiche/benachbarte Zeilen oder gleiche Export-Zeile.

| Datei | Tasks (Region) | Verdikt | Reihenfolge |
|-------|----------------|---------|-------------|
| `scripts/backfill-form345.js` | S26 (:73) · S27 (:72) · S29 (:77) · S28 (:134) · S20 (:49, :136-139, :287, :413-420, :481 exports) · S31 (:479-482 exports) | **Seriell** (Z.72/73/77 benachbart; S20+S31 beide an `_internals`) | S26→S27→S28→S29→S20→S31 |
| `scripts/pull-insider-form4.js` | S26 (:114, Import :58) · S27 (:112) · S28 (:135-137, :57) · **S43 Claude** (:194, :762) | Seriell für S26/S27/S28 (benachbart); S43 parallel (andere Region) | S43 mergen → S26→S27→S28 (Rebase) |
| `scripts/pull-insider-form4-daily.js` | S26 (:94) · S27 (:92) · S28 (:99) | **Seriell** (benachbart) | S26→S27→S28 |
| `scripts/pull-13f-institutional.js` | S26 (:195) · S27 (:193) · S29 (:200) · S28 (:276-278) | **Seriell** (:193/:195/:200 benachbart) | S26→S27→S28→S29 |
| `scripts/backfill-prices-max.js` | S26 (:56) · S27 (:55) | **Seriell** | S26→S27 (S32 liest nur `readProgressManifestOrThrow`) |
| `scripts/backfill-prices.js` | S27 (:46) · **S43 Claude** (:80) | Parallel möglich, gleiche Datei | S43 mergen → S27 Rebase |
| `scripts/fetch-secbulk.js` | S27 (:67) · S42 (:223/:236/:249 + exports :273) · S31 (exports :273 `BULK_URL`) | **Seriell** (S42 und S31 editieren dieselbe `module.exports`-Zeile) | S27→S42→S31 |
| `scripts/probe-smallcap-coverage.js` | S26 (:274) · S27 (:263) · S48 (:644) | S26/S27 seriell (benachbart); S48 parallel | S26→S27; S48 beliebig (Rebase) |
| `scripts/probe-smallcap-messlauf3.js` | S27 (:52) · S17 (K2-Fall) | Seriell | S27 → S17 |
| `scripts/reconcile-smallcap.js` | S26 (:82) · S17 (K1-Fall) | Seriell | S26 → S17 |
| `scripts/merge-shard-manifests.js` | S26 (:37) · S29 (:113) | Parallel möglich; Kette ohnehin seriell | S26→S29 |
| `scripts/watch-unrouted-quote.js` | S26 (:31) · S29 (:41) | **Seriell** (benachbart) | S26→S29 |
| `scripts/plan-check.js` | S29 (:48) · S34 (renderReport :112-123, selftest :219-223) | Parallel (disjunkt) | beliebig, Rebase |
| `scripts/enrich-q-revenue.js` | **S24 Claude** (:213) · S52 (:32, :183/:224, :215, exports :236) | **Seriell** (:213/:215 benachbart; KONFLIKT-HINWEIS im Brief) | S24 mergen → S52 |
| `scripts/heartbeat-preis-abdeckung.js` | S40 (:36-37, exports :258) · S17 (K1-Fall, explizit genannt) | Seriell | S40 → S17 |
| `scripts/data-quality-report.js` | S47 (Refactor main→collectStats/renderReport, neue Zeile/Spalte „unknown") · S17 (K1-Fall) · S13 (testet main() per Kindprozess, pinnt Ausgabe) | **Seriell** (KONFLIKT-HINWEIS S13↔S47) | **S47 → S13 → S17** (S13 pinnt dann das Endformat, kein Doppel-Umbau) |
| `scripts/pipeline-health-check.js` | S41 (Refactor + `require.main`-Guard) · S17 (steht in „Ohne require.main-Guard (23)"-Liste) | Parallel (S17 ändert nichts, zählt nur) | S41 → S17 (Liste 23→22; mit S58 `sec-pit-check` →21) |
| `scripts/check-pull-stats.js` | S56 (:243/:244/:248 + exports) · S32 (liest `validateStatsHistory` :211) · S17 | Parallel S56‖S32 | S56 → S17 |
| `scripts/t322-ads-verhaeltnis-optionen.js` | S23 (:59-60) · S17 (K3 :10) | Parallel möglich, gleiche Datei | S23 → S17 |
| `scripts/t-veraltung-zwei-definitionen.js` | S07 (pinnt CLI, „unverändert") · S17 (K2 explizit genannt) | **Semantischer Konflikt** (Exit 1→2, stderr-Text) | S07 zuerst; S17 Datei ausschließen |
| `scripts/t-kdrift-signatur.js` | S08 (pinnt CLI/Usage-Assertion) · S17 (K3 :13) | **Semantischer Konflikt** | S08 zuerst; S17 Datei ausschließen |
| `scripts/archive-old-snapshots.js` | S28 (:58 ensureDir → lib) · S13 (Coverage-Ziel ≥72 % auf diese Datei) | Parallel; Prozentwert verschiebt sich minimal nach S28 | S28 → S13 (oder Toleranz) |
| `refresh-universe.js` | S31 (5 Exporte raus :2013/:2022/:2032) · **S35 Claude** (testet 3 davon) | **Harter Konflikt** | S35 mergen → S31 ohne refresh-universe-Teil |
| `pull-earnings-dates.js` | S27 (:22) · S51 (:78, :99-101, exports) | Parallel (disjunkt) | S51 → S27 (Rebase) |
| `pull-historical-prices.js` | S27 (:94) · **S36 Claude** (:131-134, :312, :455) | Parallel (disjunkt) | S36 mergen → S27 |
| `pull-sec-xbrl.js` | S27 (:96) · S50 (:102-135, exports :354-363) | **Seriell** (:96/:102 direkt benachbart) | S50 → S27 |
| `lib/read-json.js` | S26 (2 Exporte, :54) · S29 (2 Exporte, :54) · S18 (JSDoc) | **Seriell** (alle an `module.exports` :54) | S26→S29→S18 |
| `lib/fetch-retry.js` | S27 (export `sleep` :114) · S18 (JSDoc) | Seriell | S27→S18 |
| `lib/atomic-write.js` | S28 (export `ensureDir` :241) · S18 (JSDoc 2/2) | Seriell | S28→S18 (Export-Probe in `lib/atomic-write.test.js:54` prüft nur `atomicWriteStats`-Keys → S28 bricht sie nicht) |
| `lib/studie-verfassung.js` | **S43 Claude** (ladeRegelwerk :147-149) · S18 (JSDoc 17/17, Block direkt über :147) | **Seriell** (gleiche Region) | S43 mergen → S18 |
| `lib/*.js` (18 Dateien) | S18 (nur Kommentare) · S23/S25/S48 (neue lib-Module) · S26–S29 (neue Exporte) | Wächter-Konflikt (s. Kurzfazit 3) | S18 zuletzt |
| `tests/pr-check-live-gate.test.js` | **S22 Claude** (:25-26, :44) · **S25 Claude** (:54) · S15 (:66 Skip) | Seriell (3 Schreiber, Zeilen 44/54/66 nah beieinander) | S22 → S25 → S15 |
| `tests/cn-jahresreihen.test.js` | S15 (:140, :150, :383, :391, :463) · S16 (:672, :673) | Parallel möglich (disjunkt), aber Brief behauptet fälschlich „disjunkte Dateien" | S16 → S15 (Rebase) |
| `tests/bk-sk-001-mitschnitt-stille-pannen.test.js` | S15 (:184 Skip) · S16 (:133) | Parallel möglich, gleiche Datei | S16 → S15 |
| `tests/studie-f6-konfirmatorisch.test.js` | S15 (:356, :359) · S16 (:317) | Parallel möglich, gleiche Datei | S16 → S15 |
| `tests/_mutations-pairs/*.json` | S14 (`lib.json`) · S15 (`s-mut2.json`) · S16 (`s-mut3.json`) | Parallel (verschiedene Dateien), Infrastruktur aus S14 | S14 zuerst |
| `tests/helpers/zip-fixture.js` | S11 (additiv `zip64`) · S20/S02 lesen nur | Kein Konflikt | — |
| `reports/*` | S04 (`codex-gate-lauf-…`) · S17 (`codex-scripts-smoke-…`) | Verschiedene Dateien | — |

Nur ein Schreiber, keine Kollision (Auszug): `scripts/write-board-history.js` S23 · `scripts/filter-snapshot-merge.js` S23 · `scripts/d2-submissions-bulk.js` S57 · `scripts/b1-validate.js`/`druckenmiller-13f.js`/`sec-pit-check.js` S58 · `scripts/refresh-fx.js` S39 · `scripts/test-offline-fixtures.js` S46 · `discovery/nasdaq-api.js` S45 · `index.html` S33 · `lib/atomic-write.test.js` S54 · `lib/metrics.test.js`/`forward-returns.test.js`/`watchlist-fs.test.js` S14 · `tests/board-history.test.js` S16 · `tests/pipeline-status-marker.test.js` S60 · `tests/universe-hash.test.js`/`kohorten-persistenz-t199.test.js` S61 · `scripts/coverage-gate.js` S26 (**Achtung**: das ist der PULL-Coverage-Gate aus daily-pull.yml, S09 nennt ihn „nicht anfassen" — S26 ersetzt dort `readJSON` :42; Reviewer soll den Diff dort besonders eng prüfen).

## 2. Ziel-Duplikate (gleiche Funktionen doppelt getestet) + Empfehlung

| Paar | Überlappung | Empfehlung |
|------|-------------|------------|
| **S10 ↔ S14** | `hitRate`, `_median`, `resolveWindow`, `loadWatchlist`, spearman-Pins | S14 behalten (Mutations-Basis für S15/S16). S10 streichen/verschieben. |
| **S10 ↔ S37/S38/S53 (Claude)** | annual-currency-guard 100 %, read-json 100 %, newest-qtr-guard 100 % | S10 streichen; Rest nach Neu-Messung. |
| **S03 ↔ Bestand** | `tests/price-history-store.test.js` + 3 Guards decken Anlegen/Lesen/Shards | S03 streichen oder auf Rest-Fehlerpfade (korrupte Datei, doppelte Datumszeile) begrenzen. |
| **S01 ↔ Bestand** | sec-rate-limit (2 Tests), sec-user-agent (`tests/sec-user-agent-test.js`), alter (2 Guards), snapshot-fs (3 Guards), spearman (`lib/metrics.test.js:37` + S14) | S01 auf `region-mapping` + Konstanten-Pins (`WINDOWS_RESERVED`, `MS_PRO_TAG`) + ungedeckte Exporte kürzen. |
| **S02 ↔ Bestand/S11/S12** | fetch-retry (3 Guards + S12 `einAbruf`), zip-stream (3 Guards + S11 ZIP64), sec-pit (`tests/sec-pit.test.js` + Guard + S11) | S02 auf `ledger-single-appender` + `fetch-retry._internals.warteAufSlot` + zip-stream-Roundtrip (Store/Deflate) begrenzen; S11 bleibt die ZIP64-Ergänzung. |
| **S12 ↔ S54** | atomic-write Rename-Drossel/win32, Replacer | Im Brief erkannt: S12 zuerst, S54 nur Rest — beibehalten. |
| **S47 ↔ S48** | `mdZelle(v)` (S47) ≡ `mdCell(v)` (S48), identische Semantik; S48 schließt data-quality-report.js explizit aus („V2-01") | S48 zuerst, S47 importiert `mdCell` statt eigener Kopie — sonst entsteht am selben Tag die 5. Escaper-Kopie. |
| **S04 ↔ S44** | S04 will Tabelle Datei\|Exit\|Sekunden über die Gate-Suite; S44 baut genau diesen Harness (`outputs/test-laufzeit.md`) | S44 zuerst; S04 nutzt `node scripts/test-laufzeit.js` und liefert nur Rot-Analyse/Fixes. |
| **S25 ↔ S60** | S60 Schritt (2) will win32-PATH-Key case-insensitiv finden — exakt `mitEnv()` aus S25 | S60 importiert `lib/env-key.js` (S25 Claude, Branch existiert) statt Inline-Kopie. |
| **S30 ↔ S14/S10/S31/S32** | S30-Mindestliste enthält `hitRate` (S14 macht es lebendig) und 8 Namen, die S31/S32 entfernen/beleben | Reihenfolge festlegen (S30 vor S14/S31/S32) oder S30-Sollwerte auf `corruptYoung`, `ftsCacheParse` reduzieren. |
| S06 ↔ `tests/p1-welle8-metadata-filter.test.js` | Verhalten vs. Quelltext-Wächter | Bewusst komplementär, ok. |
| S19 ↔ S59 | zwei statische Scanner | Verschiedene Muster, ok. |

## 3. TABU-Treffer (Regelblock + `.codex-deny.txt`: `.codex-deny.txt`, `picks-history/`, `methods-history/`, `board-history/`, `score-history/`, `r40rx-history/`, `methods/`, `tests/scoring/`, `.github/`, `earnings-calendar.json`, `src/scoring/**`, `*-history/`, `README.md`, `docs/findash-export-v1*`)

**Kein Task nennt in ZIEL-DATEIEN einen TABU-Pfad.** Substring-Gate geprüft: `tests/board-history*.test.js` (S16) enthält kein `board-history/`; `.claude/skills/methods-audit/SKILL.md` (S64) enthält kein `methods/`.

Grenzfälle / offene ZIEL-Mengen, die der Reviewer am echten Diff gegen die TABU-Liste prüfen muss:

| Task | Warum |
|------|-------|
| S04 | „+ ggf. Fix-Dateien außerhalb der TABU-Pfade" — offene Menge. |
| S17 | „geänderte `scripts/*.js` NUR aus der Netz-freien Menge" — bis zu ~60 Dateien, offene Menge. |
| S18 | alle `lib/*.js` + `lib/druckenmiller/*.js` (nur Kommentare) — Strip-Vergleich `IDENT` ist die einzige Sicherung. |
| S19 | „Fix im selben PR" bei gefundenem Syntaxfehler — offene Menge; liest `.github/` nur. |
| S26 | fasst `scripts/coverage-gate.js` an (CI-Gate aus daily-pull.yml, nicht TABU, aber sensibel). |
| S51/S56 | Produktionscode rund um `earnings-calendar.json` — Tests dürfen die Datei nie lesen/schreiben (Brief sagt es; Reviewer prüfen). |
| S33 | `index.html` wird per Workflow nach gh-pages kopiert — nicht TABU, aber öffentlich sichtbar. |

## 4. Abhängigkeiten (VORAUSSETZUNG / „seriell nach" / KONFLIKT-HINWEIS / implizit)

| Abhängig | Von | Art |
|----------|-----|-----|
| S15 | S14 | **hart** (VORAUSSETZUNG im Brief; Worktree ggf. von `origin/codex/S14`) |
| S16 | S14 | implizit hart (nutzt `tests/_mutations-probe.js` + Paar-Format aus S14) |
| S15 | S22, S25 (Claude), S16 | Datei `pr-check-live-gate.test.js` bzw. 3 geteilte Testdateien |
| S27 | S26 | „seriell NACH S-DUP-01" |
| S28 | S26, S27 | „seriell NACH S-DUP-01/02" |
| S29 | S26 | „seriell NACH S-DUP-01" |
| S31 | S28, S20 | „seriell NACH S-DUP-03" + KONFLIKT-HINWEIS S20 (`hasUnzip`) |
| S31 | S35 (Claude) | Export-Löschung vs. neue Tests (s. Kurzfazit 1) |
| S27 | S36, S43 (Claude), S50, S51 | gleiche Root-/Script-Dateien |
| S52 | S24 (Claude) | KONFLIKT-HINWEIS (enrich-q-revenue.js) |
| S54 | S12 | KONFLIKT-HINWEIS (S12 zuerst, keine Doppel-Assertions) |
| S13 | S47 | KONFLIKT-HINWEIS (Ausgabeformat); empfohlen S47 zuerst |
| S13 | S28 | Coverage-Prozent verschiebt sich (weich) |
| S10, S11, S12, S13 | S09 | weich („Mit S-COV1 …", Fallback-Snippet vorhanden) |
| S04 | S44 | weich (Harness liefert die Tabelle) |
| S17 | S07, S08, S23, S26–S29, S40, S41, S47, S56 | scripts-Änderungen + CLI-Pins (S17 zuletzt) |
| S18 | S23, S25, S26–S29, S43, S48 | JSDoc-Wächter über alle lib-Dateien (S18 zuletzt) |
| S30 | (vor) S14, S31, S32 | Sollwerte hängen von der Reihenfolge ab (Brief sagt es selbst) |
| S60 | S25 (Claude) | weich (Wiederverwendung `mitEnv`) |
| S65 | S63 | weich (BANNERED-Liste könnte die 3 Docs aufnehmen); S64 unabhängig |
| S42 vor S31 | — | beide editieren `fetch-secbulk.js` `module.exports` |

## 5. Reihenfolge-Empfehlung für morgen (bis zu 8 Subagenten parallel)

**Nicht starten:** S03 (Duplikat), S10 (Duplikat, nach Neu-Messung ggf. S10'), die 12 Claude-Tasks.

**Welle 1 — sofort, disjunkt, entblockt am meisten (8 Slots):**
`S14` (Mutations-Infra → S15/S16) · `S09` (Coverage-Tool → S11–S13) · `S44` (Laufzeit-Harness → S04) · `S48` (md-table → S47) · `S12` (→ S54) · `S07` + `S08` (CLI-Pins **vor** S17) · `S26` (Start der DUP-Kette; Rebase auf S43 nötig, Regionen disjunkt).

**Welle 2 — sobald Slots frei (alle voneinander unabhängig):**
`S16` (nach S14) · `S27` (nach S26; erst nach Merge S36/S43 und nach S50/S51 — sonst am Ende der Welle) · `S47` (nach S48) · `S54` (nach S12) · `S11` · `S45`, `S46`, `S61` (Laufzeit-Gewinne, isoliert) · `S55` (isoliert) · `S23`, `S34`, `S39`, `S40`, `S41`, `S42`, `S50`, `S51`, `S56`, `S57`, `S58` (je eine Produktivdatei, keine Kreuzung untereinander) · `S06`, `S05`, `S19`, `S21`, `S33`, `S63`, `S64` (isoliert) · `S01`/`S02` **nur in gekürzter Form** (Abschnitt 2).

**Welle 3 — Ketten-Enden und Nachzügler:**
`S28` → `S29` (ein Agent, seriell) · `S20` → `S31` (S31 ohne refresh-universe-Teil, nach S35-Merge) · `S32` · `S30` (Sollwerte an Reihenfolge anpassen) · `S13` (nach S47/S28) · `S52` (nach S24-Merge) · `S15` (nach S22/S25-Merge + S16) · `S04` (nach S44) · `S60` (nach S25-Merge) · `S65` (nach S63).

**Welle 4 — zwingend zuletzt:**
`S17` (mit Ausschluss der S07/S08-gepinnten Skripte) · `S18` (nach allen lib-Änderungen).

Regel für den Koordinator: jeder Agent, dessen ZIEL-DATEIEN in Tabelle 1 stehen, macht vor dem Push `git fetch origin main && git rebase origin/main` und fährt die im Brief genannten Bestandstests erneut — ein PR gilt nur mit Rebase-Stand als grün.
