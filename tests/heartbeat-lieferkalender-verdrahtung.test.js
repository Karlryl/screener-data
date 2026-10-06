'use strict';
/**
 * P33 (06.10.2026): runs the REAL board-history node block of heartbeat.yml with a pinned
 * clock against synthetic channel indexes. Proves the wiring of lib/liefer-kalender.js:
 * Monday 05.10. with the Saturday stand is green now and was red before (block of the
 * pinned pre-change copy tests/fixtures/heartbeat-vor-p33.yml = 330cc38856), a missed Saturday or Wednesday stays red, the manual-Sunday Mondays
 * 21.09./17.08. are green. Synthetic inputs only; nothing outside a temp dir is written.
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WF = '.github/workflows/heartbeat.yml';

// Node source of the board-history step, bash double-quote unescaped.
function bhBlock(yml) {
  const zeilen = yml.replace(/\r\n/g, '\n').split('\n');
  const i = zeilen.findIndex(z => z.includes('gh-pages/outputs/board-history/index.json" || true) | node -e "'));
  assert.ok(i >= 0, 'board-history probe not found in ' + WF);
  const ende = zeilen.findIndex((z, k) => k > i && z.trim() === '"');
  assert.ok(ende > i, 'end of the board-history node block not found');
  return zeilen.slice(i + 1, ende).join('\n').replace(/\\"/g, '"');
}

function lauf(code, jetzt, index) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-kal-'));
  try {
    const uhr = path.join(dir, 'uhr.js');
    fs.writeFileSync(uhr, `const t=Date.parse(${JSON.stringify(jetzt)}); Date.now=()=>t;\n`);
    const r = spawnSync(process.execPath, ['--require', uhr, '-e', code], {
      cwd: ROOT, input: JSON.stringify(index), encoding: 'utf8',
      env: { ...process.env, BH_MAX_AGE_DAYS: '2' },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const idx = (generatedAt, ...dates) => ({ generated_at: generatedAt, vintages: dates.map(date => ({ date, files: [] })) });
const NEU = bhBlock(fs.readFileSync(path.join(ROOT, WF), 'utf8'));

test('Monday 05.10. with the Saturday stand: green with the calendar', () => {
  const r = lauf(NEU, '2026-10-05T20:42:16.469Z', idx('2026-10-03T09:31:53.394Z', '2026-10-02', '2026-10-03'));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Geplante Pause/);
  assert.doesNotMatch(r.out, /::error::/);
});

// Pinned copy of heartbeat.yml before P33 (git show 330cc38856:.github/workflows/heartbeat.yml),
// so the counter-proof never depends on git history or on HEAD.
const VOR_P33 = path.join(__dirname, 'fixtures', 'heartbeat-vor-p33.yml');

test('the same Monday was red with the block before this change (counter-proof)', () => {
  const alt = fs.readFileSync(VOR_P33, 'utf8');
  assert.ok(!alt.includes('liefer-kalender'), 'fixture must be the pre-change workflow');
  const r = lauf(bhBlock(alt), '2026-10-05T20:42:16.469Z', idx('2026-10-03T09:31:53.394Z', '2026-10-02', '2026-10-03'));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::BEWEGUNGS-ANZEIGE VERALTET/);
});

test('missed Saturday: Monday with the Friday stand stays red', () => {
  const r = lauf(NEU, '2026-10-05T20:42:16.469Z', idx('2026-10-02T09:31:00Z', '2026-10-01', '2026-10-02'));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::BEWEGUNGS-ANZEIGE VERALTET/);
});

test('missed Wednesday: Thursday evening with the Tuesday stand stays red', () => {
  const r = lauf(NEU, '2026-10-08T20:40:00Z', idx('2026-10-06T09:30:00Z', '2026-10-05', '2026-10-06'));
  assert.equal(r.status, 1, r.out);
});

test('publish runs but the vintage stands still: red even on Monday', () => {
  const r = lauf(NEU, '2026-10-05T20:42:16.469Z', idx('2026-10-03T09:31:53.394Z', '2026-10-01', '2026-10-02'));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::BEWEGUNGS-DATEN VERALTET/);
});

test('manual-Sunday Mondays 21.09. and 17.08. are green', () => {
  for (const [jetzt, stempel, tag] of [
    ['2026-09-21T18:18:34Z', '2026-09-20T10:01:00Z', '2026-09-20'],
    ['2026-08-17T13:22:03Z', '2026-08-16T13:27:00Z', '2026-08-16'],
  ]) {
    const r = lauf(NEU, jetzt, idx(stempel, '2026-09-01', tag));
    assert.equal(r.status, 0, jetzt + ': ' + r.out);
  }
});

test('unreadable channel stays red', () => {
  const r = lauf(NEU, '2026-10-05T20:42:16.469Z', { kaputt: true });
  assert.equal(r.status, 1, r.out);
});

// ── export step: the real bash block, curl stubbed, clock pinned via NODE_OPTIONS ──
const YML = fs.readFileSync(path.join(ROOT, WF), 'utf8').replace(/\r\n/g, '\n');

function stepRun(name) {
  const zeilen = YML.split('\n');
  const i = zeilen.findIndex(z => z.trim() === '- name: ' + name);
  assert.ok(i >= 0, 'step not found: ' + name);
  const r = zeilen.findIndex((z, k) => k > i && /^\s+run: \|\s*$/.test(z));
  const einzug = zeilen[r + 1].match(/^\s*/)[0].length;
  const body = [];
  for (let k = r + 1; k < zeilen.length; k++) {
    const z = zeilen[k];
    if (z.trim() !== '' && z.match(/^\s*/)[0].length < einzug) break;
    body.push(z.slice(einzug));
  }
  return body.join('\n').replace(/\$\{\{[^}]*\}\}/g, 'X');
}

const BASH = 'bash';

test('bash is available for the export-step tests (fails visibly when missing)', () => {
  assert.equal(spawnSync(BASH, ['-c', 'exit 0']).status, 0, 'bash missing: the export step cannot be executed');
});

function exportLauf(jetzt, indexText, force = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-exp-'));
  try {
    const fix = path.join(dir, 'index.json');
    fs.writeFileSync(fix, indexText);
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\ncat "$FIXTURE"\n', { mode: 0o755 });
    const uhr = path.join(dir, 'uhr.js');
    fs.writeFileSync(uhr, `const t=Date.parse(${JSON.stringify(jetzt)}); Date.now=()=>t;\n`);
    const skript = path.join(dir, 'step.sh');
    fs.writeFileSync(skript, stepRun('Check export freshness'));
    const r = spawnSync(BASH, ['-e', skript], {
      cwd: ROOT, encoding: 'utf8',
      env: {
        ...process.env, MAX_AGE_DAYS: '2', FORCE: force, FIXTURE: fix,
        PATH: bin + path.delimiter + process.env.PATH,
        NODE_OPTIONS: '--require ' + JSON.stringify(uhr).slice(1, -1).replace(/\\\\/g, '/'),
      },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('export step: Monday with the Saturday export is green, Friday export is red', () => {
  const mo = '2026-10-05T20:42:16.469Z';
  let r = exportLauf(mo, JSON.stringify({ generated_at: '2026-10-03T09:31:17.258Z' }));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /geplante Pause/);
  r = exportLauf(mo, JSON.stringify({ generated_at: '2026-10-02T09:31:17.258Z' }));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::Screener-Daten VERALTET/);
});

test('export step: empty response, missing stamp and FORCE stay red', () => {
  const mo = '2026-10-05T20:42:16.469Z';
  for (const [text, force] of [['', ''], ['{}', ''], ['{"generated_at":"2026-10-05T20:00:00Z"}', 'true']]) {
    const r = exportLauf(mo, text, force);
    assert.equal(r.status, 1, JSON.stringify(text) + ': ' + r.out);
    assert.match(r.out, /::error::/);
  }
});

// ── price step: the real node block, store stubbed through the require cache ──
function preisBlock() {
  const b = stepRun('Check price-substrate freshness (A7-b)');
  const s = b.indexOf('node -e "') + 'node -e "'.length;
  return b.slice(s, b.lastIndexOf('"')).replace(/\\"/g, '"');
}

function preisLauf(jetzt, meta, spyDatum) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-preis-'));
  try {
    const stub = path.join(dir, 'stub.js');
    fs.writeFileSync(stub, [
      `const t=Date.parse(${JSON.stringify(jetzt)}); Date.now=()=>t;`,
      `const s=require(${JSON.stringify(path.join(ROOT, 'lib', 'price-history-store.js'))});`,
      `s.loadMeta=()=>(${JSON.stringify(meta)});`,
      `s.loadShard=()=>({SPY:[{date:${JSON.stringify(spyDatum)}}]});`,
    ].join('\n'));
    const r = spawnSync(process.execPath, ['--require', stub, '-e', preisBlock()], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, PRICE_META_MAX_AGE_DAYS: '2', SPY_MAX_AGE_DAYS: '6' },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('price step: Monday 05.10. with the Saturday store stamp is green, Friday stamp is red', () => {
  const mo = '2026-10-05T20:42:16.469Z';
  let r = preisLauf(mo, { updatedAt: '2026-10-03T09:24:34.702Z', tickerCount: 35232 }, '2026-10-02');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Geplante Pause/);
  r = preisLauf(mo, { updatedAt: '2026-10-02T09:24:34.702Z', tickerCount: 35232 }, '2026-10-01');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::PREIS-SUBSTRAT VERALTET/);
});

test('price step: unreadable stamp is red, SPY keeps its own 6-day limit on a Monday', () => {
  const mo = '2026-10-05T20:42:16.469Z';
  let r = preisLauf(mo, { updatedAt: 'kaputt', tickerCount: 1 }, '2026-10-02');
  assert.equal(r.status, 1, r.out);
  r = preisLauf(mo, { updatedAt: '2026-10-03T09:24:34.702Z', tickerCount: 1 }, '2026-09-25');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /SPY-Serie steht auf/);
});

// daily-pull.yml schedule and the helper constants must not drift apart.
test('daily-pull cron matches the RUN_* constants of lib/liefer-kalender.js', () => {
  const K = require('../lib/liefer-kalender.js');
  const dp = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-pull.yml'), 'utf8');
  const crons = [...dp.matchAll(/^\s*-\s*cron:\s*'([^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(crons, ['17 2 * * 2-6'], 'expected exactly one daily-pull cron');
  const [min, hour, , , dow] = crons[0].split(/\s+/);
  assert.equal(Number(min), K.RUN_MINUTE);
  assert.equal(Number(hour), K.RUN_HOUR);
  const [a, b] = dow.split('-').map(Number);
  assert.deepEqual(K.RUN_WEEKDAYS, Array.from({ length: b - a + 1 }, (_, i) => a + i));
});
