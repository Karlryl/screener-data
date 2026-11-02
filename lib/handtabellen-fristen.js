'use strict';
/**
 * Deadline report for the share-count hand table (configs/share-count-hand-table.json): which rows run out of
 * `reviewBy` within a window, and what that does to the boards. Report only: nothing here reads or writes a
 * snapshot, and no board number depends on it.
 *
 * Effect of a row after its reviewBy (lib/market-cap-guard.js, lib/ads-hand-table.js), from the data day after it:
 *   table row with withholdUnverified true -> the corrected value is no longer applied, the marketCap stays empty
 *                                             (the firm leaves the board unless another listing of it still has a value)
 *   table row without it                   -> still applied, the pull only warns (reviewOverdue)
 *   _holds row                             -> was already empty, stays empty (the pull only warns)
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_DAY = 864e5;
const BOARDS = { 'consumer-discretionary': 'Zyklischer Konsum', 'consumer-staples': 'Basiskonsum', energy: 'Energie', financials: 'Finanzen', 'health-care': 'Gesundheit', industrials: 'Industrie', 'it-services': 'IT-Dienste', materials: 'Rohstoffe', 'real-estate': 'Immobilien', semiconductors: 'Halbleiter', 'software-comm-services': 'Software und Kommunikation', 'tech-hardware': 'Technische Hardware', utilities: 'Versorger' };

const NEVER_TAKES_OVER = new Set(['non-us', 'data-suspect']);
const dayNo = d => Date.parse(d + 'T00:00:00Z') / MS_DAY;
const isDay = d => typeof d === 'string' && DAY.test(d) && Number.isFinite(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d; // 2026-11-31 is no date
const plusDay = d => new Date((dayNo(d) + 1) * MS_DAY).toISOString().slice(0, 10);
const de = d => d.split('-').reverse().join('.');
const nameKey = s => String(s).trim().toLowerCase();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** @param {object} tabelle Parsed share-count hand table. @returns {{ticker: string, art: string, reviewBy: string}[]} Every case. */
function faelle(tabelle) {
  const holds = tabelle && typeof tabelle._holds === 'object' && tabelle._holds ? tabelle._holds : {};
  const rows = Object.entries(tabelle || {}).filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object')
    .map(([ticker, r]) => ({ ticker, art: r.withholdUnverified === true ? 'faellt' : 'wirkt-weiter', reviewBy: r.reviewBy }));
  return [...rows, ...Object.entries(holds).map(([ticker, r]) => ({ ticker, art: 'bleibt-leer', reviewBy: r && r.reviewBy }))];
}

/**
 * @param {{tabelle: object, universum: object[], datum: string, tage?: number}} opts tabelle: the parsed hand table;
 *   universum: rows of filter/universum.json (t ticker, n name, b board, rk rank, mc market cap); datum: the data day.
 * @returns {{zeilen: string[], faellt: object[], leerVorFrist: object[], ungueltig: string[]}}
 */
function fristen({ tabelle, universum, datum, tage = 30 }) {
  if (!isDay(datum)) throw new Error('datum must be a calendar date YYYY-MM-DD');
  const byTicker = new Map(universum.map(r => [r.t, r]));
  const byName = new Map();
  for (const r of universum) if (r.n) byName.set(nameKey(r.n), [...(byName.get(nameKey(r.n)) || []), r]);
  const all = faelle(tabelle);
  const ungueltig = all.filter(f => !isDay(f.reviewBy)).map(f => f.ticker);
  const gueltig = all.filter(f => isDay(f.reviewBy)).map(f => ({ ...f, tageBis: dayNo(f.reviewBy) - dayNo(datum) }));
  const inFenster = gueltig.filter(f => f.tageBis <= tage);
  const faellt = inFenster.filter(f => f.art === 'faellt');
  const ablaufend = new Set(faellt.map(f => f.ticker));
  const hatWert = r => Number.isFinite(r.mc) && r.mc > 0;
  const zeilen = [];

  const firmen = new Map(); // firm name (or the ticker when the export does not know it) -> fall cases
  for (const f of faellt) {
    const name = byTicker.get(f.ticker)?.n || f.ticker;
    firmen.set(name, [...(firmen.get(name) || []), f]);
  }
  const beschreibe = (name, faelleDerFirma) => {
    const gruppe = byName.get(nameKey(name)) || [];
    const auf = gruppe.filter(r => r.b && Number.isFinite(r.rk));
    // The scoring keeps one listing per firm. A second listing that has a value, is no hold, is not expiring and is held back
    // from the boards as the duplicate (aus has 'dup-issuer'; other markers such as mischwaehrung do not matter to the scoring)
    // can take over; a listing with a code from NEVER_TAKES_OVER (OTC lines, suspect data) never can. Whether it really takes over is decided by the scoring, not measured here.
    const ersatz = gruppe.find(r => !ablaufend.has(r.t) && hatWert(r) && !(tabelle._holds && tabelle._holds[r.t]) && !r.b && Array.isArray(r.aus) && r.aus.includes('dup-issuer') && !r.aus.some(c => NEVER_TAKES_OVER.has(c)));
    const tickers = faelleDerFirma.map(f => f.ticker).join(', ');
    if (!gruppe.length) return `${tickers} (nicht im Export, Boardfolge nicht feststellbar)`;
    if (!auf.length) return `${name} (${tickers}; steht auf keinem Board)`;
    const stand = auf.map(r => `${BOARDS[r.b] || r.b} Rang ${r.rk}`).join(' und ');
    const frist = ersatz && tabelle[ersatz.t]?.reviewBy ? ` (deren Frist: ${de(tabelle[ersatz.t].reviewBy)})` : '';
    return `${name} (${tickers}; ${stand}; fällt vom Board${ersatz ? `, es sei denn, die Zweitnotiz ${ersatz.t} übernimmt, das ist nicht geprüft${frist}` : ''})`;
  };

  const daten = [...new Set(faellt.map(f => f.reviewBy))].sort();
  for (const d of daten) {
    const heute = faellt.filter(f => f.reviewBy === d);
    const tageBis = heute[0].tageBis;
    const wann = tageBis < 0 ? `seit ${plural(-tageBis, 'Tag', 'Tagen')} überschritten` : tageBis === 0 ? 'heute' : `in ${plural(tageBis, 'Tag', 'Tagen')}`;
    const namen = [...new Set(heute.map(f => byTicker.get(f.ticker)?.n || f.ticker))].sort();
    const teile = namen.map(n => beschreibe(n, heute.filter(f => (byTicker.get(f.ticker)?.n || f.ticker) === n)));
    zeilen.push(`Frist ${de(d)} (${wann}): Die Aktienzahl-Zeilen von ${plural(namen.length, 'Firma', 'Firmen')} laufen aus, ihr Börsenwert bleibt ab dem Datentag ${de(plusDay(d))} leer, ohne dass Karl dazu eine weitere Meldung bekommt. Betroffen: ${teile.join('; ')}.`);
  }

  const leer = inFenster.filter(f => f.art === 'bleibt-leer');
  const weiter = inFenster.filter(f => f.art === 'wirkt-weiter');
  if (leer.length || weiter.length) {
    const zusatz = [];
    if (leer.length) zusatz.push(`${plural(leer.length, 'Zeile', 'Zeilen')} mit ohnehin leerem Börsenwert (${leer.map(f => f.ticker).join(', ')}), nur ein Hinweis im Protokoll des Datenabrufs`);
    if (weiter.length) zusatz.push(`${weiter.length === 1 ? '1 Zeile, die nach der Frist weiter gilt' : `${weiter.length} Zeilen, die nach der Frist weiter gelten`} (${weiter.map(f => f.ticker).join(', ')}), nur ein Hinweis im Protokoll des Datenabrufs`);
    zeilen.push(`Weitere Fristen in ${tage} Tagen ohne Folge für die Boards: ${zusatz.join('; ')}.`);
  }
  if (ungueltig.length) zeilen.push(`Warnung: Die Frist (reviewBy) fehlt oder ist kein Datum bei ${ungueltig.join(', ')}; ihr Ablauf wird nicht gemeldet.`);

  // The Galaxy case: Yahoo changes the share count, the row no longer matches, the value empties although the deadline is not reached.
  const leerVorFrist = gueltig.filter(f => f.art === 'faellt' && f.tageBis >= 0 && byTicker.has(f.ticker) && !hatWert(byTicker.get(f.ticker)))
    .map(f => ({ ticker: f.ticker, name: byTicker.get(f.ticker)?.n || null, reviewBy: f.reviewBy }));
  if (leerVorFrist.length) {
    zeilen.push(`Hinweis: Bei ${leerVorFrist.map(f => `${f.name || f.ticker} (${f.ticker})`).join(', ')} ist der Börsenwert leer, obwohl die Handtabelle die Aktienzahl noch bis zur Frist belegt; mögliche Ursachen sind eine vom Anbieter geänderte Aktienzahl oder ein anderer Ausschlussgrund der Zeile. Die Zeile prüfen.`);
  }
  return { zeilen, faellt, leerVorFrist, ungueltig };
}

module.exports = { fristen, faelle };
