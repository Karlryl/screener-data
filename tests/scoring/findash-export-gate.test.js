'use strict';
/**
 * R2.18: der Export-Gate prueft rank bisher NUR auf Typ (Number.isInteger, >=1) — nie auf
 * WERT. rank wird als i+1 aus der Array-Position erzeugt (mapBoardRow/mapOverviewRow/
 * mapSurvivalRow), also ist der Typ-Check tautologisch: er kann der Sortierung nie
 * widersprechen. Ein gebrochener Upstream-Sort (score.js produceRankings byScore) bliebe
 * unsichtbar, obwohl rank Karls einziger sichtbarer Board-Reihenfolge-Alarmkanal ist.
 *
 * Zwei unabhaengige WERT-Checks pinnen das:
 *   (a) rank === index+1 innerhalb der jeweiligen Zeilen-Liste (Ableitungs-Zusage).
 *   (b) score nicht-ansteigend ueber die Liste (score.js sortiert board-Tracks + overview.json
 *       score-desc) — bindet rank an eine von rank UNABHAENGIGE Ordnungs-Invariante, sodass ein
 *       kaputter Sort auffliegt, selbst wenn rank=i+1 (a) intern konsistent bleibt.
 * survival.json ist NICHT score-sortiert (runway-desc, Zeilen tragen gar kein .score-Feld) ->
 * bekommt nur (a), niemals (b).
 *
 * Usage:  node tests/scoring/findash-export-gate.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const wfe = require('../../scripts/write-findash-export.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const cleanBoard = {
  ticker: 'NVDA', score: 88.2, track: 'profitable', lamps: [],
  overview: { kind: 'gp', value: -0.05, companion: 89.1 },
  country: 'United States', region: 'North America', sector: 'Technology',
  marketCap: 1e12, phase: 'established', mcapBand: 'mega', ipoRecency: 'mature',
  profitTier: 'langfristig-profitabel', ipoYear: 1999,
  cohortN: 90, cohortFallback: false,
};
const cleanOv = {
  ticker: 'NVDA', formulaId: 'semiconductors', track: 'profitable', score: 94.9,
  overviewKind: 'gp', overviewValue: -1.17, overviewCompanion: 195.3, lamps: [],
  country: 'United States', region: 'North America', sector: 'Technology',
  marketCap: 1e12, phase: 'inflected', mcapBand: 'large', ipoRecency: 'growth',
  cohortN: 90, cohortFallback: false,
};
const cleanSv = {
  ticker: 'PAH3.DE', runwayQuarters: 9999, lamps: [],
  country: 'Germany', region: 'Europe', sector: 'Consumer Cyclical',
  marketCap: null, phase: null, mcapBand: 'small', ipoRecency: null,
  cohortN: null, cohortFallback: null,
};
// Board hull wie in write-findash-export.js selftest(): schema/generated_at/boardStatus/coverage/branch.
const mkHull = (profitable, unprofitable = []) => ({
  schema: wfe.SCHEMA, generated_at: 'x', boardStatus: 'core', coverage: null,
  branch: 'energy', profitable, unprofitable,
});
const mkOverviewFile = (rows) => ({ schema: wfe.SCHEMA, generated_at: 'x', coverage: null, rows });
const mkSurvivalFile = (rows) => ({ schema: wfe.SCHEMA, generated_at: 'x', coverage: null, rows });

// 3 sauber gemappte Zeilen mit fallenden Scores (wie score.js byScore sie liefert).
const board3 = (scores) => scores.map((s, i) => wfe.mapBoardRow({ ...cleanBoard, score: s }, i));
const overview3 = (scores) => scores.map((s, i) => wfe.mapOverviewRow({ ...cleanOv, score: s }, i));
const survival3 = (rq) => rq.map((q, i) => wfe.mapSurvivalRow({ ...cleanSv, runwayQuarters: q }, i));

// --- Baseline: sauber gemappte, sauber sortierte Listen validieren clean --------------------
test('board: 3 sauber sortierte Zeilen (rank=i+1, score-desc) validieren clean', () => {
  const e = []; wfe.validateFile(mkHull(board3([90, 80, 70])), 'energy', e);
  assert.deepEqual(e, []);
});
test('overview: 3 sauber sortierte Zeilen validieren clean', () => {
  const e = []; wfe.validateFile(mkOverviewFile(overview3([90, 80, 70])), 'overview', e);
  assert.deepEqual(e, []);
});
test('survival: 3 Zeilen (kein score-Feld) validieren clean', () => {
  const e = []; wfe.validateFile(mkSurvivalFile(survival3([9999, 12, 4])), 'survival', e);
  assert.deepEqual(e, []);
});

// --- (a) rank vertauscht: Array-Reihenfolge/Scores bleiben korrekt sortiert, nur die rank- ---
// --- Werte zweier Zeilen sind getauscht. Score-Check sieht das NICHT (Scores steigen nicht). ---
test('board rank vertauscht (score bleibt korrekt sortiert) muss trippen', () => {
  const rows = board3([90, 80, 70]);
  const tmp = rows[0].rank; rows[0].rank = rows[1].rank; rows[1].rank = tmp; // 1<->2 getauscht
  const e = []; wfe.validateFile(mkHull(rows), 'energy', e);
  assert.ok(e.some((x) => /rank!=index\+1/.test(x)), 'rank-Vertauschung muss trippen: ' + JSON.stringify(e));
});
test('overview rank vertauscht muss trippen', () => {
  const rows = overview3([90, 80, 70]);
  const tmp = rows[0].rank; rows[0].rank = rows[1].rank; rows[1].rank = tmp;
  const e = []; wfe.validateFile(mkOverviewFile(rows), 'overview', e);
  assert.ok(e.some((x) => /rank!=index\+1/.test(x)), 'overview rank-Vertauschung muss trippen: ' + JSON.stringify(e));
});
test('survival rank vertauscht muss trippen', () => {
  const rows = survival3([9999, 12, 4]);
  const tmp = rows[0].rank; rows[0].rank = rows[1].rank; rows[1].rank = tmp;
  const e = []; wfe.validateFile(mkSurvivalFile(rows), 'survival', e);
  assert.ok(e.some((x) => /rank!=index\+1/.test(x)), 'survival rank-Vertauschung muss trippen: ' + JSON.stringify(e));
});

// --- (b) score nicht monoton: Zeilen bleiben in der (falschen) Reihenfolge, rank wird -------
// --- korrekt als i+1 NEU vergeben (wie ein kaputter Upstream-Sort es taete) -> rank-Check ---
// --- (a) sieht NICHTS falsches, nur der unabhaengige score-Monotonie-Check (b) trippt. -------
test('board score-Ordnung gebrochen (rank bleibt i+1-konsistent) muss trippen', () => {
  const rows = board3([70, 90, 80]); // score steigt bei i=1 -> gebrochener Sort
  const e = []; wfe.validateFile(mkHull(rows), 'energy', e);
  assert.ok(e.some((x) => /score-Ordnung gebrochen/.test(x)), 'gebrochener Score-Sort muss trippen: ' + JSON.stringify(e));
  assert.ok(!e.some((x) => /rank!=index\+1/.test(x)), 'rank selbst ist hier i+1-konsistent, darf NICHT trippen');
});
test('overview score-Ordnung gebrochen muss trippen', () => {
  const rows = overview3([70, 90, 80]);
  const e = []; wfe.validateFile(mkOverviewFile(rows), 'overview', e);
  assert.ok(e.some((x) => /score-Ordnung gebrochen/.test(x)), 'gebrochener Score-Sort (overview) muss trippen: ' + JSON.stringify(e));
});
// R2.18 Auflage: survival ist NICHT score-sortiert (runway-desc, kein .score-Feld) -> ein
// score-Check dort waere falsch-rot auf gueltigem Output. Es gibt schlicht kein .score im
// SurvivalRow-Vertrag, also kann/darf kein Check das pruefen — das ist hier die Behauptung.
test('survival-Zeilen tragen kein .score-Feld (score-Monotonie-Check ist fuer diesen kind bewusst NICHT verkabelt)', () => {
  const rows = survival3([9999, 12, 4]);
  assert.ok(!('score' in rows[0]), 'SurvivalRow darf kein score-Feld haben');
});

// --- unprofitable-Track getrennt vom profitable-Track geprueft (eigene rank/score-Sequenz) ---
test('board unprofitable-Track: eigene rank-Sequenz, Bruch dort isoliert erkannt', () => {
  const good = board3([90, 80, 70]);
  const bad = board3([50, 60, 40]); // score steigt bei i=1
  const e = []; wfe.validateFile(mkHull(good, bad), 'energy', e);
  assert.ok(e.some((x) => /energy\.unprofitable\[1\]: score-Ordnung gebrochen/.test(x)), 'Bruch muss im unprofitable-Track lokalisiert sein: ' + JSON.stringify(e));
  assert.ok(!e.some((x) => /energy\.profitable\[.*score-Ordnung/.test(x)), 'profitable-Track ist sauber, darf nicht mit-trippen');
});

// ── Bruell-Kanal, Waechter 2 (Tag 978): der Anker-Marker wandert WIRKLICH in index.json ──
// Nicht Quelltext-Grep, sondern der echte Pfad: Datei auf Platte -> loadAnchor() ->
// buildIndex() -> Feld im Ergebnis. Beide Richtungen: da/nicht da, gueltig/kaputt.
// outputs/ ist gitignored (.gitignore:50); ein evtl. vorhandener echter Marker und ein
// echter HG-Index werden gesichert und byte-gleich zurueckgelegt.
{
  const fs = require('node:fs');
  const path = require('node:path');
  const HG_INDEX = path.join(__dirname, '..', '..', 'outputs', 'hypergrowth', 'index.json');
  const sichern = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
  const zurueck = (p, buf) => { if (buf === null) { if (fs.existsSync(p)) fs.unlinkSync(p); } else fs.writeFileSync(p, buf); };
  const altAnchor = sichern(wfe.ANCHOR_FILE);
  const altIndex = sichern(HG_INDEX);
  const marker = {
    schema: 'anchor-status/v1', generated_at: '2026-08-16T02:40:00.000Z',
    status: 'rangfolge', breached: true, blocked: false,
    verletzungen: ['ALAB Rang 38/103 = 35.9% > 15% in semiconductors|profitable'],
    anker: [{ ticker: 'ALAB', pct: 35.92, max: 15, ok: false }],
  };
  try {
    fs.mkdirSync(path.dirname(HG_INDEX), { recursive: true });
    fs.writeFileSync(HG_INDEX, JSON.stringify({
      generatedFromSnapshots: 1, branches: wfe.BRANCHES, counts: {}, survivalCount: 0, excluded: {},
    }));

    test('Bruell: ohne outputs/anchor-status.json traegt index.json KEIN anchor-Feld', () => {
      zurueck(wfe.ANCHOR_FILE, null);
      assert.equal(wfe.loadAnchor(), undefined, 'loadAnchor() liefert etwas, obwohl kein Marker da ist');
      const idx = wfe.buildIndex(null, wfe.loadAnchor());
      assert.ok(!('anchor' in idx), 'index.json traegt anchor, obwohl kein Marker existiert — "gemessen, alles gut" waere gelogen');
    });

    test('Bruell: mit Marker steht status/breached/blocked/verletzungen in index.json', () => {
      fs.writeFileSync(wfe.ANCHOR_FILE, JSON.stringify(marker));
      const idx = wfe.buildIndex(null, wfe.loadAnchor());
      assert.ok(idx.anchor, 'anchor fehlt in index.json, obwohl der Marker auf Platte liegt — das Banner bliebe stumm');
      assert.equal(idx.anchor.status, 'rangfolge');
      assert.equal(idx.anchor.breached, true);
      assert.equal(idx.anchor.blocked, false);
      assert.deepEqual(idx.anchor.verletzungen, marker.verletzungen);
      assert.ok(!('anker' in idx.anchor), 'die Roh-Messreihe gehoert nicht in den Export (nur die Banner-Felder)');
      const e = []; wfe.validateFile({ ...idx, schema: wfe.SCHEMA, boardStatus: Object.fromEntries(wfe.BRANCHES.map((b) => [b, 'core'])) }, 'index', e);
      assert.deepEqual(e, [], 'der frisch gebaute Index faellt durch den eigenen --check: ' + e.join(';'));
    });

    test('Bruell: ein Marker mit fremdem Schema wird verworfen (kein halb gelesenes Feld)', () => {
      fs.writeFileSync(wfe.ANCHOR_FILE, JSON.stringify({ ...marker, schema: 'anchor-status/v2' }));
      assert.equal(wfe.loadAnchor(), undefined, 'fremdes Schema wurde trotzdem durchgereicht');
    });

    // Review 16.08.: "fehlt" und "da, aber kaputt" duerfen nicht denselben stillen Ausgang haben.
    const mitLog = (fn) => {
      const echt = console.log; const zeilen = [];
      console.log = (...a) => zeilen.push(a.join(' '));
      try { fn(); } finally { console.log = echt; }
      return zeilen.join('\n');
    };
    test('Bruell: FEHLENDER Marker ist still (lokaler Normalfall, kein Rauschen)', () => {
      zurueck(wfe.ANCHOR_FILE, null);
      const log = mitLog(() => assert.equal(wfe.loadAnchor(), undefined));
      assert.ok(!/::warning::/.test(log), 'ein fehlender Marker warnt — das waere taegliches Rauschen lokal: ' + log);
    });
    test('Bruell: VORHANDENER, kaputter Marker warnt laut (nicht stillschweigend "kein Banner")', () => {
      fs.writeFileSync(wfe.ANCHOR_FILE, '{ kein json');
      const log = mitLog(() => assert.equal(wfe.loadAnchor(), undefined));
      assert.match(log, /::warning::/,
        'ein vorhandener, unlesbarer Marker faellt still aus dem Export — dann steht "Banner aus" fuer '
        + '"alles gut", und genau diese Verwechslung ist die Bugklasse, gegen die dieser Kanal gebaut ist');
      assert.match(log, /anchor-status\.json/, 'die Warnung nennt die Datei nicht');
    });
  } finally {
    zurueck(wfe.ANCHOR_FILE, altAnchor);
    zurueck(HG_INDEX, altIndex);
  }
}

console.log(`\nfindash-export-gate.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
