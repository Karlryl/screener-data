#!/usr/bin/env node
'use strict';
/**
 * A1 — Gerichts-Abhilfe zu K1 (Urteil _COURT-T164-OPINC-2026-08-29.md, ratifiziert als
 * ENTSCHIED 15 vom 29.08.2026). Quellschicht, unversiegelt.
 *
 * ─── WAS DAS URTEIL VERLANGT ────────────────────────────────────────────────────
 * K1.1  SEC-GAAP-OpInc beim Snapshot-Merge bevorzugen, wo eine SEC-Serie existiert.
 * K1.2  Das Etikett 'native' stirbt. meta.opIncSource wird ehrlich.
 * K1.3  Namen OHNE SEC-Serie behalten die Yahoo-Serie — kein Name verliert Daten,
 *       kein Exclude fuer Nur-Yahoo-Namen.
 * K1.4  Board-Diff des Rebuilds dokumentieren (HNRG/EGY-Flips explizit).
 *
 * ─── SEMANTIK VON meta.opIncSource (die EINE Stelle, an der sie definiert ist) ──
 *   'sec-gaap'         Die Jahresreihe annual.annualOpInc stammt aus dem eingereichten
 *                      SEC-XBRL-Filing (us-gaap/ifrs-full, via merge-sec-xbrl.js ->
 *                      external-data/*-secannual.json). GAAP-as-filed, versioniert,
 *                      reproduzierbar. Die ersetzte Yahoo-Reihe bleibt unter
 *                      annual.annualOpIncYahoo erhalten (K1.3: kein Name verliert Daten).
 *   'yahoo-adjusted'   Die Reihe stammt aus Yahoo (quoteSummary isHist bzw.
 *                      fundamentalsTimeSeries). Yahoo bereinigt still und unversioniert
 *                      (Impairments, Restrukturierung) — deshalb NICHT 'native':
 *                      das alte Etikett behauptete eine Roh-Herkunft, die es nicht gibt.
 *                      Ehrlich etikettierter Fallback/Proxy, kein Fehler.
 *   'computed-margin'  Synthetisch: annualRev x operatingMargins-TTM (Financial-Services-
 *                      Fallback, pull-yahoo.js _deriveOpIncForFinancials Pfad 3).
 *   'computed-bank'    Synthetisch: totalRev - totalOpEx - Kreditrisikovorsorge (Pfad 1).
 *   'computed-insurance' Synthetisch: totalRev - costOfRev - SG&A (Pfad 2).
 *   null               Keine OpInc-Reihe vorhanden.
 *
 * ─── WARUM HIER UND NICHT IM MERGE-JOB ──────────────────────────────────────────
 * scripts/build-secannual.js validiert die SEC-Reihe GEGEN die Yahoo-Reihe des Stores
 * (looseSanity: gleiches Vorzeichen im neuesten Jahr, ~2x-Umsatzskala). Schriebe dieser
 * Schritt seine SEC-Werte in das Artefakt, das monthly-sec-xbrl.yml zieht, vergliche
 * looseSanity kuenftig SEC gegen SEC — das Tor waere still zur Tautologie geworden.
 * Deshalb laeuft dieser Schritt im SCORING-Job (unmittelbar vor run-screener.js), nicht
 * im Merge-Job: er beruehrt weder die Shard-Caches noch das hochgeladene snapshots-
 * Artefakt. Zweite Sicherung im selben Sinn: build-secannual{,-smallcap}.js liest fuer
 * looseSanity annual.annualOpIncYahoo, wo es existiert.
 *
 * ─── DIE AUSRICHTUNGS-BEDINGUNG (Antwort auf den R2-Dissens) ────────────────────
 * Der Yahoo-Jahresblock traegt keine Jahres-Labels; dass Position i beider Quellen
 * dasselbe Geschaeftsjahr meint, ist NICHT aus den Daten ableitbar (merge-sec-xbrl.js
 * :419-431: Versatz 0 nur bei 80,6 % der Firmen bestaetigt). Ein blinder Tausch veraendert
 * bei jeder fuenften Firma zwei verschiedene Jahre gegeneinander. Deshalb wird die
 * Ausrichtung je Name AM UMSATZ BELEGT — in beiden Quellen eindeutig, keine
 * Definitionsfrage — mit derselben 2-%-Schwelle wie die Erhebung vom 28.07.
 * Kein Beleg -> kein Tausch. Die Luecke wird benannt, nicht erfunden.
 *
 * ─── DIE ERSETZUNGSREGEL ────────────────────────────────────────────────────────
 * Ersetzt wird POSITIONSWEISE ueber die LAENGE der Yahoo-Reihe. Die tiefere SEC-Reihe
 * bleibt dem Scoring ueber den bestehenden additiven Kanal snapshot.secAnnual erhalten
 * (run-screener.js mergeSecIntoUniverse) — Vertiefung ist Abhilfe A3, nicht A1. Ein
 * laengen-veraendernder Tausch wuerde die positionale Kopplung annualRev[i] <->
 * annualOpInc[i] brechen, auf der revAcceleration/marginTrajectory/ruleOfX stehen.
 * Hat die SEC-Reihe im Fenster ein Loch, wo Yahoo einen Wert traegt, wird der Name
 * NICHT getauscht: eine gemischte Reihe haette zwei Definitionen in einem Feld —
 * genau der Zustand, den das Urteil beendet.
 *
 * ─── IDEMPOTENZ ────────────────────────────────────────────────────────────────
 * Die Transformation ist eine reine Funktion aus (Yahoo-Reihe, SEC-Schicht). Liegt
 * annual.annualOpIncYahoo bereits vor, ist ES die Yahoo-Referenz — ein zweiter Lauf
 * kettet nichts. Faellt eine SEC-Serie spaeter weg oder reisst die Ausrichtung, wird
 * die Yahoo-Reihe daraus WIEDERHERGESTELLT und das Etikett faellt zurueck. Kein Ratchet.
 *
 * Usage:
 *   node scripts/opinc-source-migrate.js                        # snapshots + snapshots-smallcap
 *   node scripts/opinc-source-migrate.js --dir snapshots --dry-run
 *   node scripts/opinc-source-migrate.js --json reports/opinc-diff.json
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');

const ROOT = path.join(__dirname, '..');

// Dieselben fuenf Dateien, die src/scoring/run-screener.js SECANNUAL_FILES liest.
// EINE Quelle der Wahrheit fuer "welche SEC-Schichten gibt es" — wer dort eine Datei
// ergaenzt, muss sie hier ergaenzen, sonst weicht die Praeferenz vom secAnnual-Kanal ab.
const SECANNUAL_FILES = ['sec-secannual.json', 'sec-secannual-smallcap.json',
  'kr-secannual.json', 'jp-secannual.json', 'tw-secannual.json'];
const DEFAULT_DIRS = ['snapshots', 'snapshots-smallcap'];

// Schwelle der 28.07.-Erhebung (merge-sec-xbrl.js:423-427). Dort wurde mit <2 %
// Umsatzabweichung der beste Jahres-Versatz je Firma bestimmt; hier ist dieselbe
// Schwelle das Tor. Eine Konstante am Modulkopf wie MAX_UEBERSPRUNGEN_ANTEIL in
// filter-snapshot-merge.js — dieses Repo fuehrt Schwellen dort, nicht in einer Config.
const REV_ALIGN_TOL = 0.02;
// Ein einziges uebereinstimmendes Umsatzjahr belegt keine Ausrichtung (jede Reihe trifft
// irgendwo einmal). Zwei Positionen sind das Minimum, ab dem ein Versatz auffiele.
const REV_ALIGN_MIN_PAIRS = 2;

const val = (x) => (x && typeof x === 'object') ? x.value : x;
const fin = (x) => Number.isFinite(val(x));

/**
 * Ehrliches Etikett fuer eine Yahoo-stammende Reihe. 'native' war die Luege: es behauptete
 * Roh-Herkunft, wo Yahoo still bereinigt. Synthetische Etiketten bleiben unangetastet —
 * sie waren nie unehrlich (Urteil K2: "ist bereits ehrlich gesetzt").
 */
function honestYahooLabel(src) {
  if (src === 'native' || src === undefined) return 'yahoo-adjusted';
  return src;
}

/**
 * Ausrichtungs-Beleg am Umsatz ueber das Fenster [0, n). Gibt {pairs, maxRel} zurueck.
 * pairs = Zahl positionsweise vergleichbarer Umsatzjahre, maxRel = groesste relative
 * Abweichung darunter.
 */
function revAlignment(yahooRev, secRev, n) {
  const y = Array.isArray(yahooRev) ? yahooRev : [];
  const s = Array.isArray(secRev) ? secRev : [];
  let maxRel = 0, pairs = 0;
  for (let i = 0; i < Math.min(n, y.length, s.length); i++) {
    const a = val(y[i]), b = val(s[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const denom = Math.max(Math.abs(a), Math.abs(b));
    if (denom === 0) continue;
    maxRel = Math.max(maxRel, Math.abs(a - b) / denom);
    pairs++;
  }
  return { pairs, maxRel };
}

/**
 * Kernentscheid je Snapshot. REIN — mutiert nichts, liest nur.
 * Gibt zurueck: { label, opInc|null, reason, alignment }
 *   opInc === null  -> annualOpInc bleibt die Yahoo-Reihe (bzw. wird darauf zurueckgesetzt)
 *   opInc !== null  -> diese Reihe ersetzt annualOpInc, Etikett 'sec-gaap'
 * reason benennt IMMER, warum — auch beim Nicht-Tausch (die Luecke wird ausgesprochen).
 */
function decideOpInc(snapshot, secEntry) {
  const annual = (snapshot && snapshot.annual) || {};
  const meta = (snapshot && snapshot.meta) || {};
  // Idempotenz: liegt eine bewahrte Yahoo-Reihe vor, ist SIE die Referenz.
  const yahooOpInc = Array.isArray(annual.annualOpIncYahoo) ? annual.annualOpIncYahoo
    : (Array.isArray(annual.annualOpInc) ? annual.annualOpInc : []);
  // War die aktuelle Reihe schon SEC, ist das Alt-Etikett das der Yahoo-Reihe.
  const yahooLabel = honestYahooLabel(
    meta.opIncSource === 'sec-gaap' ? (meta.opIncSourceYahoo || 'native') : meta.opIncSource);

  const n = yahooOpInc.length;
  const secOpInc = (secEntry && Array.isArray(secEntry.annualOpInc)) ? secEntry.annualOpInc : null;
  if (!secOpInc || !secOpInc.length) {
    return { label: yahooLabel, opInc: null, reason: 'no-sec-series', alignment: null };
  }
  if (!n) {
    // Keine Yahoo-Reihe -> kein Fenster, keine Ausrichtungspruefung moeglich. Der additive
    // secAnnual-Kanal traegt die SEC-Serie ohnehin; hier wird nichts erfunden.
    return { label: yahooLabel, opInc: null, reason: 'no-yahoo-window', alignment: null };
  }
  const alignment = revAlignment(annual.annualRev, secEntry.annualRev, n);
  if (alignment.pairs < REV_ALIGN_MIN_PAIRS) {
    return { label: yahooLabel, opInc: null, reason: 'alignment-unprovable', alignment };
  }
  if (alignment.maxRel > REV_ALIGN_TOL) {
    return { label: yahooLabel, opInc: null, reason: 'alignment-failed', alignment };
  }
  for (let i = 0; i < n; i++) {
    if (fin(yahooOpInc[i]) && !fin(secOpInc[i])) {
      return { label: yahooLabel, opInc: null, reason: 'sec-series-hole', alignment };
    }
  }
  // Positionsweise ueber die Yahoo-Fensterlaenge; {value:n}-Zellen wie ueberall im Store.
  const merged = [];
  for (let i = 0; i < n; i++) {
    const v = val(secOpInc[i]);
    merged.push(Number.isFinite(v) ? { value: v } : null);
  }
  return { label: 'sec-gaap', opInc: merged, reason: 'sec-preferred', alignment };
}

/**
 * Wendet den Entscheid auf den Snapshot an (in place). Gibt {changed, before, after, ...}.
 * Reihenfolge der Felder bleibt erhalten, damit der Diff lesbar bleibt.
 */
function migrateSnapshot(snapshot, secEntry) {
  const d = decideOpInc(snapshot, secEntry);
  snapshot.annual = snapshot.annual || {};
  snapshot.meta = snapshot.meta || {};
  const annual = snapshot.annual, meta = snapshot.meta;
  const yahooOpInc = Array.isArray(annual.annualOpIncYahoo) ? annual.annualOpIncYahoo
    : (Array.isArray(annual.annualOpInc) ? annual.annualOpInc : []);
  const before = (Array.isArray(annual.annualOpInc) ? annual.annualOpInc : []).map(val);
  const prevLabel = meta.opIncSource === undefined ? null : meta.opIncSource;

  if (d.opInc) {
    // K1.3: die ersetzte Yahoo-Reihe bleibt am Datensatz — kein Name verliert Daten.
    annual.annualOpIncYahoo = yahooOpInc;
    meta.opIncSourceYahoo = honestYahooLabel(
      meta.opIncSource === 'sec-gaap' ? (meta.opIncSourceYahoo || 'native') : meta.opIncSource);
    annual.annualOpInc = d.opInc;
    meta.opIncSource = 'sec-gaap';
  } else {
    // Rueckweg: war vorher SEC, faellt die Yahoo-Reihe zurueck an ihren Platz.
    if (Array.isArray(annual.annualOpIncYahoo)) {
      annual.annualOpInc = annual.annualOpIncYahoo;
      delete annual.annualOpIncYahoo;
      delete meta.opIncSourceYahoo;
    }
    meta.opIncSource = d.label === undefined ? null : d.label;
  }
  const after = (Array.isArray(annual.annualOpInc) ? annual.annualOpInc : []).map(val);
  const valuesChanged = before.length !== after.length || before.some((v, i) => v !== after[i]);
  const labelChanged = prevLabel !== meta.opIncSource;
  return {
    changed: valuesChanged || labelChanged, valuesChanged, labelChanged,
    before, after, prevLabel, label: meta.opIncSource, reason: d.reason, alignment: d.alignment,
  };
}

function loadSecLayer(root = ROOT, files = SECANNUAL_FILES) {
  const data = {};
  const geladen = [];
  for (const f of files) {
    const p = path.join(root, 'external-data', f);
    try { Object.assign(data, JSON.parse(fs.readFileSync(p, 'utf8'))); geladen.push(f); }
    // FEHLT ist erlaubt (wie mergeSecIntoUniverse), UNLESBAR nicht: eine truncierte
    // Schicht sah bisher aus wie eine abwesende und drehte die Quellen-Praeferenz still
    // zurueck auf den Urteilsanker (HNRG -> yahoo-adjusted / FY2024 -555000), waehrend
    // der Lauf mit Exit 0 weiterlief und run-screener.js direkt danach veroeffentlichte.
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return { data, geladen };
}

function run(opts = {}) {
  const root = opts.root || ROOT;
  const dirs = (opts.dirs && opts.dirs.length ? opts.dirs : DEFAULT_DIRS);
  const dryRun = !!opts.dryRun;
  const { data: sec, geladen } = loadSecLayer(root, opts.secFiles || SECANNUAL_FILES);
  const zusammenfassung = {
    secNamen: Object.keys(sec).length, secDateien: geladen,
    dateien: 0, geschrieben: 0, uebersprungen: 0,
    etiketten: { 'native->yahoo-adjusted': 0, '->sec-gaap': 0, 'sec-gaap->yahoo-adjusted': 0, unveraendert: 0, sonstige: 0 },
    gruende: {}, werteGeaendert: 0,
  };
  const zeilen = [];
  for (const dir of dirs) {
    const abs = path.isAbsolute(dir) ? dir : path.join(root, dir);
    if (!fs.existsSync(abs)) { continue; }
    for (const f of fs.readdirSync(abs)) {
      // Das zentrale Praedikat, nicht `f.startsWith('_')`: ein Ticker kann legitim mit
      // Unterstrich beginnen (Windows-Reservename -> safeSnapshotFilename faltet CON zu _CON).
      // Ein Blanket-Filter haette genau diese Namen still uebersprungen.
      if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
      const p = path.join(abs, f);
      let snap;
      // Ein unlesbarer Snapshot wird uebersprungen, aber GEZAEHLT: sonst ist die Aussage
      // "Restbestand native = 0" aus dieser Ausgabe nicht belegbar — der Name kann
      // genauso gut nur nie geprueft worden sein.
      try { snap = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { zusammenfassung.uebersprungen++; continue; }
      if (!snap || !snap.meta || !snap.meta.ticker) { zusammenfassung.uebersprungen++; continue; }
      zusammenfassung.dateien++;
      const prev = snap.meta.opIncSource;
      const r = migrateSnapshot(snap, sec[snap.meta.ticker]);
      zusammenfassung.gruende[r.reason] = (zusammenfassung.gruende[r.reason] || 0) + 1;
      if (r.label === 'sec-gaap' && prev !== 'sec-gaap') zusammenfassung.etiketten['->sec-gaap']++;
      else if (prev === 'native' && r.label === 'yahoo-adjusted') zusammenfassung.etiketten['native->yahoo-adjusted']++;
      else if (prev === 'sec-gaap' && r.label === 'yahoo-adjusted') zusammenfassung.etiketten['sec-gaap->yahoo-adjusted']++;
      else if (!r.labelChanged) zusammenfassung.etiketten.unveraendert++;
      // Auffangbecken. Ohne dieses `else` fiel genau das Kernszenario des Kopfkommentars
      // durch die Kette: faellt die SEC-Serie weg, wechselt das Etikett sec-gaap ->
      // computed-margin/null und wurde in KEINEM Eimer gezaehlt — sichtbar nur als
      // werteGeaendert ohne passende Etiketten-Bewegung.
      else zusammenfassung.etiketten.sonstige++;
      if (r.valuesChanged) {
        zusammenfassung.werteGeaendert++;
        zeilen.push({ ticker: snap.meta.ticker, dir, prevLabel: r.prevLabel, label: r.label,
          reason: r.reason, before: r.before, after: r.after,
          alignRel: r.alignment ? Number(r.alignment.maxRel.toFixed(5)) : null,
          alignPairs: r.alignment ? r.alignment.pairs : null });
      }
      if (r.changed && !dryRun) { writeFileAtomic(p, JSON.stringify(snap)); zusammenfassung.geschrieben++; }
      else if (r.changed) zusammenfassung.geschrieben++;
    }
  }
  // Die Eimer MUESSEN den geprueften Bestand ausschoepfen. Eine Zensus-Summe, die
  // kleiner ist als die Grundgesamtheit, ist kein Zensus — sie sieht nur so aus.
  const eimerSumme = Object.values(zusammenfassung.etiketten).reduce((a, b) => a + b, 0);
  assert.equal(eimerSumme, zusammenfassung.dateien,
    `opinc-source-migrate: Etiketten-Eimer summieren zu ${eimerSumme}, geprueft wurden `
    + `${zusammenfassung.dateien} Dateien — eine Etiketten-Bewegung faellt durch die Kette.`);
  return { zusammenfassung, zeilen };
}

function main(argv) {
  const dirs = [];
  let dryRun = false, jsonOut = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') dirs.push(argv[++i]);
    else if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--json') jsonOut = argv[++i];
  }
  const { zusammenfassung: z, zeilen } = run({ dirs, dryRun });
  if (!z.secDateien.length) {
    // Fail-loud statt stiller Null: ohne SEC-Schicht taete dieser Schritt nichts, waere
    // aber im Log von "alles bereits migriert" nicht zu unterscheiden.
    console.log('::warning::opinc-source-migrate: keine external-data/*-secannual.json gefunden — '
      + `nur Etiketten-Migration moeglich (${z.dateien} Dateien geprueft).`);
  }
  console.log(`[opinc-source-migrate] ${z.dateien} Snapshots geprueft, ${z.secNamen} SEC-Namen aus `
    + `${z.secDateien.length} Schicht(en)${dryRun ? ' [DRY-RUN]' : ''}`);
  console.log(`[opinc-source-migrate] Etiketten: native->yahoo-adjusted ${z.etiketten['native->yahoo-adjusted']} · `
    + `->sec-gaap ${z.etiketten['->sec-gaap']} · sec-gaap->yahoo-adjusted ${z.etiketten['sec-gaap->yahoo-adjusted']} · `
    + `unveraendert ${z.etiketten.unveraendert}`);
  console.log(`[opinc-source-migrate] Gruende: ${Object.entries(z.gruende).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  console.log(`[opinc-source-migrate] Reihen mit geaenderten Werten: ${z.werteGeaendert} · geschrieben: ${z.geschrieben}`);
  if (z.uebersprungen) {
    console.log(`::warning::opinc-source-migrate: ${z.uebersprungen} Snapshot(s) unlesbar uebersprungen — `
      + `die ${z.dateien} geprueften Dateien decken den Store NICHT vollstaendig ab.`);
  }
  if (jsonOut) {
    const p = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    writeFileAtomic(p, JSON.stringify({ erzeugt: new Date().toISOString(), zusammenfassung: z, zeilen }, null, 1));
    console.log(`[opinc-source-migrate] Diff -> ${p}`);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  decideOpInc, migrateSnapshot, honestYahooLabel, revAlignment, loadSecLayer, run,
  SECANNUAL_FILES, DEFAULT_DIRS, REV_ALIGN_TOL, REV_ALIGN_MIN_PAIRS,
};
