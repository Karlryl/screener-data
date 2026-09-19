'use strict';
/** tests/druckenmiller/write-export.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG (BUILD-SPEC v1 §2, §0.1-0.2, arch-spec §3.2): der Export ist entweder
 * VOLLSTAENDIG und in sich stimmig — oder er ist EIN Marker. Es gibt keinen dritten
 * Zustand, in dem findash die Haelfte von heute neben der Haelfte von gestern sieht.
 *
 * WARUM DER SCHARFE TEIL WICHTIGER IST ALS DER SCHREIBENDE: der Schreib-Schritt faehrt
 * in der CI fail-soft (Karls Boards duerfen an dieser Messreihe nie haengen bleiben).
 * Alles, was den Vertrag haelt, haengt damit an --check. Jede rote Bedingung wird hier
 * einmal absichtlich ausgeloest.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const W = require('../scripts/write-druckenmiller-export.js');
const internals = require('../lib/druckenmiller/internals.js');
const ledgerLib = require('../lib/druckenmiller/ledger.js');
const store = require('../lib/price-history-store.js');

const REPO = path.resolve(__dirname, '..');
const PROTOCOL = path.join(REPO, 'protocol');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && (e.stack || e.message))); }
}
const still = () => {};

// ---------------------------------------------------------------------------
// Fixture: eine kleine, echte Welt — Preis-Store (Sitzungskalender), Roh-Dateien
// je Tag und eine gekettete Reihe, die aus genau diesen Roh-Zeilen gebaut ist.
// ---------------------------------------------------------------------------
const TAGE = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'];

function tickerZeile(i, opts) {
  const o = opts || {};
  return {
    ticker: 'T' + i,
    sector: i % 3 === 0 ? 'Healthcare' : (i % 3 === 1 ? 'Industrials' : 'Technology'),
    industry: i % 5 === 0 ? 'Trucking' : 'Software',
    marketCap: 1e9 + i,
    netRevision30: i % 4 === 0 ? null : (i % 2 ? 1 : -1),
    noSeries: false,
    atSession: o.atSession !== false,
    inUniverse: o.atSession !== false && (o.bars === undefined ? 300 : o.bars) >= internals.SMA_LANG + 50,
    lastBarDate: o.lastBarDate || null,
    bars: o.bars === undefined ? 300 : o.bars,
    close: 100 + i,
    sma50: 95 + i,
    sma200: 90 + i,
    high252: 120 + i,
    low252: 80 + i,
    ret63: (i % 7) / 100 - 0.03,
  };
}

/** Die Roh-Datei traegt genau die Felder, die scripts/druckenmiller-log-internals.js schreibt. */
function schreibeRoh(dir, datum, zeilen) {
  fs.mkdirSync(dir, { recursive: true });
  const text = zeilen.map((z) => JSON.stringify({
    ticker: z.ticker, sector: z.sector, industry: z.industry, marketCap: z.marketCap,
    netRevision30: z.netRevision30, atSession: z.atSession, lastBarDate: z.lastBarDate,
    bars: z.bars, close: z.close, sma50: z.sma50, sma200: z.sma200,
    high252: z.high252, low252: z.low252, ret63: z.ret63,
  })).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, datum + '.jsonl.gz'), zlib.gzipSync(Buffer.from(text, 'utf8')));
}

/**
 * @param {object} [o] o.mitglieder: date -> [i...] (U-Mitglieder je Tag), o.tage
 */
function welt(o) {
  const opt = o || {};
  const tage = opt.tage || TAGE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-export-'));
  const outDir = path.join(dir, 'druckenmiller-history');
  const rawDir = path.join(outDir, 'raw');
  const exportDir = path.join(dir, 'outputs', 'findash-export', 'v1', 'druckenmiller');
  const pricesDir = path.join(dir, 'prices');

  // Sitzungskalender = SPY-Serie, genau die Fixture-Tage.
  const shard = {};
  shard.SPY = tage.map((d, i) => ({ date: d, close: 500 + i }));
  fs.mkdirSync(path.join(pricesDir, 'history'), { recursive: true });
  fs.writeFileSync(path.join(pricesDir, 'history', 'history-' + String(store.shardOf('SPY')).padStart(2, '0') + '.json'),
    JSON.stringify(shard));

  const ledgerFile = path.join(outDir, 'internals-ledger.jsonl');
  const history = [];
  for (const d of tage) {
    const ids = (opt.mitglieder && opt.mitglieder[d]) || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const zeilen = ids.map((i) => tickerZeile(i, { lastBarDate: d }));
    schreibeRoh(rawDir, d, zeilen);
    const row = internals.buildRow({
      date: d, rawRows: zeilen, backfilled: d !== tage[tage.length - 1],
      spyState: 'BULL', spyRet63: 0.01, iwmRet63: 0.02,
      prevRow: history.length ? history[history.length - 1] : null,
      history, snapshotUnreadable: 0, now: new Date('2026-09-14T02:17:00Z'),
    });
    ledgerLib.appendRow(ledgerFile, row);
    history.push(row);
  }
  return { dir, outDir, rawDir, exportDir, pricesDir, ledgerFile, tage, history };
}

const opts = (w, extra) => Object.assign({
  outDir: w.outDir, exportDir: w.exportDir, pricesDir: w.pricesDir, protocolDir: PROTOCOL, log: still,
}, extra || {});

const liesJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// ---------------------------------------------------------------------------

test('W1 der Schreiber legt genau die Chunk-1-Dateien an — mit EINEM generated_at', () => {
  const w = welt();
  assert.equal(W.writeExport(opts(w)), 0);
  const da = fs.readdirSync(w.exportDir).sort();
  assert.deepEqual(da, ['meta.json', 'regime.json'],
    'chunk 1 schreibt zwei Dateien; candidates/duquesne13f gehoeren zu Chunk 2/3');
  const regime = liesJson(path.join(w.exportDir, 'regime.json'));
  const meta = liesJson(path.join(w.exportDir, 'meta.json'));
  assert.equal(regime.generated_at, meta.generated_at,
    'zwei generated_at heisst: der Konsument kann heute mit gestern mischen');
  assert.equal(regime.schema, 'findash-druckenmiller/v1');
  assert.equal(meta.schema, 'findash-druckenmiller/v1');
  assert.equal(W.ALLE_DATEIEN.length, 4,
    'der Vertrag kennt vier Dateien — dass heute zwei fehlen, ist der stale-by-design-Zustand');
});

test('W2 KERN (Rat D3): regime.json traegt die rohen Legs und NIRGENDS einen Zustand', () => {
  const w = welt();
  W.writeExport(opts(w));
  const regime = liesJson(path.join(w.exportDir, 'regime.json'));
  const text = JSON.stringify(regime);
  for (const verboten of ['"state"', 'RISK_ON', 'RISK_OFF', 'crashWarning', '"rInt"']) {
    assert.ok(!text.includes(verboten),
      'regime.json enthaelt ' + verboten + ' — Rat D3 verbietet den veroeffentlichten Zustand, '
      + 'und R-INT bleibt geloggt statt ausgeliefert');
  }
  const letzte = regime.series[regime.series.length - 1];
  for (const feld of ['date', 'l1', 'l2', 'l3', 'l4ew', 'l4cw', 'l4Unassigned', 'l4b', 'l5', 'l6',
    'backfilled', 'barDateMode', 'mixedBarDateShare', 'freshShare', 'lowFreshness',
    'nUniverse', 'nEntered', 'nLeft', 'highChurn']) {
    assert.ok(Object.prototype.hasOwnProperty.call(letzte, feld), 'Feld ' + feld + ' fehlt in der Serie');
  }
  assert.equal(regime.asOf, w.tage[w.tage.length - 1]);
  assert.ok(Array.isArray(regime.sectorRs) && regime.sectorRs.length >= 1, 'L7-Tabelle fehlt');
  assert.ok(regime.sectorRs.every((r) => r.sector && Number.isFinite(r.rs63) && Number.isInteger(r.rank)));
});

test('W3 die Serie ist aufsteigend, gedeckelt und endet auf asOf', () => {
  const w = welt();
  W.writeExport(opts(w));
  const regime = liesJson(path.join(w.exportDir, 'regime.json'));
  const daten = regime.series.map((r) => r.date);
  assert.deepEqual(daten, daten.slice().sort(), 'die Serie ist nicht aufsteigend');
  assert.equal(daten[daten.length - 1], regime.asOf);
  assert.ok(W.SERIES_MAX === 504, 'der Deckel ist der Vertrag (arch-spec §3.2: letzte 504 Zeilen)');
  // Deckel-Bruchprobe ohne 504 Fixture-Tage: die Funktion selbst bekommt zu viele Zeilen.
  const viele = [];
  for (let i = 0; i < 600; i++) viele.push(Object.assign({}, regime.series[0], { date: '3000-' + String(i).padStart(4, '0') }));
  assert.equal(W.begrenze(viele).length, 504, 'der Deckel greift nicht');
  assert.equal(W.begrenze(viele)[503].date, viele[599].date, 'gekappt wird VORNE, nicht hinten');
});

test('W4 Churn: Ein- und Austritte gegen den vorigen Publikationstag, Tor bei 5 %', () => {
  // Tag 3 tauscht 2 von 10 Mitgliedern aus -> (1 rein + 1 raus) / 10 = 20 % > 5 %.
  const w = welt({ mitglieder: {
    '2026-09-07': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    '2026-09-08': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    '2026-09-09': [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
    '2026-09-10': [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
  } });
  W.writeExport(opts(w));
  const s = liesJson(path.join(w.exportDir, 'regime.json')).series;
  const nach = (d) => s.find((r) => r.date === d);
  assert.equal(nach('2026-09-07').nEntered, null, 'der erste Tag hat keinen Vortag — null, nicht 0');
  assert.equal(nach('2026-09-07').highChurn, null);
  assert.equal(nach('2026-09-08').nEntered, 0);
  assert.equal(nach('2026-09-08').nLeft, 0);
  assert.equal(nach('2026-09-08').highChurn, false);
  assert.equal(nach('2026-09-09').nEntered, 1, 'T11 ist neu in U');
  assert.equal(nach('2026-09-09').nLeft, 1, 'T10 ist raus');
  assert.equal(nach('2026-09-09').highChurn, true, '2 von 10 sind 20 % — weit ueber dem 5-%-Tor');
  assert.equal(nach('2026-09-10').highChurn, false);
  assert.equal(nach('2026-09-10').nUniverse, 10);
});

test('W5 die Abdeckung wird aus den Roh-Zeilen gerechnet UND gegen die Reihe gegengeprueft', () => {
  const w = welt();
  W.writeExport(opts(w));
  const meta = liesJson(path.join(w.exportDir, 'meta.json'));
  const letzte = w.history[w.history.length - 1];
  assert.ok(meta.coverage && Object.keys(meta.coverage).length >= 8, 'keine Abdeckung je Achse');
  // Die drei Achsen, die die Reihe selbst mitschreibt, MUESSEN uebereinstimmen — sonst
  // rechnen Roh-Datei und Ledger-Zeile ueber verschiedene Mengen.
  for (const [achse, ausDerReihe] of [['l1', letzte.l1Coverage], ['l3', letzte.l3Coverage], ['l5', letzte.l5Coverage]]) {
    assert.ok(Math.abs(meta.coverage[achse] - ausDerReihe) < 1e-12,
      'Abdeckung ' + achse + ': aus Roh ' + meta.coverage[achse] + ', aus der Reihe ' + ausDerReihe);
  }
  assert.equal(meta.coverage.l6, 1, 'L6 ist da (spyState BULL) — also volle Abdeckung');
  assert.ok(meta.coverage.l2 > 0.9);
});

test('W6 meta: paramsHash ist der Hash von Datei A, und der naechste Lauf steht im CI-Kalender', () => {
  const w = welt();
  W.writeExport(opts(w));
  const meta = liesJson(path.join(w.exportDir, 'meta.json'));
  const dateiA = path.join(PROTOCOL, 'druckenmiller_loggers_registered_20260914.json');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(dateiA, 'utf8'), 'utf8').digest('hex');
  assert.equal(meta.paramsHash, hash, 'paramsHash ist nicht der Hash der Registrierung');
  assert.equal(meta.ledgerRows.internals, w.history.length);
  assert.equal(meta.ledgerRows.candidates, 0, 'das Kandidaten-Ledger entsteht in Chunk 2');
  assert.equal(meta.ledgerGapDays, 0);
  assert.equal(meta.universeHash, w.history[w.history.length - 1].universeHash);
  assert.equal(meta.duquesne13fCoverage, null, 'Chunk 3 fuellt das — bis dahin null, nie 0');
  assert.ok(meta.overrideNote && meta.overrideNote.sha256 && meta.overrideNote.text.length > 40,
    'der gehashte Override-Vermerk (Rat D1) fehlt');
  assert.equal(meta.universe.withBars250, w.history[w.history.length - 1].universeSize);
  assert.ok(meta.label.length > 100 && meta.mandate.includes('never in the score'));
  // expectedNextRun: naechster Cron-Slot NACH generated_at (Di-Sa 02:17 UTC).
  assert.equal(W.nextRunAfter('2026-09-14T03:00:00Z'), '2026-09-15T02:17:00.000Z', 'So 03:00 -> Di? nein: Mo');
  assert.equal(W.nextRunAfter('2026-09-14T01:00:00Z'), '2026-09-15T02:17:00.000Z');
  assert.equal(W.nextRunAfter('2026-09-12T01:00:00Z'), '2026-09-12T02:17:00.000Z', 'Samstag frueh -> heute');
  assert.equal(W.nextRunAfter('2026-09-12T03:00:00Z'), '2026-09-15T02:17:00.000Z', 'Sa nach dem Slot -> Di');
  assert.ok(new Date(meta.expectedNextRun).getTime() > new Date(meta.generated_at).getTime());
});

test('W7 der Cron im Workflow und die Konstante des Schreibers sind dieselbe Zahl', () => {
  // Sonst zeigt expectedNextRun auf einen Slot, den es nicht gibt, und findashs
  // "missed run"-Flag (Vertrag §12) feuert entweder nie oder dauernd.
  const yml = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'daily-pull.yml'), 'utf8');
  assert.ok(yml.includes("cron: '" + W.CRON + "'") || yml.includes('cron: "' + W.CRON + '"'),
    'der Workflow faehrt nicht mehr auf ' + W.CRON + ' — expectedNextRun luegt ab jetzt');
});

test('W8 --check ist gruen auf einem frisch geschriebenen Paar', () => {
  const w = welt();
  W.writeExport(opts(w));
  assert.equal(W.checkExport(opts(w)), 0);
  assert.ok(!fs.existsSync(path.join(w.exportDir, '_FAILED.json')), 'gruen und trotzdem ein Marker');
});

/** Kaputtmachen und pruefen: --check muss 1 liefern UND den Ordner auf einen Marker ziehen. */
function rotErwartet(w, was) {
  const rc = W.checkExport(opts(w));
  assert.equal(rc, 1, was + ': --check meldet gruen');
  const marker = path.join(w.exportDir, '_FAILED.json');
  assert.ok(fs.existsSync(marker), was + ': kein _FAILED.json geschrieben');
  const m = liesJson(marker);
  assert.equal(m.schema, 'findash-druckenmiller/v1');
  assert.ok(m.reason && m.reason.length > 10, was + ': der Marker nennt keinen Grund');
  assert.ok(m.generated_at && m.failedAt, was + ': dem Marker fehlt generated_at/failedAt');
  assert.match(m.failedAt, /write-druckenmiller-export/,
    was + ': der Marker nennt den falschen Verursacher — seit Chunk 1 schreiben ihn zwei '
    + 'verschiedene Schritte, und der Name schickt die Suche in die richtige Datei');
  assert.deepEqual(fs.readdirSync(w.exportDir), ['_FAILED.json'],
    was + ': neben dem Marker liegen noch Datendateien — genau die Mischung, die der Vertrag verbietet');
  return m;
}

test('W9 --check ROT: ein fehlendes Pflichtfeld', () => {
  const w = welt();
  W.writeExport(opts(w));
  const p = path.join(w.exportDir, 'regime.json');
  const j = liesJson(p);
  delete j.series[2].l3;
  fs.writeFileSync(p, JSON.stringify(j));
  const m = rotErwartet(w, 'fehlendes Feld');
  assert.match(m.reason, /l3/);
});

test('W10 --check ROT: eine nicht endliche Zahl', () => {
  const w = welt();
  W.writeExport(opts(w));
  const p = path.join(w.exportDir, 'regime.json');
  // JSON kann kein NaN tragen — genau deshalb ist der gefaehrliche Fall der, in dem
  // etwas anderes als eine Zahl an der Stelle einer Zahl steht.
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('"l1":', '"l1": "NaN", "l1_alt":'));
  const m = rotErwartet(w, 'NaN');
  assert.match(m.reason, /l1/);
});

test('W11 --check ROT: ein Loch in der Reihe', () => {
  const w = welt();
  W.writeExport(opts(w));
  const meta = path.join(w.exportDir, 'meta.json');
  const j = liesJson(meta);
  j.ledgerGapDays = 2;
  fs.writeFileSync(meta, JSON.stringify(j));
  const m = rotErwartet(w, 'Luecke');
  assert.match(m.reason, /Handelstag|Luecke|ledgerGapDays/i);
});

test('W12 --check ROT: die Reihe ist geschrumpft', () => {
  const w = welt();
  W.writeExport(opts(w));
  const zeilen = fs.readFileSync(w.ledgerFile, 'utf8').trim().split('\n');
  fs.writeFileSync(w.ledgerFile, zeilen.slice(0, 2).join('\n') + '\n'); // Sidecar sagt weiter 4
  const m = rotErwartet(w, 'Schrumpfen');
  assert.match(m.reason, /geschrumpft|schrumpf/i);
});

test('W13 --check ROT: die Hash-Kette der Reihe ist gebrochen', () => {
  const w = welt();
  W.writeExport(opts(w));
  const zeilen = fs.readFileSync(w.ledgerFile, 'utf8').trim().split('\n');
  const z = JSON.parse(zeilen[1]); z.l1 = 0.999; zeilen[1] = JSON.stringify(z);
  fs.writeFileSync(w.ledgerFile, zeilen.join('\n') + '\n');
  const m = rotErwartet(w, 'Kettenbruch');
  assert.match(m.reason, /Kette|Sidecar/i);
});

test('W14 --check ROT: der Hash der Registrierung passt nicht mehr (paramsHash)', () => {
  const w = welt();
  W.writeExport(opts(w));
  const p = path.join(w.exportDir, 'meta.json');
  const j = liesJson(p);
  j.paramsHash = 'a'.repeat(64);
  fs.writeFileSync(p, JSON.stringify(j));
  const m = rotErwartet(w, 'paramsHash');
  assert.match(m.reason, /paramsHash|Registrierung/i);
});

test('W15 --check ROT: zwei verschiedene generated_at', () => {
  const w = welt();
  W.writeExport(opts(w));
  const p = path.join(w.exportDir, 'meta.json');
  const j = liesJson(p);
  j.generated_at = new Date(Date.parse(j.generated_at) + 90000).toISOString();
  fs.writeFileSync(p, JSON.stringify(j));
  const m = rotErwartet(w, 'generated_at');
  assert.match(m.reason, /generated_at/);
});

test('W16 --check ROT: der Export ist aelter als die Reihe (Schlepp-Kante)', () => {
  // Der Fall aus der CI: der scoring-Job checkt den Trigger-Commit aus und saehe ohne
  // das Ledger-Artefakt IMMER den Stand von gestern. Der Waechter-Job hat beide Seiten.
  const w = welt();
  W.writeExport(opts(w));
  const p = path.join(w.exportDir, 'regime.json');
  const j = liesJson(p);
  j.asOf = w.tage[w.tage.length - 2];
  j.series.pop();
  fs.writeFileSync(p, JSON.stringify(j));
  const m = rotErwartet(w, 'Schlepp-Kante');
  assert.match(m.reason, /asOf|letzte/i);
});

test('W17 --check ROT: ein vorgefundener Marker ist selbst der Befund — und bleibt WOERTLICH stehen', () => {
  // REVIEW-FUND: der Pruefer schrieb den Marker neu und ersetzte damit den urspruenglichen
  // `reason` durch "es liegt ein Marker". Die Annotation des Waechter-Jobs nannte danach
  // nicht mehr die Ursache, sondern nur noch ihre Folge.
  const w = welt();
  W.writeExport(opts(w));
  const original = {
    schema: 'findash-druckenmiller/v1', generated_at: '2026-09-13T02:20:00.000Z',
    reason: 'die Reihe ist von 87 auf 10 Zeilen geschrumpft', failedAt: 'druckenmiller-log-internals --check',
  };
  fs.writeFileSync(path.join(w.exportDir, '_FAILED.json'), JSON.stringify(original));
  assert.equal(W.checkExport(opts(w)), 1, 'ein liegender Marker meldet gruen');
  assert.deepEqual(fs.readdirSync(w.exportDir), ['_FAILED.json'],
    'neben dem Marker liegen noch Datendateien');
  assert.deepEqual(liesJson(path.join(w.exportDir, '_FAILED.json')), original,
    'der urspruengliche Grund wurde ueberschrieben — die Spur zur Ursache ist weg');
});

test('W17b --check ROT: eine strukturfremde Datei wirft NICHT am Marker-Vertrag vorbei', () => {
  // REVIEW-FUND (beide Reviewer, reproduziert): jede Pruefung fuehrte ueber rot() zum Marker,
  // der RUMPF von checkExport aber nicht. Gueltiges JSON in fremder Form (null, falsch
  // verschachtelt) warf eine TypeError vorbei am Vertrag: Exit 1, kein Marker — und im
  // scoring-Job schluckt `|| true` den Exit-Code, der Deploy nimmt den kaputten Stand mit.
  for (const [was, mach] of [
    ['regime.json ist null', (w) => fs.writeFileSync(path.join(w.exportDir, 'regime.json'), 'null')],
    ['meta.json ist null', (w) => fs.writeFileSync(path.join(w.exportDir, 'meta.json'), 'null')],
    ['eine Serien-Zeile ist null', (w) => {
      const f = path.join(w.exportDir, 'regime.json');
      const j = liesJson(f); j.series[0] = null; fs.writeFileSync(f, JSON.stringify(j));
    }],
    ['ledgerRows ist null', (w) => {
      const f = path.join(w.exportDir, 'meta.json');
      const j = liesJson(f); j.ledgerRows = null; fs.writeFileSync(f, JSON.stringify(j));
    }],
  ]) {
    const w = welt();
    W.writeExport(opts(w));
    mach(w);
    assert.equal(W.checkExport(opts(w)), 1, was + ': --check meldet gruen');
    assert.deepEqual(fs.readdirSync(w.exportDir), ['_FAILED.json'],
      was + ': kein Marker — der Vertrag ist an dieser Stelle offen');
    const m = liesJson(path.join(w.exportDir, '_FAILED.json'));
    assert.ok(m.reason && m.reason.length > 10, was + ': der Marker nennt keinen Grund');
  }
});

test('W17c --check ROT: eine unlesbare Chunk-2/3-Datei wird nicht uebersprungen', () => {
  // REVIEW-FUND: `catch { continue; }` in der generated_at-Schleife. Eine kaputte
  // candidates.json waere still uebersprungen worden und mit dem Deploy gefahren.
  const w = welt();
  W.writeExport(opts(w));
  fs.writeFileSync(path.join(w.exportDir, 'candidates.json'), '{kaputt');
  assert.equal(W.checkExport(opts(w)), 1, 'eine unlesbare Vertragsdatei laeuft durch');
  const m = liesJson(path.join(w.exportDir, '_FAILED.json'));
  assert.match(m.reason, /candidates\.json/);
});

test('W17d --check ROT: zwei Dateien mit demselben null-Stempel', () => {
  // REVIEW-FUND: geprueft wurde nur die GLEICHHEIT der Stempel. Zwei Dateien mit
  // generated_at: null haben denselben Stempel — und liefen gruen durch.
  const w = welt();
  W.writeExport(opts(w));
  for (const f of ['regime.json', 'meta.json']) {
    const p = path.join(w.exportDir, f);
    const j = liesJson(p); j.generated_at = null; fs.writeFileSync(p, JSON.stringify(j));
  }
  assert.equal(W.checkExport(opts(w)), 1, 'null als Stempel laeuft durch');
  assert.match(liesJson(path.join(w.exportDir, '_FAILED.json')).reason, /generated_at/);
});

test('W18 --check ROT: gar kein Export (der Schreiber ist gar nicht gelaufen)', () => {
  const w = welt();
  fs.mkdirSync(w.exportDir, { recursive: true });
  const m = rotErwartet(w, 'kein Export');
  assert.match(m.reason, /regime\.json/);
});

test('W19 der Schreiber schreibt NIE eine nicht endliche Zahl', () => {
  const w = welt();
  // Eine Roh-Datei mit einer kaputten Zahl: der Churn-Nenner wird 0 und ein naiver
  // Anteil waere NaN. assertFinite muss VOR dem Schreiben zuschlagen.
  const leer = path.join(w.rawDir, w.tage[w.tage.length - 1] + '.jsonl.gz');
  fs.writeFileSync(leer, zlib.gzipSync(Buffer.from('\n', 'utf8')));
  let fehler = null;
  try { W.writeExport(opts(w)); } catch (e) { fehler = e; }
  const regime = fs.existsSync(path.join(w.exportDir, 'regime.json'))
    ? liesJson(path.join(w.exportDir, 'regime.json')) : null;
  if (regime) {
    const text = JSON.stringify(regime);
    assert.ok(!text.includes('NaN') && !text.includes('Infinity'), 'NaN im Export');
    const letzte = regime.series[regime.series.length - 1];
    assert.ok(letzte.highChurn === null || typeof letzte.highChurn === 'boolean');
    assert.ok(letzte.nEntered === null || Number.isInteger(letzte.nEntered));
  } else {
    assert.ok(fehler, 'weder geschrieben noch geworfen — der Fehler ist still verschwunden');
  }
});

test('W19b --check ROT: l6 traegt etwas anderes als einen Zustandsnamen', () => {
  // L6 ist eine Kopie aus einer FREMDEN Datei. Ohne eigene Typpruefung waere es das
  // einzige Serien-Feld, in das eine Zahl oder ein Objekt unbemerkt durchliefe.
  const w = welt();
  W.writeExport(opts(w));
  const p = path.join(w.exportDir, 'regime.json');
  const j = liesJson(p);
  j.series[1].l6 = 3;
  fs.writeFileSync(p, JSON.stringify(j));
  const m = rotErwartet(w, 'l6-Typ');
  assert.match(m.reason, /l6/);
});

test('W21 REVIEW-FUND H1: Churn wird NIE ueber ein Loch hinweg gerechnet', () => {
  // Faellt die Roh-Datei eines mittleren Tages aus, verglich der Folgetag gegen eine zwei
  // Sitzungen alte Menge — und das Ergebnis stand als Tagesdifferenz in der Auslieferung.
  // Beide Fehlrichtungen waren teuer: ein ruhiger Tag wurde als highChurn ausgeschlossen,
  // ein Hin-und-Zurueck-Tausch als ruhig durchgelassen (der speist dann Quantile).
  const w = welt({ mitglieder: {
    '2026-09-07': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    '2026-09-08': [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],   // 20 % Umschlag
    '2026-09-09': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],   // und wieder zurueck: auch 20 %
    '2026-09-10': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  } });
  fs.rmSync(path.join(w.rawDir, '2026-09-08.jsonl.gz'));   // der mittlere Tag faellt aus
  W.writeExport(opts(w));
  const s2 = liesJson(path.join(w.exportDir, 'regime.json')).series;
  const nach = (d) => s2.find((r) => r.date === d);
  assert.equal(nach('2026-09-08').highChurn, null, 'der Tag ohne Roh-Datei bekommt trotzdem einen Churn');
  assert.equal(nach('2026-09-09').nEntered, null,
    'der FOLGETAG wurde gegen eine zwei Sitzungen alte Menge verglichen — 09-09 gegen 09-07 ist '
    + 'identisch (0 Umschlag) und haette den echten 20-%-Tausch als ruhig durchgelassen');
  assert.equal(nach('2026-09-09').highChurn, null);
  assert.equal(nach('2026-09-10').nEntered, 0, 'ab dem naechsten vollstaendigen Paar zaehlt es wieder');
  const meta = liesJson(path.join(w.exportDir, 'meta.json'));
  assert.equal(meta.churnUnavailableDays, 2,
    'gezaehlt gehoeren BEIDE: der Tag ohne Roh-Datei und der, dem dadurch der Vortag fehlt');
});

test('W22 REVIEW-FUND: ein 1:1-Tausch ist groessengleich — verglichen wird der Mengen-Hash', () => {
  const w = welt();
  // Ein Ticker wird in der Roh-Datei des juengsten Tages ausgetauscht: gleiche Anzahl,
  // andere Menge. Ein reiner Groessenvergleich haette das nie gesehen.
  const f = path.join(w.rawDir, w.tage[w.tage.length - 1] + '.jsonl.gz');
  const zeilen = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n');
  const erste = JSON.parse(zeilen[0]); erste.ticker = 'TAUSCH';
  zeilen[0] = JSON.stringify(erste);
  fs.writeFileSync(f, zlib.gzipSync(Buffer.from(zeilen.join('\n') + '\n', 'utf8')));
  assert.throws(() => W.writeExport(opts(w)), /verschiedene Mengen/,
    'ein groessengleicher Tausch zwischen Roh-Datei und Reihe laeuft durch');
});

test('W23 die Abdeckung eines Widerspruchs wird nicht mehr weggewarnt', () => {
  // Dieselbe Beweislage wie beim Churn (dort wirft der Lauf) hatte eine andere Konsequenz:
  // eine Warnung, und veroeffentlicht wurde die Zahl der Reihe. Unter 0,6 wird die Achse
  // ausgegraut — eine falsche Abdeckung gibt einer kaputten Achse still eine Stimme.
  const w = welt();
  const letzterTag = w.tage[w.tage.length - 1];
  const f = path.join(w.rawDir, letzterTag + '.jsonl.gz');
  const zeilen = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n')
    .map((l) => JSON.parse(l));
  zeilen[0].sma200 = null;                       // dieselbe Menge, andere Abdeckung
  fs.writeFileSync(f, zlib.gzipSync(Buffer.from(
    zeilen.map((z) => JSON.stringify(z)).join('\n') + '\n', 'utf8')));
  assert.throws(() => W.writeExport(opts(w)), /Abdeckung l1/,
    'ein Widerspruch zwischen Roh-Datei und Reihe wird nur gewarnt statt geworfen');
});

test('W24 null heisst "nicht gemessen": l6 ohne Zustand ist keine Abdeckung von 0', () => {
  const w = welt({ });
  // Eine Welt ohne SPY-Zustand: buildRow bekommt spyState null.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-l6-'));
  const outDir = path.join(dir, 'druckenmiller-history');
  const rawDir = path.join(outDir, 'raw');
  const zeilen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => tickerZeile(i, { lastBarDate: '2026-09-07' }));
  schreibeRoh(rawDir, '2026-09-07', zeilen);
  const row = internals.buildRow({
    date: '2026-09-07', rawRows: zeilen, backfilled: false, spyState: null, spyRet63: 0.01,
    iwmRet63: 0.02, prevRow: null, history: [], snapshotUnreadable: 0, now: new Date('2026-09-14T02:17:00Z'),
  });
  ledgerLib.appendRow(path.join(outDir, 'internals-ledger.jsonl'), row);
  const shard = { SPY: [{ date: '2026-09-07', close: 500 }] };
  fs.mkdirSync(path.join(dir, 'prices', 'history'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'prices', 'history',
    'history-' + String(store.shardOf('SPY')).padStart(2, '0') + '.json'), JSON.stringify(shard));
  const exportDir = path.join(dir, 'ex');
  W.writeExport({ outDir, exportDir, pricesDir: path.join(dir, 'prices'), protocolDir: PROTOCOL, log: still });
  const meta = liesJson(path.join(exportDir, 'meta.json'));
  assert.equal(meta.coverage.l6, null,
    'ein fehlendes L6 ist "nicht gemessen" (null), keine Abdeckung von null Prozent — '
    + 'die 60-%-Regel wuerde sonst eine nie gemessene Achse als schlecht abgedeckt ausweisen');
  assert.equal(meta.coverage.l1, 1);
  void w;
});

test('W25 ein kaputtes l7 wird nicht als leere Sektor-Tabelle ausgeliefert', () => {
  assert.throws(() => W.pruefeSectorRs({ date: '2026-09-11', l7: null }), /kein Array/);
  assert.throws(() => W.pruefeSectorRs({ date: '2026-09-11', l7: 'kaputt' }), /kein Array/);
  assert.deepEqual(W.pruefeSectorRs({ date: '2026-09-11', l7: [] }), [],
    'eine leere Tabelle ist ein BEFUND (kein Sektor messbar) und muss durchgehen');
});

test('W26 SERIES_FIELDS haengt an LEDGER_ROW_FIELDS — ein Tippfehler waere sonst still', () => {
  // baueRegime macht aus einem unbekannten Namen null. Ein umbenanntes Ledger-Feld haette
  // die Achse fuer immer als "nicht gemessen" veroeffentlicht, und --check haette null
  // akzeptiert (es ist ja ein erlaubter Wert).
  const eigene = ['nUniverse', 'nEntered', 'nLeft', 'highChurn'];   // entstehen im Schreiber
  const fehlend = W.SERIES_FIELDS.filter((f) => !eigene.includes(f)
    && !internals.LEDGER_ROW_FIELDS.includes(f));
  assert.deepEqual(fehlend, [],
    'diese Serien-Felder gibt es in der Ledger-Zeile nicht (mehr) und wuerden dauerhaft als '
    + 'null ausgeliefert: ' + fehlend.join(', '));
  assert.ok(W.SERIES_FIELDS.length > 20, 'die Feldliste wurde nicht wirklich gelesen');
});

test('W27 der Cron-Slot wird AUS dem Cron gelesen, nicht daneben nochmal hingeschrieben', () => {
  // Vorher standen Stunde, Minute und Wochentage ein zweites Mal als Literale in
  // nextRunAfter. Cron aendern + Konstante nachziehen waere gruen geblieben, und
  // expectedNextRun (und mit ihm findashs "missed run"-Flag) dauerhaft falsch.
  assert.equal(W.nextRunAfter('2026-09-14T03:00:00Z', '17 3 * * 2-6'), '2026-09-15T03:17:00.000Z');
  assert.equal(W.nextRunAfter('2026-09-14T03:00:00Z', '0 6 * * 1-5'), '2026-09-14T06:00:00.000Z');
  assert.throws(() => W.nextRunAfter('2026-09-14T03:00:00Z', '*/5 * * * *'), /Form/,
    'ein Cron, den diese Funktion nicht lesen kann, muss laut werden statt zu raten');
  assert.deepEqual(W.cronSlot(W.CRON), { minute: 17, stunde: 2, vonTag: 2, bisTag: 6 });
});

test('W28 ein Flag ohne Wert arbeitet nicht im falschen Ordner', () => {
  // `--out --check` machte aus dem Flag einen Pfad und zog danach den ECHTEN
  // Default-Export-Ordner auf einen Marker zusammen.
  assert.throws(() => W.main(['--out', '--check'], still), /ohne Wert/);
  assert.throws(() => W.main(['--check', '--export-dir'], still), /ohne Wert/);
});

test('W29 eine kaputte HISTORISCHE Roh-Datei haelt die Auslieferung nicht an', () => {
  // Eine halb geschriebene gz-Datei von vor einem Jahr riss vorher jede weitere
  // Auslieferung mit. Der Tag steht laengst in der Reihe — der Churn ist unbekannt, mehr nicht.
  const w = welt();
  fs.writeFileSync(path.join(w.rawDir, w.tage[1] + '.jsonl.gz'), Buffer.from('kein gzip', 'utf8'));
  assert.equal(W.writeExport(opts(w)), 0, 'eine kaputte Datei von damals haelt heute an');
  const meta = liesJson(path.join(w.exportDir, 'meta.json'));
  assert.ok(meta.churnUnavailableDays >= 2, 'der Ausfall wird nicht gezaehlt');
  assert.equal(W.checkExport(opts(w)), 0);
  // Aber am juengsten Tag ist dieselbe Datei ein Wurf — dort ist das Tor sonst blind.
  const w2 = welt();
  fs.writeFileSync(path.join(w2.rawDir, w2.tage[w2.tage.length - 1] + '.jsonl.gz'), Buffer.from('x', 'utf8'));
  assert.throws(() => W.writeExport(opts(w2)), /juengsten Tag/);
});

test('W20 stale-by-design: der Vertrag nennt vier Dateien und Chunk 1 sagt, warum zwei fehlen', () => {
  const doc = fs.readFileSync(path.join(REPO, 'docs', 'findash-export-v1.md'), 'utf8');
  assert.ok(doc.includes('druckenmiller/'), 'der Vertrag hat keinen Druckenmiller-Abschnitt');
  assert.ok(/_FAILED\.json/.test(doc), 'der _FAILED.json-Vertrag steht nicht in der Doku');
  assert.ok(/stale/i.test(doc) && /generated_at/.test(doc));
  for (const f of W.ALLE_DATEIEN) {
    assert.ok(doc.includes(f), 'die Doku nennt ' + f + ' nicht — der Leser kann die Vierer-Regel nicht pruefen');
  }
});

console.log('\nwrite-export.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
