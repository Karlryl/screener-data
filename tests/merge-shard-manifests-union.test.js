'use strict';

// Integrations-Waechter fuer die STRENGE UNION aus Tag 1131 (H15, Quarantaene kaputter
// Zaehler) und Tag 1130 (H14, fail-closed auf partial !== false). Beide Haertungen wurden
// unabhaengig voneinander ab demselben Parent geschrieben und editieren dieselben Zeilen;
// beim Zusammenfuehren koennte eine der beiden still verschwinden, ohne dass die beiden
// Herkunfts-Suiten das merken (jede prueft nur ihre eigene Ausloeser-Lage).
//
// Darum prueft diese Datei die Unabhaengigkeit AM OBJEKT: jeder Waechter muss feuern,
// waehrend der Ausloeser des anderen nachweislich ABWESEND ist. Faellt eine der beiden
// Haertungen aus der Union heraus, wird genau ein Block hier rot.

const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeManifests } = require('../scripts/merge-shard-manifests.js');

// Gueltiger Shard: Zaehler schema-rein (n_full + n_priceonly === n_ok) und partial
// explizit false — also fuer BEIDE Waechter unauffaellig.
function sauberer(overrides = {}) {
  return {
    n_ok: 2,
    n_full: 1,
    n_priceonly: 1,
    n_failed: 0,
    n_skipped_mcap: 0,
    n_skipped_owned: 0,
    n_ccy_missing_completely: 0,
    partial: false,
    watchlist_version: 'union-test',
    ...overrides,
  };
}

test('H15 feuert ohne H14: kaputte Zaehler werden quarantiniert, obwohl partial === false ist', () => {
  // n_full + n_priceonly (1 + 1) widerspricht n_ok (99) -> Schema-Bruch.
  // partial ist EXPLIZIT false, H14s Ausloeser (partial !== false) ist damit abwesend.
  const kaputt = sauberer({ n_ok: 99, partial: false });
  const merged = mergeManifests([kaputt], 100, 1);

  // H14 haette hier nichts zu melden — belegt, dass der Befund allein von H15 kommt.
  assert.equal(merged.n_shards_partial, 0, 'H14 darf bei explizitem partial:false nicht ausloesen');

  // H15 muss trotzdem greifen: Shard beobachtet, aber nicht summiert.
  assert.equal(merged.n_shards_invalid, 1, 'H15 muss den schema-kaputten Shard quarantinieren');
  assert.equal(merged.n_shards_valid, 0, 'quarantinierter Shard zaehlt nicht als gueltig');
  assert.equal(merged.n_shards_present, 1, 'der Shard war vorhanden, nur unbrauchbar');
  assert.equal(merged.n_ok, 0, 'Zaehler eines quarantinierten Shards duerfen nie in die Summe');
  assert.equal(merged.partial, true, 'Quarantaene muss das Manifest degradieren');
});

test('H14 feuert ohne H15: fehlendes/kaputtes partial degradiert, obwohl die Zaehler gueltig sind', () => {
  // Jede dieser Lagen ist schema-REIN (H15s Ausloeser abwesend), traegt aber kein
  // beweisbares partial:false — der Erzeuger hat Sauberkeit nie zugesichert.
  const lagen = [
    ['partial fehlt ganz', (() => { const m = sauberer(); delete m.partial; return m; })()],
    ['partial ist null', sauberer({ partial: null })],
    ['partial ist der String "false"', sauberer({ partial: 'false' })],
    ['partial ist 0', sauberer({ partial: 0 })],
  ];

  for (const [lage, shard] of lagen) {
    const merged = mergeManifests([shard], 100, 1);

    // H15 haette hier nichts zu melden — belegt, dass der Befund allein von H14 kommt.
    assert.equal(merged.n_shards_invalid, 0, `${lage}: H15 darf bei gueltigen Zaehlern nicht ausloesen`);
    assert.equal(merged.n_shards_valid, 1, `${lage}: der Shard ist schema-rein und wird summiert`);
    assert.equal(merged.n_ok, 2, `${lage}: gueltige Zaehler bleiben in der Summe`);

    // H14 muss trotzdem greifen.
    assert.equal(merged.n_shards_partial, 1, `${lage}: H14 muss den Shard als unvollstaendig zaehlen`);
    assert.equal(merged.partial, true, `${lage}: ohne bewiesenes partial:false faellt das Manifest zu`);
  }
});

test('die Union laesst den beidseitig sauberen Shard in Ruhe', () => {
  // Gegenprobe: ohne sie koennte ein pauschales partial=true beide Bloecke oben gruen
  // faerben, ohne dass ein Waechter wirklich unterscheidet.
  const merged = mergeManifests([sauberer()], 100, 1);
  assert.equal(merged.partial, false, 'sauberer Shard darf nicht degradiert werden');
  assert.equal(merged.n_shards_invalid, 0);
  assert.equal(merged.n_shards_partial, 0);
  assert.equal(merged.n_ok, 2);
});
