#!/usr/bin/env node
'use strict';
/**
 * scripts/write-druckenmiller-export.js — die Auslieferung des Druckenmiller-Moduls
 * (Chunk 1; BUILD-SPEC v1 vom 14.09.2026, Gericht PASSED 2:0, §0.1-0.2, §1, §2).
 *
 * WO ER LAEUFT: im scoring-Job, hinter dem v1-Vertrags-Tor und VOR dem Pages-Deploy.
 * Er liest die Messreihe (druckenmiller-history/) und die Registrierung (protocol/) und
 * schreibt outputs/findash-export/v1/druckenmiller/. Er rechnet KEINE Achse neu — die
 * Achsen entstehen merge-seitig im Logger; hier wird veroeffentlicht, was dort gemessen
 * wurde, plus zwei Dinge, die nur hier entstehen koennen (Churn und Abdeckung je Achse,
 * beide aus den Roh-Zeilen).
 *
 * DREI REGELN, DIE DIESE DATEI TRAEGT
 *  1. KEIN ZUSTAND. Rat D3: R-INT wird berechnet und geloggt, aber nie veroeffentlicht.
 *     regime.json traegt die rohen Legs — kein `state`, keine Ampel, keine Crash-Warnung.
 *  2. VIER DATEIEN ODER EIN MARKER. Der Vertrag kennt regime/meta/candidates/duquesne13f
 *     mit IDENTISCHEM generated_at. Chunk 1 liefert die ersten zwei; findashs Leser
 *     behandelt "weniger als vier" als stale — das Modul ist bis zum Ende von Chunk 3
 *     absichtlich stale (siehe docs/findash-export-v1.md §13). Faellt --check, wird der
 *     Ordner NICHT geloescht, sondern durch EINEN _FAILED.json ersetzt: bei 404 schreibt
 *     findash nicht (data-layer/screener-sync.js:164-166) und zeigte sonst den Stand von
 *     gestern als heutigen.
 *  3. NIE NaN. Eine nicht endliche Zahl wird von JSON zu null, und null heisst hier
 *     "nicht gemessen". Vor jedem Schreiben laeuft assertFinite ueber das ganze Objekt.
 *
 * F-16 (gesperrte Klasse): keine Notierungs-Identitaet, kein FX, keine Umrechnung.
 * Waechter: tests/druckenmiller/f16-guard.test.js liest diese Datei mit.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const internals = require('../lib/druckenmiller/internals.js');
const { MIN_BARS } = require('../lib/druckenmiller/universe.js');
const ledgerLib = require('../lib/druckenmiller/ledger.js');
const logger = require('./druckenmiller-log-internals.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'druckenmiller-history');
const DEFAULT_EXPORT = path.join(REPO_ROOT, 'outputs', 'findash-export', 'v1', 'druckenmiller');
const DEFAULT_PRICES = path.join(REPO_ROOT, 'prices');
const DEFAULT_PROTOCOL = path.join(REPO_ROOT, 'protocol');

const SCHEMA = logger.EXPORT_SCHEMA;              // 'findash-druckenmiller/v1'
const FAILED_NAME = logger.FAILED_NAME;           // '_FAILED.json'
/** Der Vertrag kennt vier Dateien; Chunk 1 schreibt die ersten zwei (§0.1). */
const ALLE_DATEIEN = ['regime.json', 'meta.json', 'candidates.json', 'duquesne13f.json'];
const DATEIEN_CHUNK1 = ['regime.json', 'meta.json'];
const SERIES_MAX = 504;                           // arch-spec §3.2
const CRON = '17 2 * * 2-6';                      // daily-pull.yml, Di-Sa 02:17 UTC
const REGISTRIERUNG_GLOB = /^druckenmiller_loggers_registered_\d{8}\.json$/;

/** Rat D7, 29 Woerter — woertlich, inkl. der beiden Auflagen aus dem Etikett. */
const LABEL = 'Rekonstruktion aus öffentlichen Aussagen und 13F-Filings — nicht validiert, keine '
  + 'Empfehlung. Ohne Positionsgrößen, Hebel, Währungen, Anleihen. Vorlauf-These ungeprüft: erste '
  + 'belastbare Aussage frühestens in rund zehn Jahren. Trefferbilanz noch nicht lesbar.';
const MANDATE = 'separate module, not quality, never in the score';
/** Rat D1: der gerissene Kipp-Schwellen-Override faehrt als gehashter Vermerk mit. */
const OVERRIDE_TEXT = 'Kipp-Schwelle (< 5 Prinzipien) gerissen: strenge Zaehlung 4, nach Advocatus '
  + 'Diaboli 3. Die Konsequenz wurde nach der vorgegebenen Eskalation (prinzipien-katalog.md:27-28) '
  + 'bewusst auf "kein eigenes Ranking" verengt — Rat-Entscheid D1 vom 2026-09-14, 68 %.';

/** Die Legs, die die Serie traegt. Alles Weitere bleibt in der Reihe (§0.2: rohe Legs). */
const SERIES_FIELDS = [
  'date', 'backfilled', 'barDateMode', 'mixedBarDateShare', 'freshShare', 'lowFreshness',
  'nUniverse', 'nEntered', 'nLeft', 'highChurn',
  'l1', 'l1Coverage', 'l2', 'l3', 'l3Band1', 'l3Band5', 'l3Coverage',
  'l4ew', 'l4cw', 'l4Unassigned', 'l4nCyclical', 'l4nDefensive', 'l4b', 'l4bN', 'l4bSmall',
  'l5', 'l5Coverage', 'l6', 'l7Persistence', 'l8CapMinusEqual', 'l8TopDecileShare', 'l8Winners',
];
const REGIME_FIELDS = ['schema', 'generated_at', 'asOf', 'series', 'sectorRs', 'rankPersistence'];
const META_FIELDS = ['schema', 'generated_at', 'mandate', 'label', 'paramsHash', 'universe',
  'coverage', 'cuts', 'ledgerRows', 'ledgerGapDays', 'churnUnavailableDays', 'universeHash',
  'overrideNote', 'expectedNextRun', 'duquesne13fCoverage'];
/** Felder, die eine echte Zahl tragen MUESSEN — alle anderen duerfen number|null sein. */
const PFLICHT_ZAHL = { series: ['nUniverse'], meta: ['ledgerGapDays', 'churnUnavailableDays'] };
const ACHSEN = ['l1', 'l2', 'l3', 'l4ew', 'l4cw', 'l4b', 'l5', 'l6', 'l7', 'l8'];

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const istZahlOderNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));

// ---------------------------------------------------------------------------
// Registrierung (Datei A)
// ---------------------------------------------------------------------------
/**
 * Datei A lesen und ihren Hash gegen den .sha256-Sidecar halten. Ohne sie gibt es keinen
 * paramsHash — und ein Export ohne paramsHash waere eine Messung ohne Parameter-Stand.
 */
function leseRegistrierung(protocolDir) {
  const treffer = fs.readdirSync(protocolDir).filter((f) => REGISTRIERUNG_GLOB.test(f)).sort();
  if (!treffer.length) {
    throw new Error('[druckenmiller] keine Registrierungs-Datei A in ' + protocolDir
      + ' — ohne den eingefrorenen Parameter-Stand darf nichts veroeffentlicht werden (BUILD-SPEC [REV6-1]).');
  }
  // Mehrere Staende: der juengste gilt, aber es MUSS auffallen (eine Registrierung wird
  // ersetzt, nicht ergaenzt — sonst weiss niemand, welche gilt).
  if (treffer.length > 1) {
    throw new Error('[druckenmiller] ' + treffer.length + ' Registrierungs-Dateien A in ' + protocolDir
      + ' (' + treffer.join(', ') + ') — welche gilt? Eine Registrierung wird ersetzt, nie ergaenzt.');
  }
  const datei = path.join(protocolDir, treffer[0]);
  const text = fs.readFileSync(datei, 'utf8');
  const hash = sha256(text);
  const sidecarPfad = datei + '.sha256';
  if (!fs.existsSync(sidecarPfad)) {
    throw new Error('[druckenmiller] ' + treffer[0] + ' hat keinen .sha256-Sidecar — ein ungehashtes '
      + 'Protokoll ist kein Protokoll.');
  }
  const imSidecar = fs.readFileSync(sidecarPfad, 'utf8').trim().split(/\s+/)[0];
  if (imSidecar !== hash) {
    throw new Error('[druckenmiller] Registrierung ' + treffer[0] + ': der Sidecar nennt '
      + imSidecar.slice(0, 12) + '…, die Datei ist ' + hash.slice(0, 12) + '… — sie wurde nach dem '
      + 'Hashen angefasst.');
  }
  return { datei: treffer[0], hash, json: JSON.parse(text) };
}

// ---------------------------------------------------------------------------
// U-Mitglieder je Tag aus den Roh-Zeilen (Churn und Abdeckung)
// ---------------------------------------------------------------------------
/** Die Roh-Zeilen eines Tages, oder null wenn es die Datei nicht (mehr) gibt. */
function leseRoh(rawDir, datum) {
  const p = path.join(rawDir, datum + '.jsonl.gz');
  if (!fs.existsSync(p)) return null;
  const text = zlib.gunzipSync(fs.readFileSync(p)).toString('utf8');
  const out = [];
  for (const zeile of text.split('\n')) {
    if (!zeile.trim()) continue;
    out.push(JSON.parse(zeile));
  }
  return out;
}

/**
 * U ist die Teilmenge, auf der die Achsen rechnen (Rat D4): ein Balken AM Sitzungstag
 * UND >= 250 Balken. Die Roh-Datei fuehrt beides je Ticker; `inUniverse` selbst wird
 * dort nicht mitgeschrieben, es wird hier aus denselben zwei Feldern rekonstruiert —
 * dieselbe Bedingung wie in internals.perTickerRows. Der Abgleich gegen universeSize
 * der Ledger-Zeile faengt jede Abweichung (siehe churnSerie).
 */
function uMitglieder(rohZeilen) {
  const s = new Set();
  for (const z of rohZeilen) if (z.atSession && Number.isFinite(z.bars) && z.bars >= MIN_BARS) s.add(z.ticker);
  return s;
}

/**
 * Ein- und Austritte je Publikationstag gegen den VORIGEN Publikationstag (BUILD-SPEC §1).
 *
 * ROT FUER DEN JUENGSTEN TAG, STILL FUER DIE HISTORIE: fehlt oder widerspricht die
 * Roh-Datei des asOf-Tages, ist das Churn-Tor fuer genau die Sitzung blind, die es
 * schuetzen soll — das wirft. Fuer aeltere Tage (Roh-Datei aus dem Baum gefallen) gibt
 * es null und einen Zaehler in meta.json; sie stillschweigend als 0 auszuweisen waere
 * eine Behauptung ueber eine Menge, die niemand mehr sehen kann.
 */
function churnSerie(rawDir, rows, log) {
  const out = new Map();
  let unbekannt = 0;
  let vorher = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const istLetzte = i === rows.length - 1;
    let jetzt = null;
    const roh = leseRoh(rawDir, row.date);
    if (roh) {
      jetzt = uMitglieder(roh);
      if (jetzt.size !== row.universeSize) {
        const msg = '[druckenmiller] ' + row.date + ': aus den Roh-Zeilen ergeben sich ' + jetzt.size
          + ' U-Mitglieder, die Ledger-Zeile nennt ' + row.universeSize + ' — Roh-Datei und Reihe '
          + 'sprechen ueber verschiedene Mengen.';
        if (istLetzte) throw new Error(msg);
        log('::warning::' + msg + ' Der Churn dieses Tages bleibt leer.');
        jetzt = null;
      }
    } else if (istLetzte) {
      throw new Error('[druckenmiller] keine Roh-Datei fuer den juengsten Tag (' + row.date + ') unter '
        + rawDir + ' — ohne sie ist das 5-%-Churn-Tor fuer genau die Sitzung blind, fuer die es gilt.');
    }
    let eintrag;
    if (!jetzt || !vorher) {
      eintrag = { nUniverse: row.universeSize, nEntered: null, nLeft: null, highChurn: null };
      if (i > 0 && !jetzt) unbekannt++;
    } else {
      let rein = 0, raus = 0;
      for (const t of jetzt) if (!vorher.has(t)) rein++;
      for (const t of vorher) if (!jetzt.has(t)) raus++;
      const n = row.universeSize;
      eintrag = {
        nUniverse: n,
        nEntered: rein,
        nLeft: raus,
        highChurn: n > 0 ? (rein + raus) / n > 0.05 : null,
      };
    }
    out.set(row.date, eintrag);
    if (jetzt) vorher = jetzt;
  }
  return { churn: out, unbekannt };
}

/**
 * Abdeckung je Achse am asOf-Tag, aus denselben Roh-Zeilen (Rat D3: unter 60 % wird die
 * Achse im Tab ausgegraut und hat keine Stimme). Die drei Achsen, die die Reihe selbst
 * mitschreibt, werden gegen sie GEGENGEPRUEFT — laufen Roh-Datei und Ledger-Zeile
 * auseinander, ist eine von beiden falsch, und das darf nicht still bleiben.
 */
function abdeckung(rohZeilen, row, log) {
  const u = rohZeilen.filter((z) => z.atSession && Number.isFinite(z.bars) && z.bars >= MIN_BARS);
  const n = u.length;
  const anteil = (f) => (n ? u.filter(f).length / n : null);
  const cov = {
    l1: anteil((z) => Number.isFinite(z.sma200)),
    l2: anteil((z) => Number.isFinite(z.sma50)),
    l3: anteil((z) => Number.isFinite(z.high252) && Number.isFinite(z.low252)),
    l4ew: anteil((z) => Number.isFinite(z.ret63)),
    l4cw: anteil((z) => Number.isFinite(z.ret63) && Number.isFinite(z.marketCap) && z.marketCap > 0),
    l4b: anteil((z) => Number.isFinite(z.ret63)),
    l5: anteil((z) => Number.isFinite(z.netRevision30)),
    l6: row.l6 ? 1 : 0,
    l7: anteil((z) => Number.isFinite(z.ret63) && !!z.sector),
    l8: anteil((z) => Number.isFinite(z.ret63)),
  };
  for (const [achse, ausDerReihe] of [['l1', row.l1Coverage], ['l3', row.l3Coverage], ['l5', row.l5Coverage]]) {
    if (ausDerReihe === null || cov[achse] === null) continue;
    if (Math.abs(cov[achse] - ausDerReihe) > 1e-9) {
      log('::warning::[druckenmiller] Abdeckung ' + achse + ' aus den Roh-Zeilen (' + cov[achse]
        + ') weicht von der Ledger-Zeile ab (' + ausDerReihe + ') — eine der beiden Mengen ist falsch. '
        + 'Veroeffentlicht wird die Zahl der REIHE, weil die Achse auf ihr gerechnet wurde.');
      cov[achse] = ausDerReihe;
    }
  }
  return cov;
}

// ---------------------------------------------------------------------------
// Bauen
// ---------------------------------------------------------------------------
/** Letzte SERIES_MAX Zeilen — gekappt wird vorne, die juengste bleibt immer. */
function begrenze(reihen) {
  return reihen.length > SERIES_MAX ? reihen.slice(reihen.length - SERIES_MAX) : reihen;
}

function baueRegime({ rows, churn, now }) {
  const letzte = rows[rows.length - 1];
  const series = begrenze(rows).map((r) => {
    const c = churn.get(r.date) || { nUniverse: r.universeSize, nEntered: null, nLeft: null, highChurn: null };
    const z = {};
    for (const f of SERIES_FIELDS) {
      if (f === 'nUniverse' || f === 'nEntered' || f === 'nLeft' || f === 'highChurn') z[f] = c[f];
      else z[f] = r[f] === undefined ? null : r[f];
    }
    return z;
  });
  return {
    schema: SCHEMA,
    generated_at: now.toISOString(),
    asOf: letzte.date,
    series,
    sectorRs: Array.isArray(letzte.l7) ? letzte.l7 : [],
    rankPersistence: letzte.l7Persistence === undefined ? null : letzte.l7Persistence,
  };
}

function baueMeta({ rows, sidecar, gapDays, churnUnbekannt, registrierung, coverage, now }) {
  const letzte = rows[rows.length - 1];
  return {
    schema: SCHEMA,
    generated_at: now.toISOString(),
    mandate: MANDATE,
    label: LABEL,
    paramsHash: registrierung.hash,
    universe: {
      size: letzte.nAtSession,
      withBars250: letzte.universeSize,
      asOf: letzte.date,
    },
    coverage,
    // Gelernte Quantile, die HEUTE benutzt werden: keine. Die Terzile entstehen in Chunk 2,
    // R-INT braucht 250 geloggte Live-Tage. Ein leeres Objekt waere ehrlich, aber stumm —
    // so sieht der Leser, welche Schnitte registriert sind und dass sie noch nicht greifen.
    cuts: {
      rIntLow: { q: 0.3, value: null },
      rIntHigh: { q: 0.7, value: null },
    },
    ledgerRows: { internals: rows.length, candidates: 0 },
    ledgerGapDays: gapDays,
    churnUnavailableDays: churnUnbekannt,
    universeHash: letzte.universeHash,
    overrideNote: { text: OVERRIDE_TEXT, sha256: sha256(OVERRIDE_TEXT), source: 'Rat-Entscheid D1, 2026-09-14' },
    expectedNextRun: nextRunAfter(now),
    duquesne13fCoverage: null,
    _sidecarRows: sidecar && Number.isFinite(sidecar.rows) ? sidecar.rows : null,
  };
}

/** Naechster CI-Slot nach <now> (daily-pull.yml: 17 2 * * 2-6, also Di-Sa 02:17 UTC). */
function nextRunAfter(now) {
  const d = new Date(now);
  for (let i = 0; i < 9; i++) {
    const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + i, 2, 17, 0, 0));
    const wt = c.getUTCDay();
    if (wt >= 2 && wt <= 6 && c.getTime() > d.getTime()) return c.toISOString();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------
function writeExport({ outDir, exportDir, pricesDir, protocolDir, now, log }) {
  const say = log || console.log;
  const jetzt = now || new Date();
  const ledgerFile = path.join(outDir, logger.LEDGER_NAME);
  const kette = ledgerLib.verifyChain(ledgerFile);
  if (!kette.ok) throw new Error(kette.error);
  const rows = kette.rows;
  if (!rows.length) {
    throw new Error('[druckenmiller] die Reihe unter ' + ledgerFile + ' ist leer — es gibt nichts zu '
      + 'veroeffentlichen, und eine leere Auslieferung saehe aus wie ein gemessenes Nichts.');
  }
  const registrierung = leseRegistrierung(protocolDir);
  const { churn, unbekannt } = churnSerie(path.join(outDir, 'raw'), rows, say);
  const letzte = rows[rows.length - 1];
  const cov = abdeckung(leseRoh(path.join(outDir, 'raw'), letzte.date), letzte, say);
  const gapDays = ledgerLib.ledgerGapDays(rows, logger.sitzungen(pricesDir));

  const regime = baueRegime({ rows, churn, now: jetzt });
  const meta = baueMeta({
    rows, sidecar: ledgerLib.readMeta(ledgerFile), gapDays, churnUnbekannt: unbekannt,
    registrierung, coverage: cov, now: jetzt,
  });
  // Vor dem Schreiben, nicht danach: eine nicht endliche Zahl wird von JSON.stringify zu
  // null, und null heisst hier "nicht gemessen" (dieselbe Regel wie in der Reihe).
  ledgerLib.assertFinite(regime, 'regime.json');
  ledgerLib.assertFinite(meta, 'meta.json');

  fs.mkdirSync(exportDir, { recursive: true });
  const alterMarker = path.join(exportDir, FAILED_NAME);
  if (fs.existsSync(alterMarker)) fs.rmSync(alterMarker);
  fs.writeFileSync(path.join(exportDir, 'regime.json'), JSON.stringify(regime) + '\n');
  fs.writeFileSync(path.join(exportDir, 'meta.json'), JSON.stringify(meta) + '\n');
  say('[druckenmiller] Export geschrieben: asOf=' + regime.asOf + ' · Serie=' + regime.series.length
    + ' Zeilen · U=' + meta.universe.withBars250 + ' · paramsHash=' + meta.paramsHash.slice(0, 12) + '…'
    + ' · Churn ohne Roh-Datei: ' + unbekannt + ' Tag(e)'
    + ' · noch ohne candidates.json/duquesne13f.json (Chunk 2/3) — findash sieht das Modul bis dahin als stale.');
  return 0;
}

// ---------------------------------------------------------------------------
// Pruefen
// ---------------------------------------------------------------------------
/** Erste Fundstelle einer nicht endlichen bzw. typfremden Zahl, oder null. */
function typFehler(obj, pfad, erlaubteSchluessel, pflichtZahl) {
  for (const k of erlaubteSchluessel) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) return 'Feld ' + k + ' fehlt in ' + pfad;
  }
  for (const k of Object.keys(obj)) {
    if (k.startsWith('_')) continue;
    if (!erlaubteSchluessel.includes(k)) {
      return 'unbekanntes Feld ' + k + ' in ' + pfad + ' — der Vertrag ist eine weisse Liste';
    }
  }
  for (const k of pflichtZahl || []) {
    if (!(typeof obj[k] === 'number' && Number.isFinite(obj[k]))) {
      return 'Feld ' + k + ' in ' + pfad + ' ist ' + JSON.stringify(obj[k]) + ', erwartet eine endliche Zahl';
    }
  }
  return null;
}

/** Rekursiv: kein Wert ist eine nicht endliche Zahl oder ein Zahl-Text. */
function nichtEndlich(v, pfad) {
  if (typeof v === 'number') return Number.isFinite(v) ? null : pfad + ' ist ' + v;
  if (typeof v === 'string' && /^-?(NaN|Infinity)$/.test(v)) return pfad + ' ist der Text "' + v + '"';
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { const f = nichtEndlich(v[i], pfad + '[' + i + ']'); if (f) return f; }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) { const f = nichtEndlich(x, pfad + '.' + k); if (f) return f; }
  }
  return null;
}

function checkExport({ outDir, exportDir, pricesDir, protocolDir, log }) {
  const say = log || console.log;
  const rot = (grund) => {
    say('::error::' + grund);
    logger.schreibeFehlermarker(exportDir, grund, say);
    return 1;
  };
  const marker = path.join(exportDir, FAILED_NAME);
  if (fs.existsSync(marker)) {
    return rot('[druckenmiller] ' + FAILED_NAME + ' liegt im Export-Ordner — ein frueherer Schritt '
      + 'dieses Laufs hat die Auslieferung als ungueltig markiert.');
  }
  // 1. Die Dateien dieses Chunks muessen da sein. Die beiden anderen fehlen bis Chunk 3
  //    ABSICHTLICH; findashs Leser wertet "weniger als vier" als stale (docs §13).
  const dateien = {};
  for (const name of DATEIEN_CHUNK1) {
    const p = path.join(exportDir, name);
    if (!fs.existsSync(p)) {
      return rot('[druckenmiller] ' + name + ' fehlt in ' + exportDir + ' — der Schreiber ist nicht '
        + 'gelaufen oder abgebrochen. Ein halber Ordner ist schlimmer als keiner.');
    }
    try { dateien[name] = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { return rot('[druckenmiller] ' + name + ' ist nicht lesbar: ' + e.message); }
  }
  const regime = dateien['regime.json'], meta = dateien['meta.json'];

  // 2. EIN generated_at ueber alle vorhandenen Dateien (§2: sonst mischt der Konsument
  //    heute mit gestern). Auch die noch fehlenden werden geprueft, sobald es sie gibt.
  const stempel = new Set();
  for (const name of ALLE_DATEIEN) {
    const p = path.join(exportDir, name);
    if (!fs.existsSync(p)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    stempel.add(j.generated_at);
  }
  if (stempel.size !== 1) {
    return rot('[druckenmiller] die Dateien tragen ' + stempel.size + ' verschiedene generated_at ('
      + [...stempel].join(', ') + ') — der Vertrag verlangt EINEN Stempel ueber alle Dateien.');
  }
  if (regime.schema !== SCHEMA || meta.schema !== SCHEMA) {
    return rot('[druckenmiller] falsches schema: ' + regime.schema + ' / ' + meta.schema
      + ', erwartet ' + SCHEMA + '.');
  }

  // 3. Form: weisse Liste je Datei und je Serien-Zeile, plus die Zahlen-Hygiene.
  let f = typFehler(regime, 'regime.json', REGIME_FIELDS, []);
  if (f) return rot('[druckenmiller] ' + f);
  f = typFehler(meta, 'meta.json', META_FIELDS, PFLICHT_ZAHL.meta);
  if (f) return rot('[druckenmiller] ' + f);
  if (!Array.isArray(regime.series) || !regime.series.length) {
    return rot('[druckenmiller] regime.json traegt keine Serie.');
  }
  for (const z of regime.series) {
    f = typFehler(z, 'regime.json series[' + z.date + ']', SERIES_FIELDS, PFLICHT_ZAHL.series);
    if (f) return rot('[druckenmiller] ' + f);
    for (const k of SERIES_FIELDS) {
      if (['date', 'barDateMode'].includes(k)) continue;
      if (['backfilled', 'lowFreshness', 'highChurn'].includes(k)) {
        if (!(typeof z[k] === 'boolean' || z[k] === null)) {
          return rot('[druckenmiller] ' + k + ' in ' + z.date + ' ist weder Wahrheitswert noch null.');
        }
        continue;
      }
      if (k === 'l6') continue;                      // Zustandsname des SPY oder null
      if (!istZahlOderNull(z[k])) {
        return rot('[druckenmiller] Feld ' + k + ' in der Serie (' + z.date + ') ist '
          + JSON.stringify(z[k]) + ' — erwartet eine endliche Zahl oder null.');
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(z.date))) {
      return rot('[druckenmiller] Serien-Zeile ohne gueltiges Datum: ' + JSON.stringify(z.date));
    }
  }
  for (const [name, j] of Object.entries(dateien)) {
    const nf = nichtEndlich(j, name);
    if (nf) return rot('[druckenmiller] ' + nf + ' — nicht endliche Zahlen gehoeren nicht in die Auslieferung.');
  }
  // Die Serie steht aufsteigend und endet auf asOf.
  for (let i = 1; i < regime.series.length; i++) {
    if (!(regime.series[i].date > regime.series[i - 1].date)) {
      return rot('[druckenmiller] die Serie ist nicht streng aufsteigend: ' + regime.series[i - 1].date
        + ' vor ' + regime.series[i].date + '.');
    }
  }
  if (regime.series[regime.series.length - 1].date !== regime.asOf) {
    return rot('[druckenmiller] asOf (' + regime.asOf + ') ist nicht die letzte Serien-Zeile ('
      + regime.series[regime.series.length - 1].date + ').');
  }
  if (regime.series.length > SERIES_MAX) {
    return rot('[druckenmiller] die Serie traegt ' + regime.series.length + ' Zeilen, der Vertrag deckelt bei ' + SERIES_MAX + '.');
  }

  // 4. Gegen die Reihe: Kette, Schrumpfen, Loch, Schlepp-Kante.
  const ledgerFile = path.join(outDir, logger.LEDGER_NAME);
  if (!fs.existsSync(ledgerFile)) {
    return rot('[druckenmiller] kein Ledger unter ' + ledgerFile + ' — die Auslieferung laesst sich '
      + 'gegen nichts pruefen.');
  }
  // Das Schrumpfen wird VOR der Kette geprueft: eine abgeschnittene Reihe bricht beides,
  // und "geschrumpft" ist die praezisere Diagnose (die Kette meldete nur, dass die letzte
  // Zeile nicht zum Sidecar passt — richtig, aber es verschweigt, dass Zeilen fehlen).
  let sidecar = null;
  try { sidecar = ledgerLib.readMeta(ledgerFile); } catch (e) { return rot(e.message); }
  const zeilenZahl = ledgerLib.readLines(ledgerFile).length;
  if (sidecar && Number.isFinite(sidecar.rows) && zeilenZahl < sidecar.rows) {
    return rot('[druckenmiller] Die Reihe ist von ' + sidecar.rows + ' auf ' + zeilenZahl
      + ' Zeilen geschrumpft — eine append-only-Reihe schrumpft nie.');
  }
  const kette = ledgerLib.verifyChain(ledgerFile);
  if (!kette.ok) return rot(kette.error);
  const rows = kette.rows;
  if (Number.isFinite(meta._sidecarRows) && meta.ledgerRows.internals < meta._sidecarRows) {
    return rot('[druckenmiller] meta.json meldet ' + meta.ledgerRows.internals + ' Zeilen, der Sidecar '
      + meta._sidecarRows + ' — die veroeffentlichte Reihe ist geschrumpft.');
  }
  if (meta.ledgerRows.internals !== rows.length) {
    return rot('[druckenmiller] meta.json meldet ' + meta.ledgerRows.internals + ' Ledger-Zeilen, die '
      + 'Reihe hat ' + rows.length + ' — die Auslieferung gehoert zu einem anderen Stand.');
  }
  if (!(Number.isInteger(meta.ledgerGapDays) && meta.ledgerGapDays === 0)) {
    return rot('[druckenmiller] ledgerGapDays = ' + meta.ledgerGapDays + ': es fehlen Handelstage '
      + 'INNERHALB der Reihe. Sie sind nicht nachtragbar, sobald ihre Balken aus dem rollenden '
      + 'Fenster gefallen sind.');
  }
  const letzteZeile = rows[rows.length - 1];
  if (regime.asOf !== letzteZeile.date) {
    return rot('[druckenmiller] die Auslieferung steht auf asOf ' + regime.asOf + ', die letzte '
      + 'Ledger-Zeile ist ' + letzteZeile.date + ' — veroeffentlicht wurde ein anderer (in aller Regel: '
      + 'ein aelterer) Stand als der gemessene.');
  }
  if (meta.universeHash !== letzteZeile.universeHash) {
    return rot('[druckenmiller] universeHash in meta.json passt nicht zur letzten Ledger-Zeile — '
      + 'die Grundgesamtheit der Auslieferung ist eine andere als die gemessene.');
  }
  // 5. Die Registrierung: derselbe Parameter-Stand wie beim Schreiben.
  let registrierung;
  try { registrierung = leseRegistrierung(protocolDir); }
  catch (e) { return rot(e.message); }
  if (meta.paramsHash !== registrierung.hash) {
    return rot('[druckenmiller] paramsHash der Auslieferung (' + String(meta.paramsHash).slice(0, 12)
      + '…) ist nicht der Hash der Registrierung ' + registrierung.datei + ' ('
      + registrierung.hash.slice(0, 12) + '…) — entweder wurde die Registrierung angefasst oder der '
      + 'Export stammt von einem anderen Parameter-Stand.');
  }
  const trueb = regime.series.filter((z) => z.lowFreshness === true).length;
  const churnHoch = regime.series.filter((z) => z.highChurn === true).length;
  say('[druckenmiller] export ok · asOf=' + regime.asOf + ' · series=' + regime.series.length
    + ' · ledgerRows=' + meta.ledgerRows.internals + ' · gap=' + meta.ledgerGapDays
    + ' · lowFreshness=' + trueb + ' · highChurn=' + churnHoch
    + ' · churn ohne Roh-Datei=' + meta.churnUnavailableDays);
  // GELB, nicht rot (Gericht, Wiederaufnahme): eine truebe oder umschlagende Sitzung ist
  // ein bekannter Zustand des Tageslaufs; die Zeile traegt ihr Flag und speist kein
  // Quantil. Rot wuerde Karls Lauf an etwas anhalten, das die Reihe korrekt behandelt.
  const jung = regime.series[regime.series.length - 1];
  if (jung.lowFreshness === true) {
    say('::warning::[druckenmiller] die juengste Sitzung (' + jung.date + ') steht auf freshShare '
      + jung.freshShare + ' (Tor ' + internals.FRESH_MIN + ') und speist kein Quantil.');
  }
  if (jung.highChurn === true) {
    say('::warning::[druckenmiller] die juengste Sitzung (' + jung.date + ') hat ' + jung.nEntered
      + ' Ein- und ' + jung.nLeft + ' Austritte bei U=' + jung.nUniverse + ' (Tor 5 %) — sie ist als '
      + 'highChurn markiert und speist kein Quantil.');
  }
  return 0;
}

// ---------------------------------------------------------------------------
function main(argv, log) {
  const args = argv || process.argv.slice(2);
  const say = log || console.log;
  const get = (k, dflt) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : dflt; };
  const opts = {
    outDir: path.resolve(get('--out', DEFAULT_OUT)),
    exportDir: path.resolve(get('--export-dir', DEFAULT_EXPORT)),
    pricesDir: path.resolve(get('--prices-dir', DEFAULT_PRICES)),
    protocolDir: path.resolve(get('--protocol', DEFAULT_PROTOCOL)),
    log: say,
  };
  return args.includes('--check') ? checkExport(opts) : writeExport(opts);
}

module.exports = {
  main, writeExport, checkExport, baueRegime, baueMeta, begrenze, nextRunAfter,
  leseRegistrierung, leseRoh, uMitglieder, churnSerie, abdeckung,
  SCHEMA, FAILED_NAME, ALLE_DATEIEN, DATEIEN_CHUNK1, SERIES_MAX, SERIES_FIELDS, REGIME_FIELDS,
  META_FIELDS, CRON, LABEL, MANDATE, ACHSEN,
};

if (require.main === module) {
  try { process.exit(main()); }
  catch (e) { console.error('::error::' + (e && e.message ? e.message : e)); process.exit(1); }
}
