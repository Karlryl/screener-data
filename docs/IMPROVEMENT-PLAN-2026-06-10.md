# Screener-Verbesserungsplan 2026-06-10

> **SUPERSEDED — historischer Plan, Tag 239 era.** Referenzierte Artefakte
> (`SCORE_WEIGHTS`, `engine-cli-tests.js`, `engine-v7.3.js`,
> `score-orchestrator.js`, `methods-history/`-Groessenangaben) beziehen sich
> auf eine seither entfernte Engine-Generation. Aktueller Stand: `README.md`,
> `CLAUDE.md`, Engine `src/scoring/`. Nicht mehr als aktive Prioritaetenliste
> lesen.

> Synthese aus: ROADMAP-detailliert-2026-06-05, CONTEXT.md-Punchlist, Audit-Reports
> (insb. 2026-06-08 Notes + 2026-06-10 Resolution), Tag-208-Research (academic /
> competitive / data-sources / UI) und frischen Messungen aus dieser Session.
> Priorisierung: Impact × Aufwand, korrektheit-zuerst.

## Executive Summary

Der Screener ist nach Tag 237–239 korrektheitsseitig solide: alle 19 triagierten
Audit-Findings sind aufgelöst, 3 Test-Suiten grün, Live-Verifikation bestanden.
Die größten verbleibenden Hebel sind **(1) Zuverlässigkeit des täglichen Pulls**
(429-Stürme, Worker-Pool vs. interne Queue), **(2) Benchmark-Alpha statt
Universums-Median** im Walk-Forward (SPY/QQQ/IWM fehlen in der Price-History),
**(3) Repo-/Artefakt-Größe** (methods-history ~14 MB/Tag in die git-History,
screener.html 47 MB Voll-Embed) und **(4) Effektivitäts-Feedback in die
Gewichte** (method-effectiveness wird gemessen, fließt aber nicht ins Scoring).

## Top 10 (priorisiert)

| # | Verbesserung | Was konkret | Impact | Aufwand |
|---|-------------|-------------|--------|---------|
| 1 | **Run-Dauer am 240-min-Limit entschärfen** | Gemessen (gh run list, Juni): 3h40–3h59:57 bei `timeout-minutes: 240`, Run vom 09.06. FAILED. Die Pipeline klebt am Ceiling — jeder Universums-Zuwachs kippt sie. Kurzfristig: Pull-Budget straffen (165-min-Step), Price-Pull-Window prüfen; strukturell: Sharding (#7) vorziehen. (Hinweis: Benchmark-α via SPY/QQQ/IWM ist entgegen erstem Verdacht bereits implementiert — Tag 134 P3.3 + F-BT-002-Fallbacks; die lokale Warnung ist ein Stub-Daten-Artefakt.) | HOCH | KLEIN–MITTEL |
| 2 | **Pull-Reliability-Pass (F-003)** | Worker-Pool (concurrency 8) konkurriert mit der yahoo-finance2-internen Queue → 429-Stürme. Konkret: yahoo-finance2 `queue.concurrency` explizit setzen, eigenen Pool auf I/O-Warten reduzieren, 429-Backoff zentralisieren. Audit-Notes 2026-06-08. | HOCH | MITTEL |
| 3 | **methods-history aus git** | ~14 MB/Tag wachsen in die git-History (~5 GB/Jahr); Worktree läuft auf ~1,5 GB zu (90 Dateien × 16 MB). Das gitignorete NDJSON-Archiv existiert bereits (`external-data/methods-history-archive/`) — Schritt: methods-history/ komplett gitignoren, Effectiveness-Cache aus Archiv+aktuellen Vintages speisen, CI-Artefakt statt Commit. | HOCH | MITTEL |
| 4 | **Effektivität → Gewichte (kontrolliert)** | `method-effectiveness.js` misst PASS-vs-FAIL-Spreads pro Methode, aber `SCORE_WEIGHTS` sind statisch. Schritt 1 (sicher): Effektivitäts-Ranking sichtbar im Dashboard (Vertrauen + manuelle Entscheidungsgrundlage). Schritt 2 (später): halbautomatische Gewichts-Reviews mit n≥30-Gate und Fixture-Hash-Bless-Prozess. | HOCH | MITTEL |
| 5 | **screener.html Daten-Slice** | 47 MB Voll-Embed → Initial-Load auf Mobile praktisch unbenutzbar. Tag-220b-Muster wiederverwenden (TOP_N-Slice + STOCK_DATA_MAP): Top-N pro Tab voll embedden, Rest lazy aus `screener-data.json` via fetch (GitHub Pages erlaubt fetch im selben Origin). Ziel < 10 MB. | HOCH | MITTEL–GROSS |
| 6 | **Dormante Methoden aktivieren (Roadmap P0.2)** | Beneish/Ohlson/Penman-Nissim/Magic-Formula sind teils `computable=false`, weil Bilanz-/IS-Felder fehlen. SEC-XBRL läuft bereits monatlich — fehlende Felder (AR/PPE/CL/LTD/SGA/Dep/OCF) aus `fundamentals-cache/` in Snapshots mergen statt auf Yahoo zu warten. | MITTEL–HOCH | MITTEL |
| 7 | **Matrix-Sharding des Pulls (Roadmap P2)** | Bei 19k+ Tickern projiziert ~14,6 h — GH-Actions-Matrix (z.B. 4 Shards à Ticker-Range, Merge-Step für Snapshots+Manifest). Sketch existiert (tag226b). Erst nötig, wenn Universum > ~17k oder Timeout-Nähe; vorbereiten jetzt, schalten später. | MITTEL | GROSS |
| 8 | **ADR-001 Phase 3+5 abschließen** | `engine-cli-tests.js` auf score-aggregator migrieren; `engine-v7.3.js`/`score-orchestrator.js`/`diagnose-spec.js` deprecaten oder löschen (Löschung = Karls Freigabe). EIN Scorer = kein Drift-Risiko. | MITTEL | MITTEL |
| 9 | **Score-Erklärbarkeit im UI ausbauen (Roadmap P3.8)** | Pro Pick: Methoden-Beitrags-Breakdown ("warum dieser Score"), Top-3 positive/negative Treiber direkt in der Zeile/Modal. Daten sind in `allResults` vorhanden — reine Generator-Arbeit. | MITTEL | MITTEL |
| 10 | **Coverage-Gate-Kalibrierung (P4.12)** | Prozent-Gates ziehen sich beim Universum-Wachstum still zusammen (Memory `ci_coverage_gate_calibration`). Gates auf absolute Mindestzahlen + Prozent-Korridor umstellen. | MITTEL | KLEIN |

## Quick Wins (< 1 Tag)

- **#1 Benchmark-Tickers** (siehe oben) — wenige Zeilen.
- **`_debtPartial` im UI sichtbar machen**: Flag wird seit Tag 238 in net-debt-ebitda components geführt — als ≈-Marker neben ND/EBITDA rendern.
- **`ccyAmbiguous`-Report**: 49 Snapshots tragen das Flag; wöchentliche Liste in pipeline-health, damit OTC-Währungsfälle sichtbar bleiben (3 davon werden seit Tag 238 übersprungen).
- **Stop des `QuoteSummary financial statements`-Warnspams** im Pull-Log via `validation:{logErrors:false}` (Memory `yahoo_finance2_schema_spam`) — Logs werden lesbar.
- **picks-history `latest.json` Konsistenz-Check** in pipeline-health (latest muss auf existierende Vintage-Datei zeigen).

## Nach Themenfeld

### Scoring & Methodik
- Effektivitäts-Feedback (Top-10 #4); Regime-Bewusstsein: `macro-regime.js` (BULL/BEAR/SIDEWAYS) existiert, wird aber im Scoring nicht genutzt — als erstes nur ANZEIGEN (Badge im Header), Regime-abhängige Gewichte erst nach Datenlage.
- Kontinuierliche Scores statt hartem PASS/FAIL für DIAGNOSTICs: normalizeMethodScore graduiert bereits nahe Threshold — die Graduierung auf mehr Methoden ausweiten, DATAGUARDs bleiben binär (fail-closed).
- Sektor-Neutralisierung: sector-medians v2 (region-aware) existiert — Lücke: Methoden, die absolute Schwellen nutzen, wo Sektor-Relativierung evidenzbasiert besser wäre (ROIC-Familie ist schon umgestellt; ev-ebitda/fcf-yield prüfen).

### Daten & Quellen
- SEC-XBRL-Merge (Top-10 #6) ist der größte ungenutzte Datenschatz im Repo (läuft monatlich, wird kaum konsumiert).
- Short Interest (FINRA/Nasdaq, frei, 2×/Monat) — neues Squeeze-/Crowding-Signal; ToS prüfen.
- Estimates-Revisionen: Yahoo `earningsTrend` (epsTrend 7d/30d/60d/90d) wird nicht extrahiert — Revision-Breadth-Methode (`analyst-revision-breadth.js` existiert als Plugin!) braucht genau das.
- Insider: Form-4-Pagination seit Tag 239 vollständig — nächster Schritt Form 3/5 + 10b5-1-Plan-Metadaten fürs Conviction-Scoring.

### UI & UX (Redesign läuft in dieser Session)
- Modern-Terminal-Restyle (Token-System, Radius, Tiefe, Light-Theme) — umgesetzt 2026-06-10.
- Daten-Slice (Top-10 #5) ist die wichtigste UX-Maßnahme überhaupt (Ladezeit).
- Score-Breakdown (Top-10 #9), Walk-Forward-α + Methoden-Effektivität sichtbar (P3.9) — "warum vertrauen wir dem Screener".
- Vergleichsansicht (2–4 Ticker side-by-side aus dem Modal heraus) — Tag-208-UI-Research §Koyfin.

### Architektur & Skalierung
- methods-history aus git (Top-10 #3), Sharding (#7), ADR-001 (#8).
- Recovery bei Mid-Run-Tod: Snapshots sind ephemeral pro Runner — stirbt der Run bei Stunde 3, ist alles weg. Partial-Commit-Checkpoint (z.B. nach jedem 25%-Chunk Snapshots als Artefakt sichern) oder Sharding löst es strukturell.
- `screener-data-fix/`-Ordner + verwaiste `.git/worktrees`-Einträge lokal aufräumen (Verwirrungsrisiko; kein Repo-Inhalt).

## Nicht empfohlen / verworfen

- **totalDebt=null bei fehlender Komponente** (Audit-Vorschlag F-NY-002): vernichtet Leverage-Daten für 12,4 % des Universums — stattdessen Flag-Sichtbarkeit (umgesetzt Tag 238).
- **Vollautomatische Gewichts-Optimierung** auf Walk-Forward-Daten: n zu klein, Overfitting-Risiko hoch, Fixture-Hash-Disziplin würde zur Farce. Halbautomatisch mit menschlichem Review (siehe #4).
- **Frontend-Framework-Einführung** (React etc.) fürs Dashboard: 47-MB-Problem ist ein Daten-, kein Framework-Problem; zero-dep bleibt.
