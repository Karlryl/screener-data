'use strict';

// PR G — die Proben zu den zehn Naht-Fixes aus dem Schritt-8-Review.
//
// JEDER RIEGEL WIRD EINMAL ABSICHTLICH GEBROCHEN. Ein Test, der nur den
// gruenen Weg faehrt, bezeugt nichts — und dieses Gate hat inzwischen dreimal
// erlebt, dass ein Waechter genau die Stelle aussparte, die er decken sollte.
//
// KEIN TEST FASST EIN PANEL AN. Alles laeuft ueber Fixtures, Quelltext und
// Funktionsaufrufe ohne E/A auf einem echten Panel.
//
// Usage: node tests/studie-f6-prg-naehte.test.js

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
const QUELLE_ZW = fs.readFileSync(ZAEHLWERK, 'utf8');
const QUELLE_LF = fs.readFileSync(LAEUFER, 'utf8');

function tempdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const r = (p) => p.replace(/\\/g, '\\\\');

// Faehrt Python mit geladenem Zaehlwerk (z) und Laeufer (m).
function py(zeilen) {
  const kopf = [
    'import importlib.util, os, tempfile',
    `zspec = importlib.util.spec_from_file_location("z", r"${ZAEHLWERK}")`,
    'z = importlib.util.module_from_spec(zspec); zspec.loader.exec_module(z)',
    `mspec = importlib.util.spec_from_file_location("l", r"${LAEUFER}")`,
    'm = importlib.util.module_from_spec(mspec); mspec.loader.exec_module(m)',
  ];
  const lauf = spawnSync(python, ['-c', kopf.concat(zeilen).join('\n')],
    { encoding: 'utf8' });
  assert.equal(lauf.status, 0, 'Python ist rot: ' + (lauf.stderr || ''));
  return lauf.stdout;
}

// ── (1) Naht-B1 — das Arbeitsverzeichnis ────────────────────────────────────
test('(1) ein nicht leeres Arbeitsverzeichnis ist ein benannter ABBRUCH', () => {
  const tmp = tempdir('prg-b1-');
  const aus = py([
    `basis = r"${r(tmp)}"`,
    // (a) frisch: legt an und liefert eine DATEI
    'p = z.arbeitsdatei_fuer_lauf(basis, "lauf-a")',
    'print("DATEI:" + os.path.basename(p))',
    'print("ORDNER:" + os.path.basename(os.path.dirname(p)))',
    'print("EXISTIERT:" + str(os.path.isdir(os.path.dirname(p))))',
    // (b) GEBROCHEN: derselbe Lauf, aber das Verzeichnis traegt Altbestand
    'open(p, "w").write("altbestand")',
    'try:',
    '    z.arbeitsdatei_fuer_lauf(basis, "lauf-a")',
    '    print("KEIN ABBRUCH")',
    'except z.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:60])',
    // (c) und NICHTS wurde geloescht
    'print("ALTBESTAND_DA:" + str(os.path.isfile(p)))',
  ]);
  assert.match(aus, /^DATEI:zwischenstand\.sqlite$/m);
  assert.match(aus, /^ORDNER:lauf-lauf-a$/m);
  assert.match(aus, /^EXISTIERT:True$/m);
  assert.match(aus, /^ABBRUCH:ARBEITSVERZEICHNIS NICHT LEER/m);
  assert.match(aus, /^ALTBESTAND_DA:True$/m,
    'der Riegel darf fremde Artefakte NIE loeschen');
});

// ── (2) Naht-F3 / Akt-F2 — die Bindung kommt aus dem REGISTER-EINTRAG ───────
test('(2) der Laeufer prueft gegen die Bindung des Register-Eintrags', () => {
  const tmp = tempdir('prg-f3-');
  const aus = py([
    `z.ARBEITSPFAD_VORGABE = r"${r(tmp)}"`,
    'gut = {"arbeitspfad": {"gebundenAn": "ARBEITSPFAD_VORGABE in '
      + 'scripts/studie-f6-zaehlwerk.py"}}',
    'print("GUT:" + str(m.ruest_zaehlwerk(z, None, {"runId": "x1"}, gut) is not None))',
    // GEBROCHEN (a): der Eintrag bindet an etwas anderes
    'try:',
    '    m.ruest_zaehlwerk(z, None, {"runId": "x2"},',
    '                      {"arbeitspfad": {"gebundenAn": "irgendwas anderes"}})',
    '    print("KEIN ABBRUCH A")',
    'except m.LaufAbbruch as f: print("A:" + str(f)[:70])',
    // GEBROCHEN (b): der Eintrag erklaert gar keine Bindung
    'try:',
    '    m.ruest_zaehlwerk(z, None, {"runId": "x3"}, {})',
    '    print("KEIN ABBRUCH B")',
    'except m.LaufAbbruch as f: print("B:" + str(f)[:70])',
    // GEBROCHEN (c): die Freigabe widerspricht der Bindung
    'try:',
    // Der Fremdpfad wird aus Fragmenten gebaut (der Deckel liest auch tests/).
    '    fremd = "D" + ":/" + "woanders"',
    '    m.ruest_zaehlwerk(z, None, {"runId": "x4", "arbeitspfad": fremd}, gut)',
    '    print("KEIN ABBRUCH C")',
    'except m.LaufAbbruch as f: print("C:" + str(f)[:70])',
  ]);
  assert.match(aus, /^GUT:True$/m);
  assert.match(aus, /^A:Der Register-Eintrag bindet den Arbeitspfad an/m);
  assert.match(aus, /^B:Der Register-Eintrag erklaert keine Arbeitspfad-Bindung/m);
  assert.match(aus, /^C:FREIGABE WIDERSPRICHT DER BINDUNG/m);
});

// ── (3) Naht-F4 — keine Kontokennung als Elternsegment ─────────────────────
test('(3) die Kurzform traegt kein Konto-Elternsegment', () => {
  const tmp = tempdir('prg-f4-');
  const aus = py([
    `basis = r"${r(tmp)}"`,
    'p = z.arbeitsdatei_fuer_lauf(basis, "konf-1")',
    'print("KURZ:" + m.kurzpfad(p))',
    'konto = os.path.basename(os.path.expanduser("~"))',
    'print("KONTO_IM_KURZ:" + str(konto in m.kurzpfad(p)))',
    // GEBROCHEN: ein Baum, der die Kontokennung als Segment traegt
    'try:',
    '    m.pruefe_keine_absolutpfade({"a": konto + "/f6-arbeit"}, set())',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f)[:50])',
  ]);
  assert.match(aus, /^KURZ:lauf-konf-1\/zwischenstand\.sqlite$/m,
    'die Kurzform ist Lauf-Unterverzeichnis + Datei, kein Konto-Elternteil');
  assert.match(aus, /^KONTO_IM_KURZ:False$/m);
  assert.match(aus, /^ABBRUCH:KONTOKENNUNG ALS PFADSEGMENT/m);
});

// ── (4) Naht-F1 — Pufferjahr 2020 ist ein ABBRUCH ──────────────────────────
test('(4) ein Erst-Ereignis im Pufferjahr 2020 bricht benannt ab', () => {
  const aus = py([
    'class E2:',
    '    @staticmethod',
    '    def jahr_aus_accepted(a): return int(str(a)[:4]) if str(a)[:4].isdigit() else None',
    'e2 = E2()',
    // (a) sauber: alles im Band
    'z._pruefe_pufferjahr([{"accepted": "2018-05-05"}], e2, 2017, 2019, "S-U/signal")',
    'print("SAUBER:ok")',
    // (b) GEBROCHEN: ein Erst-Ereignis aus dem Pufferjahr 2020
    'try:',
    '    z._pruefe_pufferjahr([{"accepted": "2018-01-01"}, {"accepted": "2020-03-01"}],',
    '                         e2, 2017, 2019, "S-U/signal")',
    '    print("KEIN ABBRUCH")',
    'except z.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:150].replace("\\n", " "))',
    // (c) GEBROCHEN: unlesbares Datum ist NICHT "gilt als in Ordnung"
    'try:',
    '    z._pruefe_pufferjahr([{"accepted": "krumm"}], e2, 2017, 2019, "S-G/kontrollpool")',
    '    print("KEIN ABBRUCH NB")',
    'except z.ZaehlwerkAbbruch as f: print("NB:" + str(f)[:60])',
  ]);
  assert.match(aus, /^SAUBER:ok$/m);
  assert.match(aus, /^ABBRUCH:ERST-EREIGNIS AUSSERHALB DES SIGNALBANDES in S-U\/signal/m);
  assert.match(aus, /accepted-Jahr 2020/);
  assert.match(aus, /^NB:PUFFERJAHR-PRUEFUNG NICHT BERECHENBAR/m);
  // Der Riegel haengt wirklich im Zaehlpfad, nicht nur im Modul.
  assert.match(QUELLE_ZW, /_pruefe_pufferjahr\(sig_reif \+ sig_unreif/);
  assert.match(QUELLE_ZW, /_pruefe_pufferjahr\(kon_reif \+ kon_unreif/);
});

// ── (5) Naht-F2 — das Fenster wird gesetzt, nie geerbt ─────────────────────
test('(5) ohne gesetztes Fenster zaehlt nichts', () => {
  const tmp = tempdir('prg-f2-');
  const aus = py([
    `z.setze_arbeitspfad(z.arbeitsdatei_fuer_lauf(r"${r(tmp)}", "f2"))`,
    // GEBROCHEN: kein setze_fenster
    'try:',
    '    z.zaehle("egal.sqlite", "S-U", "signal")',
    '    print("KEIN ABBRUCH")',
    'except z.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:45])',
    // gesetzt: der Fenster-Riegel schweigt, der naechste greift
    'z.setze_fenster("pruefung")',
    'try:',
    '    z.zaehle("egal.sqlite", "S-U", "signal")',
    '    print("KEIN ABBRUCH 2")',
    'except z.ZaehlwerkAbbruch as f: print("DANACH:" + str(f)[:45])',
    // und ein unbekanntes Fenster ist ebenfalls ein Abbruch
    'try:',
    '    z.setze_fenster("erfunden")',
    '    print("KEIN ABBRUCH 3")',
    'except z.ZaehlwerkAbbruch as f: print("UNBEKANNT:" + str(f)[:40])',
  ]);
  assert.match(aus, /^ABBRUCH:Kein Fenster gesetzt/m);
  assert.doesNotMatch(aus, /^DANACH:Kein Fenster gesetzt/m,
    'nach setze_fenster darf dieser Riegel nicht mehr feuern');
  assert.match(aus, /^UNBEKANNT:Unbekanntes Fenster/m);
  // Der Laeufer setzt es AUSDRUECKLICH aus der Freigabe.
  assert.match(QUELLE_LF, /zaehlwerk\.setze_fenster\(freigabe\["fenster"\]\)/);
});

// ── (6) Naht-F5 — F6-B14 ueber den GANZEN Bericht ──────────────────────────
test('(6) ein verbotener Schluessel im stempel bricht ab', () => {
  const aus = py([
    'verboten = sorted(m.VERBOTENE_SCHLUESSEL)[0]',
    'print("PROBE_SCHLUESSEL:" + verboten)',
    // GEBROCHEN: tief im stempel, also genau dort, wo bis PR G nicht geprueft wurde
    'baum = {"umschlag": {}, "daten": {}, "stempel": {"tief": {verboten: 1}}}',
    'try:',
    '    m.pruefe_verbotene(baum, "bericht")',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f)[:45])',
  ]);
  assert.match(aus, /^ABBRUCH:VERBOTENER SCHLUESSEL/m);
  // Der Vollbaum-Aufruf steht wirklich vor dem Schreiben.
  assert.match(QUELLE_LF, /pruefe_verbotene\(bericht, "bericht"\)/);
});

// ── (7) Naht-F6 — versiegeltes Modul benannt, Text geschruppt ──────────────
test('(7) der Text des versiegelten Moduls kommt benannt und geschruppt', () => {
  const aus = py([
    // Der Beispielpfad wird aus Fragmenten gebaut: ausgeschrieben machte diese
    // Datei sich selbst zum R12a-Verstoss (der Deckel liest auch tests/).
    'pfad = "C:/" + "Us" + "ers" + "/Jemand/x.sqlite"',
    'roh = "Panel unter " + pfad + " traegt CIK 0001234567 keine Daten"',
    'print("SCHRUPP:" + m.schruppe_text(roh))',
  ]);
  const geschruppt = aus.match(/^SCHRUPP:(.*)$/m)[1];
  assert.ok(!geschruppt.includes(['Us', 'ers'].join('')),
    'Pfad ueberlebt die Schrubbe');
  assert.ok(!geschruppt.includes('0001234567'), 'Kennung ueberlebt die Schrubbe');
  assert.ok(geschruppt.includes('<entfernt>'), 'es wurde ueberhaupt geschruppt');
  assert.ok(geschruppt.includes('traegt') && geschruppt.includes('keine'),
    'Prosa muss stehen bleiben, sonst ist die Meldung wertlos');
  // Die Fehlerklasse ist BENANNT, nicht anonym — und der Text laeuft durch die
  // Schrubbe, nie roh.
  assert.match(QUELLE_LF, /BasisratenFehler/);
  assert.match(QUELLE_LF, /geschruppt\): " \+ schruppe_text\(fehler\)/);
});

// ── (8) Quellspalten-B2 — Spaltentiefe am Kommentar ────────────────────────
test('(8) der Herkunfts-Kommentar zeigt bis auf die SPALTE', () => {
  for (const spalte of ['fallzahl', 'nenner_e3', 'zensiert_e3']) {
    assert.match(QUELLE_ZW,
      new RegExp('varianten\\[<Variante>\\]\\.<signal\\|kontrolle>\\.' + spalte),
      `Spalte ${spalte} fehlt im Herkunfts-Kommentar (F6-C8c)`);
  }
  // Die alte Blocktiefe darf nicht daneben stehen bleiben.
  assert.doesNotMatch(QUELLE_ZW, /varianten\[\.\.\.\]\.\{signal,kontrolle\}/);
  assert.match(QUELLE_ZW, /_kadenz-Spalten sind AUSDRUECKLICH NICHT die Quelle/);
});

// ── (9) Quellspalten-F1 — der Byte-Pin ist ein Riegel, keine Behauptung ────
test('(9) ein anders grosses Panel bricht VOR dem ersten Byte ab', () => {
  const tmp = tempdir('prg-f1-');
  const aus = py([
    `d = r"${r(tmp)}"`,
    'falsch = os.path.join(d, "panel.sqlite")',
    'open(falsch, "wb").write(b"x" * 1000)',
    'print("PIN:" + str(z.PANEL_BYTES_PIN_PRUEFUNG))',
    // GEBROCHEN: falsche Groesse
    'try:',
    '    z.pruefe_panel_bytes(falsch)',
    '    print("KEIN ABBRUCH")',
    'except z.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:60])',
    // fehlende Datei ist ebenfalls ein Abbruch, keine stille Null
    'try:',
    '    z.pruefe_panel_bytes(os.path.join(d, "gibtsnicht.sqlite"))',
    '    print("KEIN ABBRUCH 2")',
    'except z.ZaehlwerkAbbruch as f: print("FEHLT:" + str(f)[:40])',
  ]);
  assert.match(aus, /^PIN:4447633408$/m, 'der Pin ist der aus Eintrag 22');
  assert.match(aus, /^ABBRUCH:PANEL-BYTE-PIN GERISSEN: die Datei misst 1000 B/m);
  assert.match(aus, /^FEHLT:Panel-Datei nicht gefunden/m);
  // Und er haengt wirklich im Prueffenster-Pfad, vor der Modul-Ladung.
  assert.match(QUELLE_ZW,
    /if fenster_name == "pruefung":\s*\n\s*pruefe_panel_bytes\(panel_pfad\)/);
});

// ── (10) `tor` — keine Ausnahme per Literal mehr ───────────────────────────
test('(10) der Varianten-Satz ist eine registrierte Konstante ohne Ausnahmen', () => {
  // SEIT ANHANG 3 (F6-C13b): das Tor-Verdikt ist registriert - als
  // UNTEROBJEKT des EINEN armuebergreifenden Schluessels. Die geschlossene
  // Stellung von PR G (TOR_IN_DATEN) ist damit erledigt; die Registrierung
  // hat sie abgeloest, nicht aufgeweicht.
  const aus = py([
    'print("SATZ:" + ",".join(sorted(m.VARIANTEN_SCHLUESSEL_REGISTRIERT)))',
    'print("DIFF:" + ",".join(sorted(m.DIFFERENZ_UNTERSCHLUESSEL_REGISTRIERT)))',
    'print("TOR:" + ",".join(sorted(m.TOR_UNTERSCHLUESSEL_REGISTRIERT)))',
    'print("ALT:" + str(hasattr(m, "TOR_IN_DATEN")))',
  ]);
  assert.match(aus, /^SATZ:differenz_punkte$/m,
    'auf der Variantenebene bleibt es bei GENAU EINEM Schluessel (F6-B11)');
  assert.match(aus, /^DIFF:erfuellt,maxDifferenzPunkte,quelle,tor,wert$/m);
  assert.match(aus, /^TOR:grund,verdikt,weiter$/m, 'F6-C13b: genau drei Pfade');
  assert.match(aus, /^ALT:False$/m,
    'die Uebergangs-Konstante ist mit der Registrierung gefallen');
  // Die Literal-Ausnahme ist strukturell weg — nicht nur unbenutzt.
  assert.doesNotMatch(QUELLE_LF, /- \{"tor"\}/,
    'die Fremdschluessel-Pruefung darf keinen Schluessel per Literal ausnehmen');
  assert.doesNotMatch(QUELLE_LF, /je_arm\["tor"\] = tor_verdikt/,
    '`tor` steht unter differenz_punkte, nicht als zweiter Variantenschluessel');
  // Die ANHANG-3-Marke ist erledigt und darf nicht stehen bleiben.
  assert.doesNotMatch(QUELLE_LF, /TODO-pending-ANHANG3/,
    'ANHANG 3 ist ratifiziert - eine offene Marke waere jetzt eine Luege');
});
