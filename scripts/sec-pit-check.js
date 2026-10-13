'use strict';
/**
 * scripts/sec-pit-check.js — Einrichtung + Realdaten-Beweis des SEC-PIT-Fundaments
 * (E-20260719-2; Konsum: Backtests B1 ff., _BACKTEST-KATALOG-frueher-finden).
 *
 * Macht drei Dinge, alle idempotent:
 *  1. company_tickers.json in den Cache laden, falls sie fehlt (sec.gov, gratis).
 *     Netz-Regel wie probe-smallcap-coverage.js: OHNE SEC_CONTACT (Mail-Adresse
 *     für den User-Agent) bricht das Skript VOR jedem Request hart ab.
 *  2. Coverage messen: wie viele Ticker des heutigen gescorten Universums
 *     (outputs/hypergrowth/full) haben einen CIK-Eintrag im companyfacts.zip.
 *  3. PIT-BEWEIS an CRDO (verifizierte Katalog-Zahlen, Fiskaljahr endet ~April):
 *     (a) Die jüngsten Quartalsumsätze aus dem PIT-Reader müssen die bekannten
 *         Werte treffen (407/268/223/170/135 Mio USD, neuest→alt, ±2 %).
 *     (b) Look-ahead-Beweis: Der Q-Gewinn ~157 Mio USD (Quartal Ende ~01/2026,
 *         gemeldet Anfang März 2026) darf am Stichtag 2026-01-30 NICHT sichtbar
 *         sein und MUSS am 2026-04-30 sichtbar sein — exakt der Katalog-Fall
 *         „die 157-Mio-Zahl war am 30.03. noch nicht gemeldet" (dort mit dem
 *         30.03. als Kaufzeitpunkt; wir testen beidseitig um das filed-Datum).
 *     Schlägt (a) oder (b) fehl -> Exit 1 (fail-loud, kein „wird schon passen").
 *
 * Usage: SEC_CONTACT=mail@example.com node scripts/sec-pit-check.js
 *        (SEC_CONTACT nur nötig, wenn company_tickers.json noch fehlt)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const secPit = require('../lib/sec-pit.js');
const { writeFileAtomic } = require('../lib/atomic-write.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const FULL_DIR = path.join(REPO_ROOT, 'outputs', 'hypergrowth', 'full');
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
// CRDO-Anker (Katalog „Verifizierte Daten-Fakten", 16.07.2026): Umsätze Mio USD neuest->alt
// = 407/268/223/170/135. Das 170M-Quartal ist CRDOs FISKAL-Q4 (FY-Ende ~Anfang Mai) — SEC-
// Filer melden Q4 nie als Einzelquartal (nur FY im 10-K), die diskrete XBRL-Serie hat dort
// strukturell ein Loch (Katalog-Regel: „Q4 ausschliesslich als FY minus 9M abgeleitet").
// Diskrete Anker daher OHNE die 170; die 170 wird unten separat als ABLEITUNGS-Beweis
// rekonstruiert (FY-Wert minus Summe der diskreten Quartale im Fiskaljahr).
const CRDO_REV_EXPECTED_M = [407, 268, 223, 135];
const CRDO_Q4_DERIVED_M = 170;             // erwartetes abgeleitetes Fiskal-Q4 (Mio USD)
const CRDO_REV_TOL = 0.02;                 // ±2 % (Rundung Katalog vs. XBRL-Rohwert)
const CRDO_NI_Q_MIN_M = 140, CRDO_NI_Q_MAX_M = 175;  // „~157 Mio" mit Luft
const LOOKAHEAD_BEFORE = '2026-01-30';     // vor dem Filing des 157-Mio-Quartals
const LOOKAHEAD_AFTER = '2026-04-30';      // sicher danach

function downloadTickers(dest) {
  const contact = process.env.SEC_CONTACT;
  if (!contact || !/@/.test(contact) || /[\r\n]/.test(contact)) {
    throw new Error('SEC_CONTACT fehlt/unbrauchbar: Download von company_tickers.json braucht '
      + 'eine Kontakt-Mail als SEC-User-Agent (Repo-Regel, vgl. probe-smallcap-coverage.js). '
      + 'Es wurde KEIN Request gesendet.');
  }
  return new Promise((resolve, reject) => {
    const req = https.get(TICKERS_URL, {
      headers: { 'User-Agent': 'screener-data research ' + contact, 'Accept-Encoding': 'identity' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' für ' + TICKERS_URL)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const buf = Buffer.concat(chunks);
          JSON.parse(buf.toString('utf8')); // Parse-Gate VOR dem Schreiben
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          // T204 Welle 5: das Parse-Gate oben prueft den EMPFANGENEN Puffer — es sagt
          // nichts darueber, was nach einem Abbruch mitten im Schreiben auf Platte liegt.
          // Ein Bruchstueck hier vergiftet den Cache DAUERHAFT: main() laedt nur nach,
          // wenn `!fs.existsSync(TICKER_INDEX_PATH)`, und ein Bruchstueck existiert. Jeder
          // spaetere Lauf faellt dann in loadTickerMap() auf JSON.parse — bis jemand die
          // Datei von Hand loescht. Der Ticker->CIK-Index entscheidet, welche Firmen
          // ueberhaupt in den B1-Pool kommen.
          writeFileAtomic(dest, buf);
          resolve(buf.length);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
}

function universeTickers() {
  if (!fs.existsSync(FULL_DIR)) return [];
  const out = new Set();
  for (const f of fs.readdirSync(FULL_DIR)) {
    if (!f.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(FULL_DIR, f), 'utf8'));
    const rows = Array.isArray(data) ? data : [].concat(data.profitable || [], data.unprofitable || []);
    for (const r of rows) if (r && r.ticker) out.add(String(r.ticker).toUpperCase());
  }
  return Array.from(out);
}

function fmtM(v) { return (v / 1e6).toFixed(1) + 'M'; }

async function main() {
  // 1) Ticker-Index sicherstellen
  if (!fs.existsSync(secPit.TICKER_INDEX_PATH)) {
    console.log('[sec-pit-check] company_tickers.json fehlt -> Download von sec.gov ...');
    const bytes = await downloadTickers(secPit.TICKER_INDEX_PATH);
    console.log('[sec-pit-check] company_tickers.json geladen (' + Math.round(bytes / 1024) + ' KB)');
  } else {
    console.log('[sec-pit-check] company_tickers.json vorhanden: ' + secPit.TICKER_INDEX_PATH);
  }

  // 2) Store öffnen + Universe-Coverage
  const store = secPit.openStore();
  console.log('[sec-pit-check] companyfacts.zip: ' + store.zipPath);
  const uni = universeTickers();
  let withCik = 0, inZip = 0;
  for (const t of uni) {
    const cik = store.cikForTicker(t);
    if (cik == null) continue;
    withCik++;
    if (store.hasCik(cik)) inZip++;
  }
  console.log('[sec-pit-check] Universe-Coverage: ' + uni.length + ' gescorte Ticker, '
    + withCik + ' mit CIK (' + (uni.length ? Math.round(100 * withCik / uni.length) : 0) + ' %), '
    + inZip + ' mit companyfacts-Eintrag (' + (uni.length ? Math.round(100 * inZip / uni.length) : 0) + ' %). '
    + 'Nicht-US-Listings ohne SEC-Pflicht fehlen erwartungsgemäß.');

  // 3) CRDO-PIT-Beweis
  const facts = store.factsForTicker('CRDO');
  if (!facts) throw new Error('CRDO nicht im Store auflösbar (Ticker-Index oder Zip unvollständig).');

  // (a) jüngste Quartalsumsätze gegen Katalog-Anker
  const rev = secPit.pitSeries(facts, secPit.REV_CONCEPTS, { period: 'quarterly' });
  if (rev.series.length < CRDO_REV_EXPECTED_M.length) {
    throw new Error('CRDO-Umsatzserie zu kurz: ' + rev.series.length + ' Quartale (Konzept ' + rev.concept + ')');
  }
  const got = rev.series.slice(0, CRDO_REV_EXPECTED_M.length);
  got.forEach((p, i) => {
    const exp = CRDO_REV_EXPECTED_M[i] * 1e6;
    const dev = Math.abs(p.val - exp) / exp;
    if (dev > CRDO_REV_TOL) {
      throw new Error('CRDO-Umsatz-Anker verfehlt: Q[' + i + '] (' + p.end + ') = ' + fmtM(p.val)
        + ', erwartet ~' + CRDO_REV_EXPECTED_M[i] + 'M (Abweichung ' + (100 * dev).toFixed(1) + ' %)');
    }
  });
  console.log('[sec-pit-check] CRDO-Umsatz-Anker GRÜN (' + rev.concept + '): '
    + got.map((p) => fmtM(p.val) + '@' + p.end + ' filed ' + p.filed).join(' · '));

  // (a2) Fiskal-Q4-Ableitungs-Beweis: FY-Wert minus Summe der diskreten Quartale
  // innerhalb des Fiskaljahres muss das fehlende Q4 (~170M) rekonstruieren.
  const revAnnual = secPit.pitSeries(facts, secPit.REV_CONCEPTS, { period: 'annual' });
  let derivedOk = false;
  for (const fy of revAnnual.series) {
    if (!fy.start) continue;
    const inFy = rev.series.filter((q) => q.end > fy.start && q.end <= fy.end);
    if (inFy.length !== 3) continue; // Ableitung braucht exakt die 3 gemeldeten Quartale
    const derived = fy.val - inFy.reduce((s, q) => s + q.val, 0);
    const exp = CRDO_Q4_DERIVED_M * 1e6;
    if (Math.abs(derived - exp) / exp <= CRDO_REV_TOL) {
      console.log('[sec-pit-check] Q4-Ableitungs-Beweis GRÜN: FY ' + fy.end + ' (' + fmtM(fy.val)
        + ') − 3 diskrete Quartale = ' + fmtM(derived) + ' ≈ ' + CRDO_Q4_DERIVED_M + 'M');
      derivedOk = true;
      break;
    }
  }
  if (!derivedOk) {
    throw new Error('Q4-Ableitungs-Beweis verfehlt: kein Fiskaljahr rekonstruiert ~'
      + CRDO_Q4_DERIVED_M + 'M (annual-Konzept ' + revAnnual.concept + ', '
      + revAnnual.series.length + ' FY-Punkte).');
  }

  // (b) Look-ahead-Beweis am Q-Gewinn ~157M
  const niBefore = secPit.pitSeries(facts, secPit.NET_INCOME_CONCEPTS, { asOf: LOOKAHEAD_BEFORE, period: 'quarterly' });
  const niAfter = secPit.pitSeries(facts, secPit.NET_INCOME_CONCEPTS, { asOf: LOOKAHEAD_AFTER, period: 'quarterly' });
  const isBig = (p) => p.val >= CRDO_NI_Q_MIN_M * 1e6 && p.val <= CRDO_NI_Q_MAX_M * 1e6;
  const bigBefore = niBefore.series.find(isBig);
  const bigAfter = niAfter.series.find(isBig);
  if (bigBefore) {
    throw new Error('LOOK-AHEAD-LECK: Der ~157M-Quartalsgewinn (' + fmtM(bigBefore.val) + ', end '
      + bigBefore.end + ', filed ' + bigBefore.filed + ') ist am ' + LOOKAHEAD_BEFORE + ' sichtbar — darf er nicht.');
  }
  if (!bigAfter) {
    throw new Error('PIT-Beweis unvollständig: Der ~157M-Quartalsgewinn ist auch am '
      + LOOKAHEAD_AFTER + ' nicht sichtbar (Konzept ' + niAfter.concept + ', '
      + niAfter.series.length + ' Punkte) — Anker prüfen.');
  }
  console.log('[sec-pit-check] Look-ahead-Beweis GRÜN: ' + fmtM(bigAfter.val) + ' (end ' + bigAfter.end
    + ', filed ' + bigAfter.filed + ') unsichtbar am ' + LOOKAHEAD_BEFORE + ', sichtbar am ' + LOOKAHEAD_AFTER + '.');

  // Bonus-Ausweis (kein Gate): Shares-Historie vorhanden?
  const sh = secPit.sharesHistory(facts);
  console.log('[sec-pit-check] CRDO Shares-Historie: ' + sh.length + ' Stände, neuester '
    + (sh[0] ? (sh[0].val / 1e6).toFixed(1) + 'M @' + sh[0].end : '—'));

  store.close();
  console.log('[sec-pit-check] ALLES GRÜN — PIT-Fundament einsatzbereit für B1.');
}

main().catch((e) => { console.error('[sec-pit-check] ROT: ' + (e && e.message || e)); process.exit(1); });
