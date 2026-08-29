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
  'ein Zaehler ueber dem Nenner bricht auch in den Blockinvarianten ab',
  'und zwar an dieser Stelle, nicht an einer frueheren',
  'ein negativer Abstand zum Panelrand bricht ab, statt still im ersten Fach zu landen',
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

test('Die Siegelwache laesst sich nicht abschwaechen', () => {
  // Der Schalter --ohne-siegel-hash der Zaehlprobe verkuerzt die Pruefung des
  // Endtest-Siegels auf die Byte-Zahl. Da das Endtest-Fenster hier ohnehin
  // unerreichbar ist, haette er nur eines koennen: die Wache in den ENTSCHEIDENDEN
  // Laeufen schwaechen. Er ist deshalb nicht durchgereicht - und das wird geprueft,
  // nicht behauptet. (Code-Review 19.08.)
  const lauf = kadenz(['--fenster', 'pruefung', '--ohne-siegel-hash']);
  assert.notEqual(lauf.status, 0);
  assert.match(`${lauf.stdout}${lauf.stderr}`, /unrecognized arguments|unknown option/i);
});

test('Beide ausgelieferten Laeufe haben das Endtest-Siegel VOLL nachgerechnet', () => {
  for (const p of [BERICHT_PRUEFUNG, BERICHT_ENTDECKUNG]) {
    const w = JSON.parse(fs.readFileSync(p, 'utf8')).siegelWache;
    assert.equal(w.sha256Geprueft, true, `${p}: Siegel nur nach Byte-Zahl geprueft`);
    assert.equal(w.klartextKopie, false);
    assert.equal(w.schluesselAngefasst, false);
  }
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

// Wird nach dem Lauf angehaengt: W8 (Anker) und W10 (Siegel im Register) gegen die
// ECHTEN Artefakte, nicht gegen abgeschriebene Zahlen.

const BERICHT_PRUEFUNG = path.join(REPO, 'reports', 'studie', 'E4d-kadenz-pruefung-2026-08-19.json');
const BERICHT_ENTDECKUNG = path.join(REPO, 'reports', 'studie', 'E4d-kadenz-entdeckung-2026-08-19.json');

// Tag 977 deliberately left this object as the B5 negative fixture. The guard
// below resolves the published object before the mutation; it does not search
// source text for a test name or path fragment.
const B5_ENTDECKUNG_POOL_NEGATIVFIXTURE = Object.freeze({
  schema: 'B5-discovery-pool-sabotage/1',
  fenster: 'entdeckung',
  band: '2009-2015',
  variante: 'S-U',
  arm: 'kontrolle',
  feld: 'firmen_mit_erst_ereignis',
  delta: 1,
});

function pruefeB5SabotageObjekt(bericht, fixture) {
  if (fixture.schema !== 'B5-discovery-pool-sabotage/1'
      || fixture.fenster !== bericht.fenster) {
    throw new Error('B5-GUARD: negative fixture is bound to another object');
  }
  const arm = bericht.baender?.[fixture.band]?.varianten?.[fixture.variante]?.[fixture.arm];
  if (!arm || !Object.hasOwn(arm, fixture.feld)) {
    throw new Error('B5-GUARD: discovery-pool target object is absent');
  }
  if (!Number.isInteger(arm[fixture.feld])) {
    throw new Error('B5-GUARD: discovery-pool target is not an integer count');
  }
  if (fixture.delta !== 1) {
    throw new Error('B5-GUARD: deliberate +1 sabotage is absent');
  }
  return [fixture.band, fixture.variante, fixture.arm, fixture.feld];
}

function ankerLauf(berichtPfad, aenderung = null) {
  // Ruft pruefe_anker() mit dem ECHTEN Laufergebnis auf - einmal unveraendert (muss
  // durchgehen) und einmal mit einer gekippten Zahl (muss abbrechen). Ein Anker, der
  // eine falsche Zahl durchlaesst, ist Deko.
  const bericht = JSON.parse(fs.readFileSync(berichtPfad, 'utf8'));
  const ziel = aenderung && !Array.isArray(aenderung)
    ? pruefeB5SabotageObjekt(bericht, aenderung)
    : aenderung;
  const skript = [
    'import importlib.util, json, sys',
    'sp = importlib.util.spec_from_file_location("d", sys.argv[1])',
    'm = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)',
    'd = json.load(open(sys.argv[2], encoding="utf-8"))',
    'aend = json.loads(sys.argv[4]) if sys.argv[4] else None',
    'if aend:',
    '    d["baender"][aend[0]]["varianten"][aend[1]][aend[2]][aend[3]] += 1',
    'print(m.pruefe_anker(d["baender"], sys.argv[3]))',
  ].join('\n');
  return spawnSync(process.env.PYTHON || 'python',
    ['-c', skript, SKRIPT, berichtPfad, bericht.fenster,
      ziel ? JSON.stringify(ziel) : ''],
    { encoding: 'utf8', cwd: REPO });
}

test('W8: der veroeffentlichte E3-Anker geht DURCH', () => {
  const lauf = ankerLauf(BERICHT_PRUEFUNG);
  assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`);
  assert.match(lauf.stdout, /registry\/S-G\/signal/);
});

test('W8: eine um EINS verschobene Fallzahl fliegt auf - im Signal UND im Pool', () => {
  for (const ziel of [['2017-2019', 'S-G', 'signal', 'fallzahl'],
    ['2017-2019', 'S-U', 'kontrolle', 'firmen_mit_erst_ereignis']]) {
    const lauf = ankerLauf(BERICHT_PRUEFUNG, ziel);
    assert.notEqual(lauf.status, 0, `Der Anker haette bei ${ziel.join('/')} abbrechen muessen`);
    assert.match(`${lauf.stdout}${lauf.stderr}`, /W8-ABBRUCH/);
  }
});

test('W8/B5: der E4a-Anker des Entdeckungsfensters geht DURCH und faellt bei Signal- UND Poolabweichung', () => {
  // Vorab festgelegt: Gemessen wird, ob W8 eine Abweichung von exakt +1 in je
  // einer veroeffentlichten Signal- und Poolzahl verwirft. Teststatistik sind
  // Exit-Code != 0 UND der benannte W8-ABBRUCH; Nullmodell ist, dass die
  // veraenderte Zahl akzeptiert wird. Schwelle: Nulltoleranz, bereits +1 muss rot.
  const gut = ankerLauf(BERICHT_ENTDECKUNG);
  assert.equal(gut.status, 0, `${gut.stdout}${gut.stderr}`);
  for (const ziel of [['2009-2015', 'S-G', 'signal', 'fallzahl'],
    B5_ENTDECKUNG_POOL_NEGATIVFIXTURE]) {
    const kaputt = ankerLauf(BERICHT_ENTDECKUNG, ziel);
    assert.notEqual(kaputt.status, 0,
      'Der Entdeckungsanker haette bei der gebundenen Objektsabotage abbrechen muessen');
    assert.match(`${kaputt.stdout}${kaputt.stderr}`, /W8-ABBRUCH/);
  }
});

test('W8/B5: der Objektwaechter beweist Anwesenheit UND Abwesenheit der Pool-Sabotage', () => {
  const bericht = JSON.parse(fs.readFileSync(BERICHT_ENTDECKUNG, 'utf8'));
  assert.deepEqual(
    pruefeB5SabotageObjekt(bericht, B5_ENTDECKUNG_POOL_NEGATIVFIXTURE),
    ['2009-2015', 'S-U', 'kontrolle', 'firmen_mit_erst_ereignis'],
  );
  assert.throws(
    () => pruefeB5SabotageObjekt(bericht, {
      ...B5_ENTDECKUNG_POOL_NEGATIVFIXTURE,
      delta: 0,
    }),
    /B5-GUARD: deliberate \+1 sabotage is absent/,
  );
  assert.throws(
    () => pruefeB5SabotageObjekt(bericht, {
      ...B5_ENTDECKUNG_POOL_NEGATIVFIXTURE,
      feld: 'nicht_vorhanden',
    }),
    /B5-GUARD: discovery-pool target object is absent/,
  );
});

test('Der E3-Block trifft E3 bit-fuer-bit - Signal UND Kontrollpool', () => {
  // Geprueft wird gegen die ausgelieferten Artefakte, nicht gegen abgeschriebene
  // Zahlen: die alte Formel auf dem alten Kriterium MUSS exakt E3s Quote liefern,
  // sonst misst E4d eine andere Strecke.
  const e3 = JSON.parse(fs.readFileSync(path.join(REPO, 'reports', 'studie',
    'E3-zaehlprobe-pruefung-2026-08-19.json'), 'utf8')).varianten;
  const e4 = JSON.parse(fs.readFileSync(BERICHT_PRUEFUNG, 'utf8')).baender['2017-2019'].varianten;
  for (const v of ['S-U', 'S-G']) {
    assert.equal(e4[v].signal.auffindbarkeit_e3, e3[v].auffindbarkeit, `Signal-Quote ${v}`);
    assert.equal(e4[v].signal.firmen_mit_erst_ereignis, e3[v].firmen_mit_erst_ereignis);
    assert.equal(e4[v].signal.fallzahl, e3[v].fallzahl);
    assert.equal(e4[v].kontrolle.auffindbarkeit_e3, e3[v].kontrollpool_auffindbarkeit, `Pool-Quote ${v}`);
    assert.equal(e4[v].kontrolle.firmen_mit_erst_ereignis, e3[v].kontrollpool_firmen);
  }
});

test('Die Klasse (c) trifft die von E4a veroeffentlichten Zahlen', () => {
  // Die Menge des Histogramms haengt an E4as Zerlegung. Weicht sie ab, zeigt das
  // Histogramm eine andere Menge, als der Report behauptet.
  const e4a = JSON.parse(fs.readFileSync(path.join(REPO, 'reports', 'studie',
    'E4a-diagnose-pruefung-2026-08-19.json'), 'utf8')).baender['2017-2019'].varianten;
  const e4d = JSON.parse(fs.readFileSync(BERICHT_PRUEFUNG, 'utf8')).baender['2017-2019'].varianten;
  for (const v of ['S-U', 'S-G']) {
    for (const arm of ['signal', 'kontrolle']) {
      assert.equal(e4d[v][arm].klasse_c_firmen, e4a[v][arm].klasse_c_zu_wenige_folgequartale,
        `Klasse (c) ${v}/${arm} weicht von E4a ab`);
      const summe = Object.values(e4d[v][arm].abstand_histogramm_klasse_c)
        .reduce((a, b) => a + b, 0);
      assert.equal(summe, e4d[v][arm].klasse_c_firmen, `Histogramm-Summe ${v}/${arm}`);
    }
  }
});

test('W10: eine Anmeldung OHNE den Fingerabdruck der Regel traegt keinen Lauf', () => {
  // Der Waechter, der die Vorab-Verriegelung ueberhaupt erst beweisbar macht.
  const skript = [
    'import importlib.util, json, sys',
    'sp = importlib.util.spec_from_file_location("d", sys.argv[1])',
    'm = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)',
    'reg = json.load(open(sys.argv[2], encoding="utf-8"))',
    'e = [x for x in reg["events"] if x["runId"] == sys.argv[3]][0]',
    'e["begruendung"] = "ohne Fingerabdruck"',
    'ziel = sys.argv[4]',
    'json.dump({"events": [e]}, open(ziel, "w", encoding="utf-8"))',
    'm.pruefe_siegel_im_register({"runId": sys.argv[3]}, sys.argv[5], ziel)',
  ].join('\n');
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e4d-w10-'));
  const siegelSha = crypto.createHash('sha256').update(fs.readFileSync(FREEZE)).digest('hex');
  const lauf = spawnSync(process.env.PYTHON || 'python',
    ['-c', skript, SKRIPT, LEDGER, 'e4d-kadenz-pruefung-2026-08-19',
      path.join(verzeichnis, 'reg.json'), siegelSha],
    { encoding: 'utf8', cwd: REPO });
  assert.notEqual(lauf.status, 0, 'Ohne Fingerabdruck haette der Waechter abbrechen muessen');
  assert.match(`${lauf.stdout}${lauf.stderr}`, /W10-ABBRUCH/);
});

// ── W10-Ausnahme, HASH-GENAU gepinnt (Orchestrator-Ruling 2026-08-29, ENTSCHIED 5) ──
// Die zwei Anmeldungen, die GENAU dieses Siegel binden, stehen nicht in mains Ledger:
// zwei Studien-Straenge haben am 19.08. parallel an dieselbe append-only Kette
// angemeldet, die Kette ist gegabelt, und jede Append-Variante ist konstruktiv tot
// (Originalstempel -> rueckdatiert, heutiger Stempel -> nicht VOR dem Zugriff, eigene
// Art -> fail-closed). Statt den Waechter zu entschaerfen, wird die Anmeldung hier auf
// dem zweiten Beweisweg gefuehrt: Abweichungs-Datensatz PLUS die zwei Freigabe-Belege,
// geprueft an denselben Feldern, die auch ein Ledger-Eintrag bestehen muesste.
//
// BEWUSST an den Siegel-Hash gepinnt und NICHT an "der Datensatz existiert": ein neues,
// geaendertes oder unbekanntes Siegel ohne Ledger-Anmeldung MUSS weiterhin rot werden.
// Sonst waere das hier ein Bypass statt eines Beweiswegs.
const W10_AUSNAHME_SIEGEL = 'def349666bebf8c5e95c2c0d038ecfdf7cc50a3a4fa8820959d5ef7a17bb97a2';
const W10_RECORD_ID = 'e4d-ledger-fork-2026-08-29';
const ABWEICHUNGS_DATENSATZ = path.join(
  REPO, 'protocol', 'early-detection', '2.0.0', 'e4d-ledger-fork-deviation-record.json',
);
const FREIGABE_BELEGE = {
  pruefung: path.join(REPO, 'reports', 'studie', 'E4d-freigabe-pruefung-2026-08-19.json'),
  entdeckung: path.join(REPO, 'reports', 'studie', 'E4d-freigabe-entdeckung-2026-08-19.json'),
};

/** Laeufe, deren Anmeldung zu `siegelSha` ausserhalb des Ledgers belegt ist ({fenster, runId}). */
function belegeAusAbweichungsDatensatz(siegelSha) {
  // Das Tor: alles andere als genau dieses Siegel bekommt hier NICHTS.
  if (siegelSha !== W10_AUSNAHME_SIEGEL) return [];
  const record = JSON.parse(fs.readFileSync(ABWEICHUNGS_DATENSATZ, 'utf8'));
  assert.equal(record.recordId, W10_RECORD_ID, 'Anderer Datensatz als der gepinnte');
  assert.equal(record.rule, 'R1');
  assert.equal(record.mode, 'DOCUMENT_NO_LEDGER_APPEND');
  assert.equal(record.w10Exception.pinnedFreezeSha256, W10_AUSNAHME_SIEGEL,
    'Der Datensatz pinnt ein anderes Siegel als der Waechter');
  assert.equal(record.affectedEntries.length, 2);

  const belege = [];
  for (const [name, pfad] of Object.entries(FREIGABE_BELEGE)) {
    const beleg = JSON.parse(fs.readFileSync(pfad, 'utf8'));
    const eintrag = record.affectedEntries.find((e) => e.runId === beleg.runId);
    assert.ok(eintrag, `${name}: der Datensatz fuehrt den Lauf ${beleg.runId} nicht`);
    assert.equal(eintrag.eventHash, beleg.registerEventHash,
      `${name}: eventHash im Datensatz und im Freigabe-Beleg gehen auseinander`);
    assert.equal(beleg.fenster, name, `${name}: der Beleg gehoert zu einem anderen Fenster`);
    // Die eigentliche R1-Eigenschaft, feldgenau statt "Datei ist da":
    // serverbestaetigte Anmeldung VOR dem ersten Zugriff.
    assert.ok(Date.parse(beleg.registeredAt) < Date.parse(beleg.serverConfirmedAt),
      `${name}: Anmeldung liegt nicht vor ihrer Server-Bestaetigung`);
    assert.ok(Date.parse(beleg.serverConfirmedAt) < Date.parse(beleg.accessedAt),
      `${name}: Server-Bestaetigung liegt nicht VOR dem Zugriff — R1 waere verletzt`);
    belege.push({ fenster: name, runId: beleg.runId });
  }
  return belege;
}

test('W10: die ECHTE Anmeldung traegt den Fingerabdruck - Gegenrichtung', () => {
  // Wie viele Laeufe es je Fenster gab, ist eine Frage der Akte, nicht des
  // Waechters: Vorlaeufe bleiben im Register stehen (siehe E3/E4a). Geprueft wird
  // die SACHE - jede E4d-Anmeldung meldet die Ausgabe-Allowlist an und traegt
  // einen Siegel-Fingerabdruck, und die Anmeldungen zum HEUTIGEN Siegel decken
  // beide Fenster.
  const siegelSha = crypto.createHash('sha256').update(fs.readFileSync(FREEZE)).digest('hex');
  const eintraege = REGISTER.events.filter((e) => e.runId.startsWith('e4d-kadenz-'));
  assert.ok(eintraege.length >= 2, 'Es fehlen E4d-Anmeldungen im Register');
  for (const e of eintraege) {
    assert.deepEqual([...e.allowedOutputs].sort(), [...SIEGEL.ausgabeAllowlist].sort(),
      `Die Anmeldung ${e.runId} meldet etwas anderes an, als E4d ausgibt`);
    assert.match(e.begruendung, /SHA-256 [0-9a-f]{64}/,
      `Die Anmeldung ${e.runId} traegt gar keinen Siegel-Fingerabdruck`);
  }
  const zumHeutigenSiegel = eintraege.filter((e) => JSON.stringify(e).includes(siegelSha));
  const ausLedger = zumHeutigenSiegel.map((e) => (e.fenster || [])[0]);
  const ausDatensatz = belegeAusAbweichungsDatensatz(siegelSha);
  assert.deepEqual([...new Set([...ausLedger, ...ausDatensatz.map((b) => b.fenster)])].sort(),
    ['entdeckung', 'pruefung'],
    'Zum heutigen Siegel muessen beide Fenster angemeldet sein');
  // Und die ausgelieferten Artefakte muessen aus GENAU diesen Laeufen stammen —
  // gleichgueltig, ob der Lauf im Ledger oder auf dem zweiten Beweisweg belegt ist.
  const angemeldeteLaeufe = new Set([
    ...zumHeutigenSiegel.map((e) => e.runId),
    ...ausDatensatz.map((b) => b.runId),
  ]);
  for (const p of [BERICHT_PRUEFUNG, BERICHT_ENTDECKUNG]) {
    const bericht = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(bericht.freezeGeprueft.sha256, siegelSha,
      `${p} stammt aus einem Lauf unter einem ANDEREN Siegel`);
    assert.ok(angemeldeteLaeufe.has(bericht.runId),
      `${p} nennt eine runId, die nicht zum heutigen Siegel angemeldet ist`);
  }
});
