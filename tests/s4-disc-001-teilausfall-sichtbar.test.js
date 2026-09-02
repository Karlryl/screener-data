'use strict';
/**
 * S4-DISC-001 (Block 5, Verifikation 2026-08-03) — Teil-Ausfaelle der Entdeckungs-
 * Quellen waren nirgends sichtbar.
 *
 * BEFUND, zwei Haelften:
 *  (a) Fuenf Adapter stempeln seit jeher `partial` auf die zurueckgegebene Map.
 *      refresh-universe.js las das Feld NIRGENDS — die Zusammenfassung zeigte nur
 *      `.size`. Eine Quelle, die die Haelfte ihrer Scheiben verloren hatte, war von
 *      einer gesunden nicht zu unterscheiden.
 *  (b) Drei Adapter mit MEHREREN Scheiben (Nordic: 3 Kategorien, LSE: 2 Maerkte,
 *      Wikipedia: 3 Indizes) faengt eine ausgefallene Scheibe still ab und macht
 *      weiter — sie stempelten `partial` gar nicht erst. Der Schritt laeuft unter
 *      continue-on-error, das console.error verpufft also.
 *
 * NICHT Gegenstand: eine Rot-Schwelle. Ab welchem Anteil ein Teilausfall den Lauf
 * kippen soll, ist eine Schwellen-Frage und gehoert vor den Rat, nicht in diesen Bau.
 *
 * Die drei Adapter werden hier WIRKLICH ausgefuehrt — mit abgeklemmtem https.get,
 * damit die Ausfall-Zweige laufen, ohne dass ein Test ins Netz geht. Ein reiner
 * Quelltext-Anker wuerde nur die Schreibweise festnageln, nicht die Wirkung.
 *
 * Standalone-Runner, kein Netz: node tests/s4-disc-001-teilausfall-sichtbar.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { Readable } = require('node:stream');

const ROOT = path.join(__dirname, '..');
const { discoveryErtragsZeile, recordDiscoveryCompleteness,
  discoveryVollstaendigkeitsHinweis, logDiscoveryCompleteness } =
  require('../refresh-universe.js');

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const echtesGet = https.get;

/** Jeder Abruf scheitert sofort — treibt die Ausfall-Zweige der Adapter. */
function netzAbklemmen() {
  https.get = () => {
    const h = {};
    const req = {
      on(ev, cb) { h[ev] = cb; return req; },
      once(ev, cb) { h[ev] = cb; return req; },
      setTimeout() { return req; },
      destroy() {}, end() {},
    };
    setImmediate(() => h.error && h.error(new Error('Netz im Test abgeklemmt')));
    return req;
  };
}

/** Jeder Abruf liefert denselben gueltigen Koerper — die Gegenrichtung. */
function netzAntwortetMit(koerper) {
  https.get = (url, opts, cb) => {
    const fn = typeof opts === 'function' ? opts : cb;
    const res = Readable.from([Buffer.from(koerper, 'utf8')]);
    res.statusCode = 200;
    res.headers = {};
    setImmediate(() => fn(res));
    const req = { on() { return req; }, once() { return req; }, setTimeout() { return req; }, destroy() {}, end() {} };
    return req;
  };
}

function stumm(fn) {
  const echt = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(echt)) console[k] = () => {};
  return Promise.resolve().then(fn).finally(() => Object.assign(console, echt));
}

(async () => {
  // ── (b) Die drei Mehr-Scheiben-Adapter stempeln ihren Teilausfall ─────────
  const mehrScheiben = [
    ['nordic', '../discovery/nordic.js', 'fetchNordicUniverse'],
    ['lse-uk', '../discovery/lse-uk.js', 'fetchLseUniverse'],
    ['wikipedia-indices', '../discovery/wikipedia-indices.js', 'fetchWikipediaIndices'],
  ];
  for (const [label, modul, fnName] of mehrScheiben) {
    await check(label + ': eine ausgefallene Scheibe stempelt partial auf die Ergebnis-Map', async () => {
      netzAbklemmen();
      try {
        const m = await stumm(() => require(modul)[fnName]());
        assert.ok(m instanceof Map, 'der Adapter muss weiterhin eine Map liefern (fail-silent-Vertrag)');
        assert.equal(m.partial, true,
          'ohne diesen Stempel ist ein Teilausfall von einem gesunden Lauf nicht zu unterscheiden');
      } finally { https.get = echtesGet; }
    });
  }

  await check('GEGENPROBE nordic: laeuft ALLES durch, bleibt partial ungesetzt', async () => {
    netzAntwortetMit(JSON.stringify({
      data: { instrumentListing: { rows: [{ symbol: 'VOLV B', fullName: 'Volvo AB ser. B', currency: 'SEK' }] } },
    }));
    try {
      const m = await stumm(() => require('../discovery/nordic.js').fetchNordicUniverse());
      assert.ok(m.size > 0, 'die Gegenprobe muss wirklich Zeilen liefern, sonst prueft sie nichts');
      assert.ok(!m.partial, 'ein vollstaendiger Lauf darf NICHT als Teilausfall gelten (sonst Dauer-Alarm)');
    } finally { https.get = echtesGet; }
  });

  // ── (a) refresh-universe macht den Stempel sichtbar ───────────────────────
  await check('die Ertragszeile markiert Teilausfaelle mit ! und laesst gesunde Quellen in Ruhe', () => {
    assert.equal(typeof discoveryErtragsZeile, 'function', 'die Ertragszeile ist nicht einzeln pruefbar');
    const zeile = discoveryErtragsZeile(
      ['a', 'b', 'c', 'd'], { a: 1234, b: 99, c: -1, d: 0 }, ['b']);
    assert.equal(zeile, 'a=1234 b=99! c=FAIL d=0');
  });

  await check('ohne Teilausfall sieht die Zeile exakt aus wie bisher (kein neues Rauschen)', () => {
    assert.equal(discoveryErtragsZeile(['a', 'b'], { a: 5, b: -1 }, []), 'a=5 b=FAIL');
    assert.equal(discoveryErtragsZeile(['a', 'b'], { a: 5, b: -1 }), 'a=5 b=FAIL',
      'die Degradiert-Liste muss weglassbar bleiben');
  });

  const SRC = fs.readFileSync(path.join(ROOT, 'refresh-universe.js'), 'utf8');

  await check('der Merge-Lauf LIEST das partial-Feld der Quelle (sonst ist der Stempel weiter tot)', () => {
    assert.equal(typeof recordDiscoveryCompleteness, 'function');
    const degraded = [];
    const details = [];
    assert.equal(recordDiscoveryCompleteness(degraded, details, 'healthy', new Map()), false);
    const truthyOnly = new Map();
    truthyOnly.partial = 'yes';
    assert.equal(recordDiscoveryCompleteness(degraded, details, 'truthy-only', truthyOnly), false,
      'nur der boolesche Adapter-Stempel gilt');
    const invalid = new Map();
    invalid.partial = true;
    invalid.partialReason = 'invalid-total-count';
    assert.equal(recordDiscoveryCompleteness(degraded, details, 'sse-invalid', invalid), true);
    const legacy = new Map();
    legacy.partial = true;
    assert.equal(recordDiscoveryCompleteness(degraded, details, 'legacy', legacy), true);
    assert.deepEqual(degraded, ['sse-invalid', 'legacy']);
    assert.deepEqual(details, [
      { source: 'sse-invalid', reason: 'invalid-total-count' },
      { source: 'legacy', reason: null }
    ]);
    assert.match(SRC, /recordDiscoveryCompleteness\(\s*degradedSources,\s*degradedSourceDetails,\s*srcName,\s*srcMap\)/,
      'der getestete Erfasser muss den echten Merge-Pfad speisen');
  });

  await check('die Zusammenfassung trennt belegte Untergrenzen von offener Richtung', () => {
    assert.equal(typeof discoveryVollstaendigkeitsHinweis, 'function',
      'der Vollstaendigkeitsbefund ist nicht einzeln pruefbar');
    const belegt = discoveryVollstaendigkeitsHinweis([
      { source: 'sse-range', reason: 'range-truncated' }
    ], 13);
    assert.match(belegt, /1 von 13/);
    assert.match(belegt, /sse-range \(range-truncated\)/);
    assert.match(belegt, /Untergrenze/);

    const offen = discoveryVollstaendigkeitsHinweis([
      { source: 'legacy-no-reason', reason: null },
      { source: 'sse-invalid', reason: 'invalid-total-count' },
      { source: 'sse-smaller', reason: 'total-count-smaller-than-data' }
    ], 13);
    assert.match(offen, /3 von 13/);
    assert.match(offen, /Vollstaendigkeit nicht belegt/);
    assert.match(offen, /Richtung offen/);
    assert.match(offen, /legacy-no-reason/);
    assert.match(offen, /sse-invalid \(invalid-total-count\)/);
    assert.match(offen, /sse-smaller \(total-count-smaller-than-data\)/);
    assert.doesNotMatch(offen, /Untergrenze|fehlt im Universum/,
      'ungueltige oder widerspruechliche Zaehler beweisen keine fehlenden Zeilen');

    const gemischt = discoveryVollstaendigkeitsHinweis([
      { source: 'sse-range', reason: 'range-truncated' },
      { source: 'otc-unknown', reason: null }
    ], 13);
    assert.equal(gemischt,
      '  Discovery-Vollstaendigkeit nicht belegt: 2 von 13 Quellen sind im Ertrag mit ! markiert. ' +
      'Belegt unvollstaendig; die Zahl vor ! ist eine Untergrenze: sse-range (range-truncated). ' +
      'Zaehler-Metadaten unverifizierbar; Richtung offen: otc-unknown. ' +
      'Die Zahl vor ! ist geliefert, aber kein bestaetigter Vollbestand.');
    assert.equal(discoveryVollstaendigkeitsHinweis([], 13), '');

    const lines = [];
    assert.equal(logDiscoveryCompleteness([], 13, (line) => lines.push(line)), false);
    assert.deepEqual(lines, [], 'gesunde Laeufe bleiben ohne Zusatzrauschen');
    assert.equal(logDiscoveryCompleteness([
      { source: 'sse-range', reason: 'range-truncated' },
      { source: 'otc-unknown', reason: null }
    ], 13, (line) => lines.push(line)), true);
    assert.deepEqual(lines, [gemischt], 'der vollstaendige Befund muss den Logger erreichen');

    assert.match(SRC, /logDiscoveryCompleteness\(\s*degradedSourceDetails,\s*DISCOVERY_SOURCE_NAMES\.length,\s*console\.log\)/,
      'der getestete Ausgabepfad muss den echten Merge-Pfad speisen');
  });

  await check('KEINE Rot-Schwelle mitgebaut: das Gate haengt weiter nur an leeren Quellen und Kandidaten', () => {
    const g = SRC.slice(SRC.indexOf('MIN_NONEMPTY_SOURCES ='), SRC.indexOf('MIN_NONEMPTY_SOURCES =') + 1200);
    assert.ok(!/degradedSources/.test(g.slice(0, g.indexOf('process.exit(1)'))),
      'ein Teilausfall darf (noch) nicht rot machen — die Schwelle ist Rat-pflichtig');
  });

  console.log('\nGeprueft: discovery/{nordic,lse-uk,wikipedia-indices}.js wirklich ausgefuehrt '
    + '(3 Ausfall-Laeufe + 1 Erfolgs-Gegenprobe, https abgeklemmt) sowie refresh-universe.js '
    + '(discoveryErtragsZeile an 4 Faellen + Einbau von partial/degradedSources + Nicht-Aenderung des Gates).');
  console.log('s4-disc-001: ' + pass + ' ok, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
