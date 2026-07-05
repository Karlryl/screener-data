# Sector-Specific Growth Formulas — Design Spec

**Date:** 2026-06-12
**Status:** Draft for review
**Author:** Karl + Claude (brainstorming → spec)
**Evidence base:** Obsidian vault `Jarvis/Knowledge/Trading/growth-screener/` (hub: `growth-screener-knowledge-base`). Every design rule below traces to a graded, cited note there.
**Companion:** the screener output feeds **manual Elliott-Wave entry timing** (`elliott-wellen-referenz`). This spec covers the *fundamental formula* only; chart timing stays with the human.

---

## 1. Problem

The screener scores every ticker against three sector-agnostic **modes** (HYPERGROWTH, QUALITY_COMPOUNDER, TURNAROUND). The Hypergrowth mode leans on Rule of 40, which:

- was designed to measure **SaaS company health, not stock returns** (evidence: `rule-of-40-and-successors`, grade MIXED/WEAK on returns);
- **weights growth and margin equally**, though markets pay ~2–3× more per point of growth (Bessemer Rule of X);
- is **SaaS-shaped** and misfits other sectors (semis, hardware, consumer);
- ignores **valuation** — a 60-point name can be priced for perfection.

Karl's workflow already separates concerns correctly: *fundamentals qualify a name; the Elliott count decides the entry*. The gap is that the **fundamental qualifier is one-size-fits-all**. Different sectors reward different things, and "growth" measured naively (asset/revenue bloat) actually predicts **low** returns (Cooper-Gulen-Schill; grade STRONG).

## 2. Goal

Add a **sector-routed scoring axis**: each ticker is scored by a formula **tailored to its sector**, sharing a common 4-pillar skeleton but with sector-appropriate metrics, weights, and calibration. Wave 1 ships two sector configs:

1. **Software & Communication Services** (GQV-style: growth-efficiency, quality, growth-adjusted value).
2. **Semiconductors & Tech Hardware** (CAG-style: cycle-adjusted growth, cycle-position, cycle-normalized value).

Output is a **continuous 0–100 score + warning lamps**, never a hard filter (except existing data-integrity DATAGUARDs). The bar: a Wave-1 sector formula must **beat the current Hypergrowth mode within its own sector** on walk-forward before it is promoted to a weighted CORE role.

### Non-goals (YAGNI)
- No auto-trading, no buy/sell signal, no broker integration (unchanged).
- No new data sources — Yahoo fundamentals / SEC XBRL / OHLCV only.
- No rebuild of metrics that already exist (see §4).
- No technical/timing logic inside the formula (momentum stays DIAGNOSTIC context, not a scored input).
- Wave-1 is **two sectors**; the other GICS sectors are scoped in `sector-overview-map` for later waves, not built now.

## 3. Key realization — most building blocks already exist

The codebase already ships ~83 methods, including the evidence-backed ones this design needs. **The new work is re-weighting + routing + ~4 genuinely new methods, not a from-scratch factor library.**

| Evidence-backed input (from the KB) | Status in code | Action |
|---|---|---|
| Gross profitability (Novy-Marx GP/TA) | `gross-profitability` (DIAGNOSTIC) | **reuse** |
| Asset-growth anomaly (Cooper-Gulen-Schill) | `asset-growth-anomaly`, `asset-growth-divergence` | **reuse** as penalty |
| Rule of X (growth-weighted) | `rule-of-x` (weighted 0.10 in HG) | **reuse**, re-weight per sector |
| SBC / dilution drag | `sbc-trend`, `sbc-growth-ratio`, `sbc-revenue`, `buyback-yield`, `rule-of-40-sbc-adjusted`, `capex-vs-sbc-quality` | **reuse** |
| Revenue/earnings acceleration | `revenue-acceleration-yoy`, `quarterly-revenue-acceleration`, `operating-margin-acceleration`, `gross-margin-acceleration` | **reuse** |
| Sector-relative ranking | `sector-relative-roic` + `sector-medians-compute.js` (sub-profiles, p25/p75/p90, region-aware) | **reuse infra** |
| Gross-margin trend / quality | `gross-margin-stability`, `margin-quality`, `earnings-power-stability` | **reuse** |
| FCF conversion / earnings quality | `fcf-conversion-stability`, `operating-cashflow-coverage`, `sloan-ratio` | **reuse** |
| Magic Formula / Penman-Nissim / intangible-ROIC | `magic-formula`, `penman-nissim-decomposition`, `intangible-adjusted-roic` | **reuse** (valuation/quality context) |
| PEAD / momentum (context only) | `earnings-surprise-momentum`, `price-momentum-12-1` | **reuse as DIAGNOSTIC context** |

### Genuinely new methods to build (all start DIAGNOSTIC)
| New method | Pillar | Sector | Evidence note | Grade |
|---|---|---|---|---|
| `ev-gross-profit` (EV/GP, sector-relative) | Value | all | `growth-valuation-without-pe` | MIXED→STRONG |
| `ev-sales-growth-residual` (distance below sector EV/Sales-vs-growth regression line) | Value | software | `growth-valuation-without-pe` §3 | MIXED |
| `cycle-normalized-valuation` (EV/Sales vs firm's own ≥5y median) | Value | semis | `sector-semiconductors-hardware` §4 | STRONG (conceptual) |
| `inventory-cycle-divergence` (inventory growth − revenue growth, DSI trend) | Quality / cycle lamp | semis | `sector-semiconductors-hardware` §1 | MIXED→STRONG |
| `gross-margin-cycle-position` (GM percentile within firm's own ≥5y range) | Cycle position | semis | `sector-semiconductors-hardware` §2 | MIXED |
| `through-cycle-revenue-cagr` (4–5y CAGR) | Growth | semis | `sector-semiconductors-hardware` §5 | STRONG (conceptual) |

(`working-capital-trend` already partially covers inventory/receivables-vs-revenue; `inventory-cycle-divergence` is the semi-specific, cycle-framed cut.)

## 4. Architecture

```
ticker snapshot
   │
   ▼
sector classifier  ──►  sub-profile (existing: SAAS, SEMI, …) + GICS sector
   │                    (reuses manipulation-filters.js sub-profile logic + watchlist sector tags)
   ▼
sector router  ──►  picks a SECTOR_PROFILE (weight set + method list + calibration)
   │                fallback: GENERIC profile = today's mode behavior (no regression)
   ▼
method runner (existing)  ──►  per-method {pass, value, computable, components}
   │
   ▼
sector-formula aggregator (NEW, parallel to score-aggregator.js)
   │   • 4 pillars: Growth-efficiency · Growth-quality · Value(growth/cycle-adjusted) · Balance/risk lamps
   │   • pillar = weighted blend of (mostly existing) normalized method scores
   │   • missing pillar → renormalize over available pillars + set coverage flag (never penalize)
   │   • graded penalties + warning lamps (dilution, rich-valuation, inventory-build, decel)
   ▼
{ sectorScore 0-100, pillarBreakdown, lamps, coverage }  ──►  dashboard modal + walk-forward snapshot
```

### Integration constraints (from the codebase)
- **Fixture-hash invariant** (`tag28-tests.js`): any change to a method inside `SCORE_WEIGHTS` mutates the pinned aggregator hash. Therefore: **new methods are DIAGNOSTIC** (not in any `SCORE_WEIGHTS`), and the **sector-formula aggregator is a separate module** whose output is *not* part of the existing fixture hash until deliberately promoted. This mirrors the project's Tag-211 discipline.
- **Sector medians** are already computed per sub-profile with percentiles and region buckets in `sector-medians-compute.js`. The new `ev-sales-growth-residual` adds a **per-sector regression** (EV/Sales on revenue growth) as an extension of that file — the natural home.
- **Walk-forward** (`scripts/walk-forward-perf.js`, `scripts/method-effectiveness.js`) already measures 28d/84d forward returns on snapshotted picks. The sector formula is validated through the same path, **sliced by sector**.
- **Coverage / freshness gates** and atomic-write conventions are unchanged.

## 5. The 4-pillar skeleton

| Pillar | Question | Software config | Semis config |
|---|---|---|---|
| **Growth-efficiency** | Is growth strong *and* efficient? | `rule-of-x` weighted (α≈2–3) + FCF margin | `through-cycle-revenue-cagr` (secular) |
| **Growth-quality** | Is the growth durable, organic, non-dilutive? | GM trend, acceleration, `sbc-*`/dilution (heavy), `fcf-conversion-stability`, `asset-growth-divergence` | `inventory-cycle-divergence`, `gross-margin-cycle-position`, R&D-persistence, capex/rev, dilution |
| **Value (adjusted)** | Cheap *for its growth/cycle*, no P/E | `ev-sales-growth-residual` + `ev-gross-profit` | `cycle-normalized-valuation` (EV/Sales vs own median) |
| **Balance / risk lamps** | Solvency + red-flag lamps | net cash, runway if FCF<0; lamps: dilution, rich-valuation, decel | net cash, cycle-peak lamp (inventory+margin), capex overheating |

Pillar weights start roughly equal and are moved by walk-forward. Cross-cutting rules (all from the KB): **no hard filters beyond data DATAGUARDs**; **haircut backtested weights ~50%** (McLean-Pontiff decay); **sector-percentile calibration + a few absolute anchors** so a weak sector isn't flooded yet a whole-sector bubble isn't rewarded.

### Sub-industry routing inside a sector
- **Communication Services** is *not* one formula: ad/media/interactive → software-like config; **telecom → excluded** from the growth screen (near-zero growth, high debt). Route by sub-industry tag.
- **Hardware vs pure semis**: branded hardware (Apple-style) routes to **quality-compounder** logic, not the inventory-cycle module; the cycle module is for chips/memory/equipment.

## 6. Build sequence

1. **Spec sign-off** (this doc).
2. **Implementation plan** via *writing-plans* (next step).
3. **Software config first** (heaviest data coverage, fastest 28d/84d feedback):
   a. `ev-gross-profit` + `ev-sales-growth-residual` (+ regression in `sector-medians-compute.js`), as DIAGNOSTIC.
   b. Sector classifier + router + `SECTOR_PROFILE` for SOFTWARE (reusing existing methods, new weights).
   c. Sector-formula aggregator module (separate from `score-aggregator.js`).
   d. Dashboard modal: sector score + pillar breakdown + lamps.
   e. Walk-forward sliced by sector; compare vs current HG mode on software names.
4. **Semis config**: new cycle methods (`through-cycle-revenue-cagr`, `inventory-cycle-divergence`, `gross-margin-cycle-position`, `cycle-normalized-valuation`) + SEMI profile + sub-classification.
5. **Promote** a sector formula to a weighted/visible role **only** after it demonstrably beats the incumbent in its sector (walk-forward), updating the fixture hash deliberately.

## 7. Testing

- New methods get unit fixtures (existing `tag28-tests.js` pattern); each must be **fixture-hash safe** (DIAGNOSTIC, not in `SCORE_WEIGHTS`) until promotion.
- Sector classifier: deterministic routing tests (known tickers → expected profile; telecom excluded; branded-hardware → compounder).
- Sector-formula aggregator: golden-output fixture pinned **independently** of the production `SCORE_WEIGHTS` hash.
- Walk-forward regression: sector-sliced 28d/84d alpha vs incumbent, with the `evidenceGate`/min-N discipline already in `method-effectiveness.js` (no alpha claims below sample threshold).

## 8. Open calibration questions (resolve during build, do not assume)

- Exact **α** per sector for the Rule-of-X pillar (2.0 / 2.3 / 3.0?) — fit, don't guess.
- Pillar weights per sector — start equal-ish, let walk-forward move them.
- Compute the EV/Sales-vs-growth **regression live each run** (in `sector-medians-compute.js`) vs a rolling fit.
- RPO / deferred-revenue **coverage threshold** before wiring it as a bonus input.
- Cycle-normalization window for semis (5y vs 7y vs full-cycle median).
- Does Communication Services need 2–3 sub-industry branches or one config?

## 9. Honesty / provenance caveat

The evidence base was built from a **successful targeted web sweep of primary sources**, but several effect-size numbers were read from **search summaries, not full PDFs** (marked `⚠VERIFY` in the KB). Before any number becomes a hard threshold or weight, verify it against the primary source. The initial 170-agent deep-research fan-out was aborted by an API spend limit and produced nothing; re-running it later would harden the base further. None of the `⚠VERIFY` numbers are load-bearing in this design — they inform *direction* (which pillar, which sign), and the actual weights are set by **walk-forward**, not by literature point-estimates.

---

## Appendix A — Evidence → design rule trace

| Design rule | Evidence note | Grade |
|---|---|---|
| Sector-specific formulas; ~3 reusable engines | `sector-overview-map` | — |
| Gross profit/assets as universal profitability | `factor-evidence-foundations` | STRONG |
| Penalize asset-growth bloat + dilution | `factor-evidence-foundations`, `growth-quality-and-red-flags` | STRONG |
| Don't extrapolate long CAGR; weight recent trend | `factor-evidence-foundations` | STRONG |
| Rule-of-X weighting, sector-calibrated, continuous | `rule-of-40-and-successors` | MIXED |
| Value = distance below sector line / own cycle median; never raw P/E | `growth-valuation-without-pe`, `sector-semiconductors-hardware` | MIXED / STRONG-concept |
| No hard filters except DATAGUARDs — graded penalties + lamps | `growth-quality-and-red-flags`, `screening-to-chart-handoff` | — |
| Haircut backtested weights ~50% | `factor-evidence-foundations` | STRONG |
| Validate per sector via walk-forward before CORE promotion | `screening-to-chart-handoff` | — |
| Formula qualifies, chart times — strictly separate | `screening-to-chart-handoff` → `elliott-wellen-referenz` | — |
