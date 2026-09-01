'use strict';

// Waechter ueber dem Werkzeug fuer den BERICHTIGUNGS-VERMERK der Bein-2-Basis.
// _COURT-F6-ZAEHLWERK-ANHANG2-2026-09-01, F6-B8 / F6-C8c / F6-C8f / F6-C8g.
//
// Alle Proben laufen an einer KOPIE des Registers; eine eigene Probe haelt
// fest, dass das echte Register von keiner anderen angefasst wurde.
//
// Usage: node tests/studie-f6-berichtigung-bein2.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const WERKZEUG = path.join(REPO, 'scripts', 'studie-f6-berichtigung-bein2.js');
const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const LEDGER = path.join(REPO, ...LEDGER_REL.split('/'));
const QUELLE_REL = 'reports/studie/E4d-kadenz-entdeckung-2026-08-19.json';
const w = require(WERKZEUG);

const LEDGER_BEIM_START = crypto.createHash('sha256')
  .update(fs.readFileSync(LEDGER)).digest('hex');

function tempdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Fixture-Register auf den Stand VOR diesem Akt gekuerzt (Hausform, damit der
// Waechter auch nach dem Merge des Eintrags gruen bleibt).
function welt(prefix) {
  const dir = tempdir(prefix);
  const wurzel = path.join(dir, 'repo');
  const ziel = path.join(wurzel, ...QUELLE_REL.split('/'));
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.copyFileSync(path.join(REPO, ...QUELLE_REL.split('/')), ziel);
  const roh = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const i = (roh.events || []).findIndex((e) => e.runId === w.RUN_ID);
  const events = i === -1 ? roh.events : roh.events.slice(0, i);
  const register = path.join(dir, 'register.json');
  fs.writeFileSync(register, `${JSON.stringify({ ...roh, events }, null, 1)}\n`, 'utf8');
  return { dir, wurzel, register };
}

const T_AN = '2026-09-01T05:30:00.000Z';
const T_AB = '2026-09-01T07:30:00.000Z';

function ruf(o, extra = []) {
  return spawnSync(process.execPath, [WERKZEUG, '--register', o.register,
    '--wurzel', o.wurzel, '--anmeldezeit', T_AN, '--wirksam-ab', T_AB, ...extra],
  { encoding: 'utf8' });
}

function abbruch(o, extra, warum, muster) {
  const vorher = fs.readFileSync(o.register, 'utf8');
  const r = ruf(o, extra);
  assert.notEqual(r.status, 0, `${warum}: haette abbrechen muessen\n${r.stdout}`);
  assert.match(r.stderr, muster || /F6-BER/, `${warum}: ${r.stderr}`);
  assert.equal(fs.readFileSync(o.register, 'utf8'), vorher,
    `${warum}: Register trotz Abbruch veraendert`);
  return r.stderr;
}

test('Trockenlauf ist der STANDARD und schreibt nichts', () => {
  const o = welt('f6ber-trocken-');
  const vorher = fs.readFileSync(o.register, 'utf8');
  const r = ruf(o);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /TROCKENLAUF - es wurde NICHTS geschrieben/);
  assert.equal(fs.readFileSync(o.register, 'utf8'), vorher);
  assert.match(r.stdout, /previousHash": "84708464/);
  assert.match(r.stdout, /Eintraege nach dem Anhaengen: 26/);
});

test('--force gibt es nicht (F6-B8)', () => {
  abbruch(welt('f6ber-force-'), ['--force'], '--force', /--force gibt es nicht/);
});

test('das ECHTE Register wurde von keiner Probe angefasst', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex'),
    LEDGER_BEIM_START);
});

test('eine belegte runId und ein fremdes Kettenende brechen ab', () => {
  abbruch(welt('f6ber-runid-'), ['--runid', 'f6-aequivalenz-entdeckung-2026-09-01'],
    'belegte runId', /steht bereits im Register/);
  const o = welt('f6ber-tail-');
  const reg = JSON.parse(fs.readFileSync(o.register, 'utf8'));
  reg.events.pop();
  fs.writeFileSync(o.register, JSON.stringify(reg, null, 1), 'utf8');
  abbruch(o, [], 'fehlender Vorgaenger', /Eintraege, erwartet 25/);
});

test('ein veraendertes Referenzartefakt bricht ab', () => {
  const o = welt('f6ber-artefakt-');
  fs.appendFileSync(path.join(o.wurzel, ...QUELLE_REL.split('/')), '\n');
  abbruch(o, [], 'Artefakt-Drift', /weicht ab/);
});

test('F6-C8c: das Soll steht an den E3-Spalten und traegt die Identitaet', () => {
  const d = JSON.parse(fs.readFileSync(path.join(REPO, ...QUELLE_REL.split('/')), 'utf8'));
  const v = d.baender['2009-2015'].varianten;
  for (const [zelle, soll] of Object.entries(w.SOLL)) {
    const [fam, arm] = zelle.split('/');
    const z = v[fam][w.ARM_ARTEFAKT[arm]];
    assert.equal(soll.zaehler, z[w.SPALTEN.zaehler], `${zelle} .fallzahl`);
    assert.equal(soll.nenner, z[w.SPALTEN.nenner], `${zelle} .nenner_e3`);
    assert.equal(soll.zensiert, z[w.SPALTEN.zensiert], `${zelle} .zensiert_e3`);
    assert.equal(soll.zaehler / soll.nenner, z.auffindbarkeit_e3,
      `${zelle}: Identitaet gerissen`);
  }
  // Die Arm-Abbildung ist ausgeschrieben, nicht erschlossen.
  assert.equal(w.ARM_ARTEFAKT.kontrollpool, 'kontrolle');
  assert.match(w.spaltenpfad('S-U/kontrollpool'),
    /baender\["2009-2015"\]\.varianten\["S-U"\]\.kontrolle/);
});

test('die UEBERHOLTE Fassung steht nachweislich in den _kadenz-Spalten', () => {
  const d = JSON.parse(fs.readFileSync(path.join(REPO, ...QUELLE_REL.split('/')), 'utf8'));
  const k = d.baender['2009-2015'].varianten['S-U'].kontrolle;
  assert.equal(k.zaehler_kadenz, w.UEBERHOLT.zaehler);
  assert.equal(k.nenner_kadenz, w.UEBERHOLT.nenner);
  assert.equal(k.zensiert_kadenz, w.UEBERHOLT.zensiert);
  // ... und unterscheidet sich von der E3-Fassung. Nur DIESE Zelle trennt die
  // Basen; die drei anderen sind basisblind.
  assert.notEqual(k.zaehler_kadenz, k.fallzahl);
});

test('der Gerichtsakt-SHA ist am Objekt reproduzierbar (Stand VOR Ratifikation)', () => {
  const p = path.join('C:', 'Users', 'Anwender', 'OneDrive', 'Dokumente', 'GitHub', 'Jarvis',
    'Knowledge', 'Trading', 'growth-screener', 'agent-reports',
    '_COURT-F6-ZAEHLWERK-ANHANG2-2026-09-01.md');
  if (!fs.existsSync(p)) return; // Vault nicht verfuegbar - Probe entfaellt still
  const roh = fs.readFileSync(p);
  assert.ok(roh.length >= w.ANHANG2_BYTES, 'Urteilsdatei kuerzer als der gebundene Stand');
  const sha = crypto.createHash('sha256')
    .update(roh.subarray(0, w.ANHANG2_BYTES)).digest('hex');
  assert.equal(sha, w.ANHANG2_SHA,
    'der gebundene Vor-Ratifikations-SHA reproduziert nicht bei der genannten Laenge');
});

test('der gebaute Eintrag traegt Hausform und die F6-C8g-Pflichten', () => {
  const o = welt('f6ber-form-');
  assert.equal(ruf(o, ['--schreiben']).status, 0);
  const reg = JSON.parse(fs.readFileSync(o.register, 'utf8'));
  assert.equal(reg.events.length, 26);
  const e = reg.events[25];

  assert.equal(e.typ, 'C0_REGELFREEZE');
  assert.deepEqual(e.allowedOutputs, [], 'ein Berichtigungs-Vermerk gibt nichts aus');
  assert.equal(e.erlaubt, 'Nichts. Kein Datenzugriff.');
  assert.equal(e.previousHash, w.ERWARTETER_TAIL);
  for (const feld of ['verboten', 'begruendung', 'endtestSiegel', 'registeredAt', 'accessedAt']) {
    assert.ok(e[feld], `Hausform-Feld fehlt: ${feld}`);
  }
  // F6-C8g (1)-(6)
  assert.match(e.begruendung, /0\.8331856446610545/);            // (1) Gegenbeweis
  assert.match(e.begruendung, /NICHT als Ausgabewert/);          // Vermerk, kein Output
  assert.equal(e.berichtigung.berichtigt.zaehler, 3761);         // (2)
  assert.equal(e.berichtigung.berichtigt.nenner, 4514);
  assert.equal(e.berichtigung.berichtigt.zensiert, 0);
  assert.match(e.berichtigung.sollTabelle['S-U/kontrollpool'].spaltenpfad,
    /\.kontrolle\.\{fallzahl,nenner_e3,zensiert_e3\}/);
  assert.match(e.berichtigung.armAbbildung, /"kontrollpool" -> "kontrolle"/);
  assert.equal(e.berichtigung.referenz.dateiSha256, w.QUELLE_SHA);   // (3)
  assert.deepEqual(e.berichtigung.basisblind,                        // (4)
    ['S-U/signal', 'S-G/signal', 'S-G/kontrollpool']);
  assert.match(e.begruendung, /BASISBLIND/);
  assert.match(e.begruendung, /studie-e4d-kadenz\.py:522/);          // (5) Zeuge b
  assert.match(e.begruendung, /ABLEITUNG -> EINTRAG -> LAUF/);
  assert.match(e.begruendung, /BASIS-ABBRUCH/);                      // (6) Bruchproben
  // Verhaeltnis zum Vorgaenger
  assert.equal(e.berichtigung.vorgaengerAkt.eventHash, w.ERWARTETER_TAIL);
  assert.match(e.begruendung, /AUTORISIERUNG bleibt VOLLSTAENDIG GUELTIG/);
  assert.equal(e.berichtigung.gerichtsakt.sha256VorRatifikation, w.ANHANG2_SHA);
  // Richtungs-Offenlegung, beide Saetze
  assert.match(e.begruendung, /ENTFERNT an genau einer Zelle einen stehenden STOPP/);
  assert.match(e.begruendung, /nicht vor, sondern DURCH einen Lauf/);
});

test('ein zweiter Lauf auf dasselbe Register bricht ab', () => {
  const o = welt('f6ber-zweimal-');
  assert.equal(ruf(o, ['--schreiben']).status, 0);
  // Der Anzahl-Wachtposten feuert VOR dem runId-Wachtposten - das ist die
  // richtige Reihenfolge: ein veraenderter Kettenstand ist der groebere Befund.
  abbruch(o, ['--schreiben'], 'zweiter Lauf', /Eintraege, erwartet 25/);
});
