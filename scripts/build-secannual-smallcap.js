#!/usr/bin/env node
'use strict';
/**
 * 5.2 WEG 1b — SEC-Tiefenschicht fuer das Small-Cap-Universum (Tag 432, Chunk 2).
 * ================================================================================
 * scripts/build-secannual.js deckt nur 124 HG-Namen, weil es zusaetzlich auf
 * "Zyklus-Daempfer-Kandidaten" filtert (oscExcess/revMaxDrawdown/signFlips-Schwellen) —
 * fuer den capitalEfficiency-SEC-Praeferenz-Fix (Chunk 3) braucht es SEC-annualOpInc
 * fuer JEDEN Small-Cap-Namen mit verfuegbaren Daten, nicht nur volatile Kandidaten.
 * Eigene, isolierte Ausgabedatei (external-data/sec-secannual-smallcap.json) statt die
 * bestehende Merge-Basis der 124 HG-Namen anzufassen — additiv, run-screener.js
 * mergeSecIntoUniverse() liest beide Dateien in denselben snapshot.secAnnual-Kanal
 * (disjunkte Ticker-Raeume: $300-800M-Band vs. HG-Kandidaten aus dem $800M+-Korpus).
 *
 * Universum: snapshots-smallcap/ (WEG-1b-Datenpfad, NICHT snapshots/), Route ueber
 * smallcapRoute() (isUS + $300-800M-Band bereits eingebaut). Kein Kandidaten-Filter —
 * jeder gerouteter Name mit >=1 SEC-OpInc-Jahr wird versucht.
 *
 * Run:  SEC_XBRL_CACHE_DIR=<temp ausserhalb OneDrive> node scripts/build-secannual-smallcap.js
 *       (dieselbe gratis SEC-API + derselbe Companyfacts-Cache wie build-secannual.js.)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SNAP = process.env.SEC_SMALLCAP_SNAPSHOTS_DIR || path.join(ROOT, 'snapshots-smallcap');
const CACHE = process.env.SEC_XBRL_CACHE_DIR || path.join(require('os').tmpdir(), 'sec-xbrl-cache');
const OUT = path.join(ROOT, 'external-data', 'sec-secannual-smallcap.json');
const { smallcapRoute } = require(path.join(ROOT, 'src/scoring/smallcap-route.js'));
const { extractSecSeries } = require(path.join(ROOT, 'merge-sec-xbrl.js'));
const { fetchSecTickers } = require(path.join(ROOT, 'discovery/sec-tickers.js'));
const { writeFileAtomic } = require(path.join(ROOT, 'lib/atomic-write.js'));
// AX-SK-002 (P0-Haertung 4, 09.08.2026): ladeMergeBasis kommt aus build-secannual.js —
// dieselbe Regel, EIN Ort. Hier stand die halbe Fix-Luecke zu F-CGPT-020: ein blankes
// `catch (_) { out = {} }` machte eine VORHANDENE, aber unlesbare
// external-data/sec-secannual-smallcap.json von "gibt es noch nicht" ununterscheidbar —
// der Lauf schrieb seinen Teilbestand darueber und ging mit Exit 0 raus.
const { newestPresent, bilanzGuardOk, chooseCacheSource, get, sleep, looseSanity, ladeMergeBasis } = require('./build-secannual.js');

// T569-F4: derselbe blanke `catch (_) { continue; }` wie in build-secannual.js, nur auf der
// KLEINEREN Population (watchlist-smallcap.json fuehrt 596 Namen, on-disk liegen ~100) — die
// Wache bekommt deshalb die Small-Cap-Mindestfallzahl, sonst waere sie hier nie scharf.
// Fehlendes Verzeichnis bleibt unveraendert das leise Fallback-Signal (leeres Array).
const { assertParseFailAnteil, MAX_PARSE_FAIL_ANTEIL, MIN_PARSE_FAIL_FAELLE_SMALLCAP } =
  require(path.join(ROOT, 'src/scoring/run-screener.js'));
function loadSmallcapUniverse(snapDir = SNAP) {
  const u = [];
  let files;
  try { files = fs.readdirSync(snapDir); } catch (_) { return u; }
  let parseFail = 0, skippedNoMeta = 0;
  for (const f of files) {
    if (!f.endsWith('.json') || f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
    let s; try { s = JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8')); } catch (_) { parseFail++; continue; }
    if (s && s.meta && s.meta.ticker) u.push(s);
    else skippedNoMeta++;
  }
  assertParseFailAnteil(u.length, parseFail, skippedNoMeta,
    MAX_PARSE_FAIL_ANTEIL, MIN_PARSE_FAIL_FAELLE_SMALLCAP, 'build-secannual-smallcap loadSmallcapUniverse');
  return u;
}

function assertNonEmptyUniverse(universe) {
  if (universe.length === 0) {
    throw new Error('secAnnual-smallcap: kein snapshots-smallcap/ Universum gefunden - Build fehlgeschlagen, Altbestand unveraendert');
  }
}

async function run() {
  // Wie in build-secannual.js (R609-4): der Wurf bei unlesbarem Store gehoert VOR jede
  // Netzrunde und vor den Universums-Check — ein Lauf, der ohnehin nichts schreiben darf,
  // soll SEC nicht erst befragen, und der Wurf ist so netzfrei nachweisbar.
  const out = ladeMergeBasis(OUT);
  const preCount = Object.keys(out).length;
  console.log('Merge-Basis:', preCount, 'bestehende Namen geladen');

  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  const uni = loadSmallcapUniverse();
  assertNonEmptyUniverse(uni);
  const cands = uni.filter((s) => smallcapRoute(s).action === 'route').map((s) => s.meta.ticker);
  console.log('Small-Cap geroutet:', cands.length, 'von', uni.length, 'Snapshots');
  const tmap = await fetchSecTickers();
  let pulled = 0, cachedF = 0, noCik = 0, no404 = 0, divergent = 0, noSeries = 0;
  const repoDir = path.join(ROOT, 'external-data', 'sec-xbrl');
  for (const tk of cands) {
    const entry = tmap.get(tk); const cik = entry && entry.cik;
    if (!cik) { noCik++; continue; }
    const repoCache = path.join(repoDir, cik + '.json'), tmpFile = path.join(CACHE, cik + '.json');
    let body = null;
    const repoExists = fs.existsSync(repoCache), tmpExists = fs.existsSync(tmpFile);
    const cacheSrc = chooseCacheSource(repoExists, tmpExists,
      repoExists ? fs.statSync(repoCache).mtimeMs : -Infinity,
      tmpExists ? fs.statSync(tmpFile).mtimeMs : -Infinity);
    if (cacheSrc === 'tmp') { body = fs.readFileSync(tmpFile, 'utf8'); cachedF++; }
    else if (cacheSrc === 'repo') { body = fs.readFileSync(repoCache, 'utf8'); }
    else {
      try { body = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`); }
      catch (e) { console.log('  pull-fail', tk, cik, e.message); await sleep(125); continue; }
      if (!body) { no404++; await sleep(125); continue; }
      writeFileAtomic(tmpFile, body); pulled++; await sleep(130);
    }
    let sec; try { sec = extractSecSeries(JSON.parse(body), tk); } catch (_) { continue; }
    // taxonomie===null: weder us-gaap noch ifrs-full liefert ein Jahresdatum (haeufigster
    // Grund: der Filer berichtet nicht in USD). Zaehlt als 'nicht verfuegbar' im selben
    // Zaehler wie die leere Serie — nie eine 0, nie ein geschaetzter Wert.
    if (!sec || !sec.taxonomie || !sec.annual || !(sec.annual.annualOpInc || []).length) { noSeries++; continue; }
    const snap = uni.find((x) => x.meta.ticker === tk);
    if (!looseSanity(snap.annual && snap.annual.annualOpInc, sec.annual.annualOpInc, snap.annual && snap.annual.annualRev, sec.annual.annualRev)) { divergent++; continue; }
    // taxonomie = HERKUNFT der Reihen (us-gaap|ifrs-full), gleiche Ebene wie cik/nfy.
    out[tk] = { cik, taxonomie: sec.taxonomie, nfy: sec.annual._fys[0], annualOpInc: sec.annual.annualOpInc, annualRev: sec.annual.annualRev,
      annualNetIncome: sec.annual.annualNetIncome, annualFCF: sec.annual.annualFCF, annualOCF: sec.annual.annualOCF,
      annualShares: sec.annual.annualShares };
    if (bilanzGuardOk(newestPresent(sec.annual.annualAssets), newestPresent(sec.annual.annualCurrentLiabilities))) {
      out[tk].annualAssets = sec.annual.annualAssets;
      out[tk].annualCurrentLiabilities = sec.annual.annualCurrentLiabilities;
    }
  }
  writeFileAtomic(OUT, JSON.stringify(out));
  const postCount = Object.keys(out).length;
  console.log(`secAnnual-smallcap: ${postCount} Namen (${preCount}->${postCount}, +${postCount - preCount} akkumuliert) -> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB) | pulled=${pulled} cached=${cachedF} noCik=${noCik} 404=${no404} divergent=${divergent} noSeries=${noSeries}`);
}

if (require.main === module) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run, loadSmallcapUniverse, assertNonEmptyUniverse };
