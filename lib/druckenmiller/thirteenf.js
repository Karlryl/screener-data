'use strict';
/**
 * lib/druckenmiller/thirteenf.js — der 13F-Wrapper (BUILD-SPEC v1 §0.6, [REV1-A4], [REV4-6];
 * Lane-B-Befund v2 und dessen Red Team sind die Quelle der Fallen).
 *
 * WAS DIESER TEIL IST: ein BESCHREIBENDER Betrachter. Er schreibt keinen Scoreboard-Eintrag,
 * speist keine Schaetzgroesse und aendert kein Etikett. Deshalb sind seine Schwellen
 * Datenqualitaets-Schwellen eines Betrachters — keine Ergebnis-Parameter.
 *
 * DREI FALLEN, DIE LANE B TEUER GELERNT HAT:
 *  1. DIE EINHEIT WECHSELT MITTEN IN DER REIHE. 58 Quartale melden Tausende, 2022-12-31
 *     meldet Dollar. Erkannt wird das am impliedPrice = value/shares: gemessen 45,17 fuer
 *     2022-12-31 (Dollar-Lesung plausibel, Tausender-Lesung waere 45.170) und 0,096 fuer
 *     2026-06-30 (Tausender-Lesung 96 plausibel, Dollar-Lesung 0,096 nicht). Passt KEINE oder
 *     passen BEIDE Lesungen, wird das Filing in Quarantaene gestellt, nicht geraten.
 *  2. EINE OPTIONSZEILE MUSS NICHT ALS SOLCHE GETAGGT SEIN. 2015Q2 SPDR Gold trug keinen
 *     `putCall`, aber die CUSIP-Emissionsnummer 907 (Klasse 90/95) sagt "Option".
 *  3. EIN NAMENS-TREFFER IST KEINE IDENTITAET. Barrick -> ABX zeigte auf Abacus. Ein
 *     Treffer wird nur uebernommen, wenn der Emittentenname wirklich passt.
 *
 * OpenFIGI IST AUSGESCHLOSSEN (neue Abhaengigkeit, Stop-Bedingung). Die Zuordnung laeuft
 * ueber eine LOKALE Namenskarte; ihre Abdeckung wird gemessen und berichtet, statt sie zu
 * behaupten.
 */

/** Datenqualitaets-Schwellen des Betrachters (spec-constants.json, Sektion thirteenF). */
const IMPLIED_PRICE_MIN = 1;          // USD je Anteil, untere Plausibilitaetsgrenze
const IMPLIED_PRICE_MAX = 5000;       // USD je Anteil, obere Plausibilitaetsgrenze
const QUARANTINE_FAIL_SHARE = 0.10;   // > 10 % Zeilen ohne plausiblen Preis -> Quarantaene
const PRICE_RATIO_MIN = 0.5;          // Preisprobe: implied/close darf um Faktor 2 abweichen
const PRICE_RATIO_MAX = 2.0;
const QUARTERS_PUBLISHED = 8;         // §0.6: die letzten acht XML-Quartale
const OPTION_ISSUE_NUMBERS = ['90', '95'];
const TRI_STATE = ['HELD', 'NOT_IN_MAPPED', 'UNMAPPED'];

const feld = (xml, name) => {
  const m = xml.match(new RegExp('<' + name + '>([^<]*)</' + name + '>'));
  return m ? m[1].trim() : null;
};
const zahl = (s) => {
  if (s === null || s === undefined || s === '') return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Die Informationstabelle eines 13F-Filings. Kein XML-Paket: die Datei ist flach und
 * regelmaessig, und eine neue Abhaengigkeit ist eine Stop-Bedingung.
 */
function parseInfoTable(xml) {
  if (typeof xml !== 'string' || !xml.includes('<infoTable')) {
    throw new Error('[druckenmiller] 13F: das ist keine Informationstabelle (kein <infoTable> gefunden).');
  }
  const rows = [];
  for (const m of xml.matchAll(/<infoTable>([\s\S]*?)<\/infoTable>/g)) {
    const t = m[1];
    const cusip = feld(t, 'cusip');
    rows.push({
      issuer: feld(t, 'nameOfIssuer'),
      titleOfClass: feld(t, 'titleOfClass'),
      cusip: cusip ? cusip.toUpperCase() : null,
      valueRaw: zahl(feld(t, 'value')),
      shares: zahl(feld(t, 'sshPrnamt')),
      shareType: feld(t, 'sshPrnamtType'),
      putCall: feld(t, 'putCall'),
      discretion: feld(t, 'investmentDiscretion'),
    });
  }
  if (!rows.length) {
    throw new Error('[druckenmiller] 13F: die Informationstabelle traegt keine Zeile — eine leere '
      + 'Auslieferung saehe aus wie ein leeres Portfolio.');
  }
  return rows;
}

/**
 * Optionszeile? Der `putCall`-Tag ODER die CUSIP-Emissionsnummer (Stellen 7-8 in der Klasse
 * 90/95). Der zweite Weg ist der Lane-B-Fall 78463V907 (SPDR Gold Call ohne Tag).
 */
function isOption(row) {
  if (row && row.putCall) return { option: true, reason: 'putCall-tag' };
  const c = row && row.cusip;
  if (typeof c === 'string' && c.length >= 8 && OPTION_ISSUE_NUMBERS.includes(c.slice(6, 8))) {
    return { option: true, reason: 'cusip-issue-number' };
  }
  return { option: false, reason: null };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Welche Einheit meldet dieses Filing — Tausende oder Dollar? Entschieden wird am
 * impliedPrice = value * skala / shares: genau EINE Lesung muss im Plausibilitaetsband
 * liegen. Liegen beide oder keine darin, ist das Filing in Quarantaene.
 *
 * `closes` (optional, ticker/cusip -> Schlusskurs am Periodenende) macht die Probe scharf:
 * dann zaehlt nicht nur die Plausibilitaet, sondern das Verhaeltnis implied/close je Zeile,
 * und ueber der Fehlerquote von 10 % geht das Filing ebenfalls in Quarantaene.
 */
function detectUnits(rows, closes) {
  const mit = rows.filter((r) => Number.isFinite(r.valueRaw) && Number.isFinite(r.shares) && r.shares > 0
    && !isOption(r).option);
  if (!mit.length) {
    return { units: null, quarantine: true, reason: 'no-usable-row', mode: null, medianImplied: null,
      failShare: null, nChecked: 0 };
  }
  const kandidaten = [
    { units: 'dollars', skala: 1 },
    { units: 'thousands', skala: 1000 },
  ].map((k) => {
    const implied = mit.map((r) => (r.valueRaw * k.skala) / r.shares);
    const med = median(implied);
    return Object.assign({}, k, {
      medianImplied: med,
      imBand: med !== null && med >= IMPLIED_PRICE_MIN && med <= IMPLIED_PRICE_MAX,
    });
  });
  const passend = kandidaten.filter((k) => k.imBand);
  if (passend.length !== 1) {
    return {
      units: null, quarantine: true,
      reason: passend.length === 0 ? 'no-plausible-unit' : 'ambiguous-unit',
      mode: 'band-only', nChecked: mit.length, failShare: null,
      medianImplied: kandidaten.map((k) => ({ units: k.units, median: k.medianImplied })),
    };
  }
  const gewaehlt = passend[0];
  // Ohne Kursdaten bleibt es bei der Bandprobe — und das steht im Ergebnis, damit niemand
  // eine bandgepruefte Entscheidung fuer eine preisgepruefte haelt.
  if (!closes || typeof closes.get !== 'function') {
    return { units: gewaehlt.units, quarantine: false, reason: null, mode: 'band-only',
      medianImplied: gewaehlt.medianImplied, failShare: null, nChecked: mit.length };
  }
  let geprueft = 0, gescheitert = 0;
  for (const r of mit) {
    const close = closes.get(r.cusip) !== undefined ? closes.get(r.cusip) : closes.get(r.ticker);
    if (!Number.isFinite(close) || close <= 0) continue;
    geprueft++;
    const verhaeltnis = ((r.valueRaw * gewaehlt.skala) / r.shares) / close;
    if (!(verhaeltnis >= PRICE_RATIO_MIN && verhaeltnis <= PRICE_RATIO_MAX)) gescheitert++;
  }
  const failShare = geprueft ? gescheitert / geprueft : null;
  const quarantine = failShare !== null && failShare > QUARANTINE_FAIL_SHARE;
  return {
    units: gewaehlt.units, quarantine, reason: quarantine ? 'implied-price-fail-share' : null,
    mode: geprueft ? 'price-checked' : 'band-only',
    medianImplied: gewaehlt.medianImplied, failShare, nChecked: geprueft || mit.length,
  };
}

/** Normalform eines Emittentennamens: Rechtsformen und Interpunktion weg. */
const RECHTSFORMEN = ['incorporated', 'inc', 'corporation', 'corp', 'company', 'co', 'plc', 'llc',
  'lp', 'ltd', 'limited', 'sa', 'nv', 'ag', 'holdings', 'holding', 'group', 'the', 'class', 'cl',
  'com', 'new', 'trust', 'fund', 'etf'];
function normName(s) {
  if (typeof s !== 'string') return '';
  let t = s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ');
  t = t.split(/\s+/).filter((w) => w && !RECHTSFORMEN.includes(w)).join(' ');
  return t.trim();
}

/**
 * Emittentenname -> Ticker, ausschliesslich ueber die LOKALE Namenskarte
 * (`nameMap`: ticker -> name). Zwei Stufen: exakte Normalform, dann ein eindeutiger
 * Praefix-Treffer. Mehrdeutige Treffer werden VERWORFEN, nicht gewuerfelt.
 *
 * IDENTITAETS-WACHE (Lane-B-Red-Team): ein Treffer, dessen Name in der Karte NICHT zum
 * Filing-Namen passt, wird abgelehnt — genau der Barrick/ABX-Fall.
 */
function buildNameIndex(nameMap) {
  const index = new Map();
  for (const [ticker, name] of nameMap) {
    const n = normName(name);
    if (!n) continue;
    if (!index.has(n)) index.set(n, []);
    index.get(n).push({ ticker, name });
  }
  return index;
}

function mapIssuer(issuerName, nameIndex) {
  const n = normName(issuerName);
  if (!n) return { ticker: null, reason: 'no-name' };
  const exakt = nameIndex.get(n);
  if (exakt && exakt.length === 1) return { ticker: exakt[0].ticker, reason: 'exact', matchedName: exakt[0].name };
  if (exakt && exakt.length > 1) return { ticker: null, reason: 'ambiguous-exact' };
  const treffer = [];
  for (const [kandidat, liste] of nameIndex) {
    if (kandidat.startsWith(n + ' ') || n.startsWith(kandidat + ' ')) treffer.push(...liste);
  }
  const eindeutig = new Set(treffer.map((t) => t.ticker));
  if (eindeutig.size === 1) return { ticker: treffer[0].ticker, reason: 'prefix', matchedName: treffer[0].name };
  if (eindeutig.size > 1) return { ticker: null, reason: 'ambiguous-prefix' };
  return { ticker: null, reason: 'no-match' };
}

/**
 * Die Identitaets-Wache: der gefundene Ticker behaelt seinen Treffer nur, wenn der Name in
 * der Karte zum Filing-Namen passt (Normalform teilt mindestens das erste Wort und ist nicht
 * widersprechend). Sonst `null` mit Grund — nie stillschweigend.
 */
function identityOk(issuerName, mappedName) {
  const a = normName(issuerName), b = normName(mappedName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b + ' ') || b.startsWith(a + ' ')) return true;
  return a.split(' ')[0] === b.split(' ')[0];
}

/**
 * Ein Quartal in Vertragsform (arch-spec §3.2). `nameIndex` darf fehlen — dann bleibt jede
 * Zeile ohne Ticker, und die Abdeckung ist 0; das ist eine Aussage, kein Fehler.
 */
function buildQuarter(opts) {
  const { period, filedAt, acceptedAt, xml, nameIndex, closes, previousCusips, now } = opts;
  const rows = parseInfoTable(xml);
  const einheit = detectUnits(rows, closes);
  const skala = einheit.units === 'thousands' ? 1000 : 1;
  const ausgabe = [];
  let gesamt = 0, gemappt = 0;
  for (const r of rows) {
    const opt = isOption(r);
    const wert = Number.isFinite(r.valueRaw) && einheit.units ? r.valueRaw * skala : null;
    let ticker = null, mapReason = 'no-map';
    if (nameIndex) {
      const t = mapIssuer(r.issuer, nameIndex);
      mapReason = t.reason;
      if (t.ticker && identityOk(r.issuer, t.matchedName)) ticker = t.ticker;
      else if (t.ticker) mapReason = 'identity-mismatch';
    }
    const implied = Number.isFinite(wert) && Number.isFinite(r.shares) && r.shares > 0
      ? wert / r.shares : null;
    ausgabe.push({
      cusip: r.cusip, ticker, issuer: r.issuer,
      valueUSD: wert, shares: r.shares,
      putCall: opt.option ? (r.putCall || 'CALL?') : null,
      optionReason: opt.option ? opt.reason : null,
      mapReason,
      impliedPriceOk: implied === null ? null
        : (implied >= IMPLIED_PRICE_MIN && implied <= IMPLIED_PRICE_MAX),
    });
    if (!opt.option && Number.isFinite(wert)) {
      gesamt += wert;
      if (ticker) gemappt += wert;
    }
  }
  const langZeilen = ausgabe.filter((z) => z.putCall === null && Number.isFinite(z.valueUSD));
  const sortiert = langZeilen.slice().sort((a, b) => b.valueUSD - a.valueUSD);
  const top10 = sortiert.slice(0, 10).reduce((s, z) => s + z.valueUSD, 0);
  const jetzt = new Set(langZeilen.map((z) => z.cusip));
  const vorher = previousCusips instanceof Set ? previousCusips : null;
  return {
    period, filedAt: filedAt || null, acceptedAt: acceptedAt || null,
    ageDays: acceptedAt && now ? Math.round((now - new Date(acceptedAt)) / 86400000) : null,
    units: einheit.units, unitCheck: einheit,
    totalValueUSD: gesamt || null,
    positions: langZeilen.length,
    top10Share: gesamt > 0 ? top10 / gesamt : null,
    coverage: gesamt > 0 ? gemappt / gesamt : null,
    rows: ausgabe,
    new: vorher ? [...jetzt].filter((c) => !vorher.has(c)).sort() : null,
    exited: vorher ? [...vorher].filter((c) => !jetzt.has(c)).sort() : null,
    quarantined: einheit.quarantine === true,
    quarantineReason: einheit.quarantine ? einheit.reason : null,
  };
}

/**
 * Der dreiwertige Join auf eine Board-Zeile ([REV1-A4]/[REV4-6]):
 *   HELD            — der Ticker steht in den zugeordneten Positionen
 *   NOT_IN_MAPPED   — er steht nicht darin, aber die Zuordnung ist unvollstaendig
 *   UNMAPPED        — es gibt fuer dieses Quartal keine brauchbare Zuordnung
 * NIE "nicht gehalten": die Abdeckung ist kleiner als eins, und das Etikett darf nicht mehr
 * behaupten als die Daten tragen (deutsche Anzeige: "nicht unter den zugeordneten Positionen").
 */
function triStateFor(ticker, heldTickers, coverage) {
  if (!(heldTickers instanceof Set) || heldTickers.size === 0) return 'UNMAPPED';
  if (!Number.isFinite(coverage) || coverage <= 0) return 'UNMAPPED';
  if (ticker && heldTickers.has(ticker)) return 'HELD';
  return 'NOT_IN_MAPPED';
}

/**
 * Abdeckung der lokalen Namenskarte ueber eine Emittentenliste (spec §0.6: "the
 * name-matcher's standalone coverage ... is measured in chunk 3 and reported").
 */
function matcherCoverage(issuers, nameIndex) {
  let getroffen = 0, mehrdeutig = 0, identitaet = 0;
  for (const i of issuers) {
    const t = mapIssuer(i.issuer, nameIndex);
    if (t.ticker && identityOk(i.issuer, t.matchedName)) getroffen++;
    else if (t.ticker) identitaet++;
    else if (String(t.reason).startsWith('ambiguous')) mehrdeutig++;
  }
  return { n: issuers.length, matched: getroffen, ambiguous: mehrdeutig,
    identityRejected: identitaet, share: issuers.length ? getroffen / issuers.length : null };
}

module.exports = {
  IMPLIED_PRICE_MIN, IMPLIED_PRICE_MAX, QUARANTINE_FAIL_SHARE, PRICE_RATIO_MIN, PRICE_RATIO_MAX,
  QUARTERS_PUBLISHED, OPTION_ISSUE_NUMBERS, TRI_STATE,
  parseInfoTable, isOption, detectUnits, normName, buildNameIndex, mapIssuer, identityOk,
  buildQuarter, triStateFor, matcherCoverage, median,
};
