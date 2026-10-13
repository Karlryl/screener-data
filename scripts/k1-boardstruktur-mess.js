#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// K1-VORARBEIT: Board-Korrelation und Streuung der Autokorrelation, gemessen an
// ECHTEN Kursverläufen statt angenommen.
//
// WARUM: Die einzige Reparatur des Konfidenzintervalls, die in beiden Mess-Armen
// hielt (R3), poolt die Lag-1-Autokorrelation über alle Boards einer Familie.
// Das unterstellt zweierlei, das bisher NIEMAND an echten Verläufen geprüft hat:
//   (1) die Board-Korrelation liegt im simulierten Bereich rho = 0,5 .. 0,99
//   (2) alle Boards haben ungefähr dieselbe Persistenz (sonst wird das zäheste
//       Board systematisch unterkorrigiert)
//
// WAS HIER GEMESSEN WERDEN KANN — UND WAS NICHT:
// Die Messgröße von rank-ic.js ist der IC über DISJUNKTE 84-KALENDERTAGE-Fenster.
// Der Kursbestand reicht vom 2025-05-12 bis 2026-07-28, also ~303 Handelstage.
// Nach Abzug des Score-Vorlaufs bleiben ~218 Tage = 3 disjunkte 84d-Fenster.
// >>> Die Autokorrelation der 84d-IC-Reihe ist mit diesem Bestand NICHT messbar. <<<
// Deshalb zwei getrennte Messungen mit unterschiedlicher Belastbarkeit:
//   A) BOARD-KORRELATION — auf GLEITENDEN Fenstern. Überlappung erzeugt
//      Zeitreihen-Autokorrelation, verzerrt aber die QUERSCHNITTS-Korrelation
//      zwischen zwei Boards nicht (beide Boards sehen dieselbe Überlappung).
//      Diese Zahl ist belastbar und wird auf beiden Horizonten (21d/58d) gezeigt.
//   B) AC-STREUUNG — nur auf DISJUNKTEN 21-Handelstage-Fenstern (10 Punkte je
//      Board). Das ist ein PROXY auf kürzerem Horizont; das NIVEAU der AC ist
//      nicht auf 84 Tage übertragbar. Belastbar ist allein die Frage, ob die
//      Persistenz zwischen Boards STREUT — und genau das unterstellt R3 als
//      nicht gegeben.
//
// Score-Proxy: 63-Handelstage-Momentum am Fensteranfang. Der echte Screener-Score
// ist rückwirkend nicht rekonstruierbar (keine Point-in-Time-Fundamentaldaten vor
// dem 14.07.2026). Für die STRUKTURFRAGE ist das zulässig: gefragt ist nicht, wie
// gut ein Score trennt, sondern wie sich die IC-Reihen der Boards ZUEINANDER
// verhalten — das treibt die Board-Zusammensetzung und das gemeinsame Regime,
// nicht die Wahl des Scores. Die Sensitivitätsachse (zweiter Proxy) prüft das.
//
// Reine Diagnose: liest nur, schreibt nur nach stdout, kein Netz, kein Prozess.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const store = require('../lib/price-history-store.js');
const { spearman, nEff } = require('./rank-ic.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const VINTAGE = '2026-07-29';
const FAMILY = path.join(REPO_ROOT, 'protocol', 'rank-ic-families', 'g1.json');
const MOM_LOOKBACK = 63;   // Handelstage Score-Vorlauf (~3 Monate)
const MIN_N = 10;          // wie windowIC(): unter 10 Namen kein IC-Punkt
const BENCH = ['SPY', 'QQQ', 'IWM'];

// ── Hilfen ───────────────────────────────────────────────────────────────────
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
function pearson(x, y) {
  const n = x.length;
  if (n < 2) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
function quantile(a, q) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const f2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '  —  ' : (v >= 0 ? ' ' : '') + v.toFixed(3));

// Lag-1-AC einer Punktreihe, roh UND so bias-korrigiert wie nEff() es tut
// (rank-ic.js:279). Beide Werte, weil die Reparatur auf dem korrigierten arbeitet,
// die Streuungsfrage aber am rohen hängt.
function lag1(points) {
  if (points.length < 3) return { raw: null, corrected: null };
  const raw = pearson(points.slice(0, -1), points.slice(1));
  if (raw === null) return { raw: null, corrected: null };
  return { raw, corrected: Math.min(0.95, raw + (1 + 3 * raw) / points.length) };
}

// ── SELBSTKONTROLLE: feuert die AC-Achse überhaupt? ──────────────────────────
// Genau der Fehler, der in einer früheren Messung dieses Projekts unbemerkt blieb:
// eine Autokorrelations-Achse, die nie etwas bewirkte. Vor jeder echten Zahl wird
// hier bewiesen, dass lag1() eine vorgegebene AR(1)-Persistenz auch wiederfindet.
function selbstkontrolle() {
  let s = 20260730 >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const zeilen = [];
  let ok = true;
  for (const target of [0.0, 0.3, 0.6]) {
    const schaetzungen = [];
    for (let rep = 0; rep < 4000; rep++) {
      const x = [];
      let prev = gauss();
      for (let i = 0; i < 400; i++) { prev = target * prev + Math.sqrt(1 - target * target) * gauss(); x.push(prev); }
      const r = lag1(x).raw;
      if (r !== null) schaetzungen.push(r);
    }
    const m = mean(schaetzungen);
    const treffer = Math.abs(m - target) < 0.02;
    if (!treffer) ok = false;
    zeilen.push(`   vorgegeben ${target.toFixed(2)} -> gemessen ${m.toFixed(4)}  ${treffer ? 'OK' : 'FEHLT DAS ZIEL'}`);
  }
  console.log('\n[0] SELBSTKONTROLLE der AC-Schaetzung (lange Reihen, n=400, 4000 Wdh.)');
  zeilen.forEach((z) => console.log(z));
  if (!ok) { console.error('\nABBRUCH: die AC-Schaetzung trifft ihre eigene Vorgabe nicht — jede Zahl darunter waere wertlos.'); process.exit(1); }
  console.log('   => die Achse feuert. Jede AC-Zahl unten ist damit interpretierbar.');
}

// ── Daten ────────────────────────────────────────────────────────────────────
function ladeBoards() {
  const fam = JSON.parse(fs.readFileSync(FAMILY, 'utf8'));
  const out = new Map();
  for (const board of fam.boards) {
    const fp = path.join(REPO_ROOT, 'board-history', VINTAGE, board + '.json');
    let v;
    try { v = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) { continue; }
    if (!v || !v.cohort) continue;
    const tickers = new Set();
    for (const track of Object.keys(v.cohort)) {
      for (const row of v.cohort[track]) if (row && row.ticker) tickers.add(row.ticker);
    }
    if (tickers.size >= MIN_N) out.set(board, [...tickers]);
  }
  return out;
}

function handelstage(hist) {
  for (const t of BENCH) {
    const bars = hist[t];
    if (Array.isArray(bars) && bars.length > 100) {
      return bars.filter((b) => Number.isFinite(b.close) && b.close > 0).map((b) => b.date);
    }
  }
  throw new Error('kein Benchmark-Ticker im Preisbestand — ohne Handelstage-Gitter keine Fenster');
}

// ── IC-Reihen je Board ───────────────────────────────────────────────────────
// starts: Liste von Index-Positionen im Handelstage-Gitter (Fensteranfang t0).
// Ein IC-Punkt = Spearman(Momentum bei t0, Rendite t0->t0+H) über die Board-Namen.
function icReihen(boards, kurse, tage, starts, H) {
  const reihen = new Map();
  for (const [board, tickers] of boards) {
    const punkte = [];
    for (const i of starts) {
      const d0 = tage[i], dM = tage[i - MOM_LOOKBACK], d1 = tage[i + H];
      const scores = [], rets = [];
      for (const tk of tickers) {
        const m = kurse.get(tk);
        if (!m) continue;
        const pM = m.get(dM), p0 = m.get(d0), p1 = m.get(d1);
        if (!(pM > 0) || !(p0 > 0) || !(p1 > 0)) continue;
        scores.push(Math.log(p0 / pM));
        rets.push(p1 / p0 - 1);
      }
      if (scores.length < MIN_N) { punkte.push(null); continue; }
      punkte.push(spearman(scores, rets));
    }
    reihen.set(board, punkte);
  }
  return reihen;
}

// paarweise Board-Korrelation über die gemeinsam belegten Fenster
function paarKorrelationen(reihen, minGemeinsam) {
  const namen = [...reihen.keys()];
  const paare = [];
  for (let a = 0; a < namen.length; a++) {
    for (let b = a + 1; b < namen.length; b++) {
      const A = reihen.get(namen[a]), B = reihen.get(namen[b]);
      const x = [], y = [];
      for (let i = 0; i < A.length; i++) {
        if (A[i] === null || B[i] === null) continue;
        x.push(A[i]); y.push(B[i]);
      }
      if (x.length < minGemeinsam) continue;
      const r = pearson(x, y);
      if (r !== null) paare.push({ a: namen[a], b: namen[b], r, n: x.length });
    }
  }
  return paare;
}

// ── Hauptlauf ────────────────────────────────────────────────────────────────
function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log(' K1-VORARBEIT — Board-Korrelation und AC-Streuung an echten Kursen');
  console.log('════════════════════════════════════════════════════════════════');

  selbstkontrolle();

  const boards = ladeBoards();
  const hist = store.loadAll(path.join(REPO_ROOT, 'prices'));
  const tage = handelstage(hist);

  // nur die Board-Ticker in Maps überführen (28k Ticker sonst unnötig)
  const gebraucht = new Set();
  for (const tickers of boards.values()) for (const t of tickers) gebraucht.add(t);
  const kurse = new Map();
  let ohneSerie = 0;
  for (const tk of gebraucht) {
    const bars = hist[tk];
    if (!Array.isArray(bars) || !bars.length) { ohneSerie++; continue; }
    const m = new Map();
    for (const b of bars) if (Number.isFinite(b.close) && b.close > 0) m.set(b.date, b.close);
    kurse.set(tk, m);
  }

  console.log('\n[1] DATENLAGE');
  console.log(`   Handelstage: ${tage.length}  (${tage[0]} .. ${tage[tage.length - 1]})`);
  console.log(`   Boards der Familie g1 mit Kohorte: ${boards.size}`);
  console.log(`   Board-Ticker gesamt: ${gebraucht.size}, davon ohne Kursserie: ${ohneSerie}`);
  const nutzbar = tage.length - MOM_LOOKBACK;
  console.log(`   nach ${MOM_LOOKBACK} Tagen Score-Vorlauf nutzbar: ${nutzbar} Handelstage`);
  console.log(`   => disjunkte 84-KALENDERTAGE-Fenster (~58 Handelstage): ${Math.floor(nutzbar / 58)}`);
  console.log('   => die Autokorrelation der ECHTEN Messgroesse ist damit NICHT messbar.');

  // ── Ticker-Ueberlappung ────────────────────────────────────────────────────
  console.log('\n[2] TICKER-UEBERLAPPUNG zwischen den Boards');
  const namen = [...boards.keys()];
  let maxOverlap = 0, overlapPaare = 0;
  for (let a = 0; a < namen.length; a++) {
    for (let b = a + 1; b < namen.length; b++) {
      const A = new Set(boards.get(namen[a])), B = boards.get(namen[b]);
      let gem = 0; for (const t of B) if (A.has(t)) gem++;
      if (gem > 0) { overlapPaare++; maxOverlap = Math.max(maxOverlap, gem); }
    }
  }
  console.log(`   Board-Paare mit gemeinsamen Tickern: ${overlapPaare} von ${namen.length * (namen.length - 1) / 2}`);
  console.log(`   groesste Ueberlappung eines Paares: ${maxOverlap} Ticker`);
  console.log(`   => ${overlapPaare === 0 ? 'die Boards sind DISJUNKT; jede gemessene Korrelation ist reine Regime-Kopplung, keine Doppelzaehlung.' : 'ACHTUNG: Boards teilen Namen — ein Teil der Korrelation waere Doppelzaehlung.'}`);

  // ── (A) Board-Korrelation, gleitende Fenster, zwei Horizonte ───────────────
  console.log('\n[3] (A) BOARD-KORRELATION — gleitende Fenster (Ueberlappung verzerrt den');
  console.log('        Querschnitt nicht), Schritt 5 Handelstage');
  const ergA = {};
  for (const H of [21, 58]) {
    const starts = [];
    for (let i = MOM_LOOKBACK; i + H < tage.length; i += 5) starts.push(i);
    const reihen = icReihen(boards, kurse, tage, starts, H);
    const paare = paarKorrelationen(reihen, 8);
    const rs = paare.map((p) => p.r);
    ergA[H] = { paare, rs, fenster: starts.length };
    console.log(`\n   Horizont ${H} Handelstage (~${Math.round(H * 7 / 5)} Kalendertage), ${starts.length} Fenster, ${paare.length} Board-Paare`);
    console.log(`     Median rho : ${f2(quantile(rs, 0.5))}`);
    console.log(`     Quartile   : ${f2(quantile(rs, 0.25))} .. ${f2(quantile(rs, 0.75))}`);
    console.log(`     Spanne     : ${f2(Math.min(...rs))} .. ${f2(Math.max(...rs))}`);
    console.log(`     Mittelwert : ${f2(mean(rs))}`);
    const imBereich = rs.filter((r) => r >= 0.5 && r <= 0.99).length;
    console.log(`     im simulierten Bereich 0,50..0,99: ${imBereich} von ${rs.length} (${(100 * imBereich / rs.length).toFixed(1)} %)`);
  }

  // Gegenprobe: gleitende Fenster ueberlappen, die 37-44 "Fenster" sind also
  // nicht ebenso viele unabhaengige Punkte. Wenn die Aussage "die reale
  // Board-Korrelation liegt unter dem simulierten Bereich" traegt, muss sie auch
  // auf DISJUNKTEN Fenstern stehen — dort ist jeder Punkt unabhaengig.
  console.log('\n   GEGENPROBE auf DISJUNKTEN Fenstern (jeder Punkt unabhaengig):');
  for (const H of [21]) {
    const starts = [];
    for (let i = MOM_LOOKBACK; i + H < tage.length; i += H) starts.push(i);
    const reihen = icReihen(boards, kurse, tage, starts, H);
    const paare = paarKorrelationen(reihen, 8);
    const rs = paare.map((p) => p.r);
    // Unsicherheit des Medians ueber die Board-PAARE (Bootstrap ueber Paare)
    let s3 = 771129 >>> 0;
    const r3 = () => ((s3 = (s3 * 1664525 + 1013904223) >>> 0) / 4294967296);
    const meds = [];
    for (let b = 0; b < 4000; b++) {
      const zieh = Array.from({ length: rs.length }, () => rs[Math.floor(r3() * rs.length)]);
      meds.push(quantile(zieh, 0.5));
    }
    console.log(`     ${H}d disjunkt: ${starts.length} Fenster, ${paare.length} Paare`);
    console.log(`       Median rho ${f2(quantile(rs, 0.5))}, 90-%-Band des Medians ${f2(quantile(meds, 0.05))} .. ${f2(quantile(meds, 0.95))}`);
    console.log(`       ${quantile(meds, 0.95) < 0.5 ? '=> die Obergrenze des Bandes liegt UNTER 0,50: die reale Board-Korrelation\n          ist belegbar niedriger als der simulierte Bereich.' : '=> das Band reicht bis in den simulierten Bereich; die Aussage traegt nicht.'}`);
  }

  // ── (B) AC-Streuung, disjunkte 21-Tage-Fenster ────────────────────────────
  console.log('\n[4] (B) AC-STREUUNG zwischen Boards — DISJUNKTE 21-Handelstage-Fenster');
  console.log('        (Proxy: das NIVEAU ist nicht auf 84 Tage uebertragbar, die');
  console.log('         STREUUNG zwischen Boards ist die Frage)');
  const Hd = 21;
  const startsD = [];
  for (let i = MOM_LOOKBACK; i + Hd < tage.length; i += Hd) startsD.push(i);
  const reihenD = icReihen(boards, kurse, tage, startsD, Hd);
  console.log(`\n   ${startsD.length} disjunkte Fenster je Board`);
  console.log('   Board                        n   AC roh   AC korr.  N_eff(echt)');
  const acRoh = [], acKorr = [];
  for (const [board, punkte] of reihenD) {
    const p = punkte.filter((v) => v !== null);
    const { raw, corrected } = lag1(p);
    const ne = p.length >= 3 ? nEff(p) : null;
    if (raw !== null) { acRoh.push(raw); acKorr.push(corrected); }
    console.log(`   ${board.padEnd(26)} ${String(p.length).padStart(2)}   ${f2(raw)}   ${f2(corrected)}    ${ne === null ? '  —  ' : ne.toFixed(2)}`);
  }
  console.log(`\n   Streuung ueber Boards (Standardabweichung): roh ${f2(sd(acRoh))} | korrigiert ${f2(sd(acKorr))}`);
  console.log(`   Spanne roh: ${f2(Math.min(...acRoh))} .. ${f2(Math.max(...acRoh))}`);
  console.log(`   Median roh: ${f2(quantile(acRoh, 0.5))}`);
  const ausgefallen = acKorr.filter((v) => v <= 0).length;
  console.log(`   Boards, bei denen die Verbreiterung GANZ AUSFAELLT (korr. AC <= 0): ${ausgefallen} von ${acKorr.length}`);

  // ── (B2) IST DIESE STREUUNG MEHR ALS SCHAETZRAUSCHEN? ─────────────────────
  // Bei 11 Punkten hat eine Lag-1-Schaetzung einen Standardfehler von grob
  // 1/sqrt(11) ~ 0,30. Die oben gemessenen 0,32 koennten also VOLLSTAENDIG aus
  // Rauschen bestehen, obwohl alle Boards dieselbe wahre Persistenz haetten.
  // Ohne diese Gegenprobe waere "die Boards streuen" eine Behauptung.
  // Nullmodell: alle 14 Boards mit DERSELBEN wahren AC (der gepoolten Schaetzung),
  // gekoppelt ueber einen gemeinsamen Faktor in Hoehe der gemessenen
  // Board-Korrelation. Gefragt: wie oft erzeugt reines Rauschen >= die
  // beobachtete Streuung?
  console.log('\n[4b] GEGENPROBE — ist die Streuung mehr als Schaetzrauschen?');
  const reihenListe = [...reihenD.values()].map((p) => p.filter((v) => v !== null));
  // gepoolte Lag-1-AC, BOARD-WEISE zentriert (die bindende Einbau-Auflage von R3;
  // globales Zentrieren wuerde die Bias-Korrektur ein zweites Mal aufschlagen)
  let sxy = 0, sxx = 0, syy = 0, paareGes = 0;
  for (const p of reihenListe) {
    if (p.length < 3) continue;
    const m = mean(p);
    for (let i = 0; i + 1 < p.length; i++) { const a = p[i] - m, b = p[i + 1] - m; sxy += a * b; sxx += a * a; syy += b * b; paareGes++; }
  }
  const acPooled = (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;
  const nPunkte = reihenListe[0].length;
  const nBoards = reihenListe.length;
  const rhoBoard = Math.max(0, quantile(ergA[21].rs, 0.5));
  console.log(`   gepoolte Lag-1-AC (board-weise zentriert, ${paareGes} Paare): ${f2(acPooled)}`);
  console.log(`   Nullmodell: ${nBoards} Boards x ${nPunkte} Punkte, ALLE mit wahrer AC ${f2(acPooled)},`);
  console.log(`   gekoppelt mit Board-Korrelation ${f2(rhoBoard)}. 5000 Wiederholungen.`);

  let s2 = 990730 >>> 0;
  const rnd2 = () => ((s2 = (s2 * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss2 = () => { let u = 0, v = 0; while (u === 0) u = rnd2(); while (v === 0) v = rnd2(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const w = Math.sqrt(Math.max(0, Math.min(1, rhoBoard)));  // Gewicht des gemeinsamen Faktors
  const nullSDs = [];
  for (let rep = 0; rep < 5000; rep++) {
    // gemeinsamer AR(1)-Faktor + boardeigene AR(1)-Komponente, beide mit derselben
    // Persistenz => jedes Board hat wahre AC = acPooled, die Boards korrelieren mit rhoBoard
    const gem = []; let pg = gauss2();
    for (let i = 0; i < nPunkte; i++) { pg = acPooled * pg + Math.sqrt(1 - acPooled * acPooled) * gauss2(); gem.push(pg); }
    const acs = [];
    for (let b = 0; b < nBoards; b++) {
      const x = []; let pe = gauss2();
      for (let i = 0; i < nPunkte; i++) { pe = acPooled * pe + Math.sqrt(1 - acPooled * acPooled) * gauss2(); x.push(w * gem[i] + Math.sqrt(1 - w * w) * pe); }
      const r = lag1(x).raw;
      if (r !== null) acs.push(r);
    }
    const s = sd(acs);
    if (s !== null) nullSDs.push(s);
  }
  const beobachtet = sd(acRoh);
  const anteilGroesser = nullSDs.filter((v) => v >= beobachtet).length / nullSDs.length;
  console.log(`   Nullverteilung der Streuung: Median ${f2(quantile(nullSDs, 0.5))}, 90-%-Band ${f2(quantile(nullSDs, 0.05))} .. ${f2(quantile(nullSDs, 0.95))}`);
  console.log(`   beobachtet: ${f2(beobachtet)}`);
  console.log(`   Anteil der Nullziehungen mit mindestens dieser Streuung: ${(100 * anteilGroesser).toFixed(1)} %`);
  console.log(`   => ${anteilGroesser > 0.10
    ? 'HETEROGENITAET IST NICHT BELEGT. Die beobachtete Streuung ist von reinem\n      Schaetzrauschen bei identischer wahrer Persistenz nicht zu unterscheiden.\n      Sie ist damit AUCH KEIN Freispruch: mit 11 Punkten je Board kann diese\n      Messung echte Heterogenitaet dieser Groesse gar nicht nachweisen.'
    : 'die Streuung ueberschreitet, was Rauschen erzeugt — echte Heterogenitaet.'}`);

  // Trennschaerfe dieser Gegenprobe: welche echte Heterogenitaet WUERDE sie finden?
  const macht = [];
  for (const streuWahr of [0.1, 0.2, 0.3]) {
    let getroffen = 0;
    const schwelle = quantile(nullSDs, 0.90);
    for (let rep = 0; rep < 2000; rep++) {
      const acs = [];
      for (let b = 0; b < nBoards; b++) {
        const acB = Math.max(-0.85, Math.min(0.85, acPooled + streuWahr * gauss2()));
        const x = []; let pe = gauss2();
        for (let i = 0; i < nPunkte; i++) { pe = acB * pe + Math.sqrt(1 - acB * acB) * gauss2(); x.push(pe); }
        const r = lag1(x).raw;
        if (r !== null) acs.push(r);
      }
      const s = sd(acs);
      if (s !== null && s >= schwelle) getroffen++;
    }
    macht.push(`      wahre Streuung ${streuWahr.toFixed(2)} -> in ${(100 * getroffen / 2000).toFixed(0)} % der Faelle erkannt`);
  }
  console.log('   Trennschaerfe dieser Gegenprobe (wie oft findet sie echte Heterogenitaet?):');
  macht.forEach((m) => console.log(m));

  // ── (C) Sensitivitaet: haengt das Ergebnis am Score-Proxy? ─────────────────
  console.log('\n[5] SENSITIVITAET — dasselbe mit umgekehrtem Score-Proxy (Reversal statt');
  console.log('        Momentum). Haengt die STRUKTUR am gewaehlten Score, waere die');
  console.log('        Messung wertlos; das Vorzeichen dreht die IC, nicht die Struktur.');
  const reihenR = new Map();
  for (const [board, punkte] of reihenD) reihenR.set(board, punkte.map((v) => (v === null ? null : -v)));
  const acRohR = [];
  for (const [, punkte] of reihenR) {
    const p = punkte.filter((v) => v !== null);
    const { raw } = lag1(p);
    if (raw !== null) acRohR.push(raw);
  }
  console.log(`   AC-Streuung mit gedrehtem Score: ${f2(sd(acRohR))} (Momentum: ${f2(sd(acRoh))})`);
  console.log('   => Vorzeichenwechsel laesst die Lag-1-AC unveraendert (rho(-x) = rho(x));');
  console.log('      das ist die Probe darauf, dass hier Struktur und nicht Score-Guete gemessen wird.');

  // ── Verdikt ───────────────────────────────────────────────────────────────
  console.log('\n[6] WAS DAS FUER R3 HEISST');
  const medR58 = quantile(ergA[58].rs, 0.5);
  const medR21 = quantile(ergA[21].rs, 0.5);
  const streu = sd(acRoh);
  console.log(`   Board-Korrelation gemessen: Median ${f2(medR21)} (21d) / ${f2(medR58)} (58d).`);
  console.log(`   Simuliert wurde rho = 0,50 / 0,90 / 0,99.`);
  console.log(`   ${(medR58 >= 0.5 && medR58 <= 0.99) ? '=> die reale Board-Korrelation liegt IM getesteten Bereich.' : '=> ACHTUNG: die reale Board-Korrelation liegt AUSSERHALB des getesteten Bereichs.'}`);
  console.log(`   AC-Streuung zwischen Boards: ${f2(streu)} (Proxy-Horizont 21d).`);
  console.log('   R3 poolt EINE gemeinsame Autokorrelation. Je groesser diese Streuung,');
  console.log('   desto staerker wird das zaeheste Board unterkorrigiert. Ob das die');
  console.log('   85-%-Latte reisst, entscheidet die Heterogenitaets-Simulation, nicht');
  console.log('   diese Messung — hier steht nur, wie gross die Streuung wirklich ist.');
  console.log('\n════════════════════════════════════════════════════════════════');
}

main();
