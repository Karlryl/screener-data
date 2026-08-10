'use strict';
/**
 * P1-Welle 9 - "Quellen-/Schreibausfall erscheint als Messergebnis"
 * =================================================================
 * Drei Stellen, an denen ein AUSFALL bisher wie eine MESSUNG aussah. Das ist die
 * teuerste Fehlerklasse dieses Repos: nichts stuerzt ab, nichts wird rot, und der
 * Schaden steht dauerhaft in Daten, die niemand nachtraeglich reparieren kann.
 *
 *   F-CGPT-027  scripts/snapshot-ticker-map.js   SEC antwortet 200 mit Muell (Wartungs-
 *               HTML, abgeschnittenes JSON) -> JSON.parse wirft -> der Wurf wurde
 *               verschluckt. `fehlend` blieb leer (es wird nur im ABRUF-catch gefuellt),
 *               also sprang die vorhandene Kompensation (CIK-Uebernahme + Uebernahme
 *               reiner SEC-Symbole) NICHT an und die Tageszeile behauptete
 *               quellenFehlend:[] = "alle Quellen waren da". Folge: ~alle Symbole
 *               "geaendert", ~3.3k reine SEC-Symbole "weg" - sieht aus wie ein
 *               Massen-Delisting, ist ein Quellenausfall. Nicht nachholbar.
 *
 *   F-CGPT-028  scripts/pull-insider-form4.js    Netz-/Seitenausfaelle beim Nachladen
 *               aelterer Filing-Seiten und beim Dokument-Abruf wurden verschluckt; der
 *               Ticker lief in den ERFOLGS-Zweig mit frischem fetchedAt und ueber-
 *               schriebenen transactions. Die 24h-TTL friert den verkuerzten Stand ein:
 *               "kein Insider-Handel" als scheinbares Messergebnis.
 *
 *   F-CGPT-012  pull-yahoo.js                    Der Checkpoint-Schreiber des inkremen-
 *               tellen Manifests faengt jeden Schreibfehler mit einer WARN-Zeile ab, ohne
 *               Zaehler. Ein dauerhaft scheiterndes Checkpoint-Schreiben blieb damit
 *               unzaehlbar, obwohl _silentErrors genau dafuer existiert (TASK 0.11).
 *
 * Usage:  node tests/p1-welle9-quellen-wahrheit.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');

let pass = 0, fail = 0;
// Die Pruefungen laufen SEQUENZIELL: mehrere von ihnen ersetzen zeitweise https.get und
// console.log. Parallel gestartet ueberschreiben sie sich gegenseitig die Stubs und messen
// dann den Nachbartest (erst so gesehen: der SEC-Ausfall-Lauf bekam die NASDAQ-Antwort des
// Gegenprobe-Laufs). Deshalb Warteschlange statt Sofortstart.
const queue = [];
function check(name, fn) { queue.push([name, fn]); }

// --- Stub-Netz (Haus-Muster: https.get zeitweise ersetzen) ----------------
function mitNetz(antwortFuer, fn) {
  const echtesGet = https.get;
  https.get = (url, opts, cb) => {
    const ruf = typeof opts === 'function' ? opts : cb;
    const a = antwortFuer(String(url));
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => {};
    setImmediate(() => {
      if (a && a.netzfehler) { req.emit('error', new Error(a.netzfehler)); return; }
      const res = new EventEmitter();
      res.statusCode = a && a.status ? a.status : 200;
      res.headers = {};
      res.resume = () => {};
      ruf(res);
      setImmediate(() => {
        if (a && a.body != null) res.emit('data', Buffer.from(a.body));
        res.emit('end');
      });
    });
    return req;
  };
  const zurueck = () => { https.get = echtesGet; };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then((v) => { zurueck(); return v; }, (e) => { zurueck(); throw e; });
    zurueck();
    return Promise.resolve(r);
  } catch (e) { zurueck(); throw e; }
}

function mitLog(fn) {
  const zeilen = [];
  const echtesLog = console.log;
  console.log = (...a) => { zeilen.push(a.join(' ')); };
  const zurueck = () => { console.log = echtesLog; };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then((v) => { zurueck(); return { wert: v, zeilen }; }, (e) => { zurueck(); throw e; });
    }
    zurueck();
    return Promise.resolve({ wert: r, zeilen });
  } catch (e) { zurueck(); throw e; }
}

// =========================================================================
// F-CGPT-027 - kaputtes SEC-JSON ist ein Quellenausfall, kein Messergebnis
// =========================================================================
const TM = require('../scripts/snapshot-ticker-map.js');

const N_SYM = 5200;   // ueber der 5000er-Untergrenze in run(), sonst bricht der Lauf ab
const symbolName = (i) => 'SY' + String(i).padStart(4, '0');
const nasdaqDatei = () => {
  const kopf = 'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot|ETF|NextShares';
  const zeilen = [];
  for (let i = 0; i < N_SYM; i++) zeilen.push(symbolName(i) + '|Firma ' + i + '|Q|N|N|100|N|N');
  return [kopf, ...zeilen, 'File Creation Time: 0810202614:00'].join('\n');
};
// Nachzug 10.08.2026: die otherlisted-Antwort war bis hierhin eine nackte Kopfzeile ohne
// einen einzigen Datensatz — genau das, was der neue Muell-Erkenner (zu Recht) als Ausfall
// meldet. Eine echte Zeile muss rein, sonst prueft die "gesund"-Gegenprobe einen Ausfall.
const OTHER_KOPF = 'ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot|Test Issue|NASDAQ Symbol';
const otherDatei = () => [OTHER_KOPF, 'OTHR1|Other AG|N|OTHR1|N|100|N|OTHR1'].join('\n');
const secDatei = () => {
  const j = {};
  for (let i = 0; i < N_SYM; i++) j[i] = { ticker: symbolName(i), cik_str: i + 1, title: 'Firma ' + i };
  j[N_SYM] = { ticker: 'NURSEC', cik_str: 9999, title: 'Nur bei der SEC' };
  return JSON.stringify(j);
};
// Vortagesstand = exakt das, was ein GESUNDER Lauf erzeugt haette (inkl. CIK und
// des reinen SEC-Symbols). Nur so zeigt der Test, was der Ausfall anrichtet.
function grundbildSchreiben(dir) {
  const symbole = {};
  for (let i = 0; i < N_SYM; i++) {
    symbole[symbolName(i)] = { n: 'Firma ' + i, b: 'NASDAQ:Q', e: 'N', t: 'N', c: String(i + 1).padStart(10, '0') };
  }
  symbole.NURSEC = { n: 'Nur bei der SEC', b: 'SEC', e: '', t: '', c: '0000009999' };
  symbole.OTHR1 = { n: 'Other AG', b: 'N', e: 'N', t: 'N' };   // aus otherlisted, ohne CIK
  fs.writeFileSync(path.join(dir, '_grundbild.json'), JSON.stringify(symbole));
}
const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const netzMit = (secAntwort, nasdaqAntwort) => (url) => {
  if (url.includes('company_tickers.json')) return secAntwort;
  if (url.includes('nasdaqlisted')) return nasdaqAntwort || { body: nasdaqDatei() };
  if (url.includes('otherlisted')) return { body: otherDatei() };
  throw new Error('unerwartete URL im Test: ' + url);
};

// Einen vollen Tageslauf gegen ein frisches Verzeichnis fahren und die Tageszeile samt
// Logzeilen zurueckgeben.
async function tageslauf(praefix, antwortFuer) {
  const dir = tmpDir(praefix);
  grundbildSchreiben(dir);
  try {
    return await mitLog(() => mitNetz(antwortFuer, () => TM.run([], { dir })));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

check('F-CGPT-027: SEC antwortet 200 mit Muell -> der Tag meldet den Ausfall UND kompensiert ihn', async () => {
  const dir = tmpDir('w9-tmap-kaputt-');
  grundbildSchreiben(dir);
  // Wartungsseite mit HTTP 200 - genau der Fall, den der Abruf-catch NICHT sieht.
  const ergebnis = await mitLog(() => mitNetz(
    netzMit({ body: '<html><body>SEC.gov | Maintenance</body></html>' }),
    () => TM.run([], { dir })));
  const zeile = ergebnis.wert;
  const log = ergebnis.zeilen;
  fs.rmSync(dir, { recursive: true, force: true });

  assert.ok(Array.isArray(zeile.quellenFehlend) && zeile.quellenFehlend.includes('sec'),
    'quellenFehlend muss "sec" enthalten - sonst behauptet die Tageszeile dauerhaft, alle Quellen seien da gewesen '
    + '(bekam: ' + JSON.stringify(zeile.quellenFehlend) + ')');
  assert.equal(Object.keys(zeile.geaendert).length, 0,
    'die CIK-Uebernahme muss greifen - sonst gelten ' + N_SYM + ' Symbole faelschlich als geaendert');
  assert.ok(!zeile.weg.includes('NURSEC'),
    'reine SEC-Symbole duerfen bei kaputtem SEC-JSON nicht als weg/delisted gelten (Massen-Delisting-Illusion)');
  assert.equal(zeile.weg.length, 0, 'kein Symbol darf durch den Ausfall verschwinden');
  const warn = log.filter((z) => z.startsWith('::warning::') && /sec/i.test(z));
  assert.ok(warn.length > 0,
    '::warning:: muss an Spalte 0 stehen (GitHub-Annotation), sonst sieht niemand den Ausfall. Logzeilen: '
    + JSON.stringify(log.slice(0, 4)));
});

check('F-CGPT-027 Gegenprobe: gesunde SEC -> quellenFehlend bleibt leer', async () => {
  const dir = tmpDir('w9-tmap-gesund-');
  grundbildSchreiben(dir);
  const ergebnis = await mitLog(() => mitNetz(netzMit({ body: secDatei() }), () => TM.run([], { dir })));
  const zeile = ergebnis.wert;
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(zeile.quellenFehlend, [], 'ohne Ausfall darf nichts als fehlend gemeldet werden');
  assert.equal(Object.keys(zeile.geaendert).length, 0);
  assert.equal(zeile.weg.length, 0);
  assert.equal(Object.keys(zeile.hinzu).length, 0);
});

check('F-CGPT-027: baueKarte meldet den kaputten SEC-Parse nach aussen', () => {
  const probleme = [];
  const k = TM.baueKarte({
    nasdaq: 'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot|ETF|NextShares\nAAPL|Apple|Q|N|N|100|N|N',
    other: '', sec: '{ kaputt',
  }, probleme);
  assert.equal(k.size, 1, 'die Boersen-Eintraege muessen weiterhin ankommen (kein Kippen)');
  assert.deepEqual(probleme, ['sec'], 'der Parse-Ausfall muss nach aussen gemeldet werden, sonst ist er wieder still');
  const ohne = [];
  TM.baueKarte({ nasdaq: '', other: '', sec: '{"0":{"ticker":"AAPL","cik_str":320193,"title":"Apple"}}' }, ohne);
  assert.deepEqual(ohne, [], 'GEGENPROBE: gesundes SEC-JSON darf nichts melden');
});

// ---- Nachzug 10.08.2026 (Review): dasselbe Loch stand bei nasdaq/other offen ----
// Der Muell-Erkenner galt nur fuer die SEC. nasdaqlisted/otherlisted koennen genauso mit
// HTTP 200 eine Wartungsseite liefern; kaputte Zeilen werden beim Parsen einfach
// uebersprungen, also blieb der Ausfall vollstaendig still.

check('F-CGPT-027-Nachzug: NASDAQ antwortet 200 mit Muell -> derselbe Weg wie ein Netzfehler', async () => {
  const html = await tageslauf('w9-nasdaq-html-',
    netzMit({ body: secDatei() }, { body: '<html><body>NASDAQ Trader | Scheduled Maintenance</body></html>' }));
  const netz = await tageslauf('w9-nasdaq-netz-',
    netzMit({ body: secDatei() }, { netzfehler: 'ECONNRESET' }));

  assert.ok(html.wert.quellenFehlend.includes('nasdaq'),
    'quellenFehlend muss "nasdaq" enthalten - sonst behauptet die Tageszeile dauerhaft, die Boersendatei sei da gewesen '
    + '(bekam: ' + JSON.stringify(html.wert.quellenFehlend) + ')');
  // Der Kern: der 200er-Muell darf nicht bloss gemeldet werden, er muss durch DIESELBE
  // Strecke laufen wie der bereits gepruefte Netzfehler - sonst ist es eine zweite,
  // ungetestete Sonderbehandlung.
  const vergleich = (z) => JSON.stringify({
    quellen: z.quellenFehlend, summe: z.summe, hinzu: Object.keys(z.hinzu).sort(),
    weg: z.weg, geaendert: Object.keys(z.geaendert).sort(), pruefsumme: z.pruefsumme,
  });
  assert.equal(vergleich(html.wert), vergleich(netz.wert),
    'Wartungsseite und Netzfehler muessen denselben Tag ergeben');
  assert.ok(html.zeilen.some((z) => z.startsWith('::warning::') && /nasdaq/i.test(z)),
    '::warning:: an Spalte 0 (GitHub-Annotation), sonst sieht niemand den Ausfall');
});

check('F-CGPT-027-Nachzug: baueKarte erkennt Muell in nasdaq/other und einen leeren SEC-Body', () => {
  const gesund = { nasdaq: nasdaqDatei(), other: otherDatei(), sec: secDatei() };
  const mit = (aenderung) => { const p = []; TM.baueKarte(Object.assign({}, gesund, aenderung), p); return p; };

  assert.deepEqual(mit({}), [], 'GEGENPROBE: drei gesunde Quellen duerfen nichts melden');
  assert.deepEqual(mit({ nasdaq: '<html><body>Maintenance</body></html>' }), ['nasdaq'],
    'eine Wartungsseite statt nasdaqlisted muss als Ausfall gelten');
  assert.deepEqual(mit({ other: '<html>\n<body>Maintenance</body>\n</html>' }), ['other'],
    'dasselbe fuer otherlisted - mehrzeiliges HTML ergibt 0 Datensaetze');
  // Formal saubere Zeilen, aber vertauschte Kopfspalten: der Datensatz-Zaehler allein
  // wuerde das durchwinken, und die Karte traege danach Firmennamen als Symbol.
  assert.deepEqual(mit({ nasdaq: ['Security Name|Symbol|Market Category|Test Issue|Financial Status|Round Lot|ETF|NextShares',
    'Apple Inc.|AAPL|Q|N|N|100|N|N'].join('\n') }), ['nasdaq'],
    'vertauschte Kopfspalten muessen auffallen, auch wenn Zeilen "parsen"');
  // Der LEERE Body ist der Fall, den `roh.sec || '{}'` verschluckte - Whitespace allein
  // waere hier wertlos als Beleg, weil JSON.parse('   ') ohnehin wirft (Ausbau-Probe
  // 10.08.: mit '   ' blieb dieser Test gruen, obwohl der alte Code wieder drin war).
  assert.deepEqual(mit({ sec: '' }), ['sec'],
    'ein leerer SEC-Body ist ein Ausfall, kein "die SEC kennt heute keine einzige CIK"');
  assert.deepEqual(mit({ sec: '   ' }), ['sec'], 'dasselbe fuer einen Body aus reinem Whitespace');
  // Gegenprobe zur Sproedigkeit: Feld 5 heisst in den echten Dateien "Round Lot Size" und
  // in aelteren Beschreibungen "Round Lot". Gelesen wird es nie - eine Umbenennung dort
  // darf keinen Tagesausfall ausloesen (sonst ist der Waechter ein Fehlalarm-Automat).
  assert.deepEqual(mit({ nasdaq: nasdaqDatei().replace('Round Lot', 'Round Lot Size') }), [],
    'eine Umbenennung einer NICHT gelesenen Spalte darf nichts ausloesen');
  // Und die leere Quelle bleibt Sache des Abruf-catch: dort steht sie laengst in `fehlend`.
  assert.deepEqual(mit({ nasdaq: '' }), [],
    'ein leerer Body ist ein Abruf-Ausfall und wird nicht doppelt gemeldet');
});

// =========================================================================
// F-CGPT-028 - verschluckte Abruf-Ausfaelle machen aus "nicht geholt" ein
//              "nichts gehandelt"
// =========================================================================
const F4 = require('../scripts/pull-insider-form4.js');

const heuteISO = new Date().toISOString().slice(0, 10);
const recentEineFiling = {
  form: ['4'], filingDate: [heuteISO], accessionNumber: ['0000000000-26-000001'],
  primaryDocument: ['xslF345X06/form4.xml'],
};
const submissionsMitAelterenSeiten = () => JSON.stringify({
  filings: {
    recent: recentEineFiling,
    // Die aelteren Seiten sind der Teil, den _filingsCoveringLookback nachlaedt.
    files: [{ name: 'CIK0000000001-submissions-001.json', filingTo: heuteISO }],
  },
});
const submissionsSchlicht = () => JSON.stringify({ filings: { recent: recentEineFiling } });
const FORM4_XML = '<ownershipDocument><issuer><issuerTradingSymbol>TST</issuerTradingSymbol></issuer>'
  + '<reportingOwner><reportingOwnerId><rptOwnerName>Muster Person</rptOwnerName></reportingOwnerId></reportingOwner>'
  + '<nonDerivativeTable><nonDerivativeTransaction>'
  + '<transactionDate><value>' + heuteISO + '</value></transactionDate>'
  + '<transactionCoding><transactionCode>P</transactionCode></transactionCoding>'
  + '<transactionAmounts><transactionShares><value>100</value></transactionShares>'
  + '<transactionPricePerShare><value>10</value></transactionPricePerShare>'
  + '<transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>'
  + '</nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>';

check('F-CGPT-028: ein Seiten-Ausfall beim Nachladen wird gezaehlt, nicht verschluckt', async () => {
  const res = await mitNetz((url) => {
    // Die aeltere Seite heisst CIK...-submissions-001.json - erst DIESE Unterscheidung
    // trifft sie, ein Praefix-Match auf "/submissions/CIK" faengt sie mit ab.
    if (url.includes('-submissions-')) return { status: 503 };          // aeltere Seite faellt aus
    if (url.includes('/submissions/CIK')) return { body: submissionsMitAelterenSeiten() };
    return { body: FORM4_XML };
  }, () => F4._internals.pullTickerForm4('TST', { cik: '0000000001', name: 'Test AG' }));
  assert.ok((res.fetchFailures || 0) > 0,
    'der Ausfall der aelteren Filing-Seite muss zaehlbar sein - sonst sieht der verkuerzte Stand aus wie das ganze Bild '
    + '(bekam fetchFailures=' + res.fetchFailures + ')');
});

check('F-CGPT-028: ein Ausfall beim Dokument-Abruf wird gezaehlt', async () => {
  const res = await mitNetz((url) => {
    if (url.includes('/submissions/')) return { body: submissionsSchlicht() };
    return { netzfehler: 'socket hang up' };                            // Dokument faellt aus
  }, () => F4._internals.pullTickerForm4('TST', { cik: '0000000001', name: 'Test AG' }));
  assert.ok((res.fetchFailures || 0) > 0, 'ein Netzfehler beim Dokument-Abruf darf nicht als "0 Transaktionen" enden');
  assert.equal(res.transactions.length, 0);
});

check('F-CGPT-028 Gegenprobe: sauberer Lauf zaehlt KEINEN Ausfall', async () => {
  const res = await mitNetz((url) => {
    if (url.includes('/submissions/')) return { body: submissionsSchlicht() };
    return { body: FORM4_XML };
  }, () => F4._internals.pullTickerForm4('TST', { cik: '0000000001', name: 'Test AG' }));
  assert.equal(res.fetchFailures || 0, 0, 'ein sauberer Lauf darf keinen Ausfall melden');
  assert.equal(res.transactions.length, 1, 'und die Transaktion muss ankommen');
});

check('F-CGPT-028: Abruf-Ausfaelle fuehren in den Soft-Error-Zweig, ein sauberer Lauf nicht', () => {
  const g = F4._internals._softAusfallGrund;
  assert.ok(/fetch/i.test(String(g({ transactions: [{}], fetchFailures: 2 }) || '')),
    'fetchFailures>0 muss als Ausfall gelten - AUCH wenn Transaktionen dabei sind, denn der Stand ist verkuerzt');
  assert.ok(g({ transactions: [], parseErrors: 3 }), 'der bestehende all-unparsable-Fall muss erhalten bleiben');
  assert.equal(g({ transactions: [{}], parseErrors: 0, fetchFailures: 0 }), null,
    'GEGENPROBE: ein sauberer Lauf darf NICHT in den Soft-Error-Zweig');
});

check('F-CGPT-028: der Ausfall-Eintrag stempelt failedAt und laesst den letzten guten Stand stehen', () => {
  const prev = { ticker: 'TST', fetchedAt: '2026-08-01T00:00:00.000Z', transactions: [{ transactionCode: 'P' }] };
  const e = F4._internals._ausfallEintrag(prev, 'TST', { cik: '0000000001', name: 'Test AG' }, 'fetch-failures(2)');
  assert.equal(e.fetchedAt, prev.fetchedAt,
    'fetchedAt darf NICHT neu gestempelt werden - sonst sperrt die 24h-TTL den Nachholversuch aus');
  assert.deepEqual(e.transactions, prev.transactions,
    'die vorhandenen Transaktionen duerfen nicht ueberschrieben werden');
  assert.ok(e.failedAt, 'failedAt muss gesetzt sein');
  assert.equal(e.error, 'fetch-failures(2)');
});

check('F-CGPT-028 Gegenprobe: ein 404 auf das Dokument bleibt Normalbetrieb, kein Ausfall', async () => {
  // Der Rohpfad wird aus primaryDocument abgeleitet und kann strukturell danebenliegen.
  // Diese Ausnahme ist gewollt - sie wird hier festgenagelt, damit sie niemand versehentlich
  // zum Ausfall macht (dann liefe die halbe Watchlist dauerhaft im Soft-Error-Zweig).
  const res = await mitNetz((url) => {
    if (url.includes('/submissions/')) return { body: submissionsSchlicht() };
    return { status: 404 };
  }, () => F4._internals.pullTickerForm4('TST', { cik: '0000000001', name: 'Test AG' }));
  assert.equal(res.fetchFailures || 0, 0, 'ein Dokument-404 darf NICHT als Abruf-Ausfall zaehlen');
  assert.equal(res.transactions.length, 0);
  assert.equal(F4._internals._softAusfallGrund(res), null, 'und damit auch nicht in den Soft-Error-Zweig fuehren');
});

check('F-CGPT-028-Nachzug: ein TEIL-Ausfall verwirft die frisch geholten Transaktionen nicht', async () => {
  // Aufbau: die aeltere Filing-Seite faellt aus (503), die recent-Filings liefern aber eine
  // gueltige Transaktion. Bis zum Nachzug baute der Ausfall-Eintrag ausschliesslich auf
  // `prev` auf - die frisch geholte Transaktion war weg, und weil kein fetchedAt gesetzt
  // wird, holte der naechste Lauf sie zwar erneut, verwarf sie aber erneut, solange die
  // aeltere Seite ausfiel. Dauerhafter Verlust bei dauerhaftem Teil-Ausfall.
  const res = await mitNetz((url) => {
    if (url.includes('-submissions-')) return { status: 503 };
    if (url.includes('/submissions/CIK')) return { body: submissionsMitAelterenSeiten() };
    return { body: FORM4_XML };
  }, () => F4._internals.pullTickerForm4('TST', { cik: '0000000001', name: 'Test AG' }));
  assert.ok((res.fetchFailures || 0) > 0 && res.transactions.length === 1,
    'Aufbau des Tests: Teil-Ausfall MIT einer frischen Transaktion (bekam fetchFailures='
    + res.fetchFailures + ', transactions=' + res.transactions.length + ')');

  const prev = { ticker: 'TST', fetchedAt: '2026-08-01T00:00:00.000Z',
    transactions: [{ accessionNumber: '0000000000-25-000009', transactionCode: 'S' }] };
  const e = F4._internals._ausfallEintrag(prev, 'TST', { cik: '0000000001', name: 'Test AG' },
    F4._internals._softAusfallGrund(res), res.transactions);

  assert.ok(e.transactions.some((t) => t.accessionNumber === '0000000000-26-000001'),
    'die NEUE Transaktion muss im Cache-Eintrag stehen - sonst ist ein gueltiges Filing still verloren');
  assert.ok(e.transactions.some((t) => t.accessionNumber === '0000000000-25-000009'),
    'und der alte Stand darf dabei nicht verdraengt werden (das kurze Fenster ist nicht das ganze Bild)');
  assert.ok(e.failedAt, 'failedAt muss gesetzt sein - der Stand ist verkuerzt');
  assert.equal(e.fetchedAt, prev.fetchedAt,
    'KEIN frisches fetchedAt: sonst sperrt die 24h-TTL den Nachholversuch der ausgefallenen Seite aus');
});

check('F-CGPT-028-Nachzug Gegenprobe: voller Ausfall (0 Transaktionen) laesst den alten Stand stehen', () => {
  const prev = { ticker: 'TST', fetchedAt: '2026-08-01T00:00:00.000Z',
    transactions: [{ accessionNumber: '0000000000-25-000009', transactionCode: 'S' }] };
  const e = F4._internals._ausfallEintrag(prev, 'TST', { cik: '0000000001', name: 'Test AG' },
    'fetch-failures(3)', []);
  assert.deepEqual(e.transactions, prev.transactions,
    'ohne frische Transaktionen bleibt der letzte gute Stand unangetastet');
  assert.equal(e.fetchedAt, prev.fetchedAt);
  assert.ok(e.failedAt);
});

const F4_SRC = fs.readFileSync(require.resolve('../scripts/pull-insider-form4.js'), 'utf8');

// Die Verdrahtung in main() laesst sich ohne echtes SEC-Netz und ohne Schreiben in den
// echten 42-MB-Cache nicht fahren - also Anker am Quelltext. Damit der Anker nicht bloss
// ein Schreibmuster festnagelt (F1115), prueft er die SACHE: der Ausfall-Eintrag muss dem
// Cache-Eintrag ZUGEWIESEN werden, der Lauf muss den Fehler zaehlen, und der Erfolgs-Zweig
// darf danach nicht mehr laufen. Die Ausbau-Probe unten belegt, dass jede fehlende dieser
// drei Sachen rot wird.
function mainAusfallBlock(src) {
  const mainAb = src.indexOf('async function main(');
  const i = src.indexOf('const softGrund = _softAusfallGrund(result);', mainAb);
  assert.ok(i > mainAb && mainAb > 0, 'main() muss den gemeinsamen Ausfall-Grund auswerten');
  // Blockgrenze ist der Beginn des ERFOLGS-Zweigs: so liegt das `continue;` sicher IM
  // Block. (Ein Schnitt beim ersten `continue;` waere selbst-heilend gewesen - faellt es
  // weg, rutscht die Grenze einfach zum naechsten continue weiter unten.)
  const ende = src.indexOf('byTicker[ticker] = {', i);
  return src.slice(i, ende > 0 ? ende : i + 900);
}

function pruefeMainVerdrahtung(src) {
  const block = mainAusfallBlock(src);
  assert.ok(/byTicker\[ticker\] = _ausfallEintrag\(/.test(block),
    'der Ausfall-Eintrag muss dem Cache-Eintrag ZUGEWIESEN werden (failedAt, kein fetchedAt, transactions bleiben) '
    + '- ein blosser Aufruf ohne Zuweisung waere wirkungslos');
  assert.ok(/errors\+\+/.test(block), 'der Ausfall muss in die Fehlerzahl des Laufs eingehen');
  assert.ok(/continue;/.test(block), 'nach dem Ausfall darf der Erfolgs-Zweig nicht mehr laufen');
  assert.ok(/_ausfallEintrag\([^)]*result\.transactions\)/.test(block),
    'die frisch geholten Transaktionen muessen in den Ausfall-Eintrag durchgereicht werden - sonst verwirft '
    + 'ein Teil-Ausfall gueltige neue Filings (Nachzug 10.08.2026)');
}

check('F-CGPT-028: main() benutzt den Soft-Error-Zweig wirklich (Anker am Objekt)', () => {
  pruefeMainVerdrahtung(F4_SRC);
});

check('F-CGPT-028 Ausbau-Probe: jede fehlende Verdrahtung macht den Anker rot', () => {
  const block = mainAusfallBlock(F4_SRC);
  const ausbauten = {
    'Zuweisung verworfen': block.replace('byTicker[ticker] = _ausfallEintrag(', '_ausfallEintrag('),
    'Fehlerzaehlung entfernt': block.replace(/errors\+\+;\s*/, ''),
    'continue entfernt': block.replace('continue;', ''),
    'frische Transaktionen nicht durchgereicht': block.replace(', result.transactions)', ')'),
  };
  for (const was of Object.keys(ausbauten)) {
    assert.notEqual(ausbauten[was], block, 'Ausbau "' + was + '" hat nichts veraendert - falsche Stelle geprueft');
    const s = F4_SRC.replace(block, ausbauten[was]);
    assert.throws(() => pruefeMainVerdrahtung(s), undefined,
      'der Anker bleibt gruen, obwohl "' + was + '" - er nagelt die Sache nicht fest');
  }
});

// =========================================================================
// F-CGPT-012 - Checkpoint-Schreibfehler muss zaehlbar sein (TASK 0.11)
// =========================================================================
const YAHOO_SRC = fs.readFileSync(require.resolve('../pull-yahoo.js'), 'utf8');

// Waechter am OBJEKT (F1115): nicht "irgendwo steht das Wort", sondern
//   1. der Zaehler ist im TASK-0.11-Zaehlblock deklariert,
//   2. er wird im catch des Checkpoint-Schreibers hochgezaehlt,
//   3. er steht in BEIDEN _silentErrors-Objekten (inkrementell + final).
// Faellt eine der drei weg, ist der Fehler wieder unsichtbar - die Ausbau-Probe
// unten baut jede Stelle einzeln aus und belegt, dass der Waechter dann rot wird.
function pruefeZaehlerVerankerung(src) {
  const block = src.slice(src.indexOf('let _lampErrors'), src.indexOf('let _unparseableTimeAnchors'));
  assert.ok(/let _manifestCheckpointErrors = 0;/.test(block),
    'der Zaehler fehlt im TASK-0.11-Zaehlblock');
  const i = src.indexOf('Incremental manifest write failed');
  const catchStelle = src.slice(i - 400, i + 200);
  assert.ok(/_manifestCheckpointErrors\+\+/.test(catchStelle),
    'der catch des Checkpoint-Schreibers zaehlt den Fehler nicht hoch');
  // Nachzug 10.08.2026: der Kommentar ueber der Tally-Zeile verspricht, der Zaehlstand sei
  // "auch auf einem sauberen Lauf" im LOG sichtbar - "the log survives regardless of write
  // path". Genau der neue Zaehler fehlte dort. Ein Manifest, das wegen eines Schreibfehlers
  // nicht geschrieben wird, kann den Zaehler dieses Schreibfehlers nicht melden.
  const tallyZeile = src.slice(src.indexOf('Silent-error tally (0.11)'),
    src.indexOf('\n', src.indexOf('Silent-error tally (0.11)')));
  assert.ok(/manifestCheckpoint=\$\{_manifestCheckpointErrors\}/.test(tallyZeile),
    'die Tally-Logzeile meldet den Checkpoint-Zaehler nicht: ' + tallyZeile.slice(0, 160));
  const objekte = src.match(/_silentErrors[^\n]*lamp: _lampErrors[^\n]*/g) || [];
  assert.equal(objekte.length, 2, 'es muessen genau zwei _silentErrors-Objekte sein (inkrementell + final)');
  for (const o of objekte) {
    assert.ok(/manifestCheckpoint: _manifestCheckpointErrors/.test(o),
      'ein _silentErrors-Objekt meldet den Checkpoint-Zaehler nicht: ' + o.slice(0, 120));
  }
}

check('F-CGPT-012: der Checkpoint-Zaehler ist deklariert, wird gezaehlt und in beiden Manifesten gemeldet', () => {
  pruefeZaehlerVerankerung(YAHOO_SRC);
});

// Entfernt das Checkpoint-Feld aus dem n-ten _silentErrors-Objekt (0 = inkrementell, 1 = final).
function manifestFeldRaus(src, n) {
  const treffer = src.match(/_silentErrors[^\n]*lamp: _lampErrors[^\n]*/g) || [];
  if (!treffer[n]) return src;
  return src.replace(treffer[n], treffer[n].replace(', manifestCheckpoint: _manifestCheckpointErrors', ''));
}

check('F-CGPT-012 Ausbau-Probe: faellt eine der Stellen weg, wird der Waechter rot', () => {
  const ausbauten = {
    'Deklaration entfernt': (s) => s.replace('let _manifestCheckpointErrors = 0;', ''),
    'Hochzaehlen im catch entfernt': (s) => s.replace(/_manifestCheckpointErrors\+\+;\s*/, ''),
    // Beide Manifest-Objekte EINZELN ausbauen: ein replace ohne g-Flag traefe nur das
    // inkrementelle - dann bliebe "nur das FINALE Manifest verliert das Feld" ungeprueft,
    // und genau das finale liest die Auswertung.
    'Meldung im inkrementellen Manifest entfernt': (s) => manifestFeldRaus(s, 0),
    'Meldung im finalen Manifest entfernt': (s) => manifestFeldRaus(s, 1),
    'Meldung in der Tally-Logzeile entfernt': (s) => s.replace(' manifestCheckpoint=${_manifestCheckpointErrors}', ''),
  };
  for (const was of Object.keys(ausbauten)) {
    const s = ausbauten[was](YAHOO_SRC);
    assert.notEqual(s, YAHOO_SRC, 'Ausbau "' + was + '" hat nichts veraendert - der Waechter prueft die falsche Stelle');
    assert.throws(() => pruefeZaehlerVerankerung(s), undefined,
      'der Waechter bleibt gruen, obwohl "' + was + '" - er nagelt die Sache nicht fest');
  }
});

check('F-CGPT-012: der Checkpoint-Fehler bleibt nicht-toedlich (kein throw im catch)', () => {
  // Ausdruecklich KEIN throw: ein transienter OneDrive-/AV-Schreibfehler darf den
  // laufenden Pull nicht killen. Der finale Manifest-Write stirbt bei einem
  // dauerhaften Problem ohnehin laut.
  const i = YAHOO_SRC.indexOf('Incremental manifest write failed');
  const block = YAHOO_SRC.slice(i - 200, i + 200);
  assert.ok(!/throw/.test(block), 'der Checkpoint-catch darf nicht werfen');
  assert.ok(/_log\('WARN'/.test(block), 'die WARN-Zeile bleibt');
});

check('F-CGPT-012: der Zaehler wird pro Lauf zurueckgesetzt und ist abfragbar', () => {
  const yahoo = require('../pull-yahoo.js');
  assert.ok('manifestCheckpoint' in yahoo._silentErrorCounts(),
    'der Zaehler muss im Laufzaehler-Objekt stehen, sonst ist er von aussen nicht pruefbar');
  yahoo._resetSilentErrorCounts();
  assert.equal(yahoo._silentErrorCounts().manifestCheckpoint, 0);
});

(async () => {
  for (const eintrag of queue) {
    const name = eintrag[0];
    try { await eintrag[1](); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
  }
  console.log('\np1-welle9: ' + pass + ' ok, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
