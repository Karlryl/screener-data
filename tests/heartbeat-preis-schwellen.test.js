'use strict';

// Standalone, synthetic inputs only: node tests/heartbeat-preis-schwellen.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { leseTageSchwelle, messePreisAbdeckung } = require('../scripts/heartbeat-preis-abdeckung.js');

let cases = 0;
for (const [envName, defaultWert] of [['PREIS_NEU_TAGE', 14], ['PREIS_ALT_TAGE', 30]]) {
  const missingLogs = [];
  assert.equal(leseTageSchwelle(envName, defaultWert, {}, line => missingLogs.push(line)), defaultWert);
  assert.deepEqual(missingLogs, [], `${envName}: a missing key must stay silent`);
  cases++;

  for (const [raw, expected] of [['21', 21], ['0', 0], ['2.5', 2.5], [' 21 ', 21], ['1e2', 100]]) {
    const logs = [];
    const env = Object.freeze({ [envName]: raw });
    assert.equal(leseTageSchwelle(envName, defaultWert, env, line => logs.push(line)), expected,
      `${envName}=${JSON.stringify(raw)}: finite non-negative values must be accepted`);
    assert.deepEqual(logs, [], `${envName}=${JSON.stringify(raw)}: valid values must stay silent`);
    cases++;
  }

  for (const raw of ['abc', '-5', '', '  ', 'Infinity', '-Infinity', 'NaN', '1e309']) {
    const logs = [];
    const env = Object.freeze({ [envName]: raw });
    assert.equal(leseTageSchwelle(envName, defaultWert, env, line => logs.push(line)), defaultWert,
      `${envName}=${JSON.stringify(raw)}: invalid values must use the default`);
    assert.deepEqual(logs, [
      `::warning::PREIS-SCHWELLE: ${envName}="${raw}" ist keine Zahl >= 0 — nutze Default ${defaultWert}`,
    ], 'Exactly one column-zero warning must name the key, untrimmed raw value and default');
    cases++;
  }

  for (const [raw, displayed] of [
    ['\n', '\\n'],
    ['\r', '\\r'],
    ['abc\r\ndef', 'abc\\r\\ndef'],
  ]) {
    const logs = [];
    assert.equal(leseTageSchwelle(envName, defaultWert, { [envName]: raw },
      line => logs.push(line)), defaultWert, 'Line-break inputs remain invalid');
    assert.equal(logs.length, 1, 'Invalid line-break input logs once');
    assert.equal(logs[0].split(/\r\n|\r|\n/).length, 1,
      'A warning must occupy exactly one physical line');
    assert.equal(logs[0], '::warning::PREIS-SCHWELLE: ' + envName + '="' + displayed
      + '" ist keine Zahl >= 0 \u2014 nutze Default ' + defaultWert,
    'The raw CR/LF values must remain visible as literal escapes');
    cases++;
  }
}
console.log(`PASS ${cases} threshold cases (missing, valid, invalid); 80 assertions`);

const jetzt = Date.parse('2026-09-25T12:00:00.000Z');
const vorTagen = n => new Date(jetzt - n * 86400000).toISOString();
// Separate tickers: a newcomer leaves the loop before its price age is counted.
const zeilen = [
  { ticker: 'NEU', added_at: vorTagen(3) },
  { ticker: 'BESTAND', added_at: vorTagen(100) },
];
const kurse = { BESTAND: [{ date: vorTagen(60), close: 10 }] };
const unguarded = messePreisAbdeckung(zeilen, kurse, { jetzt, neuTage: NaN, altTage: NaN });
assert.equal(unguarded.ventil, 0, 'NaN reproduces the previously disabled newcomer counter');
assert.equal(unguarded.alt, 0, 'NaN reproduces the previously disabled stale-price counter');

const guarded = messePreisAbdeckung(zeilen, kurse, {
  jetzt,
  neuTage: leseTageSchwelle('X', 14, { X: 'abc' }, () => {}),
  altTage: leseTageSchwelle('Y', 30, { Y: '-5' }, () => {}),
});
assert.equal(guarded.ventil, 1, 'The guarded default keeps the newcomer vent active');
assert.equal(guarded.alt, 1, 'The guarded default keeps the stale-price counter active');
console.log('PASS regression: NaN counters 0/0 -> guarded defaults 1/1');

// Fresh import proves both module constants use the helper, including stdout warnings.
// No main() call: the child measures only the in-memory fixture passed below.
const modulePath = path.join(__dirname, '..', 'scripts', 'heartbeat-preis-abdeckung.js');
const child = spawnSync(process.execPath, ['-e', `
  const h = require(${JSON.stringify(modulePath)});
  const m = h.messePreisAbdeckung(${JSON.stringify(zeilen)}, ${JSON.stringify(kurse)}, { jetzt: ${jetzt} });
  console.log(JSON.stringify({ ventil: m.ventil, alt: m.alt, neuTage: m.neuTage, altTage: m.altTage }));
`], {
  env: { ...process.env, PREIS_NEU_TAGE: 'abc', PREIS_ALT_TAGE: '-5' },
  encoding: 'utf8', timeout: 10000, windowsHide: true,
});
assert.ifError(child.error);
assert.equal(child.status, 0, child.stderr);
assert.equal(child.stderr, '', 'Threshold warnings belong on stdout');
assert.deepEqual(child.stdout.trimEnd().split(/\r?\n/), [
  '::warning::PREIS-SCHWELLE: PREIS_NEU_TAGE="abc" ist keine Zahl >= 0 — nutze Default 14',
  '::warning::PREIS-SCHWELLE: PREIS_ALT_TAGE="-5" ist keine Zahl >= 0 — nutze Default 30',
  JSON.stringify({ ventil: 1, alt: 1, neuTage: 14, altTage: 30 }),
]);
// Check physical stdout as well as the log-spy messages: CR/LF stay in one warning.
const multilineChild = spawnSync(process.execPath, ['-e',
  'require(' + JSON.stringify(modulePath) + ');',
], {
  env: { ...process.env, PREIS_NEU_TAGE: '\n', PREIS_ALT_TAGE: 'abc\r\ndef' },
  encoding: 'utf8', timeout: 10000, windowsHide: true,
});
assert.ifError(multilineChild.error);
assert.equal(multilineChild.status, 0, multilineChild.stderr);
assert.equal(multilineChild.stderr, '', 'Escaped warnings still belong on stdout');
assert.deepEqual(multilineChild.stdout.trimEnd().split(/\r\n|\r|\n/), [
  '::warning::PREIS-SCHWELLE: PREIS_NEU_TAGE="\\n" ist keine Zahl >= 0 \u2014 nutze Default 14',
  '::warning::PREIS-SCHWELLE: PREIS_ALT_TAGE="abc\\r\\ndef" ist keine Zahl >= 0 \u2014 nutze Default 30',
], 'Two invalid variables must yield exactly two physical stdout lines');
console.log('PASS heartbeat-preis-schwellen: 37 cases, 92 assertions; module defaults and single-line stdout verified');
