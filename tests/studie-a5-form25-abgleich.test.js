'use strict';

// A.5-Annex — Abgleich der echten Abgaenge gegen die lokale Form-25-Evidenz.
//
// DIE SACHE: Dieser Annex ist beschreibend (ENTSCHIED 38 + 54) und ausdruecklich
// NICHT die Bedingung des R15a-Abschlusses. Drei Dinge muessen festgenagelt sein:
//   1. Der BIT-ANKER 8/172. Er steht im gehashten Eintragstext; jede Abweichung
//      ist ein Sofort-Stopp. Ein Anker, der sich still verschiebt, belegt nichts.
//   2. Die KLAUSEL "Form 25 ist KEIN Todesbeleg". Ebenfalls gehasht. Sie muss eine
//      pruefbare Eigenschaft des Artefakts sein — wer sie entfernt, verwandelt
//      Ereignis-Evidenz in eine Zustands-Aussage.
//   3. Der STILLE-NULL-WAECHTER. Passen die CIK-Formate der beiden Quellen nicht,
//      liefert der Join null Treffer — und null Treffer liest sich wie ein Befund.
//      Genau diese Verwechslung muss abbrechen statt zu rechnen.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'studie-a5-form25-abgleich.py');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const RUN_ID = 'a5-form25-abgleich-2026-08-30';
const STEMPEL_KERN = 'bekannte Ueberlebens-Verzerrung, Obergrenzen-Lesart';
const TODESBELEG_KERN = 'Form 25 ist KEIN Todesbeleg';

function a5(args, optionen = {}) {
  return spawnSync(process.env.PYTHON || 'python', [SKRIPT, ...args],
    { encoding: 'utf8', cwd: REPO, ...optionen });
}

let selbsttest = null;
function selbsttestLauf() {
  if (selbsttest === null) selbsttest = a5(['--selbsttest']);
  return selbsttest;
}

const PFLICHT_PRUEFUNGEN = [
  'Fenster ist vier Fiskalquartale (365 Tage)',
  'Treffer im Fenster -> mit',
  'Treffer am letzten Fenstertag zaehlt noch',
  'Treffer einen Tag zu spaet -> ohne, aber ausgewiesen',
  'Treffer VOR dem Signal -> ohne, ausgewiesen',
  'gar keine Zeile fuer die CIK -> ohne, nicht ausgewiesen',
  "Fenster ragt aus dem Cache -> unentscheidbar, NICHT 'ohne'",
  // Der Stille-Null-Waechter. Ohne diese zwei Zeilen koennte der Join
  // stillschweigend leer laufen und die Leere als Befund gemeldet werden.
  'Ueberschneidung geht durch',
  'null Ueberschneidung ist ein ABBRUCH, kein Befund',
  // Der Bit-Anker, in beide Richtungen gebrochen.
  '8 im Signalarm geht durch',
  '172 im Kontrollpool geht durch',
  '7 statt 8 ist ein SOFORT-STOPP',
  '9 statt 8 ist ein SOFORT-STOPP',
  '171 statt 172 ist ein SOFORT-STOPP',
  'zwei Abgaenge, ein Treffer -> Quote 0.5',
  'je Signaljahr gegliedert',
  'Jahresblocke summieren auf den Arm',
  'gueltiger Block geht durch',
  'Zerlegung deckt Fallzahl nicht -> Abbruch',
  'ausserhalb > ohne -> Abbruch',
  'gueltige Ausgabe geht durch',
  'Kennungs-Liste im Umschlag bricht ab',
  "entfernte 'kein Todesbeleg'-Klausel bricht ab",
  'entfernter Pflicht-Stempel bricht ab',
  'verschobenes Fenster bricht ab',
  'Accession-Nummer im Arm bricht ab',
  'CIK im Jahresblock bricht ab',
  'Quote ausserhalb [0,1] bricht ab',
  'die 11 Skript-Felder sind genau 11',
  'Block- und Oben-Felder decken die Allowlist genau',
  'Anmeldung deckt Ausgabe (echtes Register)',
];

test('Der Selbsttest des A.5-Abgleichs laeuft gruen durch', () => {
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

test('Der Abgleich kennt nur das Prueffenster — kein Fenster-Schalter', () => {
  const lauf = a5(['--fenster', 'endtest']);
  assert.notEqual(lauf.status, 0, 'Ein Fenster-Schalter haette abgewiesen werden muessen');
  assert.match(`${lauf.stdout}${lauf.stderr}`, /unrecognized arguments|invalid choice|SPERRZONE/i);
});

test('Der Abgleich fasst weder Schluessel noch verschluesselte Datei an', () => {
  const quelle = fs.readFileSync(SKRIPT, 'utf8').toLowerCase();
  for (const wort of [`de${'crypt'}`, `ci${'pher'}`, `un${'seal'}`, `open${'ssl'}`]) {
    assert.ok(!quelle.includes(wort), `Der Abgleich enthaelt '${wort}'`);
  }
});

test('Der Abgleich holt nichts aus dem Netz', () => {
  // Der Eintragstext sagt "kein Netzzugriff, keine neue externe Quelle". Das muss
  // eine Eigenschaft des Codes sein, keine Zusicherung im Bericht.
  const quelle = fs.readFileSync(SKRIPT, 'utf8').toLowerCase();
  for (const wort of ['requests', 'urllib', 'http://', 'https://', 'fetch(']) {
    assert.ok(!quelle.includes(wort), `Der Abgleich enthaelt '${wort}'`);
  }
});

// ── Register-Bindung ─────────────────────────────────────────────────────────

const REGISTER = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const EINTRAG = REGISTER.events.find((e) => e.runId === RUN_ID);

test('Der Register-Eintrag traegt den gehashten 8/172-Selbst-Check', () => {
  assert.ok(EINTRAG, `Register-Eintrag ${RUN_ID} fehlt`);
  assert.equal(EINTRAG.typ, 'count_only_probe_authorized');
  assert.deepEqual(EINTRAG.fenster, ['pruefung']);
  assert.match(EINTRAG.begruendung,
    /exakt 8 Firmen im S-G-Signal-Arm und 172 Firmen im Kontrollpool/);
  assert.match(EINTRAG.begruendung, /SOFORT-STOPP/);
  // Die Label-Klausel und die zweite Lesequelle stehen im Eintragstext und sind
  // damit gehasht — der Eintrag verschweigt seinen eigenen Lesescope nicht.
  assert.match(EINTRAG.begruendung, /Form 25 ist KEIN Todesbeleg/);
  assert.match(EINTRAG.begruendung, /9\.028 Accessions/);
});

test('W9: Skript-Allowlist und Register-Anmeldung sind IDENTISCH', () => {
  const lauf = a5(['--allowlist-ausgeben']);
  assert.equal(lauf.status, 0, lauf.stderr);
  const felder = JSON.parse(lauf.stdout).allowedOutputs;
  assert.equal(felder.length, 11, 'Der Vertrag nennt exakt 11 Aggregatzaehler');
  assert.deepEqual(felder, [...EINTRAG.allowedOutputs].sort(),
    'Die Ausgabe-Allowlist des Skripts weicht vom Register-Eintrag ab');
});

test('W9: eine Freigabe eines FREMDEN Laufs deckt diesen Abgleich nicht', () => {
  const fremd = REGISTER.events.find(
    (e) => e.typ === 'count_only_probe_authorized' && e.runId !== RUN_ID
      && Array.isArray(e.allowedOutputs) && e.allowedOutputs.length > 0);
  assert.ok(fremd, 'Kein fremder Zaehlproben-Eintrag im Register gefunden');
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'a5-w9-'));
  try {
    const freigabe = path.join(verzeichnis, 'freigabe.json');
    fs.writeFileSync(freigabe, JSON.stringify({
      runId: fremd.runId,
      fenster: (fremd.fenster || [])[0],
      registerEventHash: fremd.eventHash,
      accessedAt: fremd.accessedAt,
      serverConfirmedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    }), 'utf8');
    const lauf = a5(['--freigabe', freigabe, '--data-root', verzeichnis,
      '--cache', verzeichnis]);
    assert.notEqual(lauf.status, 0, 'Eine fremde Freigabe haette abgewiesen werden muessen');
    assert.match(`${lauf.stdout}${lauf.stderr}`, /W9-ABBRUCH|W2-ABBRUCH/);
  } finally {
    fs.rmSync(verzeichnis, { recursive: true, force: true });
  }
});

// ── Der committete Lauf ──────────────────────────────────────────────────────

const ARTEFAKT = path.join(REPO, 'reports', 'studie',
  'a5-form25-abgleich-2026-08-30.json');
const BERICHT = path.join(REPO, 'reports', 'studie',
  'a5-form25-abgleich-2026-08-30.md');

test('Das committete Ergebnis traegt den bestandenen Bit-Anker 8/172', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  assert.equal(d.runId, RUN_ID);
  assert.equal(d.fenster, 'pruefung');
  assert.equal(d.variante, 'S-G');
  assert.equal(d.abgaenge_signal_arm, 8);
  assert.equal(d.abgaenge_kontrollpool, 172);
  assert.equal(d.abgaenge_gesamt, 180);
  assert.equal(d.selbstCheck.istAbgaengeSignal, d.selbstCheck.sollAbgaengeSignal);
  assert.equal(d.selbstCheck.istAbgaengeKontrollpool,
    d.selbstCheck.sollAbgaengeKontrollpool);
  assert.equal(d.ergebnisdatenBeruehrt, false);
  // GENAU drei Pfade, und zwar die beiden im gehashten Eintragstext benannten
  // Quellen: die Panel-Datei des angemeldeten Fensters plus die zwei Dateien des
  // Form-25-Evidenz-Caches. Die Liste wird als MENGE festgenagelt, nicht als
  // Obergrenze — eine vierte gelesene Datei waere eine unangemeldete Quelle und
  // muss hier rot werden, eine fehlende ein stiller Teilbestand.
  assert.deepEqual(d.gelesenePfade, [
    'panel/panel-validierung.sqlite',
    'submissions-bulk/d2-2016-2018-2026-08-30.jsonl',
    'submissions-bulk/d2-nachernte-2026-08-30.jsonl',
  ], 'Der Lauf liest genau die zwei angemeldeten Quellen — nicht mehr, nicht weniger');
});

test('Der Stille-Null-Waechter hat im echten Lauf wirklich getragen', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  assert.ok(d.selbstCheck.joinDeckungPanelCiksImCache > 0,
    'Null Ueberschneidung heisst kaputter Join, nicht leere Welt');
  assert.ok(d.selbstCheck.joinDeckungPanelCiksImCache <= d.selbstCheck.panelCiks);
});

test('Der Evidenz-Cache ist der angemeldete Bestand', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  assert.equal(d.evidenzCache.accessions, 9028,
    'Ein anderer Bestand waere eine andere — nicht angemeldete — Quelle');
  assert.equal(d.plausibles_fenster_tage, 365);
});

test('Stempel und Label-Klausel stehen in BEIDEN Artefakten', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  const md = fs.readFileSync(BERICHT, 'utf8');
  assert.ok(d.lesart && d.lesart.includes(STEMPEL_KERN));
  assert.ok(d.keineLabelSemantik && d.keineLabelSemantik.includes(TODESBELEG_KERN));
  assert.ok(md.includes(STEMPEL_KERN), 'Dem Bericht fehlt der Pflicht-Stempel');
  assert.ok(md.includes(TODESBELEG_KERN.toUpperCase())
    || md.includes(TODESBELEG_KERN),
  'Dem Bericht fehlt die Klausel "Form 25 ist KEIN Todesbeleg"');
});

test('Das committete Ergebnis haelt die 11-Felder-Sperre und die Trichter ein', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  const erlaubt = new Set(EINTRAG.allowedOutputs);
  for (const [name, arm] of Object.entries(d.arme)) {
    const bloecke = [['arm', arm], ...Object.entries(arm.jahre).map(
      ([jahr, b]) => [`jahr ${jahr}`, b])];
    for (const [ort, b] of bloecke) {
      for (const feld of Object.keys(b)) {
        if (feld === 'jahre') continue;
        assert.ok(erlaubt.has(feld), `${name}/${ort}/${feld} ist nicht angemeldet`);
      }
      assert.equal(
        b.mit_form25_treffer + b.ohne_form25_treffer + b.unentscheidbar_gesamt,
        b.fallzahl, `${name}/${ort}: die Zerlegung deckt die Fallzahl nicht`);
      assert.equal(b.mit_form25_treffer + b.ohne_form25_treffer,
        b.nenner_form25_abgleich);
      // ausserhalb ist per Konstruktion eine Teilmenge von ohne.
      assert.ok(b.ausserhalb_plausiblem_fenster <= b.ohne_form25_treffer,
        `${name}/${ort}: mehr Treffer-ausserhalb als Firmen ohne Treffer`);
      assert.ok(b.trefferquote_form25 === null
        || (b.trefferquote_form25 >= 0 && b.trefferquote_form25 <= 1));
    }
    const summe = Object.values(arm.jahre)
      .reduce((s, b) => s + b.fallzahl, 0);
    assert.equal(summe, arm.fallzahl,
      `${name}: die Jahresblocke summieren nicht auf den Arm`);
  }
});

test('Im Ergebnis steckt keine Kennung und keine Accession-Nummer', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  const kern = JSON.stringify(d.arme);
  const leck = /"(?:cik|adsh|ticker|name|accessionNumber)"|\d{10}-\d{2}-\d{6}|us-gaap/i;
  assert.ok(leck.test('{"cik":320193}'), 'Die Leck-Suche selbst ist kaputt');
  assert.ok(leck.test('{"x":"0000876882-20-000006"}'),
    'Eine Accession-Nummer wuerde nicht gefunden');
  assert.ok(!leck.test(kern),
    'Im Ergebnis steht eine Kennung oder eine Accession-Nummer');
});
