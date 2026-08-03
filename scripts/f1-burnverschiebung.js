#!/usr/bin/env node
/**
 * F-1 (Karl-Mandat 03.08.2026), Chunk A3.2 — der BELEG zur Burn-Bremse auf dem operativen Tor.
 * ===========================================================================================
 * Zaehlt gegen einen Snapshot-Baum aus, WEN die Burn-Bremse vorher traf, wen sie jetzt trifft,
 * und wer dadurch freikommt — samt Kohorten-Rang-Gewinn je Name.
 *
 *   node scripts/f1-burnverschiebung.js <snapdir> [--top <n>]
 *
 * WIE DAS "VORHER" ENTSTEHT — ohne einen zweiten Code-Pfad und ohne eine nachgebaute Alt-Formel:
 * das alte Tor stand auf annualFCF, das neue auf annualOCF (ersatzweise FCF - Capex). Der
 * Vorher-Lauf bekommt deshalb dieselben Snapshots mit annualOCF UND annualCapex entfernt — dann
 * faellt operatingCashSeries() per Vertrag auf... nichts zurueck, und die Lampe schwiege. Das
 * waere kein ehrliches Vorher. Stattdessen: annualOCF wird durch annualFCF ERSETZT (und Capex
 * entfernt), womit die neue Engine exakt das alte FCF-Tor rechnet. Gemessen wird also die
 * Produktions-Engine gegen sich selbst.
 * Waechter dafuer: tests/scoring/lamps.test.js ("Burn UND Verlust vertiefen sich ... Turnaround").
 *
 * MESSEBENE: der uebergebene Snapshot-Baum (fuer die Abnahme: der CI-Baum des Tages, NICHT der
 * lokale Arbeitsbaum), gefiltert auf watchlist.json und mit angehaengter tiefer SEC-Serie —
 * derselbe Weg wie run-screener.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { scoreUniverse } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { loadWatchlist } = require('../lib/watchlist-fs.js');
const { filterToAuthorizedUniverse, mergeSecIntoUniverse } = require('../src/scoring/run-screener.js');

const ROOT = path.join(__dirname, '..');

function alleJsonDateien(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) alleJsonDateien(p, out);
    else if (e.name.endsWith('.json') && !e.name.startsWith('_manifest') && e.name !== '_last_good_disk.json') out.push(p);
  }
  return out;
}

// altesTor=true stellt den Zustand VOR F-1 her: annualOCF := annualFCF, annualCapex weg.
// Dann liest operatingCashSeries() genau die FCF-Reihe -> das alte Tor, unveraenderte Engine.
function ladeUniversum(dir, altesTor) {
  const u = [];
  for (const f of alleJsonDateien(dir)) {
    let s;
    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
    if (!s || !s.meta || !s.meta.ticker) continue;
    if (altesTor && s.annual) {
      s.annual.annualOCF = s.annual.annualFCF;
      delete s.annual.annualCapex;
    }
    u.push(s);
  }
  const wl = loadWatchlist(path.join(ROOT, 'watchlist.json'));
  if (wl.error) throw new Error('watchlist.json nicht ladbar: ' + wl.error);
  const { filtered } = filterToAuthorizedUniverse(u, wl.stocks);
  mergeSecIntoUniverse(filtered);
  return filtered;
}

// Kohorten-Rang (formulaId|track) nach Score, absteigend.
function raenge(routed) {
  const kohorten = {};
  for (const e of routed) (kohorten[e.formulaId + '|' + e.track] ||= []).push(e);
  const rang = new Map(), n = new Map();
  for (const list of Object.values(kohorten)) {
    list.slice().sort((a, b) => b.score - a.score).forEach((e, i) => rang.set(e.ticker, i + 1));
    for (const e of list) n.set(e.ticker, list.length);
  }
  return { rang, n };
}

function lauf(dir, altesTor) {
  const results = scoreUniverse(ladeUniversum(dir, altesTor), formulas, {});
  const routed = results.filter((e) => e.action === 'route' && Number.isFinite(e.score));
  const { rang, n } = raenge(routed);
  const zeilen = new Map();
  for (const e of routed) {
    zeilen.set(e.ticker, { f: e._factorBurn, score: e.score, rang: rang.get(e.ticker), n: n.get(e.ticker),
      name: e.name, sektor: e.sector, formel: e.formulaId, track: e.track });
  }
  return zeilen;
}

function main() {
  const dir = process.argv[2];
  const topIdx = process.argv.indexOf('--top');
  const top = topIdx > 0 ? parseInt(process.argv[topIdx + 1], 10) : 20;
  if (!dir || !fs.existsSync(dir)) {
    console.error('Aufruf: node scripts/f1-burnverschiebung.js <snapdir> [--top <n>]');
    process.exit(2);
  }
  const vorher = lauf(dir, true);
  const nachher = lauf(dir, false);

  const getroffenVor = [...vorher.entries()].filter(([, v]) => v.f < 1).map(([t]) => t);
  const getroffenNach = [...nachher.entries()].filter(([, v]) => v.f < 1).map(([t]) => t);
  const nachSet = new Set(getroffenNach);
  const vorSet = new Set(getroffenVor);
  const frei = getroffenVor.filter((t) => !nachSet.has(t));
  const neu = getroffenNach.filter((t) => !vorSet.has(t));

  console.log(`Messebene      : ${dir}`);
  console.log(`gescorte Zeilen: ${nachher.size}`);
  console.log(`Burn-Bremse VORHER (FCF-Tor)   : ${getroffenVor.length}`);
  console.log(`Burn-Bremse NACHHER (OCF-Tor)  : ${getroffenNach.length}`);
  console.log(`FREI geworden                  : ${frei.length}`);
  console.log(`NEU getroffen                  : ${neu.length}`);

  const mitGewinn = frei.map((t) => {
    const v = vorher.get(t), nn = nachher.get(t);
    return { t, fVor: v.f, rangVor: v.rang, rangNach: nn.rang, n: nn.n, gewinn: v.rang - nn.rang,
      name: nn.name, sektor: nn.sektor, kohorte: nn.formel + '|' + nn.track };
  }).sort((a, b) => b.gewinn - a.gewinn);

  console.log(`\nDie ${Math.min(top, mitGewinn.length)} groessten Rang-Gewinne der Freigewordenen:`);
  for (const r of mitGewinn.slice(0, top)) {
    console.log(`  ${String(r.t).padEnd(12)} Faktor war ${r.fVor.toFixed(2)} | Kohorten-Rang ${r.rangNach}/${r.n} statt ${r.rangVor} (+${r.gewinn})  ${r.kohorte}  ${(r.name || '').slice(0, 32)}`);
  }
  if (neu.length) {
    console.log('\nNEU getroffen (Namen, deren OCF-Bild schlechter ist als ihr FCF-Bild):');
    for (const t of neu.slice(0, top)) {
      const nn = nachher.get(t);
      console.log(`  ${String(t).padEnd(12)} Faktor ${nn.f.toFixed(2)}  ${(nn.name || '').slice(0, 32)}`);
    }
  }
  // Alle Freigewordenen als eine Zeile — fuer den Bericht kopierbar.
  console.log('\nAlle Freigewordenen: ' + frei.slice().sort().join(' '));
}

if (require.main === module) main();
module.exports = { ladeUniversum, lauf };
