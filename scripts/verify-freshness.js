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
// BH-132: skip only real metadata files (writer/reader share this predicate),
// not every "_"-prefixed name — safeSnapshotFilename prefixes Windows-reserved
// tickers (CON -> _CON.json) and those are real snapshots, not metadata.
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');

const FRESH_MS = 36 * 3600 * 1000;
// quote-anchored: matcht "asOf", NICHT "fundamentalsAsOf"
const ASOF_RE = /"asOf"\s*:\s*"([^"]+)"/;
const FETCHED_RE = /"fetchedAt"\s*:\s*"([^"]+)"/;

function checkFreshness(dir, now = Date.now()) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f));
  } catch (_) { /* Verzeichnis existiert nicht: 0 Dateien, faellt unten in den total===0-Fall */ }
  let fresh = 0, stale = 0, unparseable = 0;
  for (const f of files) {
    try {
      // 1024 statt 800 (Konvention wie sortByStaleness' Header-Read): asOf
      // folgt ~50 Bytes hinter fetchedAt; ein zu kurzes Fenster wuerde per
      // Fallback konservativ auf fetchedAt zurueckfallen (nie falsch-gruen).
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      // A fresh timestamp in the header cannot make a truncated/corrupt
      // snapshot usable. Validate the whole document before classifying it.
      JSON.parse(raw);
      const buf = raw.slice(0, 1024);
      const m = buf.match(ASOF_RE) || buf.match(FETCHED_RE);
      if (!m) { unparseable++; continue; }
      const ts = new Date(m[1]).getTime();
      // BH-133: ein Zukunftsstempel (Clock-Skew/korrupt) ergibt ein negatives
      // Alter, das die reine "< FRESH_MS"-Pruefung als frisch durchwinkt. Nur
      // ein Alter in [0, FRESH_MS) zaehlt als frisch.
      const age = now - ts;
      if (Number.isFinite(ts) && age >= 0 && age < FRESH_MS) fresh++; else stale++;
    } catch (_) { unparseable++; }
  }
  const total = files.length;
  // BH-127: total===0 frueher pauschal "ok" (auch fuer einen leergefegten
  // Snapshot-Ordner unter einem stale Manifest) — genau der Totalausfall, den
  // dieses Gate faengen soll. snapshots/ existiert im Checkout immer
  // (_manifest.json ist getrackt), "0 Dateien" heisst hier also praktisch nie
  // "Verzeichnis fehlt", sondern "Pull hat nichts geschrieben".
  return { total, fresh, stale, unparseable, ok: total > 0 && fresh / total >= 0.5 };
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
