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

test('gate: the first answer of a dead main line does not refuse a live repair symbol', async () => {
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

test('wiring: refresh-universe runs the gate before the persistence cap, with the pull\'s symbol repairs', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'refresh-universe.js'), 'utf8');
  const gate = src.indexOf('await aufnahmeTor(');
  const cap = src.indexOf('capNewTickerAdmission(newTickers, existing.size');
  assert.ok(gate > -1 && cap > -1 && gate < cap, 'the gate must run before the admission cap, otherwise dead symbols take slots');
  assert.match(src, /tor3_aufnahmeQuote/);
  assert.match(src, /normalizeYahooSymbol/);
  assert.match(src, /caClassCandidates/);
});
