'use strict';
/**
 * lib/zip-stream.js — ZIP-Zentralverzeichnis lesen und einzelne Eintraege entpacken,
 * OHNE das Archiv jemals ganz auf Platte zu legen.
 *
 * WOZU: Das SEC-Bulk-Archiv `companyfacts.zip` ist 1,39 GB komprimiert und **19,06 GB
 * entpackt** (20.102 Eintraege, live vermessen 28.07.). Ein Bauserver hat dafuer weder
 * Platz noch Zeitdecke. Gebraucht werden aber nur die Firmen des Universums — der Rest
 * ist Ballast.
 *
 * DER TRICK: Ein ZIP traegt sein Inhaltsverzeichnis am ENDE. Wer es zuerst liest, kennt
 * Name, Groesse und Byte-Position jedes Eintrags — und kann danach gezielt einzelne
 * Eintraege per Range-Abruf holen, statt 1,39 GB durchzuschieben.
 *
 * KEINE NEUE ABHAENGIGKEIT: alles mit Node-Bordmitteln (`zlib.inflateRawSync`). Das Repo
 * hat genau eine Laufzeit-Abhaengigkeit (yahoo-finance2), und das soll so bleiben —
 * eine neue waere eine Karl-Stop-Bedingung.
 *
 * WAS DIESE DATEI NICHT TUT: sie kennt weder SEC noch Firmen. Reines ZIP-Handwerk,
 * damit sie einzeln testbar ist.
 */
const zlib = require('zlib');

// ZIP-Signaturen (little-endian). Namen wie in der Formatspezifikation.
const EOCD_SIG = 0x06054b50;        // End of Central Directory
const EOCD64_LOC_SIG = 0x07064b50;  // ZIP64 End of Central Directory Locator
const EOCD64_SIG = 0x06064b50;      // ZIP64 End of Central Directory
const CD_SIG = 0x02014b50;          // Central Directory File Header
const LFH_SIG = 0x04034b50;         // Local File Header

const EOCD_MIN = 22;                // EOCD ohne Kommentar
const EOCD_MAX_SUCHE = 66 * 1024;   // EOCD-Kommentar kann bis 64 KB lang sein

/**
 * Sucht das End-of-Central-Directory im letzten Stueck der Datei.
 * Rueckwaerts, weil ein Kommentar dahinterstehen kann, der zufaellig wie eine Signatur
 * aussieht — der LETZTE Treffer ist der echte.
 */
function findeEocd(schwanz) {
  for (let i = schwanz.length - EOCD_MIN; i >= 0; i -= 1) {
    if (schwanz.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Liest den Verzeichnis-Zeiger aus dem Datei-Ende. Beherrscht ZIP64 — ohne das waere
 * jedes Archiv ueber 4 GB oder mit mehr als 65.535 Eintraegen unlesbar, und beides
 * trifft auf companyfacts.zip zu (20.102 Eintraege).
 *
 * @param {Buffer} schwanz  die letzten Bytes der Datei (mindestens EOCD_MAX_SUCHE)
 * @param {number} dateiGroesse  Gesamtgroesse, um absolute Positionen zu rechnen
 * @returns {{cdOffset:number, cdGroesse:number, anzahl:number, zip64:boolean}}
 */
function leseVerzeichnisZeiger(schwanz, dateiGroesse) {
  const e = findeEocd(schwanz);
  if (e < 0) throw new Error('zip: kein End-of-Central-Directory gefunden');
  let anzahl = schwanz.readUInt16LE(e + 10);
  let cdGroesse = schwanz.readUInt32LE(e + 12);
  let cdOffset = schwanz.readUInt32LE(e + 16);
  let zip64 = false;

  // ZIP64 liegt vor, wenn eines der Felder auf Anschlag steht. Dann steht die Wahrheit
  // im ZIP64-Datensatz, den ein Locator direkt vor dem EOCD adressiert.
  if (anzahl === 0xffff || cdGroesse === 0xffffffff || cdOffset === 0xffffffff) {
    const locPos = e - 20;
    if (locPos < 0 || schwanz.readUInt32LE(locPos) !== EOCD64_LOC_SIG) {
      throw new Error('zip: ZIP64 angezeigt, aber kein Locator vor dem EOCD');
    }
    const eocd64Abs = Number(schwanz.readBigUInt64LE(locPos + 8));
    const eocd64Rel = eocd64Abs - (dateiGroesse - schwanz.length);
    if (eocd64Rel < 0 || eocd64Rel + 56 > schwanz.length) {
      throw new Error('zip: ZIP64-Datensatz liegt ausserhalb des gelesenen Schwanzes');
    }
    if (schwanz.readUInt32LE(eocd64Rel) !== EOCD64_SIG) throw new Error('zip: ZIP64-Signatur falsch');
    anzahl = Number(schwanz.readBigUInt64LE(eocd64Rel + 32));
    cdGroesse = Number(schwanz.readBigUInt64LE(eocd64Rel + 40));
    cdOffset = Number(schwanz.readBigUInt64LE(eocd64Rel + 48));
    zip64 = true;
  }
  return { cdOffset, cdGroesse, anzahl, zip64 };
}

/**
 * Zerlegt das Zentralverzeichnis in Eintraege.
 *
 * ⚠ Die Rueckgabe traegt `lfhOffset` — die Position des LOKALEN Kopfes, nicht der Daten.
 * Der lokale Kopf ist unterschiedlich lang (Name + Zusatzfeld), seine Laengen stehen
 * NUR dort. Wer die Laengen aus dem Zentralverzeichnis nimmt, liest um ein paar Bytes
 * versetzt und bekommt Datenmuell statt eines Fehlers — deshalb wird der lokale Kopf
 * beim Entpacken IMMER mitgelesen.
 */
function leseVerzeichnis(cd, anzahlErwartet) {
  const eintraege = [];
  let p = 0;
  while (p + 46 <= cd.length) {
    if (cd.readUInt32LE(p) !== CD_SIG) break;
    const methode = cd.readUInt16LE(p + 10);
    let compressedSize = cd.readUInt32LE(p + 20);
    let uncompressedSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let lfhOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);

    // ZIP64-Zusatzfeld: die Felder, die auf 0xffffffff stehen, kommen von dort — und
    // zwar in fester Reihenfolge, aber nur die tatsaechlich uebergelaufenen.
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || lfhOffset === 0xffffffff) {
      let q = p + 46 + nameLen;
      const ende = q + extraLen;
      while (q + 4 <= ende) {
        const id = cd.readUInt16LE(q), len = cd.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let r = q + 4;
          if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(cd.readBigUInt64LE(r)); r += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(cd.readBigUInt64LE(r)); r += 8; }
          if (lfhOffset === 0xffffffff) { lfhOffset = Number(cd.readBigUInt64LE(r)); r += 8; }
          break;
        }
        q += 4 + len;
      }
    }
    eintraege.push({ name, methode, compressedSize, uncompressedSize, lfhOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (anzahlErwartet != null && eintraege.length !== anzahlErwartet) {
    // Fail-loud: ein halb gelesenes Verzeichnis wuerde stillschweigend zu wenig Firmen
    // liefern — und "weniger Firmen" sieht aus wie ein Datenproblem, nicht wie ein Bug.
    throw new Error('zip: Verzeichnis unvollstaendig — ' + eintraege.length + ' von ' + anzahlErwartet + ' Eintraegen gelesen');
  }
  return eintraege;
}

/**
 * Entpackt EINEN Eintrag aus dem Rohblock, der bei seinem lokalen Kopf beginnt.
 * @param {Buffer} block  ab lfhOffset, mindestens 30 + Namen + Zusatz + compressedSize Bytes
 */
function entpackeEintrag(block, eintrag) {
  if (block.readUInt32LE(0) !== LFH_SIG) throw new Error('zip: lokaler Kopf fehlt bei ' + eintrag.name);
  const nameLen = block.readUInt16LE(26);
  const extraLen = block.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const roh = block.subarray(start, start + eintrag.compressedSize);
  if (roh.length !== eintrag.compressedSize) {
    throw new Error('zip: Daten unvollstaendig bei ' + eintrag.name + ' (' + roh.length + ' von ' + eintrag.compressedSize + ')');
  }
  if (eintrag.methode === 0) return roh;             // gespeichert
  if (eintrag.methode === 8) return zlib.inflateRawSync(roh);  // deflate
  throw new Error('zip: unbekanntes Verfahren ' + eintrag.methode + ' bei ' + eintrag.name);
}

/**
 * Wieviele Bytes muss man ab dem lokalen Kopf holen, um den Eintrag sicher ganz zu haben?
 * Der lokale Kopf kann laenger sein als der im Zentralverzeichnis (Zusatzfelder), deshalb
 * ein grosszuegiger Aufschlag statt einer exakten Rechnung — 4 KB decken jeden realen Fall.
 */
const LFH_AUFSCHLAG = 4096;
const bytesFuer = (eintrag) => 30 + LFH_AUFSCHLAG + eintrag.compressedSize;

module.exports = {
  findeEocd, leseVerzeichnisZeiger, leseVerzeichnis, entpackeEintrag, bytesFuer,
  EOCD_MAX_SUCHE, LFH_AUFSCHLAG,
  _sig: { EOCD_SIG, EOCD64_SIG, EOCD64_LOC_SIG, CD_SIG, LFH_SIG },
};
