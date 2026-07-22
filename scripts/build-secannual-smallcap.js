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
const { newestPresent, bilanzGuardOk, chooseCacheSource, get, sleep, looseSanity } = require('./build-secannual.js');

function loadSmallcapUniverse() {
  const u = [];
  let files;
  try { files = fs.readdirSync(SNAP); } catch (_) { return u; }
  for (const f of files) {
    if (!f.endsWith('.json') || f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
    let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP, f), 'utf8')); } catch (_) { continue; }
    if (s && s.meta && s.meta.ticker) u.push(s);
  }
  return u;
}

async function run() {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  const uni = loadSmallcapUniverse();
  if (uni.length === 0) {
    console.log('::warning::secAnnual-smallcap: kein snapshots-smallcap/ Universum gefunden - Build uebersprungen, Datei unveraendert');
    return;
  }
  const cands = uni.filter((s) => smallcapRoute(s).action === 'route').map((s) => s.meta.ticker);
  console.log('Small-Cap geroutet:', cands.length, 'von', uni.length, 'Snapshots');
  const tmap = await fetchSecTickers();
  let out = {};
  try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); console.log('Merge-Basis:', Object.keys(out).length, 'bestehende Namen geladen'); } catch (_) { out = {}; }
  const preCount = Object.keys(out).length;
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
    let sec; try { sec = extractSecSeries(JSON.parse(body)); } catch (_) { continue; }
    if (!sec || !sec.annual || !(sec.annual.annualOpInc || []).length) { noSeries++; continue; }
    const snap = uni.find((x) => x.meta.ticker === tk);
    if (!looseSanity(snap.annual && snap.annual.annualOpInc, sec.annual.annualOpInc, snap.annual && snap.annual.annualRev, sec.annual.annualRev)) { divergent++; continue; }
    out[tk] = { cik, nfy: sec.annual._fys[0], annualOpInc: sec.annual.annualOpInc, annualRev: sec.annual.annualRev,
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

module.exports = { run, loadSmallcapUniverse };
