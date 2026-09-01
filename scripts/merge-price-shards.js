'use strict';
/**
 * Preis-Shard-Merge (18.08.2026) — fuehrt die Tages-Ausschnitte der parallelen
 * Preis-Runner zu EINEM prices/<datum>.json zusammen und beweist, dass der
 * Kurs-Store danach vollstaendig ist.
 *
 * WARUM ES DIESEN HELFER GIBT
 *   Der Kursabruf lief bis heute auf EINEM Runner ueber ~20.900 Ticker, bei
 *   Nebenlaeufigkeit 8 und 1500 ms Stapelpause. Das sind allein an Schlafzeit
 *   ~65 min gegen ein 25-min-Timeout — der Schritt lief JEDEN Tag in sein
 *   Timeout, und `continue-on-error: true` hat es still geschluckt.
 *   Haertester Beleg: prices/<datum>.json wird erst NACH der Abrufschleife
 *   geschrieben und ist deshalb NIE in git angekommen (`git ls-files prices/`
 *   zeigt ausschliesslich history/). Auch das 75-%-Fehlerquoten-Gate am
 *   Skriptende hat nie gelaufen. Gemessen hatte gut die Haelfte der Ticker
 *   veraltete Kurse; das Universum rotierte in 3-4 Tagen durch.
 *   Seit heute teilt `pull-historical-prices.js --shard i/N` das Universum auf
 *   mehrere Runner auf (mehrere IPs, jede unter Yahoos Cloudflare-Drossel, die
 *   pro IP ab ~20 gleichzeitigen Anfragen greift). Jeder Runner schreibt seinen
 *   eigenen Tages-Ausschnitt; hier werden sie wieder eins.
 *
 * KONTRAKT
 *   - Die Ausschnitte sind DISJUNKT (Partition entlang store.shardOf % N).
 *     Ein Ticker in zwei Ausschnitten ist ein Partitions-Bug und bricht hart ab
 *     (exit 1) — stilles Zusammenfuehren wuerde einen Kurs beliebig ueberschreiben.
 *   - Ein FEHLENDER Ausschnitt ist ebenfalls hart: er bedeutet, dass ein Runner
 *     in sein Timeout gelaufen oder abgestuerzt ist. Genau der Fall, der bisher
 *     still blieb. Lieber ein rotes X als ein Drittel fehlender Kurse, das wie
 *     ein vollstaendiger Tag aussieht.
 *   - Der Store (prices/history/history-NN.json) wird auf Parsebarkeit geprueft
 *     und _meta.json ueber den GESAMTEN Store neu gestempelt: jeder Runner
 *     stempelt beim Schreiben nur seine eigene Sicht, der letzte gewinnt — ohne
 *     Neustempeln stuende dort die Tickerzahl eines einzelnen Runners.
 *
 * Usage:
 *   node scripts/merge-price-shards.js --prices prices --date 2026-08-18 --expected-shards 4
 *   node scripts/merge-price-shards.js --selftest
 */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const priceStore = require('../lib/price-history-store.js');

function log(stufe, text) { console.log(`[merge-price-shards] ${stufe}: ${text}`); }

// A larger value is an operational misconfiguration: even an empty input would
// allocate/probe one path per claimed runner before it can fail. 4096 stays far
// above the documented 4/17-shard uses while bounding that failure path.
const MAX_EXPECTED_SHARDS = 4096;

function parseExpectedShards(argv) {
  const indices = argv
    .map((argument, index) => (argument === '--expected-shards' ? index : -1))
    .filter(index => index >= 0);
  if (indices.length === 0) return undefined;
  if (indices.length > 1) {
    throw new Error('--expected-shards must not be repeated');
  }
  const raw = argv[indices[0] + 1];
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    throw new Error('--expected-shards must be a positive integer');
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('--expected-shards must be a safe positive integer');
  }
  if (parsed > MAX_EXPECTED_SHARDS) {
    throw new Error(`--expected-shards must be a positive integer at most ${MAX_EXPECTED_SHARDS}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    prices: './prices',
    date: process.env.RUN_DATE_UTC || null,
    expected: parseExpectedShards(argv) ?? 4,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--prices' && argv[i + 1]) args.prices = argv[++i];
    else if (argv[i] === '--date' && argv[i + 1]) args.date = argv[++i];
    else if (argv[i] === '--expected-shards') i++;
  }
  return args;
}

/**
 * Fuehrt die Ausschnitte zusammen. Reine Funktion ueber {shardIdx: objekt} —
 * damit der Selbsttest sie ohne Dateisystem fahren kann.
 * @returns {{merged: object, kollisionen: string[]}}
 */
function mergeAusschnitte(ausschnitte) {
  const merged = {};
  const herkunft = {};        // ticker -> shard, nur fuer die Kollisionsmeldung
  const kollisionen = [];
  for (const [idx, obj] of Object.entries(ausschnitte)) {
    for (const [ticker, wert] of Object.entries(obj)) {
      if (Object.hasOwn(merged, ticker)) {
        kollisionen.push(`${ticker} (Shard ${herkunft[ticker]} und ${idx})`);
        continue;                       // ersten Wert behalten, nicht still ueberschreiben
      }
      merged[ticker] = wert;
      herkunft[ticker] = idx;
    }
  }
  return { merged, kollisionen };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (e) {
    console.error(`::error::merge-price-shards - ${e.message}`);
    process.exit(1);
  }
  if (!args.date) {
    log('FEHLER', 'Kein --date und kein RUN_DATE_UTC — ohne Datum ist der Zieldateiname geraten.');
    process.exit(1);
  }

  // --- 1. Ausschnitte einsammeln --------------------------------------------
  const ausschnitte = {};
  const fehlend = [];
  for (let i = 0; i < args.expected; i++) {
    const p = path.join(args.prices, `${args.date}.shard-${i}.json`);
    if (!fs.existsSync(p)) { fehlend.push(i); continue; }
    try {
      ausschnitte[i] = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      log('FEHLER', `Shard ${i} unlesbar (${e.message}) — das ist ein abgebrochener Schreibvorgang, kein leerer Tag.`);
      process.exit(1);
    }
  }
  if (fehlend.length) {
    console.log(`::error::Preis-Ausschnitt fehlt fuer Shard(s) ${fehlend.join(', ')} — der Runner ist in sein Timeout gelaufen oder abgestuerzt. Ohne ihn fehlen die Kurse eines Viertels des Universums; der Tag wuerde trotzdem vollstaendig aussehen.`);
    process.exit(1);
  }

  // --- 2. Zusammenfuehren, Kollisionen sind hart -----------------------------
  const { merged, kollisionen } = mergeAusschnitte(ausschnitte);
  if (kollisionen.length) {
    console.log(`::error::${kollisionen.length} Ticker in MEHREREN Preis-Shards — die Partition ist kaputt: ${kollisionen.slice(0, 10).join(', ')}${kollisionen.length > 10 ? ' …' : ''}`);
    process.exit(1);
  }

  const ziel = path.join(args.prices, `${args.date}.json`);
  // T204: atomar - die Tagesdatei des Kurs-Stores ist Publikationsstand.
  writeFileAtomic(ziel, JSON.stringify(merged, null, 2));
  log('INFO', `${Object.keys(merged).length} Ticker aus ${args.expected} Ausschnitten -> ${ziel}`);

  // --- 3. Store pruefen + _meta ueber den GESAMTEN Store stempeln ------------
  // loadAll wirft bei fehlenden/kaputten Shards (F-CGPT-008) — genau das wollen wir hier.
  let gesamt;
  try {
    gesamt = priceStore.loadAll(args.prices);
  } catch (e) {
    console.log(`::error::Kurs-Store nach dem Merge nicht vollstaendig ladbar: ${e.message}`);
    process.exit(1);
  }
  const tickerImStore = Object.keys(gesamt).length;
  // T204: atomar - _meta stempelt den GESAMTEN Store; halb geschrieben behauptet es
  // eine Ticker-Zahl, die zum Store nicht passt.
  writeFileAtomic(priceStore.metaPath(args.prices), JSON.stringify({
    schema: 'price-history-store/1',
    updatedAt: new Date().toISOString(),
    tickerCount: tickerImStore,
    shardsWritten: priceStore.SHARD_COUNT,
  }));
  log('INFO', `Store vollstaendig: ${tickerImStore} Ticker, _meta ueber den Gesamtstand gestempelt.`);

  // --- 4. Ausschnitte aufraeumen --------------------------------------------
  // Sie sind reine Zwischenstufen und wuerden sonst als Tages-Muell mitcommittet.
  for (let i = 0; i < args.expected; i++) {
    const p = path.join(args.prices, `${args.date}.shard-${i}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

// --- runnable self-check: node scripts/merge-price-shards.js --selftest ------
function selftest() {
  const assert = require('assert');
  let pass = 0, fail = 0;
  const pruefe = (name, fn) => {
    try { fn(); pass++; console.log(`  ok   ${name}`); }
    catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
  };

  pruefe('disjunkte Ausschnitte werden vollstaendig vereint', () => {
    const { merged, kollisionen } = mergeAusschnitte({
      0: { AAA: { close: 1 }, BBB: { close: 2 } },
      1: { CCC: { close: 3 } },
    });
    assert.equal(kollisionen.length, 0);
    assert.deepEqual(Object.keys(merged).sort(), ['AAA', 'BBB', 'CCC']);
  });

  pruefe('derselbe Ticker in zwei Ausschnitten wird als Kollision gemeldet, nicht still ueberschrieben', () => {
    const { merged, kollisionen } = mergeAusschnitte({
      0: { AAA: { close: 1 } },
      1: { AAA: { close: 999 } },
    });
    assert.equal(kollisionen.length, 1, 'Kollision nicht erkannt');
    assert.equal(merged.AAA.close, 1, 'der erste Wert muss stehenbleiben, nicht der letzte');
  });

  pruefe('leerer Ausschnitt kippt den Merge nicht (ein Runner ohne Treffer ist kein Partitionsfehler)', () => {
    const { merged, kollisionen } = mergeAusschnitte({ 0: { AAA: { close: 1 } }, 1: {} });
    assert.equal(kollisionen.length, 0);
    assert.equal(Object.keys(merged).length, 1);
  });

  // Bruchprobe der Bruchprobe: der Kollisions-Waechter MUSS bei gueltiger Eingabe schweigen.
  pruefe('gueltige Form geht durch (Waechter feuert nicht grundlos)', () => {
    const { kollisionen } = mergeAusschnitte({ 0: { A: 1 }, 1: { B: 2 }, 2: { C: 3 }, 3: { D: 4 } });
    assert.equal(kollisionen.length, 0);
  });

  console.log(`\nmerge-price-shards selftest: ${pass} ok, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

module.exports = { MAX_EXPECTED_SHARDS, mergeAusschnitte, parseArgs, parseExpectedShards };

if (process.argv.includes('--selftest')) selftest();
else if (require.main === module) main();
