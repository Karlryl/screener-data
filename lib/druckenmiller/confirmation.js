'use strict';
/**
 * lib/druckenmiller/confirmation.js — M1/M2 und der Kursbestaetigungs-Zustand
 * (BUILD-SPEC v1 §0.3, [REV3-3], [REV3-6]; Registrierung = Datei B, Chunk 2).
 *
 * WAS HIER NICHT PASSIERT: kein Ranking, kein Filter, keine Sortierung, keine Bewertung.
 * Der Zustand ist ein ETIKETT auf einer bestehenden Board-Zeile (Rat D1, 68 %) — die
 * Board-Reihenfolge bleibt unberuehrt, und nichts hier darf in den Qualitaets-Score
 * fliessen (Import-Waechter: tests/druckenmiller/import-graph.test.js).
 *
 * WARUM DIE TERZILE JEDEN LAUF NEU GELERNT WERDEN: Invariante 3 der Hausmethodik — keine
 * aufgezwungenen Niveaus. Es gibt keine feste Momentum-Schwelle, es gibt nur "oberes
 * Drittel von U an diesem Tag".
 *
 * DIE SCHNITT-KANTE IST INKLUSIV (v >= q67 oben, v <= q33 unten), und das ist eine
 * Messentscheidung mit Grund: M2 = close/high252 hat eine echte Punktmasse bei genau 1,0
 * (jeder Ticker AM 252-Tage-Hoch). Mit einem strikten ">" faellt ausgerechnet der Fall,
 * den die Achse messen soll, aus dem oberen Terzil, sobald mehr als ein Drittel von U am
 * Hoch steht. Die Kehrseite steht direkt darunter: liegen beide Praedikate gleichzeitig an
 * (entartete Verteilung, q33 == q67), wird KEIN Zustand behauptet.
 */

const M1_LOOKBACK = 252;   // t-252 (Datei B: m1.lookbackBars)
const M1_LAG = 21;         // t-21  (Datei B: m1.lagBars)
const VOL_WINDOW = 252;    // Tagesrendite-Vol (Datei B: m1.volWindowBars)
const HIGH_WINDOW = 252;   // M2-Hoch (Datei B: m2.windowBars)
/** Rat D3/Gericht: Trennungs-Tor der Sitzung (Datei B: separationGate). */
const SEPARATION_MAX = 0.60;
const SEPARATION_MIN = 0.10;

const STATES = ['CONFIRMS', 'NEUTRAL', 'WEAK'];

/** Aufsteigend sortierte, endliche Schlusskurse bis zum Sitzungstag (inklusive). */
function closesThrough(series, sessionDate) {
  if (!Array.isArray(series) || !series.length) return null;
  const bars = series
    .filter((b) => b && b.date && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const idx = bars.findIndex((b) => b.date === sessionDate);
  if (idx < 0) return null;
  return bars.slice(0, idx + 1).map((b) => b.close);
}

/** Stichproben-Standardabweichung der Tages-Log-Renditen ueber die letzten <fenster> Balken. */
function dailyLogVol(closes, fenster) {
  if (!Array.isArray(closes) || closes.length < fenster + 1) return null;
  const teil = closes.slice(closes.length - (fenster + 1));
  const r = [];
  for (let i = 1; i < teil.length; i++) r.push(Math.log(teil[i] / teil[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) * (b - m), 0) / (r.length - 1);
  const sd = Math.sqrt(v);
  return Number.isFinite(sd) && sd > 0 ? sd : null;
}

/**
 * M1 = log-Rendite t-252..t-21 geteilt durch die 252-Tage-Tagesrendite-Vol.
 * M2 = Schlusskurs / 252-Tage-Hoch.
 * Beide null, wenn die Serie das Fenster nicht traegt — nie 0, nie geschaetzt.
 */
function metricsFor(series, sessionDate) {
  const closes = closesThrough(series, sessionDate);
  if (!closes) return null;
  const n = closes.length;
  const vol = dailyLogVol(closes, VOL_WINDOW);
  let m1 = null;
  if (n >= M1_LOOKBACK + 1 && vol !== null) {
    const pStart = closes[n - 1 - M1_LOOKBACK];
    const pEnd = closes[n - 1 - M1_LAG];
    if (pStart > 0 && pEnd > 0) {
      const w = Math.log(pEnd / pStart) / vol;
      m1 = Number.isFinite(w) ? w : null;
    }
  }
  let m2 = null;
  if (n >= HIGH_WINDOW) {
    const hoch = Math.max.apply(null, closes.slice(n - HIGH_WINDOW));
    if (hoch > 0) {
      const q = closes[n - 1] / hoch;
      m2 = Number.isFinite(q) ? q : null;
    }
  }
  return { m1, m2, vol252: vol, bars: n, close: closes[n - 1] };
}

/**
 * Terzil-Schnitte (Typ-7-Interpolation, dieselbe Definition wie percentileRank in
 * internals.js verwendet: lineare Interpolation zwischen Ordnungsstatistiken).
 * `null`, wenn zu wenige Werte da sind — dann gibt es an diesem Tag keinen Zustand.
 */
function terciles(values, minN) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < (Number.isFinite(minN) ? minN : 30)) return null;
  const at = (p) => {
    const h = (xs.length - 1) * p;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return lo === hi ? xs[lo] : xs[lo] + (h - lo) * (xs[hi] - xs[lo]);
  };
  return { q33: at(1 / 3), q67: at(2 / 3), n: xs.length };
}

/**
 * Der Zustand eines Tickers (BUILD-SPEC [REV3-6]): CONFIRMS nur wenn M1 UND M2 im oberen
 * Terzil; WEAK wenn M1 ODER M2 im unteren; sonst NEUTRAL. null, wenn eine Kennzahl fehlt,
 * die Schnitte fehlen oder der Ticker nicht am modalen Balken-Tag haengt.
 *
 * Liegen oberes UND unteres Praedikat gleichzeitig an (q33 == q67, entartete Verteilung),
 * wird NEUTRAL geliefert und `degenerate` gesetzt — CONFIRMS-zuerst wuerde hier Staerke
 * behaupten, wo die Verteilung keine Ordnung hat.
 */
function stateOf(m1, m2, cutsM1, cutsM2) {
  if (!cutsM1 || !cutsM2) return { state: null, reason: 'no-cuts', degenerate: false };
  if (!Number.isFinite(m1) || !Number.isFinite(m2)) return { state: null, reason: 'no-metric', degenerate: false };
  const obenM1 = m1 >= cutsM1.q67, untenM1 = m1 <= cutsM1.q33;
  const obenM2 = m2 >= cutsM2.q67, untenM2 = m2 <= cutsM2.q33;
  const entartet = (obenM1 && untenM1) || (obenM2 && untenM2);
  if (entartet) return { state: 'NEUTRAL', reason: 'degenerate-cut', degenerate: true };
  if (obenM1 && obenM2) return { state: 'CONFIRMS', reason: 'both-upper', degenerate: false };
  if (untenM1 || untenM2) return { state: 'WEAK', reason: 'one-lower', degenerate: false };
  return { state: 'NEUTRAL', reason: 'neither', degenerate: false };
}

/**
 * Trennungs-Tor der Sitzung (Residuum 5): ein Tag, an dem fast alles oder fast nichts
 * bestaetigt ist, traegt keine Trennung zwischen CONFIRMS und WEAK. Solche Sitzungen sind
 * RAW: sie werden geloggt und zeigen ihre Etiketten, schreiben aber KEINEN
 * Scoreboard-Eintrag — genau wie `lowFreshness` und `highChurn`.
 */
function separationGate(states) {
  const mit = states.filter((s) => s === 'CONFIRMS' || s === 'NEUTRAL' || s === 'WEAK');
  if (!mit.length) return { confirmsShare: null, raw: true, reason: 'no-states' };
  const anteil = mit.filter((s) => s === 'CONFIRMS').length / mit.length;
  if (anteil > SEPARATION_MAX) return { confirmsShare: anteil, raw: true, reason: 'confirms-share-above-60' };
  if (anteil < SEPARATION_MIN) return { confirmsShare: anteil, raw: true, reason: 'confirms-share-below-10' };
  return { confirmsShare: anteil, raw: false, reason: null };
}

/**
 * Die Zustands-Tabelle einer Sitzung aus den Roh-Zeilen des Loggers. Nenner sind NUR die
 * Zeilen, die im Universum sind UND am Sitzungstag einen Balken haben (A3/[REV3-3]) —
 * alle anderen bekommen ausdruecklich `state: null`, nie ein stilles NEUTRAL.
 */
function sessionStates(rows, seriesByTicker, sessionDate, minCutN) {
  const kandidaten = [];
  for (const r of rows) {
    if (!r || !r.inUniverse || !r.atSession) {
      kandidaten.push({ ticker: r && r.ticker, m1: null, m2: null, vol252: null, state: null, reason: 'not-in-universe' });
      continue;
    }
    const m = metricsFor(seriesByTicker.get(r.ticker), sessionDate);
    kandidaten.push({
      ticker: r.ticker, m1: m ? m.m1 : null, m2: m ? m.m2 : null, vol252: m ? m.vol252 : null,
      state: null, reason: null,
    });
  }
  const cutsM1 = terciles(kandidaten.map((k) => k.m1), minCutN);
  const cutsM2 = terciles(kandidaten.map((k) => k.m2), minCutN);
  let entartet = 0;
  for (const k of kandidaten) {
    if (k.reason === 'not-in-universe') continue;
    const z = stateOf(k.m1, k.m2, cutsM1, cutsM2);
    k.state = z.state; k.reason = z.reason;
    if (z.degenerate) entartet++;
  }
  const tor = separationGate(kandidaten.map((k) => k.state));
  return {
    rows: kandidaten, cutsM1, cutsM2, nDegenerateCut: entartet,
    nStated: kandidaten.filter((k) => k.state !== null).length,
    separation: tor,
  };
}

module.exports = {
  M1_LOOKBACK, M1_LAG, VOL_WINDOW, HIGH_WINDOW, SEPARATION_MAX, SEPARATION_MIN, STATES,
  closesThrough, dailyLogVol, metricsFor, terciles, stateOf, separationGate, sessionStates,
};
