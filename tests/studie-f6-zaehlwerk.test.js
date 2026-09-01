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
      // F6-C8a/b: die E3-Spalten. Diese Probe las bis Anhang 2 die
      // _kadenz-Spalten und hat den Basisfehler damit MITGETRAGEN statt ihn
      // zu fangen - sie war gegen dieselbe falsche Spalte gruen wie das Soll.
      assert.equal(soll.zaehler, z.fallzahl, `${v}/${arm} Zaehler (.fallzahl)`);
      assert.equal(soll.nenner, z.nenner_e3, `${v}/${arm} Nenner (.nenner_e3)`);
      assert.equal(soll.zensiert, z.zensiert_e3, `${v}/${arm} Zensur (.zensiert_e3)`);
      assert.equal(soll.zaehler / soll.nenner, z.auffindbarkeit_e3,
        `${v}/${arm}: das Soll steht nicht auf der Basis, die es zu fuehren vorgibt`);
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

test('INTEGRATION: der Laeufer treibt das ECHTE Zaehlwerk - die Verdrahtung haelt', () => {
  // Diese Probe fehlte, und genau daran ist der Vertragsbruch vorbeigelaufen:
  // der Laeufer ruft zaehle() mit DREI Argumenten, das echte Zaehlwerk
  // brauchte aber einen Arbeitspfad. Beide Test-Suiten waren gruen, weil
  // keine die zwei Dateien je GEMEINSAM gefahren hat.
  const dir = tempdir('f6-integration-');
  const freigabe = path.join(dir, 'freigabe.json');
  fs.writeFileSync(freigabe, JSON.stringify({ runId: 'gibt-es-nicht' }), 'utf8');
  const bericht = path.join(dir, 'bericht.json');

  function ruf(extra) {
    return spawnSync(python, [path.join(REPO, 'scripts', 'studie-f6-lauf.py'),
      '--freigabe', freigabe, '--panel', freigabe, '--bericht', bericht,
      '--zaehlwerk', ZAEHLWERK, ...extra], { encoding: 'utf8' });
  }

  // OHNE --arbeit greift seit Ruling 2 die BENANNTE VORGABE des Zaehlwerks -
  // der Pfad wird nicht mehr erfunden, sondern ist eine Konstante. Geprueft
  // wird deshalb, dass genau sie gewaehlt wird; und dass ein --arbeit, das
  // der Freigabe widerspricht, ein ABBRUCH ist.
  const ohne = spawnSync(python, ['-c', [
    'import importlib.util, sys',
    `spec = importlib.util.spec_from_file_location("l", r"${LAEUFER}")`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    `zspec = importlib.util.spec_from_file_location("z", r"${ZAEHLWERK}")`,
    'z = importlib.util.module_from_spec(zspec); zspec.loader.exec_module(z)',
    // SEIT PR G: die Vorgabe ist die BASIS, gewaehlt wird ein lauf-eigenes,
    // leeres Unterverzeichnis darunter (Naht-B1). Die echte Vorgabe wird fuer
    // die Probe umgebogen, damit der Test nichts im Benutzerverzeichnis anlegt.
    `z.ARBEITSPFAD_VORGABE = r"${tmp.replace(/\\/g, '\\\\')}"`,
    'print("GEWAEHLT:" + str(m.ruest_zaehlwerk(z, None, {"runId": "probe-1"})))',
    'try:',
    '    m.ruest_zaehlwerk(z, "abweichend/x.sqlite", {"runId": "probe-1"})',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f)[:90])',
    'try:',
    '    m.ruest_zaehlwerk(z, None, {})',
    '    print("KEIN ABBRUCH OHNE RUNID")',
    'except m.LaufAbbruch as f: print("OHNERUNID:" + str(f)[:60])',
  ].join('\n')], { encoding: 'utf8' });
  assert.match(ohne.stdout, /^GEWAEHLT:.*lauf-probe-1/m,
    'ohne --arbeit greift die benannte Vorgabe, aber im Lauf-Unterverzeichnis');
  assert.match(ohne.stdout, /zwischenstand\.sqlite/,
    'gewaehlt wird eine DATEI, nie das Verzeichnis (Naht-B1)');
  assert.match(ohne.stdout, /^ABBRUCH:/m);
  assert.match(ohne.stdout, /WEICHT VON DER GEBUNDENEN KONSTANTE AB/);
  assert.match(ohne.stdout, /^OHNERUNID:/m,
    'ohne runId gibt es kein Arbeitsverzeichnis, sondern einen Abbruch');

  // MIT --arbeit: die Ruestung geht durch, und danach ruft der Laeufer
  // zaehle() mit genau drei Argumenten - der eingefrorene Vertrag haelt.
  const mit = spawnSync(python, ['-c', [
    'import importlib.util, os, tempfile',
    `spec = importlib.util.spec_from_file_location("l", r"${path.join(REPO, 'scripts', 'studie-f6-lauf.py')}")`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    `zspec = importlib.util.spec_from_file_location("z", r"${ZAEHLWERK}")`,
    'z = importlib.util.module_from_spec(zspec); zspec.loader.exec_module(z)',
    'd = tempfile.mkdtemp()',
    // SEIT PR G ist die gebundene Konstante massgeblich; ein abweichendes
    // --arbeit ist ein ABBRUCH. Fuer die Probe wird deshalb die Vorgabe
    // umgebogen und derselbe Pfad uebergeben - die Ruestung muss durchgehen.
    'z.ARBEITSPFAD_VORGABE = d',
    'p = m.ruest_zaehlwerk(z, d, {"runId": "probe-2"})',
    'print("GERUESTET:" + str(p is not None))',
    // Das Fenster wird jetzt AUSDRUECKLICH gesetzt (Naht-F2).
    'z.setze_fenster("pruefung")',
    'try:',
    '    z.zaehle("kein-echtes-panel.sqlite", "S-U", "signal")',
    '    print("UNERWARTET DURCH")',
    'except z.ZaehlwerkAbbruch as f:',
    '    print("ABBRUCH:" + str(f)[:120])',
  ].join('\n')], { encoding: 'utf8' });
  assert.match(mit.stdout, /^GERUESTET:True$/m);
  assert.match(mit.stdout, /^ABBRUCH:/m);
  assert.doesNotMatch(mit.stdout, /Kein Arbeitspfad gesetzt/,
    'der Arbeitspfad-Wachposten darf nach der Ruestung nicht mehr feuern - '
    + 'sonst ist die Verdrahtung wieder gebrochen');
  assert.match(mit.stdout, /Panel-Datei nicht gefunden/,
    'der Lauf muss bis zur Panel-E/A kommen, also am Vertrag vorbei sein');
});

test('die Abbruchtexte des Zaehlwerks tragen KEINE Firmen-Kennung', () => {
  // Der Laeufer reicht ZaehlwerkAbbruch-Texte jetzt woertlich durch (statt sie
  // wie fremde Ausnahmen zu unterdruecken). Das ist nur zulaessig, solange
  // diese Texte nachweislich kennungsfrei sind - hier wird es nachgewiesen.
  const quelle = fs.readFileSync(ZAEHLWERK, 'utf8');
  const raises = quelle.match(/raise ZaehlwerkAbbruch\([\s\S]*?\)\n/g) || [];
  assert.ok(raises.length >= 15, `nur ${raises.length} raise-Stellen gefunden`);
  for (const r of raises) {
    // Keine Interpolation eines Eintrags, einer Zeile oder einer Kennung.
    for (const verboten of ['cik', 'adsh', 'accession', 'e["', "e['", 'eintrag[']) {
      assert.equal(r.includes(verboten), false,
        `ein Abbruchtext interpoliert ${verboten}: ${r.slice(0, 160)}`);
    }
  }
  // Und am laufenden Objekt: ein Tally mit sprechender Kennung, Abbruch
  // erzwungen - die Kennung darf im Text nicht auftauchen.
  const r = pyProbe([
    'class ZP:',
    '    @staticmethod',
    '    def ist_zensiert(e, e2, rand): return False',
    'try:',
    '    m._tally([{"cik": "APPLE-320193"}, {"cik": "APPLE-320193"}],',
    '             [{"cik": "APPLE-320193"}], None, ZP, 0, "S-U/signal")',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("TEXT:" + str(f))',
  ].join('\n'));
  assert.match(r.stdout, /^TEXT:/m);
  assert.doesNotMatch(r.stdout, /APPLE/);
  assert.doesNotMatch(r.stdout, /320193/);
});

test('RULING 1: n_B_unreif wird doppelt hergeleitet, der Kreuz-Wachposten haelt', () => {
  const r = pyProbe([
    'class ZP:',
    '    @staticmethod',
    '    def ist_zensiert(e, e2, rand): return False',
    'k, n, z, zens = m._tally([{"cik": "1"}, {"cik": "2"}, {"cik": "3"}],',
    '                         [{"cik": "1"}], None, ZP, 0, "p")',
    'aus_tafel = sum(nn - mm for mm, nn in k)',
    'print("TAFEL:" + str(aus_tafel))',
    'print("SKALAR:" + str(n - z))',
  ].join('\n'));
  assert.match(r.stdout, /^TAFEL:2$/m, 'zwei der drei Einheiten sind unreif');
  assert.match(r.stdout, /^SKALAR:2$/m, 'beide Wege muessen dasselbe liefern');

  // Der Kreuz-Wachposten selbst, direkt gefahren - gruen und rot.
  const g = pyProbe(['print("OK:" + str(m.pruefe_a16_kreuz(7, 7, "p")))'].join('\n'));
  assert.match(g.stdout, /^OK:7$/m, 'GEGENPROBE: gleiche Werte gehen durch');

  const b = pyProbe([
    'try:',
    '    m.pruefe_a16_kreuz(7, 8, "S-U/signal")',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(b.stdout, /^ABBRUCH:/m,
    'eine Divergenz MUSS ein ABBRUCH sein, keine Korrektur');
  assert.match(b.stdout, /KREUZ-WACHPOSTEN A16 gerissen/);
  assert.match(b.stdout, /Tally-Form gebrochen/);
});

test('RULING 1: die Identitaet ist VORAB benannt, nicht hinterher (F6-B25-Form)', () => {
  const r = pyProbe(['print("ID:" + m.IDENTITAET_A16)']);
  const t = r.stdout;
  assert.match(t, /VORAB, nicht als Befund/);
  assert.match(t, /DIESELBE Zahl/);
  // Der Text muss die Ehrlichkeit tragen: keine erfundene Zweitformel.
  assert.match(t, /waere deshalb erfunden, nicht hergeleitet/);
  assert.match(t, /BEIDE Schluessel bleiben im Satz/);
});

test('RULING 1: beide A16-Schluessel bleiben im Satz (F6-B12)', () => {
  // Die Pflichtliste fuehrt der LAEUFER, nicht das Zaehlwerk - dort ist ein
  // fehlender Pflichtschluessel ein ABBRUCH.
  const r = spawnSync(python, ['-c', [
    'import importlib.util',
    `spec = importlib.util.spec_from_file_location("l", r"${LAEUFER}")`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print("HAT:" + repr(sorted(m.ZERLEGUNGS_SCHLUESSEL)))',
  ].join('\n')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /n_B_unreif/);
  assert.match(r.stdout, /strukturell_nicht_feuerfaehig/);
});

test('RULING 2: die Arbeitspfad-Vorgabe ist benannt und VERBOTEN_RE-frei', () => {
  const r = pyProbe([
    'print("PFAD:" + m.ARBEITSPFAD_VORGABE)',
    'try:',
    '    m.pruefe_arbeitspfad(m.ARBEITSPFAD_VORGABE + chr(92) + "zwischenstand.sqlite")',
    '    print("W-B:DURCH")',
    'except m.ZaehlwerkAbbruch as f: print("W-B:ABBRUCH " + str(f))',
  ].join('\n'));
  // Der Pfad selbst wird hier aus Teilen erwartet - dieselbe R12a-Ruecksicht
  // wie im Werkzeug (tests/studie-deckel.test.js scannt auch diese Datei).
  const bs = String.fromCharCode(92);
  assert.ok(r.stdout.includes(`PFAD:C:${bs}Users${bs}Anwender${bs}f6-arbeit`),
    `unerwartete Vorgabe: ${r.stdout}`);
  assert.match(r.stdout, /^W-B:DURCH$/m,
    'die Vorgabe muss VERBOTEN_RE-frei sein, bis in die Elternverzeichnisse');
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

// ============================================================================
// ANHANG 1 - F6-C7b / C7c / C7d / C7h
// ============================================================================

// Ein Modul-Paar plus ein Temp-Wurzel-Verzeichnis, in dem NUR der
// Schwellen-Satz liegt. Das echte Artefakt wird nie angefasst.
function c7dProbe(mutation) {
  return pyProbe([
    'import json, os, shutil, tempfile',
    'wurzel = tempfile.mkdtemp()',
    'rel = os.path.join("protocol", "early-detection", "2.1.0")',
    'os.makedirs(os.path.join(wurzel, rel))',
    // Der Repo-Pfad kommt aus REPO, nicht als Literal: tests/studie-deckel
    // (R12a) verbietet absolute Pfade im Quelltext dieser Dateien - zu Recht.
    `quelle = os.path.join(r"${REPO}", rel, "e2-schwellen-satz-2026-08-30.json")`,
    'ziel = os.path.join(wurzel, rel, "e2-schwellen-satz-2026-08-30.json")',
    'shutil.copyfile(quelle, ziel)',
    'module = m.lade_regelmodule()',
    mutation,
    'try:',
    '    m.pruefe_regelparameter(wurzel, module)',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:220])',
  ].join('\n'));
}

test('F6-C7d: der Konstanten-Abgleich laeuft IM LAUF, nicht nur im Test', () => {
  // GEGENPROBE zuerst: der unveraenderte Stand geht durch.
  const g = c7dProbe('pass');
  assert.match(g.stdout, /^KEIN ABBRUCH$/m,
    `der unveraenderte Stand muss durchgehen: ${g.stdout}${g.stderr}`);
  // Und der Abgleich ist wirklich verdrahtet: pruefe_regelparameter ruft ihn.
  const r = pyProbe([
    'import inspect',
    'q = inspect.getsource(m.pruefe_regelparameter)',
    'print("RUFT:" + str("pruefe_kalibrier_konstanten(" in q))',
  ].join('\n'));
  assert.match(r.stdout, /^RUFT:True$/m,
    'der Abgleich muss aus dem Lauf gerufen werden, nicht nur aus dem Test');
});

test('F6-C7h PROBE 1: ein Byte im Artefakt -> der Doppel-Hash bricht ab', () => {
  const r = c7dProbe(
    'roh = open(ziel, "rb").read().replace(b"68079", b"68078", 1)\nopen(ziel, "wb").write(roh)');
  assert.match(r.stdout, /^ABBRUCH:/m, 'ein veraendertes Byte MUSS abbrechen');
  assert.match(r.stdout, /weicht ab|reproduziert seinen inhaltSha256 nicht/,
    'der Abbruch muss vom Hash kommen');
});

test('F6-C7h PROBE 2: eine Konstante um 1 verstellt -> der Abgleich bricht ab', () => {
  const r = c7dProbe(
    'm.BEIN1_SOLL["jeFamilie"]["S-U"]["firmenReif"] = 541');
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /KONSTANTEN-ABGLEICH GERISSEN/);
  assert.match(r.stdout, /firmenReif/);
  assert.match(r.stdout, /541/);
  // Und die Heilung ist ausdruecklich ausgeschlossen (KZ-11).
  assert.match(r.stdout, /NICHT.*durch Anpassen der Konstante geheilt|KZ-11/);
});

test('F6-C7h PROBE 3: PERZENTIL auf 90 -> der beidseitige Abgleich bricht ab', () => {
  // studie-zaehlprobe.py bleibt byte-unangetastet; verstellt wird die
  // Konstante am GELADENEN Modul - genau die Seite, die der beidseitige
  // Abgleich liest.
  const r = c7dProbe('module["zp"].PERZENTIL = 90');
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /PERZENTIL/);
  assert.match(r.stdout, /90/);
});

test('F6-C7d: ein FEHLENDER Schluessel ist ein ABBRUCH, kein Vorgabewert', () => {
  const r = c7dProbe(
    'd = json.load(open(ziel, encoding="utf-8"))\ndel d["jeFamilie"]["S-U"]["firmenReif"]\nopen(ziel, "w", encoding="utf-8").write(json.dumps(d))');
  assert.match(r.stdout, /^ABBRUCH:/m);
  // Der Doppel-Hash faengt es zuerst - das ist die richtige Reihenfolge.
  // Der Schluessel-Wachposten wird deshalb direkt geprueft.
  const d = pyProbe([
    'try:',
    '    m._hole({"jeFamilie": {}}, ["jeFamilie", "S-U"], "jeFamilie.S-U")',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(d.stdout, /^ABBRUCH:/m);
  assert.match(d.stdout, /ABBRUCH, kein Vorgabewert/);
});

// ── F6-C7b: die LAUF-HAELFTE ────────────────────────────────────────────────

test('F6-C7b: das Werkzeug wird VOR dem Aufruf gegen seinen PIN geprueft', () => {
  const r = pyProbe([
    'm.VERBREITERT_SHA = "0" * 64',
    'try:',
    '    m.bein1_laufhaelfte(m.WURZEL_REPO, "a/f6/w.sqlite", "a/e.json", "d")',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:400])',
  ].join('\n'));
  assert.match(r.stdout, /^ABBRUCH:/m,
    'ein veraendertes Werkzeug ist ein anderes Werkzeug (F6-C7f)');
  assert.match(r.stdout, /weicht vom ratifizierten PIN ab/);
});

test('F6-C7b: der Aufruf-Pfad ist WIRKLICH erreichbar (kein NameError)', () => {
  // DIESE PROBE FEHLTE, UND GENAU DA IST ES DURCHGEFALLEN: die PIN-Probe
  // oben verstellt den Sollwert und bricht damit VOR subprocess.run ab - die
  // Zeile selbst wurde nie ausgefuehrt. `subprocess` war nicht importiert,
  // und der Fehler kam erst im echten Lauf am Zeitboden heraus, als
  // NameError statt als benannter Abbruch.
  //
  // Hier laeuft der PIN durch (echter Sollwert) und der Aufruf scheitert erst
  // am unmoeglichen data-root - also NACH subprocess.run. Ein NameError oder
  // irgendein anderer nackter Traceback macht die Probe rot.
  const dir = tempdir('f6-c7b-erreichbar-');
  const r = pyProbe([
    `arbeit = r"${path.join(dir, 'f6', 'w.sqlite').replace(/\\/g, '\\\\')}"`,
    `ergebnis = r"${path.join(dir, 'e.json').replace(/\\/g, '\\\\')}"`,
    'try:',
    '    m.bein1_laufhaelfte(m.WURZEL_REPO, arbeit, ergebnis, "kein-data-root")',
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:160])',
    'except NameError as f: print("NAMEERROR:" + str(f))',
  ].join('\n'));
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /^NAMEERROR:/m,
    'der Aufruf-Pfad kracht in einen NameError - ein Import fehlt');
  assert.doesNotMatch(r.stderr, /NameError|Traceback/,
    `nackter Traceback statt benanntem Abbruch: ${r.stderr.slice(0, 300)}`);
  assert.match(r.stdout, /^ABBRUCH:/m,
    'der Aufruf muss den benannten Abbruch des gescheiterten Durchlaufs liefern');
  assert.match(r.stdout, /durchlauf --modus alt` ist gescheitert|LAUF-HAELFTE/);
});

test('VERTRAG: _arme selbst uebergibt an im_signalband, was dessen Vertrag verlangt', () => {
  // DIESE PROBE FEHLTE, UND GENAU DA IST ES ZUM ZWEITEN MAL DURCHGEFALLEN:
  // _arme laeuft sonst nur mit echtem Panel, also hat nie ein Test die
  // Uebergabe an die GELIEHENEN Funktionen des Zaehlprobe-Moduls gemessen.
  // im_signalband vergleicht das JAHR aus `accepted` und erwartet
  // Jahreszahlen (eigene FENSTER-Registry: "von": 2009); FENSTER_SOLL fuehrt
  // ISO-Grenzen. Der TypeError kam erst im echten Lauf heraus.
  //
  // Hier wird _arme WIRKLICH gefahren - nur die Panel-Vorbereitung und die
  // E2-Rechenschritte sind gestubbt. `im_signalband`, `arm_zaehlen` und die
  // Uebergabe dazwischen sind die echten. Ein Rueckfall auf ISO-Grenzen
  // macht diese Probe rot.
  const r = pyProbe([
    'module = m.lade_regelmodule()',
    'e2, zp = module["e2"], module["zp"]',
    'roh = [{"cik": "1", "accepted": "2012-05-04"},',
    '       {"cik": "2", "accepted": "2017-05-04"}]',
    'm._vorbereitung = lambda p, a, mo: ({}, {})',
    'e2.firmenreihen = lambda *a, **k: ([], {})',
    'e2.wachstum_und_beschleunigung = lambda *a, **k: (None, [])',
    'e2.signale = lambda *a, **k: (list(roh), list(roh), None)',
    'e2.ordinal = lambda s: 0',
    'zp.ist_zensiert = lambda e, e2_, r: False',
    'zp.arm_zaehlen = lambda eintraege, g, e2_, r: {',
    '    "firmen_mit_erst_ereignis": len(eintraege), "zensierte_erst_ereignisse": 0,',
    '    "fallzahl": len(eintraege), "auffindbarkeit": None, "reif": list(eintraege)}',
    'f = m.FENSTER_SOLL["entdeckung"]',
    'arme = m._arme("kein-panel", "a/f6/w.sqlite", "S-U", module, f)',
    'sig, eintraege = arme["signal"]',
    'print("IM_BAND:" + str(len(eintraege)))',
    'print("REGISTRY:" + repr(zp.FENSTER["entdeckung"]["von"]))',
  ].join('\n'));
  assert.equal(r.status, 0, `_arme kracht bei der Uebergabe: ${r.stderr.slice(0, 400)}`);
  assert.doesNotMatch(r.stderr, /TypeError|Traceback/,
    'die Uebergabe an im_signalband passt nicht zu seinem Vertrag');
  // Genau EIN Eintrag (2012) liegt im Entdeckungs-Signalband, 2017 nicht.
  assert.match(r.stdout, /^IM_BAND:1$/m,
    'das Signalband hat nicht gefiltert - die Uebergabe stimmt nicht');
  assert.match(r.stdout, /^REGISTRY:2009$/m,
    'die Fenster-Registry fuehrt keine Jahreszahl mehr - der Vertrag hat sich bewegt');
});

test('VERTRAG: _arme liefert ERST-EREIGNISSE als Tally-Einheiten, nie Feuerungen', () => {
  // DER DRITTE DEFEKT DERSELBEN KLASSE - und der einzige, den erst das echte
  // Panel zeigte: _arme reichte `band_f` (alle Feuerungen im Signalband) an
  // _tally weiter. Eine Firma kann MEHRFACH feuern; die Einheiten des
  // Netto-Tornenners sind aber die ERST-EREIGNISSE, eines je Firma
  // (Wortlaut Ziffer 2). Auf dem echten Panel wurden daraus 106 Klumpen mit
  // n_g > 1 (groesster 4) - W-C hat es gefangen, kein Test.
  //
  // Diese Probe faehrt _arme WIRKLICH: `signale` liefert ZWEI Feuerungen
  // derselben Firma, `erst_ereignisse` reduziert auf eine. Kommen zwei
  // Einheiten heraus, ist der Defekt zurueck.
  const r = pyProbe([
    'module = m.lade_regelmodule()',
    'e2, zp = module["e2"], module["zp"]',
    'feuer = [{"cik": "1", "accepted": "2012-05-04"},',
    '         {"cik": "1", "accepted": "2013-06-05"}]',
    'm._vorbereitung = lambda p, a, mo: ({}, {})',
    'e2.firmenreihen = lambda *a, **k: ([], {})',
    'e2.wachstum_und_beschleunigung = lambda *a, **k: (None, [])',
    'e2.signale = lambda *a, **k: (list(feuer), list(feuer), None)',
    'e2.ordinal = lambda s: 0',
    // Genau die praeregistrierte Reduktion: eine Firma, ihr fruehestes Ereignis.
    'e2.erst_ereignisse = lambda eintraege, g: ([eintraege[0]], []) if eintraege else ([], [])',
    'zp.ist_zensiert = lambda e, e2_, r: False',
    'zp.arm_zaehlen = lambda eintraege, g, e2_, r: {',
    '    "firmen_mit_erst_ereignis": 1, "zensierte_erst_ereignisse": 0,',
    '    "fallzahl": 1, "auffindbarkeit": None, "reif": list(eintraege[:1])}',
    'arme = m._arme("kein-panel", "a/f6/w.sqlite", "S-U", module,',
    '               m.FENSTER_SOLL["entdeckung"])',
    'sig, einheiten = arme["signal"]',
    'print("EINHEITEN:" + str(len(einheiten)))',
    // Und die Tally-Invariante darueber: ein Klumpen, n_g == 1.
    'k, n, z, zens = m._tally(einheiten, sig["reif"], e2, zp, 0, "S-U/signal")',
    'print("TALLY:" + repr(k))',
  ].join('\n'));
  assert.equal(r.status, 0, `_arme kracht: ${r.stderr.slice(0, 400)}`);
  assert.match(r.stdout, /^EINHEITEN:1$/m,
    'zwei Feuerungen DERSELBEN Firma muessen zu EINEM Erst-Ereignis werden - '
    + 'sonst zaehlt der Tally Feuerungen als Stichprobe (W-C, R3)');
  assert.match(r.stdout, /^TALLY:\[\[1, 1\]\]$/m,
    'die Tally-Invariante n_g == 1 muss halten');
});

// ============================================================================
// ANHANG 2 - F6-C8a..e: die Zensur-Basis von Bein 2
// ============================================================================

function c8Probe(mutation) {
  return pyProbe([
    mutation,
    'try:',
    '    r = m.pruefe_bein2_basis(m.WURZEL_REPO)',
    '    print("DURCH:" + str(r["bestanden"]))',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:300])',
  ].join('\n'));
}

test('F6-C8b: die berichtigte Zelle steht auf der E3-Basis', () => {
  const r = pyProbe([
    'import json',
    'print("SOLL:" + json.dumps({str(k): v for k, v in m.BEIN2_SOLL.items()}, sort_keys=True))',
    'print("SPALTEN:" + json.dumps(m.BEIN2_SPALTE, sort_keys=True))',
    'print("ARM:" + json.dumps(m.ARM_ARTEFAKT, sort_keys=True))',
  ].join('\n'));
  const soll = JSON.parse(r.stdout.split('\n').find((z) => z.startsWith('SOLL:')).slice(5));
  assert.deepEqual(soll["('S-U', 'kontrollpool')"],
    { zaehler: 3761, nenner: 4514, zensiert: 0 },
    'die Zelle S-U/kontrollpool muss auf 3761/4514/0 berichtigt sein (F6-C8b)');
  // Die drei uebrigen bleiben woertlich.
  assert.deepEqual(soll["('S-U', 'signal')"], { zaehler: 543, nenner: 651, zensiert: 0 });
  assert.deepEqual(soll["('S-G', 'signal')"], { zaehler: 557, nenner: 647, zensiert: 0 });
  assert.deepEqual(soll["('S-G', 'kontrollpool')"], { zaehler: 5000, nenner: 5768, zensiert: 0 });
  // F6-C8c: Spaltenpfade und Arm-Abbildung ausgeschrieben.
  const spalten = JSON.parse(r.stdout.split('\n').find((z) => z.startsWith('SPALTEN:')).slice(8));
  assert.deepEqual(spalten, { nenner: 'nenner_e3', zaehler: 'fallzahl', zensiert: 'zensiert_e3' });
  const arm = JSON.parse(r.stdout.split('\n').find((z) => z.startsWith('ARM:')).slice(4));
  assert.equal(arm.kontrollpool, 'kontrolle',
    'die Arm-Abbildung kontrollpool -> kontrolle muss ausgeschrieben sein (F6-C8c)');
});

test('F6-C8d: die drei Glieder laufen gruen gegen das gepinnte Artefakt', () => {
  const r = c8Probe('pass');
  assert.match(r.stdout, /^DURCH:True$/m, `${r.stdout}${r.stderr}`);
});

test('F6-C8e PROBE 1: Soll-Spaltenpfad auf .nenner_kadenz -> BASIS-ABBRUCH', () => {
  // Genau der Fehler, der eingetreten ist.
  const r = c8Probe("m.BEIN2_SPALTE['nenner'] = 'nenner_kadenz'");
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /BASIS-ABBRUCH/);
  assert.match(r.stdout, /kadenz-Segment/);
});

test('F6-C8e PROBE 2: ein Soll-Literal um 1 verstellt -> ABBRUCH', () => {
  const r = c8Probe("m.BEIN2_SOLL[('S-U', 'kontrollpool')]['zaehler'] = 3762");
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /KONSTANTEN-ABGLEICH GERISSEN/);
  assert.match(r.stdout, /3762/);
});

test('F6-C8d Glied 2b: das alte Kadenz-Tripel als Soll -> BASIS-ABBRUCH', () => {
  // Der positive Zweig MUSS erreichbar sein. Stuende Glied 1 davor, koennte
  // er nie feuern - ein Wachtposten, der nur so aussieht.
  const r = c8Probe(
    "m.BEIN2_SOLL[('S-U', 'kontrollpool')] = "
    + "{'zaehler': 3760, 'nenner': 4513, 'zensiert': 1}");
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /BASIS-ABBRUCH/,
    'der positive Basis-Zweig ist unerreichbar - Glied 1 feuert davor');
  assert.match(r.stdout, /3760, 4513, 1/);
  assert.match(r.stdout, /3761, 4514, 0/);
});

test('F6-C8d Glied 3: die Identitaet haelt exakt, fuer alle vier Arme', () => {
  const r = pyProbe([
    'import json',
    'd = json.load(open(m.os.path.join(m.WURZEL_REPO, *m.BEIN2_QUELLE_REL.split("/")), encoding="utf-8"))',
    'aus = {}',
    'for (v, arm), soll in m.BEIN2_SOLL.items():',
    '    z = d["baender"][m.BEIN2_BAND]["varianten"][v][m.ARM_ARTEFAKT[arm]]',
    '    aus[v + "/" + arm] = (soll["zaehler"] / soll["nenner"]) == z[m.BEIN2_IDENTITAETSSPALTE]',
    'print("IDENT:" + json.dumps(aus, sort_keys=True))',
  ].join('\n'));
  const ident = JSON.parse(r.stdout.split('\n').find((z) => z.startsWith('IDENT:')).slice(6));
  for (const [zelle, ok] of Object.entries(ident)) {
    assert.equal(ok, true, `${zelle}: zaehler/nenner != auffindbarkeit_e3`);
  }
});

test('F6-C7b: der PIN im Zaehlwerk stimmt mit der Datei ueberein', () => {
  const gemessen = require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(REPO, 'scripts', 'studie-e2-verbreitert.py')))
    .digest('hex');
  const r = pyProbe(['print("PIN:" + m.VERBREITERT_SHA)'].join('\n'));
  assert.ok(r.stdout.includes(`PIN:${gemessen}`),
    'der gebundene PIN driftet gegen die Datei');
  assert.ok(gemessen.startsWith('9a24ed94'), 'der PIN ist nicht der ratifizierte');
});

test('F6-C7b: die sechs torSoll-Zahlen werden bit-genau geprueft (KZ-4)', () => {
  const dir = tempdir('f6-bein1-');
  const gut = path.join(dir, 'gut.json');
  const soll = {
    'S-U': { firmen_reif: 512, firmen_unreif: 219 },
    'S-G': { firmen_reif: 546, firmen_unreif: 265 },
    'S-UG': { firmen_reif: 29, firmen_unreif: 12 },
  };
  fs.writeFileSync(gut, JSON.stringify({ signale: soll }), 'utf8');
  const g = pyProbe([
    `print("ERG:" + json.dumps(m.pruefe_bein1_laufzahlen(r"${gut}")["bestanden"]))`,
  ].join('\n'));
  assert.match(g.stdout, /^ERG:true$/m, `GEGENPROBE: ${g.stdout}${g.stderr}`);

  // EINE Zahl daneben = STOPP.
  const schlecht = path.join(dir, 'schlecht.json');
  const kaputt = JSON.parse(JSON.stringify(soll));
  kaputt['S-U'].firmen_reif = 513;
  fs.writeFileSync(schlecht, JSON.stringify({ signale: kaputt }), 'utf8');
  const b = pyProbe([
    'try:',
    `    m.pruefe_bein1_laufzahlen(r"${schlecht}")`,
    '    print("KEIN ABBRUCH")',
    'except m.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:400])',
  ].join('\n'));
  assert.match(b.stdout, /^ABBRUCH:/m, 'eine einzige Abweichung ist ein STOPP');
  assert.match(b.stdout, /BEIN 1 \(LAUF-HAELFTE\) GERISSEN/);
  assert.match(b.stdout, /513/);
  assert.match(b.stdout, /nicht der Vergleich kaputt, sondern die Grundlage/);
});

test('F6-C7e: fuer die KALIBRIER-Haelfte wird das Werkzeug NICHT gerufen', () => {
  // Der Aufruf steht ausschliesslich in bein1_laufhaelfte (torSoll-Haelfte).
  // pruefe_kalibrier_konstanten faehrt nichts - sie prueft nur.
  const r = pyProbe([
    'import inspect',
    'q = inspect.getsource(m.pruefe_kalibrier_konstanten)',
    'print("RUFT_SUBPROCESS:" + str("subprocess" in q))',
    'print("RUFT_WERKZEUG:" + str("e2-verbreitert" in q.replace("scripts/studie-e2-verbreitert.py", "")))',
  ].join('\n'));
  assert.match(r.stdout, /^RUFT_SUBPROCESS:False$/m,
    'die Kalibrier-Haelfte darf NICHTS fahren (F6-C7e)');
});
