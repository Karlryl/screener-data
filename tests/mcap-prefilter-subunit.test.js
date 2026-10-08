'use strict';
// Run: node tests/mcap-prefilter-subunit.test.js (offline, Exit 0/1).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prefilterByMcap } = require('../discovery/mcap-prefilter.js');
const { lokaleSchranken } = require('../refresh-universe.js');

let fail = 0;
let pending = Promise.resolve();
function check(name, fn) {
  // Serial execution keeps each console capture isolated.
  pending = pending.then(fn).then(
    () => console.log('  ok   ' + name),
    (e) => { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); });
}

const RATES = { USD: 1, GBP: 1.324398, ZAR: 0.05, ILS: 0.25 };
const QUOTES = [
  { symbol: 'LLOY.L', currency: 'GBp', marketCap: 60249000000, quoteType: 'EQUITY' },
  { symbol: 'SMALL.L', currency: 'GBp', marketCap: 100e6, quoteType: 'EQUITY' },
  { symbol: 'GBX.L', currency: 'GBX', marketCap: 1e9, quoteType: 'EQUITY' },
  { symbol: 'RAND.JO', currency: 'ZAc', marketCap: 20e9, quoteType: 'EQUITY' },
  { symbol: 'SHEKEL.TA', currency: 'ILA', marketCap: 4e9, quoteType: 'EQUITY' },
  { symbol: 'USD.L', currency: 'USD', marketCap: 90e9, quoteType: 'EQUITY' },
  { symbol: 'FUND.L', currency: 'GBp', marketCap: 1e12, quoteType: 'ETF' },
  { symbol: 'EMPTY.L', currency: 'GBp', marketCap: null, quoteType: 'EQUITY' },
  { symbol: 'UNTYPED.L', currency: 'GBp', marketCap: 1e12 },
];

async function exercise(quotes, rates = RATES) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const result = await prefilterByMcap(quotes.map(q => q.symbol), {
      minUsd: 800e6, rates, quote: async () => quotes,
    });
    return { result, logs };
  } finally {
    console.log = originalLog;
  }
}

check('all four sub-unit aggregates cross the floor correctly; missing base FX stays unpriceable', async () => {
  const { result } = await exercise(QUOTES);
  for (const [symbol, usd] of [
    ['LLOY.L', 60249000000 * RATES.GBP], ['GBX.L', 1e9 * RATES.GBP],
    ['RAND.JO', 1e9], ['SHEKEL.TA', 1e9], ['USD.L', 90e9],
  ]) {
    assert.equal(result.kept.get(symbol), usd, symbol);
    assert.ok(!result.belowUsd.has(symbol), symbol);
  }
  assert.equal(result.belowUsd.get('SMALL.L'), 100e6 * RATES.GBP);
  assert.ok(!result.kept.has('SMALL.L'));
  assert.ok(result.nichtAktie.has('FUND.L'));
  assert.ok(!result.kept.has('EMPTY.L'));
  assert.ok(result.kept.has('UNTYPED.L'), 'missing quoteType keeps its existing fail-open behavior');

  const { result: missing } = await exercise(QUOTES, { USD: 1, ZAR: 0.05, ILS: 0.25 });
  for (const symbol of ['LLOY.L', 'SMALL.L', 'GBX.L']) {
    assert.ok(missing.unpriceable.has(symbol), symbol);
    assert.ok(!missing.belowUsd.has(symbol), symbol);
    assert.ok(!missing.kept.has(symbol), symbol);
  }
  assert.deepEqual(missing.subunit, {
    byCurrency: { ZAc: { priced: 1, kept: 1 }, ILA: { priced: 1, kept: 1 } },
    largest: { symbol: 'RAND.JO', usd: 1e9 },
  });
});

check('sub-unit statistics and the single summary line distinguish mixed quotes from no sub-units', async () => {
  const { result, logs } = await exercise(QUOTES);
  assert.deepEqual(result.subunit, {
    byCurrency: {
      GBp: { priced: 2, kept: 1 }, GBX: { priced: 1, kept: 1 },
      ZAc: { priced: 1, kept: 1 }, ILA: { priced: 1, kept: 1 },
    },
    largest: { symbol: 'LLOY.L', usd: 60249000000 * RATES.GBP },
  });
  assert.deepEqual(logs, [
    '[mcap-prefilter] 9 geprueft (8 beantwortet, 0 Batch-Fehler, 0 KOSDAQ .KS->.KQ, 0 unbewertbar/FX-Luecke) -> 6 >= $0.8B'
    + '; Sub-Einheit-Notierungen (Kurs in Pence/Cent/Agorot, Marktwert in Hauptwaehrung): GBp 2 bepreist/1 ueber der Schwelle, GBX 1/1, ZAc 1/1, ILA 1/1, groesster LLOY.L $79.8B',
  ]);

  const plain = await exercise([
    { symbol: 'USD.L', currency: 'USD', marketCap: 90e9, quoteType: 'EQUITY' },
    { symbol: 'SMALL', currency: 'USD', marketCap: 100e6, quoteType: 'EQUITY' },
  ]);
  assert.deepEqual(plain.result.subunit, { byCurrency: {}, largest: null });
  assert.deepEqual(plain.logs, [
    '[mcap-prefilter] 2 geprueft (2 beantwortet, 0 Batch-Fehler, 0 KOSDAQ .KS->.KQ, 0 unbewertbar/FX-Luecke) -> 1 >= $0.8B; Sub-Einheit-Notierungen: keine',
  ]);
});

function callSites(source) {
  const mask = source.split('');
  let i = 0;
  const blank = (start, end) => {
    for (let k = start; k < end; k++) if (!/[\r\n]/.test(mask[k])) mask[k] = ' ';
  };
  function scan(templateExpression = false) {
    let depth = 0, previous = '';
    while (i < source.length) {
      const start = i, ch = source[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (source.startsWith('//', i) || source.startsWith('/*', i)) {
        const line = source[i + 1] === '/';
        const end = source.indexOf(line ? '\n' : '*/', i + 2);
        i = end < 0 ? source.length : end + (line ? 0 : 2);
        blank(start, i);
        continue;
      }
      if (ch === '"' || ch === "'") {
        i++;
        while (i < source.length) {
          if (source[i] === '\\') { i += 2; continue; }
          if (source[i++] === ch) break;
        }
        blank(start, i);
        previous = 'literal';
        continue;
      }
      if (ch === '`') {
        let segment = i++;
        while (i < source.length) {
          if (source[i] === '\\') { i += 2; continue; }
          if (source[i] === '`') { blank(segment, ++i); break; }
          if (source.startsWith('${', i)) {
            blank(segment, i += 2);
            scan(true);
            segment = i;
          } else i++;
        }
        previous = 'literal';
        continue;
      }
      if (ch === '/' && (!previous || /^(?:[=(:,[!&|?{};+*%~<>-]|return|throw|case|=>)$/.test(previous))) {
        i++;
        let inClass = false;
        while (i < source.length) {
          const c = source[i++];
          if (c === '\\') { i++; continue; }
          if (c === '[') inClass = true;
          if (c === ']') inClass = false;
          if (c === '/' && !inClass) break;
        }
        while (i < source.length && /[a-z]/i.test(source[i])) i++;
        blank(start, i);
        previous = 'literal';
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}' && templateExpression && depth-- === 0) { i++; return; }
      const token = /^(?:[A-Za-z_$][\w$]*|=>)/.exec(source.slice(i));
      previous = token ? token[0] : ch;
      i += previous.length;
    }
  }
  scan();
  const code = mask.join('');
  return [...code.matchAll(/\btoUsd\s*\(/g)]
    .filter(match => !/\bfunction\s*$/.test(code.slice(0, match.index)))
    .map(match => source.slice(0, match.index).split('\n').length - 1);
}

check('the five named aggregate callers use major-unit bounds and reject invalid FX', () => {
  assert.deepEqual(callSites([
    '// toUsd(1)', '/* toUsd(1) */', 'function toUsd(x) {}',
    'const text = "toUsd(1)";', 'const value = toUsd(1);',
    'const bound = toUsd(', '  1);',
  ].join('\n')), [4, 5]);
  for (const source of [
    'const url = `https://example.invalid/${toUsd(1, "GBP", rates)}`;',
    'const text = `https://example.invalid`; const amount = toUsd(1, "GBP", rates);',
    'const matcher = /"/; const amount = toUsd(1, "GBP", rates);',
    'const text = `toUsd(1) ${`${toUsd(1, "GBP", rates)}`}`;',
    'const text = `${({ cap: toUsd(1, "GBP", rates) }).cap}`;',
    'const ratio = value / toUsd(1, "GBP", rates);',
  ]) assert.deepEqual(callSites(source), [0], source);
  assert.deepEqual(callSites('const text = `toUsd(1)`; const matcher = /toUsd[(]/;'), []);
  const root = path.resolve(__dirname, '..');
  const files = fs.readdirSync(root).filter(name => name.endsWith('.js') && !name.endsWith('.test.js'));
  function visit(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (['node_modules', '.git', 'tests'].includes(entry.name)) continue;
      const file = dir + '/' + entry.name;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(file);
    }
  }
  for (const dir of ['discovery', 'scripts', 'lib', 'src']) visit(dir);
  const callers = {};
  for (const file of files.sort()) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const sites = callSites(source);
    if (!sites.length) continue;
    callers[file] = sites.length;
    const lines = source.split('\n');
    for (const line of sites) {
      assert.match(lines[line - 1], /\/\/ toUsd unit: AGGREGATE.*major unit/,
        `${file}:${line + 1} must name its aggregate unit`);
    }
  }
  assert.deepEqual(callers, {
    'discovery/mcap-prefilter.js': 1, 'discovery/tv-scanner.js': 1, 'refresh-universe.js': 3,
  }, 'a new caller requires an explicit unit review');
  const major = lokaleSchranken('GBP', RATES);
  assert.ok(major && major.min > 0 && major.max > major.min);
  assert.deepEqual(lokaleSchranken('GBp', RATES), major);
  for (const rate of [undefined, 0, -1, NaN, Infinity, '1.324398']) {
    assert.equal(lokaleSchranken('GBp', { GBP: rate }), null, String(rate));
  }
});

pending.then(() => {
  console.log(fail ? `\nmcap-prefilter-subunit: ${fail} FAILED` : '\nmcap-prefilter-subunit: all passed');
  process.exit(fail ? 1 : 0);
});
