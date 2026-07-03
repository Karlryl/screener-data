#!/usr/bin/env node
'use strict';
/**
 * PHASE 4 Datenschicht-Build (Regenerierungs-Tool, offline/periodisch)
 * ===================================================================
 * Bestimmt die US-Zyklus-Daempfer-Kandidaten am aktuellen Universum, pullt ihre SEC-companyfacts
 * (Netzwerk NUR hier, nie im Scorer), extrahiert die tiefen annual-Serien via merge-sec-xbrl.js,
 * validiert grob gegen Yahoo (loose-sanity: Vorzeichen + Skala ~2x + isolierter-V-Dip-Filter) und
 * schreibt die COMMITTETE, deterministische Datenschicht external-data/sec-secannual.json (klein).
 *
 * Der Scorer (src/scoring/score.js cycleSeriesPair) liest NUR diese committete Datei ueber
 * run-screener.js mergeSecIntoUniverse -> CI==lokal. Fehlt ein Name -> Yahoo-4J-Fallback (byte-identisch).
 *
 * Run:  SEC_XBRL_CACHE_DIR=<temp ausserhalb OneDrive> node scripts/build-secannual.js
 *       (SEC ist gratis; Roh-companyfacts (~GB) landen im Cache-Dir, NICHT im Repo.)
 * SK-Hynix (000660.KS) ist non-US -> per SEC unerreichbar -> bleibt Yahoo-4J (ehrliche Grenze).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const ROOT = path.join(__dirname, '..');
const SNAP = path.join(ROOT, 'snapshots');
const CACHE = process.env.SEC_XBRL_CACHE_DIR || path.join(require('os').tmpdir(), 'sec-xbrl-cache');
const OUT = path.join(ROOT, 'external-data', 'sec-secannual.json');
const UA = 'Karl Viehrig screener-data karl_viehrig@web.de';
const { route, isUS } = require(path.join(ROOT, 'src/scoring/router.js'));
const { norm, presentValues } = require(path.join(ROOT, 'src/scoring/snapshot.js'));
const { signFlips, oscExcess, revMaxDrawdown } = require(path.join(ROOT, 'src/scoring/score.js'));
const { extractSecSeries } = require(path.join(ROOT, 'merge-sec-xbrl.js'));
const { fetchSecTickers } = require(path.join(ROOT, 'discovery/sec-tickers.js'));

function loadUniverse() {
  const u = [];
  for (const f of fs.readdirSync(SNAP)) {
    if (!f.endsWith('.json') || f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
    let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP, f), 'utf8')); } catch (_) { continue; }
    if (s && s.meta && s.meta.ticker) u.push(s);
  }
  return u;
}
function get(url, depth = 0) {
  if (depth > 5) return Promise.reject(new Error('redirects'));
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }, r => {
      if (r.statusCode === 301 || r.statusCode === 302) { r.resume(); return get(r.headers.location, depth + 1).then(res).catch(rej); }
      if (r.statusCode === 404) { r.resume(); return res(null); }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); }
      const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c).toString('utf8'))); r.on('error', rej);
    });
    req.on('error', rej); req.setTimeout(30000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const newestPresent = (arr) => { for (const x of (arr || [])) { const v = x && typeof x === 'object' ? x.value : x; if (Number.isFinite(v)) return v; } return null; };
const plain = (arr) => (arr || []).map(x => x && typeof x === 'object' ? x.value : x).filter(Number.isFinite);
// Grobmuell-Sanity: signFlips/revMaxDrawdown sind vorzeichen-/verhaeltnis-basiert -> robust gegen FY-Versatz +
// Level-Restatement (kein positional-overlap-Guard, der flaggt FY-Versatz falsch). Minimal gegen GENUIN falsches
// Konzept: (1) neuestes OpInc gleiches Vorzeichen; (2) neuester Umsatz ~2x-Skala (RGEN 141M vs 738M); (3) kein
// isoliertes Einzeljahr >10x unter beiden Nachbarn (ARWR 3.5M zwischen 240M/829M = Konzept-Mix-Phantom-Drawdown).
function looseSanity(yOpArr, sOpArr, yRevArr, sRevArr) {
  const yOp = newestPresent(yOpArr), sOp = newestPresent(sOpArr);
  if (yOp !== null && sOp !== null && Math.sign(yOp) !== Math.sign(sOp) && yOp !== 0 && sOp !== 0) return false;
  const yR = newestPresent(yRevArr), sR = newestPresent(sRevArr);
  if (yR !== null && sR !== null && yR > 0 && sR > 0) { if (Math.max(yR, sR) / Math.min(yR, sR) > 2) return false; }
  const r = plain(sRevArr);
  for (let i = 1; i < r.length - 1; i++) { if (r[i] > 0 && r[i] * 10 < r[i - 1] && r[i] * 10 < r[i + 1]) return false; }
  return true;
}

(async () => {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  const uni = loadUniverse();
  const dds = [], routedUS = [];
  for (const s of uni) {
    if (route(s).action !== 'route') continue;
    const op = presentValues(norm(s, 'annualOpInc'));
    if (op.length >= 3) dds.push(revMaxDrawdown(norm(s, 'annualRev')));
    if (isUS(s) && op.length >= 3) routedUS.push({ s, op });
  }
  const p75 = dds.slice().sort((a, b) => a - b)[Math.floor((dds.length - 1) * 0.75)];
  const cands = [];
  for (const { s, op } of routedUS) {
    const osc = oscExcess(op), dd = revMaxDrawdown(norm(s, 'annualRev')), fl = signFlips(op);
    if (osc >= 1 || (dd >= p75 && fl >= 1)) cands.push(s.meta.ticker);
  }
  console.log('US-routed>=3y:', routedUS.length, '| p75=' + p75.toFixed(4), '| Kandidaten:', cands.length);
  const tmap = await fetchSecTickers();
  const out = {};
  let pulled = 0, cachedF = 0, noCik = 0, no404 = 0, divergent = 0;
  const repoDir = path.join(ROOT, 'external-data', 'sec-xbrl');
  for (const tk of cands) {
    const entry = tmap.get(tk); const cik = entry && entry.cik;
    if (!cik) { noCik++; continue; }
    const repoCache = path.join(repoDir, cik + '.json'), tmpFile = path.join(CACHE, cik + '.json');
    let body = null;
    if (fs.existsSync(repoCache)) body = fs.readFileSync(repoCache, 'utf8');
    else if (fs.existsSync(tmpFile)) { body = fs.readFileSync(tmpFile, 'utf8'); cachedF++; }
    else {
      try { body = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`); }
      catch (e) { console.log('  pull-fail', tk, cik, e.message); await sleep(125); continue; }
      if (!body) { no404++; await sleep(125); continue; }
      fs.writeFileSync(tmpFile, body); pulled++; await sleep(130);
    }
    let sec; try { sec = extractSecSeries(JSON.parse(body)); } catch (_) { continue; }
    const snap = uni.find(x => x.meta.ticker === tk);
    if (!looseSanity(snap.annual && snap.annual.annualOpInc, sec.annual.annualOpInc, snap.annual && snap.annual.annualRev, sec.annual.annualRev)) { divergent++; continue; }
    out[tk] = { cik, annualOpInc: sec.annual.annualOpInc, annualRev: sec.annual.annualRev,
      annualNetIncome: sec.annual.annualNetIncome, annualFCF: sec.annual.annualFCF, annualOCF: sec.annual.annualOCF };
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`secAnnual: ${Object.keys(out).length} Namen -> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB) | pulled=${pulled} cached=${cachedF} noCik=${noCik} 404=${no404} divergent=${divergent}`);
})();
