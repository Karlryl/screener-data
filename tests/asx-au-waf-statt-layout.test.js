#!/usr/bin/env node
/**
 * ASX-AU — "wir wurden abgewiesen" darf nicht wie "Layout geaendert" aussehen.
 * =============================================================================
 * Befund (03.08.2026): der alte Endpunkt
 * https://www.asx.com.au/asx/research/ASXListedCompanies.csv ist abgeschaltet.
 * Die Imperva-WAF davor antwortet der Adapter-UA nicht mit 404, sondern mit
 * HTTP **200 und 378 Byte HTML** ("Request Rejected"). Der Adapter reichte das
 * an seinen CSV-Parser weiter, fand dort keine Kopfzeile und meldete
 * "header row not found (layout changed?)" — eine Diagnose, die in die voellig
 * falsche Richtung zeigt: es war nie das Layout, wir kamen nie an die Datei.
 *
 * Geprueft wird darum beides, am ECHTEN Aufrufpfad (fetchAsxUniverse mit
 * abgeklemmtem https.get, kein Netz):
 *   (a) das NEUE markitdigital-Layout wird gelesen (Kopfzeile in Zeile 0,
 *       "ASX code" zuerst, 5 Spalten) und liefert genau die gueltigen Codes
 *   (b) der Adapter fragt nicht mehr den toten asx.com.au-Pfad
 *   (c) 200 + text/html bricht MIT WAF-Wortlaut ab, statt Layout zu behaupten
 *   (d) Vertrag bleibt: fail-silent (leere Map), marketCap wird nie gesetzt
 *   (e) 200 ganz ohne Content-Type-Header meldet "(fehlt)", nicht den leeren Typ
 *   (f) 302 mit Location wird verfolgt und das Ziel liefert die Daten
 *   (g) 302 ohne Location bricht ab, statt "undefined" abzurufen
 *   (h) Umleitungsschleife endet bei MAX_REDIRECTS=5 (genau 6 Abrufe)
 *   (i) eine falsch breite Datenzeile markiert den erhaltenen Teilbestand
 *
 * Hermetisch: kein Netz, keine Dateien. Laeuft im pre-pull-Gate (tests/*test.js);
 * tests/discovery/asx-au.test.js bleibt der Live-Check und ist gate-exempt.
 */
'use strict';
const assert = require('assert');
const https = require('https');
const { Readable } = require('stream');
const { fetchAsxUniverse } = require('../discovery/asx-au');

// ── Fixtures ────────────────────────────────────────────────────────────────
// Neues Layout, live abgenommen 03.08.2026: KEINE Bannerzeile mehr, Kopfzeile
// in Zeile 0, Code zuerst, "GICs" mit kleinem s, alle Felder doppelt gequotet.
// "Market Cap" ist live bei 1 von 1840 Zeilen befuellt -> hier bewusst leer.
const CSV_NEU = [
  '"ASX code","Company name","GICs industry group","Listing date","Market Cap"',
  '"BHP","BHP GROUP LIMITED","Materials","1885-08-13",""',
  '"CBA","COMMONWEALTH BANK OF AUSTRALIA","Banks","1991-09-12",""',
  '"CSL","CSL LIMITED","Pharmaceuticals, Biotechnology & Life Sciences","1994-06-03",""',
  '"A2M","THE A2 MILK COMPANY LIMITED","Food, Beverage & Tobacco","2015-03-31",""',
  '"BHPPA","BHP GROUP LIMITED SECOND LINE","Materials","2022-01-31",""',
  '',
].join('\r\n');

// Reordered header with the code last: the middle record is one field short,
// while both surrounding records remain structurally complete.
const CSV_WRONG_WIDTH = [
  '"Company name","GICs industry group","Listing date","Market Cap","ASX code"',
  '"BHP GROUP LIMITED","Materials","1885-08-13","","BHP"',
  '"BROKEN COMPANY","Software & Services","2020-01-01",""',
  '"COMMONWEALTH BANK OF AUSTRALIA","Banks","1991-09-12","","CBA"',
  '',
].join('\r\n');

// Imperva-"Request Rejected", nachgebaut — nicht der Byte-Mitschnitt: die Live-Seite
// war 378 Byte, dieser Nachbau 247. Auf die Groesse kommt es nicht an, der Guard nennt
// ohnehin die WIRKLICH gelesene; genau darauf prueft der Wortlaut-Waechter unten.
const WAF_HTML = '<html><head><title>Request Rejected</title></head><body>'
  + 'The requested URL was rejected. Please consult with your administrator.<br><br>'
  + 'Your support ID is: 18446744073709551615<br><br>'
  + '<a href=\'javascript:history.back();\'>[Go Back]</a></body></html>';

// ── https.get abklemmen ─────────────────────────────────────────────────────
const echtesGet = https.get;
const angefragt = [];

// Antwort haengt an der angefragten URL: nur so laesst sich eine Umleitungskette
// nachbauen (Original -> Location -> Datei). Der Handler bekommt die URL und
// liefert {koerper, headers, statusCode}.
function netzAntwortetJe(handler) {
  https.get = (url, opts, cb) => {
    const u = String(url);
    angefragt.push(u);
    const fn = typeof opts === 'function' ? opts : cb;
    const a = handler(u);
    const res = Readable.from([Buffer.from(a.koerper || '', 'utf8')]);
    res.statusCode = a.statusCode === undefined ? 200 : a.statusCode;
    res.headers = a.headers;
    setImmediate(() => fn(res));
    const req = { on() { return req; }, once() { return req; }, setTimeout() { return req; }, destroy() {}, end() {} };
    return req;
  };
}

function netzAntwortetMit(koerper, headers, statusCode = 200) {
  netzAntwortetJe(() => ({ koerper, headers, statusCode }));
}

// Der Adapter ist fail-silent: der Grund landet ausschliesslich auf console.error.
// Genau dort haengt der Wortlaut-Waechter.
function mitschnitt(fn) {
  const echt = { log: console.log, error: console.error };
  const zeilen = [];
  console.log = () => {};
  console.error = (...a) => zeilen.push(a.join(' '));
  return Promise.resolve().then(fn).finally(() => Object.assign(console, echt)).then(m => ({ map: m, zeilen }));
}

let fails = 0;
async function check(name, fn) {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { fails++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

(async () => {
  // ── (a) + (b) Das neue Layout wird gelesen, vom neuen Endpunkt ────────────
  await check('neues markitdigital-Layout: genau die gueltigen 3-Zeichen-Codes kommen an', async () => {
    angefragt.length = 0;
    netzAntwortetMit(CSV_NEU, { 'content-type': 'text/csv' });
    try {
      const { map } = await mitschnitt(() => fetchAsxUniverse());
      assert.deepStrictEqual([...map.keys()].sort(), ['A2M.AX', 'BHP.AX', 'CBA.AX', 'CSL.AX'],
        'Kopfzeile in Zeile 0 / Code-Spalte zuerst muss gelesen werden, BHPPA (Zweitlinie) muss fliegen');
      assert.strictEqual(map.partial, undefined,
        'ein vollstaendiger Abruf darf nicht als Teilbestand markiert werden');
      assert.strictEqual(map.get('CSL.AX').name, 'CSL LIMITED',
        'Namensspalte falsch zugeordnet — die Komma-in-Anfuehrungszeichen-Zeile ist der Stresstest');
      for (const [k, info] of map) {
        assert.strictEqual(info.exchange, 'ASX', 'exchange muss ASX sein: ' + k);
        assert.strictEqual(info.country, 'Australia', 'country muss Australia sein: ' + k);
        assert.strictEqual(info.source, 'asx', 'source muss asx sein: ' + k);
        assert.ok(!('marketCap' in info),
          'marketCap kommt vertragsgemaess von Yahoo — die neue Market-Cap-Spalte ist zu 1/1840 befuellt: ' + k);
      }
    } finally { https.get = echtesGet; }
  });

  await check('der tote asx.com.au-Registerpfad wird nicht mehr abgefragt', () => {
    assert.strictEqual(angefragt.length, 1, 'genau ein Abruf erwartet, sah: ' + angefragt.length);
    const u = new URL(angefragt[0]);
    assert.strictEqual(u.hostname, 'asx.api.markitdigital.com',
      'der alte Host liefert 404 bzw. die WAF-Seite — Abruf ging an: ' + angefragt[0]);
    assert.ok(u.pathname.includes('/companies/directory/file'),
      'Directory-Pfad erwartet, sah: ' + u.pathname);
  });

  await check('falsch breite Datenzeile markiert den erhaltenen Teilbestand', async () => {
    netzAntwortetMit(CSV_WRONG_WIDTH, { 'content-type': 'text/csv' });
    try {
      const { map } = await mitschnitt(() => fetchAsxUniverse());
      assert.deepStrictEqual([...map.keys()], ['BHP.AX', 'CBA.AX'],
        'gueltige Geschwister muessen die kaputte Mittelzeile ueberleben');
      assert.strictEqual(map.partial, true,
        'eine verlorene Registerzeile darf neben einem nichtleeren Teilbestand nicht gesund aussehen');
    } finally { https.get = echtesGet; }
  });

  // ── (c) Der Kern: 200 + text/html ist eine Abweisung, kein Layoutwechsel ──
  await check('HTTP 200 mit text/html bricht mit WAF-Wortlaut ab (nicht "layout changed")', async () => {
    netzAntwortetMit(WAF_HTML, { 'content-type': 'text/html; charset=utf-8' });
    try {
      const { map, zeilen } = await mitschnitt(() => fetchAsxUniverse());
      const text = zeilen.join('\n');
      assert.strictEqual(map.size, 0, 'fail-silent-Vertrag: bei Abweisung eine leere Map');
      assert.ok(!/layout changed/i.test(text),
        'genau der Befund: die WAF-Seite wurde als Layoutwechsel gemeldet und schickte die Diagnose in die Irre.\n'
        + '       Gemeldet wurde: ' + JSON.stringify(text));
      const erwartet = 'HTTP 200 aber Content-Type text/html (WAF-/Fehlerseite, '
        + Buffer.byteLength(WAF_HTML) + ' Bytes)';
      assert.ok(text.includes(erwartet),
        'Wortlaut-Waechter: erwartet "' + erwartet + '"\n       gemeldet: ' + JSON.stringify(text));
    } finally { https.get = echtesGet; }
  });

  await check('GEGENPROBE: text/plain gilt weiter als brauchbar (kein Fehlalarm bei schlampigem Header)', async () => {
    netzAntwortetMit(CSV_NEU, { 'content-type': 'text/plain; charset=utf-8' });
    try {
      const { map } = await mitschnitt(() => fetchAsxUniverse());
      assert.strictEqual(map.size, 4, 'text/plain darf den Guard nicht ausloesen, sah: ' + map.size + ' Zeilen');
    } finally { https.get = echtesGet; }
  });

  // ── (e) 200 ganz OHNE Content-Type: der '(fehlt)'-Zweig des Guards ────────
  // Eine WAF/ein Proxy muss den Header nicht setzen. Ohne den Fallback stuende
  // im Log "Content-Type  (WAF-/..." — eine Meldung, die die Ursache verschweigt.
  await check('HTTP 200 ganz ohne Content-Type meldet "(fehlt)", nicht den leeren Typ', async () => {
    angefragt.length = 0;
    netzAntwortetMit(WAF_HTML, {});
    try {
      const { map, zeilen } = await mitschnitt(() => fetchAsxUniverse());
      const text = zeilen.join('\n');
      assert.strictEqual(map.size, 0, 'fail-silent-Vertrag: ohne Content-Type keine Daten');
      assert.ok(!/layout changed/i.test(text),
        'auch der kopflose Fall darf nicht als Layoutwechsel gemeldet werden: ' + JSON.stringify(text));
      const erwartet = 'HTTP 200 aber Content-Type (fehlt) (WAF-/Fehlerseite, '
        + Buffer.byteLength(WAF_HTML) + ' Bytes)';
      assert.ok(text.includes(erwartet),
        'Wortlaut-Waechter: erwartet "' + erwartet + '"\n       gemeldet: ' + JSON.stringify(text));
    } finally { https.get = echtesGet; }
  });

  // ── (f)-(h) Umleitungen: folgen, aber nur mit Ziel und nur begrenzt ───────
  const UMLEITUNGSZIEL = 'https://asx.api.markitdigital.com/asx-research/1.0/companies/directory/file-v2.csv';

  await check('302 mit Location wird verfolgt, das Ziel liefert die Daten', async () => {
    angefragt.length = 0;
    netzAntwortetJe(u => (u === UMLEITUNGSZIEL
      ? { koerper: CSV_NEU, headers: { 'content-type': 'text/csv' } }
      : { koerper: '', headers: { location: UMLEITUNGSZIEL }, statusCode: 302 }));
    try {
      const { map } = await mitschnitt(() => fetchAsxUniverse());
      assert.deepStrictEqual([...map.keys()].sort(), ['A2M.AX', 'BHP.AX', 'CBA.AX', 'CSL.AX'],
        'nach der Umleitung muessen dieselben Codes ankommen');
      assert.strictEqual(angefragt.length, 2,
        'Original + Ziel = 2 Abrufe erwartet, sah: ' + JSON.stringify(angefragt));
      assert.strictEqual(angefragt[1], UMLEITUNGSZIEL,
        'der zweite Abruf muss die Location sein, ging an: ' + angefragt[1]);
    } finally { https.get = echtesGet; }
  });

  await check('302 ohne Location bricht sauber ab, statt "undefined" abzurufen', async () => {
    angefragt.length = 0;
    netzAntwortetMit('', {}, 302);
    try {
      const { map, zeilen } = await mitschnitt(() => fetchAsxUniverse());
      const text = zeilen.join('\n');
      assert.strictEqual(map.size, 0, 'fail-silent-Vertrag: ohne Location keine Daten');
      assert.ok(/without Location header/.test(text),
        'Wortlaut-Waechter: "HTTP 302 without Location header" erwartet, gemeldet: ' + JSON.stringify(text));
      assert.strictEqual(angefragt.length, 1,
        'kein Folgeabruf erlaubt — schon gar nicht auf "undefined", sah: ' + JSON.stringify(angefragt));
    } finally { https.get = echtesGet; }
  });

  await check('Umleitungsschleife endet nach MAX_REDIRECTS=5, also genau 6 Abrufen', async () => {
    angefragt.length = 0;
    let sprung = 0;
    netzAntwortetJe(() => ({ koerper: '', statusCode: 302,
      headers: { location: UMLEITUNGSZIEL + '?hop=' + (++sprung) } }));
    try {
      const { map, zeilen } = await mitschnitt(() => fetchAsxUniverse());
      const text = zeilen.join('\n');
      assert.strictEqual(map.size, 0, 'fail-silent-Vertrag: eine Schleife liefert keine Daten');
      assert.ok(/too many redirects/.test(text),
        'Wortlaut-Waechter: "too many redirects" erwartet, gemeldet: ' + JSON.stringify(text));
      assert.strictEqual(angefragt.length, 6,
        '1 Original + MAX_REDIRECTS=5 = 6 Abrufe erwartet, sah: ' + angefragt.length);
    } finally { https.get = echtesGet; }
  });

  console.log('\nGeprueft: 9 Pruefungen / 8 Adapterlaeufe (https abgeklemmt) — '
    + 'neues markitdigital-Layout, Zeilenbreite, Endpunkt-Host, WAF-Abweisung (200+text/html), text/plain-Gegenprobe, '
    + 'fehlender Content-Type und die drei Umleitungsfaelle (verfolgt / ohne Location / Schleife).');
  console.log('asx-au-waf-statt-layout: ' + (9 - fails) + ' ok, ' + fails + ' fail');
  process.exit(fails ? 1 : 0);
})();
