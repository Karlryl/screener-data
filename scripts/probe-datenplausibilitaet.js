'use strict';
/**
 * Datenplausibilitaet eines ausgelieferten Board-Stands — wiederholbar.
 *
 * WOZU: Karl hat am 27.07.2026 beim Draufschauen eine Firma gefunden, deren Zahlen sich
 * gegenseitig ausschlossen (Zealand Pharma: Bruttomarge 100 % neben operativer Marge
 * -1.585 %, dazu Rang 1 auf Grundlage eines einmaligen Lizenzertrags). Sein Auftrag danach:
 * "nicht dass ich morgen aufstehe und dann sind da Unternehmen mit falschen Zahlen."
 *
 * Die Pruefung von jener Nacht steckte in Wegwerf-Skripten. Dieses Werkzeug macht sie
 * wiederholbar — jederzeit gegen einen frischen CI-Stand laufen lassen.
 *
 * DIE ENTSCHEIDENDE TRENNUNG, ohne die das Ergebnis Panik statt Diagnose ist:
 *   RANG    = der Platz selbst steht auf wackligem Grund (eine Achse rechnet mit dem Wert)
 *   ANZEIGE = der Rang stimmt, eine angezeigte Zahl ist daneben
 * Am 27.07. waren von 58 auffaelligen Firmen nur FUENF rang-relevant. Ohne die Trennung
 * haette die Meldung "58 von 199 Firmen fehlerhaft" gelautet — richtig gezaehlt und
 * trotzdem irrefuehrend.
 *
 * Aufruf:
 *   node scripts/probe-datenplausibilitaet.js <snapshot-ordner> <board-export.json>
 *
 * Der Snapshot-Ordner sollte der eines CI-Laufs sein (gh run download <RUN_ID> -n snapshots) —
 * der lokale snapshots/-Ordner ist seit dem 17.05.2026 eingefroren und beweist nichts.
 */
const fs = require('node:fs');
const path = require('node:path');

const [ordner, boardDatei] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!ordner || !boardDatei) {
  console.error('Aufruf: node scripts/probe-datenplausibilitaet.js <snapshot-ordner> <board-export.json>');
  process.exit(2);
}
for (const p of [ordner, boardDatei]) {
  if (!fs.existsSync(p)) { console.error('nicht gefunden: ' + p); process.exit(2); }
}

const wert = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const ist = (x) => typeof x === 'number' && Number.isFinite(x);
const reihe = (o, k) => (Array.isArray(o && o[k]) ? o[k].map(wert) : []);

const board = JSON.parse(fs.readFileSync(boardDatei, 'utf8'));
const zeilen = [].concat(board.rows || [], board.profitable || [], board.unprofitable || [])
  .filter((r) => r && typeof r.ticker === 'string');
if (!zeilen.length) { console.error('Board-Datei enthaelt keine Zeilen.'); process.exit(2); }

const funde = [];
const melde = (z, art, regel, text) => funde.push({ art, regel, rang: z.rank, ticker: z.ticker, name: z.name, text });

let geprueft = 0;
for (const z of zeilen) {
  const p = path.join(ordner, z.ticker + '.json');
  if (!fs.existsSync(p)) continue;
  let s;
  try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  geprueft += 1;
  const m = s.metrics || {};

  // --- RANG-relevant: der Score steht auf einem Einmalertrag -------------------------
  // Ein Quartal traegt den Jahresumsatz. Bei vier gleich grossen Quartalen liegt der Wert
  // bei 0,25; am 27.07. lag der Median bei 0,301 und p90 bei 0,374.
  const rq = reihe(s.timeseries || {}, 'revenueQ').slice(0, 4);
  if (rq.length === 4 && rq.every((v) => ist(v) && v > 0)) {
    const konz = Math.max(...rq) / rq.reduce((a, b) => a + b, 0);
    if (konz >= 0.50) {
      melde(z, 'RANG', 'einmalertrag',
        `ein Quartal traegt ${(konz * 100).toFixed(0)} % des Jahresumsatzes`);
    }
  }

  // --- ANZEIGE: Margen, die sich gegenseitig ausschliessen ---------------------------
  // EBITDA ist das operative Ergebnis VOR Abschreibungen, also nie kleiner.
  const eb = wert(m.ebitdaMargins), op = wert(m.operatingMargin);
  if (ist(eb) && ist(op) && op - eb > 2) {
    melde(z, 'ANZEIGE', 'margenbruch',
      `EBITDA-Marge ${(op - eb).toFixed(1)} Punkte UNTER der operativen`);
  }

  // --- ANZEIGE: Kurs-Umsatz-Verhaeltnis in gemischter Waehrung -----------------------
  // Die Abweichungsfaktoren waren am 27.07. echte Wechselkurse (ARS 1501, CLP 948,
  // IDR 10.000, HKD 7,8, SAR 3,75, CAD 1,41).
  const ps = wert(m.priceSales), rev = wert(m.revenueTTM);
  const mc = ist(z.marketCap) ? z.marketCap : null;
  if (ist(ps) && ps > 0 && ist(rev) && rev > 0 && mc) {
    const q = (mc / rev) / ps;
    if (q > 1.5 || q < 0.67) {
      melde(z, 'ANZEIGE', 'waehrungsmischung',
        `Kurs-Umsatz-Verhaeltnis um Faktor ${(q > 1 ? q : 1 / q).toFixed(1)} daneben`);
    }
  }

  // --- ANZEIGE: negativer Unternehmenswert ------------------------------------------
  if (ist(wert(m.enterpriseValue)) && wert(m.enterpriseValue) < 0) {
    melde(z, 'ANZEIGE', 'ev-negativ', 'Unternehmenswert negativ ausgewiesen');
  }

  // --- ANZEIGE: Boersendebuet aus einer Zweitnotiz -----------------------------------
  const ftd = s.meta && s.meta.firstTradeDate ? String(s.meta.firstTradeDate).slice(0, 10) : null;
  if (ftd && Number(ftd.slice(0, 4)) >= new Date().getUTCFullYear() - 1 && z.ipoRecency === 'recent') {
    melde(z, 'ANZEIGE', 'junge-notiz',
      `gilt als Neuemission — erster Handelstag ${ftd} (Zweitnotiz?)`);
  }

  // --- STRUKTUR: Rohertrag groesser als Umsatz --------------------------------------
  const rv = reihe(s.annual || {}, 'annualRev').filter(ist);
  const gp = reihe(s.annual || {}, 'annualGP').filter(ist);
  let ueber = 0;
  for (let i = 0; i < Math.min(rv.length, gp.length); i += 1) if (rv[i] > 0 && gp[i] > rv[i] * 1.005) ueber += 1;
  if (ueber > 0) melde(z, 'ANZEIGE', 'rohertrag-ueber-umsatz', `${ueber} Jahr(e) mit Rohertrag ueber Umsatz`);

  // --- STRUKTUR: Marktkapital gegen Kurs mal Aktienzahl ------------------------------
  // Faengt Split- und Waehrungsfehler an der Wurzel. Am 27.07.: NULL Treffer bei 199 Zeilen.
  const kurs = s.price && ist(wert(s.price.close)) ? wert(s.price.close) : null;
  const aktien = reihe(s.annual || {}, 'annualShares').filter(ist)[0] || null;
  if (kurs != null && aktien && aktien > 0 && mc && mc > 0) {
    const f = (kurs * aktien) / mc;
    if (f > 1.3 || f < 0.7) {
      melde(z, 'RANG', 'marktkapital-inkonsistent',
        `Kurs x Aktienzahl weicht um Faktor ${f.toFixed(2)} vom Marktkapital ab`);
    }
  }
}

// --- Ausgabe -----------------------------------------------------------------------
const rangF = funde.filter((f) => f.art === 'RANG');
const anzeigeF = funde.filter((f) => f.art === 'ANZEIGE');
const betroffen = new Set(funde.map((f) => f.ticker));

console.log('Board-Zeilen        : ' + zeilen.length);
console.log('davon mit Rohdaten  : ' + geprueft);
console.log('betroffene Firmen   : ' + betroffen.size);
console.log('   davon RANG-relevant (der Platz wackelt) : ' + new Set(rangF.map((f) => f.ticker)).size);
console.log('   nur ANZEIGE (Rang stimmt)               : ' + new Set(anzeigeF.map((f) => f.ticker)).size);
console.log('');

const proRegel = {};
for (const f of funde) proRegel[f.regel] = (proRegel[f.regel] || 0) + 1;
console.log('Treffer je Regel:');
for (const [r, n] of Object.entries(proRegel).sort((a, b) => b[1] - a[1])) {
  console.log('   ' + String(n).padStart(4) + 'x  ' + r);
}
console.log('');

if (rangF.length) {
  console.log('=== RANG-RELEVANT — hier lohnt der zweite Blick ===');
  for (const f of rangF.sort((a, b) => (a.rang || 0) - (b.rang || 0))) {
    console.log(`  Rang ${String(f.rang ?? '?').padStart(4)}  ${f.ticker.padEnd(14)}${String(f.name || '').slice(0, 30).padEnd(31)}${f.text}`);
  }
  console.log('');
}
if (anzeigeF.length) {
  console.log('=== NUR ANZEIGE — der Rang stimmt (erste 25) ===');
  for (const f of anzeigeF.sort((a, b) => (a.rang || 0) - (b.rang || 0)).slice(0, 25)) {
    console.log(`  Rang ${String(f.rang ?? '?').padStart(4)}  ${f.ticker.padEnd(14)}${f.text}`);
  }
  if (anzeigeF.length > 25) console.log(`  ... und ${anzeigeF.length - 25} weitere`);
}
console.log('');
console.log('Hinweis: dieses Werkzeug MELDET nur. Kein Fund ist fuer sich ein Defekt —');
console.log('jeder gehoert an der Rohdatei nachgerechnet, bevor er als Fehler gilt.');
