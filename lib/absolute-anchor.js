/**
 * lib/absolute-anchor.js — Reusable Absolute Anchor for Screener Formulas
 *
 * STATUS: verified-DESIGN, Konstanten [TODO-CAL]; Norm-Tabelle nur für medtech_devices abgestimmt.
 * system_app_software und fabless_semi sind mit '-TODO-retrofit' markiert → noch nicht retrofittet.
 *
 * Governance:
 *   SI-1: Hartes Gate (gateOpen) auf Basis absoluter Sektor-Normen — für den Shortlist-Cut gedacht,
 *         NICHT als harter Score-Kill eingebaut (der REL-Pfad läuft separat in court-score.js).
 *   SI-2: Absolute Kaliber-Achse (absKaliber) als Ergänzung zum cross-sektionalen REL-Score.
 *   SI-3: blendScore kombiniert ABS + REL; β=0-Pfad = pure REL → faithful-refactor-Anker für den
 *         späteren SaaS/Fabless-Retrofit ohne Verhaltensänderung am bestehenden court-score.js.
 *
 * Design-Entscheide:
 *   - eff-Komponente in absKaliber nutzt q(opMargin, norm.eff) direkt (nicht max der drei Arme).
 *     Begründung: einfachste, deterministischste Implementierung; die Disjunktions-Logik von effGatePass
 *     ist nur für das binäre Gate (SI-1) gedacht. Beim Retrofit kann eff-q erweitert werden.
 *   - Alle Funktionen sind rein und deterministisch: kein fs, kein Netz, kein Date, kein Math.random.
 *   - null/NaN → 0 in q() (sichere Null, kein Fehler-Throw).
 *
 * Abweichung von court-score.js-Mathematik (für späteren Retrofit):
 *   court-score.js nutzt pseudo-z = (raw - Median) / MAD + tanh-Sättigung (cross-sektional, relativ).
 *   Dieses Modul nutzt einen linearen Clip zwischen absoluten Floor/Elite-Ankern (SI-2-Definition).
 *   Der β=0-Pfad (blendScore mit beta=0) mappt auf 100*rel und ist ein faithful-refactor-Anker:
 *   Wenn in einem zukünftigen Retrofit court-score.js das 'core'-Signal als 'rel'-Argument übergibt,
 *   entsteht kein Verhaltens-Bruch für SaaS/Fabless (die ABS-Normen sind noch -TODO-retrofit).
 */

'use strict';

// ---------------------------------------------------------------------------
// Sektor-Norm-Tabelle (Konstanten [TODO-CAL])
// ---------------------------------------------------------------------------

/**
 * NORMS — eingefrorene Sektor-Norm-Tabelle.
 * Jeder Eintrag hat:
 *   id:     versionierter Bezeichner (Format: '<bucket>-norms-<datum>')
 *   growth: { floor, elite } — minimale bzw. Ausnahme-Wachstumsrate (jährlich, relativ)
 *   gm:     { floor, elite } — Bruttomarge (0..1)
 *   eff:    { floor, elite } — operative Effizienz-Marge (opMargin; 0..1)
 *
 * Platzhalter-Einträge haben id: '...-TODO-retrofit' und null-Felder → noch nicht abgestimmt.
 * Beim Retrofit: id updaten, Felder befüllen, Tests erweitern.
 */
const NORMS = Object.freeze({
  medtech_devices: Object.freeze({
    id: 'medtech-norms-2026-06-20',
    growth: Object.freeze({ floor: 0.15, elite: 0.29 }),
    gm:     Object.freeze({ floor: 0.55, elite: 0.70 }),
    eff:    Object.freeze({ floor: 0.08, elite: 0.25 }),
  }),

  // diagnostics_lst (D&LST) — gefrorene Norm-Zeile (Konstanten [TODO-CAL]).
  // COHORT-AWARE GM (Spec §1/§3): die GM-Ökonomie der zwei Kohorten differiert materiell
  // (TMO ~41% vs IDXX ~58% würde eine gepoolte GM-Säule korrumpieren) → GM-NORMS PRO KOHORTE:
  //   dx:    gm floor 0.50 / elite 0.65 (sekulär, hohe Marge)
  //   tools: gm floor 0.38 / elite 0.58 (funding-zyklisch, bimodale Marge)
  // growth/eff sind kohorten-gemeinsam: growth floor 0.15 (gateOpen-Floor, latestOrganicYoY),
  //   eff floor 0.10 / elite 0.25 (FCF-Marge primär, OpM-Fallback — Spec §3).
  // absKaliber-Gewichte {growth .40, gm .20, eff .40} werden in court-score.js gesetzt (nicht hier).
  // Die kohorten-spezifischen Einträge teilen sich die EINE normTableId 'dlst-norms-2026-06-20'.
  diagnostics_lst: Object.freeze({
    id: 'dlst-norms-2026-06-20',
    growth: Object.freeze({ floor: 0.15, elite: 0.30 }),
    gm:     Object.freeze({ floor: 0.38, elite: 0.65 }), // gepoolter Fallback (nicht für Scoring genutzt)
    eff:    Object.freeze({ floor: 0.10, elite: 0.25 }),
  }),
  diagnostics_lst_dx: Object.freeze({
    id: 'dlst-norms-2026-06-20',
    growth: Object.freeze({ floor: 0.15, elite: 0.30 }),
    gm:     Object.freeze({ floor: 0.50, elite: 0.65 }),
    eff:    Object.freeze({ floor: 0.10, elite: 0.25 }),
  }),
  diagnostics_lst_tools: Object.freeze({
    id: 'dlst-norms-2026-06-20',
    growth: Object.freeze({ floor: 0.15, elite: 0.30 }),
    // v1.2 Fix 1 [TODO-CAL]: tools-GM-Floor 0.30 -> 0.28 (war v1.1: 0.38 -> 0.30). ÖKONOMISCHE
    // BEGRÜNDUNG (1 Zeile): CRO-/Service-Modell-Tools (MEDP/IQV/CRL) laufen STRUKTURELL bei ~28-33% Brutto-
    // marge — ihre Kosten der Leistungserbringung sind personal-/standort-getrieben (Studien-Sites, klinisches
    // Personal), nicht consumable-getrieben wie Instrument-Ökonomik (>50% GM) → ein defensibler Service-Class-
    // Floor liegt am UNTEREN Rand dieses ~28-33%-Bands, nicht am 0.30-Punkt, der v1.1 exakt auf MEDPs 0.3006
    // (6bp Clearance) gesetzt war = OVERFIT. Bei 0.28 hat MEDP ~2.1pp echtes Headroom und eine kleine GM-Daten-
    // revision kann die Headline nicht mehr still kippen. Verifiziert NARROW: zwischen [0.28,0.30) liegt KEIN
    // weiterer Name (nächst-höhere tools-GM über 0.28 sind AVTR 0.327/CRL 0.330/IQV 0.333, alle bereits >0.30
    // und draußen am Growth-/eff-Gate, NICHT am GM-Floor) → der Floor-Move admittiert KEINEN neuen Namen.
    // elite bleibt 0.58 (absKaliber-Skala-Oberkante unverändert).
    gm:     Object.freeze({ floor: 0.28, elite: 0.58 }),
    eff:    Object.freeze({ floor: 0.10, elite: 0.25 }),
  }),

  // industrials_compounder CORE bucket — TWO cohorts by asset-intensity (Spec
  // formula-design-industrials-compounder-v1-2026-06-21.md §6.3). Re-frozen on the VINTAGE-TOLERANT
  // CORRECTED pool 2026-06-21 (heavy n=165, light n=141). 5 SCORED axes (gpa/growth/assetGrowthPenalty/
  // netIssuance/eff) + 1 future-BONUS (backlog, weight 0). gpa floor/elite + eff are COHORT-SPECIFIC;
  // growth / assetGrowthPenalty / netIssuance anchors are SHARED across cohorts. The 5-axis weighted-q
  // engine (absKaliberIndustrials) + the upstream deal-mask/spinoff-guard live in court-score.js /
  // court-screen.js (this table is read-only norm data, mirroring the dlst cohort entries). NORMS NOT
  // consumed by the 3-axis absKaliber/gateOpen path → existing buckets byte-identical.
  industrials_heavy: Object.freeze({
    id: 'industrials_heavy-norms-2026-06-21',
    cohortRule: 'meta.industry in {Specialty Industrial Machinery, Aerospace & Defense, Electrical Equipment & Parts, Building Products & Equipment, Farm & Heavy Construction Machinery, Tools & Accessories, Metal Fabrication, Pollution & Treatment Controls, Business Equipment & Supplies}',

    // Axis A — organic revenue growth (fractions); annual, deal-masked + cyclicality-floored + spin-off-guarded upstream
    growth: Object.freeze({ floor: 0.00, elite: 0.22 }),         // corrected: heavy floored-blend p90 23.3%

    // Axis B — gross profit / assets (Novy-Marx); cohort-specific (asset-intensity)
    gpa: Object.freeze({ floor: 0.05, elite: 0.40 }),            // corrected heavy p10 4.9% / p90 38.3%

    // Axis C — efficiency = 0.60*opMargin + 0.40*fcfMargin (op-weighted: lumpy FCF), fractions
    eff: Object.freeze({ floor: 0.00, elite: 0.18 }),            // corrected heavy p90 19.4%

    // Axis D — asset-growth penalty; transform on (-assetGrowth). +40% AG -> 0, <=0% -> 1
    assetGrowthPenalty: Object.freeze({ floor: -0.40, elite: 0.00 }),

    // Axis E — net-issuance penalty; transform on (-NSI). +10% dilution -> 0, >=3% buyback -> 1
    netIssuance: Object.freeze({ floor: -0.10, elite: 0.03 }),

    // ABS axis weights — SUM EXACTLY 1.0 (evidence-strength ordering)
    weights: Object.freeze({ gpa: 0.34, growth: 0.22, assetGrowthPenalty: 0.18, netIssuance: 0.12, eff: 0.14 }),

    growthBlend: Object.freeze({ wLatest: 0.60, wFloor: 0.40 }), // uncapped latest + multi-year floor
    effMix: Object.freeze({ wOp: 0.60, wFcf: 0.40 }),
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }), // BOTH required; sign-aware (positive only)
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }), // §4.3 NEW

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                 // n=165 -> full ABS+REL blend
    lamps: Object.freeze({ cycleWall: true, inventoryBlind: true, unbilledBlind: true, backlogFuture: true }),
  }),

  industrials_light: Object.freeze({
    id: 'industrials_light-norms-2026-06-21',
    cohortRule: 'meta.industry in {Engineering & Construction, Specialty Business Services, Railroads, Integrated Freight & Logistics, Trucking, Waste Management, Security & Protection Services, Consulting Services, Industrial Distribution, Rental & Leasing Services, Staffing & Employment Services}',

    growth: Object.freeze({ floor: 0.00, elite: 0.22 }),         // shared

    gpa: Object.freeze({ floor: 0.09, elite: 0.48 }),            // corrected light p10 9.5% / p90 48.1%

    eff: Object.freeze({ floor: 0.02, elite: 0.20 }),            // corrected light p90 22.5%
    assetGrowthPenalty: Object.freeze({ floor: -0.40, elite: 0.00 }),
    netIssuance: Object.freeze({ floor: -0.10, elite: 0.03 }),

    weights: Object.freeze({ gpa: 0.34, growth: 0.22, assetGrowthPenalty: 0.18, netIssuance: 0.12, eff: 0.14 }),
    growthBlend: Object.freeze({ wLatest: 0.60, wFloor: 0.40 }),
    effMix: Object.freeze({ wOp: 0.60, wFcf: 0.40 }),
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                 // n=141 -> full ABS+REL blend
    lamps: Object.freeze({ cycleWall: true, inventoryBlind: true, unbilledBlind: true, backlogFuture: true }),
  }),

  // consumer_staples_compounder CORE bucket — TWO cohorts by ECONOMIC MODEL (margin-driven branded vs
  // turns-driven distribution). Spec formula-design-consumer-staples-compounder-v1-2026-06-21.md §6.3
  // (Court DESIGN-PASS 4/4). Re-frozen on the CLEAN v1 country-guarded US pool 2026-06-21 (staples_branded
  // n=52, staples_distribution n=23). 5 SCORED axes (gpa/growth/assetGrowthPenalty/netIssuance/eff) — the
  // SAME axis set as industrials → reuse absKaliberIndustrials's engine via absKaliberStaples (a thin
  // delegate; the spec §6.4 calls for a parallel name). gpa AND eff floor/elite COHORT-SPECIFIC; growth /
  // assetGrowthPenalty / netIssuance anchors SHARED across cohorts. The GP/assets INVERSION (distrib p50
  // 49.5% > branded p50 28.4%, turns-driven) is exactly why the split is empirically forced. NORMS NOT
  // consumed by the 3-axis absKaliber/gateOpen path → existing buckets byte-identical.
  staples_branded: Object.freeze({
    id: 'staples_branded-norms-2026-06-21',
    cohortRule: 'meta.sector=="Consumer Defensive" && meta.industry in {Packaged Foods, Household & Personal Products, Beverages - Non-Alcoholic, Beverages - Brewers, Tobacco, Confectioners, Beverages - Wineries & Distilleries}',

    // Axis A — organic revenue growth (fractions); annual, deal-masked + spin-off-guarded upstream
    growth: Object.freeze({ floor: 0.00, elite: 0.18 }),            // clean annual: branded p50 +1.7%, p90 +18.0%

    // Axis B — gross profit / assets (Novy-Marx, load-bearing); cohort-specific
    gpa: Object.freeze({ floor: 0.15, elite: 0.60 }),               // clean annual branded p10 16.3% / p90 61.2%

    // Axis C — efficiency = 0.60*opMargin + 0.40*fcfMargin (op-weighted); fractions
    eff: Object.freeze({ floor: 0.05, elite: 0.27 }),               // branded op p50 14.5% / p90 29.3%, blend p90 22.9%

    // Axis D — asset-growth penalty; transform on (-assetGrowth). +40% AG -> 0, <=0% -> 1
    assetGrowthPenalty: Object.freeze({ floor: -0.40, elite: 0.00 }),

    // Axis E — net-issuance penalty; transform on (-NSI). +5% dilution -> 0, >=3% buyback -> 1
    netIssuance: Object.freeze({ floor: -0.05, elite: 0.03 }),

    // ABS axis weights — SUM EXACTLY 1.0 (STRONG profitability + discipline dominate; growth weak/non-persistent)
    weights: Object.freeze({ gpa: 0.36, assetGrowthPenalty: 0.18, eff: 0.16, growth: 0.18, netIssuance: 0.12 }),

    growthBlend: Object.freeze({ wLatest: 0.60, wMedian: 0.40 }),   // uncapped latest + multi-year median damper
    effMix: Object.freeze({ wOp: 0.60, wFcf: 0.40 }),
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),    // BOTH required; sign-aware (positive only)
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),
    sbcBonus: Object.freeze({ ratioHigh: 0.08 }),                   // SBC_HIGH advisory lamp threshold

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=52 -> full ABS+REL blend
    lamps: Object.freeze({ volumePriceBlind: true, maProxyOnly: true, inventoryBlind: true, cycleWall: true }),
  }),

  staples_distribution: Object.freeze({
    id: 'staples_distribution-norms-2026-06-21',
    cohortRule: 'meta.sector=="Consumer Defensive" && meta.industry in {Discount Stores, Food Distribution, Grocery Stores, Farm Products}',

    growth: Object.freeze({ floor: 0.00, elite: 0.18 }),            // shared; clean annual distrib p50 +4.1%, p90 +16.1%

    gpa: Object.freeze({ floor: 0.10, elite: 0.66 }),               // clean annual distrib p10 11.6% / p90 67.6% (turns-driven)

    eff: Object.freeze({ floor: 0.01, elite: 0.09 }),               // distrib op p50 3.8% / p90 8.4% — razor-thin (turns, not margin); blend p90 7.8%
    assetGrowthPenalty: Object.freeze({ floor: -0.40, elite: 0.00 }),
    netIssuance: Object.freeze({ floor: -0.05, elite: 0.03 }),

    weights: Object.freeze({ gpa: 0.36, assetGrowthPenalty: 0.18, eff: 0.16, growth: 0.18, netIssuance: 0.12 }),
    growthBlend: Object.freeze({ wLatest: 0.60, wMedian: 0.40 }),
    effMix: Object.freeze({ wOp: 0.60, wFcf: 0.40 }),
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),
    sbcBonus: Object.freeze({ ratioHigh: 0.04 }),

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=23 -> full ABS+REL blend
    lamps: Object.freeze({ volumePriceBlind: true, maProxyOnly: true, inventoryBlind: true, cycleWall: true }),
  }),

  // consdisc_expansion CORE bucket — TWO cohorts by ASSET-INTENSITY (asset-light Internet-Retail vs
  // store/real-estate-heavy retail+restaurants). Spec formula-design-consumer-disc-expansion-v1-2026-06-21.md
  // §6.2 (Court FINAL DESIGN-PASS 4/4). FROZEN NORMS reproduced VERBATIM from the spec §6.2 block. UNLIKE
  // industrials/staples, this bucket has FOUR scored axes (gpa/growth/assetGrowthPenalty/eff) + a SEPARATE
  // POST-SUM dilution haircut (shareCAGR), NOT a 5th weighted axis — so weights sum to 1.0 over the 4 axes
  // (gpa .40 / growth .25 / assetGrowthPenalty .20 / eff .15 = 1.00). The 4-axis engine absKaliberConsDisc
  // (LINEAR weighted-q + coverage-renorm + dilution post-multiplier) is NEW code keyed by these cohort
  // strings; the 5-axis industrials/staples path and the 3-axis medtech/dlst path are UNTOUCHED. gpa
  // floor/elite are COHORT-SPECIFIC (the lease-distortion isolation: light's un-leased denominator → higher
  // floor/elite); growth/eff/assetGrowthPenalty anchors are SHARED (statistically indistinguishable across
  // cohorts, recomputed 2026-06-21). consdisc_light runs β=1 (ABS-only, n<15 thin-REL); store runs β=0.6.
  // NORMS NOT consumed by the 3-axis absKaliber/gateOpen path → existing buckets byte-identical.
  consdisc_store: Object.freeze({
    id: 'consdisc_store-norms-2026-06-21',
    cohortRule: 'meta.industry in {Specialty Retail, Apparel Retail, Footwear & Accessories, Home Improvement Retail, Restaurants}',

    // Axis A — organic revenue growth (fractions); annual-sourced, deal-masked + cyc-floored upstream
    growth: Object.freeze({ floor: 0.04, elite: 0.22 }),   // D1: elite 0.25->0.22 (annual p90)

    // Axis B — gross profit / assets (Novy-Marx), fractions; cohort-specific (lease-distorted, common-mode)
    gpa: Object.freeze({ floor: 0.21, elite: 0.85 }),      // store p10/p90

    // Axis C — efficiency = 0.60*fcfMargin + 0.40*opMargin (Mohanram cash-quality), fractions
    eff: Object.freeze({ floor: 0.02, elite: 0.18 }),

    // Axis D — asset-growth penalty; transform applied to (-assetGrowth)
    // q(-assetGrowth, {floor:-0.30, elite:0.00}): +30% AG -> 0, <=0% AG -> 1
    assetGrowthPenalty: Object.freeze({ floor: -0.30, elite: 0.00 }),

    // ABS axis weights — SUM EXACTLY 1.0 (F2). Dilution is a post-sum multiplier, NOT a weight.
    weights: Object.freeze({ gpa: 0.40, growth: 0.25, assetGrowthPenalty: 0.20, eff: 0.15 }),

    // Axis A cyclicality blend (fixed linear convex combo; no data-dependent switch)
    growthBlend: Object.freeze({ wYoY: 0.70, wCagr2y: 0.30 }),

    // Axis C efficiency linear mix (fcf-weighted per Mohanram cash primacy), fixed
    effMix: Object.freeze({ wFcf: 0.60, wOp: 0.40 }),

    // §4.1 deal-mask thresholds (goodwill-jump proxy via annual totalAssets jump)
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.20 }),

    // dilution haircut: net issuance >= cap -> maxHaircut on absK; buybacks no bonus
    dilution: Object.freeze({ cap: 0.06, maxHaircut: 0.10, lampAt: 0.03 }),

    // REL stability floor; store n>=31 -> full ABS+REL blend
    rel: Object.freeze({ minN: 15, beta: 0.6 }),

    // always-on structural lamps for this cohort
    lamps: Object.freeze({ leaseDistorted: true, inventoryBlind: true }),
  }),

  consdisc_light: Object.freeze({
    id: 'consdisc_light-norms-2026-06-21',
    cohortRule: 'meta.industry === "Internet Retail"',

    growth: Object.freeze({ floor: 0.04, elite: 0.22 }),   // shared (annual p90)

    // cohort-specific: un-leased denominator -> higher floor/elite
    gpa: Object.freeze({ floor: 0.42, elite: 0.95 }),      // light p10/p90

    eff: Object.freeze({ floor: 0.02, elite: 0.18 }),
    assetGrowthPenalty: Object.freeze({ floor: -0.30, elite: 0.00 }),

    weights: Object.freeze({ gpa: 0.40, growth: 0.25, assetGrowthPenalty: 0.20, eff: 0.15 }),
    growthBlend: Object.freeze({ wYoY: 0.70, wCagr2y: 0.30 }),
    effMix: Object.freeze({ wFcf: 0.60, wOp: 0.40 }),
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.20 }),
    dilution: Object.freeze({ cap: 0.06, maxHaircut: 0.10, lampAt: 0.03 }),

    // thin-n: n<15 -> ABS-only (beta=1), REL suppressed, THIN_REL always on
    rel: Object.freeze({ minN: 15, beta: 1.0, suppressed: true }),

    // light cohort is NOT lease-distorted (the whole point of the split)
    lamps: Object.freeze({ leaseDistorted: false, inventoryBlind: true }),
  }),

  // materials_quality CORE bucket — TWO cohorts by PRICING-POWER vs COMMODITY (deterministic GICS-industry
  // split). Spec formula-design-materials_quality-v0-2026-06-22.md §1-§3 (Court DESIGN-PASS, v0). NORMS
  // RECOMPUTED LIVE on the corrected vintage-tolerant US pool 2026-06-22 THEN frozen (the CORE gate; never
  // freeze on the design's provisional seeds). 5 SCORED axes (gpa/marginStability/growth/assetGrowthPenalty/
  // netIssuance) — the SAME discipline axes as industrials/staples EXCEPT axis C is marginStability (an
  // inverse-CV pricing-power proxy, identity-clip {0,1}) instead of eff. So this needs a PARALLEL engine
  // absKaliberMaterials (NOT absKaliberIndustrials, whose 5th axis key is `eff`). gpa floor/elite is the ONLY
  // cohort-specific anchor (asset-intensity + peak-windfall GP differ structurally); marginStability/growth/
  // assetGrowthPenalty/netIssuance anchors are SHARED. Anti-commodity pillar gpa .30 + marginStability .20 +
  // assetGrowthPenalty .18 = .68 dominates; growth capped at .18 (a price-windfall spike cannot top-score).
  // Both cohorts n>>15 (live pricingpower 40 / commodity 55) → full ABS+REL blend, NO thin-n regime. NORMS
  // NOT consumed by the 3-axis absKaliber/gateOpen path → existing buckets byte-identical.
  //
  // LIVE-RECOMPUTED percentiles (2026-06-22, the corrected vintage-tolerant pool):
  //   pricingpower (n=40): gpa p10 9.2% / p25 12.4% / p50 20.0% / p75 26.8% / p90 33.6%
  //                        marginStability p10 .14 / p50 .87 / p90 .93 ; growth p90 +4.4%
  //   commodity   (n=55): gpa p10 0.1% / p25 5.8% / p50 12.5% / p75 19.2% / p90 31.2%
  //                        marginStability p10 .00 / p50 .55 / p90 .88 ; growth p90 +22.6%
  //   (assetGrowth pricingpower p90 +23.9% / commodity p90 +160.7% — reserve-grab acquirers, q(-AG) floors them;
  //    netIssuance commodity p90 +54.6% — equity-funded reserve grabs, q(-NSI) floors them.)
  // gpa is cohort-specific because commodity p90 (.31) ≈ pricingpower p90 (.34) — the gold/mining PEAK-windfall
  // GP bleeding through; a shared anchor would reward a peak miner's GP/assets as "quality". (Design §2-B.)
  materials_pricingpower: Object.freeze({
    id: 'materials_pricingpower-norms-2026-06-22',
    cohortRule: 'meta.sector=="Basic Materials" && meta.industry in {Specialty Chemicals, Building Materials}',

    // Axis A — organic revenue growth (fractions); annual, deal-masked + spin-off/super-cycle-guarded upstream.
    // 50/50 latest/min floor blend (heavier than industrials 60/40: a Materials revenue spike is price not
    // volume). elite reachable ONLY by genuine secular volume growth; cyclical-trough negatives clip to 0.
    growth: Object.freeze({ floor: 0.00, elite: 0.18 }),            // shared; price-windfall cap (capped BELOW the discipline pillar)

    // Axis B — gross profit / assets (Novy-Marx, the central anti-commodity choice); cohort-specific.
    gpa: Object.freeze({ floor: 0.09, elite: 0.34 }),               // live p10 9.2% / p90 33.6%

    // Axis C — margin stability / low-cyclicality (inverse-CV pricing-power proxy); identity-clip (axis emits 0–1).
    marginStability: Object.freeze({ floor: 0.0, elite: 1.0 }),     // shared identity-clip

    // Axis D — asset-growth penalty; transform on (-assetGrowth). +40% AG -> 0, <=0% -> 1.
    assetGrowthPenalty: Object.freeze({ floor: -0.40, elite: 0.00 }),

    // Axis E — net-issuance penalty; transform on (-NSI). +10% dilution -> 0, >=3% buyback -> 1.
    netIssuance: Object.freeze({ floor: -0.10, elite: 0.03 }),

    // ABS axis weights — SUM EXACTLY 1.0 (anti-commodity pillar gpa+marginStability+assetGrowthPenalty=0.68)
    weights: Object.freeze({ gpa: 0.30, marginStability: 0.20, growth: 0.18, assetGrowthPenalty: 0.18, netIssuance: 0.14 }),

    growthBlend: Object.freeze({ wLatest: 0.50, wFloor: 0.50 }),    // §3-A heavy 50/50 min-floor (price-spike damper)
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),    // §4.1 BOTH required; sign-aware (positive only)
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),// §4.2 spin-off + super-cycle re-baselining guard

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=40 -> full ABS+REL blend
    lamps: Object.freeze({ cycleWall: true, costCurveBlind: true, inventoryBlind: true, byproductBlind: true, backlogFuture: true }),
  }),

  materials_commodity: Object.freeze({
    id: 'materials_commodity-norms-2026-06-22',
    cohortRule: 'meta.sector=="Basic Materials" && meta.industry in {Gold, Other Industrial Metals & Mining, Chemicals, Steel, Other Precious Metals & Mining, Agricultural Inputs, Copper, Silver, Aluminum, Lumber & Wood Production, Coking Coal, Paper & Paper Products}',

    growth: Object.freeze({ floor: 0.00, elite: 0.18 }),            // shared

    gpa: Object.freeze({ floor: 0.01, elite: 0.31 }),               // live p10 0.1% / p90 31.2% — cohort-specific (PEAK-windfall GP)

    marginStability: Object.freeze({ floor: 0.0, elite: 1.0 }),     // shared identity-clip
    assetGrowthPenalty: Object.freeze({ floor: -0.40, elite: 0.00 }),
    netIssuance: Object.freeze({ floor: -0.10, elite: 0.03 }),

    weights: Object.freeze({ gpa: 0.30, marginStability: 0.20, growth: 0.18, assetGrowthPenalty: 0.18, netIssuance: 0.14 }),
    growthBlend: Object.freeze({ wLatest: 0.50, wFloor: 0.50 }),
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=55 -> full ABS+REL blend
    lamps: Object.freeze({ cycleWall: true, costCurveBlind: true, inventoryBlind: true, byproductBlind: true, backlogFuture: true }),
  }),

  system_app_software: Object.freeze({
    id: 'system-app-software-norms-TODO-retrofit',
    growth: null,
    gm:     null,
    eff:    null,
  }),

  fabless_semi: Object.freeze({
    id: 'fabless-semi-norms-TODO-retrofit',
    growth: null,
    gm:     null,
    eff:    null,
  }),
});

// ---------------------------------------------------------------------------
// Kernfunktionen
// ---------------------------------------------------------------------------

/**
 * q(raw, {floor, elite}) — linearer Clip auf [0, 1].
 * Mappt raw auf den Bereich [floor, elite]: floor → 0, elite → 1, dazwischen linear.
 * Werte unter floor werden auf 0 geclippt, Werte über elite auf 1.
 * null / NaN / undefined → 0 (sichere Null).
 *
 * @param {number|null|undefined} raw
 * @param {{ floor: number, elite: number }} norm
 * @returns {number}
 */
function q(raw, { floor, elite }) {
  if (raw == null || !isFinite(raw)) return 0;
  const range = elite - floor;
  // (Fix C-iii) Defensiv-Guard: für NICHT-Platzhalter-Normen muss floor < elite gelten (monotone Skala).
  // floor == elite ist der definierte Degenerat-Fall (Step-Funktion, unten behandelt); floor > elite wäre
  // eine invertierte Skala (Norm-Tabellen-Fehler) → früh werfen statt still falsch skalieren.
  // Alle live NORMS haben floor < elite → no-op.
  if (range < 0) throw new Error(`q: invertierte Norm floor(${floor}) > elite(${elite}) — Skala monoton verlangt floor<elite`);
  if (range === 0) return raw >= elite ? 1 : 0;
  const scaled = (raw - floor) / range;
  return Math.max(0, Math.min(1, scaled));
}

/**
 * effGatePass(rec, norm) — Effizienz-Gate mit Land-Grab-Schutz (Disjunktion, SI-1).
 * Gibt true, wenn MINDESTENS EINE dieser Bedingungen erfüllt ist:
 *   1. rec.opMargin  >= norm.eff.floor         (profitable operations)
 *   2. rec.fcfMargin >= 0.05                   (FCF-positiv)
 *   3. (rec.growth + rec.opMargin) >= 0.30     (RoX-Arm: Hochseiler mit Wachstumsprämie)
 *
 * @param {{ opMargin: number, fcfMargin: number, growth: number }} rec
 * @param {{ eff: { floor: number } }} norm
 * @returns {boolean}
 */
function effGatePass(rec, norm) {
  if (rec.opMargin  >= norm.eff.floor)            return true;
  if (rec.fcfMargin >= 0.05)                       return true;
  if ((rec.growth + rec.opMargin) >= 0.30)         return true;
  return false;
}

/**
 * gateOpen(rec, bucket) — Hartes SI-1-Gate über absolute Sektor-Normen.
 * Gibt true, wenn:
 *   - rec.growth >= NORMS[bucket].growth.floor
 *   - rec.gm     >= NORMS[bucket].gm.floor
 *   - effGatePass(rec, NORMS[bucket]) === true
 *
 * Nur für den Shortlist-Cut gedacht, NICHT als harter Score-Kill.
 * Wirft, wenn bucket nicht in NORMS oder Norm-Felder null (noch nicht retrofittet).
 *
 * @param {{ growth: number, gm: number, opMargin: number, fcfMargin: number }} rec
 * @param {string} bucket
 * @returns {boolean}
 */
function gateOpen(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`gateOpen: unbekannter Bucket "${bucket}"`);
  if (!norm.growth || !norm.gm || !norm.eff) throw new Error(`gateOpen: Bucket "${bucket}" noch nicht retrofittet (TODO)`);
  if (rec.growth < norm.growth.floor) return false;
  if (rec.gm     < norm.gm.floor)     return false;
  return effGatePass(rec, norm);
}

/**
 * absKaliber(rec, bucket, weights) — Absolute Kaliber-Punktzahl (SI-2), Wert in [0, 1].
 * Σ weights[k] * q(rec[k], NORMS[bucket][k]) für k ∈ { growth, gm, eff }.
 *
 * eff-Komponente: q(rec.opMargin, NORMS[bucket].eff).
 * Design-Entscheid: opMargin direkt (einfach, deterministisch); die Disjunktions-Arme
 * von effGatePass sind nur für das binäre Gate (SI-1). Retrofit-Note: für den RoX-Arm
 * wäre max(opMargin, growth+opMargin-0.30+eff.floor) als eff-Input möglich.
 *
 * Default-Gewichte: { growth: 0.45, gm: 0.30, eff: 0.25 } (Summe = 1.0).
 *
 * @param {{ growth: number, gm: number, opMargin: number }} rec
 * @param {string} bucket
 * @param {{ growth?: number, gm?: number, eff?: number }} [weights]
 * @returns {number}
 */
function absKaliber(rec, bucket, weights) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliber: unbekannter Bucket "${bucket}"`);
  if (!norm.growth || !norm.gm || !norm.eff) throw new Error(`absKaliber: Bucket "${bucket}" noch nicht retrofittet (TODO)`);
  const w = Object.assign({ growth: 0.45, gm: 0.30, eff: 0.25 }, weights);
  // (Fix C-i) Gewichte durch ihre Summe normalisieren, damit ein partielles/über-1 Gewichts-Objekt KEIN
  // absKaliber > 1 produzieren kann (jede q-Komponente liegt in [0,1] → konvexe Kombi mit Σw=1 ⇒ [0,1]).
  // Für die vollständigen Σ=1-Gewichte ist dies die Identität (no-op, Parität medtech/dlst).
  const wsum = w.growth + w.gm + w.eff;
  const normW = (wsum > 0 && isFinite(wsum)) ? wsum : 1;
  return (w.growth * q(rec.growth, norm.growth)
        + w.gm     * q(rec.gm,     norm.gm)
        + w.eff    * q(rec.opMargin, norm.eff)) / normW;
}

/**
 * absKaliberIndustrials(rec, bucket) — 5-axis weighted-q absolute caliber with COVERAGE-RENORM
 * (Spec §6.2/§6.4). NEW code keyed on the industrials cohort NORMS; NOT a change to the 3-axis
 * `absKaliber` (medtech/dlst byte-identical — those still call absKaliber()).
 *
 * Five LINEAR q-axes, each reading the cohort norm:
 *   gpa                -> q(rec.gpa,                 norm.gpa)
 *   growth             -> q(rec.growth,              norm.growth)
 *   assetGrowthPenalty -> q(-rec.assetGrowth,        norm.assetGrowthPenalty)   (inverted)
 *   netIssuance        -> q(-rec.netShareIssuance,   norm.netIssuance)          (inverted)
 *   eff                -> q(rec.eff,                  norm.eff)                  (op-weighted blend, precomputed upstream)
 *
 * COVERAGE-RENORM (mirrors dlst absKaliberV2): any axis whose raw input is `null` (NOT_READY /
 * ISSUANCE_NOT_READY / SPINOFF_REBASE drop the input UPSTREAM by setting it null) is DROPPED, and the
 * surviving axis weights are re-normalized to sum 1.0 before the weighted sum — no fake-neutral 0-impute.
 * If EVERY axis is null (pathological) → 0. The inverted axes (assetGrowthPenalty/netIssuance) use the
 * NEGATED raw as the q-input; their raw being null means the axis is dropped (not scored 0).
 *
 * Returns { absK in [0,1], usedAxes:[...], droppedAxes:[...], renormWeights:{...} } so court-score.js can
 * persist the audit trail (which axes survived, the renormalized weight vector).
 *
 * @param {{gpa:?number, growth:?number, assetGrowth:?number, netShareIssuance:?number, eff:?number}} rec
 * @param {string} bucket  — 'industrials_heavy' | 'industrials_light'
 * @returns {{absK:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object}}
 */
function absKaliberIndustrials(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberIndustrials: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.gpa || !norm.growth || !norm.assetGrowthPenalty || !norm.netIssuance || !norm.eff) {
    throw new Error(`absKaliberIndustrials: Bucket "${bucket}" hat keine industrials-NORMS (5-Achs-Gewichte/Anker fehlen)`);
  }
  // Per-axis q-input (the inverted axes negate the raw; null raw -> axis DROP, not 0-impute).
  const axes = [
    { key: 'gpa',                qin: rec.gpa,                                                       norm: norm.gpa },
    { key: 'growth',             qin: rec.growth,                                                     norm: norm.growth },
    { key: 'assetGrowthPenalty', qin: (rec.assetGrowth == null ? null : -rec.assetGrowth),           norm: norm.assetGrowthPenalty },
    { key: 'netIssuance',        qin: (rec.netShareIssuance == null ? null : -rec.netShareIssuance), norm: norm.netIssuance },
    { key: 'eff',                qin: rec.eff,                                                        norm: norm.eff },
  ];
  const used = axes.filter(a => a.qin != null && isFinite(a.qin));
  const dropped = axes.filter(a => !(a.qin != null && isFinite(a.qin))).map(a => a.key);
  if (!used.length) {
    return { absK: 0, usedAxes: [], droppedAxes: axes.map(a => a.key), renormWeights: {} };
  }
  // Sum-preserving renorm: surviving weights re-normalized to sum 1.0 (no fake-neutral fill).
  const wsum = used.reduce((s, a) => s + norm.weights[a.key], 0);
  const denom = (wsum > 0 && isFinite(wsum)) ? wsum : 1;
  const renormWeights = {};
  let absK = 0;
  for (const a of used) {
    const w = norm.weights[a.key] / denom;
    renormWeights[a.key] = w;
    absK += w * q(a.qin, a.norm);
  }
  return { absK, usedAxes: used.map(a => a.key), droppedAxes: dropped, renormWeights };
}

/**
 * absKaliberStaples(rec, bucket) — 5-axis weighted-q absolute caliber with COVERAGE-RENORM for the
 * consumer_staples_compounder cohorts (Spec formula-design-consumer-staples-compounder-v1-2026-06-21.md
 * §6.4). The staples axis SET is IDENTICAL to industrials (gpa/growth/assetGrowthPenalty/netIssuance/eff,
 * all LINEAR q + sum-preserving coverage-renorm), so this is a thin parallel delegate to the same engine
 * (absKaliberIndustrials) reading the per-cohort staples NORMS (gpa/eff cohort-specific; growth/
 * assetGrowthPenalty/netIssuance shared). The ONLY per-bucket dependency is NORMS[bucket], which carries
 * the staples weights {gpa .36, assetGrowthPenalty .18, eff .16, growth .18, netIssuance .12}. NEW code
 * keyed by the staples cohort strings → medtech/dlst/industrials byte-identical (their paths untouched).
 *
 * The ISSUANCE_NOT_READY coverage-renorm (the ~60% Vintage-A slice lacking annualShares) and the
 * SPINOFF_REBASE/NOT_READY:growth drop are exercised here exactly as in industrials (null raw -> drop).
 *
 * @param {{gpa:?number, growth:?number, assetGrowth:?number, netShareIssuance:?number, eff:?number}} rec
 * @param {string} bucket  — 'staples_branded' | 'staples_distribution'
 * @returns {{absK:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object}}
 */
function absKaliberStaples(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberStaples: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.gpa || !norm.growth || !norm.assetGrowthPenalty || !norm.netIssuance || !norm.eff) {
    throw new Error(`absKaliberStaples: Bucket "${bucket}" hat keine staples-NORMS (5-Achs-Gewichte/Anker fehlen)`);
  }
  // Same 5-axis LINEAR weighted-q + coverage-renorm engine as industrials (axis set identical).
  return absKaliberIndustrials(rec, bucket);
}

/**
 * absKaliberConsDisc(rec, bucket) — FOUR-axis weighted-q absolute caliber with COVERAGE-RENORM and a
 * SEPARATE POST-SUM DILUTION HAIRCUT, for the consdisc_expansion cohorts (Spec
 * formula-design-consumer-disc-expansion-v1-2026-06-21.md §3/§6.2). DISTINCT from the 5-axis
 * industrials/staples engine: consdisc has FOUR scored axes (gpa/growth/assetGrowthPenalty/eff,
 * weights summing to 1.0) — net-share-issuance is NOT a 5th weighted axis here; instead share dilution
 * is applied as a BOUNDED LINEAR MULTIPLIER to absK AFTER the weighted sum (§3 "dilution multiplier",
 * never counts toward the 1.0 weight sum). NEW code keyed by the consdisc cohort strings → the 5-axis
 * (industrials/staples) and 3-axis (medtech/dlst) paths are byte-identical (untouched).
 *
 * Four LINEAR q-axes, each reading the cohort norm:
 *   gpa                -> q(rec.gpa,                 norm.gpa)                  (cohort-specific)
 *   growth             -> q(rec.growth,              norm.growth)              (deal-masked + cyc-floored upstream)
 *   assetGrowthPenalty -> q(-rec.assetGrowth,        norm.assetGrowthPenalty)  (inverted; Cooper-Gulen-Schill)
 *   eff                -> q(rec.eff,                  norm.eff)                 (0.60*fcf + 0.40*op blend, precomputed upstream)
 *
 * COVERAGE-RENORM (mirrors absKaliberIndustrials): any axis whose raw input is `null` (NOT_READY drop set
 * UPSTREAM) is DROPPED and the surviving axis weights are re-normalized to sum 1.0 before the weighted sum —
 * no fake-neutral 0-impute. If EVERY axis is null → 0. The inverted axis (assetGrowthPenalty) uses the
 * NEGATED raw as the q-input; raw null means the axis is dropped (not scored 0).
 *
 * DILUTION HAIRCUT (§3, post-sum): absK_final = absK * (1 - clip(shareCAGR, 0, cap)/cap * maxHaircut).
 * Net issuance >= cap (6%/yr) → maxHaircut (10%) absolute-score haircut; buybacks (negative CAGR) clip at 0,
 * no haircut, never a bonus. shareCAGR null (no annualShares, Vintage A) → no haircut (the multiplier is a
 * conservative drag, not a coverage gate; absence of the issuance signal is neutral, never punitive).
 *
 * Returns { absK in [0,1] (post-haircut), absKPreDilution, usedAxes, droppedAxes, renormWeights,
 * dilutionHaircut } so court-score.js can persist the audit trail.
 *
 * @param {{gpa:?number, growth:?number, assetGrowth:?number, eff:?number, shareCAGR:?number}} rec
 * @param {string} bucket  — 'consdisc_store' | 'consdisc_light'
 * @returns {{absK:number, absKPreDilution:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object, dilutionHaircut:number}}
 */
function absKaliberConsDisc(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberConsDisc: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.gpa || !norm.growth || !norm.assetGrowthPenalty || !norm.eff || !norm.dilution) {
    throw new Error(`absKaliberConsDisc: Bucket "${bucket}" hat keine consdisc-NORMS (4-Achs-Gewichte/Anker/dilution fehlen)`);
  }
  // Per-axis q-input (the inverted axis negates the raw; null raw -> axis DROP, not 0-impute). FOUR axes only.
  const axes = [
    { key: 'gpa',                qin: rec.gpa,                                             norm: norm.gpa },
    { key: 'growth',             qin: rec.growth,                                          norm: norm.growth },
    { key: 'assetGrowthPenalty', qin: (rec.assetGrowth == null ? null : -rec.assetGrowth), norm: norm.assetGrowthPenalty },
    { key: 'eff',                qin: rec.eff,                                             norm: norm.eff },
  ];
  const used = axes.filter(a => a.qin != null && isFinite(a.qin));
  const dropped = axes.filter(a => !(a.qin != null && isFinite(a.qin))).map(a => a.key);
  if (!used.length) {
    return { absK: 0, absKPreDilution: 0, usedAxes: [], droppedAxes: axes.map(a => a.key), renormWeights: {}, dilutionHaircut: 0 };
  }
  // Sum-preserving renorm: surviving weights re-normalized to sum 1.0 (no fake-neutral fill).
  const wsum = used.reduce((s, a) => s + norm.weights[a.key], 0);
  const denom = (wsum > 0 && isFinite(wsum)) ? wsum : 1;
  const renormWeights = {};
  let absKPre = 0;
  for (const a of used) {
    const w = norm.weights[a.key] / denom;
    renormWeights[a.key] = w;
    absKPre += w * q(a.qin, a.norm);
  }
  // POST-SUM dilution haircut (§3): bounded LINEAR multiplier on absK. shareCAGR null -> no haircut.
  const { cap, maxHaircut } = norm.dilution;
  let dilutionHaircut = 0;
  const sc = rec.shareCAGR;
  if (sc != null && isFinite(sc) && cap > 0) {
    dilutionHaircut = Math.max(0, Math.min(cap, sc)) / cap * maxHaircut; // buybacks (sc<0) clip to 0
  }
  const absK = absKPre * (1 - dilutionHaircut);
  return { absK, absKPreDilution: absKPre, usedAxes: used.map(a => a.key), droppedAxes: dropped, renormWeights, dilutionHaircut };
}

/**
 * absKaliberMaterials(rec, bucket) — 5-axis weighted-q absolute caliber with COVERAGE-RENORM for the
 * materials_quality cohorts (Spec formula-design-materials_quality-v0-2026-06-22.md §2/§3). The materials
 * axis SET shares 4 axes with industrials/staples (gpa/growth/assetGrowthPenalty/netIssuance, all LINEAR q
 * + sum-preserving coverage-renorm) but axis C is MARGINSTABILITY (an inverse-CV pricing-power proxy,
 * identity-clip {0,1}) instead of eff — so this is a PARALLEL engine, NOT a delegate to absKaliberIndustrials
 * (whose 5th axis key is `eff`). Reads the per-cohort materials NORMS (gpa cohort-specific; marginStability/
 * growth/assetGrowthPenalty/netIssuance shared). The weights are {gpa .30, marginStability .20, growth .18,
 * assetGrowthPenalty .18, netIssuance .14} — the anti-commodity pillar gpa+marginStability+assetGrowthPenalty
 * = 0.68 structurally dominates growth (.18). NEW code keyed by the materials cohort strings → medtech/dlst/
 * industrials/staples/consdisc byte-identical (their paths untouched).
 *
 * marginStability is precomputed UPSTREAM (court-screen buildMaterialsAxes: clip01(1 − stdev(opMargin)/
 * max(|mean(opMargin)|, 0.02)) over ≥3 annual opMargin points; <3 points → null → axis DROP). The
 * ISSUANCE_NOT_READY coverage-renorm (Vintage-A slice lacking annualShares) and the SPINOFF_REBASE/
 * NOT_READY:growth drop are exercised here exactly as in industrials (null raw -> drop, no fake-neutral impute).
 *
 * Returns { absK in [0,1], usedAxes:[...], droppedAxes:[...], renormWeights:{...} }.
 *
 * @param {{gpa:?number, marginStability:?number, growth:?number, assetGrowth:?number, netShareIssuance:?number}} rec
 * @param {string} bucket  — 'materials_pricingpower' | 'materials_commodity'
 * @returns {{absK:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object}}
 */
function absKaliberMaterials(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberMaterials: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.gpa || !norm.marginStability || !norm.growth || !norm.assetGrowthPenalty || !norm.netIssuance) {
    throw new Error(`absKaliberMaterials: Bucket "${bucket}" hat keine materials-NORMS (5-Achs-Gewichte/Anker fehlen)`);
  }
  // Per-axis q-input (the inverted axes negate the raw; null raw -> axis DROP, not 0-impute). FIVE axes,
  // axis C = marginStability (identity-clip, NOT eff).
  const axes = [
    { key: 'gpa',                qin: rec.gpa,                                                       norm: norm.gpa },
    { key: 'marginStability',    qin: rec.marginStability,                                            norm: norm.marginStability },
    { key: 'growth',             qin: rec.growth,                                                     norm: norm.growth },
    { key: 'assetGrowthPenalty', qin: (rec.assetGrowth == null ? null : -rec.assetGrowth),           norm: norm.assetGrowthPenalty },
    { key: 'netIssuance',        qin: (rec.netShareIssuance == null ? null : -rec.netShareIssuance), norm: norm.netIssuance },
  ];
  const used = axes.filter(a => a.qin != null && isFinite(a.qin));
  const dropped = axes.filter(a => !(a.qin != null && isFinite(a.qin))).map(a => a.key);
  if (!used.length) {
    return { absK: 0, usedAxes: [], droppedAxes: axes.map(a => a.key), renormWeights: {} };
  }
  // Sum-preserving renorm: surviving weights re-normalized to sum 1.0 (no fake-neutral fill).
  const wsum = used.reduce((s, a) => s + norm.weights[a.key], 0);
  const denom = (wsum > 0 && isFinite(wsum)) ? wsum : 1;
  const renormWeights = {};
  let absK = 0;
  for (const a of used) {
    const w = norm.weights[a.key] / denom;
    renormWeights[a.key] = w;
    absK += w * q(a.qin, a.norm);
  }
  return { absK, usedAxes: used.map(a => a.key), droppedAxes: dropped, renormWeights };
}

/**
 * blendScore(absK, rel, beta) — Gemischter Score (SI-3), Wert in [0, 100].
 * blendScore = 100 * (beta * absK + (1 - beta) * rel)
 *
 * beta=0  → pure REL (faithful-refactor-Anker für SaaS/Fabless-Retrofit)
 * beta=1  → pure ABS
 * Default beta: 0.6
 *
 * @param {number} absK  — absolute Kaliber-Punktzahl, [0, 1]
 * @param {number} rel   — relativer Score aus REL-Engine (court-score.js 'core'), [0, 1]
 * @param {number} [beta=0.6]
 * @returns {number}
 */
function blendScore(absK, rel, beta) {
  // (Fix C-ii) beta auf [0,1] clampen (eine Konvexkombination verlangt beta∈[0,1]; out-of-range würde
  // extrapolieren) und NaN/null-Inputs guarden (NaN sickert sonst still in den Score). beta=0.6 unverändert.
  let b = (beta === undefined || beta === null || !isFinite(beta)) ? 0.6 : beta;
  b = Math.max(0, Math.min(1, b));
  const a = (absK == null || !isFinite(absK)) ? 0 : absK;
  const r = (rel == null || !isFinite(rel)) ? 0 : rel;
  return 100 * (b * a + (1 - b) * r);
}

/**
 * normTableId(bucket) — Gibt die id des Norm-Eintrags zurück (für Audit/Governance).
 *
 * @param {string} bucket
 * @returns {string}
 */
function normTableId(bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`normTableId: unbekannter Bucket "${bucket}"`);
  return norm.id;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { q, NORMS, effGatePass, gateOpen, absKaliber, absKaliberIndustrials, absKaliberStaples, absKaliberConsDisc, absKaliberMaterials, blendScore, normTableId };
