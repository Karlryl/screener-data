'use strict';
/** tests/refresh-universe.test.js — Standalone-Runner (node tests/refresh-universe.test.js, Exit 0/1).
 * Pinnt FIX 1 (Karl-Audit univ-cap, 2026-07-18): Dead-Registry-Austrag muss VOR dem
 * MAX_UNIVERSE-Cap laufen, sonst kann ein toter Ticker einen Cap-Slot belegen und das
 * Universum endet unter dem Cap, obwohl lebende Kandidaten verfuegbar waeren. */
const assert = require('node:assert/strict');
const ru = require('../refresh-universe.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

test('FIX 1 univ-cap: toter Ticker verdraengt keinen lebenden Cap-Slot (Dead-Austrag VOR dem Cap)', () => {
  // DEAD hat die hoechste marketCap und wuerde bei ungepatchter Reihenfolge (Cap zuerst)
  // einen der beiden Cap-Slots belegen, obwohl er tot registriert ist -> erst danach
  // geloescht -> Universum endet mit nur 1 statt 2 lebenden Tickern (unter dem Cap).
  const allTickers = new Map([
    ['DEAD',  { ticker: 'DEAD',  marketCap: 500e9, source: 'test' }],
    ['LIVE1', { ticker: 'LIVE1', marketCap: 400e9, source: 'test' }],
    ['LIVE2', { ticker: 'LIVE2', marketCap: 300e9, source: 'test' }],
  ]);
  const deadRegistry = { DEAD: { class: 'delisted' } };
  ru.applyDeadRegistryAndCap(allTickers, deadRegistry, 2); // Cap=2, 2 lebende Kandidaten verfuegbar

  assert.ok(!allTickers.has('DEAD'), 'toter Ticker darf nie im finalen Universum landen');
  assert.ok(allTickers.has('LIVE1'), 'LIVE1 darf nicht durch den toten Ticker verdraengt werden');
  assert.ok(allTickers.has('LIVE2'), 'LIVE2 darf nicht durch den toten Ticker verdraengt werden');
  assert.equal(allTickers.size, 2, 'Universum muss den vollen Cap ausschoepfen (beide Lebenden), nicht darunter enden');
});

// ── Tag 510: Doppelausfall-Waechter der beiden Yahoo-Entdeckungskanaele ──────────
// WARUM ES DEN GIBT: BH-100 (Predefined-Kanal) begruendete seinen Nicht-Abbruch mit
// "redundant coverage (EXCHANGE_CODES ...)", BH-038 (Exchange-Kanal) begruendete seinen
// mit "see BH-100 above". Jede Begruendung nannte die andere als Auffangnetz. Am
// 2026-07-30 (Lauf 30516194703) lieferten BEIDE 0 — Predefined 0/325 Buckets, Exchange
// fatal am v3.14-Schema (bekannt seit Tag 248, 05.07.). Keiner der beiden Kanaele kann
// das fuer sich sehen, weil jeder nur sich selbst prueft.
//
// Die vier Faelle sind so gewaehlt, dass JEDE Bedingung EINZELN rot wird, wenn man sie
// ausbaut (die Falle aus dem Persistenz-Waechter: dort verletzten beide Testfaelle beide
// Bedingungen gleichzeitig, also blieb alles gruen, wenn man eine entfernte):
//   - "predefined leer + Exchange still 0" faellt, wenn der customAdded===0-Zweig weg ist
//   - "predefined leer + Exchange liefert"  faellt, wenn die Exchange-Bedingung ganz weg ist
//   - "predefined liefert + Exchange fatal" faellt, wenn die predefined-Bedingung weg ist
// GEGENPROBE durchgefuehrt: jede der drei Bedingungen einzeln entfernt -> jeweils genau
// der zugehoerige Fall rot, die anderen gruen.

test('Tag 510: beide Kanaele leer (Exchange FATAL) -> Waechter feuert', () => {
  assert.equal(ru.beideYahooKanaeleLeer(0, true, 0), true);
});

test('Tag 510: beide Kanaele leer (Exchange STILL 0, kein Fehler) -> Waechter feuert', () => {
  // Der stille Fall: kein Schema-Fehler, aber auch kein einziger neuer Ticker.
  // Wer nur auf exchangeScreenerFatal prueft, uebersieht genau das.
  assert.equal(ru.beideYahooKanaeleLeer(0, false, 0), true);
});

test('Tag 510: predefined leer, Exchange LIEFERT -> Waechter schweigt', () => {
  // Ein Einzelausfall ist durch MIN_DISCOVERY_CANDIDATES gedeckt und keine Doppellage.
  assert.equal(ru.beideYahooKanaeleLeer(0, false, 500), false);
});

test('Tag 510: predefined LIEFERT, Exchange fatal -> Waechter schweigt', () => {
  assert.equal(ru.beideYahooKanaeleLeer(12, true, 0), false);
});

test('Tag 510: beide gesund -> Waechter schweigt', () => {
  assert.equal(ru.beideYahooKanaeleLeer(12, false, 500), false);
});

// ── F-11 (Karl-Entscheid 2026-08-04): Discovery-Untergrenze $1 Mrd -> $800 Mio ──
// WARUM ES DEN GIBT: pull-yahoo.js laeuft in daily-pull.yml seit 2026-06 mit
// MIN_MCAP_USD=800000000, die beiden Yahoo-Entdeckungskanaele in refresh-universe.js
// schnitten aber bei $1 Mrd ab. Das Band $800M-$1B war damit fuer diese Kanaele tot:
// der Pull haette solche Firmen akzeptiert, die Entdeckung schlug sie nie vor.
// Karl hat GENAU diese Luecke geschlossen — und den $500-Mrd-Deckel ausdruecklich NICHT
// angefasst. Der Test nagelt beides fest: die neue Untergrenze UND den unveraenderten
// Deckel. Waere nur der Boden geprueft, koennte ein spaeterer "Aufraeum"-Commit den
// Deckel mitnehmen, ohne dass etwas rot wird.
test('F-11: $850M passiert die Discovery-Schwelle (das vorher tote Band)', () => {
  assert.equal(ru.inDiscoveryMcapBand(850e6), true);
});

test('F-11: $799M passiert NICHT (neue Untergrenze $800M haelt nach unten dicht)', () => {
  assert.equal(ru.inDiscoveryMcapBand(799e6), false);
  assert.equal(ru.inDiscoveryMcapBand(800e6), true, 'die Grenze selbst gehoert ins Band');
});

test('F-11: $501 Mrd passiert weiterhin NICHT (Deckel unveraendert)', () => {
  assert.equal(ru.inDiscoveryMcapBand(501e9), false);
  assert.equal(ru.inDiscoveryMcapBand(500e9), true, 'der Deckel selbst gehoert ins Band');
});

test('F-11: unbrauchbare Werte fallen wie vorher raus (null/0/NaN/negativ)', () => {
  // Der alte Gate war `!mcap || mcap < 1e9 || mcap > 500e9`. `!mcap` fing null/0/NaN.
  // Das muss die Extraktion in eine Funktion mitnehmen, sonst laesst der neue Boden
  // plötzlich null-mcap-Zeilen durch, die vorher sauber ausgefiltert wurden.
  for (const v of [null, undefined, 0, NaN, Infinity, -1e9, '850000000']) {
    assert.equal(ru.inDiscoveryMcapBand(v), false, `${String(v)} darf nie ins Band`);
  }
});

test('F-11: BEIDE Yahoo-Kanaele gehen durch die Schwellen-Funktion (Verdrahtung)', () => {
  // Verhaltens-Beleg allein reicht hier nicht: die exportierte Funktion koennte korrekt
  // sein, waehrend die beiden Ingest-Schleifen weiter ihr eigenes `mcap < 1e9` fahren —
  // dann waere der Waechter gruen und die Luecke offen. Diese Stellen sind ohne Netz
  // nicht erreichbar, also am OBJEKT pruefen: Anwesenheit des Aufrufs an beiden Gates
  // UND Abwesenheit jedes nackten Zahlen-Bodens in den Ingest-Schleifen.
  // ACHTUNG (T562-M2): diese beiden Zusicherungen zaehlen DATEIWEIT und reichen NICHT —
  // ein zweiter Boden NEBEN dem Gate laesst sie gruen. Der tragende Check steht unten
  // unter "T562-M2"; diese hier bleiben als grobe Zusatzsicherung stehen.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'refresh-universe.js'), 'utf8');
  const aufrufe = (src.match(/if \(!inDiscoveryMcapBand\(mcap\)\) continue;/g) || []).length;
  assert.equal(aufrufe, 2, 'Predefined-Bucket- UND Custom-Exchange-Schleife muessen den Gate rufen');
  assert.ok(!/mcap\s*<\s*(1e9|1000000000|MIN_MCAP_CUSTOM)/.test(src),
    'kein Ingest-Gate darf am Zahlen-/Alt-Boden vorbei vergleichen');
});

// ── T562-M2 (Hard-Review Tag 562): der Verdrahtungs-Waechter zaehlte DATEIWEIT ──────
// BEFUND, mit Repro belegt: `aufrufe === 2` plus das dateiweite Verbot der drei Literale
// bleibt GRUEN, wenn NEBEN dem Gate ein zweiter, strengerer Boden in eine der beiden
// Ingest-Schleifen kommt ('if (mcap < 2e9) continue;'). Das ist exakt die Bugklasse,
// gegen die F-11 gebaut wurde: zwei Boeden an zwei Orten, und niemand haelt sie zusammen.
// Ein dateiweiter Zaehler kann das prinzipiell nicht sehen — er weiss nicht, WO die
// Treffer liegen, also nicht, ob eine Schleife zwei hat und eine keinen.
// Ab hier werden die beiden Schleifenkoerper ISOLIERT und JEDER EINZELN geprueft: genau
// EIN Band-Gate, KEIN weiterer mcap-Vergleich (generisch statt Literal-Liste). Und der
// Pruefer wird im selben Test mutiert — der gueltige Stand muss DURCHGEHEN, beide kaputten
// Staende muessen AUFFLIEGEN, sonst ist der Pruefer selbst falsch-gruen.
const SRC_RU = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', 'refresh-universe.js'), 'utf8');
const GATE_ZEILE = 'if (!inDiscoveryMcapBand(mcap)) continue;';
const INGEST_MARKER = 'for (const q of quotes) {';

// T567-W1 (Konvergenz-Check Tag 567): der Schleifenkoerper wurde an der EINRUECKUNG erkannt
// (`\n      }` = 6 Leerzeichen). Repro q3d.js: dieselbe Datei um 4 Leerzeichen flacher
// eingerueckt (Extraktion in eine Top-Level-Funktion — eine voellig normale Refaktorierung)
// liess den Sucher den Block nach 0 Zeichen enden; ein eingefuegter Zweitboden blieb GRUEN.
// Der Waechter haette also genau in dem Moment geschwiegen, in dem jemand den Code anfasst.
// Jetzt werden KLAMMERN gezaehlt: der Marker hat seine oeffnende schon verbraucht, wir
// starten bei Tiefe 1 und schneiden bei Tiefe 0. Kommentare fliegen VOR dem Zaehlen raus
// (sonst kippt eine auskommentierte Klammer die Tiefe) — und damit auch weiterhin, bevor
// irgendetwas gesucht wird, sonst haelt eine auskommentierte Gate-Zeile den Pruefer gruen.
// T569-F6: String-bewusst statt roher Regex. `//` beginnt nur dann einen Kommentar, wenn es
// NICHT in einem String-/Template-Literal steht — und umgekehrt darf ein Anfuehrungszeichen IN
// einem Kommentar den Scanner nicht in den String-Modus werfen, sonst frisst er den Rest.
// T572-Q4 (Review Tag 572, F2563): der Deckel "Regex-Literale sind nicht modelliert" war
// KEIN lauter Fehlschlag, sondern ein stilles Gruen. Ein `/^http:\/\//` endet auf dem
// escapten Slash-Paar `\/\/`; der Stripper sah dort einen Kommentarbeginn und schnitt alles
// dahinter AUF DERSELBEN ZEILE weg. Repro repro-q4b.js Deckel 1: ein Zweitboden hinter so
// einem Regex-Literal liess verdrahtungsMaengel() [] liefern — der Waechter blieb GRUEN.
// (Die ${}-Einbettung in Templates flog schon vorher auf; sie bleibt unmodelliert.)
// Jetzt wird der Regex-Kontext mitgefuehrt: nach = ( , ; : [ { ! & | ? und nach den
// Schluesselwoertern return/typeof/... beginnt ein `/` ein Regex-Literal, sonst ist es eine
// Division. Die einfache Heuristik reicht fuer diese Datei; ein echter Tokenizer waere Overkill.
// ponytail: Block-Kommentare (/* */) bleiben bewusst unmodelliert und geschweifte Klammern IN
// einem Regex (`/\d{2}/`) zaehlen weiter mit — beides erzeugt im Zweifel eine unbalancierte
// Klammer und damit einen LAUTEN Fehlschlag am Rumpf-Ende-Pin (T567-W1), nie ein stilles Gruen.
// Genau diese Unterscheidung fehlte oben: der Regex-Deckel WAR still.
const REGEX_VORGAENGER = /(?:[=(,;:[{!&|?+\-*%~^<>]|\b(?:return|typeof|instanceof|in|of|case|do|else|new|delete|void|yield|await))$/;
function ohneZeilenkommentare(code) {
  let out = '', quote = null, regex = false, klasse = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += code[++i] || ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (regex) {
      out += c;
      if (c === '\\') { out += code[++i] || ''; continue; }
      // Die naechsten drei Zeilen sind Schutz, kein Fix: sie begrenzen eine FEHL-Erkennung
      // (ein Regex-Literal kann keine Zeile ueberspannen; ein `/` in [...] beendet keins).
      // EHRLICH GEMESSEN (Scratchpad q4-wirkung.js, 5 konstruierte Faelle inkl.
      // `offset++ / 2` und `/['/]/`): sie aendern KEIN Urteil — im Regex-Modus wird jedes
      // Zeichen weiterhin ausgegeben, es geht also nichts verloren, und der Klammerzaehler
      // faengt sich wieder. Darum haben sie auch keine eigene Ausbau-Probe; die Zusicherung
      // "ein Regex-Literal gilt nicht als Kommentar" haengt allein an der Erkennung unten.
      // Sie bleiben stehen, weil sie richtig und billig sind, nicht weil sie etwas halten.
      if (c === '\n') { regex = false; klasse = false; continue; }
      if (c === '[') klasse = true;
      else if (c === ']') klasse = false;
      else if (c === '/' && !klasse) regex = false;
      continue;
    }
    // `//` ist IMMER ein Kommentar: ein leeres Regex-Literal gibt es in JS nicht.
    if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && code[i + 1] !== '*' && REGEX_VORGAENGER.test(out.slice(-32).trimEnd())) {
      regex = true; klasse = false;
      out += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
  }
  return out;
}

/** Der Stand VOR T572-Q4 — nur als Beleg, dass der Befund echt war (nie im Pruefpfad). */
function ohneZeilenkommentareVorQ4(code) {
  let out = '', quote = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += code[++i] || ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
  }
  return out;
}

function ingestSchleifen(src) {
  return src.split(INGEST_MARKER).slice(1).map((rest) => {
    const ohneKommentar = ohneZeilenkommentare(rest);
    let tiefe = 1, i = 0;
    for (; i < ohneKommentar.length && tiefe > 0; i++) {
      const c = ohneKommentar[i];
      if (c === '{') tiefe++;
      else if (c === '}') tiefe--;
    }
    return tiefe === 0 ? ohneKommentar.slice(0, i - 1) : ohneKommentar;
  });
}
// T567-W2 (Konvergenz-Check Tag 567): das Zweitboden-Muster hing am NAMEN `mcap`. Repro q3.js:
// 'if (mcapUsd < 2e9) continue;' und 'if (q.marketCap < 2e9) continue;' — der zweite ist
// woertlich der Bug-4-Fehler (Vergleich auf dem Rohfeld in Listing-Waehrung) — blieben beide
// GRUEN. Wirkungsgebunden statt namensgebunden: JEDER Vergleich gegen ein grosses Zahl-Literal
// im Schleifenkoerper ist verdaechtig, egal wie die Variable heisst. Der gueltige Stand
// enthaelt nur `sym.length > 12` (2 Ziffern, kein Exponent) und faellt nicht darunter.
const ZWEITBODEN_RE = /[<>]=?\s*(\d+(\.\d+)?e\d+|\d{7,})/g;
function verdrahtungsMaengel(src) {
  const maengel = [];
  const bloecke = ingestSchleifen(src);
  if (bloecke.length !== 2) maengel.push(bloecke.length + ' Ingest-Schleifen gefunden statt 2');
  bloecke.forEach((b, i) => {
    const gates = (b.match(/inDiscoveryMcapBand\(/g) || []).length;
    if (gates !== 1) maengel.push('Schleife ' + (i + 1) + ': ' + gates + ' Band-Gate-Aufrufe statt genau 1');
    if (!b.includes(GATE_ZEILE)) maengel.push('Schleife ' + (i + 1) + ': Gate fehlt in der verwerfenden Form');
    for (const t of b.match(/\bmcap\s*[<>]=?\s*[\w.]/g) || [])
      maengel.push('Schleife ' + (i + 1) + ': zweiter mcap-Vergleich neben dem Gate ("' + t.trim() + '")');
    for (const t of b.match(ZWEITBODEN_RE) || [])
      maengel.push('Schleife ' + (i + 1) + ': Vergleich gegen ein grosses Zahl-Literal ("' + t.trim() + '")');
  });
  return maengel;
}

test('T562-M2: jede Ingest-Schleife EINZELN — genau ein Band-Gate, kein zweiter mcap-Vergleich', () => {
  assert.deepEqual(verdrahtungsMaengel(SRC_RU), [],
    'gueltiger Stand muss durchgehen — sonst prueft der Waechter etwas anderes als er soll');
});

test('T562-M2 Gegenprobe: Zweitboden NEBEN dem Gate fliegt auf (alter Waechter blieb gruen)', () => {
  const mutiert = SRC_RU.replace(GATE_ZEILE, 'if (mcap < 2e9) continue;\n        ' + GATE_ZEILE);
  assert.notEqual(mutiert, SRC_RU, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  assert.ok(verdrahtungsMaengel(mutiert).length > 0, 'ein stiller Zweitboden muss auffliegen');
  // Beleg, dass genau DAS der alte Waechter durchgelassen haette (der Befund selbst):
  assert.equal((mutiert.match(/if \(!inDiscoveryMcapBand\(mcap\)\) continue;/g) || []).length, 2,
    'alter Zaehler-Waechter: unveraendert 2 Treffer -> gruen');
  assert.ok(!/mcap\s*<\s*(1e9|1000000000|MIN_MCAP_CUSTOM)/.test(mutiert),
    'altes Boden-Verbot: kein Literal-Treffer -> gruen');
});

test('T562-M2 Gegenprobe: ein entferntes Gate fliegt auf — auch als Kommentar getarnt', () => {
  const mutiert = SRC_RU.replace(GATE_ZEILE, 'void 0;');
  assert.notEqual(mutiert, SRC_RU, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  assert.ok(verdrahtungsMaengel(mutiert).length > 0, 'eine ungefilterte Ingest-Schleife muss auffliegen');
  // Tarnvariante aus dem Reviewer-Repro: das echte Gate faellt weg, die Zeichenkette taucht
  // dafuer als Kommentar auf -> ein dateiweiter Zaehler bleibt bei 2 und damit gruen.
  const getarnt = SRC_RU.replace(GATE_ZEILE, 'void 0;')   // echtes Gate raus
    .replace('const MIN_MCAP_DISCOVERY = 800e6;',         // Zeichenkette als Kommentar zurueck
      '// Beispielaufruf fuer neue Kanaele: ' + GATE_ZEILE + '\nconst MIN_MCAP_DISCOVERY = 800e6;');
  assert.equal((getarnt.match(/if \(!inDiscoveryMcapBand\(mcap\)\) continue;/g) || []).length, 2,
    'alter Zaehler-Waechter: 2 Treffer -> gruen, obwohl eine Schleife ungefiltert laeuft');
  assert.ok(verdrahtungsMaengel(getarnt).length > 0, 'die Kommentar-Tarnung muss auffliegen');
});

// ── T567-W1: der Blockschnitt hing an der EINRUECKUNG ─────────────────────────────
test('T567-W1: eine flacher eingerueckte Datei bleibt pruefbar (Repro q3d.js)', () => {
  // Die Refaktorierung, die den alten Waechter blind machte: Ingest-Schleife eine Ebene
  // hoeher (z. B. in eine eigene Funktion gezogen). Fachlich identisch, Waechter tot.
  const flach = SRC_RU.split('\n').map((l) => (l.startsWith('      ') ? l.slice(4) : l)).join('\n');
  assert.deepEqual(verdrahtungsMaengel(flach), [], 'der gueltige Stand muss auch flach eingerueckt durchgehen');
  // Zweitboden ans ENDE des Rumpfes (vor kept++) — genau dort, wo der einrueckungs-
  // abhaengige Schnitt nach dem Reindent zu frueh abschneidet.
  const mitZweitboden = flach.replace('kept++;', 'if (mcap < 2e9) continue;\n    kept++;');
  assert.notEqual(mitZweitboden, flach, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  assert.ok(verdrahtungsMaengel(mitZweitboden).length > 0,
    'BEFUND (Repro q3d.js): nach dem Reindent blieb der alte Sucher gruen, obwohl ein Zweitboden drinstand');
  // Beleg, dass der ALTE, einrueckungs-abhaengige Schnitt hier wirklich versagt haette:
  const altSchnitt = (src) => src.split(INGEST_MARKER).slice(1)
    .map((rest) => { const o = rest.replace(/\/\/[^\n]*/g, ''); const e = o.search(/\n {6}\}/); return e < 0 ? o : o.slice(0, e); });
  assert.ok(!altSchnitt(mitZweitboden)[0].includes('mcap < 2e9'),
    'der alte Schnitt haette den Zweitboden aus dem Block geschnitten (das IST der Befund)');
  assert.ok(ingestSchleifen(mitZweitboden)[0].includes('mcap < 2e9'),
    'der Klammer-Zaehler haelt ihn im Block');
});

test('T567-W1: der Block endet am echten Schleifen-Ende, nicht irgendwo', () => {
  const [predefined, exchange] = ingestSchleifen(SRC_RU);
  // Rumpf-Ende-Pin: das jeweils letzte Statement der Schleife muss drin sein …
  assert.match(predefined, /kept\+\+;\s*$/, 'Predefined-Schleife endet auf kept++');
  assert.match(exchange, /customAdded\+\+;\s*\}\s*$/, 'Exchange-Schleife endet auf den if-Block');
  // … und das erste Statement NACH der Schleife darf nicht mehr drin sein.
  assert.ok(!predefined.includes('predefinedKept +='), 'Predefined-Block laeuft ueber das Schleifen-Ende hinaus');
  assert.ok(!exchange.includes('totalKept += kept;'), 'Exchange-Block laeuft ueber das Schleifen-Ende hinaus');
});

// ── T567-W2: das Zweitboden-Muster hing am Variablennamen ─────────────────────────
test('T567-W2: ein Zweitboden fliegt auch unter anderem Namen auf (Repro q3.js)', () => {
  const faelle = {
    'mcapUsd-Zweitboden': 'const mcapUsd = mcap;\n        if (mcapUsd < 2e9) continue;\n        ',
    'q.marketCap-Zweitboden (der Bug-4-Fehler selbst)': 'if (q.marketCap < 2e9) continue;\n        ',
    'Zweitboden als Ganzzahl-Literal': 'if (q.marketCap < 2000000000) continue;\n        ',
    'negierte Form': 'if (!(mcap >= 2e9)) continue;\n        ',
  };
  for (const [name, einschub] of Object.entries(faelle)) {
    const mutiert = SRC_RU.replace(GATE_ZEILE, einschub + GATE_ZEILE);
    assert.notEqual(mutiert, SRC_RU, name + ': Mutation griff nicht');
    assert.ok(verdrahtungsMaengel(mutiert).length > 0,
      name + ': BEFUND (Repro q3.js) — der namensgebundene Pruefer blieb hier gruen');
  }
});

// ── T569-F6 (Review Tag 569): der Kommentar-Stripper schnitt auch in Strings ──────
// Repro repro-q5b.js Q5a2: `const u = 'http://x'; if (q.marketCap < 2e9) continue;` — das `//`
// im String-Literal galt als Kommentarbeginn, alles danach auf der Zeile war fuer den Waechter
// unsichtbar, der Zweitboden blieb GRUEN. Gewaehlt wurde der String-bewusste Stripper statt
// eines blossen Kommentars an der Deckel-Stelle: die Luecke ist EINE gewoehnliche Zeile weit
// entfernt (eine geloggte URL genuegt), und dieser Waechter ist das einzige, was die
// F-11-Invariante "genau EIN Boden" an den beiden Ingest-Schleifen haelt. Ein Kommentar haette
// dieselbe Lesezeit gekostet und null Schutz gebracht.
test('T569-F6: ein Zweitboden hinter einem // IM STRING fliegt auf (Repro repro-q5b.js Q5a2)', () => {
  const mutiert = SRC_RU.replace(GATE_ZEILE,
    "const u = 'http://x'; if (q.marketCap < 2e9) continue;\n        " + GATE_ZEILE);
  assert.notEqual(mutiert, SRC_RU, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  // Beleg des Befunds: der naive Stripper schneidet den Zweitboden mit weg.
  assert.ok(!mutiert.split(INGEST_MARKER)[1].replace(/\/\/[^\n]*/g, '').includes('q.marketCap < 2e9'),
    'der naive Stripper haette den Zweitboden entfernt (das IST der Befund)');
  assert.ok(verdrahtungsMaengel(mutiert).length > 0,
    'BEFUND (Repro repro-q5b.js Q5a2): ein hinter einem String-// getarnter Zweitboden blieb gruen');
});

test('T569-F6: ein Anfuehrungszeichen IM KOMMENTAR kippt den Stripper nicht (Falsch-Rot-Probe)', () => {
  // Die klassische Regression eines String-bewussten Scanners: `// Karls Boden` wuerde den
  // Scanner in den String-Modus werfen und danach jede Klammer verschlucken.
  const mitApostroph = SRC_RU.replace(GATE_ZEILE, "// Karl's Boden bleibt hier\n        " + GATE_ZEILE);
  assert.notEqual(mitApostroph, SRC_RU, 'Mutation griff nicht');
  assert.deepEqual(verdrahtungsMaengel(mitApostroph), [],
    'ein Apostroph in einem Kommentar darf den Pruefer weder blind noch falsch-rot machen');
  assert.deepEqual(verdrahtungsMaengel(SRC_RU), [], 'und der gueltige Stand bleibt unberuehrt');
});

// ── T572-Q4 (Review Tag 572, F2563): Regex-Literale mit escaptem Slash ────────────
// Der bis Tag 573 dokumentierte Deckel behauptete, unmodellierte Regex-Literale wuerden
// "im Zweifel eine unbalancierte Klammer und damit einen LAUTEN Fehlschlag" erzeugen.
// Das stimmte fuer die haeufigste Form NICHT: `/^http:\/\//` endet auf `\/\/`, der
// Stripper sah dort einen Kommentarbeginn und schnitt den REST DER ZEILE weg. Ein
// Zweitboden dahinter blieb damit unsichtbar und der Waechter GRUEN — das schlimmste
// Ergebnis fuer eine Wache, die die F-11-Invariante "genau EIN Boden" halten soll.
const BS = String.fromCharCode(92);
const SLASH_REGEX = '/^http:' + BS + '/' + BS + '/' + '/';   // ergibt: /^http:\/\//

test('T572-Q4: Zweitboden hinter einem Regex-Literal, SELBE Zeile, fliegt auf (Repro repro-q4b.js Deckel 1)', () => {
  const mutiert = SRC_RU.replace(GATE_ZEILE,
    'const re = ' + SLASH_REGEX + '; if (q.marketCap < 2e9) continue;\n        ' + GATE_ZEILE);
  assert.notEqual(mutiert, SRC_RU, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  // Beleg, dass GENAU DAS der alte Stripper verschluckt hat (das IST der Befund):
  assert.ok(!ohneZeilenkommentareVorQ4(mutiert.split(INGEST_MARKER)[1]).includes('q.marketCap < 2e9'),
    'der regex-blinde Stripper haette den Zweitboden hier NICHT weggeschnitten — dann bildet '
    + 'diese Gegenprobe den Befund nicht ab und beweist nichts.');
  assert.ok(verdrahtungsMaengel(mutiert).length > 0,
    'BEFUND (Repro repro-q4b.js Deckel 1): ein Zweitboden hinter einem Regex-Literal mit escaptem '
    + 'Slash blieb GRUEN — das `\\/\\/` galt als Kommentarbeginn und der Rest der Zeile fiel weg.');
});

test('T572-Q4: der Regex-Kontext frisst nicht die FOLGE-Zeile (Abwesenheits-Probe)', () => {
  // Gegenrichtung zum Notausstieg am Zeilenumbruch: ein Regex-Literal darf hoechstens
  // sich selbst betreffen. Frisst der Scanner darueber hinaus, verschwindet der naechste
  // Boden genauso still wie vorher — nur eine Zeile weiter.
  const mutiert = SRC_RU.replace(GATE_ZEILE,
    'const re = ' + SLASH_REGEX + ';\n        if (q.marketCap < 2e9) continue;\n        ' + GATE_ZEILE);
  assert.notEqual(mutiert, SRC_RU, 'Mutation griff nicht');
  assert.ok(ingestSchleifen(mutiert)[0].includes('q.marketCap < 2e9'),
    'die Zeile NACH dem Regex-Literal ist aus dem Schleifenkoerper verschwunden');
  assert.ok(verdrahtungsMaengel(mutiert).length > 0, 'der Zweitboden eine Zeile spaeter muss auffliegen');
});

test('T572-Q4: Template-Literal-Fall bleibt laut (war schon vorher gedeckt, muss es bleiben)', () => {
  const mutiert = SRC_RU.replace(GATE_ZEILE,
    'const u = `x${(1+2)}`; if (q.marketCap < 2e9) continue;\n        ' + GATE_ZEILE);
  assert.notEqual(mutiert, SRC_RU, 'Mutation griff nicht');
  assert.ok(verdrahtungsMaengel(mutiert).length > 0,
    'der Template-Fall (repro-q4b.js Deckel 2) flog vor T572-Q4 auf und darf durch die '
    + 'Regex-Erweiterung nicht still werden.');
});

test('T572-Q4: Division und gewoehnliche Regex-Literale machen den Pruefer nicht falsch-rot', () => {
  // Die eigentliche Gefahr einer Kontext-Heuristik: sie haelt eine Division fuer einen
  // Regex-Beginn und frisst ab da alles bis zum naechsten `/` — dann ist der Waechter
  // entweder blind (Zeichen weg) oder ein Dauer-Falschalarm.
  assert.deepEqual(verdrahtungsMaengel(SRC_RU), [], 'der gueltige Stand muss durchgehen');
  const faelle = {
    'Division nach Klammer': 'const h = (quotes.length + 1) / 2;\n        ',
    'Division nach Bezeichner': 'const h = offset / 2;\n        ',
    'Regex-Literal nach =': 'const ok = /^[A-Z]$/.test(sym);\n        ',
    'Regex-Literal als Argument': 'const ok = String(sym).replace(/[^A-Z]/g, "");\n        ',
    'Regex mit Slash in der Zeichenklasse': 'const ok = /[/]/.test(sym);\n        ',
  };
  for (const [name, einschub] of Object.entries(faelle)) {
    const mutiert = SRC_RU.replace(GATE_ZEILE, einschub + GATE_ZEILE);
    assert.notEqual(mutiert, SRC_RU, name + ': Mutation griff nicht');
    assert.deepEqual(verdrahtungsMaengel(mutiert), [],
      name + ': harmloser Code macht den Pruefer rot — eine Kontext-Heuristik, die Division '
      + 'fuer einen Regex-Beginn haelt, blockiert Karls Tagslauf ohne Bug.');
    // … und der Waechter ist danach noch scharf, nicht nur still:
    const mitBoden = SRC_RU.replace(GATE_ZEILE, einschub + 'if (q.marketCap < 2e9) continue;\n        ' + GATE_ZEILE);
    assert.ok(verdrahtungsMaengel(mitBoden).length > 0,
      name + ': hinter diesem Einschub bleibt ein Zweitboden unsichtbar — still statt scharf.');
  }
});

test('T567-W2: der gueltige Stand bleibt gruen (sonst waere der Pruefer falsch-rot)', () => {
  // Das ist die eigentliche Gefahr einer wirkungsgebundenen Regel: sie darf die kleinen,
  // legitimen Zahlenvergleiche der Ingest-Schleifen nicht mitnehmen (Symbol-Laenge,
  // Seitengroesse). Nur Groessenordnungen, in denen eine Marktkapitalisierung lebt.
  assert.deepEqual(verdrahtungsMaengel(SRC_RU), []);
  for (const harmlos of ['if (sym.length > 12) continue;', 'if (quotes.length < 250) {', 'offset += 250;']) {
    assert.deepEqual(harmlos.match(ZWEITBODEN_RE), null, 'falsch-rot bei: ' + harmlos);
  }
  for (const boden of ['if (mcapUsd < 2e9)', 'x >= 800000000', 'if (v<1.5e9)']) {
    assert.notEqual(boden.match(ZWEITBODEN_RE), null, 'muss als Zweitboden gelten: ' + boden);
  }
});

const YML = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
// T562-L1: ALLE Schritte, deren Name mit "Run Yahoo Pull" beginnt — nicht nur der erste.
const pullSchritte = (yml) => yml.split(/^ {6}- name: /m).filter(b => b.startsWith('Run Yahoo Pull'));

test('F-11: Discovery-Boden liegt nie UEBER dem Pull-Boden aus daily-pull.yml', () => {
  // DAS WAR DER BEFUND, nicht nur seine Folge: der Pull-Boden wurde 2026-06 auf $800M
  // gesenkt, der Entdeckungs-Boden blieb bei $1 Mrd — zwei Zahlen an zwei Orten, und
  // niemand hielt sie zusammen. Genau diese Richtung wird hier gepinnt.
  // Umgekehrt (Discovery UNTER Pull) ist erlaubt: dann schlaegt die Entdeckung Firmen
  // vor, die der Pull verwirft — Verschwendung, aber keine Luecke. Nur Discovery > Pull
  // erzeugt das tote Band, in dem eine Firma von KEINEM Kanal vorgeschlagen werden kann.
  // Am OBJEKT suchen, nicht dateiweit: nur der Block des "Run Yahoo Pull"-Schritts.
  // Dateiweites Greifen faende auch fremde MIN_MCAP_USD-Vorkommen und wuerde gruen
  // bleiben, wenn sich ausgerechnet der hier gemeinte Wert aendert.
  // T562-L1: filter statt find — find() nimmt blind den ERSTEN Treffer, ein zweiter
  // gleichnamiger Schritt haette den Test lautlos gegen die falsche Zahl vergleichen lassen.
  const bloecke = pullSchritte(YML);
  assert.equal(bloecke.length, 1,
    `${bloecke.length} Schritte beginnen mit "Run Yahoo Pull" — der Pull-Boden ist nicht mehr ` +
    'eindeutig ablesbar; dieser Test muesste dann sagen, WELCHER Schritt der echte Pull ist.');
  const block = bloecke[0];
  const m = block.match(/^\s*MIN_MCAP_USD:\s*'?(\d+)'?\s*$/m);
  assert.ok(m, 'MIN_MCAP_USD fehlt im "Run Yahoo Pull"-Block — Pull-Boden nicht mehr ablesbar');
  const pullBoden = Number(m[1]);
  assert.ok(ru.MIN_MCAP_DISCOVERY <= pullBoden,
    `Discovery-Boden $${ru.MIN_MCAP_DISCOVERY / 1e6}M liegt UEBER dem Pull-Boden $${pullBoden / 1e6}M — ` +
    'das Band dazwischen ist tot: der Pull wuerde diese Firmen nehmen, die Entdeckung schlaegt sie nie vor.');
});

test('T562-L1 Gegenprobe: ein zweiter "Run Yahoo Pull"-Schritt fliegt auf (find() nahm blind den ersten)', () => {
  // BEFUND Tag 562: `.find(b => b.startsWith('Run Yahoo Pull'))` nahm den ERSTEN Treffer.
  // Ein spaeter davor eingefuegter Schritt "Run Yahoo Pull (dry-run smoke)" mit eigenem
  // MIN_MCAP_USD haette den Kopplungstest gegen die falsche Zahl vergleichen lassen: gruen,
  // waehrend der echte Pull-Boden davondriftet. Genau die Lage, die F-11 erzeugt hat.
  const zweiterSchritt =
    "      - name: Run Yahoo Pull (dry-run smoke)\n" +
    "        env:\n" +
    "          MIN_MCAP_USD: '5000000000'\n" +
    "        run: node pull-yahoo.js --dry-run\n\n";
  const mutiert = YML.replace('      - name: Run Yahoo Pull (shard', zweiterSchritt + '      - name: Run Yahoo Pull (shard');
  assert.notEqual(mutiert, YML, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  assert.equal(pullSchritte(mutiert).length, 2, 'die Eindeutigkeits-Zusicherung muss hier fallen');
  // und der ALTE Weg haette still den $5-Mrd-Schwindel-Block gelesen:
  const altBlock = mutiert.split(/^ {6}- name: /m).find(b => b.startsWith('Run Yahoo Pull'));
  assert.equal(Number(altBlock.match(/^\s*MIN_MCAP_USD:\s*'?(\d+)'?\s*$/m)[1]), 5000000000,
    'Beleg des Befunds: find() liest den falschen Schritt, ohne dass irgendetwas rot wird');
});

// ── T562-M1 (Hard-Review Tag 562): ein Kanal kann am Band-Gate LAUTLOS leerlaufen ──
// BEFUND, mit Repro belegt: toUsd() liefert null, sobald q.currency fehlt oder einen
// Yahoo-seitig geaenderten/unbekannten Code traegt (Schema-Bruch-Klasse) — dann verwirft
// inDiscoveryMcapBand() JEDE Zeile. Kein bestehender Waechter sieht das:
//   - Tag 510 misst nicht-leere BUCKETS, also Abgeholtes, nicht Behaltenes,
//   - die 0-Quotes-Warnung des Exchange-Kanals prueft totalQuotes (das ist > 0!),
//   - MIN_DISCOVERY_CANDIDATES kennt die beiden Yahoo-Kanaele gar nicht —
//     DISCOVERY_SOURCE_NAMES listet nur die 20 Adapter.
// Ergebnis: volle Buckets, 0 Kandidaten, Lauf gruen. Seit Tag 566 ist der Predefined-Kanal
// wieder scharf, die Lage ist also nicht mehr theoretisch.
const { toUsd } = require('../discovery/mcap-prefilter.js');
const FX_OHNE_SEK = { USD: 1, EUR: 1.1 };  // partielle Luecke, KEIN Ladefehler -> BH-041 greift nicht

test('T562-M1: Fixture — eine gesunde Boersenseite laeuft am Gate komplett leer', () => {
  const seite = [
    { symbol: 'ABC.ST', marketCap: 12e9, currency: 'SEK', quoteType: 'EQUITY' },   // FX-Luecke
    { symbol: 'DEF.ST', marketCap: 30e9, currency: 'SEK', quoteType: 'EQUITY' },   // FX-Luecke
    { symbol: 'GHI.ST', marketCap: 90e9, quoteType: 'EQUITY' },                    // currency fehlt ganz
  ];
  // die ECHTE Kette der beiden Ingest-Schleifen, nicht nachgebaut: toUsd() -> inDiscoveryMcapBand()
  const behalten = seite.filter(q => ru.inDiscoveryMcapBand(toUsd(q.marketCap, q.currency, FX_OHNE_SEK))).length;
  assert.equal(behalten, 0, 'Vorbedingung des Befunds: jede Zeile faellt still am Gate');
  assert.equal(ru.beideYahooKanaeleLeer(325, false, 0), false,
    'Beleg der Luecke: der Tag-510-Waechter schweigt, weil er Buckets misst statt Behaltenes');
  assert.ok(ru.kanalLeerlaufAlarm('Test-Kanal', seite.length, behalten, 2, 0),
    'genau hier muss der neue Waechter feuern');
});

test('T562-M1: Waechter feuert NUR bei "abgeholt > 0 und nichts behalten"', () => {
  assert.equal(ru.kanalLeerlaufAlarm('K', 0, 0, 0, 0), null,
    'gar nichts abgeholt ist der Fall der bestehenden Waechter (Tag 510 / BH-100), nicht dieser');
  assert.equal(ru.kanalLeerlaufAlarm('K', 5000, 1, 0, 0), null,
    'eine einzige behaltene Zeile heisst: der Kanal lebt');
  assert.ok(ru.kanalLeerlaufAlarm('K', 5000, 0, 0, 0), 'abgeholt und nichts behalten -> Alarm');
});

test('T562-M1: der Alarm trennt den Drop-Grund (FX-Luecke vs. ausserhalb Band)', () => {
  // Ohne getrennten Grund sagt die Meldung nur "nichts behalten" — die naechste Debug-Runde
  // faengt dann wieder bei null an. isUnpriceable() kann genau das unterscheiden.
  assert.match(ru.kanalLeerlaufAlarm('K', 100, 0, 100, 0), /fx-rates\.json/);
  assert.doesNotMatch(ru.kanalLeerlaufAlarm('K', 100, 0, 0, 0), /fx-rates\.json/);
  assert.ok(ru.kanalLeerlaufAlarm('K', 100, 0, 0, 0).startsWith('::error::'),
    'muss als GitHub-Annotation sichtbar sein, sonst sieht Karl es nicht');
  assert.match(ru.kanalLeerlaufAlarm('Predefined-Screener-Kanal', 100, 0, 0, 0), /Predefined-Screener-Kanal/,
    'die Meldung muss sagen, WELCHER Kanal leerlief');
});

test('T562-M1: beide Ingest-Schleifen trennen den Drop-Grund (isUnpriceable)', () => {
  // Am OBJEKT, nicht dateiweit: JEDE der beiden Schleifen muss den FX-Grund mitzaehlen,
  // sonst meldet der Alarm im Ernstfall immer "keine FX-Luecke" und schickt die naechste
  // Debug-Runde in die falsche Richtung.
  ingestSchleifen(SRC_RU).forEach((b, i) => {
    assert.match(b, /isUnpriceable\(q\.marketCap, q\.currency, _FX_RATES\)/,
      'Schleife ' + (i + 1) + ': zaehlt den FX-Drop-Grund nicht mit');
  });
});

// ── T567-W3: die Ursachen-Behauptung war ungedeckt ────────────────────────────────
test('T567-W3: alles fiel VOR dem Gate -> keine FX-/Band-Ursache behaupten', () => {
  // Die 4 bewusst nicht-Equity-Buckets (Fonds/Anleihen) koennen genau das erzeugen.
  const m = ru.kanalLeerlaufAlarm('K', 100, 0, 0, 100);
  assert.match(m, /KEINE EINZIGE Zeile hat das Groessen-Gate ueberhaupt erreicht/);
  assert.doesNotMatch(m, /ausserhalb \$/,
    'BEFUND: bis Tag 570 behauptete der Alarm hier eine Groessen-Ursache, die es nie gab');
  assert.doesNotMatch(m, /fx-rates\.json/);
  assert.match(m, /100 Zeilen fielen VOR dem Gate/, 'die Zahl gehoert in die Meldung');
});

test('T567-W3: was am Gate ankam, wird weiter sauber getrennt', () => {
  assert.match(ru.kanalLeerlaufAlarm('K', 100, 0, 40, 60), /fx-rates\.json/,
    '40 von 40 Gate-Erreichern hatten eine FX-Luecke');
  const band = ru.kanalLeerlaufAlarm('K', 100, 0, 0, 60);
  assert.match(band, /ausserhalb \$800M-\$500B/);
  assert.match(band, /jede der 40 Zeilen am Gate/, 'die Restmenge muss beziffert sein');
  assert.match(band, /60 Zeilen fielen VOR dem Gate/);
});

test('T567-W3: geht die Zerlegung nicht auf, wird KEINE Ursache behauptet', () => {
  for (const [fx, vor] of [[0, undefined], [0, -1], [0, 200], [80, 60]]) {
    const m = ru.kanalLeerlaufAlarm('K', 100, 0, fx, vor);
    assert.match(m, /Zerlegung geht nicht auf/, `fx=${fx} vor=${vor}`);
    assert.doesNotMatch(m, /fx-rates\.json/, 'keine Ursache raten, wenn die Rechnung nicht stimmt');
  }
});

// Die Zerlegung ist nur vollstaendig, solange es GENAU ZWEI verwerfende Pfade je Schleife
// gibt. Ein dritter, ungezaehlter continue wuerde still in die Band-Zahl wandern und die
// Ursachen-Behauptung wieder ungedeckt machen — deshalb am Objekt gezaehlt.
// T569-F5 (Review Tag 569): der Pin hing woertlich an `continue;`. Repro repro-q5b.js:
// `if (kept > 50) break;` und `if (kept > 50) return;` sind genauso verwerfende Pfade, wurden
// aber nicht gezaehlt — der Pin blieb bei 2 und damit gruen, waehrend der Rest der
// bandDrops-Rechnung (kanalLeerlaufAlarm) ab da eine Ursache behauptet, die es nicht gibt.
// EINE Quelle fuer Pin und Gegenprobe, damit beide nicht auseinanderdriften koennen.
function verwerfendePfade(block) {
  return (block.match(/\b(continue|break|return)\b/g) || []).length;
}

test('T567-W3: jede Ingest-Schleife hat genau zwei verwerfende Pfade (Vor-Gate + Band)', () => {
  ingestSchleifen(SRC_RU).forEach((b, i) => {
    assert.equal(verwerfendePfade(b), 2,
      'Schleife ' + (i + 1) + ': jeder weitere verwerfende Pfad muss gezaehlt werden, sonst ' +
      'behauptet kanalLeerlaufAlarm wieder eine Ursache, die er nicht kennt');
    assert.match(b, /_vorGateVerworfen\(q\)\) \{ \w+\+\+; continue; \}/,
      'Schleife ' + (i + 1) + ': der Vor-Gate-Pfad muss gezaehlt werden');
  });
});

test('T569-F5: ein dritter verwerfender Pfad fliegt auch ohne `continue` auf (Repro repro-q5b.js)', () => {
  for (const einschub of ['if (kept > 50) break;', 'if (kept > 50) return;']) {
    const mutiert = SRC_RU.replace(GATE_ZEILE, einschub + '\n        ' + GATE_ZEILE);
    assert.notEqual(mutiert, SRC_RU, einschub + ': Mutation griff nicht — dann prueft die Gegenprobe nichts');
    // Beleg des Befunds: der alte, woertliche Zaehler blieb bei 2 und damit gruen.
    assert.equal((ingestSchleifen(mutiert)[0].match(/\bcontinue;/g) || []).length, 2,
      einschub + ': alter Pin -> unveraendert 2 Treffer (das IST der Befund)');
    assert.notEqual(verwerfendePfade(ingestSchleifen(mutiert)[0]), 2,
      einschub + ': BEFUND (Repro repro-q5b.js) — ein dritter Verwerfungs-Pfad blieb unsichtbar');
  }
});

test('T562-M1: BEIDE Yahoo-Kanaele sind an den Waechter verdrahtet', () => {
  // Ohne das waere die Funktion korrekt und die Luecke offen (dieselbe Falle wie T562-M2).
  // Kommentare vorher raus, damit eine blosse Erwaehnung im Fliesstext nicht gruen haelt.
  // ponytail: Zaehlung auf Namensebene — Deckel bekannt; eine Umbenennung faellt rot auf,
  // das ist die richtige Fehlerrichtung.
  const code = SRC_RU.replace(/\/\/[^\n]*/g, '');
  assert.equal((code.match(/kanalLeerlaufAlarm\(/g) || []).length, 3,
    'erwartet: 1 Definition + je 1 Aufruf im Predefined- und im Custom-Exchange-Kanal');
});

// ── BH-100/F-11-FOLGE (04.08.2026): die Bibliotheks-Untergrenze IST der Kanal ──────
// Der Predefined-Kanal war seit dem 11.05.2026 tot: 325 von 325 Aufrufen warfen
// FailedYahooValidationError, weil yahoo-finance2 unter 3.15.0 ein Ergebnis komplett
// verwirft, sobald Yahoo EIN unbekanntes Feld mitschickt (impliedSharesOutstanding, seit
// Mai 2026, von unserem Code nirgends benutzt). Keine Zeile eigener Code war schuld, und
// keine Zeile eigener Code heilt es — nur die Version. Eigene Messung 04.08. an derselben
// 5er-Stichprobe: 3.14.0 = 5/5 Aufrufe tot, 0 Quotes; 3.15.4 = 1/5 tot, 971 Quotes.
// Ein Rueckfall unter 3.15.0 toetet den Kanal wieder, und der einzige Alarm dagegen waere
// eine Zeile im CI-Log, die drei Monate lang niemand gelesen hat. Deshalb hier, statisch.
// Geprueft wird der LOCK (das ist, was `npm ci` installiert) UND die Range in package.json.
test('BH-100/F-11-FOLGE: yahoo-finance2 >= 3.15.0 — darunter ist der Predefined-Kanal tot', () => {
  const fs = require('node:fs'), path = require('node:path');
  const ROOT = path.join(__dirname, '..');
  const MINDEST = [3, 15, 0];
  const mindestens = (v, min) => {
    const t = String(v).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (!Number.isFinite(t[i])) return false;
      if (t[i] !== min[i]) return t[i] > min[i];
    }
    return true;
  };
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const eintrag = lock.packages && lock.packages['node_modules/yahoo-finance2'];
  assert.ok(eintrag && eintrag.version, 'yahoo-finance2 fehlt im package-lock.json');
  assert.ok(mindestens(eintrag.version, MINDEST),
    `package-lock.json haelt yahoo-finance2 ${eintrag.version} — unter 3.15.0 wirft der ` +
    'Predefined-Screener bei JEDEM Aufruf FailedYahooValidationError (gemessen: 3.14.0 = 5/5 tot).');
  const range = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies['yahoo-finance2'];
  assert.ok(mindestens(String(range).replace(/^[^0-9]*/, ''), MINDEST),
    `package.json erlaubt "${range}" — die Untergrenze muss die geheilte Version dokumentieren, ` +
    'sonst loest ein Lock-Neubau wieder auf eine tote Version auf.');
});

// ── DEP-NPMRC (Review Tag 565): Install-Skripte fremder Pakete ────────────────────
// Lifecycle-Skripte (preinstall/install/postinstall/prepare) laufen bei `npm ci` mit den
// Rechten des CI-Jobs. Der Zustand ist heute sauber (0 Pakete mit Install-Skript) — und
// genau deshalb wird er festgenagelt: .npmrc schaltet sie ab, dieser Test haelt beide
// Haelften zusammen, damit weder die Datei noch die Eigenschaft still verschwindet.
test('DEP-NPMRC: .npmrc schaltet Dependency-Install-Skripte ab', () => {
  const fs = require('node:fs'), path = require('node:path');
  const npmrc = fs.readFileSync(path.join(__dirname, '..', '.npmrc'), 'utf8');
  assert.match(npmrc, /^\s*ignore-scripts\s*=\s*true\s*$/m,
    '.npmrc ohne ignore-scripts=true — dann laeuft wieder jedes fremde postinstall im CI');
});
test('DEP-NPMRC: kein Paket im Lockfile bringt ueberhaupt ein Install-Skript mit', () => {
  const fs = require('node:fs'), path = require('node:path');
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  const mitSkript = Object.entries(lock.packages || {})
    .filter(([, p]) => p && p.hasInstallScript === true).map(([n]) => n);
  assert.deepEqual(mitSkript, [],
    'ein neues Paket bringt ein Install-Skript mit. Mit ignore-scripts=true laeuft es NICHT — ' +
    'pruefen, ob das Paket ohne seinen Install-Schritt funktioniert, und die Entscheidung hier festhalten.');
});

// ── T566-H2 (Review Tag 566): die Wache sprach erst bei NULL nicht-leeren Buckets an ──
// Ein Teilausfall (Bibliotheks-Rueckfall, Yahoo-Feld-Wechsel, der nur einen Teil der Buckets
// zerlegt) landet zwischen "alles tot" und "gesund" und lief still durch. Gleiche Bugklasse
// wie F-12-R2 im Filter, eine Stufe frueher.
test('T566-H2: Anteil unter der Schwelle -> Befund (nicht erst bei 0)', () => {
  assert.equal(ru.predefinedKanalEingebrochen(0, 325), true, 'Totalausfall bleibt ein Befund');
  assert.equal(ru.predefinedKanalEingebrochen(80, 325), true,
    'BEFUND: 24,6 % nicht-leere Buckets liefen bis Tag 569 still durch');
  assert.equal(ru.predefinedKanalEingebrochen(97, 325), true, 'knapp unter 30 % ist noch Befund');
});
test('T566-H2: der gesunde Stand geht DURCH (sonst waere der Waechter falsch-rot)', () => {
  assert.equal(ru.predefinedKanalEingebrochen(260, 325), false, '80 % = der gemessene 3.15.4-Stand');
  assert.equal(ru.predefinedKanalEingebrochen(98, 325), false, 'genau ueber der Schwelle');
  assert.equal(ru.predefinedKanalEingebrochen(325, 325), false);
  assert.equal(ru.predefinedKanalEingebrochen(0, 0), false, 'kein Aufruf = kein Anteil, kein Befund');
});

// Verdrahtung am OBJEKT: der Block ab der Wache bis zum Ende des if-Zweiges. Ein dateiweiter
// Treffer wuerde gruen bleiben, wenn ausgerechnet dieser Zweig seine Rot-Faerbung verliert.
function predefinedWachenBlock(src) {
  const start = src.indexOf('if (predefinedKanalEingebrochen(');
  assert.notEqual(start, -1, 'die Anteils-Wache ist aus dem Predefined-Kanal verschwunden');
  const rest = src.slice(start);
  const ende = rest.indexOf('\n  }');
  return ende === -1 ? rest : rest.slice(0, ende);
}
test('T566-H2: der Befund faerbt den Lauf rot (::error:: + exitCode im selben Zweig)', () => {
  const b = predefinedWachenBlock(SRC_RU);
  assert.match(b, /::error::/, 'ohne Annotation sieht Karl im Schritt-Log nichts');
  assert.match(b, /process\.exitCode = 1/,
    'BEFUND: der Zweig meldete nur und liess den Lauf gruen — genau das war folgenlos');
  assert.ok(!/predefinedNonEmpty\s*===\s*0/.test(b),
    'die alte Null-Wache darf nicht daneben stehen bleiben (zwei Schwellen an zwei Orten)');
  // Das eine legitime Vorkommen ist der Tag-510-Doppelausfall-Waechter (anderer Befund,
  // anderer Zweck: dort ist "beide Kanaele auf 0" genau die Frage). Mehr als eines waere
  // wieder die Zwei-Schwellen-Lage, gegen die T566-H2 gebaut ist.
  assert.equal((SRC_RU.replace(/\/\/[^\n]*/g, '').match(/predefinedNonEmpty\s*===\s*0/g) || []).length, 1,
    'erwartet: genau EIN Vorkommen, naemlich in beideYahooKanaeleLeer()');
  assert.match(SRC_RU.slice(SRC_RU.indexOf('function beideYahooKanaeleLeer'), SRC_RU.indexOf('function beideYahooKanaeleLeer') + 300),
    /predefinedNonEmpty === 0/, 'und zwar genau dort');
});

// Der bekannte Dauerdefekt ist die Bedingung dafuer, dass der neue Exit-Code-Konsument
// ueberhaupt etwas aussagt — aber er darf die Meldung nicht mitnehmen.
//
// ── T569-F3 (Review Tag 569): die Unterdrueckung war ZU BREIT und der Test war eine FALLE ──
// (a) Unterdrueckt wurde die ganze invalid-options-Klasse (EXCHANGE_SCREENER_SCHEMA_ERROR_RE).
//     Damit haette auch ein KUENFTIGER, ganz anderer Schema-Bruch des Exchange-Kanals still
//     unter dem "bekannten Dauerdefekt" mitgelaufen. Gebunden wird jetzt an den BELEGTEN Fall:
//     yahoo-finance2 3.15.4 wirft "Invalid options" und nennt dabei woertlich das verbotene
//     Zusatzfeld `query` (eigene Messung 04.08. gegen die installierte Version).
// (b) Die Zusicherung `EXCHANGE_KANAL_BEKANNT_DEFEKT === true` PINNTE den Ist-Zustand: wer den
//     Kanal repariert und den Schalter — wie es der Kommentar im Quelltext ausdruecklich
//     verlangt — auf false setzt, machte damit diesen Test ROT. Ein Waechter, der die eigene
//     Reparatur bestraft, wird beim naechsten Mal einfach geloescht. Der Wert wird deshalb
//     NICHT MEHR gepinnt. Ersatz ist keine Abschwaechung, sondern eine Abnahme-Mechanik: der
//     Schalter darf seine MESSGRUNDLAGE nicht ueberleben. Faellt die im Lock stehende
//     yahoo-finance2-Version von der gemessenen ab, muss der Schalter neu begruendet werden.
const GEMESSENE_YF_VERSION = '3.15.4';   // Stand der Messung vom 04.08.2026 (5er-Stichprobe)

test('T569-F3: der Dauerdefekt-Schalter darf seine Messgrundlage nicht ueberleben', () => {
  const fs = require('node:fs'), path = require('node:path');
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  const eintrag = lock.packages && lock.packages['node_modules/yahoo-finance2'];
  assert.ok(eintrag && eintrag.version, 'yahoo-finance2 fehlt im package-lock.json');
  if (eintrag.version !== GEMESSENE_YF_VERSION) {
    assert.equal(ru.EXCHANGE_KANAL_BEKANNT_DEFEKT, false,
      `package-lock.json haelt yahoo-finance2 ${eintrag.version}, gemessen wurde ${GEMESSENE_YF_VERSION}. ` +
      'Die Grundlage fuer "bekannter Dauerdefekt" ist damit weg: entweder den Schalter auf false ' +
      'setzen (dann ist ein Schema-Bruch wieder sofort rot) oder gegen die neue Version neu messen ' +
      'und GEMESSENE_YF_VERSION hier nachziehen.');
  }
});

test('T569-F3: nur der BELEGTE query-Fall unterdrueckt die Rot-Faerbung', () => {
  // Die echte Meldung der installierten 3.15.4 (gekuerzt, Struktur erhalten).
  const echt = '[yahooFinance.screener] Invalid options ("#/definitions/ScreenerOptions")\n' +
    '{"errors":[{"schemaPath":"#/definitions/ScreenerOptions/required","message":"Missing required properties",' +
    '"params":{"missing":["scrIds"]}},{"schemaPath":"#/definitions/ScreenerOptions/additionalProperties",' +
    '"message":"should NOT have additional properties","params":{"additionalProperties":{"query":{}}}}]}';
  assert.equal(ru.exchangeDefektIstDerBekannte(echt), true, 'der belegte Fall muss weiter durchgehen');
  assert.equal(ru.exchangeDefektIstDerBekannte('[yahooFinance.screener] Invalid options: scrIds must be a string'), false,
    'BEFUND: die breite invalid-options-Klasse deckte auch jeden KUENFTIGEN Schema-Bruch mit ab');
  assert.equal(ru.exchangeDefektIstDerBekannte('429 Too Many Requests'), false);
  assert.equal(ru.exchangeDefektIstDerBekannte(''), false);
  // Die Klassifikation "nicht weiter retryen" bleibt bewusst breit — sie spart 29 vergebliche
  // Boersen-Durchlaeufe und ist von der Rot-Frage getrennt.
  assert.equal(ru.EXCHANGE_SCREENER_SCHEMA_ERROR_RE.test('[yahooFinance.screener] Invalid options: scrIds must be a string'), true);
});

test('T569-F3: die Ausnahme im Quelltext haengt am belegten Fall, nicht nur am Schalter', () => {
  const i = SRC_RU.indexOf('exchangeScreenerFatal = true;');
  assert.notEqual(i, -1);
  const block = SRC_RU.slice(i - 1400, i + 500);
  assert.match(block, /::error::Custom-Exchange-Screener ist mit yahoo-finance2/,
    'die Annotation muss bleiben — sie ist die einzige Spur des Defekts');
  assert.match(SRC_RU.slice(i, i + 900), /EXCHANGE_KANAL_BEKANNT_DEFEKT && exchangeDefektIstDerBekannte\(error\)/,
    'BEFUND: die Ausnahme galt fuer die ganze invalid-options-Klasse, nicht fuer den belegten Fall');
});

// ── T566-H2, Verdrahtung im Workflow: der Alarm muss ANKOMMEN ──────────────────────
// Am OBJEKT gesucht (Block ab dem benannten Schritt/Job), nicht per Volltext: sonst haelt
// ein beliebiges zweites Vorkommen den Test gruen, waehrend die geschuetzte Stelle kippt.
function ymlBlock(anker, bis) {
  const start = YML.indexOf(anker);
  assert.notEqual(start, -1, 'Anker "' + anker + '" fehlt in daily-pull.yml');
  const rest = YML.slice(start + anker.length);
  const ende = rest.indexOf(bis);
  return ende === -1 ? rest : rest.slice(0, ende);
}
test('T566-H2: der Refresh-Schritt traegt eine id und reicht seinen Ausgang als Job-Ausgang weiter', () => {
  const schritt = ymlBlock('- name: Refresh Universe', '- name: ');
  assert.match(schritt, /id: refresh_universe\b/, 'ohne id ist der Ausgang nirgends abgreifbar');
  assert.match(schritt, /continue-on-error: true/,
    'das bleibt bewusst stehen: ein fallender prep-Job wuerde pull UND merge mitreissen');
  const halten = ymlBlock('- name: Entdeckungs-Ausgang festhalten', '- name: ');
  assert.match(halten, /if: always\(\)/, 'sonst faellt der Ausgang aus, sobald ein spaeterer prep-Schritt kippt');
  assert.match(halten, /outcome=\$\{\{ steps\.refresh_universe\.outcome \}\}/);
  // T569-F7: am OBJEKT (outputs-Block des prep-Jobs) statt dateiweit. Ein dateiweites
  // assert.match(YML, …) bleibt gruen, sobald die Zeichenkette IRGENDWO sonst auftaucht —
  // z. B. in einem Kommentar oder einem zweiten Job —, waehrend genau der geschuetzte
  // Job-Ausgang verschwindet. Dieselbe Bugklasse wie T566-H2/F1113 (retention-days).
  const prepOutputs = ymlBlock('  prep:', '\n    steps:');
  assert.match(prepOutputs, /^ +refresh_universe_outcome: \$\{\{ steps\.refresh_ausgang\.outputs\.outcome \}\}\s*$/m,
    'der Job-Ausgang fehlt im outputs-Block von prep — dann liest der Waechter-Job eine leere Zeichenkette und ist immer gruen');
});

test('T569-F7 Gegenprobe: eine Attrappe anderswo haelt den dateiweiten Pin gruen, den Objekt-Pin nicht', () => {
  // Der Befund selbst: geschuetzte Zeile raus, dieselbe Zeichenkette als Kommentar in einen
  // anderen Job — der alte, dateiweite Pin merkt nichts.
  const echt = '      refresh_universe_outcome: ${{ steps.refresh_ausgang.outputs.outcome }}';
  assert.ok(YML.includes(echt), 'Anker fehlt — dann prueft die Gegenprobe nichts');
  const mutiert = YML.replace(echt, '      # entfernt')
    .replace('  entdeckungs-waechter:', '  # merke: refresh_universe_outcome: ${{ steps.refresh_ausgang.outputs.outcome }}\n  entdeckungs-waechter:');
  assert.notEqual(mutiert, YML, 'Mutation griff nicht');
  assert.match(mutiert, /refresh_universe_outcome: \$\{\{ steps\.refresh_ausgang\.outputs\.outcome \}\}/,
    'alter dateiweiter Pin: unveraendert ein Treffer -> gruen (das IST der Befund)');
  const start = mutiert.indexOf('  prep:');
  const prepOutputs = mutiert.slice(start, mutiert.indexOf('\n    steps:', start));
  assert.doesNotMatch(prepOutputs, /^ +refresh_universe_outcome:/m,
    'der Objekt-Pin muss die Attrappe durchschauen');
});
test('T566-H2: der Waechter-Job faerbt rot und blockiert keinen Datenschritt', () => {
  const job = ymlBlock('  entdeckungs-waechter:', '\n  pull:');
  assert.match(job, /needs: prep/);
  assert.match(job, /if: always\(\)/, 'ohne always() liefe er bei rotem prep gar nicht');
  assert.match(job, /needs\.prep\.outputs\.refresh_universe_outcome/);
  assert.match(job, /exit 1/, 'ohne exit 1 bleibt der Lauf gruen — der ganze Befund');
  // T569-F7: `cancelled` und `skipped` liefen bis Tag 571 in denselben Zweig wie `success` —
  // ein abgebrochener oder uebersprungener prep-Job meldete woertlich "Entdeckungs-Kanaele
  // still". Genau der stille Ausgang, gegen den dieser Job gebaut ist. Drei Faelle, drei
  // Ausgaenge: failure = rot, cancelled/skipped = sichtbare Warnung, sonst = still.
  assert.match(job, /case "\$AUSGANG" in/,
    'BEFUND: ohne Fallunterscheidung ist "cancelled" dasselbe Signal wie "alles gut"');
  assert.match(job, /cancelled\|skipped\)/, 'die beiden Zwischenzustaende brauchen einen eigenen Zweig');
  assert.match(job, /::warning::/, 'ohne Annotation sieht Karl den Zwischenzustand nicht');
  assert.match(job, /\bfailure\)/, 'der rote Fall muss ein eigener case-Zweig sein');
  // Der Kern des Befunds: KEIN Datenjob darf an diesem Waechter haengen, sonst kostet ein
  // Entdeckungs-Ausfall den Tageslauf (genau der Grund, warum continue-on-error steht).
  for (const j of ['pull', 'merge', 'scoring']) {
    const jb = ymlBlock('\n  ' + j + ':', '\n    steps:');
    assert.ok(!/entdeckungs-waechter/.test(jb),
      'Job "' + j + '" haengt am Waechter — ein Entdeckungs-Ausfall wuerde den Datenlauf toeten');
  }
});

// ── DT-3 (Verifikation Exchange-Kanal 2026-08-04): die 0-Quotes-Warnung log ───────
// BEFUND, im Lauf 91606250192 woertlich mitgeschrieben:
//   [WARN] Exchanges with 0 quotes and no error (possible silent failure): NMS
// NMS HATTE einen Fehler — der Schema-Fatal-Zweig hat geworfen und den Kanal abgebrochen.
// Er zaehlte `pageErrors` nur nie hoch, also stand in der Statistik {0 Quotes, 0 Fehler}
// und der Reporter stufte ausgerechnet die geworfene Boerse als "still ausgefallen" ein.
// Ein Waechter, der auf einen lauten Fehler mit "kein Fehler" antwortet, verbrennt genau
// die Aufmerksamkeit, fuer die er gebaut wurde.
test('DT-3: der Schema-Fatal-Zweig zaehlt den Wurf als Seitenfehler (Anwesenheit am Zweig)', () => {
  // Am Objekt geschnitten, nicht dateiweit: ein `pageErrors++` irgendwo sonst in der Datei
  // (der normale Fehlerzweig hat eins) wuerde eine dateiweite Suche gruen halten.
  const start = SRC_RU.indexOf('if (EXCHANGE_SCREENER_SCHEMA_ERROR_RE.test(error)) {');
  assert.ok(start >= 0, 'Schema-Fatal-Zweig nicht gefunden');
  let tiefe = 0, i = SRC_RU.indexOf('{', start);
  const von = i;
  for (; i < SRC_RU.length; i++) {
    if (SRC_RU[i] === '{') tiefe++;
    else if (SRC_RU[i] === '}' && --tiefe === 0) break;
  }
  const zweig = SRC_RU.slice(von, i + 1);
  assert.match(zweig, /exchangeScreenerFatal\s*=\s*true/, 'falscher Zweig geschnitten');
  assert.match(zweig, /pageErrors\s*\+\+/,
    'der Schema-Fatal-Zweig zaehlt pageErrors nicht hoch — dann meldet die 0-Quotes-Warnung '
    + 'die geworfene Boerse als "0 quotes and no error" (Befund DT-3, Lauf 91606250192).');
});

test('DT-3: die Warnung nennt nur STILLE Ausfaelle (Verhalten, beide Richtungen)', () => {
  assert.deepEqual(ru.nullQuotenOhneFehler({ NMS: { totalQuotes: 0, pageErrors: 0 } }), ['NMS'],
    '0 Quotes ohne jeden Fehler ist der Fall, fuer den die Warnung gebaut ist — sie muss ihn nennen.');
  assert.deepEqual(ru.nullQuotenOhneFehler({ NMS: { totalQuotes: 0, pageErrors: 1 } }), [],
    'eine Boerse mit gezaehltem Fehler darf NICHT als "no error" gemeldet werden — das ist der '
    + 'Befund DT-3 in seiner Wirkung.');
  assert.deepEqual(ru.nullQuotenOhneFehler({ NMS: { totalQuotes: 250, pageErrors: 0 } }), [],
    'eine Boerse mit Quotes ist kein Null-Fall.');
  assert.deepEqual(ru.nullQuotenOhneFehler({
    NMS: { totalQuotes: 0, pageErrors: 1 }, LSE: { totalQuotes: 0, pageErrors: 0 },
  }), ['LSE'], 'aus einem gemischten Feld muss genau die stille Boerse herausfallen.');
});

test('DT-3: main() benutzt genau diese Funktion (kein zurueckgelassener Zweitpfad)', () => {
  assert.match(SRC_RU, /const zeroQuoteExchanges = nullQuotenOhneFehler\(exchangeStats\)/,
    'die 0-Quotes-Warnung in main() haengt nicht an der geprueften Funktion — dann prueft der '
    + 'Test oben einen Nebenpfad, waehrend der Lauf weiter den alten Ausdruck fuehrt.');
  assert.ok(!/\.filter\(\(\[_?,? ?\]?,? ?s\]\) => s\.totalQuotes === 0 && s\.pageErrors === 0\)/.test(SRC_RU),
    'der alte Inline-Ausdruck steht noch in der Datei — zwei Boeden an zwei Orten sind genau die '
    + 'Bugklasse, gegen die die Verdrahtungs-Waechter oben gebaut sind.');
});

console.log(`\nrefresh-universe.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
