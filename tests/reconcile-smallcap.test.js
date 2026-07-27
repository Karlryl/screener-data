// tests/reconcile-smallcap.test.js — Standalone-Runner (framework-los: assert + process.exit).
// Deckt scripts/reconcile-smallcap.js ab (5.2-Auflagen 4 und 5 aus
// protocol/5.2-weg1b-universe-registered-20260722.md):
//   (a) delisted -> entfernen (Auflage 4)
//   (b) marketCap ueber der Bandobergrenze -> entfernen (Auflage 5, Band-Austritt)
//   (c1) Nicht-Operating-Vehikel (negativer Umsatz UND Vehikel-Industrie) -> entfernen
//   (c2) negativer Umsatz bei operativer Branche -> BEHALTEN (Korrektur 27.07.)
//   (d) veralteter Snapshot entfernt NICHT (Schutz gegen transiente Fehlurteile)
//   (e) unter der Bandgrenze / kein Snapshot / sonstige route()-Ausschluesse -> BEHALTEN
//   (f) relative Ueberprune-Sperre statt absoluter 200er-Grenze (Auflage 4)
// Fixtures sind EINGEBETTET — kein Netz, kein echtes snapshots-smallcap/.
// Run: node tests/reconcile-smallcap.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('../scripts/reconcile-smallcap.js');
const { MAX_MCAP, MIN_MCAP } = require('../src/scoring/smallcap-route.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const NOW = Date.parse('2026-07-27T00:00:00Z');
const frischeAsOf = new Date(NOW - 2 * 86400000).toISOString();
const alteAsOf = new Date(NOW - 400 * 86400000).toISOString();
const OPTS = { maxAgeDays: 60, now: NOW };

// Ein routbarer, operativer US-Name im Band: positive Jahres- und Quartalsumsaetze,
// echter Sektor, US-Boerse. Bewusst minimal — die Klassifikation delegiert an route().
function snap(over) {
  const base = {
    identifier: { ticker: 'TEST' },
    meta: {
      ticker: 'TEST', name: 'Test Corp', sector: 'Technology', industry: 'Software - Application',
      region: 'US', exchangeName: 'NasdaqGS', reportingCurrency: 'USD', tradingCurrency: 'USD',
      asOf: frischeAsOf, fetchedAt: frischeAsOf,
    },
    marketCap: { value: 500e6, source: 'test', confidence: 0.9, asOf: frischeAsOf },
    metrics: { revenueTTM: { value: 200e6, source: 'test', confidence: 0.9, asOf: frischeAsOf } },
    timeseries: {
      revenueQ: [{ value: 40e6 }, { value: 45e6 }, { value: 48e6 }, { value: 52e6 }],
      opIncQ: [{ value: 4e6 }, { value: 5e6 }, { value: 5e6 }, { value: 6e6 }],
      grossProfitQ: [{ value: 20e6 }, { value: 22e6 }, { value: 24e6 }, { value: 26e6 }],
      netIncomeQ: [{ value: 3e6 }, { value: 4e6 }, { value: 4e6 }, { value: 5e6 }],
    },
    annual: {
      annualRev: [{ value: 150e6 }, { value: 175e6 }, { value: 185e6 }],
      annualOpInc: [{ value: 12e6 }, { value: 16e6 }, { value: 18e6 }],
      annualNetIncome: [{ value: 9e6 }, { value: 12e6 }, { value: 14e6 }],
    },
  };
  return Object.assign({}, base, over, { meta: Object.assign({}, base.meta, (over || {}).meta) });
}

// ── (a) Auflage 4: delisted ──────────────────────────────────────────────────
check('(a) delisted -> entfernen', () => {
  const u = R.classify(snap({ meta: { delisted: true } }), OPTS);
  assert.strictEqual(u.entscheidung, 'entfernen');
  assert.strictEqual(u.grund, 'delisted');
});
check('(a2) delisted entfernt AUCH bei altem Snapshot (ein delisteter Name bekommt keinen frischen mehr)', () => {
  const u = R.classify(snap({ meta: { delisted: true, asOf: alteAsOf, fetchedAt: alteAsOf } }), OPTS);
  assert.strictEqual(u.entscheidung, 'entfernen');
});

// ── (b) Auflage 5: Band-Austritt nach oben ───────────────────────────────────
check('(b) marketCap ueber Bandobergrenze -> entfernen', () => {
  const u = R.classify(snap({ marketCap: { value: MAX_MCAP + 1e6, asOf: frischeAsOf } }), OPTS);
  assert.strictEqual(u.entscheidung, 'entfernen');
  assert.strictEqual(u.grund, 'band-austritt-oben');
});
check('(b2) genau AUF der Obergrenze bleibt drin (Grenze ist inklusiv wie in smallcapRoute)', () => {
  const u = R.classify(snap({ marketCap: { value: MAX_MCAP, asOf: frischeAsOf } }), OPTS);
  assert.strictEqual(u.entscheidung, 'behalten');
});

// ── (b3) Band-Austritt braucht einen FRISCHEN Stand ─────────────────────────
// Der Marktwert schwankt taeglich; die Entfernung ist einseitig und dauerhaft. Ein Name, der
// vor Wochen einmal ueber die Grenze sprang und laengst wieder darunter liegt, darf nicht
// deswegen aus dem Universum fallen. Fuer 'delisted' gilt das NICHT (Fall a2) — ein
// delisteter Name bekommt naturgemaess keinen frischen Snapshot mehr.
check('(b3) Band-Austritt mit 30 Tage altem Stand -> behalten, nur berichten', () => {
  const s = snap({});
  const alt30 = new Date(NOW - 30 * 86400000).toISOString();
  s.meta.asOf = alt30; s.meta.fetchedAt = alt30;
  s.marketCap = { value: 900e6, source: 'test', confidence: 0.9, asOf: alt30 };
  const u = R.classify(s, OPTS);
  assert.strictEqual(u.entscheidung, 'behalten');
  assert.strictEqual(u.grund, 'band-austritt-aber-stand-zu-alt');
});

check('(b4) Band-Austritt mit frischem Stand -> weiterhin entfernen (die Regel bleibt scharf)', () => {
  // Gegenprobe zu (b3): ohne sie waere nicht belegt, dass die neue Frische-Sperre nicht
  // einfach den ganzen Band-Austritt abgeschaltet hat.
  const s = snap({});
  s.marketCap = { value: 900e6, source: 'test', confidence: 0.9, asOf: s.meta.asOf };
  const u = R.classify(s, OPTS);
  assert.strictEqual(u.entscheidung, 'entfernen');
  assert.strictEqual(u.grund, 'band-austritt-oben');
});

// ── (c) Auflage 5: Nicht-Operating ───────────────────────────────────────────
// ⚠ DIESER FALL WURDE AM 27.07. KORRIGIERT. Vorher stand hier nur die erste Haelfte, und
// zwar OHNE Vehikel-Industrie — der Test hat damit eine Fehlklassifikation als Sollverhalten
// festgeschrieben: ein einzelnes negatives Umsatzjahr genuegte, um einen Namen dauerhaft aus
// dem Universum zu entfernen. Am echten Bestand traf das ALT (Altimmune, Inc., Biotechnology,
// 545 Mio. USD, frischer Snapshot). Ein Test, der einen Fehler zementiert, ist schlimmer als
// kein Test: er laesst die spaetere Korrektur wie einen Regress aussehen.
check('(c1) negativer Jahresumsatz UND Vehikel-Industrie -> entfernen', () => {
  const s = snap({});
  s.meta.industry = 'Closed-End Fund - Debt';
  s.annual = { annualRev: [{ value: -8e6 }, { value: 12e6 }], annualOpInc: [{ value: -1e6 }], annualNetIncome: [{ value: -1e6 }] };
  const u = R.classify(s, OPTS);
  assert.strictEqual(u.entscheidung, 'entfernen');
  assert.strictEqual(u.grund, 'nicht-operativ');
});

check('(c2) negativer Jahresumsatz bei OPERATIVER Branche -> behalten (der Altimmune-Fall)', () => {
  // Die Gegenrichtung, und der eigentliche Zweck der Korrektur: eine echte Firma mit einem
  // kaputten Umsatzjahr darf nicht aus dem Universum fallen. Im Scoring wird sie fuer EINEN
  // Tag ausgeschlossen und ist morgen wieder da — hier waere die Entfernung dauerhaft.
  const s = snap({});
  s.meta.industry = 'Biotechnology';
  s.meta.sector = 'Healthcare';
  s.annual = { annualRev: [{ value: -68e3 }, { value: 426e3 }], annualOpInc: [{ value: -1e6 }], annualNetIncome: [{ value: -1e6 }] };
  const u = R.classify(s, OPTS);
  assert.strictEqual(u.entscheidung, 'behalten');
  assert.strictEqual(u.grund, 'auffaellige-umsatzreihe-aber-operative-branche');
});

// ── (d) Frische-Sperre ───────────────────────────────────────────────────────
check('(d) veralteter Snapshot entfernt NICHT, auch wenn er ueber der Grenze steht', () => {
  const u = R.classify(snap({
    meta: { asOf: alteAsOf, fetchedAt: alteAsOf },
    marketCap: { value: MAX_MCAP + 500e6, asOf: alteAsOf },
  }), OPTS);
  assert.strictEqual(u.entscheidung, 'behalten');
  assert.strictEqual(u.grund, 'snapshot-veraltet');
});

// ── (e) Was NICHT entfernt wird ──────────────────────────────────────────────
check('(e1) kein Snapshot -> behalten (wartet auf ersten Pull)', () => {
  const u = R.classify(null, OPTS);
  assert.strictEqual(u.entscheidung, 'behalten');
  assert.strictEqual(u.grund, 'kein-snapshot');
});
check('(e2) unter der Banduntergrenze -> behalten und nur berichten', () => {
  const u = R.classify(snap({ marketCap: { value: MIN_MCAP - 1e6, asOf: frischeAsOf } }), OPTS);
  assert.strictEqual(u.entscheidung, 'behalten');
  assert.strictEqual(u.grund, 'unter-bandgrenze');
});
check('(e3) sonstiger route()-Ausschluss (kein Sektor) -> behalten, nicht prunen', () => {
  const s = snap({});
  s.meta.sector = null; s.meta.industry = null;
  const u = R.classify(s, OPTS);
  assert.strictEqual(u.entscheidung, 'behalten');
  assert.ok(/^route-/.test(u.grund), 'Grund sollte den route()-Ausschluss durchreichen, war: ' + u.grund);
});
check('(e4) operativer Name im Band -> behalten', () => {
  const u = R.classify(snap({}), OPTS);
  assert.strictEqual(u.entscheidung, 'behalten');
});

// ── (f) Auflage 4: RELATIVE Ueberprune-Sperre (End-to-End ueber die CLI) ─────
function mkFixture(n, delistedAnteil) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rsc-'));
  const snapDir = path.join(base, 'snaps');
  fs.mkdirSync(snapDir, { recursive: true });
  const stocks = [];
  for (let i = 0; i < n; i++) {
    const t = 'T' + String(i).padStart(3, '0');
    stocks.push({ ticker: t, yahoo_symbol: t, name: t + ' Inc', marketCapUsd: 5e8 });
    const s = snap({});
    s.identifier.ticker = t; s.meta.ticker = t;
    if (i < delistedAnteil) s.meta.delisted = true;
    fs.writeFileSync(path.join(snapDir, t + '.json'), JSON.stringify(s));
  }
  fs.writeFileSync(path.join(base, 'wl.json'), JSON.stringify({ _meta: { quelle: 'test' }, stocks }));
  fs.writeFileSync(path.join(base, 'main.json'), JSON.stringify({ stocks: [] }));
  return base;
}
function runCli(base, extra) {
  const args = [path.join(__dirname, '..', 'scripts', 'reconcile-smallcap.js'),
    '--watchlist', path.join(base, 'wl.json'),
    '--snapshots', path.join(base, 'snaps'),
    '--main-watchlist', path.join(base, 'main.json')].concat(extra || []);
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

check('(f1) 60 % delisted -> Sperre greift, Datei bleibt unveraendert', () => {
  const base = mkFixture(20, 12);          // 12/20 = 60 % > 25 %
  const vorher = fs.readFileSync(path.join(base, 'wl.json'), 'utf8');
  const r = runCli(base, []);
  assert.strictEqual(r.code, 1, 'Sperre muss mit Exit 1 abbrechen, Ausgabe:\n' + r.out);
  assert.ok(/Ueberprune-Sperre/.test(r.out), 'Fehlermeldung fehlt: ' + r.out);
  assert.strictEqual(fs.readFileSync(path.join(base, 'wl.json'), 'utf8'), vorher, 'Datei wurde trotz Sperre geschrieben');
});
check('(f2) 10 % delisted -> laeuft durch und schreibt', () => {
  const base = mkFixture(20, 2);           // 2/20 = 10 % < 25 %
  const r = runCli(base, []);
  assert.strictEqual(r.code, 0, 'sollte durchlaufen, Ausgabe:\n' + r.out);
  const wl = JSON.parse(fs.readFileSync(path.join(base, 'wl.json'), 'utf8'));
  assert.strictEqual(wl.stocks.length, 18);
  assert.strictEqual(wl.lastReconcileRemoved.length, 2);
});
check('(f3) die Sperre ist RELATIV, nicht die absolute 200er-Grenze aus prune-watchlist.js', () => {
  // 12 Namen gesamt (weit unter 200), 1 delisted = 8,3 % -> muss durchlaufen.
  // Mit dem alten max(200, 50 %)-Floor waere jede Liste < 200 dauerhaft blockiert.
  const base = mkFixture(12, 1);
  const r = runCli(base, []);
  assert.strictEqual(r.code, 0, 'kleine Liste darf nicht an einer absoluten Untergrenze scheitern:\n' + r.out);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(base, 'wl.json'), 'utf8')).stocks.length, 11);
});
check('(f4) --dry-run schreibt nicht', () => {
  const base = mkFixture(20, 2);
  const vorher = fs.readFileSync(path.join(base, 'wl.json'), 'utf8');
  const r = runCli(base, ['--dry-run']);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(fs.readFileSync(path.join(base, 'wl.json'), 'utf8'), vorher);
});
check('(f5) --force ueberstimmt die Sperre', () => {
  const base = mkFixture(20, 12);
  const r = runCli(base, ['--force']);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(base, 'wl.json'), 'utf8')).stocks.length, 8);
});

console.log(fail ? '\nFAILS: ' + fail : '\nalle Checks ok');
process.exit(fail ? 1 : 0);
