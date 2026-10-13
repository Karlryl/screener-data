'use strict';
/**
 * Waechter fuer die Anzeige-Spalte "Umsatzwachstum" (revGrowthYoYPct).
 * ============================================================================
 * Vorgeschichte (unabhaengige Pruefung 27.07.2026, Schwere mittel): das Feld war in Tag 444
 * gebaut, im Export vorhanden und in findash als Spalte umgesetzt — hatte aber im gesamten
 * Repo KEINE Testabdeckung. Der Vertrags-Check in write-findash-export.js prueft es nur
 * OPTIONAL: `checkOptionalNumOrNull` steigt aus, wenn der Schluessel gar nicht da ist. Ein
 * Refactor, der das Feld still fallen laesst, waere also durch jedes Gate gekommen — Karls
 * Spalte haette wieder ueberall "—" gezeigt, und nichts waere rot geworden.
 *
 * Dieser Test prueft EIGENSCHAFTEN, keine Ticker-Namen (Tag 437: Anker auf einzelne Namen sind
 * durch Kalibrieren auf genau diesen Namen erfuellbar und damit wertlos):
 *   (1) das Feld ist ueberhaupt vorhanden,
 *   (2) es ist bei der grossen Mehrheit der Zeilen belegt (nicht bloss bei einer Handvoll),
 *   (3) jeder Wert ist eine endliche Zahl oder null — nie NaN, nie ein String,
 *   (4) die Werte sind nicht alle gleich (ein konstanter Wert waere ein Berechnungsfehler,
 *       der bei einer reinen Vorhandenseins-Pruefung durchrutscht).
 *
 * Laeuft im Live-Universum-Gate mit echten Snapshots; ohne Universum sauberer Skip.
 *
 * Run: node tests/scoring/rev-growth-anzeige.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, produceRankings } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0, skip = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) {
    if (e && e.SKIP) { skip++; console.log('  skip ' + name + ' (' + e.message + ')'); return; }
    fail++; console.error('FAIL   ' + name + '\n       ' + e.message);
  }
}
const skipBody = (grund) => { const e = new Error(grund); e.SKIP = true; throw e; };

const SNAP_DIR = process.env.SCREENER_SNAPSHOTS_DIR || path.join(__dirname, '..', '..', 'snapshots');
const universe = [];
try {
  for (const f of fs.readdirSync(SNAP_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
      if (s && s.meta && s.meta.ticker) universe.push(s);
    } catch (_) { /* defekte Snapshots ueberspringen */ }
  }
} catch (_) { /* kein Verzeichnis -> Skip unten */ }
console.log(`  (Universum: ${universe.length} Snapshots geladen)`);

let zeilen = [];
if (universe.length) {
  const r = produceRankings(scoreUniverse(universe, formulas), { topN: 50 });
  for (const tracks of Object.values(r.full || {})) {
    for (const liste of Object.values(tracks || {})) for (const e of (liste || [])) zeilen.push(e);
  }
}

check('das Feld revGrowthYoYPct existiert ueberhaupt auf den Board-Zeilen', () => {
  if (!zeilen.length) skipBody('kein Universum — pre-pull-Gate');
  const mitSchluessel = zeilen.filter((z) => 'revGrowthYoYPct' in z).length;
  assert.equal(
    mitSchluessel, zeilen.length,
    `nur ${mitSchluessel} von ${zeilen.length} Zeilen tragen den Schluessel — ein stiller Wegfall `
    + 'wuerde die Spalte "Umsatzwachstum" in findash dauerhaft leer lassen',
  );
});

check('die Spalte ist bei der grossen Mehrheit der Zeilen belegt', () => {
  if (!zeilen.length) skipBody('kein Universum — pre-pull-Gate');
  const belegt = zeilen.filter((z) => typeof z.revGrowthYoYPct === 'number').length;
  const anteil = (belegt / zeilen.length) * 100;
  console.log(`       belegt: ${belegt}/${zeilen.length} (${anteil.toFixed(1)} %)`);
  // 90 % statt der gemessenen 99,3 %: die Schwelle soll einen ZUSAMMENBRUCH melden, nicht
  // jede natuerliche Schwankung der Datenlage. Ein Abrutschen auf 0 oder 5 % faellt sofort auf.
  assert.ok(anteil >= 90, `nur ${anteil.toFixed(1)} % der Zeilen tragen einen Wert (erwartet >= 90 %)`);
});

check('jeder Wert ist endliche Zahl oder null — nie NaN, nie String', () => {
  if (!zeilen.length) skipBody('kein Universum — pre-pull-Gate');
  const kaputt = zeilen.filter((z) => {
    const v = z.revGrowthYoYPct;
    return !(v === null || v === undefined || Number.isFinite(v));
  });
  assert.equal(kaputt.length, 0, 'nicht-endliche Werte bei: ' + kaputt.slice(0, 5).map((z) => z.ticker + '=' + z.revGrowthYoYPct).join(', '));
});

check('die Werte sind nicht alle gleich (faengt einen konstanten Berechnungsfehler)', () => {
  if (!zeilen.length) skipBody('kein Universum — pre-pull-Gate');
  const werte = zeilen.map((z) => z.revGrowthYoYPct).filter((v) => typeof v === 'number');
  if (werte.length < 10) skipBody('zu wenige Werte fuer eine Streuungs-Aussage');
  const verschieden = new Set(werte.map((v) => v.toFixed(3))).size;
  console.log(`       verschiedene Werte: ${verschieden} von ${werte.length}`);
  // Ein Vorhandenseins-Test allein wuerde auch dann gruen bleiben, wenn die Berechnung
  // fuer jede Firma dieselbe Zahl liefert — genau das faengt diese Zeile.
  assert.ok(verschieden > werte.length * 0.5, `nur ${verschieden} verschiedene Werte bei ${werte.length} Zeilen — riecht nach konstantem Fehler`);
});

console.log(`rev-growth-anzeige.test.js: ${pass} ok, ${fail} fail${skip ? ', ' + skip + ' skip' : ''}`);
process.exit(fail ? 1 : 0);
