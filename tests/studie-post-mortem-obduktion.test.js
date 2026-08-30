'use strict';

// Explorative Obduktion — Wachstums-Persistenz der Folgequartale.
//
// DIE SACHE: Dieser Lauf ist die sanktionierte Form von Karls 89,3-%-Wunsch
// (ENTSCHIED 45 + 53). Drei Dinge muessen deshalb festgenagelt sein, und zwar am
// OBJEKT statt am Textmuster:
//   1. Die R4-ENDPUNKTSPERRE. Der Eintragstext behauptet, der Laufzeit-Check sei
//      bestanden. Eine Behauptung im Bericht ist nichts wert — hier wird geprueft,
//      dass derselbe Check einen Kurs- und einen Rendite-Endpunkt WIRKLICH abweist.
//      Ohne diese Gegenprobe koennte pruefe_endpunktklasse() zu `return True`
//      verkommen und niemand saehe es.
//   2. Der PFLICHT-STEMPEL. "bekannte Ueberlebens-Verzerrung, Obergrenzen-Lesart"
//      steht im gehashten Eintragstext. Er muss eine pruefbare Eigenschaft des
//      Artefakts sein, keine Zeile im Fliesstext.
//   3. Die AUSGABE-SPERRE. 14 Felder, beide Richtungen, keine Kennung, kein
//      Kurswert.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'studie-post-mortem-obduktion.py');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const RUN_ID = 'post-mortem-explorativ-pruefung-2026-08-30';
const STEMPEL_KERN = 'bekannte Ueberlebens-Verzerrung, Obergrenzen-Lesart';

function obduktion(args, optionen = {}) {
  return spawnSync(process.env.PYTHON || 'python', [SKRIPT, ...args],
    { encoding: 'utf8', cwd: REPO, ...optionen });
}

let selbsttest = null;
function selbsttestLauf() {
  if (selbsttest === null) selbsttest = obduktion(['--selbsttest']);
  return selbsttest;
}

// Namentlich erwartet. Faellt eine dieser Zeilen weg, ist der Test rot — auch wenn
// der Selbsttest weiter Exit-Code 0 meldet.
const PFLICHT_PRUEFUNGEN = [
  'vier positive Folgequartale -> ja',
  'ein negatives Folgequartal -> nein',
  'g == 0 ist KEIN Wachstum -> nein',
  'fehlender g-Wert -> unentscheidbar, nicht nein',
  'weniger als vier Folgequartale -> unentscheidbar mit zensierten Slots',
  'Folgequartal fremder Quellen-Basis zaehlt nicht mit',
  'gueltiger Arm geht durch',
  'ja+nein+unentscheidbar != verfolgbar bricht ab',
  'falsche Slot-Summe bricht ab',
  'committete E4a-Zahlen gehen durch',
  'abweichende Population bricht ab',
  'gueltige Ausgabe geht durch',
  'Fremdschluessel im Umschlag bricht ab',
  'fehlender Umschlag-Schluessel bricht ab',
  'entfernter Pflicht-Stempel bricht ab',
  'Fremdfeld im Arm bricht ab',
  'fehlendes Arm-Feld bricht ab',
  'durchgereichter Messwert unter erlaubtem Namen bricht ab',
  'Rate ausserhalb [-1,1] bricht ab',
  'Rate ohne Nenner darf None sein',
  'ergebnisdatenBeruehrt=True bricht ab',
  'die 14 Skript-Felder sind genau die 14 angemeldeten',
  'Arm- und Oben-Felder decken die Allowlist genau',
  'Anmeldung deckt Ausgabe (echtes Register)',
  // Die drei R4-Zeilen sind der Kern. Sie belegen, dass die Sperre lebt.
  'registrierter Endpunkt ist erlaubt',
  'ein Kurs-Endpunkt wird gesperrt',
  'ein Rendite-Endpunkt wird gesperrt',
];

test('Der Selbsttest der Obduktion laeuft gruen durch', () => {
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

test('Die Obduktion kennt nur das Prueffenster — kein Fenster-Schalter', () => {
  const lauf = obduktion(['--fenster', 'endtest']);
  assert.notEqual(lauf.status, 0, 'Ein Fenster-Schalter haette abgewiesen werden muessen');
  assert.match(`${lauf.stdout}${lauf.stderr}`, /unrecognized arguments|invalid choice|SPERRZONE/i);
});

test('Die Obduktion fasst weder Schluessel noch verschluesselte Datei an', () => {
  const quelle = fs.readFileSync(SKRIPT, 'utf8').toLowerCase();
  // Suchbegriffe zusammengesetzt, sonst stuende dieser Test in seinem eigenen
  // Suchraum.
  for (const wort of [`de${'crypt'}`, `ci${'pher'}`, `un${'seal'}`, `open${'ssl'}`]) {
    assert.ok(!quelle.includes(wort), `Die Obduktion enthaelt '${wort}'`);
  }
});

// ── Register-Bindung ─────────────────────────────────────────────────────────

const REGISTER = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const EINTRAG = REGISTER.events.find((e) => e.runId === RUN_ID);

test('Der Register-Eintrag traegt die vier gehashten Klauseln', () => {
  assert.ok(EINTRAG, `Register-Eintrag ${RUN_ID} fehlt`);
  assert.equal(EINTRAG.typ, 'count_only_probe_authorized');
  assert.deepEqual(EINTRAG.fenster, ['pruefung']);
  // (1) explorativ, (2) Pflicht-Stempel, (3) Endtest versiegelt, (4) R4.
  assert.match(EINTRAG.begruendung, /EXPLORATIV .{0,3} NIEMALS KONFIRMATORISCH/);
  assert.match(EINTRAG.begruendung, /Obergrenzen-Lesart/);
  assert.match(EINTRAG.begruendung, /Das Endtest-Fenster bleibt VERBOTEN/);
  assert.match(EINTRAG.begruendung,
    /Kurs-\/Rendite-\/Preis-Endpunkte sind per R4 dauerhaft ausgeschlossen/);
  assert.match(EINTRAG.begruendung, /wachstums_persistenz_folgequartale/);
});

test('W9: Skript-Allowlist und Register-Anmeldung sind IDENTISCH', () => {
  const lauf = obduktion(['--allowlist-ausgeben']);
  assert.equal(lauf.status, 0, lauf.stderr);
  const felder = JSON.parse(lauf.stdout).allowedOutputs;
  assert.equal(felder.length, 14, 'Der Vertrag nennt exakt 14 Aggregatfelder');
  assert.deepEqual(felder, [...EINTRAG.allowedOutputs].sort(),
    'Die Ausgabe-Allowlist des Skripts weicht vom Register-Eintrag ab');
});

test('W9: eine Freigabe eines FREMDEN Laufs deckt diese Obduktion nicht', () => {
  const fremd = REGISTER.events.find(
    (e) => e.typ === 'count_only_probe_authorized' && e.runId !== RUN_ID
      && Array.isArray(e.allowedOutputs) && e.allowedOutputs.length > 0);
  assert.ok(fremd, 'Kein fremder Zaehlproben-Eintrag im Register gefunden');
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'obduktion-w9-'));
  try {
    const freigabe = path.join(verzeichnis, 'freigabe.json');
    fs.writeFileSync(freigabe, JSON.stringify({
      runId: fremd.runId,
      fenster: (fremd.fenster || [])[0],
      registerEventHash: fremd.eventHash,
      accessedAt: fremd.accessedAt,
      serverConfirmedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    }), 'utf8');
    const lauf = obduktion(['--freigabe', freigabe, '--data-root', verzeichnis]);
    assert.notEqual(lauf.status, 0, 'Eine fremde Freigabe haette abgewiesen werden muessen');
    assert.match(`${lauf.stdout}${lauf.stderr}`, /W9-ABBRUCH|W2-ABBRUCH/);
  } finally {
    fs.rmSync(verzeichnis, { recursive: true, force: true });
  }
});

// ── Der committete Lauf ──────────────────────────────────────────────────────
//
// Der eigentliche Lauf braucht das Panel und laeuft im CI nicht. Was im CI laufen
// KANN und muss: dass das ausgelieferte Artefakt seine Anker traegt, den Stempel
// fuehrt und die Ergebnis-Sperre nicht verletzt.

const ARTEFAKT = path.join(REPO, 'reports', 'studie',
  'post-mortem-explorativ-pruefung-2026-08-30.json');
const BERICHT = path.join(REPO, 'reports', 'studie',
  'post-mortem-explorativ-pruefung-2026-08-30.md');

test('Das committete Ergebnis traegt den bestandenen Konsistenz-Check', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  assert.equal(d.runId, RUN_ID);
  assert.equal(d.fenster, 'pruefung');
  assert.equal(d.variante, 'S-G');
  assert.equal(d.endpunkt, 'wachstums_persistenz_folgequartale');
  assert.equal(d.selbstCheck.istReifSignal, d.selbstCheck.sollReifSignal);
  assert.equal(d.selbstCheck.istUnreifSignal, d.selbstCheck.sollUnreifSignal);
  assert.equal(d.selbstCheck.istReifKontrolle, d.selbstCheck.sollReifKontrolle);
  assert.equal(d.selbstCheck.istUnreifKontrolle, d.selbstCheck.sollUnreifKontrolle);
  assert.equal(d.selbstCheck.istReifSignal, 326);
  assert.equal(d.selbstCheck.istReifKontrolle, 4285);
  assert.equal(d.ergebnisdatenBeruehrt, false);
  assert.deepEqual(d.gelesenePfade, ['panel/panel-validierung.sqlite'],
    'Der Lauf darf ausschliesslich die Panel-Datei des angemeldeten Fensters lesen');
});

test('Der Pflicht-Stempel steht in BEIDEN Artefakten', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  assert.ok(d.lesart && d.lesart.includes(STEMPEL_KERN),
    'Das JSON-Artefakt fuehrt den Pflicht-Stempel nicht');
  assert.ok(fs.readFileSync(BERICHT, 'utf8').includes(STEMPEL_KERN),
    'Der Markdown-Bericht fuehrt den Pflicht-Stempel nicht');
});

test('Das committete Ergebnis haelt die 14-Felder-Sperre und die Trichter ein', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  const erlaubt = new Set(EINTRAG.allowedOutputs);
  for (const [name, arm] of Object.entries(d.arme)) {
    for (const feld of Object.keys(arm)) {
      assert.ok(erlaubt.has(feld), `${name}/${feld} ist nicht angemeldet`);
    }
    // Zerlegung und Slot-Summe muessen aufgehen — genau die Invarianten, die der
    // Lauf selbst prueft, hier am AUSGELIEFERTEN Artefakt nachgezogen.
    assert.equal(arm.persistenz_ja + arm.persistenz_nein + arm.unentscheidbar_gesamt,
      arm.verfolgbare_firmen, `${name}: die Zerlegung deckt die verfolgbaren Firmen nicht`);
    assert.equal(arm.persistenz_ja + arm.persistenz_nein, arm.nenner_persistenz);
    assert.equal(arm.folgequartale_verfuegbar + arm.folgequartale_zensiert,
      arm.verfolgbare_firmen * 4, `${name}: die Slot-Summe ist nicht 4 je Firma`);
    assert.ok(arm.verfolgbare_firmen <= arm.nenner_verfolgbarkeit);
    assert.ok(arm.persistenz_rate === null
      || (arm.persistenz_rate >= 0 && arm.persistenz_rate <= 1));
  }
});

test('Im Ergebnis steckt keine Kennung und kein Kurswert', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  const kern = JSON.stringify(d.arme);
  const leck = /"(?:cik|adsh|ticker|name|kurs|rendite|preis)"|OperatingIncomeLoss|us-gaap|USD/i;
  // Positive Gegenprobe zuerst: ohne sie waere ein leeres Ergebnis nicht von einer
  // kaputten Suche zu unterscheiden.
  assert.ok(leck.test('{"x":"OperatingIncomeLoss"}'), 'Die Leck-Suche selbst ist kaputt');
  assert.ok(leck.test('{"cik":"320193"}'), 'Eine Kennung wuerde nicht gefunden');
  assert.ok(!leck.test(kern),
    'Im Ergebnis steht eine Kennung, ein Konzeptname oder eine Kursgroesse');
});
