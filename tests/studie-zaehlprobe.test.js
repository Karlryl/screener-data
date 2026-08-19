'use strict';

// E3 — Die Nur-Zaehlen-Probe: W2 (R1-Serverzeit), W3 (Ausgabe-Allowlist),
// W4 (Klartext- und Siegel-Wache).
//
// Der Selbsttest des Python-Skripts baut die Fixtures, die den Unterschied wirklich
// TRAGEN — den 199/200-Firmen-Fall, die Firma mit ZWEI reifen Ereignissen, den
// 0.777-Marker und die vier Siegel-Faelle. Er wird hier EINMAL gefahren und
// namentlich ausgewertet: nicht "Exit-Code 0", sondern "diese Pruefung stand da und
// war gruen". Ein Selbsttest, dem man Pruefungen herausschneiden kann, ohne dass es
// auffaellt, ist kein Waechter.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'studie-zaehlprobe.py');

function probe(args, optionen = {}) {
  return spawnSync(process.env.PYTHON || 'python', [SKRIPT, ...args],
    { encoding: 'utf8', cwd: REPO, ...optionen });
}

let selbsttest = null;
function selbsttestLauf() {
  if (selbsttest === null) selbsttest = probe(['--selbsttest']);
  return selbsttest;
}

// Namentlich erwartet. Faellt eine dieser Zeilen weg, ist der Test rot — auch wenn
// der Selbsttest weiter Exit-Code 0 meldet.
const PFLICHT_PRUEFUNGEN = [
  'gesperrter Pfad wird abgewiesen: panel-endtest.sqlite.enc',
  'gesperrter Pfad wird abgewiesen: endtest.key',
  'gesperrter Pfad wird abgewiesen: panel-entdeckung.sqlite',
  'das freigegebene Fenster geht DURCH (sonst waere die Mauer Deko)',
  '199 reife Firmen -> Fallzahl 199',
  '199 reife Firmen -> INCONCLUSIVE_DATA',
  '200 reife Firmen -> Fallzahl 200',
  '200 reife Firmen -> GRUEN',
  '201 Firmen, nicht 202 Ereignisse',
  'die gueltige Ausgabe geht DURCH',
  'ein geleckter Persistenzwert fliegt auf',
  'eine WEGGELASSENE Pflichtgroesse fliegt auch auf',
  'kein Folgequartal-Wert im Output',
  'Zugriff NACH Serverzeit geht durch',
  'Zugriff VOR der Serverbestaetigung fliegt auf',
  'Zugriff VOR der angemeldeten Zugriffszeit fliegt auf',
  'Zeitstempel ohne Zeitzone fliegt auf',
  'diese Datei enthaelt keinen Entschluesselungs-Aufruf',
  'das ausgelieferte Manifest stimmt',
  'ein Manifest OHNE studie-basisraten.py fliegt auf',
  'ein unberuehrtes Siegel geht DURCH',
  'eine KLARTEXT-Kopie des Endtest-Panels fliegt auf',
  'ein gekipptes Byte der Siegeldatei fliegt auf',
  'eine verschwundene Siegeldatei ist kein bestandener Test',
];

test('Der Selbsttest der Zaehlprobe laeuft gruen durch', () => {
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

// ── W2: Serverzeit im ECHTEN Ablauf ──────────────────────────────────────────

// Die Freigabe muss zum echten Zugriffs-Register passen, sonst faellt sie schon
// dort auf. Genommen wird deshalb der zuletzt angemeldete Zaehlproben-Eintrag; nur
// die Serverzeit wird variiert. Das prueft W2 an dem Fall, der wirklich vorkommt.
//
// GESUCHT WIRD DAS FENSTER MIT, nicht nur die Eintragsart (E4a, 19.08.): Die
// Zaehlprobe ist ausschliesslich fuer das Prueffenster freigegeben, und dieser
// Test braucht genau so einen Eintrag. Die erste Fassung nahm den JUENGSTEN
// Zaehlproben-Eintrag und wurde rot, sobald ein Lauf ein anderes Fenster anmeldete
// — sie testete dann die Fenster-Ungleichheit statt der Serverzeit. Ein Waechter,
// der bei bestimmungsgemaessem Gebrauch rot wird, entwertet sich selbst.
const REGISTER = JSON.parse(fs.readFileSync(
  path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json'), 'utf8'));
const ZAEHLPROBE_EINTRAG = [...REGISTER.events]
  .reverse()
  .find((e) => (e.typ || e.type) === 'count_only_probe_authorized'
    && (e.fenster || [])[0] === 'pruefung');

function freigabeDatei(verzeichnis, serverConfirmedAt, aenderung = {}) {
  const pfad = path.join(verzeichnis, 'freigabe.json');
  fs.writeFileSync(pfad, JSON.stringify({
    runId: ZAEHLPROBE_EINTRAG.runId,
    fenster: (ZAEHLPROBE_EINTRAG.fenster || [])[0],
    registerEventHash: ZAEHLPROBE_EINTRAG.eventHash,
    accessedAt: ZAEHLPROBE_EINTRAG.accessedAt,
    serverConfirmedAt,
    ...aenderung,
  }), 'utf8');
  return pfad;
}

test('Es gibt ueberhaupt einen Zaehlproben-Eintrag im Register (sonst prueft W2 nichts)', () => {
  assert.ok(ZAEHLPROBE_EINTRAG, 'Kein count_only_probe_authorized-Eintrag im Zugriffs-Register');
  assert.equal((ZAEHLPROBE_EINTRAG.fenster || [])[0], 'pruefung');
});

test('W2: ein Erstzugriff VOR der Server-Bestaetigung bricht den echten Lauf ab', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-w2-'));
  // Zwei nachweislich verschiedene Zeitstempel: die Bestaetigung liegt ein Jahr in
  // der Zukunft, der Erstzugriff ist jetzt. Damit KANN der Lauf die Ordnung nicht
  // erfuellen — und muss es merken, bevor er irgendetwas anfasst.
  const zukunft = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const lauf = probe(['--fenster', 'pruefung', '--freigabe',
    freigabeDatei(verzeichnis, zukunft), '--data-root', verzeichnis]);
  assert.notEqual(lauf.status, 0, 'Der Lauf haette abbrechen muessen');
  assert.match(`${lauf.stdout}${lauf.stderr}`, /W2-ABBRUCH/);
});

test('W2: eine gueltige Reihenfolge kommt an der Serverzeit VORBEI (kein Blocker fuer alles)', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-w2-'));
  const vergangenheit = new Date(Date.now() - 3600 * 1000).toISOString();
  const lauf = probe(['--fenster', 'pruefung', '--freigabe',
    freigabeDatei(verzeichnis, vergangenheit), '--data-root', verzeichnis]);
  // Der Lauf scheitert danach an der Siegel-Wache (das Testverzeichnis traegt kein
  // Siegel) — aber NICHT mehr an W2. Ein Waechter, der alles blockt, waere genauso
  // kaputt wie einer, der nichts blockt.
  assert.notEqual(lauf.status, 0);
  const ausgabe = `${lauf.stdout}${lauf.stderr}`;
  assert.ok(!/W2-ABBRUCH/.test(ausgabe), `W2 blockt eine gueltige Reihenfolge:\n${ausgabe}`);
  assert.match(ausgabe, /W4-ABBRUCH/);
});

test('W2: eine Freigabe fuer ein ANDERES Fenster gilt nicht', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-w2-'));
  const pfad = freigabeDatei(verzeichnis, new Date(Date.now() - 3600 * 1000).toISOString());
  const lauf = probe(['--fenster', 'entdeckung', '--freigabe', pfad, '--data-root', verzeichnis]);
  assert.notEqual(lauf.status, 0);
  assert.match(`${lauf.stdout}${lauf.stderr}`, /angemeldet ist Fenster 'pruefung'/);
});

test('W2: gar keine Freigabe heisst gar kein Zaehllauf', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-w2-'));
  const lauf = probe(['--fenster', 'pruefung', '--data-root', verzeichnis]);
  assert.notEqual(lauf.status, 0);
  assert.match(`${lauf.stdout}${lauf.stderr}`, /W2-ABBRUCH/);
});

// ── Haertungen aus dem Code-Review vom 19.08. ────────────────────────────────
// Jeder dieser Tests waere ohne den zugehoerigen Fix gruen gewesen, obwohl die
// Sperre offen stand — genau deshalb stehen sie hier.

test('W2: eine Freigabe mit gefaelschtem Register-Hash fliegt auf', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-w2-'));
  const pfad = freigabeDatei(verzeichnis, new Date(Date.now() - 3600 * 1000).toISOString(),
    { registerEventHash: 'b'.repeat(64) });
  const lauf = probe(['--fenster', 'pruefung', '--freigabe', pfad, '--data-root', verzeichnis]);
  assert.notEqual(lauf.status, 0);
  assert.match(`${lauf.stdout}${lauf.stderr}`, /Eintrags-Hash der Freigabe passt nicht zum Register/);
});

test('W2: eine Freigabe mit erfundener runId fliegt auf', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-w2-'));
  const pfad = freigabeDatei(verzeichnis, new Date(Date.now() - 3600 * 1000).toISOString(),
    { runId: 'nie-angemeldet' });
  const lauf = probe(['--fenster', 'pruefung', '--freigabe', pfad, '--data-root', verzeichnis]);
  assert.notEqual(lauf.status, 0);
  assert.match(`${lauf.stdout}${lauf.stderr}`, /0-mal im Zugriffs-Register/);
});

function pythonSchnipsel(zeilen) {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-py-'));
  const datei = path.join(verzeichnis, 'schnipsel.py');
  fs.writeFileSync(datei, [
    'import importlib.util',
    `spec=importlib.util.spec_from_file_location("z", r"${SKRIPT}")`,
    'z=importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(z)',
    ...zeilen,
  ].join('\n'), 'utf8');
  return spawnSync(process.env.PYTHON || 'python', [datei], { encoding: 'utf8', cwd: REPO });
}

test('W3: ein Zaehler im aktienzahl-Namensraum ist NICHT frei erfunden erlaubt', () => {
  const lauf = pythonSchnipsel([
    'praereg = z.lies_praeregistrierung()',
    'e2 = z.lade_modul(z.E2_SKRIPT, "studie_basisraten")',
    'umschlag = dict((k, None) for k in praereg["zaehlprobe"]["umschlagAllowlist"])',
    'umschlag["varianten"] = {}',
    'umschlag["zaehler"] = {"aktienzahl_geheimer_messwert": 0.777}',
    'try:',
    '    z.pruefe_ausgabe(umschlag, praereg, e2)',
    '    print("DURCHGELASSEN")',
    'except z.ProbeFehler as f:',
    '    print("ABBRUCH", str(f)[:60])',
  ]);
  assert.match(lauf.stdout, /^ABBRUCH W3-ABBRUCH: unbekannter Zaehler/m, `${lauf.stdout}${lauf.stderr}`);
});

test('W3: eine Ausgabe ohne Varianten besteht die Pruefung NICHT', () => {
  const lauf = pythonSchnipsel([
    'praereg = z.lies_praeregistrierung()',
    'e2 = z.lade_modul(z.E2_SKRIPT, "studie_basisraten")',
    'umschlag = dict((k, None) for k in praereg["zaehlprobe"]["umschlagAllowlist"])',
    'umschlag["varianten"] = {}',
    'umschlag["zaehler"] = {}',
    'try:',
    '    z.pruefe_ausgabe(umschlag, praereg, e2)',
    '    print("DURCHGELASSEN")',
    'except z.ProbeFehler as f:',
    '    print("ABBRUCH", str(f)[:60])',
  ]);
  assert.match(lauf.stdout, /^ABBRUCH W3-ABBRUCH: die Ausgabe fuehrt die Varianten/m, `${lauf.stdout}${lauf.stderr}`);
});

test('R4: die Pfad-Beobachtung eines Laufs schleppt den Vorgaenger nicht mit', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-pfade-'));
  const lauf = pythonSchnipsel([
    'z.GEOEFFNETE_PFADE.append("fremd/aus-einem-frueheren-lauf.sqlite")',
    'z.GESCHRIEBENE_PFADE.append("fremd/auch-geschrieben.sqlite")',
    'try:',
    `    z.lauf("pruefung", None, data_root=r"${verzeichnis.replace(/\\/g, '\\\\')}")`,
    'except z.ProbeFehler:',
    '    pass',
    'print("GEOEFFNET", z.GEOEFFNETE_PFADE)',
    'print("GESCHRIEBEN", z.GESCHRIEBENE_PFADE)',
  ]);
  assert.match(lauf.stdout, /^GEOEFFNET \[\]$/m, `${lauf.stdout}${lauf.stderr}`);
  assert.match(lauf.stdout, /^GESCHRIEBEN \[\]$/m, `${lauf.stdout}${lauf.stderr}`);
});

test('R5: ein unlesbarer Zeitstempel im Erst-Ereignis bricht ab, statt "nicht zensiert" zu heissen', () => {
  const lauf = pythonSchnipsel([
    'class E2:',
    '    @staticmethod',
    '    def ordinal(t):',
    '        return None',
    'try:',
    '    z.ist_zensiert({"accepted": "krumm"}, E2, 999999)',
    '    print("DURCHGELASSEN")',
    'except z.ProbeFehler as f:',
    '    print("ABBRUCH", str(f)[:40])',
  ]);
  assert.match(lauf.stdout, /^ABBRUCH R5-ABBRUCH/m, `${lauf.stdout}${lauf.stderr}`);
});

// ── Sperrzone ────────────────────────────────────────────────────────────────

test('Das Endtest-Fenster wird nicht geoeffnet — auch nicht mit gueltiger Freigabe', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-sperr-'));
  const panel = path.join(verzeichnis, 'panel');
  fs.mkdirSync(panel, { recursive: true });
  const enc = path.join(panel, 'panel-endtest.sqlite.enc');
  fs.writeFileSync(enc, 'ein kleines Siegel');
  const siegel = path.join(verzeichnis, 'versiegelung.json');
  fs.writeFileSync(siegel, JSON.stringify({
    klartextDatei: 'panel-endtest.sqlite', siegelDatei: 'panel-endtest.sqlite.enc',
    bytesSiegel: fs.statSync(enc).size,
    sha256Siegel: require('node:crypto').createHash('sha256').update(fs.readFileSync(enc)).digest('hex'),
  }), 'utf8');
  const datei = path.join(verzeichnis, 'lauf.py');
  fs.writeFileSync(datei, [
    'import importlib.util',
    `spec=importlib.util.spec_from_file_location("z", r"${SKRIPT}")`,
    'z=importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(z)',
    'try:',
    `    z.lauf("endtest", None, data_root=r"${verzeichnis.replace(/\\/g, '\\\\')}",`
      + ` versiegelung_pfad=r"${siegel.replace(/\\/g, '\\\\')}")`,
    '    print("GEOEFFNET")',
    'except z.ProbeFehler as f:',
    '    print("STOPP", str(f)[:40])',
  ].join('\n'), 'utf8');
  const lauf = spawnSync(process.env.PYTHON || 'python', [datei], { encoding: 'utf8', cwd: REPO });
  assert.match(lauf.stdout, /^STOPP SPERRZONE-STOPP/m, `${lauf.stdout}${lauf.stderr}`);
});

// ── R1-Serverzeit-Skript ─────────────────────────────────────────────────────

test('Das Serverzeit-Skript nimmt den Date-Kopf, nicht die lokale Uhr', () => {
  const { serverAntwort } = require('../scripts/studie-r1-serverzeit');
  assert.equal(typeof serverAntwort, 'function');
  const quelle = fs.readFileSync(path.join(REPO, 'scripts', 'studie-r1-serverzeit.js'), 'utf8');
  assert.match(quelle, /gh\(\['api', '-i'/, 'Ohne -i kommen keine Kopfzeilen und damit keine Serveruhr');
  assert.match(quelle, /\^date:/i, 'Der Date-Kopf wird nicht gelesen');
  assert.ok(!/new Date\(\)\.toISOString\(\)[^\n]*serverConfirmedAt/.test(quelle),
    'serverConfirmedAt darf nie aus der lokalen Uhr kommen');
});
