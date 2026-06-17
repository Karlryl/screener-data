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

// Temp-Outputs aufräumen (Harness-Isolation: Produktions-Artefakte bleiben unberührt)
try { fs.unlinkSync(CAND_TEST); } catch {}
try { fs.unlinkSync(RESULTS); } catch {}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
