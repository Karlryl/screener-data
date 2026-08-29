'use strict';

// E4d + E4e — Das Kadenz-Kriterium und die konsistente Fensterkanten-Formel.
//
// DIE SACHE: Hier wird ein Zensur-Kriterium geaendert, dessen HEBELRICHTUNG bekannt
// ist, waehrend das Ergebnis 0,68 Punkte unter der Schwelle liegt. Jede Stelle, an der
// die Wahl der Daten folgen koennte statt der Dokumentation, ist der Hauptbefund.
// Deshalb wird hier nicht "Exit-Code 0" geprueft, sondern: DIESE Pruefung stand da und
// war gruen — und zusaetzlich, dass die Entscheidungsregel im Siegel steht, bevor der
// Lauf sie kennt.
//
// Das Fixture des Selbsttests traegt den Unterschied wirklich: eine Firma, die unter
// E3s 80-Tage-Kriterium unzensiert und unter dem Kadenz-Kriterium zensiert ist, eine
// zweite, die zusaetzlich REIF ist (ohne sie zeigt die Formel-Korrektur nichts), und
// eine randnahe quartalsweise Melderin, die NICHT zensiert werden darf.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'studie-e4d-kadenz.py');
const FREEZE = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'e4d-freeze.json');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const PRAEREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'preregistration.json');

function kadenz(args, optionen = {}) {
  return spawnSync(process.env.PYTHON || 'python', [SKRIPT, ...args],
    { encoding: 'utf8', cwd: REPO, ...optionen });
}

let selbsttest = null;
function selbsttestLauf() {
  if (selbsttest === null) selbsttest = kadenz(['--selbsttest']);
  return selbsttest;
}

// Namentlich erwartet. Faellt eine dieser Zeilen weg, ist der Test rot — auch wenn
// der Selbsttest weiter Exit-Code 0 meldet.
const PFLICHT_PRUEFUNGEN = [
  'quartalsweise Melderin nahe am Rand: NICHT zensiert',
  'jahrweise Melderin an derselben Stelle: ZENSIERT',
  'und E3s 80-Tage-Kriterium sieht bei ihr NICHTS - genau das ist der Unterschied, den die Sabotage braucht',
  'die dokumentierte Untergrenze greift bei einer schnelleren Meldefolge',
  'und sie greift NICHT bei einer quartalsweisen Melderin',
  'eine Firma mit nur einem Quartal vor dem Signal bricht ab',
  'eine Firma ohne gewaehlte Reihe bricht ab',
  'der Anker ist der Melde-Eingang, nicht der Bilanzstichtag',
  'die Kadenz ist der MEDIAN der Abstaende (120), nicht der Mittelwert (rund 207) und nicht das Maximum (400)',
  'ohne zensierte Faelle sind beide Formeln GLEICH',
  'die geerbte Formel liefert an der Kante NICHT BERECHENBAR',
  'die konsistente Formel liefert dort eine echte Quote',
  'und ein Zaehler ueber dem Nenner bricht bei ihr AB, statt zu runden',
  'die Formel-Korrektur aendert die Quote MESSBAR (1,000 -> 0,750)',
  'Signal 90,06 % und Pool 90,53 % -> GRUEN',
  'Signal 89,32 % bei gutem Pool -> ROT (die Schwelle liegt wirklich dazwischen)',
  'gutes Signal, aber Pool unter 90 % -> ROT',
  'beide ueber 90 %, aber mehr als 10 Punkte auseinander -> ROT',
  'eine nicht berechenbare Quote heisst ROT, nie GRUEN',
  'die Regel nimmt ihre Schwellen aus dem Siegel, nicht aus sich selbst',
  'eine zu kleine Fallzahl bricht ab, statt sinngemaess zu entscheiden',
  'ein gueltiger Block geht DURCH',
  'weniger Kadenz- als E3-Zensuren bricht ab (Richtungs-Invariante)',
  'und zwar an DIESER Invariante, nicht an einer frueheren',
  'ein Histogramm, das nicht auf Klasse (c) aufgeht, bricht ab',
  'ein Nenner, der nicht aufgeht, bricht ab',
  'mehr reif-und-zensiert als zensiert bricht ab',
  'die Faecher beginnen bei 0 und sind 91 Tage breit',
  'die Faecher decken das ganze Band ab (1460 Tage)',
  'ein Abstand faellt in das Fach, das zu ihm gehoert',
  'die Faecher haengen am BAND, nicht an den Daten',
  'das Fixture erzeugt genau fuenf Erst-Ereignis-Firmen',
  'E3s Kriterium zensiert im Fixture NICHTS',
  'das Kadenz-Kriterium zensiert genau die beiden langsamen Firmen',
  'genau eine der beiden ist REIF - ohne sie zeigt die Formel-Sabotage nichts',
  'die randnahe QUARTALSweise Firma bleibt unzensiert - das Kriterium ist eine Kadenzregel, keine Randregel',
  'die geerbte Formel zaehlt die reife ZENSIERTE Firma weiter mit: 2 von 3',
  'die konsistente Formel wirft sie aus BEIDEN Seiten: 1 von 3',
  'die beiden Formeln liefern am selben Lauf VERSCHIEDENE Quoten - genau das ist die Sabotage der Formel-Korrektur',
  'Klasse (c) traegt drei Firmen (eine fern, zwei nah am Rand)',
  'das Histogramm setzt sie in ZWEI verschiedene Faecher - sonst koennte es Klumpen und Fluss nicht unterscheiden',
  'und es fuehrt auch die leeren Faecher',
  'das Fixture traegt beide Arme',
  'die gueltige Ausgabe geht DURCH',
  'ein geleckter Kennungsname fliegt auf',
  'ein geleckter Wachstumswert fliegt am Typ auf',
  'eine Quote ausserhalb [0,1] fliegt auf',
  'eine WEGGELASSENE Pflichtgroesse fliegt auch auf',
  'ein Messwert im HISTOGRAMM fliegt auf',
  'eine erfundene Ampel fliegt auf',
  'eine Ausgabe ohne Baender besteht die Pruefung NICHT',
  'kein Folgequartal-Wert im Output (Marker 0.777)',
  'keine Firmen-Kennung im Output',
  'kein Kennungsname im Output',
  'das ausgelieferte Siegel passt zu diesem Code',
  'ein veraenderter Skript-Hash im Siegel bricht ab',
  'eine GESENKTE Schwelle im Siegel bricht ab - das Gate wird nicht angefasst',
  'eine geaenderte Hoechstdifferenz bricht ab',
  'eine andere Kadenz-Untergrenze im Siegel bricht ab',
  'eine andere Kadenz-Statistik im Siegel bricht ab',
  'eine Allowlist, die die Ausgabe nicht deckt, bricht ab',
  'ein fehlendes Siegel heisst gar kein Lauf',
  'das Endtest-Fenster wird nicht geoeffnet',
  'diese Datei enthaelt keinen Entschluesselungs-Aufruf',
];

test('Der Selbsttest von E4d/E4e laeuft gruen durch', () => {
  const lauf = selbsttestLauf();
  assert.equal(lauf.status, 0, `Exit ${lauf.status}\n${lauf.stdout}\n${lauf.stderr}`);
  assert.ok(!/^\s*ROT\s/m.test(lauf.stdout), lauf.stdout);
});

test('Jede Pflichtpruefung stand wirklich da — und war gruen', () => {
  const lauf = selbsttestLauf();
  const gruen = new Set(
    lauf.stdout.split(/\r?\n/)
      .filter((zeile) => /^\s{2}ok\s{4}/.test(zeile))
      .map((zeile) => zeile.replace(/^\s{2}ok\s{4}/, '').trim()),
  );
  const fehlend = PFLICHT_PRUEFUNGEN.filter((name) => !gruen.has(name));
  assert.deepEqual(fehlend, [], `Diese Pruefungen fehlen im Selbsttest: ${fehlend.join(' | ')}`);
  assert.ok(gruen.size >= PFLICHT_PRUEFUNGEN.length,
    `Nur ${gruen.size} gruene Pruefungen — der Selbsttest ist geschrumpft`);
});

// ── Das vorab verriegelte Siegel ─────────────────────────────────────────────

const SIEGEL = JSON.parse(fs.readFileSync(FREEZE, 'utf8'));

test('Das Siegel bindet GENAU dieses Skript — Byte fuer Byte', () => {
  const ist = crypto.createHash('sha256').update(fs.readFileSync(SKRIPT)).digest('hex');
  assert.equal(SIEGEL.skriptSha256, ist,
    'Das Skript ist nach dem Einfrieren veraendert worden — jeder Lauf waere wertlos');
});

test('Das Gate 90/10 im Siegel ist das der versiegelten Praeregistrierung', () => {
  // Der Waechter nagelt die SACHE fest, nicht ein Schreibmuster: verglichen wird gegen
  // die versiegelte preregistration.json selbst, nicht gegen eine abgeschriebene Zahl.
  const gate = JSON.parse(fs.readFileSync(PRAEREG, 'utf8')).outcomes.auffindbarkeit.gate;
  assert.equal(SIEGEL.entscheidungsregel.minimum, gate.minimum);
  assert.equal(SIEGEL.entscheidungsregel.maxDifferenz, gate.maxDifferenzPunkte / 100);
});

test('Die verriegelte Regel fuehrt drei Bedingungen und keine dritte Option', () => {
  const regel = SIEGEL.entscheidungsregel;
  assert.equal(regel.bedingungen.length, 3);
  assert.match(regel.kurzform, /Keine dritte Option/);
  assert.match(regel.gruen, /2\.1\.0/);
  // Die ROT-Folge betrifft DIESEN Anlauf, nicht die Studie (Karl, 19.08. abends).
  assert.match(regel.rot, /INCONCLUSIVE_DATA/);
  assert.match(regel.rot, /nicht die Studie/);
  assert.ok(!/die Studie endet/.test(regel.rot),
    'Die ROT-Folge darf nicht behaupten, die Studie ende — der Themen-Strang haengt nicht an diesem Gate');
});

test('Das Kadenz-Kriterium benennt seine Herleitung UND seine verworfenen Varianten', () => {
  const k = SIEGEL.kadenzKriterium;
  assert.equal(k.untergrenzeTage, 365 / 4, 'Die Untergrenze ist ein Fiskalquartal, kein gegriffener Wert');
  assert.equal(k.statistik, 'median');
  assert.match(k.herleitung.join(' '), /13a-13/);
  assert.match(k.herleitung.join(' '), /13a-1\b/);
  assert.ok(k.verworfeneVarianten.length >= 4,
    'Ohne benannte verworfene Varianten ist die Wahl nicht nachpruefbar');
  for (const v of k.verworfeneVarianten) {
    assert.ok(v.variante && v.grund, 'Jede verworfene Variante braucht einen Grund');
  }
});

test('Beide Korrekturen ziehen laut Siegel in ENTGEGENGESETZTE Richtungen', () => {
  // Das ist die Ehrlichkeits-Zusage dieser Etappe. Steht sie nicht im Siegel, ist sie
  // nachtraeglich behauptet.
  assert.match(SIEGEL.kadenzKriterium.hebelrichtung, /NIE weniger zensieren/i);
  assert.match(SIEGEL.auffindbarkeitsFormel.wirkung, /GEGENRICHTUNG/);
});

// ── Die Sperrzone ────────────────────────────────────────────────────────────

test('Das Endtest-Fenster ist auf der Kommandozeile gar nicht erreichbar', () => {
  const lauf = kadenz(['--fenster', 'endtest']);
  assert.notEqual(lauf.status, 0, 'Der Endtest haette abgewiesen werden muessen');
  assert.match(`${lauf.stdout}${lauf.stderr}`, /invalid choice|ungueltige|SPERRZONE/i);
});

test('E4d fasst weder Schluessel noch verschluesselte Datei an', () => {
  const quelle = fs.readFileSync(SKRIPT, 'utf8').toLowerCase();
  for (const wort of [`de${'crypt'}`, `ci${'pher'}`, `un${'seal'}`, `open${'ssl'}`]) {
    assert.ok(!quelle.includes(wort), `E4d enthaelt '${wort}'`);
  }
});

// ── W9/W10: was ausgegeben wird, muss angemeldet sein ────────────────────────

const REGISTER = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));

function freigabeDatei(verzeichnis, eintrag, aenderung = {}) {
  const pfad = path.join(verzeichnis, 'freigabe.json');
  fs.writeFileSync(pfad, JSON.stringify({
    runId: eintrag.runId,
    fenster: (eintrag.fenster || [])[0],
    registerEventHash: eintrag.eventHash,
    accessedAt: eintrag.accessedAt,
    serverConfirmedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    ...aenderung,
  }), 'utf8');
  return pfad;
}

test('W9: eine Freigabe der E4a-DIAGNOSE deckt E4d nicht', () => {
  const e4a = [...REGISTER.events].reverse().find((e) => e.runId.startsWith('e4a-diagnose-pruefung'));
  assert.ok(e4a, 'Der E4a-Eintrag fehlt im Register — dann prueft W9 nichts');
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e4d-w9-'));
  const lauf = kadenz(['--fenster', 'pruefung', '--freigabe',
    freigabeDatei(verzeichnis, e4a), '--data-root', verzeichnis]);
  assert.notEqual(lauf.status, 0, 'Der Lauf haette abbrechen muessen');
  assert.match(`${lauf.stdout}${lauf.stderr}`, /W9-ABBRUCH/);
});

test('W2: gar keine Freigabe heisst gar kein Lauf', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e4d-w2-'));
  const lauf = kadenz(['--fenster', 'pruefung', '--data-root', verzeichnis]);
  assert.notEqual(lauf.status, 0);
  assert.match(`${lauf.stdout}${lauf.stderr}`, /W2-ABBRUCH/);
});

test('Die ausgegebene Allowlist ist genau die, die E4d durchlaesst', () => {
  const lauf = kadenz(['--allowlist-ausgeben']);
  assert.equal(lauf.status, 0, lauf.stderr);
  const felder = JSON.parse(lauf.stdout);
  assert.deepEqual([...felder].sort(), [...SIEGEL.ausgabeAllowlist].sort(),
    'Siegel und Code fuehren verschiedene Allowlisten');
  for (const pflicht of ['zensiert_e3', 'zensiert_kadenz', 'zensiert_kadenz_und_reif',
    'auffindbarkeit_e3', 'auffindbarkeit_kadenz', 'abstand_histogramm_klasse_c', 'ampel']) {
    assert.ok(felder.includes(pflicht), `Der Allowlist fehlt ${pflicht}`);
  }
  for (const feld of felder) {
    assert.ok(!/wachstum|umsatz|ergebnis_wert|kurs|rendite|persistenz/i.test(feld),
      `Der Allowlist-Eintrag ${feld} klingt nach einem Messwert, nicht nach einem Zaehler`);
  }
});
