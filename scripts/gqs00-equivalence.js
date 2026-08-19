'use strict';
/**
 * GQS-00 Reproduktions-Nachweis: erzeugt das evidence-JSON, das
 * `scripts/gqs00-freeze.js --initialize --evidence <datei>` in
 * `production-equivalence.json` giesst.
 *
 * Zwei Messungen, beide auf EINEM geladenen Produktionsuniversum:
 *
 *  1) frozenCodeComparison  — Produktions-Checkout (headSha des Laufs) gegen den
 *     einzufrierenden Code. Zwei getrennte scoreUniverse-Ausfuehrungen; verglichen
 *     werden Zeilenform, UNGERUNDETER Score und Kohorten-Rang.
 *  2) publishedComparison   — der einzufrierende Code gegen das VEROEFFENTLICHTE
 *     Board (board-history/<vintage>/<branche>.json). Verglichen werden
 *     Tickerreihenfolge, Anzeige-Score und veroeffentlichter Rang.
 *
 * Alle Abweichungs-Zaehler muessen 0 sein. Ein Wert != 0 ist ein BEFUND, kein
 * Rundungsproblem — das Siegel darf dann nicht gesetzt werden (exit 1).
 *
 * Aufruf:
 *   node scripts/gqs00-equivalence.js \
 *     --production <checkout des Lauf-headSha> \
 *     --snapshots  <entpacktes snapshots-Artefakt des Laufs, BESCHREIBBAR> \
 *     --boards     board-history/<vintage> \
 *     --out        evidence-<semver>.json \
 *     [--frozen <repo>]        Default: das Repo dieses Skripts
 *     [--prior-tree <sha1>] [--current-tree <sha1>]   src/scoring-Tree je Seite
 *     [--artifact <zip>]       Snapshot-Artefakt-Zip, wird mitgehasht
 *
 * Das Snapshot-Verzeichnis muss BESCHREIBBAR sein: loadUniverse() schreibt dort
 * seinen Coverage-Floor-Hochwasserstand (_last_good_disk.json) fort.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0) {
    assert(fallback !== undefined, 'fehlendes Pflichtargument ' + name);
    return fallback;
  }
  const v = argv[i + 1];
  assert(v && !v.startsWith('--'), name + ' braucht einen Wert');
  return v;
}

function scoringSide(repoDir) {
  const dir = path.join(repoDir, 'src', 'scoring');
  assert(fs.existsSync(dir), 'kein src/scoring in ' + repoDir);
  const score = require(path.join(dir, 'score.js'));
  return {
    dir,
    scoreUniverse: score.scoreUniverse,
    produceRankings: score.produceRankings,
    formulas: require(path.join(dir, 'formulas', 'index.js')),
  };
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Zeilenform: alles, was ueber die blosse Zahl hinaus die Zeile identifiziert. Ein
// Routing-/Track-/Kohorten-Wechsel bei zufaellig gleichem Score ist ein Befund.
const SHAPE_FIELDS = ['ticker', 'action', 'reason', 'formulaId', 'track', 'cohortN', 'cohortFallback'];

function compareRawResults(a, b) {
  let resultShapeMismatches = Math.abs(a.length - b.length);
  let rawScoreMismatches = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (SHAPE_FIELDS.some((f) => (a[i][f] ?? null) !== (b[i][f] ?? null))) resultShapeMismatches++;
    // Object.is statt ===: unterscheidet -0/+0 und zaehlt zwei NaN als gleich (derselbe
    // Defekt auf beiden Seiten ist keine Abweichung zwischen den Seiten).
    if (!Object.is(a[i].score ?? null, b[i].score ?? null)) rawScoreMismatches++;
  }
  return { resultShapeMismatches, rawScoreMismatches };
}

// Rang = Position in der vollen sortierten Kohorte (produceRankings.full) — genau die
// Reihenfolge, die board-history spaeter als rank einfriert.
function compareFullRanks(fullA, fullB) {
  let mismatches = 0;
  const ids = [...new Set([...Object.keys(fullA), ...Object.keys(fullB)])].sort();
  for (const id of ids) {
    for (const track of ['profitable', 'unprofitable']) {
      const ra = ((fullA[id] || {})[track]) || [];
      const rb = ((fullB[id] || {})[track]) || [];
      mismatches += Math.abs(ra.length - rb.length);
      for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
        if (ra[i].ticker !== rb[i].ticker) mismatches++;
      }
    }
  }
  return mismatches;
}

function comparePublished(full, boardsDir, branchIds) {
  const tracks = [];
  let comparedRows = 0, tickerMismatches = 0, scoreMismatches = 0, rankMismatches = 0;
  for (const formulaId of branchIds.slice().sort()) {
    const file = path.join(boardsDir, formulaId + '.json');
    assert(fs.existsSync(file), 'kein veroeffentlichtes Board ' + file);
    const published = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(published.cohort, formulaId + '.json traegt keine cohort — falsches Vintage-Format?');
    for (const track of ['profitable', 'unprofitable']) {
      const exp = published.cohort[track] || [];
      const act = ((full[formulaId] || {})[track]) || [];
      let tm = 0, sm = 0, rm = 0;
      for (let i = 0; i < Math.min(exp.length, act.length); i++) {
        if (exp[i].ticker !== act[i].ticker) tm++;
        if (!Object.is(exp[i].score ?? null, act[i].score ?? null)) sm++;
        if (exp[i].rank !== i + 1) rm++; // veroeffentlichter Rang gegen reproduzierte Position
      }
      // Eine Zeilenzahl-Differenz zaehlt in ALLE drei Zaehler: eine fehlende Zeile ist
      // zugleich falscher Ticker, falscher Score und falscher Rang — nicht "nichts".
      const fehl = Math.abs(exp.length - act.length);
      tm += fehl; sm += fehl; rm += fehl;
      tracks.push({
        formulaId, track, expectedRows: exp.length, actualRows: act.length,
        tickerOrderMismatches: tm, displayScoreMismatches: sm, publishedRankMismatches: rm,
      });
      comparedRows += exp.length;
      tickerMismatches += tm; scoreMismatches += sm; rankMismatches += rm;
    }
  }
  return { comparedRows, tickerMismatches, scoreMismatches, rankMismatches, tracks };
}

function main(argv) {
  const production = path.resolve(arg(argv, '--production'));
  const frozen = path.resolve(arg(argv, '--frozen', REPO));
  const snapshots = path.resolve(arg(argv, '--snapshots'));
  const boardsDir = path.resolve(arg(argv, '--boards'));
  const outFile = path.resolve(arg(argv, '--out'));
  const artifact = argv.includes('--artifact') ? path.resolve(arg(argv, '--artifact')) : null;

  const { loadUniverse } = require(path.join(production, 'src', 'scoring', 'run-screener.js'));
  // watchlistPath bleibt bewusst der Default des PRODUKTIONS-Checkouts: der scoring-Job
  // laedt kein prep-state, er sieht die watchlist.json seines eigenen Checkouts. Eine
  // neuere aus main waere ein anderes Universum.
  const universe = loadUniverse(snapshots);
  assert(universe.length > 0, 'leeres Universum geladen');

  const prod = scoringSide(production);
  const frz = scoringSide(frozen);

  // structuredClone je Seite: scoreUniverse haengt Felder an die Snapshots (dieselbe
  // Vorsicht wie in gqs00-freeze.js), sonst misst der zweite Lauf Reste des ersten.
  const resultsProd = prod.scoreUniverse(structuredClone(universe), prod.formulas, {});
  const resultsFrz = frz.scoreUniverse(structuredClone(universe), frz.formulas, {});
  const rankedProd = prod.produceRankings(resultsProd, { topN: 100 });
  const rankedFrz = frz.produceRankings(resultsFrz, { topN: 100 });

  const raw = compareRawResults(resultsProd, resultsFrz);
  const frozenCodeComparison = {
    priorScoringTree: arg(argv, '--prior-tree', null),
    currentScoringTree: arg(argv, '--current-tree', null),
    comparedResults: resultsProd.length,
    resultShapeMismatches: raw.resultShapeMismatches,
    rawScoreMismatches: raw.rawScoreMismatches,
    rawRankMismatches: compareFullRanks(rankedProd.full, rankedFrz.full),
  };
  const publishedComparison = comparePublished(rankedFrz.full, boardsDir, Object.keys(frz.formulas));

  const snapshotFiles = fs.readdirSync(snapshots)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_manifest') && f !== '_last_good_disk.json').length;

  const evidence = {
    schema: 'gqs-equivalence-evidence/v1',
    measuredInput: {
      productionCheckout: production,
      frozenCheckout: frozen,
      snapshotDir: snapshots,
      boardsDir,
      snapshotFiles,
      loadedUniverse: universe.length,
      snapshotManifestSha256: fileSha256(path.join(snapshots, '_manifest.json')),
      snapshotArtifactDigestSha256: artifact ? fileSha256(artifact) : null,
    },
    frozenCodeComparison,
    publishedComparison,
  };
  fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  return evidence;
}

if (require.main === module) {
  const ev = main(process.argv.slice(2));
  console.log(JSON.stringify({
    measuredInput: ev.measuredInput,
    frozenCodeComparison: ev.frozenCodeComparison,
    publishedComparison: { ...ev.publishedComparison, tracks: ev.publishedComparison.tracks.length + ' Spuren' },
  }, null, 2));
  const zaehler = [
    ev.frozenCodeComparison.resultShapeMismatches, ev.frozenCodeComparison.rawScoreMismatches,
    ev.frozenCodeComparison.rawRankMismatches, ev.publishedComparison.tickerMismatches,
    ev.publishedComparison.scoreMismatches, ev.publishedComparison.rankMismatches,
  ];
  if (zaehler.some((n) => n !== 0)) {
    console.error('::error::Abweichung gefunden — KEIN Siegel setzen. Zaehler: ' + zaehler.join(', '));
    process.exitCode = 1;
  }
}

module.exports = { main, compareRawResults, compareFullRanks, comparePublished };
