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
// BH-004 test hook: overridable like CACHE below, so the hermetic empty-universe
// regression test can point at a real-but-empty temp dir instead of the repo's
// (locally populated, git-ignored) snapshots/ folder.
const SNAP = process.env.SEC_SNAPSHOTS_DIR || path.join(ROOT, 'snapshots');
const CACHE = process.env.SEC_XBRL_CACHE_DIR || path.join(require('os').tmpdir(), 'sec-xbrl-cache');
const OUT = path.join(ROOT, 'external-data', 'sec-secannual.json');
const UA = require('../lib/sec-user-agent').secUserAgent();
const { route, isUS } = require(path.join(ROOT, 'src/scoring/router.js'));
const { norm, presentValues } = require(path.join(ROOT, 'src/scoring/snapshot.js'));
const { signFlips, oscExcess, revMaxDrawdown } = require(path.join(ROOT, 'src/scoring/score.js'));
const { extractSecSeries } = require(path.join(ROOT, 'merge-sec-xbrl.js'));
const { fetchSecTickers } = require(path.join(ROOT, 'discovery/sec-tickers.js'));
// BH-010 fix: atomic tmp+rename writes (was plain fs.writeFileSync — a crash
// mid-write left a truncated companyfacts cache file or a truncated OUT).
const { writeFileAtomic } = require(path.join(ROOT, 'lib/atomic-write.js'));
const { readJsonExistingOrThrow, FEHLT } = require(path.join(ROOT, 'lib/read-json.js'));

// F-CGPT-020 (P0-Haertung 09.08.2026): hier stand `catch (_) { out = {} }`. Damit war eine
// VORHANDENE, aber unlesbare sec-secannual.json von "gibt es noch nicht" nicht zu unterscheiden —
// die Merge-Basis fiel auf leer, und der Lauf schrieb seinen Teilbestand darueber. Live
// nachgestellt: korrupter Store + kein einziger ziehbarer Kandidat -> geschrieben wurde `{}`,
// die komplette committete Datenschicht weg, Exit 0.
// Erstanlage ist AUSSCHLIESSLICH die fehlende Datei. Alles andere (Syntaxmuell, halber Write,
// Rechteproblem, `null`/Array statt Objekt) ist ein vorhandener Bestand -> Wurf, nichts wird
// ueberschrieben.
function ladeMergeBasis(p = OUT) {
  const v = readJsonExistingOrThrow(p);
  return v === FEHLT ? {} : v;
}

// T569-F4 (Review Tag 569): dieser Loader stand auf einem BLANKEN `catch (_) { continue; }` —
// nicht einmal ein Zaehler. Sein Ergebnis wird COMMITTET (external-data/sec-secannual.json)
// und speist den Zyklus-Daempfer (score.js cycleSeriesPair) sowie roicStability (axes.js);
// eine halb gelesene Platte haette dort eine geschrumpfte Serie dauerhaft eingefroren, ohne
// dass irgendwo eine Zeile davon erzaehlt. Gleiche Wache wie im Scorer, gleiche Population
// (snapshots/) und damit gleiche Schwellen — EINE Regel, kein zweiter Schwellen-Ort.
// snapDir ist Test-Seam mit dem produktiven Default (Bauform wie run-screener loadUniverse).
const { assertParseFailAnteil } = require(path.join(ROOT, 'src/scoring/run-screener.js'));
function loadUniverse(snapDir = SNAP) {
  const u = [];
  let parseFail = 0, skippedNoMeta = 0;
  for (const f of fs.readdirSync(snapDir)) {
    if (!f.endsWith('.json') || f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
    let s; try { s = JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8')); } catch (_) { parseFail++; continue; }
    if (s && s.meta && s.meta.ticker) u.push(s);
    else skippedNoMeta++;
  }
  assertParseFailAnteil(u.length, parseFail, skippedNoMeta, undefined, undefined, 'build-secannual loadUniverse');
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
// T174: wie plain(), aber OHNE Filter — eine Luecke bleibt eine Luecke an ihrer Position.
// plain() verschiebt jedes Folgejahr um eins nach vorn; fuer den positionsweisen
// Vergleich waere das ein hausgemachter Jahres-Versatz.
const plainMitLuecken = (arr) => (arr || []).map(x => x && typeof x === 'object' ? x.value : x).map(v => Number.isFinite(v) ? v : null);
// Grobmuell-Sanity: signFlips/revMaxDrawdown sind vorzeichen-/verhaeltnis-basiert -> robust gegen FY-Versatz +
// Level-Restatement (kein positional-overlap-Guard, der flaggt FY-Versatz falsch). Minimal gegen GENUIN falsches
// Konzept: (1) neuestes OpInc gleiches Vorzeichen; (2) neuester Umsatz ~2x-Skala (RGEN 141M vs 738M); (3) kein
// isoliertes Einzeljahr >10x unter beiden Nachbarn (ARWR 3.5M zwischen 240M/829M = Konzept-Mix-Phantom-Drawdown).
/**
 * A1/K1 (Urteil T164, ENTSCHIED 15 vom 29.08.2026): looseSanity validiert die SEC-Reihe GEGEN
 * die YAHOO-Reihe des Stores. Seit scripts/opinc-source-migrate.js kann snapshot.annual.
 * annualOpInc bereits die SEC-Reihe SEIN — dann verglichen wir SEC gegen SEC und das Tor
 * waere still zur Tautologie geworden (Vorzeichen stimmt immer, Skala stimmt immer).
 * Diese eine Stelle entscheidet fuer BEIDE Builder (build-secannual.js und -smallcap.js),
 * welche Reihe die Yahoo-Referenz ist: die bewahrte, wo sie existiert.
 * Kein Ersatz fuer die Trennung im Workflow — der Migrationsschritt laeuft bewusst im
 * scoring-Job und nicht im merge-Job, damit das hochgeladene Artefakt unberuehrt bleibt.
 * Dies ist der zweite Boden, falls jemand die Builder lokal auf einem migrierten Store faehrt.
 */
function yahooOpIncOf(snap) {
  const a = snap && snap.annual;
  if (!a) return null;
  return Array.isArray(a.annualOpIncYahoo) ? a.annualOpIncYahoo : a.annualOpInc;
}

// T174 (19.09.2026) — Ausrichtungs-Regel VOR dem positionsweisen Vergleich.
// Vorbedingung aus reports/t168-t174-schicht-diff-2026-08-29.md ("Was T174 wirklich
// braucht"): eine positionsweise Wache ohne Ausrichtung bestraft die ~19 % der Firmen
// mit Jahres-Versatz — 4 der 5 Kipp-Faelle der verengten Variante waren genau das
// (ASM -1, BVC -2, VIR -2, WDC -1), nur VYX trug Versatz 0.
// Methode WOERTLICH wie die Messung (scripts/t168-layer-diff.js besterVersatz, Methode
// der 28.07.-Erhebung): je Versatz -2..+2 zaehlen, wie viele Umsatzpaare auf < 2 %
// zusammenfallen; Ausrichtung gilt nur bei EINDEUTIGER Spitze mit mindestens
// VERSATZ_MIN_PAARE Treffern.
// Vergaberegel H5 (ENTSCHIED 52): eine leere oder mehrdeutige Messmenge belegt NICHTS.
// Dann gibt es keine ausgerichtete Reihe und die Ganzserien-Pruefung entfaellt fuer
// diesen Namen — sie faellt auf die alte newest-only-Wache zurueck, statt auf gut Glueck
// Jahr gegen Nachbarjahr zu vergleichen.
// ponytail: bekannte Decke — Namen ohne belegbare Ausrichtung (kein einziges passendes
// Umsatzpaar) bleiben auf der alten Abdeckung. Aufwerten erst, wenn eine Messung zeigt,
// dass diese Klasse echte Tag-Divergenzen verbirgt.
const VERSATZ_TOL = 0.02;
const VERSATZ_MIN_PAARE = 2;
function besterVersatz(yRevArr, sRevArr) {
  const y = plainMitLuecken(yRevArr), s = plainMitLuecken(sRevArr);
  const jeVersatz = new Map();
  for (let off = -2; off <= 2; off++) {
    let hits = 0;
    for (let i = 0; i < y.length; i++) {
      const a = y[i], b = s[i + off];
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) continue;
      if (Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) < VERSATZ_TOL) hits++;
    }
    jeVersatz.set(off, hits);
  }
  const maxHits = Math.max(...jeVersatz.values());
  const spitze = [...jeVersatz.keys()].filter((o) => jeVersatz.get(o) === maxHits);
  if (spitze.length !== 1 || maxHits < VERSATZ_MIN_PAARE) return { off: null, hits: maxHits, lage: 'unaufgeloest' };
  return { off: spitze[0], hits: maxHits, lage: spitze[0] === 0 ? 'null-versatz' : 'versatz' };
}

/**
 * T174: die Umsatz-Skalen-Wache zieht ueber die GANZE Reihe statt nur ueber das juengste
 * Jahr. Anlass T168/CWCO: die falsche Tag-Wahl (IncludingAssessedTax vor Revenues) stand
 * in den VORJAHREN und war fuer eine newest-only-Wache unsichtbar.
 * Verengte Variante (ENTSCHIED 14 Punkt 2): Umsatz-Skala ueber die ganze Reihe, das
 * OpInc-VORZEICHEN bleibt beim neuesten Jahr. Die vier Ganzserien-Vorzeichen-Faelle
 * (BB, CODI, CORZ, SFD) sind die Yahoo-gegen-GAAP-Frage selbst — die gehoert ans
 * T164/165/166-Gericht und nicht in eine Wache, die das Urteil vorwegnimmt.
 * Schwellen UNVERAENDERT (Faktor 2, 10x-V-Dip); kein Konzept-Wechsel, keine
 * REV_CONCEPTS-Umsortierung.
 */
function looseSanity(yOpArr, sOpArr, yRevArr, sRevArr) {
  const yOp = newestPresent(yOpArr), sOp = newestPresent(sOpArr);
  if (yOp !== null && sOp !== null && Math.sign(yOp) !== Math.sign(sOp) && yOp !== 0 && sOp !== 0) return false;
  const yR = newestPresent(yRevArr), sR = newestPresent(sRevArr);
  if (yR !== null && sR !== null && yR > 0 && sR > 0) { if (Math.max(yR, sR) / Math.min(yR, sR) > 2) return false; }
  const vs = besterVersatz(yRevArr, sRevArr);
  if (vs.lage !== 'unaufgeloest') {
    const y = plainMitLuecken(yRevArr), s = plainMitLuecken(sRevArr);
    for (let i = 0; i < y.length; i++) {
      const a = y[i], b = s[i + vs.off];
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
      if (Math.max(a, b) / Math.min(a, b) > 2) return false;
    }
  }
  const r = plain(sRevArr);
  for (let i = 1; i < r.length - 1; i++) { if (r[i] > 0 && r[i] * 10 < r[i - 1] && r[i] * 10 < r[i + 1]) return false; }
  return true;
}

// T174-Zaehler (21.09.2026, Merge-Desk-Auflage zu #304): bei `lage === 'unaufgeloest'` faellt
// die Ganzserien-Pruefung STILL auf newest-only zurueck (~13 % der Namen laut Review 20.09.).
// Ohne Zaehler saehe ein Lauf, in dem die Wache fuer die Haelfte der Namen abgeschaltet ist,
// genauso aus wie einer mit voller Abdeckung. Der Wrapper zaehlt JEDEN geprueften Namen ohne
// Ausrichtung — bestanden oder abgewiesen —, damit die Luecke im Summenlog steht.
// Nenner `geprueft` = alle Namen, die die Wache gesehen haben; die Quote N/geprueft ist die Aussage.
function sanityMitZaehler(zaehler, tk, yOpArr, sOpArr, yRevArr, sRevArr) {
  zaehler.geprueft = (zaehler.geprueft || 0) + 1;
  if (besterVersatz(yRevArr, sRevArr).lage === 'unaufgeloest') {
    zaehler.versatzUnaufgeloest = (zaehler.versatzUnaufgeloest || 0) + 1;
    (zaehler.unaufgeloestNamen = zaehler.unaufgeloestNamen || []).push(tk);
  }
  return looseSanity(yOpArr, sOpArr, yRevArr, sRevArr);
}
function zaehlerZeile(zaehler) {
  const n = zaehler.versatzUnaufgeloest || 0;
  return `versatzUnaufgeloest=${n}/${zaehler.geprueft || 0}` + (n ? ` (Ganzserie aus, newest-only: ${zaehler.unaufgeloestNamen.join(',')})` : '');
}

// BH-009 fix: fail closed on a fully-missing series. newestPresent() returns
// null when the array is empty/all-null; Number(null)>=0 is TRUE, so the old
// inline guard (`Number(newestPresent(...))>=0`) let a completely absent
// CurrLiab through into the committed Bilanz-Serie. Exported for the hermetic
// regression check (tests/scoring/bh-b12-sec.test.js).
function bilanzGuardOk(newAssets, newCurLiab) {
  return newAssets !== null && newAssets > 0 && newCurLiab !== null && newCurLiab >= 0;
}

// BH-010 fix: which companyfacts cache to read for a CIK. repoCache used to win
// unconditionally, so a stale, git-ignored leftover from an old local run
// silently shadowed a fresher explicitly-passed SEC_XBRL_CACHE_DIR pull.
// Pick whichever file is newer when both exist. Exported for the hermetic
// regression check.
function chooseCacheSource(repoExists, tmpExists, repoMtimeMs, tmpMtimeMs) {
  if (repoExists && tmpExists) return tmpMtimeMs > repoMtimeMs ? 'tmp' : 'repo';
  if (tmpExists) return 'tmp';
  if (repoExists) return 'repo';
  return null;
}

async function run() {
  // Overwrite->Merge (Court-Vorbedingung der Expansion): bestehenden Store als Basis laden -> ein Teil-/Abbruch-Lauf
  // oder ein geaendertes Kandidatenset LOESCHT keine schon abgedeckten Namen (Coverage akkumuliert non-ephemer).
  // Namen-Granularitaet: jedes out[tk] stammt aus EINEM extractSecSeries-Call (ein _fys) -> feld-kohaerent, nie gesplittet.
  // R609-4: ganz nach vorn gezogen (stand hinter fetchSecTickers()). ladeMergeBasis()
  // wirft bei unlesbarem Store (F-CGPT-020) — dieser Wurf gehoert VOR die erste
  // Netzrunde und vor jede Rechnung: ein Lauf, der ohnehin nichts schreiben darf,
  // soll SEC nicht erst befragen. Nebeneffekt: der Wurf ist damit netzfrei
  // nachweisbar (tests/p0-haertung3-builder-cache-cursor.test.js, E2E-Fall F-020).
  const out = ladeMergeBasis();
  const preCount = Object.keys(out).length;
  console.log('Merge-Basis:', preCount, 'bestehende Namen geladen');

  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  const uni = loadUniverse();
  // BH-004 fix: loadUniverse() returns [] when snapshots/*.json isn't present (e.g. the CI
  // checkout only ships snapshots/_manifest.json). Without this guard dds stays [] -> p75
  // is undefined -> p75.toFixed() below throws, crashing the run instead of leaving
  // sec-secannual.json untouched. The real fix is the caller supplying a real universe
  // (see monthly-sec-xbrl.yml's "Restore Snapshots" step) — this is the safety net for
  // when that's unavailable, so the script degrades to a loud no-op, never a crash.
  if (uni.length === 0) {
    console.log('::warning::secAnnual: leeres Universum (keine snapshots/*.json gefunden) - Build uebersprungen, sec-secannual.json unveraendert');
    return;
  }
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
  let pulled = 0, cachedF = 0, noCik = 0, no404 = 0, divergent = 0, ohneReihe = 0, parseErr = 0;
  const versatzZaehler = {};
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
    // Review-Fund 19.08.2026: hier stand `catch (_) { continue; }` — ein blankes Verschlucken.
    // Seit der Taxonomie-Erweiterung laeuft in extractSecSeries() deutlich mehr (Wahl ueber zwei
    // Standards, Konzept-Union statt Einzelkonzept), also gibt es mehr, was werfen kann. Ohne
    // Log und Zaehler saehe ein Lauf, in dem die halbe SEC-Struktur kippt, aus wie ein Lauf, in
    // dem es einfach nichts zu holen gab: kein Wort im Log, kein Zaehler, keine rote Ampel.
    let sec;
    try { sec = extractSecSeries(JSON.parse(body), tk); }
    catch (e) { console.log('  parse-fail', tk, cik, e.message); parseErr++; continue; }
    // 'nicht verfuegbar' wird GEZAEHLT, nicht geschrieben. taxonomie===null heisst: weder
    // us-gaap noch ifrs-full liefert ein einziges Jahresdatum (haeufigster Grund: der Filer
    // berichtet in EUR/ZAR statt USD — belegt an BNTX und STLA, beide reine EUR-Melder).
    // Bis 19.08.2026 landeten genau diese Faelle als HOHLE Datensaetze im Store: 45 der 214
    // Namen trugen {annualRev:[],annualOpInc:[],...} ohne nfy — im Log ununterscheidbar von
    // echter Abdeckung. Kein Wert ist ehrlicher als ein leeres Geruest, das wie Abdeckung aussieht.
    if (!sec.taxonomie) { ohneReihe++; continue; }
    const snap = uni.find(x => x.meta.ticker === tk);
    // T174: der Zaehler allein sagt nicht, WER stehen bleibt. Ein abgewiesener Name behaelt
    // via Merge-Basis seinen Altstand — das ist genau die Sorte Stillstand, die man im Log sehen
    // muss, seit die Wache ueber die ganze Reihe zieht (mehr Abweisungen als newest-only).
    if (!sanityMitZaehler(versatzZaehler, tk, yahooOpIncOf(snap), sec.annual.annualOpInc, snap.annual && snap.annual.annualRev, sec.annual.annualRev)) {
      console.log('  divergent (behaelt Altstand)', tk, 'Versatz', JSON.stringify(besterVersatz(snap && snap.annual && snap.annual.annualRev, sec.annual.annualRev)));
      divergent++; continue;
    }
    // taxonomie = HERKUNFT der Reihen, gleiche Ebene wie cik/nfy. Ohne sie waeren us-gaap-
    // und ifrs-full-Werte im Store nicht auseinanderzuhalten — und dieselbe Firma kann sich
    // unter zwei Standards um Prozente unterscheiden.
    out[tk] = { cik, taxonomie: sec.taxonomie, nfy: sec.annual._fys[0], annualOpInc: sec.annual.annualOpInc, annualRev: sec.annual.annualRev,
      annualNetIncome: sec.annual.annualNetIncome, annualFCF: sec.annual.annualFCF, annualOCF: sec.annual.annualOCF,
      annualShares: sec.annual.annualShares };
    // Phase 4.1: tiefe Bilanz NUR wenn plausibel (newest Assets>0 UND newest CurrLiab>=0) — sonst laeuft
    // ein isoliert-korruptes as-filed Assets/CurrLiab ungevalidiert in die roicStability-ROIC-Serie (Court-Auflage).
    if (bilanzGuardOk(newestPresent(sec.annual.annualAssets), newestPresent(sec.annual.annualCurrentLiabilities))) {
      out[tk].annualAssets = sec.annual.annualAssets;
      out[tk].annualCurrentLiabilities = sec.annual.annualCurrentLiabilities;
    }
  }
  writeFileAtomic(OUT, JSON.stringify(out));
  const postCount = Object.keys(out).length;
  console.log(`secAnnual: ${postCount} Namen (${preCount}->${postCount}, +${postCount - preCount} akkumuliert) -> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB) | pulled=${pulled} cached=${cachedF} noCik=${noCik} 404=${no404} divergent=${divergent} ohneReihe=${ohneReihe} parseErr=${parseErr} ${zaehlerZeile(versatzZaehler)}`);
}

// BH-036-adjacent hardening (in-scope, minimal): guard direct execution so
// `require()`-ing this module (e.g. from a hermetic test) no longer fires off
// a live SEC/network run — previously an unconditional top-level IIFE.
if (require.main === module) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { newestPresent, bilanzGuardOk, chooseCacheSource, run, get, sleep, looseSanity, besterVersatz, sanityMitZaehler, zaehlerZeile, yahooOpIncOf, plain, plainMitLuecken, loadUniverse, ladeMergeBasis };
