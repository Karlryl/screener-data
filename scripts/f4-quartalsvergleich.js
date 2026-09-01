#!/usr/bin/env node
/**
 * F-4 (Karl-Mandat 03.08.2026) — der BELEG zur datumsbewussten Quartals-Auswahl.
 * ==============================================================================
 * Zwei Messungen, beide reproduzierbar gegen einen beliebigen Snapshot-Baum:
 *
 *   node scripts/f4-quartalsvergleich.js --abstand <snapdir> [revenueQ|grossProfitQ|opIncQ]
 *     Verteilung von |Abstand − 365 Tage| zum jeweils BESTEN datierten Kandidaten.
 *     Zeigt die leeren Baenke und rechnet vor, welche Schwellen dieselbe Menge trennen —
 *     die Herkunft von JAHRESVERGLEICH_TOLERANZ_TAGE (src/scoring/snapshot.js).
 *
 *   node scripts/f4-quartalsvergleich.js --raenge <snapdir> [--out <datei.md>]
 *     Boards VORHER gegen NACHHER: wieviele Raenge verschieben sich, welche am weitesten,
 *     und mit welcher Ursache (welches Quartal wurde statt welchem verglichen).
 *
 * WIE DAS "VORHER" ENTSTEHT — ohne einen zweiten Code-Pfad: der Vorher-Lauf bekommt
 * dieselben Snapshots mit ENTFERNTEN Perioden-Enden. Ohne Enden faellt jahresVergleichIdx
 * per Vertrag auf die alte Positionsregel i+4 zurueck (Waechter:
 * tests/scoring/jahresvergleich-datum.test.js, "ohne Enden-Reihe: Positionsregel i+4
 * unveraendert"). Gemessen wird also die PRODUKTIONS-Engine gegen sich selbst, nicht eine
 * nachgebaute Alt-Formel.
 *
 * EHRLICHE GRENZE: dieser Lader haengt die tiefe SEC-Serie NICHT an (mergeSecIntoUniverse
 * ist in run-screener.js privat). Der Zyklus-Daempfer arbeitet deshalb auf Yahoos vier
 * Jahren. Das betrifft BEIDE Laeufe identisch und kann keinen F-4-Unterschied erzeugen
 * oder verstecken; die absoluten Raenge koennen minimal von der CI abweichen.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const { scoreUniverse, produceRankings } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { periodEnds, jahresVergleichIdx, norm, JAHRESVERGLEICH_TOLERANZ_TAGE } = require('../src/scoring/snapshot.js');
const { revGrowthLevel } = require('../src/scoring/axes.js');
const { loadWatchlist } = require('../lib/watchlist-fs.js');
const { filterToAuthorizedUniverse } = require('../src/scoring/run-screener.js');

const ROOT = path.join(__dirname, '..');

function alleJsonDateien(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) alleJsonDateien(p, out);
    else if (e.name.endsWith('.json') && !e.name.startsWith('_manifest') && e.name !== '_last_good_disk.json') out.push(p);
  }
  return out;
}

// ohneEnden=true entfernt JEDE *Ends-Reihe -> die Engine faellt auf die Positionsregel zurueck.
function ladeUniversum(dir, ohneEnden) {
  const u = [];
  for (const f of alleJsonDateien(dir)) {
    let s;
    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
    if (!s || !s.meta || !s.meta.ticker) continue;
    if (ohneEnden && s.timeseries) {
      for (const k of Object.keys(s.timeseries)) if (k.endsWith('Ends')) delete s.timeseries[k];
    }
    u.push(s);
  }
  const wl = loadWatchlist(path.join(ROOT, 'watchlist.json'));
  if (wl.error) throw new Error('watchlist.json nicht ladbar: ' + wl.error);
  return filterToAuthorizedUniverse(u, wl.stocks).filtered;
}

// ── Messung 1: die Abstands-Verteilung (Herkunft der Toleranz) ─────────────────────────
function abstand(dir, feld) {
  const hist = new Map();
  let positionen = 0, datiert = 0, mitKandidat = 0;
  const beispiel = new Map();
  for (const f of alleJsonDateien(dir)) {
    let s;
    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
    let enden;
    try { enden = periodEnds(s, feld); } catch (_) { continue; }
    const tag = (iso) => (typeof iso === 'string' ? Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 86400000 : NaN);
    for (let i = 0; i < enden.length; i++) {
      positionen++;
      const ti = tag(enden[i]);
      if (!Number.isFinite(ti)) continue;
      datiert++;
      let bestAbw = Infinity, bestJ = null;
      for (let j = i + 1; j < enden.length; j++) {
        const tj = tag(enden[j]);
        if (!Number.isFinite(tj)) continue;
        const abw = Math.abs((ti - tj) - 365);
        if (abw < bestAbw) { bestAbw = abw; bestJ = j; }
      }
      if (bestJ === null) continue;
      mitKandidat++;
      hist.set(bestAbw, (hist.get(bestAbw) || 0) + 1);
      if (!beispiel.has(bestAbw)) beispiel.set(bestAbw, `${path.basename(f, '.json')} i=${i} -> ${bestJ} (${enden[i]} vs ${enden[bestJ]}, ${ti - tag(enden[bestJ])} Tage)`);
    }
  }
  const zeilen = [...hist.entries()].sort((a, b) => a[0] - b[0]);
  const gesamt = zeilen.reduce((s, r) => s + r[1], 0);
  console.log(`\n${feld}: ${positionen} Positionen, ${datiert} datiert, ${mitKandidat} mit datiertem Kandidaten\n`);
  console.log('Abweichung |Abstand-365| zum BESTEN Kandidaten:');
  let kum = 0;
  for (const [a, n] of zeilen) {
    kum += n;
    console.log(`  ${String(a).padStart(5)} Tage: ${String(n).padStart(6)}  ${(100 * n / gesamt).toFixed(3).padStart(7)} %  kum ${(100 * kum / gesamt).toFixed(3)} %`
      + (n <= 3 ? `   ${beispiel.get(a)}` : ''));
    if (kum / gesamt > 0.9995) break;
  }
  // Leere Baenke: dort und nur dort darf eine Schwelle liegen.
  console.log('\nLeere Baenke (kein einziger Fall) unterhalb der Ein-Quartals-Wolke:');
  const baenke = [];
  for (let k = 1; k < zeilen.length; k++) {
    const a = zeilen[k - 1][0], b = zeilen[k][0];
    if (b - a > 1 && a < 120) baenke.push([a + 1, b - 1]);
  }
  for (const [von, bis] of baenke) console.log(`  ${von} .. ${bis} Tage (Breite ${bis - von + 1})`);
  // Unempfindlichkeit: wieviele Positionen akzeptiert jede moegliche Schwelle?
  console.log('\nUnempfindlichkeit — akzeptierte Positionen je Schwelle:');
  const akzeptiert = (t) => zeilen.filter(([a]) => a <= t).reduce((s, r) => s + r[1], 0);
  const proben = [];
  for (const [von, bis] of baenke) { proben.push(von, Math.floor((von + bis) / 2), bis); }
  for (const t of [...new Set(proben)].sort((a, b) => a - b)) {
    console.log(`  Schwelle ${String(t).padStart(3)} Tage -> ${akzeptiert(t)} von ${gesamt} Positionen`
      + (t === JAHRESVERGLEICH_TOLERANZ_TAGE ? '   <== GEWAEHLT' : ''));
  }
}

// ── Messung 2: Raenge vorher/nachher ───────────────────────────────────────────────────
// Warum ein Rang gewandert ist: welches Quartal die Auswahl jetzt nimmt statt Position 4.
function ursache(s) {
  let enden;
  try { enden = periodEnds(s, 'revenueQ'); } catch (_) { return 'keine Quartalsreihe'; }
  const v = jahresVergleichIdx(s, 'revenueQ', 0);
  if (!enden[0]) return 'ohne Perioden-Ende (Positionsregel unveraendert)';
  if (v === null) return `kein Quartal im Jahresfenster zu ${enden[0]} -> Quartals-Bein faellt weg, Jahresreihe traegt`;
  if (v.idx === 4) {
    // Der Luecken-Proxy (alle Quartale bis zum Vergleichsquartal finit) gilt in BEIDEN
    // Zweigen — F-4 aendert nur, WELCHES Quartal verglichen wird. Bei Position 4 mit einem
    // Loch davor bleibt es deshalb beim Fallback auf die Jahresreihe, wie vor F-4.
    const rq = norm({ ...s }, 'revenueQ');
    if (rq.slice(0, 5).some((x) => !Number.isFinite(x))) {
      return `${enden[0]} vs ${enden[4]} (Pos 4, per Datum bestaetigt) — aber Loch in den Fuehrungsquartalen: Quartals-Bein faellt weg (unveraendert)`;
    }
    return 'Position 4 ist das Jahresquartal (unveraendert)';
  }
  return `${enden[0]} vs ${enden[v.idx]} (Pos ${v.idx}) statt ${enden[4] || 'Pos 4'} (Pos 4)`;
}

// Median / Perzentil einer Zahlenliste (klein genug fuer plain sort).
function quantil(werte, p) {
  if (!werte.length) return null;
  const s = werte.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

function boards(dir) {
  const nachher = produceRankings(scoreUniverse(ladeUniversum(dir, false), formulas, {}), { topN: 100 });
  const vorher = produceRankings(scoreUniverse(ladeUniversum(dir, true), formulas, {}), { topN: 100 });
  // Snapshots fuer Ursache + Direkt-Effekt separat halten (scoreUniverse loescht e.snapshot).
  const snapNach = new Map();
  const zahlGeaendert = new Map(); // ticker -> {vor, nach}
  for (const f of alleJsonDateien(dir)) {
    let s; try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
    if (!s || !s.meta || !s.meta.ticker) continue;
    snapNach.set(s.meta.ticker, s);
    // DIREKTER Effekt: aendert sich die Wachstumszahl DIESER Firma? Der Vergleichs-Snapshot
    // ist derselbe ohne Enden -> exakt die alte Positionsregel.
    const ohne = JSON.parse(JSON.stringify(s));
    if (ohne.timeseries) for (const k of Object.keys(ohne.timeseries)) if (k.endsWith('Ends')) delete ohne.timeseries[k];
    let a = null, b = null;
    try { a = revGrowthLevel(ohne); b = revGrowthLevel(s); } catch (_) { continue; }
    const gleich = (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) < 1e-9);
    if (!gleich) zahlGeaendert.set(s.meta.ticker, { vor: a, nach: b });
  }

  const listen = [];
  for (const id of Object.keys(nachher.full).sort()) {
    for (const track of Object.keys(nachher.full[id]).sort()) {
      listen.push([`${id}|${track}`, (vorher.full[id] || {})[track] || [], nachher.full[id][track]]);
    }
  }
  listen.push(['UEBERSICHT', vorher.overview, nachher.overview]);

  const tabelle = [];
  const alleVerschiebungen = [];
  for (const [name, v, n] of listen) {
    const rangVor = new Map(v.map((r, i) => [r.ticker, i + 1]));
    let geaendert = 0, gemeinsam = 0, eigene = 0;
    const deltas = [];
    for (let i = 0; i < n.length; i++) {
      if (zahlGeaendert.has(n[i].ticker)) eigene++;
      const alt = rangVor.get(n[i].ticker);
      if (alt === undefined) continue;
      gemeinsam++;
      const d = alt - (i + 1);
      if (d !== 0) {
        geaendert++;
        deltas.push(Math.abs(d));
        alleVerschiebungen.push({ board: name, ticker: n[i].ticker, vor: alt, nach: i + 1, delta: d });
      }
    }
    const topVor = new Set(v.slice(0, 100).map((r) => r.ticker));
    const topNach = new Set(n.slice(0, 100).map((r) => r.ticker));
    tabelle.push({
      board: name, n: n.length, gemeinsam, geaendert, eigene,
      med: quantil(deltas, 0.5), p90: quantil(deltas, 0.9),
      rein: [...topNach].filter((t) => !topVor.has(t)).length,
      raus: [...topVor].filter((t) => !topNach.has(t)).length,
    });
  }
  alleVerschiebungen.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Laender-Split ueber die Namen mit GEAENDERTER EIGENER Wachstumszahl (der direkte Effekt).
  const land = {};
  for (const t of zahlGeaendert.keys()) {
    const snap = snapNach.get(t);
    const l = (snap && snap.meta && snap.meta.country) || '?';
    land[l] = (land[l] || 0) + 1;
  }

  const zeilen = [];
  zeilen.push('| Board | Zeilen | eigene Zahl geaendert | Rang geaendert | Median \\|ΔRang\\| | p90 \\|ΔRang\\| | neu in Top-100 | raus |');
  zeilen.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const t of tabelle) {
    zeilen.push(`| ${t.board} | ${t.n} | ${t.eigene} | ${t.geaendert} | ${t.med === null ? '-' : t.med} | ${t.p90 === null ? '-' : t.p90} | ${t.rein} | ${t.raus} |`);
  }
  zeilen.push('');
  zeilen.push('### Groesste Einzelverschiebungen (Top 25, volle Kohorte)');
  zeilen.push('');
  zeilen.push('| Board | Ticker | Rang vorher | Rang nachher | Wachstum vorher | nachher | Ursache |');
  zeilen.push('| --- | --- | ---: | ---: | ---: | ---: | --- |');
  const pct = (x) => (x === null || x === undefined ? '—' : x.toFixed(1) + ' %');
  for (const s of alleVerschiebungen.slice(0, 25)) {
    const z = zahlGeaendert.get(s.ticker);
    zeilen.push(`| ${s.board} | ${s.ticker} | ${s.vor} | ${s.nach} | ${z ? pct(z.vor) : '(unveraendert)'} | ${z ? pct(z.nach) : ''} | ${ursache(snapNach.get(s.ticker) || {})} |`);
  }
  zeilen.push('');
  zeilen.push('### Namen mit geaenderter Wachstumszahl, nach Land (Top 20)');
  zeilen.push('');
  zeilen.push('| Land | Namen |');
  zeilen.push('| --- | ---: |');
  for (const [l, n] of Object.entries(land).sort((a, b) => b[1] - a[1]).slice(0, 20)) zeilen.push(`| ${l} | ${n} |`);

  const gesamtGeaendert = tabelle.reduce((s, t) => s + t.geaendert, 0);
  const gesamtVerglichen = tabelle.reduce((s, t) => s + t.gemeinsam, 0);
  const gesamtEigene = tabelle.reduce((s, t) => s + t.eigene, 0);
  const kopf = [
    `# F-4 Rang-Verschiebungen (${new Date().toISOString().slice(0, 10)})`,
    '',
    `Snapshot-Baum: \`${dir}\` — ${snapNach.size} Snapshots.`,
    `Toleranz: ${JAHRESVERGLEICH_TOLERANZ_TAGE} Tage (src/scoring/snapshot.js).`,
    'Vorher = dieselbe Engine mit entfernten Perioden-Enden (Positionsregel i+4).',
    'Vergleich auf der VOLLEN gescorten Kohorte, nicht nur der sichtbaren Top-100.',
    '',
    `**${zahlGeaendert.size} von ${snapNach.size} Snapshots bekommen eine ANDERE Wachstumszahl**`,
    `(auf den gerouteten Board-Zeilen: ${gesamtEigene}). Das ist der direkte Effekt.`,
    '',
    `**${gesamtGeaendert} von ${gesamtVerglichen} Rang-Positionen verschieben sich.** Diese Zahl ist`,
    'ERWARTUNGSGEMAESS gross und darf NICHT als "alles hat sich geaendert" gelesen werden: das',
    'Scoring ist kohorten-relativ perzentiliert, eine geaenderte Zahl verschiebt die Perzentile',
    'ALLER Mitglieder derselben Kohorte um mindestens einen Platz. Aussagekraeftig ist die',
    'GROESSE der Verschiebung (Median/p90 je Board) und die Spalte "eigene Zahl geaendert".',
    '',
  ];
  return kopf.concat(zeilen).join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === '--abstand' || a === '--raenge');
  if (i < 0 || !argv[i + 1]) {
    console.error('Aufruf: node scripts/f4-quartalsvergleich.js --abstand <snapdir> [feld] | --raenge <snapdir> [--out <datei>]');
    process.exit(2);
  }
  const dir = argv[i + 1];
  if (!fs.existsSync(dir)) { console.error(`Snapshot-Verzeichnis nicht gefunden: ${dir}`); process.exit(2); }
  if (argv[i] === '--abstand') { abstand(dir, argv[i + 2] || 'revenueQ'); return; }
  const md = boards(dir);
  const outIdx = argv.indexOf('--out');
  if (outIdx >= 0 && argv[outIdx + 1]) {
    writeReportArtifact(argv[outIdx + 1], md);
    console.log('Report -> ' + argv[outIdx + 1]);
  }
  console.log(md);
}

function writeReportArtifact(outPath, markdown) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileAtomic(outPath, markdown + '\n');
}

if (require.main === module) main();
module.exports = { ladeUniversum, ursache, writeReportArtifact };
