'use strict';
/**
 * Bruell-Kanal, Waechter 1 (Beschluss 16.08.) — der Exit-Code-Split von
 * anchors.rank.test.js, hermetisch gegen ein synthetisches Universum gemessen.
 *
 * WORUM ES GEHT. Bis Tag 957 blockierte JEDER Fail des Anker-Gates den Tageslauf: Karl
 * bekam bei einem Prozentil-Riss keine frischen Boards. Das ist falsch herum — bei einem
 * Rangfolge-Riss sind die Daten korrekt, die Formel liefert nur eine Reihung, die Karl
 * nicht will. Stehende Boards machen diese Verletzung UNSICHTBARER, nicht sichtbarer.
 * Seit Tag 977 trennt anchors.rank.test.js:
 *
 *   exit 1  Datenintegritaet  -> Tageslauf blockiert, nichts geht raus
 *   exit 2  Rangfolge         -> Boards gehen raus, danach faerbt laufstatus den Lauf rot
 *   exit 0  gruen
 *
 * DIESER TEST IST DER GRUND, WARUM MAN DEM SPLIT GLAUBEN DARF. Vier Laeufe gegen vier
 * gebaute Zustaende — beide Richtungen, nicht nur die Anwesenheit des roten Falls:
 *
 *   (1) alles gruen              -> exit 0, Marker status='ok', breached=false
 *   (2) Halbleiter-Anker ueberholt -> exit 2, Marker status='rangfolge', Verletzung im Klartext
 *   (3) Anker fehlt (CRDO)       -> exit 1, Marker status='blockiert'
 *   (4) beides gleichzeitig      -> exit 1 — Datenschaden schlaegt Rangfolge, NIE umgekehrt
 *
 * (4) ist die gefaehrlichste Zeile: waere sie 2, ginge ein Board mit kaputten Ankerzeilen
 * raus, weil zufaellig auch die Reihung riss. Und (1) ist die Gegenprobe gegen einen
 * Waechter, der einfach immer rot ist.
 *
 * Run: node tests/scoring/anchors.rank.exitcode.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { schreibeUniversum } = require('./fixtures/anker-universum.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const ZIEL = path.join(__dirname, 'anchors.rank.test.js');

/** Einen Lauf gegen ein frisch gebautes Universum fahren. Liefert Exit-Code, Ausgabe, Marker. */
function lauf(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchors-exitcode-'));
  try {
    const { dateien } = schreibeUniversum(dir, opts);
    // Fixture-Selbstpruefung: unter 100 Dateien skippt anchors.rank.test.js und der Lauf
    // waere ein vakuoses exit 0 — dann misst dieser Waechter nichts.
    assert.ok(dateien.length >= 100, `Fixture nur ${dateien.length} Dateien (<100) — Datei-Gate wuerde skippen`);
    const markerPfad = path.join(dir, 'anchor-status.json');
    const r = spawnSync(process.execPath, [ZIEL], {
      encoding: 'utf8',
      env: { ...process.env, SCREENER_SNAPSHOTS_DIR: dir, ANCHOR_STATUS_OUT: markerPfad },
    });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.ok(!/kein Universum/.test(out), 'Lauf ist in den Rumpf-Skip gefallen — es wurde nichts gemessen:\n' + out.slice(-800));
    const marker = fs.existsSync(markerPfad) ? JSON.parse(fs.readFileSync(markerPfad, 'utf8')) : null;
    return { code: r.status, out, marker, tail: out.split('\n').slice(-20).join('\n') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── (1) alles gruen: der Waechter darf nicht einfach immer rot sein ──────────────────
const gruen = lauf({});
check('(1) heiles Universum -> exit 0', () => {
  assert.equal(gruen.code, 0, `Exit ${gruen.code} statt 0 — der Split faerbt einen heilen Lauf rot:\n` + gruen.tail);
});
check('(1) Marker meldet status=ok, breached=false, keine Verletzungen', () => {
  assert.ok(gruen.marker, 'kein Marker geschrieben, obwohl ANCHOR_STATUS_OUT gesetzt war');
  assert.equal(gruen.marker.schema, 'anchor-status/v1');
  assert.equal(gruen.marker.status, 'ok');
  assert.equal(gruen.marker.breached, false);
  assert.equal(gruen.marker.blocked, false);
  assert.deepEqual(gruen.marker.verletzungen, []);
});
check('(1) Marker traegt alle FUENF Anker als Messzeile (NVDA eingeschlossen)', () => {
  const t = gruen.marker.anker.map((a) => a.ticker).sort();
  assert.deepEqual(t, ['ALAB', 'BE', 'CRDO', 'NVDA', 'PLTR'],
    'Marker misst nicht alle fuenf Anker — ein stumm herausgefallener Anker waere unsichtbar. Ist: ' + t.join(','));
  for (const a of gruen.marker.anker) {
    assert.ok(Number.isFinite(a.pct) && Number.isFinite(a.rank) && Number.isFinite(a.n),
      `${a.ticker}: rank/n/pct nicht finit im Marker`);
  }
});

// ── (2) Rangfolge-Riss: liefern UND bruellen ─────────────────────────────────────────
const riss = lauf({ ueberholer: 40 });
check('(2) Rangfolge-Riss -> exit 2 (NICHT 1: die Boards muessen raus)', () => {
  assert.equal(riss.code, 2,
    `Exit ${riss.code} statt 2. Bei 1 blockiert ein Rangfolge-Riss wieder den Tageslauf — genau der `
    + 'Zustand vom 11.-15.08., den der Bruell-Kanal abschafft. Bei 0 bruellt gar nichts:\n' + riss.tail);
});
check('(2) Marker meldet status=rangfolge, breached=true, blocked=FALSE', () => {
  assert.ok(riss.marker, 'kein Marker beim Rangfolge-Riss — das Dashboard-Banner bliebe stumm');
  assert.equal(riss.marker.status, 'rangfolge');
  assert.equal(riss.marker.breached, true);
  assert.equal(riss.marker.blocked, false, 'blocked=true wuerde drueben "Boards nicht ausgeliefert" behaupten — sie sind aber raus');
});
check('(2) Verletzung steht als lesbarer Klartext im Marker (Banner-Text)', () => {
  assert.ok(riss.marker.verletzungen.length >= 1, 'verletzungen leer, obwohl status=rangfolge');
  const z = riss.marker.verletzungen.join(' | ');
  assert.match(z, /(CRDO|ALAB|PLTR|BE|NVDA)/, 'Verletzung nennt keinen Ticker: ' + z);
  assert.match(z, /%/, 'Verletzung nennt kein Prozentil: ' + z);
});
check('(2) die Datenklasse blieb still (kein FAIL, nur RANG)', () => {
  assert.ok(!/^FAIL /m.test(riss.out),
    'ein Datenintegritaets-Assert ist mitgefallen — dann misst (2) nicht die Rangfolge-Klasse:\n' + riss.tail);
});

// ── (3) Datenschaden: blockieren wie bisher ──────────────────────────────────────────
const schaden = lauf({ weglassen: ['CRDO'] });
check('(3) fehlender Anker -> exit 1 (blockiert)', () => {
  assert.equal(schaden.code, 1,
    `Exit ${schaden.code} statt 1 — ein fehlender Anker darf NIE liefern, das Board ist kaputt:\n` + schaden.tail);
});
check('(3) Marker meldet status=blockiert, blocked=true', () => {
  assert.ok(schaden.marker, 'kein Marker beim Datenschaden');
  assert.equal(schaden.marker.status, 'blockiert');
  assert.equal(schaden.marker.blocked, true);
});

// ── (4) beides gleichzeitig: Datenschaden schlaegt Rangfolge ─────────────────────────
const beides = lauf({ weglassen: ['CRDO'], ueberholer: 40 });
check('(4) Datenschaden UND Rangfolge-Riss -> exit 1, nicht 2', () => {
  assert.equal(beides.code, 1,
    `Exit ${beides.code} statt 1. Bei 2 ginge ein Board mit kaputten Ankerzeilen raus, nur weil `
    + 'zufaellig auch die Reihung riss — der teuerste Ausgang dieses Umbaus:\n' + beides.tail);
});
check('(4) Marker meldet blockiert (nicht rangfolge)', () => {
  assert.equal(beides.marker && beides.marker.status, 'blockiert');
});

// ── Nebenwirkungsfreiheit: ohne ANCHOR_STATUS_OUT wird nichts geschrieben ────────────
check('ohne ANCHOR_STATUS_OUT schreibt der Test keinen Marker (PR-Check/lokal bleiben sauber)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchors-exitcode-nomarker-'));
  try {
    schreibeUniversum(dir, {});
    const env = { ...process.env, SCREENER_SNAPSHOTS_DIR: dir };
    delete env.ANCHOR_STATUS_OUT;
    const r = spawnSync(process.execPath, [ZIEL], { encoding: 'utf8', env });
    assert.equal(r.status, 0, 'heiler Lauf ohne Marker-Variable ist nicht gruen');
    const uebrig = fs.readdirSync(dir).filter((f) => f === 'anchor-status.json');
    assert.deepEqual(uebrig, [], 'Marker wurde ohne ANCHOR_STATUS_OUT geschrieben');
    assert.ok(!fs.existsSync(path.join(__dirname, '..', '..', 'outputs', 'anchor-status.json')),
      'der Test hat outputs/anchor-status.json im Repo angelegt — er muss nebenwirkungsfrei bleiben');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(fail ? `\nanchors.rank.exitcode: ${fail} FAILED` : '\nanchors.rank.exitcode: all passed');
process.exit(fail ? 1 : 0);
