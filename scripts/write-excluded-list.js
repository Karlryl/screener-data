#!/usr/bin/env node
'use strict';
/**
 * write-excluded-list.js — die Ausschluss-Liste (Karl-Entscheid 02.08.2026).
 *
 *   node scripts/write-excluded-list.js      # baut outputs/findash-export/v1/excluded.json
 *
 * WARUM ES DIESE DATEI GIBT
 * -------------------------
 * In score.js produceRankings() faellt jede nicht bewertbare Zeile so:
 *     excluded[k] = (excluded[k] || 0) + 1;  continue;
 * Ein Zaehler steigt, die Zeile ist weg. Kein Kuerzel, kein Name ueberlebt. Am Stand
 * vom 19.08. traf das 5.792 Zeilen aus elf Gruenden — darunter echte Wachstumsfirmen
 * (Nubank, Upstart, Palomar, Lemonade, Root, SoFi). Karls eigener Entscheid vom
 * 02.08. steht woertlich in derselben Datei: "Eine Grenze, die Namen wegnimmt, wird
 * durch eine Einteilung ersetzt, die sie sortiert — niemand verschwindet."
 *
 * DER AUSSCHLUSS SELBST BLEIBT. Hier wird NICHTS geoeffnet und NICHTS neu bewertet:
 * Banken und Versicherer in die Umsatz-Achsen zu lassen setzt Japan Post (+5.420 %),
 * AGNC (+3.650 %) und Sompo (+3.409 %) an die Spitze — reine Bilanz- und
 * Anlageergebnis-Artefakte. Diese Datei macht nur SICHTBAR, wer ausgeschlossen wurde.
 *
 * EINE REGEL-QUELLE, NICHT ZWEI
 * -----------------------------
 * Die Gruende werden NICHT nachgebaut. Gelaufen wird derselbe scoreUniverse()-Pass,
 * den run-screener.js fuer die Boards fuehrt; gesammelt werden genau die Zeilen, die
 * produceRankings() wegzaehlt (action 'exclude' oder 'unrouted'), mit demselben
 * Schluessel (`reason || action`, score.js:1416).
 *
 * WICHTIG (Befund beim Bau): route() allein traegt nur ACHT der elf Gruende
 * (non-us, telecom, balance-sheet-bank, insurer, mortgage-reit, non-operating-rev,
 * lender-gp0, no-sector). Die drei uebrigen entstehen erst in scoreUniverse():
 * data-suspect (Qualitaets-Gate vor dem Scoren), dup-issuer (Emittenten-Dedup) und
 * no-axes (alle Roh-Achsen null). Ein Skript, das nur route() befragt, verloere
 * 2.896 der 5.792 Zeilen — die Haelfte der Liste, still. Deshalb der volle Pass.
 *
 * DIE SUMMEN-WACHE IST DER PRODUKT-KERN
 * -------------------------------------
 * Eine Liste, die WENIGER enthaelt als der Zaehler behauptet, ist genau der stille
 * Verlust, den sie beheben soll. Darum wird je Grund gegen die bereits geschriebenen
 * Zaehler in outputs/findash-export/v1/index.json.excluded geprueft und bei jeder
 * Abweichung ABGEBROCHEN (kein Schreiben, exit 1) — nicht gewarnt.
 *
 * FIRMEN STATT BOERSENPLAETZE
 * ---------------------------
 * Mehrfach-Beine desselben Emittenten (HSBC haelt drei) werden ueber issuerDedupGroups()
 * aus score.js zusammengefasst — dieselbe Gruppierung, die die Produktion fuer den
 * Dedup nutzt, keine zweite. Zusammengefasst heisst NICHT verschluckt: jedes Bein steht
 * einzeln unter `beine`, die Summen-Wache zaehlt Beine, nicht Firmen.
 *
 * Waechter: tests/scoring/ausschlussliste.test.js
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { loadUniverse } = require('../src/scoring/run-screener.js');
const {
  scoreUniverse, issuerKeyLoose, issuerDedupGroups, issuerDedupComparator, tickerOf,
} = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'outputs', 'findash-export', 'v1');
const OUT_FILE = path.join(OUT_DIR, 'excluded.json');
const INDEX_FILE = path.join(OUT_DIR, 'index.json');
const SCHEMA = 'findash-export/v1';

// Derselbe Schluessel wie produceRankings (score.js:1416). Bewusst hier als EINZEILER
// gespiegelt statt neu gedacht: 'unrouted' traegt kein reason, faellt also auf action.
const grundVon = (e) => e.reason || e.action;

// Eine Ausschluss-Zeile, wie Karl sie liest. name/sector/marketCap/revGrowthYoYPct
// haengt scoreUniverse selbst an JEDE Ergebniszeile (score.js "A2", auch an die
// excludierten); industry lebt nur im Snapshot und kommt darum von dort.
function zeile(e) {
  const meta = (e.snapshot && e.snapshot.meta) || null;
  return {
    ticker: e.ticker,
    name: e.name ?? null,
    reason: grundVon(e),
    sector: e.sector ?? null,
    industry: (meta && typeof meta.industry === 'string' && meta.industry) || null,
    marketCap: Number.isFinite(e.marketCap) ? e.marketCap : null,
    revGrowthYoYPct: Number.isFinite(e.revGrowthYoYPct) ? e.revGrowthYoYPct : null,
  };
}

// Wachstum absteigend, Namenlose ans Ende, Ticker als deterministischer Tie-Break.
// (Karls erste Frage an diese Liste ist "wer waechst da unten am staerksten".)
function nachWachstum(a, b) {
  const av = Number.isFinite(a.revGrowthYoYPct) ? a.revGrowthYoYPct : -Infinity;
  const bv = Number.isFinite(b.revGrowthYoYPct) ? b.revGrowthYoYPct : -Infinity;
  if (av !== bv) return bv - av;
  return String(a.ticker) < String(b.ticker) ? -1 : (String(a.ticker) > String(b.ticker) ? 1 : 0);
}

/**
 * results (aus scoreUniverse) + universe -> { rows, legs, byReason }.
 * Reine Funktion, kein I/O — der Waechter fuettert sie mit Fixtures.
 */
function buildExcludedList(results, universe) {
  const snapshotVon = new Map((universe || []).map((s) => [tickerOf(s), s]));
  // scoreUniverse LOESCHT e.snapshot am Ende (score.js:1334, belegt in run-screener
  // lampeBNachruesten). Der Snapshot kommt deshalb ueber tickerOf zurueck — denselben
  // Schluessel, den scoreUniverse an die Zeile schreibt. Ohne ihn gaebe es weder
  // industry noch einen Emittenten-Schluessel, und beides waere still leer.
  const mitSnapshot = (e) => ({ ...e, snapshot: snapshotVon.get(e.ticker) || null });

  const raus = (Array.isArray(results) ? results : [])
    .filter((e) => e.action === 'exclude' || e.action === 'unrouted').map(mitSnapshot);
  const drin = (Array.isArray(results) ? results : [])
    .filter((e) => e.action === 'route' || e.action === 'survival').map(mitSnapshot);

  // dup-issuer stellt fast die Haelfte der Liste. Ohne diesen Hinweis liest sich die
  // Zeile, als sei die Firma weg — dabei steht ihr Hauptlisting auf dem Board.
  const imBoard = new Map();
  for (const e of drin) {
    const k = issuerKeyLoose(e.snapshot);
    if (k && !imBoard.has(k)) imBoard.set(k, e.ticker);
  }

  // issuerDedupGroups() laesst Eintraege OHNE Emittenten-Schluessel (kein meta.name)
  // ersatzlos fallen — in der Produktion harmlos (sie koennen nicht Dublette sein),
  // hier waere es exakt der stille Verlust, gegen den diese Datei gebaut ist. Sie
  // werden darum als eigene Ein-Bein-Gruppen nachgereicht.
  const ohneSchluessel = raus.filter((e) => !issuerKeyLoose(e.snapshot));
  const gruppen = issuerDedupGroups(raus).concat(ohneSchluessel.map((e) => [e]));

  const rows = gruppen.map((g) => {
    // Derselbe Comparator, den die Produktion fuer die Bein-Wahl nutzt (score.js) —
    // das fuehrende Bein ist damit dasselbe, das der Dedup bevorzugt haette.
    const beine = g.slice().sort(issuerDedupComparator);
    const kopf = zeile(beine[0]);
    const key = issuerKeyLoose(beine[0].snapshot) || null;
    return {
      ...kopf,
      issuerKey: key,
      // Ticker eines Beins DERSELBEN Firma, das bewertet wurde (sonst null).
      imBoardAls: key ? (imBoard.get(key) || null) : null,
      beine: beine.map(zeile),
    };
  }).sort(nachWachstum);

  const byReason = {};
  for (const e of raus) { const k = grundVon(e); byReason[k] = (byReason[k] || 0) + 1; }

  return { rows, legs: raus.length, byReason };
}

/**
 * Summen-Wache: je Grund Liste gegen index.json.excluded. Gibt die Abweichungen
 * zurueck (leer = sauber). Ueber die VEREINIGUNG beider Schluesselmengen — ein Grund,
 * den nur eine Seite kennt, ist genauso ein Bruch wie eine falsche Zahl.
 */
function pruefeSummen(byReason, indexExcluded) {
  const links = byReason || {};
  const rechts = indexExcluded || {};
  const fehler = [];
  for (const k of [...new Set([...Object.keys(links), ...Object.keys(rechts)])].sort()) {
    const a = links[k] || 0, b = rechts[k] || 0;
    if (a !== b) fehler.push(`${k}: Liste ${a}, index.json.excluded ${b}`);
  }
  return fehler;
}

// Anzahl der Beine ueber alle Firmenzeilen — muss legs entsprechen, sonst hat die
// Gruppierung selbst etwas verschluckt.
const beineGesamt = (rows) => rows.reduce((n, r) => n + r.beine.length, 0);

function main() {
  const universe = loadUniverse();
  // Gleicher Referenz-Modus wie run-screener.js: ist ein Lineal gesetzt, muss dieser
  // Pass gegen DASSELBE scoren, sonst weichen die no-axes-Zahlen ab und die
  // Summen-Wache faerbt den Lauf zu Recht rot. Fail-loud wie dort.
  let refCalibration = null;
  const refPath = process.env.SCORING_REF_CALIB;
  if (refPath) {
    try { refCalibration = JSON.parse(fs.readFileSync(refPath, 'utf8')); }
    catch (e) { throw new Error(`[excluded-list] SCORING_REF_CALIB gesetzt, aber nicht lesbar (${refPath}): ${e.message}`); }
  }
  const results = scoreUniverse(universe, formulas, refCalibration ? { refCalibration } : {});
  const { rows, legs, byReason } = buildExcludedList(results, universe);

  // Der Zaehler, gegen den geprueft wird, MUSS da sein. "Nicht da" darf nicht
  // stillschweigend zu "keine Abweichung" werden.
  let idx;
  try { idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); }
  catch (e) {
    throw new Error(`[excluded-list] ${path.relative(ROOT, INDEX_FILE)} fehlt/unlesbar (${e.message}) — `
      + 'ohne die Zaehler ist die Liste unpruefbar. Zuerst run-screener.js und write-findash-export.js laufen lassen.');
  }
  if (!idx.excluded || typeof idx.excluded !== 'object') {
    throw new Error('[excluded-list] index.json traegt kein excluded-Objekt — Liste unpruefbar.');
  }

  const fehler = pruefeSummen(byReason, idx.excluded);
  if (fehler.length) {
    throw new Error('[excluded-list] Summen-Wache gebrochen — die Liste deckt sich nicht mit den Zaehlern:\n  '
      + fehler.join('\n  '));
  }
  if (beineGesamt(rows) !== legs) {
    throw new Error(`[excluded-list] Gruppierung hat Zeilen verschluckt: ${beineGesamt(rows)} Beine in ${rows.length} Firmen, erwartet ${legs}.`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeJsonAtomic(OUT_FILE, {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    generatedFromSnapshots: universe.length,
    counts: { firmen: rows.length, zeilen: legs, byReason },
    rows,
  });
  console.log(`[excluded-list] ${legs} Ausschluss-Zeilen in ${rows.length} Firmen -> ${path.relative(ROOT, OUT_FILE)} `
    + `(${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`[excluded-list] Summen je Grund decken sich mit index.json.excluded: `
    + Object.keys(byReason).sort().map((k) => `${k}=${byReason[k]}`).join(' · '));
}

module.exports = { buildExcludedList, pruefeSummen, beineGesamt, grundVon, zeile, SCHEMA, OUT_FILE, INDEX_FILE };

if (require.main === module) main();
