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

  // energy_quality CORE bucket — THREE cohorts by THROUGH-CYCLE QUALITY tier (deterministic GICS-industry
  // split: upstream/midstream/services). Spec formula-design-energy_quality-v0-2026-06-22.md §0-§2 (Council->
  // Court DESIGN-PASS v0, NEEDS-REVISION — NORMS RECOMPUTED LIVE on the corrected vintage-tolerant CLEAN pool
  // 2026-06-23 THEN frozen; the design's §0 explicitly forbids freezing on the council's contaminated 156-name
  // pool). 5 SCORED axes (roce/fcfMargin/gpa/assetGrowthPenalty/netIssuance) — DISTINCT axis SET from the other
  // CORE buckets: axis B is ROCE (opInc/totalAssets, the through-cycle capital-return PILLAR) and axis C is
  // FCF-margin (annualFCF/annualRev, the capital-discipline arm that survives Vintage A) — neither is the
  // industrials `eff` nor the materials `marginStability`. So this needs a PARALLEL engine absKaliberEnergy.
  // SCORE measures BUSINESS QUALITY ONLY — never valuation, never commodity-price direction. The capital-
  // discipline+resilience pillar (roce .30 + fcfMargin .22 + assetGrowthPenalty .18 = 0.70) STRUCTURALLY
  // dominates; GROWTH IS NOT A SCORED AXIS (rewarding revenue growth in a commodity-cyclical rewards commodity-β,
  // which the brief forbids — growth surfaces only as the deal-mask trigger + cyclicality context). roce/
  // fcfMargin/gpa floor/elite are cohort-specific (the deep-cyclical tiers differ structurally); assetGrowthPenalty/
  // netIssuance SHARED. NORMS NOT consumed by the 3-axis absKaliber/gateOpen path → existing buckets byte-identical.
  //
  // LIVE-RECOMPUTED percentiles (2026-06-23, the corrected vintage-tolerant CLEAN pool; floor~p10, elite~p90):
  //   upstream  (n=32): roce p10 4.4 / p50 9.3 / p90 15.5 ; fcfMargin p10 -2.4 / p50 15.8 / p90 30.5
  //                     gpa  p10 6.6 / p50 13.1 / p90 25.2 ; assetGrowth p90 +26.1 ; netIssuance p90 +30.0
  //   midstream (n=26): roce p10 4.5 / p50 8.6 / p90 22.1 ; fcfMargin p10 2.7 / p50 6.5 / p90 37.9 (wide:
  //                     capital-cycle dispersion); gpa p10 6.3 / p50 12.3 / p90 24.5 ; assetGrowth p90 +29.0
  //   services  (n=25 scored): roce p10 0.1 / p50 6.3 / p90 12.3 ; fcfMargin p10 -1.6 / p50 7.7 / p90 24.4
  //                     gpa p10 6.4 / p50 13.6 / p90 21.3 ; assetGrowth p90 +16.5 ; netIssuance p90 +52.0
  //   (the SBR/PBT royalty-trust ROCE 954%/761% tail outliers do NOT move p90 — percentile anchors are MAD-robust.)
  // QUALITY-ONLY GUARD by construction: growth is never a positive scored axis and profitability is asset-scaled
  // (ROCE/GP-assets, not margin-level), so a commodity up-leg cannot inflate the score; the assetGrowthPenalty +
  // netIssuance discipline axes fire HARDEST in the cycle-top reserve-grab / drilling-frenzy year (acquirer
  // ballooning the asset base at the peak = the low-quality case). gpa/fcfMargin cohort-specific because the
  // midstream toll-road FCF dispersion (p90 37.9) and the services low-ROCE tier (p90 12.3) differ structurally
  // from upstream — a shared anchor would mis-rank across tiers. (Design §2.)
  energy_upstream: Object.freeze({
    id: 'energy_upstream-norms-2026-06-23',
    cohortRule: 'meta.sector=="Energy" && meta.industry in {Oil & Gas E&P, Oil & Gas Integrated}',

    // Axis B — ROCE surrogate opInc/totalAssets (through-cycle capital-return, the LOAD-BEARING pillar); cohort-specific.
    roce: Object.freeze({ floor: 0.02, elite: 0.16 }),              // live p10 4.4% / p90 15.5%

    // Axis C — FCF margin annualFCF/annualRev (capital discipline; the FULL-coverage arm that survives Vintage A); cohort-specific.
    fcfMargin: Object.freeze({ floor: -0.03, elite: 0.30 }),        // live p10 -2.4% / p90 30.5%

    // Axis B2 — gross profit / assets (Novy-Marx profitability); cohort-specific.
    gpa: Object.freeze({ floor: 0.06, elite: 0.25 }),               // live p10 6.6% / p90 25.2%

    // Axis D — asset-growth penalty; transform on (-assetGrowth). +40% AG -> 0, <=0% -> 1 (the commodity-β suppressor).
    assetGrowthPenalty: Object.freeze({ floor: -0.40, elite: 0.00 }),  // shared

    // Axis E — net-issuance penalty; transform on (-NSI). +10% dilution -> 0, >=3% buyback -> 1.
    netIssuance: Object.freeze({ floor: -0.10, elite: 0.03 }),         // shared

    // ABS axis weights — SUM EXACTLY 1.0 (capital-discipline pillar roce+fcfMargin+assetGrowthPenalty=0.70; NO growth axis)
    weights: Object.freeze({ roce: 0.30, fcfMargin: 0.22, assetGrowthPenalty: 0.18, gpa: 0.16, netIssuance: 0.14 }),

    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),    // §3.1 deal-mask trigger (growth NOT scored; mask feeds lamps/context)
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),// §3.4 spin-off/divestiture re-baselining guard

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=32 -> full ABS+REL blend
    lamps: Object.freeze({ cycleWall: true, commodityBeta: true, reserveBlind: true, issuanceNotReady: true }),
  }),

  energy_midstream: Object.freeze({
    id: 'energy_midstream-norms-2026-06-23',
    cohortRule: 'meta.sector=="Energy" && meta.industry in {Oil & Gas Midstream}',

    roce: Object.freeze({ floor: 0.02, elite: 0.22 }),              // live p10 4.5% / p90 22.1%
    fcfMargin: Object.freeze({ floor: 0.00, elite: 0.38 }),         // live p10 2.7% / p90 37.9% (wide capital-cycle dispersion)
    gpa: Object.freeze({ floor: 0.06, elite: 0.24 }),               // live p10 6.3% / p90 24.5%
    assetGrowthPenalty: Object.freeze({ floor: -0.40, elite: 0.00 }),  // shared
    netIssuance: Object.freeze({ floor: -0.10, elite: 0.03 }),         // shared

    weights: Object.freeze({ roce: 0.30, fcfMargin: 0.22, assetGrowthPenalty: 0.18, gpa: 0.16, netIssuance: 0.14 }),
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=26 -> thin-but-sufficient, full ABS+REL blend (documented §0/§7-4)
    lamps: Object.freeze({ cycleWall: true, commodityBeta: true, dcfCoverageBlind: true, issuanceNotReady: true }),
  }),

  energy_services: Object.freeze({
    id: 'energy_services-norms-2026-06-23',
    cohortRule: 'meta.sector=="Energy" && meta.industry in {Oil & Gas Equipment & Services, Oil & Gas Drilling}',

    roce: Object.freeze({ floor: 0.00, elite: 0.13 }),              // live p10 0.1% / p90 12.3% (the leveraged-driller low-ROCE tier)
    fcfMargin: Object.freeze({ floor: -0.02, elite: 0.24 }),        // live p10 -1.6% / p90 24.4%
    gpa: Object.freeze({ floor: 0.06, elite: 0.21 }),               // live p10 6.4% / p90 21.3%
    assetGrowthPenalty: Object.freeze({ floor: -0.40, elite: 0.00 }),  // shared
    netIssuance: Object.freeze({ floor: -0.10, elite: 0.03 }),         // shared

    weights: Object.freeze({ roce: 0.30, fcfMargin: 0.22, assetGrowthPenalty: 0.18, gpa: 0.16, netIssuance: 0.14 }),
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=25 scored -> full ABS+REL blend
    lamps: Object.freeze({ cycleWall: true, commodityBeta: true, issuanceNotReady: true }),
  }),

  // pharma_commercial CORE bucket — THREE cohorts by COMMERCIAL-STAGE QUALITY tier (deterministic GICS-industry
  // split: branded/biopharma/specialty). Spec formula-design-pharma_court-v0-2026-06-22.md §1-§3 (Council->Court
  // DESIGN-PASS v0, NEEDS-REVISION — NORMS RECOMPUTED LIVE on the CLEAN post-commercial-gate vintage-tolerant pool
  // 2026-06-23 THEN frozen; the CORE gate). 3 SCORED axes {growth, gm, eff} — the SAME axis set as medtech/dlst's
  // 3-axis absKaliber path, BUT with COVERAGE-RENORM (eff/gm can be null on a royalty/no-GP biotech like RPRX/ARWR)
  // and a NEW engine absKaliberPharma (the medtech/dlst absKaliber 3-axis path is BYTE-UNTOUCHED — those still call
  // absKaliber()). Growth LEADS (w .45): the cliff-aware organic read separates LLY/NBIX/HALO from the patent-cliff
  // field (PFE/BMY/VTRS); gm low-weighted (.20) so the categorically-different cohort GM structures (branded 66-79
  // vs biopharma 64-96 vs specialty 35-95) don't dominate; eff (.35) FCF-primary because R&D fully-expensed
  // distorts OpM while branded is structurally FCF-rich. growth/gm/eff floor/elite are cohort-specific (the tiers
  // differ structurally). NORMS NOT consumed by the 3-axis absKaliber/gateOpen path → existing buckets byte-identical.
  //
  // LIVE-RECOMPUTED percentiles (2026-06-23, the CLEAN commercial pool; floor~p10, elite~p90; growth elite capped
  // to a sustainable level so a near-zero-base launch-spike cannot define elite):
  //   branded   (n=10): growth p10 -1.8 / p50 1.9 / p90 12.2 ; gm p10 65.9 / p50 72.7 / p90 79.2
  //                     eff p10 13.7 / p50 21.3 / p90 33.5
  //   biopharma (n=22): growth p10 1.0 / p50 13.8 / p90 68.9 (p90 launch-spike-inflated -> elite capped .30)
  //                     gm p10 64.1 / p50 84.4 / p90 96.5 ; eff p10 9.9 / p50 26.1 / p90 49.4
  //   specialty (n=14): growth p10 0.7 / p50 6.2 / p90 59.0 (p90 inflated -> elite capped .12) ; gm p10 35.6 /
  //                     p50 66.6 / p90 95.4 (WIDE: generic VTRS 35 <-> specialty NBIX/UTHR 88-98) ; eff p10 4.1 / p90 35.4
  // Growth floor 0.00 for branded/specialty (NOT 0.15): branded is mature + patent-cliff-exposed and a 0.15 gate
  // would wrongly reject AMGN(10%)/GILD(2%)/MRK(1%) legit compounders; biopharma floor 0.05. THIN_REL on branded
  // (n=10<15) -> ABS-only (beta=1.0) in court-score; ABS anchors are absolute-anchored so still fully scorable.
  // M&A: LOCAL totalAssets-jump deal-mask only (the design's intangible/IPR&D re-pointing needs the ABSENT external
  // companyfacts join → intangible-amortization-drag/ipr&d lamps SHIPPED OMITTED, disclosed MA_INTANGIBLE_BLIND).
  pharma_branded: Object.freeze({
    id: 'pharma_branded-norms-2026-06-23',
    cohortRule: 'meta.sector=="Healthcare" && meta.industry in {Drug Manufacturers - General} && commercialGate',

    // Axis A — organic growth (fractions; annual, deal-masked upstream, winsorized cap 1.0); cohort-specific.
    // Floor 0.00 (mature + cliff-exposed; shortlist-cut only), elite 0.12 (live p90 12.2%).
    growth: Object.freeze({ floor: 0.00, elite: 0.12 }),            // live p10 -1.8% / p90 12.2%

    // Axis B — gross margin annualGP/annualRev (pricing-power; cohort-specific COGS structure); LOW weight .20.
    gm: Object.freeze({ floor: 0.66, elite: 0.79 }),                // live p10 65.9% / p90 79.2%

    // Axis C — efficiency annualFCF/annualRev primary, OpM fallback (R&D fully-expensed distorts OpM); cohort-specific.
    eff: Object.freeze({ floor: 0.10, elite: 0.33 }),               // live p10 13.7% / p90 33.5% (branded structurally FCF-rich)

    // ABS axis weights — SUM EXACTLY 1.0 (growth leads .45; gm low .20 so margin split doesn't dominate; eff .35)
    weights: Object.freeze({ growth: 0.45, gm: 0.20, eff: 0.35 }),

    growthBlend: Object.freeze({ wLatest: 0.60, wTrend: 0.40 }),    // §3-A min(latest, 0.6*latest+0.4*median clean YoY) — cliff-aware
    growthCap: 1.0,                                                 // winsorize: a near-zero-base launch-spike clipped at +100%
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),    // §4.1 LOCAL totalAssets-jump M&A proxy; sign-aware (positive only)
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),// §4 spin-off/divestiture re-baselining guard

    rel: Object.freeze({ minN: 15, beta: 1.0, suppressed: true }),  // n=10<15 -> THIN_REL: ABS-only (beta=1.0), REL suppressed
    lamps: Object.freeze({ patentCliffWall: true, maIntangibleBlind: true, thinRel: true, issuanceNotReady: true }),
  }),

  pharma_biopharma: Object.freeze({
    id: 'pharma_biopharma-norms-2026-06-23',
    cohortRule: 'meta.sector=="Healthcare" && meta.industry in {Biotechnology} && commercialGate',

    growth: Object.freeze({ floor: 0.05, elite: 0.30 }),            // live p10 1.0% / p90 68.9% (p90 launch-spike-inflated -> elite capped .30)
    gm: Object.freeze({ floor: 0.64, elite: 0.96 }),                // live p10 64.1% / p90 96.5%
    eff: Object.freeze({ floor: 0.05, elite: 0.42 }),               // live p10 9.9% / p90 49.4% (wide: commercial-biotech tiers, REL discriminates)

    weights: Object.freeze({ growth: 0.45, gm: 0.20, eff: 0.35 }),
    growthBlend: Object.freeze({ wLatest: 0.60, wTrend: 0.40 }),
    growthCap: 1.0,
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=22 -> full ABS+REL blend
    lamps: Object.freeze({ patentCliffWall: true, maIntangibleBlind: true, issuanceNotReady: true }),
  }),

  pharma_specialty: Object.freeze({
    id: 'pharma_specialty-norms-2026-06-23',
    cohortRule: 'meta.sector=="Healthcare" && meta.industry in {Drug Manufacturers - Specialty & Generic} && commercialGate',

    growth: Object.freeze({ floor: 0.00, elite: 0.12 }),            // live p10 0.7% / p90 59.0% (p90 inflated -> elite capped .12; mature generics)
    gm: Object.freeze({ floor: 0.36, elite: 0.92 }),                // live p10 35.6% / p90 95.4% (WIDE band INTENTIONAL: generic VTRS 35 <-> specialty NBIX/UTHR 88-98)
    eff: Object.freeze({ floor: 0.05, elite: 0.34 }),               // live p10 4.1% / p90 35.4%

    weights: Object.freeze({ growth: 0.45, gm: 0.20, eff: 0.35 }),
    growthBlend: Object.freeze({ wLatest: 0.60, wTrend: 0.40 }),
    growthCap: 1.0,
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=14 -> thin-but-sufficient, full ABS+REL blend (mirrors energy_midstream n=26 documented headroom; 14 is bordering, accepted)
    lamps: Object.freeze({ patentCliffWall: true, maIntangibleBlind: true, issuanceNotReady: true }),
  }),

  // it_services CORE bucket — ONE de-contaminated people-leverage / low-capital-compounding quality cohort. Spec
  // formula-design-special_tracks-v0-2026-06-22.md PART B (Council->Court DESIGN-PASS v0). NORMS RECOMPUTED LIVE on
  // the CLEAN de-contaminated US pool 2026-06-23 THEN frozen (the CORE gate). 5 SCORED axes {gpa, fcfMargin, opMargin,
  // growth, netIssuance} — the asset-efficiency + cash-conversion + discipline axes that ARE computable locally; this
  // is a 5-axis set DISTINCT from energy (roce/fcfMargin/gpa/assetGrowthPenalty/netIssuance) — IT-services has BOTH
  // opMargin AND a SCORED growth axis, and gpa/fcfMargin/opMargin/growth are all NON-inverted (higher=better), only
  // netIssuance is the inverted q(-NSI) discipline axis — so it needs a PARALLEL engine absKaliberItServices (NOT a
  // delegate; energy's 5th axis is the inverted assetGrowthPenalty, energy has no growth axis). NORMS NOT consumed by
  // the 3-axis absKaliber/gateOpen path -> the 12 existing CORE buckets byte-identical.
  //
  // THE KEY DESIGN MOVE (PART B §B.2): revenue-per-employee is NOT a scored axis (weight 0.00). RPE is INVERTED on the
  // live cohort (sorting RPE-descending puts the capital-intensive contaminants at the TOP — CIFR/INGM/CDW — and the
  // genuine people-leverage elite at the BOTTOM — ACN/EPAM/GLOB/CTSH). So RPE is used ONLY as a contamination GATE
  // (classify-itservices RPE>$700k) + an advisory flag. The people-leverage thesis is carried by the LOW-CAPITAL-
  // COMPOUNDING axes (gpa asset-light proxy is the lead, fcfMargin cash-conversion, opMargin pricing-power, organic
  // growth, net-issuance discipline). The capital-discipline+profitability pillar gpa+fcfMargin+netIssuance = .68 ≫
  // growth .14. All q() LINEAR; any dropped axis -> sum-preserving renorm of survivors to 1.0 (no fake-neutral fill).
  //
  // FEASIBILITY DISCLOSURE — PEOPLE_LEVERAGE_BLIND (always-on, mirrors medtech's MA_INTANGIBLE_BLIND): the 3 best
  // direct people-leverage signals (book-to-bill / utilization / attrition) carry NO us-gaap tag and are ABSENT;
  // headcount IS present locally but only ~55% coverage (12/22) and raw RPE is INVERTED + therefore NOT scored. So
  // NO axis directly measures people-leverage — the score leans on people-leverage-VIA-asset-efficiency. Disclosed
  // as a wall, never faked.
  //
  // LIVE-RECOMPUTED percentiles (2026-06-23, the CLEAN de-contaminated pool n=22; floor~p10/CACI-floor, elite~p90):
  //   gpa p10 16.2 / p50 28.0 / p90 46.1 (floor 5% honors the goodwill-heavy roll-up CACI gpa 8.8% — floored honestly,
  //     no special case; INOD 0.59 / EXLS 0.47 / IT 0.55 clip elite); fcfMargin p10 2.6 / p50 10.3 / p90 17.1 (miners
  //     gated out); opMargin p10 2.5 / p50 10.9 / p90 18.0 (JKHY 0.239 caps); growth p10 -2.8 / p50 6.2 / p90 15.2
  //     (IT-services mid-single-digit through-cycle); netIssuance(-NSI) p90 3.2 (buyback=elite — Damodaran low-capex
  //     ->FCF->buybacks is the compounder signature). netIssuance coverage 11/22=50% (Vintage-A lacks annualShares).
  it_services: Object.freeze({
    id: 'it-services-norms-2026-06-23',
    cohortRule: 'meta.sector=="Technology" && meta.industry in {Information Technology Services} && US && >=$1B && NOT contamination-gated',

    // Axis T1 — gross profit / assets (Novy-Marx STRONG; THE low-capital-compounding / asset-light proxy, the lead axis).
    gpa: Object.freeze({ floor: 0.05, elite: 0.45 }),               // live p10 16.2% / p90 46.1%; floor .05 honors CACI goodwill-floor (8.8%)

    // Axis T2 — FCF margin annualFCF/annualRev (cash conversion = the people-leverage payoff; Mohanram cash-quality).
    fcfMargin: Object.freeze({ floor: 0.00, elite: 0.18 }),         // live p10 2.6% / p90 17.1% (miners negative, gated out)

    // Axis T3 — operating margin annualOpInc/annualRev (pricing power vs wage inflation; level NOT a hard gate).
    opMargin: Object.freeze({ floor: 0.02, elite: 0.18 }),          // live p10 2.5% / p90 18.0%

    // Axis T4 — organic revenue growth (deal-masked + spin-off-guarded UPSTREAM; mid-single-digit through-cycle).
    growth: Object.freeze({ floor: 0.00, elite: 0.15 }),            // live p10 -2.8% / p90 15.2%

    // Axis T5 — net-share-issuance penalty (Pontiff-Woodgate STRONG; q(-NSI), buyback=elite = the compounder signature).
    netIssuance: Object.freeze({ floor: -0.10, elite: 0.03 }),      // live -NSI p90 3.2%

    // ABS axis weights — SUM EXACTLY 1.0 (capital-discipline+profitability pillar gpa+fcfMargin+netIssuance = .68 ≫ growth .14)
    weights: Object.freeze({ gpa: 0.34, fcfMargin: 0.24, opMargin: 0.18, growth: 0.14, netIssuance: 0.10 }),

    growthBlend: Object.freeze({ wLatest: 0.60, wFloor: 0.40 }),    // §B.3 0.60*latest clean YoY + 0.40*min(recent clean YoYs)
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),    // §B.5 serial-acquirer (Accenture ~40 tuck-ins/yr) totalAssets-jump proxy; BOTH required; sign-aware (positive only)
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),// §B.5 spin-off/divestiture re-baselining guard (DXC has divested heavily)

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=22 -> full ABS+REL blend
    rpeFlagOnly: true,                                              // §B.2 RPE weight 0.00 — INVERTED, never scored; gate + advisory flag only
    lamps: Object.freeze({ peopleLeverageBlind: true, cycleWall: true, inventoryBlind: true, backlogFuture: true, peopleDataPartial: true, issuanceNotReady: true }),
  }),

  // tech_hardware_quality CORE court bucket — ONE durable hardware-FRANCHISE quality cohort. Council/court triage
  // 2026-06-24 found this is the ONE genuine remaining quality-compounder gap. NORMS RECOMPUTED LIVE on the FINAL
  // de-ADR'd + deduped US pool 2026-06-24 (the frozen percentile pool n=71, cov 71/71; live 71 classified of which
  // AMKR is the 1 SI-4 shell → 70 scored after the re-court membership/exclusion gate was made QUALITY-ONLY) THEN
  // frozen (the CORE gate). 5 SCORED axes {gpa, fcfMargin, opMargin, growth, netIssuance} — the SAME axis SET and the
  // SAME engine as it_services (gpa/fcfMargin/opMargin/growth all NON-inverted higher=better, only netIssuance is the
  // inverted q(-NSI) discipline axis) → this entry REUSES absKaliberItServices (NOT a new engine; the axis shape is
  // byte-identical, only the cohort NORMS differ). NORMS NOT consumed by the 3-axis absKaliber/gateOpen path → the
  // 22 existing CORE/court buckets byte-identical.
  //
  // THE THESIS (why an absolute-anchor with NO contamination gate works): the generic HARDWARE peer group is BIMODAL
  // — durable margin-stable franchises (APH/KEYS/GRMN/MSI/TDY/CGNX/FTV/BMI/AMAT, gpa .24-.46, opMargin 16-41%) are
  // lumped with commodity contract-manufacturers (FLEX/JBL/BHE/SANM/PLXS, opMargin 4-9%, gpa .12-.14) AND loss-making
  // cyclicals/quantum names (ASTS/ONDS/OUST/AAOI…). The absolute-anchor on {gpa, fcfMargin, opMargin, growth,
  // netIssuance} cleanly re-ranks the franchises above the commodity/loss tail with NO per-name gate — the commodity
  // contract-mfg clip the gpa/fcfMargin/opMargin q-axes near 0 and sink BELOW the absolute floor → off the
  // headlineShortlist (verified live: FLEX rank 54/71 absK .18, BHE 55 .17, JBL 61 .12, SANM 63 .12, PLXS 65 .11; the
  // franchises rank top-17), exactly like materials/energy where the commodity tail naturally sinks. The deep-loss
  // shells (ASTS fcfMargin -16.8 / opMargin -4.1, ONDS, OUST) are SI-4 shell-excluded or floor-demoted.
  //
  // WEIGHT JUSTIFICATION (mirrors it_services, adjusted): {gpa .34, fcfMargin .24, opMargin .18, growth .14,
  // netIssuance .10}. THE FRANCHISE SIGNATURE: gpa LEADS (.34) — gross-profit/assets (Novy-Marx) is the asset-light
  // pricing-power proxy that most cleanly separates a margin-stable franchise (APH .24, KEYS .30, AMAT .38, KLAC .46)
  // from a capital-heavy contract-manufacturer turning a thin spread on a big asset base (FLEX/JBL/SANM .12-.14). A
  // MARGIN PILLAR — fcfMargin .24 (cash conversion = the franchise payoff; a commodity assembler free-cash-flows ~0)
  // + opMargin .18 (pricing power vs the semi/comms cycle). netIssuance DISCIPLINE .10 (Pontiff-Woodgate; buyback =
  // the compounder signature). The PROFITABILITY+DISCIPLINE PILLAR gpa+fcfMargin+netIssuance = .68 ≫ growth .14 —
  // growth is SECONDARY (a semiconductor up-cycle revenue spike must NOT top-score a cyclical over a steady franchise;
  // capped at .14 like it_services). The opMargin/fcfMargin margin pillar (.42 combined) is the bimodality separator.
  //
  // LIVE-RECOMPUTED percentiles (2026-06-24, the de-ADR'd + deduped + de-shelled pool n=71; floor~p10, elite~p90):
  //   gpa        p10 .109 / p25 .149 / p50 .239 / p75 .298 / p90 .380 (cov 71/71)
  //   fcfMargin  p10 -.177 / p25 .028 / p50 .101 / p75 .180 / p90 .244 (cov 71/71; loss tail floored honestly at 0)
  //   opMargin   p10 -.117 / p25 .036 / p50 .121 / p75 .172 / p90 .259 (cov 71/71)
  //   growth     p10 -.109 / p25 -.042 / p50 .004 / p75 .079 / p90 .121 (cov 71/71; hardware mid-cycle, flat-to-low)
  //   netIssuance(-NSI) p10 -.061 / p50 -.002 / p90 .029 (cov 34/71 = 48%; Vintage-A lacks annualShares -> DROP+renorm)
  // gpa floor .10 ~ p10 .109 (honors the cyclical low-gpa tail honestly via the linear q, no special case); elite .40 ~
  // p90 .380. fcfMargin floor .00 (a quality compounder converts cash; the loss tail floors honestly), elite .24 ~ p90.
  // opMargin floor .02 (just above break-even; the loss tail floors), elite .25 ~ p90 .259. growth floor .00 (a
  // cyclical-trough negative clips to 0 — never penalized below 0, never rewarded for a price/cycle spike), elite .15
  // (slightly above p90 .121 for headroom; secondary axis). netIssuance floor -.10 / elite .03 (buyback=elite; shared
  // shape with it_services/industrials). QUALITY-ONLY by construction: growth is capped .14 and profitability is
  // asset-scaled (gpa) / cash-converted (fcfMargin), so a semi up-leg cannot inflate the score.
  tech_hardware_quality: Object.freeze({
    id: 'tech-hardware-norms-2026-06-24',
    cohortRule: 'meta.sector=="Technology" && meta.industry in {Semiconductor Equipment & Materials, Electronic Components, Communication Equipment, Scientific & Technical Instruments} && US && >=$1B (deduped)',

    // Axis H1 — gross profit / assets (Novy-Marx STRONG; THE franchise vs commodity-contract-mfg separator, the LEAD axis).
    gpa: Object.freeze({ floor: 0.10, elite: 0.40 }),               // live p10 10.9% / p90 38.0%

    // Axis H2 — FCF margin annualFCF/annualRev (cash conversion = the franchise payoff; Mohanram cash-quality).
    fcfMargin: Object.freeze({ floor: 0.00, elite: 0.24 }),         // live p10 -17.7% / p90 24.4% (loss tail floored honestly at 0)

    // Axis H3 — operating margin annualOpInc/annualRev (pricing power vs the semi/comms cycle; level NOT a hard gate).
    opMargin: Object.freeze({ floor: 0.02, elite: 0.25 }),          // live p10 -11.7% / p90 25.9%

    // Axis H4 — organic revenue growth (deal-masked + spin-off-guarded UPSTREAM; hardware mid-cycle, flat-to-low).
    growth: Object.freeze({ floor: 0.00, elite: 0.15 }),            // live p10 -10.9% / p90 12.1% (elite slightly above p90 for headroom; SECONDARY)

    // Axis H5 — net-share-issuance penalty (Pontiff-Woodgate STRONG; q(-NSI), buyback=elite = the compounder signature).
    netIssuance: Object.freeze({ floor: -0.10, elite: 0.03 }),      // live -NSI p90 2.9% (cov 48% — Vintage-A lacks annualShares)

    // ABS axis weights — SUM EXACTLY 1.0 (the profitability+discipline pillar gpa+fcfMargin+netIssuance = .68 ≫ growth
    // .14; the opMargin+fcfMargin margin pillar .42 is the bimodality separator). MIRRORS it_services.
    weights: Object.freeze({ gpa: 0.34, fcfMargin: 0.24, opMargin: 0.18, growth: 0.14, netIssuance: 0.10 }),

    growthBlend: Object.freeze({ wLatest: 0.60, wFloor: 0.40 }),    // 0.60*latest clean YoY + 0.40*min(recent clean YoYs)
    dealMask: Object.freeze({ assetJump: 0.25, revJump: 0.15 }),    // serial-acquirer (FTV/AMAT roll-ups) totalAssets-jump proxy; BOTH required; sign-aware (positive only)
    spinoffGuard: Object.freeze({ dropYoY: -0.25, baseFrac: 0.85 }),// spin-off/divestiture re-baselining guard (FTV spun off VNT, etc.)

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=71 -> full ABS+REL blend
    lamps: Object.freeze({ cycleWall: true, inventoryBlind: true, backlogFuture: true, bookToBillBlind: true, issuanceNotReady: true }),
  }),

  // financials_banks CORE court bucket — ONE deposit-funded US-bank cohort by THROUGH-CYCLE QUALITY. Court gauntlet
  // DESIGN (BUILD_WITH_CAVEATS / court REVISE, 2026-06-23). NORMS RECOMPUTED LIVE on the FINAL de-ADR'd + deduped US
  // pool 2026-06-23 (n=128 after removing the 16 foreign megabank ADRs + 4 preferred/dual-class/legacy dupes) THEN
  // frozen (the CORE gate). 4 SCORED axes {roaThruCycle, capitalAdequacy, assetGrowthDiscipline, earningsDurability}
  // — the bank-economics axes computable LOCALLY from annualNetIncome + annualBalance.{totalAssets,totalEquity}. This
  // is a 4-axis set DISTINCT from every other CORE bucket (no gpa/fcfMargin/opMargin — annualGP is structurally 0 and
  // annualOpInc is empty for banks; annualFCF/annualOCF are ECONOMICALLY MEANINGLESS for banks — JPM annualFCF[0] =
  // -$147.8B — and HARD-EXCLUDED from all axes) — so it needs a PARALLEL engine absKaliberBanks. NORMS NOT consumed by
  // the 3-axis absKaliber/gateOpen path nor any existing engine -> the 20 existing CORE/court buckets byte-identical.
  //
  // THE KEY DESIGN MOVE: assetGrowthDiscipline is a PENALTY (q-input = -assetGrowthYoY, floor -0.40 / elite 0.00) —
  // balance-sheet ballooning at the cycle peak is a credit-quality DESTROYER, so ZERO asset growth is elite and rapid
  // growth is penalized. This is the CORRECT sign for banks and the OPPOSITE of utilities/REITs (where asset growth is
  // rewarded). The live -assetGrowth distribution (p10 -0.258 / p50 -0.048 / p90 -0.001) confirms the sign and the
  // elite=0 anchor. roaThruCycle (w 0.50) is the lead: the through-cycle damper = mean of available NI[i]/totalAssets[i]
  // over i=0..3 (a 4-year ROA average, not a single year). capitalAdequacy (w 0.25) = totalEquity[0]/totalAssets[0]
  // (a CET1 surrogate — real regulatory RWA absent, CET1_BLIND). earningsDurability (w 0.07) = min(NI)/max(NI) over
  // >=3 years, LOW-weighted + BLIND-walled (only ~4 post-2020 years, no real credit cycle).
  //
  // FEASIBILITY DISCLOSURES — always-on BLIND walls (the most important bank dimensions carry NO local signal):
  //   CREDIT_QUALITY_BLIND  — NPLs / net charge-offs / loan-loss provisions ABSENT (the single most important bank
  //                           dimension; the SCORE cannot see asset quality — disclosed, never faked).
  //   NIM_BLIND             — net interest margin ABSENT (no interest-income/earning-assets breakdown).
  //   EFFICIENCY_RATIO_BLIND— cost/income efficiency ratio ABSENT (no non-interest-expense line).
  //   CET1_BLIND            — regulatory CET1 / risk-weighted-assets ABSENT; capitalAdequacy is a raw equity/assets
  //                           surrogate, NOT the Basel ratio.
  //   DEPOSIT_FRANCHISE_BLIND— deposit mix / cost-of-funds / non-interest-bearing share ABSENT.
  //
  // capitalAdequacy DROP+renorm (court revision #4): totalEquity is null on ~45% of the pool (coverage 55% live),
  // INCLUDING the marquees JPM/WFC/PNC/USB — they score on the OTHER 3 axes via sum-preserving coverage-renorm, NEVER
  // imputed. Disclosed as the CAPADEQ_DROPPED lamp in court-score.js.
  //
  // LIVE-RECOMPUTED percentiles (2026-06-23, the CLEAN de-ADR'd pool n=128; floor~p10, elite~p90):
  //   roaThruCycle p10 0.0070 / p50 0.0107 / p90 0.0164 (4y-avg ROA; deep-regional band) -> floor .0070 / elite .0164
  //   capitalAdequacy p10 0.0889 / p50 0.1179 / p90 0.1386 (equity/assets, 55% coverage) -> floor .084 / elite .137
  //   assetGrowthDiscipline(-ag) p10 -0.258 / p50 -0.048 / p90 -0.001 (PENALTY) -> floor -.40 / elite .00
  //   earningsDurability p10 0.213 / p50 0.704 / p90 0.865 (min/max NI, >=3y) -> floor .185 / elite .863
  financials_banks: Object.freeze({
    id: 'banks-norms-2026-06-23',
    cohortRule: 'meta.sector=="Financial Services" && meta.industry in {Banks - Regional, Banks - Diversified} && US-listing (de-ADRd) && >=$1B, deduped',

    // Axis B1 — through-cycle ROA = mean of available annualNetIncome[i]/annualBalance[i].totalAssets over i=0..3.
    roaThruCycle:           Object.freeze({ floor: 0.0070, elite: 0.0164 }),   // live p10 0.70% / p90 1.64%

    // Axis B2 — capital adequacy = annualBalance[0].totalEquity/annualBalance[0].totalAssets (CET1 surrogate; DROP+renorm
    // when totalEquity null — ~45% of the pool incl. JPM/WFC/PNC — NEVER imputed; CET1_BLIND, real RWA absent).
    capitalAdequacy:        Object.freeze({ floor: 0.084,  elite: 0.137 }),    // live p10 8.9% / p90 13.9% (coverage 55%)

    // Axis B3 — asset-growth DISCIPLINE = q(-assetGrowthYoY); PENALTY, elite=0 (zero balance-sheet growth) / floor=-0.40
    // (40% ballooning). assetGrowthYoY = totalAssets[0]/totalAssets[1]-1. CORRECT sign for banks (opposite of utils/REITs).
    assetGrowthDiscipline:  Object.freeze({ floor: -0.40,  elite: 0.00 }),     // live -ag p10 -0.258 / p90 -0.001

    // Axis B4 — earnings durability = min(NI avail)/max(NI avail) when max>0 and >=3 yrs. LOW weight + BLIND-walled
    // (only ~4 post-2020 years, no real credit cycle — the durability signal is structurally young).
    earningsDurability:     Object.freeze({ floor: 0.185,  elite: 0.863 }),    // live p10 0.213 / p90 0.865

    // ABS axis weights — SUM EXACTLY 1.0 (roaThruCycle .50 dominates; capitalAdequacy .25; assetGrowthDiscipline .18;
    // earningsDurability .07 deliberately low — the blind-walled young-durability axis is a small tiebreaker, not a pillar)
    weights: Object.freeze({ roaThruCycle: 0.50, capitalAdequacy: 0.25, assetGrowthDiscipline: 0.18, earningsDurability: 0.07 }),

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=128 -> full ABS+REL blend (β=0.6)
    lamps: Object.freeze({ creditQualityBlind: true, nimBlind: true, efficiencyRatioBlind: true, cet1Blind: true, depositFranchiseBlind: true }),
  }),

  // equity_reits CORE court bucket — ONE equity-REIT through-cycle quality cohort. Court gauntlet DESIGN
  // (BUILD_WITH_CAVEATS / court REVISE, 2026-06-24). NORMS RECOMPUTED LIVE on the FINAL de-ADR'd + deduped US pool
  // 2026-06-24 (n=114; the 14 'REIT - Mortgage' names HARD-SEPARATED OUT — a different animal) THEN frozen (the CORE
  // gate). 4 SCORED axes {opMargin, ffoAssets, revG3, ndGA} via the NEW engine absKaliberReits (coverage-renorm) — the
  // equity-REIT economics computable LOCALLY from annualRev/OpInc/NetIncome/Depreciation + annualBalance.{totalAssets,
  // totalDebt,totalCash}. DISTINCT axis set from every other CORE bucket (FFO-yield + NOI-margin + rent-base CAGR +
  // net-debt/assets leverage discipline) -> PARALLEL engine. NORMS NOT consumed by the 3-axis absKaliber/gateOpen path
  // nor any existing engine -> the 21 existing CORE/court buckets byte-identical.
  //
  // THE KEY DESIGN MOVES:
  //   - ffoAssets (FFO yield on asset base) ~48% coverage: annualDepreciation is ABSENT for the top-tier triple-net/
  //     industrial names (VICI/O/PLD/TRNO) -> their ffoAssets axis is DROPPED + renorm onto opMargin+revG3+ndGA, NEVER
  //     imputed (FFO_COVERAGE_PARTIAL lamp; disclosed in the comparabilityNote/BLIND wall — court revision #3).
  //   - FFO GAINS-ON-SALE GUARD (court revision #2): FFO ≈ NI + D&A omits the subtraction of gains-on-property-sales
  //     (no such field exists), inflating sale-active large-caps (SPG ffo/ocf = 1.49). The guard caps the ffoAssets
  //     observation when (NI+dep)/OCF > 1.2 (gains-inflated) -> FFO_GAINS_INFLATED lamp; residual disclosed FFO_GAINS_BLIND.
  //   - ndGA is the leverage-discipline axis, LEVEL-scored + INVERTED (lower net-debt/assets is better). It is q-input-
  //     negated EXACTLY as it_services netIssuance / banks assetGrowthDiscipline invert (q(-ndGA), the codebase's
  //     established inversion convention). GENEROUS calibration: only the OVER-levered lose points (a name at ~.29
  //     scores elite, ~.60 floor). This is LEVEL discipline, NOT the industrials asset-GROWTH penalty.
  //
  // FEASIBILITY DISCLOSURES — always-on BLIND walls (court revision #4): the most important REIT value-drivers carry NO
  // local signal:
  //   SAME_STORE_NOI_BLIND   — same-store NOI growth (the organic-quality gold standard) ABSENT.
  //   OCCUPANCY_BLIND        — physical / economic occupancy ABSENT.
  //   NAV_PREMIUM_BLIND      — NAV premium/discount ABSENT (and it is VALUATION — excluded by design).
  //   AFFO_MAINT_CAPEX_BLIND — maintenance-vs-growth capex split ABSENT -> AFFO approximate (FFO is the headline proxy).
  //   FFO_GAINS_BLIND        — gains-on-property-sales subtraction ABSENT (no field) -> FFO over-states for sale-active names.
  //
  // LIVE-RECOMPUTED percentiles (2026-06-24, the CLEAN de-ADR'd pool n=114; floor~p10, elite~p90):
  //   opMargin   p10 0.080 / p50 0.269 / p90 0.544 (NOI-margin proxy = annualOpInc[0]/annualRev[0]) -> floor .08 / elite .54
  //   ffoAssets  p10 0.023 / p50 0.060 / p90 0.094 ((NI+dep)/totalAssets; coverage 55/114=48%) -> floor .023 / elite .094
  //   revG3      p10 -0.013 / p50 0.051 / p90 0.170 (rent-base 3y CAGR) -> floor .00 (no neg-growth credit) / elite .17
  //   ndGA(-nd)  net-debt/assets live p10 .279 / p50 .447 / p90 .615 -> q(-ndGA) floor -.60 / elite -.29 (GENEROUS:
  //              ndGA .29 -> elite, ndGA .60 -> floor; only the over-levered lose points; LEVEL-scored discipline)
  equity_reits: Object.freeze({
    id: 'reits-norms-2026-06-24',
    cohortRule: 'meta.sector=="Real Estate" && meta.industry in {REIT - Retail, Office, Industrial, Residential, Diversified, Healthcare Facilities, Specialty, Hotel & Motel} && US-listing (de-ADRd) && >=$1B, deduped; REIT - Mortgage HARD-SEPARATED OUT',

    // Axis R1 — NOI-margin proxy = annualOpInc[0]/annualRev[0] (operating efficiency of the property portfolio).
    opMargin:   Object.freeze({ floor: 0.08,  elite: 0.54 }),       // live p10 8.0% / p90 54.4%

    // Axis R2 — FFO yield on asset base = (annualNetIncome[0] + annualDepreciation[0]) / annualBalance[0].totalAssets.
    // ~48% coverage (annualDepreciation absent for VICI/O/PLD/TRNO) -> DROP+renorm + FFO_COVERAGE_PARTIAL, NEVER imputed.
    // FFO-gains guard caps the observation when (NI+dep)/OCF > 1.2 (gains-on-sale inflation; SPG) -> FFO_GAINS_INFLATED.
    ffoAssets:  Object.freeze({ floor: 0.023, elite: 0.094 }),      // live p10 2.3% / p90 9.4% (coverage 48%)

    // Axis R3 — rent-base 3y CAGR = (annualRev[0]/annualRev[3])^(1/3)-1. Floor 0.00 (no credit for contraction),
    // elite 0.17 (live p90 16.98%). <4 rev years -> DROP+renorm + REVG3_THIN.
    revG3:      Object.freeze({ floor: 0.00,  elite: 0.17 }),       // live p10 -1.3% / p90 17.0%

    // Axis R4 — leverage discipline, INVERTED + LEVEL-scored = q(-ndGA); ndGA = (totalDebt-totalCash)/totalAssets.
    // q(-ndGA): floor -0.60 (60% net-debt/assets = over-levered = 0), elite -0.29 (29% = well-capitalized = 1). GENEROUS:
    // only the over-levered lose points (live ndGA p90 .615 -> q~0; p10 .279 -> q~1). NOT a growth penalty — LEVEL.
    ndGA:       Object.freeze({ floor: -0.60, elite: -0.29 }),      // live net-debt/assets p10 27.9% / p90 61.5% (inverted)

    // ABS axis weights — SUM EXACTLY 1.0 (opMargin .30 + ffoAssets .30 the profitability pillar; revG3 .25 rent growth;
    // ndGA .15 the GENEROUS leverage-discipline tiebreaker — a well-run REIT is not penalized for prudent leverage)
    weights: Object.freeze({ opMargin: 0.30, ffoAssets: 0.30, revG3: 0.25, ndGA: 0.15 }),

    ffoGainsGuard: Object.freeze({ ratioCap: 1.2 }),                // (NI+dep)/OCF > 1.2 -> ffoAssets gains-inflated (court revision #2)
    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=114 -> full ABS+REL blend (β=0.6)
    lamps: Object.freeze({ sameStoreNoiBlind: true, occupancyBlind: true, navPremiumBlind: true, affoMaintCapexBlind: true, ffoGainsBlind: true }),
  }),

  // capmkt_fee_core CORE court bucket — ONE asset-light FEE-business cohort (exchanges, rating agencies, index/data,
  // asset managers, brokers) by THROUGH-CYCLE FEE-FRANCHISE QUALITY. Court gauntlet DESIGN (BUILD_WITH_CAVEATS / court
  // REVISE, 2026-06-24) + RE-COURT 2026-06-24 (DENIED for BDC contamination -> 2 new fee-gate arms). NORMS RE-FROZEN
  // LIVE on the FINAL de-ADR'd + fee-gated + DE-BDC'd + DE-MINED + deduped US pool 2026-06-24 (n=84; raw US >=$1B in
  // the four industries MINUS 71 fee-gate exclusions) THEN frozen (the CORE gate). 4 SCORED axes
  // {opMargin, opMarginStability, fcfMargin, netIssuance} via the NEW engine absKaliberCapmkt (coverage-renorm,
  // mirroring absKaliberItServices) — the asset-light fee-margin economics computable LOCALLY from annualRev/OpInc/FCF
  // + annualShares. opMargin/opMarginStability/fcfMargin NON-inverted (higher=better); netIssuance is the inverted
  // q(-NSI) discipline axis. DISTINCT axis set from every other CORE bucket (margin LEVEL + margin STABILITY together)
  // -> PARALLEL engine. NORMS NOT consumed by the 3-axis absKaliber/gateOpen path nor any existing engine -> the 22
  // existing CORE/court buckets byte-identical.
  //
  // THE KEY DESIGN MOVE — THE ECONOMIC FEE-GATE (court revision #1, implemented in classify-capmkt.js): closed-end
  // funds + float-heavy brokers produce pass-through fcfMargin/niMargin ARTIFACTS that top the cohort. The HARD
  // BLOCKER (KYN closed-end fund: rev $25.4M, FCF $223.5M -> fcfMargin 8.80; TIGR offshore broker: client float, not
  // fee cash) is killed by a TWO-arm ECONOMIC gate at CLASSIFICATION (never a name list): (1) FUND_FLOAT_PASSTHROUGH
  // fcfMargin>1.0 (a real fee business cannot FCF more than its revenue — KYN/APO/IBKR/PDO), (2) RIC_PASSTHROUGH
  // niMargin>=0.95 (a '40-Act closed-end fund drops ~all investment income to NI — the live genuine-fee max niMargin
  // is APO .76, so .95 has zero false positives). RE-COURT 2026-06-24 added TWO MORE arms after a max-severity DENIAL
  // for BDC contamination (the original top-5 were 4 BDCs, leveraged spread-lenders, with CME/MSCI/ICE buried at ranks
  // 6-14): (3) BDC_SPREAD_LOAN_BOOK — externally-managed BDCs survive arms (1)/(2) (fcfMargin .72-.94, niMargin
  // .31-.49) but are leveraged closed-end LOAN vehicles, NOT fee businesses; gated by the ECONOMIC signature
  // revToAssets ∈[.05,.16] (interest income on a big loan book) ∧ totalDebt=null ∧ liabilities/equity ∈[.7,2.0] (the
  // regulated ~2:1 BDC asset-coverage), catching all 11 live BDCs with ZERO genuine-fee false positives (the leverage
  // CEILING 2.0 spares the alt-manager holdco CG at TL/TE 3.83); (4) CRYPTO_MINER_NON_FEE — 5 commodity bitcoin-miners
  // (CLSK/HIVE/MARA/RIOT/WULF) mislabeled into Capital Markets, gated by persistent operating loss (opMargin<0 every
  // year) ∧ materially negative mean NI AND FCF margins (<-.20), sparing COIN/HOOD/CG/BWIN. 71 names fee-gated OUT
  // (16+39+11+5). The BDC_SPREAD_BLIND wall is now LARGELY MOOT (the BDCs are hard-gated out, not scored) but kept
  // always-on as a structural disclosure for any future borderline lender that the economic gate does not catch.
  //
  // SECOND DESIGN MOVE — COUNTRY NORMALIZE (court revision #2): snapshots carry country===undefined (NOT null) for the
  // Vintage-A US names. The classify-in test treats undefined === US-primary (admit via US exchange + USD + no foreign
  // legal-form name), so MSCI/MCO/ICE/NDAQ/KKR (all country=undefined, NYSE/Nasdaq, USD) are RETAINED. The anti-leak
  // assert keys on the foreign-DENY SIGNAL, NOT country!=US (which would wrongly throw on these legitimate undefined-
  // country US names — the design's whole revision #2 point).
  //
  // FEASIBILITY DISCLOSURES — always-on BLIND walls: the most important fee-franchise dimensions carry NO local signal:
  //   AUM_FLOW_BLIND      — assets-under-management net flows / organic AUM growth (the fee-engine fuel) ABSENT.
  //   FEE_RATE_BLIND      — fee rate / take-rate compression (the secular margin threat) ABSENT.
  //   RECURRING_MIX_BLIND — recurring/subscription vs transactional/performance-fee revenue mix ABSENT.
  //   BDC_SPREAD_BLIND    — for the surviving BDCs: spread/interest income vs a true fee franchise is indistinguishable
  //                         on local data (court revision #1 disclosed residual).
  //
  // LIVE-RE-FROZEN percentiles (RE-COURT 2026-06-24, the CLEAN de-ADR'd + fee-gated + DE-BDC'd + DE-MINED + deduped
  // pool n=84; floor~p10, elite~p90). The de-BDC + de-mining lifted the opMargin/fcfMargin FLOORS sharply (the
  // contaminated miners had dragged them deeply negative):
  //   opMargin           p10 -0.013 / p50 0.237 / p90 0.502 (annualOpInc[0]/annualRev[0] level) -> floor -.01 / elite .50
  //   opMarginStability  p10 .035 / p50 0.973 / p90 1.00 (1-CV(opMargin) clamp[0,1]; cov ~65/84) -> identity-clip floor 0 / elite 1
  //   fcfMargin          p10 -0.227 / p50 0.200 / p90 0.519 (annualFCF[0]/annualRev[0]) -> floor -.23 / elite .52
  //   netIssuance(-NSI)  p10 -.084 / p50 0.002 / p90 0.118 (cov 36/84=43% -> DROP+renorm; buyback=elite) -> floor -.08 / elite .12
  capmkt_fee_core: Object.freeze({
    id: 'capmkt-norms-2026-06-24',
    cohortRule: 'meta.sector=="Financial Services" && meta.industry in {Asset Management, Capital Markets, Financial Data & Stock Exchanges, Insurance Brokers} && US-listing (de-ADRd) && >=$1B, deduped; fee-gated (fcfMargin>1.0 FUND_FLOAT / niMargin>=0.95 RIC_PASSTHROUGH) OUT',

    // Axis C1 — operating-margin LEVEL = annualOpInc[0]/annualRev[0] (the fee-franchise pricing power).
    // RE-FROZEN on the de-BDC'd + de-mined clean pool (n=84): removing the 5 deeply-negative crypto miners lifted the
    // opMargin p10 floor from the contaminated -.27 to -.01 (the genuine asset-light fee floor).
    opMargin:          Object.freeze({ floor: -0.01, elite: 0.50 }),    // live p10 -1.3% / p90 50.2% (n=84 clean)

    // Axis C2 — operating-margin STABILITY = 1 - CV(opMargin over available years), CV=stdev/|mean|, clamp [0,1]
    // (a through-cycle pricing-durability proxy; identity-clip — the axis already emits 0..1). cov ~65/84.
    opMarginStability: Object.freeze({ floor: 0.0,   elite: 1.0 }),     // identity-clip (axis emits 0–1)

    // Axis C3 — FCF margin = annualFCF[0]/annualRev[0] (cash conversion = the fee-engine payoff; Mohanram cash-quality).
    // RE-FROZEN clean (n=84): de-mining lifted the fcfMargin p10 floor from the contaminated -.67 to -.23.
    fcfMargin:         Object.freeze({ floor: -0.23, elite: 0.52 }),    // live p10 -22.7% / p90 51.9% (n=84 clean; fund-float >1.0 + BDC + miners gated out)

    // Axis C4 — net-share-issuance penalty (Pontiff-Woodgate; q(-NSI), buyback=elite = the compounder signature).
    // netIssuance = -((annualShares[0]-annualShares[1])/annualShares[1]). cov 36/84=43% (Vintage-A lacks annualShares)
    // -> DROP+renorm + ISSUANCE_NOT_READY, NEVER imputed.
    netIssuance:       Object.freeze({ floor: -0.08, elite: 0.12 }),    // live -NSI p10 -8.4% / p90 11.8% (n=84 clean, ~43% coverage)

    // ABS axis weights — SUM EXACTLY 1.0 (the margin-quality pillar opMargin+opMarginStability = .60 dominates; the
    // partial-coverage netIssuance .15 is the smallest weight — the design's evidence-strength ordering).
    weights: Object.freeze({ opMargin: 0.30, opMarginStability: 0.30, fcfMargin: 0.25, netIssuance: 0.15 }),

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=84 -> full ABS+REL blend (β=0.6)
    lamps: Object.freeze({ aumFlowBlind: true, feeRateBlind: true, recurringMixBlind: true, bdcSpreadBlind: true }),
  }),

  // medical_care_facilities CORE court bucket — ONE capital-intensive HEALTHCARE-FACILITIES operating-quality cohort
  // (hospital / SNF / dialysis / rehab / hospice / surgery / home-health operators: HCA/THC/UHS/EHC/ENSG/SEM/DVA/
  // ACHC/CHE...). Court gauntlet DESIGN (BUILD as a DISCLOSED partial-quality read — the banks precedent: real
  // OPERATING quality is locally computable, but the core value driver (reimbursement-rate trajectory / payer mix /
  // census-occupancy / regulatory) is BLIND in the snapshot and is HONESTLY disclosed via always-on BLIND walls, never
  // faked). NORMS COMPUTED LIVE on the FINAL de-ADR'd + deduped US pool 2026-06-24 (n=28) THEN frozen (the CORE gate).
  // 4 SCORED axes {opMargin, roaThruCycle, fcfMargin, leverageDiscipline} via the NEW engine absKaliberMedFac
  // (coverage-renorm; the 23 existing CORE/court buckets BYTE-UNTOUCHED). The operating-quality economics are computable
  // LOCALLY from annualRev/OpInc/FCF/NetIncome + annualBalance.{totalAssets,totalDebt,totalCash}.
  //
  // THE KEY DESIGN MOVES:
  //   - QUALITY-ONLY, NO GROWTH AXIS (the materials/tech_hardware lesson — do NOT exile a quality operator for a down
  //     year, and do NOT let a serial-acquirer's deal-masked revenue growth inflate the score; ENSG/SEM are aggressive
  //     acquirers whose organic growth is unreadable here). roaThruCycle is the capital-return co-pillar so the
  //     deliberately-low-margin / high-ROIC SNF operators (ENSG) are NOT under-ranked by an opMargin-only read.
  //   - roaThruCycle (the banks lead-axis pattern) = mean of available annualNetIncome[i]/annualBalance[i].totalAssets
  //     over i=0..3 (a 4-year through-cycle ROA average, not a single year — damps a one-off impairment year). Floor 0
  //     (no credit for a loss-making average; the live p10 -9.1% is dragged by the impaired names AGL/PIII/AVAH which
  //     SHOULD score the floor), elite 0.10 (HCA 10.2% ≈ elite; the genuine capital-efficient operator).
  //   - leverageDiscipline is the LEVEL-scored INVERTED axis q(-ndGA); ndGA = (totalDebt-totalCash)/totalAssets. Same
  //     inversion convention as it_services netIssuance / banks assetGrowthDiscipline / reits ndGA. GENEROUS calibration
  //     (a name at ~.30 net-debt/assets scores elite, ~.67 floor) — only the OVER-levered (BKD/SNDA at high leverage)
  //     lose points; prudent leverage is not penalized.
  //
  // FEASIBILITY DISCLOSURES — always-on BLIND walls (the banks credit-quality-blind precedent): the SINGLE MOST
  // IMPORTANT facilities value-drivers carry NO local signal and are disclosed, never imputed:
  //   REIMBURSEMENT_RATE_BLIND — Medicare/Medicaid/commercial reimbursement-rate trajectory ABSENT (THE core driver;
  //                              the score cannot see rate cuts/increases — disclosed, never faked).
  //   PAYER_MIX_BLIND          — payer mix (Medicare vs Medicaid vs commercial vs self-pay) ABSENT.
  //   CENSUS_OCCUPANCY_BLIND   — patient census / bed occupancy / admissions-volume trend ABSENT.
  //   REGULATORY_BLIND         — regulatory exposure (DOJ/CMS audits, site-of-care shifts, staffing mandates) ABSENT.
  //
  // LIVE-COMPUTED percentiles (2026-06-24, the CLEAN de-ADR'd pool n=28; floor~p10, elite~p90):
  //   opMargin           p10 -0.035 / p50 0.062 / p90 0.158 (annualOpInc[0]/annualRev[0] level) -> floor -.035 / elite .158
  //   roaThruCycle       p10 -0.091 / p50 0.030 / p90 0.069 (4y-avg NI/totalAssets) -> floor .00 (no loss-credit) / elite .10
  //   fcfMargin          p10 -0.025 / p50 0.056 / p90 0.119 (annualFCF[0]/annualRev[0]) -> floor -.025 / elite .119
  //   leverageDisc(-ndGA) net-debt/assets live p10 -0.035 / p50 0.311 / p90 0.674 -> q(-ndGA) floor -.674 / elite -.30
  //                       (GENEROUS: ndGA .30 -> elite, ndGA .67 -> floor; only the over-levered lose points; LEVEL-scored)
  medical_care_facilities: Object.freeze({
    id: 'medfac-norms-2026-06-24',
    cohortRule: 'meta.sector=="Healthcare" && meta.industry=="Medical Care Facilities" && US-listing (de-ADRd) && >=$1B, deduped',

    // Axis M1 — operating-margin LEVEL = annualOpInc[0]/annualRev[0] (the facilities operating efficiency / cost control).
    opMargin:            Object.freeze({ floor: -0.035, elite: 0.158 }),  // live p10 -3.5% / p90 15.8%

    // Axis M2 — through-cycle ROA = mean of available annualNetIncome[i]/annualBalance[i].totalAssets over i=0..3
    // (the capital-return co-pillar; 4y average damps a one-off impairment year). Floor 0 = no credit for a loss-making
    // average (the impaired AGL/PIII/AVAH SHOULD score the floor); elite 0.10 (HCA 10.2% ≈ elite).
    roaThruCycle:        Object.freeze({ floor: 0.00,  elite: 0.10 }),    // live p10 -9.1% / p90 6.9% (floor lifted to break-even)

    // Axis M3 — FCF margin = annualFCF[0]/annualRev[0] (cash conversion = the operating-quality payoff; Mohanram cash-quality).
    fcfMargin:           Object.freeze({ floor: -0.025, elite: 0.119 }),  // live p10 -2.5% / p90 11.9%

    // Axis M4 — leverage discipline, INVERTED + LEVEL-scored = q(-ndGA); ndGA = (totalDebt-totalCash)/totalAssets.
    // q(-ndGA): floor -0.674 (67% net-debt/assets = over-levered = 0), elite -0.30 (30% = well-capitalized = 1). GENEROUS:
    // only the over-levered lose points (live ndGA p90 .674 -> q~0; p10 -.035 net-cash -> q~1). NOT a growth penalty — LEVEL.
    leverageDiscipline:  Object.freeze({ floor: -0.674, elite: -0.30 }),  // live net-debt/assets p10 -3.5% / p90 67.4% (inverted)

    // ABS axis weights — SUM EXACTLY 1.0 (the operating-quality pillar opMargin .30 + roaThruCycle .30 = .60 dominates;
    // fcfMargin .25 cash conversion; leverageDiscipline .15 the GENEROUS leverage tiebreaker — a well-run operator is not
    // penalized for prudent leverage). NO GROWTH WEIGHT — quality-only membership (the materials/tech_hardware lesson).
    weights: Object.freeze({ opMargin: 0.30, roaThruCycle: 0.30, fcfMargin: 0.25, leverageDiscipline: 0.15 }),

    rel: Object.freeze({ minN: 15, beta: 0.6 }),                    // n=28 -> full ABS+REL blend (β=0.6)
    lamps: Object.freeze({ reimbursementRateBlind: true, payerMixBlind: true, censusOccupancyBlind: true, regulatoryBlind: true }),
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
 * absKaliberEnergy(rec, bucket) — 5-axis weighted-q absolute caliber with COVERAGE-RENORM for the
 * energy_quality cohorts (Spec formula-design-energy_quality-v0-2026-06-22.md §2/§5). The energy axis SET is
 * DISTINCT from every other CORE bucket: axis B is ROCE (opInc/totalAssets, the through-cycle capital-return
 * PILLAR) and axis C is FCF-MARGIN (annualFCF/annualRev, the capital-discipline arm that survives Vintage A) —
 * neither is the industrials `eff` nor the materials `marginStability`. So this is a PARALLEL engine, NOT a
 * delegate. Shares only the two INVERTED discipline axes (assetGrowthPenalty/netIssuance, q(-raw)) with
 * industrials/staples/materials. Reads the per-cohort energy NORMS (roce/fcfMargin/gpa cohort-specific;
 * assetGrowthPenalty/netIssuance shared). Weights {roce .30, fcfMargin .22, assetGrowthPenalty .18, gpa .16,
 * netIssuance .14} — the capital-discipline+resilience pillar roce+fcfMargin+assetGrowthPenalty = 0.70
 * structurally dominates. GROWTH IS NOT AN AXIS (a commodity-cyclical never earns a positive scored growth
 * credit — the QUALITY-ONLY guarantee). NEW code keyed by the energy cohort strings → all other buckets
 * byte-identical (their paths untouched).
 *
 * The ISSUANCE_NOT_READY coverage-renorm (Vintage-A slice lacking annualShares, ~50% of the pool) and the
 * NOT_READY:roce/:fcfmargin/:gpa/:assetgrowth drops are exercised exactly as in industrials/materials (null raw
 * -> drop, no fake-neutral impute; survivors renormalize to Σ=1.0).
 *
 * Returns { absK in [0,1], usedAxes:[...], droppedAxes:[...], renormWeights:{...} }.
 *
 * @param {{roce:?number, fcfMargin:?number, gpa:?number, assetGrowth:?number, netShareIssuance:?number}} rec
 * @param {string} bucket  — 'energy_upstream' | 'energy_midstream' | 'energy_services'
 * @returns {{absK:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object}}
 */
function absKaliberEnergy(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberEnergy: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.roce || !norm.fcfMargin || !norm.gpa || !norm.assetGrowthPenalty || !norm.netIssuance) {
    throw new Error(`absKaliberEnergy: Bucket "${bucket}" hat keine energy-NORMS (5-Achs-Gewichte/Anker fehlen)`);
  }
  // Per-axis q-input (the inverted axes negate the raw; null raw -> axis DROP, not 0-impute). FIVE axes,
  // axis B = ROCE, axis C = FCF-margin (NO growth axis — QUALITY-ONLY by construction).
  const axes = [
    { key: 'roce',               qin: rec.roce,                                                       norm: norm.roce },
    { key: 'fcfMargin',          qin: rec.fcfMargin,                                                  norm: norm.fcfMargin },
    { key: 'gpa',                qin: rec.gpa,                                                        norm: norm.gpa },
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
 * absKaliberPharma(rec, bucket) — THREE-axis weighted-q absolute caliber with COVERAGE-RENORM for the
 * pharma_commercial cohorts (Spec formula-design-pharma_court-v0-2026-06-22.md §2/§3). The pharma axis SET
 * {growth, gm, eff} is the SAME 3 axes as the medtech/dlst absKaliber() path — but absKaliber() has NO
 * coverage-renorm (it 0-imputes a null axis via q()), and a royalty/no-GP biopharma (RPRX/ARWR carry
 * annualGP=[null,null]) needs the gm axis DROPPED, not 0-imputed. So this is a PARALLEL engine keyed by the
 * pharma cohort strings → the medtech/dlst 3-axis path is BYTE-UNTOUCHED (those still call absKaliber()).
 *
 * Three LINEAR q-axes, each reading the cohort norm (NONE inverted — higher=better directly; no assetGrowth/
 * netIssuance discipline axes since the Vintage-A snapshots lack annualShares and the M&A signal is the
 * upstream deal-mask on the growth axis, not a scored penalty):
 *   growth -> q(rec.growth, norm.growth)   (deal-masked + winsorized + spinoff-guarded UPSTREAM in court-screen)
 *   gm     -> q(rec.gm,     norm.gm)        (annualGP[0]/annualRev[0]; null on a no-GP royalty name -> DROP)
 *   eff    -> q(rec.eff,    norm.eff)        (FCF-margin primary, OpM fallback; precomputed upstream)
 *
 * COVERAGE-RENORM (mirrors absKaliberIndustrials/Materials/Energy): any axis whose raw input is `null`
 * (NOT_READY:growth on a fully-deal-masked serial acquirer like CPRX, or a null-GP royalty name) is DROPPED and
 * the surviving axis weights are re-normalized to sum 1.0 before the weighted sum — no fake-neutral 0-impute.
 * If EVERY axis is null (pathological) → 0.
 *
 * THIN_REL (branded n=10<15): handled in court-score.js by the per-cohort rel.beta (branded beta=1.0 ABS-only);
 * absKaliberPharma itself is REL-agnostic (it returns the pure ABS caliber, blended downstream by blendScore).
 *
 * Returns { absK in [0,1], usedAxes:[...], droppedAxes:[...], renormWeights:{...} } so court-score.js can
 * persist the audit trail (which axes survived, the renormalized weight vector).
 *
 * @param {{growth:?number, gm:?number, eff:?number}} rec
 * @param {string} bucket  — 'pharma_branded' | 'pharma_biopharma' | 'pharma_specialty'
 * @returns {{absK:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object}}
 */
function absKaliberPharma(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberPharma: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.growth || !norm.gm || !norm.eff) {
    throw new Error(`absKaliberPharma: Bucket "${bucket}" hat keine pharma-NORMS (3-Achs-Gewichte/Anker fehlen)`);
  }
  // Per-axis q-input (NONE inverted; null raw -> axis DROP, not 0-impute). THREE axes {growth, gm, eff}.
  const axes = [
    { key: 'growth', qin: rec.growth, norm: norm.growth },
    { key: 'gm',     qin: rec.gm,     norm: norm.gm },
    { key: 'eff',    qin: rec.eff,    norm: norm.eff },
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
 * absKaliberItServices(rec, bucket) — 5-axis weighted-q absolute caliber with COVERAGE-RENORM for the it_services
 * CORE cohort (Spec formula-design-special_tracks-v0-2026-06-22.md PART B §B.3). The IT-services axis SET
 * {gpa, fcfMargin, opMargin, growth, netIssuance} is DISTINCT from every other CORE bucket: it has BOTH a direct
 * opMargin axis AND a scored organic-growth axis, and gpa/fcfMargin/opMargin/growth are all NON-inverted
 * (higher=better directly) — only netIssuance is the inverted q(-NSI) discipline axis. So this is a PARALLEL engine,
 * NOT a delegate (energy's 5th axis is the inverted assetGrowthPenalty and energy has NO growth axis; materials'
 * axis C is the identity-clip marginStability; industrials/staples' axis C is the blended eff). NEW code keyed by
 * the it_services cohort string -> the 12 existing CORE buckets byte-identical (their paths untouched).
 *
 * Reads the cohort NORMS it_services (gpa/fcfMargin/opMargin/growth/netIssuance + weights
 * {gpa .34, fcfMargin .24, opMargin .18, growth .14, netIssuance .10} — the capital-discipline+profitability pillar
 * gpa+fcfMargin+netIssuance = .68 structurally dominates growth .14). REVENUE-PER-EMPLOYEE IS NOT AN AXIS (§B.2 —
 * RPE is INVERTED on the live cohort, used only as the classifier contamination gate + an advisory flag, weight 0.00;
 * the people-leverage thesis is carried by people-leverage-VIA-asset-efficiency = gpa, disclosed PEOPLE_LEVERAGE_BLIND).
 *
 * COVERAGE-RENORM (mirrors absKaliberIndustrials/Materials/Energy): any axis whose raw input is `null` (NOT_READY:
 * growth on a fully-deal-masked serial acquirer / SPINOFF_REBASE, or ISSUANCE_NOT_READY on the ~50% of names lacking
 * annualShares) is DROPPED and the surviving axis weights are re-normalized to sum 1.0 before the weighted sum — no
 * fake-neutral 0-impute. If EVERY axis is null (pathological) -> 0. The inverted axis (netIssuance) uses the NEGATED
 * raw as the q-input; raw null means the axis is dropped (not scored 0).
 *
 * Returns { absK in [0,1], usedAxes:[...], droppedAxes:[...], renormWeights:{...} } so court-score.js can persist
 * the audit trail (which axes survived, the renormalized weight vector).
 *
 * @param {{gpa:?number, fcfMargin:?number, opMargin:?number, growth:?number, netShareIssuance:?number}} rec
 * @param {string} bucket  — 'it_services'
 * @returns {{absK:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object}}
 */
function absKaliberItServices(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberItServices: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.gpa || !norm.fcfMargin || !norm.opMargin || !norm.growth || !norm.netIssuance) {
    throw new Error(`absKaliberItServices: Bucket "${bucket}" hat keine it_services-NORMS (5-Achs-Gewichte/Anker fehlen)`);
  }
  // Per-axis q-input (only netIssuance is inverted via negated raw; null raw -> axis DROP, not 0-impute). FIVE axes:
  // gpa (lead, asset-light proxy), fcfMargin, opMargin, growth (all higher=better), netIssuance (inverted q(-NSI)).
  const axes = [
    { key: 'gpa',         qin: rec.gpa,                                                        norm: norm.gpa },
    { key: 'fcfMargin',   qin: rec.fcfMargin,                                                  norm: norm.fcfMargin },
    { key: 'opMargin',    qin: rec.opMargin,                                                   norm: norm.opMargin },
    { key: 'growth',      qin: rec.growth,                                                     norm: norm.growth },
    { key: 'netIssuance', qin: (rec.netShareIssuance == null ? null : -rec.netShareIssuance), norm: norm.netIssuance },
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
 * absKaliberBanks(rec, bucket) — 4-axis weighted-q absolute caliber with COVERAGE-RENORM for the financials_banks
 * CORE court bucket (court gauntlet DESIGN, BUILD_WITH_CAVEATS / court REVISE 2026-06-23). The bank axis SET
 * {roaThruCycle, capitalAdequacy, assetGrowthDiscipline, earningsDurability} is DISTINCT from every other CORE bucket:
 * it has NO gpa/fcfMargin/opMargin/growth axis (annualGP is structurally 0 for banks, annualOpInc is empty, and
 * annualFCF/annualOCF are economically meaningless — JPM annualFCF[0] = -$147.8B — and HARD-EXCLUDED). roaThruCycle/
 * capitalAdequacy/earningsDurability are NON-inverted (higher=better); assetGrowthDiscipline is the INVERTED penalty
 * axis (q-input = -assetGrowthYoY — zero balance-sheet growth is elite, ballooning is penalized; the CORRECT sign for
 * banks, opposite of utilities/REITs). So this is a PARALLEL engine, NOT a delegate (it_services' 5th axis is the
 * inverted netIssuance and it has gpa/opMargin/growth; energy's 5th is the inverted assetGrowthPenalty but its other
 * axes are roce/fcfMargin/gpa). NEW code keyed by the financials_banks cohort string -> the 20 existing CORE/court
 * buckets byte-identical (their paths untouched).
 *
 * Reads the cohort NORMS financials_banks (roaThruCycle/capitalAdequacy/assetGrowthDiscipline/earningsDurability +
 * weights {roaThruCycle .50, capitalAdequacy .25, assetGrowthDiscipline .18, earningsDurability .07} — roaThruCycle
 * .50 structurally dominates; the blind-walled young earningsDurability .07 is a small tiebreaker, not a pillar).
 *
 * COVERAGE-RENORM (mirrors absKaliberIndustrials/Materials/Energy/ItServices): any axis whose raw input is `null` is
 * DROPPED and the surviving axis weights are re-normalized to sum 1.0 before the weighted sum — no fake-neutral
 * 0-impute. The court-mandated case: capitalAdequacy is null on ~45% of the pool (totalEquity absent, INCLUDING the
 * marquees JPM/WFC/PNC/USB) — those names DROP the capitalAdequacy axis and score on the OTHER 3 axes, NEVER imputed.
 * The inverted axis (assetGrowthDiscipline) uses the NEGATED raw assetGrowthYoY as the q-input; raw null means the
 * axis is dropped (not scored 0). If EVERY axis is null (pathological shell) -> 0 (the SHELL gate in court-score.js
 * SI-4-excludes those upstream, so this 0 is a defensive backstop only).
 *
 * Returns { absK in [0,1], usedAxes:[...], droppedAxes:[...], renormWeights:{...} } so court-score.js can persist
 * the audit trail (which axes survived — e.g. capitalAdequacy-dropped — and the renormalized weight vector).
 *
 * @param {{roaThruCycle:?number, capitalAdequacy:?number, assetGrowthYoY:?number, earningsDurability:?number}} rec
 * @param {string} bucket  — 'financials_banks'
 * @returns {{absK:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object}}
 */
function absKaliberBanks(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberBanks: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.roaThruCycle || !norm.capitalAdequacy || !norm.assetGrowthDiscipline || !norm.earningsDurability) {
    throw new Error(`absKaliberBanks: Bucket "${bucket}" hat keine banks-NORMS (4-Achs-Gewichte/Anker fehlen)`);
  }
  // Per-axis q-input (the inverted penalty axis assetGrowthDiscipline negates the raw assetGrowthYoY; null raw ->
  // axis DROP, not 0-impute). FOUR axes only. FCF/OCF are NEVER an axis (hard-excluded for banks).
  const axes = [
    { key: 'roaThruCycle',          qin: rec.roaThruCycle,                                                  norm: norm.roaThruCycle },
    { key: 'capitalAdequacy',       qin: rec.capitalAdequacy,                                               norm: norm.capitalAdequacy },
    { key: 'assetGrowthDiscipline', qin: (rec.assetGrowthYoY == null ? null : -rec.assetGrowthYoY),         norm: norm.assetGrowthDiscipline },
    { key: 'earningsDurability',    qin: rec.earningsDurability,                                            norm: norm.earningsDurability },
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
 * absKaliberReits(rec, bucket) — 4-axis weighted-q absolute caliber with COVERAGE-RENORM for the equity_reits CORE
 * court bucket (court gauntlet DESIGN, BUILD_WITH_CAVEATS / court REVISE 2026-06-24). The equity-REIT axis SET
 * {opMargin, ffoAssets, revG3, ndGA} is DISTINCT from every other CORE bucket: it is the FFO/NOI animal (NOI-margin +
 * FFO-yield + rent-base 3y CAGR + net-debt/assets leverage discipline). opMargin/ffoAssets/revG3 are NON-inverted
 * (higher=better); ndGA is the INVERTED + LEVEL-scored leverage-discipline axis (q-input = -ndGA — lower net-debt/
 * assets is better; the codebase's established inversion convention, mirroring it_services netIssuance + banks
 * assetGrowthDiscipline). So this is a PARALLEL engine, NOT a delegate. NEW code keyed by the equity_reits cohort
 * string -> the 21 existing CORE/court buckets byte-identical (their paths untouched).
 *
 * Reads the cohort NORMS equity_reits (opMargin/ffoAssets/revG3/ndGA + weights {opMargin .30, ffoAssets .30, revG3
 * .25, ndGA .15} — the opMargin+ffoAssets profitability pillar = .60; ndGA .15 GENEROUS so only the over-levered lose
 * points, never penalizing prudent leverage).
 *
 * COVERAGE-RENORM (mirrors absKaliberBanks/Industrials/ItServices): any axis whose raw input is `null` is DROPPED and
 * the surviving axis weights are re-normalized to sum 1.0 before the weighted sum — no fake-neutral 0-impute. The
 * court-mandated case: ffoAssets is null on ~52% of the pool (annualDepreciation absent, INCLUDING the top-tier names
 * VICI/O/PLD/TRNO) — those names DROP the ffoAssets axis and score on opMargin+revG3+ndGA, NEVER imputed (court
 * revision #3). The inverted axis (ndGA) uses the NEGATED raw ndGA as the q-input; raw null means the axis is dropped
 * (not scored 0). If EVERY axis is null (pathological shell) -> 0 (the SHELL gate in court-score.js SI-4-excludes those
 * upstream, so this 0 is a defensive backstop only).
 *
 * The FFO GAINS-ON-SALE GUARD (court revision #2) is applied UPSTREAM in court-screen.js: when (NI+dep)/OCF > 1.2 the
 * ffoAssets observation is gains-inflated and is capped there (FFO_GAINS_INFLATED lamp) BEFORE it reaches this engine,
 * so the engine sees the sanity-bounded ffoAssets. (The guard cannot live here — it needs OCF, not a NORMS axis.)
 *
 * Returns { absK in [0,1], usedAxes:[...], droppedAxes:[...], renormWeights:{...} } so court-score.js can persist the
 * audit trail (which axes survived — e.g. ffoAssets-dropped on VICI/O/PLD/TRNO — and the renormalized weight vector).
 *
 * @param {{opMargin:?number, ffoAssets:?number, revG3:?number, ndGA:?number}} rec
 * @param {string} bucket  — 'equity_reits'
 * @returns {{absK:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object}}
 */
function absKaliberReits(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberReits: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.opMargin || !norm.ffoAssets || !norm.revG3 || !norm.ndGA) {
    throw new Error(`absKaliberReits: Bucket "${bucket}" hat keine reits-NORMS (4-Achs-Gewichte/Anker fehlen)`);
  }
  // Per-axis q-input (the inverted leverage-discipline axis ndGA negates the raw; null raw -> axis DROP, not 0-impute).
  // FOUR axes only. ndGA is q(-ndGA): lower net-debt/assets scores higher.
  const axes = [
    { key: 'opMargin',  qin: rec.opMargin,                                       norm: norm.opMargin },
    { key: 'ffoAssets', qin: rec.ffoAssets,                                      norm: norm.ffoAssets },
    { key: 'revG3',     qin: rec.revG3,                                          norm: norm.revG3 },
    { key: 'ndGA',      qin: (rec.ndGA == null ? null : -rec.ndGA),              norm: norm.ndGA },
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
 * absKaliberCapmkt(rec, bucket) — 4-axis weighted-q absolute caliber with COVERAGE-RENORM for the capmkt_fee_core
 * CORE court bucket (court gauntlet DESIGN, BUILD_WITH_CAVEATS / court REVISE 2026-06-24). The asset-light fee-business
 * axis SET {opMargin, opMarginStability, fcfMargin, netIssuance} is DISTINCT from every other CORE bucket: it pairs a
 * margin LEVEL axis with a margin STABILITY axis (a through-cycle pricing-durability proxy). opMargin/opMarginStability/
 * fcfMargin are NON-inverted (higher=better directly); netIssuance is the INVERTED q(-NSI) discipline axis (the engine
 * negates the RAW netShareIssuance itself, mirroring it_services). So this is a PARALLEL engine, NOT a delegate
 * (it_services has gpa/opMargin/growth and 5 axes; this has the unique opMarginStability axis and no growth/gpa axis).
 * NEW code keyed by the capmkt_fee_core cohort string -> the 22 existing CORE/court buckets byte-identical (untouched).
 *
 * Reads the cohort NORMS capmkt_fee_core (opMargin/opMarginStability/fcfMargin/netIssuance + weights {opMargin .30,
 * opMarginStability .30, fcfMargin .25, netIssuance .15} — the margin-quality pillar opMargin+opMarginStability = .60
 * structurally dominates; the partial-coverage netIssuance .15 is the smallest weight). opMarginStability is fed as an
 * ALREADY-CLIPPED [0,1] observation (1-CV(opMargin), computed upstream) read against the identity-clip {floor 0, elite
 * 1}. The ECONOMIC FEE-GATE (fcfMargin>1.0 FUND_FLOAT / niMargin>=0.95 RIC_PASSTHROUGH — KYN/APO/IBKR/CEFs) is applied
 * UPSTREAM at CLASSIFICATION (classify-capmkt.js), so the engine only ever sees genuine operating fee businesses.
 *
 * COVERAGE-RENORM (mirrors absKaliberItServices/Banks/Reits): any axis whose raw input is `null` (ISSUANCE_NOT_READY on
 * the ~54% of names lacking annualShares; NOT_READY:opmargin/opmarginstability on a thin name) is DROPPED and the
 * surviving axis weights are re-normalized to sum 1.0 before the weighted sum — no fake-neutral 0-impute. The inverted
 * axis (netIssuance) uses the NEGATED raw as the q-input; raw null means the axis is dropped (not scored 0). If EVERY
 * axis is null (pathological) -> 0.
 *
 * Returns { absK in [0,1], usedAxes:[...], droppedAxes:[...], renormWeights:{...} } so court-score.js can persist the
 * audit trail (which axes survived — e.g. netIssuance-dropped on the ~54% lacking annualShares — and the renormalized
 * weight vector).
 *
 * @param {{opMargin:?number, opMarginStability:?number, fcfMargin:?number, netShareIssuance:?number}} rec
 * @param {string} bucket  — 'capmkt_fee_core'
 * @returns {{absK:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object}}
 */
function absKaliberCapmkt(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberCapmkt: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.opMargin || !norm.opMarginStability || !norm.fcfMargin || !norm.netIssuance) {
    throw new Error(`absKaliberCapmkt: Bucket "${bucket}" hat keine capmkt-NORMS (4-Achs-Gewichte/Anker fehlen)`);
  }
  // Per-axis q-input (only netIssuance is inverted via negated raw; null raw -> axis DROP, not 0-impute). FOUR axes:
  // opMargin (level), opMarginStability (already-clipped 1-CV against identity {0,1}), fcfMargin (all higher=better),
  // netIssuance (inverted q(-NSI)).
  const axes = [
    { key: 'opMargin',          qin: rec.opMargin,                                                   norm: norm.opMargin },
    { key: 'opMarginStability', qin: rec.opMarginStability,                                          norm: norm.opMarginStability },
    { key: 'fcfMargin',         qin: rec.fcfMargin,                                                  norm: norm.fcfMargin },
    { key: 'netIssuance',       qin: (rec.netShareIssuance == null ? null : -rec.netShareIssuance), norm: norm.netIssuance },
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
 * absKaliberMedFac(rec, bucket) — 4-axis weighted-q absolute caliber with COVERAGE-RENORM for the
 * medical_care_facilities CORE court bucket (court gauntlet DESIGN, BUILD as a DISCLOSED partial-quality read — the
 * banks precedent). The healthcare-facilities axis SET {opMargin, roaThruCycle, fcfMargin, leverageDiscipline} is
 * DISTINCT from every other CORE bucket: it pairs the operating-margin LEVEL with a THROUGH-CYCLE ROA capital-return
 * co-pillar (the banks lead-axis pattern, ADAPTED) and a LEVEL-scored leverage-discipline axis — and it has NO growth
 * axis at all (QUALITY-ONLY: the materials/tech_hardware lesson — a serial acquirer's deal-masked growth would inflate
 * the score, and a quality operator must not be exiled for a down year). opMargin/roaThruCycle/fcfMargin are NON-inverted
 * (higher=better directly); leverageDiscipline is the INVERTED + LEVEL-scored axis (q-input = -ndGA — lower net-debt/
 * assets is better; the codebase's established inversion convention, mirroring it_services netIssuance + banks
 * assetGrowthDiscipline + reits ndGA). So this is a PARALLEL engine, NOT a delegate (capmkt's 2nd axis is the unique
 * opMarginStability and it has no roaThruCycle; reits' 2nd axis is ffoAssets and it HAS a growth axis revG3; banks has
 * roaThruCycle but its other axes are capitalAdequacy/assetGrowthDiscipline/earningsDurability). NEW code keyed by the
 * medical_care_facilities cohort string -> the 23 existing CORE/court buckets byte-identical (their paths untouched).
 *
 * Reads the cohort NORMS medical_care_facilities (opMargin/roaThruCycle/fcfMargin/leverageDiscipline + weights
 * {opMargin .30, roaThruCycle .30, fcfMargin .25, leverageDiscipline .15} — the operating-quality pillar opMargin+
 * roaThruCycle = .60 dominates; leverageDiscipline .15 the GENEROUS leverage tiebreaker). leverageDiscipline reads the
 * RAW ndGA and the engine negates it (q(-ndGA)), mirroring absKaliberReits ndGA.
 *
 * COVERAGE-RENORM (mirrors absKaliberReits/Capmkt/Banks/ItServices): any axis whose raw input is `null` (NOT_READY:
 * opmargin/fcfmargin on a thin name, ROA_THRU_CYCLE_THIN when no NI/totalAssets pair, NOT_READY:leverage when no balance
 * sheet) is DROPPED and the surviving axis weights are re-normalized to sum 1.0 before the weighted sum — no fake-neutral
 * 0-impute. The inverted axis (leverageDiscipline) uses the NEGATED raw ndGA as the q-input; raw null means the axis is
 * dropped (not scored 0). If EVERY axis is null (pathological shell) -> 0 (the SHELL gate in court-score.js SI-4-excludes
 * those upstream, so this 0 is a defensive backstop only).
 *
 * Returns { absK in [0,1], usedAxes:[...], droppedAxes:[...], renormWeights:{...} } so court-score.js can persist the
 * audit trail (which axes survived — e.g. leverageDiscipline-dropped on a name with no balance sheet — and the
 * renormalized weight vector).
 *
 * @param {{opMargin:?number, roaThruCycle:?number, fcfMargin:?number, ndGA:?number}} rec
 * @param {string} bucket  — 'medical_care_facilities'
 * @returns {{absK:number, usedAxes:string[], droppedAxes:string[], renormWeights:Object}}
 */
function absKaliberMedFac(rec, bucket) {
  const norm = NORMS[bucket];
  if (!norm) throw new Error(`absKaliberMedFac: unbekannter Bucket "${bucket}"`);
  if (!norm.weights || !norm.opMargin || !norm.roaThruCycle || !norm.fcfMargin || !norm.leverageDiscipline) {
    throw new Error(`absKaliberMedFac: Bucket "${bucket}" hat keine medfac-NORMS (4-Achs-Gewichte/Anker fehlen)`);
  }
  // Per-axis q-input (only leverageDiscipline is inverted via negated raw ndGA; null raw -> axis DROP, not 0-impute).
  // FOUR axes: opMargin (level), roaThruCycle (4y-avg capital return), fcfMargin (all higher=better), leverageDiscipline
  // (inverted q(-ndGA), LEVEL-scored). NO growth axis (quality-only).
  const axes = [
    { key: 'opMargin',           qin: rec.opMargin,                                       norm: norm.opMargin },
    { key: 'roaThruCycle',       qin: rec.roaThruCycle,                                   norm: norm.roaThruCycle },
    { key: 'fcfMargin',          qin: rec.fcfMargin,                                      norm: norm.fcfMargin },
    { key: 'leverageDiscipline', qin: (rec.ndGA == null ? null : -rec.ndGA),             norm: norm.leverageDiscipline },
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

module.exports = { q, NORMS, effGatePass, gateOpen, absKaliber, absKaliberIndustrials, absKaliberStaples, absKaliberConsDisc, absKaliberMaterials, absKaliberEnergy, absKaliberPharma, absKaliberItServices, absKaliberBanks, absKaliberReits, absKaliberCapmkt, absKaliberMedFac, blendScore, normTableId };
