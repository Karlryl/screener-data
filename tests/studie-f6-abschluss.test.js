'use strict';

// Waechter fuer scripts/studie-f6-abschluss.js — den Abschluss-Akt der ersten
// Registerdatei (LR-4/LR-5/LR-20).
//
// Die Fixture-Regeln dieses Hauses, teuer gelernt und hier von Anfang an
// angewandt: das Fixture-Register wird bis zum ERWARTETEN KETTENENDE
// abgeschnitten, nie auf eine feste Laenge; das echte Register wird nie ohne
// --register gefahren; und BEIDE Registerstaende — mit und ohne den eigenen
// Eintrag — muessen auf denselben Stand zurueckschneiden. Genau diese Klasse
// hat die Waechter zu vier Eintraegen hintereinander gerissen.
//
// Usage: node --test tests/studie-f6-abschluss.test.js

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const WURZEL = path.join(__dirname, '..');
const K = require(path.join(WURZEL, 'scripts', 'studie-f6-abschluss.js'));

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const eintrag = () => K.baueEintrag(
  '2026-09-01T21:00:00.000Z', '2026-09-01T23:00:00.000Z',
  { eventCountVorher: 30, bytesVorher: K.SOLL_BYTES_VORHER, dateiSha256VorDiesemAkt: K.SOLL_DATEI_SHA256 });

// Schneidet einen Registerstand auf das Kettenende zurueck, das DIESES Werkzeug
// erwartet. Die Eigenschaft ist der Tail, nicht die Anzahl.
function bisZumKettenende(register) {
  const reg = JSON.parse(JSON.stringify(register));
  while (reg.events.length && reg.events.at(-1).eventHash !== K.ERWARTETER_TAIL) {
    reg.events.pop();
  }
  return reg;
}
const serialisiere = (reg) => `${JSON.stringify(reg, null, 1)}\n`;

function stillLaufen(argv) {
  const echt = process.stdout.write;
  let aus = '';
  process.stdout.write = (s) => { aus += s; return true; };
  try { K.haupt(argv); } finally { process.stdout.write = echt; }
  return aus;
}

test('--force gibt es nicht (F6-B8)', () => {
  assert.throws(() => K.haupt(['--force']), /--force gibt es nicht/);
});

// ── LR-4: die Form des Akts ───────────────────────────────────────────────
test('der Akt ist ein C0_REGELFREEZE, der nichts erlaubt', () => {
  const e = eintrag();
  assert.strictEqual(e.typ, 'C0_REGELFREEZE');
  assert.deepStrictEqual(e.allowedOutputs, []);
  assert.strictEqual(e.erlaubt, 'Nichts. Kein Datenzugriff.');
  assert.strictEqual(e.fenster.length, 1);
  assert.match(e.fenster[0], /kein Studienfenster - Speicher-Rollover ohne Datenzugriff/);
  assert.ok(Date.parse(e.registeredAt) < Date.parse(e.accessedAt),
    'registeredAt muss vor accessedAt liegen (VB-A11)');
  // Die Deutung des accessedAt woertlich aus dem Vorgaenger-Vermerk.
  assert.match(e.zeitfensterDeutung,
    /accessedAt bezeichnet hier keinen Zugriff, sondern den fruehesten Zeitpunkt, ab dem der ergaenzte Stand gilt; die Art C0_REGELFREEZE verlangt das Feld\./);
  assert.match(e.endtestSiegel, /UNVERBRAUCHT/);
  assert.match(e.blindAttest, /KEINERLEI Information/);
});

test('das verboten-Feld schliesst alle drei Dinge aus, die es ausschliessen muss', () => {
  const v = eintrag().verboten;
  assert.match(v, /Jeder weitere Eintrag in DIESER Datei/);
  assert.match(v, /Berufung auf diesen Eintrag als Autorisierung eines Laufs/);
  assert.match(v, /Aenderung an einem der bisherigen Eintraege/);
});

// ── LR-5: was der Akt beurkundet ──────────────────────────────────────────
test('der abschluss-Block traegt alle sechs Pflichtgroessen', () => {
  const a = eintrag().abschluss;
  for (const k of ['eventCountVorher', 'tailHashVorDiesemAkt', 'bytesVorher',
    'dateiSha256VorDiesemAkt', 'deckelBytes', 'ausloeser']) {
    assert.ok(a[k] !== undefined && a[k] !== null, `Pflichtgroesse ${k} fehlt`);
  }
  assert.strictEqual(a.deckelBytes, 204800);
  assert.strictEqual(a.ausloeser, 'R14a');
  assert.strictEqual(a.tailHashVorDiesemAkt, K.ERWARTETER_TAIL);
  // LR-18: die Ausloesemessung selbst ist beurkundet, nicht nur behauptet.
  assert.strictEqual(a.ausloeseMessung.restluftVorher, 204800 - K.SOLL_BYTES_VORHER);
  assert.strictEqual(
    a.ausloeseMessung.registerNachK11OhneNaht,
    K.SOLL_BYTES_VORHER + a.ausloeseMessung.k11AktZuwachsImRegister);
  assert.strictEqual(
    a.ausloeseMessung.fehlbetrag,
    a.ausloeseMessung.registerNachK11OhneNaht - 204800);
  assert.ok(a.ausloeseMessung.fehlbetrag > 0, 'ohne Fehlbetrag waere die Naht nicht gefordert');
  // LR-21: die Quellen des K11-Akts nach DATEI + eventHash, nie nach Ordnungszahl.
  assert.strictEqual(a.ausloeseMessung.quellenDesK11Akts.length, 3);
  for (const q of a.ausloeseMessung.quellenDesK11Akts) {
    assert.match(q.eventHash, /^[0-9a-f]{64}$/);
  }
});

test('die Messgroessen sind AM OBJEKT gemessen, nicht aus dem Kopf abgeschrieben', () => {
  // Die Eigenschaft: was der Akt beurkundet, ist das, was hineingereicht wurde.
  // Ein Akt, der seine Konstanten abschreibt, koennte eine falsche
  // Ausloesemessung tragen, ohne dass irgendetwas rot wuerde.
  const e = K.baueEintrag('2026-09-01T21:00:00.000Z', '2026-09-01T23:00:00.000Z',
    { eventCountVorher: 7, bytesVorher: 4242, dateiSha256VorDiesemAkt: 'f'.repeat(64) });
  assert.strictEqual(e.abschluss.eventCountVorher, 7);
  assert.strictEqual(e.abschluss.bytesVorher, 4242);
  assert.strictEqual(e.abschluss.dateiSha256VorDiesemAkt, 'f'.repeat(64));
});

test('der fortsetzung-Block traegt die Genesis-REGEL und NIE den Genesis-WERT', () => {
  const f = eintrag().fortsetzung;
  assert.strictEqual(f.dateiname, K.FORTSETZUNG_REL);
  assert.match(f.dateiname, /outcome-access-ledger-teil2\.json$/);
  assert.match(f.dateiname, /^protocol\/early-detection\/2\.0\.0\//,
    'gleiches Verzeichnis, sonst stiller Ausfall aus R14a/R12a/R12b (LR-6)');
  assert.match(f.genesisRegel, /TAIL-EVENT-HASH/);
  assert.match(f.genesisRegel, /Fixpunkt/);
  assert.match(f.genesisEntscheidung, /Tail-Event-Hash, nicht Byte-sha/);
  assert.match(f.byteSiegelGetrennt, /vorgaengerDateiSha256/);
  assert.match(f.monotonieUeberDieNaht, /vorgaengerLetzteAnmeldung/);
  // Die Eigenschaft, nicht die Formheuristik: im ganzen Block steht KEIN
  // 64-stelliger Hex-Wert. Der Genesis-WERT entsteht erst durch das Schreiben
  // dieses Eintrags; wer ihn hier hineinschriebe, schriebe eine Vermutung.
  for (const [k, v] of Object.entries(f)) {
    assert.ok(!/\b[0-9a-f]{64}\b/.test(v), `fortsetzung.${k} traegt einen 64-Hex-Wert`);
  }
});

test('der Akt zitiert beide Gerichtsakten und F6-K26 woertlich', () => {
  const g = eintrag().gerichtsbefehl;
  assert.ok(g.akten.includes('_COURT-LEDGER-ROLLOVER-2026-09-01'));
  assert.ok(g.akten.includes('_COURT-F6-KONTINGENT-2026-09-01'));
  assert.match(g.auflagen, /LR-1 bis LR-22/);
  assert.match(g.einordnung, /F6-K11/);
  assert.match(g.einordnung, /F6-K17/);
  // Nicht gegen meine Abschrift, sondern gegen die QUELLE. Ein "woertlich"
  // befohlenes Zitat, das nur mit sich selbst verglichen wird, ist keins.
  const quelle = fs.readFileSync(path.join(WURZEL, 'protocol', 'early-detection',
    '2.1.0', 'f6-vollzug-zweig-a-2026-08-31.json'), 'utf8');
  const anfang = quelle.indexOf('DAS DESIGN WIRD NICHT MEHR GEAENDERT');
  assert.ok(anfang > 0, 'der F6-K26-Wortlaut steht nicht mehr in seiner Quelle');
  assert.ok(quelle.startsWith(g.k26Woertlich, anfang),
    'das Zitat weicht von der Quelle ab - genau das darf bei einem woertlich '
    + 'befohlenen Zitat nie passieren');
  assert.match(g.k26Anwendung, /KEINES dieser sechs Dinge/);
  assert.match(g.keinRoutineRollover, /DRITTE Registerdatei/);
});

test('LR-22 und LR-15 stehen im Akt, gedeckt statt behauptet', () => {
  const e = eintrag();
  assert.match(e.nichtsVerschoben.feststellung, /KEIN EREIGNIS WIRD VERSCHOBEN/);
  assert.match(e.nichtsVerschoben.gedecktDurch, /dateiSha256VorDiesemAkt/);
  assert.match(e.nichtsVerschoben.gedecktDurch, /tailHashVorDiesemAkt/);
  assert.match(e.nichtsVerschoben.byteFrostAbDiesemAkt, /byte-eingefroren/);
  assert.match(e.umhaengeVerbot, /UMHAENGEN IST DIE EROSION, NICHT DIE VOLLENDUNG/);
});

// ── LR-3: der Blindheits-Zaun, mechanisch ─────────────────────────────────
test('keine Zahl im Akt ist eine Studiengroesse', () => {
  // Zulaessig sind ausschliesslich Dateigroessen, Eintragszahlen und der
  // Deckel. Eine Panelzahl, eine Prueffenster-Menge oder eine Entdeckungszahl
  // faellt hier auf, weil sie in dieser Menge nicht vorkommt.
  const erlaubt = new Set([
    30, K.SOLL_BYTES_VORHER, K.DECKEL_BYTES, K.DECKEL_BYTES - K.SOLL_BYTES_VORHER,
    K.MESSGATE.k11AktKompaktBytes, K.MESSGATE.k11AktZuwachsImRegister,
    K.MESSGATE.registerNachK11OhneNaht, K.MESSGATE.fehlbetrag,
  ]);
  const zahlen = [];
  (function sammle(v) {
    if (typeof v === 'number') zahlen.push(v);
    else if (Array.isArray(v)) v.forEach(sammle);
    else if (v && typeof v === 'object') Object.values(v).forEach(sammle);
  }(eintrag()));
  assert.ok(zahlen.length > 0, 'keine Zahlen gefunden - die Probe waere leer');
  for (const z of zahlen) {
    assert.ok(erlaubt.has(z), `unerwartete Zahl im Akt: ${z} (LR-3)`);
  }
});

test('der Akt traegt keinen Nutzerpfad, und der Riegel feuert', () => {
  const { pruefeR12a } = require(path.join(WURZEL, 'scripts', 'studie-f6-vorfall.js'));
  assert.doesNotThrow(() => pruefeR12a(eintrag()));
  const BS = String.fromCharCode(92);
  assert.throws(() => pruefeR12a({ a: `C:${BS}Users${BS}Jemand${BS}f6-arbeit` }),
    /Windows-Laufwerkspfad/);
});

// ── LR-20: der Deckel, fail-closed, mit zweiseitiger Bruchprobe ───────────
test('LR-20 verweigert bei ERREICHTEM Deckel, nicht erst darueber', () => {
  assert.throws(() => K.pruefeDeckel(K.DECKEL_BYTES), /LR-20/);
  assert.throws(() => K.pruefeDeckel(K.DECKEL_BYTES + 1), /LR-20/);
  assert.doesNotThrow(() => K.pruefeDeckel(K.DECKEL_BYTES - 1));
});

// ── Das Fixture: beide Registerstaende, beide Aufrufformen ────────────────
function baueFixture(verzeichnis, name, fuellung) {
  const roh = fs.readFileSync(K.LEDGER, 'utf8');
  const reg = bisZumKettenende(JSON.parse(roh));
  if (fuellung) reg.fuellung = fuellung;
  const ziel = path.join(verzeichnis, name);
  fs.writeFileSync(ziel, serialisiere(reg));
  return ziel;
}

test('beide Registerstaende schneiden auf denselben Stand zurueck', () => {
  // DIE Invariante, an der vier Waechter hintereinander gerissen sind: das
  // Fixture muss VOR und NACH dem Merge des eigenen Akts dasselbe ergeben.
  const lebend = JSON.parse(fs.readFileSync(K.LEDGER, 'utf8'));
  const ohne = bisZumKettenende(lebend);
  assert.strictEqual(ohne.events.at(-1).eventHash, K.ERWARTETER_TAIL);

  // Der Stand MIT dem eigenen Eintrag, kettenecht angehaengt.
  const { haengeEintragAn } = require(path.join(WURZEL, 'lib', 'studie-verfassung.js'));
  const mit = haengeEintragAn(ohne, K.baueEintrag(
    '2026-09-01T22:00:00.000Z', '2026-09-02T00:00:00.000Z',
    { eventCountVorher: 30, bytesVorher: K.SOLL_BYTES_VORHER, dateiSha256VorDiesemAkt: K.SOLL_DATEI_SHA256 }));
  assert.strictEqual(mit.events.length, ohne.events.length + 1);

  const a = serialisiere(ohne);
  const b = serialisiere(bisZumKettenende(mit));
  assert.strictEqual(sha256(Buffer.from(b, 'utf8')), sha256(Buffer.from(a, 'utf8')),
    'die beiden Registerstaende schneiden NICHT auf denselben Stand zurueck');
  // Und dieser eine Stand ist genau der, dessen Bytes der Akt beurkundet.
  assert.strictEqual(sha256(Buffer.from(a, 'utf8')), K.SOLL_DATEI_SHA256);
  assert.strictEqual(Buffer.byteLength(a, 'utf8'), K.SOLL_BYTES_VORHER);
});

test('der Trockenlauf schreibt nichts — beide Aufrufformen (F6-K28)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-ab-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const fixture = baueFixture(d, 'basis-register.json');

  const vorherEcht = sha256(fs.readFileSync(K.LEDGER));
  const vorherFixture = sha256(fs.readFileSync(fixture));

  // (i) ABSOLUTE Aufrufform.
  const ausAbs = stillLaufen(['--register', fixture]);
  // (ii) RELATIVE Aufrufform — die, in der ein Mensch das Werkzeug startet und
  // die in diesem Haus schon einmal einen Lauf nach der Paneloeffnung gerissen
  // hat. Jede Fixture des konfirmatorischen Pfades traegt beide (F6-K28).
  const cwd = process.cwd();
  let ausRel;
  try {
    process.chdir(d);
    ausRel = stillLaufen(['--register', 'basis-register.json']);
  } finally {
    process.chdir(cwd);
  }

  assert.strictEqual(sha256(fs.readFileSync(K.LEDGER)), vorherEcht,
    'das echte Register wurde angefasst');
  assert.strictEqual(sha256(fs.readFileSync(fixture)), vorherFixture,
    'der Trockenlauf hat ins Fixture geschrieben');
  for (const aus of [ausAbs, ausRel]) {
    assert.match(aus, /TROCKENLAUF - es wurde NICHTS geschrieben/);
    assert.match(aus, new RegExp(`"previousHash": "${K.ERWARTETER_TAIL}"`));
    assert.match(aus, new RegExp(`Vorher\\s+${K.SOLL_BYTES_VORHER} B`));
  }
});

test('LR-20 greift durch das Werkzeug, VOR dem SOLLWERT-Riegel', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-ab-deckel-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  // Ein Registerstand, der mit dem Akt den Deckel erreicht. Ein Kopf-Feld
  // beruehrt die Kette nicht — der Stand bleibt gueltig und ist trotzdem zu
  // gross. Genau der Fall, fuer den es keine Reparatur gaebe.
  const gross = baueFixture(d, 'zu-gross.json', 'x'.repeat(10000));
  assert.ok(fs.statSync(gross).size < K.DECKEL_BYTES,
    'die Fixture muss VOR dem Akt noch unter dem Deckel liegen, sonst prueft sie das Falsche');
  assert.throws(() => stillLaufen(['--register', gross]), /LR-20/);
  // Und der SOLLWERT-Riegel darunter faengt jede kleinere Drift.
  const verschoben = baueFixture(d, 'verschoben.json', 'y'.repeat(64));
  assert.throws(() => stillLaufen(['--register', verschoben]),
    /Der Stand hat sich unter dem Werkzeug bewegt/);
});

test('ein fremdes Kettenende wird abgewiesen', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-ab-kette-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const reg = bisZumKettenende(JSON.parse(fs.readFileSync(K.LEDGER, 'utf8')));
  reg.events.pop();
  const ziel = path.join(d, 'kurz.json');
  fs.writeFileSync(ziel, serialisiere(reg));
  assert.throws(() => stillLaufen(['--register', ziel]),
    /Eintraege, erwartet 30|Kettenende ist/);
});

test('nach dem eigenen Merge ist das Werkzeug inert (Einweg-Anhaenger)', () => {
  // Der Zustand, in dem main NACH PR-B steht. Ein Einweg-Anhaenger, der dort
  // noch einmal feuern koennte, waere ein zweiter Appender auf einer Datei,
  // die dieser Akt gerade geschlossen hat.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-ab-inert-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const { haengeEintragAn } = require(path.join(WURZEL, 'lib', 'studie-verfassung.js'));
  const nachMerge = haengeEintragAn(
    bisZumKettenende(JSON.parse(fs.readFileSync(K.LEDGER, 'utf8'))),
    K.baueEintrag('2026-09-01T22:00:00.000Z', '2026-09-02T00:00:00.000Z',
      { eventCountVorher: 30, bytesVorher: K.SOLL_BYTES_VORHER, dateiSha256VorDiesemAkt: K.SOLL_DATEI_SHA256 }));
  const ziel = path.join(d, 'nach-merge.json');
  fs.writeFileSync(ziel, serialisiere(nachMerge));
  assert.throws(() => stillLaufen(['--register', ziel]),
    /Eintraege, erwartet 30/);
});
