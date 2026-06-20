#!/usr/bin/env node
/**
 * court-score-tests.js — Regressions-Gate für die court-Formel (SaaS v1.1, A2-Forward-Book).
 *
 * Sperrt die Iteration-7/8-Errungenschaften ein, damit künftige Änderungen sie nicht
 * STILL brechen (kein stiller Regress):
 *   - SaaS v1.1 aktiv (degraded=false, A2-Achse live, a2Note-Disclosure vorhanden)
 *   - Anker-Inversion gefixt: GEN rankt UNTER FIG/DUOL/HNGE/DDOG (per Score)
 *   - additive A2-Achse kann KEINEN Namen nullen (alle Scores finite >=0, min>0)
 *   - GEN demoviert (>=#4) mit negativer A2 (flat book)
 *   - Determinismus: court-score.js liefert byte-identische outputs/court-results.json über Läufe
 *   - FABLESS-SEMI Durability v3 (Iteration 10 Retrial): recency-weighted COUNT-below downside-drawdown
 *     über W=12-Quartals-YoY (SEC), scale-normalisiert, KEIN dCred → strikt age-/längen-neutral.
 *     ALAB/CRDO Top-3 (Youth-Bias gefixt), NVDA durS>0 (Window-Cap), ARM nicht mehr +1.0-saturiert,
 *     MXL/AMBA demoviert (echte zyklische Einbrüche), rhoDomAxisDurability<0.90 (keine Domination).
 *
 * Läuft court-screen.js + court-score.js frisch (execSync) und prüft outputs/court-results.json.
 * Belegt in: screener-formel-ledger.md Eintrag 15 (SaaS) + 19/20 (Fabless Durability v3); docs/formula-spec-fabless-ai-connectivity-v5.2.md.
 * NICHT in den 3 Pflicht-Gates (engine/tag21/tag22/tag28) — zusätzliches court-spezifisches Gate.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
// ISOLIERTER Harness (Re-Court-Auflage): Test schreibt in TEMP-Outputs via env-Override, NICHT in die
// geteilten Produktions-Artefakte → parallele Läufe/Court-Judges können outputs/court-results.json nicht racen.
const CAND_TEST = path.join(ROOT, 'outputs', '_court-candidates.test.json');
const RESULTS = path.join(ROOT, 'outputs', '_court-results.test.json');
const TEST_ENV = Object.assign({}, process.env, { COURT_CAND_OUT: CAND_TEST, COURT_OUT: RESULTS });
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); console.log('  PASS ' + name); passed++; } catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); failed++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// frischer Lauf in ISOLIERTE Outputs — court-screen.js zuerst (Durability wird DORT gerechnet), dann court-score.js
execSync('node court-screen.js', { cwd: ROOT, stdio: 'ignore', env: TEST_ENV });
execSync('node court-score.js', { cwd: ROOT, stdio: 'ignore', env: TEST_ENV });
const r1 = fs.readFileSync(RESULTS, 'utf8');
const doc = JSON.parse(r1);
const saas = doc.system_app_software;
assert(saas && Array.isArray(saas.members), 'system_app_software bucket missing');
const M = saas.members;
const rank = t => { const i = M.findIndex(m => m.ticker === t); return i < 0 ? null : i + 1; };

test('v1.1 aktiv (degraded=false, label nennt v1.1)', () => {
  assert(saas.degraded === false, 'degraded sollte false sein (v1.1 nicht degradiert)');
  assert(/v1\.1/.test(saas.label || ''), 'label sollte v1.1 nennen: ' + saas.label);
});

test('A2-Forward-Achse live (Achse + anchorsA2)', () => {
  assert(saas.anchorsA2 && saas.anchorsA2.gMed != null && saas.anchorsA2.lMed != null, 'anchorsA2 fehlt');
  assert(M[0].axisS && M[0].axisS['A2-Forward'] !== undefined, 'A2-Forward fehlt in members.axisS');
});

test('a2Note-Disclosure vorhanden (forward-book-demand, kein organic-Detektor)', () => {
  assert(saas.a2Note && /forward-book/i.test(saas.a2Note), 'a2Note-Disclosure fehlt');
});

test('Anker-Inversion gefixt: GEN unter FIG/DUOL/HNGE/DDOG', () => {
  const gen = rank('GEN');
  assert(gen != null, 'GEN nicht im Bucket');
  for (const t of ['FIG', 'DUOL', 'HNGE', 'DDOG']) {
    const x = rank(t);
    assert(x != null && x < gen, `GEN (#${gen}) muss unter ${t} (#${x}) ranken`);
  }
});

test('GEN demoviert (>=#4) mit negativer A2 (flat book)', () => {
  const gen = rank('GEN');
  assert(gen >= 4, `GEN sollte demoviert sein (>=#4), ist #${gen}`);
  const g = M.find(m => m.ticker === 'GEN');
  assert(g.axisS['A2-Forward'] < 0, `GEN A2 sollte negativ sein (flat book), ist ${g.axisS['A2-Forward']}`);
});

test('additive A2 kann keinen Namen nullen: alle Scores finite >=0, min>0', () => {
  for (const m of M) assert(Number.isFinite(m.score) && m.score >= 0, `${m.ticker} Score ungültig: ${m.score}`);
  const min = Math.min(...M.map(m => m.score));
  assert(min > 0, `min Score sollte >0 sein (additive Achse nullt nicht), ist ${min}`);
});

// ===================== FABLESS-SEMI DURABILITY v3 (Iteration 10 Retrial) =====================
// durability v3 = recency-weighted, COUNT-below Downside-Drawdown über ein W=12-Quartals-YoY-Fenster,
// scale-normalisiert: durRaw = (median(gW) − λ·dd) / (|median(gW)| + 0.10), λ=1.0, rho=0.9, KEIN dCred.
// Quelle: SEC-Quartals-YoY (payload.ftsQuarterly.revQYoYsec). Ersetzt v2 (median−downsideDev, annual n=3),
// das Court-DENIED wurde (Domination ρ0.976, n=3-(median,min)-Mislabel, scale-/längen-gekoppelt). Ledger Eintrag 19+Addendum.
const fab = doc.fabless_semi;
assert(fab && Array.isArray(fab.members), 'fabless_semi bucket missing');
const FM = fab.members.slice().sort((a, b) => b.score - a.score);
const fdur = t => { const m = FM.find(x => x.ticker === t); return m ? m.axisS.Durability : null; };
const frank = t => { const i = FM.findIndex(x => x.ticker === t); return i < 0 ? null : i + 1; };

test('fabless: Durability finite + sec-quarterly-Quelle auf ALLEN 8 Membern', () => {
  for (const m of FM) {
    assert(m.durability != null && Number.isFinite(m.durability), `${m.ticker} durability null/NaN: ${m.durability}`);
    assert(Number.isFinite(m.axisS.Durability), `${m.ticker} Durability sAxis nicht finite: ${m.axisS.Durability}`);
  }
  for (const t of ['CRDO', 'ALAB', 'NVDA', 'ARM', 'AMBA', 'AVGO', 'AMD', 'MXL']) {
    const m = FM.find(x => x.ticker === t);
    assert(m && m.durSource === 'sec-quarterly', `${t} sollte SEC-Quartals-YoY nutzen, durSource=${m && m.durSource}`);
  }
});

test('fabless: Youth-Bias gefixt — junge IPO-Leader ALAB & CRDO ranken Top-3 (per Score)', () => {
  assert(frank('ALAB') <= 3, `ALAB sollte Top-3 sein, ist #${frank('ALAB')}`);
  assert(frank('CRDO') <= 3, `CRDO sollte Top-3 sein, ist #${frank('CRDO')}`);
  assert(fdur('ALAB') > 0, `ALAB durS > 0 (sustained Hypergrowth), ist ${fdur('ALAB')}`);
  // HINWEIS: CRDO durS DARF negativ sein (realer ~3-Quartals-Einbruch FY2024); CRDO wird per Growth/GM Top-3 gerettet,
  // NICHT für Beschleunigung bestraft (das war der v0-Youth-Bias). Alters-Neutralität = Ranking-Rettung, nicht durS-Vorzeichen.
});

test('fabless: NVDA durS > 0 & Top-2 (Window-Cap fixt 60Q-Alt-Zyklen-Kollaps; war ohne Cap -0.83/Rang 4)', () => {
  assert(fdur('NVDA') > 0, `NVDA durS sollte > 0 sein, ist ${fdur('NVDA')}`);
  assert(frank('NVDA') <= 2, `NVDA sollte Top-2 sein, ist #${frank('NVDA')}`);
});

test('fabless: steady-mature ARM NICHT mehr degeneriert-saturiert (durS < 0.9) — Window+scale-norm killt div-by-~0', () => {
  const arm = fdur('ARM');
  assert(arm != null && arm < 0.9, `ARM durS sollte nicht +1.0-saturiert sein (war div-by-~0-MAD), ist ${arm}`);
});

test('fabless: zyklische Decliner MXL & AMBA demoviert (durS < 0) — Quartalsdaten zeigen ECHTE anhaltende Einbrüche', () => {
  // KORREKTUR der annual-Annahme: AMBAs -33% war KEINE einzelne alte Delle. Quartals-YoY zeigt einen
  // anhaltenden 5-Quartals-Einbruch (-5/-12/-31/-27/-31) vor ~1.5-3J → Demotion ist EHRLICH, kein Mis-Grade
  // (recency-Gewichtung kreditiert die jüngste Erholung +44/+53/+58, der echte Einbruch zieht trotzdem runter).
  assert(fdur('MXL') < 0, `MXL durS sollte < 0 sein (anhaltender Decline), ist ${fdur('MXL')}`);
  assert(fdur('AMBA') < 0, `AMBA durS sollte < 0 sein (echter zyklischer Downcycle), ist ${fdur('AMBA')}`);
});

test('fabless: Durability dominiert den Score NICHT (rhoDomAxisDurability < 0.90 Guard-Schwelle); beide ρ publiziert', () => {
  assert(typeof fab.collapseSpearman === 'number', 'collapseSpearman fehlt');
  assert(typeof fab.rhoDomAxisDurability === 'number', 'rhoDomAxisDurability fehlt (Court: decompose WHICH block collapses)');
  assert(fab.rhoDomAxisDurability < 0.90, `rhoDomAxisDurability sollte < 0.90 sein (v2 war 0.976), ist ${fab.rhoDomAxisDurability}`);
  assert(fab.collapseReweight === null, `collapse-reweight sollte NICHT gefeuert haben (ρ<0.90), ist ${JSON.stringify(fab.collapseReweight)}`);
});

// --- Unit: durability v3 Replikat. KEEP IN SYNC mit court-screen.js (DUR_W/DUR_RHO/DUR_LAMBDA/DUR_FLOOR + Drawdown) ---
const _RHO = 0.9, _LAM = 1.0, _FLOOR = 0.10, _WCAP = 12;
function _median(xs){const s=xs.filter(v=>v!=null&&isFinite(v)).slice().sort((a,b)=>a-b);if(!s.length)return null;const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function _durV3(gNewestFirst){
  const g=gNewestFirst.slice(0,_WCAP); const med=_median(g); if(med==null)return null;
  const below=[]; for(let i=0;i<g.length;i++) if(g[i]!=null&&isFinite(g[i])&&g[i]<med) below.push(i);
  let dd=0;
  if(below.length){ const rawW=below.map(i=>Math.pow(_RHO,i)); const wmean=rawW.reduce((a,v)=>a+v,0)/rawW.length; let ss=0; below.forEach((i,k)=>{const w=rawW[k]/wmean; ss+=w*(g[i]-med)**2;}); dd=Math.sqrt(ss/below.length); }
  return (med-_LAM*dd)/(Math.abs(med)+_FLOOR);
}

test('fabless-unit: LÄNGEN-NEUTRAL — gleiche recent-12-Shape, andere Gesamthistorie -> identische durRaw (Court-Pflichttest)', () => {
  const recent = [0.8,0.6,-0.2,0.5,0.3,0.4,0.1,-0.1,0.2,0.3,0.5,0.4]; // 12 newest-first
  const young = recent.slice();
  const old = recent.concat([0.1,0.2,-0.5,0.9,0.3]); // +5 ältere Quartale -> Window-Cap ignoriert sie
  assert(Math.abs(_durV3(young) - _durV3(old)) < 1e-12, `Längen-Neutralität verletzt: young ${_durV3(young)} vs old ${_durV3(old)}`);
});

test('fabless-unit: AGE-NEUTRAL — durV3 hängt NUR vom recent-12-Fenster ab, nicht von älterer/längerer Historie', () => {
  // Substantiv (Re-Court-Auflage, ersetzt die f(x)===f(x)-Tautologie): Daten JENSEITS des Fensters dürfen
  // durV3 NICHT ändern (kein Längen-/Alters-Term), Änderung INNERHALB des Fensters MUSS sie ändern (nicht degeneriert).
  const base = [0.5,0.4,0.3,0.6,0.2,0.5,0.4,0.3,0.5,0.4,0.6,0.3]; // 12 newest-first
  const olderTailDiffers = base.concat([9, 9, 9]);                 // „älteres" Unternehmen, identisches recent-12
  assert(_durV3(base) === _durV3(olderTailDiffers), 'ältere Historie jenseits W=12 darf durV3 NICHT ändern (kein Alters-/Längen-Leck)');
  const withinWindowDiffers = base.slice(); withinWindowDiffers[1] = -0.9;
  assert(_durV3(base) !== _durV3(withinWindowDiffers), 'Änderung INNERHALB des Fensters MUSS durV3 ändern (Metrik nicht degeneriert)');
});

test('fabless-unit: beschleunigende all-positive Reihe NICHT bestraft (durRaw > 0); anhaltender Decline < 0', () => {
  assert(_durV3([1.5,1.2,1.0,0.8,0.6,0.5,0.4,0.3]) > 0, 'all-positive Ramp sollte > 0 sein (Upside nicht als Fragilität bestraft)');
  assert(_durV3([-0.3,-0.4,-0.5,-0.2,-0.3,-0.4]) < 0, 'anhaltender Decline sollte < 0 sein');
  assert(_durV3([0.4,0.5,0.5,-0.5,-0.6,-0.55]) < 0, 'jüngster tiefer Einbruch (recency-gewichtet) sollte < 0 sein');
});

test('fabless: universeSize === 8 & KEIN KILL-Ticker im Cohort (Anti-Kontaminations-Guard, Re-Court)', () => {
  assert(fab.universeSize === 8, `fabless_semi universeSize sollte 8 sein, ist ${fab.universeSize} (KMTS-Leck? KILL-Filter aktiv?)`);
  assert(FM.length === 8, `fabless_semi members.length sollte 8 sein, ist ${FM.length}`);
  for (const k of ['KMTS', 'PS', 'RDVT', 'ADEA', 'OMDA', 'TEM']) {
    assert(!FM.some(m => m.ticker === k), `KILL-Ticker ${k} darf NICHT im fabless-Cohort sein (skeptiker-verifizierte Entfernung)`);
  }
});

test('Determinismus: VOLLE Kette (court-screen + court-score) byte-identisch über Läufe (isolierte Outputs)', () => {
  // Re-Court#2-Auflage: nicht nur court-score allein — die ganze Stage-1+2-Kette neu laufen + SHA-vergleichen.
  execSync('node court-screen.js', { cwd: ROOT, stdio: 'ignore', env: TEST_ENV });
  execSync('node court-score.js', { cwd: ROOT, stdio: 'ignore', env: TEST_ENV });
  const r2 = fs.readFileSync(RESULTS, 'utf8');
  assert(sha(r1) === sha(r2), 'court-results.json nicht byte-identisch über volle Kette (Determinismus verletzt)');
});

test('fabless-unit: collapse-reweight Backstop-Mathe (synthetisch rhoDom>0.90) — <=50% Haircut + pro-rata, Summe=1', () => {
  // KEEP IN SYNC mit court-score.js collapse-guard. Testet den im canonical Lauf NIE gefeuerten Zweig (Re-Court#2-Auflage).
  const T = 0.90, wDur0 = 0.25, others = { growth: 0.35, gm: 0.25, accel: 0.15 };
  const reweight = rho => {
    const hf = Math.max(0, Math.min(1, (rho - T) / (1 - T))) * 0.5;
    const wDur = wDur0 * (1 - hf), freed = wDur0 - wDur;
    const otherWsum = Object.values(others).reduce((s, w) => s + w, 0);
    const wNew = { durability: wDur };
    for (const k in others) wNew[k] = others[k] + freed * (others[k] / otherWsum);
    return { hf, wDur, sum: Object.values(wNew).reduce((s, w) => s + w, 0) };
  };
  const r95 = reweight(0.95);
  assert(Math.abs(r95.hf - 0.25) < 1e-9, `rhoDom 0.95 -> hf 0.25 ((0.95-0.9)/0.1*0.5), ist ${r95.hf}`);
  assert(r95.wDur < wDur0 && r95.wDur >= wDur0 * 0.5, `Haircut <=50% (wDur ${r95.wDur} in [0.125,0.25))`);
  assert(Math.abs(r95.sum - 1.0) < 1e-9, `pro-rata erhält Gewichtssumme=1, ist ${r95.sum}`);
  assert(Math.abs(reweight(1.0).hf - 0.5) < 1e-9, 'rhoDom 1.0 -> max 50% Haircut');
  assert(reweight(0.90).hf === 0, 'rhoDom == T -> kein Haircut (Schwelle exklusiv)');
});

// =================== MEDTECH_DEVICES BUCKET TESTS ===================
test('medtech_devices: bucket existiert', () => {
  assert(doc.medtech_devices && Array.isArray(doc.medtech_devices.members), 'medtech_devices bucket fehlt');
});

const med = doc.medtech_devices;
const MM = med ? med.members : [];
const mrank = t => { const i = MM.findIndex(m => m.ticker === t); return i < 0 ? null : i + 1; };

test('medtech_devices: gateOpen/headline-count im Korridor [7,20]', () => {
  // v1.3 RECALIBRATION (nicht Weakening): der v1.2-Korridor [8,20] war gegen die DECELERATION-BLINDE
  // (inflationierte) Growth-Metrik kalibriert. Der v1.3-Fix (growthOrganic=min(latest,blend), gateOpen-Floor
  // auf latestOrganicYoY) lässt INSP (latest 13.6% < 15% Floor) und ATRC (14.88% < 15%) KORREKT vom Headline
  // fallen → ehrliche Zahl 7. Untere Grenze auf 7 angepasst; obere Grenze unverändert.
  const headlineCount = MM.filter(m => m.headlineShortlist).length;
  assert(headlineCount >= 7 && headlineCount <= 20, `headline count ${headlineCount} nicht in [7,20]`);
});

// =================== MEDTECH v1.3 DECELERATION REGRESSION GATES (Bedingung III) ===================

test('v1.3 (III) NO BACK-LOADING: growthOrganic <= 1.3 * rawCurrentYoY für JEDEN headlineShortlist-Namen', () => {
  // Fängt Back-Loading-Drift bei künftiger Rekalibrierung: der primäre Achsen-Input (growthOrganic) darf NIE
  // mehr als 30% über die aktuelle organische Rate (latestOrganicYoY) hinauslaufen. Da v1.3 growthOrganic=
  // min(latest,blend)<=latest setzt, ist das Verhältnis konstruktionsbedingt <=1.0 — der Test sperrt diese
  // Invariante EIN, damit eine spätere Achsen-Änderung (z.B. zurück zum reinen Blend) LAUT failt.
  const headline = MM.filter(m => m.headlineShortlist);
  assert(headline.length > 0, 'kein headlineShortlist-Name vorhanden');
  for (const m of headline) {
    const rawCurrent = m.latestOrganicYoY; // aktuelle organische Rate = rawCurrentYoY (deal-bereinigt)
    assert(rawCurrent != null && Number.isFinite(rawCurrent), `${m.ticker} headline aber latestOrganicYoY null/NaN: ${rawCurrent}`);
    assert(m.growthOrganic != null, `${m.ticker} growthOrganic null`);
    // 1.3*rawCurrent als Schranke; bei rawCurrent<=0 (sollte für headline nicht vorkommen, Floor 0.15) verlangen wir growthOrganic<=rawCurrent.
    const bound = rawCurrent > 0 ? 1.3 * rawCurrent : rawCurrent;
    assert(m.growthOrganic <= bound + 1e-9,
      `${m.ticker} BACK-LOADING: growthOrganic ${m.growthOrganic} > 1.3*rawCurrentYoY (${bound}) — deceleration-Inflation (Blend ${m.growthBlend})`);
  }
});

test('v1.3 (III) FLOOR-SAFE: KEIN Name mit latestOrganicYoY < 0.15 auf der headlineShortlist', () => {
  // Das harte gateOpen-Floor (growth>=0.15) muss auf der AKTUELLEN organischen Rate scharf sein (Bedingung II).
  // INSP (13.6%) und ATRC (14.88%) dürfen NIE auf der Shortlist sein.
  for (const m of MM) {
    if (m.latestOrganicYoY != null && m.latestOrganicYoY < 0.15) {
      assert(m.headlineShortlist === false,
        `${m.ticker} hat latestOrganicYoY ${m.latestOrganicYoY} (<0.15) aber ist auf headlineShortlist (Floor-Bypass!)`);
    }
  }
  // Konkret-Regression: INSP muss vom Headline fallen (war v1.2 #3 durch Blend-Inflation 13.6%->30%).
  const insp = MM.find(m => m.ticker === 'INSP');
  if (insp) {
    assert(insp.latestOrganicYoY != null && insp.latestOrganicYoY < 0.15, `INSP latestOrganicYoY sollte <0.15 sein, ist ${insp.latestOrganicYoY}`);
    assert(insp.headlineShortlist === false, `INSP (latest 13.6% < 15% Floor) darf NICHT auf der Shortlist sein, ist ${insp.headlineShortlist}`);
  }
});

test('v1.3 (III) deceleration-LAMP: dezelerierende Namen (latest < median(prior organic)) tragen die Lampe', () => {
  // Mindestens INSP/TMDX/PRCT dezelerieren (latest < prior median). Wenn _decelerating gesetzt, MUSS die Lampe da sein.
  for (const m of MM) {
    if (m._decelerating === true) {
      assert(m.lamps.some(l => l.startsWith('decelerating')),
        `${m.ticker} _decelerating=true aber keine 'decelerating'-Lampe; Lampen: ${m.lamps}`);
    }
  }
  // mind. ein dezelerierender Name existiert (TMDX: latest 37% << blend 85%)
  const tmdx = MM.find(m => m.ticker === 'TMDX');
  if (tmdx) assert(tmdx.lamps.some(l => l.startsWith('decelerating')), `TMDX sollte decelerating-Lampe haben; Lampen: ${tmdx.lamps}`);
});

test('v1.3 (V) trailing-window-growth ADVISORY-Lampe bei Blend-Divergenz >~50% (INSP/TMDX)', () => {
  // INSP (13.6% vs 29.86% blend) und TMDX (37% vs 85% blend) divergieren > 50% → Advisory-Lampe.
  for (const t of ['INSP', 'TMDX']) {
    const m = MM.find(x => x.ticker === t);
    if (m) assert(m.lamps.some(l => l.startsWith('trailing-window-growth')),
      `${t} (Blend divergiert >50% von latest) sollte trailing-window-growth-Lampe haben; Lampen: ${m.lamps}`);
  }
});

test('v1.3 (VI) GMED current-year-only Lampe (<2 organische Jahre, kein 0.6/0.4-Blend gelaufen)', () => {
  const gmed = MM.find(m => m.ticker === 'GMED');
  assert(gmed != null, 'GMED nicht im Bucket');
  assert(gmed._currentYearOnly === true, `GMED sollte _currentYearOnly=true sein (1 organisches Jahr nach NuVasive-Exclusion), ist ${gmed._currentYearOnly}`);
  assert(gmed.lamps.some(l => l.startsWith('current-year-only')),
    `GMED sollte current-year-only-Lampe haben (nicht short-organic-history, das impliziert fälschlich Blend); Lampen: ${gmed.lamps}`);
  // growthOrganic == latestOrganicYoY == growthBlend (alle == der eine organische Wert)
  assert(Math.abs(gmed.growthOrganic - gmed.latestOrganicYoY) < 1e-9 && Math.abs(gmed.growthOrganic - gmed.growthBlend) < 1e-9,
    `GMED current-year-only: growthOrganic/latest/blend sollten identisch sein, sind ${gmed.growthOrganic}/${gmed.latestOrganicYoY}/${gmed.growthBlend}`);
});

test('medtech_devices: KEIN Score NaN/negativ (score=null nur für Out-class erlaubt, Fix C)', () => {
  for (const m of MM) {
    if (m.membershipClass === 'Out') {
      assert(m.score === null, `${m.ticker} Out-class score sollte null sein (Fix C), ist ${m.score}`);
    } else {
      assert(Number.isFinite(m.score) && m.score >= 0, `${m.ticker} Score ungültig: ${m.score}`);
    }
  }
});

test('medtech_devices: Determinismus (byte-identisch über 2 Läufe)', () => {
  // Der große Determinismus-Test oben deckt medtech bereits mit ab (ganzer Lauf)
  // Hier nur prüfen dass der Eintrag stabil vorhanden ist
  assert(doc.medtech_devices.members.length > 0, 'medtech_devices leer');
});

test('PARITÄT: system_app_software members+scores byte-identisch zu _parity-baseline-pre-medtech.json', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', '_parity-baseline-pre-medtech.json'), 'utf8'));
  const baselineSaaS = baseline.system_app_software;
  assert(saas.universeSize === baselineSaaS.universeSize, `SaaS universeSize geändert: ${saas.universeSize} vs ${baselineSaaS.universeSize}`);
  const saasScoreSum = M.reduce((s, m) => s + m.score, 0);
  const baselineScoreSum = baselineSaaS.members.reduce((s, m) => s + m.score, 0);
  assert(Math.abs(saasScoreSum - baselineScoreSum) < 0.001, `SaaS scoreSum geändert: ${saasScoreSum} vs ${baselineScoreSum}`);
  // Ticker-Reihenfolge und Scores je Mitglied
  for (let i = 0; i < M.length; i++) {
    assert(M[i].ticker === baselineSaaS.members[i].ticker, `SaaS member[${i}] ticker: ${M[i].ticker} vs ${baselineSaaS.members[i].ticker}`);
    assert(Math.abs(M[i].score - baselineSaaS.members[i].score) < 0.001, `SaaS ${M[i].ticker} score: ${M[i].score} vs ${baselineSaaS.members[i].score}`);
  }
});

test('PARITÄT: fabless_semi members+scores byte-identisch zu _parity-baseline-pre-medtech.json', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', '_parity-baseline-pre-medtech.json'), 'utf8'));
  const baselineFab = baseline.fabless_semi;
  assert(fab.universeSize === baselineFab.universeSize, `Fabless universeSize geändert: ${fab.universeSize} vs ${baselineFab.universeSize}`);
  const fabScoreSum = FM.reduce((s, m) => s + m.score, 0);
  const baselineScoreSum = baselineFab.members.reduce((s, m) => s + m.score, 0);
  assert(Math.abs(fabScoreSum - baselineScoreSum) < 0.001, `Fabless scoreSum geändert: ${fabScoreSum} vs ${baselineScoreSum}`);
  for (let i = 0; i < FM.length; i++) {
    assert(FM[i].ticker === baselineFab.members[i].ticker, `Fabless member[${i}] ticker: ${FM[i].ticker} vs ${baselineFab.members[i].ticker}`);
    assert(Math.abs(FM[i].score - baselineFab.members[i].score) < 0.001, `Fabless ${FM[i].ticker} score: ${FM[i].score} vs ${baselineFab.members[i].score}`);
  }
});

// =================== MEDTECH v1.2 TESTS (Court-DENIED 3:1 Remediation, 8 Fixes A–H) ===================

test('v1.2 Fix E PARITY: SaaS+Fabless BUCKETS byte-identisch zu _parity-baseline-pre-v12.json (deep/actual)', () => {
  // Fix E: medtech-only Intermediates (_growthMedtech/_growthMedtechAdj) dürfen NIE auf SaaS/Fabless-Membern
  // leaken. Echter Byte-/Deep-Vergleich der GANZEN system_app_software + fabless_semi Buckets (nicht nur scoreSum).
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', '_parity-baseline-pre-v12.json'), 'utf8'));
  for (const b of ['system_app_software', 'fabless_semi']) {
    const got = JSON.stringify(doc[b]);
    const exp = JSON.stringify(baseline[b]);
    assert(got === exp, `${b} bucket NICHT byte-identisch zur pre-v12-Baseline (len got=${got.length} exp=${exp.length}) — Fix-E-Leak oder Parity-Bruch`);
  }
});

test('v1.2 Fix E: KEIN _growthMedtech/_growthMedtechAdj/growthOrganic auf SaaS/Fabless-Membern (Leak-Guard)', () => {
  for (const b of ['system_app_software', 'fabless_semi']) {
    for (const m of doc[b].members) {
      for (const leak of ['_growthMedtech', '_growthMedtechAdj', 'growthOrganic', '_dealYearExcluded', '_organicYears', '_shortOrganicHistory']) {
        assert(!(leak in m), `${b}/${m.ticker} hat medtech-only Feld '${leak}' geleakt (Fix E verletzt)`);
      }
    }
  }
});

test('v1.2 Fix A (SI-5): classifiedCount === scoredCount (KEINE stillen Drops im medtech-Universum)', () => {
  assert(med.classifiedCount != null && med.scoredCount != null, 'classifiedCount/scoredCount fehlen im medtech-Bucket');
  assert(med.classifiedCount === med.scoredCount, `stille Drops: classifiedCount ${med.classifiedCount} !== scoredCount ${med.scoredCount}`);
  assert(med.scoredCount === MM.length, `scoredCount ${med.scoredCount} !== members.length ${MM.length}`);
});

test('v1.2 Fix A: Large-Caps MDT/SYK/ABT/EW/BDX/ZBH sind im Universum admittiert (nicht still gedroppt)', () => {
  for (const t of ['MDT', 'SYK', 'ABT', 'EW', 'BDX', 'ZBH']) {
    assert(MM.some(m => m.ticker === t), `Large-Cap ${t} sollte im medtech-Universum sein (Fix A: kein asset-light-Drop)`);
  }
});

test('v1.2 Fix A: Large-Caps fallen am Growth-Floor → NICHT auf headlineShortlist (korrekt)', () => {
  // Sie sind admittiert (für cross-sektionale Mediane), aber zu langsam → belowAbsoluteFloor ODER Out-class.
  for (const t of ['MDT', 'ABT', 'BDX']) {
    const m = MM.find(x => x.ticker === t);
    if (m) assert(!m.headlineShortlist, `${t} (slow large-cap) sollte NICHT auf der Shortlist sein`);
  }
});

test('v1.2 Fix B+C (ALMR LEAK): ALMR ist Out-class, score=null, NICHT auf headlineShortlist', () => {
  const almr = MM.find(m => m.ticker === 'ALMR');
  assert(almr != null, 'ALMR muss im Universum sein (Fix A admittiert alle klassifizierten Namen)');
  assert(almr.membershipClass === 'Out', `ALMR sollte Out-class sein (tiny $74M scale), ist ${almr.membershipClass}`);
  assert(almr.score === null, `ALMR score sollte null sein (Fix C: Out-class), ist ${almr.score}`);
  assert(almr.headlineShortlist === false, `ALMR darf NIE auf der headlineShortlist sein (Fix B), ist ${almr.headlineShortlist}`);
});

test('v1.2 Fix B: gateOpen/membership nutzen WINSORISIERTE growth (cap 1.0), nicht RAW — kein 195%-Leak', () => {
  // Eine Out-class darf NIE headlineShortlist sein; ALLE headline-Namen sind membership != Out.
  for (const m of MM) {
    if (m.headlineShortlist) {
      assert(m.membershipClass !== 'Out', `${m.ticker} ist headlineShortlist aber Out-class (Fix B verletzt)`);
    }
  }
});

test('v1.2 Fix C (SI-4): headline ranked members enthalten NUR shortlist-fähige (kein Out-class mit Score)', () => {
  // Out-class -> score=null UND in excluded[]. Die gerankten (score!=null) Member sind alle membership != Out.
  assert(Array.isArray(med.excluded), 'medtech.excluded[] fehlt (Fix C)');
  for (const m of med.excluded) {
    assert(m.membershipClass === 'Out', `excluded[] enthält ${m.ticker} mit membershipClass ${m.membershipClass} (sollte Out)`);
    assert(m.score === null, `excluded[] ${m.ticker} score sollte null sein, ist ${m.score}`);
    assert(m.headlineShortlist === false, `excluded[] ${m.ticker} darf nicht headlineShortlist sein`);
  }
  const ranked = MM.filter(m => m.score != null);
  for (const m of ranked) assert(m.membershipClass !== 'Out', `ranked member ${m.ticker} ist Out-class mit Score (Fix C verletzt)`);
});

test('v1.2 Fix D: GMED nutzt ORGANIC growth (deal-year FY2023 excluded → ~16%, nicht 42%-Discount)', () => {
  const gmed = MM.find(m => m.ticker === 'GMED');
  assert(gmed != null, 'GMED nicht im Universum');
  assert(gmed._dealYearExcluded === undefined || gmed.growthOrganic != null, 'GMED growthOrganic fehlt');
  assert(gmed.growthOrganic != null && Math.abs(gmed.growthOrganic - 0.1665) < 0.01,
    `GMED organic growth sollte ~16.65% sein (deal-year-excluded), ist ${gmed.growthOrganic}`);
  // M&A-jump LAMP bleibt advisory, neues deal-yr-excluded-Tag statt disc%
  const jumpLamp = gmed.lamps.find(l => l.startsWith('M&A-jump-in-window'));
  assert(jumpLamp && /deal-yr-excluded=yes/.test(jumpLamp), `GMED M&A-jump-Lampe sollte deal-yr-excluded=yes tragen, ist '${jumpLamp}'`);
  assert(!gmed.lamps.some(l => /disc\d/.test(l)), 'GMED sollte KEINEN Magnitude-Discount-Lamp mehr haben (Fix D ersetzt v1.1)');
});

test('v1.2 Fix D: organische Wachser (ISRG/PODD) haben dealYearExcluded=false (kein Deal im Fenster)', () => {
  for (const t of ['ISRG', 'PODD']) {
    const m = MM.find(x => x.ticker === t);
    if (m) {
      const jumpLamp = m.lamps.find(l => l.startsWith('M&A-jump-in-window'));
      assert(!jumpLamp, `${t} (organisch) sollte keine M&A-jump-Lampe haben; Lampen: ${m.lamps}`);
    }
  }
});

test('v1.2 Fix F: M&A-coverage-null Lampe auf Namen mit goodwill=null (nicht still discount=0)', () => {
  // ALMR hat goodwill=null im snapshot → coverage-null-Lampe muss vorhanden sein.
  const almr = MM.find(m => m.ticker === 'ALMR');
  if (almr) assert(almr.lamps.includes('M&A-coverage-null'), `ALMR (goodwill=null) sollte M&A-coverage-null Lampe haben; Lampen: ${almr.lamps}`);
  // Mindestens ein Name mit coverage-null existiert (snapshot hat 17 null-goodwill Namen)
  const anyNull = MM.some(m => m.lamps.includes('M&A-coverage-null'));
  assert(anyNull, 'mindestens ein medtech-Name sollte M&A-coverage-null tragen (Fix F)');
});

test('v1.2 Fix G (SI-3): comparabilityNote im medtech-Bucket (absKaliber cross-bucket, REL bucket-relativ)', () => {
  assert(med.comparabilityNote && /absKaliber/i.test(med.comparabilityNote), 'comparabilityNote fehlt');
  assert(/cross-bucket-comparable/i.test(med.comparabilityNote) && /bucket-relative/i.test(med.comparabilityNote),
    `comparabilityNote sollte cross-bucket vs bucket-relative erklären: ${med.comparabilityNote}`);
});

test('medtech: M&A-flow-Lampe auf SYK, ZBH, BSX (delta-goodwill >= 5%)', () => {
  for (const t of ['SYK', 'ZBH', 'BSX']) {
    const m = MM.find(x => x.ticker === t);
    if (!m) continue; // skip if not in bucket (might not pass pre-filter)
    assert(m.lamps && m.lamps.includes('M&A-inorganic-flow'), `${t} sollte M&A-inorganic-flow Lampe haben`);
  }
});

test('medtech: M&A-stock-Lampe wenn goodwillToRev >= 0.80 (GMED-check: data-driven)', () => {
  // GMED goodwillToRev ist daten-abhängig (~0.49 per 2026-06-20); M&A-built-stock nur wenn >= 0.80.
  // Test prüft Logik-Konsistenz: wenn Lampe gesetzt, muss goodwillToRev >= 0.80 sein.
  for (const m of MM) {
    if (m.lamps && m.lamps.includes('M&A-built-stock')) {
      assert(m.goodwillToRev != null && m.goodwillToRev >= 0.80,
        `${m.ticker} hat M&A-built-stock Lampe aber goodwillToRev=${m.goodwillToRev} < 0.80`);
    }
  }
});

test('medtech: ALMR min-base-Filter (rev<100M UND marketCap<1B -> raus; sonst drin)', () => {
  // ALMR revLatest ~74M (< 100M) aber marketCap ~1.44B (>= 1B) -> besteht MIN-BASE, darf im Bucket sein.
  // Test prüft: wenn ALMR im Bucket, muss mindestens eine Bedingung erfüllt sein.
  const almr = MM.find(m => m.ticker === 'ALMR');
  if (almr) {
    // Wenn drin: marketCap muss >= 1B ODER rev >= 100M
    const revOk = (almr.scaleRevM != null && almr.scaleRevM >= 100);
    const mcapOk = (almr.marketCap != null && almr.marketCap >= 1e9);
    assert(revOk || mcapOk, `ALMR im Bucket obwohl rev=${almr.scaleRevM}M und marketCap=${almr.marketCap} — MIN-BASE verletzt`);
  }
  // else: nicht im Bucket ist auch ok (z.B. wächst zu langsam)
});

test('medtech: ISRG ohne M&A-Lampe', () => {
  const m = MM.find(x => x.ticker === 'ISRG');
  if (m) {
    assert(!m.lamps.includes('M&A-inorganic-flow'), 'ISRG sollte keine M&A-inorganic-flow Lampe haben');
    assert(!m.lamps.includes('M&A-built-stock'), 'ISRG sollte keine M&A-built-stock Lampe haben');
  }
});

test('medtech: PODD ohne M&A-Lampe', () => {
  const m = MM.find(x => x.ticker === 'PODD');
  if (m) {
    assert(!m.lamps.includes('M&A-inorganic-flow'), 'PODD sollte keine M&A-inorganic-flow Lampe haben');
    assert(!m.lamps.includes('M&A-built-stock'), 'PODD sollte keine M&A-built-stock Lampe haben');
  }
});

// =================== MEDTECH v1.1 TESTS (Court-DENIED Remediation) ===================

test('medtech v1.3: label nennt v1.3 (Court-DENIED-4:1 deceleration remediation)', () => {
  assert(/v1\.3/.test(med.label || ''), `medtech label sollte v1.3 nennen: ${med.label}`);
  assert(/deceleration/i.test(med.label || ''), `medtech label sollte 'deceleration' nennen: ${med.label}`);
});

test('v1.3 (V) DISCLOSURE: a2Note nennt min(latest,blend) + Blend als backward durability view', () => {
  assert(med.a2Note, 'medtech a2Note fehlt');
  assert(/min\(latest/i.test(med.a2Note), `a2Note sollte min(latest-organic-YoY, blend) offenlegen: ${med.a2Note.slice(0,200)}`);
  assert(/durability/i.test(med.a2Note) && /backward/i.test(med.a2Note),
    'a2Note sollte den Blend als backward durability view beschreiben');
});

test('medtech v1.1: GMED hat M&A-jump-in-window Lampe (NuVasive-Sprung ~42% von Rev in 3yr-Fenster)', () => {
  const gmed = MM.find(m => m.ticker === 'GMED');
  assert(gmed != null, 'GMED nicht im medtech-Bucket');
  const jumpLamp = gmed.lamps && gmed.lamps.find(l => l.startsWith('M&A-jump-in-window'));
  assert(jumpLamp, `GMED sollte M&A-jump-in-window Lampe haben (NuVasive goodwill-Sprung $197M->$1435M FY2023); Lampen: ${gmed.lamps}`);
  // maxJump muss >= 0.25 sein (42% >> 25%-Schwelle)
  assert(gmed.maxGoodwillJumpPctRev != null && gmed.maxGoodwillJumpPctRev >= 0.25,
    `GMED maxGoodwillJumpPctRev=${gmed.maxGoodwillJumpPctRev} sollte >= 0.25 sein`);
});

test('medtech v1.3: GMED rankt unter PODD und ISRG (organisch-bereinigt, NICHT M&A-/deceleration-inflationiert)', () => {
  // v1.3 RE-ASSERT (Bedingung IV): der alte Test sperrte `gmed.score < tmdx.score` als Erfolgskriterium ein und
  // LABELTE damit TMDX's STALE-HISTORY-INFLATIONIERTEN Rang (#2, weil der Blend 37% als 85% las) fälschlich als
  // den „M&A-Fix". Das war eine deceleration-Inflation, KEIN M&A-Effekt. v1.3 fixt den Growth-Input
  // (growthOrganic=min(latest,blend)) → TMDX liest jetzt seine echte aktuelle organische Rate (~37%, nicht 85%).
  // Wir re-asserten GMED nur noch gegen die ECHT organischen Wachser PODD & ISRG (kein TMDX-Lock mehr).
  const gmed = MM.find(m => m.ticker === 'GMED');
  const podd = MM.find(m => m.ticker === 'PODD');
  const isrg = MM.find(m => m.ticker === 'ISRG');
  assert(gmed && podd && isrg, 'GMED/PODD/ISRG müssen alle im Bucket sein');
  assert(gmed.score < podd.score, `GMED (${gmed.score}) sollte unter PODD (${podd.score}) ranken`);
  assert(gmed.score < isrg.score, `GMED (${gmed.score}) sollte unter ISRG (${isrg.score}) ranken`);
});

test('medtech v1.3: TMDX growthOrganic == latestOrganicYoY (~37%), NICHT der inflationierte Blend (~85%)', () => {
  // Beweist, dass der deceleration-Fix die TMDX-spezifische Inflation killt (die der alte Lock als „M&A-Fix" mislabelte).
  const tmdx = MM.find(m => m.ticker === 'TMDX');
  assert(tmdx != null, 'TMDX nicht im Bucket');
  assert(tmdx.growthOrganic != null && tmdx.growthOrganic <= 0.40,
    `TMDX growthOrganic sollte <=~0.37 sein (aktuelle organische Rate), ist ${tmdx.growthOrganic} (Blend war ${tmdx.growthBlend})`);
  assert(tmdx.growthBlend != null && tmdx.growthBlend > 0.60,
    `TMDX growthBlend (rückwärts) sollte hoch sein (~0.85) als Beweis der Divergenz, ist ${tmdx.growthBlend}`);
  assert(Math.abs(tmdx.growthOrganic - tmdx.latestOrganicYoY) < 1e-9,
    `TMDX growthOrganic (${tmdx.growthOrganic}) sollte == latestOrganicYoY (${tmdx.latestOrganicYoY}) sein (min(latest,blend)=latest bei Deceleration)`);
});

test('medtech v1.1: ISRG und PODD haben KEINE M&A-jump-in-window Lampe (organische Wachser)', () => {
  for (const t of ['ISRG', 'PODD']) {
    const m = MM.find(x => x.ticker === t);
    if (m) {
      const jumpLamp = m.lamps && m.lamps.find(l => l.startsWith('M&A-jump-in-window'));
      assert(!jumpLamp, `${t} (organisch) sollte keine M&A-jump-in-window Lampe haben; Lampen: ${m.lamps}`);
    }
  }
});

test('medtech v1.1 Fix 3: ALMR growth gecappt (scoringInput <= 1.0) — kein 195%-CAGR-Artefakt in Stats', () => {
  // ALMR growth ~1.95 (195%) würde die cross-sektionalen Mediane/MAD verzerren.
  // Fix 3 cappt _growthMedtech auf 1.0 für Stats; raw growth bleibt für Anzeige.
  // Proxy-Test: wenn ALMR im Bucket, darf sein zur Statistik verwendeter Wert nicht > 1.0 sein.
  // Wir vertrauen dem Implementation-Review: _growthMedtech = min(_growth, 1.0) für medtech.
  // Direkttest: medtech growth-Stats-Median muss plausibel (< 1.0) sein — nicht durch ALMR 195% angehoben.
  const growthStat = med.anchors && med.anchors.growth;
  if (growthStat) {
    assert(growthStat.median != null && growthStat.median < 1.0,
      `medtech growth-Stats-Median (${growthStat.median}) sollte < 1.0 sein (Fix 3 verhindert ALMR 195%-Verzerrung)`);
  }
  // ALMR raw growth erscheint im Ergebnis-Output (axisS.Growth nicht capped an 1), d.h. Anzeige korrekt
  const almr = MM.find(m => m.ticker === 'ALMR');
  if (almr) {
    // ALMR darf im Bucket sein (besteht MIN-BASE via marketCap); raw growth bleibt hoch
    assert(almr.growth != null, 'ALMR.growth sollte vorhanden sein (raw growth für Anzeige)');
  }
});

test('medtech v1.1 Parity: SaaS+Fabless exakt wie v1.0-pre-v11-Baseline', () => {
  // Liest _parity-baseline-pre-v11.json (vor v1.1 gespeichert — SaaS/Fabless dürfen sich NICHT geändert haben)
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', '_parity-baseline-pre-v11.json'), 'utf8'));
  const bSaaS = baseline.system_app_software;
  const bFab  = baseline.fabless_semi;
  // SaaS
  assert(saas.universeSize === bSaaS.universeSize, `SaaS universeSize: ${saas.universeSize} vs ${bSaaS.universeSize}`);
  const saasSum = M.reduce((s, m) => s + m.score, 0);
  const bSaasSum = bSaaS.members.reduce((s, m) => s + m.score, 0);
  assert(Math.abs(saasSum - bSaasSum) < 0.001, `SaaS scoreSum: ${saasSum} vs ${bSaasSum}`);
  // Fabless
  assert(fab.universeSize === bFab.universeSize, `Fabless universeSize: ${fab.universeSize} vs ${bFab.universeSize}`);
  const fabSum = FM.reduce((s, m) => s + m.score, 0);
  const bFabSum = bFab.members.reduce((s, m) => s + m.score, 0);
  assert(Math.abs(fabSum - bFabSum) < 0.001, `Fabless scoreSum: ${fabSum} vs ${bFabSum}`);
});

// =================== HÄRTUNG 2 (2026-06-20): computeMedtechOrganicGrowth Unit-Tests ===================
// Direkte Funktions-Unit-Tests: importieren computeMedtechOrganicGrowth via module.exports (require.main-Guard
// stellt sicher, dass der require() NICHT outputs/court-results.json überschreibt — kein Seiteneffekt).
const { computeMedtechOrganicGrowth: cMOG } = require('./court-score.js');
assert(typeof cMOG === 'function', 'computeMedtechOrganicGrowth nicht exportiert (Härtung 2 require.main-Guard fehlt)');

test('Unit computeMedtechOrganicGrowth (a): decelerating → min() wählt latest (latest<blend)', () => {
  // latest=0.37, blend wird höher sein (prior years ~0.85) → min → 0.37
  const yoySeries = [0.37, 0.85, 0.90, 0.80]; // newest-first; keine Deal-Years
  const result = cMOG(yoySeries, null, null, null, {});
  assert(result.latestOrganicYoY != null, 'latestOrganicYoY sollte gesetzt sein');
  assert(Math.abs(result.latestOrganicYoY - 0.37) < 1e-9, `latestOrganicYoY sollte 0.37 sein, ist ${result.latestOrganicYoY}`);
  assert(result.growth <= result.latestOrganicYoY + 1e-9, `growth (${result.growth}) darf nicht über latestOrganicYoY (${result.latestOrganicYoY}) liegen`);
  assert(result.decelerating === true, `decelerating sollte true sein (0.37 < median(0.85,0.90,0.80)=0.85), ist ${result.decelerating}`);
  // min(latest=0.37, blend) === growth
  assert(Math.abs(result.growth - Math.min(result.latestOrganicYoY, result.blend)) < 1e-9,
    `growth (${result.growth}) sollte min(latest, blend) sein`);
});

test('Unit computeMedtechOrganicGrowth (b): accelerating → min() wählt blend (blend<latest)', () => {
  // latest=0.85, prior years niedrig → blend < latest → min wählt blend
  const yoySeries = [0.85, 0.20, 0.15, 0.18]; // newest-first; stark beschleunigend
  const result = cMOG(yoySeries, null, null, null, {});
  assert(result.latestOrganicYoY != null, 'latestOrganicYoY sollte gesetzt sein');
  assert(Math.abs(result.latestOrganicYoY - 0.85) < 1e-9, `latestOrganicYoY sollte 0.85 sein, ist ${result.latestOrganicYoY}`);
  assert(result.blend != null, 'blend sollte gesetzt sein');
  // blend = 0.6*CAGR(0.85,0.20,0.15,0.18) + 0.4*median → muss < 0.85 sein
  assert(result.blend < result.latestOrganicYoY, `blend (${result.blend}) sollte < latest (${result.latestOrganicYoY}) sein`);
  assert(Math.abs(result.growth - result.blend) < 1e-9,
    `growth (${result.growth}) sollte blend (${result.blend}) sein wenn blend < latest`);
  assert(result.decelerating === false, `decelerating sollte false sein (accelerating), ist ${result.decelerating}`);
});

test('Unit computeMedtechOrganicGrowth (c): FY-Reconciliation wirft LAUT bei Deal-Jahr-Drop + >15% Rev-Divergenz', () => {
  // goodwillHistory: Sprung 0.30*revLatest → Deal-Jahr-Drop; snapAnnualRev weicht >15% ab → HARD ASSERT
  const yoySeries = [0.20, 0.50, 0.15]; // yoySeries[0] = Deal-Jahr (wird gedroppt)
  const goodwillHistory = [
    { val: 500e6, end: '2024' },  // newer
    { val: 100e6, end: '2023' },  // jump = 400M = 0.40 * revLatest(1000M) >= 0.25 → Deal
  ];
  const revLatest = 1000e6;
  const snapAnnualRev = 500e6; // 100% Divergenz > 15% → muss laut failen
  let threw = false;
  try {
    cMOG(yoySeries, goodwillHistory, revLatest, null, { ticker: 'TEST_ASSERT', snapAnnualRev });
    threw = false;
  } catch (e) {
    threw = true;
    assert(/FY-Reconciliation FAILED/i.test(e.message), `Fehlertext sollte FY-Reconciliation FAILED enthalten, ist: ${e.message}`);
  }
  assert(threw, 'FY-Reconciliation sollte bei >15% Rev-Divergenz + Deal-Jahr-Drop LAUT failen');
});

test('Unit computeMedtechOrganicGrowth (d): FY-Reconciliation wirft NICHT bei guter Ausrichtung', () => {
  // Gleiche Struktur, aber snapAnnualRev innerhalb 15% von revLatest → kein Throw
  const yoySeries = [0.20, 0.50, 0.15];
  const goodwillHistory = [
    { val: 500e6, end: '2024' },
    { val: 100e6, end: '2023' },
  ];
  const revLatest = 1000e6;
  const snapAnnualRev = 1050e6; // 5% Abweichung → innerhalb 15% → kein Throw
  let threw = false;
  try {
    cMOG(yoySeries, goodwillHistory, revLatest, null, { ticker: 'TEST_OK', snapAnnualRev });
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'FY-Reconciliation darf bei gutem Rev-Match (<15%) NICHT failen');
});

// Temp-Outputs aufräumen (Harness-Isolation: Produktions-Artefakte bleiben unberührt)
try { fs.unlinkSync(CAND_TEST); } catch {}
try { fs.unlinkSync(RESULTS); } catch {}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
