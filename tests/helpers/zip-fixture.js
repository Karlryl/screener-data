'use strict';
/**
 * baueZip — portabler ZIP-Fixture-Bauer fuer Tests (kein Fixture-Blob im Repo,
 * keine neue Dependency, laeuft auf ubuntu-latest genauso wie auf Windows).
 *
 * Stand bis 2026-08-30 inline in tests/secbulk.test.js:28. Hierher gehoben, weil
 * tests/sec-pit.test.js dieselbe Fixture braucht und die Testdatei sich nicht
 * requiren laesst (sie endet mit process.exit). Eine zweite Kopie waere genau die
 * Drift-Klasse, gegen die dieser Bauer gebaut ist: zwei Leser, zwei Annahmen.
 *
 * Bewusst per Hand statt mit einer Bibliothek — der Test darf nicht dieselbe
 * Annahme teilen wie der Code, den er prueft.
 */
const zlib = require('zlib');

/**
 * Baut ein gueltiges ZIP aus {name, inhalt}-Paaren.
 *
 * zusatzLen   = Zusatzfeld NUR im lokalen Kopf (Falle fuer Leser, die die Laengen
 *               aus dem Zentralverzeichnis nehmen).
 * cdZusatzLen / cdKommentar = Zusatzfeld bzw. Kommentar im ZENTRALVERZEICHNIS-Kopf.
 *               2026-08-30 ergaenzt: ohne sie sind extraLen und commentLen in JEDEM
 *               CD-Eintrag 0, und eine Positionsfortschaltung, die beide vergisst
 *               (`pos += 46 + fnLen`), ist von aussen NICHT unterscheidbar. Genau
 *               diese Off-by-one-Klasse muss der entryFilter-Waechter sehen koennen.
 * @param {Array<{name:string, inhalt:string, zusatzLen?:number, cdZusatzLen?:number, cdKommentar?:string}>} dateien
 * @param {{gespeichert?:boolean, kommentar?:string}} [opt]
 * @returns {Buffer}
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

    const cdZusatz = Buffer.alloc(d.cdZusatzLen || 0);
    const cdKommentar = Buffer.from(d.cdKommentar || '', 'utf8');
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(methode, 10);
    cdh.writeUInt32LE(gepackt.length, 20);
    cdh.writeUInt32LE(roh.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(cdZusatz.length, 30);
    cdh.writeUInt16LE(cdKommentar.length, 32);
    cdh.writeUInt32LE(offset, 42);
    verzeichnis.push(cdh, nameBuf, cdZusatz, cdKommentar);
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

module.exports = { baueZip };
