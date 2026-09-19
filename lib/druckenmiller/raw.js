'use strict';
/**
 * lib/druckenmiller/raw.js — die Roh-Zeilen eines Tages lesen und daraus die
 * U-Mitgliedschaft bilden.
 *
 * WARUM GETEILT (Chunk 2): der Schreiber liest die Roh-Dateien fuer Churn und Abdeckung,
 * der Logger liest die Roh-Datei des VORTAGS, um die Ein- und Austritte von heute zu
 * zaehlen. "Wer ist Mitglied von U" ist eine registrierte Regel (Rat D4: Balken am
 * Sitzungstag UND >= 250 Balken) — sie darf nicht zweimal im Baum stehen.
 *
 * EINE UNLESBARE DATEI WIRD NIE TEILWEISE AUSGEWERTET: halb entpackt, eine kaputte Zeile
 * oder kein gzip — in allen Faellen `null`. Der Aufrufer entscheidet, ob das ein Wurf ist
 * (juengster Tag) oder ein Zaehler (alte Tage).
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { MIN_BARS } = require('./universe.js');

function readRaw(rawDir, datum, log) {
  const p = path.join(rawDir, datum + '.jsonl.gz');
  if (!fs.existsSync(p)) return null;
  let text;
  try { text = zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'); }
  catch (e) {
    if (log) {
      log('::warning::[druckenmiller] ' + p + ' laesst sich nicht entpacken (' + e.message
        + ') — halb geschrieben oder kein gzip. Der Churn dieses Tages bleibt leer.');
    }
    return null;
  }
  const out = [];
  const zeilen = text.split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    if (!zeilen[i].trim()) continue;
    try { out.push(JSON.parse(zeilen[i])); }
    catch (e) {
      if (log) {
        log('::warning::[druckenmiller] ' + p + ' Zeile ' + (i + 1) + ' ist kein gueltiges JSON ('
          + e.message + ') — die Datei gilt als unlesbar und wird NICHT teilweise ausgewertet.');
      }
      return null;
    }
  }
  return out;
}

/** U-Mitglieder aus Roh-Zeilen (Rat D4). */
function membersOf(rohZeilen) {
  const s = new Set();
  for (const z of rohZeilen) {
    if (z && z.atSession && Number.isFinite(z.bars) && z.bars >= MIN_BARS) s.add(z.ticker);
  }
  return s;
}

module.exports = { readRaw, membersOf };
