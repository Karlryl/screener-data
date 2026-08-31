'use strict';

// F6-SE-KLUMPEN/v1 - der Waechter der Rechenvorschrift des klumpen-robusten SE.
// _COURT-F6-VOLLZUG-2026-08-31, Wortlaut Ziffer 10, Auflage F6-B23
// (ratifiziert Session 07, 2026-08-31 22:19 lokal).
//
// DER WAECHTER PINNT DIE RECHNUNG, NICHT IHREN TEXT: jede Aussage hier wird an
// einem Aufruf der CLI gemessen, und das Handfixture (T2) steht gegen ein
// AUSGESCHRIEBENES LITERAL (0,25), nicht gegen eine zweite Implementierung
// derselben Formel. Eine zweite Implementierung wuerde denselben Fehler
// zweimal machen und beide Male gruen leuchten.
//
// WAS DIESER TEST NICHT TUT: er kennt kein Messergebnis. Alle Zahlen sind
// gesetzte Rechenbeispiele; keine stammt aus einem Lauf, aus data/, aus einer
// Lueckenliste oder aus einem Prueffenster.
//
// BRUCHPROBE (F6-B23, vor "fertig" gefahren und im PR-Text protokolliert):
// den Faktor G/(G-1) einmal entfernen -> T1 UND T4 muessen beide rot werden.
//
// Usage: node tests/studie-f6-klumpen-se.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const wurzel = path.join(__dirname, '..');
const skript = path.join(wurzel, 'scripts', 'studie-f6-klumpen-se.py');
const bandSkript = path.join(wurzel, 'scripts', 'studie-vb-b4-band.py');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-klumpen-se-'));

let lfd = 0;
function tafel(inhalt) {
  const datei = path.join(tmp, `klumpen-${lfd += 1}.json`);
  fs.writeFileSync(datei, typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt), 'utf8');
  return datei;
}

function ruf(inhalt, n, zaehler) {
  return spawnSync(python, [skript, 'se', '--klumpen', tafel(inhalt),
    '--n', String(n), '--zaehler', String(zaehler)], { encoding: 'utf8' });
}

// Der Normalweg: Ausgabe ist JSON und traegt GENAU die fuenf registrierten
// Schluessel (Wortlaut Ziffer 9; die Residuenquadratsumme bleibt draussen,
// F6-B14).
function se(inhalt, n, zaehler) {
  const r = ruf(inhalt, n, zaehler);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const wert = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(wert).sort(),
    ['anteil', 'klumpen_anzahl', 'n', 'se_klumpen_robust', 'zaehler'],
    'die Ausgabeflaeche ist eingefroren - kein sechster Schluessel');
  return wert;
}

// Der Abbruchweg. Er ist erst dann ein Abbruch, wenn er als FEHLSCHLAG an der
// Oberflaeche ankommt: Exit-Code ungleich 0 UND kein Wert auf stdout. Ein
// Abbruch, der still eine Zahl zurueckgibt, waere genau der von der Bandregel
// 4:0 verbotene Rueckfall auf den kleineren SE.
function abbruch(inhalt, n, zaehler, warum) {
  const r = ruf(inhalt, n, zaehler);
  assert.notEqual(r.status, 0, `${warum}: haette abbrechen muessen, lieferte ${r.stdout}`);
  assert.equal(r.stdout.trim(), '', `${warum}: ein Abbruch darf KEINEN Wert ausgeben`);
  return r.stderr;
}

const wurzelVon = (x) => Math.sqrt(x);
const seBinomial = (p, n) => wurzelVon((p * (1 - p)) / n);

// ── Selbsttest der Vorschrift (Hausmuster) ───────────────────────────────────
const selbst = spawnSync(python, [skript, 'selbsttest'], { encoding: 'utf8' });
assert.equal(selbst.status, 0, selbst.stdout + selbst.stderr);
assert.match(selbst.stdout, /selbsttest: \d+ ok, 0 FAIL/);
for (const probe of [
  'Handfixture (2,3),(1,1),(0,2) -> se = 0,25 exakt',
  'Ausgabe traegt genau fuenf Schluessel, keinen sechsten',
  'die Residuenquadratsumme geht NICHT hinaus (F6-B14)',
  'Entartungsfall: se = Wurzel(p(1-p)/(N-1)) auf 1e-15',
  'Entartungsfall: se/se_binomial = Wurzel(N/(N-1))',
  'Abbruch bei G < 2 (ein einziger Klumpen)',
  'G < 2 liefert KEINE Null, sondern gar nichts',
  'Abbruch: bool ist keine Zahl (True ginge sonst als 1 durch)',
  'Abbruch: NaN und inf werden POSITIV ausgeschlossen',
]) {
  assert.ok(selbst.stdout.includes(`ok   ${probe}`), `Probe fehlt oder rot: ${probe}`);
}

// ── T1: Gleichheits-Anker im Entartungsfall ──────────────────────────────────
// Alle n_g = 1 (dann G = N) -> se == Wurzel(p(1-p)/(N-1)) auf 1e-15 UND
// se/se_binomial == Wurzel(N/(N-1)). Das ist die exakte Identitaet, an der die
// Wahl des Faktors G/(G-1) haengt: ohne ihn ist das Verhaeltnis 1.
{
  const N = 40;
  const M = 26;
  const einzel = Array.from({ length: N }, (_, i) => (i < M ? [1, 1] : [0, 1]));
  const r = se(einzel, N, M);
  const p = M / N;
  assert.equal(r.klumpen_anzahl, N, 'T1: bei lauter Einer-Klumpen ist G = N');
  assert.ok(Math.abs(r.se_klumpen_robust - wurzelVon((p * (1 - p)) / (N - 1))) < 1e-15,
    'T1: der Schaetzer kollabiert auf die (N-1)-Fassung des binomialen SE');
  assert.ok(Math.abs(r.se_klumpen_robust / seBinomial(p, N) - wurzelVon(N / (N - 1))) < 1e-15,
    'T1: das Verhaeltnis ist exakt Wurzel(N/(N-1))');
  // Und er liegt NIE darunter - SE* faellt hier konstruktiv auf den
  // klumpen-robusten (F6-B25, vorab benannt, nie hinterher als Befund).
  assert.ok(r.se_klumpen_robust > seBinomial(p, N), 'T1: nie unter dem binomialen SE');
}

// ── T2: Handfixture gegen ausgeschriebene Literale ───────────────────────────
// (m,n) = (2,3), (1,1), (0,2) -> N = 6, G = 3, p-Dach = 0,5,
// Residuen 0,5 / 0,5 / -1, S = 1,5 -> se = Wurzel((3/2) * 1,5)/6 = 1,5/6.
{
  const r = se([[2, 3], [1, 1], [0, 2]], 6, 3);
  assert.equal(r.se_klumpen_robust, 0.25, 'T2: das Literal ist 0,25, exakt');
  assert.equal(r.anteil, 0.5);
  assert.equal(r.klumpen_anzahl, 3);
  assert.equal(r.n, 6);
  assert.equal(r.zaehler, 3);
  // Das zweite ausgeschriebene Literal des Urteils, gegengerechnet.
  assert.equal(seBinomial(0.5, 6), 0.20412414523193151,
    'T2: se_binomial des Fixtures ist das Literal aus dem Wortlaut');
  assert.ok(r.se_klumpen_robust > 0.20412414523193151,
    'T2: der Klumpen-SE liegt ueber dem binomialen');
}

// ── T3: Klumpen-Anker ────────────────────────────────────────────────────────
// n_g = 2, perfekt korreliert (m_g in {0,2}) -> Verhaeltnis^2 = 2G/(G-1),
// und ein echter 2er-Klumpen liefert STRIKT mehr als der binomiale SE.
{
  const G = 25;
  const eins = 15;
  const zweier = Array.from({ length: G }, (_, i) => (i < eins ? [2, 2] : [0, 2]));
  const r = se(zweier, 2 * G, 2 * eins);
  const p = (2 * eins) / (2 * G);
  const verhaeltnis2 = (r.se_klumpen_robust / seBinomial(p, 2 * G)) ** 2;
  assert.ok(Math.abs(verhaeltnis2 - (2 * G) / (G - 1)) < 1e-12,
    `T3: Verhaeltnis^2 muss 2G/(G-1) sein, war ${verhaeltnis2}`);
  assert.ok(r.se_klumpen_robust > seBinomial(p, 2 * G),
    'T3: ein echter 2er-Klumpen liegt strikt ueber dem binomialen SE');
}

// ── T4: G = 1 und die Einheit ohne Klumpen-Kennung ───────────────────────────
// Beide brechen ab - und der Abbruch kommt als FEHLSCHLAG an, nie als Wert.
// Ohne den Faktor G/(G-1) waere der erste Fall eine stille Null (alle Residuen
// sind bei G = 1 per Konstruktion 0): genau der verbotene Rueckfall.
{
  const stderrG1 = abbruch([[3, 6]], 6, 3, 'T4: G = 1');
  assert.match(stderrG1, /G = 1 < 2/, 'T4: der Grund wird benannt');
  assert.match(stderrG1, /Kein Rueckfall auf den kleineren SE/,
    'T4: die Folge steht im Klartext');
  abbruch([[0, 4]], 4, 0, 'T4: G = 1 mit p-Dach = 0 (die stille Null)');

  // Eine Nennereinheit ohne genau eine Klumpen-Kennung: die Tafel deckt 6 der
  // 7 gemeldeten Einheiten. Sie wird NIE stillschweigend fallengelassen.
  const stderrOhne = abbruch([[2, 3], [1, 1], [0, 2]], 7, 3,
    'T4: eine Einheit ohne Klumpen-Kennung');
  assert.match(stderrOhne, /keine Klumpen-Kennung|weicht vom berichteten N/,
    'T4: der Grund benennt die fehlende Klumpen-Kennung');

  // Und die anschliessende b4-Kette liefert NICHT UNTERSCHEIDBAR, nie ein
  // Ergebnis: ohne --se-klumpen reisst der Zulaessigkeits-Gate. Das Band-Modul
  // wird dabei nur GELESEN - es bleibt Byte fuer Byte unangetastet (F6-B22).
  const kette = spawnSync(python, [bandSkript, 'auswerten', '--ergebnis', '0.95',
    '--n', '400', '--se-binomial', '0.01'], { encoding: 'utf8' });
  assert.equal(kette.status, 0, kette.stdout + kette.stderr);
  assert.match(kette.stdout, /^Verdikt : NICHT UNTERSCHEIDBAR$/m,
    'T4: ein fehlender Klumpen-SE ergibt NICHT UNTERSCHEIDBAR');
  assert.match(kette.stdout, /^WEITER {2}: 0$/m, 'T4: WEITER = 0');
  assert.match(kette.stdout, /Kein Rueckfall auf den kleineren SE/,
    'T4: und ausdruecklich kein Rueckfall');
}

// ── T5: Kreuzproben ──────────────────────────────────────────────────────────
// --n bzw. --zaehler abweichend von Summe n_g bzw. Summe m_g -> Abbruch.
{
  assert.match(abbruch([[2, 3], [1, 1], [0, 2]], 5, 3, 'T5: N zu klein'),
    /Summe_g n_g = 6 weicht vom berichteten N = 5 ab/);
  assert.match(abbruch([[2, 3], [1, 1], [0, 2]], 6, 4, 'T5: Zaehler falsch'),
    /Summe_g m_g = 3 weicht vom berichteten Zaehler = 4 ab/);
  // Die Gegenprobe: mit den richtigen Kreuzproben geht dieselbe Tafel durch.
  assert.equal(se([[2, 3], [1, 1], [0, 2]], 6, 3).se_klumpen_robust, 0.25);
}

// ── T6: entartete Eingaben und Reihenfolge-Invarianz ─────────────────────────
{
  // bool: `true` ist in Python ein int und ginge ohne den positiven Ausschluss
  // als 1 durch.
  abbruch([[true, 1], [0, 1]], 2, 1, 'T6: bool als m_g');
  abbruch([[1, true], [0, 1]], 2, 1, 'T6: bool als n_g');
  // NaN/inf reisen durch json.load glatt hindurch - der Ausschluss muss im
  // Modul stehen, nicht im Parser.
  abbruch('[[NaN, 1], [0, 1]]', 2, 0, 'T6: NaN als m_g');
  abbruch('[[1, Infinity], [0, 1]]', 2, 1, 'T6: inf als n_g');
  abbruch('[[-Infinity, 2], [0, 1]]', 3, 1, 'T6: -inf als m_g');
  // negativ und m_g > n_g
  abbruch([[-1, 2], [1, 1]], 3, 0, 'T6: negatives m_g');
  abbruch([[0, -2], [1, 1]], -1, 1, 'T6: negatives n_g');
  abbruch([[3, 2], [1, 1]], 3, 4, 'T6: m_g > n_g');
  abbruch([[1.5, 3], [1, 1]], 4, 2.5, 'T6: m_g ist keine ganze Zahl');
  // Eine Firmen-Kennung kann gar nicht erst hinein: das Modul nimmt Paare.
  abbruch([{ cik: 320193, m: 1, n: 1 }, [0, 1]], 2, 1, 'T6: Objekt statt Paar');
  abbruch([[1, 1, 320193], [0, 1]], 2, 1, 'T6: Tripel statt Paar');

  // Reihenfolge-Invarianz, bit-gleich an der ROHEN Ausgabe gemessen: fsum ist
  // exakt gerundet, eine gemischte Klumpenliste darf sich in keiner Stelle
  // unterscheiden.
  const sortiert = [[2, 3], [2, 3], [1, 2], [1, 2], [0, 2], [0, 1], [1, 1]];
  const gemischt = [[0, 1], [1, 2], [2, 3], [0, 2], [1, 1], [2, 3], [1, 2]];
  const a = ruf(sortiert, 14, 7);
  const b = ruf(gemischt, 14, 7);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.equal(a.stdout, b.stdout, 'T6: gemischte Reihenfolge, bit-gleiche Ausgabe');
  // Gegenprobe an der SACHE: die Tafel ist wirklich gemischt und nicht
  // versehentlich dieselbe Liste.
  assert.notEqual(JSON.stringify(sortiert), JSON.stringify(gemischt));
}

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write('studie-f6-klumpen-se.test.js: T1-T6 gruen\n');
