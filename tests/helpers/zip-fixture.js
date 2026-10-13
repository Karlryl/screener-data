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
 * zip64 / fremdesZusatzfeld = ZIP64-Endsaetze und CD-Zusatzfelder; optional ein
 *               fremdes Feld VOR dem ZIP64-Feld. gespeichert pro Eintrag
 *               ueberschreibt die gleichnamige Archiv-Option.
 * @param {Array<{name:string, inhalt:string, zusatzLen?:number, cdZusatzLen?:number, cdKommentar?:string, gespeichert?:boolean}>} dateien
 * @param {{gespeichert?:boolean, kommentar?:string, zip64?:boolean, fremdesZusatzfeld?:boolean}} [opt]
 * @returns {Buffer}
 */
function baueZip(dateien, opt = {}) {
  const lokale = [], verzeichnis = [];
  let offset = 0;
  for (const d of dateien) {
    const nameBuf = Buffer.from(d.name, 'utf8');
    const roh = Buffer.from(d.inhalt, 'utf8');
    const gespeichert = d.gespeichert == null ? opt.gespeichert : d.gespeichert;
    const gepackt = gespeichert ? roh : zlib.deflateRawSync(roh);
    const methode = gespeichert ? 0 : 8;
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

    let cdZusatz = Buffer.alloc(d.cdZusatzLen || 0);
    if (opt.zip64) {
      const zip64Zusatz = Buffer.alloc(28);
      zip64Zusatz.writeUInt16LE(0x0001, 0);
      zip64Zusatz.writeUInt16LE(24, 2);
      zip64Zusatz.writeBigUInt64LE(BigInt(roh.length), 4);
      zip64Zusatz.writeBigUInt64LE(BigInt(gepackt.length), 12);
      zip64Zusatz.writeBigUInt64LE(BigInt(offset), 20);
      const fremderZusatz = Buffer.alloc(opt.fremdesZusatzfeld ? 8 : 0);
      if (opt.fremdesZusatzfeld) {
        fremderZusatz.writeUInt16LE(0x7075, 0);
        fremderZusatz.writeUInt16LE(4, 2);
        fremderZusatz.writeUInt32LE(0x12345678, 4);
      }
      cdZusatz = Buffer.concat([fremderZusatz, zip64Zusatz, cdZusatz]);
    }
    const cdKommentar = Buffer.from(d.cdKommentar || '', 'utf8');
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(methode, 10);
    cdh.writeUInt32LE(opt.zip64 ? 0xffffffff : gepackt.length, 20);
    cdh.writeUInt32LE(opt.zip64 ? 0xffffffff : roh.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(cdZusatz.length, 30);
    cdh.writeUInt16LE(cdKommentar.length, 32);
    cdh.writeUInt32LE(opt.zip64 ? 0xffffffff : offset, 42);
    verzeichnis.push(cdh, nameBuf, cdZusatz, cdKommentar);
    offset += 30 + nameBuf.length + zusatz.length + gepackt.length;
  }
  const cdBuf = Buffer.concat(verzeichnis);
  const eocd = Buffer.alloc(22 + (opt.kommentar || '').length);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opt.zip64 ? 0xffff : dateien.length, 8);
  eocd.writeUInt16LE(opt.zip64 ? 0xffff : dateien.length, 10);
  eocd.writeUInt32LE(opt.zip64 ? 0xffffffff : cdBuf.length, 12);
  eocd.writeUInt32LE(opt.zip64 ? 0xffffffff : offset, 16);
  eocd.writeUInt16LE((opt.kommentar || '').length, 20);
  if (opt.kommentar) eocd.write(opt.kommentar, 22, 'utf8');
  const zip64Ende = [];
  if (opt.zip64) {
    const eocd64 = Buffer.alloc(56);
    eocd64.writeUInt32LE(0x06064b50, 0);
    eocd64.writeBigUInt64LE(44n, 4);
    eocd64.writeUInt16LE(45, 12);
    eocd64.writeUInt16LE(45, 14);
    eocd64.writeBigUInt64LE(BigInt(dateien.length), 24);
    eocd64.writeBigUInt64LE(BigInt(dateien.length), 32);
    eocd64.writeBigUInt64LE(BigInt(cdBuf.length), 40);
    eocd64.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + cdBuf.length), 8);
    locator.writeUInt32LE(1, 16);
    zip64Ende.push(eocd64, locator);
  }
  return Buffer.concat([...lokale, cdBuf, ...zip64Ende, eocd]);
}

module.exports = { baueZip };
