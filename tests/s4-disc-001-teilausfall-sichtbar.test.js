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
const ru = require('../refresh-universe.js');

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

function stubNordicCategories(rowsByCategory, requestedCategories) {
  https.get = (url, opts, cb) => {
    const fn = typeof opts === 'function' ? opts : cb;
    const category = new URL(url).searchParams.get('category');
    requestedCategories.push(category);
    const body = JSON.stringify({ data: { instrumentListing: { rows: rowsByCategory[category] } } });
    const res = Readable.from([Buffer.from(body, 'utf8')]);
    res.statusCode = 200;
    res.headers = {};
    setImmediate(() => fn(res));
    const req = { on() { return req; }, once() { return req; }, setTimeout() { return req; }, destroy() {}, end() {} };
    return req;
  };
}

function captureConsole(fn) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const messages = { log: [], warn: [], error: [] };
  for (const level of Object.keys(original)) console[level] = (...parts) => messages[level].push(parts.join(' '));
  return Promise.resolve().then(fn).then(value => ({ value, messages }))
    .finally(() => Object.assign(console, original));
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
  const validRows = {
    MAIN_MARKET: [{ symbol: 'MAIN', fullName: 'Main Market', currency: 'SEK' }],
    FIRST_NORTH: [{ symbol: 'FIRST', fullName: 'First North', currency: 'DKK' }],
    OTHERS: [{ symbol: 'OTHER', fullName: 'Other Instrument', currency: 'EUR' }],
  };
  const expectedCategories = ['MAIN_MARKET', 'FIRST_NORTH', 'OTHERS'];

  await check('Nordic: an empty MAIN_MARKET slice marks a nonempty aggregate partial', async () => {
    const requested = [];
    stubNordicCategories({ ...validRows, MAIN_MARKET: [] }, requested);
    try {
      const { value: result, messages } = await captureConsole(
        () => require('../discovery/nordic.js').fetchNordicUniverse());
      assert.equal(result.size, 2, 'later slices must remain available');
      assert.equal(result.partial, true);
      assert.deepEqual(requested, expectedCategories, 'all categories must still be requested in order');
      assert.ok(result.has('FIRST.CO') && result.has('OTHER.HE'));
      assert.ok(messages.error.some(message => message.includes('MAIN_MARKET')),
        'the diagnostic must identify the empty core category');
      assert.ok(messages.log.some(message => message.includes('MAIN_MARKET: 0 rows')),
        'the ordinary category count must remain observable');
    } finally { https.get = echtesGet; }
  });

  await check('Nordic: an empty FIRST_NORTH slice marks the aggregate partial', async () => {
    const requested = [];
    stubNordicCategories({ ...validRows, FIRST_NORTH: [] }, requested);
    try {
      const { value: result, messages } = await captureConsole(
        () => require('../discovery/nordic.js').fetchNordicUniverse());
      assert.equal(result.size, 2);
      assert.equal(result.partial, true);
      assert.deepEqual(requested, expectedCategories);
      assert.ok(messages.error.some(message => message.includes('FIRST_NORTH')),
        'the diagnostic must identify the empty core category');
      assert.ok(messages.log.some(message => message.includes('FIRST_NORTH: 0 rows')),
        'the ordinary category count must remain observable');
    } finally { https.get = echtesGet; }
  });

  await check('Nordic: two empty core slices cannot hide behind a populated OTHERS tail', async () => {
    const requested = [];
    stubNordicCategories({ ...validRows, MAIN_MARKET: [], FIRST_NORTH: [] }, requested);
    try {
      const { value: result, messages } = await captureConsole(
        () => require('../discovery/nordic.js').fetchNordicUniverse());
      assert.deepEqual([...result.keys()], ['OTHER.HE']);
      assert.equal(result.partial, true);
      assert.deepEqual(requested, expectedCategories);
      assert.ok(messages.error.some(message => message.includes('MAIN_MARKET')));
      assert.ok(messages.error.some(message => message.includes('FIRST_NORTH')));
    } finally { https.get = echtesGet; }
  });

  await check('Nordic: an empty optional OTHERS slice remains healthy', async () => {
    const requested = [];
    stubNordicCategories({ ...validRows, OTHERS: [] }, requested);
    try {
      const { value: result, messages } = await captureConsole(
        () => require('../discovery/nordic.js').fetchNordicUniverse());
      assert.equal(result.size, 2);
      assert.ok(!result.partial, 'optional temporary instruments must not create a permanent warning');
      assert.deepEqual(requested, expectedCategories);
      assert.ok(!messages.error.some(message => message.includes('OTHERS')),
        'an empty optional tail is not an adapter error');
      assert.ok(messages.log.some(message => message.includes('OTHERS: 0 rows')),
        'the optional zero-row observation must remain visible');
    } finally { https.get = echtesGet; }
  });

  await check('die Ertragszeile markiert Teilausfaelle mit ! und laesst gesunde Quellen in Ruhe', () => {
    assert.equal(typeof ru.discoveryErtragsZeile, 'function', 'die Ertragszeile ist nicht einzeln pruefbar');
    const zeile = ru.discoveryErtragsZeile(
      ['a', 'b', 'c', 'd'], { a: 1234, b: 99, c: -1, d: 0 }, ['b']);
    assert.equal(zeile, 'a=1234 b=99! c=FAIL d=0');
  });

  await check('ohne Teilausfall sieht die Zeile exakt aus wie bisher (kein neues Rauschen)', () => {
    assert.equal(ru.discoveryErtragsZeile(['a', 'b'], { a: 5, b: -1 }, []), 'a=5 b=FAIL');
    assert.equal(ru.discoveryErtragsZeile(['a', 'b'], { a: 5, b: -1 }), 'a=5 b=FAIL',
      'die Degradiert-Liste muss weglassbar bleiben');
  });

  const SRC = fs.readFileSync(path.join(ROOT, 'refresh-universe.js'), 'utf8');

  await check('der Merge-Lauf LIEST das partial-Feld der Quelle (sonst ist der Stempel weiter tot)', () => {
    assert.match(SRC, /srcMap\.partial/,
      'refresh-universe liest partial nicht — genau der Befund');
    assert.match(SRC, /degradedSources/,
      'ohne Sammelliste kann die Zusammenfassung die betroffenen Quellen nicht nennen');
  });

  await check('die Zusammenfassung nennt Anzahl UND Namen der teil-ausgefallenen Quellen', () => {
    const i = SRC.indexOf('degradedSources.length');
    assert.ok(i > 0, 'es gibt keine eigene Meldung fuer Teilausfaelle');
    const stelle = SRC.slice(i, i + 700);
    assert.match(stelle, /degradedSources\.join/, 'die Namen fehlen — "3 Quellen degradiert" ist nicht handhabbar');
    assert.match(stelle, /Untergrenze/, 'die Meldung muss sagen, WARUM die Zahl davor nicht mehr der Bestand ist');
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
