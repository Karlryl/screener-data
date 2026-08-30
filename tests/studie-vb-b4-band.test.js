'use strict';

// VB-A9..VB-A13 (B4, die Bandregel des F6-Tors) - _COURT-VIERBANK-OFFEN23-2026-08-30,
// ratifiziert als ENTSCHIED 136.
//
// Der Waechter pinnt die REGEL, nicht ihren Text: jede Aussage hier wird an
// einem Aufruf der Rechenvorschrift gemessen. Wer die Regel spaeter senkt -
// das Band oeffnet, den Zulaessigkeits-Gate weich macht, auf den kleineren SE
// zurueckfaellt, den Bezugspunkt wechselt oder das Endtest-Siegel bei
// BESTANDEN oeffnet -, faellt hier auf.
//
// WAS DIESER TEST NICHT TUT: er kennt kein Messergebnis. Alle Zahlen sind
// gesetzte Rechenbeispiele; keine stammt aus einem Lauf.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const wurzel = path.join(__dirname, '..');
const skript = path.join(wurzel, 'scripts', 'studie-vb-b4-band.py');
const artefaktPfad = path.join(wurzel, 'protocol', 'early-detection', '2.1.0',
  'b4-bandregel-2026-08-30.json');

const selbst = spawnSync(python, [skript, 'selbsttest'], { encoding: 'utf8' });
assert.equal(selbst.status, 0, selbst.stdout + selbst.stderr);
assert.match(selbst.stdout, /selbsttest: \d+ ok, 0 FAIL/);

for (const probe of [
  'SE* nimmt den groesseren der beiden',
  'Gleichheit zaehlt INS Band (geschlossen, <=)',
  'GEGENPROBE: ein Hauch ueber der Bandkante ist BESTANDEN',
  'keine Rundung vor dem Vergleich',
  'kein Rueckfall auf den kleineren SE',
  'negative Intra-Block-Korrelation kippt nichts (max bleibt max)',
  'WEITER ist binaer, nie etwas dazwischen',
  'genau EIN Zweig hat WEITER = 1',
  // Nach dem Python-Review vom 30.08.: NaN und inf umgingen den
  // Zulaessigkeits-Gate und erzeugten ein BESTANDEN.
  'entartete Eingabe n = NaN -> nie ein Pass, kein Absturz',
  'entartete Eingabe n = inf -> nie ein Pass, kein Absturz',
  'entartete Eingabe n = True (bool ist ein int) -> nie ein Pass, kein Absturz',
  'entartete Eingabe Ergebnis = True (bool ist ein int) -> nie ein Pass, kein Absturz',
  'entartete Eingabe Ergebnis = NaN -> nie ein Pass, kein Absturz',
  'entartete Eingabe Ergebnis negativ -> nie ein Pass, kein Absturz',
  'entartete Eingabe Ergebnis > 1 -> nie ein Pass, kein Absturz',
  'GEGENPROBE: saubere Zahlen gehen durch den Gate',
  'se_binomial rechnet die registrierte Streuungsgroesse nach',
  'entartete Eingabe SE = 10**400 (int ohne Groessengrenze) -> nie ein Pass, kein Absturz',
  'entartete Eingabe n = 10**400 -> nie ein Pass, kein Absturz',
  'Wilson-Intervall steht in jedem Zweig',
  'Artefakt: der Freeze-Akt ist NICHT vollzogen',
  'Artefakt: das Siegel bleibt in ALLEN drei Zweigen zu',
]) {
  assert.ok(selbst.stdout.includes(`ok   ${probe}`), `Probe fehlt oder rot: ${probe}`);
}

// -- Die Regel, ueber den echten Eintrittspunkt gefahren --------------------
function auswerten(ergebnis, n, seB, seK) {
  const argv = [skript, 'auswerten', '--ergebnis', String(ergebnis), '--n', String(n)];
  if (seB !== null) argv.push('--se-binomial', String(seB));
  if (seK !== null) argv.push('--se-klumpen', String(seK));
  const r = spawnSync(python, argv, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const zeile = (feld) => (r.stdout.match(new RegExp(`^${feld}\\s*:\\s*(.*)$`, 'm')) || [])[1];
  return { verdikt: zeile('Verdikt').trim(), weiter: Number(zeile('WEITER')), roh: r.stdout };
}

// Drei erschoepfende Zweige, ZWEI Konsequenzen. n = 400 haelt den
// Zulaessigkeits-Gate offen; SE* = 0,02.
assert.equal(auswerten(0.95, 400, 0.01, 0.02).verdikt, 'BESTANDEN');
assert.equal(auswerten(0.95, 400, 0.01, 0.02).weiter, 1);
assert.equal(auswerten(0.905, 400, 0.01, 0.02).verdikt, 'NICHT UNTERSCHEIDBAR');
assert.equal(auswerten(0.905, 400, 0.01, 0.02).weiter, 0);
assert.equal(auswerten(0.80, 400, 0.01, 0.02).verdikt, 'NICHT BESTANDEN');
assert.equal(auswerten(0.80, 400, 0.01, 0.02).weiter, 0);

// Der Zulaessigkeits-Gate ist fail-closed und NIE ein Pass - auch nicht bei
// einem Ergebnis, das ohne ihn glatt bestanden haette.
for (const [name, n, seB, seK] of [
  ['n unter 200', 199, 0.001, 0.001],
  ['SE_binomial fehlt', 400, null, 0.001],
  ['SE_klumpen-robust fehlt', 400, 0.001, null],
]) {
  const r = auswerten(0.99, n, seB, seK);
  assert.equal(r.weiter, 0, `Zulaessigkeits-Gate (${name}) liess einen Pass durch`);
  assert.equal(r.verdikt, 'NICHT UNTERSCHEIDBAR');
  assert.match(r.roh, /Messgeraet|Zulaessigkeits-Gate gerissen/);
}

// Der Pflichtsatz steht im Bandzweig woertlich (VB-A10) - und NIE der Satz,
// den das Urteil ausdruecklich verbietet.
const band = auswerten(0.905, 400, 0.01, 0.02);
assert.ok(band.roh.includes(
  'Das Tor konnte bei dieser Fallzahl zwischen Bestehen und Nichtbestehen nicht unterscheiden.'));
assert.ok(!band.roh.includes('Effekt ist abwesend')
  || band.roh.includes("NIE: 'der Effekt ist abwesend'"));

// -- Das eingefrorene Artefakt ----------------------------------------------
const a = JSON.parse(fs.readFileSync(artefaktPfad, 'utf8'));

// Der Hash deckt genau den Inhalt, nach der Kanonisierung von Eintrag 22.
const hash = spawnSync(python, [skript, 'hash', '--datei', artefaktPfad],
  { encoding: 'utf8' });
assert.equal(hash.status, 0, hash.stdout + hash.stderr);
assert.match(hash.stdout, new RegExp(`inhaltSha256 gerechnet: ${a.inhaltSha256}`));
assert.match(hash.stdout, new RegExp('Datei-SHA-256\\s*:\\s*'
  + crypto.createHash('sha256').update(fs.readFileSync(artefaktPfad)).digest('hex')));

// VB-A9: erst dann eingefroren, wenn ALLE VIER Groessen mitgefroren sind.
assert.deepEqual(Object.keys(a.inhalt.vierGroessen).sort(),
  ['1_schwelle', '2_seRechenvorschrift', '3_klumpungseinheit', '4_bandbreite']);
assert.equal(a.inhalt.vierGroessen['1_schwelle'].wert, 0.9);
assert.equal(a.inhalt.vierGroessen['4_bandbreite'].wert, 1);
assert.equal(a.inhalt.zulaessigkeitsGate.fallzahlMin, 200);

// Der Bezugspunkt ist am Objekt festgestellt - und 329/365 ist NIRGENDS eine
// Schwelle. Das Zitat des Kanzlei-Befunds steht mit im Artefakt.
assert.match(a.inhalt.vierGroessen['1_schwelle'].anker, /preregistration\.json:88/);
assert.match(a.inhalt.vierGroessen['1_schwelle'].anker, /:134/);
assert.match(a.inhalt.vierGroessen['1_schwelle']['329von365'],
  /NIRGENDS als Schwelle registriert/);
assert.match(a.inhalt.vierGroessen['1_schwelle']['329von365'],
  /friedhof\.json:71/);
assert.match(a.inhalt.vierGroessen['1_schwelle']['329von365'],
  /NIE Entscheidungsgroesse/);

// OFFEN-A / ENTSCHIED 136: die Zwischenregel gilt und steht WOERTLICH drin.
const klumpen = a.inhalt.vierGroessen['3_klumpungseinheit'];
assert.equal(klumpen.gilt, 'Klumpung nach Signal-Entitaet (Firma)');
assert.match(klumpen.zwischenregelWoertlich, /1\.2\.0\/preregistration\.json:384/);
assert.match(klumpen.zwischenregelWoertlich, /replicates clustered by signal entity/);
assert.match(klumpen.zwischenregelWoertlich, /nach dem Blick ist sie unzulaessig/);
assert.match(klumpen.entschied136, /bis der F6-Register-Akt die endgueltige Einheit/);
assert.match(klumpen.entschied136, /Gegenzeichnung des Rates/);
assert.match(klumpen.failClosed, /startet F6 nicht/);

// Das Endtest-Siegel bleibt in ALLEN DREI Zweigen zu - auch bei BESTANDEN.
for (const zweig of ['BESTANDEN', 'NICHT UNTERSCHEIDBAR', 'NICHT BESTANDEN']) {
  assert.match(a.inhalt.endtestSiegel[zweig].siegel, /bleibt zu/,
    `Das Siegel wird im Zweig ${zweig} nicht mehr als geschlossen gefuehrt`);
  assert.match(a.inhalt.endtestSiegel[zweig].k2Kontingent, /verbraucht/);
}
assert.match(a.inhalt.endtestSiegel.BESTANDEN.siegel,
  /Zulassung, nie Ausloeser/);
assert.match(a.inhalt.endtestSiegel.BESTANDEN.siegel,
  /Karls Entschluesselungs-Freigabe/);
assert.match(a.inhalt.endtestSiegel.BESTANDEN.siegel, /RR-3\/K11/);
assert.match(a.inhalt.endtestSiegel['NICHT UNTERSCHEIDBAR'].siegel,
  /NICHT verbraucht/);
assert.match(a.inhalt.endtestSiegel['NICHT BESTANDEN'].siegel, /NICHT verbraucht/);
assert.match(a.inhalt.endtestSiegel.k2Grundsatz, /IST der F6-Lauf selbst/);

// VB-A11: der Freeze-Akt ist NICHT vollzogen, und warum, steht dabei.
assert.equal(a.freezeStatus.eingefroren, false);
assert.equal(a.freezeStatus.halter, 'Orchestrator');
assert.match(a.freezeStatus.warumHierNichtVollzogen, /E2-ABLEITUNGSREGEL/);
assert.ok(a.freezeStatus.nichtGetan.includes('F5, F5b und F6 bleiben gesperrt'));

// VB-A12: die Verbotsliste ist vollstaendig.
assert.equal(a.inhalt.verbotsliste.verboten.length, 6);
assert.ok(a.inhalt.verbotsliste.verboten.some((v) => /Kontingent EINS/.test(v)));
assert.ok(a.inhalt.verbotsliste.verboten.some((v) => /Bezugspunkt wechseln/.test(v)));
assert.ok(a.inhalt.verbotsliste.verboten.some((v) => /RR-8/.test(v)));

// Der stehende Vorbehalt bleibt stehen - B4 loest die Zange NICHT.
assert.match(a.inhalt.stehenderVorbehalt, /loest es ebenfalls nicht/);
assert.match(a.inhalt.preisschild, /8,5-14,5 Motortage/);

// BESCHLUSS-SPERRE: kein Satz dieses Artefakts sagt etwas ueber die Richtung
// einer kuenftigen Messung. Die publizierten Punktschaetzungen kommen hier
// nicht vor - weder als Zahl noch als Prognose.
const flach = JSON.stringify(a);
for (const verboten of ['90,4', '90.4', '89,32', '89.32']) {
  assert.ok(!flach.includes(verboten),
    `Das Artefakt traegt die gesperrte Zahl ${verboten}`);
}
// Die 0,42-0,51 SE DARF vorkommen - sie ist eine bereits publizierte
// Struktur-Angabe, keine Prognose (Beschluss-Sperre, Befund der Kanzlei zu
// S1s Selbstbindung). Sie steht hier ausschliesslich im stehenden Vorbehalt,
// und der sagt ausdruecklich, dass B4 die Zange NICHT aufloest.
assert.ok(a.inhalt.stehenderVorbehalt.includes('0,42-0,51 SE'));
assert.equal(flach.split('0,42-0,51').length - 1, 1,
  'die publizierte Struktur-Angabe steht mehr als einmal im Artefakt');

console.log('studie-vb-b4-band.test.js: PASS');
