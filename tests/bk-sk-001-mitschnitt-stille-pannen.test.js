'use strict';
/**
 * BK-SK-001 (Block 5, Verifikation 2026-08-03) — die drei stillen Pannen der
 * beiden JSONL-Mitschnitte (Ticker-Landkarte + Newcomer-Log).
 *
 * Warum diese drei zusammen einen Waechter bekommen: alle drei fuehren dazu, dass
 * ein FALSCHER Stand als richtiger Stand gelesen wird, ohne dass irgendwo etwas rot
 * wird. Und beide Mitschnitte sind nicht nachtraeglich reparierbar — NASDAQ/SEC
 * ueberschreiben ihre Verzeichnisse taeglich.
 *
 *  (1) Kaputte JSONL-Zeile: `catch (_) {}` uebersprang sie voellig stumm
 *      (snapshot-ticker-map.js alleZeilen, write-newcomer-log.js bisherigeZeilen).
 *      Ein verlorener Tag sah aus wie ein Tag ohne Aenderungen.
 *  (2) `pruefsumme` wurde je Tageszeile GESCHRIEBEN, aber nie GELESEN. Genau ihr
 *      Zweck ("ergibt mein Abspielen denselben Stand?") war nie in Betrieb.
 *  (3) Ein einmal verdorbenes Grundbild verdirbt JEDES spaetere Abspielen, fuer
 *      immer. Monats-Rotation begrenzt den Schaden auf den laufenden Monat; das
 *      alte Bild wird vorher als NEUE Datei ins Archiv kopiert (nichts geloescht).
 *
 * Standalone-Runner, kein Netz, nur Temp-Verzeichnisse: node tests/bk-sk-001-mitschnitt-stille-pannen.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const T = require('../scripts/snapshot-ticker-map.js');
const N = require('../scripts/write-newcomer-log.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/** Faengt alles ab, was das Skript nach stdout/stderr schreibt. */
function mitProtokoll(fn) {
  const zeilen = [];
  const echt = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(echt)) console[k] = (...a) => zeilen.push(a.join(' '));
  try { var wert = fn(); } finally { Object.assign(console, echt); }
  return { wert, text: zeilen.join('\n') };
}

const tmp = (praefix) => fs.mkdtempSync(path.join(os.tmpdir(), praefix));
const summe = (schluessel) =>
  crypto.createHash('sha256').update([...schluessel].sort().join(',')).digest('hex').slice(0, 16);

// ── (1) Kaputte Zeile: warnen statt stumm ueberspringen ─────────────────────
check('Ticker-Landkarte: eine kaputte JSONL-Zeile warnt MIT Datei und Zeilennummer', () => {
  const dir = tmp('bk1-');
  fs.writeFileSync(path.join(dir, '2026-07.jsonl'), [
    '{"datum":"2026-07-01","hinzu":{},"weg":[],"geaendert":{}}',
    '{ kaputt',
    '{"datum":"2026-07-02","hinzu":{},"weg":[],"geaendert":{}}',
  ].join('\n') + '\n');
  const { wert, text } = mitProtokoll(() => T.alleZeilen(dir));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(wert.length, 2, 'die heilen Zeilen muessen weiter durchkommen (Rest laeuft)');
  assert.match(text, /::warning::/, 'die kaputte Zeile blieb stumm — genau der Befund');
  assert.match(text, /2026-07\.jsonl/, 'die Warnung muss die Datei benennen');
  assert.match(text, /:2\b/, 'die Warnung muss die Zeilennummer (2) benennen');
});

check('Newcomer-Log: eine kaputte JSONL-Zeile warnt MIT Datei und Zeilennummer', () => {
  const dir = tmp('bk2-');
  fs.writeFileSync(path.join(dir, '2026-07.jsonl'), [
    '{"date":"2026-07-01","members":["AAA"]}',
    'auch kaputt',
    '{"date":"2026-07-02","members":["AAA","BBB"]}',
  ].join('\n') + '\n');
  const { wert, text } = mitProtokoll(() => N.bisherigeZeilen(dir));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(wert.length, 2, 'die heilen Zeilen muessen weiter durchkommen');
  assert.match(text, /::warning::/, 'die kaputte Zeile blieb stumm — genau der Befund');
  assert.match(text, /2026-07\.jsonl/, 'die Warnung muss die Datei benennen');
  assert.match(text, /:2\b/, 'die Warnung muss die Zeilennummer (2) benennen');
});

// ── (2) pruefsumme beim Abspielen nachrechnen ───────────────────────────────
const GRUNDBILD_FIX = { A: { n: 'A AG', b: 'Q' }, B: { n: 'B AG', b: 'Q' } };

check('Abspielen: eine NICHT passende pruefsumme warnt (statt still einen falschen Stand zu liefern)', () => {
  const zeilen = [
    { datum: '2026-07-10', hinzu: { C: { n: 'C AG', b: 'N' } }, weg: [], geaendert: {},
      pruefsumme: 'deadbeefdeadbeef' },
  ];
  const { wert, text } = mitProtokoll(() => T.zustandAus(GRUNDBILD_FIX, zeilen));
  assert.deepEqual([...wert.keys()].sort(), ['A', 'B', 'C'], 'der Stand kommt trotzdem (Warnung, kein Abbruch)');
  assert.match(text, /::warning::/, 'die Abweichung blieb stumm — pruefsumme wurde nie gelesen');
  assert.match(text, /2026-07-10/, 'die Warnung muss den betroffenen Tag benennen');
});

check('GEGENPROBE: eine PASSENDE pruefsumme loest keine Warnung aus', () => {
  const zeilen = [
    { datum: '2026-07-10', hinzu: { C: { n: 'C AG', b: 'N' } }, weg: [], geaendert: {},
      pruefsumme: summe(['A', 'B', 'C']) },
  ];
  const { text } = mitProtokoll(() => T.zustandAus(GRUNDBILD_FIX, zeilen));
  assert.ok(!/::warning::/.test(text), 'eine passende Summe darf nicht warnen: ' + text);
});

check('GEGENPROBE: Zeilen ganz OHNE pruefsumme (Altbestand) warnen nicht', () => {
  const zeilen = [{ datum: '2026-07-10', hinzu: {}, weg: [], geaendert: {} }];
  const { text } = mitProtokoll(() => T.zustandAus(GRUNDBILD_FIX, zeilen));
  assert.ok(!/::warning::/.test(text), 'Altzeilen ohne Summe duerfen kein Rauschen erzeugen: ' + text);
});

check('die geschriebene und die nachgerechnete Summe stammen aus DERSELBEN Funktion', () => {
  // Zwei getrennte Formeln driften irgendwann auseinander und die Warnung wird zum
  // Dauerrauschen (oder verstummt). Beide Seiten muessen denselben Helfer benutzen.
  const src = fs.readFileSync(require.resolve('../scripts/snapshot-ticker-map.js'), 'utf8');
  const treffer = src.match(/createHash\('sha256'\)/g) || [];
  assert.equal(treffer.length, 1,
    'sha256 wird an ' + treffer.length + ' Stellen gebildet — Schreiben und Nachrechnen muessen sich EINE Stelle teilen');
});

// ── (3) Monats-Rotation des Grundbilds mit Archiv-Kopie ─────────────────────
check('Rotation: altes Grundbild landet als NEUE Datei im Archiv, nichts wird geloescht', () => {
  const dir = tmp('bk3-');
  const alt = { ab: '2026-07-01', symbole: { A: { n: 'A AG', b: 'Q' } } };
  fs.writeFileSync(path.join(dir, '_grundbild.json'), JSON.stringify(alt));
  const neu = new Map([['A', { n: 'A AG', b: 'Q' }], ['C', { n: 'C AG', b: 'N' }]]);
  const { wert } = mitProtokoll(() => T.rotiereGrundbild(neu, '2026-08-03', dir));
  assert.ok(wert, 'im neuen Monat MUSS rotiert werden');
  const archivDatei = path.join(dir, 'archiv', fs.readdirSync(path.join(dir, 'archiv'))[0]);
  const archiviert = JSON.parse(fs.readFileSync(archivDatei, 'utf8'));
  assert.deepEqual(archiviert, alt, 'die Archiv-Kopie muss das ALTE Bild unveraendert enthalten');
  const jetzt = JSON.parse(fs.readFileSync(path.join(dir, '_grundbild.json'), 'utf8'));
  assert.equal(jetzt.ab, '2026-08-03', 'das neue Bild muss sagen, AB WANN es gilt');
  assert.deepEqual(Object.keys(jetzt.symbole).sort(), ['A', 'C']);
  fs.rmSync(dir, { recursive: true, force: true });
});

check('Rotation ist idempotent: im selben Monat wird NICHT erneut rotiert', () => {
  const dir = tmp('bk4-');
  fs.writeFileSync(path.join(dir, '_grundbild.json'),
    JSON.stringify({ ab: '2026-08-01', symbole: { A: { n: 'A AG', b: 'Q' } } }));
  const { wert } = mitProtokoll(() => T.rotiereGrundbild(new Map([['Z', { n: 'Z', b: 'Q' }]]), '2026-08-03', dir));
  assert.equal(wert, null, 'ein zweiter Lauf im selben Monat darf das Bild nicht erneut ersetzen');
  const jetzt = JSON.parse(fs.readFileSync(path.join(dir, '_grundbild.json'), 'utf8'));
  assert.deepEqual(Object.keys(jetzt.symbole), ['A'], 'das Bild dieses Monats bleibt unangetastet');
  assert.ok(!fs.existsSync(path.join(dir, 'archiv')), 'ohne Rotation entsteht auch keine Archiv-Kopie');
  fs.rmSync(dir, { recursive: true, force: true });
});

check('nach der Rotation ueberspringt das Abspielen die Zeilen der VORGAENGER-Aera', () => {
  // Die Juli-Zeile MUSS das Ergebnis veraendern, wenn sie faelschlich mitlaeuft —
  // sonst prueft dieser Waechter nichts (sie loescht A und bringt X mit).
  const gb = { ab: '2026-08-01', symbole: { A: { n: 'A AG', b: 'Q' }, C: { n: 'C AG', b: 'N' } } };
  const zeilen = [
    { datum: '2026-07-10', hinzu: { X: { n: 'X AG', b: 'Q' } }, weg: ['A'], geaendert: {} }, // Vorgaenger-Aera
    { datum: '2026-08-02', hinzu: { D: { n: 'D AG', b: 'Q' } }, weg: [], geaendert: {} },
  ];
  const { wert } = mitProtokoll(() => T.zustandAus(gb, zeilen));
  assert.deepEqual([...wert.keys()].sort(), ['A', 'C', 'D'],
    'Juli-Zeilen gehoeren zum archivierten Vorgaenger und duerfen nicht ein zweites Mal angewandt werden');
});

check('ein Abspielen VOR der Grundbild-Grenze warnt, statt still den falschen Stand zu liefern', () => {
  const gb = { ab: '2026-08-01', symbole: { A: { n: 'A AG', b: 'Q' } } };
  const { text } = mitProtokoll(() => T.zustandAus(gb, [], '2026-07-15'));
  assert.match(text, /::warning::/,
    'ein Stichtag vor der Grenze braucht das archivierte Vorgaenger-Bild — stilles Antworten waere der schlimmere Fehler');
});

check('GEGENPROBE: die alte Rohform (Symbol->Datensatz, kein `ab`) wird weiter gelesen', () => {
  // Das committete _grundbild.json ist die Rohform. Ein Leser, der nur noch die
  // Wickelform kennt, wuerde es als "leeres Bild" lesen — also alles als Neuzugang.
  const { wert } = mitProtokoll(() => T.zustandAus(GRUNDBILD_FIX, []));
  assert.deepEqual([...wert.keys()].sort(), ['A', 'B']);
});

check('das echte, committete Grundbild bleibt mit diesem Code lesbar', () => {
  const echt = path.join(__dirname, '..', 'external-data', 'ticker-map', '_grundbild.json');
  if (!fs.existsSync(echt)) { console.log('       (kein committetes Grundbild vorhanden — uebersprungen)'); return; }
  const roh = JSON.parse(fs.readFileSync(echt, 'utf8'));
  const { wert } = mitProtokoll(() => T.zustandAus(roh, []));
  assert.ok(wert.size > 5000, 'das echte Grundbild muss weiterhin > 5000 Symbole ergeben, ist aber ' + wert.size);
});

check('der Tageslauf committet auch das Grundbild-Archiv', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
  assert.ok(wf.includes('git add external-data/ticker-map/'),
    'ohne den Pfad im git add bleibt die Archiv-Kopie auf dem Runner liegen und ist mit ihm weg');
});

console.log('\nGeprueft: scripts/snapshot-ticker-map.js (alleZeilen, zustandAus, rotiereGrundbild) '
  + '+ scripts/write-newcomer-log.js (bisherigeZeilen) + das committete _grundbild.json '
  + '+ der git-add-Pfad in daily-pull.yml.');
console.log('bk-sk-001: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
