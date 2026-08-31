'use strict';

/**
 * Wache zum Bau-Werkzeug des Register-Eintrags 24 (C0-Freeze der
 * Rechenvorschrift F6-SE-KLUMPEN/v1) — _COURT-F6-VOLLZUG-2026-08-31,
 * Auflagen F6-B3 / F6-B4 / F6-B5 / F6-B8 / F6-B20 / F6-B24.
 *
 * WAS HIER GESCHUETZT WIRD: das Register ist nur-anhaengend und verkettet. Ein
 * falscher Eintrag ist nicht korrigierbar, nur ergaenzbar. Der Waechter prueft
 * deshalb nicht, ob das Werkzeug "laeuft", sondern ob es an jeder Stelle ANHAELT,
 * an der es anhalten muss — und ob der Trockenlauf wirklich nichts schreibt.
 *
 * ALLES HERMETISCH: gefahren wird gegen eine Kopie des Registers und eine Kopie
 * der gebundenen Dateien in einem Temp-Baum. Der echte Ledger wird nur GELESEN;
 * der Test beweist am SHA-256, dass er danach byte-gleich ist.
 *
 * Usage: node --test tests/studie-f6-freeze-eintrag24.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WERKZEUG = path.join(ROOT, 'scripts', 'studie-f6-freeze-eintrag24.js');
const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const LEDGER = path.join(ROOT, ...LEDGER_REL.split('/'));

const W = require(WERKZEUG);
const { pruefeZugriffsRegister } = require(path.join(ROOT, 'lib', 'studie-verfassung.js'));

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const LEDGER_SHA_VORHER = sha(LEDGER);

// Die Dateien, die das Werkzeug am Objekt prueft. Sie wandern in den Temp-Baum,
// damit jede einzeln verfaelscht werden kann, ohne das Repo anzufassen.
const GEBUNDEN = [
  W.SE_MODUL_REL,
  'protocol/early-detection/2.0.0/rules.json',
  W.WAECHTER_REL,
  'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json',
  W.NUTZLAST_REL,
];

function baum() {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-24-'));
  for (const rel of GEBUNDEN) {
    const ziel = path.join(wurzel, ...rel.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.copyFileSync(path.join(ROOT, ...rel.split('/')), ziel);
  }
  const register = path.join(wurzel, ...LEDGER_REL.split('/'));
  fs.mkdirSync(path.dirname(register), { recursive: true });
  fs.copyFileSync(LEDGER, register);
  return { wurzel, register };
}

// Feste Zeiten: derselbe Eintrag muss bit-gleich reproduzierbar sein, sonst
// prueft der Waechter bei jedem Lauf etwas anderes.
const ANMELDUNG = '2026-08-31T20:00:00.000Z';
const WIRKSAM = '2026-08-31T22:00:00.000Z';

function lauf(extra, ort) {
  const o = ort || baum();
  const r = spawnSync(process.execPath, [WERKZEUG,
    '--register', o.register, '--wurzel', o.wurzel,
    '--anmeldezeit', ANMELDUNG, '--wirksam-ab', WIRKSAM, ...(extra || [])],
  { encoding: 'utf8' });
  return { ...r, ...o };
}

// ── Trockenlauf ist der Standard ────────────────────────────────────────────
test('F6-B8: ohne Flagge wird NICHTS geschrieben', () => {
  const o = baum();
  const vorher = sha(o.register);
  const r = lauf([], o);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /TROCKENLAUF - es wurde NICHTS geschrieben/);
  assert.equal(sha(o.register), vorher, 'der Trockenlauf hat die Registerdatei veraendert');
});

test('F6-B8: --force und Verwandte sind keine Schreibwege', () => {
  // An der SACHE gemessen, nicht am Text: ein Quelltext-Scan faende auch den
  // Kommentar "es gibt kein --force" und ginge gruen, ohne etwas zu pruefen.
  // Geprueft wird, was zaehlt: ausser --schreiben oeffnet KEINE Flagge den
  // Schreibweg, auch nicht in Kombination.
  for (const flagge of [['--force'], ['--repair'], ['--fix'], ['--force', '--repariere'],
    ['--schreiben=true'], ['--write']]) {
    const o = baum();
    const vorher = sha(o.register);
    const r = lauf(flagge, o);
    assert.equal(r.status, 0, `${flagge.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /TROCKENLAUF - es wurde NICHTS geschrieben/,
      `${flagge.join(' ')} haette einen Schreibweg geoeffnet`);
    assert.equal(sha(o.register), vorher, `${flagge.join(' ')} hat geschrieben`);
  }
});

// ── Der gebaute Eintrag ─────────────────────────────────────────────────────
test('Eintrag 24: Form, Kettenanschluss und Inhalt', () => {
  const o = baum();
  const r = lauf([], o);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const register = JSON.parse(fs.readFileSync(o.register, 'utf8'));
  const nutzlast = W.pruefeNutzlast(path.join(o.wurzel, ...W.NUTZLAST_REL.split('/')));
  const e = W.baueEintrag(W.RUN_ID, ANMELDUNG, WIRKSAM, nutzlast);

  assert.equal(e.typ, 'C0_REGELFREEZE', 'ein Freeze-Akt, keine Zugriffs-Art');
  assert.deepEqual(e.allowedOutputs, [], 'F6-B3: allowedOutputs ist leer');
  assert.equal(e.erlaubt, 'Nichts. Kein Datenzugriff.', 'F6-B3 gibt diesen Satz woertlich vor');
  // Kettenanschluss: an Eintrag 23, nicht an irgendein Ende.
  const letzter = register.events[register.events.length - 1];
  assert.equal(letzter.runId, W.ERWARTETER_LETZTER_RUNID);
  assert.equal(letzter.eventHash, W.ERWARTETER_TAIL);
  assert.match(r.stdout, new RegExp(`"previousHash": "${W.ERWARTETER_TAIL}"`));

  // Der Wortlaut: vollstaendig, verbatim, mit dem Antezedens aus Paragraph 7.
  assert.equal(e.vorschriftWortlaut.sha256, W.WORTLAUT_SHA256);
  assert.equal((e.vorschriftWortlaut.text.match(/^\*\*\d+\. /gm) || []).length, 11,
    'die Ziffern 1 bis 11 muessen vollstaendig sein');
  assert.ok(e.vorschriftWortlaut.text.includes('Gilt n_g = 1 für alle g'),
    'Paragraph 7 ohne Antezedens waere eine falsche Aussage (NACHTRAG 2)');
  assert.ok(e.vorschriftWortlaut.text.includes('SE_klumpen-robust = Wurzel( (G / (G − 1)) · S ) / N'),
    'der Schaetzer selbst muss im Wortlaut stehen');

  // Die berichtigte Offenlegung, NICHT die alte Klammer.
  assert.equal(e.offenlegungFaktor.sha256, W.OFFENLEGUNG_SHA256);
  assert.ok(e.offenlegungFaktor.text.includes('Wurzel(G/(G−1))'),
    'die allgemeine Schranke ist Wurzel(G/(G-1)) (NACHTRAG 2)');
  assert.ok(!/^\*\*Groessenordnung\.\*\* Der Aufschlag auf SE\\\* ist hoechstens/m
    .test(e.offenlegungFaktor.text));

  // Die vier Bindungen aus F6-B24/B5/B4.
  assert.equal(e.bindungen.fuenfterPin.sha256, W.SE_MODUL_SHA256);
  assert.equal(e.bindungen.vollzugsArtefakt.dateiSha256, W.VOLLZUG_DATEI_SHA256);
  assert.equal(e.bindungen.vollzugsArtefakt.inhaltSha256, W.VOLLZUG_INHALT_SHA256);
  assert.equal(e.bindungen.regelwerk.sha256, W.RULES_SHA256);
  assert.equal(e.bindungen.waechter.datei, W.WAECHTER_REL);
  assert.match(e.bindungen.waechter.bruchprobe, /T1 und T4 rot/);

  // Der Akt autorisiert nichts.
  assert.match(e.begruendung, /PROSPEKTIVE VERVOLLSTAENDIGUNG/);
  assert.match(e.begruendung, /EINTRAG 23 WIRD NICHT NACHTRAEGLICH ERGAENZT/);
  assert.match(e.endtestSiegel, /unberuehrt und in ALLEN Zweigen ZU/);
});

// ── Die Tore ────────────────────────────────────────────────────────────────
// Jedes einzeln ausgeloest. Ein Tor, das nie feuert, ist kein Tor.

test('Tor: ein fremdes oder veraltetes Kettenende haelt an', () => {
  const o = baum();
  const reg = JSON.parse(fs.readFileSync(o.register, 'utf8'));
  reg.events.pop(); // ein Ende ZU FRUEH — Eintrag 23 fehlt
  fs.writeFileSync(o.register, `${JSON.stringify(reg, null, 1)}\n`);
  const r = lauf([], o);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /der juengste Eintrag ist nicht der erwartete|fuehrt 22 Eintraege/);
});

test('Tor: dieselbe runId ein zweites Mal haelt an', () => {
  const o = baum();
  const r = lauf(['--runid', W.ERWARTETER_LETZTER_RUNID], o);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /steht schon im Register/);
});

test('Tor: ein veraenderter Wortlaut haelt an', () => {
  const o = baum();
  const p = path.join(o.wurzel, ...W.NUTZLAST_REL.split('/'));
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.wortlaut = d.wortlaut.replace('Klein-Klumpen-Korrektur', 'Klein-Klumpen-Korrektur (leicht angepasst)');
  fs.writeFileSync(p, `${JSON.stringify(d, null, 1)}\n`);
  const r = lauf([], o);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /traegt sha256|Wortlaut/);
});

test('Tor: ein Wortlaut ohne das Antezedens aus Paragraph 7 haelt an', () => {
  const o = baum();
  const p = path.join(o.wurzel, ...W.NUTZLAST_REL.split('/'));
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.wortlaut = d.wortlaut.replace('Gilt n_g = 1 für alle g', 'Im Regelfall');
  fs.writeFileSync(p, `${JSON.stringify(d, null, 1)}\n`);
  // Erst den Datei-Hash nachziehen, damit wirklich die Antezedens-Pruefung
  // antwortet und nicht schon der Hash-Wachposten.
  const r = spawnSync(process.execPath, [WERKZEUG, '--register', o.register, '--wurzel', o.wurzel,
    '--nutzlast', p, '--anmeldezeit', ANMELDUNG, '--wirksam-ab', WIRKSAM], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sha256|Antezedens/);
});

test('Tor: ein verstelltes Modul (fuenfter Pin) haelt an', () => {
  const o = baum();
  const p = path.join(o.wurzel, ...W.SE_MODUL_REL.split('/'));
  fs.appendFileSync(p, '\n# eine Zeile zu viel\n');
  const r = lauf([], o);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /studie-f6-klumpen-se\.py traegt sha256/);
});

test('Tor: verstelltes rules.json haelt an (F6-B4)', () => {
  const o = baum();
  const p = path.join(o.wurzel, 'protocol', 'early-detection', '2.0.0', 'rules.json');
  fs.appendFileSync(p, '\n');
  const r = lauf([], o);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /rules\.json traegt sha256/);
});

test('Tor: ein bereits registriertes Vollzugs-Artefakt haelt an (F6-B5)', () => {
  const o = baum();
  const p = path.join(o.wurzel, 'protocol', 'early-detection', '2.1.0',
    'f6-vollzug-zweig-a-2026-08-31.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.vollzugsStatus.registriert = true;
  fs.writeFileSync(p, `${JSON.stringify(d, null, 1)}\n`);
  const r = lauf([], o);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /traegt sha256|bereits als registriert/);
});

test('Tor: eine vordatierte Anmeldung haelt an', () => {
  const o = baum();
  const morgen = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
  const r = spawnSync(process.execPath, [WERKZEUG, '--register', o.register, '--wurzel', o.wurzel,
    '--anmeldezeit', morgen], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /liegt in der Zukunft/);
});

// ── Das Schreiben ───────────────────────────────────────────────────────────
test('--schreiben haengt GENAU EINEN Eintrag an, und die Kette bleibt gueltig', () => {
  const o = baum();
  const vorher = JSON.parse(fs.readFileSync(o.register, 'utf8'));
  const r = lauf(['--schreiben'], o);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const nachher = JSON.parse(fs.readFileSync(o.register, 'utf8'));
  assert.equal(nachher.events.length, vorher.events.length + 1, 'genau ein neuer Eintrag');
  assert.deepEqual(nachher.events.slice(0, -1), vorher.events,
    'nur-anhaengend: kein bestehender Eintrag darf sich veraendern');
  const neu = nachher.events[nachher.events.length - 1];
  assert.equal(neu.runId, W.RUN_ID);
  assert.equal(neu.typ, 'C0_REGELFREEZE');
  assert.equal(neu.previousHash, W.ERWARTETER_TAIL);
  assert.doesNotThrow(() => pruefeZugriffsRegister(nachher), 'die Kette muss gueltig bleiben');
  assert.match(r.stdout, /GESCHRIEBEN:/);
  assert.match(r.stdout, /ERST DANACH darf Eintrag 25/);

  // Reproduzierbarkeit: derselbe Aufruf auf frischem Baum ergibt denselben Hash.
  const o2 = baum();
  const r2 = lauf(['--schreiben'], o2);
  assert.equal(r2.status, 0);
  const neu2 = JSON.parse(fs.readFileSync(o2.register, 'utf8')).events.pop();
  assert.equal(neu2.eventHash, neu.eventHash, 'gleiche Eingaben, gleicher eventHash');
});

// ── Und der echte Ledger ist unberuehrt ─────────────────────────────────────
test('der ausgelieferte Ledger wurde nur gelesen', () => {
  assert.equal(sha(LEDGER), LEDGER_SHA_VORHER,
    'dieser Test darf das echte Register nicht anfassen');
});
