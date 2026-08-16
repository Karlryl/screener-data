'use strict';
/**
 * NAV-Holdings-Register: hermetischer Vertrag fuer die Vorstufe des Scorings.
 * Run: node tests/nav-holdings-register.test.js (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run } = require('../scripts/filter-snapshot-merge.js');
const REPO = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-register-'));
let pass = 0, fail = 0;

function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}

function fixture(registerContent) {
  const root = fs.mkdtempSync(path.join(TMP, 'fall-'));
  const eingang = path.join(root, 'eingang');
  const ziel = path.join(root, 'ziel');
  fs.mkdirSync(eingang);
  fs.writeFileSync(path.join(root, 'watchlist.json'), JSON.stringify({ stocks: [
    { ticker: 'INDU-A.ST' }, { ticker: 'NORMAL' },
  ] }));
  fs.writeFileSync(path.join(eingang, 'INDU-A.ST.json'), JSON.stringify({
    meta: { ticker: 'INDU-A.ST', sector: 'Financial Services', industry: 'Asset Management' },
    financials: { revenueQ: [100, 110, 120, 130, 140] },
  }));
  fs.writeFileSync(path.join(eingang, 'NORMAL.json'), JSON.stringify({ meta: { ticker: 'NORMAL' } }));
  const register = path.join(root, 'nav.json');
  fs.writeFileSync(register, registerContent);
  return { root, eingang, ziel, register };
}

function ausfuehren(f) {
  const logs = [];
  const alt = console.log;
  console.log = (s) => logs.push(String(s));
  try {
    const code = run(['node', 'filter-snapshot-merge.js', '--eingang', f.eingang, '--ziel', f.ziel,
      '--watchlist', path.join(f.root, 'watchlist.json'), '--nav-register', f.register]);
    return { code, logs };
  } finally { console.log = alt; }
}

// Wie ausfuehren(), nur mit zusaetzlich abgefangenem console.error — die Wachen unten
// pruefen ::warning::/::error::-Zeilen. Bewusst eigener Helfer: ausfuehren() haelt console.error
// frei, weil der Register-Kaputt-Test ihn selbst umbiegt.
function ausfuehrenLaut(f) {
  const logs = [], errors = [];
  const altLog = console.log, altErr = console.error;
  console.log = (s) => logs.push(String(s));
  console.error = (s) => errors.push(String(s));
  try {
    const code = run(['node', 'filter-snapshot-merge.js', '--eingang', f.eingang, '--ziel', f.ziel,
      '--watchlist', path.join(f.root, 'watchlist.json'), '--nav-register', f.register]);
    return { code, logs, errors };
  } finally { console.log = altLog; console.error = altErr; }
}

test('INDU-A.ST mit unauffaelligen Frischdaten wird vor dem Scoring sichtbar ausgeschlossen', () => {
  const f = fixture(JSON.stringify([{ ticker: 'INDU-A.ST', grund: 'NAV-Holding', beleg: 'Test', aufgenommen: '2026-08-09' }]));
  const r = ausfuehren(f);
  assert.equal(r.code, 0);
  assert.equal(fs.existsSync(path.join(f.ziel, 'INDU-A.ST.json')), false,
    'Rot-Beweis am ungefixten Stand: der Snapshot passiert die Merge-Vorstufe trotz Register');
  assert.ok(r.logs.some((l) => l.includes('NAV-Register: 1 Namen vom Scoring ausgeschlossen (INDU-A.ST)')),
    'der Ausschluss ist nicht mit der geforderten Logzeile sichtbar');
});

test('Nicht-Register-Ticker passiert unveraendert', () => {
  const f = fixture(JSON.stringify([{ ticker: 'INDU-A.ST', grund: 'NAV-Holding', beleg: 'Test', aufgenommen: '2026-08-09' }]));
  const r = ausfuehren(f);
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(path.join(f.ziel, 'NORMAL.json'), 'utf8'),
    fs.readFileSync(path.join(f.eingang, 'NORMAL.json'), 'utf8'));
});

test('Kaputtes Register stoppt fail-loud statt gegen eine leere Liste weiterzulaufen', () => {
  const f = fixture('{"ticker":');
  const errors = [];
  const alt = console.error;
  console.error = (s) => errors.push(String(s));
  let code;
  try { code = ausfuehren(f).code; } finally { console.error = alt; }
  assert.equal(code, 1);
  assert.ok(errors.some((l) => l.includes('NAV-Register nicht ladbar')), 'diagnostische Fehlermeldung fehlt');
  assert.equal(fs.existsSync(f.ziel), false, 'trotz kaputtem Register wurde ein Zielbestand erzeugt');
});

// ── H1 (Review Tag 612): der NAV-Ausschluss blendete den ALL-Stop aus ──────────────
// BEFUND: der ALL-Stop feuert bei `uebersprungen === gescannt`. NAV-ausgeschlossene Dateien
// zaehlen in `gescannt`, landen aber nie in `uebersprungen` — sobald EIN Registername im
// Eingang liegt, ist die Gleichheit unerreichbar und ein Namensschema-/Watchlist-Bruch, der
// das komplette Universum wegfiltert, laeuft still durch. Die Wache muss ueber die um die
// Register-Treffer BEREINIGTE Population rechnen.
test('H1: ALL-Stop feuert auch dann, wenn ein Register-Treffer im Eingang liegt', () => {
  const f = fixture(JSON.stringify([{ ticker: 'INDU-A.ST', grund: 'NAV-Holding', beleg: 'Test', aufgenommen: '2026-08-09' }]));
  // Watchlist autorisiert NICHTS aus dem Eingang; INDU-A.ST ist der Register-Treffer,
  // FREMD1/FREMD2 sind die beiden zu pruefenden Snapshots — 2 von 2 unautorisiert.
  fs.writeFileSync(path.join(f.root, 'watchlist.json'), JSON.stringify({ stocks: [{ ticker: 'ANDERS' }] }));
  fs.rmSync(path.join(f.eingang, 'NORMAL.json'));
  fs.writeFileSync(path.join(f.eingang, 'FREMD1.json'), JSON.stringify({ meta: { ticker: 'FREMD1' } }));
  fs.writeFileSync(path.join(f.eingang, 'FREMD2.json'), JSON.stringify({ meta: { ticker: 'FREMD2' } }));
  const r = ausfuehrenLaut(f);
  assert.equal(r.code, 1, 'ein Register-Treffer darf den 100-%-Stop nicht ausknipsen. Ausgabe:\n' + r.errors.join('\n'));
  assert.ok(r.errors.some((l) => l.includes('ALLE 2 Snapshots gelten als nicht autorisiert')),
    'der Stop muss ueber die bereinigte Population (2) melden, nicht ueber den Roh-Scan (3). Ausgabe:\n' + r.errors.join('\n'));
  assert.equal(fs.existsSync(f.ziel), false, 'trotz Stop wurde ein Zielbestand erzeugt');
});

// ── M1 (Review Tag 612): ein Register-Eintrag ohne Treffer war unsichtbar ──────────
// Ein Tippfehler (oder ein delisteter/umbenannter Name) machte den Eintrag still
// wirkungslos — das Register haette dauerhaft nichts ausgeschlossen, ohne dass es auffaellt.
test('M1: Register-Ticker ohne Datei im Eingang wird gemeldet (kein Hardstop)', () => {
  const f = fixture(JSON.stringify([{ ticker: 'GIBTSNICHT', grund: 'NAV-Holding', beleg: 'Test', aufgenommen: '2026-08-09' }]));
  const r = ausfuehrenLaut(f);
  assert.equal(r.code, 0, 'ein wirkungsloser Eintrag ist ein Befund, kein Abbruch');
  assert.ok(r.errors.some((l) => l.includes('::warning::NAV-Register: GIBTSNICHT hatte keinen Treffer im Eingang')),
    'der wirkungslose Register-Eintrag bleibt unsichtbar. Ausgabe:\n' + r.errors.join('\n'));
});

test('M1: ein Register-Eintrag MIT Treffer erzeugt keine Warnung (gueltige Form geht durch)', () => {
  const f = fixture(JSON.stringify([{ ticker: 'INDU-A.ST', grund: 'NAV-Holding', beleg: 'Test', aufgenommen: '2026-08-09' }]));
  const r = ausfuehrenLaut(f);
  assert.equal(r.code, 0);
  assert.ok(!r.errors.some((l) => l.includes('hatte keinen Treffer im Eingang')),
    'ein ausgeschlossener Treffer ist kein Warnfall. Ausgabe:\n' + r.errors.join('\n'));
});

// ── L1 (Review Tag 612): Dublette wurde auf Rohstrings geprueft ───────────────────
// safeSnapshotFilename faltet (Grossschreibung, [^A-Z0-9.-] -> _), also sind zwei
// verschiedene Rohstrings, die auf DIESELBE Datei zeigen, ein Register-Fehler.
test('L1: zwei Eintraege mit demselben Snapshot-Dateinamen sind ein Ladefehler', () => {
  const f = fixture(JSON.stringify([
    { ticker: 'nflx', grund: 'NAV-Holding', beleg: 'Test', aufgenommen: '2026-08-09' },
    { ticker: 'NFLX', grund: 'NAV-Holding', beleg: 'Test', aufgenommen: '2026-08-09' },
  ]));
  const r = ausfuehrenLaut(f);
  assert.equal(r.code, 1, 'zwei Eintraege fuer dieselbe Datei muessen auffliegen. Ausgabe:\n' + r.errors.join('\n'));
  assert.ok(r.errors.some((l) => l.includes('NAV-Register nicht ladbar') && l.includes('NFLX.json')),
    'die Dublette muss auf Dateinamen-Ebene benannt werden. Ausgabe:\n' + r.errors.join('\n'));
});

test('Produktionsregister ist vollstaendig belegt und enthaelt nie BLK/BX', () => {
  const register = JSON.parse(fs.readFileSync(path.join(REPO, 'data-health', 'nav-holdings.json'), 'utf8'));
  assert.ok(Array.isArray(register) && register.length > 0);
  for (const e of register) {
    assert.deepEqual(Object.keys(e).sort(), ['aufgenommen', 'beleg', 'grund', 'ticker']);
    for (const feld of ['ticker', 'grund', 'beleg', 'aufgenommen']) assert.ok(String(e[feld]).trim(), `${e.ticker}: ${feld} fehlt`);
    // Tag 954: hier stand `assert.equal(e.aufgenommen, '2026-08-09')` — das pinnte den
    // Anlege-Tag der Erstbefuellung auf JEDEN kuenftigen Eintrag und machte das Register
    // unerweiterbar (ein Nachtrag faerbte den Waechter rot, obwohl er formal korrekt war).
    // Gemeint ist die SACHE "jeder Eintrag traegt ein nachvollziehbares, echtes Aufnahmedatum",
    // nicht der Literalwert. Geprueft wird jetzt genau das: ISO-Form UND Kalender-Gueltigkeit
    // (die Form allein liesse '2026-13-45' durch).
    assert.match(e.aufgenommen, /^\d{4}-\d{2}-\d{2}$/, `${e.ticker}: aufgenommen ist kein ISO-Datum (${e.aufgenommen})`);
    const d = new Date(e.aufgenommen + 'T00:00:00Z');
    assert.ok(Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === e.aufgenommen,
      `${e.ticker}: aufgenommen ist kein gueltiger Kalendertag (${e.aufgenommen})`);
  }
  assert.equal(register.some((e) => ['BLK', 'BX'].includes(e.ticker)), false);
});

// Tag 954: Geschwister-Gattungen und Zweitnotizen desselben Emittenten muessen GEMEINSAM
// im Register stehen. Befund der Quartalsreihen-Diagnose 2026-08-16 (N-1): INDU-A.ST war
// gefuehrt, INDU-C.ST (C-Gattung) und 1INDU.MI (Mailaender Zweitnotiz) fehlten — beide
// standen deshalb auf financials|profitable Platz 8 und 9, zwei Board-Zeilen fuer eine Firma.
// Der Namenstext-Dedup (issuerKeyLoose) faengt das nicht: die Zweitnotiz laeuft unter dem
// abweichenden Namen "Industrivarden AB Class C".
test('Industrivaerden: alle drei Notierungen (A-Gattung, C-Gattung, Mailand) sind gefuehrt', () => {
  const register = JSON.parse(fs.readFileSync(path.join(REPO, 'data-health', 'nav-holdings.json'), 'utf8'));
  const gefuehrt = new Set(register.map((e) => e.ticker));
  for (const t of ['INDU-A.ST', 'INDU-C.ST', '1INDU.MI']) {
    assert.ok(gefuehrt.has(t), `${t} fehlt im NAV-Register — dieselbe Firma wuerde wieder eine eigene Board-Zeile bekommen`);
  }
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
