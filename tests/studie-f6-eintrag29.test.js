'use strict';

// Waechter fuer scripts/studie-f6-eintrag29.js — den Ergaenzungs- und
// Berichtigungs-Vermerk zu Eintrag 28.
//
// Der Kern: Blocker B ist ein ZITAT-Fehler. Der Riegel dagegen ist deshalb
// kein Textvergleich mit einer abgeschriebenen Fassung, sondern die
// Byte-Identitaet mit der Code-Konstante — und die wird hier gebrochen.
//
// Usage: node --test tests/studie-f6-eintrag29.test.js

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const WURZEL = path.join(__dirname, '..');
const LEDGER = path.join(WURZEL, 'protocol', 'early-detection', '2.0.0',
  'outcome-access-ledger.json');
const K = require(path.join(WURZEL, 'scripts', 'studie-f6-eintrag29.js'));

const tmpdir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-e29-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const eintrag = () => K.baueEintrag(
  '2026-09-01T09:00:00.000Z', '2026-09-01T11:00:00.000Z', WURZEL);

test('--force gibt es nicht (F6-B8)', () => {
  assert.throws(() => K.haupt(['--force']), /--force gibt es nicht/);
});

// ── Blocker B: der Regeltext ist byte-gleich mit der Konstante ────────────
test('TOR_REGELTEXT steht byte-gleich im Vermerk', () => {
  const e = eintrag();
  const t = e.torRegeltextWoertlich;
  assert.strictEqual(t.sha256, K.TOR_REGELTEXT_SHA);
  assert.strictEqual(t.zeichen, 462);
  // Die Klammer, die in Eintrag 28 fehlte, ist die Dominanzregel.
  assert.match(t.text, /\(das Messgeraet hat nicht getrennt; die Bandfolge dominiert\)/);
  // Und der Text ist der der Konstante, nicht ein abgeschriebener.
  const quelle = fs.readFileSync(path.join(WURZEL, 'scripts', 'studie-f6-lauf.py'), 'utf8');
  assert.ok(quelle.includes('das Messgeraet hat nicht getrennt; die Bandfolge dominiert'));
});

test('BRUCHPROBE: ein gekuerzter Regeltext bricht den Akt ab', () => {
  const d = tmpdir();
  fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
  for (const rel of ['scripts/studie-f6-lauf.py', 'scripts/studie-e4d-kadenz.py']) {
    fs.copyFileSync(path.join(WURZEL, ...rel.split('/')), path.join(d, ...rel.split('/')));
  }
  const p = path.join(d, 'scripts', 'studie-f6-lauf.py');
  // Genau die Kuerzung, die Eintrag 28 hatte: die Klammer weg.
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(
    '(das Messgeraet hat nicht getrennt; die Bandfolge dominiert). ', ''));
  assert.throws(() => K.torRegeltext(d), /ergibt sha256 .* gemessen wurde/s);
});

// ── Blocker A: die F6-C8h-Schicht ist wirklich da ─────────────────────────
test('die F6-C8h-Schicht traegt alle fuenf Glieder', () => {
  const s = eintrag().f6c8hSchicht;
  assert.match(s['1_einEreignisMechanismus'], /verlaesst es Zaehler UND Nenner gemeinsam/);
  assert.match(s['1_einEreignisMechanismus'], /\+1\/\+1\/-1/);
  // Keine verbotene Groesse im Mechanismus.
  assert.match(s['1_einEreignisMechanismus'], /keine Prueffenster-Groesse/);
  // F6-C8h(2): die Kadenz-Basis WOERTLICH, mit dem Siegel-Vorbehalt.
  assert.match(s['2_kadenzBasisWoertlich'].text, /Melderhythmus/);
  assert.match(s['2_kadenzBasisWoertlich'].text, /Fiskalquartal/);
  assert.match(s['2_kadenzBasisWoertlich'].text, /Zaehler UND Nenner/);
  assert.match(s['2_kadenzBasisWoertlich'].siegel, /UNTER EIGENEM SIEGEL/);
  assert.match(s['3_gerichtNichtBauender'], /Aktenkette/);
  assert.match(s['3_gerichtNichtBauender'], /KZ-4 gewahrt/);
  assert.match(s['4_spaltentabelle'], /KADENZ-\/E4e-Basis regiert Bein 2 NICHT/);
  assert.match(s['5_anhang1_144'], /ANHANG1:144/);
});

test('BRUCHPROBE: eine verschobene Kadenz-Quelle bricht ab', () => {
  const d = tmpdir();
  fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(d, 'scripts', 'studie-e4d-kadenz.py'),
    `${'# platzhalter\n'.repeat(40)}`);
  assert.throws(() => K.kadenzBasis(d), /nicht raten, messen/);
});

// ── F6-C8i, die Dissense, die Zitattreue ──────────────────────────────────
test('die uebrigen befohlenen Stuecke stehen im Vermerk', () => {
  const e = eintrag();
  assert.strictEqual(e.richtungsOffenlegungBerichtigung.satz1,
    'Diese Berichtigung ENTFERNT an genau einer Zelle einen stehenden STOPP');
  assert.strictEqual(e.richtungsOffenlegungBerichtigung.satz2,
    'Die Unerfuellbarkeit wurde hier nicht vor, sondern DURCH einen Lauf entdeckt');
  assert.match(e.konservierteDissense.ob2_umbenennung, /konservierten Dissens/);
  assert.match(e.konservierteDissense.ob2_umbenennung, /C1 als Zweit-Weg/);
  assert.match(e.konservierteDissense.ob1_korrekturform, /KZ-22/);
  // Zitattreue: BEIDE Originale, nicht die Verschmelzung.
  assert.strictEqual(e.zitattreueC9e.original1,
    'Bein 3: fuenf Wortlaut-Literale ohne Panel-Lauf.');
  assert.strictEqual(e.zitattreueC9e.original2,
    'Fuenf Wortlaut-Literale aus preregistration.json, ohne Panel-Lauf (F6-C9).');
  // Die drei kleinen Vermerke des Delta-Reviews.
  for (const k of ['torRichtungAblage', 'mergedAtSekunde', 'geviertstrich']) {
    assert.ok(e.weitereVermerke[k].length > 60, `${k} fehlt`);
  }
});

// ── Die Art: ein Vermerk autorisiert NICHTS ───────────────────────────────
test('der Vermerk autorisiert keinen Zugriff', () => {
  const e = eintrag();
  assert.strictEqual(e.typ, 'C0_REGELFREEZE');
  assert.deepStrictEqual(e.allowedOutputs, []);
  assert.match(e.erlaubt, /^Nichts\./);
  assert.match(e.erlaubt, /AUTORISIERUNG von Eintrag 28 bleibt unberuehrt/);
  assert.match(e.laufFreigabe, /FEUERT NICHT MIT DIESEM VERMERK/);
});

// ── Der Trockenlauf schreibt nichts ───────────────────────────────────────
// Der Fixture-Stand VOR diesem Akt - abgeschnitten bis zu dem Kettenende, das
// das Werkzeug erwartet, NICHT auf eine feste Laenge. Ohne das ist die Probe
// nur auf main gruen und wird rot, sobald der eigene Eintrag im Register
// steht: dieselbe Klasse, die schon die Waechter zu Eintrag 27 und 28
// gerissen hat. Beim dritten Mal steht sie jetzt hier.
function basisRegister(tmp) {
  const reg = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  while (reg.events.length && reg.events.at(-1).eventHash !== K.ERWARTETER_TAIL) {
    reg.events.pop();
  }
  const p = path.join(tmp, 'basis-register.json');
  fs.writeFileSync(p, JSON.stringify(reg, null, 1));
  return p;
}

test('der Trockenlauf schreibt nichts - weder ins Fixture noch ins echte Register', () => {
  const d = tmpdir();
  const fixture = basisRegister(d);
  const vorherEcht = crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex');
  const vorherFixture = crypto.createHash('sha256')
    .update(fs.readFileSync(fixture)).digest('hex');
  const echt = process.stdout.write;
  let aus = '';
  process.stdout.write = (s) => { aus += s; return true; };
  try { K.haupt(['--register', fixture]); } finally { process.stdout.write = echt; }
  assert.strictEqual(
    crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex'), vorherEcht,
    'das echte Register wurde angefasst');
  assert.strictEqual(
    crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex'), vorherFixture,
    'der Trockenlauf hat ins Fixture geschrieben');
  assert.match(aus, /TROCKENLAUF - es wurde NICHTS geschrieben/);
  assert.match(aus, new RegExp(`"previousHash": "${K.ERWARTETER_TAIL}"`));
});

test('die Probe traegt auf BEIDEN Registerstaenden - mit und ohne eigenen Eintrag', () => {
  // Die INVARIANTE ist: beide Registerstaende schneiden auf DENSELBEN Stand
  // zurueck - den, der auf ERWARTETER_TAIL endet. NICHT: der abgeschnittene
  // Stand hat die Laenge des rohen Registers. Genau diese zweite, falsche
  // Zusicherung stand hier und war nur auf main wahr: dort ist das Register
  // 28 lang UND endet auf dem erwarteten Tail, auf dem Ledger-Zweig ist es 29
  // lang und endet auf dem eigenen Eintrag. Die Probe, die die
  // Beide-Staende-Klasse toeten sollte, ist selbst an ihr gestorben.
  const kuerze = (reg) => {
    const c = JSON.parse(JSON.stringify(reg));
    while (c.events.length && c.events.at(-1).eventHash !== K.ERWARTETER_TAIL) c.events.pop();
    return c.events.map((e) => e.eventHash);
  };
  const echt = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const mitEintrag = JSON.parse(JSON.stringify(echt));
  mitEintrag.events.push({ runId: K.RUN_ID, eventHash: 'x'.repeat(64) });

  const ohne = kuerze(echt);
  const mit = kuerze(mitEintrag);
  assert.deepStrictEqual(mit, ohne,
    'beide Registerstaende muessen auf denselben Stand zurueckschneiden');
  assert.strictEqual(ohne.at(-1), K.ERWARTETER_TAIL);
  // Und der Stand ist nicht leer - ein leeres Ergebnis waere kein Beweis.
  assert.ok(ohne.length > 20, `nur ${ohne.length} Ereignisse - Anker verfehlt?`);
});
