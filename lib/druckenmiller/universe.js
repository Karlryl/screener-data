'use strict';
/**
 * lib/druckenmiller/universe.js — U, die Grundgesamtheit des Moduls.
 *
 * EINGEFROREN durch Rat-Entscheid D4 (2026-09-14, 88 %):
 *   country === "United States"  ·  Ticker ohne "."  ·  keine Daten-Verdachts-Lampe
 *   ·  >= 250 Balken im rollenden Preis-Store.
 * Jede Umdefinition ist eine NEUE Serien-ID — deshalb faehrt der Tages-Hash der
 * Mitgliederliste in jeder Ledger-Zeile mit: wer die Regel spaeter anfasst, sieht den
 * Bruch in den Daten, nicht nur im Diff.
 *
 * F-16 (gesperrte Klasse bis Ende Oktober, screener-data/CLAUDE.md): dieses Modul kennt
 * KEINE Notierungs-Identitaet, kein Boersen-Mapping und keine Umrechnung. Der Suffix-Test
 * ist ein reiner String-Test auf den Punkt. Waechter: tests/druckenmiller/f16-guard.test.js.
 *
 * QUELLE MERGE-SEITIG (Abweichung, bewusst und protokolliert): die Operationalisierung
 * definiert U auf den EXPORT-Zeilen (outputs/findash-export/v1/full/*). Dieses Verzeichnis
 * entsteht erst im scoring-Job; der Logger laeuft im merge-Job, wo es die Datei nicht gibt
 * (outputs/ ist gitignored, .gitignore:50). Gelesen werden deshalb die frisch gefilterten
 * snapshots/ — dieselbe Quelle, aus der der Export seine Zeilen baut, nur ohne dessen
 * scoring-seitige Zusatzschnitte. Die Roh-Zeilen je Ticker (raw/<date>.jsonl.gz) halten
 * jeden Kandidaten einzeln fest, sodass Chunk 1 dieselben Tage jederzeit auf die
 * export-definierte Teilmenge nachrechnen kann.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIN_BARS = 250;

// Rat D3: der Split ist eingefroren; Yahoo-`sector`-Vokabular.
const CYCLICAL_SECTORS = ['Industrials', 'Consumer Cyclical', 'Energy', 'Financial Services', 'Basic Materials'];
const DEFENSIVE_SECTORS = ['Consumer Defensive', 'Healthcare', 'Utilities'];
// Alles andere (Technology, Real Estate, Communication Services, fehlend) ist SICHTBAR
// "nicht zugeordnet" — Rat D3 verlangt den Eimer ausdruecklich, statt ihn wegzudefinieren.

// L4b, seine namentlich genannten zyklischen Branchen [A-TEC-015]. Yahoo-`industry`-
// Vokabular, EINMAL gemappt und hier eingefroren; Teilstring-Vergleich in Kleinschreibung,
// weil Yahoo mehrere Schreibweisen fuehrt ("Specialty Retail", "Apparel Retail").
const NAMED_BASKET_INDUSTRIES = ['trucking', 'specialty retail', 'department stores', 'residential construction'];

// Die Daten-Verdachts-Lampen des Snapshots (pull-yahoo.js:293/4218/4237). Beide sind
// Feldnamen aus dem bestehenden Vertrag, keine eigene Logik dieses Moduls.
const SUSPECT_FLAGS = ['_newestQtrSuspect', '_annualCurrencyLeakSuspect'];

/** Reiner String-Test (D4). Kein Boersen-Wissen, kein Suffix-Katalog. */
function hasSuffix(ticker) {
  return String(ticker).includes('.');
}

/**
 * Warum ein Ticker NICHT in U ist — oder null, wenn er drin ist. Ein Grund statt eines
 * Booleans, damit der Tages-Log sagen kann, WORAN U haengt (und ein Kippen der Zusammen-
 * setzung nicht als "U ist halt kleiner" durchgeht).
 */
function candidateReason(meta, bars) {
  if (!meta || meta.country !== 'United States') return 'country';
  if (hasSuffix(meta.ticker)) return 'suffix';
  for (const flag of SUSPECT_FLAGS) if (meta[flag]) return 'suspect';
  if (!(Number.isFinite(bars) && bars >= MIN_BARS)) return 'bars';
  return null;
}

/**
 * Billiger Vorfilter auf dem Dateinamen: <ticker>.json mit genau einem Punkt, keine
 * Metadatei (_manifest.json). Spart im merge-Job zwei Drittel der 15.000 Datei-Parses;
 * er darf nur wegwerfen, was candidateReason ohnehin verwerfen wuerde (U7 prueft beides).
 */
function filenameMayBeCandidate(name) {
  return /^[^._][^.]*\.json$/.test(name);
}

function sectorClass(sector) {
  if (CYCLICAL_SECTORS.includes(sector)) return 'cyclical';
  if (DEFENSIVE_SECTORS.includes(sector)) return 'defensive';
  return 'unassigned';
}

function inNamedBasket(industry) {
  if (!industry) return false;
  const s = String(industry).toLowerCase();
  return NAMED_BASKET_INDUSTRIES.some((n) => s.includes(n));
}

/**
 * L5-Rohwert: Netto-Revisionen der +1y-Schaetzung ueber 30 Tage. null = KEINE Abdeckung
 * (nie 0 — "kein Analyst schaut hin" und "die Analysten halten still" sind verschiedene
 * Aussagen, und nur die zweite darf in den Zaehler).
 */
function netRevision30(estimateRevisions) {
  const e = estimateRevisions && estimateRevisions['+1y'];
  if (!e) return null;
  const up = e.upLast30Days, down = e.downLast30Days;
  if (!Number.isFinite(up) || !Number.isFinite(down)) return null;
  return up - down;
}

/**
 * Marktkapitalisierung aus dem Snapshot. BEFUND beim ersten echten Lauf (14.09.2026):
 * snapshots/<t>.json fuehrt marketCap als OBJEKT {value, source, confidence, asOf} — der
 * Export entpackt es erst spaeter. Ein blankes Number.isFinite(snap.marketCap) war damit
 * IMMER false, und die kapitalgewichteten Achsen (L4cw, L8) standen still auf null,
 * ohne dass irgendetwas rot wurde. Beide Formen werden gelesen; alles andere ist null.
 * KEINE Umrechnung, keine Einheiten-Annahme: U ist per D4 rein US, damit stellt sich
 * die Frage nicht (F-16).
 */
function marketCapValue(feld) {
  if (Number.isFinite(feld)) return feld;
  if (feld && typeof feld === 'object' && Number.isFinite(feld.value)) return feld.value;
  return null;
}

/** sha256 ueber die sortierte Mitgliederliste — Reihenfolge egal, Menge nicht. */
function universeHash(tickers) {
  return crypto.createHash('sha256').update(tickers.slice().sort().join('\n'), 'utf8').digest('hex');
}

/**
 * Kandidaten aus snapshots/ lesen: alles, was OHNE Preise schon entscheidbar ist
 * (country, Suffix, Verdachtslampen) plus die Merkmale, die die Achsen brauchen.
 * Die Balken-Bedingung kommt spaeter, beim Lauf ueber die Preis-Shards.
 */
function loadCandidates(snapshotsDir) {
  const out = new Map();
  // REVIEW-FUND: ein kaputter Einzel-Snapshot ist ein Ticker weniger — vertretbar. Was
  // fehlte, war der ZAEHLER: ein systemisches Snapshot-Problem (abgebrochene Schreibvorgaenge)
  // nimmt einen beliebigen Anteil aus U, und die Tageszeile saehe kerngesund aus.
  out.unreadable = 0;
  for (const name of fs.readdirSync(snapshotsDir)) {
    if (!filenameMayBeCandidate(name)) continue;
    let snap;
    try { snap = JSON.parse(fs.readFileSync(path.join(snapshotsDir, name), 'utf8')); }
    catch { out.unreadable++; continue; }
    const meta = snap && snap.meta;
    if (!meta) { out.unreadable++; continue; }
    const ticker = meta.ticker || name.replace(/\.json$/, '');
    // Balken unbekannt -> MIN_BARS uebergeben, damit hier nur country/Suffix/Lampen greifen.
    if (candidateReason(Object.assign({}, meta, { ticker }), MIN_BARS) !== null) continue;
    out.set(ticker, {
      ticker,
      sector: meta.sector || null,
      industry: meta.industry || null,
      marketCap: marketCapValue(snap.marketCap),
      netRevision30: netRevision30(snap.external && snap.external.estimateRevisions),
    });
  }
  return out;
}

module.exports = {
  MIN_BARS, CYCLICAL_SECTORS, DEFENSIVE_SECTORS, NAMED_BASKET_INDUSTRIES, SUSPECT_FLAGS,
  hasSuffix, candidateReason, filenameMayBeCandidate, sectorClass, inNamedBasket,
  netRevision30, universeHash, loadCandidates, marketCapValue,
};
