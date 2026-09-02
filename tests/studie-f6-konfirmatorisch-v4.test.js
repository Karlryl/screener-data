'use strict';

// F6-K11 / K17 Schritt 6 — DER WAECHTER UEBER DEM v4-KOMPONISTEN.
//
// v4 ueberschreibt v3, weil v3 IM MOMENT SEINER REGISTRIERUNG NICHT AUSFUEHRBAR
// war: Phase 0 des von ihm gebundenen Laeufers braucht den Akt aus der
// Fortsetzung, Phase 1 die Freeze-Eintraege aus der geschlossenen Datei - und
// der Laeufer kannte genau EINEN Registerpfad.
//
// GEPRUEFT WIRD DAS WERKZEUG, nicht der geschriebene Akt: dieser Waechter
// entsteht im WERKZEUG-PR, der nach T172 dem Ledger-PR vorausgeht. Die
// Live-Bindung an den geschriebenen Akt leistet
// tests/studie-f6-konfirmatorisch-v3.test.js weiter.
//
// HARTE GRENZE: kein Test schreibt in eine echte Registerdatei. Der
// Trockenlauf laeuft gegen ein Fixture unter os.tmpdir(), und beide echten
// Registerstaende werden vorher/nachher gehasht.
//
// Usage: node --test tests/studie-f6-konfirmatorisch-v4.test.js

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const WURZEL = path.join(__dirname, '..');
const K = require(path.join(WURZEL, 'scripts', 'studie-f6-konfirmatorisch-v4.js'));
const V3 = require(path.join(WURZEL, 'scripts', 'studie-f6-konfirmatorisch-v3.js'));
const { REGISTER_RELS, ART_ZUGRIFF } = require(path.join(WURZEL, 'lib', 'studie-verfassung.js'));

const ZIEL = path.join(WURZEL, ...K.ZIEL_REL.split('/'));
const GESCHLOSSEN = path.join(WURZEL, ...REGISTER_RELS[0].split('/'));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const serialisiere = (o) => `${JSON.stringify(o, null, 1)}\n`;

// Bis zu dem Kettenende abschneiden, das DIESES Werkzeug erwartet - nie auf
// eine feste Laenge. Der Wert kommt aus dem Werkzeug und wandert mit ihm.
function bisZumKettenende(register) {
  const reg = JSON.parse(JSON.stringify(register));
  while (reg.events.length > K.ERWARTETE_EVENTS) reg.events.pop();
  return reg;
}

const zielRegister = () => JSON.parse(fs.readFileSync(ZIEL, 'utf8'));
const v3Akt = () => V3.quellAkt(K.RUMPF, bisZumKettenende(zielRegister()));
// Die Wand-Zahlen sind im echten Lauf ein Fixpunkt; fuer die Feld-Proben
// genuegt ein fester Satz - sie messen den INHALT, nicht die Arithmetik.
const bauen = (wand = { danach: 1, zuwachs: 1, restluft: 1 }) => K.baueEintrag(
  '2026-09-02T08:00:00.000Z', '2026-09-02T08:20:00.000Z', v3Akt(), wand);
const eintrag = () => bauen().eintrag;

function stillLaufen(argv) {
  const echt = process.stdout.write;
  let aus = '';
  process.stdout.write = (s) => { aus += s; return true; };
  try { K.haupt(argv); } finally { process.stdout.write = echt; }
  return aus;
}

// ── Das Werkzeug selbst ────────────────────────────────────────────────────

test('--force gibt es nicht (F6-B8)', () => {
  assert.throws(() => K.haupt(['--force']), /--force gibt es nicht/);
});

test('der Akt ist konfirmatorisch und feuert nicht selbst', () => {
  const e = eintrag();
  assert.strictEqual(e.typ, ART_ZUGRIFF);
  assert.strictEqual(e.runId, 'f6-konfirmatorisch-v4-2026-09-02');
  assert.match(e.laufFreigabe, /DER LAUF FEUERT NICHT MIT DIESEM EINTRAG/);
  assert.match(e.laufFreigabe, /AUSDRUECKLICHE, GETRENNTE Signal/);
});

test('der Zugriffs-Fussboden ist ein Startblock: +20 min, nicht +2 h', () => {
  assert.strictEqual(K.VORLAUF_MINUTEN, 20);
  const e = eintrag();
  const spanne = new Date(e.accessedAt) - new Date(e.registeredAt);
  assert.strictEqual(spanne, 20 * 60000);
});

test('er ueberholt v3 nach DATEI + eventHash (LR-21), in DERSELBEN Datei', () => {
  const e = eintrag();
  const ziel = e.supersedierungVonV3.ueberholterEintrag;
  assert.strictEqual(ziel.datei, K.ZIEL_REL, 'v3 liegt in der Fortsetzung');
  assert.strictEqual(ziel.runId, V3.RUN_ID);
  assert.strictEqual(ziel.eventHash, K.RUMPF.eventHash);
  assert.strictEqual(ziel.datei, K.RUMPF.datei);
});

test('ein verbogener Quell-Hash bricht ab, statt zu kopieren', () => {
  const reg = bisZumKettenende(zielRegister());
  assert.throws(
    () => V3.quellAkt({ ...K.RUMPF, eventHash: 'f'.repeat(64) }, reg),
    /traegt eventHash .*, erwartet/,
  );
});

// ── LR-2: ausgeschrieben, nie verzeigert ──────────────────────────────────

test('die Weggefallenes-Pruefung FEUERT — einmal absichtlich gebrochen', () => {
  const e = eintrag();
  assert.doesNotThrow(() => V3.pruefeWeggefallenes(['runId', 'typ'], e));
  assert.throws(
    () => V3.pruefeWeggefallenes(['gibtEsNichtA', 'gibtEsNichtB'], e),
    /findet 2 verlorene Felder/,
  );
});

test('JEDES Feld von v3 faehrt mit — 0 Verluste, mechanisch gezaehlt', () => {
  const e = eintrag();
  const v3 = v3Akt();
  const aus = new Set(['runId', 'typ', 'registeredAt', 'accessedAt',
    'previousHash', 'eventHash']);
  const soll = Object.keys(v3).filter((k) => !aus.has(k));
  const verloren = soll.filter((k) => !(k in e));
  assert.deepStrictEqual(verloren, [], `verlorene Felder: ${verloren.join(', ')}`);
  assert.strictEqual(e.weggefallenes.eigenePruefungV4.treffer.length, 0);
  assert.strictEqual(e.weggefallenes.eigenePruefungV4.gepruefteFelder, soll.length);
});

// ── LRA-12 / LFA2-11: jeder SHA frisch gemessen ───────────────────────────

test('JEDER gebundene SHA ist am Objekt gemessen, keiner abgeschrieben', () => {
  const e = eintrag();
  for (const karte of ['skripte', 'artefakte']) {
    for (const [rel, wert] of Object.entries(e.eingabenHashes[karte])) {
      const ist = sha256(fs.readFileSync(path.join(WURZEL, ...rel.split('/'))));
      assert.strictEqual(wert.dateiSha256, ist, `${karte}/${rel} ist abgeschrieben`);
    }
  }
});

test('der Laeufer wird auf den REPARIERTEN Stand umgebunden', () => {
  const e = eintrag();
  const rel = 'scripts/studie-f6-lauf.py';
  const ist = sha256(fs.readFileSync(path.join(WURZEL, ...rel.split('/'))));
  assert.strictEqual(e.eingabenHashes.skripte[rel].dateiSha256, ist);
  const vn = e.eingabenHashes.vorherNachher[rel];
  assert.strictEqual(vn.vorher, v3Akt().eingabenHashes.skripte[rel].dateiSha256,
    'das Vorher ist nicht der von v3 gebundene Stand');
  assert.strictEqual(vn.nachher, ist);
  assert.notStrictEqual(vn.vorher, vn.nachher, 'ohne Drift braeuchte es diesen Akt nicht');
});

// ── F6-C24a: die Drift-Bytes als eigener benannter Wechsel ────────────────

test('F6-C24a: die drei Drift-Dateien sind BENANNT, mit art, rolle und PR', () => {
  const e = eintrag();
  const d = e.eingabenHashes.vorherNachher.f6c24aDriftBytes;
  assert.match(d.prNummer, /#253/);
  assert.strictEqual(d.dateien.length, 3);
  for (const f of d.dateien) {
    assert.ok(f.pfad && f.vorher && f.nachher, `unvollstaendig: ${f.pfad}`);
    assert.ok(f.art, `${f.pfad} fuehrt keine art (F6-C24a)`);
    assert.ok(f.rolle, `${f.pfad} fuehrt keine rolle (F6-C24a)`);
    assert.ok(f.was, `${f.pfad} sagt nicht, WAS sich geaendert hat`);
    assert.notStrictEqual(f.vorher, f.nachher);
  }
});

test('F6-C24a: die vorher/nachher-SHA sind BYTE-EXAKT gegen git nachgemessen', () => {
  // Der Kern der Korrektur: die Commit-Nachricht fuehrt fuer zwei der drei
  // Dateien Werte aus einer PowerShell-Umleitung, die den Strom als UTF-16 neu
  // kodiert hat. Hier wird gegen git gemessen, nicht gegen die Nachricht.
  const zeigen = (commit, rel) => execFileSync('git',
    ['show', `${commit}:${rel}`], { cwd: WURZEL, maxBuffer: 64 * 1024 * 1024 });
  for (const f of K.C24A_DRIFT) {
    assert.strictEqual(sha256(zeigen('3961ed8ace', f.pfad)), f.vorher,
      `${f.pfad}: vorher stimmt nicht mit dem Stand auf main ueberein`);
    assert.strictEqual(sha256(zeigen('3d0073abe9', f.pfad)), f.nachher,
      `${f.pfad}: nachher stimmt nicht mit dem Draft-Commit ueberein`);
  }
});

test('die Berichtigung der Messung steht im Akt, mit dem Grund', () => {
  const e = eintrag();
  const k = e.eingabenHashes.vorherNachher.f6c24aDriftBytes.korrektur;
  assert.match(k, /UTF-16/);
  assert.match(k, /120\.684 B statt der echten 59\.098 B/);
  assert.match(k, /5c0f685e/, 'der korrekte Laeufer-Wert wird nicht als korrekt benannt');
});

// ── LF-20: die Ehrlichkeitspflicht ueber v3 ───────────────────────────────

test('LF-20: alle zehn Punkte stehen im Akt', () => {
  const s = eintrag().supersedierungVonV3;
  assert.match(s.dreiGruende.eins, /UNAUSFUEHRBAR REGISTRIERT/);
  assert.match(s.dreiGruende.eins, /KEIN WERT VON --register/);
  assert.match(s.dreiGruende.zwei, /steht 0-mal im Zugriffs-Register/);
  assert.match(s.dreiGruende.drei, /f6-tor-freeze-2026-08-31.*den es nicht gibt/);
  assert.match(s.wieGefunden, /NICHT DURCH EINEN LAUF/);
  assert.match(s.todesklasseUeberlebte, /DREI Sterbestellen/);
  assert.match(s.f6k22Form.panelByte, /KEIN PANEL-BYTE/);
  assert.match(s.f6k22Form.nichtUnterscheidbar, /NICHT GEMESSEN/);
  assert.match(s.f6k22Form.friedhof, /KEINEN FRIEDHOFSEINTRAG/);
  assert.match(s.f6k22Form.siegel, /ZU und UNVERBRAUCHT/);
  assert.match(s.einMalDeckel.behauptung, /LETZTE VERSUCH STEHT UNVERBRAUCHT/);
  assert.match(s.einMalDeckel.grund, /GEFEUERTE LAEUFE, NICHT REGISTRIERTE AKTE/);
  assert.match(s.einMalDeckel.lesartGehoertNichtDemBauer, /NIE dem Bauenden/);
  assert.match(s.blindAttestErneuerung, /KEINERLEI Information/);
  assert.match(s.c24Wiederscharf, /WIEDER SCHARF/);
  assert.match(s.metaTatsache, /ZWEI AKTE HINTEREINANDER/);
});

test('der b4-Pflichtsatz ist hier VERBOTEN und steht nicht im Akt', () => {
  const roh = JSON.stringify(eintrag());
  assert.ok(!/NICHT UNTERSCHEIDBAR wurde gemessen/i.test(roh));
  assert.match(eintrag().supersedierungVonV3.f6k22Form.b4Pflichtsatz, /VERBOTEN/);
});

// ── LF-8, LFA2-9, LFA2-12/13, LF-1 ───────────────────────────────────────

test('LF-8: der Restposten ist NAMENTLICH beurkundet, mit seiner Enge', () => {
  const r = eintrag().restpostenLF8;
  assert.match(r.gewaehlteForm, /wert = null, erfuellt = null/);
  assert.match(r.warumSicher, /KURZSCHLIESST/);
  assert.match(r.engGefasst, /NaN, Infinity/);
});

test('LFA2-9: die drei Restluecken-Saetze stehen im Akt', () => {
  const r = eintrag().restlueckenLFA2_9;
  assert.match(r.eins, /NICHT UNTERSCHEIDBAR|nicht unterscheidbar/i);
  assert.match(r.zwei, /TOCTOU/);
  assert.match(r.drei, /RIEGELS, NICHT DIE EINES BRANDES/);
});

test('LFA2-12/13: protokolliert, nicht gebaut', () => {
  const n = eintrag().nurProtokolliert;
  assert.match(n.dokuDrift.fundstelle, /klumpen-se\.py:239-240/);
  assert.match(n.dokuDrift.folge, /NULL BYTES/);
  assert.match(n.intNebenbefund.folge, /ES SIND SECHS/);
});

test('LF-1: beide Messebenen und der gehaltene Zeilen-Anker', () => {
  const b = eintrag().baumzustandLF1;
  assert.match(b.commitEbene.vorDerReparatur, /^3961ed8ace/);
  assert.match(b.commitEbene.nachDerReparatur, /^2f809246e4/);
  assert.match(b.arbeitsbaumEbene.befund, /KEIN WIDERSPRUCH/);
  assert.match(b.ankerGehalten, /:415-447/);
});

// ── LR-19: die Wand ──────────────────────────────────────────────────────

test('LR-19: die Nullreserve wird als Verengung benannt, nicht als Reserve', () => {
  const w = eintrag().wandLR19;
  assert.match(w.berichtigungDerPlanung, /NULL weiterer/);
  assert.match(w.grundDesZuwachses, /STRUKTURELL/);
  assert.match(w.zweiFolgen.abbruch, /F6-K19/);
  assert.match(w.zweiFolgen.erfolg, /Groessenordnung kleiner/);
  assert.match(w.verhaeltnisZuLR18, /PHYSISCH statt prozedural/);
  assert.match(w.ohneEuphemismus, /nicht als Reserve umettikettiert/);
});

test('LR-19 FIXPUNKT: die Zahlen im Akt sind die, die der Akt erzeugt', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k11v4-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const fixture = path.join(d, 'fortsetzung.json');
  fs.writeFileSync(fixture, serialisiere(bisZumKettenende(zielRegister())));

  const aus = stillLaufen(['--register', fixture]);
  const danach = Number(/Fortsetzung danach\s+(\d+) B/.exec(aus)[1]);
  const zuwachs = Number(/Zuwachs\s+(\d+) B/.exec(aus)[1]);
  const restluft = Number(/Restluft\s+(\d+) B/.exec(aus)[1]);

  // Der Akt, den derselbe Lauf gebaut haette - mit genau diesen Zahlen.
  const e = bauen({ danach, zuwachs, restluft }).eintrag;
  assert.strictEqual(e.wandLR19.nachherBytes, danach);
  assert.strictEqual(e.wandLR19.zuwachsBytes, zuwachs);
  assert.strictEqual(e.wandLR19.restluftBytes, restluft);
  // Und die Arithmetik stimmt in sich. GEMESSEN WIRD GEGEN DAS FIXTURE, gegen
  // das der Lauf gefahren ist - nicht gegen `wandLR19.vorherBytes`. Der Wert
  // dort stammt aus einer Messung beim `require` an der ECHTEN Datei und ist,
  // sobald der Akt geschrieben IST, deren NEUE Groesse; die Probe verglich
  // damit zwei verschiedene Dateien und waere in genau dem Moment rot
  // geworden, in dem sie gruen bleiben muss. Dieselbe Klasse wie der
  // getippte Stempel in studie-naht-beweisebene: eine Zusicherung ueber den
  // Stand der echten Registerdatei statt ueber den eigenen Gegenstand.
  const fixtureBytes = fs.statSync(fixture).size;
  assert.strictEqual(fixtureBytes + zuwachs, danach);
  assert.strictEqual(e.wandLR19.deckelBytes - danach, restluft);
  // Die Nullreserve ist eine MESSUNG, keine Behauptung.
  assert.ok(restluft < zuwachs,
    'die Reserve traegt doch einen weiteren Akt - dann ist die Beurkundung falsch');
});

test('LR-20 verweigert bei ERREICHTEM Deckel, nicht erst darueber', () => {
  assert.throws(() => K.pruefeDeckelV4(K.DECKEL_BYTES), /erreichte damit den/);
  assert.doesNotThrow(() => K.pruefeDeckelV4(K.DECKEL_BYTES - 1));
});

// ── Der Trockenlauf ──────────────────────────────────────────────────────

test('der Trockenlauf schreibt nichts — beide Aufrufformen (F6-K28)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k11v4-tr-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const fixture = path.join(d, 'fortsetzung.json');
  fs.writeFileSync(fixture, serialisiere(bisZumKettenende(zielRegister())));

  const vorherEcht = sha256(fs.readFileSync(ZIEL));
  const vorherGeschlossen = sha256(fs.readFileSync(GESCHLOSSEN));
  const vorherFixture = sha256(fs.readFileSync(fixture));

  const ausAbs = stillLaufen(['--register', fixture]);
  const cwd = process.cwd();
  let ausRel;
  try {
    process.chdir(d);
    ausRel = stillLaufen(['--register', 'fortsetzung.json']);
  } finally {
    process.chdir(cwd);
  }

  assert.strictEqual(sha256(fs.readFileSync(ZIEL)), vorherEcht,
    'die Fortsetzung wurde angefasst');
  assert.strictEqual(sha256(fs.readFileSync(GESCHLOSSEN)), vorherGeschlossen,
    'die geschlossene Datei wurde angefasst');
  assert.strictEqual(sha256(fs.readFileSync(fixture)), vorherFixture,
    'der Trockenlauf hat ins Fixture geschrieben');
  for (const aus of [ausAbs, ausRel]) {
    assert.match(aus, /TROCKENLAUF - es wurde NICHTS geschrieben/);
    assert.match(aus, /Weggefallenes\s+\d+ Felder geprueft, 0 Treffer/);
    assert.match(aus, /Passt noch\s+0 weiterer Akt/);
  }
});

test('in eine Fortsetzung mit falscher Laenge schreibt dieser Akt nicht', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k11v4-len-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const reg = bisZumKettenende(zielRegister());
  reg.events.pop(); // ein Eintrag zu wenig
  const fixture = path.join(d, 'kurz.json');
  fs.writeFileSync(fixture, serialisiere(reg));
  assert.throws(() => K.haupt(['--register', fixture]),
    /fuehrt 1 Eintraege, erwartet 2/);
});

test('nach dem eigenen Merge ist das Werkzeug inert (Einweg-Anhaenger)', () => {
  // Sobald v4 in der echten Fortsetzung steht, fuehrt sie DREI Eintraege und
  // die runId ist belegt - beide Riegel halten das Werkzeug an.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k11v4-inert-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const reg = bisZumKettenende(zielRegister());
  reg.events.push({ runId: K.RUN_ID, typ: ART_ZUGRIFF });
  const fixture = path.join(d, 'nachher.json');
  fs.writeFileSync(fixture, serialisiere(reg));
  assert.throws(() => K.haupt(['--register', fixture]),
    /fuehrt 3 Eintraege, erwartet 2|bereits belegt/);
});

test('der Akt traegt keinen Nutzerpfad', () => {
  const roh = JSON.stringify(eintrag());
  assert.ok(!/[A-Za-z]:[\\/]{1,2}Users/.test(roh), 'Windows-Nutzerpfad im Akt');
  assert.ok(!/\/home\/[a-z]/.test(roh), 'Unix-Heimverzeichnis im Akt');
});
