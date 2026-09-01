'use strict';
/**
 * Waechter fuer den taeglichen Mitschnitt der Ticker-Landkarte.
 *
 * Der Mitschnitt hat eine Eigenschaft, die ihn heikler macht als normalen Code:
 * ein Fehler ist NICHT nachtraeglich reparierbar. NASDAQ und SEC ueberschreiben ihre
 * Verzeichnisse taeglich; ein Tag, der falsch oder gar nicht geschrieben wurde, ist weg.
 * Die Waechter zielen deshalb auf genau die Fehler, die still bleiben wuerden.
 *
 * Usage:  node tests/ticker-map.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const T = require('../scripts/snapshot-ticker-map.js');

let pass = 0, fail = 0;
const asyncChecks = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function checkAsync(name, fn) { asyncChecks.push([name, fn]); }

const NASDAQ_KOPF = 'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares';
const OTHER_KOPF = 'ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol';

const rohMit = (nasdaqZeilen, otherZeilen, sec) => ({
  nasdaq: [NASDAQ_KOPF, ...nasdaqZeilen, 'File Creation Time: 0728202614:00'].join('\n'),
  other: [OTHER_KOPF, ...otherZeilen, 'File Creation Time: 0728202614:00'].join('\n'),
  sec: JSON.stringify(sec || {}),
});

check('die ROHEN Kennzeichen bleiben erhalten, nicht das gefilterte Ergebnis', () => {
  // Der ganze Zweck: die Junk-Regel (isJunkSecurity) hat sich schon geaendert und wird es
  // wieder. Wer gefiltert archiviert, schreibt mit jeder Regel-Aenderung die Vergangenheit
  // um. Deshalb muessen ETF- und Test-Kennzeichen im Archiv stehen.
  const k = T.baueKarte(rohMit(
    ['AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N', 'TESTZ|Test Issue|Q|Y|N|100|N|N'],
    ['SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY'],
  ));
  assert.equal(k.get('AAPL').t, 'N');
  assert.equal(k.get('TESTZ').t, 'Y', 'Test-Kennzeichen muss erhalten bleiben');
  assert.equal(k.get('SPY').e, 'Y', 'ETF-Kennzeichen muss erhalten bleiben');
  assert.ok(k.has('TESTZ'), 'Junk darf NICHT weggefiltert werden — das entscheidet der spaetere Leser');
});

check('steht ein Symbol in beiden Dateien, gewinnt die echte Boerse', () => {
  const k = T.baueKarte(rohMit(
    ['XYZ|Doppel AG|Q|N|N|100|N|N'],
    ['XYZ|Doppel AG|N|XYZ|N|100|N|XYZ'],
  ));
  assert.equal(k.get('XYZ').b, 'N', 'otherlisted traegt NYSE/AMEX/ARCA und ist hier mehr wert');
});

check('die SEC ergaenzt die CIK, ohne den Namen zu ueberschreiben', () => {
  const k = T.baueKarte(rohMit(
    ['AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N'], [],
    { 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } },
  ));
  assert.equal(k.get('AAPL').c, '0000320193');
  assert.equal(k.get('AAPL').n, 'Apple Inc. - Common Stock', 'der Boersen-Name bleibt stehen');
});

check('SEC-Namen ohne Boersen-Eintrag bekommen einen eigenen Datensatz', () => {
  const k = T.baueKarte(rohMit([], [], { 0: { cik_str: 99, ticker: 'NURSEC', title: 'Nur bei der SEC' } }));
  assert.equal(k.get('NURSEC').b, 'SEC');
  assert.equal(k.get('NURSEC').c, '0000000099');
});

check('kaputtes SEC-JSON kippt nicht die ganze Karte — meldet den Ausfall aber nach aussen', () => {
  // F-CGPT-027 (P1-Welle 9, 10.08.2026): der Test nagelte bis dahin NUR fest, dass die
  // Karte nicht kippt — und zementierte damit das Stillschweigen. Genau daran haengt der
  // Schaden: ohne Meldung bleibt `fehlend` in run() leer, die Kompensationsstrecke
  // springt nicht an, und die Tageszeile behauptet quellenFehlend:[] ("alle Quellen da"),
  // waehrend tausende Symbole faelschlich als geaendert/weg in die Historie gehen.
  const probleme = [];
  const k = T.baueKarte({ nasdaq: [NASDAQ_KOPF, 'AAPL|Apple|Q|N|N|100|N|N'].join('\n'), other: '', sec: '{ kaputt' }, probleme);
  assert.equal(k.size, 1, 'die Boersen-Eintraege muessen trotzdem ankommen');
  assert.deepEqual(probleme, ['sec'], 'der Parse-Ausfall muss meldbar sein, sonst ist er von "SEC war da" nicht zu unterscheiden');
});

check('diff erkennt neu, weg und geaendert — und verwechselt sie nicht', () => {
  const alt = new Map([['A', { n: 'A AG', b: 'Q' }], ['B', { n: 'B AG', b: 'Q' }]]);
  const neu = new Map([['A', { n: 'A AG', b: 'Q' }], ['C', { n: 'C AG', b: 'N' }], ['B', { n: 'B AG NEU', b: 'Q' }]]);
  const d = T.diff(alt, neu);
  assert.deepEqual(Object.keys(d.hinzu), ['C']);
  assert.deepEqual(d.weg, []);
  assert.deepEqual(Object.keys(d.geaendert), ['B']);
});

check('eine Umbenennung ist "geaendert", kein Paar aus weg+neu', () => {
  // Sonst laese sich ein blosser Namenszusatz spaeter wie eine Delistung plus Neunotiz —
  // und genau danach sucht der "frueher finden"-Katalog.
  const alt = new Map([['A', { n: 'Alt AG', b: 'Q' }]]);
  const d = T.diff(alt, new Map([['A', { n: 'Neu SE', b: 'Q' }]]));
  assert.equal(d.weg.length, 0);
  assert.equal(Object.keys(d.hinzu).length, 0);
  assert.equal(d.geaendert.A.n, 'Neu SE');
});

check('Abspielen von Grundbild + Tageszeilen ergibt den Stand von damals', () => {
  // Die Kernfaehigkeit: "welche Ticker gab es am 15.?" muss exakt beantwortbar sein.
  const grundbild = { A: { n: 'A AG', b: 'Q' }, B: { n: 'B AG', b: 'Q' } };
  const zeilen = [
    { datum: '2026-07-10', hinzu: { C: { n: 'C AG', b: 'N' } }, weg: [], geaendert: {} },
    { datum: '2026-07-15', hinzu: {}, weg: ['A'], geaendert: { B: { n: 'B SE', b: 'Q' } } },
    { datum: '2026-07-20', hinzu: { D: { n: 'D AG', b: 'Q' } }, weg: [], geaendert: {} },
  ];
  const am12 = T.zustandAus(grundbild, zeilen, '2026-07-12');
  assert.deepEqual([...am12.keys()].sort(), ['A', 'B', 'C'], 'am 12. gab es A, B und C');
  const am15 = T.zustandAus(grundbild, zeilen, '2026-07-15');
  assert.deepEqual([...am15.keys()].sort(), ['B', 'C'], 'A ist am 15. weg');
  assert.equal(am15.get('B').n, 'B SE');
  const heute = T.zustandAus(grundbild, zeilen);
  assert.deepEqual([...heute.keys()].sort(), ['B', 'C', 'D']);
});

checkAsync('ein wiederholter Lauf ersetzt den Tag und diffed erneut gegen den Vortagesstand', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticker-map-rerun-'));
  try {
    const grundbildAb = '2026-09-01';
    const priorDate = '2026-09-14';
    const datum = '2026-09-15';
    const base = new Map();
    for (let i = 0; i < 5001; i++) {
      const symbol = 'S' + String(i).padStart(4, '0');
      base.set(symbol, { n: 'Base ' + symbol, b: 'NASDAQ:Q', e: 'N', t: 'N' });
    }
    // Die beiden anderen Quellen sind nicht leer gedummyt: otherlisted ueberschreibt
    // die Boerse eines stabilen Symbols, die SEC ergaenzt bei einem anderen die CIK.
    base.set('S4998', { n: 'Base S4998', b: 'N', e: 'N', t: 'N' });
    base.set('S4999', { n: 'Base S4999', b: 'NASDAQ:Q', e: 'N', t: 'N', c: '0000004999' });
    assert.equal(base.size, 5001, 'die Mengen-Untergrenze wird mit exakt 5.001 Symbolen geprueft');
    assert.deepEqual([...base.keys()].slice(0, 2), ['S0000', 'S0001']);
    assert.equal([...base.keys()].at(-1), 'S5000');

    const wrappedBase = {
      ab: grundbildAb,
      erzeugt: '2026-09-01T00:00:00.000Z',
      symbole: Object.fromEntries(base),
    };
    fs.writeFileSync(path.join(dir, '_grundbild.json'), JSON.stringify(wrappedBase), 'utf8');
    const priorUniverse = new Map(base);
    priorUniverse.delete('S0100');
    priorUniverse.set('S0101', { n: 'Prior correction', b: 'NASDAQ:Q', e: 'N', t: 'N' });
    priorUniverse.set('PRIORX', { n: 'Prior-only addition', b: 'NASDAQ:Q', e: 'N', t: 'N' });
    assert.equal(priorUniverse.size, 5001);
    const priorDiff = T.diff(base, priorUniverse);
    const priorRow = {
      datum: priorDate,
      summe: priorUniverse.size,
      quellenFehlend: [],
      hinzu: priorDiff.hinzu,
      weg: priorDiff.weg,
      geaendert: priorDiff.geaendert,
      pruefsumme: T.summeVon(priorUniverse.keys()),
    };
    assert.deepEqual(priorRow.hinzu, {
      PRIORX: { n: 'Prior-only addition', b: 'NASDAQ:Q', e: 'N', t: 'N' },
    });
    assert.deepEqual(priorRow.weg, ['S0100']);
    assert.deepEqual(priorRow.geaendert, {
      S0101: { n: 'Prior correction', b: 'NASDAQ:Q', e: 'N', t: 'N' },
    });
    fs.writeFileSync(path.join(dir, '2026-09.jsonl'), JSON.stringify(priorRow) + '\n', 'utf8');

    const firstUniverse = new Map(priorUniverse);
    firstUniverse.delete('S0000');
    firstUniverse.set('S0001', { n: 'First correction', b: 'NASDAQ:Q', e: 'N', t: 'N' });
    firstUniverse.set('FIRSTX', { n: 'First-only addition', b: 'NASDAQ:Q', e: 'N', t: 'N' });

    const finalUniverse = new Map(priorUniverse);
    finalUniverse.delete('S0002');
    finalUniverse.set('S0003', { n: 'Final correction', b: 'NASDAQ:Q', e: 'N', t: 'N' });
    finalUniverse.set('FINALX', { n: 'Final-only addition', b: 'NASDAQ:Q', e: 'N', t: 'N' });

    const asNasdaqText = (universe) => [
      NASDAQ_KOPF,
      ...[...universe].map(([symbol, row]) => [
        symbol, row.n, row.b.replace(/^NASDAQ:/, ''), row.t, 'N', '100', row.e, 'N',
      ].join('|')),
      'File Creation Time: 0915202600:00',
    ].join('\n');

    let nasdaqText = asNasdaqText(firstUniverse);
    const otherText = [
      OTHER_KOPF,
      'S4998|Base S4998|N|S4998|N|100|N|S4998',
      'File Creation Time: 0915202600:00',
    ].join('\n');
    const secText = JSON.stringify({
      0: { ticker: 'S4999', cik_str: 4999, title: 'SEC name must not replace NASDAQ name' },
    });
    const fetchedUrls = [];
    const fetchText = async (url) => {
      fetchedUrls.push(url);
      if (url === T.QUELLEN.nasdaq) return nasdaqText;
      if (url === T.QUELLEN.other) return otherText;
      if (url === T.QUELLEN.sec) return secText;
      throw new Error('unerwartete Quelle: ' + url);
    };

    const first = await T.run([], { dir, date: datum, fetchText });
    assert.deepEqual(Object.keys(first.hinzu), ['FIRSTX']);
    assert.deepEqual(first.weg, ['S0000']);
    assert.deepEqual(Object.keys(first.geaendert), ['S0001']);
    const afterFirst = fs.readFileSync(path.join(dir, '2026-09.jsonl'), 'utf8')
      .split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.deepEqual(afterFirst, [priorRow, first],
      'der erste Lauf muss den Vortag bewahren und genau eine neue Tageszeile schreiben');

    nasdaqText = asNasdaqText(finalUniverse);
    const second = await T.run([], { dir, date: datum, fetchText });
    assert.equal(second.summe, 5001);
    assert.deepEqual(second.quellenFehlend, []);
    assert.deepEqual(second.hinzu, {
      FINALX: { n: 'Final-only addition', b: 'NASDAQ:Q', e: 'N', t: 'N' },
    }, 'der zweite Diff muss gegen den Vortagesstand laufen, nicht gegen FIRSTX');
    assert.deepEqual(second.weg, ['S0002']);
    assert.deepEqual(second.geaendert, {
      S0003: { n: 'Final correction', b: 'NASDAQ:Q', e: 'N', t: 'N' },
    });
    assert.equal(second.pruefsumme, T.summeVon(finalUniverse.keys()),
      'die Tageszeile muss die exakte Schluesselmenge des zweiten Universums versiegeln');
    assert.equal(fetchedUrls.length, Object.keys(T.QUELLEN).length * 2,
      'beide Laeufe muessen je einen vollstaendigen Quellenzyklus ausfuehren');
    for (const url of Object.values(T.QUELLEN)) {
      assert.equal(fetchedUrls.filter((fetched) => fetched === url).length, 2,
        'jede Quelle muss in jedem Lauf genau einmal gelesen werden: ' + url);
    }

    const rows = fs.readFileSync(path.join(dir, '2026-09.jsonl'), 'utf8')
      .split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.equal(rows.length, 2, 'Vortag plus genau eine Zeile fuer den wiederholten Tag');
    assert.deepEqual(rows[0], priorRow, 'der Zweitlauf darf den vorhandenen Monat nicht abschneiden');
    assert.equal(rows.filter((row) => row.datum === datum).length, 1);
    assert.deepEqual(rows[1], second, 'fuer den aktuellen Tag darf nur der korrigierte Zweitlauf stehen');

    const replayed = T.zustandAus(wrappedBase, rows);
    const bySymbol = (map) => [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    assert.deepEqual(bySymbol(replayed), bySymbol(finalUniverse),
      'Grundbild plus ersetzte Tageszeile muss exakt den finalen Stand ergeben');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('eine kaputte Quelle schreibt KEINEN Tag, statt einen leeren zu schreiben', () => {
  // NASDAQ liefert bei Wartung schon mal eine HTML-Seite mit HTTP 200. Ein leer
  // geschriebener Tag saehe spaeter aus wie ein Massen-Delisting.
  const src = require('fs').readFileSync(require.resolve('../scripts/snapshot-ticker-map.js'), 'utf8');
  const m = src.match(/neu\.size < (\d+)/);
  assert.ok(m, 'die Untergrenze fehlt');
  assert.ok(Number(m[1]) >= 1000, 'eine Untergrenze von ' + m[1] + ' faengt eine Wartungsseite nicht');
  assert.ok(/Tag NICHT geschrieben/.test(src), 'der Abbruch muss benennen, was er verhindert');
});

check('eine kaputte Zeile in einer Monatsdatei kippt nicht das Abspielen', () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmap-'));
  fs.writeFileSync(path.join(dir, '2026-07.jsonl'),
    ['{"datum":"2026-07-01","hinzu":{},"weg":[],"geaendert":{}}', '{ kaputt', '',
      '{"datum":"2026-07-02","hinzu":{},"weg":[],"geaendert":{}}'].join('\n'));
  const z = T.alleZeilen(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(z.length, 2);
});

check('die Zeilen kommen chronologisch, egal wie das Dateisystem sortiert', () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmap2-'));
  fs.writeFileSync(path.join(dir, '2026-08.jsonl'), '{"datum":"2026-08-01","hinzu":{},"weg":[],"geaendert":{}}\n');
  fs.writeFileSync(path.join(dir, '2026-07.jsonl'), '{"datum":"2026-07-31","hinzu":{},"weg":[],"geaendert":{}}\n');
  const z = T.alleZeilen(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(z.map((x) => x.datum), ['2026-07-31', '2026-08-01']);
});

check('der Mitschnitt fasst picks-history NICHT an', () => {
  const src = require('fs').readFileSync(require.resolve('../scripts/snapshot-ticker-map.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/picks-history/.test(src));
});

check('der Tageslauf ruft den Mitschnitt auf UND committet ihn', () => {
  // Ohne diese beiden Zeilen laeuft das Skript nirgends oder schreibt in den Papierkorb
  // des Runners — beides sieht von aussen aus wie "es gibt halt keine Daten".
  const fs = require('fs'), path = require('path');
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
  assert.ok(wf.includes('node scripts/snapshot-ticker-map.js'), 'der Aufruf fehlt im Tageslauf');
  assert.ok(wf.includes('git add external-data/ticker-map/'), 'das Ergebnis wird nicht committet');
  const i = wf.indexOf('- name: Snapshot ticker map');
  assert.ok(i > 0);
  const bis = wf.indexOf('- name:', i + 10);
  // Kein continue-on-error: ein verpasster Tag ist nicht nachholbar und gehoert ins rote X.
  assert.ok(!/continue-on-error/.test(wf.slice(i, bis > 0 ? bis : undefined)),
    'ein verpasster Tag ist unwiederbringlich — der Schritt darf nicht stillschweigend scheitern');
  assert.ok(i < wf.indexOf('- name: Commit board-history vintage'),
    'der Schritt laeuft nach dem Commit — dann faengt der Commit ihn nicht');
});

// --- Ausfall EINER Quelle (Fund 29.07.2026) --------------------------------
// Am 29.07. lieferte www.sec.gov den GitHub-Laeufern zweimal HTTP 403, waehrend
// derselbe Aufruf mit demselben User-Agent von aussen 200 gab. Der Schritt kippte
// den gesamten scoring-Job: kein Score, kein Vintage, kein Export. Zwei Dinge muessen
// deshalb gelten und werden hier festgenagelt.
const fsMod = require('node:fs');
const pathMod = require('node:path');
const QUELLTEXT = fsMod.readFileSync(pathMod.join(__dirname, '..', 'scripts', 'snapshot-ticker-map.js'), 'utf8');
const nasdaqRoh = 'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot|ETF|NextShares\n'
  + 'AAPL|Apple Inc|Q|N|N|100|N|N\nMSFT|Microsoft Corp|Q|N|N|100|N|N\n';
const secRoh = JSON.stringify({
  0: { ticker: 'AAPL', cik_str: 320193, title: 'Apple Inc' },
  1: { ticker: 'MSFT', cik_str: 789019, title: 'Microsoft Corp' },
});

check('ohne SEC-Quelle entsteht trotzdem eine Karte aus den uebrigen Quellen', () => {
  const ohne = T.baueKarte({ nasdaq: nasdaqRoh, other: '', sec: '' });
  assert.equal(ohne.size, 2, 'die NASDAQ-Namen muessen erhalten bleiben');
  assert.equal(ohne.get('AAPL').n, 'Apple Inc');
  assert.equal(ohne.get('AAPL').c, undefined, 'die CIK kann ohne SEC nicht da sein — das ist der Punkt');
});

check('ohne CIK-Uebernahme wuerde der Tag die Historie verderben', () => {
  const mit = T.baueKarte({ nasdaq: nasdaqRoh, other: '', sec: secRoh });
  const ohne = T.baueKarte({ nasdaq: nasdaqRoh, other: '', sec: '' });
  const vorher = new Map([...mit.entries()]);
  // GEGENPROBE: genau das darf NICHT passieren — jedes Symbol gaelte als geaendert,
  // obwohl sich nichts geaendert hat ausser dass eine Quelle schwieg.
  const ohneUebernahme = Object.keys(T.diff(vorher, ohne).geaendert).length;
  assert.equal(ohneUebernahme, 2, 'ohne Uebernahme muessen ALLE Symbole faelschlich als geaendert gelten');
  // und so sieht es mit der Uebernahme aus, die run() macht:
  for (const [sym, d] of ohne) { const alt = vorher.get(sym); if (!d.c && alt && alt.c) d.c = alt.c; }
  assert.equal(Object.keys(T.diff(vorher, ohne).geaendert).length, 0,
    'mit Uebernahme darf KEIN Symbol als geaendert gelten');
});

// --- R1-SK-002 (Hard Review 2026-07-31): reine SEC-Symbole duerfen bei SEC-Ausfall
// nicht als "weg"/delisted gelten. baueKarte() erzeugt Datensaetze mit b:'SEC' NUR
// fuer Symbole, die in keiner NASDAQ-/otherlisted-Datei stehen. Fehlt roh.sec, fehlen
// diese Symbole komplett in `neu` -> diff() liest das als Delisting. Am 29.07.2026
// waren das 3.356 Symbole an einem Tag, dauerhaft in die Ticker-Historie geschrieben.
check('OHNE Uebernahme: ein SEC-Ausfall macht reine SEC-Symbole faelschlich zu "weg" (Repro)', () => {
  const vorher = new Map([
    ['AAPL', { n: 'Apple Inc', b: 'Q' }],
    ['NURSEC', { n: 'Nur bei der SEC', b: 'SEC', c: '0000000099' }],
  ]);
  const neuOhneSec = T.baueKarte({ nasdaq: nasdaqRoh, other: '', sec: '' }); // enthaelt nur AAPL/MSFT
  const d = T.diff(vorher, neuOhneSec);
  assert.ok(d.weg.includes('NURSEC'),
    'GEGENPROBE: ohne Uebernahme muss das reine SEC-Symbol faelschlich als weg/delisted gelten');
});
check('MIT Uebernahme (wie run() sie macht): reine SEC-Symbole bleiben bei SEC-Ausfall erhalten', () => {
  const vorher = new Map([
    ['AAPL', { n: 'Apple Inc', b: 'Q' }],
    ['NURSEC', { n: 'Nur bei der SEC', b: 'SEC', c: '0000000099' }],
  ]);
  const neu = T.baueKarte({ nasdaq: nasdaqRoh, other: '', sec: '' });
  // Exakt die Uebernahme, die run() bei fehlend.includes('sec') macht:
  for (const [sym, alt] of vorher) {
    if (alt.b === 'SEC' && !neu.has(sym)) neu.set(sym, alt);
  }
  const d = T.diff(vorher, neu);
  assert.ok(!d.weg.includes('NURSEC'), 'reines SEC-Symbol darf NICHT als weg gelten, nur weil die SEC-Quelle schwieg');
  assert.equal(d.weg.length, 0, 'echte Boersen-Symbole (AAPL) sind unveraendert vorhanden, MSFT fehlt hier bewusst nicht in vorher');
});
check('die Uebernahme ueberschreibt KEIN echtes Boersen-Delisting', () => {
  // Gegenprobe zur Gegenprobe: ein Symbol, das WIRKLICH von der Boerse verschwunden ist
  // (nicht b:'SEC'), muss trotz SEC-Ausfall weiterhin als "weg" gelten.
  const vorher = new Map([['DELISTED', { n: 'Echt weg AG', b: 'Q' }]]);
  const neu = T.baueKarte({ nasdaq: nasdaqRoh, other: '', sec: '' });
  for (const [sym, alt] of vorher) {
    if (alt.b === 'SEC' && !neu.has(sym)) neu.set(sym, alt);
  }
  const d = T.diff(vorher, neu);
  assert.ok(d.weg.includes('DELISTED'), 'ein echtes Boersen-Delisting darf die Uebernahme nicht verdecken');
});
check('run() uebernimmt reine SEC-Symbole wirklich aus dem Vortagesstand (Quelltext-Anker)', () => {
  const stelle = QUELLTEXT.slice(QUELLTEXT.indexOf('function run'));
  assert.match(stelle, /alt\.b === 'SEC' && !neu\.has\(sym\)/,
    'run() muss reine SEC-Datensaetze bei SEC-Ausfall in neu uebernehmen, sonst ist die obige Uebernahme nur ein Testartefakt');
});

check('run() uebernimmt die CIK wirklich aus dem Vortagesstand (Quelltext-Anker)', () => {
  const stelle = QUELLTEXT.slice(QUELLTEXT.indexOf('function run'));
  assert.match(stelle, /fehlend\.includes\('sec'\)/,
    'run() muss den SEC-Ausfall behandeln — sonst ist die Uebernahme oben nur ein Testartefakt');
  assert.match(stelle, /vorher\.get\(sym\)/,
    'zustandAus liefert eine Map — ein Objekt-Index waere still undefined und die Uebernahme wirkungslos');
  assert.match(stelle, /quellenFehlend/,
    'die Luecke muss in der Tageszeile stehen, sonst ist sie spaeter nicht erkennbar');
});

check('fallen ALLE Quellen aus, wird hart gestoppt statt leer geschrieben', () => {
  assert.match(QUELLTEXT, /fehlend\.length === Object\.keys\(QUELLEN\)\.length/,
    'ohne diesen Riegel wuerde ein Totalausfall eine leere Karte schreiben');
});

(async () => {
  for (const [name, fn] of asyncChecks) {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
  }
  console.log('\nticker-map: ' + pass + ' ok, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
