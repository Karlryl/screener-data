'use strict';
/** tests/druckenmiller/log-internals.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG, am ECHTEN Skript gefahren (Kindprozess, echte Dateien, kein Mock):
 *   - ein Lauf haengt genau eine Zeile fuer die neueste Sitzung an;
 *   - --backfill setzt die rueckrechenbaren Sitzungen davor, alle mit backfilled: true;
 *   - ein zweiter Lauf am selben Tag haengt NICHTS an (Idempotenz);
 *   - ein verpasster Tag wird beim naechsten Lauf nachgetragen (backfilled: true);
 *   - --check ist der Waechter, der ROT werden kann: Kette, Schrumpfen, Loch, Stillstand.
 * Jeder --check-Zweig wird einmal absichtlich gebrochen (Exit 1) und einmal gegengeprueft.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'druckenmiller-log-internals.js');
const store = require(path.join(REPO, 'lib', 'price-history-store.js'));
const L = require(path.join(REPO, 'lib', 'druckenmiller', 'ledger.js'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

const SEKTOREN = ['Industrials', 'Energy', 'Healthcare', 'Utilities', 'Technology'];
const N_TICKER = 10;
const N_BALKEN = 260; // gerade genug fuer >= 250 Balken an den letzten Sitzungen

/** Handelstage 2025-01-01 ff. als reine Werktagsfolge (Kalender ist hier egal, nur Ordnung). */
function tage(n) {
  const out = [];
  const d = new Date(Date.UTC(2025, 0, 1));
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function sandkasten({ fehlendeBalken } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-log-'));
  const prices = path.join(dir, 'prices');
  const snaps = path.join(dir, 'snapshots');
  fs.mkdirSync(path.join(prices, 'history'), { recursive: true });
  fs.mkdirSync(snaps, { recursive: true });
  const daten = tage(N_BALKEN);
  const history = {};
  const mach = (t, bis) => {
    history[t] = daten.slice(0, bis).map((date, i) => ({ date, close: 100 + i + t.charCodeAt(1) }));
  };
  for (let i = 0; i < N_TICKER; i++) mach('T' + i, N_BALKEN);
  mach('SPY', N_BALKEN);
  mach('IWM', N_BALKEN);
  if (fehlendeBalken) mach('T0', N_BALKEN - 3); // ein Ticker haengt drei Sitzungen zurueck
  store.saveAll(prices, history);
  for (let i = 0; i < N_TICKER; i++) {
    fs.writeFileSync(path.join(snaps, 'T' + i + '.json'), JSON.stringify({
      meta: { ticker: 'T' + i, country: 'United States', sector: SEKTOREN[i % SEKTOREN.length], industry: 'Trucking' },
      marketCap: 1e9 * (i + 1),
      external: { estimateRevisions: { '+1y': { upLast30Days: i % 3, downLast30Days: 1 } } },
    }));
  }
  // Ein Nicht-US-Ticker und ein Suffix-Ticker: beide duerfen nie in U landen.
  fs.writeFileSync(path.join(snaps, 'FOREIGN.json'), JSON.stringify({ meta: { ticker: 'FOREIGN', country: 'Germany', sector: 'Energy' } }));
  fs.writeFileSync(path.join(snaps, 'GS.VI.json'), JSON.stringify({ meta: { ticker: 'GS.VI', country: 'United States', sector: 'Energy' } }));
  return { dir, prices, snaps, out: path.join(dir, 'druckenmiller-history'),
    exportDir: path.join(dir, 'export'), daten };
}

function fahre(s, args) {
  return spawnSync(process.execPath, [SKRIPT,
    '--prices-dir', s.prices, '--snapshots', s.snaps, '--out', s.out,
    '--export-dir', s.exportDir].concat(args || []),
  { encoding: 'utf8' });
}
const ledgerVon = (s) => path.join(s.out, 'internals-ledger.jsonl');

test('S1 ein Lauf schreibt GENAU eine Zeile fuer die neueste Sitzung', () => {
  const s = sandkasten();
  const r = fahre(s);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = L.readRows(ledgerVon(s));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, s.daten[N_BALKEN - 1]);
  assert.equal(rows[0].backfilled, false);
  assert.equal(rows[0].universeSize, N_TICKER, 'FOREIGN und GS.VI duerfen nicht in U sein');
  assert.equal(rows[0].nNoSeries, 0);
  assert.equal(rows[0].nSnapshotUnreadable, 0);
  assert.match(rows[0].universeHash, /^[0-9a-f]{64}$/);
  assert.ok(Number.isFinite(rows[0].l1) && Number.isFinite(rows[0].l2));
});

test('S2 Roh-Zeilen je Ticker liegen gzip-komprimiert neben dem Ledger', () => {
  const s = sandkasten();
  fahre(s);
  const roh = path.join(s.out, 'raw', s.daten[N_BALKEN - 1] + '.jsonl.gz');
  assert.ok(fs.existsSync(roh), 'die Roh-Zeilen sind der Vertrag des Rats (D2) — ohne sie ist die Zeile nicht nachrechenbar');
  const zeilen = zlib.gunzipSync(fs.readFileSync(roh)).toString('utf8').trim().split('\n').map(JSON.parse);
  assert.equal(zeilen.length, N_TICKER);
  assert.ok(zeilen.every((z) => z.ticker && z.lastBarDate), 'jede Roh-Zeile traegt die Frische ihres Tickers (Anklage A3)');
});

test('S3 ein zweiter Lauf am selben Stand haengt NICHTS an', () => {
  const s = sandkasten();
  fahre(s);
  const r = fahre(s);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(L.readRows(ledgerVon(s)).length, 1, 'derselbe Tag darf nicht zweimal in der Reihe stehen');
});

test('S4 --backfill setzt die rueckrechenbaren Sitzungen, alle bis auf die neueste markiert', () => {
  const s = sandkasten();
  const r = fahre(s, ['--backfill']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = L.readRows(ledgerVon(s));
  // rueckrechenbar = jede Sitzung mit mindestens 250 Balken davor
  assert.equal(rows.length, N_BALKEN - 249);
  assert.equal(rows[rows.length - 1].date, s.daten[N_BALKEN - 1]);
  assert.equal(rows[rows.length - 1].backfilled, false);
  assert.ok(rows.slice(0, -1).every((x) => x.backfilled === true));
  assert.deepEqual(L.quantileInput(rows).length, 1, 'nur der Live-Tag speist Quantile (Rat D2)');
});

test('S5 ein verpasster Tag wird beim naechsten Lauf nachgetragen (backfilled: true)', () => {
  const s = sandkasten();
  // Lauf "vorgestern": den Store um zwei Sitzungen kuerzen
  const voll = store.loadAll(s.prices);
  const gekuerzt = {};
  for (const [t, serie] of Object.entries(voll)) gekuerzt[t] = serie.slice(0, N_BALKEN - 2);
  store.saveAll(s.prices, gekuerzt);
  fahre(s);
  assert.equal(L.readRows(ledgerVon(s)).length, 1);
  // Store wieder vollstaendig -> der naechste Lauf holt beide fehlenden Tage nach
  store.saveAll(s.prices, voll);
  const r = fahre(s);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = L.readRows(ledgerVon(s));
  assert.equal(rows.length, 3);
  assert.equal(rows[1].backfilled, true, 'der nachgetragene Tag ist als solcher markiert');
  assert.equal(rows[2].backfilled, false);
  assert.equal(L.ledgerGapDays(rows, s.daten), 0, 'nach dem Nachtrag ist die Reihe lueckenlos');
});

test('S6 Anklage A3: ein zurueckhaengender Ticker faellt aus L1–L4 und wird GEZAEHLT', () => {
  const s = sandkasten({ fehlendeBalken: true });
  fahre(s);
  const row = L.readRows(ledgerVon(s))[0];
  assert.equal(row.nCandidates, N_TICKER);
  assert.equal(row.nAtSession, N_TICKER - 1);
  assert.equal(row.universeSize, N_TICKER - 1, 'U ist die Menge, auf der die Achsen rechnen');
  assert.equal(row.excludedNoBar, 1);
  assert.ok(row.mixedBarDateShare > 0, 'der Anteil abweichender Balken-Tage steht in der Zeile');
  assert.equal(row.barDateMode, s.daten[N_BALKEN - 1]);
});

test('S7 --check ist gruen auf einer gesunden Reihe und meldet ledgerGapDays 0', () => {
  const s = sandkasten();
  fahre(s, ['--backfill']);
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ledgerGapDays=0/);
});

test('S8 BRUCHPROBE --check: ein herausgeloeschter Tag macht den Lauf ROT', () => {
  const s = sandkasten();
  fahre(s, ['--backfill']);
  const zeilen = fs.readFileSync(ledgerVon(s), 'utf8').split('\n').filter(Boolean);
  zeilen.splice(3, 1); // ein Tag mittendrin verschwindet
  fs.writeFileSync(ledgerVon(s), zeilen.join('\n') + '\n');
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 1, 'ein Loch in der Reihe MUSS rot sein:\n' + r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /Kette|ledgerGapDays=[1-9]/);
});

test('S9 BRUCHPROBE --check: eine geschoenigte historische Zeile macht den Lauf ROT', () => {
  const s = sandkasten();
  fahre(s, ['--backfill']);
  const zeilen = fs.readFileSync(ledgerVon(s), 'utf8').split('\n').filter(Boolean);
  const z = JSON.parse(zeilen[2]); z.l1 = 0.999; zeilen[2] = JSON.stringify(z);
  fs.writeFileSync(ledgerVon(s), zeilen.join('\n') + '\n');
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 1, 'eine editierte Vergangenheit MUSS rot sein:\n' + r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /Kette/);
});

test('S10 BRUCHPROBE --check: eine geschrumpfte Reihe macht den Lauf ROT', () => {
  const s = sandkasten();
  fahre(s, ['--backfill']);
  const zeilen = fs.readFileSync(ledgerVon(s), 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(ledgerVon(s), zeilen.slice(0, 2).join('\n') + '\n');
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 1, 'eine geschrumpfte Reihe MUSS rot sein:\n' + r.stdout + r.stderr);
  // Der Sidecar-Beweis der LETZTEN Zeile schlaegt bei einer Kuerzung frueher an als der
  // Zeilenzaehler — beide sind derselbe Befund, und beide sind rot.
  assert.match(r.stdout + r.stderr, /schrumpf|LETZTE Zeile/i);
});

test('S11 BRUCHPROBE --check: ein stehengebliebener Logger macht den Lauf ROT', () => {
  // Der stille Ausfall, den ledgerGapDays konstruktionsbedingt NICHT sieht: die Reihe ist
  // in sich lueckenlos und altert nur weg. Genau der Fall aus Anklage A1.
  const s = sandkasten();
  const voll = store.loadAll(s.prices);
  const gekuerzt = {};
  for (const [t, serie] of Object.entries(voll)) gekuerzt[t] = serie.slice(0, N_BALKEN - 4);
  store.saveAll(s.prices, gekuerzt);
  fahre(s);
  store.saveAll(s.prices, voll);
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 1, 'vier unprotokollierte Sitzungen MUESSEN rot sein:\n' + r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /staleSessions=[1-9]/);
});

test('S12 BRUCHPROBE --check: gar kein Ledger ist ROT, nicht "nichts zu tun"', () => {
  const s = sandkasten();
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 1, 'ein fehlender Ledger ist der lauteste Fall, nicht der leiseste');
  assert.match(r.stdout + r.stderr, /kein Ledger|fehlt/i);
});

test('S12b Frische-Tor ist GELB: markiert, aus Quantilen raus, Lauf bleibt gruen', () => {
  // Gericht, Wiederaufnahme 14.09.2026: freshShare < 0.95 -> lowFreshness, Zeile bleibt
  // stehen, speist kein Quantil, ::warning:: statt Exit 1. Ein unvollstaendiger Kursabruf
  // ist ein bekannter, haeufiger Zustand — rot hiesse, den Lauf an einer Sache anzuhalten,
  // die die Reihe selbst korrekt behandelt. Hier haengt 1 von 10 Tickern zurueck -> 0.9.
  const s = sandkasten({ fehlendeBalken: true });
  fahre(s);
  const row = L.readRows(ledgerVon(s))[0];
  assert.equal(row.lowFreshness, true);
  assert.ok(Math.abs(row.freshShare - 0.9) < 1e-9);
  assert.equal(row.nExcludedStale, 1);
  assert.deepEqual(L.quantileInput([row]), [], 'eine truebe Zeile darf kein Quantil speisen');
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 0, 'Frische ist gelb, nicht rot: ' + r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /::warning::.*frischen Tickern/s);
  assert.ok(!fs.existsSync(path.join(s.exportDir, '_FAILED.json')),
    'ein gelber Befund darf den Export NICHT als ungueltig markieren');
});

test('S12c GEGENPROBE zu S12b: bei vollstaendigem Kursabruf ist freshShare 1 und --check gruen', () => {
  const s = sandkasten();
  fahre(s);
  const row = L.readRows(ledgerVon(s))[0];
  assert.equal(row.lowFreshness, false);
  assert.equal(row.freshShare, 1);
  assert.equal(fahre(s, ['--check']).status, 0);
});

test('S12d N1: ein ROTER Befund hinterlaesst _FAILED.json im Export-Ordner', () => {
  // Nicht loeschen, sondern markieren: findash schreibt bei 404 nicht
  // (data-layer/screener-sync.js:164-166) und zeigte sonst den Stand von gestern als
  // heutigen an. Ein fehlender Ordner ist unsichtbar, ein Marker ist eine Aussage.
  const s = sandkasten();
  fahre(s, ['--backfill']);
  fs.mkdirSync(s.exportDir, { recursive: true });
  fs.writeFileSync(path.join(s.exportDir, 'regime.json'), '{"schema":"findash-druckenmiller/v1"}');
  const zeilen = fs.readFileSync(ledgerVon(s), 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(ledgerVon(s), zeilen.slice(0, 2).join('\n') + '\n');
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 1);
  const marker = path.join(s.exportDir, '_FAILED.json');
  assert.ok(fs.existsSync(marker), 'kein Fehlermarker — der Konsument haelt gestern fuer heute');
  const j = JSON.parse(fs.readFileSync(marker, 'utf8'));
  assert.equal(j.schema, 'findash-druckenmiller/v1');
  assert.match(j.reason, /schrumpf|LETZTE Zeile/i);
  assert.ok(j.generated_at && j.failedAt);
  assert.ok(!fs.existsSync(path.join(s.exportDir, 'regime.json')),
    'die alte Ausliefer-Datei steht noch daneben — dann gilt sie weiter');
});

test('S12e ein vorhandener _FAILED.json aus einem frueheren Schritt ist selbst ROT', () => {
  const s = sandkasten();
  fahre(s, ['--backfill']);
  fs.mkdirSync(s.exportDir, { recursive: true });
  fs.writeFileSync(path.join(s.exportDir, '_FAILED.json'), '{"reason":"Vorlauf"}');
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 1, 'ein markierter Export darf nicht gruen durchlaufen');
});

test('S12f BRUCHPROBE Zeilenform: ein fehlendes Pflichtfeld ist ROT', () => {
  const s = sandkasten();
  fahre(s, ['--backfill']);
  const crypto = require('node:crypto');
  let z = fs.readFileSync(ledgerVon(s), 'utf8').split('\n').filter(Boolean);
  const o = JSON.parse(z[3]); delete o.l1; z[3] = JSON.stringify(o);
  let prev = 'GENESIS';
  z = z.map((l) => {
    const q = JSON.parse(l); q.prevHash = prev;
    const t = JSON.stringify(q);
    prev = crypto.createHash('sha256').update(t, 'utf8').digest('hex');
    return t;
  });
  fs.writeFileSync(ledgerVon(s), z.join('\n') + '\n');
  fs.writeFileSync(ledgerVon(s) + '.meta.json', JSON.stringify({ rows: z.length }));
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 1, 'eine Zeile ohne l1 ist spaeter nicht auswertbar: ' + r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /Feld l1 fehlt/);
});

test('S12g rueckgerechnete Zeilen tragen keine Frische-Zahl und sind vom Tor ausgenommen', () => {
  const s = sandkasten({ fehlendeBalken: true });
  fahre(s, ['--backfill']);
  const rows = L.readRows(ledgerVon(s));
  const zurueck = rows.slice(0, -1);
  assert.ok(zurueck.length > 5);
  assert.ok(zurueck.every((r) => r.freshShare === null && r.barDateMode === null
    && r.mixedBarDateShare === null && r.nExcludedStale === null && r.lowFreshness === false),
  'eine Backfill-Zeile behauptet eine Frische, die niemand an jenem Tag gemessen hat');
  assert.equal(rows[rows.length - 1].barDateMode, s.daten[N_BALKEN - 1]);
});

test('S12h REVIEW-FUND: ein Tag ohne einen einzigen Ticker-Balken wird LEER geschrieben', () => {
  // Vorher stand hier ein `continue`. Der Lauf schrieb danach spaetere Tage weiter, das Loch
  // war fuer immer unfuellbar (appendRow verbietet Rueckdatierung), der Waechter jeden Tag
  // rot — und nach ~19 Monaten faellt der Tag aus dem rollenden Fenster und alles ist wieder
  // gruen, mit dem Loch drin. Eine leere Zeile ist eine ehrliche Aussage und haelt die Reihe
  // zusammenhaengend.
  const s = sandkasten();
  // Alle Kandidaten enden eine Sitzung frueher als SPY (SPY definiert den Kalender):
  const voll = store.loadAll(s.prices);
  const gekuerzt = {};
  for (const [t, serie] of Object.entries(voll)) {
    gekuerzt[t] = (t === 'SPY' || t === 'IWM') ? serie : serie.slice(0, N_BALKEN - 1);
  }
  store.saveAll(s.prices, gekuerzt);
  const r = fahre(s);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = L.readRows(ledgerVon(s));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, s.daten[N_BALKEN - 1], 'die Reihe bleibt am Sitzungskalender');
  assert.equal(rows[0].nAtSession, 0);
  assert.equal(rows[0].universeSize, 0);
  assert.equal(rows[0].l1, null, 'alle Achsen sind null — nicht 0');
  assert.match(r.stdout + r.stderr, /::warning::.*kein einziger Ticker/);
  assert.equal(L.ledgerGapDays(rows, s.daten), 0, 'kein Loch');
});

test('S13 GEGENPROBE zu S8–S12: die unangetastete Reihe bleibt gruen', () => {
  const s = sandkasten();
  fahre(s, ['--backfill']);
  fahre(s);
  const r = fahre(s, ['--check']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('S14 fehlende SPY-Serie ist ein LAUTER Abbruch, keine leere Zeile', () => {
  const s = sandkasten();
  const voll = store.loadAll(s.prices);
  delete voll.SPY;
  store.saveAll(s.prices, voll);
  const r = fahre(s);
  assert.equal(r.status, 1, 'ohne Sitzungskalender darf keine Zeile entstehen:\n' + r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /SPY/);
  assert.equal(fs.existsSync(ledgerVon(s)), false);
});

console.log('\nlog-internals.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
