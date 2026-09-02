'use strict';

// Waechter fuer scripts/studie-f6-zaehlprobe-fortsetzung.py — den Aufrufer, der die
// gesiegelte Zaehlprobe auf die Register-FORTSETZUNG richtet (Option A).
//
// DIE SACHE: seit dem R14a-Rollover liegt der autorisierende Akt in der Fortsetzung.
// scripts/studie-zaehlprobe.py verdrahtet die zuerst beschriebene Datei und faende ihn nie.
// Ihr SHA ist in ELF Artefakten gebunden - darunter eine Praeregistrierung und die
// geschlossene Registerdatei -, also wird sie NICHT geaendert, sondern zur Laufzeit
// umgelenkt. Das ist ein Monkeypatch; diese Datei ist die Messung, die ihn zur Vollendung
// macht statt zur Aufweichung.
//
// Usage: node --test tests/studie-f6-zaehlprobe-fortsetzung.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const WURZEL = path.join(__dirname, '..');
const PY = process.env.PYTHON || 'python';
const AUFRUFER_REL = 'scripts/studie-f6-zaehlprobe-fortsetzung.py';
const ZAEHLPROBE_REL = 'scripts/studie-zaehlprobe.py';
const AUFRUFER = path.join(WURZEL, ...AUFRUFER_REL.split('/'));
const ZAEHLPROBE = path.join(WURZEL, ...ZAEHLPROBE_REL.split('/'));
const FREIGABE = path.join(WURZEL, 'reports', 'studie',
  'f6-aequivalenz-entdeckung-v2-freigabe.json');

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const quelle = fs.readFileSync(AUFRUFER, 'utf8');
const GESIEGELT = /ZAEHLPROBE_SHA = "([0-9a-f]{64})"/.exec(quelle)[1];

const py = (code, cwd = WURZEL) => spawnSync(PY, ['-c', code], { encoding: 'utf8', cwd });

// ── Bedingung 1: NULL Bytes an der gesiegelten Datei ───────────────────────

test('Bedingung 1: scripts/studie-zaehlprobe.py ist byte-identisch zum Siegel', () => {
  // Der ganze Sinn von Option A. Weicht die Datei ab, sind elf Bindungen unwahr -
  // darunter eine Praeregistrierung und die geschlossene Registerdatei, beide nicht
  // nachziehbar.
  const manifest = JSON.parse(fs.readFileSync(
    path.join(WURZEL, 'protocol', 'early-detection', '2.0.0', 'hash-manifest.json'), 'utf8'));
  assert.equal(manifest.files[ZAEHLPROBE_REL], GESIEGELT,
    'das Manifest fuehrt einen anderen Sollwert als der Aufrufer');
  assert.equal(sha256(ZAEHLPROBE), GESIEGELT,
    'die gesiegelte Zaehlprobe wurde veraendert - Option A ist damit gebrochen');
});

// ── Bedingung 2: der Aufrufer pinnt, was er patcht ─────────────────────────

test('Bedingung 2: eine veraenderte Zaehlprobe bricht VOR dem Patchen ab', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aufrufer-pin-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  // Spiegelbaum: echter Aufrufer, echtes Manifest, VERAENDERTE Zaehlprobe.
  for (const rel of [AUFRUFER_REL, ZAEHLPROBE_REL,
    'protocol/early-detection/2.0.0/hash-manifest.json',
    'protocol/early-detection/2.0.0/outcome-access-ledger-teil2.json']) {
    const ziel = path.join(d, ...rel.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.copyFileSync(path.join(WURZEL, ...rel.split('/')), ziel);
  }
  fs.appendFileSync(path.join(d, ...ZAEHLPROBE_REL.split('/')), '\n# absichtlich veraendert\n');

  const r = spawnSync(PY, [path.join(d, ...AUFRUFER_REL.split('/')),
    '--fenster', 'entdeckung', '--freigabe', FREIGABE, '--nur-pruefen'],
  { encoding: 'utf8', cwd: d });
  assert.notEqual(r.status, 0, 'der Aufrufer lief trotz veraenderter Zaehlprobe durch');
  assert.match(r.stderr, /AUFRUFER-ABBRUCH/);
  assert.match(r.stderr, /Ein anderer Hash ist ein anderes Skript/);
});

test('Bedingung 2: ein Widerspruch zwischen Pin und Manifest bricht ab', () => {
  // Zwei Sollwerte, die sich widersprechen, sind kein Sollwert. Fail-closed statt
  // "einer von beiden wird schon stimmen".
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aufrufer-widerspruch-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  for (const rel of [AUFRUFER_REL, ZAEHLPROBE_REL,
    'protocol/early-detection/2.0.0/hash-manifest.json',
    'protocol/early-detection/2.0.0/outcome-access-ledger-teil2.json']) {
    const ziel = path.join(d, ...rel.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.copyFileSync(path.join(WURZEL, ...rel.split('/')), ziel);
  }
  const mp = path.join(d, 'protocol', 'early-detection', '2.0.0', 'hash-manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.files[ZAEHLPROBE_REL] = `0${GESIEGELT.slice(1)}`;
  fs.writeFileSync(mp, `${JSON.stringify(m, null, 2)}\n`);

  const r = spawnSync(PY, [path.join(d, ...AUFRUFER_REL.split('/')),
    '--fenster', 'entdeckung', '--freigabe', FREIGABE, '--nur-pruefen'],
  { encoding: 'utf8', cwd: d });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /widersprechen sich/);
});

// ── Bedingung 3: GENAU EINE Funktion, Zaehl-Pfad unberuehrt ────────────────

test('Bedingung 3: genau eine Funktion ist umgelenkt, die Zaehl-Funktionen nicht', () => {
  const treiber = [
    'import importlib.util, sys, os',
    `sys.path.insert(0, r'${path.join(WURZEL, 'scripts').replace(/\\/g, '\\\\')}')`,
    "spec = importlib.util.spec_from_file_location('aufrufer', "
      + `r'${AUFRUFER.replace(/\\/g, '\\\\')}')`,
    'a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)',
    'frisch = a.lade_zaehlprobe()',
    'modul = a.lade_zaehlprobe()',
    "a.richte_auf(modul, os.path.join(a.REPO, *a.AKTIVES_REGISTER_REL.split('/')))",
    // GENAU EINE Funktion weicht vom frisch importierten Modul ab.
    'abweichend = [n for n in dir(frisch) if callable(getattr(frisch, n, None))',
    "             and getattr(getattr(modul, n, None), '__name__', None) == n",
    '             and getattr(modul, n) is not getattr(frisch, n)]',
    // frisch und modul sind zwei Importe: Funktionen sind ohnehin verschiedene Objekte.
    // Entscheidend ist die MARKE, die nur der Patch setzt.
    "markiert = [n for n in dir(modul) if getattr(getattr(modul, n, None),"
      + " 'umgelenkt_von', None)]",
    "print('MARKIERT=' + ','.join(sorted(markiert)))",
    "print('UNBERUEHRT=' + ','.join(n for n in a.UNBERUEHRTE_FUNKTIONEN"
      + " if not getattr(getattr(modul, n), 'umgelenkt_von', None)))",
    "print('ORIGINAL_ERREICHBAR=' + str(getattr(modul, a.GEPATCHTE_FUNKTION).original.__name__))",
  ].join('\n');
  const r = py(treiber);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const markiert = /MARKIERT=(.*)/.exec(r.stdout)[1];
  assert.equal(markiert, 'pruefe_freigabe_gegen_register',
    `mehr als eine Funktion ist umgelenkt: ${markiert}`);
  const unberuehrt = /UNBERUEHRT=(.*)/.exec(r.stdout)[1].split(',').filter(Boolean);
  assert.equal(unberuehrt.length, 6,
    'eine der Zaehl-/Lauf-Funktionen wurde mit umgelenkt');
  assert.match(r.stdout, /ORIGINAL_ERREICHBAR=pruefe_freigabe_gegen_register/,
    'die Umlenkung ruft nicht mehr das Original des gesiegelten Moduls');
});

// ── Bedingung 4: die Notwendigkeit, in beide Richtungen ────────────────────

test('Bedingung 4: der Aufrufer findet den Fortsetzungs-Akt, die rohe Zaehlprobe nicht', () => {
  const freigabe = JSON.parse(fs.readFileSync(FREIGABE, 'utf8'));
  const treiber = (mitAufrufer) => [
    'import importlib.util, json, os, sys',
    "spec = importlib.util.spec_from_file_location('aufrufer', "
      + `r'${AUFRUFER.replace(/\\/g, '\\\\')}')`,
    'a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)',
    'modul = a.lade_zaehlprobe()',
    mitAufrufer
      ? "a.richte_auf(modul, os.path.join(a.REPO, *a.AKTIVES_REGISTER_REL.split('/')))"
      : 'pass',
    `freigabe = json.loads(r'''${JSON.stringify(freigabe)}''')`,
    'try:',
    '    modul.pruefe_freigabe_gegen_register(freigabe)',
    "    print('DURCHGELASSEN')",
    'except Exception as f:',
    "    print('ABBRUCH: ' + str(f)[:120])",
  ].join('\n');

  const roh = py(treiber(false));
  assert.equal(roh.status, 0, roh.stdout + roh.stderr);
  assert.match(roh.stdout, /ABBRUCH/,
    'die ROHE Zaehlprobe findet den Fortsetzungs-Akt - dann braeuchte es diesen Aufrufer nicht');

  const mit = py(treiber(true));
  assert.equal(mit.status, 0, mit.stdout + mit.stderr);
  assert.match(mit.stdout, /DURCHGELASSEN/,
    'der Aufrufer findet den Fortsetzungs-Akt nicht - dann lenkt er ins Leere');
});

test('der Aufrufer laeuft gegen den echten Baum und meldet, was er tut', () => {
  const r = spawnSync(PY, [AUFRUFER, '--fenster', 'entdeckung', '--freigabe', FREIGABE,
    '--nur-pruefen'], { encoding: 'utf8', cwd: WURZEL });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /gesiegelt-gleich/);
  assert.match(r.stderr, /EINE Funktion umgelenkt \(pruefe_freigabe_gegen_register\)/);
  assert.match(r.stderr, /outcome-access-ledger-teil2\.json/);
});
