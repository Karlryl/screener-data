'use strict';

// E4h — Die Serienende-Diagnose: endet die gewaehlte Serie, waehrend nebenan eine
// nutzbare Alternativ-Serie liegt?
//
// DIE SACHE: E4h beantwortet die Weiche der Studien-Fortsetzung (ENTSCHIED 32.4,
// Regel VOR den Zahlen eingefroren). Zwei Dinge muessen deshalb festgenagelt sein:
//   1. Der BIT-ANKER: exakt 25 Signal- und 192 Kontrollpool-Weiterfiler. Eine
//      Diagnose, die ihre Population still verfehlt, belegt nichts.
//   2. Die LESE-SCHRANKE: die Sonde liest Fakt-METADATEN, niemals fakt.value. Der
//      Ausschluss steht im Eintragstext und ist damit gehasht — er darf keine
//      Behauptung im Bericht sein, sondern muss eine pruefbare Eigenschaft des
//      Codes auf dem ECHTEN Lesepfad sein.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'studie-e4h-serienende.py');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const RUN_ID = 'e4h-serienende-pruefung-2026-08-29';

function e4h(args, optionen = {}) {
  return spawnSync(process.env.PYTHON || 'python', [SKRIPT, ...args],
    { encoding: 'utf8', cwd: REPO, ...optionen });
}

let selbsttest = null;
function selbsttestLauf() {
  if (selbsttest === null) selbsttest = e4h(['--selbsttest']);
  return selbsttest;
}

// Namentlich erwartet. Faellt eine dieser Zeilen weg, ist der Test rot — auch wenn
// der Selbsttest weiter Exit-Code 0 meldet.
const PFLICHT_PRUEFUNGEN = [
  'Sonde: vier Folgequartale unter anderem KONZEPT -> nur Konzept',
  'Sonde: Quartalsfakten im Filing werden erkannt',
  'Sonde: vier Stichtage decken die ddate-Achse',
  'Sonde: vier Folgequartale in anderer UNIT -> nur Unit',
  'Sonde: vier Folgequartale unter anderem TRACK -> nur Track',
  'Sonde: Abweichung auf drei Achsen -> mehrere Achsen',
  'Sonde: DREI Folgequartale reichen NICHT - die Reifeschwelle haelt',
  'Sonde: dieselbe Achse ist KEINE Alternative',
  'Sonde: bei mehreren Treffern zaehlt die konservativste Achse',
  'Sonde: vor dem Signal eingereichte Zeilen sind keine Fortsetzung',
  'Sonde: Stichtage HINTER dem Panelrand zaehlen nicht',
  'Sonde: der gewaehlte Track kommt aus den Vor-Signal-Metadaten',
  // Die beiden Abdeckungs-Zaehler muessen WIRKLICH zwei sein. Ohne diese drei
  // Zeilen koennte qtrs_abgedeckt still zu einer Kopie von ddate_abgedeckt
  // werden, und der Bericht fuehrte zweimal dieselbe Zahl unter zwei Namen.
  'Abdeckung: vier JAHRES-Stichtage decken die ddate-Achse',
  'Abdeckung: sie decken die QUARTALS-Achse aber NICHT',
  'Abdeckung: ohne Quartalsfakten gibt es keine Alternativ-Serie',
  'Lese-Schranke: die Metadaten-Abfrage geht durch',
  'Lese-Schranke: eine Abfrage MIT value bricht ab',
  'Lese-Schranke: value in der WHERE-Klausel bricht auch ab',
  'Lese-Schranke: eine fremde Spalte bricht ab',
  'Lese-Schranke: der ECHTE Lesepfad liefert Metadaten',
  'Lese-Schranke: qtrs bleibt am Datensatz stehen, statt wegzufallen',
  'Lese-Schranke: die Abfrage des ECHTEN Lesepfads lief durch die Wache',
  'Lese-Schranke: diese Abfrage nennt die verbotene Spalte NICHT',
  'Bit-Anker: 25/326 im Signalarm gehen durch',
  'Bit-Anker: 192/4285 im Kontrollpool gehen durch',
  'Bit-Anker: 24 statt 25 ist ein SOFORT-STOPP',
  'Bit-Anker: 26 statt 25 ist ebenso ein SOFORT-STOPP',
  'Bit-Anker: richtige Weiterfiler-Zahl bei FALSCHER Fallzahl faellt auf',
  'Bit-Anker: 191 statt 192 im Kontrollpool ist ein SOFORT-STOPP',
  'die gueltige Ausgabe geht DURCH',
  'eine Konzept-Liste im Arm fliegt auf',
  'ein durchgereichter Messwert fliegt am Typ auf',
  'ein FEHLENDES Pflichtfeld fliegt genauso auf wie ein zusaetzliches',
  'ein zusaetzlicher Schluessel im Umschlag fliegt auf',
  'ein fehlender Arm fliegt auf',
  'verschwiegene Sonden-Spalten fliegen auf',
  'die gueltige Zerlegung geht auf',
  'mit+ohne muss den Nenner treffen',
  'die Achsen-Zaehler muessen die nutzbaren Alternativen treffen',
  'ein nicht-monotoner Trichter bricht ab',
  'mehr endende Serien als gepruefte Firmen bricht ab',
  'W9: die 14 Felder decken sich mit dem Register-Eintrag',
  'W9: die Ausgabe-Allowlist zaehlt genau 14 Felder',
];

test('Der Selbsttest der E4h-Diagnose laeuft gruen durch', () => {
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

// ── Die Sperrzone ────────────────────────────────────────────────────────────

test('Die Diagnose kennt nur das Prueffenster — kein Fenster-Schalter', () => {
  const lauf = e4h(['--fenster', 'endtest']);
  assert.notEqual(lauf.status, 0, 'Ein Fenster-Schalter haette abgewiesen werden muessen');
  assert.match(`${lauf.stdout}${lauf.stderr}`, /unrecognized arguments|invalid choice|SPERRZONE/i);
});

test('Die Diagnose fasst weder Schluessel noch verschluesselte Datei an', () => {
  const quelle = fs.readFileSync(SKRIPT, 'utf8').toLowerCase();
  // Suchbegriffe zusammengesetzt, sonst stuende dieser Test in seinem eigenen
  // Suchraum (dieselbe Falle wie im Selbsttest der Zaehlprobe).
  for (const wort of [`de${'crypt'}`, `ci${'pher'}`, `un${'seal'}`, `open${'ssl'}`]) {
    assert.ok(!quelle.includes(wort), `Die Diagnose enthaelt '${wort}'`);
  }
});

// ── Register-Bindung ─────────────────────────────────────────────────────────

const REGISTER = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const EINTRAG = REGISTER.events.find((e) => e.runId === RUN_ID);

test('Der Register-Eintrag traegt den gehashten 25/192-Selbst-Check', () => {
  assert.ok(EINTRAG, `Register-Eintrag ${RUN_ID} fehlt`);
  assert.equal(EINTRAG.typ, 'count_only_probe_authorized');
  assert.deepEqual(EINTRAG.fenster, ['pruefung']);
  assert.match(EINTRAG.begruendung,
    /exakt 25 Firmen im S-G-Signal-Arm und 192 Firmen im Kontrollpool/);
  assert.match(EINTRAG.begruendung, /SOFORT-STOPP/);
  // Der Wert-Ausschluss steht im Eintragstext und ist damit gehasht.
  assert.match(EINTRAG.begruendung, /NICHT gelesen wird fakt\.value/);
});

test('W9: Skript-Allowlist und Register-Anmeldung sind IDENTISCH', () => {
  const lauf = e4h(['--allowlist-ausgeben']);
  assert.equal(lauf.status, 0, lauf.stderr);
  const felder = JSON.parse(lauf.stdout);
  assert.equal(felder.length, 14, 'Der Vertrag nennt exakt 14 Aggregatzaehler');
  assert.deepEqual(felder, [...EINTRAG.allowedOutputs].sort(),
    'Die Ausgabe-Allowlist des Skripts weicht vom Register-Eintrag ab');
});

test('W9: eine Freigabe eines FREMDEN Laufs deckt diese Diagnose nicht', () => {
  const fremd = REGISTER.events.find(
    (e) => e.typ === 'count_only_probe_authorized' && e.runId !== RUN_ID
      && Array.isArray(e.allowedOutputs) && e.allowedOutputs.length > 0);
  assert.ok(fremd, 'Kein fremder Zaehlproben-Eintrag im Register gefunden');
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e4h-w9-'));
  try {
    const freigabe = path.join(verzeichnis, 'freigabe.json');
    fs.writeFileSync(freigabe, JSON.stringify({
      runId: fremd.runId,
      fenster: (fremd.fenster || [])[0],
      registerEventHash: fremd.eventHash,
      accessedAt: fremd.accessedAt,
      serverConfirmedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    }), 'utf8');
    const lauf = e4h(['--freigabe', freigabe, '--data-root', verzeichnis]);
    assert.notEqual(lauf.status, 0, 'Eine fremde Freigabe haette abgewiesen werden muessen');
    assert.match(`${lauf.stdout}${lauf.stderr}`, /W9-ABBRUCH|W2-ABBRUCH/);
  } finally {
    fs.rmSync(verzeichnis, { recursive: true, force: true });
  }
});

// ── Der committete Lauf ──────────────────────────────────────────────────────
//
// Der eigentliche Lauf braucht das Panel und laeuft im CI nicht. Was im CI laufen
// KANN und muss: dass das ausgelieferte Artefakt die Anker traegt, den Trichter
// einhaelt und die Ergebnis-Sperre nicht verletzt. Ein spaeter editiertes Artefakt
// faellt hier auf.

const ARTEFAKT = path.join(REPO, 'reports', 'studie',
  'E4h-serienende-diagnose-2026-08-29.json');

test('Das committete Ergebnis traegt den bestandenen Bit-Anker', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  assert.equal(d.runId, RUN_ID);
  assert.equal(d.fenster, 'pruefung');
  assert.equal(d.variante, 'S-G');
  assert.equal(d.signal_weiterfiler, 25);
  assert.equal(d.kontrollpool_weiterfiler, 192);
  assert.equal(d.selbstCheck.istSignalWeiterfiler, d.selbstCheck.sollSignalWeiterfiler);
  assert.equal(d.selbstCheck.istKontrollpoolWeiterfiler,
    d.selbstCheck.sollKontrollpoolWeiterfiler);
  assert.equal(d.selbstCheck.istFallzahlSignal, 326);
  assert.equal(d.selbstCheck.istFallzahlKontrolle, 4285);
  assert.equal(d.ergebnisdatenBeruehrt, false);
  assert.deepEqual(d.gelesenePfade, ['panel/panel-validierung.sqlite'],
    'Der Lauf darf ausschliesslich die Panel-Datei des angemeldeten Fensters lesen');
});

test('Das committete Ergebnis weist die Lese-Schranke aus', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  assert.deepEqual(d.sondenSpalten,
    ['adsh', 'ddate', 'qtrs', 'tag', 'uom', 'version'],
    'Der Bericht muss zeigen, welche Spalten die Sonde gelesen hat');
  assert.ok(!d.sondenSpalten.includes('value'),
    'fakt.value ist im Eintragstext ausgeschlossen und damit gehasht');
});

test('Das committete Ergebnis haelt die 14-Felder-Sperre und den Trichter ein', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  const erlaubt = new Set(EINTRAG.allowedOutputs);
  for (const [name, arm] of Object.entries(d.arme)) {
    for (const feld of Object.keys(arm)) {
      assert.ok(erlaubt.has(feld), `${name}/${feld} ist nicht angemeldet`);
      assert.ok(Number.isInteger(arm[feld]) && arm[feld] >= 0,
        `${name}/${feld} ist kein nicht-negativer Zaehler`);
    }
    const n = arm.nenner_alternativpruefung;
    assert.equal(arm.mit_nutzbarer_alternativserie + arm.ohne_nutzbare_alternativserie, n);
    assert.equal(
      arm.alternativ_nur_anderes_konzept + arm.alternativ_nur_andere_unit
      + arm.alternativ_nur_anderer_track + arm.alternativ_mehrere_achsen,
      arm.mit_nutzbarer_alternativserie);
    // Die echten Teilmengen-Beziehungen. ddate_abgedeckt ist NICHT enger als
    // quartalsfakten_im_filing_vorhanden — eine Firma kann vier Stichtage
    // tragen, die alle Jahreswerte sind. Genau darum sind es zwei Zaehler.
    assert.ok(arm.mit_nutzbarer_alternativserie <= arm.qtrs_abgedeckt);
    assert.ok(arm.qtrs_abgedeckt <= arm.ddate_abgedeckt);
    assert.ok(arm.qtrs_abgedeckt <= arm.quartalsfakten_im_filing_vorhanden);
    assert.ok(arm.ddate_abgedeckt <= n);
    assert.ok(arm.quartalsfakten_im_filing_vorhanden <= n);
  }
});

test('Im Ergebnis steckt keine Kennung, kein Konzept und keine Unit', () => {
  // Gesucht wird im ERGEBNIS-KERN, nicht im Umschlag: dort stehen legitime lange
  // Zahlen (Siegel-Dateigroesse, SHA-256) und die Sonden-Spaltennamen.
  //
  // Positive Gegenprobe zuerst: ohne sie waere ein leeres Ergebnis nicht von einer
  // kaputten Suche zu unterscheiden.
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  const kern = JSON.stringify(d.arme);
  const leck = /"(?:cik|adsh|ticker|name)"|OperatingIncomeLoss|us-gaap|USD|\d{5,}/;
  assert.ok(leck.test('{"x":"OperatingIncomeLoss"}'), 'Die Leck-Suche selbst ist kaputt');
  assert.ok(leck.test('{"uom":"USD"}'), 'Eine Unit wuerde nicht gefunden');
  assert.ok(!leck.test(kern),
    'Im Ergebnis steht eine Kennung, ein Konzeptname oder eine Unit');
});
