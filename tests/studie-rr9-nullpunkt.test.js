'use strict';

// RR9-A2 (B3') + OFFEN-1 (B2-Trockenlauf) - _COURT-RR9-2026-08-30 / ENTSCHIED 127.
//
// Zwei Waechter leben hier, und beide pinnen ein OBJEKT, kein Textmuster:
//  1. B3' muss rot werden, sobald die zur Laufzeit geladene Allowlist von der
//     registrierten abweicht - in JEDER Richtung, auch bei blosser Umsortierung.
//  2. Der Trockenlauf darf das Verhaeltnis der Reifequoten nicht rechnen, und
//     zwar STRUKTURELL: der Codepfad, der es rechnen koennte, ist gar nicht da.
//     Wer ihn wieder hereinholt, faellt hier auf.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const skript = path.join(__dirname, '..', 'scripts', 'studie-rr9-nullpunkt.py');

const selbst = spawnSync(python, [skript, 'selbsttest'], { encoding: 'utf8' });
assert.equal(selbst.status, 0, selbst.stdout + selbst.stderr);
assert.match(selbst.stdout, /selbsttest: \d+ ok, 0 FAIL/);

for (const probe of [
  // Provenienz (RR9-A2 Schritt 1 + RR9-A3 Ziffer 1)
  'Provenienz: das Tripel ist seit dem Siegeln unveraendert',
  'Provenienz: der E3-Lauf lief unter genau diesem Tripel',
  'Provenienz: der Traeger der 326/365 ist GEMESSEN',
  'Provenienz: die Jahrgangs-Kette ist geschlossen',
  // B3' Dauer-Tripwire: Anwesenheit UND vier Abwesenheiten
  "B3': die registrierte Liste geht durch (Anwesenheit)",
  "ROT-PROBE B3'-1: ein geaenderter Eintrag -> BEERDIGEN",
  "ROT-PROBE B3'-2: umsortierte Liste -> BEERDIGEN",
  "ROT-PROBE B3'-3: keine geladene Liste -> BEERDIGEN",
  "ROT-PROBE B3'-4: verstellte Registrierung -> BEERDIGEN",
  // B2-Trockenlauf
  'B2: die Kennungen der beiden Kohorten ueberschneiden sich nicht',
  'B2: das Verhaeltnis ist NICHT gerechnet',
  'B2: der Bericht traegt keinerlei Quoten-Feld',
  'B2: die Fallzahl der eintretenden Kohorte bleibt UNGEMESSEN (F4)',
  'ROT-PROBE B2: ohne bestimmbare Kohorten kommt der Stoppsatz woertlich',
  'ROT-PROBE B2-Waechter: ein eingeschmuggeltes Quoten-Feld faellt auf',
]) {
  assert.ok(selbst.stdout.includes(`ok   ${probe}`), `Probe fehlt oder rot: ${probe}`);
}

// -- Der Blindheitskern, strukturell ----------------------------------------
// Nicht "das Verhaeltnis wird nicht gerechnet", sondern: der Code, der es
// rechnen koennte, ist im Modul nicht erreichbar. `arm_zaehlen` und
// `ampel_fuer` leben in studie-zaehlprobe.py, `erst_ereignisse` in
// studie-basisraten.py - keines davon darf dieses Modul aufrufen.
// Geprueft wird der AST, nicht der Text: Kommentare und Berichtstexte DUERFEN
// die verbotenen Namen nennen - sie erklaeren ja gerade, warum sie fehlen. Ein
// Textfilter hatte hier genau daran einen Fehlalarm; der Syntaxbaum kennt den
// Unterschied zwischen einer Nennung und einem Aufruf.
const namen = spawnSync(python, ['-c', [
  'import ast, io, json, sys',
  'src = io.open(sys.argv[1], encoding="utf-8").read()',
  'n = set()',
  'for k in ast.walk(ast.parse(src)):',
  '    if isinstance(k, ast.Name): n.add(k.id)',
  '    elif isinstance(k, ast.Attribute): n.add(k.attr)',
  '    elif isinstance(k, (ast.Import, ast.ImportFrom)):',
  '        n.update(a.name for a in k.names)',
  'print(json.dumps(sorted(n)))',
].join('\n'), skript], { encoding: 'utf8' });
assert.equal(namen.status, 0, namen.stderr);
const erreichbar = new Set(JSON.parse(namen.stdout));
for (const verboten of ['arm_zaehlen', 'ampel_fuer', 'erst_ereignisse',
  'auffindbarkeit', 'signale', 'kalibriere']) {
  assert.ok(!erreichbar.has(verboten),
    `Der Trockenlauf erreicht ${verboten} - damit waere das Verhaeltnis rechenbar`);
}

// Und das Berichts-Artefakt selbst traegt keine Quote.
const bericht = path.join(__dirname, '..', 'reports', 'studie',
  'RR9-B2-trockenlauf-2026-08-30.json');
if (fs.existsSync(bericht)) {
  const b = JSON.parse(fs.readFileSync(bericht, 'utf8'));
  assert.equal(b.verhaeltnis.gerechnet, false);
  assert.equal(b.fallzahlSchwelle, 200);
  assert.equal(b.fallzahlDerEintretendenKohorte.status, 'UNGEMESSEN');
  const flach = JSON.stringify(b);
  for (const verboten of ['"reifequote"', '"auffindbarkeit"', '"ratio"']) {
    assert.ok(!flach.includes(verboten), `Trockenlauf-Bericht traegt ${verboten}`);
  }
}

// -- Die Provenienz-Korrektur bleibt sichtbar --------------------------------
// Der gemessene Befund ist, dass die 326/365 auf S-G ruht und NICHT auf der
// umsatzQuellenAllowlist. Wer den Bericht spaeter glattzieht, faellt hier auf.
const prov = path.join(__dirname, '..', 'reports', 'studie',
  'RR9-A2-provenienz-2026-08-30.json');
if (fs.existsSync(prov)) {
  const p = JSON.parse(fs.readFileSync(prov, 'utf8'));
  assert.equal(p.tripelUnveraendertSeitDemSiegeln, true);
  assert.equal(p.e3LiefUnterDemTripel, true);
  assert.equal(p.traegerVariante, 'S-G');
  assert.equal(p.ruhtAufUmsatzAllowlist, false);
  assert.equal(p.jahrgangsKette.e1Jahrgang, 'legacy_earliest_archived');
  assert.equal(p.jahrgangsKette.panelBytesIdentisch, true);
}

console.log('studie-rr9-nullpunkt.test.js: PASS');
