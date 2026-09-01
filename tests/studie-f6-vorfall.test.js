'use strict';

// Waechter fuer scripts/studie-f6-vorfall.js — den Vorfall-Vermerk (F6-K6..K9).
//
// Zwei Dinge sind hier wichtiger als alles andere: der Abbruchtext muss
// BYTE-GENAU der sein, den der Laeufer erzeugt (F6-K7(c)) — deshalb wird er
// aus dem QUELLTEXT rekonstruiert und nicht mit meiner Abschrift verglichen —,
// und der Vermerk ueber einen R12a-Vorfall darf nicht selbst gegen R12a
// verstossen (F6-K9).
//
// Usage: node --test tests/studie-f6-vorfall.test.js

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const WURZEL = path.join(__dirname, '..');
const LEDGER = path.join(WURZEL, 'protocol', 'early-detection', '2.0.0',
  'outcome-access-ledger.json');
const LAEUFER = path.join(WURZEL, 'scripts', 'studie-f6-lauf.py');
const K = require(path.join(WURZEL, 'scripts', 'studie-f6-vorfall.js'));

const eintrag = () => K.baueEintrag(
  '2026-09-01T19:00:00.000Z', '2026-09-01T21:00:00.000Z');

test('--force gibt es nicht (F6-B8)', () => {
  assert.throws(() => K.haupt(['--force']), /--force gibt es nicht/);
});

// ── F6-K7(c): der Abbruchtext, aus dem QUELLTEXT rekonstruiert ────────────
test('der beurkundete Abbruchtext ist byte-genau der des Laeufers', () => {
  const quelle = fs.readFileSync(LAEUFER, 'utf8');
  // Der raise-Block des Wachpostens: die aneinandergereihten String-Literale.
  const start = quelle.indexOf('"ABSOLUTER PFAD IM BERICHT bei "');
  assert.ok(start > 0, 'der raise-Block wurde nicht gefunden');
  // Das Ende NACH dem Start suchen: "basisraten.py:251" steht auch weiter oben
  // im Docstring von kurzpfad, und ein Ende vor dem Start ergibt einen leeren
  // Block - die erste Fassung dieser Probe ist genau daran gescheitert.
  const endeMarke = quelle.indexOf('basisraten.py:251', start);
  assert.ok(endeMarke > start, 'das Ende des raise-Blocks liegt nicht hinter seinem Anfang');
  const block = quelle.slice(start, quelle.indexOf('\n', endeMarke));
  const stuecke = (block.match(/"([^"]*)"/g) || []).map((s) => s.slice(1, -1));
  // `wo` ist die Einsetzstelle; im Vorfall trug sie diesen Wert.
  const rekonstruiert = `F6-LAUF-ABBRUCH: ${stuecke.join('').replace(
    'ABSOLUTER PFAD IM BERICHT bei ', 'ABSOLUTER PFAD IM BERICHT bei bericht.umschlag.gelesenePfade[10]')}`;
  assert.strictEqual(K.ABBRUCHTEXT, rekonstruiert,
    'die Abschrift weicht vom Quelltext ab - genau das darf bei einem '
    + '"byte-genau" befohlenen Zitat nie passieren');
  assert.strictEqual(K.ABBRUCHTEXT.length, 246);
  // Und er ist ungekuerzt: der dritte Satz, den das Urteil weglaesst, steht drin.
  assert.match(K.ABBRUCHTEXT, /Es gilt die Kurzform Elternverzeichnis\/Datei/);
});

// ── F6-K9: R12a im Vermerk selbst, mit Bruchprobe ─────────────────────────
test('der Vermerk traegt keinen Nutzerpfad, und der Riegel feuert', () => {
  const e = eintrag();
  assert.doesNotThrow(() => K.pruefeR12a(e));
  assert.strictEqual(e.g_siegel.objekt, 'lauf-f6-konfirmatorisch-v2-2026-09-01/zwischenstand.sqlite');
  // GEBROCHEN: der volle Pfad, den der Vermerk gerade NICHT tragen darf.
  const BS = String.fromCharCode(92);
  assert.throws(() => K.pruefeR12a({ a: `C:${BS}Users${BS}Jemand${BS}f6-arbeit` }),
    /Windows-Laufwerkspfad/);
  assert.throws(() => K.pruefeR12a({ a: `${BS}Users${BS}Jemand` }),
    /Windows-Nutzerverzeichnis/);
});

// ── F6-K7: alle neun Pflichtinhalte ───────────────────────────────────────
test('alle neun Pflichtinhalte stehen im Vermerk', () => {
  const e = eintrag();
  for (const k of ['a_lauf', 'b_lesungVollzogen', 'c_abbruchtext', 'd_defekt',
    'e_blindheit', 'f_beschlussSperre', 'g_siegel', 'h_verlusteInEintrag28',
    'i_verhaltenDesAusfuehrenden']) {
    assert.ok(e[k], `Pflichtinhalt ${k} fehlt`);
  }
  // (a) die Zeitkette und der Exit-Code.
  assert.strictEqual(e.a_lauf.exitCode, 1);
  assert.strictEqual(e.a_lauf.gestartet, '2026-09-01T18:16:53Z');
  assert.strictEqual(e.a_lauf.abgebrochen, '2026-09-01T18:17:13Z');
  // (b) die Kerntatsache wird nicht kleingeschrieben.
  assert.match(e.b_lesungVollzogen, /LESUNG DES PRUEFFENSTER-PANELS WURDE VOLLZOGEN/);
  // (d) vorbestehend, mit Commit.
  assert.match(e.d_defekt.art, /VORBESTEHEND UND LATENT/);
  assert.match(e.d_defekt.herkunft, /347f0e8e0815a016f8f8fdd4fb83b15ac6f81867/);
  // (e) Anker statt Zusicherung.
  assert.ok(e.e_blindheit.anker.length >= 6);
  assert.match(e.e_blindheit.siebenKanaele, /sieben denkbaren Kanaele/);
  // (f) Beschluss-Sperre maximal.
  assert.match(e.f_beschlussSperre, /NICHTS IN DIESER AKTE/);
  // (g) das Siegel, inklusive des Satzes, was der Hash TUT.
  assert.strictEqual(e.g_siegel.groesseBytes, 146812928);
  assert.strictEqual(e.g_siegel.sha256, K.SIEGEL.sha256);
  assert.match(e.g_siegel.wasDerHashTUT, /SIEGELT BYTES UND LIEST KEINEN INHALT/);
  assert.match(e.g_siegel.nieGeoeffnet, /NIE GEOEFFNET/);
  assert.match(e.g_siegel.schemaDivergenzAufgeloest, /KORROBORATION/);
  // (h) Messung ohne Zaehlentscheid, OB-1 benannt.
  assert.match(e.h_verlusteInEintrag28.form, /OHNE ZAEHLENTSCHEID/);
  assert.match(e.h_verlusteInEintrag28.ob1, /OHNE BESCHLUSS/);
  assert.match(e.h_verlusteInEintrag28.keineErlaubnis, /KEINE ERLAUBNIS/);
  // (i) nicht neu gefeuert.
  assert.match(e.i_verhaltenDesAusfuehrenden, /NICHT NEU GEFEUERT/);
  // F6-K5 Blind-Attest.
  assert.match(e.blindAttest, /KEINERLEI Information/);
});

// ── Die Art: ein Vermerk autorisiert NICHTS ───────────────────────────────
test('der Vermerk autorisiert nichts', () => {
  const e = eintrag();
  assert.strictEqual(e.typ, 'C0_REGELFREEZE');
  assert.deepStrictEqual(e.allowedOutputs, []);
  assert.strictEqual(e.erlaubt, 'Nichts. Kein Datenzugriff.');
  assert.match(e.verboten, /^Jede Berufung auf diesen Vermerk als Autorisierung eines Laufs/);
  assert.match(e.fenster[0], /kein Studienfenster/);
  assert.match(e.endtestSiegel, /UNVERBRAUCHT/);
});

// ── F6-K4: der Waechter haengt am SIEGEL, nicht an einem Satz darueber ────
test('das versiegelte Objekt ist unveraendert (nur Metadaten, nie geoeffnet)', () => {
  const ziel = path.join(path.dirname(WURZEL), '..', '..', 'f6-arbeit',
    'lauf-f6-konfirmatorisch-v2-2026-09-01', 'zwischenstand.sqlite');
  if (!fs.existsSync(ziel)) return;          // auf CI nicht vorhanden - kein Befund
  // NUR fstat. Kein open, kein read, kein Hash.
  const st = fs.statSync(ziel);
  assert.strictEqual(st.size, K.SIEGEL.groesseBytes,
    'die Groesse des versiegelten Objekts hat sich geaendert (F6-K4)');
  assert.strictEqual(new Date(st.mtime).toISOString().slice(0, 19),
    K.SIEGEL.schreibzeit.slice(0, 19),
    'die Schreibzeit des versiegelten Objekts hat sich geaendert (F6-K4)');
});

// ── Kettenende und Trockenlauf ────────────────────────────────────────────
test('der Trockenlauf schreibt nichts und haengt an der richtigen Kette', () => {
  const vorher = crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex');
  const echt = process.stdout.write;
  let aus = '';
  process.stdout.write = (s) => { aus += s; return true; };
  try { K.haupt([]); } finally { process.stdout.write = echt; }
  assert.strictEqual(
    crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex'), vorher);
  assert.match(aus, /TROCKENLAUF - es wurde NICHTS geschrieben/);
  assert.match(aus, new RegExp(`"previousHash": "${K.ERWARTETER_TAIL}"`));
});
