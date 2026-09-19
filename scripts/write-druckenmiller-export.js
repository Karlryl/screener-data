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
const { MIN_BARS, universeHash } = require('../lib/druckenmiller/universe.js');
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
  let json;
  try { json = JSON.parse(text); }
  catch (e) {
    throw new Error('[druckenmiller] Registrierung ' + treffer[0] + ' ist kein gueltiges JSON ('
      + e.message + ') — der Dateiname gehoert in die Meldung, sonst sucht der naechste Leser '
      + 'in der falschen Datei.');
  }
  // Was der Schreiber aus ihr LIEST, muss sie auch tragen — sonst faellt es erst als
  // undefined mitten in der Rechnung auf.
  const churnMax = json.courtGates && json.courtGates.churnMaxShare;
  if (!Number.isFinite(churnMax)) {
    throw new Error('[druckenmiller] ' + treffer[0] + ' nennt kein courtGates.churnMaxShare — '
      + 'das Churn-Tor haette keine registrierte Schwelle.');
  }
  if (!(json.overrideNoteD1 && typeof json.overrideNoteD1.text === 'string' && json.overrideNoteD1._origin)) {
    throw new Error('[druckenmiller] ' + treffer[0] + ' nennt keinen overrideNoteD1 mit text und '
      + '_origin — der gehashte Override-Vermerk (Rat D1) haette keine Quelle.');
  }
  return { datei: treffer[0], hash, json };
}

// ---------------------------------------------------------------------------
// U-Mitglieder je Tag aus den Roh-Zeilen (Churn und Abdeckung)
// ---------------------------------------------------------------------------
/**
 * Die Roh-Zeilen eines Tages, oder null wenn es die Datei nicht (mehr) gibt ODER sie
 * unlesbar ist.
 *
 * REVIEW-FUND: hier stand ein nacktes gunzip+JSON.parse. Eine halb geschriebene Datei von
 * vor einem Jahr riss damit JEDE weitere Auslieferung mit ("incorrect header check", ohne
 * Dateinamen, ohne Tag) — eine Nebenwirkung, die groesser ist als der Schaden: der Tag
 * steht laengst in der Reihe. Jetzt entscheidet der AUFRUFER: fuer den juengsten Tag ist
 * null ein Wurf, fuer die Historie ein Zaehler. Und die Meldung traegt ihre Herkunft, wie
 * lib/druckenmiller/ledger.js:62 es im selben Repo vormacht.
 */
function leseRoh(rawDir, datum, log) {
  const p = path.join(rawDir, datum + '.jsonl.gz');
  if (!fs.existsSync(p)) return null;
  let text;
  try { text = zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'); }
  catch (e) {
    if (log) {
      log('::warning::[druckenmiller] ' + p + ' laesst sich nicht entpacken (' + e.message
        + ') — halb geschrieben oder kein gzip. Der Churn dieses Tages bleibt leer.');
    }
    return null;
  }
  const out = [];
  const zeilen = text.split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    if (!zeilen[i].trim()) continue;
    try { out.push(JSON.parse(zeilen[i])); }
    catch (e) {
      if (log) {
        log('::warning::[druckenmiller] ' + p + ' Zeile ' + (i + 1) + ' ist kein gueltiges JSON ('
          + e.message + ') — die Datei gilt als unlesbar und wird NICHT teilweise ausgewertet.');
      }
      return null;
    }
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
function churnSerie(rawDir, rows, churnMax, log) {
  if (!(Number.isFinite(churnMax) && churnMax > 0 && churnMax < 1)) {
    throw new Error('[druckenmiller] churnMaxShare aus der Registrierung ist ' + churnMax
      + ' — ohne die registrierte Schwelle wird kein Churn-Tor gerechnet. Eine hier hartkodierte '
      + 'Zahl waere genau die Klasse Fehler, gegen die Datei A steht.');
  }
  const out = new Map();
  let letzteRoh = null;
  let unbekannt = 0;
  let vorher = null, vorherDatum = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const istLetzte = i === rows.length - 1;
    let jetzt = null;
    const roh = leseRoh(rawDir, row.date, log);
    if (istLetzte) letzteRoh = roh;
    if (roh) {
      jetzt = uMitglieder(roh);
      // REVIEW-FUND: verglichen wurde nur die GROESSE. Ein 1:1-Tausch (einer rein, einer
      // raus) ist groessengleich und lief unsichtbar durch — ausgerechnet der Fall, den das
      // Churn-Tor messen soll. Der Tages-Hash der Mitgliederliste faengt ihn.
      const hash = universeHash([...jetzt]);
      if (jetzt.size !== row.universeSize || hash !== row.universeHash) {
        const msg = '[druckenmiller] ' + row.date + ': Roh-Datei und Ledger-Zeile sprechen ueber '
          + 'verschiedene Mengen (Roh ' + jetzt.size + '/' + hash.slice(0, 12) + '…, Reihe '
          + row.universeSize + '/' + String(row.universeHash).slice(0, 12) + '…).';
        if (istLetzte) throw new Error(msg);
        log('::warning::' + msg + ' Der Churn dieses Tages bleibt leer.');
        jetzt = null;
      }
    } else if (istLetzte) {
      throw new Error('[druckenmiller] keine (lesbare) Roh-Datei fuer den juengsten Tag ('
        + row.date + ') unter ' + rawDir + ' — ohne sie ist das Churn-Tor fuer genau die '
        + 'Sitzung blind, fuer die es gilt.');
    }
    // REVIEW-FUND H1 (reproduziert): `vorher` wurde nur fortgeschrieben, wenn ein Tag lesbar
    // war. Fiel ein Tag in der Mitte aus, verglich der FOLGETAG gegen eine zwei Sitzungen
    // alte Menge — und das Ergebnis stand als Tagesdifferenz in der Auslieferung. Beide
    // Fehlrichtungen sind teuer: ein ruhiger Tag wurde als highChurn ausgeschlossen, ein
    // Hin-und-Zurueck-Tausch als ruhig durchgelassen. Verglichen wird nur noch gegen den
    // UNMITTELBAREN Vortag der Reihe; sonst gibt es keinen Churn, sondern null.
    const vortagDerReihe = i > 0 ? rows[i - 1].date : null;
    const vergleichbar = !!(jetzt && vorher && vorherDatum === vortagDerReihe);
    let eintrag;
    if (!vergleichbar) {
      eintrag = { nUniverse: row.universeSize, nEntered: null, nLeft: null, highChurn: null };
      // Gezaehlt wird JEDER Tag ohne Churn ausser dem ersten (der hat per Definition keinen
      // Vortag) — auch der, dem der VORTAG fehlt. Genau den zaehlte der Zaehler vorher nicht.
      if (i > 0) unbekannt++;
    } else {
      let rein = 0, raus = 0;
      for (const t of jetzt) if (!vorher.has(t)) rein++;
      for (const t of vorher) if (!jetzt.has(t)) raus++;
      const n = row.universeSize;
      eintrag = {
        nUniverse: n,
        nEntered: rein,
        nLeft: raus,
        highChurn: n > 0 ? (rein + raus) / n > churnMax : null,
      };
    }
    out.set(row.date, eintrag);
    if (jetzt) { vorher = jetzt; vorherDatum = row.date; }
  }
  return { churn: out, unbekannt, letzteRoh };
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
    // null heisst "nicht gemessen", nie 0 — dieselbe Regel wie ueberall sonst im Modul.
    // Ein fehlendes L6 (macro-regime.json noch nicht da) ist KEINE Abdeckung von null Prozent.
    l6: row.l6 === null || row.l6 === undefined ? null : 1,
    l7: anteil((z) => Number.isFinite(z.ret63) && !!z.sector),
    l8: anteil((z) => Number.isFinite(z.ret63)),
  };
  // REVIEW-FUND: hier stand eine Warnung, und veroeffentlicht wurde dann die Zahl der Reihe.
  // Das ist DIESELBE Beweislage wie im Churn (dort wirft der Lauf) mit einer anderen
  // Konsequenz: ein Widerspruch am juengsten Tag heisst, dass eine der beiden Mess-Strecken
  // kaputt ist. Unter 0,6 wird die Achse ausgegraut — eine falsche Abdeckung gibt also einer
  // kaputten Achse still eine Stimme. Und --check rechnet die Abdeckung nie nach, der scharfe
  // Waechter kann es also gar nicht sehen. Deshalb: ein Wurf, wie beim Churn.
  for (const [achse, ausDerReihe] of [['l1', row.l1Coverage], ['l3', row.l3Coverage], ['l5', row.l5Coverage]]) {
    if (ausDerReihe === null || cov[achse] === null) continue;
    if (Math.abs(cov[achse] - ausDerReihe) > 1e-9) {
      throw new Error('[druckenmiller] ' + row.date + ': Abdeckung ' + achse + ' aus den Roh-Zeilen ('
        + cov[achse] + ') weicht von der Ledger-Zeile ab (' + ausDerReihe + ') — eine der beiden '
        + 'Mess-Strecken ist kaputt. Unter 0,6 wuerde die Achse ausgegraut; eine falsche Abdeckung '
        + 'gaebe einer kaputten Achse eine Stimme.');
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

function pruefeSectorRs(letzte) {
  if (!Array.isArray(letzte.l7)) {
    throw new Error('[druckenmiller] die Ledger-Zeile ' + letzte.date + ' traegt in l7 kein Array ('
      + JSON.stringify(letzte.l7) + ') — das ist eine kaputte Zeile, keine leere Sektor-Tabelle.');
  }
  return letzte.l7;
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
    // Ein leeres Array ist ein Befund ("kein Sektor hatte eine messbare RS", z. B. ohne SPY);
    // ein l7, das gar kein Array ist, ist eine kaputte Zeile. Die zweite Lage still als die
    // erste auszuliefern hiesse, einen Defekt als Messung zu veroeffentlichen.
    sectorRs: pruefeSectorRs(letzte),
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
    // Der Vermerk kommt aus der GEHASHTEN Registrierung, nicht aus einer Konstante 200 Zeilen
    // weiter oben: ein Hash ueber einen Text, den derselbe Autor daneben aendern kann, belegt
    // nichts. So haengt er am .sha256-Sidecar und am Changelog-Tor von Datei A.
    overrideNote: {
      text: registrierung.json.overrideNoteD1.text,
      sha256: sha256(registrierung.json.overrideNoteD1.text),
      source: registrierung.json.overrideNoteD1._origin,
    },
    expectedNextRun: nextRunAfter(now),
    duquesne13fCoverage: null,
    _sidecarRows: sidecar && Number.isFinite(sidecar.rows) ? sidecar.rows : null,
  };
}

/**
 * Minute, Stunde und Wochentage AUS dem Cron-Ausdruck. Vorher standen sie ein zweites Mal
 * als Literale in nextRunAfter — der Test verglich nur Workflow gegen Konstante, nie
 * Konstante gegen Funktion. Eine Cron-Aenderung samt nachgezogener Konstante waere gruen
 * durchgelaufen und expectedNextRun ab dann dauerhaft falsch (und mit ihm findashs
 * "missed run"-Flag). Nur die Form dieses einen Cron wird gelesen, kein Cron-Parser.
 */
function cronSlot(cron) {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\d)-(\d)$/.exec(String(cron).trim());
  if (!m) {
    throw new Error('[druckenmiller] der CI-Cron "' + cron + '" hat nicht mehr die Form '
      + '"<Minute> <Stunde> * * <WT>-<WT>" — expectedNextRun wuerde ab jetzt raten.');
  }
  return { minute: +m[1], stunde: +m[2], vonTag: +m[3], bisTag: +m[4] };
}

/** Naechster CI-Slot nach <now>, gelesen aus CRON (daily-pull.yml). */
function nextRunAfter(now, cron) {
  const { minute, stunde, vonTag, bisTag } = cronSlot(cron || CRON);
  const d = new Date(now);
  for (let i = 0; i < 9; i++) {
    const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + i, stunde, minute, 0, 0));
    const wt = c.getUTCDay();
    if (wt >= vonTag && wt <= bisTag && c.getTime() > d.getTime()) return c.toISOString();
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
  // Churn nur ueber das Fenster, das auch veroeffentlicht wird — plus EINEN Tag davor, weil
  // die erste veroeffentlichte Zeile ihren Vortag zum Vergleich braucht. Ohne den Schnitt
  // entpackt der Lauf nach zehn Jahren 2.500 gz-Dateien fuer 504 Zeilen.
  const fenster = rows.length > SERIES_MAX + 1 ? rows.slice(rows.length - SERIES_MAX - 1) : rows;
  const { churn, unbekannt, letzteRoh } = churnSerie(
    path.join(outDir, 'raw'), fenster, registrierung.json.courtGates.churnMaxShare, say);
  const letzte = rows[rows.length - 1];
  const cov = abdeckung(letzteRoh, letzte, say);
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

/**
 * Der Mantel um die Pruefung. REVIEW-FUND (von beiden Reviewern, reproduziert): jede
 * Pruefung fuehrte ueber rot() zum Marker — der RUMPF selbst aber nicht. Eine Datei, die
 * gueltiges JSON, aber strukturfremd ist (`regime.json` = `null`, `meta.ledgerRows` = null,
 * eine `series`-Zeile null), warf eine TypeError am Vertrag vorbei: Exit 1, KEIN Marker,
 * und die kaputten Dateien blieben liegen. Im scoring-Job schluckt `|| true` den Exit-Code —
 * der Deploy haette Muell mit heutigem generated_at ausgeliefert statt "heute gilt nichts".
 * Genau diese Dateien kommen ab Chunk 2/3 von einem anderen Erzeuger.
 */
function checkExport(opts) {
  const say = opts.log || console.log;
  try {
    return checkExportRumpf(opts, say);
  } catch (e) {
    const grund = '[druckenmiller] die Pruefung selbst ist gescheitert: '
      + (e && e.message ? e.message : String(e))
      + ' — eine Auslieferung, die ihren eigenen Pruefer wirft, gilt als ungueltig.';
    say('::error::' + grund);
    schreibeMarkerEinmal(opts.exportDir, grund, say);
    return 1;
  }
}

/**
 * Einen vorgefundenen Marker NICHT ueberschreiben: sein `reason` nennt die urspruengliche
 * Ursache, und die ist wertvoller als "es liegt ein Marker".
 */
function schreibeMarkerEinmal(exportDir, grund, say) {
  const marker = path.join(exportDir, FAILED_NAME);
  let alt = null;
  if (fs.existsSync(marker)) {
    try { alt = fs.readFileSync(marker, 'utf8'); } catch { alt = null; }
  }
  logger.schreibeFehlermarker(exportDir, grund, say, 'write-druckenmiller-export --check');
  // Der Ordner MUSS auf einen Marker zusammenschrumpfen (das erledigt der Aufruf oben) —
  // aber der Grund des ERSTEN Markers bleibt stehen: er nennt die Ursache, dieser hier nur
  // ihre Folge. Beides zusammen gibt es nicht: eine Mischung aus Marker und Datendateien ist
  // genau der Zustand, den der Vertrag ausschliesst.
  if (alt !== null) {
    try {
      fs.writeFileSync(marker, alt);
      say('[druckenmiller] der bereits vorhandene ' + FAILED_NAME + ' bleibt woertlich stehen — '
        + 'sein Grund nennt die Ursache, dieser Lauf nur ihre Folge.');
    } catch (e) {
      say('::warning::[druckenmiller] der urspruengliche Marker liess sich nicht erhalten: ' + e.message);
    }
  }
}

function checkExportRumpf({ outDir, exportDir, pricesDir, protocolDir }, say) {
  const rot = (grund) => {
    say('::error::' + grund);
    schreibeMarkerEinmal(exportDir, grund, say);
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
    let j;
    // REVIEW-FUND: hier stand `catch { continue; }`. Eine kaputte candidates.json (Chunk 2)
    // waere still uebersprungen worden, gruen geblieben und mit dem Deploy gefahren — genau
    // die Mischung aus gueltigen und ungueltigen Dateien, die der Vertrag ausschliesst.
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) {
      return rot('[druckenmiller] ' + name + ' im Export-Ordner ist nicht lesbar (' + e.message
        + ') — eine unlesbare Vertragsdatei ist ein Befund, kein Grund zum Weitergehen.');
    }
    if (typeof j.generated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(j.generated_at)) {
      return rot('[druckenmiller] ' + name + ' traegt kein ISO-generated_at (' + JSON.stringify(j.generated_at)
        + ') — zwei Dateien mit demselben `null` haben denselben Stempel und waeren durchgelaufen.');
    }
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
      if (k === 'l6') {
        // L6 ist eine FREMDE Groesse (Kopie aus outputs/macro-regime.json): ein Zustandsname
        // oder null. Ohne diese Zeile waere l6 das einzige Feld ganz ohne Typpruefung —
        // eine Zahl oder ein Objekt liefe durch und stuende so im Tab.
        if (!(typeof z[k] === 'string' || z[k] === null)) {
          return rot('[druckenmiller] l6 in ' + z.date + ' ist ' + JSON.stringify(z[k])
            + ' — erwartet den Zustandsnamen des SPY (Text) oder null.');
        }
        continue;
      }
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
  // `--out --check` machte aus dem Flag einen Pfad und zog danach den ECHTEN Default-Ordner
  // auf einen Marker zusammen; `--check --out` (Flag am Ende) warf in path.resolve(undefined).
  const get = (k, dflt) => {
    const i = args.indexOf(k);
    if (i < 0) return dflt;
    const wert = args[i + 1];
    if (wert === undefined || wert.startsWith('--')) {
      throw new Error('[druckenmiller] ' + k + ' steht ohne Wert da (gefolgt von '
        + JSON.stringify(wert === undefined ? null : wert) + ') — ein Flag als Pfad zu nehmen '
        + 'haette in einem ganz anderen Ordner gearbeitet.');
    }
    return wert;
  };
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
  META_FIELDS, CRON, LABEL, MANDATE, pruefeSectorRs, cronSlot,
};

if (require.main === module) {
  try { process.exit(main()); }
  catch (e) { console.error('::error::' + (e && e.message ? e.message : e)); process.exit(1); }
}
