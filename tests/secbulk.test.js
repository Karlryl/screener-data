'use strict';
/**
 * Waechter fuer den Bulk-Weg (Phase 4.1).
 *
 * Der ZIP-Leser bekommt hier ein ECHTES, selbst gebautes Archiv vorgesetzt — kein Mock.
 * Grund: die Fehler, die dieser Code machen kann, sind Byte-Versaetze. Ein Mock, der
 * Offsets zurueckgibt, statt sie zu berechnen, wuerde genau die Klasse Fehler durchlassen,
 * gegen die der Test gebaut ist.
 *
 * Usage:  node tests/secbulk.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const zip = require('../lib/zip-stream.js');
// baueZip stand bis 2026-08-30 hier inline. Nach tests/helpers/zip-fixture.js
// gehoben, weil tests/sec-pit.test.js dieselbe Fixture braucht (ZIP-Schicht von
// lib/sec-pit.js) und diese Datei sich nicht requiren laesst — sie endet mit
// process.exit. Inhalt unveraendert uebernommen.
const { baueZip } = require('./helpers/zip-fixture.js');
const { baueBloecke, cikKarte } = require('../scripts/fetch-secbulk.js');
const { extractSecSeries } = require('../merge-sec-xbrl.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const DATEIEN = [
  { name: 'CIK0000320193.json', inhalt: JSON.stringify({ entityName: 'Apple' }) },
  { name: 'CIK0000789019.json', inhalt: JSON.stringify({ entityName: 'Microsoft' }), zusatzLen: 17 },
  { name: 'CIK0001045810.json', inhalt: JSON.stringify({ entityName: 'Nvidia' }), zusatzLen: 4 },
];

check('Verzeichnis lesen und jeden Eintrag entpacken', () => {
  const buf = baueZip(DATEIEN);
  const z = zip.leseVerzeichnisZeiger(buf.subarray(Math.max(0, buf.length - zip.EOCD_MAX_SUCHE)), buf.length);
  assert.equal(z.anzahl, 3);
  const eintraege = zip.leseVerzeichnis(buf.subarray(z.cdOffset, z.cdOffset + z.cdGroesse), z.anzahl);
  assert.deepEqual(eintraege.map((e) => e.name), DATEIEN.map((d) => d.name));
  for (let i = 0; i < eintraege.length; i++) {
    const raus = zip.entpackeEintrag(buf.subarray(eintraege[i].lfhOffset), eintraege[i]);
    assert.equal(raus.toString('utf8'), DATEIEN[i].inhalt, DATEIEN[i].name + ' kam falsch zurueck');
  }
});

check('ein Zusatzfeld im lokalen Kopf verschiebt die Daten NICHT', () => {
  // Der eigentliche Zweck des vorigen Tests, hier explizit: Eintrag 2 traegt 17 Byte Zusatz,
  // die NUR im lokalen Kopf stehen. Wer sie ignoriert, liest 17 Byte versetzt — und bekommt
  // von inflateRaw Datenmuell oder einen Fehler, nie eine stille Falschantwort.
  const buf = baueZip(DATEIEN);
  const z = zip.leseVerzeichnisZeiger(buf.subarray(buf.length - zip.EOCD_MAX_SUCHE < 0 ? 0 : buf.length - zip.EOCD_MAX_SUCHE), buf.length);
  const e = zip.leseVerzeichnis(buf.subarray(z.cdOffset, z.cdOffset + z.cdGroesse), z.anzahl)[1];
  assert.equal(zip.entpackeEintrag(buf.subarray(e.lfhOffset), e).toString('utf8'), DATEIEN[1].inhalt);
});

check('ein Kommentar hinter dem EOCD bricht die Suche nicht', () => {
  const buf = baueZip(DATEIEN, { kommentar: 'x'.repeat(300) });
  const z = zip.leseVerzeichnisZeiger(buf.subarray(0), buf.length);
  assert.equal(z.anzahl, 3);
});

check('gespeicherte (unkomprimierte) Eintraege werden auch gelesen', () => {
  const buf = baueZip(DATEIEN, { gespeichert: true });
  const z = zip.leseVerzeichnisZeiger(buf.subarray(0), buf.length);
  const e = zip.leseVerzeichnis(buf.subarray(z.cdOffset, z.cdOffset + z.cdGroesse), z.anzahl)[0];
  assert.equal(zip.entpackeEintrag(buf.subarray(e.lfhOffset), e).toString('utf8'), DATEIEN[0].inhalt);
});

check('ein unvollstaendig gelesenes Verzeichnis wirft, statt zu wenige Firmen zu liefern', () => {
  const buf = baueZip(DATEIEN);
  const z = zip.leseVerzeichnisZeiger(buf.subarray(0), buf.length);
  const halb = buf.subarray(z.cdOffset, z.cdOffset + Math.floor(z.cdGroesse / 2));
  assert.throws(() => zip.leseVerzeichnis(halb, z.anzahl), /unvollstaendig/);
});

check('Bloecke fassen Nachbarn zusammen und respektieren die Luecken-Grenze', () => {
  const e = (off, gr) => ({ lfhOffset: off, compressedSize: gr, name: 'x' });
  // zwei dicht beieinander, einer weit weg
  const b = baueBloecke([e(0, 100), e(5000, 100), e(50_000_000, 100)], 1024 * 1024, 48 * 1024 * 1024);
  assert.equal(b.length, 2, 'erwartet 2 Bloecke, bekam ' + b.length);
  assert.equal(b[0].eintraege.length, 2);
  assert.equal(b[1].eintraege.length, 1);
});

check('die Block-Obergrenze wird eingehalten', () => {
  const e = (off) => ({ lfhOffset: off, compressedSize: 1000, name: 'x' });
  const viele = Array.from({ length: 50 }, (_, i) => e(i * 100_000));
  const b = baueBloecke(viele, 1024 * 1024, 1024 * 1024);
  for (const blk of b) assert.ok(blk.bis - blk.von + 1 <= 1024 * 1024, 'Block zu gross: ' + (blk.bis - blk.von + 1));
  assert.equal(b.reduce((s, x) => s + x.eintraege.length, 0), 50, 'kein Eintrag darf verloren gehen');
});

check('Bloecke bleiben korrekt, wenn die Eintraege unsortiert hereinkommen', () => {
  // readdirSync liefert keine Offset-Ordnung — kaeme baueBloecke ohne eigene Sortierung aus,
  // waere jeder Block ein Einzelabruf und der ganze Sparmechanismus wirkungslos.
  const e = (off) => ({ lfhOffset: off, compressedSize: 100, name: 'x' });
  const b = baueBloecke([e(3000), e(0), e(6000), e(9000)], 1024 * 1024, 48 * 1024 * 1024);
  assert.equal(b.length, 1);
  assert.equal(b[0].von, 0);
});

check('mehrere Ticker auf einer CIK werden gebuendelt, nicht doppelt geholt', () => {
  // 1.471 CIKs tragen mehrere Ticker (GOOGL/GOOG). Wuerde je Ticker geholt, waeren das
  // ~1.471 unnoetige Abrufe — und der Treffer-Zaehler gegen die CIK-Menge waere falsch.
  const tmap = new Map([['GOOGL', { cik: '1652044' }], ['GOOG', { cik: '0001652044' }], ['AAPL', { cik: 320193 }]]);
  const { proCik, ohneCik } = cikKarte(['GOOGL', 'GOOG', 'AAPL', 'XXNOPE'], tmap);
  assert.equal(proCik.size, 2);
  assert.deepEqual(proCik.get('0001652044').sort(), ['GOOG', 'GOOGL']);
  assert.deepEqual(proCik.get('0000320193'), ['AAPL']);
  assert.equal(ohneCik, 1);
});

check('der Bulk-Abruf fasst die LIVE-Scoringdatei nicht an', () => {
  // Das Urteil vom 28.07. haelt W_ROIC_STABILITY bei 0 — die Bulk-Daten sind Berichtsbasis,
  // keine Scoring-Quelle. Wer das aufweicht, muss diesen Test bewusst aendern.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'fetch-secbulk.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/sec-secannual\.json/.test(src), 'fetch-secbulk.js darf sec-secannual.json nicht schreiben');
});

// --- Verlaesslichkeits-Bericht -------------------------------------------
const R = require('../scripts/roic-reliability.js');

check('Spearman liefert bei perfekter und bei umgekehrter Ordnung +-1', () => {
  assert.equal(R.spearman([1, 2, 3, 4], [10, 20, 30, 40]).toFixed(3), '1.000');
  assert.equal(R.spearman([1, 2, 3, 4], [40, 30, 20, 10]).toFixed(3), '-1.000');
  // rangbasiert: eine monotone, nichtlineare Verzerrung darf nichts aendern
  assert.equal(R.spearman([1, 2, 3, 4], [1, 4, 9, 16]).toFixed(3), '1.000');
});

check('die Paarungsregel ist die der Achse — jedes Jahr braucht alle drei Felder', () => {
  // Genau axes.js roicStability: OpInc, Assets UND CurrLiab present, invested > 0.
  // Waere hier eine Regel gelockert, meldete der Bericht eine Tiefe, die das Scoring
  // nie sieht — und das Urteil ueber das Scharfschalten stuende auf falschen Zahlen.
  const j = R.roicJahre({
    _fys: [2024, 2023, 2022, 2021, 2020],
    annualOpInc: [{ value: 100 }, { value: 90 }, { value: null }, { value: 70 }, { value: 60 }],
    annualAssets: [{ value: 1000 }, { value: 900 }, { value: 800 }, { value: 700 }, { value: 600 }],
    //                                              ^kein OpInc      ^CurrLiab fehlt   ^invested<=0
    annualCurrentLiabilities: [{ value: 400 }, { value: 300 }, { value: 200 }, { value: null }, { value: 600 }],
  });
  assert.deepEqual(j.map((x) => x.fy), [2024, 2023], 'nur die vollstaendigen Jahre zaehlen');
  assert.equal(j[0].roic.toFixed(4), (100 / 600).toFixed(4));
});

check('der Vertrauensbereich ist reproduzierbar', () => {
  // Ein Bericht, der bei jedem Lauf andere Grenzen nennt, taugt nicht als Grundlage fuer
  // ein Ja/Nein zum Scharfschalten.
  const paare = Array.from({ length: 60 }, (_, i) => [i, i + (i % 5)]);
  assert.deepEqual(R.bootstrapKI(paare, 200), R.bootstrapKI(paare, 200));
});

check('das Datentor des Berichts stimmt mit dem der Achse ueberein', () => {
  const { roicStability } = require('../src/scoring/axes.js');
  const snapshotMitJahren = (n) => ({ secAnnual: {
    annualOpInc: Array.from({ length: n }, () => ({ value: 100 })),
    annualAssets: Array.from({ length: n }, () => ({ value: 1000 })),
    annualCurrentLiabilities: Array.from({ length: n }, () => ({ value: 400 })),
  } });
  assert.equal(roicStability(snapshotMitJahren(R.ROIC_STAB_MIN_YEARS - 1)), null,
    'ein Jahr unter dem Berichtstor muss auch an der Achse scheitern');
  assert.notEqual(roicStability(snapshotMitJahren(R.ROIC_STAB_MIN_YEARS)), null,
    'am Berichtstor muss die Achse einen Wert liefern');
});


// ── 4.1 Auflage 5 (29.07.): das Einreichungsdatum wird mitgeschrieben ────────────
// Der Waechter nagelt die SACHE fest: kommt je Geschaeftsjahr das Datum heraus, ab dem
// die ZEILE oeffentlich war? Das ist das SPAETESTE filed unter den beteiligten Konzepten —
// ein frueheres wuerde einer Rueckrechnung Wissen unterstellen, das es damals nicht gab.
check('extractSecSeries schreibt je Jahr das spaeteste Einreichungsdatum mit', () => {
  const cf = {
    entityName: 'Testfirma AG',
    facts: {
      'us-gaap': {
        Revenues: { units: { USD: [
          { form: '10-K', fp: 'FY', fy: 2024, val: 1000, end: '2024-12-31', accn: 'a-1', filed: '2025-02-10' },
          { form: '10-K', fp: 'FY', fy: 2023, val: 900, end: '2023-12-31', accn: 'a-0', filed: '2024-02-12' },
        ] } },
        OperatingIncomeLoss: { units: { USD: [
          // NACHTRAEGLICH eingereicht: dieselbe Zeile war erst ab diesem Tag vollstaendig.
          { form: '10-K', fp: 'FY', fy: 2024, val: 200, end: '2024-12-31', accn: 'a-1', filed: '2025-08-01' },
        ] } },
      },
      dei: {},
    },
  };
  const s = extractSecSeries(cf);
  const fys = s.annual._fys;
  const i2024 = fys.indexOf(2024);
  const i2023 = fys.indexOf(2023);
  assert.ok(i2024 >= 0 && i2023 >= 0, 'beide Jahre muessen auf der Achse liegen');
  assert.equal(s.annual.annualFiled.length, fys.length, 'gleich lang wie jede andere Reihe');
  assert.equal(s.annual.annualFiled[i2024].value, '2025-08-01', 'spaetestes, nicht fruehestes');
  assert.equal(s.annual.annualFiled[i2023].value, '2024-02-12');
});

check('fehlt das Einreichungsdatum, wird KEINES erfunden', () => {
  const cf = { facts: { 'us-gaap': { Revenues: { units: { USD: [
    { form: '10-K', fp: 'FY', fy: 2024, val: 1000, end: '2024-12-31', accn: 'a-1' },
  ] } } }, dei: {} } };
  const s = extractSecSeries(cf);
  assert.equal(s.annual.annualFiled[0].value, null);
});

console.log('\nsecbulk: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
