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
  writeSync: fs.writeSync,
  renameSync: fs.renameSync,
  createWriteStream: fs.createWriteStream,
};

const spur = { schreibZiele: [], renameZiele: [], abbruchAusgeloest: false };
const merk = (liste, p) => {
  if (typeof p !== 'string' && !Buffer.isBuffer(p)) return; // fd oder URL: nicht unser Fall
  try { liste.push(path.resolve(String(p))); } catch (_) { /* unaufloesbar: ignorieren */ }
};

function istSchreibFlagge(flags) {
  if (flags == null) return false;              // Vorgabe 'r'
  if (typeof flags === 'number') {
    const O = fs.constants;
    return (flags & (O.O_WRONLY | O.O_RDWR | O.O_APPEND | O.O_CREAT | O.O_TRUNC)) !== 0;
  }
  return /[wa+]/.test(String(flags));
}

// Die erste Haelfte ablegen und dann werfen. Wichtig ist die HAELFTE, nicht
// null Bytes: eine Datei der Laenge 0 koennte ein Leser noch als "leer" deuten,
// eine halbe JSON-Datei ist unzweideutig kaputt.
function haelfte(daten, enc) {
  const buf = Buffer.isBuffer(daten) ? daten : Buffer.from(String(daten), enc || 'utf8');
  return buf.subarray(0, Math.max(1, Math.floor(buf.length / 2)));
}

fs.writeFileSync = function (ziel, daten, opt) {
  merk(spur.schreibZiele, ziel);
  if (ABBRUCH) {
    spur.abbruchAusgeloest = true;
    const enc = (opt && typeof opt === 'object' && opt.encoding) || (typeof opt === 'string' ? opt : 'utf8');
    echt.writeFileSync.call(fs, ziel, haelfte(daten, enc));
    throw Object.assign(new Error('SPION: Abbruch mitten im writeFileSync'), { code: 'ENOSPC' });
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
  if (istSchreibFlagge(flags)) merk(spur.schreibZiele, ziel);
  return echt.openSync.apply(fs, arguments);
};

fs.writeSync = function (fd, daten, ...rest) {
  if (ABBRUCH) {
    spur.abbruchAusgeloest = true;
    const teil = haelfte(daten, 'utf8');
    echt.writeSync.call(fs, fd, teil, 0, teil.length, 0);
    throw Object.assign(new Error('SPION: Abbruch mitten im writeSync'), { code: 'ENOSPC' });
  }
  return echt.writeSync.call(fs, fd, daten, ...rest);
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
