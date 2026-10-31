'use strict';
// Guard for the intake gate (W7, 30.10.2026). Offline: the quote call is injected.
const assert = require('node:assert/strict');
const test = require('node:test');
const { aufnahmeTor, urteilZurQuote, torProtokoll } = require('../discovery/aufnahme-tor.js');

const NOW = Date.parse('2026-10-30T10:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000);
const one = (i) => [i.ticker];
const live = (symbol) => ({ symbol, quoteType: 'EQUITY', regularMarketTime: daysAgo(0), regularMarketPrice: 5, marketCap: 1e9 });

test('verdict: live equity admitted, the five refusal reasons are told apart', () => {
  assert.equal(urteilZurQuote({ quoteType: 'EQUITY', regularMarketTime: daysAgo(1), regularMarketPrice: 5, marketCap: 1e6 }, NOW), null);
  assert.equal(urteilZurQuote({ quoteType: 'EQUITY', regularMarketTime: daysAgo(1), regularMarketPrice: 5 }, NOW), 'ohne-marktwert');
  assert.equal(urteilZurQuote({ quoteType: 'EQUITY', regularMarketTime: daysAgo(1), marketCap: 0 }, NOW), 'ohne-marktwert');
  assert.equal(urteilZurQuote(undefined, NOW), 'keine-quote');
  assert.equal(urteilZurQuote({ quoteType: 'ETF', regularMarketTime: daysAgo(1) }, NOW), 'kein-aktien-typ');
  assert.equal(urteilZurQuote({ quoteType: 'EQUITY', regularMarketTime: daysAgo(31), regularMarketPrice: 5 }, NOW), 'kurs-zu-alt');
  assert.equal(urteilZurQuote({ quoteType: 'EQUITY' }, NOW), 'kein-kurs');
});

test('verdict: the age limit is exact and a price without a time still counts as alive', () => {
  assert.equal(urteilZurQuote({ quoteType: 'EQUITY', regularMarketTime: daysAgo(30), marketCap: 1 }, NOW), null);
  assert.equal(urteilZurQuote({ quoteType: 'EQUITY', regularMarketPrice: 5, marketCap: 1 }, NOW), null);
  assert.equal(urteilZurQuote({ regularMarketTime: daysAgo(1), marketCap: 1 }, NOW), null, 'missing quoteType stays fail-open, as in prefilterByMcap');
  assert.equal(urteilZurQuote({ quoteType: 'EQUITY', regularMarketTime: daysAgo(1), marketCap: 1 }, NOW), null, 'no size limit: a tiny firm passes');
});

test('gate: the named cases are refused, a live line passes, nothing is lost silently', async () => {
  const candidates = ['1WAF.MI', 'PSKY', 'AHL$D', 'AAPL'].map((ticker) => ({ ticker, source: 'test' }));
  const quote = async () => [
    { symbol: '1WAF.MI', quoteType: 'EQUITY', regularMarketTime: daysAgo(40), regularMarketPrice: 93 },
    live('AAPL'),
  ];
  const r = await aufnahmeTor(candidates, one, { quote, nowMs: NOW });
  assert.deepEqual(r.admitted.map((i) => i.ticker), ['AAPL']);
  assert.deepEqual(r.rejected.map((x) => [x.ticker, x.grund]), [
    ['1WAF.MI', 'kurs-zu-alt'], ['PSKY', 'keine-quote'], ['AHL$D', 'keine-quote']]);
  assert.equal(r.rejected[0].letzterKurs, '2026-09-20');
  assert.equal(r.admitted.length + r.rejected.length, candidates.length);
});

test('gate: a transient miss in the first batch is not a refusal, the second ask decides', async () => {
  const asked = [];
  const quote = async (batch) => { asked.push(batch.length); return asked.length === 1 ? [] : [live('A')]; };
  const r = await aufnahmeTor([{ ticker: 'A' }, { ticker: 'B' }], one, { quote, nowMs: NOW });
  assert.deepEqual(r.admitted.map((i) => i.ticker), ['A']);
  assert.deepEqual(r.rejected.map((x) => x.ticker), ['B']);
  assert.equal(asked.length, 2);
});

test('gate: a bare TSX root passes when its class line is alive, under the row\'s own ticker', async () => {
  const candidatesOf = (i) => (i.ticker === 'ACO.TO' ? ['ACO.TO', 'ACO-X.TO'] : [i.ticker]);
  const quote = async (batch) => (batch.includes('ACO-X.TO') ? [live('ACO-X.TO')] : []);
  const r = await aufnahmeTor([{ ticker: 'ACO.TO' }, { ticker: 'DEAD.TO' }], candidatesOf, { quote, nowMs: NOW });
  assert.deepEqual(r.admitted.map((i) => i.ticker), ['ACO.TO']);
  assert.deepEqual(r.rejected.map((x) => x.ticker), ['DEAD.TO']);
});

test('gate: a main line that answers with a dead price is refused, its repair symbols are not asked (same as the pull)', async () => {
  const candidatesOf = () => ['OLD', 'NEW'];
  const quote = async (batch) => (batch.includes('NEW') ? [live('NEW')] : [
    { symbol: 'OLD', quoteType: 'EQUITY', regularMarketTime: daysAgo(90), regularMarketPrice: 5 }]);
  const r = await aufnahmeTor([{ ticker: 'OLD' }], candidatesOf, { quote, nowMs: NOW });
  assert.equal(r.rejected.length, 1, 'the main symbol answered, so its repair symbols are not asked');
  assert.equal(r.rejected[0].grund, 'kurs-zu-alt');
});

test('gate: a failed batch admits its rows as unchecked (fail-open), other batches still decide', async () => {
  const candidates = Array.from({ length: 201 }, (_, i) => ({ ticker: 'T' + i }));
  let call = 0;
  const quote = async () => { call++; if (call === 1) throw new Error('429'); return []; };
  const r = await aufnahmeTor(candidates, one, { quote, nowMs: NOW });
  assert.ok(r.batchFehler >= 1);
  assert.equal(r.ungeprueft, 0, 'the retry of the misses answered, so those rows were asked after all');
  assert.equal(r.rejected.length, 201);
  let all = 0;
  const down = async () => { all++; throw new Error('503'); };
  const d = await aufnahmeTor(candidates, one, { quote: down, nowMs: NOW });
  assert.ok(all >= 2);
  assert.equal(d.admitted.length, 201, 'a Yahoo outage must not empty the intake');
  assert.equal(d.ungeprueft, 201);
  assert.equal(d.rejected.length, 0);
});

test('protocol: every refused row by name, counts by reason', () => {
  const p = torProtokoll({ befragt: 3, admitted: [{}], ungeprueft: 0, rejected: [
    { ticker: 'A', grund: 'keine-quote' }, { ticker: 'B', grund: 'keine-quote' }] });
  assert.equal(p.befragt, 3);
  assert.equal(p.aufgenommen, 1);
  assert.deepEqual(p.jeGrund, { 'keine-quote': 2 });
  assert.equal(p.abgelehnt.length, 2);
});

// The real path through refresh-universe.js, only Yahoo replaced.
const { wendeAufnahmeTorAn } = require('../refresh-universe.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function realPath(quote, protokoll = null, pfad = null) {
  const warnings = [];
  const realWarn = console.warn, realLog = console.log;
  console.warn = (m) => warnings.push(String(m));
  console.log = () => {};
  try {
    const kept = await wendeAufnahmeTorAn([
      { ticker: 'BRK.B', exchange: 'NYSE', source: 'nasdaq-trader' },
      { ticker: 'ACO.TO', exchange: 'TSX', source: 'tsx' },
      { ticker: 'ALPEK/A.MX', exchange: 'BMV', source: 'tvmx' },
      { ticker: 'DEAD.SW', exchange: 'SIX', source: 'tvch' },
    ], protokoll || {}, pfad || 'memory', { quote, nowMs: NOW,
      ...(pfad ? {} : { writeProtocol: () => {} }) });
    return { kept: kept.map((i) => i.ticker), warnings };
  } finally {
    console.warn = realWarn;
    console.log = realLog;
  }
}

test('real path: refused rows leave the list, Yahoo is asked under the symbols the pull would use', async () => {
  const asked = new Set();
  const quote = async (batch) => {
    batch.forEach((s) => asked.add(s));
    return ['BRK-B', 'ACO-X.TO', 'ALPEKA.MX'].filter((s) => batch.includes(s)).map(live);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w7-tor-'));
  const pfad = path.join(dir, 'protokoll.json');
  try {
    const protokoll = { schwellen: {} };
    const r = await realPath(quote, protokoll, pfad);
    assert.deepEqual(r.kept, ['BRK.B', 'ACO.TO', 'ALPEK/A.MX']);
    assert.ok(asked.has('BRK-B') && !asked.has('BRK.B'), 'US class share in its dash form');
    assert.ok(asked.has('ACO-X.TO'), 'the TSX class retry of the pull');
    assert.ok(asked.has('ALPEKA.MX') && !asked.has('ALPEK/A.MX'), 'the normalization of the pull');
    assert.deepEqual(r.warnings, []);
    const written = JSON.parse(fs.readFileSync(pfad, 'utf8'));
    assert.deepEqual(written.tor3_aufnahmeQuote.abgelehnt.map((x) => x.ticker), ['DEAD.SW']);
    assert.deepEqual(written.schwellen, {}, 'the sections of the first two gates stay');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('real path: a Yahoo outage keeps every candidate and warns loudly', async () => {
  const r = await realPath(async () => { throw new Error('503'); });
  assert.equal(r.kept.length, 4);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^::warning::.*4 neue Zeilen ungeprueft/);
});

test('real path: Yahoo answering nothing refuses all and warns, the existing list is not involved', async () => {
  const r = await realPath(async () => []);
  assert.deepEqual(r.kept, []);
  assert.match(r.warnings.join(' '), /kein einziger Kandidat/);
});

test('real path: a failed protocol write cancels every new rejection and says what happened', async () => {
  const quote = async (batch) => ['BRK-B'].filter((s) => batch.includes(s)).map(live);
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'w7-tor-blocked-'));
  try {
    // The target is an existing directory, so the atomic rename onto it must fail.
    const r = await realPath(quote, {}, blocked);
    assert.deepEqual(r.kept, ['BRK.B', 'ACO.TO', 'ALPEK/A.MX', 'DEAD.SW']);
    assert.match(r.warnings.join(' '), /Protokoll nicht geschrieben.*Ablehnungen.*nicht angewendet/);
  } finally {
    fs.rmSync(blocked, { recursive: true, force: true });
  }
});

test('real path: a crash inside the gate keeps the candidates, warns and never costs the refresh', async () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    // A row whose fields cannot be read throws while its symbol is built.
    const input = [{ get ticker() { throw new Error('boom'); } }];
    const kept = await wendeAufnahmeTorAn(input, null, null, { quote: async () => [], nowMs: NOW });
    assert.equal(kept, input);
    assert.match(warnings.join(' '), /^::warning::\[aufnahme-tor\] uebersprungen \(boom\)/);
  } finally {
    console.warn = realWarn;
  }
});

test('wiring: main() replaces the new rows with the gate result before the persistence cap', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'refresh-universe.js'), 'utf8');
  const gate = src.search(/^[ \t]*newTickers = await wendeAufnahmeTorAn\(newTickers,/m); // whole line, a comment must not pass
  const cap = src.indexOf('capNewTickerAdmission(newTickers, existing.size');
  assert.ok(gate > -1 && cap > -1 && gate < cap, 'the gate must run before the admission cap, otherwise dead symbols take slots');
});
