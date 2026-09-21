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
const confirmation = require('../lib/druckenmiller/confirmation.js');
const scoreboard = require('../lib/druckenmiller/scoreboard.js');
const churnLib = require('../lib/druckenmiller/churn.js');
const rawLib = require('../lib/druckenmiller/raw.js');
const registrierungLib = require('../lib/druckenmiller/registration.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PRICES = path.join(REPO_ROOT, 'prices');
const DEFAULT_SNAPSHOTS = path.join(REPO_ROOT, 'snapshots');
const DEFAULT_OUT = path.join(REPO_ROOT, 'druckenmiller-history');
const DEFAULT_MACRO = path.join(REPO_ROOT, 'outputs', 'macro-regime.json');
const DEFAULT_PROTOCOL = path.join(REPO_ROOT, 'protocol');
const LEDGER_NAME = 'internals-ledger.jsonl';
// Chunk 2: der Kandidaten-Ledger liegt neben dem Innereien-Ledger und wird im selben
// Daten-Commit des merge-Jobs mitgenommen. EINE Zeile je Sitzung (appendRow laesst nur
// streng vorwaerts laufende Daten zu).
const KANDIDATEN_LEDGER = 'candidates-ledger.jsonl';
const REG_A_GLOB = /^druckenmiller_loggers_registered_\d{8}\.json$/;
const REG_B_GLOB = /^druckenmiller_scoreboard_registered_\d{8}\.json$/;
// Wie viele Balken hinter einem Eintritt der Logger im Speicher haelt, um ihn aufzuloesen:
// der laengste Arm plus Luft. Gesammelt wird nur fuer Ticker mit OFFENEN Eintraegen.
// (126 = laengster Arm, plus rund drei Monate Luft. Review-Fund: bei 140 reichte ein
// Betriebsausfall von drei Wochen, damit ein faelliger Eintrag aus dem Fenster fiel und NIE
// wieder hineinkam - der Schwanz wandert mit "heute" mit.)
const AUFLOESE_SCHWANZ = 190;
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
function metrikenSammeln(pricesDir, kandidaten, ziele, opts) {
  const beilage = opts && typeof opts.extra === 'function' ? opts.extra : null;
  const schwanzFuer = (opts && opts.tailsFor) || null;
  const schwaenze = new Map();
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
      for (const zeile of internals.perTickerRows(teilKandidaten, teilSerien, d, beilage)) jeZiel.get(d).push(zeile);
    }
    // Die Balken NACH einem Eintritt gibt es nur in diesem Durchgang — danach ist der Shard
    // wieder fallengelassen. Gesammelt wird der Schwanz ausschliesslich fuer Ticker mit
    // offenen Eintraegen, sonst waere es ein zweiter Abzug des halben Stores.
    if (schwanzFuer) {
      for (const t of tickers) {
        if (!schwanzFuer.has(t) || !teilSerien.has(t)) continue;
        const bars = teilSerien.get(t)
          .filter((b) => b && b.date && Number.isFinite(b.close) && b.close > 0)
          .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
        schwaenze.set(t, bars.slice(-AUFLOESE_SCHWANZ).map((b) => ({ date: b.date, close: b.close })));
      }
    }
  }
  for (const t of [REFERENZ_TICKER, KLEIN_TICKER]) {
    const shard = store.loadShard(pricesDir, store.shardOf(t));
    referenz[t] = shard && shard[t] ? shard[t] : null;
  }
  return { jeZiel, referenz, schwaenze };
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
    // Chunk 2: die Kennzahlen des Kursbestaetigungs-Zustands. Sie MUESSEN auf die Platte,
    // nicht nur in den Speicher — sonst kann niemand den Zustand eines alten Tages
    // nachrechnen, und candidates.json liefert m1/m2 als null (genau so gemessen
    // 2026-09-19: 2.197 Zeilen mit Zustand, alle ohne Kennzahl). Test L22.
    m1: r6(z.m1), m2: r6(z.m2), sigma63: r6(z.sigma63),
  })).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, datum + '.jsonl.gz'), zlib.gzipSync(Buffer.from(text, 'utf8')));
}


/**
 * Chunk 2 — die Kandidaten-Seite einer Sitzung: Zustaende, Trennungs-Tor, Churn-Sperre,
 * Eintraege und die Aufloesung faelliger Eintraege. EINE Zeile je Sitzung.
 *
 * WAS HIER NICHT PASSIERT: keine Bewertung, kein Ranking, keine MDE, kein Bootstrap (das
 * Lese-Modul wird hier nicht einmal importiert — Waechter G8). Und es wird NICHTS
 * aufgeloest, solange Datei B die Barrieren-Skalierung nicht benennt: dann zaehlt der Lauf
 * die faelligen Eintraege und sagt es, statt eine Lesung zu unterstellen.
 */
function kandidatenZeile(opts) {
  const { datum, roh, internalsRow, sessionIndex, alleSitzungen, vorherigeSitzung, rawDir,
    histK, churnMax, chunk2, schwaenze, log } = opts;
  const zustaende = confirmation.sessionStates(roh, (chunk2 && chunk2.terciles && chunk2.terciles.minStatedN) || 30);

  // Churn gegen den UNMITTELBAREN Vortag der Reihe, mit derselben Regel wie im Schreiber
  // (lib/druckenmiller/churn.js). Fehlt die Roh-Datei des Vortags, gibt es keinen Churn —
  // null, nicht 0.
  const jetzt = new Set(roh.filter((z) => z.inUniverse).map((z) => z.ticker));
  let nEntered = null, nLeft = null;
  if (vorherigeSitzung) {
    const vorRoh = rawLib.readRaw(rawDir, vorherigeSitzung, log);
    if (vorRoh) {
      const d = churnLib.membershipDelta(rawLib.membersOf(vorRoh), jetzt);
      nEntered = d.nEntered; nLeft = d.nLeft;
    }
  }
  const highChurn = churnLib.highChurnFlag(jetzt.size, nEntered, nLeft, churnMax);

  const sitzung = {
    date: datum,
    generatedAt: internalsRow.generatedAt,
    backfilled: internalsRow.backfilled === true,
    lowFreshness: internalsRow.lowFreshness === true,
    highChurn: highChurn === true,
    raw: zustaende.separation.raw === true,
  };
  const warmupUhr = scoreboard.liveSessionCount(histK);
  const imWarmup = !sitzung.backfilled && warmupUhr < scoreboard.WARMUP_SESSIONS;

  const eintraege = scoreboard.buildEntries({
    session: sitzung,
    stated: zustaende.rows,
    lastStates: scoreboard.lastStateByTicker(histK),
    lastEntryIndex: scoreboard.lastEntryIndexFrom(histK),
    sessionIndex,
    warmup: imWarmup,
  });

  // Faellige Aufloesungen: nur was der Horizont hinter sich hat, und nur mit der von Datei B
  // benannten Skalierung.
  const skalierung = chunk2 && chunk2.barrier && chunk2.barrier.sigmaScaling;
  const offen = scoreboard.openEntriesFrom(histK);
  const aufloesungen = [];
  let faelligOhneRegel = 0;
  // REVIEW-FUND (js-Reviewer, reproduziert): zwei Wege liessen einen offenen Eintrag STILL
  // verschwinden - der Ticker war nicht mehr im Shard (Handel eingestellt, aus dem Universum gefallen)
  // oder sein Eintrittsdatum lag hinter dem Aufloese-Fenster. Beides ist endgueltig: der
  // Schwanz wandert mit "heute" mit, der Tag kommt nie wieder. Und die Zaehler in
  // candidates.json meldeten den Eintrag weiter als "offen". Jetzt bekommt jeder dieser Faelle
  // eine TERMINALE Aufloesungszeile mit Grund (outcome UNRESOLVABLE, nie gewertet, nie als
  // zensiert gezaehlt), einen Zaehler und eine Warnung.
  let ohneSchwanz = 0, ausserhalbFenster = 0;
  const aelterAls = (datum) => alleSitzungen.indexOf(datum) >= 0
    && alleSitzungen.length - alleSitzungen.indexOf(datum) > AUFLOESE_SCHWANZ;
  for (const e of offen) {
    const schwanz = schwaenze.get(e.ticker);
    if (!schwanz) {
      ohneSchwanz++;
      aufloesungen.push(Object.assign(
        scoreboard.resolutionRow(e, { outcome: 'UNRESOLVABLE', bars: null, date: datum,
          barrierUp: null, barrierDown: null, scaling: skalierung || null }, internalsRow.generatedAt),
        { unresolvableReason: 'ticker-not-in-store' }));
      continue;
    }
    const ab = schwanz.findIndex((b) => b.date === e.date);
    if (ab < 0) {
      if (!aelterAls(e.date)) continue;                 // noch im Fenster, nur heute nicht getroffen
      ausserhalbFenster++;
      aufloesungen.push(Object.assign(
        scoreboard.resolutionRow(e, { outcome: 'UNRESOLVABLE', bars: null, date: datum,
          barrierUp: null, barrierDown: null, scaling: skalierung || null }, internalsRow.generatedAt),
        { unresolvableReason: 'entry-date-outside-resolution-window' }));
      continue;
    }
    const vorwaerts = schwanz.slice(ab + 1);
    if (!vorwaerts.length) continue;
    if (!skalierung) { faelligOhneRegel++; continue; }
    const res = scoreboard.resolveEntry(e, vorwaerts, skalierung);
    if (res.outcome === null) continue;                 // noch offen, nicht zensiert
    aufloesungen.push(scoreboard.resolutionRow(e, res, internalsRow.generatedAt));
  }
  if ((ohneSchwanz || ausserhalbFenster) && log) {
    log('::warning::[druckenmiller] ' + (ohneSchwanz + ausserhalbFenster) + ' offene(r) Eintrag/Eintraege '
      + 'ist/sind nicht mehr aufloesbar (' + ohneSchwanz + ' ohne Kursserie im Store, '
      + ausserhalbFenster + ' ausserhalb des ' + AUFLOESE_SCHWANZ + '-Balken-Fensters). Sie werden als '
      + 'UNRESOLVABLE geschlossen: nie gewertet, nie als zensiert gezaehlt, aber auch nicht still '
      + 'als "offen" weitergefuehrt.');
  }
  if (faelligOhneRegel && log) {
    log('::warning::[druckenmiller] ' + faelligOhneRegel + ' Eintrag/Eintraege waeren faellig, aber '
      + 'Datei B benennt keine barrier.sigmaScaling — es wird NICHTS aufgeloest. Eine unterstellte '
      + 'Barrieren-Breite waere eine unregistrierte Messentscheidung.');
  }

  // Nur die WECHSEL, nicht 2.200 Zustaende je Sitzung: die Reihe soll in zehn Jahren noch
  // lesbar sein.
  //
  // UND: eine RUECKGERECHNETE Sitzung veroeffentlicht KEINEN Zustand ([REV2-3]/[REV5-2] —
  // rueckgerechnete Zeilen tragen barDateMode/freshShare null und "yield state null"). Ohne
  // diese Sperre haette die Saat den Tickern einen Vorzustand gegeben, und die erste LIVE-
  // Sitzung haette sofort Eintraege geschrieben (am echten Lauf gemessen: 116) — aus einem
  // Vergleich gegen einen Zustand, den es laut Registrierung nicht gibt. Die Zaehler der
  // Sitzung bleiben sichtbar, der Zustand wird nur nicht fortgeschrieben.
  const vorher = scoreboard.lastStateByTicker(histK);
  const wechsel = {};
  if (!sitzung.backfilled) {
    for (const k of zustaende.rows) {
      if (k.state === null || k.ticker === undefined) continue;
      if (vorher.get(k.ticker) !== k.state) wechsel[k.ticker] = k.state;
    }
  }

  return {
    schema: scoreboard.SCHEMA, kind: 'SESSION', date: datum, generatedAt: internalsRow.generatedAt,
    backfilled: sitzung.backfilled, lowFreshness: sitzung.lowFreshness, highChurn: sitzung.highChurn,
    raw: sitzung.raw, rawReason: zustaende.separation.reason,
    warmup: imWarmup, warmupLiveSessionsBefore: warmupUhr,
    nUniverse: jetzt.size, nEntered, nLeft,
    nStated: zustaende.nStated, nDegenerateCut: zustaende.nDegenerateCut,
    confirmsShare: zustaende.separation.confirmsShare,
    cutsM1: zustaende.cutsM1, cutsM2: zustaende.cutsM2,
    nConfirms: zustaende.rows.filter((k) => k.state === 'CONFIRMS').length,
    nNeutral: zustaende.rows.filter((k) => k.state === 'NEUTRAL').length,
    nWeak: zustaende.rows.filter((k) => k.state === 'WEAK').length,
    statesPublished: !sitzung.backfilled,
    skipped: eintraege.skipped,
    transitions: eintraege.transitions,
    armedFirstObservation: eintraege.armedFirstObservation === undefined ? 0 : eintraege.armedFirstObservation,
    dueWithoutScalingRule: faelligOhneRegel,
    unresolvableNoSeries: ohneSchwanz,
    unresolvableOutsideWindow: ausserhalbFenster,
    stateChanges: wechsel,
    entries: eintraege.rows,
    resolutions: aufloesungen,
  };
}

/** Datei A (Pflicht) und Datei B (noch nicht vorhanden = kein Fehler, nur keine Aufloesung). */
function registrierungenLesen(protocolDir, log) {
  const a = registrierungLib.readHashed(protocolDir, REG_A_GLOB, 'Registrierungs-Datei A');
  const churnMax = a.json.courtGates && a.json.courtGates.churnMaxShare;
  if (!Number.isFinite(churnMax)) {
    throw new Error('[druckenmiller] ' + a.datei + ' nennt kein courtGates.churnMaxShare — die '
      + 'Eintritts-Sperre haette keine registrierte Schwelle.');
  }
  let chunk2 = null;
  try { chunk2 = registrierungLib.readHashed(protocolDir, REG_B_GLOB, 'Registrierungs-Datei B').json; }
  catch (e) {
    if (log) {
      log('::warning::[druckenmiller] Datei B (Scoreboard-Registrierung) ist nicht lesbar: ' + e.message
        + ' — Zustaende und Eintraege werden geloggt (Warm-up), aber nichts aufgeloest und nichts gewertet.');
    }
  }
  // WAECHTER 1 (Rat 9 Teil 2a) EAGER: die in Datei B genannte Skalierung muss ein
  // implementierter Zweig sein, und zwar JETZT - nicht erst, wenn Monate spaeter der erste
  // Eintrag faellig wird. Review-Fund (reproduziert 2026-09-19): lag der Wurf in
  // kandidatenZeile, war die Innereien-Zeile des Tages schon geschrieben und die
  // Kandidaten-Zeile fuer immer unnachtragbar (appendRow verbietet Rueckdatierung) -
  // gemessen: Innereien bei 2026-09-14, Kandidaten bei 2026-09-11.
  if (chunk2 && chunk2.barrier) scoreboard.assertScalingBranch(chunk2.barrier.sigmaScaling);
  return { churnMax, chunk2, constants_sha256: a.hash };
}

function schreibeModus({ pricesDir, snapshotsDir, outDir, macroFile, protocolDir, backfill, log }) {
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
  // Chunk 2: Registrierungen und der Kandidaten-Ledger VOR dem Preis-Durchgang, weil der
  // Durchgang wissen muss, fuer welche Ticker er den Aufloese-Schwanz mitnehmen soll.
  const { churnMax, chunk2, constants_sha256 } = registrierungenLesen(protocolDir, log);
  const kandidatenLedgerFile = path.join(outDir, KANDIDATEN_LEDGER);
  const kChain = ledgerLib.verifyChain(kandidatenLedgerFile);
  if (!kChain.ok) throw new Error(kChain.error);
  const histK = kChain.rows.slice();
  // Divergenz-Waechter (Review-Fund): die Kandidaten-Reihe darf der Innereien-Reihe nicht
  // hinterherhaengen. Passiert es doch (ein Lauf ist zwischen den Anhaengen gestorben), wird
  // die Luecke mit einer missing-Zeile je fehlendem Tag geschlossen - keine Zustaende, keine
  // Eintraege, aber auch keine unfuellbare Luecke (Muster [REV5-3] fuer die Innereien-Reihe).
  if (histK.length) {
    const kLetzte = histK[histK.length - 1].date;
    if (letzte && kLetzte < letzte) {
      const fehlend = vorhandene.map((r) => r.date).filter((x) => x > kLetzte && x <= letzte);
      log('::warning::[druckenmiller] die Kandidaten-Reihe endet auf ' + kLetzte + ', die '
        + 'Innereien-Reihe auf ' + letzte + ' - ' + fehlend.length + ' Tag(e) fehlen. Sie werden '
        + 'als missing-Zeilen geschlossen (keine Zustaende, keine Eintraege); ein Lauf ist zwischen '
        + 'den beiden Anhaengen gestorben.');
      for (const tag of fehlend) {
        const zeile = {
          schema: scoreboard.SCHEMA, kind: 'SESSION', date: tag, generatedAt: new Date().toISOString(),
          missing: true, reason: 'kein Kandidaten-Lauf an diesem Tag (Divergenz-Reparatur)',
          backfilled: true, lowFreshness: false, highChurn: false, raw: true, rawReason: 'missing',
          warmup: false, warmupLiveSessionsBefore: scoreboard.liveSessionCount(histK),
          nUniverse: null, nEntered: null, nLeft: null, nStated: null, nDegenerateCut: null,
          confirmsShare: null, cutsM1: null, cutsM2: null, nConfirms: null, nNeutral: null, nWeak: null,
          statesPublished: false, skipped: 'missing', transitions: 0, armedFirstObservation: 0,
          dueWithoutScalingRule: 0, stateChanges: {}, entries: [], resolutions: [],
        };
        ledgerLib.appendRow(kandidatenLedgerFile, zeile);
        histK.push(zeile);
      }
    } else if (letzte && kLetzte > letzte) {
      throw new Error('[druckenmiller] die Kandidaten-Reihe endet auf ' + kLetzte + ', die '
        + 'Innereien-Reihe erst auf ' + letzte + ' - die Kandidaten-Reihe kann der Messreihe nicht '
        + 'vorauslaufen. Kein Anhang, bis das geklaert ist.');
    }
  }
  const offeneTicker = new Set(scoreboard.openEntriesFrom(histK).map((e) => e.ticker));

  const { jeZiel, referenz, schwaenze } = metrikenSammeln(pricesDir, kandidaten, ziele, {
    extra: confirmation.rowExtra,
    tailsFor: offeneTicker,
  });
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
    // Chunk 2, Review-Fund (reproduziert): die Kandidaten-Zeile wird GEBAUT, BEVOR die
    // Innereien-Zeile geschrieben wird. Vorher lag zwischen den beiden appendRow-Aufrufen die
    // ganze Rechnung, und ein Wurf darin liess die eine Reihe vorlaufen und die andere fuer
    // immer zurueck (appendRow verbietet Rueckdatierung; gemessen 2026-09-19: Innereien bei
    // 2026-09-14, Kandidaten bei 2026-09-11).
    // Chunk 2: die Kandidaten-Zeile NACH der Innereien-Zeile. Faellt sie aus, steht die
    // Messreihe der Innereien trotzdem; nachgeholt wird sie NICHT (appendRow verbietet
    // Rueckdatierung) — genau deshalb steht sie im selben Lauf und nicht in einem zweiten
    // Skript, das man vergessen kann.
    const kZeile = kandidatenZeile({
      datum: d, roh, internalsRow: row,
      sessionIndex: alle.indexOf(d),
      alleSitzungen: alle,
      vorherigeSitzung: alle[alle.indexOf(d) - 1] || null,
      rawDir: path.join(outDir, 'raw'),
      histK, churnMax, chunk2, schwaenze, log,
    });
    row.constants_sha256 = constants_sha256;
    ledgerLib.appendRow(ledgerFile, row);
    ledgerLib.appendRow(kandidatenLedgerFile, kZeile);
    history.push(row);
    histK.push(kZeile);
    geschrieben++;
  }
  const letzteZeile = history[history.length - 1];
  log(`[druckenmiller] ${geschrieben} Zeile(n) angehaengt (bis ${letzteZeile.date}) · U=${letzteZeile.universeSize}`
    + ` · am Sitzungstag=${letzteZeile.nAtSession} · L1=${letzteZeile.l1} · L2=${letzteZeile.l2}`
    + ` · mixedBarDateShare=${letzteZeile.mixedBarDateShare}`);
  const letzteK = histK[histK.length - 1];
  if (letzteK) {
    log(`[druckenmiller] Kandidaten: CONFIRMS=${letzteK.nConfirms} NEUTRAL=${letzteK.nNeutral} `
      + `WEAK=${letzteK.nWeak} · Anteil=${letzteK.confirmsShare} · RAW=${letzteK.raw}`
      + ` · Eintraege=${letzteK.entries.length} · Aufloesungen=${letzteK.resolutions.length}`
      + `${letzteK.skipped ? ' · gesperrt: ' + letzteK.skipped : ''}`
      + `${letzteK.warmup ? ' · Warm-up (' + letzteK.warmupLiveSessionsBefore + '/' + scoreboard.WARMUP_SESSIONS + ')' : ''}`);
  }
  return 0;
}

/**
 * Den Export-Ordner auf EINEN Fehlermarker zusammenziehen. Bewusst kein Loeschen: eine
 * verschwundene Datei ist beim Konsumenten ein 404, und ein 404 laesst dort den alten
 * Stand stehen. Der Marker faehrt mit dem Deploy und sagt, dass heute nichts gilt.
 */
function schreibeFehlermarker(exportDir, grund, log, failedAt) {
  try {
    fs.mkdirSync(exportDir, { recursive: true });
    for (const f of fs.readdirSync(exportDir)) {
      if (f !== FAILED_NAME) fs.rmSync(path.join(exportDir, f), { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(exportDir, FAILED_NAME), JSON.stringify({
      schema: EXPORT_SCHEMA,
      generated_at: new Date().toISOString(),
      reason: grund,
      // Wer den Marker geschrieben hat, steht DRIN: seit Chunk 1 kommen zwei Schritte in
      // Frage (Logger und Export-Schreiber), und ein Marker, der immer denselben Namen
      // nennt, schickt die Suche in die falsche Datei.
      failedAt: failedAt || 'druckenmiller-log-internals --check',
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

/**
 * Der Kandidaten-Ledger wird mit derselben Schaerfe geprueft wie die Messreihe: Kette,
 * Sidecar, never-shrink. Review-Fund (reproduziert 2026-09-19): eine veraenderte historische
 * Zeile in candidates-ledger.jsonl lief durch BEIDE scharfen Tore gruen, weil keines die
 * Datei ueberhaupt aufmachte.
 */
function pruefeKandidatenLedger(outDir) {
  const p = path.join(outDir, KANDIDATEN_LEDGER);
  if (!fs.existsSync(p)) return null;
  const meta = ledgerLib.readMeta(p);
  const zeilen = ledgerLib.readLines(p);
  if (meta && zeilen.length < meta.rows) {
    return '[druckenmiller] Der Kandidaten-Ledger ist von ' + meta.rows + ' auf ' + zeilen.length
      + ' Zeilen geschrumpft - eine append-only-Reihe schrumpft nie.';
  }
  const kette = ledgerLib.verifyChain(p);
  if (!kette.ok) return kette.error;
  const rows = kette.rows;
  for (const r of rows) {
    if (r.schema !== scoreboard.SCHEMA) {
      return '[druckenmiller] Kandidaten-Zeile ' + r.date + ': schema ist ' + JSON.stringify(r.schema)
        + ', erwartet ' + JSON.stringify(scoreboard.SCHEMA) + '.';
    }
    if (!Array.isArray(r.entries) || !Array.isArray(r.resolutions) || !r.stateChanges) {
      return '[druckenmiller] Kandidaten-Zeile ' + r.date + ' traegt keine vollstaendige Form '
        + '(entries/resolutions/stateChanges).';
    }
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
  const kFehler = pruefeKandidatenLedger(outDir);
  if (kFehler) return rot(kFehler);
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
    protocolDir: path.resolve(get('--protocol', DEFAULT_PROTOCOL)),
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
  LEDGER_NAME, KANDIDATEN_LEDGER, FAILED_NAME, EXPORT_SCHEMA, pruefeKandidatenLedger,
  registrierungenLesen,
};

if (require.main === module) {
  try { process.exit(main()); }
  catch (e) { console.error('::error::' + (e && e.message ? e.message : e)); process.exit(1); }
}
