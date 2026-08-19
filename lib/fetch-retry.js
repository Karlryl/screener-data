'use strict';
/**
 * lib/fetch-retry.js — schonender HTTPS-Abruf fuer die Laender-Adapter (TW/KR/JP).
 *
 * WOZU: Die drei Gratis-Quellen (FinMind, OpenDART, EDINET) sind Aemter bzw. ein
 * kleiner Betreiber ohne Vertrag. Ein Adapter, der sie ueberfaehrt, ist nach einer
 * Woche gesperrt — und damit ist der ganze Kanal tot. Darum stehen Pause und
 * Wiederholung NICHT in den drei Adaptern (dreimal dieselbe Drift), sondern hier.
 *
 * WAS ES TUT:
 *   - feste Mindestpause ZWISCHEN zwei Abrufen (prozessweit, pro Host)
 *   - Wiederholung mit wachsendem Abstand bei Netzfehler, Timeout, 429 und 5xx
 *   - 4xx ausser 429 wird NICHT wiederholt (ein falscher Schluessel wird durch
 *     Warten nicht richtig) und kommt als Fehler zurueck, nicht als leerer Wert
 *
 * WAS ES BEWUSST NICHT TUT: kein stiller Fallback. Wer hier scheitert, bekommt
 * einen Wurf. Ein Adapter, der aus einem Fehlabruf eine 0 macht, ist genau die
 * Fehlerklasse, die dieses Repo am teuersten bezahlt hat.
 *
 * KEINE NEUE ABHAENGIGKEIT: nur node:https (Repo hat genau eine Laufzeit-Dep).
 */
const https = require('https');

// Bewusst grosszuegig: der Adapter laeuft offline/nightly, nicht im Nutzer-Pfad.
// Lieber 20 Minuten langsam als eine gesperrte Quelle.
const DEFAULT_PAUSE_MS = 1200;
const DEFAULT_VERSUCHE = 4;
const DEFAULT_BACKOFF_MS = 2000;   // 2s, 4s, 8s …
const DEFAULT_TIMEOUT_MS = 45000;

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// Letzter Abrufzeitpunkt je Host, damit zwei Adapter im selben Prozess sich nicht
// gegenseitig die Pause wegnehmen.
const letzterAbruf = new Map();

async function warteAufSlot(host, pauseMs) {
  const zuletzt = letzterAbruf.get(host) || 0;
  const wartet = zuletzt + pauseMs - Date.now();
  if (wartet > 0) await schlaf(wartet);
  letzterAbruf.set(host, Date.now());
}

function einAbruf(url, headers, timeoutMs) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers }, (x) => {
      const teile = [];
      x.on('data', (c) => teile.push(c));
      x.on('end', () => res({ code: x.statusCode, body: Buffer.concat(teile), headers: x.headers }));
      x.on('error', rej);
    });
    r.on('error', rej);
    r.setTimeout(timeoutMs, () => { r.destroy(); rej(new Error(`timeout nach ${timeoutMs}ms`)); });
  });
}

/**
 * Holt eine URL als Buffer. Wirft, wenn nach allen Versuchen nichts Brauchbares kam.
 * @returns {Promise<{code:number, body:Buffer, headers:object}>}
 */
async function fetchBuffer(url, opts = {}) {
  const {
    headers = { 'User-Agent': 'screener-data laenderadapter (kontakt via github.com/Karlryl/screener-data)' },
    pauseMs = DEFAULT_PAUSE_MS,
    versuche = DEFAULT_VERSUCHE,
    backoffMs = DEFAULT_BACKOFF_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    _get = einAbruf,     // Test-Seam
    _schlaf = schlaf,    // Test-Seam
  } = opts;
  const host = new URL(url).host;
  let letzterFehler = null;

  for (let v = 0; v < versuche; v += 1) {
    if (v > 0) await _schlaf(backoffMs * (2 ** (v - 1)));
    await warteAufSlot(host, pauseMs);
    let a;
    try {
      a = await _get(url, headers, timeoutMs);
    } catch (e) {
      letzterFehler = e;
      continue; // Netzfehler/Timeout -> wiederholen
    }
    if (a.code === 429 || (a.code >= 500 && a.code <= 599)) {
      letzterFehler = new Error(`HTTP ${a.code}`);
      continue; // Quelle bremst oder haengt -> wiederholen
    }
    if (a.code < 200 || a.code >= 300) {
      // 4xx (ausser 429): wiederholen hilft nicht. Laut scheitern statt still leer.
      throw new Error(`${url} -> HTTP ${a.code} (nicht wiederholbar)`);
    }
    return a;
  }
  throw new Error(`${url} -> nach ${versuche} Versuchen aufgegeben: ${letzterFehler && letzterFehler.message}`);
}

/** Wie fetchBuffer, aber parst JSON. Ein unparsbarer Rumpf ist ein Fehler, kein {}. */
async function fetchJson(url, opts = {}) {
  const a = await fetchBuffer(url, opts);
  const text = a.body.toString('utf8');
  try { return JSON.parse(text); }
  catch (_) { throw new Error(`${url} -> Antwort ist kein JSON (${a.body.length} Bytes, beginnt mit ${JSON.stringify(text.slice(0, 80))})`); }
}

module.exports = { fetchBuffer, fetchJson, DEFAULT_PAUSE_MS, DEFAULT_VERSUCHE, _internals: { warteAufSlot, letzterAbruf } };
