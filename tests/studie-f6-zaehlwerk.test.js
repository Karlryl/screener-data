'use strict';

// F6-ZAEHLWERK - die Waechter W-A, W-B und W-C.
// _COURT-F6-ZAEHLWERK-2026-09-01, Auflagen F6-C1..C11, ratifiziert 02:22.
//
// W-A (F6-C4) ist die BEDINGUNG des Urteils, nicht Zierrat: Z3 hat sein JA
// daran gehaengt ("Ohne VL6-2 stimme ich mit NEIN"), und KZ-2 kippt (A) auf
// NEIN, sobald einer der vier mauertragenden Einstiegspunkte doch gerufen
// wird. Ohne protokollierte Bruchprobe gilt der Waechter als nicht
// abgenommen (KV-3).
//
// KEIN TEST FASST EIN PANEL AN. Alle Proben laufen ueber den Syntaxbaum, ueber
// den Selbsttest oder ueber Fixture-Zahlen.
//
// Usage: node tests/studie-f6-zaehlwerk.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const REPO = path.join(__dirname, '..');
const ZAEHLWERK = path.join(REPO, 'scripts', 'studie-f6-zaehlwerk.py');
const LAEUFER = path.join(REPO, 'scripts', 'studie-f6-lauf.py');

// Die vier mauertragenden Einstiegspunkte, mit ihren Stellen aus dem Urteil.
const MAUER_EINSTIEGE = ['pruefe_mauer', 'oeffne_nur_lesend',
  'oeffne_zwischenstand', 'schreibe_report'];

function tempdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const tmp = tempdir('f6-zw-');

// ── W-A: der Anker sitzt am Syntaxbaum ──────────────────────────────────────
// Gesucht werden ALLE Aufrufformen: `e2.oeffne_zwischenstand(...)` (Attribut),
// `oeffne_zwischenstand(...)` (Name) und `getattr(e2, "...")`. Eine Regex ueber
// den Quelltext waere hier falsch: die Namen stehen in beiden Dateien
// absichtlich in Kommentaren und Meldungstexten - genau das darf NICHT rot
// machen, und Probe (d) misst diesen Unterschied.
const AST_RUFE = [
  'import ast, sys, json',
  'baum = ast.parse(open(sys.argv[1], encoding="utf-8").read())',
  'rufe = set()',
  'for k in ast.walk(baum):',
  '    if isinstance(k, ast.Call):',
  '        f = k.func',
  '        if isinstance(f, ast.Attribute): rufe.add(f.attr)',
  '        elif isinstance(f, ast.Name):',
  '            rufe.add(f.id)',
  '            if f.id == "getattr":',
  '                for a in k.args[1:2]:',
  '                    if isinstance(a, ast.Constant) and isinstance(a.value, str):',
  '                        rufe.add(a.value)',
  'print(json.dumps(sorted(rufe)))',
].join('\n');

function aufrufe(datei) {
  const r = spawnSync(python, ['-c', AST_RUFE, datei], { encoding: 'utf8' });
  assert.equal(r.status, 0, `Ruf-Leser gescheitert: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('W-A: das Zaehlwerk ruft KEINEN der vier mauertragenden Einstiegspunkte', () => {
  const gefunden = aufrufe(ZAEHLWERK).filter((n) => MAUER_EINSTIEGE.includes(n));
  assert.deepEqual(gefunden, [],
    'F6-C4 ist Bedingung des Urteils (Z3: "Ohne VL6-2 stimme ich mit NEIN"). '
    + `Gerufen wird: ${gefunden.join(', ')}`);
});

test('W-A: auch der Laeufer ruft keinen der vier', () => {
  const gefunden = aufrufe(LAEUFER).filter((n) => MAUER_EINSTIEGE.includes(n));
  assert.deepEqual(gefunden, [], `Gerufen wird: ${gefunden.join(', ')}`);
});

test('W-A BRUCHPROBE: ein eingebauter Aufruf macht den Waechter rot', () => {
  const kopie = path.join(tmp, 'gebrochen.py');
  const quelle = fs.readFileSync(ZAEHLWERK, 'utf8').replace(
    '    panel = eigene_panel_verbindung(panel_pfad)',
    '    panel = module["e2"].oeffne_nur_lesend(panel_pfad)');
  assert.ok(quelle.includes('oeffne_nur_lesend(panel_pfad)'),
    'die Bruchprobe hat nichts eingebaut');
  fs.writeFileSync(kopie, quelle, 'utf8');
  const gefunden = aufrufe(kopie).filter((n) => MAUER_EINSTIEGE.includes(n));
  assert.deepEqual(gefunden, ['oeffne_nur_lesend'],
    'der Waechter sieht den eingebauten Aufruf nicht');
});

test('W-A GEGENPROBE: die Namen in Kommentaren und Meldungen machen NICHT rot', () => {
  // Ohne diese Probe waere nicht belegt, dass der Anker am Syntaxbaum haengt.
  // Beide Dateien nennen die vier Einstiegspunkte absichtlich im Fliesstext.
  const text = fs.readFileSync(ZAEHLWERK, 'utf8');
  for (const n of MAUER_EINSTIEGE) {
    assert.ok(text.includes(n),
      `${n} sollte im Fliesstext vorkommen - sonst misst die Gegenprobe nichts`);
  }
  assert.deepEqual(aufrufe(ZAEHLWERK).filter((n) => MAUER_EINSTIEGE.includes(n)), []);
});

// ── Selbsttest, W-B und W-C ─────────────────────────────────────────────────

test('der Selbsttest des Zaehlwerks ist gruen (W-B, W-C, BEIN 3, F6-C2/C6)', () => {
  const r = spawnSync(python, [ZAEHLWERK, 'selbsttest'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selbsttest: \d+ ok, 0 FAIL/);
  assert.doesNotMatch(r.stdout, /FAIL /);
});

function pyProbe(code) {
  return spawnSync(python, ['-c', [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("zw", r"${ZAEHLWERK}")`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    code,
  ].join('\n')], { encoding: 'utf8' });
}

test('W-B: der Arbeitspfad wird gegen VERBOTEN_RE geprueft, auch ueber Elternverzeichnisse', () => {
  const r = pyProbe([
    'aus = {}',
    'for p in ("a/validierung/x.sqlite", "a/endtest/x.sqlite",',
    '          "a/pruefenster/x.sqlite", "a/x.key", "a/schluessel/x.db",',
    '          "arbeit/f6/zwischenstand.sqlite"):',
    '    try:',
    '        m.pruefe_arbeitspfad(p); aus[p] = "DURCH"',
    '    except m.ZaehlwerkAbbruch: aus[p] = "ABBRUCH"',
    'print("ERG:" + json.dumps(aus))',
  ].join('\n'));
  const erg = JSON.parse(r.stdout.split('\n').find((z) => z.startsWith('ERG:')).slice(4));
  assert.equal(erg['a/validierung/x.sqlite'], 'ABBRUCH');
  assert.equal(erg['a/endtest/x.sqlite'], 'ABBRUCH');
  assert.equal(erg['a/pruefenster/x.sqlite'], 'ABBRUCH');
  assert.equal(erg['a/x.key'], 'ABBRUCH');
  assert.equal(erg['a/schluessel/x.db'], 'ABBRUCH');
  assert.equal(erg['arbeit/f6/zwischenstand.sqlite'], 'DURCH',
    'GEGENPROBE: ein sauberer Arbeitspfad muss durchgehen');
});

test('W-C BRUCHPROBE: die Tally-Invariante bricht bei n_g > 1 und feuert sichtbar', () => {
  const r = pyProbe([
    'class ZP:',
    '    @staticmethod',
    '    def ist_zensiert(e, e2, rand): return bool(e.get("zensiert"))',
    'gut = m._tally([{"cik": "1"}, {"cik": "2"}], [{"cik": "1"}], None, ZP, 0, "p")',
    'print("GUT:" + json.dumps(gut[0]))',
    'try:',
    '    m._tally([{"cik": "1"}, {"cik": "1"}], [{"cik": "1"}], None, ZP, 0, "p")',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(r.stdout, /^GUT:\[\[0, 1\], \[1, 1\]\]$/m,
    'GEGENPROBE: einelementige Klumpen gehen durch');
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /W-C-ABBRUCH/);
  assert.match(r.stdout, /R3-ABBRUCH in scripts\/studie-zaehlprobe\.py:507-509/);
});

test('der Rueckgabewert traegt NIE eine Firmen-Kennung (F6-B14 / F6-C1)', () => {
  const r = pyProbe([
    'class ZP:',
    '    @staticmethod',
    '    def ist_zensiert(e, e2, rand): return False',
    'k, n, z, zens = m._tally([{"cik": "APPLE-320193"}, {"cik": "2"}],',
    '                         [{"cik": "APPLE-320193"}], None, ZP, 0, "p")',
    'print("ROH:" + json.dumps({"klumpen": k, "n": n, "zaehler": z}))',
  ].join('\n'));
  const roh = r.stdout.split('\n').find((z) => z.startsWith('ROH:')).slice(4);
  assert.doesNotMatch(roh, /APPLE/, 'eine Kennung ist in den Rueckgabewert geleckt');
  assert.doesNotMatch(roh, /320193/);
  assert.deepEqual(JSON.parse(roh).klumpen, [[0, 1], [1, 1]]);
});

// ── Die Aequivalenz-Sollwerte, gegen ihre Artefakte ─────────────────────────

test('BEIN 1: die Sollwerte im Zaehlwerk stimmen mit dem Schwellen-Satz ueberein', () => {
  const satz = JSON.parse(fs.readFileSync(path.join(REPO, 'protocol',
    'early-detection', '2.1.0', 'e2-schwellen-satz-2026-08-30.json'), 'utf8'));
  const r = pyProbe(['print("B1:" + json.dumps(m.BEIN1_SOLL))']);
  const b1 = JSON.parse(r.stdout.split('\n').find((z) => z.startsWith('B1:')).slice(3));
  assert.deepEqual(b1.aequivalenzTorSoll, satz.provenienz.aequivalenzTorSoll,
    'die Sollwerte des Zaehlwerks weichen vom eingefrorenen Artefakt ab');
  assert.equal(b1.bindungen.konzeptlisteSha256, satz.provenienz.konzeptlisteSha256);
  assert.equal(b1.bindungen.modulSha256, satz.provenienz.modulSha256);
  for (const v of ['S-U', 'S-G']) {
    assert.equal(b1.jeFamilie[v].firmenReif, satz.jeFamilie[v].firmenReif);
    assert.equal(b1.jeFamilie[v].firmenUnreif, satz.jeFamilie[v].firmenUnreif);
    assert.equal(b1.jeFamilie[v].auswertbar_band,
      satz.jeFamilie[v].kalibrierungsWeg[0].auswertbar_band);
    assert.equal(b1.jeFamilie[v].schritt0_firmen_reif,
      satz.jeFamilie[v].kalibrierungsWeg[0].firmen_reif);
  }
});

test('BEIN 2: die Sollwerte stimmen mit E4d-kadenz-entdeckung ueberein, samt SHA', () => {
  const p = path.join(REPO, 'reports', 'studie', 'E4d-kadenz-entdeckung-2026-08-19.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const b = d['baender']['2009-2015'].varianten;
  const r = pyProbe([
    'print("B2:" + json.dumps({str(k): v for k, v in m.BEIN2_SOLL.items()}))',
    'print("SHA:" + m.BEIN2_QUELLE_SHA)',
    'print("RAHMEN:" + json.dumps(m.BEIN2_RAHMEN))',
  ].join('\n'));
  const zeilen = r.stdout.split('\n');
  const b2 = JSON.parse(zeilen.find((z) => z.startsWith('B2:')).slice(3));
  const sha = zeilen.find((z) => z.startsWith('SHA:')).slice(4).trim();
  const rahmen = JSON.parse(zeilen.find((z) => z.startsWith('RAHMEN:')).slice(7));

  // Der Artefakt-Arm heisst dort "kontrolle", im F6-Vertrag "kontrollpool".
  const armname = { signal: 'signal', kontrollpool: 'kontrolle' };
  for (const v of ['S-U', 'S-G']) {
    for (const arm of ['signal', 'kontrollpool']) {
      const soll = b2[`('${v}', '${arm}')`];
      const z = b[v][armname[arm]];
      assert.equal(soll.zaehler, z.zaehler_kadenz, `${v}/${arm} Zaehler`);
      assert.equal(soll.nenner, z.nenner_kadenz, `${v}/${arm} Nenner`);
      assert.equal(soll.zensiert, z.zensiert_kadenz, `${v}/${arm} Zensur`);
    }
  }
  assert.equal(rahmen.panelRand, d.panelRand);
  assert.equal(rahmen.perzentil, d.perzentil);

  const gemessen = require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(p)).digest('hex');
  assert.equal(sha, gemessen, 'der gebundene SHA des Bein-2-Artefakts driftet');
});

test('BEIN 3: die Literale stehen WOERTLICH in der Praeregistrierung', () => {
  const praereg = fs.readFileSync(path.join(REPO, 'protocol', 'early-detection',
    '2.0.0', 'preregistration.json'), 'utf8');
  const r = pyProbe(['print("B3:" + json.dumps(m.BEIN3_LITERALE))']);
  const b3 = JSON.parse(r.stdout.split('\n').find((z) => z.startsWith('B3:')).slice(3));
  for (const [name, literal] of Object.entries(b3)) {
    if (name === 'nie_stillschweigend') continue; // Regel, kein Zitat
    assert.ok(praereg.includes(literal),
      `BEIN 3 Literal ${name} steht nicht woertlich in der Praereg`);
  }
  // Und die Kernzahl der Zensur-Untergrenze, gegen ein ausgeschriebenes Literal.
  assert.ok(b3.rechtsZensur_definition.includes('4 * 80 Tage'));
  assert.ok(b3.auffindbarkeit_formel.includes(
    'reife Erst-Ereignisse / (Erst-Ereignisse - rechts-zensierte Erst-Ereignisse)'));
});

test('BEIN 3 BRUCHPROBE: ein verstelltes Literal reisst das Bein', () => {
  const r = pyProbe([
    'm.BEIN3_LITERALE["rechtsZensur_definition"] = "ordinal(accepted) + 4 * 90 Tage"',
    'try:',
    '    m.aequivalenz_bein3()',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(r.stdout, /^ABBRUCH:/m,
    'ein verstelltes Wortlaut-Literal muss BEIN 3 reissen');
  assert.match(r.stdout, /rechtsZensur_definition/);
});

test('F6-C2: ein verstellter Modul-Hash bricht VOR dem Laden ab', () => {
  const r = pyProbe([
    'm.VERSIEGELT_SHA = "0" * 64',
    'try:',
    '    m.lade_regelmodule()',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /weicht von der Bindung ab/);
});

test('der Vertrag: zaehle() verlangt einen geprueften Arbeitspfad, nie einen erfundenen', () => {
  const r = pyProbe([
    'try:',
    '    m.zaehle("egal.sqlite", "S-U", "signal")',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /Arbeitspfad/);
  // Und unbekannte Arme/Varianten sind ABBRUECHE, keine Vorgabewerte.
  const a = pyProbe([
    'try:',
    '    m.zaehle("x", "S-U", "drittes_bein", arbeit_pfad="a/b.sqlite")',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(a.stdout, /^ABBRUCH:/m);
});
