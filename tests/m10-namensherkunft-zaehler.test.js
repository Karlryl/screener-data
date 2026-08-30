'use strict';
/**
 * M10 / M1 + M2 + M5 — Waechter fuer den persistierten Herkunfts-Zaehler.
 * Urteil: `agent-reports/_COURT-M10-2026-08-30.md`, Auflagen M1 (Frist 20.09.2026), M2, M5.
 *
 * WAS HIER BEWACHT WIRD, und warum jedes Stueck:
 *  (1) DIE BUCKET-ARITHMETIK. `fehlt + Summe(nameSource-Buckets) === gelesene Zeilen`. Der
 *      Bucket `fehlt` ist nicht Kosmetik, sondern die ganze Auflage: ohne ihn wird der
 *      wachsende Deckungsgrad als schrumpfende Fehlerklasse fehlgelesen (Urteil §6). Faellt
 *      ein Bucket weg, misst die Reihe still etwas anderes als sie behauptet.
 *  (2) ANWESENHEIT UND ABWESENHEIT. Eine Zeile MIT `nameSource` landet in ihrer Sprosse, eine
 *      Zeile OHNE den Schluessel in `fehlt`, eine Zeile mit `nameSource: null` in `null` —
 *      "Schluessel fehlt" und "keine Sprosse hat geliefert" sind zwei Weltzustaende.
 *  (3) ANHAENGEN STATT UEBERSCHREIBEN. Die Reihe IST die Auflage; eine Datei mit nur dem
 *      letzten Tag misst genau das, was ohne sie auch schon sichtbar waere.
 *  (4) M2 — KEIN KONSUMENT. Quelltext-Scan, und das ist hier zulaessig: die geschuetzte
 *      Eigenschaft ist selbst eine Quelltext-Eigenschaft (die ABWESENHEIT einer Referenz).
 *      `src/scoring/**` muss NULL Treffer haben; ein Konsument dort laesst die Ratifikation
 *      von G3-a erloeschen (Urteil §8).
 *  (5) M5 — das Interims-Protokoll zaehlt je Herkunft des QUELL-Beins und listet die
 *      watchlist-Faelle namentlich.
 *
 * Jede Wache hat ihre BRUCHPROBE im selben Block: eine kaputte Variante wird gebaut und muss
 * rot werden. Ohne sie ist nicht gezeigt, dass die Wache ueberhaupt greifen kann.
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Run: node tests/m10-namensherkunft-zaehler.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  namensherkunftBucket, namensherkunftZaehlen, namensherkunftLesen, namensherkunftSchreiben,
  umbenennungsProtokoll, NAMENSHERKUNFT_BUCKETS, wendeWurzelZwillingeAn, namensherkunftStandardpfad,
} = require('../scripts/filter-snapshot-merge.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const REPO = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'm10-zaehler-'));

/** Ein minimaler, aber ECHTER Snapshot: `meta.name` traegt die Gruppierung, `marketCap.value`
 *  den Sieger-Tie-Break. Beides sind genau die Felder, die die importierten Produktions-
 *  Funktionen lesen — ein Fixture ohne sie wuerde am Nachbau messen, nicht an der Sache. */
function snap(name, opts = {}) {
  const meta = { ticker: opts.ticker || 'X', name };
  if ('nameSource' in opts) meta.nameSource = opts.nameSource;
  if (opts.country) meta.country = opts.country;
  return { meta, marketCap: { value: opts.mcap || 1e9 } };
}

// ─── 1. Die sechs Buckets, Anwesenheit UND Abwesenheit ──────────────────────────────────

test('M1: die sechs Pflicht-Buckets stehen fest und heissen wie das Urteil sie nennt', () => {
  assert.deepEqual(NAMENSHERKUNFT_BUCKETS, ['longName', 'shortName', 'watchlist', 'ticker', 'null', 'fehlt']);
  assert.equal(NAMENSHERKUNFT_BUCKETS.length, 6, 'sechs Zaehlgroessen — Beweis 1 der Auflage M1');
});

test('ANWESENHEIT: jede gelieferte Sprosse landet in ihrem eigenen Bucket', () => {
  for (const q of ['longName', 'shortName', 'watchlist', 'ticker']) {
    assert.equal(namensherkunftBucket({ name: 'A', nameSource: q }), q);
  }
});

test('ABWESENHEIT: fehlender Schluessel ist FEHLT, gelieferte Leere ist NULL — nie dasselbe', () => {
  // Der teuerste denkbare Fehler dieser Messung: beide Lagen in einen Topf. `fehlt` heisst
  // "seit PR #136 nicht neu gezogen", `null` heisst "gezogen, aber keine Sprosse lieferte".
  assert.equal(namensherkunftBucket({ name: 'A' }), 'fehlt');
  assert.equal(namensherkunftBucket({}), 'fehlt');
  assert.equal(namensherkunftBucket(null), 'fehlt');
  assert.equal(namensherkunftBucket({ name: 'A', nameSource: null }), 'null');
  assert.notEqual(namensherkunftBucket({ name: 'A' }), namensherkunftBucket({ name: 'A', nameSource: null }));
});

test('eine UNBEKANNTE Sprosse verschwindet nicht in einer Sammelgroesse', () => {
  // Eine neue Sprosse in pull-yahoo.js soll hier auffallen. Faende sie sich still in `fehlt`
  // wieder, waere die Reihe ab diesem Tag falsch, ohne dass irgendwo etwas rot wird.
  assert.equal(namensherkunftBucket({ name: 'A', nameSource: 'isin' }), 'unbekannt:isin');
});

// ─── 2. Die Arithmetik und ihre Bruchprobe ──────────────────────────────────────────────

test('M1-Beweis 2: Summe aller Buckets === gelesene Zeilen', () => {
  const zeilen = [
    { ticker: 'A', bucket: 'longName', snapshot: snap('Alpha AG') },
    { ticker: 'B', bucket: 'watchlist', snapshot: snap('Beta SA') },
    { ticker: 'C', bucket: 'fehlt', snapshot: snap('Gamma Inc') },
    { ticker: 'D', bucket: 'null', snapshot: snap('Delta Ltd') },
  ];
  const z = namensherkunftZaehlen(zeilen);
  assert.equal(z.gelesen, 4);
  assert.equal(Object.values(z.verteilung).reduce((a, b) => a + b, 0), z.gelesen);
  assert.equal(z.verteilung.fehlt, 1);
  assert.equal(z.verteilung.watchlist, 1);
  assert.equal(z.verteilung.shortName, 0, 'ein leerer Bucket steht als 0 da, nicht gar nicht');
});

test('BRUCHPROBE: faellt ein Bucket aus der Zaehlung, reisst die Invariante', () => {
  // Genau der Vorgang, den Beweis 3 der Auflage verlangt: einen Bucket entfernen -> rot.
  const zeilen = [
    { ticker: 'A', bucket: 'longName', snapshot: snap('Alpha AG') },
    { ticker: 'C', bucket: 'fehlt', snapshot: snap('Gamma Inc') },
  ];
  const z = namensherkunftZaehlen(zeilen);
  const verstuemmelt = { ...z.verteilung };
  delete verstuemmelt.fehlt;                       // der Bucket, der die ganze Auflage traegt
  assert.throws(() => {
    assert.equal(Object.values(verstuemmelt).reduce((a, b) => a + b, 0), z.gelesen,
      'Bucket-Arithmetik');
  }, 'ohne den Bucket `fehlt` MUSS die Invariante rot werden');
});

// ─── 3. Mehrbein-Gruppen und der Sieger ─────────────────────────────────────────────────

test('M1: ein watchlist-benannter Sieger wird gezaehlt, samt der unterdrueckten Beine', () => {
  // Zwei Beine EINER Emittentengruppe (gleicher issuerKeyLoose ueber den Namen). Der Sieger
  // faellt ueber die groessere marketCap — der Name entscheidet die ZUGEHOERIGKEIT, nie den
  // SIEG (Urteil §3 K-3). Genau deshalb misst diese Zahl eine Korrelation, keinen Hebel.
  const zeilen = [
    { ticker: 'AAA', bucket: 'watchlist', snapshot: snap('Acme Holding SA', { nameSource: 'watchlist', mcap: 9e9 }) },
    { ticker: 'BBB', bucket: 'longName', snapshot: snap('Acme Holding S.A.', { nameSource: 'longName', mcap: 1e9 }) },
    { ticker: 'CCC', bucket: 'longName', snapshot: snap('Ganz Andere AG', { nameSource: 'longName', mcap: 5e9 }) },
  ];
  const z = namensherkunftZaehlen(zeilen);
  assert.equal(z.mehrbeinGruppen, 1, 'AAA und BBB fallen auf denselben Emittenten-Schluessel');
  assert.equal(z.watchlistSieger, 1);
  assert.equal(z.unterdrueckteBeine, 1);
});

test('ABWESENHEIT: gewinnt das feed-benannte Bein, zaehlt nichts', () => {
  // Zweite Richtung. Ohne sie waere die Wache oben mit einem Zaehler gruen, der JEDE
  // mehrbeinige Gruppe meldet.
  const zeilen = [
    { ticker: 'AAA', bucket: 'watchlist', snapshot: snap('Acme Holding SA', { nameSource: 'watchlist', mcap: 1e9 }) },
    { ticker: 'BBB', bucket: 'longName', snapshot: snap('Acme Holding S.A.', { nameSource: 'longName', mcap: 9e9 }) },
  ];
  const z = namensherkunftZaehlen(zeilen);
  assert.equal(z.mehrbeinGruppen, 1);
  assert.equal(z.watchlistSieger, 0);
  assert.equal(z.unterdrueckteBeine, 0);
});

// ─── 4. Lesen und Schreiben: anhaengen, nie ueberschreiben ──────────────────────────────

test('namensherkunftLesen liest den Bestand und zaehlt Unlesbares getrennt', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'AAA.json'), JSON.stringify({ meta: { name: 'Alpha', nameSource: 'longName' } }));
  fs.writeFileSync(path.join(dir, 'BBB.json'), JSON.stringify({ meta: { name: 'Beta' } }));
  fs.writeFileSync(path.join(dir, 'CCC.json'), '{ kaputt');
  fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify({ n: 1 }));
  const { zeilen, unlesbar } = namensherkunftLesen(dir);
  assert.equal(zeilen.length, 2, 'Metadaten-Datei zaehlt nicht als Zeile');
  assert.equal(unlesbar, 1, 'eine kaputte Datei wird gezaehlt, nicht verschluckt');
  assert.deepEqual(zeilen.map((z) => z.bucket).sort(), ['fehlt', 'longName']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('M1-Beweis 4: der zweite Lauf HAENGT AN, er ueberschreibt nicht', () => {
  const dir = tmp();
  const p = path.join(dir, 'h.json');
  const n1 = namensherkunftSchreiben(p, '2026-09-01', { gelesen: 1 });
  const n2 = namensherkunftSchreiben(p, '2026-09-02', { gelesen: 2 });
  assert.equal(n1, 1);
  assert.equal(n2, 2);
  const roh = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepEqual(Object.keys(roh.byDate).sort(), ['2026-09-01', '2026-09-02']);
  assert.equal(roh.byDate['2026-09-01'].gelesen, 1, 'der erste Tag steht unveraendert da');
  assert.ok(/REINE MESSUNG/.test(roh._doc), 'die Datei sagt selbst, dass sie kein Gate ist');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('die Reihe liegt beim gemessenen BESTAND, nicht fest im Repo', () => {
  // Reproduziert (vor dem Fix): der Standardpfad zeigte fest auf `<repo>/data-health/`. Vier
  // Waechter fahren dieses Skript mit einem Temp-Ziel — jeder Testlauf schrieb damit eine
  // Tageszeile aus einer FIXTURE-Population in die echte Messreihe. Eine Reihe, die ihre
  // eigenen Testlaeufe mitzaehlt, ist als Beweis wertlos.
  const ausTemp = namensherkunftStandardpfad(path.join(os.tmpdir(), 'irgendwo', 'ziel'));
  assert.equal(path.basename(ausTemp), 'namensherkunft-history.json');
  assert.equal(path.basename(path.dirname(ausTemp)), 'data-health');
  assert.ok(!path.resolve(ausTemp).startsWith(path.resolve(REPO)),
    `ein Temp-Ziel darf NIE ins Repo schreiben, war aber ${ausTemp}`);
  // Gegenrichtung: das echte Tageslauf-Ziel landet sehr wohl im Repo, sonst faehrt die Datei
  // im `git add -A` des merge-Jobs nicht mit und die Auflage waere unerfuellt.
  assert.equal(path.resolve(namensherkunftStandardpfad(path.join(REPO, 'snapshots'))),
    path.resolve(REPO, 'data-health', 'namensherkunft-history.json'));
});

test('BRUCHPROBE: eine KAPUTTE Bestandsreihe wird NICHT ueberschrieben, sondern gemeldet', () => {
  // Die Datei ist der einzige Ort, an dem der Verlauf liegt. "Dann fange ich eben neu an"
  // haette genau den Beweis vernichtet, den diese Auflage retten soll.
  const dir = tmp();
  const p = path.join(dir, 'h.json');
  fs.writeFileSync(p, '{ das ist kein json');
  assert.throws(() => namensherkunftSchreiben(p, '2026-09-03', { gelesen: 1 }), /NICHT ueberschrieben/);
  assert.equal(fs.readFileSync(p, 'utf8'), '{ das ist kein json', 'die Bytes liegen unveraendert da');
  // Gegenprobe: die FEHLENDE Datei ist der legitime Erstanlage-Fall und wirft nicht.
  const q = path.join(dir, 'neu.json');
  assert.equal(namensherkunftSchreiben(q, '2026-09-03', { gelesen: 1 }), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── 5. M5 — das Interims-Protokoll ─────────────────────────────────────────────────────

test('M5: die Umbenennungen werden je Herkunft des QUELL-Beins gezaehlt', () => {
  const p = umbenennungsProtokoll([
    { kanal: 'U2-Wurzelzwillinge', verlierer: 'KRN.NS', sieger: 'KRN.BO', quelleHerkunft: 'longName' },
    { kanal: 'U3-Milan', verlierer: 'GEN', sieger: '1NLOK.MI', quelleHerkunft: 'watchlist' },
    { kanal: 'U3-Milan', verlierer: '472.DE', sieger: '1CLNX.MI', quelleHerkunft: undefined },
  ]);
  assert.equal(p.gesamt, 3);
  assert.deepEqual(p.jeHerkunft, { longName: 1, watchlist: 1, fehlt: 1 });
  assert.deepEqual(p.watchlistFaelle, ['GEN<-1NLOK.MI'], 'die watchlist-Faelle stehen NAMENTLICH da');
});

test('ABWESENHEIT: ohne watchlist-Fall bleibt die Liste leer statt zu fehlen', () => {
  const p = umbenennungsProtokoll([{ verlierer: 'A', sieger: 'B', quelleHerkunft: 'shortName' }]);
  assert.deepEqual(p.watchlistFaelle, []);
  assert.equal(p.gesamt, 1);
});

test('M5-VERDRAHTUNG: die echte U2-Stufe liefert die Herkunft des SIEGER-Beins mit', () => {
  // Ohne diese Wache war die Zaehlfunktion oben gepinnt, die LEITUNG dorthin aber nicht: ein
  // `quelleHerkunft: undefined` an der Aufrufstelle waere durch alle Tests gruen durchgelaufen
  // und haette das Protokoll dauerhaft auf "fehlt" gestellt. Gemessen an der echten Stufe.
  const dir = tmp();
  const schreib = (t, o) => fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(o));
  schreib('KRN.BO', { meta: { ticker: 'KRN.BO', name: 'KRN Heat Exchanger and Refrigeration Limited', nameSource: 'watchlist' } });
  schreib('KRN.NS', { meta: { ticker: 'KRN.NS', name: 'KRN HEAT EXCHANGE N REF L', nameSource: 'longName' } });
  const r = wendeWurzelZwillingeAn(dir, ['KRN.BO.json', 'KRN.NS.json']);
  assert.deepEqual(r.geheilt, ['KRN.NS'], 'Vorbedingung: das kuerzer benannte Bein wird umbenannt');
  assert.equal(r.protokoll.length, 1);
  assert.equal(r.protokoll[0].sieger, 'KRN.BO');
  assert.equal(r.protokoll[0].verlierer, 'KRN.NS');
  assert.equal(r.protokoll[0].quelleHerkunft, 'watchlist',
    'die Herkunft des Beins, dessen Name aufgepraegt wird — nicht die des Verlierers');
  assert.deepEqual(umbenennungsProtokoll(r.protokoll).watchlistFaelle, ['KRN.NS<-KRN.BO']);

  // ABWESENHEIT: traegt der Sieger einen Feed-Namen, taucht kein watchlist-Fall auf — und die
  // Umbenennung findet trotzdem statt (das Protokoll aendert NICHTS, Auflage M5).
  schreib('KRN.BO', { meta: { ticker: 'KRN.BO', name: 'KRN Heat Exchanger and Refrigeration Limited', nameSource: 'longName' } });
  schreib('KRN.NS', { meta: { ticker: 'KRN.NS', name: 'KRN HEAT EXCHANGE N REF L', nameSource: 'longName' } });
  const r2 = wendeWurzelZwillingeAn(dir, ['KRN.BO.json', 'KRN.NS.json']);
  assert.deepEqual(r2.geheilt, ['KRN.NS'], 'die Umbenennung passiert unveraendert');
  assert.equal(r2.protokoll[0].quelleHerkunft, 'longName');
  assert.deepEqual(umbenennungsProtokoll(r2.protokoll).watchlistFaelle, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── 6. M2 — KEIN KONSUMENT von nameSource ──────────────────────────────────────────────

/** Quelltext-Scan ueber die Verzeichnisse, in denen Produktionscode lebt. Bewusst KEIN
 *  `git grep`: der Waechter soll auch in einem Baum ohne git-Binary laufen. */
function dateienMitReferenz(wurzel, muster) {
  const treffer = [];
  const ausgenommen = new Set(['node_modules', '.git', 'snapshots', 'snapshots-eingang', 'board-history',
    'picks-history', 'methods-history', 'prices', 'external-data', 'newcomer-log', 'archive', 'agent-reports']);
  const lauf = (dir) => {
    let eintraege;
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of eintraege) {
      if (ausgenommen.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { lauf(p); continue; }
      if (!/\.(js|mjs|cjs|yml|yaml)$/.test(e.name)) continue;
      let inhalt;
      try { inhalt = fs.readFileSync(p, 'utf8'); } catch (err) { continue; }
      if (muster.test(inhalt)) treffer.push(path.relative(REPO, p).replace(/\\/g, '/'));
    }
  };
  lauf(wurzel);
  return treffer.sort();
}

test('M2: `src/scoring/**` kennt `nameSource` NICHT — ein Treffer dort loescht die Ratifikation', () => {
  const treffer = dateienMitReferenz(path.join(REPO, 'src'), /nameSource/);
  assert.deepEqual(treffer, [], `kein Konsument in src/ erlaubt, gefunden: ${treffer.join(', ')}`);
});

test('M2: die Referenzen stehen ausschliesslich beim SCHREIBER und bei der MESSUNG', () => {
  // Erlaubt sind genau drei Rollen: der Schreiber (pull-yahoo.js), die MESSUNG
  // (filter-snapshot-merge.js: M1-Zaehler, M5-Protokoll und die M9-Meldeform des Tripwires)
  // und die Waechter. Alles andere ist ein Konsument und gehoert vor das Gericht zurueck
  // (Urteil §8, Kipp-Bedingung G3-a).
  //
  // WARUM DER TRIPWIRE MITZAEHLT, ohne die Auflage zu dehnen: M2 verbietet Gruppierung,
  // Sieger-Wahl, Umbenennung, Filterung und Score. Der Tripwire tut nichts davon — er
  // schreibt eine Zeile in einen Bericht. Und M9 ORDNET das Feld dort ausdruecklich an
  // („die Herkunft beider Namen (nameSource)"). Die beiden Auflagen widersprechen sich
  // nicht; M2 schuetzt vor STEUERUNG, nicht vor Messung.
  const erlaubt = new Set([
    'pull-yahoo.js',
    'scripts/filter-snapshot-merge.js',
    'tests/m10-namensherkunft.test.js',
    'tests/m10-namensherkunft-zaehler.test.js',
    'tests/m10-tripwire.test.js',
  ]);
  const gefunden = [
    ...dateienMitReferenz(path.join(REPO, 'scripts'), /nameSource/),
    ...dateienMitReferenz(path.join(REPO, 'lib'), /nameSource/),
    ...dateienMitReferenz(path.join(REPO, 'tests'), /nameSource/),
    ...dateienMitReferenz(path.join(REPO, '.github'), /nameSource/),
    ...(/nameSource/.test(fs.readFileSync(path.join(REPO, 'pull-yahoo.js'), 'utf8')) ? ['pull-yahoo.js'] : []),
  ];
  const fremd = gefunden.filter((f) => !erlaubt.has(f));
  assert.deepEqual(fremd, [], `unerlaubte Referenz(en) auf nameSource: ${fremd.join(', ')}`);
  assert.ok(gefunden.includes('pull-yahoo.js'), 'Vorbedingung: der Schreiber existiert ueberhaupt');
  assert.ok(gefunden.includes('scripts/filter-snapshot-merge.js'), 'Vorbedingung: die Messung existiert');
});

test('BRUCHPROBE: ein untergeschobener Konsument wird vom Scanner GEFUNDEN', () => {
  // Ohne diese Probe pruefte der Scan oben nur, dass er nichts findet — auch dann, wenn er
  // strukturell gar nichts finden KANN (falsches Verzeichnis, falsche Endung, toter Filter).
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'scoring'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scoring', 'boese.js'), 'if (s.meta.nameSource === "watchlist") return null;\n');
  fs.writeFileSync(path.join(dir, 'scoring', 'harmlos.js'), 'const x = 1;\n');
  const treffer = dateienMitReferenz(dir, /nameSource/);
  assert.equal(treffer.length, 1, 'der Scanner MUSS den untergeschobenen Konsumenten sehen');
  assert.ok(treffer[0].endsWith('boese.js'));
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\nm10-namensherkunft-zaehler.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
