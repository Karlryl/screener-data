# Screener — Detaillierter Bauplan (2026-06-05)

> **Status: PLAN.** Auf Karls ausdrücklichen Wunsch („Erst nur Plan") **noch NICHT umgesetzt.**
> Grundlage: `CONTEXT.md`, `PROJECT-STATUS.md`, `audit-reports/`, Architektur-Review 2026-06-05.
> Erstellt aus dem Jarvis-Kontext heraus; lebt hier im Screener-Repo.

## Leitplanken (bindend — aus CONTEXT.md, nicht verletzen)
- Node unter `C:\Program Files\nodejs\node.exe` (nicht auf PATH).
- `FTS_CACHE_VERSION` nie ändern (=2).
- `methods/index.js` nie parallel editieren (Race) — Koordinator-Pattern / Wave-serialisieren.
- Nie pushen ohne Karls Ansage; nie `--no-verify`.
- **Keine** hardcoded Ticker-Ausschlüsse — Guard fixen statt Anchor ausschließen.
- Nach jeder Methodenänderung: `tag28-tests.js` + `engine-cli-tests.js` + `tests/integration-anchor-test.js` (Anchors 10/10, Fixture-Hash stabil).
- `audit-classifications.js` bleibt gitignored.
- 10 Anchors müssen PASS bleiben: NVDA/MSFT/PLTR/META/COST/GOOG/AVGO/V/CRDO/MELI.

---

## Prioritäten-Roadmap

### P0 — Korrektheit & Integrität (höchster Hebel, zuerst)
1. **FX-Fix verifizieren (Run #110/#111).** Bestätigen, dass `_convertSnapshotToUSD` auf intl-Tickern feuert (Tag 229a/230a Probes). ~46,5 % des Universums war math. falsch in `fcf-yield`/`ev-ebitda`/`peg`/`pre-commerciality-megacap-guard`.
   - Files: `pull-yahoo.js`, `snapshots/`. Test: Stichprobe TSM / BABA / 9988.HK Ratios plausibel. Risk: **hoch** (Kern-Korrektheit).
2. **Dormant-Methoden aktivieren.** Beneish/Ohlson + Penman-Nissim + Magic-Formula sind `computable=false`, bis der Puller Bilanz-/IS-Felder liefert (AR/PPE/CL/LTD/SGA/Dep/OCF).
   - Files: `pull-yahoo.js` (Feld-Extraktion), betroffene `methods/*`. Test: computable-Rate steigt; Tag-229b Walk-Forward bleibt directionally-correct. Risk: mittel.
3. **`detect-changes.js` METHOD_RECOVERED (Tag 229c).** Verifizieren, dass incomputable→computable-Events nicht mehr verschluckt werden (`wasComputable`-Logik).

### P1 — Scoring-Stack-Konsolidierung (ADR-001 Phase 3 + 5)
4. **Phase 3:** `engine-cli-tests.js` auf `methods/score-aggregator.js` migrieren; `scoreTrackA`/`scoreTrackB` entfernen.
5. **Phase 5:** `engine-v7.3.js` + `score-orchestrator.js` + `diagnose-spec.js` löschen **oder** Deprecation-Marker setzen.
   - **→ Löschung = Karls Freigabe nötig** (nichts ohne Ansage löschen). Nutzen: EIN Scorer, kein Drift-/Verwirrungs-Risiko.

### P2 — Skalierung der Pull-Pipeline
6. **Matrix-Sharding für `pull-yahoo.js`.** Bei 19k+ Tickern projiziert ~14,6 h → über GitHub-Actions-Matrix in N Shards parallel (Sketch in `audit-reports/2026-05-17-tag226b-run-109-eta.md`).
   - Files: `.github/workflows/daily-pull.yml`, `pull-yahoo.js` (Shard-Range-Parameter), Merge-Schritt der Teil-Snapshots. Risk: mittel (CI-Umbau). Entscheidung: GH-Matrix vs. self-hosted Runner.

### P3 — Dashboard-Professionalisierung (Karls /goal: „professioneller")
7. `screener.html` / `modes-report.html`: UX-Politur — konsistente Bloomberg-Optik, schnellere Initial-Last (Daten-Slice statt Voll-Embed, vgl. Tag 220b 267 MB→9,7 MB), mobile-tauglich, Ladezustände, Empty-States.
8. Per-Ticker-Detail: ΔScore-Sparklines, Methoden-Beitrags-Breakdown (warum Pick), Quellen-Links.
9. Performance-Transparenz: Walk-Forward-α + Methoden-Effektivität sichtbar im Dashboard (Vertrauen).

### P4 — Daten- & Test-Härtung (laufend)
10. `lib/atomic-write.js` Durability (Tag 230c) final verifizieren (Windows-EPERM-Retry, parent-dir fsync, writeSync-Loop) — kritisch auf Windows+OneDrive.
11. `walk-forward-perf.js` Look-Ahead-Bias (Tag 231a) verifizieren gefixt (kein inflationiertes α).
12. Coverage-Gate-Kalibrierung: Prozent-Gates ziehen sich an, wenn das Universum wächst (Memory `ci_coverage_gate_calibration`).

### P5 — (optional) Jarvis-Anbindung [nur falls Karl den Scope erweitert]
13. **Read-only Export** des Screener-Outputs (Top-Picks, `modes-report`, `macro-regime`) als tägliches Markdown nach `Jarvis/Knowledge/Markt/` → speist Jarvis-Q&A + Markt-Briefing („LaRossa-Report"). **Nicht-invasiv**, ändert den Screener selbst nicht.

---

## Empfohlene Reihenfolge
**P0 → P1 → P2 → P3**, P4 durchgehend. P5 erst auf Scope-Erweiterung.
Pro Schritt: Tag-Konvention beibehalten, 3 Test-Suites grün, Anchors 10/10, committen (nicht pushen).

## Entscheidungen, die Karl braucht
- **Phase-5-Löschungen** (`score-orchestrator.js`, `diagnose-spec.js`, `engine-v7.3.js`): löschen oder nur deprecaten?
- **Sharding-Architektur:** GH-Actions-Matrix vs. self-hosted Runner.
- **P5 Jarvis-Anbindung:** ja/nein (aktuell out-of-scope, da „Erst nur Plan").
