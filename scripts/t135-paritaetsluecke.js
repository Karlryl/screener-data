#!/usr/bin/env node
'use strict';
// T135 (Afternoon-Lauf 21.09.2026, Master-Entscheid Option B): misst die Luecke zwischen dem
// Verify-Primitiv productionCohortRanking() (src/scoring/calibrate.js) und dem Small-Cap-Board,
// das runSmallcapPass() (src/scoring/run-screener.js) schreibt.
// Beide Dateien sind durch GQS-00 gepinnt (1.2.0-pending transition.json bzw. 1.1.0
// formula-registry.json). Dieses Skript RUFT die versiegelten Funktionen nur auf und baut den
// Coverage-Floor NICHT nach (Master-Auflage) — der Fix selbst gehoert in die naechste
// GQS-00-Transition. runSmallcapPass schreibt ausschliesslich in ein frisches tmp-Verzeichnis.
// Aufruf: node scripts/t135-paritaetsluecke.js --snapshots <dir> --vintage <YYYY-MM-DD> [--watchlist <json>] [--out <md>]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rs = require('../src/scoring/run-screener.js');
const { productionCohortRanking } = require('../src/scoring/calibrate.js');
const { smallcapRoute } = require('../src/scoring/smallcap-route.js');
const smallcapFormulas = require('../src/scoring/formulas/smallcap/index.js');

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) fail(name + ' ohne Wert');
  return v;
}
const TOPN = 100; // wie der Produktionsaufruf runSmallcapPass(universe, topN || 100)
function fail(msg) { console.error('t135-paritaetsluecke: ' + msg); process.exit(1); }

function main() {
  const snap = arg('--snapshots'), vintage = arg('--vintage');
  if (!snap) fail('--snapshots <dir> fehlt (CI-Population des Small-Cap-Stores)');
  if (!vintage || !/^\d{4}-\d{2}-\d{2}$/.test(vintage)) fail('--vintage YYYY-MM-DD fehlt — die Luecke gilt nur fuer den Stand, an dem sie gemessen wurde');
  // Fehlerklasse F5885: der lokale Store ist Altbestand, keine Messebene.
  // Jeder Ordner namens snapshots-smallcap ist ein Arbeitsbaum-Bestand (Haupt-Checkout ODER Worktree),
  // eine CI-Population kommt aus einem Artefakt-Download in einen anders benannten Ordner.
  if (path.basename(path.resolve(snap)).toLowerCase() === path.basename(rs.SMALLCAP_SNAP_DIR).toLowerCase() && !process.argv.includes('--lokal-kein-beleg')) {
    fail('lokales snapshots-smallcap/ ist Altbestand, keine CI-Population (mit --lokal-kein-beleg nur als Rauchtest)');
  }
  const watchlist = arg('--watchlist') || rs.SMALLCAP_WATCHLIST_PATH;
  // Zwei frische Ladungen: kein Pfad sieht Mutationen des anderen.
  const uBoard = rs.loadSmallcapUniverse(snap, watchlist), uVerify = rs.loadSmallcapUniverse(snap, watchlist);
  if (!uBoard || !uBoard.length) fail('leere Small-Cap-Population unter ' + snap);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't135-board-'));
  rs.runSmallcapPass(uBoard, TOPN, tmp);
  const index = JSON.parse(fs.readFileSync(path.join(tmp, 'index.json'), 'utf8'));

  const zeilen = [];
  // Ueber ALLE Formel-IDs, nicht nur ueber die geschriebenen Boards: nimmt der Floor einer Formel
  // jede Zeile weg, entsteht kein Board — das waere die groesste Luecke und bliebe sonst unsichtbar
  // (Review-Fund 21.09.).
  const geschrieben = new Set(index.boards);
  for (const id of Object.keys(smallcapFormulas)) {
    const boardDa = geschrieben.has(id);
    const board = boardDa ? JSON.parse(fs.readFileSync(path.join(tmp, id + '.json'), 'utf8')) : {};
    for (const track of ['profitable', 'unprofitable']) {
      const b = (board[track] || []).map((r) => r.ticker);
      const prod = productionCohortRanking(uVerify, smallcapFormulas, id, track, null,
        { classify: smallcapRoute, growthBoost: false }).map((r) => r.ticker);
      const bSet = new Set(b), pSet = new Set(prod);
      const fehlt = b.filter((t) => !pSet.has(t));                   // auf dem Board, nicht im Primitiv
      // Ueberhang = Namen, die das Primitiv VOR dem letzten Board-Namen fuehrt, das Board aber nicht.
      // Das Board ist je Track auf TOPN gekappt, das Primitiv nicht: ohne diese Grenze zaehlte jeder
      // Name ab Rang TOPN+1 als Luecke (Review-Fund 21.09.). Ist das Board nicht gekappt, gilt der
      // ganze Rest des Primitivs.
      const ueberhang = [];
      if (b.length < TOPN) { for (const t of prod) if (!bSet.has(t)) ueberhang.push(t); }
      else { let gesehen = 0; for (const t of prod) { if (gesehen >= b.length) break; if (bSet.has(t)) gesehen++; else ueberhang.push(t); } }
      // Reihenfolge nur ueber die gemeinsamen Namen — "fehlt" und "Ueberhang" stehen getrennt daneben.
      const reihenfolgeGleich = JSON.stringify(prod.filter((t) => bSet.has(t))) === JSON.stringify(b.filter((t) => pSet.has(t)));
      zeilen.push({ id, track, boardDa, nBoard: b.length, nPrimitiv: prod.length, ueberhang, fehlt, reihenfolgeGleich });
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!zeilen.length) fail('nichts verglichen — keine Formel-ID, kein Urteil');
  const mitLuecke = zeilen.filter((z) => z.ueberhang.length || z.fehlt.length || !z.reihenfolgeGleich);
  // Kreuz-Review 21.09. (P2): ein Rauchtest auf Altbestand darf weder eine echte Messung ueberschreiben
  // noch spaeter als Vintage-Beleg gelesen werden — eigener Standardpfad und Kopfzeile.
  const rauchtest = process.argv.includes('--lokal-kein-beleg');
  const out = arg('--out') || path.join(__dirname, '..', 'reports', `t135-paritaetsluecke-${vintage}${rauchtest ? '-RAUCHTEST' : ''}.md`);
  const md = [
    `# T135 Paritaetsluecke productionCohortRanking vs. runSmallcapPass — Vintage ${vintage}${rauchtest ? ' — RAUCHTEST, KEIN BELEG' : ''}`,
    '',
    ...(rauchtest ? ['**RAUCHTEST auf lokalem Altbestand (--lokal-kein-beleg): keine CI-Population, keine zitierfaehige Zahl.**', ''] : []),
    `Population: \`${snap}\` (${uBoard.length} Small-Cap-Zeilen nach loadSmallcapUniverse), Coverage-Floor dieses Laufs (aus index.json des Board-Pfads): ${index.coverageFloor}.`,
    'Beide versiegelten Funktionen wurden aufgerufen, keine nachgebaut. Bekannte Abweichung bis zur naechsten GQS-00-Transition.',
    '',
    `Board×Track mit Luecke: ${mitLuecke.length}/${zeilen.length}. Formeln ohne geschriebenes Board: ${[...new Set(zeilen.filter((z) => !z.boardDa).map((z) => z.id))].join(', ') || 'keine'}.`,
    'Grenze: rankBy (Primitiv) sortiert nur nach Score, das Board bricht Gleichstaende nach Ticker — "Reihenfolge NEIN" bei Gleichstand ist kein Befund.',
    '',
    '| Board | Track | Board (Zeilen) | Primitiv | Ueberhang (nur Primitiv) | Fehlt im Primitiv | Reihenfolge sonst gleich |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...zeilen.map((z) => `| ${z.id}${z.boardDa ? '' : ' (kein Board)'} | ${z.track} | ${z.nBoard} | ${z.nPrimitiv} | ${z.ueberhang.join(', ') || '—'} | ${z.fehlt.join(', ') || '—'} | ${z.reihenfolgeGleich ? 'ja' : 'NEIN'} |`),
    '',
  ].join('\n');
  fs.writeFileSync(out, md);
  console.log(`t135-paritaetsluecke: ${mitLuecke.length}/${zeilen.length} Board×Track mit Luecke -> ${out}`);
}

main();
