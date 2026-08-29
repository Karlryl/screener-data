'use strict';
/**
 * Rang-Anker-Gate (Direktive 4 + Task 2.10) — der Bless-Gate fuer score-veraendernde Tasks (R-Gate,
 * Grundgesetz 8). Pinnt die DURABLE Direktive-4-Invariante: Karls Hypergrowth-Anker stehen "oben" =
 * im oberen Bereich IHRES BOARDS (within-Kohorten-Rang). Dieser Rang ist gegen die EB-Shrinkage (2.10)
 * invariant (uniforme affine Transformation je Kohorte -> Ordnung erhalten) und damit der richtige,
 * stabile Anker — anders als die Grundgesetz-3-kompromittierte globale Cross-Kohorten-Overview.
 *
 * Zusaetzlich 2.10-spezifisch: (a) kein cohortFallback-Name (duenne Kohorte) draengt in die Overview-Spitze;
 * (b) cohortN/cohortFallback-Feld-Integritaet auf den Anker-Zeilen.
 *
 * Ein score-veraendernder Bless (Fixture-Bless) DARF diesen Test nur mit dokumentierter Begruendung
 * beruehren und Regressionstests nur HINZUFUEGEN, nie relaxen (L6).
 *
 * Usage:  node tests/scoring/anchors.rank.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isMetadataSnapshot } = require('../../lib/snapshot-fs.js');
const { scoreUniverse, rankBy, produceRankings, MIN_COHORT_N } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

// SCREENER_SNAPSHOTS_DIR: nur Test-Seam (spiegelt score.integration.test.js Z.34, bereits geblesst) —
// laesst den hermetischen Rumpf-Skip-Regressionstest (anchors.rank.rumpf-skip.test.js) ein synthetisches
// Fixture-Universum injizieren; ohne die Variable unveraendert das echte snapshots/.
const SNAP_DIR = process.env.SCREENER_SNAPSHOTS_DIR || path.join(__dirname, '..', '..', 'snapshots');
const universe = [];
// snapFiles = Rohdatei-Zahl im Verzeichnis. universe zaehlt nur die JSON.parse+meta.ticker-Ueberlebenden;
// ohne die Rohzahl sehen "Verzeichnis leer" und "Tausende Dateien, aber Schema unlesbar" gleich aus.
let snapFiles = 0;
try {
  const files = fs.readdirSync(SNAP_DIR).filter((x) => x.endsWith('.json') && !isMetadataSnapshot(x));
  snapFiles = files.length;
  for (const f of files) {
    try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); } catch (_) {}
  }
} catch (_) {}

if (universe.length < 100) {
  // P1-Chunk 4 Stufe 1 (Sichtbarkeit, Tag 623): der Aussteig bleibt gruen (Exit 0), darf aber nicht
  // mehr STILL sein. console.log direkt auf stdout, ohne Wrapper/Praefix — nur so parst GitHub die
  // Zeile als Annotation (Lektion F2964). Die scharfe Stufe (Exit 1) ist bewusst NICHT hier.
  console.log(`::warning::anchors.rank.test.js: ${snapFiles} Dateien im Snapshot-Verzeichnis, davon ${universe.length} lesbar (<100 noetig) — leeres Universum ODER Schema unlesbar. Die Rang-Anker (Direktive 4) wurden NICHT gemessen; diese Suite meldet gruen, ohne etwas geprueft zu haben.`);
  console.log('  (Universum < 100 -> Rang-Anker uebersprungen, KEIN Fail — pre-pull-Gate)');
  console.log('anchors.rank.test.js: 0 ok, 0 fail (skipped: kein Universum)');
  process.exit(0);
}
console.log(`  (Universum: ${universe.length} Snapshots geladen)`);
const results = scoreUniverse(universe, formulas);
const byTicker = Object.fromEntries(results.map((r) => [r.ticker, r]));

// within-Board-Rang eines Ankers als Prozentil seines Track-Rankings (0 = Spitze).
function boardPct(ticker, formulaId, track) {
  const cohort = rankBy(results, formulaId, track);
  const i = cohort.findIndex((e) => e.ticker === ticker);
  assert.ok(i >= 0, `${ticker} nicht im ${formulaId}|${track}-Ranking`);
  return { pct: i / cohort.length, rank: i + 1, n: cohort.length };
}

// --- KARL-ENTSCHEID 18.08.2026: KEINE ANKER MEHR ----------------------------
// Woertlich: "ich wollte in diesem gesamten screener keine anker. die unternehmen die
// ich dir mal genannt habe waren alle Unternehmen, um zu wissen, wie der Screener
// entwickelt wird. Theoretisch sollte Credo auf Platz 230 fallen, weil es einfach 230
// bessere Unternehmen gibt dort im Screener. Ist das voellig in Ordnung. ... Ich moechte
// eigentlich nur die beste Formel entwickeln. Brauche dafuer aber nicht Credo auf Platz 1,
// und ich brauche nicht Astera Labs auf Platz 10, sondern ich brauche das, was der
// Screener sagt."
//
// WAS HIER STAND UND WARUM ES FIEL: vier hartkodierte Perzentil-Schranken
// (CRDO<=15 %, ALAB<=15 %, PLTR<=5 %, BE<=25 %) plus eine erzwungene Ordnung CRDO>=ALAB.
// Drei Gruende, jeder fuer sich ausreichend:
//   1. Die Zahlen stammten von keiner Entscheidung, sondern von einer Momentaufnahme
//      plus Luftpolster — die Datei dokumentierte das selbst ("// real 8.9%" neben
//      max: 0.15). Karls Direktive 4 (02.07.) enthaelt keine Zahl.
//   2. Karl hatte die scharfe Lesart am 27./28.07. selbst entschaerft ("ein Urteil des
//      Screeners, kein Fehler") — der Test hat das nie mitbekommen und erzwang taeglich
//      eine abgeschaffte Regel.
//   3. Sie waren strukturell nicht haltbar: die Vergleichsgruppe wuchs durch Karls
//      eigenes Universums-Mandat von 60 auf 294 Firmen. ALAB rutschte dadurch ueber
//      Wochen von 15,3 auf 15,6 % — ohne dass sich an ALAB etwas geaendert haette.
//      Der letzte gruene Lauf (07.08.) bestand mit 0,07 Prozentpunkten Luft. Eine
//      Schranke, die an einer wandernden Kante sitzt, ist ein Muenzwurf, kein Waechter.
// Zusaetzlich verletzten sie das bestehende Hardcoded-Ticker-Verbot.
//
// WAS STATTDESSEN GILT: die Raenge werden weiter JEDEN LAUF protokolliert — Karl sieht
// unveraendert, wo diese Firmen stehen. Sie halten nur nichts mehr auf.
const BEOBACHTET = [
  { t: 'CRDO', fid: 'semiconductors', track: 'profitable' },
  { t: 'ALAB', fid: 'semiconductors', track: 'profitable' },
  { t: 'PLTR', fid: 'software-comm-services', track: 'profitable' },
  { t: 'BE', fid: 'industrials', track: 'profitable' },
];
// Protokoll statt Schranke. Dieser Test kann an einem Rang NICHT mehr scheitern — das ist
// der Punkt. Er faellt nur, wenn das Ranking selbst unbrauchbar ist (siehe unten), denn ein
// Protokoll, das schweigend nichts protokolliert, waere schlimmer als keines.
test('Beobachtung: wo die vier Entwicklungs-Referenzen heute stehen (kein Gate)', () => {
  let gefunden = 0;
  for (const a of BEOBACHTET) {
    const e = byTicker[a.t];
    if (!e || e.action !== 'route' || e.formulaId !== a.fid) {
      // KEIN Fail: dass eine Firma nicht (mehr) geroutet wird, ist ein Ergebnis des
      // Screeners, kein Fehler des Screeners. Genau Karls Entscheid.
      console.log(`       ${a.t}: nicht im ${a.fid}|${a.track}-Ranking (${e ? 'action=' + e.action + ', formulaId=' + e.formulaId : 'nicht im Universum'})`);
      continue;
    }
    const r = boardPct(a.t, a.fid, a.track);
    console.log(`       ${a.t} Rang ${r.rank}/${r.n} = ${(r.pct * 100).toFixed(1)}% (Score ${e.score.toFixed(1)})`);
    gefunden++;
  }
  // Die EINZIGE harte Zusicherung, die bleibt, und sie handelt nicht von den Firmen:
  // wenn KEINE der vier ueberhaupt auffindbar ist, misst dieser Test nichts mehr und
  // meldete sonst stumm "ok" — genau die Sorte Test, die gruen ist, ohne etwas zu pruefen.
  // Faellt sie, ist das Universum leer oder das Schema unlesbar, nicht "ein Anker gefallen".
  assert.ok(gefunden > 0, 'keine einzige der vier Referenzfirmen im Ranking auffindbar — Universum leer oder Schema unlesbar (das ist KEIN Rang-Befund)');
});

// --- 2.10: kein cohortFallback-Name (duenne Kohorte) in der Overview-Spitze -----------
test('2.10: kein cohortFallback-Name (n < MIN_COHORT_N) in den Overview-Top-25', () => {
  const routed = results.filter((e) => e.action === 'route' && Number.isFinite(e.score));
  const ov = routed.slice().sort((a, b) => b.score - a.score || (a.ticker < b.ticker ? -1 : 1)).slice(0, 25);
  const bad = ov.filter((e) => e.cohortFallback === true);
  assert.equal(bad.length, 0, `duenne-Kohorten-Namen in Overview-Top-25: ${bad.map((e) => e.ticker + '(' + e.formulaId + '|' + e.track + ' n=' + e.cohortN + ')').join(', ')}`);
});

// --- 2.10: cohortN/cohortFallback-Feld-Integritaet ----------------------------
// UMGEBAUT 18.08.2026, aus zwei unabhaengigen Gruenden:
//
// (a) Er haengte an den vier Anker-Namen. Die gibt es als Pruefmarke nicht mehr
//     (Karl-Entscheid oben). Die Feld-Integritaet ist aber weiter wichtig — sie wird
//     jetzt ueber JEDE fette Kohorte gemessen statt ueber vier Wunschfirmen. Das ist
//     strikt mehr Abdeckung, nicht weniger.
//
// (b) Die alte Zusicherung "cohortN === Board-Laenge" war SACHLICH FALSCH und nur
//     zufaellig gruen. Belegt am roten Lauf 32094300602: 2718.HK hat alle sieben Achsen
//     leer, bekommt deshalb keinen Score und wird vom no-axes-Guard (score.js:1131)
//     aus dem Ranking geworfen — aber ERST NACHDEM allen Kohorten-Zeilen cohortN=513
//     eingetragen wurde (score.js:1101). Das angezeigte Board zaehlt danach 512.
//     Am selben Tag gab es 22 solcher Zeilen; die naechste haette BE getroffen.
//     Der Test war nie gruen, WEIL die Gleichung stimmt — sondern nur, solange zufaellig
//     kein solcher Name in einer geprueften Kohorte sass. Bei wachsendem Universum
//     passiert das immer oefter.
//     Die Wirkung des Unterschieds auf den Score: 0,0003 Punkte (Schrumpfung n/(n+2)),
//     die Reihenfolge im Board aendert sich um exakt null. Ein unsichtbarer
//     Zaehlunterschied hat die ganze Anlage rot gefaerbt.
//
// Die neue Zusicherung nagelt die SACHE fest statt der Gleichung: cohortN ist endlich,
// nie kleiner als das Board, ein Ueberschuss ist ausschliesslich durch aussortierte
// no-axes-Namen gedeckt (begrenzt, nicht beliebig), und alle Zeilen einer Kohorte tragen
// denselben Wert. Ohne solche Namen zieht sich das automatisch auf die alte Gleichheit
// zusammen — es ist also nicht weicher, nur richtig.
test('2.10: cohortN ist endlich, kohorteneinheitlich und nur durch no-axes-Namen ueberdeckt', () => {
  const noAxes = results.filter((e) => e.reason === 'no-axes').length;
  const kohorten = new Map();
  for (const e of results) {
    if (e.action !== 'route' || !Number.isFinite(e.score)) continue;
    const key = e.formulaId + '|' + e.track;
    if (!kohorten.has(key)) kohorten.set(key, []);
    kohorten.get(key).push(e);
  }
  let geprueft = 0;
  for (const [key, zeilen] of kohorten) {
    const [fid, track] = key.split('|');
    const board = rankBy(results, fid, track);
    const n = zeilen[0].cohortN;
    assert.ok(Number.isFinite(n), `${key}: cohortN nicht finit (${n})`);
    assert.ok(zeilen.every((e) => e.cohortN === n),
      `${key}: cohortN uneinheitlich innerhalb der Kohorte`);
    assert.ok(n >= board.length && n - board.length <= noAxes,
      `${key}: cohortN=${n} ausserhalb [Board=${board.length}, Board+no-axes=${board.length + noAxes}]`);
    // Fette Kohorten duerfen nie den Duenn-Fallback tragen (und umgekehrt) — das ist der
    // Teil, der bei 2718.HK NICHT betroffen war und der weiter hart gilt.
    for (const e of zeilen) {
      assert.equal(e.cohortFallback, n < MIN_COHORT_N,
        `${e.ticker}: cohortFallback=${e.cohortFallback} passt nicht zu cohortN=${n} (MIN_COHORT_N=${MIN_COHORT_N})`);
    }
    geprueft++;
  }
  // Ein Test, der ueber null Kohorten laeuft, meldet sonst gruen ohne etwas zu pruefen.
  assert.ok(geprueft > 0, 'keine einzige Kohorte gefunden — Universum leer oder Schema unlesbar');
  console.log(`       ${geprueft} Kohorten geprueft, ${noAxes} no-axes-Namen im Universum`);
});

// --- 2.10: cohortN wandert in den v1-Export (produceRankings-Zeilen) -----------
test('2.10: produceRankings-Board/Overview-Zeilen tragen cohortN + cohortFallback', () => {
  const r = produceRankings(results, { topN: 50 });
  const semis = r.branches['semiconductors'].profitable;
  assert.ok(semis.length > 0, 'semis-Board leer');
  for (const row of semis) {
    assert.ok(Number.isFinite(row.cohortN), `${row.ticker} cohortN nicht finit im Board-Export`);
    assert.equal(typeof row.cohortFallback, 'boolean', `${row.ticker} cohortFallback nicht boolean`);
  }
  assert.ok(r.overview.length > 0 && Number.isFinite(r.overview[0].cohortN), 'overview-Zeile ohne cohortN');
});

// --- 2.3-A8: Voll-Kohorten-Abgriff (Vintage-Substrat, 2.8 §6) ------------------
test('A8: produceRankings.full traegt die VOLLE Kohorte; Board == full.slice(0,topN) byte-gleich', () => {
  const r = produceRankings(results, { topN: 50 });
  assert.ok(r.full && typeof r.full === 'object', 'full fehlt im Rueckgabewert');
  let checkedBranches = 0, fullGreater = 0;
  for (const [id, b] of Object.entries(r.branches)) {
    for (const t of Object.keys(b)) {
      const fullList = (r.full[id] || {})[t];
      assert.ok(Array.isArray(fullList), `${id}.${t}: full-Liste fehlt`);
      const cohort = rankBy(results, id, t);
      assert.equal(fullList.length, cohort.length, `${id}.${t}: full=${fullList.length} != Kohorte=${cohort.length}`);
      assert.equal(JSON.stringify(fullList.slice(0, 50)), JSON.stringify(b[t]),
        `${id}.${t}: Board ist nicht das byte-gleiche topN-Praefix der full-Liste`);
      if (fullList.length > b[t].length) fullGreater++;
      checkedBranches++;
    }
  }
  assert.ok(checkedBranches > 0, 'keine Branch geprueft');
  assert.ok(fullGreater > 0, 'keine einzige Kohorte > topN — Test beisst nicht (Universum zu klein?)');
});

console.log(`\nanchors.rank.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
