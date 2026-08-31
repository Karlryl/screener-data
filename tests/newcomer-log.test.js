'use strict';
/**
 * Waechter fuer das Newcomer-Log (S0.2, Masterplan 6.2).
 *
 * WORUM ES GEHT: Die Coverage-Studie S0.1 konnte fuer keinen einzigen Namen belegen, ob
 * Karl ihn uebersehen hat — weil niemand mitschrieb, wann ein Name zum ersten Mal in der
 * Uebersicht stand. Dieses Log schliesst die Luecke ab heute. Es ist reine Beobachtung:
 * kein Score, keine Achse, kein Alarm.
 *
 * DIE DREI FALLEN, gegen die hier festgenagelt wird — alle drei erzeugen SCHEINereignisse,
 * also Zahlen, die echt aussehen und keine sind:
 *   1. Der allererste Eintrag haette 200 „Neuzugaenge". Er wird als Erstaufnahme benannt.
 *   2. Der erste Eintrag eines neuen MONATS haette wieder 200, wenn nur die aktuelle
 *      Monatsdatei gelesen wird. Deshalb liest das Skript ALLE Monatsdateien.
 *   3. Ein zweiter Lauf am selben Tag haette „null Neuzugaenge" gemeldet und den ersten
 *      Eintrag als Karteileiche stehen lassen. Der Tag wird deshalb ERSETZT.
 *
 * Usage:  node tests/newcomer-log.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, diffMitglieder, mitgliederAus, bisherigeZeilen, newcomerLogDir } = require('../scripts/write-newcomer-log.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

check('Zu- und Abgaenge werden getrennt und in der Reihenfolge der Quelle gemeldet', () => {
  const d = diffMitglieder(['A', 'B', 'C'], ['B', 'D', 'A']);
  assert.deepEqual(d.newcomers, ['D']);
  assert.deepEqual(d.departures, ['C']);
});

check('gleiche Menge in anderer Reihenfolge ist KEINE Bewegung', () => {
  // Ein Rangwechsel innerhalb der Uebersicht ist kein Zugang. Wer hier die Reihenfolge
  // vergliche statt der Menge, meldete jeden Tag Dutzende Scheinereignisse.
  const d = diffMitglieder(['A', 'B', 'C'], ['C', 'A', 'B']);
  assert.deepEqual(d.newcomers, []);
  assert.deepEqual(d.departures, []);
});

check('ohne Vorgaenger gibt es keine Zugaenge, nicht 200', () => {
  const d = diffMitglieder(null, ['A', 'B']);
  assert.deepEqual(d.newcomers, ['A', 'B'], 'die reine Funktion meldet sie...');
  // ...das Skript wandelt genau diesen Fall in `erstaufnahme: true` mit LEEREN Listen um —
  // festgenagelt im Struktur-Test unten.
});

check('Mitglieder werden aus beiden Uebersichts-Formen gelesen', () => {
  assert.deepEqual(mitgliederAus([{ ticker: 'A' }, { ticker: 'B' }]), ['A', 'B']);
  assert.deepEqual(mitgliederAus({ rows: [{ ticker: 'A' }] }), ['A']);
  assert.deepEqual(mitgliederAus({}), []);
  assert.deepEqual(mitgliederAus(null), []);
});

check('Zeilen ohne brauchbaren Ticker fallen raus, statt als leerer Name zu zaehlen', () => {
  assert.deepEqual(mitgliederAus([{ ticker: 'A' }, {}, { ticker: null }, { ticker: 'B' }]), ['A', 'B']);
});

check('run() ersetzt den Zweitlauf eines Tages und rechnet weiter gegen den Vortag', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'newcomer-run-'));
  try {
    const overview = path.join(root, 'overview.json');
    const logDir = path.join(root, 'newcomer-log');
    const firstDate = '2026-08-29';
    const priorDate = '2026-08-30';
    const rerunDate = '2026-08-31';
    const logFile = path.join(logDir, '2026-08.jsonl');

    fs.writeFileSync(overview, JSON.stringify({ rows: [{ ticker: 'A' }, { ticker: 'B' }] }), 'utf8');
    const first = run({ date: firstDate, overview, logDir });
    assert.equal(first.status, 'geschrieben');
    assert.equal(first.erstaufnahme, true);
    assert.deepEqual(first.newcomers, []);
    assert.deepEqual(first.departures, []);

    let rows = fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(rows.length, 1, 'der erste Lauf schreibt genau eine Zeile');
    assert.deepEqual(rows[0].members, ['A', 'B']);
    assert.equal(rows[0].erstaufnahme, true);
    assert.deepEqual(rows[0].newcomers, []);
    assert.deepEqual(rows[0].departures, []);

    fs.writeFileSync(overview, JSON.stringify({ rows: [{ ticker: 'B' }, { ticker: 'C' }] }), 'utf8');
    const priorDay = run({ date: priorDate, overview, logDir });
    assert.equal(priorDay.status, 'geschrieben');
    assert.equal(priorDay.prior, firstDate);
    assert.equal(priorDay.erstaufnahme, false);
    assert.deepEqual(priorDay.newcomers, ['C']);
    assert.deepEqual(priorDay.departures, ['A']);

    fs.writeFileSync(overview, JSON.stringify({ rows: [{ ticker: 'A' }, { ticker: 'D' }] }), 'utf8');
    const dayThreeFirst = run({ date: rerunDate, overview, logDir });
    assert.equal(dayThreeFirst.status, 'geschrieben');
    assert.equal(dayThreeFirst.prior, priorDate);
    assert.deepEqual(dayThreeFirst.newcomers, ['A', 'D']);
    assert.deepEqual(dayThreeFirst.departures, ['B', 'C']);

    fs.writeFileSync(overview, JSON.stringify({ rows: [{ ticker: 'B' }, { ticker: 'D' }] }), 'utf8');
    const second = run({ date: rerunDate, overview, logDir });
    assert.equal(second.status, 'geschrieben');
    assert.equal(second.prior, priorDate);
    assert.equal(second.erstaufnahme, false);
    assert.deepEqual(second.newcomers, ['D']);
    assert.deepEqual(second.departures, ['C']);

    rows = fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(rows.length, 3, 'zwei Vortage plus genau eine Zeile fuer den wiederholten Tag');
    assert.equal(rows.filter((row) => row.date === rerunDate).length, 1, 'derselbe Tag darf nicht zweimal im JSONL stehen');
    const updated = rows.find((row) => row.date === rerunDate);
    assert.equal(updated.n, 2);
    assert.deepEqual(updated.members, ['B', 'D'], 'der Zweitlauf ersetzt die alte Mitgliedschaft');
    assert.equal(updated.prior, priorDate, 'Same-Day-Eintrag nutzt den juengsten echten Vortag');
    assert.equal(updated.erstaufnahme, false);
    assert.deepEqual(updated.newcomers, ['D']);
    assert.deepEqual(updated.departures, ['C']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

check('das Log liest ALLE Monatsdateien, nicht nur die aktuelle', () => {
  // Falle 2: laese es nur die aktuelle Datei, waere der 1. jedes Monats ein
  // Neuzugangs-Feuerwerk aus 200 Namen.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newcomer-'));
  fs.writeFileSync(path.join(dir, '2026-06.jsonl'),
    JSON.stringify({ date: '2026-06-30', members: ['A'] }) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, '2026-07.jsonl'),
    JSON.stringify({ date: '2026-07-01', members: ['A', 'B'] }) + '\n', 'utf8');
  const zeilen = bisherigeZeilen(dir);
  assert.equal(zeilen.length, 2, 'beide Monate');
  assert.equal(zeilen[0].date, '2026-06-30', 'aeltester zuerst');
});

check('eine kaputte Zeile kostet ihren Tag, nicht die ganze Datei', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newcomer-'));
  fs.writeFileSync(path.join(dir, '2026-07.jsonl'),
    '{kaputt\n' + JSON.stringify({ date: '2026-07-02', members: ['A'] }) + '\n', 'utf8');
  const zeilen = bisherigeZeilen(dir);
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0].date, '2026-07-02');
});

check('ein fehlendes Log-Verzeichnis ist kein Fehler', () => {
  assert.deepEqual(bisherigeZeilen(path.join(os.tmpdir(), 'gibt-es-nicht-' + Date.now())), []);
});

check('das Skript fasst picks-history NICHT an', () => {
  const root = path.join(os.tmpdir(), 'repo-root');
  assert.equal(newcomerLogDir(root), path.join(root, 'newcomer-log'));

  // Grundgesetz-Schutzliste. Geprueft am Quelltext, weil ein Pfad-Fehler sonst erst im
  // Betrieb auffiele — und dort waere er nicht mehr gutzumachen.
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'write-newcomer-log.js'), 'utf8');
  const codeOhneKommentare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/picks-history/.test(codeOhneKommentare), 'picks-history darf in keinem Pfad vorkommen');
  assert.ok(/newcomer-log/.test(codeOhneKommentare), 'schreibt nach newcomer-log/');
});

console.log('\nnewcomer-log: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
