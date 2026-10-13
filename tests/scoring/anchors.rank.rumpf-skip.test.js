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
 * ⚠ VERTRAG GEAENDERT 18.08.2026 — KARL-ENTSCHEID "KEINE ANKER".
 * Karl woertlich: "ich wollte in diesem gesamten screener keine anker ... Theoretisch sollte Credo
 * auf Platz 230 fallen, weil es einfach 230 bessere Unternehmen gibt dort im Screener. Ist das
 * voellig in Ordnung. ... Ich brauche das, was der Screener sagt." Ein fehlender oder abgerutschter
 * Anker ist damit ein ERGEBNIS des Screeners, kein Fehler — "Exit 1 bei fehlendem CRDO" ist als
 * Zusicherung tot.
 *
 * DER ZWECK DIESES TESTS BLEIBT ABER GUELTIG, und zwar unveraendert: ein fehlender Anker darf nicht
 * STUMM durchgehen. Genau das war der C2-Befund. Aus "muss rot faerben" wird deshalb "muss
 * NAMENTLICH BENANNT werden": der Lauf endet mit Exit 0, aber die Beobachtungs-Ausgabe sagt, dass
 * CRDO nicht im Ranking ist — und die Suite fuehrt weiterhin echte Pruefungen aus (kein "0 ok").
 *
 * WARUM DIE ALTE FASSUNG NICHT EINFACH GELOESCHT WURDE: ohne sie koennte anchors.rank.test.js
 * kuenftig wieder still aussteigen, ohne dass es jemand merkt — der vakuose Pass waere zurueck,
 * nur ohne roten Ankerteil. Der Waechter bewacht ab jetzt die EHRLICHKEIT der Ausgabe statt eines
 * Rangs. (Als das Anker-Gate am 18.08. fiel, blieb genau dieser Test unbeachtet zurueck und haette
 * den naechsten Tageslauf VOR dem Kursabruf abgebrochen — er steht in der blockierenden Spur.)
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

const FIX = path.join(__dirname, 'fixtures');
const loadFix = (t) => JSON.parse(fs.readFileSync(path.join(FIX, t + '.json'), 'utf8'));

// Degradierter Klon eines eingefrorenen Anker-Snapshots: gleiche Branche/Track/Waehrung (routet
// identisch), aber NIEDRIGES, per Klon variiertes Wachstum (aeltere Jahre nahe am neuesten) ->
// Wachstums-Achsen-Perzentile unter dem Anker -> der Anker rankt oben, die Klone fuellen die Kohorte.
// gm<0.55 + konstante opMargin -> kein newestQtrSuspect; USD/USD -> kein annualCurrencyLeak;
// distinct meta.name -> kein issuer-dedup; newest annualOpInc>0 -> profitable-Track.
function fillerFrom(anchor, prefix, i, g) {
  const s = JSON.parse(JSON.stringify(anchor));
  const tk = prefix + String(i).padStart(3, '0');
  s.meta.ticker = tk;
  s.meta.name = anchor.meta.name + ' Filler ' + prefix + i;
  if (s.identifier) s.identifier.value = 'FILL:' + tk;
  const R = anchor.annual.annualRev[0].value;
  const gm = 0.45, opm = 0.12, nim = 0.10, fcfm = 0.15, ocfm = 0.18;
  const yr = [R, R / g, R / (g * g), R / (g * g * g)];
  const V = (arr) => arr.map((v) => ({ value: Math.round(v) }));
  s.annual.annualRev = V(yr);
  s.annual.annualGP = V(yr.map((v) => v * gm));
  s.annual.annualOpInc = V(yr.map((v) => v * opm));
  s.annual.annualNetIncome = V(yr.map((v) => v * nim));
  s.annual.annualFCF = V(yr.map((v) => v * fcfm));
  s.annual.annualOCF = V(yr.map((v) => v * ocfm));
  const qg = Math.pow(g, 0.25), Q0 = R / 4;
  const q = [0, 1, 2, 3, 4].map((k) => Q0 / Math.pow(qg, k));
  s.timeseries.revenueQ = V(q);
  s.timeseries.opIncQ = V(q.map((v) => v * opm));
  s.timeseries.grossProfitQ = V(q.map((v) => v * gm));
  s.timeseries.netIncomeQ = V(q.map((v) => v * nim));
  s.metrics.revenueTTM = { value: Math.round(q[0] + q[1] + q[2] + q[3]), source: 'x', confidence: 0.9 };
  s.metrics.revenueGrowthYoY = { value: (g - 1) * 100, source: 'x', confidence: 0.9 };
  return s;
}

// --- Fixture-Universum bauen (CRDO fehlt; ALAB/PLTR/BE + fette Kohorten) ---
const ALAB = loadFix('ALAB'), PLTR = loadFix('PLTR'), BE = loadFix('BE');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchors-rumpf-'));
const write = (s) => fs.writeFileSync(path.join(dir, s.meta.ticker + '.json'), JSON.stringify(s));
const gAt = (i, n) => 1.02 + 0.18 * (i / n);
const NSEMI = 60, NSOFT = 20, NIND = 20; // 3 Anker + 100 Filler = 103 (>=100 Datei-Gate); semi-Kohorte 61 (>topN)
try {
  for (const a of [ALAB, PLTR, BE]) write(a);                     // KEIN CRDO
  for (let i = 1; i <= NSEMI; i++) write(fillerFrom(ALAB, 'ZSEMI', i, gAt(i, NSEMI)));
  for (let i = 1; i <= NSOFT; i++) write(fillerFrom(PLTR, 'ZSOFT', i, gAt(i, NSOFT)));
  for (let i = 1; i <= NIND; i++) write(fillerFrom(BE, 'ZIND', i, gAt(i, NIND)));

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
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
  // 18.08.: Das alte Muster suchte die Zeile "ok Direktive 4: CRDO oben in ..." — diesen Test gibt
  // es nicht mehr, das Muster koennte also NIE mehr greifen und der Check waere stumm gruen
  // geworden: ein Waechter, der nichts mehr prueft. Jetzt wird gegen die AKTUELLE Ausgabe geprueft:
  // CRDO darf nicht mit einem Rang protokolliert werden, denn im Fixture existiert es nicht.
  const crdoMitRang = /^\s*CRDO Rang \d+/m;
  const tail = out.split('\n').slice(-25).join('\n');

  // DER KERN, unveraendert: CRDO darf nicht als vorhanden erscheinen, obwohl es fehlt.
  check('anchors.rank.test.js erfindet keinen Rang fuer den abwesenden CRDO', () => {
    assert.ok(!crdoMitRang.test(out),
      'CRDO mit Rang protokolliert, obwohl im Fixture-Universum abwesend:\n' + tail);
  });
  // GEAENDERT 18.08. (Karl-Entscheid): ein fehlender Anker faerbt NICHT mehr rot.
  check('fehlender Anker faerbt den Lauf NICHT mehr rot (Exit 0) — Karl-Entscheid 18.08.', () => {
    assert.equal(r.status, 0, `Exit-Code ${r.status} (erwartet 0: ein fehlender Anker ist ein Ergebnis des Screeners, kein Fehler):\n` + tail);
  });
  // ...ABER er muss NAMENTLICH auftauchen. Das ist der Kern, der bleibt: still ist verboten.
  check('CRDO wird namentlich als fehlend benannt (still waere der vakuose Pass zurueck)', () => {
    assert.match(out, /CRDO:\s*nicht im/,
      'CRDO taucht in der Beobachtungs-Ausgabe gar nicht auf — der fehlende Anker verschwindet stumm:\n' + tail);
  });
  // Und die Suite muss ueberhaupt etwas geprueft haben. "0 ok, 0 fail" waere ein Test, der gruen
  // meldet, ohne zu laufen — das test-gate zaehlt das zu Recht als SKIP und nicht als PASS.
  check('die Suite fuehrt echte Pruefungen aus (kein "0 ok")', () => {
    assert.ok(!/\b0 ok\b/.test(out),
      'anchors.rank.test.js meldet "0 ok" — Suite ist leer gelaufen statt zu pruefen:\n' + tail);
  });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(fail ? `\nanchors.rank.rumpf-skip: ${fail} FAILED` : '\nanchors.rank.rumpf-skip: all passed');
process.exit(fail ? 1 : 0);
