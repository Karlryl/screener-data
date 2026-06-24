#!/usr/bin/env node
'use strict';
/**
 * classify-capmkt.js — deterministic SI-5 classifier for the capmkt_fee_core CORE court bucket
 * (ONE asset-light FEE-business cohort: exchanges, rating agencies, index/data, asset managers, brokers — scored on
 * opMargin level / opMargin stability / fcfMargin / net-issuance discipline).
 *
 * Spec: court gauntlet DESIGN for capmkt_fee_core (BUILD_WITH_CAVEATS / court REVISE, 2026-06-24). Pure function of
 * meta.sector + meta.industry + the §6-style COUNTRY-DOMICILE-GUARD isUSListing test (country set != US -> exclude;
 * the de-ADR'd FOREIGN_NAME legal-form regex for undefined-country foreign primaries; a positive US-primary test for
 * country-undefined US names — admitting MSCI/MCO/ICE/NDAQ/KKR which carry country=undefined) + num(marketCap) + the
 * cohort industry set + THE ECONOMIC FEE-GATE. No fuzzy matching, no per-ticker scoring map, no LLM. THROUGH-CYCLE
 * FEE-FRANCHISE QUALITY ONLY — the SCORE (court-score.js) never bets on AUM direction or market levels.
 *
 * ONE cohort `capmkt_fee_core` — deterministic pure function of meta.industry (SI-5; no per-ticker cohort map):
 *   meta.sector=='Financial Services' AND meta.industry in {Asset Management, Capital Markets,
 *   Financial Data & Stock Exchanges, Insurance Brokers} AND the country-domicile guard AND num(marketCap)>=$1B,
 *   deduped, MINUS the fee-gate exclusions (below). Live CLEAN count (RE-COURT recomputed 2026-06-24): 84 classified
 *   (raw US >=$1B in the four industries; 71 fee-gate-excluded: 16 FUND_FLOAT + 39 RIC_PASSTHROUGH + 11
 *   BDC_SPREAD_LOAN_BOOK + 5 CRYPTO_MINER_NON_FEE).
 *
 * THE ECONOMIC FEE-GATE (the court's required revision #1 — the HARD BLOCKER; EXTENDED by the RE-COURT 2026-06-24
 * with TWO MORE arms #3/#4): closed-end funds and float-heavy brokers produce pass-through fcfMargin/niMargin
 * ARTIFACTS that top the cohort. KYN (Kayne Anderson closed-end fund: rev $25.4M, FCF $223.5M -> fcfMargin 8.80) and
 * TIGR (offshore broker; client float, not fee cash) are NOT fee compounders. The RE-COURT additionally found
 * externally-managed BDCs (leveraged spread-lenders) topping the cohort and pure crypto MINERS (commodity producers)
 * polluting the REL anchors. The gate is ECONOMIC (NOT a name list), FOUR deterministic arms now, mirroring
 * classify-itservices's contamination gate / classify-reits's mortgage hard-separation. A classified (industry+US+
 * >=$1B) name is EXCLUDED (-> never enters court-buckets; the court-score SI-4 excluded[] path is belt-and-suspenders)
 * iff ANY of:
 *   (1) FUND_FLOAT_PASSTHROUGH: fcfMargin = annualFCF[0]/annualRev[0] > 1.0. A real operating fee business cannot
 *       free-cash-flow more than its revenue; fcfMargin>1 is float / NAV / client-cash pass-through accounting
 *       (KYN 8.80, PDO 9.19, the levered-broker IBKR 2.56, the closed-end-fund BCAT/BSTZ/BTT/ECAT, the alt-manager
 *       APO 1.62 whose one-year carry-realization cash spikes above revenue). THE COURT-NAMED HARD BLOCKER.
 *   (2) RIC_PASSTHROUGH: niMargin = annualNetIncome[0]/annualRev[0] >= 0.95. A registered investment company (a
 *       '40-Act closed-end fund: NMZ/NUV/TY/ADX/GAB/GDV/BDJ/...) reports investment income AS "revenue" and, having
 *       NO operating cost structure, drops ~all of it to net income (niMargin .97-1.00). Every GENUINE operating fee
 *       business has niMargin well below .95 (the live max is APO .76, then BX .54 / BAM .52 / CME .62) — so the .95
 *       cut has ZERO genuine-fee false positives. This is the ECONOMIC tell that separates an investment VEHICLE from
 *       an operating fee FRANCHISE; it is NOT a name regex (Northern Trust "NTRS" survives — niMargin .21).
 * ECONOMIC JUSTIFICATION for EXCLUDE-not-cap (the court's "pick the cleaner economic treatment"): a fcfMargin>1 /
 * niMargin>=.95 name is a DIFFERENT ANIMAL (a fund / float vehicle, not a fee franchise) the way a mortgage REIT is a
 * different animal from an equity REIT — capping its fcfMargin axis would still let its float-driven economics into a
 * cohort whose NORMS are calibrated on operating fee businesses, polluting the cross-sectional REL anchors. So it is
 * CLASSIFIED OUT (documented exclusion, FUND_FLOAT_PASSTHROUGH / RIC_PASSTHROUGH), not scored. Verified live: KYN,
 * TIGR, APO, IBKR and the 39 closed-end funds are all OUT; no fcfMargin>1 name ranks in the top quartile.
 *
 *   (3) BDC_SPREAD_LOAN_BOOK (RE-COURT arm): externally-managed Business Development Companies are leveraged closed-end
 *       LOAN vehicles, NOT asset-light fee businesses. They book interest/spread income as "revenue" and SURVIVE both
 *       arms (1)/(2) (fcfMargin .72-.94, niMargin .31-.49), so they contaminated the cohort — the original build's
 *       top-5 were 4 BDCs while CME/MSCI/ICE were buried at ranks 6-14, which is precisely what the max-severity
 *       re-court DENIED. The ECONOMIC tell (NO name list) separating a regulated BDC loan-book from a fee franchise:
 *       small revToAssets = annualRev[0]/annualBalance[0].totalAssets ∈ [0.05, 0.16] (interest income on a big loan
 *       book, vs fee revenue on an asset-light book — genuine fee names sit far outside: MSCI .55, MCO .49, BX .27)
 *       AND annualBalance[0].totalDebt === null (BDC leverage is booked as notes/payable-for-investments the snapshot
 *       leaves null) AND a regulated-leverage liabilities/equity ratio ∈ [0.7, 2.0] (the ~2:1 BDC asset-coverage
 *       signature). Catches all 11 live BDCs (OBDC/GSBD/TSLX/MSDL/FSK/GBDC/OTF/ARCC/BXSL/CSWC/HTGC) with ZERO genuine-
 *       fee false positives. EDGE CASE PRESERVED: the alt-manager holdco Carlyle (CG) trips the revToAssets band AND
 *       has totalDebt=null (contra the re-court's stated premise that CG's totalDebt is populated — verified FALSE on
 *       live data), but its consolidated fund-level leverage puts TL/TE at 3.83, above the 2.0 regulated-BDC ceiling →
 *       SPARED. The leverage CEILING (not the totalDebt-populated test the re-court assumed) is the clean separator,
 *       and is the more principled regulated-BDC signature regardless.
 *   (4) CRYPTO_MINER_NON_FEE (RE-COURT arm): the cohort also swept in pure crypto MINERS (CLSK/HIVE/MARA/RIOT/WULF) —
 *       commodity bitcoin-miners mislabeled into "Capital Markets". Already membership-Out/non-topping, but they
 *       POLLUTE the REL cross-sectional anchors (the 5 deeply-negative names dragged the de-BDC'd opMargin p10 floor
 *       from -.01 to -.27 and the fcfMargin p10 floor from -.23 to -.67). The ECONOMIC tell (NO name list): operating
 *       margin negative in EVERY available year (persistent operating loss — opMargin strips the volatile bitcoin
 *       mark-to-market that flips miners' GAAP net income positive in up-years) AND mean NI margin AND mean FCF margin
 *       both MATERIALLY negative (< -0.20 = loss-making AND cash-burning, the antithesis of a fee compounder). Catches
 *       exactly the 5 pure miners. SPARES the legitimate exchange/broker fee businesses the re-court explicitly
 *       required NOT be gated — COIN (mean FCF margin POSITIVE +.13) and HOOD (positive recent operating margins) —
 *       plus the alt-manager CG (mean NI margin POSITIVE +.15) and near-break-even broker BWIN (margins only -.04/-.02,
 *       inside the -.20 materiality cut). EXCLUDE-not-cap for the same reason as #1/#2: a spread-lender / commodity
 *       miner is a DIFFERENT ANIMAL whose economics would pollute the cohort REL anchors if merely score-capped.
 *
 * THE DE-ADR HARDENING (the court's required revision #2 — COUNTRY NORMALIZE; mirrors classify-banks/reits §6):
 * snapshots carry country===undefined (NOT null) for the Vintage-A US names. The classify-in test MUST treat
 * undefined === null === US-primary (admit via US exchange + USD + no foreign legal-form name), else MSCI/MCO/ICE/
 * NDAQ/KKR (all country=undefined, NYSE/Nasdaq, USD) are wrongly DROPPED and the marquee assert throws. Killed
 * GENERALIZABLY:
 *   (1) meta.country SET != "United States" -> EXCLUDE unconditionally (kills country-set foreign primaries + the OTC
 *       pink-sheet dual-listings);
 *   (2) FOREIGN_NAME legal-form regex over meta.name catches undefined-country foreign primaries whose name carries a
 *       foreign legal form (S.A./plc/N.V./AG/Ltd/Limited — TIGR "UP Fintech Holding Limited", XP "XP Inc." stays US,
 *       NU/Nubank S.A., ...). US fee names overwhelmingly end in Inc./Corporation/Group/Holdings/Company/Markets/
 *       Partners — none of which the regex matches;
 *   (3) the 5-letter pink-sheet ADR rule /^[A-Z]{4}[FY]$/;
 *   (4) the POSITIVE US-PRIMARY test (the build pattern's US-primary mechanism): a country-undefined name is admitted
 *       ONLY if it lists on a US exchange (US_EXCH region) with USD reporting and NO foreign legal-form name (admits
 *       MSCI/MCO/ICE/NDAQ/KKR). The anti-leak assert must NOT key on country!=US (that would throw on the legitimate
 *       undefined-country US names — the design's whole revision #2 point: the real risk is wrongly DROPPING undefined
 *       US names, not letting foreigners in; the named leakers LSEG/MQG/PGHN/SDR were verified ABSENT from the pool).
 *   CAPMKT_FOREIGN_DROP = the explicit frozen DENY set for any undefined-country foreign primary a future vintage
 *   surfaces that neither (1) nor (2) catches (empty live — verified no such leaker exists; kept as the court-named
 *   minimum DENY mechanism, mirroring classify-banks BANK_FOREIGN_DROP). Expand ONLY with a verified foreign name.
 *   US_PRIMARY_ALLOWLIST kept (empty live) for structural parity — no US-primary fee name carries a foreign legal-form
 *   name that the FOREIGN_NAME guard would wrongly drop; expand ONLY with a verified US-primary foreign-NAME name.
 *
 * DEDUPE: economic-fingerprint (NI[0]|totalAssets[0]) dedupe (mirrors classify-reits) drops preferred/dual-class/
 * legacy-ticker duplicates of the SAME company; the frozen CAPMKT_DEDUPE_DROP set is the explicit named-override
 * mechanism (empty live — no verified dual-listing in the US fee pool). Two distinct companies never share the fp.
 *
 * Run modes (mirror classify-banks/reits/itservices):
 *   node scripts/classify-capmkt.js            -> report count + marquee + fee-gate/foreign control (dry-run)
 *   node scripts/classify-capmkt.js --emit      -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-capmkt.js --merge      -> merge capmkt_fee_core entries into outputs/court-buckets.json
 *
 * Verified target (RE-COURT recomputed live 2026-06-24): capmkt_fee_core 84; all 9 marquees classify (SPGI/MCO/MSCI/
 * ICE/NDAQ/CBOE/BLK/AJG/BRO); the fee-gate excludes 71 (16 FUND_FLOAT_PASSTHROUGH incl. KYN/APO/IBKR/PDO + 39
 * RIC_PASSTHROUGH closed-end funds + 11 BDC_SPREAD_LOAN_BOOK BDCs + 5 CRYPTO_MINER_NON_FEE miners); the country-
 * undefined US names MSCI/MCO/ICE/NDAQ/KKR are RETAINED; Carlyle (CG) is SPARED (alt-manager, TL/TE 3.83 > BDC
 * ceiling 2.0; mean NI margin +.15 > miner cut); COIN/HOOD/BWIN RETAINED; TIGR drops at the country guard.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const BUCK = path.join(ROOT, 'outputs', 'court-buckets.json');

// --- num() dual-shape extractor ---
function num(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'object' && x.value != null && isFinite(x.value)) return x.value;
  return null;
}
// FLOW-field {value}-unwrap (mirrors classify-reits): annual flow fields (annualRev/OpInc/NetIncome/FCF) MAY be
// {value:N}-WRAPPED objects; annualBalance.* are raw numbers. Same dual-shape logic as num().
const unwrap = x => (x == null ? null : (typeof x === 'number' ? (isFinite(x) ? x : null) : (x.value != null && isFinite(x.value) ? x.value : null)));

// --- COUNTRY-DOMICILE-GUARD US-listing test (mirrors classify-banks/reits isUSListing) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK|AX)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign primaries (TIGR "UP Fintech
// Holding Limited", a Nubank/Banco-S.A.). Anchored on word boundaries so US "Inc."/"Corp."/"Company"/"Group"/
// "Holdings"/"Markets"/"Partners" never match (mirrors classify-banks/reits). US fee names overwhelmingly end in
// Inc./Corporation/Group/Holdings — none of which the regex matches.
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|A\/S|OYJ|ASA|S\.?p\.?A\.?|\bSE\b|\bAG\b|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// Frozen foreign-primary DENY set (the court's mandated minimum, revision #2). Country-undefined foreign primaries
// whose US-form / regex-slipping name neither the country-SET test nor FOREIGN_NAME reliably catches. EMPTY live —
// the design's named leakers LSEG/MQG/PGHN/SDR were verified ABSENT from the four-industry US >=$1B pool; kept as the
// court-named minimum DENY mechanism (mirrors classify-banks BANK_FOREIGN_DROP). Expand ONLY with a verified name.
const CAPMKT_FOREIGN_DROP = new Set([]);
// Name-verified US-PRIMARY inversion allowlist (EMPTY live — no US-primary fee name carries a foreign legal-form name
// that FOREIGN_NAME would wrongly drop; kept for structural parity with classify-itservices/energy so the mechanism is
// present if a future verified US-primary foreign-NAME fee name appears). Expand ONLY with a verified name.
const US_PRIMARY_ALLOWLIST = new Set([]);

function isUSListing(m, ticker, companyName) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;                              // .L/.TO/.SZ … foreign-suffix tickers
  if (/^[A-Z]{4}[FY]$/.test(ticker)) return false;                            // 5-letter pink-sheet ADR
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;   // pink-sheet ADR dual-listings
  if (US_PRIMARY_ALLOWLIST.has(ticker)) return true;                          // explicit US-primary override (before guards)
  if (CAPMKT_FOREIGN_DROP.has(ticker)) return false;                          // frozen foreign-primary DENY (killshot)
  const ccy = m.reportingCurrency;
  if (m.country != null) {                                                    // country SET -> authoritative
    return m.country === 'United States';                                     // SET && != US -> EXCLUDE, no exceptions
  }
  // country undefined -> POSITIVE US-primary test: US exchange + USD + NO foreign legal-form name (admits MSCI/MCO/ICE/NDAQ/KKR)
  if (FOREIGN_NAME.test(companyName || '')) return false;
  if (US_EXCH.has(m.region) && (ccy === 'USD' || ccy == null)) return true;
  return false;
}

// --- cohort set — deterministic pure function of meta.industry ---
const CAPMKT_SECTOR = 'Financial Services';
// The FOUR asset-light fee-business industries (exchanges, rating/data, asset managers, brokers).
const CAPMKT_INDUSTRY = new Set([
  'Asset Management', 'Capital Markets', 'Financial Data & Stock Exchanges', 'Insurance Brokers',
]);
// Dedupe / data-conflict drop-set: preferred-share / dual-class / legacy-ticker duplicates that pass the country-SET=US
// test but are not the liquid primary, PLUS verified ticker-ambiguity / data-error names. Mirrors classify-reits
// REIT_DEDUPE_DROP (the economic-fingerprint dedupe in run() is the PRIMARY mechanism for true dual-listings).
//   PS — "PS" is a ticker-AMBIGUITY name: the snapshot is now Pershing Square Inc. (Asset Management) but the ticker
//        is ALSO carried in the legacy system_app_software bucket AND in court-score.js's frozen skeptiker-wave-2 KILL
//        set (PS/RDVT/ADEA/OMDA/TEM/KMTS — ticker-mismatch/wrong-sector/data-error). Admitting PS into capmkt_fee_core
//        would break SI-5 (the KILL set silently removes it in the member loop -> classifiedCount != scoredCount+
//        excludedCount) and re-introduce the very ticker-mismatch the skeptiker wave verified. Dropped here as a
//        documented data-conflict exclusion (NOT a quality judgement on Pershing Square). Expand ONLY with a verified
//        duplicate / data-error ticker.
const CAPMKT_DEDUPE_DROP = new Set(['PS']);

// --- THE ECONOMIC FEE-GATE (court revision #1; economic, deterministic, NOT a name list) ---
const CAPMKT_FCF_PASSTHROUGH_CAP = 1.0;   // fcfMargin > 1.0 -> fund-float / NAV / client-cash pass-through (KYN/APO/IBKR/PDO)
const CAPMKT_RIC_NIMARGIN_CAP = 0.95;     // niMargin >= 0.95 -> '40-Act registered investment company (closed-end fund)

// THE THIRD FEE-GATE ARM — BDC_SPREAD_LOAN_BOOK (RE-COURT 2026-06-24: max-severity DENIED the cohort for BDC
// contamination — top-5 were 4 Business Development Companies, leveraged spread-lenders NOT asset-light fee
// businesses; the genuine fee compounders CME/MSCI/ICE were buried at ranks 6-14). A BDC is an externally-managed
// closed-end loan vehicle: it books interest/spread income as "revenue" and survives BOTH the fcfMargin>1 and
// niMargin>=.95 arms (fcfMargin .72-.94, niMargin .31-.49). The ECONOMIC tell that separates a regulated BDC
// loan-book from a genuine fee franchise (NO name list, verified to catch all 11 BDCs with ZERO genuine-fee false
// positives): a small revenue-to-assets ratio (interest income on a big balance-sheet loan book, NOT fee revenue on
// an asset-light book), NO reported total-debt line (BDC leverage is booked as "payable for investments"/notes the
// snapshot leaves as totalDebt=null), AND a regulated-leverage liabilities/equity ratio. The 11 live BDCs cluster at
// revToAssets ∈ [.053,.134] and TL/TE ∈ [.83,1.38] (the ~2:1 BDC asset-coverage signature); a genuine alt-manager
// holdco (Carlyle CG) trips the revToAssets band and the totalDebt=null shape (CG's totalDebt IS null in the
// snapshot, contra the re-court's stated premise) but its consolidated fund-level leverage puts TL/TE at 3.83 — so
// the leverage UPPER bound 2.0 (a wide gap above the max BDC 1.38, well below CG 3.83) SPARES CG. (The re-court
// prescribed only a TL/TE>=.7 lower bound and asserted totalDebt-populated would spare CG; verified against live
// data that premise is false — totalDebt IS null for CG — so the economic separator is the leverage CEILING, which
// is the cleaner regulated-BDC signature anyway. CG retained, all 11 BDCs gated, zero genuine-fee false positives.)
const CAPMKT_BDC_REVTOASSETS_LO = 0.05;   // interest income on a big loan book -> small rev/assets (BDC, not fee)
const CAPMKT_BDC_REVTOASSETS_HI = 0.16;   // upper band edge (genuine fee names sit far outside: MSCI .55, MCO .49, BX .27)
const CAPMKT_BDC_LEV_LO = 0.7;            // liabilities/equity >= .7 (a levered loan vehicle, not asset-light)
const CAPMKT_BDC_LEV_HI = 2.0;            // liabilities/equity <= 2.0 (the regulated ~2:1 BDC ceiling; SPARES CG's 3.83 alt-manager holdco)

// THE FOURTH FEE-GATE ARM — CRYPTO_MINER_NON_FEE (RE-COURT 2026-06-24): the cohort also swept in pure crypto MINERS
// (CLSK/HIVE/MARA/RIOT/WULF) — commodity bitcoin-miners mislabeled into "Capital Markets", NOT fee businesses. They
// are already membership-Out / non-topping, but they POLLUTE the REL cross-sectional anchors: live, the 5 deeply-
// negative names drag the de-BDC'd opMargin p10 floor from -.01 to -.27 and the fcfMargin p10 floor from -.23 to -.67
// (verified). The re-court authorized "gate economically OR leave membership-Out if you cannot cleanly gate without a
// name list — judge + document". A CLEAN economic gate DOES exist (no name list): a name is a non-fee commodity
// miner iff its operating margin is negative in EVERY available year (persistent operating loss, not a one-off) AND
// its mean net-income margin AND mean FCF margin are MATERIALLY negative (< -0.20). This catches exactly the 5 pure
// miners and SPARES every genuine fee business — incl. the alt-manager Carlyle (CG: opMargin all-neg via a one-off
// accounting artifact but mean NI margin POSITIVE +.15, so NOT gated), the near-break-even insurance broker BWIN
// (mean NI/FCF margins only -.04/-.02, well inside the -.20 materiality cut), and crucially the LEGITIMATE
// exchange/broker fee businesses COIN (mean FCF margin POSITIVE +.13) and HOOD (operating margin positive in recent
// years -> allNeg=false) — which the re-court explicitly required NOT be gated. operating margin (not net income)
// is the load-bearing signal because it strips the volatile bitcoin mark-to-market gains that flip miners' GAAP net
// income positive in up-years (CLSK/MARA/RIOT have a positive niMargin year from crypto fair-value gains, never a
// positive operating year). Mining is a capital-intensive COMMODITY business, the antithesis of an asset-light fee
// franchise.
const CAPMKT_MINER_LOSS_MARGIN_CAP = -0.20;  // mean NI margin AND mean FCF margin must be < this (materially loss-making + cash-burning)

// meanMargin(numer[], rev[]): mean of numer[i]/rev[i] over years with positive revenue (null if none). Used by the
// crypto-miner arm for the through-cycle (not just latest-year) NI/FCF margin tells.
function meanMargin(numer, rev) {
  const xs = [];
  for (let i = 0; i < rev.length; i++) {
    if (rev[i] != null && rev[i] > 0 && numer[i] != null) xs.push(numer[i] / rev[i]);
  }
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

// feeGateReason(rec): returns the EXCLUSION reason string if the (industry+US+>=$1B) name is a fund/float pass-through
// artifact, a BDC spread-lender, or a non-fee crypto miner; else null. ALL arms are ECONOMIC (margins / balance-sheet
// ratios on the snapshot annual arrays); no per-name map. The FUND_FLOAT arm is the court-named HARD BLOCKER; the RIC
// arm removes the closed-end funds; the BDC_SPREAD_LOAN_BOOK arm (re-court) removes the 11 leveraged BDCs that topped
// the contaminated cohort; the CRYPTO_MINER_NON_FEE arm (re-court) removes the 5 commodity miners that polluted the
// REL anchors.
function feeGateReason(rec) {
  const a = rec.annual || {};
  const rev = (a.annualRev || []).map(unwrap);
  const fcf = (a.annualFCF || []).map(unwrap);
  const ni = (a.annualNetIncome || []).map(unwrap);
  const op = (a.annualOpInc || []).map(unwrap);
  const fcfM = (fcf[0] != null && rev[0] != null && rev[0] > 0) ? fcf[0] / rev[0] : null;
  const niM = (ni[0] != null && rev[0] != null && rev[0] > 0) ? ni[0] / rev[0] : null;
  if (fcfM != null && fcfM > CAPMKT_FCF_PASSTHROUGH_CAP) return 'FUND_FLOAT_PASSTHROUGH';   // court HARD blocker (KYN/APO/IBKR/PDO)
  if (niM != null && niM >= CAPMKT_RIC_NIMARGIN_CAP) return 'RIC_PASSTHROUGH';               // closed-end fund (NMZ/NUV/TY/ADX/GAB/...)

  // ARM 3 — BDC_SPREAD_LOAN_BOOK (re-court): externally-managed BDC loan vehicles (OBDC/GSBD/TSLX/MSDL/FSK/GBDC/OTF/
  // ARCC/BXSL/CSWC/HTGC). Small interest-income rev/assets + totalDebt=null + regulated-leverage TL/TE band; the
  // leverage CEILING spares the alt-manager holdco CG (TL/TE 3.83).
  const bal0 = (Array.isArray(a.annualBalance) && a.annualBalance[0]) ? a.annualBalance[0] : null;
  if (bal0) {
    const ta = (bal0.totalAssets != null && isFinite(bal0.totalAssets)) ? bal0.totalAssets : null;
    const tl = (bal0.totalLiabilities != null && isFinite(bal0.totalLiabilities)) ? bal0.totalLiabilities : null;
    const te = (bal0.totalEquity != null && isFinite(bal0.totalEquity)) ? bal0.totalEquity : null;
    const revToAssets = (rev[0] != null && ta != null && ta > 0) ? rev[0] / ta : null;
    const lev = (tl != null && te != null && te !== 0) ? tl / te : null;
    if (revToAssets != null && revToAssets >= CAPMKT_BDC_REVTOASSETS_LO && revToAssets <= CAPMKT_BDC_REVTOASSETS_HI
      && bal0.totalDebt === null
      && lev != null && lev >= CAPMKT_BDC_LEV_LO && lev <= CAPMKT_BDC_LEV_HI) {
      return 'BDC_SPREAD_LOAN_BOOK';
    }
  }

  // ARM 4 — CRYPTO_MINER_NON_FEE (re-court): pure commodity bitcoin-miners (CLSK/HIVE/MARA/RIOT/WULF). Persistent
  // operating loss (every available year) + materially negative through-cycle NI AND FCF margins. opMargin is the
  // load-bearing signal (strips volatile crypto mark-to-market). Spares CG/BWIN/COIN/HOOD.
  const opMs = [];
  for (let i = 0; i < rev.length; i++) {
    if (op[i] != null && rev[i] != null && rev[i] > 0) opMs.push(op[i] / rev[i]);
  }
  const allNegOM = opMs.length >= 2 && opMs.every(x => x < 0);
  if (allNegOM) {
    const meanNI = meanMargin(ni, rev);
    const meanFCF = meanMargin(fcf, rev);
    if (meanNI != null && meanNI < CAPMKT_MINER_LOSS_MARGIN_CAP
      && meanFCF != null && meanFCF < CAPMKT_MINER_LOSS_MARGIN_CAP) {
      return 'CRYPTO_MINER_NON_FEE';
    }
  }
  return null;
}

// Marquee watchlist (frozen): the design's named flagships that MUST each classify, else the universe silently
// collapsed (the country-vintage-collapse regression guard the court demanded). Exchanges + rating/data + the
// country-undefined US data names (MSCI/MCO/ICE/NDAQ via the positive US-primary test) + asset mgr + brokers.
const CAPMKT_MARQUEE = Object.freeze(['SPGI', 'MCO', 'MSCI', 'ICE', 'NDAQ', 'CBOE', 'BLK', 'AJG', 'BRO']);
// Positive-control: the fund-float pass-through artifacts the fee-gate MUST keep OUT (court revision #1). Catches a
// regression that drops a fee-gate arm. KYN/PDO closed-end funds; APO/IBKR fcfMargin>1 float; the named CEFs.
const CAPMKT_FEEGATE_CONTROL = Object.freeze(['KYN', 'PDO', 'APO', 'IBKR', 'NMZ', 'NUV', 'TY', 'ADX', 'GAB', 'GDV', 'BDJ', 'NAD']);
// Positive-control: the country-undefined US names that MUST be RETAINED (court revision #2). Catches a regression
// that re-keys the classify-in on country!=US (which would wrongly drop these).
const CAPMKT_UNDEF_US_CONTROL = Object.freeze(['MSCI', 'MCO', 'ICE', 'NDAQ', 'KKR']);
// Positive-control: the 11 BDC spread-lenders the BDC_SPREAD_LOAN_BOOK arm MUST keep OUT (re-court). A leak means
// the re-court contamination returned. ECONOMIC gate, listed here only as a regression sentinel — NOT a name gate.
const CAPMKT_BDC_CONTROL = Object.freeze(['OBDC', 'GSBD', 'TSLX', 'MSDL', 'FSK', 'GBDC', 'OTF', 'ARCC', 'BXSL', 'CSWC', 'HTGC']);
// Positive-control: the alt-manager holdco Carlyle (CG) that trips the BDC rev/assets+totalDebt-null band but MUST be
// RETAINED (its TL/TE 3.83 is above the regulated-BDC leverage ceiling). A miss here means the leverage CEILING broke.
const CAPMKT_BDC_SPARE_CONTROL = Object.freeze(['CG']);
// Positive-control: the 5 pure crypto MINERS the CRYPTO_MINER_NON_FEE arm MUST keep OUT (re-court). They are non-fee
// commodity producers that polluted the REL anchors. ECONOMIC gate — listed only as a regression sentinel.
const CAPMKT_MINER_CONTROL = Object.freeze(['CLSK', 'HIVE', 'MARA', 'RIOT', 'WULF']);
// Positive-control: the legitimate exchange/broker fee businesses the re-court EXPLICITLY required NOT be gated as
// miners (COIN: positive FCF; HOOD: positive recent operating margins) + near-break-even broker BWIN. MUST classify.
const CAPMKT_MINER_SPARE_CONTROL = Object.freeze(['COIN', 'HOOD', 'BWIN']);

function classifyCapmkt(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (CAPMKT_DEDUPE_DROP.has(t)) return null;                    // preferred/dual-class dedupe -> not classified
  if (m.sector !== CAPMKT_SECTOR) return null;                   // Yahoo label for GICS Financials
  if (!CAPMKT_INDUSTRY.has(m.industry)) return null;             // only the four asset-light fee industries
  if (!isUSListing(m, t, nm)) return null;                       // de-ADR country-domicile guard + FOREIGN hardening
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;                       // $1B size earmark (num(), not naive >=)
  if (feeGateReason(rec)) return null;                           // fee-gate (fund-float / RIC pass-through) -> never enters court-buckets
  return 'capmkt_fee_core';
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  const feeGated = [];     // dry-run report: industry+US+>=$1B names the fee-gate excluded
  const seen = new Set();  // economic-fingerprint dedupe (NI[0]|totalAssets[0])
  let scanned = 0, finSector = 0, feeIndustry = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    const m = rec.meta || {};
    if (m.sector === CAPMKT_SECTOR) finSector++;
    if (m.sector === CAPMKT_SECTOR && CAPMKT_INDUSTRY.has(m.industry)) feeIndustry++;
    // fee-gate report: US >=$1B names in the four industries the gate excluded.
    if (m.sector === CAPMKT_SECTOR && CAPMKT_INDUSTRY.has(m.industry) && isUSListing(m, m.ticker, m.name || '')) {
      const mc = num(rec.marketCap);
      if (mc != null && mc >= 1e9) {
        const reason = feeGateReason(rec);
        if (reason) feeGated.push({ t: m.ticker, reason });
      }
    }
    const bucket = classifyCapmkt(rec);
    if (!bucket) continue;
    // economic-fingerprint dedupe: drop preferred/dual-class duplicates of the SAME company (same NI[0]|totalAssets[0]).
    // Two distinct companies never share the fp; the degenerate '|' (no annual data) is never deduped. Mirrors classify-reits.
    const a = rec.annual || {};
    const ni0 = (a.annualNetIncome && a.annualNetIncome[0] != null) ? unwrap(a.annualNetIncome[0]) : null;
    const bal0 = (Array.isArray(a.annualBalance) && a.annualBalance[0]) ? a.annualBalance[0] : null;
    const ta0 = (bal0 && bal0.totalAssets != null && isFinite(bal0.totalAssets)) ? bal0.totalAssets : null;
    const fp = `${ni0 == null ? '' : ni0}|${ta0 == null ? '' : ta0}`;
    if (fp !== '|' && seen.has(fp)) continue;
    if (fp !== '|') seen.add(fp);
    const t = m.ticker;
    classifications.push({ t, bucket, confidence: 1.0 });
    byTicker[t] = bucket;
  }
  return { classifications, byTicker, feeGated, scanned, finSector, feeIndustry };
}

const CAPMKT_BUCKETS = new Set(['capmkt_fee_core']);
const r = run();
const capmkt = r.classifications.filter(c => c.bucket === 'capmkt_fee_core');
const missingMarquee = CAPMKT_MARQUEE.filter(t => !CAPMKT_BUCKETS.has(r.byTicker[t]));
const leakedFeeGate = CAPMKT_FEEGATE_CONTROL.filter(t => CAPMKT_BUCKETS.has(r.byTicker[t]));
const droppedUndefUS = CAPMKT_UNDEF_US_CONTROL.filter(t => !CAPMKT_BUCKETS.has(r.byTicker[t]));
const leakedBDC = CAPMKT_BDC_CONTROL.filter(t => CAPMKT_BUCKETS.has(r.byTicker[t]));            // re-court: BDC must NOT classify
const droppedBDCSpare = CAPMKT_BDC_SPARE_CONTROL.filter(t => !CAPMKT_BUCKETS.has(r.byTicker[t])); // re-court: CG must classify
const leakedMiner = CAPMKT_MINER_CONTROL.filter(t => CAPMKT_BUCKETS.has(r.byTicker[t]));        // re-court: miners must NOT classify
const droppedMinerSpare = CAPMKT_MINER_SPARE_CONTROL.filter(t => !CAPMKT_BUCKETS.has(r.byTicker[t])); // re-court: COIN/HOOD/BWIN must classify

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedFeeGate.length) { console.error('FEE-GATE CONTROL FAIL, refusing to merge (fund-float leaked): ' + leakedFeeGate.join(', ')); process.exit(1); }
  if (droppedUndefUS.length) { console.error('COUNTRY-UNDEF-US FAIL, refusing to merge (undefined-country US name dropped): ' + droppedUndefUS.join(', ')); process.exit(1); }
  if (leakedBDC.length) { console.error('BDC CONTROL FAIL (re-court), refusing to merge (BDC spread-lender leaked): ' + leakedBDC.join(', ')); process.exit(1); }
  if (droppedBDCSpare.length) { console.error('BDC-SPARE FAIL (re-court), refusing to merge (Carlyle/CG wrongly gated): ' + droppedBDCSpare.join(', ')); process.exit(1); }
  if (leakedMiner.length) { console.error('MINER CONTROL FAIL (re-court), refusing to merge (crypto miner leaked): ' + leakedMiner.join(', ')); process.exit(1); }
  if (droppedMinerSpare.length) { console.error('MINER-SPARE FAIL (re-court), refusing to merge (COIN/HOOD/BWIN wrongly gated): ' + droppedMinerSpare.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => !CAPMKT_BUCKETS.has(c.bucket));
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} capmkt_fee_core entries into court-buckets.json`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.finSector} meta.sector==="Financial Services"; ${r.feeIndustry} in the four fee industries (raw)`);
  console.log(`classified: capmkt_fee_core ${capmkt.length} (de-fund-gated; REL_MIN_N=15 -> ${capmkt.length >= 15 ? 'full ABS+REL' : 'THIN_REL ABS-only'})`);
  console.log(`fee-gated (industry+US+>=$1B but excluded): ${r.feeGated.length} -> ${r.feeGated.map(c => c.t + ':' + c.reason).join(', ') || '(none)'}`);
  console.log(`marquee coverage (${CAPMKT_MARQUEE.length}): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`fee-gate control (KYN/APO/IBKR/CEFs must NOT classify): ${leakedFeeGate.length ? 'FAIL leaked ' + leakedFeeGate.join(',') : 'PASS all excluded'}`);
  console.log(`country-undef US control (MSCI/MCO/ICE/NDAQ/KKR must classify): ${droppedUndefUS.length ? 'FAIL dropped ' + droppedUndefUS.join(',') : 'PASS all retained'}`);
  console.log(`BDC control (re-court; 11 BDCs must NOT classify): ${leakedBDC.length ? 'FAIL leaked ' + leakedBDC.join(',') : 'PASS all excluded'}`);
  console.log(`BDC-spare control (re-court; Carlyle/CG must classify): ${droppedBDCSpare.length ? 'FAIL dropped ' + droppedBDCSpare.join(',') : 'PASS CG retained'}`);
  console.log(`miner control (re-court; CLSK/HIVE/MARA/RIOT/WULF must NOT classify): ${leakedMiner.length ? 'FAIL leaked ' + leakedMiner.join(',') : 'PASS all excluded'}`);
  console.log(`miner-spare control (re-court; COIN/HOOD/BWIN must classify): ${droppedMinerSpare.length ? 'FAIL dropped ' + droppedMinerSpare.join(',') : 'PASS all retained'}`);
  console.log(`capmkt_fee_core sample: ${capmkt.slice(0, 24).map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyCapmkt, isUSListing, num, unwrap, meanMargin, feeGateReason,
  CAPMKT_SECTOR, CAPMKT_INDUSTRY, CAPMKT_DEDUPE_DROP, CAPMKT_FCF_PASSTHROUGH_CAP, CAPMKT_RIC_NIMARGIN_CAP,
  CAPMKT_BDC_REVTOASSETS_LO, CAPMKT_BDC_REVTOASSETS_HI, CAPMKT_BDC_LEV_LO, CAPMKT_BDC_LEV_HI, CAPMKT_MINER_LOSS_MARGIN_CAP,
  CAPMKT_FOREIGN_DROP, US_PRIMARY_ALLOWLIST,
  CAPMKT_MARQUEE, CAPMKT_FEEGATE_CONTROL, CAPMKT_UNDEF_US_CONTROL,
  CAPMKT_BDC_CONTROL, CAPMKT_BDC_SPARE_CONTROL, CAPMKT_MINER_CONTROL, CAPMKT_MINER_SPARE_CONTROL,
};
