// P0-Haertung 3 (09.08.2026) — Builder-, Cache- und Cursor-Ehrlichkeit.
// Waechter zu sechs Befunden des harten Pruef-Sweeps (harter-pruef-sweep-8433206-verifikation.md).
// EINE Bugklasse: eine PFLICHTDATEI ist da, aber unlesbar — oder ein Arbeitsschritt faellt aus —
// und der Prozess behandelt das wie "gibt es noch nicht" / "ist erledigt", schreibt seinen
// Teilstand darueber und geht mit Exit 0 raus.
//
//   F-CGPT-020  scripts/build-secannual.js   korrupter SEC-Jahres-Akkustore = leere Merge-Basis
//   F-CGPT-021  scripts/build-krannual.js    3 erfolgreiche Jahre ersetzen die ganze Historie
//   F-CGPT-026  scripts/snapshot-ticker-map.js  korruptes Grundbild wird als Erstanlage ueberschrieben
//   F-CGPT-029  scripts/pull-insider-form4.js   korrupter Form-4-Cache -> Ein-Ticker-Teilstand
//   F-CGPT-030  scripts/pull-insider-form4-daily.js  Cursor rueckt ohne Verarbeitung vor
//   F-CGPT-033  scripts/check-pull-stats.js   Historie wird trotz Parsefehler durch heute ersetzt
//
// Kein Netz, keine Frameworks: temporaere Verzeichnisse, eingespeister Fake-Abruf.
// Run: node tests/p0-haertung3-builder-cache-cursor.test.js   (Exit 0/1)
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ladeMergeBasis, run: secannualRun } = require('../scripts/build-secannual.js');
const krannual = require('../scripts/build-krannual.js');
const { liesGrundbild, rotiereGrundbild } = require('../scripts/snapshot-ticker-map.js');
const { ladeForm4Cache } = require('../scripts/pull-insider-form4.js');
const { _internals: f4d, main: form4DailyMain } = require('../scripts/pull-insider-form4-daily.js');
const { ladeHistorie, runCli: pullStatsRunCli } = require('../scripts/check-pull-stats.js');

const REPO = path.join(__dirname, '..');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p0h3-'));
const neu = (name, inhalt) => { const p = path.join(TMP, name); fs.writeFileSync(p, inhalt); return p; };
const fehlt = (name) => path.join(TMP, name);

// ── F-CGPT-020: Merge-Basis von build-secannual ───────────────────────────────────────

test('F-020 fehlende sec-secannual.json ist eine echte Erstanlage -> leere Basis', () => {
  assert.deepEqual(ladeMergeBasis(fehlt('gibt-es-nicht.json')), {});
});

test('F-020 korrupter Akkustore wirft, statt als leere Merge-Basis durchzugehen', () => {
  const p = neu('sec-korrupt.json', '{"AAPL":{"cik":"000');
  assert.throws(() => ladeMergeBasis(p), /unlesbar/);
});

test('F-020 gesunder Store kommt vollstaendig als Merge-Basis zurueck', () => {
  const p = neu('sec-gut.json', JSON.stringify({ AAPL: { cik: '1' }, MU: { cik: '2' } }));
  assert.deepEqual(Object.keys(ladeMergeBasis(p)).sort(), ['AAPL', 'MU']);
});

// ── F-CGPT-021: build-krannual ersetzt nie eine laengere Historie ──────────────────────
// Fake-Abruf: die genannten Jahre antworten, alle anderen laufen auf einen Netzfehler.

function fakeDart(guteJahre) {
  return async (u) => {
    const jahr = (String(u).match(/bsns_year=(\d{4})/) || [])[1];
    if (!guteJahre.includes(jahr)) throw new Error('ECONNRESET ' + jahr);
    return {
      status: '000',
      list: [
        { account_id: 'ifrs-full_Revenue', thstrm_amount: '1000' + jahr },
        { account_id: 'dart_OperatingIncomeLoss', thstrm_amount: '200' + jahr },
      ],
    };
  };
}
const ALT_STORE = {
  '000660.KS': { corpCode: '00164779', nfy: 2024, annualOpInc: new Array(10).fill({ value: 1 }), annualRev: new Array(10).fill({ value: 2 }) },
  'ALT.KS': { corpCode: '00000000', nfy: 2024, annualOpInc: [{ value: 9 }], annualRev: [{ value: 9 }] },
};
process.env.OPENDART_KEY = process.env.OPENDART_KEY || 'TESTKEY';

async function krannualTests() {
  await atest('F-021 Teil-Abruf (3 von 11 Jahren) ersetzt die Historie NICHT und wird laut', async () => {
    const p = neu('kr-teil.json', JSON.stringify(ALT_STORE));
    await assert.rejects(
      () => krannual.main({ getJSON: fakeDart(['2015', '2016', '2017']), out: p }),
      /unvollstaendig/);
    const danach = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(danach['000660.KS'].annualOpInc.length, 10, 'die zehnjaehrige Serie muss stehen bleiben');
    assert.ok(danach['ALT.KS'], 'ein Altname darf nicht aus dem Store fallen');
  });

  await atest('F-021 vollstaendiger Abruf aktualisiert den Ticker und laesst Altnamen stehen', async () => {
    const p = neu('kr-voll.json', JSON.stringify(ALT_STORE));
    const alleJahre = [];
    for (let y = 2015; y < new Date().getFullYear(); y++) alleJahre.push(String(y));
    await krannual.main({ getJSON: fakeDart(alleJahre), out: p });
    const danach = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(danach['000660.KS'].annualOpInc.length, alleJahre.length, 'frische Serie geschrieben');
    assert.ok(danach['ALT.KS'], 'Altname bleibt (Merge, kein Neu-Write)');
  });

  await atest('F-021 korrupter Store wirft VOR dem Schreiben — die Datei bleibt unangetastet', async () => {
    const p = neu('kr-korrupt.json', '{"000660.KS":{"corpCode"');
    await assert.rejects(() => krannual.main({ getJSON: fakeDart(['2015']), out: p }), /unlesbar/);
    assert.equal(fs.readFileSync(p, 'utf8'), '{"000660.KS":{"corpCode"');
  });

  await atest('F-021 fehlende Datei ist eine echte Erstanlage', async () => {
    const p = fehlt('kr-neu.json');
    const alleJahre = [];
    for (let y = 2015; y < new Date().getFullYear(); y++) alleJahre.push(String(y));
    await krannual.main({ getJSON: fakeDart(alleJahre), out: p });
    assert.ok(JSON.parse(fs.readFileSync(p, 'utf8'))['000660.KS']);
  });

  // ── R609-2: OpenDART-Status-Whitelist ───────────────────────────────────────────────
  // BEFUND (Review Tag 608): `if (j.status !== '000' || !Array.isArray(j.list)) continue;`
  // behandelte JEDEN Nicht-000-Status als legitimen "kein Abschluss fuer dieses Jahr"-Skip.
  // 020 (Rate-Limit/Tageskontingent), 800 (Wartung) und 010 (ungueltiger Key) liefen damit
  // als Datenaussage durch: der Lauf zaehlte keinen Fehler, blieb gruen und ersetzte die
  // gepflegte Historie durch den Teilstand. Nur '013' ist der echte Leerbefund.
  // Fake-Abruf mit Status je Jahr — HTTP 200, nur die Nutzlast sagt "nein".
  function dartMitStatus(statusProJahr) {
    return async (u) => {
      const jahr = (String(u).match(/bsns_year=(\d{4})/) || [])[1];
      const st = statusProJahr[jahr] || '000';
      if (st !== '000') return { status: st, message: 'Testfall ' + st };
      return {
        status: '000',
        list: [
          { account_id: 'ifrs-full_Revenue', thstrm_amount: '1000' + jahr },
          { account_id: 'dart_OperatingIncomeLoss', thstrm_amount: '200' + jahr },
        ],
      };
    };
  }

  await atest('R609-2 Status 020 (Rate-Limit) mitten im Lauf erhaelt den Ticker und wird rot', async () => {
    const p = neu('kr-020.json', JSON.stringify(ALT_STORE));
    // Ein einziges Jahr laeuft ins Tageskontingent — alle anderen liefern sauber.
    await assert.rejects(
      () => krannual.main({ getJSON: dartMitStatus({ 2019: '020' }), out: p }),
      /unvollstaendig/,
      'ein Rate-Limit ist keine Datenaussage: der Lauf muss rot werden, nicht als vollstaendig gelten');
    const danach = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(danach['000660.KS'].annualOpInc.length, 10,
      'die zehnjaehrige Serie wurde durch einen Teilstand ersetzt — genau der Befund');
    assert.ok(danach['ALT.KS'], 'ein Altname darf nicht aus dem Store fallen');
  });

  await atest('R609-2 dasselbe fuer 800 (Wartung) und 010 (ungueltiger Key)', async () => {
    for (const st of ['800', '010']) {
      const p = neu('kr-' + st + '.json', JSON.stringify(ALT_STORE));
      await assert.rejects(
        () => krannual.main({ getJSON: dartMitStatus({ 2019: st }), out: p }),
        /unvollstaendig/, 'Status ' + st + ' ging als legitimer Jahres-Skip durch');
      assert.equal(JSON.parse(fs.readFileSync(p, 'utf8'))['000660.KS'].annualOpInc.length, 10);
    }
  });

  await atest('R609-2 Gegenprobe: 013 bleibt ein legitimer Skip und laeuft gruen durch', async () => {
    // Die gueltige Form muss DURCHGEHEN, sonst ist die Whitelist nur eine Blockade:
    // ein einzelnes Jahr ohne Abschluss ist Alltag (Neulisting, Rumpfgeschaeftsjahr).
    const p = neu('kr-013.json', JSON.stringify(ALT_STORE));
    await krannual.main({ getJSON: dartMitStatus({ 2019: '013' }), out: p });
    const danach = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.ok(danach['000660.KS'].annualOpInc.length >= 3, 'der Ticker wurde regulaer aktualisiert');
    assert.ok(danach['ALT.KS'], 'Altname bleibt');
  });
}

// ── F-CGPT-026: Grundbild der Ticker-Landkarte ────────────────────────────────────────

test('F-026 fehlendes Grundbild = Erstanlage (null), korruptes wirft', () => {
  assert.equal(liesGrundbild(fehlt('kein-grundbild.json')), null);
  const p = neu('_grundbild-korrupt.json', '{"ab":"2026-07-01","symbole":{"AAA"');
  assert.throws(() => liesGrundbild(p), /unlesbar/);
});

test('F-026 rotiereGrundbild uebergeht ein korruptes Bild nicht mehr still', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'tm-'));
  fs.writeFileSync(path.join(dir, '_grundbild.json'), '{"ab":"2026-07-01","symbole":{"AAA"');
  assert.throws(() => rotiereGrundbild(new Map([['AAA', { n: 'x' }]]), '2026-08-09', dir, true), /unlesbar/);
});

test('F-026 ohne Grundbild bleibt die Rotation ein stilles null (das ist die Erstanlage)', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'tm2-'));
  assert.equal(rotiereGrundbild(new Map(), '2026-08-09', dir, true), null);
});

// ── F-CGPT-029: Form-4-Cache ──────────────────────────────────────────────────────────

test('F-029 fehlender Form-4-Cache = Erstanlage, korrupter wirft', () => {
  assert.deepEqual(ladeForm4Cache(fehlt('kein-cache.json')), {});
  const p = neu('form4-korrupt.json', '{"byTicker":{"AAPL":{"transa');
  assert.throws(() => ladeForm4Cache(p), /unlesbar/);
});

test('F-029 gesunder Cache kommt mit byTicker zurueck', () => {
  const p = neu('form4-gut.json', JSON.stringify({ byTicker: { AAPL: { transactions: [] } } }));
  assert.deepEqual(Object.keys(ladeForm4Cache(p).byTicker), ['AAPL']);
});

// ── F-CGPT-030: Tages-Cursor rueckt nur bei echter Verarbeitung vor ────────────────────

const TAG = '20260805';
const JETZT = Date.parse('2026-08-06T06:00:00Z');   // Tag ist 1 Tag alt

test('F-030 fehlender Index eines FRISCHEN Werktags haelt den Cursor an', () => {
  assert.equal(f4d.cursorDarfVor({ contiguous: true, notFound: true, date: TAG, jetzt: JETZT }), false);
});

test('F-030 fehlender Index eines ALTEN Werktags (Feiertag) laesst den Cursor vor', () => {
  const spaeter = Date.parse('2026-08-12T06:00:00Z');   // 7 Tage spaeter
  assert.equal(f4d.cursorDarfVor({ contiguous: true, notFound: true, date: TAG, jetzt: spaeter }), true);
});

test('F-030 Karenzgrenze: genau am Grenztag kippt die Entscheidung', () => {
  const knappDrunter = Date.parse('2026-08-05T00:00:00Z') + (f4d.INDEX_KARENZ_TAGE * 86400000) - 1000;
  const knappDrueber = Date.parse('2026-08-05T00:00:00Z') + (f4d.INDEX_KARENZ_TAGE * 86400000) + 1000;
  assert.equal(f4d.indexNachreichbar(TAG, knappDrunter), true);
  assert.equal(f4d.indexNachreichbar(TAG, knappDrueber), false);
});

test('F-030 ein Tag mit Abruffehlern gilt nicht als indiziert', () => {
  assert.equal(f4d.cursorDarfVor({ contiguous: true, notFound: false, date: TAG, jetzt: JETZT, tagesFehler: 1 }), false);
});

test('F-030 ein vorzeitig abgebrochener Tag (SAMPLE_LIMIT) gilt nicht als indiziert', () => {
  assert.equal(f4d.cursorDarfVor({ contiguous: true, notFound: false, date: TAG, jetzt: JETZT, tagVollstaendig: false }), false);
});

test('F-030 ein sauber abgearbeiteter Tag rueckt den Cursor vor', () => {
  assert.equal(f4d.cursorDarfVor({ contiguous: true, notFound: false, date: TAG, jetzt: JETZT, tagesFehler: 0, tagVollstaendig: true }), true);
});

test('F-030 eine fruehere Luecke im Lauf sperrt jeden spaeteren Tag (Cursor = "bis hier LUECKENLOS")', () => {
  assert.equal(f4d.cursorDarfVor({ contiguous: false, notFound: false, date: TAG, jetzt: JETZT, tagesFehler: 0 }), false);
  assert.equal(f4d.cursorDarfVor({ contiguous: false, notFound: true, date: TAG, jetzt: Date.parse('2026-09-01T00:00:00Z') }), false);
});

// ── F-CGPT-033: Pull-Stats-Historie ───────────────────────────────────────────────────

test('F-033 fehlende history.json ist der erste Lauf -> leere Historie', () => {
  assert.deepEqual(ladeHistorie(fehlt('keine-history.json')), []);
});

test('F-033 korrupte Historie wirft, statt durch den heutigen Einzelpunkt ersetzt zu werden', () => {
  const p = neu('history-korrupt.json', '{kaputt');
  assert.throws(() => ladeHistorie(p), /unlesbar/);
  assert.equal(fs.readFileSync(p, 'utf8'), '{kaputt', 'nichts ueberschrieben');
});

test('F-033 auch eine Historie in falscher Form (kein Array) wirft', () => {
  assert.throws(() => ladeHistorie(neu('history-objekt.json', '{"asOf":"2026-08-09"}')), /kein Array/);
  assert.throws(() => ladeHistorie(neu('history-null.json', 'null')), /kein Array/);
});

test('F-033 gesunde Historie kommt unveraendert zurueck', () => {
  const p = neu('history-gut.json', JSON.stringify([{ asOf: '2026-08-08', yahooOk: 10 }]));
  assert.equal(ladeHistorie(p).length, 1);
});

// ── R609-4: dieselben drei Faelle am ECHTEN Einstiegspunkt ────────────────────────────
// Die Proben oben pruefen die LESER. Was sie nicht pruefen: ob der Wurf auch aus dem
// Einstiegspunkt herauskommt. Genau dort ist die Bugklasse rueckfaellig — es genuegt
// EIN spaeter eingebautes `try { ... } catch (_) {}` um den Aufruf herum, und der
// gehaertete Leser ist wieder wirkungslos, waehrend alle Leser-Proben gruen bleiben.
// Diese drei Faelle werden dann und nur dann rot.
//
// ABWEICHUNG mit Absicht: der korrupte Inhalt wird dem echten Leser am echten Repo-Pfad
// untergeschoben (fs-Klammer), statt die echte Datei auf Platte zu beschaedigen.
// sec-form4-cache.json ist 42 MB, pull-stats/history.json ist git-getrackt — ein
// abgebrochener oder gekillter Testlauf haette sie korrupt zurueckgelassen, und ein
// Mutant (Guard entfernt) haette sie echt ueberschrieben. Die Klammer laesst dieselbe
// Datei-vorhanden-aber-unlesbar-Situation entstehen und BLOCKIERT zusaetzlich jeden
// Schreibversuch auf den Zielpfad, statt ihn nur nachtraeglich festzustellen.
const KORRUPT = '{"AAPL":{"cik":"000';

async function mitKorrupterDatei(zielPfad, fn) {
  const echt = {
    readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync, openSync: fs.openSync,
  };
  const schreibVersuche = [];
  // Prefix-Vergleich, nicht Gleichheit: writeFileAtomic schreibt erst nach
  // "<ziel>.tmp.<pid>.<n>" und benennt dann um — beide Wege gehoeren geblockt.
  const trifft = (p) => String(p).startsWith(zielPfad);
  const blocken = (p) => { schreibVersuche.push(String(p)); throw new Error('TEST: Schreibversuch auf ' + p + ' geblockt'); };
  fs.readFileSync = (p, ...r) => (trifft(p) ? KORRUPT : echt.readFileSync(p, ...r));
  fs.writeFileSync = (p, ...r) => (trifft(p) ? blocken(p) : echt.writeFileSync(p, ...r));
  fs.openSync = (p, ...r) => (trifft(p) ? blocken(p) : echt.openSync(p, ...r));
  fs.renameSync = (a, b) => (trifft(b) ? blocken(b) : echt.renameSync(a, b));
  let fehler = null;
  try { await fn(); } catch (e) { fehler = e; }
  finally { Object.assign(fs, echt); }
  return { fehler, schreibVersuche };
}

function pruefeE2E(name, ziel, fehler, schreibVersuche) {
  assert.deepEqual(schreibVersuche, [],
    name + ': es wurde auf die Pflichtdatei geschrieben, obwohl sie unlesbar war — '
    + 'genau das Ueberschreiben, gegen das der Leser gebaut ist');
  assert.ok(fehler, name + ': der Einstiegspunkt ist NICHT gefallen — jemand faengt den Wurf ab, '
    + 'der Lauf endet mit Exit 0 ueber einer unlesbaren Pflichtdatei');
  assert.match(String(fehler.message), /unlesbar/,
    name + ': gefallen, aber aus einem anderen Grund als der korrupten Datei ('
    + fehler.message + ') — die Probe belegt dann nichts');
  assert.ok(String(fehler.message).includes(ziel),
    name + ': die Meldung nennt die Datei nicht — bei mehreren Pflichtdateien unbrauchbar');
}

async function e2eTests() {
  await atest('F-020 E2E: korrupter Store faellt durch build-secannual run() durch', async () => {
    const ziel = path.join(REPO, 'external-data', 'sec-secannual.json');
    const { fehler, schreibVersuche } = await mitKorrupterDatei(ziel, () => secannualRun());
    pruefeE2E('F-020', ziel, fehler, schreibVersuche);
  });

  await atest('F-029 E2E: korrupter Form-4-Cache faellt durch main() des Daily-Pulls durch', async () => {
    const ziel = path.join(REPO, 'external-data', 'sec-form4-cache.json');
    const { fehler, schreibVersuche } = await mitKorrupterDatei(ziel, () => form4DailyMain());
    pruefeE2E('F-029', ziel, fehler, schreibVersuche);
  });

  await atest('F-033 E2E: korrupte Historie beendet runCli() mit Exit != 0', async () => {
    const ziel = path.join(REPO, 'pull-stats', 'history.json');
    const codes = [], gemeldet = [];
    // runCli FAENGT den Wurf bewusst ab — es kommt hier also nicht auf einen
    // durchgereichten Fehler an, sondern auf den Exit-Code, der daraus wird.
    const { schreibVersuche } = await mitKorrupterDatei(ziel,
      () => pullStatsRunCli(undefined, { exit: (c) => codes.push(c), error: (m) => gemeldet.push(String(m)) }));
    assert.deepEqual(schreibVersuche, [],
      'F-033: die Historie wurde ueberschrieben, obwohl sie unlesbar war');
    assert.deepEqual(codes, [1],
      'F-033: runCli endet nicht mit Exit 1 (Codes: ' + JSON.stringify(codes)
      + ') — ein Waechter, der ueber einer unlesbaren Historie Erfolg meldet, ist keiner');
    assert.ok(gemeldet.some((m) => /::error::/.test(m) && /unlesbar/.test(m)),
      'F-033: kein ::error:: mit Grund — im Actions-Log ist der Ausfall dann nicht auffindbar: '
      + JSON.stringify(gemeldet));
  });
}

krannualTests().then(e2eTests).then(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n' + pass + ' ok, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
});
