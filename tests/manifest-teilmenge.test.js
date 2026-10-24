// Waechter fuer zwei Loecher, die am 19.09.2026 beide an einem einzigen Ziel-Pull auffielen:
//
//  (1) Ein Lauf ueber eine 16-Namen-Liste loeschte das committete _manifest.json und schrieb
//      seine eigene Bilanz hinein (n_total 21728 -> 16). coverage-gate, Merge und Scoring
//      lesen dieses Feld als Tageswahrheit.
//  (2) Der Preis-Schnellpfad schrieb marketCap.value und liess marketCap.asOf stehen. Die
//      16 GBp-Beine trugen deshalb August-Stempel auf Werten, die von diesem Weg kamen —
//      ein Stempel, der nicht mitgefuehrt wird, luegt, und die Alters-Diagnose lief in die
//      falsche Richtung.
//
// Die Regel wird AUSGEFUEHRT, nicht nachgebaut (Muster parseVollPullTicker).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { istTeilmengenLauf, MANIFEST_SUBSET_MIN_SHARE } = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('FAIL   ' + name); console.log('       ' + e.message); fail++; }
}

check('der Fall vom 19.09.: 16 Namen gegen ein Manifest mit 16046 -> Teilmenge', () => {
  assert.strictEqual(istTeilmengenLauf(16, 16046), true);
});

check('der volle Tageslauf ist KEINE Teilmenge (Gegenrichtung, sonst schuetzt die Regel nichts)', () => {
  assert.strictEqual(istTeilmengenLauf(16046, 16046), false);
  assert.strictEqual(istTeilmengenLauf(21728, 21728), false);
});

check('die Schwelle liegt genau bei ' + MANIFEST_SUBSET_MIN_SHARE + ' und ist beidseitig scharf', () => {
  const bekannt = 1000;
  assert.strictEqual(istTeilmengenLauf(bekannt * MANIFEST_SUBSET_MIN_SHARE, bekannt), false,
    'exakt auf der Schwelle ist noch KEINE Teilmenge');
  assert.strictEqual(istTeilmengenLauf(bekannt * MANIFEST_SUBSET_MIN_SHARE - 1, bekannt), true,
    'einen Namen darunter schon');
});

check('ohne brauchbaren Nenner schuetzt die Regel nichts (kein/kaputtes Manifest)', () => {
  for (const bekannt of [undefined, null, 0, -5, NaN, 'viele']) {
    assert.strictEqual(istTeilmengenLauf(16, bekannt), false, 'Nenner ' + String(bekannt));
  }
});

// Review 19.09. (KRITISCH), und der Test hatte den Fehler VORGESCHRIEBEN: hier stand
// `istTeilmengenLauf(0, 16046) === false`, also "die leere Liste ist kein Teilmengen-Lauf".
// Damit war der Maximalschaden — Watchlist abgeschnitten oder leer gefiltert, Tagesmanifest
// geloescht und mit n_total 0 ueberschrieben — als richtiges Verhalten festgeschrieben.
check('die LEERE Liste ist der Maximalschaden, nicht die Ausnahme', () => {
  assert.strictEqual(istTeilmengenLauf(0, 16046), true,
    'null Ticker sprechen nie fuer ein Universum von 16046');
  assert.strictEqual(istTeilmengenLauf(0, 0), false,
    'ohne Nenner gibt es nichts zu schuetzen — auch bei leerer Liste nicht');
  assert.strictEqual(istTeilmengenLauf(-1, 16046), false,
    'eine negative Anzahl ist kein Lauf, sondern ein Aufrufer-Fehler');
});

// Review 19.09. (HOCH): der Umgehungsfall braucht eine eigene Spur. Faellt das Altmanifest
// als Eingabe aus, wird der Schutz uebersprungen — das darf im Log nicht aussehen wie ein
// gewoehnlicher Loeschvorgang.
check('unlesbares Altmanifest hinterlaesst eine WARN-Spur, nicht nur ein INFO', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const i = src.indexOf('const vorher = JSON.parse(fs.readFileSync(manifestPath');
  assert.ok(i > 0, 'die Lesestelle des Altmanifests existiert noch — sonst ist dieser Test blind');
  const block = src.slice(i, i + 2400);
  assert.ok(/catch \(e\) \{[\s\S]{0,800}?_log\('WARN'/.test(block),
    'der catch um das Altmanifest schluckt ohne jede Log-Spur — genau der Befund vom 19.09.');
  assert.ok(/UMGANGEN/.test(block), 'die WARN-Zeile benennt die Umgehung nicht');
});

// Review 19.09. (NIEDRIG, umgedreht): das `||` liess die alte Herkunft auf einem Wert stehen,
// den gerade der Quote-Weg geschrieben hatte.
check('Schnellpfad: wer marketCap.value schreibt, schreibt auch die Herkunft neu', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const i = src.indexOf('existing.marketCap.value = q.marketCap * tradingAggFactor;');
  const danach = src.slice(i, i + 1400);
  assert.ok(/existing\.marketCap\.source = 'yahoo_quote';/.test(danach),
    'die Herkunft wird nicht neu gesetzt');
  assert.ok(!/existing\.marketCap\.source = existing\.marketCap\.source \|\|/.test(danach),
    'das || ist zurueck — es haelt die Herkunft des Voll-Pulls auf einem Quote-Wert fest');
});

// (2) Der Stempel: die Schreibstelle fuehrt value UND asOf. Geprueft wird die Stelle selbst,
// weil _priceOnlyUpdate in der Closure von pullAll steckt und von aussen nicht aufrufbar ist.
// Der Anker ist die Zuweisung an den Wert — steht danach kein asOf, faellt der Test.
check('Schnellpfad: wer marketCap.value schreibt, schreibt marketCap.asOf', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const i = src.indexOf('existing.marketCap.value = q.marketCap * tradingAggFactor;');
  assert.ok(i > 0, 'die Schreibstelle des Schnellpfads existiert noch — sonst ist dieser Test blind');
  const danach = src.slice(i, i + 1400);
  assert.ok(/existing\.marketCap\.asOf\s*=/.test(danach),
    'marketCap.value wird geschrieben, marketCap.asOf nicht — genau der luegende Stempel vom 19.09.');
  assert.ok(src.indexOf('existing.marketCap.value = q.marketCap * tradingAggFactor;', i + 1) === -1,
    'mehr als eine Schreibstelle: der Anker ist mehrdeutig geworden, Test nachziehen');
});

// Scope-Waechter (Rats-Entscheid 19.09., nach Widerspruch zweier Reviewer): die Pruefung
// vergleicht die VOLLE Watchlist gegen das n_total des VOLLEN Manifests. Jeder der 17
// Shard-Prozesse liest dieselbe volle Liste und schneidet sie erst danach. Wuerde stattdessen
// das geschriebene n_total des Shards verglichen, feuerte die Regel an jedem normalen
// Tageslauf 17 Mal. Dieser Test haelt die Richtung fest.
check('ein Shard-Lauf ueber die volle Watchlist feuert NICHT', () => {
  const UNIVERSUM = 21728;
  assert.strictEqual(istTeilmengenLauf(UNIVERSUM, UNIVERSUM), false,
    'die volle Liste gegen das volle Manifest ist nie eine Teilmenge - sonst waeren alle 17 Shards taeglich rot');
  // Gegenprobe zur falschen Variante: WAERE der Zaehler das, was ein Shard schreibt (~1/17),
  // dann feuerte die Regel - genau die Fehlausloesung, die der jetzige Zuschnitt meidet.
  assert.strictEqual(istTeilmengenLauf(Math.round(UNIVERSUM / 17), UNIVERSUM), true,
    'die Shard-Scheibe gegen das volle Manifest WUERDE feuern - deshalb steht die Pruefung vor dem Sharding');
});

// Sweep 24.10. (P1): the rule above was right, the run was not. pullAll reset the tag main()
// had set, and the incremental flush wrote a hard-coded _manifest.json, so a subset run still
// overwrote the daily manifest (n_total 16046 -> 0) while the log said it stays untouched.
// These cases run the REAL main() as a child process with an empty list (no ticker, so no
// network) against a temp fixture folder; the live manifest is hashed before and after.
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const LIVE_MANIFEST = path.join(ROOT, 'snapshots', '_manifest.json');
const sha = (p) => fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'absent';
function runMain(altManifest) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-teilmenge-'));
  const out = path.join(tmp, 'snaps');
  assert.ok(!path.resolve(out).toLowerCase().startsWith(path.resolve(ROOT).toLowerCase()),
    'fixture folder lies inside the repo: ' + out);
  fs.mkdirSync(out);
  if (altManifest !== undefined) fs.writeFileSync(path.join(out, '_manifest.json'), altManifest);
  const wl = path.join(tmp, 'watchlist.json');
  fs.writeFileSync(wl, JSON.stringify({ _meta: { version: 'probe' }, stocks: [] }));
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'pull-yahoo.js'), '--watchlist', wl, '--output', out],
    { cwd: tmp, encoding: 'utf8', timeout: 60000, env: { ...process.env, VOLL_PULL_TICKER: '' } });
  const log = (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : '');
  const files = fs.readdirSync(out).sort();
  const read = (name) => fs.readFileSync(path.join(out, name));
  return { tmp, status: r.status, log, files, read };
}
const liveBefore = sha(LIVE_MANIFEST);

check('subset run: _manifest.json stays byte-identical, the tally goes to _manifest.subset-<version>.json', () => {
  const alt = Buffer.from(JSON.stringify({ pulled_at: '2026-10-24T06:00:00.000Z', n_total: 16046, n_ok: 15900, partial: false }));
  const run = runMain(alt);
  try {
    assert.strictEqual(run.status, 0, 'main() did not finish (a crash would leave the file untouched vacuously):\n' + run.log);
    assert.ok(/Pull complete: 0\/0 ok/.test(run.log), 'pullAll did not reach its final write:\n' + run.log);
    assert.ok(run.read('_manifest.json').equals(alt),
      '_manifest.json was overwritten: ' + run.read('_manifest.json').toString().slice(0, 120));
    assert.ok(run.files.includes('_manifest.subset-probe.json'), 'no subset tally written: ' + run.files.join(', '));
    const tally = JSON.parse(run.read('_manifest.subset-probe.json'));
    assert.strictEqual(tally.n_total, 0);
    assert.strictEqual(tally.partial, false, 'the final write, not only the incremental flush, must use the subset path');
    assert.ok(run.files.includes('_manifest-full.subset-probe.json'), 'full sibling not on the subset path: ' + run.files.join(', '));
    assert.ok(!run.files.includes('_manifest-full.json'), 'full sibling written to the daily name');
    assert.ok(/Teilmengen-Lauf: Tagesmanifest bleibt unberuehrt/.test(run.log), 'the final write did not see the subset tag');
  } finally { fs.rmSync(run.tmp, { recursive: true, force: true }); }
});

check('no subset (nothing to protect): file names unchanged, _manifest.json is written as before', () => {
  const run = runMain(undefined);
  try {
    assert.strictEqual(run.status, 0, 'main() did not finish:\n' + run.log);
    assert.ok(run.files.includes('_manifest.json'), 'daily manifest missing: ' + run.files.join(', '));
    assert.strictEqual(JSON.parse(run.read('_manifest.json')).partial, false);
    assert.ok(run.files.includes('_manifest-full.json'));
    assert.deepStrictEqual(run.files.filter((f) => /subset/.test(f)), [], 'a subset file appeared without a subset run');
  } finally { fs.rmSync(run.tmp, { recursive: true, force: true }); }
});

check('the live snapshots/_manifest.json was not touched by these runs', () => {
  assert.strictEqual(sha(LIVE_MANIFEST), liveBefore);
});

console.log('\nmanifest-teilmenge: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
