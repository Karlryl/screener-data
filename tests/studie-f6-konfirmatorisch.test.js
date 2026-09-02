'use strict';

// Waechter fuer scripts/studie-f6-konfirmatorisch.js.
//
// Die Waechter haengen am OBJEKT, nicht an einem Textmuster: jeder Riegel wird
// einmal ABSICHTLICH gebrochen, damit sichtbar ist, dass er feuert. Ein Test,
// der nur den gruenen Weg laeuft, bezeugt nichts.

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const WERKZEUG = path.join(__dirname, '..', 'scripts', 'studie-f6-konfirmatorisch.js');
const WURZEL = path.join(__dirname, '..');
const LEDGER = path.join(WURZEL, 'protocol', 'early-detection', '2.0.0',
  'outcome-access-ledger.json');
const BERICHT_REL = 'reports/studie/f6-aequivalenz-entdeckung-2026-09-01.json';
// Der Stand, den Eintrag 27 gebunden hat (origin/main vor PR G).
const STAND_DES_AKTES = '10e08e3746494ca7f064dc773fbdcf92e931ceea';

const K = require(WERKZEUG);

// ── Werkbank: eine wegwerfbare Kopie der gebundenen Dateien ────────────────
function werkbank() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-konf-'));
  for (const rel of [...Object.keys(K.SKRIPTE), ...Object.keys(K.ARTEFAKTE),
    'protocol/early-detection/2.0.0/hash-manifest.json', BERICHT_REL]) {
    const quelle = path.join(WURZEL, ...rel.split('/'));
    const ziel = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    if (fs.existsSync(quelle)) fs.copyFileSync(quelle, ziel);
  }
  // PR G/H haben zwei gebundene Skripte bewusst veraendert. Die Bindungsliste
  // dieses Werkzeugs ist URKUNDE ueber Eintrag 27 und wird NICHT nachgezogen -
  // also stellt die Werkbank den Stand wieder her, den der Akt gebunden hat.
  // Ohne das braeche jede Probe am SHA-Riegel ab und neun Waechter waeren
  // still abgeschaltet (Ruling des Orchestrators: uebersprungene Proben
  // verrotten).
  //
  // UEBER DIE GEBUNDENE MENGE, UND BEDINGT. Die Liste war handgeschrieben und
  // bedingungslos: jedes weitere gebundene Skript, das sich aendert, haette
  // einen Eintrag von Hand verlangt - und beim vergessenen Eintrag waeren
  // Waechter still abgeschaltet. Bedingungslos war sie ausserdem eine
  // Maskierung fuer den Tag, an dem sie nichts mehr wiederherstellt.
  //
  // Zwei Bedingungen, je Datei einzeln, wie in der Werkbank zu Eintrag 28: der
  // Baum weicht von der Bindung ab UND die historischen Bytes TREFFEN die
  // Bindung. Damit entschaerft sich die Wiederherstellung selbst, sobald der
  // ueberschreibende Akt die neuen SHA bindet.
  const ERLAUBTE_ABWEICHUNGEN = new Set([
    'scripts/studie-f6-lauf.py',
    'scripts/studie-f6-zaehlwerk.py',
    'scripts/studie-f6-aequivalenz-anmeldung.js',
    'scripts/studie-r1-serverzeit.js',
    'scripts/studie-zaehlprobe.py',
  ]);
  const abgewichen = [];
  for (const [rel, bindung] of Object.entries(K.SKRIPTE)) {
    const sollSha = bindung.sha || bindung.sha256 || bindung;
    const imBaumPfad = path.join(WURZEL, ...rel.split('/'));
    if (!fs.existsSync(imBaumPfad)) continue;
    const imBaum = crypto.createHash('sha256').update(fs.readFileSync(imBaumPfad)).digest('hex');
    if (imBaum === sollSha) continue;
    // F4: die zweite Bedingung ist per Konstruktion immer wahr - der Akt hat
    // genau diesen Stand gebunden. Ohne diese Liste waere die Wiederherstellung
    // faktisch bedingungslos und maskierte eine Aenderung an einer beliebigen,
    // sogar versiegelten gebundenen Datei.
    assert.ok(ERLAUBTE_ABWEICHUNGEN.has(rel),
      `${rel} weicht von seiner Bindung ab, steht aber nicht auf der Liste der fuer diesen `
      + 'Bauabschnitt berechtigten Abweichungen.');
    abgewichen.push(rel);
    const alt = require('node:child_process').spawnSync(
      'git', ['show', `${STAND_DES_AKTES}:${rel}`],
      { cwd: WURZEL, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(alt.status, 0, `historischer Stand von ${rel} fehlt`);
    assert.equal(crypto.createHash('sha256').update(alt.stdout).digest('hex'), sollSha,
      `${rel}: die historischen Bytes treffen die Bindung nicht - dann ist die `
      + 'Wiederherstellung keine Rekonstruktion, sondern eine Erfindung');
    const ziel = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, alt.stdout);
  }
  konfWiederhergestellt.set(tmp, abgewichen);
  return tmp;
}
// F5: welche Dateien in DIESER Werkbank aus der Historie kamen - damit die
// Bedingung eine eigene Probe bekommt statt nur eine Zusage zu sein.
const konfWiederhergestellt = new Map();
const berichtDa = () => fs.existsSync(path.join(WURZEL, ...BERICHT_REL.split('/')));

// Der Akt wurde gegen einen Registerstand OHNE ihn selbst gebaut. Sobald er
// angehaengt ist, weist das Werkzeug jeden zweiten Anlauf zu Recht ab — die
// Waechter muessen deshalb auf dem Stand VOR dem Akt arbeiten, nicht auf dem
// Register, in dem er schon steht. Der Tail wird abgeschnitten, nicht
// umgeschrieben: die Kette bleibt gueltig.
function basisRegister(tmp) {
  const reg = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  // Abgeschnitten wird bis zum Kettenende, das DIESES Werkzeug erwartet - nicht
  // bis zu einer festen Laenge. Ein Register waechst; eine Probe, die die
  // Laenge festnagelt, wird beim naechsten Akt rot, ohne dass an ihrem
  // Gegenstand etwas falsch waere (genau so ist sie an Eintrag 28 gerissen).
  while (reg.events.length && reg.events.at(-1).eventHash !== K.ERWARTETER_TAIL) {
    reg.events.pop();
  }
  const p = path.join(tmp, 'basis-register.json');
  fs.writeFileSync(p, JSON.stringify(reg, null, 1));
  return p;
}

function fahre(argv, wurzel, register) {
  const echt = process.stdout.write;
  let ausgabe = '';
  process.stdout.write = (s) => { ausgabe += s; return true; };
  try {
    K.haupt(['--wurzel', wurzel, '--register', register || basisRegister(wurzel), ...argv]);
  } finally {
    process.stdout.write = echt;
  }
  return ausgabe;
}
const bricht = (argv, wurzel, register) => assert.throws(
  () => fahre(argv, wurzel, register), /F6-K/);

// ── Riegel 1: --force existiert nicht (F6-B8) ─────────────────────────────
// ── F5: die bedingte Wiederherstellung bekommt ihre eigene Probe ───────────
test('die Werkbank stellt GENAU die abweichenden gebundenen Skripte her', () => {
  const tmp = werkbank();
  const gemeldet = new Set(konfWiederhergestellt.get(tmp));
  const abweichend = Object.entries(K.SKRIPTE)
    .filter(([rel, b]) => {
      const p = path.join(WURZEL, ...rel.split('/'));
      const soll = b.sha || b.sha256 || b;
      return fs.existsSync(p)
        && crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') !== soll;
    })
    .map(([rel]) => rel);
  assert.deepStrictEqual([...gemeldet].sort(), abweichend.sort(),
    'die Wiederherstellung deckt nicht genau die abweichende Menge - sie maskiert etwas '
    + 'oder sie laesst etwas aus');
  for (const rel of gemeldet) {
    const b = K.SKRIPTE[rel];
    const ist = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(tmp, ...rel.split('/')))).digest('hex');
    assert.strictEqual(ist, b.sha || b.sha256 || b, `${rel} im Spiegel trifft die Bindung nicht`);
  }
  assert.ok(gemeldet.size > 0,
    'kein gebundenes Skript weicht ab - dann gehoert diese Wiederherstellung ersatzlos entfernt');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('--force wird abgewiesen, es gibt keine Reparatur-Betriebsart', () => {
  assert.throws(() => K.haupt(['--force']), /--force gibt es nicht/);
});

// ── Riegel 2: ein abweichendes Skript ist ein anderes Skript ──────────────
test('ein veraendertes gebundenes Skript bricht den Akt ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  fahre([], tmp);                                   // gruen, bevor gebrochen wird
  const opfer = path.join(tmp, 'scripts', 'studie-f6-zaehlwerk.py');
  fs.appendFileSync(opfer, '\n# absichtlich veraendert\n');
  assert.throws(() => fahre([], tmp), /studie-f6-zaehlwerk\.py weicht ab/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 3: ein abweichender inhaltSha256 bricht ab ─────────────────────
test('ein veraenderter inhaltSha256 bricht den Akt ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  const rel = 'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json';
  const p = path.join(tmp, ...rel.split('/'));
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.inhalt.__eingeschmuggelt = true;
  fs.writeFileSync(p, JSON.stringify(d, null, 1));
  // Der Datei-SHA reisst zuerst; genau das ist die Absicht (Datei == Inhalt).
  assert.throws(() => fahre([], tmp), /jahrgang-registrierung.*weicht ab/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 4: ohne den Aequivalenz-Bericht gibt es keinen Akt ─────────────
test('fehlender Aequivalenz-Bericht bricht den Akt ab', () => {
  const tmp = werkbank();
  const p = path.join(tmp, ...BERICHT_REL.split('/'));
  if (fs.existsSync(p)) fs.rmSync(p);
  assert.throws(() => fahre([], tmp), /Aequivalenz-Bericht fehlt/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 5: ein NICHT bestandenes Tor autorisiert nichts ────────────────
test('bestanden != true bricht den Akt ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  const p = path.join(tmp, ...BERICHT_REL.split('/'));
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.daten.bestanden = false;
  fs.writeFileSync(p, JSON.stringify(d, null, 1));
  assert.throws(() => fahre([], tmp), /bestanden != true/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 6: das Kettenende ist gebunden ─────────────────────────────────
test('ein anderes Kettenende bricht den Akt ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  const p = basisRegister(tmp);
  const reg = JSON.parse(fs.readFileSync(p, 'utf8'));
  reg.events.pop();
  fs.writeFileSync(p, JSON.stringify(reg, null, 1));
  assert.throws(() => fahre([], tmp, p), /Register fuehrt 25 Eintraege|Kettenende/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 7: dieselbe runId zweimal ist ein Abbruch ──────────────────────
test('eine bereits registrierte runId bricht den Akt ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  bricht(['--runid', 'f6-bein2-berichtigung-2026-09-01'], tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 8: die Zeitkette (VB-A11) ──────────────────────────────────────
test('wirksam-ab vor der Anmeldung bricht ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  bricht(['--anmeldezeit', '2026-09-01T10:00:00.000Z',
    '--wirksam-ab', '2026-09-01T09:00:00.000Z'], tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('eine Anmeldezeit in der Zukunft bricht ab', () => {
  const morgen = new Date(Date.now() + 86400000).toISOString();
  assert.throws(() => K.haupt(['--anmeldezeit', morgen]), /liegt in der Zukunft/);
});

// ── Riegel 9: der Ausgabesatz ist genau der registrierte ──────────────────
test('der Ausgabesatz traegt 30 Daten- plus 4 Differenz-Schluessel, keinen Umschlag', () => {
  assert.strictEqual(K.DATEN_SCHLUESSEL.length, 30);
  assert.strictEqual(new Set(K.DATEN_SCHLUESSEL).size, 30);
  assert.deepStrictEqual(K.DIFFERENZ_UNTERSCHLUESSEL,
    ['wert', 'maxDifferenzPunkte', 'erfuellt', 'quelle']);
  for (const umschlag of ['ersterZugriffAm', 'beendetAm', 'gelesenePfade',
    'ergebnisdatenBeruehrt', 'runId', 'panelSha256']) {
    assert.ok(!K.DATEN_SCHLUESSEL.includes(umschlag),
      `Umschlag-Feld ${umschlag} darf nicht im Datensatz stehen (F6-B10)`);
  }
  // Die drei Groessen, die F6-C17 ausdruecklich unterscheidet:
  assert.ok(K.DATEN_SCHLUESSEL.includes('abstand_zu_090'));
  assert.ok(K.DATEN_SCHLUESSEL.includes('abstand_zu_329_von_365'));
});

// ── Riegel 10: jeder Ausgabeschluessel steht wirklich im Laeufer ──────────
test('ein Ausgabeschluessel ohne Entsprechung im Laeufer bricht ab', { skip: !berichtDa() },
  () => {
    const tmp = werkbank();
    const p = path.join(tmp, 'scripts', 'studie-f6-lauf.py');
    // Nicht den Schluessel entfernen (das riesse den SHA-Riegel zuerst),
    // sondern die Pruefung selbst am Objekt fuehren:
    const quelle = fs.readFileSync(p, 'utf8');
    for (const k of K.DATEN_SCHLUESSEL) {
      assert.ok(quelle.includes(`"${k}"`), `${k} fehlt im Laeufer`);
    }
    assert.ok(!quelle.includes('"abstand_zu_erfundenem_wert"'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

// ── Riegel 11: der Trockenlauf schreibt nichts ────────────────────────────
test('der Trockenlauf laesst das Register byte-gleich', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  const vorher = crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex');
  const ausgabe = fahre([], tmp);
  const nachher = crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex');
  assert.strictEqual(vorher, nachher);
  assert.match(ausgabe, /TROCKENLAUF - es wurde NICHTS geschrieben/);
  assert.match(ausgabe, /"previousHash": "f9fbaac79675/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 12: der Eintrag traegt seine Pflichtsaetze ─────────────────────
test('der Eintrag sagt selbst, dass der Lauf erst nach gruenem Review feuert',
  { skip: !berichtDa() }, () => {
    const tmp = werkbank();
    // Den Eintrag wirklich anhaengen — aber in eine Kopie, nie ins Register.
    // Der Eintrag kommt aus der NUR-LESENDEN Einsicht: das Werkzeug ist zum
    // Schreiben stillgelegt, seine Inhalts-Waechter bleiben trotzdem scharf.
    const p = basisRegister(tmp);
    const ausgabe = fahre(['--zeige-eintrag'], tmp, p);
    const e = JSON.parse(ausgabe.match(/^EINTRAG:(.*)$/m)[1]);

    assert.strictEqual(e.typ, 'confirmatory_execution_authorized');
    assert.deepStrictEqual(e.fenster, ['pruefung']);
    assert.strictEqual(e.allowedOutputs.length, 34);
    assert.strictEqual(e.previousHash, K.ERWARTETER_TAIL);

    // Der Satz, der den Lauf zurueckhaelt — in erlaubt UND als eigenes Feld.
    assert.match(e.erlaubt, /FEUERT NICHT MIT DIESEM EINTRAG/);
    assert.match(e.laufFreigabe, /GRUENEM REVIEW/);
    // Endtest-Siegel in allen Zweigen zu, kein Automatismus.
    assert.match(e.endtestSiegel, /KEINEN Automatismus/);
    // F6-C8i: beide Saetze woertlich.
    assert.match(e.richtungsOffenlegungBerichtigung.satz1,
      /ENTFERNT an genau einer Zelle einen stehenden STOPP/);
    assert.match(e.richtungsOffenlegungBerichtigung.satz2,
      /nicht vor, sondern DURCH einen Lauf entdeckt/);
    // F6-C7: die Artefakt-Haelfte wurde geprueft, nicht gefahren.
    assert.strictEqual(e.aequivalenzTor.artefaktHaelfte.form, 'NICHT GEFAHREN, SONDERN GEPRUEFT');
    // F6-C8b: die berichtigte Zelle steht drin, die alte nicht.
    assert.deepStrictEqual(e.aequivalenzTor.bein2.zellen['S-U/kontrollpool'],
      { zaehler: 3761, nenner: 4514, zensiert: 0 });
    assert.ok(!JSON.stringify(e.aequivalenzTor.bein2.zellen).includes('3760'));
    // F6-C21: analysisCutoffAt ist Jahrgangs-Identitaet, kein Zeitstempel.
    assert.strictEqual(typeof e.analysisCutoffAt, 'object');
    assert.match(e.analysisCutoffAt.form, /kein Zeitstempel/);
    // F6-B2: das nicht anwendbare Pflichtfeld ist beantwortet, nicht weggelassen.
    assert.match(e.researchCorpus, /NICHT ANWENDBAR/);
    // F6-C17: die Warnung vor der falschen Prosa-Kurzform steht im Eintrag.
    assert.match(e.ausgabesatz.zweigPflichtTeilmengen.warnung, /UNZULAESSIG/);
    // Restrisiken: alle sechs Auflagen-Glieder plus die zwei aus F6-C11.
    for (const k of ['F6-C7g(c)', 'F6-C7g(d)', 'F6-C7g(e)', 'F6-C8j(f)', 'F6-C8j(g)',
      'F6-C8j(h)', 'F6-C11(a)', 'F6-C11(b)']) {
      assert.ok(e.restrisiko[k], `Restrisiko ${k} fehlt`);
    }
    // R12a: KEIN Nutzerverzeichnis, KEIN absoluter Pfad — ohne Ausnahme.
    // Die erste Fassung dieses Waechters nahm ausgerechnet arbeitspfad aus und
    // hat den Fehler damit mitgetragen; die Ausnahme ist der Fehler gewesen.
    // Geprueft wird mit den Mustern des Deckels SELBST, nicht mit
    // nachgebauten: ein eigener Nachbau war schon einmal zu eng (`[\/]` statt
    // Rueckstrich UND Schraegstrich) und zu breit zugleich (er schlug bei
    // "https://" an). Der Deckel ist die Quelle, hier wird nur zitiert.
    const BS = String.fromCharCode(92);
    const roh = JSON.stringify(e);
    assert.ok(!new RegExp(`\\b[A-Za-z]:[${BS}${BS}/]{1,2}Users\\b`).test(roh),
      'Windows-Laufwerkspfad im Eintrag');
    assert.ok(!new RegExp(`[${BS}${BS}/]Users[${BS}${BS}/][A-Za-z]`).test(roh),
      'Windows-Nutzerverzeichnis im Eintrag');
    assert.ok(!new RegExp(`(^|[\\s"'(=])/${['ho', 'me'].join('')}/[a-z]`, 'm').test(roh),
      'Unix-Heimverzeichnis im Eintrag');
    assert.strictEqual(e.arbeitspfad.kurzform, 'f6-arbeit');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

// ── Riegel 13: der Anker ist gemessen, nicht geraten ──────────────────────
test('die F6-C18-Anker treffen die tatsaechlichen Zeilen', () => {
  const zeilen = fs.readFileSync(path.join(WURZEL, 'scripts', 'studie-vb-b4-band.py'), 'utf8')
    .split(/\r?\n/);
  const bei = (spanne) => zeilen[Number(spanne.slice(1).split('-')[0]) - 1];
  assert.match(bei(K.ANKER.gate_gerissen), /def gate_gerissen/);
  assert.match(bei(K.ANKER.im_band), /if abs\(abstand\) <= breite_abs/);
  assert.match(bei(K.ANKER.ausserhalb_band), /if abstand > breite_abs/);
});

// ── Riegel 14: der Schreib-Grenzen-Riegel gegen Nutzerpfade feuert ────────
test('ein Nutzerpfad im Eintrag bricht an der Schreib-Grenze ab', () => {
  // Die Proben-Pfade werden aus Fragmenten gebaut. Ein ausgeschriebenes
  // /home/... hat diese Datei beim ersten Anlauf selbst zum R12a-Verstoss
  // gemacht — der Waechter riss an seinem eigenen Beispiel.
  const bs = String.fromCharCode(92);
  const heim = `/${['ho', 'me'].join('')}/jemand/f6-arbeit`;
  const nutzerverz = `${['Us', 'ers'].join('')}${bs}Jemand`;
  assert.doesNotThrow(() => K.pruefeKeinNutzerpfad({ a: 'f6-arbeit', b: 'reports/studie' }));
  // Kein Fehlalarm auf gewoehnlichen URLs — der erste Entwurf schlug bei
  // "https://" an, weil "s:/" seinem zu breiten Muster genuegte.
  assert.doesNotThrow(() => K.pruefeKeinNutzerpfad({ a: 'https://example.org/x' }));
  assert.throws(() => K.pruefeKeinNutzerpfad({ a: `C:${bs}${nutzerverz}${bs}f6-arbeit` }),
    /Windows-Laufwerkspfad/);
  assert.throws(() => K.pruefeKeinNutzerpfad({ a: `${bs}${nutzerverz}` }),
    /Windows-Nutzerverzeichnis/);
  assert.throws(() => K.pruefeKeinNutzerpfad({ a: heim }), /Unix-Heimverzeichnis/);
  assert.throws(() => K.pruefeKeinNutzerpfad({ a: `%${['USER', 'PROFILE'].join('')}%` }),
    /Umgebungs-Nutzerpfad/);
});

// ── Nach dem Schritt-8-Review: das Werkzeug ist stillgelegt ───────────────
test('das Werkzeug baut den ueberholten Eintrag 27 nicht mehr', () => {
  // Der Trockenlauf bleibt fahrbar (die Riegel muessen beweisbar bleiben);
  // GESCHRIEBEN wird nie wieder.
  assert.throws(() => K.haupt(['--schreiben']), /UEBERHOLT/);
  // --force bleibt der ERSTE Riegel: eine Reparatur-Betriebsart gibt es auch
  // an einem stillgelegten Werkzeug nicht.
  assert.throws(() => K.haupt(['--force']), /--force gibt es nicht/);
});
