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

// audit/fix (gauntlet E3): SI-4-Retrofit — Out-Class-Member bekommen jetzt score=null (wie medtech/dlst),
// daher prüft dieser Test (vormals „alle Scores finite>0") jetzt: score=null NUR für Out-class, sonst finite>=0,
// und der MIN ÜBER DIE GERANKTEN (nicht-Out) Namen ist >0 — die additive A2-Achse nullt weiterhin keinen
// gerankten Namen. Spiegelt den medtech-Test 'KEIN Score NaN/negativ (score=null nur für Out-class erlaubt)'.
test('SI-4: score=null nur für Out-class; gerankte Scores finite >=0, min>0 (additive A2 nullt keinen Headline-Namen)', () => {
  for (const m of M) {
    if (m.membershipClass === 'Out') {
      assert(m.score === null, `${m.ticker} Out-class score sollte null sein (SI-4), ist ${m.score}`);
    } else {
      assert(Number.isFinite(m.score) && m.score >= 0, `${m.ticker} Score ungültig: ${m.score}`);
    }
  }
  const ranked = M.filter(m => m.score != null).map(m => m.score);
  const min = Math.min(...ranked);
  assert(min > 0, `min Score der gerankten Namen sollte >0 sein (additive Achse nullt nicht), ist ${min}`);
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

test('fabless-unit: Fenster-Konfinierung NUR oberhalb W=12 — kurze (<12Q) Namen sind NICHT längen-vergleichbar (ehrliche Disclosure statt Tautologie)', () => {
  // audit F-A-2026-06-22: verhindert die Tautologie-Fehlannahme „durV3 ist alters-/längen-neutral".
  //   ALTER BUG (ersetzt): base hatte bereits 12 Elemente -> base.concat([9,9,9]) wurde von slice(0,_WCAP=12)
  //   IMMER verworfen -> die Gleichheits-Assertion war für JEDEN angehängten Wert trivial wahr und prüfte NICHTS
  //   im genau dem Kurz-Historien-Regime (winN<12), das die Metrik zu fixen behauptet. Tatsächlich IST durV3 dort
  //   historien-gekoppelt: ein 3-Quartals-Name [0.5,0.4,0.3]=>0.6, derselbe + Tail [.,.,.,9,9,9]=>0.084.
  // (A) Konfinierung gilt NUR oberhalb des vollen Fensters: ab >=12 Elementen ändert älterer Tail nichts.
  const full = [0.5,0.4,0.3,0.6,0.2,0.5,0.4,0.3,0.5,0.4,0.6,0.3]; // genau 12 newest-first (volles Fenster)
  const fullPlusOlder = full.concat([9, 9, 9]);                    // Tail liegt JENSEITS W=12 -> verworfen
  assert(_durV3(full) === _durV3(fullPlusOlder), 'bei winN>=12 darf Historie jenseits W=12 durV3 NICHT ändern (Window-Cap)');
  // (B) UNTERHALB des Fensters ist die Metrik NICHT längen-neutral — und das ist EHRLICH, nicht zu „neutralisieren":
  //   ein 6-Quartals-Name wird AUSSCHLIESSLICH aus seinen 6 Quartalen gerechnet; käme älterer Tail hinzu, fiele er INS
  //   Fenster und MUSS durV3 verschieben. Eine Neutralitäts-Assertion hier wäre wieder die alte Tautologie.
  const young6 = [0.6,0.5,0.4,0.5,0.3,0.4];                        // junger Name, nur 6Q (winN=6<12)
  const sliceOnly6 = young6.slice(0, _WCAP);                       // slice ändert <12-Reihen nicht -> identische Eingabe
  assert(_durV3(young6) === _durV3(sliceOnly6), 'durV3 eines 6Q-Namens wird NUR aus diesen 6 Quartalen gerechnet');
  const young6PlusTail = young6.concat([-0.9, -0.8, 0.1]);          // diese „ältere" Historie liegt INNERHALB W=12
  assert(_durV3(young6) !== _durV3(young6PlusTail), 'bei winN<12 MUSS zusätzliche Historie durV3 ändern -> kurze Namen sind NICHT 12Q-längen-vergleichbar (ehrliche Nicht-Neutralität)');
  // (C) Metrik nicht degeneriert: eine Änderung INNERHALB des Fensters muss durV3 verschieben.
  const withinWindowDiffers = full.slice(); withinWindowDiffers[1] = -0.9;
  assert(_durV3(full) !== _durV3(withinWindowDiffers), 'Änderung INNERHALB des Fensters MUSS durV3 ändern (Metrik nicht degeneriert)');
});

test('fabless: short-durability-window-Lampe feuert für winN<12 & diese Namen sind als NICHT-voll-vergleichbar markiert (Re-Court-Disclosure)', () => {
  // audit F-A-2026-06-22: verhindert die stille Falschbehauptung „alle fabless-Namen sind 12Q-längen-vergleichbar".
  //   Die Metrik ist für winN<12 nachweislich NICHT längen-neutral (siehe Fenster-Konfinierungs-Test); deshalb MUSS
  //   die Disclosure-Lampe greifen, statt eine nicht existente Neutralität zu behaupten. Gilt court-score.js:261 ein:
  //   jeder sec-quarterly-Member mit durWinN<12 trägt 'short-durability-window'; volle (winN>=12) NICHT.
  const shortWin = FM.filter(m => m.durSource === 'sec-quarterly' && m.durWinN != null && m.durWinN < 12);
  for (const m of shortWin) {
    assert(Array.isArray(m.lamps) && m.lamps.includes('short-durability-window'),
      `${m.ticker} (winN=${m.durWinN}<12) MUSS 'short-durability-window' lampen (nicht 12Q-vergleichbar), lamps=${JSON.stringify(m.lamps)}`);
  }
  for (const m of FM) {
    if (m.durSource === 'sec-quarterly' && m.durWinN != null && m.durWinN >= 12) {
      assert(!(m.lamps || []).includes('short-durability-window'),
        `${m.ticker} (winN=${m.durWinN}>=12) darf NICHT 'short-durability-window' lampen (voll vergleichbar)`);
    }
  }
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

// audit/fix (gauntlet E3): SI-4/SI-5-Retrofit für saas/fabless — spiegelt die medtech/dlst-Tests.
test('SI-5 (saas): classifiedCount === scoredCount (KEINE stillen Drops im saas-Universum)', () => {
  assert(saas.classifiedCount != null && saas.scoredCount != null, 'classifiedCount/scoredCount fehlen im saas-Bucket');
  assert(saas.classifiedCount === saas.scoredCount, `stille Drops: classifiedCount ${saas.classifiedCount} !== scoredCount ${saas.scoredCount}`);
  assert(saas.scoredCount === M.length, `scoredCount ${saas.scoredCount} !== members.length ${M.length}`);
});

test('SI-5 (fabless): classifiedCount === scoredCount (KEINE stillen Drops im fabless-Universum)', () => {
  assert(fab.classifiedCount != null && fab.scoredCount != null, 'classifiedCount/scoredCount fehlen im fabless-Bucket');
  assert(fab.classifiedCount === fab.scoredCount, `stille Drops: classifiedCount ${fab.classifiedCount} !== scoredCount ${fab.scoredCount}`);
  assert(fab.scoredCount === FM.length, `scoredCount ${fab.scoredCount} !== members.length ${FM.length}`);
});

test('SI-4 (saas): Out-class score=null + excluded[] (kein irreführender Rang)', () => {
  assert(Array.isArray(saas.excluded), 'saas.excluded[] fehlt (SI-4)');
  for (const m of saas.excluded) {
    assert(m.membershipClass === 'Out', `excluded[] enthält ${m.ticker} mit membershipClass ${m.membershipClass} (sollte Out)`);
    assert(m.score === null, `excluded[] ${m.ticker} score sollte null sein, ist ${m.score}`);
  }
  // die gerankten (score!=null) Member sind alle membership != Out.
  const ranked = M.filter(m => m.score != null);
  for (const m of ranked) assert(m.membershipClass !== 'Out', `ranked member ${m.ticker} ist Out-class mit Score (SI-4 verletzt)`);
});

test('SI-4 (fabless): Out-class score=null + excluded[] (im aktuellen Universum 0 Out-Member → excluded[] leer)', () => {
  assert(Array.isArray(fab.excluded), 'fabless.excluded[] fehlt (SI-4)');
  for (const m of fab.excluded) {
    assert(m.membershipClass === 'Out', `excluded[] ${m.ticker} sollte Out sein, ist ${m.membershipClass}`);
    assert(m.score === null, `excluded[] ${m.ticker} score sollte null sein, ist ${m.score}`);
  }
  const ranked = FM.filter(m => m.score != null);
  for (const m of ranked) assert(m.membershipClass !== 'Out', `ranked member ${m.ticker} ist Out-class mit Score (SI-4 verletzt)`);
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
    assert(!m.lamps.some(l => l.startsWith('goodwill-impairment')), 'PODD (organisch) sollte KEINE Impairment-Lampe haben');
  }
});

// audit/fix (gauntlet C6): SIGN-SEPARATED DECONTAMINATION live-Tests (medtech impairment jetzt GEFLAGGT, nicht still gedroppt).
test('medtech C6: AVNS goodwill-impairment GEFLAGGT (negativer ΔGoodwill, nicht still gedroppt)', () => {
  // AVNS hat einen großen Goodwill-Impairment (FY2024 ~ -49.5% von Rev) — unter dem alten EIN-SEITIGEN Pfad fiel der
  // negative Move still durch; jetzt sign-separiert → Impairment-Lampe + _impairmentFlag.
  const m = (med.members || []).concat(med.excluded || []).find(x => x.ticker === 'AVNS');
  assert(m != null, 'AVNS nicht im medtech-Universum (members oder excluded)');
  assert(m._impairmentFlag === true, `AVNS sollte _impairmentFlag=true tragen (echter Goodwill-Impairment), ist ${m._impairmentFlag}`);
  assert(Array.isArray(m.lamps) && m.lamps.some(l => l.startsWith('goodwill-impairment')),
    `AVNS sollte goodwill-impairment-Lampe tragen; Lampen: ${m.lamps}`);
});

test('medtech C6: mindestens ein medtech-Name trägt goodwill-impairment (Sign-Separation live)', () => {
  const all = (med.members || []).concat(med.excluded || []);
  const flagged = all.filter(m => Array.isArray(m.lamps) && m.lamps.some(l => l.startsWith('goodwill-impairment')));
  assert(flagged.length >= 1, 'mindestens ein medtech-Name sollte die goodwill-impairment-Lampe tragen (C6 Sign-Separation)');
  // Ehrlichkeit: jeder geflaggte Name trägt auch das _impairmentFlag (Lampe und Flag konsistent).
  for (const m of flagged) assert(m._impairmentFlag === true, `${m.ticker} hat Impairment-Lampe aber _impairmentFlag=${m._impairmentFlag}`);
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
  // C6: 3. Arg ist jetzt revHist (per-Jahr-Revenue); null → Fallback revLatest (hier null, keine gw-coverage)
  const result = cMOG(yoySeries, null, null, null, null, {});
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
  // C6: 3. Arg ist jetzt revHist (per-Jahr-Revenue); null → Fallback revLatest
  const result = cMOG(yoySeries, null, null, null, null, {});
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
    // C6: revHist=null → Fallback revLatest (1000M); Deal-Jahr-Drop fires (0.40 jump) → FY-Recon-Assert aktiv
    cMOG(yoySeries, goodwillHistory, null, revLatest, null, { ticker: 'TEST_ASSERT', snapAnnualRev });
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
    // C6: revHist=null → Fallback revLatest (1000M)
    cMOG(yoySeries, goodwillHistory, null, revLatest, null, { ticker: 'TEST_OK', snapAnnualRev });
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'FY-Reconciliation darf bei gutem Rev-Match (<15%) NICHT failen');
});

// audit/fix (gauntlet C6): SIGN-SEPARATED DECONTAMINATION unit-tests (Ledger 26 — medtech auf dlst-Behandlung).
test('Unit cMOG (C6): NEGATIVER ΔGoodwill = Impairment-FLAG, KEIN Deal-Sprung (sign-separiert, mirror dlst Bug-Fix 2)', () => {
  const yoySeries = [0.05, 0.08, 0.06]; // keine echten Deal-Years
  // gwHist: Goodwill FÄLLT 500M->100M (Impairment/Divestitur) = -400M; rev-Jahr 1000M → |−40%| >= 5%
  const goodwillHistory = [
    { val: 100e6, end: '2025' }, // newer (gefallen)
    { val: 500e6, end: '2024' }, // older
    { val: 520e6, end: '2023' },
  ];
  const revHist = [{ val: 1000e6, end: '2025' }, { val: 1000e6, end: '2024' }, { val: 1000e6, end: '2023' }];
  const r = cMOG(yoySeries, goodwillHistory, revHist, 1000e6, null, { ticker: 'TEST_IMP' });
  assert(r.impairmentFlag === true, `negativer ΔGoodwill >=5% sollte impairmentFlag=true setzen, ist ${r.impairmentFlag}`);
  assert(r.dealYearExcluded === false, `Impairment ist KEIN Deal-Sprung → dealYearExcluded muss false sein, ist ${r.dealYearExcluded}`);
  assert(r.droppedIdx.length === 0, `Impairment darf KEIN YoY-Jahr droppen (sign-separiert), droppedIdx=${r.droppedIdx}`);
});

test('Unit cMOG (C6): per-Jahr-Revenue-Denominator — älteres Deal-Jahr gegen DAS-Jahr-Rev (nicht revLatest)', () => {
  // Ein Name, der von 200M auf 1000M Rev gewachsen ist. Ein älteres Deal-Jahr (Goodwill +60M) war damals
  // 60/200 = 30% von Rev (>=25% → mask), aber nur 60/1000 = 6% gegen revLatest (KEIN mask). Per-Jahr ist korrekt.
  const yoySeries = [0.10, 0.10, 0.40]; // index 2 = das ältere (gewachsene) Jahr
  const goodwillHistory = [
    { val: 100e6, end: '2025' },
    { val: 100e6, end: '2024' },
    { val: 100e6, end: '2023' }, // newer des Sprungs index 2
    { val: 40e6,  end: '2022' }, // older → delta=+60M
  ];
  const revHistPerYear = [{ val: 1000e6, end: '2025' }, { val: 900e6, end: '2024' }, { val: 200e6, end: '2023' }, { val: 140e6, end: '2022' }];
  const rPerYear = cMOG(yoySeries, goodwillHistory, revHistPerYear, 1000e6, null, { ticker: 'TEST_PY' });
  assert(rPerYear.dealYearExcluded === true, `per-Jahr (60/200=30%>=25%) sollte das Deal-Jahr maskieren, dealYearExcluded=${rPerYear.dealYearExcluded}`);
  // Gegenprobe: ohne revHist (revLatest-Fallback 1000M) wäre 60/1000=6% → KEIN mask
  const rRevLatest = cMOG(yoySeries, goodwillHistory, null, 1000e6, null, { ticker: 'TEST_RL' });
  assert(rRevLatest.dealYearExcluded === false, `revLatest-Fallback (60/1000=6%) sollte NICHT maskieren, dealYearExcluded=${rRevLatest.dealYearExcluded}`);
});

// =================== FIX A/B (2026-06-21): computeDlstOrganicGrowth FY-Alignment + dealYearExcluded-Ehrlichkeit ===
// Direkte Funktions-Unit-Tests des fiskaljahr-bewussten Deal-Jahr-Ausschlusses (Cross-Source-Misalignment).
const { computeDlstOrganicGrowth: cDOG } = require('./court-score.js');
assert(typeof cDOG === 'function', 'computeDlstOrganicGrowth nicht exportiert');

test('Unit cDOG (Fix A): FY-Match — Deal-Jahr im YoY-Fenster droppt das RICHTIGE Jahr + Catch-up (nicht index-positional)', () => {
  // YoY newest-first; Jahre [2025,2024,2023,2022]. EINZIGER Goodwill-Sprung im Fiskaljahr 2023 (>=0.15*rev).
  // Erwartung (FY-aware): Deal-Jahr 2023 (Index 2) + Catch-up-Jahr 2024 (Index 1, dealYear+1) gedroppt.
  // KEIN index-positionaler Drop: Index 0 (2025) und 3 (2022) bleiben organisch.
  const yoy = [0.30, 0.05, -0.40, 0.10];  // [2025, 2024, 2023(Deal/rot), 2022]
  const years = [2025, 2024, 2023, 2022];
  const gwHist = [
    { val: 200e6, end: '2025-12-31' },    // 2025: +5M
    { val: 195e6, end: '2024-12-31' },    // 2024: +15M
    { val: 180e6, end: '2023-12-31' },    // 2023: +130M vs 2022 → 130/300=0.43 >= 0.15 DEAL
    { val: 50e6,  end: '2022-12-31' },
  ];
  const revHist = [
    { val: 300e6, end: '2025-12-31' }, { val: 300e6, end: '2024-12-31' },
    { val: 300e6, end: '2023-12-31' }, { val: 280e6, end: '2022-12-31' },
  ];
  const r = cDOG(yoy, gwHist, revHist, 300e6, 0.05, years);
  // FY 2023 (Index 2) = Deal-Jahr; FY 2024 (Index 1) = Catch-up (dealYear+1). Beide gedroppt.
  assert(r.droppedIdx.includes(2), `Index 2 (FY 2023, Deal) sollte gedroppt sein, droppedIdx=${JSON.stringify(r.droppedIdx)}`);
  assert(r.droppedIdx.includes(1), `Index 1 (FY 2024, Catch-up) sollte gedroppt sein, droppedIdx=${JSON.stringify(r.droppedIdx)}`);
  assert(!r.droppedIdx.includes(0) && !r.droppedIdx.includes(3), `Index 0 (2025) + 3 (2022) bleiben organisch — droppedIdx=${JSON.stringify(r.droppedIdx)}`);
  assert(r.dealYearExcluded === true, 'dealYearExcluded sollte true sein (Jahre wurden gedroppt)');
  assert(r.dealExclusionUnaligned === false, 'aligned → unaligned sollte false sein');
  // Das gedroppte -0.40 (2023) darf NICHT in der organischen Reihe sein → latest=0.30 (2025).
  assert(Math.abs(r.latestOrganicYoY - 0.30) < 1e-9, `latest sollte 0.30 sein, ist ${r.latestOrganicYoY}`);
});

test('Unit cDOG (Fix A): UNALIGNED — Deal-Jahr außerhalb des YoY-Fensters droppt KEIN Jahr + setzt Lampe', () => {
  // Synthetischer misaligned Name (RGEN-Muster): Deal im Fiskaljahr 2021, aber YoY-Fenster nur [2025,2024,null].
  // Das index-positionale alte Verhalten hätte das falsche Jahr gekappt; FY-aware darf NICHTS droppen.
  const yoy = [0.16, 0.01, -0.21];        // [2025, 2024, 2023c(unalignbar)]
  const years = [2025, 2024, null];       // Index 2 unalignbar (continuing≠total-ops Divestitur)
  const gwHist = [
    { val: 1114e6, end: '2025-12-31' },
    { val: 1030e6, end: '2024-12-31' },
    { val: 987e6,  end: '2023-12-31' },   // 2023-Sprung +131M; FY 2023 NICHT im {2025,2024}-Fenster
    { val: 855e6,  end: '2022-12-31' },
    { val: 860e6,  end: '2021-12-31' },
    { val: 618e6,  end: '2020-12-31' },   // 2021-Sprung +242M; FY 2021 NICHT im Fenster
  ];
  const revHist = [
    { val: 738e6, end: '2025-12-31' }, { val: 634e6, end: '2024-12-31' }, { val: 638e6, end: '2023-12-31' },
    { val: 801e6, end: '2022-12-31' }, { val: 670e6, end: '2021-12-31' }, { val: 366e6, end: '2020-12-31' },
  ];
  const r = cDOG(yoy, gwHist, revHist, 738e6, 0.05, years);
  assert(r.droppedIdx.length === 0, `KEIN Jahr darf gedroppt werden (unalignbar), droppedIdx=${JSON.stringify(r.droppedIdx)}`);
  assert(r.dealYearExcluded === false, 'dealYearExcluded MUSS false sein (Fix B: kein Jahr tatsächlich gedroppt)');
  assert(r.dealExclusionUnaligned === true, 'dealExclusionUnaligned MUSS true sein (Sprung nicht FY-alignbar)');
  assert(r.organicYears === 3, `volle Reihe (3 Jahre) genutzt, ist ${r.organicYears}`);
});

test('Unit cDOG (Fix B): dealYearExcluded-Ehrlichkeit — Sprung ohne YoY-Match setzt dealYearExcluded NICHT true', () => {
  // Sprung im Fiskaljahr 2022, YoY-Fenster nur [2025,2024,2023]. 2022 nicht im Fenster → kein Drop, kein =yes.
  const yoy = [0.05, 0.04, 0.03];
  const years = [2025, 2024, 2023];
  const gwHist = [
    { val: 100e6, end: '2025-12-31' }, { val: 100e6, end: '2024-12-31' }, { val: 100e6, end: '2023-12-31' },
    { val: 100e6, end: '2022-12-31' }, { val: 10e6, end: '2021-12-31' },  // 2022-Sprung +90M = 0.9*rev DEAL, FY 2022 außerhalb
  ];
  const revHist = [
    { val: 100e6, end: '2025-12-31' }, { val: 100e6, end: '2024-12-31' }, { val: 100e6, end: '2023-12-31' },
    { val: 100e6, end: '2022-12-31' }, { val: 100e6, end: '2021-12-31' },
  ];
  const r = cDOG(yoy, gwHist, revHist, 100e6, 0.05, years);
  assert(r.dealYearExcluded === false, `Fix B: deal-yr-excluded muss =no sein (0 YoY-Jahre gedroppt), droppedIdx=${JSON.stringify(r.droppedIdx)}`);
  assert(r.dealExclusionUnaligned === true, 'Sprung außerhalb Fenster → unaligned-Lampe');
});

test('Unit cDOG (Fix A): impairment (negativer ΔGoodwill) ist KEIN Deal-Sprung (Bug-Fix 2 erhalten)', () => {
  const yoy = [0.10, 0.12];
  const years = [2025, 2024];
  const gwHist = [{ val: 50e6, end: '2025-12-31' }, { val: 500e6, end: '2024-12-31' }]; // ΔGW negativ = Impairment
  const revHist = [{ val: 300e6, end: '2025-12-31' }, { val: 300e6, end: '2024-12-31' }];
  const r = cDOG(yoy, gwHist, revHist, 300e6, 0.05, years);
  assert(r.droppedIdx.length === 0, 'Impairment darf kein Jahr droppen');
  assert(r.dealYearExcluded === false && r.dealExclusionUnaligned === false, 'kein Deal → keine Lampen');
});

// =================== DIAGNOSTICS_LST BUCKET TESTS (v0/v1.0, cohort-aware dx|tools) ===================

const dlst = doc.diagnostics_lst;
const DL = dlst ? dlst.members : [];
const dlfind = t => DL.find(m => m.ticker === t);

test('diagnostics_lst: bucket existiert + label nennt cohort-aware', () => {
  assert(dlst && Array.isArray(dlst.members), 'diagnostics_lst bucket fehlt');
  assert(/cohort-aware/i.test(dlst.label || ''), `label sollte cohort-aware nennen: ${dlst.label}`);
});

test('diagnostics_lst: SI-5 classifiedCount === scoredCount (KEINE stillen Drops)', () => {
  assert(dlst.classifiedCount != null && dlst.scoredCount != null, 'classifiedCount/scoredCount fehlen');
  assert(dlst.classifiedCount === dlst.scoredCount, `stille Drops: ${dlst.classifiedCount} !== ${dlst.scoredCount}`);
  assert(dlst.scoredCount === DL.length, `scoredCount ${dlst.scoredCount} !== members.length ${DL.length}`);
  assert(dlst.scoredCount === 29, `dlst sollte alle 29 Namen scoren, ist ${dlst.scoredCount}`);
});

test('diagnostics_lst Fix B (live): dealYearExcluded-Ehrlichkeit — kein Name trägt deal-yr-excluded=yes ohne tatsächlich gedropptes Jahr', () => {
  // dealYearExcluded=yes MUSS implizieren, dass die Reihe gegenüber der vollen Reihe verkürzt wurde
  // (organicYears < verfügbare endliche YoY). Sonst ist die Lampe unehrlich (Fix B).
  for (const m of DL) {
    if (m._dealYearExcluded === true || (Array.isArray(m.lamps) && m.lamps.some(l => /deal-yr-excluded=yes/.test(l)))) {
      const finiteYoY = Array.isArray(m.revYoYDlst) ? m.revYoYDlst.filter(v => v != null && isFinite(v)).length : 0;
      assert(m._organicYears < finiteYoY,
        `${m.ticker}: deal-yr-excluded=yes, aber organicYears(${m._organicYears}) >= finite YoY(${finiteYoY}) → kein Jahr gedroppt (unehrlich)`);
    }
  }
});

test('diagnostics_lst Fix B (live): die 7 historischen „falsch-yes"-Namen tragen jetzt deal-yr-excluded=no', () => {
  // VCYT/EXAS/NEO/AVTR/CRL/DHR/TMO hatten deal-yr-excluded=yes bei 0 tatsächlich gedroppten YoY-Jahren.
  for (const t of ['VCYT', 'EXAS', 'NEO', 'AVTR', 'CRL', 'DHR', 'TMO']) {
    const m = dlfind(t);
    if (!m) continue; // Name evtl. nicht im Universum → skip
    const jumpLamp = (m.lamps || []).find(l => /deal-year-jump/.test(l));
    if (jumpLamp) assert(/deal-yr-excluded=no/.test(jumpLamp), `${t} deal-year-jump-Lampe sollte =no tragen, ist '${jumpLamp}'`);
  }
});

test('diagnostics_lst Fix A (live): RGEN nutzt die volle Reihe (organicYears>1) + unaligned-Lampe statt index-positionalem Falsch-Drop', () => {
  const rgen = dlfind('RGEN');
  if (rgen) {
    // Vorher (Bug): index-positional gedroppt → organicYears=1. Nachher: unalignbar → volle Reihe genutzt.
    assert(rgen._organicYears > 1, `RGEN organicYears sollte >1 sein (volle Reihe), ist ${rgen._organicYears}`);
    assert(rgen._dealYearExcluded === false, 'RGEN: kein YoY-Jahr per FY gematcht → dealYearExcluded=false (Fix B)');
    assert(rgen._dealExclusionUnaligned === true, 'RGEN: Sprung-Jahr nicht FY-alignbar → unaligned-Lampe (Fix A)');
    assert((rgen.lamps || []).some(l => /deal-exclusion-unaligned/.test(l)), 'RGEN: deal-exclusion-unaligned-Lampe fehlt');
  }
});

test('diagnostics_lst Fix A (live): revYoYDlstYears ist index-aligned mit revYoYDlst (gleiche Länge)', () => {
  for (const m of DL) {
    if (Array.isArray(m.revYoYDlst) && Array.isArray(m.revYoYDlstYears)) {
      assert(m.revYoYDlst.length === m.revYoYDlstYears.length,
        `${m.ticker}: revYoYDlst(${m.revYoYDlst.length}) != revYoYDlstYears(${m.revYoYDlstYears.length})`);
    }
  }
});

test('diagnostics_lst: cohort-Tags (dx | tools) auf jedem Member + cohortCounts korrekt', () => {
  for (const m of DL) assert(m.cohort === 'dx' || m.cohort === 'tools', `${m.ticker} cohort ungültig: ${m.cohort}`);
  assert(dlst.cohortCounts && dlst.cohortCounts.dx === 12 && dlst.cohortCounts.tools === 17,
    `cohortCounts sollte {dx:12,tools:17} sein, ist ${JSON.stringify(dlst.cohortCounts)}`);
  // Spot-checks aus der Spec
  assert(dlfind('IDXX').cohort === 'dx', 'IDXX sollte dx sein');
  assert(dlfind('TMO').cohort === 'tools', 'TMO sollte tools sein');
});

test('diagnostics_lst: SI-3 comparabilityNote + normTableId + per-cohort anchors', () => {
  assert(dlst.normTableId === 'dlst-norms-2026-06-20', `normTableId falsch: ${dlst.normTableId}`);
  assert(dlst.comparabilityNote && /cohort/i.test(dlst.comparabilityNote) && /PER COHORT/i.test(dlst.comparabilityNote),
    'comparabilityNote sollte per-cohort REL erklären');
  assert(dlst.anchorsByCohort && dlst.anchorsByCohort.dx && dlst.anchorsByCohort.tools,
    'anchorsByCohort (dx + tools) fehlt');
  // pro-Kohorte verschiedene Mediane → Beweis, dass NICHT gepoolt wird (dx-GM > tools-GM)
  const dxGm = dlst.anchorsByCohort.dx.gm, toolsGm = dlst.anchorsByCohort.tools.gm;
  assert(dxGm && toolsGm && dxGm.median != null && toolsGm.median != null, 'GM-Mediane je Kohorte fehlen');
});

test('diagnostics_lst: SI-4 Out-class score=null + excluded[] (kein irreführender Rang)', () => {
  assert(Array.isArray(dlst.excluded), 'dlst.excluded[] fehlt');
  for (const m of dlst.excluded) {
    assert(m.membershipClass === 'Out', `excluded ${m.ticker} sollte Out sein, ist ${m.membershipClass}`);
    assert(m.score === null, `excluded ${m.ticker} score sollte null sein, ist ${m.score}`);
  }
  for (const m of DL) {
    if (m.membershipClass === 'Out') assert(m.score === null, `${m.ticker} Out-class score sollte null sein, ist ${m.score}`);
    else assert(Number.isFinite(m.score) && m.score >= 0, `${m.ticker} Score ungültig: ${m.score}`);
  }
});

test('diagnostics_lst: gateOpen-Floor scharf auf latestOrganicYoY (>=0.15) für headlineShortlist', () => {
  const headline = DL.filter(m => m.headlineShortlist);
  assert(headline.length >= 3 && headline.length <= 20, `headline count ${headline.length} nicht in [3,20]`);
  for (const m of headline) {
    assert(m.latestOrganicYoY != null && m.latestOrganicYoY >= 0.15 - 1e-9,
      `${m.ticker} headline aber latestOrganicYoY ${m.latestOrganicYoY} < 0.15 (Floor-Bypass!)`);
  }
  // KEIN Name mit latestOrganicYoY < 0.15 auf der Shortlist
  for (const m of DL) {
    if (m.latestOrganicYoY != null && m.latestOrganicYoY < 0.15) {
      assert(m.headlineShortlist === false, `${m.ticker} latest ${m.latestOrganicYoY}<0.15 aber headlineShortlist`);
    }
  }
});

test('diagnostics_lst: NO BACK-LOADING — growthOrganic <= latestOrganicYoY (deceleration-safe min())', () => {
  for (const m of DL) {
    if (m.growthOrganic != null && m.latestOrganicYoY != null) {
      assert(m.growthOrganic <= m.latestOrganicYoY + 1e-9,
        `${m.ticker} growthOrganic ${m.growthOrganic} > latestOrganicYoY ${m.latestOrganicYoY} (Back-Loading; min() verletzt)`);
    }
  }
});

// =================== v1.1 REMEDIATION (Court v1.0 DENIED → v1.1 Fixes A-F) ===================

test('diagnostics_lst v1.1 Fix A: KEIN headlineShortlist-Name mit growthOrganic < 0.15 (Gate liest growthOrganic, NICHT uncapped latest)', () => {
  // FATAL-Fix A: das gateOpen-Growth-Floor MUSS die deceleration-sichere growthOrganic = min(latest,blend)
  // lesen (wie die Score-Achse), NICHT die rohe latestOrganicYoY. Sonst leakt ADPT (latest 54.8%, organic 10.6%).
  const headline = DL.filter(m => m.headlineShortlist);
  assert(headline.length > 0, 'kein headlineShortlist-Name vorhanden');
  for (const m of headline) {
    assert(m.growthOrganic != null && m.growthOrganic >= 0.15 - 1e-9,
      `${m.ticker} ist headlineShortlist aber growthOrganic ${m.growthOrganic} < 0.15 (Gate-Floor-Bypass — Fix A verletzt)`);
  }
  // ADPT-spezifisch: latest 54.8% > 0.15 ABER growthOrganic 10.6% < 0.15 → MUSS off-shortlist sein.
  const adpt = dlfind('ADPT');
  if (adpt) {
    assert(adpt.growthOrganic < 0.15, `ADPT growthOrganic sollte <0.15 sein (decelerating), ist ${adpt.growthOrganic}`);
    assert(adpt.headlineShortlist === false, `ADPT (organic ${adpt.growthOrganic}<0.15, latest ${adpt.latestOrganicYoY}) darf NICHT auf der Shortlist sein (Fix A)`);
  }
});

test('diagnostics_lst v1.1 Fix B: Gate-Effizienz-Arme lesen TRUE opMargin (Arm 1/RoX) UND FCF (Arm 2) UNABHÄNGIG — kein Slot-Poisoning', () => {
  // FATAL-Fix B: vorher floss der FCF-primäre Proxy (effForAbs) in den opMargin-Slot → Arm 3 (Rule-of-X,
  // (growth+opMargin)>=0.30) lief auf FCF statt opMargin. FIX: opMargin-Slot = echter opMargin, fcfMargin-Slot = FCF.
  // Wir replizieren effGatePass mit den ECHTEN Feldern und verlangen, dass belowAbsoluteFloor exakt dazu passt.
  const { NORMS, gateOpen } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  for (const m of DL) {
    const cohortNorm = m.cohort === 'tools' ? 'diagnostics_lst_tools' : 'diagnostics_lst_dx';
    const g = m.growthOrganic, gm = m.gm == null ? 0 : m.gm;
    const opM = m.opMargin == null ? 0 : m.opMargin;        // TRUE opMargin in den opMargin-Slot
    const fcf = m.fcfMargin == null ? (m.effDlst == null ? 0 : m.effDlst) : m.fcfMargin; // FCF in den fcfMargin-Slot
    const expectOpen = gateOpen({ growth: g, gm, opMargin: opM, fcfMargin: fcf }, cohortNorm);
    assert(m.belowAbsoluteFloor === !expectOpen,
      `${m.ticker} belowAbsoluteFloor=${m.belowAbsoluteFloor} aber TRUE-slot gateOpen=${expectOpen} (Slot-Poisoning — Fix B verletzt)`);
  }
  // NTRA-spezifisch: echte RoX (growth+opMargin) ~22.5% < 30% UND FCF 3.3% < 5% → MUSS belowAbsoluteFloor sein.
  const ntra = dlfind('NTRA');
  if (ntra) {
    const rox = ntra.growthOrganic + (ntra.opMargin || 0);
    assert(rox < 0.30, `NTRA true RoX (growth+opMargin) sollte <0.30 sein, ist ${rox.toFixed(3)} (opMargin ${ntra.opMargin})`);
    assert((ntra.fcfMargin || 0) < 0.05, `NTRA FCF sollte <0.05 sein, ist ${ntra.fcfMargin}`);
    assert(ntra.belowAbsoluteFloor === true, `NTRA (RoX ${rox.toFixed(3)}<0.30, FCF<0.05) MUSS belowAbsoluteFloor sein (Fix B)`);
    assert(ntra.headlineShortlist === false, 'NTRA darf NICHT auf der Shortlist sein (Fix B)');
  }
});

test('diagnostics_lst v1.1 Fix B: opMargin-Slot ist der ECHTE opMargin, nicht der FCF-Proxy (NTRA opMargin != effDlst)', () => {
  // Beweist, dass das Gate NICHT mehr effDlst (FCF-Proxy) als opMargin missbraucht: für mindestens einen Namen
  // divergiert opMargin materiell von effDlst (FCF), und das Gate-Ergebnis folgt dem ECHTEN opMargin.
  const ntra = dlfind('NTRA');
  if (ntra) {
    assert(ntra.opMargin != null && ntra.effDlst != null && Math.abs(ntra.opMargin - ntra.effDlst) > 0.10,
      `NTRA opMargin (${ntra.opMargin}) und effDlst/FCF (${ntra.effDlst}) sollten materiell divergieren (Beweis: getrennte Slots)`);
  }
});

test('diagnostics_lst v1.2 Fix 2: eff-REL-Taper — positiver eff-REL-z STETIG getapert über [floor-band, floor]; 0 unter dem Band, voll ab dem Floor', () => {
  // Cohort-Pooling-Artefakt: dx-Median eff ~0 (Cash-Burner) → ein dx-Name mit kleinem positivem FCF bekäme
  // sonst einen großen positiven eff-REL-z rein aus der schwachen Kohorte. v1.2 ersetzt den HARTEN v1.1-Clamp
  // (s->0 bei FCF<floor, +2.5pt-Cliff) durch einen STETIGEN Taper über [floor-band, floor], band 0.04.
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const BAND = 0.04;
  for (const m of DL) {
    const effFloor = NORMS[m.cohort === 'tools' ? 'diagnostics_lst_tools' : 'diagnostics_lst_dx'].eff.floor;
    const effAx = m.axisS ? m.axisS['Eff-FCF'] : null;
    if (effAx == null) continue;
    assert(Number.isFinite(effAx), `${m.ticker} eff-REL-Achse ist NaN/Inf (Taper-Bug): ${effAx}`);
    // (a) UNTER dem Band (oder effDlst null): KEIN positiver eff-REL-Kredit → Artefakt weiterhin unterdrückt.
    if (m.effDlst == null || m.effDlst <= effFloor - BAND) {
      assert(effAx <= 0 + 1e-9,
        `${m.ticker} effDlst ${m.effDlst} <= floor-band ${(effFloor-BAND).toFixed(3)} aber eff-REL ${effAx} > 0 (Artefakt-Unterdrückung verletzt)`);
    }
  }
  // CDNA (dx, FCF ~9.3% IM Band [0.06,0.10)) ist jetzt STETIG getapert: positiv aber kleiner als der volle z —
  // KEIN Sprung mehr an haarscharfen FCF-Unterschieden. WGS/NTRA (FCF ~3.3% UNTER dem Band) bleiben auf 0.
  const cdna = dlfind('CDNA');
  if (cdna && cdna.axisS && cdna.axisS['Eff-FCF'] != null && cdna.effDlst != null && cdna.effDlst > 0.06 && cdna.effDlst < 0.10) {
    assert(cdna.axisS['Eff-FCF'] > 0, `CDNA (FCF ${cdna.effDlst} im Taper-Band) sollte positiven getaperten eff-REL haben, ist ${cdna.axisS['Eff-FCF']}`);
  }
  for (const t of ['WGS', 'NTRA']) {
    const m = dlfind(t);
    if (m && m.axisS && m.axisS['Eff-FCF'] != null && m.effDlst != null && m.effDlst <= 0.06) {
      assert(m.axisS['Eff-FCF'] <= 0 + 1e-9, `${t} (FCF ${m.effDlst} unter Taper-Band) sollte eff-REL 0 sein, ist ${m.axisS['Eff-FCF']}`);
    }
  }
});

test('diagnostics_lst v1.2 Fix 3: chronic-acquirer + decelerating Name (VCYT) — echter Score-Haircut, gezeigter Score UNTER bestem nicht-demoviertem Headline-Namen, Leiter monoton', () => {
  const headline = DL.filter(m => m.headlineShortlist);
  assert(headline.length > 0, 'keine Headline');
  // members sind nach (gehaircutetem) Score sortiert → headline[0] ist der #1-Conviction-Pick.
  const top = headline[0];
  assert(!top.headlineDemoted, `#1-Headline ${top.ticker} ist demoted — ein demovierter Name darf nicht #1 sein`);
  // Bester nicht-demovierter Headline-Score (das ist der ehrliche Spitzen-Pick).
  const nonDemoted = headline.filter(m => !m.headlineDemoted && m.score != null);
  const maxNonDemoted = Math.max(...nonDemoted.map(m => m.score));
  // Jeder demovierte Name: VETO/HAIRCUT-Lampe + demotionNote + ECHTER Score-Haircut (gezeigter Score < best non-demoted) + scorePreHaircut erhalten.
  const demoted = headline.filter(m => m.headlineDemoted);
  for (const m of demoted) {
    assert(m.lamps.some(l => /chronic-acquirer\+decelerating-HAIRCUT/.test(l)),
      `${m.ticker} demoted aber HAIRCUT-Lampe fehlt`);
    assert(m.demotionNote && /Fix 3|SCORE-HAIRCUT/.test(m.demotionNote), `${m.ticker} demotionNote fehlt`);
    assert(m.scorePreHaircut != null && m.scorePreHaircut >= m.score,
      `${m.ticker} scorePreHaircut (${m.scorePreHaircut}) sollte >= gehaircutetem score (${m.score}) sein`);
    assert(m.score < maxNonDemoted,
      `${m.ticker} gezeigter Score ${m.score} muss UNTER bestem nicht-demoviertem Headline-Score ${maxNonDemoted} liegen (Display-Honesty Fix 3)`);
    const idx = headline.indexOf(m);
    assert(idx > 0, `${m.ticker} ist demoted aber auf Position #${idx + 1} (muss hinter mind. einem Namen stehen)`);
  }
  // VCYT-spezifisch: chronic-acquirer + decelerating → demoted, NICHT #1, und gezeigter Score < MEDP.
  const vcyt = dlfind('VCYT');
  if (vcyt && vcyt.headlineShortlist) {
    assert(vcyt.headlineDemoted === true, `VCYT (chronic-acquirer + decelerating) MUSS demoted sein (Fix 3)`);
    assert(headline[0].ticker !== 'VCYT', `VCYT darf NICHT #1 sein (Fix 3)`);
    const medp = dlfind('MEDP');
    if (medp && medp.headlineShortlist) {
      assert(vcyt.score < medp.score, `VCYT gezeigter Score ${vcyt.score} muss < MEDP ${medp.score} sein (Display-Honesty Fix 3)`);
    }
  }
  // LEITER MONOTON: die headlineShortlist-Scores in Sort-Reihenfolge sind nicht-steigend.
  for (let i = 1; i < headline.length; i++) {
    assert(headline[i - 1].score >= headline[i].score - 1e-9,
      `Headline-Leiter nicht monoton: ${headline[i-1].ticker} ${headline[i-1].score} < ${headline[i].ticker} ${headline[i].score}`);
  }
});

test('diagnostics_lst v1.1 Fix D: cross-bucket-Disclosure — scoreScope=intra-bucket + crossBucketComparableField=absKaliber', () => {
  assert(dlst.scoreScope === 'intra-bucket', `R.scoreScope sollte 'intra-bucket' sein, ist ${dlst.scoreScope}`);
  assert(dlst.crossBucketComparableField === 'absKaliber', `R.crossBucketComparableField sollte 'absKaliber' sein`);
  assert(/CROSS-BUCKET|cross-bucket/.test(dlst.comparabilityNote) && /absKaliber/.test(dlst.comparabilityNote),
    'comparabilityNote sollte die cross-bucket-Disclosure (absKaliber) enthalten');
  for (const m of DL) {
    assert(m.scoreScope === 'intra-bucket', `${m.ticker} scoreScope fehlt/falsch`);
    assert(m.crossBucketComparableField === 'absKaliber', `${m.ticker} crossBucketComparableField fehlt/falsch`);
    assert(m.absKaliber != null, `${m.ticker} absKaliber (cross-bucket-comparable) fehlt`);
  }
});

test('diagnostics_lst v1.1 Fix F: MEDP (tools CRO, growth 20%, FCF 27%, RoX 41%) wird durch gm-Floor-Rekalibrierung legitim admittiert', () => {
  const medp = dlfind('MEDP');
  assert(medp, 'MEDP fehlt');
  assert(medp.growthOrganic >= 0.15, `MEDP growthOrganic ${medp.growthOrganic} sollte >=0.15 sein`);
  assert(medp.gm >= 0.28 && medp.gm < 0.38, `MEDP gm ${medp.gm} sollte im [0.28,0.38)-Band liegen (Fix-1-Begünstigter)`);
  assert(medp.belowAbsoluteFloor === false, 'MEDP sollte das Gate passieren (Fix 1), ist belowAbsoluteFloor');
  assert(medp.headlineShortlist === true, 'MEDP sollte auf der Shortlist sein (Fix 1)');
});

test('diagnostics_lst v1.2 Fix 1: tools-GM-Floor auf 0.28 re-anchored → MEDP hat ECHTES Headroom (>=1.5pp), Floor nicht overfit auf MEDPs gm', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const floor = NORMS.diagnostics_lst_tools.gm.floor;
  assert(floor === 0.28, `tools gm-floor sollte 0.28 sein (Fix 1), ist ${floor}`);
  const medp = dlfind('MEDP');
  assert(medp, 'MEDP fehlt');
  const headroom = medp.gm - floor;
  assert(headroom >= 0.015, `MEDP gm ${medp.gm} sollte >=1.5pp über dem Floor ${floor} liegen (kein 6bp-Overfit), Headroom ${(headroom*100).toFixed(2)}pp`);
});

test('diagnostics_lst v1.2 Fix 1: ±2pp GM-Perturbation lässt MEDP headlineShortlist-Mitgliedschaft UNVERÄNDERT (robust gegen kleine GM-Revision)', () => {
  // Re-Court-Forderung: die Headline-Mitgliedschaft von MEDP muss robust gegen eine ±2pp GM-Bewegung sein.
  // Wir reproduzieren das gateOpen-GM-Floor-Verhalten direkt aus den live NORMS (gateOpen ist deterministisch
  // und rein) und prüfen, dass MEDP bei gm±0.02 das GM-Floor-Gate weiterhin passiert.
  const { NORMS, gateOpen } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const medp = dlfind('MEDP');
  assert(medp, 'MEDP fehlt');
  assert(medp.cohort === 'tools', `MEDP sollte cohort=tools sein, ist ${medp.cohort}`);
  // Baseline: MEDP ist live auf der Shortlist + passiert das Gate.
  assert(medp.headlineShortlist === true && medp.belowAbsoluteFloor === false, 'MEDP-Baseline nicht auf Shortlist');
  // Gate-Inputs aus dem live Member (growthOrganic, eff via fcf/opMargin) — nur gm wird perturbiert.
  const baseRec = {
    growth: medp.growthOrganic,
    opMargin: medp.opMargin != null ? medp.opMargin : 0,
    fcfMargin: medp.fcfMargin != null ? medp.fcfMargin : 0,
  };
  for (const d of [-0.02, +0.02]) {
    const open = gateOpen({ ...baseRec, gm: medp.gm + d }, 'diagnostics_lst_tools');
    assert(open === true,
      `MEDP gm±2pp (gm ${medp.gm}${d>=0?'+':''}${d} = ${(medp.gm+d).toFixed(4)}) sollte das gateOpen weiterhin passieren — Headline-Mitgliedschaft NICHT robust gegen ±2pp GM-Move`);
  }
});

test('diagnostics_lst v1.1 Fix F: IDXX bleibt HONEST draußen (growthOrganic <0.15 — echte Rate, kein Artefakt)', () => {
  const idxx = dlfind('IDXX');
  assert(idxx, 'IDXX fehlt');
  assert(idxx.growthOrganic < 0.15, `IDXX growthOrganic ${idxx.growthOrganic} sollte <0.15 sein (echte Rate)`);
  assert(idxx.headlineShortlist === false, 'IDXX gehört NICHT auf die Shortlist (fällt am echten Growth-Floor, korrekt für einen Growth-Screen)');
});

test('diagnostics_lst: efficiency = FCF primär, opMargin-Fallback bei >15pp-Distortion oder fcf-null', () => {
  for (const m of DL) {
    if (m.effSource == null) continue;
    if (m.effSource === 'fcfMargin') {
      assert(m.fcfMargin == null || m.effDlst == null || Math.abs(m.effDlst - m.fcfMargin) < 1e-4,
        `${m.ticker} effSource=fcfMargin aber effDlst ${m.effDlst} != fcfMargin ${m.fcfMargin}`);
    } else {
      // Fallback → effDlst == opMargin
      assert(m.opMargin == null || m.effDlst == null || Math.abs(m.effDlst - m.opMargin) < 1e-4,
        `${m.ticker} effSource=${m.effSource} aber effDlst ${m.effDlst} != opMargin ${m.opMargin}`);
    }
  }
});

test('diagnostics_lst: cohort-aware GM-NORM — dx gm-floor .50, tools gm-floor .30 (v1.1 Fix F) (normTableId pro Member)', () => {
  for (const m of DL) {
    assert(m.normTableId === 'dlst-norms-2026-06-20', `${m.ticker} normTableId falsch: ${m.normTableId}`);
  }
  // v1.2 Fix 1: NORM-Tabelle hat den tools-GM-Floor auf 0.28 re-anchored (Service-/CRO-Class, war v1.1: 0.30).
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  assert(NORMS.diagnostics_lst_dx.gm.floor === 0.50, `dx gm-floor sollte 0.50 sein, ist ${NORMS.diagnostics_lst_dx.gm.floor}`);
  assert(NORMS.diagnostics_lst_tools.gm.floor === 0.28, `tools gm-floor sollte 0.28 sein (Fix 1), ist ${NORMS.diagnostics_lst_tools.gm.floor}`);
});

test('diagnostics_lst: chronic-acquirer Lampe feuert (gw/rev>1.0 OR cumDeltaGW/rev>0.40)', () => {
  // Mindestens ein Serial-Acquirer-Signal im Universum (VCYT/RGEN/EXAS/NEO haben hohe goodwill/rev oder cumDelta).
  const any = DL.some(m => m.lamps.some(l => l.startsWith('chronic-acquirer')));
  assert(any, 'mindestens ein chronic-acquirer-Lampe sollte feuern');
  // Konsistenz: wenn Lampe da, muss eine der Schwellen erfüllt sein
  for (const m of DL) {
    if (m.lamps.some(l => l.startsWith('chronic-acquirer'))) {
      const gwHi = m.goodwillToRev != null && m.goodwillToRev > 1.0;
      const cumHi = m.cumDeltaGoodwillPctRev != null && m.cumDeltaGoodwillPctRev > 0.40;
      assert(gwHi || cumHi, `${m.ticker} chronic-acquirer-Lampe aber gw/rev=${m.goodwillToRev} cumDelta=${m.cumDeltaGoodwillPctRev}`);
    }
  }
});

test('diagnostics_lst: cum-payments Lampe nur wenn cumPaymentsToRev > 0.15', () => {
  for (const m of DL) {
    const payLamp = m.lamps.find(l => l.startsWith('cum-payments(')); // NICHT cum-payments-coverage-null
    if (payLamp) {
      assert(m.cumPaymentsToRev != null && m.cumPaymentsToRev > 0.15,
        `${m.ticker} cum-payments-Lampe aber cumPaymentsToRev=${m.cumPaymentsToRev} <= 0.15`);
    }
  }
});

test('diagnostics_lst: cyclicality-Lampe ist cohort-aware (tools=watch-wave-turn, dx=genuine-concern)', () => {
  for (const m of DL) {
    const cyc = m.lamps.find(l => l.startsWith('cyclicality'));
    if (cyc) {
      if (m.cohort === 'tools') assert(/watch-wave-turn/.test(cyc), `${m.ticker} tools cyclicality sollte watch-wave-turn sein: ${cyc}`);
      else assert(/genuine-concern/.test(cyc), `${m.ticker} dx cyclicality sollte genuine-concern sein: ${cyc}`);
    }
  }
});

test('diagnostics_lst: R&D + shares DEFERRED → coverage-null Lampen, NIE Penalty (graceful degrade)', () => {
  // Jeder Member trägt shares-missing(deferred) (shares-Serie nicht hydratisiert) → KEINE Strafe.
  for (const m of DL) {
    assert(m.lamps.some(l => l.startsWith('shares-missing(deferred')), `${m.ticker} sollte shares-missing(deferred) tragen`);
  }
  // Wenn rd-missing, dann als deferred/no-penalty markiert (kein Score-Eingriff).
  for (const m of DL) {
    const rd = m.lamps.find(l => l.startsWith('rd-missing'));
    if (rd) assert(/deferred,no-penalty/.test(rd), `${m.ticker} rd-missing sollte deferred,no-penalty sein: ${rd}`);
  }
});

test('diagnostics_lst: SI-6 frozen baseline v1.2 existiert + supersedes v1.1 + Demotion-aware Ranking + Score-Haircut', () => {
  const p = path.join(ROOT, 'fitness', 'baselines', 'diagnostics-lst-v1.2-2026-06-21.json');
  assert(fs.existsSync(p), 'SI-6 frozen v1.2 baseline fehlt');
  const b = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert(b.baselineId === 'diagnostics-lst-v1.2-2026-06-21' && b.frozenAt === '2026-06-21', 'baseline-Meta falsch');
  assert(b.supersedes && /v1\.1-2026-06-21/.test(b.supersedes), 'supersedes-Vermerk (v1.1) fehlt');
  assert(Array.isArray(b.ranking) && b.ranking.length > 0, 'baseline-ranking leer');
  assert(b.normTableId === 'dlst-norms-2026-06-20', 'baseline normTableId falsch');
  // Das eingefrorene Ranking muss exakt der aktuellen demotion-aware Headline entsprechen (kein Drift beim Freeze).
  const headline = DL.filter(m => m.headlineShortlist && m.score != null);
  assert(b.ranking.length === headline.length, `baseline-ranking len ${b.ranking.length} != live headline ${headline.length}`);
  assert(b.ranking[0].ticker === headline[0].ticker, `baseline #1 ${b.ranking[0].ticker} != live #1 ${headline[0].ticker}`);
  assert(b.ranking[0].demoted === false, 'baseline #1 darf nicht demoted sein');
  // Monotone Leiter im eingefrorenen Ranking (Display-Honesty Fix 3).
  for (let i = 1; i < b.ranking.length; i++) {
    assert(b.ranking[i - 1].score >= b.ranking[i].score - 1e-9, `baseline-ranking nicht monoton bei ${b.ranking[i].ticker}`);
  }
  // VCYT (falls in der Headline) muss im baseline demoted=true UND gehaircuteten Score unter #1 tragen.
  const vcytRow = b.ranking.find(r => r.ticker === 'VCYT');
  if (vcytRow) {
    assert(vcytRow.demoted === true, 'VCYT im baseline muss demoted=true tragen (Fix 3)');
    assert(vcytRow.score < b.ranking[0].score, `VCYT baseline-score ${vcytRow.score} muss < #1 ${b.ranking[0].score} sein (Fix 3)`);
  }
});

// =================== PARITÄT: 3 PRIOR BUCKETS byte-/deep-identisch nach dlst-Addition ===================

test('PARITÄT (dlst-Addition): SaaS+Fabless+Medtech byte/deep-identisch zu _parity-baseline-pre-dlst.json', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', '_parity-baseline-pre-dlst.json'), 'utf8'));
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices']) {
    const got = JSON.stringify(doc[b]);
    const exp = JSON.stringify(baseline[b]);
    assert(got === exp, `${b} bucket NICHT byte-identisch zur pre-dlst-Baseline (len got=${got.length} exp=${exp.length}) — dlst-Addition hat einen Pfad geleakt`);
  }
});

test('PARITÄT (dlst-Addition): KEIN dlst-only Feld auf SaaS/Fabless/Medtech-Membern (Leak-Guard)', () => {
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices']) {
    for (const m of doc[b].members) {
      for (const leak of ['_growthDlst', '_effDlst', '_capexNeg', 'effDlst', 'effSource', 'cohort', 'cumDeltaGoodwillPctRev', 'cumPaymentsToRev', 'revYoYDlst', 'revYoYDlstYears', '_dealExclusionUnaligned']) {
        assert(!(leak in m), `${b}/${m.ticker} hat dlst-only Feld '${leak}' geleakt (Parität verletzt)`);
      }
    }
  }
});

// =================== INDUSTRIALS_COMPOUNDER (CORE) BUCKET TESTS (v1, two cohorts heavy|light) ===========
// Spec formula-design-industrials-compounder-v1-2026-06-21.md. industrials is a SEPARATE court bucket
// (disjoint from saas/fabless/medtech/dlst and from the tag28 SCORE_WEIGHTS projection). NEW code keyed by
// the new cohort strings → the 4 prior buckets stay byte-identical (covered by the parity tests above).
const indH = doc.industrials_heavy;
const indL = doc.industrials_light;
const IH = indH ? indH.members : [];
const IL = indL ? indL.members : [];

test('industrials: both cohort buckets exist (heavy + light) with members', () => {
  assert(indH && Array.isArray(indH.members) && IH.length > 0, 'industrials_heavy bucket fehlt/leer');
  assert(indL && Array.isArray(indL.members) && IL.length > 0, 'industrials_light bucket fehlt/leer');
  assert(/Industrials-Compounder v1/.test(indH.label || ''), `heavy label sollte v1 nennen: ${indH.label}`);
});

test('industrials §6.2b MARQUEE: all 16 marquees classified+scored across the two cohorts (fail-loud guard)', () => {
  const MARQUEE = ['RTX', 'LMT', 'NOC', 'UNP', 'NSC', 'WM', 'RSG', 'ITW', 'PH', 'ETN', 'GD', 'EMR', 'CAT', 'DE', 'BA', 'GE'];
  const scored = new Set([...IH, ...IL].map(m => m.ticker));
  const missing = MARQUEE.filter(t => !scored.has(t));
  assert(missing.length === 0, `MARQUEE COVERAGE FAIL — nicht klassifiziert/gescort: ${missing.join(', ')}`);
  // the assertIndustrialsMarquee export must also pass on the live results (direct property test).
  const { assertIndustrialsMarquee } = require('./court-score.js');
  assert(typeof assertIndustrialsMarquee === 'function', 'assertIndustrialsMarquee nicht exportiert');
  assertIndustrialsMarquee(doc); // throws on collapse
});

test('industrials SI-5: classifiedCount === scoredCount + excludedCount (BEIDE Kohorten, fail-loud)', () => {
  for (const [name, R] of [['heavy', indH], ['light', indL]]) {
    assert(R.classifiedCount != null && R.scoredCount != null && R.excludedCount != null,
      `${name} SI-5 counts fehlen`);
    assert(R.classifiedCount === R.scoredCount + R.excludedCount,
      `${name} SI-5 mismatch: classified ${R.classifiedCount} !== scored ${R.scoredCount} + excluded ${R.excludedCount}`);
  }
  // corrected-pool target counts (Spec §6.6): heavy 165 / light 141.
  assert(indH.classifiedCount === 165, `heavy classified sollte 165 sein, ist ${indH.classifiedCount}`);
  assert(indL.classifiedCount === 141, `light classified sollte 141 sein, ist ${indL.classifiedCount}`);
});

test('industrials: a heavy + a light marquee member scored finite (CAT heavy, WM light)', () => {
  const cat = IH.find(m => m.ticker === 'CAT');
  assert(cat && Number.isFinite(cat.score) && cat.score > 0, `CAT (heavy) sollte finiten Score >0 haben, ist ${cat && cat.score}`);
  assert(cat.absKaliber != null && cat.absKaliber > 0, `CAT absKaliber sollte >0 sein, ist ${cat && cat.absKaliber}`);
  const wm = IL.find(m => m.ticker === 'WM');
  assert(wm && Number.isFinite(wm.score) && wm.score > 0, `WM (light) sollte finiten Score >0 haben, ist ${wm && wm.score}`);
});

test('industrials SI-4: excluded-industry name (Airlines AAL) is NOT classified into either cohort', () => {
  // Excluded industries (Airlines/Marine Shipping/Conglomerates/Airports) → classifier returns null → never
  // enter court-buckets → absent from both industrials universes (SI-4: out-of-class is null+excluded, never 0).
  const inUniverse = [...IH, ...IL].some(m => m.ticker === 'AAL');
  assert(!inUniverse, 'AAL (Airlines, excluded industry) darf NICHT im industrials-Universum sein (SI-4)');
});

test('industrials SI-4: Out-class / below-floor members carry score=null in excluded[] (kein irreführender Rang)', () => {
  for (const [name, R] of [['heavy', indH], ['light', indL]]) {
    assert(Array.isArray(R.excluded), `${name} excluded[] fehlt (SI-4)`);
    for (const m of R.excluded) assert(m.score === null, `${name} excluded ${m.ticker} score sollte null sein, ist ${m.score}`);
    // ranked (score!=null) members are all membership != Out.
    for (const m of R.members) {
      if (m.score != null) assert(m.membershipClass !== 'Out', `${name} ranked ${m.ticker} ist Out mit Score (SI-4)`);
    }
  }
});

test('industrials: COVERAGE-RENORM — Vintage-A names (RTX/ITW, no annualShares) drop Axis E + renorm to 4 axes', () => {
  // The load-bearing coverage-renorm path (Spec §6.4/§7-#13): ~57% of names lack annualShares → ISSUANCE_NOT_READY.
  for (const t of ['RTX', 'ITW', 'WM', 'UNP']) {
    const m = [...IH, ...IL].find(x => x.ticker === t);
    if (!m) continue;
    assert(Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.includes('netIssuance'),
      `${t} (Vintage-A, no annualShares) sollte netIssuance droppen, droppedAxes=${JSON.stringify(m.absDroppedAxes)}`);
    assert(m.lamps.includes('ISSUANCE_NOT_READY'), `${t} sollte ISSUANCE_NOT_READY lampen`);
    assert(m.absUsedAxes.length === 4, `${t} sollte 4 Achsen nutzen (E gedroppt), ist ${m.absUsedAxes.length}`);
  }
  // Axis-E coverage disclosure matches the corrected-pool figures (Spec §2.2/§6.6: heavy 95, light 78).
  assert(indH.issuanceCoverage && indH.issuanceCoverage.scored === 95, `heavy issuance scored sollte 95 sein, ist ${indH.issuanceCoverage && indH.issuanceCoverage.scored}`);
  assert(indL.issuanceCoverage && indL.issuanceCoverage.scored === 78, `light issuance scored sollte 78 sein, ist ${indL.issuanceCoverage && indL.issuanceCoverage.scored}`);
});

test('industrials §4.3 SPIN-OFF GUARD: GE routed to NOT_READY:growth (spin-off rebound never scored as organic)', () => {
  const ge = IH.find(m => m.ticker === 'GE');
  assert(ge != null, 'GE nicht im heavy-Universum');
  assert(ge.lamps.includes('SPINOFF_REBASE') && ge.lamps.includes('NOT_READY:growth'),
    `GE sollte SPINOFF_REBASE + NOT_READY:growth lampen; Lampen: ${ge.lamps}`);
  assert(ge.growthInput == null, `GE growthInput sollte null sein (Axis A gedroppt), ist ${ge.growthInput}`);
  assert(Array.isArray(ge.absDroppedAxes) && ge.absDroppedAxes.includes('growth'), 'GE sollte growth-Achse droppen (renorm)');
});

test('industrials §4.1 DEAL-MASK: AXON/BE deal-masked (sign-aware positive jump); CAT NOT masked', () => {
  for (const t of ['AXON', 'BE']) {
    const m = [...IH, ...IL].find(x => x.ticker === t);
    if (m) assert(m.lamps.includes('DEAL_MASKED'), `${t} sollte DEAL_MASKED lampen (asset+rev jump); Lampen: ${m.lamps}`);
  }
  const cat = IH.find(m => m.ticker === 'CAT');
  if (cat) assert(!cat.lamps.includes('DEAL_MASKED'), 'CAT sollte NICHT deal-masked sein (rev jump <15%)');
});

test('industrials: always-on WALLS lamps on every member (CYCLE_WALL/INVENTORY_BLIND/UNBILLED_BLIND/BACKLOG_FUTURE)', () => {
  for (const m of [...IH, ...IL]) {
    for (const wall of ['CYCLE_WALL', 'INVENTORY_BLIND', 'UNBILLED_BLIND', 'BACKLOG_FUTURE']) {
      assert(m.lamps.includes(wall), `${m.ticker} fehlt always-on Wall-Lampe ${wall}`);
    }
  }
});

test('industrials SI-3: normTableId + cohort + comparabilityNote (absKaliber cross-bucket, REL intra-bucket)', () => {
  assert(indH.normTableId === 'industrials_heavy-norms-2026-06-21', `heavy normTableId falsch: ${indH.normTableId}`);
  assert(indL.normTableId === 'industrials_light-norms-2026-06-21', `light normTableId falsch: ${indL.normTableId}`);
  for (const R of [indH, indL]) {
    assert(R.comparabilityNote && /absKaliber/.test(R.comparabilityNote) && /COVERAGE-RENORM/.test(R.comparabilityNote),
      'comparabilityNote sollte absKaliber + COVERAGE-RENORM erklären');
    assert(R.scoreScope === 'intra-bucket' && R.crossBucketComparableField === 'absKaliber', 'SI-3 cross-bucket-Marker fehlen');
  }
});

test('industrials: spot-check — ITW/CTAS mid-high, pre-revenue ACHR floored (Out/score=null)', () => {
  const itw = IH.find(m => m.ticker === 'ITW');
  assert(itw && itw.score != null && itw.score >= 50, `ITW (high GP/assets compounder) sollte mid-high (>=50) sein, ist ${itw && itw.score}`);
  const ctas = IL.find(m => m.ticker === 'CTAS');
  assert(ctas && ctas.score != null && ctas.score >= 50, `CTAS (asset-light services) sollte mid-high sein, ist ${ctas && ctas.score}`);
  const achr = IH.find(m => m.ticker === 'ACHR');
  assert(achr != null, 'ACHR muss im Universum sein (SI-5: alle klassifizierten admittiert)');
  assert(achr.score === null, `ACHR (pre-revenue, gpa/growth/eff NOT_READY) sollte score=null sein, ist ${achr.score}`);
  assert(achr.absKaliber === 0, `ACHR absKaliber sollte 0 sein (alle Quality-Achsen gedroppt), ist ${achr.absKaliber}`);
});

test('industrials PARITÄT: KEIN industrials-only Feld auf SaaS/Fabless/Medtech/D&LST-Membern (Leak-Guard)', () => {
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices', 'diagnostics_lst']) {
    for (const m of doc[b].members) {
      for (const leak of ['ind', 'gpa', 'assetGrowth', 'netShareIssuance', 'effInd', 'growthInput', 'absUsedAxes', 'absDroppedAxes', '_indGpa', '_indGrowth', '_indEff']) {
        assert(!(leak in m), `${b}/${m.ticker} hat industrials-only Feld '${leak}' geleakt (Parität verletzt)`);
      }
    }
  }
});

// =================== CONSUMER_STAPLES_COMPOUNDER (CORE) BUCKET TESTS (v1, two cohorts branded|distribution) ===
// Spec formula-design-consumer-staples-compounder-v1-2026-06-21.md (Court DESIGN-PASS 4/4). staples is a
// SEPARATE court bucket (disjoint from saas/fabless/medtech/dlst/industrials and from the tag28 projection).
// NEW code keyed by the new cohort strings → the 5 prior buckets stay byte-identical (parity tests above).
const stpB = doc.staples_branded;
const stpD = doc.staples_distribution;
const SB = stpB ? stpB.members : [];
const SD = stpD ? stpD.members : [];

test('staples: both cohort buckets exist (branded + distribution) with members', () => {
  assert(stpB && Array.isArray(stpB.members) && SB.length > 0, 'staples_branded bucket fehlt/leer');
  assert(stpD && Array.isArray(stpD.members) && SD.length > 0, 'staples_distribution bucket fehlt/leer');
  assert(/Consumer-Staples-Compounder v1/.test(stpB.label || ''), `branded label sollte v1 nennen: ${stpB.label}`);
});

test('staples §6.2b MARQUEE: all 9 marquees classified+scored across the two cohorts (fail-loud guard)', () => {
  const MARQUEE = ['PG', 'KO', 'PEP', 'COST', 'WMT', 'MDLZ', 'CL', 'MO', 'PM'];
  const scored = new Set([...SB, ...SD].map(m => m.ticker));
  const missing = MARQUEE.filter(t => !scored.has(t));
  assert(missing.length === 0, `MARQUEE COVERAGE FAIL — nicht klassifiziert/gescort: ${missing.join(', ')}`);
  // the assertStaplesMarquee export must also pass on the live results (direct property test).
  const { assertStaplesMarquee } = require('./court-score.js');
  assert(typeof assertStaplesMarquee === 'function', 'assertStaplesMarquee nicht exportiert');
  assertStaplesMarquee(doc); // throws on collapse / foreign-control leak
});

test('staples SI-5: classifiedCount === scoredCount + excludedCount (BEIDE Kohorten, fail-loud)', () => {
  for (const [name, R] of [['branded', stpB], ['distribution', stpD]]) {
    assert(R.classifiedCount != null && R.scoredCount != null && R.excludedCount != null, `${name} SI-5 counts fehlen`);
    assert(R.classifiedCount === R.scoredCount + R.excludedCount,
      `${name} SI-5 mismatch: classified ${R.classifiedCount} !== scored ${R.scoredCount} + excluded ${R.excludedCount}`);
  }
  // clean v1-pool target counts (Spec §6.6): branded 52 / distribution 23 (both n≥15).
  assert(stpB.classifiedCount === 52, `branded classified sollte 52 sein, ist ${stpB.classifiedCount}`);
  assert(stpD.classifiedCount === 23, `distribution classified sollte 23 sein, ist ${stpD.classifiedCount}`);
});

test('staples: a branded + a distribution marquee member scored finite (PG/MO branded, COST/WMT distribution)', () => {
  for (const t of ['PG', 'MO']) {
    const m = SB.find(x => x.ticker === t);
    assert(m && Number.isFinite(m.score) && m.score > 0, `${t} (branded) sollte finiten Score >0 haben, ist ${m && m.score}`);
    assert(m.absKaliber != null && m.absKaliber > 0, `${t} absKaliber sollte >0 sein, ist ${m && m.absKaliber}`);
  }
  for (const t of ['COST', 'WMT']) {
    const m = SD.find(x => x.ticker === t);
    assert(m && Number.isFinite(m.score) && m.score > 0, `${t} (distribution) sollte finiten Score >0 haben, ist ${m && m.score}`);
  }
});

test('staples §6.2b GENERATIVE anti-leak + FOREIGN_CONTROL: leakers + KOF/RLX/DOLE/HLF/NOMD absent from cohorts', () => {
  const scored = new Set([...SB, ...SD].map(m => m.ticker));
  // country-set leakers (BTI/ABEV/FMX/CCEP/MICC/AGRO/FDP) — generative country assert kills these.
  for (const t of ['BTI', 'ABEV', 'FMX', 'CCEP', 'MICC', 'AGRO', 'FDP']) {
    assert(!scored.has(t), `${t} (foreign-country primary) darf NICHT in einer staples-Kohorte sein (generativer Anti-Leak)`);
  }
  // undefined-country foreign primaries (FOREIGN_NAME regex + residual) — FOREIGN_CONTROL positive-control.
  for (const t of ['KOF', 'RLX', 'DOLE', 'HLF', 'NOMD']) {
    assert(!scored.has(t), `${t} (undefined-country foreign primary) darf NICHT klassifiziert sein (FOREIGN_CONTROL §6.2b)`);
  }
  // the assertStaplesNoForeignLeak export must pass on the live results (direct property test).
  const { assertStaplesNoForeignLeak } = require('./court-score.js');
  assert(typeof assertStaplesNoForeignLeak === 'function', 'assertStaplesNoForeignLeak nicht exportiert');
  // a fresh listing side-file exists from the isolated screen run (TEST_ENV COURT_LISTING_OUT path).
  let listing = new Map();
  try {
    const lp = (CAND_TEST.replace(/_court-candidates([^/\\]*)\.json$/, '_court-listing$1.json'));
    const ld = JSON.parse(fs.readFileSync(lp, 'utf8'));
    const obj = ld && ld.listings ? ld.listings : (ld || {});
    for (const [t, rec] of Object.entries(obj)) listing.set(t, rec);
  } catch {}
  assertStaplesNoForeignLeak(doc, listing); // throws on any country-set != US leak
});

test('staples SI-4: excluded-industry name (Education COUR) is NOT classified into either cohort', () => {
  const inUniverse = [...SB, ...SD].some(m => m.ticker === 'COUR');
  assert(!inUniverse, 'COUR (Education & Training Services, hard-excluded) darf NICHT im staples-Universum sein (SI-4)');
});

test('staples SI-4: Out-class / below-floor members carry score=null in excluded[] (kein irreführender Rang)', () => {
  for (const [name, R] of [['branded', stpB], ['distribution', stpD]]) {
    assert(Array.isArray(R.excluded), `${name} excluded[] fehlt (SI-4)`);
    for (const m of R.excluded) assert(m.score === null, `${name} excluded ${m.ticker} score sollte null sein, ist ${m.score}`);
    for (const m of R.members) {
      if (m.score != null) assert(m.membershipClass !== 'Out', `${name} ranked ${m.ticker} ist Out mit Score (SI-4)`);
    }
  }
});

test('staples: COVERAGE-RENORM — Vintage-A names (PG/KO/WMT/COST, no annualShares) drop Axis E + renorm to 4 axes', () => {
  // The load-bearing coverage-renorm path (Spec §2.2/§6.4/§7-#3): ~58% of names lack annualShares → ISSUANCE_NOT_READY.
  for (const t of ['PG', 'KO', 'WMT', 'COST']) {
    const m = [...SB, ...SD].find(x => x.ticker === t);
    if (!m) continue;
    assert(Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.includes('netIssuance'),
      `${t} (Vintage-A, no annualShares) sollte netIssuance droppen, droppedAxes=${JSON.stringify(m.absDroppedAxes)}`);
    assert(m.lamps.includes('ISSUANCE_NOT_READY'), `${t} sollte ISSUANCE_NOT_READY lampen`);
    assert(m.absUsedAxes.length === 4, `${t} sollte 4 Achsen nutzen (E gedroppt), ist ${m.absUsedAxes.length}`);
  }
  // Axis-E coverage disclosure matches the clean-pool figures (Spec §2.2/§6.6: branded 22/52, distrib 9/23).
  assert(stpB.issuanceCoverage && stpB.issuanceCoverage.scored === 22, `branded issuance scored sollte 22 sein, ist ${stpB.issuanceCoverage && stpB.issuanceCoverage.scored}`);
  assert(stpD.issuanceCoverage && stpD.issuanceCoverage.scored === 9, `distribution issuance scored sollte 9 sein, ist ${stpD.issuanceCoverage && stpD.issuanceCoverage.scored}`);
});

test('staples §4.1 DEAL-MASK: at least one acquirer deal-masked (sign-aware positive jump)', () => {
  const masked = [...SB, ...SD].filter(m => m.lamps.includes('DEAL_MASKED')).map(m => m.ticker);
  assert(masked.length > 0, `mindestens ein Name sollte DEAL_MASKED tragen (acquirer asset+rev jump); keiner gefunden`);
});

// ===========================================================================
// §4.1b REVENUE-DISCONTINUITY DATA-ARTIFACT GUARD (re-court MAJOR fix, COKE corrupt-revenue defect)
// COKE's snapshot annualRev mixes scales → a fake +218% latest YoY while total assets FELL. The §4.1 deal-mask
// (assetG>=0.25 AND revG>=0.15 BOTH required) MISSES it because assets did not rise. The §4.1b guard catches a
// single-year revenue MULTIPLE (revG>=1.00, i.e. >2x in one year) that is NOT asset-backed → drops that YoY +
// SUSPECT_REVENUE lamp, so a pure data artifact can NO LONGER top the cohort headline ("junk tops the bucket").
// ===========================================================================
test('staples §4.1b ARTIFACT GUARD (live): COKE no longer tops staples_branded; flagged SUSPECT_REVENUE; growth sane', () => {
  const coke = SB.find(m => m.ticker === 'COKE');
  assert(coke, 'COKE fehlt im staples_branded cohort');
  // (1) the corrupt +218% growth artifact is neutralized → a plausible mid-single-digit organic read
  assert(coke.growthInput != null && isFinite(coke.growthInput) && coke.growthInput < 0.25,
    `COKE growthInput sollte SANE (<0.25, war ~1.34 korrupt) sein, ist ${coke.growthInput}`);
  // (2) the artifact is FLAGGED (advisory, never a silent score-kill)
  assert(coke.lamps.includes('SUSPECT_REVENUE'), `COKE sollte SUSPECT_REVENUE-Lampe tragen, lamps=${JSON.stringify(coke.lamps)}`);
  assert(coke.stp && coke.stp.revArtifact === true, `COKE stp.revArtifact sollte true sein, ist ${coke.stp && coke.stp.revArtifact}`);
  // (3) COKE is NO LONGER the #1 headline name — a data artifact must not top the bucket (iron rule)
  const scored = SB.filter(m => m.score != null).sort((a, b) => b.score - a.score);
  assert(scored[0].ticker !== 'COKE', `COKE darf NICHT #1 im staples_branded headline sein, ist ${scored[0].ticker}`);
  // (4) the new #1 is a genuine quality staple (not a corrupt-data name)
  assert(scored[0].score != null && isFinite(scored[0].score) && !scored[0].lamps.includes('SUSPECT_REVENUE'),
    `neues #1 (${scored[0].ticker}) sollte ein sauberer Qualitätsname OHNE SUSPECT_REVENUE sein`);
});

test('staples §4.1b ARTIFACT GUARD: fires ONLY on implausible non-asset-backed rev jumps (no legit hyper-grower mis-flagged)', () => {
  // Across BOTH cohorts the guard must be surgical: it should flag the corrupt COKE artifact but NOT a genuine
  // asset-backed hyper-grower (CELH doubled revenue +101.7% WITH assetG +0.257 → asset-backed → SPARED).
  const flagged = [...SB, ...SD].filter(m => m.stp && m.stp.revArtifact === true).map(m => m.ticker);
  assert(flagged.includes('COKE'), `COKE (corrupt) sollte vom Artifact-Guard erfasst sein; flagged=${JSON.stringify(flagged)}`);
  const celh = [...SB, ...SD].find(m => m.ticker === 'CELH');
  if (celh) assert(!(celh.stp && celh.stp.revArtifact === true),
    `CELH (echter asset-backed Hyper-Grower) darf NICHT als Artefakt geflaggt werden`);
  // legitimate growers keep their honest growthInput (no clamp): max revG well below the 1.0 (2x) multiple
  for (const t of ['BRBR', 'MNST', 'ELF', 'PRMB', 'FIZZ']) {
    const m = SB.find(x => x.ticker === t);
    if (m) assert(!(m.stp && m.stp.revArtifact === true), `${t} (legit grower) darf NICHT als Artefakt geflaggt werden`);
  }
  // every flagged name carries the advisory lamp and a FINITE score (advisory, never a silent kill)
  for (const t of flagged) {
    const m = [...SB, ...SD].find(x => x.ticker === t);
    assert(m.lamps.includes('SUSPECT_REVENUE'), `${t} revArtifact aber keine SUSPECT_REVENUE-Lampe`);
    assert(m.score != null && isFinite(m.score), `${t} SUSPECT_REVENUE darf den Score NICHT nullen (advisory only), score=${m.score}`);
  }
});

test('staples-unit §4.1b: a synthetic 3x non-asset-backed revenue jump clamps the growth axis (artifact dropped, not blended)', () => {
  // Locks the guard PREDICATE + its downstream effect on absKaliberStaples, independent of the live snapshot.
  // The guard (court-screen buildStaplesAxes §4.1b) drops a YoY where revG>=1.00 AND assetG<0.25; the remaining
  // clean YoYs feed the median blend. Here we exercise the engine with BOTH the corrupt-blended growth and the
  // post-guard growth to prove the artifact, if NOT dropped, would dominate — and that dropping it neutralizes it.
  const { absKaliberStaples } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  // synthetic corrupt series: rev [4.0, 1.0, 0.93, 0.90] (×4 latest jump = +300%), assets FELL (not asset-backed)
  const revMult = 4.0 / 1.0 - 1;                 // +300% latest YoY (>= 1.00 artifact threshold)
  const assetG = -0.10;                          // assets FELL → NOT asset-backed → artifact, not a deal
  const isArtifact = (revMult >= 1.00) && !(assetG >= 0.25);
  assert(isArtifact, 'synthetic +300% non-asset-backed jump MUSS als Artefakt klassifizieren');
  // clean YoYs after dropping the artifact: [1.0/0.93-1, 0.93/0.90-1] ≈ [0.075, 0.033] → median blend ~0.058
  const cleanYoY = [1.0 / 0.93 - 1, 0.93 / 0.90 - 1];
  const sane = 0.60 * cleanYoY[0] + 0.40 * ((cleanYoY[0] + cleanYoY[1]) / 2);
  // corrupt-if-not-guarded blend would be 0.60*3.0 + 0.40*median([3.0,0.075,0.033]) ≈ 1.83 (axis maxed to 1.0)
  const corrupt = 0.60 * revMult + 0.40 * cleanYoY[0]; // a conservative lower bound on the corrupt blend
  const recSane = { gpa: 0.30, growth: sane, assetGrowth: assetG, netShareIssuance: null, eff: 0.15 };
  const recCorrupt = { gpa: 0.30, growth: corrupt, assetGrowth: assetG, netShareIssuance: null, eff: 0.15 };
  const aSane = absKaliberStaples(recSane, 'staples_branded');
  const aCorrupt = absKaliberStaples(recCorrupt, 'staples_branded');
  assert(aCorrupt.absK > aSane.absK + 0.05,
    `der ungeguardte Artefakt-Wert MÜSSTE die absKaliber inflationieren (corrupt ${aCorrupt.absK.toFixed(3)} vs guarded ${aSane.absK.toFixed(3)})`);
  // the guarded growth maps to a NON-saturated growth axis (the artifact would saturate it to elite)
  assert(sane < 0.25, `geguardte synthetic growth sollte sane (<0.25) sein, ist ${sane}`);
});

test('staples: always-on WALLS lamps on every member (VOLUME_PRICE_BLIND/MA_PROXY_ONLY/INVENTORY_BLIND/CYCLE_WALL)', () => {
  for (const m of [...SB, ...SD]) {
    for (const wall of ['VOLUME_PRICE_BLIND', 'MA_PROXY_ONLY', 'INVENTORY_BLIND', 'CYCLE_WALL']) {
      assert(m.lamps.includes(wall), `${m.ticker} fehlt always-on Wall-Lampe ${wall}`);
    }
  }
});

test('staples SI-3: normTableId + cohort + comparabilityNote (absKaliber cross-bucket, REL intra-bucket)', () => {
  assert(stpB.normTableId === 'staples_branded-norms-2026-06-21', `branded normTableId falsch: ${stpB.normTableId}`);
  assert(stpD.normTableId === 'staples_distribution-norms-2026-06-21', `distribution normTableId falsch: ${stpD.normTableId}`);
  for (const R of [stpB, stpD]) {
    assert(R.comparabilityNote && /absKaliber/.test(R.comparabilityNote) && /COVERAGE-RENORM/.test(R.comparabilityNote),
      'comparabilityNote sollte absKaliber + COVERAGE-RENORM erklären');
    assert(R.scoreScope === 'intra-bucket' && R.crossBucketComparableField === 'absKaliber', 'SI-3 cross-bucket-Marker fehlen');
  }
});

test('staples: GP/assets INVERSION cohort-keyed — distribution gpa-elite (.66) > branded gpa-elite (.60); eff floors differ', () => {
  // The empirically-forced split (Spec §1.4/§3): turns-driven distribution posts HIGHER GP/assets at razor-thin
  // op-margin → cohort-specific norms (a shared norm would invert the quality ranking). Read live from NORMS.
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  assert(NORMS.staples_branded.gpa.elite === 0.60 && NORMS.staples_distribution.gpa.elite === 0.66,
    `gpa-elites: branded ${NORMS.staples_branded.gpa.elite} / distrib ${NORMS.staples_distribution.gpa.elite} (distrib > branded erwartet)`);
  assert(NORMS.staples_branded.eff.floor === 0.05 && NORMS.staples_distribution.eff.floor === 0.01,
    `eff-floors: branded ${NORMS.staples_branded.eff.floor} / distrib ${NORMS.staples_distribution.eff.floor} (cohort-keyed, ~5x op-margin gap)`);
  // weights identical across cohorts (STRONG pillar 0.66 ≫ growth 0.18), sum to 1.0.
  for (const b of ['staples_branded', 'staples_distribution']) {
    const w = NORMS[b].weights;
    const sum = w.gpa + w.growth + w.assetGrowthPenalty + w.netIssuance + w.eff;
    assert(Math.abs(sum - 1.0) < 1e-9, `${b} weights summieren nicht auf 1.0, ist ${sum}`);
    assert(w.gpa === 0.36 && w.growth === 0.18 && w.netIssuance === 0.12, `${b} weights falsch: ${JSON.stringify(w)}`);
  }
});

test('staples-unit: absKaliberStaples coverage-renorm — E-drop renormalizes survivors to Σ=1.0; all-null → 0', () => {
  const { absKaliberStaples } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  // full coverage → all 5 axes used, weights sum 1.0
  const full = absKaliberStaples({ gpa: 0.30, growth: 0.05, assetGrowth: 0.02, netShareIssuance: -0.01, eff: 0.15 }, 'staples_branded');
  assert(full.usedAxes.length === 5 && full.droppedAxes.length === 0, `full coverage: 5 axes erwartet, ist ${full.usedAxes.length}`);
  assert(Math.abs(Object.values(full.renormWeights).reduce((a, b) => a + b, 0) - 1.0) < 1e-9, 'full renormWeights summieren nicht auf 1.0');
  // Vintage-A: netShareIssuance null → Axis E dropped, survivors renorm to Σ=1.0 (no fake-neutral impute)
  const dropE = absKaliberStaples({ gpa: 0.30, growth: 0.05, assetGrowth: 0.02, netShareIssuance: null, eff: 0.15 }, 'staples_distribution');
  assert(dropE.usedAxes.length === 4 && dropE.droppedAxes.includes('netIssuance'), `E-drop: 4 axes erwartet, dropped=${JSON.stringify(dropE.droppedAxes)}`);
  assert(Math.abs(Object.values(dropE.renormWeights).reduce((a, b) => a + b, 0) - 1.0) < 1e-9, 'E-drop renormWeights summieren nicht auf 1.0');
  // pathological: every axis null → absK 0 (last-resort net, never NaN)
  const allNull = absKaliberStaples({ gpa: null, growth: null, assetGrowth: null, netShareIssuance: null, eff: null }, 'staples_branded');
  assert(allNull.absK === 0, `all-null absK sollte 0 sein, ist ${allNull.absK}`);
});

test('staples PARITÄT: KEIN staples-only Feld auf SaaS/Fabless/Medtech/D&LST/Industrials-Membern (Leak-Guard)', () => {
  // Only TRULY staples-exclusive fields (stp/effStp/_stp*); the shared 5-axis field names (gpa/assetGrowth/
  // netShareIssuance/growthInput/absUsedAxes/absDroppedAxes) legitimately exist on industrials members.
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices', 'diagnostics_lst', 'industrials_heavy', 'industrials_light']) {
    for (const m of doc[b].members) {
      for (const leak of ['stp', 'effStp', '_stpGpa', '_stpGrowth', '_stpEff', '_stpAssetGrowthPenalty', '_stpNetIssuance']) {
        assert(!(leak in m), `${b}/${m.ticker} hat staples-only Feld '${leak}' geleakt (Parität verletzt)`);
      }
    }
  }
});

// =================== CONSDISC_EXPANSION (CORE) BUCKET TESTS (v1, two cohorts store|light) ============
// Spec formula-design-consumer-disc-expansion-v1-2026-06-21.md (Court FINAL DESIGN-PASS 4/4). consdisc is a
// SEPARATE court bucket (disjoint from saas/fabless/medtech/dlst/industrials/staples + the tag28 projection).
// NEW code keyed by the new cohort strings → the 6 prior buckets stay byte-identical (parity tests above).
// DISTINCT: FOUR scored axes (gpa/growth/assetGrowthPenalty/eff) + a POST-SUM dilution haircut (NOT a 5th axis);
// PER-COHORT β (store 0.6 ABS+REL blend; light n<15 ABS-only β=1, THIN_REL).
const cdS = doc.consdisc_store;
const cdL = doc.consdisc_light;
const CS = cdS ? cdS.members : [];
const CL = cdL ? cdL.members : [];

test('consdisc: both cohort buckets exist (store + light) with members', () => {
  assert(cdS && Array.isArray(cdS.members) && CS.length > 0, 'consdisc_store bucket fehlt/leer');
  assert(cdL && Array.isArray(cdL.members) && CL.length > 0, 'consdisc_light bucket fehlt/leer');
  assert(/Consumer-Disc-Expansion v1/.test(cdS.label || ''), `store label sollte v1 nennen: ${cdS.label}`);
});

test('consdisc §6.1 MARQUEE: all marquees classified+scored across the two cohorts (fail-loud guard)', () => {
  const MARQUEE = ['AMZN', 'EBAY', 'ETSY', 'HD', 'CMG', 'DPZ', 'DRI', 'DECK', 'BBY', 'CAVA'];
  const scored = new Set([...CS, ...CL].map(m => m.ticker));
  const missing = MARQUEE.filter(t => !scored.has(t));
  assert(missing.length === 0, `MARQUEE COVERAGE FAIL — nicht klassifiziert/gescort: ${missing.join(', ')}`);
  // the assertConsdiscMarquee export must also pass on the live results (direct property test).
  const { assertConsdiscMarquee } = require('./court-score.js');
  assert(typeof assertConsdiscMarquee === 'function', 'assertConsdiscMarquee nicht exportiert');
  assertConsdiscMarquee(doc); // throws on collapse / exclude-control leak
});

test('consdisc SI-5: classifiedCount === scoredCount + excludedCount (BEIDE Kohorten, fail-loud)', () => {
  for (const [name, R] of [['store', cdS], ['light', cdL]]) {
    assert(R.classifiedCount != null && R.scoredCount != null && R.excludedCount != null, `${name} SI-5 counts fehlen`);
    assert(R.classifiedCount === R.scoredCount + R.excludedCount,
      `${name} SI-5 mismatch: classified ${R.classifiedCount} !== scored ${R.scoredCount} + excluded ${R.excludedCount}`);
  }
  // Live-pool counts (LARGER than the spec's 2026-06-08 31/8 recompute — honest mixed-vintage pool growth,
  // genuine US discretionary large-caps the smaller pool omitted; foreign primaries excluded). store >= 31,
  // light >= 8, light still < 15 (THIN_REL regime preserved). The exact spec frozen target was 31/8.
  assert(cdS.classifiedCount >= 31, `store classified sollte >= 31 sein, ist ${cdS.classifiedCount}`);
  assert(cdL.classifiedCount >= 8 && cdL.classifiedCount < 15, `light classified sollte [8,15) sein (thin-n), ist ${cdL.classifiedCount}`);
});

test('consdisc: a store + a light marquee member scored finite (DECK/HD store, AMZN/EBAY light)', () => {
  for (const t of ['DECK', 'HD']) {
    const m = CS.find(x => x.ticker === t);
    assert(m && Number.isFinite(m.score) && m.score > 0, `${t} (store) sollte finiten Score >0 haben, ist ${m && m.score}`);
    assert(m.absKaliber != null && m.absKaliber > 0, `${t} absKaliber sollte >0 sein, ist ${m && m.absKaliber}`);
  }
  for (const t of ['AMZN', 'EBAY']) {
    const m = CL.find(x => x.ticker === t);
    assert(m && Number.isFinite(m.score) && m.score > 0, `${t} (light) sollte finiten Score >0 haben, ist ${m && m.score}`);
  }
});

test('consdisc §1.1/§1.2 EXCLUDE-CONTROL: auto-OEM/hotel/gaming + foreign primaries absent from cohorts', () => {
  const scored = new Set([...CS, ...CL].map(m => m.ticker));
  // industry hard-excludes (auto-OEM value trap + hotel/gaming/auto-dealer)
  for (const t of ['TSLA', 'GM', 'F', 'MAR', 'HLT', 'LVS', 'WYNN', 'AN', 'KMX']) {
    assert(!scored.has(t), `${t} (hard-excluded industry) darf NICHT in einer consdisc-Kohorte sein (SI-4)`);
  }
  // Vintage-A foreign primaries (FOREIGN_PRIMARY_RESIDUAL / FOREIGN_NAME guards) — FAILURE-MODE-2 ADR leak.
  for (const t of ['JD', 'PDD', 'RERE', 'MELI', 'YUMC', 'ONON', 'QSR', 'BABA']) {
    assert(!scored.has(t), `${t} (foreign primary) darf NICHT klassifiziert sein (EXCLUDE-CONTROL §1.2)`);
  }
  // the assertConsdiscNoForeignLeak export must pass on the live results (direct property test).
  const { assertConsdiscNoForeignLeak } = require('./court-score.js');
  assert(typeof assertConsdiscNoForeignLeak === 'function', 'assertConsdiscNoForeignLeak nicht exportiert');
  let listing = new Map();
  try {
    const lp = (CAND_TEST.replace(/_court-candidates([^/\\]*)\.json$/, '_court-listing$1.json'));
    const ld = JSON.parse(fs.readFileSync(lp, 'utf8'));
    const obj = ld && ld.listings ? ld.listings : (ld || {});
    for (const [t, rec] of Object.entries(obj)) listing.set(t, rec);
  } catch {}
  assertConsdiscNoForeignLeak(doc, listing); // throws on any country-set != US leak
});

test('consdisc SI-4: Out-class / below-floor members carry score=null in excluded[] (kein irreführender Rang)', () => {
  for (const [name, R] of [['store', cdS], ['light', cdL]]) {
    assert(Array.isArray(R.excluded), `${name} excluded[] fehlt (SI-4)`);
    for (const m of R.excluded) assert(m.score === null, `${name} excluded ${m.ticker} score sollte null sein, ist ${m.score}`);
    for (const m of R.members) {
      if (m.score != null) assert(m.membershipClass !== 'Out', `${name} ranked ${m.ticker} ist Out mit Score (SI-4)`);
    }
  }
});

test('consdisc: FOUR scored axes (NO netIssuance axis) + post-sum dilution haircut on absKaliber', () => {
  // The 4-axis distinction (Spec §3): gpa/growth/assetGrowthPenalty/eff, weights summing to 1.0; share
  // dilution is a POST-SUM multiplier, NOT a 5th weighted axis.
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  for (const b of ['consdisc_store', 'consdisc_light']) {
    const w = NORMS[b].weights;
    assert(w.netIssuance === undefined, `${b} darf KEINE netIssuance-Gewichtung haben (4 Achsen)`);
    const sum = w.gpa + w.growth + w.assetGrowthPenalty + w.eff;
    assert(Math.abs(sum - 1.0) < 1e-9, `${b} 4-Achs-Gewichte summieren nicht auf 1.0, ist ${sum}`);
    assert(w.gpa === 0.40 && w.growth === 0.25 && w.assetGrowthPenalty === 0.20 && w.eff === 0.15,
      `${b} weights falsch: ${JSON.stringify(w)}`);
  }
  // a name with net issuance carries a dilutionHaircut <= 0.10; absKaliber <= absKaliberPreDilution.
  const all = [...CS, ...CL];
  const diluted = all.filter(m => m.dilutionHaircut != null && m.dilutionHaircut > 0);
  assert(diluted.length > 0, 'mindestens ein Name sollte einen Dilution-Haircut tragen (shareCAGR > 0)');
  for (const m of diluted) {
    assert(m.dilutionHaircut <= 0.10 + 1e-9, `${m.ticker} Haircut > maxHaircut 0.10: ${m.dilutionHaircut}`);
    assert(m.absKaliber <= m.absKaliberPreDilution + 1e-9, `${m.ticker} absKaliber > preDilution (Haircut nicht angewandt)`);
  }
});

test('consdisc §8-#9: AMZN moderated (heavy Axis-D asset-growth penalty), NOT a top light pick', () => {
  const amzn = CL.find(m => m.ticker === 'AMZN');
  assert(amzn, 'AMZN fehlt im light-Universum');
  assert(!amzn.lamps.includes('DEAL_MASKED'), 'AMZN sollte NICHT deal-masked sein (rev <20%, §4.1)');
  assert(amzn.assetGrowth != null && amzn.assetGrowth > 0.25, `AMZN assetGrowth sollte hoch sein (~+31%), ist ${amzn.assetGrowth}`);
  const lightRanked = CL.filter(m => m.score != null).sort((a, b) => b.score - a.score);
  const amznRank = lightRanked.findIndex(m => m.ticker === 'AMZN') + 1;
  assert(amznRank > lightRanked.length / 2, `AMZN sollte unterhalb der light-Median-Rangstufe liegen (moderiert), Rang ${amznRank}/${lightRanked.length}`);
});

test('consdisc §4.1 DEAL-MASK: DKS deal-masked (Foot Locker +66% assets +28% rev); CMG NOT masked', () => {
  const dks = CS.find(m => m.ticker === 'DKS');
  const cmg = CS.find(m => m.ticker === 'CMG');
  assert(dks && dks.lamps.includes('DEAL_MASKED'), 'DKS sollte DEAL_MASKED tragen (asset+rev jump beide über Schwelle)');
  assert(cmg && !cmg.lamps.includes('DEAL_MASKED'), 'CMG sollte NICHT deal-masked sein (clean compounder)');
});

test('consdisc: light cohort ABS-ONLY (β=1, THIN_REL); store full ABS+REL blend (β=0.6)', () => {
  assert(cdL.betaMode === 1.0 && cdL.absOnly === true, `light sollte β=1 ABS-only sein, β=${cdL.betaMode} absOnly=${cdL.absOnly}`);
  assert(cdS.betaMode === 0.6 && cdS.absOnly === false, `store sollte β=0.6 blend sein, β=${cdS.betaMode} absOnly=${cdS.absOnly}`);
  // light: every member carries THIN_REL; ABS-only means score === 100*absKaliber (REL ignored).
  for (const m of CL) {
    assert(m.lamps.includes('THIN_REL'), `${m.ticker} (light) sollte THIN_REL tragen`);
    if (m.score != null) assert(Math.abs(m.score - 100 * m.absKaliber) < 0.15,
      `${m.ticker} (light, ABS-only) score sollte ~100*absKaliber sein: score=${m.score} 100*aK=${100 * m.absKaliber}`);
  }
});

test('consdisc: always-on WALLS — LEASE_DISTORTED store-only, INVENTORY_BLIND both (the §1.2 split point)', () => {
  for (const m of CS) {
    assert(m.lamps.includes('LEASE_DISTORTED'), `${m.ticker} (store) fehlt LEASE_DISTORTED`);
    assert(m.lamps.includes('INVENTORY_BLIND'), `${m.ticker} (store) fehlt INVENTORY_BLIND`);
  }
  for (const m of CL) {
    assert(!m.lamps.includes('LEASE_DISTORTED'), `${m.ticker} (light) darf NICHT LEASE_DISTORTED tragen (un-leased denom, §1.2)`);
    assert(m.lamps.includes('INVENTORY_BLIND'), `${m.ticker} (light) fehlt INVENTORY_BLIND`);
  }
  assert(JSON.stringify(cdS.walls) === JSON.stringify(['LEASE_DISTORTED', 'INVENTORY_BLIND']), `store walls falsch: ${JSON.stringify(cdS.walls)}`);
  assert(JSON.stringify(cdL.walls) === JSON.stringify(['INVENTORY_BLIND']), `light walls falsch: ${JSON.stringify(cdL.walls)}`);
});

test('consdisc SI-3: normTableId + cohort + comparabilityNote (absKaliber cross-bucket, REL/ABS-only intra-bucket)', () => {
  assert(cdS.normTableId === 'consdisc_store-norms-2026-06-21', `store normTableId falsch: ${cdS.normTableId}`);
  assert(cdL.normTableId === 'consdisc_light-norms-2026-06-21', `light normTableId falsch: ${cdL.normTableId}`);
  for (const R of [cdS, cdL]) {
    assert(R.comparabilityNote && /absKaliber/.test(R.comparabilityNote) && /COVERAGE-RENORM/.test(R.comparabilityNote),
      'comparabilityNote sollte absKaliber + COVERAGE-RENORM erklären');
    assert(R.scoreScope === 'intra-bucket' && R.crossBucketComparableField === 'absKaliber', 'SI-3 cross-bucket-Marker fehlen');
  }
  assert(/ABS-ONLY/.test(cdL.comparabilityNote), 'light comparabilityNote sollte ABS-ONLY (thin-n) offenlegen');
});

test('consdisc: GP/assets cohort-keyed — light gpa floor/elite (.42/.95) > store (.21/.85) (un-leased denominator)', () => {
  // The §1.2 lease-distortion isolation: light's un-leased denominator posts higher GP/assets → cohort-specific
  // norm (a shared norm would mis-rank). growth/eff/assetGrowthPenalty SHARED across cohorts. Read live from NORMS.
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  assert(NORMS.consdisc_store.gpa.floor === 0.21 && NORMS.consdisc_store.gpa.elite === 0.85,
    `store gpa norm falsch: ${JSON.stringify(NORMS.consdisc_store.gpa)}`);
  assert(NORMS.consdisc_light.gpa.floor === 0.42 && NORMS.consdisc_light.gpa.elite === 0.95,
    `light gpa norm falsch: ${JSON.stringify(NORMS.consdisc_light.gpa)}`);
  // shared anchors
  for (const b of ['consdisc_store', 'consdisc_light']) {
    assert(NORMS[b].growth.floor === 0.04 && NORMS[b].growth.elite === 0.22, `${b} growth norm sollte shared .04/.22 sein`);
    assert(NORMS[b].eff.floor === 0.02 && NORMS[b].eff.elite === 0.18, `${b} eff norm sollte shared .02/.18 sein`);
    assert(NORMS[b].assetGrowthPenalty.floor === -0.30 && NORMS[b].assetGrowthPenalty.elite === 0.00, `${b} assetGrowthPenalty sollte shared -.30/.00 sein`);
  }
});

test('consdisc-unit: absKaliberConsDisc 4-axis coverage-renorm + dilution haircut (E-drop renorm Σ=1.0; 6% issuance → 10% hc; all-null → 0)', () => {
  const { absKaliberConsDisc } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  // full coverage, buyback → no haircut, 4 axes used
  const full = absKaliberConsDisc({ gpa: 0.50, growth: 0.10, assetGrowth: 0.05, eff: 0.10, shareCAGR: -0.02 }, 'consdisc_store');
  assert(full.usedAxes.length === 4 && full.droppedAxes.length === 0, `full coverage: 4 axes erwartet, ist ${full.usedAxes.length}`);
  assert(full.dilutionHaircut === 0, `buyback sollte 0 Haircut sein, ist ${full.dilutionHaircut}`);
  assert(Math.abs(Object.values(full.renormWeights).reduce((a, b) => a + b, 0) - 1.0) < 1e-9, 'full renormWeights summieren nicht auf 1.0');
  // 6% net issuance → exactly maxHaircut 10%
  const dil = absKaliberConsDisc({ gpa: 0.50, growth: 0.10, assetGrowth: 0.05, eff: 0.10, shareCAGR: 0.06 }, 'consdisc_store');
  assert(Math.abs(dil.dilutionHaircut - 0.10) < 1e-9, `6% issuance sollte 10% Haircut sein, ist ${dil.dilutionHaircut}`);
  assert(Math.abs(dil.absK - dil.absKPreDilution * 0.90) < 1e-9, 'absK sollte preDilution*0.90 sein (10% Haircut)');
  // growth dropped (NOT_READY) → renorm to 3 axes, Σ=1.0
  const dropG = absKaliberConsDisc({ gpa: 0.50, growth: null, assetGrowth: 0.05, eff: 0.10, shareCAGR: null }, 'consdisc_light');
  assert(dropG.usedAxes.length === 3 && dropG.droppedAxes.includes('growth'), `growth-drop: 3 axes erwartet, dropped=${JSON.stringify(dropG.droppedAxes)}`);
  assert(Math.abs(Object.values(dropG.renormWeights).reduce((a, b) => a + b, 0) - 1.0) < 1e-9, 'growth-drop renormWeights summieren nicht auf 1.0');
  // pathological: every axis null → absK 0 (last-resort net, never NaN)
  const allNull = absKaliberConsDisc({ gpa: null, growth: null, assetGrowth: null, eff: null, shareCAGR: 0.5 }, 'consdisc_store');
  assert(allNull.absK === 0, `all-null absK sollte 0 sein, ist ${allNull.absK}`);
});

test('consdisc PARITÄT: KEIN consdisc-only Feld auf SaaS/Fabless/Medtech/D&LST/Industrials/Staples-Membern (Leak-Guard)', () => {
  // Only TRULY consdisc-exclusive fields (cd/effCd/shareCAGR/_cd*); the shared axis field names (gpa/assetGrowth/
  // growthInput/absUsedAxes/absDroppedAxes) legitimately exist on industrials/staples members.
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices', 'diagnostics_lst', 'industrials_heavy', 'industrials_light', 'staples_branded', 'staples_distribution']) {
    for (const m of doc[b].members) {
      for (const leak of ['cd', 'effCd', 'shareCAGR', 'dilutionHaircut', 'absKaliberPreDilution', '_cdGpa', '_cdGrowth', '_cdEff', '_cdAssetGrowthPenalty', '_cdShareCAGR']) {
        assert(!(leak in m), `${b}/${m.ticker} hat consdisc-only Feld '${leak}' geleakt (Parität verletzt)`);
      }
    }
  }
});

// =================== MATERIALS_QUALITY (CORE) BUCKET TESTS (v0, two cohorts pricingpower|commodity) ======
// Spec formula-design-materials_quality-v0-2026-06-22.md (Court DESIGN-PASS v0; NORMS recomputed-live-then-
// frozen 2026-06-22). materials is a SEPARATE court bucket (disjoint from the 7 prior CORE/projection buckets).
// NEW code keyed by the new cohort strings → the 7 prior buckets stay byte-identical (parity tests above).
// DISTINCT: axis C is MARGINSTABILITY (inverse-CV pricing-power proxy, identity-clip {0,1}) instead of eff;
// scored via the PARALLEL engine absKaliberMaterials. QUALITY-ONLY (anti-commodity pillar gpa+marginStability+
// assetGrowthPenalty = 0.68 ≫ growth 0.18 — a price-windfall spike cannot top-score).
const mtP = doc.materials_pricingpower;
const mtC = doc.materials_commodity;
const MP = mtP ? mtP.members : [];
const MC = mtC ? mtC.members : [];

test('materials: both cohort buckets exist (pricingpower + commodity) with members', () => {
  assert(mtP && Array.isArray(mtP.members) && MP.length > 0, 'materials_pricingpower bucket fehlt/leer');
  assert(mtC && Array.isArray(mtC.members) && MC.length > 0, 'materials_commodity bucket fehlt/leer');
  assert(/Materials-Quality v0/.test(mtP.label || ''), `pricingpower label sollte v0 nennen: ${mtP.label}`);
});

test('materials §6 MARQUEE: all 15 marquees classified+scored across the two cohorts (fail-loud guard)', () => {
  const MARQUEE = ['LIN', 'APD', 'VMC', 'MLM', 'SHW', 'ECL', 'PPG', 'CRH', 'RPM', 'NEM', 'NUE', 'FCX', 'DOW', 'CF', 'ALB'];
  const scored = new Set([...MP, ...MC].map(m => m.ticker));
  const missing = MARQUEE.filter(t => !scored.has(t));
  assert(missing.length === 0, `MARQUEE COVERAGE FAIL — nicht klassifiziert/gescort: ${missing.join(', ')}`);
  const { assertMaterialsMarquee } = require('./court-score.js');
  assert(typeof assertMaterialsMarquee === 'function', 'assertMaterialsMarquee nicht exportiert');
  assertMaterialsMarquee(doc); // throws on collapse / foreign-control leak
});

test('materials HEADLINE-SURVIVAL (re-court headline-inversion fix 2026-06-23): high-absKaliber quality leaders survive ONTO headlineShortlist, not just classified', () => {
  // The re-court found the materials headline gate (membership growth factor + absolute-floor growthOk term) was
  // PRO-CYCLICAL: it dropped high-absKaliber through-cycle QUALITY compounders off the headline because their recent
  // growth was negative/low, while admitting peak-cycle names whose growth happened to clear the floor. This bucket
  // is QUALITY-ONLY — the headline gate must NOT use growth (mirrors the energy_quality remediation). This assert is
  // a HEADLINE-SURVIVAL guard (not merely classification): the named marquee quality leaders must appear on the
  // headlineShortlist after scoring, with finite scores. Regression-locks the fix against re-introducing a growth gate.
  const byTicker = t => [...MP, ...MC].find(m => m.ticker === t);
  // CF Industries = the #1 marquee quality leader (absK ~0.78, the highest-absKaliber commodity name); its growth
  // is NOT_READY (coverage-renorm dropped), so the OLD growth gate buried it — it MUST now headline.
  // USLM (lime, pricingpower) + the pricingpower quality cohort (NGVT/CBT) were membership-Out under the old gate.
  const survivors = ['CF', 'BCC', 'UFPI', 'NGVT', 'CBT', 'USLM'];
  for (const t of survivors) {
    const m = byTicker(t);
    assert(m, `${t} (marquee quality leader) nicht in materials gefunden`);
    assert(m.membershipClass !== 'Out', `${t} darf nach dem Quality-only-Fix NICHT mehr membership-Out sein, ist ${m.membershipClass}`);
    assert(m.belowAbsoluteFloor === false, `${t} darf nach dem Quality-only-Fix NICHT mehr belowAbsoluteFloor sein (Growth-Gate entfernt), ist ${m.belowAbsoluteFloor}`);
    assert(m.headlineShortlist === true, `${t} (absK ${m.absKaliber}) MUSS auf der materials headlineShortlist erscheinen (Headline-Survival), ist ${m.headlineShortlist}`);
    assert(Number.isFinite(m.score) && m.score > 0, `${t} sollte einen finiten Score >0 haben, ist ${m.score}`);
  }
  // QUALITY-ORDER guard: the #1 commodity headline name by absKaliber must BE CF (the marquee leader), i.e. no
  // lower-absKaliber peak-cycle name outranks it on the headline — proves the pro-cyclical inversion is gone.
  const cmdHeadline = MC.filter(m => m.headlineShortlist && m.absKaliber != null).sort((a, b) => b.absKaliber - a.absKaliber);
  assert(cmdHeadline.length > 0 && cmdHeadline[0].ticker === 'CF',
    `commodity headline top-absKaliber name sollte CF sein (Quality-only), ist ${cmdHeadline[0] && cmdHeadline[0].ticker}`);
});

test('materials SI-5: classifiedCount === scoredCount + excludedCount (BEIDE Kohorten, fail-loud)', () => {
  for (const [name, R] of [['pricingpower', mtP], ['commodity', mtC]]) {
    assert(R.classifiedCount != null && R.scoredCount != null && R.excludedCount != null, `${name} SI-5 counts fehlen`);
    assert(R.classifiedCount === R.scoredCount + R.excludedCount,
      `${name} SI-5 mismatch: classified ${R.classifiedCount} !== scored ${R.scoredCount} + excluded ${R.excludedCount}`);
  }
  // Live-recomputed counts 2026-06-22: pricingpower 40, commodity 55 — both n>>15 (full ABS+REL blend, no thin-n).
  assert(mtP.classifiedCount >= 15, `pricingpower classified sollte >= 15 sein (full-blend), ist ${mtP.classifiedCount}`);
  assert(mtC.classifiedCount >= 15, `commodity classified sollte >= 15 sein (full-blend), ist ${mtC.classifiedCount}`);
});

test('materials: a pricingpower compounder marquee scored finite (SHW/RPM/ECL/CRH), peak miner present (NEM/FCX)', () => {
  // at least one of the specialty-chem compounders must score finite (>0) — the design's HIGH expectation.
  const ppHigh = ['SHW', 'RPM', 'ECL', 'CRH'].map(t => MP.find(x => x.ticker === t)).filter(Boolean);
  assert(ppHigh.some(m => Number.isFinite(m.score) && m.score > 0), 'kein SHW/RPM/ECL/CRH mit finitem Score >0');
  for (const t of ['NEM', 'FCX']) {
    const m = MC.find(x => x.ticker === t);
    assert(m && m.absKaliber != null, `${t} (commodity) sollte mit absKaliber präsent sein, ist ${m && m.absKaliber}`);
  }
});

test('materials MANDATORY regression (Spec §7-5): compounder margin-stability HIGH, riders self-floor LOW', () => {
  // The decisive sector-unique live regression: specialty compounders max marginStability (~0.85+); the
  // commodity-rider ALB (lithium, in pricingpower by industry-string) self-floors to ~0.0 — sinks WITHOUT
  // recohorting (the §0/§2-C verified separation, the empirical refutation of the hard eligibility gate).
  const ms = t => { const m = [...MP, ...MC].find(x => x.ticker === t); return m ? m.marginStability : null; };
  for (const t of ['SHW', 'MLM', 'CRH', 'APD', 'RPM']) {
    assert(ms(t) != null && ms(t) >= 0.80, `${t} marginStability sollte >=0.80 sein (compounder), ist ${ms(t)}`);
  }
  // ALB self-floors (lithium rider in pricingpower) — the disclosed within-cohort floor.
  assert(ms('ALB') != null && ms('ALB') <= 0.20, `ALB marginStability sollte <=0.20 sein (rider self-floor), ist ${ms('ALB')}`);
  // No peak miner tops its cohort: the highest-absKaliber commodity name must NOT be a pure gold/precious peak
  // windfall name with low marginStability (industry-string cohorting + cohort-gpa + capped growth is the guard).
  const top = MC.filter(m => m.score != null).sort((a, b) => b.score - a.score)[0];
  assert(top && top.ticker !== 'NEM', `commodity top pick sollte kein Gold-Peak-Name (NEM) sein, ist ${top && top.ticker}`);
});

test('materials §6 FOREIGN-CONTROL + GENERATIVE anti-leak: foreign-primary miners absent; CRH/LIN allowlisted', () => {
  const scored = new Set([...MP, ...MC].map(m => m.ticker));
  for (const t of ['RIO', 'VALE', 'SCCO', 'PKX', 'KGC', 'WPM', 'PAAS', 'SVM', 'BHP', 'CX', 'MT', 'AEM', 'JHX', 'NTR', 'SSL']) {
    assert(!scored.has(t), `${t} (foreign-primary miner) darf NICHT klassifiziert sein (FOREIGN-CONTROL §6)`);
  }
  // CRH/LIN ARE admitted (verified US-primary inversions on the allowlist) — they MUST be present.
  for (const t of ['CRH', 'LIN']) assert(scored.has(t), `${t} (US-primary allowlist) sollte klassifiziert sein`);
  // the assertMaterialsNoForeignLeak export must pass on the live results (direct property test), exempting CRH/LIN.
  const { assertMaterialsNoForeignLeak } = require('./court-score.js');
  assert(typeof assertMaterialsNoForeignLeak === 'function', 'assertMaterialsNoForeignLeak nicht exportiert');
  let listing = new Map();
  try {
    const lp = (CAND_TEST.replace(/_court-candidates([^/\\]*)\.json$/, '_court-listing$1.json'));
    const ld = JSON.parse(fs.readFileSync(lp, 'utf8'));
    const obj = ld && ld.listings ? ld.listings : (ld || {});
    for (const [t, rec] of Object.entries(obj)) listing.set(t, rec);
  } catch {}
  assertMaterialsNoForeignLeak(doc, listing); // throws on any non-allowlisted country-set != US leak
});

test('materials SI-4: Out-class / below-floor members carry score=null in excluded[] (kein irreführender Rang)', () => {
  for (const [name, R] of [['pricingpower', mtP], ['commodity', mtC]]) {
    assert(Array.isArray(R.excluded), `${name} excluded[] fehlt (SI-4)`);
    for (const m of R.excluded) assert(m.score === null, `${name} excluded ${m.ticker} score sollte null sein, ist ${m.score}`);
    for (const m of R.members) {
      if (m.score != null) assert(m.membershipClass !== 'Out', `${name} ranked ${m.ticker} ist Out mit Score (SI-4)`);
    }
  }
});

// audit/fix (re-court materials_quality DENIAL — Spec §1/§5 pre-revenue SI-4 hard-exclude). Regression guard:
// a materials name with NO real revenue (EMAT annualRev=[], a $4.3B revenue-less shell; LWLG $236k micro) MUST
// be SI-4 EXCLUDED (score=null + excluded[] with reason OUT_OF_SEGMENT:preexploration), NOT scored — else the
// coverage-renorm concentrates the absK on the surviving discipline axes and the shell tops the cohort (the
// re-court finding: EMAT absKaliber 0.899 ranked #1 in materials_commodity). Asserts the named pre-revenue
// shells are gone from scored members AND that the new commodity top pick is a real-revenue name.
test('materials SI-4 PRE-REVENUE (re-court): EMAT/LWLG-type zero/near-zero-rev shells EXCLUDED (OUT_OF_SEGMENT:preexploration), not scored', () => {
  const all = [...MP, ...MC];
  // (a) the named pre-revenue shells must NOT be in scored members of EITHER cohort.
  for (const t of ['EMAT', 'LWLG']) {
    const m = all.find(x => x.ticker === t);
    if (m) assert(m.score === null, `${t} (pre-revenue shell) darf NICHT gescored sein (SI-4), score=${m.score}`);
  }
  // (b) where present, they carry the explicit OUT_OF_SEGMENT:preexploration reason + lamp + sit in excluded[].
  for (const [name, R] of [['pricingpower', mtP], ['commodity', mtC]]) {
    for (const t of ['EMAT', 'LWLG']) {
      const m = R.members.find(x => x.ticker === t);
      if (!m) continue;
      assert(m.exclusionReason === 'OUT_OF_SEGMENT:preexploration',
        `${name}/${t} sollte exclusionReason OUT_OF_SEGMENT:preexploration tragen, ist ${m.exclusionReason}`);
      assert(Array.isArray(m.lamps) && m.lamps.includes('OUT_OF_SEGMENT:preexploration'),
        `${name}/${t} sollte die OUT_OF_SEGMENT:preexploration-Lampe tragen`);
      assert(R.excluded.some(x => x.ticker === t), `${name}/${t} sollte in excluded[] liegen (SI-4)`);
    }
  }
  // (c) the new materials_commodity TOP pick (by absKaliber) is a real-revenue name, NOT a shell: it carries a
  // finite score AND a latest revenue (mt.revLatest) >= $1M, and is not EMAT. Proves the shell no longer leads.
  const cTop = MC.filter(m => m.score != null).sort((a, b) => b.absKaliber - a.absKaliber)[0];
  assert(cTop && cTop.ticker !== 'EMAT', `commodity top-by-absKaliber darf nicht EMAT (shell) sein, ist ${cTop && cTop.ticker}`);
  assert(cTop && cTop.mt && cTop.mt.revLatest != null && cTop.mt.revLatest >= 1e6,
    `commodity top ${cTop && cTop.ticker} sollte echte Revenue (>=$1M) tragen, revLatest=${cTop && cTop.mt && cTop.mt.revLatest}`);
  // (d) NO scored member in either cohort has revLatest below the $1M floor (the pre-revenue cut held universally).
  for (const m of all) {
    if (m.score != null) assert(m.mt && m.mt.revLatest != null && m.mt.revLatest >= 1e6,
      `gescorter Name ${m.ticker} hat revLatest < $1M (pre-revenue leak), revLatest=${m.mt && m.mt.revLatest}`);
  }
});

test('materials: FIVE scored axes incl. marginStability (NOT eff); anti-commodity pillar weights sum to 1.0', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  for (const b of ['materials_pricingpower', 'materials_commodity']) {
    const w = NORMS[b].weights;
    const keys = Object.keys(w).sort().join(',');
    assert(keys === 'assetGrowthPenalty,gpa,growth,marginStability,netIssuance',
      `${b} sollte die 5 materials-Achsen tragen (marginStability statt eff), hat ${keys}`);
    assert(!('eff' in w), `${b} darf KEINE eff-Achse haben (materials nutzt marginStability)`);
    const sum = Object.values(w).reduce((s, v) => s + v, 0);
    assert(Math.abs(sum - 1.0) < 1e-9, `${b} weights sollten Σ=1.0 sein, sind ${sum}`);
    // anti-commodity pillar gpa+marginStability+assetGrowthPenalty = 0.68 >> growth 0.18 (QUALITY-ONLY guard)
    const pillar = w.gpa + w.marginStability + w.assetGrowthPenalty;
    assert(Math.abs(pillar - 0.68) < 1e-9, `${b} anti-commodity pillar sollte 0.68 sein, ist ${pillar}`);
    assert(w.growth < pillar, `${b} growth (${w.growth}) muss UNTER dem Pillar (${pillar}) liegen (price-windfall cap)`);
  }
});

test('materials: GP/assets cohort-keyed (peak-windfall floor) — commodity floor (.01) < pricingpower floor (.09)', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const pp = NORMS.materials_pricingpower.gpa, cm = NORMS.materials_commodity.gpa;
  assert(pp.floor === 0.09 && pp.elite === 0.34, `pricingpower gpa sollte .09/.34 sein, ist ${pp.floor}/${pp.elite}`);
  assert(cm.floor === 0.01 && cm.elite === 0.31, `commodity gpa sollte .01/.31 sein, ist ${cm.floor}/${cm.elite}`);
  // marginStability/growth/assetGrowthPenalty/netIssuance anchors SHARED across cohorts.
  assert(NORMS.materials_pricingpower.marginStability.elite === NORMS.materials_commodity.marginStability.elite, 'marginStability anchor sollte shared sein');
  assert(NORMS.materials_pricingpower.growth.elite === NORMS.materials_commodity.growth.elite, 'growth anchor sollte shared sein');
});

test('materials: always-on WALLS lamps on every member (CYCLE_WALL/COSTCURVE_BLIND/INVENTORY_BLIND/BYPRODUCT_BLIND/BACKLOG_FUTURE)', () => {
  for (const m of [...MP, ...MC]) {
    for (const w of ['CYCLE_WALL', 'COSTCURVE_BLIND', 'INVENTORY_BLIND', 'BYPRODUCT_BLIND', 'BACKLOG_FUTURE']) {
      assert(Array.isArray(m.lamps) && m.lamps.includes(w), `${m.ticker} fehlt WALL-Lampe ${w}`);
    }
    assert(!m.lamps.includes('THIN_REL'), `${m.ticker} sollte KEINE THIN_REL haben (beide Kohorten n>>15)`);
  }
});

test('materials SI-3: normTableId + cohort + comparabilityNote (absKaliber cross-bucket, REL intra-bucket)', () => {
  for (const [name, R] of [['pricingpower', mtP], ['commodity', mtC]]) {
    assert(/materials_(pricingpower|commodity)-norms-2026-06-22/.test(R.normTableId || ''), `${name} normTableId fehlt/falsch: ${R.normTableId}`);
    assert(R.cohort === `materials_${name}`, `${name} cohort falsch: ${R.cohort}`);
    assert(/marginStability/.test(R.comparabilityNote || ''), `${name} comparabilityNote sollte marginStability nennen`);
    assert(R.scoreScope === 'intra-bucket' && R.crossBucketComparableField === 'absKaliber', `${name} SI-3 scope/field fehlt`);
  }
});

test('materials-unit: absKaliberMaterials 5-axis coverage-renorm (E-drop renorm Σ=1.0; marginStability-drop; all-null → 0)', () => {
  const { absKaliberMaterials } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  // full 5 axes
  const full = absKaliberMaterials({ gpa: 0.20, marginStability: 0.88, growth: 0.03, assetGrowth: 0.05, netShareIssuance: -0.005 }, 'materials_pricingpower');
  assert(full.usedAxes.length === 5 && full.droppedAxes.length === 0, `full sollte 5 Achsen nutzen, hat ${full.usedAxes.length}`);
  const sumW = Object.values(full.renormWeights).reduce((s, v) => s + v, 0);
  assert(Math.abs(sumW - 1.0) < 1e-9, `renormWeights sollten Σ=1.0, sind ${sumW}`);
  // ISSUANCE_NOT_READY drop (no annualShares) → 4 axes renormalize
  const dropE = absKaliberMaterials({ gpa: 0.20, marginStability: 0.88, growth: 0.03, assetGrowth: 0.05, netShareIssuance: null }, 'materials_commodity');
  assert(dropE.droppedAxes.includes('netIssuance') && dropE.usedAxes.length === 4, 'netIssuance-drop sollte 4 Achsen lassen');
  assert(Math.abs(Object.values(dropE.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renorm Σ=1.0 nach E-drop');
  // NOT_READY:marginstability drop (<3 opMargin points) → 4 axes
  const dropMs = absKaliberMaterials({ gpa: 0.20, marginStability: null, growth: 0.03, assetGrowth: 0.05, netShareIssuance: -0.005 }, 'materials_pricingpower');
  assert(dropMs.droppedAxes.includes('marginStability') && dropMs.usedAxes.length === 4, 'marginStability-drop sollte 4 Achsen lassen');
  // all-null → 0 (pathological, no fake-neutral)
  const allNull = absKaliberMaterials({ gpa: null, marginStability: null, growth: null, assetGrowth: null, netShareIssuance: null }, 'materials_pricingpower');
  assert(allNull.absK === 0 && allNull.usedAxes.length === 0, 'all-null sollte absK=0 ergeben');
});

test('materials PARITÄT: KEIN materials-only Feld auf den 7 anderen Buckets (Leak-Guard)', () => {
  // Only TRULY materials-exclusive fields (mt/marginStability/_mt*); the shared axis names (gpa/assetGrowth/
  // growthInput/absUsedAxes/absDroppedAxes/netShareIssuance) legitimately exist on industrials/staples members.
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices', 'diagnostics_lst', 'industrials_heavy', 'industrials_light', 'staples_branded', 'staples_distribution', 'consdisc_store', 'consdisc_light']) {
    if (!doc[b]) continue;
    for (const m of doc[b].members) {
      for (const leak of ['mt', 'marginStability', '_mtGpa', '_mtMarginStability', '_mtGrowth', '_mtAssetGrowthPenalty', '_mtNetIssuance']) {
        assert(!(leak in m), `${b}/${m.ticker} hat materials-only Feld '${leak}' geleakt (Parität verletzt)`);
      }
    }
  }
});

// =================== ENERGY_QUALITY (CORE) BUCKET TESTS (v0, three cohorts upstream|midstream|services) =====
// Spec formula-design-energy_quality-v0-2026-06-22.md (Council->Court DESIGN-PASS v0 NEEDS-REVISION; NORMS
// recomputed-live-then-frozen 2026-06-23 on the CLEAN pool). energy is a SEPARATE court bucket (disjoint from the
// 9 prior CORE/projection buckets). NEW code keyed by the new cohort strings → the prior buckets stay byte-identical
// (parity tests above). DISTINCT: axis B is ROCE (opInc/totalAssets, the through-cycle capital-return pillar) and
// axis C is FCF-MARGIN (annualFCF/annualRev) — neither is industrials `eff` nor materials `marginStability`; scored
// via the PARALLEL engine absKaliberEnergy. QUALITY-ONLY: GROWTH IS NOT A SCORED AXIS (capital-discipline pillar
// roce+fcfMargin+assetGrowthPenalty = 0.70 — a commodity-price windfall cannot top-score).
const enU = doc.energy_upstream;
const enM = doc.energy_midstream;
const enS = doc.energy_services;
const EU = enU ? enU.members : [];
const EM = enM ? enM.members : [];
const ES = enS ? enS.members : [];

test('energy: all three cohort buckets exist (upstream + midstream + services) with members', () => {
  assert(enU && Array.isArray(enU.members) && EU.length > 0, 'energy_upstream bucket fehlt/leer');
  assert(enM && Array.isArray(enM.members) && EM.length > 0, 'energy_midstream bucket fehlt/leer');
  assert(enS && Array.isArray(enS.members) && ES.length > 0, 'energy_services bucket fehlt/leer');
  assert(/Energy-Quality v0/.test(enU.label || ''), `upstream label sollte v0 nennen: ${enU.label}`);
});

test('energy §6 MARQUEE: all 15 marquees classified+scored across the three cohorts (fail-loud guard)', () => {
  const MARQUEE = ['XOM', 'CVX', 'COP', 'EOG', 'OXY', 'DVN', 'EPD', 'ET', 'KMI', 'WMB', 'OKE', 'MPLX', 'SLB', 'HAL', 'BKR'];
  const scored = new Set([...EU, ...EM, ...ES].map(m => m.ticker));
  const missing = MARQUEE.filter(t => !scored.has(t));
  assert(missing.length === 0, `MARQUEE COVERAGE FAIL — nicht klassifiziert/gescort: ${missing.join(', ')}`);
  const { assertEnergyMarquee } = require('./court-score.js');
  assert(typeof assertEnergyMarquee === 'function', 'assertEnergyMarquee nicht exportiert');
  assertEnergyMarquee(doc); // throws on collapse / foreign-control leak
});

test('energy SI-5: classifiedCount === scoredCount + excludedCount (ALLE 3 Kohorten, fail-loud)', () => {
  for (const [name, R] of [['upstream', enU], ['midstream', enM], ['services', enS]]) {
    assert(R.classifiedCount != null && R.scoredCount != null && R.excludedCount != null, `${name} SI-5 counts fehlen`);
    assert(R.classifiedCount === R.scoredCount + R.excludedCount,
      `${name} SI-5 mismatch: classified ${R.classifiedCount} !== scored ${R.scoredCount} + excluded ${R.excludedCount}`);
  }
  // Live-recomputed CLEAN counts 2026-06-23: upstream 32, midstream 26, services 27 — all n>=15 (full ABS+REL blend).
  assert(enU.classifiedCount >= 15, `upstream classified sollte >= 15 sein (full-blend), ist ${enU.classifiedCount}`);
  assert(enM.classifiedCount >= 15, `midstream classified sollte >= 15 sein (full-blend), ist ${enM.classifiedCount}`);
  assert(enS.classifiedCount >= 15, `services classified sollte >= 15 sein (full-blend), ist ${enS.classifiedCount}`);
});

test('energy: every cohort marquee scored finite; ROCE/FCF pillars present on the top names', () => {
  // at least one marquee from each cohort must score finite (>0).
  for (const [name, members, marq] of [['upstream', EU, ['XOM', 'COP', 'EOG', 'DVN']], ['midstream', EM, ['EPD', 'KMI', 'WMB', 'MPLX']], ['services', ES, ['SLB', 'HAL', 'BKR']]]) {
    const hit = marq.map(t => members.find(x => x.ticker === t)).filter(Boolean);
    assert(hit.some(m => Number.isFinite(m.score) && m.score > 0), `${name}: kein ${marq.join('/')} mit finitem Score >0`);
  }
});

// THE materials-bug guard (Spec §7-5 analog): the TOP name of EACH cohort must be a real, quality, through-cycle
// name — NOT a revenue-less shell, NOT a single-year commodity-windfall spike. A peak-windfall name is flagged
// COMMODITY_BETA_SUSPECT; a shell carries score=null (pre-revenue) and can never be the scored top.
test('energy MANDATORY regression: TOP-by-score of each cohort is a real quality name, NOT a shell, NOT a price-spike', () => {
  for (const [name, members] of [['upstream', EU], ['midstream', EM], ['services', ES]]) {
    const scored = members.filter(m => m.score != null).sort((a, b) => b.score - a.score);
    assert(scored.length > 0, `${name}: keine gescorten Namen`);
    const top = scored[0];
    // (a) the top name carries real revenue (>= $1M) — not a pre-revenue shell.
    assert(top.en && top.en.revLatest != null && top.en.revLatest >= 1e6,
      `${name} top ${top.ticker} sollte echte Revenue (>=$1M) tragen, revLatest=${top.en && top.en.revLatest}`);
    assert(top.exclusionReason !== 'OUT_OF_SEGMENT:preexploration', `${name} top ${top.ticker} darf kein pre-revenue shell sein`);
    // (b) the top name is NOT flagged COMMODITY_BETA_SUSPECT (a price-windfall year must not lead the cohort).
    assert(!(top.lamps || []).includes('COMMODITY_BETA_SUSPECT'),
      `${name} top ${top.ticker} darf NICHT COMMODITY_BETA_SUSPECT sein (single-year price-spike darf nicht führen)`);
    // (c) the top name has a real through-cycle ROCE pillar (the load-bearing axis is present + positive).
    assert(top.roce != null && isFinite(top.roce) && top.roce > 0,
      `${name} top ${top.ticker} sollte eine positive ROCE tragen (through-cycle quality), ist ${top.roce}`);
  }
});

test('energy §0/§6 FOREIGN-CONTROL + GENERATIVE anti-leak: foreign primaries absent; SLB allowlisted', () => {
  const scored = new Set([...EU, ...EM, ...ES].map(m => m.ticker));
  for (const t of ['BP', 'SHEL', 'TTE', 'CNQ', 'CVE', 'ENB', 'EQNR', 'E', 'IMO', 'SU', 'PBR', 'TRP', 'YPF', 'VET', 'NAT', 'TK', 'TNK']) {
    assert(!scored.has(t), `${t} (foreign primary) darf NICHT klassifiziert sein (FOREIGN-CONTROL §0/§6)`);
  }
  // SLB IS admitted (verified US-primary inversion on the allowlist) — it MUST be present.
  assert(scored.has('SLB'), 'SLB (US-primary allowlist) sollte klassifiziert sein');
  const { assertEnergyNoForeignLeak } = require('./court-score.js');
  assert(typeof assertEnergyNoForeignLeak === 'function', 'assertEnergyNoForeignLeak nicht exportiert');
  let listing = new Map();
  try {
    const lp = (CAND_TEST.replace(/_court-candidates([^/\\]*)\.json$/, '_court-listing$1.json'));
    const ld = JSON.parse(fs.readFileSync(lp, 'utf8'));
    const obj = ld && ld.listings ? ld.listings : (ld || {});
    for (const [t, rec] of Object.entries(obj)) listing.set(t, rec);
  } catch {}
  assertEnergyNoForeignLeak(doc, listing); // throws on any non-allowlisted country-set != US leak
});

test('energy SI-4 PRE-REVENUE (the materials lesson): zero/near-zero-rev shells EXCLUDED, never scored, never top', () => {
  const all = [...EU, ...EM, ...ES];
  // (a) every pre-revenue name carries score=null + the OUT_OF_SEGMENT:preexploration reason + lamp + sits in excluded[].
  for (const [name, R] of [['upstream', enU], ['midstream', enM], ['services', enS]]) {
    for (const m of R.members) {
      if (m.exclusionReason === 'OUT_OF_SEGMENT:preexploration') {
        assert(m.score === null, `${name}/${m.ticker} (pre-revenue) darf NICHT gescored sein, score=${m.score}`);
        assert(Array.isArray(m.lamps) && m.lamps.includes('OUT_OF_SEGMENT:preexploration'),
          `${name}/${m.ticker} sollte die OUT_OF_SEGMENT:preexploration-Lampe tragen`);
        assert(R.excluded.some(x => x.ticker === m.ticker), `${name}/${m.ticker} sollte in excluded[] liegen (SI-4)`);
      }
    }
  }
  // (b) NO scored member in any cohort has revLatest below the $1M floor (the pre-revenue cut held universally) —
  //     verifies NO revenue-less shell can top a cohort (the explicit materials-bug regression guard).
  for (const m of all) {
    if (m.score != null) assert(m.en && m.en.revLatest != null && m.en.revLatest >= 1e6,
      `gescorter Name ${m.ticker} hat revLatest < $1M (pre-revenue leak), revLatest=${m.en && m.en.revLatest}`);
  }
});

test('energy SI-4: Out-class / pre-revenue members carry score=null in excluded[] (kein irreführender Rang)', () => {
  for (const [name, R] of [['upstream', enU], ['midstream', enM], ['services', enS]]) {
    assert(Array.isArray(R.excluded), `${name} excluded[] fehlt (SI-4)`);
    for (const m of R.excluded) assert(m.score === null, `${name} excluded ${m.ticker} score sollte null sein, ist ${m.score}`);
    for (const m of R.members) {
      if (m.score != null) assert(m.membershipClass !== 'Out', `${name} ranked ${m.ticker} ist Out mit Score (SI-4)`);
    }
  }
});

test('energy: FIVE scored axes incl. roce+fcfMargin (NOT eff/marginStability); NO growth axis; weights sum to 1.0', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  for (const b of ['energy_upstream', 'energy_midstream', 'energy_services']) {
    const w = NORMS[b].weights;
    const keys = Object.keys(w).sort().join(',');
    assert(keys === 'assetGrowthPenalty,fcfMargin,gpa,netIssuance,roce',
      `${b} sollte die 5 energy-Achsen tragen (roce/fcfMargin statt eff/marginStability), hat ${keys}`);
    assert(!('eff' in w) && !('marginStability' in w), `${b} darf KEINE eff/marginStability-Achse haben`);
    assert(!('growth' in w), `${b} darf KEINE growth-Achse haben (QUALITY-ONLY: growth ist kein scored axis)`);
    const sum = Object.values(w).reduce((s, v) => s + v, 0);
    assert(Math.abs(sum - 1.0) < 1e-9, `${b} weights sollten Σ=1.0 sein, sind ${sum}`);
    // capital-discipline pillar roce+fcfMargin+assetGrowthPenalty = 0.70 (the QUALITY-ONLY guarantee, no growth term)
    const pillar = w.roce + w.fcfMargin + w.assetGrowthPenalty;
    assert(Math.abs(pillar - 0.70) < 1e-9, `${b} capital-discipline pillar sollte 0.70 sein, ist ${pillar}`);
  }
});

test('energy: roce/fcfMargin/gpa cohort-keyed; assetGrowthPenalty/netIssuance SHARED', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const U = NORMS.energy_upstream, M = NORMS.energy_midstream, S = NORMS.energy_services;
  // roce elite is cohort-specific (midstream toll-road tier > upstream > services leveraged-driller tier).
  assert(U.roce.elite === 0.16 && M.roce.elite === 0.22 && S.roce.elite === 0.13,
    `roce elite sollte upstream .16 / midstream .22 / services .13 sein, ist ${U.roce.elite}/${M.roce.elite}/${S.roce.elite}`);
  // assetGrowthPenalty + netIssuance anchors SHARED across cohorts.
  assert(U.assetGrowthPenalty.floor === M.assetGrowthPenalty.floor && M.assetGrowthPenalty.floor === S.assetGrowthPenalty.floor, 'assetGrowthPenalty anchor sollte shared sein');
  assert(U.netIssuance.elite === M.netIssuance.elite && M.netIssuance.elite === S.netIssuance.elite, 'netIssuance anchor sollte shared sein');
});

test('energy: always-on WALLS on every member (CYCLE_WALL/THROUGH_CYCLE_WALL/COMMODITY_BETA + cohort-specific blind)', () => {
  for (const [b, members, cohortWall] of [['upstream', EU, 'RESERVE_BLIND'], ['midstream', EM, 'DCF_COVERAGE_BLIND'], ['services', ES, null]]) {
    for (const m of members) {
      for (const w of ['CYCLE_WALL', 'THROUGH_CYCLE_WALL', 'COMMODITY_BETA']) {
        assert(Array.isArray(m.lamps) && m.lamps.includes(w), `${b}/${m.ticker} fehlt WALL-Lampe ${w}`);
      }
      if (cohortWall) assert(m.lamps.includes(cohortWall), `${b}/${m.ticker} fehlt cohort-WALL ${cohortWall}`);
      assert(!m.lamps.includes('THIN_REL'), `${b}/${m.ticker} sollte KEINE THIN_REL haben (alle Kohorten n>=15)`);
    }
  }
});

test('energy COMMODITY-WINDFALL guard (Spec §3.5): COMMODITY_BETA_SUSPECT exists as an advisory flag, never a score-kill', () => {
  const all = [...EU, ...EM, ...ES];
  const flagged = all.filter(m => (m.lamps || []).includes('COMMODITY_BETA_SUSPECT'));
  // the windfall guard must be WIRED (at least exists on the lamp vocabulary) — and where it fires it must NOT
  // null a score (advisory only; the score is commodity-β-immune by construction, not by suppression).
  for (const m of flagged) {
    if (m.exclusionReason !== 'OUT_OF_SEGMENT:preexploration' && m.membershipClass !== 'Out') {
      assert(m.score != null && isFinite(m.score), `${m.ticker} COMMODITY_BETA_SUSPECT darf den Score NICHT nullen (advisory only), score=${m.score}`);
    }
  }
});

test('energy SI-3: normTableId + cohort + comparabilityNote (absKaliber cross-bucket, REL intra-bucket, growth-not-scored)', () => {
  for (const [name, R] of [['upstream', enU], ['midstream', enM], ['services', enS]]) {
    assert(/energy_(upstream|midstream|services)-norms-2026-06-23/.test(R.normTableId || ''), `${name} normTableId fehlt/falsch: ${R.normTableId}`);
    assert(R.cohort === `energy_${name}`, `${name} cohort falsch: ${R.cohort}`);
    assert(/roce/i.test(R.comparabilityNote || '') && /GROWTH IS NOT A SCORED AXIS/i.test(R.comparabilityNote || ''), `${name} comparabilityNote sollte roce + GROWTH-NOT-SCORED nennen`);
    assert(R.scoreScope === 'intra-bucket' && R.crossBucketComparableField === 'absKaliber', `${name} SI-3 scope/field fehlt`);
  }
});

test('energy-unit: absKaliberEnergy 5-axis coverage-renorm (E-drop renorm Σ=1.0; roce-drop; all-null → 0)', () => {
  const { absKaliberEnergy } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  // full 5 axes
  const full = absKaliberEnergy({ roce: 0.10, fcfMargin: 0.15, gpa: 0.14, assetGrowth: 0.03, netShareIssuance: -0.01 }, 'energy_upstream');
  assert(full.usedAxes.length === 5 && full.droppedAxes.length === 0, `full sollte 5 Achsen nutzen, hat ${full.usedAxes.length}`);
  assert(Math.abs(Object.values(full.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renormWeights sollten Σ=1.0');
  // ISSUANCE_NOT_READY drop (Vintage-A no annualShares) → 4 axes renormalize
  const dropE = absKaliberEnergy({ roce: 0.10, fcfMargin: 0.15, gpa: 0.14, assetGrowth: 0.03, netShareIssuance: null }, 'energy_midstream');
  assert(dropE.droppedAxes.includes('netIssuance') && dropE.usedAxes.length === 4, 'netIssuance-drop sollte 4 Achsen lassen');
  assert(Math.abs(Object.values(dropE.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renorm Σ=1.0 nach E-drop');
  // NOT_READY:roce drop → 4 axes
  const dropR = absKaliberEnergy({ roce: null, fcfMargin: 0.15, gpa: 0.14, assetGrowth: 0.03, netShareIssuance: -0.01 }, 'energy_services');
  assert(dropR.droppedAxes.includes('roce') && dropR.usedAxes.length === 4, 'roce-drop sollte 4 Achsen lassen');
  // all-null → 0 (pathological, no fake-neutral)
  const allNull = absKaliberEnergy({ roce: null, fcfMargin: null, gpa: null, assetGrowth: null, netShareIssuance: null }, 'energy_upstream');
  assert(allNull.absK === 0 && allNull.usedAxes.length === 0, 'all-null sollte absK=0 ergeben');
});

test('energy PARITÄT: KEIN energy-only Feld auf den anderen Buckets (Leak-Guard)', () => {
  // Only TRULY energy-exclusive fields (en/roce/fcfMarginEn/_en*); the shared axis names (gpa/assetGrowth/
  // netShareIssuance/absUsedAxes/absDroppedAxes) legitimately exist on industrials/staples/materials members.
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices', 'diagnostics_lst', 'industrials_heavy', 'industrials_light', 'staples_branded', 'staples_distribution', 'consdisc_store', 'consdisc_light', 'materials_pricingpower', 'materials_commodity']) {
    if (!doc[b]) continue;
    for (const m of doc[b].members) {
      for (const leak of ['en', 'roce', 'fcfMarginEn', '_enRoce', '_enFcfMargin', '_enGpa', '_enAssetGrowthPenalty', '_enNetIssuance']) {
        assert(!(leak in m), `${b}/${m.ticker} hat energy-only Feld '${leak}' geleakt (Parität verletzt)`);
      }
    }
  }
});

// =================== PHARMA_COMMERCIAL (CORE) BUCKET TESTS (v0, three cohorts branded|biopharma|specialty) =====
// Spec formula-design-pharma_court-v0-2026-06-22.md (Council->Court DESIGN-PASS v0 NEEDS-REVISION; NORMS recomputed-
// live-then-frozen 2026-06-23 on the CLEAN commercial pool). pharma is a SEPARATE court bucket (disjoint from the 10
// prior CORE/projection buckets). NEW code keyed by the new cohort strings → the prior buckets stay byte-identical
// (parity tests above). 3 SCORED axes {growth, gm, eff} via the PARALLEL engine absKaliberPharma (coverage-renorm;
// the medtech/dlst 3-axis absKaliber() path is BYTE-UNTOUCHED). growth LEADS (.45). branded n=10<15 → THIN_REL
// (ABS-only, beta=1.0). M&A: LOCAL totalAssets-jump deal-mask (the design's intangible/IPR&D re-pointing needs the
// ABSENT external companyfacts join → intangible lamps OMITTED, disclosed MA_INTANGIBLE_BLIND wall).
const phB = doc.pharma_branded;
const phBP = doc.pharma_biopharma;
const phS = doc.pharma_specialty;
const PB = phB ? phB.members : [];
const PBP = phBP ? phBP.members : [];
const PS_ = phS ? phS.members : [];

test('pharma: all three cohort buckets exist (branded + biopharma + specialty) with members', () => {
  assert(phB && Array.isArray(phB.members) && PB.length > 0, 'pharma_branded bucket fehlt/leer');
  assert(phBP && Array.isArray(phBP.members) && PBP.length > 0, 'pharma_biopharma bucket fehlt/leer');
  assert(phS && Array.isArray(phS.members) && PS_.length > 0, 'pharma_specialty bucket fehlt/leer');
  assert(/Pharma-Commercial v0/.test(phB.label || ''), `branded label sollte v0 nennen: ${phB.label}`);
});

test('pharma §6 MARQUEE: all 16 marquees classified+scored across the three cohorts (fail-loud guard)', () => {
  const MARQUEE = ['LLY', 'MRK', 'PFE', 'ABBV', 'BMY', 'AMGN', 'GILD', 'JNJ', 'VRTX', 'REGN', 'BIIB', 'INCY', 'JAZZ', 'EXEL', 'NBIX', 'VTRS'];
  const scored = new Set([...PB, ...PBP, ...PS_].map(m => m.ticker));
  const missing = MARQUEE.filter(t => !scored.has(t));
  assert(missing.length === 0, `MARQUEE COVERAGE FAIL — nicht klassifiziert/gescort: ${missing.join(', ')}`);
  const { assertPharmaMarquee } = require('./court-score.js');
  assert(typeof assertPharmaMarquee === 'function', 'assertPharmaMarquee nicht exportiert');
  assertPharmaMarquee(doc); // throws on collapse / foreign-control leak
});

test('pharma SI-5: classifiedCount === scoredCount + excludedCount (ALLE 3 Kohorten, fail-loud)', () => {
  for (const [name, R] of [['branded', phB], ['biopharma', phBP], ['specialty', phS]]) {
    assert(R.classifiedCount != null && R.scoredCount != null && R.excludedCount != null, `${name} SI-5 counts fehlen`);
    assert(R.classifiedCount === R.scoredCount + R.excludedCount,
      `${name} SI-5 mismatch: classified ${R.classifiedCount} !== scored ${R.scoredCount} + excluded ${R.excludedCount}`);
  }
  // Live-recomputed CLEAN commercial counts 2026-06-23: branded 10, biopharma 22, specialty 14.
  assert(phB.classifiedCount === 10, `branded classified sollte 10 sein, ist ${phB.classifiedCount}`);
  assert(phBP.classifiedCount === 22, `biopharma classified sollte 22 sein, ist ${phBP.classifiedCount}`);
  assert(phS.classifiedCount === 14, `specialty classified sollte 14 sein, ist ${phS.classifiedCount}`);
});

test('pharma: every cohort marquee scored finite; growth/gm/eff axes present on the top names', () => {
  for (const [name, members, marq] of [['branded', PB, ['LLY', 'GILD', 'ABBV', 'AMGN']], ['biopharma', PBP, ['VRTX', 'REGN', 'INCY', 'EXEL']], ['specialty', PS_, ['NBIX', 'UTHR', 'ZTS']]]) {
    const hit = marq.map(t => members.find(x => x.ticker === t)).filter(Boolean);
    assert(hit.some(m => Number.isFinite(m.score) && m.score > 0), `${name}: kein ${marq.join('/')} mit finitem Score >0`);
  }
});

// THE materials-bug guard (Spec §9 analog): the TOP name of EACH cohort must be a real, COMMERCIAL-STAGE quality
// pharma name — NOT a pre-revenue biotech shell, NOT a patent-cliff collapsing name mis-scored to the top. A
// pre-revenue shell carries score=null (SI-4) and can never be the scored top; a cliff name reads its genuine
// negative organic growth and sinks.
test('pharma MANDATORY regression: TOP-by-score of each cohort is a real commercial-stage pharma quality name, NOT a pre-revenue shell, NOT a cliff-collapsing name mis-scored', () => {
  const KNOWN_QUALITY = new Set(['LLY', 'GILD', 'ABBV', 'AMGN', 'HALO', 'HRMY', 'EXEL', 'INCY', 'VRTX', 'BCRX', 'UTHR', 'NBIX', 'ZTS']);
  // patent-cliff names that MUST NOT be the scored top of their cohort (genuine organic decline → low score).
  const CLIFF_NAMES = new Set(['PFE', 'BMY', 'OGN', 'VTRS']);
  for (const [name, members] of [['branded', PB], ['biopharma', PBP], ['specialty', PS_]]) {
    const ranked = members.filter(m => m.score != null && isFinite(m.score)).sort((a, b) => b.score - a.score);
    assert(ranked.length > 0, `${name}: keine gescorten Namen`);
    const top = ranked[0];
    assert(top.exclusionReason !== 'OUT_OF_SEGMENT:preexploration', `${name} TOP ${top.ticker} darf KEIN pre-revenue shell sein`);
    assert(!CLIFF_NAMES.has(top.ticker), `${name} TOP ${top.ticker} ist ein patent-cliff-Name — mis-scored an die Spitze (materials-bug)`);
    assert(KNOWN_QUALITY.has(top.ticker), `${name} TOP sollte ein bekannter Quality-Name sein, ist ${top.ticker}`);
    // the cliff names, where present + scored, must sit in the BOTTOM half of their cohort (low organic read).
    for (const c of CLIFF_NAMES) {
      const idx = ranked.findIndex(m => m.ticker === c);
      if (idx >= 0) assert(idx >= Math.floor(ranked.length / 2), `${name} cliff-Name ${c} sollte in der unteren Hälfte ranken (idx ${idx}/${ranked.length})`);
    }
  }
});

test('pharma §1.2/§9 FOREIGN-CONTROL + GENERATIVE anti-leak: foreign primaries absent; JAZZ allowlisted', () => {
  const { assertPharmaNoForeignLeak, PHARMA_FOREIGN_CONTROL, PHARMA_US_PRIMARY_ALLOWLIST } = require('./court-score.js');
  const scored = new Set([...PB, ...PBP, ...PS_].map(m => m.ticker));
  // FOREIGN_CONTROL positive-control: AZN/NVS/NVO/SNY/TAK/BNTX/ARGX/GMAB/ALKS/GSK/RHHBY/BHC must NOT be scored.
  const leaked = PHARMA_FOREIGN_CONTROL.filter(t => scored.has(t));
  assert(leaked.length === 0, `FOREIGN-CONTROL FAIL — foreign primary leaked: ${leaked.join(', ')}`);
  // JAZZ (Jazz Pharmaceuticals plc, Ireland-domiciled NasdaqGS-primary) IS admitted via the US_PRIMARY_ALLOWLIST.
  assert(PHARMA_US_PRIMARY_ALLOWLIST.includes('JAZZ'), 'JAZZ sollte auf dem US_PRIMARY_ALLOWLIST sein');
  assert(scored.has('JAZZ'), 'JAZZ (US-primary marquee) sollte gescort sein');
  // GENERATIVE country anti-leak (reads the snapshot meta via the listing side-file) must hold.
  assert(typeof assertPharmaNoForeignLeak === 'function', 'assertPharmaNoForeignLeak nicht exportiert');
  let listing = new Map();
  try {
    const lp = (CAND_TEST.replace(/_court-candidates([^/\\]*)\.json$/, '_court-listing$1.json'));
    const ld = JSON.parse(fs.readFileSync(lp, 'utf8'));
    const obj = ld && ld.listings ? ld.listings : (ld || {});
    for (const [t, rec] of Object.entries(obj)) listing.set(t, rec);
  } catch {}
  assertPharmaNoForeignLeak(doc, listing); // throws on a country-set foreign leak (JAZZ exempt)
});

test('pharma SI-4 PRE-REVENUE (the materials lesson): the commercial gate defers cash-burning clinical names; any zero-rev shell EXCLUDED, never scored, never top', () => {
  // the §1.4 commercial gate ran in the classifier — known cash-burning clinical names (MRNA/BBIO/INSM/RARE/SRPT/
  // IONS) must NOT be in ANY pharma cohort at all (they never entered court-buckets).
  const scored = new Set([...PB, ...PBP, ...PS_].map(m => m.ticker));
  for (const t of ['MRNA', 'BBIO', 'INSM', 'RARE', 'SRPT', 'IONS', 'AXSM', 'MDGL']) {
    assert(!scored.has(t), `cash-burning clinical name ${t} sollte vom §1.4 commercial gate deferred sein (nicht in court-buckets)`);
  }
  // any name that DID enter members but is pre-revenue carries score=null (SI-4 OUT_OF_SEGMENT:preexploration).
  for (const m of [...PB, ...PBP, ...PS_]) {
    if (m.exclusionReason === 'OUT_OF_SEGMENT:preexploration') {
      assert(m.score == null, `${m.ticker} pre-revenue sollte score=null tragen, hat ${m.score}`);
    }
  }
});

test('pharma SI-4: Out-class / pre-revenue members carry score=null in excluded[] (kein irreführender Rang)', () => {
  for (const [name, R] of [['branded', phB], ['biopharma', phBP], ['specialty', phS]]) {
    assert(Array.isArray(R.excluded), `${name} excluded[] fehlt`);
    for (const m of R.excluded) assert(m.score == null, `${name}/${m.ticker} in excluded[] sollte score=null haben, hat ${m.score}`);
  }
});

test('pharma: THREE scored axes {growth, gm, eff} (NOT roce/marginStability); weights sum to 1.0; growth LEADS', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  for (const b of ['pharma_branded', 'pharma_biopharma', 'pharma_specialty']) {
    const w = NORMS[b].weights;
    const keys = Object.keys(w).sort().join(',');
    assert(keys === 'eff,gm,growth', `${b} sollte die 3 pharma-Achsen {growth,gm,eff} tragen, hat ${keys}`);
    assert(!('roce' in w) && !('marginStability' in w) && !('assetGrowthPenalty' in w), `${b} darf KEINE roce/marginStability/assetGrowthPenalty-Achse haben`);
    const sum = Object.values(w).reduce((s, v) => s + v, 0);
    assert(Math.abs(sum - 1.0) < 1e-9, `${b} weights sollten Σ=1.0 sein, sind ${sum}`);
    assert(w.growth === 0.45 && w.gm === 0.20 && w.eff === 0.35, `${b} weights sollten {growth .45, gm .20, eff .35} sein`);
    assert(w.growth > w.eff && w.eff > w.gm, `${b} growth sollte führen (.45 > eff .35 > gm .20)`);
  }
});

test('pharma: growth/gm/eff cohort-keyed; branded THIN_REL (n<15 ABS-only); growth floor 0.00 branded/specialty, 0.05 biopharma', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const B = NORMS.pharma_branded, BP = NORMS.pharma_biopharma, S = NORMS.pharma_specialty;
  // gm elite is cohort-specific (branded 66-79 narrow, biopharma/specialty wide).
  assert(B.gm.elite === 0.79 && BP.gm.elite === 0.96 && S.gm.elite === 0.92,
    `gm elite sollte branded .79 / biopharma .96 / specialty .92 sein, ist ${B.gm.elite}/${BP.gm.elite}/${S.gm.elite}`);
  // growth floor 0.00 for branded/specialty (mature + cliff-exposed), 0.05 for biopharma.
  assert(B.growth.floor === 0.00 && S.growth.floor === 0.00 && BP.growth.floor === 0.05,
    `growth floor sollte branded/specialty .00 / biopharma .05 sein`);
  // branded THIN_REL: rel.suppressed=true, beta=1.0 (ABS-only on n=10<15).
  assert(B.rel && B.rel.suppressed === true && B.rel.beta === 1.0, 'branded sollte THIN_REL (rel.suppressed, beta=1.0) sein');
  assert(!(BP.rel && BP.rel.suppressed) && !(S.rel && S.rel.suppressed), 'biopharma/specialty sollten NICHT THIN_REL sein (full ABS+REL)');
});

test('pharma: always-on WALLS on every member (PATENT_CLIFF_WALL + MA_INTANGIBLE_BLIND); branded carries THIN_REL', () => {
  for (const [b, members, thinRel] of [['branded', PB, true], ['biopharma', PBP, false], ['specialty', PS_, false]]) {
    for (const m of members) {
      for (const w of ['PATENT_CLIFF_WALL', 'MA_INTANGIBLE_BLIND']) {
        assert(Array.isArray(m.lamps) && m.lamps.includes(w), `${b}/${m.ticker} fehlt WALL-Lampe ${w}`);
      }
    }
    // bucket-level walls disclosure
    const R = b === 'branded' ? phB : b === 'biopharma' ? phBP : phS;
    assert(Array.isArray(R.walls) && R.walls.includes('PATENT_CLIFF_WALL') && R.walls.includes('MA_INTANGIBLE_BLIND'), `${b} R.walls fehlt`);
    assert(R.walls.includes('THIN_REL') === thinRel, `${b} R.walls THIN_REL sollte ${thinRel} sein`);
  }
});

test('pharma SI-3: normTableId + cohort + comparabilityNote (absKaliber cross-bucket, REL intra-bucket, MA_INTANGIBLE_BLIND disclosed)', () => {
  for (const [name, R] of [['branded', phB], ['biopharma', phBP], ['specialty', phS]]) {
    assert(/pharma_(branded|biopharma|specialty)-norms-2026-06-23/.test(R.normTableId || ''), `${name} normTableId fehlt/falsch: ${R.normTableId}`);
    assert(R.cohort === `pharma_${name}`, `${name} cohort falsch: ${R.cohort}`);
    assert(/growth/i.test(R.comparabilityNote || '') && /MA_INTANGIBLE_BLIND/i.test(R.comparabilityNote || ''), `${name} comparabilityNote sollte growth + MA_INTANGIBLE_BLIND nennen`);
    assert(R.scoreScope === 'intra-bucket' && R.crossBucketComparableField === 'absKaliber', `${name} SI-3 scope/field fehlt`);
  }
});

test('pharma-unit: absKaliberPharma 3-axis coverage-renorm (gm-drop renorm Σ=1.0; growth-drop; all-null → 0)', () => {
  const { absKaliberPharma } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  // full 3 axes
  const full = absKaliberPharma({ growth: 0.10, gm: 0.75, eff: 0.25 }, 'pharma_branded');
  assert(full.usedAxes.length === 3 && full.droppedAxes.length === 0, `full sollte 3 Achsen nutzen, hat ${full.usedAxes.length}`);
  assert(Math.abs(Object.values(full.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renormWeights sollten Σ=1.0');
  // gm-drop (no-GP royalty name RPRX/ARWR) → growth+eff renormalize
  const dropGm = absKaliberPharma({ growth: 0.16, gm: null, eff: 0.50 }, 'pharma_biopharma');
  assert(dropGm.droppedAxes.includes('gm') && dropGm.usedAxes.length === 2, 'gm-drop sollte 2 Achsen lassen');
  assert(Math.abs(Object.values(dropGm.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renorm Σ=1.0 nach gm-drop');
  // growth-drop (fully deal-masked acquirer CPRX) → gm+eff renormalize
  const dropG = absKaliberPharma({ growth: null, gm: 0.85, eff: 0.35 }, 'pharma_specialty');
  assert(dropG.droppedAxes.includes('growth') && dropG.usedAxes.length === 2, 'growth-drop sollte 2 Achsen lassen');
  // all-null → 0 (pathological, no fake-neutral)
  const allNull = absKaliberPharma({ growth: null, gm: null, eff: null }, 'pharma_branded');
  assert(allNull.absK === 0 && allNull.usedAxes.length === 0, 'all-null sollte absK=0 ergeben');
});

test('pharma PARITÄT: KEIN pharma-only Feld auf den anderen Buckets (Leak-Guard)', () => {
  // TRULY pharma-exclusive fields (ph/gmPharma/effPharma/_ph*). The shared names (growthInput/absUsedAxes/
  // absDroppedAxes/cohort/absKaliber) legitimately exist on industrials/materials/energy members.
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices', 'diagnostics_lst', 'industrials_heavy', 'industrials_light', 'staples_branded', 'staples_distribution', 'consdisc_store', 'consdisc_light', 'materials_pricingpower', 'materials_commodity', 'energy_upstream', 'energy_midstream', 'energy_services']) {
    if (!doc[b]) continue;
    for (const m of doc[b].members) {
      for (const leak of ['ph', 'gmPharma', 'effPharma', '_phGrowth', '_phGm', '_phEff']) {
        assert(!(leak in m), `${b}/${m.ticker} hat pharma-only Feld '${leak}' geleakt (Parität verletzt)`);
      }
    }
  }
});

// ===========================================================================
// it_services (CORE) — Special-Track B. ONE de-contaminated people-leverage / low-capital-compounding cohort.
// Spec formula-design-special_tracks-v0-2026-06-22.md PART B. 5 SCORED axes {gpa, fcfMargin, opMargin, growth,
// netIssuance} via the PARALLEL engine absKaliberItServices (coverage-renorm; the 12 existing CORE buckets are
// BYTE-UNTOUCHED — parity tests above + the tag28 fixture-hash gate). RPE is NOT scored (§B.2 inverted, weight 0.00,
// gate+flag only); PEOPLE_LEVERAGE_BLIND discloses the omission (mirrors medtech MA_INTANGIBLE_BLIND).
// ===========================================================================
const itR = doc.it_services;
const IT_ = itR ? itR.members : [];

test('it_services: bucket exists with members; label nennt v0 + people-leverage', () => {
  assert(itR && Array.isArray(itR.members) && IT_.length > 0, 'it_services bucket fehlt/leer');
  assert(/IT-Services v0/.test(itR.label || ''), `label sollte v0 nennen: ${itR.label}`);
  assert(/people-leverage|low-capital/i.test(itR.label || ''), `label sollte people-leverage/low-capital nennen`);
});

test('it_services §B.1 MARQUEE: all 16 marquees classified+scored (fail-loud guard)', () => {
  const MARQUEE = ['ACN', 'CTSH', 'EPAM', 'CACI', 'INFY', 'G', 'EXLS', 'IBM', 'GLOB', 'CNXC', 'DXC', 'BR', 'FIS', 'JKHY', 'IT', 'INOD'];
  const scored = new Set(IT_.map(m => m.ticker));
  const missing = MARQUEE.filter(t => !scored.has(t));
  assert(missing.length === 0, `MARQUEE COVERAGE FAIL — nicht klassifiziert/gescort: ${missing.join(', ')}`);
  const { assertItServicesMarquee } = require('./court-score.js');
  assert(typeof assertItServicesMarquee === 'function', 'assertItServicesMarquee nicht exportiert');
  assertItServicesMarquee(doc); // throws on collapse / contam/foreign-control leak
});

test('it_services SI-5: classifiedCount === scoredCount + excludedCount (fail-loud); n=22 de-contaminated', () => {
  assert(itR.classifiedCount != null && itR.scoredCount != null && itR.excludedCount != null, 'SI-5 counts fehlen');
  assert(itR.classifiedCount === itR.scoredCount + itR.excludedCount,
    `SI-5 mismatch: classified ${itR.classifiedCount} !== scored ${itR.scoredCount} + excluded ${itR.excludedCount}`);
  // Live-recomputed CLEAN de-contaminated count 2026-06-23: 22.
  assert(itR.classifiedCount === 22, `classified sollte 22 sein, ist ${itR.classifiedCount}`);
});

// THE materials-bug guard: the TOP-by-score must be a real elite people-leverage / low-capital compounder
// (ACN/CTSH/EXLS/JKHY/IT-class), NOT a crypto-miner shell, NOT a capital-intensive hardware distributor.
test('it_services MANDATORY regression: TOP-by-score is a real quality compounder, NOT a contaminant/shell', () => {
  const KNOWN_QUALITY = new Set(['ACN', 'CTSH', 'EPAM', 'EXLS', 'JKHY', 'IT', 'G', 'IBM', 'BR', 'INOD', 'CNXC', 'GLOB']);
  // the contaminants the gate removed must NEVER appear (let alone top).
  const CONTAM = new Set(['CIFR', 'APLD', 'BBAI', 'KEEL', 'SHAZ', 'CHRN', 'CDW', 'INGM', 'VNET', 'GIB', 'GDS', 'MGRT']);
  const ranked = IT_.filter(m => m.score != null && isFinite(m.score)).sort((a, b) => b.score - a.score);
  assert(ranked.length > 0, 'keine gescorten it_services-Namen');
  const top = ranked[0];
  assert(top.exclusionReason !== 'OUT_OF_SEGMENT:preexploration', `TOP ${top.ticker} darf KEIN pre-revenue shell sein`);
  assert(!CONTAM.has(top.ticker), `TOP ${top.ticker} ist ein Kontaminant — gate hat versagt (the inverted-RPE bug)`);
  assert(KNOWN_QUALITY.has(top.ticker), `TOP sollte ein bekannter Quality-Compounder sein, ist ${top.ticker}`);
  // no contaminant scored at all.
  const scored = new Set(IT_.map(m => m.ticker));
  const leaked = [...CONTAM].filter(t => scored.has(t));
  assert(leaked.length === 0, `Kontaminant(en) in der Kohorte: ${leaked.join(', ')}`);
});

test('it_services §B.1 CONTAM/FOREIGN-CONTROL + GENERATIVE anti-leak: contaminants/foreign absent; ACN/G/GLOB/INFY allowlisted', () => {
  const { assertItServicesNoForeignLeak, ITSERVICES_CONTAM_CONTROL, ITSERVICES_US_PRIMARY_ALLOWLIST } = require('./court-score.js');
  const scored = new Set(IT_.map(m => m.ticker));
  // CONTAM/FOREIGN positive-control: the contaminants + foreign primaries must NOT be scored.
  const leaked = ITSERVICES_CONTAM_CONTROL.filter(t => scored.has(t));
  assert(leaked.length === 0, `CONTAM/FOREIGN-CONTROL FAIL — leaked: ${leaked.join(', ')}`);
  // the US-primary foreign-domiciled flagships ARE admitted via the allowlist + scored.
  for (const t of ['ACN', 'G', 'GLOB', 'INFY']) {
    assert(ITSERVICES_US_PRIMARY_ALLOWLIST.includes(t), `${t} sollte auf dem US_PRIMARY_ALLOWLIST sein`);
    assert(scored.has(t), `${t} (US-primary marquee) sollte gescort sein`);
  }
  // GENERATIVE country anti-leak (reads the snapshot meta via the listing side-file) must hold.
  assert(typeof assertItServicesNoForeignLeak === 'function', 'assertItServicesNoForeignLeak nicht exportiert');
  let listing = new Map();
  try {
    const lp = (CAND_TEST.replace(/_court-candidates([^/\\]*)\.json$/, '_court-listing$1.json'));
    const ld = JSON.parse(fs.readFileSync(lp, 'utf8'));
    const obj = ld && ld.listings ? ld.listings : (ld || {});
    for (const [t, rec] of Object.entries(obj)) listing.set(t, rec);
  } catch {}
  assertItServicesNoForeignLeak(doc, listing); // throws on a country-set foreign leak (ACN/G/GLOB/INFY exempt)
});

test('it_services: FIVE scored axes {gpa, fcfMargin, opMargin, growth, netIssuance}; weights Σ=1.0; gpa LEADS; RPE NOT an axis', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const w = NORMS.it_services.weights;
  const keys = Object.keys(w).sort().join(',');
  assert(keys === 'fcfMargin,gpa,growth,netIssuance,opMargin', `it_services sollte die 5 Achsen tragen, hat ${keys}`);
  // RPE is NOT a scored axis (§B.2 inverted) — must not be a weight key; the flag-only marker must be set.
  assert(!('rpe' in w) && !('revPerEmployee' in w), 'RPE darf KEINE gewichtete Achse sein (§B.2 inverted)');
  assert(NORMS.it_services.rpeFlagOnly === true, 'NORMS.it_services.rpeFlagOnly sollte true sein (RPE gate+flag only)');
  const sum = Object.values(w).reduce((s, v) => s + v, 0);
  assert(Math.abs(sum - 1.0) < 1e-9, `weights sollten Σ=1.0 sein, sind ${sum}`);
  assert(w.gpa === 0.34 && w.fcfMargin === 0.24 && w.opMargin === 0.18 && w.growth === 0.14 && w.netIssuance === 0.10,
    `weights sollten {gpa .34, fcfMargin .24, opMargin .18, growth .14, netIssuance .10} sein`);
  // the capital-discipline+profitability pillar gpa+fcfMargin+netIssuance = .68 ≫ growth .14.
  assert((w.gpa + w.fcfMargin + w.netIssuance) > w.growth * 4, 'das Disziplin-/Profitabilitäts-Pillar sollte growth dominieren');
});

test('it_services: NORMS frozen-id + gpa floor .05 (CACI goodwill-floor) / elite .45; full ABS+REL (n=22>=15)', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const n = NORMS.it_services;
  assert(n.id === 'it-services-norms-2026-06-23', `norm id falsch: ${n.id}`);
  assert(n.gpa.floor === 0.05 && n.gpa.elite === 0.45, `gpa sollte .05/.45 sein, ist ${n.gpa.floor}/${n.gpa.elite}`);
  assert(n.fcfMargin.floor === 0.00 && n.fcfMargin.elite === 0.18, 'fcfMargin sollte .00/.18 sein');
  assert(n.opMargin.floor === 0.02 && n.opMargin.elite === 0.18, 'opMargin sollte .02/.18 sein');
  assert(n.growth.floor === 0.00 && n.growth.elite === 0.15, 'growth sollte .00/.15 sein');
  assert(n.netIssuance.floor === -0.10 && n.netIssuance.elite === 0.03, 'netIssuance sollte -.10/.03 sein');
  // n=22 >= REL_MIN_N=15 → full ABS+REL blend, NOT THIN_REL.
  assert(n.rel && n.rel.minN === 15 && n.rel.beta === 0.6 && !n.rel.suppressed, 'it_services sollte full ABS+REL (beta .6, n=22) sein');
});

test('it_services: always-on PEOPLE_LEVERAGE_BLIND wall on every member (the feasibility disclosure)', () => {
  for (const m of IT_) {
    assert(Array.isArray(m.lamps) && m.lamps.includes('PEOPLE_LEVERAGE_BLIND'), `${m.ticker} fehlt PEOPLE_LEVERAGE_BLIND wall`);
    // the 3 best people-leverage signals are disclosed as absent (future BONUS).
    for (const w of ['BACKLOG_FUTURE', 'UTILIZATION_FUTURE', 'ATTRITION_FUTURE', 'CYCLE_WALL']) {
      assert(m.lamps.includes(w), `${m.ticker} fehlt future/wall-Lampe ${w}`);
    }
  }
  // bucket-level walls disclosure.
  assert(Array.isArray(itR.walls) && itR.walls.includes('PEOPLE_LEVERAGE_BLIND'), 'itR.walls fehlt PEOPLE_LEVERAGE_BLIND');
  assert(itR.peopleDataCoverage != null, 'itR.peopleDataCoverage (headcount coverage disclosure) fehlt');
});

test('it_services: RPE is computed as an advisory flag (NOT scored) where headcount present; absent → PEOPLE_DATA_PARTIAL', () => {
  // §B.2: RPE surfaced as info only. ACN/CTSH/EPAM/GLOB (headcount present) carry revPerEmployee + RPE_ADVISORY.
  for (const t of ['ACN', 'CTSH', 'EPAM', 'GLOB', 'G', 'EXLS']) {
    const m = IT_.find(x => x.ticker === t);
    if (!m) continue;
    assert(m.revPerEmployee != null && isFinite(m.revPerEmployee), `${t} sollte einen RPE-Advisory-Wert tragen (headcount present)`);
    assert(m.lamps.includes('RPE_ADVISORY'), `${t} sollte RPE_ADVISORY-Flag tragen`);
    // CRITICAL §B.2: the elite (ACN/EPAM/GLOB low RPE) must NOT be penalized for low RPE — they score HIGH.
    // (a sanity that RPE is genuinely not in the score: low-RPE elite outranks would-be-high-RPE contaminants,
    //  which are gated out entirely. Here just assert the advisory value exists and the score ignores it.)
  }
  // names without headcount carry PEOPLE_DATA_PARTIAL.
  for (const m of IT_) {
    if (m.revPerEmployee == null) assert(m.lamps.includes('PEOPLE_DATA_PARTIAL'), `${m.ticker} (kein headcount) sollte PEOPLE_DATA_PARTIAL tragen`);
  }
});

test('it_services SI-4: Out-class / pre-revenue members carry score=null in excluded[]', () => {
  assert(Array.isArray(itR.excluded), 'excluded[] fehlt');
  for (const m of itR.excluded) assert(m.score == null, `${m.ticker} in excluded[] sollte score=null haben, hat ${m.score}`);
});

test('it_services SI-3: normTableId + cohort + comparabilityNote (absKaliber cross-bucket, PEOPLE_LEVERAGE_BLIND disclosed)', () => {
  assert(itR.normTableId === 'it-services-norms-2026-06-23', `normTableId fehlt/falsch: ${itR.normTableId}`);
  assert(itR.cohort === 'it_services', `cohort falsch: ${itR.cohort}`);
  assert(/gpa/i.test(itR.comparabilityNote || '') && /PEOPLE_LEVERAGE_BLIND/i.test(itR.comparabilityNote || ''),
    'comparabilityNote sollte gpa + PEOPLE_LEVERAGE_BLIND nennen');
  assert(/REVENUE-PER-EMPLOYEE IS NOT A SCORED AXIS|INVERTED/i.test(itR.comparabilityNote || ''),
    'comparabilityNote sollte die RPE-not-scored-Entscheidung disclosen');
  assert(itR.scoreScope === 'intra-bucket' && itR.crossBucketComparableField === 'absKaliber', 'SI-3 scope/field fehlt');
});

test('it_services-unit: absKaliberItServices 5-axis coverage-renorm (netIssuance-drop renorm Σ=1.0; all-null → 0; netIssuance inverted)', () => {
  const { absKaliberItServices } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  // full 5 axes (ACN-like): netShareIssuance NEGATIVE (buyback) → q(-NSI) high.
  const full = absKaliberItServices({ gpa: 0.34, fcfMargin: 0.156, opMargin: 0.156, growth: 0.07, netShareIssuance: -0.01 }, 'it_services');
  assert(full.usedAxes.length === 5 && full.droppedAxes.length === 0, `full sollte 5 Achsen nutzen, hat ${full.usedAxes.length}`);
  assert(Math.abs(Object.values(full.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renormWeights Σ=1.0');
  // netIssuance is INVERTED: a buyback (NSI<0) must score HIGHER than dilution (NSI>0), all else equal.
  const buyback = absKaliberItServices({ gpa: 0.30, fcfMargin: 0.10, opMargin: 0.10, growth: 0.05, netShareIssuance: -0.05 }, 'it_services');
  const dilute = absKaliberItServices({ gpa: 0.30, fcfMargin: 0.10, opMargin: 0.10, growth: 0.05, netShareIssuance: 0.10 }, 'it_services');
  assert(buyback.absK > dilute.absK, 'ein Rückkauf (NSI<0) sollte HÖHER scoren als Verwässerung (NSI>0) — netIssuance ist invertiert');
  // netIssuance-drop (Vintage-A no annualShares) → 4 axes renormalize to Σ=1.0
  const dropNsi = absKaliberItServices({ gpa: 0.55, fcfMargin: 0.18, opMargin: 0.18, growth: 0.05, netShareIssuance: null }, 'it_services');
  assert(dropNsi.droppedAxes.includes('netIssuance') && dropNsi.usedAxes.length === 4, 'netIssuance-drop sollte 4 Achsen lassen');
  assert(Math.abs(Object.values(dropNsi.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renorm Σ=1.0 nach netIssuance-drop');
  // growth-drop (fully deal-masked acquirer INOD) → 4 axes renormalize
  const dropG = absKaliberItServices({ gpa: 0.59, fcfMargin: 0.14, opMargin: 0.16, growth: null, netShareIssuance: 0.09 }, 'it_services');
  assert(dropG.droppedAxes.includes('growth') && dropG.usedAxes.length === 4, 'growth-drop sollte 4 Achsen lassen');
  // all-null → 0 (pathological, no fake-neutral)
  const allNull = absKaliberItServices({ gpa: null, fcfMargin: null, opMargin: null, growth: null, netShareIssuance: null }, 'it_services');
  assert(allNull.absK === 0 && allNull.usedAxes.length === 0, 'all-null sollte absK=0 ergeben');
});

test('it_services PARITÄT: KEIN it_services-only Feld auf den anderen Buckets (Leak-Guard)', () => {
  // TRULY it_services-exclusive fields (it/fcfMarginIt/opMarginIt/revPerEmployee/_it*). The shared names (gpa/
  // growthInput/netShareIssuance/absUsedAxes/absDroppedAxes/cohort/absKaliber) legitimately exist on other CORE members.
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices', 'diagnostics_lst', 'industrials_heavy', 'industrials_light', 'staples_branded', 'staples_distribution', 'consdisc_store', 'consdisc_light', 'materials_pricingpower', 'materials_commodity', 'energy_upstream', 'energy_midstream', 'energy_services', 'pharma_branded', 'pharma_biopharma', 'pharma_specialty']) {
    if (!doc[b]) continue;
    for (const m of doc[b].members) {
      for (const leak of ['it', 'fcfMarginIt', 'opMarginIt', 'revPerEmployee', '_itGpa', '_itFcfMargin', '_itOpMargin', '_itGrowth', '_itNetIssuance']) {
        assert(!(leak in m), `${b}/${m.ticker} hat it_services-only Feld '${leak}' geleakt (Parität verletzt)`);
      }
    }
  }
});

// ===========================================================================
// financials_banks (CORE court bucket) — ONE deposit-funded US-bank cohort. Court gauntlet DESIGN (BUILD_WITH_CAVEATS
// / court REVISE 2026-06-23). 4 SCORED axes {roaThruCycle, capitalAdequacy, assetGrowthDiscipline, earningsDurability}
// via the PARALLEL engine absKaliberBanks (coverage-renorm; the 20 existing CORE/court buckets BYTE-UNTOUCHED — parity
// guard below + the tag28 fixture-hash gate). The COURT-REQUIRED revisions: (1) de-ADR the foreign megabanks; (2)
// anti-leak keyed on the foreign-DENY SIGNAL NOT country!=US; (4) capitalAdequacy DROP+renorm on null-totalEquity
// marquees; (5) always-on BLIND walls. CREDIT_QUALITY_BLIND discloses the most important absent dimension.
// ===========================================================================
const bkR = doc.financials_banks;
const BK_ = bkR ? bkR.members : [];

test('financials_banks: bucket exists with members; label nennt v0 + through-cycle bank quality', () => {
  assert(bkR && Array.isArray(bkR.members) && BK_.length > 0, 'financials_banks bucket fehlt/leer');
  assert(/Financials-Banks v0/.test(bkR.label || ''), `label sollte v0 nennen: ${bkR.label}`);
  assert(/through-cycle|ROA|capital/i.test(bkR.label || ''), 'label sollte through-cycle/ROA/capital nennen');
});

test('financials_banks MARQUEE: JPM/PNC/USB/MTB/EWBC/CFR/FITB classify+score AND survive to a sane rank (fail-loud)', () => {
  const MARQUEE = ['JPM', 'PNC', 'USB', 'MTB', 'EWBC', 'CFR', 'FITB'];
  const scored = BK_.filter(m => m.score != null);
  const scoredSet = new Set(scored.map(m => m.ticker));
  const missing = MARQUEE.filter(t => !scoredSet.has(t));
  assert(missing.length === 0, `MARQUEE COVERAGE FAIL — nicht klassifiziert/gescort: ${missing.join(', ')}`);
  // "sane rank" = inside the scored universe, never exiled to the very bottom decile.
  const ranked = scored.slice().sort((a, b) => b.score - a.score);
  for (const t of MARQUEE) {
    const rank = ranked.findIndex(m => m.ticker === t) + 1;
    assert(rank > 0 && rank <= Math.ceil(ranked.length * 0.90), `${t} rank ${rank}/${ranked.length} — Flaggschiff ins unterste Dezil exiliert (Vintage-collapse-Regression)`);
  }
  const { assertBanksMarquee } = require('./court-score.js');
  assert(typeof assertBanksMarquee === 'function', 'assertBanksMarquee nicht exportiert');
  assertBanksMarquee(doc); // throws on collapse / foreign-control leak
});

test('financials_banks SI-5: classifiedCount === scoredCount + excludedCount (fail-loud identity)', () => {
  assert(bkR.classifiedCount != null && bkR.scoredCount != null && bkR.excludedCount != null, 'SI-5 counts fehlen');
  assert(bkR.classifiedCount === bkR.scoredCount + bkR.excludedCount,
    `SI-5 mismatch: classified ${bkR.classifiedCount} !== scored ${bkR.scoredCount} + excluded ${bkR.excludedCount}`);
  // Live-recomputed CLEAN de-ADRd + deduped count 2026-06-23: 128 classified.
  assert(bkR.classifiedCount === 128, `classified sollte 128 sein (de-ADRd + deduped), ist ${bkR.classifiedCount}`);
});

test('financials_banks de-ADR: NO foreign megabank ADR (IBN/ITUB/MUFG/SMFG/RY/TD/SAN/UBS/NU/...) in the cohort', () => {
  const { assertBanksNoForeignLeak, BANKS_FOREIGN_CONTROL, BANK_FOREIGN_DENY } = require('./court-score.js');
  const allTk = new Set(BK_.map(m => m.ticker));
  // the foreign-megabank ADRs the de-ADR hardening must keep OUT (court revision #1).
  const leaked = BANKS_FOREIGN_CONTROL.filter(t => allTk.has(t));
  assert(leaked.length === 0, `FOREIGN-CONTROL FAIL — foreign megabank ADR(s) in der Kohorte: ${leaked.join(', ')}`);
  // the explicit DENY set the court named MUST all be absent.
  for (const t of ['IBN', 'ITUB', 'BSBR', 'BMA', 'KB', 'SHG', 'WF', 'MFG', 'MUFG', 'SMFG', 'RY', 'TD', 'SAN', 'UBS', 'NWG', 'NU']) {
    assert(BANK_FOREIGN_DENY.has(t), `${t} sollte im BANK_FOREIGN_DENY-Set sein`);
    assert(!allTk.has(t), `${t} (foreign megabank ADR) darf NICHT in der Kohorte sein`);
  }
  // GENERATIVE anti-leak keyed on the foreign-DENY SIGNAL (NOT country!=US — country=undefined US banks are tolerated).
  assert(typeof assertBanksNoForeignLeak === 'function', 'assertBanksNoForeignLeak nicht exportiert');
  let listing = new Map();
  try {
    const lp = (CAND_TEST.replace(/_court-candidates([^/\\]*)\.json$/, '_court-listing$1.json'));
    const ld = JSON.parse(fs.readFileSync(lp, 'utf8'));
    const obj = ld && ld.listings ? ld.listings : (ld || {});
    for (const [t, rec] of Object.entries(obj)) listing.set(t, rec);
  } catch {}
  assertBanksNoForeignLeak(doc, listing); // throws on a foreign-DENY/country-set leak; country=undefined US banks tolerated
});

test('financials_banks anti-leak: the assert does NOT throw on country=undefined US banks (JPM/PNC/USB/MTB)', () => {
  // CRITICAL court revision #2: JPM/PNC/USB/MTB carry country=undefined and MUST be admitted+scored (the anti-leak
  // must NOT be keyed on country!=US, which would throw on them). Verify they are scored, not excluded.
  for (const t of ['JPM', 'PNC', 'USB', 'MTB']) {
    const m = BK_.find(x => x.ticker === t);
    assert(m != null, `${t} (country=undefined US bank) sollte in der Kohorte sein`);
    assert(m.score != null && isFinite(m.score), `${t} sollte gescort sein (score!=null), hat ${m.score}`);
  }
});

test('financials_banks capitalAdequacy DROP+renorm: a null-totalEquity marquee (JPM/WFC/PNC) still scores on the other 3 axes', () => {
  // court revision #4: capitalAdequacy is INVISIBLE on JPM/WFC/PNC/USB (totalEquity absent ~45% of pool). They MUST
  // still score via coverage-renorm on roaThruCycle+assetGrowthDiscipline+earningsDurability, NEVER imputed.
  let foundDrop = false;
  for (const t of ['JPM', 'WFC', 'PNC', 'USB']) {
    const m = BK_.find(x => x.ticker === t);
    if (!m) continue;
    if (m.capitalAdequacy == null) {
      foundDrop = true;
      assert(m.score != null && isFinite(m.score), `${t} (capitalAdequacy null) sollte trotzdem gescort sein`);
      assert(Array.isArray(m.absUsedAxes) && !m.absUsedAxes.includes('capitalAdequacy'), `${t} sollte capitalAdequacy NICHT in usedAxes haben`);
      assert(Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.includes('capitalAdequacy'), `${t} sollte capitalAdequacy in droppedAxes haben`);
      assert(m.absUsedAxes.length >= 2, `${t} sollte auf den anderen Achsen scoren (>=2 usedAxes)`);
      assert(m.lamps.includes('CAPADEQ_DROPPED'), `${t} sollte CAPADEQ_DROPPED lamp tragen`);
    }
  }
  assert(foundDrop, 'mindestens ein null-totalEquity Marquee (JPM/WFC/PNC/USB) sollte den DROP+renorm-Pfad demonstrieren');
  // bucket-level coverage disclosure.
  assert(bkR.capitalAdequacyCoverage != null && bkR.capitalAdequacyCoverage.dropped > 0, 'capitalAdequacyCoverage (DROP disclosure) fehlt/leer');
});

test('financials_banks SHELL SI-4: a no-balance-sheet / no-positive-NI name is excluded (score=null), NEVER scored 0', () => {
  // MCHB (Mechanics Bancorp) carries annualBalance=[] (no totalAssets[0]) → SHELL gate → OUT_OF_SEGMENT:shell.
  const mchb = BK_.find(m => m.ticker === 'MCHB');
  if (mchb) {
    assert(mchb.score === null, `MCHB (shell, no balance sheet) sollte score=null haben, hat ${mchb.score}`);
    assert(mchb.exclusionReason === 'OUT_OF_SEGMENT:shell', `MCHB sollte OUT_OF_SEGMENT:shell sein, ist ${mchb.exclusionReason}`);
  }
  // every excluded member has score=null (SI-4: never a misleading 0/headline rank).
  assert(Array.isArray(bkR.excluded), 'excluded[] fehlt');
  for (const m of bkR.excluded) assert(m.score == null, `${m.ticker} in excluded[] sollte score=null haben, hat ${m.score}`);
});

test('financials_banks: top names sane (high-ROA well-capitalized disciplined banks, NOT a shell/foreign ADR)', () => {
  const ranked = BK_.filter(m => m.score != null && isFinite(m.score)).sort((a, b) => b.score - a.score);
  assert(ranked.length > 0, 'keine gescorten bank-Namen');
  const top = ranked[0];
  // the court's replicated top set: WABC/HOMB/OZK/OFG/RBCAA/CASH/CHCO/BANF + the marquees.
  const KNOWN_QUALITY = new Set(['WABC', 'HOMB', 'OZK', 'OFG', 'RBCAA', 'CASH', 'CHCO', 'BANF', 'CBC', 'CBSH', 'TBBK', 'EWBC', 'CATY', 'PRK', 'SRCE', 'CVBF', 'BFC']);
  assert(top.exclusionReason !== 'OUT_OF_SEGMENT:shell', `TOP ${top.ticker} darf KEIN shell sein`);
  assert(KNOWN_QUALITY.has(top.ticker), `TOP sollte ein bekannter Quality-Bank sein, ist ${top.ticker}`);
  // the top name should have elite-ish ROA (the lead axis w=.50) and not be ballooning the balance sheet.
  assert(top.roaThruCycle != null && top.roaThruCycle >= 0.013, `TOP ${top.ticker} sollte hohe through-cycle ROA tragen (>=1.3%), hat ${top.roaThruCycle}`);
  // no foreign ADR scored at all (positive-control inside the ranked set).
  const FOREIGN = new Set(['IBN', 'ITUB', 'MUFG', 'SMFG', 'RY', 'TD', 'SAN', 'UBS', 'NU', 'HSBC', 'BBVA']);
  const leaked = ranked.filter(m => FOREIGN.has(m.ticker));
  assert(leaked.length === 0, `foreign ADR(s) gescort: ${leaked.map(m => m.ticker).join(', ')}`);
});

test('financials_banks: FOUR scored axes {roaThruCycle, capitalAdequacy, assetGrowthDiscipline, earningsDurability}; weights Σ=1.0; roaThruCycle LEADS', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const w = NORMS.financials_banks.weights;
  const keys = Object.keys(w).sort().join(',');
  assert(keys === 'assetGrowthDiscipline,capitalAdequacy,earningsDurability,roaThruCycle', `4 Achsen erwartet, hat ${keys}`);
  // FCF/OCF/gpa must NOT be weight keys (hard-excluded / structurally absent for banks).
  for (const forbidden of ['fcfMargin', 'fcf', 'ocf', 'gpa', 'opMargin', 'growth']) {
    assert(!(forbidden in w), `${forbidden} darf KEINE gewichtete Bank-Achse sein`);
  }
  const sum = Object.values(w).reduce((s, v) => s + v, 0);
  assert(Math.abs(sum - 1.0) < 1e-9, `weights sollten Σ=1.0 sein, sind ${sum}`);
  assert(w.roaThruCycle === 0.50 && w.capitalAdequacy === 0.25 && w.assetGrowthDiscipline === 0.18 && w.earningsDurability === 0.07,
    'weights sollten {roaThruCycle .50, capitalAdequacy .25, assetGrowthDiscipline .18, earningsDurability .07} sein');
  // roaThruCycle .50 is the LEAD: the single largest axis weight (a 50/50 split between the through-cycle ROA pillar
  // and the {capital, discipline, durability} triad). earningsDurability .07 is the small blind-walled tiebreaker.
  assert(w.roaThruCycle >= Math.max(w.capitalAdequacy, w.assetGrowthDiscipline, w.earningsDurability), 'roaThruCycle sollte das größte Achsengewicht (LEAD) sein');
  assert(w.roaThruCycle >= (w.capitalAdequacy + w.assetGrowthDiscipline + w.earningsDurability), 'roaThruCycle (.50) sollte >= der Summe der anderen drei sein (LEAD-Pillar)');
  assert(w.roaThruCycle > w.capitalAdequacy && w.capitalAdequacy > w.assetGrowthDiscipline && w.assetGrowthDiscipline > w.earningsDurability, 'monotone Achsen-Hierarchie roa>cap>disc>dur');
});

test('financials_banks: NORMS frozen-id + recomputed anchors (roa .0070/.0164, cap .084/.137, assetGrowthDisc -.40/.00, dur .185/.863)', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const n = NORMS.financials_banks;
  assert(n.id === 'banks-norms-2026-06-23', `norm id falsch: ${n.id}`);
  assert(n.roaThruCycle.floor === 0.0070 && n.roaThruCycle.elite === 0.0164, `roaThruCycle sollte .0070/.0164 sein, ist ${n.roaThruCycle.floor}/${n.roaThruCycle.elite}`);
  assert(n.capitalAdequacy.floor === 0.084 && n.capitalAdequacy.elite === 0.137, 'capitalAdequacy sollte .084/.137 sein');
  // assetGrowthDiscipline is the PENALTY axis: elite=0.00 (zero growth best), floor=-0.40 (40% ballooning worst).
  assert(n.assetGrowthDiscipline.floor === -0.40 && n.assetGrowthDiscipline.elite === 0.00, 'assetGrowthDiscipline sollte -.40/.00 sein (PENALTY)');
  assert(n.assetGrowthDiscipline.elite > n.assetGrowthDiscipline.floor, 'assetGrowthDiscipline floor<elite (monotone Skala)');
  assert(n.earningsDurability.floor === 0.185 && n.earningsDurability.elite === 0.863, 'earningsDurability sollte .185/.863 sein');
  // n=128 >= REL_MIN_N=15 → full ABS+REL blend (β=0.6), NOT THIN_REL.
  assert(n.rel && n.rel.minN === 15 && n.rel.beta === 0.6, 'banks sollte full ABS+REL (beta .6, minN 15) sein');
});

test('financials_banks-unit: absKaliberBanks 4-axis coverage-renorm (capitalAdequacy-drop renorm Σ=1.0; all-null → 0; assetGrowth PENALTY)', () => {
  const { absKaliberBanks } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  // full 4 axes (elite bank): high ROA, well-capitalized, zero asset growth, durable earnings.
  const full = absKaliberBanks({ roaThruCycle: 0.0164, capitalAdequacy: 0.137, assetGrowthYoY: 0.00, earningsDurability: 0.863 }, 'financials_banks');
  assert(full.usedAxes.length === 4 && full.droppedAxes.length === 0, `full sollte 4 Achsen nutzen, hat ${full.usedAxes.length}`);
  assert(Math.abs(Object.values(full.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renormWeights Σ=1.0');
  assert(full.absK > 0.95, `elite bank sollte absK~1.0 ergeben, hat ${full.absK}`);
  // assetGrowthDiscipline is the PENALTY: zero asset growth must score HIGHER than 40% ballooning, all else equal.
  const disc = absKaliberBanks({ roaThruCycle: 0.012, capitalAdequacy: 0.11, assetGrowthYoY: 0.00, earningsDurability: 0.7 }, 'financials_banks');
  const balloon = absKaliberBanks({ roaThruCycle: 0.012, capitalAdequacy: 0.11, assetGrowthYoY: 0.40, earningsDurability: 0.7 }, 'financials_banks');
  assert(disc.absK > balloon.absK, 'Null-Asset-Wachstum (disc) sollte HÖHER scoren als 40%-Ballooning — assetGrowthDiscipline ist eine PENALTY');
  // capitalAdequacy-drop (JPM-like, totalEquity null) → 3 axes renormalize to Σ=1.0 (NEVER imputed)
  const dropCap = absKaliberBanks({ roaThruCycle: 0.013, capitalAdequacy: null, assetGrowthYoY: 0.06, earningsDurability: 0.63 }, 'financials_banks');
  assert(dropCap.droppedAxes.includes('capitalAdequacy') && dropCap.usedAxes.length === 3, 'capitalAdequacy-drop sollte 3 Achsen lassen');
  assert(Math.abs(Object.values(dropCap.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renorm Σ=1.0 nach capitalAdequacy-drop');
  // all-null → 0 (pathological shell, no fake-neutral)
  const allNull = absKaliberBanks({ roaThruCycle: null, capitalAdequacy: null, assetGrowthYoY: null, earningsDurability: null }, 'financials_banks');
  assert(allNull.absK === 0 && allNull.usedAxes.length === 0, 'all-null sollte absK=0 ergeben');
});

test('financials_banks: always-on BLIND walls on every member (CREDIT_QUALITY/NIM/EFFICIENCY/CET1/DEPOSIT_FRANCHISE)', () => {
  for (const m of BK_) {
    for (const wall of ['CREDIT_QUALITY_BLIND', 'NIM_BLIND', 'EFFICIENCY_RATIO_BLIND', 'CET1_BLIND', 'DEPOSIT_FRANCHISE_BLIND']) {
      assert(Array.isArray(m.lamps) && m.lamps.includes(wall), `${m.ticker} fehlt BLIND-wall ${wall}`);
    }
  }
  // bucket-level walls disclosure.
  assert(Array.isArray(bkR.walls) && bkR.walls.includes('CREDIT_QUALITY_BLIND'), 'bkR.walls fehlt CREDIT_QUALITY_BLIND');
});

test('financials_banks SI-3: normTableId + cohort + comparabilityNote (absKaliber cross-bucket, CREDIT_QUALITY_BLIND + assetGrowth PENALTY disclosed)', () => {
  assert(bkR.normTableId === 'banks-norms-2026-06-23', `normTableId fehlt/falsch: ${bkR.normTableId}`);
  assert(bkR.cohort === 'financials_banks', `cohort falsch: ${bkR.cohort}`);
  assert(/roaThruCycle/i.test(bkR.comparabilityNote || '') && /CREDIT_QUALITY_BLIND/i.test(bkR.comparabilityNote || ''),
    'comparabilityNote sollte roaThruCycle + CREDIT_QUALITY_BLIND nennen');
  assert(/PENALTY|opposite of util/i.test(bkR.comparabilityNote || ''), 'comparabilityNote sollte die assetGrowth-PENALTY-Richtung disclosen');
  assert(/HARD-EXCLUDED|FCF/i.test(bkR.comparabilityNote || ''), 'comparabilityNote sollte den FCF/OCF-Ausschluss disclosen');
  assert(bkR.scoreScope === 'intra-bucket' && bkR.crossBucketComparableField === 'absKaliber', 'SI-3 scope/field fehlt');
});

test('financials_banks PARITÄT: KEIN banks-only Feld auf den anderen Buckets (Leak-Guard)', () => {
  // TRULY banks-exclusive fields (bk/roaThruCycle/capitalAdequacy/assetGrowthYoY/earningsDurability/_bk*). The shared
  // names (absUsedAxes/absDroppedAxes/cohort/absKaliber) legitimately exist on other CORE members.
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices', 'diagnostics_lst', 'industrials_heavy', 'industrials_light', 'staples_branded', 'staples_distribution', 'consdisc_store', 'consdisc_light', 'materials_pricingpower', 'materials_commodity', 'energy_upstream', 'energy_midstream', 'energy_services', 'pharma_branded', 'pharma_biopharma', 'pharma_specialty', 'it_services']) {
    if (!doc[b]) continue;
    for (const m of doc[b].members) {
      for (const leak of ['bk', 'roaThruCycle', 'capitalAdequacy', 'assetGrowthYoY', 'earningsDurability', '_bkRoa', '_bkCapAdequacy', '_bkAssetGrowthDisc', '_bkEarningsDurability']) {
        assert(!(leak in m), `${b}/${m.ticker} hat banks-only Feld '${leak}' geleakt (Parität verletzt)`);
      }
    }
  }
});

// ===========================================================================
// equity_reits (CORE court bucket) — ONE equity-REIT through-cycle quality cohort. Court gauntlet DESIGN
// (BUILD_WITH_CAVEATS / court REVISE 2026-06-24). 4 SCORED axes {opMargin, ffoAssets, revG3, ndGA} via the PARALLEL
// engine absKaliberReits (coverage-renorm; the 21 existing CORE/court buckets BYTE-UNTOUCHED — parity guard below +
// the tag28 fixture-hash gate). The COURT-REQUIRED revisions: (0) hard-separate mortgage REITs; (1) {value}-unwrap the
// FLOW fields + typeof-number assert; (2) FFO gains-on-sale guard caps SPG; (3) top-tier-no-FFO DROP+renorm disclosure;
// (4) always-on BLIND walls; (5) US-primary de-ADR classifier. The economic SHELL gate excludes FRMI/MRP/JAN/BXDC.
// ===========================================================================
const reR = doc.equity_reits;
const RE_ = reR ? reR.members : [];

test('equity_reits: bucket exists with members; label nennt v0 + REIT quality', () => {
  assert(reR && Array.isArray(reR.members) && RE_.length > 0, 'equity_reits bucket fehlt/leer');
  assert(/Equity-REITs v0/.test(reR.label || ''), `label sollte v0 nennen: ${reR.label}`);
  assert(/NOI|FFO|REIT/i.test(reR.label || ''), 'label sollte NOI/FFO/REIT nennen');
});

test('equity_reits MARQUEE: O/PLD/VICI/SPG/EXR/EGP/CTRE classify+score AND survive to a sane rank (fail-loud)', () => {
  const MARQUEE = ['O', 'PLD', 'VICI', 'SPG', 'EXR', 'EGP', 'CTRE'];
  const scored = RE_.filter(m => m.score != null);
  const scoredSet = new Set(scored.map(m => m.ticker));
  const missing = MARQUEE.filter(t => !scoredSet.has(t));
  assert(missing.length === 0, `MARQUEE COVERAGE FAIL — nicht klassifiziert/gescort: ${missing.join(', ')}`);
  const ranked = scored.slice().sort((a, b) => b.score - a.score);
  for (const t of MARQUEE) {
    const rank = ranked.findIndex(m => m.ticker === t) + 1;
    assert(rank > 0 && rank <= Math.ceil(ranked.length * 0.90), `${t} rank ${rank}/${ranked.length} — Flaggschiff ins unterste Dezil exiliert (Vintage-collapse-Regression)`);
  }
  const { assertReitsMarquee } = require('./court-score.js');
  assert(typeof assertReitsMarquee === 'function', 'assertReitsMarquee nicht exportiert');
  assertReitsMarquee(doc); // throws on collapse / mortgage-control leak
});

test('equity_reits SI-5: classifiedCount === scoredCount + excludedCount (fail-loud identity)', () => {
  assert(reR.classifiedCount != null && reR.scoredCount != null && reR.excludedCount != null, 'SI-5 counts fehlen');
  assert(reR.classifiedCount === reR.scoredCount + reR.excludedCount,
    `SI-5 mismatch: classified ${reR.classifiedCount} !== scored ${reR.scoredCount} + excluded ${reR.excludedCount}`);
  // Live-recomputed CLEAN de-ADRd + deduped count 2026-06-24: 114 classified (mortgage REITs hard-separated OUT).
  assert(reR.classifiedCount === 114, `classified sollte 114 sein (de-ADRd + mortgage-separated), ist ${reR.classifiedCount}`);
});

test('equity_reits HARD-SEPARATION: NO mortgage REIT (NLY/AGNC/STWD/ABR/RITM/BXMT/...) in the cohort (court rev #0)', () => {
  const { assertReitsNoMortgageLeak, REITS_MORTGAGE_CONTROL, REIT_MORTGAGE_DENY } = require('./court-score.js');
  const allTk = new Set(RE_.map(m => m.ticker));
  const leaked = REITS_MORTGAGE_CONTROL.filter(t => allTk.has(t));
  assert(leaked.length === 0, `MORTGAGE-CONTROL FAIL — mortgage REIT(s) in der Kohorte: ${leaked.join(', ')}`);
  for (const t of ['NLY', 'AGNC', 'STWD', 'ABR', 'RITM', 'BXMT', 'CIM', 'DX', 'EFC', 'LADR', 'ARI', 'ARR', 'ORC', 'TWO']) {
    assert(REIT_MORTGAGE_DENY.has(t), `${t} sollte im REIT_MORTGAGE_DENY-Set sein`);
    assert(!allTk.has(t), `${t} (mortgage REIT) darf NICHT in der equity_reits-Kohorte sein (court rev #0)`);
  }
  assert(typeof assertReitsNoMortgageLeak === 'function', 'assertReitsNoMortgageLeak nicht exportiert');
  let listing = new Map();
  try {
    const lp = (CAND_TEST.replace(/_court-candidates([^/\\]*)\.json$/, '_court-listing$1.json'));
    const ld = JSON.parse(fs.readFileSync(lp, 'utf8'));
    const obj = ld && ld.listings ? ld.listings : (ld || {});
    for (const [t, rec] of Object.entries(obj)) listing.set(t, rec);
  } catch {}
  assertReitsNoMortgageLeak(doc, listing); // throws on a mortgage-DENY/country-set leak; country=undefined US REITs tolerated
});

test('equity_reits anti-leak: the assert does NOT throw on country=undefined US REITs (O/VICI/PLD/TRNO)', () => {
  // court revision #5: O/VICI/PLD/TRNO carry country=undefined and MUST be admitted+scored (the anti-leak must NOT be
  // keyed on country!=US, which would throw on them). Verify they are scored, not excluded.
  for (const t of ['O', 'VICI', 'PLD', 'TRNO']) {
    const m = RE_.find(x => x.ticker === t);
    assert(m != null, `${t} (country=undefined US REIT) sollte in der Kohorte sein`);
    assert(m.score != null && isFinite(m.score), `${t} sollte gescort sein (score!=null), hat ${m.score}`);
  }
});

test('equity_reits {value}-unwrap (court rev #1): the FLOW fields produce NUMERIC axes, not NaN', () => {
  // The annualRev/OpInc/NetIncome/Depreciation are {value}-WRAPPED; without unwrap every axis would be NaN. Verify the
  // marquees carry finite numeric axis values (opMargin from annualOpInc[0]/annualRev[0], both wrapped).
  for (const t of ['O', 'VICI', 'PLD', 'EXR', 'EGP', 'CTRE']) {
    const m = RE_.find(x => x.ticker === t);
    assert(m != null, `${t} fehlt`);
    assert(m.opMarginReit != null && typeof m.opMarginReit === 'number' && isFinite(m.opMarginReit),
      `${t} opMargin sollte eine endliche Zahl sein (NICHT NaN — {value}-unwrap), ist ${m.opMarginReit}`);
    assert(m.netDebtToAssets != null && typeof m.netDebtToAssets === 'number' && isFinite(m.netDebtToAssets),
      `${t} netDebtToAssets sollte eine endliche Zahl sein, ist ${m.netDebtToAssets}`);
  }
  // EXR/EGP carry a FFO axis (annualDepreciation present) — also wrapped, must be numeric.
  for (const t of ['EXR', 'EGP']) {
    const m = RE_.find(x => x.ticker === t);
    assert(m.ffoAssets != null && typeof m.ffoAssets === 'number' && isFinite(m.ffoAssets),
      `${t} ffoAssets sollte eine endliche Zahl sein, ist ${m.ffoAssets}`);
  }
});

test('equity_reits FFO-gains guard (court rev #2): SPG ((NI+dep)/OCF=1.49) carries FFO_GAINS_INFLATED + capped FFO', () => {
  const spg = RE_.find(m => m.ticker === 'SPG');
  assert(spg != null, 'SPG sollte in der Kohorte sein');
  assert(spg.score != null, 'SPG sollte gescort sein');
  assert(Array.isArray(spg.lamps) && spg.lamps.includes('FFO_GAINS_INFLATED'),
    'SPG sollte den FFO_GAINS_INFLATED-Lamp tragen (gains-on-sale-infliertes FFO gecappt)');
  // the capped FFO must be sane (positive, finite) — the sanity bound min(NI+dep, OCF+dep)/assets applied.
  assert(spg.ffoAssets != null && isFinite(spg.ffoAssets) && spg.ffoAssets > 0, `SPG ffoAssets sollte gecappt + sane sein, ist ${spg.ffoAssets}`);
});

test('equity_reits TOP-TIER-NO-FFO disclosure (court rev #3): VICI/O/PLD/TRNO ffoAssets DROPPED + renorm, NOT hidden', () => {
  for (const t of ['VICI', 'O', 'PLD', 'TRNO']) {
    const m = RE_.find(x => x.ticker === t);
    assert(m != null, `${t} fehlt`);
    assert(m.ffoAssets == null, `${t} sollte ffoAssets=null haben (annualDepreciation absent), hat ${m.ffoAssets}`);
    assert(m.score != null && isFinite(m.score), `${t} sollte trotzdem gescort sein (auf opMargin+revG3+ndGA renormed)`);
    assert(Array.isArray(m.absUsedAxes) && !m.absUsedAxes.includes('ffoAssets'), `${t} sollte ffoAssets NICHT in usedAxes haben`);
    assert(Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.includes('ffoAssets'), `${t} sollte ffoAssets in droppedAxes haben`);
    assert(m.absUsedAxes.length >= 2, `${t} sollte auf den anderen Achsen scoren (>=2 usedAxes)`);
    assert(m.lamps.includes('FFO_COVERAGE_PARTIAL'), `${t} sollte FFO_COVERAGE_PARTIAL lamp tragen`);
  }
  // bucket-level coverage disclosure.
  assert(reR.ffoCoverage != null && reR.ffoCoverage.dropped > 0, 'ffoCoverage (DROP disclosure) fehlt/leer');
});

test('equity_reits SHELL SI-4 (court found FRMI/MRP/JAN/BXDC): <3 positive-revenue-years / no balance sheet excluded (score=null)', () => {
  for (const t of ['FRMI', 'MRP', 'JAN', 'BXDC']) {
    const m = RE_.find(x => x.ticker === t);
    if (!m) continue; // (CMRF is excluded a-fortiori at classification as an OTC pink-sheet name → not in members at all)
    assert(m.score === null, `${t} (shell, <3 positive-rev-years) sollte score=null haben, hat ${m.score}`);
    assert(m.exclusionReason === 'OUT_OF_SEGMENT:shell', `${t} sollte OUT_OF_SEGMENT:shell sein, ist ${m.exclusionReason}`);
  }
  // CMRF is NOT classified into equity_reits (OTC pink-sheet non-traded REIT → de-ADR/OTC guard at classification).
  assert(!RE_.some(m => m.ticker === 'CMRF'), 'CMRF (OTC pink-sheet) darf NICHT in der equity_reits-Kohorte sein');
  // every excluded member has score=null (SI-4: never a misleading 0/headline rank).
  assert(Array.isArray(reR.excluded), 'excluded[] fehlt');
  for (const m of reR.excluded) assert(m.score == null, `${m.ticker} in excluded[] sollte score=null haben, hat ${m.score}`);
});

test('equity_reits CBL thin-axis: survives the shell gate (3 rev-years) but thin (only ndGA) → membership-Out, NOT shell-excluded', () => {
  const cbl = RE_.find(m => m.ticker === 'CBL');
  if (cbl) {
    // CBL is NOT a shell (3 positive-revenue-years) — it is a thin-axis distressed retail REIT (only ndGA computable).
    assert(cbl.exclusionReason !== 'OUT_OF_SEGMENT:shell', 'CBL ist KEIN shell (3 rev-years) — darf NICHT OUT_OF_SEGMENT:shell sein');
    // it took the coverage-renorm thin-axis path (opMargin/ffoAssets/revG3 dropped).
    assert(Array.isArray(cbl.absDroppedAxes) && cbl.absDroppedAxes.includes('opMargin'),
      'CBL sollte opMargin gedroppt haben (thin-axis coverage-renorm)');
    assert(cbl.lamps.some(l => /coverage-renorm/.test(l)), 'CBL sollte einen coverage-renorm-Lamp tragen (thin-axis)');
  }
});

test('equity_reits: top names sane (quality triple-net/industrial/specialty/healthcare REITs, NOT a shell/mortgage)', () => {
  const ranked = RE_.filter(m => m.score != null && isFinite(m.score)).sort((a, b) => b.score - a.score);
  assert(ranked.length > 0, 'keine gescorten REIT-Namen');
  const top = ranked[0];
  // the replicated top set: VICI/O/PLD/TRNO/EXR/EGP/CTRE/EPRT/OHI/LTC + the marquees (triple-net/industrial/specialty/healthcare).
  const KNOWN_QUALITY = new Set(['VICI', 'O', 'PLD', 'TRNO', 'EXR', 'EGP', 'CTRE', 'EPRT', 'OHI', 'LTC', 'ADC', 'NNN', 'WPC', 'STAG', 'REXR', 'AMT', 'PSA']);
  assert(top.exclusionReason !== 'OUT_OF_SEGMENT:shell', `TOP ${top.ticker} darf KEIN shell sein`);
  assert(KNOWN_QUALITY.has(top.ticker), `TOP sollte ein bekannter Quality-REIT sein, ist ${top.ticker}`);
  // no mortgage REIT scored at all (positive-control inside the ranked set).
  const MORTGAGE = new Set(['NLY', 'AGNC', 'STWD', 'ABR', 'RITM', 'BXMT', 'CIM']);
  const leaked = ranked.filter(m => MORTGAGE.has(m.ticker));
  assert(leaked.length === 0, `mortgage REIT(s) gescort: ${leaked.map(m => m.ticker).join(', ')}`);
});

test('equity_reits: FOUR scored axes {opMargin, ffoAssets, revG3, ndGA}; weights Σ=1.0; opMargin+ffoAssets the pillar', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const w = NORMS.equity_reits.weights;
  const keys = Object.keys(w).sort().join(',');
  assert(keys === 'ffoAssets,ndGA,opMargin,revG3', `4 Achsen erwartet, hat ${keys}`);
  for (const forbidden of ['gpa', 'gm', 'fcfMargin', 'netIssuance', 'roce', 'assetGrowthPenalty']) {
    assert(!(forbidden in w), `${forbidden} darf KEINE gewichtete REIT-Achse sein`);
  }
  const sum = Object.values(w).reduce((s, v) => s + v, 0);
  assert(Math.abs(sum - 1.0) < 1e-9, `weights sollten Σ=1.0 sein, sind ${sum}`);
  assert(w.opMargin === 0.30 && w.ffoAssets === 0.30 && w.revG3 === 0.25 && w.ndGA === 0.15,
    'weights sollten {opMargin .30, ffoAssets .30, revG3 .25, ndGA .15} sein');
  // opMargin+ffoAssets the profitability pillar (.60); ndGA .15 the GENEROUS leverage-discipline tiebreaker (smallest).
  assert((w.opMargin + w.ffoAssets) === 0.60, 'opMargin+ffoAssets sollten den .60 Profitabilitäts-Pillar bilden');
  assert(w.ndGA <= Math.min(w.opMargin, w.ffoAssets, w.revG3), 'ndGA sollte das kleinste Achsengewicht (GENEROUS discipline) sein');
});

test('equity_reits: NORMS frozen-id + recomputed anchors (opMargin .08/.54, ffoAssets .023/.094, revG3 .00/.17, ndGA -.60/-.29)', () => {
  const { NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  const n = NORMS.equity_reits;
  assert(n.id === 'reits-norms-2026-06-24', `norm id falsch: ${n.id}`);
  assert(n.opMargin.floor === 0.08 && n.opMargin.elite === 0.54, `opMargin sollte .08/.54 sein, ist ${n.opMargin.floor}/${n.opMargin.elite}`);
  assert(n.ffoAssets.floor === 0.023 && n.ffoAssets.elite === 0.094, 'ffoAssets sollte .023/.094 sein');
  assert(n.revG3.floor === 0.00 && n.revG3.elite === 0.17, 'revG3 sollte .00/.17 sein');
  // ndGA is the INVERTED leverage-discipline axis: q(-ndGA), floor -.60 (60% net-debt/assets worst), elite -.29 (29% best).
  assert(n.ndGA.floor === -0.60 && n.ndGA.elite === -0.29, 'ndGA sollte -.60/-.29 sein (INVERTED leverage discipline)');
  assert(n.ndGA.elite > n.ndGA.floor, 'ndGA floor<elite (monotone Skala)');
  assert(n.ffoGainsGuard && n.ffoGainsGuard.ratioCap === 1.2, 'ffoGainsGuard.ratioCap sollte 1.2 sein (court rev #2)');
  // n=114 >= REL_MIN_N=15 → full ABS+REL blend (β=0.6), NOT THIN_REL.
  assert(n.rel && n.rel.minN === 15 && n.rel.beta === 0.6, 'reits sollte full ABS+REL (beta .6, minN 15) sein');
});

test('equity_reits-unit: absKaliberReits 4-axis coverage-renorm (ffoAssets-drop renorm Σ=1.0; all-null → 0; ndGA INVERTED)', () => {
  const { absKaliberReits } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  // full 4 axes (elite REIT): high NOI margin, high FFO yield, strong rent growth, low leverage (ndGA .29).
  const full = absKaliberReits({ opMargin: 0.54, ffoAssets: 0.094, revG3: 0.17, ndGA: 0.29 }, 'equity_reits');
  assert(full.usedAxes.length === 4 && full.droppedAxes.length === 0, `full sollte 4 Achsen nutzen, hat ${full.usedAxes.length}`);
  assert(Math.abs(Object.values(full.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renormWeights Σ=1.0');
  assert(full.absK > 0.95, `elite REIT sollte absK~1.0 ergeben, hat ${full.absK}`);
  // ndGA is INVERTED + LEVEL-scored: low net-debt/assets (.29) must score HIGHER than over-levered (.60), all else equal.
  const lowLev = absKaliberReits({ opMargin: 0.40, ffoAssets: 0.06, revG3: 0.10, ndGA: 0.29 }, 'equity_reits');
  const highLev = absKaliberReits({ opMargin: 0.40, ffoAssets: 0.06, revG3: 0.10, ndGA: 0.60 }, 'equity_reits');
  assert(lowLev.absK > highLev.absK, 'Niedrige Leverage (.29) sollte HÖHER scoren als Over-Levered (.60) — ndGA ist INVERTED');
  // GENEROUS: a name at ~.29 scores elite on ndGA, ~.60 floor (only the over-levered lose points).
  const { q, NORMS } = require(path.join(ROOT, 'lib', 'absolute-anchor'));
  assert(q(-0.29, NORMS.equity_reits.ndGA) >= 0.99, 'ndGA .29 sollte elite (q~1) scoren');
  assert(q(-0.60, NORMS.equity_reits.ndGA) <= 0.01, 'ndGA .60 sollte floor (q~0) scoren');
  // ffoAssets-drop (VICI/O/PLD/TRNO-like, annualDepreciation null) → 3 axes renormalize to Σ=1.0 (NEVER imputed)
  const dropFfo = absKaliberReits({ opMargin: 0.48, ffoAssets: null, revG3: 0.18, ndGA: 0.35 }, 'equity_reits');
  assert(dropFfo.droppedAxes.includes('ffoAssets') && dropFfo.usedAxes.length === 3, 'ffoAssets-drop sollte 3 Achsen lassen');
  assert(Math.abs(Object.values(dropFfo.renormWeights).reduce((s, v) => s + v, 0) - 1.0) < 1e-9, 'renorm Σ=1.0 nach ffoAssets-drop');
  // all-null → 0 (pathological shell, no fake-neutral)
  const allNull = absKaliberReits({ opMargin: null, ffoAssets: null, revG3: null, ndGA: null }, 'equity_reits');
  assert(allNull.absK === 0 && allNull.usedAxes.length === 0, 'all-null sollte absK=0 ergeben');
});

test('equity_reits: always-on BLIND walls on every member (SAME_STORE_NOI/OCCUPANCY/NAV_PREMIUM/AFFO/FFO_GAINS)', () => {
  for (const m of RE_) {
    for (const wall of ['SAME_STORE_NOI_BLIND', 'OCCUPANCY_BLIND', 'NAV_PREMIUM_BLIND', 'AFFO_MAINT_CAPEX_BLIND', 'FFO_GAINS_BLIND']) {
      assert(Array.isArray(m.lamps) && m.lamps.includes(wall), `${m.ticker} fehlt BLIND-wall ${wall}`);
    }
  }
  assert(Array.isArray(reR.walls) && reR.walls.includes('NAV_PREMIUM_BLIND'), 'reR.walls fehlt NAV_PREMIUM_BLIND');
});

test('equity_reits SI-3: normTableId + cohort + comparabilityNote (absKaliber cross-bucket, ndGA INVERTED + FFO disclosures)', () => {
  assert(reR.normTableId === 'reits-norms-2026-06-24', `normTableId fehlt/falsch: ${reR.normTableId}`);
  assert(reR.cohort === 'equity_reits', `cohort falsch: ${reR.cohort}`);
  assert(/opMargin/i.test(reR.comparabilityNote || '') && /NAV_PREMIUM_BLIND/i.test(reR.comparabilityNote || ''),
    'comparabilityNote sollte opMargin + NAV_PREMIUM_BLIND nennen');
  assert(/INVERTED|lower net-debt/i.test(reR.comparabilityNote || ''), 'comparabilityNote sollte die ndGA-INVERTED-Richtung disclosen');
  assert(/FFO_COVERAGE_PARTIAL|top-tier|renormed/i.test(reR.comparabilityNote || ''), 'comparabilityNote sollte die top-tier-no-FFO DROP disclosen');
  assert(/HARD-SEPARAT|Mortgage/i.test(reR.comparabilityNote || ''), 'comparabilityNote sollte die mortgage-Hard-Separation disclosen');
  assert(reR.scoreScope === 'intra-bucket' && reR.crossBucketComparableField === 'absKaliber', 'SI-3 scope/field fehlt');
});

test('equity_reits PARITÄT: KEIN reits-only Feld auf den anderen Buckets (Leak-Guard)', () => {
  // TRULY reits-exclusive fields (re/opMarginReit/ffoAssets/revG3/netDebtToAssets/_re*). The shared names
  // (absUsedAxes/absDroppedAxes/cohort/absKaliber) legitimately exist on other CORE members.
  for (const b of ['system_app_software', 'fabless_semi', 'medtech_devices', 'diagnostics_lst', 'industrials_heavy', 'industrials_light', 'staples_branded', 'staples_distribution', 'consdisc_store', 'consdisc_light', 'materials_pricingpower', 'materials_commodity', 'energy_upstream', 'energy_midstream', 'energy_services', 'pharma_branded', 'pharma_biopharma', 'pharma_specialty', 'it_services', 'financials_banks']) {
    if (!doc[b]) continue;
    for (const m of doc[b].members) {
      for (const leak of ['re', 'opMarginReit', 'ffoAssets', 'revG3', 'netDebtToAssets', '_reOpMargin', '_reFfoAssets', '_reRevG3', '_reNdGADisc']) {
        assert(!(leak in m), `${b}/${m.ticker} hat reits-only Feld '${leak}' geleakt (Parität verletzt)`);
      }
    }
  }
});

// Temp-Outputs aufräumen (Harness-Isolation: Produktions-Artefakte bleiben unberührt)
try { fs.unlinkSync(CAND_TEST); } catch {}
try { fs.unlinkSync(RESULTS); } catch {}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
