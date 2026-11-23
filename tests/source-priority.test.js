'use strict';

// Run standalone: node tests/source-priority.test.js (exit 0 green, 1 red).
// Guard of the "SEC first" field registry (lib/source-priority.js): every field a snapshot carries under
// metrics, timeseries and annual needs an entry, and every entry has the agreed shape. Nothing here reads a number.
// Sources of field keys: (a) a synthetic snapshot from pull-yahoo.js (mapper, OpInc migration, plus a text scan of
// pull-yahoo.js), (b) the key fixture of real snapshots (scripts/source-priority-fixture.js). Overlay scripts and
// other libs (spreads, aliases outside pull-yahoo.js) are seen only through (b): regenerate it after a writer change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { REGISTRY, CONTAINERS, fieldsOf, missingEntries } = require('../lib/source-priority.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('ok   ' + name); } catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + err.message); }
};
const C = '(metrics|timeseries|annual)';
const ASSIGN = '\\s*(?:\\?\\?|\\|\\||&&)?=(?!=)'; // =, ??=, ||=, &&= but not ==
// setPeriods (pull-yahoo.js) writes block[field + 'Ends'] for every field except netIncomeQ (positional with revenueQEnds).
const SETPERIODS_NO_ENDS = new Set(['netIncomeQ']);

/**
 * Container keys pull-yahoo.js writes outside the mapper, from its source text. Commented-out lines are ignored.
 * Sees: direct and bracket-literal assignments (also ??=), an alias of a container (const a = canonical.annual),
 * for-of loops over a literal list that write canonical.<c>[x] or call setPeriods(x, canonical.<c>), and setPeriods
 * with a literal field. Not seen: keys built by string arithmetic, spreads, other files.
 */
function writerKeys(src) {
  const code = src.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  const out = new Set();
  const add = (c, k, ends) => { out.add(c + '.' + k); if (ends) out.add(c + '.' + k + 'Ends'); };
  for (const m of code.matchAll(new RegExp('\\b(?:canonical|snap)\\.' + C + '\\.([A-Za-z0-9_]+)' + ASSIGN, 'g'))) add(m[1], m[2]);
  for (const m of code.matchAll(new RegExp('\\b(?:canonical|snap)\\.' + C + '\\[\\s*[\'"]([A-Za-z0-9_]+)[\'"]\\s*\\]' + ASSIGN, 'g'))) add(m[1], m[2]);
  for (const a of code.matchAll(new RegExp('\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:canonical|snap)\\.' + C + '\\s*[;,\\n]', 'g'))) {
    const id = a[1].replace(/\$/g, '\\$');
    for (const m of code.matchAll(new RegExp('(?<![\\w$.])' + id + '\\.([A-Za-z0-9_]+)' + ASSIGN, 'g'))) add(a[2], m[1]);
  }
  for (const m of code.matchAll(new RegExp('setPeriods\\(\\s*[\'"]([A-Za-z0-9_]+)[\'"]\\s*,\\s*canonical\\.' + C + '\\b', 'g'))) {
    add(m[2], m[1], !SETPERIODS_NO_ENDS.has(m[1]));
  }
  for (const loop of code.matchAll(/for\s*\(\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s+of\s+\[([^\]]*)\]\s*\)\s*/g)) {
    const lits = [...loop[2].matchAll(/['"]([A-Za-z0-9_]+)['"]/g)].map(x => x[1]);
    let i = loop.index + loop[0].length, body;
    if (code[i] === '{') { // balanced block (naive: braces inside strings are not expected in these loops)
      let depth = 0, j = i;
      for (; j < code.length; j++) { if (code[j] === '{') depth++; else if (code[j] === '}' && --depth === 0) break; }
      body = code.slice(i, j + 1);
    } else body = code.slice(i, code.indexOf(';', i) + 1);
    const id = loop[1].replace(/\$/g, '\\$');
    for (const m of body.matchAll(new RegExp('\\b(?:canonical|snap)\\.' + C + '\\[\\s*' + id + '\\s*\\]' + ASSIGN, 'g'))) {
      for (const k of lits) add(m[1], k);
    }
    for (const m of body.matchAll(new RegExp('\\b(?:canonical|snap)\\.' + C + '\\[\\s*' + id + '\\s*\\+\\s*[\'"]Ends[\'"]\\s*\\]' + ASSIGN, 'g'))) {
      for (const k of lits) add(m[1], k + 'Ends');
    }
    for (const m of body.matchAll(new RegExp('setPeriods\\(\\s*' + id + '\\s*,\\s*canonical\\.' + C + '\\b', 'g'))) {
      for (const k of lits) add(m[1], k, !SETPERIODS_NO_ENDS.has(k));
    }
  }
  return out;
}

// (a) Synthetic snapshot from the writers' real code: the pull mapper, the OpInc migration on top (adds
// annual.annualOpIncYahoo), and every container key the scan of pull-yahoo.js finds.
function syntheticSnapshot() {
  const log = console.log;
  console.log = () => {}; // pull-yahoo.js prints its FX table on load
  let snap, reason;
  try {
    const { mapYahooToCanonical } = require('../pull-yahoo.js');
    const { migrateSnapshot } = require('../scripts/opinc-source-migrate.js');
    snap = mapYahooToCanonical({ summaryDetail: { marketCap: 1 }, incomeStatementHistory: { incomeStatementHistory: [
      { endDate: '2025-12-31', totalRevenue: 100, operatingIncome: 10 },
      { endDate: '2024-12-31', totalRevenue: 90, operatingIncome: 8 }] } }, { ticker: 'SYNTH' }, '2026-11-21T00:00:00Z');
    reason = migrateSnapshot(snap, { annualRev: [{ value: 100 }, { value: 90 }], annualOpInc: [{ value: 11 }, { value: 9 }] }).reason;
  } finally { console.log = log; }
  for (const k of writerKeys(fs.readFileSync(path.join(ROOT, 'pull-yahoo.js'), 'utf8'))) {
    const [c, f] = k.split('.');
    if (!Object.hasOwn(snap[c], f)) snap[c][f] = [];
  }
  return { snap, reason };
}

// (b) Real key lists (keys and counts only); the newest fixture file counts.
const FIXDIR = path.join(__dirname, 'fixtures', 'source-priority');
const FIXTURE = path.join(FIXDIR, fs.readdirSync(FIXDIR).filter(f => /^snapshot-keys-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop());
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const KEY = /^(metrics|timeseries|annual)\.[A-Za-z0-9_]+$/;

check('fixture holds key names and counts only', () => {
  const keys = Object.keys(fixture.keys);
  assert.ok(keys.length > 50, 'fixture has ' + keys.length + ' keys');
  for (const k of keys) {
    assert.match(k, KEY);
    assert.ok(Number.isInteger(fixture.keys[k]) && fixture.keys[k] > 0 && fixture.keys[k] <= fixture.files, k);
  }
});

const fixtureSnap = {};
for (const k of Object.keys(fixture.keys)) { const [c, f] = k.split('.'); (fixtureSnap[c] = fixtureSnap[c] || {})[f] = null; }
check('every key of the fixture snapshots has an entry', () => assert.deepEqual(missingEntries(fixtureSnap), []));

const { snap: synth, reason } = syntheticSnapshot();
check('synthetic SEC layer takes the migration path that adds annualOpIncYahoo', () => assert.equal(reason, 'sec-preferred'));
check('synthetic writer snapshot carries the post-mapper fields', () => {
  for (const k of ['annual.annualOpIncYahoo', 'annual.annualSBC', 'annual.annualCapex', 'timeseries.revenueQ', 'metrics.fcfMarginTTM']) {
    assert.ok(fieldsOf(synth).includes(k), k);
  }
});
check('every field of the synthetic writer snapshot has an entry', () => assert.deepEqual(missingEntries(synth), []));

check('break once: an unknown field turns the guard red', () => {
  const broken = { ...synth, metrics: { ...synth.metrics, zzUnregisteredField: null } };
  assert.deepEqual(missingEntries(broken), ['metrics.zzUnregisteredField']);
  assert.deepEqual(missingEntries(synth), [], 'the original stays green');
});

check('break once: the writer scan sees alias, ??=, list-loop and setPeriods writes, not commented-out lines', () => {
  const src = [
    'const _a = canonical.annual;', '_a.annualAlias = [];',
    'canonical.metrics.nullishField ??= null;',
    "canonical.annual['bracketField'] = [];",
    "for (const f of ['annualLoopA', 'annualLoopB']) {", '  canonical.annual[f] = [];', "  canonical.annual[f + 'Ends'] = [];", '}',
    "for (const f of ['seriesQ', 'netIncomeQ']) setPeriods(f, canonical.timeseries, p);",
    "setPeriods('annualLit', canonical.annual, p);",
    '// canonical.annual.commentedOut = [];', ' * canonical.annual.docComment = [];',
    'if (canonical.annual.readOnly == null) x = 1;',
  ].join('\n');
  assert.deepEqual([...writerKeys(src)].sort(), ['annual.annualAlias', 'annual.annualLit', 'annual.annualLitEnds',
    'annual.annualLoopA', 'annual.annualLoopAEnds', 'annual.annualLoopB', 'annual.annualLoopBEnds', 'annual.bracketField',
    'metrics.nullishField', 'timeseries.netIncomeQ', 'timeseries.seriesQ', 'timeseries.seriesQEnds']);
});

check('fieldsOf ignores absent and non-object containers', () => {
  assert.deepEqual(fieldsOf(null), []);
  assert.deepEqual(fieldsOf({ metrics: null, timeseries: [], annual: { b: 1, a: 2 }, external: { x: 1 } }), ['annual.a', 'annual.b']);
});

// Period-end siblings: a series under annual/timeseries has its <key>Ends registered (and the reverse), so a new
// base key forces its sibling. Series without an Ends sibling are named here with the reason.
const NO_ENDS = {
  'timeseries.netIncomeQ': 'positional with revenueQEnds (pull-yahoo.js setPeriods)',
  'annual.annualCostOfRevenue': 'operand of the GP derivation, positional with annualRevEnds',
  'annual.annualOpIncYahoo': 'reference copy of the replaced vendor series, positional with annualOpIncEnds',
};
const ENDS_OF = { 'timeseries.reportedRevenueQEnds': 'timeseries.revenueQ' }; // a sibling whose base is not <name minus Ends>
function siblingErrors(registered, seen) {
  const reg = new Set(registered), errs = [];
  for (const k of new Set([...registered, ...seen])) {
    if (!/^(annual|timeseries)\./.test(k)) continue;
    if (k.endsWith('Ends')) {
      const base = ENDS_OF[k] || k.slice(0, -4);
      if (!reg.has(k)) errs.push(k + ' not registered');
      if (!reg.has(base)) errs.push(k + ' without registered series ' + base);
      else if (reg.has(k) && !ENDS_OF[k] && (REGISTRY[k]?.period !== REGISTRY[base]?.period || REGISTRY[k]?.status !== REGISTRY[base]?.status)) {
        errs.push(k + ' does not follow ' + base);
      }
    } else if (!Object.hasOwn(NO_ENDS, k) && !reg.has(k + 'Ends')) errs.push(k + 'Ends missing for series ' + k);
  }
  return errs.sort();
}
const seen = [...fieldsOf(fixtureSnap), ...fieldsOf(synth)];
check('every series has its period-end sibling registered and the reverse', () => {
  assert.deepEqual(siblingErrors(Object.keys(REGISTRY), seen), []);
});
check('break once: a dropped or orphaned sibling turns the rule red', () => {
  const reg = Object.keys(REGISTRY);
  assert.deepEqual(siblingErrors(reg.filter(k => k !== 'annual.annualSBCEnds'), seen),
    ['annual.annualSBCEnds missing for series annual.annualSBC', 'annual.annualSBCEnds not registered']);
  assert.deepEqual(siblingErrors(reg, [...seen, 'annual.annualGoodwill']), ['annual.annualGoodwillEnds missing for series annual.annualGoodwill']);
  assert.deepEqual(siblingErrors([...reg, 'annual.annualGoodwillEnds'], seen), ['annual.annualGoodwillEnds without registered series annual.annualGoodwill']);
});

const PERIODS = new Set(['quarter', 'ttm', 'year', 'point']);
const STATUS = new Set(['live', 'planned', 'unknown']);
const PREFIXED = /^([a-z]+):(.*)$/;
const nonEmpty = v => typeof v === 'string' && v.trim().length > 0;
function shapeErrors(k, v) {
  const errs = [];
  if (!KEY.test(k) || !CONTAINERS.includes(k.split('.')[0])) errs.push('key');
  const fields = v && typeof v === 'object' ? Object.keys(v).sort().join() : '';
  if (fields !== 'fallback,note,period,status,target,today') errs.push('fields ' + fields);
  if (!PERIODS.has(v?.period)) errs.push('period');
  if (!STATUS.has(v?.status)) errs.push('status');
  for (const f of ['today', 'fallback', 'note']) if (!nonEmpty(v?.[f])) errs.push(f);
  if (!Array.isArray(v?.target) || !v.target.length || !v.target.every(nonEmpty)) { errs.push('target'); return errs; }
  const t = v.target;
  // 'sec:'/'dei:' name a concept, 'market:' a market operand (price, marketCap) of a ratio with SEC operands.
  if (t.some(x => PREFIXED.test(x) && !/^(sec|dei|market):[A-Za-z]+$/.test(x))) errs.push('target prefix');
  const reported = t.some(x => /^(sec|dei):/.test(x));
  if (reported && t.includes('market')) errs.push('target mixes sec and market');
  if (!reported && t.some(x => x.startsWith('market:'))) errs.push('market operand without sec operand');
  const lt = t.indexOf('sec:LongTermDebt'), nc = t.indexOf('sec:LongTermDebtNoncurrent');
  if (lt >= 0 && !(nc >= 0 && nc < lt)) errs.push('LongTermDebt before LongTermDebtNoncurrent');
  return errs;
}
check('every entry is well-formed and frozen', () => {
  assert.ok(Object.isFrozen(REGISTRY));
  for (const [k, v] of Object.entries(REGISTRY)) {
    assert.deepEqual(shapeErrors(k, v), [], k);
    assert.ok(Object.isFrozen(v) && Object.isFrozen(v.target), k + ' frozen');
  }
});
check('break once: the shape check rejects a malformed entry', () => {
  const good = REGISTRY['metrics.revenueTTM'];
  assert.deepEqual(shapeErrors('metrics.x', { ...good, period: 'month' }), ['period']);
  assert.deepEqual(shapeErrors('metrics.x', { ...good, target: [] }), ['target']);
  assert.deepEqual(shapeErrors('price.x', { ...good, status: 'done', note: '' }), ['key', 'status', 'note']);
  assert.deepEqual(shapeErrors('metrics.x', { ...good, target: ['sec:Revenues', 'market'] }), ['target mixes sec and market']);
  assert.deepEqual(shapeErrors('metrics.x', { ...good, target: ['market:price', 'sec:EarningsPerShareDiluted'] }), []);
  assert.deepEqual(shapeErrors('metrics.x', { ...good, target: ['market:price'] }), ['market operand without sec operand']);
  assert.deepEqual(shapeErrors('metrics.x', { ...good, target: ['sec:EntityCommonStockSharesOutstanding (dei)'] }), ['target prefix']);
  assert.deepEqual(shapeErrors('metrics.x', { ...good, target: ['dei:EntityCommonStockSharesOutstanding'] }), []);
  assert.deepEqual(shapeErrors('metrics.x', { ...good, target: ['sec:LongTermDebt', 'sec:DebtCurrent'] }), ['LongTermDebt before LongTermDebtNoncurrent']);
});

const MARKET_TYPE = Object.entries(REGISTRY).filter(([, v]) => v.target.some(x => x === 'market' || x.startsWith('market:')));
check('market-type fields: 16, each says it is the last full pull; the six price ratios are planned', () => {
  assert.equal(MARKET_TYPE.length, 16, MARKET_TYPE.map(([k]) => k).join());
  for (const [k, v] of MARKET_TYPE) assert.ok(v.today.includes('Stand des letzten Vollabrufs'), k);
  for (const f of ['priceSales', 'pe', 'dividendYield', 'enterpriseValue', 'enterpriseToRevenue', 'enterpriseToEbitda']) {
    const v = REGISTRY['metrics.' + f];
    assert.ok(v.status === 'planned' && v.target.some(x => x.startsWith('market:')), f);
  }
});

console.log(Object.keys(REGISTRY).length + ' registered keys; '
  + Object.values(REGISTRY).filter(v => v.status === 'planned').length + ' planned; fixture ' + path.basename(FIXTURE));
if (failed) { console.log(failed + ' check(s) failed'); process.exit(1); }
