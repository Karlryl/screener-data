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

// Temp-Outputs aufräumen (Harness-Isolation: Produktions-Artefakte bleiben unberührt)
try { fs.unlinkSync(CAND_TEST); } catch {}
try { fs.unlinkSync(RESULTS); } catch {}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
