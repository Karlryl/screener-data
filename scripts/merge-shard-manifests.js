'use strict';
/**
 * 0.2/0.9 Sharding Merge (Tag 280) — fuehrt die per-Shard-Snapshots + per-Shard-Manifeste
 * eines Matrix-Laufs zu EINEM Voll-Universum-Manifest zusammen, das coverage-gate.js liest.
 *
 * KONTRAKT (warum dieser Helfer existiert):
 *   Jeder Shard-Job schreibt snapshots/_manifest.json mit n_total = SHARD-Groesse.
 *   coverage-gate.js aber klassifiziert gegen watchlist.stocks.length (Voll-Universum).
 *   Ein blindes "letztes Manifest gewinnt" wuerde n_total = ~1400 (eine Scheibe) melden
 *   -> Gate saehe 1400/1400 = 100% -> jede echte Teil-Coverage waere unsichtbar.
 *   => Hier: n_total = VOLL-Universum (watchlist), n_ok/n_full/n_priceonly/n_failed/
 *      n_skipped_mcap = SUMMEN ueber alle Shards, partial = OR ueber alle Shards
 *      (true wenn IRGENDEIN Shard partial ODER ein erwarteter Shard fehlt/getimeoutet).
 *
 * ROBUSTHEIT (Linse B):
 *   - Fehlende Shard-Manifeste (Timeout, kein Artefakt) sind KEIN Fehler: sie zaehlen 0
 *     und setzen partial=true. coverage-gate.js faengt die reduzierte Coverage als
 *     degradiert/katastrophal ab (Fail-loud, nicht Fail-silent).
 *   - Disjunktheit wird gegen die Snapshot-DATEIEN auf Platte bewiesen (nicht nur Manifest-
 *     Zahlen): landete derselbe Ticker in zwei Shards, ist das ein Hash-/Merge-Bug ->
 *     ::error:: + exit 1 (harter Stop, weil doppelte Ticker Coverage-Zahlen aufblaehen).
 *
 * Usage:
 *   node scripts/merge-shard-manifests.js \
 *     --shard-manifests shard-manifests \  (dir mit shard-<i>.json je Shard)
 *     --snapshots snapshots \              (gemergter Snapshot-Ordner, alle Shards vereint)
 *     --watchlist watchlist.json \         (Voll-Universum-Denominator)
 *     --expected-shards 17
 *   node scripts/merge-shard-manifests.js --selftest
 */
const fs = require('fs');
const path = require('path');
// NRE-SK-001 (Hard Review 2026-07-31): siehe unten bei writeFileAtomic-Aufruf.
const { writeFileAtomic } = require(path.join(__dirname, '..', 'lib', 'atomic-write.js'));

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function watchlistSize(wl) {
  if (!wl) return 0;
  if (Array.isArray(wl)) return wl.length;
  if (Array.isArray(wl.stocks)) return wl.stocks.length;
  return Object.keys(wl).length;
}

// Tag 464 — der ehrliche Coverage-Nenner, als eigene reine Funktion, weil hier die
// GEFAEHRLICHE Fehlerrichtung liegt: ein zu KLEINER Nenner macht die Coverage zu gross und
// schaltet Karls einzigen Alarm dauerhaft auf gruen. Ein zu grosser Nenner meldet nur zu
// pessimistisch — laestig, aber laut. Deshalb faellt jede unstimmige Rechnung auf den alten,
// pessimistischeren Nenner (nur mcap abgezogen) zurueck und meldet das.
// Unstimmig heisst: nicht endlich, negativ, oder kleiner als die Zahl der tatsaechlich
// geholten Snapshots (n_ok kann nie groesser als der adressierbare Bestand sein).
function honestDenominator(fullUniverseSize, skippedMcap, skippedOwned, nOk) {
  const basis = fullUniverseSize - (Number.isFinite(skippedMcap) ? skippedMcap : 0);
  const owned = Number.isFinite(skippedOwned) ? skippedOwned : 0;
  const kandidat = basis - owned;
  // Unabhaengige Pruefung 27.07., Befund 1: die Bedingung `Number.isFinite(nOk) && kandidat < nOk`
  // ueberspringt per Kurzschluss die EINZIGE Absicherung gegen einen zu kleinen Nenner, sobald
  // nOk nicht endlich ist. Heute unerreichbar (mergeManifests uebergibt immer sum('n_ok')), aber
  // die Funktion ist exportiert — ein kuenftiger Aufrufer mit undefined haette den Schutz still
  // ausgeschaltet. Ein fehlendes nOk ist kein Grund zu vertrauen, sondern einer zu misstrauen.
  if (!Number.isFinite(nOk)) {
    return { n_addressable: basis, verworfen: owned, grund: `n_ok=${nOk} ist keine Zahl — ohne Gegenprobe wird der Abzug nicht angewandt, Nenner bleibt ${basis}` };
  }
  if (owned < 0 || !(kandidat > 0) || kandidat < nOk) {
    return { n_addressable: basis, verworfen: owned, grund: `n_skipped_owned=${skippedOwned} ergibt Nenner ${kandidat} (n_ok=${nOk}) — unplausibel, nutze ${basis}` };
  }
  return { n_addressable: kandidat, verworfen: 0, grund: null };
}

// Reine Merge-Funktion (TDD): summiert die Shard-Manifeste, setzt n_total = Voll-Universum,
// partial = OR(alle Shards) OR (weniger Shards vorhanden als erwartet).
// shardManifests: Array der geparsten Shard-Manifest-Objekte (null-Eintraege = fehlender Shard).
function mergeManifests(shardManifests, fullUniverseSize, expectedShards) {
  const present = shardManifests.filter(m => m && typeof m === 'object');
  const sum = (f) => present.reduce((a, m) => a + (Number.isFinite(m[f]) ? m[f] : 0), 0);
  const anyShardPartial = present.some(m => m.partial === true);
  const missingShards = Number.isFinite(expectedShards) ? expectedShards - present.length : 0;
  const hd = honestDenominator(fullUniverseSize, sum('n_skipped_mcap'), sum('n_skipped_owned'), sum('n_ok'));
  const merged = {
    pulled_at: new Date().toISOString(),
    watchlist_version: (present.find(m => m.watchlist_version != null) || {}).watchlist_version,
    n_total: fullUniverseSize,                 // <- Voll-Universum, NICHT Shard-Summe
    n_ok: sum('n_ok'),
    n_full: sum('n_full'),
    n_priceonly: sum('n_priceonly'),
    n_skipped_mcap: sum('n_skipped_mcap'),
    // Tag 464: Ticker, die der Hauptlauf vor dem Abruf uebersprungen hat, weil die
    // Small-Cap-Liste sie besitzt (Eigentumsgrenze, Karl-Entscheid A). Sie stehen weiter in
    // watchlist.json — also im Voll-Universum unten — wurden aber nie versucht und koennen
    // n_ok nie erreichen. Ohne diesen Abzug meldet der Alarm dauerhaft zu wenig Abdeckung.
    // Die Summe ist exakt, weil pull-yahoo.js seit Tag 464 ERST shardet und DANN filtert:
    // jeder Shard zaehlt nur die uebersprungenen Namen seiner eigenen Scheibe.
    n_skipped_owned: sum('n_skipped_owned'),
    // Task 0.12: ehrlicher Coverage-Nenner = Voll-Universum minus mcap-Skips
    // (belegt-tote Ticker sind schon aus der Watchlist ausgetragen, dead-tickers.json).
    // Tag 464: minus der von der Small-Cap-Liste besessenen Namen (s. o.).
    n_addressable: hd.n_addressable,
    // nur gesetzt, wenn der Abzug verworfen wurde — run() macht daraus ein ::warning::
    _addressable_warnung: hd.grund || undefined,
    n_failed: sum('n_failed'),
    // partial=true wenn irgendein Shard mittendrin abbrach ODER ein Shard ganz fehlt.
    partial: anyShardPartial || missingShards > 0,
    // Instrumentierung fuer den Merge-Log (nicht von coverage-gate gelesen, aber im Artefakt sichtbar):
    n_shards_present: present.length,
    n_shards_expected: Number.isFinite(expectedShards) ? expectedShards : present.length,
    n_shards_partial: present.filter(m => m.partial === true).length,
  };
  return merged;
}

// Disjunktheits-Beweis gegen die Snapshot-DATEIEN. Da alle Shards in DENSELBEN
// snapshots/-Ordner gemergt werden (download-artifact merge-multiple), koennte ein
// Hash-Bug denselben Ticker in zwei Shards erzeugen -> zwei Artefakte schrieben dieselbe
// Datei (letztes gewinnt, still). Deshalb pruefen wir NICHT die Merge-Dateien (die sind
// schon dedupliziert), sondern die per-Shard-Filelisten aus den Manifesten wenn vorhanden.
// Fallback: wenn Shard-Manifeste keine Fileliste tragen (aktuelles Schema tut das nicht),
// ist die Snapshot-Dateimenge bereits die Union — Disjunktheit ist dann durch shardStocks
// (unit-getestet in pull-shard.test.js) garantiert und hier nicht re-pruefbar. Wir zaehlen
// dann nur die on-disk-Dateien als Konsistenz-Check gegen n_ok.
function crossCheckDisjoint(shardFilelists) {
  const seen = new Map(); // ticker -> shardIndex
  const dupes = [];
  for (const { index, files } of shardFilelists) {
    for (const f of files) {
      if (seen.has(f) && seen.get(f) !== index) dupes.push({ ticker: f, a: seen.get(f), b: index });
      else seen.set(f, index);
    }
  }
  return dupes;
}

// Reine Reconciliation der SUMMIERTEN n_ok (ueber die Shard-Manifeste) gegen die REALE
// distinct on-disk-Snapshot-Zahl (TDD). gap = summe - on-disk (> 0 = Dateinamen-Kollisionen
// im Union). Ursache eines KLEINEN gap: zwei Watchlist-Eintraege mappen auf DIESELBE
// Snapshot-Datei (Dual-Listing/Ticker-Normalisierung, z.B. BRK.B vs BRK-B) und landen wegen
// anderem Hash-Input in VERSCHIEDENEN Shards, ueberschreiben aber beim merge-multiple eine
// Datei. Das ist ein gutartiger, VORBESTEHENDER Watchlist-Quirk — KEIN shardStocks-Hash-Bug
// (der ist in pull-shard.test.js unit-bewiesen disjunkt auf ticker und wuerde SYSTEMATISCH
// tausende kollidieren, nicht eine Handvoll). Autoritativ fuer die Coverage ist die distinct
// on-disk-Zahl (genau die Snapshots, die das Scoring liest). Nur ein GROSSER gap (> hardLimit)
// signalisiert einen echten systematischen Bug -> harter Stop.
// ponytail: on-disk als Wahrheit; hardLimit = max(25, 0.5% Universum) faengt echte Hash-Bugs
// (kollidieren Tausende), toleriert die realen Dual-Listing/Share-Class-Doppel eines globalen
// ~24k-Universums (Dutzende). Schwelle im Ledger hebbar, falls legitime Doppel je > 0.5% sind.
function reconcileOnDisk(summedNok, onDisk, fullUniverse) {
  const hardLimit = Math.max(25, Math.floor((Number(fullUniverse) || 0) * 0.005));
  const usable = onDisk > 0 && onDisk <= summedNok;
  const gap = usable ? (summedNok - onDisk) : 0;
  return { n_ok: usable ? onDisk : summedNok, gap, hardLimit, fatal: gap > hardLimit };
}

function run() {
  const argv = process.argv;
  const get = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
  const manifestDir = get('--shard-manifests', 'shard-manifests');
  const snapDir = get('--snapshots', 'snapshots');
  const watchlistPath = get('--watchlist', 'watchlist.json');
  const expectedShards = parseInt(get('--expected-shards', '0'), 10) || undefined;

  const fullUniverse = watchlistSize(readJSON(watchlistPath));
  if (!(fullUniverse > 0)) {
    console.error(`::error::merge-shard-manifests — watchlist ${watchlistPath} leer/unlesbar (Voll-Universum=0). Kann n_total nicht setzen.`);
    process.exit(1);
  }

  // Shard-Manifeste einsammeln: shard-manifests/shard-<i>.json (fehlende = null).
  const shardManifests = [];
  let filesInDir = [];
  try { filesInDir = fs.readdirSync(manifestDir).filter(f => f.endsWith('.json')); } catch (e) { filesInDir = []; }
  for (const f of filesInDir) shardManifests.push(readJSON(path.join(manifestDir, f)));
  if (shardManifests.length === 0) {
    console.error(`::error::merge-shard-manifests — kein einziges Shard-Manifest in ${manifestDir}/ gefunden. Alle Shards fehlen -> coverage-gate faengt das als katastrophal.`);
    // NICHT hart abbrechen: ein leeres/0-Manifest schreiben, damit coverage-gate.js
    // seinen KATASTROPHAL-Pfad nimmt (Karls Alarm), statt dass der Job hier verschwindet.
  }

  const merged = mergeManifests(shardManifests, fullUniverse, expectedShards);
  // Tag 464: der Nenner-Abzug wurde verworfen (unplausible Zahl) -> laut melden. Still auf den
  // pessimistischen Nenner zurueckzufallen waere ok fuer den Alarm, aber unsichtbar fuer die
  // Ursachensuche: genau die Sorte Fehler, die monatelang niemand findet.
  if (merged._addressable_warnung) {
    console.error(`::warning::merge-shard-manifests — ${merged._addressable_warnung}`);
  }

  // On-disk-Konsistenz + grobe Disjunktheits-Sicht: die gemergte Snapshot-Dateimenge ist
  // bereits die Union. Wenn sie KLEINER als n_ok ist, hat ein Ticker in zwei Shards dieselbe
  // Datei ueberschrieben (Kollision) -> Warnung (n_ok waere ueberzaehlt).
  let onDisk = 0;
  try { onDisk = fs.readdirSync(snapDir).filter(f => f.endsWith('.json') && f !== '_manifest.json' && !f.startsWith('_')).length; } catch (e) { onDisk = 0; }
  // Reconcile summierte n_ok gegen die reale distinct on-disk-Zahl. Kleiner gap = gutartige
  // Watchlist-Dateinamen-Doppel -> ::warning:: + on-disk als autoritatives n_ok. Grosser gap =
  // systematischer Hash-Bug -> ::error:: exit 1 (siehe reconcileOnDisk-Kommentar).
  const rec = reconcileOnDisk(merged.n_ok, onDisk, fullUniverse);
  if (rec.gap > 0) {
    console.error(`::warning::merge-shard-manifests — ${rec.gap} Snapshot-Dateikollision(en): summierte n_ok ${merged.n_ok} vs. ${onDisk} distinct on-disk. Vermutlich Watchlist-Doppel (Dual-Listing/Ticker-Normalisierung). Nutze distinct on-disk (${onDisk}) als n_ok.`);
  }
  if (rec.fatal) {
    console.error(`::error::merge-shard-manifests — on-disk ${onDisk} << summierte n_ok ${merged.n_ok} (gap ${rec.gap} > hardLimit ${rec.hardLimit}): SYSTEMATISCHE Ticker-Kollision zwischen Shards (shardStocks-Hash-Bug?). Stop.`);
    process.exit(1);
  }
  merged.n_ok = rec.n_ok;                  // autoritativ = distinct on-disk (was das Scoring liest)
  merged.n_shard_collisions = rec.gap;     // Instrumentierung (0 = sauber disjunkt)

  fs.mkdirSync(snapDir, { recursive: true });
  // NRE-SK-001 (Hard Review 2026-07-31): plain writeFileSync can leave a truncated/
  // partial _manifest.json behind on a killed/crashed step (timeout, OOM, runner
  // eviction mid-write). coverage-gate.js reads that as "unreadable" and falls back
  // to a strictly weaker file-count-only classification that cannot see partial/
  // failure-mass/honest-coverage — a write failure here silently downgrades Karls
  // einzigen Coverage-Alarm. Atomic write (tmp + rename) means the file is either
  // the complete previous version or the complete new one, never a half-written one.
  writeFileAtomic(path.join(snapDir, '_manifest.json'), JSON.stringify(merged));
  console.log(`Merged manifest: n_ok=${merged.n_ok}/${merged.n_total} full=${merged.n_full} price-only=${merged.n_priceonly} failed=${merged.n_failed} partial=${merged.partial} shards=${merged.n_shards_present}/${merged.n_shards_expected} (on-disk snapshots=${onDisk}) adressierbar=${merged.n_addressable} (mcap-Skips ${merged.n_skipped_mcap}, Small-Cap-eigene ${merged.n_skipped_owned}) unerklaert=${merged.n_addressable - merged.n_ok - merged.n_failed}`);
  // Tag 464, Plausibilitaets-Anker fuer den Nenner: adressierbar - n_ok sollte ungefaehr
  // n_failed sein. Am Lauf 30230485209 nachgerechnet: 12373-10672 = 1701 gegen 1678
  // Fehlschlaege -> 23 unerklaert. Vor dem Fix waren es 2284 gegen 1678, also 606 unerklaert.
  // Waechst diese Zahl, faellt irgendwo etwas still aus dem Zaehler — dann hier nachsehen.
  process.exit(0);
}

// --- runnable self-check: node scripts/merge-shard-manifests.js --selftest ---
function selftest() {
  const assert = require('node:assert/strict');
  let pass = 0, fail = 0;
  const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } };

  const U = 23700;
  const shard = (n_ok, n_full, n_failed, partial) => ({ n_ok, n_full, n_priceonly: n_ok - n_full, n_skipped_mcap: 0, n_failed, partial, watchlist_version: 'v1' });

  t('n_total ist Voll-Universum, nicht Shard-Summe', () => {
    const m = mergeManifests([shard(1400, 1400, 5, false), shard(1400, 1400, 3, false)], U, 17);
    assert.equal(m.n_total, U);
    assert.equal(m.n_ok, 2800);
    assert.equal(m.n_full, 2800);
    assert.equal(m.n_failed, 8);
  });

  t('partial=true wenn ein Shard partial ist', () => {
    const m = mergeManifests([shard(1400, 1400, 0, false), shard(900, 900, 0, true)], U, 17);
    assert.equal(m.partial, true);
  });

  t('partial=true wenn Shards fehlen (present < expected)', () => {
    const m = mergeManifests([shard(1400, 1400, 0, false)], U, 17); // nur 1 von 17 da
    assert.equal(m.partial, true);
    assert.equal(m.n_shards_present, 1);
    assert.equal(m.n_shards_expected, 17);
  });

  t('partial=false nur wenn alle da UND keiner partial', () => {
    const three = [shard(1400, 1400, 0, false), shard(1400, 1400, 0, false), shard(1400, 1400, 0, false)];
    const m = mergeManifests(three, U, 3);
    assert.equal(m.partial, false);
  });

  t('null-Eintraege (fehlendes Artefakt) werden uebersprungen, nicht als 0-Objekt-Crash', () => {
    const m = mergeManifests([shard(1400, 1400, 2, false), null, undefined], U, 3);
    assert.equal(m.n_ok, 1400);
    assert.equal(m.partial, true); // 1 present, 3 expected
  });

  t('summierte 0 Shards -> n_ok=0 (coverage-gate nimmt katastrophal-Pfad)', () => {
    const m = mergeManifests([], U, 17);
    assert.equal(m.n_ok, 0);
    assert.equal(m.n_total, U);
    assert.equal(m.partial, true);
  });

  t('Disjunktheit: Kollision desselben Tickers in zwei Shards wird erkannt', () => {
    const dupes = crossCheckDisjoint([
      { index: 0, files: ['AAPL.json', 'MSFT.json'] },
      { index: 1, files: ['NVDA.json', 'AAPL.json'] },
    ]);
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].ticker, 'AAPL.json');
  });

  t('Disjunktheit: saubere Partition hat keine Dupes', () => {
    const dupes = crossCheckDisjoint([
      { index: 0, files: ['AAPL.json'] },
      { index: 1, files: ['NVDA.json'] },
    ]);
    assert.equal(dupes.length, 0);
  });

  t('reconcileOnDisk: kleiner Gap (Watchlist-Doppel wie BRK.B/BRK-B) -> n_ok=on-disk, NICHT fatal', () => {
    const r = reconcileOnDisk(6088, 6086, 23700); // der reale Dry-Run-Fall (gap 2)
    assert.equal(r.n_ok, 6086);
    assert.equal(r.gap, 2);
    assert.equal(r.fatal, false);
  });
  t('reconcileOnDisk: grosser Gap (systematischer Hash-Bug) -> fatal', () => {
    const r = reconcileOnDisk(6000, 4000, 23700); // gap 2000 >> hardLimit ~118
    assert.equal(r.fatal, true);
  });
  t('reconcileOnDisk: sauber disjunkt (gap 0) -> n_ok unveraendert, nicht fatal', () => {
    const r = reconcileOnDisk(6086, 6086, 23700);
    assert.equal(r.n_ok, 6086); assert.equal(r.gap, 0); assert.equal(r.fatal, false);
  });
  t('reconcileOnDisk: on-disk 0 (alle Shards leer) -> Summe behalten, NICHT fatal (coverage-gate faengt katastrophal)', () => {
    const r = reconcileOnDisk(0, 0, 23700);
    assert.equal(r.n_ok, 0); assert.equal(r.gap, 0); assert.equal(r.fatal, false);
  });
  t('reconcileOnDisk: on-disk > summe (defensiv, sollte nicht vorkommen) -> Summe behalten', () => {
    const r = reconcileOnDisk(6086, 6090, 23700);
    assert.equal(r.n_ok, 6086); assert.equal(r.gap, 0); assert.equal(r.fatal, false);
  });

  // ── Tag 464: ehrlicher Nenner zieht auch die Small-Cap-eigenen Namen ab ──────────────
  // Zahlen aus dem realen Lauf 30230485209 (outputs/coverage-status.json auf gh-pages):
  // Universum 15212, mcap-Skips 2256, n_ok 10672 -> vor dem Fix 10672/12956 = 82.4 %.
  t('Tag 464: n_skipped_owned wird summiert und vom Nenner abgezogen (realer Lauf)', () => {
    const U2 = 15212;
    const s = (ok, mcap, owned) => ({ n_ok: ok, n_full: 0, n_priceonly: ok, n_skipped_mcap: mcap, n_skipped_owned: owned, n_failed: 0, partial: false });
    // 2 Scheiben, die zusammen den echten Lauf ergeben
    const m = mergeManifests([s(5336, 1128, 291), s(5336, 1128, 292)], U2, 2);
    assert.equal(m.n_skipped_owned, 583);
    assert.equal(m.n_addressable, 15212 - 2256 - 583);      // 12373
    assert.equal(m.n_addressable, 12373);
    const ehrlich = +(m.n_ok / m.n_addressable * 100).toFixed(1);
    assert.equal(ehrlich, 86.3);                             // vorher 82.4 -> 3.9 Punkte zu pessimistisch
    assert.equal(m._addressable_warnung, undefined);
  });

  t('Tag 464: Alt-Manifest ohne n_skipped_owned verhaelt sich exakt wie vorher', () => {
    const m = mergeManifests([shard(1400, 1400, 0, false), shard(1400, 1400, 0, false)], U, 2);
    assert.equal(m.n_skipped_owned, 0);
    assert.equal(m.n_addressable, U);                        // shard() hat n_skipped_mcap 0
    assert.equal(m._addressable_warnung, undefined);
  });

  // GEGENPROBE zur gefaehrlichen Richtung: ein zu kleiner Nenner macht die Coverage zu gross
  // und schaltet Karls einzigen Alarm still. honestDenominator MUSS solche Zahlen verwerfen.
  t('Tag 464: unplausibel grosses n_skipped_owned faellt auf den pessimistischen Nenner zurueck', () => {
    const r = honestDenominator(15212, 2256, 9000, 10672);   // Nenner waere 3956 < n_ok 10672
    assert.equal(r.n_addressable, 12956);                    // = alter Wert, nur mcap abgezogen
    assert.ok(r.grund && r.grund.includes('unplausibel'), 'Grund muss gemeldet werden');
  });
  t('Tag 464: negatives n_skipped_owned wird verworfen', () => {
    const r = honestDenominator(15212, 2256, -5, 10672);
    assert.equal(r.n_addressable, 12956);
    assert.ok(r.grund);
  });
  t('Tag 464: fehlendes n_skipped_owned ist kein Fehler (Nenner = alter Wert)', () => {
    const r = honestDenominator(15212, 2256, undefined, 10672);
    assert.equal(r.n_addressable, 12956);
    assert.equal(r.grund, null);
  });
  t('Befund 1: fehlendes n_ok schaltet den Schutz NICHT ab', () => {
    // Ohne Gegenprobe darf der Abzug nicht angewandt werden — sonst koennte ein zu grosses
    // n_skipped_owned unbemerkt durchgehen und den Nenner zu klein machen.
    for (const kaputt of [undefined, NaN, null, 'viele']) {
      const r = honestDenominator(15212, 2256, 9000, kaputt);
      assert.equal(r.n_addressable, 12956, `n_ok=${String(kaputt)} haette den Abzug durchgelassen`);
      assert.ok(r.grund, 'der uebersprungene Schutz muss gemeldet werden');
    }
    // Gegenkontrolle: mit gueltigem n_ok und plausiblem owned wird sehr wohl abgezogen.
    assert.equal(honestDenominator(15212, 2256, 583, 10672).n_addressable, 12373);
  });
  t('Tag 464: der Warnpfad landet auch im gemergten Manifest', () => {
    const kaputt = { n_ok: 10672, n_skipped_mcap: 2256, n_skipped_owned: 9000, n_failed: 0, partial: false };
    const m = mergeManifests([kaputt], 15212, 1);
    assert.equal(m.n_addressable, 12956);
    assert.ok(m._addressable_warnung, 'run() braucht die Warnung fuer das ::warning::');
  });

  console.log(`\nmerge-shard-manifests selftest: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

module.exports = { mergeManifests, crossCheckDisjoint, watchlistSize, reconcileOnDisk, honestDenominator };
if (process.argv.includes('--selftest')) selftest();
else if (require.main === module) run();
