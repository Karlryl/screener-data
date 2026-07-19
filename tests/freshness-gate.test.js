// Tag 285 — F-CI-016 misst PULL-Frische, nicht Fundamentals-Frische.
// Pinnt den Pull-Diaet-Konflikt vom 10.07.2026 (Run 29073312057): ein
// price-only-gestempelter Snapshot (asOf frisch, fetchedAt alt) MUSS als
// frisch zaehlen; ein Lauf, dessen Pull wirklich versagt hat (nichts
// gestempelt), MUSS rot bleiben.
// No framework: assert, process.exit(fail?1:0). Run: node tests/freshness-gate.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkFreshness } = require('../scripts/verify-freshness.js');

const NOW = Date.now();
const H = 3600 * 1000;
const iso = (agoMs) => new Date(NOW - agoMs).toISOString();

// Realistische Feld-REIHENFOLGE wie pull-yahoo.js sie serialisiert:
// meta.fetchedAt VOR meta.asOf (genau die Reihenfolge, die den alten
// first-match-Regex auf die falsche Uhr gelenkt hat).
function writeSnap(dir, name, { fetchedAt, asOf, fundamentalsAsOf }) {
  const meta = { ticker: name.replace('.json', '') };
  if (fetchedAt !== undefined) meta.fetchedAt = fetchedAt;
  if (asOf !== undefined) meta.asOf = asOf;
  if (fundamentalsAsOf !== undefined) meta.fundamentalsAsOf = fundamentalsAsOf;
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ identifier: { primary: 'ISIN', value: 'X' }, meta }));
}

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + e.message); }
}

// Fall 1 (der falsch-rote 10.07.-Fall): price-only-gestempelt — fetchedAt
// 10 Tage alt (letzter Voll-Pull), asOf 1h alt (_priceOnlyUpdate heute).
check('price-only-gestempelter Snapshot zaehlt als frisch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  writeSnap(dir, 'PONLY.json', { fetchedAt: iso(240 * H), asOf: iso(1 * H) });
  const r = checkFreshness(dir, NOW);
  assert.deepStrictEqual({ fresh: r.fresh, stale: r.stale, ok: r.ok }, { fresh: 1, stale: 0, ok: true });
});

// Fall 2 (Schutz-Absicht): Pull komplett versagt — nichts gestempelt,
// beide Uhren alt -> stale -> Gate rot.
check('komplett ungestempelter Lauf bleibt rot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  writeSnap(dir, 'DEAD1.json', { fetchedAt: iso(240 * H), asOf: iso(240 * H) });
  writeSnap(dir, 'DEAD2.json', { fetchedAt: iso(48 * H), asOf: iso(48 * H) });
  const r = checkFreshness(dir, NOW);
  assert.deepStrictEqual({ fresh: r.fresh, stale: r.stale, ok: r.ok }, { fresh: 0, stale: 2, ok: false });
});

// Fall 3: Alt-Snapshot vor Tag 215j (nur fetchedAt, kein asOf) — Fallback
// greift, der Check verhungert nicht am Bestand.
check('Alt-Snapshot ohne asOf faellt auf fetchedAt zurueck', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  writeSnap(dir, 'OLD.json', { fetchedAt: iso(1 * H) });
  const r = checkFreshness(dir, NOW);
  assert.deepStrictEqual({ fresh: r.fresh, unparseable: r.unparseable, ok: r.ok }, { fresh: 1, unparseable: 0, ok: true });
});

// Fall 4: "fundamentalsAsOf" darf NICHT als asOf gelesen werden
// (quote-anchor im Regex) — frische Fundamentals-Uhr rettet einen alten Pull nicht.
check('fundamentalsAsOf wird nicht als Pull-Uhr missgelesen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  writeSnap(dir, 'FUND.json', { fetchedAt: iso(240 * H), asOf: iso(240 * H), fundamentalsAsOf: iso(1 * H) });
  const r = checkFreshness(dir, NOW);
  assert.strictEqual(r.stale, 1);
});

// Fall 5: 50%-Schwelle — genau die Haelfte frisch -> ok (>= 0.5), knapp darunter -> rot.
check('50%-Schwelle', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  writeSnap(dir, 'A.json', { fetchedAt: iso(240 * H), asOf: iso(1 * H) });
  writeSnap(dir, 'B.json', { fetchedAt: iso(240 * H), asOf: iso(240 * H) });
  assert.strictEqual(checkFreshness(dir, NOW).ok, true);
  writeSnap(dir, 'C.json', { fetchedAt: iso(240 * H), asOf: iso(240 * H) });
  assert.strictEqual(checkFreshness(dir, NOW).ok, false);
});

// Fall 6 (BH-127): leeres/fehlendes Verzeichnis -> NICHT ok. Ein total===0
// (leergefegter Snapshot-Ordner unter einem stale Manifest, oder ein Pull,
// der komplett nichts geschrieben hat) ist der Totalausfall, den dieses Gate
// faengen soll — kein Div-durch-0/Crash, aber auch kein stiller Pass mehr.
check('leeres Verzeichnis ist NICHT ok (Totalausfall)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  assert.strictEqual(checkFreshness(dir, NOW).ok, false);
  assert.strictEqual(checkFreshness(path.join(dir, 'gibtsnicht'), NOW).ok, false);
});

// Fall 7 (BH-133): Zukunftsstempel (Clock-Skew/korrupt) darf nicht als frisch zaehlen.
check('Zukunftsstempel zaehlt als stale, nicht frisch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  writeSnap(dir, 'FUTURE.json', { fetchedAt: iso(240 * H), asOf: iso(-365 * 24 * H) });
  const r = checkFreshness(dir, NOW);
  assert.deepStrictEqual({ fresh: r.fresh, stale: r.stale, ok: r.ok }, { fresh: 0, stale: 1, ok: false });
});

// Fall 8 (BH-132): ein Windows-reserved-Ticker-Snapshot (_CON.json) ist ein
// ECHTER Snapshot, kein Metadaten-File — darf nicht pauschal per "_"-Praefix
// aus der Frische-Zaehlung fallen.
check('_CON.json (Windows-reserved Ticker) zaehlt mit, nicht als Metadatei geskippt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  writeSnap(dir, '_CON.json', { fetchedAt: iso(240 * H), asOf: iso(1 * H) });
  const r = checkFreshness(dir, NOW);
  assert.deepStrictEqual({ total: r.total, fresh: r.fresh, ok: r.ok }, { total: 1, fresh: 1, ok: true });
});

console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
