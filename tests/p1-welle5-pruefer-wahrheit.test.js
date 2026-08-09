'use strict';
/**
 * P1-Welle 5 — Messausfall und Absturz duerfen kein Messergebnis vortaeuschen.
 * Rot-zuerst gegen 26522ba407: Absturz und unlesbarer Snapshot-Pfad endeten 0;
 * Heartbeat-Ausfaelle nannten weder MESSAUSFALL noch fehlende Aussage.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const spot = require('../scripts/value-spot-check.js');
const heartbeat = require('../scripts/heartbeat-preis-abdeckung.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p1w5-'));
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}

(async () => {
  await test('Cluster C: eigener Absturz wird ::error:: und Exit 1', async () => {
    const exits = [], errors = [];
    await spot.runCli(async () => { throw new Error('synthetischer Absturz'); }, {
      exit: code => exits.push(code), error: line => errors.push(String(line)),
    });
    assert.deepEqual(exits, [1]);
    assert.match(errors.join('\n'), /::error::.*synthetischer Absturz/);
  });

  await test('Cluster C: unlesbarer Snapshot-Pfad ist rot', () => {
    const r = spawnSync(process.execPath, ['scripts/value-spot-check.js', '--snapshots', path.join(TMP, 'fehlt')],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /::error::.*Pruefer blind/);
  });

  await test('Cluster C: kleine Probe bleibt Exit 0, aber ist MESSAUSFALL', () => {
    const klein = path.join(TMP, 'klein');
    fs.mkdirSync(klein);
    fs.writeFileSync(path.join(klein, 'eins.json'), '{}');
    const r = spawnSync(process.execPath, ['scripts/value-spot-check.js', '--snapshots', klein],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /MESSAUSFALL:.*keine Aussage zur Werte-Qualitaet/);
  });

  await test('Cluster D: Heartbeat-Messausfall bleibt Exit 0 und ist eindeutig', () => {
    const lines = [];
    const code = heartbeat.main({
      fs: { readFileSync() { throw new Error('EACCES'); } },
      store: { loadAll() { throw new Error('darf nicht erreicht werden'); } },
      log: line => lines.push(String(line)),
    });
    assert.equal(code, 0);
    assert.match(lines.join('\n'), /::warning::MESSAUSFALL:.*keine Aussage ueber Abdeckung/);
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nP1-Welle 5: ${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
