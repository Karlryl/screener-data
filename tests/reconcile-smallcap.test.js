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
  //
  // audit/fix (Hard-Review AE-SC-002, 02.08.): router.js isNonOperatingVehicle() Zweig (a) scoped
  // jetzt selbst auf sector!=Healthcare (statt universell jedes negative Jahresumsatz-Jahr zu
  // fangen) — der genau hier zitierte Fehltreffer ("1 harmloser Borderline: NBTX") ist damit an der
  // WURZEL behoben. route() liefert fuer dieses Healthcare-Fixture jetzt direkt action:'route'
  // (nicht mehr 'exclude'/'non-operating-rev'), der reconcile-smallcap-Workaround unten (Zeile
  // 167-174) greift also nicht mehr — die Zeile faellt stattdessen auf 'im-band' durch. Die
  // eigentliche Garantie (entscheidung='behalten', ALT bleibt im Universum) ist DIESELBE, nur der
  // Weg dorthin ist jetzt der direkte statt der kompensierende.
  const s = snap({});
  s.meta.industry = 'Biotechnology';
  s.meta.sector = 'Healthcare';
  s.annual = { annualRev: [{ value: -68e3 }, { value: 426e3 }], annualOpInc: [{ value: -1e6 }], annualNetIncome: [{ value: -1e6 }] };
  const u = R.classify(s, OPTS);
  assert.strictEqual(u.entscheidung, 'behalten', 'die eigentliche Garantie: Altimmune-Muster bleibt im Universum');
  assert.strictEqual(u.grund, 'im-band', 'route() klassifiziert seit AE-SC-002 direkt korrekt statt ueber den non-operating-rev-Workaround');
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
function runCli(base, extra, options) {
  const args = [path.join(__dirname, '..', 'scripts', 'reconcile-smallcap.js'),
    '--watchlist', path.join(base, 'wl.json'),
    '--snapshots', path.join(base, 'snaps'),
    '--main-watchlist', path.join(base, 'main.json')].concat(extra || []);
  if (options) {
    const script = args.shift();
    args.unshift('-e', 'require(process.argv[1]).main(' + JSON.stringify(options) + ');', script);
  }
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
check('(f2) 10% loss on an operational list triggers the collapse guard without writing', () => {
  for (const count of [500]) {   // kleine Listen sind ausgenommen, siehe (f8)
    const base = mkFixture(count, count / 10);
    const file = path.join(base, 'wl.json');
    const before = fs.readFileSync(file, 'utf8');
    const report = path.join(base, 'report.json');
    const r = runCli(base, ['--report', report]);
    assert.strictEqual(r.code, 1, r.out);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    const message = r.out.split('\n').find(line => line.startsWith('::error::'));
    assert.ok(message && message.includes('Collapse-Sperre'), r.out);
    assert.ok(message.includes('von ' + count + ' Namen'), message);
    assert.ok(message.includes('uebrig blieben ' + count * 0.9 + '.'), message);
    const rep = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.strictEqual(rep.gesperrt, 'unter-startschwelle-' + count * 0.9);
    assert.strictEqual(rep.geschrieben, false);
    assert.strictEqual(rep.vorher, count);
    assert.strictEqual(rep.nachher, count);
    assert.deepStrictEqual(rep.entfernt, []);
    assert.strictEqual(rep.wuerde_entfernen.length, count / 10);
  }
});
check('(f3) exactly 95% retained is allowed below the old absolute floor', () => {
  // A small list can still be pruned: 1 of 20 is exactly the allowed 5% loss.
  const base = mkFixture(20, 1);
  const r = runCli(base, [], { operational: false });
  assert.strictEqual(r.code, 0, 'kleine Liste darf nicht an einer absoluten Untergrenze scheitern:\n' + r.out);
  const wl = JSON.parse(fs.readFileSync(path.join(base, 'wl.json'), 'utf8'));
  assert.strictEqual(wl.stocks.length, 19);
  assert.strictEqual(wl.lastReconcileRemoved.length, 1);
});
check('(f4) --dry-run schreibt nicht', () => {
  const base = mkFixture(20, 1);
  const vorher = fs.readFileSync(path.join(base, 'wl.json'), 'utf8');
  const r = runCli(base, ['--dry-run'], { operational: false });
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(fs.readFileSync(path.join(base, 'wl.json'), 'utf8'), vorher);
});
check('(f5) --force ueberstimmt die Sperre', () => {
  const base = mkFixture(20, 12);
  const r = runCli(base, ['--force']);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(base, 'wl.json'), 'utf8')).stocks.length, 8);
});

check('(f6) exactly 500 entries losing two band exits are written as 498', () => {
  const base = mkFixture(500, 0);
  const asOf = new Date().toISOString();
  for (const ticker of ['T000', 'T001']) {
    const s = snap({
      meta: { ticker, asOf, fetchedAt: asOf },
      marketCap: { value: MAX_MCAP + 1e6, asOf },
    });
    s.identifier.ticker = ticker;
    fs.writeFileSync(path.join(base, 'snaps', ticker + '.json'), JSON.stringify(s));
  }
  const r = runCli(base, []);
  assert.strictEqual(r.code, 0, r.out);
  const wl = JSON.parse(fs.readFileSync(path.join(base, 'wl.json'), 'utf8'));
  assert.strictEqual(wl.stocks.length, 498);
  assert.deepStrictEqual(wl.lastReconcileRemoved.map(e => [e.ticker, e.grund]), [
    ['T000', 'band-austritt-oben'], ['T001', 'band-austritt-oben'],
  ]);
  assert.ok(wl.stocks.every(e => !['T000', 'T001'].includes(e.ticker)));
});
check('(f7) --force overrides collapse guard below the first lock threshold', () => {
  const base = mkFixture(20, 2);
  const r = runCli(base, ['--force']);
  assert.strictEqual(r.code, 0, r.out);
  const wl = JSON.parse(fs.readFileSync(path.join(base, 'wl.json'), 'utf8'));
  assert.strictEqual(wl.stocks.length, 18);
  assert.strictEqual(wl.lastReconcileRemoved.length, 2);
});

check('(f8) a small list is NOT subject to the collapse guard and can still be pruned', () => {
  // 8 Namen, 1 entfernt = 12,5 % - auf einer Testliste ist das kein Kollaps, sondern Aufraeumen.
  // Genau diesen Fall fuhr tests/p1-welle1-export-board-wahrheit.test.js gegen die Wand, als die
  // Zustaendigkeitsgrenze kurzzeitig fehlte.
  const base = mkFixture(8, 1);
  const r = runCli(base, [], { operational: false });
  assert.strictEqual(r.code, 0, 'kleine Liste darf nicht an der Kollaps-Sperre scheitern: ' + r.out);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(base, 'wl.json'), 'utf8')).stocks.length, 7);
});

// Exercise the real entry point with entirely in-memory watchlists and writes.
function runMemory(stocks, removeCount, options, extra = []) {
  const Module = require('module');
  const script = require.resolve('../scripts/reconcile-smallcap.js');
  const original = { load: Module._load, cache: require.cache[script], argv: process.argv,
    exit: process.exit, log: console.log, error: console.error };
  const files = new Map([
    ['memory-watchlist.json', JSON.stringify({ stocks })],
    ['memory-main.json', JSON.stringify({ stocks: [] })],
  ]);
  const removed = new Set(stocks.slice(0, removeCount).map(e => e.ticker));
  const writes = new Map();
  const exited = Symbol('exit');
  let code = 0;
  try {
    Module._load = function(request, parent, isMain) {
      if (parent && parent.filename === script && request === 'fs') {
        return { readFileSync(file) {
          if (files.has(file)) return files.get(file);
          const ticker = path.basename(file, '.json');
          return JSON.stringify(removed.has(ticker) ? { meta: { delisted: true } } : {});
        } };
      }
      if (parent && parent.filename === script && request === '../lib/atomic-write.js') {
        return { writeFileAtomic(file, body) { writes.set(file, body); } };
      }
      return original.load.call(this, request, parent, isMain);
    };
    delete require.cache[script];
    const reconcile = require(script);
    process.argv = ['node', script, '--watchlist', 'memory-watchlist.json',
      '--main-watchlist', 'memory-main.json', '--snapshots', 'memory-snaps',
      '--report', 'memory-report.json', ...extra];
    process.exit = (status) => { code = status; throw exited; };
    console.log = console.error = () => {};
    reconcile.main(options);
  } catch (e) {
    if (e !== exited) throw e;
  } finally {
    Module._load = original.load;
    require.cache[script] = original.cache;
    process.argv = original.argv;
    process.exit = original.exit;
    console.log = original.log;
    console.error = original.error;
  }
  return { code, writes,
    stocks: writes.has('memory-watchlist.json')
      ? JSON.parse(writes.get('memory-watchlist.json')).stocks : stocks,
    report: JSON.parse(writes.get('memory-report.json')) };
}
const memoryStocks = count => Array.from({ length: count }, (_, i) => ({ ticker: 'MEM' + i }));

check('(g1) operational 500 -> 498 stays guarded against a later 498 -> 448', () => {
  const first = runMemory(memoryStocks(500), 2);
  assert.strictEqual(first.code, 0);
  assert.strictEqual(first.stocks.length, 498);
  const second = runMemory(first.stocks, 50);
  assert.strictEqual(second.code, 1, '498 -> 448 must be refused');
  assert.strictEqual(second.writes.has('memory-watchlist.json'), false);
  assert.strictEqual(second.report.gesperrt, 'unter-startschwelle-448');
  assert.strictEqual(second.report.nachher, 498);
  assert.deepStrictEqual(second.report.entfernt, []);
  assert.strictEqual(second.report.wuerde_entfernen.length, 50);
});
check('(g2) ordinary operational attrition 476 -> 474 is refused', () => {
  const result = runMemory(memoryStocks(476), 2);
  assert.strictEqual(result.code, 1);
  assert.strictEqual(result.writes.has('memory-watchlist.json'), false);
  assert.strictEqual(result.report.gesperrt, 'unter-startschwelle-474');
});
check('(g3) 8 -> 7 requires an explicit non-operational declaration', () => {
  const stocks = memoryStocks(8);
  const operational = runMemory(stocks, 1);
  assert.strictEqual(operational.code, 1);
  assert.strictEqual(operational.writes.has('memory-watchlist.json'), false);
  const fixture = runMemory(stocks, 1, { operational: false });
  assert.strictEqual(fixture.code, 0);
  assert.strictEqual(fixture.stocks.length, 7);
});

check('(g4) every unforced operational acceptance meets the workflow admission floor', () => {
  const floor = Math.ceil(R.TARGET_SIZE * R.MIN_RETAINED_RATIO);
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'smallcap-pull.yml'), 'utf8');
  const workflowFloor = workflow.match(/if \[ "\$size" -lt (\d+) \]; then/);
  assert.ok(workflowFloor, 'workflow admission check must remain identifiable');
  assert.strictEqual(Number(workflowFloor[1]), floor);
  for (let retained = 0; retained <= R.TARGET_SIZE + 1; retained++) {
    for (const removed of [0, 2]) {
      const result = runMemory(memoryStocks(retained + removed), removed);
      if (result.code === 0) {
        assert.ok(result.stocks.length >= floor, 'accepted operational list below floor');
      } else {
        assert.strictEqual(result.writes.has('memory-watchlist.json'), false);
      }
      // Both sides of the boundary matter: rejecting everything is not a fix.
      assert.strictEqual(result.code, retained >= floor ? 0 : 1,
        `${retained + removed} -> ${retained}`);
    }
  }
});
check('(g5) explicit fixture exemption preserves overprune; force still overrides collapse', () => {
  const overprune = runMemory(memoryStocks(8), 3, { operational: false });
  assert.strictEqual(overprune.code, 1);
  assert.ok(overprune.report.gesperrt.startsWith('ueberprune-'));
  const forced = runMemory(memoryStocks(498), 50, undefined, ['--force']);
  assert.strictEqual(forced.code, 0);
  assert.strictEqual(forced.stocks.length, 448);
  const dryRun = runMemory(memoryStocks(476), 2, undefined, ['--dry-run']);
  assert.strictEqual(dryRun.code, 1);
  assert.strictEqual(dryRun.writes.has('memory-watchlist.json'), false);
});

console.log(fail ? '\nFAILS: ' + fail : '\nalle Checks ok');
process.exit(fail ? 1 : 0);
