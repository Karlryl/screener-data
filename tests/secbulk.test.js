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
const zlib = require('zlib');
const zip = require('../lib/zip-stream.js');
const { baueBloecke, cikKarte } = require('../scripts/fetch-secbulk.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/**
 * Baut ein gueltiges ZIP aus {name, inhalt}-Paaren. Bewusst per Hand statt mit einer
 * Bibliothek — der Test darf nicht dieselbe Annahme teilen wie der Code, den er prueft.
 */
function baueZip(dateien, opt = {}) {
  const lokale = [], verzeichnis = [];
  let offset = 0;
  for (const d of dateien) {
    const nameBuf = Buffer.from(d.name, 'utf8');
    const roh = Buffer.from(d.inhalt, 'utf8');
    const gepackt = opt.gespeichert ? roh : zlib.deflateRawSync(roh);
    const methode = opt.gespeichert ? 0 : 8;
    // Lokaler Kopf mit einem Zusatzfeld variabler Laenge — genau die Stelle, an der ein
    // Leser danebengreift, der die Laengen aus dem Zentralverzeichnis nimmt.
    const zusatz = Buffer.alloc(d.zusatzLen || 0);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(methode, 8);
    lfh.writeUInt32LE(gepackt.length, 18);
    lfh.writeUInt32LE(roh.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(zusatz.length, 28);
    lokale.push(lfh, nameBuf, zusatz, gepackt);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(methode, 10);
    cdh.writeUInt32LE(gepackt.length, 20);
    cdh.writeUInt32LE(roh.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    verzeichnis.push(cdh, nameBuf);
    offset += 30 + nameBuf.length + zusatz.length + gepackt.length;
  }
  const cdBuf = Buffer.concat(verzeichnis);
  const eocd = Buffer.alloc(22 + (opt.kommentar || '').length);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(dateien.length, 8);
  eocd.writeUInt16LE(dateien.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE((opt.kommentar || '').length, 20);
  if (opt.kommentar) eocd.write(opt.kommentar, 22, 'utf8');
  return Buffer.concat([...lokale, cdBuf, eocd]);
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
  const achse = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'scoring', 'axes.js'), 'utf8');
  const m = achse.match(/const ROIC_STAB_MIN_YEARS = (\d+)/);
  assert.ok(m, 'ROIC_STAB_MIN_YEARS in axes.js nicht gefunden');
  assert.equal(Number(m[1]), R.ROIC_STAB_MIN_YEARS,
    'Bericht und Achse haben verschiedene Datentore — der Bericht misst dann etwas anderes als das System rechnet');
});

console.log('\nsecbulk: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
