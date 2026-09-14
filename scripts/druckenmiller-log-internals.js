#!/usr/bin/env node
'use strict';
/**
 * scripts/druckenmiller-log-internals.js — der taegliche Mitschrieb der Marktinnereien
 * (Druckenmiller-Modul, Chunk 0; Rat-Verdikt D2 vom 2026-09-14: "Ja, sofort — jeder Tag verfaellt").
 *
 * WO ER LAEUFT: im merge-Job, direkt nach `node scripts/update-ath-state.js`
 * (daily-pull.yml:1160). Dort liegen beide Quellen bereits auf der Platte: der rollende
 * 400-Tage-Preis-Store (prices/history, 32 Shards) und die gefilterten snapshots/. Der
 * Export (outputs/findash-export/v1/full) entsteht erst im scoring-Job und ist hier
 * NICHT verfuegbar (outputs/ ist gitignored) — siehe lib/druckenmiller/universe.js zur
 * Herkunft von U und warum die Roh-Zeilen je Ticker mitgeschrieben werden.
 *
 * MODI
 *   (ohne)      eine Zeile fuer die neueste Sitzung; verpasste Sitzungen seit der letzten
 *               Zeile werden nachgetragen und als backfilled markiert.
 *   --backfill  Einmal-Saat: ALLE aus dem rollenden Fenster noch rueckrechenbaren
 *               Sitzungen (>= 250 Balken davor), alle bis auf die neueste als backfilled.
 *   --check     WAECHTER (Exit 1 bei Befund, fuer den CI-Schritt OHNE continue-on-error):
 *               Kette gebrochen · Reihe geschrumpft · Loch in der Reihe (ledgerGapDays)
 *               · Reihe stehengeblieben (staleSessions) · gar kein Ledger.
 *
 * WARUM --check EIN EIGENER LAUF IST (Anklage A1, Gericht 2026-09-14): der Schreib-Schritt
 * ist fail-soft (continue-on-error), damit ein Logger-Absturz Karls Datenlauf nicht
 * anhaelt. Ein Waechter unter continue-on-error kann aber nichts rot machen. Also zwei
 * Schritte: schreiben fail-soft, pruefen scharf — und der scharfe steht NACH dem
 * Daten-Commit, damit ein Alarm nichts wegwirft (dasselbe Muster wie die
 * M1/M9-Persistenz-Wache in daily-pull.yml).
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const store = require('../lib/price-history-store.js');
const universe = require('../lib/druckenmiller/universe.js');
const internals = require('../lib/druckenmiller/internals.js');
const ledgerLib = require('../lib/druckenmiller/ledger.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PRICES = path.join(REPO_ROOT, 'prices');
const DEFAULT_SNAPSHOTS = path.join(REPO_ROOT, 'snapshots');
const DEFAULT_OUT = path.join(REPO_ROOT, 'druckenmiller-history');
const DEFAULT_MACRO = path.join(REPO_ROOT, 'outputs', 'macro-regime.json');
const LEDGER_NAME = 'internals-ledger.jsonl';
// Chunk-1-Vertrag, hier schon erfuellt: faellt eine INTEGRITAETS-Pruefung, wird der
// Export-Ordner nicht geloescht, sondern durch EINEN Marker ersetzt. Grund (Gericht,
// Wiederaufnahme): findash schreibt bei 404 nicht (data-layer/screener-sync.js:164-166)
// und zeigte sonst den Stand von gestern als heutigen an. Ein fehlender Ordner ist
// unsichtbar; ein Marker ist eine Aussage.
const DEFAULT_EXPORT = path.join(REPO_ROOT, 'outputs', 'findash-export', 'v1', 'druckenmiller');
const EXPORT_SCHEMA = 'findash-druckenmiller/v1';
const FAILED_NAME = '_FAILED.json';
const REFERENZ_TICKER = 'SPY';   // Sitzungskalender + L6/L7-Referenz
const KLEIN_TICKER = 'IWM';      // L4b Small-Cap-Bein [A-TEC-015]

/** Zahlen kurz halten: die Roh-Datei traegt 2.300 Zeilen pro Tag. */
const r6 = (x) => (Number.isFinite(x) ? Number(x.toPrecision(8)) : null);

function ledgerPfad(outDir) { return path.join(outDir, LEDGER_NAME); }

/** SPY-Serie = Sitzungskalender. Fehlt sie, entsteht KEINE Zeile (fail-loud). */
function sitzungen(pricesDir) {
  const shard = store.loadShard(pricesDir, store.shardOf(REFERENZ_TICKER));
  const serie = shard && shard[REFERENZ_TICKER];
  if (!Array.isArray(serie) || !serie.length) {
    throw new Error(`[druckenmiller] Keine ${REFERENZ_TICKER}-Serie in ${pricesDir} — ohne Referenz gibt es `
      + 'keinen Sitzungskalender. Eine Zeile mit selbstgebautem Kalender waere schlimmer als keine Zeile.');
  }
  return serie.map((b) => b.date).sort();
}

/**
 * L6: der SPY-Zustand des Tages, kopiert aus outputs/macro-regime.json.
 *
 * REVIEW-FUND: hier stand ein leeres catch. Eine fehlende, kaputte oder umbenannte Datei
 * haette L6 jahrelang auf null gehalten, ohne einen Laut. "Kein Regime FUER DIESEN TAG"
 * (legitim null) und "Datei unlesbar" (Defekt) sind verschiedene Dinge; der zweite Fall
 * meldet sich jetzt einmal je Lauf.
 */
function spyZustand(macroFile, datum, log) {
  if (!fs.existsSync(macroFile)) {
    if (log && !spyZustand._gemeldet) {
      spyZustand._gemeldet = true;
      log('::warning::[druckenmiller] ' + macroFile + ' fehlt — L6 (SPY-Zustand) bleibt fuer diesen '
        + 'Lauf leer. Die Datei entsteht im selben Job; fehlt sie dauerhaft, ist die Achse tot.');
    }
    return null;
  }
  let j;
  try { j = JSON.parse(fs.readFileSync(macroFile, 'utf8')); }
  catch (e) {
    if (log && !spyZustand._gemeldet) {
      spyZustand._gemeldet = true;
      log('::warning::[druckenmiller] ' + macroFile + ' ist nicht lesbar (' + e.message + ') — L6 '
        + 'bleibt leer. Das ist ein Defekt, kein fehlender Handelstag.');
    }
    return null;
  }
  const r = j && j.regimes && j.regimes[datum];
  return (r && r.regime) || null;
}

/**
 * EIN Durchgang ueber die Shards. Je Shard wird nur dieser eine geladen und danach
 * fallengelassen — der volle Store waere ein zweiter 400-MB-Abzug neben dem, den
 * update-ath-state.js im selben Job schon haelt.
 */
function metrikenSammeln(pricesDir, kandidaten, ziele) {
  const proShard = new Map();
  for (const ticker of kandidaten.keys()) {
    const n = store.shardOf(ticker);
    if (!proShard.has(n)) proShard.set(n, []);
    proShard.get(n).push(ticker);
  }
  // ziel -> ticker -> Roh-Zeile
  const jeZiel = new Map(ziele.map((d) => [d, []]));
  const referenz = {};
  for (const [n, tickers] of [...proShard.entries()].sort((a, b) => a[0] - b[0])) {
    const shard = store.loadShard(pricesDir, n);
    const teilKandidaten = new Map(tickers.map((t) => [t, kandidaten.get(t)]));
    const teilSerien = new Map();
    for (const t of tickers) if (shard[t]) teilSerien.set(t, shard[t]);
    for (const d of ziele) {
      for (const zeile of internals.perTickerRows(teilKandidaten, teilSerien, d)) jeZiel.get(d).push(zeile);
    }
  }
  for (const t of [REFERENZ_TICKER, KLEIN_TICKER]) {
    const shard = store.loadShard(pricesDir, store.shardOf(t));
    referenz[t] = shard && shard[t] ? shard[t] : null;
  }
  return { jeZiel, referenz };
}

function schreibeRoh(outDir, datum, zeilen) {
  const dir = path.join(outDir, 'raw');
  fs.mkdirSync(dir, { recursive: true });
  const text = zeilen.map((z) => JSON.stringify({
    ticker: z.ticker, sector: z.sector, industry: z.industry,
    marketCap: r6(z.marketCap), netRevision30: z.netRevision30,
    atSession: z.atSession, lastBarDate: z.lastBarDate, bars: z.bars,
    close: r6(z.close), sma50: r6(z.sma50), sma200: r6(z.sma200),
    high252: r6(z.high252), low252: r6(z.low252), ret63: r6(z.ret63),
  })).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, datum + '.jsonl.gz'), zlib.gzipSync(Buffer.from(text, 'utf8')));
}

function schreibeModus({ pricesDir, snapshotsDir, outDir, macroFile, backfill, log }) {
  const alle = sitzungen(pricesDir);
  const ledgerFile = ledgerPfad(outDir);
  const chain = ledgerLib.verifyChain(ledgerFile);
  if (!chain.ok) throw new Error(chain.error);
  const vorhandene = chain.rows;
  const letzte = vorhandene.length ? vorhandene[vorhandene.length - 1].date : null;

  // Rueckrechenbar ist eine Sitzung erst, wenn MIN_BARS Balken davor liegen.
  const rueckrechenbar = alle.slice(universe.MIN_BARS - 1);
  if (!rueckrechenbar.length) {
    log(`[druckenmiller] Der Store haelt erst ${alle.length} Sitzungen — U verlangt ${universe.MIN_BARS} Balken. Nichts zu tun.`);
    return 0;
  }
  let ziele = rueckrechenbar.filter((d) => !letzte || d > letzte);
  if (!letzte && !backfill) ziele = ziele.slice(-1);
  if (!ziele.length) {
    log('[druckenmiller] Kein neuer Handelstag seit ' + letzte + ' — nichts angehaengt.');
    return 0;
  }

  const kandidaten = universe.loadCandidates(snapshotsDir);
  if (!kandidaten.size) {
    throw new Error(`[druckenmiller] Kein einziger U-Kandidat in ${snapshotsDir} — das ist ein leerer oder `
      + 'falscher Snapshot-Ordner, keine Marktlage. Es wird nichts geschrieben.');
  }
  const { jeZiel, referenz } = metrikenSammeln(pricesDir, kandidaten, ziele);
  const neueste = ziele[ziele.length - 1];
  const history = vorhandene.slice();
  let geschrieben = 0;

  for (const d of ziele) {
    const roh = jeZiel.get(d);
    // REVIEW-FUND (reproduziert): hier stand ein `continue`. Der Lauf schrieb danach
    // SPAETERE Tage weiter — das Loch war damit fuer immer unfuellbar (appendRow verbietet
    // Rueckdatierung), der Waechter jeden Tag rot, und nach ~19 Monaten faellt der Tag aus
    // dem rollenden Fenster und alles ist wieder gruen, mit dem Loch drin. Eine Zeile ohne
    // Ticker ist eine ehrliche Aussage (alle Achsen null, nAtSession 0) und haelt die Reihe
    // zusammenhaengend. buildRow ist fuer den leeren Fall NaN-frei (Test I14).
    const imTag = roh.filter((z) => z.atSession);
    if (!imTag.length) {
      log(`::warning::[druckenmiller] ${d}: kein einziger Ticker hat einen Balken an diesem Tag. `
        + 'Die Zeile wird LEER geschrieben (alle Achsen null) statt uebersprungen — ein '
        + 'uebersprungener Tag waere ein Loch, das nie mehr zu fuellen ist.');
    }
    const refMetrik = (t) => {
      const s = referenz[t];
      if (!s) return null;
      const m = internals.tickerMetrics(s, d);
      return m ? m.ret63 : null;
    };
    const row = internals.buildRow({
      date: d,
      rawRows: roh,
      backfilled: d !== neueste,
      spyState: spyZustand(macroFile, d, log),
      spyRet63: refMetrik(REFERENZ_TICKER),
      iwmRet63: refMetrik(KLEIN_TICKER),
      prevRow: history.length ? history[history.length - 1] : null,
      history,
      snapshotUnreadable: kandidaten.unreadable,
    });
    // REVIEW-FUND: die Reihenfolge war umgekehrt. Scheiterte das Schreiben der Roh-Datei
    // (Platte voll, Pfad), stand die Ledger-Zeile schon und wurde nie wiederholt — die
    // Nachrechenbarkeit dieses Tages waere fuer immer weg. Andersherum ist der Ausfall
    // harmlos: eine verwaiste Roh-Datei ohne Ledger-Zeile schadet nichts und wird beim
    // naechsten Lauf ueberschrieben.
    schreibeRoh(outDir, d, roh);
    ledgerLib.appendRow(ledgerFile, row);
    history.push(row);
    geschrieben++;
  }
  const letzteZeile = history[history.length - 1];
  log(`[druckenmiller] ${geschrieben} Zeile(n) angehaengt (bis ${letzteZeile.date}) · U=${letzteZeile.universeSize}`
    + ` · am Sitzungstag=${letzteZeile.nAtSession} · L1=${letzteZeile.l1} · L2=${letzteZeile.l2}`
    + ` · mixedBarDateShare=${letzteZeile.mixedBarDateShare}`);
  return 0;
}

/**
 * Den Export-Ordner auf EINEN Fehlermarker zusammenziehen. Bewusst kein Loeschen: eine
 * verschwundene Datei ist beim Konsumenten ein 404, und ein 404 laesst dort den alten
 * Stand stehen. Der Marker faehrt mit dem Deploy und sagt, dass heute nichts gilt.
 */
function schreibeFehlermarker(exportDir, grund, log) {
  try {
    fs.mkdirSync(exportDir, { recursive: true });
    for (const f of fs.readdirSync(exportDir)) {
      if (f !== FAILED_NAME) fs.rmSync(path.join(exportDir, f), { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(exportDir, FAILED_NAME), JSON.stringify({
      schema: EXPORT_SCHEMA,
      generated_at: new Date().toISOString(),
      reason: grund,
      failedAt: 'druckenmiller-log-internals --check',
    }, null, 1) + '\n');
    log('[druckenmiller] ' + path.join(exportDir, FAILED_NAME) + ' geschrieben — der Konsument sieht '
      + 'damit, dass heute nichts gilt, statt den Stand von gestern fuer aktuell zu halten.');
  } catch (e) {
    log('::error::[druckenmiller] Fehlermarker nicht schreibbar: ' + e.message);
  }
}

/** Jede Zeile traegt genau die eingefrorenen Felder, und keine Zahl ist nicht-endlich. */
function pruefeZeilenForm(rows) {
  const pflicht = internals.LEDGER_ROW_FIELDS;
  for (const r of rows) {
    if (r.schema !== internals.SCHEMA) {
      return `Zeile ${r.date}: schema ist ${JSON.stringify(r.schema)}, erwartet `
        + `${JSON.stringify(internals.SCHEMA)} — zwei Schema-Staende in einer Reihe sind spaeter `
        + 'nicht mehr auseinanderzuhalten.';
    }
    for (const k of pflicht) {
      if (!Object.prototype.hasOwnProperty.call(r, k)) {
        return `Zeile ${r.date}: Feld ${k} fehlt — die Reihe ist spaeter nicht mehr auswertbar.`;
      }
    }
    let fund = null;
    (function walk(v, p) {
      if (fund) return;
      if (typeof v === 'number' && !Number.isFinite(v)) { fund = p; return; }
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, p + '[' + i + ']')); return; }
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p + '.' + k);
    })(r, 'row');
    if (fund) return `Zeile ${r.date}: ${fund} ist keine endliche Zahl.`;
  }
  return null;
}

function pruefModus({ pricesDir, outDir, exportDir, log }) {
  const ledgerFile = ledgerPfad(outDir);
  const rot = (grund) => {
    log('::error::' + grund);
    schreibeFehlermarker(exportDir, grund, log);
    return 1;
  };
  if (!fs.existsSync(ledgerFile)) {
    return rot('[druckenmiller] kein Ledger unter ' + ledgerFile + ' — der Logger hat in diesem Lauf '
      + 'nichts hinterlassen (fehlt auch der committete Stand, ist die Reihe gerissen).');
  }
  const chain = ledgerLib.verifyChain(ledgerFile);
  if (!chain.ok) return rot(chain.error);
  const meta = ledgerLib.readMeta(ledgerFile);
  const rows = chain.rows;
  if (meta && rows.length < meta.rows) {
    return rot(`[druckenmiller] Die Reihe ist von ${meta.rows} auf ${rows.length} Zeilen geschrumpft — `
      + 'eine append-only-Reihe schrumpft nie.');
  }
  const formFehler = pruefeZeilenForm(rows);
  if (formFehler) return rot('[druckenmiller] ' + formFehler);
  if (fs.existsSync(path.join(exportDir, FAILED_NAME))) {
    return rot('[druckenmiller] ' + path.join(exportDir, FAILED_NAME) + ' liegt vor — ein frueherer '
      + 'Schritt dieses Laufs hat den Export als ungueltig markiert.');
  }
  const alle = sitzungen(pricesDir);
  const luecken = ledgerLib.ledgerGapDays(rows, alle);
  const stehen = ledgerLib.staleSessions(rows, alle);
  const letzteZeile = rows.length ? rows[rows.length - 1] : null;
  const trueb = rows.filter((r) => r.lowFreshness === true).length;
  const zurueck = rows.filter((r) => r.backfilled === true).length;
  log(`[druckenmiller] rows=${rows.length} · ledgerGapDays=${luecken} · staleSessions=${stehen}`
    + ` · backfilledRows=${zurueck} · lowFreshnessRows=${trueb}`
    + ` · freshShare=${letzteZeile ? letzteZeile.freshShare : '-'}`
    + ` · letzte=${letzteZeile ? letzteZeile.date : '-'}`);
  if (luecken > 0) {
    return rot(`[druckenmiller] ${luecken} Handelstag(e) fehlen INNERHALB der Reihe. Sie sind nicht `
      + 'nachtragbar, sobald ihre Balken aus dem rollenden Fenster gefallen sind.');
  }
  if (stehen > 0) {
    return rot(`[druckenmiller] Die Reihe steht: ${stehen} Sitzung(en) mit Kursen im Store haben keine `
      + 'Zeile. Der Logger-Schritt ist fail-soft — genau dieser stille Ausfall wird hier laut.');
  }
  // FRISCHE-TOR ist GELB, nicht rot (Gericht, Wiederaufnahme 14.09.2026): ein
  // unvollstaendiger Kursabruf ist ein bekannter, haeufiger Zustand des Tageslaufs. Rot
  // hiesse, den ganzen Lauf an einer Sache anzuhalten, die die Reihe selbst schon
  // korrekt behandelt — die Zeile ist per lowFreshness aus jedem Quantil ausgeschlossen
  // und bleibt als ehrlicher Eintrag stehen. Sichtbar bleibt sie trotzdem: ::warning::
  // steht in der Job-Annotation und faehrt ueber den laufstatus-Marker mit.
  if (letzteZeile && letzteZeile.lowFreshness === true) {
    log(`::warning::[druckenmiller] Die Zeile vom ${letzteZeile.date} steht auf nur `
      + `${letzteZeile.freshShare} frischen Tickern (Schwelle ${internals.FRESH_MIN}). Sie ist als `
      + 'lowFreshness markiert und speist kein Quantil; der Kursabruf dieses Laufs war '
      + 'unvollstaendig. Die Reihe selbst ist in Ordnung — deshalb gelb, nicht rot.');
  }
  return 0;
}

function main(argv, log) {
  const args = argv || process.argv.slice(2);
  const say = log || console.log;
  const get = (k, dflt) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : dflt; };
  const opts = {
    pricesDir: path.resolve(get('--prices-dir', DEFAULT_PRICES)),
    snapshotsDir: path.resolve(get('--snapshots', DEFAULT_SNAPSHOTS)),
    outDir: path.resolve(get('--out', DEFAULT_OUT)),
    exportDir: path.resolve(get('--export-dir', DEFAULT_EXPORT)),
    macroFile: path.resolve(get('--macro', DEFAULT_MACRO)),
    backfill: args.includes('--backfill'),
    log: say,
  };
  return args.includes('--check') ? pruefModus(opts) : schreibeModus(opts);
}

module.exports = {
  main, schreibeModus, pruefModus, sitzungen, spyZustand, schreibeFehlermarker, pruefeZeilenForm,
  LEDGER_NAME, FAILED_NAME, EXPORT_SCHEMA,
};

if (require.main === module) {
  try { process.exit(main()); }
  catch (e) { console.error('::error::' + (e && e.message ? e.message : e)); process.exit(1); }
}
