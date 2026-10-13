'use strict';
// Preload-Modul fuer die Waechter ueber dem Register-SCHREIBWEG.
//
// DIE SACHE: protocol/early-detection/2.0.0/outcome-access-ledger.json ist
// nur-anhaengend, verkettet und extern bezeugt. Die Regel, die hier gepinnt
// wird, ist keine Formulierung im Code, sondern eine Eigenschaft des Laufs:
// die Registerdatei wird NIE direkt schreibend geoeffnet — sie entsteht
// ausschliesslich als ZIEL eines rename. Genau das beobachtet dieses Modul.
// Es liest keinen Quelltext und kennt kein Suchmuster; es sieht zu, was das
// Werkzeug am Dateisystem wirklich tut.
//
// Aufruf:  node --require tests/hilfen/schreibspion.js <skript> <args...>
// Umgebung:
//   SPION_AUSGABE   Pfad, in den die Spur als JSON geschrieben wird (Pflicht).
//   SPION_ABBRUCH   gesetzt -> jeder Schreibvorgang legt nur die ERSTE HAELFTE
//                   der Nutzlast ab und wirft dann. Das ist der Stromausfall
//                   mitten im Schreiben, ohne den Rechner auszuschalten.
const fs = require('node:fs');
const path = require('node:path');

const AUSGABE = process.env.SPION_AUSGABE;
const ABBRUCH = !!process.env.SPION_ABBRUCH;

// Originale festhalten, BEVOR irgendetwas ersetzt wird. Die Spur selbst darf
// nicht durch die eigenen Fallen laufen — sonst protokolliert sich der Spion
// beim Schreiben seines Protokolls und bricht im Abbruch-Modus daran ab.
const echt = {
  writeFileSync: fs.writeFileSync,
  appendFileSync: fs.appendFileSync,
  openSync: fs.openSync,
  closeSync: fs.closeSync,
  writeSync: fs.writeSync,
  renameSync: fs.renameSync,
  createWriteStream: fs.createWriteStream,
};

// abbruchPfad ist NICHT Zierde, sondern der Kern der Abbruch-Probe: ein blosses
// "irgendwo wurde abgebrochen" laesst die Probe gruen werden, wenn der Abbruch
// eine ganz andere Datei traf (Debug-Log, Sperrdatei, Telemetrie) und die
// Registerdatei nie angefasst wurde. Der Test verlangt deshalb, dass der
// Abbruch das Register ODER dessen Zwischendatei getroffen hat.
// Gefunden im ecc-Review 30.08. mit ausgefuehrter Reproduktion.
const spur = {
  schreibZiele: [], renameZiele: [], abbruchAusgeloest: false, abbruchPfad: null,
};
const aufloesen = (p) => {
  if (typeof p !== 'string' && !Buffer.isBuffer(p)) return null; // fd oder URL: nicht unser Fall
  try { return path.resolve(String(p)); } catch (_) { return null; }
};
const merk = (liste, p) => {
  const abs = aufloesen(p);
  if (abs !== null) liste.push(abs);
};

// Welcher Pfad haengt an einem Deskriptor? Ohne diese Zuordnung koennte die
// writeSync-Falle nicht sagen, WAS sie gerade zerschlagen hat - writeSync sieht
// nur eine Zahl.
const fdPfade = new Map();

function abbrechen(pfad, art) {
  spur.abbruchAusgeloest = true;
  if (spur.abbruchPfad === null) spur.abbruchPfad = pfad; // der ERSTE Abbruch zaehlt
  return Object.assign(new Error(`SPION: Abbruch mitten im ${art}`), { code: 'ENOSPC' });
}

function istSchreibFlagge(flags) {
  if (flags == null) return false;              // Vorgabe 'r'
  if (typeof flags === 'number') {
    const O = fs.constants;
    // NUR die Richtungs-Bits. O_RDONLY ist 0, und `O_RDONLY | O_CREAT` heisst
    // "lesend oeffnen, anlegen falls nicht da" - das ist kein Schreibvorgang.
    // Waeren O_CREAT/O_TRUNC in der Maske, zaehlte dieser Fall falsch mit und
    // die Waechter meldeten einen Schreibvorgang, den es nie gab.
    return (flags & (O.O_WRONLY | O.O_RDWR | O.O_APPEND)) !== 0;
  }
  return /[wa+]/.test(String(flags));
}

// Die erste Haelfte ablegen und dann werfen. Wichtig ist die HAELFTE, nicht
// null Bytes: eine Datei der Laenge 0 koennte ein Leser noch als "leer" deuten,
// eine halbe JSON-Datei ist unzweideutig kaputt.
// Grenzfaelle ehrlich benannt: bei 0 Bytes gibt es nichts zu halbieren, bei
// 1 Byte kommt das ganze Byte durch. Beides ist hier unerreichbar - die
// Nutzlasten sind Register und Freigabe-Protokolle -, aber wer diesen Spion
// je gegen kleine Schreibvorgaenge stellt, muss es wissen.
function haelfte(daten, enc) {
  const buf = Buffer.isBuffer(daten) ? daten : Buffer.from(String(daten), enc || 'utf8');
  return buf.subarray(0, Math.max(1, Math.floor(buf.length / 2)));
}

fs.writeFileSync = function (ziel, daten, opt) {
  merk(spur.schreibZiele, ziel);
  if (ABBRUCH) {
    const enc = (opt && typeof opt === 'object' && opt.encoding) || (typeof opt === 'string' ? opt : 'utf8');
    const fehler = abbrechen(aufloesen(ziel), 'writeFileSync');
    echt.writeFileSync.call(fs, ziel, haelfte(daten, enc));
    throw fehler;
  }
  return echt.writeFileSync.apply(fs, arguments);
};

fs.appendFileSync = function (ziel) {
  merk(spur.schreibZiele, ziel);
  return echt.appendFileSync.apply(fs, arguments);
};

fs.createWriteStream = function (ziel) {
  merk(spur.schreibZiele, ziel);
  return echt.createWriteStream.apply(fs, arguments);
};

fs.openSync = function (ziel, flags) {
  const fd = echt.openSync.apply(fs, arguments);
  if (istSchreibFlagge(flags)) {
    const abs = aufloesen(ziel);
    merk(spur.schreibZiele, ziel);
    if (abs !== null) fdPfade.set(fd, abs);
  }
  return fd;
};

fs.closeSync = function (fd) {
  fdPfade.delete(fd);
  return echt.closeSync.apply(fs, arguments);
};

// Die echte Signatur hat zwei Formen:
//   writeSync(fd, buffer[, offset[, length[, position]]])
//   writeSync(fd, string[, position[, encoding]])
// Die halbierte Teilmenge muss aus DEM Ausschnitt kommen, den der Aufrufer
// gemeint hat, und an DIE Stelle geschrieben werden, die er gemeint hat -
// sonst wuerde ein Aufrufer, der in mehreren Schueben schreibt, still ab Byte 0
// ueberschrieben und die Probe misst etwas anderes als einen Abbruch.
fs.writeSync = function (fd, daten, ...rest) {
  if (!ABBRUCH) return echt.writeSync.call(fs, fd, daten, ...rest);
  const fehler = abbrechen(fdPfade.has(fd) ? fdPfade.get(fd) : null, 'writeSync');
  if (Buffer.isBuffer(daten) || ArrayBuffer.isView(daten)) {
    const [offset, length, position] = rest;
    const von = typeof offset === 'number' ? offset : 0;
    const bis = von + (typeof length === 'number' ? length : daten.length - von);
    const teil = haelfte(Buffer.from(daten.buffer, daten.byteOffset + von, bis - von));
    echt.writeSync.call(fs, fd, teil, 0, teil.length,
      typeof position === 'number' ? position : null);
  } else {
    const [position, encoding] = rest;
    const teil = haelfte(String(daten), encoding || 'utf8');
    echt.writeSync.call(fs, fd, teil, 0, teil.length,
      typeof position === 'number' ? position : null);
  }
  throw fehler;
};

fs.renameSync = function (von, nach) {
  merk(spur.renameZiele, nach);
  return echt.renameSync.apply(fs, arguments);
};

// Auch bei einem geworfenen Fehler muss die Spur herausfinden — der
// Abbruch-Lauf ist genau der interessante Fall.
process.on('exit', () => {
  if (!AUSGABE) return;
  try { echt.writeFileSync.call(fs, AUSGABE, `${JSON.stringify(spur, null, 1)}\n`, 'utf8'); }
  catch (_) { /* wenn nicht mal das geht, sieht der Test die fehlende Datei */ }
});
