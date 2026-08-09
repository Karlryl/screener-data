// P0-Haertung 4 (09.08.2026) — die vier im Batch-Sweep neu bestaetigten offenen P0.
// Gemeinsamer Nenner: ein Lauf verliert BESTAND und meldet Erfolg.
//
//   AD-SK-001  scripts/pull-13f-institutional.js  Merge-Key kollabiert Mehrfachzeilen
//   R1-SK-012  refresh-universe.js                ADR-Drop trotz gekappter Heimatzeile
//   AX-SK-002  scripts/build-secannual-smallcap.js korrupter Store = leere Merge-Basis
//   R1-SK-005  build-smallcap-universe.js         Universum ohne Mindestzahl ueberschrieben
//
// Kein Netz, keine Frameworks. Die beiden Builder-Faelle laufen am ECHTEN Einstiegspunkt
// (run()/main()), nicht nur am Leser — genau dort ist die Bugklasse rueckfaellig.
// Run: node tests/p0-haertung4-sweep-13f-adr-smallcap.test.js   (Exit 0/1)
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const { _mergeAmendmentOntoBase } = require('../scripts/pull-13f-institutional.js')._internals;
const { repariereAdrBestand } = require('../refresh-universe.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}

// ── AD-SK-001: 13F-Merge darf keine Mehrfachzeile schlucken ──────────────────────────
// Ein 13F-Info-Table listet dieselbe CUSIP regulaer MEHRFACH (investmentDiscretion
// SOLE/DEFINED/OTHER bzw. mehrere Manager). Der Merge-Schluessel kennt nur
// cusip|titleOfClass|putCall — mit `map.set(key, pos)` ueberlebt je Schluessel nur die
// LETZTE Zeile, und zwar schon innerhalb des BASIS-Buchs, das gar nicht amendiert wurde.
// buildByTickerView summiert spaeter ueber entry.positions -> die Stueckzahl des Halters
// faellt still zu niedrig aus.
const zeile = (cusip, shares, disc) => ({
  nameOfIssuer: 'ACME CORP', titleOfClass: 'COM', cusip, value: shares,
  sshPrnamt: shares, sshPrnamtType: 'SH', putCall: null, investmentDiscretion: disc,
});
const summe = (rows) => rows.reduce((a, r) => a + r.sshPrnamt, 0);

test('AD-SK-001 Basis-Buch: drei Discretion-Zeilen derselben CUSIP bleiben drei Zeilen', () => {
  const base = [zeile('111111111', 100, 'SOLE'), zeile('111111111', 30, 'DEFINED'),
    zeile('111111111', 5, 'OTHER'), zeile('222222222', 7, 'SOLE')];
  const merged = _mergeAmendmentOntoBase(base, []);
  assert.equal(merged.length, 4,
    'Mehrfachzeilen derselben CUSIP wurden auf eine kollabiert — der Bestand des Halters schrumpft still');
  assert.equal(summe(merged.filter(p => p.cusip === '111111111')), 135,
    'die aufsummierte Stueckzahl muss 100+30+5 sein, nicht die letzte Zeile allein');
});

test('AD-SK-001 Amendment ersetzt die ganze Gruppe seines Schluessels, nicht nur eine Zeile', () => {
  const base = [zeile('111111111', 100, 'SOLE'), zeile('111111111', 30, 'DEFINED'),
    zeile('222222222', 7, 'SOLE')];
  const amend = [zeile('111111111', 60, 'SOLE'), zeile('111111111', 20, 'DEFINED')];
  const merged = _mergeAmendmentOntoBase(base, amend);
  assert.equal(summe(merged.filter(p => p.cusip === '111111111')), 80,
    'die amendierte CUSIP muss GENAU das Amendment zeigen (60+20) — weder Basis-Reste dazu noch nur eine Zeile');
  assert.equal(merged.filter(p => p.cusip === '222222222').length, 1,
    'nicht amendierte Zeilen bleiben unberuehrt');
});

test('AD-SK-001 unamendierte Zeilen behalten ihre Reihenfolge', () => {
  const base = [zeile('111111111', 1, 'SOLE'), zeile('222222222', 2, 'SOLE'), zeile('333333333', 3, 'SOLE')];
  const merged = _mergeAmendmentOntoBase(base, [zeile('222222222', 9, 'SOLE')]);
  assert.deepEqual(merged.map(p => p.cusip), ['111111111', '222222222', '333333333']);
});

// ── R1-SK-012: ADR-Drop nur gegen eine ECHTE Watchlist-Zeile ─────────────────────────
// Der Persistenz-Cap (capNewTickerAdmission) kappt NUR newTickers; die Kandidaten-Map
// allTickers bleibt ungekappt. Die alte Praesenz-Pruefung fragte aber genau diese Map —
// eine vom Cap verworfene Heimatzeile galt damit als "present", die ADR-Zeile flog raus,
// die Heimat kam nie rein: die Firma verschwindet still aus dem Universum.
const adrZeile = (t) => ({ ticker: t, yahoo_symbol: t, name: t + ' Inc', sector_hint: '', exchange_hint: '', added_via: 'test' });

test('R1-SK-012 Heimat nur Kandidat (vom Cap verworfen) -> ADR-Zeile bleibt', () => {
  const stocks = [adrZeile('BABA'), adrZeile('AAPL')];
  const allTickers = new Map([['9988.HK', { ticker: '9988.HK' }]]); // Kandidat, aber NICHT admittiert
  const r = repariereAdrBestand(stocks, { BABA: '9988.HK' }, allTickers, new Set());
  assert.equal(r.dropped, 0,
    'ADR entfernt, obwohl die Heimatzeile gar nicht in der Watchlist steht — die Firma faellt aus dem Universum');
  assert.ok(r.stocks.some(s => s.ticker === 'BABA'), 'BABA muss erhalten bleiben');
});

test('R1-SK-012 Heimat nur in `existing`, aber ohne Zeile -> ADR-Zeile bleibt', () => {
  // existing ist der Ticker-Set des ALTEN Watchlist-Stands. Fehlt die Zeile im aktuellen
  // wlRaw (z. B. vom Class-Share-Repair umbenannt oder ausgetragen), ist die Heimat weg.
  const stocks = [adrZeile('BABA')];
  const r = repariereAdrBestand(stocks, { BABA: '9988.HK' }, new Map(), new Set(['9988.HK']));
  assert.equal(r.dropped, 0, 'Praesenz darf nur an einer echten Zeile haengen, nicht am Alt-Set');
});

test('R1-SK-012 Heimatzeile wirklich da -> ADR faellt weg und Metadaten werden gerettet', () => {
  const heimat = { ticker: '9988.HK', yahoo_symbol: '9988.HK', name: '', sector_hint: '', exchange_hint: 'HKG' };
  const stocks = [adrZeile('BABA'), heimat];
  stocks[0].sector_hint = 'Consumer Discretionary';
  const r = repariereAdrBestand(stocks, { BABA: '9988.HK' }, new Map(), new Set());
  assert.equal(r.dropped, 1, 'bei vorhandener Heimatzeile MUSS die ADR-Dublette weg — sonst ist der Repair wirkungslos');
  assert.deepEqual(r.stocks.map(s => s.ticker), ['9988.HK']);
  assert.equal(heimat.name, 'BABA Inc', 'Metadaten der ADR-Zeile werden auf die Heimatzeile backfilled');
  assert.equal(heimat.sector_hint, 'Consumer Discretionary');
});

// ── AX-SK-002 / R1-SK-005: die beiden Builder am echten Einstiegspunkt ───────────────
// Wie in tests/p0-haertung3: korrupter Inhalt wird dem echten Leser am echten Repo-Pfad
// per fs-Klammer untergeschoben (statt die 474-KB-Datei auf Platte zu beschaedigen), und
// jeder Schreibversuch auf den Zielpfad wird zusaetzlich geblockt.
const KORRUPT = '{"AAPL":{"cik":"000';

// leseErsatz === null: nur Schreibsperre (fuer Faelle, in denen der ECHTE Inhalt gelesen
// werden soll, der Testlauf die Produktivdatei aber unter keinen Umstaenden anfassen darf —
// ein Mutant ohne Guard wuerde sie sonst wirklich ueberschreiben; genau das ist beim
// Rot-Lauf dieses Tests passiert und musste per git checkout geheilt werden).
async function mitKlammer(zielPfad, fn, leseErsatz) {
  const echt = {
    readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync, openSync: fs.openSync,
  };
  const schreibVersuche = [];
  // Prefix-Vergleich, nicht Gleichheit: writeFileAtomic schreibt erst nach
  // "<ziel>.tmp.<pid>.<n>" und benennt dann um — beide Wege gehoeren geblockt.
  const trifft = (p) => String(p).startsWith(zielPfad);
  const blocken = (p) => { schreibVersuche.push(String(p)); throw new Error('TEST: Schreibversuch auf ' + p + ' geblockt'); };
  if (leseErsatz != null) fs.readFileSync = (p, ...r) => (trifft(p) ? leseErsatz : echt.readFileSync(p, ...r));
  fs.writeFileSync = (p, ...r) => (trifft(p) ? blocken(p) : echt.writeFileSync(p, ...r));
  fs.openSync = (p, ...r) => (trifft(p) ? blocken(p) : echt.openSync(p, ...r));
  fs.renameSync = (a, b) => (trifft(b) ? blocken(b) : echt.renameSync(a, b));
  let fehler = null;
  try { await fn(); } catch (e) { fehler = e; }
  finally { Object.assign(fs, echt); }
  return { fehler, schreibVersuche };
}
const mitKorrupterDatei = (zielPfad, fn) => mitKlammer(zielPfad, fn, KORRUPT);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p0h4-'));

async function builderTests() {
  await atest('AX-SK-002 E2E: korrupter Smallcap-Store faellt durch build-secannual-smallcap run() durch', async () => {
    const ziel = path.join(REPO, 'external-data', 'sec-secannual-smallcap.json');
    const { run } = require('../scripts/build-secannual-smallcap.js');
    const { fehler, schreibVersuche } = await mitKorrupterDatei(ziel, () => run());
    assert.deepEqual(schreibVersuche, [],
      'AX-SK-002: der Store wurde ueberschrieben, obwohl er unlesbar war — genau der Datenverlust');
    assert.ok(fehler, 'AX-SK-002: run() ist NICHT gefallen — der Lauf geht mit Exit 0 ueber einer korrupten Pflichtdatei raus');
    assert.match(String(fehler.message), /unlesbar/,
      'AX-SK-002: gefallen, aber aus einem anderen Grund (' + fehler.message + ') — die Probe belegt dann nichts');
    assert.ok(String(fehler.message).includes(ziel), 'AX-SK-002: die Meldung nennt die Datei nicht');
  });

  // R1-SK-005: der Smallcap-Universums-Builder schrieb watchlist-smallcap.json
  // BEDINGUNGSLOS. Ein rate-limitierter prefilterByMcap-Lauf liefert eine Handvoll Namen
  // statt ~540 — der committete Kontrakt wurde still durch die Schrumpfliste ersetzt und
  // der Log meldete die kleine Zahl als Erfolg.
  // Die Stubs MUESSEN vor dem require des Builders sitzen: der destrukturiert seine
  // Discovery-Funktionen beim Laden, spaeteres Patchen der Modul-Exporte greift nicht mehr
  // (erster Anlauf dieses Tests hat genau deshalb den echten NASDAQ-/Yahoo-Pfad gefahren).
  const nasdaq = require('../discovery/nasdaq-all.js');
  const prefilter = require('../discovery/mcap-prefilter.js');
  const symbole = Array.from({ length: 2000 }, (_, i) => 'T' + i);
  let stubTreffer = 0;
  nasdaq.fetchNasdaqAll = async () => new Map(symbole.map(s => [s, { name: s + ' Corp' }]));
  prefilter.prefilterByMcap = async () => ({
    kept: new Map(symbole.slice(0, stubTreffer).map((s, i) => [s, 400e6 + i])),
  });
  const builder = require('../build-smallcap-universe.js');

  async function baue(anzahlTreffer, outPfad, extraArgv = []) {
    stubTreffer = anzahlTreffer;
    const argv = process.argv;
    process.argv = ['node', 'build-smallcap-universe.js', '--out', outPfad, ...extraArgv];
    try { await builder.main(); } finally { process.argv = argv; }
  }

  const bestand = (n) => ({ _meta: { count: n }, stocks: Array.from({ length: n }, (_, i) => ({ ticker: 'X' + i })) });

  await atest('R1-SK-005 E2E: Schrumpflauf ersetzt den gepflegten Kontrakt NICHT', async () => {
    const out = path.join(TMP, 'watchlist-smallcap.json');
    fs.writeFileSync(out, JSON.stringify(bestand(540)));
    let fehler = null;
    try { await baue(3, out); } catch (e) { fehler = e; }
    assert.ok(fehler, 'R1-SK-005: main() ist durchgelaufen — 3 Namen haben 540 ersetzt, Exit 0');
    assert.match(String(fehler.message), /Mindest/i, 'R1-SK-005: gefallen, aber nicht am Mindestzahl-Gate: ' + fehler.message);
    const danach = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(danach.stocks.length, 540, 'R1-SK-005: der Vorbestand wurde trotzdem angefasst');
  });

  await atest('R1-SK-005 E2E: gesunder Lauf schreibt weiterhin', async () => {
    const out = path.join(TMP, 'watchlist-gesund.json');
    fs.writeFileSync(out, JSON.stringify(bestand(540)));
    await baue(600, out);
    const danach = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(danach.stocks.length, 600, 'ein vollstaendiger Lauf muss den Kontrakt normal fortschreiben');
    assert.equal(danach._meta.count, 600, '_meta.count muss zur Liste passen');
  });

  await atest('R1-SK-005 E2E: Erstanlage braucht nur die absolute Schranke', async () => {
    const out = path.join(TMP, 'watchlist-neu.json');
    await baue(250, out);
    assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).stocks.length, 250,
      'ohne Vorbestand darf die Prozent-Schranke nicht greifen');
    const outKlein = path.join(TMP, 'watchlist-zu-klein.json');
    await assert.rejects(() => baue(10, outKlein), /Mindest/i,
      'auch die Erstanlage darf kein 10-Namen-Universum sein');
    assert.equal(fs.existsSync(outKlein), false, 'bei verfehltem Gate darf nichts angelegt werden');
  });

  await atest('R1-SK-005 E2E: --limit-Probelauf darf den Produktivpfad nicht treffen', async () => {
    // Schreibsperre auf den echten Kontrakt: ohne Guard schreibt der Builder hier
    // tatsaechlich 50 Namen in watchlist-smallcap.json (im Rot-Lauf passiert).
    const { fehler, schreibVersuche } = await mitKlammer(builder.DEFAULT_OUT,
      () => baue(50, builder.DEFAULT_OUT, ['--limit', '50']), null);
    assert.deepEqual(schreibVersuche, [],
      'ein Probelauf ohne --out schreibt sonst 50 Namen in den committeten Kontrakt');
    assert.ok(fehler && /--out/.test(fehler.message),
      'der Probelauf muss am fehlenden --out scheitern, nicht irgendwo sonst: ' + (fehler && fehler.message));
  });

  await atest('R1-SK-005 E2E: korrupter Vorbestand wird nicht ueberschrieben', async () => {
    const out = path.join(TMP, 'watchlist-korrupt.json');
    fs.writeFileSync(out, '{"stocks":[{"ticker":');
    await assert.rejects(() => baue(600, out), /unlesbar/,
      'ein kaputter Vorbestand ist keine Erstanlage — er darf nicht stillschweigend ersetzt werden');
  });
}

builderTests().then(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n' + pass + ' ok, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
});
