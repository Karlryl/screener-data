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
 * ── ZWEI FEHLERKLASSEN, ZWEI EXIT-CODES (Beschluss 16.08., Bruell-Kanal) ──────────────
 * Bis Tag 957 blockierte JEDER Fail hier den ganzen Tageslauf. Das ist fuer eine
 * Rangfolge falsch herum: bei einem Prozentil-Riss sind die Daten KORREKT — die Formel
 * liefert nur eine Reihung, die Karl nicht will. Stehende Boards machen diese Verletzung
 * UNSICHTBARER, nicht sichtbarer (Karl saehe dann gar nichts statt des Fehlers; fuenf
 * Naechte Stillstand 11.-15.08. waren der schlimmste Zustand des Projekts).
 *
 *   exit 1  DATENINTEGRITAET  Anker fehlt / nicht geroutet / falsches Board ·
 *                             cohortN/cohortFallback-Feldschaden · A8-Strukturbruch ·
 *                             duenne Kohorte in der Overview-Spitze
 *                             -> Tageslauf BLOCKIERT, es geht nichts raus (wie bisher).
 *   exit 2  RANGFOLGE         die Prozentil-Schwellen der ANCHORS + CRDO>=ALAB
 *                             -> Boards gehen RAUS, danach faerbt der laufstatus-Job den
 *                                Lauf rot und das Dashboard zeigt ein Banner.
 *   exit 0  alles gruen.
 *
 * Die Grenze verlaeuft INNERHALB dieser Datei, Assert fuer Assert: Rangfolge-Asserts
 * benutzen `rang(...)`, alle uebrigen weiter `assert.*`. Praezedenz der exit-2-Semantik:
 * tests/board-history.test.js ("suspect + exit 2").
 *
 * ANCHOR_STATUS_OUT=<pfad> schreibt zusaetzlich den Marker outputs/anchor-status.json
 * (Bauform von outputs/coverage-status.json). Ohne die Variable — lokal, im PR-Check —
 * wird NICHTS geschrieben; der Test bleibt nebenwirkungsfrei.
 *
 * Usage:  node tests/scoring/anchors.rank.test.js   (Exit 0/1/2)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isMetadataSnapshot } = require('../../lib/snapshot-fs.js');
const { writeJsonAtomic } = require('../../lib/atomic-write.js');
const { scoreUniverse, rankBy, produceRankings } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

/** Rangfolge-Verletzung. Traegt exit 2 statt exit 1 — bruellen statt blockieren. */
class RangRiss extends Error {}
/** Assert der Rangfolge-Klasse. Alles andere bleibt `assert.*` (= Datenintegritaet). */
function rang(bedingung, nachricht) { if (!bedingung) throw new RangRiss(nachricht); }

let pass = 0, failDaten = 0, failRang = 0;
const risse = [];      // Klartext-Zeilen der Rangfolge-Verletzungen (Banner-Text drueben)
const messungen = [];  // je Anker eine Messzeile fuer den Marker
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) {
    if (e instanceof RangRiss) {
      failRang++; risse.push(e.message);
      console.error('RANG   ' + name + '\n       ' + e.message);
    } else {
      failDaten++;
      console.error('FAIL   ' + name + '\n       ' + e.message);
    }
  }
}

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

// --- Direktive 4: die Anker stehen oben in IHREM Board -----------------------
// NVDA (Beschluss 16.08.): fuenfter Anker in DERSELBEN Form, Schwelle 25 % (Kategorie BE).
// KEINE `ALAB >= NVDA`-Ordnung — NVDA ist im Repo dreifach als POSITIV-Name belegt
// (lamps.js:596 "Firmen, die Karl sehen WILL", score.js:1360 "am 02.08. vermisst",
// Formel-Spec v5.2 Z.57 als Verified-Instance #2), und dieselbe Spec (Z.64) nennt das
// ALAB/NVDA-Kippen ausdruecklich als LEGITIMES, datengetriebenes Szenario. Ein harter
// Ordnungs-Assert wuerde ein gewolltes Ergebnis als Regression brandmarken — genau die
// Fehlerklasse, die einen Alarmkanal abstumpft. Zugesichert wird nur "NVDA bleibt oben
// sichtbar in seinem Board".
// Die Schwelle ist NICHT auf den Ist-Wert gefittet (Verbot score.js:435 ff.): 13,2 % bei
// der Erstmessung, 25 % gewaehlt, weil M-A die Anker steigen laesst (~12 Punkte Puffer).
// Nach dem M-A-Merge wird einmal NACHGEMESSEN, nicht nachjustiert; liegt NVDA dann ueber
// 25 %, ist das ein Befund fuer die Karl-Entscheid-Queue, keine Schwellenfrage.
const ANCHORS = [
  { t: 'CRDO', fid: 'semiconductors', track: 'profitable', max: 0.15 }, // real 1.1%
  { t: 'ALAB', fid: 'semiconductors', track: 'profitable', max: 0.15 }, // real 8.9%
  { t: 'PLTR', fid: 'software-comm-services', track: 'profitable', max: 0.05 }, // real 1.1%
  { t: 'BE', fid: 'industrials', track: 'profitable', max: 0.25 }, // real 20.3%
  { t: 'NVDA', fid: 'semiconductors', track: 'profitable', max: 0.25 }, // real 13.2%
];
for (const a of ANCHORS) {
  test(`Direktive 4: ${a.t} oben in ${a.fid}|${a.track} (<= ${a.max * 100}%)`, () => {
    const e = byTicker[a.t];
    // C2 (kein stiller Rumpf-Skip): fehlender/nicht-gerouteter Anker faerbt HART rot statt vakuos "ok".
    // Meldung nennt Ticker + Grund (fehlend vs. action!='route'), damit ein Fail sofort als harmlose
    // Anker-Verschiebung ODER echte Regression lesbar ist.
    // DATENINTEGRITAET (exit 1): ein fehlender/falsch gerouteter Anker heisst, dass die
    // Zeile kaputt ist — dann ist auch das Board kaputt und darf nicht raus.
    assert.ok(e, `${a.t} fehlt komplett im Universum — Direktive 4 nicht pruefbar (Anker verschwunden? Karl-Entscheid noetig)`);
    assert.equal(e.action, 'route', `${a.t} nicht geroutet (action=${e.action}) — Direktive 4 nicht pruefbar`);
    assert.equal(e.formulaId, a.fid, `${a.t} formulaId=${e.formulaId}`);
    const r = boardPct(a.t, a.fid, a.track);
    console.log(`       ${a.t} Rang ${r.rank}/${r.n} = ${(r.pct * 100).toFixed(1)}% (Score ${e.score.toFixed(1)})`);
    messungen.push({ ticker: a.t, board: a.fid, track: a.track, rank: r.rank, n: r.n,
      pct: Number((r.pct * 100).toFixed(2)), max: a.max * 100, ok: r.pct <= a.max });
    // RANGFOLGE (exit 2): die Daten sind hier korrekt, nur die Reihung gefaellt nicht.
    rang(r.pct <= a.max, `${a.t} Rang ${r.rank}/${r.n} = ${(r.pct * 100).toFixed(1)}% > ${a.max * 100}% in ${a.fid}|${a.track}`);
  });
}

// --- Direktive 4: CRDO steht ueber ALAB im semiconductors-Board (Hypergrowth-Ordnung) ----
test('Direktive 4: CRDO rankt >= ALAB im semiconductors|profitable-Board', () => {
  const crdo = byTicker['CRDO'], alab = byTicker['ALAB'];
  // C2: statt stillem return benennt der Fail, WELCHER der beiden fehlt bzw. nicht geroutet ist.
  assert.ok(crdo, 'CRDO fehlt im Universum — CRDO>=ALAB-Ordnung nicht pruefbar');
  assert.ok(alab, 'ALAB fehlt im Universum — CRDO>=ALAB-Ordnung nicht pruefbar');
  assert.equal(crdo.action, 'route', `CRDO nicht geroutet (action=${crdo.action}) — CRDO>=ALAB-Ordnung nicht pruefbar`);
  assert.equal(alab.action, 'route', `ALAB nicht geroutet (action=${alab.action}) — CRDO>=ALAB-Ordnung nicht pruefbar`);
  // RANGFOLGE (exit 2): eine Ordnung zwischen zwei korrekt berechneten Namen.
  rang(crdo.score >= alab.score, `CRDO ${crdo.score.toFixed(1)} sollte >= ALAB ${alab.score.toFixed(1)} im semiconductors|profitable-Board`);
});

// --- 2.10: kein cohortFallback-Name (duenne Kohorte) in der Overview-Spitze -----------
test('2.10: kein cohortFallback-Name (n < MIN_COHORT_N) in den Overview-Top-25', () => {
  const routed = results.filter((e) => e.action === 'route' && Number.isFinite(e.score));
  const ov = routed.slice().sort((a, b) => b.score - a.score || (a.ticker < b.ticker ? -1 : 1)).slice(0, 25);
  const bad = ov.filter((e) => e.cohortFallback === true);
  assert.equal(bad.length, 0, `duenne-Kohorten-Namen in Overview-Top-25: ${bad.map((e) => e.ticker + '(' + e.formulaId + '|' + e.track + ' n=' + e.cohortN + ')').join(', ')}`);
});

// --- 2.10: cohortN/cohortFallback-Feld-Integritaet auf Anker-Zeilen ------------
test('2.10: Anker-Zeilen tragen finite cohortN == Kohortengroesse, cohortFallback=false (fette Kohorten)', () => {
  for (const a of ANCHORS) {
    const e = byTicker[a.t];
    // C2: kein stilles continue — ein fehlender Anker faerbt die 2.10-Feld-Integritaet laut rot.
    assert.ok(e, `${a.t} fehlt im Universum — 2.10-Feld-Integritaet nicht pruefbar`);
    assert.equal(e.action, 'route', `${a.t} nicht geroutet (action=${e.action}) — 2.10-Feld-Integritaet nicht pruefbar`);
    const cohort = rankBy(results, a.fid, a.track);
    assert.ok(Number.isFinite(e.cohortN) && e.cohortN === cohort.length, `${a.t} cohortN=${e.cohortN} != ${cohort.length}`);
    assert.equal(e.cohortFallback, false, `${a.t} sollte in fetter Kohorte (fb=false) sein`);
  }
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

// --- Anker-Marker (Bauform coverage-status.json) ------------------------------
// Nur wenn ANCHOR_STATUS_OUT gesetzt ist (der Tageslauf setzt sie). Lokal und im
// PR-Check bleibt der Test nebenwirkungsfrei. IMMER geschrieben wenn gesetzt, auch bei
// 'ok' — sonst kann das Dashboard "alles gut" nicht von "Marker fehlt" unterscheiden.
// Auf dem Rumpf-Skip-Pfad oben wird bewusst NICHT geschrieben: ein 'ok' ohne Messung
// waere genau die Luege, gegen die Tag 952/956 gebaut wurde.
const ANCHOR_STATUS_OUT = process.env.ANCHOR_STATUS_OUT || '';
if (ANCHOR_STATUS_OUT) {
  const status = failDaten ? 'blockiert' : (failRang ? 'rangfolge' : 'ok');
  const marker = {
    schema: 'anchor-status/v1',
    generated_at: new Date().toISOString(),
    status,                                 // 'ok' | 'rangfolge' | 'blockiert'
    breached: status !== 'ok',              // Banner an/aus (Rolle von coverage.degraded)
    blocked: status === 'blockiert',        // Boards gehen NICHT raus (Rolle von coverage.blocked)
    verletzungen: risse.slice(),            // Klartext-Zeilen; leer bei 'ok'
    anker: messungen.slice(),               // je Anker rank/n/pct/max — auch bei 'ok'
  };
  try {
    fs.mkdirSync(path.dirname(path.resolve(ANCHOR_STATUS_OUT)), { recursive: true });
    writeJsonAtomic(path.resolve(ANCHOR_STATUS_OUT), marker);
    console.log(`  (Anker-Marker geschrieben: ${ANCHOR_STATUS_OUT} status=${status})`);
  } catch (e) {
    // NICHT verschlucken: ohne Marker ist der Bruell-Kanal fuer diesen Lauf blind, und
    // das Dashboard zeigt keinen Hinweis. exit 1 (Datenklasse) ist hier richtig — ein
    // stummer Alarmkanal ist schlimmer als ein blockierter Lauf.
    console.error(`::error::Anker-Marker ${ANCHOR_STATUS_OUT} nicht schreibbar: ${e.message}. `
      + 'Der Bruell-Kanal waere fuer diesen Lauf blind — Abbruch statt stiller Auslieferung.');
    failDaten++;
  }
}

console.log(`\nanchors.rank.test.js: ${pass} ok, ${failDaten + failRang} fail`
  + (failRang ? ` (davon ${failRang} Rangfolge -> exit 2: liefern und bruellen)` : ''));
// exit 1 schlaegt exit 2: liegt gleichzeitig ein Datenschaden vor, wird blockiert.
process.exit(failDaten ? 1 : (failRang ? 2 : 0));
