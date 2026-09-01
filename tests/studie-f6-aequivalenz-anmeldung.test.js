'use strict';

// Waechter ueber dem Werkzeug fuer Bauordnung Schritt 2 (Zaehlproben-Akt des
// Aequivalenz-Laufs). _COURT-F6-ZAEHLWERK-2026-09-01, F6-B8 / F6-C7..C9.
//
// DIE SACHE: das Zugriffs-Register ist nur-anhaengend und verkettet. Ein
// falscher Eintrag ist nicht korrigierbar, nur ergaenzbar. Geprueft wird
// deshalb VOR allem anderen, dass der Trockenlauf der Standard ist und dass
// jede Schranke wirklich haelt - an einer KOPIE des Registers, nie am echten.
//
// Usage: node tests/studie-f6-aequivalenz-anmeldung.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const WERKZEUG = path.join(REPO, 'scripts', 'studie-f6-aequivalenz-anmeldung.js');
const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const LEDGER = path.join(REPO, ...LEDGER_REL.split('/'));

const werkzeug = require(WERKZEUG);

// Die Dateien, deren Hash das Werkzeug bindet.
const GEBUNDEN = [
  'scripts/studie-f6-zaehlwerk.py',
  'scripts/studie-f6-lauf.py',
  'scripts/studie-zaehlprobe.py',
  'scripts/studie-basisraten.py',
  'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json',
  'reports/studie/E4d-kadenz-entdeckung-2026-08-19.json',
];

const LEDGER_BEIM_START = crypto.createHash('sha256')
  .update(fs.readFileSync(LEDGER)).digest('hex');

function tempdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Eine Fixture-Welt: Kopie des echten Registers plus Kopien der gebundenen
// Dateien. Am ECHTEN Register wird nie geschrieben.
function welt(prefix) {
  const dir = tempdir(prefix);
  const wurzel = path.join(dir, 'repo');
  for (const rel of GEBUNDEN) {
    const ziel = path.join(wurzel, ...rel.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.copyFileSync(path.join(REPO, ...rel.split('/')), ziel);
  }
  const register = path.join(dir, 'register.json');
  fs.copyFileSync(LEDGER, register);
  return { dir, wurzel, register };
}

// Feste Zeiten, damit der eventHash reproduzierbar ist.
const T_ANMELDUNG = '2026-09-01T01:00:00.000Z';
const T_WIRKSAM = '2026-09-01T03:00:00.000Z';

function ruf(w, extra = []) {
  return spawnSync(process.execPath, [WERKZEUG,
    '--register', w.register, '--wurzel', w.wurzel,
    '--anmeldezeit', T_ANMELDUNG, '--wirksam-ab', T_WIRKSAM, ...extra],
  { encoding: 'utf8' });
}

function abbruch(w, extra, warum, muster) {
  const vorher = fs.readFileSync(w.register, 'utf8');
  const r = ruf(w, extra);
  assert.notEqual(r.status, 0, `${warum}: haette abbrechen muessen\n${r.stdout}`);
  assert.match(r.stderr, muster || /F6-AEQ/, `${warum}: kein benannter Grund: ${r.stderr}`);
  assert.equal(fs.readFileSync(w.register, 'utf8'), vorher,
    `${warum}: das Register wurde trotz Abbruch veraendert`);
  return r.stderr;
}

// ── Trockenlauf ist der Standard ────────────────────────────────────────────

test('Trockenlauf ist der STANDARD und schreibt nichts', () => {
  const w = welt('f6aeq-trocken-');
  const vorher = fs.readFileSync(w.register, 'utf8');
  const r = ruf(w);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /TROCKENLAUF - es wurde NICHTS geschrieben/);
  assert.equal(fs.readFileSync(w.register, 'utf8'), vorher);
  assert.match(r.stdout, /previousHash": "e9e0eeb3/);
  assert.match(r.stdout, /Eintraege nach dem Anhaengen: 25/);
});

test('--force gibt es nicht (F6-B8)', () => {
  const w = welt('f6aeq-force-');
  abbruch(w, ['--force'], '--force', /--force gibt es nicht/);
});

test('das ECHTE Register wurde von keiner Probe angefasst', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex'),
    LEDGER_BEIM_START);
});

// ── Die Kette ───────────────────────────────────────────────────────────────

test('ein fremdes Kettenende bricht ab', () => {
  const w = welt('f6aeq-tail-');
  const reg = JSON.parse(fs.readFileSync(w.register, 'utf8'));
  reg.events.pop(); // Eintrag 24 entfernt -> Tail und Anzahl stimmen nicht mehr
  fs.writeFileSync(w.register, JSON.stringify(reg, null, 1), 'utf8');
  abbruch(w, [], 'fehlender Eintrag 24', /Eintraege, erwartet sind 24/);
});

test('eine belegte runId bricht ab', () => {
  const w = welt('f6aeq-runid-');
  abbruch(w, ['--runid', 'f6-se-klumpen-freeze-2026-08-31'], 'belegte runId',
    /steht bereits im Register/);
});

test('eine verstellte Kette bricht ab, bevor irgendetwas gebaut wird', () => {
  const w = welt('f6aeq-kette-');
  const reg = JSON.parse(fs.readFileSync(w.register, 'utf8'));
  reg.events[reg.events.length - 1].eventHash = 'f'.repeat(64);
  fs.writeFileSync(w.register, JSON.stringify(reg, null, 1), 'utf8');
  // Hier feuert die VERFASSUNG zuerst (pruefeZugriffsRegister, R1) und nicht
  // erst die Tail-Schranke des Werkzeugs. Das ist die richtige Reihenfolge:
  // eine nachtraeglich veraenderte Kette ist ein Verfassungsbruch, kein
  // Werkzeug-Problem. Der Waechter nimmt deshalb beide Meldungen an.
  const text = abbruch(w, [], 'verstellter Endhash', /R1: Eintrag \d+ wurde nachtraeglich|F6-AEQ/);
  assert.match(text, /nachtraeglich veraendert/);
});

// ── Die gebundenen Dateien ──────────────────────────────────────────────────

test('jede veraenderte gebundene Datei bricht ab, namentlich', () => {
  for (const rel of GEBUNDEN) {
    const w = welt('f6aeq-drift-');
    fs.appendFileSync(path.join(w.wurzel, ...rel.split('/')), '\n');
    const text = abbruch(w, [], `Drift an ${rel}`, /weicht ab/);
    assert.ok(text.includes(rel), `der Abbruch nennt die Datei nicht: ${rel}`);
  }
});

test('eine fehlende gebundene Datei bricht ab', () => {
  const w = welt('f6aeq-fehlt-');
  fs.rmSync(path.join(w.wurzel, 'scripts', 'studie-f6-zaehlwerk.py'));
  abbruch(w, [], 'fehlendes Zaehlwerk', /gebundene Datei fehlt/);
});

// ── Die Sollzahlen gegen ihre Artefakte ─────────────────────────────────────

test('eine verstellte Bein-1-Zahl im Artefakt bricht ab', () => {
  const w = welt('f6aeq-bein1-');
  const p = path.join(w.wurzel, 'protocol', 'early-detection', '2.1.0',
    'e2-schwellen-satz-2026-08-30.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.provenienz.aequivalenzTorSoll['S-U'].firmen_reif = 999;
  fs.writeFileSync(p, JSON.stringify(d, null, 1), 'utf8');
  // Der Datei-Hash schlaegt zuerst zu - das ist richtig und beweist die
  // Reihenfolge. Die Zahlenpruefung wird deshalb direkt geprueft.
  abbruch(w, [], 'verstellte Bein-1-Zahl', /weicht ab/);
});

test('die Sollzahlen im Werkzeug stimmen mit BEIDEN Artefakten ueberein', () => {
  // Die eigentliche Zahlenpruefung, am unveraenderten Objekt.
  const b1 = JSON.parse(fs.readFileSync(path.join(REPO, 'protocol', 'early-detection',
    '2.1.0', 'e2-schwellen-satz-2026-08-30.json'), 'utf8'));
  assert.deepEqual(werkzeug.BEIN1_SOLL, b1.provenienz.aequivalenzTorSoll);

  const b2 = JSON.parse(fs.readFileSync(path.join(REPO, 'reports', 'studie',
    'E4d-kadenz-entdeckung-2026-08-19.json'), 'utf8'));
  const v = b2['baender']['2009-2015'].varianten;
  const armname = { signal: 'signal', kontrollpool: 'kontrolle' };
  for (const [zelle, soll] of Object.entries(werkzeug.BEIN2_SOLL)) {
    const [fam, arm] = zelle.split('/');
    const q = v[fam][armname[arm]];
    assert.equal(soll.zaehler, q.zaehler_kadenz, `${zelle} zaehler`);
    assert.equal(soll.nenner, q.nenner_kadenz, `${zelle} nenner`);
    assert.equal(soll.zensiert, q.zensiert_kadenz, `${zelle} zensiert`);
  }
  assert.equal(b2.panelRand, '2016-12-31');
  assert.equal(b2.perzentil, 95);
});

// ── Die Allowlist ───────────────────────────────────────────────────────────

test('allowedOutputs ist EXAKT und abschliessend (Bauordnung Schritt 2)', () => {
  const erwartet = [
    'aequivalenzTorSoll.S-U.firmen_reif', 'aequivalenzTorSoll.S-U.firmen_unreif',
    'aequivalenzTorSoll.S-G.firmen_reif', 'aequivalenzTorSoll.S-G.firmen_unreif',
    'aequivalenzTorSoll.S-UG.firmen_reif', 'aequivalenzTorSoll.S-UG.firmen_unreif',
    'bein2.S-U/signal.zaehler', 'bein2.S-U/signal.nenner', 'bein2.S-U/signal.zensiert',
    'bein2.S-U/kontrollpool.zaehler', 'bein2.S-U/kontrollpool.nenner',
    'bein2.S-U/kontrollpool.zensiert',
    'bein2.S-G/signal.zaehler', 'bein2.S-G/signal.nenner', 'bein2.S-G/signal.zensiert',
    'bein2.S-G/kontrollpool.zaehler', 'bein2.S-G/kontrollpool.nenner',
    'bein2.S-G/kontrollpool.zensiert',
    'bestanden', 'modulSha256', 'zaehlwerkSha256', 'zaehlprobeSha256',
    'schwellenDateiSha256', 'schwellenInhaltSha256', 'kalibrierHaelfteGeprueft',
  ];
  assert.deepEqual(werkzeug.ALLOWED_OUTPUTS, erwartet);
  assert.equal(werkzeug.ALLOWED_OUTPUTS.length, 25);
  // F6-C7i: KEINE Kalibrierzahl als gemessene Groesse dieses Akts.
  for (const k of werkzeug.ALLOWED_OUTPUTS) {
    assert.equal(/kalibrierungsWeg|auswertbarImBand|firmenReif|firmenUnreif|verbreitertSha/.test(k),
      false, `Kalibrierzahl in der Allowlist: ${k}`);
  }
  // Kein Ergebniswert, kein Anteil, kein SE, kein Band, kein p-Wert.
  for (const verboten of ['anteil', 'auffindbarkeit', 'se_', 'band', 'p_wert',
    'verdikt', 'weiter', 'feuerrate', 'ampel', 'cik', 'klumpen']) {
    assert.equal(werkzeug.ALLOWED_OUTPUTS.some((k) => k.toLowerCase().includes(verboten)), false,
      `die Allowlist traegt einen unzulaessigen Schluessel: ${verboten}`);
  }
});

// ── Die Zeitkette ───────────────────────────────────────────────────────────

test('eine vordatierte Anmeldung bricht ab', () => {
  const w = welt('f6aeq-zukunft-');
  const zukunft = new Date(Date.now() + 86400e3).toISOString();
  const r = spawnSync(process.execPath, [WERKZEUG, '--register', w.register,
    '--wurzel', w.wurzel, '--anmeldezeit', zukunft], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /liegt in der Zukunft/);
});

test('accessedAt muss NACH registeredAt liegen', () => {
  const w = welt('f6aeq-zeit-');
  const r = spawnSync(process.execPath, [WERKZEUG, '--register', w.register,
    '--wurzel', w.wurzel, '--anmeldezeit', T_ANMELDUNG,
    '--wirksam-ab', '2026-09-01T00:00:00.000Z'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /muss NACH der Anmeldung/);
});

// ── Der gebaute Eintrag ─────────────────────────────────────────────────────

test('der gebaute Eintrag traegt die Hausform und das richtige Fenster', () => {
  const w = welt('f6aeq-form-');
  const r = ruf(w, ['--schreiben']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const reg = JSON.parse(fs.readFileSync(w.register, 'utf8'));
  assert.equal(reg.events.length, 25);
  const e = reg.events[24];

  assert.equal(e.typ, 'count_only_probe_authorized');
  assert.deepEqual(e.fenster, ['entdeckung']);
  assert.equal(e.previousHash,
    'e9e0eeb3edcf5ac2af64bdd054ba6f2c28be9e82e30ec5eaff9e8c718e64ed8d');
  assert.deepEqual(e.allowedOutputs, werkzeug.ALLOWED_OUTPUTS);
  for (const feld of ['erlaubt', 'verboten', 'begruendung', 'endtestSiegel',
    'registeredAt', 'accessedAt', 'eventHash']) {
    assert.ok(e[feld], `Hausform-Feld fehlt: ${feld}`);
  }
  assert.ok(Date.parse(e.registeredAt) < Date.parse(e.accessedAt));
  // Das Siegel bleibt zu, und der Akt autorisiert keinen konfirmatorischen Lauf.
  assert.match(e.endtestSiegel, /unberuehrt und in ALLEN Zweigen ZU/);
  assert.match(e.verboten, /confirmatory_execution_authorized/);
  assert.match(e.verboten, /Prueffenster/);
  assert.match(e.begruendung, /013c401c958bb502cc2149bc10d9081e5a1f3efc2d34a9100f178e25be116e4d/);
  assert.match(e.begruendung, /DZ-5/);
  // Die Sollzahlen stehen VOR dem Lauf im Eintrag.
  assert.deepEqual(e.aequivalenzSoll.bein1.zellen, werkzeug.BEIN1_SOLL);
  assert.deepEqual(e.aequivalenzSoll.bein2.zellen, werkzeug.BEIN2_SOLL);
  assert.match(e.aequivalenzSoll.kippbedingung, /KZ-4/);
  assert.equal(Object.keys(e.ausfuehrendeSkripte).length, 6);
});

test('ein zweiter Lauf auf dasselbe Register bricht ab (runId belegt)', () => {
  const w = welt('f6aeq-zweimal-');
  assert.equal(ruf(w, ['--schreiben']).status, 0);
  abbruch(w, ['--schreiben'], 'zweiter Lauf', /steht bereits im Register/);
});
