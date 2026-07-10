#!/usr/bin/env node
// F-CI-016 (Tag 285): Snapshot-PULL-Freshness-Gate — gemeinsame Implementierung
// fuer den per-Shard-Warnstep UND das harte merged Gate in daily-pull.yml
// (vorher: zwei divergierende Inline-node-Kopien).
//
// ROOT CAUSE (falsch-rot 10.07.2026, Run 29073312057): die Inline-Checks
// matchten /"(?:asOf|fetchedAt)"/ — erster Treffer gewinnt. In der
// Snapshot-Serialisierung steht meta.fetchedAt (pull-yahoo.js ~1013, wird NUR
// vom Voll-Pull geschrieben — bewusst, es ist die "last full pull"-Uhr der
// 0.9-Pull-Diaet) VOR meta.asOf (~1022, wird von Voll-Pull UND
// _priceOnlyUpdate ~1823 taeglich neu gestempelt). Das Gate las also immer
// fetchedAt und mass FUNDAMENTALS-Frische statt PULL-Frische. Bei warmem
// Cache (~80-95% price-only) → fast alles "stale" → falsch-rot, Boards
// frieren ein. Beleg Shard 0 am 10.07.: 331 price-only-Pulls, aber nur
// 20/350 "fresh".
//
// FIX: asOf (die Pull-Uhr) bevorzugt lesen; fetchedAt NUR als Fallback fuer
// Alt-Snapshots vor Tag 215j, die nie ein asOf bekamen. Schutz-Absicht bleibt:
// ein Lauf, dessen Pull wirklich versagt, stempelt nichts → asOf altert →
// <50% frisch → exit 1, Deploy blockt.
//
// CLI: node scripts/verify-freshness.js <snapshotDir> <label>
//   exit 1 wenn Dateien vorhanden und <50% frisch (<36h). Der per-Shard-Step
//   bleibt via continue-on-error:true eine Warnung; das merged Gate ist hart.
const fs = require('fs');
const path = require('path');

const FRESH_MS = 36 * 3600 * 1000;
// quote-anchored: matcht "asOf", NICHT "fundamentalsAsOf"
const ASOF_RE = /"asOf"\s*:\s*"([^"]+)"/;
const FETCHED_RE = /"fetchedAt"\s*:\s*"([^"]+)"/;

function checkFreshness(dir, now = Date.now()) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  } catch (_) { /* fehlendes Verzeichnis = 0 Dateien, ok bleibt true */ }
  let fresh = 0, stale = 0, unparseable = 0;
  for (const f of files) {
    try {
      // 1024 statt 800 (Konvention wie sortByStaleness' Header-Read): asOf
      // folgt ~50 Bytes hinter fetchedAt; ein zu kurzes Fenster wuerde per
      // Fallback konservativ auf fetchedAt zurueckfallen (nie falsch-gruen).
      const buf = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 1024);
      const m = buf.match(ASOF_RE) || buf.match(FETCHED_RE);
      if (!m) { unparseable++; continue; }
      const ts = new Date(m[1]).getTime();
      if (Number.isFinite(ts) && now - ts < FRESH_MS) fresh++; else stale++;
    } catch (_) { unparseable++; }
  }
  const total = files.length;
  return { total, fresh, stale, unparseable, ok: total === 0 || fresh / total >= 0.5 };
}

module.exports = { checkFreshness, FRESH_MS };

if (require.main === module) {
  const dir = process.argv[2] || './snapshots';
  const label = process.argv[3] || 'snapshots';
  const r = checkFreshness(dir);
  const pct = r.total > 0 ? (r.fresh / r.total * 100).toFixed(1) : '0';
  console.log(label + ' freshness: ' + r.fresh + ' fresh / ' + r.stale + ' stale / '
    + r.unparseable + ' unparseable of ' + r.total + ' (' + pct + '% fresh)');
  if (!r.ok) {
    console.error('::error::F-CI-016 — fewer than 50% of ' + label + ' snapshots are fresh (<36h pull clock asOf). Pull likely failed; refusing to publish stale data.');
    process.exit(1);
  }
}
