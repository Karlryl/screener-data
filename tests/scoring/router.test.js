'use strict';
/**
 * Engine Schicht 1 — Router-Test (Success-Gate (4)).
 * Feste Pruefreihenfolge + GP-Klassifikation gegen echte Anker:
 * SOFI -> Step-2-Exclude (annualGP=0), ICE/CME/NDAQ -> echter GP (r~0.7 trotz
 * gm=100), CRDO -> semiconductors. Plus Pre-Revenue/Struktur/Degen-Edge-Cases.
 *
 * Usage:  node tests/scoring/router.test.js   (Exit 0 gruen / 1 Fehler)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { route, gpClass } = require('../../src/scoring/router.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function snap(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', t + '.json'), 'utf8'));
}

// --- echte Anker ------------------------------------------------------------
test('CRDO -> route semiconductors', () => {
  const r = route(snap('CRDO'));
  assert.equal(r.action, 'route');
  assert.equal(r.formulaId, 'semiconductors');
});
test('SOFI -> Step-2 Hard-Exclude (lender-gp0), NICHT ueber grossMargin', () => {
  const r = route(snap('SOFI')); // gm=83.5 ABER annualGP=[0,0,0,0]
  assert.equal(r.action, 'exclude');
  assert.equal(r.reason, 'lender-gp0');
});
test('ICE/CME/NDAQ -> financials mit ECHTEM GP (r~0.7 trotz gm=100)', () => {
  for (const t of ['ICE', 'CME', 'NDAQ']) {
    const r = route(snap(t));
    assert.equal(r.action, 'route', t + ' action');
    assert.equal(r.formulaId, 'financials', t + ' formulaId');
    assert.equal(r.gpClass, 'real', t + ' gpClass (Master-Diskriminator, nicht grossMargin)');
  }
});

// --- Universum-Filter: nur US -----------------------------------------------
test('Nicht-US (region != US) -> exclude non-us', () => {
  const s = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'KR' }, annual: { annualRev: [{ value: 100 }] } };
  assert.equal(route(s).reason, 'non-us');
});

// --- audit/fix Court Fall 8 (F1): .IR (Euronext Dublin) + .AE (Dubai) oeffnen foreign-listed ---
test('.IR/.AE foreign-listed: routebarer Name NICHT mehr exclude non-us (F1)', () => {
  // EMAAR.AE-Muster: Real-Estate-Developer, .AE-Suffix -> isForeignListed oeffnet in den globalen Topf.
  const ae = { meta: { sector: 'Real Estate', industry: 'Real Estate - Development', ticker: 'EMAAR.AE' },
    annual: { annualRev: [{ value: 5000 }, { value: 4000 }], annualGP: [{ value: 3000 }, { value: 2400 }] } };
  assert.equal(route(ae).action, 'route', 'EMAAR.AE-Muster sollte routen');
  assert.equal(route(ae).formulaId, 'real-estate');
  // .IR-Software ebenso routebar (statt non-us).
  const ir = { meta: { sector: 'Technology', industry: 'Software - Application', ticker: 'FOO.IR' },
    annual: { annualRev: [{ value: 300 }, { value: 200 }], annualGP: [{ value: 180 }, { value: 120 }] } };
  assert.equal(route(ir).action, 'route', '.IR-Software mit GP sollte routen');
  assert.notEqual(route(ir).reason, 'non-us');
});
test('.IR-Bank bleibt balance-sheet-bank (structExclude-Vorrang vor foreign-listed-Oeffnung)', () => {
  // BIRG.IR/PTSB.IR-Muster: Bank-Industry -> structExclude greift VOR dem globalen Topf.
  const bank = { meta: { sector: 'Financial Services', industry: 'Banks - Regional', ticker: 'BIRG.IR' },
    annual: { annualRev: [{ value: 1000 }] } };
  assert.equal(route(bank).action, 'exclude');
  assert.equal(route(bank).reason, 'balance-sheet-bank');
});
test('US-Aktie passiert den Filter', () => {
  const s = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US' }, annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(s).action, 'route');
});

// A3-Stufe-1 (2026-06-27, Weltweit-Pivot): US-PRIMAERboersen-gelistete foreign-domiciled ADRs
// (USD/SEC-Filer) werden GEOEFFNET; OTC-Grey-Market bleibt bis A4 zurueckgestellt; foreign-LISTED
// (foreign exchange) bleibt excludiert. (Ersetzt die alte US-only-ADR-Exclude-Policy bewusst.)
test('US-primaer-gelisteter ADR (region=Laendercode TW, NYSE) -> JETZT route (A3-Stufe-1)', () => {
  const tsm = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'TW', exchangeName: 'NYSE', ticker: 'TSM' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(tsm).action, 'route');
  assert.equal(route(tsm).formulaId, 'semiconductors');
});
test('OTC-Grey-Market-ADR bleibt zurueckgestellt -> exclude non-us (bis A4-Lampen/Dedup)', () => {
  const adr = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'JP', exchangeName: 'OTC Markets OTCPK', ticker: 'XYZF' },
    annual: { annualRev: [{ value: 100 }] } };
  assert.equal(route(adr).reason, 'non-us');
});
test('US-Name mit Boersennamen in region (SOFI/ICE-Muster) -> bleibt drin', () => {
  const s = { meta: { sector: 'Financial Services', industry: 'Capital Markets', region: 'NasdaqGS' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(s).action, 'route');
});
test('region=US-Fehler: foreign-LISTED (HKSE) oeffnet (A3-Stufe-2), OTC-Grey bleibt raus', () => {
  // HKSE-gelistet trotz falschem region=US -> foreign-listed -> JETZT offen (Stufe-2).
  const hk = { meta: { sector: 'Healthcare', industry: 'Biotechnology', region: 'US', country: 'China', exchangeName: 'HKSE', ticker: '6699.HK' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(hk).action, 'route');
  assert.equal(route(hk).formulaId, 'health-care');
  // OTC-Grey-Market (US-OTC, kein Auslands-Suffix) bleibt Duplikat-zurueckgestellt.
  const au = { meta: { sector: 'Healthcare', industry: 'Drug Manufacturers', region: 'US', country: 'Australia', exchangeName: 'OTC Markets OTCPK', ticker: 'MEOBF' },
    annual: { annualRev: [{ value: 100 }] } };
  assert.equal(route(au).reason, 'non-us');
});
test('US-Domizil (country United States) bleibt drin', () => {
  const s = { meta: { sector: 'Healthcare', industry: 'Biotechnology', region: 'NasdaqGM', country: 'United States', ticker: 'SEPN' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(s).action, 'route');
});

// --- A3-Stufe-1: US-gelistete foreign-domiciled ADRs oeffnen (USD/SEC) -------
test('Foreign-Domizil (country=Ireland) US-primaer gelistet (NYSE) -> route (ACN/ETN-Muster)', () => {
  const acn = { meta: { sector: 'Technology', industry: 'Information Technology Services', country: 'Ireland', exchangeName: 'NYSE', ticker: 'ACN' },
    annual: { annualRev: [{ value: 100 }] } };
  assert.equal(route(acn).action, 'route');
  assert.equal(route(acn).formulaId, 'it-services');
});
test('China-ADR ohne country (region=CN, NYSE) -> route (BABA-Muster, USD/SEC-20F)', () => {
  const baba = { meta: { sector: 'Consumer Cyclical', industry: 'Internet Retail', region: 'CN', exchangeName: 'NYSE', ticker: 'BABA' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(baba).action, 'route');
  assert.equal(route(baba).formulaId, 'consumer-discretionary');
});
test('2.6-Carve-out: Education & Training Services -> consumer-discretionary (GICS), nicht staples', () => {
  const tal = { meta: { sector: 'Consumer Defensive', industry: 'Education & Training Services', region: 'CN', exchangeName: 'NYSE', ticker: 'TAL' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(tal).action, 'route');
  assert.equal(route(tal).formulaId, 'consumer-discretionary');
  // Kontrolle: normale Defensive-Namen bleiben staples
  const ko = { meta: { sector: 'Consumer Defensive', industry: 'Beverages - Non-Alcoholic', exchangeName: 'NYSE', ticker: 'KO' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(ko).formulaId, 'consumer-staples');
});
test('Foreign-Domizil OTC-gelistet bleibt zurueckgestellt -> non-us (ASMLF-Grey-Duplikat)', () => {
  const asmlf = { meta: { sector: 'Technology', industry: 'Semiconductor Equipment & Materials', country: 'Netherlands', exchangeName: 'OTC Markets OTCPK', ticker: 'ASMLF' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(asmlf).reason, 'non-us');
});
// A3-Stufe-2 (2026-06-27, Weltweit-Pivot): foreign-LISTED (echte Auslandsboerse per FOREIGN_EX
// oder Auslands-Suffix) wird in den globalen Topf GEOEFFNET (Lampen-geschuetzt: A4-data-suspect-Gate
// in score.js laeuft VOR dem Scoring). OTC-Grey-Market-Schattenduplikate (US-OTC, keine
// Auslandsboerse/-Suffix) bleiben fuer den spaeteren Dedup-Zyklus zurueckgestellt.
test('Foreign-LISTED wird GEOEFFNET (A3-Stufe-2): LSE CPG.L + Tokyo 6501.T', () => {
  const cpg = { meta: { sector: 'Consumer Defensive', industry: 'Restaurants', exchangeName: 'LSE', ticker: 'CPG.L' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(cpg).action, 'route');      // LSE = Auslandsboerse -> jetzt offen
  assert.equal(route(cpg).formulaId, 'consumer-staples');
  const tokyo = { meta: { sector: 'Technology', industry: 'Semiconductors', country: 'Japan', exchangeName: 'Tokyo', ticker: '6501.T' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(tokyo).action, 'route');
  assert.equal(route(tokyo).formulaId, 'semiconductors');
});
test('Suffix-only foreign-listed (kein exchangeName) -> route (A3-Stufe-2)', () => {
  // .KS-Suffix allein (Korea) reicht als foreign-listed-Signal, auch ohne exchangeName.
  const ks = { meta: { sector: 'Technology', industry: 'Semiconductors', ticker: '005930.KS' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(ks).action, 'route');
});

// --- Schritt 0: Pre-Revenue -------------------------------------------------
test('kein/leerer Umsatz (mit Sektor) -> survival-track', () => {
  // audit/fix R3: Pre-Revenue laeuft jetzt NACH no-sector -> ein pre-revenue-Name braucht einen
  // routebaren Sektor, um in survival zu landen (echte Pre-Rev-Biotechs tragen sector=Healthcare).
  const bio = { meta: { sector: 'Healthcare', industry: 'Biotechnology' } };
  assert.equal(route({ ...bio, annual: { annualRev: [] } }).action, 'survival');
  assert.equal(route({ ...bio, annual: { annualRev: [{ value: 0 }, { value: 0 }] } }).track, 'pre-revenue');
  // R3-Lock: sektorlos + umsatzlos (Fonds/ETF, z.B. QQQ/MDY) -> no-sector, NICHT survival.
  assert.equal(route({ meta: {}, annual: { annualRev: [] } }).reason, 'no-sector');
});

// --- Schritt 1: Struktur-Hard-Exclude ---------------------------------------
test('Bilanz-Bank / Versicherer / mREIT -> exclude', () => {
  assert.equal(route({ meta: { sector: 'Financial Services', industry: 'Banks—Regional' }, annual: { annualRev: [{ value: 9 }] } }).reason, 'balance-sheet-bank');
  assert.equal(route({ meta: { sector: 'Financial Services', industry: 'Insurance—Life' }, annual: { annualRev: [{ value: 9 }] } }).reason, 'insurer');
  assert.equal(route({ meta: { sector: 'Real Estate', industry: 'REIT—Mortgage' }, annual: { annualRev: [{ value: 9 }] } }).reason, 'mortgage-reit');
});

// --- A3-Stufe-2: Non-Operating-Revenue-Exclude (Investment-Trusts/Closed-End-Funds) ---
test('Negativer Jahresumsatz (Investment-Trust/CEF) -> exclude non-operating-rev', () => {
  // SMT.L/ADX-Muster: "Umsatz" = Anlagegewinn/-verlust, kippt ins Negative -> kein operatives
  // Umsatzgeschaeft, gehoert nicht in den Wachstums-Topf (sonst Mark-to-Market-Rank #1).
  const trust = { meta: { sector: 'Financial Services', industry: 'Asset Management', region: 'US', ticker: 'XCEF' },
    annual: { annualRev: [{ value: -2900 }, { value: 1500 }, { value: 800 }] } };
  assert.equal(route(trust).reason, 'non-operating-rev');
  // Positiv-Kontrolle: durchweg positiver Umsatz -> NICHT von dieser Regel gefangen.
  const op = { meta: { sector: 'Technology', industry: 'Software', region: 'US', ticker: 'OPCO' },
    annual: { annualRev: [{ value: 300 }, { value: 200 }], annualGP: [{ value: 180 }] } };
  assert.equal(route(op).action, 'route');
});
// --- audit/fix Hard-Review AE-SC-002: (a) faelschlich UNIVERSELL, fing echte Healthcare/Biotech-
// Firmen mit einem einzelnen negativen Glitch-Jahr statt nur Non-Operating-Vehikel ---
test('Biotech mit EINEM negativen Jahresumsatz (Glitch, sonst real) bleibt drin (NBTX-Muster, AE-SC-002)', () => {
  const bio = { meta: { sector: 'Healthcare', industry: 'Biotechnology', region: 'US', ticker: 'NBTXX' },
    annual: { annualRev: [{ value: 37982751 }, { value: -8380142 }, { value: 42194381 }, { value: 5565784 }] } };
  const r = route(bio);
  assert.equal(r.action, 'route', 'echte Biotech-Umsatztraeger duerfen nicht als non-operating-rev excludiert werden');
  assert.equal(r.formulaId, 'health-care');
  // Kontrolle: ein Non-Healthcare-CEF mit negativem Jahresumsatz bleibt weiter gefangen (Zielbild von (a) intakt).
  const cef = { meta: { sector: 'Financial Services', industry: 'Closed-End Fund - Equity', region: 'US', ticker: 'CEFY' },
    annual: { annualRev: [{ value: -500 }, { value: 200 }] } };
  assert.equal(route(cef).reason, 'non-operating-rev');
});
test('Investment-Holding (Asset-Mgmt, GP=0, ni~rev) -> non-operating-rev (3i-Group-Muster)', () => {
  const holding = { meta: { sector: 'Financial Services', industry: 'Asset Management', region: 'US', ticker: 'HOLD' },
    annual: { annualRev: [{ value: 5211 }], annualGP: [{ value: 0 }], annualNetIncome: [{ value: 5045 }] } };
  assert.equal(route(holding).reason, 'non-operating-rev'); // GP=0 & |ni/rev|=0.97 -> kein Fee-Geschaeft
});
test('Asset-Mgmt mit negativem Quartalsumsatz -> non-operating-rev (NAV-Holding/BDC)', () => {
  const nav = { meta: { sector: 'Financial Services', industry: 'Asset Management', region: 'US', ticker: 'NAVH' },
    annual: { annualRev: [{ value: 4566 }], annualGP: [{ value: 0 }] },
    timeseries: { revenueQ: [{ value: 1846 }, { value: -3186 }, { value: 7793 }] } };
  assert.equal(route(nav).reason, 'non-operating-rev'); // Industrivaerden/Investor-AB-Muster
});
test('echter Fee-Asset-Manager (GP>0) bleibt drin -> route financials (BLK-Muster)', () => {
  const blk = { meta: { sector: 'Financial Services', industry: 'Asset Management', region: 'US', ticker: 'BLKX' },
    annual: { annualRev: [{ value: 24216 }], annualGP: [{ value: 11310 }], annualNetIncome: [{ value: 5553 }] },
    timeseries: { revenueQ: [{ value: 6698 }, { value: 7008 }] } };
  const r = route(blk);
  assert.equal(r.action, 'route');
  assert.equal(r.formulaId, 'financials'); // GP>0 -> Fee-Geschaeft, kein NAV-Vehikel
});
test('operative Firma mit EINEM negativen Quartal bleibt drin (negQ NUR Asset-Mgmt-gescoped)', () => {
  // DuPont/Teleflex-Muster: ein negatives Quartal (Restatement/Glitch) ist bei OPERATIVEN Firmen
  // legitim -> universeller negQ-Exclude waere ein False-Positive (16 reale Namen). Daher gescoped.
  const op = { meta: { sector: 'Basic Materials', industry: 'Specialty Chemicals', region: 'US', ticker: 'DDX' },
    annual: { annualRev: [{ value: 12000 }], annualGP: [{ value: 4000 }] },
    timeseries: { revenueQ: [{ value: 3000 }, { value: -100 }, { value: 3100 }] } };
  assert.equal(route(op).action, 'route');
});
// --- Court Fall 8/1b: leer-annualRev Finanz-Vehikel (Branch d) ---------------
test('leer-annualRev CEF/Shell/Asset-Mgmt -> exclude non-operating-rev (Branch d)', () => {
  // BMEZ/RVI/PIN.L (Asset Management) + XXI (Shell Companies): komplett leerer annualRev faellt
  // sonst durch alle (a)-(c)-Signaturen (die present-Werte verlangen) -> survival-Board.
  const cef = { meta: { sector: 'Financial Services', industry: 'Asset Management', region: 'US', ticker: 'CEFX' },
    annual: { annualRev: [] } };
  assert.equal(route(cef).reason, 'non-operating-rev');
  const shell = { meta: { sector: 'Financial Services', industry: 'Shell Companies', region: 'US', ticker: 'SHLX' },
    annual: { annualRev: [{ value: null }] } };
  assert.equal(route(shell).reason, 'non-operating-rev');
  // Court R3 C5: PIN.L-Shape — present-ALL-ZERO annualRev [0,0,0,0] (hasPresent=true!) entging dem
  // !hasPresent-only-Branch-(d) und leakte auf survival. Jetzt: present-all-zero zaehlt ebenso als
  // non-operating (Pantheon International, Asset Management).
  const pinl = { meta: { sector: 'Financial Services', industry: 'Asset Management', region: 'US', ticker: 'PINLX' },
    annual: { annualRev: [{ value: 0 }, { value: 0 }, { value: 0 }, { value: 0 }] } };
  assert.equal(route(pinl).reason, 'non-operating-rev');
});
test('leer-annualRev ECHTES Pre-Rev-Biotech bleibt survival (Branch d eng gescoped)', () => {
  // Kontrolle: ein leer-annualRev Healthcare/Biotech-Name darf NICHT vom Vehikel-Filter gefangen
  // werden — er gehoert aufs Runway-Board (Court Fall 1: echte Pre-Revenue bleiben).
  const bio = { meta: { sector: 'Healthcare', industry: 'Biotechnology', region: 'US', ticker: 'BIOX' },
    annual: { annualRev: [] } };
  assert.equal(route(bio).action, 'survival');
  assert.equal(route(bio).track, 'pre-revenue');
  // Dev-Stage-Miner/Uran (cross-sektor Pre-Revenue) bleiben ebenfalls survival, NICHT exclude.
  const uran = { meta: { sector: 'Energy', industry: 'Uranium', region: 'US', ticker: 'URNX' },
    annual: { annualRev: [] } };
  assert.equal(route(uran).action, 'survival');
});

// --- Schritt 2 laeuft VOR grossMargin (Reihenfolge-Beweis) ------------------
test('annualGP all-zero -> exclude, auch bei hohem grossMargin', () => {
  const s = { meta: { sector: 'Financial Services', industry: 'Credit Services' },
    metrics: { grossMargin: { value: 95 } },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 0 }, { value: 0 }] } };
  assert.equal(route(s).reason, 'lender-gp0');
});
test('leeres/all-null annualGP -> KEIN Exclude (hasPresent-Schutz)', () => {
  const s = { meta: { sector: 'Technology', industry: 'Software' },
    annual: { annualRev: [{ value: 100 }], annualGP: [] } };
  assert.equal(route(s).action, 'route'); // greift NICHT faelschlich (Gate 2e-Analog)
});

// --- sektorlose/nicht-operative Entitaeten -> exclude no-sector -------------
test('kein meta.sector (Bullion-Trust/Warrant/Fonds) -> exclude no-sector', () => {
  const s = { meta: { region: 'US', ticker: 'PHYS' }, annual: { annualRev: [{ value: 50 }], annualGP: [{ value: 30 }] } };
  assert.equal(route(s).reason, 'no-sector');
});

// --- gpClass Master-Diskriminator + Tie-Break -------------------------------
test('gpClass: degenerierter GP (r>=0.99) -> degenerate', () => {
  const s = { annual: { annualGP: [{ value: 100 }], annualRev: [{ value: 100 }] } };
  assert.equal(gpClass(s), 'degenerate');
});
test('gpClass: echter GP (r~0.6) -> real', () => {
  const s = { annual: { annualGP: [{ value: 60 }], annualRev: [{ value: 100 }] } };
  assert.equal(gpClass(s), 'real');
});
test('gpClass Tie-Break: kein GP -> grossMargin entscheidet', () => {
  assert.equal(gpClass({ metrics: { grossMargin: { value: 100 } }, annual: {} }), 'degenerate');
  assert.equal(gpClass({ metrics: { grossMargin: { value: 60 } }, annual: {} }), 'real');
  assert.equal(gpClass({ metrics: {}, annual: {} }), 'none');
});

// --- Regression: Substring-Kollision "credit services".includes("it services") -
test('Credit Services mit echtem GP -> financials (NICHT it-services)', () => {
  const s = { meta: { sector: 'Financial Services', industry: 'Credit Services' },
    annual: { annualRev: [{ value: 1000 }, { value: 800 }], annualGP: [{ value: 600 }, { value: 480 }] } };
  const r = route(s);
  assert.equal(r.formulaId, 'financials');
  assert.equal(r.gpClass, 'real');
});
test('echte IT-Services -> it-services', () => {
  const s = { meta: { sector: 'Technology', industry: 'Information Technology Services' }, annual: { annualRev: [{ value: 100 }] } };
  assert.equal(route(s).formulaId, 'it-services');
});

// --- P1-Carve-out (2.12a): Technology-Hardware/EMS/Peripherie -> tech-hardware ---
test('Hardware-Industrien (Technology) -> tech-hardware, NICHT software-comm-services', () => {
  const mk = (industry, ticker) => ({ meta: { sector: 'Technology', industry, region: 'US', ticker },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } });
  for (const ind of ['Computer Hardware', 'Electronic Components', 'Communication Equipment',
    'Scientific & Technical Instruments', 'Consumer Electronics', 'Solar', 'Electronics & Computer Distribution']) {
    assert.equal(route(mk(ind, 'HW')).formulaId, 'tech-hardware', ind + ' -> tech-hardware');
  }
  // Anker-Marquees (belegt in _P1-FORMEL-DESIGN): ANET (Computer Hardware), APH (Electronic Components).
  assert.equal(route(mk('Computer Hardware', 'ANET')).formulaId, 'tech-hardware');
  assert.equal(route(mk('Electronic Components', 'APH')).formulaId, 'tech-hardware');
});
test('Reihenfolge-Beweis: Semiconductor Equipment & Materials bleibt semiconductors (Schritt 1 VOR Carve-out)', () => {
  const s = { meta: { sector: 'Technology', industry: 'Semiconductor Equipment & Materials', region: 'US' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(s).formulaId, 'semiconductors'); // semiconductor-Substring faengt VOR tech-hardware
});
test('reine Software/Gaming bleibt software-comm-services (Carve-out greift nur bei echter Hardware)', () => {
  const soft = { meta: { sector: 'Technology', industry: 'Software - Infrastructure', region: 'US' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(soft).formulaId, 'software-comm-services');
  // 'Electronic Gaming & Multimedia' enthaelt 'electronic', ist aber KEINE Hardware -> darf NICHT
  // vom TECHHW_INDUSTRY-Regex gefangen werden (Phrasen-Match, kein 'electronic'-Substring).
  const gaming = { meta: { sector: 'Technology', industry: 'Electronic Gaming & Multimedia', region: 'US' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(gaming).formulaId, 'software-comm-services');
});

// --- Regression: Broker/Brokerage NICHT als Bank/Versicherer excludiert -----
test('Versicherungs-Makler & Investment-Brokerage bleiben drin (kein Fehl-Exclude)', () => {
  const broker = { meta: { sector: 'Financial Services', industry: 'Insurance Brokers' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(broker).action, 'route');
  const ib = { meta: { sector: 'Financial Services', industry: 'Investment Banking & Brokerage' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(ib).action, 'route');
});

console.log(`\nrouter.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
