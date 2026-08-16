'use strict';
/**
 * C2 (Kalibrier-Gauntlet E-20260717-5) — Rumpf-Skip-Regression fuer anchors.rank.test.js.
 *
 * WARUM DIESER TEST EXISTIERT:
 * anchors.rank.test.js ist der DURABLE Direktive-4-Bless-Gate fuer score-veraendernde Tasks. Bis zum
 * C2-Fix stieg er bei einem FEHLENDEN/nicht-gerouteten Anker per stillem `return`/`continue` aus dem
 * Test-RUMPF aus (Z.61/72/88) — der test()-Harness (Z.24) zaehlt jedes throw-freie fn() als pass++.
 * Ein verschwindender Anker (z.B. CRDO durch einen Router-/Dedup-Bug aus dem Routing geworfen) machte
 * den Gate damit genau dann STUMM GRUEN, wenn das ueberwachte Direktive-4-Ereignis eintrat: "N ok, 0
 * fail" bei 0 gelaufenen Assertions = vakuoser Pass.
 *
 * WAS ER PRUEFT (hermetisch, ohne Live-Snapshots):
 * Synthetisches Fixture-Universum (>=100 Eintraege, ueberspringt das Datei-Gate Z.34) mit den drei
 * anderen Ankern (ALAB/PLTR/BE) samt fetten, ranking-faehigen Kohorten, aber GENAU EINEM fehlenden
 * Anker: CRDO wird komplett WEGGELASSEN. Der Lauf wird per spawnSync mit SCREENER_SNAPSHOTS_DIR (dem
 * Z.26-Seam) gegen dieses Fixture gefahren. Behauptung: anchors.rank.test.js darf CRDO NICHT als 'ok'
 * durchwinken und MUSS mit Exit 1 hart failen.
 *   - VOR dem C2-Fix (stiller return): CRDO erscheint als '  ok ...', Exit 0  -> dieser Test ROT.
 *   - NACH dem C2-Fix (assert/throw): FAIL-Zeile fuer CRDO mit Ticker+Grund, Exit 1 -> dieser Test GRUEN.
 * Geprueft wird auf 'ok'-ABWESENHEIT + Exit 1 (NICHT auf 'skip' — Option A skippt bewusst nicht,
 * sondern failt; daher steht anchors.rank.test.js auch NICHT in der NEEDS_UNIVERSE-Tabelle von
 * skip-honesty.test.js).
 *
 * Run: node tests/scoring/anchors.rank.rumpf-skip.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Tag 977: der Fixture-Bauer lag hier als 70-Zeilen-Block und wurde von der zweiten
// hermetischen Anker-Suite (anchors.rank.exitcode.test.js) gebraucht — jetzt gemeinsam in
// fixtures/anker-universum.js. Verhalten unveraendert: dieselben Fueller, dieselben
// Kohortengroessen; `weglassen: ['CRDO']` ist genau das frueher hier stehende "KEIN CRDO".
const { schreibeUniversum } = require('./fixtures/anker-universum.js');

// --- Fixture-Universum bauen (CRDO fehlt; die uebrigen Anker + fette Kohorten) ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchors-rumpf-'));
try {
  const files = schreibeUniversum(dir, { weglassen: ['CRDO'] }).dateien;
  // Fixture-Selbstpruefung: >=100 Eintraege, CRDO wirklich abwesend (sonst prueft der Test nichts).
  check('Fixture ist honest: >=100 Eintraege und CRDO fehlt', () => {
    assert.ok(files.length >= 100, `Fixture nur ${files.length} Dateien (<100) — Datei-Gate wuerde skippen`);
    assert.ok(!files.includes('CRDO.json'), 'CRDO darf im Rumpf-Skip-Fixture NICHT vorhanden sein');
  });

  const target = path.join(__dirname, 'anchors.rank.test.js');
  const r = spawnSync(process.execPath, [target], {
    encoding: 'utf8',
    env: { ...process.env, SCREENER_SNAPSHOTS_DIR: dir },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  // Zeile, die anchors.rank.test.js bei erfolgreichem CRDO-Test druckt ('|' ist Regex-Metazeichen).
  const crdoOk = /^\s*ok\s+Direktive 4: CRDO oben in semiconductors\|profitable/m;
  const tail = out.split('\n').slice(-25).join('\n');

  // DER KERN (C2): CRDO darf NICHT als 'ok' erscheinen und der Lauf MUSS Exit 1 liefern.
  check('anchors.rank.test.js winkt fehlenden CRDO NICHT als "ok" durch (kein vakuoser Pass)', () => {
    assert.ok(!crdoOk.test(out),
      'CRDO als "ok" gemeldet, obwohl im Fixture-Universum abwesend — stiller Rumpf-Skip (C2 nicht gefixt):\n' + tail);
  });
  check('anchors.rank.test.js failt hart (Exit 1) bei fehlendem Anker', () => {
    assert.equal(r.status, 1, `Exit-Code ${r.status} (erwartet 1: fehlender Anker MUSS rot faerben, kein Exit 0):\n` + tail);
  });
  // Auflage 3: die Fehlermeldung MUSS Ticker + Grund (fehlend vs. action!=route) benennen.
  check('Fail-Meldung benennt Ticker CRDO + Grund (fehlend) — lesbar als Anker-Verschiebung vs. Regression', () => {
    assert.match(out, /CRDO[^\n]*fehlt|fehlt[^\n]*CRDO/,
      'Fehlermeldung nennt CRDO/Grund nicht — ein kuenftiger Fail waere nicht als Anker-Verschiebung lesbar:\n' + tail);
  });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(fail ? `\nanchors.rank.rumpf-skip: ${fail} FAILED` : '\nanchors.rank.rumpf-skip: all passed');
process.exit(fail ? 1 : 0);
